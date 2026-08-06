---
phase: 26-web-app-sharing-ui-family-management
plan: 05
subsystem: crypto-client
tags: [typescript, wasm, vitest, collections, sharing, sync]

# Dependency graph
requires:
  - phase: 26-web-app-sharing-ui-family-management
    provides: "26-01's collection_id wire field on every vault item + client-minted collection id contract (WR-09 fix) + createCollection/listCollections/moveItemToCollection wrappers"
provides:
  - "web/src/lib/vault/collections.ts — client store: list collections, unwrap each sealed_key, decrypt each enc_name, cache unwrapped WasmCollectionKey handles per collection id, free them on lock"
  - "store.ts::decryptItemRow scope dispatch: decryptItemForCollection for a collection-scoped row, decryptItem for a personal one"
  - "VaultItem.collectionId (packages/pv-ui/vault/types.ts)"
  - "onSharedRevisions wired onto syncCallbacks — the A-5 / Phase 23 inherited /api/sync/shared consumer"
affects: [26-06, 26-07, 26-08, 26-09, 26-13]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level singleton store (collections.ts) mirrors store.ts's own items/folders shape: module-private array + Set of listeners + useSyncExternalStore hook, with a SEPARATE long-lived Map<id, WasmCollectionKey> cache freed on lock/replacement (never per-call)"
    - "Two independent subscribeLockState listeners (store.ts's items/folders refresh and collections.ts's key cache refresh) both fire off the same unlock event with no ordering guarantee between them — decryptItemRow's undefined-key fallback (existing CR-03 undecryptable path) is the load-bearing mechanism that makes this safe, not an artificial ordering constraint"
    - "Deferred-promise test sequencing (store.real-wasm.test.ts): held getSyncSnapshot's resolution back with a manually-controlled Promise until collections.ts's real refresh genuinely finished caching the key, to assert the STEADY-STATE claim deterministically without fighting or asserting on the transient unlock-time race itself"

key-files:
  created:
    - web/src/lib/vault/collections.ts
    - web/src/lib/vault/collections.real-wasm.test.ts
    - web/src/lib/vault/store.real-wasm.test.ts
    - .planning/phases/26-web-app-sharing-ui-family-management/deferred-items.md
  modified:
    - web/src/lib/vault/store.ts
    - web/src/lib/vault/store.test.ts
    - packages/pv-ui/vault/types.ts

key-decisions:
  - "Collection Key handles are cached in a module-private Map, freed only on lock or per-collection replacement during a refresh -- never per-call -- mirroring lib/crypto/index.ts's own currentUserKey lock-state-singleton discipline (T-26-10)."
  - "A not-yet-cached collection key (collections store hasn't refreshed yet) throws inside decryptItemRow, caught by applySyncSnapshot's existing try/catch and routed through the SAME CR-03 undecryptable/retained-last-known-good fallback every other decrypt failure already uses -- never a crash, never a bespoke second failure path."
  - "onSharedRevisions forces a getSyncSnapshot(0) full re-pull (bypassing lastKnownRevision) on ANY watermark mismatch, because a shared-only change (another member editing a collection) never bumps the caller's OWN personal vault_revision (SYNC-04's per-collection-not-per-user design) -- the normal since-gated pull would never notice it otherwise."
  - "updateVaultItem's own encrypt path is deliberately left untouched (still personal-UserKey-only) -- logged to deferred-items.md rather than fixed, since it is a write-path gap this plan's read-path (decrypt dispatch) task did not cause and no current UI surface exercises."

requirements-completed: [SHARE-01]

