//! `Membership<R, M>` / `FamilyMembership<M>` — the ONLY boundary between an
//! authenticated request and a shared family/collection/item resource (patrz
//! SEC-06/SHARE-05; closes the CVE-2026-43639 class of bug — Bitwarden's
//! asymmetric GET-checks-membership-but-POST-doesn't defect on a sibling
//! product). A handler that does not declare one of these two extractors in
//! its signature cannot compile against a shared resource at all; there is no
//! per-handler `if caller_is_member(...)` anywhere in this codebase, and
//! there must never be one.
//!
//! Two extractors, not one, because family membership (v0.4: a strict
//! singleton, CONTEXT.md's locked FAM-01 decision) has no `{id}` path
//! segment to read, while `Collection`/`Item` resources do:
//! - `Membership<R, M>` — path-`{id}`-based, generic over a `ResourceKind`
//!   (`Collection`/`Item`, added by Task 2 of this plan) and a `MinAccess`
//!   floor (`RequireRead`/`RequireEdit`).
//! - `FamilyMembership<M>` — pathless, resolves the caller's OWN family role
//!   directly (there is exactly one family in v0.4 — the singleton IS the
//!   resource).
//!
//! Both funnel their resolved `Option<AccessLevel>` through the SAME shared
//! `gate::<M>()` fn below, so the 404-vs-403 status-code discipline
//! (no-access -> 404, never leaks existence; insufficient-level -> 403,
//! caller provably has SOME access) provably lives in exactly one place, not
//! duplicated across the two extractor bodies.
//!
//! Every `resolve_access`/`resolve_family_role` call below runs a fresh query
//! against `state.db` on EVERY request — no `AppState`, session, or token
//! field ever stores a resolved `AccessLevel`. This is the property SHARE-06
//! (Plan 22-03) and Phase 25's FAM-09 (revoke-takes-effect-immediately) both
//! depend on; caching it anywhere, even as a "performance optimization",
//! would silently break both.

use std::{collections::HashMap, marker::PhantomData};

use axum::extract::{FromRequestParts, Path};
use axum::http::request::Parts;
use sqlx::Row;

use super::session::SessionUser;
use crate::{error::ApiError, AppState};

/// Deliberately does NOT derive `Ord`/`PartialOrd`. A derived `Ord` would
/// make `HiddenPassword` compare as strictly "between" `Read` and `Edit` for
/// every purpose — which is exactly wrong for SHARE-04's gate: a
/// `hidden_password` holder must be REJECTED from reassigning an item to
/// another collection (Vaultwarden #6269's exact bug class), not treated as
/// "good enough, it's more than Read." `RequireEdit::satisfied_by`'s explicit
/// `== AccessLevel::Edit` match is the only place "does this level suffice
/// for edit" is decided — never a transitive `<`/`>` comparison a future
/// refactor might accidentally introduce by deriving `Ord` here.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccessLevel {
    Read,
    HiddenPassword,
    Edit,
}

impl AccessLevel {
    /// The exact inverse of `parse_access_level` — the sole place an
    /// `AccessLevel` is rendered back to its wire-vocabulary string, reused
    /// by every handler that needs to echo the caller's own resolved level
    /// back in a response (`collections::get`, Plan 22-03) rather than
    /// hand-rolling a second string mapping.
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            AccessLevel::Read => "read",
            AccessLevel::Edit => "edit",
            AccessLevel::HiddenPassword => "hidden_password",
        }
    }
}

/// Type-level minimum-access floor a `Membership<R, M>`/`FamilyMembership<M>`
/// extraction must clear. Making this a second type parameter (not a runtime
/// check inside the handler body) means a handler that only declares
/// `Membership<Collection, RequireRead>` literally cannot reach the body of a
/// mutation that needs `RequireEdit` — the rejection happens in
/// `from_request_parts`, before the handler's own code runs.
pub trait MinAccess {
    fn satisfied_by(level: AccessLevel) -> bool;
}

/// Any resolved access row at all is sufficient — the "some access exists"
/// floor used by read/list endpoints.
pub struct RequireRead;
impl MinAccess for RequireRead {
    fn satisfied_by(_level: AccessLevel) -> bool {
        true
    }
}

/// Exact match against `AccessLevel::Edit` — structurally excludes
/// `HiddenPassword` (the SHARE-04 mechanism). Never derive this from an
/// ordering; the exclusion must be explicit.
pub struct RequireEdit;
impl MinAccess for RequireEdit {
    fn satisfied_by(level: AccessLevel) -> bool {
        level == AccessLevel::Edit
    }
}

