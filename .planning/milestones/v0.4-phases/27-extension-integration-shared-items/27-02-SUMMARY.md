---
phase: 27-extension-integration-shared-items
plan: 02
subsystem: crypto
tags: [webauthn, signature-counter, decision-record, ext-10, sec-04, rust]

requires:
  - phase: 19-server-supply-chain-hardening
    provides: "SEC-04 counter-anomaly classifier (handle_finish_auth_error) whose reachability this plan traces and rules out for provider-ceremony assertions"
provides:
  - "EXT-10 decision record: doc comment above get_provider_assertion in crates/pv-provider/src/ceremony.rs, plus a matching Key Decisions row in .planning/PROJECT.md, both committed before any 27-06 dependent TypeScript code"
  - "Permanent Rust regression sign_count_is_always_zero_for_a_provider_ceremony_assertion (crates/pv-provider/tests/response_shape.rs) decoding the raw wire authenticatorData bytes (offset 33..37) rather than trusting updated_passkey_json's Option<u32>"
  - "SEC-04 classifier-unreachability finding with file:line evidence (passkeys.rs:269, passkeys.rs:552, auth.rs:575 vs. pv-provider's Cargo.toml dependency graph)"
affects: [27-06]

tech-stack:
  added: []
  patterns:
    - "Decision-record doc comment above the affected function (KEY-05 precedent), cited from a matching PROJECT.md Key Decisions row, committed before any dependent code lands"
    - "Wire-level regression test decodes the base64url response field directly (offset math against the WebAuthn spec structure) instead of trusting a typed Rust intermediate that could silently normalize an absent value"

key-files:
  created: []
  modified:
    - crates/pv-provider/tests/response_shape.rs
    - crates/pv-provider/src/ceremony.rs
    - .planning/PROJECT.md

key-decisions:
  - "EXT-10: no per-item signature-counter tracking is added for shared provider passkeys — the requirement's own 'no shipped product precedent exists' framing is factually incorrect (pv-provider never opts into make_credentials_with_signature_counter; iCloud Keychain and Google Password Manager both ship constant signCount:0 for synced passkeys; WebAuthn L3 6.1.1 explicitly permits this). Explicit anti-goal: no per-item monotonic counter, since N concurrently active member extensions sharing one passkey have no single authoritative 'last counter' to race-free advance."
  - "SEC-04's counter-anomaly classifier (handle_finish_auth_error, passkeys.rs:299-350) is structurally unreachable from a provider-ceremony assertion — traced with file:line evidence (3 call sites, all inside pv-server's own vault login/unlock ceremony) rather than inferred; pv-provider's Cargo.toml has no webauthn-rs/sqlx/pv-server edge in [dependencies] (only a [dev-dependencies]-scoped QA-03 test verifier), so the two code paths cannot meet."

patterns-established:
  - "Task 1's raw-byte-decode test written under a working name, then Task 2 renamed it to the permanent behavior-named regression once the decision record it backs was written — same test, promoted rather than duplicated."

requirements-completed: [EXT-10]

coverage:
  - id: D1
    description: "A permanent in-process Rust regression decodes the raw authenticatorData wire bytes (offset 33..37) from a real create-then-get provider ceremony and asserts signCount is 0"
    requirement: "EXT-10"
    verification:
      - kind: unit
        ref: "crates/pv-provider/tests/response_shape.rs#sign_count_is_always_zero_for_a_provider_ceremony_assertion"
        status: pass
    human_judgment: false
  - id: D2
    description: "EXT-10 decision record (doc comment in ceremony.rs + PROJECT.md Key Decisions row) records the no-counter decision and the SEC-04 classifier-unreachability finding with file:line evidence, committed before any 27-06 dependent code"
    requirement: "EXT-10"
    verification:
      - kind: unit
        ref: "grep -c 'EXT-10' crates/pv-provider/src/ceremony.rs (4) and grep -c 'passkeys.rs' crates/pv-provider/src/ceremony.rs (3), both >= 1"
        status: pass
    human_judgment: false

duration: 20min
completed: 2026-08-08
status: complete
---

# Phase 27 Plan 02: EXT-10 Signature-Counter Decision Record Summary

**Closed EXT-10 by proving pv-provider already reports signCount 0 on the raw wire bytes (not just by code read) and structurally ruling out SEC-04 classifier reachability with file:line evidence, before any TypeScript-side dependent code lands.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-08-08
- **Tasks:** 2/2 completed
- **Files modified:** 3

## Accomplishments

