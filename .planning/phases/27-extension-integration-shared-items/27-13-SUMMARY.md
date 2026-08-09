---
phase: 27-extension-integration-shared-items
plan: 13
subsystem: extension-passkey-provider
tags: [webauthn, passkey-provider, shared-collections, mv3-service-worker, race-condition, ext-09, ext-10]

requires:
  - phase: 27-12
    provides: "vault-store.ts's PendingSharedItemEntry.status discriminant landed first (this plan's own dependency, confirmed still-green by this plan's own vault-store.test.ts run) -- this plan builds ensureSharedItemsHydrated() alongside it without disturbing that discriminant"
provides:
  - "vault-store.ts::ensureSharedItemsHydrated() -- the shared-item/Collection-Key resolution barrier, the shared-side counterpart to the already-existing ensureItemsHydrated()"
  - "provider-ceremony.ts::handleCredentialsGet's new await pair (ensureItemsHydrated() then ensureSharedItemsHydrated()) before its candidate snapshot -- closes 27-VERIFICATION.md Blocker 2"
  - "a regression test proving both the await ordering and that a shared candidate resolving mid-MV3-wake is included in the resulting picker, not silently omitted"
affects: []

tech-stack:
  added: []
  patterns:
    - "Shared-side resolution barrier mirrors the existing personal-side ensureItemsHydrated() shape exactly: single-flight, idempotent, resolves { ok: true } vacuously while locked, reset to null on lock -- Promise.allSettled (never rejects) around the two eager fire-and-forget calls it wraps, since neither call's rejection may ever propagate (matches their pre-existing best-effort contract)."

key-files:
  created: []
  modified:
    - extension/entrypoints/background/vault-store.ts
    - extension/entrypoints/background/provider-ceremony.ts
    - extension/entrypoints/background/provider-ceremony.test.ts
    - extension/entrypoints/background/provider-ceremony.real-wasm.test.ts

key-decisions:
  - "ensureVaultSyncStarted()'s two existing fire-and-forget lines (refreshCollectionsNow()/refreshSharedItemsNow()) are called EXACTLY as before -- Promise.allSettled only ADDS an awaitable handle on their combined settlement, zero change to call count, call order, or the internal race between the two (doHandleSharedRevisions already awaits its own internal refreshCollectionsNow() before pulling any collection)."
  - "ensureSharedItemsHydrated() is explicitly documented as best-effort -- 'the background did its best to resolve shared state before you read getItems()', never a guarantee every shared item landed. A caller's own existing empty/zero-candidate handling still applies to whatever getItems() returns once it resolves."
  - "No new artificial timeout added around the two new awaits in handleCredentialsGet, per the plan's own reversibility note -- the page-side EXTENSION_AUTHORITY_TIMEOUT_MS (300s) backstop already bounds the whole ceremony end-to-end (T-27-29, accepted in the plan's threat model)."
  - "[Rule 3 - blocking] provider-ceremony.real-wasm.test.ts (not in this plan's files_modified list) maintains its OWN independent vi.mock(\"./vault-store\", ...) factory, separate from provider-ceremony.test.ts's -- it needed the same two new exports (ensureItemsHydrated/ensureSharedItemsHydrated) added and defaulted to { ok: true } in beforeEach, or its existing Task 1 (27-06) real-WASM test failed with 'No ensureItemsHydrated export is defined on the ./vault-store mock'."

requirements-completed: [EXT-09, EXT-10]

