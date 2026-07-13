---
phase: 02-password-auth-vault-core
reviewed: 2026-07-13T00:00:00Z
depth: standard
files_reviewed: 49
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
  - web/src/lib/vault/api.ts
  - web/src/lib/vault/copyToast.ts
  - web/src/lib/vault/search.ts
  - web/src/lib/vault/store.ts
  - web/src/lib/vault/types.ts
  - web/vitest.setup.ts
findings:
  critical: 0
  warning: 10
  info: 3
  total: 13
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-07-13T00:00:00Z
**Depth:** standard
**Files Reviewed:** 49 (Rust crates + Next.js web app)
**Status:** issues_found

## Summary

The pv-core crypto primitives (`keys.rs`, `kdf.rs`, `items.rs`) are solid: AAD binding, domain-separated HKDF, Zeroize discipline, and constant-time comparison are all implemented correctly and match the CLAUDE.md conventions. The server routes correctly scope every vault/folder query by `session.user_id`, use atomic `ON CONFLICT` inserts to avoid TOCTOU races, and use single-statement optimistic-concurrency updates for items.

The issues found are concentrated in two areas: (1) a client-side key-handle cleanup gap that breaks the project's own Zeroize-everywhere invariant on certain error paths (`LoginForm.tsx`, `UnlockOverlay.tsx`), and (2) several input-validation/consistency gaps between the server and the web client (email normalization, folder blob size limits, unvalidated localStorage-sourced security timers). None of these rise to a remotely-exploitable critical vulnerability, but several directly undermine documented security guarantees (auto-lock timeout, clipboard-clear window, wrapping-key zeroization) and should be fixed before this phase is considered done.

## Warnings

### WR-01: Wrapping-key WASM handle leaked (never freed/zeroized) on error paths

