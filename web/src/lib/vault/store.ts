// Vault item/folder store — module-level singleton (same pattern family as
// lib/crypto/index.ts's `ready` promise and lock-state singleton). Holds
// the ONLY in-memory copy of decrypted vault data. Unlocking the vault
// (re-)fetches and decrypts everything; locking clears it immediately, so
// no stale plaintext survives a lock event (T-02-19).
import { useSyncExternalStore } from "react";
import {
  decryptItem,
  encryptItem,
  getUnlockedUserKey,
  isUnlocked,
  subscribeLockState,
  type WasmUserKey,
} from "@/lib/crypto";
// Deliberately NOT importing ApiClientError for an `instanceof` check here:
// this module is dynamically re-imported per-test via `vi.resetModules()` +
// `await import("./store")` (see store.test.ts), which re-evaluates every
// statically-imported module — including @/lib/auth/api — under a fresh
// module instance each time. A statically-imported `ApiClientError` class
// reference bound at this file's top level would then be a *different*
// class object than the one a test constructs its mock rejection with,
// making `instanceof` silently false. A structural (duck-typed) status
// check below is immune to that module-identity mismatch.
function isConflictError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 409
  );
}
import {
  createFolder,
  createItem,
  deleteFolder,
  deleteItem,
  getSyncSnapshot,
  touchItem,
  updateItem,
  type FolderRow,
  type ItemRow,
  type SyncSnapshot,
} from "./api";
import { startSync, stopSync, type SyncCallbacks } from "./sync";
import { normalizeItemFields, type Folder, type ItemFields, type VaultItem } from "./types";

/** Distinguishable error type for a stale-revision (409) PUT — lets the UI
 * layer (DetailPanel) tell "the item changed elsewhere" apart from any other
 * failure and show T-02-22's clear conflict message instead of silently
 * overwriting or discarding the user's edit. `lastEditorEmail` (Plan 23-05,
 * SYNC-06) is populated only for a SHARED item's conflict, sourced from the
 * 409 response body's `last_editor_email` — `undefined` for a personal
 * item's conflict (that body has no such key at all), so a personal-item
 * conflict's UI copy never mentions an email. */
export class RevisionConflictError extends Error {
  readonly lastEditorEmail?: string;

  constructor(lastEditorEmail?: string) {
    super("item revision changed elsewhere — refresh and try again");
    this.name = "RevisionConflictError";
    this.lastEditorEmail = lastEditorEmail;
  }
}

/** CR-03 (code review iteration 1): thrown by `updateVaultItem` when the
 * in-memory item is flagged `undecryptable` (a background sync merge's
 * server row failed to decrypt, and this is the retained last-known-good
 * copy — see `applySyncSnapshot`'s doc comment). Its `revision` is known
 * STALE relative to the server, so saving over it with a caller-supplied
 * `expected_revision` would either silently 409 forever or, worse, race a
 * revision the server has since moved past for reasons the client cannot
 * verify. Defense in depth alongside `DetailPanel` hiding the Edit
 * affordance for a flagged item entirely. */
export class UndecryptableItemError extends Error {
  constructor() {
    super("this item failed to decrypt during the last sync -- refresh before making changes");
    this.name = "UndecryptableItemError";
  }
}

/** Combined JSON shape encryptItem produces / decryptItem expects:
 * `{"enc_key": WrappedKey, "enc_data": WrappedKey}`. The server instead
 * stores these as two separate opaque-string columns — this module is the
 * sole bridge between the two shapes. */
interface CombinedEncryptedItem {
  enc_key: unknown;
  enc_data: unknown;
}

/** Recombines a server row's separate enc_key/enc_data strings into the
 * single combined JSON string decryptItem expects. */
function recombineEncryptedItem(encKey: string, encData: string): string {
  const combined: CombinedEncryptedItem = {
    enc_key: JSON.parse(encKey) as unknown,
    enc_data: JSON.parse(encData) as unknown,
  };
  return JSON.stringify(combined);
}

/** Inverse of recombineEncryptedItem: splits encryptItem's combined output
 * back into its two enc_key/enc_data sub-objects, each re-stringified for
 * the wire (server columns are opaque strings, not nested JSON). */
function splitCombinedEncryptedItem(combinedJson: string): {
  encKey: string;
  encData: string;
} {
  const combined = JSON.parse(combinedJson) as CombinedEncryptedItem;
  return {
    encKey: JSON.stringify(combined.enc_key),
    encData: JSON.stringify(combined.enc_data),
  };
}

let items: VaultItem[] = [];
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

export function getItems(): VaultItem[] {
  return items;
}

export function subscribeItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let folders: Folder[] = [];
const folderListeners = new Set<() => void>();

function notifyFolderListeners(): void {
  folderListeners.forEach((listener) => listener());
}

