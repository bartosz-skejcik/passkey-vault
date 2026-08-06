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
    active_collection_member_join, parse_access_level_from_request, ActiveFamilyMembership, Collection,
    FamilyMembership, Membership, RequireEdit, RequireRead,
};
use super::sync::{ChangeType, EntityType, SyncEvent};
use super::vault::{resolve_collection_members, validate_blob_len};
use crate::{error::ApiError, AppState};

// WR-06 (code review iteration 2): this module used to keep its own copy of
// "resolve a collection's current recipient set" (`resolve_collection_recipients`,
// a bare `SELECT recipient_user_id FROM collection_keys WHERE collection_id = ?`)
// alongside `vault.rs::resolve_collection_members`'s own — the SAME question,
// answered by TWO different queries. `vault.rs`'s version additionally joins
// `family_members` (mirroring `membership::Collection::resolve_access`
// exactly), so a stale `collection_keys` row for a caller no longer in the
// owning family could NOT resolve to access via `Membership<Collection, _>`
// (404) but WOULD still have received an `EntityType::Collection` event from
// this module's own copy — the precise shape of CR-01, just not reachable
// today (no family-removal endpoint exists yet; Phase 25 owns it). Deleted
// this module's copy entirely and imported the one, shared definition below
// instead of letting the divergence sit invisibly between two call sites.

#[derive(Deserialize)]
pub struct CreateCollectionRequest {
    /// A-1 (26-CONTEXT.md, WR-09 fix): client-minted UUID-v4. MUST be
    /// generated and shape-validated client-side BEFORE `enc_name` is
    /// encrypted, because `enc_name`'s AAD is bound to this exact id
    /// (`encryptItemForCollection(ck, name, id, id, 1)`) — minting it
    /// server-side (the old behavior) meant no real client could ever
    /// produce a decryptable name, since the id the AAD was bound to did not
    /// exist yet at encryption time. Shape-validated in `create()` below
    /// BEFORE any DB work (mirrors `invitations.rs:114-129`'s
    /// fail-closed-before-DB-work discipline); a collision is mapped to a
    /// clean `ApiError::Conflict` (409), never a raw `sqlx::Error`-propagated
    /// 500.
    pub id: String,
    /// Symmetric blob: the collection's name encrypted client-side under a
    /// freshly-generated `CollectionKey` — never decrypted server-side.
    pub enc_name: String,
    /// The SAME fresh `CollectionKey`, `seal()`ed client-side to the
    /// CREATOR's own `IdentityPublicKey` — never unwrapped server-side.
    pub sealed_key: String,
}

