// entrypoints/background/ext-passkey.ts — enroll/unlock orchestration for
// the extension-scoped PRF passkey (09-CONTEXT AMENDMENT 2026-07-15: the
// popup's OWN passkey, rpId = browser.runtime.id, the ONLY rpId Chrome
// accepts for `navigator.credentials.get()` from a `chrome-extension://`
// popup page). D-05 preserved: the actual ceremony
// (`navigator.credentials.create()`/`get()`) runs ONLY in the popup (Plan
// 09-06) — this file never calls it, and never receives a live
// `PublicKeyCredential`, only already-stripped ceremony inputs/outputs
// (credential ids, salts, a transient PRF-bytes `ArrayBuffer`).
//
// Local meta record (chrome.storage.LOCAL, deliberately NOT .session):
// non-secret routing metadata only — credential id, public PRF salt,
// enrollment timestamp. D-09 bans KEY MATERIAL/PRF output/plaintext from
// storage.local; this record class is a DIFFERENT thing, the same class as
// server-config.ts's own persisted `baseUrl` (public, non-vault-secret,
// must survive a browser restart — unlike the session-scoped key envelope,
// an extension-passkey enrollment should not evaporate on every restart).
import { browser } from "wxt/browser";
import {
  createExtensionPasskey,
  listExtensionPasskeys,
  ApiClientError,
} from "./auth-api";
import { WasmWrappingKey, wrapUserKey, unwrapUserKey } from "../../lib/crypto/wasm-loader";
import { ensureHydrated, getUnlockedUserKey, isSessionUnlocked, setUnlockedUserKey } from "./vault-session";
import { readSessionMeta } from "./session-storage";
import type { UnlockResult } from "./unlock";

const META_STORAGE_KEY = "pv-ext-passkey-meta";
const PROMPT_SUPPRESSED_KEY = "pv-ext-passkey-prompt-suppressed";

export interface ExtPasskeyMeta {
  /** base64url (URL_SAFE_NO_PAD) — matches pv-server's own encoding. */
  credentialIdB64url: string;
  /** base64 (STANDARD) — public PRF salt, not secret. */
  prfSaltB64: string;
  enrolledAt: number;
}

function isExtPasskeyMeta(value: unknown): value is ExtPasskeyMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ExtPasskeyMeta).credentialIdB64url === "string" &&
    typeof (value as ExtPasskeyMeta).prfSaltB64 === "string" &&
    typeof (value as ExtPasskeyMeta).enrolledAt === "number"
  );
}

async function readExtPasskeyMeta(): Promise<ExtPasskeyMeta | null> {
  const result = await browser.storage.local.get(META_STORAGE_KEY);
  const value = result[META_STORAGE_KEY];
  return isExtPasskeyMeta(value) ? value : null;
}

async function writeExtPasskeyMeta(meta: ExtPasskeyMeta): Promise<void> {
  await browser.storage.local.set({ [META_STORAGE_KEY]: meta });
}

async function clearExtPasskeyMeta(): Promise<void> {
  await browser.storage.local.remove(META_STORAGE_KEY);
}

// btoa-based encode (no Buffer dependency) — duplicated locally rather than
// importing auth-api.ts's own base64Encode, keeping this file's crypto-
// adjacent helpers self-contained (matches ../../lib/passkeys/prf.ts's own
// "duplicate the tiny helper" rationale for a different boundary).
function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export type ExtEnrollStartResult =
  | { ok: true; accountEmail: string; userHandleB64: string; challengeB64: string; prfSaltB64: string }
  | { ok: false; error: "not-unlocked" };

/**
 * Generates fresh ceremony inputs (user handle, challenge, PRF salt — all
 * PUBLIC values via `crypto.getRandomValues`, never key material) for the
 * popup's `navigator.credentials.create()` call. Guards on an unlocked
 * session BEFORE generating anything — a locked/no-session vault returns
 * the typed failure without any random-bytes work.
 */
export async function handleExtEnrollStart(): Promise<ExtEnrollStartResult> {
  if (!isSessionUnlocked()) {
    return { ok: false, error: "not-unlocked" };
  }
  const meta = await readSessionMeta();
  if (meta === null) {
    return { ok: false, error: "not-unlocked" };
  }

  const userHandle = crypto.getRandomValues(new Uint8Array(16));
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const prfSalt = crypto.getRandomValues(new Uint8Array(32));

  return {
    ok: true,
    accountEmail: meta.accountEmail,
    userHandleB64: base64Encode(userHandle),
    challengeB64: base64Encode(challenge),
    prfSaltB64: base64Encode(prfSalt),
  };
}

/**
 * Wraps the CURRENT session's User Key under the freshly-enrolled
 * extension passkey's PRF output, POSTs the opaque blob, and persists the
 * non-secret local meta record. Re-guards unlocked (never trusts the
 * popup's sequencing — a bearer token alone can never mint a recipient
 * blob for a key the caller doesn't hold). Zeroizes the transient PRF
 * buffer in `finally` regardless of outcome.
 */
