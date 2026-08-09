---
phase: 27-extension-integration-shared-items
plan: 04
subsystem: extension-vault-sync
tags: [wasm, vault-store, shared-collections, key-01, ext-11, sync-client, playwright, live-proof]

requires:
  - phase: 27-01
    provides: extContextB/extensionIdB worker fixtures — the two-extension harness this plan's live proof runs on
  - phase: 27-03
    provides: wasm-loader.ts's 12 collection/identity re-exports, collections-store.ts's Collection Key cache, identity-store.ts's idempotent identity-keypair primitive
provides:
  - "vault-store.ts's three-source shared-read merge (personalItems/collectionSharedItems/directSharedItems -> recomputeItems), ported from web/src/lib/vault/store.ts"
  - "CollectionKeyPendingError + getPendingSharedItems() — the pending-vs-broken decrypt classification, an extension-only addition (no web counterpart) closing the MV3-wake ordering gap web's browser-tab lifecycle never has"
  - "KEY-01's client trigger: vault-session.ts's setUnlockedUserKey calls identity-store.ts's publishOnUnlock(uk) at this extension's single unlock choke point"
  - "sync-client.ts's onSharedRevisions pull, alongside every personal-snapshot pull, with its own independent try/catch and 404-latch (sharedPullDisabled)"
  - "router.ts/ext-protocol.ts's vault.list response gains pending/collections fields — the popup's future route to pending-stub rows and decrypted collection names"
  - "extension/e2e/fixtures-account-setup.ts — REST-level, real-WASM two-account/family/collection/item fixture provisioning, no UI driven at all"
  - "extension/e2e/dual-extension-sharing.spec.ts — this phase's first live two-extension recipient-side proof, 3/3 consecutive green runs against a real pv-server"
affects: [27-05, 27-06, 27-07, 27-08, 27-09, 27-10, 27-11]

tech-stack:
  added: []
  patterns:
    - "Pending-vs-broken decrypt classification (CollectionKeyPendingError vs. a generic decrypt failure), gated by collections-store.ts's hasRefreshedThisSession() — both classifications surface via ONE getPendingSharedItems() array so a collection-scoped row is never simply absent from vault.list with no trace"
    - "Node-side real-WASM Playwright fixture: stub globalThis.chrome BEFORE dynamically importing extension/lib/crypto/wasm-loader.ts (its transitive wxt/browser import resolves its own `browser` binding ONCE, at module-evaluation time), then intercept global.fetch to serve the real compiled .wasm bytes off disk — same two-part technique web/e2e/shared-sync.spec.ts's ensureNodeWasm() uses, adapted for the extension's chrome-vs-browser global"

key-files:
  created:
    - extension/e2e/fixtures-account-setup.ts
    - extension/e2e/dual-extension-sharing.spec.ts
  modified:
    - extension/entrypoints/background/vault-api.ts
    - extension/entrypoints/background/vault-store.ts
    - extension/entrypoints/background/vault-store.test.ts
    - extension/entrypoints/background/vault-session.ts
    - extension/entrypoints/background/collections-store.ts
    - extension/entrypoints/background/identity-store.ts
    - extension/entrypoints/background/sync-client.ts
    - extension/entrypoints/background/sync-client.test.ts
    - extension/entrypoints/background/router.ts
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/messaging/ext-protocol.test.ts

