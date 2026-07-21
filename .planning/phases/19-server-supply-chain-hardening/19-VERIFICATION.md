---
phase: 19-server-supply-chain-hardening
verified: 2026-07-21T00:00:00Z
status: passed
score: 4/4 success criteria verified (13/13 plan truths)
behavior_unverified: 0
overrides_applied: 0
---

# Phase 19: Server & Supply-Chain Hardening Verification Report

**Phase Goal:** The server's CORS boundary and supply-chain posture close the gaps the v0.3 codebase sweep flagged, and a regressed WebAuthn sign counter is surfaced instead of silently discarded.
**Verified:** 2026-07-21
**Status:** passed
**Re-verification:** No — initial verification (post review-fix 9f67f90 / a56e773)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SEC-01a | Allow-Headers explicit `[Authorization, Content-Type]`, never `*` | ✓ VERIFIED | `routes/mod.rs:153` `.allow_headers([AUTHORIZATION, CONTENT_TYPE])`; wildcard removed |
| SEC-01b | Real Firefox-shaped preflight with Authorization succeeds on a genuinely bound TCP server | ✓ VERIFIED | `cors_preflight.rs` uses reqwest → bound `TcpListener`; both tests pass (lowercase order + arbitrary casing/order) |
| SEC-02a | Concrete per-install origins only via `AllowOrigin::list`; `moz-extension://*` wildcard gone | ✓ VERIFIED | `routes/mod.rs:147` `AllowOrigin::list(parsed.concrete)`; wildcard branch removed, falls through generic `bail!` |
| SEC-02b | Bare `*` still fatal (WR-07 preserved); concrete moz uuid accepted | ✓ VERIFIED | Unit tests `..rejects_the_wildcard_by_name`, `..bare_wildcard_still_rejected`, `..accepts_a_concrete_moz_extension_uuid_origin`, `..moz_wildcard_no_longer_grants` all pass (16 lib routes tests green) |
| SEC-02c | Firefox lane operator docs list concrete UUIDs | ✓ VERIFIED | `e2e-firefox/README.md:34` lists 4 concrete `moz-extension://<uuid>` origins in the `PV_EXTENSION_ORIGINS` invocation |
| SEC-03a | cargo audit + cargo deny wired in toolchain, fail-loud on missing binary | ✓ VERIFIED | `scripts/check-supply-chain.sh` probes via `cargo audit --version`/`cargo deny --version`, exits 1 with install cmd; runs both. Script exit 0 (advisories/bans/licenses/sources ok) |
| SEC-03b | Toolchain + watch-list crates pinned exact, reviewed vs sweep | ✓ VERIFIED | `rust-toolchain.toml` channel `1.97.0`; exact `=` pins: webauthn-rs=0.5.5, passkey-{authenticator,client,types}=0.5.0, argon2=0.5.3, chacha20poly1305=0.10.1, hkdf=0.12.4. deny.toml watch-list table lists all 9 crates once each with direct/transitive rationale |
| SEC-03c | RUSTSEC-2023-0071 ignore documented with justification | ✓ VERIFIED | `.cargo/audit.toml` ignore carries full sqlx-mysql-not-compiled justification; deny.toml explains why it's NOT in its own ignore list |
| SEC-04a | Regressed counter surfaced (logged + flagged) via deliberately regressed counter test | ✓ VERIFIED | `handle_finish_auth_error()` sets `counter_anomaly_at` + `tracing::warn!` on `CredentialPossibleCompromise`. Test `unlock_counter_regression_flags_anomaly_while_normal_ceremony_stays_clean` passes: regression → 4xx + non-NULL flag; normal → NULL |
| SEC-04b | webauthn-rs hard-fail unmodified; log carries no secret material | ✓ VERIFIED | `require_valid_counter_value` never overridden; warn logs only `URL_SAFE_NO_PAD`-encoded credential_id, user_id, static context — no passkey_json/prf_salt/prf_wrapped_uk |
| SEC-04c | Classifier reused verbatim across all 3 finish call sites | ✓ VERIFIED | `passkeys.rs` prf_wrap (:269) + unlock_finish (:552); `auth.rs:575` imports `super::passkeys::handle_finish_auth_error`, preserves `ENUMERATION_SAFE_FINISH_ERROR` |
| SEC-04d | Both-zero counter exemption completes normally with flag NULL | ✓ VERIFIED | Test Case B asserts fresh credential unlocks with `counter_anomaly_at` NULL |
| SEC-02/parse | Concurrent preflights non-interfering (backstop) | ✓ VERIFIED | `build_cors_layer` is pure/env-free, no shared mutable state; `CorsLayer` cloned per-request by tower — no evidence of shared state |

