# Phase 3: Passkey Enrollment & Account Security - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 20
**Analogs found:** 18 / 20

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `crates/pv-server/migrations/0004_passkeys_rebuild.sql` | migration | batch | `crates/pv-server/migrations/0003_vault_items_rebuild.sql` | exact |
| `crates/pv-server/migrations/0005_sessions_device_info.sql` | migration | batch | `crates/pv-server/migrations/0002_auth_hash.sql` (ALTER-style additive migration) | role-match |
| `crates/pv-server/migrations/0006_webauthn_states.sql` | migration | batch | `crates/pv-server/migrations/0001_init.sql` (`sessions` table shape) | role-match |
| `crates/pv-server/src/routes/passkeys.rs` | route/controller | request-response (CRUD + ceremony) | `crates/pv-server/src/routes/vault.rs` (CRUD shape) + `crates/pv-server/src/routes/auth.rs` (ceremony/session-issuing shape) | exact (composite) |
| `crates/pv-server/src/routes/sessions.rs` | route/controller | CRUD (list/revoke) | `crates/pv-server/src/routes/vault.rs` (list/delete-by-owner pattern) | exact |
| `crates/pv-server/src/routes/webauthn_state.rs` | utility/service | request-response (persist/load/expire) | `crates/pv-server/src/routes/session.rs` (`SessionUser` extractor + token hashing) | role-match |
| `crates/pv-server/src/routes/mod.rs` (modified) | route | request-response | itself (existing router) | exact |
| `crates/pv-server/src/config.rs` (modified — `PV_RP_ID`/`PV_ORIGIN`) | config | — | itself (`Config::from_env`) | exact |
| `crates/pv-server/src/main.rs` (modified — build `Webauthn`, fail-loud) | service/bootstrap | — | itself (`AppState` construction) | exact |
| `crates/pv-server/tests/passkeys.rs` | test | request-response | `crates/pv-server/tests/` existing vault/auth integration tests (axum `ServiceExt`) | role-match |
| `crates/pv-server/tests/sessions.rs` | test | request-response | same as above | role-match |
| `crates/pv-wasm/src/lib.rs` (modified — `WasmWrappingKey::fromPrf`) | utility (WASM export) | transform | itself — `WasmWrappingKey::from_password` | exact |
| `web/src/components/settings/SettingsPanel.tsx` | component (drawer shell) | request-response (renders tabs) | `web/src/app/page.tsx` z-40 drawer+scrim block / `web/src/components/vault/DetailPanel.tsx` | exact |
| `web/src/components/settings/PasskeysTab.tsx` | component | CRUD (list/rename/delete) | `web/src/components/shell/Sidebar.tsx` (list+dropdown rows) + `web/src/components/vault/ItemList.tsx`/`ItemRow.tsx` (row rendering) | role-match |
| `web/src/components/settings/SessionsTab.tsx` | component | CRUD (list/revoke) | same row-list pattern as PasskeysTab | role-match |
| `web/src/components/settings/SecurityTab.tsx` | component | event-driven (settings mutation) | `web/src/components/shell/Sidebar.tsx` autolock/clipboard controls (lines ~90-161, 409-445) | exact |
| `web/src/components/settings/EnrollPasskeyDialog.tsx` | component (ceremony state machine) | event-driven | `web/src/components/vault/DeleteConfirmDialog.tsx` (modal shell) — state machine itself has no analog | partial |
| `web/src/components/settings/PasskeyDeleteConfirmDialog.tsx` | component | request-response | `web/src/components/vault/DeleteConfirmDialog.tsx` | exact |
| `web/src/lib/passkeys/api.ts` | service (API client) | request-response | `web/src/lib/vault/api.ts` | exact |
| `web/src/lib/passkeys/enroll.ts` | service (orchestration, no React state) | event-driven | `web/src/lib/vault/store.ts` (mutation-orchestration functions) — ceremony sequencing itself has no analog | partial |
| `web/src/lib/sessions/api.ts` | service (API client) | CRUD | `web/src/lib/vault/api.ts` | exact |

## Pattern Assignments

### `crates/pv-server/src/routes/passkeys.rs` (controller, request-response)

