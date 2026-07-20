---
phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
plan: 03
subsystem: testing
tags: [webextension, firefox, webauthn, xray, cross-realm, geckodriver, selenium-webdriver, wxt, jsdom]

# Dependency graph
requires:
  - phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
    provides: "Plan 14-02's page-bridge-firefox.ts MAIN-world re-materialization fix and its WebDriver-executeScript-artifact discovery (debug doc Evidence entries 2026-07-20T11:10:00Z/11:30:00Z)"
  - phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
    provides: "Plan 14-01's independent webauthn-rs real_rp_verification.rs (QA-03 closure evidence)"
provides:
  - "Permanent, deterministic jsdom regression coverage (page-bridge-firefox.test.ts) proving the response-direction MAIN-world re-materialization fix for rawId/clientDataJSON/attestationObject/authenticatorData/signature"
  - "A hard-gated, artifact-free live-Firefox regression probe (probe-request-xray.cjs) that measures response-direction realm identity via a genuinely inline <script> RP fixture, never driver.executeScript()"
  - "A documented, decisive methodology correction for future Firefox WebDriver debugging: inline-<script> fixtures over executeScript-injected .then() captures for any instanceof/realm-identity assertion"
  - "XBR-02 fully closed and git-tracked at .planning/debug/resolved/firefox-request-xray-hole.md"
affects: [15, 16, 17, 18, 19, 20, future-firefox-debug-sessions]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Inline-<script>-fixture measurement technique for any Firefox WebDriver instanceof/realm-identity assertion -- geckodriver's driver.executeScript() runs injected code in a fresh, per-call sandbox realm with its own globals, producing false-negative instanceof readings against real-page-realm-constructed values; a genuinely inline <script> tag (function's defining realm = the page's own) is the only proven-decisive alternative"
    - "whenPatched() poll-before-trigger inside e2e Firefox fixture pages -- a brand-new page navigation's auto-running inline script can race ahead of the extension's own asynchronous content-script MAIN-world patch injection"

key-files:
  created:
    - extension/entrypoints/__tests__/page-bridge-firefox.test.ts
  modified:
    - extension/e2e-firefox/probe-request-xray.cjs
    - extension/e2e-firefox/run-core.cjs
    - .planning/debug/resolved/firefox-request-xray-hole.md
    - .planning/STATE.md

key-decisions:
  - "Response-direction instanceof/toString.call battery MUST be measured via a genuinely inline <script> RP fixture, never driver.executeScript() -- per Plan 14-02's own WebDriver-artifact finding, confirmed empirically in this plan's own live-Firefox debugging"
  - "run-core.cjs's three unguarded switchTo(popupHandle) calls fixed for quick-260720-16k's same-day consent-window self-close behavior (Rule 3 blocking-issue fix on an out-of-scope file, required for Task 3's mandatory green gate suite)"
  - "XBR-02's frontmatter status set to resolved while explicitly preserving the awaiting_human_verify honesty note -- Bartek's own live github.com retest remains open at his leisure, never claimed as done on his behalf"

requirements-completed: [XBR-02]

