---
phase: 29-a-real-settings-page-shell-migration
plan: 06
subsystem: testing
tags: [vitest, playwright, react-testing-library, intersection-observer, i18n, gap-closure]

requires:
  - phase: 29-01
    provides: "SettingsSectionData.tsx, SettingsJumpNav.tsx (the two components this plan writes test successors for)"
  - phase: 29-03
    provides: "The two false verification claims corrected in this plan"
provides:
  - "SettingsSectionData.test.tsx: the verbatim unit successor to SettingsPanel.test.tsx's deleted Import/Export CTA wiring test (SET-02)"
  - "SettingsJumpNav.test.tsx's scroll-spy adjacency describe block: proves the exactly-one-active invariant with real synthetic IntersectionObserver entries (SET-04)"
  - "web/e2e/settings-jumpnav-labels.spec.ts: retained, CI-wired live Playwright proof of the PL jump-nav label-fit backstop (SET-04)"
  - "29-03-PLAN.md's two false verification claims corrected in place, scoped to what is actually true"
affects: [29-VERIFICATION-followup]

tech-stack:
  added: []
  patterns:
    - "Capturing an IntersectionObserver constructor's callback argument on a static class field to drive a component's internal scroll-spy state directly from a unit test, when the component exposes no other hook into that state"
    - "act() wrapping required around a directly-invoked React state-setter callback (not routed through a testing-library helper) so the resulting re-render is flushed before the next assertion reads the DOM"
    - "Live Playwright as the only honest lane for real-layout claims (scrollWidth/clientWidth/getBoundingClientRect height) -- jsdom returns 0 for all of these regardless of content, making a jsdom version of a clipping assertion a fake backstop"

key-files:
  created:
    - web/src/components/settings/SettingsSectionData.test.tsx
    - web/e2e/settings-jumpnav-labels.spec.ts
  modified:
    - web/src/components/settings/SettingsJumpNav.test.tsx
    - .planning/phases/29-a-real-settings-page-shell-migration/29-03-PLAN.md

key-decisions:
  - "Task 1's export-CTA test is a deliberate duplicate of live coverage (export-disclosure.spec.ts:295) -- SC2's own reconciliation table already treats 'proven live only' as a downgrade from 'proven at both levels', so this closes that gap for the export half too, not only the import half 29-VERIFICATION.md named as unproven-by-anything."
  - "act() import added to SettingsJumpNav.test.tsx: driving the captured IntersectionObserver callback directly (not via fireEvent) does not auto-flush React's resulting re-render: without act(), the very next activeLinkTexts() read observed stale DOM. This is a real finding, not a plan deviation -- the plan's own action text did not anticipate this act() requirement, but flagging it here per the plan's spirit of stating exactly how each assertion works."

patterns-established:
  - "CallbackCapturingIntersectionObserver: a static-field-based capture pattern for reaching component-internal state driven by a non-injectable, self-constructed browser API"

requirements-completed: [SET-02, SET-04]

