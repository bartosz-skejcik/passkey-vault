---
phase: 26-web-app-sharing-ui-family-management
plan: 14
subsystem: crypto-client
tags: [typescript, wasm, vitest, rust, axum, sharing, collections, sync]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "26-05's collections.ts client store (getCollectionKey cache, refreshCollectionsNow) and store.ts::decryptItemRow's collection-id scope dispatch, both reused verbatim here"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "26-08's sealItemKeyForRecipient/decryptItemWithSharedKey pv-wasm primitives and their proven owner/recipient sequence (ShareDialog.real-wasm.test.ts)"
  - phase: 26-web-app-sharing-ui-family-management
    provides: "26-13's live-run discovery and honest documentation of WINDOWS #7/#8/#9 (this plan's own objective)"
provides:
  - "crates/pv-server/src/routes/sync.rs::DirectSharedItem/SharedDirectSyncResponse -- pull_shared_direct now returns the recipient's own item_shares.sealed_key, the missing piece that made this read path client-unusable"
  - "web/src/lib/vault/api.ts::getCollectionSync/getSharedDirectSync -- first client wrappers for pull_shared_collection and the fixed pull_shared_direct"
  - "web/src/lib/vault/store.ts: items is now a 3-source merge (personalItems/collectionSharedItems/directSharedItems); handleSharedRevisions genuinely refreshes collections.ts and pulls+merges shared data instead of a useless personal re-pull"
  - "DirectShareNotEditableError -- data-layer guard against silently corrupting a directly-shared item under the wrong key"
affects: [phase-27-extension-sharing, any-future-plan-building-edit-UI-for-a-directly-shared-item]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-source computed merge (personalItems/collectionSharedItems/directSharedItems -> recomputeItems() -> the single public `items` array) so every existing items.find/items.filter lookup sees a shared item exactly like a personal one, with zero call-site changes"
    - "replaceItemInSources/removeItemFromSources: local optimistic mutations write through to whichever source currently owns an id, so a later merge from any ONE source never silently reverts another source's optimistic change"
    - "handleSharedRevisions re-checks getUnlockedUserKey() before and after every awaited round trip (refreshCollectionsNow, getCollectionSync, getSharedDirectSync) -- mirrors applySyncSnapshot's own lock-race discipline, extended to three new async steps instead of one"
    - "Test-only deferRealFree helper (store.real-wasm.test.ts): when one real WasmIdentityKey handle must serve multiple, temporally-separated real production call sites in a single test, a naive free-call-count is insufficient (a later checkout can resurrect an already-fully-freed pointer) -- every production .free() becomes a no-op, and the test performs the one real free explicitly after vi.waitFor proves every consumer finished"

key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/sync.rs
    - crates/pv-server/tests/sync_shared.rs
    - web/src/lib/vault/api.ts
    - web/src/lib/vault/store.ts
    - web/src/lib/vault/store.test.ts
    - web/src/lib/vault/store.real-wasm.test.ts
    - .planning/phases/26-web-app-sharing-ui-family-management/deferred-items.md

key-decisions:
  - "fetch_items_for was NOT touched -- per this plan's own approach guidance, widening a caller-scoped SQL filter risks silent over-share (the opposite and worse failure mode from the one being fixed). The already-audited, already-tested dedicated read paths (pull_shared_collection, pull_shared_direct) are reused instead, proven correct by 3 rust tests (2 pre-existing + 1 new) and 2 real-WASM negative/positive proofs."
  - "pull_shared_direct's response type is a NEW, separate DirectSharedItem struct (not a reuse of super::vault::VaultItem) -- the one read path needing the recipient's own item_shares.sealed_key instead of enc_key, kept out of vault.rs entirely (sync.rs-only change, respecting the sibling agent's families.rs/account.rs boundary and vault.rs's own size)."
  - "A directly-shared item is now visible but NOT editable: DirectShareNotEditableError fails loud in updateVaultItem rather than silently re-encrypting under the recipient's own personal User Key (which would permanently corrupt the item for its real owner). The real fix needs a new pv-core/pv-wasm encrypt-as-shared-key-recipient primitive -- out of this plan's scope, logged in deferred-items.md."
  - "handleSharedRevisions calls refreshCollectionsNow() unconditionally on every detected mismatch, including the very first post-unlock tick where collections.ts's own unlock listener JUST ran -- a known, accepted minor inefficiency (one redundant listCollections()+identity-unwrap round trip immediately after unlock) rather than adding cross-module coordination state for a one-time cost."