**Analogs:** `crates/pv-server/src/routes/vault.rs` (CRUD/ownership shape), `crates/pv-server/src/routes/auth.rs` (ceremony + session-token issuing shape)

**Imports pattern** (`vault.rs` lines 7-17):
```rust
use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use uuid::Uuid;

use super::session::SessionUser;
use crate::{error::ApiError, AppState};
```

**Auth/ownership pattern** — every handler takes `session: SessionUser` and filters every query by `WHERE ... AND user_id = ?` (never trust a path-param id alone) — `vault.rs` lines 108-114 (list), 199-208 (delete):
```rust
pub async fn delete(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM vault_items WHERE id = ? AND user_id = ?")
        .bind(&id)
        .bind(&session.user_id)
        .execute(&state.db)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::NotFound);
    }
    Ok(StatusCode::NO_CONTENT)
}
```

**Atomic insert-with-conflict pattern** (`vault.rs` lines 73-88, reuse for `passkeys` credential-id uniqueness):
```rust
let result = sqlx::query(
    "INSERT INTO vault_items (id, user_id, enc_key, enc_data, revision) VALUES (?, ?, ?, ?, 1) \
     ON CONFLICT(id) DO NOTHING \
     RETURNING updated_at",
)
// .fetch_optional -> None means conflict -> ApiError::Conflict
```

