---
phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
plan: 02
subsystem: extension
tags: [webextension, firefox, webauthn, xray, cross-realm, geckodriver, wxt]

requires:
  - phase: 13-dual-browser-hardening
    provides: content-relay.content.ts's D-21 base64url encode/decode boundary and the already-shipped REQUEST-direction Firefox Xray fix (isBufferSource/bufferSourceToB64Url)
provides:
  - "page-bridge-firefox.ts's shapeCredential() re-materializes every response-direction binary field (rawId, response.clientDataJSON/attestationObject/authenticatorData/signature/userHandle, PRF results.first/.second) as a MAIN-world-native ArrayBuffer"
  - "A live-Firefox differential-probe methodology (standalone scratch WebExtension + real end-to-end product-flow harness) for future Firefox cross-realm investigations"
  - "A documented, empirically-proven correction: WebDriver/geckodriver's driver.executeScript(...).then(...) pattern produces false instanceof:false readings for ANY value crossing an executeScript call boundary, independent of extensions/Xray -- future debug sessions should use same-call deferred continuations or a genuine inline <script> fixture instead"
affects: [14-03-phase-closing-gate-suite, future-firefox-debug-sessions]

tech-stack:
  added: []
  patterns:
    - "MAIN-world native re-materialization (b64UrlToArrayBuffer sourced from the injected script's own atob/Uint8Array/ArrayBuffer globals) as the architecture-symmetric counterpart to the already-shipped REQUEST-direction fix"
    - "Live-Firefox differential probing: throwaway, uncommitted scratch WebExtensions (kept under session scratchpad, never git-tracked) mirroring product injection/messaging conventions in isolation"

key-files:
  created: []
  modified:
    - extension/entrypoints/page-bridge-firefox.ts
    - extension/entrypoints/content-relay.content.ts
    - .planning/debug/firefox-request-xray-hole.md

key-decisions:
  - "Ruled out ack-timing and envelope sibling-field-count as candidate variables for the standalone-probe-vs-real-flow discrepancy (Task 1), via a throwaway scratch WebExtension testing all 4 combinations on real Firefox -- all showed instanceof:true"
  - "Implemented fix path (a) (MAIN-world re-materialization) per Task 1's SECURED/D-21 clearance, mirroring the already-shipped REQUEST-direction fix's own pattern"
  - "Discovered mid-Task-2, via a genuinely inline <script> fixture (zero WebDriver executeScript involvement), that the original instanceof:false signal motivating this entire task was a WebDriver/geckodriver executeScript measurement artifact, not a real product bug -- confirmed on BOTH the pre-fix and post-fix build"
  - "Kept the fix anyway as harmless, architecture-symmetric defense-in-depth rather than reverting, since it was already cleared by Task 1's SECURED/D-21 gate and causes zero regressions (670/670 vitest, tsc clean, both builds, audit-mainworld-boundary.sh PASS)"

requirements-completed: [XBR-02]

coverage:
  - id: D1
    description: "Live-Firefox differential probe (Task 1) records evidence for all three RESEARCH.md candidate variables (ack-timing, envelope shape, standalone-vs-real-flow) before any fix code is written, and gates Task 2's fix-path choice"
    requirement: XBR-02
    verification:
      - kind: e2e
        ref: "scratchpad standalone-xray-probe.cjs + real-flow-xray-probe.cjs, run against real Firefox 152.0.6 (throwaway harnesses, not committed) -- see .planning/debug/firefox-request-xray-hole.md Evidence entries timestamped 2026-07-20T11:10:00Z and 2026-07-20T11:30:00Z"
        status: pass
    human_judgment: false
  - id: D2
    description: "page-bridge-firefox.ts's shapeCredential() re-materializes response-direction binary fields as genuine MAIN-world ArrayBuffers; audit-mainworld-boundary.sh stays green; Chrome's twin file untouched; D-21 comment reflects reality"
    requirement: XBR-02
    verification:
      - kind: e2e
        ref: "bash scripts/audit-mainworld-boundary.sh (source + bundle-level, both browsers)"
        status: pass
      - kind: other
        ref: "cd extension && npx tsc --noEmit"
        status: pass
      - kind: e2e
        ref: "cd extension && npm run build:firefox && npm run build:chrome"
        status: pass
      - kind: unit
        ref: "cd extension && npm test (670/670 passing, 51 files -- pre-existing unrelated ServerConfigView.tsx unhandled rejection confirmed present, not caused by this change)"
        status: pass
      - kind: e2e
        ref: "real end-to-end create() ceremony via a genuinely inline <script> RP fixture (no WebDriver executeScript involved), .output/firefox-mv2, real Firefox 152.0.6 -- rawId/clientDataJSON/attestationObject instanceof ArrayBuffer all true, both pre-fix and post-fix"
        status: pass
    human_judgment: false

