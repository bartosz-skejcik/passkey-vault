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

use super::membership::{ActiveFamilyMembership, FamilyMembership, RequireEdit, RequireRead};
use super::session::SessionUser;
use super::sync::{ChangeType, EntityType, SyncEvent};
use super::vault::{bump_collection_revision, resolve_collection_members};
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

/// `GET /api/families` — the read-side mirror of `create`'s own response
/// shape (Phase 25's own `key_links` note: Plan 25-09's owner-deletion
/// honesty copy needs a way for a non-creating member to learn their
/// family's name — no existing endpoint provided one). `FamilyMembership<RequireRead>`-gated:
/// a non-member 404s before this handler body ever runs, so there is nothing
/// this handler itself needs to re-check. Registered as an EXTRA method on
/// the SAME literal `/api/families` path `create` (POST) already occupies in
/// `routes/mod.rs`'s `router_with_cors` — axum's `MethodRouter` merges
/// per-path, per-method registrations (the same mechanism already relied on
/// for `/api/invitations/{id}`'s POST/DELETE split), so this does NOT add a
/// new entry to `family_routes()`'s own cardinality-tracked table.
pub async fn get(
    State(state): State<AppState>,
    family: FamilyMembership<RequireRead>,
) -> Result<Json<FamilyResponse>, ApiError> {
    let row = sqlx::query("SELECT id, name, owner_user_id, created_at FROM families WHERE id = ?")
        .bind(&family.family_id)
        .fetch_one(&state.db)
        .await?;

    Ok(Json(FamilyResponse {
        id: row.try_get("id").map_err(|_| ApiError::Internal)?,
        name: row.try_get("name").map_err(|_| ApiError::Internal)?,
        owner_user_id: row.try_get("owner_user_id").map_err(|_| ApiError::Internal)?,
        created_at: row.try_get("created_at").map_err(|_| ApiError::Internal)?,
    }))
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
    /// `family_members.status` (`'active'`|`'suspended'`) — Phase 25's ONLY
    /// read-side surface for suspension state. Without this field,
    /// `suspend_member`/`reinstate_member` below would be write-only from the
    /// client's perspective; Plan 25-08's Members section/suspended-banner UI
    /// depends on this being present on the wire.
    pub status: String,
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
        "SELECT fm.user_id, u.email, fm.role, fm.joined_at, fm.status, uk.public_key, iv.verified_at \
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
                status: row.try_get("status").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(records))
}

#[derive(Deserialize)]
pub struct AddMemberRequest {
    pub user_id: String,
}

