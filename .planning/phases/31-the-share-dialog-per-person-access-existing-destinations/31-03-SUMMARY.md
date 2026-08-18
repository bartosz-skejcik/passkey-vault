---
phase: 31-the-share-dialog-per-person-access-existing-destinations
plan: 03
subsystem: ui
tags: [react, share-dialog, access-control, existing-destination, real-wasm, e2e]

# Dependency graph
requires:
  - phase: 31-02
    provides: "ShareDialog.tsx's per-row access model (RecipientRow, reconcileRowAction/reconcileRow), folder-scope grant/update/revoke dispatch wired but structurally unreachable until a destination selector existed"
provides:
  - "Destination Selector Contract (31-UI-SPEC.md): folder-scope-only <select> above the row list, offering 'Nowy folder…' or every accessLevel==='edit' && familyWideKind!=='item_bucket' collection from useCollections()"
  - "Row re-seed on destination switch: getCollectionAccessList(destinationId) re-fetched, every row's currentLevel/pendingLevel re-derived, never carrying a pending edit from the previous destination forward"
  - "submitRowsForExistingDestination (exported): the existing-destination row dispatch — grant via reshareCollectionToNewMember (Phase 30), update via updateCollectionAccess (31-01), revoke via revokeCollectionAccess (SHARE-06) — all three genuinely reachable against a real existing destination for the first time"
  - "ORG-03/SC3 real-WASM proof: a new recipient added to an existing destination decrypts an item that existed in it BEFORE they joined, through the actual production dispatch"
  - "Live e2e proof of SC1 (per-recipient levels land at their own chosen value) and SC2 (targeting an existing destination never mints a new collection)"
