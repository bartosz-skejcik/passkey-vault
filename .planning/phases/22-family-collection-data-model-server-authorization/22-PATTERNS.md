# Phase 22: Family & Collection Data Model — Server Authorization - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 12 (7 new, 5 modified/reused-verbatim)
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/pv-server/src/routes/membership.rs` | middleware (axum extractor) | request-response, auth-gate | `crates/pv-server/src/routes/session.rs` | exact — explicit "sibling" per CONTEXT.md |
| `crates/pv-server/src/routes/families.rs` | controller | CRUD | `crates/pv-server/src/routes/folders.rs` (simple CRUD) + `vault.rs` (revision/tx discipline) | role-match |
| `crates/pv-server/src/routes/collections.rs` | controller | CRUD, fan-out write | `crates/pv-server/src/routes/vault.rs` | role-match |
| `crates/pv-server/src/routes/identity.rs` | controller | CRUD (idempotent upsert) | `crates/pv-server/src/routes/vault.rs::create` (`ON CONFLICT ... RETURNING`) | role-match |
| `crates/pv-server/migrations/0014_family_sharing.sql` | migration | batch/DDL | `crates/pv-server/migrations/0013_passkey_counter_anomaly.sql` (header/comment style) + `0001_init.sql` (composite table shape) | exact (naming), role-match (content) |
| `crates/pv-server/src/routes/mod.rs` | route registration | request-response | itself (extend `router_with_cors`) | exact — modify in place |
| `crates/pv-server/src/error.rs` | error type | — | itself (extend `ApiError`) | exact — modify in place |
| `crates/pv-server/src/routes/vault.rs` | controller | CRUD, revision-conflict | itself (extend `update`, add `move_item`) | exact — modify in place |
| `crates/pv-server/tests/membership_route_sweep.rs` | test | request-response sweep | `crates/pv-server/src/routes/mod.rs` `#[cfg(test)] mod tests` (CORS layer tests) — no direct integration-test analog exists yet; nearest is any `tests/*.rs` using `test_app` | no strong analog — new pattern |
| `crates/pv-server/tests/family.rs`, `collections.rs`, `identity_keypair.rs` | test | integration (CRUD + auth) | `crates/pv-server/tests/common/mod.rs` harness (`test_pool`, `test_app`, `register_and_login`) | exact (harness), no analog for multi-user setup (new helper needed) |

## Pattern Assignments

### `crates/pv-server/src/routes/membership.rs` (middleware, request-response)

**Analog:** `crates/pv-server/src/routes/session.rs` (capture near-full — this is the template)

**Full file for reference** (`crates/pv-server/src/routes/session.rs:1-55`):
```rust
//! `SessionUser` — axum `FromRequestParts` ekstraktor walidujący opaque
//! bearer token przeciw `sessions.token_hash`. Jedyna granica między
//! anonimowym a uwierzytelnionym żądaniem (patrz threat_model T-02-07).

use axum::{
    extract::FromRequestParts,
    http::{header, request::Parts, HeaderMap},
};
use sqlx::Row;

use crate::{crypto, error::ApiError, AppState};

pub struct SessionUser {
    pub user_id: String,
}

impl FromRequestParts<AppState> for SessionUser {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let token = extract_bearer_token(&parts.headers)?;
        let user_id = validate_token(&state.db, &token).await?;
        Ok(SessionUser { user_id })
    }
}

/// Hash-then-lookup-with-expiry logic shared by `SessionUser`'s REST auth
/// path and `sync::ws_handler`'s `?token=` query-param auth path (05-02-PLAN
/// Task 1) — exactly one place session-token validation lives, so the WS
/// upgrade handshake can never drift from the REST `Authorization` header
/// path's semantics (expiry, hash algorithm, rejection code).
pub(crate) async fn validate_token(db: &sqlx::SqlitePool, token: &str) -> Result<String, ApiError> {
    let token_hash = crypto::hash_token(token.as_bytes());

    let row = sqlx::query("SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')")
        .bind(token_hash.as_slice())
        .fetch_optional(db)
        .await?;

    let row = row.ok_or(ApiError::Unauthorized)?;
    let user_id: String = row.try_get("user_id").map_err(|_| ApiError::Internal)?;
    Ok(user_id)
}

/// Wyciąga surowy token z nagłówka `Authorization: Bearer <token>`. Wydzielone
/// jako helper przyjmujący `&HeaderMap` (nie `&Parts`), żeby `logout` — który
/// potrzebuje samego tokenu do skasowania wiersza sesji, nie tylko `user_id`,
/// a więc bierze `SessionUser` I osobno `HeaderMap` w tym samym handlerze —
/// nie musiał duplikować parsowania nagłówka.
pub fn extract_bearer_token(headers: &HeaderMap) -> Result<String, ApiError> {
    let auth = headers.get(header::AUTHORIZATION).ok_or(ApiError::Unauthorized)?;
    let token = auth.to_str().ok().and_then(|s| s.strip_prefix("Bearer ")).ok_or(ApiError::Unauthorized)?;
    Ok(token.to_string())
}
```

