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

/// The ONE definition of the recurring "this `collection_keys` recipient is
/// still an ACTIVE member of the collection's owning family" join fragment.
///
/// WR-05 (code review, Phase 25): Phase 25 added `fm.status = 'active'` to the
/// two `resolve_access` implementations only, while four other queries carried
/// a byte-similar `family_members` join and were left ungated — so the phase's
/// own FAM-09 claim ("the status predicate is the SOLE enforcement mechanism")
/// was true of the authorization layer but not of the read layer. A single
/// macro means a fifth copy cannot drift: every call site expands to the exact
/// same SQL text.
///
/// Requires the surrounding query to alias `collections` as `c` and
/// `collection_keys` as `ck` — every current call site already did.
///
/// The predicate lives in the `ON` clause rather than the `WHERE` clause; for
/// an INNER JOIN the two are provably equivalent, and putting it here is what
/// lets the whole fragment be one reusable literal.
macro_rules! active_collection_member_join {
    () => {
        "JOIN family_members fm ON fm.family_id = c.family_id \
             AND fm.user_id = ck.recipient_user_id \
             AND fm.status = 'active' "
    };
}
pub(crate) use active_collection_member_join;

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
        //
        // FAM-09 (25-01-PLAN.md Task 1): the status-active-only predicate
        // added to the `fm` join below is the SOLE enforcement mechanism a
        // suspended member's access depends on — this same fresh-per-request
        // query, run on every request, never cached. Plan 25-04 builds the
        // handler that flips this column; this join is what makes flipping
        // it take effect immediately.
        let row = sqlx::query(concat!(
            "SELECT ck.access_level FROM collection_keys ck \
               JOIN collections c ON c.id = ck.collection_id ",
            active_collection_member_join!(),
            "WHERE ck.collection_id = ? AND ck.recipient_user_id = ?",
        ))
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
/// (CR-01, iteration 1) with any direct `item_shares` grant — SHARE-02's
/// whole point is that a personal item can be shared independently of any
/// collection, so `item_shares` must be consulted on this branch too, not
/// only when `collection_id IS NOT NULL`. A collection-scoped item resolves
/// the MAX of exactly TWO independent grants — collection-level membership
/// and a direct per-item override share — via `combine_access`. The
/// creator's own ownership confers NOTHING once an item is collection-scoped
/// (CR-01, iteration 2 — this is deliberate and load-bearing: the
/// iteration-1 fold of an unconditional creator `Edit` into this branch was
/// withdrawn because "creator has no `collection_keys` row" and "member was
/// revoked" are the same DB predicate, so the fold could not tell a creator
/// apart from a just-revoked member and defeated SC#4's revocation
/// guarantee for any item they had created). If a co-editor moves an item
/// into a collection its creator holds no grant on, the creator correctly
/// loses access to it — `fetch_items_for` must not list a row the creator
/// cannot resolve access to (Phase 23/list-layer concern, tracked, not an
/// authorization relaxation).
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
        //
        // W2 (iteration 2): CR-01 widened this query to run on EVERY item —
        // which means an unjoined `item_shares` row is now a MORE exposed
        // surface than before the fix, not less (pre-CR-01 it only ran for
        // collection-scoped items). Join through the item OWNER's family —
        // pinned to `owner_user_id` (this resource's own `vault_items.user_id`,
        // never a client-controlled value) — and require the recipient
        // (pinned to `caller_user_id` via the WHERE clause, matching every
        // other resolver query in this module) to still hold a
        // `family_members` row in that SAME family. A stale `item_shares`
        // row for a recipient no longer in the owner's family can no longer
        // resolve to access, mirroring `Collection::resolve_access`'s
        // identical `family_members` join (WR-07, iteration 1). Not
        // exploitable today (no family-removal endpoint exists yet — Phase
        // 25 owns it), but this is the phase that fixes the resolution
        // rule, and Phase 25 inherits it as-is.
        //
        // FAM-09 (25-01-PLAN.md Task 1): the RECIPIENT-side `fm` join below
        // gains a status-active-only predicate — `fm_o` (the item OWNER's
        // own row) is deliberately untouched, matching
        // `Collection::resolve_access`'s identical mechanism. A suspended
        // recipient's item_shares grant must resolve to no access on this
        // SAME fresh-per-request query.
        let item_share_row = sqlx::query(
            "SELECT s.access_level FROM item_shares s \
               JOIN family_members fm_o ON fm_o.user_id = ? \
               JOIN family_members fm ON fm.family_id = fm_o.family_id AND fm.user_id = s.recipient_user_id \
              WHERE s.item_id = ? AND s.recipient_user_id = ? AND fm.status = 'active'",
        )
        .bind(&owner_user_id)
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

        // The creator's own ownership grant — used ONLY by the personal-item
        // branch below (`collection_id IS NULL`). Deliberately NOT folded
        // into the collection branch (CR-01, iteration 2) — see this
        // struct's doc comment above for why an unconditional ownership
        // grant on a collection-scoped item defeats revocation.
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
        //
        // FAM-09 (25-01-PLAN.md Task 1): the status-active-only predicate
        // added to the `fm` join below is the same enforcement mechanism as
        // `Collection::resolve_access`'s join above; a suspended recipient's
        // collection_keys grant must resolve to no access here too.
        let collection_row = sqlx::query(concat!(
            "SELECT ck.access_level FROM collection_keys ck \
               JOIN collections c ON c.id = ck.collection_id ",
            active_collection_member_join!(),
            "WHERE ck.collection_id = ? AND ck.recipient_user_id = ?",
        ))
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

        // CR-01 (iteration 2): do NOT fold `owner_access` in here.
        // "the creator has no `collection_keys` row" and "a revoked member
        // has no `collection_keys` row" are the SAME predicate against this
        // DB state — folding ownership in unconditionally makes revocation
        // meaningless for any item the revoked member happened to create,
        // defeating SC#4 ("revocation enforced on the very next request")
        // and the SHARE-04 / Vaultwarden #6269 hidden-password reassignment
        // gate for any item the caller created. In a collection, access
        // comes from the `collection_keys` row (plus any direct item share)
        // and nothing else. The iteration-1 WR-05 fold that used to live
        // here is withdrawn; WR-05's actual symptom (a creator's moved item
        // still appearing, undecryptable, in their own personal list) is a
        // LISTING concern for `fetch_items_for`, not an authorization one,
        // and must not be solved by widening authorization here.
        Ok(combine_access(collection_access, item_share_access))
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