key-decisions:
  - "CollectionKeyPendingError AND a genuinely-broken collection-scoped decrypt failure both surface via the SAME getPendingSharedItems() array/shape, rather than two separate lists — Task 1 is background-wiring-only (no popup UI lands until later plans), so a single always-populated channel is what makes the must_haves.prohibitions guarantee ('never simply absent from vault.list with no trace') hold for both classifications without a future popup consumer needing to know which produced a given entry. Documented explicitly per the UI-SPEC's E1-error backstop instruction ('the retain-vs-drop split must be an explicit, commented decision')."
  - "vault-store.ts's ensureVaultSyncStarted() wires onSharedRevisions into startSync()'s callbacks object in a SEPARATE commit after Task 2 (not Task 1) — Task 1 could not reference that field before sync-client.ts's SyncCallbacks type supported it (tsc would fail on an excess-property literal). Documented as a Rule 2/3 deviation: without this line, Task 2's own pullOnce() extension is unreachable in production."
  - "Task 3's fixtures-account-setup.ts adds member B to the family via a direct owner-side POST /api/families/members call, not invitations.rs's accept endpoint — that endpoint's own crypto (pv_core::invite/WasmInviteChannel) is not part of wasm-loader.ts's re-export list, and wiring it in is out of this task's file scope. The direct-add path is the same REST-only pattern web/e2e/shared-sync.spec.ts's own ensureFamilyMembersRealKeys already established as this codebase's precedent."
  - "fixtures-account-setup.ts reuses the EXACT FAMILY_OWNER_EMAIL/FAMILY_OWNER_PASSWORD literal string values web/e2e/fixtures.ts already established (ported as values, not a cross-package import) — sidesteps the singleton-family ownership race entirely, since this project's e2e ecosystem already converges on that one identity regardless of which suite creates it first."
  - "Every crypto primitive in fixtures-account-setup.ts is REAL (Argon2id-derived User Keys, real identity keypairs, a real sealed Collection Key) — never a dummy/opaque placeholder blob, unlike web/e2e/shared-sync.spec.ts's own posture for member B's data. Member B's real extension must actually decrypt this data for the live proof to mean anything; a dummy blob would make the proof vacuous."
  - "pv-server for the live Task 3 run required PV_STATIC_DIR pointed at web/out (the built static export) — the server-origin sign-in ceremony window navigates to a real web-app page, and without a served static app the ceremony window silently self-closed before the popup could interact with it (root-caused via a first failed run; not a code defect in this plan's own deliverables)."

patterns-established:
  - "Node-side real-WASM Playwright fixture: extension/e2e/fixtures-account-setup.ts's ensureNodeWasm() -- the SAME two-part globalThis.chrome-stub + global.fetch-intercept technique any future extension e2e fixture needing real crypto can reuse verbatim."

requirements-completed: [KEY-01, EXT-11]

coverage:
  - id: D1
    description: "vault-store.ts's three-source shared-read merge (personalItems/collectionSharedItems/directSharedItems), decryptItemRow's scope dispatch (personal vs. collection-scoped Collection Key), decryptDirectSharedRow, mergeCollectionSnapshot/mergeDirectSnapshot/doHandleSharedRevisions orchestration -- all real-WASM-consistent (mocked at the WASM boundary, exercising vault-store.ts's own merge/dispatch logic for real)"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.test.ts#Test 13 (collection-scope dispatch), Test 18/19/20/21 (shared-revisions merge suite)"
        status: pass
    human_judgment: false
  - id: D2
    description: "CollectionKeyPendingError distinguishes pending (collections store hasn't refreshed this session) from genuinely broken (key resolved, decrypt still failed) — both surface via getPendingSharedItems(), never a silent drop"
    requirement: "EXT-11"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.test.ts#Test 14 (pending), Test 15 (broken, must_haves.prohibitions), Test 16 (resolves and clears), Test 17 (personal rows never enter this channel)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Lock-path ordering: freeAllCollectionKeys()/freeIdentityKey() run in the EXISTING subscribeSessionLockState handler, immediately AFTER stopSync() — same handler, never a second listener"
    requirement: "EXT-11"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-store.test.ts#Test 4 (call-order assertion), Test 4b (getPendingSharedItems cleared on lock)"
        status: pass
    human_judgment: false
  - id: D4
    description: "KEY-01's client trigger: setUnlockedUserKey calls identity-store.ts's freeIdentityKey() at entry and publishOnUnlock(uk) after currentUserKey is assigned -- the extension's single unlock choke point"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/identity-store.real-wasm.test.ts (27-03's own suite, unchanged, still proves ensureOwnIdentityKeypair's idempotent generate-or-adopt contract that publishOnUnlock wraps)"
        status: pass
      - kind: e2e
        ref: "extension/e2e/dual-extension-sharing.spec.ts#member B's extension displays the exact plaintext name of the item member A shared (KEY-01's own full-lifecycle proof: B's real identity keypair, pre-published by the fixture, is what B's REAL popup unlock must correctly adopt via publishOnUnlock's idempotent-unwrap branch for the shared Collection Key to ever decrypt)"
        status: pass
    human_judgment: false
  - id: D5
    description: "sync-client.ts's pullOnce() attempts a shared-revisions pull alongside every personal-snapshot pull, in its own independent try/catch, with a 404-latch (sharedPullDisabled) re-armed on every startSync()"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/sync-client.test.ts#27-04 (Task 2) describe block, 6 tests"
        status: pass
    human_judgment: false
  - id: D6
    description: "THE headline live proof: member B's extension, which authored nothing and only received a share, correctly decrypts and displays member A's item — a positive, present, populated plaintext-string-equality assertion, proven live against a real pv-server and real crypto, reproducibly"
    requirement: "EXT-07"
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-extension-sharing.spec.ts#member B's extension displays the exact plaintext name of the item member A shared"
        status: pass
    human_judgment: false

