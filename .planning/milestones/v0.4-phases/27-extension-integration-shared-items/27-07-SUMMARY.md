---
phase: 27-extension-integration-shared-items
plan: 07
subsystem: extension-vault-sync
tags: [capture-handler, shared-collections, write-routing, aead, encrypt-dispatch, fail-loud]

requires:
  - phase: 27-04
    provides: "vault-store.ts's three-source shared-read merge and getItems()'s correctly-tagged collectionId/accessLevel fields on shared items -- confirmUpdateLogin's new dispatch reads these fields directly off the caller-cached item"
provides:
  - "capture-handler.ts's confirmUpdateLogin collection-aware encrypt dispatch: a personal item (collectionId null) is byte-identical to prior behavior; a collection-scoped item with edit/hidden_password access encrypts via encryptItemForCollection using collections-store.ts's cached Collection Key"
  - "ReadOnlyAccessError: refuses a read-only (or unrecognized-accessLevel, fail-closed) member's capture-confirm write BEFORE any encrypt call"
  - "CollectionKeyUnavailableError (capture-handler.ts's own local class): refuses the write when a collection-scoped item's Collection Key is not yet cached, never falling back to the personal User Key"
  - "router.ts's handleCaptureConfirmMessage catch chain gains ReadOnlyAccessError/CollectionKeyUnavailableError branches, same {status:'error', message} shape as the existing LockedVaultError/OwnershipMismatchError mapping"
affects: [27-11]

tech-stack:
  added: []
  patterns:
    - "confirmUpdateLogin's scope dispatch ports web/src/lib/vault/store.ts's updateVaultItem pattern verbatim: collectionId===null uses the personal encryptItem unchanged; collectionId!==null looks up getCollectionKey(collectionId) and either calls encryptItemForCollection or fails loud with a local CollectionKeyUnavailableError -- never falls back to the personal key"
    - "Read-only refusal gate runs BEFORE plaintext is built or any encrypt call is made, using accessLevel.ts's fail-closed vocabulary directly (accessLevel !== 'edit' && !== 'hidden_password' throws) rather than importing accessRank -- this file's own local error class, not accessLevel.ts's numeric rank, since the only decision needed is a binary refuse/proceed"

key-files:
  created: []
  modified:
    - extension/entrypoints/background/capture-handler.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/capture-handler.test.ts

key-decisions:
  - "CollectionKeyUnavailableError is capture-handler.ts's OWN local class (same shape as web's, not imported across the package boundary) -- per the plan's explicit action text, mirroring how LockedVaultError/OwnershipMismatchError already live in this file rather than being re-exported from web."
  - "The read-only gate checks accessLevel !== 'edit' && accessLevel !== 'hidden_password' directly rather than importing accessLevel.ts's accessRank -- the only decision this gate needs is binary (refuse vs proceed), so importing a 3-way numeric rank across the web/extension package boundary for a single inequality would add a dependency this file doesn't otherwise have, with no behavioral difference. accessLevel.ts's fail-closed philosophy (unrecognized value never treated as a valid grant) is preserved: an unrecognized value fails BOTH equality checks and is refused."
  - "The gate is scoped to collectionId != null only -- a personal item (collectionId absent/null) never enters the accessLevel check at all, keeping today's unconditional-write behavior byte-identical for the overwhelming majority of captures (every personal login)."

patterns-established: []

requirements-completed: [EXT-07]

coverage:
  - id: D1
    description: "confirmUpdateLogin routes a collection-scoped update (edit/hidden_password access) to encryptItemForCollection using the item's cached Collection Key, never the personal encryptItem"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts#updating a COLLECTION-scoped item with 'edit' access encrypts via encryptItemForCollection using the cached Collection Key, never encryptItem"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts#updating a COLLECTION-scoped item with 'hidden_password' access also encrypts via encryptItemForCollection"
        status: pass
    human_judgment: true
    rationale: "This suite mocks lib/crypto/wasm-loader (encryptItemForCollection is a vi.fn()), so it can only assert the function was CALLED with the expected key/scope/id/revision arguments -- never that a wrong-key encrypt would actually fail, or that the resulting ciphertext genuinely decrypts under the Collection Key for another member. Per 27-VALIDATION.md's non-negotiable evidence rule this is NOT admissible proof of the crypto correctness claim (T-27-25); that live cross-member write-then-read proof is explicitly deferred to 27-11 Task 3."
  - id: D2
    description: "A personal item's update (collectionId absent/null) is byte-identical to prior behavior -- unconditional encryptItem, no collections-store lookup"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts#updating a PERSONAL item (collectionId absent/null) is byte-identical to today's behavior -- encryptItem unchanged"
        status: pass
    human_judgment: false
  - id: D3
    description: "A read-only (or unrecognized-accessLevel, fail-closed) member's capture-confirm write throws ReadOnlyAccessError before any encrypt call is made"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts#updating a COLLECTION-scoped item with 'read' access throws ReadOnlyAccessError BEFORE any encrypt call"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts#updating a COLLECTION-scoped item with an unrecognized accessLevel fails closed, throwing ReadOnlyAccessError before any encrypt call"
        status: pass
    human_judgment: false
  - id: D4
    description: "A collection-scoped item whose Collection Key is not yet cached throws CollectionKeyUnavailableError, never falling back to encrypting under the personal User Key"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/capture-handler.test.ts#updating a COLLECTION-scoped item whose Collection Key is not yet cached throws CollectionKeyUnavailableError, never falling back to encryptItem"
        status: pass
    human_judgment: false

