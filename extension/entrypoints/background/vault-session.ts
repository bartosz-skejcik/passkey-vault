// entrypoints/background/vault-session.ts — the real session core (Plan
// 09-02), evolved from Phase 8's idle-kill/wake spike
// (../../lib/crypto/vault-session.ts, left untouched -- still backs the
// throwaway debug popup's spike.roundtrip message until Plan 09-05
// replaces the popup entirely).
//
// THE SESSION-KEY RULE: the unlocked User Key envelope lives ONLY in
// chrome.storage.session (via ./session-storage.ts's TWO
// independently-lifetimed records), never chrome.storage.local, never
// treated as durable in-memory state. `currentUserKey` below is a fast-path
// CACHE, not the source of truth -- every exported function here treats
// itself as possibly-just-woken and re-hydrates from storage.session
// rather than trusting `currentUserKey` survived a service-worker
// idle-kill.
import { browser } from "wxt/browser";
import {
  initCrypto,
  WasmUserKey,
  exportUserKeyForSession,
  importUserKeyFromSession,
} from "../../lib/crypto/wasm-loader";
import {
  readSessionMeta,
  writeSessionMeta,
  readKeyEnvelope,
  writeKeyEnvelope,
  clearKeyEnvelope,
} from "./session-storage";
import { armAutoLock, DEFAULT_AUTOLOCK_MINUTES } from "./autolock";

// Module-level in-memory fast path -- NOT the source of truth. A fresh SW
// instance woken after an idle-kill starts with this at `null`;
// ensureHydrated() re-derives it from chrome.storage.session.
let currentUserKey: WasmUserKey | null = null;
const lockListeners = new Set<() => void>();

function notifyLockListeners(): void {
  lockListeners.forEach((listener) => listener());
}

/** In-memory fast path only -- may be `null` on a fresh SW instance; callers must `ensureHydrated()` first. */
export function getUnlockedUserKey(): WasmUserKey | null {
  return currentUserKey;
}

/** Sync, in-memory-only check -- does NOT re-hydrate. */
export function isSessionUnlocked(): boolean {
  return currentUserKey !== null;
}

export function subscribeSessionLockState(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => {
    lockListeners.delete(listener);
  };
}

// btoa/atob operate on binary strings, not byte arrays -- same bridge
// Phase 8's spike (../../lib/crypto/vault-session.ts) uses, available as
// plain globals in every context this code runs (MV3 SW, MV2 background
// page, and Node under vitest).
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Checks the in-memory cache first; if empty, reads the persisted key
 * envelope (NOT the session-meta record -- a present session-meta record
 * with no key envelope is exactly the "locked" state) and re-imports it
 * into a freshly-initialized WASM instance. Returns `null` when genuinely
 * locked/never-unlocked -- never a false-positive hydration.
 */
export async function ensureHydrated(): Promise<WasmUserKey | null> {
  if (currentUserKey !== null) {
    return currentUserKey;
  }

  const envelope = await readKeyEnvelope();
  if (envelope === null) {
    return null;
  }

  // A WASM instance killed alongside the SW must be re-instantiated, not
  // assumed present.
  await initCrypto();
  const bytes = base64ToBytes(envelope.userKeyB64);
  currentUserKey = importUserKeyFromSession(bytes);
  return currentUserKey;
}

/**
 * Frees any existing handle, exports+writes BOTH the key envelope AND the
 * session-meta record (wasAutoLocked reset to false -- this is the one
 * function that ever writes session-meta, so it is also the "log in"
 * writer Plan 09-04's login-then-unlock flow calls). Zeroizes the
 * transient JS buffer in a `finally` regardless of write outcome
 * (T-09-06), mirroring web/src/lib/crypto/index.ts's deriveAuthMaterial's
 * `finally { passwordBytes.fill(0) }` discipline. Session-meta is written
 * FIRST so a mid-write failure never leaves a key envelope with no
 * corresponding session record.
 */
export async function setUnlockedUserKey(
  uk: WasmUserKey,
  accountEmail: string,
  sessionToken: string,
  idleTimeoutMinutes: number,
): Promise<void> {
  currentUserKey?.free?.();
  currentUserKey = uk;

  await writeSessionMeta({
    sessionToken,
    accountEmail,
    idleTimeoutMinutes,
    unlockedAtMs: Date.now(),
    wasAutoLocked: false,
  });

  let exported: Uint8Array | undefined;
  try {
    exported = exportUserKeyForSession(uk);
    await writeKeyEnvelope({ userKeyB64: bytesToBase64(exported) });
  } finally {
    exported?.fill(0);
  }

  notifyLockListeners();
}

/**
 * Idempotent. Clears the in-memory handle + the KEY ENVELOPE ONLY
 * (clearKeyEnvelope()) -- the session-meta record (token/email/idle-
 * minutes) is explicitly NOT deleted, only updated in place to flip
 * `wasAutoLocked`. This is the Blocker-2 fix (see 09-02-PLAN.md): clearing
 * the whole envelope here would destroy the bearer token on every
 * auto-lock and make session.status's "locked" branch unreachable.
 */
export async function lockVaultSession(wasAutoLocked = false): Promise<void> {
  currentUserKey?.free?.();
  currentUserKey = null;
  await clearKeyEnvelope();

  const meta = await readSessionMeta();
  if (meta !== null) {
    await writeSessionMeta({ ...meta, wasAutoLocked });
  }

  notifyLockListeners();

  // CR-01 fix (09-REVIEW.md): a dedicated broadcast, distinct from
  // vault-store.ts's `vault.updated` (which also fires on every ordinary
  // sync merge) -- App.tsx's top-level listener reacts to THIS to drop
  // back to the unlock view from ANY view (including item-detail, which
  // holds decrypted/possibly-revealed plaintext in React state), without
  // the popup ever having to poll or infer a lock from a cache change.
  // Swallowed exactly like vault-store.ts's own broadcast: "no receiver"
  // (no popup currently open) is the expected common case, not an error.
  void browser.runtime.sendMessage({ kind: "session.locked" }).catch(() => {});
}

/**
 * No-op if locked; otherwise re-arms the auto-lock alarm at the
 * currently-configured idle minutes. Called by router.ts on every
 * dispatched message.
 */
export async function noteActivity(): Promise<void> {
  if (!isSessionUnlocked()) {
    return;
  }
  const meta = await readSessionMeta();
  await armAutoLock(meta?.idleTimeoutMinutes ?? DEFAULT_AUTOLOCK_MINUTES);
}
