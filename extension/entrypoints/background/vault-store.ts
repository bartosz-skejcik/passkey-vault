// entrypoints/background/vault-store.ts — background-only decrypted
// item/folder cache; the ONE place plaintext vault data is held in this
// extension outside pv-wasm's own memory (T-09-18). Ported from
// web/src/lib/vault/store.ts's decrypt/merge logic (lines 146-204 there)
// -- same wholesale-replace merge, same re-check-getUnlockedUserKey()-
// before-decrypt guard -- wired to Plan 09-02's vault-session.ts lock
// state (subscribeSessionLockState/isSessionUnlocked) instead of
// web's lib/crypto/index.ts.
//
// Plan 11-03 adds the write-path counterpart (splitCombinedEncryptedItem,
// RevisionConflictError, isConflictError) this file was deliberately
// missing under Phase 9's CONTEXT.md read-only boundary -- required for
// Generate & Capture's encrypt-then-persist flow (capture-handler.ts).
// Full CRUD (createVaultItem/updateVaultItem/deleteVaultItem as in-memory-
// cache-mutating wrappers) is still NOT ported here: capture-handler.ts
// calls vault-api.ts's createItem/updateItem directly and lets the next
// sync pull (vault-store.ts's own applySyncSnapshot, already wired) pick up
// the new/changed item into this cache, rather than duplicating a second
// optimistic-update path.
//
// Pitfall 4 / T-09-18: locking the vault stops sync BEFORE clearing the
// in-memory decrypted cache, in that exact order -- a stale sync callback
// must never be able to repopulate the cache after it's supposed to be
// empty. Verified by vault-store.test.ts's Test 4 (asserts call ORDER via
// mock invocation timing, not just final state).
import { browser } from "wxt/browser";
import { decryptItem, type WasmUserKey } from "../../lib/crypto/wasm-loader";
import { getUnlockedUserKey, isSessionUnlocked, subscribeSessionLockState } from "./vault-session";
import { startSync, stopSync } from "./sync-client";
import { getSyncSnapshot, touchItem, type FolderRow, type ItemRow, type SyncSnapshot } from "./vault-api";
import { normalizeItemFields, type Folder, type ItemFields, type VaultItem } from "../../lib/vault/types";
import type { Message } from "../../lib/messaging/ext-protocol";

/** Combined JSON shape decryptItem expects: `{"enc_key": ..., "enc_data": ...}`.
 * The server stores these as two separate opaque-string columns -- this
 * module is the sole bridge between the two shapes on the read path
 * (mirrors store.ts's recombineEncryptedItem; only the read direction is
 * needed this phase, no split/write-path counterpart). */
interface CombinedEncryptedItem {
  enc_key: unknown;
  enc_data: unknown;
}

function recombineEncryptedItem(encKey: string, encData: string): string {
  const combined: CombinedEncryptedItem = {
    enc_key: JSON.parse(encKey) as unknown,
    enc_data: JSON.parse(encData) as unknown,
  };
  return JSON.stringify(combined);
}

/** Inverse of recombineEncryptedItem: splits encryptItem's combined output
 * back into its two enc_key/enc_data sub-objects, each re-stringified for
 * the wire (server columns are opaque strings, not nested JSON). Ported
 * verbatim from web/src/lib/vault/store.ts's splitCombinedEncryptedItem. */
export function splitCombinedEncryptedItem(combinedJson: string): {
  encKey: string;
  encData: string;
} {
  const combined = JSON.parse(combinedJson) as CombinedEncryptedItem;
  return {
    encKey: JSON.stringify(combined.enc_key),
    encData: JSON.stringify(combined.enc_data),
  };
}

/** Distinguishable error type for a stale-revision (409) PUT -- lets
 * capture-handler.ts's confirmUpdateLogin tell "the item changed elsewhere"
 * apart from any other failure instead of silently overwriting. Ported
 * verbatim from web/src/lib/vault/store.ts's RevisionConflictError. */
export class RevisionConflictError extends Error {
  constructor() {
    super("item revision changed elsewhere — refresh and try again");
    this.name = "RevisionConflictError";
  }
}

