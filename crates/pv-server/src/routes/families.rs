//! `/api/families` — the single-family CRUD surface (FAM-01/02/03). Every
//! handler scopes its query by the caller's OWN resolved `family_id` (via
//! `FamilyMembership<M>`) — never by an id from the request body. v0.4 is a
//! strict singleton (CONTEXT.md's locked FAM-01 decision): `create` is the
//! one exception with no membership check at all, since nothing exists yet
//! to check membership against — creating the family IS what establishes the
//! caller's own membership (mirrors how `auth`/`session`/`healthz` already
//! register as literal `.route()` calls, outside any membership table).

use axum::{extract::State, http::StatusCode, Json};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::Row;
use uuid::Uuid;

use super::membership::{FamilyMembership, RequireEdit, RequireRead};
use super::session::SessionUser;
use crate::{error::ApiError, AppState};

#[derive(Deserialize)]
pub struct CreateFamilyRequest {
    pub name: String,
}

#[derive(Serialize)]
pub struct FamilyResponse {
    pub id: String,
    pub name: String,
    pub owner_user_id: String,
    pub created_at: String,
}

/// `POST /api/families` — creates the (singleton, v0.4) family and makes the
/// caller its `owner`. A second call (family already exists) returns `409`,
/// never a silent duplicate or a second success — same mechanism covers both
/// a genuine second-create attempt and a client retry after a dropped
/// response (idempotency edge).
pub async fn create(
    State(state): State<AppState>,
    session: SessionUser,
    Json(req): Json<CreateFamilyRequest>,
) -> Result<(StatusCode, Json<FamilyResponse>), ApiError> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(ApiError::BadRequest("name must not be empty".into()));
    }

    let id = Uuid::new_v4().to_string();

    let mut tx = state.db.begin().await?;

    // Bare `ON CONFLICT DO NOTHING` (NOT a targeted `ON CONFLICT(...)`) —
    // SQLite's targeted form does not accept an expression-index target
    // syntax matching `idx_families_singleton`'s `((1))`, verified locally.
    // The bare form correctly catches a conflict against EITHER the PK or
    // the singleton index, so this is race-safe against two concurrent
    // creates without a separate SELECT-then-INSERT check.
    let result = sqlx::query(
        "INSERT INTO families (id, owner_user_id, name) VALUES (?, ?, ?) \
         ON CONFLICT DO NOTHING \
         RETURNING id, name, owner_user_id, created_at",
    )
    .bind(&id)
    .bind(&session.user_id)
    .bind(name)
    .fetch_optional(&mut *tx)
    .await?;

    let row = match result {
        Some(row) => row,
        None => return Err(ApiError::Conflict("family already exists".into())),
    };

    sqlx::query("INSERT INTO family_members (family_id, user_id, role) VALUES (?, ?, 'owner')")
        .bind(&id)
        .bind(&session.user_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    let response = FamilyResponse {
        id: row.try_get("id").map_err(|_| ApiError::Internal)?,
        name: row.try_get("name").map_err(|_| ApiError::Internal)?,
        owner_user_id: row.try_get("owner_user_id").map_err(|_| ApiError::Internal)?,
        created_at: row.try_get("created_at").map_err(|_| ApiError::Internal)?,
    };

    Ok((StatusCode::CREATED, Json(response)))
}

#[derive(Serialize)]
pub struct FamilyMemberRecord {
    pub user_id: String,
    pub email: String,
    pub role: String,
    pub joined_at: String,
    /// base64-`STANDARD`-encoded raw `public_key` BLOB, `None` when the
    /// member hasn't published an identity keypair yet (Plan 22-02 populates
    /// `user_keypairs` — this plan's query already reads it, it's simply
    /// always `None` until that plan lands). Never a raw byte array on the
    /// wire (this codebase's existing binary-field discipline).
    pub public_key: Option<String>,
    /// `Some(hex)` only when `public_key` is `Some` — a display fingerprint
    /// derived from the same bytes, never independent state.
    pub fingerprint: Option<String>,
    /// The VIEWER's own verification timestamp for this member (per-viewer,
    /// never a global "verified" flag — `identity_verifications`' composite
    /// PK is `(viewer_user_id, subject_user_id)`).
    pub verified_at: Option<String>,
}

/// Computes a display fingerprint from a public key's raw bytes — SHA-256
/// hex, no new crate needed (`sha2` is already a pinned `pv-server`
/// dependency, used the same way in `auth.rs`).
pub(crate) fn fingerprint_hex(public_key: &[u8]) -> String {
    Sha256::digest(public_key).iter().map(|b| format!("{:02x}", b)).collect::<String>()
}