/// Whether `caller_level` (what the caller ACTUALLY, server-resolved, holds
/// on a collection) authorizes them to hand `requested_level` to a THIRD
/// PARTY via an automatic propagation path (invite-time-wrap, 30-DECISION-
/// FSH-02.md) — as opposed to `require_collection_edit`'s deliberate-share
/// use case above. Deliberately explicit per (caller, requested) pair, never
/// a transitive `Ord`-derived comparison — `AccessLevel`'s own doc comment:
/// a derived `Ord` would make `HiddenPassword` compare as strictly "between"
/// `Read` and `Edit`, which is wrong for this decision too, so every
/// combination is spelled out rather than computed from a rank.
///
/// Rules: a caller may always propagate EXACTLY the level they themselves
/// hold (never MORE — the caller's own resolved level is always the ceiling
/// for what they can hand someone else); a full `Edit` holder may
/// additionally choose to narrow a propagated grant down to `Read` —
/// deliberate, test-proven behavior
/// (`invitation_accept_grants_single_collection_and_two_family_wide_collections_atomically`,
/// `crates/pv-server/tests/invitations.rs`): an edit-holding caller submits
/// `"read"` for one family-wide entry and `"edit"` for another in the SAME
/// request, and both are honored exactly as submitted. Every other
/// combination would hand the invitee MORE than the caller actually holds,
/// and is denied.
///
/// `pub(crate)`, not private (CR-03, 30-REVIEW.md): also called directly by
/// `collections::add_member`'s reseal-bound path, the family-wide analogue
/// of `require_collection_access_for_propagation` below for the lazy-reseal
/// mechanism — a `read`-holding current member must be able to reseal a
/// `read`-declared family-wide share to a newcomer even though `add_member`
/// was historically `RequireEdit`-only (WINDOWS #17).
///
/// B1 (30-VERIFICATION.md): `ee928a3` (the very commit that added this
/// gate's `RequireEdit`-only-on-ordinary-collections carve-out, CR-01/CR-03)
/// reintroduced `d07c2a7`'s exact bug shape one access level over — the
/// original hole was a missing `(Edit, Read)` case for a family-wide share
/// declared at `read`; this one was a missing `(Edit, HiddenPassword)` case
/// for a share declared at `hidden_password`. Because `collections::create`
/// hard-codes the CREATOR's own `collection_keys` row to `'edit'` regardless
/// of the level the share itself declares (see that fn's own comment — the
/// creator is always a full editor of their own creation, matching this
/// module's established `read` precedent), the creator is EVERY family-wide
/// share's first propagator: the initial fan-out to current members, every
/// later invite (`generateInviteLink` folds in every family-wide collection
/// the caller holds a key for, at ITS OWN declared level), and the creator's
/// own lazy reseal all route through this exact `(Edit, requested_level)`
/// pair. Every combination is spelled out below — per this fn's own
/// discipline, never derived from a rank — so a future reader sees coverage
/// of all nine `(caller, requested)` pairs rather than having to infer it:
///
/// | caller \ requested | Read | HiddenPassword | Edit |
/// |---------------------|------|-----------------|------|
/// | Read                | ✓ exact match | ✗ escalation (different axis, not "more") | ✗ escalation |
/// | HiddenPassword       | ✗ different axis, not "less" | ✓ exact match | ✗ escalation |
/// | Edit                 | ✓ narrow (existing, test-proven) | ✓ narrow (B1 fix) | ✓ exact match |
///
/// `Read` and `HiddenPassword` are deliberately NOT mutually propagable in
/// either direction — `AccessLevel`'s own doc comment: a `hidden_password`
/// holder is a restricted grant along a different axis (can use, cannot
/// reveal) than `read`, not "more" or "less" than it, so a `Read` holder
/// gains nothing by being allowed to hand out `HiddenPassword`, and a
/// `HiddenPassword` holder gains nothing by being allowed to hand out
/// `Read` — both would only ever be reached by a hand-built request, never
/// by any real client path (every real propagator resends the share's own
/// declared level, and the ceiling stays exactly what `AccessLevel`'s
/// non-`Ord` design already refuses to compare).
pub(crate) fn may_grant_access_level(caller_level: AccessLevel, requested_level: AccessLevel) -> bool {
    match (caller_level, requested_level) {
        (AccessLevel::Read, AccessLevel::Read) => true,
        (AccessLevel::Read, AccessLevel::HiddenPassword) => false,
        (AccessLevel::Read, AccessLevel::Edit) => false,

        (AccessLevel::HiddenPassword, AccessLevel::Read) => false,
        (AccessLevel::HiddenPassword, AccessLevel::HiddenPassword) => true,
        (AccessLevel::HiddenPassword, AccessLevel::Edit) => false,

        (AccessLevel::Edit, AccessLevel::Read) => true,
        // B1 fix: the missing arm. An edit-holding caller (always true of a
        // family-wide share's own creator) may propagate the
        // `hidden_password` level their own share declared — never more
        // than they hold (they hold Edit, the ceiling), and this is the
        // SAME "narrow a propagated grant down" shape the pre-existing
        // (Edit, Read) arm above already established as deliberate,
        // test-proven behavior.
        (AccessLevel::Edit, AccessLevel::HiddenPassword) => true,
        (AccessLevel::Edit, AccessLevel::Edit) => true,
    }
}

