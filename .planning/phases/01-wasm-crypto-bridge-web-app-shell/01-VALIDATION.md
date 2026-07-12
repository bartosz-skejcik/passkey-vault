---
phase: 1
slug: wasm-crypto-bridge-web-app-shell
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| *(filled by planner)* | | | UI-01 | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/pv-wasm` test module — round-trip unit tests compiled natively (derive → wrap → unwrap → encrypt → decrypt)
- [ ] `web/` vitest install + config — facade-level tests for `lib/crypto/`
- [ ] `scripts/build-wasm.sh` — build must succeed as a checkable command

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Themed shell renders correctly (dark default, light toggle) | UI-01 | Visual appearance not assertable in unit tests | `cd web && npm run dev`, load app, toggle theme, compare to docs/UI-DESIGN.md tokens |
| Crypto self-test card shows all steps ✓ in a real browser | UI-01 | Requires real browser WASM runtime + getrandom wasm_js path | Load home route, observe per-step ✓ results |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
