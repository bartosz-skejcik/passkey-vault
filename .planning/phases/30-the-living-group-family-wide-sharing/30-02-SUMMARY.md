---
phase: 30-the-living-group-family-wide-sharing
plan: 02
subsystem: api
tags: [axum, sqlx, sqlite, zero-knowledge, family-sharing, authorization]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-01's collections.family_wide_kind column, idx_one_item_bucket_per_family partial unique index, and 30-DECISION-FSH-02.md (the mechanism this plan's discovery endpoint serves)"
provides:
  - "CreateCollectionRequest.family_wide_kind / CollectionResponse.family_wide_kind, closed-set validated, threaded through create()/get()/list()"
  - "GET /api/families/family-wide-pending -- narrow, additive, ids/kind-only discovery endpoint answering 'which family-wide grants exist that I lack a key for' and 'which active members lack a key I could reseal'"
  - "family_routes() cardinality 10 (was 9); tests/membership_route_sweep.rs exercises the new route"
affects: [30-03, 30-04, 30-05, 30-06, 30-07, 30-08, 30-09, 30-10, 30-11, 30-12, 30-13, 30-14]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Bare ON CONFLICT DO NOTHING (not a targeted ON CONFLICT(id)) to catch a partial-unique-index violation through the same fetch_optional None-branch an id collision already uses -- families::create's own precedent, now also collections::create's"
    - "A discovery endpoint that answers a DIFFERENT question ('does a pending grant exist') from what Collection/Item::resolve_access answers ('can I decrypt this resource right now'), deliberately never widening the latter"

key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/collections.rs
    - crates/pv-server/src/routes/families.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/collections.rs
    - crates/pv-server/tests/family.rs
    - crates/pv-server/tests/membership_route_sweep.rs

key-decisions:
  - "Task 1 checkpoint:decision: narrow-discovery-endpoint selected over widening Collection/Item::resolve_access -- confirmed by the orchestrator, not self-approved. resolve_access (membership.rs) is untouched by this plan's diff."
  - "family_wide_kind validated closed-set (folder | item_bucket) before any DB work; the create() INSERT's ON CONFLICT was widened from targeted (id) to bare, matching families::create's own precedent for a partial-index conflict"

patterns-established:
  - "PendingGrant/ResealableGrant carry ids/kind only -- no field capable of carrying enc_name or sealed_key exists on either type, by construction, not by convention"

requirements-completed: [FSH-01, FSH-03, FSH-05]

coverage:
  - id: D1
    description: "family_wide_kind settable at collection creation, closed-set validated (folder/item_bucket) before any DB work, readable from create()/get()/list() with zero new round trips, byte-for-byte unchanged for every existing non-family-wide creation"
    requirement: "FSH-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs -- family_wide_kind_absent_defaults_to_null_and_round_trips_as_null, family_wide_kind_folder_and_item_bucket_round_trip_through_get_and_list, family_wide_kind_rejects_invalid_value_before_any_db_work, second_item_bucket_for_same_family_is_409_but_second_folder_succeeds (cargo test --test collections)"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs -- all 19 pre-existing tests unmodified and green (cargo test --test collections)"
        status: pass
    human_judgment: false
  - id: D2
    description: "GET /api/families/family-wide-pending exists, gated by ActiveFamilyMembership<RequireRead> exactly like every sibling family-scoped read, scoped to the caller's own resolved family_id, and returns ids/kind only -- no enc_name/sealed_key on any path including the empty-result case"
    requirement: "FSH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family.rs -- family_wide_pending_empty_when_no_family_wide_collections_exist, family_wide_pending_missing_for_new_member_resealable_for_existing_keyholder, family_wide_pending_rejects_suspended_member_with_403 (cargo test --test family) -- the first two assert the raw response body string never contains \"sealed_key\" or \"enc_name\""
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs -- routes::tests::membership_routes_table_has_expected_cardinality (family_routes().len() == 10)"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/membership_route_sweep.rs -- membership_route_sweep_rejects_non_member_on_every_route (new route's id-substitution entry added, sweep asserts 404 for an unrelated caller)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Collection/Item::resolve_access (membership.rs) is not touched by this plan -- the discovery endpoint is a separate, additive read surface"
    requirement: "FSH-05"
    verification:
      - kind: manual_procedural
        ref: "git show --stat on this plan's commits shows zero changes to crates/pv-server/src/routes/membership.rs"
        status: pass
    human_judgment: false

