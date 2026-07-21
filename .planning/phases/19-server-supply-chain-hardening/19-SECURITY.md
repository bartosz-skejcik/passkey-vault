---
phase: 19
slug: server-supply-chain-hardening
status: secured
threats_open: 0
asvs_level: 1
created: 2026-07-21
---

# Phase 19 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| CORS allowlist | Server accepts cross-origin requests only from concrete configured origins | Extension/web origin (no wildcard) |
| WebAuthn assertion → session | Counter regression indicates a cloned/duplicated authenticator | Sign counter (metadata, no key material) |
| Supply chain | Crate versions + audit/deny tooling gate what enters the build | Pinned dependency versions |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-19-01 | Spoofing | AllowOrigin predicate (wildcard removal) | high | mitigate | Concrete-origin allowlist only; WR-07 bare-`*` test green; wildcard shapes fail loud via parse_extension_origins (16 CORS tests pass) | closed |
| T-19-02 | Information Disclosure | Access-Control-Allow-Headers explicit list | medium | mitigate | `[AUTHORIZATION, CONTENT_TYPE]` replaces `Any`; cors_preflight.rs asserts real-socket header value contains `authorization`, never `*` | closed |
| T-19-03 | Tampering | reqwest dev-dependency | low | accept | Official crates.io crate, dev-only, never in production binary (19-RESEARCH Package Legitimacy Audit) | closed |
| T-19-04 | Denial of Service | test_server() ephemeral TCP listener | low | accept | OS-assigned ephemeral port, reclaimed on process exit; matches existing sync.rs WS suite | closed |
| T-19-05 | Repudiation/Spoofing | Cloned authenticator w/ regressed counter | critical | mitigate | webauthn-rs `require_valid_counter_value` hard-fail UNCHANGED; classifier only adds distinguishable log+flag on the already-rejected path; regression test asserts ceremony still fails 4xx | closed |
| T-19-06 | Information Disclosure | Counter-anomaly logging/persistence | medium | mitigate | Logs only base64url credential id + user id + fixed context label; never passkey_json/prf_salt/prf_wrapped_uk; WR-01 review fix added warn-log on write failure (no material leak) | closed |
| T-19-07 | Tampering | Migration 0013 vs passkey_json blob | high | mitigate | Additive-only `ALTER TABLE ADD COLUMN counter_anomaly_at`; cargo test --workspace green post-migration proves round-trip integrity | closed |
| T-19-08 | Elevation of Privilege | Counter-anomaly UPDATE scoping | low | mitigate | UPDATE scoped `AND user_id = ?` with server-trusted user id — no cross-user flagging via forged raw_id | closed |
| T-19-09 | Tampering | Floating crate versions drifting | high | mitigate | Exact `=x.y.z` pins for all directly-declared watch-list crates; Cargo.lock byte-unchanged (pins match reviewed resolution) | closed |
| T-19-10 | Tampering | Unpatched transitive dep / RustSec advisory | high | mitigate | cargo audit + cargo deny via check-supply-chain.sh (exit 0: advisories/bans/licenses/sources ok); RUSTSEC-2023-0071 (rsa via sqlx, unfixable) ignore documented in .cargo/audit.toml + deny.toml | closed |
| T-19-11 | Tampering | Single-maintainer passkey-rs staleness | medium | mitigate | cargo-deny `[sources] unknown-registry/unknown-git = "deny"` blocks non-crates.io substitution; version exact-pinned | closed |
| T-19-12 | Tampering | audit/deny binary install source | low | mitigate | `cargo install --version =0.22.2 / =0.20.2 --locked` from crates.io (official RustSec/EmbarkStudios tools) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-19-01 | T-19-03/04 | reqwest is dev-only (never shipped); test_server ephemeral port self-cleans — both match existing accepted patterns | autonomous run (plan-time) | 2026-07-21 |
| R-19-02 | T-19-10 | RUSTSEC-2023-0071 (Marvin timing on rsa, pulled transitively by sqlx's MySQL feature which this project does not use) has no fixed version; ignore documented in both .cargo/audit.toml and deny.toml with rationale | autonomous run (review-confirmed) | 2026-07-21 |
| R-19-03 | supply-chain | cargo-audit/cargo-deny installed to ~/.cargo/bin (machine-global, not repo-tracked); Phase 20 CI (QA-01) needs its own install step on a fresh runner | autonomous run | 2026-07-21 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-21 | 12 | 12 | 0 | secure-phase orchestrator (register authored at plan time, ASVS L1; mitigations automated + code-review WR-01/WR-02 hardening + verifier 4/4 SC confirmation) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
