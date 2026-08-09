---
phase: 25-member-removal-suspension-re-key
plan: 04
subsystem: api
tags: [rust, axum, sqlx, sqlite, authorization, membership]

# Dependency graph
requires:
  - phase: 25-member-removal-suspension-re-key
    plan: "25-01"
    provides: "family_members.status suspension gate wired into Collection/Item::resolve_access (the fm.status = 'active' join this plan's handlers flip and this plan's Task 2 proves live)"
  - phase: 25-member-removal-suspension-re-key
    plan: "25-03"
    provides: "remove_member handler and shared confused-deputy/self-target guard shape in families.rs this plan's handlers mirror"
provides:
  - "POST /api/families/members/{user_id}/suspend and .../reinstate — owner-only reversible member suspension with zero re-key writes"
  - "FamilyMemberRecord.status — the only read-side surface for suspension state, consumed by GET /api/families/members"
  - "Live, request-cycle-level proof that a suspended member's already-issued session token loses resource access on the very next request (FAM-09's suspend-side half)"
affects: [25-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Confused-deputy + self-target guards folded into a single guarded UPDATE's WHERE clause (rows_affected() == 0 => 404) rather than a separate pre-check SELECT — the simplest possible shape for a handler whose entire mechanism is one column flip"
tech-stack-note: "No new dependencies, no new architectural patterns beyond extending families.rs's existing owner-only-handler and single-UPDATE conventions."

key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/families.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/family_removal.rs
    - crates/pv-server/tests/membership_route_sweep.rs

key-decisions:
  - "Wrote each self-target/confused-deputy guard twice (once per handler) rather than factoring into a shared helper, per the plan's own explicit instruction not to over-abstract a two-line check that would also need to know which status value applies."
  - "Confused-deputy guard implemented as the UPDATE statement's own WHERE family_id = ? AND user_id = ? clause, with rows_affected() == 0 mapping to 404 — a single guarded statement, not a separate pre-check SELECT followed by a second UPDATE. This is strictly simpler than remove_member's separate-SELECT shape (25-03) because suspend/reinstate have no follow-on write that needs family_id in scope; the UPDATE's own WHERE clause is a sufficient and self-contained confused-deputy proof."
  - "Extended tests/membership_route_sweep.rs's substitute() for the two new {user_id}-targeted paths (not in this plan's files_modified) — Rule 3 deviation, exact same shape and justification as Plan 25-03's identical precedent for remove_member's own route addition: this pre-existing structural sweep test panics on any unmapped path, so registering a new family_routes() entry without extending it breaks the suite on the very commit that adds the route."
  - "Split each task's commit into a genuine RED (test-only) commit followed by a GREEN (feat) commit, and empirically verified RED by temporarily reverting the two new route registrations in mod.rs, confirming both of Task 1's tests fail (404 in place of 204/400), then restoring and reconfirming GREEN — not merely asserted from the final passing state."

requirements-completed: [FAM-07, FAM-09]

coverage:
  - id: D1
    description: "suspend_member/reinstate_member are FamilyMembership<RequireEdit>-gated (owner-only), reject a target not in the caller's family (404), and reject the caller targeting themselves (400)"
    requirement: "FAM-07"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#suspend_reinstate_reject_self_target_and_non_member"
        status: pass
    human_judgment: false
  - id: D2
    description: "Suspending a member sets family_members.status='suspended' via a single UPDATE with zero collection_keys/vault_items writes; reinstate flips it back to 'active' with byte-identical sealed_key/enc_key across the whole cycle"
    requirement: "FAM-07"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#suspend_then_reinstate_touches_only_family_members_status"
        status: pass
    human_judgment: false
  - id: D3
    description: "A suspended member's already-issued session token loses access on its very next request (GET /api/vault/collections/{id}/items and GET /api/vault/collections/{id} both 404), and reinstatement restores access on the very next request after that with byte-identical enc_key/sealed_key — proven live through a real two-request cycle, not inferred from the unit-level join test"
    requirement: "FAM-09"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#suspended_member_loses_and_regains_live_access_on_next_request_with_identical_keys"
        status: pass
    human_judgment: false
  - id: D4
    description: "GET /api/families/members's FamilyMemberRecord response gains a status field so the web UI (Plan 25-08) can render suspension state"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family_removal.rs#suspend_then_reinstate_touches_only_family_members_status (member_status_via_list assertions at each transition)"
        status: pass
    human_judgment: false

# Metrics
duration: ~40min active work
completed: 2026-08-05
status: complete
---

# Phase 25 Plan 04: Reversible Suspend/Reinstate Summary

**`POST /api/families/members/{user_id}/suspend`/`.../reinstate` — owner-only, single-UPDATE, zero-re-key member suspension, with a live two-request-cycle proof that a suspended member's still-valid bearer token loses collection access on its very next request and regains byte-identical keys on reinstatement.**

## Performance

- **Duration:** ~40 min active work
- **Tasks:** 2/2 completed
- **Files modified:** 4 (2 extended source files, 2 extended test files)

## Accomplishments

- `families::suspend_member`/`families::reinstate_member` (`POST /api/families/members/{user_id}/suspend`/`.../reinstate`) — owner-only (`FamilyMembership<RequireEdit>`), each a single guarded `UPDATE family_members SET status = ... WHERE family_id = ? AND user_id = ?`. `rows_affected() == 0` maps to `404` (confused-deputy: target not in the caller's own resolved family); `target_user_id == caller_user_id` is rejected with `400` before any DB work (owner cannot lock themselves out). Idempotent on a repeat call against an already-matching status. Neither handler ever touches `collection_keys` or `vault_items` — FAM-07's zero-re-key guarantee holds by construction, not just by test coverage.
- `FamilyMemberRecord` gains a `status: String` field (and `families::members`'s `SELECT` gains `fm.status`) — the only read-side surface for suspension state; without it, flipping the column would be invisible to any client.
- Both routes wired into `family_routes()` (cardinality `7` → `9`), with `tests/membership_route_sweep.rs`'s `substitute()` extended for both new `{user_id}`-targeted paths (Rule 3 deviation, mirroring Plan 25-03's identical precedent).
- `suspend_then_reinstate_touches_only_family_members_status` (Task 1): seeds a real shared collection + item, suspends and reinstates the member, and asserts `collection_keys.sealed_key`/`vault_items.enc_key` are byte-identical at every step — a real assertion of "zero writes," not just "the handler didn't call a rewrap function."
- `suspended_member_loses_and_regains_live_access_on_next_request_with_identical_keys` (Task 2) — the phase's load-bearing live proof: a member's session token, obtained BEFORE suspension and never reissued, is used to make a request immediately after suspension (404) and immediately after reinstatement (200, with byte-identical `enc_key`/`sealed_key`). This is the CONTEXT.md "verify this is actually true rather than assuming it" instruction closed with a real two-request HTTP cycle, exercising Plan 25-01's `fm.status = 'active'` join through the real handlers this plan builds, not a synthetic unit-level query.
- Both tasks' RED state was empirically verified (not merely asserted): the two new routes were temporarily removed from `mod.rs`, the tests were run and confirmed to fail with `404` in place of the expected `204`/`400`, then the routes were restored and the tests reconfirmed green — genuine TDD discipline, not a post-hoc label on code written all at once.

## Task Commits

Each task was committed atomically, following TDD RED→GREEN discipline:

1. **Task 1 (RED): failing suspend/reinstate handler tests** - `01e52fc` (test) — both new tests, empirically confirmed failing (404 in place of 204/400) against the routes-not-yet-registered state
2. **Task 1 (GREEN): suspend_member/reinstate_member handlers + route wiring** - `ef6f239` (feat) — handlers, `FamilyMemberRecord.status`, route registration, cardinality bump, `membership_route_sweep.rs` extension; both Task 1 tests pass
3. **Task 2: live suspend→request→reinstate→request cycle proof** - `90a6b48` (test) — the flagship live-cycle test

**Plan metadata:** (this commit, pending — SUMMARY.md per worktree parallel-executor protocol)

## Files Created/Modified

- `crates/pv-server/src/routes/families.rs` (extended) — `suspend_member`, `reinstate_member` handlers; `FamilyMemberRecord.status` field + `members()`'s `SELECT`/mapping
- `crates/pv-server/src/routes/mod.rs` (extended) — two new `family_routes()` entries; cardinality assertion `7` → `9`
- `crates/pv-server/tests/family_removal.rs` (extended) — `seed_owner_member_and_shared_collection`/`member_status_via_list` fixtures, three new tests (Task 1 ×2, Task 2 ×1)
- `crates/pv-server/tests/membership_route_sweep.rs` (extended, not in plan's stated `files_modified`) — `substitute()` mapping for the two new `{user_id}`-targeted paths

## Decisions Made

See `key-decisions` in frontmatter above for the full list. Highlights:
- Each self-target/confused-deputy guard is written twice (once per handler), per the plan's own explicit anti-over-abstraction instruction.
- Confused-deputy guard is the UPDATE's own `WHERE family_id = ? AND user_id = ?` clause plus `rows_affected() == 0 → 404` — simpler than `remove_member`'s separate pre-check SELECT, since neither handler has a follow-on write that needs `family_id` held in scope beyond the one statement.
- `tests/membership_route_sweep.rs` extended outside the plan's declared `files_modified`, mirroring Plan 25-03's identical precedent for the same structural reason.
- RED state empirically verified via a temporary route-registration revert, not merely asserted from the final passing state.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `tests/membership_route_sweep.rs` would panic on the two new routes**
- **Found during:** Task 1
- **Issue:** This pre-existing structural test iterates `family_routes()` and calls `panic!` for any path with no registered id-substitution mapping in its `substitute()` function. Registering `POST /api/families/members/{user_id}/suspend` and `.../reinstate` without extending `substitute()` would break this test on the very commit that adds the routes — identical failure mode to the one Plan 25-03 already fixed for `remove_member`.
- **Fix:** Added the two missing match arms, following the exact same substitution shape as the adjacent `/api/families/members/{user_id}` entry.
- **Files modified:** `crates/pv-server/tests/membership_route_sweep.rs`
- **Verification:** `cargo test -p pv-server --test membership_route_sweep` passes (1/1).
- **Committed in:** `ef6f239` (part of Task 1's GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 3)
**Impact on plan:** Necessary to keep the pre-existing structural sweep test green after this plan's intentional route additions; no scope creep — no new functionality beyond what the plan specified.

## Issues Encountered

**Test fixture initially omitted the manual `collection_id` UPDATE step.** The first draft of `seed_owner_member_and_shared_collection` created the shared item via `POST /api/vault/items` but forgot the follow-up `UPDATE vault_items SET collection_id = ?` step that Plan 25-03's own happy-path fixture uses (a deliberate test-fixture shortcut bypassing the real move endpoint, since `POST /api/vault/items` always creates a personal item). This produced a `RowNotFound` panic in `suspend_then_reinstate_touches_only_family_members_status` when the test tried to `SELECT id FROM vault_items WHERE collection_id = ?`. Fixed before the first commit by adding the same `UPDATE` step the happy-path fixture already establishes as this codebase's convention — not a deviation from the plan (an internal test-fixture bug caught and fixed during Task 1's own RED/GREEN cycle, never landed in a passing commit).

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigated-as-designed | `crates/pv-server/src/routes/families.rs` | T-25-10 (Elevation of Privilege, `suspend_member`/`reinstate_member`'s `target_user_id`) fully closed as planned: the confused-deputy guard is folded into each UPDATE's own `WHERE family_id = ? AND user_id = ?` clause — a target with no `family_members` row in the CALLER's own resolved `family_id` affects zero rows, mapped to `404` via `rows_affected() == 0`. Exercised by `suspend_reinstate_reject_self_target_and_non_member`'s non-member-id assertions. |
| threat_flag: mitigated-as-designed | `crates/pv-server/src/routes/families.rs` | T-25-11 (Denial of Service, owner accidental self-lockout) fully closed: `target_user_id == membership.caller_user_id` is rejected with `400` before any DB work, in BOTH handlers — a server-side rejection, not merely a hidden UI affordance, per CONTEXT.md's locked instruction. Exercised by `suspend_reinstate_reject_self_target_and_non_member`'s self-target assertions on both `suspend` and `reinstate`. |
| threat_flag: mitigated-as-designed | `crates/pv-server/src/routes/membership.rs` (re-verified live by this plan, no code change) | T-25-01 (Elevation of Privilege, `family_members.status='active'` join, Plan 25-01) is now proven closed LIVE, not just at the unit-query level: `suspended_member_loses_and_regains_live_access_on_next_request_with_identical_keys` drives a real suspend→request→reinstate→request cycle over a STILL-VALID, never-reissued bearer token and asserts the exact HTTP status transitions (`200` → `404` → `200`) the join is supposed to produce. This closes the phase's `key_links` note that Plan 25-01's join test alone proved the query in isolation, not the whole request cycle. |
| threat_flag: no-new-write-surface | `crates/pv-server/src/routes/families.rs` | `suspend_member`/`reinstate_member` are new, owner-only mutating endpoints (`POST /api/families/members/{user_id}/suspend`/`.../reinstate`), registered via `family_routes()` (never a literal `.route()` call) — covered by the route-sweep structural test and the bumped cardinality tripwire. Both handlers are structurally incapable of touching `collection_keys`/`vault_items`: neither function contains any SQL statement referencing either table, which is the load-bearing property FAM-07 depends on, not merely an intent documented in a comment. |
| threat_flag: no-new-surface | `crates/pv-server/src/routes/families.rs` | `FamilyMemberRecord.status` is a new field on an EXISTING, already-owner/member-gated response (`GET /api/families/members`) — it exposes no information a family member/owner didn't already have a path to (their own fellow members' role/email/joined_at are already on this same response), and introduces no new query parameter, path segment, or trust boundary. |

**No threat-adjacent issues found beyond the three STRIDE entries this plan's own `<threat_model>` scoped and mitigated as designed, plus the two additional new-surface flags for this plan's own new endpoint/field.**

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `FamilyMemberRecord.status` is on the wire and ready for Plan 25-08's Members section/suspended-banner UI to consume directly.
- The suspend/reinstate handlers are structurally complete and independently testable — Plan 25-08's client can call them with no further server-side work.
- No blockers. No stubs. No deferred items introduced by this plan (the one pre-existing `vault.rs` clippy debt documented in Plan 25-03's own `deferred-items.md`/`WINDOWS.md` entry is unrelated to any file this plan touches and was reconfirmed pre-existing, not re-logged).

## Self-Check: PASSED

- `crates/pv-server/src/routes/families.rs` (suspend_member, reinstate_member, FamilyMemberRecord.status) — FOUND
- `crates/pv-server/src/routes/mod.rs` (both routes registered, cardinality 9) — FOUND
- `crates/pv-server/tests/family_removal.rs` (three new tests) — FOUND
- `crates/pv-server/tests/membership_route_sweep.rs` (substitute() extension) — FOUND
- Commit `01e52fc` (test: Task 1 RED) — FOUND in git log
- Commit `ef6f239` (feat: Task 1 GREEN) — FOUND in git log
- Commit `90a6b48` (test: Task 2) — FOUND in git log
- `cargo test -p pv-server --test family_removal` — 5/5 pass
- `cargo test -p pv-server --lib routes::tests` — 23/23 pass (plan's literal `routes::mod::tests` filter matches zero tests — same pre-existing filter-naming note Plan 25-03's own summary already recorded; `routes::tests` is the correct module path)
- `cargo test -p pv-server --test membership_route_sweep` — 1/1 pass
- `cargo test -p pv-server` (full crate) — all suites green, 0 failed
- `cargo build --workspace` — compiles with no new warnings

---
*Phase: 25-member-removal-suspension-re-key*
*Plan: 04*
*Completed: 2026-08-05*
