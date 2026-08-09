---
phase: 27-extension-integration-shared-items
plan: 16
subsystem: extension-crypto
tags: [wasm-bindgen, x25519, real-wasm-test, playwright, uat, verification-closure]

requires:
  - phase: 27-extension-integration-shared-items
    provides: "identity-store.ts's ensureOwnIdentityKeypair (27-03) and the real-WASM test harness pattern (identity-store.real-wasm.test.ts) this plan adds a test to"
provides:
  - "Real-WASM regression coverage for identity-store.ts's adopted_existing concurrent-first-unlock race branch (KEY-01 A-3/A-4), falsification-tested"
  - "Live UAT screenshots for 27-VERIFICATION.md's two remaining visual-taste human-verification items (shared-badge.png, broken-row.png) at .playwright-mcp/uat-27/"
  - "27-VERIFICATION.md's human_verification frontmatter/body reconciled: item 3 closed, items 1/2 evidenced"
  - "ROADMAP.md Phase 27 bookkeeping reconciled (checkbox + table row + completion date); STATE.md records the phantom-pending-row follow-up for a future phase"
affects: []

tech-stack:
  added: []
  patterns:
    - "Live UAT evidence capture: corrupt a real shared item's ciphertext directly in data/pv.db (one AEAD byte, same technique as vault-store.real-wasm.test.ts's corruptEncData), force a cold client resync via sign-out/sign-in (resets vault-store.ts's in-memory collectionRevisionWatermark), screenshot the resulting live state, restore and verify the DB byte-identical in a try/finally"

key-files:
  created: []
  modified:
    - extension/entrypoints/background/identity-store.real-wasm.test.ts
    - .planning/phases/27-extension-integration-shared-items/27-VERIFICATION.md
    - .planning/ROADMAP.md
    - .planning/STATE.md

key-decisions:
  - "Closed the adopted_existing coverage gap with a real-WASM test rather than a mocked one: the whole point of the gap was that no test exercised the genuine WASM handle-lifetime contract (freeOnError staying true on this specific branch), which a mock could trivially get right by accident."
  - "Did not use deferRealFree() for the test's 'winner' keypair handle -- unlike vault-store.real-wasm.test.ts's shared-handle scenario, nothing in production ever calls .free() on the winner's WasmIdentityKey directly here (only its wrapped/public wire values cross the mocked network boundary), so a plain single free at test end is correct and simpler."
  - "Screenshots committed into .playwright-mcp/uat-27/ (project root, as instructed) rather than under .planning/ -- this project has precedent for committing UAT screenshots (.planning/milestones/v0.2-phases/11-generate-capture/uat-screenshots/), but this task's own instructions named the specific target directory explicitly."
  - "Marked Phase 27 'Complete' in ROADMAP.md (checkbox + table date) despite 27-VERIFICATION.md's own status still being human_needed for 2 items -- both are visual-taste judgments requiring Bartek, not blockers on execution/plan completion, and the verifier's own anti-pattern sweep explicitly flagged the stale 'In Progress' text as the bookkeeping error to fix, not the human_needed status itself."
  - "Did NOT attempt to fabricate the optional third (pending-skeleton) screenshot. Tried live capture at several delays and again under CDP network throttling (800ms latency); the real Collection-Key resolution window stayed sub-visible on this local single-machine harness. Documented the attempt and the reason it was skipped rather than substituting a mocked/component-test render, per this task's explicit instruction."

patterns-established: []

requirements-completed: []