**What to copy structurally:**
- Module doc comment style: one-sentence purpose + "the only boundary" framing + `patrz threat_model T-XX-XX`-style citation. `membership.rs`'s doc comment should cite SEC-06/SHARE-05 and CVE-2026-43639/Vaultwarden #6269 the same way.
- `pub struct SessionUser { pub user_id: String }` → mirror as `pub struct Membership<R, M = RequireRead> { pub resource_id: String, pub caller_user_id: String, pub access: AccessLevel, _kind: PhantomData<(R, M)> }`.
- `impl FromRequestParts<AppState> for SessionUser` shape → `Rejection = ApiError`, `async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection>`.
- **"Exactly one place this logic lives" discipline**: `validate_token` is `pub(crate)`, called from both the REST extractor and `sync::ws_handler`'s query-param path — this is the direct precedent for `R::resolve_access` being the single query-and-decide implementation shared by every route.
- `sqlx::Row` + `.try_get(...).map_err(|_| ApiError::Internal)` is this codebase's row-decoding idiom — reuse verbatim in `resolve_access` implementations.

**Extractor-composition detail (new to this file, from RESEARCH.md Pattern 1 — copy the design directly):** call `SessionUser::from_request_parts` and `Path::<String>::from_request_parts` inline inside `Membership`'s own `from_request_parts`, exactly as RESEARCH.md's Code Example shows — this composition pattern has no existing in-repo precedent besides `session.rs` itself being the thing composed into it, so treat RESEARCH.md's `Pattern 1` code block (lines 219-312 of 22-RESEARCH.md) as authoritative sample code, not just a suggestion.

---

### `crates/pv-server/src/routes/families.rs`, `collections.rs` (controller, CRUD)

**Analog:** `crates/pv-server/src/routes/vault.rs` (revision-conflict + tx discipline) and `crates/pv-server/src/routes/folders.rs` (simpler CRUD shape, no revision column)

**Imports pattern** (`vault.rs:7-18`, `folders.rs:10-22` — identical shape):
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
use super::sync::{ChangeType, EntityType, SyncEvent};
use crate::{error::ApiError, AppState};
```
For `families.rs`/`collections.rs`, add `use super::membership::{Membership, Collection, Family, RequireEdit, RequireRead};` alongside `SessionUser` — `families::create`/`list` use `SessionUser` only (no resource exists yet to gate); `collections.rs` handlers on an existing resource use `Membership<Collection, _>` instead of/alongside `SessionUser`.

**Module doc-comment pattern** (`vault.rs:1-5`, capture verbatim as the model for the new files' own top comment, including the explicit "never by an id from the request body" clause CONTEXT.md quotes):
```rust
//! `/api/vault/items` — CRUD na zaszyfrowanych blobach z optymistyczną
//! współbieżnością (revision). Serwer widzi wyłącznie `{id, enc_key, blob,
//! revision}` — typ przedmiotu i folder_id żyją wewnątrz ciphertextu (patrz
//! 02-CONTEXT.md Vault Data Model). Każdy handler bierze `SessionUser` i
//! skopuje zapytania po `session_user.user_id` — nigdy po id z ciała żądania.
```

**ON CONFLICT / idempotent-write idiom** (`vault.rs:80-96`, this is the pattern for `families::create`'s single-family guard and `collections.rs`'s add-member/fan-out writes):
```rust
let mut tx = state.db.begin().await?;

let result = sqlx::query(
    "INSERT INTO vault_items (id, user_id, enc_key, enc_data, revision) VALUES (?, ?, ?, ?, 1) \
     ON CONFLICT(id) DO NOTHING \
     RETURNING updated_at",
)
.bind(&req.id)
.bind(&session.user_id)
.bind(&req.enc_key)
.bind(&req.enc_data)
.fetch_optional(&mut *tx)
.await?;

