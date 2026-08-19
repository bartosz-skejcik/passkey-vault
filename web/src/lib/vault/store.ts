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
// 30-13 (FSH-02): the lazy-reseal trigger's ONLY wiring point. It hangs off
// the same syncCallbacks object every other cross-session signal already
// flows through, so a family-wide grant pending for a newcomer is delivered
// on the very next pull cycle of ANY current keyholder -- the sharer's own
// session included (30-DECISION-FSH-02.md's refinement).
import {
  runFamilyWideResealTrigger,
  resetFamilyWideResealAttempts,
} from "@/lib/families/resealTrigger";
// 30-15 (FSH-02): the recipient side of the same signal. `sync.ts`'s
// pullOnce() is the ONLY caller of `refreshFamilyWidePending()`; this module
// reads the stored snapshot synchronously and subscribes to be told when it
// changed -- never a second fetch of its own.
import {
  getFamilyWidePendingSnapshot,
  subscribeFamilyWidePending,
} from "@/lib/families/familyWidePending";
import {
  clearCollectionsOnRemoval,
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

// CR-01/WR-05 (code review, Phase 29): same duck-typed rationale as
// `isConflictError` above -- used by `refreshSharedItemsNow()` to
// distinguish the EXPECTED "no family_members row" 404 (a definitive,
// confirmable "this account has no shared items" answer) from a genuine
// transient failure (which must NOT be read as a confirmed empty shared set
// -- see `refreshSharedItemsNow`'s own comment).
function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 404
  );
}

// 32-01-PLAN.md (B-3/C-2, 32-PLAN-CHECK.md): same duck-typed rationale as
// isConflictError/isNotFoundError above -- used by `moveVaultItem` to
// distinguish a genuine TOCTOU refusal (`require_collection_edit`'s Gate 2,
// vault.rs, re-validating destination access server-side against a client
// view that went stale between destination-select and submit) from any
// other failure. Reachable only when `newCollectionId !== null` (Gate 2
// only runs on a non-null destination).
function isForbiddenError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 403
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
  listItems,
  moveItemToCollection,
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
import { markFamilyMembershipConfirmed, startSync, stopSync, type SyncCallbacks } from "./sync";
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

/** CR-01 (code review, Phase 32), extended by F-2 (32-VERIFICATION.md gap
 * closure): thrown by `moveVaultItem` -- client-side, BEFORE any
 * encryption/network call -- when the caller attempts to RE-SCOPE a
 * collection-scoped item they do NOT own to a DIFFERENT destination,
 * whether that destination is personal scope (`newCollectionId === null`,
 * CR-01's original shape) or a different shared folder entirely (F-2's
 * extension). A move-out re-seals the item's ciphertext under the CALLER's
 * own UserKey (`moveVaultItem`'s own doc comment); only the item's actual
 * owner can ever open a key sealed to them. A move between two shared
 * folders never re-seals under a key the destination can't open, but it
 * still strips the item's real owner of their own item, unannounced --
 * the same "edit means content, never re-scope" bound `vault.rs::move_item`
 * Gate 0's own doc comment states for personal items, now applied
 * uniformly. This is presentation, not authorization -- the authoritative
 * bound is `vault.rs::move_item`'s Gate 1b, destination-independent, which
 * refuses the identical case server-side regardless of what this client
 * check does or does not catch (`ownedByMe` is metadata the client trusts
 * but the server never does).
 *
 * ALSO thrown (ME-06, code review) when the server itself refuses with a
 * 403 for an item the caller's own local metadata already knows it does
 * not own -- `move_item`'s Gate 0/1/1b, none of which consult the
 * destination at all. The prior code mapped every 403 on a null
 * destination here to `CollectionKeyUnavailableError`'s "you no longer
 * have write access to this folder" copy, which is actively wrong for an
 * ownership refusal: there may be no folder in this picture at all (a
 * move-out), or the folder named is not the actual problem (a
 * collection->collection ownership refusal) -- the real problem is that
 * the caller never owned the item to begin with. */
