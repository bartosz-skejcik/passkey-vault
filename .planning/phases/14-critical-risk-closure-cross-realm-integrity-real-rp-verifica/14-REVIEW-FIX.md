---
phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
fixed_at: 2026-07-20T12:20:58Z
review_path: .planning/phases/14-critical-risk-closure-cross-realm-integrity-real-rp-verifica/14-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 14: Code Review Fix Report

**Fixed at:** 2026-07-20T12:20:58Z
**Source review:** .planning/phases/14-critical-risk-closure-cross-realm-integrity-real-rp-verifica/14-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (Warning — `fix_scope: critical_warning`; 0 Critical findings existed; the 3 Info findings were out of scope)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: probe-request-xray.cjs exits 0 even when its own gates record FAIL

**Files modified:** `extension/e2e-firefox/probe-request-xray.cjs`
**Commit:** af3f375
**Applied fix:** The `require.main === module` runner block at the end of the file now aggregates `results` after quitting the driver and closing the form server: it filters for any entry with `status === 'FAIL'`, logs the failing gate IDs to `console.error`, and calls `process.exit(1)` if any exist, otherwise `process.exit(0)`. Matches the reviewer's suggested fix verbatim (the code context was unchanged from the review). The results-JSON and screenshot outputs, and everything the rows measure, are untouched — only the final exit-code computation was added. `run-core.cjs`'s pre-existing identical pattern was left alone per the finding's own scoping ("pre-existing there and out of this phase's diff").

### WR-02: probe response-direction `*IsArrayBuffer` gate does not actually guard the fix it claims to

**Files modified:** `extension/e2e-firefox/probe-request-xray.cjs`
**Commit:** 17550cd
**Applied fix:** Took the reviewer's recommended "pragmatic path" — softened the header comment's claims rather than changing the check itself (the check remains exactly as-is; this is a documentation-only fix). Two header blocks were corrected:
1. The "RESPONSE direction" paragraph (was: "FULLY RESOLVED, hard-gated below") now states this is an end-to-end delivery/round-trip check on real Firefox, not a discriminating regression guard, explains that a genuine inline-`<script>` RP page observes `instanceof ArrayBuffer: true` even without `shapeCredential()`'s re-materialization (so the gate would still pass if the fix were reverted), and points to the deterministic jsdom test (`extension/entrypoints/__tests__/page-bridge-firefox.test.ts`'s `crossRealmArrayBuffer` helper) as the authoritative regression guard.
2. The "kept here PERMANENTLY" paragraph (was: "hard-gates response-direction realm identity for every binary field") now says the probe "checks the end-to-end delivery of every response-direction binary field," with a cross-reference to the corrected RESPONSE direction note above.

No test/gate logic changed — only the two header comment blocks describing what the `*IsArrayBuffer` checks prove.

## Skipped Issues

None — both in-scope findings were fixed.

---

_Fixed: 2026-07-20T12:20:58Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