coverage:
  - id: D1
    description: "Deterministic jsdom test (page-bridge-firefox.test.ts) proves the response-direction MAIN-world re-materialization fix using the same cross-realm-iframe technique already proven for the request direction"
    requirement: XBR-02
    verification:
      - kind: unit
        ref: "extension/entrypoints/__tests__/page-bridge-firefox.test.ts (4 tests, describe: response-direction MAIN-world re-materialization)"
        status: pass
    human_judgment: false
  - id: D2
    description: "probe-request-xray.cjs's XRAY-CREATE/XRAY-GET rows hard-assert response-direction realm identity for every binary field on a REAL Firefox run, measured via a genuinely inline <script> fixture (never driver.executeScript()), and both PASS"
    requirement: XBR-02
    verification:
      - kind: e2e
        ref: "node extension/e2e-firefox/probe-request-xray.cjs -- real Firefox 152.0.6, XRAY-CREATE/XRAY-GET both PASS, all *IsArrayBuffer fields true"
        status: pass
    human_judgment: false
  - id: D3
    description: "The debug doc is git-tracked, its Resolution section covers the response direction, its status is resolved, and it lives at .planning/debug/resolved/"
    requirement: XBR-02
    verification:
      - kind: other
        ref: "git log --oneline -- .planning/debug/resolved/firefox-request-xray-hole.md"
        status: pass
    human_judgment: false
  - id: D4
    description: "Full phase gate suite (vitest, tsc, both builds, audit-mainworld-boundary.sh, run-core.cjs, run-server-unlock.cjs, probe-request-xray.cjs, chromium-ceremony, cargo test --workspace) is green"
    requirement: XBR-02
    verification:
      - kind: unit
        ref: "cd extension && npx vitest run -- 674 passed, 1 known pre-existing unrelated rejection"
        status: pass
      - kind: other
        ref: "cd extension && npx tsc --noEmit -- clean"
        status: pass
      - kind: e2e
        ref: "cd extension && npm run build:chrome && npm run build:firefox -- both succeed"
        status: pass
      - kind: other
        ref: "bash scripts/audit-mainworld-boundary.sh -- PASS, exit 0"
        status: pass
      - kind: e2e
        ref: "node extension/e2e-firefox/run-core.cjs -- 17 PASS + 1 OBSERVED, 0 FAIL"
        status: pass
      - kind: e2e
        ref: "node extension/e2e-firefox/run-server-unlock.cjs -- 15 PASS / 2 INFO / 0 FAIL"
        status: pass
      - kind: e2e
        ref: "npx playwright test --project=chromium-ceremony -- 5/5 PASS"
        status: pass
      - kind: integration
        ref: "cargo test --workspace -- 151 passed, 0 failed"
        status: pass
    human_judgment: false

duration: ~50min
completed: 2026-07-20
status: complete
---

# Phase 14 Plan 03: XBR-02 permanent regression closure Summary

**Two permanent, artifact-free proofs (a deterministic jsdom test and a hard-gated live-Firefox probe measured via a genuinely inline `<script>` RP fixture, never `driver.executeScript()`) turn Plan 14-02's response-direction fix into a real regression gate, close out the debug doc as resolved, and confirm the full phase gate suite green across both requirements and both browsers.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-07-20T13:35:00+02:00
- **Completed:** 2026-07-20T14:25:00+02:00
- **Tasks:** 3
- **Files modified:** 5 (1 new, 4 modified)

## Accomplishments

