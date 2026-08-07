// Vault item/folder store — module-level singleton (same pattern family as
// lib/crypto/index.ts's `ready` promise and lock-state singleton). Holds
// the ONLY in-memory copy of decrypted vault data. Unlocking the vault
// (re-)fetches and decrypts everything; locking clears it immediately, so
// no stale plaintext survives a lock event (T-02-19).
import { useSyncExternalStore } from "react";
import {
  decryptItem,
  decryptItemForCollection,
  decryptItemWithSharedKey,
  encryptItem,
  encryptItemForCollection,
  getUnlockedUserKey,
  isUnlocked,
  subscribeLockState,
  unsealCollectionKey,
  type WasmIdentityKey,
  type WasmUserKey,
} from "@/lib/crypto";
import { ensureOwnIdentityKeypair } from "@/lib/identity/ensure";
import {
  getCollectionAccessLevel,
  getCollectionKey,
  refreshCollectionsNow,
} from "@/lib/vault/collections";
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
  getCollectionSync,
  getSharedDirectSync,
  getSharedRevisions,
  getSyncSnapshot,
  touchItem,
  updateItem,
  type DirectSharedItemRow,
  type FolderRow,
  type ItemRow,
  type SharedCollectionItemsResponse,
  type SharedDirectSyncResponse,
  type SharedRevisions,
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

/** 26-05a (live data-corruption fix): thrown by `updateVaultItem` when a
 * collection-scoped item's Collection Key isn't cached yet (`getCollectionKey`
 * returns `undefined` -- collections.ts hasn't refreshed yet, or this
 * collection's `sealed_key` never resolved, e.g. sealed to a different
 * identity key). MUST fail the save loudly here rather than fall back to
 * encrypting under the caller's personal User Key -- a fallback would
 * silently re-encrypt a collection-scoped item's ciphertext under the wrong
 * key, and on the very next sync merge it becomes permanently undecryptable
 * via the collection path for every member, including whoever saved it (the
 * original deferred-items.md finding this fix closes). A failed save is
 * annoying and fully recoverable (retry once the key is cached); a silently
 * corrupted item is neither. */
export class CollectionKeyUnavailableError extends Error {
  constructor(collectionId: string) {
    super(
      `cannot save -- the encryption key for collection ${collectionId} is not available yet; wait a moment and try again`,
    );
    this.name = "CollectionKeyUnavailableError";
  }
}

/** 26-14-PLAN.md (WINDOWS #9's own read-path fix newly makes this item
 * REACHABLE at all -- it was previously invisible in `items` entirely):
 * thrown by `updateVaultItem` for an item that lives in `directSharedItems`
 * — a personal item OWNED BY SOMEONE ELSE, shared directly to this caller
 * via `item_shares`. This recipient's own crypto material (the item's raw
 * Cipher Key, `decryptItemWithSharedKey`'s read-only unseal) has no
 * corresponding ENCRYPT-side primitive yet — the owner's own personal User
 * Key (what `enc_key` is wrapped under) is not something this recipient
 * holds or can derive at all. Falling back to `encryptItem(uk, ...)` below
 * (this caller's OWN personal key) would silently write ciphertext under
 * the WRONG key entirely, permanently corrupting the item for its actual
 * owner on the very next server write — a real zero-knowledge-violating
 * data-loss bug, not merely a UX gap. Fails loud instead, mirroring
 * `CollectionKeyUnavailableError`'s own "never fall back to the wrong key"
 * discipline. Closing this for real (a genuine encrypt-as-recipient
 * primitive) is new pv-core/pv-wasm crypto surface, out of this
 * (client-store-only) plan's scope — logged as a deferred item. */
