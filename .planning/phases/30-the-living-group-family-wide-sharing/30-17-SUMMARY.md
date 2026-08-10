---
phase: 30-the-living-group-family-wide-sharing
plan: 17
subsystem: testing
tags: [playwright, e2e, live-crypto, family-sharing, account-deletion, rekey]

# Dependency graph
requires:
  - phase: 30-16
    provides: the live harness (assertRecipientDecrypts, member C/D identities, ensureNamedFamilySession) SC2/SC3 already proved
  - phase: 30-05
    provides: buildMemberRemovalBatch/removeMember/deleteAccount re-key orchestration this plan drives live
  - phase: 30-10
    provides: SharingOverviewPanel's family-wide block this plan's wrap-check exercises
provides:
  - Live, measured proof that share.familyWideTimingCaveat's two clauses (invite-carried, lazy-reseal) match what this suite itself drove -- with a hardcoded-literal falsification bar independent of the dictionary
  - Live positive-then-negative revocation proof for owner-initiated removal and FAM-10 self-deletion of a family-wide-flagged collection
  - Live proof of both remaining 30-UI-SPEC.md backstops (PL long-text wrap, genuine-decrypt-failure-never-mistaken-for-pending)
  - A real production fix: a plain member can now build their own self-deletion re-key batch without needing owner privilege
  - A precisely reproduced, documented, OPEN critical finding -- self-deletion cascade-deletes vault_items even when they are family-wide shared inside a surviving collection -- for a future phase to resolve
affects: [30-secure-phase, phase-30-uat, family-sharing-regressions, FAM-10-follow-up]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hardcoded-literal falsification bar: an assertion sourced from a LITERAL string, not from the dictionary via t(), so a dishonest dictionary edit cannot move both the UI and the assertion together"
    - "ensureUnlockedViaUI/ensureLockedViaUI: idempotent lock-state normalization for long-lived sessions reused across many serial test() blocks"
    - "isSelf explicit flag (never inferred via an extra me() call) to route client orchestration around an owner-only endpoint for the caller's own id, while leaving every other call site's tested behavior untouched"

key-files:
  created: []
  modified:
    - web/e2e/family-wide-sharing.spec.ts
    - web/src/lib/families/rekey.ts
    - web/src/components/settings/DeleteAccountDialog.tsx
    - web/src/components/settings/DeleteAccountDialog.test.tsx

key-decisions:
  - "Fixed the discovered 403 (member self-deletion always failed with real collection access) entirely client-side: resolveTargetCollectionIds sources the caller's own collections from GET /api/vault/collections (already self-service) instead of the owner-only GET /api/families/members/{id}/access, gated by an explicit isSelf flag the caller supplies -- zero authorization-model change, zero risk to the existing owner-only test (family.rs::owner_sees_per_member_access_breakdown)"
  - "Did NOT fix the second, more severe discovered bug (self-deletion cascade-deletes a family-wide-shared item the departing member created, even inside a surviving, freshly re-keyed collection) -- it is a schema/ownership decision (Rule 4), reverted an initial attempted fix once its blast radius became clear, and instead documented it precisely with a skipped, intact test and two WINDOWS.md entries"
  - "Committed as two commits (a production fix, then the whole test-file diff) rather than one commit per plan task -- the three tasks share helpers and a single interdependent live suite (SC5/Task1 reuses SC2's sharedItemId from an earlier test; a per-task split risked manual-patch-surgery errors on a fully-verified 700+ line diff late in a long session)"

requirements-completed: [FSH-04, FSH-05, FAM-10]

