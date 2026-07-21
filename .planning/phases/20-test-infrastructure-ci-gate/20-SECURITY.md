---
phase: 20
slug: test-infrastructure-ci-gate
status: secured
threats_open: 0
asvs_level: 1
created: 2026-07-21
---

# Phase 20 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| pv-provider ceremony output → MAIN-world page-bridge | The JSON `response_shape.rs` gates is the exact wire contract a browser RP consumes; silent shape regression = XBR-02 blast radius | WebAuthn response fields (base64url strings) |
| GitHub Actions runner ← repo code + PR diffs | Future PRs (incl. forks once a remote exists) run arbitrary repo code in CI; no production secrets configured in the workflow | Source code, build artifacts |
| CI workflow ← third-party Marketplace Actions | `actions/checkout`, `actions/setup-node`, `actions-rust-lang/setup-rust-toolchain` execute with the job's permissions | Runner environment |
| Harness-spawned Firefox profile (local only) | Prefs apply only inside throwaway `.ff-profile-*` dirs — never the real profile, never a shipped artifact | Test-harness preferences |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-20-01-01 | Tampering | `serialize_bytes_as_base64_string` feature flag (pv-provider) | high | mitigate | Field-enumerating unit test `response_shape.rs` (2 tests green) with performed-and-reverted red/green negative-control proof (feature disabled → test fails, 20-01-SUMMARY) | closed |
| T-20-01-02 | Tampering | `response_shape.rs` silently passing on partial field list | medium | mitigate | Every always-present Bytes field from `AuthenticatorAttestationResponse`/`AuthenticatorAssertionResponse` enumerated; optional fields asserted-when-present, never skipped | closed |
| T-20-01-SC | Tampering | package-manager installs (20-01) | n/a | accept | Zero new dependencies — test file only, against already-pinned crates | closed |
| T-20-02-01 | Information Disclosure | UAT credentials in e2e-firefox README/scripts | low | mitigate (upgraded from accept) | WR-04 review fix REMOVED the committed password defaults entirely — all lanes now fail fast unless `PV_UAT_PASSWORD`/`PV_PROBE_PASSWORD` are exported; README env contract updated to match; lanes never invoked from cloud CI | closed |
| T-20-02-SC | Tampering | package-manager installs (20-02) | n/a | accept | Zero new dependencies — npm script strings + README prose only | closed |
| T-20-03-01 | DoS (harness) | Unattended OS dialog from harness Firefox profile | medium | mitigate | `ff-profile-prefs.cjs` suppresses native WebAuthn platform UI in the 4 throwaway profiles; live proof in 20-03-SUMMARY; todo resolved | closed |
| T-20-03-02 | Tampering | Pref suppression masking fallthrough-detection regression | low | accept | Live proof re-confirmed native-fallthrough rows still reach honest rejection under new prefs; harness-only file, never shipped | closed |
| T-20-03-SC | Tampering | package-manager installs (20-03) | n/a | accept | Zero new dependencies — local `.cjs` helper + 4 wiring edits | closed |
| T-20-04-01 | Tampering | Marketplace actions in ci.yml | high | mitigate | WR-03 review fix upgraded the plan's tag pins to full commit-SHA pins (`@11bd719… # v4.2.2` etc.) — stronger than the plan's own mitigation; grep-verified all `uses:` lines | closed |
| T-20-04-02 | Information Disclosure | CI YAML / job logs | high | mitigate | Grep-verified: no password/token/secret/`moz-extension` UUID in ci.yml; Firefox harness lanes excluded from cloud CI by design; `NEXT_PUBLIC_API_BASE_URL=""` is a public constant | closed |
| T-20-04-03 | Repudiation (false green) | `web-ext lint`/MAIN-world audit on missing build output | medium | mitigate | Grep-verified step order: both `wxt build` steps (l.84,87) precede `lint:firefox` (l.90) and `audit-mainworld-boundary.sh` (l.93) | closed |
| T-20-04-04 | Tampering | `cargo install` of audit/deny binaries on runner | medium | mitigate | `cargo install --version 0.22.2 cargo-audit --locked` / `--version 0.20.2 cargo-deny --locked` (l.103,105), crates.io only, matches check-supply-chain.sh pins (R-19-03 closed for CI) | closed |
| T-20-04-05 | Tampering | CI wiring weakening existing gates | high | mitigate | Grep-verified: zero `\|\| true` / `continue-on-error` in ci.yml; every step is the unmodified already-green gate command; WR-02 fix added `permissions: contents: read` (least-privilege token) | closed |
| T-20-04-SC | Tampering | package-manager installs (20-04) | n/a | accept | No new npm/PyPI/crates.io packages; `taiki-e/install-action` ([SUS] in research) explicitly NOT adopted | closed |

*Status: open · closed · open — below high threshold (non-blocking)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-20-01 | T-20-03-02 | Native-UI suppression is harness-profile-only and live-proven not to change ceremony logic (fallthrough rows still honestly reject) | autonomous run (plan-time, live-verified) | 2026-07-21 |
| R-20-02 | T-20-{01,02,03,04}-SC | Phase introduces zero new package-manager dependencies across all 4 plans; only external references are SHA-pinned official GitHub Actions | autonomous run (plan-time) | 2026-07-21 |
| R-20-03 | T-20-04 boundary | CI has never run in the cloud (repo has no git remote); the "green vs main" proof is a local full-gate run (20-04-SUMMARY). First push/PR will observe the real runner — documented follow-up, not a silent gap | autonomous run | 2026-07-21 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-21 | 14 | 14 | 0 | secure-phase (L1 short-circuit: plan-time register, grep-verified mitigations, post-review fixes CR-01/WR-01..05 folded in) |
