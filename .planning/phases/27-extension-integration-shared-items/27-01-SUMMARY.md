---
phase: 27-extension-integration-shared-items
plan: 01
subsystem: testing
tags: [playwright, chromium, e2e, extension, fixtures, worker-fixtures]

requires: []
provides:
  - "extension/e2e/two-context-spike.spec.ts — permanent regression proving two chromium.launchPersistentContext(\"\", ...) calls in one worker produce genuinely independent profiles (storage.local isolation), and documenting that unpacked-extension ids are deterministic-by-path, not per-profile"
  - "extContextB/extensionIdB worker-scoped fixtures in extension/e2e/fixtures.ts, mirror-shaped to extContext/extensionId"
affects: [27-04, 27-05, 27-06, 27-11]

tech-stack:
  added: []
  patterns:
    - "Second worker-scoped persistent-context/extension-id fixture pair, kept additive (not refactored into a shared helper) so the two pairs diff line-for-line"

key-files:
  created:
    - extension/e2e/two-context-spike.spec.ts
  modified:
    - extension/e2e/fixtures.ts

key-decisions:
  - "Corrected the plan's assumption that two persistent contexts loading the identical unpacked-extension path would resolve to DIFFERENT extension ids — a real run showed Chromium derives an unpacked extension's id deterministically from the absolute --load-extension path (no manifest \"key\"), so both contexts get the SAME id. The test now asserts EQUAL ids as a documented, locked-in regression guard, and relies on the storage-isolation assertion (Fact 3) as the actual, load-bearing proof of profile independence."

patterns-established:
  - "extContextB/extensionIdB: byte-identical launch shape to extContext/extensionId, so later plans importing 'member B' never re-derive the launch-arg/headed-detection logic"

requirements-completed: [EXT-07]

coverage:
  - id: D1
    description: "Two chromium.launchPersistentContext(\"\", ...) calls in the same worker process produce genuinely independent browser profiles (storage.local written in context A is absent in context B)"
    requirement: "EXT-07"
    verification:
      - kind: e2e
        ref: "extension/e2e/two-context-spike.spec.ts#two chromium.launchPersistentContext(\"\", ...) calls in one worker produce genuinely independent profiles"
        status: pass
    human_judgment: false
  - id: D2
    description: "extContextB/extensionIdB worker-scoped fixtures exist in fixtures.ts with the identical launch shape as extContext/extensionId, ready for later plans to import"
    requirement: "EXT-07"
    verification:
      - kind: unit
        ref: "cd extension && npx tsc --noEmit (clean, including a throwaway consumer test destructuring all four fixtures, deleted after confirming)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 01: Two-Context Spike & extContextB/extensionIdB Fixtures Summary

**Proved two `chromium.launchPersistentContext("", ...)` calls in one Playwright worker yield genuinely independent profiles (storage-isolated), and landed the reusable `extContextB`/`extensionIdB` worker fixtures for later live two-extension proofs.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-08-08
- **Tasks:** 2/2 completed
- **Files modified:** 2 (1 new, 1 modified)

## Accomplishments

- Closed 27-RESEARCH.md Open Question 2 with a real Playwright run, not an assumption: two `launchPersistentContext("", ...)` calls issued in the same worker process do NOT collide on the empty user-data-dir argument — each gets its own independent Chromium profile.
- The concrete isolation property later plans depend on (member A vs member B never sharing state) is proven via `chrome.storage.local` presence-then-absence, not a vacuous "no throw" pass.
- Landed `extContextB`/`extensionIdB` as mirror-shaped worker fixtures in `fixtures.ts`, ready for 27-04/27-05/27-06/27-11 to import directly.
- Discovered and documented a real Chromium behavior that corrected one of the plan's assumptions (see Deviations below): unpacked-extension ids loaded via `--load-extension` are deterministic-by-path, not randomly assigned per profile/install.

## Task Commits

Each task was committed atomically:

1. **Task 1: Spike — prove two persistent-context profiles are genuinely independent** - `aeea92e` (test)
2. **Task 2: Land the reusable extContextB/extensionIdB worker fixtures** - `f87122a` (feat)

**Plan metadata:** (this commit) `docs(27-01): complete extension-integration-shared-items plan`

## Files Created/Modified