export class DirectShareNotEditableError extends Error {
  constructor(itemId: string) {
    super(
      `cannot save -- item ${itemId} was shared directly with you; editing a directly-shared item is not supported yet`,
    );
    this.name = "DirectShareNotEditableError";
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

// 26-14-PLAN.md (WINDOWS #8/#9): `items` (below) is a COMPUTED merge of
// three independent sources -- every read (`getItems()`, `useVaultItems()`,
// every `items.find`/`items.filter` lookup elsewhere in this module) sees
// the union, so an item this caller merely has ACCESS to (not necessarily
// created) is exactly as visible/editable as one they created. Local
// mutations (create/update/delete/touch) write through `replaceItemInSources`/
// `removeItemFromSources` below rather than reassigning `items` directly, so
// a later merge of any ONE source never silently reverts another source's
// data.
//
// - `personalItems`: `GET /api/sync`'s own scope (`fetch_items_for`,
//   UNCHANGED by this plan per its own approach guidance) -- every item the
//   CALLER owns, personal or created inside a collection they belong to.
// - `collectionSharedItems`: `GET /api/vault/collections/{id}/sync`
//   (`pull_shared_collection`) -- WINDOWS #8's fix. A SUPERSET of any
//   collection's items (every author, not just the caller's own) for every
//   collection the caller currently holds a `collection_keys` row for.
// - `directSharedItems`: `GET /api/sync/shared/direct` (`pull_shared_direct`)
//   -- WINDOWS #9's fix. Personal items OWNED BY SOMEONE ELSE, shared
//   directly to this caller via `item_shares`.
let personalItems: VaultItem[] = [];
let collectionSharedItems: VaultItem[] = [];
let directSharedItems: VaultItem[] = [];
let items: VaultItem[] = [];
const listeners = new Set<() => void>();

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

/** Rebuilds the public `items` merge from the three sources above and
 * notifies every subscriber -- the ONE place `items` is ever reassigned.
 * Later sources win an id collision (should not normally happen in
 * practice: a caller-owned collection item appears in BOTH `personalItems`
 * and `collectionSharedItems` with equivalent content once the latter has
 * refreshed; a directly-shared item is, by construction, never the
 * caller's own and never collection-scoped, so it never collides with
 * either of the other two). */
function recomputeItems(): void {
  const byId = new Map<string, VaultItem>();
  for (const item of personalItems) byId.set(item.id, item);
  for (const item of collectionSharedItems) byId.set(item.id, item);
  for (const item of directSharedItems) byId.set(item.id, item);
  items = Array.from(byId.values());
  recomputeAllTags();
  notifyListeners();
}

/** Writes `updated` into whichever of the three sources currently holds
 * `id` (all three are checked -- exactly one will actually match in
 * practice, the others are harmless no-ops). Falls back to `personalItems`
 * when `id` is present in none of them yet (mirrors `createVaultItem`'s own
 * always-personal-on-creation invariant, and covers the pre-existing
 * "unknown item saved anyway" edge case `updateVaultItem` has always
 * tolerated). Used by `updateVaultItem`/`touchVaultItem` -- both mutate an
 * EXISTING item found via the merged `items` view, so the source that
 * conceptually owns it must be updated in place, never the derived `items`
 * array directly (a later `recomputeItems()` from any one source would
 * otherwise silently revert the change). */
function replaceItemInSources(id: string, updated: VaultItem): void {
  let found = false;
  const replace = (list: VaultItem[]): VaultItem[] =>
    list.map((item) => {
      if (item.id !== id) return item;
      found = true;
      return updated;
    });
  personalItems = replace(personalItems);
  collectionSharedItems = replace(collectionSharedItems);
  directSharedItems = replace(directSharedItems);
  if (!found) {
    personalItems = [...personalItems, updated];
  }
  recomputeItems();
}

/** Removes `id` from all three sources (a failed delete never removes an
 * item locally -- callers only invoke this after the server call already
 * succeeded, mirroring the pre-existing `deleteVaultItem` contract). */
function removeItemFromSources(id: string): void {
  personalItems = personalItems.filter((item) => item.id !== id);
  collectionSharedItems = collectionSharedItems.filter((item) => item.id !== id);
  directSharedItems = directSharedItems.filter((item) => item.id !== id);
  recomputeItems();
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
    // WR-08 / WINDOWS #11: `?? []` rather than a bare dereference. This
    // function runs on EVERY store mutation -- sync merge, create, update
    // AND delete -- so one item whose `fields.tags` is not an array threw
    // `TypeError: fields.tags is not iterable` out of every one of them,
    // including delete, wedging the account with no UI path left to remove
    // the offending row (WINDOWS #10's live repro). `normalizeItemFields`
    // now guards every writer (below), but hardening the iteration itself
    // is the cheap half of the defense that does not depend on a single
    // choke point staying complete forever.
    for (const tag of item.fields.tags ?? []) {
      tagSet.add(tag);
    }
  }
  allTags = Array.from(tagSet).sort();
}

export function getAllTags(): string[] {
  return allTags;
}

/** Decrypts one row's `enc_key`/`enc_data` under the CORRECT key for its
 * scope — 26-05-PLAN.md's central architecture fix: a collection-scoped row
 * (`row.collection_id !== null`) is encrypted under that collection's own
 * CollectionKey with a scope-bound AAD (KEY-03), NOT under the caller's
 * personal UserKey. `getCollectionKey` (lib/vault/collections.ts, Task 1)
 * is looked up SYNCHRONOUSLY — if the collections store hasn't refreshed
 * yet (or this collection's sealed_key never resolved), this throws, which
 * `applySyncSnapshot`'s existing try/catch turns into the SAME
 * undecryptable-flagged, retained-last-known-good fallback every other
 * decrypt failure already uses — never a crash, and never a silent
 * wrong-key decrypt (AEAD authentication makes that structurally
 * impossible; see this plan's threat register T-26-11). */
function decryptItemRow(row: ItemRow, uk: WasmUserKey): VaultItem {
  const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
  let plaintext: string;
  if (row.collection_id === null) {
    plaintext = decryptItem(uk, combined, row.id, row.revision);
  } else {
    const ck = getCollectionKey(row.collection_id);
    if (ck === undefined) {
      throw new Error(
        `no cached Collection Key for collection ${row.collection_id} -- collections store has not refreshed yet`,
      );
    }
    plaintext = decryptItemForCollection(ck, combined, row.collection_id, row.id, row.revision);
  }
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
    collectionId: row.collection_id,
    // 26-VERIFICATION.md gap 1. `undefined` for a personal item -- its owner
    // holds `AccessLevel::Edit` unconditionally server-side
    // (`Item::resolve_access`'s personal branch), so there is no level to
    // carry. For a collection-scoped item the caller's `collection_keys`
    // level is the WHOLE story even for an item the caller CREATED:
    // `resolve_access` deliberately does NOT fold an ownership grant into
    // the collection branch (CR-01 iteration 2 -- folding it in would defeat
    // revocation), so a member holding `read`/`hidden_password` cannot edit
    // their own item in that folder either. Set here rather than only in
    // `mergeCollectionSnapshot` so the caller's OWN copy of such an item
    // (which also arrives via `GET /api/sync`, in `personalItems`) carries
    // the same level -- otherwise there is a window, before the collection
    // pull lands, where the same item renders as freely editable.
    accessLevel:
      row.collection_id === null ? undefined : getCollectionAccessLevel(row.collection_id),
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

// WR-01 (code review iteration 2): counts CONSECUTIVE merges where at least
// one row failed to decrypt. Withholding the watermark forever (iteration
// 1's fix) is correct for a TRANSIENT failure (worth retrying — the next
// poll/WS tick might see a corrected row) but wrong for a PERSISTENT one: an
// unbounded retry means every WS frame and every 30s poll re-downloads and
// re-decrypts the ENTIRE snapshot, forever, reassigning `items`/`folders`
// wholesale and re-rendering the whole list twice a minute with no recovery
// path — the review's exact "permanent full-snapshot re-download loop"
// finding. Reset to 0 on any fully-clean merge (see below) and on every
// startSync() (unlock) — see `syncCallbacks`'s own reset, mirroring
// `sync.ts`'s identical `sharedPullDisabled` re-arm-on-unlock rationale.
let failedMergeAttempts = 0;
const MAX_FAILED_MERGE_RETRIES = 3;

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
    // 26-14-PLAN.md: falls back against `personalItems`'s own previous copy
    // (this endpoint's own scope), not the merged `items` view — a
    // collection/direct-shared item's retained-last-known-good fallback is
    // `mergeCollectionSnapshot`/`mergeDirectSnapshot`'s own job below, each
    // scoped to its own source array.
    const previousById = new Map(personalItems.map((item) => [item.id, item]));
    personalItems = snapshot.items.flatMap((row): VaultItem[] => {
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
    recomputeItems();
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
  //
  // WR-01 (code review iteration 2): but only up to MAX_FAILED_MERGE_RETRIES
  // consecutive attempts — a decrypt failure caused by tampered/corrupted
  // ciphertext (rather than a transient race with an in-flight write) will
  // NEVER self-heal by retrying, and withholding the watermark unconditionally
  // turns a permanent failure into a permanent full-resync-every-poll loop
  // (see `failedMergeAttempts`'s own doc comment above). Once the retry
  // budget is exhausted, the watermark advances anyway so the poll/WS loop
  // stops hammering the server — every affected row stays flagged
  // `undecryptable: true` regardless (set in the `flatMap` above), so
  // `updateVaultItem`'s guard still refuses to save over it and the UI still
  // shows the integrity warning; this only stops the endless re-download,
  // it does not pretend the row is trustworthy again.
  if (!anyRowFailed) {
    failedMergeAttempts = 0;
    lastKnownRevision = snapshot.revision;
  } else {
    failedMergeAttempts += 1;
    if (failedMergeAttempts >= MAX_FAILED_MERGE_RETRIES) {
      lastKnownRevision = snapshot.revision;
    }
  }
}

async function loadAndDecryptAll(): Promise<void> {
  // since=0 unconditionally: a fresh/never-synced client always receives a
  // full snapshot (a brand-new zero-item account gets an up-to-date-with-
  // no-items response, which is equally correct — nothing to load).
  const snapshot = await getSyncSnapshot(0);
  applySyncSnapshot(snapshot);
}

// 26-14-PLAN.md (WINDOWS #8): per-collection cheap-check watermark this
// client has already merged — `pull_shared_collection`'s own `revision`
// value, keyed by collection id (mirrors `lastKnownRevision`'s single-value
// shape, but one entry per collection since a collection carries its own
// independent revision counter, SYNC-04). A collection id absent from this
// map has never been fetched. Reset to empty on every unlock (see
// `subscribeLockState` below), matching `lastKnownRevision`'s own
// reset-on-unlock discipline.
let collectionRevisionWatermark = new Map<string, number>();

// 26-14-PLAN.md (WINDOWS #9): the direct-share sibling of the watermark
// above — `pull_shared_direct`'s own `revision` value (the caller's own
// `users.shared_direct_revision` counter). Reset to 0 on every unlock.
let directRevisionWatermark = 0;

// WR-07 (code review, Phase 26): the per-source siblings of
// `failedMergeAttempts`. `applySyncSnapshot` deliberately withholds
// `lastKnownRevision` when ANY row fails to decrypt (CR-03/WR-01 from
// earlier iterations) so the next pull retries rather than believing itself
// caught up on data it never merged; neither of the two NEW merge paths
// carried that discipline across, so a transiently-undecryptable shared item
// (e.g. its Collection Key was cached a moment later) silently disappeared
// from the list and was never re-fetched until that collection's revision
// happened to move again. Both are bounded by MAX_FAILED_MERGE_RETRIES for
// the identical reason `applySyncSnapshot` bounds its own. Reset on unlock.
let collectionFailedMergeAttempts = new Map<string, number>();
let directFailedMergeAttempts = 0;

/** Merges ONE collection's full item snapshot (`GET
 * /api/vault/collections/{id}/sync`, `pull_shared_collection` — WINDOWS
 * #8's fix) into `collectionSharedItems`. Every row here already carries
 * `collection_id` set to `collectionId` (server-side construction, see
 * `sync.rs::pull_shared_collection`'s own doc comment) — `decryptItemRow`'s
 * EXISTING scope dispatch (26-05-PLAN.md) decrypts it with zero new
 * branching, via the SAME `getCollectionKey` cache `collections.ts`
 * maintains. `response.items === undefined` (the cheap-check's `UpToDate`
 * shape) is a silent no-op beyond recording the watermark — the
 * previously-cached copy for this collection is already current. Mirrors
 * `applySyncSnapshot`'s own retained-last-known-good-on-decrypt-failure
 * fallback, scoped to just this collection's previously-cached rows. */
function mergeCollectionSnapshot(
  collectionId: string,
  response: SharedCollectionItemsResponse,
  uk: WasmUserKey,
): boolean {
  if (response.items === undefined) {
    collectionRevisionWatermark.set(collectionId, response.revision);
    collectionFailedMergeAttempts.delete(collectionId);
    return true;
  }
  const previousById = new Map(
    collectionSharedItems
      .filter((item) => item.collectionId === collectionId)
      .map((item) => [item.id, item]),
  );
  let anyRowFailed = false;
  const decrypted = response.items.flatMap((row): VaultItem[] => {
    try {
      return [{ ...decryptItemRow(row, uk), undecryptable: false }];
    } catch (err) {
      anyRowFailed = true;
      console.error(
        `pv: failed to decrypt shared-collection item ${row.id} (collection ${collectionId}) during sync merge -- keeping last-known-good copy`,
        err,
      );
      const previous = previousById.get(row.id);
      return previous !== undefined ? [{ ...previous, undecryptable: true }] : [];
    }
  });
  // Replace EVERY previously-cached item for THIS collection id — never a
  // partial merge, mirrors `pull_shared_collection`'s own always-full-
  // snapshot contract (no incremental per-item diff exists server-side).
  collectionSharedItems = [
    ...collectionSharedItems.filter((item) => item.collectionId !== collectionId),
    ...decrypted,
  ];
  // WR-07: mirror `applySyncSnapshot` -- only record this collection as
  // merged when EVERY row decrypted, so a transient failure is genuinely
  // re-pulled on the next tick instead of silently dropping the row until
  // that collection's revision happens to move again. Bounded so a
  // permanently undecryptable row cannot become a permanent re-pull loop;
  // affected rows stay flagged `undecryptable: true` either way.
  if (!anyRowFailed) {
    collectionFailedMergeAttempts.delete(collectionId);
    collectionRevisionWatermark.set(collectionId, response.revision);
  } else {
    const attempts = (collectionFailedMergeAttempts.get(collectionId) ?? 0) + 1;
    collectionFailedMergeAttempts.set(collectionId, attempts);
    if (attempts >= MAX_FAILED_MERGE_RETRIES) {
      collectionRevisionWatermark.set(collectionId, response.revision);
    }
  }
  recomputeItems();
  // WR-07: reported to `handleSharedRevisions` so the OUTER watermark is
  // withheld too -- withholding only this collection's watermark would be
  // useless on its own, since `sharedRevisionsChanged()` short-circuits on
  // the outer watermark before any per-collection one is consulted (WR-06).
  return !anyRowFailed;
}

/** Decrypts ONE directly-shared row via the recipient-side crypto sequence
 * `ShareDialog.real-wasm.test.ts` already proved: unseal `row.sealed_key`
 * with the caller's own identity keypair to recover the item's Cipher Key,
 * then `decryptItemWithSharedKey` — NEVER `decryptItem`/
 * `decryptItemForCollection` (this item is neither personal nor
 * collection-scoped from THIS recipient's own perspective; its owner's User
 * Key/Collection Key is not something the recipient holds at all). */
function decryptDirectSharedRow(row: DirectSharedItemRow, identityKey: WasmIdentityKey): VaultItem {
  const unsealed = unsealCollectionKey(identityKey, row.sealed_key);
  let plaintext: string;
  try {
    plaintext = decryptItemWithSharedKey(unsealed, row.enc_data, row.id, row.revision);
  } finally {
    unsealed.free?.();
  }
  const fields = normalizeItemFields(JSON.parse(plaintext) as ItemFields);
  return {
    id: row.id,
    revision: row.revision,
    fields,
    updatedAt: row.updated_at,
    lastUsedAt: row.last_used_at ?? undefined,
    isShared: row.is_shared,
    lastEditorEmail: row.last_editor_email ?? undefined,
    collectionId: null,
    // CR-02 (code review, Phase 26): this read path -- and ONLY this read
    // path -- produces items the caller does not own. See
    // `VaultItem.sharedToMe`'s own doc comment for why the UI cannot infer
    // this from `isShared`/`collectionId` (a row from here is shaped
    // identically to an item the caller shares directly with others).
    sharedToMe: true,
    // 26-VERIFICATION.md gap 1 (SHARE-03): the recipient's OWN grant, now
    // carried by `pull_shared_direct` (`DirectSharedItem.access_level`).
    // This is what makes `hidden_password` mean anything at all on a
    // recipient surface -- before it, the level was a stored label the
    // recipient's client never saw, and the live probe read the plaintext on
    // the first click of the ordinary reveal toggle.
    accessLevel: row.access_level,
  };
}

/** Merges the caller's full directly-shared-item snapshot (`GET
 * /api/sync/shared/direct`, `pull_shared_direct` — WINDOWS #9's fix) into
 * `directSharedItems`. `response.items === undefined` (`UpToDate`) is a
 * silent no-op beyond recording the watermark. Resolves the caller's own
 * identity keypair ONCE per call (mirrors `collections.ts::refreshCollections`'s
 * identical one-resolution-per-refresh discipline), freed in `finally`
 * regardless of outcome. */
async function mergeDirectSnapshot(
  response: SharedDirectSyncResponse,
  uk: WasmUserKey,
): Promise<boolean> {
  if (response.items === undefined) {
    directRevisionWatermark = response.revision;
    directFailedMergeAttempts = 0;
    return true;
  }
  const previousById = new Map(directSharedItems.map((item) => [item.id, item]));
  let anyRowFailed = false;
  const identityKey = await ensureOwnIdentityKeypair(uk);
  try {
    // A lock may have fired while the identity-keypair round trip was in
    // flight — never decrypt with/apply a stale handle (mirrors
    // `applySyncSnapshot`'s own re-check).
    //
    // WR-15 (code review, Phase 26): identity, not mere nullity -- a
    // lock-then-unlock cycle mid-flight installs a BRAND NEW WasmUserKey
    // and frees this one, so a `=== null` guard passes while `uk` is stale.
    if (getUnlockedUserKey() !== uk) {
      return false;
    }
    const decrypted = response.items.flatMap((row): VaultItem[] => {
      try {
        return [{ ...decryptDirectSharedRow(row, identityKey), undecryptable: false }];
      } catch (err) {
        anyRowFailed = true;
        console.error(
          `pv: failed to decrypt directly-shared item ${row.id} during sync merge -- keeping last-known-good copy`,
          err,
        );
        const previous = previousById.get(row.id);
        return previous !== undefined ? [{ ...previous, undecryptable: true }] : [];
      }
    });
    // Replace the WHOLE direct-shared set — `pull_shared_direct` always
    // returns the caller's FULL current direct-share set on a non-UpToDate
    // response (no incremental diff, same contract as the collection pull
    // above), so a revoked share's absence from `response.items` is exactly
    // how its removal is represented.
    directSharedItems = decrypted;
    // WR-07: same bounded withholding as mergeCollectionSnapshot above.
    if (!anyRowFailed) {
      directFailedMergeAttempts = 0;
      directRevisionWatermark = response.revision;
    } else {
      directFailedMergeAttempts += 1;
      if (directFailedMergeAttempts >= MAX_FAILED_MERGE_RETRIES) {
        directRevisionWatermark = response.revision;
      }
    }
    recomputeItems();
    // WR-07: see mergeCollectionSnapshot's identical return.
    return !anyRowFailed;
  } finally {
    identityKey.free?.();
  }
}

export async function createVaultItem(rawFields: ItemFields): Promise<VaultItem> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot create an item while the vault is locked");
  }
  // WR-08 / WINDOWS #11: `withCommonFieldInvariants` closed the tags-less
  // hazard only for SERVER-DECRYPTED plaintext (its own doc comment says
  // so). This function pushed the CALLER-supplied `fields` object into the
  // store verbatim, so a `tags`-less `ItemFields` from any current or future
  // caller (the extension, a form regression, a new item type) reproduced
  // WINDOWS #10's exact account-wedging failure. Normalizing here makes the
  // store's invariant hold for EVERY writer, not just the decrypt path --
  // and the normalized shape is what gets encrypted, so the server row is
  // well-formed too.
  const fields = normalizeItemFields(rawFields);
  const id = crypto.randomUUID();
  const plaintext = JSON.stringify(fields);
  const combined = encryptItem(uk, plaintext, id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const created = await createItem(id, encKey, encData);
  const item: VaultItem = { id, revision: 1, fields, updatedAt: created.updated_at };
  // WR-08 / WINDOWS #11: the server write has ALREADY been accepted at this
  // point. Any throw from the local bookkeeping below used to propagate out
  // of this function into `ItemForm`'s catch, which rendered "Failed to save
  // item. Please try again." over a 201 -- inviting the user to retry into
  // duplicate rows. This repo already fixed one instance of this class
  // (commit 4450dc0, WR-12); the pattern is fixed here rather than another
  // instance of it. Logged, never surfaced: the item IS saved.
  try {
    // A freshly-created item is always PERSONAL at creation time — it only
    // becomes collection-scoped via a later `moveItemToCollection` call,
    // never at creation (mirrors `createVaultFolder`'s own shape).
    personalItems = [...personalItems, item];
    recomputeItems();
  } catch (err) {
    console.error("pv: post-commit store bookkeeping failed after createItem", err);
  }
  return item;
}

export async function createVaultFolder(name: string): Promise<Folder> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot create a folder while the vault is locked");
  }
  // 26-13-PLAN.md live-run fix (real bug this plan's own live 2-session run
  // discovered): `id` is minted client-side BEFORE encryption (mirrors
  // ShareDialog.tsx's `newCollectionId` pattern exactly) and sent to the
  // server via `createFolder`'s own `id` parameter -- the server no longer
  // mints its own id and silently discards this one. The OLD code called
  // `await createFolder(encName)` without ever reading its response body:
  // the server minted a DIFFERENT id than the one this function had already
  // encrypted `enc_name`'s AAD against, so `decryptFolderRow` (bound to the
  // server's own `row.id`) could never decrypt a folder's name again after
  // the optimistic in-memory copy below was replaced by any real server
  // round trip (next unlock, new device, or a forced full re-pull).
  const id = crypto.randomUUID();
  const encName = encryptItem(uk, JSON.stringify({ name }), id, 1);
  await createFolder(id, encName);
  const folder: Folder = { id, name };
  // WR-08 / WINDOWS #11: same post-commit discipline as createVaultItem --
  // the folder exists server-side, so a bookkeeping throw must never be
  // reported as a failed creation.
  try {
    folders = [...folders, folder];
    notifyFolderListeners();
  } catch (err) {
    console.error("pv: post-commit store bookkeeping failed after createFolder", err);
  }
  return folder;
}

