//! `GET /api/sync` — revision-gated cheap-check pull endpoint (SYNC-01).
//! Compares the caller's last-known `since` against `users.vault_revision`;
//! returns a cheap `{revision}` body when nothing changed, or a full
//! item+folder snapshot (scoped strictly to `session.user_id`) when stale.
//!
//! `GET /api/sync/ws` — metadata-only WebSocket push channel (SYNC-02, Plan
//! 05-02). `SyncHub` fans out `SyncEvent`s to every open connection for a
//! given `user_id` via an in-process `tokio::sync::broadcast` channel per
//! user (no Redis/external pubsub — single-container constraint). A
//! `SyncEvent` carries ONLY `{entity_type, id, revision, change_type}` — no
//! field capable of holding an item's ciphertext or key material ever
//! belongs on this type; this is the entire attack surface T-05-04's
//! threat-model mitigation addresses.

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tokio::sync::broadcast;

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

/// Which table a `SyncEvent` refers to. `snake_case` serialization matches
/// 05-CONTEXT.md's locked wire schema (`"item"`/`"folder"`) exactly.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    Item,
    Folder,
}

/// What kind of mutation happened. `snake_case` serialization matches
/// 05-CONTEXT.md's locked wire schema (`"create"`/`"update"`/`"delete"`).
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    Create,
    Update,
    Delete,
}

/// Metadata-only change notification pushed over `GET /api/sync/ws`. These
/// four fields ONLY — never add a field capable of holding an item's
/// encrypted payload (T-05-04). Clients treat this purely as a "go pull"
/// trigger, never as the data itself (SYNC-02).
#[derive(Clone, Serialize)]
pub struct SyncEvent {
    pub entity_type: EntityType,
    pub id: String,
    pub revision: i64,
    pub change_type: ChangeType,
}

/// In-process per-user fan-out hub: one `tokio::sync::broadcast::Sender` per
/// `user_id`, created lazily on first `subscribe()` and pruned once its last
/// subscriber disconnects (05-RESEARCH.md's resolved Open Question 2). No
/// Redis/external pubsub — single-container/single-process axum instance
/// makes in-process broadcast sufficient (05-CONTEXT.md).
#[derive(Clone, Default)]
pub struct SyncHub(Arc<Mutex<HashMap<String, broadcast::Sender<SyncEvent>>>>);

impl SyncHub {
    /// Subscribes a new WS connection to `user_id`'s channel, lazily
    /// creating it if this is the first subscriber. This is the ONLY place a
    /// channel entry is ever created.
    pub fn subscribe(&self, user_id: &str) -> broadcast::Receiver<SyncEvent> {
        let mut map = self.0.lock().expect("sync_hub mutex poisoned");
        map.entry(user_id.to_string()).or_insert_with(|| broadcast::channel(32).0).subscribe()
    }

    /// Best-effort publish: a missing entry (nobody has ever connected for
    /// this user) OR a zero-receiver `Err` (everyone disconnected) are BOTH
    /// silent no-ops, never propagated as an HTTP error to the mutating
    /// request — a user with no open WS tab is the normal case, not a
    /// failure (05-RESEARCH.md Pattern 2, Anti-Patterns).
    pub(crate) fn publish(&self, user_id: &str, event: SyncEvent) {
        let map = self.0.lock().expect("sync_hub mutex poisoned");
        if let Some(tx) = map.get(user_id) {
            let _ = tx.send(event);
        }
    }

    /// Removes `user_id`'s channel entry once it has zero receivers,
    /// bounding the map to currently-or-recently-connected users without a
    /// background sweep task. Called only from `handle_socket`'s
    /// disconnect path.
    pub(crate) fn prune_if_empty(&self, user_id: &str) {
        let mut map = self.0.lock().expect("sync_hub mutex poisoned");
        if let Some(tx) = map.get(user_id) {
            if tx.receiver_count() == 0 {
                map.remove(user_id);
            }
        }
    }
}

#[derive(Deserialize)]
pub struct WsAuthQuery {
    token: String,
}

/// `GET /api/sync/ws` — upgrades only a validated bearer token (query param,
/// since the browser `WebSocket` API can't set custom headers) into a
/// per-user broadcast subscription. Validation happens BEFORE the upgrade,
/// via the SAME hash-lookup `SessionUser` uses for every REST endpoint — an
/// invalid/expired token rejects with the same `ApiError::Unauthorized` (401)
/// every other endpoint uses, never a silently-opened anonymous socket.
pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(auth): Query<WsAuthQuery>,
) -> Result<Response, ApiError> {
    let user_id = super::session::validate_token(&state.db, &auth.token).await?;
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, user_id)))
}

/// Forwards every `SyncEvent` published to `user_id`'s channel as a JSON
/// text frame until the socket closes. This protocol's client never sends
/// meaningful frames (see Plan 05-03) — the `socket.recv()` arm only watches
/// for disconnect signals.
async fn handle_socket(mut socket: WebSocket, state: AppState, user_id: String) {
    let mut rx = state.sync_hub.subscribe(&user_id);
    loop {
        tokio::select! {
            event = rx.recv() => match event {
                Ok(ev) => {
                    let Ok(json) = serde_json::to_string(&ev) else { continue };
                    if socket.send(Message::Text(json.into())).await.is_err() {
                        break; // client disconnected
                    }
                }
                Err(broadcast::error::RecvError::Lagged(_)) => continue, // catch-up pull re-establishes ground truth
                Err(broadcast::error::RecvError::Closed) => break,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Close(_))) | None => break,
                _ => {} // client sends nothing meaningful; ignore
            }
        }
    }
    state.sync_hub.prune_if_empty(&user_id);
}
