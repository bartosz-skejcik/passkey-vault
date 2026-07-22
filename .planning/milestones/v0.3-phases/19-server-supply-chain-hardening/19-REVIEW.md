---
phase: 19-server-supply-chain-hardening
reviewed: 2026-07-21T12:43:16Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/passkeys.rs
  - crates/pv-server/src/routes/auth.rs
  - crates/pv-server/tests/common/mod.rs
  - crates/pv-server/tests/cors_preflight.rs
  - crates/pv-server/tests/unlock.rs
  - crates/pv-server/migrations/0013_passkey_counter_anomaly.sql
  - crates/pv-server/Cargo.toml
  - Cargo.toml
  - rust-toolchain.toml
  - deny.toml
  - .cargo/audit.toml
  - scripts/check-supply-chain.sh
  - extension/e2e-firefox/README.md
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 19: Code Review Report

**Reviewed:** 2026-07-21T12:43:16Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

Phase 19 hardens three surfaces: CORS (SEC-01 explicit `allow_headers`, SEC-02
concrete-origins-only with the `moz-extension://*` wildcard removed), a WebAuthn
sign-counter anomaly signal (SEC-04, additive migration + shared
`handle_finish_auth_error` classifier across the three `finish_passkey_authentication`
call sites), and supply-chain tooling (SEC-03, cargo-audit/cargo-deny pins + policy files).

The core security posture holds up under adversarial reading:

- **CORS fails closed.** `build_cors_layer` and `parse_extension_origins` reject
  `*` and every wildcard shape, never panic, and degrade to no-CORS on bad input;
  `Config::validate()` is the loud startup gate. The real-socket preflight test
  proves `Access-Control-Allow-Headers` lists `authorization` and is never `*`.
  No `allow_credentials(true)` is set, which is correct for this Bearer-token
  (non-cookie) design, so `allow_methods(Any)` is safe.
- **Counter regression stays fail-closed.** `require_valid_counter_value` is never
  overridden; the classifier only records/logs the already-rejected path and never
  changes ceremony outcome. The migration is additive (`ADD COLUMN ... TEXT`, NULL
  default = "never observed"), matching the stated additivity requirement.
- **Log hygiene (WR-02) is respected.** The classifier logs only base64url
  `credential_id`, `user_id`, and a fixed `context` label — never `passkey_json`,
  `prf_salt`, or `prf_wrapped_uk`. The credential id logged is the client-request id
  reached only after webauthn-rs matched a real candidate, and the anomaly UPDATE is
  additionally `AND user_id = ?` scoped, so no cross-user write is possible.
