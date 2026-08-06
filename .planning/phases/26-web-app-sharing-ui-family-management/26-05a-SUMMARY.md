---
phase: 26-web-app-sharing-ui-family-management
plan: 05a
subsystem: crypto-client
tags: [typescript, wasm, vitest, collections, sharing, data-corruption-fix]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "26-05's decrypt-side scope dispatch (decryptItemRow), collections.ts's getCollectionKey cache, and the deferred-items.md finding this fix closes"
provides:
  - "web/src/lib/vault/store.ts::updateVaultItem — encrypt-side scope dispatch mirroring decryptItemRow's read-side dispatch: encryptItemForCollection for a collection-scoped item, encryptItem for a personal one"
  - "CollectionKeyUnavailableError — fail-loud guard when a collection-scoped item's key isn't cached at save time (never a personal-key fallback)"
affects: [26-06, 26-07, 26-08, 26-09, 26-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Encrypt-side dispatch reads scope from the in-memory item (existingBeforeSave.collectionId) rather than any caller-supplied argument -- mirrors decryptItemRow's own getCollectionKey lookup, including borrowing (never freeing) the cached WasmCollectionKey handle owned by collections.ts"
    - "Fail-loud-not-fallback: an unavailable Collection Key at save time throws BEFORE any encryption or API call happens, rather than silently degrading to the personal-key path -- the exact inverse of the corruption this plan closes"

key-files:
  created: []
  modified:
    - web/src/lib/vault/store.ts
    - web/src/lib/vault/store.test.ts
    - web/src/lib/vault/store.real-wasm.test.ts

key-decisions:
  - "Scope is read from existingBeforeSave.collectionId (the in-memory item already loaded via decryptItemRow's own dispatch), not from any new caller-supplied parameter -- updateVaultItem's public signature (id, fields, currentRevision) is unchanged, so no call site (ItemForm.tsx, ItemContextMenu.tsx) needed touching, staying inside this plan's file-scope restriction."
  - "An unavailable collection key throws CollectionKeyUnavailableError BEFORE calling encryptItem as a fallback and BEFORE calling the server's updateItem -- a failed save leaves both the in-memory item and the server's stored ciphertext completely untouched, fully recoverable by retrying once collections.ts has refreshed."
  - "The cached WasmCollectionKey handle returned by getCollectionKey() is borrowed, never freed here -- collections.ts owns its lifecycle (freed on lock or per-collection replacement), identical to decryptItemRow's own borrowing discipline for the same handle."

requirements-completed: [SHARE-01]

coverage:
  - id: D1
    description: "updateVaultItem dispatches on the in-memory item's collectionId: a collection-scoped item's edit is encrypted via encryptItemForCollection under the cached Collection Key, never encryptItem"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#encrypt dispatch by scope (collection_id) -- 26-05a > a collection-scoped item's save calls encryptItemForCollection with the item's collection_id, id, and new revision -- never encryptItem"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.real-wasm.test.ts#store.ts encrypt dispatch: updateVaultItem re-encrypts a collection-scoped item so it is STILL decryptable through the collection path (real WASM, network mocked) > a saved edit's ciphertext decrypts back to the new fields via decryptItemForCollection under the SAME collection key"
        status: pass
    human_judgment: false
  - id: D2
    description: "An unavailable collection key at save time fails the save loudly (CollectionKeyUnavailableError) -- never a silent fallback to the personal User Key, never a server write with wrong-key ciphertext"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#encrypt dispatch by scope (collection_id) -- 26-05a > an unavailable collection key FAILS THE SAVE LOUDLY -- rejects with CollectionKeyUnavailableError, never falls back to encryptItem, and never calls updateItem"
        status: pass
    human_judgment: false
  - id: D3
    description: "Genuine RED demonstration performed on the round-trip real-WASM test (not merely asserted): reverting the dispatch to plain encryptItem produces an observed, reachable AEAD decryption failure"
    verification:
      - kind: other
        ref: "Manual mutate-run-revert of web/src/lib/vault/store.ts::updateVaultItem, npx vitest run src/lib/vault/store.real-wasm.test.ts -- observed failure text recorded verbatim below"
        status: pass
    human_judgment: false

# Metrics
duration: ~35min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 05a: Close the live updateVaultItem write-path data-corruption bug Summary

**`store.ts::updateVaultItem` now mirrors `decryptItemRow`'s scope dispatch on the ENCRYPT side — a collection-scoped item's edit is re-encrypted via `encryptItemForCollection` under the cached Collection Key instead of the caller's personal User Key, and an unavailable collection key fails the save loudly (`CollectionKeyUnavailableError`) rather than silently corrupting the item.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-08-06 (base commit `2b85e346`)
- **Completed:** 2026-08-06
- **Tasks:** 1 (targeted fix, not a full plan)
- **Files modified:** 3 (1 fix, 2 test files)

## Accomplishments

- **Closed the live data-corruption bug `deferred-items.md` flagged from Plan 26-05.** `updateVaultItem` previously called `encryptItem(uk, plaintext, id, newRevision)` unconditionally, even for a collection-scoped item — since 26-05 made collection-scoped items appear and decrypt normally in `getItems()`, both `ItemForm.tsx`'s edit save and `ItemContextMenu.tsx`'s move-to-folder path reach `updateVaultItem`, so a full-edit member saving a change to a shared item would silently re-encrypt it under their own personal User Key. On the next sync merge it becomes permanently undecryptable via the collection path for everyone, including the person who saved it — a silent, irreversible corruption with no server-side error.
- **`updateVaultItem` now reads the item's scope from the in-memory copy** (`existingBeforeSave.collectionId`, already looked up for the pre-existing CR-03 undecryptable guard) — a collection-scoped item (`collectionId !== null`) is re-encrypted via `encryptItemForCollection` using the SAME cached `WasmCollectionKey` handle `decryptItemRow` borrows from `collections.ts`; a personal item's path (`collectionId === null`) is byte-identical to before.
- **Fail-loud guard added: `CollectionKeyUnavailableError`.** If the collection key isn't cached yet (`getCollectionKey` returns `undefined`), the save throws BEFORE any encryption or server call happens — never falls back to the personal-key path. A failed save is annoying and fully recoverable (retry once the key is cached); a silently corrupted item is neither.
- **Real-WASM round-trip proof**, not just a spy assertion: a collection-scoped item is loaded, edited via `updateVaultItem`, and the EXACT ciphertext sent to the (mocked) server is decrypted back through `decryptItemForCollection` using the same collection key — the plaintext matches the new fields exactly, proving the item is still genuinely readable after the edit.
- **Genuine RED demonstration performed** (see below) — the fix was reverted, the round-trip test was run and observed to fail with a real AEAD decryption error, then the fix was restored and the test passes again.

## Task Commits

- **Fix commit:** `05f058a` (fix) — `updateVaultItem`'s encrypt-side scope dispatch, `CollectionKeyUnavailableError`, mocked dispatch tests, and the real-WASM round-trip proof, all in one atomic commit.

## RED Proof (test_requirements' mandatory genuine RED demonstration)

Performed on the REAL test harness, not asserted:

1. Temporarily mutated `web/src/lib/vault/store.ts::updateVaultItem` to remove the scope dispatch entirely, reverting to the pre-fix `const combined = encryptItem(uk, plaintext, id, newRevision);` (unconditional personal-key path).
2. Ran `npx vitest run src/lib/vault/store.real-wasm.test.ts`.
3. **Observed failure:**
   ```
   ❯ src/lib/vault/store.real-wasm.test.ts (2 tests | 1 failed) 224ms
     ✓ store.ts decrypt dispatch: a real collection-scoped item decrypts and appears in getItems() (real WASM, network mocked) > appears fully decrypted with the correct fields and collectionId set -- never undecryptable: true 110ms
     × store.ts encrypt dispatch: updateVaultItem re-encrypts a collection-scoped item so it is STILL decryptable through the collection path (real WASM, network mocked) > a saved edit's ciphertext decrypts back to the new fields via decryptItemForCollection under the SAME collection key 107ms
       → decryption failed (wrong key or corrupted data)

   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

    FAIL  src/lib/vault/store.real-wasm.test.ts > store.ts encrypt dispatch: updateVaultItem re-encrypts a collection-scoped item so it is STILL decryptable through the collection path (real WASM, network mocked) > a saved edit's ciphertext decrypts back to the new fields via decryptItemForCollection under the SAME collection key
   Unknown Error: decryption failed (wrong key or corrupted data)
   ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

    Test Files  1 failed (1)
         Tests  1 failed | 1 passed (2)
   ```
   This is the exact failure mode the fix eliminates: the mutation encrypted the edit under the caller's personal User Key, and the test's attempt to decrypt that ciphertext back through `decryptItemForCollection` (the collection path — the only path a co-member or the item's own owner can use to read it again) throws a genuine AEAD authentication failure. This is not a hypothetical — it is the observed, reproducible failure a real corrupted item would produce on its next sync merge.
4. Reverted the mutation (restored the `collectionId`/`getCollectionKey`/`encryptItemForCollection` dispatch). Re-ran the suite — both tests pass, `npx tsc --noEmit` clean, and the full `npx vitest run` (70 files, 649 tests) passes with zero collateral regressions.

## Files Created/Modified

- `web/src/lib/vault/store.ts` — `updateVaultItem`'s encrypt-side scope dispatch, `CollectionKeyUnavailableError` class
- `web/src/lib/vault/store.test.ts` — mocked coverage for the dispatch branch (collection-scoped happy path + unavailable-key fail-loud path); added `encryptItemForCollection` to the `@/lib/crypto` mock
- `web/src/lib/vault/store.real-wasm.test.ts` — new real-WASM round-trip proof: a saved edit's ciphertext decrypts back to the new fields through the collection path; added `updateItem` to the `./api` mock, `decryptItemForCollection`/`updateVaultItem` imports

## Decisions Made

- Scope dispatch reads `existingBeforeSave.collectionId` (already looked up above for the pre-existing CR-03 undecryptable guard) rather than adding a new parameter to `updateVaultItem`'s public signature — this kept the fix entirely inside `store.ts`, matching this plan's file-scope restriction (no touching `ItemForm.tsx`/`ItemContextMenu.tsx`, which call `updateVaultItem` unchanged).
- Fail-loud, never fallback: `CollectionKeyUnavailableError` is thrown before ANY encryption or API call — the alternative (falling back to `encryptItem`) is precisely the corruption bug this fix closes, just moved one level down.
- The cached `WasmCollectionKey` handle from `getCollectionKey()` is borrowed, never freed in `updateVaultItem` — `collections.ts` owns its lifecycle (freed on lock or per-collection replacement), identical to `decryptItemRow`'s own borrowing discipline for the same handle. No new WASM handle is created or owned by this fix, so there is no new `.free?.()` call site to add.

## Deviations from Plan

None — this is itself a targeted deviation-fix task (not a full PLAN.md execution), and it was completed exactly as scoped in the task prompt.

## Blast Radius / Corruption Window

**No already-saved item could have been corrupted by this write-path bug before Plan 26-05 merged.** Before 26-05, `decryptItemRow` always used the personal `decryptItem` regardless of scope — a collection-scoped item's ciphertext (produced by `encryptItemForCollection`, e.g. via `moveItemToCollection`) would ALWAYS fail to decrypt on read, which `applySyncSnapshot`'s existing CR-03 fallback either flags `undecryptable: true` (blocking `updateVaultItem`'s own undecryptable guard from allowing a save) or drops the item from `getItems()` entirely on a first-ever failure (no prior good copy to retain). Either way, no UI surface could ever select and successfully edit a collection-scoped item before 26-05 shipped its read-side dispatch fix — there was no reachable path to the write-side bug yet.

**The corruption window opened when Plan 26-05 merged** (making collection-scoped items appear correctly and editable in `getItems()`) and stayed open until this fix (`26-05a`, same session). Any collection-scoped item saved through `ItemForm.tsx`'s edit form or `ItemContextMenu.tsx`'s move-to-folder action during that window would have been silently re-encrypted under the saver's personal User Key, corrupting it. Whether Plan 26-05 was ever deployed to the hosted instance (vault.blonie.cloud) during that window — as opposed to merging only in this local worktree/session — is outside this fix's audit scope; if a production deploy landed between 26-05 and this fix, any shared-folder item edited in that interval should be treated as a data-integrity incident requiring manual DB inspection (a `collection_id`-scoped item whose `enc_key`/`enc_data` fails `decryptItemForCollection` for every member is the diagnostic signature).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- The write-path half of SHARE-01's "collection-scoped items are genuinely usable" claim (not just readable, but SAFELY editable) is now proven by real WASM crypto, closing the gap `deferred-items.md` logged.
- `deferred-items.md`'s original entry is now resolved by this fix — no further action needed there.
- Plan 26-08's own move-to-collection re-encrypt logic (assigned separately in 26-05's `<action>` text) is unaffected by this fix; `updateVaultItem`'s dispatch here handles the GENERAL edit-save path (name/body/fields changes and personal-folder reassignment via `ItemContextMenu.tsx`), not the cross-collection re-encrypt Plan 26-08 owns.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigate | `web/src/lib/vault/store.ts::updateVaultItem` | Closes a live Integrity/Availability threat this plan's own audit uncovered: a full-edit member's normal item-save silently re-encrypting a shared item under the wrong key, corrupting it for every member (including the saver) on the next sync merge. Mitigated by dispatching on the item's own `collectionId` (mirrors T-26-11's existing `decryptItemRow` mitigation) and by failing the save loudly (`CollectionKeyUnavailableError`) rather than falling back to a wrong key — AEAD authentication makes a wrong-key decrypt structurally detectable but NOT preventable after the fact, so the fix must prevent the wrong-key encrypt from ever happening, which it does by construction. |
| threat_flag: accept (structural) | `web/src/lib/vault/store.ts::updateVaultItem` | An unavailable Collection Key at save time (race with `collections.ts`'s own async refresh) is accepted as a recoverable failure, not eliminated — `CollectionKeyUnavailableError` surfaces to the UI's existing generic error-catch (`ItemForm.tsx`'s `onError`/`setSubmitError`), and the user can simply retry the save once `collections.ts` has finished caching the key. Eliminating the race entirely (e.g. blocking every edit UI until the collections store first refreshes) is out of scope for this targeted fix. |

## Self-Check: PASSED

- FOUND: web/src/lib/vault/store.ts
- FOUND: web/src/lib/vault/store.test.ts
- FOUND: web/src/lib/vault/store.real-wasm.test.ts
- FOUND commit 05f058a in git log

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 05a*
*Completed: 2026-08-06*
