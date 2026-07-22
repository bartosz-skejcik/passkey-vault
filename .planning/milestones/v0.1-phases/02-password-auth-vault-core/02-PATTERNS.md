# Phase 2: Password Auth & Vault Core - Pattern Map

**Mapped:** 2026-07-12
**Files analyzed:** 22
**Analogs found:** 20 / 22

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/pv-core/src/items.rs` (MODIFIED) | service (crypto) | transform | itself (existing `encrypt_item`/`decrypt_item`) | exact |
| `crates/pv-core/src/keys.rs` (MODIFIED — `INFO_AUTH_HASH`) | service (crypto) | transform | itself (`INFO_PW_UNLOCK`/`INFO_PRF_UNLOCK` constants) | exact |
| `crates/pv-core/src/kdf.rs` (MODIFIED — `auth_hash_from_password`) | service (crypto) | transform | itself (`wrapping_key_from_password`) | exact |
| `crates/pv-wasm/src/lib.rs` (MODIFIED — new exports) | service (WASM bridge) | transform | itself (existing opaque-handle exports) | exact |
| `crates/pv-server/src/routes/auth.rs` (MODIFIED — real prelogin, register, login) | route/controller | request-response | itself (`prelogin` stub) | exact |
| `crates/pv-server/src/routes/session.rs` (NEW — `SessionUser` extractor) | middleware | request-response | `crates/pv-server/src/routes/auth.rs` (State/Json extractor style) + axum FromRequestParts idiom | role-match |
| `crates/pv-server/src/routes/vault.rs` (NEW — items CRUD) | controller | CRUD | `crates/pv-server/src/routes/auth.rs` | role-match |
| `crates/pv-server/src/routes/folders.rs` (NEW, if split out) | controller | CRUD | `crates/pv-server/src/routes/auth.rs` | role-match |
| `crates/pv-server/src/error.rs` (NEW — `ApiError`) | utility (error type) | transform | `crates/pv-core/src/error.rs` (`CryptoError`, thiserror pattern) | exact |
| `crates/pv-server/src/routes/mod.rs` (MODIFIED — register new routes) | route (aggregator) | request-response | itself | exact |
| `crates/pv-server/migrations/0002_phase2.sql` (NEW) | migration | batch | `crates/pv-server/migrations/0001_init.sql` | exact |
| `web/src/lib/crypto/index.ts` (MODIFIED — new exported functions, self-test call-site fix) | service (facade) | transform | itself | exact |
| `web/src/lib/i18n/dictionary.ts`, `useTranslation.ts` (NEW) | provider/hook | transform | `web/src/app/layout.tsx` (`themeInitScript` pre-hydration pattern) + `web/src/components/shell/Sidebar.tsx` (localStorage read/write + client state sync) | role-match |
| `web/src/app/layout.tsx` (MODIFIED — add `localeInitScript`) | config/provider | transform | itself (`themeInitScript`) | exact |
| `web/src/lib/generator/password.ts`, `wordlist.ts`, `strength.ts` (NEW) | utility | transform | `crates/pv-core/src/keys.rs::random_bytes` (rejection-sampling-adjacent CSPRNG usage) — no direct web analog | no analog (see below) |
| `web/src/lib/vault/store.ts`, `search.ts` (NEW) | store | CRUD/transform | `web/src/lib/crypto/index.ts` (singleton module-state pattern, `ready` promise memoization) | role-match |
| `web/src/lib/clipboard.ts` (NEW) | utility | event-driven | `web/src/lib/crypto/index.ts` (try/finally cleanup discipline) | partial-match |
| `web/src/components/auth/LoginForm.tsx`, `RegisterForm.tsx`, `UnlockOverlay.tsx` (NEW) | component | request-response | `web/src/components/shell/Sidebar.tsx` (`"use client"`, useState/useEffect, localStorage try/catch) | role-match |
| `web/src/components/vault/ItemList.tsx`, `ItemRow.tsx`, `DetailPanel.tsx`, `DeleteConfirmDialog.tsx` (NEW) | component | request-response | `web/src/components/shell/MainColumn.tsx` / `Sidebar.tsx` | role-match |
| `web/src/components/generator/GeneratorPopover.tsx` (NEW) | component | event-driven | `web/src/components/shell/Sidebar.tsx` (client component with local UI state) | role-match |
| `web/src/app/page.tsx` (MODIFIED — route by auth state) | route (page) | request-response | itself | exact |
| `crates/pv-server/tests/` (NEW — integration harness) | test | request-response | `crates/pv-core/src/items.rs::mod tests` (inline test conventions, roundtrip + failure-case pairing) | role-match |

## Pattern Assignments

### `crates/pv-core/src/items.rs` (service, transform)

**Analog:** itself — current file at `crates/pv-core/src/items.rs`

**Current signatures to extend** (lines 15-16, 38-56):
```rust
const AAD_ITEM_KEY: &[u8] = b"pv:item-key:v1";
const AAD_ITEM_DATA: &[u8] = b"pv:item-data:v1";

