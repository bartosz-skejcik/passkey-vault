---
phase: 17
slug: shared-component-visual-alignment
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: true) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
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
| 17-01-01 | 01 | 1 | DS-03 | supply-chain pins | pv-ui local node_modules pins byte-identical to consumer locks | install+build | pv-ui install + both consumer tsc --noEmit | ✅ | ✅ green |
| 17-01-02 | 01 | 1 | DS-03 | — | @source scanning proof (classes survive in compiled CSS) | build smoke | probe class present in both compiled CSS outputs | ✅ | ✅ green |
| 17-02-01 | 02 | 1 | DS-04, UX-01 | — | tokens land inside existing theme blocks (rewrite adapter covers them) | source+build | grep --pv-tile-bg/-fg in tokens.css both theme blocks; ext vitest | ✅ | ✅ green |
| 17-02-02 | 02 | 1 | DS-04, UX-01 | scoped CSS prohibitions | only .pv-row-icon-tile/.pv-row-icon change; NordPass literals untouched | source diff | scoped grep + git diff scope assert | ✅ | ✅ green |
| 17-03-01 | 03 | 2 | DS-03 | zero-knowledge favicon rule | direct-to-domain favicon fetch + no-referrer preserved verbatim | unit+build | both vitest suites + both tsc | ✅ | ✅ green |
| 17-03-02 | 03 | 2 | DS-03 | — | both consumers collapse to shims, no second implementation | grep+unit | duplicate-implementation grep + suites | ✅ | ✅ green |
| 17-04-01 | 04 | 3 | DS-03, DS-04, UX-01 | crypto-free aggregate | overlay-wide design-constant audit + crypto grep + full chains | full suite | both vitest+tsc+builds + overlay audit grep | ✅ | ✅ green |
| 17-04-02 | 04 | 3 | UX-01 | — | visual parity across 4 surfaces, both themes | visual (Playwright) | computed-style cross-check + screenshots to uat-screenshots/ | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `@source` directive for `packages/pv-ui/components/` in BOTH consumers' Tailwind CSS entry (web `globals.css` missing it; extension `style.css` needs the formalized line) — must land before the shared component or classes silently drop
- [x] pv-ui peer-dep resolution fix (Option A: pv-ui-local node_modules) — must land before any `.tsx` import resolves

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| In-page dropdown/prompt tile visually matches web/popup in both themes | UX-01 | e2e suite does not render these tile surfaces; visual parity is a screenshot judgment | Playwright/Selenium screenshots of Surface A + Surface B in vault-light and vault-dark vs web/popup reference; per standing authorization, self-validate + attach screenshots for taste review |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (both Wave-0 items are Plan 17-01's own tasks)
- [x] No watch-mode flags
- [x] Feedback latency < 300s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-21 (map populated from 4 checker-verified plans; checks 8a-8d pass per plan-checker)

---

## Validation Audit 2026-07-21

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All requirements COVERED. DS-03: shared component + shims proven by unedited suites (popup ItemIconTile.test 9/9, web ItemRow.test 28/28), zero-duplication grep, negative-control duplicate-React build proof (CR-01 fix). DS-04: overlay-wide literal audit green (exactly the 8-item allowlist); tokens in both theme blocks with 2 regression tests. UX-01: visual harness 16/16 byte-identical computed colors across web/popup/in-page in both themes + 10 committed screenshots. Final suites: web 481/481, ext 687/687, both tsc clean, wxt build green. The manual-only visual-taste item is satisfied under the standing Playwright self-validation authorization (screenshots committed for Bartek's review).
