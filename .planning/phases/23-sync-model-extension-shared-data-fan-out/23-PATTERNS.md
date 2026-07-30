# Phase 23: Sync Model Extension — Shared-Data Fan-Out - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 10 (new/modified) + 3 shared cross-cutting concerns
**Analogs found:** 10 / 10

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/pv-server/migrations/0015_*.sql` | migration | CRUD (schema) | `0014_family_sharing.sql` | exact (same additive-migration convention) |
| `crates/pv-server/src/routes/sync.rs` (shared pull handler + `EntityType::Collection` + fan-out publish) | route/controller | request-response + pub-sub | `sync.rs::pull` + `SyncHub::publish` (same file) | exact |
| `crates/pv-server/src/routes/mod.rs` (register `GET /api/sync/shared*`) | route table | request-response | existing `.route("/api/sync", ...)` registration + `membership_routes()` | exact |
| `crates/pv-server/src/routes/vault.rs` (`update`/`delete`/`move_item` TODO closure) | controller | CRUD + event-driven | the SAME file's `create()` tx-then-publish shape | exact (self-referential — extend, don't replace) |
| `crates/pv-server/src/routes/collections.rs` (emit `EntityType::Collection` events) | controller | event-driven | `vault.rs`'s `SyncEvent` publish call sites | role-match |
| `crates/pv-server/src/error.rs` (structured 409) | error/utility | request-response | existing `ApiError::Conflict(String)` variant | exact (extend enum, same file) |
| `crates/pv-server/tests/sync_shared.rs` (new) | test | event-driven (WS) + CRUD | `crates/pv-server/tests/sync.rs` (`ws_cross_user_isolation`, `ws_event_contains_no_ciphertext`) | exact |
| `web/playwright.config.ts` (new) | config | — | `extension/playwright.config.ts` | role-match (config style only, launch mechanism NOT reusable) |
| `web/e2e/fixtures.ts` + `web/e2e/shared-sync.spec.ts` (new) | test | request-response + WS | `extension/e2e/fixtures.ts` + `extension/e2e/dual-browser.spec.ts` | role-match (fixture *shape*, not extension-load logic) |
| `web/src/lib/vault/sync.ts` (consume shared pull + collection events) | service/hook | streaming (WS) + CRUD | itself + `web/src/lib/vault/api.ts` | exact |
| `web/src/components/vault/DetailPanel.tsx` + `web/src/lib/i18n/dictionary.ts` (attribution copy) | component + config | request-response | itself (existing `revision-conflict-banner`/`live-edit-conflict-banner`) | exact |

## Pattern Assignments

### `crates/pv-server/migrations/0015_*.sql`

**Analog:** `crates/pv-server/migrations/0014_family_sharing.sql`

**Header comment convention** (lines 1-29): cite requirement IDs, explain *why* additive-only, name the exact invariant preserved for existing rows.

**Copy:** the additive `ALTER TABLE ... ADD COLUMN` shape (lines 90-94) — `collections.revision` follows the same pattern as `vault_items.collection_id`:
```sql
ALTER TABLE collections ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
```
**What to change:** `collections` already exists (created in 0014), so this is a single `ALTER TABLE`, not a new `CREATE TABLE`. Cite `SYNC-04`/`SC 1` in the header comment, not `FAM-01`/`SEC-06`. Confirm no `NOT NULL DEFAULT 0` migration-on-existing-rows issue (SQLite allows this cleanly since `DEFAULT 0` backfills existing rows).

---

### `crates/pv-server/src/routes/sync.rs` — shared pull handler + fan-out

**Analog:** same file's existing `pull()` (lines 53-73) for the handler shape; `SyncHub::publish` (lines 128-133) for the fan-out extension point.

**Imports** (lines 15-32) — copy verbatim, add nothing new (no new external crate needed):
```rust
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    response::Response,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::Row;
```
Add `use super::membership::{Collection, FamilyMembership, Membership, RequireRead};` for the new route(s)' extractors.

**Core cheap-check pattern to mirror** (lines 52-73, `pull()`):
```rust
pub async fn pull(
    State(state): State<AppState>,
    session: SessionUser,
    Query(q): Query<SyncQuery>,
) -> Result<Json<SyncResponse>, ApiError> {
    let row = sqlx::query("SELECT vault_revision FROM users WHERE id = ?")
        .bind(&session.user_id)
        .fetch_one(&state.db)
        .await?;
    let revision: i64 = row.try_get("vault_revision").map_err(|_| ApiError::Internal)?;
    if q.since == revision {
        return Ok(Json(SyncResponse::UpToDate { revision }));
    }
    ...
}
```
**Copy the shape** (cheap scalar check → early return `UpToDate`, else full body) for the NEW revisions-map endpoint, but the comparison is **per-collection** — do NOT collapse to one scalar (`MAX`/`SUM` forbidden by CONTEXT.md). Query shape instead:
```sql
SELECT c.id, c.revision FROM collections c
JOIN collection_keys ck ON ck.collection_id = c.id AND ck.recipient_user_id = ?
JOIN family_members fm ON fm.family_id = c.family_id AND fm.user_id = ck.recipient_user_id
```
This is the SAME join shape as `membership.rs::Collection::resolve_access` (lines 174-207) — reuse it, do not hand-roll a new `WHERE`.

**`EntityType` extension** (lines 75-82) — add the variant, keep `snake_case`:
```rust
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    Item,
    Folder,
    Collection, // NEW — SYNC-05; carries collection id in the existing `id` field, never a new field
}
```
**Do NOT touch `SyncEvent`'s four fields** (lines 98-104) — CONTEXT.md hard constraint #4 and the module's own doc comment (lines 94-97: "these four fields ONLY").

**Fan-out publish extension** — new function beside `publish()` (lines 128-133), NOT a modification of `publish()` itself:
```rust
// NEW, beside SyncHub::publish — resolves recipients FRESH at emit time,
// never cached (SYNC-05 hard constraint). Call from inside vault.rs's tx,
// AFTER tx.commit() succeeds — same discipline as every existing publish() call site.
pub(crate) fn publish_to_recipients(&self, recipients: &[String], event: SyncEvent) {
    for user_id in recipients {
        self.publish(user_id, event.clone()); // reuses existing single-user publish, no hub re-keying
    }
}
```
**What to copy:** the `Arc<Mutex<HashMap<...>>>` hub stays keyed by `user_id` (do not re-key by collection — CONTEXT.md locked decision). **What to change:** nothing in `subscribe`/`prune_if_empty`/`handle_socket` (lines 118-146, 173-194) — those are explicitly frozen per CONTEXT.md.

**`broadcast::error::RecvError::Lagged` handling** (line 184) — keep the existing `continue`, unchanged, per locked decision.

---

### `crates/pv-server/src/routes/mod.rs` — route registration

**Analog:** existing `.route("/api/sync", get(sync::pull))` / `.route("/api/sync/ws", get(sync::ws_handler))` (lines 64-65), and `membership_routes()`'s table shape (lines 171-183).

**Copy:** the per-collection fetch endpoint should live in `membership_routes()` (path-`{id}`-based, per RESEARCH.md's Open Question 1 recommendation) so it reuses `Membership<Collection, RequireRead>` verbatim:
```rust
("/api/vault/collections/{id}/sync", get(sync::pull_shared_collection)),
```
The revisions-map endpoint (pathless, `FamilyMembership`-gated) goes in the main `api` chain beside the existing two `/api/sync*` routes (lines 64-65):
```rust
.route("/api/sync/shared", get(sync::pull_shared_revisions))
```
**What to change:** there is a self-verifying test at `mod.rs` (around line 692, `membership_routes_table_has_expected_cardinality`) asserting an exact count (`9`) — this will need updating to the new count when a route is added to `membership_routes()`. There's also a structural test (~line 1082) counting `.route(` calls outside the three known functions — read it before adding routes to avoid tripping it.

---

### `crates/pv-server/src/routes/vault.rs` — closing the three `TODO(phase-23, WR-09)` blocks

**Analog:** the SAME file's `create()` (lines 71-119) — the canonical tx-then-publish shape every other handler in this file already follows.

**Read first, verbatim, before writing anything** — the three TODOs are the spec:
- `update()` lines 322-332 (bump only the editor's own revision — TODO names the exact 409 hazard)
- `delete()` lines 387-391
- `move_item()` lines 562-567 (bumps BOTH source and destination collections)

**Anti-pattern flagged in RESEARCH.md — do not copy `create()`'s single-row bump pattern verbatim for the multi-recipient case:**
```rust
// WRONG for N recipients — .fetch_one() panics/errors if rows_affected != 1:
let _new_global_revision: i64 = sqlx::query_scalar(
    "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
).bind(&session.user_id).fetch_one(&mut *tx).await?;
```
**Correct shape for the recipients bump** (per RESEARCH.md's Pattern 1 + Anti-Patterns section):
```rust
// batched, single statement, no RETURNING, no per-recipient loop:
sqlx::query(
    "UPDATE users SET vault_revision = vault_revision + 1 WHERE id IN ( \
        SELECT recipient_user_id FROM collection_keys WHERE collection_id = ?1 \
        UNION SELECT recipient_user_id FROM item_shares WHERE item_id = ?2 \
        UNION SELECT ?3 \
     )"
).bind(&collection_id).bind(&item_id).bind(&owner_user_id).execute(&mut *tx).await?;
```
**Collections.revision bump** (needs the new value for `SyncEvent.revision`, so use `.fetch_all()`/`RETURNING`, not `.execute()`):
```rust
let bumped: Vec<(String, i64)> = sqlx::query(
    "UPDATE collections SET revision = revision + 1 WHERE id IN (?1, ?2) RETURNING id, revision"
) /* bind collection_id(s), skip NULL side for move_item */
    .fetch_all(&mut *tx).await?
    .into_iter().map(|row| (row.try_get("id")?, row.try_get("revision")?)).collect()?;
```
**Copy exactly:** the tx boundary discipline — mutation + BOTH revision bumps inside one `tx`, `tx.commit()`, THEN publish (see `update()`'s existing structure lines 284-357 as the scaffold to extend in place — do not restructure the function, only fill in what the TODO names).

**409 attribution** — extend the existing disambiguation block (lines 300-312):
```rust
None => {
    let exists = sqlx::query("SELECT 1 FROM vault_items WHERE id = ?")
        .bind(&id).fetch_optional(&mut *tx).await?;
    return match exists {
        Some(_) => Err(ApiError::Conflict("stale revision".into())), // becomes StaleRevisionShared{..} for shared items
        None => Err(ApiError::NotFound),
    };
}
```
Only shared items (collection-scoped or with `item_shares` rows) get the new structured variant; personal items keep the exact existing `ApiError::Conflict("stale revision".into())` string, per CONTEXT.md's "personal items keep today's exact generic copy."

---

### `crates/pv-server/src/routes/collections.rs` — emit `EntityType::Collection` events

**Analog:** `vault.rs`'s `SyncEvent` publish call sites (e.g. lines 116-119, 347-355).

**Copy the exact shape**, changing only `entity_type`:
```rust
state.sync_hub.publish_to_recipients(
    &recipients,
    SyncEvent { entity_type: EntityType::Collection, id: collection_id.clone(), revision: new_revision, change_type: ChangeType::Update },
);
```

---

### `crates/pv-server/src/error.rs` — structured 409

**Analog:** existing `ApiError::Conflict(String)` variant + its `IntoResponse` arm (lines 7-27, 29-41).

**Pitfall B (from RESEARCH.md) — verbatim guidance:** `ApiError::Conflict`'s wire shape (`{"error": message}`) cannot carry a structured field without breaking the other 15+ call sites. Add a NEW variant instead:
```rust
#[derive(Debug, Error)]
pub enum ApiError {
    // ...existing variants unchanged...
    #[error("conflict: {message}")]
    StaleRevisionShared { message: String, last_editor_email: Option<String> },
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        let (status, body) = match &self {
            // ...existing arms unchanged, still returning (status, message: String)...
            ApiError::StaleRevisionShared { message, last_editor_email } => {
                return (StatusCode::CONFLICT, Json(serde_json::json!({
                    "error": message,
                    "last_editor_email": last_editor_email,
                }))).into_response();
            }
        };
        (status, Json(serde_json::json!({ "error": body }))).into_response()
    }
}
```
**What to copy:** the `#[error(...)]` thiserror-derive convention, the doc-comment style explaining WHY a variant exists (see `Forbidden`'s comment, lines 15-20, as the model — explain the security/wire-shape reasoning, not just "what"). **What to change:** the match arm needs an early `return` since this variant's JSON shape has an extra field, breaking the uniform `(status, message)` tuple the other arms share — document this deviation inline.

