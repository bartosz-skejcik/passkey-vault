---
phase: 27-extension-integration-shared-items
plan: 03
subsystem: extension-crypto
tags: [wasm, wasm-bindgen, x25519, chacha20poly1305, wxt, vitest, collection-keys, identity-keypair]

requires:
  - phase: 21-crypto-foundation
    provides: X25519 identity keypair + sealed Collection Key primitives in pv-core, compiled through pv-wasm as opaque handles
  - phase: 22-family-collection-data-model
    provides: "/api/vault/collections and /api/identity/keypair server routes (KEY-01 server half, KEY-02 fan-out)"
  - phase: 26-web-app-sharing-ui
    provides: web/src/lib/vault/collections.ts and web/src/lib/identity/ensure.ts as the proven, shipped porting source
provides:
  - "wasm-loader.ts re-exports the 12 collection/identity WASM bindings (WasmIdentityKey, WasmIdentityPublicKey, WasmCollectionKey, wrapIdentitySecretKey, unwrapIdentitySecretKey, sealCollectionKey, unsealCollectionKey, encryptItemForCollection, decryptItemForCollection, rewrapItemKeyForCollection, sealItemKeyForRecipient, decryptItemWithSharedKey) as the sole choke point"
  - "collections-store.ts: Collection Key cache (getCollections/getCollectionKey/getCollectionAccessLevel/refreshCollectionsNow/freeAllCollectionKeys), no lock listener of its own"
  - "identity-store.ts: idempotent identity-keypair primitive (ensureOwnIdentityKeypair/ensureIdentityKeypairHydrated/freeIdentityKey/StaleUserKeyError), no lock listener of its own"
  - "vault-api.ts gains listCollections()/CollectionRow and getIdentityKeypair()/putIdentityKeypair()/KeypairRow clients"
  - "This repo's first extension-side *.real-wasm.test.ts precedent, proving the node-environment (no jsdom) real-WASM loading pattern under vitest's background project"
affects: [27-04-vault-store-decrypt-dispatch, 27-05, 27-06, 27-07, 27-08, 27-09, 27-10, 27-11]

tech-stack:
  added: []
  patterns:
    - "Real-WASM extension test pattern: vi.mock('wxt/browser') for browser.runtime.getURL only, stub global.fetch to serve the real compiled .wasm bytes off disk, call the genuine initCrypto() -- no jsdom/setupFiles needed under the background project's node environment"
    - "Caller-must-invoke-on-lock/unlock contract: a new key cache module exports plain free/refresh functions but registers NO subscribeSessionLockState listener of its own -- the owning composed-sequence module (vault-store.ts, wired in 27-04) calls them from its single existing handler"

key-files:
  created:
    - extension/lib/crypto/wasm-loader.real-wasm.test.ts
    - extension/entrypoints/background/collections-store.ts
    - extension/entrypoints/background/collections-store.real-wasm.test.ts
    - extension/entrypoints/background/identity-store.ts
    - extension/entrypoints/background/identity-store.real-wasm.test.ts
  modified:
    - extension/lib/crypto/wasm-loader.ts
    - extension/entrypoints/background/vault-api.ts