requirements-completed: [SHARE-01]

coverage:
  - id: D1
    description: "A non-owning collection member reads a collection-scoped item's real plaintext via the new pull_shared_collection client wrapper, decrypted through the collection's own Collection Key -- proven while the caller's own personal getSyncSnapshot is genuinely empty, so the item can only have reached getItems() through the new path"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.real-wasm.test.ts#WINDOWS #8 (26-14-PLAN.md) > the item is fetched via getCollectionSync, decrypted with the collection's OWN Collection Key, and appears in getItems()"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#onSharedRevisions > a watermark mismatch (new/changed collection revision) refreshes collections.ts, pulls that collection's OWN item snapshot via getCollectionSync, and merges it"
        status: pass
    human_judgment: false
  - id: D2
    description: "Negative proof: a caller absent from getSharedRevisions()'s collection list never calls getCollectionSync and sees zero items -- the non-member case"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.real-wasm.test.ts#WINDOWS #8 (26-14-PLAN.md) > negative: a collection absent from getSharedRevisions() is never fetched via getCollectionSync, and its item never appears"
        status: pass
      - kind: integration
        ref: "cargo test -p pv-server --test sync_shared shared_collection_pull_rejects_non_member_with_404_never_403"
        status: pass
    human_judgment: false
  - id: D3
    description: "A direct-share recipient reads the shared item via pull_shared_direct, decrypted through the real unsealCollectionKey + decryptItemWithSharedKey recipient-side sequence -- independently re-verified byte-for-byte against the merged item's own decrypt"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.real-wasm.test.ts#WINDOWS #9 (26-14-PLAN.md) > Alice's real item, shared directly to Bob, decrypts through Bob's own unsealed Cipher Key and appears in his getItems()"
        status: pass
      - kind: integration
        ref: "cargo test -p pv-server --test sync_shared shared_direct_pull_returns_recipients_own_directly_shared_items (updated to assert sealed_key is present, enc_key is absent)"
        status: pass
    human_judgment: false
  - id: D4
    description: "collections.ts gains live-update wiring: a shared-revisions mismatch refreshes it, closing the previous 'no subscribeLockState/onSharedRevisions wiring at all' gap"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#onSharedRevisions > a watermark mismatch ... refreshes collections.ts FIRST"
        status: pass
    human_judgment: false
  - id: D5
    description: "A directly-shared item, now visible, is not silently corruptible: updateVaultItem throws DirectShareNotEditableError and never calls encryptItem/updateItem for such an item"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#updateVaultItem refuses to save a directly-shared item"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.real-wasm.test.ts#WINDOWS #9 > DirectShareNotEditableError is thrown for a real, successfully-decrypted directly-shared item"
        status: pass
    human_judgment: false
  - id: D6
    description: "A genuine RED demonstration was performed on WINDOWS #8's main claim (not merely asserted) -- see this SUMMARY's own RED Demonstration section for the verbatim observed failure"
    verification:
      - kind: other
        ref: "Manual mutate-run-revert of web/src/lib/vault/store.ts's collection-pull loop; npx vitest run -- observed failure text recorded verbatim below"
        status: pass
    human_judgment: false