/// `GET /api/families/members` — any family member may list the roster
/// (`FamilyMembership<RequireRead>`); a non-member gets `404` (existence
/// never leaks). Explicit `ORDER BY joined_at ASC, user_id ASC` — SQLite
/// gives no ordering guarantee on ties otherwise, and two members can share
/// an identical stored `joined_at` precision.
pub async fn members(
    State(state): State<AppState>,
    membership: FamilyMembership<RequireRead>,
) -> Result<Json<Vec<FamilyMemberRecord>>, ApiError> {
    let rows = sqlx::query(
        "SELECT fm.user_id, u.email, fm.role, fm.joined_at, uk.public_key, iv.verified_at \
         FROM family_members fm \
         JOIN users u ON u.id = fm.user_id \
         LEFT JOIN user_keypairs uk ON uk.user_id = fm.user_id \
         LEFT JOIN identity_verifications iv \
             ON iv.subject_user_id = fm.user_id AND iv.viewer_user_id = ? \
         WHERE fm.family_id = ? \
         ORDER BY fm.joined_at ASC, fm.user_id ASC",
    )
    .bind(&membership.caller_user_id)
    .bind(&membership.family_id)
    .fetch_all(&state.db)
    .await?;

    let records = rows
        .into_iter()
        .map(|row| {
            let public_key_bytes: Option<Vec<u8>> = row.try_get("public_key").map_err(|_| ApiError::Internal)?;
            let public_key = public_key_bytes.as_deref().map(|b| STANDARD.encode(b));
            let fingerprint = public_key_bytes.as_deref().map(fingerprint_hex);
            Ok(FamilyMemberRecord {
                user_id: row.try_get("user_id").map_err(|_| ApiError::Internal)?,
                email: row.try_get("email").map_err(|_| ApiError::Internal)?,
                role: row.try_get("role").map_err(|_| ApiError::Internal)?,
                joined_at: row.try_get("joined_at").map_err(|_| ApiError::Internal)?,
                public_key,
                fingerprint,
                verified_at: row.try_get("verified_at").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(records))
}

#[derive(Deserialize)]
pub struct AddMemberRequest {
    pub user_id: String,
}

/// `POST /api/families/members` — owner-only (`FamilyMembership<RequireEdit>`
/// gates "owner only" per `resolve_family_role`'s role mapping). Direct
/// owner-side add of an EXISTING registered user — no invite token, matching
/// the Phase 24 scope fence.
pub async fn add_member(
    State(state): State<AppState>,
    membership: FamilyMembership<RequireEdit>,
    Json(req): Json<AddMemberRequest>,
) -> Result<StatusCode, ApiError> {
    let target_exists = sqlx::query("SELECT 1 FROM users WHERE id = ?")
        .bind(&req.user_id)
        .fetch_optional(&state.db)
        .await?;
    if target_exists.is_none() {
        return Err(ApiError::NotFound);
    }

    let result = sqlx::query(
        "INSERT INTO family_members (family_id, user_id, role) VALUES (?, ?, 'member') \
         ON CONFLICT DO NOTHING \
         RETURNING user_id",
    )
    .bind(&membership.family_id)
    .bind(&req.user_id)
    .fetch_optional(&state.db)
    .await?;

    match result {
        Some(_) => Ok(StatusCode::CREATED),
        None => Err(ApiError::Conflict("user is already a family member".into())),
    }
}

#[derive(Serialize)]
pub struct CollectionAccessEntry {
    pub id: String,
    pub access_level: String,
}

#[derive(Serialize)]
pub struct ItemShareEntry {
    pub item_id: String,
    pub access_level: String,
}

#[derive(Serialize)]
pub struct MemberAccessResponse {
    pub collections: Vec<CollectionAccessEntry>,
    pub item_shares: Vec<ItemShareEntry>,
}

/// `GET /api/families/members/{user_id}/access` — owner-only per-member
/// breakdown of collections + individual item shares (FAM-03). The
/// `{user_id}` path segment is read by this handler's OWN `Path<String>`
/// extraction, never by the `FamilyMembership` extractor itself (which stays
/// pathless) — this route belongs in `family_routes()` because the
/// AUTHORIZATION GUARD is `FamilyMembership`, regardless of the path
/// happening to carry an unrelated `{user_id}` query target. Deliberately
/// does NOT first validate the path's `{user_id}` is itself a family member —
/// an owner asking about a non-member correctly returns two empty lists, not
/// an error; there is nothing to leak either way.
pub async fn member_access(
    State(state): State<AppState>,
    _membership: FamilyMembership<RequireEdit>,
    axum::extract::Path(target_user_id): axum::extract::Path<String>,
) -> Result<Json<MemberAccessResponse>, ApiError> {
    let collection_rows = sqlx::query(
        "SELECT collection_id, access_level FROM collection_keys \
         WHERE recipient_user_id = ? ORDER BY collection_id ASC",
    )
    .bind(&target_user_id)
    .fetch_all(&state.db)
    .await?;

    let collections = collection_rows
        .into_iter()
        .map(|row| {
            Ok(CollectionAccessEntry {
                id: row.try_get("collection_id").map_err(|_| ApiError::Internal)?,
                access_level: row.try_get("access_level").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    let item_share_rows = sqlx::query(
        "SELECT item_id, access_level FROM item_shares \
         WHERE recipient_user_id = ? ORDER BY item_id ASC",
    )
    .bind(&target_user_id)
    .fetch_all(&state.db)
    .await?;

    let item_shares = item_share_rows
        .into_iter()
        .map(|row| {
            Ok(ItemShareEntry {
                item_id: row.try_get("item_id").map_err(|_| ApiError::Internal)?,
                access_level: row.try_get("access_level").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(MemberAccessResponse { collections, item_shares }))
}