duration: ~35min (including the blocking checkpoint pause between Task 1 and Task 2/3)
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 02: family_wide_kind + the Narrow Discovery Endpoint Summary

**`family_wide_kind` is now a real, validated, round-tripping collection property, and `GET /api/families/family-wide-pending` exists as a deliberately narrow, additive, ids/kind-only read surface that never widens `Collection`/`Item::resolve_access`.**

## Performance

- **Duration:** Task 2+3 execution ~9 min (13:29 first commit to 13:35 last commit, local time), plus the blocking `checkpoint:decision` pause between Task 1 (this session) and the coordinator's resume signal.
- **Started:** 2026-08-10T11:24:00Z (Task 1 checkpoint reached)
- **Completed:** 2026-08-10T11:37:00Z
- **Tasks:** 3 (1 checkpoint:decision, 1 tracer, 1 auto)
- **Files modified:** 6 (3 route files, 3 test files)

## Accomplishments

- Task 1 (`checkpoint:decision`): reported the authorization-shape decision to the orchestrator without self-approving it, per the plan's explicit instruction. The orchestrator selected `narrow-discovery-endpoint` and confirmed `30-DECISION-FSH-02.md`'s already-recorded mechanism, citing the phase's `must_haves.prohibitions` entry against widening `resolve_access`.
- Task 2 (tracer): added `CreateCollectionRequest.family_wide_kind` / `CollectionResponse.family_wide_kind`, a `validate_family_wide_kind` closed-set gate (`folder` | `item_bucket`, called before any DB work), widened `create()`'s `ON CONFLICT(id)` to a bare `ON CONFLICT DO NOTHING` (mirroring `families::create`'s precedent) so a second concurrent `item_bucket` create for the same family surfaces as a clean 409 via the same `fetch_optional` `None`-branch the id-collision case already uses, and threaded the new field through `get()`'s and `list()`'s SELECTs.
- Task 3 (auto): added `GET /api/families/family-wide-pending` (`family_wide_pending()` handler, `PendingGrant`/`ResealableGrant`/`FamilyWidePendingResponse` types — ids/kind only, no field capable of carrying `enc_name`/`sealed_key` exists on either type), gated by `ActiveFamilyMembership<RequireRead>`, both queries scoped to the caller's own resolved `family_id`. Registered in `family_routes()` (cardinality 9 → 10), added the id-substitution entry to `tests/membership_route_sweep.rs`.
- Added 4 new integration tests to `tests/collections.rs` and 3 to `tests/family.rs` covering every behavior named in the plan's `acceptance_criteria` (round-trip, invalid-value 400, the item_bucket-conflict/folder-succeeds pair, the empty/missing/resealable/suspended-403 discovery-endpoint shapes) — the missing/resealable test additionally asserts the raw JSON response body never contains the literal substrings `"sealed_key"`/`"enc_name"`, a defense-in-depth proof beyond the type-level guarantee.
- Full workspace test suite (`cargo test`, all binaries) and `cargo clippy -p pv-server --all-targets` both green with zero warnings in any file this plan touched (18 pre-existing warnings in `vault.rs` are out of scope, untouched by this plan).

## Task Commits

Each task was committed atomically -- **with one infrastructure caveat, see Deviations below**:

1. **Task 1: confirm the discovery-endpoint authorization shape** — checkpoint:decision, no commit (nothing built yet; reported to orchestrator, worktree was clean).
2. **Task 2: family_wide_kind on collection create/get/list** — `6d5c1b3` (feat)
3. **Task 3: GET /api/families/family-wide-pending** — landed inside `753563b`, a commit whose message and majority content belong to a DIFFERENT, concurrently-executing plan (30-05). See Deviations.

**Plan metadata:** this commit (docs: complete plan).

## Files Created/Modified

