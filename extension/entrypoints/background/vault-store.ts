// entrypoints/background/vault-store.ts — background-only decrypted
// item/folder cache; the ONE place plaintext vault data is held in this
// extension outside pv-wasm's own memory (T-09-18). Ported from
// web/src/lib/vault/store.ts's decrypt/merge logic -- same wholesale-replace
// merge, same re-check-getUnlockedUserKey()-before-decrypt guard -- wired to
// vault-session.ts's lock state (subscribeSessionLockState/isSessionUnlocked)
// instead of web's lib/crypto/index.ts.
//
// 27-04-PLAN.md (Task 1, THE PHASE'S TRACER): this is the biggest single
// port in the phase (27-PATTERNS.md). Ported wholesale from
// web/src/lib/vault/store.ts:
//   - the THREE-SOURCE merge (personalItems/collectionSharedItems/
//     directSharedItems -> recomputeItems() -> the public `items`), same
//     id-collision-last-writer-wins rule.
//   - decryptItemRow's scope dispatch (personal User Key vs. a collection's
//     own Collection Key by row.collection_id), fail-loud on a missing
//     Collection Key -- AEAD makes a wrong-key decrypt fail loudly (safe);
//     silently falling back to the personal key would not.
//   - decryptDirectSharedRow / mergeCollectionSnapshot / mergeDirectSnapshot
//     / doHandleSharedRevisions's orchestration (per-collection watermark
//     map, direct watermark, bounded-withhold-on-partial-failure discipline,
//     the WR-11 re-entrancy guard).
//
// NEW relative to web (this extension's own addition, no web counterpart):
// the pending-vs-broken decrypt classification. web's `refreshSharedItemsNow()`
// always runs `refreshCollectionsNow()` to completion BEFORE the FIRST ever
// item decrypt attempt in a browser tab's lifetime (React effects settle
// before any render reads `getCollectionKey()`), so web never needs a
// "pending" concept -- by the time an item is decrypted, the collections
// store has always already refreshed at least once. An MV3 service worker
// has no such ordering guarantee: a cold wake can decrypt a personal-sync
// snapshot (which MAY include collection-scoped items the caller authored)
// before `ensureVaultSyncStarted()`'s own `refreshCollectionsNow()` call has
// resolved. `CollectionKeyPendingError` (below) distinguishes "the key isn't
// cached YET, collections store hasn't refreshed this session" (transient,
// self-heals) from "the key is genuinely unresolvable even after a refresh"
// (broken) -- `collections-store.ts`'s `hasRefreshedThisSession()` is the
// signal. Both classifications are surfaced via `getPendingSharedItems()`
// (see that function's own doc comment for the explicit retain-vs-drop
// decision this makes, per UI-SPEC's E1-error backstop) -- NEVER simply
// absent from `vault.list` with no trace.
//
// Pitfall 4 / T-09-18 / A-3: locking the vault stops sync BEFORE clearing
// the in-memory decrypted cache AND the new identity/Collection-Key caches,
// in that exact order, all inside this SAME `subscribeSessionLockState`
// handler -- never a second listener (27-PATTERNS.md Pitfall 4). Verified by
// vault-store.test.ts's Test 4 (asserts call ORDER via mock invocation
// timing, not just final state).
import { browser } from "wxt/browser";
import {
  decryptItem,
  decryptItemForCollection,
  decryptItemWithSharedKey,
  unsealCollectionKey,
  type WasmIdentityKey,
  type WasmUserKey,
} from "../../lib/crypto/wasm-loader";
import { getUnlockedUserKey, isSessionUnlocked, subscribeSessionLockState } from "./vault-session";
import { startSync, stopSync } from "./sync-client";
import {
  getCollectionSync,
  getSharedDirectSync,
  getSharedRevisions,
  getSyncSnapshot,
  touchItem,
  type DirectSharedItemRow,
  type FolderRow,
  type ItemRow,
  type SharedCollectionItemsResponse,
  type SharedDirectSyncResponse,
  type SharedRevisions,
  type SyncSnapshot,
} from "./vault-api";
import {
  freeAllCollectionKeys,
  getCollectionAccessLevel,
  getCollectionKey,
  hasRefreshedThisSession,
  refreshCollectionsNow,
} from "./collections-store";
import { ensureOwnIdentityKeypair, freeIdentityKey } from "./identity-store";
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

/** 27-04 (Task 1): thrown by decryptItemRow's collection-scoped branch when
 * `getCollectionKey()` is `undefined` AND `collections-store.ts`'s
 * `hasRefreshedThisSession()` is still `false` -- the key isn't cached YET
 * because the collections store hasn't finished its FIRST refresh this
 * session, not because it's genuinely unresolvable. A NEW, distinct error
 * class (not web's `CollectionKeyUnavailableError`, which means "broken") so
 * the calling merge loop can catch this SEPARATELY and record the row into
 * `pendingSharedItems` instead of counting it toward BUG-3's dropped-row
 * bookkeeping -- see `decryptItemRow`'s own doc comment for the full
 * pending-vs-broken rationale. */
