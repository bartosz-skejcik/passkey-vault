---
phase: 32-putting-things-into-shared-folders
plan: 01
subsystem: vault
tags: [react, crypto, wasm, playwright, e2e, sharing]

requires:
  - phase: 32-putting-things-into-shared-folders (plan 03, wave 1)
    provides: "cargo clippy --workspace --all-targets -- -D warnings exits 0 -- landed BEFORE this plan per 32-PLAN-CHECK.md B-5's build-hazard serialization (web/playwright.config.ts builds pv-server from the live tree for every live verify run in this plan)"
provides:
  - "moveVaultItem(id, rawFields, currentRevision, newCollectionId) in web/src/lib/vault/store.ts -- the decrypt-nothing, encrypt-under-destination-key move"
  - "ItemForm.tsx's item-folder-select renders grouped Moje foldery/Udostępnione foldery optgroups, dispatching to moveVaultItem only when the destination actually changes"
  - "The item_bucket current-scope guard: an item currently in a family-wide bucket renders a disabled select naming its real scope, never the shipped enabled 'Bez folderu' fallback"
  - "Retry-safe create-then-move sequencing, including lost-response recovery in moveVaultItem itself and a revision-conjunct backstop in ItemForm"
affects: [32-02, 32-04]

tech-stack:
  added: []
  patterns:
    - "A store mutator can be safe encrypt-only (never decrypting current ciphertext) when its ONLY caller structurally guarantees live, complete plaintext -- documented as an explicit precondition doc comment on the function, with a named warning against widening any OTHER caller to use it without switching to a decrypt-source shape first."
    - "Lost-response recovery for an at-most-once mutation: re-fetch the row and require BOTH 'landed at the destination' AND 'revision === expected + 1' before treating a failed request as a recovered success -- destination-only recovery is unsound on a retry (it recovers a PRIOR attempt's commit and reports success over content that attempt never wrote)."
    - "A disabled, honestly-labelled single-option <select> (never a bare enabled fallback) is how a UI declares 'you cannot change this here, go there instead' without silently letting the control lie about state."

key-files:
  created:
    - web/src/lib/vault/moveVaultItem.real-wasm.test.ts
  modified:
    - web/src/lib/vault/store.ts
    - web/src/components/vault/ItemForm.tsx
    - web/src/components/vault/DetailPanel.tsx
    - web/src/components/vault/DetailPanel.test.tsx
    - web/src/lib/i18n/dictionary.ts
    - web/e2e/sharing.spec.ts

key-decisions:
  - "moveVaultItem is encrypt-only (never decrypts the item's current ciphertext), a deliberate, plan-check-verified departure from RESEARCH.md's literal decrypt-source/encrypt-dest pattern -- safe only because its one real caller (ItemForm) already holds live, complete plaintext, and correctly captures a content edit made in the SAME save as a destination change instead of silently discarding it."
  - "The lost-response recovery's revision conjunct (revision === currentRevision + 1, not destination-only) is load-bearing per 32-PLAN-CHECK.md iteration 2's C-2 finding -- implemented in both moveVaultItem's own recovery and ItemForm's create-mode backstop, with the identical reasoning documented at both sites."
  - "A RevisionConflictError in create mode routes to conflict copy (error.revisionConflict / error.revisionConflictAttributed), never the retry-inviting error.itemCreatedButMoveFailed string -- inviting a retry into a conflict is the same retry-lie shape B-3 exists to close."

requirements-completed: [ORG-01, ORG-02, ORG-04]

