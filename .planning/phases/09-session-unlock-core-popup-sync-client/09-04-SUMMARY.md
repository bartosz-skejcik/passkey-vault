---
phase: 09-session-unlock-core-popup-sync-client
plan: 04
subsystem: extension
tags: [webauthn, prf, wasm-bindgen, chrome-extension, vitest, message-router]

# Dependency graph
requires:
  - phase: 09-session-unlock-core-popup-sync-client (09-01)
    provides: pv-wasm's deriveAuthMaterial/unwrapUserKey/WasmWrappingKey.fromPrf crypto surface
  - phase: 09-session-unlock-core-popup-sync-client (09-02)
    provides: "extension/entrypoints/background/vault-session.ts's setUnlockedUserKey, session-storage.ts's readSessionMeta/getSessionToken, router.ts's typed dispatch table, ext-protocol.ts's discriminated-union message contract"
  - phase: 09-session-unlock-core-popup-sync-client (09-03)
    provides: "extension/entrypoints/background/server-config.ts's readServerConfig() as the sole server-URL source"
provides:
  - "extension/entrypoints/background/auth-api.ts — server-config-aware, session-token-aware port of prelogin/me/login/unlockStart/unlockFinish/passkeyLoginStart/passkeyLoginFinish"
  - "extension/lib/passkeys/prf.ts — pure, WASM-free PRF ceremony helpers (buildPrfExtensions/extractPrfBytes/stripPrfFromCredentialJson) importable from the future popup"
  - "extension/entrypoints/background/unlock.ts — handleUnlockPassword (unlock-only + sign-in), handleUnlockPrfStart/Finish (SessionUser-gated), handleSignInPrfStart/Finish (unauthenticated)"
  - "router.ts/ext-protocol.ts extended with six message kinds: unlock.password/prf.start/prf.finish, auth.signIn.password/prf.start/prf.finish"
