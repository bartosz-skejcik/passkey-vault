---
phase: 16-design-system-extraction-logic-types-i18n
plan: 05
subsystem: ui
tags: [pv-ui, vault-search, vault-sort, design-system-extraction, shared-logic]

# Dependency graph
requires:
  - phase: 16-02
    provides: packages/pv-ui/vault/types.ts (VaultItem/ItemFields/VaultFilter, sibling ./types import target for both moved modules)
provides:
  - "packages/pv-ui/vault/search.ts: single canonical domainFromUrl()/searchItems()/filterItems()"
  - "packages/pv-ui/vault/sort.ts: single canonical SortOption/DEFAULT_SORT/sortItems() comparator"
  - "web and extension both reduced to export-* (search) and split-shim (sort) re-exports"
affects: [17-shared-component-visual-alignment]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Split-shim pattern: comparator moves to pv-ui, platform-specific persistence (sync localStorage web vs async browser.storage.local extension) stays local per consumer"

key-files:
  created:
    - packages/pv-ui/vault/search.ts
    - packages/pv-ui/vault/sort.ts
  modified:
    - web/src/lib/vault/search.ts
    - web/src/lib/vault/sort.ts
    - extension/lib/vault/search.ts
    - extension/lib/vault/sort.ts

key-decisions:
  - "search.ts moved as a pure export * shim (byte-identical logic between web/extension, comment-only diff confirmed by diff before overwrite)"
  - "sort.ts split: comparator (SortOption/DEFAULT_SORT/sortItems, including byName tie-break) moved to pv-ui; readSortPreference/writeSortPreference stay local per consumer (different storage keys/sync-vs-async) per CONTEXT.md's locked decision"
  - "extension's local sortByLastUsed() sugar kept local, now delegating to the shared sortItems()"

patterns-established:
  - "Split-shim pattern for platform-specific persistence wrapped around a shared pure comparator"

requirements-completed: [DS-01]

coverage:
  - id: D1
    description: "packages/pv-ui/vault/search.ts is the single canonical source for domainFromUrl/searchItems/filterItems; web and extension both become pure export * shims"
    requirement: "DS-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/search.test.ts (10 tests)"
        status: pass
      - kind: unit
        ref: "extension/lib/vault/search.test.ts (10 tests)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (web and extension), both clean"
        status: pass
    human_judgment: false
  - id: D2
    description: "packages/pv-ui/vault/sort.ts holds the comparator only (SortOption/DEFAULT_SORT/sortItems); both consumers split-shim it with unchanged local persistence, extension additionally keeps local sortByLastUsed()"
    requirement: "DS-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/sort.test.ts (8 tests, including tie-break/ordering cases)"
        status: pass
      - kind: unit
        ref: "extension/lib/vault/sort.test.ts (10 tests, including sortByLastUsed coverage)"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit (web and extension), both clean"
        status: pass
    human_judgment: false
  - id: D3
    description: "frame-guard.ts's itemMatchesOrigin() origin-matching security gate proven structurally untouched by this move"
    requirement: "DS-01"
    verification:
      - kind: other
        ref: "grep -n 'from .*vault/search' extension/entrypoints/background/frame-guard.ts (zero hits) && git diff --quiet -- extension/entrypoints/background/frame-guard.ts (clean)"
        status: pass
    human_judgment: false

duration: ~20min
completed: 2026-07-20
status: complete
---

# Phase 16 Plan 05: Vault search/sort logic extraction Summary

**Moved `domainFromUrl()`/`searchItems()`/`filterItems()` and the `sortItems()` comparator byte-for-byte into `packages/pv-ui/vault/`, closing the final two DS-01 duplication entries with one pure export shim (search) and one split-shim (sort) per consumer.**

## Performance

