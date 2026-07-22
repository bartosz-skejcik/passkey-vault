---
phase: 20
slug: test-infrastructure-ci-gate
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
validated: 2026-07-21
created: 2026-07-21
---

# Phase 20 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | GitHub Actions CI (the deliverable), cargo test, vitest (web+ext), tsc, wxt build, web-ext lint, MAIN-world audit script, new Rust unit test (QA-04) |
| **Config file** | `.github/workflows/ci.yml` (new); rust-toolchain.toml (1.97.0, Phase 19) |
| **Quick run command** | the individual gate command being edited |
| **Full suite command** | the CI job command list run locally: WASM build + pv-ui ci + web/ext ci + cargo test --workspace + both vitest + both tsc + both wxt build + web-ext lint + audit-mainworld-boundary.sh |
| **Estimated runtime** | full gate ~8-15 min |

---

## Sampling Rate

- **After every task commit:** the touched gate command runs green locally
- **After every plan wave:** full local gate command list green
- **Before `/gsd-verify-work`:** CI YAML valid (actionlint or push), full gate green vs current main, QA-04 test red-on-regression proven
- **Max feedback latency:** per-command <5min; full gate ~15min

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| response-shape gate | 20-01 | 1 | QA-04 | D-21 class | byte-shape regression panics field-named on number-array | Rust unit | `cargo test -p pv-provider --test response_shape` | ✅ | ✅ green |
| probe lane wiring | 20-02 | 1 | QA-02 | — | every real-Firefox probe reachable via npm script, no false-green (CR-01: exit 1 on FAIL/CORRUPTED) | npm scripts + `node --check` | `node --check extension/e2e-firefox/*.cjs` | ✅ | ✅ green |
| ff-profile-prefs helper | 20-03 | 1 | QA-02 | — | macOS passkey sheet suppressed in automation (no OS dialogs) | live-Firefox proof (20-03-SUMMARY) | shared helper consumed by all lanes | ✅ | ✅ green |
| CI workflow | 20-04 | 2 | QA-01 | supply-chain (WR-02/03 fixed) | 4-job gate mirrors full SC1 surface; `permissions: contents: read`; SHA-pinned actions | CI YAML + local full-gate run | full gate command list (20-04-SUMMARY: green vs main) | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (research-enumerated gaps)

- [x] `web/package.json` gains a `compile` script (`tsc --noEmit`) — delivered in 20-04
- [x] `probe-request-xray.cjs` + `probe-provider-corruption.cjs` gain `test:e2e:firefox:*` npm scripts + README lane docs (6 lanes); `probe-window-geometry` README entry added — delivered in 20-02
- [x] new QA-04 Rust unit test (base64url byte-shape for every binary WebAuthn response field) — `crates/pv-provider/tests/response_shape.rs`, 2 tests green
- [x] `.github/workflows/ci.yml` — 4 jobs (rust/web/extension/supply-chain), local full-gate green vs main

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-Firefox probe lanes actually pass headed | QA-02 | Headed Firefox + live pv-server not cloud-CI-runnable; QA-02 bar is "wired + documented," not "run in cloud" | Each `test:e2e:firefox:*` lane runnable locally per README with the right PV_EXTENSION_ORIGINS (post-SEC-02 concrete origins) |
| CI green vs current main | QA-01 | Requires an actual push/PR to observe the runner | Push to a branch / open PR; confirm the workflow run is green |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (4 gaps enumerated above)
- [x] No watch-mode flags
- [x] Feedback latency acceptable (CI is inherently minutes)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-21 (seeded from research Validation Architecture; per-task map filled at plan time)

---

## Validation Audit 2026-07-21

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All 4 Wave-0 items delivered and green (VERIFICATION 3/3 SC; spot-runs: `cargo test -p pv-provider --test response_shape` 2 passed, `node --check` on all modified probes OK). Manual-only rows unchanged: headed real-Firefox lanes (local by design, post-SEC-02 concrete origins) and cloud CI run (no git remote yet — first push/PR will observe the runner). Post-review hardening folded in: CR-01 exit-1 on FAIL/CORRUPTED, WR-01..05 (permissions, SHA pins, fail-fast passwords, awaited ceremony script).
