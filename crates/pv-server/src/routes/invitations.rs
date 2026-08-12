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
use super::membership::{self, active_collection_member_join, ActiveFamilyMembership, RequireEdit};
use super::session::OptionalSessionUser;
use super::sync::{ChangeType, EntityType, SyncEvent};
use super::vault::validate_blob_len;
use super::{collections, vault};
use crate::{error::ApiError, AppState};

/// IN-01 (24-REVIEW.md): the rate-limit ceiling was previously hardcoded as
/// a literal `10` in two separate query strings (`fetch_metadata` and
/// `accept`) — changing one and not the other would make the two handlers
/// silently disagree about whether an invite is still alive. Bound as a
/// query parameter rather than interpolated into the SQL text.
const MAX_FAILED_ATTEMPTS: i64 = 10;

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
    /// Additive sibling of `collection_id`/`access_level`/`wrapped_collection_key`
    /// above (30-DECISION-FSH-02.md's Path A, never a widened/repurposed
    /// version of those singular columns) — carries the wrapped keys of every
    /// family-wide collection that existed at the moment this invite was
    /// generated (FSH-02's invite-time-wrap half). Empty or entirely absent
    /// from the request body behaves byte-identically to today: zero rows
    /// written to `invitation_family_wide_keys`.
    #[serde(default)]
    pub family_wide_keys: Vec<FamilyWideKeyEntry>,
}

/// One family-wide collection's wrapped key, carried either into an invite
/// (`CreateInvitationRequest::family_wide_keys`) or back out of one
/// (`InvitationPublicResponse::family_wide_keys`) — the same shape both
/// directions, mirroring how the existing singular `wrapped_collection_key`
/// field is reused verbatim between request and response. `wrapped_collection_key`
/// here is the same opaque `WrappedKey`-shaped JSON blob the existing singular
/// field already stores — this server never unwraps it (30-DECISION-FSH-02.md).
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FamilyWideKeyEntry {
    pub collection_id: String,
    pub access_level: String,
    pub wrapped_collection_key: String,
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
    /// Additive sibling of `collection_id`/`wrapped_collection_key` above
    /// (30-DECISION-FSH-02.md) — every family-wide collection's wrapped key
    /// this invite carries, alongside (and independently of) the existing
    /// singular single-collection-scope fields, which may independently be
    /// `null`/set. Empty for an invite carrying no family-wide keys.
    pub family_wide_keys: Vec<FamilyWideKeyEntry>,
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
    /// Additive sibling of `sealed_for_self` above (30-DECISION-FSH-02.md) —
    /// the invitee's own self-sealed blob for every family-wide collection
    /// key this invite carried. Filtered inside `accept()`'s own transaction
    /// to only entries whose `collection_id` appears in THIS invitation's own
    /// `invitation_family_wide_keys` rows (never trusted blindly from the
    /// request) — an entry for a `collection_id` this invitation never named
    /// is silently dropped, not an error.
    #[serde(default)]
    pub family_wide_sealed_keys: Vec<FamilyWideSealedKeyEntry>,
}

/// One family-wide collection's self-seal, submitted at accept-time.
/// `access_level` is deliberately NOT part of this struct — the granted
/// access_level is always read from the matching `invitation_family_wide_keys`
/// row inside the transaction, never trusted from the request body.
#[derive(Debug, Clone, Deserialize)]
pub struct FamilyWideSealedKeyEntry {
    pub collection_id: String,
    pub sealed_for_self: String,
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
    family: ActiveFamilyMembership<RequireEdit>,
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
        let requested_level = membership::parse_access_level_from_request(access_level_str)?;
        validate_blob_len(
            "wrapped_collection_key",
            req.wrapped_collection_key.as_deref().expect("checked all-or-nothing above"),
        )?;
        // An invite for a collection may only be created by someone who
        // CURRENTLY holds `edit` on it — the family owner has no implicit
        // access to a collection they were never granted a key for (mirrors
        // `collections::add_member`'s own RequireEdit-only gate).
        membership::require_collection_edit(&state.db, &family.caller_user_id, collection_id).await?;

