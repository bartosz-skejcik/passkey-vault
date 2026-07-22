---
phase: 09-session-unlock-core-popup-sync-client
plan: 02
subsystem: extension
tags: [wxt, chrome.storage.session, chrome.alarms, vitest, wasm-bindgen, service-worker]

# Dependency graph
requires:
  - phase: 09-session-unlock-core-popup-sync-client (09-01)
    provides: pv-wasm exportUserKeyForSession/importUserKeyFromSession session-export pair
  - phase: 08-extension-bootstrap-wasm-in-background-spike
    provides: WXT extension scaffold (background.ts entrypoint, wasm-loader.ts choke-point, WR-01 sender-validation gate)
provides:
  - "extension/lib/messaging/ext-protocol.ts — typed popup<->background message contract (session.status, session.setAutoLockMinutes)"
  - "extension/entrypoints/background/session-storage.ts — async chrome.storage.session I/O for two independently-lifetimed records (session-meta vs. key envelope)"
  - "extension/entrypoints/background/vault-session.ts — session core surviving service-worker idle-kill (ensureHydrated/setUnlockedUserKey/lockVaultSession/subscribeSessionLockState/noteActivity)"
  - "extension/entrypoints/background/autolock.ts — chrome.alarms-driven auto-lock (armAutoLock/registerAutoLockAlarmListener)"
  - "extension/entrypoints/background/router.ts — typed browser.runtime.onMessage dispatch table for session.* kinds, ready for Waves 3-4 to extend"