# Metrics
duration: ~2h
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 14: Recipient-Side Shared-Item Read Paths (WINDOWS #7/#8/#9) Summary

**Closes the phase's largest remaining gap -- a user could share perfectly and the recipient saw nothing -- by wiring the already-built, already-tested `pull_shared_collection`/`pull_shared_direct` server read paths into `store.ts`'s client item list for the first time, adding the one missing wire field (`sealed_key`) `pull_shared_direct` needed to be usable at all, and giving `collections.ts` live-update wiring it never had.**

## Performance

- **Duration:** ~2h
- **Completed:** 2026-08-06T13:46:45Z
- **Tasks:** 4 (server wire fix, client wrappers, store.ts merge/dispatch rewrite, tests) plus a genuine RED/GREEN proof cycle
- **Files modified:** 7 (0 created, 7 modified)

## Accomplishments

- **WINDOWS #8 closed.** `store.ts`'s item list is now a computed merge of three sources: `personalItems` (unchanged `fetch_items_for` scope), `collectionSharedItems` (new -- every item in every collection the caller is a member of, via `getCollectionSync`, a genuine superset including items the caller never created), and `directSharedItems` (new). A non-owning collection member's fellow member's item now genuinely appears, decrypted through the collection's own shared Collection Key -- proven with real WASM crypto while the caller's own personal snapshot was mocked empty, so the item could only have reached `getItems()` through the new path.
- **WINDOWS #9 closed, and its own prerequisite gap fixed first.** `GET /api/sync/shared/direct` shipped fully implemented and tested since Phase 23, but its wire response never carried the ONE thing a recipient needs to decrypt: their own `item_shares.sealed_key`. Fixed with a dedicated `DirectSharedItem`/`SharedDirectSyncResponse` type in `sync.rs` (kept separate from `pull_shared_collection`'s reused `VaultItem` shape, and out of `vault.rs` entirely -- a sync.rs-only change). `store.ts` now decrypts a real directly-shared item through the exact `unsealCollectionKey` + `decryptItemWithSharedKey` sequence `ShareDialog.real-wasm.test.ts` already proved for the owner side, independently re-verified byte-for-byte in this plan's own test.
- **WINDOWS #7 closed.** `handleSharedRevisions` now calls `collections.ts`'s existing `refreshCollectionsNow()` on every detected mismatch -- a member added to a collection is no longer stuck until their next unlock/reload.
- **The negative case is proven, not assumed.** A caller absent from `getSharedRevisions()`'s collection list never even calls `getCollectionSync` and sees zero items (client-side structural proof), corroborated by the pre-existing server-side `shared_collection_pull_rejects_non_member_with_404_never_403` rust test and a new `sealed_key`-presence assertion on `shared_direct_pull_returns_recipients_own_directly_shared_items`.
- **A real, newly-reachable data-corruption risk was found and closed before it could ship.** Making a directly-shared item visible for the first time also makes it reachable to `updateVaultItem` -- which had no way to correctly re-encrypt someone else's item (the owner's own User Key is not something a recipient holds). `DirectShareNotEditableError` fails the save loudly instead of silently corrupting the item under the recipient's own key; the real fix (a new encrypt-as-shared-key-recipient crypto primitive) is logged as a deferred, out-of-scope item.
- **`fetch_items_for` was deliberately left untouched**, per this plan's own approach guidance -- see Decisions Made below.

## Task Commits

Each task was committed atomically:

1. **Server: add recipient `sealed_key` to `pull_shared_direct` (WINDOWS #9's prerequisite)** -- `d2ff901` (feat)
2. **Client wrappers: `getCollectionSync`/`getSharedDirectSync`** -- `0afc75b` (feat)
3. **Core fix: three-source item merge + fixed `handleSharedRevisions` + `DirectShareNotEditableError`** -- `6550911` (fix)
4. **Mocked unit tests: rewritten `onSharedRevisions` describe block + write-path guard test** -- `01ab6e5` (test)
5. **Real-WASM proof: WINDOWS #8/#9 positive + negative tests** -- `536cf53` (test)
6. **Deferred-items.md: log the direct-share encrypt-side gap** -- `20f08c9` (docs)
7. **WINDOWS.md: mark #7/#8/#9 fixed** -- `4a6510e` (docs)

## RED Demonstration (performed genuinely, per this plan's own test_requirements)

Performed on the REAL test harness, not asserted:

1. Temporarily mutated `web/src/lib/vault/store.ts::handleSharedRevisions`'s per-collection pull loop to `continue` unconditionally as its first statement (simulating the pre-fix state: WINDOWS #8's collection-sync pull never runs at all).
2. Ran `npx vitest run src/lib/vault/store.real-wasm.test.ts -t "the item is fetched via getCollectionSync"`.
3. **Observed failure (verbatim):**
   ```
   × WINDOWS #8 (26-14-PLAN.md): a non-owning collection member reads a collection-scoped item's plaintext via the NEW pull_shared_collection read path (real WASM) > the item is fetched via getCollectionSync, decrypted with the collection's OWN Collection Key, and appears in getItems() -- even though this caller's OWN personal getSyncSnapshot never includes it 1017ms
     → expected "spy" to be called with arguments: [ 'collection-windows8-proof' ]

   Number of calls: 0

   FAIL  src/lib/vault/store.real-wasm.test.ts > WINDOWS #8 (26-14-PLAN.md): ... > the item is fetched via getCollectionSync, decrypted with the collection's OWN Collection Key, and appears in getItems() -- even though this caller's OWN personal getSyncSnapshot never includes it
   AssertionError: expected "spy" to be called with arguments: [ 'collection-windows8-proof' ]

   Number of calls: 0

    ❯ src/lib/vault/store.real-wasm.test.ts:516:60
      514|       setUnlockedUserKey(bobUk);
      515|
      516|       await vi.waitFor(() => expect(mockGetCollectionSync).toHaveBeenC…
         |                                                            ^
   ```