---

### `crates/pv-server/tests/sync_shared.rs` (new)

**Analog:** `crates/pv-server/tests/sync.rs` — specifically `ws_cross_user_isolation` (lines 213-231) and `ws_event_contains_no_ciphertext` (lines 175-211); also `tests/common/mod.rs`'s `test_server`/`register_and_login`/`test_pool` helpers (imported at line 18) and `tests/membership_route_sweep.rs`'s adversarial-sweep posture.

**Module doc-comment convention** (lines 1-6 of `sync.rs`) — copy the style: what's covered, why a real-socket harness is needed (`oneshot()` can't do WS upgrades).

**Copy verbatim:** `url_encode_token()` helper (lines 20-27), `body_json()` (lines 29-32), `req()` (lines 34-50), `item_body()` (lines 52-58) — these are exactly reusable, import via `mod common` + local helpers duplicated in the new file (same pattern `sync.rs` itself uses — no shared non-`common` test helper module exists).

**Core 2-session-2-WS pattern to extend to 3 sessions** (lines 213-231, `ws_cross_user_isolation`):
```rust
let (app, port) = test_server(pool).await;
let token_a = register_and_login(&app, "a@example.com").await;
let token_b = register_and_login(&app, "b@example.com").await;
let url_b = format!("ws://127.0.0.1:{port}/api/sync/ws?token={}", url_encode_token(&token_b));
let (mut ws_stream_b, _) = tokio_tungstenite::connect_async(&url_b).await.unwrap();
// mutate as A ...
let result = tokio::time::timeout(std::time::Duration::from_millis(500), ws_stream_b.next()).await;
assert!(result.is_err(), "...");
```
**What to change:** add a third session (member vs non-member), seed a real `collections`/`collection_keys` row via raw SQL (mirror `membership.rs`'s `seed_family_and_collection` test helper, lines 538-561, duplicated here since it's `src/`-internal), and assert the member's socket DOES receive a `SyncEvent{entity_type: "collection", ...}` while the non-member's socket times out — model the adversarial framing on `membership_route_sweep.rs`'s "prove absence structurally" posture per CONTEXT.md's Specifics section.

