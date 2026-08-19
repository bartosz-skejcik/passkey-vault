---
phase: 32
slug: putting-things-into-shared-folders
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-19
---

# Phase 32 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework (web unit)** | Vitest 3.2.4 (`web/package.json`, `"test": "vitest run"`) |
| **Framework (web e2e)** | Playwright 1.61.1 (`web/package.json`, `"test:e2e": "playwright test"`) |
| **Framework (server)** | Rust `#[tokio::test]` via `cargo test --workspace` |
| **Config file** | `web/vitest.config.ts` / `web/playwright.config.ts` (pre-existing, unmodified by this phase) |
| **Quick run command** | `cd web && npx vitest run src/components/vault/ItemForm.test.tsx src/lib/vault/moveVaultItem.real-wasm.test.ts` |
| **Full suite command** | `cd web && npm run build && npm test && npm run test:e2e` (web) ; `cargo test --workspace --no-fail-fast` (server) ; `cargo clippy --workspace --all-targets -- -D warnings` (DEBT-04's own gate) |
| **Estimated runtime** | ~4-6 min full suite (dominated by the live Playwright specs and their fresh release-binary build) |

**Build-before-compile hazard (32-RESEARCH.md's own flag):** `npm run compile` (`tsc --noEmit`) has no `precompile` step, while `npm run build`'s `prebuild` is what populates `packages/pv-ui/node_modules` (the sibling package `web` imports from). On a clean checkout, running `compile` before `build` exits 2 with `TS2307 Cannot find module 'react'` — not a source defect. Every `<verify>` field in this phase's plans that needs `compile` runs it AFTER a `build` in the same or an earlier step.

---

## Sampling Rate

- **After every task commit:** `cd web && npx vitest run <touched test files>` ; `cargo clippy -p pv-server -- -D warnings` (fast, scoped) where Rust files are touched.
- **After every plan wave:** `cd web && npm test` ; `cargo test --workspace --no-fail-fast`.
- **Before `/gsd-verify-work`:** `cd web && npm run build && npm run test:e2e` ; `cargo clippy --workspace --all-targets -- -D warnings` ; `cargo test --workspace --no-fail-fast` — all green.
- **Max feedback latency:** ~90s (a single live Playwright spec run, `--retries=0`).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 32-01-01 | 01 | 1 | ORG-01, ORG-02 | T-32-01 / T-32-02 / T-32-04 | Destination select honors item_bucket exclusion + disabled read-only; move dispatches under the destination's own key; create-then-move never strands the item silently | e2e (live, two sessions) | `cd web && npm run build && npx playwright test e2e/sharing.spec.ts -g "moved via the item editor" --retries=0` | ❌ Wave 0 | ⬜ pending |
| 32-01-02 | 01 | 1 | ORG-02 | — | moveVaultItem's destination-key dispatch, all directions, real WASM | unit (real-WASM) | `cd web && npx vitest run src/lib/vault/moveVaultItem.real-wasm.test.ts` | ❌ Wave 0 | ⬜ pending |
| 32-02-01 | 02 | 2 | ORG-01 | T-32-08 | Optgroup rendering, disabled-with-reason, retry-safe create-then-move dispatch | unit (mocked, control-flow claim) | `cd web && npx vitest run src/components/vault/ItemForm.test.tsx` | ✅ (extends existing file) | ⬜ pending |
| 32-02-02 | 02 | 2 | ORG-01 | — | Item created directly in a shared folder never stranded personal | e2e (live, single session) | `cd web && npm run build && npx playwright test e2e/sharing.spec.ts -g "created directly in an existing shared folder" --retries=0` | ❌ Wave 0 | ⬜ pending |
| 32-03-01 | 03 | 1 | ORG-01, ORG-02 | T-32-05 / T-32-06 | item_shares survives an ordinary-folder move, dropped on item_bucket move | integration (server) | `cargo test -p pv-server --test sync_shared -- item_shares --nocapture` | ✅ (retargets + extends existing file) | ⬜ pending |
| 32-03-02 | 03 | 1 | DEBT-04 | T-32-07 | Workspace-wide clippy, zero behavior change | server, direct command | `cargo clippy --workspace --all-targets -- -D warnings` | N/A — the criterion IS the command | ⬜ pending |
| 32-04-01 | 04 | 3 | ORG-02 | T-32-09 | Destination-key-unavailable refusal, deliberately driven, byte-identical rollback | e2e (live, two sessions, TOCTOU) | `cd web && npm run build && npx playwright test e2e/sharing.spec.ts -g "destination access revoked mid-session" --retries=0` | ❌ Wave 0 | ⬜ pending |
| 32-04-02 | 04 | 3 | ORG-04 | T-32-10 / T-32-11 | Folder-derived access lost on next completed sync after move-out, no direct-share confound | e2e (live, two sessions) | `cd web && npm run build && npx playwright test e2e/sharing.spec.ts -g "moved out of the shared folder loses access" --retries=0` | ❌ Wave 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `web/src/lib/vault/moveVaultItem.real-wasm.test.ts` — new file, Plan 32-01 Task 2.
- [ ] `web/e2e/sharing.spec.ts` — four new live test cases across Plans 32-01/32-02/32-04 (edit-mode round trip + recipient read; create-mode two-call; SC3 TOCTOU refusal; SC4 move-out access loss).
- [ ] `crates/pv-server/tests/sync_shared.rs` — Plan 32-03 Task 1 retargets one existing test to an item_bucket destination and adds one new ordinary-collection-survival test.

*Existing infrastructure (Vitest, Playwright, `cargo test`, the `twoSessions` fixture, `ensureFamilyMembership`/`waitForIdentityKeyPublished`/`shareExistingFolderWithMember`/`reloadAndUnlock` helpers) covers every other requirement — no new framework or harness needed.*

---

## Manual-Only Verifications

*None. All five ROADMAP success criteria have automated verification (real-WASM and/or live Playwright, per the phase's own "mocked crypto is not evidence" standing rule) — no held-out taste call exists in this phase (unlike Phase 31's PL-width note).*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s (per-task); live e2e phase-gate latency ~2-4 min
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
