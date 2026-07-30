---
phase: 23-sync-model-extension-shared-data-fan-out
plan: 02
subsystem: api
tags: [sync, sharing, axum, sqlx, membership, websocket]

# Dependency graph
requires:
  - phase: 23-sync-model-extension-shared-data-fan-out (Plan 23-01)
    provides: "collections.revision fan-out core, VaultItem.is_shared/last_editor_email fields, EntityType::Collection + publish_to_recipients"
provides:
  - "GET /api/sync/shared — per-collection revision map (Vec<CollectionRevision>) + a synthetic direct bucket, FamilyMembership<RequireRead>-gated"
  - "GET /api/vault/collections/{id}/sync — per-collection full snapshot/cheap-check, Membership<Collection, RequireRead>-gated, reused verbatim"
  - "GET /api/sync/shared/direct — caller's own directly-shared (item_shares, collection_id IS NULL) items, SessionUser-only"
  - "Adversarial SYNC-07 (zero-leakage) and SYNC-08 (personal-scope-unchanged) test coverage"
affects: [23-03-409-attribution-collection-events, 23-05-client-sync-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SharedCollectionSyncResponse: one untagged UpToDate/Snapshot enum shared by both pull_shared_collection and pull_shared_direct (mirrors SyncResponse's own convention, minus folders)"
    - "OptionalSyncQuery { since: Option<i64> } — an absent `since` key always degrades to a full-snapshot request (revision compare skipped entirely), never an error; serde's derive special-cases Option<T> via missing_field/deserialize_option so no #[serde(default)] is needed"
    - "GET /api/sync/shared/direct registered as a documented literal .route() (SessionUser-only, no shared resource to authorize against), never through membership_routes()/family_routes()"

key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/sync.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/sync_shared.rs
    - crates/pv-server/tests/sync.rs
    - crates/pv-server/tests/membership_route_sweep.rs
    - .planning/REQUIREMENTS.md

key-decisions:
  - "pull_shared_collection's item query is a NEW `WHERE collection_id = ?` SELECT with NO user_id filter at all — vault::fetch_items_for was deliberately NOT reused (Pitfall A: it is non-widening by design and would silently exclude every item another member created)"
  - "pull_shared_revisions's per-collection join is the SAME collection_keys + family_members join Collection::resolve_access/collections::list already use, scoped to recipient_user_id = caller — never a hand-written WHERE"
  - "GET /api/sync/shared/direct registered as a literal .route() (SessionUser-only), not through membership_routes()/family_routes() — there is no shared resource to authorize against, only the caller's own personal items that happen to be shared TO them; same rationale as GET /api/sync itself"
  - "GET /api/sync/shared lives in family_routes() (pathless, FamilyMembership<RequireRead>), per this plan's own explicit action text — bumping family_routes() from 3 to 4 entries"
  - "GET /api/vault/collections/{id}/sync lives in membership_routes() (path-{id}-based, Membership<Collection, RequireRead>), bumping it from 9 to 10 entries, with the matching substitute() case added to the route sweep"

requirements-completed: [SYNC-04, SYNC-05, SYNC-07, SYNC-08]

coverage:
  - id: D1
    description: "GET /api/sync/shared returns a per-collection revision map (never a MAX/SUM fold) plus a synthetic direct bucket, gated by FamilyMembership<RequireRead>; a caller with zero family membership at all gets 404, never an empty-array 200"
    requirement: "SYNC-04"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#shared_revisions_pull_returns_empty_arrays_for_family_member_with_no_grants"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#shared_revisions_pull_returns_404_for_caller_with_no_family_membership_at_all"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#shared_revisions_pull_lists_members_own_collection_with_current_revision"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /api/vault/collections/{id}/sync degrades to a full snapshot when since is absent and to UpToDate when since matches the collection's current revision, reusing Membership<Collection, RequireRead> verbatim; non-members get 404 never 403"
    requirement: "SYNC-04"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#shared_collection_pull_full_snapshot_without_since_and_up_to_date_when_matching"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#shared_collection_pull_rejects_non_member_with_404_never_403"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/sync/shared/direct returns the caller's own directly-shared personal items, gated by SessionUser only"
    requirement: "SYNC-04"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#shared_direct_pull_returns_recipients_own_directly_shared_items"
        status: pass
    human_judgment: false
  - id: D4
    description: "SYNC-07 zero-leakage, proven adversarially: a non-member's LIVE WebSocket (proven alive via their own unrelated personal mutation) receives zero further frames for a collection they cannot see, and gets 404 (never 403) from the new per-collection pull endpoint"
    requirement: "SYNC-07"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync_shared.rs#non_member_with_live_websocket_receives_zero_frames_for_collection_they_cannot_see"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/membership_route_sweep.rs#membership_route_sweep_rejects_non_member_on_every_route"
        status: pass
    human_judgment: false
  - id: D5
    description: "SYNC-08 textual guarantee: GET /api/sync's own handler/query scope is unchanged — a collection member's own vault_revision bumps (signal 2) but the shared item itself never appears in their personal snapshot"
    requirement: "SYNC-08"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync.rs#personal_sync_scope_unaffected_by_fellow_collection_members_shared_edit"
        status: pass
      - kind: other
        ref: "git diff of sync::pull's own fn body between 23-01 and 23-02 is empty — textually unchanged"
        status: pass
    human_judgment: false
  - id: D6
    description: "Route-table cardinality tripwires and the route sweep updated in the same commit as the new registrations — membership_routes() 9->10, family_routes() 3->4, with a matching substitute() case for the sweep"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#membership_routes_table_has_expected_cardinality"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/membership_route_sweep.rs#membership_route_sweep_rejects_non_member_on_every_route"
        status: pass
    human_judgment: false

duration: ~14min
completed: 2026-07-30
status: complete
---

# Phase 23 Plan 02: Shared-Pull Read Endpoints Summary

**Three new GET endpoints (`/api/sync/shared`, `/api/vault/collections/{id}/sync`, `/api/sync/shared/direct`) reading Phase 23-01's fan-out core, authorized exclusively through the Phase 22 membership extractors, with adversarial Rust tests proving zero leakage to non-members and zero change to `GET /api/sync`'s own query scope.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-07-30T16:48:28+02:00 (approx., prior commit)
- **Completed:** 2026-07-30T17:02:40+02:00
- **Tasks:** 2
- **Files modified:** 6 (0 created, 6 modified — including `.planning/REQUIREMENTS.md`)

## Accomplishments

- `pull_shared_revisions` (`GET /api/sync/shared`, `FamilyMembership<RequireRead>`): a deterministic per-collection revision map (`ORDER BY c.id ASC`, never a `MAX`/`SUM` fold across collections) plus a synthetic "direct" bucket for the caller's own `item_shares`-only items — a zero-collection/zero-share family member gets `{"collections":[],"direct":{"revision":0}}`, never an error; a caller with NO family membership at all gets `404`, never an empty-array `200`.
- `pull_shared_collection` (`GET /api/vault/collections/{id}/sync`, `Membership<Collection, RequireRead>` reused verbatim): mirrors `pull()`'s cheap-check shape but its Snapshot items come from a genuinely NEW query — `WHERE collection_id = ?` with no `user_id` filter at all (Pitfall A: `fetch_items_for` is deliberately non-widening and was never reused here). An absent `since` always degrades to a full snapshot.
- `pull_shared_direct` (`GET /api/sync/shared/direct`, `SessionUser`-only): the caller's own directly-shared personal items, registered as a documented literal `.route()` — mirrors `GET /api/sync`'s own scoping exactly, since there is no shared "resource" to authorize against.
- All three routes registered through the correct audited tables (`membership_routes()` 9→10, `family_routes()` 3→4 — never a literal `.route()` for the two membership/family-gated ones), with the cardinality tripwire and the route-sweep's `substitute()` map updated in the same commits.
- `GET /api/sync`'s own handler body is textually unchanged (SC 5/SYNC-08) — proven by a new test showing a collection member's own `vault_revision` bumps (signal 2) but the shared item never appears in their personal snapshot.
- SYNC-07's zero-leakage guarantee proven adversarially, not as a happy-path negative: a non-member's WebSocket is first proven genuinely LIVE (via their own unrelated personal mutation producing a frame), then shown to receive ZERO further frames when a collection they cannot see is mutated, AND rejected with `404` (never `403`) from the new per-collection pull endpoint for that same collection.

## Task Commits

Each task was committed atomically:

1. **Task 1: Three new shared-pull handlers + response types** - `9eb6355` (feat)
2. **Task 2: Route registration + adversarial SYNC-07/SYNC-08 tests** - `d993b99` (feat)

## Files Created/Modified

- `crates/pv-server/src/routes/sync.rs` - `pull_shared_revisions`/`pull_shared_collection`/`pull_shared_direct` handlers, `SharedRevisionsResponse`/`CollectionRevision`/`DirectBucket`/`SharedCollectionSyncResponse`/`OptionalSyncQuery` types
- `crates/pv-server/src/routes/mod.rs` - registered the three new routes through `membership_routes()`/`family_routes()`/a documented literal `.route()`; updated `LITERAL_ROUTES_NOT_MEMBERSHIP_GATED` and the cardinality tripwire (9→10, 3→4)
- `crates/pv-server/tests/membership_route_sweep.rs` - `substitute()` cases for the two new table entries
- `crates/pv-server/tests/sync_shared.rs` - 7 new tests: empty-grants shape, zero-family-membership 404, live revision reflection, cheap-check UpToDate/Snapshot, non-member 404 on the per-collection endpoint, direct-share fetch, and the adversarial live-WebSocket zero-leakage proof
- `crates/pv-server/tests/sync.rs` - new test proving `GET /api/sync`'s query scope is unaffected by the caller's own collection membership
- `.planning/REQUIREMENTS.md` - SYNC-07/SYNC-08 flipped to Complete (SYNC-04/SYNC-05 were already marked complete by Plan 23-01)

## Decisions Made

- `pull_shared_collection`'s Snapshot query is a genuinely new `WHERE collection_id = ?` SELECT with no `user_id` filter — `vault::fetch_items_for` was never reused, per Pitfall A's explicit warning (it is non-widening by design and would silently exclude every item another member created).
- `GET /api/sync/shared/direct` was registered as a documented literal `.route()`, not through `membership_routes()`/`family_routes()` — there is no shared resource to authorize against here (it's the caller's own personal items that merely happen to be shared TO them), matching `GET /api/sync`'s own established rationale.
- `GET /api/sync/shared` lives in `family_routes()` per the plan's own explicit action text (pathless, `FamilyMembership<RequireRead>`), even though an earlier pattern-mapping draft (23-PATTERNS.md) had sketched it as a literal route before the plan finalized this detail — the plan is authoritative and was followed as written.
- `OptionalSyncQuery { since: Option<i64> }` relies on serde's derive-generated `missing_field`/`deserialize_option` special-casing rather than an explicit `#[serde(default)]` attribute — verified this compiles and behaves correctly (an absent `since` key deserializes to `None`) via the actual test suite rather than assumed from memory.

## Deviations from Plan

None — plan executed exactly as written. All hard constraints from `23-CONTEXT.md`/the plan's `<phase_critical_constraints>` were honored: `GET /api/sync`'s existing handler body was not touched (grep/diff-verified textually identical); `fetch_items_for` was never reused by the new shared endpoint; non-membership returns `404` everywhere, never `403`; the per-collection comparison stays a `Vec`, never a `MAX`/`SUM` fold; only this plan's own five files were touched (`routes/sync.rs`, `routes/mod.rs`, `tests/sync_shared.rs`, `tests/sync.rs`, `tests/membership_route_sweep.rs`), leaving the concurrently-edited `error.rs`/`vault.rs`/`collections.rs`/`tests/vault.rs`/`tests/collections.rs` untouched.

## Issues Encountered

- While drafting the `sync.rs` personal-scope-preservation test, an initial all-zero-byte identity public key (`STANDARD.encode([0u8; 32])`-equivalent) was rejected by `identity::upsert`'s small-order-point validation (400, not 200) — fixed by using a non-zero seed byte (`STANDARD.encode([9u8; 32])`), matching `tests/sync_shared.rs`'s own established `publish_keypair` helper convention. Caught and fixed before the task's commit; not a deviation from the plan itself, just a test-authoring bug in this plan's own new test.
- No other issues — both tasks' acceptance criteria (compile-clean, `cargo test` for the three named test binaries, and `cargo test --workspace`) passed after the one fix above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All three shared-pull endpoints are live, gated correctly, and ready for Plan 23-05's client sync engine to consume.
- `SharedRevisionsResponse`/`SharedCollectionSyncResponse`/`CollectionRevision`/`DirectBucket` are the stable wire types Plan 23-05 reads.
- `cargo test --workspace` is green (all pre-existing tests plus 7 new `sync_shared.rs` tests and 1 new `sync.rs` test — 27 test-result blocks, all `ok`, zero failures).
- No blockers.

---
*Phase: 23-sync-model-extension-shared-data-fan-out*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: crates/pv-server/src/routes/sync.rs
- FOUND: crates/pv-server/src/routes/mod.rs
- FOUND: crates/pv-server/tests/sync_shared.rs
- FOUND: crates/pv-server/tests/sync.rs
- FOUND: crates/pv-server/tests/membership_route_sweep.rs
- FOUND: .planning/REQUIREMENTS.md
- FOUND: commit 9eb6355 (Task 1)
- FOUND: commit d993b99 (Task 2)
