# Phase 5: Multi-Device Sync - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** 13
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/pv-server/migrations/0007_vault_revision.sql` | migration | CRUD (schema) | `crates/pv-server/migrations/0005_sessions_device_info.sql` (additive `ALTER TABLE ... ADD COLUMN`) | exact (shape) |
| `crates/pv-server/src/routes/sync.rs` (`pull` handler) | route/controller | request-response, cheap-check | `crates/pv-server/src/routes/vault.rs` (`list`, `update`) | exact |
| `crates/pv-server/src/routes/sync.rs` (`ws_handler`/`handle_socket`) | route/controller | streaming (WS push) | `crates/pv-server/src/routes/session.rs` (`SessionUser` extractor, token-hash lookup) | role-match (new data flow, reuse auth) |
| `crates/pv-server/src/routes/sync.rs` (`SyncHub`/`SyncEvent`) | service | event-driven, pub-sub | none exists yet — new pattern; modeled on `AppState`'s existing field shape | no analog (see below) |
| `crates/pv-server/src/routes/vault.rs` (modify: create/update/delete) | controller | CRUD | itself (extend existing `RETURNING` statements) | exact |
| `crates/pv-server/src/routes/folders.rs` (modify: create/delete) | controller | CRUD | itself + `vault.rs`'s revision-bump idiom | exact |
| `crates/pv-server/src/lib.rs` (modify: `AppState`) | config/state | — | itself (`AppState` struct, `webauthn` field precedent for a built-once-at-startup shared resource) | exact |
| `crates/pv-server/src/routes/mod.rs` (modify: router) | route table | request-response | itself (`.route(...)` chain) | exact |
| `crates/pv-server/Cargo.toml` (modify: axum `ws` feature, `tokio-tungstenite` dev-dep) | config | — | itself | exact |
| `crates/pv-server/tests/sync.rs` | test | integration | `crates/pv-server/tests/vault.rs` (pull-endpoint tests, oneshot harness) + new real-socket harness (no analog) | role-match / no analog (WS part) |
| `web/src/lib/vault/sync.ts` | service/provider | streaming + polling | `web/src/lib/crypto/index.ts` (module-singleton, lock-state listener pattern) | role-match |
| `web/src/lib/vault/syncStatus.ts` | store | event-driven (state) | `web/src/lib/crypto/index.ts` (`lockListeners` Set + `useSyncExternalStore`) | exact |
| `web/src/lib/vault/api.ts` (modify: add `getSyncSnapshot`) | api client | request-response | itself (`apiJson` helper, existing `listItems`/`listFolders`) | exact |
| `web/src/lib/vault/store.ts` (modify: `mergeSyncSnapshot`, wire `sync.ts`) | store | CRUD + event-driven merge | itself (`loadAndDecryptAll`, `subscribeLockState` module-level side effect) | exact |
| `web/src/components/shell/TopBar.tsx` (modify: sync status dot) | component | request-response (presentational) | itself (existing header layout) | exact |
| `web/src/components/vault/DetailPanel.tsx` (modify: live-edit-conflict banner) | component | event-driven (presentational) | itself (existing `conflict`/`revision-conflict-banner` state, same file) | exact |

## Pattern Assignments

### `crates/pv-server/src/routes/sync.rs` — `GET /api/sync` pull handler (controller, request-response)

**Analog:** `crates/pv-server/src/routes/vault.rs`

**Imports pattern** (vault.rs lines 7-17):
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
For sync.rs, swap `Path` for `Query` (deserialize `since: i64`) and reuse `vault::VaultItem` / `folders::FolderRecord` response types instead of redefining row shapes — call `pub(crate)` fetch helpers extracted from `vault::list`/`folders::list` (see Shared Patterns below) rather than duplicating the SELECTs.

**Cheap-check core pattern** (derived from vault.rs's `update` disambiguation shape, lines 161-190 — single query, `Row::try_get`):
```rust
let row = sqlx::query("SELECT vault_revision FROM users WHERE id = ?")
    .bind(&session.user_id)
    .fetch_one(&state.db)
    .await?;
let revision: i64 = row.try_get("vault_revision").map_err(|_| ApiError::Internal)?;