coverage:
  - id: D1
    description: "collections.ts lists every collection the caller holds a collection_keys row for, unseals each sealed_key against the caller's own identity keypair, decrypts each enc_name, and caches the unwrapped WasmCollectionKey per collection id"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/collections.real-wasm.test.ts#a real collection's enc_name decrypts correctly through this module against a mocked listCollections() response"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/collections.real-wasm.test.ts#the cached WasmCollectionKey round-trips a real encrypt/decrypt through encryptItemForCollection/decryptItemForCollection"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every cached Collection Key handle is freed on a lock event, and the in-memory collections list is cleared"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/collections.real-wasm.test.ts#a lock event frees every cached WasmCollectionKey handle and clears the in-memory list"
        status: pass
    human_judgment: false
  - id: D3
    description: "store.ts::decryptItemRow dispatches to decryptItemForCollection for a collection-scoped row (real WASM ciphertext) and the item appears fully decrypted in getItems() with collectionId set -- never undecryptable: true"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.real-wasm.test.ts#appears fully decrypted with the correct fields and collectionId set -- never undecryptable: true"
        status: pass
    human_judgment: false
  - id: D4
    description: "A collection-scoped row whose key isn't cached yet falls through to the existing undecryptable retained-last-known-good path, never a crash"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#decrypt dispatch by scope (collection_id) > a collection-scoped row whose key isn't cached yet falls through to the undecryptable retained-last-known-good path, never a crash"
        status: pass
    human_judgment: false
  - id: D5
    description: "onSharedRevisions is wired onto syncCallbacks: a watermark mismatch forces a full getSyncSnapshot(0) re-pull merged via applySyncSnapshot; an unchanged payload is a no-op; the watermark resets on every unlock"
    requirement: "SHARE-01"
    verification:
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#onSharedRevisions (A-5 / Phase 23 inherited obligation) > a watermark mismatch (new collection revision) triggers a full getSyncSnapshot(0) re-pull that merges via applySyncSnapshot"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#onSharedRevisions (A-5 / Phase 23 inherited obligation) > an unchanged shared-revisions payload triggers no extra pull"
        status: pass
      - kind: unit
        ref: "web/src/lib/vault/store.test.ts#onSharedRevisions (A-5 / Phase 23 inherited obligation) > the watermark resets on every unlock -- an identical payload that already triggered a pull triggers again after a lock/re-unlock cycle"
        status: pass
    human_judgment: false
  - id: D6
    description: "The RED demonstration was genuinely performed on the central-proof real-WASM test (not merely asserted): reverting the dispatch to plain decryptItem produces an observed, reachable failure"
    verification:
      - kind: other
        ref: "Manual mutate-run-revert of web/src/lib/vault/store.ts::decryptItemRow, npx vitest run src/lib/vault/store.real-wasm.test.ts -- observed failure text recorded verbatim below"
        status: pass
    human_judgment: false
  - id: D7
    description: "Full end-to-end proof that a real client and real server together render a shared folder's contents (both halves proven independently here, together deferred to Plan 26-13's live Playwright run)"
    verification: []
    human_judgment: true
    rationale: "This plan's own Test-tiering decision (no vitest-tier live pv-server exists in this repo): the real-WASM tests prove the client half against mocked, but genuinely real-WASM-encrypted, wire responses. Plan 26-01/26-04's Rust tests prove the server half. Proving both together against one real running server is Plan 26-13's live 2-session Playwright run, out of this plan's scope."

# Metrics
duration: ~20min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 05: Collection decrypt dispatch + A-5 onSharedRevisions consumer Summary

**Closes the phase's own self-declared central architecture gap — `store.ts::decryptItemRow` now branches on `row.collection_id` to route a collection-scoped item through `decryptItemForCollection` instead of unconditionally guessing the personal User Key, backed by a new `collections.ts` client store that lists, decrypts, and caches unwrapped Collection Keys, and wires the Phase 23 `/api/sync/shared` consumer for the first time.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-06T11:13:56+02:00 (base commit `a52380c`)
- **Completed:** 2026-08-06T11:30:39+02:00
- **Tasks:** 2
- **Files modified:** 7 (3 created, 3 modified, 1 new deferred-items.md)

## Accomplishments