export class CollectionKeyPendingError extends Error {
  constructor(collectionId: string) {
    super(
      `no cached Collection Key for collection ${collectionId} yet -- collections store has not completed its first refresh this session (pending, not broken)`,
    );
    this.name = "CollectionKeyPendingError";
  }
}

// 27-04 (Task 1, A-1's three-source merge -- ported from
// web/src/lib/vault/store.ts): every read (`getItems()`, every internal
// lookup) sees the union, so an item this caller merely has ACCESS to (not
// necessarily created) is exactly as visible as one they created.
//
// - `personalItems`: GET /api/sync's own scope (`fetch_items_for`,
//   unchanged) -- every item the CALLER owns, personal or created inside a
//   collection they belong to.
// - `collectionSharedItems`: GET /api/vault/collections/{id}/sync
//   (`pull_shared_collection`) -- a SUPERSET of any collection's items
//   (every author, not just the caller's own) for every collection the
//   caller currently holds a `collection_keys` row for.
// - `directSharedItems`: GET /api/sync/shared/direct (`pull_shared_direct`)
//   -- personal items OWNED BY SOMEONE ELSE, shared directly to this caller
//   via `item_shares`.
let personalItems: VaultItem[] = [];
let collectionSharedItems: VaultItem[] = [];
let directSharedItems: VaultItem[] = [];
let items: VaultItem[] = [];
let folders: Folder[] = [];

// 27-12 (Blocker 1 gap closure): a row this caller has access to but could
// not be decrypted this pass -- either "pending" (CollectionKeyPendingError,
// transient) or "broken" (any other decrypt failure on a collection-scoped
// row, e.g. the Collection Key resolved but the ciphertext's own integrity
// check failed). Both classifications land in this SAME array/shape (27-04's
// original decision, preserved) -- but each entry NOW carries an explicit
// `status` discriminant so the popup (ItemListView.tsx) can finally tell the
// two apart and render a "broken" row as a terminal, honest warning instead
// of an indefinite skeleton (UI-SPEC's E2-error backstop). See
// `getPendingSharedItems()`'s own doc comment for the full reasoning.
//
// 27-15 (27-VERIFICATION.md's direct-share silent-drop gap, sibling of
// Blocker 1): `collectionId` is now `string | null` -- a directly-shared
// row (`mergeDirectSnapshot`'s catch, below) has no collection at all, so it
// records `null` here. The ONE consumer that reads `collectionId` on this
// array (`doHandleSharedRevisions`'s revoked-collection purge, `p.collectionId
// !== knownId`) already treats a non-matching value as "leave this entry
// alone" -- `null !== knownId` is always true for a real collection id, so a
// direct-share entry is correctly never touched by that purge. The popup
// (`ItemListView.tsx`) needs no change at all: its broken-row branch renders
// from `{id, status}` only.
export interface PendingSharedItemEntry {
  id: string;
  collectionId: string | null;
  status: "pending" | "broken";
}
let pendingSharedItems: PendingSharedItemEntry[] = [];

// Last vault_revision this client has merged -- the `since` watermark for
// every catch-up/poll pull. Reset to 0 on lock so a re-unlock always pulls
// a full snapshot again.
let lastKnownRevision = 0;

// 27-04 (Task 1, ported from web's WINDOWS #8/#9 watermarks): one entry per
// collection the caller is a member of (a collection carries its own
// independent revision counter, SYNC-04) and a single synthetic bucket for
// the direct-share revision. Reset to empty on every unlock.
let collectionRevisionWatermark = new Map<string, number>();
let directRevisionWatermark = 0;

// 27-04 (Task 1, ported from web's WR-07): bounded-withhold-on-partial-
// failure counters -- a TRANSIENT failure is worth retrying (withhold the
// watermark so the next tick re-fetches), a PERSISTENT one must not become a
// permanent re-fetch-every-tick loop. Reset on any fully clean merge and on
// every unlock.
const MAX_FAILED_MERGE_RETRIES = 3;
let collectionFailedMergeAttempts = new Map<string, number>();
let directFailedMergeAttempts = 0;

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

/** Rebuilds the public `items` merge from the three sources above and
 * notifies every subscriber -- the ONE place `items` is ever reassigned.
 * Later sources win an id collision. Ported verbatim from
 * web/src/lib/vault/store.ts's recomputeItems. */
function recomputeItems(): void {
  const byId = new Map<string, VaultItem>();
  for (const item of personalItems) byId.set(item.id, item);
  for (const item of collectionSharedItems) byId.set(item.id, item);
  for (const item of directSharedItems) byId.set(item.id, item);
  items = Array.from(byId.values());
  notifyListeners();
}

/** Writes `updated` into whichever of the three sources currently holds
 * `id` (all three are checked -- exactly one will actually match in
 * practice). Falls back to `personalItems` when `id` is present in none of
 * them yet. Ported from web's replaceItemInSources -- used by
 * touchVaultItem below (this extension's only local mutator; capture-
 * handler.ts writes through vault-api.ts directly and lets the next sync
 * pull pick up the change). */
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