**File:** `web/src/components/auth/UnlockOverlay.tsx:78-103`
**Issue:** `unlockFromPassword` extracts a `WasmWrappingKey` handle via `material.takeWrappingKey()` (line 79) and only calls `wrappingKey.free?.()` on the success path (line 83), immediately after `unwrapUserKey`. If `unwrapUserKey` throws (e.g. the user typed the wrong master password — a very common case for this exact code path), execution jumps straight to `catch`/`finally`. The `finally` block (lines 99-103) only frees `material`, never `wrappingKey`. Because `takeWrappingKey()` internally does `std::mem::replace(&mut self.wrapping_key, [0u8; KEY_LEN])` (see `crates/pv-wasm/src/lib.rs:164-170`), the actual key bytes have already moved *out* of `material` and into the new `WasmWrappingKey` object — freeing `material` zeroizes only the now-empty field, not the live key. The derived wrapping key (a 256-bit secret from the user's password) is left un-freed and un-zeroized in WASM linear memory for the rest of the page session.

The identical pattern exists in `web/src/components/auth/LoginForm.tsx:39-64`: `wrappingKey` is extracted at line 39 and only transferred to `setPendingUnlock` on the happy path (line 50); if the subsequent `login()` network call (lines 41-44) throws (wrong auth hash → 401, or any network error), `wrappingKey` is never freed in the `catch`/`finally` (lines 54-64).

Contrast with `RegisterForm.tsx`, which does this correctly: `wrappingKey` is declared with `let` *outside* the `try` block (line 58) and unconditionally freed in `finally` via `wrappingKey?.free?.()` (line 100).

**Fix:**
```ts
// UnlockOverlay.tsx — hoist wrappingKey out of the try block, mirror RegisterForm's pattern
let wrappingKey: WasmWrappingKey | undefined;
try {
  ...
  material = deriveAuthMaterial(passwordBytes, decodedSalt, JSON.stringify(kdf));
  wrappingKey = material.takeWrappingKey();
  const uk = unwrapUserKey(wrappingKey, account.pw_wrapped_uk);
  setUnlockedUserKey(uk);
} catch (err) {
  ...
} finally {
  passwordBytes.fill(0);
  material?.free?.();
  wrappingKey?.free?.();
  setSubmitting(false);
}
```
Apply the same hoist-and-free-in-`finally` pattern to `LoginForm.tsx` (only free it when it wasn't successfully handed off to `setPendingUnlock`, or free it unconditionally and have `pendingUnlock.ts` clone/re-derive — whichever keeps a single owner).

---

### WR-02: Email is never normalized before storage or lookup — case-sensitive duplicate accounts and login failures

**File:** `crates/pv-server/src/routes/auth.rs:84-124` (register), `crates/pv-server/src/routes/auth.rs:142-164` (login)
**Issue:** `register()` validates `req.email.trim().is_empty()` (line 88) but then stores the **raw, untrimmed, case-as-typed** `req.email` (line 110: `.bind(&req.email)`). `login()` and `prelogin()`'s real-account branch both look up `WHERE email = ?` using the raw request email (line 147, line 46) with no `.trim()`/`.to_lowercase()`. SQLite's default `TEXT` comparison is byte-exact, so:
- `Alice@Example.com` and `alice@example.com` register as two distinct accounts (the `ON CONFLICT(email) DO NOTHING` uniqueness guard never fires between them).
- A user who registers as `alice@example.com` and later types `Alice@Example.com` at login gets a generic "wrong credentials" response even though the password is correct — an unrecoverable-looking failure mode from the user's point of view.
- Leading/trailing whitespace pasted into the email field (e.g. from a password manager autofill) has the same effect.

Note `prelogin()`'s *dummy*-salt path already normalizes (`req.email.trim().to_lowercase()`, line 56) — the inconsistency between that branch and every other email-touching code path in the same file makes this look like an oversight rather than a deliberate choice.

**Fix:** Normalize once, at the API boundary, and use the normalized value everywhere:
```rust
let normalized_email = req.email.trim().to_lowercase();
if normalized_email.is_empty() || !normalized_email.contains('@') {
    return Err(ApiError::BadRequest("invalid email".into()));
}
// ...bind normalized_email in the INSERT and every SELECT WHERE email = ?
```

---

### WR-03: Item/folder creation failures are unhandled promise rejections with no user-facing error

**File:** `web/src/components/vault/ItemForm.tsx:216-241` (`handleSubmit`), `web/src/components/vault/ItemForm.tsx:201-209` + `511` (`handleCreateFolder`), `web/src/components/shell/Sidebar.tsx:146-152` + `214` (`handleCreateFolder`)
**Issue:** In `ItemForm.handleSubmit`, the `catch` block only surfaces an error via `onError?.(err)` when `mode === "edit"`; for the create-item path it does `throw err;` (line 236) inside an `async` function invoked from `onSubmit={handleSubmit}` with no caller `.catch()`. This becomes an unhandled promise rejection: a failed `createVaultItem` call (e.g. the 400 from `MAX_ITEM_BLOB_BYTES`, a 401 from an expired session, or a plain network failure) silently resets the submit button with **zero feedback to the user** — the item appears to vanish into the void with no error message and a console-only unhandled-rejection warning.

The same gap exists for folder creation: `ItemForm.handleCreateFolder` (no `try`/`catch` at all, called via `onClick={() => void handleCreateFolder()}` at line 511) and `Sidebar.handleCreateFolder` (same shape, called via `onClick={() => void handleCreateFolder()}` at line 214) — both swallow any `createVaultFolder` failure via the `void` operator with no user feedback.

**Fix:** Give `ItemForm`'s create-mode failures an `onError` callback identical to edit mode (or a local error banner), and wrap both `handleCreateFolder` implementations in `try { ... } catch (err) { /* surface a message */ }`.

---

### WR-04: Auto-lock timeout is read with no validation in `page.tsx`, unlike the same value read in `Sidebar.tsx`

**File:** `web/src/app/page.tsx:28-35` (`readAutolockMinutes`), `web/src/components/shell/Sidebar.tsx:74-77`
**Issue:** `Sidebar.tsx` only accepts a stored `pv-autolock-minutes` value if it's one of the whitelisted `AUTOLOCK_OPTIONS` (`[1, 5, 15, 30, 60]`, line 75). `page.tsx`'s own `readAutolockMinutes()` — which is what `useIdleTimer(autolockMinutes * 60_000, lockVault)` actually uses to arm the real auto-lock timer (line 96) — does `Number(stored)` with **no bounds/whitelist check at all** (lines 28-35). Since both read sites use the same `localStorage` key, any out-of-band write to `pv-autolock-minutes` (a corrupted value, a future UI bug, a browser extension, or manual tampering) silently produces an arbitrarily large (or `NaN`) auto-lock timeout in `page.tsx`, defeating the documented "Blokuj po bezczynności" security control, while `Sidebar.tsx`'s own dropdown would still *display* a safe default — the two reads visibly disagree.
**Fix:** Extract a single shared `readAutolockMinutes()` (whitelist-validated) and use it from both `page.tsx` and `Sidebar.tsx`, e.g. export it alongside `AUTOLOCK_OPTIONS` from `Sidebar.tsx` or a new `lib/idle` helper.

---

### WR-05: Clipboard auto-clear duration is read with no bounds validation

**File:** `web/src/lib/clipboard.ts:13-20` (`readClipboardSeconds`), `web/src/components/shell/Sidebar.tsx:78-81`
**Issue:** `readClipboardSeconds()` (used by `DetailPanel.handleCopy`, the code path that actually schedules the real clipboard-clear timer) does `Number(stored)` with no clamping to the documented 30-60s range. `Sidebar.tsx`'s `useEffect` that seeds the *displayed* slider value from the same `pv-clipboard-seconds` key (lines 78-81) also does not validate against `CLIPBOARD_SECONDS_OPTIONS` — unlike the autolock key, which at least gets a whitelist check in this same file. A tampered/corrupted value (e.g. an unbounded number) weakens the T-02-21 clipboard-clear security guarantee this feature exists to provide.
**Fix:** Clamp in `readClipboardSeconds()`: `Math.min(60, Math.max(30, Number(stored) || DEFAULT_CLIPBOARD_SECONDS))`, and mirror the same clamp when seeding `Sidebar`'s slider state.

---

### WR-06: `/api/vault/folders` has no payload size limit, unlike `/api/vault/items`

**File:** `crates/pv-server/src/routes/folders.rs:34-49` (`create`), compare `crates/pv-server/src/routes/vault.rs:43-48` + `59-60`
**Issue:** `vault.rs::create`/`update` explicitly cap `enc_key`/`enc_data` at `MAX_ITEM_BLOB_BYTES` (64 KiB) specifically because RESEARCH.md flagged unbounded item payloads as a storage-abuse gap (comment at `vault.rs:19-22`). `folders.rs::create` has no equivalent check on `req.enc_name` — a client (or anyone with a valid session token) can insert arbitrarily large folder rows repeatedly with no server-side limit, an inconsistency with the item endpoint's own documented threat model.
**Fix:** Reuse `validate_blob_len` (or an equivalent constant) for `enc_name` in `folders::create`.

---

### WR-07: `login()` has a timing side-channel the file's own comments say it's trying to avoid

**File:** `crates/pv-server/src/routes/auth.rs:142-164`
**Issue:** The doc-comment on `login()` (lines 139-141) explicitly claims parity with `prelogin()`'s email-enumeration mitigation ("Ten sam wariant ApiError::Unauthorized ... brak oracle po kształcie odpowiedzi" / T-02-04). The *shape* is indeed identical for both failure modes, but the *timing* is not: for an unknown email, the handler returns immediately after `row.ok_or(ApiError::Unauthorized)?` (line 151) — no base64 decode, no `server_rehash` (SHA-256), no `constant_time_eq`. For a known email with a wrong `auth_hash`, all of that extra work runs before the same `Unauthorized` is returned (lines 159-164). `prelogin()` deliberately keeps both of its branches doing comparable work (both always run the DB query; the dummy-salt branch does a real `Sha256::digest`) — `login()` doesn't apply the same discipline, leaving a (small, but real) timing oracle for email enumeration on the one endpoint whose doc-comment specifically calls out that threat.
**Fix:** Always perform a dummy `server_rehash` + `constant_time_eq` against a fixed decoy hash/salt on the unknown-email path before returning `Unauthorized`, matching `prelogin()`'s approach.

---

### WR-08: Hardcoded, non-localized copy in the password generator

**File:** `web/src/components/generator/GeneratorPopover.tsx:148, 156`
**Issue:** The generator mode toggle renders literal strings `"Znaki"` and `"Passphrase"` instead of going through `useLocale()`'s `t()`. Every other string in this phase is required to be dictionary-sourced (see `web/src/lib/i18n/dictionary.ts`'s own module comment: "Every string this phase introduces ... lives here"). A user with the `en` locale selected still sees the Polish word "Znaki" in the generator popover.
**Fix:** Add `generator.modeCharacter`/`generator.modePassphrase` keys to `DICTIONARY` and use `t(...)` in place of the literals.

---

### WR-09: `CorsLayer::permissive()` is unconditional, with no environment gating

**File:** `crates/pv-server/src/routes/mod.rs:27-31`
**Issue:** The comment above `.layer(CorsLayer::permissive())` explains this is intended only as a "dev-mode-only convenience" once Phase 7's single-container packaging serves API + static web from one origin. As written today, though, `permissive()` is applied unconditionally in every build, including any deployment topology where the API and web app end up on different origins before Phase 7 lands (a reverse-proxy misconfiguration, a separate dev/staging split, or a mobile/extension client). There's no `cfg!`/env-var gate enforcing the "no cross-origin surface" assumption the comment relies on.
**Fix:** Gate permissive CORS behind an explicit `PV_DEV_CORS`-style env var (or restrict `CorsLayer` to the configured origin) so a topology change doesn't silently reopen an unrestricted cross-origin surface.

---

### WR-10: `MIN_AUTH_HASH_LEN` accepts a shorter length than the value actually produced

**File:** `crates/pv-server/src/routes/auth.rs:17`
**Issue:** `MIN_AUTH_HASH_LEN = 16` allows a client-supplied `auth_hash` as short as 16 bytes, but every real code path (`INFO_AUTH_HASH` via `hkdf_expand_key`, `KEY_LEN = 32` in `crates/pv-core/src/keys.rs:14`) always produces exactly 32 bytes. The validation window is twice as permissive as necessary for what should be a fixed-length value, weakening the "reject malformed input early" guarantee register() otherwise tries to provide.
**Fix:** Either require the exact expected length (`client_auth_hash.len() != 32`) or document why a range is intentionally tolerated.

## Info

### IN-01: Ad-hoc `.replace("{token}", ...)` used instead of the shared `interpolate()` helper

**File:** `web/src/components/vault/ItemList.tsx:31`, `web/src/components/self-test/SelfTestCard.tsx:58, 89-92`
**Issue:** `dictionary.ts` provides `interpolate()` specifically to standardize `{token}` substitution (and to be safe under test doubles that stub `t()` as identity — see its own doc-comment). These three call sites bypass it with raw `String.prototype.replace`, which is functionally equivalent today but is an inconsistent pattern that will silently keep working incorrectly if the surrounding string logic changes (e.g., a value itself containing `{token}`-shaped text).
**Fix:** Use `interpolate(t("..."), { query: searchQuery })` / `{ error: state.error }` / `{ passed: String(passedCount) }` for consistency.

### IN-02: Stale `folderId` reference silently persists when its folder was deleted elsewhere

**File:** `web/src/components/vault/ItemForm.tsx:153-156, 469-487`
**Issue:** If an item's `folderId` points to a folder that has since been deleted (folders have no server-side cascade onto items by design), `ItemForm`'s `<select>` (bound to `fields.folderId`) has no matching `<option>` and no `pendingFolder` fallback for it. If the user saves the form without touching the folder dropdown, the item is silently re-persisted still referencing the deleted folder id.
**Fix:** When `initialFields.folderId` doesn't match any folder in `folders`/`pendingFolder`, clear it to `null` on mount, or add a synthetic "(deleted folder)" option so the state is visibly inconsistent rather than silently wrong.

### IN-03: `MAX_ITEM_BLOB_BYTES`-style checks are inconsistently a byte count vs. a UTF-16 code-unit count

**File:** `crates/pv-server/src/routes/vault.rs:43-48`
**Issue:** `validate_blob_len` checks `value.len() > MAX_ITEM_BLOB_BYTES` on a Rust `&str`, which is a byte count (UTF-8) — correct on the server side. Worth a short comment noting this is bytes, not characters, since the 64 KiB budget is easy to misread as "64k characters" when skimming the constant's name.
**Fix:** Non-blocking; a one-line comment clarifying "bytes, not chars" would prevent future confusion.

---

_Reviewed: 2026-07-13T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
