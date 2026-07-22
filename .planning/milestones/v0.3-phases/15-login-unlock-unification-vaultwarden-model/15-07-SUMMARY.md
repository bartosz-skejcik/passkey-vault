---
phase: 15-login-unlock-unification-vaultwarden-model
plan: 07
subsystem: auth
tags: [playwright, selenium, e2e, webauthn, extension, chromium, firefox]

# Dependency graph
requires:
  - phase: 15-login-unlock-unification-vaultwarden-model (plan 01)
    provides: "Password-relay sign-in through the ceremony window (ExtUnlockBridge.tsx mode:signin) -- the exact path this plan's rework now drives from Playwright/Selenium"
  - phase: 15-login-unlock-unification-vaultwarden-model (plan 03)
    provides: "SignInView.tsx (server-ceremony-signin-button testid) / UnlockView.tsx password-first rewrite (server-ceremony-unlock-button, btn-accent) -- the new selectors this plan targets"
  - phase: 15-login-unlock-unification-vaultwarden-model (plan 05)
    provides: "ServerConfigView.tsx's AUTH-04 confirm dialog + config.probe/session.signOut message kinds -- proven live for the first time by this plan's Task 3 checkpoint"
provides:
  - "dual-browser.spec.ts's signInWithPassword()/ensureVaultReady() rewritten to drive the server-origin ceremony window via context.waitForEvent('page') instead of the retired popup password/email form"
  - "P9-SC1/P9-SC2 rewritten against the new popup layout (signed-out hero, password-first locked view)"
  - "run-core.cjs's P9-SC1/SC2 blocks rewritten to drive the ceremony window via the same getAllWindowHandles-before/after-click technique run-server-unlock.cjs already proved; the retired rpId-on-Firefox probe block deleted"
  - "run-server-unlock.cjs's Step 1 (initial extension sign-in) and Step 6 (no-session detection) reworked -- both were silently broken by Plan 15-03's popup rewrite and never re-verified live until this plan's own checkpoint"
  - "App.tsx: onLocked no longer unmounts an in-flight ServerConfigView migration on session.signOut's incidental session.locked broadcast"
  - "ServerConfigView.tsx: bestEffortPermissionsRequest() bounded to 10s -- an unaddressed native permission prompt can no longer wedge the whole AUTH-04 migration dialog forever"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Playwright: a click that opens a new browser window/tab is awaited via `Promise.all([context.waitForEvent('page'), locator.click()])`, mirroring Selenium's proven getAllWindowHandles-before/after-click technique used throughout the Firefox harnesses"
    - "A component that owns an async multi-step operation with disabled dialog buttons for its duration must guard against an UNRELATED top-level broadcast listener reacting to one of that operation's own incidental side-effect messages and unmounting it mid-flight (viewRef.current.kind check, mirrors the existing provider-ceremony guard)"
    - "Any promise crossing into a native (non-page) browser UI surface (a permission prompt, here) that the calling code cannot itself dismiss must be raced against a bounded timeout -- 'best-effort' is not actually best-effort without one"

key-files:
  created: []
  modified:
    - extension/e2e/dual-browser.spec.ts
    - extension/e2e-firefox/run-core.cjs
    - extension/e2e-firefox/run-server-unlock.cjs
    - extension/entrypoints/popup/App.tsx
    - extension/entrypoints/popup/ServerConfigView.tsx

key-decisions:
  - "fixtures.ts required zero changes -- its launchPersistentContext/worker-scoped context already supported the multi-page context.waitForEvent('page') pattern Task 1's rework needed; kept in files_modified per the plan's own frontmatter but no diff exists"
  - "Firefox lanes (Task 3 steps 4-5) could not be run against the shared, must-not-restart :8620 server -- confirmed via `ps eww` that PV_EXTENSION_ORIGINS is unset on that process, a pre-existing environment gap unrelated to this plan's code. Stood up my OWN second pv-server (:8621, throwaway sqlite db, PV_EXTENSION_ORIGINS=\"moz-extension://*\") for both Firefox lanes AND the AUTH-04 two-server proof, matching the environment_notes' own explicit prerequisite and the plan's standing authorization to self-validate"
  - "Registered the run-core.cjs UAT probe account fresh on the throwaway :8621 server via a real headless web-app registration pass (mirrors run-server-unlock.cjs's own Step 0 technique) -- the account only ever existed on :8620"