/// The sole trusted decoder for the `CHECK`-constrained `access_level`
/// string column (`collection_keys`/`item_shares`). Explicit non-wildcard
/// `_ => Err` else-arm: an unrecognized DB value (should be unreachable given
/// the `CHECK` constraint, but this is defense in depth) fails closed to
/// `ApiError::Internal`, never silently treated as a valid access grant.
pub(crate) fn parse_access_level(s: &str) -> Result<AccessLevel, ApiError> {
    match s {
        "read" => Ok(AccessLevel::Read),
        "edit" => Ok(AccessLevel::Edit),
        "hidden_password" => Ok(AccessLevel::HiddenPassword),
        _ => Err(ApiError::Internal),
    }
}

/// Thin `BadRequest`-mapping wrapper around `parse_access_level`, for the
/// CALLER-FACING request-validation path (e.g. `collections::add_member`'s
/// `access_level` field) — keeps the DB-decode path's `ApiError::Internal`
/// semantics (an unrecognized DB value should be unreachable given the
/// `CHECK` constraint; a bug if it happens) distinct from the
/// request-validation path's `ApiError::BadRequest` (a malformed client
/// value; not a bug, a rejected request), both funneling through the one
/// canonical string-match in `parse_access_level` above.
pub(crate) fn parse_access_level_from_request(s: &str) -> Result<AccessLevel, ApiError> {
    parse_access_level(s).map_err(|_| ApiError::BadRequest("invalid access_level".into()))
}

/// Ranks `Read=0, HiddenPassword=1, Edit=2` ONLY for picking the better of
/// two independent grants (e.g. a caller with both collection-level access
/// AND a direct item-level share on the same item — `Item::resolve_access`'s
/// dual-path case, Task 2). This rank is NOT `Ord` and must never be used for
/// a `MinAccess` decision — `RequireEdit::satisfied_by`'s exact-match stays
/// the only place "does this level suffice for edit" is decided.
pub(crate) fn combine_access(a: Option<AccessLevel>, b: Option<AccessLevel>) -> Option<AccessLevel> {
    fn rank(level: AccessLevel) -> u8 {
        match level {
            AccessLevel::Read => 0,
            AccessLevel::HiddenPassword => 1,
            AccessLevel::Edit => 2,
        }
    }
    match (a, b) {
        (None, None) => None,
        (Some(x), None) => Some(x),
        (None, Some(y)) => Some(y),
        (Some(x), Some(y)) => Some(if rank(x) >= rank(y) { x } else { y }),
    }
}

/// One `resolve_access` impl per resource kind — the only place the
/// per-kind SQL differs; the query-and-decide logic (`gate::<M>()`) is
/// written exactly once and shared. `Collection`/`Item` marker structs and
/// their impls land in Task 2 of this plan.
pub trait ResourceKind {
    /// Fresh DB query, never cached — see this module's doc comment.
    ///
    /// Explicit `-> impl Future<...> + Send` (not a native `async fn` in the
    /// trait) — axum's `FromRequestParts::from_request_parts` requires its
    /// returned future to be `Send` (it's polled from a multi-threaded tokio
    /// runtime), and a plain `async fn` in a trait does not propagate a
    /// `Send` bound on its own; `Membership<R, M>::from_request_parts`
    /// `.await`s this directly, so the bound must be explicit here.
    fn resolve_access(
        db: &sqlx::SqlitePool,
        caller_user_id: &str,
        resource_id: &str,
    ) -> impl std::future::Future<Output = Result<Option<AccessLevel>, ApiError>> + Send;
}

/// A shared collection — access resolved from a single `collection_keys` row
/// for `(collection_id, caller)`.
pub struct Collection;