coverage:
  - id: D1
    description: "vault-store.ts's ensureSharedItemsHydrated() -- single-flight, idempotent shared-side resolution barrier mirroring ensureItemsHydrated()'s own shape, wired into ensureVaultSyncStarted()'s existing eager-refresh call site with zero behavior change to WHEN refreshCollectionsNow()/refreshSharedItemsNow() fire, reset to null on lock"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.test.ts (full 28-test file, unchanged and green) + vault-store.real-wasm.test.ts (2 tests, unchanged and green)"
        status: pass
    human_judgment: false
  - id: D2
    description: "handleCredentialsGet awaits ensureItemsHydrated() then ensureSharedItemsHydrated(), in that exact order, BEFORE getItems() is ever called for the candidate snapshot -- an await-ordering claim, legitimately provable by a mocked-crypto unit test per this plan's own evidence-rule note"
    requirement: "EXT-09"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#27-13 (Blocker 2 gap closure): handleCredentialsGet's resolution barrier before the candidate snapshot > awaits ensureItemsHydrated() then ensureSharedItemsHydrated(), in that order, BEFORE getItems() is ever called"
        status: pass
    human_judgment: false
  - id: D3
    description: "A shared candidate whose Collection Key resolves DURING ensureSharedItemsHydrated()'s await window is included in the resulting picker (both itemIds present), not silently omitted -- the positive closure proof for the actual race Blocker 2 named, not a vacuous pass (removing the two awaits would read getItems() before the mutation lands, leaving only the personal candidate)"
    requirement: "EXT-09"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#27-13 (Blocker 2 gap closure): handleCredentialsGet's resolution barrier before the candidate snapshot > a shared candidate whose Collection Key resolves DURING ensureSharedItemsHydrated()'s await window is included in the resulting picker -- not silently omitted"
        status: pass
    human_judgment: false
  - id: D4
    description: "The pre-existing zero-candidate fallthrough (27-10, its own pinned regression) is undisturbed by this change"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/provider-ceremony.test.ts#credentials.get: no matching credential (all 3 tests, unchanged and green)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Live regression evidence (not new coverage): the phase's own established live-ceremony proof still passes 2/2 consecutive headed runs after this fix lands"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-ceremony.spec.ts (chromium-ceremony project, --retries=0) -- run twice by the executor against the live pv-server, 2/2 green"
        status: pass
    human_judgment: false

duration: ~25min
completed: 2026-08-09
status: complete
---

# Phase 27 Plan 13: handleCredentialsGet Resolution Barrier (Blocker 2) Summary

**Added `vault-store.ts::ensureSharedItemsHydrated()` (the shared-side counterpart to the existing `ensureItemsHydrated()`) and awaited both in `handleCredentialsGet` before its candidate snapshot, closing 27-VERIFICATION.md Blocker 2 -- a cold MV3-wake `credentials.get()` ceremony can no longer present a personal-only picker as complete while a shared passkey for the same RP is still resolving its Collection Key.**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2/2 completed
- **Files modified:** 4 (0 created, 4 modified)

## Accomplishments