duration: ~10min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 07: capture-handler.ts Write-Routing Fix Summary

**confirmUpdateLogin now dispatches to encryptItemForCollection under the item's own cached Collection Key for collection-scoped updates, and refuses a read-only member's write before any encrypt call -- closing A-5's last unrouted write path in this phase's file inventory.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-08-08T19:09:00+02:00
- **Completed:** 2026-08-08T19:10:24+02:00
- **Tasks:** 1 (TDD: RED then GREEN)
- **Files modified:** 3

## Accomplishments

- `confirmUpdateLogin` reads `target.collectionId`/`target.accessLevel` (off the already-cached, already-decrypted item from `getItems()`) immediately after the existing WR-04 ownership re-check, and dispatches its encrypt call exactly like `web/src/lib/vault/store.ts`'s `updateVaultItem`: `collectionId === null` keeps the unconditional personal `encryptItem` unchanged; `collectionId !== null` looks up `collections-store.ts`'s cached Collection Key and calls `encryptItemForCollection`, or throws the new `CollectionKeyUnavailableError` if that key isn't cached -- never falling back to the personal key.
- New `ReadOnlyAccessError`: a collection-scoped item with `accessLevel === "read"` (or any unrecognized/absent-while-scoped value, fail-closed) throws BEFORE `plaintext` is built or any encrypt call is made. `edit` and `hidden_password` both proceed unchanged.
- `router.ts`'s `handleCaptureConfirmMessage` catch chain gains `instanceof ReadOnlyAccessError`/`instanceof CollectionKeyUnavailableError` branches, mapped to `{status: "error", message: e.message}` -- same shape as the existing `LockedVaultError`/`OwnershipMismatchError` branches.
- Six new unit tests cover all four plan-required behaviors (personal pass-through, edit dispatch, hidden_password dispatch, read-only refusal, unrecognized-accessLevel fail-closed refusal, missing-Collection-Key fail-loud refusal) -- all asserting the correct function was called/not-called and, for the refusal paths, that no downstream `updateItem` call ever happens.

## Task Commits

Each task was committed atomically:

1. **Task 1: confirmUpdateLogin — collection-aware encrypt dispatch + read-only refusal**
   - RED: `03974f9` (test)
   - GREEN: `789afcc` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/background/capture-handler.ts` - `ReadOnlyAccessError`/`CollectionKeyUnavailableError` classes; `confirmUpdateLogin`'s collection-aware dispatch and read-only gate
- `extension/entrypoints/background/router.ts` - `handleCaptureConfirmMessage`'s catch chain gains the two new error branches; import list extended
- `extension/entrypoints/background/capture-handler.test.ts` - `getCollectionKey`/`encryptItemForCollection` mocks, `loginItem()` helper's optional `scope` param, six new `confirmUpdateLogin` behaviors

## Decisions Made

See `key-decisions` in frontmatter above (3 decisions, each with full rationale).

## Deviations from Plan

None - plan executed exactly as written. The plan's own `<action>` text specified the exact dispatch shape, error class placement, and router.ts wiring; no gaps or blocking issues arose.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The capture-confirm write path is now the third and final routed write in this phase's inventory -- personal-vs-collection dispatch is consistent across `vault-store.ts` (read, 27-04), `provider-ceremony.ts` (dormant write-back, 27-06), and `capture-handler.ts` (active write, this plan).
- **Truth 1's actual crypto-correctness proof is NOT discharged here** -- this plan's own suite mocks `wasm-loader`, so it can only prove `encryptItemForCollection` was invoked, never that the key/scope/AAD/revision arguments were right. That proof is explicitly deferred to **27-11 Task 3** (member B capture-confirms a password update on a shared login; member A's extension reads back the new plaintext through real crypto), registered as T-27-25 in the plan's own `key_links`. 27-11 must not skip or weaken that test.
- `npm --prefix extension run test` full suite: 733/733 green. `npx tsc --noEmit` clean.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*

## Self-Check: PASSED
