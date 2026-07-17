---
phase: quick-260718-0qi
plan: 1
subsystem: ui
tags: [extension, popup, daisyui, tailwind, playwright, e2e, theme]

requires:
  - phase: 13-dual-browser-hardening
    provides: Phase 9-12 Chromium e2e harness (dual-browser.spec.ts), the sheet-look popup restyle this plan corrects
provides:
  - Popup top bar pixel-parity with web Sidebar/TopBar (bg-base-200/text-base-content)
  - Floating "+" new-item FAB restored outside the footer's DOM subtree
  - Footer rebalanced to gear-only (left) + auto-lock-only (right)
  - "Full screen" pill relocated to the top bar beside the title
  - Row hover with no drop-shadow (inset-ring only)
  - "All items"/"Wszystkie" heading + sort select on one line at body-text scale
  - Phase 9 Chromium e2e group (P9-SC1..SC7) repaired to green
affects: [extension-popup, e2e-dual-browser]

tech-stack:
  added: []
  patterns:
    - "Popup top-bar/footer chrome reuses the SAME daisyUI token pairing as web/'s Sidebar.tsx/TopBar.tsx (bg-base-200/text-base-content) rather than a theme-invariant hand-picked pairing"
    - "data-testid=popup-footer/popup-fab as stable structural anchors for both vitest DOM assertions and future e2e selectors"

key-files:
  created: []
  modified:
    - extension/entrypoints/popup/ItemListView.tsx
    - extension/entrypoints/popup/ItemListView.test.tsx
    - extension/entrypoints/popup/style.css
    - extension/e2e/dual-browser.spec.ts

key-decisions:
  - "Task 2's FAB relocation to bottom-right also required flipping the type-menu's anchor from left-0 to right-0 (Rule 1 bug fix) -- with the FAB now at the popup's right edge, a left-0-anchored w-44 menu would overflow past the 380px popup width"
  - "P9-SC5/SC7's failures were NOT independent bugs -- both were downstream cascades of P9-SC2's ambiguous-select strict-mode violation leaving the shared worker-scoped popup on the wrong screen; fixing the Step 2 root cause alone restored all 7 SCs, confirmed via 3 separate full-project re-runs with zero flake"

requirements-completed: [EXT-04, EXT-06]

coverage:
  - id: D1
    description: "Popup top bar (title + search) uses bg-base-200/text-base-content, pixel-parity with web Sidebar/TopBar in both themes"
    requirement: "EXT-06"
    verification:
      - kind: unit
        ref: "grep -c 'bg-base-200 px-4 pb-3 pt-3 text-base-content' entrypoints/popup/ItemListView.tsx -> 1"
        status: pass
      - kind: automated_ui
        ref: "npm run compile"
        status: pass
    human_judgment: false
  - id: D2
    description: "'+' FAB restored as a floating bottom-right control outside the footer; footer holds gear (left) + auto-lock (right) only; 'Full screen' pill moved to the top bar"
    requirement: "EXT-06"
    verification:
      - kind: unit
        ref: "entrypoints/popup/ItemListView.test.tsx#Test 14 (popup UI round, Bartek 2026-07-18 live-UAT correction)"
        status: pass
      - kind: unit
        ref: "entrypoints/popup/ItemListView.test.tsx (all 16 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Row hover shows no drop-shadow; adjacent divide-y separator does not visibly change on hover, in both themes"
    verification:
      - kind: unit
        ref: "grep -c 'inset 0 0 0 1px color-mix(in oklch, var(--color-base-content) 15%, transparent);' entrypoints/popup/style.css -> 1"
        status: pass
      - kind: automated_ui
        ref: "playwright screenshot self-check, vault-dark + vault-light, 380px popup width (see 'Task 3 Screenshot Self-Check' section below)"
        status: pass
    human_judgment: false
  - id: D4
    description: "'All items'/'Wszystkie' heading + sort select render on one line, sized to body-text scale, no overlap"
    verification:
      - kind: unit
        ref: "grep -c 'text-sm font-medium text-base-content/60 whitespace-nowrap' entrypoints/popup/ItemListView.tsx -> 1"
        status: pass
      - kind: automated_ui
        ref: "playwright bounding-box check (heading height 20px = single line) + screenshot, real rebuilt extension, 380px width"
        status: pass
    human_judgment: false
  - id: D5
    description: "All 7 Phase 9 Chromium e2e SCs (P9-SC1..SC7) pass against the corrected popup DOM"
    requirement: "EXT-04"
    verification:
      - kind: e2e
        ref: "npm run test:e2e:chrome -- --project=chromium -g \"Phase 9\" (3 consecutive runs, all 7/7 green, zero flake)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Full gate: vitest (>=605), compile, Phase 9 e2e, Firefox build all green"
    verification:
      - kind: unit
        ref: "npx vitest run -> 606/606 passed, 50 files"
        status: pass
      - kind: other
        ref: "npm run compile -> clean, exit 0"
        status: pass
      - kind: e2e
        ref: "npm run test:e2e:chrome -- --project=chromium -g \"Phase 9\" -> 7/7 passed, exit 0"
        status: pass
      - kind: other
        ref: "npm run build:firefox -> clean, exit 0"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-07-18