- `extension/e2e/two-context-spike.spec.ts` - New permanent regression spec: launches two persistent contexts loading the identical extension build in one test, asserts (1) each resolves a real `chrome-extension://` service-worker URL, (2) both resolve to the SAME deterministic extension id (documented finding, not a bug), (3) a storage.local marker written in context A is absent when read from context B.
- `extension/e2e/fixtures.ts` - Added `extContextB`/`extensionIdB` to `ExtWorkerFixtures` and two new worker-scoped fixture entries, byte-identical launch shape to the existing `extContext`/`extensionId` pair (same `EXTENSION_PATH`, same headed-by-project-name detection, same `serviceWorkers()`/`waitForEvent("serviceworker")` resolution). Kept additive, not refactored into a shared helper.

## Decisions Made

- Kept the two fixture pairs (`extContext`/`extensionId` and `extContextB`/`extensionIdB`) as literal mirror-shaped duplicates rather than extracting a shared helper, per the plan's explicit instruction — a future reader can diff the two pairs line-for-line, and a shared-helper refactor is left as an explicit out-of-scope follow-up.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected a factually wrong test assertion (extension-id difference) discovered by running the spike for real**
- **Found during:** Task 1
- **Issue:** The plan's `<action>` instructed asserting that the two contexts' extension ids are DIFFERENT strings as proof of profile independence. Running the spike for real showed both contexts resolve to the IDENTICAL extension id (`nehogfjonkpoicdoheenhponkjknphna` in the observed run) — Chromium derives an unpacked extension's id deterministically from a hash of the absolute `--load-extension` path when the manifest has no `"key"` field, not randomly per profile. Asserting inequality here would make the test permanently fail on a false premise, not on a real regression.
- **Fix:** Changed the assertion to expect EQUAL ids, with an inline comment explaining why this is documented, verified Chromium behavior rather than evidence of shared/colliding profiles. Re-pointed the plan's must-have language ("proving two distinct profile-scoped extension instances") onto the assertion that actually carries that proof — the storage-isolation check (Fact 3), which independently confirmed presence-then-absence across the two contexts despite the identical extension id.
- **Files modified:** `extension/e2e/two-context-spike.spec.ts`
- **Verification:** `cd extension && npm run pretest:e2e:chrome && npx playwright test --project=chromium e2e/two-context-spike.spec.ts` — 1 passed. Verified this was not an environment fluke by temporarily disabling the (then-wrong) inequality assertion and re-running to confirm the storage-isolation assertions passed independently before rewriting the test.
- **Committed in:** `aeea92e` (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in a plan-specified test assertion, corrected against real observed browser behavior)
**Impact on plan:** No scope creep. The plan's actual must-have truth (storage isolation proving profile independence) was verified exactly as written and passes cleanly; only the supporting extension-id-difference check needed correction to match reality. This finding is now documented inline in the permanent regression spec so it does not need rediscovery by 27-04 onward.

## Issues Encountered

None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `extContextB`/`extensionIdB` are live in `extension/e2e/fixtures.ts` and type-check cleanly as a `test.extend` consumer pair — 27-04, 27-05, 27-06, and 27-11 can import them directly without re-deriving the launch/headed-detection logic.
- The two-context harness's core risk (profile collision) is closed with real evidence, not an assumption — Wave 2's tracer can build its live two-extension proof on solid ground.
- One thing for 27-04 onward to carry forward: do NOT use extension-id equality/inequality as a signal for "is this the same browser profile" anywhere in later live-proof specs — it is not a valid proxy (both contexts always resolve to the same id when loading the identical unpacked-extension path). Use a `chrome.storage.local`/`chrome.storage.session` marker instead, as this spike does.
- No blockers or concerns for the next plan in this wave (27-02, which also touches `extension/e2e/fixtures.ts` — the diff here is purely additive, so a rebase/merge onto this state should be conflict-free as long as 27-02 does not also touch the `extensionId` fixture entry).

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*

## Self-Check: PASSED

- FOUND: extension/e2e/two-context-spike.spec.ts
- FOUND: extension/e2e/fixtures.ts
- FOUND: .planning/phases/27-extension-integration-shared-items/27-01-SUMMARY.md
- FOUND commit: aeea92e
- FOUND commit: f87122a