/** Success-gated removal (mirrors deleteVaultItem below): a failed delete
 * leaves the folder visible in `folders`/`useFolders()`. */
export async function deleteVaultFolder(id: string): Promise<void> {
  await deleteFolder(id);
  // WR-08 / WINDOWS #11: the DELETE already succeeded -- never report
  // failure over it.
  try {
    folders = folders.filter((folder) => folder.id !== id);
    notifyFolderListeners();
  } catch (err) {
    console.error("pv: post-commit store bookkeeping failed after deleteFolder", err);
  }
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
  rawFields: ItemFields,
  currentRevision: number,
): Promise<VaultItem> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot update an item while the vault is locked");
  }
  // WR-08 / WINDOWS #11: same write-boundary normalization as
  // `createVaultItem` -- `withCommonFieldInvariants` only ever guarded
  // server-decrypted plaintext, and this function pushed the caller-supplied
  // object into the store verbatim.
  const fields = normalizeItemFields(rawFields);
  // CR-03: refuse to save over an item whose current in-memory copy is
  // known-stale (a decrypt failure during the last sync merge) — see
  // UndecryptableItemError's own doc comment.
  const existingBeforeSave = items.find((item) => item.id === id);
  if (existingBeforeSave?.undecryptable === true) {
    throw new UndecryptableItemError();
  }
  // See DirectShareNotEditableError's own doc comment: this recipient has
  // no crypto path to correctly re-encrypt someone else's directly-shared
  // item — fail loud rather than silently corrupt it under the wrong key.
  if (directSharedItems.some((item) => item.id === id)) {
    throw new DirectShareNotEditableError(id);
  }
  const newRevision = currentRevision + 1;
  const plaintext = JSON.stringify(fields);
  // 26-05a: mirrors decryptItemRow's own scope dispatch (26-05-PLAN.md) on
  // the ENCRYPT side -- the gap deferred-items.md logged and this fix
  // closes. `existingBeforeSave` (looked up above for the undecryptable
  // guard) is also the only source of truth for this item's scope here: the
  // caller-supplied `fields`/`currentRevision` carry no collection_id, and
  // guessing "personal" for an item this client hasn't loaded yet preserves
  // this function's pre-existing behavior for that edge case.
  const collectionId = existingBeforeSave?.collectionId ?? null;
  let combined: string;
  if (collectionId === null) {
    combined = encryptItem(uk, plaintext, id, newRevision);
  } else {
    // `ck` is a BORROWED reference into collections.ts's own long-lived
    // cache (mirrors decryptItemRow's identical getCollectionKey lookup) --
    // never freed here; collections.ts owns its lifecycle (freed on lock or
    // on per-collection replacement, see collections.ts's own doc comment).
    const ck = getCollectionKey(collectionId);
    if (ck === undefined) {
      // FAIL LOUD -- never fall back to the personal-key path below. See
      // CollectionKeyUnavailableError's own doc comment for why.
      throw new CollectionKeyUnavailableError(collectionId);
    }
    combined = encryptItemForCollection(ck, plaintext, collectionId, id, newRevision);
  }
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
  //
  // 26-05 (this plan): `collectionId` (Task 2's own new field) gets the
  // IDENTICAL carry-forward treatment for the identical reason — this
  // response body has no such field either, so dropping it here would make
  // a collection-scoped item look personal again immediately after its own
  // save, right up until the next background snapshot repopulated it.
  const updated: VaultItem = {
    id,
    revision: newRevision,
    fields,
    updatedAt: response.updated_at,
    lastUsedAt: existing?.lastUsedAt,
    isShared: existing?.isShared,
    lastEditorEmail: existing?.lastEditorEmail,
    collectionId: existing?.collectionId,
  };
  // 26-14-PLAN.md: writes through whichever of the three sources currently
  // holds `id` (never reassigns the derived `items` view directly) — see
  // `replaceItemInSources`'s own doc comment for why.
  //
  // WR-08 / WINDOWS #11: the PUT already returned successfully, so a throw
  // from this bookkeeping must never be reported to the caller as a failed
  // save (`DetailPanel`'s onError would render "Failed to save item" over a
  // write the server accepted).
  try {
    replaceItemInSources(id, updated);
  } catch (err) {
    console.error("pv: post-commit store bookkeeping failed after updateItem", err);
  }
  return updated;
}

