---
phase: 17-shared-component-visual-alignment
plan: 02
subsystem: ui
tags: [css, design-tokens, oklch, shadow-dom, extension, autofill-overlay]

requires:
  - phase: 16-design-system-extraction
    provides: packages/pv-ui as the shared design-token source of truth (tokens.css, i18n engine)
provides:
  - "--pv-tile-bg/--pv-tile-fg custom properties in packages/pv-ui/tokens.css, theme-aware inside both existing [data-theme] blocks"
  - "In-page autofill overlay's .pv-row-icon-tile/.pv-row-icon now source their background/foreground color from pv-ui tokens instead of a hand-copied/incorrect var(--color-base-200)"
  - "Fixes the UX-01 dark-tile-in-vault-dark bug on both in-page overlay surfaces (Surface A renderFieldDropdown, Surface B renderFormPrompt)"
affects: [17-04-overlay-wide-audit, 17-01, 17-03]

tech-stack:
  added: []
  patterns:
    - "New pv-ui token pairs are declared inside the EXISTING :root/[data-theme] blocks in tokens.css, never a new selector block -- this is what lets inpage-theme.ts's existing :root->[data-theme] regex rewrite pick them up automatically with zero code change to that adapter"

key-files:
  created: []
  modified:
    - packages/pv-ui/tokens.css
    - extension/lib/autofill/inpage-overlay.ts
    - extension/lib/autofill/inpage-theme.test.ts

key-decisions:
  - "Followed UI-SPEC.md's exact OKLCH values verbatim: --pv-tile-bg: oklch(96.7% 0.001 286.375) / --pv-tile-fg: oklch(44.2% 0.017 285.786) in the dark/root block (Tailwind v4 zinc-100/zinc-600), --pv-tile-bg: var(--color-base-200) / --pv-tile-fg: color-mix(in oklch, var(--color-base-content) 70%, transparent) in the vault-light block."
  - "Regression tests extract the vault-light block's own text via regex (mirroring the file's existing fontRuleMatch pattern) rather than a bare whole-string .toContain, so a future accidental misplacement of a token into the wrong [data-theme] block is caught, not just its presence."

requirements-completed: [DS-04, UX-01]

coverage:
  - id: D1
    description: "packages/pv-ui/tokens.css declares --pv-tile-bg/--pv-tile-fg inside both existing [data-theme] blocks with UI-SPEC's exact values"
    requirement: "DS-04"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/inpage-theme.test.ts#carries the --pv-tile-bg dark-block value (DS-04/UX-01 tile tokens)"
        status: pass
      - kind: unit
        ref: "extension/lib/autofill/inpage-theme.test.ts#carries the --pv-tile-bg/--pv-tile-fg vault-light overrides in the vault-light block, not the dark block"
        status: pass
    human_judgment: false
  - id: D2
    description: ".pv-row-icon-tile's background swapped to var(--pv-tile-bg) and .pv-row-icon gains color: var(--pv-tile-fg), fixing the dark-tile-in-vault-dark bug on both Surface A and Surface B"
    requirement: "UX-01"
    verification:
      - kind: unit
        ref: "node -e block-extraction script (Task 2 <verify><automated>) -- confirms .pv-row-icon-tile references var(--pv-tile-bg) with zero remaining var(--color-base-200), .pv-row-icon references var(--pv-tile-fg), and no react/crypto import was introduced"
        status: pass
      - kind: unit
        ref: "extension/lib/autofill/inpage-overlay.test.ts (20 tests, structural DOM assertions, pre-existing suite, unchanged)"
        status: pass
    human_judgment: true
    rationale: "The CSS token wiring is fully proven by the tests above, but the actual visual light-tile-in-vault-dark rendering across both themes on Surface A and Surface B is a screenshot-based UAT item per UI-SPEC.md's Surface Inventory ('Acceptance is visual: a Playwright screenshot comparison... per CONTEXT.md's standing authorization'), reserved for Plan 17-04's overlay-wide visual confirmation."

duration: 12min
completed: 2026-07-21
status: complete
---

# Phase 17 Plan 02: In-Page Tile Token Fix Summary

**Two new theme-aware `pv-ui` tokens (`--pv-tile-bg`/`--pv-tile-fg`) fix the in-page autofill overlay's dark-tile-in-vault-dark bug (UX-01) by replacing a hand-copied `var(--color-base-200)` with a token sourced from `packages/pv-ui`.**

## Performance

- **Duration:** ~12 min
- **Completed:** 2026-07-21
- **Tasks:** 2 completed
- **Files modified:** 3