4. Reverted the mutation (removed the `continue`). Re-ran the same test, then the full suite -- `npx tsc --noEmit` clean, `npx vitest run src/lib/vault/store.real-wasm.test.ts src/lib/vault/store.test.ts` (48/48 pass), full `npx vitest run` (749/749 pass, zero collateral regressions), `cargo test --workspace` (all crates passing).

This proves the fix is genuinely load-bearing: `getCollectionSync` is called ONLY because the fix's own loop reaches it, and the test would have failed on the pre-fix code exactly as it did here.

## Files Created/Modified

- `crates/pv-server/src/routes/sync.rs` -- new `DirectSharedItem`/`SharedDirectSyncResponse` types; `pull_shared_direct` now selects and returns `item_shares.sealed_key`, drops `enc_key`
- `crates/pv-server/tests/sync_shared.rs` -- added `sealed_key`-present/`enc_key`-absent assertions to the existing direct-pull test
- `web/src/lib/vault/api.ts` -- `getCollectionSync(collectionId)`, `getSharedDirectSync()`, plus their wire-shape types
- `web/src/lib/vault/store.ts` -- three-source item merge (`personalItems`/`collectionSharedItems`/`directSharedItems` -> `recomputeItems()`), `mergeCollectionSnapshot`/`mergeDirectSnapshot`/`decryptDirectSharedRow`, fixed `handleSharedRevisions` (calls `refreshCollectionsNow` + per-collection `getCollectionSync` + `getSharedDirectSync`, purges revoked collections), `sharedRevisionsChanged` now detects collection removal too, `replaceItemInSources`/`removeItemFromSources` for local mutations, `DirectShareNotEditableError`, eager `refreshSharedItemsNow()` on unlock
- `web/src/lib/vault/store.test.ts` -- rewrote the `onSharedRevisions` describe block for the new behavior; new purge test, new direct-share merge test, new `updateVaultItem` write-guard test
- `web/src/lib/vault/store.real-wasm.test.ts` -- two new describe blocks (WINDOWS #8 positive+negative, WINDOWS #9 positive+guard), `deferRealFree` test helper
- `.planning/phases/26-web-app-sharing-ui-family-management/deferred-items.md` -- logs the direct-share encrypt-side gap `DirectShareNotEditableError` guards against

## Decisions Made

- **`fetch_items_for` was NOT changed.** Per this plan's own approach guidance: widening a caller-scoped SQL filter is exactly the kind of change that can silently over-share -- the opposite, and worse, failure mode from the one being fixed here. The dedicated `pull_shared_collection`/`pull_shared_direct` endpoints were built and tested precisely for this in Phase 23/26, and reusing them keeps the authorization boundary exactly where it already was proven correct (Phase 22's membership extractors), never re-derived. The negative proof (D2 above) demonstrates the boundary still holds: a non-member gets nothing, both client-structurally and server-side.
- **`pull_shared_direct`'s response is a NEW, separate type**, not a reuse of `super::vault::VaultItem`. This keeps the change entirely inside `sync.rs` -- `vault.rs` (a large, shared file) was not touched at all, respecting both the sibling agent's `families.rs`/`account.rs` boundary and general blast-radius discipline.
- **A directly-shared item is visible but not (yet) editable.** `DirectShareNotEditableError` is a genuine Rule 2 auto-add (missing critical functionality/correctness guard) -- editing a directly-shared item was structurally impossible to do CORRECTLY with today's crypto primitives (no encrypt-as-shared-key-recipient exists), and this plan's own change (making the item visible) is what makes the wrong path reachable for the first time. Failing loud, not falling back to the wrong key, mirrors this exact codebase's own established `CollectionKeyUnavailableError` precedent.
- **`handleSharedRevisions` calls `refreshCollectionsNow()` unconditionally on every mismatch**, including the redundant first-post-unlock tick where `collections.ts`'s own unlock listener just ran. Accepted as a known, minor inefficiency (see Threat Flags) rather than adding cross-module unlock-sequencing coordination for a one-time cost.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 -- Missing Critical] `pull_shared_direct`'s wire response never carried the recipient's own `sealed_key`**
- **Found during:** Task 2, designing the client-side direct-share decrypt sequence
- **Issue:** `GET /api/sync/shared/direct` had shipped fully implemented, authorized, and rust-tested since Phase 23 -- but its response never selected `item_shares.sealed_key`, the ONE piece a recipient needs to unseal the item's Cipher Key and decrypt it. The endpoint was wire-complete but structurally client-unusable regardless of any client work.
- **Fix:** New `DirectSharedItem` struct (sync.rs-only) carrying `sealed_key`, dropping the now-unused `enc_key`.
- **Files modified:** `crates/pv-server/src/routes/sync.rs`, `crates/pv-server/tests/sync_shared.rs`
- **Verification:** `cargo test -p pv-server --test sync_shared` (16/16 pass, including the updated assertion), `cargo test --workspace` (all crates green)
- **Committed in:** `d2ff901`