pub fn encrypt_item(uk: &UserKey, plaintext: &[u8]) -> Result<EncryptedItem, CryptoError> {
    let item_key = ItemKey::generate();
    let enc_key = aead_seal(uk.expose(), &item_key.0, AAD_ITEM_KEY)?;
    let enc_data = aead_seal(&item_key.0, plaintext, AAD_ITEM_DATA)?;
    Ok(EncryptedItem { enc_key, enc_data })
}

pub fn decrypt_item(uk: &UserKey, item: &EncryptedItem) -> Result<Vec<u8>, CryptoError> {
    let mut key_bytes = aead_open(uk.expose(), &item.enc_key, AAD_ITEM_KEY)?;
    if key_bytes.len() != KEY_LEN {
        key_bytes.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&key_bytes);
    key_bytes.zeroize();
    let item_key = ItemKey(k);
    aead_open(&item_key.0, &item.enc_data, AAD_ITEM_DATA)
}
```

**Apply RESEARCH.md Pattern 1** (`build_item_aad(prefix, item_id, revision)` helper; `AAD_ITEM_DATA_PREFIX = b"pv:item:v1"`) — see 02-RESEARCH.md lines 234-273 for the exact recommended replacement body. Keep the same function names/visibility, only widen the signature with `item_id: &str, revision: u32`.

**Error handling pattern** (unchanged, lines 47-50): the `key_bytes.len() != KEY_LEN` zeroize-then-`CryptoError::Decrypt` idiom is the project's standard "reject malformed decrypt output" shape — reuse verbatim for any new decrypt path.

**Test pattern** (lines 58-76, `mod tests`): always pair a `_roundtrip` success test with an `other_user_key_cannot_decrypt`/adversarial-input failure test. For VAULT-02's AD-mutation test, add a third test in this same `mod tests` block that flips one byte of the AAD-relevant identity (e.g. calls `decrypt_item` with the wrong `item_id` or `revision`) and asserts `Err(CryptoError::Decrypt)`, mirroring `other_user_key_cannot_decrypt`'s shape exactly.

---

### `crates/pv-core/src/keys.rs` (MODIFIED — add `INFO_AUTH_HASH`)

**Analog:** itself, lines 17-19:
```rust
/// Domain separation dla HKDF — wersjonowane, nigdy nie zmieniać wstecznie.
pub const INFO_PW_UNLOCK: &[u8] = b"pv:pw-unlock:v1";
pub const INFO_PRF_UNLOCK: &[u8] = b"pv:prf-unlock:v1";
```
Add `pub const INFO_AUTH_HASH: &[u8] = b"pv:auth-hash:v1";` directly beneath, same doc-comment umbrella, same naming convention (`INFO_<PURPOSE>`, versioned byte string).

---

### `crates/pv-core/src/kdf.rs` (MODIFIED — add `auth_hash_from_password`)

**Analog:** itself, lines 49-57 (`wrapping_key_from_password`):
```rust
pub fn wrapping_key_from_password(
    password: &[u8],
    salt: &[u8],
    params: &KdfParams,
) -> Result<Zeroizing<[u8; MASTER_KEY_LEN]>, CryptoError> {
    let mk = derive_master_key(password, salt, params)?;
    Ok(Zeroizing::new(keys::hkdf_expand_key(mk.as_ref(), keys::INFO_PW_UNLOCK)))
}
```
New `auth_hash_from_password` mirrors this exactly, swapping `INFO_PW_UNLOCK` → `INFO_AUTH_HASH` (see RESEARCH.md Code Examples section, lines 453-468). RESEARCH.md flags: the real call site (pv-wasm) should call `derive_master_key` once and HKDF-expand twice — don't duplicate the Argon2id pass. Keep `wrapping_key_from_password` itself unchanged/still callable standalone for other call sites (e.g. future PRF).

---

### `crates/pv-wasm/src/lib.rs` (MODIFIED — new exports + signature changes)

**Analog:** itself — established opaque-handle pattern.

**Imports pattern** (lines 12-22): extend the `use pv_core::{...}` block the same way — add `kdf::auth_hash_from_password` alongside `wrapping_key_from_password`; no new crates.

**Handle-construction pattern** (lines 63-84, `WasmWrappingKey::from_password`):
```rust
#[wasm_bindgen(js_name = fromPassword)]
pub fn from_password(
    password: &mut [u8],
    salt: &[u8],
    kdf_params_json: &str,
) -> Result<WasmWrappingKey, JsValue> {
    let params: KdfParams = serde_json::from_str(kdf_params_json)
        .map_err(|e| to_js_str_err(&e.to_string()))?;
    let result = wrapping_key_from_password(password, salt, &params).map_err(to_js_err);
    password.zeroize(); // wipe regardless of outcome
    let wk = result?;
    Ok(WasmWrappingKey(*wk))
}
```
New export for combined "derive master key once, produce both wrapping-key handle and auth-hash bytes" must follow the same shape: take `password: &mut [u8]`, always `password.zeroize()` before returning (even on the error path — note the `let result = ...; password.zeroize(); let wk = result?;` ordering, not zeroize-after-`?`).

**Plain-transform export pattern** (lines 116-120, `encrypt_item`/`decrypt_item`):
```rust
#[wasm_bindgen(js_name = encryptItem)]
pub fn encrypt_item(uk: &WasmUserKey, plaintext: &str) -> Result<String, JsValue> {
    let item = core_encrypt_item(&uk.0, plaintext.as_bytes()).map_err(to_js_err)?;
    serde_json::to_string(&item).map_err(|e| to_js_str_err(&e.to_string()))
}
```
Add `item_id: &str, revision: u32` params here, threading straight through to `core_encrypt_item`/`core_decrypt_item` — no new logic, just widened signature (breaking change, budget updating this in the SAME task as the `pv-core` change, per RESEARCH.md Pitfall 1).

**Test pattern** (lines 142-181, `mod tests`): `full_roundtrip` and `wrong_password_fails_to_unwrap` — extend `full_roundtrip` to pass fixture `item_id`/`revision` args to the widened `encrypt_item`/`decrypt_item` calls; keep using plain `cargo test` (native target), not wasm32, per existing `#[cfg(target_arch = "wasm32")]` split at top of file.

