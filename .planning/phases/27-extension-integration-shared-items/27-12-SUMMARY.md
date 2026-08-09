---
phase: 27-extension-integration-shared-items
plan: 12
subsystem: extension-vault-sync
tags: [vault-store, shared-collections, i18n, real-wasm, ui-spec, gap-closure]

requires:
  - phase: 27-04
    provides: "vault-store.ts's CollectionKeyPendingError, markPending()/clearPending()/getPendingSharedItems() trio, and the merged pending+broken single-array decision this plan preserves and refines"
  - phase: 27-08
    provides: "ItemListView.tsx's E2 pending-decrypt skeleton row loop (previously unreachable-broken-treatment consumer, now wired live)"
provides:
  - "vault-store.ts's PendingSharedItemEntry.status ('pending' | 'broken'), computed from the same CollectionKeyPendingError/hasRefreshedThisSession() signal decryptItemRow already derives"
  - "markPending()'s upsert-on-reattempt semantics -- a row first classified 'pending' is correctly upgraded to 'broken' on a later attempt once the Collection Key resolves and decrypt still fails, never stuck at its first classification"
  - "vault-store.real-wasm.test.ts -- real-WASM proof (genuine AEAD wrong-key integrity failure, not a mocked throw) that the classification is correct against real crypto"
  - "MessageResponseMap['vault.list'].pending typed as PendingSharedItemEntry[] -- the discriminant now flows across the background/popup message boundary"
  - "ItemListView.tsx's broken-row degraded treatment -- a status:'broken' pending entry renders a terminal, non-interactive AlertTriangle warning row instead of shimmering forever, closing UI-SPEC's E2-error backstop"
  - "sync.itemUndecryptableWarning's corrected PL/EN copy -- no longer falsely claims a retained 'last known version' is shown (this extension retains no VaultItem for a broken shared row, unlike web)"
affects: [27-13]

tech-stack:
  added: []
  patterns:
    - "Upsert-not-insert stub tracking: markPending() now replaces an existing entry's classification in place on a later, differently-classified reattempt, rather than the original insert-only/no-op-if-recorded shape -- the fix for a discriminant that would otherwise get permanently stuck at its FIRST observation"
    - "Real-WASM 'broken' proof via a genuinely wrong key: WasmCollectionKey.generate() twice (one to encrypt the fixture, a second, distinct one handed back by the mocked getCollectionKey()) so decryptItemForCollection's own AEAD integrity check fails for real -- never a mocked throw, per 27-VALIDATION.md's evidence rule for crypto-adjacent claims"
    - "Real-WASM test state reset via the production lock-state listener (not vi.resetModules()) -- resetModules() would tear down and re-instantiate the real WASM module/linear memory mid-file, invalidating any WasmCollectionKey handle created before the reset; simulating a lock transition through the SAME subscribeSessionLockState handler production code uses is the safe reset primitive"

key-files:
  created:
    - extension/entrypoints/background/vault-store.real-wasm.test.ts
  modified:
    - extension/entrypoints/background/vault-store.ts
    - extension/entrypoints/background/vault-store.test.ts
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts
    - extension/entrypoints/popup/ItemListView.tsx
    - extension/entrypoints/popup/ItemListView.test.tsx
    - extension/lib/i18n/dictionary.ts

key-decisions:
  - "Preserved 27-04's single-array decision (pending AND broken share ONE getPendingSharedItems() channel) rather than splitting into two lists -- only added a `status` field to each entry. This keeps 27-04's own prohibition intact (a shared row the caller has access to is never silently dropped with no trace) while making the ALREADY-SURFACED channel tell the two states apart, exactly as the gap-closure plan's objective specified."
  - "markPending() upserts (replaces status in place) rather than appending a second entry for the same id -- required by the reattempt-upgrade truth (a row observed 'pending' at t=0 must be able to become 'broken' once the key resolves and decrypt still fails), verified by a new Test 17b covering two successive applySyncSnapshot calls for the same row id with hasRefreshedThisSession() flipping false→true between them."
  - "vault-store.real-wasm.test.ts resets module-level state between its two test cases via a simulated lock-state transition (capturing subscribeSessionLockState's listener directly in the vault-session mock, then firing it in beforeEach), not vi.resetModules() -- the pattern every other real-wasm suite in this codebase uses for module-level state resets (dynamic re-import) would also tear down and re-instantiate the real WASM linear memory, invalidating any WasmCollectionKey handle allocated before the reset. This is a new pattern for this codebase's real-wasm suites (documented in-file) since vault-store.ts, unlike collections-store.ts/identity-store.ts, has module-level mutable arrays that accumulate across calls with no other reset primitive."
  - "sync.itemUndecryptableWarning's copy fix removes exactly the middle sentence claiming a retained 'last known version' is shown, keeping the opener ('failed to decrypt during the last sync') and closer ('may indicate corrupted or tampered data...') byte-compatible with every existing /failed to decrypt/i regex assertion in ItemListView.test.tsx and ItemDetailView.test.tsx."

