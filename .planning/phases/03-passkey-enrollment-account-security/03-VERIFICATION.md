---
phase: 03-passkey-enrollment-account-security
verified: 2026-07-14T19:20:00Z
status: passed
score: 11/11 must-haves verified
behavior_unverified: 0
overrides_applied: 0
revalidated: "2026-07-14 (re-stamp) — original 11/11 verification still holds at current HEAD: passkey-enrollment/session/unlock code is unchanged since phases 4-7 (which touched PRF-login, sync, and server packaging, not the phase-3 enrollment/settings core), and the full `cargo test --workspace` suite is green (passkeys 10, passkey_login 7, sessions 4, unlock 4). The prior 'stale' flag was a timestamp artifact of 03-04-SUMMARY.md being reconstructed after the initial verification (commit dc3459d), not a code change. The one deferred item below is now DELIVERED by the completed Phase 6."
deferred:
  - truth: "Import/Export functionality in the Settings surface (UI-05)"
    addressed_in: "Phase 6 (COMPLETE 2026-07-14)"
    evidence: "RESOLVED: Phase 6 shipped working client-side import (Bitwarden/NordPass/1Password/LastPass/KeePass/generic) + JSON/CSV export with a plaintext-warning gate, replacing the phase-3 Import/Eksport placeholder. Verified + UAT-passed (see 06-VERIFICATION.md / 06-UAT.md). No longer deferred."
---

# Phase 3: Passkey Enrollment & Account Security Verification Report

**Phase Goal:** A user can enroll a passkey with PRF for future vault unlock, and manage passkeys/sessions from a settings screen, without ever being able to strand their vault.
**Verified:** 2026-07-14T10:40:00Z
**Status:** passed
**Re-verification:** No — initial verification

