---
phase: 9
slug: session-unlock-core-popup-sync-client
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-15
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

**Scope note:** `09-RESEARCH.md`'s "Validation Architecture" section was authored while Phase 9
was scoped to EXT-02/03/04 only; the ROADMAP now also assigns **EXT-05** (self-hosted server URL
config + validation + CORS) and **EXT-06** (open-full-vault action). This document extends that
research's test map to all five requirements rather than re-opening it. Rows sourced from
research are marked *(from RESEARCH)*; rows added for EXT-05/EXT-06 are marked *(extends RESEARCH)*.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x in `extension/` (config created by Phase 8 plan 08-02 Task 1 — **already exists**, contrary to 09-RESEARCH.md's "Wave 0 gap" assumption); `jsdom` environment added this phase for popup component tests; `cargo test` for the Rust side (`pv-wasm`, `pv-server`) |
| **Config file** | `extension/vitest.config.ts` — pre-existing from Phase 8; this phase ADDS a `jsdom` environment + React plugin for popup tests (do not recreate it) |
| **Quick run command** | `cd extension && npx vitest run <changed-test-file>` · `cargo test -p pv-wasm` · `cargo test -p pv-server` |
| **Full suite command** | `cd extension && npx vitest run && npx tsc --noEmit` + `cargo test --workspace` |
| **Estimated runtime** | ~10-20s (extension unit tests, no browser) + ~30-60s (`cargo test --workspace`) |

Manual/adversarial verification (real idle-kill wait, real cross-origin CORS request from a loaded
extension, cross-client sync visibility, open-in-new-tab) has no automatable substitute in this
environment — see Manual-Only Verifications below.

---

## Sampling Rate

- **After every task commit:** `cd extension && npx tsc --noEmit`, plus `npx vitest run <changed-test-file>` / `cargo test -p pv-wasm` / `cargo test -p pv-server` as relevant to the touched crate/package
- **After every plan wave:** `cd extension && npx vitest run && npx tsc --noEmit` + `cargo test --workspace`
- **Before `/gsd-verify-work`:** Full suite green AND the manual checkpoint plan (09-06) approved
- **Max feedback latency:** ~20s for extension unit tests; ~60s for the full Rust workspace. The manual browser checks (idle-kill wait, CORS-from-real-extension) are one-time human gates, not a repeated sampling loop.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | EXT-02 | T-09-02 | Sanctioned key export/import round-trips; input zeroized regardless of outcome | unit (Rust) | `cargo test -p pv-wasm` | ✅ (created this task) | ⬜ pending |
| 09-01-02 | 01 | 1 | EXT-04, EXT-05 | T-09-01 / T-09-03 | CORS allowlist admits only exact extension origins; fails closed when unset; never widens to permissive | unit/integration (Rust, real HTTP) | `cargo test -p pv-server` | ✅ (created this task) | ⬜ pending |
| 09-02-01 | 02 | 2 | EXT-02 | T-09-05 | Envelope confined to `chrome.storage.session`; `setAccessLevel` never widened | other (source assertion) | `cd extension && npx tsc --noEmit && grep -rn "setAccessLevel(" extension/` | ✅ W1 | ⬜ pending |
| 09-02-02 | 02 | 2 | EXT-02, EXT-03 | T-09-06 | Envelope survives simulated idle-kill; transient key buffer zeroized in `finally`; alarm-driven auto-lock | unit | `cd extension && npx vitest run vault-session.test.ts` | ✅ (created this task, TDD) | ⬜ pending |
| 09-02-03 | 02 | 2 | EXT-03 | T-09-07 | Router re-arms auto-lock on every message; no `setTimeout`/`setInterval` timer | unit | `cd extension && npx vitest run && npx tsc --noEmit` | ✅ W1 | ⬜ pending |
| 09-03-* | 03 | 2 | EXT-05 | T-09-09 / T-09-10 | Server URL validated via real `/healthz` before persist; scheme restricted; never hard-coded; `storage.local` holds config only (never key material) | unit | `cd extension && npx vitest run server-config.test.ts` | ✅ (created this plan) | ⬜ pending |
| 09-04-* | 04 | 3 | EXT-02, EXT-04 | T-09-11 | PRF/password unlock ceremony; PRF bytes never persisted; popup never imports WASM | unit | `cd extension && npx vitest run unlock.test.ts` | ✅ (created this plan) | ⬜ pending |
| 09-05-* | 05 | 3 | EXT-04 | T-09-12 | WS frames notification-only (never parsed as data); backoff/stale-socket guard; item cache cleared on lock | unit | `cd extension && npx vitest run sync-client.test.ts vault-store.test.ts search.test.ts` | ✅ (created this plan) | ⬜ pending |
| 09-06-* | 06 | 4 | EXT-02, EXT-03, EXT-04, EXT-06 | T-09-13 | Popup renders unlock/list/detail/settings; "open full vault" resolves against configured URL only | unit (jsdom) | `cd extension && npx vitest run popup/` | ✅ (created this plan) | ⬜ pending |
| 09-07-* | 07 | 5 | EXT-02, EXT-03, EXT-04, EXT-05, EXT-06 | — | SC #1-#7 end-to-end against a real loaded extension + real `pv-server` | manual, adversarial | none — real browser, real 60s+ idle, real cross-origin request (see Manual-Only) | ✅ (inherently manual) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task-ID granularity: plans 09-03..09-07 use `*` where the plan's internal task numbering is set by
the plan author; every task in those plans carries its own `<verify><automated>` block, and the
commands above are the plan-level rollup.*

---

## Wave 0 Requirements

- [x] `extension/vitest.config.ts` — **already created by Phase 8 (plan 08-02 Task 1)**. This phase extends it with a `jsdom` environment + React plugin for popup component tests; it does NOT create it. (09-RESEARCH.md listed this as a Wave 0 gap because it was written before Phase 8 was planned — superseded.)
- [ ] `jsdom` + `@vitejs/plugin-react` + `@wxt-dev/module-react` in `extension/package.json` — genuinely new this phase (Phase 8's popup is vanilla TS per 08-03-PLAN.md; research assumption A2's "no framework" branch is the one that holds). Landed by the popup plan before any popup component test is written.
- [ ] `extension/entrypoints/background/vault-session.test.ts` — EXT-02/EXT-03 (plan 09-02)
- [ ] `extension/entrypoints/background/server-config.test.ts` — EXT-05 (plan 09-03)
- [ ] `extension/entrypoints/background/unlock.test.ts` — EXT-02 (plan 09-04)
- [ ] `extension/entrypoints/background/sync-client.test.ts` — EXT-04, ported from `web/src/lib/vault/sync.test.ts`'s `MockWebSocket` pattern (plan 09-05)
- [ ] `extension/lib/vault/search.test.ts` — EXT-04, ported from `web/src/lib/vault/search.test.ts` (plan 09-05)
- [ ] New `#[test]` fns in `crates/pv-wasm/src/lib.rs` for the session export/import round-trip (plan 09-01)
- [ ] New CORS tests in `crates/pv-server/src/routes/mod.rs` (plan 09-01) — confirmed absent today

Each Wave 0 item is created by the same plan that first depends on it, TDD-first where the plan is
marked `tdd: true`. No separate Wave 0 plan is required.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Unlocked vault survives a **real** 60+ second service-worker idle-kill/wake (SC #3) | EXT-02 | 09-RESEARCH.md Pitfall 3 + Phase 8's D-10 explicitly forbid substituting a mocked/simulated termination — must be the browser's actual platform-level kill (DevTools "Service Workers → stop" or a real idle wait) | Plan 09-07 checkpoint |
| `pv-server`'s CORS allowlist accepts a **real** cross-origin request from a **really loaded** extension (SC #6) | EXT-05 | CONTEXT.md D-08 requires this be proven against a real request, "not assumed from reading Chrome/MDN docs on background-context fetch CORS exemptions". The Rust-side test in 09-01 proves the middleware logic; only a loaded extension proves the end-to-end posture. | Plan 09-07 checkpoint |
| First-run server-URL configuration against a real `pv-server` (SC #1) | EXT-05 | Requires a real running server + real reachability failure modes (DNS failure, wrong port, non-pv server answering 200) that a mocked `fetch` cannot faithfully reproduce | Plan 09-07 checkpoint |
| An edit made on the v0.1 web app appears in the extension popup (SC #5) | EXT-04 | Requires two real clients against one `pv-server`, same as v0.1 Phase 5's two-tab proof | Plan 09-07 checkpoint |
| "Open full vault" opens the configured server's web app in a new tab (SC #7) | EXT-06 | `browser.tabs.create` + real navigation is observable only in a real browser session | Plan 09-07 checkpoint |
| Auto-lock clears the key after the configured idle timeout and on browser close (SC #4) | EXT-03 | `chrome.alarms` real firing + `storage.session`'s browser-restart clear are platform behaviors, not mockable end-to-end | Plan 09-07 checkpoint |
| Lightweight Chrome + Firefox sanity pass of the popup | EXT-02..EXT-06 | CONTEXT.md's standing "test both, every phase" hygiene check (the exhaustive parity sweep is Phase 13) | Plan 09-07 checkpoint |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (the manual checks are explicitly marked adversarial/manual per D-08/D-10 + Pitfall 3, not silently unverified)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (every task in plans 09-01..09-06 carries an automated command; only plan 09-07 is wholly manual, by design)
- [x] Wave 0 covers all MISSING references (each test file lands in the plan that first depends on it, before any correctness claim)
- [x] No watch-mode flags (`vitest run`, never bare `vitest`/`vitest watch`)
- [x] Feedback latency < 20s (extension) / < 60s (Rust workspace)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
