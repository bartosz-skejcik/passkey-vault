//! `/api/invitations` — single-use, no-SMTP family/collection invitations
//! (FAM-04/05/06; 24-CONTEXT.md's Amendment 2 proof-of-possession leg).
//!
//! **This module MUST NEVER call `pv_core::invite`'s derive/wrap/unwrap
//! functions, nor `pv_core::identity::seal`/`unseal`** — it stores/serves
//! only opaque `wrapped_collection_key TEXT`/`sealed_key TEXT`/`proof_hash
//! BLOB` columns, exactly like `collections.rs`'s own "server sees only
//! opaque blobs" discipline. The ONE piece of server-side hashing this
//! module does — re-hashing a client-submitted `invite_proof` for comparison
//! against the stored `proof_hash` — lives in `pv_server::crypto::
//! hash_invite_proof`, never `pv_core` (a DIFFERENT function from
//! `pv_core::invite::hash_invite_proof`, Plan 24-01's client-side twin used
//! at CREATION time to compute the value this server stores).
//!
//! Amendment 2's central property: `invite_id` alone (observable in a
//! server/proxy access log or a `Referer` header) must NOT be sufficient to
//! redeem OR even read metadata for an invite — both `fetch_metadata` and
//! `accept` require the caller to also present the correct `invite_proof`,
//! compared via the same constant-time comparator `auth.rs::login()` already
//! uses for `auth_hash` (`crate::crypto`'s XOR-accumulate fn), never a plain
//! `==`.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::families;
use super::membership::{self, FamilyMembership, RequireEdit};
use super::session::OptionalSessionUser;
use super::sync::{ChangeType, EntityType, SyncEvent};
use super::vault::validate_blob_len;
use super::{collections, vault};
use crate::{error::ApiError, AppState};

#[derive(Deserialize)]
pub struct CreateInvitationRequest {
    /// Client-computed `invite_id` (HKDF-derived from `invite_secret`,
    /// `pv_core::invite::derive_invite_id`) — used directly as this table's
    /// PRIMARY KEY, never generated server-side (mirrors `0017_invitations.sql`'s
    /// own doc comment).
    pub id: String,
    pub collection_id: Option<String>,
    pub access_level: Option<String>,
    /// Opaque `WrappedKey`-shaped JSON — never unwrapped server-side.
    pub wrapped_collection_key: Option<String>,
    /// base64-`STANDARD`-encoded 32-byte `SHA-256(invite_proof)` — the server
    /// stores only this hash and never sees `invite_proof` itself at creation
    /// time (Amendment 2's zero-knowledge-preserving property).
    pub proof_hash: String,
    /// One of `"1h"` / `"24h"` / `"7d"` — anything else is `400`.
    pub expires_in: String,
}

#[derive(Serialize)]
pub struct CreateInvitationResponse {
    pub id: String,
    pub expires_at: String,
}

#[derive(Deserialize)]
pub struct FetchMetadataRequest {
    /// base64-`STANDARD`-encoded raw `invite_proof` — a credential, so it
    /// travels in a POST body, never a path/query string an access log could
    /// capture (Amendment 2).
    pub invite_proof: String,
}

#[derive(Serialize)]
pub struct InvitationPublicResponse {
    pub inviter_email: String,
    pub family_name: String,
    pub inviter_fingerprint: Option<String>,
    pub collection_id: Option<String>,
    pub wrapped_collection_key: Option<String>,
}

#[derive(Deserialize)]
pub struct AcceptInvitationRequest {
    pub invite_proof: String,
    /// The invitee's OWN self-sealed Collection Key blob (`identity::seal`'d
    /// client-side to their own `IdentityPublicKey`), required only for a
    /// collection-scoped invite. This is the ONLY thing the body carries that
    /// the server cannot compute itself — never a role/family/collection
    /// (CONTEXT.md's locked constraint #2; the stored `invitations` row is
    /// the sole source of authority for everything else).
    pub sealed_for_self: Option<String>,
}

#[derive(Serialize)]
pub struct AcceptInvitationResponse {
    pub already_member: bool,
}