> Note: Phase is `mode: mvp`, but the ROADMAP goal is a descriptive goal, not strict "As a…, I want…, so that…" User Story form. Verified against the 4 ROADMAP Success Criteria (the binding contract) plus the merged PLAN-frontmatter must_haves across all 4 plans. Every code claim below was checked against the current post-fix source, not against SUMMARY/UAT narrative.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Two-ceremony enrollment: `create()` registers, follow-up `get()`+PRF wraps User Key; passkey wrap added ALONGSIDE — never replacing — the password wrap (SC#1, AUTH-03) | ✓ VERIFIED | `passkeys.rs::register_finish` inserts row `prf_capable=0` then `start_passkey_authentication` in-process (L164-201); `prf_wrap` does a *separate* `UPDATE passkeys SET prf_wrapped_uk=?, prf_capable=1` (L273-282) — `users.pw_wrapped_uk` is never touched by any passkey endpoint. UAT (Playwright + CDP virtual authenticator hasPrf:true) + direct SQLite: `prf_capable=1`, `prf_wrapped_uk` set, `pw_wrapped_uk` intact for all users. |
| 2 | Second ceremony verified as REAL WebAuthn auth (`finish_passkey_authentication`), never trusting an uploaded `prf_wrapped_uk` blob on Bearer-session alone (AUTH-03) | ✓ VERIFIED | `prf_wrap` gates the UPDATE on `webauthn.finish_passkey_authentication(&req.credential, &auth_state)` (L261-267) after consuming the persisted auth state; state row's own `passkey_id` must match the path id (L242). Integration test `prf_wrap_rejects_replayed_assertion` passes. |
| 3 | `prf_capable` set server-side only, never from a client flag | ✓ VERIFIED | `PrfWrapRequest` has no `prf_capable` field (state_id, credential, prf_wrapped_uk only). Only server write is `prf_capable = 1` in `prf_wrap` post-verification; migration 0004 defaults `prf_capable INTEGER NOT NULL DEFAULT 0`. grep for client-sourced writes: none. |
| 4 | Deleting a passkey that would strand the vault (no pw fallback) is blocked by the SERVER with 409, verified by direct API test (SC#3, AUTH-05) | ✓ VERIFIED | `delete_passkey` SELECTs `pw_wrapped_uk` BEFORE the DELETE; `if pw_wrapped_uk.is_empty()` → `ApiError::Conflict` (409) (L367-375). Integration test `delete_passkey_blocked_without_password_wrap` constructs the otherwise-unreachable state, asserts 409 + row survival — passes. |
| 5 | User lists active sessions with exactly one marked current + revoke any individual (SC#4, AUTH-07) | ✓ VERIFIED | `sessions.rs::list` computes `current` server-side via `crypto::hash_token(current_token)` per-row compare (L36-56), IDOR-scoped by `user_id`; `revoke` DELETEs `WHERE id=? AND user_id=?` (IDOR). Test `sessions_revoke_ownership_check` passes. |
| 6 | Anti-replay: ceremony state consumed atomically (single-use) (WR-01) | ✓ VERIFIED | `webauthn_state.rs::consume_state` is a single `DELETE … RETURNING … WHERE … expires_at > datetime('now')` (L73-84). Test `consume_state_is_atomic_under_concurrent_callers` (200 trials, 2 barrier-released tokio tasks on a multi-conn pool) passes; documented to fail against the pre-fix SELECT-then-DELETE. |
| 7 | PRF bytes derived into wrapping key entirely inside WASM; raw PRF never in rendered state or network body other than wrapped ciphertext (AUTH-03) | ✓ VERIFIED | `enroll.ts` reads PRF from `getClientExtensionResults()`, passes straight to `WasmWrappingKey.fromPrf(prfArray)` which zeroizes the buffer; WR-04 fix deletes `clientExtensionResults.prf` from `assertion.toJSON()` before POST (L111-113); `wrappingKey.free()` in `finally`. `enroll.test.ts` (8 tests) covers strip + free-on-error. |
| 8 | Step-2 (get()+PRF) cancel/failure → Done(no-PRF) state, never Cancelled/Failed (no orphaned credential) (AUTH-03) | ✓ VERIFIED | `enroll.ts` returns `onStep("doneNoPrf")` on missing PRF results and in the catch (L87, L147); IN-03 fix adds observability logging for genuine failures without changing the outward state. Tests confirm doneNoPrf on both paths. |
| 9 | Settings opens from the sidebar account button as the same z-40 drawer + z-30 scrim pattern as the vault detail panel (UI-05) | ✓ VERIFIED | `Sidebar.tsx` account button → `onOpenSettings?.()` (L409) → `page.tsx` `handleOpenSettings`/`settingsOpen` state; `SettingsPanel` uses `fixed inset-y-0 right-0 z-40 … md:w-[400px]`, scrim `z-30` shared slot (page.tsx L178-228). |
| 10 | From Settings: list passkeys (name/date/last-used), inline rename, delete with recovery-reassurance warning; server 409 surfaces as visible alert not silent close (SC#2, AUTH-06) | ✓ VERIFIED | `PasskeysTab.tsx` list/rename/delete + enrollment CTA wired to `EnrollPasskeyDialog`. `PasskeyDeleteConfirmDialog.tsx` renders `passkey-delete-blocked-alert` on `ApiClientError && err.status === 409` (L43, L78). UAT confirmed sober confirm modal with recovery copy. |
| 11 | From Settings: active sessions/devices, current marked, revoke any other + bulk revoke others (SC#4, AUTH-07, UI-05) | ✓ VERIFIED | `SessionsTab.tsx` renders sessions with current-device badge + per-session and bulk revoke (confirm modals). UAT confirmed "to urządzenie" badge + revoke modals; WR-02 fix persists User-Agent so device rows resolve. |

**Score:** 11/11 truths verified (0 present, behavior-unverified)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Import/Export functionality (UI-05 sub-area) | Phase 6 | ROADMAP Phase 6 "Import/Export, TOTP & Onboarding" SC#2/#3. Phase 3 plan 03-04 explicitly scopes the tab as "Import/Export placeholder"; `SettingsPanel.tsx` renders `settings.importExportPlaceholder`. Surface reachable, functionality intentionally deferred. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `migrations/0004_passkeys_rebuild.sql` | passkeys table (replaces webauthn_credentials) | ✓ VERIFIED | Table with `prf_capable NOT NULL DEFAULT 0`, `prf_wrapped_uk` opaque, `credential_id UNIQUE`, cascade FK |
| `migrations/0006_webauthn_states.sql` | persisted ceremony state | ✓ VERIFIED | Table + `idx_webauthn_states_expiry` + `passkey_id` FK cascade |
| `routes/passkeys.rs` | register_start/finish, prf_wrap, list/rename/delete | ✓ VERIFIED | 388 lines; all handlers present + wired in mod.rs |
| `routes/sessions.rs` | list (current marker) + revoke | ✓ VERIFIED | 83 lines; IDOR-scoped, hash_token current marker |
| `routes/webauthn_state.rs` | atomic consume + persist + sweep | ✓ VERIFIED | DELETE…RETURNING consume, opportunistic expiry sweep |
| `crates/pv-wasm/src/lib.rs::fromPrf` | PRF→wrapping key WASM export | ✓ VERIFIED | `WasmWrappingKey::from_prf` (js_name fromPrf), zeroizes input |
| `web/src/lib/passkeys/enroll.ts` | two-ceremony orchestration | ✓ VERIFIED | 149 lines; `enrollPasskey`, no React state, onStep callback |
| `web/src/components/settings/EnrollPasskeyDialog.tsx` | 7-state ceremony dialog | ✓ VERIFIED | Present, wired to enrollPasskey |
| `web/src/components/settings/SettingsPanel.tsx` | drawer + 4-tab switcher | ✓ VERIFIED | z-40 drawer, Passkeys/Sessions/Security/Import-Export tabs |
| `web/src/components/settings/PasskeysTab.tsx` | list/rename/delete + enroll CTA | ✓ VERIFIED | Wired to EnrollPasskeyDialog |
| `web/src/components/settings/PasskeyDeleteConfirmDialog.tsx` | 409-blocked alert path | ✓ VERIFIED | `status === 409` → alert-error block |
| `web/src/components/settings/SecurityTab.tsx` | migrated auto-lock + clipboard | ✓ VERIFIED | AUTOLOCK_CHANGED_EVENT + clipboard-clear controls migrated from Sidebar |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| `passkeys.rs::register_finish` | `webauthn.start_passkey_authentication` | in-process second-ceremony start | ✓ WIRED (L187) |
| `passkeys.rs::prf_wrap` | `webauthn.finish_passkey_authentication` | assertion gates prf_wrapped_uk UPDATE | ✓ WIRED (L263) |
| `passkeys.rs::delete_passkey` | `users.pw_wrapped_uk` | guard before DELETE, 409 on empty | ✓ WIRED (L367-375) |
| `sessions.rs::list` | `crypto::hash_token` | per-row current marker | ✓ WIRED (L37,55) |
| `EnrollPasskeyDialog.tsx` | `enroll.ts::enrollPasskey` | dialog renders off onStep callback | ✓ WIRED |
| `enroll.ts` | `WasmWrappingKey.fromPrf` | raw PRF passed directly, never stored | ✓ WIRED (L91) |
| `Sidebar.tsx` | `page.tsx` (onOpenSettings) | account button sets settingsOpen | ✓ WIRED (L409/L155) |
| `PasskeyDeleteConfirmDialog.tsx` | `DELETE /api/passkeys/:id` 409 | status===409 renders alert | ✓ WIRED (L43) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend integration suite (incl. anti-replay concurrency, delete-guard, IDOR, UA persistence) | `cargo test -p pv-server` | passkeys 10, sessions 4, auth 9, vault 13, lib 7 — all pass | ✓ PASS |
| Web unit/component suite | `npx vitest run` (in web/) | 28 files, 178/178 pass | ✓ PASS |
| TypeScript typecheck | `npx tsc --noEmit` (in web/) | exit 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| AUTH-03 | 03-01, 03-03 | Two-ceremony PRF passkey enrollment | ✓ SATISFIED | Truths 1,2,3,7,8 |
| AUTH-05 | 03-02, 03-04 | Recovery invariant — server blocks stranding | ✓ SATISFIED | Truth 4 + `delete_passkey_blocked_without_password_wrap` |
| AUTH-06 | 03-02, 03-04 | Manage passkeys (list/rename/delete + warning) | ✓ SATISFIED | Truth 10 |
| AUTH-07 | 03-02, 03-04 | View sessions/devices + revoke | ✓ SATISFIED | Truths 5, 11 |
| UI-05 | 03-04 | Settings surface (passkeys/sessions/import-export/auto-lock/clipboard) | ✓ SATISFIED (import/export placeholder; functionality deferred to Phase 6) | Truths 9,10,11 + SecurityTab migration; import/export placeholder tab reachable |

All 5 declared requirement IDs accounted for. No orphaned requirements (REQUIREMENTS.md maps exactly AUTH-03/05/06/07 + UI-05 to Phase 3).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No unreferenced TBD/FIXME/XXX, TODO/HACK, or empty-stub patterns in phase-modified source | ℹ️ Info | Import/Export placeholder tab is intentional/documented (Phase 6 scope), not a stub gap |

### Human Verification Required

None. The one item that would ordinarily route to human verification — real-browser PRF enrollment (a state-transition/PRF-eval behavior grep cannot see) — was already completed via Playwright + Chrome DevTools CDP virtual authenticator (hasPrf:true) with direct SQLite inspection (03-UAT.md), which per the standing Playwright-UAT authorization is treated as human-equivalent evidence. All 4 roadmap success criteria were exercised (2 via live browser + DB inspection, 2 via direct-API integration tests).

### Gaps Summary

No gaps. All 11 merged must-haves (4 ROADMAP success criteria + plan-frontmatter truths) are verified in the current post-fix codebase. The two-ceremony PRF flow, the server-enforced no-stranding 409 guard, the atomic anti-replay state consume (WR-01), server-only `prf_capable`, the zero-knowledge PRF-byte boundary (WR-04), and the full Settings surface (drawer + tabs, IDOR-scoped sessions with current marker + revoke) all hold in code and are backed by green integration/unit suites plus the completed UAT. Import/Export functionality is intentionally a placeholder here and is scheduled for Phase 6 — recorded as deferred, not a gap.

---

_Verified: 2026-07-14T10:40:00Z_
_Verifier: Claude (gsd-verifier)_
