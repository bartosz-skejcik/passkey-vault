// Vault items/folders API client for pv-server's /api/vault/* routes
// (Plan 02-03). Reuses `apiJson`'s base-URL/auth-header/wire-encoding/error-
// unwrapping logic from lib/auth/api rather than duplicating it — see that
// file's module comment. WR-11 (code review iteration 1): this module used
// to carry its own byte-identical copy of `apiJson` (only this one attached
// the parsed error body as `ApiClientError.details`) — deleted in favor of
// importing the shared, `details`-carrying implementation directly.
//
// WR-16 (code review, Phase 25): every `{...}` path segment below is wrapped
// in `encodeURIComponent` — see `lib/families/api.ts`'s own note for the full
// rationale. Not applied to `lib/passkeys/api.ts`, `lib/sessions/api.ts`, or
// `lib/invite/api.ts`: those carry the identical pre-existing pattern but are
// outside this phase's scope, and `invite`'s id is a 43-char URL-safe base64
// string the server itself shape-validates.
import { apiJson } from "@/lib/auth/api";

/** Wire shape of a single item row as returned by GET /api/vault/items. */
export interface ItemRow {
  id: string;
  enc_key: string;
  enc_data: string;
  revision: number;
  updated_at: string;
  // NordPass-style last-used tracking (quick-260717) — `null` until the
  // item's secret has been used at least once (server column is nullable),
  // set via POST /api/vault/items/{id}/touch below.
  last_used_at: string | null;
  // Phase 23 (Plan 23-01/23-05): server-sourced sharing metadata, never
  // client-computed — is_shared true for a collection-scoped item or one
  // with an item_shares grant; last_editor_email is the current
  // last_editor_user_id's email, null when never edited since Migration
  // 0015 or when the item isn't shared at all.
  is_shared: boolean;
  last_editor_email: string | null;
  // Phase 26, Plan 01 (A-1's `collection_id` wire-field companion,
  // crates/pv-server/src/routes/vault.rs's `VaultItem::collection_id`):
  // `null` for a personal item, the owning collection's id for a
  // collection-scoped one. Tells the client which key to decrypt this row
  // with (User Key vs. the collection's own Collection Key), instead of
  // `store.ts::decryptItemRow` unconditionally guessing User Key.
  collection_id: string | null;
}

/** Wire shape of a single folder row as returned by GET /api/vault/folders. */
export interface FolderRow {
  id: string;
  enc_name: string;
}

/** Wire shape of GET /api/sync?since=N — a cheap `{revision}` body when the
 * caller is already up to date, or a full `{revision, items, folders}`
 * snapshot when stale (Plan 05-01's revision-gated pull contract). */
export interface SyncSnapshot {
  revision: number;
  items?: ItemRow[];
  folders?: FolderRow[];
}

export function getSyncSnapshot(since: number): Promise<SyncSnapshot> {
  return apiJson(`/api/sync?since=${since}`);
}

/** Wire shape of GET /api/sync/shared — the per-collection revision map plus
 * a synthetic "direct" bucket (Plan 23-02's `pull_shared_revisions`). Never a
 * MAX/SUM fold across collections — one entry per collection the caller is
 * a member of. */
export interface SharedRevisions {
  collections: { id: string; revision: number }[];
  direct: { revision: number };
}

export function getSharedRevisions(): Promise<SharedRevisions> {
  return apiJson("/api/sync/shared");
}

/** Wire shape of `GET /api/vault/collections/{id}/sync` (`pull_shared_collection`,
 * Plan 23-02) — Phase 26, Plan 14 (WINDOWS #8's fix): the client's first
 * consumer of this read path. Untagged on the server (`UpToDate { revision }`
 * | `Snapshot { revision, items }`), modeled here the same optional-`items`
 * way `SyncSnapshot` above already does. `items` is field-for-field
 * identical to `ItemRow` (both server structs share the exact same shape) —
 * every row here carries `collection_id` set to the collection this fetch
 * was scoped to (server-side, `pull_shared_collection`'s own doc comment),
 * so `store.ts::decryptItemRow`'s EXISTING scope dispatch decrypts it with
 * zero new branching. */
