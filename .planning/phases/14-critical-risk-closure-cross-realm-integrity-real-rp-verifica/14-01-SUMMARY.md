---
phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica
plan: 01
subsystem: testing
tags: [webauthn, webauthn-rs, passkey-types, cargo, integration-test, cross-vendor]

# Dependency graph
requires:
  - phase: 12-passkey-provider
    provides: "pv-provider's create_provider_credential/get_provider_assertion public API and the D-21 serialize_bytes_as_base64_string fix"
provides:
  - "An independent-vendor (webauthn-rs/kanidm) integration test proving pv-provider's real ceremony JSON output is consumable by a genuinely different WebAuthn implementation"
affects: [15, 16, 17, 18, 19, 20]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Dev-dependency-only cross-vendor verification edge: add an independent-vendor crate as [dev-dependencies] only, never [dependencies], to prove wire-format correctness without adding production runtime surface"]

key-files:
  created: [crates/pv-provider/tests/real_rp_verification.rs]
  modified: [crates/pv-provider/Cargo.toml]

key-decisions:
  - "webauthn-rs added to pv-provider ONLY as [dev-dependencies] (no feature flags) — danger-allow-state-serialisation was deliberately omitted since the test holds PasskeyRegistration/PasskeyAuthentication as in-process Rust values, never crossing an HTTP boundary"
  - "Used non-localhost https://example.com origin on both the webauthn-rs builder and pv_provider's origin argument, matching pv-provider's own existing test fixture convention and avoiding any localhost-allowance flag"

requirements-completed: [QA-03]

coverage:
  - id: D1
    description: "Independent webauthn-rs (kanidm) Relying Party verifies a real register-then-authenticate ceremony produced by pv-provider's actual create_provider_credential/get_provider_assertion public API — both finish_passkey_registration and finish_passkey_authentication return Ok over real webauthn-rs-issued challenges, closing the fixture blind spot that hid the D-21 byte-serialization bug"
    requirement: "QA-03"
    verification:
      - kind: integration
        ref: "crates/pv-provider/tests/real_rp_verification.rs#pv_provider_round_trip_verified_by_independent_webauthn_rs"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-20
status: complete
---

# Phase 14 Plan 01: Real cross-vendor RP verification (QA-03) Summary

**Independent webauthn-rs (kanidm) integration test verifies pv-provider's real register+authenticate ceremony end-to-end, closing the same-vendor fixture blind spot that hid the D-21 byte-serialization bug.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-20T10:48:24Z
- **Completed:** 2026-07-20T10:55:04Z
- **Tasks:** 2
- **Files modified:** 2 (1 new, 1 modified)

## Accomplishments
- Added a `[dev-dependencies]` edge from `pv-provider` to `webauthn-rs = "0.5"` and `uuid.workspace = true` — no `[dependencies]` (production) changes, confirmed via `git diff` showing only additions.
- Created `crates/pv-provider/tests/real_rp_verification.rs`: one integration test that builds a genuine `webauthn-rs` Relying Party, drives `pv_provider::create_provider_credential` through a real `start_passkey_registration`-issued challenge, verifies the response via `webauthn-rs`'s own `finish_passkey_registration`, then repeats the pattern for `get_provider_assertion`/`finish_passkey_authentication` — proving `pv-provider`'s real production JSON output is consumable by an INDEPENDENT (non-kanidm-authenticator) verifier.
- Confirmed `cargo test --workspace` remains fully green (48 tests across pv-core/pv-server/pv-wasm/pv-provider, no regressions from the new dev-dependency edge).

## Task Commits

Each task was committed atomically:

1. **Task 1: pv-provider webauthn-rs dev-dependency edge + cargo check de-risk** - `69b0ffc` (chore)
2. **Task 2: real_rp_verification.rs — independent webauthn-rs round-trip** - `cfed88f` (test)

**Plan metadata:** committed separately as part of this SUMMARY (worktree mode — orchestrator finalizes shared docs after merge).

## Files Created/Modified
- `crates/pv-provider/Cargo.toml` - New `[dev-dependencies]` section: `webauthn-rs = "0.5"`, `uuid.workspace = true`, with a comment explaining the QA-03 rationale and confirming both crates are already pinned elsewhere in the workspace.
- `crates/pv-provider/tests/real_rp_verification.rs` (new) - Integration test driving a full registration+authentication round-trip through `pv-provider`'s real public API, independently verified by `webauthn-rs`.

## Decisions Made
- Omitted `danger-allow-state-serialisation` feature on the new `webauthn-rs` dev-dependency: this test holds `PasskeyRegistration`/`PasskeyAuthentication` as local in-process Rust values within a single test function (no HTTP round trip), so the feature (which exists to cross a request boundary, as `pv-server` needs) is unnecessary here.
- Used `"example.com"`/`"https://example.com"` as the origin on BOTH sides (webauthn-rs's `WebauthnBuilder` and `pv_provider`'s own `origin` argument) — this exact string is already proven against `pv-provider`'s own existing fixtures in `crates/pv-provider/src/lib.rs`, keeping the test deliberately non-localhost per the plan's explicit rationale.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed literal "SoftPasskey" occurrences from doc comments to satisfy Task 2's acceptance criteria**
- **Found during:** Task 2 (writing `real_rp_verification.rs`)
- **Issue:** My first draft's module doc comment explained (in prose) why `webauthn_authenticator_rs::softpasskey::SoftPasskey` is never used — but the literal substring "SoftPasskey" appearing anywhere in the file (even in explanatory prose, not code) fails Task 2's acceptance criterion `grep -c "SoftPasskey" ... == 0`.
- **Fix:** Rewrote the doc comment to describe the same rationale ("the SAME vendor as webauthn-rs itself", "kanidm's OWN bundled soft-authenticator crate") without using the literal string "SoftPasskey". No code semantics changed — `webauthn_authenticator_rs` was never imported in either draft.
- **Files modified:** `crates/pv-provider/tests/real_rp_verification.rs`
- **Verification:** `grep -c "SoftPasskey" crates/pv-provider/tests/real_rp_verification.rs` returns `0`; `cargo test -p pv-provider --test real_rp_verification` still passes.
- **Committed in:** `cfed88f` (Task 2 commit — the fix was applied before the task's single commit, not as a separate follow-up)

---

**Total deviations:** 1 auto-fixed (1 bug — acceptance-criteria wording mismatch caught before commit)
**Impact on plan:** Cosmetic/doc-comment only. No scope creep, no change to test logic or verification strength.

## Issues Encountered
None beyond the deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- QA-03 is closed: an independent `webauthn-rs` verifier now proves `pv-provider`'s real ceremony output round-trips correctly, closing the exact fixture blind spot that hid the v0.2 D-21 byte-serialization bug.
- `cargo test --workspace` is green; no regression to any existing pv-core/pv-server/pv-wasm test from the new dev-dependency edge.
- This plan does not touch `crates/pv-server` or `extension/` — plans 14-02 and 14-03 (cross-realm integrity, per this phase's other objectives) are unaffected by and independent of this plan's changes.

---
*Phase: 14-critical-risk-closure-cross-realm-integrity-real-rp-verifica*
*Completed: 2026-07-20*