- Task 1: created `page-bridge-firefox.test.ts` (4 jsdom tests) reusing `content-relay.test.ts`'s `crossRealmArrayBuffer()` hidden-iframe technique to deterministically prove `page-bridge-firefox.ts`'s `shapeCredential()`/`b64UrlToArrayBuffer` re-materializes `rawId`, `response.clientDataJSON`, `response.attestationObject`, `response.authenticatorData`, `response.signature` as genuine MAIN-world-native `ArrayBuffer`s, plus a control test proving the fix is additive (not a full-object replacement)
- Task 2: upgraded `probe-request-xray.cjs` from an unasserted diagnostic capture into a hard PASS/FAIL gate on every response-direction `*IsArrayBuffer` field for both `create()` and `get()` -- **required redesigning the measurement technique** per Plan 14-02's own WebDriver-artifact finding: the response-direction battery now runs through genuinely inline `<script nonce="...">` RP fixture pages (`/xray-create`, `/xray-get`) that trigger the ceremony AND perform every `instanceof`/`toString.call` check themselves, in their own page realm, with results read back via a native WebDriver DOM text read -- never `driver.executeScript()`
- Task 2 (own investigation): discovered and fixed a second, previously-undocumented timing hazard -- a brand-new page navigation's auto-running inline script can race ahead of `content-relay.content.ts`'s own asynchronous MAIN-world patch injection, silently calling Firefox's REAL native WebAuthn (which then hangs indefinitely with no authenticator attached). Added a `whenPatched()` poll inside both fixture pages.
- Task 3: ran and recorded the full 9-command phase-closing gate suite (all green, real numbers below), fixed a genuine same-day regression in `run-core.cjs` (quick-260720-16k's consent-window self-close broke three unguarded window-handle switches), moved the debug doc to `.planning/debug/resolved/`, wrote its RESPONSE-direction Resolution subsection, and mirrored the closure into `STATE.md`

## Task Commits

1. **Task 1: page-bridge-firefox.test.ts -- jsdom regression coverage** - `f4be224` (test)
2. **Task 2: probe-request-xray.cjs -- hard-gate the response-direction assertions** - `0f08680` (feat)
3. **Task 3: Full gate suite confirmation + record hygiene** - `25c9b90` (fix, run-core.cjs deviation) + `538390c` (docs, record hygiene)

## Files Created/Modified

- `extension/entrypoints/__tests__/page-bridge-firefox.test.ts` (new) - Deterministic jsdom regression coverage for the response-direction MAIN-world re-materialization fix; 4 tests reusing the `crossRealmArrayBuffer()` technique
- `extension/e2e-firefox/probe-request-xray.cjs` - Response-direction `*IsArrayBuffer`/`*ToStringTag` battery for `rawId`/`clientDataJSON`/`attestationObject` (create) and `rawId`/`clientDataJSON`/`authenticatorData`/`signature` (get), measured via genuinely inline `<script>` fixture pages; header comment rewritten to document the WebDriver-artifact warning and cite the resolved debug doc
- `extension/e2e-firefox/run-core.cjs` - Three unguarded `switchTo(popupHandle)` calls fixed for the same-day consent-window self-close behavior (quick-260720-16k)
- `.planning/debug/resolved/firefox-request-xray-hole.md` (moved) - New RESPONSE-direction Resolution subsection, `status: resolved`, honest open-item note preserved
- `.planning/STATE.md` - Blockers/Concerns bullet and Deferred Items row both flipped to resolved

## Decisions Made

- **Response-direction instanceof measurement redesigned around a decisive constraint discovered by Plan 14-02**: `driver.executeScript()` runs injected script text in geckodriver's own fresh, per-call sandbox realm (its own `ArrayBuffer` global, distinct from the real page's) -- ANY value constructed in the page's own realm (e.g. by `page-bridge-firefox.ts`) will show `instanceof ArrayBuffer: false` when checked by executeScript-injected code, regardless of whether the check is synchronous or inside a later `.then()`/`setTimeout` continuation of that same call. Only a genuinely inline `<script>` tag (parsed as part of the page's own HTML, so its functions' defining realm is the real page realm) measures the truth. This plan's own live debugging (documented inline in `probe-request-xray.cjs`'s header comment) additionally confirmed `newTabTo()`/`ensurePopup()`'s Marionette `newWindow('tab')` calls themselves require a valid current browsing context -- informing both the CSP-nonce-allowlisted inline-script fixture design and the `run-core.cjs` window-handle fix below.
- **`run-core.cjs`'s stale-`popupHandle` fix classified as Rule 3 (blocking issue) despite being an out-of-scope file**: the failure was deterministic, reproduced identically across two fresh-profile runs, and traced to `quick-260720-16k` (same-day commit `4981218`) which made the consent/ceremony popup self-close on confirm/decline -- a change `run-core.cjs` was never updated for. Since Task 3's own acceptance criteria mandate a green `run-core.cjs` run with exact PASS/FAIL numbers, and the fix is a minimal, mechanical, three-line window-handle correction (no product/security code touched), it was fixed rather than deferred, and documented prominently here as a deviation.
- **XBR-02 closed as `status: resolved` while explicitly preserving the still-open human-verification note**: Bartek's own live github.com retest of the original request-direction fix (Plan 14-02's predecessor session) is NOT claimed as done -- the automated evidence (jsdom + live-Firefox probes, webauthn-rs round-trip from Plan 14-01) is documented as the in-repo substitute closure evidence, not a claim the live retest happened.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/2 - Deviation from literal plan wording, per explicit orchestrator guidance] Response-direction measurement technique redesigned around the WebDriver-executeScript-artifact finding**
- **Found during:** Task 2
- **Issue:** The plan's literal Task 2 text ("extend the existing capture... to ALSO compute the SAME battery" inside the existing `driver.executeScript()`-injected `.then()` block) would have reproduced the exact false-negative measurement pattern Plan 14-02's own investigation proved unreliable for response-direction fields (Evidence entry 2026-07-20T11:30:00Z).
- **Fix:** Redesigned the response-direction battery to run through genuinely inline `<script nonce="...">` RP fixture pages (`/xray-create`, `/xray-get`), triggering the ceremony and performing every `instanceof`/`toString.call` check in the page's own realm, with results read back via a native WebDriver DOM text read (safe primitive read).
- **Files modified:** `extension/e2e-firefox/probe-request-xray.cjs`
- **Verification:** Live Firefox 152.0.6 run -- `XRAY-CREATE`/`XRAY-GET` both PASS, every response-direction `*IsArrayBuffer` field `true`, byte-exact challenge round-trips confirmed. Reproduced twice.
- **Committed in:** `0f08680`

