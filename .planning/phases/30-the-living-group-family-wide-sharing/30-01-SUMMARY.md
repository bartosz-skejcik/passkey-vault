---
phase: 30-the-living-group-family-wide-sharing
plan: 01
subsystem: database
tags: [sqlite, sqlx, migrations, decision-record, zero-knowledge, family-sharing]

# Dependency graph
requires:
  - phase: 27-shared-passkey-extension
    provides: family/collection/item sharing foundations (0014_family_sharing.sql), invitations (0017_invitations.sql), member suspension (0018_member_suspension.sql)
provides:
  - "FSH-02 decision record (30-DECISION-FSH-02.md) naming the chosen family-wide key-delivery mechanism, alternatives rejected on their merits, and the 'automatically means instantly only for invite-carried delivery' caveat"
  - "PROJECT.md Key Decisions row FSH-02, matching the KEY-05/EXT-10 shape"
  - "collections.family_wide_kind (nullable TEXT, CHECK-constrained to 'folder'/'item_bucket')"
  - "idx_one_item_bucket_per_family partial unique index (at most one item_bucket per family, folder unbounded)"
  - "invitation_family_wide_keys additive sibling table for wrapping N family-wide collection keys into one invite"
affects: [30-02, 30-03, 30-04, 30-05, 30-06, 30-07, 30-08, 30-09, 30-10, 30-11, 30-12, 30-13, 30-14, 30-15, 30-16, 30-17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Decision record lands in its own commit, structurally before any dependent code — verifiable by git log order, not by intent (SC1 evidence bar)"
    - "Additive-only migration discipline: new nullable column + new sibling table, zero existing columns renamed/repurposed/widened (continues 0014-0018 convention)"
    - "Partial unique index (WHERE family_wide_kind = 'item_bucket') scopes a uniqueness constraint to exactly one enum value while leaving siblings unbounded"

key-files:
  created:
    - .planning/phases/30-the-living-group-family-wide-sharing/30-DECISION-FSH-02.md
    - crates/pv-server/migrations/0019_family_wide_sharing.sql
  modified:
    - .planning/PROJECT.md

key-decisions:
  - "FSH-02 mechanism: hybrid invite-time wrap + lazy reseal, with the reseal trigger including the sharer's own subsequent app usage (not scoped to 'another member') — see 30-DECISION-FSH-02.md for full rationale and rejected alternatives"
  - "family_wide_kind as a single enum column over two independent booleans — one unambiguous read for 'is family-wide AND which kind'"
  - "Path A (additive invitation_family_wide_keys sibling table) over widening invitations' existing singular columns — keeps every already-issued invite's shape untouched"

patterns-established:
  - "Decision-record-before-code commit ordering, verified explicitly via git log --oneline -- <path> immediately after commit, not assumed from task sequencing"

requirements-completed: [FSH-02, FSH-03]

coverage:
  - id: D1
    description: "FSH-02 decision record commits to the chosen family-wide key-delivery mechanism, names and rejects alternatives on their merits (invite-only, lazy-reseal-excluding-sharer, server-side re-key, shared symmetric key), and states the honest 'automatically means instantly only for invite-carried delivery' caveat"
    requirement: "FSH-02"
    verification:
      - kind: manual_procedural
        ref: "git show --stat f2fb3c0 confirms only .planning/PROJECT.md and 30-DECISION-FSH-02.md in the commit; git log --oneline -- 30-DECISION-FSH-02.md shows exactly one commit"
        status: pass
    human_judgment: false
  - id: D2
    description: "Migration 0019 adds collections.family_wide_kind, idx_one_item_bucket_per_family, and invitation_family_wide_keys, additive-only, applying cleanly on top of 0001-0018"
    requirement: "FSH-03"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/routes/membership.rs -- cargo test --lib membership:: (11 tests, all seeded_pool() runs sqlx::migrate! including 0019)"
        status: pass
      - kind: manual_procedural
        ref: "sqlite3 CLI against a fresh DB migrated through 0001..0019: PRAGMA table_info(collections) shows family_wide_kind nullable TEXT; CHECK rejects 'not_a_kind'; second item_bucket insert for same family fails idx_one_item_bucket_per_family; second folder insert for same family succeeds; invitation_family_wide_keys exists with composite PK + both FKs"
        status: pass
    human_judgment: false

duration: 7min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 01: FSH-02 Decision Record and Additive Schema Summary

**FSH-02 decision record (hybrid invite-time wrap + lazy reseal, sharer included in the reseal trigger) landed in its own commit before the additive schema (`family_wide_kind`, `idx_one_item_bucket_per_family`, `invitation_family_wide_keys`) that implements it — commit order structurally proves SC1's evidence bar.**

## Performance

- **Duration:** 7 min (13:14 plan-checker fix commit to 13:21 schema commit)
- **Started:** 2026-08-10T11:14:00Z
- **Completed:** 2026-08-10T11:21:09Z
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- Wrote `30-DECISION-FSH-02.md`, naming the chosen mechanism (invite-time wrap + lazy reseal, sharer-inclusive trigger), rejecting five alternatives on their merits (invite-only with no fallback, lazy-reseal-excluding-sharer, server-side re-key, snapshot-only, shared symmetric key), and stating the honest per-case "automatically" caveat
- Added the matching PROJECT.md Key Decisions row (FSH-02), matching KEY-05/EXT-10's depth
- Committed the decision record ALONE — verified via `git show --stat` before proceeding to schema work
- Added migration `0019_family_wide_sharing.sql`: nullable `collections.family_wide_kind`, the `idx_one_item_bucket_per_family` partial unique index, and the additive `invitation_family_wide_keys` sibling table
- Ran `cargo test --lib membership::` (green, 11 tests — the migration-application canary) plus manual `sqlite3` inspection of the schema's finer-grained constraints (CHECK rejection, item_bucket uniqueness scoping, folder unboundedness)

## Task Commits

Each task was committed atomically:

1. **Task 1: FSH-02 decision record — its own commit, before anything depends on it** - `f2fb3c0` (docs)
2. **Task 2: Additive schema — `family_wide_kind` + `invitation_family_wide_keys`** - `74657d2` (feat)

Commit order verified: `f2fb3c0` (decision record) precedes `74657d2` (schema) in `git log --oneline`.

## Files Created/Modified
- `.planning/phases/30-the-living-group-family-wide-sharing/30-DECISION-FSH-02.md` - the FSH-02 decision record: chosen mechanism, five rejected alternatives, data-model consequences, user-visible caveat
- `.planning/PROJECT.md` - one new Key Decisions table row (FSH-02), after the EXT-10 row
- `crates/pv-server/migrations/0019_family_wide_sharing.sql` - `family_wide_kind` column, partial unique index, `invitation_family_wide_keys` table

## Decisions Made
- FSH-02 mechanism: hybrid invite-time wrap + lazy reseal, reseal trigger includes the sharer's own subsequent session — full rationale in `30-DECISION-FSH-02.md`
- `family_wide_kind` as a single enum column (`NULL`/`'folder'`/`'item_bucket'`) rather than two booleans
- `invitation_family_wide_keys` as an additive sibling table (Path A) rather than widening `invitations`' existing singular columns

## Deviations from Plan

None - plan executed exactly as written. Task 1 committed alone (verified via `git show --stat`); Task 2 committed separately with the migration only.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Every later plan in Phase 30 (30-02 through 30-17) can now cite `30-DECISION-FSH-02.md` for the FSH-02 mechanism instead of re-deriving it, and build on the committed `family_wide_kind`/`invitation_family_wide_keys` schema.
- `Collection::resolve_access`/`Item::resolve_access` in `crates/pv-server/src/routes/membership.rs` were NOT touched by this plan, as required — confirmed by `git show --stat` on both commits showing no changes to `membership.rs`.
- No blockers. `30-02`'s checkpoint:decision and `30-14`'s adversarial test are the next gates that re-confirm the zero-knowledge invariant this plan's schema shape upholds.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED

All created files and commit hashes verified present on disk / in git history.
