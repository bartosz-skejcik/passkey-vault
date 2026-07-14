//! `/api/vault/folders` — encrypted-name folder records (Bitwarden pattern).
//! No schema change needed — the existing `folders` table from migration
//! 0001 already matches this shape exactly (02-RESEARCH.md's own migration
//! plan explicitly leaves it unchanged). Since `vault_items` no longer has a
//! folder reference column (Task 1), deleting a folder here has no
//! server-side cascading effect on items — folder membership lives inside
//! each item's decrypted ciphertext payload and is a client-side-only
//! concern (intentional, per 02-RESEARCH.md's Open Question 2 recommendation).

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
use super::vault::validate_blob_len;
use crate::{error::ApiError, AppState};

#[derive(Deserialize)]
pub struct CreateFolderRequest {
    /// Opaque `WrappedKey`-shaped JSON, same non-parsing discipline as items.
    pub enc_name: String,
}

#[derive(Serialize)]
pub struct CreateFolderResponse {
    pub id: String,
}

/// `POST /api/vault/folders`
pub async fn create(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<CreateFolderRequest>,
) -> Result<(StatusCode, Json<CreateFolderResponse>), ApiError> {
    // WR-06: folder rows had no equivalent guard to vault_items' 64 KiB blob
    // cap — reuse the same limit/helper so folder creation can't be used to
    // insert unbounded-size rows.
    validate_blob_len("enc_name", &req.enc_name)?;

    let id = Uuid::new_v4().to_string();

    // WR-01: mutation + vault_revision bump run inside one transaction (see
    // vault.rs create()'s comment for the atomicity rationale).
    let mut tx = state.db.begin().await?;

    sqlx::query("INSERT INTO folders (id, user_id, enc_name) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&session.user_id)
        .bind(&req.enc_name)
        .execute(&mut *tx)
        .await?;

    // SYNC-01: bump the per-user global change counter in the same
    // single-statement discipline as vault.rs's item mutations
    // (05-RESEARCH.md Pitfall 1 — never SELECT-then-UPDATE).
    let new_global_revision: i64 = sqlx::query_scalar(
        "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
    )
    .bind(&session.user_id)
    .fetch_one(&mut *tx)
    .await?;

    tx.commit().await?;

    // SYNC-02: only after commit() succeeds — folders have no per-row
    // revision column (05-CONTEXT.md's locked decision) — both folder events
    // use the freshly-bumped global vault_revision value for
    // SyncEvent.revision.
    state.sync_hub.publish(
        &session.user_id,
        SyncEvent {
            entity_type: EntityType::Folder,
            id: id.clone(),
            revision: new_global_revision,
            change_type: ChangeType::Create,
        },
    );

    Ok((StatusCode::CREATED, Json(CreateFolderResponse { id })))
}

#[derive(Serialize)]
pub struct FolderRecord {
    pub id: String,
    pub enc_name: String,
}

/// Shared row-fetch body reused by `list()` and `sync::pull`'s snapshot arm
/// (05-RESEARCH.md Open Question 1 — one SQL source of truth per table,
/// never duplicated across response shapes).
pub(crate) async fn fetch_folders_for(pool: &sqlx::SqlitePool, user_id: &str) -> Result<Vec<FolderRecord>, ApiError> {
    let rows = sqlx::query("SELECT id, enc_name FROM folders WHERE user_id = ?")
        .bind(user_id)
        .fetch_all(pool)
        .await?;

    rows.into_iter()
        .map(|row| {
            Ok(FolderRecord {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                enc_name: row.try_get("enc_name").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()
}

/// `GET /api/vault/folders` — only the authenticated user's folders.
pub async fn list(State(state): State<AppState>, session: SessionUser) -> Result<Json<Vec<FolderRecord>>, ApiError> {
    let folders = fetch_folders_for(&state.db, &session.user_id).await?;
    Ok(Json(folders))
}

/// `DELETE /api/vault/folders/{id}` — cross-user delete returns 404, never
/// confirming existence to a non-owner.
pub async fn delete(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    // WR-01: mutation + vault_revision bump run inside one transaction (see
    // create()'s comment above for the atomicity rationale).
    let mut tx = state.db.begin().await?;

    let result = sqlx::query("DELETE FROM folders WHERE id = ? AND user_id = ?")
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

    // SYNC-02: only after commit() succeeds — folders have no per-row
    // revision column — use the freshly-bumped global vault_revision for
    // this event too.
    state.sync_hub.publish(
        &session.user_id,
        SyncEvent {
            entity_type: EntityType::Folder,
            id: id.clone(),
            revision: new_global_revision,
            change_type: ChangeType::Delete,
        },
    );

    Ok(StatusCode::NO_CONTENT)
}
