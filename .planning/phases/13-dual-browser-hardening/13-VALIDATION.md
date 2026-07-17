---
phase: 13
slug: dual-browser-hardening
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-15
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^3.2.7 (extension unit tests — harness already EXISTS in `extension/`, 45 test files, NOT new this phase; freshness audit B7/13-02's stale "no test framework yet" premise corrected) + Playwright `@playwright/test` (Chromium E2E, new to `extension/` this phase) + `web-ext lint`/`web-ext run` (Mozilla CLI, static analysis + Firefox launch) |
| **Config file** | `extension/vitest.config.ts` (ALREADY EXISTS — two projects, background/node + popup/jsdom; Plan 13-02/13-03 only EXTEND it, e.g. adding an `e2e/**` exclude so Playwright specs aren't collected — they do not create it), `extension/playwright.config.ts` (new, Plan 13-03) |
| **Quick run command** | `cd extension && npm run lint:firefox` (static, ~seconds) |
| **Full suite command** | `cd extension && npx vitest run && npm run test:e2e:chrome && npm run build:firefox && npm run lint:firefox` (Chrome-side automated full pass; Firefox's manual/self-driven walk, Plan 13-04, is not part of this command) |
| **Estimated runtime** | ~2-3 minutes for the automated Chrome-side full suite; Firefox's self-driven walk (Plan 13-04) is not time-bounded the same way (interactive) |

---

## Sampling Rate

- **After every task commit:** `cd extension && npm run lint:firefox` (fast, static — run after any manifest/CSP-touching change)
- **After every plan wave:** Full automated Chrome-side suite (`vitest run` + `test:e2e:chrome` + `build:firefox` + `lint:firefox`); for Wave 3 (Plan 13-04), also the Firefox self-driven walk for that wave's touched SCs
- **Before `/gsd-verify-work`:** All `13-UAT-CHECKLIST.md` rows green (`PASS` or `RESOLVED`), `web-ext lint` clean on the packaged Firefox build, Chrome Playwright suite green — corrected count: 21 SC rows (ROADMAP Phase 9 has 7 SCs, not 5 — Phase 9=7 + Phase 10=5 + Phase 11=4 + Phase 12=5 = 21) + D-05 + D-08 + the new Firefox ext-scoped rpId row (13-04, closing `wxt.config.ts:56-64`'s open question / D-12) = **24 rows total**. If 13-03/13-04's own fixed plans land on a different final row count, that count is authoritative — reconcile this line against it, do not treat 24 as load-bearing over their actual checklist
- **Max feedback latency:** ~180 seconds (automated Chrome-side suite); Firefox manual walk latency is interactive, not a fixed bound

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|------------------|-----------|--------------------|-------------|--------|
| 13-01-01 | 01 | 1 | XBR-01 | T-13-SC1 | Firefox installed; web-ext devDependency present, vetted | integration | `node -e "..." package.json check` | ❌ Wave 0 | ⬜ pending |
| 13-01-02 | 01 | 1 | XBR-01 | T-13-01/T-13-02/T-13-03 | wxt.config.ts declares identical strict CSP + pinned gecko.id/strict_min_version | static/grep | `grep -c "wasm-unsafe-eval\|strict_min_version\|gecko" wxt.config.ts` | ❌ Wave 0 | ⬜ pending |
| 13-01-03 | 01 | 1 | XBR-01 | T-13-01 | Packaged Firefox build passes lint + real WASM instantiation confirmed at runtime | static + manual smoke | `npm run build:firefox && npm run lint:firefox` | ❌ Wave 0 | ⬜ pending |
| 13-02-01 | 02 | 1 | XBR-01 | T-13-04/T-13-05 | PRF detection is read-time, two-case-collapse, never exposes raw PRF bytes | unit (TDD) | `npx vitest run lib/platform/prf-support.test.ts` | ❌ Wave 0 | ⬜ pending |
| 13-02-02 | 02 | 1 | XBR-01 | T-13-05 | D-03 exact copy (PL+EN) shown on both surfaces; passkey CTA never disabled | grep + manual code read | `grep -rq "Fast unlock isn't available..." extension/entrypoints/ && ... (PL strings too)` | ❌ Wave 0 | ⬜ pending |
| 13-03-01 | 03 | 2 | XBR-01 | T-13-06/T-13-SC2 | Chromium extension-testing harness covers all 21 SCs (ROADMAP Phase 9 has 7 SCs, not 5 — corrected count); virtual authenticator confined to test project | static (test count) | `node -e "..." test count check` | ❌ Wave 0 | ⬜ pending |
| 13-03-02 | 03 | 2 | XBR-01 | T-13-07 | Full Chrome suite run; 24-row checklist (21 SCs + D-05 + D-08 + Firefox rpId row) authored with Chrome results | integration | `npm run test:e2e:chrome -- --reporter=list` (exit code asserts pass/fail, no output-masking pipe) | ❌ Wave 0 | ⬜ pending |
| 13-04-01 | 04 | 3 | XBR-01 | T-13-09/T-13-10 | Firefox walk complete; D-05/D-08 explicitly confirmed, not assumed; ext-scoped rpId-on-Firefox row closed | manual (self-driven, Playwright-UAT-authorized policy) | — (interactive; `web-ext run -t firefox-desktop --verbose`) | ❌ Wave 0 | ⬜ pending |
| 13-04-02 | 04 | 3 | XBR-01 | T-13-08 | Every divergence fixed + re-verified on BOTH browsers before RESOLVED | integration (re-run of 13-03's Chrome test + Firefox manual re-check) | `grep -cE '\| *FAIL' 13-UAT-CHECKLIST.md` (must be 0; anchored to the status-cell delimiter so narrative reason text mentioning "FAIL" can't false-fail the gate) | ❌ Wave 0 | ⬜ pending |
| 13-05-01 | 05 | 1 | XBR-01 | T-13-14 | pv-server accepts `moz-extension://*` as a scheme-scoped wildcard (D-10); bare `*` and every other wildcard shape stay fatal (WR-07 intact) | unit (TDD) | `cargo test -p pv-server routes::tests config::tests` | ❌ Wave 0 | ⬜ pending |
| 13-05-02 | 05 | 1 | XBR-01 | T-13-15 | ServerConfigView distinguishes CORS-blocked from unreachable; extension's own origin shown as copyable text (D-11) | unit | `cd extension && npx vitest run entrypoints/popup/ServerConfigView.test.tsx entrypoints/background/server-config.test.ts` | ❌ Wave 0 | ⬜ pending |
| 13-05-03 | 05 | 1 | XBR-01 | — | `PV_EXTENSION_ORIGINS` (incl. `moz-extension://*` stopgap) documented in `.env.example`/`docs/SELF-HOSTING.md`; tech-debt registered in `STATE.md` | static/grep | `grep -q PV_EXTENSION_ORIGINS .env.example docs/SELF-HOSTING.md` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `extension/vitest.config.ts` — ALREADY EXISTS (background/node + popup/jsdom projects, vitest ^3.2.7, 45 test files) — Plans 13-02/13-03 only EXTEND it (e.g. an `e2e/**` exclude), they do NOT create it (freshness audit B7 — the original "no prior test framework exists" premise was false and is corrected here)
- [ ] New PRF-support unit test(s) (exact path per 13-02's corrected plan — the popup ext-scoped surface, not a new `lib/platform/` module) — RED-first TDD scaffold (Plan 13-02, Task 1)
- [ ] `extension/playwright.config.ts` + `extension/e2e/` fixtures/specs — new Chromium E2E harness (Plan 13-03, Task 1)
- [ ] `web-ext` and `@playwright/test` installed as devDependencies (Plans 13-01/13-03)
- [ ] Firefox installed on the dev machine (Plan 13-01, Task 1 — 13-RESEARCH.md flagged this as a blocking environment gap with no fallback)
- [ ] Confirm the actual `.output/` directory naming from Phase 8's `wxt.config.ts` before wiring `lint:firefox`'s `--source-dir` and Playwright's extension-load path (Plan 13-01, Task 1; Plan 13-03, Task 1)
- [ ] `crates/pv-server` new CORS wildcard tests (RED-first TDD) for `moz-extension://*` pattern support (D-10) (Plan 13-05, Task 1)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|-------------|--------------------|
| Firefox's full 21-SC UAT walk (corrected from 19 — ROADMAP Phase 9 has 7 SCs, not 5) | XBR-01 | Playwright does not support loading a WebExtension into its Firefox channel (Chromium-only extension-testing support) — no automated equivalent to the Chrome harness exists for this project's tooling choices | Plan 13-04, Task 1: `npx web-ext run -t firefox-desktop --verbose`, drive each SC against the running instance, record PASS/FAIL per row in `13-UAT-CHECKLIST.md` |
| D-05 idle-kill/wake storage confirmation on Firefox | XBR-01 | Requires forcing a real background-context idle/termination and inspecting live browser storage state — not meaningfully mockable without losing the point of the check | Plan 13-04, Task 1: force idle 60+s, inspect `browser.storage.session` vs `storage.local`, record observed location |
| D-08 MAIN-world injection confirmation on Firefox | XBR-01 | Requires inspecting a real third-party page's `navigator.credentials` object via live DevTools console, not scriptable through Playwright on Firefox | Plan 13-04, Task 1: `navigator.credentials.create.toString()` in a real Firefox DevTools console on a test page |
| Runtime WASM smoke test on packaged Firefox build | XBR-01 | `web-ext lint` validates manifest syntax only, not runtime WASM instantiation — Pitfall 2 requires an actual browser load | Plan 13-01, Task 3: load via `about:debugging` → Load Temporary Add-on, trigger a real crypto operation, confirm no CompileError/EvalError |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s (Chrome-side automated suite)
- [ ] `nyquist_compliant: true` set in frontmatter (flip during Plan 13-04, Task 2, once all checklist rows are green — corrected count: 21 SCs + D-05 + D-08 + rpId-on-Firefox row = 24 rows, reconcile against 13-03/13-04's own fixed row count if it differs; still `false` as of this correction)

**Approval:** pending