impl ResourceKind for Collection {
    async fn resolve_access(
        db: &sqlx::SqlitePool,
        caller_user_id: &str,
        resource_id: &str,
    ) -> Result<Option<AccessLevel>, ApiError> {
        // WR-07: join `family_members` into resolution so a `collection_keys`
        // row for a caller who is no longer a member of the collection's
        // owning family can never resolve to access — grant-time membership
        // (`collections::add_member`) alone is not sufficient once a removal
        // path exists (Phase 25). Not exploitable today (no removal endpoint
        // exists yet, so every `collection_keys` row's recipient is
        // necessarily still a member), but this is the phase that fixes the
        // resolution rule, and Phase 25 inherits it as-is.
        let row = sqlx::query(
            "SELECT ck.access_level FROM collection_keys ck \
               JOIN collections c ON c.id = ck.collection_id \
               JOIN family_members fm ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id \
              WHERE ck.collection_id = ? AND ck.recipient_user_id = ?",
        )
        .bind(resource_id)
        .bind(caller_user_id)
        .fetch_optional(db)
        .await?;

        match row {
            None => Ok(None),
            Some(row) => {
                let access_level: String = row.try_get("access_level").map_err(|_| ApiError::Internal)?;
                Ok(Some(parse_access_level(&access_level)?))
            }
        }
    }
}

/// A vault item — dual-mode (22-RESEARCH.md Pattern 2): a personal item
/// (`collection_id IS NULL`) preserves today's EXACT `user_id == caller`
/// rule, expressed as an access level instead of a query filter, COMBINED
/// (CR-01) with any direct `item_shares` grant — SHARE-02's whole point is
/// that a personal item can be shared independently of any collection, so
/// `item_shares` must be consulted on this branch too, not only when
/// `collection_id IS NOT NULL`; a collection-scoped item resolves the MAX of
/// THREE independent grants — the creator's own ownership (WR-05: never lost,
/// even after a co-editor moves the item into a collection the creator holds
/// no `collection_keys` row for), collection-level membership, and a direct
/// per-item override share — via `combine_access`, never just one or the
/// other.
pub struct Item;

impl ResourceKind for Item {
    async fn resolve_access(
        db: &sqlx::SqlitePool,
        caller_user_id: &str,
        resource_id: &str,
    ) -> Result<Option<AccessLevel>, ApiError> {
        let item_row = sqlx::query("SELECT user_id, collection_id FROM vault_items WHERE id = ?")
            .bind(resource_id)
            .fetch_optional(db)
            .await?;

        let Some(item_row) = item_row else { return Ok(None) };
        let owner_user_id: String = item_row.try_get("user_id").map_err(|_| ApiError::Internal)?;
        let collection_id: Option<String> = item_row.try_get("collection_id").map_err(|_| ApiError::Internal)?;

        // CR-01: `item_shares` is now consulted on EVERY item, before the
        // personal/collection branch split — the old code queried it only
        // inside the collection-scoped branch, so a direct per-item share
        // against a PERSONAL item (`collection_id IS NULL`) — the exact case
        // `vault::create_share`'s own doc comment advertises — was silently
        // ignored: the row was inserted, `201`-accepted, and granted nothing.
        let item_share_row = sqlx::query("SELECT access_level FROM item_shares WHERE item_id = ? AND recipient_user_id = ?")
            .bind(resource_id)
            .bind(caller_user_id)
            .fetch_optional(db)
            .await?;
        let item_share_access = match item_share_row {
            None => None,
            Some(row) => {
                let access_level: String = row.try_get("access_level").map_err(|_| ApiError::Internal)?;
                Some(parse_access_level(&access_level)?)
            }
        };

        // The creator's own ownership grant — independent of collection
        // membership (WR-05). Computed once, folded into whichever branch
        // below applies.
        let owner_access = (owner_user_id == caller_user_id).then_some(AccessLevel::Edit);

        let Some(collection_id) = collection_id else {
            // Personal item: owner keeps Edit (byte-for-byte the pre-existing
            // `WHERE id=? AND user_id=?` rule from vault.rs, expressed as an
            // access level); a direct item_shares grant is the second,
            // independent grant `combine_access` takes the max of — this is
            // the CR-01 fix: this branch used to `return` here BEFORE the
            // item_shares query above ever ran.
            return Ok(combine_access(owner_access, item_share_access));
        };

        // WR-07: join `family_members` so a `collection_keys` row for a
        // caller no longer in the collection's owning family cannot resolve
        // to access (see `Collection::resolve_access`'s identical join for
        // the full rationale — not exploitable today, no removal endpoint
        // exists yet, but this is the phase that fixes the resolution rule).
        let collection_row = sqlx::query(
            "SELECT ck.access_level FROM collection_keys ck \
               JOIN collections c ON c.id = ck.collection_id \
               JOIN family_members fm ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id \
              WHERE ck.collection_id = ? AND ck.recipient_user_id = ?",
        )
        .bind(&collection_id)
        .bind(caller_user_id)
        .fetch_optional(db)
        .await?;
        let collection_access = match collection_row {
            None => None,
            Some(row) => {
                let access_level: String = row.try_get("access_level").map_err(|_| ApiError::Internal)?;
                Some(parse_access_level(&access_level)?)
            }
        };

        // WR-05: fold the creator's own ownership grant in here too — a
        // cross-collection move never revokes `collection_keys` from the
        // MOVER, but it can absolutely leave the ORIGINAL CREATOR without a
        // `collection_keys` row on the destination collection. Without this,
        // the creator 404s on their own item (PUT/DELETE/touch) while
        // `fetch_items_for`'s `WHERE user_id = ?` still lists it — an
        // undecryptable entry the owning client can never remove. Folding
        // `owner_access` in here makes `Item::resolve_access` and
        // `fetch_items_for` agree on who "owns" a collection-scoped item.
        Ok(combine_access(combine_access(owner_access, collection_access), item_share_access))
    }
}