/// `POST /api/invitations` — owner-only (`FamilyMembership<RequireEdit>`).
/// Creates a `pending` invite row for a family-only (`collection_id: null`)
/// or collection-scoped grant.
pub async fn create(
    State(state): State<AppState>,
    family: FamilyMembership<RequireEdit>,
    Json(req): Json<CreateInvitationRequest>,
) -> Result<(StatusCode, Json<CreateInvitationResponse>), ApiError> {
    // WR-05 (24-REVIEW.md): `req.id` is written straight into the PRIMARY KEY
    // column with no shape validation, unlike every other client-supplied
    // blob on this handler (`proof_hash`/`wrapped_collection_key` are both
    // validated below). A real client's `id` is always
    // `pv_core::invite::derive_invite_id`'s own output — URL_SAFE_NO_PAD
    // base64 of a 32-byte HKDF digest, i.e. exactly 43 characters from the
    // URL-safe alphabet. Reject anything else BEFORE any DB work, so an
    // unbounded string can never reach the PK column or get echoed back in
    // the response, and a same-id collision surfaces as this 400 rather
    // than an opaque 500 further down (IN-07 is the residual, now-narrower
    // gap: a collision between two VALID-shaped ids).
    if req.id.len() != 43 || !req.id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
        return Err(ApiError::BadRequest(
            "id must be a 43-character URL-safe base64 invite_id".into(),
        ));
    }

    // Never interpolate the client's own string into SQL — map to one of
    // exactly three fixed `datetime()` modifier literals via an explicit
    // non-wildcard `_ => Err` arm.
    let modifier = match req.expires_in.as_str() {
        "1h" => "+1 hours",
        "24h" => "+24 hours",
        "7d" => "+7 days",
        _ => return Err(ApiError::BadRequest("expires_in must be one of \"1h\", \"24h\", \"7d\"".into())),
    };

    // Collection-field consistency, checked in Rust BEFORE any DB work —
    // mirrors the migration's own table-level CHECK at the application
    // layer: all three of collection_id/access_level/wrapped_collection_key
    // travel together, or none of them do.
    let collection_fields_present =
        (req.collection_id.is_some(), req.access_level.is_some(), req.wrapped_collection_key.is_some());
    match collection_fields_present {
        (true, true, true) | (false, false, false) => {}
        _ => {
            return Err(ApiError::BadRequest(
                "collection_id, access_level, and wrapped_collection_key must all be present or all absent".into(),
            ))
        }
    }

    // proof_hash is ALWAYS required (Amendment 2 applies to every invite,
    // family-only or collection-scoped alike) — a fixed-length 32-byte
    // SHA-256 digest, base64-STANDARD-encoded (a JSON body field, not a URL
    // segment).
    let proof_hash_bytes = STANDARD
        .decode(&req.proof_hash)
        .map_err(|_| ApiError::BadRequest("proof_hash must be valid base64".into()))?;
    if proof_hash_bytes.len() != 32 {
        return Err(ApiError::BadRequest("proof_hash must decode to exactly 32 bytes".into()));
    }

    if let Some(collection_id) = &req.collection_id {
        let access_level_str = req.access_level.as_deref().expect("checked all-or-nothing above");
        membership::parse_access_level_from_request(access_level_str)?;
        validate_blob_len(
            "wrapped_collection_key",
            req.wrapped_collection_key.as_deref().expect("checked all-or-nothing above"),
        )?;
        // An invite for a collection may only be created by someone who
        // CURRENTLY holds `edit` on it — the family owner has no implicit
        // access to a collection they were never granted a key for (mirrors
        // `collections::add_member`'s own RequireEdit-only gate).
        membership::require_collection_edit(&state.db, &family.caller_user_id, collection_id).await?;
    }

    // A single statement needs no explicit transaction.
    let row = sqlx::query(
        "INSERT INTO invitations (id, family_id, collection_id, inviter_user_id, access_level, \
                                   wrapped_collection_key, proof_hash, expires_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?)) \
         RETURNING expires_at",
    )
    .bind(&req.id)
    .bind(&family.family_id)
    .bind(&req.collection_id)
    .bind(&family.caller_user_id)
    .bind(&req.access_level)
    .bind(&req.wrapped_collection_key)
    .bind(proof_hash_bytes.as_slice())
    .bind(modifier)
    .fetch_one(&state.db)
    .await?;

    let expires_at: String = row.try_get("expires_at").map_err(|_| ApiError::Internal)?;

    Ok((StatusCode::CREATED, Json(CreateInvitationResponse { id: req.id, expires_at })))
}