**Frame-shape assertion pattern** (lines 200-211) — copy for the collection-scoped event, expecting the same four keys with `entity_type == "collection"`.

---

### `web/playwright.config.ts` (new)

**Analog:** `extension/playwright.config.ts` — config STYLE only (worker/retry discipline, comment conventions), NOT the `launchPersistentContext` mechanism (extension-specific, not applicable to `web/`).

**Copy the comment convention and config keys** (lines 20-60): `testDir`, `fullyParallel`, `workers`, `retries`, `reporter`, `projects` — but for `web/`, no persistent-context/extension-loading logic is needed; use Playwright's standard `use: { baseURL }` + `webServer` config instead (RESEARCH.md's recommendation — real `pv-server` via `webServer`, built with `NEXT_PUBLIC_API_BASE_URL=""`).

**What to change entirely:** no `chromium.launchPersistentContext`, no `extContext`/`extensionId` fixtures — `web/e2e/fixtures.ts` instead needs two independent `browser.newContext()` calls per CONTEXT.md's explicit constraint (see Don't Hand-Roll table in RESEARCH.md). Do NOT port `extension/e2e/fixtures.ts`'s persistent-context logic wholesale.

**webServer config** — new pattern, not present anywhere in repo yet; per RESEARCH.md:
```ts
webServer: {
  command: "...", // build web/ with NEXT_PUBLIC_API_BASE_URL="" and run pv-server serving it against a throwaway SQLite DB
  url: "http://localhost:8620",
  reuseExistingServer: !process.env.CI,
},
```
Do not touch `web/.env.local`'s `NEXT_PUBLIC_API_BASE_URL` as a side effect (STATE.md Blockers note, cited in CONTEXT.md) — override via env var at build/run time for this suite only.

