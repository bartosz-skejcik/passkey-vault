---
phase: 32-putting-things-into-shared-folders
plan: 02
subsystem: vault
tags: [react, testing, playwright, vitest, sharing]

requires:
  - phase: 32-putting-things-into-shared-folders (plan 01, wave 2)
    provides: "moveVaultItem, ItemForm's grouped item-folder-select (item_bucket-locked guard, optgroups), and the retry-safe create-then-move dispatch with its B-3/C-2 recovery mechanism -- this plan proves each of those contracts with a dedicated test, adding zero new production code"
provides:
  - "ItemForm.test.tsx: mocked-store unit coverage of the destination optgroup (absent-when-empty shared group, disabled-with-reason, item_bucket exclusion, the B-2 item_bucket-locked guard) and the create-then-move retry-safe dispatch (genuine failure, B-3 lost-response recovery, the C-2 revision conjunct, and a genuine retry's refreshed revision)"
  - "sharing.spec.ts: one new live, single-session e2e test proving SC1's create-mode half -- an item whose destination is picked before its first Save lands genuinely collection-scoped, survives a real reload, never stranded personal"
affects: []

tech-stack:
  added: []
  patterns:
    - "A vi.hoisted() mock factory that seeds a mock's return value via an initial `() => []` arrow function locks vi.fn()'s inferred generic to `never[]` -- any later `mockReturnValue(realShape)` call in the same file then fails `tsc --noEmit` with a `never` assignability error even though vitest itself runs fine (type errors are compile-time only, invisible to a test run). Give the mock a bare `vi.fn()` and set the default via an explicit `.mockReturnValue([])` in `beforeEach` instead."
    - "A destination-only lost-response recovery test is unfalsified unless the fixture places the fresh row's revision at something OTHER than currentRevision+1 while still landing it AT the destination -- that is the one shape a destination-only check gets wrong (an earlier attempt's commit, not this attempt's own)."

key-files:
  created: []
  modified:
    - web/src/components/vault/ItemForm.test.tsx
    - web/e2e/sharing.spec.ts

key-decisions:
  - "Added a fourth retry-safety test beyond the plan's three literal bullets: an item AT the destination but at an EARLIER attempt's revision (not created.revision+1). This is the one fixture shape that discriminates the C-2 conjunct from a destination-only check -- the plan's own three bullets (genuine failure, B-3 lost-response, genuine retry) each leave the destination either unreached or reached at exactly the right revision, so none of them alone would fail against a destination-only implementation. Falsification-proven: weakening the conjunct to destination-only turns this test red (onCreated wrongly called, error never renders) while the other three stay green."
  - "The dispatch-order test ('createVaultItem then moveVaultItem, never simultaneous') proves sequencing by holding createVaultItem's own promise unresolved and asserting moveVaultItem is not yet called, rather than merely recording call order -- a call-order array alone would not distinguish sequential awaiting from Promise.all (both register calls in the same order), but withholding creation's own resolution genuinely can."
  - "The live e2e test registers the member's session once (to mint a real userId/identity key for the folder share) and never opens or interacts with it again -- no reloadAndUnlock, no recipient-side decrypt read. The recipient-read half of ORG-02/SC2 is already proven live by 32-01's own two-session test against the identical moveVaultItem mechanism; re-deriving it here would not add discriminating power."

requirements-completed: [ORG-01]

coverage:
  - id: D1
    description: "The destination optgroup's full rendering contract -- absent shared optgroup at zero shared collections, writable-enabled vs disabled-with-reason for read/hidden_password, item_bucket collections never selectable, and the B-2 item_bucket-locked guard (disabled select naming the item's real scope, no mis-file on save) -- is proven by five dedicated unit tests, each independently falsification-proven"
    requirement: "ORG-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemForm.test.tsx describe(\"ItemForm destination optgroup (32-02)\") (5 tests, mocked useCollections/store)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The retry-safe create-then-move dispatch -- a genuine unrecovered failure, B-3's lost-response recovery, the C-2 revision conjunct (destination reached but NOT this attempt's own commit must not recover), and a genuine retry sending the refreshed revision -- is proven by four dedicated unit tests"
    requirement: "ORG-01"
    verification:
      - kind: unit
        ref: "web/src/components/vault/ItemForm.test.tsx describe(\"ItemForm create-then-move retry safety and lost-response recovery (32-02)\") (4 tests, mocked store)"
        status: pass
    human_judgment: false
  - id: D3
    description: "SC1's create-mode half: an item whose destination is chosen before its first Save lands genuinely collection-scoped immediately after save and survives a real reload, never stranded in personal scope"
    requirement: "ORG-01"
    verification:
      - kind: e2e
        ref: "web/e2e/sharing.spec.ts -g \"created directly in an existing shared folder\" (live, single owner session)"
        status: pass
    human_judgment: false

