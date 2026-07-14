//! `GET /api/sync` — revision-gated cheap-check pull endpoint (SYNC-01).
//! Compares the caller's last-known `since` against `users.vault_revision`;
//! returns a cheap `{revision}` body when nothing changed, or a full
//! item+folder snapshot (scoped strictly to `session.user_id`) when stale.
//! This module deliberately does NOT touch WebSockets — SYNC-02's push
//! channel is Plan 05-02's job; the pull contract here is fully functional
//! and testable on its own.

use axum::{
    extract::{Query, State},
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::session::SessionUser;
use crate::{error::ApiError, AppState};

#[derive(Deserialize)]
pub struct SyncQuery {
    since: i64,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum SyncResponse {
    UpToDate {
        revision: i64,
    },
    Snapshot {
        revision: i64,
        items: Vec<super::vault::VaultItem>,
        folders: Vec<super::folders::FolderRecord>,
    },
}

/// `GET /api/sync?since=N` — see module docs for the cheap-check contract.
pub async fn pull(
    State(state): State<AppState>,
    session: SessionUser,
    Query(q): Query<SyncQuery>,
) -> Result<Json<SyncResponse>, ApiError> {
    let row = sqlx::query("SELECT vault_revision FROM users WHERE id = ?")
        .bind(&session.user_id)
        .fetch_one(&state.db)
        .await?;
    let revision: i64 = row.try_get("vault_revision").map_err(|_| ApiError::Internal)?;

    if q.since == revision {
        return Ok(Json(SyncResponse::UpToDate { revision }));
    }

    // Reuse the same row-fetch helpers list() already runs — no duplicated
    // SELECT, keeps the two response shapes from ever drifting.
    let items = super::vault::fetch_items_for(&state.db, &session.user_id).await?;
    let folders = super::folders::fetch_folders_for(&state.db, &session.user_id).await?;
    Ok(Json(SyncResponse::Snapshot { revision, items, folders }))
}