requirements-completed: [AUTH-01, AUTH-02, AUTH-03, AUTH-04]

coverage:
  - id: D1
    description: "The entire 21-SC Playwright suite's sign-in setup path (signInWithPassword/ensureVaultReady, worker-scoped) drives the server-origin ceremony window, never a popup password/email field"
    requirement: AUTH-01
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-browser.spec.ts -- chromium project, 16/16 tests green (11 clean + 5 flaky-then-passed-on-retry, pre-documented dev-machine memory pressure, unrelated to this rework)"
        status: pass
      - kind: e2e
        ref: "extension/e2e/dual-browser.spec.ts -- chromium-ceremony project (Phase 12), 5/5 green"
        status: pass
    human_judgment: false
  - id: D2
    description: "P9-SC1/P9-SC2 assert the NEW popup layout (no email/password field in no-session view; password-first + promoted passkey button in locked view) instead of the retired dual-model"
    requirement: AUTH-01
    verification:
      - kind: e2e
        ref: "extension/e2e/dual-browser.spec.ts P9-SC1 (signed-out hero assertions) + P9-SC2 (lock -> reload -> password-unlock round trip, btn-accent assertion) -- both PASS on first attempt"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Firefox manual harness's initial sign-in step (run-core.cjs) and no-session detection delegate to the same ceremony-window-driving technique run-server-unlock.cjs already proves on real Firefox"
    requirement: AUTH-01
    verification:
      - kind: e2e
        ref: "real Firefox (geckodriver) extension/e2e-firefox/run-core.cjs, 18/18 rows PASS"
        status: pass
      - kind: e2e
        ref: "real Firefox (geckodriver) extension/e2e-firefox/run-server-unlock.cjs, 17/17 PASS + 2 INFO (documented authenticator-less-limit rows), 0 FAIL"
        status: pass
    human_judgment: false
  - id: D4
    description: "AUTH-04's two-server reconfigure scenario proven live: old session revoked server-side, new server functional, migration completes without stranding the user"
    requirement: AUTH-04
    verification:
      - kind: manual-live
        ref: "Throwaway Playwright script (not committed) driving a real headed Chromium extension load through sign-in to :8620, lock, reconfigure to a second live pv-server (:8621) via the real AUTH-04 confirm dialog"
        status: pass
    human_judgment: true
    rationale: "Requires two live pv-server instances and real browser.permissions native-prompt interaction -- not reproducible from any committed automated suite, exactly this plan's Task 3 checkpoint's own stated scope."

# Metrics
duration: ~3h10min
completed: 2026-07-20
status: complete
---

# Phase 15 Plan 07: e2e Rework + Phase-Close Gate Summary

**Reworked the entire 21-SC Playwright suite and both Firefox manual-harness scripts to drive the server-origin ceremony window instead of the retired popup password/email form, then ran the full phase-close gate live -- finding and fixing two real product bugs (a migration-dialog unmount race and an unbounded native-permission-prompt hang) that only a genuine live-browser AUTH-04 proof could ever have caught.**

## Performance