if q.since == revision {
    return Ok(Json(SyncResponse::UpToDate { revision }));
}
let items = vault::fetch_items_for(&state.db, &session.user_id).await?;
let folders = folders::fetch_folders_for(&state.db, &session.user_id).await?;
Ok(Json(SyncResponse::Snapshot { revision, items, folders }))
```

**Auth pattern** — identical to every existing handler: take `session: SessionUser` as a parameter (vault.rs line 58, folders.rs line 37); axum's extractor does the token-hash lookup, no manual header parsing needed in the handler body.

**Error handling pattern** (vault.rs lines 174-187, the `None`-disambiguation idiom) — reuse `ApiError::Internal`/`ApiError::NotFound`/`ApiError::Conflict` variants from `crates/pv-server/src/error.rs` (lines 8-18); no new error variants needed for the pull endpoint. `Query<SyncQuery>` extraction failures (malformed `since`) are handled automatically by axum's `Query` extractor → 400, no extra code required (RESEARCH.md V5 note).

---

### `crates/pv-server/src/routes/sync.rs` — `GET /api/sync/ws` handler (controller, streaming)

**Analog:** `crates/pv-server/src/routes/session.rs` (auth) + RESEARCH.md Pattern 3 (axum `ws` feature has no in-repo analog — first WS route in this codebase)

**Auth pattern to extract and reuse, not duplicate** (session.rs lines 20-32):
```rust
let token = extract_bearer_token(&parts.headers)?; // adapt: WS takes token from Query<WsAuthQuery>.token, not header
let token_hash = crypto::hash_token(token.as_bytes());
let row = sqlx::query("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')")
    .bind(token_hash.as_slice())
    .fetch_optional(&state.db)
    .await?;
let row = row.ok_or(ApiError::Unauthorized)?;
let user_id: String = row.try_get("user_id").map_err(|_| ApiError::Internal)?;
```
**Action:** factor this SELECT+hash lookup out of `SessionUser::from_request_parts` into a shared `pub(crate) async fn validate_token(pool: &SqlitePool, token: &str) -> Result<String, ApiError>` in `session.rs`, called by both `SessionUser` and the new WS handler (per RESEARCH.md Pattern 3's explicit "reused not duplicated" note) — do not re-implement the hash lookup a second time in `sync.rs`.

**Core streaming pattern:** no existing analog in this codebase (first `WebSocketUpgrade` usage). Follow RESEARCH.md Pattern 3 verbatim (`tokio::select!` over `rx.recv()` / `socket.recv()`, break on `Message::Close`/`None`/send-error). New dependency: add `features = ["ws"]` to the existing `axum = { version = "0.8", ... }` line in `crates/pv-server/Cargo.toml` (edit in place, don't duplicate the dependency entry).

---

### `crates/pv-server/src/routes/vault.rs` — extend `create`/`update`/`delete` with revision bump + publish (controller, CRUD)

**Analog:** itself — extend the existing `RETURNING`-based statements

**Exact pattern to copy from (update handler, lines 161-172):**
```rust
let result = sqlx::query(
    "UPDATE vault_items SET enc_key = ?, enc_data = ?, revision = revision + 1, updated_at = datetime('now') \
     WHERE id = ? AND user_id = ? AND revision = ? \
     RETURNING updated_at",
)
.bind(&req.enc_key)
.bind(&req.enc_data)
.bind(&id)
.bind(&session.user_id)
.bind(req.expected_revision)
.fetch_optional(&state.db)
.await?;
```
**Action:** after this statement succeeds, add the separate atomic global-counter bump (RESEARCH.md Pattern 2, Pitfall 1 — must be a single `UPDATE ... SET x = x + 1 ... RETURNING`, never SELECT-then-UPDATE):
```rust
let new_global_rev: i64 = sqlx::query_scalar(
    "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
)
.bind(&session.user_id)
.fetch_one(&state.db)
.await?;
state.sync_hub.publish(&session.user_id, SyncEvent { entity_type: EntityType::Item, id: id.clone(), revision: req.expected_revision + 1, change_type: ChangeType::Update });
```
Same shape applies to `create` (lines 73-83, `INSERT ... RETURNING`) and `delete` (lines 200-208, `execute` + `rows_affected()` check) — bump + publish after the existing statement, only on the success path (skip on `ApiError::Conflict`/`NotFound`).

**Blob-size validation pattern already in place, reuse unchanged** (lines 48-53): `validate_blob_len` — no changes needed for sync.

---

### `crates/pv-server/src/routes/folders.rs` — extend `create`/`delete` with revision bump + publish (controller, CRUD)

**Analog:** itself, mirroring the vault.rs extension above

**Exact pattern to copy from (create, lines 47-52; delete, lines 90-94):**
```rust
sqlx::query("INSERT INTO folders (id, user_id, enc_name) VALUES (?, ?, ?)")
    .bind(&id).bind(&session.user_id).bind(&req.enc_name)
    .execute(&state.db).await?;