/** Records/updates `id`'s pending-vs-broken classification -- an UPSERT, not
 * merely an insert (27-12, Blocker 1 gap closure): a row already recorded
 * (e.g. classified "pending" on an earlier attempt, before its Collection
 * Key had resolved) has its `status` REPLACED in place by a later call
 * rather than being ignored, since the SAME row can classify differently on
 * a later attempt once `hasRefreshedThisSession()` flips true (see
 * `decryptItemRow`'s own doc comment for the discriminant). Never appends a
 * duplicate entry for an `id` already present -- at most one entry per id,
 * always. See `getPendingSharedItems()`'s own doc comment for the full
 * retain-vs-drop rationale. */
function markPending(id: string, collectionId: string | null, status: "pending" | "broken"): void {
  const existingIndex = pendingSharedItems.findIndex((p) => p.id === id);
  if (existingIndex === -1) {
    pendingSharedItems = [...pendingSharedItems, { id, collectionId, status }];
  } else if (pendingSharedItems[existingIndex].status !== status) {
    pendingSharedItems = pendingSharedItems.map((p, i) => (i === existingIndex ? { ...p, status } : p));
  }
}

/** Clears a previously-recorded pending/broken entry once its row decrypts
 * successfully -- a no-op if `id` was never recorded. */
function clearPending(id: string): void {
  if (pendingSharedItems.some((p) => p.id === id)) {
    pendingSharedItems = pendingSharedItems.filter((p) => p.id !== id);
  }
}

/**
 * 27-04 (Task 1): the popup's read of the pending/broken stub list -- the
 * mechanism that discharges this plan's must_haves.prohibitions truth ("the
 * extension must not silently drop a shared item the user has access to").
 *
 * EXPLICIT retain-vs-drop decision (UI-SPEC E1-error backstop, stated here
 * rather than inherited by default): a collection-scoped row that fails to
 * decrypt is ALWAYS dropped from the decrypted `items` array (BUG-3's
 * existing skip/drop discipline, unchanged) -- this extension, unlike web,
 * retains no last-known-good fallback copy to show instead. But it is ALSO
 * ALWAYS recorded here, in this array, regardless of WHETHER the failure was
 * classified "pending" (`CollectionKeyPendingError`, the key genuinely isn't
 * cached yet) or "broken" (any other decrypt failure once the collections
 * store has completed its first refresh this session -- e.g. the key
 * resolved but the ciphertext's own AEAD integrity check failed). Both
 * classifications share this ONE array/shape rather than a second "broken"
 * list: a single, always-populated channel is what makes the "never simply
 * absent, never a trace-free silent drop" guarantee hold for BOTH cases
 * without a popup consumer having to know which classification produced a
 * given entry.
 *
 * 27-12 (Blocker 1 gap closure): each entry now ALSO carries an explicit
 * `status: "pending" | "broken"` discriminant, computed by the SAME
 * `CollectionKeyPendingError`-vs-generic-failure signal `decryptItemRow`
 * already derives internally (itself gated on `hasRefreshedThisSession()`).
 * `markPending()` UPSERTS this field on every reattempt -- a row first
 * observed "pending" (personal-sync raced ahead of the collections refresh)
 * is re-attempted on the very next `doHandleSharedRevisions` pass for its
 * own collection (every collection is pulled unconditionally on the FIRST
 * such pass each session, since `collectionRevisionWatermark` starts empty);
 * if it STILL fails once `hasRefreshedThisSession()` is true,
 * `mergeCollectionSnapshot`'s catch correctly upgrades it to "broken" via
 * that same upsert, rather than leaving the FIRST classification
 * permanently stuck. This is what makes UI-SPEC's E2-error backstop
 * dischargeable: `ItemListView.tsx` can now render a "broken" entry as a
 * terminal, honest warning instead of an indefinite skeleton.
 *
 * 27-15 (27-VERIFICATION.md's direct-share silent-drop gap, sibling of
 * Blocker 1): `mergeDirectSnapshot`'s catch (below) now records a failed
 * directly-shared row here too, with `collectionId: null` (a direct share
 * has none). Its discriminant is ALWAYS "broken", never "pending" -- see
 * `mergeDirectSnapshot`'s own catch comment for why the collection-scoped
 * "not cached YET" transient state has no analogue on this path.
 */
