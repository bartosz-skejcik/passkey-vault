---
phase: 27-extension-integration-shared-items
plan: 15
subsystem: extension-vault-sync
tags: [vault-store, shared-items, direct-share, real-wasm, gap-closure]

requires:
  - phase: 27-04
    provides: "vault-store.ts's mergeDirectSnapshot / decryptDirectSharedRow direct-share read path, and the original getPendingSharedItems() single-array retain-vs-drop decision this plan extends"
  - phase: 27-12
    provides: "PendingSharedItemEntry.status pending/broken discriminant and markPending()'s upsert semantics — the collection-scoped shape this plan mirrors for the sibling direct-share path"
provides:
  - "mergeDirectSnapshot's catch now calls markPending(row.id, null, \"broken\") on an undecryptable directly-shared row, closing the last 27-VERIFICATION.md blocker (27-04's silent-drop prohibition, previously violated only on this one path)"
  - "PendingSharedItemEntry.collectionId widened to string | null — a direct share has no collection; the one consumer that reads it (doHandleSharedRevisions's revoked-collection purge) already treats a non-matching value as leave-alone, so null is correctly never touched by that purge"
  - "Documented discriminant reasoning: a direct-share decrypt failure classifies 'broken' immediately, never 'pending' — identityKey is fully resolved (awaited) before the per-row loop starts, so there is no 'not cached yet' transient window the way getCollectionKey()'s cache has on the collection-scoped path"
  - "vault-store.real-wasm.test.ts real-AEAD proof (genuine WasmUserKey/WasmIdentityKey, real encryptItem/sealItemKeyForRecipient, a tampered ciphertext byte), falsification-tested"
affects: []

tech-stack:
  added: []
  patterns:
    - "Sibling-path gap closure: extended 27-12's pending/broken discriminant machinery (markPending/clearPending/getPendingSharedItems) to a second catch site rather than inventing a parallel mechanism, per this fix's own instruction"
    - "deferRealFree() (ported from web/src/lib/vault/store.real-wasm.test.ts): a real-WASM test whose mocked ensureOwnIdentityKeypair hands back the SAME WasmIdentityKey instance both the fixture-building code and production's own identityKey.free?.() need must make production's free() a no-op and defer the real free to an explicit test-owned .dispose() — otherwise production's own finally-block free (mergeDirectSnapshot's identityKey.free?.()) double-frees the shared handle before the test's own cleanup runs ('null pointer passed to rust')"

key-files:
  created: []
  modified:
    - extension/entrypoints/background/vault-store.ts
    - extension/entrypoints/background/vault-store.test.ts
    - extension/entrypoints/background/vault-store.real-wasm.test.ts

key-decisions:
  - "collectionId: string | null (not a separate `scope` field) on PendingSharedItemEntry — the verifier's suggested minimal shape. The single existing collectionId consumer (doHandleSharedRevisions's revoked-collection purge, `p.collectionId !== knownId`) already treats null as never-matching, so no purge-logic change was needed, and ItemListView.tsx's broken-row branch already renders from {id, status} alone — no popup change at all."
  - "Direct-share decrypt failures classify 'broken' immediately, never 'pending' -- a deliberate departure from copying the collection-scoped logic verbatim, per this fix's own instruction to reason about the discriminant on its own terms. mergeDirectSnapshot resolves+awaits identityKey via ensureOwnIdentityKeypair(uk) UNCONDITIONALLY before the per-row loop starts (unlike getCollectionKey(), a synchronous read of a cache that may not have finished its first refresh yet), so a failure reaching the catch was already attempted with a fully-resolved key in hand -- there is nothing left for a later reattempt to resolve that this attempt did not already try, fully."
  - "clearPending(row.id) added to the success branch (previously absent, since markPending was never called on this path at all) for symmetry with applySyncSnapshot/mergeCollectionSnapshot -- a previously-broken direct share that later re-decrypts (e.g. after a corrected re-share) clears its stub instead of leaving a stale entry."
  - "Falsification proof used a genuinely CORRUPTED ciphertext byte (wasm-bindgen's own {nonce: number[], ciphertext: number[]} wire shape, not base64), not a wrong key -- this fix's own instruction named this specific evidence shape ('real ciphertext, real key, corrupted payload'), distinguishing it from 27-12's collection-scoped proof (which used a genuinely wrong key)."