export interface SharedCollectionItemsResponse {
  revision: number;
  items?: ItemRow[];
}

/** `GET /api/vault/collections/{id}/sync` — always requested WITHOUT a
 * `since` query param (the server's own `OptionalSyncQuery` contract: an
 * absent `since` always degrades to a full snapshot, revision compare
 * skipped entirely). Callers gate WHETHER to call this on their own
 * already-known watermark (`store.ts::collectionRevisionWatermark`) rather
 * than pushing that comparison onto the server, so this wrapper stays a
 * thin, unconditional full-fetch. */
export function getCollectionSync(collectionId: string): Promise<SharedCollectionItemsResponse> {
  return apiJson(`/api/vault/collections/${encodeURIComponent(collectionId)}/sync`);
}

/** Wire shape of a single row from `GET /api/sync/shared/direct`
 * (`pull_shared_direct`, Phase 26 Plan 14 — WINDOWS #9's fix). Deliberately
 * NOT `ItemRow`-shaped: this is the ONE read path that carries the
 * RECIPIENT's own `item_shares.sealed_key` (the item's Cipher Key, sealed
 * to this recipient's own published identity public key) instead of
 * `enc_key` (the OWNER's own key, useless to this recipient — omitted
 * server-side entirely, see `sync.rs::DirectSharedItem`'s own doc comment).
 * Decrypted via `unsealCollectionKey` (generic unseal, reused — mirrors
 * `ShareDialog.real-wasm.test.ts`'s own proven recipient-side sequence) then
 * `decryptItemWithSharedKey`, never `decryptItem`/`decryptItemForCollection`. */
export interface DirectSharedItemRow {
  id: string;
  enc_data: string;
  sealed_key: string;
  revision: number;
  updated_at: string;
  last_used_at: string | null;
  is_shared: boolean;
  last_editor_email: string | null;
}

export interface SharedDirectSyncResponse {
  revision: number;
  items?: DirectSharedItemRow[];
}

/** `GET /api/sync/shared/direct` — same unconditional-full-fetch contract as
 * `getCollectionSync` above (no `since` query param; the caller's own
 * `store.ts::directRevisionWatermark` gates WHETHER to call this at all). */
export function getSharedDirectSync(): Promise<SharedDirectSyncResponse> {
  return apiJson("/api/sync/shared/direct");
}

export function listItems(): Promise<ItemRow[]> {
  return apiJson("/api/vault/items");
}

export function createItem(
  id: string,
  encKey: string,
  encData: string,
): Promise<{ id: string; revision: number; updated_at: string }> {
  return apiJson("/api/vault/items", {
    method: "POST",
    body: JSON.stringify({ id, enc_key: encKey, enc_data: encData }),
  });
}

