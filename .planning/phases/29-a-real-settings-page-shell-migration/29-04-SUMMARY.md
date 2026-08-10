---
phase: 29-a-real-settings-page-shell-migration
plan: 04
subsystem: testing
tags: [playwright, e2e, live-proof, nextjs, settings]

requires:
  - phase: 29-a-real-settings-page-shell-migration
    provides: "Real /settings route with settings-section-family/settings-back-to-vault testids (Plan 29-01)"
  - phase: 29-a-real-settings-page-shell-migration
    provides: "The old drawer (SettingsPanel.tsx, settings-tab-*/settings-close/settings-panel) deleted outright; Sidebar's gear is a real <Link href=\"/settings\"> (Plan 29-03)"
provides:
  - "openFamilyTab (sharing.spec.ts, invite-flow.spec.ts, remove-member.spec.ts, delete-account.spec.ts) navigates via page.url() idempotency check instead of a torn-down settings-panel testid, and no longer clicks the retired tab"
  - "returnToVault (renamed from closeSettings, sharing.spec.ts/remove-member.spec.ts/delete-account.spec.ts) navigates back via settings-back-to-vault and waits for new-item-button"
  - "openAccountSection (renamed from openSecurityTab, delete-account.spec.ts) follows the delete-account trigger to its Plan 29-01 relocated home (Konto), dropping the retired settings-tab-security click"
affects: [29-05]

tech-stack:
  added: []
  patterns:
    - "e2e navigation-helper idempotency check via page.url().includes(\"/settings\") instead of probing a drawer testid's visibility -- correct now that /settings is a real route, not a conditionally-mounted panel"

key-files:
  modified:
    - web/e2e/sharing.spec.ts
    - web/e2e/invite-flow.spec.ts
    - web/e2e/remove-member.spec.ts
    - web/e2e/delete-account.spec.ts

key-decisions:
  - "Resolved the grep-vs-JSDoc false-positive risk by rewording every doc comment that used to name the retired testids (settings-tab-family, settings-panel, settings-close, settings-tab-security) instead of widening the exclusion pattern -- the plan's own guidance preferred this, and it keeps the grep guard strict for any FUTURE regression rather than punching a permanent hole in it."
  - "A prior executor attempt left an in-progress patch to sharing.spec.ts only (preserved at scratchpad/29-04-partial-sharing-spec.patch). Its code changes (openFamilyTab body, closeSettings->returnToVault rename, wait targets) were correct and were reproduced independently here, but its doc comments were NOT copied verbatim -- they quoted `settings-tab-family` inside a JSDoc block, which would have failed the Task 1 grep guard (':\\s*//' only strips // line comments, not '*'-prefixed block-comment lines). Rewritten from scratch to describe the retired mechanism without naming its dead identifiers."
  - "closeSettings -> returnToVault and openSecurityTab -> openAccountSection renamed per-file, matching this codebase's established per-file-owns-its-own-tiny-helper convention (each of the four files keeps its own independent copy, none exported)."

patterns-established: []

requirements-completed: [SET-02]

coverage:
  - id: D1
    description: "Every live e2e flow that previously reached Family & Sharing or account deletion through the old settings drawer reaches the same real content through /settings after the cutover -- no e2e regression, proven live."
    requirement: "SET-02"
    verification:
      - kind: e2e
        ref: "web/e2e/sharing.spec.ts, web/e2e/invite-flow.spec.ts, web/e2e/remove-member.spec.ts, web/e2e/delete-account.spec.ts (all 16 tests, single combined run)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The delete-account trigger is found by delete-account.spec.ts at its NEW home (Konto section via openAccountSection), not its old one (Security tab)."
    requirement: "SET-02"
    verification:
      - kind: e2e
        ref: "web/e2e/delete-account.spec.ts (both tests, owner-dissolution and member-self-delete branches)"
        status: pass
    human_judgment: false
  - id: D3
    description: "No tab-click choreography survives in any of the four fixed helpers -- zero references to the retired settings-tab-family/settings-tab-security/settings-panel/settings-close identifiers remain."
    requirement: "SET-02"
    verification:
      - kind: other
        ref: "grep -rn 'closeSettings|settings-close|settings-tab-family|settings-tab-security|settings-panel|openSecurityTab' web/e2e/{sharing,invite-flow,remove-member,delete-account}.spec.ts -> zero matches"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-08-10
status: complete
---

# Phase 29 Plan 04: Live E2E Settings Navigation Repair Summary

**Repaired the settings-navigation helpers duplicated across four live Playwright specs (sharing, invite-flow, remove-member, delete-account) so they reach Family & Sharing and account deletion through the real `/settings` route instead of the retired drawer+tab mechanism -- all 16 assertions preserved verbatim, all pass live.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2/2 complete
- **Files modified:** 4

## Accomplishments

