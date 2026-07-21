---
phase: 18-firefox-window-consent-hardening
plan: 01
subsystem: testing
tags: [firefox, webdriver, selenium, vitest, extension, window-geometry, e2e]

requires:
  - phase: 13-dual-browser-hardening
    provides: extension/e2e-firefox/ selenium-webdriver + geckodriver harness (run-core.cjs, README.md) and Firefox consent-window/ceremony-window call sites this probe drives
  - phase: 260720-16k (quick task)
    provides: the centering/sizing/self-close behavior itself (window-geometry.ts, tryOpenFallbackWindow, startServerUnlock), already implemented and unit-tested before this plan
provides:
  - "8th window-geometry.test.ts case: exact negative-position pass-through assertion (18-UI-SPEC assertion #6)"
  - "extension/e2e-firefox/probe-window-geometry.cjs: new permanent live-Firefox probe, 7 GEOM-* gates"
  - "test:e2e:firefox:window-geometry / pretest:e2e:firefox:window-geometry npm script pair"
  - "Live-Firefox PASS evidence (results-probe-window-geometry.json + 5 screenshots) for UX-02 success-criterion-1"
affects: [18-02, future-window-lifecycle-changes]

tech-stack:
  added: []
  patterns:
    - "Local formula duplication with drift-detection-by-test, not import, for probe scripts that run as bare Node scripts outside the vitest module graph (mirrors probe-request-xray.cjs's precedent)"
    - "Own isolated pv-server instance (own port, own SQLite DB, moz-extension://* wildcard origin) for e2e-firefox probes when the shared dev server's PV_EXTENSION_ORIGINS is a specific (non-wildcard) origin that a probe's own FIXED_UUID cannot match"

key-files:
  created:
    - extension/e2e-firefox/probe-window-geometry.cjs
  modified:
    - extension/lib/window-geometry.test.ts
    - extension/package.json
    - extension/.gitignore

key-decisions:
  - "Ran the probe against a plan-owned, isolated pv-server instance (127.0.0.1:8621, fresh SQLite DB, PV_EXTENSION_ORIGINS=moz-extension://* wildcard) rather than Bartek's already-running :8620 instance, because :8620's PV_EXTENSION_ORIGINS is pinned to one specific extension UUID (not a wildcard) that this probe's own fresh FIXED_UUID cannot satisfy without either colliding with his live daily-driver origin or requiring a server restart -- 'own instance/own port' per the explicit executor guidance, never touching :8620."
  - "Added a browser.storage.local/session clear-before-config step to the probe (not in the plan's literal action text) after discovering the persistent Firefox profile carries the extension's own config/session state across re-runs, causing a false FAIL on re-invocation -- Rule 3 fix, probe file only, mirrors run-server-unlock.cjs's own documented localStorage.clear() clean-slate technique for the identical class of problem on the web-app side."

requirements-completed: [UX-02]

coverage:
  - id: D1
    description: "Negative computed left/top from centeredWindowPosition() passes through unclamped, asserted via toEqual exact pair (18-UI-SPEC assertion #6, 13-REVIEW-3.md IN-02)"
    requirement: "UX-02"
    verification:
      - kind: unit
        ref: "extension/lib/window-geometry.test.ts#passes a negative computed left/top through unclamped"
        status: pass
    human_judgment: false
  - id: D2
    description: "Consent window (380x460) and ceremony window (480x640) both open centered per the exact formula, verified live against a real Firefox build driving the genuine production browser.windows.create() call sites"
    requirement: "UX-02"
    verification:
      - kind: e2e
        ref: "extension/e2e-firefox/probe-window-geometry.cjs (GEOM-CEREMONY-SIZE, GEOM-CEREMONY-POSITION, GEOM-CONSENT-SIZE, GEOM-CONSENT-POSITION)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Consent window self-closes on both explicit confirm and explicit decline; ceremony window self-closes on successful password sign-in -- all three verified live via window-handle disappearance"
    requirement: "UX-02"
    verification:
      - kind: e2e
        ref: "extension/e2e-firefox/probe-window-geometry.cjs (GEOM-CEREMONY-CLOSE, GEOM-CONSENT-CLOSE-CONFIRM, GEOM-CONSENT-CLOSE-DECLINE)"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-07-21
