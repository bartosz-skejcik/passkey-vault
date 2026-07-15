// entrypoints/background/unlock.ts — background-side orchestration of both
// the fresh-install SIGN-IN ceremony (mints a session token) and the
// existing-token UNLOCK-ONLY ceremony, ported from
// web/src/components/auth/LoginForm.tsx's handleSubmit,
// web/src/components/auth/UnlockOverlay.tsx's unlockFromPassword, and
// web/src/lib/passkeys/login.ts's passkeyLogin()/passkeyUnlock(), split at
// the exact point WebAuthn requires (D-05): the WebAuthn assertion-request
// DOM API has no DOM/WebAuthn access inside an MV3 service worker, so it is
// the popup's (Plan 09-06) job to run that call and forward only its
// already-public output (stripped credential JSON + extracted PRF bytes,
// via ../../lib/passkeys/prf.ts) into the `*PrfFinish` functions below. This
// file never calls that DOM API directly and never receives a live
// `PublicKeyCredential`.
import {
  prelogin,
  me,
  login,
  unlockStart as apiUnlockStart,
  unlockFinish as apiUnlockFinish,
  passkeyLoginStart as apiPasskeyLoginStart,
  passkeyLoginFinish as apiPasskeyLoginFinish,
  base64Encode,
  base64Decode,
  ApiClientError,
} from "./auth-api";
import { deriveAuthMaterial, initCrypto, unwrapUserKey, WasmWrappingKey } from "../../lib/crypto/wasm-loader";
import { setUnlockedUserKey } from "./vault-session";
import { readSessionMeta } from "./session-storage";
import { DEFAULT_AUTOLOCK_MINUTES } from "./autolock";

export interface UnlockResult {
  ok: boolean;
  prfUnavailable?: boolean;
  error?: "invalid-credentials" | "unreachable" | "unknown";
}

/** Shared return shape for both PRF-start pairs (unlock-only and sign-in). */
export type PrfStartResult =
  | { stateId: string; challenge: unknown; prfSalts: Record<string, string> }
  | { prfUnavailable: true };

/**
 * `email === undefined` -> unlock-only (existing token, calls `me()` to
 * confirm the token is still valid, never falls back to sign-in on its own
 * -- the popup decides which message kind to dispatch, per
 * 09-UI-SPEC.md's Sign-in vs. Unlock-only split).
 * `email` provided -> sign-in (fresh install / no-session, calls `login()`
 * directly -- never calls `me()` first, since there is by definition no
 * token yet).
 */
export async function handleUnlockPassword(
  passwordBytes: Uint8Array,
  email?: string,
): Promise<UnlockResult> {
  let material: ReturnType<typeof deriveAuthMaterial> | undefined;
  let wrappingKey: WasmWrappingKey | undefined;

  try {
    // A fresh service-worker instance has NO live WASM until something
    // initializes it -- only the hydration path did, so a first-ever
    // sign-in hit an uninitialized module and failed instantly as
    // "unknown" (real-browser UAT find #5; mocked wasm-loader made unit
    // tests blind). Idempotent + memoized, so this is cheap on re-entry.
    await initCrypto();
    if (email === undefined) {
      // Unlock-only, mirrors UnlockOverlay.tsx's unlockFromPassword: a 401
      // here means the session token itself is no longer valid -- return a
      // typed failure the popup can render, never a window.location.reload()
      // (no `window` in this context).
      const account = await me();
      const { kdf, salt } = await prelogin(account.email);
      material = deriveAuthMaterial(passwordBytes, base64Decode(salt), JSON.stringify(kdf));
      wrappingKey = material.takeWrappingKey();
      const uk = unwrapUserKey(wrappingKey, account.pw_wrapped_uk);

      // Existing token/idle-minutes are unchanged by this unlock -- read
      // them rather than re-deriving.
      const meta = await readSessionMeta();
      if (meta === null) {
        return { ok: false, error: "unknown" };
      }
      await setUnlockedUserKey(uk, account.email, meta.sessionToken, meta.idleTimeoutMinutes);
      return { ok: true };
    }

    // Sign-in, mirrors LoginForm.tsx's handleSubmit: login()'s response
    // already includes pw_wrapped_uk, so this plan does the unwrap in the
    // SAME round trip (no popup-equivalent of pendingUnlock's two-step UX
    // is needed here).
    const { kdf, salt } = await prelogin(email);
    material = deriveAuthMaterial(passwordBytes, base64Decode(salt), JSON.stringify(kdf));
    const authHash = material.takeAuthHash();
    wrappingKey = material.takeWrappingKey();

    const { session_token, pw_wrapped_uk } = await login({
      email,
      auth_hash: base64Encode(authHash),
    });
    const uk = unwrapUserKey(wrappingKey, pw_wrapped_uk);
    await setUnlockedUserKey(uk, email, session_token, DEFAULT_AUTOLOCK_MINUTES);
    return { ok: true };
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 401) {
      return { ok: false, error: "invalid-credentials" };
    }
    return { ok: false, error: "unknown" };
  } finally {
    // T-09-16: unconditional regardless of outcome, mirroring
    // LoginForm.tsx's/UnlockOverlay.tsx's exact discipline.
    passwordBytes.fill(0);
    material?.free?.();
    wrappingKey?.free?.();
  }
}