**Score:** 4/4 success criteria; 13/13 plan truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `crates/pv-server/src/routes/mod.rs` (CORS) | ✓ VERIFIED | Explicit header allowlist + `AllowOrigin::list`; wildcard parser bails loud |
| `crates/pv-server/tests/cors_preflight.rs` | ✓ VERIFIED | Real-socket reqwest preflight, 2 tests pass |
| `crates/pv-server/migrations/0013_passkey_counter_anomaly.sql` | ✓ VERIFIED | Additive `ALTER TABLE passkeys ADD COLUMN counter_anomaly_at TEXT` |
| `handle_finish_auth_error()` (passkeys.rs) | ✓ VERIFIED | Present, wired to 3 call sites, secret-safe logging |
| `deny.toml` | ✓ VERIFIED | advisories/bans/licenses/sources policy + watch-list table |
| `scripts/check-supply-chain.sh` | ✓ VERIFIED | Executable, fail-loud, runs both tools; exit 0 |
| `rust-toolchain.toml` | ✓ VERIFIED | Pinned `1.97.0` (was floating `stable`) |

### Prohibitions (negative checks)

| Prohibition | Tier | Status | Evidence |
|-------------|------|--------|----------|
| No wildcard-shaped origin retained/documented (SEC-02) | test | ✓ VERIFIED | `parse_extension_origins_moz_wildcard_fails_with_same_error_shape` asserts no D-10/carve-out language survives |
| MUST NOT weaken counter hard-fail (SEC-04) | test | ✓ VERIFIED | Regression test asserts ceremony still 4xx-fails; `require_valid_counter_value` untouched |
| MUST NOT log/persist secret material on anomaly (SEC-04) | test | ✓ VERIFIED | Code read: only encoded credential_id/user_id/context logged; DB write is timestamp-only |
| MUST NOT ignore advisory without justification (SEC-03) | test | ✓ VERIFIED | `.cargo/audit.toml` + deny.toml both carry inline justification |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SEC-04 counter regression state transition | `cargo test -p pv-server --test unlock unlock_counter_regression...` | 1 passed | ✓ PASS |
| SEC-01 real preflight header value | `cargo test -p pv-server --test cors_preflight` | 2 passed | ✓ PASS |
| SEC-02 wildcard rejection / concrete accept | `cargo test -p pv-server --lib routes` | 16 passed | ✓ PASS |
| SEC-03 tripwire runs clean | `bash scripts/check-supply-chain.sh` | exit 0, "advisories ok, bans ok, licenses ok, sources ok" | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| SEC-01 | 19-01 | ✓ SATISFIED | Explicit Allow-Headers + real preflight proof |
| SEC-02 | 19-01 | ✓ SATISFIED | Concrete origins, wildcard removed, WR-07 preserved |
| SEC-03 | 19-03 | ✓ SATISFIED | audit+deny tripwire, exact pins, documented ignore |
| SEC-04 | 19-02 | ✓ SATISFIED | Counter anomaly flagged + logged, hard-fail intact |

_Note (info, non-blocking):_ REQUIREMENTS.md still shows SEC-01..04 as `[ ]` / "Pending" in the traceability table (lines 45–48, 94–97). This is bookkeeping to update at phase close; it does not affect goal achievement — the code deliverables are all present and proven.

### Anti-Patterns Found

None. No TODO/FIXME/XXX/TBD/unimplemented markers in any modified server source, script, or policy file.

### Gaps Summary

No gaps. All four success criteria are met with behavioral evidence: the CORS boundary lists Authorization explicitly and is proven against a real bound server; the `moz-extension://*` wildcard is removed with concrete origins only and bare `*` still fatal; the supply-chain tripwire (cargo audit + cargo deny) runs clean with pinned toolchain and watch-list crates; and a regressed sign counter is surfaced via a persisted `counter_anomaly_at` flag and a secret-safe warn log, verified by a deliberately regressed-counter test that also confirms the hard-fail and both-zero exemption are unchanged.

---

_Verified: 2026-07-21_
_Verifier: Claude (gsd-verifier)_