---

### `crates/pv-server/src/routes/auth.rs` (MODIFIED — real prelogin, register, login)

**Analog:** itself — current stub.

**Imports pattern** (lines 1-5):
```rust
use axum::{extract::State, Json};
use pv_core::kdf::KdfParams;
use serde::{Deserialize, Serialize};

use crate::AppState;
```
New handlers (`register`, `login`) follow the identical import shape — add `sqlx::query!`/`query_as!` as needed, `crate::error::ApiError` once that new module exists.

**Request/response struct + handler pattern** (lines 7-27):
```rust
#[derive(Deserialize)]
pub struct PreloginRequest {
    pub email: String,
}

#[derive(Serialize)]
pub struct PreloginResponse {
    pub kdf: KdfParams,
    pub salt: String,
}

pub async fn prelogin(
    State(_state): State<AppState>,
    Json(_req): Json<PreloginRequest>,
) -> Json<PreloginResponse> {
    Json(PreloginResponse { kdf: KdfParams::default(), salt: String::new() })
}
```
`register`/`login` should return `Result<Json<T>, ApiError>` (new error type — see below) instead of a bare `Json<T>`, since they now have real failure modes (duplicate email, wrong auth hash, DB errors) that `prelogin`'s current stub doesn't. Follow the same `#[derive(Deserialize)]`/`#[derive(Serialize)]` request/response struct pairing placed directly above each handler.

