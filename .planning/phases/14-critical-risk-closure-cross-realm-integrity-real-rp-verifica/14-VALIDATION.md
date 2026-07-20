---
phase: 14
slug: critical-risk-closure-cross-realm-integrity-real-rp-verifica
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-20
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (extension), cargo test (Rust workspace), selenium/geckodriver real-Firefox probes, playwright (Chrome) |
| **Config file** | extension/vitest.config.ts; Cargo.toml workspace; extension/playwright.config.ts |
| **Quick run command** | `cd extension && npx vitest run --reporter=dot` |
| **Full suite command** | `cd extension && npx vitest run && npx tsc --noEmit && cargo test --workspace` |
| **Estimated runtime** | ~60 seconds (quick ~25s; full Firefox harness lanes are separate, minutes each) |

---

## Sampling Rate

- **After every task commit:** Run `cd extension && npx vitest run --reporter=dot` (baseline 651 passing)
- **After every plan wave:** Run full suite + affected Firefox/Chrome harness lanes
- **Before `/gsd-verify-work`:** Full suite green + probe-request-xray.cjs all-PASS (incl. new response-direction assertions) + run-core 17 PASS/1 OBSERVED + server-unlock 15/2/0 + chromium-ceremony 5/5 + audit-mainworld-boundary exit 0
- **Max feedback latency:** 90 seconds for unit-level; Firefox harness lanes run at wave boundaries (headed, minutes)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | — | — | XBR-02 | — | response fields realm-correct, no validation/consent logic touched | e2e probe | `node extension/e2e-firefox/probe-request-xray.cjs` | ✅ | ⬜ pending |
| (filled by planner) | — | — | XBR-02 | — | cross-realm detection deterministic in jsdom | unit | `cd extension && npx vitest run entrypoints/__tests__/content-relay.test.ts` | ✅ | ⬜ pending |
| (filled by planner) | — | — | QA-03 | — | independent webauthn-rs verifier accepts provider ceremony (real signature over real challenge) | integration | `cargo test -p pv-provider --test real_rp_verification` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/pv-provider/tests/real_rp_verification.rs` — new integration test file for QA-03 (webauthn-rs dev-dependency edge; `cargo check -p pv-provider --tests` sanity gate)

*Existing infrastructure (vitest, Firefox harness, playwright, cargo) covers everything else.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real github.com create()/get() on Bartek's Firefox profile | XBR-02 (corroboration only) | Requires Bartek's real GitHub account/2FA; automated equivalent is the CSP-strict fixture probe | Left honestly open in debug doc (`awaiting_human_verify`); NOT a phase gate — probe + jsdom + webauthn-rs tests are the automated closure evidence |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