/// `POST /api/invitations/{id}` — the pre-redemption metadata fetch. A POST,
/// not a GET, per Amendment 2: the request now carries a credential
/// (`invite_proof`), and a credential belongs in a body, never a path/query
/// string an access log or proxy log would capture. No extractor beyond
/// `State`/`Path`/`Json` — this route works with NO session at all.
pub async fn fetch_metadata(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(req): Json<FetchMetadataRequest>,
) -> Result<Json<InvitationPublicResponse>, ApiError> {
    let row = sqlx::query(
        "SELECT i.proof_hash, i.collection_id, i.wrapped_collection_key, \
                u.email AS inviter_email, f.name AS family_name, uk.public_key AS inviter_public_key \
         FROM invitations i \
         JOIN users u ON u.id = i.inviter_user_id \
         JOIN families f ON f.id = i.family_id \
         LEFT JOIN user_keypairs uk ON uk.user_id = i.inviter_user_id \
         WHERE i.id = ? AND i.status = 'pending' AND i.expires_at > datetime('now') AND i.failed_attempts < 10",
    )
    .bind(&id)
    .fetch_optional(&state.db)
    .await?;

    let row = row.ok_or(ApiError::NotFound)?;

    let stored_proof_hash: Vec<u8> = row.try_get("proof_hash").map_err(|_| ApiError::Internal)?;

    // A decode failure or wrong length is treated EXACTLY like a proof
    // mismatch below — `unwrap_or_default()` (never a distinct BadRequest)
    // means a malformed proof is exactly as unrevealing as a wrong one.
    let decoded_proof = STANDARD.decode(&req.invite_proof).unwrap_or_default();
    let computed = crate::crypto::hash_invite_proof(&decoded_proof);

    if !crate::crypto::constant_time_eq(&computed, &stored_proof_hash) {
        sqlx::query("UPDATE invitations SET failed_attempts = failed_attempts + 1 WHERE id = ? AND status = 'pending'")
            .bind(&id)
            .execute(&state.db)
            .await?;
        // The SAME ApiError variant as the unknown-id case above — no
        // distinguishing field, closing T-24-07.
        return Err(ApiError::NotFound);
    }

    // WR-04: reset the ceiling on a VERIFIED proof, so only *consecutive*
    // failures accumulate toward it. Without this, the legitimate invitee
    // (who has already proven possession here) could still be one guess
    // from permanently killing their own still-pending invite, and — more
    // importantly — anyone who merely learns `invite_id` (proxy log,
    // Referer, shoulder-glance) could kill it with ten unauthenticated
    // wrong-proof POSTs, since this endpoint needs no session at all.
    // Amendment 1's ceiling mechanism itself is unchanged; this only closes
    // the gap between Amendment 2's stated "useless on its own" property and
    // the shipped one.
    sqlx::query("UPDATE invitations SET failed_attempts = 0 WHERE id = ? AND status = 'pending'")
        .bind(&id)
        .execute(&state.db)
        .await?;

    let inviter_public_key: Option<Vec<u8>> = row.try_get("inviter_public_key").map_err(|_| ApiError::Internal)?;
    let inviter_fingerprint = inviter_public_key.as_deref().map(families::fingerprint_hex);

    Ok(Json(InvitationPublicResponse {
        inviter_email: row.try_get("inviter_email").map_err(|_| ApiError::Internal)?,
        family_name: row.try_get("family_name").map_err(|_| ApiError::Internal)?,
        inviter_fingerprint,
        collection_id: row.try_get("collection_id").map_err(|_| ApiError::Internal)?,
        wrapped_collection_key: row.try_get("wrapped_collection_key").map_err(|_| ApiError::Internal)?,
    }))
}