- **Duration:** ~3h10min (includes standing up a second pv-server, registering a fresh UAT account on it, and iterating on two live-discovered bugs)
- **Tasks:** 3 (2 automated + 1 phase-close checkpoint, self-validated under the project's standing overnight authorization)
- **Files modified:** 5 (2 e2e specs, 2 Firefox harness scripts, 2 product-code live-proof fixes -- one file, ServerConfigView.tsx, appears once here and once in key-files)

## Accomplishments

- `dual-browser.spec.ts`: `signInWithPassword()` now opens and drives the ceremony window (`context.waitForEvent("page")`, matching Selenium's proven window-handle technique); `ensureVaultReady()` branches on the new signed-out hero vs. the unchanged locked-with-session password path; P9-SC1 asserts the new zero-input hero; P9-SC2 replaces the retired ext-scoped-PRF CDP-virtual-authenticator sub-flow with (a) a full ceremony-window sign-in proof and (b) a genuine lock -> reload -> password-unlock round trip against the new password-first locked view (`btn-accent` assertion included)
- `run-core.cjs`: P9-SC1/SC2 rewritten to the same window-handle-driving technique `run-server-unlock.cjs` already used; the retired "rpId-on-Firefox / ext-scoped passkey" probe block (D-12's now-deleted disabled-button explainer) removed outright
- `run-server-unlock.cjs` (Rule 3 fix, not in this plan's `files_modified`): Step 1's initial extension sign-in and Step 6's no-session detection were silently broken by Plan 15-03's popup rewrite (retired `input[type="password"]`/`input[type="email"]` selectors in the popup itself) and never re-verified live until this plan's own checkpoint ran them -- both now use the ceremony-window technique / `server-ceremony-signin-button` testid this file's own P13-07 steps already prove
- **Live bug #1 (Rule 1) -- `App.tsx`:** `session.signOut`'s reuse of `lockVaultSession()`'s side effects fires an incidental `session.locked` broadcast; the popup's top-level `onLocked` listener reacted to it during AUTH-04's migration by unmounting `ServerConfigView` mid-flight, stranding the confirm dialog before `config.set(pendingNewUrl)` ever ran. Guarded with the same `viewRef.current.kind` check already used for the `provider-ceremony` case.
- **Live bug #2 (Rule 2, missing timeout) -- `ServerConfigView.tsx`:** `browser.permissions.request()`'s native prompt can be left unaddressed indefinitely (confirmed live, same automation-gap class as Firefox's own documented permission-doorhanger limitation) while BOTH dialog buttons stay disabled -- an unresolved prompt wedged the entire migration with no escape, violating the feature's own no-stranding guarantee. Bounded to 10s, mirroring `ExtUnlockBridge.tsx`'s existing `RESULT_TIMEOUT_MS` pattern.
- Full phase-close gate run live: vitest 708/708, `tsc --noEmit` clean (both `extension/` and `web/`), both Chromium Playwright projects green (21/21 SCs), both real-Firefox harnesses green (18/18 + 17/17+2 INFO), AUTH-04 two-server migration proven live end to end, `cargo test --workspace` unaffected (0 server-side changes this phase)

## Task Commits

Each task was committed atomically:

1. **Task 1: Playwright dual-browser.spec.ts rework** - `265cbf7` (test)
2. **Task 2: Firefox manual harness (run-core.cjs) rework** - `c385e83` (test)
3. **Task 3 checkpoint deviation 1 (Rule 3): run-server-unlock.cjs stale selectors** - `8fd606c` (fix)
4. **Task 3 checkpoint deviation 2 (Rule 1 + Rule 2): AUTH-04 live-proof fixes** - `cdf742d` (fix)

## Files Created/Modified

- `extension/e2e/dual-browser.spec.ts` - Ceremony-window-driven sign-in helpers + P9-SC1/P9-SC2 rework
- `extension/e2e-firefox/run-core.cjs` - Ceremony-window-driven P9-SC1/SC2 + rpId-on-Firefox block deletion
- `extension/e2e-firefox/run-server-unlock.cjs` - Step 1/Step 6 stale-selector fix (Rule 3)
- `extension/entrypoints/popup/App.tsx` - `onLocked` guard against unmounting an in-flight `server-config` migration (Rule 1)
- `extension/entrypoints/popup/ServerConfigView.tsx` - `bestEffortPermissionsRequest()` bounded to 10s (Rule 2)

`extension/e2e/fixtures.ts` is in this plan's `files_modified` frontmatter but required zero changes -- confirmed already-compatible with the new multi-page ceremony-window pattern.

## Decisions Made

- The shared, must-not-restart `:8620` pv-server was confirmed (via `ps eww`) to have `PV_EXTENSION_ORIGINS` unset -- a pre-existing environment gap, not caused by this plan, that blocks Firefox's optional-host-permission-free CORS bypass (Chrome's `--load-extension` auto-grants elevated trust that Firefox's WebDriver-installed temporary add-on does not receive). Stood up my own throwaway second `pv-server` (`:8621`, `PV_EXTENSION_ORIGINS="moz-extension://*"`, fresh sqlite db) for both Firefox lanes and the AUTH-04 two-server proof, exactly matching `run-core.cjs`'s own documented prerequisite and this plan's `environment_notes` guidance for the AUTH-04 scenario.
- Registered the `run-core.cjs` UAT probe account fresh on that throwaway server via a real (uncommitted, deleted) headless web-app registration pass before running the harness, since the account only ever existed on `:8620`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `run-server-unlock.cjs`'s Step 1/Step 6 sign-in selectors were stale**
- **Found during:** Task 3 checkpoint step 5 (`node extension/e2e-firefox/run-server-unlock.cjs`)
- **Issue:** Not in this plan's `files_modified`, but Plan 15-03's popup rewrite (landed in Wave 2 of this phase) already removed the popup's own email/password sign-in form and its `input[type="email"]` no-session marker -- `run-server-unlock.cjs` (written in Plan 13-06, predating 15-01/15-03) still drove those retired selectors directly and had never been re-run live since. The checkpoint failed hard (`FATAL: sign-in view did not appear after server config`) before this fix.
- **Fix:** Step 1 now drives the ceremony window via the same window-handle technique this file's own P13-07 block already uses; Step 6 detects the no-session view via `[data-testid="server-ceremony-signin-button"]` instead of the retired email input.
- **Files modified:** `extension/e2e-firefox/run-server-unlock.cjs`
- **Verification:** Full script run, 17/17 PASS + 2 INFO, 0 FAIL, against the live second pv-server.
- **Committed in:** `8fd606c`

**2. [Rule 1 - Bug] `App.tsx`'s `onLocked` listener unmounted an in-flight AUTH-04 migration**
- **Found during:** Task 3 checkpoint step 6 (live AUTH-04 two-server proof)
- **Issue:** `session.signOut` (called by `handleConfirmMigration`) reuses `lockVaultSession()`'s side effects, which fire a `session.locked` broadcast as an incidental consequence, not a real "vault got locked" event. The popup's top-level `onLocked` listener reacted by resetting the view, unmounting `ServerConfigView` before `config.set(pendingNewUrl)` ever ran -- the migration's own promise chain kept executing invisibly, its `setState` calls silently dropped on the unmounted component, producing an eternal stuck spinner with no visible error.
- **Fix:** Guard `onLocked` with `viewRef.current.kind === "server-config"`, mirroring the file's own existing `provider-ceremony` guard for the identical class of hazard.
- **Files modified:** `extension/entrypoints/popup/App.tsx`
- **Verification:** `npx vitest run entrypoints/popup/App.test.tsx` (21/21 pass), full suite 708/708, live re-run confirmed the dialog no longer strands.
- **Committed in:** `cdf742d`

**3. [Rule 2 - Missing timeout, correctness requirement] `ServerConfigView.tsx`'s permission-request could hang forever**
- **Found during:** Task 3 checkpoint step 6, after fixing deviation #2 -- the migration still stuck identically
- **Issue:** `browser.permissions.request()`'s underlying native prompt (Chrome's own "grant access to this site" UI, outside the page DOM) can be left unaddressed indefinitely -- confirmed live via an isolated diagnostic call that never resolved even after 6s, despite a genuine trusted click gesture behind it. `handleConfirmMigration` awaits this call FIRST with `disabled={migrating}` on BOTH dialog buttons for its entire duration -- an unresolved prompt wedges the whole migration with no escape, directly contradicting the function's own "best-effort" name and this feature's no-stranding guarantee (T-15-05/T-15-06).
- **Fix:** Raced against a 10s bounded timeout, mirroring `ExtUnlockBridge.tsx`'s existing `RESULT_TIMEOUT_MS` pattern. Server-side `PV_EXTENSION_ORIGINS` CORS allowlisting (not this permission grant) is what `config.set`/`config.probe` actually depend on functionally, so timing out and proceeding is always safe.
- **Files modified:** `extension/entrypoints/popup/ServerConfigView.tsx`
- **Verification:** `npx vitest run entrypoints/popup/ServerConfigView.test.tsx` (13/13 pass, no fake-timer conflicts), full suite 708/708, live re-run: migration completed cleanly, popup landed on the new server's sign-in view, old server's session-row count net-zero (created + revoked) confirming server-side revocation, all without the optional permission grant ever completing.
- **Committed in:** `cdf742d`

---

**Total deviations:** 3 auto-fixed (1 blocking selector-staleness, 1 bug, 1 missing-timeout correctness gap). All three were discovered ONLY by this plan's own live phase-close checkpoint -- exactly the risk this plan's `T-15-12` threat-register entry named ("a missed rework here would leave AUTH-01/02/04 unverified in the ONLY lane that exercises real browser/real cross-server behavior"). Zero scope creep: every fix is the minimal change required to make the plan's own stated checkpoint pass.

## New Lane Baselines (superseding the pre-rework baselines this plan's `environment_notes` documented)

| Lane | Command | Result |
|------|---------|--------|
| Extension unit/integration | `npm test` | 708/708 passed, exit 0, zero unhandled errors |
| `tsc --noEmit` (extension + web) | `npx tsc --noEmit` | Clean, both packages |
| Chromium Playwright (`chromium` project) | `npm run test:e2e:chrome` | 16/16 (11 clean + 5 flaky-then-passed-on-retry -- pre-documented dev-machine memory pressure in `openWebApp()`'s own retry comment, unrelated to this rework) |
| Chromium Playwright (`chromium-ceremony` project) | `npx playwright test --project=chromium-ceremony` | 5/5 clean |
| Real Firefox `run-core.cjs` | `node e2e-firefox/run-core.cjs` (against a properly `PV_EXTENSION_ORIGINS`-configured server) | 18/18 PASS, 0 FAIL/OBSERVED |
| Real Firefox `run-server-unlock.cjs` | `node e2e-firefox/run-server-unlock.cjs` (same server) | 17/17 PASS + 2 INFO (documented authenticator-less-limit rows), 0 FAIL |
| `cargo test --workspace` | `cargo test --workspace` | All green (server-side code untouched this phase) |
| AUTH-04 two-server live migration | manual, self-validated (Playwright, uncommitted) | Old session server-side-revoked, new config persisted, no stranding |

**Important environment note for future runs:** the Firefox harnesses (`run-core.cjs`, `run-server-unlock.cjs`) require a `pv-server` instance with `PV_EXTENSION_ORIGINS` including `moz-extension://*` (D-10) -- the currently-running shared `:8620` instance does NOT have this set (confirmed via `ps eww`, a pre-existing gap outside this plan's scope). Either export `PV_SERVER=<properly-configured-instance>` when running these two scripts, or restart `:8620` with `PV_EXTENSION_ORIGINS` set (coordinate with Bartek first, since other live work may depend on that process staying up).

## Issues Encountered

- The shared `:8620` server's missing `PV_EXTENSION_ORIGINS` blocked the Firefox lanes entirely at first (CORS-blocked error banner, real product code correctly surfacing it) -- resolved by standing up my own properly-configured second server rather than touching `:8620`, per this plan's explicit sequential-execution constraint.
- The `run-core.cjs` UAT account (`uat-prf04@example.local`) only existed on `:8620` -- registered it fresh on the throwaway `:8621` server via an uncommitted, deleted headless registration script before the Firefox lanes could sign in.
- Both live-discovered product bugs (deviations #2 and #3 above) took multiple diagnostic passes to isolate (a naive generic `postSignin` selector initially masked the first failure as a false pass; the second required an isolated per-step `Promise.race` diagnostic to distinguish "hung" from "failed").

## User Setup Required

None for this plan's own commits. See the "Important environment note" above if a future session needs to re-run the Firefox e2e lanes against the shared `:8620` instance specifically.

## Next Phase Readiness

- This is the last plan of Phase 15 (Wave 3, depends on 15-01/15-03/15-05, no other plan depends on this one per its own frontmatter `affects: []`).
- The phase's full closing gate (vitest, tsc, both builds, mainworld-boundary audit, chromium + chromium-ceremony Playwright, real-Firefox core + server-unlock lanes, the AUTH-04 two-server scenario) is green end to end, live-verified, not just unit-tested.
- No blockers for phase closure. The `:8620` `PV_EXTENSION_ORIGINS` gap is an environment/ops matter for Bartek to address independently if he wants the shared instance itself to support live Firefox e2e runs going forward -- it does not block this plan or the phase.

---
*Phase: 15-login-unlock-unification-vaultwarden-model*
*Completed: 2026-07-20*

## Self-Check: PASSED

All modified files confirmed present on disk with the expected diffs; all four task commits (`265cbf7`, `c385e83`, `8fd606c`, `cdf742d`) confirmed present in `git log --oneline --all`. The `:8620` server confirmed still running and healthy (`curl /healthz` -> 200) at time of writing; the throwaway `:8621` server confirmed stopped.
