// entrypoints/background/vault-store.ts — background-only decrypted
// item/folder cache; the ONE place plaintext vault data is held in this
// extension outside pv-wasm's own memory (T-09-18). Ported from
// web/src/lib/vault/store.ts's decrypt/merge logic (lines 146-204 there)
// -- same wholesale-replace merge, same re-check-getUnlockedUserKey()-
// before-decrypt guard -- wired to Plan 09-02's vault-session.ts lock
// state (subscribeSessionLockState/isSessionUnlocked) instead of
// web's lib/crypto/index.ts.
//
// CRUD (createVaultItem/updateVaultItem/deleteVaultItem/
// RevisionConflictError/splitCombinedEncryptedItem) is deliberately NOT
// ported -- read path only this phase (CONTEXT.md's locked out-of-scope
// boundary), same reasoning as Task 1's vault-api.ts.
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
import { getSyncSnapshot, type FolderRow, type ItemRow, type SyncSnapshot } from "./vault-api";
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

function decryptItemRow(row: ItemRow, uk: WasmUserKey): VaultItem {
  const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
  const plaintext = decryptItem(uk, combined, row.id, row.revision);
  // normalizeItemFields migrates a legacy login item's bare `url: string`
  // into `urls: string[]` -- the only place that legacy shape is ever read.
  const fields = normalizeItemFields(JSON.parse(plaintext) as ItemFields);
  return { id: row.id, revision: row.revision, fields, updatedAt: row.updated_at };
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
  if (snapshot.items !== undefined) {
    items = snapshot.items.map((row) => decryptItemRow(row, uk));
    notifyListeners();
  }
  if (snapshot.folders !== undefined) {
    folders = snapshot.folders.map((row) => decryptFolderRow(row, uk));
    notifyListeners();
  }
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
    startSync({ getSinceRevision: () => lastKnownRevision, onSnapshot: applySyncSnapshot });
    void getSyncSnapshot(0).then(applySyncSnapshot);
  } else {
    stopSync(); // MUST run before the array-clear below
    lastKnownRevision = 0;
    items = [];
    folders = [];
    notifyListeners();
  }
});