        // 260812-01e REVIEW.md CR-01: this EXPLICIT collection-scoped grant
        // is a THIRD propagation surface the original Task 2 fix never
        // bounded -- `require_collection_edit` above only proves the caller
        // (who may be a self-escalated item_bucket contributor, Task 1's
        // mechanism) CURRENTLY holds `edit`; it never reads the collection's
        // own declared `family_wide_access_level`. Without this check, a
        // self-escalated owner could hand a brand-new invitee `edit` on a
        // bucket declared `read` via THIS field, bypassing both the
        // `add_member` bound (`collections.rs`) and the `family_wide_keys`
        // fold-in bound (the loop below) -- the same declared-level equality
        // bound, applied here for parity, scoped identically: only the
        // `Declared` state, only `item_bucket` collections (a family-wide
        // FOLDER has no contributor-escalation path, same rationale as the
        // other two call sites).
        if let membership::FamilyWideDeclaredLevel::Declared(declared) =
            membership::resolve_family_wide_declared_level(&state.db, collection_id).await?
        {
            if requested_level != declared
                && membership::is_item_bucket_collection(&state.db, collection_id).await?
            {
                return Err(ApiError::Forbidden);
            }
        }
    }

    // Validate every family_wide_keys entry BEFORE any DB work, same order as
    // the single-collection-scope validation above — reject on the first
    // failing entry, writing nothing anywhere (30-03-PLAN.md Task 1).
    //
    // Root-caused live (.planning/debug/family-wide-c-relock-fail.md): this
    // loop used to call `require_collection_edit`, same as the deliberate
    // single-collection-scope check above — but this loop is the AUTOMATIC,
    // ADDITIVE invite-time-wrap fast path (30-DECISION-FSH-02.md), which
    // folds in EVERY family-wide collection the caller currently holds ANY
    // key for, unconditionally, on every single invite the caller creates.
    // Requiring `Edit` here meant a caller who merely holds `read` on even
    // ONE family-wide collection could never generate ANY invite again — not
    // just one scoped to that collection. `require_collection_access_for_
    // propagation` requires only that the caller hold SOME access (same
    // `None -> NotFound` semantics) and bounds the requested level by what
    // they actually hold, never trusting the client's claim beyond that —
    // see that function's own doc comment for the full rationale and the
    // existing test it must keep passing
    // (`invitation_accept_grants_single_collection_and_two_family_wide_collections_atomically`).
    for entry in &req.family_wide_keys {
        let requested_level = membership::parse_access_level_from_request(&entry.access_level)?;
        validate_blob_len("wrapped_collection_key", &entry.wrapped_collection_key)?;

        // CR-02 fix (30-REVIEW.md): the relaxed `require_collection_access_
        // for_propagation` bound above was never scoped to family-wide
        // collections — nothing in this loop, `invitation_family_wide_keys`'
        // schema, or the helper itself checked `family_wide_kind IS NOT
        // NULL`, so a caller holding only `read` on an ORDINARY (deliberately
        // shared) collection could put that collection's id into this array
        // and hand a brand-new invitee a real `collection_keys` grant on it —
        // bypassing the SAME `require_collection_edit` gate the deliberate
        // single-collection-scope branch above enforces twenty lines up, and
        // that `collections::add_member` enforces for the identical
        // deliberate-share action. The relaxation exists ONLY for the
        // automatic family-wide fold-in (30-DECISION-FSH-02.md) — scope it to
        // exactly that.
        // 260812-01e Task 2 (plan-check B-3/T-30fix-05): the same
        // additional declared-level bound as `collections::add_member` --
        // see that call site's own comment for the full B-3/C-1 rationale
        // AND for the item_bucket-only scoping finding made while executing
        // this task (documented in the SUMMARY's "Deviations" section).
        // `require_collection_access_for_propagation` alone bounds by what
        // the CALLER holds, which Task 1's mechanism can put at `Edit` on a
        // bucket declared below `edit`; an ADDITIONAL equality check against
        // the collection's own `family_wide_access_level` closes that,
        // scoped to the `Declared` state AND to `item_bucket` collections
        // only -- a family-wide FOLDER has no contributor-escalation path
        // (Task 1's mechanism is item_bucket-only), so this bound must not
        // apply there.
        match membership::resolve_family_wide_declared_level(&state.db, &entry.collection_id).await? {
            membership::FamilyWideDeclaredLevel::Declared(declared) => {
                membership::require_collection_access_for_propagation(
                    &state.db,
                    &family.caller_user_id,
                    &entry.collection_id,
                    requested_level,
                )
                .await?;
                if requested_level != declared
                    && membership::is_item_bucket_collection(&state.db, &entry.collection_id).await?
                {
                    return Err(ApiError::Forbidden);
                }
            }
            membership::FamilyWideDeclaredLevel::LegacyUnknown => {
                membership::require_collection_access_for_propagation(
                    &state.db,
                    &family.caller_user_id,
                    &entry.collection_id,
                    requested_level,
                )
                .await?;
            }
            membership::FamilyWideDeclaredLevel::NotFamilyWide => {
                membership::require_collection_edit(&state.db, &family.caller_user_id, &entry.collection_id).await?;
            }
        }
    }

    // A transaction is required as soon as `family_wide_keys` is non-empty —
    // a partial-entry insert failure must not leave an orphaned `invitations`
    // row with no matching keys. Used unconditionally (even for an empty
    // `family_wide_keys`) so the empty-array path stays a single, identical
    // code path rather than a special case, with byte-identical end state
    // (zero `invitation_family_wide_keys` rows, matching today's behavior).
    let mut tx = state.db.begin().await?;

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
    .fetch_one(&mut *tx)
    .await?;

    let expires_at: String = row.try_get("expires_at").map_err(|_| ApiError::Internal)?;

    for entry in &req.family_wide_keys {
        sqlx::query(
            "INSERT INTO invitation_family_wide_keys (invitation_id, collection_id, access_level, \
                                                        wrapped_collection_key) \
             VALUES (?, ?, ?, ?)",
        )
        .bind(&req.id)
        .bind(&entry.collection_id)
        .bind(&entry.access_level)
        .bind(&entry.wrapped_collection_key)
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

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
         WHERE i.id = ? AND i.status = 'pending' AND i.expires_at > datetime('now') AND i.failed_attempts < ?",
    )
    .bind(&id)
    .bind(MAX_FAILED_ATTEMPTS)
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

    // Additive second SELECT for the family-wide sibling table
    // (30-DECISION-FSH-02.md) — after the existing single-row fetch above,
    // never merged into it, mirroring `invitation_family_wide_keys`'s own
    // additive-sibling-table shape rather than a widened query.
    let family_wide_rows = sqlx::query(
        "SELECT collection_id, access_level, wrapped_collection_key \
         FROM invitation_family_wide_keys WHERE invitation_id = ?",
    )
    .bind(&id)
    .fetch_all(&state.db)
    .await?;
    let family_wide_keys = family_wide_rows
        .into_iter()
        .map(|r| {
            Ok(FamilyWideKeyEntry {
                collection_id: r.try_get("collection_id").map_err(|_| ApiError::Internal)?,
                access_level: r.try_get("access_level").map_err(|_| ApiError::Internal)?,
                wrapped_collection_key: r.try_get("wrapped_collection_key").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(InvitationPublicResponse {
        inviter_email: row.try_get("inviter_email").map_err(|_| ApiError::Internal)?,
        family_name: row.try_get("family_name").map_err(|_| ApiError::Internal)?,
        inviter_fingerprint,
        collection_id: row.try_get("collection_id").map_err(|_| ApiError::Internal)?,
        wrapped_collection_key: row.try_get("wrapped_collection_key").map_err(|_| ApiError::Internal)?,
        family_wide_keys,
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
         FROM invitations WHERE id = ? AND status = 'pending' AND expires_at > datetime('now') AND failed_attempts < ?",
    )
    .bind(&id)
    .bind(MAX_FAILED_ATTEMPTS)
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
        // WR-05 (code review, Phase 25): shares the one
        // `active_collection_member_join!()` definition with every other
        // recipient-side resolver, so a suspended inviter's stale `edit` grant
        // can never be the basis for handing a NEW member access. Not
        // reachable today (the inviter is necessarily the family owner, and
        // an owner cannot be suspended — `suspend_member` rejects self-targets
        // and only an owner holds `RequireEdit`), but the predicate is free
        // and this is the phase that fixes the rule.
        let inviter_still_has_edit = sqlx::query(concat!(
            "SELECT 1 FROM collection_keys ck \
               JOIN collections c ON c.id = ck.collection_id ",
            active_collection_member_join!(),
            "WHERE ck.collection_id = ? AND ck.recipient_user_id = ? AND ck.access_level = 'edit'",
        ))
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

    // Every fan-out this accept() produces — the existing single-collection
    // grant below (at most one) PLUS the family-wide loop further down (zero
    // or more) — published together, AFTER commit, so a newly-added member's
    // own SyncEvent never precedes the commit that actually granted it.
    let mut fanouts: Vec<(String, Vec<String>, i64)> = Vec::new();

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
        fanouts.push((cid.clone(), members, revision));
    }

    // Family-wide loop (30-DECISION-FSH-02.md, 30-03-PLAN.md Task 2) — lives
    // INSIDE this SAME transaction, never a second one. Fetch this
    // invitation's OWN `invitation_family_wide_keys` set fresh, inside the
    // transaction, and use it as the ONLY source of truth for both which
    // `collection_id`s are legitimate (T-30-07: a client-submitted
    // `collection_id` never trusted blindly) and which `access_level` to
    // grant (never read from the request).
    let family_wide_rows = sqlx::query(
        "SELECT collection_id, access_level FROM invitation_family_wide_keys WHERE invitation_id = ?",
    )
    .bind(&id)
    .fetch_all(&mut *tx)
    .await?;
    let mut family_wide_access_by_collection: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for row in family_wide_rows {
        let cid: String = row.try_get("collection_id").map_err(|_| ApiError::Internal)?;
        let level: String = row.try_get("access_level").map_err(|_| ApiError::Internal)?;
        family_wide_access_by_collection.insert(cid, level);
    }

    for entry in &req.family_wide_sealed_keys {
        // Silently drop any entry whose collection_id is not one THIS
        // invitation itself carried a family-wide wrap for — never an error,
        // matching the behavior spec exactly (a mismatched/forged entry
        // cannot manufacture access to an unrelated collection).
        let Some(access_level_str) = family_wide_access_by_collection.get(&entry.collection_id) else {
            continue;
        };

        // WR-01 fix (30-REVIEW.md): Pitfall 9's re-validation ("the
        // inviter's CURRENT authority against the LIVE transaction
        // snapshot, never assumed from creation time") was applied to the
        // single EXPLICIT collection scope above (`inviter_still_has_edit`)
        // but not to this family-wide loop — every entry here inserted a
        // `collection_keys` row with NO corresponding check that the
        // inviter still holds ANY grant on it. Zero-knowledge still held (a
        // post-revocation re-key rotates the key, so the stale wrapped blob
        // decrypts to nothing useful), but the AUTHORIZATION row landed
        // regardless, and the newcomer then resolved real access to that
        // collection's listing and ciphertext. Silently dropped, same
        // policy as an unknown/mismatched collection_id above — never an
        // error, since a stale invite entry is not the invitee's fault.
        let inviter_still_has_access = sqlx::query(concat!(
            "SELECT 1 FROM collection_keys ck \
               JOIN collections c ON c.id = ck.collection_id ",
            active_collection_member_join!(),
            "WHERE ck.collection_id = ? AND ck.recipient_user_id = ?",
        ))
        .bind(&entry.collection_id)
        .bind(&inviter_user_id)
        .fetch_optional(&mut *tx)
        .await?
        .is_some();
        if !inviter_still_has_access {
            continue;
        }

        validate_blob_len("sealed_for_self", &entry.sealed_for_self)?;

        // Same conflict discipline as the existing single-collection branch
        // above: on conflict, fail the WHOLE call (never partially consume
        // the invite) — let `tx` drop uncommitted.
        let key_inserted = collections::insert_collection_key(
            &mut *tx,
            &entry.collection_id,
            &session.user_id,
            &entry.sealed_for_self,
            access_level_str,
        )
        .await?;
        if !key_inserted {
            return Err(ApiError::NotFound);
        }

        let members = vault::resolve_collection_members(&mut tx, &entry.collection_id).await?;
        let revision: i64 = sqlx::query_scalar("SELECT revision FROM collections WHERE id = ?")
            .bind(&entry.collection_id)
            .fetch_one(&mut *tx)
            .await?;
        fanouts.push((entry.collection_id.clone(), members, revision));
    }

    tx.commit().await?;

    for (cid, members, revision) in fanouts {
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
    membership: ActiveFamilyMembership<RequireEdit>,
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