key-decisions:
  - "Re-exported all 12 collection/identity WASM names (crates/pv-wasm/src/lib.rs's actual list, cross-checked against 27-PATTERNS.md's 'Pattern 1' excerpt), not 11 as the plan's own prose count states -- the plan text and PATTERNS.md excerpt both enumerate 12 names; implemented the correct full set rather than truncating to match an apparent off-by-one in the plan's own count."
  - "collections-store.ts and identity-store.ts register NO module-level subscribeSessionLockState listener of their own, even though web's collections.ts does (a second listener) -- per 27-PATTERNS.md's Pitfall 4 and 27-CONTEXT.md's hard constraint, both modules export plain free/refresh functions with a documented caller-must-invoke contract; 27-04 wires them into vault-store.ts's EXISTING single lock-state handler."
  - "Added vault-api.ts's listCollections()/CollectionRow client (not in the plan's frontmatter files_modified list, but explicitly required by Task 2's own action text and Task 3's identity endpoints) -- Rule 2/3 fix, the module cannot function without it."
  - "requirements-completed left empty for EXT-11/KEY-01 despite being listed in this plan's frontmatter -- matches this project's own precedent (e.g. Phase 9's EXT-04/EXT-05, Phase 24's collection-scope-invite override): both requirements' own ROADMAP.md traceability rows describe the 'client trigger on first unlock' / full wake-lifecycle proof as spanning into 27-04, which owns the actual lock/unlock wiring this plan deliberately does not add. Marking them complete here would overstate what 27-03 alone delivers."

patterns-established:
  - "Real-WASM extension regression: mock only wxt/browser's runtime.getURL (or the module under test's own network-boundary client), stub global.fetch for the .wasm binary, call the genuine initCrypto() -- reused identically across wasm-loader.real-wasm.test.ts, collections-store.real-wasm.test.ts, and identity-store.real-wasm.test.ts."

requirements-completed: []

coverage:
  - id: D1
    description: "wasm-loader.ts re-exports all 12 collection/identity WASM bindings as the sole choke point"
    verification:
      - kind: unit
        ref: "extension/lib/crypto/wasm-loader.real-wasm.test.ts#every new collection/identity name is a defined export"
        status: pass
      - kind: unit
        ref: "extension/lib/crypto/wasm-loader.real-wasm.test.ts#WasmIdentityKey.generate().publicKeyBytes() round-trips through this module's own re-export as a 32-byte array"
        status: pass
    human_judgment: false
  - id: D2
    description: "collections-store.ts: Collection Key cache with EXT-11 no-op, real seal/encrypt/decrypt round trip, lock-triggered free, and WR-02 stale-key eviction"
    requirement: "EXT-11"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/collections-store.real-wasm.test.ts#EXT-11 no-op: a fresh state refreshed against zero collections completes with no thrown error and getCollections() returns []"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/collections-store.real-wasm.test.ts#a real sealed Collection Key + real encryptItemForCollection ciphertext round-trips through getCollectionKey()'s cached handle"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/collections-store.real-wasm.test.ts#freeAllCollectionKeys frees every cached handle and getCollectionKey returns undefined for a previously-cached id (simulated lock transition)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/collections-store.real-wasm.test.ts#a collection the server no longer returns has its cached key freed and evicted, not merely hidden"
        status: pass
    human_judgment: false
  - id: D3
    description: "identity-store.ts: idempotent identity-keypair primitive with generate-and-publish, unwrap-existing, memory-cache fast path, and lock-triggered free"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/identity-store.real-wasm.test.ts#generates, wraps, publishes and returns a usable identity key on an account with no published keypair"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/identity-store.real-wasm.test.ts#unwraps and returns the ALREADY-published keypair without generating a second one"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/identity-store.real-wasm.test.ts#caches the resolved identity key for the session -- a second call returns the SAME handle with no second network round trip"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/identity-store.real-wasm.test.ts#freeIdentityKey frees the cached handle and clears it -- a subsequent call re-derives rather than returning a stale reference"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 03: WASM Choke Point + Collection/Identity Key Stores Summary

**Ports web's Collection Key cache and identity-keypair primitive into two new framework-free extension background modules, proven against genuine WASM crypto in this repo's first extension-side real-WASM test suite.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-08T17:2x (session start, no precise epoch captured)
- **Completed:** 2026-08-08T17:44:16+02:00
- **Tasks:** 3
- **Files modified:** 7 (5 created, 2 modified)

## Accomplishments

