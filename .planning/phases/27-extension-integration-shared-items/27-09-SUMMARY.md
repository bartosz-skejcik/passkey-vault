---
phase: 27-extension-integration-shared-items
plan: 09
subsystem: extension-popup-ui
tags: [react, daisyui, i18n, shared-items, ext-12, autofill]

requires:
  - phase: 27-05
    provides: "AutofillMatch.isShared?/.folderName? already populated correctly by handleAutofillMatch's shared-badge/folder-lookup data path; this plan reads isShared, never computes it"
  - phase: 27-08
    provides: "SharedBadge.tsx — the one reusable shared-item corner-badge component (row/detail variants); this plan imports it, does not re-derive the badge JSX"
provides:
  - "AutofillItemRow.tsx and TotpFillRow.tsx's own h-8 w-8 icon frames now carry the identical SharedBadge treatment ItemListView.tsx's 'Wszystkie' rows use — E1's second half"
affects: [27-10]

tech-stack:
  added: []
  patterns:
    - "SharedBadge wrapper convention extended a third/fourth call site: a `relative inline-flex shrink-0` span hosts the existing icon frame + a conditional `<SharedBadge locale={locale} />` when match.isShared === true — the SAME pattern ItemListView.tsx's ItemIconTile host established in 27-08, applied here without modification to the badge component itself."

key-files:
  created: []
  modified:
    - extension/entrypoints/popup/autofill/AutofillItemRow.tsx
    - extension/entrypoints/popup/autofill/TotpFillRow.tsx
    - extension/entrypoints/popup/autofill/AutofillItemRow.test.tsx
    - extension/entrypoints/popup/autofill/TotpFillRow.test.tsx

key-decisions:
  - "Wrapped only the icon-frame `<span>` in a `relative inline-flex shrink-0` host, keeping the existing `shrink-0` class moved from the inner span to the new outer host (not duplicated on both) — avoids a double shrink-0 no-op while preserving the row's existing flex-item sizing behavior exactly."
  - "New dedicated test files (AutofillItemRow.test.tsx, TotpFillRow.test.tsx) rather than extending OnThisPageSection.test.tsx, per the plan's own files_modified list — these are the first component-level tests for either row in isolation; OnThisPageSection.test.tsx continues to cover the two components' integration/gesture-gate behavior unchanged."

patterns-established: []

requirements-completed: [EXT-12]

coverage:
  - id: D1
    description: "AutofillItemRow.tsx: a personal match renders no badge; a shared match (isShared: true) renders SharedBadge with the correct aria-label, in both locales"
    requirement: "EXT-12"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/autofill/AutofillItemRow.test.tsx#Test 1 (no badge), Test 2 (EN badge+aria-label), Test 3 (PL badge+aria-label)"
        status: pass
    human_judgment: false
  - id: D2
    description: "TotpFillRow.tsx: a personal match renders no badge; a shared match (isShared: true) renders SharedBadge with the correct aria-label"
    requirement: "EXT-12"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/autofill/TotpFillRow.test.tsx#Test 1 (no badge), Test 2 (badge+aria-label)"
        status: pass
    human_judgment: false

duration: ~15min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 09: Autofill Row Shared Badge Summary

**Applied 27-08's SharedBadge to AutofillItemRow.tsx's and TotpFillRow.tsx's own icon frames — the "Na tej stronie" half of E1's badge coverage, purely presentational and additive to shared rows only.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-08-08T19:26:00+02:00
- **Completed:** 2026-08-08T19:41:00+02:00
- **Tasks:** 1
- **Files modified:** 4 (2 modified, 2 new tests)

## Accomplishments

- `AutofillItemRow.tsx`'s existing `h-8 w-8` icon frame now sits inside a `relative inline-flex shrink-0` host that conditionally renders the same 27-08 `SharedBadge` (row variant) when `match.isShared === true`. `TotpFillRow.tsx` gets the identical treatment on its own `h-8 w-8` `Timer` frame.
- No badge JSX re-derived, no new i18n keys, no touch to fill/copy logic, confirm-flow, or the TOTP ticker — pure wrapper addition around an existing element.
- 5 new component-level tests (3 for AutofillItemRow, 2 for TotpFillRow) proving the badge is additive-only: personal matches render byte-identical (no badge in the DOM at all), shared matches render `SharedBadge` with the correct `aria-label` in both locales.
- Full extension test suite: 749/749 green (up from the pre-existing 744 baseline + 5 new tests this plan adds). `npx tsc --noEmit` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Badge wrapper on AutofillItemRow.tsx and TotpFillRow.tsx** - `af4efcd` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/popup/autofill/AutofillItemRow.tsx` - icon frame wrapped in `relative inline-flex shrink-0` host + conditional `SharedBadge`
- `extension/entrypoints/popup/autofill/TotpFillRow.tsx` - same wrapper applied to its own icon frame
- `extension/entrypoints/popup/autofill/AutofillItemRow.test.tsx` (NEW) - 3 tests: no badge on personal match, badge+aria-label on shared match (EN), badge+aria-label on shared match (PL)
- `extension/entrypoints/popup/autofill/TotpFillRow.test.tsx` (NEW) - 2 tests: no badge on personal match, badge+aria-label on shared match

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- E1's badge coverage is now complete across both "Wszystkie" (27-08) and "Na tej stronie" (this plan) rows, all sourced from the same `SharedBadge` component.
- 27-10 (`ProviderCeremonyView.tsx`) remains the last E1/E4 badge call site, ready to import the same `SharedBadge` unchanged.
- No blockers. Full extension test suite: 749/749 green. `npx tsc --noEmit` clean.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*

## Self-Check: PASSED