status: complete
---

# Quick Task 260718-0qi: Popup UI Fix Round Summary

**Five Bartek-decided live-UAT popup corrections (theme parity, FAB/footer/top-bar restructure, hover shadow removal, label/sort sizing) plus a root-caused repair of the Phase 9 Chromium e2e suite the prior sheet-look restyle broke.**

## Performance

- **Duration:** ~50 min (dominated by a ~21-minute full non-ceremony e2e run used for extra Phase 10-12 diagnosis beyond the plan's literal gate)
- **Completed:** 2026-07-18
- **Tasks:** 6 (5 code tasks + 1 verification-only gate)
- **Files modified:** 4 (ItemListView.tsx, ItemListView.test.tsx, style.css, dual-browser.spec.ts)

## Accomplishments

- Popup top bar now uses `bg-base-200`/`text-base-content`, the exact same token pairing web's `Sidebar.tsx`/`TopBar.tsx` use, giving pixel-parity in both vault-dark and vault-light
- "+" new-item control restored as a floating bottom-right FAB (`data-testid=popup-fab`), independent of the footer; footer rebalanced to gear-only (left, 40px) + auto-lock-only (right); "Full screen" pill moved verbatim into the top bar beside the title
- `.pv-row-hover:hover` now declares only the inset-ring box-shadow layer — the two drop-shadow layers that made hover look like a lifted card (and collided visually with the divide-y separator) are gone
- "All items"/"Wszystkie" heading bumped to `text-sm` + `whitespace-nowrap` (guarantees single-line rendering); sort select bumped to `select-sm` + `shrink-0`
- Phase 9 Chromium e2e group (P9-SC1..SC7) repaired: root-caused to a Playwright strict-mode violation (bare `"select"` locator now ambiguous since the popup renders a second `<select>`, the sort control) and fixed by disambiguating to `#pv-autolock`; confirmed P9-SC5/SC7 were cascading effects of the same root cause, not independent bugs

## Task Commits

Each task was committed atomically:

1. **Task 1: Theme parity — top bar matches web sidebar's bg-base-200** - `1cab562` (fix)
2. **Task 2: Restore floating FAB, rebalance footer, move Full screen pill to top bar** - `d75c19e` (fix)
3. **Task 3: Row hover — remove drop-shadow, keep border/press pattern** - `2ba7f07` (fix)
4. **Task 4: Label/sort sizing — "All items" row on one line** - `3d4d9df` (fix)
5. **Task 5: E2E repair — root-cause and fix the 5 failing Phase 9 Chromium tests** - `39754b3` (fix)
6. **Task 6: Final verification — full gate run** - no code changes required, no commit (verification-only)

## Files Created/Modified

- `extension/entrypoints/popup/ItemListView.tsx` - Theme token pairing (Task 1), FAB/footer/top-bar restructure (Task 2), label/sort sizing (Task 4)
- `extension/entrypoints/popup/ItemListView.test.tsx` - `within` import + new structural Test 14 asserting FAB/footer/pill DOM placement (Task 2); Test 11 description updated for the pill's new location
- `extension/entrypoints/popup/style.css` - `.pv-row-hover:hover` drop-shadow layers removed, inset-ring kept (Task 3)
- `extension/e2e/dual-browser.spec.ts` - 4 bare `"select"` locator/selectOption occurrences disambiguated to `#pv-autolock` (Task 5)

## Decisions Made

- **Menu anchor `left-0` → `right-0` (Task 2, Rule 1 auto-fix):** the pre-existing type-menu `<ul>` was anchored `left-0` relative to its wrapper, which made sense when the wrapper lived inside the footer's left group. Once the wrapper moved to `absolute bottom-16 right-4` (a right-edge-anchored floating FAB), a `left-0` menu would have opened from the button's left edge and extended ~176px further right — well past the popup's 380px width, off-screen. Flipped to `right-0` so the menu opens leftward and stays fully in-bounds. This is a necessary correctness fix for the FAB relocation to actually render correctly, not a scope deviation from the plan's intent.
- **P9-SC5/P9-SC7 diagnosis (Task 5):** per the plan's explicit instruction not to assume these two share Step 2's root cause, they were independently re-run after the Step 2 selector fix alone (no additional code change). Both passed cleanly. Conclusion: their failures were cascading effects of P9-SC2's earlier strict-mode violation leaving the shared worker-scoped `popup` page on the wrong screen (still locked/on the unlock view) by the time SC5/SC7 ran in file-declaration order — not independent bugs, and no real product regression was found or needed fixing.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Type-menu anchor flipped from `left-0` to `right-0` after FAB relocation**
- **Found during:** Task 2 (FAB restructure)
- **Issue:** Keeping the pre-existing `left-0` menu anchor after moving the FAB wrapper to `absolute bottom-16 right-4` would render the 176px-wide type menu almost entirely off-screen (past the 380px popup width)
- **Fix:** Changed the `<ul>`'s anchor class from `left-0` to `right-0` so the menu opens leftward from the button, staying in-bounds
- **Files modified:** `extension/entrypoints/popup/ItemListView.tsx`
- **Verification:** `npm run compile` clean; visual screenshot self-check (Task 3/4 checks below) confirms the FAB and its menu render inside the popup's visible bounds
- **Committed in:** `d75c19e` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug)
**Impact on plan:** Necessary for the FAB relocation (an explicitly planned change) to render correctly. No scope creep — the plan's own done-criteria for Task 2 required visual verification of "clean clearance ... with no overlap," which this fix directly satisfies.