/// Shape-validates a client-minted collection id as UUID-v4: exactly 36
/// characters, hyphens at positions 8/13/18/23, hex digits everywhere else.
/// Mirrors `invitations.rs:114-129`'s "reject before touching the PK column"
/// discipline — called BEFORE any DB work in `create()` below, so a
/// malformed/oversized string can never reach the INSERT or get echoed back
/// in a response.
fn validate_collection_id_shape(id: &str) -> Result<(), ApiError> {
    let bytes = id.as_bytes();
    let shape_ok = bytes.len() == 36
        && bytes
            .iter()
            .enumerate()
            .all(|(i, &b)| if matches!(i, 8 | 13 | 18 | 23) { b == b'-' } else { b.is_ascii_hexdigit() });
    if shape_ok {
        Ok(())
    } else {
        Err(ApiError::BadRequest("id must be a 36-character UUID-v4 string".into()))
    }
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
/// WR-06 (code review, Phase 25): `ActiveFamilyMembership`, not
/// `FamilyMembership` — `resolve_family_role` carried no status predicate, so
/// a SUSPENDED member could create a folder inside the family they are
/// suspended from (and then immediately 404 on reading it back, since
/// `Collection::resolve_access` denies them). The gate lives in this
/// signature, never as an `if` in the body.
pub async fn create(
    State(state): State<AppState>,
    family: ActiveFamilyMembership<RequireRead>,
    Json(req): Json<CreateCollectionRequest>,
) -> Result<(StatusCode, Json<CollectionResponse>), ApiError> {
    // A-1 (WR-09 fix): shape-validate the client-minted id BEFORE any DB
    // work — same discipline as the blob-length checks below.
    validate_collection_id_shape(&req.id)?;
    validate_blob_len("enc_name", &req.enc_name)?;
    validate_blob_len("sealed_key", &req.sealed_key)?;

    let mut tx = state.db.begin().await?;

    let id = req.id;

    // ON CONFLICT DO NOTHING RETURNING + fetch_optional (mirrors
    // `insert_collection_key`'s own idiom, `collections.rs:294-313`) — a
    // colliding client-minted id must surface as a clean `ApiError::Conflict`
    // (409), never a raw `?`-propagated `sqlx::Error` falling through
    // `error.rs:74-79`'s blanket `From<sqlx::Error>` mapping to an
    // undifferentiated 500.
    let row = sqlx::query(
        "INSERT INTO collections (id, family_id, enc_name) VALUES (?, ?, ?) \
         ON CONFLICT(id) DO NOTHING RETURNING created_at",
    )
    .bind(&id)
    .bind(&family.family_id)
    .bind(&req.enc_name)
    .fetch_optional(&mut *tx)
    .await?;
    let row = row.ok_or_else(|| ApiError::Conflict("a collection with this id already exists".into()))?;
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
    // WR-05 (code review, Phase 25) — audit finding beyond the two the review
    // named: this query carried NO `family_members` join at all, so a
    // suspended member's folder list still enumerated every collection they
    // hold a `collection_keys` row for. No new secret leaks through it (the
    // `sealed_key` returned is the caller's OWN, which they necessarily
    // already hold), but listing a folder that `GET /api/vault/collections/{id}`
    // then 404s on — `Collection::resolve_access` denies them — is incoherent,
    // and it contradicts FAM-09's stated property. Now uses the same
    // `active_collection_member_join!()` every other recipient-side resolver
    // does, so a suspended member sees an empty list alongside their E5 banner.
    let rows = sqlx::query(concat!(
        "SELECT c.id, c.enc_name, c.created_at, ck.access_level, ck.sealed_key \
         FROM collections c JOIN collection_keys ck ON ck.collection_id = c.id ",
        active_collection_member_join!(),
        "WHERE ck.recipient_user_id = ? ORDER BY c.created_at ASC, c.id ASC",
    ))
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

#[derive(Serialize)]
pub struct CollectionItemRow {
    pub id: String,
    pub enc_key: String,
    pub enc_data: String,
    /// CR-04 (code review, Phase 25): the item's CURRENT revision. Without it
    /// no client can decrypt `enc_data` at all, because
    /// `pv_core::items::decrypt_item_for_collection` binds the payload's AAD
    /// to the revision — `RemoveMemberDialog` was forced to hardcode a guess
    /// of `1`, which is wrong for every item that has ever been edited, and
    /// wrong for EVERY item reaching a collection through the only real
    /// server path (`vault::move_item` bumps to >= 2). Purely additive to the
    /// wire shape; the `enc_key` AAD is revision-independent (it pins
    /// revision `0`), so re-key batches built from this endpoint are
    /// unaffected.
    pub revision: i64,
}

/// `GET /api/vault/collections/{id}/items` — `Membership<Collection,
/// RequireRead>`-gated, returns the collection's FULL item set (id, enc_key,
/// enc_data) from EVERY author, not just the caller's own rows. Deliberately
/// distinct from `vault::fetch_items_for`, which structurally CANNOT answer
/// this question — it always scopes its query to `WHERE user_id = ?`,
/// because it serves the personal-vault-list endpoint. This handler applies
/// no author filter at all: the `Membership` extractor already authorized
/// the WHOLE collection, so every item in it is fair game. Read-only, no
/// transaction needed (Phase 25, Plan 25-03's own client — and Plan 25-07's
/// real client — calls this to build the re-key batch `remove_member`
/// consumes).
pub async fn collection_items(
    State(state): State<AppState>,
    membership: Membership<Collection, RequireRead>,
) -> Result<Json<Vec<CollectionItemRow>>, ApiError> {
    let rows =
        sqlx::query("SELECT id, enc_key, enc_data, revision FROM vault_items WHERE collection_id = ? ORDER BY id ASC")
            .bind(&membership.resource_id)
            .fetch_all(&state.db)
            .await?;

    let items = rows
        .into_iter()
        .map(|row| {
            Ok(CollectionItemRow {
                id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                enc_key: row.try_get("enc_key").map_err(|_| ApiError::Internal)?,
                enc_data: row.try_get("enc_data").map_err(|_| ApiError::Internal)?,
                revision: row.try_get("revision").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(items))
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

/// Shared `INSERT INTO collection_keys` helper (24-CONTEXT.md's locked
/// constraint #6 / 24-RESEARCH.md Pattern 2) — the ONLY place this INSERT
/// lives. `add_member`'s own HTTP handler and Plan 24-02's
/// `invitations::accept` both call this instead of writing a second, parallel
/// membership-write path (24-RESEARCH.md Pitfall 3). `impl SqliteExecutor<'_>`
/// mirrors `families::insert_family_member`'s signature shape so either
/// caller can pass `&state.db` or `&mut *tx` against the identical function.
/// Returns `true` if a row was inserted, `false` on conflict — never errors
/// on conflict itself, since the caller decides whether a conflict is an
/// error. This helper does NOT re-implement `add_member`'s confused-deputy
/// guard (family-membership + keypair-existence checks) — that guard does
/// NOT apply verbatim to invite-accept, which is establishing the very
/// membership row the guard would check for in the same transaction; it
/// stays in the HTTP handler below, and invite-accept re-derives its own
/// equivalent from the invite row's own fields (24-RESEARCH.md Pattern 2).
pub(crate) async fn insert_collection_key(
    executor: impl sqlx::SqliteExecutor<'_>,
    collection_id: &str,
    recipient_user_id: &str,
    sealed_key: &str,
    access_level: &str,
) -> Result<bool, ApiError> {
    let result = sqlx::query(
        "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
         VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING recipient_user_id",
    )
    .bind(collection_id)
    .bind(recipient_user_id)
    .bind(sealed_key)
    .bind(access_level)
    .fetch_optional(executor)
    .await?;

    Ok(result.is_some())
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

    // WR-06 (code review iteration 1): the INSERT, the recipient resolution,
    // and the revision read all now run in ONE transaction (WR-01
    // discipline, matching every `vault.rs` mutation handler) — previously
    // three independent statements against `&state.db`, so a concurrent
    // revoke between the INSERT and the recipient resolution could produce a
    // fan-out set matching neither the before- nor the after-state. Publish
    // still happens strictly AFTER `tx.commit()` succeeds.
    let mut tx = state.db.begin().await?;

    let inserted = insert_collection_key(
        &mut *tx,
        &membership.resource_id,
        &req.recipient_user_id,
        &req.sealed_key,
        &req.access_level,
    )
    .await?;

    if !inserted {
        return Err(ApiError::Conflict("recipient already has access to this collection".into()));
    }

    // SYNC-05 (Phase 23, Task 2): membership just changed — fan out an
    // EntityType::Collection event to the FULL current recipient set,
    // queried FRESH after the INSERT above, so it naturally includes the
    // just-added member (CONTEXT.md's hard constraint #2: membership
    // resolution is fresh at emit time, never cached). `collections.revision`
    // itself is NOT bumped here — only item mutations bump it (SYNC-04); this
    // event carries the collection's CURRENT (unbumped-by-this-call)
    // revision. WR-05 (code review iteration 2): this is a KNOWN, documented
    // wire-contract gap, not an oversight — see `sync.rs`'s
    // `EntityType::Collection` doc comment for the full rationale and the
    // resulting "never gate a re-fetch on this event's revision" client rule.
    let recipients = resolve_collection_members(&mut tx, &membership.resource_id).await?;
    let current_revision: i64 = sqlx::query_scalar("SELECT revision FROM collections WHERE id = ?")
        .bind(&membership.resource_id)
        .fetch_one(&mut *tx)
        .await?;

    tx.commit().await?;

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
    // WR-06 (code review iteration 1): the guarded DELETE, the follow-up
    // recipient resolution, and the revision read all now run in ONE
    // transaction (WR-01 discipline) — previously three independent
    // statements against `&state.db`, so a concurrent revoke between the
    // DELETE and the recipient resolution could produce a fan-out set
    // matching neither the before- nor the after-state. Publish still
    // happens strictly AFTER `tx.commit()` succeeds.
    let mut tx = state.db.begin().await?;

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
    .execute(&mut *tx)
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
        .fetch_optional(&mut *tx)
        .await?;
        return match exists {
            Some(_) => Err(ApiError::Conflict(
                "cannot revoke the last key-holder — the collection's contents would become permanently unreadable"
                    .into(),
            )),
            None => Err(ApiError::NotFound),
        };
    }

    // Phase 25 (WR-07 closure): bumps the REVOKED recipient's own
    // `vault_revision` in the SAME transaction as the DELETE above — mirrors
    // `vault.rs::revoke_share`'s identical own-counter-bump pattern, target
    // `vault_revision` (not `shared_direct_revision` — that bucket is for
    // direct `item_shares`, a different surface). Without this, a revoked
    // recipient's next `GET /api/sync?since=<their last-known revision>`
    // still matched their stale counter and returned the cheap `{revision}`
    // up-to-date shape instead of a fresh snapshot, so their local cache
    // never learned to prune the collection it can no longer decrypt.
    // 25-03-PLAN.md Task 3 closes this inherited debt for this sibling
    // revocation path — `families::apply_member_removal_rekey` already
    // carries the equivalent bump on the NEW removal path.
    sqlx::query("UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ?")
        .bind(&target_user_id)
        .execute(&mut *tx)
        .await?;

    // SYNC-05 (Phase 23, Task 2): fan out AFTER the DELETE — recipients
    // resolved fresh now naturally EXCLUDE `target_user_id` (their
    // collection_keys row is gone), so the just-removed member's own WS
    // channel receives NOTHING about this collection ever again from this
    // call (T-23-10's mitigation: never notify a removed member of their own
    // removal through the very channel being cut). WR-05 (code review
    // iteration 2): this event's `revision` is `collections.revision`,
    // unbumped by this membership-only change — see `sync.rs`'s
    // `EntityType::Collection` doc comment for the documented wire-contract
    // rationale and the resulting client rule.
    let recipients = resolve_collection_members(&mut tx, &membership.resource_id).await?;
    let current_revision: i64 = sqlx::query_scalar("SELECT revision FROM collections WHERE id = ?")
        .bind(&membership.resource_id)
        .fetch_one(&mut *tx)
        .await?;

    tx.commit().await?;

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

/// Shared co-recipient shape for BOTH collection-scoped access listing
/// (`access_list`, below) and direct per-item share listing
/// (`vault::list_item_shares`, 26-04-PLAN.md Task 1) — one vocabulary for
/// the client, since D-3's avatar stack and D-1's Sharing overview consume
/// both. Never includes `sealed_key` (T-22-16) — other members' sealed
/// blobs are useless to anyone but their own recipient, but are not
/// gratuitously exposed regardless. `suspended` (A-7, CONTEXT.md) is
/// deliberately a flag, never a filter — a suspended recipient's grant
/// still exists (and reinstating them restores the access it already
/// resolves to `None` for via `Item`/`Collection::resolve_access`'s
/// `fm.status = 'active'` predicate), so hiding the row would tell the
/// owner nobody has access when a single click would restore it.
#[derive(Serialize)]
pub struct CoRecipientRecord {
    pub user_id: String,
    pub email: String,
    pub access_level: String,
    pub created_at: String,
    pub suspended: bool,
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
        "SELECT ck.recipient_user_id, u.email, ck.access_level, ck.created_at, \
                (fm.status = 'suspended') AS suspended \
         FROM collection_keys ck JOIN users u ON u.id = ck.recipient_user_id \
         JOIN family_members fm ON fm.user_id = ck.recipient_user_id \
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
                suspended: row.try_get("suspended").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(records))
}