export function getPendingSharedItems(): PendingSharedItemEntry[] {
  return pendingSharedItems;
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

/** Fire-and-forget "this item's secret was just used" signal (NordPass-style
 * last-used tracking, quick-260717) -- the SINGLE choke-point every
 * fill/TOTP-code/passkey-ceremony/popup-copy call site in this extension
 * must go through; never call `touchItem` from `./vault-api` directly.
 * Never awaited by callers: a failed/offline touch must NEVER break or
 * delay the fill/copy/ceremony it accompanies (catch + debug-log only, no
 * error surfaced to the caller). Never call this for mere viewing/listing
 * -- only when a fill/copy/ceremony actually surfaces the item's secret
 * value.
 *
 * On success, optimistically updates the in-memory item's `lastUsedAt`
 * (via replaceItemInSources -- 27-04's three-source-aware write-through, so
 * a shared item's touch is written into whichever source actually holds it)
 * and notifies listeners, so an open popup's "Wszystkie" sort reflects the
 * touch immediately -- other devices pick up the new value on their next
 * pull/snapshot (no dedicated WS `SyncEvent` is broadcast for a touch; see
 * crates/pv-server/src/routes/vault.rs's `touch()` doc comment for why).
 */
export function touchVaultItem(id: string): void {
  void touchItem(id)
    .then((res) => {
      const existing = items.find((item) => item.id === id);
      if (existing === undefined) return;
      replaceItemInSources(id, { ...existing, lastUsedAt: res.last_used_at });
    })
    .catch((err) => {
      console.debug("[passkey-vault] touchVaultItem failed (non-fatal, fire-and-forget)", id, err);
    });
}

/**
 * 27-04 (Task 1, A-1's central dispatch, ported from
 * web/src/lib/vault/store.ts's decryptItemRow): decrypts one row's
 * `enc_key`/`enc_data` under the CORRECT key for its scope --
 * `row.collection_id === null` -> the caller's personal User Key;
 * otherwise -> that collection's own Collection Key, looked up
 * SYNCHRONOUSLY via `getCollectionKey()`.
 *
 * Fails LOUD (throws) on a missing Collection Key rather than falling back
 * to `decryptItem(uk, ...)` -- AEAD makes a wrong-key decrypt fail loudly
 * (safe) but a wrong-key ENCRYPT would succeed silently (catastrophic); this
 * extension is read-only for collection-scoped items this phase, but the
 * discipline is ported unconditionally per 27-PATTERNS.md's "Fail-loud on
 * missing Collection Key" shared pattern.
 *
 * `CollectionKeyPendingError` vs. a generic `Error` (see that class's own
 * doc comment): distinguishes "not cached YET" from "genuinely
 * unresolvable" using `hasRefreshedThisSession()` -- an extension-only
 * addition with no web counterpart (web never decrypts before its own
 * collections store has completed its first refresh; an MV3 wake has no
 * such ordering guarantee).
 */
function decryptItemRow(row: ItemRow, uk: WasmUserKey): VaultItem {
  const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
  let plaintext: string;
  if (row.collection_id === null) {
    plaintext = decryptItem(uk, combined, row.id, row.revision);
  } else {
    const ck = getCollectionKey(row.collection_id);
    if (ck === undefined) {
      if (!hasRefreshedThisSession()) {
        throw new CollectionKeyPendingError(row.collection_id);
      }
      throw new Error(
        `no cached Collection Key for collection ${row.collection_id} -- the key is unresolvable even after a refresh`,
      );
    }
    plaintext = decryptItemForCollection(ck, combined, row.collection_id, row.id, row.revision);
  }
  // normalizeItemFields migrates a legacy login item's bare `url: string`
  // into `urls: string[]` -- the only place that legacy shape is ever read.
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
    // Set here (not only in mergeCollectionSnapshot below) so the caller's
    // OWN copy of a collection-scoped item -- which also arrives via
    // GET /api/sync, in `personalItems` -- carries the same access level:
    // otherwise there is a window, before the collection pull lands, where
    // the same item renders as freely editable. Mirrors web's own rationale
    // (store.ts:361-373).
    accessLevel:
      row.collection_id === null ? undefined : getCollectionAccessLevel(row.collection_id),
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

/** The ONE merge implementation for the PERSONAL scope (`GET /api/sync`),
 * shared by initial load (unlock) and ongoing background sync (WS/poll via
 * sync-client.ts). A stale snapshot's items/folders arrays replace
 * `personalItems`/`folders` WHOLESALE -- a server-side deletion is reflected
 * simply by the deleted id's absence from the new array (no tombstones, no
 * diff pass). An up-to-date snapshot (no items/folders keys) leaves the
 * in-memory state completely untouched -- but still advances the revision
 * watermark, otherwise the NEXT poll tick would immediately re-detect
 * "stale" against a revision the client already knows about.
 *
 * 27-04 (Task 1): the per-row try/catch now catches `CollectionKeyPendingError`
 * SEPARATELY from any other decrypt failure -- see `getPendingSharedItems()`'s
 * own doc comment for the explicit retain-vs-drop decision this makes for
 * BOTH classifications. */
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
        clearPending(row.id);
      } catch (err) {
        if (err instanceof CollectionKeyPendingError && row.collection_id !== null) {
          // Pending -- collections store hasn't completed its first refresh
          // this session yet. Recorded for getPendingSharedItems() instead
          // of counting toward the `skipped` bookkeeping below: this row
          // WILL resolve once refreshCollectionsNow() completes, it is not
          // "broken."
          markPending(row.id, row.collection_id, "pending");
          continue;
        }
        // Generic failure -- a personal row's own decrypt error, OR a
        // collection-scoped row whose Collection Key resolved but the
        // decrypt/AEAD integrity check still failed ("genuinely broken",
        // status: "broken" -- the UI-SPEC E2-error case this discriminant
        // exists for). BUG-3: never abort the whole merge. A
        // collection-scoped row here is STILL recorded into
        // pendingSharedItems (same array/shape as the pending case) so it is
        // never simply absent with no trace -- see getPendingSharedItems()'s
        // own doc comment for why both classifications share one channel. A
        // personal row has no such stub path and is dropped exactly as
        // before.
        skipped += 1;
        if (row.collection_id !== null) {
          markPending(row.id, row.collection_id, "broken");
        }
      }
    }
    if (skipped > 0) {
      console.warn(`[passkey-vault] skipped ${skipped} undecryptable item(s) during sync`);
    }
    personalItems = decrypted;
    recomputeItems();
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