/** Removes the item from the in-memory store only after the API call
 * succeeds — a failed delete leaves the item visible (T-02-23). */
export async function deleteVaultItem(id: string): Promise<void> {
  await deleteItem(id);
  // WR-08 / WINDOWS #11: the DELETE already succeeded. A throw here used to
  // make the offending row un-removable through the UI entirely (WINDOWS
  // #10's tail: delete threw for the same reason create did).
  try {
    removeItemFromSources(id);
  } catch (err) {
    console.error("pv: post-commit store bookkeeping failed after deleteItem", err);
  }
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
      const existing = items.find((item) => item.id === id);
      if (existing === undefined) return;
      // 26-14-PLAN.md: writes through whichever source currently holds
      // `id`, same discipline as updateVaultItem/deleteVaultItem above.
      replaceItemInSources(id, { ...existing, lastUsedAt: res.last_used_at });
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

// A-5 (26-CONTEXT.md, Phase 23's inherited obligation #3): `GET
// /api/sync/shared` has shipped fully implemented, authorized and tested
// since Phase 23 with no client consumer -- `onSharedRevisions` below is the
// first one. Tracks the last-known per-collection/direct revision watermark
// this client has already merged; a mismatch on ANY field means a
// co-member's shared edit landed and this client hasn't pulled it yet. Reset
// to empty on every startSync() (unlock) -- see the subscribeLockState
// callback below -- mirroring sync.ts's own `sharedPullDisabled`
// re-arm-on-unlock rationale, so a stale watermark from a PREVIOUS session
// never suppresses the first post-unlock pull.
let sharedRevisionsWatermark: { collections: Map<string, number>; direct: number } = {
  collections: new Map(),
  direct: 0,
};

// WR-06 (code review, Phase 26): CONSECUTIVE `handleSharedRevisions` passes
// in which at least one sub-step failed. Mirrors `failedMergeAttempts`'s own
// bounded-withholding discipline (and reuses its MAX_FAILED_MERGE_RETRIES
// budget) so a transient failure genuinely retries while a permanent one
// does not turn into a permanent re-fetch-every-tick loop. Reset on any
// fully clean pass and on every unlock.
let failedSharedRefreshAttempts = 0;

/** `true` when `revisions` differs from the last-known watermark in ANY
 * field: a collection's revision changed, a collection is new (absent from
 * the watermark), or the synthetic "direct" bucket's revision changed. */
function sharedRevisionsChanged(revisions: SharedRevisions): boolean {
  if (revisions.direct.revision !== sharedRevisionsWatermark.direct) {
    return true;
  }
  for (const collection of revisions.collections) {
    if (sharedRevisionsWatermark.collections.get(collection.id) !== collection.revision) {
      return true;
    }
  }
  // 26-14-PLAN.md (WINDOWS #8's inverse): a collection present in the
  // watermark but ABSENT from the new payload means membership was
  // revoked/removed -- also a genuine change, even though no FORWARD-
  // looking collection revision moved. Without this, a revoke would never
  // be detected at all (every check above only looks at collections the
  // NEW payload still lists), and `handleSharedRevisions`'s own purge logic
  // would never run.
  const currentIds = new Set(revisions.collections.map((collection) => collection.id));
  for (const knownId of sharedRevisionsWatermark.collections.keys()) {
    if (!currentIds.has(knownId)) {
      return true;
    }
  }
  return false;
}

/** On a watermark mismatch: WINDOWS #7/#8/#9's fix (26-14-PLAN.md) --
 * previously this forced a full PERSONAL snapshot re-pull via
 * `getSyncSnapshot(0)`, which is not merely inefficient but WRONG: a
 * shared-only change (another member editing a collection this caller is
 * IN, or a new direct share/collection grant landing) never bumps the
 * caller's own `vault_revision` (SYNC-04's per-collection-not-per-user
 * design) -- the personal pull would silently return the SAME data every
 * time and the shared change would never actually be fetched at all. This
 * now does what the mismatch actually means: (1) refresh `collections.ts`
 * FIRST (WINDOWS #7 -- a member added to a collection previously never saw
 * it, or gained a usable Collection Key, until their next unlock/reload;
 * `refreshCollectionsNow()` is the SAME manual-refresh entry point
 * `ShareDialog.tsx`'s own folder-create variant already uses, not a new
 * mechanism), (2) for every collection whose revision actually moved, pull
 * ITS OWN item snapshot via `getCollectionSync` and merge it (WINDOWS #8),
 * purging any collection the caller is no longer a member of, and (3) if
 * the direct bucket moved, pull `getSharedDirectSync` and merge it (WINDOWS
 * #9). An unchanged payload is a silent no-op -- never an extra round trip
 * when nothing actually changed. Every awaited step re-checks
 * `getUnlockedUserKey()` before touching module state, mirroring
 * `applySyncSnapshot`'s own re-check-after-await discipline (a lock event
 * may fire while any of these round trips is in flight). */
async function doHandleSharedRevisions(revisions: SharedRevisions): Promise<void> {
  if (!sharedRevisionsChanged(revisions)) {
    return;
  }
  if (getUnlockedUserKey() === null) {
    return;
  }

  // WR-06 (code review, Phase 26): every inner catch below used to claim
  // "the next tick retries", but `sharedRevisionsWatermark` was reassigned
  // UNCONDITIONALLY at the end -- so the next tick's
  // `sharedRevisionsChanged()` compared the same payload against that
  // watermark, returned false, and returned before any per-collection
  // watermark was ever consulted. A single dropped request on the eager
  // post-unlock `refreshSharedItemsNow()` therefore left the recipient's
  // shared items invisible for the REST OF THE SESSION -- exactly the
  // user-visible symptom WINDOWS #8/#9 were opened for.
  let anyStepFailed = false;

  try {
    await refreshCollectionsNow();
  } catch {
    // Transient network failure -- the next revisions tick retries, same
    // self-healing rationale as every other pull in this module.
    anyStepFailed = true;
  }
  if (getUnlockedUserKey() === null) {
    return;
  }

  // Collections the caller is no longer a member of (revoked/removed):
  // purge any previously-cached items for them -- must not leave a stale
  // copy visible after access is genuinely gone.
  const currentCollectionIds = new Set(revisions.collections.map((collection) => collection.id));
  for (const knownId of Array.from(collectionRevisionWatermark.keys())) {
    if (!currentCollectionIds.has(knownId)) {
      collectionRevisionWatermark.delete(knownId);
      collectionSharedItems = collectionSharedItems.filter((item) => item.collectionId !== knownId);
    }
  }

  for (const collection of revisions.collections) {
    if (collectionRevisionWatermark.get(collection.id) === collection.revision) {
      continue; // this specific collection hasn't moved -- nothing to pull
    }
    const uk = getUnlockedUserKey();
    if (uk === null) {
      return;
    }
    try {
      const response = await getCollectionSync(collection.id);
      if (getUnlockedUserKey() !== uk) {
        return; // WR-15: identity, not nullity -- see mergeDirectSnapshot
      }
      if (!mergeCollectionSnapshot(collection.id, response, uk)) {
        // A row in this collection failed to decrypt -- WR-07 withheld its
        // own watermark, so the outer one must be withheld too.
        anyStepFailed = true;
      }
    } catch {
      // Transient -- next tick retries (this collection's own watermark is
      // untouched on failure, so it stays "needs a pull" until it succeeds).
      anyStepFailed = true;
    }
  }

  if (directRevisionWatermark !== revisions.direct.revision) {
    const uk = getUnlockedUserKey();
    if (uk !== null) {
      try {
        const response = await getSharedDirectSync();
        const ukAfterFetch = getUnlockedUserKey();
        if (ukAfterFetch !== null && !(await mergeDirectSnapshot(response, ukAfterFetch))) {
          anyStepFailed = true;
        }
      } catch {
        // Transient -- next tick retries.
        anyStepFailed = true;
      }
    }
  }

  recomputeItems(); // covers the purge-only case above with no new merge call
  // WR-06: only record this payload as merged when every step actually
  // succeeded -- otherwise the next tick must see the SAME payload as
  // "changed" and retry. Bounded by MAX_FAILED_MERGE_RETRIES for the same
  // reason `applySyncSnapshot` bounds its own withholding (WR-01, iteration
  // 2): a PERMANENT failure would otherwise become a permanent
  // re-fetch-every-tick loop with no recovery path. Reset on any fully
  // clean pass and on every unlock.
  if (!anyStepFailed) {
    failedSharedRefreshAttempts = 0;
    sharedRevisionsWatermark = {
      collections: new Map(revisions.collections.map((collection) => [collection.id, collection.revision])),
      direct: revisions.direct.revision,
    };
  } else {
    failedSharedRefreshAttempts += 1;
    if (failedSharedRefreshAttempts >= MAX_FAILED_MERGE_RETRIES) {
      sharedRevisionsWatermark = {
        collections: new Map(revisions.collections.map((collection) => [collection.id, collection.revision])),
        direct: revisions.direct.revision,
      };
    }
  }
}

/** WR-11 (code review, Phase 26): the re-entrancy guard.
 * `onSharedRevisions` is fired by BOTH the WS event path and the 30s poll,
 * and `sync.ts::pullOnce` explicitly never awaits it -- so two invocations
 * could overlap freely while `doHandleSharedRevisions` mutates five pieces
 * of module-level state across a long await chain
 * (`collectionRevisionWatermark`, `collectionSharedItems`,
 * `directRevisionWatermark`, `directSharedItems`,
 * `sharedRevisionsWatermark`). Run A could purge a collection between run
 * B's fetch and its merge, both would write the outer watermark at the end
 * (last writer wins, possibly with the OLDER payload), and a burst of WS
 * events fanned out into duplicated `refreshCollectionsNow` + per-collection
 * fetch storms.
 *
 * Serializing on a module-level in-flight promise makes each invocation see
 * a settled state. The `.catch(() => {})` keeps one failed pass from
 * poisoning the chain for every later one -- `doHandleSharedRevisions`
 * already handles every internal failure itself, so there is nothing to
 * surface here anyway. The returned promise still resolves only once THIS
 * invocation has finished, which is what 26-14's tests await. */
let sharedRefreshInFlight: Promise<void> = Promise.resolve();

function handleSharedRevisions(revisions: SharedRevisions): Promise<void> {
  sharedRefreshInFlight = sharedRefreshInFlight
    .then(() => doHandleSharedRevisions(revisions))
    .catch(() => {});
  return sharedRefreshInFlight;
}

/** Eager first attempt at the SAME refresh `handleSharedRevisions` performs
 * on every subsequent WS/poll tick (`sync.ts::pullOnce`) -- called directly
 * on unlock so a shared collection/direct item is visible without waiting
 * up to `POLL_INTERVAL_MS` for the first background tick. Mirrors
 * `sync.ts::pullOnce`'s own tolerance for a single-user vault with no
 * `family_members` row at all (a 404 here is expected and silent, never
 * thrown into the `subscribeLockState` listener below). */
async function refreshSharedItemsNow(): Promise<void> {
  try {
    const revisions = await getSharedRevisions();
    if (getUnlockedUserKey() === null) {
      return;
    }
    await handleSharedRevisions(revisions);
  } catch {
    // Expected for a single-user vault (no family_members row) and for any
    // transient network failure -- the WS/poll path self-heals regardless.
  }
}

// Module-level side effect (mirrors lib/crypto/index.ts's own singleton
// shape): unlocking the vault (re-)fetches and decrypts items/folders AND
// starts the sync transport (WS + poll); locking stops the transport FIRST
// (so no in-flight sync callback can fire after the arrays are cleared),
// then clears both in-memory arrays immediately.
const syncCallbacks: SyncCallbacks = {
  getSinceRevision: () => lastKnownRevision,
  onSnapshot: applySyncSnapshot,
  // `SyncCallbacks.onSharedRevisions`'s own type is `(revisions) => void` --
  // `sync.ts::pullOnce` never awaits this callback either way (its own
  // doc comment), so returning the promise here (rather than `void`-wrapping
  // it) changes nothing in production. It DOES let a caller that wants to
  // await full completion do so (26-14-PLAN.md's tests are exactly that
  // caller — `handleSharedRevisions` never throws uncaught, every internal
  // await is already its own try/catch, so there is no unhandled-rejection
  // risk in leaving this un-voided).
  onSharedRevisions: handleSharedRevisions,
};

subscribeLockState(() => {
  if (isUnlocked()) {
    sharedRevisionsWatermark = { collections: new Map(), direct: 0 };
    failedSharedRefreshAttempts = 0;
    collectionRevisionWatermark = new Map();
    directRevisionWatermark = 0;
    collectionFailedMergeAttempts = new Map();
    directFailedMergeAttempts = 0;
    void loadAndDecryptAll();
    void refreshSharedItemsNow();
    startSync(syncCallbacks);
  } else {
    stopSync();
    lastKnownRevision = 0;
    failedMergeAttempts = 0;
    personalItems = [];
    collectionSharedItems = [];
    directSharedItems = [];
    collectionRevisionWatermark = new Map();
    directRevisionWatermark = 0;
    collectionFailedMergeAttempts = new Map();
    directFailedMergeAttempts = 0;
    failedSharedRefreshAttempts = 0;
    recomputeItems();
    folders = [];
    notifyFolderListeners();
  }
});