- **Duration:** ~20 min (including worktree bootstrap: node_modules rsync, WASM build, wxt prepare)
- **Started:** 2026-07-20T21:05:00Z (approx)
- **Completed:** 2026-07-20T21:12:04Z
- **Tasks:** 2
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `packages/pv-ui/vault/search.ts` is now the single canonical source for `domainFromUrl()`/`searchItems()`/`filterItems()`, moved byte-for-byte from web's copy (verified comment-only diff against extension's copy before overwrite)
- `packages/pv-ui/vault/sort.ts` is now the single canonical source for the `sortItems()` comparator (including its `byName()` tie-break and lastUsed-descending/undefined-sinks-to-bottom ordering), moved byte-for-byte from web's copy
- All 4 consumer files (`web`/`extension` × `search.ts`/`sort.ts`) reduced to thin re-export shims — 2 pure `export *` (search), 2 split-shims (sort, keeping platform-specific persistence local)
- Independently confirmed `extension/entrypoints/background/frame-guard.ts`'s `itemMatchesOrigin()` (the actual fail-closed origin access-control gate) has zero import of `vault/search` and is byte-identical to its pre-plan state (`git diff --quiet`) — the security boundary this plan's threat model calls out could not have drifted

## Task Commits

Each task was committed atomically:

1. **Task 1: pv-ui/vault/search.ts (canonical move) + both shims + origin-gate independence check** - `07278d2` (feat)
2. **Task 2: pv-ui/vault/sort.ts (comparator-only split-move) + both split-shims** - `041989f` (feat)

_No plan-metadata commit required from this worktree agent — the orchestrator handles STATE.md/ROADMAP.md updates after wave merge._

## Files Created/Modified
- `packages/pv-ui/vault/search.ts` - canonical `domainFromUrl()`/`matchesQuery()`/`searchItems()`/`matchesFilter()`/`filterItems()`
- `packages/pv-ui/vault/sort.ts` - canonical `SortOption`/`DEFAULT_SORT`/local `byName()`/`sortItems()` comparator only
- `web/src/lib/vault/search.ts` - reduced to `export * from "pv-ui/vault/search";`
- `web/src/lib/vault/sort.ts` - split-shim: re-exports `SortOption`/`DEFAULT_SORT`/`sortItems`, keeps local sync-localStorage `readSortPreference()`/`writeSortPreference()` (key `pv-vault-sort`)
- `extension/lib/vault/search.ts` - reduced to `export * from "pv-ui/vault/search";`
- `extension/lib/vault/sort.ts` - split-shim: re-exports `SortOption`/`DEFAULT_SORT`/`sortItems`, keeps local async `browser.storage.local` `readSortPreference()`/`writeSortPreference()` (key `pv-popup-sort`) + local `sortByLastUsed()` sugar (now delegating to shared `sortItems()`)

## Decisions Made
- Used web's copy as the byte-for-byte source for both modules (its comments were the more detailed of the two near-identical copies, per plan instruction)
- `sort.ts`'s split-shim re-declares a local `isSortOption()` type guard in each consumer (unchanged from pre-plan) since the guard itself is inseparable from each consumer's own storage-read shape (sync `string | null` on web vs async `unknown` on extension)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Fresh worktree lacked `node_modules` (gitignored) and built WASM glue needed by `vitest`/`tsc` in both `web/` and `extension/`. Bootstrapped per the orchestrator's documented recovery: rsynced `node_modules` from the main checkout into both `web/` and `extension/`, ran `scripts/build-wasm.sh`, and ran `npx wxt prepare` in `extension/`. Zero tracked-file impact — all bootstrap artifacts are gitignored.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- DS-01's duplication inventory is now fully closed for vault logic/types (this plan closes the last two entries: search + sort)
- `packages/pv-ui/vault/` now holds `types.ts` (16-02), `cardBrand.ts`, `search.ts`, `sort.ts` — ready for Phase 17's `ItemIconTile` shared-component work, which already depends on `domainFromUrl()` via `web/src/components/vault/ItemIconTile.tsx`'s unchanged local `./search` import path
- No blockers or concerns

---
*Phase: 16-design-system-extraction-logic-types-i18n*
*Completed: 2026-07-20*