duration: ~60min
completed: 2026-08-19
status: complete
---

# Phase 32 Plan 02: ItemForm destination optgroup + create-then-move retry safety, proven Summary

**Nine new mocked-store unit tests prove 32-01's destination optgroup rendering contract and the retry-safe create-then-move dispatch (including the C-2 revision conjunct, whose own discriminating test case was added beyond the plan's literal three bullets), and one new live single-session Playwright test proves SC1's create-mode half -- zero new production code, every new test independently falsification-proven.**

## Performance

- **Duration:** ~60 min
- **Tasks:** 2 planned tasks, both completed exactly as specified (no Rule 4 escalations); one Rule 3 auto-fix (TypeScript compile error from over-narrow mock typing)
- **Files modified:** 2 (both existing test files, no new files)

## Accomplishments

- `ItemForm.test.tsx` gained `useCollections`/`moveVaultItem`/`getItems`/`RevisionConflictError` to its existing mocked-store shape (`vi.hoisted`/`vi.mock` conventions unchanged from the rest of the file), plus a `vi.mock("@/lib/vault/collections", ...)` for the destination select's own data source.
- **Destination optgroup describe block (5 tests):** the "Udostępnione foldery" optgroup is proven absent (not merely empty) at zero shared collections; a writable shared collection renders as a plain enabled option while read/hidden_password ones render `disabled` (asserted via the DOM `.disabled` property, never a CSS class) with the read-only reason in their text; an `item_bucket` collection never appears as any option, writable or disabled; the B-2 item_bucket-locked guard renders a genuinely disabled select naming the item's real scope and a save from that state never mis-files the item under a personal folder; and selecting a shared folder then submitting calls `createVaultItem` before `moveVaultItem` is even invoked (proven by holding `createVaultItem`'s own promise unresolved and asserting `moveVaultItem` has not fired), never simultaneously.
- **Create-then-move retry safety describe block (4 tests):** a genuine unrecovered failure (item still not at the destination) never calls `onCreated`, shows the honest error, and never double-creates; B-3's lost-response recovery (item already at the destination at `created.revision + 1`) is recognized as recovered success with no redundant second move call; **the C-2 revision conjunct's own discriminating test** -- an item AT the destination but at an EARLIER attempt's revision must NOT be recognized as recovered, a case beyond the plan's three literal bullets but required by the C-2 fix's own falsifiability bar; and a genuine retry (destination not yet reached, but revision bumped by an unrelated write) resends the second `moveVaultItem` call with the refreshed revision, never the original stale one, without a duplicate create.
- **Live e2e (`sharing.spec.ts`):** a new single-session test and its own `createLoginItemInDestinationViaUI` helper prove SC1's create-mode half -- an item's destination, selected before the very first Save, is honored immediately (`collection_id` on the server matches the destination, never `null`) and survives a real page reload. The member's session is registered once purely to mint a real userId/identity key for the folder share and is never opened again.

## Task Commits

Each task was committed atomically:

1. **Task 1: unit tests for the destination optgroup and the retry-safe create-then-move dispatch** - `ad5f8cc` (test)
2. **Task 2: live e2e -- creating an item directly in an existing shared folder** - `ea33c34` (test, includes the Rule 3 compile fix)

_No separate plan-metadata commit yet -- this SUMMARY/STATE/ROADMAP commit is the final commit for this plan._

## Files Created/Modified

- `web/src/components/vault/ItemForm.test.tsx` - two new describe blocks (9 tests total), extended mock surface (`useCollections`/`moveVaultItem`/`getItems`/`RevisionConflictError`), and the mock-typing fix (see Deviations)
- `web/e2e/sharing.spec.ts` - one new `createLoginItemInDestinationViaUI` helper + one new live test proving SC1's create-mode half

## Decisions Made

