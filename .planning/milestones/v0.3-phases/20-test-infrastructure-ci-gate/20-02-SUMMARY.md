---
phase: 20-test-infrastructure-ci-gate
plan: 02
subsystem: testing
tags: [npm-scripts, e2e-firefox, documentation, csp, regression-gate]

# Dependency graph
requires:
  - phase: 14-provider-hardening
    provides: probe-request-xray.cjs (XBR-02 regression gate)
  - phase: 18-window-geometry
    provides: probe-window-geometry.cjs (already had an npm script, missing from README)
provides:
  - npm scripts test:e2e:firefox:request-xray and test:e2e:firefox:provider-corruption (plus matching pretest:* build hooks)
  - README "## Running" section documenting all 6 real-Firefox harness lanes
  - Explicit CSP-strict coverage disposition note (no dedicated lane; covered inside core + request-xray lanes)
affects: [20-03, ci-gate-plans]

# Tech tracking
tech-stack:
  added: []
  patterns: ["npm script + pretest:* build-hook pairing for real-Firefox probes (mirrors existing 4-lane pattern)"]

key-files:
  created: []
  modified:
    - extension/package.json
    - extension/e2e-firefox/README.md

key-decisions:
  - "No dedicated csp-strict npm script was added — verified via live-tree grep that no standalone CSP probe file exists; CSP-strict assertions live inside run-core.cjs and probe-request-xray.cjs, so the disposition is documented in README prose instead of wiring a dead script."

patterns-established:
  - "Real-Firefox probe files always get both a test:e2e:firefox:<name> script and a pretest:e2e:firefox:<name> = 'wxt build -b firefox' hook, plus a one-line entry in e2e-firefox/README.md's ## Running section — no probe should be reachable only by a hand-typed node invocation."

requirements-completed: [QA-02]

coverage:
  - id: D1
    description: "extension/package.json gains test:e2e:firefox:request-xray and test:e2e:firefox:provider-corruption npm scripts with matching pretest:* build hooks"
    requirement: "QA-02"
    verification:
      - kind: unit
        ref: "node -e check for all 4 script keys present in extension/package.json"
        status: pass
      - kind: other
        ref: "node -e require('./extension/package.json') succeeds (valid JSON)"
        status: pass
    human_judgment: false
  - id: D2
    description: "README's ## Running section documents all 6 lanes (core, autofill, server-unlock, window-geometry, request-xray, provider-corruption) plus a CSP-strict coverage disposition note"
    requirement: "QA-02"
    verification:
      - kind: other
        ref: "awk-scoped grep of fenced command block counts 6 'npm run test:e2e:firefox:' lines"
        status: pass
      - kind: other
        ref: "grep -c 'CSP-strict coverage' extension/e2e-firefox/README.md returns 1"
        status: pass
    human_judgment: false

# Metrics
duration: 6min
completed: 2026-07-21
status: complete
---

# Phase 20 Plan 02: Wire Orphan Probes + Document 6 Firefox Lanes Summary

**Added npm scripts for probe-request-xray.cjs and probe-provider-corruption.cjs (previously reachable only by hand-typed node invocations), and extended e2e-firefox/README.md's "## Running" section to document all 6 real-Firefox harness lanes plus an explicit CSP-strict coverage disposition note.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-07-21T13:21:00Z
- **Completed:** 2026-07-21T13:27:43Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `extension/package.json` gained `test:e2e:firefox:request-xray` / `test:e2e:firefox:provider-corruption` npm scripts and matching `pretest:e2e:firefox:*` build hooks (`wxt build -b firefox`), mirroring the existing 4-lane pattern exactly
- `extension/e2e-firefox/README.md`'s "## Running" fenced command block now lists all 6 lanes (core, autofill, server-unlock, window-geometry, request-xray, provider-corruption), each with a one-line phase/purpose comment
- Added a "CSP-strict coverage" paragraph immediately after the command block, citing `run-core.cjs:397-454` (`CSP-STRICT-SHIM-PRESENT`/`CSP-STRICT-CREATE`) and `probe-request-xray.cjs:439-450` (`SHIM-PRESENT`) as the two lanes that genuinely exercise CSP-strict coverage against a real `/provider-csp` fixture — explicitly stating no dedicated `csp-strict` script exists or is needed

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire probe-request-xray.cjs and probe-provider-corruption.cjs to npm scripts** - `ed5cca9` (feat)
2. **Task 2: Document all 6 Firefox harness lanes in README's "## Running" section, plus the CSP-strict coverage disposition** - `2dbae88` (docs)

_Note: no TDD tasks in this plan (npm-script + README-only changes)._

## Files Created/Modified
- `extension/package.json` - Added 2 npm scripts + 2 matching pretest hooks for the two previously-orphan probe files
- `extension/e2e-firefox/README.md` - Extended "## Running" section to 6 lanes + new CSP-strict coverage disposition paragraph

## Decisions Made
- No dedicated `csp-strict` npm script was wired for a probe file that doesn't exist. Per the plan's pre-resolved plan-checker blocker, `grep -rni "csp" extension/e2e-firefox/` confirms CSP-strict assertions live inside `run-core.cjs` and `probe-request-xray.cjs` as part of those lanes' own ceremonies — documenting this disposition in README prose (rather than inventing a dead script) is the correct fix per the plan's explicit instruction.

## Deviations from Plan

None - plan executed exactly as written. Both tasks' acceptance criteria and verify commands passed on first attempt with no auto-fixes needed.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. This plan does not add any executable test invocations to CI; running the new npm scripts still requires a live `pv-server` with the concrete `PV_EXTENSION_ORIGINS` UUIDs documented in the README's Prerequisites section (covered by a later plan's live-proof task, per this plan's Task 1 `<done>` note).

## Next Phase Readiness
- All 6 real-Firefox harness lanes are now wired to npm scripts and documented in README — closes QA-02's "orphan probe" gap for `probe-request-xray.cjs` and `probe-provider-corruption.cjs`, and closes the missing-from-README gap for `probe-window-geometry.cjs`
- CSP-strict coverage (named in SC#2/QA-02) is now visible via an explicit disposition note rather than an invisible/implicit gap
- No blockers for downstream plans (e.g., 20-03's live-proof task, which will actually execute these npm scripts against a running server)

---
*Phase: 20-test-infrastructure-ci-gate*
*Completed: 2026-07-21*

## Self-Check: PASSED

- FOUND: extension/package.json
- FOUND: extension/e2e-firefox/README.md
- FOUND: .planning/phases/20-test-infrastructure-ci-gate/20-02-SUMMARY.md
- FOUND: ed5cca9 (Task 1 commit)
- FOUND: 2dbae88 (Task 2 commit)
