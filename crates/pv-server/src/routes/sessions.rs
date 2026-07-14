//! `/api/sessions/*` — AUTH-07's session management surface: list active
//! sessions (with a `current: true` marker on the caller's own bearer
//! token's row) and revoke individual sessions. Mirrors `vault.rs`'s
//! ownership-scoped list/delete shape; every query is bound to
//! `session.user_id`, never a client-supplied user id (IDOR prevention).

use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::Serialize;
use sqlx::Row;

use super::session::{extract_bearer_token, SessionUser};
use crate::{crypto, error::ApiError, AppState};

#[derive(Serialize)]
pub struct SessionRow {
    pub id: String,
    pub user_agent: Option<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub current: bool,
}

/// `GET /api/sessions` — only the authenticated user's own sessions. Marks
/// exactly one row `current: true` — the row whose `token_hash` matches the
/// CURRENT request's own bearer token, computed server-side (never a
/// client-supplied "is this me" flag).
pub async fn list(
    State(state): State<AppState>,
    session: SessionUser,
    headers: HeaderMap,
) -> Result<Json<Vec<SessionRow>>, ApiError> {
    let current_token = extract_bearer_token(&headers)?;
    let current_hash = crypto::hash_token(current_token.as_bytes());

    let rows = sqlx::query(
        "SELECT id, user_agent, created_at, last_used_at, token_hash FROM sessions WHERE user_id = ?",
    )
    .bind(&session.user_id)
    .fetch_all(&state.db)
    .await?;

    let sessions = rows
        .into_iter()
        .map(|row| {
            let token_hash: Vec<u8> = row.try_get("token_hash").map_err(|_| ApiError::Internal)?;
            Ok(SessionRow {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                user_agent: row.try_get("user_agent").map_err(|_| ApiError::Internal)?,
                created_at: row.try_get("created_at").map_err(|_| ApiError::Internal)?,
                last_used_at: row.try_get("last_used_at").map_err(|_| ApiError::Internal)?,
                current: token_hash == current_hash.as_slice(),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(sessions))
}

/// `DELETE /api/sessions/{id}` — revoke one of the caller's own sessions. No
/// special-casing for revoking the current session: per 03-CONTEXT.md,
/// "revoking current = logout" is the natural consequence of the token's row
/// disappearing — `SessionUser`'s next lookup will 401 on its own.
pub async fn revoke(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM sessions WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&session.user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}