/// Shared `INSERT INTO family_members` helper (24-CONTEXT.md's locked
/// constraint #6 / 24-RESEARCH.md Pattern 2) — the ONLY place this INSERT
/// lives. `add_member`'s own HTTP handler and Plan 24-02's
/// `invitations::accept` both call this instead of writing a second, parallel
/// membership-write path (24-RESEARCH.md Pitfall 3). `impl SqliteExecutor<'_>`
/// (not a concrete `&SqlitePool`) lets `add_member` keep passing `&state.db`
/// unchanged while `invitations::accept` — which needs this same insert
/// inside its own `BEGIN IMMEDIATE` transaction — passes `&mut *tx` instead;
/// both compile against the identical function. Returns `true` if a row was
/// inserted, `false` on conflict — never errors on conflict itself, since the
/// caller decides whether a conflict is an error.
pub(crate) async fn insert_family_member(
    executor: impl sqlx::SqliteExecutor<'_>,
    family_id: &str,
    user_id: &str,
) -> Result<bool, ApiError> {
    let result = sqlx::query(
        "INSERT INTO family_members (family_id, user_id, role) VALUES (?, ?, 'member') \
         ON CONFLICT DO NOTHING \
         RETURNING user_id",
    )
    .bind(family_id)
    .bind(user_id)
    .fetch_optional(executor)
    .await?;

    Ok(result.is_some())
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

    let inserted = insert_family_member(&state.db, &membership.family_id, &req.user_id).await?;

    if inserted {
        Ok(StatusCode::CREATED)
    } else {
        Err(ApiError::Conflict("user is already a family member".into()))
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
    membership: FamilyMembership<RequireEdit>,
    axum::extract::Path(target_user_id): axum::extract::Path<String>,
) -> Result<Json<MemberAccessResponse>, ApiError> {
    // WR-03 (code review, Phase 25): scoped to the CALLER's own resolved
    // `family_id`, not `recipient_user_id` alone. Two reasons: an owner must
    // never learn about a grant in a family that is not theirs, and this set
    // must stay byte-identical to `apply_member_removal_rekey`'s own step-1
    // scope query — the client builds its re-key batch from this response, and
    // any scope disagreement between the two surfaces as a KEY-06 409.
    let collection_rows = sqlx::query(
        "SELECT ck.collection_id, ck.access_level FROM collection_keys ck \
           JOIN collections c ON c.id = ck.collection_id \
          WHERE ck.recipient_user_id = ? AND c.family_id = ? ORDER BY ck.collection_id ASC",
    )
    .bind(&target_user_id)
    .bind(&membership.family_id)
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

// --- Phase 30 Plan 02 (FSH-02/FSH-03): the narrow, additive family-wide-grant
// discovery endpoint. This checkpoint:decision (30-02-PLAN.md Task 1)
// selected `narrow-discovery-endpoint` over widening `Collection`/
// `Item::resolve_access` (`membership.rs`) -- those two functions are this
// codebase's sole, heavily-tested enforcement point for every revocation
// guarantee shipped since Phase 22/25, and are NOT touched by this endpoint.

/// One family-wide collection the CALLER lacks a `collection_keys` row for.
/// Deliberately ids/kind/access_level only -- no `enc_name`, no
/// `sealed_key`, no ciphertext field exists on this type to leak, on any
/// path including the empty-result case (T-30-04). `access_level` (Task 3,
/// 260812-01e) is the collection's own PUBLIC `family_wide_access_level`
/// column, not a secret.
#[derive(Serialize)]
pub struct PendingGrant {
    pub collection_id: String,
    pub kind: String,
    /// 260812-01e Task 3: with per-level `item_bucket` collections now
    /// possible (LOCKED decision 1 -- a family may hold up to three, one
    /// per access level), `kind` alone no longer disambiguates WHICH bucket
    /// a missing grant belongs to. Mirrors `family_wide_access_level`'s
    /// existing nullability elsewhere -- `None` for a legacy
    /// (pre-migration-0020) row.
    pub access_level: Option<String>,
}

/// One (family-wide collection, active member) pairing where the CALLER
/// already holds a key and the named member does not -- i.e. a grant the
/// caller COULD reseal. Deliberately ids only -- same T-30-04 discipline as
/// `PendingGrant` above.
#[derive(Serialize)]
pub struct ResealableGrant {
    pub collection_id: String,
    pub recipient_user_id: String,
}

#[derive(Serialize)]
pub struct FamilyWidePendingResponse {
    pub missing: Vec<PendingGrant>,
    pub resealable: Vec<ResealableGrant>,
}

/// `GET /api/families/family-wide-pending` -- FSH-02's narrow, additive
/// discovery endpoint (30-DECISION-FSH-02.md; confirmed by this plan's
/// checkpoint:decision, Task 1). Answers two questions `Collection`/
/// `Item::resolve_access` were never designed to answer ("can I decrypt this
/// resource right now") -- `missing`: which family-wide grants exist that the
/// CALLER doesn't hold a key for; `resealable`, inverted: which active
/// members lack a key for a family-wide collection the CALLER already holds
/// one for, i.e. a grant the caller could reseal. `ActiveFamilyMembership<RequireRead>`-gated
/// (T-30-03) -- a suspended/removed caller gets 403/404 before either query
/// runs, exactly like every other family-scoped read. Both queries scope
/// `family_id = ?` to the CALLER's own resolved `family_id` (T-30-05), never
/// a client-supplied one, matching `member_access`'s own WR-03 discipline
/// above.
pub async fn family_wide_pending(
    State(state): State<AppState>,
    membership: ActiveFamilyMembership<RequireRead>,
) -> Result<Json<FamilyWidePendingResponse>, ApiError> {
    let missing_rows = sqlx::query(
        "SELECT c.id, c.family_wide_kind, c.family_wide_access_level FROM collections c \
          WHERE c.family_id = ? AND c.family_wide_kind IS NOT NULL \
            AND NOT EXISTS (SELECT 1 FROM collection_keys ck \
                             WHERE ck.collection_id = c.id AND ck.recipient_user_id = ?)",
    )
    .bind(&membership.family_id)
    .bind(&membership.caller_user_id)
    .fetch_all(&state.db)
    .await?;

    let missing = missing_rows
        .into_iter()
        .map(|row| {
            Ok(PendingGrant {
                collection_id: row.try_get("id").map_err(|_| ApiError::Internal)?,
                kind: row.try_get("family_wide_kind").map_err(|_| ApiError::Internal)?,
                access_level: row.try_get("family_wide_access_level").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    let resealable_rows = sqlx::query(
        "SELECT c.id AS collection_id, fm.user_id AS recipient_user_id \
           FROM collections c JOIN family_members fm ON fm.family_id = c.family_id \
          WHERE c.family_id = ? AND c.family_wide_kind IS NOT NULL AND fm.status = 'active' \
            AND EXISTS (SELECT 1 FROM collection_keys ck \
                        WHERE ck.collection_id = c.id AND ck.recipient_user_id = ?) \
            AND NOT EXISTS (SELECT 1 FROM collection_keys ck2 \
                             WHERE ck2.collection_id = c.id AND ck2.recipient_user_id = fm.user_id)",
    )
    .bind(&membership.family_id)
    .bind(&membership.caller_user_id)
    .fetch_all(&state.db)
    .await?;

    let resealable = resealable_rows
        .into_iter()
        .map(|row| {
            Ok(ResealableGrant {
                collection_id: row.try_get("collection_id").map_err(|_| ApiError::Internal)?,
                recipient_user_id: row.try_get("recipient_user_id").map_err(|_| ApiError::Internal)?,
            })
        })
        .collect::<Result<Vec<_>, ApiError>>()?;

    Ok(Json(FamilyWidePendingResponse { missing, resealable }))
}

// --- Phase 25 (FAM-08/FAM-09/KEY-02/KEY-06/KEY-07): atomic member removal + re-key ---

/// One recipient's freshly-`seal()`ed `CollectionKey`, client-side, for a
/// collection the target is being removed from. Opaque to this server.
#[derive(Deserialize)]
pub struct NewSealedKeyEntry {
    pub recipient_user_id: String,
    pub sealed_key: String,
}

/// One item's freshly-rewrapped `enc_key` (via `pv-core`'s
/// `rewrap_item_key_for_collection`, Plan 25-02) — `enc_data` is
/// deliberately NOT part of this shape; SC 6/KEY-02's rewrap-only guarantee
/// means this endpoint has no field capable of carrying a payload change.
#[derive(Deserialize)]
pub struct ItemRewrapEntry {
    pub item_id: String,
    pub enc_key: String,
}

/// One collection's full re-key batch: the target's removal from it, every
/// REMAINING recipient's newly-sealed key, and every item's rewrapped key.
#[derive(Deserialize)]
pub struct CollectionRekeyBatch {
    pub collection_id: String,
    pub new_sealed_keys: Vec<NewSealedKeyEntry>,
    pub item_rewraps: Vec<ItemRewrapEntry>,
}

/// The client-precomputed removal batch — one entry per collection the
/// target could reach. An empty `Vec` is the valid, expected shape for a
/// target with zero collection access (KEY-02/KEY-06's empty-edge case).
#[derive(Deserialize)]
pub struct RemoveMemberRequest {
    pub collections: Vec<CollectionRekeyBatch>,
}

// Fault-injection hook for Plan 25-05's atomicity proof: set to
// `Some(i)` before calling `remove_member`/`apply_member_removal_rekey` to
// force an `ApiError::Internal` immediately after collection index `i`'s
// writes complete, proving the surrounding `BEGIN IMMEDIATE` transaction
// rolls back everything, not just the failing collection.
//
// `pub`, not `pub(crate)`: `tests/*.rs` is a SEPARATE compiled crate that
// cannot see `pub(crate)` items (mirrors `family_routes()`/
// `membership_routes()`'s own documented `pub`-not-`pub(crate)` rationale in
// `routes/mod.rs`). Gated behind `#[cfg(feature = "test-support")]`,
// deliberately NOT `#[cfg(test)]` — see this crate's `Cargo.toml`
// `[features]` doc comment for the full empirically-verified rationale (a
// `#[cfg(test)]` item in this crate's lib target is invisible to a separate
// `tests/*.rs` integration-test binary; `test-support` is visible to it via
// the self-referential `[dev-dependencies]` entry).
//
// WR-02 (code review, Phase 25) — the absence claim, stated precisely.
// The old wording ("absent from a production `cargo build`") was too broad.
// Verified reproduction:
//
//     $ cargo build -p pv-server --bin pv-server
//     $ nm target/debug/pv-server | grep -c FAULT_INJECT   # -> 0
//     $ cargo build -p pv-server --all-targets
//     $ nm target/debug/pv-server | grep -c FAULT_INJECT   # -> 4
//
// `--all-targets` pulls in the dev-dependency graph, which contains the
// self-referential `pv-server = { path = ".", features = ["test-support"] }`
// entry, so under workspace `resolver = "2"` the lib is feature-unified WITH
// `test-support` and the `bin` target is relinked against it. The true
// statement is therefore: the hook is absent unless dev-dependencies are in
// the build graph.
//
// The SHIPPED artifact is unaffected — `Dockerfile:85` runs
// `cargo build -p pv-server --release` in a clean container, with no
// `--all-targets` and no prior test step — and that guarantee is now
// MECHANICAL rather than documentary, via the release-profile
// `compile_error!` below. Even when linked in, the hook is a thread-local
// defaulting to `None` that no route can set, so it is not remotely
// triggerable.
//
// This hook exists SOLELY because no real SQL-level constraint in this
// schema can be triggered mid-batch: a sequential per-row `UPDATE` can never
// violate a PK (making a duplicate-key fault unreachable), and SQLite's
// multi-row `INSERT ... ON CONFLICT DO UPDATE` is last-write-wins across
// duplicate rows within one statement (verified empirically against the
// real pinned SQLite 3.51.0 — no "affected twice" constraint error the way
// PostgreSQL has), so it would silently coalesce a malformed duplicate
// instead of surfacing it. Both alternatives were tried and rejected during
// this phase's planning — see 25-03-PLAN.md's own note on this task.
//
// NOTE: this comment block deliberately uses `//`, not `///` — rustdoc does
// not generate documentation for a macro invocation (`thread_local!`
// itself), so a doc comment immediately above one is flagged by clippy as
// dead documentation (`unused_doc_comments`).
// WR-02: turns "the release image never carries the fault-injection hook"
// from a claim in a comment into a compile-time invariant. A release profile
// with `test-support` somehow enabled — the only way the hook could reach the
// shipped binary — now fails the build loudly instead of silently linking it.
// `debug_assertions` is the profile discriminator: on for `dev`/`test`, off
// for `release` (this workspace does not override it).
//
// Known, accepted cost: `cargo test -p pv-server --release` will not compile.
// Nothing in CI or the Dockerfile does that (`cargo test --workspace` runs on
// the dev profile; the image runs `cargo build -p pv-server --release`), and
// failing loudly there is the correct trade for a mechanical guarantee at the
// boundary that actually ships.
#[cfg(all(feature = "test-support", not(debug_assertions)))]
compile_error!(
    "the `test-support` feature (which compiles in FAULT_INJECT_AFTER_COLLECTION_INDEX) must never \
     be enabled in a release build. If you are running `cargo test --release`, drop `--release` — \
     the atomicity proof runs on the dev profile."
);

#[cfg(feature = "test-support")]
thread_local! {
    pub static FAULT_INJECT_AFTER_COLLECTION_INDEX: std::cell::Cell<Option<usize>> = const { std::cell::Cell::new(None) };
}

/// The ONE place the removal transaction's write sequence lives (KEY-07's
/// `key_links` requirement) — `remove_member`'s own HTTP handler below and
/// Plan 25-06's plain-member self-deletion (`target=self`) both call this
/// instead of duplicating the sequence. Takes an ALREADY-OPEN `tx` reference
/// (never opens or commits its own transaction) so both callers control
/// their own transaction lifecycle around it.
///
/// Order, per collection entry `i`: (0) re-verify IN-TRANSACTION that the
/// target still holds a `family_members` row in `family_id` (WR-03's TOCTOU
/// fix — see below); (1) verify the submitted collection SET matches the
/// target's ACTUAL `collection_keys` rows exactly (KEY-06's
/// scope guard — any mismatch, missing or extra, is a hard 409, never a
/// silent partial re-key); (2) per collection, verify the submitted item-id
/// set matches that collection's ACTUAL current `vault_items` exactly, and
/// the submitted remaining-recipient set matches that collection's ACTUAL
/// remaining `collection_keys` recipients (excluding target) exactly
/// (KEY-07's race guard against a fetch-then-request TOCTOU window); (3)
/// only after EVERY entry passes BOTH checks, apply the writes — plain
/// sequential per-row `UPDATE`/`DELETE` statements, deliberately never a
/// bulk multi-row `INSERT ... ON CONFLICT DO UPDATE` (see
/// `FAULT_INJECT_AFTER_COLLECTION_INDEX`'s own doc comment above for why
/// that shape was rejected); (4) sever EVERY `item_shares` row the target
/// held, on ANY item, not scoped to `batch`'s collections (KEY-02's
/// adjacency fix); (5) delete the target's `family_members` row, scoped to
/// `family_id`; (6) bump the target's own `vault_revision` (WR-07's fix,
/// applied to this new path); (7) bump every touched collection's own
/// `revision`.
///
/// WR-03 (code review, Phase 25). Two related gaps this signature closes:
///
/// 1. **TOCTOU.** `remove_member`'s confused-deputy check used to run on a
///    SEPARATE pool connection before `BEGIN IMMEDIATE`, and this helper
///    explicitly "trusted the handler passed a target already confirmed to be
///    in the caller's own family" — true only as of that pre-transaction read.
///    The check now lives HERE, on the transaction's own connection, so
///    authorization and the writes it authorizes are the same atomic unit.
///    One enforcement point, and `delete_account_as_member` inherits it too.
///
/// 2. **Blast radius.** Step 5 was `DELETE FROM family_members WHERE user_id = ?`
///    with no `family_id` predicate, and step 1 resolved the target's
///    collections by `recipient_user_id` alone. Both are correct ONLY because
///    v0.4 enforces a singleton family — nothing in the compiler or the schema
///    says so. Taking `family_id` explicitly makes every write scoped, so
///    relaxing the singleton assumption later cannot silently turn this into a
///    cross-family delete.
pub(crate) async fn apply_member_removal_rekey(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    family_id: &str,
    target_user_id: &str,
    batch: &[CollectionRekeyBatch],
) -> Result<Vec<String>, ApiError> {
    use std::collections::HashSet;

    // Step 0 (WR-03): the target must still hold a `family_members` row in
    // THIS family, re-read on the transaction's own connection. A target
    // removed by a concurrent request between the handler's own dispatch and
    // this point is a 404, not a partially-applied second removal.
    let still_a_member = sqlx::query("SELECT 1 FROM family_members WHERE family_id = ? AND user_id = ?")
        .bind(family_id)
        .bind(target_user_id)
        .fetch_optional(&mut **tx)
        .await?;
    if still_a_member.is_none() {
        return Err(ApiError::NotFound);
    }

    // Step 1 (KEY-06): the submitted collection SET must exactly match the
    // target's ACTUAL reachable collections, resolved fresh inside this tx.
    // Scoped to `family_id` (WR-03) so a grant in a DIFFERENT family is
    // neither required in the batch nor silently re-keyed by this removal —
    // and so this set stays byte-identical to the one `member_access` (the
    // endpoint the client built `batch` from) resolves, which is what keeps
    // the KEY-06 guard from 409-ing on a scope disagreement.
    let actual_collection_rows = sqlx::query(
        "SELECT ck.collection_id FROM collection_keys ck \
           JOIN collections c ON c.id = ck.collection_id \
          WHERE ck.recipient_user_id = ? AND c.family_id = ?",
    )
    .bind(target_user_id)
    .bind(family_id)
    .fetch_all(&mut **tx)
    .await?;
    let actual_collections: HashSet<String> = actual_collection_rows
        .into_iter()
        .map(|row| row.try_get("collection_id").map_err(|_| ApiError::Internal))
        .collect::<Result<HashSet<_>, ApiError>>()?;
    let submitted_collections: HashSet<String> = batch.iter().map(|b| b.collection_id.clone()).collect();
    if actual_collections != submitted_collections {
        return Err(ApiError::Conflict(
            "submitted collection set does not match target's current access".into(),
        ));
    }

    // Step 2 (KEY-07's race guard): per collection, the submitted item-id set
    // and remaining-recipient set must each exactly match this collection's
    // ACTUAL current state, resolved fresh inside this SAME tx.
    for entry in batch {
        let item_rows = sqlx::query("SELECT id FROM vault_items WHERE collection_id = ?")
            .bind(&entry.collection_id)
            .fetch_all(&mut **tx)
            .await?;
        let actual_items: HashSet<String> = item_rows
            .into_iter()
            .map(|row| row.try_get("id").map_err(|_| ApiError::Internal))
            .collect::<Result<HashSet<_>, ApiError>>()?;
        let submitted_items: HashSet<String> = entry.item_rewraps.iter().map(|i| i.item_id.clone()).collect();
        if actual_items != submitted_items {
            return Err(ApiError::Conflict(
                "submitted item set does not match this collection's current items".into(),
            ));
        }

        let recipient_rows = sqlx::query(
            "SELECT recipient_user_id FROM collection_keys WHERE collection_id = ? AND recipient_user_id != ?",
        )
        .bind(&entry.collection_id)
        .bind(target_user_id)
        .fetch_all(&mut **tx)
        .await?;
        let actual_recipients: HashSet<String> = recipient_rows
            .into_iter()
            .map(|row| row.try_get("recipient_user_id").map_err(|_| ApiError::Internal))
            .collect::<Result<HashSet<_>, ApiError>>()?;
        let submitted_recipients: HashSet<String> =
            entry.new_sealed_keys.iter().map(|k| k.recipient_user_id.clone()).collect();
        if actual_recipients != submitted_recipients {
            return Err(ApiError::Conflict(
                "submitted remaining-recipient set does not match this collection's current recipients".into(),
            ));
        }
    }

    // Step 3: only after EVERY entry passed both checks above, apply writes.
    // Plain sequential per-row UPDATE/DELETE — see this function's own doc
    // comment for why a bulk multi-row UPSERT was rejected. No `.await`
    // inside a loop holding an open row cursor — each statement is its own
    // prepared-and-executed call.
    // `i` is read only by the `#[cfg(feature = "test-support")]` block at
    // the end of this loop body — a plain `cargo build` (no test-support)
    // never reads it, hence the cfg-conditional `allow`.
    #[cfg_attr(not(feature = "test-support"), allow(unused_variables))]
    for (i, entry) in batch.iter().enumerate() {
        sqlx::query("DELETE FROM collection_keys WHERE collection_id = ? AND recipient_user_id = ?")
            .bind(&entry.collection_id)
            .bind(target_user_id)
            .execute(&mut **tx)
            .await?;

        for new_key in &entry.new_sealed_keys {
            sqlx::query(
                "UPDATE collection_keys SET sealed_key = ? WHERE collection_id = ? AND recipient_user_id = ?",
            )
            .bind(&new_key.sealed_key)
            .bind(&entry.collection_id)
            .bind(&new_key.recipient_user_id)
            .execute(&mut **tx)
            .await?;
        }

        for rewrap in &entry.item_rewraps {
            // `collection_id` clause is a defensive scope pin — never trust
            // `item_id` alone.
            sqlx::query("UPDATE vault_items SET enc_key = ? WHERE id = ? AND collection_id = ?")
                .bind(&rewrap.enc_key)
                .bind(&rewrap.item_id)
                .bind(&entry.collection_id)
                .execute(&mut **tx)
                .await?;
        }

        // Immediately after finishing collection index `i`'s writes, before
        // moving to `i + 1` — see FAULT_INJECT_AFTER_COLLECTION_INDEX's own
        // doc comment above.
        #[cfg(feature = "test-support")]
        if FAULT_INJECT_AFTER_COLLECTION_INDEX.with(|f| f.get()) == Some(i) {
            return Err(ApiError::Internal);
        }
    }

    // Step 4 (KEY-02 adjacency fix): sever EVERY direct share the target
    // held, on ANY item (personal or collection-scoped, any owner) — not
    // scoped to `batch`'s collections. A member removed from the family
    // loses every access path, not just their collection memberships.
    sqlx::query("DELETE FROM item_shares WHERE recipient_user_id = ?")
        .bind(target_user_id)
        .execute(&mut **tx)
        .await?;

    // Step 5 (WR-03): scoped to `family_id`, not `user_id` alone. The
    // unscoped form was a latent cross-family delete kept correct only by
    // v0.4's singleton-family assumption, which nothing enforces.
    sqlx::query("DELETE FROM family_members WHERE family_id = ? AND user_id = ?")
        .bind(family_id)
        .bind(target_user_id)
        .execute(&mut **tx)
        .await?;

    // Step 6 (WR-07 fix, applied to this new path): bumps the TARGET's own
    // vault_revision — their own next GET /api/sync detects the change and
    // locally prunes what they can no longer decrypt.
    sqlx::query("UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ?")
        .bind(target_user_id)
        .execute(&mut **tx)
        .await?;

    // Step 6b (WR-04, code review Phase 25): `vault_revision` is the WRONG
    // counter for the shares step 4 just severed. `GET /api/sync/shared/direct`
    // and the `direct` bucket of `GET /api/sync/shared` are both keyed off
    // `users.shared_direct_revision` (sync.rs), so without this bump the
    // removed member's client polls `?since=<unchanged>`, gets the cheap
    // `UpToDate` shape, and keeps every directly-shared item in its local
    // cache indefinitely. `vault::revoke_share` already gets this right; this
    // new path did not.
    sqlx::query("UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?")
        .bind(target_user_id)
        .execute(&mut **tx)
        .await?;

    // Step 7: every remaining recipient's own sealed_key changed and every
    // rewrapped item's enc_key changed — bump each touched collection's own
    // revision so a remaining member's cache knows to re-fetch (consuming
    // this signal client-side is Plan 25-07/25-08's job).
    for entry in batch {
        bump_collection_revision(&mut *tx, &entry.collection_id).await?;
    }

    // Step 8: the list of touched collection_ids, for the caller to fan out
    // events over after commit.
    Ok(batch.iter().map(|b| b.collection_id.clone()).collect())
}

/// `DELETE /api/families/members/{user_id}` — owner-only
/// (`FamilyMembership<RequireEdit>`). Atomically removes `target_user_id`
/// from the family and re-keys every collection they could reach, per
/// `apply_member_removal_rekey`'s own doc comment above.
pub async fn remove_member(
    State(state): State<AppState>,
    membership: FamilyMembership<RequireEdit>,
    axum::extract::Path(target_user_id): axum::extract::Path<String>,
    Json(req): Json<RemoveMemberRequest>,
) -> Result<StatusCode, ApiError> {
    if target_user_id == membership.caller_user_id {
        return Err(ApiError::BadRequest(
            "cannot remove yourself — use account deletion to leave the family".into(),
        ));
    }

    // WR-03 (code review, Phase 25): the confused-deputy guard (T-25-06) used
    // to run HERE, on a separate pool connection, before the transaction
    // opened. It now lives inside `apply_member_removal_rekey` as its step 0,
    // on the transaction's own connection — so the membership fact the writes
    // depend on cannot change between being checked and being acted on, and
    // `delete_account_as_member` (the helper's other caller) inherits the same
    // guard instead of relying on its own separate pre-read.

    // BEGIN IMMEDIATE: this handler's first statements (inside
    // apply_member_removal_rekey) are reads, and only the later writes
    // mutate — mirrors vault::delete's identical WR-04 rationale for
    // acquiring the write lock up front rather than risking
    // SQLITE_BUSY_SNAPSHOT under a deferred BEGIN.
    let mut tx = state.db.begin_with("BEGIN IMMEDIATE").await?;

    let touched_collections =
        apply_member_removal_rekey(&mut tx, &membership.family_id, &target_user_id, &req.collections).await?;

    tx.commit().await?;

    // Fan out AFTER commit, over a FRESH pool-bound connection (not the
    // consumed `tx`) — recipients resolved fresh now naturally EXCLUDE
    // target_user_id (their collection_keys row is gone), mirroring
    // collections::revoke_access's identical "never notify a removed member
    // of their own removal through the very channel being cut" discipline.
    let mut conn = state.db.acquire().await?;
    for collection_id in &touched_collections {
        let recipients = resolve_collection_members(&mut conn, collection_id).await?;
        let current_revision: i64 = sqlx::query_scalar("SELECT revision FROM collections WHERE id = ?")
            .bind(collection_id)
            .fetch_one(&mut *conn)
            .await?;
        state.sync_hub.publish_to_recipients(
            &recipients,
            SyncEvent {
                entity_type: EntityType::Collection,
                id: collection_id.clone(),
                revision: current_revision,
                change_type: ChangeType::Update,
            },
        );
    }

    Ok(StatusCode::NO_CONTENT)
}

// --- Phase 25 Plan 04 (FAM-07/FAM-09): reversible suspend/reinstate — the
// cheap, re-key-free counterpart to remove_member above. Neither handler
// ever touches collection_keys or vault_items; flipping family_members.status
// alone is the entire mechanism, since Collection::resolve_access and both
// branches of Item::resolve_access (crates/pv-server/src/routes/membership.rs,
// Plan 25-01) already gate every RECIPIENT-side join on `fm.status = 'active'`.

/// `POST /api/families/members/{user_id}/suspend` — owner-only
/// (`FamilyMembership<RequireEdit>`). Sets `family_members.status =
/// 'suspended'` via a single guarded `UPDATE` bound to the CALLER's own
/// resolved `family_id` (never a client-supplied one) — no
/// `collection_keys`/`vault_items` statement anywhere in this handler, which
/// is FAM-07's whole point: suspension performs zero re-key writes.
/// Idempotent — a repeat call against an already-suspended target still
/// returns `204`, not an error, mirroring `insert_family_member`'s own
/// conflict-is-not-an-error posture.
pub async fn suspend_member(
    State(state): State<AppState>,
    membership: FamilyMembership<RequireEdit>,
    axum::extract::Path(target_user_id): axum::extract::Path<String>,
) -> Result<StatusCode, ApiError> {
    // Server-side guard, not merely a hidden UI affordance — an owner cannot
    // suspend themselves (T-25-11's DoS/self-lockout mitigation).
    if target_user_id == membership.caller_user_id {
        return Err(ApiError::BadRequest("cannot suspend yourself".into()));
    }

    // Confused-deputy guard (T-25-10), folded into the UPDATE's own WHERE
    // clause rather than a separate SELECT: a target with no family_members
    // row in the CALLER's own resolved family_id affects zero rows, which
    // the `rows_affected() == 0` check below maps to 404 — mirrors
    // remove_member's separate pre-check but as a single guarded statement,
    // matching this handler's own single-UPDATE simplicity (FAM-07).
    let result = sqlx::query("UPDATE family_members SET status = 'suspended' WHERE family_id = ? AND user_id = ?")
        .bind(&membership.family_id)
        .bind(&target_user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    // B-8 fix (Phase 28 Plan 03): suspension's COLLECTIONS half already
    // self-heals via the existing active_collection_member_join!() filter —
    // but the DIRECT-share bucket (`GET /api/sync/shared`'s `direct` field /
    // `pull_shared_direct`) is keyed off `users.shared_direct_revision`
    // alone, and nothing here has ever moved that counter. Bump it, mirroring
    // the three existing call sites that already do this for the identical
    // reason (vault.rs::create_share/revoke_share,
    // apply_member_removal_rekey step 6b above) — a cheap-check signal, never
    // a re-key: no `collection_keys`/`vault_items` statement anywhere in this
    // handler, preserving FAM-07's "no re-key" invariant by construction.
    sqlx::query("UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?")
        .bind(&target_user_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

/// `POST /api/families/members/{user_id}/reinstate` — owner-only twin of
/// `suspend_member` above. Sets `family_members.status = 'active'` via the
/// identical single-guarded-`UPDATE` shape — restores access with the SAME
/// `collection_keys.sealed_key`/`vault_items.enc_key` bytes the member held
/// before suspension, since neither table is ever touched by either handler.
pub async fn reinstate_member(
    State(state): State<AppState>,
    membership: FamilyMembership<RequireEdit>,
    axum::extract::Path(target_user_id): axum::extract::Path<String>,
) -> Result<StatusCode, ApiError> {
    if target_user_id == membership.caller_user_id {
        return Err(ApiError::BadRequest("cannot reinstate yourself".into()));
    }

    let result = sqlx::query("UPDATE family_members SET status = 'active' WHERE family_id = ? AND user_id = ?")
        .bind(&membership.family_id)
        .bind(&target_user_id)
        .execute(&state.db)
        .await?;

    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }

    // B-8 fix, symmetric to suspend_member above (Pitfall 3: BOTH directions
    // need their own bump). Without this, a client's watermark already
    // matches the post-suspend counter value and never re-fetches to
    // discover the direct share is visible again on reinstate.
    sqlx::query("UPDATE users SET shared_direct_revision = shared_direct_revision + 1 WHERE id = ?")
        .bind(&target_user_id)
        .execute(&state.db)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}