affects: [31-04, 31-05, 31-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "submitRowsForExistingDestination mirrors submitItemRows's shape exactly (actionable-row filter, reconcileRow dispatch, committedAnything = failed.length < actionable.length) — the same T-31-06 trust boundary applied to a third dispatch site"
    - "destinationRequestRef monotonic token guards handleDestinationChange's async fetch against a rapid second switch overwriting the latest selection's rows with a stale response"
    - "toggleFamilyWide resets destinationId to null when switching to family-wide, keeping the two modes independent (family-wide always mints; the folder-name input's render condition is destinationId === null)"

key-files:
  created: []
  modified:
    - web/src/components/vault/ShareDialog.tsx (destination selector state/handler, submitRowsForExistingDestination, submitFolderVariant's existing-destination short-circuit, rowsLoading region)
    - web/src/components/vault/ShareDialog.test.tsx (destination selector describe block: filter, item-scope absence, re-seed-on-switch, loading substate, grant/update/revoke dispatch-count tests)
    - web/src/components/vault/ShareDialog.real-wasm.test.ts (ORG-03/SC3 real-WASM case, network-layer mocks extended for reshareCollectionToNewMember's own dependencies)
    - web/src/lib/i18n/dictionary.ts (share.destinationLabel, share.destinationNewFolderOption, share.destinationNewGroupLabel, share.destinationExistingGroupLabel)
    - web/e2e/sharing.spec.ts (SC1, SC2 live tests)
    - .planning/phases/31-.../31-VALIDATION.md (31-03-T1/T2/T3 rows marked done)

key-decisions:
  - "toggleFamilyWide resets destinationId to null. Without this, a per-person destination chosen BEFORE switching to 'Cała rodzina' would leave the folder-name input hidden (destinationId !== null's render condition) while family-wide's own submit still required a non-empty name — an unreachable-submit dead end family-wide's isolation from the row model didn't originally have to consider, since no destination concept existed yet. This is a Rule 1 bug fix, not a plan deviation: family-wide's own submit path (createCollection, isFamilyWide branch) is otherwise byte-for-byte unchanged and never reads destinationId."
  - "submitFolderVariant's existing-destination branch short-circuits BEFORE ensureOwnIdentityKeypair/createdCollectionRef/seed-move machinery, rather than threading destinationId through the mint-new code path. The two paths share nothing crypto-wise (existing-destination grants unwrap-and-reseal per row via reshareCollectionToNewMember; mint-new batches one WasmCollectionKey across all rows), so keeping them as separate branches avoids forcing one dispatch shape to serve two genuinely different compositions."
  - "reshareCollectionToNewMember mocked wholesale in ShareDialog.test.tsx (component-level suite), per this file's own established WR-10 boundary — real crypto proof lives in ShareDialog.real-wasm.test.ts only. Required adding the mock to this file since 31-02 never imported this module."
  - "ShareDialog.real-wasm.test.ts's network-layer mock boundary extended to getCollection/addCollectionMember (@/lib/vault/api), ensureOwnIdentityKeypair (@/lib/identity/ensure), and getFamilyMembers (@/lib/families/api) — the same three call sites families/reseal.real-wasm.test.ts already mocks for the identical composition, since Task 2's test is this composition's SECOND real-WASM caller (via submitRowsForExistingDestination rather than reseal.ts's own exports directly)."

requirements-completed: [MOD-01, MOD-02, ORG-03]

coverage:
  - id: D1
    description: "The destination selector renders for folder scope only, offering 'Nowy folder…' plus every edit-held, non-item_bucket existing collection — never CollectionPicker's unfiltered list, never rendered for the item scope"
    requirement: "MOD-02"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx — 'destination selector (31-03-PLAN.md, MOD-02/ORG-03)' describe block, filter + item-scope-absence tests"
        status: pass
      - kind: e2e
        ref: "sharing.spec.ts SC2 — selects an existing destination from the same real selector live"
        status: pass
    human_judgment: false
  - id: D2
    description: "Switching destinations re-fetches the real access list and re-seeds every row's currentLevel/pendingLevel — a pending edit queued against the previous destination is never carried forward"
    requirement: "MOD-02"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx — 'switching to an existing destination re-fetches...never carried forward (Pitfall 3, T-31-10)'"
        status: pass
    human_judgment: false
  - id: D3
    description: "Existing-destination grant/update/revoke are all genuinely reachable and dispatch-correct — one call each, zero cross-dispatch, proven for all three branches (Blocker 7's atomicity for update, mandatory falsification)"
    requirement: "MOD-01, MOD-02"
    verification:
      - kind: unit
        ref: "ShareDialog.test.tsx — 'granting a NEW recipient...', 'dispatch-count against an EXISTING destination (Blocker 7, T-31-06)', 'setting an existing row to brak dostępu...' — falsification-proven (see below)"
        status: pass
    human_judgment: false
  - id: D4
    description: "ORG-03/SC3: a new recipient added to an existing destination decrypts an item that existed in it BEFORE they joined, through real (unmocked) crypto and the actual production dispatch"
    requirement: "ORG-03"
    verification:
      - kind: unit
        ref: "ShareDialog.real-wasm.test.ts — 'ORG-03/SC3: a new recipient on an EXISTING destination decrypts an item that was already in it (v0.4 WINDOWS #13)' — falsification-proven (see below)"
        status: pass
    human_judgment: false
  - id: D5
    description: "SC1: two real recipients, each set to a different level in one dialog submission, land on the server at their own chosen level (never each other's)"
    requirement: "MOD-01"
    verification:
      - kind: e2e
        ref: "sharing.spec.ts — 'SC1: two real recipients, each set to a DIFFERENT level in ONE dialog submission...'"
        status: pass
    human_judgment: false
  - id: D6
    description: "SC2: submitting a share against an already-existing destination adds a member without creating a new collection — collection id set unchanged, the new grant lands under the pre-chosen destination id"
    requirement: "MOD-02"
    verification:
      - kind: e2e
        ref: "sharing.spec.ts — 'SC2: submitting a share against an ALREADY-EXISTING destination adds a member without creating a new collection...'"
        status: pass
    human_judgment: false

# Metrics
duration: ~30min
completed: 2026-08-18
status: complete
---

# Phase 31 Plan 03: Destination selector — target an existing shared folder Summary

**Adds the folder-scope destination selector (MOD-02) above the row list, which makes the previously-wired-but-unreachable existing-destination grant/update/revoke dispatch fire for the first time; proves ORG-03/SC3 (a new recipient decrypts pre-existing content) through real crypto; and closes SC1/SC2 live against a real server.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-08-18 (single session)
- **Tasks:** 3/3
- **Files modified:** 6 (1 component, 2 unit/real-wasm test files, 1 dictionary, 1 e2e spec, 1 validation doc)

## Accomplishments

- `ShareDialog.tsx`'s folder scope now renders a destination `<select>` (`share-destination-select`) above the row list, per 31-UI-SPEC.md's Destination Selector Contract exactly: `optgroup`s for "Utwórz nowy" (value `"new"`) and "Istniejące foldery" (`useCollections()` filtered to `accessLevel === "edit" && familyWideKind !== "item_bucket"` — the same predicate `SharingOverviewPanel.tsx:315` already uses, never `CollectionPicker`'s unfiltered list).
- Switching destinations calls `getCollectionAccessList(destinationId)` and re-seeds every row's `currentLevel`/`pendingLevel` from the real result, with a `rowsLoading` sub-state for the row region only (the select itself stays interactive) and a monotonic request-token guard against a rapid second switch overwriting the latest selection with a stale response.
- New exported `submitRowsForExistingDestination(destinationId, rows, uk)` dispatches through the SAME `reconcileRow` decision function 31-02 already proved for the item scope: grant → `reshareCollectionToNewMember` (Phase 30, real-WASM-proven — unwraps the caller's own key, reseals the SAME key, never `WasmCollectionKey.generate()`), update → `updateCollectionAccess` (31-01), revoke → `revokeCollectionAccess` (SHARE-06) — all three genuinely reachable against a real existing destination for the first time. `submitFolderVariant` short-circuits into this function before any mint-new machinery (`createCollection`, `createdCollectionRef`, seed-move) runs.
- `toggleFamilyWide` now resets `destinationId` to `null` when switching to family-wide — an auto-fixed correctness gap (Rule 1): without it, a previously-chosen destination would hide the folder-name input while family-wide's own submit still required one, an unreachable-submit dead end.
- `ShareDialog.real-wasm.test.ts` gained the ORG-03/SC3 case: Bob, added via the actual `submitRowsForExistingDestination` → `reshareCollectionToNewMember` dispatch, unwraps the destination's resealed key with his own real identity secret key and decrypts an item encrypted under the real `CollectionKey` BEFORE he was ever granted access.
- `sharing.spec.ts` gained SC1 (two real recipients, different levels, one submission, server state read confirms each lands at their own level) and SC2 (collection id set captured before/after targeting an existing destination — unchanged — and the new grant lands under the pre-chosen destination id).

## Task Commits

1. **Task 1:** `feat(31-03): destination selector — target an existing shared folder (MOD-02, ORG-03)` — `9538197`
2. **Task 2:** `test(31-03): real-WASM proof — a new recipient on an existing destination decrypts pre-existing items (ORG-03/SC3)` — `5b8285e`
3. **Task 3:** `test(31-03): live e2e for SC1 (per-person levels) and SC2 (existing destination, no new collection)` — `63285dc`

## Files Created/Modified

- `web/src/components/vault/ShareDialog.tsx` — destination selector state (`destinationId`, `rowsLoading`, `destinationRequestRef`), `handleDestinationChange`, `submitRowsForExistingDestination` (exported), `submitFolderVariant`'s existing-destination short-circuit, `toggleFamilyWide`'s destination reset, row-region loading markup, folder-name input's `destinationId === null` render gate
- `web/src/components/vault/ShareDialog.test.tsx` — `mockReshareCollectionToNewMember`, `vi.mock("@/lib/families/reseal", ...)`, global `clearCollectionsOnRemoval()` reset in `beforeEach` (hygiene fix — the real `useCollections()` store now backs live rendering, not just the pre-existing "collections store integration" tests), and the new "destination selector (31-03-PLAN.md, MOD-02/ORG-03)" describe block (8 tests)
- `web/src/components/vault/ShareDialog.real-wasm.test.ts` — network-layer mocks for `getCollection`/`addCollectionMember`/`ensureOwnIdentityKeypair`/`getFamilyMembers`, `beforeEach(vi.clearAllMocks)`, and the ORG-03/SC3 describe block
- `web/src/lib/i18n/dictionary.ts` — `share.destinationLabel`/`destinationNewFolderOption`/`destinationNewGroupLabel`/`destinationExistingGroupLabel` (verbatim per 31-UI-SPEC.md)
- `web/e2e/sharing.spec.ts` — SC1, SC2 live tests, both opened via `sidebar-new-shared-folder-button` (the existing generic `{kind:"folder", existingFolderId:null}` entry point)
- `.planning/phases/31-.../31-VALIDATION.md` — 31-03-T1/T2/T3 rows marked `✅ done`

## Decisions Made

- **`toggleFamilyWide` resets `destinationId` to `null`** (Rule 1 auto-fix, not in the plan's own `<action>` text). Discovered while wiring the render conditions: `destinationId === null` gates the folder-name input's visibility (per 31-UI-SPEC.md), but family-wide's own submit path always requires a non-empty name regardless of `destinationId` (it never reads that field, always minting). Without the reset, choosing an existing destination and THEN checking "Cała rodzina" would hide the required name field while still requiring it — an unreachable submit. Documented in the code at both the reset call site and the early-return condition it makes safe to simplify.
- **`submitFolderVariant`'s existing-destination branch is a short-circuit, not a threaded parameter.** The two dispatch shapes (mint-new's single batched `WasmCollectionKey` vs. existing-destination's per-row unwrap-and-reseal via `reshareCollectionToNewMember`) share no crypto composition, so branching early avoids forcing one function to own two structurally different sequences.
- **`reshareCollectionToNewMember` mocked wholesale in the component-level test file**, matching this file's own established WR-10 discipline (crypto-adjacent compositions are mocked at the component level; real crypto is proven only in `.real-wasm.test.ts`). Required adding the mock since 31-02 never imported `@/lib/families/reseal` — this plan's Task 1 is its first import.
- **`clearCollectionsOnRemoval()` added to the global `beforeEach`** in `ShareDialog.test.tsx`. Before this plan, `useCollections()`'s real singleton store was consumed only by the "collections store integration" describe block; nothing else rendered its contents, so leaked state between tests was invisible. Now that the destination selector reads it for every folder-scope render, leaked collections from an earlier test would silently populate a later test's "Istniejące foldery" group. This reset makes every test start from a known-empty store — a hygiene improvement that also makes the pre-existing "collections store integration" tests' own `expect(getCollections().some(...)).toBe(false)` opening assertion a guaranteed fact rather than an accident of run order.

## Deviations from Plan

**Non-deviations recorded for clarity.** Every code path matches the plan's `<action>` text: the destination selector's markup, filter predicate, and dictionary keys are verbatim per 31-UI-SPEC.md's Destination Selector Contract; the row re-seed-on-switch logic matches Pitfall 3's rule exactly; `submitRowsForExistingDestination` dispatches grant/update/revoke through the same `reconcileRow` shape 31-02 established for the item scope; the ORG-03/SC3 real-WASM test calls the actual production dispatch, never a re-implementation; SC1/SC2 assert real server state, never inferred from the UI. The `toggleFamilyWide` reset above is the one auto-fix beyond the plan's literal text — Rule 1 (bug fix), documented above.

**No test deleted or weakened.** Every pre-existing test in `ShareDialog.test.tsx` (55 → 63), `ShareDialog.real-wasm.test.ts` (3 → 4), and `sharing.spec.ts`/`shared-sync.spec.ts`/`export-disclosure.spec.ts`/`family-wide-sharing.spec.ts` (21 → 23) still passes unmodified.

## Falsifications (mandatory, exact observed output)

**1. Dispatch-count test (folder branch, existing destination, T-31-06/Blocker 7).** Temporarily replaced `submitRowsForExistingDestination`'s `update` op with a revoke-then-re-add pair (`revokeCollectionAccess` then `addCollectionMember`), re-ran the dispatch-count test alone:

```
FAIL  src/components/vault/ShareDialog.test.tsx > ShareDialog > destination selector (31-03-PLAN.md, MOD-02/ORG-03) > dispatch-count against an EXISTING destination (Blocker 7, T-31-06) > a row transitioning read -> edit issues EXACTLY ONE updateCollectionAccess call and ZERO reshareCollectionToNewMember/addCollectionMember/revokeCollectionAccess calls for that userId
AssertionError: expected "spy" to be called 1 times, but got 0 times
 ❯ src/components/vault/ShareDialog.test.tsx:1166:44
    1166|         expect(mockUpdateCollectionAccess).toHaveBeenCalledTimes(1);
```

Restored the single `updateCollectionAccess` call; reran the full `ShareDialog.test.tsx` suite — 63/63 green again.

**2. ORG-03/SC3 real-WASM test.** Temporarily made `reshareCollectionToNewMember`'s grant reseal a FRESHLY GENERATED key (`WasmCollectionKey.generate()`) instead of the unwrapped existing one, re-ran the ORG-03/SC3 test alone:

```
❯ src/components/vault/ShareDialog.real-wasm.test.ts (4 tests | 1 failed | 3 skipped) 12ms
   × ORG-03/SC3: a new recipient on an EXISTING destination decrypts an item that was already in it (v0.4 WINDOWS #13) > Bob, newly added via the dialog's real reshare dispatch, unwraps the destination's sealed_key and decrypts a PRE-EXISTING item back to the original plaintext 6ms
     → decryption failed (wrong key or corrupted data)

Unknown Error: decryption failed (wrong key or corrupted data)
```

A genuine decrypt failure — the recipient's unwrapped key no longer matched the item's actual encryption key, exactly the failure mode SC3 exists to rule out. Restored `reshareCollectionToNewMember` to its original form (`git diff` confirmed byte-identical to the committed state); reran `ShareDialog.real-wasm.test.ts` — 4/4 green again.

## Issues Encountered

None beyond the `toggleFamilyWide` reset documented above under Decisions Made.

## Verification

Exact results and exit codes of every CI-width command, run in order after both falsifications above were restored:

1. **Task 1's `<verify>`:** `cd web && npm run compile && npm test && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0`
   - `npm run compile` — exit 0, `tsc --noEmit` clean.
   - `npm test` — exit 0, `Test Files 92 passed (92)`, `Tests 985 passed (985)` (pre-Task-2 baseline; Task 2 added the 986th).
   - `npm run build` — exit 0, `next build` compiled successfully, all 5 static pages generated.
   - `npx playwright test` (four specs) — exit 0, `21 passed (1.5m)`.
2. **Task 2's `<verify>`:** `cd web && npm run compile && npm test`
   - `npm run compile` — exit 0.
   - `npm test` — exit 0, `Test Files 92 passed (92)`, `Tests 986 passed (986)` (includes the new ORG-03/SC3 case).
3. **Task 3's `<verify>`:** `cd web && npm run build && npx playwright test e2e/sharing.spec.ts e2e/shared-sync.spec.ts e2e/export-disclosure.spec.ts e2e/family-wide-sharing.spec.ts --retries=0`
   - `npm run build` — exit 0.
   - `npx playwright test` (four specs, full width, never `-g` filtered as acceptance) — exit 0, `23 passed (2.5m)` (21 pre-existing + SC1 + SC2).
4. **Plan-level `<verification>`** (superset of the above, run at the end): all four commands above, plus the full `npm test` (986 tests) and full four-spec Playwright run (23 tests) — all green.

`data/pv.db` checksum (`sha256:8e043c9d...b997c8`) identical before and after every live run — the dev database was never touched; the e2e harness uses its own throwaway `PV_E2E_DB_DIR` per `playwright.config.ts`.

Port 8620 was free before the first live run; Playwright's `webServer` built and ran `target/release/pv-server` itself.

## Next Phase Readiness

Folder-scope sharing against an existing destination is now fully wired end to end: grant, update, and revoke all dispatch-proven against a real destination, ORG-03/SC3's decrypt-pre-existing-content claim is real-WASM-proven, and SC1/SC2 are live-proven against real server state. 31-04 (the pending-revocations honesty summary and the sixth proof obligation's positive-read-before-revoke/negative-read-after live proof) can build directly on `submitRowsForExistingDestination`'s revoke branch and the destination selector's row re-seed, both now stable. No blockers.

## Self-Check: PASSED

All 6 modified files verified present on disk with the expected changes. All 3 task commit hashes (`9538197`, `5b8285e`, `63285dc`) verified present in `git log`.

---
*Phase: 31-the-share-dialog-per-person-access-existing-destinations*
*Completed: 2026-08-18*