---

### `web/e2e/fixtures.ts` + `web/e2e/shared-sync.spec.ts` (new)

**Analog:** `extension/e2e/fixtures.ts` (worker-scoped fixture *pattern*, `test.extend` shape) + `extension/e2e/dual-browser.spec.ts` (spec-file organization, cumulative-state test posture).

**Copy the `test.extend` typing-workaround comment style** if TypeScript strictness bites the same way (lines 43-58 document a real typing gotcha with `@playwright/test`'s fixture typing under `Bundler` module resolution) — worth checking early since `web/`'s tsconfig may hit the same issue.

**What NOT to copy:** the `launchPersistentContext`/`EXTENSION_PATH`/headless-ceremony-carve-out logic (lines 36, 74-80) — entirely extension-specific. Two sessions here = two independent `browser.newContext()`, using the web app's password-only login flow (`LoginForm.tsx`), never a WebAuthn ceremony (CONTEXT.md's zero-OS-dialog constraint).

---

### `web/src/lib/vault/sync.ts` — consume shared pull + collection events

**Analog:** itself (the file already IS the pattern to extend) + `web/src/lib/vault/api.ts`.

**Key finding from RESEARCH.md — verify before writing any client code:** `onmessage` (lines 88-91) is deliberately unparsed:
```ts
socket.onmessage = () => {
  // Deliberately unparsed: ANY frame means "go pull" and nothing more.
  void pullOnce();
};
```
This means **`EntityType::Collection` needs ZERO client-side WS parsing changes this phase** — the existing "any frame → pull" contract already covers it. Confirm this before adding any client-side event-type branching; RESEARCH.md flags this as a finding CONTEXT.md doesn't state explicitly.