affects: [09-03, 09-04, 09-05, 09-06, 09-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "wxt/browser is mocked directly via vi.mock('wxt/browser', ...) with a Map-backed fake for chrome.storage.session and a recorded-listener array for chrome.alarms — established by 09-01's server-config.test.ts, reused here rather than introducing fakeBrowser from wxt/testing as a second, competing test-double mechanism for the same target"
    - "vault-session.ts <-> autolock.ts have a deliberate circular import (vault-session's noteActivity() calls autolock's armAutoLock; autolock's onAlarm listener calls vault-session's lockVaultSession) — safe because neither call happens at module-evaluation time, only inside function bodies invoked later; confirmed via tsc and vitest with zero errors"

key-files:
  created:
    - extension/lib/messaging/ext-protocol.ts
    - extension/entrypoints/background/session-storage.ts
    - extension/entrypoints/background/vault-session.ts
    - extension/entrypoints/background/autolock.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/background/vault-session.test.ts
  modified:
    - extension/lib/crypto/wasm-loader.ts
    - extension/entrypoints/background.ts

key-decisions:
  - "Phase 8's actual background entrypoint is extension/entrypoints/background.ts (a file, not entrypoints/background/index.ts) — WXT's own convention treats a directory index.ts as an ALTERNATE way to define the same entrypoint, so creating both would risk a duplicate/conflicting background entrypoint at build time. Edited the real background.ts instead of creating background/index.ts as the plan's files_modified list assumed; confirmed with both wxt build -b chrome and -b firefox producing exactly one background.js each."
  - "Added a SECOND, independent browser.runtime.onMessage listener (registerMessageRouter) alongside background.ts's existing spike.roundtrip listener, rather than merging them into one — WebExtensions supports multiple listeners natively (each independently returns undefined to pass or true+async-response to handle), and this avoids touching/risking the still-functioning Phase 8 debug harness (popup/main.ts still calls sendMessage({kind:'spike.roundtrip'}) until Plan 09-05 replaces the popup). router.ts replicates its own copy of the WR-01 sender-validation gate so it is independently secure regardless of the other listener's presence."
  - "wasm-loader.ts (not in this plan's files_modified list) gained exportUserKeyForSession/importUserKeyFromSession re-exports — required because that file's own header comment documents it as the SOLE choke-point importer of ./wasm/pv_wasm.js; vault-session.ts cannot import pv-wasm exports directly without violating that standing invariant (Rule 3 auto-fix, see Deviations)."
  - "Test 5's plan-text example (armAutoLock(1)) doesn't fit AUTOLOCK_OPTIONS ([5, 15, 30, 60], also plan-specified in the same task) — TDD's RED run caught this immediately in GREEN (mockAlarmsCreate received delayInMinutes: 15, not 1) because armAutoLock validates its input against the whitelist at arm time (T-09-08). Adjusted the test to arm at 5 minutes (a real whitelist member) rather than weakening the validation to fit the plan's illustrative value."

patterns-established:
  - "session-storage.ts's two-record split (SessionMeta vs. KeyEnvelope under separate chrome.storage.session keys) is the durable pattern for any future lock-time-sensitive vs. lock-surviving data in the background context."

requirements-completed: [EXT-02, EXT-03]

coverage:
  - id: D1
    description: "Unlocked User Key envelope lives only in chrome.storage.session and survives a simulated service-worker idle-kill (fresh module instance) via ensureHydrated()"
    requirement: "EXT-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-session.test.ts#ensureHydrated > re-imports the persisted key envelope after a simulated idle-kill (fresh module load, in-memory cache reset)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/vault-session.test.ts#ensureHydrated > returns null on an empty chrome.storage.session (never unlocked) -- no false-positive hydration"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/vault-session.test.ts#setUnlockedUserKey / getUnlockedUserKey > persists a key envelope AND a session-meta record, and getUnlockedUserKey() immediately returns the same in-memory handle"
        status: pass
    human_judgment: true
    rationale: "The unit tests prove the logic against a fake chrome.storage.session and a mocked WASM boundary. A genuine MV3 service-worker idle-kill/wake (real browser, real chrome.storage.session, real WASM re-instantiation) has no CLI/headless equivalent in this environment and is explicitly the orchestrator's post-plan Playwright kill/wake UAT harness per this plan's own execution instructions."
  - id: D2
    description: "chrome.alarms-driven auto-lock: armAutoLock creates a named alarm (whitelist-validated), registerAutoLockAlarmListener locks the vault when it fires, never setTimeout/setInterval"
    requirement: "EXT-03"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-session.test.ts#autolock > armAutoLock(5) followed by firing the alarm listener directly calls lockVaultSession(true)"
        status: pass
      - kind: other
        ref: "grep -n setInterval\\|setTimeout extension/entrypoints/background/autolock.ts (no live call, comment-only mentions)"
        status: pass
    human_judgment: false
  - id: D3
    description: "lockVaultSession() clears ONLY the key envelope; the session-meta record (token/email/idle-minutes) survives with wasAutoLocked flipped to true, making session.status's 'locked' branch reachable"
    requirement: "EXT-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/vault-session.test.ts#lockVaultSession > clears the in-memory handle and the key envelope, but the session-meta record survives with wasAutoLocked=true"
        status: pass
    human_judgment: false
  - id: D4
    description: "router.ts dispatches session.status/session.setAutoLockMinutes end-to-end through the real router to vault-session.ts/autolock.ts, positioned for Waves 3-4 to extend by adding cases"
    requirement: "EXT-02"
    verification:
      - kind: other
        ref: "cd extension && npx tsc --noEmit (clean); npx vitest run (26/26 pass); npx wxt build -b chrome and -b firefox (both green, single background.js each)"
        status: pass
    human_judgment: true
    rationale: "A real popup sending a live browser.runtime.sendMessage to a loaded extension has no CLI/headless equivalent in this environment -- deferred to the orchestrator's end-to-end verification once Plan 09-05 builds the real popup UI that calls session.status."

# Metrics
duration: 10min
completed: 2026-07-15
status: complete
---

# Phase 9 Plan 2: Session Unlock Core — Popup Sync Client Summary

**chrome.storage.session-backed session core (two independently-lifetimed records: lock-surviving session-meta vs. lock-cleared key envelope) surviving a simulated service-worker idle-kill, chrome.alarms-driven auto-lock, and a typed popup<->background message router — all proven by 5 new TDD tests (26/26 extension-wide) plus clean tsc and both packaged builds.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-15T08:03:00Z (approx)
- **Completed:** 2026-07-15T08:10:00Z
- **Tasks:** 3
- **Files modified:** 8 (6 created, 2 modified)

## Accomplishments
- `extension/lib/messaging/ext-protocol.ts` — the discriminated-union `Message`/`MessageResponseMap` contract every popup<->background call crosses through this phase and future phases, with a typed `sendMessage()` helper.
- `extension/entrypoints/background/session-storage.ts` — async `chrome.storage.session` read/write for TWO independently-lifetimed records: a lock-surviving `SessionMeta` (token/email/idle-minutes/wasAutoLocked) and a lock-cleared `KeyEnvelope` (base64 exported User Key bytes). Only `clearKeyEnvelope()` exists; the meta record has no clear function this phase. Documents the standing "never call `setAccessLevel(TRUSTED_AND_UNTRUSTED_CONTEXTS)`" invariant at the exact point a future content-script phase might be tempted to widen it.
- `extension/entrypoints/background/vault-session.ts` — the real session core (evolved from Phase 8's spike): `ensureHydrated()` re-imports the key envelope into a freshly-initialized WASM instance after a simulated idle-kill; `setUnlockedUserKey()` zeroizes the transient exported buffer in a `finally` block regardless of write outcome (T-09-06); `lockVaultSession()` clears ONLY the key envelope, updating (never deleting) the session-meta record so the bearer token survives an auto-lock (the plan's own "Blocker-2 fix").
- `extension/entrypoints/background/autolock.ts` — `chrome.alarms`-driven auto-lock (`armAutoLock`/`registerAutoLockAlarmListener`), never `setTimeout`/`setInterval`; `AUTOLOCK_OPTIONS` whitelist validated at arm time (T-09-08).
- `extension/entrypoints/background/router.ts` — typed `browser.runtime.onMessage` dispatch table for `session.status`/`session.setAutoLockMinutes`, replicating the WR-01 sender-validation gate, positioned for 09-03/09-04/09-05 to extend by adding cases.
- Regenerated the shared WASM artifact (`scripts/build-wasm.sh`) so `exportUserKeyForSession`/`importUserKeyFromSession` from Plan 09-01 are present in `extension/lib/crypto/wasm/pv_wasm.d.ts` (gitignored, not committed) — confirmed both exact JS export names against the regenerated `.d.ts` before writing any TypeScript against them.

## Task Commits

Each task was committed atomically:

1. **Task 1: Typed messaging contract and chrome.storage.session envelope I/O** - `4999937` (feat)
2. **Task 2: Session envelope lifecycle (idle-kill survival) and chrome.alarms auto-lock**
   - RED: `a0383f2` (test) — confirmed all 5 cases fail with "Cannot find module" by temporarily removing the not-yet-committed implementation files and re-running vitest
   - GREEN: `d988e90` (feat) — all 5 cases pass
3. **Task 3: Message router wiring for session.* kinds** - `01f75e1` (feat)

**Plan metadata:** pending final `docs(09-02):` commit (see below)

## Files Created/Modified
- `extension/lib/messaging/ext-protocol.ts` - Typed `Message`/`MessageResponseMap`/`sendMessage()` popup<->background contract.
- `extension/entrypoints/background/session-storage.ts` - Two-record async `chrome.storage.session` I/O (`SessionMeta` vs. `KeyEnvelope`), `getSessionToken()` convenience reader.
- `extension/entrypoints/background/vault-session.ts` - Session lifecycle core: `ensureHydrated`, `setUnlockedUserKey`, `lockVaultSession`, `subscribeSessionLockState`, `isSessionUnlocked`, `noteActivity`.
- `extension/entrypoints/background/autolock.ts` - `chrome.alarms`-driven auto-lock: `AUTOLOCK_OPTIONS`, `DEFAULT_AUTOLOCK_MINUTES`, `armAutoLock`, `registerAutoLockAlarmListener`.
- `extension/entrypoints/background/router.ts` - `registerMessageRouter()`, `session.status`/`session.setAutoLockMinutes` handlers.
- `extension/entrypoints/background/vault-session.test.ts` - 5 TDD behaviors covering the idle-kill/wake round trip, the token-survives-lock fix, and the autolock->lock integration.
- `extension/lib/crypto/wasm-loader.ts` - Added `exportUserKeyForSession`/`importUserKeyFromSession` re-exports (Rule 3 fix — see Deviations).
- `extension/entrypoints/background.ts` - Wired `registerMessageRouter()` + `registerAutoLockAlarmListener()` at startup, plus a defensive startup re-arm of the auto-lock alarm (T-09-07).
- (Gitignored, regenerated, not committed) `extension/lib/crypto/wasm/pv_wasm.js`, `.d.ts`, `extension/public/wasm/pv_wasm_bg.wasm`, and the matching `web/` artifacts — regenerated via `scripts/build-wasm.sh` to pick up Plan 09-01's new pv-wasm exports.

## Decisions Made
- Phase 8's real background entrypoint is `extension/entrypoints/background.ts` (a file), not `extension/entrypoints/background/index.ts` as this plan's `files_modified` frontmatter assumed. Edited the real file; confirmed no duplicate-entrypoint conflict via both `wxt build -b chrome` and `-b firefox` (each produced exactly one `background.js`).
- Added `registerMessageRouter()` as a SECOND, independent `browser.runtime.onMessage` listener alongside `background.ts`'s existing Phase-8 `spike.roundtrip` listener (rather than merging them) — preserves the still-functioning debug harness popup untouched until Plan 09-05 replaces it, while `router.ts` independently replicates the WR-01 sender-validation gate so it enforces the same security control regardless of the other listener.
- `wasm-loader.ts` gained the two new pv-wasm re-exports because it is documented as the sole choke-point importer of `./wasm/pv_wasm.js` — routing `vault-session.ts` around it would violate that file's own standing invariant (Rule 3, out-of-plan file touch, tracked below).
- Test mocking follows 09-01's established `vi.mock("wxt/browser", ...)` convention (Map-backed fake storage + recorded alarm listeners) rather than introducing `fakeBrowser` from `wxt/testing` as the plan's action text suggested as an option — avoids a second, competing test-double mechanism for the same "wxt/browser" mock target within the same codebase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added exportUserKeyForSession/importUserKeyFromSession re-exports to wasm-loader.ts**
- **Found during:** Task 2 (vault-session.ts implementation)
- **Issue:** `wasm-loader.ts`'s own header comment documents it as "the sole choke-point importer of the generated WASM bindings... No other file under extension/ may import from `./wasm`." Plan 09-01's new pv-wasm exports (`exportUserKeyForSession`/`importUserKeyFromSession`) were not yet re-exported from that choke-point, and `vault-session.ts` needs them to implement `ensureHydrated()`/`setUnlockedUserKey()`. Importing them directly from `./wasm/pv_wasm.js` in `vault-session.ts` would violate the file's own standing invariant.
- **Fix:** Added the two named imports/re-exports to `wasm-loader.ts`, with a comment pointing back to Plan 09-01's D-02 rationale.
- **Files modified:** `extension/lib/crypto/wasm-loader.ts`
- **Verification:** `cd extension && npx tsc --noEmit` (clean); `npx vitest run` (26/26 pass, including the new idle-kill-survival tests that exercise this import path via the mocked wasm-loader module).
- **Committed in:** `d988e90` (Task 2 GREEN commit)

**2. [Rule 1 - Bug/test correction] Test 5 arms at 5 minutes, not the plan text's literal 1 minute**
- **Found during:** Task 2 GREEN run (TDD)
- **Issue:** The plan's Test 5 behavior description literally says `armAutoLock(1)`, but the SAME task also specifies `AUTOLOCK_OPTIONS = [5, 15, 30, 60] as const` — `1` is not a whitelist member. My implementation validates `armAutoLock`'s input against the whitelist at arm time (required by T-09-08's mitigation, and explicitly called for by the plan's own `validateIdleMinutes`-shaped guidance), so `armAutoLock(1)` silently coerces to `DEFAULT_AUTOLOCK_MINUTES` (15) — the test's original assertion (`delayInMinutes: 1`) failed for the RIGHT reason (whitelist enforcement working as designed, not a code bug).
- **Fix:** Changed the test to arm at `5` (a real whitelist member), preserving the test's actual intent (arm -> fire -> lock) without weakening the security control to fit an inconsistent plan example.
- **Files modified:** `extension/entrypoints/background/vault-session.test.ts`
- **Verification:** `npx vitest run entrypoints/background/vault-session.test.ts` — 5/5 pass.
- **Committed in:** `d988e90` (Task 2 GREEN commit; the test edit landed before the GREEN commit, so it's included there, not the earlier RED commit)

---

**Total deviations:** 2 auto-fixed (1 blocking-import fix, 1 test-value correction surfaced by TDD itself)
**Impact on plan:** Both fixes are necessary for correctness/security (choke-point discipline, whitelist enforcement) with zero scope creep — no new files beyond what the plan's own architecture required, and no behavioral change to what was specified.

## Issues Encountered
None beyond the two deviations above (which surfaced and were resolved during Task 2's own TDD RED/GREEN cycle, not as separate post-hoc bugs).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `session.status`/`session.setAutoLockMinutes` dispatch end-to-end from a stub sender through `router.ts` to `vault-session.ts`/`autolock.ts` and back — ready for Plan 09-03's unlock ceremony to call `setUnlockedUserKey()` after a real password/PRF unlock, and Plan 09-04's `auth-api.ts` to read the bearer token via `session-storage.ts`'s `getSessionToken()`.
- `subscribeSessionLockState()` is ready for Waves 3-4's popup UI to subscribe to lock-state changes.
- **Deferred human verification (cannot be automated in this environment, per this plan's own execution instructions):** a genuine Chrome service-worker idle-kill/wake cycle against the PACKAGED build (not just the mocked unit tests) — repro steps: `cd extension && npx wxt build -b chrome`, load `.output/chrome-mv3` as an unpacked extension, open the debug popup, trigger an unlock via a future 09-03 popup action (or manually invoke `setUnlockedUserKey` via the background console for now), open `chrome://serviceworker-internals`, find the extension's service worker, click "Stop" to force a real idle-kill, then send a `session.status` message from the popup again and confirm it resolves `{kind: "unlocked", ...}` without re-deriving the key from scratch (proving `ensureHydrated()`'s real-WASM re-instantiation path, which the unit tests only prove against a mocked WASM boundary). The orchestrator's Playwright kill/wake UAT harness is expected to cover this.
- No blockers. All three tasks' automated verification (tsc, vitest, both wxt builds) is green.

---
*Phase: 09-session-unlock-core-popup-sync-client*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: extension/lib/messaging/ext-protocol.ts
- FOUND: extension/entrypoints/background/session-storage.ts
- FOUND: extension/entrypoints/background/vault-session.ts
- FOUND: extension/entrypoints/background/autolock.ts
- FOUND: extension/entrypoints/background/router.ts
- FOUND: extension/entrypoints/background/vault-session.test.ts
- FOUND: extension/lib/crypto/wasm-loader.ts (modified)
- FOUND: extension/entrypoints/background.ts (modified)
- FOUND: commit 4999937
- FOUND: commit a0383f2
- FOUND: commit d988e90
- FOUND: commit 01f75e1
