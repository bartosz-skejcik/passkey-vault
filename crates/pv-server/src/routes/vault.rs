//! `/api/vault/items` — CRUD na zaszyfrowanych blobach z optymistyczną
//! współbieżnością (revision). Serwer widzi wyłącznie `{id, enc_key, blob,
//! revision}` — typ przedmiotu i folder_id żyją wewnątrz ciphertextu (patrz
//! 02-CONTEXT.md Vault Data Model). Każdy handler bierze `SessionUser` i
//! skopuje zapytania po `session_user.user_id` — nigdy po id z ciała żądania.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use super::membership::{
    parse_access_level_from_request, require_collection_edit, Item, Membership, RequireEdit, RequireRead,
};
use super::session::SessionUser;
use super::sync::{ChangeType, EntityType, SyncEvent};
use crate::{error::ApiError, AppState};

/// 64 KiB — RESEARCH.md flagged item payload size as an unbounded-storage-
/// abuse gap with no explicit CONTEXT.md limit. Comfortably fits any of the
/// four item types' encrypted JSON payload with generous headroom; this
/// plan's discretionary call.
///
/// `pub(crate)`: also reused by `folders::create` (WR-06) so folder blobs
/// get the same storage-abuse guard as item blobs instead of an unbounded
/// `enc_name`.
pub(crate) const MAX_ITEM_BLOB_BYTES: usize = 64 * 1024;

#[derive(Deserialize)]
pub struct CreateItemRequest {
    /// Client-supplied id: the client must know the item's id BEFORE
    /// encrypting it, since pv-core's AD binds ciphertext to `item_id` — the
    /// server can't generate the id first and hand it back.
    pub id: String,
    /// Opaque `WrappedKey`-shaped JSON, produced client-side — never parsed
    /// server-side.
    pub enc_key: String,
    pub enc_data: String,
}

#[derive(Serialize)]
pub struct CreateItemResponse {
    pub id: String,
    pub revision: i64,
    pub updated_at: String,
}

pub(crate) fn validate_blob_len(field: &'static str, value: &str) -> Result<(), ApiError> {
    if value.len() > MAX_ITEM_BLOB_BYTES {
        return Err(ApiError::BadRequest(format!("{field} exceeds max size")));
    }
    Ok(())
}