**What DOES need to change:** `pullOnce()` (lines 38-54) currently calls only `getSyncSnapshot()` (personal `/api/sync`). It needs a second call to the new shared-pull endpoint(s), reusing the exact same try/catch-and-ignore-transient-failure shape (lines 43-53) — copy that error-handling posture verbatim, do not add a new error path.

---

### `web/src/components/vault/DetailPanel.tsx` + `web/src/lib/i18n/dictionary.ts`

**Analog:** the same file's own `revision-conflict-banner` (lines 291-298) and `live-edit-conflict-banner` (lines 299-317) blocks, plus their existing dictionary keys (`error.revisionConflict` at dictionary.ts:470-473, `sync.itemChangedElsewhere`/`sync.itemChangedElsewhereConsequence`/`sync.refreshAction` at 687-695).

**Copy exactly — both banners' JSX shape**, only adding an interpolated attribution string:
```tsx
{conflict ? (
  <div data-testid="revision-conflict-banner" className="alert alert-error text-sm">
    {lastEditorEmail ? interpolate(t("error.revisionConflictAttributed"), { email: lastEditorEmail }) : t("error.revisionConflict")}
  </div>
) : null}
```
**Dictionary key convention to copy** (dictionary.ts:470-473 shape — PL+EN pair, `interpolate()` placeholder syntax used elsewhere in this file, e.g. `aria.copyField`/`aria.deleteItem` at DetailPanel.tsx:206,264):
```ts
"error.revisionConflictAttributed": {
  pl: "{email} edytował(a) ten item w międzyczasie. Odśwież i spróbuj ponownie.",
  en: "{email} edited this item in the meantime. Refresh and try again.",
},
```
**What to change:** `liveConflict`'s banner (lines 299-317) needs the SAME attribution treatment but sourced from the shared-pull response (the editor's email arrives via the pull the WS event triggers, per CONTEXT.md — never from `SyncEvent` itself, which gains no actor field). Personal items must render the exact existing generic string unchanged — gate attribution rendering on "is this item collection-scoped or does it have item_shares" (a new prop/derived value on `VaultItem`, not inferred from the banner code itself).

