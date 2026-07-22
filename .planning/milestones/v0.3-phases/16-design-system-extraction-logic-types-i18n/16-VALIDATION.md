---
phase: 16
slug: design-system-extraction-logic-types-i18n
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
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
| 16-01-01 | 01 | 1 | DS-01, DS-02 | — | N/A | build | `cd web && npx tsc --noEmit` | ✅ | ✅ green |
| 16-01-02 | 01 | 1 | DS-01, DS-02 | — | N/A | build | `cd extension && npx tsc --noEmit` | ✅ | ✅ green |
| 16-02-01 | 02 | 2 | DS-01 | T-16-02 | additive superset must not reach `fill-dom.ts` (git diff gate) | unit | `cd web && npx vitest run src/lib/vault` | ✅ | ✅ green |
| 16-02-02 | 02 | 2 | DS-01 | T-16-02 | same | unit | `cd extension && npx vitest run` | ✅ | ✅ green |
| 16-03-01 | 03 | 2 | DS-01 | T-16-03 | clipboard auto-clear behavior unchanged | unit | `cd web && npx vitest run` | ✅ | ✅ green |
| 16-03-02 | 03 | 2 | DS-01 | T-16-03 | same | unit | `cd extension && npx vitest run` | ✅ | ✅ green |
| 16-04-01 | 04 | 2 | DS-02 | T-16-04 | generic `t<D>` preserves keyof narrowing (security UI legibility) | unit (tdd) | `cd extension && npx vitest run lib/i18n` (engine.test.ts) | ✅ W0-inline | ✅ green |
| 16-04-02 | 04 | 2 | DS-02 | T-16-04 | 4 copy-divergent keys stay local | unit | `cd web && npx vitest run` | ✅ | ✅ green |
| 16-04-03 | 04 | 2 | DS-02 | T-16-04 | same | unit | `cd extension && npx vitest run` | ✅ | ✅ green |
| 16-05-01 | 05 | 3 | DS-01 | T-16-05 | `domainFromUrl` parse-failure stays fail-closed for origin gate | unit | `cd web && npx vitest run` | ✅ | ✅ green |
| 16-05-02 | 05 | 3 | DS-01 | T-16-05 | same | unit | `cd extension && npx vitest run` | ✅ | ✅ green |
| 16-06-01 | 06 | 4 | DS-01, DS-02 | — | no duplicate implementation remains (grep gate) | search | repo-wide grep gate per 16-06-PLAN.md | ✅ | ✅ green |
| 16-06-02 | 06 | 4 | DS-01, DS-02 | — | N/A | full suite | both vitest suites + both tsc + both wxt builds + next build | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — both consumers have vitest suites that already exercise every module being migrated (web-side). Note: extension has no local tests for `cardBrand.ts`/`types.ts`/`clipboard.ts` (pre-existing gap, coverage is web-side only).

---

## Manual-Only Verifications

All phase behaviors have automated verification — success criterion 3 (no duplicate implementations remain) is verified by grep, criteria 1–2 by both test suites passing unchanged.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (engine.test.ts created inline in 16-04 Task 1 before use)
- [x] No watch-mode flags
- [x] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-20 (plan-checker pass: 0 blockers; map populated from 6 verified plans)

---

## Validation Audit 2026-07-21

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All requirements COVERED: DS-01 via the 4 consumer test files passing unchanged through the shim chain (web+ext vitest) plus 16-06's repo-wide zero-duplication grep gate; DS-02 via engine.test.ts (3 copies incl. WR-01 regression test) and both dictionary suites. Final suite state: web 481/481, extension 685/685, both tsc --noEmit clean, both wxt builds + next build green. No new tests needed — Wave 0 gap (engine.test.ts) was created inline by Plan 16-04 Task 1 (TDD RED commit 0e685c2).