/// `POST /api/invitations/{id}/accept` — the phase's one deliberately
/// low-trust write surface (CONTEXT.md). `OptionalSessionUser`, never
/// `SessionUser` directly: the extractor itself never widens authorization —
/// a missing session is rejected explicitly below, exactly as strictly as
/// `SessionUser` would reject it, but this handler needs the `None` branch to
/// exist at all so the same code path can be reasoned about uniformly.
pub async fn accept(
    State(state): State<AppState>,
    OptionalSessionUser(session): OptionalSessionUser,
    Path(id): Path<String>,
    Json(req): Json<AcceptInvitationRequest>,
) -> Result<Json<AcceptInvitationResponse>, ApiError> {
    let Some(session) = session else { return Err(ApiError::Unauthorized) };

    // WR-04-style: `BEGIN IMMEDIATE`, not a deferred `BEGIN` — this handler's
    // first statement is a READ (resolve + validate the invite row), and only
    // the later UPDATE/INSERTs are writes. A deferred transaction that reads
    // first and writes later can be rejected with SQLITE_BUSY_SNAPSHOT under
    // WAL when another writer commits in between, and SQLite does not invoke
    // the busy handler for that case (c94c379, WR-04 in vault.rs).
    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;

    let row = sqlx::query(
        "SELECT family_id, collection_id, access_level, wrapped_collection_key, inviter_user_id, proof_hash \
         FROM invitations WHERE id = ? AND status = 'pending' AND expires_at > datetime('now') AND failed_attempts < 10",
    )
    .bind(&id)
    .fetch_optional(&mut *tx)
    .await?;

    let Some(row) = row else {
        // Best-effort bump — no-ops if the row doesn't exist or isn't
        // pending. Same ApiError variant `fetch_metadata` uses for its own
        // "no such pending row" case.
        sqlx::query("UPDATE invitations SET failed_attempts = failed_attempts + 1 WHERE id = ? AND status = 'pending'")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(ApiError::NotFound);
    };

    let stored_proof_hash: Vec<u8> = row.try_get("proof_hash").map_err(|_| ApiError::Internal)?;
    let decoded_proof = STANDARD.decode(&req.invite_proof).unwrap_or_default();
    let computed = crate::crypto::hash_invite_proof(&decoded_proof);

    if !crate::crypto::constant_time_eq(&computed, &stored_proof_hash) {
        // T-24-22: a WRONG proof increments failed_attempts but explicitly
        // does NOT flip `status` — a single incorrect guess (or repeated
        // ones, up to the ceiling) can never burn the invite for the real
        // invitee.
        sqlx::query("UPDATE invitations SET failed_attempts = failed_attempts + 1 WHERE id = ? AND status = 'pending'")
            .bind(&id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        return Err(ApiError::NotFound);
    }

    // WR-04: same reset as `fetch_metadata` — a verified proof here means
    // only consecutive failures should count toward the ceiling. Applied
    // even though `status` is about to flip to 'accepted' on the success
    // path below, because a LATER authority check in this same handler
    // (inviter no longer owner / lost collection edit) can still leave the
    // row `pending` — in that case this reset is what keeps the invite
    // alive for a legitimate retry instead of counting a correct proof
    // against the same ceiling a wrong one would.
    sqlx::query("UPDATE invitations SET failed_attempts = 0 WHERE id = ? AND status = 'pending'")
        .bind(&id)
        .execute(&mut *tx)
        .await?;

    let family_id: String = row.try_get("family_id").map_err(|_| ApiError::Internal)?;
    let collection_id: Option<String> = row.try_get("collection_id").map_err(|_| ApiError::Internal)?;
    let access_level: Option<String> = row.try_get("access_level").map_err(|_| ApiError::Internal)?;
    let inviter_user_id: String = row.try_get("inviter_user_id").map_err(|_| ApiError::Internal)?;

    // Pitfall 9: re-validate the inviter's CURRENT authority against the LIVE
    // transaction snapshot, never assumed from creation time.
    // `Collection::resolve_access`/`require_collection_edit` are pool-bound
    // (`&sqlx::SqlitePool`), so this re-derives their equivalent check inline
    // against `&mut *tx`.
    let inviter_is_owner = sqlx::query(
        "SELECT 1 FROM family_members WHERE family_id = ? AND user_id = ? AND role = 'owner'",
    )
    .bind(&family_id)
    .bind(&inviter_user_id)
    .fetch_optional(&mut *tx)
    .await?
    .is_some();

    if !inviter_is_owner {
        // Let `tx` drop WITHOUT committing — sqlx rolls back on drop. Status
        // was never written to 'accepted' before this point in this
        // restructured flow, so the row is left exactly `pending`.
        return Err(ApiError::NotFound);
    }

    if let Some(cid) = &collection_id {
        let inviter_still_has_edit = sqlx::query(
            "SELECT 1 FROM collection_keys ck \
               JOIN collections c ON c.id = ck.collection_id \
               JOIN family_members fm ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id \
              WHERE ck.collection_id = ? AND ck.recipient_user_id = ? AND ck.access_level = 'edit'",
        )
        .bind(cid)
        .bind(&inviter_user_id)
        .fetch_optional(&mut *tx)
        .await?
        .is_some();

        if !inviter_still_has_edit {
            return Err(ApiError::NotFound);
        }
    }

    // Defense in depth (belt-and-braces, matching this codebase's style
    // elsewhere): fold the SAME guard into this UPDATE's WHERE clause again,
    // even though the BEGIN IMMEDIATE lock already makes 0-rows-affected
    // unreachable here in practice.
    let update_result = sqlx::query("UPDATE invitations SET status = 'accepted' WHERE id = ? AND status = 'pending'")
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    if update_result.rows_affected() == 0 {
        tx.commit().await?;
        return Err(ApiError::NotFound);
    }

    let newly_inserted = families::insert_family_member(&mut *tx, &family_id, &session.user_id).await?;

    let mut fanout: Option<(String, Vec<String>, i64)> = None;
    if let Some(cid) = &collection_id {
        let sealed_for_self = req
            .sealed_for_self
            .as_deref()
            .ok_or_else(|| ApiError::BadRequest("sealed_for_self is required for a collection-scoped invite".into()))?;
        validate_blob_len("sealed_for_self", sealed_for_self)?;
        let access_level_str = access_level.as_deref().ok_or(ApiError::Internal)?;

        // WR-04-in-collections-terms / WR-03 (24-REVIEW.md): `insert_collection_key`
        // is documented to return `false` on conflict rather than error, "since
        // the caller decides whether a conflict is an error" — `add_member`
        // treats that `false` as `ApiError::Conflict` (collections.rs:297-299);
        // this call site must not silently ignore the identical signal. A
        // pre-existing `collection_keys` row here means the invite's promised
        // grant CANNOT be applied as written (the recipient's existing
        // access_level is left untouched, possibly lower than promised) — do
        // NOT consume the invite (which already flipped to 'accepted' earlier
        // in THIS transaction) for a no-op. Let `tx` drop here without
        // `commit()` (sqlx rolls back on drop), undoing the status flip AND
        // the family-membership insert together, and report the SAME unified
        // failure every other cause reports so the owner can re-issue.
        let key_inserted =
            collections::insert_collection_key(&mut *tx, cid, &session.user_id, sealed_for_self, access_level_str)
                .await?;
        if !key_inserted {
            return Err(ApiError::NotFound);
        }

        // Resolve fresh AFTER the insert (mirrors `collections::add_member`'s
        // own "resolve fresh AFTER the insert, publish the collection's
        // current unbumped revision" precedent) — do not exclude the
        // just-added member, matching `add_member`'s own unfiltered fan-out.
        // Deliberately does NOT bump `collections.revision` here (matches
        // shipped `collections::add_member`'s WR-05 documented wire-contract
        // gap — a membership-only change never bumps it).
        let members = vault::resolve_collection_members(&mut tx, cid).await?;
        let revision: i64 = sqlx::query_scalar("SELECT revision FROM collections WHERE id = ?")
            .bind(cid)
            .fetch_one(&mut *tx)
            .await?;
        fanout = Some((cid.clone(), members, revision));
    }

    tx.commit().await?;

    if let Some((cid, members, revision)) = fanout {
        state.sync_hub.publish_to_recipients(
            &members,
            SyncEvent { entity_type: EntityType::Collection, id: cid, revision, change_type: ChangeType::Update },
        );
    }

    Ok(Json(AcceptInvitationResponse { already_member: !newly_inserted }))
}

/// `DELETE /api/invitations/{id}` — owner-only (`FamilyMembership<RequireEdit>`).
/// Revokes a still-pending invite. Scoped by the CALLER's OWN resolved
/// `family_id` (never a family id read from the path) — matching every other
/// `FamilyMembership`-gated handler's discipline. A subsequent
/// metadata-fetch/accept against a revoked invite renders the exact same
/// unified failure as an expired/consumed/never-existed one, even presenting
/// the objectively correct `invite_proof` — `status <> 'pending'` alone is
/// enough to fall out of every other handler's own `WHERE status = 'pending'`
/// guard.
pub async fn revoke(
    State(state): State<AppState>,
    membership: FamilyMembership<RequireEdit>,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query(
        "UPDATE invitations SET status = 'revoked' WHERE id = ? AND family_id = ? AND status = 'pending'",
    )
    .bind(&id)
    .bind(&membership.family_id)
    .execute(&state.db)
    .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    Ok(StatusCode::NO_CONTENT)
}