- `wasm-loader.ts` now re-exports all 12 collection/identity WASM bindings the extension already links against (was previously wired into the binary but never surfaced) -- unblocks every downstream Phase 27 plan.
- `collections-store.ts` (NEW): a framework-free port of web's Collection Key cache -- synchronous `getCollectionKey`/`getCollectionAccessLevel` lookups, the WR-02 stale-key eviction loop, `refreshCollectionsNow()`/`freeAllCollectionKeys()` exported with a documented caller-must-invoke contract (no self-registered lock listener).
- `identity-store.ts` (NEW): a near-verbatim port of web's idempotent `ensureOwnIdentityKeypair` (WR-15 stale-handle guard, WR-07 free-on-error, `adopted_existing` race resolution) plus the MV3-wake composition wrapper `ensureIdentityKeypairHydrated()`/`freeIdentityKey()`.
- `vault-api.ts` gains `listCollections()`/`CollectionRow` and `getIdentityKeypair()`/`putIdentityKeypair()`/`KeypairRow` clients -- no client for either endpoint existed anywhere in the extension before this plan.
- Three real-WASM test files (`wasm-loader.real-wasm.test.ts`, `collections-store.real-wasm.test.ts`, `identity-store.real-wasm.test.ts`) prove every crypto claim against the genuine compiled WASM binary, establishing this repo's first extension-side real-WASM loading pattern (no jsdom needed -- the `background` vitest project is plain `node`).

## Task Commits

Each task was committed atomically:

1. **Task 1: wasm-loader.ts — re-export the 11 (actually 12) collection/identity bindings** - `43228ad` (feat)
2. **Task 2: collections-store.ts — port the Collection Key cache** - `1551f43` (feat)
3. **Task 3: identity-store.ts — port the idempotent identity-keypair primitive** - `b03f580` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified

- `extension/lib/crypto/wasm-loader.ts` - extends the import/export choke point with the 12 collection/identity WASM names
- `extension/lib/crypto/wasm-loader.real-wasm.test.ts` - proves the 12 new re-exports resolve as defined values against real WASM
- `extension/entrypoints/background/collections-store.ts` - Collection Key cache, ported from web/src/lib/vault/collections.ts
- `extension/entrypoints/background/collections-store.real-wasm.test.ts` - proves empty-refresh no-op, real seal/decrypt round trip, lock-triggered free, WR-02 stale eviction
- `extension/entrypoints/background/identity-store.ts` - idempotent identity-keypair primitive, ported from web/src/lib/identity/ensure.ts
- `extension/entrypoints/background/identity-store.real-wasm.test.ts` - proves generate-and-publish, unwrap-existing, memory-cache fast path, lock-triggered free
- `extension/entrypoints/background/vault-api.ts` - gains listCollections/CollectionRow and getIdentityKeypair/putIdentityKeypair/KeypairRow

## Decisions Made