- Added a permanent Rust regression (`sign_count_is_always_zero_for_a_provider_ceremony_assertion`) that runs a full create-then-get provider ceremony and decodes the RAW WIRE BYTES of the base64url `response.authenticatorData` field (WebAuthn §6.1 offset 33..37, the fixed 4-byte big-endian signCount), asserting it is 0 — a strictly stronger claim than trusting `updated_passkey_json`'s `Option<u32>` alone.
- Wrote the EXT-10 decision record as a doc comment above `get_provider_assertion` in `ceremony.rs`: the requirement's own "no shipped product precedent exists" framing is factually wrong (pv-provider never opts into `make_credentials_with_signature_counter`; iCloud Keychain / Google Password Manager both ship constant `signCount: 0` for synced passkeys; WebAuthn L3 §6.1.1 permits this explicitly), states the explicit anti-goal (no per-item monotonic counter — it would make N concurrent member extensions race on a revision-guarded row), and mirrors the KEY-05 precedent by landing before any dependent TypeScript code.
- Traced, with file:line evidence rather than inference, that a provider-ceremony assertion structurally cannot reach the Phase 19 SEC-04 counter-anomaly classifier (`handle_finish_auth_error`, `passkeys.rs:299-350`): confirmed by grep that it is called from exactly 3 sites (`passkeys.rs:269`, `passkeys.rs:552`, `auth.rs:575`), every one inside pv-server's own `webauthn-rs` vault login/unlock ceremony against the `passkeys` table — and that `pv-provider`'s `Cargo.toml` has no `webauthn-rs`/`sqlx`/`pv-server` edge in `[dependencies]` (the one `webauthn-rs` reference is `[dev-dependencies]`-scoped at `Cargo.toml:46`, QA-03's cross-vendor test verifier, never a production path).
- Added a matching EXT-10 row to `.planning/PROJECT.md`'s Key Decisions table, same shape as the KEY-05 row, marked `Decided (Phase 27)`.

## Task Commits

Each task was committed atomically:

1. **Task 1: Live wire measurement — confirm signCount on a real provider assertion** - `98b9d35` (test)
2. **Task 2: Decision record + companion invariant regression test** - `5902ace` (docs)

**Plan metadata:** (this commit) `docs(27-02): complete extension-integration-shared-items plan`

## Files Created/Modified

- `crates/pv-provider/tests/response_shape.rs` - Added `sign_count_is_always_zero_for_a_provider_ceremony_assertion`: runs a full create-then-get ceremony, decodes `response.authenticatorData`'s base64url string off the wire, reads the 4-byte big-endian signCount at offset 33..37 directly, asserts 0.
- `crates/pv-provider/src/ceremony.rs` - Added the EXT-10 decision-record doc comment above `get_provider_assertion`: the no-counter decision, its rationale (spec permission + industry precedent + explicit anti-goal), and the SEC-04 classifier-unreachability finding with file:line evidence.
- `.planning/PROJECT.md` - Added an EXT-10 row to the Key Decisions table, `Decided (Phase 27)`.

## Decisions Made

- **EXT-10 (no counter tracking for shared provider passkeys):** see key-decisions above and the full doc comment in `ceremony.rs`. The requirement's premise ("no shipped product precedent exists") was found factually incorrect by direct code read and confirmed empirically by the new regression test; the anti-goal (no per-item monotonic counter) is the load-bearing part of the decision, since a counter would introduce exactly the multi-writer race EXT-10 exists to prevent.
- **Task 1's test was written first under a working name** (`get_ceremony_signcount_wire_bytes_decode_to_zero`) and Task 2 renamed it to the plan's mandated permanent name (`sign_count_is_always_zero_for_a_provider_ceremony_assertion`) once the decision record it anchors was written — same test, promoted, not duplicated. This is a documentation/decision-record task rather than new-behavior TDD in the classic RED/GREEN sense (the behavior already existed and already passed as of Task 1's commit); the rename + doc comment in Task 2 did not require a new RED phase since no new production behavior was being introduced.

## Deviations from Plan

None - plan executed exactly as written. Both `<acceptance_criteria>` blocks were verified directly: `cargo test -p pv-provider` green (4 unit + 1 real_rp_verification + 3 response_shape = 8 tests passing), `grep -c 'EXT-10' crates/pv-provider/src/ceremony.rs` = 4 (>= 1), `grep -c 'passkeys.rs' crates/pv-provider/src/ceremony.rs` = 3 (>= 1), and `.planning/PROJECT.md`'s Key Decisions table contains a row whose Decision column starts with `EXT-10`.

## Issues Encountered

None. The plan's suggested verify command `cargo test -p pv-provider response_shape` filters by test function name substring (not file name), so it matches 0 tests in this crate's existing naming convention — confirmed this is a pre-existing harmless pattern (exit code 0 either way, "0 passed; 0 failed" is not a failure) and cross-checked with the unfiltered `cargo test -p pv-provider`, which shows all 8 tests (including the new one) passing.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- EXT-10's decision record is fully anchored: permanent in-process regression (this plan's Task 1/2), file:line-evidenced SEC-04 unreachability finding (Task 2), and the decision recorded in both `ceremony.rs` and `PROJECT.md` per the KEY-05 precedent — all landed before any 27-06 TypeScript-side dependent code.
- 27-06's own headed dual-extension ceremony spec still owes the one remaining evidence tier: the genuine live-wire `credentials.get()` measurement against a real browser and a real RP (this crate has no browser/wire boundary of its own — this plan's Task 1 is the fast in-process fixture, not that measurement).
- No blockers for 27-06 or other Wave-1 siblings. This plan did not touch `extension/e2e/fixtures.ts` or `playwright.config.ts`, so 27-01's `extContextB`/`extensionIdB` additions are untouched.

---
*Phase: 27-extension-integration-shared-items*
*Completed: 2026-08-08*

## Self-Check: PASSED

- FOUND: crates/pv-provider/tests/response_shape.rs
- FOUND: crates/pv-provider/src/ceremony.rs
- FOUND: .planning/PROJECT.md
- FOUND: .planning/phases/27-extension-integration-shared-items/27-02-SUMMARY.md
- FOUND commit: 98b9d35
- FOUND commit: 5902ace
