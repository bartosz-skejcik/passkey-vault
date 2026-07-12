---
phase: 1
slug: wasm-crypto-bridge-web-app-shell
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-12
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (Rust workspace) + vitest (web, Wave 0 installs) |
| **Config file** | Cargo.toml (workspace); web vitest config — none yet, Wave 0 installs |
| **Quick run command** | `cargo test -p pv-core -p pv-wasm` |
| **Full suite command** | `cargo test --workspace && (cd web && npm test)` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p pv-core -p pv-wasm`
- **After every plan wave:** Run full suite + `bash scripts/build-wasm.sh` + `cd web && npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | UI-01 | T-01-01 | Raw key bytes never returned across WASM boundary (opaque handles) | unit | `cargo test -p pv-wasm` | ✅ | ✅ green |
| 01-01-02 | 01 | 1 | UI-01 | — | Version-pinned reproducible WASM build; single getrandom major | build | `bash scripts/build-wasm.sh && cargo build -p pv-wasm --target wasm32-unknown-unknown --release` | ✅ | ✅ green |
| 01-02-02 | 02 | 2 | UI-01 | T-02-SC | Static export only (no SSR — zero-knowledge) | build | `cd web && npm run build` | ✅ | ✅ green |
| 01-03-01 | 03 | 3 | UI-01 | — | lib/crypto sole WASM importer; handles freed on all paths; password zeroized | unit | `cd web && npm test` | ✅ | ✅ green |
| 01-03-02 | 03 | 3 | UI-01 | — | Self-test round-trip wired to real facade | build+manual | `cd web && npm run build` + human checkpoint (approved 2026-07-12) | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `crates/pv-wasm` test module — round-trip unit tests compiled natively (derive → wrap → unwrap → encrypt → decrypt)
- [x] `web/` vitest install + config — facade-level tests for `lib/crypto/`
- [x] `scripts/build-wasm.sh` — build must succeed as a checkable command

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Themed shell renders correctly (dark default, light toggle) | UI-01 | Visual appearance not assertable in unit tests | `cd web && npm run dev`, load app, toggle theme, compare to docs/UI-DESIGN.md tokens |
| Crypto self-test card shows all steps ✓ in a real browser | UI-01 | Requires real browser WASM runtime + getrandom 0.2 `js` path | Load home route, observe per-step ✓ results |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-12

---

## Validation Audit 2026-07-12

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All automatable UI-01 behaviors covered green (cargo 10 tests, vitest 4 tests, WASM + static-export builds). Visual checks are manual-only and were human-verified at the plan 01-03 blocking checkpoint. Deferred info items from code review (IN-01..IN-06, incl. real-WASM integration test) tracked in 01-REVIEW.md.