coverage:
  - id: D1
    description: "SettingsSectionData.test.tsx exists and proves settings-import-cta -> ImportWizard mount/unmount and settings-export-cta -> ExportDialog mount/unmount at unit level -- the verbatim successor to SettingsPanel.test.tsx's deleted CTA wiring test"
    requirement: "SET-02"
    verification:
      - kind: unit
        ref: "web/src/components/settings/SettingsSectionData.test.tsx#clicking settings-import-cta mounts ImportWizard; its onDone unmounts it"
        status: pass
      - kind: unit
        ref: "web/src/components/settings/SettingsSectionData.test.tsx#clicking settings-export-cta mounts ExportDialog; its onClose unmounts it"
        status: pass
    human_judgment: false
  - id: D2
    description: "SettingsJumpNav.test.tsx's scroll-spy adjacency describe block proves exactly one jump-nav link is ever active: Konto at scroll-top, the straddled section after a real intersection entry fires, and the previous section again when a callback fires with nothing intersecting"
    requirement: "SET-04"
    verification:
      - kind: unit
        ref: "web/src/components/settings/SettingsJumpNav.test.tsx#SettingsJumpNav scroll-spy adjacency (SET-04)"
        status: pass
    human_judgment: false
  - id: D3
    description: "web/e2e/settings-jumpnav-labels.spec.ts is a retained, CI-wired live Playwright spec proving all four PL jump-nav labels render without clipping at 375px and inside the 200px desktop rail"
    requirement: "SET-04"
    verification:
      - kind: e2e
        ref: "web/e2e/settings-jumpnav-labels.spec.ts#all four Polish jump-nav labels render without clipping at 375px and inside the 200px desktop rail"
        status: pass
    human_judgment: false
  - id: D4
    description: "29-03-PLAN.md's two false verification claims (the unscoped role=tablist grep, and the false 'already re-proven by settings/page.test.tsx' claim) are corrected in place, scoped to what is actually true, without touching SharingOverviewPanel.tsx"
    requirement: "SET-02"
    verification:
      - kind: other
        ref: "git diff --stat .planning/phases/29-a-real-settings-page-shell-migration/29-03-PLAN.md (3 lines changed, frontmatter boundaries intact); rescoped grep re-run and confirmed zero matches"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-08-10
status: complete
---

# Phase 29 Plan 06: Gap Closure -- Import/Export CTA Wiring, Scroll-Spy Adjacency, PL Label-Fit Backstop, Plan Corrections Summary

**Restores SC2's "no test deleted or weakened" guarantee: a real unit successor for the deleted Import/Export CTA wiring test, a real synthetic-IntersectionObserver-driven proof of the jump-nav scroll-spy exactly-one-active invariant, a retained live Playwright spec replacing an unretained ad-hoc PL-label measurement, and two false verification claims in 29-03-PLAN.md corrected in place.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 3/3 complete
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `SettingsSectionData.test.tsx` (new) proves both `settings-import-cta` -> `ImportWizard` and `settings-export-cta` -> `ExportDialog` mount/unmount at unit level -- the verbatim successor to `SettingsPanel.test.tsx`'s deleted "replaces the Phase 3 placeholder with working Import/Export CTAs..." test. Falsified manually against a stubbed `onClick`: the mount assertion goes red exactly as designed.
- `SettingsJumpNav.test.tsx` gains a second `describe` block that captures the component's real `IntersectionObserver` constructor callback and drives it with synthetic entries, proving: Konto is the sole active link at scroll-top before any entry fires; a straddled-section entry activates exactly that link, deactivating the previous one; and a callback firing with nothing intersecting leaves the previous link active (never zero). Falsified manually against two real regressions in the component (callback never updating `activeSlug`; callback clearing `activeSlug` on null intersection) -- both new tests went red as expected, then the component was reverted.
- `web/e2e/settings-jumpnav-labels.spec.ts` (new) is a retained, CI-wired live Playwright spec replacing 29-01-PLAN.md's ad-hoc, unretained PL-label geometry measurement. Measures real Chromium `scrollWidth`/`clientWidth`/`getBoundingClientRect()` height at both 1280px and 375px viewports in `pl`. Falsified manually against a real clipping regression (temporarily truncated a link to 40px) -- the spec caught it and failed as expected, then the component was reverted.
- `29-03-PLAN.md`'s two false verification claims (29-VERIFICATION.md gaps 1 and 4) are corrected in place: the unscoped `role="tablist"` grep claim (false -- `SharingOverviewPanel.tsx` retains these strings, pre-existing Phase 28, out of scope) and the "already re-proven by `settings/page.test.tsx`" claim (false -- that file never references either CTA testid). Both corrections are dated, scoped edits to exactly the three named strings; `git diff --stat` confirms no other line in that file changed.

## Task Commits

Each task was committed atomically:

