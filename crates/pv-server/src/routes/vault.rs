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
pub(crate) async fn fetch_items_for(pool: &sqlx::SqlitePool, user_id: &str) -> Result<Vec<VaultItem>, ApiError> {
    let rows = sqlx::query(
        "SELECT id, enc_key, enc_data, revision, updated_at, last_used_at FROM vault_items WHERE user_id = ?",
    )
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
pub async fn touch(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
) -> Result<Json<TouchItemResponse>, ApiError> {
    let result = sqlx::query(
        "UPDATE vault_items SET last_used_at = datetime('now') WHERE id = ? AND user_id = ? \
         RETURNING last_used_at",
    )
    .bind(&id)
    .bind(&session.user_id)
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
/// id+user_id+revision) is disambiguated by a follow-up SELECT into
/// "doesn't exist / not yours" (404) vs. "stale revision" (409) — the same
/// disambiguation `rows_affected() == 0` drove before this change, only the
/// zero-rows signal now comes from `fetch_optional` returning `None`.
pub async fn update(
    State(state): State<AppState>,
    session: SessionUser,
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
         WHERE id = ? AND user_id = ? AND revision = ? \
         RETURNING updated_at",
    )
    .bind(&req.enc_key)
    .bind(&req.enc_data)
    .bind(&id)
    .bind(&session.user_id)
    .bind(req.expected_revision)
    .fetch_optional(&mut *tx)
    .await?;

    let row = match result {
        Some(row) => row,
        None => {
            let exists = sqlx::query("SELECT 1 FROM vault_items WHERE id = ? AND user_id = ?")
                .bind(&id)
                .bind(&session.user_id)
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
    // comment above for the atomicity rationale).
    let _new_global_revision: i64 = sqlx::query_scalar(
        "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
    )
    .bind(&session.user_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    let new_item_revision = req.expected_revision + 1;
    // SYNC-02: metadata-only push — only after commit() succeeds; use the
    // item's OWN per-row revision (the same value this response's own
    // `revision` field carries), not the global counter this bump just
    // produced.
    state.sync_hub.publish(
        &session.user_id,
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
pub async fn delete(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    // WR-01: mutation + vault_revision bump run inside one transaction (see
    // create()'s comment above for the atomicity rationale).
    let mut tx = state.db.begin().await?;

    let result = sqlx::query("DELETE FROM vault_items WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&session.user_id)
        .execute(&mut *tx)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    // SYNC-01: bump the per-user global change counter (see create()'s
    // comment above for the atomicity rationale).
    let new_global_revision: i64 = sqlx::query_scalar(
        "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
    )
    .bind(&session.user_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    // SYNC-02: only after commit() succeeds — the deleted row no longer
    // exists, so it has no per-row revision to report — use the
    // freshly-bumped GLOBAL vault_revision for this one call site only (per
    // 05-02-PLAN's explicit instruction).
    state.sync_hub.publish(
        &session.user_id,
        SyncEvent {
            entity_type: EntityType::Item,
            id: id.clone(),
            revision: new_global_revision,
            change_type: ChangeType::Delete,
        },
    );

    Ok(StatusCode::NO_CONTENT)
}
