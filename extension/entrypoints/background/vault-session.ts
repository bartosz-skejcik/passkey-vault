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
  clearSessionMeta,
} from "./session-storage";
import { armAutoLock, DEFAULT_AUTOLOCK_MINUTES } from "./autolock";
import { logout } from "./auth-api";
// 27-04 (Task 1, A-4/KEY-01): identity-store.ts is this extension's SINGLE
// unlock choke point's KEY-01 trigger wiring target. NOTE: identity-store.ts
// itself imports `ensureHydrated`/`getUnlockedUserKey` FROM this module --
// this is a deliberate circular import (mirrors collections-store.ts's own
// import of identity-store.ts). Safe here because every use on both sides is
// inside a function body, never at module-evaluation time, so neither
// module's top-level code ever observes the other's not-yet-initialized
// exports.
import { freeIdentityKey, publishOnUnlock } from "./identity-store";

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

// btoa/atob operate on binary strings, not byte arrays -- the standard
// bridge, available as plain globals in every context this code runs (MV3
// SW, MV2 background page, and Node under vitest).
//
// WR-04 (09-REVIEW.md) -- THE HONEST BOUND ON THIS HOP, documented at the
// point of risk per this project's convention:
//
// Both helpers below necessarily materialize the raw 32 User Key bytes
// inside JS STRINGS (the `binary` intermediate, the base64 result, and the
// rope fragments `+=` produces). JS strings are IMMUTABLE -- there is no
// `.fill(0)` for them, so unlike the `Uint8Array` (which
// setUnlockedUserKey/ensureHydrated DO zeroize in a `finally`), these
// strings CANNOT be wiped. Crucially, lockVaultSession() cannot clear them
// either: after an auto-lock the User Key material is still resident in the
// service-worker heap until GC happens to collect it, which is precisely
// the property the key envelope's clear-on-lock design otherwise denies.
//
// This is BOUNDED and accepted, not a zero-knowledge break: the exposure is
// same-process, extension-context heap only -- never reachable by a page, a
// content script, storage.local, a log, or the server. It is the same class
// of exposure UnlockView.tsx:103-108 already names and bounds for its own
// b64 hop at the popup boundary; this comment exists so the two are
// symmetric and no future reader believes the invariant is stronger than it
// is. (A future hardening could move the b64 encode into pv-wasm so
// `export_user_key_for_session` returns a `String` directly, removing the
// raw-byte JS string from the export path entirely -- deliberately NOT done
// here, as it is out of this gap-closure's bounded scope.)
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
 *
 * WR-04: the `base64ToBytes` call below leaves an un-zeroizable JS string
 * holding the raw User Key bytes in the SW heap -- see that helper's own
 * comment for the full, honest bound. Not cleared by a lock.
 */
export async function ensureHydrated(): Promise<WasmUserKey | null> {
  if (currentUserKey !== null) {
    return currentUserKey;
  }

  const envelope = await readKeyEnvelope();
  if (envelope === null) {
    return null;
  }

  // WR-01 (09-REVIEW.md): a corrupt/un-importable envelope must never
  // THROW out of session.status -- that rejected App.tsx's
  // refreshFromScratch() and stranded the popup on the loading spinner
  // forever (router.ts's own rejection-path fix, WR-01, is the second
  // layer, but this handler should never need it: an un-importable
  // envelope is exactly the "locked" state, not an error). Clear the
  // envelope so the next call doesn't re-throw on the same corruption.
  try {
    // A WASM instance killed alongside the SW must be re-instantiated, not
    // assumed present.
    await initCrypto();
    const bytes = base64ToBytes(envelope.userKeyB64);
    currentUserKey = importUserKeyFromSession(bytes);
    return currentUserKey;
  } catch (e) {
    console.error("[passkey-vault] corrupt key envelope -- treating as locked", e);
    await clearKeyEnvelope();
    return null;
  }
}