**Session/token-issuing + timing-safe pattern** (`auth.rs` lines 157-213, adapt for the ceremony's second-step token/challenge round trip and for reusing `crypto::hash_token`/base64-wire-form convention):
```rust
let token = pv_core::keys::random_bytes(32);
let token_b64 = STANDARD.encode(&token);
let token_hash = crypto::hash_token(token_b64.as_bytes()); // hash the wire (base64) form, not raw bytes
```

**Recovery-invariant defense-in-depth 409 pattern** (`auth.rs`-style guard, RESEARCH.md Architecture Pattern 3 — copy near-verbatim):
```rust
pub async fn delete_passkey(
    State(state): State<AppState>,
    session: SessionUser,
    Path(id): Path<String>,
) -> Result<StatusCode, ApiError> {
    let row = sqlx::query("SELECT pw_wrapped_uk FROM users WHERE id = ?")
        .bind(&session.user_id)
        .fetch_optional(&state.db)
        .await?
        .ok_or(ApiError::Internal)?;
    let pw_wrapped_uk: String = row.try_get("pw_wrapped_uk").map_err(|_| ApiError::Internal)?;
    if pw_wrapped_uk.is_empty() {
        return Err(ApiError::Conflict("would strand vault: no password recovery wrap".into()));
    }
    let result = sqlx::query("DELETE FROM passkeys WHERE id = ? AND user_id = ?")
        .bind(&id).bind(&session.user_id).execute(&state.db).await?;
    if result.rows_affected() == 0 { return Err(ApiError::NotFound); }
    Ok(StatusCode::NO_CONTENT)
}
```

**Input validation pattern** (`auth.rs` lines 102-112 — decode/length-check before use, `ApiError::BadRequest` on malformed input):
```rust
let salt = STANDARD.decode(&req.salt).map_err(|_| ApiError::BadRequest("invalid salt encoding".into()))?;
if salt.len() < MIN_SALT_LEN { return Err(ApiError::BadRequest("salt too short".into())); }
```

**Error handling:** all handlers return `Result<_, ApiError>`, propagate via `?`, `sqlx::Error` auto-converts via `impl From<sqlx::Error> for ApiError` (`error.rs` lines 34-39) — no manual match needed for DB errors.

---

### `crates/pv-server/src/routes/sessions.rs` (controller, CRUD)

**Analog:** `crates/pv-server/src/routes/vault.rs` `list`/`delete` (lines 108-130, 195-211) — identical ownership-scoped list + delete-by-id shape. Additionally reuse `session.rs`'s `extract_bearer_token` + `crypto::hash_token` (lines 40-44, 216-231 in `auth.rs::logout`) to compute the current request's own `token_hash` for the `current: true` marker:
```rust
pub async fn logout(..., headers: HeaderMap) -> Result<StatusCode, ApiError> {
    let token = extract_bearer_token(&headers)?;
    let token_hash = crypto::hash_token(token.as_bytes());
    sqlx::query("DELETE FROM sessions WHERE token_hash = ?")
        .bind(token_hash.as_slice()).execute(&state.db).await?;
    Ok(StatusCode::NO_CONTENT)
}
```
For `GET /api/sessions`, compare each row's `token_hash` BLOB against the just-computed `token_hash` of the current request to set `current: true` per row — same hashing call, no new primitive needed.

---

### `crates/pv-server/src/routes/webauthn_state.rs` (utility)

**Analog:** `crates/pv-server/src/routes/session.rs` — the extractor pattern of hash-then-lookup with an `expires_at > datetime('now')` guard (lines 20-27) is the direct template for `persist_webauthn_state`/`load_webauthn_state`:
```rust
let row = sqlx::query("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')")
    .bind(token_hash.as_slice())
    .fetch_optional(&state.db)
    .await?;
```
Apply the same `expires_at` short-TTL + delete-on-consume (single-use) pattern for `webauthn_states` rows.

---

### `crates/pv-server/migrations/0004_passkeys_rebuild.sql` (migration)

**Analog:** `crates/pv-server/migrations/0003_vault_items_rebuild.sql` (full file, lines 1-25) — DROP+CREATE precedent (safe because nothing writes to `webauthn_credentials` yet, per RESEARCH Pitfall 1):
```sql
DROP TABLE vault_items;
CREATE TABLE vault_items (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ...
);
CREATE INDEX idx_vault_items_user ON vault_items(user_id, revision);
```
Apply identically: `DROP TABLE webauthn_credentials; CREATE TABLE passkeys (id, user_id, credential_id BLOB UNIQUE, passkey_json TEXT NOT NULL, name, prf_capable INTEGER DEFAULT 0, prf_salt, prf_wrapped_uk, created_at, last_used_at); CREATE INDEX idx_passkeys_user ON passkeys(user_id);` — reference original shape in `0001_init.sql` lines 14-27 for column names to replace, not reuse.

### `crates/pv-server/migrations/0005_sessions_device_info.sql` (migration, additive)

**Analog:** `crates/pv-server/migrations/0002_auth_hash.sql` — read this file directly for the additive `ALTER TABLE ... ADD COLUMN` convention (one-concern-per-migration, matches `sessions` table base shape in `0001_init.sql` lines 51-58):
```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash BLOB NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL
);
```
Add `user_agent TEXT`, `last_used_at TEXT` via `ALTER TABLE sessions ADD COLUMN ...` (SQLite supports additive `ADD COLUMN`, unlike the `DROP COLUMN` limitation that forced 0003's rebuild).

---

### `crates/pv-wasm/src/lib.rs` — add `WasmWrappingKey::fromPrf` (utility, transform)

**Analog:** `WasmWrappingKey::from_password` (lines 60-85) — mirror exactly, per RESEARCH.md's own Code Examples section:
```rust
#[wasm_bindgen(js_name = fromPrf)]
pub fn from_prf(prf_output: &mut [u8]) -> Result<WasmWrappingKey, JsValue> {
    let result = pv_core::prf::wrapping_key_from_prf(prf_output).map_err(to_js_err);
    prf_output.zeroize();
    let wk = result?;
    Ok(WasmWrappingKey(*wk))
}
```
Backing primitive already exists and is tested: `crates/pv-core/src/prf.rs` lines 20-28 (`wrapping_key_from_prf`), `PRF_OUTPUT_LEN = 32` (line 17). No new pv-core code needed — pure passthrough wiring.

---

### `web/src/components/settings/SettingsPanel.tsx` (drawer shell)

**Analog:** the Phase 2 z-40 drawer+scrim block, read directly from `web/src/app/page.tsx` (lines ~160-195) — a `fixed inset-0 z-30` scrim (click-outside close) plus a `fixed inset-y-0 right-0 z-40` aside panel:
```tsx
<div data-testid="side-panel-scrim" className="fixed inset-0 z-30 bg-base-300/40" onClick={onClose} />
<aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col gap-4 overflow-y-auto border-l border-base-300 bg-base-100 p-6 shadow-xl md:w-[400px]">
  {/* tab content */}
</aside>
```
Also structurally mirror `DetailPanel.tsx`'s prop shape (`onClose: () => void`) and its `useLocale()`/`t()` usage (lines 39-48).

---

### `web/src/components/settings/PasskeysTab.tsx` / `SessionsTab.tsx` (list + row actions)

**Analog:** `web/src/components/shell/Sidebar.tsx`'s dropdown-menu row rendering (lines 405-479) for inline action rows, and its `useEffect` localStorage-hydration pattern (lines 104-119) for loading initial data. For the list-fetch-then-render shape, follow `web/src/lib/vault/store.ts`'s pattern of a module-level fetch feeding React state (read that file directly for the exact subscribe/refresh convention used elsewhere in this codebase).

**Relative time formatting** — reuse directly, no new logic: `web/src/lib/format/relativeTime.ts` `formatRelativeTime(updatedAt, t, locale)` (full file, lines 1-59) — apply to `last_used_at`/`created_at` exactly as `ItemList`/`ItemRow` already do for `updated_at`.

---

### `web/src/components/settings/SecurityTab.tsx` (migrated autolock/clipboard controls)

**Analog:** `web/src/components/shell/Sidebar.tsx` lines 90 (state), 137-161 (`handleAutolockChange`/`handleClipboardSecondsChange`), 409-445 (rendered `<select>`/`<input type="range">` controls) — move this logic verbatim into the new tab component, then delete it from `Sidebar.tsx`:
```tsx
function handleAutolockChange(e: React.ChangeEvent<HTMLSelectElement>) {
  const next = e.target.value;
  setAutolockMinutes(next);
  try { localStorage.setItem(AUTOLOCK_MINUTES_KEY, next); } catch { /* private mode */ }
  window.dispatchEvent(new Event(AUTOLOCK_CHANGED_EVENT));
}
```
Import constants from `@/lib/idle/autolock` and `@/lib/clipboard` exactly as `Sidebar.tsx` does (lines 28-39).

---

### `web/src/components/settings/PasskeyDeleteConfirmDialog.tsx` (modal)

**Analog:** `web/src/components/vault/DeleteConfirmDialog.tsx` (full file, 78 lines) — copy the entire shell (native-`<dialog>`-styled `fixed inset-0 z-50` overlay, `AlertTriangle` icon, `btn-ghost`/`btn-error` button pair, `deleting` loading-state guard) and swap `deleteVaultItem` for the new `deletePasskey` API call. Must additionally handle the 409 recovery-invariant response (RESEARCH.md's `delete_passkey_blocked_without_password_wrap`) — add an inline alert state on `ApiClientError` with `status === 409`, distinct from the generic error path, since CONTEXT.md requires this be surfaced, not silently closed.

---

### `web/src/lib/passkeys/api.ts` / `web/src/lib/sessions/api.ts` (API clients)

**Analog:** `web/src/lib/vault/api.ts` (full file, 96 lines) — copy the `apiJson<T>` wrapper (lines 22-45) verbatim (handles non-2xx → `ApiClientError`, 204 → `undefined`, JSON body otherwise) and the thin per-endpoint function shape:
```ts
import { apiFetch, ApiClientError } from "@/lib/auth/api";

export interface PasskeyRow {
  id: string; name: string; created_at: string; last_used_at: string | null; prf_capable: boolean;
}

export function listPasskeys(): Promise<PasskeyRow[]> {
  return apiJson("/api/passkeys");
}
export function deletePasskey(id: string): Promise<void> {
  return apiJson(`/api/passkeys/${id}`, { method: "DELETE" });
}
```
Reuse `apiFetch`/`ApiClientError` from `@/lib/auth/api` — do not duplicate base-URL/auth-header logic (module comment in `vault/api.ts` line 1-4 explicitly calls this out).

---

### `web/src/components/settings/EnrollPasskeyDialog.tsx` + `web/src/lib/passkeys/enroll.ts` (ceremony state machine)

**No direct analog** — this is genuinely new (two-ceremony WebAuthn + PRF flow, no prior WebAuthn UI exists in the codebase). Use RESEARCH.md's `Code Examples` section verbatim as the starting point (already-drafted `enrollPasskey()` orchestration function and the 7-state dialog machine referenced from `03-UI-SPEC.md`). Structurally follow `DeleteConfirmDialog.tsx`'s modal shell (fixed-overlay, `useState`, `useLocale()`) for the dialog chrome, and `web/src/lib/vault/store.ts`'s "orchestration function, no React state" convention for `enroll.ts` (mutation functions live in `lib/`, not inside components).

---

## Shared Patterns

### Ownership-scoped queries (IDOR prevention)
**Source:** `crates/pv-server/src/routes/vault.rs` (every handler)
**Apply to:** All new `passkeys.rs`/`sessions.rs` handlers — every `SELECT`/`UPDATE`/`DELETE` must bind `AND user_id = ?` against `session.user_id`, never a client-supplied user id.

### Error handling / ApiError taxonomy
**Source:** `crates/pv-server/src/error.rs` (full file)
**Apply to:** All new route handlers — return `Result<_, ApiError>`, use existing variants (`BadRequest`, `Unauthorized`, `NotFound`, `Conflict`, `Internal`); `sqlx::Error` auto-converts via `?`.

### Bearer-session extraction
**Source:** `crates/pv-server/src/routes/session.rs` (full file, `SessionUser` + `extract_bearer_token`)
**Apply to:** Every new authenticated handler takes `session: SessionUser`; handlers needing the raw token (sessions revoke-current-detection) additionally take `headers: HeaderMap` and call `extract_bearer_token(&headers)`, same as `auth.rs::logout`.

### Opaque-blob-over-the-wire, zero-knowledge boundary
**Source:** `crates/pv-server/src/routes/vault.rs` (`enc_key`/`enc_data` fields, never parsed server-side) and `crates/pv-core/src/prf.rs` module doc (lines 1-8)
**Apply to:** `prf_wrapped_uk` JSON on `passkeys` table/API — server stores and returns it verbatim, never inspects/validates its cryptographic contents.

### i18n dictionary convention
**Source:** `web/src/lib/i18n/dictionary.ts` (flat `"section.key": { pl, en }` map, `interpolate()` helper for `{n}`-style placeholders)
**Apply to:** Every new Settings/passkeys/sessions string — add under new `"settings.*"`/`"passkeys.*"`/`"sessions.*"` keys, PL/EN verbatim per `03-UI-SPEC.md`'s locked copy, no paraphrasing.

### API client wrapper (`apiJson`)
**Source:** `web/src/lib/vault/api.ts` lines 22-45
**Apply to:** `lib/passkeys/api.ts`, `lib/sessions/api.ts` — reuse `apiFetch`/`ApiClientError` from `lib/auth/api.ts`, do not hand-roll fetch/error handling again.

### Drawer + scrim UI shell
**Source:** `web/src/app/page.tsx` z-40/z-30 block (lines ~160-195)
**Apply to:** `SettingsPanel.tsx` — same z-index layering, same click-outside-to-close scrim pattern, same `md:w-[400px]` sizing convention as the existing DetailPanel drawer.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `web/src/components/settings/EnrollPasskeyDialog.tsx` | component | event-driven (ceremony state machine) | No prior WebAuthn/multi-step ceremony UI exists in the codebase; use RESEARCH.md's Code Examples + `03-UI-SPEC.md`'s locked 7-state machine as the primary reference instead of an in-repo analog. |
| `web/src/lib/passkeys/enroll.ts` | service (orchestration) | event-driven | Same reason — genuinely new client-side WebAuthn/PRF/WASM orchestration; RESEARCH.md's `enrollPasskey()` sketch (Code Examples section) is the closest available reference. |

## Metadata

**Analog search scope:** `crates/pv-server/src/routes/`, `crates/pv-server/migrations/`, `crates/pv-core/src/`, `crates/pv-wasm/src/`, `web/src/components/{vault,shell,settings}/`, `web/src/lib/{vault,auth,format,i18n,idle}/`
**Files scanned:** ~30 (routes, migrations, error.rs, session.rs, pv-wasm lib.rs, prf.rs, web components/lib directories)
**Pattern extraction date:** 2026-07-14