- `crates/pv-server/src/routes/collections.rs` — `family_wide_kind` field + `validate_family_wide_kind`, bare `ON CONFLICT DO NOTHING`, threaded through `create()`/`get()`/`list()`
- `crates/pv-server/src/routes/families.rs` — `PendingGrant`/`ResealableGrant`/`FamilyWidePendingResponse` + `family_wide_pending()` handler
- `crates/pv-server/src/routes/mod.rs` — new `family_routes()` entry, cardinality 9 → 10
- `crates/pv-server/tests/collections.rs` — 4 new tests for `family_wide_kind`
- `crates/pv-server/tests/family.rs` — 3 new tests for the discovery endpoint
- `crates/pv-server/tests/membership_route_sweep.rs` — id-substitution entry for the new pathless route

## Decisions Made

- Task 1's checkpoint:decision: `narrow-discovery-endpoint` over `widen-resolve-access` (orchestrator-confirmed, matches `30-DECISION-FSH-02.md`'s already-recorded mechanism and the phase's explicit prohibition against widening `resolve_access`).
- `family_wide_kind`'s `ON CONFLICT` widened from targeted `(id)` to bare `DO NOTHING` — required to catch `idx_one_item_bucket_per_family`'s partial-index conflict, since SQLite's targeted `ON CONFLICT(...)` form does not accept a partial-index target.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Plan's own `<automated>` verify commands were vacuous — substituted for the real integration tests**