/** Merges ONE collection's full item snapshot
 * (`GET /api/vault/collections/{id}/sync`, `pull_shared_collection`) into
 * `collectionSharedItems`. Every row here already carries `collection_id`
 * set to `collectionId` (server-side construction) -- `decryptItemRow`'s
 * EXISTING scope dispatch decrypts it with zero new branching, via the SAME
 * `getCollectionKey` cache `collections-store.ts` maintains.
 * `response.items === undefined` (the cheap-check's up-to-date shape) is a
 * silent no-op beyond recording the watermark. Ported from
 * web/src/lib/vault/store.ts's mergeCollectionSnapshot, applying the SAME
 * pending-vs-broken distinction as `applySyncSnapshot` above inside this
 * row loop (27-PATTERNS.md/this plan's own instruction). Returns `false` if
 * ANY row failed -- WR-07's bounded-withhold discipline: the caller
 * (`doHandleSharedRevisions`) must withhold the OUTER shared-revisions
 * watermark too when this returns `false`. */
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
  let anyRowFailed = false;
  const decrypted: VaultItem[] = [];
  for (const row of response.items) {
    try {
      decrypted.push(decryptItemRow(row, uk));
      clearPending(row.id);
    } catch (err) {
      anyRowFailed = true;
      console.warn(
        `[passkey-vault] failed to decrypt shared-collection item ${row.id} (collection ${collectionId})`,
        err,
      );
      // Same explicit decision as applySyncSnapshot: pending AND broken both
      // surface via getPendingSharedItems() -- see that function's own doc
      // comment. This loop runs strictly AFTER doHandleSharedRevisions has
      // already awaited refreshCollectionsNow(), so hasRefreshedThisSession()
      // is normally already true by the time this catch fires (making
      // CollectionKeyPendingError here rare but not impossible -- e.g. that
      // refresh itself failed) -- 27-12 (Blocker 1): compute the SAME
      // discriminant applySyncSnapshot's catch does, so a row first marked
      // "pending" by a personal-sync race is correctly upgraded to "broken"
      // here if it still fails once the key has genuinely resolved.
      const status = err instanceof CollectionKeyPendingError ? "pending" : "broken";
      markPending(row.id, collectionId, status);
    }
  }
  // Replace EVERY previously-cached item for THIS collection id -- never a
  // partial merge, mirrors pull_shared_collection's own always-full-
  // snapshot contract.
  collectionSharedItems = [
    ...collectionSharedItems.filter((item) => item.collectionId !== collectionId),
    ...decrypted,
  ];
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
  return !anyRowFailed;
}

/** Decrypts ONE directly-shared row via the recipient-side crypto sequence:
 * unseal `row.sealed_key` with the caller's own identity keypair to recover
 * the item's Cipher Key, then `decryptItemWithSharedKey` -- NEVER
 * `decryptItem`/`decryptItemForCollection` (this item is neither personal
 * nor collection-scoped from THIS recipient's own perspective). Ported
 * verbatim from web/src/lib/vault/store.ts's decryptDirectSharedRow. */
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
    // The OWNERSHIP discriminant -- `true` ONLY for rows sourced from this
    // read path. See VaultItem.sharedToMe's own doc comment (pv-ui/vault/
    // types.ts) for why the UI cannot infer this from isShared/collectionId
    // alone (CR-02, Phase 26).
    sharedToMe: true,
    // THIS recipient's own grant -- what makes hidden_password mean
    // anything at all on a recipient surface.
    accessLevel: row.access_level,
  };
}

/** Merges the caller's full directly-shared-item snapshot
 * (`GET /api/sync/shared/direct`, `pull_shared_direct`) into
 * `directSharedItems`. `response.items === undefined` (up-to-date) is a
 * silent no-op beyond recording the watermark. Resolves the caller's own
 * identity keypair ONCE per call (mirrors collections-store.ts's identical
 * one-resolution-per-refresh discipline), freed in `finally` regardless of
 * outcome. Ported from web/src/lib/vault/store.ts's mergeDirectSnapshot. */