## Task 3 Screenshot Self-Check

Built the extension (`npx wxt build -b chrome`), signed into the shared UAT vault (`uat-prf04@example.local`, real pv-server at `http://localhost:8620`), dismissed the "Unlock faster with a passkey" prompt, hovered the first "Wszystkie" row, and forced `document.body`'s `data-theme` to each theme in turn (headless Chromium, 420x700 viewport, real popup DOM — not a mock):

- **vault-dark:** hover shows a subtle background tint + thin inset-ring border; no drop-shadow; the divide-y separator directly below the hovered row does not visibly change appearance.
- **vault-light:** same result — subtle tint + inset-ring, no shadow, no separator collision.

Screenshots saved locally (not committed — supporting evidence only) at:
`.planning/quick/260718-0qi-popup-ui-fix-round-theme-match-web-sideb/uat-screenshots/task3-hover-vault-dark.png`
`.planning/quick/260718-0qi-popup-ui-fix-round-theme-match-web-sideb/uat-screenshots/task3-hover-vault-light.png`

Also visually confirmed (same screenshots, pre-Task-4 state): Task 1's `bg-base-200` top bar and Task 2's FAB/footer/pill restructure all rendering correctly against the real, rebuilt extension.

## Task 4 Visual Self-Check

After Task 4's edit, rebuilt the extension and re-ran the same real-popup harness: the "All items" heading's bounding box measured `height: 20` (matching a single `text-sm`/20px-line-height line, not a two-line wrap), and the screenshot confirms "All items" renders on one line with no overlap against the now `select-sm` sort control.

## Task 5 — Root Cause & Fix (E2E Repair)

**Root cause (confirmed, not assumed):** `ItemListView.tsx` renders a second `<select>` (the sort control, `data-testid="popup-sort-select"`) whenever the shared UAT vault has items — which it does, having accumulated 222 items across many prior e2e runs. Every bare `popup.locator("select")` / `popup.selectOption("select", ...)` call in the Phase 9 block became a Playwright strict-mode violation ("resolved to 2 elements") the moment that second select existed.

