---
phase: 26-web-app-sharing-ui-family-management
plan: 13a
subsystem: testing
tags: [playwright, e2e, collections, invite-flow, regression-fix]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-01's client-minted collection id contract (POST /api/vault/collections requires id); Plan 26-12's genuinely-enabled collection-scoped invite (invite-scope-select's folder option, CollectionPicker mount)"
provides:
  - "Four Group A e2e specs (delete-account.spec.ts x2, remove-member.spec.ts x2) send a client-minted UUID id on every POST /api/vault/collections call, matching sharing.spec.ts's established idiom"
  - "invite-flow.spec.ts's stale CR-02 disabled-option guard replaced with a guard asserting the CURRENT enabled contract (option selectable, CollectionPicker mounts)"
  - "WINDOWS.md entries 4, 5, 6 closed; entry 10 opened for a newly-discovered order-dependent hang"
affects: [26-verification, gsd-ship]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "e2e specs mint id: randomUUID() (node:crypto, already imported) on every raw POST /api/vault/collections body, mirroring the client-mint-before-encrypt contract Plan 26-01 established and sharing.spec.ts already followed"

key-files:
  created: []
  modified:
    - web/e2e/delete-account.spec.ts
    - web/e2e/remove-member.spec.ts
    - web/e2e/invite-flow.spec.ts
    - .planning/WINDOWS.md

key-decisions:
  - "Minimal fix for Group A: add id: randomUUID() to each of the 4 POST bodies, keep reading collectionId back from the response (the server echoes it per Plan 26-01's contract) rather than restructuring the tests to skip the round trip -- smallest diff that restores the established contract."
  - "Group B: replaced (not deleted) the stale test, plus corrected the file's header comment, which still asserted the option was 'UNCONDITIONALLY disabled' -- leaving that comment stale next to a test now proving the opposite would be actively misleading to the next reader."
  - "Did not attempt to fix the newly-discovered sharing.spec.ts hang (WINDOWS #10) -- it requires investigating crates/pv-server's rekey path or the client's item-create fetch, both production code, outside this plan's test-file-only remit."

requirements-completed: []

coverage:
  - id: D1
    description: "delete-account.spec.ts's two live tests and remove-member.spec.ts's two live tests all send a client-minted id and no longer 422 on collection creation"
    verification:
      - kind: e2e
        ref: "web/e2e/delete-account.spec.ts#owner_account_deletion_live_dissolves_family_for_a_concurrent_member_session"
        status: pass
      - kind: e2e
        ref: "web/e2e/delete-account.spec.ts#member_self_deletion_live_rekeys_owned_collections_transparently_for_the_owner"
        status: pass
      - kind: e2e
        ref: "web/e2e/remove-member.spec.ts#suspend_then_reinstate_live_cycle_with_no_rekey"
        status: pass
      - kind: e2e
        ref: "web/e2e/remove-member.spec.ts#remove_member_live_shows_real_item_names_and_honesty_copy_then_cuts_off_the_members_session"
        status: pass
    human_judgment: false
  - id: D2
    description: "invite-flow.spec.ts's folder-scope guard asserts the CURRENT contract (enabled, selectable, mounts CollectionPicker), not the stale CR-02-era disabled assertion"
    verification:
      - kind: e2e
        ref: "web/e2e/invite-flow.spec.ts#folder_scope_option_is_enabled_and_mounts_the_collections_picker"
        status: pass
    human_judgment: false
  - id: D3
    description: "Full e2e suite run with --retries=0 after the fix; the previously-cascade-skipped 4 invite-flow.spec.ts tests actually execute"
    verification:
      - kind: e2e
        ref: "npx playwright test --retries=0 (full suite, run twice, deterministic result both times)"
        status: fail
    human_judgment: true
    rationale: "17/19 pass, 0 skipped/did-not-run (the original 4 cascade-skipped tests now execute and pass). The remaining 2 failures are a newly-discovered, order-dependent production defect (WINDOWS #10) unrelated to and outside the scope of this test-file-only plan -- a human/future plan must decide whether to fix crates/pv-server's rekey path or web's item-create client, or reorder the suite as a stopgap."

# Metrics
duration: ~45min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 13a: Fix regressed Playwright e2e specs Summary

**Restored the client-minted collection `id` contract in four e2e specs that Plan 26-01 broke (WR-09 vintage 422s) and replaced invite-flow.spec.ts's stale CR-02 disabled-option guard with one that proves the option Plan 26-12 genuinely enabled; a newly-surfaced, order-dependent server-side hang was discovered but left unfixed as out-of-scope production code.**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-08-06T12:50:00Z
- **Completed:** 2026-08-06T13:03:29Z
- **Tasks:** 2 (Group A fix, Group B fix) + WINDOWS.md bookkeeping
- **Files modified:** 4

## Accomplishments

- **Group A closed (WINDOWS #4, #5).** Plan 26-01 made the client-minted `id` field required on `POST /api/vault/collections` and updated 30 Rust test call sites, but missed the Playwright specs. `delete-account.spec.ts` (2 tests) and `remove-member.spec.ts` (2 tests) each had one raw `POST /api/vault/collections` call omitting `id` and 422ing. All four now mint `id: randomUUID()` (already imported from `node:crypto` in both files) before the call, matching `sharing.spec.ts`'s existing, already-passing idiom rather than inventing a second one.
- **Group B closed (WINDOWS #6).** `folder_scope_option_is_disabled_and_cannot_be_selected` asserted the "Family + one folder" invite scope is disabled -- a Phase 24 CR-02 guard Plan 26-12 deliberately discharged by wiring up a real `CollectionPicker`. Replaced with `folder_scope_option_is_enabled_and_mounts_the_collections_picker`: asserts the `<option>` is NOT disabled, drives a real `selectOption("folder")` (the actual user-interaction path the old test deliberately avoided, since it was meaningless against a disabled control), and asserts `CollectionPicker` (populated or empty-state variant) mounts in the option's place. Also corrected the file's header comment, which still claimed the option was "UNCONDITIONALLY disabled."
- **Full suite actually executes now.** The prior run's "4 did not run" (invite-flow.spec.ts's remaining `describe.serial` tests, cascade-skipped by Group B's failure) now all run and pass.
- **A new, order-dependent production defect was discovered and NOT fixed** (see "Deviations" and "Threat Flags" below) -- reported per this plan's own constraint against changing production code.

## Task Commits

Each task was committed atomically:

1. **Group A: mint client-side collection id in delete-account.spec.ts + remove-member.spec.ts** -- `0e01b6d` (fix)
2. **Group B: replace stale folder-scope-disabled guard with enabled guard in invite-flow.spec.ts** -- `d82d893` (test)
3. **WINDOWS.md: close #4/#5/#6, record new discovery #10** -- `6a8e79a` (docs)

## Files Created/Modified

- `web/e2e/delete-account.spec.ts` -- added `id: randomUUID()` to 2 `POST /api/vault/collections` bodies
- `web/e2e/remove-member.spec.ts` -- added `id: randomUUID()` to 2 `POST /api/vault/collections` bodies
- `web/e2e/invite-flow.spec.ts` -- replaced the stale disabled-guard test with an enabled-guard test; corrected the file's header comment
- `.planning/WINDOWS.md` -- entries 4, 5, 6 marked `fixed`; entry 10 appended (new discovery)

## Decisions Made

- Minimal-diff fix for Group A: add the required `id` field only, keep the existing response-echo read-back for `collectionId` (the server contract, per Plan 26-01, guarantees the echoed id equals the sent id) -- no restructuring of the surrounding test logic.
- Group B replaces rather than deletes the guard, per the task's own instruction: the surface (whether the option is reachable) still deserves a regression guard, just one asserting the current, correct contract.
- Left the newly-discovered sharing.spec.ts hang (see Deviations) unfixed -- diagnosing/fixing it would mean editing `crates/pv-server`'s rekey path or `web/src`'s item-create client, both production code outside this plan's declared test-file-only remit.

## Deviations from Plan

### Auto-fixed Issues

None beyond the plan's own two named fixes (Group A, Group B) -- no additional Rule 1-3 auto-fixes were needed inside the four touched files.

### New defect discovered, NOT auto-fixed (out of scope)

**1. [New discovery, production code -- not fixed here] Order-dependent hang: `member_self_deletion_live_rekeys_owned_collections_transparently_for_the_owner` breaks a later, unrelated real-browser item-creation test**

- **Found during:** the full-suite `--retries=0` run required by this plan's own constraints, after Group A's fix let `delete-account.spec.ts`'s `member_self_deletion_live_rekeys_owned_collections_transparently_for_the_owner` test run to completion for the first time ever (it always 422'd before reaching its real server-side collection re-key path).
- **Symptom:** `sharing.spec.ts`'s `owner shares a real folder with a member... (WR-09)` and `Backstop #6: a real, long shared-folder name...` tests -- both driven through `createLoginItemViaUI`, both using two brand-new, never-before-seen accounts with no relation to the family/member-deletion state -- hang for the full 120s Playwright test timeout waiting for `item-form-login` to detach after a real-browser item-create submit.
- **Reproduction (bisected, deterministic across repeated runs):**
  - Full suite (19 tests), `--retries=0`, run twice: identical result both times -- 17 passed, 2 failed (the same 2 tests, same failure mode).
  - `invite-flow.spec.ts` + `sharing.spec.ts` alone (skip delete-account/remove-member/shared-sync): 10/10 pass.
  - `delete-account.spec.ts` + `remove-member.spec.ts` + `sharing.spec.ts`: 6/8 pass, same 2 sharing.spec.ts tests hang.
  - `delete-account.spec.ts` alone (both its tests) + `sharing.spec.ts`: same 2/4 hang.
  - `delete-account.spec.ts`'s `owner_account_deletion_live_dissolves_family...` test + `sharing.spec.ts`'s WR-09 test only: **both pass**.
  - `delete-account.spec.ts`'s `member_self_deletion_live_rekeys_owned_collections...` test + `sharing.spec.ts`'s WR-09 test only: **WR-09 hangs and times out**.
  - Conclusion: `member_self_deletion_live_rekeys_owned_collections_transparently_for_the_owner` specifically (not the owner-deletion test, not remove-member.spec.ts, not shared-sync.spec.ts) is the trigger.
- **Root cause not isolated.** Candidates not yet investigated: SQLite WAL contention/lock left open by the rekey transaction; a client-side `fetch()` in the item-create path that never resolves under some server state the rekey leaves behind; a WebSocket fan-out event queued indefinitely. None confirmed.
- **Why not fixed here:** this plan's own constraints are explicit ("These are TEST fixes. Do NOT change production code to make a test pass... report a production defect in the SUMMARY rather than fixing it here") and this defect's fix surface is `crates/pv-server`'s rekey path or `web/src`'s item-create client -- both production code, and root-causing a 120s hang under real WAL/WS state is a debugging-plan-sized task on its own, not a same-plan fix.
- **Recorded:** WINDOWS.md entry 10 (`kind: deviation`, `phase: 26`, `file: web/e2e/sharing.spec.ts`, `status: open`).

---

**Total deviations:** 0 Rule 1-4 auto-fixes; 1 new production defect discovered and explicitly left unfixed per this plan's own scope constraint.
**Impact on plan:** No scope creep -- the two named fix groups (A, B) are complete and verified; the newly-discovered defect is documented, reproducible, and tracked for a future plan/debug session rather than silently absorbed or papered over.

## Issues Encountered

- The full e2e suite could not be run green end-to-end in this session -- see the new-defect deviation above. All 5 originally-named failing specs (the actual scope of this plan) are fixed and verified passing, both individually and as part of the full suite.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- The 5 originally-failing specs named in this plan's objective are fixed, committed, and verified passing (both isolated re-runs and as part of two full-suite `--retries=0` runs).
- The 4 previously cascade-skipped `invite-flow.spec.ts` tests now execute and pass -- nothing is left in "did not run".
- WINDOWS.md entries 4, 5, 6 are closed. A new entry (10) tracks the order-dependent hang discovered while verifying this plan's own fix -- **this should block `gsd-ship`** (per WINDOWS.md's own stated contract: it blocks while `open_count > 0`) until a future plan investigates and either fixes the rekey/item-create interaction or documents why it's safe to waive.
- Full-suite counts as observed (reproduced twice, identical both times): **17 passed / 2 failed / 0 skipped**, out of 19 total. The 2 failures are `sharing.spec.ts`'s WR-09 and Backstop #6 tests, both attributable to WINDOWS #10, not to anything touched by this plan.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: order-dependent-defect | `web/e2e/sharing.spec.ts` / `crates/pv-server` (rekey path, unconfirmed) | Newly discovered: `delete-account.spec.ts`'s member-self-deletion test's real server-side collection re-key leaves the server/DB in a state that hangs a completely unrelated later test's real-browser item creation for the full 120s timeout, for two brand-new accounts with zero relation to the deleted member's family. This was NEVER exercised before this plan's Group A fix (the test always 422'd before reaching the rekey code). If the underlying cause is a genuine server-side lock/contention bug in the rekey transaction (one candidate, unconfirmed) rather than a pure test-harness artifact, it could indicate a production availability issue under concurrent collection-membership churn -- flagged here so it is visible at ship time rather than silently reordered away. Tracked as WINDOWS.md entry 10, `status: open`. |

## Self-Check: PASSED

- FOUND: web/e2e/delete-account.spec.ts
- FOUND: web/e2e/remove-member.spec.ts
- FOUND: web/e2e/invite-flow.spec.ts
- FOUND: .planning/WINDOWS.md
- FOUND commit 0e01b6d in git log
- FOUND commit d82d893 in git log
- FOUND commit 6a8e79a in git log

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 13a*
*Completed: 2026-08-06*