async function mergeDirectSnapshot(
  response: SharedDirectSyncResponse,
  uk: WasmUserKey,
): Promise<boolean> {
  if (response.items === undefined) {
    directRevisionWatermark = response.revision;
    directFailedMergeAttempts = 0;
    return true;
  }
  let anyRowFailed = false;
  const identityKey = await ensureOwnIdentityKeypair(uk);
  try {
    // WR-15: identity, not mere nullity -- a lock-then-unlock cycle
    // mid-flight installs a BRAND NEW WasmUserKey and frees this one, so a
    // `=== null` guard passes while `uk` is stale.
    if (getUnlockedUserKey() !== uk) {
      return false;
    }
    const decrypted: VaultItem[] = [];
    for (const row of response.items) {
      try {
        decrypted.push(decryptDirectSharedRow(row, identityKey));
        clearPending(row.id);
      } catch (err) {
        anyRowFailed = true;
        console.warn(`[passkey-vault] failed to decrypt directly-shared item ${row.id}`, err);
        // 27-15 (27-VERIFICATION.md's direct-share silent-drop gap, sibling
        // of Blocker 1 -- 27-12 closed the SAME violation on the
        // collection-scoped path via mergeCollectionSnapshot's catch, this
        // one was missed): record the row via getPendingSharedItems()
        // instead of letting it vanish with only a console.warn -- the SAME
        // "never simply absent, never a trace-free silent drop" guarantee
        // applySyncSnapshot/mergeCollectionSnapshot already give every
        // collection-scoped row.
        //
        // Discriminant reasoning (this plan's own instruction: reason about
        // the correct pending-vs-broken split HERE rather than copying the
        // collection-scoped logic verbatim): the collection path's
        // "pending" state exists because `getCollectionKey()` is a
        // SYNCHRONOUS read of a cache that may not have finished its FIRST
        // refresh yet (`hasRefreshedThisSession()` gates that window). This
        // path has no such window -- `identityKey` above is already fully
        // resolved, AWAITED, before this loop ever starts, unconditionally,
        // for every row in this pull. So a failure reaching this catch was
        // attempted with a fully-resolved identity key already in hand: it
        // is either a `sealed_key` that genuinely does not unseal under
        // THIS recipient's own identity key, or an `enc_data` whose AEAD
        // integrity check genuinely fails -- both terminal, neither
        // "haven't looked yet." There is nothing left for a later reattempt
        // to resolve that this attempt did not already try, fully. This
        // path therefore classifies "broken" immediately -- it never
        // produces a "pending" entry, unlike the collection-scoped path.
        markPending(row.id, null, "broken");
      }
    }
    // Replace the WHOLE direct-shared set -- pull_shared_direct always
    // returns the caller's FULL current direct-share set on a non-up-to-
    // date response, so a revoked share's absence is exactly how its
    // removal is represented.
    directSharedItems = decrypted;
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
    return !anyRowFailed;
  } finally {
    identityKey.free?.();
  }
}

// 27-04 (Task 1, ported from web's own watermark): the last-known
// per-collection/direct revision watermark this client has already merged.
// A mismatch on ANY field means a co-member's shared edit landed and this
// client hasn't pulled it yet. Reset to empty on every unlock.
let sharedRevisionsWatermark: { collections: Map<string, number>; direct: number } = {
  collections: new Map(),
  direct: 0,
};
let failedSharedRefreshAttempts = 0;

function sharedRevisionsChanged(revisions: SharedRevisions): boolean {
  if (revisions.direct.revision !== sharedRevisionsWatermark.direct) {
    return true;
  }
  for (const collection of revisions.collections) {
    if (sharedRevisionsWatermark.collections.get(collection.id) !== collection.revision) {
      return true;
    }
  }
  // A collection present in the watermark but ABSENT from the new payload
  // means membership was revoked/removed -- also a genuine change.
  const currentIds = new Set(revisions.collections.map((collection) => collection.id));
  for (const knownId of sharedRevisionsWatermark.collections.keys()) {
    if (!currentIds.has(knownId)) {
      return true;
    }
  }
  return false;
}

/** On a watermark mismatch: (1) refresh collections-store.ts FIRST (a
 * member added to a collection previously never saw it, or gained a usable
 * Collection Key, until this refresh), (2) for every collection whose
 * revision actually moved, pull its own item snapshot and merge it, purging
 * any collection the caller is no longer a member of, and (3) if the direct
 * bucket moved, pull and merge it. An unchanged payload is a silent no-op.
 * Every awaited step re-checks `getUnlockedUserKey()` before touching module
 * state (a lock event may fire while any round trip is in flight). Ported
 * from web/src/lib/vault/store.ts's doHandleSharedRevisions. */
async function doHandleSharedRevisions(revisions: SharedRevisions): Promise<void> {
  if (!sharedRevisionsChanged(revisions)) {
    return;
  }
  if (getUnlockedUserKey() === null) {
    return;
  }

  let anyStepFailed = false;

  try {
    await refreshCollectionsNow();
  } catch {
    // Transient network failure -- the next revisions tick retries.
    anyStepFailed = true;
  }
  if (getUnlockedUserKey() === null) {
    return;
  }

  // Collections the caller is no longer a member of (revoked/removed):
  // purge any previously-cached items AND pending entries for them -- must
  // not leave a stale copy visible after access is genuinely gone.
  const currentCollectionIds = new Set(revisions.collections.map((collection) => collection.id));
  for (const knownId of Array.from(collectionRevisionWatermark.keys())) {
    if (!currentCollectionIds.has(knownId)) {
      collectionRevisionWatermark.delete(knownId);
      collectionSharedItems = collectionSharedItems.filter((item) => item.collectionId !== knownId);
      pendingSharedItems = pendingSharedItems.filter((p) => p.collectionId !== knownId);
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
        return; // WR-15
      }
      if (!mergeCollectionSnapshot(collection.id, response, uk)) {
        anyStepFailed = true;
      }
    } catch {
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
        anyStepFailed = true;
      }
    }
  }

  recomputeItems(); // covers the purge-only case above with no new merge call
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

