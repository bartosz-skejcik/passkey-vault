---
phase: 2
slug: password-auth-vault-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-12
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (pv-core, pv-wasm, pv-server incl. new axum integration tests) + vitest (web) |
| **Config file** | Cargo.toml (workspace); web/vitest.config.ts (exists from Phase 1) |
| **Quick run command** | `cargo test -p pv-core -p pv-wasm` |
| **Full suite command** | `cargo test --workspace && (cd web && npm test) && (cd web && npm run build)` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the crate-scoped test for the touched crate (`cargo test -p <crate>` or `cd web && npm test`)
- **After every plan wave:** Run full suite
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| *(filled by planner)* | | | AUTH-01, AUTH-02, AUTH-08, VAULT-01..06, UI-03 | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `pv-server` integration test harness — axum + SQLx test pool (tempfile or `:memory:?cache=shared` DB per RESEARCH.md gotcha), register/login/session fixtures
- [ ] `pv-core` AD-binding tests — mutation of AD context (item_id, revision) MUST fail decryption (VAULT-02 criterion)
- [ ] Update Phase 1 self-test + vitest mocks for the new AD-carrying signatures (breaking-change ripple flagged in RESEARCH.md)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Login vs unlock are visibly distinct states; blurred lock overlay with no plaintext in DOM | AUTH-02, AUTH-08 | Visual states + DOM inspection in a real browser | Register, log in, lock, inspect DOM behind blur, unlock |
| Vault list+detail UX, i18n toggle, copy toast countdown, generator UX | UI-03, VAULT-05/06 | Visual/interactive appearance | Manual walkthrough per UI-SPEC |
| Clipboard actually cleared after 40s | VAULT-06 | Requires OS clipboard + focus semantics | Copy password, wait, paste elsewhere |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