export function getFolders(): Folder[] {
  return folders;
}

export function subscribeFolders(listener: () => void): () => void {
  folderListeners.add(listener);
  return () => {
    folderListeners.delete(listener);
  };
}

// `useAllTags()` needs a stable snapshot reference (useSyncExternalStore
// requires getSnapshot to return the same reference across calls unless
// the underlying data actually changed) — recomputed only when `items`
// itself is reassigned, not on every render.
let allTags: string[] = [];

function recomputeAllTags(): void {
  const tagSet = new Set<string>();
  for (const item of items) {
    for (const tag of item.fields.tags) {
      tagSet.add(tag);
    }
  }
  allTags = Array.from(tagSet).sort();
}

export function getAllTags(): string[] {
  return allTags;
}

function decryptItemRow(row: ItemRow, uk: WasmUserKey): VaultItem {
  const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
  const plaintext = decryptItem(uk, combined, row.id, row.revision);
  // normalizeItemFields migrates a legacy login item's bare `url: string`
  // into `urls: string[]` — the only place that legacy shape is ever read.
  const fields = normalizeItemFields(JSON.parse(plaintext) as ItemFields);
  return {
    id: row.id,
    revision: row.revision,
    fields,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    isShared: row.is_shared,
    lastEditorEmail: row.last_editor_email ?? undefined,
  };
}

function decryptFolderRow(row: FolderRow, uk: WasmUserKey): Folder {
  // Folders store one `enc_name` column matching encryptItem's single
  // combined-JSON output exactly — no split/recombine needed here, unlike
  // items (which have two separate wire columns).
  const plaintext = decryptItem(uk, row.enc_name, row.id, 1);
  const { name } = JSON.parse(plaintext) as { name: string };
  return { id: row.id, name };
}

// Last vault_revision this client has merged — the `since` watermark for
// every catch-up/poll pull. Reset to 0 on lock so a re-unlock always pulls
// a full snapshot again.
let lastKnownRevision = 0;

/** The ONE merge implementation shared by initial load (unlock) and
 * ongoing background sync (WS/poll via sync.ts). A stale snapshot's
 * items/folders arrays replace the in-memory arrays WHOLESALE — a
 * server-side deletion is reflected simply by the deleted id's absence
 * from the new array (no tombstones, no diff pass; the locked full-
 * snapshot decision). An up-to-date snapshot (no items/folders keys)
 * leaves the in-memory state completely untouched — but still advances
 * the revision watermark, otherwise the NEXT poll tick would immediately
 * re-detect "stale" against a revision the client already knows about.
 *
 * CR-03 (code review iteration 1): the decrypt-failure fallback below no
 * longer pretends the merge fully succeeded. Previously `lastKnownRevision`
 * was assigned UNCONDITIONALLY, before any row was even attempted, so a
 * client whose every row failed to decrypt still recorded itself as caught
 * up — the failure was never retried, and the retained fallback copy's
 * STALE revision then 409'd every subsequent save forever (the 409 handler
 * re-runs this exact same merge, which fails the exact same way). The
 * AEAD's authentication tag is bound to `(item_id, revision)` — a server
 * substituting or replaying ciphertext produces exactly this failure mode,
 * so silently discarding it defeats the one integrity signal a
 * zero-knowledge vault has to offer. The watermark now only advances when
 * EVERY row in the snapshot decrypted successfully; a failing row's
 * retained last-known-good copy is flagged `undecryptable: true` so
 * `updateVaultItem` can refuse to save over its now-untrustworthy revision
 * and the UI layer can surface the integrity warning (`DetailPanel`). */
