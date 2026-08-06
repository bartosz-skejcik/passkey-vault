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
//!
//! Phase 23, Plan 23-02 (SYNC-04/SYNC-07/SYNC-08): three new read endpoints
//! — the read half of the shared-data fan-out `pull()` above deliberately
//! does NOT grow to cover. `pull()`'s own query scope is untouched by this
//! plan (SC 5/SYNC-08's textual guarantee); shared data arrives exclusively
//! through:
//! - `GET /api/sync/shared` (`pull_shared_revisions`) — per-collection
//!   revision map + a synthetic "direct" bucket, `FamilyMembership<RequireRead>`-gated.
//! - `GET /api/vault/collections/{id}/sync` (`pull_shared_collection`) — one
//!   collection's full item snapshot/cheap-check, `Membership<Collection,
//!   RequireRead>`-gated (reused verbatim, zero extractor changes).
//! - `GET /api/sync/shared/direct` (`pull_shared_direct`) — the caller's own
//!   directly-shared (`item_shares`, `collection_id IS NULL`) items,
//!   `SessionUser`-only (mirrors `pull()`'s own scoping).
//!
//! All three are read-only and authorize exclusively through the Phase 22
//! membership extractors (SEC-06) — never a hand-written `WHERE`.

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

use super::membership::{active_collection_member_join, Collection, FamilyMembership, Membership, RequireRead};
use super::session::SessionUser;
use crate::{error::ApiError, AppState};

#[derive(Deserialize)]
pub struct SyncQuery {
    since: i64,
}