coverage:
  - id: D1
    description: "moveVaultItem re-encrypts under the destination scope's key across all four directions (personal->collection, collection->personal, collection->collection, and the client-detectable unavailable-key refusal) against genuine WASM crypto, with negative cross-key AEAD-failure checks proving the destination key genuinely differs"
    requirement: "ORG-02"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/moveVaultItem.real-wasm.test.ts (4 tests, real WASM, zero @/lib/crypto mocking)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An item moved via the item editor into an existing shared folder lands on the server, survives the owner's real reload (SC1), and a real second account reads its actual decrypted content live (SC2)"
    requirement: "ORG-01"
    verification:
      - kind: e2e
        ref: "web/e2e/sharing.spec.ts -g \"moved via the item editor\" (live, two real Playwright sessions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The item_bucket current-scope guard renders a disabled select naming the item's real scope instead of the shipped enabled 'Bez folderu' fallback (B-2, mis-file prevention)"
    verification:
      - kind: other
        ref: "web/src/components/vault/ItemForm.tsx renderFolderBlock -- not independently unit-tested in this plan; 32-02 Task 1 (wave 3) owns ItemForm.test.tsx's assertion of this branch per 32-VALIDATION.md's own verification map"
        status: unknown
    human_judgment: true
    rationale: "This plan's own verify commands (real-WASM unit test + the single live e2e spec) do not exercise the item_bucket branch -- 32-VALIDATION.md's Per-Task Verification Map assigns that assertion to 32-02-01 (ItemForm.test.tsx, wave 3, not yet executed). Implemented per 32-PLAN-CHECK.md's B-2 fix and self-checked by reading the rendered branch structurally (single disabled option, no fallback to the shipped path), but not proven by an automated test IN THIS PLAN."

duration: ~75min
completed: 2026-08-19
status: complete
---

# Phase 32 Plan 01: moveVaultItem + a real destination control, wired end-to-end Summary

**`moveVaultItem` (encrypt-under-destination-key, decrypt-nothing) wired into ItemForm's new grouped item-folder-select for both edit and create modes, proven live by a real two-session Playwright run (owner moves an item via the editor, destination survives reload, a real second account reads the decrypted content) and by a four-case real-WASM dispatch proof.**

## Performance

- **Duration:** ~75 min
- **Tasks:** 2 planned tasks, both completed exactly as specified (no Rule 4 escalations)
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- `moveVaultItem(id, rawFields, currentRevision, newCollectionId)` added to `web/src/lib/vault/store.ts` -- re-encrypts an item's live plaintext under the destination scope's own key (personal `UserKey` or a `CollectionKey`), dispatches to `moveItemToCollection` (unchanged `vault.rs::move_item` wire contract), and recovers transparently from a lost/aborted response via a revision-conjuncted re-fetch rather than reporting a false failure.
- `ItemForm.tsx`'s `item-folder-select` restructured into `Bez folderu` / `Moje foldery` (`<optgroup>`) / `Udostępnione foldery` (`<optgroup>`, absent entirely when there are zero shared collections) -- shared folders the caller cannot write to render disabled with the reason inline; family-wide `item_bucket` collections never appear as a selectable destination.
- The `item_bucket` current-scope guard (B-2): an item currently living in a family-wide bucket renders a **disabled** select whose single option names the item's real scope and points at the sharing dialogs, instead of the shipped select's bare, enabled `Bez folderu` fallback (which would have let a user mis-file a bucket item under a personal folder while it silently stayed in the bucket).
- Edit mode dispatches to `moveVaultItem` only when the selected destination genuinely differs from the item's current `collectionId`; an unchanged destination still routes through the untouched `updateVaultItem`.
- Create mode's retry-safe two-call sequence: `createVaultItem` fires at most once per submission attempt (tracked via `createdItemState`), the move half is wrapped in its own try/catch, and a genuine failure refreshes `createdItemState`'s revision from the store (never re-sends a now-stale `expected_revision`) while withholding `onCreated()` until the full sequence has actually succeeded.
- `DetailPanel.tsx` passes `item.collectionId` into `ItemForm` as `currentCollectionId`, and its edit-mode `onError` now routes `CollectionKeyUnavailableError` to a dedicated, non-retry-inviting `moveRefused` banner (`error.itemMoveAccessLost`) -- the client-visible TOCTOU refusal ORG-02 requires.
- Five new dictionary keys (`item.myFoldersGroup`, `item.sharedFoldersGroup`, `item.folderReadOnlyOption`, `item.folderLockedByFamilyShare`, `error.itemCreatedButMoveFailed`, `error.itemMoveAccessLost`), plus reuse of the pre-existing `error.revisionConflict`/`error.revisionConflictAttributed` keys for create-mode conflict copy.
- Live proof: one new two-session Playwright test in `web/e2e/sharing.spec.ts` (`-g "moved via the item editor"`) -- owner creates an item, creates and shares a personal folder at `edit`, moves the item via the item editor (not the unrelated context-menu mechanism), reloads, and the server-side `collection_id` matches the destination (SC1); the member reloads and reads the item's real decrypted name/password via the file's existing `assertRecipientDecrypts` helper (SC2).
- Real-WASM proof: `web/src/lib/vault/moveVaultItem.real-wasm.test.ts`, four cases (personal→collection, collection→personal, collection→collection, unavailable-key refusal before any network call), each positive case's ciphertext decrypted through the real destination path and asserted to FAIL AEAD authentication under a different collection's key.

