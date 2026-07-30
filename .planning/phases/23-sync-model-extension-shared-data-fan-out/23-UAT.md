---
status: testing
phase: 23-sync-model-extension-shared-data-fan-out
source: [23-VERIFICATION.md]
started: 2026-07-30
updated: 2026-07-30
---

## Current Test

number: 1
name: Confirm the `web-e2e` Playwright job is genuinely blocking in CI
expected: |
  On the next push, `.github/workflows/ci.yml`'s `web-e2e` job runs on the
  push/pull_request trigger, has no `continue-on-error` and no manual gate,
  and is capable of failing the workflow.
awaiting: user response

## Tests

### 1. `web-e2e` is genuinely blocking in CI
expected: web-e2e runs on push/pull_request, no continue-on-error, no workflow_dispatch-only gate; a deliberate failure would redden the run.
result: [pending]
note: |
  Static inspection already confirms no `continue-on-error` and no manual-only
  gate, and the suite itself is confirmed green locally (3/3). This item is
  about TRIGGER WIRING in this repo's runner environment, not test health —
  only an actual CI run can prove it. It requires a push.

  This is the first Playwright suite ever wired into this repo's CI (the
  extension's own 21-SC suite has never run there), which is why observing
  the first real run matters.

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
passed: 1
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
