---
phase: 19-server-supply-chain-hardening
fixed_at: 2026-07-21T12:49:50Z
review_path: .planning/phases/19-server-supply-chain-hardening/19-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 19: Code Review Fix Report

**Fixed at:** 2026-07-21T12:49:50Z
**Source review:** .planning/phases/19-server-supply-chain-hardening/19-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-01, WR-02 — `critical_warning` scope; IN-01/IN-02/IN-03 out of scope)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: Counter-anomaly UPDATE result is silently discarded on failure

**Files modified:** `crates/pv-server/src/routes/passkeys.rs`
**Commit:** `9f67f90`
**Applied fix:** In `handle_finish_auth_error`'s `CredentialPossibleCompromise` branch, replaced
`let _ = sqlx::query(...).execute(db).await;` with `if let Err(err) = ... { tracing::warn!(...) }`.
Adapted the REVIEW.md suggestion (which proposed `tracing::error!`) to match the codebase's own
established best-effort-write convention instead: `me()` (auth.rs:295, `"failed to update session
last_used_at (best-effort, non-fatal)"`) and `persist_state`'s sweep (webauthn_state.rs:36) both use
`tracing::warn!`, not `tracing::error!`, for this exact "DB write failed, log and continue" pattern.
The new log line keeps WR-02's log-hygiene contract intact — only `credential_id` (base64url-encoded),
`user_id`, and the fixed `context` label are logged, alongside the `err` itself; never `passkey_json`,
`prf_salt`, or `prf_wrapped_uk`.

### WR-02: `passkey_login_start` leaks existence of PRF-capable accounts via `prf_salts`

**Files modified:** `crates/pv-server/src/routes/auth.rs`, `crates/pv-server/tests/passkey_login.rs`
**Commit:** `a56e773`
**Applied fix:** `dummy_passkey_login_start_response` previously always returned `prf_salts:
HashMap::new()`, while a real PRF-capable account's response always has a non-empty `prf_salts` map —
an attacker could diff "prf_salts present" to confirm account existence + PRF capability without
holding a credential. Fixed by deriving one stand-in `prf_salts` entry per fabricated
`allowCredentials` id, in the same loop that builds the dummy credential ids: a second
`Sha256(dummy_secret || email || index || b"s")` hash (domain-separated from the existing cred-id
hash by the `b"s"` suffix byte, so it isn't just the same digest re-encoded) produces a 32-byte
value, `STANDARD`-encoded exactly like a genuine `prf_salt` (registration path: `passkeys.rs:97,118`
uses `pv_core::keys::random_bytes(32)` + `STANDARD.encode`), keyed by the same
`URL_SAFE_NO_PAD`-encoded credential id used in `allowCredentials`. Because the derivation is a pure
function of `dummy_secret` + normalized email + index, repeat probes of the same email see
byte-identical `prf_salts` values (verified by the existing
`passkey_login_start_dummy_allow_credentials_stable_across_repeat_probes_same_email` test, which
already covers `allowCredentials` stability and continues to pass unmodified — `prf_salts` uses the
identical per-email/per-index keying).

Added a new test, `passkey_login_start_prf_salts_shape_parity_dummy_vs_real_prf_capable`, that would
have failed against the pre-fix code: it asserts the dummy branch's `prf_salts` map is non-empty, has
exactly one entry per `allowCredentials` id, is keyed by the matching credential id, and each value
decodes to a realistic 32-byte salt — for both the unknown-email and known-email-zero-passkey dummy
paths, cross-checked against a real PRF-capable account's non-empty `prf_salts` shape.

**Scope note:** did not touch webauthn-rs config, migrations, or CORS code, per the task's explicit
exclusions. `login()`'s unrelated timing-parity gap (IN-02) and the `unlock_start` optional-salt
inconsistency (IN-01) are `Info`-tier and out of `critical_warning` scope — left untouched.

## Skipped Issues

None — both in-scope findings were fixed.

---

**Verification performed:**
- `cargo build --workspace` — clean, no warnings/errors, in both the isolated fix commit state and
  the final combined state.
- `cargo test --workspace` — full suite green after each commit (20+4+1+39+2+9+2+5+8+10+4+4+7+5+18+15
  = 153 tests across all crates/test binaries, 0 failed) — includes the pre-existing enumeration-parity
  tests (`passkey_login_start_shape_parity_unknown_vs_zero_passkey_email`,
  `passkey_login_start_dummy_allow_credentials_stable_across_repeat_probes_same_email`,
  `prf_salt_keys_match_credential_id_encoding`) plus the new WR-02 parity test, all passing.
- Both fixes re-read post-edit to confirm no corruption; no rollback was needed.

_Fixed: 2026-07-21T12:49:50Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
