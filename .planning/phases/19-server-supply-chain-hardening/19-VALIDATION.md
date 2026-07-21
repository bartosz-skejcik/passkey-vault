---
phase: 19
slug: server-supply-chain-hardening
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-21
---

# Phase 19 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (workspace, incl. new real-TCP integration tests), cargo-audit/cargo-deny (new tooling), shell script gate |
| **Config file** | Cargo workspace; `deny.toml` (new, 19-03) |
| **Quick run command** | `cargo test -p pv-server <touched test file>` |
| **Full suite command** | `cargo test --workspace` (boots app, runs migrations) + `scripts/check-supply-chain.sh` |
| **Estimated runtime** | workspace tests ~2-4 min; supply-chain script ~1-2 min |

---

## Sampling Rate

- **After every task commit:** touched crate's `cargo test -p pv-server` (scoped test)
- **After every plan wave:** `cargo test --workspace`
- **Before `/gsd-verify-work`:** workspace green + supply-chain script exit 0 + WR-07 test green + e2e-firefox lane docs consistent
- **Max feedback latency:** ~4 min (workspace suite)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 19-01-01 | 01 | 1 | SEC-02 | WR-07 | wildcard branch removed; bare * rejected; concrete origins only | unit+integration | `cargo test -p pv-server` (CORS tests) | ✅ | ⬜ pending |
| 19-01-02 | 01 | 1 | SEC-01 | — | explicit allow_headers; real-TCP preflight with Authorization succeeds | integration (real server) | `cargo test -p pv-server --test cors_preflight` | ✅ W0-inline | ⬜ pending |
| 19-01-03 | 01 | 1 | SEC-02 | lane continuity | 4 Firefox lane origins documented; lanes stay runnable | docs+grep | README/lane grep assertions | ✅ | ⬜ pending |
| 19-02-01 | 02 | 1 | SEC-04 | additive-only migration | 0013 migration adds counter_anomaly_at; passkey_json untouched | migration+boot | `cargo test --workspace` (migrations run at boot) | ✅ | ⬜ pending |
| 19-02-02 | 02 | 1 | SEC-04 | log hygiene (WR-02) | shared classifier logs anomaly w/o credential material | unit | scoped grep + `cargo test -p pv-server` | ✅ | ⬜ pending |
| 19-02-03 | 02 | 1 | SEC-04 | fail-closed preserved | deliberately regressed counter → ceremony fails AND anomaly flagged; both-zero exempt | integration | `cargo test -p pv-server` (counter regression test) | ✅ | ⬜ pending |
| 19-03-01 | 03 | 2 | SEC-03 | supply-chain pins | rust-toolchain pinned exact; watch-list =x.y.z pins | source+build | `cargo build` + pin grep | ✅ | ⬜ pending |
| 19-03-02 | 03 | 2 | SEC-03 | official tools only | cargo-audit/cargo-deny installed (pinned), deny.toml committed | tooling | `scripts/check-supply-chain.sh` exit code contract | ✅ | ⬜ pending |
| 19-03-03 | 03 | 2 | SEC-03 | — | watch-list review table complete (incl. transitive getrandom/openssl-sys) | docs | deny.toml/table grep | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/pv-server/tests/cors_preflight.rs` — created inline by 19-01 Task 2 (real-TCP preflight proof; reuses existing `test_server()` harness)
- [ ] `deny.toml` + `scripts/check-supply-chain.sh` — created inline by 19-03

---

## Manual-Only Verifications

All phase behaviors have automated verification. (The "Firefox preflight" proof is satisfied by the real-TCP OPTIONS test asserting the exact headers Firefox sends; a live-browser corroboration ride-along can happen in Phase 20's lane wiring.)

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (both W0 items created inline by their own plans)
- [x] No watch-mode flags
- [x] Feedback latency < 300s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-21 (map populated from 3 checker-verified plans; created post-check to close the checker's 8e blocker)
