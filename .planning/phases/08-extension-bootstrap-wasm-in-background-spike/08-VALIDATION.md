---
phase: 8
slug: extension-bootstrap-wasm-in-background-spike
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-07-15
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.x (extension/), mirroring web/'s existing vitest setup — first test infra for extension/, created in plan 08-02 Task 1 |
| **Config file** | `extension/vitest.config.ts` — created in plan 08-02 Task 1 (Wave 0 dependency, satisfied within-phase) |
| **Quick run command** | `cd extension && npx vitest run lib/crypto/vault-session.test.ts` |
| **Full suite command** | `cd extension && npx vitest run && npx tsc --noEmit` |
| **Estimated runtime** | ~5-10 seconds (no browser, no build step required for the unit-test portion) |

Manual/adversarial verification (SC #1, #3, #4) has no automatable framework by design — see Manual-Only Verifications below.

---

## Sampling Rate

- **After every task commit:** Run `cd extension && npx tsc --noEmit` (type-check); run `npx vitest run` once vitest exists (plan 08-02 onward)
- **After every plan wave:** Run the full suite command above, plus (from plan 08-03 onward) `wxt build -b chrome && wxt build -b firefox`
- **Before `/gsd-verify-work`:** Full suite must be green AND the plan 08-03 human checkpoint must be approved
- **Max feedback latency:** ~10 seconds for automated checks; the manual idle-kill/wake check (D-10) has no latency ceiling — it is a one-time human verification gate, not a repeated sampling loop

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 08-01-00 | 01 | 1 | EXT-01 | T-08-SC | Package legitimacy confirmed before install | manual | N/A — human checkpoint | ✅ | ⬜ pending |
| 08-01-01 | 01 | 1 | EXT-01 | T-08-01 | CSP/gecko.id/Firefox-pin explicit in wxt.config.ts | other | `cd extension && npx wxt build -b chrome && npx wxt build -b firefox` | ✅ W1 | ⬜ pending |
| 08-01-02 | 01 | 1 | EXT-01 | T-08-08 | build-wasm.sh extended additively, web/ output unchanged | other | `bash scripts/build-wasm.sh && test -f extension/lib/crypto/wasm/pv_wasm.js && test -f web/src/lib/crypto/wasm/pv_wasm.js` | ✅ W1 | ⬜ pending |
| 08-02-01 | 02 | 2 | EXT-01 | T-08-03 | wasm-loader.ts uses fetch()+instantiate(), never streaming | unit | `cd extension && npx tsc --noEmit` | ✅ W1 | ⬜ pending |
| 08-02-02 | 02 | 2 | EXT-01 | T-08-02 | Round-trip + storage.session rehydration logic correct | unit | `cd extension && npx vitest run lib/crypto/vault-session.test.ts` | ✅ (created this task, TDD RED->GREEN) | ⬜ pending |
| 08-02-03 | 02 | 2 | EXT-01 | T-08-05 | background.ts wires real browser.storage.session, no keep-alive hacks | unit | `cd extension && npx tsc --noEmit && npx vitest run` | ✅ W1 | ⬜ pending |
| 08-03-01 | 03 | 3 | EXT-01 | T-08-03 | Debug popup never imports crypto modules directly | other | `cd extension && npx tsc --noEmit` | ✅ W1 | ⬜ pending |
| 08-03-02 | 03 | 3 | EXT-01 | T-08-01 | Generated (packaged) manifests match D-07/D-08/D-09 | other | `cd extension && npx wxt build -b chrome && npx wxt build -b firefox && find .output -name manifest.json` | ✅ W1 | ⬜ pending |
| 08-03-03 | 03 | 3 | EXT-01 | — | SC #1/#3/#4: real browser load + real Chrome idle-kill/wake survival | manual, adversarial | none — real DevTools "Service Workers -> stop" or 30s+ idle wait, per D-10 (do not automate/simulate) | ✅ (inherently manual) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] `extension/vitest.config.ts` — created within-phase by plan 08-02 Task 1 (no pre-existing test infra for extension/ since this is its first code)
- [x] `extension/lib/crypto/vault-session.test.ts` — created within-phase by plan 08-02 Task 2 (TDD RED before GREEN)

All Wave 0 gaps identified in 08-RESEARCH.md ("Validation Architecture > Wave 0 Gaps") are satisfied by plan 08-02's own tasks — no separate Wave 0 plan is needed since this is a 3-plan phase and the test infra is itself the first deliverable of plan 08-02.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Package legitimacy of `wxt@0.20.27` / `@wxt-dev/browser@0.2.2` before install | EXT-01 | [SUS]-flagged packages require human npmjs.com cross-check per the package legitimacy gate protocol, regardless of research's own legitimacy assessment | Plan 08-01, checkpoint task 0 |
| Extension loads with zero console errors in Chrome and Firefox (SC #1) | EXT-01 | Requires a real browser GUI/devtools session on the execution machine — no headless/simulated substitute is authorized by D-10 | Plan 08-03, checkpoint task |
| Round-trip survives a real Chrome service-worker idle-kill/wake cycle (SC #3) | EXT-01 | D-10 explicitly forbids a simulated/mocked termination in a test harness — must be the browser's actual platform-level termination (DevTools "Service Workers -> stop" or a real 30s+ idle wait) | Plan 08-03, checkpoint task |
| Firefox's deliberate MV2 background loads and runs the round-trip once with no console errors (SC #4) | EXT-01 | Firefox's `about:debugging` temporary-add-on flow and its background-page console have no CLI-drivable equivalent available in this environment | Plan 08-03, checkpoint task |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (the three genuinely manual checks are explicitly marked adversarial/manual per D-10, not silently unverified)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (only the final task of plan 08-03 is manual; every task before it across all three plans has an automated command)
- [x] Wave 0 covers all MISSING references (vitest config + test file both land within plan 08-02, before any correctness claim is made)
- [x] No watch-mode flags (`vitest run`, not `vitest`/`vitest watch`, used throughout)
- [x] Feedback latency < 10s for all automated checks
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