export async function handleExtEnrollFinish(args: {
  credentialIdB64url: string;
  prfSaltB64: string;
  prfBytes: ArrayBuffer;
}): Promise<{ ok: boolean; error?: "not-unlocked" | "unreachable" | "unknown" }> {
  const prfArray = new Uint8Array(args.prfBytes);
  let wrappingKey: WasmWrappingKey | undefined;
  try {
    await ensureHydrated();
    const uk = getUnlockedUserKey();
    if (uk === null) {
      return { ok: false, error: "not-unlocked" };
    }

    wrappingKey = WasmWrappingKey.fromExtPrf(prfArray); // zeroizes prfArray as a side effect
    const wrappedJson = wrapUserKey(wrappingKey, uk);

    await createExtensionPasskey({
      credential_id: args.credentialIdB64url,
      prf_salt: args.prfSaltB64,
      prf_wrapped_uk: wrappedJson,
    });

    await writeExtPasskeyMeta({
      credentialIdB64url: args.credentialIdB64url,
      prfSaltB64: args.prfSaltB64,
      enrolledAt: Date.now(),
    });

    return { ok: true };
  } catch (e) {
    if (e instanceof ApiClientError) {
      return { ok: false, error: "unknown" };
    }
    return { ok: false, error: "unreachable" };
  } finally {
    prfArray.fill(0);
    wrappingKey?.free?.();
  }
}

/**
 * Reads the local meta record ONLY — no network call, offline-friendly.
 * The popup needs the credential id + salt BEFORE it can run
 * `navigator.credentials.get()`.
 */
export async function handleExtPrfUnlockStart(): Promise<
  { credentialIdB64url: string; prfSaltB64: string } | { notEnrolled: true }
> {
  const meta = await readExtPasskeyMeta();
  if (meta === null) {
    return { notEnrolled: true };
  }
  return { credentialIdB64url: meta.credentialIdB64url, prfSaltB64: meta.prfSaltB64 };
}

/**
 * Structurally extends `UnlockResult` (Plan 09-04's `unlock.ts`, left
 * unmodified) with an extra `"not-enrolled"` error variant for the
 * orphaned-credential / stale-meta case — deliberately NOT added to
 * `unlock.ts`'s own union (out of this plan's bounded edit scope; that
 * file's error space is about password/web-RP-PRF failures, not this
 * extension-scoped recipient's own lifecycle).
 */
export interface ExtUnlockResult {
  ok: boolean;
  prfUnavailable?: boolean;
  error?: UnlockResult["error"] | "not-enrolled";
}

/**
 * Fetches the caller's enrolled extension-passkey rows, matches by
 * credential id, unwraps the UK, and calls `setUnlockedUserKey` with the
 * EXISTING token/email/idle-minutes (unchanged by this unlock — read from
 * `readSessionMeta()`, same as `unlock.ts`'s own unlock-only branch). A
 * missing row (dev-ID change / deleted blob) or an `unwrapUserKey` failure
 * (blob/key mismatch) both map to `"not-enrolled"` AND clear the stale
 * local meta record so `session.status` stops advertising a dead PRF
 * button. A 401 (expired token) maps to `"invalid-credentials"` — the
 * popup falls back to password sign-in.
 */
export async function handleExtPrfUnlockFinish(args: {
  credentialIdB64url: string;
  prfBytes: ArrayBuffer;
}): Promise<ExtUnlockResult> {
  const prfArray = new Uint8Array(args.prfBytes);
  let wrappingKey: WasmWrappingKey | undefined;
  try {
    let rows;
    try {
      rows = await listExtensionPasskeys();
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        return { ok: false, error: "invalid-credentials" };
      }
      return { ok: false, error: "unknown" };
    }

    const row = rows.find((r) => r.credential_id === args.credentialIdB64url);
    if (row === undefined) {
      await clearExtPasskeyMeta();
      return { ok: false, error: "not-enrolled" };
    }

    wrappingKey = WasmWrappingKey.fromExtPrf(prfArray); // zeroizes prfArray as a side effect

    let uk;
    try {
      uk = unwrapUserKey(wrappingKey, row.prf_wrapped_uk);
    } catch {
      await clearExtPasskeyMeta();
      return { ok: false, error: "not-enrolled" };
    }

    const meta = await readSessionMeta();
    if (meta === null) {
      return { ok: false, error: "unknown" };
    }
    await setUnlockedUserKey(uk, meta.accountEmail, meta.sessionToken, meta.idleTimeoutMinutes);
    return { ok: true };
  } finally {
    prfArray.fill(0);
    wrappingKey?.free?.();
  }
}

/** Used by `session.status` (router.ts) to gate the popup's PRF-button visibility. */
export async function hasEnrolledExtPasskey(): Promise<boolean> {
  return (await readExtPasskeyMeta()) !== null;
}

export async function readExtPasskeyPromptSuppressed(): Promise<boolean> {
  const result = await browser.storage.local.get(PROMPT_SUPPRESSED_KEY);
  return result[PROMPT_SUPPRESSED_KEY] === true;
}

export async function setExtPasskeyPromptSuppressed(suppress: boolean): Promise<void> {
  await browser.storage.local.set({ [PROMPT_SUPPRESSED_KEY]: suppress });
}
