---
phase: 02-password-auth-vault-core
reviewed: 2026-07-13T00:00:00Z
depth: standard
files_reviewed: 55
files_reviewed_list:
  - crates/pv-core/src/items.rs
  - crates/pv-core/src/kdf.rs
  - crates/pv-core/src/keys.rs
  - crates/pv-server/Cargo.toml
  - crates/pv-server/migrations/0002_auth_hash.sql
  - crates/pv-server/migrations/0003_vault_items_rebuild.sql
  - crates/pv-server/src/config.rs
  - crates/pv-server/src/crypto.rs
  - crates/pv-server/src/error.rs
  - crates/pv-server/src/lib.rs
  - crates/pv-server/src/main.rs
  - crates/pv-server/src/routes/auth.rs
  - crates/pv-server/src/routes/folders.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/session.rs
  - crates/pv-server/src/routes/vault.rs
  - crates/pv-server/tests/auth.rs
  - crates/pv-server/tests/common/mod.rs
  - crates/pv-server/tests/vault.rs
  - crates/pv-wasm/src/lib.rs
  - web/src/app/globals.css
  - web/src/app/layout.tsx
  - web/src/app/page.tsx
  - web/src/app/self-test/page.tsx
  - web/src/components/auth/AuthCard.tsx
  - web/src/components/auth/LoginForm.tsx
  - web/src/components/auth/RegisterForm.tsx
  - web/src/components/auth/UnlockOverlay.tsx
  - web/src/components/generator/GeneratorPopover.tsx
  - web/src/components/self-test/SelfTestCard.tsx
  - web/src/components/shell/MainColumn.tsx
  - web/src/components/shell/Sidebar.tsx
  - web/src/components/shell/TopBar.tsx
  - web/src/components/vault/CopyToast.tsx
  - web/src/components/vault/DeleteConfirmDialog.tsx
  - web/src/components/vault/DetailPanel.tsx
  - web/src/components/vault/ItemForm.tsx
  - web/src/components/vault/ItemList.tsx
  - web/src/components/vault/ItemRow.tsx
  - web/src/components/vault/PasskeyPlaceholderSection.tsx
  - web/src/components/vault/TypePicker.tsx
  - web/src/lib/auth/api.ts
  - web/src/lib/auth/pendingUnlock.ts
  - web/src/lib/auth/session.ts
  - web/src/lib/clipboard.ts
  - web/src/lib/crypto/index.test.ts
  - web/src/lib/crypto/index.ts
  - web/src/lib/generator/password.ts
  - web/src/lib/generator/strength.ts
  - web/src/lib/generator/wordlist.ts
  - web/src/lib/i18n/LocaleContext.tsx
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/idle/useIdleTimer.ts
  - web/src/lib/idle/autolock.ts
  - web/src/lib/vault/api.ts
findings:
  critical: 0
  warning: 0
  info: 4
  total: 4
status: clean
---

# Phase 02: Code Review Report (Re-review — iteration 3)

**Reviewed:** 2026-07-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 55 (Rust crates + Next.js web app)
**Status:** clean

## Summary

This is a re-review of the 10 warnings (WR-01..WR-10) surfaced in the prior review (`02-REVIEW.iter2.md`), each addressed in commits `1b06bf8..145b047`. **All 10 fixes are correctly and completely applied**, with no partial fixes and no functional regressions. `cargo check -p pv-server` and `npx tsc --noEmit` both pass clean, confirming the changes build.

Verification notes per warning:

- **WR-01** (wrapping-key handle leak): `LoginForm.tsx` and `UnlockOverlay.tsx` now both hoist `wrappingKey` to a `let` outside the `try` and free it unconditionally in `finally`; `LoginForm` sets it to `undefined` after `setPendingUnlock` transfers ownership, so there is no double-free. Mirrors the already-correct `RegisterForm` pattern. Correct.
- **WR-02** (email normalization): `register`, `login`, and both `prelogin` branches now normalize via `req.email.trim().to_lowercase()` and bind the normalized value in every INSERT/SELECT. Consistent across the file. Correct.
- **WR-03** (unhandled creation rejections): `ItemForm.handleSubmit` create-mode now sets a `submitError` banner instead of `throw err`; `ItemForm.handleCreateFolder` and `Sidebar.handleCreateFolder` are wrapped in `try/catch` surfacing `error.folderCreateFailed`. New dictionary keys added. Correct.
- **WR-04** (unvalidated autolock timeout): extracted to `web/src/lib/idle/autolock.ts` with a single whitelist-validated `readAutolockMinutes()`; both `page.tsx` and `Sidebar.tsx` read through it. Correct (one cosmetic leftover — see IN-04).
- **WR-05** (unclamped clipboard duration): `clampClipboardSeconds()` added to `clipboard.ts`, clamping to 30–60s with a `Number.isFinite` guard; used by both `readClipboardSeconds()` and Sidebar's slider seed. Correct.
- **WR-06** (unbounded folder payload): `validate_blob_len`/`MAX_ITEM_BLOB_BYTES` promoted to `pub(crate)` and applied to `folders::create`'s `enc_name`. Correct. (`folders` has no update endpoint, so `create` is the only write path needing the guard.)
- **WR-07** (login timing oracle): unknown-email branch now performs a decode + `server_rehash` + `constant_time_eq` against fixed decoy values before returning `Unauthorized`, matching the known-email/wrong-password branch's crypto work. Best-effort parity is now in place. Correct.
- **WR-08** (hardcoded generator copy): `"Znaki"`/`"Passphrase"` replaced with `t("generator.modeCharacter")`/`t("generator.modePassphrase")`; both keys added to `DICTIONARY`. Correct.
- **WR-09** (unconditional permissive CORS): `permissive()` now gated behind `PV_DEV_CORS` env var via `cors_layer()`, defaulting to a locked-down `CorsLayer::new()`. Correct.
- **WR-10** (over-permissive auth_hash length): `MIN_AUTH_HASH_LEN = 16` replaced with `EXPECTED_AUTH_HASH_LEN = pv_core::keys::KEY_LEN` and an exact `!=` length check in `register`. Correct.

No new Critical or Warning findings. One new cosmetic Info item (IN-04) was introduced by the WR-04 refactor. Prior Info items IN-01..IN-03 are carried forward unchanged; their risk has not changed and they were previously accepted.

Because zero Critical and zero Warning findings remain, **status is `clean`**.

## Info

### IN-04: Dead re-export of autolock constants left behind after WR-04 refactor (new)

**File:** `web/src/components/shell/Sidebar.tsx:391`
**Issue:** The WR-04 fix moved `AUTOLOCK_MINUTES_KEY`, `AUTOLOCK_CHANGED_EVENT`, and `DEFAULT_AUTOLOCK_MINUTES` into `web/src/lib/idle/autolock.ts`, and `Sidebar.tsx` now *imports* them from there (lines 28–32). However, the old re-export line `export { AUTOLOCK_MINUTES_KEY, AUTOLOCK_CHANGED_EVENT, DEFAULT_AUTOLOCK_MINUTES };` was left in place. Since `page.tsx` (the only prior consumer) now imports these directly from `autolock.ts`, and the only remaining importers of `Sidebar` (`page.tsx`, `self-test/page.tsx`) use the default export, this re-export is dead code — it re-exports symbols the module merely re-imports. Harmless and it compiles, but it's exactly the kind of leftover the single-source-of-truth refactor was meant to eliminate.
**Fix:** Delete line 391. The canonical definitions now live in `@/lib/idle/autolock`.

### IN-01: Ad-hoc `.replace("{token}", ...)` used instead of the shared `interpolate()` helper (carried forward — previously accepted)

**File:** `web/src/components/vault/ItemList.tsx:31`, `web/src/components/self-test/SelfTestCard.tsx:58, 89-92`
**Issue:** These call sites bypass `dictionary.ts`'s `interpolate()` helper with raw `String.prototype.replace`. Functionally equivalent today; an inconsistent pattern that could misbehave if a substituted value itself contained `{token}`-shaped text. Risk unchanged since the prior review.
**Fix:** Use `interpolate(t("..."), { ... })` for consistency.

### IN-02: Stale `folderId` reference silently persists when its folder was deleted elsewhere (carried forward — previously accepted)

**File:** `web/src/components/vault/ItemForm.tsx:153-156, 469-487`
**Issue:** If an item's `folderId` points to a since-deleted folder (no server-side cascade, by design), the `<select>` has no matching option and saving re-persists the dangling id. Risk unchanged since the prior review.
**Fix:** Clear `folderId` to `null` on mount when it matches no known folder, or render a synthetic "(deleted folder)" option.

### IN-03: `MAX_ITEM_BLOB_BYTES` check is a byte count, not a character count (carried forward — previously accepted)

**File:** `crates/pv-server/src/routes/vault.rs:43-48`
**Issue:** `validate_blob_len` checks `value.len()` on a `&str` (UTF-8 byte count) — correct behavior, but the 64 KiB budget is easy to misread as "64k characters." Risk unchanged since the prior review. Now also applied to `folders::create` via WR-06, making a clarifying comment marginally more valuable.
**Fix:** Non-blocking; a one-line "bytes, not chars" comment on the constant.

---

_Reviewed: 2026-07-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