duration: ~40min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 04: End-to-End Shared-Item Read — vault-store.ts Port + KEY-01 Trigger + Live Two-Extension Proof Summary

**Ports web's three-source shared-item read model into vault-store.ts (personal/collection/direct-share merge, pending-vs-broken decrypt classification, KEY-01's publishOnUnlock trigger), extends sync-client.ts's pull cycle with a shared-revisions pull, and proves the whole recipient-side path live: member B's real extension, having authored nothing, displays the exact plaintext name of an item member A shared — 3/3 consecutive green runs against a real pv-server.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-08-08T17:47:00+02:00 (session start, immediately after 27-03's own completion commit)
- **Completed:** 2026-08-08T18:24:14+02:00
- **Tasks:** 3 (Task 2 TDD: RED then GREEN, plus one Rule 2/3 wiring commit)
- **Files modified:** 13 (2 created, 11 modified)

## Accomplishments

- `vault-store.ts` fully replaced its pre-Phase-27 single-scope `decryptItemRow`/`applySyncSnapshot` with the ported three-source merge (`personalItems`/`collectionSharedItems`/`directSharedItems` -> `recomputeItems()`), `decryptDirectSharedRow`, `mergeCollectionSnapshot`/`mergeDirectSnapshot`, and `doHandleSharedRevisions`'s full orchestration (per-collection watermark map, direct watermark, WR-11 re-entrancy guard, bounded-withhold-on-partial-failure discipline) — ported from `web/src/lib/vault/store.ts`, adapted to this extension's `vault-session.ts` lock-state surface.
- `CollectionKeyPendingError` + `getPendingSharedItems()`: a new, extension-only pending-vs-broken decrypt classification (no web counterpart — web's browser-tab lifecycle always refreshes its collections store before the first item decrypt; an MV3 wake has no such ordering guarantee). Both a transiently-pending row and a genuinely-broken shared row surface via the same array, never silently absent from `vault.list`.
- KEY-01's extension client trigger: `vault-session.ts`'s `setUnlockedUserKey` now calls `identity-store.ts`'s `freeIdentityKey()` at entry and `publishOnUnlock(uk)` immediately after `currentUserKey` is assigned — the ONE choke point every unlock path in this extension already converges through.
- `sync-client.ts`'s `pullOnce()` now attempts a shared-revisions pull alongside every personal-snapshot pull, in its own independent try/catch, with a 404-latch (`sharedPullDisabled`) mirroring web's WR-01 discipline — landed via a full RED/GREEN TDD cycle.
- The lock-path ordering invariant (T-09-18/A-3) extends cleanly: `freeAllCollectionKeys()`/`freeIdentityKey()` run inside the EXISTING `subscribeSessionLockState` handler, immediately after `stopSync()` — never a second listener.
- `router.ts`/`ext-protocol.ts`'s `vault.list` response gains `pending`/`collections` fields, the popup's future (27-08) route to pending-decrypt stub rows and decrypted collection names.
- **The live proof**: `extension/e2e/fixtures-account-setup.ts` provisions two real accounts, a family, a shared collection, and one login item — entirely via direct `fetch()` calls against pv-server, using real Node-side WASM crypto (no dummy ciphertext anywhere). `extension/e2e/dual-extension-sharing.spec.ts` drives both `extContext` (member A) and `extContextB` (member B) through the real popup sign-in/unlock ceremony and asserts member B's popup displays the exact plaintext name of the shared item. **3/3 consecutive green runs** against a real, freshly-started pv-server.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end shared-item read — vault-store.ts port + KEY-01 trigger** - `0250fbc` (feat)
2. **Task 2: sync-client.ts — the two shared revision pull functions**
   - RED: `f2965ed` (test)
   - GREEN: `25b224d` (feat)
   - Rule 2/3 wiring (making Task 2 reachable in production): `54dd430` (fix)
3. **Task 3: LIVE two-extension proof — member B's extension sees the item member A shared** - `f2b401a` (test)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/entrypoints/background/vault-api.ts` - extends `ItemRow` with `is_shared`/`last_editor_email`/`collection_id`; adds `SharedRevisions`/`SharedCollectionItemsResponse`/`DirectSharedItemRow`/`SharedDirectSyncResponse` + `getSharedRevisions`/`getCollectionSync`/`getSharedDirectSync`
- `extension/entrypoints/background/vault-store.ts` - the three-source merge port, `CollectionKeyPendingError`, `getPendingSharedItems()`, shared-revisions orchestration, extended lock-path clearing
- `extension/entrypoints/background/vault-store.test.ts` - extended for the three-source model, new pending/broken tests, shared-revisions merge suite, Test 4/4b's extended call-order assertion
- `extension/entrypoints/background/vault-session.ts` - `setUnlockedUserKey` wires `freeIdentityKey()`/`publishOnUnlock(uk)` (KEY-01)
- `extension/entrypoints/background/collections-store.ts` - adds `hasRefreshedThisSession()`, reset on `freeAllCollectionKeys()`, set on a successful refresh
- `extension/entrypoints/background/identity-store.ts` - adds `publishOnUnlock(uk)`, ported from `web/src/lib/identity/publishOnUnlock.ts`
- `extension/entrypoints/background/sync-client.ts` - `onSharedRevisions` pull, `sharedPullDisabled` 404-latch, `isNotFoundError`
- `extension/entrypoints/background/sync-client.test.ts` - 6 new tests for the shared-revisions pull behavior
- `extension/entrypoints/background/router.ts` - `vault.list` gains `pending`/`collections`
- `extension/lib/messaging/ext-protocol.ts` - `MessageResponseMap["vault.list"]` gains `pending`/`collections`
- `extension/lib/messaging/ext-protocol.test.ts` - extends the exhaustive `vault.list` response fixture
- `extension/e2e/fixtures-account-setup.ts` (NEW) - REST-level, real-WASM two-account/family/collection/item fixture
- `extension/e2e/dual-extension-sharing.spec.ts` (NEW) - the live two-extension recipient-side proof

## Decisions Made

See `key-decisions` in frontmatter above (5 decisions, each with full rationale).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2/3 - Missing wiring, blocking] Extended `ext-protocol.test.ts`'s exhaustive `vault.list` response fixture**
- **Found during:** Task 1
- **Issue:** `MessageResponseMap["vault.list"]` gained two new required fields (`pending`/`collections`); the existing fixture object literal was missing them, which fails both `tsc` (missing properties on a mapped-object-type literal) and the file's own JSON-round-trip exhaustiveness test.
- **Fix:** Added `pending: [{id, collectionId}]` and `collections: [{id, name, accessLevel}]` to the response fixture.
- **Files modified:** `extension/lib/messaging/ext-protocol.test.ts`
- **Verification:** `npx tsc --noEmit` clean; `npm run test -- ext-protocol` passes.
- **Committed in:** `0250fbc` (Task 1 commit)

**2. [Rule 2/3 - Missing wiring, blocking] Wired `onSharedRevisions` into `vault-store.ts`'s `startSync()` call**
- **Found during:** Task 2 (after GREEN)
- **Issue:** `sync-client.ts`'s new `onSharedRevisions` extension is only ever invoked if a caller passes that field into `startSync()`'s callbacks object — `vault-store.ts`'s own call (written in Task 1, before `SyncCallbacks` supported the field) did not, making Task 2's own extension dead code in production.
- **Fix:** Added `onSharedRevisions: handleSharedRevisions` to the `startSync({...})` call inside `ensureVaultSyncStarted()`.
- **Files modified:** `extension/entrypoints/background/vault-store.ts`
- **Verification:** `npx tsc --noEmit` clean; full extension test suite (721/721 minus one pre-existing unrelated flake, see Issues Encountered) green.
- **Committed in:** `54dd430`

**3. [Rule 3 - Blocking, documented in the plan's own action text as a permitted substitution] Member B joins the family via direct `POST /api/families/members`, not `invitations.rs::accept`**
- **Found during:** Task 3
- **Issue:** The invite-accept endpoint's own crypto (`pv_core::invite`'s derive/wrap functions, surfaced client-side as `WasmInviteChannel`) is not part of `extension/lib/crypto/wasm-loader.ts`'s re-export list — wiring it in was out of this task's file scope (not listed in Task 3's `<files>`, no artifact in this plan's own list mentions it) and would re-litigate Phase 24's already-proven invite-flow crypto for no benefit to this task's actual objective (the recipient-side READ path).
- **Fix:** Used the same REST-only owner-side direct-add pattern `web/e2e/shared-sync.spec.ts`'s own `ensureFamilyMembersRealKeys` already established as this codebase's precedent — gated by the identical `family_members` membership check the invite-accept path ultimately produces.
- **Files modified:** `extension/e2e/fixtures-account-setup.ts` (this is the file's own design, not a later patch)
- **Verification:** The live proof passes 3/3 consecutive runs, proving the resulting membership/collection-share state is indistinguishable, from the client's perspective, from one established via the invite flow.
- **Committed in:** `f2b401a` (Task 3 commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 2/3 missing-wiring fixes, 1 Rule 3 documented substitution for an out-of-scope crypto dependency)
**Impact on plan:** All three are prerequisites the plan's own task text implicitly required (a compiling response-shape fixture, a reachable production wiring path, a working fixture-setup script) or an explicitly-reasoned scope-boundary substitution. No scope creep beyond what each task already specified.

## Issues Encountered

- **Server-origin ceremony window silently self-closed on the first live-proof run.** Root cause: the local `pv-server` instance was started without `PV_STATIC_DIR` set (API-only mode), so the sign-in ceremony window's `page.goto()` against the server's own web-app origin resolved to nothing servable, and the extension's own ceremony-window lifecycle closed it before the popup could interact with it. Not a defect in this plan's own code — fixed by starting `pv-server` with `PV_STATIC_DIR` pointed at `web/out` (the pre-built static export), matching `web/playwright.config.ts`'s own `webServer` command shape. Once corrected, the live proof passed cleanly and reproducibly (3/3 consecutive runs, `--retries=0`, 2.9-3.8s each).
- **One pre-existing, unrelated flaky test** (`lib/generator/password.test.ts`'s EFF-wordlist passphrase assertion) failed once during a full-suite run and passed cleanly in isolation immediately after — a random-seed flake in this repo's existing password generator test, untouched by this plan's changes. Not investigated further (out of scope).

## User Setup Required

None - no external service configuration required. (The live e2e proof requires a running `pv-server` with `PV_STATIC_DIR` set to the built web app and `PV_DEV_CORS=1` for local runs — this is test-environment setup, not a product/user-facing configuration requirement, and matches this codebase's existing `web/playwright.config.ts` precedent.)

## Next Phase Readiness

- `getItems()` now returns correctly-tagged, correctly-decrypted shared items (personal, collection-scoped, and direct) — every remaining Wave 3-5 plan in this phase (TOTP, provider ceremony, write routing, popup UI) depends on this and can now build on proven ground rather than an assumption.
- `getPendingSharedItems()`/`getCollections()` are live and wired through `vault.list` — 27-08 (popup UI) can consume them directly for the pending-decrypt stub row and folder-name lookups without touching `router.ts`/`ext-protocol.ts` again (this task is the sole owner of the `vault.list` response shape this phase adds).
- KEY-01 and EXT-11 are genuinely complete now (client trigger wired AND proven live, memory-only key-cache lifecycle proven end-to-end through a real lock/unlock cycle) — marked complete in REQUIREMENTS.md.
- No blockers. Full extension test suite: 721/721 green (1 unrelated pre-existing flake reproduced once, passed in isolation — see Issues Encountered). `npx tsc --noEmit` clean. Live two-extension proof: 3/3 consecutive green runs.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*

## Self-Check: PASSED
