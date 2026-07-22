---
phase: 08-extension-bootstrap-wasm-in-background-spike
plan: 02
subsystem: infra
tags: [wasm, mv3, service-worker, wxt, vitest, chrome.storage.session, wasm-bindgen]

# Dependency graph
requires:
  - phase: 08-01
    provides: WXT vanilla extension project scaffold, extended build-wasm.sh emitting extension/lib/crypto/wasm/pv_wasm.js + extension/public/wasm/pv_wasm_bg.wasm, background.ts stub with type:'module' pre-set, dual Chrome MV3/Firefox MV2 manifest generation
provides:
  - "wasm-loader.ts: memoized fetch()+ArrayBuffer+WebAssembly.instantiate() loader, sole choke-point importer of pv_wasm.js inside extension/"
  - "vault-session.ts: roundTripSpike(storage) — derive/wrap/unwrap round-trip proof with injectable chrome.storage.session-shaped persistence, tested independent of any real browser"
  - "background.ts onMessage listener wiring {kind:'spike.roundtrip'} to roundTripSpike(browser.storage.session)"
  - "extension/vitest.config.ts + vitest devDependency — first automated test infra in extension/"
affects: [09-session-unlock-core-popup-sync-client, 08-03]

# Tech tracking
tech-stack:
  added: ["vitest@^3.2.7 (extension/ devDependency)"]
  patterns:
    - "Memoized-singleton initCrypto() Promise, mirrored from web/src/lib/crypto/index.ts, with fetch()+ArrayBuffer+WebAssembly.instantiate() swapped in for the inner call instead of passing a URL string to the wasm-bindgen glue's init()"
    - "Storage dependency injection (SessionStorage type) as the mechanism that makes D-05 (session-only key persistence) enforceable by construction — vault-session.ts has zero code paths that can name a persistent storage area"
    - "vi.hoisted() + vi.mock('./wasm-loader', ...) unit-test pattern, same shape as web/src/lib/crypto/index.test.ts's vi.mock('./wasm/pv_wasm.js', ...)"

key-files:
  created:
    - extension/lib/crypto/wasm-loader.ts
    - extension/lib/crypto/vault-session.ts
    - extension/lib/crypto/vault-session.test.ts
    - extension/vitest.config.ts
  modified:
    - extension/package.json
    - extension/package-lock.json
    - extension/entrypoints/background.ts

key-decisions:
  - "wasm-loader.ts re-exports WasmUserKey as a VALUE, not type-only — deviation from the plan's literal Task 1 wording (which said 'WasmUserKey as a type', mirroring web/'s pattern), because vault-session.ts (Task 2) explicitly calls WasmUserKey.generate() directly with no generateUserKey() wrapper in this extension yet"
  - "initCrypto() imports browser from 'wxt/browser' (not '@wxt-dev/browser' directly) and calls browser.runtime.getURL('/wasm/pv_wasm_bg.wasm') — required running `wxt prepare` after build-wasm.sh populated extension/public/wasm/ so WXT's generated PublicPath literal-union type includes the wasm asset path (an ordering dependency worth remembering: `wxt prepare`'s type generation reads the current public/ directory contents at the time it runs)"
  - "Fixed spike password (SPIKE_PASSWORD constant) is used for both round-trip paths — this file proves the round-trip/storage-survival mechanics only, not a real unlock flow; no user-facing password crosses this code"

requirements-completed: [EXT-01]