coverage:
  - id: D1
    description: "SC5 -- both clauses of the shipped familyWideTimingCaveat string measured against the live sequences that produce them, with a falsification bar proven to catch a dishonest edit"
    requirement: "FSH-05"
    verification:
      - kind: e2e
        ref: "web/e2e/family-wide-sharing.spec.ts#timing copy matches measurement: both familyWideTimingCaveat clauses are proven by this suite's own live sequences"
        status: pass
    human_judgment: false
  - id: D2
    description: "SC6 -- owner-initiated removal revokes family-wide access on the next completed sync, with a remaining member seeing the quiet re-key notice"
    requirement: "FSH-04"
    verification:
      - kind: e2e
        ref: "web/e2e/family-wide-sharing.spec.ts#revocation: a member REMOVED by the owner loses family-wide access on the next completed sync; a remaining member sees the quiet re-key notice"
        status: pass
    human_judgment: false
  - id: D3
    description: "SC6/FAM-10 -- account deletion triggers the same atomic re-key path as removal, proven positive-then-negative"
    requirement: "FAM-10"
    verification:
      - kind: e2e
        ref: "web/e2e/family-wide-sharing.spec.ts#revocation: an account DELETION (FAM-10) triggers the same re-key path as removal, proven positive-then-negative"
        status: pass
    human_judgment: false
  - id: D4
    description: "SC6 -- a member LEAVING the family (self-deletion, as the sharer of what they leave) -- BLOCKED by a genuine, newly-discovered data-loss bug; test intact and skipped, not weakened"
    requirement: "FSH-04"
    verification:
      - kind: e2e
        ref: "web/e2e/family-wide-sharing.spec.ts#revocation: a member LEAVES the family (self-deletion...) [test.skip]"
        status: fail
    human_judgment: true
    rationale: "The intended, correct test is blocked by a real production bug (vault_items.user_id's unconditional ON DELETE CASCADE) this plan is not positioned to fix (schema/ownership decision, Rule 4). A human must decide the fix and un-skip this test in a follow-up phase -- see WINDOWS.md entries #15/#16 and this SUMMARY's Deviations section."
  - id: D5
    description: "Two remaining 30-UI-SPEC.md backstops: PL long-text wrap (dialog caveat, overview caveat, re-key notice's 320px shell) and a genuine live decrypt failure never mistaken for a pending grant, with a falsification bar proven to catch a widened discriminant"
    verification:
      - kind: e2e
        ref: "web/e2e/family-wide-sharing.spec.ts#wraps cleanly: PL copy and the re-key notice never overflow their real rendered containers"
        status: pass
      - kind: e2e
        ref: "web/e2e/family-wide-sharing.spec.ts#a genuine decrypt failure on real ciphertext still renders through the existing undecryptable path, never the pending-family-key copy"
        status: pass
    human_judgment: false

# Metrics
duration: 75min
completed: 2026-08-11
status: complete
---

# Phase 30 Plan 17: Family-Wide Sharing -- SC5/SC6 Live Proof and Two Backstops Summary

**Live-measured SC5 timing-copy proof with a dictionary-independent falsification bar, positive-then-negative SC6 revocation for owner-removal and FAM-10 self-deletion, the two remaining 30-UI-SPEC.md backstops -- and, along the way, one real production bug fixed and one real, more severe production bug found, precisely reproduced, and left open with full documentation because fixing it is a schema decision outside this plan's authority.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-08-10T21:50:00Z
- **Completed:** 2026-08-10T23:04:00Z
- **Tasks:** 3/3 (all three plan tasks implemented; Task 2 has one of its three cases skipped, documented, not silently passing)
- **Files modified:** 4 (`family-wide-sharing.spec.ts`, `rekey.ts`, `DeleteAccountDialog.tsx`, `DeleteAccountDialog.test.tsx`)

## Accomplishments