---

### `crates/pv-server/src/routes/session.rs` (NEW — `SessionUser` extractor)

**No direct analog in this codebase** — first `FromRequestParts` impl in the project. Follow RESEARCH.md Pattern 2 verbatim (lines 284-311 of 02-RESEARCH.md) for the extractor shape; follow `crates/pv-server/src/routes/auth.rs`'s import/module conventions (bare `use axum::{...}`, `use crate::AppState`) for everything else. Token hashing helper (`sha2_hash`) should live in this same file, styled like `crates/pv-core/src/keys.rs`'s small free functions (short, single-purpose, no trailing period in doc comment per project convention — see `random_bytes` doc comment lines 49-52 of keys.rs).

---

### `crates/pv-server/src/error.rs` (NEW — `ApiError`)

**Analog:** `crates/pv-core/src/error.rs` (full file, 13 lines):
```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("key derivation failed")]
    Kdf,
    #[error("decryption failed (wrong key or corrupted data)")]
    Decrypt,
    #[error("encryption failed")]
    Encrypt,
    #[error("invalid input: {0}")]
    InvalidInput(&'static str),
}
```
`ApiError` follows the exact same `thiserror::Error` derive shape (variant per failure mode, `#[error("...")]` message). New requirement not present in `CryptoError`: implement `axum::response::IntoResponse for ApiError` mapping variants to status codes (400/401/404/409/500) — this is new surface with no in-repo analog; use the variant list as: `BadRequest`, `Unauthorized`, `NotFound`, `Conflict`, `Internal`. Keep DB error conversion via `.map_err()`/`?` per CLAUDE.md's Error Handling conventions (not `anyhow` — `ApiError` should be the typed boundary error for routes, matching how `CryptoError` is the typed boundary error for pv-core).

---

### `crates/pv-server/migrations/0002_phase2.sql` (NEW)

**Analog:** `crates/pv-server/migrations/0001_init.sql` (full file read, 58 lines).

Key excerpts to mirror:
```sql
CREATE TABLE vault_items (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id  TEXT REFERENCES folders(id) ON DELETE SET NULL,
    type       TEXT NOT NULL CHECK (type IN ('login','passkey','card','note','totp')),
    enc_key    TEXT NOT NULL,
    enc_data   TEXT NOT NULL,
    revision   INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT
);
CREATE INDEX idx_vault_items_user ON vault_items(user_id, revision);
```
Per RESEARCH.md Common Pitfalls/Anti-Patterns: cannot `ALTER TABLE ... DROP COLUMN type` (CHECK constraint). Since no production data exists, use `DROP TABLE vault_items;` + `CREATE TABLE vault_items (...)` with `type`/`folder_id` removed. Preserve the file's header-comment convention (line 1-3 of 0001, Polish, explains what's stored) and the `idx_<table>_<col>` index-naming convention (`idx_vault_items_user`, `idx_sessions_user`, `idx_folders_user`, `idx_webauthn_credentials_user`). Add `users.auth_hash BLOB NOT NULL` and `users.auth_hash_salt BLOB NOT NULL` columns via `ALTER TABLE users ADD COLUMN ...` (safe — no CHECK/FK on these).

---

### `web/src/lib/crypto/index.ts` (MODIFIED — new exports, self-test fix)

**Analog:** itself — the existing choke-point facade (full file, 155 lines).

