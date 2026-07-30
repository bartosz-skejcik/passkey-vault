//! `/api/vault/collections` — shared collections (KEY-02's fan-out home,
//! SHARE-06's single-share revocation). Mirrors `vault.rs`'s "server sees
//! only opaque blobs" framing, extended to a shared, multi-recipient
//! resource: `collections.enc_name` and every `collection_keys.sealed_key`
//! row are opaque to this server — `enc_name` is a symmetric blob the
//! client encrypts under its own freshly-generated `CollectionKey`, and
//! `sealed_key` is an asymmetric sealed box the client produces client-side
//! via `pv_core`'s identity-sealing helper (see this module's own
//! prohibition below) under the RECIPIENT's own published `IdentityPublicKey`.
//!
//! **This module MUST NEVER call `pv_core::identity::{seal, unseal,
//! unseal_collection_key}`** (matches `identity.rs`'s Plan 22-02 precedent) —
//! the server stores/serves opaque `sealed_key TEXT` columns only and can
//! never recover the plaintext `CollectionKey` they wrap. Only `tests/collections.rs`
//! calls those functions, simulating the client side of a real fan-out.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::membership::{
    parse_access_level_from_request, Collection, FamilyMembership, Membership, RequireEdit, RequireRead,
};
use super::sync::{ChangeType, EntityType, SyncEvent};
use super::vault::validate_blob_len;
use crate::{error::ApiError, AppState};

/// Resolves the CURRENT recipient set for `collection_id` — a fresh query,
/// never cached (Phase 23, SYNC-05/Pitfall 17). Called by `add_member`
/// AFTER its `INSERT` and by `revoke_access` AFTER its `DELETE`, so the
/// just-added member is naturally included and the just-removed member is
/// naturally excluded, with zero invalidation logic anywhere — this is the
/// same "resolved fresh at emit time" property `vault.rs::resolve_recipients`
/// already relies on.
async fn resolve_collection_recipients(pool: &sqlx::SqlitePool, collection_id: &str) -> Result<Vec<String>, ApiError> {
    let rows = sqlx::query("SELECT recipient_user_id FROM collection_keys WHERE collection_id = ?")
        .bind(collection_id)
        .fetch_all(pool)
        .await?;
    rows.into_iter()
        .map(|row| row.try_get("recipient_user_id").map_err(|_| ApiError::Internal))
        .collect::<Result<Vec<_>, ApiError>>()
}

#[derive(Deserialize)]
pub struct CreateCollectionRequest {
    /// Symmetric blob: the collection's name encrypted client-side under a
    /// freshly-generated `CollectionKey` — never decrypted server-side.
    pub enc_name: String,
    /// The SAME fresh `CollectionKey`, `seal()`ed client-side to the
    /// CREATOR's own `IdentityPublicKey` — never unwrapped server-side.
    pub sealed_key: String,
}

#[derive(Serialize)]
pub struct CollectionResponse {
    pub id: String,
    pub enc_name: String,
    pub created_at: String,
    /// The CALLER's own access level, `None` when the caller has no
    /// `collection_keys` row (should be unreachable through
    /// `Membership<Collection, RequireRead>`-gated handlers, since the
    /// extractor already proved a row exists, but kept `Option` for
    /// response-shape reuse across `create`/`get`).
    pub access_level: Option<String>,
    /// The CALLER's own `sealed_key`, `None` under the same condition as
    /// `access_level` above. Other recipients' sealed blobs are never
    /// included here (T-22-16) — see `access_list` for the co-recipient
    /// view, which never exposes `sealed_key` at all.
    pub sealed_key: Option<String>,
}

