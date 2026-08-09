---
phase: 23
slug: sync-model-extension-shared-data-fan-out
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-30
---

# Phase 23 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Rust: `cargo test` (unit + `crates/pv-server/tests/*.rs` integration) · Web: vitest 3.x · **NEW this phase:** `@playwright/test` in `web/` |
| **Config file** | `Cargo.toml` (workspace) · `web/vitest.config.ts` · **NEW:** `web/playwright.config.ts` (Wave 0 creates) |
| **Quick run command** | `cargo test -p pv-server` |
| **Full suite command** | `cargo test --workspace && (cd web && npm test && npm run compile)` |
| **Estimated runtime** | ~60-120 s (Rust workspace) · ~30 s (web vitest) · Playwright multi-session suite TBD by planner |

---

## Sampling Rate

- **After every task commit:** Run `cargo test -p pv-server` (server tasks) or `cd web && npm test` (web tasks)
- **After every plan wave:** Run `cargo test --workspace && (cd web && npm test && npm run compile)`
- **Before `/gsd-verify-work`:** Full suite green + the new Playwright multi-session suite green
- **Max feedback latency:** ~120 s

---

## Per-Task Verification Map

*Populated by `/gsd-validate-phase` after plans exist. Seeded here as a contract.*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | SYNC-04..08, SEC-08 | TBD | TBD | TBD | TBD | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `web/playwright.config.ts` — **new**, `web/` has no Playwright today (only `extension/playwright.config.ts` exists)
- [ ] `web/e2e/` directory + fixtures — two isolated `browser.newContext()` sessions, real `pv-server` + temp SQLite DB via `webServer`
- [ ] `@playwright/test` devDependency in `web/package.json` — reuse the version already vetted in `extension/package.json`
- [ ] `web/package.json` `test:e2e` script
- [ ] Rust: **no new dependencies** — `tokio-tungstenite`, `futures-util`, `reqwest` are already pinned dev-dependencies (verified by 23-RESEARCH.md)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| *(none anticipated)* | SEC-08 | SEC-08 exists specifically to **convert** the v0.1-era manual "zweryfikowane live w 2 kartach" ritual into standing automation | The Playwright multi-session suite is the automation; no residual manual step should remain |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (Playwright must run headless-or-headed once, never `--ui`/`--watch`)
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
