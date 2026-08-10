---
phase: 30-the-living-group-family-wide-sharing
plan: 09
subsystem: api
tags: [typescript, wire-contract, family-sharing, vault-api]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing
    provides: "30-01's collections.family_wide_kind schema + 30-02's CollectionResponse/CreateCollectionRequest.family_wide_kind server-side field (named, closed set 'folder'/'item_bucket', nullable)"
provides:
  - "CollectionRow.family_wide_kind -- the single client-side name every later Phase 30 client plan (invite folding, ShareDialog, SharingOverviewPanel, ItemRow badge) reads this field from"
  - "createCollection()'s optional 4th familyWideKind parameter, key omitted entirely from the POST body when absent"
affects: [30-06, 30-08, 30-10, 30-11, 30-12, 30-13, 30-15]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Optional-and-omit-when-absent wire mirroring: a TS field typed with '?' plus a spread-conditional request body ({ ...(x !== undefined ? { key: x } : {}) }) reproduces a Rust #[serde(default)]-shaped optional field exactly -- same idiom RESEARCH.md's Pitfall 2 warns against violating on the server side, mirrored here on the client"

key-files:
  created:
    - web/src/lib/vault/api.test.ts
  modified:
    - web/src/lib/vault/api.ts

key-decisions:
  - "CollectionRow.family_wide_kind typed as optional (`family_wide_kind?: string | null`), not merely nullable -- the plan's own behavior bullet required a getCollection/listCollections response omitting the key entirely to still type-check (rolling-restart-safe); a strictly-required field would have broken that guarantee and, as discovered mid-task, broken two pre-existing unrelated test fixtures (ShareDialog.test.tsx, SharingOverviewPanel.test.tsx) that predate this field. Optional satisfies the plan's own stated contract and needed zero changes to files outside this plan's scope."

patterns-established: []

requirements-completed: [FSH-01, FSH-05]

coverage:
  - id: D1
    description: "CollectionRow carries family_wide_kind, mirroring CollectionResponse.family_wide_kind byte-for-byte; a response omitting the key still type-checks and reads as null-equivalent"
    requirement: "FSH-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/api.test.ts#createCollection: family_wide_kind wire-contract mirror (30-09) > CollectionRow.family_wide_kind round-trips through the response -- a response omitting the field entirely still type-checks"
        status: pass
      - kind: other
        ref: "npx tsc --noEmit -p web/tsconfig.json -- _collectionRowFamilyWideKind compile-time fixture in api.test.ts"
        status: pass
    human_judgment: false
  - id: D2
    description: "createCollection accepts an optional familyWideKind 4th parameter; the POST body omits the key entirely when absent (byte-for-byte identical to the pre-existing 3-argument shape) and includes it verbatim ('folder' or 'item_bucket') when provided"
    requirement: "FSH-05"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/api.test.ts#createCollection: family_wide_kind wire-contract mirror (30-09) > omits family_wide_kind entirely from the POST body when called with no 4th argument"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/api.test.ts#createCollection: family_wide_kind wire-contract mirror (30-09) > includes family_wide_kind in the POST body when the 4th argument is provided"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/api.test.ts#createCollection: family_wide_kind wire-contract mirror (30-09) > includes family_wide_kind: 'item_bucket' when that variant is passed"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 09: CollectionRow.family_wide_kind + createCollection's Optional Param Summary

**Client-side wire-type mirror of 30-02's `CollectionResponse.family_wide_kind`/`CreateCollectionRequest.family_wide_kind` into `CollectionRow`/`createCollection()`, the single place every later Phase 30 client plan reads this contract from.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-08-10T13:19:00Z
- **Completed:** 2026-08-10T13:31:00Z
- **Tasks:** 1
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Added `CollectionRow.family_wide_kind?: string | null`, mirroring `collections.rs`'s `CollectionResponse.family_wide_kind` (30-02) — typed optional so a response predating this phase's deploy (or any pre-existing test fixture) can omit the key entirely and still type-check
- Extended `createCollection(id, encName, sealedKey, familyWideKind?)` — the POSTed JSON body omits `family_wide_kind` entirely when the 4th argument is absent, and includes it verbatim when provided, matching the server's optional-field deserialize-default contract exactly
- Wrote `web/src/lib/vault/api.test.ts` (new file — none existed for this module before) as a fetch-spy-level TDD suite covering all three plan behavior bullets, following RED (test committed alone, fails against the unmodified 3-argument signature) then GREEN (implementation committed, all 4 tests pass)