**`data-testid` naming convention** (verbatim from this file): `revision-conflict-banner`, `live-edit-conflict-banner`, `live-edit-conflict-refresh` — the new Playwright specs should target these EXACT existing ids, not invent new ones (CONTEXT.md: "the existing conflict affordance... gains attribution").

## Shared Patterns

### WR-01: mutation + revision bump(s) in one transaction, publish after commit
**Source:** `crates/pv-server/src/routes/vault.rs::create()` lines 71-119 (canonical), repeated at `update()` 284-357, `delete()` 372-415, `move_item()` 518-589.
**Apply to:** every new/modified mutation path in `vault.rs` and any new mutation in `collections.rs` that must also bump `collections.revision`.
```rust
let mut tx = state.db.begin().await?;
// 1. mutate
// 2. bump collections.revision (fetch_all/RETURNING) + bump recipients' vault_revision (execute, no RETURNING)
tx.commit().await?;
// 3. publish AFTER commit, never before/inside
```

### Membership authorization — never a hand-written WHERE
**Source:** `crates/pv-server/src/routes/membership.rs` — `Membership<R, M>` (lines 360-420), `FamilyMembership<M>` (lines 448-479), `Collection::resolve_access` (174-207).
**Apply to:** the per-collection fetch endpoint (`Membership<Collection, RequireRead>`, zero extractor changes needed per RESEARCH.md Q1) and the revisions-map endpoint (`FamilyMembership<RequireRead>`, pathless — `Membership<R,M>` cannot be used here, it requires a path `{id}`).

### 404-vs-403 / non-membership discipline
**Source:** `membership.rs::gate()` (lines 345-358).
**Apply to:** every new shared-scope query — non-membership must return `ApiError::NotFound`, never `Forbidden`, and must leak zero rows/identifiers (SYNC-07 hard constraint).

### Error handling — `ApiError` + `.map_err(|_| ApiError::Internal)` on every `try_get`
**Source:** `crates/pv-server/src/error.rs`, used pervasively in `vault.rs`/`membership.rs`.
**Apply to:** all new SQL row-decoding in `sync.rs`'s new handlers.

### Comment convention — cite requirement/threat IDs, explain why not just what
**Source:** pervasive across `sync.rs`, `vault.rs`, `membership.rs`, `0014_family_sharing.sql` (Polish + English mixed, e.g. `vault.rs`'s module doc line 1-5).
**Apply to:** all new code this phase — cite `SYNC-04/05/06/07/08`, `SEC-08`, and `Pitfall 14/17/18` the same way `WR-01`/`T-05-04`/`SEC-06` are cited today.

### i18n key pairing (PL+EN)
**Source:** `web/src/lib/i18n/dictionary.ts` throughout (e.g. lines 470-473, 687-695).
**Apply to:** the new `error.revisionConflictAttributed`-style key(s).

## No Analog Found

None — every file in scope has a strong same-repo analog (this phase is explicitly framed by RESEARCH.md as "extending existing mechanisms' scope," not inventing new sync primitives).

## Metadata

**Analog search scope:** `crates/pv-server/src/routes/`, `crates/pv-server/migrations/`, `crates/pv-server/tests/`, `web/src/lib/vault/`, `web/src/components/vault/`, `web/src/lib/i18n/`, `extension/e2e/`, `extension/playwright.config.ts`
**Files scanned:** `sync.rs`, `vault.rs`, `membership.rs`, `error.rs`, `mod.rs`, `0014_family_sharing.sql`, `tests/sync.rs`, `DetailPanel.tsx`, `sync.ts`, `dictionary.ts`, `extension/playwright.config.ts`, `extension/e2e/fixtures.ts`
**Pattern extraction date:** 2026-07-30
