---
phase: 22-family-collection-data-model-server-authorization
plan: 05
subsystem: api
tags: [axum, sqlx, authorization, testing, security-audit]

# Dependency graph
requires:
  - phase: 22-family-collection-data-model-server-authorization
    provides: membership_routes()/family_routes() tables built incrementally by Plans 22-01 through 22-04, and the Membership<R,M>/FamilyMembership<M> extractors those tables gate every entry with
provides:
  - membership_route_sweep_rejects_non_member_on_every_route — fires an authenticated-but-unrelated caller against every entry in both membership_routes() and family_routes(), asserting 404 on every method a route actually serves
  - membership_routes_table_has_expected_cardinality — cardinality tripwire pinning both tables' entry counts (9 / 3)
  - router_literal_routes_match_documented_allowlist — structural backstop asserting every literal .route(...) call in router_with_cors matches an audited LITERAL_ROUTES_NOT_MEMBERSHIP_GATED/PRE_EXISTING_PERSONAL_SCOPE_ROUTES allowlist
  - pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt — permanent automated zero-knowledge boundary gate over the whole crates/pv-server/src tree
affects: [phase-23-sync, phase-24-invitations, phase-25-removal-rekey, gsd-ship, gsd-secure-phase]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route-sweep testing: iterate the SAME data structure that builds the live router (never a hand-copied path list) to prove uniform enforcement"
    - "Structural allowlist backstop: assert scanned-source set-equality against a documented, justified pub const allowlist so an undocumented addition/removal fails on the commit that makes it"
    - "Permanent grep-style boundary audit as a #[cfg(test)] unit test, self-excluding its own file and stripping comment lines to avoid false positives on doc comments that must name the forbidden calls"

key-files:
  created:
    - crates/pv-server/tests/membership_route_sweep.rs
  modified:
    - crates/pv-server/src/routes/mod.rs

key-decisions:
  - "membership_routes()/family_routes() widened from pub(crate) to pub — the sweep lives in a separate integration-test crate that cannot see pub(crate) items"
  - "INSUFFICIENT_LEVEL_EXCEPTIONS left empty (plan's own documented escape hatch) — the sweep's single unrelated caller U never holds any grant, so every entry asserts 404, not a mix of 404/403; a future plan needing to prove the 403 branch has a named place to add one"
  - "Fixed plan's <verify> command syntax for Task 2 (missing `--` before the second test-name filter — cargo test only accepts one positional TESTNAME before `--`; the libtest binary accepts multiple OR-matched filters only after `--`) — ran the corrected form and confirmed the literal '2 passed' output the plan expected"

patterns-established:
  - "Pattern 1: When a documented dynamic route-registration mechanism (the `.fold(api, |r,(path,mr)| r.route(path, mr))` fold) must coexist with a literal-route scanner, allowlist the exact dynamic call text rather than special-casing the scanner's grammar"

requirements-completed: [SEC-06, SHARE-05]

coverage:
  - id: D1
    description: "Route-sweep test proves no mutating family/collection/item endpoint is reachable by a non-member — iterates membership_routes() AND family_routes() directly, asserts 404 on every served method, panics on any entry that produces zero real assertions"
    requirement: "SEC-06"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/membership_route_sweep.rs#membership_route_sweep_rejects_non_member_on_every_route"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cardinality tripwire pins membership_routes().len()==9 and family_routes().len()==3 so either table silently growing/shrinking is caught"
    requirement: "SEC-06"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#routes::tests::membership_routes_table_has_expected_cardinality"
        status: pass
    human_judgment: false
  - id: D3
    description: "Structural backstop: every literal .route(...) call in router_with_cors matches a documented, justified allowlist (LITERAL_ROUTES_NOT_MEMBERSHIP_GATED ∪ PRE_EXISTING_PERSONAL_SCOPE_ROUTES) — a stray route added outside membership_routes()/family_routes() fails on the commit that adds it"
    requirement: "SEC-06"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#routes::tests::router_literal_routes_match_documented_allowlist"
        status: pass
    human_judgment: false
  - id: D4
    description: "Permanent automated zero-knowledge boundary gate — no pv-server source file calls pv_core::identity::{seal,unseal,unseal_collection_key}, pv_core::identity::unwrap_identity_secret_key, or pv_core::items::{encrypt_item,decrypt_item}(_for_collection), matched by both fully-qualified substring and bare word-boundary identifier"
    requirement: "SHARE-05"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#routes::tests::pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt"
        status: pass
    human_judgment: false
  - id: D5
    description: "Full phase gate: cargo test --workspace and bash scripts/check-supply-chain.sh both exit 0"
    verification:
      - kind: integration
        ref: "cargo test --workspace"
        status: pass
      - kind: other
        ref: "bash scripts/check-supply-chain.sh"
        status: pass
    human_judgment: false