// -> then: same atomic UPDATE users SET vault_revision = vault_revision + 1 ... RETURNING + sync_hub.publish(EntityType::Folder, ...)
```
Note per CONTEXT.md: folders have no per-row `revision` column, so `SyncEvent.revision` for folder events should carry the new global `vault_revision`, not a nonexistent per-folder revision.

---

### `crates/pv-server/src/lib.rs` — `AppState` gains `sync_hub` field (config/state)

**Analog:** itself — `webauthn` field precedent (lines 20-23) for a shared resource built once and cloned cheaply

**Exact pattern to copy from (lines 13-24):**
```rust
#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub session_ttl_hours: u64,
    pub webauthn: webauthn_rs::prelude::Webauthn,
}
```
**Action:** add `pub sync_hub: SyncHub` where `SyncHub` is a `#[derive(Clone)] struct SyncHub(Arc<Mutex<HashMap<String, broadcast::Sender<SyncEvent>>>>)` defined in `routes/sync.rs` (mirrors the project's existing "shared resource on AppState, cloned per-request via axum's `State` extractor" idiom — no new state-management library needed, matches `webauthn`'s own `Clone`-internally shape).

---

### `crates/pv-server/src/routes/mod.rs` — router gains two routes (route table)

**Analog:** itself (lines 17-38)

**Exact pattern to copy from:**
```rust
.route("/api/vault/items", get(vault::list).post(vault::create))
.route("/api/vault/items/{id}", put(vault::update).delete(vault::delete))
```
**Action:** add `pub mod sync;` to the `pub mod` block (line 1-7) and:
```rust
.route("/api/sync", get(sync::pull))
.route("/api/sync/ws", get(sync::ws_handler))
```
placed after the `/api/vault/*` routes, before `.with_state(state)`.

---

### `crates/pv-server/migrations/0007_vault_revision.sql` (migration)

**Analog:** `crates/pv-server/migrations/0005_sessions_device_info.sql` (additive `ALTER TABLE ... ADD COLUMN` shape — not the DROP+CREATE shape of `0003`/`0004`)

Read `0005_sessions_device_info.sql` for the exact additive-column idiom this project uses before writing `0007`; content per RESEARCH.md's resolved Open Question 4: `ALTER TABLE users ADD COLUMN vault_revision INTEGER NOT NULL DEFAULT 0`.

---

### `web/src/lib/vault/sync.ts` (service/provider, streaming + polling)

**Analog:** `web/src/lib/crypto/index.ts` (module-singleton + listener-Set pattern, lines 82-126)

**Pattern to copy** (crypto/index.ts lines 82-114, listener registration/notify shape):
```typescript
const lockListeners = new Set<() => void>();
// ... lockListeners.forEach((listener) => listener());
export function isUnlocked(): boolean { ... }
export function subscribeLockState(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => { lockListeners.delete(listener); };
}
```
Full WS-client/reconnect/backoff/poll-timer body: no existing analog (first WS/polling client in this codebase) — implement per RESEARCH.md Pattern 4 verbatim (`connectWs`, `startSync`, `stopSync`, exponential backoff 1s→30s cap).

**Wiring point** — `web/src/lib/vault/store.ts` lines 291-301 (`subscribeLockState` module-level side effect):
```typescript
subscribeLockState(() => {
  if (isUnlocked()) {
    void loadAndDecryptAll();
  } else {
    items = [];
    folders = [];
    recomputeAllTags();
    notifyListeners();
    notifyFolderListeners();
  }
});
```
**Action:** extend this exact callback to also call `startSync(handleSyncEvent)` in the `isUnlocked()` branch and `stopSync()` in the else branch — same lifecycle gate Phase 2 already established for `loadAndDecryptAll`, no new lifecycle hook needed.

---

### `web/src/lib/vault/syncStatus.ts` (store, event-driven state)

**Analog:** `web/src/lib/crypto/index.ts` lines 82-126 (`lockListeners` Set + `useSyncExternalStore` at line 126) — copy this shape exactly for a `"connected" | "reconnecting" | "offline"` status singleton, including the `EMPTY_SNAPSHOT`-style stable-reference guard used in `store.ts` lines 273-274 if the hook needs one.

---

### `web/src/lib/vault/api.ts` — add `getSyncSnapshot(since)` (api client, request-response)

**Analog:** itself — `listItems`/`listFolders` (lines 47-49, 82-84) and the shared `apiJson` helper (lines 22-45)

