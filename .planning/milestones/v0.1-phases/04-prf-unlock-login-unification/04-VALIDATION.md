---
phase: 4
slug: prf-unlock-login-unification
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 04-RESEARCH.md § Validation Architecture and the 3-plan/7-task breakdown.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (pv-core, pv-server incl. new `passkey_login`/`unlock` integration tests) + vitest (web) + manual/self-validated real-browser UAT (Playwright MCP / Chrome DevTools WebAuthn virtual authenticator, standing overnight authorization) |
| **Config file** | Cargo.toml (workspace); web/vitest.config.ts |
| **Quick run command** | `cargo test -p pv-server` |
| **Full suite command** | `cargo test --workspace && cargo clippy --workspace --all-targets && (cd web && npm test) && (cd web && npx tsc --noEmit) && (cd web && npm run build)` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the crate-scoped test for the touched crate (`cargo test -p pv-server --test <file>` or `cd web && npm test -- <Component>`)
- **After every plan wave:** Run full suite
- **Before `/gsd-verify-work`:** Full suite must be green; real-browser passkey login+unlock UAT run at least once (Plan 04-03 Task 2)
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | AUTH-04, AUTH-09 | T-04-01, T-04-02, T-04-06 | `passkey_login_start/finish`: real `finish_passkey_authentication`; unknown-email and zero-passkey-email response-indistinguishable; `prf_salts` key encoding byte-matches `allowCredentials[i].id`; `consume_state_any_user` resolves `user_id` from the state row itself, never a client-asserted value | integration (Rust, SoftPasskey) | `cargo test -p pv-server --test passkey_login` | ❌ Wave 0 | ⬜ pending |
| 04-01-02 | 01 | 1 | AUTH-04, AUTH-09 | T-04-02, T-04-03 | `unlock_start/finish`: SessionUser-gated, real ceremony verification, zero PRF-capable passkeys → 404 with no browser prompt, structurally cannot INSERT a `sessions` row | integration (Rust, SoftPasskey) | `cargo test -p pv-server --test unlock` | ❌ Wave 0 | ⬜ pending |
| 04-02-01 | 02 | 2 | AUTH-04 | — | New API client functions match Plan 04-01's shipped shapes; `isNotAllowedError` hoisted to a shared, exported module (closes 04-RESEARCH.md Pitfall 4) | unit (vitest) + typecheck | `cd web && npm test -- enroll && npx tsc --noEmit` | ❌ Wave 0 | ⬜ pending |
| 04-02-02 | 02 | 2 | AUTH-04, AUTH-09 | T-04-07 | `passkeyLogin`/`passkeyUnlock` orchestration: PRF-success routes through `setPendingUnlock`/`unwrapUserKey` correctly per caller context; `prf_wrapped_uk === null` routes to `setPrfUnavailableHint`, never `setPendingUnlock`; `unlockStart` 404 short-circuits before any `navigator.credentials.get()` call; PRF bytes never leave the zeroize-on-use boundary | unit/TDD (vitest, mocked WebAuthn) | `cd web && npm test -- login.test` | ❌ Wave 0 | ⬜ pending |
| 04-02-03 | 02 | 2 | UI-02, AUTH-09 | T-04-08, T-04-09 | `PasskeyUnlockButton` renders above the password field on both `LoginForm`/`UnlockOverlay`; all 3 fallback tiers + cancellation render distinct, correct UI states; capability pre-check gates button mount, not a disabled state | component (vitest) + build | `cd web && npm test -- LoginForm && npm test -- UnlockOverlay && npm run build` | ❌ Wave 0 | ⬜ pending |
| 04-03-01 | 03 | 3 | AUTH-04, AUTH-09, UI-02 | — | Full workspace regression green post-merge; WASM choke-point grep audit still holds with new files present | integration + build | `cargo test --workspace && cargo clippy --workspace --all-targets && npm --prefix web test && npx --prefix web tsc --noEmit && npm --prefix web run build` | N/A (aggregate) | ⬜ pending |
| 04-03-02 | 03 | 3 | AUTH-04 (E2E), AUTH-09 (E2E), UI-02 (E2E) | T-04-10 | Real-browser fresh-login-with-PRF and reload-unlock-with-PRF both work end-to-end; PRF-unavailable/no-support/cancellation tiers each render correctly in a real browser; no PRF bytes/raw assertion in any real network request | e2e checkpoint (Playwright/CDP virtual authenticator; overnight: orchestrator runs it per standing authorization) | manual/self-validated browser walkthrough (Plan 04-03 Task 2 steps) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/pv-server/tests/passkey_login.rs` (new file) — covers AUTH-04's unauthenticated login ceremony, AUTH-09's enumeration-resistance shape parity (delivered by Plan 04-01 Task 1)
- [ ] `crates/pv-server/tests/unlock.rs` (new file) — covers AUTH-04's session-gated unlock ceremony, no-redundant-session-row invariant (delivered by Plan 04-01 Task 2)
- [ ] `web/src/lib/passkeys/login.test.ts` (new file) — covers the client orchestration's PRF-success/null/404/cancel/fail tier-routing logic (delivered by Plan 04-02 Task 2)
- [ ] `web/src/components/auth/LoginForm.test.tsx` / `UnlockOverlay.test.tsx` updates — new passkey-section + fallback-tier assertions added to existing test files, not new files (delivered by Plan 04-02 Task 3)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-authenticator fresh-login-with-PRF (Touch ID / Windows Hello / CDP virtual authenticator) | AUTH-04 | SoftPasskey (Rust) and mocked-WebAuthn (vitest) prove ceremony/orchestration correctness but not genuine browser `navigator.credentials` serialization/UX | Plan 04-03 Task 2, steps 3-5 |
| Real-authenticator reload-triggered unlock | AUTH-04 | Same as above, specifically the session-gated `unlock/*` path | Plan 04-03 Task 2, step 5 |
| AUTH-09 fallback tiers in a real browser (no-support / PRF-unavailable / genuine-failure / cancellation) | AUTH-09 | Visual/UX correctness of tier routing against a real DOM, real focus behavior (`autoFocus`) | Plan 04-03 Task 2, steps 6-8 |
| UI-DESIGN.md Screen 1 visual taste (morning-review-flagged items in 04-UI-SPEC.md: CTA wording, tier copy, divider) | UI-02 | Aesthetic judgment | Plan 04-03 Task 2, step 9 (screenshots) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (both Plan 04-03 tasks are verification-only; Task 2's checkpoint is preceded by Task 1's fully automated full-suite run)
- [x] Wave 0 covers all MISSING references from the RESEARCH test map
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-14 (generated during autonomous overnight run alongside the 3-plan/7-task breakdown; map populated from the final Plan 04-01/04-02/04-03 structure).
