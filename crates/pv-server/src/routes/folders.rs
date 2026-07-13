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
    let id = Uuid::new_v4().to_string();

    sqlx::query("INSERT INTO folders (id, user_id, enc_name) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&session.user_id)
        .bind(&req.enc_name)
        .execute(&state.db)
        .await?;

    Ok((StatusCode::CREATED, Json(CreateFolderResponse { id })))
}

#[derive(Serialize)]
pub struct FolderRecord {
    pub id: String,
    pub enc_name: String,
}

/// `GET /api/vault/folders` — only the authenticated user's folders.
pub async fn list(State(state): State<AppState>, session: SessionUser) -> Result<Json<Vec<FolderRecord>>, ApiError> {
    let rows = sqlx::query("SELECT id, enc_name FROM folders WHERE user_id = ?")
        .bind(&session.user_id)
        .fetch_all(&state.db)
        .await?;

    let folders = rows
        .into_iter()
        .map(|row| {
            Ok(FolderRecord {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                enc_name: row.try_get("enc_name").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(folders))
}

/// `DELETE /api/vault/folders/{id}` — cross-user delete returns 404, never
/// confirming existence to a non-owner.
pub async fn delete(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM folders WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&session.user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}
