---
phase: 18
slug: firefox-window-consent-hardening
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: true) (#2117)
status: draft
nyquist_compliant: true
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
| 18-01-01 | 01 | 1 | UX-02 | T-18 scope | negative-position pass-through asserted exactly (never >=0) | unit | `cd extension && npx vitest run lib/window-geometry` | ✅ | ⬜ pending |
| 18-01-02 | 01 | 1 | UX-02 | probe verify-only | probe-window-geometry.cjs created + npm scripts wired | build | `node -c` syntax + npm script presence grep | ✅ | ⬜ pending |
| 18-01-03 | 01 | 1 | UX-02 | — | live 7-gate geometry probe PASS (real windows.create fallback path) | live probe | `npm run test:e2e:firefox:window-geometry` exit 0 | ✅ | ⬜ pending |
| 18-02-01 | 02 | 1 | XBR-03 | T-12-14 baseline | four-dimension review with explicit SHIP/REJECT disposition recorded | review artifact | grep disposition string + section headers in 18-SECURITY.md | ✅ | ⬜ pending |
| 18-02-02 | 02 | 1 | XBR-03 | — | PROJECT.md Key Decisions row mirrors the verdict token | docs | grep decision row in PROJECT.md | ✅ | ⬜ pending |

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

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — existing infra)
- [x] No watch-mode flags
- [x] Feedback latency < 300s (unit), probe at wave close
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-21 (map populated from 2 checker-verified plans; 8a-8d pass per plan-checker)