export class NotItemOwnerError extends Error {
  constructor(itemId: string) {
    super(`cannot move item ${itemId} -- you are not its owner`);
    this.name = "NotItemOwnerError";
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
  const real = Array.from(byId.values());
  items = [...real, ...pendingFamilyKeyRows(real)];
  recomputeAllTags();
  notifyListeners();
}

/** 30-15 (FSH-02): id prefix every synthetic pending row carries. A real
 * `vault_items.id` is a UUID, so this can never collide with one -- and any
 * consumer that needs to tell the two apart has both this prefix and the
 * `pendingFamilyKey` discriminant to check.
 *
 * IN-02 fix (30-REVIEW.md): module-private, not exported -- no consumer
 * anywhere in `web/src`/`web/e2e`/`packages/` ever imported this (every
 * existing guard checks `pendingFamilyKey` alone, which is sufficient on its
 * own). Re-export it if a future consumer genuinely needs to distinguish a
 * placeholder id from a real one without going through `pendingFamilyKey`. */
const PENDING_FAMILY_KEY_ID_PREFIX = "pending-family-key:";

/** Builds one synthetic placeholder row per family-wide grant this caller is
 * still missing its `collection_keys` row for (30-DECISION-FSH-02.md).
 *
 * Sourced ENTIRELY from the discovery endpoint's positive, ids-only
 * `missing` list -- never from a caught decrypt exception. That is the whole
 * point: a newcomer holds no Collection Key, so `Collection::resolve_access`
 * 404s the collection's listing outright and there is no ciphertext to fail
 * on in the first place. A genuine decrypt failure on real ciphertext stays
 * on the existing `undecryptable` retained-last-known-good path, untouched.
 *
 * Nothing is fabricated: no name (the real one is inside unreachable
 * `enc_data`), no `updatedAt`/`lastUsedAt` (the ids-only response carries
 * none, and ItemRow omits that slot entirely rather than showing a stale or
 * invented value), no `collectionId` (the backing collection is encoded in
 * the id, so no collection-scoped consumer mistakes a placeholder for a real
 * member of that folder). `fields` exists only because `VaultItem` requires
 * it; it is never rendered -- ItemRow/DetailPanel branch on
 * `pendingFamilyKey` before reading any of it.
 *
 * A grant whose collection ALREADY has a real decrypted row is skipped: the
 * key arrived and the snapshot is simply one pull cycle stale, and showing
 * "waiting for your key" next to items that already decrypted would be the
 * same dishonesty in the opposite direction. */
function pendingFamilyKeyRows(real: VaultItem[]): VaultItem[] {
  // Locked sessions hold no plaintext at all; a placeholder row surviving a
  // lock would be the one piece of vault state that did.
  if (!isUnlocked()) {
    return [];
  }
  const { missing } = getFamilyWidePendingSnapshot();
  if (missing.length === 0) {
    return [];
  }
  const collectionsAlreadyReadable = new Set(
    real.map((item) => item.collectionId).filter((id): id is string => typeof id === "string"),
  );
  const rows: VaultItem[] = [];
  const seen = new Set<string>();
  for (const grant of missing) {
    if (collectionsAlreadyReadable.has(grant.collection_id)) continue;
    const id = `${PENDING_FAMILY_KEY_ID_PREFIX}${grant.collection_id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push({
      id,
      revision: 0,
      pendingFamilyKey: true,
      fields: { type: "note", name: "", body: "", folderId: null, tags: [] },
    });
  }
  return rows;
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

// Mirrors `lib/crypto/index.ts`'s `isUnlocked`/`subscribeLockState`/
// `useIsUnlocked` three-part singleton shape exactly (module-level `let` +
// listener `Set` + `useSyncExternalStore`). `hydrated` distinguishes
// "getItems() confirmed empty/populated post-unlock" from "don't know yet"
// -- the fire-and-forget `void loadAndDecryptAll()` call below leaves a real
// window right after unlock where `getItems()` can still return `[]`/stale
// data while the app renders as unlocked. Without this signal a consumer
// (e.g. ExportDialog's DEBT-02 disclosure) cannot tell a confirmed-zero
// count from an unconfirmed one.
//
// CR-01 (code review, Phase 29): `hydrated` used to flip true the moment
// `loadAndDecryptAll()` alone resolved -- but that call populates
// `personalItems` ONLY. `collectionSharedItems`/`directSharedItems` (the
// arrays that can actually carry `accessLevel === "hidden_password"`) are
// populated by the separate `refreshSharedItemsNow()` pipeline below, which
// is strictly slower. `personalConfirmed`/`sharedConfirmed` now track each
// pipeline's own "at least one genuine attempt has landed" state
// independently; `hydrated` only ever flips true once BOTH are true
// (`maybeMarkHydrated()`), which is the actual invariant ExportDialog needs.
let hydrated = false;
let personalConfirmed = false;
let sharedConfirmed = false;
const hydrationListeners = new Set<() => void>();

function setHydrated(v: boolean): void {
  hydrated = v;
  hydrationListeners.forEach((listener) => listener());
}

/** Only ever raises `hydrated` -- never called with intent to lower it (the
 * unlock/lock branches of `subscribeLockState` below own lowering it
 * directly via `setHydrated(false)`). Called from every place that just
 * confirmed ONE of the two pipelines (personal or shared) has completed a
 * genuine attempt; only flips `hydrated` true once both have. */
function maybeMarkHydrated(): void {
  if (personalConfirmed && sharedConfirmed) {
    setHydrated(true);
  }
}

export function isItemsHydrated(): boolean {
  return hydrated;
}

export function useItemsHydrated(): boolean {
  return useSyncExternalStore(
    (listener) => {
      hydrationListeners.add(listener);
      return () => {
        hydrationListeners.delete(listener);
      };
    },
    isItemsHydrated,
    () => false,
  );
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
    // CR-01 (code review, Phase 32): a personal item is always the
    // caller's own by construction (both `fetch_items_for` arms filter on
    // it server-side) -- only a collection-scoped row's wire
    // `owned_by_caller` can ever be `false`, when it was authored by a
    // fellow member. See VaultItem.ownedByMe's own doc comment.
    ownedByMe: row.collection_id === null ? true : row.owned_by_caller,
  };
}

/** CR-02 (code review, Phase 32): attempts to decrypt an `ItemRow` under
 * the SAME key dispatch `decryptItemRow` uses, returning the raw plaintext
 * STRING (never parsed/normalized -- callers that need identity, not
 * display, want the exact bytes an AEAD open produced) or `null` on ANY
 * failure (wrong/missing key, corrupt ciphertext, AEAD auth failure).
 * `null` here means "cannot prove", never "assume equal" -- every caller
 * treats it as a decline, not a pass.
 *
 * Used by `moveVaultItem`'s and `createVaultItem`'s lost-response recovery
 * to answer a stronger question than a bare revision match can: not just
 * "is SOME row sitting at the expected revision/destination" but "does
 * that row's ACTUAL content genuinely equal what THIS attempt tried to
 * write" -- the closing requirement 32-PLAN-CHECK.md's C-2 blocker states
 * explicitly: "recovery must decline whenever the client cannot prove the
 * stored ciphertext is its own." A revision conjunct alone proves "this
 * commit is recent"; this proves "this commit is MINE". */
function tryDecryptFreshRowPlaintext(row: ItemRow, uk: WasmUserKey): string | null {
  try {
    const combinedFresh = recombineEncryptedItem(row.enc_key, row.enc_data);
    if (row.collection_id === null) {
      return decryptItem(uk, combinedFresh, row.id, row.revision);
    }
    const freshCk = getCollectionKey(row.collection_id);
    if (freshCk === undefined) {
      return null;
    }
    return decryptItemForCollection(freshCk, combinedFresh, row.collection_id, row.id, row.revision);
  } catch {
    return null;
  }
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
  // CR-01/WR-05: a merge that reaches this point (the early `uk === null`
  // guard above did NOT fire) is a genuine, applied attempt at the personal
  // snapshot -- true on the very first post-unlock call (`loadAndDecryptAll`,
  // `since=0`, always carries `items`) AND on every later background poll
  // that calls this via `onSnapshot`, so a rejected initial attempt (WR-05)
  // still recovers hydration on the next successful poll rather than
  // latching `hydrated` false for the rest of the session.
  personalConfirmed = true;
  maybeMarkHydrated();
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

/** `presetId` (ME-07, code review Phase 32): optional caller-supplied item
 * id, for a CALLER that must be able to retry the SAME logical create
 * attempt without minting a fresh id each time (`ItemForm`'s create-then-
 * move sequence -- see its own `pendingCreateIdRef` comment). Every other
 * caller omits it and gets the pre-existing `crypto.randomUUID()` behavior
 * unchanged. */
export async function createVaultItem(
  rawFields: ItemFields,
  presetId?: string,
): Promise<VaultItem> {
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
  const id = presetId ?? crypto.randomUUID();
  const plaintext = JSON.stringify(fields);
  const combined = encryptItem(uk, plaintext, id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  let created: { updated_at: string };
  try {
    created = await createItem(id, encKey, encData);
  } catch (err) {
    // ME-07 (code review, Phase 32): a caller-supplied id hitting the
    // server's `ON CONFLICT(id) DO NOTHING` guard as a 409 is proof of a
    // PRIOR, successful attempt of THIS exact create having already
    // landed -- ids are minted fresh per genuinely NEW item (every OTHER
    // caller either omits `presetId` or, per this function's own doc
    // comment, only ever reuses one it itself generated for this same
    // submission attempt), never coincidentally reused. Without this,
    // a lost/aborted create response reported the generic "please try
    // again" copy, and the NEXT retry called this function with a brand
    // new randomUUID(), silently creating a SECOND item server-side.
    //
    // Recover instead of duplicating: probe the item's own current
    // server-side row and confirm -- by DECRYPTING it under the SAME
    // key/AAD this attempt just used -- that it genuinely holds what this
    // attempt tried to write, not merely a coincidental id collision.
    // `null`/mismatch is a decline, never a pass (same discipline
    // `moveVaultItem`'s recovery uses, see `tryDecryptFreshRowPlaintext`'s
    // own doc comment).
    if (presetId === undefined || !isConflictError(err)) {
      throw err;
    }
    let freshRows: ItemRow[];
    try {
      freshRows = await listItems();
    } catch {
      // Same discipline as moveVaultItem's recovery: a failure of the
      // recovery probe itself must never surface AS the probe's own
      // failure -- rethrow the ORIGINAL 409 classification.
      throw err;
    }
    const freshRow = freshRows.find((row) => row.id === id);
    if (freshRow === undefined || tryDecryptFreshRowPlaintext(freshRow, uk) !== plaintext) {
      throw err;
    }
    created = { updated_at: freshRow.updated_at };
  }
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

/** 32-01-PLAN.md: moves an item to a new destination scope -- a shared
 * collection (`newCollectionId` non-null) or back to personal scope
 * (`null`) -- re-encrypting ONLY under the DESTINATION's key/AAD.
 * `vault.rs::move_item` (unchanged by this plan) is the server side: it
 * requires `edit` on the destination (Gate 2, `require_collection_edit`)
 * and writes collection_id/ciphertext/revision in one statement, exactly
 * as `updateVaultItem`'s PUT does for a same-scope edit.
 *
 * DEPARTURE from 32-RESEARCH.md's literal "decrypt source, encrypt dest"
 * Pattern 1: this function never decrypts the item's CURRENT ciphertext at
 * all -- `rawFields` is written to the destination verbatim (after
 * `normalizeItemFields`). This is strictly safer than a decrypt-old/
 * re-encrypt-old sequence for its one real caller (`ItemForm`, in edit or
 * create-then-move mode): it correctly captures a content edit made in the
 * SAME save as a destination change, instead of silently discarding it.
 *
 * PRECONDITION any caller MUST uphold (32-PLAN-CHECK.md W-6) -- this is
 * safe ONLY because `ItemForm` already holds genuine, complete, LIVE
 * plaintext for the item being moved (that is literally what the form
 * edits); `DetailPanel` gates edit mode behind `canEditItem`, so a
 * `read`/`hidden_password` holder never mounts the form with content to
 * move. A FUTURE caller that has not decrypted/loaded the item into an
 * edit form (e.g. a hypothetical context-menu "move to shared folder"
 * action operating on a row it never opened) must NOT call this function
 * with a partially-populated or stale `ItemFields` object -- doing so
 * would silently encrypt and persist WRONG content under the destination's
 * real key: an unrecoverable corruption, not a caught error. The existing,
 * UNRELATED `moveItemToFolder`/context-menu-move mechanism (personal
 * folders only, drives `updateVaultItem`) must never be widened to accept
 * a collection id without first switching to a genuine decrypt-source
 * shape -- it holds no live plaintext to pass here. */
export async function moveVaultItem(
  id: string,
  rawFields: ItemFields,
  currentRevision: number,
  newCollectionId: string | null,
): Promise<VaultItem> {
  const uk = getUnlockedUserKey();
  if (uk === null) {
    throw new Error("cannot move an item while the vault is locked");
  }
  const fields = normalizeItemFields(rawFields);
  // Same guards updateVaultItem applies, for the same reasons -- see
  // UndecryptableItemError's/DirectShareNotEditableError's own doc
  // comments.
  const existingBeforeSave = items.find((item) => item.id === id);
  if (existingBeforeSave?.undecryptable === true) {
    throw new UndecryptableItemError();
  }
  if (directSharedItems.some((item) => item.id === id)) {
    throw new DirectShareNotEditableError(id);
  }
  // CR-01 (code review, Phase 32), extended by F-2 (32-VERIFICATION.md gap
  // closure): refuse client-side, BEFORE any encryption, any RE-SCOPE of a
  // collection-scoped item this caller does NOT own -- not merely a move
  // OUT to personal scope (CR-01's original shape) but also a move into a
  // DIFFERENT shared folder (F-2's extension; the verifier's falsified
  // probe: an edit-level member of F who also owns G moved author A's item
  // F -> G, stripping A of their own item with no notification). See
  // NotItemOwnerError's own doc comment for the full rationale. This is
  // presentation, not authorization: the authoritative bound is
  // vault.rs::move_item's Gate 1b, now destination-independent, which
  // refuses the identical case server-side regardless of what
  // `items`/`ownedByMe` (client-trusted metadata) says here. Reselecting
  // the item's OWN current collection (`newCollectionId ===
  // existingBeforeSave.collectionId`) is exempt -- that is not a re-scope
  // at all, and this function should not even be called for it (the
  // dispatch above routes an unchanged destination through
  // updateVaultItem), but the guard stays correct if it ever is.
  if (
    existingBeforeSave?.collectionId != null &&
    newCollectionId !== existingBeforeSave.collectionId &&
    existingBeforeSave.ownedByMe !== true
  ) {
    throw new NotItemOwnerError(id);
  }
  const newRevision = currentRevision + 1;
  const plaintext = JSON.stringify(fields);
  let combined: string;
  if (newCollectionId === null) {
    combined = encryptItem(uk, plaintext, id, newRevision);
  } else {
    // Borrowed reference into collections.ts's own long-lived cache, same
    // discipline as updateVaultItem's identical lookup.
    const ck = getCollectionKey(newCollectionId);
    if (ck === undefined) {
      // FAIL LOUD -- never fall back to the personal-key path above. See
      // CollectionKeyUnavailableError's own doc comment for why.
      throw new CollectionKeyUnavailableError(newCollectionId);
    }
    combined = encryptItemForCollection(ck, plaintext, newCollectionId, id, newRevision);
  }
  const { encKey, encData } = splitCombinedEncryptedItem(combined);

  function buildUpdated(revision: number, updatedAt: string): VaultItem {
    const existing = items.find((item) => item.id === id);
    // Same carry-forward discipline updateVaultItem's own tail comment
    // documents for lastUsedAt/isShared/lastEditorEmail -- this response
    // body has none of those fields either. `isShared`/`accessLevel` are a
    // best-effort OPTIMISTIC value here (mirrors decryptItemRow's dispatch
    // for accessLevel), corrected on the next background snapshot, same as
    // updateVaultItem's own carried-forward fields.
    //
    // ME-02 (code review, Phase 32): `lastEditorEmail` gets the IDENTICAL
    // carry-forward `updateVaultItem`'s own WR-02 fix already documents --
    // this was silently omitted here despite the comment above already
    // claiming otherwise, re-regressing WR-02 for the move path
    // specifically (a shared item's live-conflict attribution falling back
    // to generic copy immediately after this same user's own move).
    return {
      id,
      revision,
      fields,
      updatedAt,
      lastUsedAt: existing?.lastUsedAt,
      lastEditorEmail: existing?.lastEditorEmail,
      collectionId: newCollectionId,
      accessLevel:
        newCollectionId === null ? undefined : getCollectionAccessLevel(newCollectionId),
      // LO-02 (code review, Phase 32): a move-out no longer keeps `true`
      // stale off the item's PRIOR (shared) state -- an item that just
      // left a shared folder should read as no longer shared until the
      // next snapshot corrects it either way, not keep advertising
      // exposure it may no longer have. Errs toward UNDER-reporting for at
      // most one snapshot interval, the opposite direction of the stale
      // "shared" badge LO-02 flagged.
      isShared: newCollectionId !== null ? true : false,
      // CR-01: ownership never changes as a SIDE EFFECT of a move -- a
      // successful null-destination move only ever completes when the
      // caller IS the owner (this function's own guard above, backstopped
      // server-side by Gate 1b), so `true` is not optimistic there, it's
      // certain. For a collection destination, carry the prior known value
      // forward (defaulting `true` only when `existing` itself is
      // unknown -- e.g. the create-then-move sequence's first destination
      // pick, where the caller just created this exact item themselves).
      ownedByMe: newCollectionId === null ? true : (existing?.ownedByMe ?? true),
    };
  }

  let response: { revision: number; collection_id: string | null; updated_at: string };
  try {
    response = await moveItemToCollection(id, newCollectionId, encKey, encData, currentRevision);
  } catch (err) {
    // B-3 / C-2 (32-PLAN-CHECK.md): recover from a lost/aborted response
    // instead of reporting a false failure or looping a doomed retry.
    // Re-fetch the item's current server-side row and check whether THIS
    // attempt's own commit is what's actually there.
    //
    // The revision conjunct is load-bearing -- do not drop it. A
    // destination-only check is correct for a first-attempt lost response
    // and WRONG on a retry: save #1 commits content A and its response is
    // lost; the user edits to B; save #2 fails; a destination-only
    // recovery sees collection_id === newCollectionId -- left there by
    // save #1 -- and reports success over content A, silently eating the
    // user's last edit. Requiring revision === currentRevision + 1
    // distinguishes "THIS attempt's own commit landed" from "some earlier
    // attempt's commit is still sitting there": on the retry, the fresh
    // row's revision is the one save #1 wrote, not currentRevision + 1, so
    // recovery correctly declines and the request falls through to the
    // existing conflict/forbidden classification below.
    //
    // ME-03 (code review, Phase 32): the PROBE itself must be able to see
    // the row at all. `listItems()` (`fetch_items_for`) only ever returns
    // items the caller AUTHORED -- for a move of a collection item
    // authored by someone else (the exact CR-01 population) `freshRow` was
    // structurally always `undefined` through this probe, so recovery
    // could never fire and every such lost response was reported as a
    // failure. Probe the DESTINATION collection directly for a non-null
    // destination (every author's rows -- `pull_shared_collection`, the
    // same endpoint `collectionSharedItems` is built from); `listItems()`
    // remains correct for a move-OUT, where the only caller who could ever
    // have performed it is the item's own owner (Gate 1b), so their own
    // personal list IS the right probe there.
    // Live-E2E-caught regression (code review Phase 32, found by this
    // fix's OWN falsification run, not by the review): the ORIGINAL code
    // (and this fix's first draft) rethrew the refetch's OWN failure
    // wrapped as `throw err` from INSIDE this inner `catch` block. A
    // `throw` inside a `catch` block does not "fall through" to the
    // classification code below it in the SAME outer `catch` -- it
    // unwinds the stack immediately, so `err` propagated OUT OF
    // `moveVaultItem` entirely, raw and UNCLASSIFIED, skipping
    // `isConflictError`/`isForbiddenError`/`isNotFoundError` below
    // completely. Invisible for the ALREADY-covered 403 case (SC3's mere
    // demotion still leaves read access, so the recovery probe itself
    // never fails there) -- but HI-01's FULL revocation shape has the
    // caller losing read access too, so the probe 404s right alongside
    // the move itself, and the live 2-session run for that exact test hit
    // this: the banner rendered the generic `error.itemSaveFailed`
    // instead of the classified `error.itemMoveAccessLost`. Fixed by
    // leaving `freshRow` `undefined` on a probe failure and falling
    // through to the SAME classification every other non-recovered path
    // already uses, instead of a second, bypassing throw.
    let freshRow: ItemRow | undefined;
    try {
      const freshRows =
        newCollectionId === null
          ? await listItems()
          : ((await getCollectionSync(newCollectionId)).items ?? []);
      freshRow = freshRows.find((row) => row.id === id);
    } catch (refetchErr) {
      // LO-05 (code review, Phase 32): log the swallowed re-fetch failure
      // -- every OTHER post-commit failure in this file already does, and
      // without this a false-failure report in the field is undebuggable:
      // there is no signal telling whether the recovery probe even ran.
      // `freshRow` stays `undefined` -- never treated as recovered -- and
      // execution falls through to the ORIGINAL error's classification
      // below, exactly as a "the fresh row isn't a match" outcome would.
      console.error("pv: moveVaultItem's recovery re-fetch failed", refetchErr);
    }
    // CR-02 (32-PLAN-CHECK.md C-2, code review iteration 4): the revision
    // conjunct alone proves "this is a RECENT commit", not "this is MY
    // commit" -- `DetailPanel` pinning `editBaselineRevision` across a
    // failed-then-retried edit-mode save can make `currentRevision` (and
    // therefore `newRevision`) IDENTICAL across two genuinely different
    // attempts, which defeats the revision conjunct exactly when it
    // matters most. A stronger, genuinely available identity proof: decrypt
    // the fresh row under the SAME key this attempt just encrypted under,
    // and require its plaintext to equal what THIS attempt tried to write,
    // byte-for-byte. `tryDecryptFreshRowPlaintext`'s `null` (decrypt/key
    // failure) is a decline, never a pass -- "recovery must decline
    // whenever the client cannot prove the stored ciphertext is its own."
    if (
      freshRow !== undefined &&
      freshRow.collection_id === newCollectionId &&
      freshRow.revision === newRevision &&
      tryDecryptFreshRowPlaintext(freshRow, uk) === plaintext
    ) {
      const recovered = buildUpdated(newRevision, freshRow.updated_at);
      try {
        replaceItemInSources(id, recovered);
      } catch (bookkeepingErr) {
        console.error(
          "pv: post-commit store bookkeeping failed after moveItemToCollection recovery",
          bookkeepingErr,
        );
      }
      return recovered;
    }
    // Only when the fresh row does NOT show the destination already
    // reached (by this attempt) do the existing failure branches apply.
    if (isConflictError(err)) {
      await loadAndDecryptAll();
      const details = (err as { details?: { last_editor_email?: string | null } }).details;
      const lastEditorEmail = details?.last_editor_email ?? undefined;
      throw new RevisionConflictError(lastEditorEmail);
    }
    if (isForbiddenError(err)) {
      // ME-06 (code review, Phase 32), extended by F-2 (32-VERIFICATION.md
      // gap closure): a 403 here is NOT reachable only when
      // newCollectionId !== null -- move_item's Gate 0/1/1b all return
      // Forbidden without ever consulting the destination. Gate 2
      // (destination-access) NEVER runs for a null destination (vault.rs's
      // own `match &req.new_collection_id` for that check), so a
      // null-destination 403 is UNCONDITIONALLY an ownership refusal
      // (Gate 0/1/1b), exactly as the original ME-06 fix established.
      // F-2 adds a SECOND, narrower case for a NON-null destination: the
      // client-side guard above already throws NotItemOwnerError before
      // any network call whenever local `ownedByMe` metadata says this is
      // an ownership case, so a 403 reaching here on a non-null
      // destination with that same metadata means the local cache was
      // STALE (a TOCTOU) but the server's Gate 1b still correctly refused
      // -- name it the same way, rather than blaming destination access
      // Gate 2 never actually checked.
      if (
        newCollectionId === null ||
        (existingBeforeSave?.collectionId != null &&
          newCollectionId !== existingBeforeSave.collectionId &&
          existingBeforeSave.ownedByMe !== true)
      ) {
        throw new NotItemOwnerError(id);
      }
      // The client-visible half of ORG-02's TOCTOU refusal (destination
      // access revoked between the client's stale useCollections() view
      // and submit; vault.rs::move_item Gate 2 refuses server-side before
      // any write -- no server change needed). newCollectionId is
      // guaranteed non-null here (the branch above always fires on null).
      throw new CollectionKeyUnavailableError(newCollectionId);
    }
    if (isNotFoundError(err)) {
      // HI-01 (code review, Phase 32): `require_collection_edit`'s
      // `gate()` resolves a FULLY REVOKED destination grant to `None` ->
      // 404 -- the ordinary result of "stop sharing this folder", at
      // least as reachable as the demotion-driven 403 above, and
      // previously unhandled here at all: it fell through to `throw err`
      // and DetailPanel's generic "Failed to save item. Please try
      // again." on an operation that cannot succeed until someone else
      // restores access. Only reachable via Gate 2 (the destination
      // check), so `newCollectionId` is never null on this branch in
      // practice -- the `?? "personal"` fallback exists only so this
      // never crashes if that ever changes.
      throw new CollectionKeyUnavailableError(newCollectionId ?? "personal");
    }
    throw err;
  }
  const updated = buildUpdated(response.revision, response.updated_at);
  // WR-08 / WINDOWS #11 discipline: the PUT already returned successfully,
  // so a throw from this bookkeeping must never be reported to the caller
  // as a failed save.
  try {
    replaceItemInSources(id, updated);
  } catch (err) {
    console.error("pv: post-commit store bookkeeping failed after moveItemToCollection", err);
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
    // CR-01: an unchanged payload against a FRESH (just-reset-on-unlock)
    // watermark means "genuinely nothing shared, confirmed" -- not "we
    // don't know yet". Confirm the pipeline here too, not only on the
    // "did work" path below, so a single-collection/no-family account still
    // reaches `hydrated === true`.
    sharedConfirmed = true;
    maybeMarkHydrated();
    return;
  }
  if (getUnlockedUserKey() === null) {
    // Lock raced this call -- state is indeterminate, do NOT confirm.
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
  // CR-01: unlike `applySyncSnapshot` (whose `anyRowFailed` is ONLY ever a
  // post-fetch decrypt failure -- the network round trip itself already
  // succeeded by the time that function runs at all), `anyStepFailed` here
  // also covers a genuine FETCH failure (`getCollectionSync`/
  // `getSharedDirectSync`/`refreshCollectionsNow` throwing) -- a collection
  // whose items were never actually retrieved this pass keeps whatever
  // (possibly nothing) `collectionSharedItems` already held for it. Only a
  // FULLY clean pass confirms the shared set is now genuinely known; a
  // partially-failed one leaves `sharedConfirmed` exactly as it was (the
  // per-collection/direct watermark above stays un-advanced too, so the
  // NEXT tick retries the same collections and gets another chance to
  // confirm cleanly -- WR-05's "not permanently" without pretending
  // fetch-failed data is confirmed).
  if (!anyStepFailed) {
    sharedConfirmed = true;
    maybeMarkHydrated();
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

/** 28-03 (Task 4): drops the FULL decrypted shared cache (both collection-
 * and direct-share halves) plus both watermarks and failed-attempt
 * counters, and frees every cached Collection Key (via `collections.ts`'s
 * `clearCollectionsOnRemoval()`) -- the "you were genuinely removed
 * mid-session" purge, wired to `sync.ts`'s `onRemovedFromFamily` callback
 * below. Mirrors `extension/entrypoints/background/vault-store.ts`'s
 * `purgeSharedStateOnRemoval` byte-for-byte, minus `pendingSharedItems`
 * (web's own array set never had one -- confirmed absent, never invented
 * here).
 *
 * Routed through the SAME `sharedRefreshInFlight` chain
 * `handleSharedRevisions` uses (WR-11's re-entrancy guard) rather than
 * mutating module state directly -- so this purge can never race a
 * concurrently in-flight merge.
 *
 * KEY-06 adjacency (this plan's single most important boundary): touches
 * ONLY `collectionSharedItems`/`directSharedItems`/`collections.ts`'s own
 * Collection-Key cache and their watermarks -- NEVER `personalItems`,
 * `folders`, or any other part of `items` beyond what `recomputeItems()`
 * naturally recomputes from the now-empty shared arrays. */
export function purgeSharedStateOnRemoval(): Promise<void> {
  sharedRefreshInFlight = sharedRefreshInFlight
    .then(() => {
      clearCollectionsOnRemoval();
      collectionSharedItems = [];
      directSharedItems = [];
      collectionRevisionWatermark = new Map();
      directRevisionWatermark = 0;
      sharedRevisionsWatermark = { collections: new Map(), direct: 0 };
      collectionFailedMergeAttempts = new Map();
      directFailedMergeAttempts = 0;
      recomputeItems();
    })
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
    // 28-03 (Task 4, plan-review blocker fix): this is the SECOND, EARLIER
    // call site to getSharedRevisions() -- called from the subscribeLockState
    // unlock branch below, immediately BEFORE startSync(syncCallbacks) (the
    // synchronous flag-reset inside startSync() always completes first
    // regardless of this call order, since getSharedRevisions() is a genuine
    // network await -- confirmed by reading both call sites together). Arm
    // sync.ts's discriminant HERE too, via the same exported setter
    // pullOnce() itself calls on success -- without this line, a member
    // removed after this eager refresh already cached shared plaintext would
    // have pullOnce()'s first shared 404 misread as "never had a family"
    // (flag still false) and skip the purge.
    markFamilyMembershipConfirmed();
    if (getUnlockedUserKey() === null) {
      return;
    }
    await handleSharedRevisions(revisions);
  } catch (err) {
    if (isNotFoundError(err)) {
      // Expected for a single-user vault (no family_members row) -- a
      // DEFINITIVE "no shared items exist" answer, not an unknown, so the
      // shared pipeline is genuinely confirmed here too (CR-01).
      sharedConfirmed = true;
      maybeMarkHydrated();
      return;
    }
    // CR-01/WR-05: any OTHER failure (transient network, etc.) must NOT be
    // read as "shared items confirmed empty" -- leave `sharedConfirmed`
    // false so `hydrated` stays withheld, and let the rejection surface to
    // the caller (the unlock branch below) rather than silently swallowing
    // it. The WS/poll path in sync.ts is still self-healing regardless: its
    // own `onSharedRevisions` callback (`handleSharedRevisions`) will
    // eventually succeed on a later tick and confirm the pipeline then.
    throw err;
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
  // 28-03 (Task 4): a 404 arriving after this session has ever confirmed
  // family membership (from either call site -- see sync.ts's own doc
  // comment) is a genuine mid-session removal, not "no family" -- purge the
  // shared cache instead of leaving stale plaintext latched in.
  onRemovedFromFamily: purgeSharedStateOnRemoval,
  // 30-13 (FSH-02): fire-and-forget, mirroring `onSharedRevisions`'s own
  // "never awaited by pullOnce" contract -- a slow reseal (a WASM unwrap
  // plus one POST per pending recipient) must never block the sync loop.
  // `runFamilyWideResealTrigger` never rejects, so the `void` here discards
  // nothing that could become an unhandled rejection. Locked sessions are
  // skipped outright: the trigger needs a live User Key to unwrap the
  // caller's own sealed_key with.
  onFamilyWidePending: () => {
    const uk = getUnlockedUserKey();
    if (uk !== null) {
      void runFamilyWideResealTrigger(uk);
    }
  },
};

// 30-15 (FSH-02): the synthetic pending rows above are derived state, and
// their source refreshes on its own schedule (sync.ts's pull cycle calls
// `refreshFamilyWidePending()` once per pull). Without this subscription a
// pending row would be merely "correct once" -- correct in a test that
// primes the snapshot before importing the store, and permanently absent (or
// permanently stale after the key arrived) in the running app, where the
// discovery response lands long after the item list has painted. Recomputing
// from the CURRENT snapshot on every completed refresh is also what makes
// the row self-resolving: the pass that no longer sees the grant is the pass
// that drops the placeholder.
subscribeFamilyWidePending(() => {
  recomputeItems();
});

subscribeLockState(() => {
  if (isUnlocked()) {
    // Arm "not yet known" FIRST, before any async work starts -- every
    // unlock re-opens the hydration window even if a previous unlock had
    // already resolved it.
    setHydrated(false);
    personalConfirmed = false;
    sharedConfirmed = false;
    sharedRevisionsWatermark = { collections: new Map(), direct: 0 };
    failedSharedRefreshAttempts = 0;
    collectionRevisionWatermark = new Map();
    directRevisionWatermark = 0;
    collectionFailedMergeAttempts = new Map();
    directFailedMergeAttempts = 0;
    // 30-13 (FSH-02): a new unlock is a new session for the reseal trigger
    // too -- clear the attempted-pair set alongside the latches above, so a
    // pair whose attempt failed transiently last session is re-attempted
    // against this session's fresh snapshot rather than staying stranded.
    resetFamilyWideResealAttempts();
    // CR-01 (code review, Phase 29): these used to be two independent,
    // unawaited fire-and-forget calls, with ONLY the first one (personal
    // items) ever setting `hydrated`. That let `hydrated === true` while
    // the shared pipeline (the ONLY source of `accessLevel ===
    // "hidden_password"` collection/direct items) was still genuinely
    // unknown -- exactly the gap ExportDialog's DEBT-02 disclosure exists to
    // prevent. `hydrated` itself is now armed from INSIDE each pipeline
    // (`applySyncSnapshot`'s `personalConfirmed`, `doHandleSharedRevisions`'/
    // `refreshSharedItemsNow`'s `sharedConfirmed`, via `maybeMarkHydrated()`)
    // once BOTH have completed a genuine attempt -- this `.then()` only logs
    // a rejected leg (WR-05), it never sets `hydrated` directly, so a later
    // successful background poll can still recover a session whose initial
    // attempt failed.
    void Promise.allSettled([loadAndDecryptAll(), refreshSharedItemsNow()]).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          console.error(
            "pv: initial vault load failed -- item hydration unresolved, retrying via background sync",
            result.reason,
          );
        }
      }
    });
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
    setHydrated(false);
    personalConfirmed = false;
    sharedConfirmed = false;
  }
});