/// Shared 404-vs-403 mapping, called by BOTH `Membership<R, M>` and
/// `FamilyMembership<M>` — this is the ONE place the status-code discipline
/// lives (W1 / CONTEXT.md locked rule): `None` (no row at all) never
/// confirms the resource/family exists (`ApiError::NotFound`); `Some(level)`
/// failing `M::satisfied_by` means the caller provably has SOME access, just
/// not enough (`ApiError::Forbidden`); `Some(level)` passing returns the
/// resolved level.
fn gate<M: MinAccess>(access: Option<AccessLevel>) -> Result<AccessLevel, ApiError> {
    match access {
        None => Err(ApiError::NotFound),
        Some(level) if !M::satisfied_by(level) => Err(ApiError::Forbidden),
        Some(level) => Ok(level),
    }
}

/// Path-`{id}`-based membership extractor for `Collection`/`Item` resources
/// (Task 2 adds their `ResourceKind` impls; Plans 22-03/22-04 wire them into
/// routes via `membership_routes()`).
pub struct Membership<R, M = RequireRead> {
    pub resource_id: String,
    pub caller_user_id: String,
    pub access: AccessLevel,
    _kind: PhantomData<(R, M)>,
}

impl<R, M> FromRequestParts<AppState> for Membership<R, M>
where
    R: ResourceKind,
    M: MinAccess,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let session = SessionUser::from_request_parts(parts, state).await?;

        // `Path::<HashMap<String, String>>`, NOT `Path::<String>` —
        // 22-RESEARCH.md's own Pattern 1 sketch used `Path<String>`, but
        // verified against the pinned axum-0.8.9 source, deserializing
        // `Path<String>` against a route with more than ONE `{...}` capture
        // fails with `ErrorKind::WrongNumberOfParameters`. Several
        // `Membership`-gated routes this phase registers DO have a second
        // `{user_id}` capture alongside `{id}`
        // (`/api/vault/collections/{id}/access/{user_id}`,
        // `/api/vault/items/{id}/shares/{user_id}`, built in Plans
        // 22-03/22-04) — the HashMap form accepts any number of captures
        // uniformly.
        //
        // This read is non-consuming (`parts.extensions.get::<UrlParams>()`,
        // verified against axum-0.8.9's `Path<T>::from_request_parts` body,
        // `src/extract/path/mod.rs:157-187` — `.get()`, never `.remove()`),
        // so a handler declaring its own `Path<(String, String)>` afterward
        // continues to work unaffected by this extractor having already read
        // the same `UrlParams` extension first.
        let Path(params) = Path::<HashMap<String, String>>::from_request_parts(parts, state)
            .await
            .map_err(|e| {
                tracing::error!(?e, "membership extractor: route has no path params at all");
                ApiError::Internal
            })?;

        // Every `Membership<R, M>`-gated route in `membership_routes()` uses
        // `{id}` as the primary resource segment, never a different name — a
        // route registered with no `{id}` segment at all is a `mod.rs`
        // authoring bug, not a caller-triggerable case, so a missing "id" key
        // maps to `ApiError::Internal`, not a 4xx.
        let resource_id = params.get("id").cloned().ok_or_else(|| {
            tracing::error!("membership extractor: route has no {{id}} path param — mod.rs authoring bug");
            ApiError::Internal
        })?;

        let resolved = R::resolve_access(&state.db, &session.user_id, &resource_id).await?;
        let access = gate::<M>(resolved)?;

        Ok(Membership { resource_id, caller_user_id: session.user_id, access, _kind: PhantomData })
    }
}