/** WR-11 (re-entrancy guard): `handleSharedRevisions` can be fired by both
 * the eager unlock-time pull below AND (once sync-client.ts's Task 2 wires
 * it) every WS/poll tick, and neither caller awaits the other -- so two
 * invocations could overlap freely while `doHandleSharedRevisions` mutates
 * module-level state across a long await chain. Serializing on a
 * module-level in-flight promise makes each invocation see a settled state.
 * Ported verbatim from web/src/lib/vault/store.ts's identical guard. */
let sharedRefreshInFlight: Promise<void> = Promise.resolve();

export function handleSharedRevisions(revisions: SharedRevisions): Promise<void> {
  sharedRefreshInFlight = sharedRefreshInFlight
    .then(() => doHandleSharedRevisions(revisions))
    .catch(() => {});
  return sharedRefreshInFlight;
}

/** Eager first attempt at the SAME refresh `handleSharedRevisions` performs
 * on every subsequent WS/poll tick -- called directly on unlock (from
 * `ensureVaultSyncStarted()` below) so a shared collection/direct item is
 * visible without waiting for the first background tick. 404-tolerant for a
 * single-user vault with no `family_members` row at all (expected and
 * silent, mirrors web's own `sharedPullDisabled`/`refreshSharedItemsNow()`
 * tolerance). */