**2. [Rule 3 - Blocking] `newTabTo()`/`ensurePopup()` require a valid current browsing context that a brand-new page's inline auto-run script can outrun**
- **Found during:** Task 2, live debugging of the redesigned `/xray-create` fixture
- **Issue:** The genuinely inline `<script>`'s auto-run `navigator.credentials.create()` call fired before `content-relay.content.ts` had finished asynchronously injecting the MAIN-world patch on the brand-new page navigation, silently calling Firefox's REAL native WebAuthn (which then hung indefinitely with no authenticator attached, producing no consent UI and no error).
- **Fix:** Added a `whenPatched()` poll (max 10s) inside both fixture pages, waiting for `navigator.credentials.create/get.toString()` to no longer include `[native code]` before triggering the ceremony.
- **Files modified:** `extension/e2e-firefox/probe-request-xray.cjs`
- **Verification:** Live Firefox run -- consent UI now appears promptly and reliably, `XRAY-CREATE`/`XRAY-GET` PASS.
- **Committed in:** `0f08680`

**3. [Rule 3 - Blocking, out-of-scope file] `run-core.cjs`'s three unguarded `switchTo(popupHandle)` calls throw `NoSuchWindowError`/`Browsing context has been discarded` post-quick-260720-16k**
- **Found during:** Task 3, running the mandatory gate suite
- **Issue:** `quick-260720-16k` (commit `4981218`, same day) made the consent/ceremony popup window self-close on confirm/decline. `run-core.cjs` was never updated and three raw `switchTo(popupHandle)` calls after P12-SC2/SC3/SC4 threw deterministically (reproduced on 2 consecutive fresh-profile runs), blocking the run at P12-SC3's entry.
- **Fix:** P12-SC2 exit: switch removed (the persistent `rpTabHandle`, never closed, was already the current context). P12-SC3 exit: switch to `rpTabHandle` first (the one guaranteed-alive window, since both `rpTab2` and the popup are gone) then `ensurePopup()` -- confirmed empirically that skipping the `rpTabHandle` step still breaks `ensurePopup()`'s own `newWindow('tab')` fallback. P12-SC4 exit: switch removed (P12-SC5 is a static audit, no window interaction follows).
- **Files modified:** `extension/e2e-firefox/run-core.cjs`
- **Verification:** 2 consecutive fresh-profile runs, both 17 PASS + 1 OBSERVED (RPID-ON-FIREFOX), 0 FAIL -- matches documented baseline exactly.
- **Committed in:** `25c9b90`

