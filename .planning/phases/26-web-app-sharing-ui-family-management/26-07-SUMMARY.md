---
phase: 26-web-app-sharing-ui-family-management
plan: 07
subsystem: ui
tags: [react, typescript, i18n, native-select, vitest, jsdom-honesty]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-05's web/src/lib/vault/collections.ts (useCollections()) — the real client collections store"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "Plan 26-06's folder.pickerLabel/pickerCreateNew/pickerEmpty dictionary keys, verified byte-for-byte against 26-UI-SPEC.md"
provides:
  - "web/src/components/vault/CollectionPicker.tsx — native <select>-based picker over useCollections(), the real collections picker Phase 24's own CR-02 fix deferred to this phase"
  - "Phase 24's three dissolved UI-SPEC backstops (#4 zero-one-many, #5 long-name truncation, #6 selected-value truncation) discharged with real, named test assertions"
affects: [26-08, 26-12, 26-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "CLASS-LEVEL-ONLY layout backstop: when jsdom cannot genuinely measure overflow (scrollWidth/clientWidth are always 0), assert the structural Tailwind-class contract (w-full, no fixed/max-width class) instead of a jsdom layout measurement that would pass unconditionally regardless of markup. The real layout claim is deferred to a live-browser Playwright run, and the SUMMARY states that scope honestly rather than overclaiming."
    - "A useSyncExternalStore-backed module singleton with no distinct loading signal (useCollections(), same shape as this codebase's existing useFolders()) renders its not-yet-populated and genuinely-empty states identically — matches ItemForm.tsx's own personal-folder <select> precedent, not a gap unique to this component."

key-files:
  created:
    - web/src/components/vault/CollectionPicker.tsx
    - web/src/components/vault/CollectionPicker.test.tsx
  modified: []

key-decisions:
  - "Backstop #6 (selected-value truncation) is discharged at CLASS LEVEL ONLY, per the plan's own hard constraint: NOT via scrollWidth <= clientWidth (jsdom performs no layout, so both are always 0 and that comparison passes unconditionally regardless of markup — exactly the failure mode this project has hit twice before). Instead the test asserts the container and <select> both carry w-full and no fixed/max-width class shorter than a realistic long name. The closed native-select value's own ellipsis handling is browser-controlled and genuinely out of this component's control; the real overflow proof belongs to Plan 26-13's live Playwright run."
  - "No distinct loading state was added. useCollections() (Plan 26-05) is a useSyncExternalStore singleton exposing only the current Collection[] snapshot — no 'not yet fetched' signal exists to consume, and adding one to collections.ts was out of this plan's file scope (CollectionPicker.tsx + its test only, per the parallel-executor split with 26-08/26-11). This mirrors ItemForm.tsx's existing personal-folder <select>, which uses the identically-shaped useFolders() and has never needed to distinguish 'loading' from 'genuinely empty' either — the zero-collections state (folder.pickerEmpty + create-new trigger) is honest in both cases, since 'no shared folders are known right now' is true whether the fetch hasn't resolved yet or the caller genuinely has none."
  - "The create-new trigger is a sibling <button> next to the <select> (never folded into an <option>), matching FamilyTab.tsx's own invite-scope-select sibling-trigger precedent — a <select> option cannot open a dialog on its own, and the plan explicitly required matching this existing idiom rather than inventing a new one."

requirements-completed: [SHARE-01]

coverage:
  - id: D1
    description: "Backstop #4 (zero-one-many): zero collections renders folder.pickerEmpty with the folder.pickerCreateNew trigger still present and wired to onCreateNew (never a dead end); exactly one collection renders the identical <select> with no special-casing; many collections each render as their own <option>"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/CollectionPicker.test.tsx#zero collections: renders folder.pickerEmpty, folder.pickerCreateNew trigger still present and calls onCreateNew, never a dead end"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/CollectionPicker.test.tsx#exactly one collection: renders the same native select, no special-casing"
        status: pass
      - kind: unit
        ref: "web/src/components/vault/CollectionPicker.test.tsx#many collections: every collection renders as its own option"
        status: pass
    human_judgment: false
  - id: D2
    description: "Backstop #5 (long-name truncation): an <option> for a >=40-char collection name carries a title attribute equal to its full visible text"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/CollectionPicker.test.tsx#5: an option for a >=40-char collection name carries a title attribute equal to its full visible text"
        status: pass
    human_judgment: false
  - id: D3
    description: "Backstop #6 (selected-value truncation), CLASS-LEVEL ONLY: container and <select> both carry w-full and no fixed/max-width class shorter than a realistic long name — NOT a jsdom layout measurement, which cannot fail regardless of markup"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/CollectionPicker.test.tsx#6 (class-level only): container and select carry w-full, no fixed/max-width class shorter than a realistic long name"
        status: pass
    human_judgment: true
    rationale: "This is a partial, class-level-only proof by design (the plan's own hard constraint) — the genuine layout/overflow claim for the CLOSED native-select value requires a real browser and is explicitly deferred to Plan 26-13's live Playwright run. A human/verifier should confirm no downstream consumer (26-08, 26-12) mistakes this class-level test for a full overflow proof."
  - id: D4
    description: "Selecting an option calls onSelect(collectionId)"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/CollectionPicker.test.tsx#selecting an option calls onSelect(collectionId)"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 07: CollectionPicker.tsx Summary

**Native `<select>`-based `CollectionPicker.tsx` over `useCollections()`, discharging Phase 24's three dissolved UI-SPEC backstops (#4 zero-one-many, #5 long-name `title` truncation, #6 selected-value truncation at an honestly-scoped class level) with real, named DOM-evidenced tests.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-08-06T12:00:28+02:00
- **Tasks:** 1
- **Files modified:** 2 (both created)

## Accomplishments

- **`CollectionPicker.tsx` built** — the real collections picker Phase 24's own CR-02 fix explicitly deferred here (`FamilyTab.tsx:39`'s own comment: "kept only so Phase 26 can re-wire a real collections picker later"). Sources its option list from `useCollections()` (Plan 26-05); zero-collections state renders `folder.pickerEmpty` with the `folder.pickerCreateNew` trigger still present (never a dead end); populated state is a native `select select-bordered w-full` matching `FamilyTab.tsx`'s existing `invite-scope-select` idiom, plus a sibling `folder.pickerCreateNew`-labelled `<button>` (never folded into an `<option>`, since a `<select>` option cannot open a dialog).
- **Backstop #4 (zero-one-many) discharged with real DOM evidence**: separate named tests for zero, exactly-one (asserting no special-casing — the identical `<select>` renders), and many collections (asserting every collection renders as its own `<option>`).
- **Backstop #5 (long-name truncation) discharged with real DOM evidence**: a >=40-char collection name's `<option>` is asserted to carry `title` equal to its full visible text — the one truncation mechanism a real `<option>` element supports.
- **Backstop #6 (selected-value truncation) discharged at CLASS LEVEL ONLY, exactly as the plan's hard constraint required**: the test asserts the container and `<select>` both carry `w-full` and no fixed/`max-w-*` class shorter than a realistic long name. It deliberately does **not** assert via `scrollWidth <= clientWidth` — jsdom performs no layout, so both properties are always `0` there, and `0 <= 0` would pass unconditionally regardless of markup, silently discharging nothing. The real overflow claim for the browser-rendered closed-`<select>` value belongs to Plan 26-13's live Playwright run.
- **Dictionary keys used verbatim** from Plan 26-06 (`folder.pickerLabel`, `folder.pickerCreateNew`, `folder.pickerEmpty`) — no new strings invented, no paraphrasing.

