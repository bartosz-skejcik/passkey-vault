---
phase: 3
slug: passkey-enrollment-account-security
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 03-RESEARCH.md § Validation Architecture and the 4-plan/12-task breakdown.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (pv-core, pv-wasm, pv-server incl. new passkeys/sessions integration tests) + vitest (web) + Playwright CDP virtual authenticator (e2e, manual-trigger) |
| **Config file** | Cargo.toml (workspace); web/vitest.config.ts |
| **Quick run command** | `cargo test -p pv-server` |
| **Full suite command** | `cargo test --workspace && (cd web && npm test) && (cd web && npm run build)` |
| **Estimated runtime** | ~150 seconds |

---

## Sampling Rate

- **After every task commit:** Run the crate-scoped test for the touched crate (`cargo test -p <crate>` or `cd web && npm test`)
- **After every plan wave:** Run full suite
- **Before `/gsd-verify-work`:** Full suite must be green; Playwright PRF e2e run at least once (CDP virtual authenticator, `hasPrf: true`)
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | AUTH-03 | supply-chain | Package Legitimacy Gate: webauthn-authenticator-rs verified on crates.io (kanidm org, same upstream as webauthn-rs) before `cargo add` (dev-dependency only) | checkpoint (human-verify; overnight: orchestrator resolves with recorded evidence per standing authorization) | — | N/A | ⬜ pending |
| 03-01-02 | 01 | 1 | AUTH-03 | T-03-02, T-03-03 | Migrations 0004-0006: passkeys rebuild (serialized Passkey blob, prf_salt, nullable prf_wrapped_uk), webauthn_states with expiry, sessions ALTER; RP ID/origin from env fail loudly when misconfigured | integration (Rust) | `cargo test -p pv-server` | N/A (created by task) | ⬜ pending |
| 03-01-03 | 01 | 1 | AUTH-03 | T-03-01 | register/start→finish persists credential with prf_capable=0; prf-wrap gated on REAL finish_passkey_authentication; replayed/forged assertion rejected (`register_persists_credential_before_prf`, `prf_wrap_rejects_replayed_assertion`); pw_wrapped_uk untouched by enrollment | integration (Rust, SoftPasskey) | `cargo test -p pv-server` | N/A (created by task) | ⬜ pending |
| 03-02-01 | 02 | 2 | AUTH-05, AUTH-06 | T-03-04 | List/rename/delete ownership-scoped (cross-user 404); rename validates non-empty/length; `delete_passkey_blocked_without_password_wrap` asserts 409 AND row survival (server-side no-stranding block, direct API test — roadmap SC#3) | integration (Rust) | `cargo test -p pv-server` | N/A (created by task) | ⬜ pending |
| 03-02-02 | 02 | 2 | AUTH-07 | T-03-05 (IDOR) | `sessions_list_marks_current` exactly one current row; `sessions_revoke_ownership_check` rejects cross-user revoke; revoking current session invalidates the bearer token | integration (Rust) | `cargo test -p pv-server` | N/A (created by task) | ⬜ pending |
| 03-03-01 | 03 | 2 | AUTH-03 | T-03-06 | `WasmWrappingKey.fromPrf` mirrors from_password (Zeroize on PRF bytes); wrap round-trip unit-tested | unit (Rust/WASM + vitest) | `cargo test -p pv-wasm && cd web && npm test` | N/A (created by task) | ⬜ pending |
| 03-03-02 | 03 | 2 | AUTH-03 | T-03-07 | Two-ceremony orchestration: base64url via parseCreationOptionsFromJSON/toJSON (no hand-rolled decode); PRF output read once from clientExtensionResults, never sent to server | unit/TDD (vitest, mocked WebAuthn) | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 03-03-03 | 03 | 2 | AUTH-03 | — | EnrollPasskeyDialog states (create → PRF eval → done / no-PRF honest state); step-2 cancel routes to no-PRF success, not retry-from-scratch | component (vitest) | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 03-04-01 | 04 | 3 | UI-05, AUTH-06 | — | PasskeysTab list/rename/delete wiring; delete dialog shows 409-blocked alert (not silent close) | component (vitest) | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 03-04-02 | 04 | 3 | UI-05 | — | SettingsPanel 4 tabs, default Passkeys; autolock/clipboard controls migrated from Sidebar still function (regression) | component (vitest) + build | `cd web && npm test && npm run build` | N/A (created by task) | ⬜ pending |
| 03-04-03 | 04 | 3 | AUTH-07, UI-05 | — | SessionsTab current-device badge, per-row revoke, bulk revoke-others | component (vitest) | `cd web && npm test` | N/A (created by task) | ⬜ pending |
| 03-04-04 | 04 | 3 | AUTH-03 (E2E) | T-03-01 | Full enrollment with Chromium CDP virtual authenticator (`hasPrf: true`) → prf_capable badge; PRF client-injection tolerance proven end-to-end | e2e checkpoint (Playwright; overnight: orchestrator runs it per standing authorization) | Playwright MCP / `npx playwright test enroll-passkey.spec.ts` | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/pv-server/tests/passkeys.rs` + SoftPasskey harness helper — covers AUTH-03/05/06 (delivered by Plans 03-01/03-02)
- [ ] `crates/pv-server/tests/sessions.rs` — covers AUTH-07 (delivered by Plan 03-02 Task 2)
- [ ] `web/src/components/settings/*.test.tsx` — covers UI-05 (delivered by Plans 03-03/03-04)
- [ ] PRF e2e via CDP virtual authenticator — covers AUTH-03 end-to-end (delivered at 03-04 Task 4 checkpoint; plan-checker Warning 4 requires it run at least once before AUTH-03 is marked verified)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-authenticator enrollment (Touch ID / iCloud Keychain) | AUTH-03 | CDP virtual authenticator ≠ platform authenticator UX | Morning: enroll a real passkey on Bartek's Mac, confirm PRF badge |
| Settings visual taste (6 flagged items in 03-UI-SPEC "Morning review notes") | UI-05 | Aesthetic judgment | Morning review with screenshots |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references from the RESEARCH test map
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-14 (generated during autonomous run to close plan-checker blocker; map populated from final 4-plan/12-task breakdown)