/// Query params for `pull_shared_collection`/`pull_shared_direct` below —
/// `since` is OPTIONAL here, unlike `SyncQuery` above: CONTEXT.md's locked
/// contract requires both endpoints to "degrade to a full snapshot when the
/// client sends no cursor (first sync, cache clear)". An absent `since` key
/// deserializes to `None` (serde's derive special-cases `Option<T>` fields
/// via its generated `missing_field`/`deserialize_option` handling, so no
/// `#[serde(default)]` attribute is needed here), which both handlers below
/// treat as "always a full snapshot, revision compare skipped entirely".
#[derive(Deserialize)]
pub struct OptionalSyncQuery {
    since: Option<i64>,
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

/// One collection's cheap-check revision, keyed by id — `GET /api/sync/shared`'s
/// per-collection cursor (SYNC-04/SYNC-07): a single scalar cannot express N
/// independent collection counters, so this is a `Vec`, never a `MAX`/`SUM`
/// fold across collections (CONTEXT.md's locked constraint).
#[derive(Serialize)]
pub struct CollectionRevision {
    pub id: String,
    pub revision: i64,
}

/// The caller's own direct (`item_shares`, `collection_id IS NULL`) items'
/// cheap-check revision — a synthetic "bucket" with no `collections` row of
/// its own to read a revision off, so its value is the caller's own
/// `users.shared_direct_revision` counter (D-02, RESEARCH.md Open Question 2;
/// CR-02, code review iteration 1: this used to be
/// `COALESCE(MAX(vault_items.revision), 0)` over exactly those rows, but a
/// MAX over a SET cannot represent a deletion or a share-set change — see
/// Migration 0016's own comment for the full rationale).
#[derive(Serialize)]
pub struct DirectBucket {
    pub revision: i64,
}

/// `GET /api/sync/shared`'s response body — never an error for a family
/// member with zero collections and zero direct shares (`collections: []`,
/// `direct: { revision: 0 }`); a caller with NO family membership at all
/// never reaches this type — `FamilyMembership<RequireRead>` rejects them
/// with `404` before the handler body ever runs (SYNC-07's "existence never
/// leaks via a differently-shaped empty response").
#[derive(Serialize)]
pub struct SharedRevisionsResponse {
    pub collections: Vec<CollectionRevision>,
    pub direct: DirectBucket,
}

/// `GET /api/sync/shared` — the shared-data sibling of `GET /api/sync`
/// above (SYNC-08's hard split: `pull()`'s own query scope is NOT touched by
/// this plan). `FamilyMembership<RequireRead>` is the ONLY gate — a caller
/// with no `family_members` row at all gets `404` here, never a `200` with
/// empty arrays (SYNC-07's must-have truth). Per-collection revisions come
/// from the SAME join `Collection::resolve_access`/`collections::list` use
/// (`collection_keys` + `family_members`, scoped to `recipient_user_id =
/// caller` — never a hand-written `WHERE`), `ORDER BY c.id ASC` for a
/// deterministic (per-caller) ordering — CONTEXT.md's own backstop truth
/// notes this carries no cross-caller ordering guarantee.
pub async fn pull_shared_revisions(
    State(state): State<AppState>,
    family: FamilyMembership<RequireRead>,
) -> Result<Json<SharedRevisionsResponse>, ApiError> {
    // WR-05 (code review, Phase 25): this join carried no `fm.status` predicate,
    // so a suspended member still received the id and current `revision` of
    // every collection they hold a `collection_keys` row for — enough to
    // observe that activity is occurring in folders they have been cut off
    // from. Now shares `active_collection_member_join!()` with every other
    // recipient-side resolver.
    let rows = sqlx::query(concat!(
        "SELECT c.id, c.revision FROM collections c \
           JOIN collection_keys ck ON ck.collection_id = c.id AND ck.recipient_user_id = ? ",
        active_collection_member_join!(),
        "ORDER BY c.id ASC",
    ))
    .bind(&family.caller_user_id)
    .fetch_all(&state.db)
    .await?;

    let collections = rows
        .into_iter()
        .map(|row| {
            Ok(CollectionRevision {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                revision: row.try_get("revision").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    // Synthetic "direct" bucket (D-02): no `collections` row backs this, so
    // its cheap-check value is the caller's own `users.shared_direct_revision`
    // counter (CR-02) — bumped by `create_share`/`revoke_share`/`update`/
    // `delete` inside their own mutation transaction, never a MAX/SUM fold
    // over the caller's directly-shared items (which cannot represent a
    // deletion or a share-set change).
    let direct_revision: i64 = sqlx::query_scalar("SELECT shared_direct_revision FROM users WHERE id = ?")
        .bind(&family.caller_user_id)
        .fetch_one(&state.db)
        .await?;

    Ok(Json(SharedRevisionsResponse { collections, direct: DirectBucket { revision: direct_revision } }))
}

/// Response shape for BOTH `pull_shared_collection` and `pull_shared_direct`
/// below — same untagged `UpToDate`/`Snapshot` convention as `SyncResponse`
/// above, but scoped to one collection's (or the direct bucket's) items
/// only, never `folders` (folders are a personal-vault-only concept, never
/// collection- or share-scoped).
#[derive(Serialize)]
#[serde(untagged)]
pub enum SharedCollectionSyncResponse {
    UpToDate {
        revision: i64,
    },
    Snapshot {
        revision: i64,
        items: Vec<super::vault::VaultItem>,
    },
}

/// `GET /api/vault/collections/{id}/sync?since=N` — the per-collection sync
/// pull (SYNC-04/SYNC-07), gated by `Membership<Collection, RequireRead>`
/// verbatim (RESEARCH.md's Open Question 1: a path-`{id}`-based route needs
/// zero extractor changes, unlike a query-param design). Mirrors `pull()`'s
/// cheap-check shape above, but its Snapshot's items come from a NEW query —
/// `WHERE collection_id = ?` with NO `user_id` filter at all (Pitfall A:
/// `vault::fetch_items_for` is deliberately non-widening and must NEVER be
/// reused here — it would silently exclude every item another member
/// created). `since` is OPTIONAL (`OptionalSyncQuery`) — an absent `since`
/// is always treated as a full-snapshot request, revision compare skipped
/// entirely.
pub async fn pull_shared_collection(
    State(state): State<AppState>,
    membership: Membership<Collection, RequireRead>,
    Query(q): Query<OptionalSyncQuery>,
) -> Result<Json<SharedCollectionSyncResponse>, ApiError> {
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM collections WHERE id = ?")
        .bind(&membership.resource_id)
        .fetch_one(&state.db)
        .await?;

    if let Some(since) = q.since {
        if since == revision {
            return Ok(Json(SharedCollectionSyncResponse::UpToDate { revision }));
        }
    }

    // Pitfall A: no `user_id`/`i.user_id` filter of any kind — correctness
    // depends entirely on `Membership<Collection, RequireRead>` having
    // already authorized this request before this handler body ever runs.
    // Mirrors `fetch_items_for`'s arm-1 SELECT column list verbatim, minus
    // its `user_id = ?` personal-ownership filter.
    let rows = sqlx::query(
        "SELECT vault_items.id, enc_key, enc_data, revision, updated_at, last_used_at, \
                users.email AS last_editor_email \
           FROM vault_items \
           LEFT JOIN users ON users.id = vault_items.last_editor_user_id \
          WHERE collection_id = ?",
    )
    .bind(&membership.resource_id)
    .fetch_all(&state.db)
    .await?;

    let items = rows
        .into_iter()
        .map(|row| {
            Ok(super::vault::VaultItem {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                enc_key: row.try_get("enc_key").map_err(|_| ApiError::Internal)?,
                enc_data: row.try_get("enc_data").map_err(|_| ApiError::Internal)?,
                revision: row.try_get("revision").map_err(|_| ApiError::Internal)?,
                updated_at: row.try_get("updated_at").map_err(|_| ApiError::Internal)?,
                last_used_at: row.try_get("last_used_at").map_err(|_| ApiError::Internal)?,
                // Every item this query returns IS collection-scoped by
                // construction (Pitfall A's whole point) — unconditionally
                // `true`, never derived from a second query.
                is_shared: true,
                // Phase 26, Plan 01: every row here is scoped to THIS
                // collection by construction (the `WHERE collection_id = ?`
                // above) — the membership extractor's own resource_id, never
                // a second query.
                collection_id: Some(membership.resource_id.clone()),
                last_editor_email: row.try_get("last_editor_email").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(SharedCollectionSyncResponse::Snapshot { revision, items }))
}

/// `GET /api/sync/shared/direct?since=N` — the caller's own directly-shared
/// (`item_shares`, `collection_id IS NULL`) items. `SessionUser`-only gate
/// (mirrors `pull()`'s own scoping exactly, D-02): every row is filtered by
/// `item_shares.recipient_user_id = session.user_id`, never a
/// client-supplied id — this is NOT a `Membership<R,M>`/`FamilyMembership<M>`-
/// gated route, since there is no shared "resource" here to authorize
/// against; it's the caller's own personal items that merely happen to be
/// shared TO them. Registered as a documented literal `.route()` in
/// `routes/mod.rs`, same rationale as `GET /api/sync` itself.
pub async fn pull_shared_direct(
    State(state): State<AppState>,
    session: SessionUser,
    Query(q): Query<OptionalSyncQuery>,
) -> Result<Json<SharedCollectionSyncResponse>, ApiError> {
    // Keyed off the SAME `users.shared_direct_revision` counter
    // `pull_shared_revisions`'s "direct" bucket uses above (CR-02) — kept
    // independent (not extracted to a shared fn) since the two call sites'
    // surrounding queries differ enough (this one also needs the full item
    // body) that a helper would save little.
    let revision: i64 = sqlx::query_scalar("SELECT shared_direct_revision FROM users WHERE id = ?")
        .bind(&session.user_id)
        .fetch_one(&state.db)
        .await?;

    if let Some(since) = q.since {
        if since == revision {
            return Ok(Json(SharedCollectionSyncResponse::UpToDate { revision }));
        }
    }

    // CR-02 (code review, Phase 25): this query used to join `item_shares`
    // with NO `family_members` join at all, so a SUSPENDED member kept
    // receiving the full `enc_data` of every personal item shared to them —
    // including edits made after suspension — which they could still decrypt
    // with the per-item Cipher Key they necessarily already hold (that key is
    // stable across revisions, `items.rs`). Suspension deliberately leaves
    // `item_shares` rows intact (`families.rs::suspend_member` performs zero
    // key writes), so the status predicate is the only thing standing between
    // a suspended member and this payload.
    //
    // The join mirrors `Item::resolve_access`'s `item_shares` branch
    // byte-for-byte in shape: pinned to the item OWNER's family via
    // `fm_o.user_id = vault_items.user_id` (never a client-controlled value),
    // with the RECIPIENT-side `fm` row required to be `active`. `fm_o` is
    // deliberately NOT status-gated — a suspended OWNER's outbound shares stay
    // readable, exactly as `resolve_access` already decides.
    let rows = sqlx::query(
        "SELECT vault_items.id, enc_key, enc_data, revision, updated_at, last_used_at, \
                users.email AS last_editor_email \
           FROM vault_items \
           JOIN item_shares ON item_shares.item_id = vault_items.id \
           JOIN family_members fm_o ON fm_o.user_id = vault_items.user_id \
           JOIN family_members fm ON fm.family_id = fm_o.family_id \
                                 AND fm.user_id = item_shares.recipient_user_id \
                                 AND fm.status = 'active' \
           LEFT JOIN users ON users.id = vault_items.last_editor_user_id \
          WHERE item_shares.recipient_user_id = ? AND vault_items.collection_id IS NULL",
    )
    .bind(&session.user_id)
    .fetch_all(&state.db)
    .await?;

    let items = rows
        .into_iter()
        .map(|row| {
            Ok(super::vault::VaultItem {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                enc_key: row.try_get("enc_key").map_err(|_| ApiError::Internal)?,
                enc_data: row.try_get("enc_data").map_err(|_| ApiError::Internal)?,
                revision: row.try_get("revision").map_err(|_| ApiError::Internal)?,
                updated_at: row.try_get("updated_at").map_err(|_| ApiError::Internal)?,
                last_used_at: row.try_get("last_used_at").map_err(|_| ApiError::Internal)?,
                // Every item this query returns IS directly shared by
                // construction (the `JOIN item_shares` above) — unconditionally
                // `true`, never derived from a second query.
                is_shared: true,
                // Phase 26, Plan 01: this query is pinned to
                // `vault_items.collection_id IS NULL` above — every row
                // returned is a personal item shared directly, never
                // collection-scoped.
                collection_id: None,
                last_editor_email: row.try_get("last_editor_email").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(SharedCollectionSyncResponse::Snapshot { revision, items }))
}

/// Which table a `SyncEvent` refers to. `snake_case` serialization matches
/// 05-CONTEXT.md's locked wire schema (`"item"`/`"folder"`) exactly.
///
/// `Collection` (added Phase 23, SYNC-05): a collection-SCOPED event —
/// carries the collection's own id in `SyncEvent`'s existing `id` field
/// (never a new field, see `SyncEvent`'s doc comment below) and is delivered
/// ONLY to that collection's current members via `SyncHub::publish_to_recipients`,
/// resolved fresh at emit time. Clients treat ANY `Collection`-typed event as
/// "drop any cached Collection Key for this collection and re-fetch" — this
/// same contract also covers Phase 25's re-key and Phase 27's cache
/// invalidation (Pitfall 16); no new `ChangeType` variant is needed for
/// either, `Update` is reused.
///
/// **WR-05 (code review iteration 2) — known, deliberate contract gap:** this
/// event's `revision` field is `collections.revision`, which is bumped ONLY
/// by an item mutation inside the collection (SYNC-04) — `collections::add_member`
/// and `collections::revoke_access` publish this SAME event type on a pure
/// MEMBERSHIP change, but do NOT bump `collections.revision` (a locked
/// CONTEXT.md design call: "only item mutations bump it"; reversing it would
/// silently change the asserted revision values several existing
/// `tests/collections.rs`/`tests/sync_shared.rs` fixtures depend on). The
/// practical consequence: a membership-change event's `revision` can equal a
/// value the recipient already has, so `GET /api/vault/collections/{id}/sync?since=N`'s
/// cheap-check (`pull_shared_collection`, above) answers `UpToDate` for a
/// membership change even though membership genuinely changed. Clients MUST
/// therefore treat receipt of ANY `Collection`-typed WS event as an
/// UNCONDITIONAL trigger — re-fetch access/membership state directly (e.g.
/// `GET /api/vault/collections/{id}/access`), never gate that re-fetch on
/// comparing this event's `revision` against a locally cached value first.
/// This is why the "drop cache and re-fetch" instruction above is phrased as
/// unconditional, not "re-fetch if revision advanced" — Phase 25/26/27
/// consumers of this event must preserve that reading rather than
/// re-introducing a revision-comparison gate that would silently swallow a
/// membership-only change.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    Item,
    Folder,
    Collection,
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
///
/// T-05-04 extended (Phase 23, Pitfall 18): this rule now also covers
/// sensitive METADATA, not just ciphertext/key material — no `actor`/
/// `collection_id` field is ever added here either, since `SyncEvent`s fan
/// out to every resolved recipient of a mutation and a field naming WHO
/// changed something, or which OTHER collection is affected, would leak to
/// recipients who have no business learning it. A collection-scoped event
/// carries the collection's id in the `id` field below via
/// `EntityType::Collection` instead of a dedicated field.
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

    /// Fan-out publish for a shared mutation (SYNC-05): `recipients` MUST be
    /// resolved fresh, inside the mutation's own transaction, at emit time —
    /// never cached anywhere (this is the property that makes a just-added
    /// member see the event and a just-removed member never does, with zero
    /// invalidation logic; see `vault.rs::resolve_recipients`). Deliberately
    /// a loop over the existing single-user `publish()` — reuses its
    /// silent-no-op-for-no-listener semantics verbatim and does NOT re-key
    /// `SyncHub` by collection (CONTEXT.md's locked "keep SyncHub keyed by
    /// user_id"). A one-element `recipients` slice (e.g. a collection with no
    /// member besides its owner) is the normal case, not a special case —
    /// this loop runs once and returns, no panic, no error.
    pub(crate) fn publish_to_recipients(&self, recipients: &[String], event: SyncEvent) {
        for user_id in recipients {
            self.publish(user_id, event.clone());
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
