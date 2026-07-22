---
phase: 20-test-infrastructure-ci-gate
plan: 01
subsystem: testing
tags: [rust, cargo-test, webauthn, passkey-types, base64url, regression-gate]

# Dependency graph
requires:
  - phase: 12-passkey-provider
    provides: "crates/pv-provider's create_provider_credential/get_provider_assertion ceremony entry points this gate exercises"
  - phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
    provides: "the D-21 serialize_bytes_as_base64_string fix + tests/real_rp_verification.rs precedent this plan complements"
provides:
  - "crates/pv-provider/tests/response_shape.rs — permanent field-enumerating regression gate proving every binary WebAuthn response field pv-provider emits (create AND get ceremonies) is a base64url STRING on the wire, not a bare JSON number array"
affects: [test-infrastructure-ci-gate, pv-provider, ci]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Field-by-field JSON shape assertion (is_string + try_from_base64url) with per-field, regression-class-naming panic messages, mirroring tests/real_rp_verification.rs's independent-fixture-owning precedent"]

key-files:
  created: [crates/pv-provider/tests/response_shape.rs]
  modified: []

key-decisions:
  - "Duplicated lib.rs's private fixture_create_request/fixture_get_request/base64url helpers locally in the new integration test file (not importable across the integration-test boundary), matching tests/real_rp_verification.rs's own independent-fixture precedent."
  - "Optional Bytes fields (response.publicKey, response.userHandle, clientExtensionResults.prf.results.first/.second) asserted only when present via a dedicated assert_optional_base64url_string_field helper that walks a dot-separated path and returns silently on any missing segment — never treated as required."
  - "Negative-control proof performed via a real edit-then-git-checkout cycle against the committed Cargo.toml (not a scratch copy) since the worktree provides an isolated, disposable checkout — git checkout -- restored the exact committed state after the red proof."

patterns-established:
  - "QA-04-style byte-shape regression gates: parse response JSON as serde_json::Value, assert each Bytes field .is_string() with a message naming both the field path and the regression class, then assert passkey_types::encoding::try_from_base64url(...).is_some() to confirm valid base64url, not just any string."

requirements-completed: [QA-04]

coverage:
  - id: D1
    description: "cargo test -p pv-provider passes, including the two new response_shape tests, proving every binary WebAuthn response field pv-provider emits is a base64url STRING on the wire"
    requirement: "QA-04"
    verification:
      - kind: unit
        ref: "crates/pv-provider/tests/response_shape.rs#create_response_binary_fields_are_base64url_strings"
        status: pass
      - kind: unit
        ref: "crates/pv-provider/tests/response_shape.rs#get_response_binary_fields_are_base64url_strings"
        status: pass
    human_judgment: false
  - id: D2
    description: "Negative-control proof: temporarily disabling passkey-types' serialize_bytes_as_base64_string Cargo feature makes both new tests fail (red), then reverting restores green — proving the gate discriminates and is not vacuously green"
    requirement: "QA-04"
    verification:
      - kind: unit
        ref: "manual command sequence, transcript below (cargo test -p pv-provider --test response_shape against a feature-disabled Cargo.toml, then restored)"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-07-21
status: complete
---

# Phase 20 Plan 01: QA-04 Rust base64url byte-shape regression test Summary

