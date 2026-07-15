---
phase: 10
slug: autofill-login-totp-card-identity
status: draft
nyquist_compliant: true
wave_0_complete: true
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

> Reconciled against the real plan/task IDs after planning.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | FILL-01..04 | T-10-01 | One typed contract; value-free fill response; jsdom env added | unit/type | `cd extension && npx tsc --noEmit` | ❌ W0 (creates ext-protocol autofill kinds + jsdom) | ⬜ pending |
| 10-01-02 | 01 | 1 | FILL-01..04 | T-10-02/03/05 | Cross-origin subframe refusal; payload-origin ignored; no suffix match | unit | `cd extension && npx vitest run entrypoints/background/frame-guard.test.ts` | ❌ (created this task, TDD) | ⬜ pending |
| 10-01-03 | 01 | 1 | FILL-01..04 | T-10-01 | session/vault kinds refused from content senders | unit/type | `cd extension && npx tsc --noEmit && npx vitest run` | ✅ W1 | ⬜ pending |
| 10-02-01 | 02 | 2 | FILL-01 | T-10-08 | Deterministic login detect; form-scoped pairing; hidden-field skip | unit | `cd extension && npx vitest run lib/autofill/detect-login.test.ts` | ❌ (created this task, TDD) | ⬜ pending |
| 10-02-02 | 02 | 2 | FILL-02 | T-10-06/07 | OTP detect refuses CVV + password; bounded strings | unit | `cd extension && npx vitest run lib/autofill/detect-totp.test.ts` | ❌ (created this task, TDD) | ⬜ pending |
| 10-03-01 | 03 | 2 | FILL-03/04 | T-10-09/10 | Autocomplete tier out-scores fallback; threshold home; fixture provenance | unit/type | `cd extension && npx tsc --noEmit` | ❌ W0 (creates field-tokens + fixtures) | ⬜ pending |
| 10-03-02 | 03 | 2 | FILL-03/04 | T-10-09/11/12 | Threshold boundary, tie-refusal, quantity-field false positive | unit | `cd extension && npx vitest run lib/autofill/detect-scored.card.test.ts lib/autofill/detect-scored.identity.test.ts` | ❌ (created this task, TDD) | ⬜ pending |
| 10-04-01 | 04 | 2 | FILL-01..04 | T-10-13/14/15/16/17 | Fill-time re-verify; itemId origin ownership; frame-addressed; TOTP fresh; locked fail-closed | unit | `cd extension && npx vitest run entrypoints/background/autofill-match.test.ts` | ❌ (created this task, TDD) | ⬜ pending |
| 10-04-02 | 04 | 2 | FILL-01..04 | T-10-13 | autofill.* dispatch through router; tier guard intact | unit/type | `cd extension && npx tsc --noEmit && npx vitest run` | ✅ W1 | ⬜ pending |
| 10-05-01 | 05 | 3 | FILL-01..04 | T-10-19 | Native-setter fill + synthetic events; vanished-field graceful | unit | `cd extension && npx vitest run lib/autofill/fill-dom.test.ts` | ❌ (created this task, TDD) | ⬜ pending |
| 10-05-02 | 05 | 3 | FILL-01..04 | T-10-18/20/21 | Detect returns booleans-only; fill only on message; crypto-free; no observer | unit | `cd extension && npx vitest run entrypoints/content-relay.test.ts` | ❌ (created this task, TDD) | ⬜ pending |
| 10-06-01 | 06 | 3 | FILL-01..04 | T-10-22/23 | Value-free popup; TOTP clipboard auto-clear reused | type | `cd extension && npx tsc --noEmit` | ✅ W1 | ⬜ pending |
| 10-06-02 | 06 | 3 | FILL-01..04 | T-10-24 | D-12 second-confirm for card/identity; neutral (not warning) styling | type | `cd extension && npx tsc --noEmit` | ✅ W1 | ⬜ pending |
| 10-06-03 | 06 | 3 | FILL-01..04 | T-10-24 | Gesture gate + second-confirm proven at component level | unit | `cd extension && npx vitest run entrypoints/popup/autofill/OnThisPageSection.test.tsx` | ❌ (created this task) | ⬜ pending |
| 10-07-01 | 07 | 4 | FILL-01..04 | T-10-27 | Two-origin adversarial fixture; localhost-only; no real brand | other | `node --check extension/e2e-fixtures/adversarial-iframe/serve.mjs` | ❌ (created this task) | ⬜ pending |
| 10-07-02 | 07 | 4 | FILL-01/03/04 | T-10-25/26 | Real-forms checklist (Pitfall 5 framework fill + Pitfall 1 spot-check) | other | `grep -q React extension/e2e-fixtures/real-forms/README.md` | ❌ (created this task) | ⬜ pending |
| 10-07-03 | 07 | 4 | FILL-01..04 | T-10-25/26 | SC #5: cross-origin-iframe refusal + gesture gate, real browser | manual/adversarial | none — human checkpoint per Playwright-UAT-authorized memory; not jsdom-simulable | ✅ (inherently manual) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

**Sampling continuity:** no run of 3 consecutive tasks lacks an automated command — the only manual task (10-07-03) is the terminal SC #5 checkpoint, and every task before it carries an automated `npx vitest`/`tsc`/`node --check` command.

---

## Wave 0 Requirements

All three gaps are satisfied by in-phase tasks (the Phase 8 pattern — Wave 0 infra lands inside the phase's own early plans, not a separate Wave 0 plan):

- [x] **jsdom environment in `extension/vitest.config.ts`** — assigned to **10-01 Task 1** (Wave 1), before any detection test runs. Phase 9 pins `environment: "node"`; detection tests need a real DOM.
- [x] **Curated real-world card/identity form fixtures** (`extension/lib/autofill/__fixtures__/`) — assigned to **10-03 Task 1** (Wave 2). Sanitized of live PII/tracking. `10-RESEARCH.md` Pitfall 1: a synthetic fixture alone cannot validate the scored detector's false-positive rate.
- [x] **`extension/e2e-fixtures/adversarial-iframe/`** — assigned to **10-07 Task 1** (Wave 4). Not unit-testable; the fixture is itself the deliverable for SC #5.

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

- [x] All tasks have an automated verify command or a declared Wave 0 dependency (the sole manual task, 10-07-03, is the terminal SC #5 adversarial checkpoint that is manual by design per 10-RESEARCH.md)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (jsdom env → 10-01, curated fixtures → 10-03, adversarial harness → 10-07)
- [x] No watch-mode flags (`vitest run`, never bare `vitest`, throughout)
- [x] Feedback latency < 15s for all automated checks
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