1. **Task 1: SettingsSectionData.test.tsx -- the lost Import/Export CTA wiring assertion, restored** - `25b610a` (test)
2. **Task 2: SettingsJumpNav.test.tsx -- prove the scroll-spy exactly-one-active invariant** - `4b79e7e` (test)
3. **Task 3: Live jump-nav PL-label geometry spec, and correct 29-03-PLAN.md's two false verification claims** - `3aeb175` (test)

## Files Created/Modified

- `web/src/components/settings/SettingsSectionData.test.tsx` (new) - unit test proving both Data CTAs' mount/unmount wiring; verbatim successor to a deleted `SettingsPanel.test.tsx` assertion
- `web/src/components/settings/SettingsJumpNav.test.tsx` (modified) - gains `CallbackCapturingIntersectionObserver`, `fireIntersection`, `activeLinkTexts` helpers and a 3-test `describe("SettingsJumpNav scroll-spy adjacency (SET-04)")` block; the pre-existing WR-08 scoping class/test is untouched
- `web/e2e/settings-jumpnav-labels.spec.ts` (new) - live Playwright spec measuring real Chromium layout for all four PL jump-nav labels at desktop and mobile viewports
- `.planning/phases/29-a-real-settings-page-shell-migration/29-03-PLAN.md` (modified) - three `verification:`/acceptance-criteria strings corrected, dated 2026-08-10; nothing else in the file touched

## Decisions Made

- The export-CTA test in Task 1 is a deliberate duplicate of coverage that already exists live (`export-disclosure.spec.ts:295`) -- intentional per SC2's own reconciliation table, which already treats "proven live only" as a downgrade from "proven at both levels" for the sibling PasskeysTab/SessionsTab cases.
- `act()` (from `@testing-library/react`) was added around the captured-callback invocation in `SettingsJumpNav.test.tsx`. Driving `setActiveSlug` by calling the captured constructor callback directly -- outside any testing-library helper that auto-wraps state updates -- left React's resulting re-render unflushed, so the very next `activeLinkTexts()` read observed stale DOM (tests 2 and 3 initially failed with "expected settings.groupData, received settings.groupAccount" even though the real behavior was correct). This is a real finding surfaced during execution, not anticipated by the plan's action text -- documented here per the plan's own standard of stating exactly how each assertion works.

## Deviations from Plan

None -- plan executed exactly as written. The `act()` addition above is a technical necessity for the plan's own specified test shape to work correctly, not a scope change; it does not add, remove, or weaken any assertion the plan called for.

### Falsifiability -- how each new/replaced assertion was confirmed to actually discriminate

Per this plan's own "why this plan exists" standard (a test that only passes is not evidence), each new test was manually run against a real regression in the corresponding component, confirmed red, then the component was reverted via `git checkout --` (confirmed clean via `git diff --stat` before and after):

1. **SettingsSectionData.test.tsx test 2** (`clicking settings-import-cta mounts ImportWizard...`) -- stubbed out the `onClick` handler on `settings-import-cta`. Result: test 2 failed (`mock-import-wizard` element not found), tests 1 and 3 stayed green. Confirms the assertion is load-bearing on the real wiring, not a shallow render check.
2. **SettingsJumpNav.test.tsx test 2** (`an entry marking one straddled section intersecting activates exactly that link...`) -- replaced the component's `IntersectionObserver` callback with a no-op. Result: tests 2 and 3 failed (activeSlug never left `"konto"`), test 1 stayed green (it asserts the pre-interaction state, which a broken callback doesn't affect).
3. **SettingsJumpNav.test.tsx test 3** (`a callback firing with nothing intersecting leaves the previously active link active...`) -- changed the component to reset `activeSlug` to `""` whenever no entry intersects (a real, plausible regression shape). Result: test 3 failed (`activeLinkTexts()` returned `[]` instead of `["settings.groupData"]`), tests 1 and 2 stayed green.
4. **settings-jumpnav-labels.spec.ts** -- added `truncate max-w-[40px] overflow-hidden` to every jump-nav link's className (a real clipping regression). Result: the spec failed with `label "Konto" at desktop 1280px rail: scrollWidth (62) must equal clientWidth (40)`, exactly the failure mode the spec exists to catch.

