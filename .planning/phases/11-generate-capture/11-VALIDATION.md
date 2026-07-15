---
phase: 11
slug: generate-capture
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (project standard — `web/package.json` already runs `vitest run`; `extension/` matches, per Phase 8's scaffold) |
| **Config file** | `extension/vitest.config.ts` — expected to exist from Phase 8's bootstrap; Plan 11-01 Task 3 extends it with `WxtVitest`/`@webext-core/fake-browser` wiring only if that plugin isn't already configured |
| **Quick run command** | `cd extension && npx vitest run <touched-path>` |
| **Full suite command** | `cd extension && npx vitest run` |
| **Estimated runtime** | ~15-30 seconds (unit/jsdom only — no browser launch required for any automated check in this phase) |

---

## Sampling Rate

- **After every task commit:** Run `cd extension && npx vitest run <touched-module-path>`
- **After every plan wave:** Run `cd extension && npx vitest run` (full suite) plus `cd extension && npx tsc --noEmit`
- **Before `/gsd-verify-work`:** Full suite must be green, PLUS the two manual UAT items below (same-origin save/update/no-op flow, and the adversarial cross-origin-iframe mismatch scenario) must be walked once against a real unpacked-extension load — D-06/ROADMAP Success Criterion 4 is not considered proven by unit tests alone.
- **Max feedback latency:** ~30 seconds (no wave in this phase requires a build step or browser launch to get a red/green signal)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-------------------|-----------|---------------------|-------------|--------|
| 11-01-01 | 01 | 1 | CAP-01 | T-11-03 | New message kinds validated by the same schema mechanism as existing entries | unit (tsc) | `cd extension && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | CAP-01 | — | Ported generator reproduces v0.1's exact length/charset/word-count behavior | unit | `cd extension && npx vitest run lib/generator` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | CAP-01 | T-11-01, T-11-02 | generate-request round-trips through router; invalid mode returns typed error, never throws | unit | `cd extension && npx vitest run entrypoints/background/handlers/generate-handler` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 2 | CAP-01, CAP-02, CAP-03 | — | classifyForm correctly distinguishes signup/login-submit/SPA-no-form/none | unit (jsdom) | `cd extension && npx vitest run entrypoints/content/form-detector` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 2 | CAP-02, CAP-03 | T-11-04, T-11-05, T-11-06 | Success heuristic fires only on a genuine signal; captureFrameOrigin never reads window.top | unit (jsdom, fake timers) | `cd extension && npx vitest run entrypoints/content/submit-capture` | ❌ W0 | ⬜ pending |
| 11-03-01 | 03 | 2 | CAP-02, CAP-03 | T-11-07 | classifySubmit computes mismatch independently of any upstream claim | unit | `cd extension && npx vitest run entrypoints/background/handlers/capture-handler -t classifySubmit` | ❌ W0 | ⬜ pending |
| 11-03-02 | 03 | 2 | CAP-02, CAP-03 | T-11-07, T-11-08, T-11-09 | 409 -> RevisionConflictError, never silent overwrite; absent session key -> LockedVaultError | unit (fake-browser) | `cd extension && npx vitest run entrypoints/background/handlers/capture-handler` | ❌ W0 | ⬜ pending |
| 11-04-01 | 04 | 3 | CAP-01 | T-11-11, T-11-12 | Shadow root is closed-mode; injected stylesheet has no third-party font URL | unit (tsc) + grep | `cd extension && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 11-04-02 | 04 | 3 | CAP-01 | T-11-13 | Popover click-triggered only; apply fills paired fields via generate-request | tsc + manual | `cd extension && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 11-05-01 | 05 | 4 | CAP-02, CAP-03 | — | no-op renders nothing; new/update render correct variant; confirm re-sends full payload | tsc + manual | `cd extension && npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 11-05-02 | 05 | 4 | CAP-02, CAP-03 | T-11-14, T-11-15, T-11-16 | Mismatch modal gates 100% of frameOrigin!==topOrigin flows; not dismissible via Escape/click-outside | tsc + fixture-existence + manual | `test -f extension/tests/uat-fixtures/cap-top-level-page.html && test -f extension/tests/uat-fixtures/cap-cross-origin-iframe.html` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `extension/vitest.config.ts` + `WxtVitest`/`@webext-core/fake-browser` wiring — expected to exist from Phase 8's bootstrap; Plan 11-01 Task 3 extends it only if not already present (per 11-RESEARCH.md's Wave 0 Gaps, inherited since Phase 8 had not executed as of this phase's research pass)
- [ ] `extension/lib/generator/password.test.ts` (+ strength/wordlist test coverage) — ported from `web/src/lib/generator/password.test.ts` in Plan 11-01 Task 2, RED before the port, GREEN after
- [ ] `extension/entrypoints/content/form-detector.test.ts`, `extension/entrypoints/content/submit-capture.test.ts` — new jsdom-fixture test files created in Plan 11-02, RED before implementation
- [ ] `extension/entrypoints/background/handlers/capture-handler.test.ts` — new fake-browser test file created in Plan 11-03, RED before implementation
- [ ] `extension/tests/uat-fixtures/cap-top-level-page.html`, `extension/tests/uat-fixtures/cap-cross-origin-iframe.html` — new two-origin adversarial fixture pair created in Plan 11-05 Task 2, required before the D-06 manual UAT case can be run

All Wave 0 gaps are owned by this phase's own plans (11-01 through 11-05) — no plan in this phase assumes a test file that some OTHER phase must create first, beyond the base `extension/vitest.config.ts` scaffold Phase 8 is independently responsible for.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Generate-popover trigger/apply visual flow, native-suggestion non-overlap (Pitfall C) | CAP-01 | Requires a real unpacked-extension load + a real signup page's rendering and the real browser's own native password-suggestion popover — not reproducible in jsdom | Load unpacked extension, open a fixture signup page with a new-password + confirm-password pair, click the 40px trigger, confirm both generator modes render, apply fills both fields, and no native browser suggestion is visually open at the same moment (see Plan 11-04 Task 2's `<human-check>`) |
| Same-origin save / update / no-op toast flow end-to-end | CAP-02, CAP-03 | Requires a real submit-capture success signal against a real page plus a real background persist round-trip to a running `pv-server` — the unit tests prove the classification/persistence logic in isolation but not the full DOM-to-vault path | Submit new credentials on a fixture login page, confirm the save toast, click Save, confirm success + vault item appears; resubmit unchanged (confirm no toast); change password and resubmit (confirm update toast) — see Plan 11-05 Task 1's `<human-check>` |
| Cross-origin iframe origin-mismatch escalation (D-06, ROADMAP Success Criterion 4) | CAP-02, CAP-03 | This is the phase's one HARD manual requirement per CONTEXT.md D-06 — it requires two real, differently-origined HTTP servers and a real browser rendering a real cross-origin `<iframe>`, which cannot be faithfully reproduced in jsdom (jsdom does not enforce real browser same-origin-policy semantics for iframes the way this adversarial case needs) | Serve `extension/tests/uat-fixtures/cap-top-level-page.html` and `cap-cross-origin-iframe.html` on two different localhost ports, submit the iframe's login form, confirm the mismatch modal (not the plain toast) appears showing both origins in full, confirm it is not dismissible via Escape/click-outside, and confirm "Save anyway" completes the save — see Plan 11-05 Task 2's `<human-check>` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`vitest run`, never bare `vitest`)
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