**2. [Rule 2 -- Missing Critical] A directly-shared item, once visible, had no guard against being silently corrupted on save**
- **Found during:** Task 3, wiring `directSharedItems` into the merged item list
- **Issue:** `updateVaultItem`'s existing scope dispatch only branches on `collectionId` (null vs. set) -- a directly-shared item has `collectionId: null`, identical to a genuinely personal item, so it would have fallen into the personal `encryptItem(uk, ...)` path, silently writing ciphertext under the RECIPIENT's own User Key (permanently corrupting the item for its real owner on the very next server write).
- **Fix:** `DirectShareNotEditableError`, thrown before any encrypt/wire call for an item present in `directSharedItems`.
- **Files modified:** `web/src/lib/vault/store.ts`
- **Verification:** `web/src/lib/vault/store.test.ts` (mocked guard test), `web/src/lib/vault/store.real-wasm.test.ts` (real-WASM guard test) -- both pass
- **Committed in:** `6550911`

---

**Total deviations:** 2 auto-fixed (both Rule 2 -- missing critical functionality directly caused/newly-reachable by this plan's own change). No scope creep: both are minimal, and the second is a defense-in-depth guard, not a feature build.
**Impact on plan:** Both fixes were required for the plan's own success criteria (a real, usable direct-share read path; no new data-corruption surface). Neither widens scope beyond this plan's declared objective.

## Issues Encountered

- **A test-only WASM double-free hazard, not a production bug.** This plan's own new production code (three independent real call sites now resolve `ensureOwnIdentityKeypair` in a single unlock tick: `collections.ts`'s own listener, `handleSharedRevisions`'s explicit `refreshCollectionsNow()` call, and `mergeDirectSnapshot`) is entirely safe in production (each call gets a freshly-unwrapped, independently-freeable handle). But this file's existing real-WASM test convention shares ONE locally-generated `WasmIdentityKey` across the mock's return value (there is no way to construct a second handle sharing the same key material -- by design, the class never exposes raw secret bytes). A naive free-call-count wrapper is insufficient for this specific multi-caller, temporally-separated pattern (a later checkout can resurrect an already-fully-freed pointer) -- resolved with a `deferRealFree` test helper that defers the one real free to an explicit, test-driven call after `vi.waitFor` proves every consumer finished. Documented at length in the test file itself; zero production code was touched to work around this.
- Extensive interactive debugging was required to find the correct ref-counting shape for the above (two intermediate approaches -- idempotent-free and naive ref-counting -- were tried, observed to fail with the exact "null pointer passed to rust" WASM error, and replaced) before landing on `deferRealFree`.

## User Setup Required

None -- no external service configuration required.

## Next Phase Readiness

- SHARE-01's "a family member can see what was shared with them" is now genuinely deliverable through this web app's real UI, for both collection-scoped and directly-shared items, closing this phase's largest remaining gap.
- **The direct-share write path remains a real, documented gap** (`DirectShareNotEditableError`, `deferred-items.md`): whichever future plan builds "edit a directly-shared item" UI needs a new pv-core/pv-wasm encrypt-as-shared-key-recipient primitive, plus surfacing `item_shares.access_level` to the client so the UI can hide the edit affordance for a `read`-only recipient in the first place.
- No blockers for downstream plans in this phase from this plan's own changes. `families.rs`/`account.rs` were not touched, respecting the sibling agent's concurrent work on WINDOWS #10.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigate | `crates/pv-server/src/routes/sync.rs` | New wire surface: `pull_shared_direct`'s response now carries `item_shares.sealed_key` to the recipient. This is NOT a new trust boundary -- the row was already scoped to `item_shares.recipient_user_id = session.user_id` (unchanged), and `sealed_key` is, by this codebase's own zero-knowledge design, an opaque asymmetric-sealed blob the server never has plaintext access to and cannot forge (it can only echo back what `create_share`'s own `Membership<Item, RequireEdit>`-gated write already validated and stored). Reviewer should check: no OTHER recipient's `sealed_key` can ever appear in this response (the query's `WHERE item_shares.recipient_user_id = ?` binds to the CALLER only, never a client-supplied id). |
| threat_flag: mitigate | `web/src/lib/vault/store.ts` | New client-side crypto surface: `mergeDirectSnapshot`/`decryptDirectSharedRow` run `unsealCollectionKey` + `decryptItemWithSharedKey` against server-supplied ciphertext for the first time outside `ShareDialog.real-wasm.test.ts`'s own isolated proof. Mitigated by reusing that EXACT function pair (no new WASM/crypto primitive), and by AEAD authentication making a wrong-key/wrong-AAD decrypt structurally fail closed (never a silent wrong plaintext) -- a decrypt failure here falls through to the SAME retained-last-known-good `undecryptable: true` path every other decrypt failure in this module already uses. |
| threat_flag: mitigate | `web/src/lib/vault/store.ts` | `DirectShareNotEditableError` closes a real, newly-reachable data-corruption path (see Deviations #2 above) -- a directly-shared item can no longer be silently re-encrypted under the wrong (recipient's own personal) key. Reviewer should check: no OTHER code path in `store.ts` (e.g. `touchVaultItem`, which does not encrypt) needs an analogous guard -- confirmed it does not, since only `updateVaultItem` performs a client-side re-encrypt. |
| threat_flag: accept | `web/src/lib/vault/store.ts::handleSharedRevisions` | A shared-revisions mismatch triggers `refreshCollectionsNow()` unconditionally, including a redundant call on the very first post-unlock tick (collections.ts's own unlock listener already ran). Accepted as a minor efficiency cost (one extra `listCollections()` + identity-keypair-unwrap round trip immediately after unlock), not a correctness or security issue -- both calls resolve to the identical, correctly-scoped result. |
| threat_flag: accept (deferred, not fixed -- out of this plan's scope) | `web/src/lib/vault/store.ts::updateVaultItem` | A directly-shared item's WRITE path remains genuinely unsupported (guarded loud, per `DirectShareNotEditableError`, rather than silently broken). Closing it for real requires a new pv-core/pv-wasm encrypt-as-shared-key-recipient primitive -- new cryptographic surface, well beyond this (client-store-only) plan's declared scope. Logged in `deferred-items.md` for whichever future plan builds "edit a directly-shared item" UI. |

## Self-Check: PASSED

- FOUND: crates/pv-server/src/routes/sync.rs (`DirectSharedItem`, `sealed_key` selected)
- FOUND: crates/pv-server/tests/sync_shared.rs (`sealed_key`/`enc_key` assertions)
- FOUND: web/src/lib/vault/api.ts (`getCollectionSync`, `getSharedDirectSync`)
- FOUND: web/src/lib/vault/store.ts (three-source merge, `DirectShareNotEditableError`, fixed `handleSharedRevisions`)
- FOUND: web/src/lib/vault/store.test.ts (rewritten `onSharedRevisions` block, write-guard test)
- FOUND: web/src/lib/vault/store.real-wasm.test.ts (WINDOWS #8/#9 describe blocks)
- FOUND: .planning/phases/26-web-app-sharing-ui-family-management/deferred-items.md (26-14 section)
- FOUND commit d2ff901 in git log
- FOUND commit 0afc75b in git log
- FOUND commit 6550911 in git log
- FOUND commit 01ab6e5 in git log
- FOUND commit 536cf53 in git log
- FOUND commit 20f08c9 in git log
- FOUND commit 4a6510e in git log
- cd web && npx tsc --noEmit: clean, 0 errors
- cd web && npx vitest run: 77 files, 749 tests passing, zero regressions
- cargo build --workspace: clean
- cargo test --workspace: all crates passing (exit 0)
- cargo test -p pv-server --test sync_shared: 16/16 passing
- WINDOWS.md: entries 7, 8, 9 marked `fixed`

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 14*
*Completed: 2026-08-06*