**Import-block extension pattern** (lines 10-19):
```typescript
import init, {
  WasmWrappingKey,
  WasmUserKey,
  wrapUserKey,
  unwrapUserKey,
  encryptItem,
  decryptItem,
  defaultKdfParamsJson,
  randomSalt,
} from "./wasm/pv_wasm.js";
```
Add new pv-wasm exports (auth-hash derivation, widened encrypt/decrypt signatures) to this same import list — this file remains the ONLY importer of `./wasm/pv_wasm.js` in `web/src` (grep-audited invariant per the file's own header comment, lines 1-5).

**Self-test call sites needing signature update** (lines 121, 135):
```typescript
encryptedItemJson = encryptItem(unwrappedKey, SELF_TEST_PLAINTEXT);
...
const plaintext = decryptItem(unwrappedKey, encryptedItemJson);
```
Must become `encryptItem(unwrappedKey, SELF_TEST_PLAINTEXT, "self-test-item", 1)` / matching `decryptItem` call — per RESEARCH.md Pitfall 1, do this in the SAME task as the pv-wasm signature change.

**Singleton/memoization pattern** (lines 25-37, `initCrypto`): reuse this `ready: Promise<void> | null` module-level memoization shape for any new module-singleton state (e.g. a vault-store singleton) — same null-on-error-then-retry discipline.

**Cleanup/finally pattern** (lines 145-155): every function that creates opaque WASM handles must `.free()` them in a `finally` block, tolerant of `undefined` via `?.free?.()`. This is the pattern new vault-crypto functions (item encrypt/decrypt with AD, folder encrypt/decrypt) must follow.

---

### `web/src/app/layout.tsx` (MODIFIED — add `localeInitScript`)

**Analog:** itself — `themeInitScript` (lines 27-38):
```typescript
const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('pv-theme');
    var valid = stored === 'vault-light' || stored === 'vault-dark';
    var theme = valid ? stored : (window.matchMedia('(prefers-color-scheme: light)').matches ? 'vault-light' : 'vault-dark');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'vault-dark');
  }
})();
`;
```
And its wiring (lines 46-49):
```tsx
<html lang="pl">
  <head>
    <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
  </head>
```
`localeInitScript` follows the exact same IIFE-in-`<script dangerouslySetInnerHTML>` shape (see RESEARCH.md Pattern 4, lines 344-357 for the literal recommended script body) — add a second `<script>` tag alongside the existing one, and change `<html lang="pl">` to plain `<html>` (script now sets `lang` dynamically, mirroring how `data-theme` has no hardcoded default either).

---

### `web/src/components/shell/Sidebar.tsx` (analog for auth/vault/generator components)

**Analog:** itself (full file read, first 60 lines shown).

**Client component + localStorage read/write pattern** (lines 1-36):
```tsx
"use client";
import { useEffect, useState } from "react";
...
const [theme, setTheme] = useState<"vault-dark" | "vault-light">("vault-dark");

useEffect(() => {
  const current = document.documentElement.getAttribute("data-theme");
  if (current === "vault-light" || current === "vault-dark") {
    setTheme(current);
  }
}, []);

function toggleTheme() {
  const next = theme === "vault-light" ? "vault-dark" : "vault-light";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("pv-theme", next);
  } catch {
    // localStorage may be unavailable (private mode)
  }
  setTheme(next);
}
```
Reuse for: `useTranslation` hook's locale-switch function, auto-lock settings persistence, clipboard auto-clear duration setting — same "read once in `useEffect`, write via `try { localStorage... } catch {}`, always update React state regardless" shape. `NAV_ITEMS`-style local const arrays (lines 6-10) is the pattern for e.g. item-type icon/label maps in `ItemRow.tsx`.

**Icon usage:** `lucide-react` icons imported by name (line 4) — reuse for vault item-type icons (`Vault`/`CreditCard`/`IdCard`/`StickyNote` per RESEARCH.md Pitfall 4) and dialog icons.

---

## Shared Patterns

### Zeroize discipline (crypto boundary)
**Source:** `crates/pv-core/src/keys.rs` lines 23-24 (`#[derive(Zeroize, ZeroizeOnDrop)]` on `UserKey`), `crates/pv-wasm/src/lib.rs` lines 80-83 (`password.zeroize()` before returning `Result`)
**Apply to:** Every new key/password/auth-hash-bearing struct or buffer in `pv-core`, `pv-wasm`. Never use bare `String`/`Vec<u8>` for secret material — matches CLAUDE.md's explicit "Secret handling" architectural constraint.

### thiserror + map_err + `?` error propagation
**Source:** `crates/pv-core/src/error.rs` (full file); `crates/pv-server/src/main.rs` lines 22-26 (`anyhow::Context` for operational errors)
**Apply to:** New `crates/pv-server/src/error.rs::ApiError` (thiserror, like `CryptoError`) for route-level typed errors; keep `anyhow::Result` only for `main.rs`-level startup/operational code (DB connect, migrations) — don't mix the two styles.

