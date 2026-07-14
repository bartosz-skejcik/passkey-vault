---
phase: 05-multi-device-sync
plan: 01
subsystem: api
tags: [axum, sqlx, sqlite, sync, revision, rust]

requires:
  - phase: 02-vault-crud
    provides: vault_items/folders CRUD with single-statement optimistic-concurrency (revision) pattern
provides:
  - "users.vault_revision monotonic per-user change counter (migration 0010)"
  - "Atomic vault_revision bump in vault.rs create/update/delete and folders.rs create/delete"
  - "fetch_items_for / fetch_folders_for shared row-fetch helpers (dedup with list())"
  - "GET /api/sync?since=N cheap-check pull endpoint (SyncQuery, SyncResponse, pull handler)"
affects: [05-02-websocket-push, 05-03-client-sync]

tech-stack:
  added: []
  patterns:
    - "Atomic global counter bump via single UPDATE ... SET x = x + 1 ... RETURNING (never SELECT-then-UPDATE)"
    - "Shared pub(crate) row-fetch helpers reused by both list() handlers and the new sync snapshot arm"
    - "serde #[serde(untagged)] enum for a cheap-check-vs-full-snapshot response shape"

key-files:
  created:
    - crates/pv-server/migrations/0010_vault_revision.sql
    - crates/pv-server/src/routes/sync.rs
    - crates/pv-server/tests/sync.rs
  modified:
    - crates/pv-server/src/routes/vault.rs
    - crates/pv-server/src/routes/folders.rs
    - crates/pv-server/src/routes/mod.rs

key-decisions:
  - "Migration numbered 0010 (phase 5's reserved 0010-0012 range), not 0007 as 05-RESEARCH.md's draft suggested -- later migrations 0007-0009 landed in Phases 3/4 between research and execution."
  - "vault_revision bump return value bound to _new_global_revision (unused in this plan) -- Plan 05-02 consumes it for sync_hub.publish()."

patterns-established:
  - "Every vault_items/folders mutation ends with the same atomic UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision statement, immediately after the row's own mutation succeeds."

requirements-completed: [SYNC-01]

coverage:
  - id: D1
    description: "users.vault_revision is bumped atomically (single UPDATE...RETURNING, no SELECT-then-UPDATE race) alongside every vault_items/folders create/update/delete"
    requirement: "SYNC-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync.rs#mutation_bumps_vault_revision"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs (13 tests, unchanged, response-shape regression guard)"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /api/sync?since=N returns a cheap {revision} body with no items/folders keys when caller is up to date"
    requirement: "SYNC-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync.rs#pull_up_to_date_returns_no_body"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/sync?since=N returns a full {revision, items, folders} snapshot when stale"
    requirement: "SYNC-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync.rs#pull_stale_returns_full_snapshot"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /api/sync is scoped strictly to the authenticated caller's own user_id -- never leaks another user's revision or items"
    requirement: "SYNC-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync.rs#sync_is_scoped_to_the_authenticated_user"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-14
status: complete
---

# Phase 5 Plan 01: Sync Pull Endpoint & Atomic Revision Counter Summary

**`users.vault_revision` atomic counter bumped inside every existing vault-item/folder mutation, plus a new `GET /api/sync?since=N` cheap-check/full-snapshot pull endpoint proven by 4 real-SQLite integration tests.**

## Performance

- **Duration:** 25 min
- **Completed:** 2026-07-14T11:58:01Z
- **Tasks:** 2 completed
- **Files modified:** 6 (3 created, 3 modified)