coverage:
  - id: D1
    description: "Round-trip crypto call (derive wrapping key -> generate User Key -> wrap -> unwrap) executes successfully in an automated, browser-independent unit test, exercising the reused pv-wasm artifact via a mocked wasm-loader"
    requirement: EXT-01
    verification:
      - kind: unit
        ref: "extension/lib/crypto/vault-session.test.ts#roundTripSpike > fresh init (empty session store): derives, generates, wraps, persists, and self-verifies via unwrap"
        status: pass
    human_judgment: false
  - id: D2
    description: "Storage-rehydration path: a fresh module instance re-derives the wrapping key from a persisted salt and unwraps a persisted envelope without generating a new UserKey or writing a new envelope — the logic-level proxy for MV3 idle-kill/wake survival"
    requirement: EXT-01
    verification:
      - kind: unit
        ref: "extension/lib/crypto/vault-session.test.ts#roundTripSpike > survived-a-wake (pre-existing spikeEnvelope): re-derives from the persisted salt, unwraps, and never writes a new envelope"
        status: pass
    human_judgment: false
  - id: D3
    description: "WASM is loaded via fetch()+ArrayBuffer+WebAssembly.instantiate(), never instantiateStreaming() — verified by source inspection of wasm-loader.ts (the generated glue's __wbg_load only takes the streaming-compile branch when passed a Response instance; an ArrayBuffer routes to the plain instantiate() branch)"
    requirement: EXT-01
    verification:
      - kind: other
        ref: "grep -c 'WebAssembly.instantiate' extension/lib/crypto/wasm-loader.ts (=1); grep -c 'instantiateStreaming' extension/lib/crypto/wasm-loader.ts (=0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A real MV3 service-worker idle-kill followed by a real browser.storage.session read-back after wake, exercised against the built extension/.output/chrome-mv3 bundle in an actual Chrome browser"
    verification: []
    human_judgment: true
    rationale: "vitest cannot host a real MV3 service-worker process or force a genuine idle-kill — this requires loading the unpacked extension in Chrome, using chrome://serviceworker-internals (or DevTools Application > Service Workers > 'Stop') to force-terminate the worker, then sending a second {kind:'spike.roundtrip'} message and confirming {survived:true, ok:true} in the response. Deferred to plan 08-03's real-browser verification harness — see Verification Honesty section below for exact repro steps."

# Metrics
duration: 7min
completed: 2026-07-15
status: complete
---

# Phase 8 Plan 02: WASM Round-Trip + Storage-Rehydration Proof Summary

**Round-trip crypto proof (derive→wrap→unwrap) running inside the MV3 background service worker via fetch()+ArrayBuffer+WebAssembly.instantiate(), with the wrapped-key envelope persisted through an injected chrome.storage.session dependency and unit-tested independent of any real browser.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-07-15T06:55:52Z
- **Completed:** 2026-07-15T09:03:10Z (wall-clock exceeds compute duration due to session gaps; compute time ~7 min)
- **Tasks:** 3/3 completed
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments
- `wasm-loader.ts` — memoized-singleton `initCrypto()` loading the WASM binary via `fetch(browser.runtime.getURL(...))` → `.arrayBuffer()` → `init(bytes)`, so the generated glue's `__wbg_load` always takes the plain `WebAssembly.instantiate()` branch, never `instantiateStreaming` (D-03)
- `vault-session.ts` — `roundTripSpike(storage: SessionStorage)` proving the fresh-init (generate → wrap → persist → self-verify) and survived-a-wake (re-derive from persisted salt → unwrap, no new writes) code paths, with the storage dependency injected rather than referencing any global `chrome`/`browser` (D-05)
- `vault-session.test.ts` — 3 passing automated tests covering both round-trip paths plus the no-global-storage-reference invariant, using a Map-backed `SessionStorage` fake and mocked `./wasm-loader` (zero browser API mocking required)
- `background.ts` — `onMessage` listener wiring `{kind: 'spike.roundtrip'}` to `roundTripSpike(browser.storage.session)`, the only crypto-adjacent line in the entrypoint itself
- Full `extension/` build (`npx wxt build`) verified green post-wiring, with the spike logic confirmed present in the bundled `chrome-mv3/background.js` output

## Task Commits

Each task was committed atomically:

1. **Task 1: wasm-loader.ts — memoized fetch()+instantiate() loader, plus test infra** - `15b1654` (feat)
2. **Task 2: vault-session.ts — round-trip proof + injectable storage.session persistence (TDD)**
   - RED: `a0423d5` (test) — confirmed failing with "Cannot find module './vault-session'"
   - GREEN: `f13215c` (feat) — 3/3 tests passing (includes the WasmUserKey-as-value deviation to wasm-loader.ts)
3. **Task 3: Wire background.ts to the real browser.storage.session** - `31d2068` (feat)

**Plan metadata:** (this commit, docs: complete plan)