requirements-completed: [EXT-07]

coverage:
  - id: D1
    description: "vault-store.ts's PendingSharedItemEntry.status discriminant + markPending()'s upsert-on-reattempt behavior, verified against REAL crypto (genuine AEAD wrong-key failure for 'broken', genuine CollectionKeyPendingError short-circuit for 'pending')"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.real-wasm.test.ts#a collection-scoped row whose Collection Key resolved but decrypts under a genuinely WRONG key classifies as 'broken', a collection-scoped row whose Collection Key isn't cached YET classifies as 'pending'"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.test.ts#Test 17b (markPending's reattempt upserts the status)"
        status: pass
    human_judgment: false
  - id: D2
    description: "MessageResponseMap['vault.list'].pending typed as PendingSharedItemEntry[] -- the discriminant flows through the message boundary with no router.ts change needed"
    verification:
      - kind: unit
        ref: "extension/lib/messaging/ext-protocol.test.ts (50 tests, exhaustive vault.list fixture round-trip)"
        status: pass
    human_judgment: false
  - id: D3
    description: "ItemListView.tsx's pending-row loop degrades a status:'broken' entry to a terminal AlertTriangle warning row (no SharedBadge, no skeleton, non-interactive, role=status) while a 'pending' entry renders byte-identical to before"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemListView.test.tsx#Test 20 (broken-row degraded treatment), Test 17/18 (pending-row shape unchanged)"
        status: pass
    human_judgment: false
  - id: D4
    description: "sync.itemUndecryptableWarning's PL/EN copy no longer claims a retained last-known version is shown"
    verification:
      - kind: other
        ref: "grep -c \"Wyświetlana jest ostatnia znana wersja\" extension/lib/i18n/dictionary.ts -> 0"
        status: pass
    human_judgment: false

duration: ~30min
completed: 2026-08-09
status: complete
---

# Phase 27 Plan 12: Pending-vs-Broken Shared-Row Classification — vault-store.ts Discriminant + ItemListView.tsx Degraded Treatment Summary