coverage:
  - id: D1
    description: "Real-WASM test proves identity-store.ts's adopted_existing concurrent-first-unlock race branch adopts the server's already-published keypair instead of overwriting it (byte-identical public key before/after, discarded local candidate freed exactly once, no second publish)"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "extension/entrypoints/background/identity-store.real-wasm.test.ts#concurrent first-unlock race: adopts the server's already-published keypair instead of overwriting it"
        status: pass
    human_judgment: false
  - id: D2
    description: "Live UAT screenshot: shared-badge visual quality (badged shared rows directly beside unbadged personal rows, 380px popup width)"
    verification:
      - kind: automated_ui
        ref: "playwright:.playwright-mcp/uat-27/shared-badge.png"
        status: pass
    human_judgment: true
    rationale: "Visual/taste judgment (ROADMAP SC 5) -- component tests assert markup, not legibility. Screenshot captured as evidence; Bartek makes the actual call."
  - id: D3
    description: "Live UAT screenshot: broken-row legibility and copy (a real shared item's ciphertext genuinely corrupted, restored afterward)"
    verification:
      - kind: automated_ui
        ref: "playwright:.playwright-mcp/uat-27/broken-row.png"
        status: pass
    human_judgment: true
    rationale: "Row legibility and PL/EN wording are taste calls; ItemListView.test.tsx Test 20 asserts markup/non-interactivity only. Screenshot captured as evidence; Bartek makes the actual call."

duration: ~55min
completed: 2026-08-09
status: complete
---

# Phase 27 Plan 16: Close Remaining Human-Verification Items Summary

**Closed 27-VERIFICATION.md's last functional gap with a falsification-tested real-WASM test (identity-store.ts's `adopted_existing` concurrent-first-unlock race), captured live UAT screenshots for the two remaining visual-taste items instead of self-approving them, and reconciled Phase 27's stale ROADMAP.md/STATE.md bookkeeping.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-08-09T13:45Z (approx, session start)
- **Completed:** 2026-08-09T14:10Z
- **Tasks:** 3 (functional gap closure, UAT screenshots + report closure, housekeeping)
- **Files modified:** 6 (1 test file, 2 screenshots added, 3 planning docs)

## Accomplishments

- `identity-store.real-wasm.test.ts` gained a real-WASM test for `ensureOwnIdentityKeypair`'s `adopted_existing` branch — the concurrent first-unlock race resolution mechanism that every prior fixture in this file left untested (`adopted_existing: false` in all three original fixtures). The new test simulates the server already holding a published keypair at publish time and asserts the losing client adopts that exact keypair (byte-identical public key before/after) rather than overwriting it, and that the discarded local candidate is freed exactly once.
- Falsification-tested per this project's standard: disabling the adopt branch (`if (response.adopted_existing)` short-circuited false) turned the new test RED for the right reason (public-key mismatch — the losing client's own overwritten candidate, not the winner's); reverted cleanly (`git diff` empty on the source file); re-verified green.
- Baseline held: 768/768 unit tests (was 767, +1 for the new test), `tsc --noEmit` clean, `cargo test --workspace` 0 failed.
- Captured two live UAT screenshots via the existing two-extension Playwright harness against a running `pv-server` (`PV_STATIC_DIR=web/out`, `PV_EXTENSION_ORIGINS=chrome-extension://*`): `shared-badge.png` (a search-filtered popup view at 380px width showing badged shared rows directly beside unbadged personal rows for direct comparison) and `broken-row.png` (a real shared TOTP item's ciphertext corrupted by one AEAD byte directly in `data/pv.db`, forcing a genuine "Failed to decrypt shared item" row, then restored and verified byte-identical).
- Attempted a third, optional pending-skeleton screenshot (including under CDP-throttled network) but could not reliably capture it live — the real Collection-Key resolution window proved too narrow on this single-machine harness. Documented as skipped rather than faked.
- `27-VERIFICATION.md` updated: human-verification item 3 (`adopted_existing`) marked CLOSED and removed from the `human_verification` frontmatter array (the array GSD tooling reads as the open-items source of truth); items 1 and 2 retained with `evidence` fields pointing at the new screenshots, explicitly marked "NOT self-approved."
- `ROADMAP.md`'s Phase 27 checkbox and summary-table row (stale "In Progress" with a blank date, flagged by the verifier's own anti-pattern sweep) reconciled to "Complete" with the actual completion date.
- `STATE.md`'s Blockers/Concerns gained the verifier's open, non-blocking warning: `pendingSharedItems` stubs are never pruned on an individual (non-collection-revocation) unshare/revoke, leaving a phantom "Failed to decrypt" row until the next lock — pre-existing from 27-04/27-12, extended (not introduced) by 27-15/27-16, leaks nothing.