/// `POST /api/vault/collections` — any family member may create a shared
/// collection (`FamilyMembership<RequireRead>` — CONTEXT.md's flat model has
/// no "who may create a shared folder" restriction beyond family
/// membership). Creates the `collections` row AND the creator's own
/// `collection_keys` row in the SAME transaction (mirrors `vault::create`'s
/// WR-01 atomicity discipline) — this is the KEY-02 fan-out seed: a
/// collection never exists with zero key-holders, even for an instant.
pub async fn create(
    State(state): State<AppState>,
    family: FamilyMembership<RequireRead>,
    Json(req): Json<CreateCollectionRequest>,
) -> Result<(StatusCode, Json<CollectionResponse>), ApiError> {
    validate_blob_len("enc_name", &req.enc_name)?;
    validate_blob_len("sealed_key", &req.sealed_key)?;

    let mut tx = state.db.begin().await?;

    let id = uuid::Uuid::new_v4().to_string();

    let row = sqlx::query("INSERT INTO collections (id, family_id, enc_name) VALUES (?, ?, ?) RETURNING created_at")
        .bind(&id)
        .bind(&family.family_id)
        .bind(&req.enc_name)
        .fetch_one(&mut *tx)
        .await?;
    let created_at: String = row.try_get("created_at").map_err(|_| ApiError::Internal)?;

    // access_level is a hard-coded literal 'edit' here, NEVER taken from the
    // request — the creator is always a full editor of their own creation.
    sqlx::query(
        "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
         VALUES (?, ?, ?, 'edit')",
    )
    .bind(&id)
    .bind(&family.caller_user_id)
    .bind(&req.sealed_key)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok((
        StatusCode::CREATED,
        Json(CollectionResponse {
            id,
            enc_name: req.enc_name,
            created_at,
            access_level: Some("edit".to_string()),
            sealed_key: Some(req.sealed_key),
        }),
    ))
}