**vault-store.ts's `pendingSharedItems` now carries a `status: "pending" | "broken"` discriminant computed from the exact `CollectionKeyPendingError`/`hasRefreshedThisSession()` signal `decryptItemRow` already derives internally, `markPending()` upserts that status on reattempt instead of freezing the first classification, and `ItemListView.tsx` degrades a "broken" row into a visible, honest, non-interactive warning instead of an indefinite skeleton — closing 27-VERIFICATION.md's Blocker 1 (UI-SPEC's E2-error backstop) with real-AEAD-crypto evidence, not a mocked throw.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 3 (Task 3 TDD: RED then GREEN)
- **Files modified:** 7 (1 created, 6 modified)

## Accomplishments

- `vault-store.ts` gained `export interface PendingSharedItemEntry { id: string; collectionId: string; status: "pending" | "broken"; }` and `getPendingSharedItems()`'s return type widened to `PendingSharedItemEntry[]`. `markPending(id, collectionId, status)` changed from an insert-only/no-op-if-recorded function to an explicit upsert: a row already recorded has its `status` replaced in place on a differently-classified reattempt, never appended as a duplicate.
- `applySyncSnapshot`'s per-row catch now passes `"pending"` for a `CollectionKeyPendingError` and `"broken"` for any other collection-scoped decrypt failure. `mergeCollectionSnapshot`'s per-row catch computes the same discriminant (`err instanceof CollectionKeyPendingError ? "pending" : "broken"`) rather than calling `markPending` with no classification.
- `vault-store.real-wasm.test.ts` (new): real-WASM proof that the classification is correct against genuine crypto, not a mocked throw. The "broken" case genuinely exercises `decryptItemForCollection`'s own AEAD integrity check against a real, distinct, wrong `WasmCollectionKey`; the "pending" case genuinely short-circuits via `CollectionKeyPendingError` before any decrypt attempt. Both mirror `collections-store.real-wasm.test.ts`'s established real-WASM technique, adapted with a new module-state-reset pattern (simulated lock transition, never `vi.resetModules()`, to avoid invalidating live WASM handles mid-file).
- `ext-protocol.ts`'s `MessageResponseMap["vault.list"].pending` is now typed as `PendingSharedItemEntry[]` (type-only import from `vault-store.ts`, mirroring the existing `Collection` type-only import's D-05 boundary rationale). `router.ts` needed no change — its existing `pending: getPendingSharedItems()` pass-through already satisfies the widened type.
- `ItemListView.tsx`'s pending-row loop now branches per entry on `p.status`. A `"pending"` entry renders byte-identical to before (neutral skeleton shimmer, `SharedBadge`, `sharing.sharedItemLoadingAria` aria-label). A `"broken"` entry renders a static `bg-base-200` frame with a `text-warning` `AlertTriangle`, the visible text `sharing.sharedItemBrokenLabel` ("Failed to decrypt shared item"), a `title` and `aria-label` of `sync.itemUndecryptableWarning`, and stays a non-interactive `<div role="status">` — never clickable, never reverting back to the skeleton sub-branch.
- `dictionary.ts` gained `sharing.sharedItemBrokenLabel` (new key, PL/EN) and `sync.itemUndecryptableWarning`'s copy was corrected: the middle sentence falsely claiming a retained "last known version" is shown was removed for both locales — this extension keeps 27-04's drop discipline (no `VaultItem` is ever retained for a broken shared row), unlike web, so that claim was false the moment this string became reachable in production.
- Full extension test suite: 762/762 green (up from the pre-plan 758). `npx tsc --noEmit` clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: vault-store.ts's pending-vs-broken discriminant + real-WASM proof** - `68ad9f5` (feat)
2. **Task 2: wire the discriminant through the vault.list message boundary** - `c148bfa` (feat)
3. **Task 3: ItemListView.tsx's broken-row degraded treatment + honest dictionary copy** (TDD)
   - RED: `46d1815` (test)
   - GREEN: `d74bb8b` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/background/vault-store.ts` - `PendingSharedItemEntry` interface, upsert `markPending`, status-aware catch blocks in `applySyncSnapshot`/`mergeCollectionSnapshot`, updated doc comments
- `extension/entrypoints/background/vault-store.test.ts` - Test 14/15/16/4b updated with `status`, new Test 17b (reattempt upsert)
- `extension/entrypoints/background/vault-store.real-wasm.test.ts` (NEW) - real-WASM proof of both classifications
- `extension/lib/messaging/ext-protocol.ts` - `MessageResponseMap["vault.list"].pending` typed as `PendingSharedItemEntry[]`
- `extension/lib/messaging/ext-protocol.test.ts` - exhaustive fixture updated with `status: "pending"`
- `extension/entrypoints/popup/ItemListView.tsx` - broken-row degraded rendering branch
- `extension/entrypoints/popup/ItemListView.test.tsx` - Test 17/18 updated with `status`, new Test 20 (broken-row treatment)
- `extension/lib/i18n/dictionary.ts` - `sharing.sharedItemBrokenLabel` (new), `sync.itemUndecryptableWarning` (corrected copy)

## Decisions Made

See `key-decisions` in frontmatter above (4 decisions, each with full rationale).

## Deviations from Plan

None — plan executed exactly as written. The plan's own action text already anticipated every edge case exercised here (the upsert semantics, the real-WASM state-reset concern implicit in "mirror collections-store.real-wasm.test.ts's own structure exactly," the copy-preservation constraint for existing regex assertions).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `PendingSharedItemEntry.status` and `markPending`'s upsert semantics are exported and stable — 27-13 (the ceremony partial-candidate race, Blocker 2) depends on these `vault-store.ts` edits landing first, per this plan's own phase-context note, and can now build on them.
- UI-SPEC's E2-error backstop is closed: no code path renders a permanently-broken shared row as an indefinite skeleton anymore.
- No blockers. Full extension test suite: 762/762 green. `npx tsc --noEmit` clean.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-09*

## Self-Check: PASSED
