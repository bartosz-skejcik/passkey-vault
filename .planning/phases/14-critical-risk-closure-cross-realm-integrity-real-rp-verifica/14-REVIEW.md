---
phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
reviewed: 2026-07-20T12:16:41Z
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
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-07-20T12:16:41Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 14 closes two critical risks: the Firefox cross-realm/Xray integrity hole (RESPONSE-direction MAIN-world re-materialization in `page-bridge-firefox.ts` `shapeCredential`) and the "no genuine cross-vendor verification" fixture blind spot (`tests/real_rp_verification.rs`). I reviewed the actual diff of each file against `c509a0d`, then read the changed logic in the context of the whole file.

Verdict on the two headline concerns raised in the phase brief:

- **The Rust cross-vendor test is genuine, not vacuous.** `pv_provider_round_trip_verified_by_independent_webauthn_rs` feeds real webauthn-rs–issued challenges through `pv-provider`'s real public entry points and then calls `finish_passkey_registration` / `finish_passkey_authentication`, both of which perform true attestation/signature verification over the real challenge. Any failure panics via `.expect()`, so the test fails loudly. No `.ok`/`id`/shape-only assertion, no loosened verifier config. `uuid` (`v4` feature) and `webauthn-rs 0.5` resolve correctly for a `-p pv-provider` build; the `danger-allow-state-serialisation` feature is not needed because state objects are passed in-memory. Confirmed sound — no finding.
- **The production re-materialization change is additive and correctly guarded.** `shapeCredential` re-decodes binary fields from `credentialJson`'s base64url strings using MAIN-world-native globals, layers over `{...cred, ...rematerialized}`, and any throw is caught by `broker()`'s outer try/catch → native fallthrough. D-03 (`location.origin`, never `'*'`), the nonce/replay/consent gates, and origin refusal logic are untouched (the `content-relay.content.ts` diff is comment-only). No new key-material or plaintext exposure — PRF results returned to a third-party RP are the WebAuthn contract, unchanged from pre-14.

The findings below are all in test/probe infrastructure and maintainability, not product correctness.

## Warnings

### WR-01: probe-request-xray.cjs exits 0 even when its own gates record FAIL

**File:** `extension/e2e-firefox/probe-request-xray.cjs:451-515, 528-539`
**Issue:** The `XRAY-CREATE` and `XRAY-GET` failure branches call `record(id, 'FAIL', ...)` but do NOT throw (only the "no consent UI" pre-conditions throw). Control then falls through to the end of `main()`, which returns normally, and the `require.main` runner does `process.exit(0)` unconditionally. There is no aggregation over `results` and no exit-code linkage. A genuine regression (e.g. the RAW-ArrayBuffer challenge no longer round-tripping byte-exact, or a delivered field that is not an ArrayBuffer) is recorded as FAIL in the JSON/console but the process still exits 0. For a file whose own header calls it a "permanent byte-level regression probe" closing a Critical (XBR-02) hole, and given the phase brief's explicit "deterministic PASS/FAIL" requirement, an exit code that cannot signal failure undermines the probe's purpose in any automated context.
**Fix:** Compute an overall pass/fail from `results` and exit non-zero on any FAIL, e.g. at the end of the runner:
```js
main().then(async ({ driver, formServer }) => {
  await sleep(1000);
  try { await driver.quit(); } catch {}
  formServer.close();
  const failed = Object.entries(results).filter(([, r]) => r.status === 'FAIL');
  if (failed.length) {
    console.error('FAILED gates:', failed.map(([k]) => k).join(', '));
    process.exit(1);
  }
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
```
(The same latent pattern exists in `run-core.cjs`; it is pre-existing there and out of this phase's diff, but worth aligning.)

### WR-02: probe response-direction `*IsArrayBuffer` gate does not actually guard the fix it claims to

**File:** `extension/e2e-firefox/probe-request-xray.cjs:181-187, 455-465, 503-514`
**Issue:** The probe hard-gates `rawIdIsArrayBuffer/clientDataJSONIsArrayBuffer/...` to `true` and the header advertises it as "hard-gates response-direction realm identity for every binary field." But `page-bridge-firefox.ts`'s own updated header (lines 223-249) and the debug doc conclude that a genuine inline-`<script>` RP page sees `instanceof ArrayBuffer: true` for these fields **even without** `shapeCredential`'s re-materialization — the original `false` was a geckodriver `executeScript` measurement artifact. Since the probe now correctly measures via an inline `<script>`, reverting the re-materialization would leave these gates still passing. The gate therefore does not discriminate fixed-vs-unfixed for the response-direction code it exists to protect; it is a valid end-to-end outcome check but not the regression guard the comment claims. (The deterministic jsdom test `page-bridge-firefox.test.ts` DOES discriminate — its `crossRealmArrayBuffer` helper makes `instanceof` reliably false pre-fix — so real coverage of the fix exists there.)
**Fix:** Either soften the probe's header claim to "end-to-end delivery/round-trip check" and rely on the jsdom test for the realm-identity regression guard, or make the probe genuinely discriminating (not generally achievable on real Firefox per the debug doc — so documenting the jsdom test as the authoritative guard is the pragmatic path).

## Info

### IN-01: RESPONSE_BINARY_FIELDS duplicated across two files with manual sync

**File:** `extension/entrypoints/page-bridge-firefox.ts:265` and `extension/entrypoints/content-relay.content.ts:616`
**Issue:** Both declare `["clientDataJSON", "attestationObject", "authenticatorData", "signature", "publicKey"]` independently and are kept in sync by hand (acknowledged in the comments). A future added binary field decoded in `content-relay` but not mirrored here would silently be delivered to the Firefox page as an ISOLATED-realm value again. The duplication is a deliberate consequence of the "page-bridge imports nothing" boundary, so a shared module is not appropriate, but the sync risk is real.
**Fix:** Add a cross-file guard (e.g. an audit-script grep or a test asserting the two literal arrays are equal by reading both files) so drift is caught mechanically rather than by reviewer vigilance.

### IN-02: test iframe (`crossRealmArrayBuffer`) is never removed between tests

**File:** `extension/entrypoints/__tests__/page-bridge-firefox.test.ts:98-114`
**Issue:** Each `crossRealmArrayBuffer(...)` call appends an `<iframe>` to `document.body` and never removes it; `afterEach` cleans dataset markers but not these iframes. Harmless (jsdom teardown resets the DOM per file), but leaves stray realms accumulating within a file's run.
**Fix:** Remove the iframe after extracting its constructors, or track and remove created iframes in `afterEach`.

### IN-03: probe failure path leaks driver/server (mitigated by process exit)

**File:** `extension/e2e-firefox/probe-request-xray.cjs:521-525, 535-538`
**Issue:** On a thrown error inside `main()`, the outer catch writes results and rethrows; the `require.main` `.catch` logs and `process.exit(1)` without `driver.quit()` or `formServer.close()`. OS process teardown reclaims the geckodriver/Firefox children and the port, so this is cosmetic, but an explicit cleanup would avoid orphaned Firefox processes if the file is ever imported/driven programmatically rather than run as `main`.
**Fix:** Wrap quit/close in the `.catch` handler too (guarded with `try/catch`), mirroring the success path.

---

_Reviewed: 2026-07-20T12:16:41Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