### Domain-separated HKDF constants
**Source:** `crates/pv-core/src/keys.rs` lines 17-19
```rust
pub const INFO_PW_UNLOCK: &[u8] = b"pv:pw-unlock:v1";
pub const INFO_PRF_UNLOCK: &[u8] = b"pv:prf-unlock:v1";
```
**Apply to:** New `INFO_AUTH_HASH = b"pv:auth-hash:v1"`; new item-AD prefixes `b"pv:item:v1"`/`b"pv:item-key:v1"` (already partially named, per RESEARCH.md Pattern 1) — always versioned (`:v1` suffix), always a module-level `pub const`.

### Opaque WASM handle boundary
**Source:** `crates/pv-wasm/src/lib.rs` lines 1-10 (module doc comment) and the `WasmWrappingKey`/`WasmUserKey` structs
**Apply to:** Any new key material crossing into JS (none expected this phase beyond what's listed above) — raw key bytes never cross the WASM boundary as `Vec<u8>`/`&[u8]`, only opaque handles, ciphertext strings, or explicitly-non-secret values (salts).

### Single WASM-choke-point import discipline
**Source:** `web/src/lib/crypto/index.ts` lines 1-9 (header comment) — grep-audited invariant
**Apply to:** All new web crypto call sites (auth forms, vault store, unlock overlay) must call through `web/src/lib/crypto/index.ts`'s exported functions — never import `./wasm/pv_wasm.js` directly from a component or another lib module.

### Axum route module registration
**Source:** `crates/pv-server/src/routes/mod.rs` (full file, 16 lines)
```rust
mod auth;
use axum::{routing::get, routing::post, Json, Router};
use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/healthz", get(healthz))
        .route("/api/auth/prelogin", post(auth::prelogin))
        .with_state(state)
}
```
**Apply to:** Add `mod session; mod vault;` and new `.route("/api/auth/register", post(auth::register))`, `.route("/api/auth/login", post(auth::login))`, `.route("/api/vault/items", get(vault::list).post(vault::create))`, `.route("/api/vault/items/:id", put(vault::update).delete(vault::delete))` in the same builder chain, same flat structure (no nested sub-routers currently used in this codebase — don't introduce one without cause).

### `"use client"` + local state + try/catch localStorage
**Source:** `web/src/components/shell/Sidebar.tsx` lines 1-36 (see excerpt above)
**Apply to:** All new interactive components (`LoginForm`, `UnlockOverlay`, `GeneratorPopover`, idle-timer hook, i18n hook) — same defensive `try { localStorage... } catch {}` wrapping every localStorage write, since Phase 1 already established private-mode tolerance as a requirement.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `web/src/lib/generator/password.ts`, `wordlist.ts` | utility | transform | No prior client-side CSPRNG/rejection-sampling code in the web app (only server-side/pv-core `random_bytes` exists, which is Rust). Planner should follow RESEARCH.md Pattern 5 (`crypto.getRandomValues()` + explicit rejection sampling, reject-and-reroll on `value >= (2^32 - (2^32 % N))`) verbatim — no in-repo TS analog exists yet. |
| `crates/pv-server/tests/` (integration harness itself, as a new directory) | test | request-response | No `tests/` integration directory exists in `pv-server` yet (only inline `#[cfg(test)] mod tests` in pv-core/pv-wasm). Follow RESEARCH.md Pitfall 2's `tower::ServiceExt::oneshot()` + shared-cache-or-tempfile SQLite pool guidance; use `crates/pv-core/src/items.rs::mod tests` only for assertion-style conventions (roundtrip + failure-case pairing), not for harness structure. |

## Metadata

**Analog search scope:** `crates/pv-core/src/`, `crates/pv-wasm/src/`, `crates/pv-server/src/`, `crates/pv-server/migrations/`, `web/src/lib/crypto/`, `web/src/app/`, `web/src/components/shell/`
**Files scanned:** `items.rs`, `kdf.rs`, `keys.rs`, `error.rs` (pv-core); `lib.rs` (pv-wasm); `main.rs`, `config.rs`, `routes/mod.rs`, `routes/auth.rs`, `migrations/0001_init.sql` (pv-server); `lib/crypto/index.ts`, `app/layout.tsx`, `app/page.tsx`, `components/shell/Sidebar.tsx` (web)
**Pattern extraction date:** 2026-07-12
