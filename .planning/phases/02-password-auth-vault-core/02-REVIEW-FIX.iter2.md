---
phase: 02-password-auth-vault-core
fixed_at: 2026-07-13T17:23:04Z
review_path: .planning/phases/02-password-auth-vault-core/02-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-07-13T17:23:04Z
**Source review:** .planning/phases/02-password-auth-vault-core/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 10 (all Critical/Warning findings; Info findings IN-01..IN-03 out of scope for `critical_warning`)
- Fixed: 10
- Skipped: 0

**Note on execution:** This fix run resumed a previously interrupted run. WR-01 through WR-05 were fixed and committed to `main` in that earlier session (commits `1b06bf8`, `affb09e`, `03b8953`, `a7d8479`, `c329f06`). This run verified each of those commits is present in current code (confirmed via `git log` before starting) and did not re-apply or duplicate them. This run's own work covered WR-06 through WR-10.

## Fixed Issues

### WR-01: Wrapping-key WASM handle leaked (never freed/zeroized) on error paths

**Files modified:** `web/src/components/auth/UnlockOverlay.tsx`, `web/src/components/auth/LoginForm.tsx`
**Commit:** `1b06bf8` (prior interrupted run — verified present on `main`)
**Applied fix:** Hoisted `wrappingKey` out of the `try` block and freed it unconditionally in `finally`, mirroring `RegisterForm.tsx`'s existing correct pattern.

### WR-02: Email is never normalized before storage or lookup

**Files modified:** `crates/pv-server/src/routes/auth.rs`
**Commit:** `affb09e` (prior interrupted run — verified present on `main`)
**Applied fix:** Normalize email (`trim().to_lowercase()`) once at the API boundary in `register()` and `login()`, matching `prelogin()`'s existing normalization.

### WR-03: Item/folder creation failures are unhandled promise rejections with no user-facing error

**Files modified:** `web/src/components/vault/ItemForm.tsx`, `web/src/components/shell/Sidebar.tsx`
**Commit:** `03b8953` (prior interrupted run — verified present on `main`)
**Applied fix:** Surfaced create-mode failures via an `onError` callback and wrapped both `handleCreateFolder` implementations in `try`/`catch` with user-facing error feedback.

### WR-04: Auto-lock timeout is read with no validation in `page.tsx`

**Files modified:** `web/src/app/page.tsx`, `web/src/components/shell/Sidebar.tsx`
**Commit:** `a7d8479` (prior interrupted run — verified present on `main`)
**Applied fix:** Extracted a single shared whitelist-validated `readAutolockMinutes()` and used it from both call sites.

### WR-05: Clipboard auto-clear duration is read with no bounds validation

**Files modified:** `web/src/lib/clipboard.ts`, `web/src/components/shell/Sidebar.tsx`
**Commit:** `c329f06` (prior interrupted run — verified present on `main`)
**Applied fix:** Clamped `readClipboardSeconds()` to the documented 30-60s range and mirrored the clamp when seeding the `Sidebar` slider state.

### WR-06: `/api/vault/folders` has no payload size limit, unlike `/api/vault/items`

**Files modified:** `crates/pv-server/src/routes/folders.rs`, `crates/pv-server/src/routes/vault.rs`
**Commit:** `c3598e6`
**Applied fix:** Made `vault.rs`'s `validate_blob_len` and `MAX_ITEM_BLOB_BYTES` `pub(crate)` and reused them in `folders::create` to cap `enc_name` at the same 64 KiB limit as item blobs, closing the storage-abuse gap.
**Verification:** `cargo check -p pv-server` clean; `cargo test -p pv-server --test vault` — 11/11 passed (including the existing `create_folder_returns_201_with_id` case, confirming normal-size payloads still succeed).

### WR-07: `login()` has a timing side-channel the file's own comments say it's trying to avoid

**Files modified:** `crates/pv-server/src/routes/auth.rs`
**Commit:** `c282f81`
**Applied fix:** On the unknown-email path, `login()` now performs the same decode + `server_rehash` + `constant_time_eq` work (against fixed decoy salt/hash constants) that the known-email/wrong-password path performs, before returning `Unauthorized` — closing the timing gap between the two failure modes and matching `prelogin()`'s existing dummy-work discipline.
**Verification:** `cargo check -p pv-server` clean; `cargo test -p pv-server --test auth` — 8/8 passed (including `login_with_nonexistent_email_returns_same_shape_as_wrong_auth_hash`).
**Note:** This closes a *measurable* timing gap by equalizing the CPU work performed on both branches; it does not (and cannot, at this layer) provide constant-time guarantees against a sophisticated network-level timing attacker. Flagged for human confirmation that this satisfies the intended threat-model bar (T-02-04).

### WR-08: Hardcoded, non-localized copy in the password generator

**Files modified:** `web/src/components/generator/GeneratorPopover.tsx`, `web/src/lib/i18n/dictionary.ts`
**Commit:** `145b047`
**Applied fix:** Added `generator.modeCharacter` (`"Znaki"` / `"Characters"`) and `generator.modePassphrase` (`"Passphrase"` / `"Passphrase"`) dictionary keys and replaced the literal button labels with `t(...)` calls.
**Verification:** Web test suite (`npx vitest run`) — 102/102 passed, including `GeneratorPopover.test.tsx` (5/5).

### WR-09: `CorsLayer::permissive()` is unconditional, with no environment gating

**Files modified:** `crates/pv-server/src/routes/mod.rs`
**Commit:** `04a0b80`
**Applied fix:** Extracted a `cors_layer()` helper that only returns `CorsLayer::permissive()` when the `PV_DEV_CORS` env var is set to `1`/`true`; otherwise returns the default (most-restrictive) `CorsLayer::new()`. Default behavior is now closed unless explicitly opted into for local dev.
**Verification:** `cargo check -p pv-server` clean; full `cargo test -p pv-server` — all unit + `auth`/`vault` integration tests passed (24/24 total), confirming the CORS default change doesn't affect direct (non-browser) request handling used by the test harness.

### WR-10: `MIN_AUTH_HASH_LEN` accepts a shorter length than the value actually produced

**Files modified:** `crates/pv-server/src/routes/auth.rs`
**Commit:** `6362c2c`
**Applied fix:** Replaced the `MIN_AUTH_HASH_LEN = 16` (range) check in `register()` with an exact-length check against `EXPECTED_AUTH_HASH_LEN = pv_core::keys::KEY_LEN` (32), matching the value `auth_hash` actually always has.
**Verification:** `cargo check -p pv-server` clean; `cargo test -p pv-server --test auth` — 8/8 passed (including `register_then_duplicate_email_returns_conflict`, whose 32-byte fixture auth_hash confirms the exact-length check doesn't regress the normal registration path).

---

_Fixed: 2026-07-13T17:23:04Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