- `openFamilyTab` (four independent per-file copies, one per spec) no longer clicks the retired `settings-tab-family` element -- it checks `page.url().includes("/settings")` to decide whether navigation is still needed, then relies on the family section already rendering unconditionally once the route loads.
- `closeSettings` renamed to `returnToVault` in the three files that had it (`sharing.spec.ts`, `remove-member.spec.ts`, `delete-account.spec.ts`) -- clicks the real `settings-back-to-vault` link and waits for `new-item-button`, mirroring this codebase's own `reloadAndUnlock` helper's post-navigation wait target, replacing a wait on the now-nonexistent `settings-panel` detaching.
- `delete-account.spec.ts`'s `openSecurityTab` renamed to `openAccountSection`, following the delete-account trigger to its Plan 29-01 relocated home (Konto, not Security) -- the trigger's own testid (`account-delete-trigger`) is unchanged, only its container moved, so the same `getByTestId` call finds it once `/settings` is reached.
- Zero remaining references to any of the five retired identifiers (`settings-tab-family`, `settings-tab-security`, `settings-panel`, `settings-close`, `openSecurityTab`) anywhere across the four files, including inside JSDoc comments -- every comment that used to name a retired identifier was reworded to describe the mechanism without quoting the dead literal, so the plan's grep guard (which only strips `//` line comments, not `*`-prefixed block-comment continuations) stays meaningfully strict rather than being widened to tolerate a false positive.
- All 16 tests across the four specs pass live against a fresh, isolated `pv-server` instance (Playwright's own ephemeral tmp-dir database, never the developer's `data/pv.db`), run once per task and once more combined as the plan's own overall `<verification>` step.

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix openFamilyTab/closeSettings in sharing.spec.ts, invite-flow.spec.ts, remove-member.spec.ts** - `1e162df` (fix)
2. **Task 2: Fix delete-account.spec.ts's openSecurityTab + its own openFamilyTab/closeSettings** - `5836252` (fix)

## Files Created/Modified

- `web/e2e/sharing.spec.ts` - `openFamilyTab` navigation-mechanism fix; `closeSettings` renamed to `returnToVault`
- `web/e2e/invite-flow.spec.ts` - `openFamilyTab` navigation-mechanism fix (this file has no `closeSettings`)
- `web/e2e/remove-member.spec.ts` - `openFamilyTab` navigation-mechanism fix; `closeSettings` renamed to `returnToVault`
- `web/e2e/delete-account.spec.ts` - `openFamilyTab` navigation-mechanism fix; `closeSettings` renamed to `returnToVault`; `openSecurityTab` renamed to `openAccountSection` and re-pointed at the Konto section

## Decisions Made

- **Reworded comments over widening the grep guard.** The plan's own unresolved question (does `grep -v -E ':\s*//'` correctly exclude `*`-prefixed JSDoc block-comment continuation lines that quote the retired identifiers?) was resolved by rewording every affected doc comment so it describes the retired mechanism in prose without naming `settings-tab-family`/`settings-panel`/`settings-close`/`settings-tab-security`/`openSecurityTab` as literal text. This was chosen over widening the grep exclusion pattern because it keeps the guard itself unchanged and strict -- a future regression that reintroduces one of these identifiers in actual code will still be caught, rather than the guard being permanently loosened to tolerate a category of comment it was never designed to parse.
- **Did not copy the prior attempt's `sharing.spec.ts` patch verbatim.** The patch at `scratchpad/29-04-partial-sharing-spec.patch` (preserved from a prior executor torn down by infrastructure errors, not by any problem with the work) got the code changes right -- the `openFamilyTab`/`returnToVault` bodies and wait targets it proposed are functionally identical to what was implemented here. However, its doc comments explicitly quoted `settings-tab-family` inside a JSDoc block (`` `settings-tab-family` `` `is retired`), which would have failed the Task 1 grep guard once applied to the actual file (the guard only strips `// `-prefixed line comments, not `*`-prefixed block-comment continuations). The comments were rewritten from scratch to convey the same information without naming the dead identifier; the code bodies matched closely enough that no independent redesign was needed.
- **Renamed helpers per-file, not shared.** `closeSettings`->`returnToVault` and `openSecurityTab`->`openAccountSection` were applied independently in each file that had them, consistent with this codebase's established per-file-owns-its-own-tiny-helper convention (confirmed by grep: `invite-flow.spec.ts` genuinely has no `closeSettings`, so it was left untouched for that helper).

## Deviations from Plan

None - plan executed exactly as written. The plan's own explicitly flagged open question (grep-guard vs. JSDoc block comments) was resolved per its own preferred resolution path (reword comments), documented above under Decisions Made rather than as a deviation, since the plan text anticipated and instructed this exact choice.

## Issues Encountered

None. Port 8620 was free before the live run (confirmed via `lsof -i :8620`); Playwright's own config provisions an isolated, ephemeral SQLite database per run (`PV_E2E_DB_DIR`), so the developer's real `data/pv.db` was never touched.

## Known Stubs

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All four live e2e specs (`sharing`, `invite-flow`, `remove-member`, `delete-account`) now navigate exclusively through the real `/settings` route, with zero remaining references to the drawer+tab mechanism Plan 29-03 retired.
- Plan 29-05 (Wave 4, sequenced strictly after this plan per this plan's own `<verification>` note) can now re-run these same four specs as part of its own closing sweep without hitting the navigation break this plan existed to fix.
- Plan 29-01's SUMMARY.md carried forward one open item -- a clean *visual* confirmation of the jump-nav (not just headless geometry) deliberately deferred to a live e2e run with a real unlocked session. This plan's live runs did exercise `/settings` with real unlocked sessions throughout (every `openFamilyTab`/`openAccountSection` call reaches the route post-unlock), but none of the four specs asserts on jump-nav visual layout specifically -- that visual confirmation, if still wanted, remains Plan 29-05's or a future plan's to close explicitly.

---
*Phase: 29-a-real-settings-page-shell-migration*
*Completed: 2026-08-10*

## Self-Check: PASSED

- All 4 modified files confirmed present on disk (`git status --short` shows clean tree post-commit, both commits contain exactly the expected files).
- Both task commit hashes (`1e162df`, `5836252`) confirmed present in `git log --oneline`.
- Live Playwright run, all four specs combined: 16/16 passed.
- Grep guard for all five retired identifiers (`closeSettings`, `settings-close`, `settings-tab-family`, `settings-tab-security`, `settings-panel`, `openSecurityTab`) across all four spec files: zero matches.