## Task Commits

Each task was committed atomically:

1. **Task A: real-WASM test for identity-store.ts's `adopted_existing` race** - `355f447` (test)
2. **Task B: close human-verification item 3 + attach UAT screenshot evidence for items 1/2** - `59ff66a` (docs)
3. **Task C: reconcile ROADMAP.md/STATE.md Phase 27 bookkeeping** - `aa7babc` (docs)

## Files Created/Modified

- `extension/entrypoints/background/identity-store.real-wasm.test.ts` - new test proving the `adopted_existing` race-resolution branch
- `.playwright-mcp/uat-27/shared-badge.png` - live evidence for human-verification item 1
- `.playwright-mcp/uat-27/broken-row.png` - live evidence for human-verification item 2
- `.planning/phases/27-extension-integration-shared-items/27-VERIFICATION.md` - human_verification section updated (item 3 closed, items 1/2 evidenced)
- `.planning/ROADMAP.md` - Phase 27 checkbox/table row reconciled to Complete
- `.planning/STATE.md` - Current Position updated; phantom-pending-row follow-up recorded in Blockers/Concerns

## Decisions Made

See `key-decisions` in frontmatter above.

## Deviations from Plan

None — this was a direct, scoped quick task (not a PLAN.md), executed exactly per its own objective: close the one real functional gap with a test, capture (not self-approve) the two taste-judgment screenshots, and do the two named housekeeping reconciliations.

## Issues Encountered

- The extension popup's search input is `type="text"` (not `type="search"`), which initially caused a `.fill()` call to hang against a zero-match locator until the outer test timeout — fixed by using the same multi-selector pattern (`input[type="search"], input[placeholder*="zukaj"], input[placeholder*="earch"]`) already established in `dual-browser.spec.ts`.
- `Locator.toBeVisible()` only checks CSS visibility, not scroll position — an early attempt at `broken-row.png` passed its assertion but screenshotted an unrelated, unscrolled part of the (long, "Last used"-sorted, multi-run-accumulated) item list. Fixed with an explicit `scrollIntoViewIfNeeded()` before the screenshot.
- Playwright's `context.newCDPSession()` (v1.61.1, this project's pinned version) only accepts a `Page`/`Frame`, not a `Worker` — the attempted service-worker-level network-throttling approach for the pending-skeleton screenshot could not attach a CDP session to the background service worker directly; abandoned in favor of documenting the miss.
- A throwaway Playwright spec (`extension/e2e/uat-27-16-screenshots.spec.ts`) was used to drive the live captures and deleted afterward — it was scaffolding for this task's own evidence gathering, not a requested or committed deliverable.

## User Setup Required

None - no external service configuration required. (A local `pv-server` was already running with this phase's standing live-harness recipe, `PV_STATIC_DIR=web/out` / `PV_EXTENSION_ORIGINS=chrome-extension://*`, reused as-is.)

## Next Phase Readiness

- Phase 27 is now fully execution-complete with only two visual-taste human-verification items remaining, both evidenced with live screenshots at `.playwright-mcp/uat-27/` — Bartek can judge them in seconds without reproducing the live state himself.
- The phantom-pending-row follow-up (recorded in STATE.md's Blockers/Concerns) is non-blocking, leaks nothing, and is scoped as a future-phase fix (prune `pendingSharedItems` alongside where `directSharedItems`/`collectionSharedItems` are replaced).
- No blockers.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-09*

## Self-Check: PASSED

All 6 created/modified files (test file, 2 screenshots, 27-VERIFICATION.md, ROADMAP.md, STATE.md) and this SUMMARY.md itself were verified present on disk; all 3 task commit hashes (`355f447`, `59ff66a`, `aa7babc`) were verified present in `git log --oneline --all`.