/// Explicit, reusable SECOND authorization check for a body-supplied
/// DESTINATION resource id, called from inside a handler body rather than a
/// second `FromRequestParts` extraction — `Membership<R, M>`'s extractor only
/// reads a request's own path `{id}`, so it cannot be re-invoked a second
/// time against an unrelated id carried in the JSON body (`move_item`'s
/// `new_collection_id`, 22-04-PLAN.md's Pattern 3). Wraps
/// `Collection::resolve_access` + the SAME `gate::<RequireEdit>()` this
/// module's extractors use, so the destination-collection check is provably
/// identical in 404-vs-403 behavior to every other `Membership`-gated route —
/// just invoked from a different call site (`vault::move_item`, closing
/// T-22-18: an edit-capable member of the SOURCE collection must not be able
/// to push an item into a DESTINATION collection they hold a lesser grant
/// on).
pub(crate) async fn require_collection_edit(
    db: &sqlx::SqlitePool,
    caller_user_id: &str,
    collection_id: &str,
) -> Result<(), ApiError> {
    let resolved = Collection::resolve_access(db, caller_user_id, collection_id).await?;
    gate::<RequireEdit>(resolved)?;
    Ok(())
}

/// Pathless sibling of `Membership<R, M>` for the singleton `families`
/// resource (v0.4 has exactly one family — CONTEXT.md's locked FAM-01
/// decision — so there is no `{id}` segment to read at all).
pub struct FamilyMembership<M = RequireRead> {
    pub family_id: String,
    pub caller_user_id: String,
    pub role: AccessLevel,
    _kind: PhantomData<M>,
}

impl<M> FromRequestParts<AppState> for FamilyMembership<M>
where
    M: MinAccess,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let session = SessionUser::from_request_parts(parts, state).await?;

        let resolved = resolve_family_role(&state.db, &session.user_id).await?;

        // Route the resolved AccessLevel half through the SAME shared
        // gate::<M>() fn Membership<R, M> uses above, so the 404-vs-403
        // discipline is proven to live in exactly one place, not
        // reimplemented per extractor.
        let role = gate::<M>(resolved.as_ref().map(|(_, role)| *role))?;

        // Safe: gate() returning Ok proves `resolved` was `Some` (a `None`
        // input always maps to `Err(ApiError::NotFound)` above), so this
        // unwrap can never panic on a real request.
        let family_id = resolved.expect("gate::<M> returned Ok, so resolved must be Some").0;

        Ok(FamilyMembership { family_id, caller_user_id: session.user_id, role, _kind: PhantomData })
    }
}