- **SC5 proven live, with a falsification bar that actually falsifies.** Both clauses of `share.familyWideTimingCaveat` are measured against real sequences: the invite-carried clause (member H) is proven to resolve in well under one poll cycle with no pending row ever shown; the lazy-reseal clause is proven this time via the SHARER's own subsequent unlock (member I), the complementary half to 30-16's "another family member" proof, closing the WHOLE compound "you or another family member" actor set the shipped copy names. A hardcoded literal (never sourced from the dictionary) is what actually catches a dishonest edit -- verified live by temporarily changing the EN string to claim "instantly" and confirming the test goes red, then reverting.
- **SC6 proven live for two of its three cases.** Owner-initiated removal: positive anchor before, negative on the next completed sync after (no reload), plus the quiet re-key notice observed on a REMAINING member (never the actor). FAM-10 account deletion: positive anchor, then a 401 on the departing member's own previously-valid token proving the account and its session are genuinely gone.
- **The third case ("leave") found a real, severe, previously-undiscovered production bug instead of quietly passing.** Driving a NON-owner member's self-deletion as the ORIGINAL CREATOR of a family-wide-shared collection -- something no test in this codebase's history has ever done live -- revealed that `vault_items.user_id`'s unconditional `ON DELETE CASCADE` destroys the shared item the instant the departing member's account row is deleted, even though the collection survives with a correctly, freshly re-keyed `sealed_key` for every remaining member. This is the exact inverse of 30-CONTEXT.md's own locked decision ("leaving is not deletion -- you keep your own originals"). Proven live via a raw diagnostic request: `GET .../collections/{id}` -> 200 with a valid fresh `sealed_key`; `GET .../collections/{id}/items` -> 200 with an EMPTY array.
- **A second, smaller bug found on the way to the first, and fixed.** Building the "leave" test surfaced that ANY plain member's self-deletion via the real `DeleteAccountDialog` UI 403'd unconditionally (before even reaching the data-loss bug above) -- `buildMemberRemovalBatch(selfUserId, uk)` always called the owner-only `GET /api/families/members/{id}/access`. Fixed entirely client-side, with zero authorization-model change: an explicit `isSelf` flag routes the self-case through the already-self-service `GET /api/vault/collections` instead.
- **Both remaining 30-UI-SPEC.md backstops closed live**, each with falsification proven: the PL timing caveat (both required locations) and the re-key notice's fixed 320px shell never overflow their real rendered containers; a genuine, live-corrupted decrypt failure (a raw authenticated write of invalid ciphertext, mirroring `shared-sync.spec.ts`'s own established CR-03 pattern) renders through the existing `undecryptable-item-banner` path and never the pending-family-key copy -- falsified by temporarily broadening the row-level discriminant and confirming red, then reverting.
- **A stale-toggle-state bug in the shared `createFolderViaUI` test helper was fixed** (Rule 1): the folders sidebar panel is client-only toggle state that a prior test in this serial file can leave already-expanded; a blind click could collapse it instead of expanding it, hanging the next line for the rest of the test's timeout. Now checks the button's own visibility first.
- Final live run: **8 passed, 1 skipped (documented), 0 failed** -- `npx playwright test e2e/family-wide-sharing.spec.ts --retries=0`.

## Task Commits

1. **Task 1 + Task 2 + Task 3 (SC5, SC6, backstops)** - `52a5a8c` (test) -- see Deviations for why this is one commit covering all three plan tasks rather than three separate ones.
2. **The production fix this plan's own live suite required to prove FAM-10/case 3** - `1117919` (fix) -- committed BEFORE the test commit chronologically, but functionally belongs alongside Task 2.

_Note: both `test`/`fix` typed, matching this plan's live-proof-plus-one-real-fix shape._

## Files Created/Modified