- Implemented all 12 collection/identity WASM re-exports (the actual, correct set per `crates/pv-wasm/src/lib.rs` and 27-PATTERNS.md's own excerpt) rather than truncating to the plan prose's "11" count, which appears to be an off-by-one in the plan's own narrative text, not in its technical excerpt.
- Neither `collections-store.ts` nor `identity-store.ts` registers a `subscribeSessionLockState` listener of its own, per 27-PATTERNS.md's Pitfall 4 and 27-CONTEXT.md's explicit constraint -- both modules export plain, directly-testable free/refresh functions; 27-04 owns wiring them into `vault-store.ts`'s single existing handler.
- Added `vault-api.ts`'s `listCollections()` client even though `vault-api.ts` is not in this plan's frontmatter `files_modified` list -- Task 2's own action text requires it and the module cannot compile/function without it (Rule 2/3).
- Left `requirements-completed` empty despite `EXT-11`/`KEY-01` being listed in this plan's frontmatter `requirements` field -- both requirements' own ROADMAP.md traceability rows describe work spanning into 27-04 (the actual wake/unlock/lock wiring that makes these primitives observably correct in the live system). Matches this project's established precedent of not marking a requirement complete until its user-facing/system-level behavior actually lands.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2/3 - Missing client + blocking] Added `listCollections()`/`CollectionRow` to `vault-api.ts`**
- **Found during:** Task 2 (collections-store.ts)
- **Issue:** No client for `GET /api/vault/collections` existed anywhere in the extension; `collections-store.ts` cannot function without it, and `vault-api.ts` is not in this plan's frontmatter `files_modified` list even though Task 2's own action text and artifact list require the addition.
- **Fix:** Added `CollectionRow`/`listCollections()`, ported verbatim from `web/src/lib/vault/api.ts`.
- **Files modified:** `extension/entrypoints/background/vault-api.ts`
- **Verification:** `collections-store.real-wasm.test.ts` exercises it via the mocked wire boundary; `npx tsc --noEmit` passes.
- **Committed in:** `1551f43` (Task 2 commit)

**2. [Rule 2/3 - Missing client + blocking] Added `getIdentityKeypair()`/`putIdentityKeypair()`/`KeypairRow` to `vault-api.ts`**
- **Found during:** Task 3 (identity-store.ts)
- **Issue:** Same gap as above, for `/api/identity/keypair` -- explicitly required by Task 3's own action text.
- **Fix:** Added both endpoints, ported verbatim from `web/src/lib/identity/api.ts`.
- **Files modified:** `extension/entrypoints/background/vault-api.ts`
- **Verification:** `identity-store.real-wasm.test.ts` exercises both via the mocked wire boundary; `npx tsc --noEmit` passes.
- **Committed in:** `b03f580` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (both Rule 2/3, missing-client additions the plan's own task text required but its frontmatter file list omitted)
**Impact on plan:** Both additions are prerequisites the plan's own action text explicitly called for; no scope creep beyond what Task 2/Task 3 already specified.

## Issues Encountered

- The `background` vitest project has no `WxtVitest` plugin wired in and no `setupFiles`, so `browser` from `wxt/browser` resolves to `undefined` under plain node/vitest. Every real-WASM test file mocks `wxt/browser`'s `runtime.getURL` (and, for `collections-store.real-wasm.test.ts`, `runtime.sendMessage`) rather than relying on any ambient polyfill -- consistent with this repo's existing `vault-session.test.ts`/`session-storage.test.ts` precedent for mocking that module.
- `refreshCollections()` resolves ONE identity key per refresh unconditionally (even for a zero-collection response) -- the first collections-store real-WASM test initially failed with "Cannot read properties of undefined (reading 'free')" because `ensureOwnIdentityKeypair` was left unmocked for that case; fixed by mocking it to return a real generated `WasmIdentityKey` there too.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `27-04` can now import `collections-store.ts`'s `getCollectionKey`/`getCollectionAccessLevel`/`refreshCollectionsNow`/`freeAllCollectionKeys` and `identity-store.ts`'s `ensureIdentityKeypairHydrated`/`freeIdentityKey` directly -- all four seams this plan's `<success_criteria>` promised are in place and individually real-WASM-proven.
- `27-04` owns: wiring `freeAllCollectionKeys()`/`freeIdentityKey()` into `vault-store.ts`'s EXISTING `subscribeSessionLockState` handler (after `stopSync()`, per T-09-18/Pitfall 4 ordering), wiring `refreshCollectionsNow()` into the unlock path AND the periodic `onSharedRevisions` tick (closing T-27-06's post-revocation-staleness threat), and the actual `decryptItemRow` scope dispatch (`decryptItem` vs `decryptItemForCollection` by `row.collection_id`) that consumes `getCollectionKey()` synchronously.
- No blockers. The full extension test suite (704 tests, 56 files) and `tsc --noEmit` are green after this plan.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*

## Self-Check: PASSED

All 7 created/modified source files and the SUMMARY.md itself were verified present on disk; all 3 task commit hashes (`43228ad`, `1551f43`, `b03f580`) were verified present in `git log --oneline --all`.