- **Added a fourth retry-safety test the plan's three literal bullets do not cover: destination-reached-at-an-earlier-revision.** The plan's own non-negotiable #2 (in the orchestrator's task prompt) required a test that a destination-only implementation would get wrong; none of the plan's three named cases (genuine failure, B-3 lost-response, genuine retry) actually discriminates the conjunct, because each either never reaches the destination or reaches it at exactly the right revision. Added the missing case and falsification-proved it specifically: weakening the conjunct to destination-only turns this new test red while leaving the other three green, confirming it is the one that actually tests C-2.
- **The dispatch-order test asserts via a withheld promise, not a call-order array.** A call-order array populated inside each mock's async body would still show "create, move" under a hypothetical `Promise.all` (both calls are still registered synchronously in source order); holding `createVaultItem`'s own promise unresolved and asserting `moveVaultItem` has not been called yet is what actually proves the dispatch awaits create's result before invoking move.
- **Single-session e2e, no recipient-side read.** The plan explicitly scoped SC2's crypto-decrypt claim to 32-01's own test against the same `moveVaultItem` mechanism; re-deriving it here would add cost without discriminating power. The member session is opened only long enough to register and mint a real userId/identity key for the share.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `mockGetItems`/`mockUseCollections`'s initial `() => []` factory locked their inferred generic to `never[]`, breaking `npm run compile`**
- **Found during:** Task 2, running the plan's own `npm run compile` verify step after adding the live e2e test
- **Issue:** `mockGetItems: vi.fn(() => [])` and `mockUseCollections: vi.fn(() => [])` in the `vi.hoisted()` block caused TypeScript to infer each mock's generic parameter from that initial arrow function's `never[]` return type. `vitest` itself runs fine (type errors are compile-time only), but `tsc --noEmit` (this file's own `npm run compile`) failed with 12 `Type '{...}' is not assignable to type 'never'` errors at every later `.mockReturnValue([{ ...real shape... }])` call added by this plan's new tests.
- **Fix:** Dropped the initial factory on both mocks (bare `vi.fn()`, matching `DetailPanel.test.tsx`'s own working `mockUseCollections: vi.fn()` pattern); the default `[]` return is set explicitly via `.mockReturnValue([])` in the file's top-level `beforeEach` (already present from this plan's own edit).
- **Files modified:** `web/src/components/vault/ItemForm.test.tsx`
- **Verification:** `npm run compile` exits 0 (was 12 errors before the fix); `npx vitest run src/components/vault/ItemForm.test.tsx src/components/vault/DetailPanel.test.tsx` -- 86/86 pass, unaffected.
- **Committed in:** `ea33c34` (folded into the Task 2 commit, since it was discovered while running Task 2's own compile verify step)

---

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** A pure type-inference correction with zero behavioral effect on any test's assertions -- necessary only to satisfy `npm run compile`'s own strictness, not a change to what any test proves.

## Issues Encountered

None beyond the deviation above. Every new unit test and the new live e2e test passed on their first genuine run against 32-01's already-shipped implementation -- no implementation bugs were found or fixed via Rule 1/2 deviations, consistent with this plan's own framing as pure verification of what 32-01 already built.

## Falsification (non-negotiable #1)

Every new test in this plan was falsification-proven -- the specific production behaviour it guards was reverted (via a temporary, fully-reverted edit to `ItemForm.tsx`), red was observed with its exact output, the revert was restored, and green was re-confirmed. All probes below were applied and reverted one at a time; `git diff --stat web/src/components/vault/ItemForm.tsx` showed zero diff after each restore.

1. **Dispatch-order test** (fired `moveVaultItem("PROBE-FAKE-ID", ...)` concurrently instead of awaiting `createVaultItem` first): `npx vitest run ... -t "never simultaneous via Promise.all"` -> red. `AssertionError: expected "spy" to not be called at all, but actually been called 1 times` -- `mockMoveVaultItem` had been invoked with `"PROBE-FAKE-ID"` before `createVaultItem`'s promise ever resolved. Restored -> green.
2. **C-2 conjunct test** (weakened the recovery condition to destination-only, dropping `&& fresh.revision === created.revision + 1`): `npx vitest run ... -t "C-2:"` -> red. `expect(await screen.findByTestId("item-form-submit-error"))...` timed out waiting for the error banner -- the weakened check wrongly recovered on a foreign-revision row and called `onCreated()`, closing the form instead of showing the error. This is the exact "test would pass against a destination-only implementation" failure mode the non-negotiable warned against, now proven NOT to occur. Restored -> green.
3. **Recovery-always-succeeds probe** (`if (true)` unconditionally, covering both the "genuine failure" and "genuine retry" tests): `npx vitest run ... -t "genuine"` -> 2 red. Genuine-failure test: `screen.findByTestId("item-form-submit-error")` timed out (the error banner never rendered because `onCreated()` fired unconditionally). Genuine-retry test: `AssertionError: expected "spy" to not be called at all, but actually been called 1 times` on `onCreated`, called after the FIRST failed attempt instead of waiting for a genuine second submit. Restored -> green.
4. **B-3 backstop removed entirely** (`if (false)`, simulating the getItems() already-landed check being deleted): `npx vitest run ... -t "B-3:"` -> red. `await waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1))` timed out -- `onCreated` was never called; the form instead showed `error.itemCreatedButMoveFailed`, a false failure report despite the server having genuinely committed the move. Restored -> green.
5. **B-2 item_bucket guard disabled** (`if (false && currentIsItemBucket)`, falling through to the shipped enabled select): `npx vitest run ... -t "B-2:"` -> red. `expect(select.disabled).toBe(true)` -> `AssertionError: expected false to be true` -- the select fell back to the bare, enabled `Bez folderu` path. Restored -> green.
6. **Zero-shared-optgroup-absent probe** (`{true ? (...) : null}`, always rendering the shared optgroup): `npx vitest run ... -t "zero shared collections"` -> red. `expect(select.querySelectorAll("optgroup")).toHaveLength(1)` -> `AssertionError: ... to have a length of 1 but got 2`. Restored -> green.
7. **Disabled-with-reason probe** (dropped the `disabled` attribute from `readOnlyShared` options): `npx vitest run ... -t "plain enabled option and non-edit"` -> red. `expect(readOption.disabled).toBe(true)` -> `AssertionError: expected false to be true`. Restored -> green.
8. **item_bucket-exclusion probe** (used `collections` directly instead of the `familyWideKind !== "item_bucket"`-filtered `sharedCollections`): `npx vitest run ... -t "never renders an item_bucket"` -> red. `expect(select.querySelector('option[value="collection:bucket-1"]')).toBeNull()` -> received a real `<option value="collection:bucket-1">Family Bucket</option>` element instead of `null`. Restored -> green.
9. **Live e2e probe** (create-mode dispatch's own move call gated behind an always-false `destinationCollectionId !== null && Date.now() < 0`, so the move is never sent): `CI=1 npx playwright test e2e/sharing.spec.ts -g "created directly in an existing shared folder" --retries=0` -> red. `Error: SC1 create-mode: the destination chosen BEFORE the first Save must be honored immediately -- never null/personal / Expected: "7bcec0e0-4191-40ca-b723-1b678849243e" / Received: null`. Restored -> green (re-confirmed live, `1 passed (13.1s)`).

After every probe was restored, `git diff --stat web/src/components/vault/ItemForm.tsx` showed no diff, confirming a clean revert each time.

## Verification (exact commands and results)

- `cd web && npx vitest run src/components/vault/ItemForm.test.tsx` -> **29 passed (29)** (19 pre-existing + 9 new + the mock-typing fix's surface, zero regressions).
- `cd web && npm run build` -> exits 0 (`prebuild` rebuilds `pv_wasm_bg.wasm`, `next build` TypeScript pass finishes in ~2s).
- `cd web && CI=1 npx playwright test e2e/sharing.spec.ts -g "created directly in an existing shared folder" --retries=0` -> **1 passed (13.1s-17.4s across runs)**, fresh `cargo build --release -p pv-server` + fresh `next build` each invocation (`reuseExistingServer: false` under `CI=1`).
- `cd web && npm run compile` (run after `npm run build`, per this phase's documented build-before-compile ordering hazard) -> exits 0, `tsc --noEmit` clean (after the Rule 3 fix; 12 errors before it).
- **Superset check beyond the plan's own `<verification>` block** (non-negotiable #4 -- a `-g` filter is legitimate for a single task's own check, but must not stand in as the only live evidence): `cd web && CI=1 npx playwright test e2e/sharing.spec.ts --retries=0` (the FULL spec file, no `-g`) -> **14 passed (1.3m)** -- all 13 pre-existing live tests plus the new one, zero regression from the new helper/test addition.
- `cd web && npx vitest run` (full suite) -> **93 test files, 1021 tests, all pass** -- confirms no regression outside this plan's own files (1012 in 32-01's own SUMMARY + 9 new = 1021, exact match).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

This plan closes 32-VALIDATION.md's own `32-02-01`/`32-02-02` rows in the Per-Task Verification Map (both were `⬜ pending`, both now `✅ green`), and resolves 32-01-SUMMARY.md's own coverage item D3 (the item_bucket guard's "not independently unit-tested in this plan" caveat -- now proven here with a falsification-checked test and its own explicit no-mis-file assertion).

32-04 (wave 4, SC3/SC4's TOCTOU and move-out proofs) depends only on 32-01's `moveVaultItem`/`moveItemToDestinationViaEditor` per 32-PLAN-CHECK.md B-5/W-7 -- unaffected by this plan, no new blockers.

**Finding for whoever plans/verifies next:** the plan's own three retry-safety bullets, taken literally, do NOT include a test that discriminates the C-2 revision conjunct from a destination-only recovery check -- see Decisions Made above. This plan added the missing test rather than adjusting it to match a gap in the plan text (per the orchestrator's own instruction: an unmet contract is a finding, reported with evidence, not silently patched over).

---
*Phase: 32-putting-things-into-shared-folders*
*Completed: 2026-08-19*

## Self-Check: PASSED

All files listed above verified present on disk; both task commits (`ad5f8cc`, `ea33c34`) verified present in `git log`.