## Task Commits

Each task was committed atomically (TDD RED/GREEN):

1. **Task 1 RED: failing test for createCollection family_wide_kind** - `d00ce94` (test)
2. **Task 1 GREEN: mirror CollectionResponse.family_wide_kind into CollectionRow** - `7dff04a` (feat)

_No REFACTOR commit needed — the GREEN implementation required no cleanup._

## Files Created/Modified
- `web/src/lib/vault/api.ts` - `CollectionRow.family_wide_kind?: string | null`; `createCollection()`'s new optional 4th `familyWideKind` parameter, spread-conditionally included in the POST body
- `web/src/lib/vault/api.test.ts` - new file; 4 tests proving the omit-when-absent / include-when-present / round-trip-tolerant-of-missing-key contract

## Decisions Made
- `family_wide_kind` typed optional (`?`), not just nullable — see `key-decisions` above. This was the one deviation from the plan's literal action text (which read `family_wide_kind: string | null`, no `?`), resolved by following the plan's own behavior bullet, which explicitly required response-omits-the-key to still type-check.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `CollectionRow.family_wide_kind` made optional, not strictly required**
- **Found during:** Task 1, running `npx tsc --noEmit` after the initial (non-optional) implementation
- **Issue:** The plan's `<action>` text read `family_wide_kind: string | null` (no `?`). Implemented literally, this made the field required at the TypeScript level, which directly contradicted the plan's own `<behavior>` bullet ("a getCollection/listCollections mock response omitting the field entirely still type-checks... never a required field a missing-key response would throw on") and broke `npx tsc --noEmit -p web/tsconfig.json` for two pre-existing, out-of-scope test fixtures (`ShareDialog.test.tsx`, `SharingOverviewPanel.test.tsx`) that construct `CollectionRow`-shaped literals predating this field.
- **Fix:** Typed the field as optional (`family_wide_kind?: string | null`) instead of merely nullable. This satisfies the plan's own stated behavior contract exactly and required zero changes to any file outside this plan's `files_modified` scope.
- **Files modified:** `web/src/lib/vault/api.ts` (already in scope)
- **Verification:** `npx tsc --noEmit -p web/tsconfig.json` — the two previously-broken fixture files' errors are gone; `npx vitest run src/components/vault/ShareDialog.test.tsx` passes 29/29 (`SharingOverviewPanel.test.tsx` fails only on an unrelated, pre-existing missing-wasm-artifact import, confirmed below)
- **Committed in:** `7dff04a` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — type-level bug fix, resolving a contradiction between the plan's literal action text and its own behavior contract)
**Impact on plan:** No scope creep — the fix stayed entirely within `web/src/lib/vault/api.ts`, the plan's sole `files_modified` entry.

## Issues Encountered

**Environment gap, not a code defect (out of scope, not fixed):** `npx tsc --noEmit -p web/tsconfig.json` in this freshly-checked-out worktree reports pre-existing errors in `web/src/lib/crypto/index.ts` (`Cannot find module './wasm/pv_wasm.js'`) and `packages/pv-ui/components/ItemIconTile.tsx` (`Cannot find module 'react'`). Verified unrelated to this task: `web/src/lib/crypto/wasm/` is gitignored (`.gitignore:12`) and simply absent from this worktree's checkout (the main repo checkout has it, generated via a `wasm-pack build` step this plan does not run); `packages/pv-ui` has no installed `node_modules` in this worktree. Confirmed isolated by running `npx vitest run src/components/vault/SharingOverviewPanel.test.tsx`, which fails on the identical missing-wasm-module error, and `ShareDialog.test.tsx`, which passes fully (29/29) with no wasm dependency. Neither file was touched by this plan. `npm ci` was run in `web/` at the start of this task (this worktree's `node_modules` was entirely absent) to make `vitest`/`tsc` runnable at all.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `CollectionRow.family_wide_kind` and `createCollection(..., familyWideKind?)` are the one canonical client-side name for this wire field — every later Phase 30 client plan (invite folding, ShareDialog's "Cała rodzina" row, SharingOverviewPanel's pinned family-wide block, ItemRow's family badge) should read/write through this contract rather than re-deriving its own field name.
- No blockers for dependent plans in this wave or later waves.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED

All created files and commit hashes verified present on disk / in git history.