- `web/e2e/family-wide-sharing.spec.ts` - SC5 (Task 1), SC6 revocation cases (Task 2, one skipped and documented), the two backstops (Task 3); plus shared-helper robustness fixes (`ensureUnlockedViaUI`/`ensureLockedViaUI`, `createFolderViaUI`'s toggle-state fix)
- `web/src/lib/families/rekey.ts` - `resolveTargetCollectionIds`/`isSelf` flag so a plain member's self-deletion no longer needs owner privilege
- `web/src/components/settings/DeleteAccountDialog.tsx` - passes `isSelf = true` at its one call site
- `web/src/components/settings/DeleteAccountDialog.test.tsx` - updated the existing assertion to the new 3-arg call

## Decisions Made

- The 403 self-deletion bug: fixed client-side (`isSelf` flag routing to the already-self-service `GET /api/vault/collections`), explicitly rejecting the alternative of loosening the owner-only `GET /api/families/members/{id}/access` guard server-side -- that endpoint has its OWN deliberately-tested, locked security decision (`family.rs::owner_sees_per_member_access_breakdown` asserts a plain member querying their own id there gets 403, never 200); changing it would have silently reversed a previously-shipped, intentionally-tested behavior from Phase 22 (FAM-03).
- The cascade-delete data-loss bug: NOT fixed. It requires a real architectural decision (detach a collection-scoped item's `user_id` before the cascade, mirroring `last_editor_user_id`'s own CR-01 precedent; or reassign ownership to a remaining recipient; or something else) that is outside this plan's file scope and this executor's authority to decide unilaterally. Documented instead: the test is committed INTACT (not weakened to a scenario that would merely avoid the bug) and marked `test.skip`, so it can be un-skipped the moment a real fix lands. Two WINDOWS.md entries record it (`#15` skipped-test, `#16` the underlying deviation, both `open`).
- Two commits instead of three (one per task): the three tasks share helpers and a single, genuinely interdependent live suite (Task 1's SC5 case reuses `sharedItemId` from a much earlier, already-committed test in the same file; running any later test via an isolated `-g` filter requires the earlier ones to have actually run first in the SAME invocation). Splitting the fully-verified 700+ line diff into three commits after the fact would have required manual patch surgery with real risk of silently corrupting a working, fully-tested state -- prioritized correctness over mechanical per-task granularity, and recorded this choice here rather than silently deviating from the stated convention.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `createFolderViaUI`'s blind toggle-click hung a long-lived session**
- **Found during:** Task 1 (SC5's own Part A, `owner.page` reused from earlier tests with no intervening navigation)
- **Issue:** `sidebar-nav-folders` toggles `Sidebar.tsx`'s local `foldersExpanded` state; a blind click assumed "always collapsed", which was true for 30-16's own three tests (each either ran first or was preceded by a `/settings` round trip that remounts `Sidebar`) but false here -- the click COLLAPSED an already-expanded panel, hiding `sidebar-new-folder-button` for the rest of the test's 600s timeout.
- **Fix:** Check `sidebar-new-folder-button`'s own visibility first; only click `sidebar-nav-folders` if it is not already visible.
- **Files modified:** `web/e2e/family-wide-sharing.spec.ts`
- **Verification:** Re-ran the full suite; Task 1 dropped from a 10-minute timeout to 4.5s.
- **Committed in:** `52a5a8c`

**2. [Rule 1 - Bug] Passive recipients never discover a brand-new collection without an explicit relock/unlock**
- **Found during:** Task 2 case 1 and case 2, and Task 3's wrap-check
- **Issue:** `collections.ts::refreshCollectionsNow()` fires only on the sharer's own submit, an unlock transition, or the pending/reseal path -- never on a passive recipient's ambient poll alone. Three of this plan's own new assertions (owner reading what a NON-owner sharer shared; a remaining member C; a remaining member D) put a passive, already-open, never-since-relocked session in exactly that gap.
- **Fix:** Added an explicit `relockAndUnlock` immediately before each such assertion.
- **Files modified:** `web/e2e/family-wide-sharing.spec.ts`
- **Verification:** Re-ran the full suite; all three affected assertions now resolve within seconds instead of timing out at 90s.
- **Committed in:** `52a5a8c`

**3. [Rule 1 - Bug] A causality race in SC5's own gap-window clause**
- **Found during:** Task 1, self-review before the first live run
- **Issue:** The owner (the deliberate resealer for this clause) was locked AFTER the newcomer joined, leaving a window where the owner's own ambient poll -- not the intended deliberate unlock -- could have been the actual (coincidental) cause of resolution.
- **Fix:** Reordered so the owner is locked alongside every other keyholder BEFORE the newcomer joins, mirroring 30-16's own proven gap-window discipline.
- **Files modified:** `web/e2e/family-wide-sharing.spec.ts`
- **Verification:** Confirmed via the explicit before/after timestamp assertions the test itself makes.
- **Committed in:** `52a5a8c`

**4. [Rule 1 - Bug] An uncontrolled extra keyholder in SC5's own gap-window clause**
- **Found during:** Task 1, live run
- **Issue:** Member H (clause 1's newcomer) was left open and unlocked into clause 2, making H an uncontrolled extra keyholder for clause 2's brand-new collection (H would receive it via ordinary fan-out) -- undermining the "the deliberate unlock is the cause" claim.
- **Fix:** Close H's browser context after clause 1's assertions, before clause 2 begins.
- **Files modified:** `web/e2e/family-wide-sharing.spec.ts`
- **Verification:** Re-ran; clause 2 now correctly shows the pending row before, and resolves only after, the deliberate unlock.
- **Committed in:** `52a5a8c`

**5. [Rule 3 - Blocking issue] Plain-member self-deletion 403'd unconditionally via the real UI**
- **Found during:** Task 2 case 1 (and would have blocked case 3/FAM-10 identically)
- **Issue:** `buildMemberRemovalBatch(selfUserId, uk)` always called the owner-only `GET /api/families/members/{id}/access`, which `FamilyMembership<RequireEdit>`-gates. A plain member querying about THEMSELVES got 403, unconditionally, blocking the entire self-deletion flow (FAM-10) via the real UI for any member with real collection/item access.
- **Fix:** Added an explicit `isSelf` flag; the self-case now sources its collection list from the already-self-service `GET /api/vault/collections` instead. The owner-removes-someone-else path is byte-identical to before.
- **Files modified:** `web/src/lib/families/rekey.ts`, `web/src/components/settings/DeleteAccountDialog.tsx`, `web/src/components/settings/DeleteAccountDialog.test.tsx`
- **Verification:** Full unit suite (92 files / 964 tests) passes; live suite's FAM-10 case (case 3) now passes end to end, including a 401 on the deleted account's own prior token.
- **Committed in:** `1117919`

---

**Total deviations:** 5 auto-fixed (4 Rule 1 bugs, 1 Rule 3 blocking issue), plus 1 genuine finding deliberately NOT auto-fixed (see below).
**Impact on plan:** All five auto-fixes were necessary for the live suite to run and pass at all; none expanded scope beyond making this plan's own tasks provable. The one deliberately-unfixed finding is flagged, not hidden -- see below.

### Not Auto-Fixed -- Rule 4 (Architectural Decision Required)

**[Rule 4] Self-deletion cascade-deletes a family-wide-shared item the departing member created, even inside a surviving, freshly re-keyed collection**

- **Found during:** Task 2 case 1 ("a member LEAVES the family")
- **What was found:** `vault_items.user_id REFERENCES users(id) ON DELETE CASCADE` is unconditional. `delete_account_as_member` correctly re-keys every collection the departing member could reach (fresh `sealed_key` for every remaining recipient, every item's `enc_key` rewrapped) but never detaches or reassigns `user_id` on an item inside a SURVIVING collection before `DELETE FROM users` cascades. Proven live: after E (a plain member, the original creator of a family-wide-shared folder) self-deletes, `GET /api/vault/collections/{id}` returns 200 with a valid, freshly re-keyed `sealed_key`, but `GET /api/vault/collections/{id}/items` returns 200 with an EMPTY array -- the re-key work is real but wasted; the content it just re-sealed for everyone else is gone a few statements later, in the same request.
- **Why not fixed here:** This is the exact inverse of 30-CONTEXT.md's own locked decision ("leaving is not deletion -- you keep your own originals"). Fixing it correctly needs a real ownership/schema decision (detach `user_id` before the cascade, mirroring `last_editor_user_id`'s own CR-01 precedent; reassign to a remaining recipient; or another approach entirely) -- this plan's file scope is a single e2e spec file, and this executor is not positioned to make that call unilaterally (an early attempt to patch the ADJACENT, smaller 403 bug by loosening a DIFFERENT endpoint's authorization was itself reverted after discovering it would have silently reversed a separately-tested, locked FAM-03 decision -- see Decisions Made above for that full reasoning).
- **Impact:** FAM-10/FSH-04's "leave" case, as specifically defined by 30-CONTEXT.md (the leaving member is the SHARER, not merely a recipient), cannot currently be proven true against this build -- because it is not true. The test is committed INTACT and `test.skip`ped, not weakened to a scenario that would silently avoid the bug.
- **Action needed:** A future phase must make the ownership decision and land a fix; then un-skip `web/e2e/family-wide-sharing.spec.ts`'s "a member LEAVES the family" test, which will prove the fix live once it exists.
- **Tracked in:** `.planning/WINDOWS.md` entries #15 (skipped-test) and #16 (deviation, `open`).

## Issues Encountered

None beyond the deviations documented above -- every issue this session hit was either auto-fixed (Rules 1/3) or is the one deliberately-unfixed, precisely-documented finding (Rule 4).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- FSH-05 (SC5) and two of FSH-04/FAM-10's three SC6 cases are now proven live, closing this phase's remaining quality gate for everything except the one open finding below.
- **A real, open, high-severity defect blocks full closure of FSH-04's "leave" case**: self-deletion destroys family-wide-shared content the departing member created, contradicting the phase's own locked decision. This needs a dedicated follow-up (likely a small, focused plan of its own: decide the ownership model, implement, then un-skip the intact test this plan left in place). Flagged in `.planning/WINDOWS.md` (#15, #16) so `/gsd-ship` sees it.
- `web/e2e/family-wide-sharing.spec.ts` is now the complete standing live-proof suite for Phase 30's family-wide sharing mechanism (30-16's SC2/SC3 plus this plan's SC5/SC6/backstops) and will run on every future CI invocation of `web/playwright.config.ts`.
- The `isSelf`-flag fix in `rekey.ts`/`DeleteAccountDialog.tsx` is a real, shipped correctness fix -- plain-member self-deletion with real collection access now works via the actual UI for the first time in this codebase's history (for members whose self-deletion doesn't ALSO trip the cascade-delete finding above, i.e. members who are recipients but not the original creator of what gets destroyed).

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-11*

## Self-Check: PASSED

- FOUND: `web/e2e/family-wide-sharing.spec.ts`
- FOUND: `web/src/lib/families/rekey.ts`
- FOUND: `web/src/components/settings/DeleteAccountDialog.tsx`
- FOUND: `web/src/components/settings/DeleteAccountDialog.test.tsx`
- FOUND: `.planning/phases/30-the-living-group-family-wide-sharing/30-17-SUMMARY.md`
- FOUND: `.planning/WINDOWS.md`
- FOUND commit: `1117919` (fix)
- FOUND commit: `52a5a8c` (test)
- Live run this session: `npx playwright test e2e/family-wide-sharing.spec.ts --retries=0` -> 8 passed, 1 skipped (documented), 0 failed (59.2s), against an isolated `PV_E2E_DB_DIR` tmp-DB server, port 8620 confirmed free before each run.
- Unit suite: `npx vitest run` -> 92 files / 964 tests passed after the production fix.
- Both required falsifications performed live and confirmed: SC5's hardcoded-literal bar (edited the EN dictionary string to claim "instantly", confirmed red, reverted, confirmed green); Task 3's decrypt-failure discriminant (widened `pendingFamilyKey === true` to also catch `undecryptable === true`, confirmed red, reverted, confirmed green).