/// `GET /api/vault/collections/{id}` — gated by `Membership<Collection,
/// RequireRead>`, so a non-member gets `404` (existence never leaks) before
/// this handler's body ever runs.
pub async fn get(
    State(state): State<AppState>,
    membership: Membership<Collection, RequireRead>,
) -> Result<Json<CollectionResponse>, ApiError> {
    let collection_row = sqlx::query("SELECT enc_name, created_at FROM collections WHERE id = ?")
        .bind(&membership.resource_id)
        .fetch_optional(&state.db)
        .await?;
    // The extractor already proved access exists (a collection_keys row
    // exists for this caller+resource) — a missing collections row here
    // would only happen on a genuine data-integrity bug (FK violation),
    // still handled defensively via ApiError::NotFound rather than a panic.
    let collection_row = collection_row.ok_or(ApiError::NotFound)?;
    let enc_name: String = collection_row.try_get("enc_name").map_err(|_| ApiError::Internal)?;
    let created_at: String = collection_row.try_get("created_at").map_err(|_| ApiError::Internal)?;

    let key_row = sqlx::query("SELECT sealed_key FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
        .bind(&membership.resource_id)
        .bind(&membership.caller_user_id)
        .fetch_optional(&state.db)
        .await?;
    let sealed_key: Option<String> = match key_row {
        Some(row) => Some(row.try_get("sealed_key").map_err(|_| ApiError::Internal)?),
        None => None,
    };

    Ok(Json(CollectionResponse {
        id: membership.resource_id,
        enc_name,
        created_at,
        access_level: Some(membership.access.as_str().to_string()),
        sealed_key,
    }))
}

/// `GET /api/vault/collections` — lists only collections the caller has a
/// `collection_keys` row for. `FamilyMembership<RequireRead>` (no `{id}`
/// segment) — same rationale as `families::create`/`members`.
pub async fn list(
    State(state): State<AppState>,
    family: FamilyMembership<RequireRead>,
) -> Result<Json<Vec<CollectionResponse>>, ApiError> {
    let rows = sqlx::query(
        "SELECT c.id, c.enc_name, c.created_at, ck.access_level, ck.sealed_key \
         FROM collections c JOIN collection_keys ck ON ck.collection_id = c.id \
         WHERE ck.recipient_user_id = ? ORDER BY c.created_at ASC, c.id ASC",
    )
    .bind(&family.caller_user_id)
    .fetch_all(&state.db)
    .await?;

    let collections = rows
        .into_iter()
        .map(|row| {
            Ok(CollectionResponse {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                enc_name: row.try_get("enc_name").map_err(|_| ApiError::Internal)?,
                created_at: row.try_get("created_at").map_err(|_| ApiError::Internal)?,
                access_level: Some(row.try_get("access_level").map_err(|_| ApiError::Internal)?),
                sealed_key: Some(row.try_get("sealed_key").map_err(|_| ApiError::Internal)?),
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(collections))
}

#[derive(Deserialize)]
pub struct AddMemberRequest {
    pub recipient_user_id: String,
    /// The SAME `CollectionKey` the collection was created with,
    /// independently `seal()`ed client-side to `recipient_user_id`'s own
    /// `IdentityPublicKey` — never unwrapped/validated server-side.
    pub sealed_key: String,
    pub access_level: String,
}

/// `POST /api/vault/collections/{id}/members` — `RequireEdit`-gated (a
/// `read`-only member cannot grant access to others). Implements
/// RESEARCH.md's confused-deputy guard (T-22-11): `recipient_user_id` MUST
/// already be a `family_members` row AND have a `user_keypairs` row before
/// any `collection_keys` insert — a buggy/compromised client can never leak
/// a sealed Collection Key to an outsider with no server-side check.
pub async fn add_member(
    State(state): State<AppState>,
    membership: Membership<Collection, RequireEdit>,
    Json(req): Json<AddMemberRequest>,
) -> Result<StatusCode, ApiError> {
    // Validate BEFORE any DB work — fails closed on a malformed/unrecognized
    // access_level string, never silently coerced to a working default.
    parse_access_level_from_request(&req.access_level)?;

    let is_family_member = sqlx::query(
        "SELECT 1 FROM family_members WHERE family_id = (SELECT family_id FROM collections WHERE id = ?) AND user_id = ?",
    )
    .bind(&membership.resource_id)
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
        "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
         VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING recipient_user_id",
    )
    .bind(&membership.resource_id)
    .bind(&req.recipient_user_id)
    .bind(&req.sealed_key)
    .bind(&req.access_level)
    .fetch_optional(&state.db)
    .await?;

    if inserted.is_none() {
        return Err(ApiError::Conflict("recipient already has access to this collection".into()));
    }

    // SYNC-05 (Phase 23, Task 2): membership just changed — fan out an
    // EntityType::Collection event to the FULL current recipient set,
    // queried FRESH after the INSERT above, so it naturally includes the
    // just-added member (CONTEXT.md's hard constraint #2: membership
    // resolution is fresh at emit time, never cached). `collections.revision`
    // itself is NOT bumped here — only item mutations bump it (SYNC-04); this
    // event carries the collection's CURRENT (unbumped-by-this-call)
    // revision, matching the client contract "any Collection-typed event
    // means: drop any cached Collection Key for this collection and
    // re-fetch."
    let recipients = resolve_collection_recipients(&state.db, &membership.resource_id).await?;
    let current_revision: i64 = sqlx::query_scalar("SELECT revision FROM collections WHERE id = ?")
        .bind(&membership.resource_id)
        .fetch_one(&state.db)
        .await?;
    state.sync_hub.publish_to_recipients(
        &recipients,
        SyncEvent {
            entity_type: EntityType::Collection,
            id: membership.resource_id.clone(),
            revision: current_revision,
            change_type: ChangeType::Update,
        },
    );

    Ok(StatusCode::CREATED)
}

/// `DELETE /api/vault/collections/{id}/access/{user_id}` — SHARE-06's
/// single-share revocation. `RequireEdit`-gated. Deliberately a distinct URL
/// shape (`/access/{user_id}`, not `/members/{user_id}`) from Phase 25's
/// future family-member-removal endpoint — `/members/...` stays reserved
/// vocabulary for that phase, never reused here.
///
/// This route has TWO path captures (`{id}` and `{user_id}`) — this only
/// works because `Membership<Collection, RequireEdit>` reads its own `{id}`
/// via `Path::<HashMap<String, String>>` (Plan 22-01's B1 fix), not
/// `Path::<String>`; this handler's own `Path<(String, String)>` then
/// re-reads the same, still-intact `UrlParams` extension for both captures.
pub async fn revoke_access(
    State(state): State<AppState>,
    membership: Membership<Collection, RequireEdit>,
    Path((_collection_id, target_user_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    // WR-06: refuse a revocation that would empty the collection's last
    // key-holder — `create()`'s own doc comment states the invariant
    // explicitly ("a collection never exists with zero key-holders, even for
    // an instant") and enforces it transactionally at creation time, but
    // nothing enforced its converse here. Without this guard, a sole
    // key-holder revoking their own access (accidental "leave" click, no
    // attacker required) — or an edit-capable member stripping every other
    // recipient first — permanently orphans every item in the collection:
    // `Item::resolve_access`'s collection branch resolves to `None` for
    // EVERY caller once no `collection_keys` row remains, and nothing in this
    // API can ever recover them.
    //
    // W1 (iteration 2): the guard MUST be part of the write itself, not a
    // separate `COUNT(*)` followed by a `DELETE` — two independent
    // statements against `&state.db` (no `tx`) are not atomic with respect
    // to a second concurrent request. Two concurrent revokes against a
    // 2-key-holder collection (A revoking B, B revoking A — a double-submit
    // from one edit-holder's UI is enough, no second actor required) could
    // each read "the other holder is still present" before either DELETE
    // ran, and both would then succeed, orphaning the collection — exactly
    // the state this guard exists to prevent. Folding the "at least one
    // OTHER key-holder still exists" check into the DELETE's own `WHERE`
    // clause makes SQLite's single-statement execution the enforcement
    // mechanism: the row only disappears if the EXISTS subquery is still
    // true at the moment the DELETE actually runs.
    let result = sqlx::query(
        "DELETE FROM collection_keys \
          WHERE collection_id = ? AND recipient_user_id = ? \
            AND EXISTS (SELECT 1 FROM collection_keys \
                         WHERE collection_id = ? AND recipient_user_id <> ?)",
    )
    .bind(&membership.resource_id)
    .bind(&target_user_id)
    .bind(&membership.resource_id)
    .bind(&target_user_id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        // Zero rows affected is ambiguous by construction — it means EITHER
        // "no such grant" (404) OR "the grant exists but is the last
        // key-holder, so the EXISTS guard blocked the delete" (409).
        // Disambiguate with one follow-up SELECT, mirroring the same
        // `fetch_optional`-then-`match` shape `vault::update`/`vault::move_item`
        // already use for their own stale-revision-vs-not-found split.
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT 1 FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?",
        )
        .bind(&membership.resource_id)
        .bind(&target_user_id)
        .fetch_optional(&state.db)
        .await?;
        return match exists {
            Some(_) => Err(ApiError::Conflict(
                "cannot revoke the last key-holder — the collection's contents would become permanently unreadable"
                    .into(),
            )),
            None => Err(ApiError::NotFound),
        };
    }

    // SYNC-05 (Phase 23, Task 2): fan out AFTER the DELETE — recipients
    // resolved fresh now naturally EXCLUDE `target_user_id` (their
    // collection_keys row is gone), so the just-removed member's own WS
    // channel receives NOTHING about this collection ever again from this
    // call (T-23-10's mitigation: never notify a removed member of their own
    // removal through the very channel being cut).
    let recipients = resolve_collection_recipients(&state.db, &membership.resource_id).await?;
    let current_revision: i64 = sqlx::query_scalar("SELECT revision FROM collections WHERE id = ?")
        .bind(&membership.resource_id)
        .fetch_one(&state.db)
        .await?;
    state.sync_hub.publish_to_recipients(
        &recipients,
        SyncEvent {
            entity_type: EntityType::Collection,
            id: membership.resource_id.clone(),
            revision: current_revision,
            change_type: ChangeType::Update,
        },
    );

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
pub struct CoRecipientRecord {
    pub user_id: String,
    pub email: String,
    pub access_level: String,
    pub created_at: String,
}

/// `GET /api/vault/collections/{id}/access` — symmetric co-recipient
/// visibility (CONTEXT.md's Carried Product Decision): deliberately
/// `Membership<Collection, RequireRead>` (any member with ANY access level,
/// not edit-only) — "caller has any access to this resource" authorizes the
/// listing, not "caller is the family owner". Never includes `sealed_key`
/// (T-22-16) — other members' sealed blobs are useless to anyone but their
/// own recipient, but are not gratuitously exposed regardless.
pub async fn access_list(
    State(state): State<AppState>,
    membership: Membership<Collection, RequireRead>,
) -> Result<Json<Vec<CoRecipientRecord>>, ApiError> {
    let rows = sqlx::query(
        "SELECT ck.recipient_user_id, u.email, ck.access_level, ck.created_at \
         FROM collection_keys ck JOIN users u ON u.id = ck.recipient_user_id \
         WHERE ck.collection_id = ? ORDER BY ck.created_at ASC, ck.recipient_user_id ASC",
    )
    .bind(&membership.resource_id)
    .fetch_all(&state.db)
    .await?;

    let records = rows
        .into_iter()
        .map(|row| {
            Ok(CoRecipientRecord {
                user_id: row.try_get("recipient_user_id").map_err(|_| ApiError::Internal)?,
                email: row.try_get("email").map_err(|_| ApiError::Internal)?,
                access_level: row.try_get("access_level").map_err(|_| ApiError::Internal)?,
                created_at: row.try_get("created_at").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(records))
}