function applySyncSnapshot(snapshot: SyncSnapshot): void {
  // Re-check unlock state — a lock event may have fired while the fetch
  // was in flight, and we must never decrypt with a stale/freed key
  // handle or repopulate state after the user has since locked.
  const uk = getUnlockedUserKey();
  if (uk === null) {
    return;
  }
  let anyRowFailed = false;
  if (snapshot.items !== undefined) {
    // A single row that fails to decrypt (corrupted blob, a stale/foreign
    // ciphertext, ...) must never crash the WHOLE snapshot merge — this is
    // exactly the recovery path `updateVaultItem`'s 409 handler calls (via
    // `loadAndDecryptAll`) immediately after a revision conflict, so an
    // uncaught throw here would silently replace the `RevisionConflictError`
    // the UI layer needs with an unrelated decrypt exception, and the
    // conflict the user just hit would go unexplained. Falling back to the
    // LAST-KNOWN-GOOD copy (rather than dropping the row entirely) also
    // keeps a currently-open item present in the store — dropping it would
    // make `selectedItem` resolve to `undefined` and unmount the very
    // DetailPanel that needs to show the conflict banner.
    const previousById = new Map(items.map((item) => [item.id, item]));
    items = snapshot.items.flatMap((row): VaultItem[] => {
      try {
        // A row that decrypts cleanly is never `undecryptable` — explicit
        // `false` (not merely omitted) covers the case where a PREVIOUS
        // merge had flagged this same id and a later one recovers.
        return [{ ...decryptItemRow(row, uk), undecryptable: false }];
      } catch (err) {
        anyRowFailed = true;
        console.error(`pv: failed to decrypt item ${row.id} during sync merge -- keeping last-known-good copy`, err);
        const previous = previousById.get(row.id);
        return previous !== undefined ? [{ ...previous, undecryptable: true }] : [];
      }
    });
    recomputeAllTags();
    notifyListeners();
  }
  if (snapshot.folders !== undefined) {
    const previousFolderById = new Map(folders.map((folder) => [folder.id, folder]));
    folders = snapshot.folders.flatMap((row): Folder[] => {
      try {
        return [{ ...decryptFolderRow(row, uk), undecryptable: false }];
      } catch (err) {
        anyRowFailed = true;
        console.error(`pv: failed to decrypt folder ${row.id} during sync merge -- keeping last-known-good copy`, err);
        const previous = previousFolderById.get(row.id);
        return previous !== undefined ? [{ ...previous, undecryptable: true }] : [];
      }
    });
    notifyFolderListeners();
  }
  // Only advance the watermark when the WHOLE snapshot actually applied —
  // otherwise the next poll must re-fetch and retry rather than believing
  // itself caught up on a revision it never actually merged.
  if (!anyRowFailed) {
    lastKnownRevision = snapshot.revision;
  }
}

async function loadAndDecryptAll(): Promise<void> {
  // since=0 unconditionally: a fresh/never-synced client always receives a
  // full snapshot (a brand-new zero-item account gets an up-to-date-with-
  // no-items response, which is equally correct — nothing to load).
  const snapshot = await getSyncSnapshot(0);
  applySyncSnapshot(snapshot);
}

export async function createVaultItem(fields: ItemFields): Promise<VaultItem> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot create an item while the vault is locked");
  }
  const id = crypto.randomUUID();
  const plaintext = JSON.stringify(fields);
  const combined = encryptItem(uk, plaintext, id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const created = await createItem(id, encKey, encData);
  const item: VaultItem = { id, revision: 1, fields, updatedAt: created.updated_at };
  items = [...items, item];
  recomputeAllTags();
  notifyListeners();
  return item;
}

export async function createVaultFolder(name: string): Promise<Folder> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot create a folder while the vault is locked");
  }
  const id = crypto.randomUUID();
  const encName = encryptItem(uk, JSON.stringify({ name }), id, 1);
  await createFolder(encName);
  const folder: Folder = { id, name };
  folders = [...folders, folder];
  notifyFolderListeners();
  return folder;
}

/** Success-gated removal (mirrors deleteVaultItem below): a failed delete
 * leaves the folder visible in `folders`/`useFolders()`. */
export async function deleteVaultFolder(id: string): Promise<void> {
  await deleteFolder(id);
  folders = folders.filter((folder) => folder.id !== id);
  notifyFolderListeners();
}

/**
 * Re-encrypts `fields` with AD revision `currentRevision + 1` — the value
 * the server (Plan 02-03) independently increments to on a successful PUT,
 * so both sides agree on the new revision without a second round trip. On
 * a 409 (stale revision): the in-memory item is left untouched (never
 * optimistically overwritten), truth is re-fetched via
 * loadAndDecryptAll(), and a RevisionConflictError is thrown for the UI
 * layer to catch and message (T-02-22).
 */
