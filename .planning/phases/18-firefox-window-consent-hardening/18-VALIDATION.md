---
phase: 18
slug: firefox-window-consent-hardening
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-21
---

# Phase 18 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (extension unit — window-geometry), real-Firefox Selenium probe lane (e2e-firefox), security-review artifact (18-SECURITY.md) |
| **Config file** | `extension/vitest.config.ts`; `extension/e2e-firefox/*` harness pattern |
| **Quick run command** | `cd extension && npx vitest run lib/window-geometry` (or touched test file) |
| **Full suite command** | extension vitest + tsc + the new `probe-window-geometry` npm-script lane (live Firefox) |
| **Estimated runtime** | unit <30s; live probe ~2-4 min (headed Firefox) |

---

## Sampling Rate

- **After every task commit:** touched unit test file via `npx vitest run`
- **After every plan wave:** extension vitest + tsc
- **Before `/gsd-verify-work`:** unit suite green + live probe lane run once with PASS output captured as evidence
- **Max feedback latency:** unit 30s; probe lane run at wave close, not per-commit

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled at plan time) | — | — | UX-02, XBR-03 | — | consent stays OS-window unless review clears panel | unit + live probe + review artifact | see commands above | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers the phase: `window-geometry.test.ts` exists (one missing case to add — negative-position pass-through), e2e-firefox harness pattern established. No new framework needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live Firefox windows open centered/sized/self-close (visual confirmation beyond probe numbers) | UX-02 | Probe asserts geometry numerically; a human-eye sanity pass on the real windows is cheap corroboration | Run the probe lane headed; screenshot consent + ceremony window; per standing authorization self-validate + attach |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 300s (unit), probe at wave close
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
