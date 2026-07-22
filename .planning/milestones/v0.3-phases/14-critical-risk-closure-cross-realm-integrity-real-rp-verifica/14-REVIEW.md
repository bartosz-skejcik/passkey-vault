---
phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
reviewed: 2026-07-20T13:05:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - crates/pv-provider/Cargo.toml
  - crates/pv-provider/tests/real_rp_verification.rs
  - extension/e2e-firefox/probe-request-xray.cjs
  - extension/e2e-firefox/run-core.cjs
  - extension/entrypoints/__tests__/page-bridge-firefox.test.ts
  - extension/entrypoints/content-relay.content.ts
  - extension/entrypoints/page-bridge-firefox.ts
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-07-20T13:05:00Z
**Depth:** standard
**Status:** issues_found

## Summary

Iteration 2 of the fix loop. Prior review found 0 Critical / 2 Warning / 3 Info. Two fix commits were applied — `af3f375` (WR-01) and `17550cd` (WR-02) — both scoped to `extension/e2e-firefox/probe-request-xray.cjs` only (verified via `git diff --name-only af3f375~1 HEAD`). The other six in-scope files are byte-identical to iteration 1.

Both warnings are genuinely resolved and neither fix introduced a regression or new defect:

- **WR-01 — RESOLVED.** The runner (lines 545-550) now aggregates over the module-scoped `results` map, filters rows with `status === 'FAIL'`, prints the failing gate names, and `process.exit(1)` when any exist. The aggregation is sound: `record()` (lines 139-143) writes `{status, notes}` using only the `'PASS'`/`'FAIL'` literals the filter matches. Both classes of failure are now covered — the two throwing FAIL branches (lines 452, 502) reject `main()` and hit the `.catch → process.exit(1)`, and the four non-throwing FAIL branches (lines 463, 475, 511, 524) resolve normally and are caught by the new aggregation. No path can now record a FAIL yet exit 0. The success return shape `{ driver, formServer }` is unchanged, so the destructuring in the `.then` still holds.
- **WR-02 — RESOLVED.** The change is comment-only (header lines 29-43 and 80-87). It correctly re-labels the response-direction `*IsArrayBuffer` battery as an end-to-end delivery/round-trip check rather than a realm-identity regression guard, and explicitly names the deterministic jsdom test (`page-bridge-firefox.test.ts`'s `crossRealmArrayBuffer` helper) as the authoritative discriminating guard. No executable code, gate threshold, or capture logic was touched, so probe behavior is unchanged. Claim now matches reality.

SECURED constraints are intact: no changes to validation, nonce/replay/consent gates, D-03 (`location.origin`, never `'*'`), origin refusal, or key-material exposure. The production re-materialization path in `shapeCredential` and the genuine cross-vendor Rust test (`pv_provider_round_trip_verified_by_independent_webauthn_rs`) are unchanged from iteration 1 and remain sound (see iteration-1 verdict — no finding).

The three Info findings below are carried forward unchanged; none was made worse by the fix commits. No Critical or Warning findings remain.

## Info

### IN-01: RESPONSE_BINARY_FIELDS duplicated across two files with manual sync

**File:** `extension/entrypoints/page-bridge-firefox.ts:265` and `extension/entrypoints/content-relay.content.ts:616`
**Issue:** Both declare `["clientDataJSON", "attestationObject", "authenticatorData", "signature", "publicKey"]` independently and are kept in sync by hand (acknowledged in the comment at page-bridge-firefox.ts:261). A future binary field decoded in `content-relay` but not mirrored here would silently be delivered to the Firefox page as an ISOLATED-realm value again. The duplication is a deliberate consequence of the "page-bridge imports nothing" boundary, so a shared module is not appropriate, but the sync risk is real. Unchanged by the fix commits.
**Fix:** Add a cross-file guard (e.g. an audit-script grep or a test asserting the two literal arrays are equal by reading both files) so drift is caught mechanically rather than by reviewer vigilance.

### IN-02: test iframe (`crossRealmArrayBuffer`) is never removed between tests

**File:** `extension/entrypoints/__tests__/page-bridge-firefox.test.ts:98-114` (helper), `:80` (afterEach)
**Issue:** Each `crossRealmArrayBuffer(...)` call appends an `<iframe>` to `document.body` (line 100) and never removes it; `afterEach` (line 80) cleans dataset markers but not these iframes. Harmless (jsdom teardown resets the DOM per file), but leaves stray realms accumulating within a file's run. Unchanged by the fix commits.
**Fix:** Remove the iframe after extracting its constructors, or track and remove created iframes in `afterEach`.

### IN-03: probe failure path leaks driver/server (mitigated by process exit)

**File:** `extension/e2e-firefox/probe-request-xray.cjs:551-554`
**Issue:** On a thrown error inside `main()`, the outer catch (line 532) writes results and rethrows; the `require.main` `.catch` (lines 551-554) logs and `process.exit(1)` without `driver.quit()` or `formServer.close()`. The success path (lines 543-544) does clean up, but the failure path still does not. OS process teardown reclaims the geckodriver/Firefox children and the port, so this is cosmetic, but an explicit cleanup would avoid orphaned Firefox processes if the file is ever imported/driven programmatically rather than run as `main`. The WR-01 fix added exit-code logic to the success path only; the failure-path cleanup gap is unchanged.
**Fix:** Wrap quit/close in the `.catch` handler too (guarded with `try/catch`), mirroring the success path.

---

_Reviewed: 2026-07-20T13:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
