---
phase: 15
slug: login-unlock-unification-vaultwarden-model
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: true) (#2117)
status: validated
nyquist_compliant: false
wave_0_complete: true
created: 2026-07-20
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (extension + web), cargo test (workspace), playwright (Chrome, 2 projects), selenium/geckodriver real-Firefox lanes |
| **Config file** | extension/vitest.config.ts; web vitest config; extension/playwright.config.ts |
| **Quick run command** | `cd extension && npx vitest run --reporter=dot` |
| **Full suite command** | `cd extension && npx vitest run && npx tsc --noEmit && cargo test --workspace` + web vitest |
| **Estimated runtime** | ~60s unit-level; harness lanes minutes each (headed) |

---

## Sampling Rate

- **After every task commit:** `cd extension && npx vitest run --reporter=dot` (baseline 674 at phase start; EXPECT NET DELETIONS this phase — ext-scoped removal kills ~26 cases + EnrollExtPasskeyPrompt suite; planner states expected deltas per plan)
- **After every plan wave:** full suite + affected harness lanes (run-core, server-unlock — both currently sign in via popup password form and WILL be reworked to the window flow this phase)
- **Before `/gsd-verify-work`:** vitest green (new baseline), tsc clean, both builds, mainworld audit exit 0, reworked e2e lanes green on both browsers, AUTH-04 second-server reconfigure scenario passing
- **Max feedback latency:** 90 seconds unit-level

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | — | — | AUTH-01 | — | popup renders no sign-in form; window carries full sign-in (password+passkey) | unit+e2e | vitest UnlockView/App + reworked e2e signin lane | ✅ | ⬜ pending |
| (filled by planner) | — | — | AUTH-02 | — | locked popup = password-first + ceremony-window passkey only | unit | vitest UnlockView | ✅ | ⬜ pending |
| (filled by planner) | — | — | AUTH-03 | — | zero ext-scoped code paths remain (grep-clean), WR-01 gate intact | unit+grep | vitest + `grep -r "extPrf" extension/` empty | ✅ | ⬜ pending |
| (filled by planner) | — | — | AUTH-04 | — | second-server reconfigure leaves zero stranded session/permission (UI-SPEC backstop row) | integration/e2e | two-server reconfigure scenario | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] AUTH-04 two-server reconfigure test scenario (new — likely a vitest integration over server-config/session teardown plus an e2e row; planner decides placement)
- [ ] e2e fixture rework: session establishment without popup password form (window-driven or background seed — RESEARCH.md e2e section)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| (none expected — populate if planner finds any) | — | — | — |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-20 (validate-phase audit — 0 gaps)

## Validation Audit 2026-07-20

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

Coverage at phase close: AUTH-01/02 → SignInView/UnlockView/App vitest + reworked e2e lanes (evidence/ committed); AUTH-03 → no-ext-scoped-prf-strings.test.ts permanent guard + router structural tests; AUTH-04 → ServerConfigView.test.tsx 26/26 incl. migration-failure backstop + live two-server proof (corroborated by cdf742d). Extension 678/678 exit 0, web 474/474, tsc clean both.