**Added `crates/pv-provider/tests/response_shape.rs`, a permanent field-enumerating Rust gate proving every binary WebAuthn field `pv-provider`'s create/get ceremonies emit is a base64url STRING, with a documented red/green negative-control proof against the exact `serialize_bytes_as_base64_string` D-21 regression class.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-21T13:50:00Z (approx)
- **Tasks:** 1 (TDD-typed; single behavior task with an inline red/green negative-control proof, not a RED/GREEN test-authorship cycle in the classic sense — the plan's `must_haves.truths` require the negative control to be performed once and reverted, not committed as a permanently-red state)
- **Files modified:** 1 created

## Accomplishments

- `crates/pv-provider/tests/response_shape.rs` created with exactly two `#[test]` functions: `create_response_binary_fields_are_base64url_strings` and `get_response_binary_fields_are_base64url_strings`.
- Every always-present `Bytes` field is asserted as a JSON string AND valid base64url: `rawId`, `response.clientDataJSON`, `response.attestationObject`, `response.authenticatorData` (create); `rawId`, `response.clientDataJSON`, `response.authenticatorData`, `response.signature` (get).
- Optional `Bytes` fields (`response.publicKey`, `clientExtensionResults.prf.results.first`/`.second`, `response.userHandle`) asserted only when present, never required.
- Negative-control proof performed and documented (see below): disabling the `serialize_bytes_as_base64_string` feature makes both new tests fail red with the discriminating panic message; reverting restores green.
- `cargo test -p pv-provider` (full crate, all 4 unit tests + `real_rp_verification.rs` + the 2 new tests) passes.
- `cargo test --workspace` passes in full (all crates green, no regressions).

## Task Commits

Each task was committed atomically:

1. **Task 1: QA-04 byte-shape regression test for pv-provider's WebAuthn response serialization** - `509a230` (test)

**Plan metadata:** SUMMARY.md commit (this file) — see final commit in the phase's overall record.

_Note: this task's negative-control proof (feature-disabled red run) was performed against a working-tree edit of the already-committed `Cargo.toml` and reverted via `git checkout --` before the task commit was made — no red state was ever staged or committed._

## Files Created/Modified

- `crates/pv-provider/tests/response_shape.rs` - New Cargo integration test (auto-discovered by `cargo test -p pv-provider`, no `[[test]]` entry needed) with the two QA-04 field-enumerating tests, local fixture helpers (`fixture_create_request`/`fixture_get_request`/`base64url`, duplicated from `lib.rs`'s private test-only versions since they are not importable across the integration-test boundary), and two shared assertion helpers (`assert_base64url_string_field` for always-present fields, `assert_optional_base64url_string_field` for present-when-available fields).

## Decisions Made

- Duplicated `lib.rs`'s private fixture helpers locally rather than exposing them as `pub(crate)`/`pub` — matches `tests/real_rp_verification.rs`'s own precedent of an independent, self-contained fixture-owning integration test file, and avoids widening `pv-provider`'s public API surface just for test convenience.
- Built two small shared helpers (`assert_base64url_string_field`, `assert_optional_base64url_string_field`) instead of inlining the is_string+try_from_base64url pair at each call site, since the plan requires the SAME two checks (string-shape + valid-base64url-decode) at every one of the 9 field sites (4 always-present create + 4 always-present get + up to 5 optional across both).
- Performed the negative-control proof via a real edit of the committed `Cargo.toml` inside the isolated worktree, then `git checkout -- crates/pv-provider/Cargo.toml` to restore — this is equivalent to the plan's "scratch copy" suggestion but simpler given the worktree's own disposability, and was verified to restore the exact committed byte content (confirmed via `git status --short` showing no diff afterward).

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria met without needing Rule 1-4 fixes.

## Issues Encountered

None.

## Negative-Control Proof (Red/Green Transcript)

Per `must_haves.truths` and the task's `<action>`, the following one-time proof was performed to confirm the gate discriminates a real regression, not a vacuously-green test:

**1. Disabled the feature** (edited `crates/pv-provider/Cargo.toml` line 32):
```diff
-passkey-types = { version = "=0.5.0", features = ["serialize_bytes_as_base64_string"] }
+passkey-types = { version = "=0.5.0" }
```

**2. Ran the gate — RED, as expected:**
```
$ cargo test -p pv-provider --test response_shape

running 2 tests
test create_response_binary_fields_are_base64url_strings ... FAILED
test get_response_binary_fields_are_base64url_strings ... FAILED

failures:

---- create_response_binary_fields_are_base64url_strings stdout ----

thread 'create_response_binary_fields_are_base64url_strings' panicked at crates/pv-provider/tests/response_shape.rs:76:9:
QA-04 regression: `rawId` must serialize as a base64url STRING, not a bare JSON number array (the exact `serialize_bytes_as_base64_string` D-21 regression class from .planning/debug/resolved/firefox-provider-corruption.md) -- found: [228,116,133,27,72,151,120,66,144,166,94,45,208,234,41,93]

---- get_response_binary_fields_are_base64url_strings stdout ----

thread 'get_response_binary_fields_are_base64url_strings' panicked at crates/pv-provider/tests/response_shape.rs:76:9:
QA-04 regression: `rawId` must serialize as a base64url STRING, not a bare JSON number array (the exact `serialize_bytes_as_base64_string` D-21 regression class from .planning/debug/resolved/firefox-provider-corruption.md) -- found: [56,188,220,210,17,249,230,237,16,251,232,56,222,74,171,92]

test result: FAILED. 0 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s
```
Both tests fail with the exact discriminating panic message (naming the field and the D-21 regression class), confirming the gate is NOT vacuously green — a real regression to the bare-number-array shape is caught immediately and loudly.

**3. Restored Cargo.toml:**
```
$ git checkout -- crates/pv-provider/Cargo.toml
$ git status --short crates/pv-provider/Cargo.toml
(no output — clean, matches committed state)
```

**4. Re-ran the gate — GREEN, confirmed:**
```
$ cargo test -p pv-provider --test response_shape

running 2 tests
test create_response_binary_fields_are_base64url_strings ... ok
test get_response_binary_fields_are_base64url_strings ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s
```

**5. Full crate and workspace confirmation (post-restore):**
```
$ cargo test -p pv-provider
... 4 unit tests ok, real_rp_verification.rs 1 test ok, response_shape.rs 2 tests ok

$ cargo test --workspace
... all crates green, 0 failed across the entire workspace
```

This is a one-time authorship proof, not a permanently-red test in the suite — the committed state (verified above) has the feature enabled and both new tests green.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

QA-04's Rust-unit-gate half is closed. Combined with Phase 14's `probe-request-xray.cjs` (the cross-realm delivery half, already satisfied), QA-04 is now fully closed at the phase level. This plan (20-01) has no dependents within Phase 20 (`depends_on: []`) — Phase 20's other plans (20-02/20-03/20-04) can proceed independently. `cargo test --workspace` remains green with no regressions, ready for CI wiring in a later Phase 20 plan.

---
*Phase: 20-test-infrastructure-ci-gate*
*Completed: 2026-07-21*

## Self-Check: PASSED

- FOUND: crates/pv-provider/tests/response_shape.rs
- FOUND commit: 509a230
- Cargo.toml restored clean (no diff vs committed state)