- **RUSTSEC-2023-0071 ignore is documented.** Justified in `.cargo/audit.toml`
  (cargo-audit's whole-lockfile scan) and explained as deliberately *absent* from
  `deny.toml` (feature-aware, never raises it). Reasoning is sound and traceable.

Two warnings and three info items follow. No blockers: nothing in the phase's
changes introduces a crash, data-loss, auth-bypass, or injection defect.

## Warnings

### WR-01: Counter-anomaly UPDATE result is silently discarded on failure

**File:** `crates/pv-server/src/routes/passkeys.rs:330-336`
**Issue:** In `handle_finish_auth_error`, the whole purpose of SEC-04 is to make a
possible authenticator compromise *visible to the operator*. On the
`CredentialPossibleCompromise` branch the anomaly write is executed as
`let _ = sqlx::query(...).execute(db).await;` — the `Result` is dropped with no
log. If that write fails (busy DB, lock contention, migration drift), the anomaly
timestamp is never persisted AND nothing is logged, so the security signal can be
lost with zero trace. This diverges from the codebase's own best-effort convention:
`me()` (auth.rs:294) and `persist_state` (webauthn_state.rs) both `tracing::warn!`
when a best-effort write fails. The warn-level "counter regression detected" line
still fires, but the durable DB record it exists to create can silently not happen.
**Fix:** Log on write failure instead of discarding it:
```rust
if let Err(err) = sqlx::query(
    "UPDATE passkeys SET counter_anomaly_at = datetime('now') WHERE credential_id = ? AND user_id = ?",
)
.bind(credential_id)
.bind(user_id)
.execute(db)
.await
{
    tracing::error!(?err, user_id, "failed to persist counter_anomaly_at (compromise signal may be lost)");
}
```

### WR-02: `passkey_login_start` leaks existence of PRF-capable accounts via `prf_salts`

**File:** `crates/pv-server/src/routes/auth.rs:378-388` vs `493` (dummy branch)
**Issue:** The enumeration-resistance contract (threat_model T-04-01) requires the
unknown-email / zero-passkey dummy response to be indistinguishable from a real
account's `/passkey-login/start` response. The dummy branch hard-codes
`prf_salts: HashMap::new()` (auth.rs:493), but the real branch populates `prf_salts`
for every `prf_capable` credential. A real account with ≥1 PRF-capable passkey
therefore returns a **non-empty** `prf_salts` map, while unknown-email and
known-email-zero-passkey both return empty. An attacker can diff `prf_salts` presence
to confirm "this email exists and has a PRF-capable passkey" without ever holding a
credential — the exact oracle the dummy `allowCredentials` construction (which the
dummy branch *does* mimic) was written to close. This is pre-existing Phase 4 code,
but the phase's stated watch item is enumeration-safety, so it is in scope.
**Fix:** Emit a plausible, `dummy_secret`-derived stand-in `prf_salts` map from the
dummy branch (one entry per fabricated `allowCredentials` id, keyed by the same
`URL_SAFE_NO_PAD` credential id) so the field's populated/empty shape no longer
distinguishes a real PRF-capable account from an unknown one — mirroring how the
dummy `allowCredentials` list already fabricates realistic entries.

## Info

### IN-01: `unlock_start` reads `prf_salt` as non-optional while `passkey_login_start` treats it optional

**File:** `crates/pv-server/src/routes/passkeys.rs:487`
**Issue:** `let prf_salt: Vec<u8> = row.try_get("prf_salt")` will 500 (`ApiError::Internal`)
if a `prf_capable = 1` row ever had a NULL `prf_salt`. It is currently unreachable
(registration always persists a salt), but `passkey_login_start` (auth.rs:377) reads
the same column as `Option<Vec<u8>>`. The inconsistency is a latent robustness gap.
**Fix:** Read as `Option<Vec<u8>>` and skip/log rows with a missing salt, matching the
login path's defensive handling.

### IN-02: `login()` unknown-email timing parity is broken for malformed base64 input

**File:** `crates/pv-server/src/routes/auth.rs:182-200`
**Issue:** For a *known* email, a malformed base64 `auth_hash` returns `Unauthorized`
early (auth.rs:195) *before* `server_rehash`, whereas the unknown-email branch always
runs `decode().unwrap_or_default()` + `server_rehash` + `constant_time_eq`
(auth.rs:182-184). This asymmetry only manifests on malformed input and the cost gap
is a single SHA-256 (sub-microsecond), so it is far below network jitter and not
practically exploitable — but it does contradict the branch's own "same cost" comment.
Pre-existing (Phase 3), not a Phase 19 change.
**Fix:** In the known-email branch, decode with `.unwrap_or_default()` and always run
the rehash + constant-time compare rather than returning early on decode failure, so
both branches perform identical work regardless of input shape.

### IN-03: Supply-chain script does not pin `--locked` / offline advisory DB

**File:** `scripts/check-supply-chain.sh:39-42`
**Issue:** `cargo audit` and `cargo deny check` run against the current advisory DB
with no `--frozen`/`--locked`, so a `Cargo.lock` that drifts from the committed tree
(or an advisory-DB fetch failure) could produce a result that differs from what CI
sees. Fail-loud presence checks and `set -euo pipefail` are correctly in place; this
is only a reproducibility nit for Phase 20's CI wiring.
**Fix:** Consider `cargo deny --locked check` and documenting the pinned advisory-DB
refresh behavior when this is wired into CI (QA-01).

---

_Reviewed: 2026-07-21T12:43:16Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