## Task Commits

Each task was committed atomically:

1. **Task 1: CollectionPicker.tsx** - `aeea307` (feat)

## Files Created/Modified

- `web/src/components/vault/CollectionPicker.tsx` (new) - native-`<select>` collections picker; zero/one/many states, `title`-attribute truncation, class-level `w-full` overflow contract, sibling create-new trigger
- `web/src/components/vault/CollectionPicker.test.tsx` (new) - 6 tests: zero-state (empty + create-new trigger call), one-collection no-special-casing, many-collections each-own-option, #5 title assertion, #6 class-level assertion, onSelect(collectionId) on selection

## Decisions Made

- Backstop #6 discharged at class level only (see key-decisions above) — this is a deliberate, plan-mandated partial proof, not an oversight. Stated honestly in this SUMMARY's `coverage` block (`human_judgment: true`) so a verifier can tell proof from claim rather than treating the class-level test as a full overflow proof.
- No fabricated loading state — `useCollections()` exposes no "not yet fetched" signal, matching this codebase's existing `useFolders()`/`ItemForm.tsx` precedent for the same store shape. Adding one would have required modifying `collections.ts`, out of this plan's file scope (`CollectionPicker.tsx` + its test only, per the parallel-executor split with sibling plans 26-08/26-11).
- Create-new trigger is a sibling `<button>` (not an `<option>`), matching `FamilyTab.tsx`'s existing `invite-scope-select` sibling-trigger pattern per the plan and UI-SPEC E8's explicit instruction.

