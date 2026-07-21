---
phase: 17
slug: shared-component-visual-alignment
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-21
---

# Phase 17 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (web + extension), tsc (both), wxt build (chrome+firefox), next build |
| **Config file** | `web/vitest.config.ts`, `extension/vitest.config.ts` |
| **Quick run command** | touched consumer's `npx vitest run` + `npx tsc --noEmit` |
| **Full suite command** | web: vitest + tsc + `next build`; extension: vitest + tsc + `wxt build -b chrome` + `wxt build -b firefox` |
| **Estimated runtime** | ~3–5 minutes full chain |
| **Visual/UAT lane** | Playwright screenshots (web/popup) + Firefox Selenium in-page screenshot harness — UX-01 visual match is screenshot-verified, not unit-testable |

---

## Sampling Rate

- **After every task commit:** touched consumer's `npx vitest run` + `npx tsc --noEmit`
- **After every plan wave:** full suite command (both consumers, both builds)
- **Before `/gsd-verify-work`:** full chains green + rendered-CSS proof that pv-ui component classes survived Tailwind content scanning in BOTH consumers (the #1 silent-failure risk)
- **Max feedback latency:** 5 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled at plan time by planner) | — | — | DS-03, DS-04, UX-01 | — | favicon fetch stays direct-to-domain, no proxy | build+unit+visual | see commands above | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `@source` directive for `packages/pv-ui/components/` in BOTH consumers' Tailwind CSS entry (web `globals.css` missing it; extension `style.css` needs the formalized line) — must land before the shared component or classes silently drop
- [ ] pv-ui peer-dep resolution fix (Option A: pv-ui-local node_modules) — must land before any `.tsx` import resolves

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| In-page dropdown/prompt tile visually matches web/popup in both themes | UX-01 | e2e suite does not render these tile surfaces; visual parity is a screenshot judgment | Playwright/Selenium screenshots of Surface A + Surface B in vault-light and vault-dark vs web/popup reference; per standing authorization, self-validate + attach screenshots for taste review |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