**Fix:** Replaced all 4 occurrences (P9-SC2 x2, P9-SC3, P9-SC4) with `#pv-autolock` (the auto-lock select's existing, unchanged id) — zero bare `"select"` locators remain anywhere in the file.

**P9-SC5/P9-SC7 independent diagnosis:** re-ran the full Phase 9 group after the Step 2 fix alone (no code change beyond the 4 selector replacements). Both SC5 and SC7 passed. **No real product regression was found or fixed** — their prior failures were downstream cascades of SC2's earlier failure leaving the shared worker-scoped popup on the wrong screen by the time SC5/SC7 ran in sequence, not independent selector drift or product bugs.

**Confirmation:** ran the full `Phase 9` group 3 separate times across this session (once immediately after the fix, once inside the broader Phase 9-11 run, once as the final literal gate command) — 7/7 green every time, zero flake.

## Final Gate Results (Task 6)

**`npx vitest run`:** 606/606 tests passed, 50 files (605 baseline + 1 new structural test added in Task 2). One pre-existing, documented, out-of-scope unhandled-rejection warning from `ServerConfigView.tsx` (`entrypoints/popup/ServerConfigView.tsx:111`) fires during `App.test.tsx` — this is the SAME warning the plan's own context flagged as present at baseline ("1 pre-existing unrelated unhandled-rejection warning ... ignore unless it starts failing tests"). It does not fail any test (606/606 still pass), but it does cause the vitest process to exit with code 1, which broke the literal `&&`-chained one-liner from the plan's verification block partway through. Per the plan's explicit instruction to ignore this warning (it did not start failing tests, and it was never touched by any of this plan's 4 modified files), each remaining gate stage was run individually instead, with real captured output for each:

- **`npm run compile`:** clean, exit 0.
- **`npm run test:e2e:chrome -- --project=chromium -g "Phase 9"`:** 7/7 passed, exit 0 (`P9-SC1` through `P9-SC7`, ~17.5s).
- **`npm run build:firefox`:** clean, exit 0 (same pre-existing WXT warnings as always — `page-bridge` entrypoint skip on Firefox, Firefox data-collection-permissions notice for new extensions — neither introduced by this plan).

**Additional diagnosis (beyond the plan's literal gate, per Task 6's action text):** also ran the full non-ceremony e2e suite (`npm run test:e2e:chrome`, Phases 9-11, 16 tests, no `-g` filter) to genuinely check for Phase 10-12 hard fails:
- Phase 9 (7 SCs): all green on first try.
- Phase 10 (5 SCs): all 5 hit the project's own documented "Target page, context or browser has been closed" flaky pattern (attributable to sustained headless-Chromium memory pressure across a long sequential run) on their first attempt, then passed cleanly on retry #1 (6-9s each) — matching the plan's explicitly acceptable Phase 10-12 flaky-recovery precedent, not a hard fail.
- Phase 11 (4 SCs): all green on first try.
- **Net result: 16/16 tests ultimately passed, 0 hard fails, 5 flaky-recovered exactly as this project's own documented precedent describes.**

## Issues Encountered

None beyond the documented pre-existing vitest-exit-code quirk (see Final Gate Results above), which is out of this plan's scope and did not affect test correctness.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 5 of Bartek's live-UAT corrections shipped exactly as specified, plus the Phase 9 e2e suite fully repaired and re-verified green 3 times.
- Firefox build stays clean; no regressions introduced to the Firefox MV2 target.
- `.planning/quick/260718-0qi-popup-ui-fix-round-theme-match-web-sideb/uat-screenshots/` holds local-only screenshot evidence for Bartek's own visual spot-check (not committed to git, per this plan's code-only commit constraint).

## Self-Check: PASSED

All claimed files verified to exist on disk (ItemListView.tsx, ItemListView.test.tsx, style.css, dual-browser.spec.ts, this SUMMARY.md, both Task 3 screenshots). All 5 claimed commit hashes (`1cab562`, `d75c19e`, `2ba7f07`, `3d4d9df`, `39754b3`) verified present in `git log`.

---
*Quick task: 260718-0qi*
*Completed: 2026-07-18*