let row = match result {
    Some(row) => row,
    None => return Err(ApiError::Conflict("item id already exists".into())),
};
```
RESEARCH.md's own Code Example section gives the direct `collection_keys`/`user_keypairs` variants of this idiom — use those literally (`.planning/phases/.../22-RESEARCH.md` lines ~429-490, "Idempotent, concurrency-safe membership-write pattern" and "KEY-01 idempotent-upsert-with-self-healing pattern").

**Revision-conflict disambiguation pattern** (`vault.rs:242-268` — the "SELECT-to-disambiguate" idiom; not directly needed for `families.rs` but is the shape `collections.rs`'s revoke-share / access-level-change endpoints should follow if they need to distinguish "doesn't exist" from "exists but caller lacks access", though for membership-gated routes this distinction is now handled upstream by the extractor itself):
```rust
let result = sqlx::query(
    "UPDATE vault_items SET enc_key = ?, enc_data = ?, revision = revision + 1, updated_at = datetime('now') \
     WHERE id = ? AND user_id = ? AND revision = ? \
     RETURNING updated_at",
)
...
let row = match result {
    Some(row) => row,
    None => {
        let exists = sqlx::query("SELECT 1 FROM vault_items WHERE id = ? AND user_id = ?")
            .bind(&id).bind(&session.user_id).fetch_optional(&mut *tx).await?;
        return match exists {
            Some(_) => Err(ApiError::Conflict("stale revision".into())),
            None => Err(ApiError::NotFound),
        };
    }
};
```

**Shared row-fetch-for-list pattern** (`vault.rs:141-161` / `folders.rs:97-111` — one SQL source of truth reused by `list()` and any future sync snapshot arm; `families.rs`'s member-list and `collections.rs`'s list should follow this exact `pub(crate) async fn fetch_X_for(...)` shape):
```rust
pub(crate) async fn fetch_items_for(pool: &sqlx::SqlitePool, user_id: &str) -> Result<Vec<VaultItem>, ApiError> {
    let rows = sqlx::query("SELECT id, enc_key, enc_data, revision, updated_at, last_used_at FROM vault_items WHERE user_id = ?")
        .bind(user_id)
        .fetch_all(pool)
        .await?;

    rows.into_iter()
        .map(|row| Ok(VaultItem {
            id: row.try_get("id").map_err(|_| ApiError::Internal)?,
            ...
        }))
        .collect::<Result<Vec<_>, ApiError>>()
}
```

**Cross-user 404 discipline** (`folders.rs:119-138`, `vault.rs::delete`): every mutating query is scoped `WHERE id = ? AND user_id = ?`; zero rows affected → `ApiError::NotFound`, never distinguishing "doesn't exist" from "not yours". This is exactly the "no access → 404" rule CONTEXT.md locks for the new membership-gated routes — the *mechanism* (scope in the WHERE clause, check `rows_affected()`/`fetch_optional`) is the direct precedent, just replacing `user_id = ?` with the `Membership` extractor's pre-check.

**Blob-size validation reuse** (`folders.rs:41-44`, importing `vault::validate_blob_len` — the precedent for `collections.rs` reusing the same guard on `enc_name`/`sealed_key` fields):
```rust
use super::vault::validate_blob_len;
...
validate_blob_len("enc_name", &req.enc_name)?;
```

---

### `crates/pv-server/src/routes/identity.rs` (controller, CRUD idempotent-upsert)

**Analog:** `crates/pv-server/src/routes/vault.rs::create` for the `ON CONFLICT ... DO NOTHING ... RETURNING` idiom, extended per RESEARCH.md's own worked example for the self-healing race case (RESEARCH.md lines ~452-486, "KEY-01 idempotent-upsert-with-self-healing pattern" — copy that code block directly, it is already written in this codebase's conventions).

Zero-knowledge boundary note to carry into this file's module doc comment (mirroring `pv-core/src/identity.rs`'s own doc-comment style of stating what the code must NOT do): **`identity.rs` must never call `pv_core::identity::{seal, unseal}`** — it only stores/serves opaque `public_key BLOB` / `wrapped_secret_key TEXT` columns. Cite this explicitly, matching `pv-core/src/identity.rs:1-18`'s own "Generowanie jest wyłącznie client-side" framing.

---

### `crates/pv-server/migrations/0014_family_sharing.sql` (migration)

**Analog:** `crates/pv-server/migrations/0013_passkey_counter_anomaly.sql` (header/comment style — most recent, additive-only precedent) and `crates/pv-server/migrations/0001_init.sql` (table/index/FK shape for new tables).

**Header comment style to copy** (`0013_passkey_counter_anomaly.sql`, full file):
```sql
-- Additive-only kolumna sygnalizująca regresję licznika podpisów
-- (`WebauthnError::CredentialPossibleCompromise`, SEC-04). `webauthn-rs`'s
-- `require_valid_counter_value` (domyślnie `true`, nigdy nie nadpisywane w
-- `build_webauthn()`) JUŻ twardo odrzuca ceremonię, gdy zapisany licznik jest
-- większy niż otrzymany — ta kolumna tylko czyni ten fakt widocznym dla
-- operatora (klonowany/skompromitowany autentykator), nie zmienia czy
-- ceremonia się powiedzie.
--
-- NULL = nigdy nie zaobserwowano regresji dla tego credential_id; timestamp =
-- ostatni raz, kiedy `CredentialPossibleCompromise` zadziałał.
--
-- Zgodnie z 0004's regułą "passkey_json nigdy nie dekomponować" — to jest
-- osobna kolumna, nie zagnieżdżone pole w blobie.