requirements-completed: []

coverage:
  - id: D1
    description: "mergeDirectSnapshot's catch records a broken directly-shared row via markPending(row.id, null, \"broken\") instead of a console.warn-only silent drop, verified against REAL crypto (genuine tampered-ciphertext AEAD integrity failure, real seal/unseal handshake)"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.real-wasm.test.ts#a directly-shared row with a genuinely corrupted ciphertext (real identity keypair, real seal/unseal, tampered AEAD payload) is recorded via getPendingSharedItems() as {status: 'broken', collectionId: null}"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.real-wasm.test.ts#an UNCORRUPTED directly-shared row decrypts correctly and is never recorded via getPendingSharedItems() (falsification counterpart)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.test.ts#Test 22 (mocked-dispatch mirror of Test 15's shape for the collection path)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-08-09
status: complete
---

# Phase 27 Plan 15: Direct-Share Silent-Drop Fix — mergeDirectSnapshot Records a Broken Row Instead of Vanishing It Summary

**`vault-store.ts`'s `mergeDirectSnapshot` now records an undecryptable directly-shared row via `markPending(row.id, null, "broken")` instead of a `console.warn`-only silent drop — closing 27-VERIFICATION.md's last remaining blocker (the 27-04 prohibition, previously violated only on this one sibling path to 27-12's already-fixed collection-scoped path), proven against a genuine tampered-ciphertext AEAD failure, not a mocked throw.**

## Performance

- **Duration:** ~35 min
- **Files modified:** 3

## Accomplishments

- `PendingSharedItemEntry.collectionId` widened from `string` to `string | null` — a direct share has no collection. The interface's own doc comment now explains why the one existing `collectionId` consumer (the revoked-collection purge in `doHandleSharedRevisions`) is unaffected: `null !== knownId` is always true, so a direct-share entry is never touched by that purge.
- `mergeDirectSnapshot`'s per-row catch now calls `markPending(row.id, null, "broken")`, with a comment explaining the discriminant decision: unlike the collection-scoped path's `CollectionKeyPendingError` (gated on `hasRefreshedThisSession()`, a genuinely transient "not cached yet" window), this path's `identityKey` is fully resolved and awaited BEFORE the per-row loop ever starts — so any failure reaching this catch was already attempted with a fully-resolved key. There is no analogous transient state; the classification is always `"broken"`, never `"pending"`.
- `clearPending(row.id)` added to the success branch of the same loop (symmetry with `applySyncSnapshot`/`mergeCollectionSnapshot`, which already had it) — a previously-broken directly-shared item that later re-decrypts correctly now clears its stub entry instead of leaving a stale one behind.
- No popup change required: `ItemListView.tsx`'s broken-row branch already renders purely from `{id, status}`, exactly as the verifier's gap report predicted.
- `vault-store.real-wasm.test.ts` gained a new describe block (real WASM, no `wasm-loader` mock) building a genuine directly-shared row — real `WasmUserKey`, real `WasmIdentityKey`, real `encryptItem`/`sealItemKeyForRecipient` — and corrupting one byte of the AEAD ciphertext's `{nonce, ciphertext}` wire shape before feeding it through `handleSharedRevisions`. Two tests: the corrupted case (asserts `{status: "broken", collectionId: null}`, never absent) and an uncorrupted counterpart (asserts clean decrypt, never recorded as pending) — the latter is the falsification proof that the former's failure is real AEAD corruption, not a malformed fixture.
- Added `deferRealFree()` (ported from `web/src/lib/vault/store.real-wasm.test.ts`'s identical helper) to avoid a double-free: `mergeDirectSnapshot`'s own `finally { identityKey.free?.(); }` already frees the identity keypair handle in production, and since the test's mock hands back the SAME real `WasmIdentityKey` instance both the fixture-building code and the production call need, a second explicit `.free()` in the test's own cleanup crashed with "null pointer passed to rust" until production's call was made a no-op and the real free deferred to an explicit test-owned `.dispose()`.
- `vault-store.test.ts` gained Test 22, a mocked-dispatch regression mirroring Test 15's shape for the collection path — asserts the same `{id, collectionId: null, status: "broken"}` shape via a mocked `decryptItemWithSharedKey` throw, and explicitly asserts the status is never `"pending"`.

## Task Commits

- **Code fix + tests** - `b8ac8d0` (fix)
- **Plan metadata (SUMMARY.md + STATE.md + ROADMAP.md)** - (this commit)

## Files Created/Modified

- `extension/entrypoints/background/vault-store.ts` — `PendingSharedItemEntry.collectionId: string | null`, `markPending`'s parameter type widened, `mergeDirectSnapshot`'s catch now calls `markPending(row.id, null, "broken")`, `clearPending(row.id)` added to the success branch, doc comments explaining the discriminant reasoning
- `extension/entrypoints/background/vault-store.test.ts` — Test 22 (mocked-dispatch mirror of Test 15 for the direct-share path)
- `extension/entrypoints/background/vault-store.real-wasm.test.ts` — new describe block (2 tests: corrupted/broken and uncorrupted/falsification-counterpart), `deferRealFree()` helper, `corruptEncData()`/`buildRealDirectSharedRow()` fixture builders

## Decisions Made

See `key-decisions` in frontmatter above (4 decisions, each with full rationale).

## Deviations from Plan

None — this was a small, precisely-specified fix executed directly per the objective's own instructions, not a planned multi-task PLAN.md. No architectural changes, no scope expansion beyond the named defect.

## Falsification Check (constraint 4, non-negotiable)

Before committing, the "broken" real-WASM test was temporarily fed the UNCORRUPTED payload (`buildRealDirectSharedRow(..., true)` → `..., false)`) and re-run. It went RED for the right reason:

```
expected [ { …(10) } ] to deeply equal []
```

— the row genuinely decrypted (the full `VaultItem` with `fields.name: "Real Direct Share Fixture (corrupted)"` appeared in `getItems()`, and `getPendingSharedItems()` was empty), proving the passing "broken" assertion in the committed test is backed by a real, corruption-dependent AEAD integrity failure — not a fixture bug, not a mocked throw, not an unconditional failure. The change was reverted immediately after (`diff` against the pre-probe backup confirmed byte-identical restoration) and the suite re-run green before committing.

## Issues Encountered

- The real-WASM direct-share fixture initially crashed both new tests with "null pointer passed to rust" on `bob.free?.()` inside the test's own `finally` block — root cause: `mergeDirectSnapshot`'s own production `finally { identityKey.free?.(); }` already freed the same shared `WasmIdentityKey` handle the mocked `ensureOwnIdentityKeypair` hands back every call. Fixed by porting web's `deferRealFree()` helper (makes production's `.free()` call a no-op, defers the one real free to an explicit test-owned `.dispose()`), the exact same pattern `web/src/lib/vault/store.real-wasm.test.ts` already documents for this identical multi-consumer-of-one-real-handle shape.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- 27-VERIFICATION.md's last remaining gap (13/14 → 14/14 once re-verified) is closed: both shared-item read paths (collection-scoped via 27-12, direct via this fix) now honor 27-04's "never silently drop a shared item the user has access to" prohibition identically.
- Extension unit suite: 767/767 green (was 764/764 — 3 new tests added, zero regressions). `npx tsc --noEmit` clean. `cargo test --workspace` green (33 pv-core tests + workspace, unaffected — no Rust changes in this fix).
- Phase 27 was already the last phase of the v0.4 milestone; this closes its final outstanding verification blocker with no further code changes anticipated before re-verification.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-09*

## Self-Check: PASSED

- FOUND: extension/entrypoints/background/vault-store.ts
- FOUND: extension/entrypoints/background/vault-store.test.ts
- FOUND: extension/entrypoints/background/vault-store.real-wasm.test.ts
- FOUND: .planning/phases/27-extension-integration-shared-items/27-15-SUMMARY.md
- FOUND commit: b8ac8d0 (fix(27-15): mergeDirectSnapshot records a broken directly-shared row instead of silently dropping it)
