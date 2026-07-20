---
phase: 16
slug: design-system-extraction-logic-types-i18n
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-20
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (web + extension), tsc (both) |
| **Config file** | `web/vitest.config.ts`, `extension/vitest.config.ts` |
| **Quick run command** | `cd web && npx vitest run` or `cd extension && npx vitest run` (per touched consumer) |
| **Full suite command** | `cd web && npx vitest run && npx tsc --noEmit; cd ../extension && npx vitest run && npx tsc --noEmit` |
| **Estimated runtime** | ~60–90 seconds combined |

---

## Sampling Rate

- **After every task commit:** Run the touched consumer's `npx vitest run`
- **After every plan wave:** Run the full suite command (both consumers + both tsc)
- **Before `/gsd-verify-work`:** Full suite must be green, plus both `wxt` builds and web `next build`
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | — | — | DS-01, DS-02 | — | N/A | unit | see quick run command | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — both consumers have vitest suites that already exercise every module being migrated (web-side). Note: extension has no local tests for `cardBrand.ts`/`types.ts`/`clipboard.ts` (pre-existing gap, coverage is web-side only).

---

## Manual-Only Verifications

All phase behaviors have automated verification — success criterion 3 (no duplicate implementations remain) is verified by grep, criteria 1–2 by both test suites passing unchanged.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