**Exact pattern to copy from:**
```typescript
export function listItems(): Promise<ItemRow[]> {
  return apiJson("/api/vault/items");
}
```
**Action:**
```typescript
export interface SyncSnapshot {
  revision: number;
  items?: ItemRow[];
  folders?: FolderRow[];
}
export function getSyncSnapshot(since: number): Promise<SyncSnapshot> {
  return apiJson(`/api/sync?since=${since}`);
}
```
`apiJson`'s existing error-unwrapping (lines 22-45) and `ApiClientError` (imported from `@/lib/auth/api`, line 5) need no changes. The WS client itself (`sync.ts`) cannot reuse `apiFetch` for the connection (browser `WebSocket` has no header injection) but should reuse `getSessionToken()` from `@/lib/auth/api` for the `?token=` query param, per RESEARCH.md Pattern 4.

---

### `web/src/lib/vault/store.ts` — add `mergeSyncSnapshot()` (store, CRUD + event-driven merge)

**Analog:** itself — `loadAndDecryptAll` (lines 163-177) and `decryptItemRow`/`decryptFolderRow` (lines 145-161)

**Pattern to copy from (lines 163-177):**
```typescript
async function loadAndDecryptAll(): Promise<void> {
  const [itemRows, folderRows] = await Promise.all([listItems(), listFolders()]);
  const uk = getUnlockedUserKey();
  if (uk === null) { return; }
  items = itemRows.map((row) => decryptItemRow(row, uk));
  recomputeAllTags();
  notifyListeners();
  folders = folderRows.map((row) => decryptFolderRow(row, uk));
  notifyFolderListeners();
}
```
**Action:** `mergeSyncSnapshot(snapshot)` follows the identical decrypt-and-set shape when `snapshot.items`/`snapshot.folders` are present (stale case); when absent (cheap-check up-to-date case), it's a no-op. Deletion-by-ID-diff (CONTEXT.md's locked decision, no tombstones): compute `items.filter(i => snapshot-ids.has(i.id))` before reassigning — same `notifyListeners()`/`recomputeAllTags()` calls already used at lines 173-174. Reuse `RevisionConflictError` (lines 49-54) and `isConflictError` (lines 24-31) unchanged — the live-edit-conflict banner compares `SyncEvent.id === currentlyEditingItemId` against the merged item's revision, not a new error type.

---

### `web/src/components/shell/TopBar.tsx` — sync status dot (component, presentational)

**Analog:** itself (lines 6-44) — existing header layout, `t()` i18n calls, `data-testid` convention

