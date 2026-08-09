---
phase: 22-family-collection-data-model-server-authorization
plan: 01
subsystem: api
tags: [axum, sqlx, sqlite, authorization, security-boundary]

requires: []
provides:
  - "Migration 0014 (user_keypairs, families, family_members, collections, collection_keys, item_shares, identity_verifications; additive vault_items.collection_id)"
  - "ApiError::Forbidden (403, insufficient-level case) alongside existing NotFound (no-access case)"
  - "Membership<R, M> generic axum FromRequestParts extractor (path-{id}-based, Collection/Item ResourceKind impls)"
  - "FamilyMembership<M> pathless axum FromRequestParts extractor (singleton family role resolution)"
  - "Shared gate::<M>() 404-vs-403 mapping fn used by both extractors"
  - "family_routes()/membership_routes() table-driven route registration in mod.rs"
  - "POST /api/families, GET/POST /api/families/members, GET /api/families/members/{user_id}/access"
affects: [22-02-identity-keypair, 22-03-collections, 22-04-item-sharing, 22-05-route-sweep]

tech-stack:
  added: []
  patterns:
    - "Generic FromRequestParts<AppState> extractor over a ResourceKind trait — one query-and-decide impl, per-kind SQL only in resolve_access"
    - "Table-driven route registration (family_routes()/membership_routes()) folded into router_with_cors, replacing literal .route() calls for membership-gated endpoints"
    - "Shared gate::<M>() fn as the single 404-vs-403 status-code decision point"

key-files:
  created:
    - crates/pv-server/migrations/0014_family_sharing.sql
    - crates/pv-server/src/routes/membership.rs
    - crates/pv-server/src/routes/families.rs
    - crates/pv-server/tests/family.rs
  modified:
    - crates/pv-server/src/error.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/common/mod.rs

key-decisions:
  - "FamilyMembership<M> is a second, pathless extractor (not a Family ResourceKind under Membership<R,M>) since v0.4's family is a strict singleton with no {id} path segment — deviation recorded in the plan's own objective, per Claude's Discretion."
  - "Membership<R,M> reads the path id via Path::<HashMap<String,String>> rather than 22-RESEARCH.md's Path<String> sketch — verified against pinned axum-0.8.9, Path<String> rejects any route with more than one {...} capture, which several later Membership-gated routes have."
  - "AccessLevel deliberately does not derive Ord/PartialOrd — RequireEdit::satisfied_by is an explicit == AccessLevel::Edit match so HiddenPassword can never accidentally satisfy an edit-gate via a transitive comparison (SHARE-04/Vaultwarden #6269 mechanism)."
  - "combine_access ranks two independent grants for MAX-of-two-grants only (never a MinAccess decision) — kept structurally separate from the exact-match gate to prevent the two use cases from ever being conflated."

patterns-established:
  - "ResourceKind trait: fn resolve_access(...) -> impl Future<Output=...> + Send (explicit Send bound needed since native async fn in traits doesn't propagate one, and axum's FromRequestParts requires it)."
  - "gate::<M>() shared by both extractors so the 404-vs-403 split provably lives in exactly one place."

requirements-completed: [FAM-01, FAM-02, FAM-03, SEC-06, SHARE-05]

coverage:
  - id: D1
    description: "An authenticated user can POST /api/families and see themselves listed as the family's sole member with a join timestamp via GET /api/families/members"
    requirement: "FAM-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family.rs#family_create_creates_sole_member_with_join_timestamp"
        status: pass
    human_judgment: false
  - id: D2
    description: "A second POST /api/families (or a client retry) returns 409, never a silent duplicate or second success"
    requirement: "FAM-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family.rs#second_family_create_returns_conflict"
        status: pass
    human_judgment: false
  - id: D3
    description: "Member list with join timestamps, deterministically ordered"
    requirement: "FAM-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family.rs#member_list_includes_joined_at"
        status: pass
    human_judgment: false
  - id: D4
    description: "The owner can add an existing registered user to the family via POST /api/families/members and query per-member collections + item shares via GET /api/families/members/{user_id}/access; a non-owner member gets 403 (not 404) on the same endpoint"
    requirement: "FAM-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family.rs#owner_sees_per_member_access_breakdown"
        status: pass
    human_judgment: false
  - id: D5
    description: "Membership<R,M> / FamilyMembership<M> extractor mechanics: AccessLevel/MinAccess/RequireRead/RequireEdit, parse_access_level fails closed, combine_access MAX-of-two-grants, shared gate::<M>() 404-vs-403 mapping, Collection/Item ResourceKind impls (personal-ownership rule preserved, collection-scoped dual-path MAX)"
    requirement: "SHARE-05"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/routes/membership.rs#tests::collection_resolve_access_returns_seeded_level_and_none_otherwise"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/membership.rs#tests::item_resolve_access_personal_branch_preserves_ownership_rule"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/membership.rs#tests::item_resolve_access_collection_branch_returns_max_of_both_grants"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/membership.rs#tests::parse_access_level_rejects_unrecognized_strings"
        status: pass
    human_judgment: false
  - id: D6
    description: "Every collection/item/family endpoint uniformly membership-gated via table-driven registration (family_routes()/membership_routes()), not per-handler checks"
    requirement: "SEC-06"
    verification:
      - kind: other
        ref: "grep -n \"membership_routes\\|family_routes\" crates/pv-server/src/routes/mod.rs — both functions defined and folded into router_with_cors"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-30
status: complete
---

# Phase 22 Plan 01: Family/Collection Authorization Foundation Summary