// Deliberately NOT an `instanceof ApiClientError` check here -- ported
// verbatim from web/src/lib/vault/store.ts's own isConflictError, whose
// header comment explains why: this module is dynamically re-imported per
// test via vi.resetModules() in some suites, which would make a
// statically-imported ApiClientError class reference a DIFFERENT class
// object than what a test's mock rejection constructs, silently breaking
// `instanceof`. A structural (duck-typed) status check is immune to that.
export function isConflictError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 409
  );
}

let items: VaultItem[] = [];
let folders: Folder[] = [];
// Last vault_revision this client has merged -- the `since` watermark for
// every catch-up/poll pull. Reset to 0 on lock so a re-unlock always pulls
// a full snapshot again.
let lastKnownRevision = 0;
const listeners = new Set<() => void>();

/** Notifies subscribeVaultStore listeners AND fires a lightweight
 * cross-context broadcast so an open popup can react to the update. The
 * "no receiver" rejection (fired whenever no popup is currently open) is
 * expected, not an error -- swallowed here so it never surfaces as an
 * unhandled rejection. */
function notifyListeners(): void {
  listeners.forEach((listener) => listener());
  void browser.runtime.sendMessage({ kind: "vault.updated" } satisfies Message).catch(() => {});
}

export function getItems(): VaultItem[] {
  return items;
}

export function getFolders(): Folder[] {
  return folders;
}