**Pattern to copy from (existing button, lines 33-41):**
```tsx
<button
  type="button"
  data-testid="new-item-button"
  className="btn btn-primary btn-sm"
  onClick={onNewItem}
  disabled={!onNewItem}
>
  {t("topbar.newItem")}
</button>
```
**Action:** add a small dot/pulse element near the existing `<div className="flex-1" />` spacer (line 31), driven by `useSyncStatus()` from the new `syncStatus.ts` (mirrors `useVaultItems()`/`useFolders()`'s `useSyncExternalStore` shape from `store.ts` lines 276-282). Use `data-testid="sync-status-dot"` and i18n via `t("sync.connected")`/`t("sync.reconnecting")`/`t("sync.offline")` tooltip strings, PL+EN, per CONTEXT.md.

---

### `web/src/components/vault/DetailPanel.tsx` — live-edit-conflict banner (component, event-driven)

**Analog:** itself — the existing `conflict` state and `revision-conflict-banner` already implement 90% of this pattern

**Exact pattern already present (lines 51, 76-80, 195-218):**
```tsx
const [conflict, setConflict] = useState(false);
// ...
useEffect(() => {
  setMode(initialMode);
  setConflict(false);
}, [item.id, initialMode]);
// ...
{conflict ? (
  <div data-testid="revision-conflict-banner" className="alert alert-error text-sm">
    {t("error.revisionConflict")}
  </div>
) : null}
<ItemForm
  ...
  onError={(err) => {
    if (err instanceof RevisionConflictError) {
      setConflict(true);
    }
  }}
/>
```
**Action:** add a second, distinct banner (do not conflate with the save-time `conflict` state above — RESEARCH.md Pitfall 5 requires gating strictly on `entity_type === "item" && id === item.id`) driven by a new effect that subscribes to sync events (via `sync.ts`'s event callback or a small store subscription) and compares the incoming event's `id`/`revision` against `item.id`/`item.revision`, showing `t("sync.itemChangedElsewhere")` with a manual refresh action — reuses the exact `alert alert-error text-sm` styling and `data-testid` convention (e.g. `data-testid="live-edit-conflict-banner"`), matching the existing banner's tone (T-02-22) but proactive instead of save-triggered. Also wire the "remote-delete-while-viewing" case (CONTEXT.md) using the same `onClose` prop already passed in (line 46) plus a toast via `showCopyToast`-adjacent toast helper already imported (line 10, `@/lib/vault/copyToast`) — check for an `ErrorToast`/generic toast helper alongside it before adding a new one.

---

## Shared Patterns

### Session/token auth (server)
**Source:** `crates/pv-server/src/routes/session.rs` lines 17-33 (`SessionUser::from_request_parts`)
**Apply to:** `sync.rs`'s `pull` handler (via the `SessionUser` extractor, unchanged) and `ws_handler` (via a newly-factored-out `validate_token` helper — see Pattern above). Do not duplicate the hash-lookup SQL a third time.

### Single-statement optimistic-concurrency / atomic counter bump
**Source:** `crates/pv-server/src/routes/vault.rs` lines 161-172 (`UPDATE ... RETURNING`)
**Apply to:** every new `vault_revision` bump in `vault.rs`'s `create`/`update`/`delete` and `folders.rs`'s `create`/`delete` — always `UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision`, never SELECT-then-UPDATE (RESEARCH.md Pitfall 1).

### Row-fetch de-duplication
**Source:** `crates/pv-server/src/routes/vault.rs` lines 108-130 (`list`) and `folders.rs` lines 64-81 (`list`)
**Apply to:** Extract the `SELECT ... WHERE user_id = ?` + row-mapping body of both `list` handlers into `pub(crate) async fn fetch_items_for(pool, user_id) -> Result<Vec<VaultItem>, ApiError>` / `fetch_folders_for(...)`, called by both the existing `list` handlers and the new `sync::pull` handler — prevents the two response shapes from drifting (RESEARCH.md Anti-Pattern, Open Question 1 resolution).

### Error taxonomy (server)
**Source:** `crates/pv-server/src/error.rs` (`ApiError` enum, `IntoResponse` impl)
**Apply to:** All new sync.rs handlers — no new `ApiError` variants required; `Unauthorized` covers WS auth failure, `Internal` covers DB errors via the existing `From<sqlx::Error>` impl (lines 33-37).

### Module-singleton + listener-Set (client)
**Source:** `web/src/lib/crypto/index.ts` lines 82-126 (lock-state singleton)
**Apply to:** `web/src/lib/vault/syncStatus.ts` (connection-state singleton) and the overall shape of `sync.ts`'s exported `startSync`/`stopSync` — same "module-level mutable state + Set<listener> + useSyncExternalStore" idiom as the rest of `web/src/lib/*`, not React Context/Redux.

### i18n dictionary
**Source:** `web/src/lib/i18n/` (existing `t()`/`interpolate` usage throughout `TopBar.tsx`, `DetailPanel.tsx`)
**Apply to:** every new user-facing string (sync status tooltip, live-edit-conflict banner text, remote-delete toast) — add PL+EN keys to the existing dictionary module, no new i18n mechanism.

## No Analog Found

| File/Concern | Role | Data Flow | Reason |
|---|---|---|---|
| `sync_hub`/`SyncHub`/`SyncEvent` types and pub-sub logic | service | event-driven, pub-sub | First in-process broadcast-channel usage in this codebase — no existing analog; follow RESEARCH.md Pattern 2/3 verbatim (`tokio::sync::broadcast`, lazy per-user channel creation/pruning per RESEARCH.md's resolved Open Question 2) |
| `ws_handler`/`handle_socket` WS upgrade + frame loop | controller | streaming | First `WebSocketUpgrade` usage — follow RESEARCH.md Pattern 3 verbatim (axum `ws` feature, `tokio::select!` loop) |
| WS-specific integration test harness (`tests/common/mod.rs` extension: real `TcpListener` + `axum::serve` + `tokio_tungstenite::connect_async`) | test infra | integration | Existing `test_app()`/`oneshot()` harness cannot exercise an HTTP Upgrade handshake at all (RESEARCH.md Pitfall 2) — new harness function required, no analog to extend |
| `web/src/lib/vault/sync.ts`'s reconnect/backoff/poll-timer body | service | streaming + polling | First WS/polling client in this codebase — only the outer module-singleton shell pattern has an analog (crypto/index.ts); the connection logic itself follows RESEARCH.md Pattern 4 |

## Metadata

**Analog search scope:** `crates/pv-server/src/routes/`, `crates/pv-server/src/`, `crates/pv-server/migrations/`, `web/src/lib/vault/`, `web/src/lib/crypto/`, `web/src/lib/auth/`, `web/src/components/shell/`, `web/src/components/vault/`
**Files scanned:** 13 (all fully read — largest is 304 lines, well under the 2,000-line large-file threshold)
**Pattern extraction date:** 2026-07-14