- `vault-store.ts` gained `initialSharedSettled` (the shared-side counterpart to `initialPullSettled`) and `ensureSharedItemsHydrated(): Promise<{ ok: true }>`. `ensureVaultSyncStarted()`'s existing `void refreshCollectionsNow().catch(() => {}); void refreshSharedItemsNow();` fire-and-forget pair is now wrapped in a single `Promise.allSettled([...]).then(() => ({ ok: true as const }))` assignment -- both functions are still called exactly once, in the same place, with the same internal race between them; the only change is that the combined settlement is now awaitable. Reset to `null` on lock alongside `initialPullSettled`, same T-09-19 reasoning.
- `provider-ceremony.ts::handleCredentialsGet` now awaits `ensureItemsHydrated()` then `ensureSharedItemsHydrated()` immediately after `uk` resolves and before `extractGetRpId`/the candidate snapshot -- the resolution barrier 27-VERIFICATION.md's Blocker 2 named as missing. No new artificial timeout: the page-side `EXTENSION_AUTHORITY_TIMEOUT_MS` (300s) backstop already bounds the whole ceremony end-to-end.
- Two new regression tests in `provider-ceremony.test.ts` prove (1) the exact await order (`ensureItemsHydrated` -> `ensureSharedItemsHydrated` -> `getItems`) and (2) the actual gap closure -- a shared candidate whose Collection Key resolves DURING `ensureSharedItemsHydrated()`'s await window (simulated by mutating what `mockGetItems` subsequently returns from inside the mock's own implementation) is included in `payload.candidates`, not silently omitted. Both are await-ordering/control-flow claims, which mocked-crypto evidence legitimately proves (this suite mocks `../../lib/crypto/wasm-loader`, inadmissible for a crypto claim, but neither new test asserts anything about ciphertext).
- The pre-existing zero-candidate fallthrough (27-10's own pinned regression, `describe("credentials.get: no matching credential", ...)`) is untouched and still green -- confirmed by the unchanged 3/3 pass in that block.
- Full extension unit suite: 764/764 green (up from the pre-plan 762 -- 2 new tests, none removed). `npx tsc --noEmit` clean.
- **Live regression evidence** (not new coverage, confirming this fix does not break the phase's own established live proof): built the chrome extension fresh (`npx wxt build -b chrome`) and ran `extension/e2e/dual-extension-ceremony.spec.ts` against the already-running local `pv-server` twice, `--retries=0`, headed (`chromium-ceremony` project) -- 2/2 green, matching 27-06-SUMMARY.md's own established bar for that spec.

## Task Commits

Each task was committed atomically:

1. **Task 1: vault-store.ts's ensureSharedItemsHydrated() resolution barrier** - `a6ced57` (feat)
2. **Task 2: handleCredentialsGet's resolution barrier + regression test** - `1115797` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/background/vault-store.ts` - `initialSharedSettled` module variable, `ensureSharedItemsHydrated()` export, `ensureVaultSyncStarted()`'s eager-refresh call site rewired to also produce an awaitable settlement, lock-handler reset
- `extension/entrypoints/background/provider-ceremony.ts` - `handleCredentialsGet`'s new `await ensureItemsHydrated(); await ensureSharedItemsHydrated();` pair before the candidate snapshot, with imports widened
- `extension/entrypoints/background/provider-ceremony.test.ts` - new mocks (`mockEnsureItemsHydrated`/`mockEnsureSharedItemsHydrated`) defaulted to `{ ok: true }` in `beforeEach`, new "27-13 (Blocker 2 gap closure)" describe block with the two regression tests
- `extension/entrypoints/background/provider-ceremony.real-wasm.test.ts` - same two mocks added to its own independent `vault-store` mock factory + `beforeEach` defaults (Rule 3 fix, see Deviations)

## Decisions Made

See `key-decisions` in frontmatter above (4 decisions, each with full rationale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] provider-ceremony.real-wasm.test.ts needed the same two new mock exports**
- **Found during:** Task 2 verification (`npm run test -- provider-ceremony`)
- **Issue:** `provider-ceremony.real-wasm.test.ts` (not in this plan's `files_modified` list) maintains its own independent `vi.mock("./vault-store", () => ({...}))` factory, separate from `provider-ceremony.test.ts`'s. Its existing "Task 1 (27-06) behavior 2" real-WASM test calls `handleCredentialsGet`, which now unconditionally imports and calls `ensureItemsHydrated`/`ensureSharedItemsHydrated` -- without those exports on its mock, the call failed with `[vitest] No "ensureItemsHydrated" export is defined on the "./vault-store" mock`.
- **Fix:** Added `mockEnsureItemsHydrated`/`mockEnsureSharedItemsHydrated` to the file's own `hoisted` object and `vi.mock("./vault-store", ...)` factory, defaulted both to resolve `{ ok: true }` in its `beforeEach`.
- **Files modified:** `extension/entrypoints/background/provider-ceremony.real-wasm.test.ts`
- **Verification:** `npm run test -- provider-ceremony` green (36/36 across both files); full suite 764/764.
- **Committed in:** `1115797` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3, blocking -- a second, independent test file's mock needed the same new exports the plan's own file list didn't name)
**Impact on plan:** Additive-only test-infrastructure fix; no product-code scope creep, no change to this plan's own must_haves.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. (The live regression e2e run used an already-running local `pv-server`, same standing recipe 27-04/27-05/27-06 established for this phase.)

## Next Phase Readiness

- 27-VERIFICATION.md Blocker 2 is closed: `handleCredentialsGet` can no longer present a partial candidate picker as complete during a cold MV3-wake race between a personal match and a still-resolving shared match for the same RP.
- Phase 27's gap-closure trio (27-12 Blocker 1, 27-13 Blocker 2, 27-14 Gaps 3/4/5) is now complete -- all three gap-closure plans from 27-VERIFICATION.md's `gaps_found` status have landed.
- Full extension test suite: 764/764 green. `npx tsc --noEmit` clean. Live headed ceremony proof: 2/2 consecutive green runs.
- No blockers. Ready for `/gsd-verify-phase 27` re-verification.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-09*

## Self-Check: PASSED

- FOUND: extension/entrypoints/background/vault-store.ts
- FOUND: extension/entrypoints/background/provider-ceremony.ts
- FOUND: extension/entrypoints/background/provider-ceremony.test.ts
- FOUND: extension/entrypoints/background/provider-ceremony.real-wasm.test.ts
- FOUND: .planning/phases/27-extension-integration-shared-items/27-13-SUMMARY.md
- FOUND commit: a6ced57
- FOUND commit: 1115797
- FOUND commit: 01085ae