## Accomplishments
- `users.vault_revision INTEGER NOT NULL DEFAULT 0` (migration `0010_vault_revision.sql`) — a single per-user monotonic change counter.
- Every mutating handler in `vault.rs` (`create`, `update`, `delete`) and `folders.rs` (`create`, `delete`) now atomically bumps `vault_revision` via `UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision` — a separate statement from the row's own mutation, but never a SELECT-then-UPDATE race.
- `list()` handlers in both `vault.rs` and `folders.rs` refactored into thin wrappers around new `pub(crate)` `fetch_items_for`/`fetch_folders_for` helpers, so the new sync snapshot arm shares one SQL source of truth per table (no duplicated SELECTs).
- `GET /api/sync?since=N` (`crates/pv-server/src/routes/sync.rs`): cheap-checks `since` against the caller's current `vault_revision` — returns `{revision}` with no `items`/`folders` keys when equal, or a full `{revision, items, folders}` snapshot when stale.
- 4 new integration tests in `crates/pv-server/tests/sync.rs`, all against a real in-memory SQLite database via the existing `oneshot()` harness — proving the cheap-check shape, the full-snapshot shape, strictly-increasing revisions across three sequential mutations, and cross-user isolation.

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration + atomic vault_revision bump in vault.rs/folders.rs + row-fetch dedup** - `8f3006c` (feat)
2. **Task 2: GET /api/sync pull handler + router wiring + integration tests** - `d9d30ef` (test, RED) → `c5891ba` (feat, GREEN)

**Plan metadata:** (this commit)

_Note: Task 2 was TDD — `d9d30ef` adds 4 failing tests (confirmed RED: all 404, since `/api/sync` wasn't yet routed), `c5891ba` implements `sync.rs` + router wiring to make all 4 pass (GREEN). No REFACTOR commit was needed — the implementation matched 05-RESEARCH.md's Pattern 1 code shape exactly on the first pass._

## Files Created/Modified
- `crates/pv-server/migrations/0010_vault_revision.sql` - additive `ALTER TABLE users ADD COLUMN vault_revision INTEGER NOT NULL DEFAULT 0`
- `crates/pv-server/src/routes/vault.rs` - `create`/`update`/`delete` gain the atomic revision bump; `list()` extracted into `fetch_items_for`
- `crates/pv-server/src/routes/folders.rs` - `create`/`delete` gain the atomic revision bump; `list()` extracted into `fetch_folders_for`
- `crates/pv-server/src/routes/sync.rs` - new: `SyncQuery`, `SyncResponse` (untagged `UpToDate`/`Snapshot`), `pull()` handler
- `crates/pv-server/src/routes/mod.rs` - `pub mod sync;` + `GET /api/sync` route
- `crates/pv-server/tests/sync.rs` - new: 4 integration tests covering cheap-check, stale-snapshot, sequential-mutation-bump, and cross-user-scoping behaviors

## Decisions Made
- Migration numbered `0010` (not `0007` as 05-RESEARCH.md's draft sketch suggested) — the plan's own frontmatter/instructions correctly override the stale research draft, reserving this phase's migration range as `0010`-`0012` since migrations `0007`-`0009` already landed during Phases 3/4 between when research was written and this plan executed.
- The atomic bump's returned `i64` is intentionally bound to an unused `_new_global_revision` in every call site — this plan's scope is strictly the pull contract (SYNC-01); Plan 05-02 will consume this value when wiring `sync_hub.publish()`.

## Deviations from Plan

None - plan executed exactly as written. The migration number (0010 vs. the research draft's suggested 0007) was already correctly specified in this plan's own frontmatter/action text (the plan itself, not the older 05-RESEARCH.md snapshot, is authoritative), so this is not a deviation from the plan.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 05-02 (WebSocket push) can now wire `sync_hub.publish()` calls right after each `_new_global_revision` bump site in `vault.rs`/`folders.rs` — the bump sites and their exact return values already exist, just currently discarded.
- Plan 05-03 (client sync) can build directly against the now-live `GET /api/sync?since=N` contract — response shape (`{revision}` vs. `{revision, items, folders}`) is stable and tested.
- No blockers. `cargo test --workspace` is green (vault: 13/13, sync: 4/4, plus all pre-existing suites); `cargo build` clean with zero new warnings.

---
*Phase: 05-multi-device-sync*
*Completed: 2026-07-14*

## Self-Check: PASSED

All created files verified present on disk (`0010_vault_revision.sql`, `sync.rs`, `tests/sync.rs`, this SUMMARY.md); all task commit hashes (`8f3006c`, `d9d30ef`, `c5891ba`) plus the docs commit verified present in `git log --oneline --all`.