## Files Created/Modified
- `extension/lib/crypto/wasm-loader.ts` - Sole choke-point importer of `./wasm/pv_wasm.js`; memoized `initCrypto()` singleton using fetch+ArrayBuffer+instantiate
- `extension/lib/crypto/vault-session.ts` - `roundTripSpike(storage)` — derive/wrap/unwrap proof with injected `SessionStorage`
- `extension/lib/crypto/vault-session.test.ts` - 3 automated tests: fresh-init, survived-a-wake, no-global-storage-reference
- `extension/vitest.config.ts` - `environment: "node"` vitest config (no DOM/browser mocking needed — all dependencies injected)
- `extension/package.json` - added `vitest` devDependency, `"test": "vitest run"` script
- `extension/entrypoints/background.ts` - `onMessage` listener wiring `spike.roundtrip` messages to `roundTripSpike(browser.storage.session)`

## Decisions Made
- **wasm-loader.ts exports `WasmUserKey` as a value, not type-only.** The plan's Task 1 wording said "WasmUserKey as a type" (mirroring `web/src/lib/crypto/index.ts`), but Task 2's own action text requires calling `WasmUserKey.generate()` directly from `vault-session.ts` — there's no `generateUserKey()` wrapper in this extension the way there is in `web/`. Exporting the class as a value (alongside `WasmWrappingKey`, already a value) resolves this without weakening the choke-point invariant: `wasm-loader.ts` remains the only file that imports `./wasm/pv_wasm.js` directly.
- **Fixed spike password.** `SPIKE_PASSWORD` is a hardcoded constant used by both round-trip paths. This file's whole purpose is proving the storage-survival mechanics, not implementing a real unlock flow (that's Phase 9's AUTH scope) — no user-facing password ever touches this code.
- **`wxt prepare` had to be re-run after `build-wasm.sh` populated `extension/public/wasm/`.** WXT generates a `PublicPath` literal-union TypeScript type from a scan of the current `public/` directory contents at the moment `wxt prepare` runs (during `postinstall`, before the wasm asset existed). `browser.runtime.getURL('/wasm/pv_wasm_bg.wasm')` only type-checked after re-running `wxt prepare` post-build. This is an inherent ordering dependency in the existing `predev`/`prebuild` hook chain (`build-wasm.sh` runs before `wxt dev`/`wxt build`, and both of those internally re-run WXT's prepare step) — no script change was needed, just a one-time local `wxt prepare` to unblock this session's `tsc --noEmit`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] wasm-loader.ts re-exports WasmUserKey as a value, not type-only**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** Task 1's action text said to re-export `WasmUserKey` as a type only (mirroring `web/`'s pattern), but Task 2's action text requires `vault-session.ts` to call `WasmUserKey.generate()` as a value — `tsc --noEmit` failed with `TS1362: 'WasmUserKey' cannot be used as a value because it was exported using 'export type'`.
- **Fix:** Changed `wasm-loader.ts`'s re-export from `export type { WasmUserKey }` to `export { WasmWrappingKey, WasmUserKey }` (both as values).
- **Files modified:** `extension/lib/crypto/wasm-loader.ts`
- **Verification:** `npx tsc --noEmit` passes; `npx vitest run` 3/3 passing.
- **Committed in:** `f13215c` (part of Task 2's GREEN commit)

**2. [Rule 3 - Blocking] Comment in wasm-loader.ts accidentally contained the literal string "instantiateStreaming"**
- **Found during:** Task 1 (self-check against acceptance criteria)
- **Issue:** An explanatory comment used the phrase "`WebAssembly.instantiateStreaming` branch", which satisfied the file's functional correctness but violated the acceptance criterion "does NOT contain 'instantiateStreaming'" (a grep-based check meant to catch actual streaming-compile usage, not prose mentioning it).
- **Fix:** Reworded the comment to describe the same fact ("the browser's native streaming-compile WebAssembly API") without using the literal substring.
- **Files modified:** `extension/lib/crypto/wasm-loader.ts`
- **Verification:** `grep -c "instantiateStreaming" extension/lib/crypto/wasm-loader.ts` returns 0; `grep -c "WebAssembly.instantiate" extension/lib/crypto/wasm-loader.ts` returns 1.
- **Committed in:** `15b1654` (part of Task 1's commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking issues in the plan's own literal wording vs. its functional requirements)
**Impact on plan:** Both fixes were necessary for the plan's own stated acceptance criteria and Task 2's explicit needs to be simultaneously satisfiable. No scope creep — no new files, no architectural changes.

## Issues Encountered
None beyond the two deviations documented above.

## Verification Honesty — Idle-Kill/Wake Round-Trip

**What was actually observed (ran, not inspected):**
- `npx vitest run lib/crypto/vault-session.test.ts` — **3 passed, 0 failed** (RED confirmed first: `Cannot find module './vault-session'` on all 3 cases before implementation existed; GREEN confirmed after: 3/3 passing).
- The "survived-a-wake" test genuinely simulates the kill-and-rehydrate cycle at the module/logic level: `vi.resetModules()` runs in `beforeEach`, a fresh `SessionStorage` fake is pre-seeded with a persisted `spikeEnvelope` (as if a fresh service-worker instance woke and read it), and a fresh dynamic `import("./vault-session")` exercises the re-derive-from-persisted-salt path. Assertions confirm `WasmUserKey.generate()` and `randomSalt()` are NOT called (no new key minted) and `storage.set` is NOT called (no new envelope written) — only `WasmWrappingKey.fromPassword` + `unwrapUserKey` run, against the persisted salt/wrappedJson.
- `npx tsc --noEmit` — clean, 0 errors.
- `npx wxt build` — succeeded; grepped the bundled `chrome-mv3/background.js` output and confirmed both `spike.roundtrip` and `roundTripSpike`/`spikeEnvelope` strings are present in the built artifact.

**What was NOT run (genuinely cannot run in this environment) and is deferred:**
- A **real** MV3 service-worker process kill (Chrome actually terminating the background service worker after its idle timeout, or a forced termination via DevTools) followed by a **real** `chrome.storage.session` read-back inside a genuinely fresh worker instance. vitest has no browser service-worker host to exercise this against — the test above proves the *logic* is correct given a rehydration input shaped like what a real wake would provide, but it does not prove Chrome's actual `storage.session` API round-trips that shape correctly across a real kill, nor that the WASM module actually re-instantiates cleanly in a freshly spawned worker.
- **Exact repro steps for plan 08-03 (or manual execution now) to close this gap:**
  1. `cd extension && npx wxt build` (already verified green this session)
  2. Load `extension/.output/chrome-mv3` as an unpacked extension in Chrome (`chrome://extensions` → Developer mode → Load unpacked)
  3. Open the extension's background service worker DevTools (`chrome://extensions` → "service worker" link under the loaded extension)
  4. In that DevTools console, run: `chrome.runtime.sendMessage({kind: 'spike.roundtrip'}, console.log)` — expect `{survived: false, ok: true}` on first call
  5. Force-terminate the service worker: `chrome://serviceworker-internals` → find the extension's worker → "Stop", OR simply wait out Chrome's ~30s idle timeout with the DevTools panel closed
  6. Re-open the background service worker DevTools (a fresh instance spawns on next event) and run the same `chrome.runtime.sendMessage({kind: 'spike.roundtrip'}, console.log)` call again
  7. Expect `{survived: true, ok: true}` — this is the actual, currently-unverified proof that `chrome.storage.session` truly survives an MV3 service-worker kill/wake cycle in a real browser, which is the entire point of this phase's spike

This checklist is written so it can be executed exactly as-is by a human or by plan 08-03's automated harness (which the plan's own scope note says is where real-browser verification belongs — this plan's job was the unit-testable logic, and that job is done).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `wasm-loader.ts` and `vault-session.ts` are ready to be imported by Phase 9's real popup/sync-client session logic — the storage-injection pattern established here (`SessionStorage` type, no global `chrome`/`browser` reference inside the crypto-adjacent module) is the pattern Phase 9 should keep using for its own real unlock/lock state.
- **Blocker/concern for 08-03:** the real-browser idle-kill/wake verification (D4 in coverage above) is still open. The repro steps above are exact and ready to execute — this is the single highest-priority verification item before Phase 8 can be considered fully proven, since it's the one thing this whole phase exists to de-risk.

---
*Phase: 08-extension-bootstrap-wasm-in-background-spike*
*Completed: 2026-07-15*

## Self-Check: PASSED

All created files verified present on disk; all 4 task commit hashes (`15b1654`, `a0423d5`, `f13215c`, `31d2068`) verified present in git log.