# Metrics
duration: 19min
completed: 2026-07-30
status: complete
---

# Phase 22 Plan 05: Route-Sweep Security Proof + Zero-Knowledge Audit Summary

**Route-sweep integration test iterating the live router's own `membership_routes()`/`family_routes()` tables, backed by a source-scanning structural backstop and a permanent zero-knowledge grep gate — closes SC#2 as a falsifiable proof rather than a review convention.**

## Performance

- **Duration:** ~19 min
- **Started:** 2026-07-30T11:24:01+02:00 (base commit)
- **Completed:** 2026-07-30T11:42:51+02:00
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- `membership_route_sweep_rejects_non_member_on_every_route` fires an authenticated-but-unrelated caller against every entry in both `membership_routes()` (9 entries) and `family_routes()` (3 entries), substituting real FAMILY-A resource ids, and asserts `404` on every HTTP method a route actually serves — closing the CVE-2026-43639 asymmetric-check class by direct proof.
- `membership_routes_table_has_expected_cardinality` pins both tables' entry counts as a tripwire against silent drift.
- `router_literal_routes_match_documented_allowlist` scans `router_with_cors`'s own non-comment source lines for every literal `.route(...)` registration (correctly handling rustfmt's line-wrapped `/api/extension-passkeys` call, which never contains the contiguous substring `.route("`) and asserts the scanned set equals the union of two new audited `pub const` allowlists exactly — a route added or removed outside `membership_routes()`/`family_routes()` fails on the commit that changes it.
- `pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt` makes the zero-knowledge boundary a permanent, whole-tree, self-excluding, comment-stripping, bare-identifier-matching automated gate.
- `SESSION_ONLY_ROUTES_NOT_SWEPT`'s cross-check now asserts BOTH absence from the swept tables AND presence in the audited literal-route allowlist, closing the "pad a fictional exclusion to hide a gap" escape.

## Task Commits

Each task was committed atomically:

1. **Task 1: The route-sweep test (SC#2 headline deliverable) + cardinality tripwire** - `9fdf45e` (test)
2. **Task 2: Zero-knowledge boundary audit + literal-route allowlist audit + full phase-gate run** - `0a94928` (test)

_Note: `mod.rs`'s two new `pub const` allowlists and the sweep test's `SESSION_ONLY_ROUTES_NOT_SWEPT` cross-check extension were deliberately deferred into the Task 2 commit even though I authored them in one editing pass — verified by temporarily stripping Task 2 content, re-running Task 1's own `<verify>` block standalone (both green), then re-adding and re-verifying Task 2's block, so each commit is independently buildable/testable, not just independently diff-able._

## Files Created/Modified
- `crates/pv-server/tests/membership_route_sweep.rs` - New integration test: the route-sweep proof, `SESSION_ONLY_ROUTES_NOT_SWEPT` allowlist + bidirectional cross-check, per-route id substitution
- `crates/pv-server/src/routes/mod.rs` - Widened `membership_routes()`/`family_routes()` to `pub`; added `LITERAL_ROUTES_NOT_MEMBERSHIP_GATED` (24 entries) and `PRE_EXISTING_PERSONAL_SCOPE_ROUTES` (3 entries) `pub const` allowlists; added three new `#[cfg(test)]` tests

## Decisions Made
- Widened `membership_routes()`/`family_routes()` visibility from `pub(crate)` to `pub` — required for the separate integration-test crate to call them; documented inline as the sole reason for the widening.
- Left `INSUFFICIENT_LEVEL_EXCEPTIONS` empty per the plan's own documented escape hatch: the sweep's single unrelated caller never holds any grant on FAMILY-A's resources, so every entry uniformly asserts `404`. A future plan proving the `403` branch (a caller with insufficient, not zero, access) has an established, named place to add an entry.
- Corrected the plan's `<verify>` command for Task 2's per-binary check: `cargo test -p pv-server --lib NAME1 NAME2` errors (`cargo test` accepts only one positional `TESTNAME` before `--`) — ran `cargo test -p pv-server --lib -- NAME1 NAME2` instead (libtest's own multi-filter OR-matching, applied after `--`), confirmed it produces the exact `test result: ok. 2 passed` line the plan's automated check greps for.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed the plan's own `<verify>` command syntax for Task 2's per-binary check**
- **Found during:** Task 2 (running the exact automated verify command from the plan)
- **Issue:** `cargo test -p pv-server --lib pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt router_literal_routes_match_documented_allowlist` errors with `unexpected argument` — `cargo test` accepts only one positional `TESTNAME` filter before `--`; passing two is a cargo CLI error, not a test failure.
- **Fix:** Ran `cargo test -p pv-server --lib -- pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt router_literal_routes_match_documented_allowlist` (both filters after `--`, where libtest itself treats multiple positional args as an OR match) — produces the literal `test result: ok. 2 passed` line the plan's grep expects.
- **Files modified:** None (verification-only; no test/production code changed).
- **Verification:** Ran the corrected command directly; confirmed `test result: ok. 2 passed; 0 failed`.
- **Committed in:** N/A (verification step, not a code change; documented here per Rule 3's "blocking issue" scope).

---

**Total deviations:** 1 auto-fixed (1 blocking — plan verify-command syntax)
**Impact on plan:** No production or test code was affected; the underlying tests were correct and green from first execution. No scope creep.

## Issues Encountered
None beyond the verify-command syntax note above. Both new lib tests (`pv_server_never_calls_pv_core_seal_or_unseal_or_decrypt`, `router_literal_routes_match_documented_allowlist`) and the integration sweep test (`membership_route_sweep_rejects_non_member_on_every_route`) passed on their first run — the careful upfront enumeration of the exact 27 literal `.route(...)` registrations in `router_with_cors` (verified via `grep -n "\.route("` before writing any allowlist entry) avoided the naive-scanner pitfall the plan's `phase_critical_context` warned about (the wrapped `/api/extension-passkeys` registration never contains the contiguous substring `.route("`).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 22's headline SC#2 proof is now structural: `cargo test --workspace` (49 lib tests + all integration targets) and `bash scripts/check-supply-chain.sh` both exit 0.
- KEY-01/KEY-02 remain `Partial` in `REQUIREMENTS.md` per the documented tooling hazard — the orchestrator's `phase.complete` step auto-checks every requirement mapped to this phase, so a human/orchestrator step must re-assert `Partial` on KEY-01/KEY-02 after this phase closes, since their FULL completion also needs Phase 25's rewrap-only-on-removal clause.
- Phase 23 (sync) and Phase 24 (invitations) can build on `membership_routes()`/`family_routes()` as the single, now-swept source of truth for every family/collection/item mutating route — any new route they add must land in one of these two tables (or gain a written, audited allowlist justification) or `router_literal_routes_match_documented_allowlist` fails on that commit.

---
*Phase: 22-family-collection-data-model-server-authorization*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: crates/pv-server/tests/membership_route_sweep.rs
- FOUND: .planning/phases/22-family-collection-data-model-server-authorization/22-05-SUMMARY.md
- FOUND commit: 9fdf45e (Task 1)
- FOUND commit: 0a94928 (Task 2)