/// The only place family-role resolution lives (mirrors `session.rs`'s own
/// "exactly one place this logic lives" discipline for `validate_token`).
/// Maps the flat two-role model onto `AccessLevel` via the SAME `MinAccess`
/// trait `Membership<R, M>` uses, rather than inventing a parallel role type:
/// `role='owner' -> AccessLevel::Edit` (so `FamilyMembership<RequireEdit>`
/// gates "owner only"), `role='member' -> AccessLevel::Read` (so
/// `FamilyMembership<RequireRead>` gates "any member"). This mapping is a
/// discretionary design choice, not a locked CONTEXT.md decision.
pub(crate) async fn resolve_family_role(
    db: &sqlx::SqlitePool,
    caller_user_id: &str,
) -> Result<Option<(String, AccessLevel)>, ApiError> {
    let row = sqlx::query("SELECT family_id, role FROM family_members WHERE user_id = ?")
        .bind(caller_user_id)
        .fetch_optional(db)
        .await?;

    let Some(row) = row else { return Ok(None) };
    let family_id: String = row.try_get("family_id").map_err(|_| ApiError::Internal)?;
    let role: String = row.try_get("role").map_err(|_| ApiError::Internal)?;
    let access = match role.as_str() {
        "owner" => AccessLevel::Edit,
        "member" => AccessLevel::Read,
        _ => return Err(ApiError::Internal),
    };
    Ok(Some((family_id, access)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Migrates a fresh in-memory pool, mirroring `tests/common/mod.rs::test_pool` —
    /// duplicated (not imported) because this is a `src/`-internal unit test
    /// and cannot reach the `tests/common` module.
    async fn seeded_pool() -> sqlx::SqlitePool {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("connect in-memory sqlite pool");
        sqlx::migrate!("./migrations").run(&pool).await.expect("run migrations");
        pool
    }

    async fn seed_user(pool: &sqlx::SqlitePool, id: &str, email: &str) {
        sqlx::query(
            "INSERT INTO users (id, email, kdf_params, kdf_salt, pw_wrapped_uk, auth_hash, auth_hash_salt) \
             VALUES (?, ?, '{}', X'00', '{}', X'00', X'00')",
        )
        .bind(id)
        .bind(email)
        .execute(pool)
        .await
        .expect("seed user");
    }

    async fn seed_family_and_collection(pool: &sqlx::SqlitePool, owner_id: &str) -> String {
        sqlx::query("INSERT INTO families (id, owner_user_id, name) VALUES ('fam1', ?, 'Test Family')")
            .bind(owner_id)
            .execute(pool)
            .await
            .expect("seed family");
        // WR-07: `Collection`/`Item::resolve_access` now join `family_members`
        // into resolution, matching the real-world invariant that every
        // `collection_keys` recipient was a family member at grant time
        // (`collections::add_member`'s confused-deputy guard). This unit-test
        // fixture bypasses the real endpoints via raw SQL, so it must seed
        // the same invariant explicitly rather than relying on a handler to
        // have enforced it.
        sqlx::query("INSERT INTO family_members (family_id, user_id, role) VALUES ('fam1', ?, 'owner')")
            .bind(owner_id)
            .execute(pool)
            .await
            .expect("seed owner's family_members row");
        sqlx::query("INSERT INTO collections (id, family_id, enc_name) VALUES ('coll1', 'fam1', 'enc')")
            .execute(pool)
            .await
            .expect("seed collection");
        "coll1".to_string()
    }

    /// Adds `user_id` to `fam1` (seeded by `seed_family_and_collection` above)
    /// as a plain `member` — for tests that need a SECOND family member with
    /// a `collection_keys`/`item_shares` row (WR-07's join requires it).
    async fn seed_family_member(pool: &sqlx::SqlitePool, user_id: &str) {
        sqlx::query("INSERT INTO family_members (family_id, user_id, role) VALUES ('fam1', ?, 'member')")
            .bind(user_id)
            .execute(pool)
            .await
            .expect("seed additional family_members row");
    }

    #[tokio::test]
    async fn collection_resolve_access_returns_seeded_level_and_none_otherwise() {
        let pool = seeded_pool().await;
        seed_user(&pool, "owner", "owner@example.com").await;
        seed_user(&pool, "stranger", "stranger@example.com").await;
        let collection_id = seed_family_and_collection(&pool, "owner").await;

        sqlx::query(
            "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
             VALUES (?, 'owner', 'sealed', 'edit')",
        )
        .bind(&collection_id)
        .execute(&pool)
        .await
        .expect("seed collection_keys");

        let access = Collection::resolve_access(&pool, "owner", &collection_id).await.unwrap();
        assert_eq!(access, Some(AccessLevel::Edit));

        let no_access = Collection::resolve_access(&pool, "stranger", &collection_id).await.unwrap();
        assert_eq!(no_access, None);
    }

    #[tokio::test]
    async fn item_resolve_access_personal_branch_preserves_ownership_rule() {
        let pool = seeded_pool().await;
        seed_user(&pool, "a", "a@example.com").await;
        seed_user(&pool, "b", "b@example.com").await;

        sqlx::query("INSERT INTO vault_items (id, user_id, enc_key, enc_data) VALUES ('item1', 'a', 'k', 'd')")
            .execute(&pool)
            .await
            .expect("seed personal item");

        let owner_access = Item::resolve_access(&pool, "a", "item1").await.unwrap();
        assert_eq!(owner_access, Some(AccessLevel::Edit));

        let other_access = Item::resolve_access(&pool, "b", "item1").await.unwrap();
        assert_eq!(other_access, None);
    }

    #[tokio::test]
    async fn item_resolve_access_collection_branch_returns_max_of_both_grants() {
        let pool = seeded_pool().await;
        seed_user(&pool, "owner", "owner@example.com").await;
        seed_user(&pool, "c", "c@example.com").await;
        let collection_id = seed_family_and_collection(&pool, "owner").await;
        seed_family_member(&pool, "c").await;

        sqlx::query(
            "INSERT INTO vault_items (id, user_id, enc_key, enc_data, collection_id) \
             VALUES ('item2', 'owner', 'k', 'd', ?)",
        )
        .bind(&collection_id)
        .execute(&pool)
        .await
        .expect("seed collection item");

        sqlx::query(
            "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
             VALUES (?, 'c', 'sealed', 'read')",
        )
        .bind(&collection_id)
        .execute(&pool)
        .await
        .expect("seed collection_keys read grant");

        sqlx::query(
            "INSERT INTO item_shares (item_id, recipient_user_id, sealed_key, access_level) \
             VALUES ('item2', 'c', 'sealed', 'edit')",
        )
        .execute(&pool)
        .await
        .expect("seed item_shares edit grant");

        let access = Item::resolve_access(&pool, "c", "item2").await.unwrap();
        assert_eq!(access, Some(AccessLevel::Edit), "MAX of collection read + item-share edit must be Edit");
    }

    /// CR-01 regression: a direct `item_shares` grant on a PERSONAL item
    /// (`collection_id IS NULL`) must confer real access — the bug this
    /// commit fixes is `Item::resolve_access` early-returning on the personal
    /// branch BEFORE the `item_shares` query ever ran, silently making every
    /// such grant a no-op.
    #[tokio::test]
    async fn item_resolve_access_personal_branch_honors_item_shares_grant() {
        let pool = seeded_pool().await;
        seed_user(&pool, "owner2", "owner2@example.com").await;
        seed_user(&pool, "recipient", "recipient@example.com").await;

        sqlx::query("INSERT INTO vault_items (id, user_id, enc_key, enc_data) VALUES ('item3', 'owner2', 'k', 'd')")
            .execute(&pool)
            .await
            .expect("seed personal item");

        // Before any share exists, the recipient has no access at all.
        let no_access = Item::resolve_access(&pool, "recipient", "item3").await.unwrap();
        assert_eq!(no_access, None);

        sqlx::query(
            "INSERT INTO item_shares (item_id, recipient_user_id, sealed_key, access_level) \
             VALUES ('item3', 'recipient', 'sealed', 'edit')",
        )
        .execute(&pool)
        .await
        .expect("seed item_shares grant on a PERSONAL item");

        let access = Item::resolve_access(&pool, "recipient", "item3").await.unwrap();
        assert_eq!(
            access,
            Some(AccessLevel::Edit),
            "CR-01: a direct item_shares grant on a personal item must confer real access"
        );

        // The owner's own access is untouched by the recipient's grant.
        let owner_access = Item::resolve_access(&pool, "owner2", "item3").await.unwrap();
        assert_eq!(owner_access, Some(AccessLevel::Edit));
    }

    /// WR-05 regression: the creator of a collection-scoped item must never
    /// lose access to their own row, even if they hold no `collection_keys`
    /// row for its CURRENT collection (the exact state a co-editor's
    /// cross-collection `move_item` call can leave them in).
    #[tokio::test]
    async fn item_resolve_access_collection_branch_creator_never_loses_own_item() {
        let pool = seeded_pool().await;
        seed_user(&pool, "creator", "creator@example.com").await;
        seed_user(&pool, "editor", "editor@example.com").await;
        let collection_id = seed_family_and_collection(&pool, "editor").await;
        seed_family_member(&pool, "creator").await;

        // "creator" made this item but holds NO collection_keys row for the
        // collection it now lives in — simulating the aftermath of another
        // editor moving it there.
        sqlx::query(
            "INSERT INTO vault_items (id, user_id, enc_key, enc_data, collection_id) \
             VALUES ('item5', 'creator', 'k', 'd', ?)",
        )
        .bind(&collection_id)
        .execute(&pool)
        .await
        .expect("seed collection item with no collection_keys row for its creator");

        let access = Item::resolve_access(&pool, "creator", "item5").await.unwrap();
        assert_eq!(
            access,
            Some(AccessLevel::Edit),
            "WR-05: the creator must retain Edit on their own item even without a collection_keys row"
        );
    }

    #[test]
    fn parse_access_level_rejects_unrecognized_strings() {
        assert!(matches!(parse_access_level("bogus"), Err(ApiError::Internal)));
        assert_eq!(parse_access_level("read").unwrap(), AccessLevel::Read);
        assert_eq!(parse_access_level("edit").unwrap(), AccessLevel::Edit);
        assert_eq!(parse_access_level("hidden_password").unwrap(), AccessLevel::HiddenPassword);
    }
}