/// `POST /api/vault/items` — creates a new item at revision 1.
pub async fn create(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<CreateItemRequest>,
) -> Result<(StatusCode, Json<CreateItemResponse>), ApiError> {
    if Uuid::parse_str(&req.id).is_err() {
        return Err(ApiError::BadRequest("id must be a well-formed UUID".into()));
    }
    validate_blob_len("enc_key", &req.enc_key)?;
    validate_blob_len("enc_data", &req.enc_data)?;

    // WR-01: mutation + vault_revision bump run inside one transaction, so a
    // crash/dropped connection between the two can never durably persist the
    // row while leaving the counter (and therefore every other device's
    // catch-up pull) unaware of it.
    let mut tx = state.db.begin().await?;

    // ON CONFLICT guard keeps creation atomic/race-free rather than trusting
    // client-side id uniqueness alone (collisions astronomically unlikely
    // for client-generated UUIDv4s, but the guard is cheap and correct).
    // RETURNING updated_at yields no row when the ON CONFLICT DO NOTHING arm
    // fires, so fetch_optional's None is the exact same "conflict" signal
    // execute()'s rows_affected() == 0 used to be.
    let result = sqlx::query(
        "INSERT INTO vault_items (id, user_id, enc_key, enc_data, revision) VALUES (?, ?, ?, ?, 1) \
         ON CONFLICT(id) DO NOTHING \
         RETURNING updated_at",
    )
    .bind(&req.id)
    .bind(&session.user_id)
    .bind(&req.enc_key)
    .bind(&req.enc_data)
    .fetch_optional(&mut *tx)
    .await?;

    let row = match result {
        Some(row) => row,
        None => return Err(ApiError::Conflict("item id already exists".into())),
    };
    let updated_at: String = row.try_get("updated_at").map_err(|_| ApiError::Internal)?;

    // SYNC-01: bump the per-user global change counter in the same
    // single-statement discipline as the item's own revision (05-RESEARCH.md
    // Pitfall 1 — never SELECT-then-UPDATE).
    let _new_global_revision: i64 = sqlx::query_scalar(
        "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
    )
    .bind(&session.user_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    // SYNC-02: metadata-only push — only after commit() succeeds, and a
    // freshly created item is always at its own revision 1, matching this
    // response's own `revision` field.
    state.sync_hub.publish(
        &session.user_id,
        SyncEvent { entity_type: EntityType::Item, id: req.id.clone(), revision: 1, change_type: ChangeType::Create },
    );

    Ok((
        StatusCode::CREATED,
        Json(CreateItemResponse { id: req.id, revision: 1, updated_at }),
    ))
}

#[derive(Serialize)]
pub struct VaultItem {
    pub id: String,
    pub enc_key: String,
    pub enc_data: String,
    pub revision: i64,
    pub updated_at: String,
    /// NordPass-style last-used tracking (quick-260717 addendum). `None`
    /// means "never touched" — set only by `POST .../touch`, never by
    /// create/update/list, and never bumps `revision` (see `touch()`'s doc
    /// comment for why).
    pub last_used_at: Option<String>,
}

/// Shared row-fetch body reused by `list()` and `sync::pull`'s snapshot arm
/// (05-RESEARCH.md Open Question 1 — one SQL source of truth per table,
/// never duplicated across response shapes).
///
/// CR-01 (iteration 3): a bare `WHERE user_id = ?` disagreed with
/// `Item::resolve_access` — a revoked collection member whose
/// `collection_keys` row was deleted correctly gets 404 on every mutating
/// verb for an item they created, but `vault_items.user_id` (the item's
/// original CREATOR) never changes on revocation, so this unfiltered query
/// kept handing them the item's current ciphertext, including every
/// post-revocation edit. Deliberately NON-WIDENING: the `collection_id IS
/// NULL` arm is byte-identical to the old behavior for personal items, and
/// the collection-scoped arm keeps `i.user_id = ?` — it only STOPS listing a
/// row the caller can no longer resolve access to via the same
/// `collection_keys` + `family_members` join `Collection::resolve_access`
/// uses; it never starts listing an item someone else created that the
/// caller can only reach via `collection_keys`/`item_shares`. Widening to
/// that shape is the deferred Phase 23 read path and is a separate decision.
pub(crate) async fn fetch_items_for(pool: &sqlx::SqlitePool, user_id: &str) -> Result<Vec<VaultItem>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, enc_key, enc_data, revision, updated_at, last_used_at \
           FROM vault_items WHERE user_id = ? AND collection_id IS NULL \
         UNION ALL \
         SELECT i.id, i.enc_key, i.enc_data, i.revision, i.updated_at, i.last_used_at \
           FROM vault_items i \
           JOIN collection_keys ck ON ck.collection_id = i.collection_id AND ck.recipient_user_id = ? \
           JOIN collections c      ON c.id = i.collection_id \
           JOIN family_members fm  ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id \
          WHERE i.user_id = ?",
    )
    .bind(user_id)
    .bind(user_id)
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            Ok(VaultItem {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                enc_key: row.try_get("enc_key").map_err(|_| ApiError::Internal)?,
                enc_data: row.try_get("enc_data").map_err(|_| ApiError::Internal)?,
                revision: row.try_get("revision").map_err(|_| ApiError::Internal)?,
                updated_at: row.try_get("updated_at").map_err(|_| ApiError::Internal)?,
                last_used_at: row.try_get("last_used_at").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()
}

#[derive(Serialize)]
pub struct TouchItemResponse {
    pub last_used_at: String,
}

/// `POST /api/vault/items/{id}/touch` — records "this item's secret was just
/// used" (reveal/copy/autofill/TOTP/passkey ceremony), NordPass-style.
/// Deliberately a single-column `UPDATE` that does NOT touch `revision`:
/// revision is the optimistic-concurrency token content mutations use
/// (`update()` above) — bumping it here would fabricate a spurious 409 for
/// every OTHER device/tab the next time it tries to save an edit, even
/// though nothing about the item's content changed. Trade-off (documented
/// per this task's brief): no dedicated WS `SyncEvent` is broadcast for a
/// touch either — broadcasting one for every reveal/copy/autofill would make
/// the metadata-only sync channel unnecessarily chatty; other devices simply
/// pick up the new `last_used_at` on their next pull/snapshot.
///
/// Collection-aware (22-04-PLAN.md Task 1): `Membership<Item, RequireRead>` —
/// marking an item "used" only requires READ access, matching NordPass-style
/// reveal/autofill semantics; a `read`-only collection member (or a
/// `hidden_password` holder) may still autofill a shared login. A personal
/// item (`collection_id IS NULL`) is scoped exactly as before, via
/// `Item::resolve_access`'s personal-ownership branch — the extractor already
/// proved access before this handler body runs, so the query below drops the
/// now-redundant `AND user_id = ?` filter.
pub async fn touch(
    State(state): State<AppState>,
    _membership: Membership<Item, RequireRead>,
    Path(id): Path<String>,
) -> Result<Json<TouchItemResponse>, ApiError> {
    let result = sqlx::query(
        "UPDATE vault_items SET last_used_at = datetime('now') WHERE id = ? \
         RETURNING last_used_at",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;

    let row = match result {
        Some(row) => row,
        None => return Err(ApiError::NotFound),
    };
    let last_used_at: String = row.try_get("last_used_at").map_err(|_| ApiError::Internal)?;

    Ok(Json(TouchItemResponse { last_used_at }))
}

/// `GET /api/vault/items` — only the authenticated user's items, never a
/// client-supplied user id.
pub async fn list(State(state): State<AppState>, session: SessionUser) -> Result<Json<Vec<VaultItem>>, ApiError> {
    let items = fetch_items_for(&state.db, &session.user_id).await?;
    Ok(Json(items))
}

#[derive(Deserialize)]
pub struct UpdateItemRequest {
    pub enc_key: String,
    pub enc_data: String,
    pub expected_revision: i64,
}

#[derive(Serialize)]
pub struct UpdateItemResponse {
    pub revision: i64,
    pub updated_at: String,
}

/// `PUT /api/vault/items/{id}` — single-statement optimistic-concurrency
/// update (RESEARCH.md Pattern 3): no separate SELECT-then-UPDATE race
/// window. A `None` from `RETURNING updated_at` (no row matched
/// id+revision) is disambiguated by a follow-up SELECT into
/// "doesn't exist / not yours" (404) vs. "stale revision" (409) — the same
/// disambiguation `rows_affected() == 0` drove before this change, only the
/// zero-rows signal now comes from `fetch_optional` returning `None`.
///
/// Collection-aware (22-04-PLAN.md Task 1): `Membership<Item, RequireEdit>` —
/// a personal item (`collection_id IS NULL`) is scoped exactly as before
/// (caller must own it), expressed via `Item::resolve_access`'s
/// personal-ownership branch rather than a query filter; a collection-scoped
/// item additionally succeeds for any caller with `edit` access via
/// `collection_keys`/`item_shares`. The extractor already proved access
/// before this handler body runs, so the query below drops the now-redundant
/// (and, for a shared item, actively WRONG — `user_id` on a shared item is
/// the ORIGINAL creator, not every current editor) `AND user_id = ?` filter.
pub async fn update(
    State(state): State<AppState>,
    membership: Membership<Item, RequireEdit>,
    Path(id): Path<String>,
    Json(req): Json<UpdateItemRequest>,
) -> Result<Json<UpdateItemResponse>, ApiError> {
    validate_blob_len("enc_key", &req.enc_key)?;
    validate_blob_len("enc_data", &req.enc_data)?;

    // WR-01: mutation + vault_revision bump run inside one transaction (see
    // create()'s comment above for the atomicity rationale).
    let mut tx = state.db.begin().await?;

    let result = sqlx::query(
        "UPDATE vault_items SET enc_key = ?, enc_data = ?, revision = revision + 1, updated_at = datetime('now') \
         WHERE id = ? AND revision = ? \
         RETURNING updated_at",
    )
    .bind(&req.enc_key)
    .bind(&req.enc_data)
    .bind(&id)
    .bind(req.expected_revision)
    .fetch_optional(&mut *tx)
    .await?;

    let row = match result {
        Some(row) => row,
        None => {
            let exists = sqlx::query("SELECT 1 FROM vault_items WHERE id = ?")
                .bind(&id)
                .fetch_optional(&mut *tx)
                .await?;
            return match exists {
                Some(_) => Err(ApiError::Conflict("stale revision".into())),
                None => Err(ApiError::NotFound),
            };
        }
    };
    let updated_at: String = row.try_get("updated_at").map_err(|_| ApiError::Internal)?;

    // SYNC-01: bump the per-user global change counter (see create()'s
    // comment above for the atomicity rationale). Bound to the CALLER's own
    // user_id (`membership.caller_user_id`), matching this codebase's
    // existing single-user sync semantics — broadcasting a shared item's
    // change to every co-recipient's own sync channel is Phase 23 territory,
    // out of this plan's scope.
    //
    // TODO(phase-23, WR-09): editing a shared item bumps ONLY the editor's
    // own `vault_revision` and publishes to ONLY the editor's own sync
    // channel — every other collection_keys/item_shares holder of this item
    // keeps a stale cached copy and gets `UpToDate` from their own
    // `GET /api/sync?since=N` until they touch the item themselves. This is a
    // stale-credential / lost-update hazard, not cosmetic lag: two holders
    // can both hold `expected_revision = N` and the second save 409s with no
    // prior signal anything moved. Phase 23 must bump every current
    // collection_keys/item_shares recipient's vault_revision (plus the
    // item's own owner) in this SAME transaction, and publish a SyncEvent to
    // each of them.
    let _new_global_revision: i64 = sqlx::query_scalar(
        "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
    )
    .bind(&membership.caller_user_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let new_item_revision = req.expected_revision + 1;
    // SYNC-02: metadata-only push — only after commit() succeeds; use the
    // item's OWN per-row revision (the same value this response's own
    // `revision` field carries), not the global counter this bump just
    // produced.
    state.sync_hub.publish(
        &membership.caller_user_id,
        SyncEvent {
            entity_type: EntityType::Item,
            id: id.clone(),
            revision: new_item_revision,
            change_type: ChangeType::Update,
        },
    );

    Ok(Json(UpdateItemResponse { revision: new_item_revision, updated_at }))
}

/// `DELETE /api/vault/items/{id}` — permanent delete (no trash/soft-delete
/// in this phase, per CONTEXT.md's locked decision).
///
/// Collection-aware (22-04-PLAN.md Task 1): `Membership<Item, RequireEdit>` —
/// same dual-mode scoping rationale as `update()` above; the extractor
/// already proved access, so the query drops the now-redundant (and, for a
/// shared item, WRONG) `AND user_id = ?` filter.
pub async fn delete(
    State(state): State<AppState>,
    membership: Membership<Item, RequireEdit>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    // WR-01: mutation + vault_revision bump run inside one transaction (see
    // create()'s comment above for the atomicity rationale).
    let mut tx = state.db.begin().await?;

    let result = sqlx::query("DELETE FROM vault_items WHERE id = ?").bind(&id).execute(&mut *tx).await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    // SYNC-01: bump the per-user global change counter (see create()'s
    // comment above for the atomicity rationale). Bound to the CALLER's own
    // user_id — see update()'s comment above on why this stays single-user
    // scoped in this plan.
    //
    // TODO(phase-23, WR-09): deleting a shared item bumps ONLY the deleter's
    // own vault_revision — every other collection_keys/item_shares holder
    // keeps serving a cached copy of a row that no longer exists until they
    // happen to touch it. See update()'s identical TODO above for the full
    // fan-out requirement Phase 23 must implement here too.
    let new_global_revision: i64 = sqlx::query_scalar(
        "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
    )
    .bind(&membership.caller_user_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    // SYNC-02: only after commit() succeeds — the deleted row no longer
    // exists, so it has no per-row revision to report — use the
    // freshly-bumped GLOBAL vault_revision for this one call site only (per
    // 05-02-PLAN's explicit instruction).
    state.sync_hub.publish(
        &membership.caller_user_id,
        SyncEvent {
            entity_type: EntityType::Item,
            id: id.clone(),
            revision: new_global_revision,
            change_type: ChangeType::Delete,
        },
    );

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub struct MoveItemRequest {
    /// `None` moves the item back to personal scope (`collection_id` becomes
    /// `NULL`); `Some(dest_id)` moves it into that collection — both
    /// directions go through this one endpoint.
    pub new_collection_id: Option<String>,
    /// Fresh ciphertext, re-encrypted CLIENT-SIDE under the DESTINATION
    /// scope's Collection Key and AAD (pv-core's `build_coll_item_aad`,
    /// Phase 21 KEY-03, binds `collection_id` into the item's AEAD
    /// associated data) — never derived server-side, never validated for
    /// content, just an opaque blob like every other `enc_key`/`enc_data`
    /// pair in this codebase.
    pub enc_key: String,
    pub enc_data: String,
    pub expected_revision: i64,
}

#[derive(Serialize)]
pub struct MoveItemResponse {
    pub revision: i64,
    pub collection_id: Option<String>,
    pub updated_at: String,
}

/// `PUT /api/vault/items/{id}/collection` — SHARE-04's headline fix,
/// closing the exact Vaultwarden #6269 bypass. Two independent
/// authorization gates fire before any DB mutation:
///
/// 1. `source: Membership<Item, RequireEdit>` — resolved on the item's
///    CURRENT collection (or personal ownership, via `Item::resolve_access`).
///    A `HiddenPassword` holder on the current collection fails
///    `RequireEdit::satisfied_by` right here, in the extractor, BEFORE this
///    function body ever runs — a member with hidden-password access must
///    never be able to reassign an item into a collection where they happen
///    to have fuller access, exposing the password to themselves. This is an
///    ACCIDENTAL-EXPOSURE guard, never a cryptographic boundary: a
///    hidden_password holder still HOLDS the unwrapped item key regardless of
///    what this endpoint permits — this endpoint only controls what the
///    SERVER will let them do with their own session, not what they could do
///    by inspecting client-side memory. Phase 26 owns saying so explicitly in
///    the UI; this comment must not contradict that framing.
/// 2. `require_collection_edit()` on the DESTINATION collection, run
///    explicitly inside this function body when `new_collection_id` is
///    `Some` — a written-rationale addition beyond CONTEXT.md's literal SHARE-04
///    text (this plan's objective documents the deviation): without this
///    second, independent check, an edit-capable member of the SOURCE
///    collection could push an item into a DESTINATION collection they hold
///    only `read` (or no) access to at all — a variant of the same
///    asymmetric-check bug class SHARE-05 exists to prevent.
///
/// The move itself is a re-encrypt-and-replace, never a bare
/// `UPDATE vault_items SET collection_id = ?`: since `collection_id` is bound
/// into the item's AEAD associated data (KEY-03), a bare FK reassignment
/// would silently produce an item that can never be decrypted again. The
/// client supplies fresh `enc_key`/`enc_data`, and this handler writes
/// `collection_id`, `enc_key`, `enc_data`, and the optimistic-concurrency
/// `revision` bump all in the SAME `UPDATE` statement — no code path in this
/// file can silently retarget an item's scope without the AAD-consistent
/// ciphertext alongside it.
pub async fn move_item(
    State(state): State<AppState>,
    source: Membership<Item, RequireEdit>,
    Path(id): Path<String>,
    Json(req): Json<MoveItemRequest>,
) -> Result<Json<MoveItemResponse>, ApiError> {
    // Gate 2 (destination) — runs BEFORE any DB mutation, and before the
    // blob-length validation below, so a caller who fails this check never
    // learns whether their oversized blob would otherwise have been accepted.
    if let Some(dest_id) = &req.new_collection_id {
        require_collection_edit(&state.db, &source.caller_user_id, dest_id).await?;
    }

    validate_blob_len("enc_key", &req.enc_key)?;
    validate_blob_len("enc_data", &req.enc_data)?;

    // WR-01: mutation + vault_revision bump run inside one transaction (see
    // create()'s comment above for the atomicity rationale).
    let mut tx = state.db.begin().await?;

    // Re-encrypt-and-replace (T-22-19): collection_id, enc_key, enc_data all
    // update together in this ONE statement — never split across two writes.
    let result = sqlx::query(
        "UPDATE vault_items SET collection_id = ?, enc_key = ?, enc_data = ?, revision = revision + 1, \
         updated_at = datetime('now') \
         WHERE id = ? AND revision = ? \
         RETURNING revision, updated_at",
    )
    .bind(&req.new_collection_id)
    .bind(&req.enc_key)
    .bind(&req.enc_data)
    .bind(&id)
    .bind(req.expected_revision)
    .fetch_optional(&mut *tx)
    .await?;

    let row = match result {
        Some(row) => row,
        None => {
            // Same disambiguation shape as update()'s: a None result needs a
            // follow-up SELECT to tell "doesn't exist" (404) from "stale
            // revision" (409).
            let exists = sqlx::query("SELECT 1 FROM vault_items WHERE id = ?")
                .bind(&id)
                .fetch_optional(&mut *tx)
                .await?;
            return match exists {
                Some(_) => Err(ApiError::Conflict("stale revision".into())),
                None => Err(ApiError::NotFound),
            };
        }
    };
    let new_revision: i64 = row.try_get("revision").map_err(|_| ApiError::Internal)?;
    let updated_at: String = row.try_get("updated_at").map_err(|_| ApiError::Internal)?;

    // SYNC-01: bump the per-user global change counter (see create()'s
    // comment above for the atomicity rationale). Bound to the CALLER's own
    // user_id — see update()'s comment above on why this stays single-user
    // scoped in this plan.
    //
    // TODO(phase-23, WR-09): moving a shared item bumps ONLY the mover's own
    // vault_revision — every other collection_keys/item_shares holder (on
    // EITHER the source or destination collection) keeps serving a cached
    // copy of the item's old collection scope until they happen to touch it.
    // See update()'s identical TODO above for the full fan-out requirement
    // Phase 23 must implement here too.
    let _new_global_revision: i64 = sqlx::query_scalar(
        "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
    )
    .bind(&source.caller_user_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    // SYNC-02: metadata-only push — only after commit() succeeds; same
    // EntityType::Item / ChangeType::Update shape update() uses.
    state.sync_hub.publish(
        &source.caller_user_id,
        SyncEvent {
            entity_type: EntityType::Item,
            id: id.clone(),
            revision: new_revision,
            change_type: ChangeType::Update,
        },
    );

    Ok(Json(MoveItemResponse { revision: new_revision, collection_id: req.new_collection_id, updated_at }))
}

#[derive(Deserialize)]
pub struct CreateItemShareRequest {
    pub recipient_user_id: String,
    /// The item's own key, `seal()`ed client-side to the recipient's own
    /// `IdentityPublicKey` — opaque to this server, mirrors
    /// `collections::AddMemberRequest::sealed_key`'s treatment.
    pub sealed_key: String,
    pub access_level: String,
}

/// `POST /api/vault/items/{id}/shares` — SHARE-02's server half: direct
/// per-item sharing, independent of any collection membership. Same
/// confused-deputy guard as `collections::add_member` (T-22-11's pattern
/// applied to items): `recipient_user_id` must already be a family member AND
/// have published an identity keypair before any `item_shares` row is
/// created. The family-membership check is deliberately FAMILY-WIDE (`SELECT
/// ... FROM family_members WHERE user_id = ?`, not scoped through the item's
/// own collection) — v0.4 has exactly one family, and a PERSONAL item
/// (`collection_id IS NULL`) being shared directly has no collection to
/// derive a family from in the first place, so "any family member" is the
/// only well-defined guard for this endpoint.
pub async fn create_share(
    State(state): State<AppState>,
    membership: Membership<Item, RequireEdit>,
    Json(req): Json<CreateItemShareRequest>,
) -> Result<StatusCode, ApiError> {
    // Validate BEFORE any DB work — fails closed on a malformed/unrecognized
    // access_level string, never silently coerced to a working default
    // (mirrors collections::add_member's own ordering).
    parse_access_level_from_request(&req.access_level)?;

    let is_family_member = sqlx::query("SELECT 1 FROM family_members WHERE user_id = ?")
        .bind(&req.recipient_user_id)
        .fetch_optional(&state.db)
        .await?;
    if is_family_member.is_none() {
        return Err(ApiError::BadRequest("recipient is not a family member".into()));
    }

    let has_keypair = sqlx::query("SELECT 1 FROM user_keypairs WHERE user_id = ?")
        .bind(&req.recipient_user_id)
        .fetch_optional(&state.db)
        .await?;
    if has_keypair.is_none() {
        return Err(ApiError::BadRequest("recipient has not published an identity keypair yet".into()));
    }

    validate_blob_len("sealed_key", &req.sealed_key)?;

    let inserted = sqlx::query(
        "INSERT INTO item_shares (item_id, recipient_user_id, sealed_key, access_level) \
         VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING recipient_user_id",
    )
    .bind(&membership.resource_id)
    .bind(&req.recipient_user_id)
    .bind(&req.sealed_key)
    .bind(&req.access_level)
    .fetch_optional(&state.db)
    .await?;

    match inserted {
        Some(_) => Ok(StatusCode::CREATED),
        None => Err(ApiError::Conflict("recipient already has a share on this item".into())),
    }
}

/// `DELETE /api/vault/items/{id}/shares/{user_id}` — removes a direct
/// per-item share. This route has TWO path captures — this only works
/// because `Membership<Item, RequireEdit>` reads its own `{id}` via
/// `Path::<HashMap<String, String>>` (Plan 22-01's B1 fix), not
/// `Path::<String>`, which would reject any route with more than one
/// capture; this handler's own `Path<(String, String)>` then re-reads the
/// same, still-intact `UrlParams` extension for both captures (mirrors
/// `collections::revoke_access`'s identical shape).
pub async fn revoke_share(
    State(state): State<AppState>,
    membership: Membership<Item, RequireEdit>,
    Path((_item_id, target_user_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM item_shares WHERE item_id = ? AND recipient_user_id = ?")
        .bind(&membership.resource_id)
        .bind(&target_user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}