async function refreshSharedItemsNow(): Promise<void> {
  try {
    const revisions = await getSharedRevisions();
    if (getUnlockedUserKey() === null) {
      return;
    }
    await handleSharedRevisions(revisions);
  } catch {
    // Expected for a single-user vault (no family_members row) and for any
    // transient network failure -- the next unlock/refresh self-heals.
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

// 27-13 (Blocker 2 gap closure): the shared-side counterpart to
// `initialPullSettled` above -- tracks the CURRENT unlock session's combined
// `refreshCollectionsNow()`/`refreshSharedItemsNow()` settlement so
// `ensureSharedItemsHydrated()` below can actually AWAIT it, mirroring
// `initialPullSettled`'s own WR-03 shape for the shared/Collection-Key side
// of the cache. Reset to `null` on every lock (same position as
// `initialPullSettled`) so a re-unlock always awaits a NEW settlement, never
// a stale promise from a previous session (T-09-19 discipline).
let initialSharedSettled: Promise<{ ok: true }> | null = null;

/**
 * Idempotent. Starts the sync transport + the initial getSyncSnapshot(0)
 * pull IF the session is unlocked and sync isn't already running; a no-op
 * otherwise (including on every call after the first while still
 * unlocked). The ONE implementation shared by the lock-state subscription
 * below (real unlock transition) and background.ts's wake path (an
 * already-unlocked wake with no transition to react to).
 *
 * 27-04 (Task 1): also refreshes collections-store.ts AND runs the eager
 * shared-revisions pull, gated by the SAME `syncStarted` flag -- a cold MV3
 * wake refreshes shared data exactly like a genuine unlock transition does
 * (this plan's own must_haves.key_links). Both are fire-and-forget /
 * self-healing, same discipline as the personal pull's own `.catch()`
 * below.
 */
export function ensureVaultSyncStarted(): void {
  if (syncStarted || !isSessionUnlocked()) {
    return;
  }
  syncStarted = true;
  // 27-04 (Task 2's own wiring point -- deviation, see this plan's SUMMARY:
  // Task 2's file list only names sync-client.ts, but without this line its
  // new onSharedRevisions extension is unreachable in production, since
  // sync-client.ts's SyncCallbacks type did not exist yet when Task 1 wrote
  // this call): every WS/poll tick now ALSO re-pulls shared revisions, not
  // only the eager one-shot call below.
  startSync({
    getSinceRevision: () => lastKnownRevision,
    onSnapshot: applySyncSnapshot,
    onSharedRevisions: handleSharedRevisions,
  });
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
  // 27-04 (A-1's eager shared pull, mirrors web's refreshSharedItemsNow()):
  // refresh the Collection Key cache once per unlock/wake regardless of
  // whether refreshSharedItemsNow()'s own watermark check would have
  // triggered it (a single-user vault with no shared collections at all
  // never trips sharedRevisionsChanged() on its first call, but this store
  // still needs `hasRefreshedThisSession()` to flip so a genuinely-broken
  // collection-scoped row can be classified correctly). Both calls are
  // fire-and-forget / self-healing -- 404-tolerant for a single-user vault
  // with no `family_members` row, same discipline as every other pull here.
  // 27-13 (Blocker 2 gap closure): identical calls to the two lines this
  // replaces (refreshCollectionsNow() / refreshSharedItemsNow(), each called
  // EXACTLY ONCE, same as before -- refreshSharedItemsNow() still races
  // refreshCollectionsNow() exactly as it did, since doHandleSharedRevisions
  // already awaits its own internal refreshCollectionsNow() call before
  // pulling any collection) -- this only ADDS an awaitable handle on their
  // combined settlement via Promise.allSettled (never rejects, matching this
  // pair's existing best-effort/self-healing contract) so
  // ensureSharedItemsHydrated() below has something to await.
  initialSharedSettled = Promise.allSettled([refreshCollectionsNow(), refreshSharedItemsNow()]).then(
    () => ({ ok: true as const }),
  );
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

/**
 * 27-13 (Blocker 2 gap closure): the shared-side counterpart to
 * `ensureItemsHydrated()` above -- awaits the CURRENT unlock session's
 * combined `refreshCollectionsNow()`/`refreshSharedItemsNow()` settlement
 * (the eager shared-item/Collection-Key resolution `ensureVaultSyncStarted()`
 * already kicks off on every unlock/wake) instead of the personal
 * `getSyncSnapshot(0)` pull `ensureItemsHydrated()` tracks.
 *
 * Kicks off `ensureVaultSyncStarted()` (idempotent, safe to call every time)
 * and returns a promise that resolves `{ ok: true }` once BOTH calls have
 * settled -- success or failure, since `Promise.allSettled` never rejects,
 * matching this pair's existing best-effort/self-healing contract (a
 * transient network failure here self-heals on the next poll/WS tick, same
 * as `refreshCollectionsNow()`/`refreshSharedItemsNow()`'s own individual
 * `.catch()` discipline before this function existed).
 *
 * IMPORTANT: this is a BEST-EFFORT barrier -- "the background did its best
 * to resolve shared state before you read `getItems()`" -- never a
 * guarantee that every shared item definitely landed (a slow/offline network
 * can still leave a row in `getPendingSharedItems()`'s pending/broken state
 * after this resolves). A caller's own existing empty/zero-candidate
 * handling still applies to whatever `getItems()` returns once this
 * settles.
 *
 * Single-flight and idempotent, mirroring `ensureItemsHydrated()`'s own
 * shape: every caller this session shares the SAME `initialSharedSettled`
 * promise. If the session is not unlocked (`ensureVaultSyncStarted()`
 * no-ops and `initialSharedSettled` is still `null`), resolves `{ ok: true
 * }` vacuously -- there is nothing to hydrate, mirroring
 * `ensureItemsHydrated()`'s own "nothing to hydrate while locked" branch.
 */
export function ensureSharedItemsHydrated(): Promise<{ ok: true }> {
  ensureVaultSyncStarted();
  if (initialSharedSettled === null) {
    return Promise.resolve({ ok: true });
  }
  return initialSharedSettled;
}

// Module-level side effect (mirrors web/src/lib/vault/store.ts's own
// subscribeLockState side effect): unlocking the vault starts the sync
// transport AND triggers an immediate getSyncSnapshot(0) pull (instant
// data without waiting for the WS handshake); locking stops the transport
// FIRST -- so no in-flight sync callback can fire after the arrays are
// cleared -- THEN resets the revision watermark and clears every in-memory
// array (personal/shared/pending) AND the new identity/Collection-Key
// caches (Pitfall 4 / T-09-18 / A-3, verified by vault-store.test.ts's
// Test 4 call-order assertion). Never a second subscribeSessionLockState
// listener -- 27-PATTERNS.md's Pitfall 4 explicitly forbids that shape;
// collections-store.ts/identity-store.ts export plain free functions with a
// documented caller-must-invoke contract, and THIS is the caller.
subscribeSessionLockState(() => {
  if (isSessionUnlocked()) {
    ensureVaultSyncStarted();
  } else {
    syncStarted = false; // re-arm the guard for the NEXT unlock
    initialPullSettled = null; // WR-03 (iteration 2): a re-unlock must await a NEW pull
    initialSharedSettled = null; // 27-13: same reasoning, shared/Collection-Key side
    stopSync(); // MUST run before the array-clear below
    // 27-04 (A-3/T-09-18): the new identity/Collection-Key caches clear
    // HERE, in the SAME position as every other clear this handler already
    // performs -- immediately AFTER stopSync(), so no in-flight sync
    // callback (personal OR shared) can repopulate them after this handler
    // is supposed to have cleared everything.
    freeAllCollectionKeys();
    freeIdentityKey();
    lastKnownRevision = 0;
    personalItems = [];
    collectionSharedItems = [];
    directSharedItems = [];
    items = [];
    pendingSharedItems = [];
    collectionRevisionWatermark = new Map();
    directRevisionWatermark = 0;
    collectionFailedMergeAttempts = new Map();
    directFailedMergeAttempts = 0;
    sharedRevisionsWatermark = { collections: new Map(), direct: 0 };
    failedSharedRefreshAttempts = 0;
    folders = [];
    notifyListeners();
  }
});