status: complete
---

# Phase 18 Plan 01: Firefox Window Geometry Regression Coverage Summary

**Formalized UX-02 with a negative-position unit test and a new 7-gate live-Firefox probe (probe-window-geometry.cjs) proving the consent (380x460) and ceremony (480x640) windows' centering/sizing/self-close contract against the genuine production `browser.windows.create()` call sites, all 7 GEOM-* gates PASS, zero production code touched.**

## Performance

- **Duration:** ~20 min (including worktree bootstrap: node_modules rsync, pv-ui npm ci, build-wasm.sh, wxt prepare, web build, Firefox extension build, and standing up an isolated pv-server instance for the live probe)
- **Completed:** 2026-07-21
- **Tasks:** 3/3 completed
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- Added the missing negative-position regression case to `window-geometry.test.ts` (8th case: `{left:-50,top:-20,width:300,height:300}, 380, 460` → exact `{left:-90,top:-100}` via `toEqual`, never a bound check), closing 13-REVIEW-3.md's IN-02 coverage gap
- Built `probe-window-geometry.cjs`, a new permanent e2e-firefox probe that drives the REAL `tryOpenFallbackWindow()` and `startServerUnlock()` call sites (never a manually-opened popup tab) and asserts all 6 numbered 18-UI-SPEC "Window Geometry & Lifecycle Contract" assertions that are live-verifiable (7 GEOM-* gates covering assertions #1/#3/#4)
- Wired `test:e2e:firefox:window-geometry` / `pretest:e2e:firefox:window-geometry` into `extension/package.json`, matching the project's existing `test:e2e:firefox:*` script-pair naming family
- Ran the probe live against a real Firefox build and a real (plan-owned, isolated) pv-server instance: 7/7 GEOM-* gates PASS, exit 0, verified idempotent (two consecutive clean runs both green)
- Zero production window-lifecycle code touched — `provider-ceremony.ts`, `server-unlock.ts`, and `window-geometry.ts` all show an empty `git diff --stat` at every task boundary, per this plan's flagged prohibition

## Task Commits

1. **Task 1: Add negative-position regression case to window-geometry.test.ts** - `0ba72fc` (test)
2. **Task 2: Create probe-window-geometry.cjs and wire its npm script pair** - `3a38e38` (test)
3. **Task 3: Run probe-window-geometry.cjs live against real Firefox + pv-server** - `739bf42` (test)

**Plan metadata:** this commit (docs: complete plan) — see final commit below.

## Files Created/Modified

- `extension/lib/window-geometry.test.ts` - Added 8th `it()` case asserting the negative-computed-position pass-through contract
- `extension/e2e-firefox/probe-window-geometry.cjs` - New permanent live-Firefox probe (selenium-webdriver + geckodriver), 7 GEOM-* gates over the two real `browser.windows.create()` call sites
- `extension/package.json` - Added `test:e2e:firefox:window-geometry` and `pretest:e2e:firefox:window-geometry` script entries
- `extension/.gitignore` - Added `.ff-profile-probe-window-geometry` / `.ff-screenshots-probe-window-geometry` (matching every sibling probe's own gitignore pattern)

## Decisions Made

- **Isolated pv-server instance for the live probe, not Bartek's running :8620:** Bartek's dev-server instance had `PV_EXTENSION_ORIGINS` pinned to one specific extension UUID (not the `moz-extension://*` wildcard every e2e-firefox script documents as its precondition). Rather than either colliding with his live daily-driver origin by reusing his exact UUID, or asking him to restart :8620 with a wildcard, this plan stood up its own instance (`127.0.0.1:8621`, fresh SQLite DB in the scratchpad dir, `PV_EXTENSION_ORIGINS=moz-extension://*`) for the duration of Task 3's verification run, then stopped it cleanly. Bartek's :8620 instance was never touched (confirmed still healthy after this plan's own instance was stopped). Matches the executor guidance's explicit "own instance/own port" option.
- **Registered the shared UAT test account on the plan's own fresh DB:** since the isolated instance's SQLite DB was brand new, `uat-prf04@example.local` did not exist on it. Registered it once via a throwaway (not committed) selenium script driving the real web-app `RegisterForm` UI — no crypto/API replication, matching `run-server-unlock.cjs`'s own established Step-0 technique for creating a fresh account through the real product code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Probe false-FAIL on re-run due to persistent-profile state carryover**
- **Found during:** Task 3, second verification run (used to confirm idempotency)
- **Issue:** The probe's persistent Firefox profile (`PROFILE_DIR`) carries the extension's own `browser.storage.local`/`browser.storage.session` state (server config, session token, unlocked-key envelope) across separate script invocations. A second run against the same profile skipped straight past the server-config screen the probe's flow assumes as its starting point, throwing `server-config url input not found` and exiting 1 with an empty results file.
- **Fix:** Added a `browser.storage.local.clear()` + `browser.storage.session.clear()` step (via `driver.executeScript()`) immediately after opening the popup tab, followed by a fresh navigation to `popup.html` — forces a clean slate on every invocation. Mirrors `run-server-unlock.cjs`'s own documented `window.localStorage.clear()` technique for the identical class of problem on the web-app side (that file's own comment: "Force a clean slate every run so the register flow below is always reachable").
- **Files modified:** `extension/e2e-firefox/probe-window-geometry.cjs` (probe file only — no production code)
- **Verification:** Two consecutive clean runs after the fix both produced 7/7 GEOM-* PASS with exit 0.
- **Committed in:** `739bf42` (part of Task 3's commit)

---

**Total deviations:** 1 auto-fixed (Rule 3, blocking issue in a probe/test file, zero production impact)
**Impact on plan:** Necessary for the probe's own re-runnability as a "permanent" regression lane — matches the class of fix every prior e2e-firefox probe in this project has needed for the same persistent-profile characteristic. No scope creep; production window-lifecycle files remain byte-for-byte unchanged (verified via `git diff --stat` at every task boundary).

## Issues Encountered

- **Plan's stated "6 existing test cases" was factually 7:** Task 1's acceptance criteria assumed `window-geometry.test.ts` had 6 existing `it()` blocks (6 + 1 new = 7). The actual file already had 7 existing cases (the plan's own read_first excerpt, re-verified by direct read, confirms 7 pre-existing `it()` blocks). The new case brings the total to 8, not 7. This is a minor miscount in the plan's authored acceptance criteria against the actual pre-existing file state — not a defect in the code or a reason to remove an existing, correct test. Noted here for the record; the substantive acceptance criteria (exact `toEqual({left:-90,top:-100})` assertion, empty `window-geometry.ts` diff) are both satisfied.
- **Own isolated pv-server + web build needed:** the plan's Task 3 precondition ("pv-server already running... account already exists") assumed reuse of an already-configured shared instance. Since the available running instance (:8620) had a non-wildcard origin allowlist, this plan built the web app (`NEXT_PUBLIC_API_BASE_URL="" npm run build`, routing around the known `.env.local` same-origin bug per STATE.md's documented precedent) and stood up its own instance instead — documented above under Decisions Made, not a deviation from production code.

## User Setup Required

None - no external service configuration required. The plan-owned pv-server instance used for live verification was stopped after Task 3 completed; it leaves no running process or persistent state outside the scratchpad directory.

## Next Phase Readiness

UX-02 formalized: negative-position edge case unit-covered (8/8 `window-geometry.test.ts` cases pass), a new permanent live-Firefox probe (`probe-window-geometry.cjs`) proves centering/sizing/self-close against the real production call sites (7/7 GEOM-* gates PASS, exit 0, idempotent across re-runs), and zero production window-lifecycle code changed. Sibling plan 18-02 (XBR-03 security-review verdict, `18-SECURITY.md` + `PROJECT.md` decision entry) is independent of this plan's artifacts and can proceed without blockers from this work.

---
*Phase: 18-firefox-window-consent-hardening*
*Completed: 2026-07-21*

## Self-Check: PASSED

All claimed created/modified files verified present on disk; all 3 task commit hashes (`0ba72fc`, `3a38e38`, `739bf42`) verified present in git log.