- **SHARE-01's central architecture gap closed.** Before this plan, a collection-scoped item's `enc_key`/`enc_data` (bound to that collection's own `CollectionKey` and a scope-bound AAD, KEY-03) were ALWAYS decrypted with the personal User Key via `decryptItem` — a folder could be created and shared, but its contents were permanently unreadable, including by its own creator. `decryptItemRow` now branches on `row.collection_id`.
- **New `web/src/lib/vault/collections.ts` module-level singleton**, mirroring `store.ts`'s own items/folders shape: on unlock, lists every collection via `listCollections()`, resolves the caller's own identity keypair once per refresh, unseals each `sealed_key` into a `WasmCollectionKey`, decrypts each `enc_name`, and caches every unwrapped key in a `Map<collectionId, WasmCollectionKey>`. `getCollectionKey(id)` is the synchronous lookup `decryptItemRow` consumes.
- **Every cached Collection Key is freed on lock** (T-26-10) and on per-collection replacement during a refresh — never left to a non-deterministic `FinalizationRegistry`.
- **A-5 closed: `onSharedRevisions` finally has a client consumer.** `/api/sync/shared` shipped fully implemented, authorized and tested since Phase 23 with zero caller. `store.ts` now tracks a `{collections, direct}` revision watermark, resets it to empty on every unlock, and forces a full `getSyncSnapshot(0)` re-pull (bypassing the normal `lastKnownRevision` gate, since a shared-only change never bumps the caller's OWN `vault_revision`) on any mismatch.
- **Genuine RED-then-GREEN proof performed on the central-proof real-WASM test** (not merely asserted — see below).

## Task Commits

Each task was committed atomically:

1. **Task 1: Collections client store — list, decrypt names, cache unwrapped Collection Keys** — `c207427` (feat)
2. **Task 2: store.ts decrypt dispatch by scope + A-5 onSharedRevisions consumer** — `39d86c1` (fix)

_No plan-metadata commit yet — this SUMMARY/STATE commit follows per the standard final-commit step._

## RED Proof (mandatory per this plan's own hazard #2 — "tests that cannot fail")

Performed on the REAL test harness, not asserted:

1. Temporarily mutated `web/src/lib/vault/store.ts::decryptItemRow` to unconditionally call `decryptItem(uk, combined, row.id, row.revision)` (the pre-fix personal-only behavior), removing the `row.collection_id` branch entirely.
2. Ran `npx vitest run src/lib/vault/store.real-wasm.test.ts`.
3. **Observed failure:**
   ```
   stderr | src/lib/vault/store.real-wasm.test.ts > store.ts decrypt dispatch: a real collection-scoped item decrypts and appears in getItems() (real WASM, network mocked) > appears fully decrypted with the correct fields and collectionId set -- never undecryptable: true
   pv: failed to decrypt item item-central-proof during sync merge -- keeping last-known-good copy decryption failed (wrong key or corrupted data)

    ❯ src/lib/vault/store.real-wasm.test.ts (1 test | 1 failed) 1072ms
      × store.ts decrypt dispatch: a real collection-scoped item decrypts and appears in getItems() (real WASM, network mocked) > appears fully decrypted with the correct fields and collectionId set -- never undecryptable: true 1066ms
        → expected undefined to be defined

   ⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

    FAIL  src/lib/vault/store.real-wasm.test.ts > store.ts decrypt dispatch: a real collection-scoped item decrypts and appears in getItems() (real WASM, network mocked) > appears fully decrypted with the correct fields and collectionId set -- never undecryptable: true
   AssertionError: expected undefined to be defined
    ❯ src/lib/vault/store.real-wasm.test.ts:179:84
   ```
   The item never appeared in `getItems()` at all (not merely flagged `undecryptable: true`) — a fresh unlock has no prior good copy for `applySyncSnapshot`'s decrypt-failure fallback to retain, so a failing row with no prior copy is dropped from the array entirely (the existing, documented CR-03 behavior for a first-ever decrypt failure). This is the exact failure mode the fix eliminates.
4. Reverted the mutation (restored the `row.collection_id === null` branch and the `getCollectionKey`/`decryptItemForCollection` path). Re-ran the suite — the test passes, `npx tsc --noEmit` clean, and the full `npx vitest run` (70 files, 646 tests) passes with zero collateral regressions.

This proves the central-proof test is a real regression guard: it would have failed on the pre-fix dispatch, and it passes against the fixed one.

## Files Created/Modified

- `web/src/lib/vault/collections.ts` (new) — module-level singleton: list/decrypt/cache Collection Keys, `getCollectionKey`, `useCollections`, free-on-lock
- `web/src/lib/vault/collections.real-wasm.test.ts` (new) — real-WASM proof: name decrypt, key round-trip, lock-frees-everything
- `web/src/lib/vault/store.ts` — `decryptItemRow` scope dispatch, `VaultItem.collectionId` carry-forward in `updateVaultItem`, `onSharedRevisions`/watermark wiring on `syncCallbacks`
- `web/src/lib/vault/store.real-wasm.test.ts` (new) — the phase's central-proof test: a real collection-scoped item decrypts and appears in `getItems()`
- `web/src/lib/vault/store.test.ts` — mocked coverage for the dispatch branch (happy path + not-yet-cached-key fallback) and `onSharedRevisions`'s watermark logic; 16 pre-existing `ItemRow` literal fixtures gained `collection_id: null` (Rule 3 ripple)
- `packages/pv-ui/vault/types.ts` — `VaultItem.collectionId?: string | null`
- `.planning/phases/26-web-app-sharing-ui-family-management/deferred-items.md` (new) — logs the out-of-scope `updateVaultItem` encrypt-path gap

## Decisions Made

- Collection Key handles are cached long-lived (freed on lock or per-collection replacement, never per-call) — mirrors `lib/crypto/index.ts`'s own `currentUserKey` singleton discipline, and matches this plan's explicit `<action>` instruction.
- A not-yet-cached collection key throws inside `decryptItemRow`, deliberately reusing `applySyncSnapshot`'s EXISTING try/catch and CR-03 undecryptable fallback rather than inventing a second, parallel failure path — one merge-failure mechanism for the whole module.
- `onSharedRevisions` always does a FULL `getSyncSnapshot(0)` re-pull on any mismatch (never a partial/targeted pull) — reuses the exact same `applySyncSnapshot` merge every other pull path already uses, avoiding a second merge implementation.
- `store.real-wasm.test.ts`'s central-proof test deliberately holds `getSyncSnapshot`'s resolution back with a manually-controlled deferred `Promise` until `collections.ts`'s real refresh has genuinely finished caching the key. Two independent `subscribeLockState` listeners (collections.ts's and store.ts's own) both fire off the SAME unlock event with no ordering guarantee — this sequencing lets the test assert the plan's steady-state claim ("once the key IS cached, the item decrypts correctly") deterministically, without either fighting the unforced race or asserting on the race's outcome itself (which the SEPARATE, mocked "not-yet-cached" test in `store.test.ts` already covers).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 16 pre-existing `ItemRow` literal fixtures in `store.test.ts` gained `collection_id: null`**
- **Found during:** Task 2, after adding the `row.collection_id === null` branch to `decryptItemRow`
- **Issue:** Several pre-existing `mockGetSyncSnapshot.mockResolvedValue({...})` fixtures across `store.test.ts` (predating Plan 26-01's wire-field addition) constructed `ItemRow`-shaped objects without a `collection_id` field at all. Since these are untyped `vi.fn()` mocks, `npx tsc --noEmit` never caught the omission — but at RUNTIME, `row.collection_id === null` evaluates `false` when the field is `undefined` (omitted), routing these rows into the new collection-scope branch and throwing `no cached Collection Key for collection undefined`, breaking 22 previously-passing tests.
- **Fix:** Added `collection_id: null` to all 16 remaining one-liner/multi-line `ItemRow` literals lacking it (mirrors Plan 26-01's own identical Rule 3 fix for the same root cause — a required field's ripple effect across pre-existing test fixtures).
- **Files modified:** `web/src/lib/vault/store.test.ts`
- **Verification:** `npx vitest run src/lib/vault/store.test.ts` — all 30 pre-existing tests (plus this plan's own 7 new ones, 37 total) pass; full `npx vitest run` — 70 files / 646 tests pass.
- **Committed in:** `39d86c1` (Task 2 commit)

**2. [Rule 1 - Bug] `updateVaultItem`'s response construction now carries `collectionId` forward from the existing item**
- **Found during:** Task 2, immediately after adding `VaultItem.collectionId`
- **Issue:** `updateVaultItem`'s own `PUT` response body has no `collection_id` field (mirrors the pre-existing `isShared`/`lastEditorEmail` gap WR-02 already fixed for the identical reason) — without a carry-forward, saving ANY item would make `item.collectionId` become `undefined` immediately after its own save, right up until the next background snapshot repopulated it.
- **Fix:** Added `collectionId: existing?.collectionId` to the `updated: VaultItem` construction, alongside the existing `isShared`/`lastEditorEmail` carry-forwards, using the exact same pattern WR-02 established.
- **Files modified:** `web/src/lib/vault/store.ts`
- **Verification:** `npx tsc --noEmit` clean; `npx vitest run src/lib/vault/store.test.ts` — `updateVaultItem` describe block passes unchanged.
- **Committed in:** `39d86c1` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 3 — required-field ripple effect across pre-existing test fixtures, 1 Rule 1 — a real regression this plan's own new field would otherwise introduce).
**Impact on plan:** Both auto-fixes are direct, mechanical consequences of this plan's own `<action>`-specified changes. No scope creep, no test assertions weakened.

## Issues Encountered

- A genuine, expected architectural race between `collections.ts`'s and `store.ts`'s independent `subscribeLockState` listeners (both fire on the same unlock event, no ordering guarantee) means the FIRST post-unlock snapshot merge of a collection-scoped item can transiently fail if the personal snapshot pull resolves before the collections refresh finishes caching the key. This is EXPECTED and explicitly authorized by this plan's own `<action>` text (fall through to the undecryptable path) — not a bug. It self-heals on the next WS/poll retry via the existing `WR-01` retry mechanism (never advances the watermark on a failed merge). Documented here rather than "fixed" because eliminating the race would require either serializing the two listeners (an architectural change out of this plan's scope) or an artificial coupling between two otherwise-independent singleton modules.
- One out-of-scope discovery (`updateVaultItem`'s encrypt path never dispatches to `encryptItemForCollection`) logged to `deferred-items.md` per the SCOPE BOUNDARY rule rather than fixed — see that file for the full rationale.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- A collection-scoped vault item now genuinely decrypts and renders in the same list a personal item does — SHARE-01's "not merely creatable but genuinely readable" truth is proven by real WASM crypto in `store.real-wasm.test.ts`.
- A member sees a co-member's edit to a shared folder's contents without a manual page refresh — `onSharedRevisions` is wired; the actual live cross-session proof is Plan 26-13's job (this plan proves the client-side merge logic against mocked revision payloads, per its own Test-tiering decision).
- `web/src/lib/vault/collections.ts`'s `useCollections()` hook and `getCollectionKey()` are now available for any downstream plan building the actual Collections UI (list, picker, Sharing overview) — explicitly not built here.
- `deferred-items.md`'s `updateVaultItem` encrypt-path gap is a real, documented open item for whichever plan builds "edit a shared item" UI or extends Plan 26-08's move-to-collection re-encrypt logic.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: mitigate | `web/src/lib/vault/collections.ts` | T-26-10 (Denial of Service, memory): cached `WasmCollectionKey` handles across a long-lived session. Mitigated exactly as this plan's own threat register specifies — every handle is freed explicitly on lock (proven by `collections.real-wasm.test.ts`'s dedicated lock-frees test) and on per-collection replacement during a refresh, never left to a non-deterministic `FinalizationRegistry`. |
| threat_flag: accept (structural) | `web/src/lib/vault/store.ts::decryptItemRow` | T-26-11 (Tampering): a wrong-scope decrypt (personal key against collection ciphertext, or vice versa) succeeding silently. This plan's threat register correctly disposes this as `accept` because AEAD authentication tag verification makes it structurally impossible — a wrong key/AAD combination always throws (observed directly in this plan's own RED proof above), never silently returns wrong plaintext. The dispatch fix routes to the CORRECT key by construction; a miss (key not yet cached) falls back to the existing honest `undecryptable` state, never a wrong decrypt. |
| threat_flag: new-consumer-surface | `web/src/lib/vault/store.ts::onSharedRevisions` | A-5's new client consumer of `/api/sync/shared` (Phase 23's endpoint, previously dead code client-side). No new SERVER trust boundary — this is a client-side response consumer only, reading data the server already authorizes via existing `Membership<Collection, RequireRead>`/`item_shares` gates. The one client-side risk (a malformed/adversarial revision payload driving an unbounded pull loop) is bounded by the existing `getSyncSnapshot(0)` merge's own `MAX_FAILED_MERGE_RETRIES` watermark-advance-on-exhaustion logic (WR-01, unchanged by this plan) — a persistently-failing merge still eventually stops retrying. |

## Self-Check: PASSED

- FOUND: web/src/lib/vault/collections.ts
- FOUND: web/src/lib/vault/collections.real-wasm.test.ts
- FOUND: web/src/lib/vault/store.real-wasm.test.ts
- FOUND: web/src/lib/vault/store.ts
- FOUND: web/src/lib/vault/store.test.ts
- FOUND: packages/pv-ui/vault/types.ts
- FOUND: .planning/phases/26-web-app-sharing-ui-family-management/deferred-items.md
- FOUND commit c207427 in git log
- FOUND commit 39d86c1 in git log

---
*Phase: 26-web-app-sharing-ui-family-management*
*Plan: 05*
*Completed: 2026-08-06*