- **Found during:** Task 2/3, before running any verification.
- **Issue:** The plan's `<verify>` blocks (lines 141, 192, 225) specify `cargo test --lib collections::` and `cargo test --lib families::`. Only `crates/pv-server/src/routes/membership.rs` has a `mod tests` in this codebase — `collections.rs`, `families.rs`, and `invitations.rs` have none. Both `--lib` filters therefore match zero tests and exit 0, a gate that passes by finding nothing. The coordinator independently flagged this exact defect (audited after the sibling 30-03 executor hit it) while I was mid-task; my own execution had already avoided it by inspecting the actual test layout before running verification.
- **Fix:** Ran `cargo test --test collections` and `cargo test --test family` instead (the real integration-test binaries under `crates/pv-server/tests/`) — 23 and 7 tests respectively, all passing, including the 4/3 new tests this plan adds. Also ran `cargo test --lib membership_routes_table_has_expected_cardinality` (the one `--lib` filter that IS real, since it lives in `mod.rs`'s own `#[cfg(test)] mod tests`) and `cargo test --test membership_route_sweep`, matching the coordinator's guidance verbatim.
- **New tests placed in:** `crates/pv-server/tests/collections.rs` and `crates/pv-server/tests/family.rs` — the existing integration-test binaries, per the coordinator's explicit instruction, not a new `mod tests` invented inside the route files.
- **Verification:** `cargo test --test collections` (23 passed), `cargo test --test family` (7 passed), `cargo test --test membership_route_sweep` (1 passed), `cargo test --lib membership_routes_table_has_expected_cardinality` (1 passed), full `cargo test` workspace run (all binaries green), `cargo clippy -p pv-server --all-targets` (zero warnings in any file this plan touched).
- **Committed in:** `6d5c1b3` (Task 2's tests), `753563b` (Task 3's tests — see item 2 below for why this hash is shared with a different plan).

**2. [Infrastructure anomaly, not a deviation rule 1-4 — recorded for the orchestrator's wave-cleanup logic] Task 3's commit landed co-mingled with a concurrently-executing sibling plan's (30-05) work**

- **Found during:** Attempting to commit Task 3 in isolation.
- **What happened:** After Task 1's checkpoint, the orchestrator recreated this worktree under a NEW agent id (`agent-af58c128a4dade4ae`, branch `worktree-agent-af58c128a4dade4ae`) — the original worktree from the Task 1 session (`agent-a5d289042dcd55b18`) had already been force-removed per this wave's normal checkpoint-return protocol, since it held zero uncommitted work at that point. In the NEW worktree, `git log --oneline` showed a real, unexpected commit (`ac2bde3`, `test(30-05): ...`) appear on top of my own Task 2 commit (`6d5c1b3`) mid-session, and immediately after I ran `git add` on my exact 4 Task 3 files (`families.rs`, `mod.rs`, `tests/family.rs`, `tests/membership_route_sweep.rs`), `git status --short` showed FIVE additional `web/*` files (from plan 30-05, none of which this plan touches or has in its `files_modified`) already staged by a process other than mine. A subsequent `git commit -m "..." -- <my 4 paths>` attempt returned "nothing added to commit" — a third-party `git commit` had already run between my `git add` and my `git commit` calls, sweeping up everything staged at that moment (my 4 files AND the sibling's 5 `web/*` files) into one commit, `753563b`, whose message and majority diff (`+716/-2` across 9 files) describes plan 30-05's re-key-notice work, not this plan's discovery endpoint.
- **Root cause (as observed, not fixed by me):** This worktree's git index/branch appears to be SHARED with at least one other concurrently-executing plan's session (30-05, confirmed by the coordinator's own message referencing "your sibling executor on 30-03" and "the invitations work your sibling just landed" as things visible from MY session) — contradicting this plan's own `<parallel_execution>` instructions ("each in its own git worktree", "plans were verified file-disjoint"). This is an orchestration-level isolation defect, not something a per-plan executor can fix from inside a shared working tree.
- **Why I did not attempt to correct it:** `<destructive_git_prohibition>` forbids `git reset --hard`, history rewrites, and any operation that could destroy a concurrently-running sibling agent's in-progress or already-committed work in a SHARED working tree — I have no way to distinguish "safe to rewrite" from "sibling is mid-edit right now" from inside this session. Splitting `753563b` apart via `git revert`+`cherry-pick` risks exactly that destructive outcome for 30-05's work, for a purely cosmetic (commit-message-attribution) gain — my Task 3 code itself is verifiably present, correct, and fully tested (`git show --stat 753563b` shows `families.rs +100`, `mod.rs +10`, `tests/family.rs +220`, `tests/membership_route_sweep.rs +4` — byte-identical line counts to what I authored and staged).
- **Verification the code itself is intact and correctly attributed to THIS plan's diff, despite the commit-message mislabeling:** `git show --stat 753563b` (line counts match exactly); `cargo test --test family`/`cargo test --test membership_route_sweep`/`cargo test --lib membership_routes_table_has_expected_cardinality` all green post-commit; `git diff crates/pv-server/src/routes/families.rs crates/pv-server/src/routes/mod.rs crates/pv-server/tests/family.rs crates/pv-server/tests/membership_route_sweep.rs` between `6d5c1b3` and `753563b` shows exactly and only this plan's Task 3 changes.
- **Recommendation for the orchestrator:** this plan's Task 3 work is real, tested, and correctly scoped, but its commit hash (`753563b`) is NOT exclusively attributable to plan 30-02 in `git log` — the wave-cleanup/merge logic should treat `753563b` as containing BOTH 30-02 and 30-05's Task-level work when reconciling per-plan commit lists, rather than assuming one commit == one plan.

---

**Total deviations:** 2 (1 auto-fixed per Rule 3, 1 infrastructure anomaly documented but not self-corrected, per `<destructive_git_prohibition>`).
**Impact on plan:** Zero impact on the plan's actual deliverables — `family_wide_kind` and the discovery endpoint are both fully implemented, tested, and verified. The only impact is a commit-history attribution artifact the orchestrator's wave-reconciliation step needs to be aware of.

## Issues Encountered

The Task 1 checkpoint's own worktree (`agent-a5d289042dcd55b18`) was force-removed by the orchestrator between the checkpoint return and the resume signal (standard, documented behavior — the worktree held zero uncommitted work at that point, so nothing was lost). The resumed session runs in a freshly-created worktree (`agent-af58c128a4dade4ae`) at the same verified base commit (`4e668fc8...`). See Deviations item 2 above for the shared-worktree anomaly discovered during Task 3.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `family_wide_kind` is a real, validated, round-tripping collection property every later plan in this phase (30-03 through 30-14) can build a family-wide folder/item-bucket UI or client flow on top of.
- `GET /api/families/family-wide-pending` exists, is correctly gated, leaks nothing beyond ids/kind, and is exercised by the non-member-rejection sweep — the client-side reseal/pending-UI plans this phase depends on (per this plan's own `objective`) can now read from it.
- `Collection`/`Item::resolve_access` (`membership.rs`) is verifiably untouched — confirmed via `git show --stat` on both `6d5c1b3` and the 30-02-attributable portion of `753563b`.
- No blockers for downstream plans' functional scope. The one open item is the commit-attribution anomaly documented above, which is an orchestrator/wave-cleanup concern, not a code or test gap.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*