---

**Total deviations:** 3 auto-fixed (1 Rule 1/2 measurement-technique redesign per explicit orchestrator guidance, 2 Rule 3 blocking-issue fixes)
**Impact on plan:** All three were necessary for Task 2/3's own explicit acceptance criteria (an artifact-free, hard-gated response-direction assertion; a green `run-core.cjs` run). No scope creep into unrelated product/security code -- all three fixes are test-harness-only.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required.

## Full Gate Suite Results (Task 3, all commands actually run, real output)

1. `cd extension && npx vitest run` -- **674 passed** (670 baseline + 4 new `page-bridge-firefox.test.ts` cases), 0 unexpected failures (1 known pre-existing, unrelated `ServerConfigView.tsx` unhandled rejection, confirmed present before this plan too)
2. `cd extension && npx tsc --noEmit` -- clean, no errors
3. `cd extension && npm run build:chrome && npm run build:firefox` -- both succeed
4. `bash scripts/audit-mainworld-boundary.sh` -- PASS, exit 0 (source + bundle-level, both browsers)
5. `node extension/e2e-firefox/run-core.cjs` -- **17 PASS + 1 OBSERVED** (RPID-ON-FIREFOX, expected informational row), **0 FAIL** -- reproduced twice on fresh profiles
6. `node extension/e2e-firefox/run-server-unlock.cjs` -- **15 PASS / 2 INFO / 0 FAIL**
7. `node extension/e2e-firefox/probe-request-xray.cjs` -- **all rows PASS** (STEP0-origin, SIGNIN, SHIM-PRESENT, XRAY-CREATE, XRAY-GET) -- every response-direction `*IsArrayBuffer` field `true`, byte-exact challenge round-trips confirmed
8. `cd extension && npx playwright test --project=chromium-ceremony` -- **5/5 PASS** (headed)
9. `cargo test --workspace` -- **151 passed, 0 failed** (across pv-core 20, pv-provider 4+1 `real_rp_verification`, pv-server 41+2+9+5+7+10+4+4+7+18, pv-wasm 15; includes Plan 14-01's independent `real_rp_verification.rs`, QA-03 closure evidence)

## Next Phase Readiness

- **Phase 14 is fully complete.** Both requirements closed: XBR-02 (this plan) and QA-03 (Plan 14-01, independently re-confirmed green in this same gate pass).
- `.planning/debug/resolved/firefox-request-xray-hole.md` is git-tracked, resolved, and relocated. `STATE.md`'s Blockers/Concerns and Deferred Items both mirror the closure.
- Bartek's own live github.com retest of the original request-direction fix (Plan 14-02's predecessor session) remains open at his leisure -- documented honestly, not claimed as done.
- Future Firefox WebDriver debug sessions should reuse this plan's inline-`<script>`-fixture technique (not `driver.executeScript()`) for any `instanceof`/realm-identity assertion, and should be aware that a brand-new page navigation's auto-running script can race ahead of content-script injection (`whenPatched()` pattern).
- No blockers for Phase 15 (Login & Unlock Unification).

---
*Phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica*
*Completed: 2026-07-20*

## Self-Check: PASSED

- FOUND: extension/entrypoints/__tests__/page-bridge-firefox.test.ts
- FOUND: extension/e2e-firefox/probe-request-xray.cjs
- FOUND: extension/e2e-firefox/run-core.cjs
- FOUND: .planning/debug/resolved/firefox-request-xray-hole.md
- FOUND: .planning/STATE.md
- FOUND: .planning/phases/14-critical-risk-closure-cross-realm-integrity-real-rp-verifica/14-03-SUMMARY.md
- FOUND commit: f4be224 (Task 1)
- FOUND commit: 0f08680 (Task 2)
- FOUND commit: 25c9b90 (Task 3 deviation fix)
- FOUND commit: 538390c (Task 3 record hygiene)