/// The additive invite-time-wrap counterpart to `require_collection_edit`
/// above (root-caused live, `.planning/debug/family-wide-c-relock-fail.md`):
/// unlike the single EXPLICIT collection-scope on an invite (a deliberate
/// "share this collection" action, correctly gated at `RequireEdit`,
/// mirroring `collections::add_member`'s own `RequireEdit`-only gate), the
/// invite-time-wrap fast path (30-DECISION-FSH-02.md) is an AUTOMATIC,
/// additive fold-in of every family-wide collection the caller currently
/// holds ANY key for — propagating the caller's OWN existing access forward
/// to a new invitee, never granting anything beyond it. Requiring `Edit`
/// here (the pre-fix behavior) was wrong: it meant a caller who merely holds
/// `read` on even ONE family-wide collection could never generate ANY
/// invite again — not just one scoped to that collection — since the
/// client folds in every family-wide grant the caller holds into every
/// single invite it creates, unconditionally
/// (`web/src/lib/invite/crypto.ts::generateInviteLink`).
///
/// Gates on `RequireRead` (the caller must genuinely hold SOME grant —
/// proof of real membership on that collection, not an outsider forging a
/// collection id — same `None -> NotFound` semantics `require_collection_edit`
/// already has) and then bounds the REQUESTED level via `may_grant_access_level`
/// above, so an invitee can never receive more access than the inviter
/// propagating it actually holds — `Some(caller_level)` that fails the bound
/// is `ApiError::Forbidden`, mirroring `gate::<M>()`'s own "provably has SOME
/// access, just not enough" rule.
pub(crate) async fn require_collection_access_for_propagation(
    db: &sqlx::SqlitePool,
    caller_user_id: &str,
    collection_id: &str,
    requested_level: AccessLevel,
) -> Result<(), ApiError> {
    let resolved = Collection::resolve_access(db, caller_user_id, collection_id).await?;
    match resolved {
        None => Err(ApiError::NotFound),
        Some(caller_level) if may_grant_access_level(caller_level, requested_level) => Ok(()),
        Some(_) => Err(ApiError::Forbidden),
    }
}