## Task Commits

Each task was committed atomically:

1. **Task 1: moveVaultItem + a real destination control, wired end-to-end (create and edit)** - `86b00c0` (feat)
2. **Task 2: real-WASM proof of moveVaultItem's destination-key dispatch, all directions** - `86eabcb` (test)

_No separate plan-metadata commit yet -- this SUMMARY/STATE/ROADMAP commit is the final commit for this plan (see `<final_commit>` below)._

## Files Created/Modified

- `web/src/lib/vault/store.ts` - `moveVaultItem` added (with its `isForbiddenError` duck-typed 403 check and lost-response recovery); imports `moveItemToCollection`/`listItems` from `./api`
- `web/src/components/vault/ItemForm.tsx` - `currentCollectionId` prop, `destinationCollectionId`/`createdItemState` state, restructured `renderFolderBlock()` (item_bucket guard + grouped optgroups), restructured `handleSubmit()`'s edit/create dispatch
- `web/src/components/vault/DetailPanel.tsx` - passes `currentCollectionId={item.collectionId ?? null}` into `ItemForm`; `saveError` widened with `"moveRefused"`, routed from `CollectionKeyUnavailableError`
- `web/src/components/vault/DetailPanel.test.tsx` - `@/lib/vault/store` mock extended to export `moveVaultItem`/`getItems`/`CollectionKeyUnavailableError` (deviation, see below)
- `web/src/lib/i18n/dictionary.ts` - 6 new keys for the destination control and the two create/edit move-failure copy strings
- `web/e2e/sharing.spec.ts` - `moveItemToDestinationViaEditor` helper + the new live two-session test proving SC1/SC2 together
- `web/src/lib/vault/moveVaultItem.real-wasm.test.ts` (new) - the four-case real-WASM dispatch proof

## Decisions Made

