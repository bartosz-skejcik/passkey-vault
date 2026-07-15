---
phase: 10
slug: autofill-login-totp-card-identity
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-15
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Seeded by `/gsd-plan-phase 10` from `10-RESEARCH.md` § Validation Architecture.
> The Per-Task Verification Map is reconciled against the actual `10-*-PLAN.md`
> task IDs after the planner returns.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x in `extension/` — established by Phase 8 (`08-02-PLAN.md` Task 1 creates `extension/vitest.config.ts`) and extended by Phase 9 (`09-02-PLAN.md` Task 2). Phase 10 **adds** a `jsdom` environment for DOM-detection tests; it does not create the framework. |
| **Config file** | `extension/vitest.config.ts` — pre-existing (Phase 8/9). Phase 10 must add a jsdom environment (per-file `// @vitest-environment jsdom` docblock or an `environmentMatchGlobs`/project entry) because Phase 9 pinned `environment: "node"` for background-only code. **This is Phase 10's only true Wave 0 gap.** |
| **Quick run command** | `cd extension && npx vitest run lib/autofill` |
| **Full suite command** | `cd extension && npx vitest run && npx tsc --noEmit` |
| **Estimated runtime** | ~5–15 seconds (jsdom fixtures only; no browser, no WASM, no network) |

The adversarial cross-origin-iframe proof (SC #5) has no in-process substitute — jsdom does not enforce real frame/origin semantics. See Manual-Only Verifications.

---

## Sampling Rate

- **After every task commit:** `cd extension && npx vitest run lib/autofill` (targeted, fast)
- **After every plan wave:** `cd extension && npx vitest run && npx tsc --noEmit` (full extension suite)
- **Before `/gsd-verify-work`:** Full suite green **AND** the adversarial cross-origin-iframe UAT (SC #5) passed against a real loaded extension on at least Chrome
- **Max feedback latency:** ~15 seconds for automated checks. The adversarial-iframe UAT is a one-time human/e2e gate, not a repeated sampling loop — no latency ceiling.

---

## Per-Task Verification Map

> Reconciled after planning against the real plan/task IDs.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _pending_ | — | — | — | — | — | — | — | — | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] **jsdom environment in `extension/vitest.config.ts`** — Phase 9 pins `environment: "node"`; every Phase 10 detection test needs a real DOM. Must land in the first Phase 10 plan that writes a DOM test, before any detection correctness claim.
- [ ] **Curated real-world card/identity form fixtures** (`extension/lib/autofill/__fixtures__/`) — HTML snapshots of real checkout/identity forms, sanitized of live PII/tracking scripts. `10-RESEARCH.md` Pitfall 1 is explicit that a synthetic fixture alone cannot validate the scored detector's false-positive rate.
- [ ] **`extension/e2e-fixtures/adversarial-iframe/`** — the two-origin adversarial harness for SC #5. Not unit-testable; the fixture itself is a deliverable.

**Not Wave 0 gaps (pre-existing, inherited):** vitest itself, `extension/` scaffold, the `browser` fake (`wxt/testing`'s `fakeBrowser`), the typed message contract, and `vault-session.ts` — all established by Phases 8–9. Phase 10 extends them; it must not recreate them.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Top-level-page credentials never fill into a cross-origin iframe (SC #5) | FILL-01…04 | jsdom does not enforce real cross-origin frame semantics; the property only exists under a real browser's frame model with a real loaded extension. `10-RESEARCH.md` Test Map marks this `human_needed`. | Load the unpacked extension, serve the two-origin fixture, run the scripted adversarial UAT in `extension/e2e-fixtures/adversarial-iframe/README.md`. Optional accelerator: Playwright persistent context + `--load-extension` (authorized per project memory; the durable harness is Phase 13's 13-03). |
| Nothing autofills without an explicit user gesture (SC #5) | FILL-01…04 | The negative ("no fill happened on page load / on focus / on DOM mutation") is only observable against a real page over real time. | Same fixture: load the page with the vault unlocked, wait 60s, confirm zero fields populated before any click. |
| Scored card/identity detection false-positive rate on real checkout forms (Pitfall 1) | FILL-03, FILL-04 | Threshold tuning requires judgment against real-world markup variance; a passing unit fixture only proves the curated set. | Manual pass over the curated fixture set + a live spot-check on 2–3 real checkout/identity forms during UAT. |
| Fill lands in framework-controlled inputs (React/Vue) and survives a real submit (Pitfall 5) | FILL-01…04 | jsdom has no React reconciler; "field shows the value" can be true while framework state stays stale. | UAT on at least one real React-controlled login form; confirm a real submit sends the filled value, not empty. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or a declared Wave 0 dependency
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (jsdom env, curated fixtures, adversarial harness)
- [ ] No watch-mode flags (`vitest run`, never bare `vitest`)
- [ ] Feedback latency < 15s for all automated checks
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