// --- Unlock-only pair: SessionUser-gated server routes, requires an
// existing valid token. ---------------------------------------------------

export async function handleUnlockPrfStart(): Promise<PrfStartResult> {
  try {
    const start = await apiUnlockStart();
    return { stateId: start.state_id, challenge: start.challenge, prfSalts: start.prf_salts };
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) {
      // Zero PRF-capable passkeys -- no browser prompt ever shown for this case.
      return { prfUnavailable: true };
    }
    throw e;
  }
}

export async function handleUnlockPrfFinish(args: {
  stateId: string;
  credentialJson: unknown;
  prfBytes: ArrayBuffer;
}): Promise<UnlockResult> {
  try {
    await initCrypto(); // see handleUnlockPassword -- fresh SW has no WASM yet
    const finish = await apiUnlockFinish({
      state_id: args.stateId,
      credential: args.credentialJson,
    });

    if (finish.prf_wrapped_uk === null) {
      // Defensive branch: unlock_start only ever offers prf_capable
      // credentials, so this should be rare -- same two-case collapse
      // passkeyUnlock() applies if the extension silently didn't report.
      return { ok: false, prfUnavailable: true };
    }

    const prfArray = new Uint8Array(args.prfBytes);
    const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
    try {
      const uk = unwrapUserKey(wrappingKey, finish.prf_wrapped_uk);
      const meta = await readSessionMeta();
      if (meta === null) {
        return { ok: false, error: "unknown" };
      }
      await setUnlockedUserKey(uk, meta.accountEmail, meta.sessionToken, meta.idleTimeoutMinutes);
      return { ok: true };
    } finally {
      wrappingKey.free?.();
    }
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 401) {
      return { ok: false, error: "invalid-credentials" };
    }
    return { ok: false, error: "unknown" };
  }
}

// --- Sign-in pair: unauthenticated server routes (passkeyLoginStart/Finish),
// the fresh-install/no-token PRF path. Requires email (no session yet to
// scope the ceremony to). ---------------------------------------------------

export async function handleSignInPrfStart(email: string): Promise<PrfStartResult> {
  try {
    const start = await apiPasskeyLoginStart({ email });
    return { stateId: start.state_id, challenge: start.challenge, prfSalts: start.prf_salts };
  } catch (e) {
    if (e instanceof ApiClientError && e.status === 404) {
      // No enrolled passkey for this email at all.
      return { prfUnavailable: true };
    }
    throw e;
  }
}

export async function handleSignInPrfFinish(args: {
  stateId: string;
  email: string;
  credentialJson: unknown;
  prfBytes: ArrayBuffer;
}): Promise<UnlockResult> {
  try {
    await initCrypto(); // see handleUnlockPassword -- fresh SW has no WASM yet
    const finish = await apiPasskeyLoginFinish({
      state_id: args.stateId,
      credential: args.credentialJson,
    });

    if (finish.prf_wrapped_uk === null) {
      // Deliberate scope decision: unlike v0.1's pendingUnlock handoff, this
      // branch does NOT persist the session_token it just minted -- the
      // popup's sign-in UI falls back to showing the password field
      // (auth.signIn.password), which performs its own fresh login() call.
      // Trades one redundant network round trip for not needing a new
      // session-only-no-key write path in session-storage.ts (out of this
      // plan's bounded edit scope).
      return { ok: false, prfUnavailable: true };
    }

    const prfArray = new Uint8Array(args.prfBytes);
    const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
    try {
      const uk = unwrapUserKey(wrappingKey, finish.prf_wrapped_uk);
      await setUnlockedUserKey(uk, args.email, finish.session_token, DEFAULT_AUTOLOCK_MINUTES);
      return { ok: true };
    } finally {
      wrappingKey.free?.();
    }
  } catch {
    return { ok: false, error: "unknown" };
  }
}