duration: 60min
completed: 2026-07-20
status: complete
---

# Phase 14 Plan 02: Firefox response-direction Xray re-materialization + a critical WebDriver-artifact correction Summary

**page-bridge-firefox.ts's shapeCredential() re-materializes every response-direction WebAuthn binary field as a genuine MAIN-world ArrayBuffer (mirroring the already-shipped REQUEST-direction fix), and a live-Firefox differential investigation discovered the bug motivating this task never actually existed in product code -- it was a `driver.executeScript(...).then(...)` WebDriver measurement artifact, proven via a real inline `<script>` fixture that shows correct `instanceof` behavior on BOTH the pre-fix and post-fix build.**

## Performance

- **Duration:** ~60 min
- **Completed:** 2026-07-20T13:24:19+02:00
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Task 1: built a throwaway, uncommitted differential-probe harness (standalone scratch WebExtension) mirroring content-relay.content.ts's postAck()/postToPage() RESPONSE-direction pattern, and ran it against real Firefox 152.0.6 to isolate two RESEARCH.md candidate variables (ack-timing, envelope sibling-field count) -- both ruled out (4/4 combinations showed `instanceof ArrayBuffer: true`)
- Task 1: built a second harness driving the REAL, unmodified `.output/firefox-mv2` extension end-to-end (fresh account registration via the real web-app RegisterForm UI, extension sign-in, real create() ceremony) to test the third candidate variable (standalone-vs-real-flow) -- reproduced and broadened the debug doc's own prior finding to 3 fields (`rawId`/`clientDataJSON`/`attestationObject`), all showing `instanceof: false` via the `executeScript`-based measurement, with data intact
- Recorded a dated, git-tracked Evidence entry (the debug doc's first-ever commit, satisfying the phase's record-hygiene requirement) concluding no SECURED/D-21 conflict was found -- fix path (a) cleared to proceed
- Task 2: implemented the MAIN-world re-materialization fix in page-bridge-firefox.ts (`b64UrlToArrayBuffer` + rewritten `shapeCredential()`), amended content-relay.content.ts's D-21 header comment, left page-bridge.content.ts (Chrome) untouched
- **While verifying Task 2's fix**, discovered via a targeted follow-up investigation (a plain non-extension sanity check, a same-`executeScript`-call deferred-continuation check, and a genuinely inline `<script>` RP fixture with zero WebDriver involvement) that the `instanceof: false` signal driving this entire task was an artifact of the `driver.executeScript(...).then(...)` measurement pattern itself -- it reproduces for ANY value crossing an `executeScript` call boundary, even a 100%-native, zero-extension-involvement `ArrayBuffer`. A real RP page's own inline/bundled JS correctly sees `instanceof: true` for every response-direction field, both BEFORE and AFTER this task's fix.
- Recorded this critical correction as a second dated Evidence entry, and kept the fix as harmless, architecture-symmetric defense-in-depth rather than reverting it (Task 1's SECURED/D-21 gate already cleared it; zero regressions)

## Task Commits

1. **Task 1: Live-Firefox differential root-cause probe (diagnostic only, no fix code)** - `933420d` (docs)
2. **Task 2: MAIN-world response-direction re-materialization fix** - `7e75fa6` (feat)

_Note: Task 2's commit also carries the second, mid-task-discovered Evidence entry (the WebDriver-artifact correction), since it was found during Task 2's own verification work and the plan's `files_modified` frontmatter lists the debug doc as shared across both tasks._

## Files Created/Modified

- `extension/entrypoints/page-bridge-firefox.ts` - new local `b64UrlToArrayBuffer()`; rewritten `shapeCredential()` re-materializing response-direction binary fields from `credentialJson`'s base64url string form
- `extension/entrypoints/content-relay.content.ts` - amended D-21 ownership header comment (no logic change, `decodeCredentialResponseJson` itself untouched)
- `.planning/debug/firefox-request-xray-hole.md` - two new git-tracked Evidence entries (2026-07-20T11:10:00Z: Task 1's three-variable differential probe; 2026-07-20T11:30:00Z: the WebDriver-executeScript-artifact correction discovered during Task 2)

## Decisions Made

- **Ruled out ack-timing and envelope-shape as candidate variables** (Task 1) via a real-Firefox standalone probe testing all 4 combinations -- all clean (`instanceof: true`), confirming/extending the debug doc's own prior "envelope shape ruled out" finding to also rule out ack-timing.
- **Fix path (a) (MAIN-world re-materialization) chosen and implemented**, per CONTEXT.md's stated preference and Task 1's "no SECURED/D-21 conflict found" determination.
- **Kept the Task 2 fix despite discovering the underlying bug was a measurement artifact.** Rationale: (1) it was already cleared by Task 1's SECURED/D-21 gate before the artifact was discovered, so no re-review is needed; (2) it is architecture-symmetric with the already-shipped REQUEST-direction fix, avoiding an asymmetric codebase; (3) it removes a latent dependency on `window.postMessage`'s cross-realm structured-clone behavior continuing to preserve `ArrayBuffer` identity across future Firefox versions, which is a genuine (if currently dormant) risk; (4) reverting would require re-litigating whether to revert Task 1's own now-partially-superseded evidence framing, adding scope without benefit since the fix itself causes zero regressions.
- **Documented the WebDriver-executeScript-artifact finding prominently** in the debug doc rather than silently absorbing it, per the phase's "verified live, not inferred" discipline -- this is directly relevant to Plan 14-03's phase-closing gate suite and to any future Firefox cross-realm debug session using this project's own harnesses.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Environment bootstrap not covered by the plan's own read_first/action text**
- **Found during:** Task 1 setup
- **Issue:** Fresh worktree had no `extension/node_modules`, no `.output/firefox-mv2` build, no `data/` directory for pv-server's SQLite DB, and pv-server was not running. The plan's `<environment_notes>` (orchestrator-provided) already anticipated most of this, but pv-server additionally needed `PV_STATIC_DIR` (a full `web/` static export) and `PV_EXTENSION_ORIGINS=moz-extension://*` to support the real end-to-end account-registration + sign-in flow Task 1's variable-(b) probe required.
- **Fix:** `npm install` in `extension/` and `web/`; `bash scripts/build-wasm.sh`; `npm run build:firefox`/`build:chrome`; `npm run build` in `web/` (static export to `web/out`); `mkdir data`; started `pv-server` with `PV_STATIC_DIR`/`PV_EXTENSION_ORIGINS` set.
- **Files modified:** None (build artifacts only, all gitignored: `node_modules/`, `.output/`, `web/out/`, `data/`).
- **Verification:** `curl http://localhost:8620/healthz` returned `{"status":"ok"}`; real account registration via the web-app RegisterForm UI succeeded.

**2. [Rule 3 - Blocking] `driver.installAddon`'s content script silently never ran on the scratch probe extension**
- **Found during:** Task 1, building the standalone differential-probe harness
- **Issue:** The throwaway scratch WebExtension's `content_scripts.matches: ["http://localhost:8899/*"]` never fired on real Firefox 152.0.6, despite the addon installing successfully (confirmed via `about:debugging`) -- no product code was involved, this was a scratch-harness-only match-pattern quirk.
- **Fix:** Changed the scratch extension's `matches` to `<all_urls>` (mirroring the real product's own `content_scripts.matches` value) -- content script then ran correctly.
- **Files modified:** None (scratch extension lives entirely under the session scratchpad directory, never git-tracked).
- **Verification:** `document.documentElement.dataset.probeIsolatedRan` marker confirmed present after the fix.

### Major Discovery (not an auto-fix -- see "Decisions Made" above for full rationale)

**A genuine WebDriver/geckodriver measurement artifact, discovered while verifying Task 2's fix, retroactively reframes the debug doc's own 01:00:00Z Evidence entry and Task 1's own variable-(b) finding.** This is not a deviation from the plan's instructions (Task 1 and Task 2 were both executed exactly as specified) -- it is a substantive empirical correction to the evidence those tasks produced, discovered through the plan's own mandated "verify the fix actually works" step. Full detail in the debug doc's 2026-07-20T11:30:00Z Evidence entry.

---

**Total deviations:** 2 auto-fixed (both Rule 3, environment/tooling blockers) + 1 major evidentiary discovery (not a deviation from plan instructions, but material to interpreting this plan's own evidence).
**Impact on plan:** Both auto-fixes were necessary environment bootstrapping with zero source-file impact. The evidentiary discovery does not change any deliverable (the fix ships as planned) but substantially changes how Task 1's own evidence should be read going forward -- documented prominently rather than silently absorbed.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 14-03 (phase-closing gate suite) can proceed. It should be aware that `probe-request-xray.cjs`'s existing `cred.rawId instanceof ArrayBuffer` diagnostics (if any are added there) are subject to the WebDriver-executeScript artifact documented in this plan's Evidence entries -- any NEW instanceof-based Firefox regression assertion added in 14-03 should use a same-`executeScript`-call deferred continuation or a genuine inline `<script>` fixture, not a cross-call `driver.executeScript(...).then(...)` pattern, to avoid a false-negative gate.
- Plan 14-03 owns moving `.planning/debug/firefox-request-xray-hole.md` to `.planning/debug/resolved/` and writing its final Resolution section -- this plan's two new Evidence entries (11:10:00Z, 11:30:00Z) are ready to be cited there. The D-21 header comment in content-relay.content.ts already references the eventual `resolved/` path per the plan's own instruction.
- No blockers.

---
*Phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica*
*Completed: 2026-07-20*
