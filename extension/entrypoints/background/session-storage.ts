// entrypoints/background/session-storage.ts — async chrome.storage.session
// read/write for TWO independently-lifetimed records. "One storage
// mechanism" (09-CONTEXT.md's Discretion Area) means one storage AREA --
// chrome.storage.session, never chrome.storage.local -- not one
// undifferentiated record: the User Key material and the bearer session
// token have different lock-time lifetimes and must not share a
// clear-on-lock lifecycle.
import { browser } from "wxt/browser";

// Lock-surviving: cleared only by a full sign-out (not built this phase --
// no sign-out UI exists yet) or a browser restart (chrome.storage.session
// clears this automatically -- no code needed for that case). NEVER
// cleared by lockVaultSession() (./vault-session.ts). The bearer token is
// auth material, not vault-secret material (09-CONTEXT.md's Discretion
// Area) -- keeping it across an auto-lock matches v0.1's own posture
// (web/src/lib/auth/session.ts + UnlockOverlay.tsx's unlockFromPassword()
// re-derives the key from an EXISTING token after a lock, it never
// re-logs-in), and is what makes session.status's `locked` branch
// reachable at all instead of always collapsing to `no-session`.
export interface SessionMeta {
  sessionToken: string;
  accountEmail: string;
  idleTimeoutMinutes: number;
  unlockedAtMs: number;
  // Set true by autolock.ts's alarm handler via lockVaultSession(true), read
  // once by session.status then cleared back to false on the next
  // successful unlock (setUnlockedUserKey always writes wasAutoLocked:
  // false).
  wasAutoLocked: boolean;
}

// Cleared on EVERY lockVaultSession() call -- this is the only thing an
// auto-lock actually needs to destroy to be secure.
export interface KeyEnvelope {
  // base64(exportUserKeyForSession(uk)) -- SANCTIONED exception, see
  // pv-wasm's D-02 doc comment at export_user_key_for_session.
  userKeyB64: string;
}

const META_STORAGE_KEY = "pv-session-meta";
const KEY_STORAGE_KEY = "pv-uk-envelope";

// chrome.storage.session's default access_level is already TRUSTED_CONTEXTS
// (extension pages + background only) -- never call
// setAccessLevel(TRUSTED_AND_UNTRUSTED_CONTEXTS) here or anywhere else in
// this codebase; doing so would grant content scripts (Phase 10+) read
// access to this data, violating D-01/D-09.

function isSessionMeta(value: unknown): value is SessionMeta {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as SessionMeta).sessionToken === "string" &&
    typeof (value as SessionMeta).accountEmail === "string" &&
    typeof (value as SessionMeta).idleTimeoutMinutes === "number" &&
    typeof (value as SessionMeta).unlockedAtMs === "number" &&
    typeof (value as SessionMeta).wasAutoLocked === "boolean"
  );
}

function isKeyEnvelope(value: unknown): value is KeyEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as KeyEnvelope).userKeyB64 === "string"
  );
}

/**
 * Resolves the persisted session-meta record, or `null` if never unlocked
 * (or the persisted shape is corrupt -- treated as absent, never thrown).
 */
export async function readSessionMeta(): Promise<SessionMeta | null> {
  try {
    const result = await browser.storage.session.get(META_STORAGE_KEY);
    const value = result[META_STORAGE_KEY];
    return isSessionMeta(value) ? value : null;
  } catch {
    return null;
  }
}

export async function writeSessionMeta(meta: SessionMeta): Promise<void> {
  await browser.storage.session.set({ [META_STORAGE_KEY]: meta });
}

/**
 * Convenience reader: `readSessionMeta()?.sessionToken ?? null`. Plan
 * 09-04's auth-api.ts reads the bearer token for its Authorization header
 * through this function directly -- never re-implements the lookup.
 */
export async function getSessionToken(): Promise<string | null> {
  const meta = await readSessionMeta();
  return meta?.sessionToken ?? null;
}

/**
 * Resolves the persisted key envelope, or `null` if the vault is currently
 * locked/never unlocked (or the persisted shape is corrupt -- treated as
 * absent, never thrown).
 */
export async function readKeyEnvelope(): Promise<KeyEnvelope | null> {
  try {
    const result = await browser.storage.session.get(KEY_STORAGE_KEY);
    const value = result[KEY_STORAGE_KEY];
    return isKeyEnvelope(value) ? value : null;
  } catch {
    return null;
  }
}

export async function writeKeyEnvelope(envelope: KeyEnvelope): Promise<void> {
  await browser.storage.session.set({ [KEY_STORAGE_KEY]: envelope });
}

/** The only thing lockVaultSession() (./vault-session.ts) ever clears. */
export async function clearKeyEnvelope(): Promise<void> {
  await browser.storage.session.remove(KEY_STORAGE_KEY);
}