/// Whether `collection_id` is a family-wide collection (`family_wide_kind IS
/// NOT NULL`) — the ONE predicate that scopes BOTH of this module's
/// propagation-relaxation gates to the automatic family-wide fold-in they
/// were each designed for, never to an ordinary (deliberately, explicitly
/// shared) collection a hand-built request could otherwise smuggle through
/// the relaxed bound (CR-02, 30-REVIEW.md). Used by `invitations::create`'s
/// `family_wide_keys` loop (invite-time-wrap propagation) and
/// `collections::add_member` (lazy-reseal propagation, CR-03's fix for
/// WINDOWS #17) — one definition, so the two call sites can never drift on
/// what "family-wide" means.
pub(crate) async fn is_family_wide_collection(db: &sqlx::SqlitePool, collection_id: &str) -> Result<bool, ApiError> {
    Ok(
        sqlx::query("SELECT 1 FROM collections WHERE id = ? AND family_wide_kind IS NOT NULL")
            .bind(collection_id)
            .fetch_optional(db)
            .await?
            .is_some(),
    )
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
    Ok(resolve_family_membership(db, caller_user_id).await?.map(|(family_id, access, _status)| (family_id, access)))
}

/// `family_members.status`, decoded. WR-06 (code review, Phase 25):
/// `resolve_family_role` above carried NO status predicate at all, so a
/// suspended member satisfied `FamilyMembership<M>` for every route in
/// `family_routes()` — including `POST /api/vault/collections`, letting them
/// create a folder inside the family they are suspended from (and then
/// immediately 404 on reading it, since `Collection::resolve_access` denies
/// them).
///
/// A blanket status gate inside `resolve_family_role` is NOT the fix: reading
/// the roster is what powers the suspended-member banner (25-UI-SPEC.md's E5),
/// so a suspended member must keep passing `FamilyMembership<RequireRead>` for
/// `GET /api/families` / `GET /api/families/members`. The split is
/// `ActiveFamilyMembership<M>` below instead — reads keep the permissive
/// extractor, writes take the status-gated one.
///
/// Non-wildcard else-arm, mirroring `parse_access_level`'s discipline: an
/// unrecognized DB value (unreachable given migration 0018's `CHECK`
/// constraint) fails closed to `ApiError::Internal`, never silently treated as
/// active.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MemberStatus {
    Active,
    Suspended,
}

pub(crate) fn parse_member_status(s: &str) -> Result<MemberStatus, ApiError> {
    match s {
        "active" => Ok(MemberStatus::Active),
        "suspended" => Ok(MemberStatus::Suspended),
        _ => Err(ApiError::Internal),
    }
}

/// The status-carrying resolution `resolve_family_role` above delegates to —
/// one query, two callers, so the role mapping and the status decode can never
/// drift apart.
pub(crate) async fn resolve_family_membership(
    db: &sqlx::SqlitePool,
    caller_user_id: &str,
) -> Result<Option<(String, AccessLevel, MemberStatus)>, ApiError> {
    let row = sqlx::query("SELECT family_id, role, status FROM family_members WHERE user_id = ?")
        .bind(caller_user_id)
        .fetch_optional(db)
        .await?;

    let Some(row) = row else { return Ok(None) };
    let family_id: String = row.try_get("family_id").map_err(|_| ApiError::Internal)?;
    let role: String = row.try_get("role").map_err(|_| ApiError::Internal)?;
    let status: String = row.try_get("status").map_err(|_| ApiError::Internal)?;
    let access = match role.as_str() {
        "owner" => AccessLevel::Edit,
        "member" => AccessLevel::Read,
        _ => return Err(ApiError::Internal),
    };
    Ok(Some((family_id, access, parse_member_status(&status)?)))
}

