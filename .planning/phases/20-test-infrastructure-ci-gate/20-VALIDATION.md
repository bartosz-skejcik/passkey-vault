---
phase: 20
slug: test-infrastructure-ci-gate
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
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
| (filled at plan time by planner) | — | — | QA-01, QA-02, QA-04 | — | CI gate reproduces the full verification surface; no false-green | CI + unit + docs | see full suite command | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (research-enumerated gaps)

- [ ] `web/package.json` gains a `typecheck`/`compile` script (`tsc --noEmit`) — SC1 requires "tsc (both)" but web has none
- [ ] `probe-request-xray.cjs` + `probe-provider-corruption.cjs` gain `test:e2e:firefox:*` npm scripts (currently unwired) + README lane docs; `probe-window-geometry` README entry added
- [ ] new QA-04 Rust unit test (base64url byte-shape for every binary WebAuthn response field) — created inline
- [ ] `.github/workflows/ci.yml` — created inline

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
