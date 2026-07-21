---
phase: 20-test-infrastructure-ci-gate
verified: 2026-07-21T17:20:00Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
warnings:
  - id: README-env-contract-drift
    file: extension/e2e-firefox/README.md
    severity: warning
    note: >-
      WR-04 changed the probes to REQUIRE PV_UAT_PASSWORD / PV_PROBE_PASSWORD
      (fail-fast, no default), but the README env-var section still reads
      "all optional, sensible defaults shown" (line ~116), lists
      PV_UAT_PASSWORD with a redacted default (line ~122), and has no
      PV_PROBE_PASSWORD row at all. Code and docs disagree on the now-required
      contract. Non-blocking documentation drift — recommended follow-up.
  - id: CSP-strict-no-dedicated-lane
    file: extension/e2e-firefox/README.md
    severity: info
    note: >-
      SC2 lists CSP-strict "wired to its own npm script"; the delivered (and
      explicitly PLANNED — 20-02 must_haves truth #3, plan-checker blocker
      resolution) design folds CSP-strict into the core and request-xray
      lanes (real /provider-csp fixture serving `Content-Security-Policy:
      script-src 'self'`) rather than a standalone script. Documented as a
      harness-lane disposition in README lines 57-66. Intent (CSP-strict
      genuinely exercised + documented, none reachable only by hand-typed
      command) is met; accepted deviation from the literal wording.
---

# Phase 20: Test Infrastructure & CI Gate — Verification Report

**Phase Goal:** The full verification surface — cargo workspace tests, extension/web vitest, both wxt builds, the MAIN-world boundary audit, and the real-Firefox probes — runs automatically on every push/PR, and the Rust byte-serialization bug class that hid the v0.2 regression has a permanent regression gate.
**Verified:** 2026-07-21T17:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth (Success Criterion) | Status | Evidence |
|---|---------------------------|--------|----------|
| 1 | CI pipeline runs the full gate (cargo workspace tests, extension vitest, web vitest, tsc both, both wxt builds, web-ext lint, MAIN-world audit) on push/PR, green locally | ✓ VERIFIED | `.github/workflows/ci.yml` — 4 jobs (rust/web/extension/supply-chain), `on: push` + `pull_request`. Every SC1 gate element mapped to a concrete step (see Key Links). Local full-gate run recorded in 20-04-SUMMARY (21 rust `ok` blocks, 481 web tests, 693 extension tests, both wxt builds, lint 0 errors, audit PASS, supply-chain ok). Spot-run confirms: `cargo test -p pv-provider --test response_shape` → 2 passed; `node --check` on all 4 modified probes → OK. |
| 2 | Every real-Firefox probe (server-unlock, provider-corruption, request-xray, CSP-strict) wired to its own npm script + documented as a harness lane in README | ✓ VERIFIED (with note) | `extension/package.json` has `test:e2e:firefox:{server-unlock,provider-corruption,request-xray}` + matching `pretest:*` build hooks; README "## Running" documents all 6 lanes. CSP-strict is folded into core + request-xray lanes (planned/approved decision), documented explicitly in README lines 57-66 — see warning `CSP-strict-no-dedicated-lane`. No probe is reachable only by hand-typed command. |
| 3 | Rust unit test asserts base64url byte shape for every binary WebAuthn response field, fails on regression to a bare number array | ✓ VERIFIED | `crates/pv-provider/tests/response_shape.rs` — 2 tests covering create (rawId, clientDataJSON, attestationObject, authenticatorData + optional publicKey/prf) and get (rawId, clientDataJSON, authenticatorData, signature + optional userHandle) ceremonies. `assert_base64url_string_field` panics field-named if `.as_str()` fails (number-array regression) or base64url decode fails. Feature `serialize_bytes_as_base64_string` enabled in `crates/pv-provider/Cargo.toml:32`; removing it makes the test fail loud. Both tests pass on spot-run. |