All four regressions were reverted via `git checkout -- <file>` immediately after confirming red, and the corresponding suite was re-run green before moving to the next task. `git status --short web/` was clean (only intended new/modified test files staged) at every commit point.

## Known Debt (Not Fixed)

Per this plan's explicit instruction, both of the following pre-existing items are recorded, not fixed:

1. `settings.importExportPlaceholder` (`web/src/lib/i18n/dictionary.ts:624`) is an orphaned i18n key with zero call sites -- pre-existing since Phase 6, not introduced by Phase 29.
2. `web/src/lib/vault/store.ts:1385-1400` -- if the shared item pipeline keeps failing with a non-404 error, `sharedConfirmed` never becomes true, so `hydrated` never becomes true, so `export-confirm` stays disabled for the rest of the session. The code comment claims a later background poll recovers from this; no test asserts that recovery. This is a deliberate fail-closed choice (better than a false zero-count), but the recovery half is prose-only -- flagged as debt for a future phase.

## Issues Encountered

None beyond the `act()` finding documented above under Decisions Made.

## Known Stubs

None.

## User Setup Required

None -- no external service configuration required.

## Full Verification Re-Run (per this plan's `<verification>` block)

- `cd web && npx vitest run src/components/settings/SettingsSectionData.test.tsx src/components/settings/SettingsJumpNav.test.tsx` -- 2 files, 7 tests, all green.
- `cd web && npm test` (full suite) -- **844 tests / 83 files, 0 failed** (up from the 838/82 baseline: +3 SettingsSectionData.test.tsx, +3 SettingsJumpNav.test.tsx, +1 file). Arithmetic matches the plan's own prediction exactly.
- `cd web && npx playwright test e2e/settings-jumpnav-labels.spec.ts` -- 1 passed.
- `cd web && rm -rf out && npm run build` -- all 4 routes `○ (Static)`; `out/settings.html`, `out/settings.txt`, `out/settings/` (6 files) all present.
- `.planning/phases/29-a-real-settings-page-shell-migration/29-03-PLAN.md` still parses as valid frontmatter (`grep -c '^---$'` = 2); `git diff --stat` confirms exactly the three targeted corrections changed, nothing else.
- Live-run hazard check: port 8620 was free before this session's Playwright run (Playwright's own config mints an isolated tmp SQLite DB per run, per `web/playwright.config.ts`'s `PV_E2E_DB_DIR` mechanism); `data/pv.db` (Bartek's real dev database) was untouched -- confirmed unchanged mtime, no git-tracked delta.

## Next Phase Readiness

- All four 29-VERIFICATION.md gaps are closed. A re-verification pass of Phase 29 should now find SC2 fully satisfied (no test deleted or weakened, both CTA wiring halves proven at unit level), SET-04's scroll-spy adjacency proven with real synthetic entries, and the PL-label backstop upgraded from `insufficient_spec` to a retained, re-runnable live spec.
- The two debt items recorded above (orphaned i18n key, `store.ts` poll-recovery test gap) remain open for a future phase -- neither blocks Phase 29's closure.

---
*Phase: 29-a-real-settings-page-shell-migration*
*Completed: 2026-08-10*

## Self-Check: PASSED

- `web/src/components/settings/SettingsSectionData.test.tsx` -- FOUND
- `web/e2e/settings-jumpnav-labels.spec.ts` -- FOUND
- `web/src/components/settings/SettingsJumpNav.test.tsx` -- FOUND (modified)
- `.planning/phases/29-a-real-settings-page-shell-migration/29-03-PLAN.md` -- FOUND (modified)
- Commit `25b610a` -- FOUND in `git log --oneline`
- Commit `4b79e7e` -- FOUND in `git log --oneline`
- Commit `3aeb175` -- FOUND in `git log --oneline`
- Full vitest suite: 844/844 green, 83 files
- `npm run build`: exits 0, TypeScript clean, produces `out/settings.html` / `out/settings.txt` / `out/settings/`
