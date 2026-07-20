// entrypoints/background/unlock.ts — background-side orchestration of both
// the fresh-install SIGN-IN ceremony (mints a session token) and the
// existing-token UNLOCK-ONLY ceremony, ported from
// web/src/components/auth/LoginForm.tsx's handleSubmit,
// web/src/components/auth/UnlockOverlay.tsx's unlockFromPassword, and
// web/src/lib/passkeys/login.ts's passkeyLogin()/passkeyUnlock().
//
// WR-08 (09-REVIEW.md): this file's four web-RP PRF handlers
// (handleUnlockPrfStart/Finish, handleSignInPrfStart/Finish) are DELETED as
// unreachable-by-construction — a `chrome-extension://` popup gets a
// SecurityError from `navigator.credentials.get()` for any web RP ID, which
// is exactly why 09-CONTEXT AMENDMENT 2026-07-15 pivoted to an
// extension-scoped PRF passkey. That path was itself hard-removed in AUTH-03
// (Plan 15-04) in favor of the server-origin ceremony window
// (server-unlock.ts); see lib/messaging/ext-protocol.ts's header for the
// full rationale. This file is now the PASSWORD path only (unlock-only +
// sign-in), and never touches a WebAuthn DOM API or a live
// `PublicKeyCredential`.
import { prelogin, me, login, base64Encode, base64Decode, ApiClientError } from "./auth-api";
import { deriveAuthMaterial, initCrypto, unwrapUserKey, WasmWrappingKey } from "../../lib/crypto/wasm-loader";
import { setUnlockedUserKey } from "./vault-session";
import { readSessionMeta } from "./session-storage";
import { DEFAULT_AUTOLOCK_MINUTES } from "./autolock";

export interface UnlockResult {
  ok: boolean;
  prfUnavailable?: boolean;
  error?: "invalid-credentials" | "unreachable" | "unknown";
}

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