export function updateItem(
  id: string,
  encKey: string,
  encData: string,
  expectedRevision: number,
): Promise<{ revision: number; updated_at: string }> {
  return apiJson(`/api/vault/items/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({
      enc_key: encKey,
      enc_data: encData,
      expected_revision: expectedRevision,
    }),
  });
}

export function deleteItem(id: string): Promise<void> {
  return apiJson(`/api/vault/items/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** `POST /api/vault/items/{id}/touch` — records "this item's secret was
 * just used" (NordPass-style last-used tracking, quick-260717). Deliberately
 * NEVER bumps revision server-side — see crates/pv-server/src/routes/
 * vault.rs's `touch()` doc comment. Callers must go through
 * `lib/vault/store.ts`'s `touchVaultItem()` fire-and-forget wrapper, never
 * call this directly from a component (single choke-point, matches every
 * other mutation in this file already going through store.ts). */
export function touchItem(id: string): Promise<{ last_used_at: string }> {
  return apiJson(`/api/vault/items/${encodeURIComponent(id)}/touch`, { method: "POST" });
}

/** Wire shape of `collections.rs`'s `CollectionResponse` — matches
 * `GET /api/vault/collections/{id}` field-for-field. Added by Plan 24-05
 * (invite crypto glue): no single-collection-fetch client existed here yet —
 * `generateInviteLink`'s collection-scope branch needs to read the caller's
 * own `sealed_key` for a collection before re-wrapping it under the invite
 * channel. */
export interface CollectionRow {
  id: string;
  enc_name: string;
  created_at: string;
  access_level: string | null;
  sealed_key: string | null;
}

export function getCollection(id: string): Promise<CollectionRow> {
  return apiJson(`/api/vault/collections/${encodeURIComponent(id)}`);
}

/** Wire shape of `collections.rs`'s `collection_items` handler (Plan 25-03)
 * — a collection's FULL item set (every author, not just the caller's own),
 * `Membership<Collection, RequireRead>`-gated server-side. */
export interface CollectionItemRow {
  id: string;
  enc_key: string;
  enc_data: string;
  /** CR-04 (code review, Phase 25): the item's CURRENT revision, added
   * server-side by this same fix. `decryptItemForCollection` binds the
   * payload AAD to the revision, so without this every consumer had to guess
   * — `RemoveMemberDialog` hardcoded `1`, which is wrong for any edited item
   * and for every item that reached a collection through the only real server
   * path (`vault::move_item` bumps to >= 2). Not needed for `enc_key`, whose
   * AAD pins revision `0`. */
  revision: number;
}

export function getCollectionItems(collectionId: string): Promise<CollectionItemRow[]> {
  return apiJson(`/api/vault/collections/${encodeURIComponent(collectionId)}/items`);
}

/** Wire shape of `collections.rs`'s `access_list` handler (Phase 22) — every
 * member currently holding a grant on this collection.
 *
 * `suspended` (Phase 26, Plan 04 — A-7): flags, never filters — a
 * suspended co-recipient's `collection_keys` row still exists and still
 * appears here; reinstating them restores the access `Item`/`Collection::
 * resolve_access` currently resolves to `None` for. Field-for-field
 * identical to `ItemShareEntry` below (same server-side `CoRecipientRecord`
 * shape), so D-3's avatar stack and D-1's Sharing overview share one
 * vocabulary across both share types. */
export interface CollectionAccessEntry {
  user_id: string;
  email: string;
  access_level: string;
  created_at: string;
  suspended: boolean;
}

export function getCollectionAccessList(collectionId: string): Promise<CollectionAccessEntry[]> {
  return apiJson(`/api/vault/collections/${encodeURIComponent(collectionId)}/access`);
}

/** Wire shape of `vault.rs`'s `list_item_shares` handler (Phase 26, Plan
 * 04 — SHARE-02/UX-05): the direct-share recipient set for a personal
 * item, `Membership<Item, RequireRead>`-gated server-side. Never carries
 * `sealed_key` (T-22-16). Field-for-field identical to
 * `CollectionAccessEntry` above — one vocabulary for both share types. */
export interface ItemShareEntry {
  user_id: string;
  email: string;
  access_level: string;
  created_at: string;
  suspended: boolean;
}

export function listItemShares(itemId: string): Promise<ItemShareEntry[]> {
  return apiJson(`/api/vault/items/${encodeURIComponent(itemId)}/shares`);
}

/** `POST /api/vault/collections` — Phase 26, Plan 01 (A-1/WR-09 fix): the
 * CALLER mints `id` (a fresh `crypto.randomUUID()`) and binds it into
 * `encName`'s AAD BEFORE calling this — this wrapper does not mint or
 * validate the id, it only carries what the caller already produced.
 * Returns the full `CollectionResponse` shape (reuses `CollectionRow`,
 * field-for-field identical: `id` echoes the SAME id the caller sent, never
 * a server-minted one). */
export function createCollection(id: string, encName: string, sealedKey: string): Promise<CollectionRow> {
  return apiJson("/api/vault/collections", {
    method: "POST",
    body: JSON.stringify({ id, enc_name: encName, sealed_key: sealedKey }),
  });
}

/** `GET /api/vault/collections` — every collection the caller currently
 * holds a `collection_keys` row for (`collections.rs::list`). */
export function listCollections(): Promise<CollectionRow[]> {
  return apiJson("/api/vault/collections");
}

/** `PUT /api/vault/items/{id}/collection` — `vault.rs::move_item`'s wire
 * contract (SHARE-04's Vaultwarden #6269 fix): moves an item into a
 * collection (`newCollectionId` non-null) or back to personal scope
 * (`newCollectionId` null). `encKey`/`encData` must already be re-encrypted
 * CLIENT-SIDE under the DESTINATION scope's key/AAD before calling this —
 * this wrapper is a thin wire pass-through, never a crypto orchestrator
 * (that re-encrypt-under-destination-scope logic is Plan 26-08's job). */
export function moveItemToCollection(
  id: string,
  newCollectionId: string | null,
  encKey: string,
  encData: string,
  expectedRevision: number,
): Promise<{ revision: number; collection_id: string | null; updated_at: string }> {
  return apiJson(`/api/vault/items/${encodeURIComponent(id)}/collection`, {
    method: "PUT",
    body: JSON.stringify({
      new_collection_id: newCollectionId,
      enc_key: encKey,
      enc_data: encData,
      expected_revision: expectedRevision,
    }),
  });
}

/** `POST /api/vault/collections/{id}/members` — `collections.rs::add_member`'s
 * wire contract (Phase 22, first real client caller as of Plan 26-08):
 * `sealedKey` is the SAME `CollectionKey` the collection was created with,
 * `seal()`ed client-side to `recipientUserId`'s own published identity
 * public key — this wrapper is a thin wire pass-through, never a crypto
 * orchestrator (that composition is `ShareDialog`'s job). */
export function addCollectionMember(
  collectionId: string,
  recipientUserId: string,
  sealedKey: string,
  accessLevel: string,
): Promise<void> {
  return apiJson(`/api/vault/collections/${encodeURIComponent(collectionId)}/members`, {
    method: "POST",
    body: JSON.stringify({
      recipient_user_id: recipientUserId,
      sealed_key: sealedKey,
      access_level: accessLevel,
    }),
  });
}

/** `POST /api/vault/items/{id}/shares` — `vault.rs::create_share`'s wire
 * contract (SHARE-02, first real client caller as of Plan 26-08): `sealedKey`
 * is the item's OWN Cipher Key, `seal()`ed client-side to `recipientUserId`'s
 * own published identity public key — same thin-wrapper discipline as
 * `addCollectionMember` above, field-for-field identical request shape
 * (`CreateItemShareRequest`/`AddMemberRequest` are separate server structs
 * with the same three fields). */
export function createItemShare(
  itemId: string,
  recipientUserId: string,
  sealedKey: string,
  accessLevel: string,
): Promise<void> {
  return apiJson(`/api/vault/items/${encodeURIComponent(itemId)}/shares`, {
    method: "POST",
    body: JSON.stringify({
      recipient_user_id: recipientUserId,
      sealed_key: sealedKey,
      access_level: accessLevel,
    }),
  });
}

export function listFolders(): Promise<FolderRow[]> {
  return apiJson("/api/vault/folders");
}

/** `POST /api/vault/folders` — 26-13-PLAN.md live-run fix: `id` is now the
 * CALLER's own client-minted UUID (mirrors `createCollection`'s existing
 * `id` parameter exactly), never server-generated. The old server-minted
 * scheme meant `store.ts::decryptFolderRow`'s AAD (bound to `row.id`, the
 * server's own id) could never match the id `createVaultFolder` actually
 * encrypted `enc_name` against (a discarded, different client-generated
 * value) — every folder's name silently failed to decrypt on any full
 * refresh after the optimistic in-memory copy was replaced. See
 * `folders.rs::CreateFolderRequest`'s own doc comment for the full writeup. */
export function createFolder(id: string, encName: string): Promise<{ id: string }> {
  return apiJson("/api/vault/folders", {
    method: "POST",
    body: JSON.stringify({ id, enc_name: encName }),
  });
}

export function deleteFolder(id: string): Promise<void> {
  return apiJson(`/api/vault/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
}