ALTER TABLE passkeys ADD COLUMN counter_anomaly_at TEXT;
```
Pattern: a multi-paragraph `--`-comment block explaining *why* (citing the requirement/threat id) precedes the DDL; DDL itself is terse, no inline comments needed once the header states intent.

**Table + index + FK shape** (`0001_init.sql`, e.g. `webauthn_credentials`/`folders`):
```sql
CREATE TABLE folders (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    enc_name   TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_folders_user ON folders(user_id);
```
and the `CHECK` constraint precedent (`0001_init.sql`, `vault_items.type`):
```sql
type TEXT NOT NULL CHECK (type IN ('login','passkey','card','note','totp')),
```
Apply this exact `CHECK (col IN (...))` shape to `family_members.role`, `collection_keys.access_level`, `item_shares.access_level`.

**Composite-PK precedent:** no existing migration in this repo has a composite PK — `0014_*` is the first. Model it directly on standard SQLite syntax consistent with this schema's style (uppercase keywords, 4-space-aligned columns, trailing `REFERENCES ... ON DELETE CASCADE` where the FK target is a `users`/owned-resource row):
```sql
CREATE TABLE collection_keys (
    collection_id      TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    recipient_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    sealed_key         TEXT NOT NULL,
    access_level       TEXT NOT NULL CHECK (access_level IN ('read','edit','hidden_password')),
    PRIMARY KEY (collection_id, recipient_user_id)
);
```

**Additive `ALTER TABLE ... ADD COLUMN` precedent** (`0013_passkey_counter_anomaly.sql`'s own single-line `ALTER TABLE passkeys ADD COLUMN counter_anomaly_at TEXT;`) — directly reusable for `ALTER TABLE vault_items ADD COLUMN collection_id TEXT REFERENCES collections(id);` (RESEARCH.md's structural-gap finding — nullable, additive, no CHECK needed since `NULL` = personal item preserves current behavior byte-for-byte).

**Naming convention:** `0014_family_sharing.sql` continues the `NNNN_snake_case_description.sql` numbering — next integer after `0013`, description names the feature not the mechanism.

---

### `crates/pv-server/src/routes/mod.rs` (route registration — MODIFIED)

**Current shape to extend** (`mod.rs:47-79`, full `router_with_cors`):
```rust
pub fn router_with_cors(state: AppState, static_dir: Option<PathBuf>, cors: CorsLayer) -> Router {
    let api = Router::new()
        .route("/healthz", get(healthz))
        .route("/api/auth/prelogin", post(auth::prelogin))
        ...
        .route("/api/vault/items", get(vault::list).post(vault::create))
        .route("/api/vault/items/{id}", put(vault::update).delete(vault::delete))
        .route("/api/vault/items/{id}/touch", post(vault::touch))
        .route("/api/vault/folders", get(folders::list).post(folders::create))
        .route("/api/vault/folders/{id}", delete(folders::delete))
        ...
        .with_state(state)
        .layer(cors);
    ...
}
```
Module declarations at top of file (`mod.rs:1-9`):
```rust
pub mod auth;
pub mod extension_passkeys;
pub mod folders;
pub mod passkeys;
pub mod session;
pub mod sessions;
pub mod sync;
pub mod vault;
pub mod webauthn_state;
```
Add `pub mod membership; pub mod families; pub mod collections; pub mod identity;` here.

**Refactor required (per RESEARCH.md Pattern 4):** extract the membership-gated subset into a `pub(crate) fn membership_routes() -> Vec<(&'static str, axum::routing::MethodRouter<AppState>)>` function, fold it into `router_with_cors`'s existing `Router::new()` chain via `.route(path, method_router)` calls (`{id}` path syntax already used at `mod.rs:58,59,61,67,70,75,77` — continue that convention, never `:id`). This table is what `tests/membership_route_sweep.rs` iterates — see RESEARCH.md lines 363-387 for the literal code sample to copy.

**CORS/route-table testing precedent** (`mod.rs:321-536`, `#[cfg(test)] mod tests`) — no new tests needed here for Phase 22, but note the existing convention of colocating router-shape unit tests in this file, in case the sweep-count tripwire (RESEARCH.md's "Honest limitation" mitigation) lands here rather than in `tests/`.

---

### `crates/pv-server/src/error.rs` (error type — MODIFIED)

**Full current file** (capture in full, per phase brief instruction):
```rust
//! Typowany błąd granicy API — mirror `pv_core::CryptoError`'s thiserror
//! shape, ale mapowany na kody HTTP zamiast propagowany przez `anyhow`.

use axum::{http::StatusCode, response::IntoResponse, Json};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("bad request: {0}")]
    BadRequest(String),
    #[error("unauthorized")]
    Unauthorized,
    #[error("not found")]
    NotFound,
    #[error("conflict: {0}")]
    Conflict(String),
    #[error("internal error")]
    Internal,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, message) = match &self {
            ApiError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            ApiError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            ApiError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            ApiError::Internal => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        tracing::error!(?err, "db error");
        ApiError::Internal
    }
}
```
**Change:** add one new variant following the existing unit-variant style (like `Unauthorized`/`NotFound`, no payload):
```rust
    #[error("forbidden")]
    Forbidden,
```
and one new match arm in `into_response`:
```rust
            ApiError::Forbidden => (StatusCode::FORBIDDEN, self.to_string()),
```
Do **not** add a `Forbidden(String)` payload variant — CONTEXT.md is explicit that existence must never leak via the message, and every other bare-status variant (`Unauthorized`, `NotFound`) already uses `self.to_string()` (the static `#[error("...")]` text) rather than a caller-supplied message, so `Forbidden` should match that shape exactly.

---

### `crates/pv-server/src/routes/vault.rs` (controller — MODIFIED/EXTENDED)

**`fetch_items_for`** (full function, `vault.rs:141-161`, already excerpted above under families/collections) — collection-scoped reads must extend this, not duplicate it: add `collection_id` to the `SELECT`/struct and to any WHERE-clause variant needed for "items in collection X", but keep this the single row-fetch implementation `list()` and any future sync snapshot code call.

**`create`** (full function, `vault.rs:57-122`) — the transaction + `SYNC-01` global-revision-bump + `SYNC-02` post-commit publish pattern is the template for `move_item`'s transaction shape; `create`'s own doc comments (lines 68-71, 98-100, 110-112) show the exact "why" comment style (`WR-01:`, `SYNC-01:`, `SYNC-02:` prefixed citations) to reuse for citing SHARE-04/SEC-06 in the new `move_item` handler.

**`update`** (full function, `vault.rs:229-298`) — this is the base to extend for the "move item" endpoint (RESEARCH.md Pattern 3): same `expected_revision` optimistic-concurrency shape, same 404-vs-409 disambiguation via follow-up `SELECT`, but gated by **two** `Membership` extractions instead of the current bare `session.user_id` scoping — `Membership<Item, RequireEdit>` on the current collection (extracted from path/DB) plus a second `Membership<Collection, RequireRead>` check against the body-supplied destination id (see RESEARCH.md Pattern 3 for the exact two-check design and its rationale).

---

## Shared Patterns

### Authentication (`SessionUser`)
**Source:** `crates/pv-server/src/routes/session.rs:13-25`
**Apply to:** every new handler, composed inside the new `Membership<R, M>` extractor (called via `SessionUser::from_request_parts(parts, state).await?` per axum's documented extractor-composition pattern, RESEARCH.md Pattern 1).

### Authorization (`Membership<R, M>` — new, this phase's core deliverable)
**Source:** `crates/pv-server/src/routes/membership.rs` (new file), modeled on `session.rs`.
**Apply to:** every handler in `families.rs`, `collections.rs`, and the collection-scoped paths added to `vault.rs`. No handler on a family/collection/item resource may omit it from its signature (the "compiles without it → cannot touch the resource" guarantee CONTEXT.md requires).

### Error handling (`ApiError`)
**Source:** `crates/pv-server/src/error.rs` (full file above).
**Apply to:** every new handler's `Result<_, ApiError>` return type; `From<sqlx::Error> for ApiError` is already blanket-applied via `?` — no new conversions needed. Reuse `ApiError::NotFound` for no-access (never a new variant); use the new `ApiError::Forbidden` only for the "caller has some access but insufficient level" case, per CONTEXT.md's explicit split.

### Row decoding (`sqlx::Row` + `.try_get(...).map_err(|_| ApiError::Internal)`)
**Source:** every handler in `vault.rs`/`folders.rs`/`session.rs`.
**Apply to:** every new `resolve_access`/`fetch_*_for`/response-struct-building function.

### Transaction + revision-bump discipline (WR-01/SYNC-01/SYNC-02)
**Source:** `crates/pv-server/src/routes/vault.rs::create` (lines 68-116) and `::update`/`::delete`.
**Apply to:** any new write in `families.rs`/`collections.rs`/`identity.rs` that must be atomic with a downstream side effect (e.g. `collection_keys` insert + any future revision counter, though CONTEXT.md/RESEARCH.md scope per-collection revision counters to Phase 23 — this phase's writes may not need the `vault_revision` bump at all; verify against CONTEXT.md before copying the SYNC-01 bump specifically).

### Test harness
**Source:** `crates/pv-server/tests/common/mod.rs` (full file, `test_pool`, `test_app`, `register_and_login`).
**Apply to:** all four new test files. `register_and_login(&app, email) -> String` (bearer token) is reused verbatim for each new user fixture; the phase will need a new `#[allow(dead_code)]`-annotated helper (mirroring `register_and_login`'s own precedent, `common/mod.rs:76-129`) for registering a *second*/*third* family member sharing the same family — RESEARCH.md's Wave-0-Gaps list flags this explicitly as a likely-needed addition to `common/mod.rs`, not a new per-test-file helper.

### Comment/citation style
**Source:** pervasive across `vault.rs`, `folders.rs`, `session.rs`, `pv-core/src/identity.rs`, `0013_passkey_counter_anomaly.sql`.
**Apply to:** all new code. Pattern: Polish-primary prose (English technical terms untranslated), citing a requirement/threat id inline, e.g. `WR-01:`, `SYNC-01:`, `SEC-04`, `patrz threat_model T-02-07`. New authorization code should cite `SEC-06`/`SHARE-05` and `CVE-2026-43639` / `Vaultwarden #6269` the same way — see CONTEXT.md's own instruction to this effect.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `crates/pv-server/tests/membership_route_sweep.rs` | test | route-table sweep | No existing integration test enumerates the router's own route table — this is a genuinely new test shape (table-driven, iterates `membership_routes()`). Use RESEARCH.md's Pattern 4 design as the primary source instead of a codebase analog. |
| `crates/pv-server/src/routes/membership.rs`'s generic `Membership<R, M>` type itself | middleware | — | No existing extractor in this codebase is generic over a resource-kind trait (`SessionUser` is the only prior `FromRequestParts` impl and is non-generic) — RESEARCH.md's Code Example (Pattern 1) is the primary source, `session.rs` supplies only the shape/style, not the generics. |

## Metadata

**Analog search scope:** `crates/pv-server/src/routes/`, `crates/pv-server/migrations/`, `crates/pv-server/tests/`, `crates/pv-server/src/error.rs`, `crates/pv-core/src/identity.rs`
**Files scanned:** `session.rs`, `vault.rs`, `folders.rs`, `mod.rs`, `error.rs`, `tests/common/mod.rs`, `migrations/0001_init.sql`, `migrations/0003_vault_items_rebuild.sql`, `migrations/0013_passkey_counter_anomaly.sql`, `pv-core/src/identity.rs`
**Pattern extraction date:** 2026-07-30