## Deviations from Plan

None — plan executed exactly as written. All `files_modified` match the plan's declared list (`CollectionPicker.tsx`, `CollectionPicker.test.tsx`); no other files were touched (verified via `git status --short` before the commit — `web/src/lib/vault/api.ts`, `ShareDialog.*`, and `SharingOverviewPanel.*` remain untouched, respecting the sibling parallel executors' exclusive scope).

## Issues Encountered

- A fresh worktree had no `node_modules` in `web/` or `packages/pv-ui/`, and no WASM artifacts — resolved per the environment note (`npm ci` in both, `bash scripts/build-wasm.sh`). WASM was required for `npx tsc --noEmit` to type-check cleanly project-wide (`collections.ts` transitively imports `@/lib/crypto`'s WASM glue), even though `CollectionPicker.test.tsx` itself mocks `@/lib/vault/collections` and never touches WASM at runtime.
- First draft of the zero-state test asserted the English `folder.pickerEmpty` string; `LocaleProvider` defaults to `"pl"` in a fresh jsdom render (no `document.documentElement.lang` set before the effect runs), matching this codebase's other locale-provider-wrapped tests. Corrected to assert the PL copy.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `CollectionPicker.tsx` is ready for Plan 26-08 (`ShareDialog`'s implicit "which folder" context) and Plan 26-12 (`FamilyTab`'s invite-scope select un-disabling the `"folder"` option and mounting `CollectionPicker` beneath it) to import directly.
- The three dissolved Phase 24 backstops (#4/#5/#6) are now discharged — #4 and #5 fully, by real DOM-evidenced tests; #6 at the honestly-scoped class level, with the genuine layout proof still owed to Plan 26-13's live Playwright run. Downstream plans should not treat #6 as fully closed.
- No blockers for downstream plans in this phase.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: accept (per plan's own threat register, T-26-14) | `web/src/components/vault/CollectionPicker.tsx` | Pure presentational layer over `useCollections()`, itself sourced from the already-authorized `GET /api/vault/collections` fetch (Plan 26-05) — no new data surface, no new trust boundary. This plan's own threat register (`T-26-14`, Information Disclosure) accepted this with no mitigation required, since only the caller's own already-scoped collections are ever listed. Reviewer should check: no future consumer of `CollectionPicker` passes it a collections list sourced from anywhere other than the caller's own `useCollections()` (e.g. never wired to render another user's or another family's collections). |
| threat_flag: rendering-honesty | `web/src/components/vault/CollectionPicker.tsx` | Backstop #6's class-level-only scope (see key-decisions) is a genuine but partial proof, and this SUMMARY's `coverage` block marks it `human_judgment: true` specifically so it is not silently treated as a full overflow proof by an automated pass. Reviewer/verifier should check: no downstream plan's SUMMARY or code comment upgrades this to "layout verified" without Plan 26-13's actual live-browser Playwright evidence. |

## Self-Check: PASSED

- FOUND: web/src/components/vault/CollectionPicker.tsx
- FOUND: web/src/components/vault/CollectionPicker.test.tsx
- FOUND commit aeea307 in git log
- cd web && npx tsc --noEmit: clean, 0 errors
- cd web && npx vitest run src/components/vault/CollectionPicker.test.tsx: 1 file, 6 tests passing
- cd web && npx vitest run (full suite): 74 files, 674 tests passing, zero regressions

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 07*
*Completed: 2026-08-06*