## Accomplishments
- `packages/pv-ui/tokens.css` gained two new custom properties, `--pv-tile-bg`/`--pv-tile-fg`, declared inside the existing `:root, [data-theme="vault-dark"]` and `[data-theme="vault-light"]` blocks (UI-SPEC.md's exact OKLCH/var()/color-mix() values) — no new selector block, so `inpage-theme.ts`'s existing `:root`→`[data-theme]` shadow-DOM rewrite picks them up with zero code change.
- `extension/lib/autofill/inpage-overlay.ts`'s `.pv-row-icon-tile` background swapped from the unconditional `var(--color-base-200)` (the UX-01 dark-tile-in-vault-dark bug) to `var(--pv-tile-bg)`; `.pv-row-icon` gained a new `color: var(--pv-tile-fg)` declaration so the fallback type-glyph gets the matching light-tile flip. Both Surface A (`renderFieldDropdown`) and Surface B (`renderFormPrompt`) share this one CSS choke point, so one fix covers both.
- `extension/lib/autofill/inpage-theme.test.ts` gained 2 new regression assertions proving the new tokens survive the shadow-DOM rewrite, with the vault-light block's own text extracted via regex (not a bare whole-string check) so a future misplacement into the wrong block is also caught.

## Task Commits

Each task was committed atomically:

1. **Task 1: --pv-tile-bg/--pv-tile-fg tokens + shadow-DOM regression assertions** - `a916bb1` (feat)
2. **Task 2: inpage-overlay.ts's .pv-row-icon-tile / .pv-row-icon CSS fix** - `4e10178` (fix)

## Files Created/Modified
- `packages/pv-ui/tokens.css` - +2 custom properties (`--pv-tile-bg`, `--pv-tile-fg`) inside each of the two existing `[data-theme]` blocks (4 new lines total)
- `extension/lib/autofill/inpage-overlay.ts` - `.pv-row-icon-tile`'s `background` value swapped to `var(--pv-tile-bg)`; `.pv-row-icon` gained a new `color: var(--pv-tile-fg)` declaration
- `extension/lib/autofill/inpage-theme.test.ts` - +2 `it()` assertions guarding the new tokens against future accidental deletion/misplacement

## Decisions Made
- Used UI-SPEC.md's exact hand-picked OKLCH values verbatim rather than re-deriving them (Tailwind v4 zinc-100/zinc-600 for the dark-block values; `var(--color-base-200)`/`color-mix(...)` for the light-block overrides) — no drift from the design contract.
- Regression assertions scope their `vault-light` check to a regex-extracted block substring (mirroring the file's existing `fontRuleMatch` pattern) instead of a whole-string `.toContain`, catching future misplacement of a token into the wrong `[data-theme]` block, not just its bare presence anywhere in the CSS text.

## Deviations from Plan

None - plan executed exactly as written. Both tasks matched their `acceptance_criteria` and `done` conditions precisely: tokens.css's two blocks each gained exactly 2 new lines in the exact specified positions; inpage-overlay.ts's diff was exactly the two-declaration swap/addition (verified via `git diff`); no other selector in `OVERLAY_CSS` changed; no `react` or crypto-surface import was introduced.

## Issues Encountered
- Fresh worktree required standard Phase-16-precedent bootstrap before any test could run: `node_modules` was missing in `extension/`, and `extension/tsconfig.json extends ./.wxt/tsconfig.json` (generated by `wxt prepare`) did not yet exist. Fixed by `rsync`-ing `extension/node_modules/` from the main checkout and running `npx wxt prepare` — zero tracked-file impact, no code change. Confirmed both `inpage-theme.test.ts` and `inpage-overlay.test.ts` passed cleanly on the unmodified baseline before making any edit, isolating all subsequent test-status changes to this plan's own diff.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both Surface A and Surface B's icon tiles now read their background/fallback-glyph color from `pv-ui`'s own tokens, matching web's/popup's own vault-dark light-flip (`ItemIconTile`'s `TILE_BG`/`TILE_FG` Tailwind arbitrary-variant strings) — proven by source assertion and the scoped block-extraction verify script.
- Ready for Plan 17-04's overlay-wide visual/Playwright screenshot confirmation and its executable audit against the approved-exception list this plan's `must_haves.prohibitions` documents (the five pre-existing NordPass-measured layout literals, five rgba() shadow/scrim elevation literals, and four generic-pill `border-radius: 999px` occurrences — all deliberately left byte-unchanged by this plan).
- No blockers for dependent plans in this wave.

---
*Phase: 17-shared-component-visual-alignment*
*Plan: 02*
*Completed: 2026-07-21*

## Self-Check: PASSED

All claimed files and commits verified present:
- `packages/pv-ui/tokens.css` — FOUND
- `extension/lib/autofill/inpage-overlay.ts` — FOUND
- `extension/lib/autofill/inpage-theme.test.ts` — FOUND
- `.planning/phases/17-shared-component-visual-alignment/17-02-SUMMARY.md` — FOUND
- Commit `a916bb1` — FOUND
- Commit `4e10178` — FOUND