**Generic `Membership<R,M>`/`FamilyMembership<M>` axum authorization extractors (SEC-06/SHARE-05 security boundary), migration 0014's 7-table schema, and the singleton family create/list/add-member/per-member-access API (FAM-01/02/03), all sharing one `gate::<M>()` 404-vs-403 decision point.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-30T08:33Z (approx, first task commit)
- **Completed:** 2026-07-30T08:39Z
- **Tasks:** 3
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- Migration `0014_family_sharing.sql`: `user_keypairs`, `families` (+ singleton unique expression index), `family_members`, `collections`, `collection_keys`, `item_shares`, `identity_verifications`, plus additive `vault_items.collection_id`.
- `ApiError::Forbidden` (403) added alongside existing `NotFound` (404) — the insufficient-vs-no access split CONTEXT.md locks.
- `Membership<R, M>` generic extractor (path-`{id}`-based, reads `Path<HashMap<String,String>>` per the axum-0.8.9-verified deviation from RESEARCH.md's sketch) with `Collection`/`Item` `ResourceKind` impls — `Item` is dual-mode: personal-ownership rule preserved byte-for-byte, collection-scoped items resolve the MAX of collection-membership and direct item-share grants via `combine_access`.
- `FamilyMembership<M>` pathless sibling extractor for the v0.4 singleton family, sharing the same `gate::<M>()` fn.
- `family_routes()`/`membership_routes()` table-driven route registration, folded into `router_with_cors` — the single source of truth Plan 22-05's route-sweep test will iterate.
- Full family CRUD surface: `POST /api/families`, `GET /api/families/members`, `POST /api/families/members`, `GET /api/families/members/{user_id}/access`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0014 + ApiError::Forbidden + Membership/FamilyMembership extractor core + family create/list** - `5620c0f` (feat)
2. **Task 2: Collection & Item ResourceKind impls + second-create-conflict test + multi-member test helper** - `266ab4c` (feat)
3. **Task 3: POST /api/families/members + FAM-03 per-member access breakdown** - `ecb037f` (feat)

## Files Created/Modified
- `crates/pv-server/migrations/0014_family_sharing.sql` - 7 new tables + additive `vault_items.collection_id` column
- `crates/pv-server/src/routes/membership.rs` - `AccessLevel`, `MinAccess`/`RequireRead`/`RequireEdit`, `parse_access_level`, `combine_access`, `gate::<M>()`, `ResourceKind`, `Collection`/`Item` impls, `Membership<R,M>`, `FamilyMembership<M>`, `resolve_family_role`, unit tests
- `crates/pv-server/src/routes/families.rs` - `create`, `members`, `add_member`, `member_access`, `fingerprint_hex`, request/response structs
- `crates/pv-server/src/error.rs` - `ApiError::Forbidden` variant + `into_response` arm
- `crates/pv-server/src/routes/mod.rs` - `pub mod membership; pub mod families;`, `family_routes()`/`membership_routes()`, folded into `router_with_cors`
- `crates/pv-server/tests/family.rs` - 4 integration tests (create/list, second-create-conflict, member-list, per-member access breakdown incl. 403-vs-404)
- `crates/pv-server/tests/common/mod.rs` - `register_second_family_member` helper

## Decisions Made
- `FamilyMembership<M>` built as a second, pathless extractor rather than forcing the singleton family through `Membership<Family, M>` — recorded in the plan's own objective as a discretionary deviation from RESEARCH.md's `Family`-as-`ResourceKind` sketch.
- `Membership<R,M>` reads the path id via `Path::<HashMap<String,String>>`, not `Path<String>` — verified against the pinned `axum-0.8.9` source that `Path<String>` rejects any route with more than one `{...}` capture, which later Plans 22-03/22-04 routes need.
- `AccessLevel` deliberately does not derive `Ord`/`PartialOrd`; `RequireEdit::satisfied_by` is an explicit `== AccessLevel::Edit` match, structurally excluding `HiddenPassword` (the SHARE-04/Vaultwarden #6269 mechanism, to be exercised by Plan 22-04).
- `combine_access`'s rank (`Read=0, HiddenPassword=1, Edit=2`) is kept structurally separate from `MinAccess`'s exact-match gate — it exists only to pick the better of two independent grants, never to decide a `RequireEdit` question.

## Deviations from Plan

None beyond the two deviations the plan itself already anticipated and recorded in its `<objective>` (the `FamilyMembership<M>` split and the `Path<HashMap<...>>` extraction) — both implemented exactly as specified.

One implementation-level fix not called out in the plan text: `ResourceKind::resolve_access` initially compiled as a native `async fn` in the trait, which does not propagate a `Send` bound; axum's `FromRequestParts::from_request_parts` requires its future to be `Send` (polled from tokio's multi-threaded runtime), so the trait method signature was rewritten as `fn resolve_access(...) -> impl Future<Output = ...> + Send` (Rule 3 — blocking compile error, auto-fixed).

## Issues Encountered
- Initial unit-test seed inserts referenced a `vault_items.type` column that no longer exists (removed in migration `0003_vault_items_rebuild.sql`, per that migration's own header comment) — fixed by matching the current `vault_items` shape (`id, user_id, enc_key, enc_data, revision, collection_id`).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `Membership<R, M>` and `FamilyMembership<M>` are fully built and unit-proven; `ResourceKind` is implemented for `Collection`/`Item` but not yet wired to any route — Plans 22-03 (collections) and 22-04 (item sharing) populate `membership_routes()` with the first entries.
- `family_routes()`/`membership_routes()` table pattern is established and ready for Plan 22-05's route-sweep test to iterate.
- Migration 0014's full schema (including `user_keypairs`, `identity_verifications`) is in place for Plan 22-02 (identity keypair publication) to build on without a further migration.

---
*Phase: 22-family-collection-data-model-server-authorization*
*Completed: 2026-07-30*