- **Encrypt-only `moveVaultItem` (no decrypt-source step).** Deliberate departure from RESEARCH.md's Pattern 1, independently re-verified safe by 32-PLAN-CHECK.md: the function's signature requires `ItemFields`, its only caller is `ItemForm`, and `DetailPanel` gates edit mode behind `canEditItem` so a `read`/`hidden_password` holder never mounts the form with content to move. Documented as an explicit precondition doc comment on the function (W-6), including a named warning against widening the UNRELATED `moveItemToFolder`/context-menu-move mechanism to accept a collection id without first switching to a genuine decrypt-source shape.
- **The revision conjunct in lost-response recovery is load-bearing, not belt-and-braces (C-2).** Implemented identically in both `moveVaultItem`'s own recovery and `ItemForm`'s create-mode backstop: recovery requires `collection_id === newCollectionId` **and** `revision === currentRevision + 1` (or `created.revision + 1` in the ItemForm backstop) before treating a failed request as recovered. A destination-only check would recover a PRIOR attempt's commit on a retry and report success over content that attempt never actually wrote, silently discarding the user's latest edit.
- **The recovery re-fetch is wrapped.** If the recovery `listItems()` call itself throws, the ORIGINAL error is rethrown (never the fetch error) so a network blip during recovery can never mask a genuine TOCTOU 403 -- the one refusal path this phase's threat register requires stays surfaced.
- **Route by error type in create mode, not one string.** A `RevisionConflictError` gets the existing `error.revisionConflict`/`error.revisionConflictAttributed` copy (no new key needed); every other failure keeps `error.itemCreatedButMoveFailed`, whose retry invitation is licensed to be true only because B-3's recovery mechanism makes a genuine retry always send the item's current revision.
- **Reused `getCollectionAccessLevel`/`getCollectionKey` from `collections.ts`** for `moveVaultItem`'s destination-key lookup and the resulting `VaultItem.accessLevel` carry-forward, mirroring `decryptItemRow`'s existing dispatch exactly rather than inventing a parallel lookup.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] `DetailPanel.test.tsx`'s `@/lib/vault/store` mock was missing exports ItemForm now needs**
- **Found during:** Task 1, first post-implementation test run (`npx vitest run ... DetailPanel.test.tsx`)
- **Issue:** `DetailPanel.test.tsx` renders the real `ItemForm` component (not mocked) against a hand-rolled `vi.mock("@/lib/vault/store", ...)`. `ItemForm.tsx` now also imports `moveVaultItem`, `getItems`, and `CollectionKeyUnavailableError` from that module -- the existing mock had none of the three, so `DetailPanel.tsx`'s own new `err instanceof CollectionKeyUnavailableError` check threw `"No CollectionKeyUnavailableError export is defined on the mock"` at runtime, failing 2 pre-existing tests with unhandled rejections.
- **Fix:** Added `mockMoveVaultItem`/`mockGetItems` (defaulted to `vi.fn(() => [])`) and a `MockCollectionKeyUnavailableError` class (same shape/`instanceof`-compatible pattern as the file's existing `MockRevisionConflictError`/`MockDirectShareNotEditableError`) to the `vi.hoisted()` block and the mock module's exports.
- **Files modified:** `web/src/components/vault/DetailPanel.test.tsx`
- **Verification:** `npx vitest run src/components/vault/DetailPanel.test.tsx` -- 57/57 pass (was 55/57 before the fix, with 2 unhandled-rejection errors).
- **Committed in:** `86b00c0` (part of the Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3).
**Impact on plan:** Necessary to keep the pre-existing test suite green after Task 1's real change to `ItemForm.tsx`'s imports -- no scope creep beyond making the mock module match the real module's surface `ItemForm` now depends on.

## Issues Encountered

None beyond the deviation above. Both the real-WASM unit test file and the live Playwright test passed on their first genuine run against this plan's implementation; no implementation bugs were found and fixed via Rule 1/2 deviations.

## Falsification (non-negotiable #2)

Every new test in this plan was falsification-proven -- the guarded behavior was reverted, red was observed with its exact output, the revert was restored, and green was re-confirmed:

1. **`moveVaultItem.real-wasm.test.ts`, probe 1** (`store.ts`'s destination-key `if/else` forced to always take the personal-key branch): `npx vitest run src/lib/vault/moveVaultItem.real-wasm.test.ts` → 3 of 4 tests failed. Tests 1 and 3 (collection destinations): `Unknown Error: decryption failed (wrong key or corrupted data)` from the `decryptItemForCollection` round-trip assertion. Test 4 (unavailable-key refusal): `AssertionError: promise resolved "{ …(8) }" instead of rejecting` (the forced-personal branch silently "succeeded" instead of throwing `CollectionKeyUnavailableError`). Test 2 (the one genuinely-personal-destination case) passed even under this probe, as expected -- it has no distinguishing power there.
2. **`moveVaultItem.real-wasm.test.ts`, probe 2** (`moveVaultItem`'s `newRevision` computed as `currentRevision` instead of `currentRevision + 1`): reran the same command → Tests 1, 2, AND 3 all failed with `Unknown Error: decryption failed (wrong key or corrupted data)` (the AAD-bound revision mismatch broke every decrypt round trip, including Test 2's previously-unaffected case). Test 4 was unaffected (revision-unrelated), as expected.
3. Restored both probes; reran `npx vitest run src/lib/vault/moveVaultItem.real-wasm.test.ts src/lib/vault/store.real-wasm.test.ts src/lib/vault/store.test.ts src/components/vault/ItemForm.test.tsx src/components/vault/DetailPanel.test.tsx` → 158/158 green.
4. **`web/e2e/sharing.spec.ts`'s new live test** (`ItemForm.tsx`'s edit-mode dispatch forced to always call `updateVaultItem`, never `moveVaultItem`, regardless of the selected destination): fresh `CI=1` live run of `-g "moved via the item editor"` → red with `Error: SC1: the destination survives save AND a real reload / Expected: "def5be57-833e-487e-9b6a-9ff0af368220" / Received: null` (the server-side `collection_id` stayed `null` because the item was never actually moved). Restored the fix; reran fresh (`CI=1`, fresh `PV_E2E_DB_DIR`, fresh `pv-server`/`web` build) → green, `1 passed (15.3s)`. `data/pv.db`'s SHA-256 checksum was identical before and after both the baseline and the post-restore live runs (`8e043c9d...b997c8`), confirming the throwaway `PV_E2E_DB_DIR` genuinely isolated the run from the developer's real database.

## Verification (exact commands and results)

- `cd web && npx vitest run src/lib/vault/moveVaultItem.real-wasm.test.ts` → **4 passed (4)**, real WASM, zero `@/lib/crypto` mocking.
- `cd web && npm run build` → exits 0 (`prebuild` rebuilds `pv_wasm_bg.wasm`, populates `packages/pv-ui/node_modules`, `next build` TypeScript pass finishes in ~4s).
- `cd web && CI=1 PV_E2E_DB_DIR=<fresh tmp dir> npx playwright test e2e/sharing.spec.ts -g "moved via the item editor" --retries=0` → **1 passed**, fresh `cargo build --release -p pv-server` + fresh `next build` each invocation (`reuseExistingServer: false` under `CI=1`), port 8620 confirmed free before each run.
- `cd web && npm run compile` (run after `npm run build`, per this phase's documented build-before-compile ordering hazard) → exits 0, `tsc --noEmit` clean.
- `cd web && npx vitest run` (full suite) → **93 test files, 1012 tests, all pass** -- confirms no regression outside this plan's own files.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

`moveVaultItem` and the restructured `item-folder-select` are ready for 32-02 (wave 3) to build on: `ItemForm.test.tsx`'s own assertions of the item_bucket guard, the optgroup absent-vs-empty fork (resolved here per W-3 as "absent"), the disabled-attribute check, and the create-mode retry-safety describe block (including the lost-response case) are 32-02's own scope per `32-VALIDATION.md`'s Per-Task Verification Map -- not re-derived here. 32-04 (wave 4, SC3/SC4 TOCTOU and move-out proofs) depends only on this plan's `moveVaultItem`/`moveItemToDestinationViaEditor` (32-PLAN-CHECK.md W-7), both of which are in place. No blockers identified for either.

---
*Phase: 32-putting-things-into-shared-folders*
*Completed: 2026-08-19*

## Self-Check: PASSED

All files listed above verified present on disk; both task commits (`86b00c0`, `86eabcb`) verified present in `git log`.