**Score:** 3/3 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.github/workflows/ci.yml` | 4-job SC1 gate on push/PR | ✓ VERIFIED | rust/web/extension/supply-chain; least-privilege `permissions: contents: read` (WR-02); actions SHA-pinned (WR-03) |
| `crates/pv-provider/tests/response_shape.rs` | Byte-shape regression gate | ✓ VERIFIED | 2 passing tests, both ceremonies, all binary fields |
| `extension/e2e-firefox/README.md` | 6 lanes + CSP disposition documented | ✓ VERIFIED | Lanes 49-54, CSP disposition 57-66 (env-var table drift — see warning) |
| `extension/package.json` | Probe npm scripts + pretest hooks | ✓ VERIFIED | request-xray + provider-corruption scripts + build hooks present |
| `web/package.json` | `compile` = `tsc --noEmit` | ✓ VERIFIED | Closes "tsc (both)" gap symmetric with extension |
| `scripts/audit-mainworld-boundary.sh` | MAIN-world boundary gate | ✓ VERIFIED | Present, executable, source + built-bundle checks |
| `scripts/check-supply-chain.sh` | cargo-audit + cargo-deny | ✓ VERIFIED | Present, executable, fail-loud |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| ci.yml rust job | QA-04 response_shape.rs | `cargo test --workspace` sweeps it in | ✓ WIRED |
| ci.yml web job | tsc + vitest + next build | compile → test → build after build-wasm/pv-ui ci | ✓ WIRED |
| ci.yml extension job | tsc + vitest + both builds + lint + audit | compile→test→build:chrome→build:firefox→lint:firefox→audit-mainworld | ✓ WIRED |
| package.json probe scripts | probe-request-xray.cjs / probe-provider-corruption.cjs | `node e2e-firefox/probe-*.cjs` | ✓ WIRED |
| core + request-xray lanes | /provider-csp fixture (`script-src 'self'`) | CSP-STRICT-SHIM-PRESENT/CREATE (run-core 417-471), SHIM-PRESENT (request-xray 356-451) | ✓ WIRED |

### Review-Fix Verification (a295366..9269553)

| ID | Fix | Status | Evidence |
|----|-----|--------|----------|
| CR-01 | provider-corruption exits non-zero on FAIL/CORRUPTED | ✓ FIXED | Tail: `filter([, r]) => r.status === 'FAIL' \|\| r.status === 'CORRUPTED'` → `process.exit(1)` |
| WR-01 | Hoist driver/formServer + bounded cleanup on throw | ✓ FIXED | Module-scope `let driver; let formServer;` (probe-provider-corruption:120-121, run-core:82-83); `.catch` calls `quitBounded(driver)` |
| WR-02 | Restrict GITHUB_TOKEN | ✓ FIXED | `permissions: contents: read` (ci.yml:7-8) |
| WR-03 | Pin actions to commit SHAs | ✓ FIXED | All `uses:` SHA-pinned with `# vX` comments |
| WR-04 | Drop hardcoded password default, fail fast | ✓ FIXED (code) | 4 cited files use `process.env.PV_UAT_PASSWORD` / `PV_PROBE_PASSWORD` + `if (!…) throw`. README env-var section NOT updated — see warning `README-env-contract-drift` |
| WR-05 | Await ceremony-triggering executeScript | ✓ FIXED | `const probeCreate = driver.executeScript(...)` (235) → `await probeCreate; await ensurePopup();` (275-276) |

### Anti-Patterns Found

None blocking. Two non-blocking observations captured as `warnings` in frontmatter:
- README env-var table says "all optional, sensible defaults shown" and omits `PV_PROBE_PASSWORD`, contradicting the WR-04 fail-fast code (documentation drift).
- Pre-existing hardcoded UAT-password defaults remain in `probe-window-geometry.cjs:84` and `run-autofill-capture.cjs:42` — outside WR-04's cited scope and not among the 4 SC2 probe lanes; noted for a future sweep, not a phase-20 regression.

### Requirements Coverage

| Requirement | Source Plan | Description | Status |
|-------------|-------------|-------------|--------|
| QA-01 | 20-04 | CI pipeline full gate | ✓ SATISFIED |
| QA-02 | 20-02 | Probe lanes wired + documented | ✓ SATISFIED |
| QA-04 | 20-01 | Byte-shape regression test | ✓ SATISFIED |

### Human Verification Required

None required for the stated success criteria — all three are presence/wiring/test-verifiable, and the byte-shape gate (SC3) was executed directly. The real-Firefox probe lanes drive a live browser and are out of scope to run here, but SC2 asserts wiring + documentation (verified by presence), not per-run probe behavior.

### Gaps Summary

No gaps block the phase goal. The full verification surface is wired into `.github/workflows/ci.yml` and proven green by a recorded local full-gate run (cloud run is a documented follow-up given the repo has no git remote). The byte-serialization bug class has a permanent, passing Rust regression gate. All six code-review findings (1 Critical + 5 Warnings) are confirmed fixed in the codebase. Two non-blocking documentation warnings are recorded for follow-up: the README env-var contract drift (WR-04) and the CSP-strict lane-disposition wording.

---

_Verified: 2026-07-21T17:20:00Z_
_Verifier: Claude (gsd-verifier)_