/// `FamilyMembership<M>` plus a hard `status = 'active'` requirement (WR-06).
/// The ONE extractor every family/collection-MUTATING route must declare, so
/// "a suspended member cannot write" is a property of the handler's own
/// signature rather than a per-handler `if` — this module's doc comment
/// forbids the latter, and for good reason.
///
/// Rejection shape: a suspended caller provably HAS family membership (the
/// family's existence is not a secret from them — they can still read the
/// roster), so this is `403 Forbidden`, never `404`. That is the same
/// insufficient-level-vs-no-access distinction `gate::<M>()` already draws.
pub struct ActiveFamilyMembership<M = RequireRead> {
    pub family_id: String,
    pub caller_user_id: String,
    pub role: AccessLevel,
    _kind: PhantomData<M>,
}

impl<M> FromRequestParts<AppState> for ActiveFamilyMembership<M>
where
    M: MinAccess,
{
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let session = SessionUser::from_request_parts(parts, state).await?;

        let resolved = resolve_family_membership(&state.db, &session.user_id).await?;

        // Same shared gate::<M>() the two sibling extractors use — the
        // 404-vs-403 discipline still lives in exactly one place.
        let role = gate::<M>(resolved.as_ref().map(|(_, role, _)| *role))?;

        // Safe: gate() returning Ok proves `resolved` was `Some`.
        let (family_id, _, status) = resolved.expect("gate::<M> returned Ok, so resolved must be Some");

        if status != MemberStatus::Active {
            return Err(ApiError::Forbidden);
        }

        Ok(ActiveFamilyMembership { family_id, caller_user_id: session.user_id, role, _kind: PhantomData })
    }
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

    /// Sibling of `seed_family_member` above, for Phase 25's suspension
    /// tests — takes an explicit `status` (`'active'`/`'suspended'`) rather
    /// than relying on the column's `DEFAULT 'active'`, so a test asserting
    /// suspended-member behavior states its fixture's status explicitly
    /// rather than depending on a migration default a future schema change
    /// could alter.
    async fn seed_family_member_with_status(pool: &sqlx::SqlitePool, user_id: &str, status: &str) {
        sqlx::query("INSERT INTO family_members (family_id, user_id, role, status) VALUES ('fam1', ?, 'member', ?)")
            .bind(user_id)
            .bind(status)
            .execute(pool)
            .await
            .expect("seed additional family_members row with explicit status");
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
        // W2 (iteration 2): the `item_shares` resolver query now joins
        // `family_members` (through the item OWNER's family) — a real
        // per-item share is always created between two family members, so
        // this fixture must seed that invariant explicitly, same as
        // `seed_family_and_collection` does for the collection-branch tests.
        sqlx::query("INSERT INTO families (id, owner_user_id, name) VALUES ('fam2', 'owner2', 'Test Family 2')")
            .execute(&pool)
            .await
            .expect("seed family");
        sqlx::query("INSERT INTO family_members (family_id, user_id, role) VALUES ('fam2', 'owner2', 'owner')")
            .execute(&pool)
            .await
            .expect("seed owner2's family_members row");
        sqlx::query("INSERT INTO family_members (family_id, user_id, role) VALUES ('fam2', 'recipient', 'member')")
            .execute(&pool)
            .await
            .expect("seed recipient's family_members row");

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

    /// W2 (iteration 2) regression: a stale `item_shares` row for a
    /// recipient no longer in the item owner's family must NOT confer
    /// access — the same `family_members` join `Collection::resolve_access`
    /// already applies (WR-07, iteration 1), now also applied to the
    /// `item_shares` query CR-01 widened to run on every item, not just
    /// collection-scoped ones. `"outsider"` never receives a
    /// `family_members` row for the item owner's family at all, which is
    /// the strongest form of "no longer in the family" this fixture can
    /// express without a member-removal endpoint (Phase 25).
    #[tokio::test]
    async fn item_resolve_access_item_shares_rejects_recipient_outside_owners_family() {
        let pool = seeded_pool().await;
        seed_user(&pool, "owner3", "owner3@example.com").await;
        seed_user(&pool, "outsider", "outsider@example.com").await;
        sqlx::query("INSERT INTO families (id, owner_user_id, name) VALUES ('fam3', 'owner3', 'Test Family 3')")
            .execute(&pool)
            .await
            .expect("seed family");
        sqlx::query("INSERT INTO family_members (family_id, user_id, role) VALUES ('fam3', 'owner3', 'owner')")
            .execute(&pool)
            .await
            .expect("seed owner3's family_members row");
        // Deliberately NO family_members row for "outsider" — they are not,
        // and never were (in this fixture), a member of owner3's family.

        sqlx::query("INSERT INTO vault_items (id, user_id, enc_key, enc_data) VALUES ('item4', 'owner3', 'k', 'd')")
            .execute(&pool)
            .await
            .expect("seed personal item");

        sqlx::query(
            "INSERT INTO item_shares (item_id, recipient_user_id, sealed_key, access_level) \
             VALUES ('item4', 'outsider', 'sealed', 'edit')",
        )
        .execute(&pool)
        .await
        .expect("seed a stale item_shares row for a non-family-member recipient");

        let access = Item::resolve_access(&pool, "outsider", "item4").await.unwrap();
        assert_eq!(
            access, None,
            "W2: an item_shares row for a recipient outside the item owner's family must confer NO access"
        );
    }

    /// CR-01 (iteration 2) regression: the creator of a collection-scoped
    /// item must NOT retain access purely by having created it once no
    /// `collection_keys` row names them — this is the exact DB state a
    /// revoked member is left in, and the two cases are indistinguishable
    /// from inside `resolve_access`. This test supersedes iteration 1's
    /// `item_resolve_access_collection_branch_creator_never_loses_own_item`,
    /// which asserted the OPPOSITE (`Some(Edit)`) — that assertion encoded
    /// the very bug this iteration withdraws. See the two adversarial
    /// `Membership<Item, ...>`-level integration tests in
    /// `tests/collections.rs` for the end-to-end version of this same
    /// property (revoked creator gets 404 on PUT/DELETE/move_item, and a
    /// hidden_password creator cannot reassign their own item).
    #[tokio::test]
    async fn item_resolve_access_collection_branch_creator_with_no_grant_has_no_access() {
        let pool = seeded_pool().await;
        seed_user(&pool, "creator", "creator@example.com").await;
        seed_user(&pool, "editor", "editor@example.com").await;
        let collection_id = seed_family_and_collection(&pool, "editor").await;
        seed_family_member(&pool, "creator").await;

        // "creator" made this item but holds NO collection_keys row for the
        // collection it now lives in — the same state left behind either by
        // a co-editor moving the item there, or by revoking the creator's
        // own access to a collection they created an item in.
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
            access, None,
            "CR-01 (iteration 2): a creator with no collection_keys row must resolve to NO access — \
             folding ownership into the collection branch makes revocation indistinguishable from \
             the stranded-creator case and defeats SC#4"
        );
    }

    /// FAM-09 (Task 1, 25-01-PLAN.md): a caller holding a valid
    /// `collection_keys` row whose `family_members.status` is `'suspended'`
    /// must resolve to NO access — the status-active-only predicate added
    /// to `Collection::resolve_access`'s `family_members` join is the ONLY
    /// mechanism this depends on, exercised here directly against the same
    /// fresh-per-request query every other authorization decision in this
    /// codebase uses.
    #[tokio::test]
    async fn collection_resolve_access_returns_none_for_suspended_member() {
        let pool = seeded_pool().await;
        seed_user(&pool, "owner", "owner@example.com").await;
        seed_user(&pool, "suspended", "suspended@example.com").await;
        let collection_id = seed_family_and_collection(&pool, "owner").await;
        seed_family_member_with_status(&pool, "suspended", "suspended").await;

        sqlx::query(
            "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
             VALUES (?, 'suspended', 'sealed', 'edit')",
        )
        .bind(&collection_id)
        .execute(&pool)
        .await
        .expect("seed collection_keys row for the suspended member");

        let access = Collection::resolve_access(&pool, "suspended", &collection_id).await.unwrap();
        assert_eq!(
            access, None,
            "a suspended member's collection_keys row must resolve to NO access"
        );
    }

    /// Regression companion to the test above: an explicitly-`'active'`
    /// member's resolution is byte-identical to the pre-Phase-25 behavior —
    /// the new status join must never narrow access for an active member.
    /// Byte-identical in shape to
    /// `collection_resolve_access_returns_seeded_level_and_none_otherwise`
    /// above, but with an explicit `'active'` status fixture rather than
    /// relying on the column's `DEFAULT 'active'`.
    #[tokio::test]
    async fn collection_resolve_access_unchanged_for_active_member() {
        let pool = seeded_pool().await;
        seed_user(&pool, "owner", "owner@example.com").await;
        seed_user(&pool, "active", "active@example.com").await;
        let collection_id = seed_family_and_collection(&pool, "owner").await;
        seed_family_member_with_status(&pool, "active", "active").await;

        sqlx::query(
            "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
             VALUES (?, 'active', 'sealed', 'read')",
        )
        .bind(&collection_id)
        .execute(&pool)
        .await
        .expect("seed collection_keys row for the active member");

        let access = Collection::resolve_access(&pool, "active", &collection_id).await.unwrap();
        assert_eq!(
            access,
            Some(AccessLevel::Read),
            "an explicitly-active member's resolution must be unchanged from pre-Phase-25 behavior"
        );
    }

    /// FAM-09: `Item::resolve_access`'s collection-scoped branch must return
    /// `None` for a suspended recipient regardless of a `collection_keys`
    /// grant — the status-active-only predicate on the collection_access
    /// query's `fm` join (~line 312, pre-edit) is the mechanism.
    #[tokio::test]
    async fn item_resolve_access_collection_branch_returns_none_for_suspended_recipient() {
        let pool = seeded_pool().await;
        seed_user(&pool, "owner", "owner@example.com").await;
        seed_user(&pool, "suspended", "suspended@example.com").await;
        let collection_id = seed_family_and_collection(&pool, "owner").await;
        seed_family_member_with_status(&pool, "suspended", "suspended").await;

        sqlx::query(
            "INSERT INTO vault_items (id, user_id, enc_key, enc_data, collection_id) \
             VALUES ('item_susp1', 'owner', 'k', 'd', ?)",
        )
        .bind(&collection_id)
        .execute(&pool)
        .await
        .expect("seed collection item");

        sqlx::query(
            "INSERT INTO collection_keys (collection_id, recipient_user_id, sealed_key, access_level) \
             VALUES (?, 'suspended', 'sealed', 'edit')",
        )
        .bind(&collection_id)
        .execute(&pool)
        .await
        .expect("seed collection_keys row for the suspended member");

        let access = Item::resolve_access(&pool, "suspended", "item_susp1").await.unwrap();
        assert_eq!(
            access, None,
            "a suspended recipient's collection_keys grant must resolve to NO access on Item::resolve_access"
        );
    }

    /// FAM-09: `Item::resolve_access`'s `item_shares` branch (fm_r join) must
    /// return `None` for a recipient whose `family_members.status` is
    /// `'suspended'` in the item OWNER's family — exercised on a PERSONAL
    /// item (`collection_id IS NULL`) so this is provably the item_shares
    /// branch's own join, not the collection branch's.
    #[tokio::test]
    async fn item_resolve_access_item_shares_branch_returns_none_for_suspended_recipient() {
        let pool = seeded_pool().await;
        seed_user(&pool, "owner4", "owner4@example.com").await;
        seed_user(&pool, "suspended4", "suspended4@example.com").await;
        sqlx::query("INSERT INTO families (id, owner_user_id, name) VALUES ('fam4', 'owner4', 'Test Family 4')")
            .execute(&pool)
            .await
            .expect("seed family");
        sqlx::query("INSERT INTO family_members (family_id, user_id, role) VALUES ('fam4', 'owner4', 'owner')")
            .execute(&pool)
            .await
            .expect("seed owner4's family_members row");
        sqlx::query(
            "INSERT INTO family_members (family_id, user_id, role, status) VALUES ('fam4', 'suspended4', 'member', 'suspended')",
        )
        .execute(&pool)
        .await
        .expect("seed suspended4's family_members row");

        sqlx::query("INSERT INTO vault_items (id, user_id, enc_key, enc_data) VALUES ('item_susp2', 'owner4', 'k', 'd')")
            .execute(&pool)
            .await
            .expect("seed personal item");

        sqlx::query(
            "INSERT INTO item_shares (item_id, recipient_user_id, sealed_key, access_level) \
             VALUES ('item_susp2', 'suspended4', 'sealed', 'edit')",
        )
        .execute(&pool)
        .await
        .expect("seed item_shares grant for the suspended recipient");

        let access = Item::resolve_access(&pool, "suspended4", "item_susp2").await.unwrap();
        assert_eq!(
            access, None,
            "a suspended recipient's item_shares grant must resolve to NO access on Item::resolve_access"
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