export async function updateVaultItem(
  id: string,
  fields: ItemFields,
  currentRevision: number,
): Promise<VaultItem> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot update an item while the vault is locked");
  }
  // CR-03: refuse to save over an item whose current in-memory copy is
  // known-stale (a decrypt failure during the last sync merge) — see
  // UndecryptableItemError's own doc comment.
  const existingBeforeSave = items.find((item) => item.id === id);
  if (existingBeforeSave?.undecryptable === true) {
    throw new UndecryptableItemError();
  }
  const newRevision = currentRevision + 1;
  const plaintext = JSON.stringify(fields);
  const combined = encryptItem(uk, plaintext, id, newRevision);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  let response: { revision: number; updated_at: string };
  try {
    response = await updateItem(id, encKey, encData, currentRevision);
  } catch (err) {
    if (isConflictError(err)) {
      await loadAndDecryptAll();
      // The 409 body's full parsed JSON was carried onto ApiClientError as
      // `details` (Plan 23-05) — a shared item's conflict carries
      // `last_editor_email`, a personal item's does not (the key is absent
      // entirely, never null-vs-undefined ambiguity to resolve here since
      // both `null`/absent normalize to `undefined`).
      const details = (err as { details?: { last_editor_email?: string | null } }).details;
      const lastEditorEmail = details?.last_editor_email ?? undefined;
      throw new RevisionConflictError(lastEditorEmail);
    }
    throw err;
  }
  const existingIndex = items.findIndex((item) => item.id === id);
  const existing = existingIndex === -1 ? undefined : items[existingIndex];
  // `update()`'s server route (crates/pv-server/src/routes/vault.rs) never
  // touches `last_used_at` — carry the existing item's value forward
  // explicitly, otherwise an edit-save would silently wipe out this item's
  // last-used timestamp (Rule 1: this would be a real regression, since
  // nothing about "last used" changed just because content was edited).
  //
  // WR-02 (code review iteration 1): `isShared`/`lastEditorEmail` (Phase 23)
  // must be carried forward the SAME way — this handler's own response body
  // has neither field (the server route returns only `{revision,
  // updated_at}`), so dropping them here made `item.isShared` become
  // `undefined` immediately after ANY save of a shared item, right up until
  // the next background snapshot repopulated it. `DetailPanel`'s live-
  // conflict attribution reads `item.isShared && item.lastEditorEmail`
  // together, so this silently fell back to the generic (non-attributed)
  // copy in exactly the window a shared item is most likely to conflict —
  // immediately after this same user's own save.
  const updated: VaultItem = {
    id,
    revision: newRevision,
    fields,
    updatedAt: response.updated_at,
    lastUsedAt: existing?.lastUsedAt,
    isShared: existing?.isShared,
    lastEditorEmail: existing?.lastEditorEmail,
  };
  items =
    existingIndex === -1
      ? [...items, updated]
      : items.map((item, index) => (index === existingIndex ? updated : item));
  recomputeAllTags();
  notifyListeners();
  return updated;
}

/** Removes the item from the in-memory store only after the API call
 * succeeds — a failed delete leaves the item visible (T-02-23). */
export async function deleteVaultItem(id: string): Promise<void> {
  await deleteItem(id);
  items = items.filter((item) => item.id !== id);
  recomputeAllTags();
  notifyListeners();
}

/**
 * Fire-and-forget "this item's secret was just used" signal (NordPass-style
 * last-used tracking, quick-260717). This is the SINGLE choke-point every
 * copy/reveal/autofill/ceremony call site must go through — never call
 * `touchItem` from `./api` directly from a component. Never awaited by
 * callers: a failed/offline touch must NEVER break or delay the
 * reveal/copy/fill it accompanies (catch + debug-log only, no error
 * surfaced to the UI). Never call this for mere viewing/listing — only when
 * a copy/reveal/fill/ceremony actually surfaces the item's secret value.
 *
 * On success, optimistically updates the in-memory item's `lastUsedAt` so
 * a "last used" sort reflects the action immediately in THIS tab/session —
 * other tabs/devices pick up the new value on their next pull/snapshot (no
 * dedicated WS `SyncEvent` is broadcast for a touch; see
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
      // eslint-disable-next-line no-console
      console.debug("touchVaultItem failed (non-fatal, fire-and-forget)", id, err);
    });
}

// useSyncExternalStore wymaga, by getServerSnapshot zwracał tę samą
// referencję przy każdym wywołaniu — inline `() => []` tworzy nową tablicę
// i React zgłasza "should be cached to avoid an infinite loop".
const EMPTY_SNAPSHOT: never[] = [];
const getEmptySnapshot = () => EMPTY_SNAPSHOT;

export function useVaultItems(): VaultItem[] {
  return useSyncExternalStore(subscribeItems, getItems, getEmptySnapshot);
}

export function useFolders(): Folder[] {
  return useSyncExternalStore(subscribeFolders, getFolders, getEmptySnapshot);
}

export function useAllTags(): string[] {
  return useSyncExternalStore(subscribeItems, getAllTags, getEmptySnapshot);
}

// Module-level side effect (mirrors lib/crypto/index.ts's own singleton
// shape): unlocking the vault (re-)fetches and decrypts items/folders AND
// starts the sync transport (WS + poll); locking stops the transport FIRST
// (so no in-flight sync callback can fire after the arrays are cleared),
// then clears both in-memory arrays immediately.
const syncCallbacks: SyncCallbacks = {
  getSinceRevision: () => lastKnownRevision,
  onSnapshot: applySyncSnapshot,
};

subscribeLockState(() => {
  if (isUnlocked()) {
    void loadAndDecryptAll();
    startSync(syncCallbacks);
  } else {
    stopSync();
    lastKnownRevision = 0;
    items = [];
    folders = [];
    recomputeAllTags();
    notifyListeners();
    notifyFolderListeners();
  }
});