/**
 * Frees any existing handle, exports+writes BOTH the key envelope AND the
 * session-meta record (wasAutoLocked reset to false -- this is the one
 * function that ever writes session-meta, so it is also the "log in"
 * writer Plan 09-04's login-then-unlock flow calls). Zeroizes the
 * transient JS BUFFER in a `finally` regardless of write outcome
 * (T-09-06), mirroring web/src/lib/crypto/index.ts's deriveAuthMaterial's
 * `finally { passwordBytes.fill(0) }` discipline. Session-meta is written
 * FIRST so a mid-write failure never leaves a key envelope with no
 * corresponding session record.
 *
 * WR-04 -- scope of that zeroize, stated honestly: it covers the
 * `Uint8Array` ONLY. The `bytesToBase64` call below additionally leaves
 * immutable JS strings holding the same raw User Key bytes in the SW heap,
 * which nothing here (and no later lock) can wipe. See that helper's own
 * comment for the full bound and why it is accepted.
 *
 * WR-05: arms the auto-lock alarm ITSELF, at the moment of the actual
 * lock->unlock state transition -- see the call at the end of the body.
 *
 * 27-04 (Task 1, A-4/KEY-01): this is the ONE choke point every unlock path
 * in this extension already converges through -- `freeIdentityKey()` runs
 * FIRST (mirrors the unconditional `currentUserKey?.free?.()` immediately
 * below: a re-unlock must never leave a stale identity-key handle cached
 * from a prior session), and `publishOnUnlock(uk)` fires immediately after
 * `currentUserKey = uk` is assigned -- fire-and-forget, never awaited (see
 * that function's own doc comment for why).
 */
export async function setUnlockedUserKey(
  uk: WasmUserKey,
  accountEmail: string,
  sessionToken: string,
  idleTimeoutMinutes: number,
): Promise<void> {
  freeIdentityKey();
  currentUserKey?.free?.();
  currentUserKey = uk;
  publishOnUnlock(uk);

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

  // WR-05 (09-REVIEW.md): arm the alarm HERE, where the lock->unlock state
  // transition actually happens. Previously nothing on the unlock path armed
  // it: router.ts's `void noteActivity()` runs BEFORE handle(message), when
  // isSessionUnlocked() is still false, so it returned early without arming
  // -- the alarm only ever got armed because App.tsx's handleUnlocked happens
  // to send a follow-up session.status. That made EXT-03's security control
  // depend on an incidental UI round trip: any unlock without one (the popup
  // closing on the unlock click, a future options-page/auto-unlock caller,
  // handleUnlocked early-returning) left the vault unlocked with NO alarm at
  // all until the next message or a browser restart.
  //
  // Safe against the session.setAutoLockMinutes race documented at
  // router.ts:66-72, and does NOT double-arm: that guard is about
  // noteActivity() reading a PRE-change interval, whereas this call uses the
  // interval it is itself writing to session-meta immediately above. The
  // setAutoLockMinutes handler remains the sole authority for INTERVAL
  // CHANGES -- it never routes through here (router.test.ts pins both).
  await armAutoLock(idleTimeoutMinutes);

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
 * AUTH-04: a full sign-out, distinct from lockVaultSession() above. In
 * order: (1) lockVaultSession() FIRST -- reuses its existing free-handle/
 * clearKeyEnvelope/notifyLockListeners/`session.locked`-broadcast side
 * effects, which is ALSO what triggers vault-store.ts's
 * subscribeSessionLockState listener to stop sync and clear the in-memory
 * item cache the instant `currentUserKey` becomes null (RESEARCH.md
 * already confirms no new code is needed for that layer -- not duplicated
 * here). (2) THEN best-effort calls auth-api.ts's logout() -- a rejection
 * is swallowed (mirrors lockVaultSession's own `.catch(() => {})`
 * best-effort shape above), since a failed/already-invalid token
 * revocation must never block the local teardown (T-15-06, this plan's
 * must_haves.prohibitions). This call MUST run while the OLD server config
 * is STILL the persisted one (its underlying apiFetch reads
 * readServerConfig() fresh on every call) -- the CALLER (Plan 15-05) is
 * responsible for invoking signOutVaultSession() strictly BEFORE any
 * configureServer(newUrl) call; signOutVaultSession() itself performs no
 * server-URL mutation. (3) THEN clearSessionMeta() UNCONDITIONALLY,
 * regardless of whether step (2) succeeded -- the "no stranded state"
 * requirement (T-15-06): a partial failure can never leave the key
 * envelope cleared but session-meta intact, or vice versa.
 */
export async function signOutVaultSession(): Promise<void> {
  await lockVaultSession();

  try {
    await logout();
  } catch {
    // Best-effort: an already-invalid/expired token, a network error, or a
    // server that has since gone away must never strand the user signed
    // into a vault they believe they left (T-15-05/T-15-06). Local
    // teardown proceeds unconditionally below.
  }

  await clearSessionMeta();
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