/** For a future popup push-update wire (Plan 09-06). */
export function subscribeVaultStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Fire-and-forget "this item's secret was just used" signal (NordPass-style
 * last-used tracking, quick-260717) -- the SINGLE choke-point every
 * fill/TOTP-code/passkey-ceremony/popup-copy call site in this extension
 * must go through; never call `touchItem` from `./vault-api` directly.
 * Never awaited by callers: a failed/offline touch must NEVER break or
 * delay the fill/copy/ceremony it accompanies (catch + debug-log only, no
 * error surfaced to the caller). Never call this for mere viewing/listing
 * -- only when a fill/copy/ceremony actually surfaces the item's secret
 * value.
 *
 * On success, optimistically updates the in-memory item's `lastUsedAt` and
 * notifies listeners (same broadcast `notifyListeners()` every other
 * mutation here uses), so an open popup's "Wszystkie" sort reflects the
 * touch immediately -- other devices pick up the new value on their next
 * pull/snapshot (no dedicated WS `SyncEvent` is broadcast for a touch; see
 * crates/pv-server/src/routes/vault.rs's `touch()` doc comment for why).
 */
export function touchVaultItem(id: string): void {
  void touchItem(id)
    .then((res) => {
      const existingIndex = items.findIndex((item) => item.id === id);
      if (existingIndex === -1) return;
      items = items.map((item, index) =>
        index === existingIndex ? { ...item, lastUsedAt: res.last_used_at } : item,
      );
      notifyListeners();
    })
    .catch((err) => {
      console.debug("[passkey-vault] touchVaultItem failed (non-fatal, fire-and-forget)", id, err);
    });
}

function decryptItemRow(row: ItemRow, uk: WasmUserKey): VaultItem {
  const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
  const plaintext = decryptItem(uk, combined, row.id, row.revision);
  // normalizeItemFields migrates a legacy login item's bare `url: string`
  // into `urls: string[]` -- the only place that legacy shape is ever read.
  const fields = normalizeItemFields(JSON.parse(plaintext) as ItemFields);
  return {
    id: row.id,
    revision: row.revision,
    fields,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
  };
}

function decryptFolderRow(row: FolderRow, uk: WasmUserKey): Folder {
  // Folders store one enc_name column matching encryptItem's single
  // combined-JSON output exactly -- no split/recombine needed here, unlike
  // items (which have two separate wire columns).
  const plaintext = decryptItem(uk, row.enc_name, row.id, 1);
  const { name } = JSON.parse(plaintext) as { name: string };
  return { id: row.id, name };
}

/** The ONE merge implementation shared by initial load (unlock) and
 * ongoing background sync (WS/poll via sync-client.ts). A stale snapshot's
 * items/folders arrays replace the in-memory arrays WHOLESALE -- a
 * server-side deletion is reflected simply by the deleted id's absence
 * from the new array (no tombstones, no diff pass; the locked v0.1 full-
 * snapshot decision, unchanged). An up-to-date snapshot (no items/folders
 * keys) leaves the in-memory state completely untouched -- but still
 * advances the revision watermark, otherwise the NEXT poll tick would
 * immediately re-detect "stale" against a revision the client already
 * knows about. */
export function applySyncSnapshot(snapshot: SyncSnapshot): void {
  lastKnownRevision = snapshot.revision;
  // Re-check unlock state -- a lock event may have fired while the fetch
  // was in flight, and we must never decrypt with a stale/freed key handle
  // or repopulate state after the user has since locked (T-09-19).
  const uk = getUnlockedUserKey();
  if (uk === null) {
    return;
  }
  // BUG-3: a single wrong-key/corrupt row must never abort hydration of
  // the rest of the vault -- decryptItemRow/decryptFolderRow THROW on
  // failure, so each row is decrypted inside its own try/catch and skipped
  // (counted + a single console.warn) rather than letting Array.prototype.map
  // propagate the first row's exception and drop every item after it.
  if (snapshot.items !== undefined) {
    let skipped = 0;
    const decrypted: VaultItem[] = [];
    for (const row of snapshot.items) {
      try {
        decrypted.push(decryptItemRow(row, uk));
      } catch {
        skipped += 1;
      }
    }
    if (skipped > 0) {
      console.warn(`[passkey-vault] skipped ${skipped} undecryptable item(s) during sync`);
    }
    items = decrypted;
    notifyListeners();
  }
  if (snapshot.folders !== undefined) {
    let skipped = 0;
    const decrypted: Folder[] = [];
    for (const row of snapshot.folders) {
      try {
        decrypted.push(decryptFolderRow(row, uk));
      } catch {
        skipped += 1;
      }
    }
    if (skipped > 0) {
      console.warn(`[passkey-vault] skipped ${skipped} undecryptable folder(s) during sync`);
    }
    folders = decrypted;
    notifyListeners();
  }
}

// Post-UAT fix: a fresh MV3 service worker that wakes with the session
// ALREADY unlocked (rehydrated from chrome.storage.session -- see
// background.ts's own wake-path comment) never fires a lock->unlock
// TRANSITION, so the subscription below alone never runs startSync/the
// initial pull, and the popup shows an empty vault until some unrelated
// vault.updated broadcast happens to repopulate it (found by the
// real-browser Phase 9 UAT). `syncStarted` guards against double-starting
// when BOTH the wake path calls this directly AND a genuine transition
// fires moments later (startSync() is itself idempotent -- see
// sync-client.ts -- but the redundant getSyncSnapshot(0) pull below is
// not, so the flag is still needed here).
let syncStarted = false;

// WR-03 (11-REVIEW.md, iteration 2): tracks the CURRENT unlock session's
// initial getSyncSnapshot(0) pull so `ensureItemsHydrated()` below can
// actually AWAIT it, instead of the iteration-1 fix's cosmetic
// `ensureHydrated()` call which only re-derives the User Key and never
// touches this promise at all. Reset to `null` on every lock (alongside
// `syncStarted`/`lastKnownRevision`) so a re-unlock always waits on a NEW
// pull -- never a stale promise from a previous session (T-09-19).
let initialPullSettled: Promise<{ ok: true } | { ok: false; error: unknown }> | null = null;

/**
 * Idempotent. Starts the sync transport + the initial getSyncSnapshot(0)
 * pull IF the session is unlocked and sync isn't already running; a no-op
 * otherwise (including on every call after the first while still
 * unlocked). The ONE implementation shared by the lock-state subscription
 * below (real unlock transition) and background.ts's wake path (an
 * already-unlocked wake with no transition to react to).
 */
export function ensureVaultSyncStarted(): void {
  if (syncStarted || !isSessionUnlocked()) {
    return;
  }
  syncStarted = true;
  startSync({ getSinceRevision: () => lastKnownRevision, onSnapshot: applySyncSnapshot });
  // The `.catch` below still swallows the rejection (so the initial pull's
  // own failure never becomes an unhandled promise rejection in the
  // service worker -- unchanged behavior), but now converts it into a
  // TYPED `{ok:false}` result on `initialPullSettled` instead of silently
  // discarding it, so `ensureItemsHydrated()` callers can tell "the pull
  // failed, cache state is unknown" apart from "the pull succeeded, cache
  // reflects the server" (WR-03, iteration 2).
  initialPullSettled = getSyncSnapshot(0)
    .then((snapshot) => {
      applySyncSnapshot(snapshot);
      return { ok: true as const };
    })
    .catch((e: unknown) => {
      console.warn("[passkey-vault] initial sync pull failed", e);
      return { ok: false as const, error: e };
    });
}

/**
 * WR-03 (11-REVIEW.md, iteration 2): the actual fix for the cosmetic
 * iteration-1 `ensureHydrated()`-before-`getItems()` pattern in
 * `capture.propose` (router.ts). Callers MUST call `ensureHydrated()`
 * FIRST to establish a valid User Key -- this function only concerns
 * itself with the ITEM CACHE, not the key.
 *
 * Kicks off `ensureVaultSyncStarted()` (idempotent, safe to call every
 * time) and returns a promise that resolves once the CURRENT unlock
 * session's initial `getSyncSnapshot(0)` pull has settled:
 *  - `{ ok: true }` once `items`/`folders` reflect the server -- including
 *    the legitimate case of an up-to-date, genuinely empty vault (no
 *    `items`/`folders` key on the snapshot still counts as "hydrated",
 *    exactly like `applySyncSnapshot`'s own no-op-but-advance-watermark
 *    branch).
 *  - `{ ok: false, error }` if the pull itself failed (network/auth
 *    error). Callers MUST treat this as "cache state unknown", never as
 *    "cache is confirmed empty" -- classifying a `capture.propose` against
 *    an empty cache in this branch would reproduce the exact
 *    misclassify-as-'new'-then-duplicate defect WR-03 was filed to close.
 *
 * Single-flight and idempotent: if sync has already started (this call or
 * an earlier one, this session), every caller shares the SAME
 * `initialPullSettled` promise -- a burst of concurrent `capture.propose`
 * calls during the SW-wake window triggers exactly one
 * `getSyncSnapshot(0)` request, not one per caller.
 *
 * If the session is not unlocked (`ensureVaultSyncStarted()` no-ops and
 * `initialPullSettled` is still `null`), resolves `{ ok: true }`
 * vacuously -- there is nothing to hydrate, and the locked case is what
 * the caller's own `ensureHydrated() === null` check upstream already
 * gates on.
 */
export function ensureItemsHydrated(): Promise<{ ok: true } | { ok: false; error: unknown }> {
  ensureVaultSyncStarted();
  if (initialPullSettled === null) {
    return Promise.resolve({ ok: true });
  }
  return initialPullSettled;
}

// Module-level side effect (mirrors web/src/lib/vault/store.ts's own
// subscribeLockState side effect): unlocking the vault starts the sync
// transport AND triggers an immediate getSyncSnapshot(0) pull (instant
// data without waiting for the WS handshake); locking stops the transport
// FIRST -- so no in-flight sync callback can fire after the arrays are
// cleared -- THEN resets the revision watermark and clears both in-memory
// arrays (Pitfall 4 / T-09-18, verified by vault-store.test.ts's Test 4
// call-order assertion).
subscribeSessionLockState(() => {
  if (isSessionUnlocked()) {
    ensureVaultSyncStarted();
  } else {
    syncStarted = false; // re-arm the guard for the NEXT unlock
    initialPullSettled = null; // WR-03 (iteration 2): a re-unlock must await a NEW pull
    stopSync(); // MUST run before the array-clear below
    lastKnownRevision = 0;
    items = [];
    folders = [];
    notifyListeners();
  }
});