affects: [09-05, 09-06, 09-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "unlock.ts is the ONLY background-context file this phase that touches PRF ceremony output (assertion JSON + extracted bytes) as plain message payloads, never a live PublicKeyCredential — the popup (Plan 09-06) owns navigator.credentials.get() exclusively, mirroring web/'s passkeyLogin()/passkeyUnlock() split at the exact point WebAuthn requires it"
    - "handleUnlockPassword's single function, two-branch (email undefined vs. provided) design lets router.ts dispatch BOTH unlock.password and auth.signIn.password to the same implementation, differing only in which argument the popup supplies"

key-files:
  created:
    - extension/entrypoints/background/auth-api.ts
    - extension/lib/passkeys/prf.ts
    - extension/entrypoints/background/unlock.ts
    - extension/entrypoints/background/unlock.test.ts
  modified:
    - extension/entrypoints/background/router.ts
    - extension/lib/messaging/ext-protocol.ts
    - extension/lib/crypto/wasm-loader.ts

key-decisions:
  - "prf.ts duplicates a tiny local base64Decode helper rather than importing auth-api.ts's — importing a background-context module (which transitively pulls server-config.ts/session-storage.ts's chrome.storage-backed code) into a file explicitly designed to be popup-importable-with-zero-WASM-dependency would undermine the whole point of the split; the duplicate is ~6 lines and has no crypto/side-effect risk"
  - "wasm-loader.ts (not in this plan's files_modified list) gained a deriveAuthMaterial re-export — required because that file documents itself as the sole choke-point importer of ./wasm/pv_wasm.js, mirroring 09-02's identical fix for exportUserKeyForSession/importUserKeyFromSession (Rule 3, see Deviations)"
  - "UnlockResult/PrfStartResult are defined once in unlock.ts (their canonical location per the plan's own export-surface spec) and imported into ext-protocol.ts via `import type` — erased at compile time, so ext-protocol.ts (and any future popup that imports it) never bundles background-only runtime code, only the type shape"
  - "handleUnlockPrfFinish/handleSignInPrfFinish accept args.prfBytes typed as ArrayBuffer (not Uint8Array) — matches PublicKeyCredential.getClientExtensionResults()'s actual return shape (prf.ts's extractPrfBytes) and structured-clone-safe over browser.runtime.sendMessage"

patterns-established:
  - "Any future message-kind pair that needs both an 'existing session' and a 'mint a new session' variant should follow handleUnlockPassword's single-function/optional-argument shape rather than duplicating near-identical logic across two functions"

requirements-completed: [EXT-02]

coverage:
  - id: D1
    description: "auth-api.ts ports prelogin/me/login/unlockStart/unlockFinish/passkeyLoginStart/passkeyLoginFinish, targeting server-config.ts's baseUrl and session-storage.ts's bearer token instead of a compiled-in env var/localStorage; register() deliberately not ported"
    requirement: "EXT-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/unlock.test.ts (all 8 cases exercise auth-api.ts's exported surface via mocks)"
        status: pass
      - kind: other
        ref: "grep -n \"export.*register\" extension/entrypoints/background/auth-api.ts (no match)"
        status: pass
    human_judgment: false
  - id: D2
    description: "prf.ts exposes buildPrfExtensions/extractPrfBytes/stripPrfFromCredentialJson, pure and WASM-free, ready for the popup (Plan 09-06) to import"
    requirement: "EXT-02"
    verification:
      - kind: other
        ref: "cd extension && npx tsc --noEmit (clean); grep -n \"pv-wasm|wasm-loader\" extension/lib/passkeys/prf.ts (no match)"
        status: pass
    human_judgment: false
  - id: D3
    description: "handleUnlockPassword: unlock-only branch (no email) calls me()/prelogin()/deriveAuthMaterial/unwrapUserKey and setUnlockedUserKey with the EXISTING token; sign-in branch (email provided) calls prelogin()/deriveAuthMaterial/login()/unwrapUserKey and setUnlockedUserKey with a FRESHLY MINTED token+DEFAULT_AUTOLOCK_MINUTES; a 401 from either path returns a typed invalid-credentials failure distinct from a generic derive/unwrap failure; passwordBytes is zeroized unconditionally"
    requirement: "EXT-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/unlock.test.ts#Test 1 (unlock-only, existing token)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/unlock.test.ts#Test 2 (sign-in, fresh install)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/unlock.test.ts#Test 3 (unlock-only, invalid session)"
        status: pass
    human_judgment: false
  - id: D4
    description: "handleUnlockPrfStart/Finish (SessionUser-gated) and handleSignInPrfStart/Finish (unauthenticated) both split at the WebAuthn ceremony boundary — a 404 from either *Start maps to prfUnavailable (no browser prompt shown); a null prf_wrapped_uk from either *Finish returns prfUnavailable without calling setUnlockedUserKey; a non-null prf_wrapped_uk unwraps and calls setUnlockedUserKey with the correct token/email source (existing session-meta for unlock-only, the just-minted session_token for sign-in)"
    requirement: "EXT-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/unlock.test.ts#Test 4 (handleUnlockPrfStart, incl. 404)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/unlock.test.ts#Test 5 (handleUnlockPrfFinish, both prf_wrapped_uk cases)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/unlock.test.ts#Test 6 (handleSignInPrfStart, incl. 404)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/unlock.test.ts#Test 7 (handleSignInPrfFinish, non-null prf_wrapped_uk)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/background/unlock.test.ts#Test 8 (handleSignInPrfFinish, null prf_wrapped_uk)"
        status: pass
    human_judgment: false
  - id: D5
    description: "router.ts/ext-protocol.ts extended (not restructured) with all six new message kinds, dispatching to unlock.ts's handlers, with the sender-validation gate (WR-01) and the discriminated-union/response-map shape both preserved"
    requirement: "EXT-02"
    verification:
      - kind: other
        ref: "cd extension && npx tsc --noEmit (clean); grep -n 'unlock.password|unlock.prf.start|unlock.prf.finish|auth.signIn' extension/entrypoints/background/router.ts extension/lib/messaging/ext-protocol.ts"
        status: pass
    human_judgment: false
  - id: D6
    description: "A real, live pv-server + real account + real authenticator exercising the six message kinds end-to-end through a loaded extension (real WebAuthn ceremony in the popup, real server round trip, real setUnlockedUserKey persistence)"
    requirement: "EXT-02"
    verification: []
    human_judgment: true
    rationale: "No popup UI exists yet to drive these message kinds (Plan 09-06 builds it) and no CLI/headless equivalent of a real WebAuthn ceremony + live server exists in this environment. This plan proves the background-side orchestration logic exhaustively via mocked auth-api/wasm-loader/vault-session/session-storage boundaries (8/8 unit tests) plus clean tsc and both packaged builds. The real end-to-end proof is deferred to 09-07 (this phase's manual-verification plan) and the orchestrator's own Playwright UAT with a CDP virtual authenticator, once Plan 09-06's popup exists to send these messages."

# Metrics
duration: 25min
completed: 2026-07-15
status: complete
---

# Phase 9 Plan 4: Session Unlock Core — Password + PRF Unlock Ceremony Summary

**Background-side orchestration of both the fresh-install sign-in ceremony (mints a session token via `login()`/`passkeyLoginFinish()`) and the existing-token unlock-only ceremony (re-derives via `me()`/`unlockFinish()`), split at the exact popup/background boundary WebAuthn requires — proven by 8 new TDD tests (37/37 extension-wide) plus clean `tsc` and both packaged builds.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-15T10:20:00Z (approx)
- **Completed:** 2026-07-15T10:45:00Z (approx)
- **Tasks:** 2
- **Files modified:** 7 (4 created, 3 modified)

## Accomplishments

- `extension/entrypoints/background/auth-api.ts` — server-config-aware, session-token-aware port of `web/src/lib/auth/api.ts` + `web/src/lib/passkeys/api.ts`'s unlock/passkey-login surface (`prelogin`/`me`/`login`/`unlockStart`/`unlockFinish`/`passkeyLoginStart`/`passkeyLoginFinish`), reading the base URL from `server-config.ts` and the bearer token from `session-storage.ts`; `register()` deliberately not ported (account creation stays web-app-only).
- `extension/lib/passkeys/prf.ts` — pure, WASM-free port of `login.ts`'s PRF extension-input/extraction/stripping helpers, self-contained (no import of `auth-api.ts` or `wasm-loader`) so the future popup (Plan 09-06) can import it with zero crypto dependency.
- `extension/entrypoints/background/unlock.ts` — `handleUnlockPassword` (single function, two branches: `email === undefined` is unlock-only via `me()`, `email` provided is sign-in via `login()`), `handleUnlockPrfStart`/`handleUnlockPrfFinish` (`SessionUser`-gated unlock-only pair), `handleSignInPrfStart`/`handleSignInPrfFinish` (unauthenticated sign-in pair). All four PRF-finish/password branches zeroize transient buffers and free WASM handles unconditionally in `finally`.
- `router.ts`/`ext-protocol.ts` extended with six message kinds (`unlock.password`, `unlock.prf.start`, `unlock.prf.finish`, `auth.signIn.password`, `auth.signIn.prf.start`, `auth.signIn.prf.finish`), dispatching to the handlers above while preserving the WR-01 sender-validation gate and the discriminated-union/response-map shape unchanged.
- A fresh extension install with zero prior token can now reach an unlocked vault end-to-end (background-side logic complete) — closing the last background-context gap before Plan 09-06's popup UI.

## Task Commits

Each task was committed atomically:

1. **Task 1: auth-api.ts + prf.ts — server-config-aware API client and shared PRF helpers** - `e10297d` (feat)
2. **Task 2: unlock.ts — sign-in + unlock-only + two-phase PRF ceremony orchestration**
   - RED: `fb7ef7f` (test) — confirmed all 8 cases fail for the right reason (`Cannot find module './unlock'`) by temporarily removing the not-yet-committed implementation file and re-running vitest
   - GREEN: `48bb7df` (feat) — all 8 cases pass; also includes router.ts/ext-protocol.ts/wasm-loader.ts changes

**Plan metadata:** pending final `docs(09-04):` commit (see below)

## Files Created/Modified

- `extension/entrypoints/background/auth-api.ts` - `prelogin`/`me`/`login`/`unlockStart`/`unlockFinish`/`passkeyLoginStart`/`passkeyLoginFinish` + `base64Encode`/`base64Decode`/`ApiClientError`/`ServerNotConfiguredError`.
- `extension/lib/passkeys/prf.ts` - `buildPrfExtensions`/`extractPrfBytes`/`stripPrfFromCredentialJson`, pure, WASM-free.
- `extension/entrypoints/background/unlock.ts` - `handleUnlockPassword`/`handleUnlockPrfStart`/`handleUnlockPrfFinish`/`handleSignInPrfStart`/`handleSignInPrfFinish`, `UnlockResult`/`PrfStartResult` types.
- `extension/entrypoints/background/unlock.test.ts` - 8 TDD behaviors covering both password branches, both PRF-start 404 short-circuits, and both PRF-finish null/non-null `prf_wrapped_uk` collapses.
- `extension/entrypoints/background/router.ts` - Added six `case`s to the dispatch switch and the sender-gate allowlist; header comment corrected to reflect that this plan (not 09-03) adds the `unlock.*` kinds (see Deviations).
- `extension/lib/messaging/ext-protocol.ts` - Added six `Message`/`MessageResponseMap` entries, importing `UnlockResult`/`PrfStartResult` as `import type` from `unlock.ts`.
- `extension/lib/crypto/wasm-loader.ts` - Added `deriveAuthMaterial` re-export (Rule 3 fix — see Deviations).

## Decisions Made

- `prf.ts` duplicates a ~6-line local `base64Decode` rather than importing `auth-api.ts`'s — keeps the module import-free of anything background-context-specific (server-config.ts/session-storage.ts's `chrome.storage`-backed code), which matters because this file is explicitly designed to be popup-importable with zero WASM/background dependency.
- `UnlockResult`/`PrfStartResult` are defined once, canonically, in `unlock.ts` (per the plan's own export-surface spec) and imported into `ext-protocol.ts` via `import type` — erased at compile time, so no popup that imports `ext-protocol.ts` ever bundles background-only runtime code.
- Followed the plan's exact function signatures and message-kind names verbatim.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added `deriveAuthMaterial` re-export to `wasm-loader.ts`**
- **Found during:** Task 2 (`unlock.ts` implementation)
- **Issue:** `wasm-loader.ts`'s own header comment documents it as "the sole choke-point importer" of the generated WASM bindings. `handleUnlockPassword`'s password-derived branches need `deriveAuthMaterial` (unwrapped from `./wasm/pv_wasm.js`), which was not yet re-exported from that choke-point — importing it directly in `unlock.ts` would violate the file's own standing invariant. Same class of fix as 09-02's `exportUserKeyForSession`/`importUserKeyFromSession` re-export.
- **Fix:** Added the named import/re-export to `wasm-loader.ts`, with a comment pointing back to `web/src/lib/crypto/index.ts`'s equivalent re-export.
- **Files modified:** `extension/lib/crypto/wasm-loader.ts`
- **Verification:** `cd extension && npx tsc --noEmit` (clean); `npx vitest run` (37/37 pass, including `unlock.test.ts`'s cases that exercise this import path via the mocked wasm-loader module).
- **Committed in:** `48bb7df` (Task 2 GREEN commit)

**2. [Rule 1 - Bug/verification tooling] Doc-comment prose matched the plan's own literal verification greps**
- **Found during:** Task 1 (`prf.ts`) and Task 2 (`unlock.ts`), running the plan's `<verification>` checklist before final commit
- **Issue:** The plan's `<verification>` requires `grep -n "pv-wasm\|wasm-loader" extension/lib/passkeys/prf.ts` and `grep -n "navigator.credentials" extension/entrypoints/background/unlock.ts` to both return nothing. My first-draft header comments in both files explained the D-05 boundary using exactly those literal substrings in prose (e.g. "never imports pv-wasm or wasm-loader", "`navigator.credentials.get()` has no DOM access"), which the naive grep can't distinguish from a real import/call. Same class of issue 09-03 hit with its own `storage.session` comment.
- **Fix:** Reworded both comments to convey the identical invariant without the literal joined substrings (e.g. "no import of the generated WASM bindings or their choke-point loader", "the WebAuthn assertion-request DOM API").
- **Files modified:** `extension/lib/passkeys/prf.ts`, `extension/entrypoints/background/unlock.ts`
- **Verification:** Both greps now return nothing (exit 1); `cd extension && npx tsc --noEmit` clean.
- **Committed in:** `e10297d` (prf.ts, Task 1 commit), `48bb7df` (unlock.ts, Task 2 GREEN commit)

**3. [Rule 1 - Docs accuracy] Corrected `router.ts`/`ext-protocol.ts` header comments' stale wave attribution**
- **Found during:** Task 2, reading `router.ts`/`ext-protocol.ts` before editing (per the plan's own "read it first" instruction)
- **Issue:** Both files' header comments (written by Plan 09-02) stated "09-03 adds `unlock.*` kinds, 09-04 adds `auth.signIn.*` kinds" — but 09-03-SUMMARY.md confirms 09-03 only built `server-config.ts` and added no message kinds at all. This plan (09-04) is the one adding both the `unlock.*` and `auth.signIn.*` kinds, exactly as this plan's own frontmatter/objective state.
- **Fix:** Updated both header comments to read "09-04 adds `unlock.*` AND `auth.signIn.*` kinds, 09-05 adds `vault.list`", matching what actually happened.
- **Files modified:** `extension/entrypoints/background/router.ts`, `extension/lib/messaging/ext-protocol.ts`
- **Verification:** Visual review; no behavioral change, comment-only fix.
- **Committed in:** `48bb7df` (Task 2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (1 blocking-import fix, 2 doc-accuracy fixes — one of which was required for the plan's own verification commands to pass)
**Impact on plan:** All three fixes were necessary for correctness (choke-point discipline) or for the plan's own stated verification commands to pass. No scope creep; no behavioral change to what was specified.

## Issues Encountered

None beyond the three deviations above (all surfaced and resolved during the plan's own TDD/verification cycle, not as separate post-hoc bugs).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All six message kinds (`unlock.password`, `unlock.prf.start`, `unlock.prf.finish`, `auth.signIn.password`, `auth.signIn.prf.start`, `auth.signIn.prf.finish`) dispatch end-to-end from `router.ts` to `unlock.ts`'s handlers, ready for Plan 09-06's popup to call via `ext-protocol.ts`'s typed `sendMessage()`.
- `extension/lib/passkeys/prf.ts` is ready for the popup to import directly for building the WebAuthn extension input and extracting/stripping the ceremony's PRF-bearing output — the popup itself never needs to import `pv-wasm`/`wasm-loader` (D-05 preserved).
- **Deferred to real-browser/live-server UAT (cannot be automated in this environment, per this plan's own execution instructions):** a genuine end-to-end unlock needs a live `pv-server`, a real account, and a real authenticator (or a CDP virtual authenticator). Repro steps once Plan 09-06's popup exists: (1) start `pv-server` locally, (2) register an account + enroll a PRF-capable passkey via the web app, (3) load the packaged extension (`cd extension && npx wxt build -b chrome`, load `.output/chrome-mv3` unpacked), (4) configure the server URL via the popup (Plan 09-03's `configureServer`), (5) drive the popup's sign-in form (password and/or PRF passkey) and confirm `session.status` resolves `{kind: "unlocked", ...}` afterward, (6) lock (via auto-lock or a future "lock now" action) and confirm the unlock-only path (`unlock.password`/`unlock.prf.*`) re-derives correctly against the now-existing session. The orchestrator's Playwright UAT harness (with a CDP virtual authenticator) is expected to cover the PRF ceremony steps; 09-07 is this phase's dedicated manual-verification plan.
- No blockers. All of this plan's own automated verification (tsc, vitest, both wxt builds, all four literal greps) is green.

---
*Phase: 09-session-unlock-core-popup-sync-client*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: extension/entrypoints/background/auth-api.ts
- FOUND: extension/lib/passkeys/prf.ts
- FOUND: extension/entrypoints/background/unlock.ts
- FOUND: extension/entrypoints/background/unlock.test.ts
- FOUND: extension/entrypoints/background/router.ts (modified)
- FOUND: extension/lib/messaging/ext-protocol.ts (modified)
- FOUND: extension/lib/crypto/wasm-loader.ts (modified)
- FOUND: commit e10297d
- FOUND: commit fb7ef7f
- FOUND: commit 48bb7df
