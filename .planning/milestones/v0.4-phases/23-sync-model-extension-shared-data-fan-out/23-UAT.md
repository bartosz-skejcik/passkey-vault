---
status: passed
phase: 23-sync-model-extension-shared-data-fan-out
source: [23-VERIFICATION.md]
started: 2026-07-30
updated: 2026-07-31
---

## Current Test

number: —
name: —
expected: —
awaiting: nothing — all items resolved

## Tests

### 1. `web-e2e` is genuinely blocking in CI
expected: web-e2e runs on push/pull_request, no continue-on-error, no workflow_dispatch-only gate; a deliberate failure would redden the run.
result: PASSED — observed on GitHub Actions run 30584149151
note: |
  Resolved by direct observation of a real run, not by static inspection.

  The commit that closed Phase 23 (`85bc866` — "test(23): persist human
  verification items as UAT") was pushed to `origin/main` and triggered CI run
  **30584149151** (2026-07-30T21:37:51Z, event: `push`). Evidence pulled from
  the run itself:

  - `web-e2e` appears in the run's job list — it was NOT skipped:
    `started 21:37:53Z / completed 21:43:19Z / conclusion: success` (5m26s,
    versus the 1m29s whole-workflow runs that predate this job).
  - Its log shows the suite genuinely executing on the runner, not a no-op:
    `> playwright test` → `Running 3 tests using 1 worker` → `3 passed (2.3m)`.
  - `.github/workflows/ci.yml` triggers are `push` + `pull_request` (no
    `workflow_dispatch`-only gate), and the `web-e2e` job carries no
    `continue-on-error` on the job or on its `Test (Playwright e2e)` step — so
    a non-zero `npm run test:e2e` propagates to the job conclusion and reddens
    the workflow.

  Trigger wiring is therefore proven in this repo's actual runner environment,
  which is exactly what static inspection could not establish. This is also the
  first Playwright suite ever to run in this repo's CI.

  Two cache-service warnings appeared in the log (`Failed to restore: Cache
  service responded with 400`, `Failed to save: ... services aren't available`)
  — GitHub-side cache flakiness only. They cost wall-clock (cold
  `cargo build --release`) and did not affect the test result.

## Resolved by the orchestrator (recorded for audit)

### 2. Run the browser half of the SEC-08 harness — `cd web && npm run test:e2e`
expected: 3 passed
result: RESOLVED — 3/3 passing
note: |
  Executed rather than deferred. First run was 2 passed / 1 FAILED: the
  conflict-attribution spec asserted a `revision-conflict-banner` that the
  CR-03 fix had deliberately made unreachable (the fixture's DUMMY sealed key
  means B's write is necessarily undecryptable, which correctly trips the
  overwrite refusal before any 409 can occur). Spec corrected to assert the
  reachable, more important behavior — decrypt failure surfaced AND overwrite
  refused. Re-run 3/3 (commit `ce34bed`).

  Consequence recorded in 23-VERIFICATION.md: SC 3's LIVE BROWSER proof of
  conflict attribution is deferred to Phase 26, which is where the client-side
  Collection Key unwrap lands. SC 3 stays verified at the server layer
  (`tests/vault.rs`) and the client-unit layer (`DetailPanel.test.tsx`).

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
