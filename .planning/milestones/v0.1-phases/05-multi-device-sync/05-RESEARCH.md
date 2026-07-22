# Phase 5: Multi-Device Sync - Research

**Researched:** 2026-07-14
**Domain:** Real-time sync (axum WebSocket push + revision-gated REST pull), in-process pub/sub, optimistic-concurrency conflict UX
**Confidence:** HIGH

## Summary

Phase 5 adds a cheap-check pull endpoint (`GET /api/sync?since=N`), a metadata-only WebSocket push channel (`GET /api/sync/ws`), and client-side reconnect/poll/conflict-banner logic on top of infrastructure Phase 2 already built (per-item `revision`, single-statement optimistic-concurrency `UPDATE ... RETURNING`, the `store.ts` singleton, `RevisionConflictError`). Nothing here is exotic: axum's built-in `ws` feature (no external WebSocket crate needed on the server), a `tokio::sync::broadcast` channel per user for in-process fan-out (zero-Redis, matches the single-container constraint), and a client `EventSource`-free hand-rolled reconnect loop using the browser's native `WebSocket` API (no client library needed either — the protocol surface is one small JSON message).

The one technically load-bearing verified fact from this research: `tokio::sync::broadcast::Sender::send()` returns `Err(SendError)` when a user currently has **zero** subscribed WebSocket connections (e.g., they're only on the polling fallback, or briefly between reconnects) `[VERIFIED: docs.rs tokio 1.52.3, cross-checked WebSearch]`. This is expected, not a bug — every mutating handler that publishes a `SyncEvent` must treat that `Err` as a no-op (nobody is listening right now; the poll fallback and the next `GET /sync` catch-up pull cover it), never propagate it as an HTTP error.

The other load-bearing fact: axum's `WebSocketUpgrade` extractor cannot be tested with the project's existing `tower::ServiceExt::oneshot()` integration-test harness (`crates/pv-server/tests/common/mod.rs`) — a WS upgrade needs a real TCP socket doing the HTTP Upgrade handshake, which `oneshot()` never performs. The WS integration test must bind a real `TcpListener` on port 0, run `axum::serve` in a background `tokio::spawn`, and connect with `tokio_tungstenite::connect_async` (a new pv-server dev-dependency) `[VERIFIED: crates.io registry — tokio-tungstenite 0.30.0, 4.1M weekly downloads, OK verdict]`.

**Primary recommendation:** Build the pull endpoint and the `vault_revision` migration first (it's a strict prerequisite — WS events reference the same revision numbers), then the WS handler + `sync_hub`, then wire `store.ts`'s poll timer and WS client against the already-passing pull endpoint, then layer the conflict-banner/sync-indicator UI last.

## User Constraints

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Sync Pull Endpoint & Revision Model (auto-accepted)**
- New `users.vault_revision INTEGER NOT NULL DEFAULT 0` column: a single per-user monotonic counter, incremented in the same SQL statement as every item/folder create/update/delete (no separate round trip, no race window — same optimistic-single-statement pattern Phase 2 already uses for item `revision`).
- New endpoint `GET /api/sync?since=N` — cheap-check semantics: if `since == users.vault_revision`, respond `{revision: N}` with no item/folder arrays (the "cheap" part of SYNC-01); if stale, respond `{revision: N, items: [...], folders: [...]}` — a full snapshot (both collections), matching SYNC-01's explicit "no delta/CRDT" framing.
- Additive, not a replacement: existing `GET/POST /api/vault/items`, `PUT/DELETE /api/vault/items/{id}`, `GET/POST /api/vault/folders`, `DELETE /api/vault/folders/{id}` are untouched. `GET /sync` exists purely for the poll/catch-up/WS-triggered-refetch path; individual mutations still go through the existing CRUD endpoints (which is also what bumps `vault_revision`).
- Deletion detection: no tombstones, no `deleted_at` resurrection. The client diffs the full item/folder ID set returned by `GET /sync` against its current in-memory `items`/`folders` arrays — any local id absent from the new snapshot is inferred deleted. This is consistent with Phase 2's explicit choice to hard-delete (0003 migration dropped `deleted_at`) and with SYNC-01's full-snapshot-not-delta framing, so no schema change or new deferred-decision reversal is needed.
- `vault_revision` bump also covers folder mutations (folders currently have no per-row `revision` column and don't need one — only the global counter matters for the cheap check).

**WebSocket Push Channel — Transport & Fan-out (auto-accepted)**
- Endpoint: `GET /api/sync/ws` (axum `ws` feature — not yet enabled in `pv-server/Cargo.toml`, add it). Naming keeps close to `docs/ARCHITECTURE.md`'s original `/sync/stream` sketch while matching this phase's `/api/sync` REST sibling.
- Auth: WS upgrade requests can't carry a custom `Authorization` header from browser `WebSocket` API — token passed as a query param (`?token=<bearer>`), validated through the same session-hash lookup as `SessionUser` (existing extractor logic reused, not duplicated). Query-param tokens land in server logs/proxy access logs; acceptable for v0.1 (session tokens are already bearer-capability, short-TTL, revocable via Phase 3's `DELETE /api/sessions/{id}`) — flagged as a pre-v1.0 hardening candidate (e.g. first-message auth instead of query string) alongside the existing httpOnly-cookie carry-forward from Phase 2.
- Fan-out: in-process only — no Redis/pubsub (constraint: zero required external services). `AppState` gains a `sync_hub: Arc<Mutex<HashMap<user_id, tokio::sync::broadcast::Sender<SyncEvent>>>>` (or equivalent lazily-created-per-user broadcast channel); every mutating vault/folder handler publishes a `SyncEvent` after its DB write commits. Single-container/single-process axum instance makes in-process broadcast sufficient — revisit only if the architecture ever goes multi-process.
- Message schema: `{entity_type: "item"|"folder", id: string, revision: number, change_type: "create"|"update"|"delete"}` — metadata only, matching SYNC-02's literal contract; a traffic-inspection test (WS frames captured during a mutation) asserts no ciphertext field ever appears. No self-exclusion of the originating connection: broadcast goes to every open WS connection for that `user_id` (including the tab/session that made the change) — the sender already has the fresh state locally, so its own echo triggers a same-revision `GET /sync` that is a cheap no-op, not a bug worth the complexity of connection-id tracking.
- Client reconnect: exponential backoff (e.g. 1s → 2s → 4s… capped ~30s) on WS drop; on every successful (re)connect, the client fires one `GET /sync?since=<lastKnownRevision>` catch-up pull, since WS is a *notification* channel only — missed messages during a disconnect window are self-healing because the pull is the source of truth, not the push.
- Polling fallback: regardless of WS connection state, the client also polls `GET /sync?since=<lastKnownRevision>` on a fixed interval (~30s) whenever the vault is unlocked. This is belt-and-suspenders against reverse-proxy WS misconfiguration (a documented risk explicitly deferred to Phase 7's nginx/Caddy reference config) — sync must not go silently dead just because a self-hoster's proxy doesn't forward `Upgrade` headers correctly.
- Sync (WS connect + poll timer) runs only while the vault is unlocked; on lock, the WS closes and the poll timer stops (mirrors Phase 2's existing "no plaintext work while locked" pattern — `loadAndDecryptAll` already only fires on unlock).

**Conflict Resolution & Deletion Semantics (auto-accepted)**
- Per-item LWW via the existing `revision` column and optimistic-concurrency `PUT` (Phase 2, unchanged): the write that supplies a stale `expected_revision` gets a 409, exactly as today. This phase's job is making that conflict *visible* across devices proactively, not just reactively at save-time.
- Background list refresh: on a WS push or poll tick that reveals a changed `vault_revision`, the client re-pulls via `GET /sync`, re-decrypts, and merges into the `items`/`folders` store silently (list view updates live) — same trust model as Phase 2's `loadAndDecryptAll`, just triggered by a new event source instead of only by unlock.
- Remote-delete-while-viewing: if the item currently open in `DetailPanel` gets removed from the incoming snapshot (id no longer present), the panel closes and a toast explains it was deleted on another device — never leaves a phantom detail view pointing at nothing.

**Client UX: Live-Edit Conflict & Sync Indicator (auto-accepted; VISUAL/UX TASTE FLAGGED FOR MORNING REVIEW)**
- Remote-edit-while-editing: if a WS/poll signal reveals a changed revision for the item currently open in `DetailPanel`'s *edit* mode, the client does NOT silently overwrite in-progress form state (would clobber unsaved typing). Instead show a small inline banner in the detail panel — "Ten element zmienił się na innym urządzeniu" / "This item changed on another device" — with a manual "refresh" action, matching Phase 2's existing `RevisionConflictError` message tone (T-02-22) but shown proactively instead of only on save-conflict.
- Sync status indicator: a minimal, unobtrusive presence indicator (small dot/pulse in `TopBar`, near where a future health-dot placeholder already lives per Phase 2's UI notes) rather than a chatty banner or toast-per-change — datafa.st's understated aesthetic, security-adjacent UI stays legible and calm. Exact treatment (color states for connected/reconnecting/offline, tooltip copy) left to the planner within `docs/UI-DESIGN.md` tokens.
- i18n PL+EN for every new string (established Phase 2 convention, reaffirmed Phase 3).

### Claude's Discretion
- Exact `SyncEvent` Rust type shape, `sync_hub` data structure/cleanup strategy (e.g., dropping empty broadcast channels when no subscribers), migration numbering, error taxonomy for the WS handshake, poll-interval/backoff constants beyond the ballpark figures above.
- Whether `GET /sync`'s full-snapshot item/folder shape exactly mirrors `GET /api/vault/items`/`/folders`' existing row shape or is a thin combined wrapper — planner's call, minimize duplication.
- Test structure: axum integration tests for `/api/sync` and the WS handshake in `crates/pv-server/tests/`, vitest for the client reconnect/backoff/merge logic — following existing per-phase conventions.

### Deferred Ideas (OUT OF SCOPE)
- Redis/external pubsub for multi-process fan-out — not needed at single-container scale; revisit only if the deployment model ever changes (would contradict the "1 container, no required external services" constraint anyway).
- WS auth hardening (first-message auth instead of query-param token) — pre-v1.0 hardening bucket, alongside the httpOnly-cookie session revisit carried forward from Phase 2.
- Tombstone/soft-delete table for true delta sync — deferred with soft-delete itself (Phase 2); full-snapshot diffing avoids needing it for v0.1.
- Cross-device "who else is viewing this item" presence UI — no requirement drives it (SYNC-01/02/03 don't ask for live cursors/presence); explicitly out of scope, not just unaddressed.
- WS-behind-reverse-proxy end-to-end verification — Phase 7's documented nginx/Caddy reference config is where this gets proven for real; this phase only needs the polling fallback to exist so Phase 7 isn't a blocker for basic sync correctness.
</user_constraints>

## Phase Requirements

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | Klient synchronizuje vault przez revision-gated full-snapshot pull (`GET /sync` z tanim revision-checkiem — bez delty/CRDT) | Architecture Patterns Pattern 1 (`vault_revision` cheap-check endpoint), Code Examples §1-2, verified single-statement RETURNING pattern (Pattern 3, reused from 02-RESEARCH.md) |
| SYNC-02 | Serwer pushuje przez WebSocket wyłącznie metadane zmian `{item_id, revision, change_type}` (nigdy ciphertext); klient reaguje normalnym pullem | Architecture Patterns Pattern 2 (WS push + `sync_hub` broadcast), Code Examples §3-5, Security Domain (ciphertext-leak STRIDE row + traffic-inspection test requirement) |
| SYNC-03 | Użytkownik może korzystać z vaulta na wielu urządzeniach jednocześnie; konflikty rozstrzygane per-item po rewizji | Architecture Patterns Pattern 3 (client merge/conflict-banner logic), Common Pitfalls 3 & 5, Validation Architecture requirements→test map |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Revision counter increment | API / Backend (SQLite) | — | Single source of truth for "did anything change"; must be atomic with the mutating write (same statement, no race window) |
| Cheap-check pull (`GET /sync`) | API / Backend | Browser / Client (poll timer) | Server owns the comparison (`since` vs `vault_revision`); client owns when/how often to ask |
| Change-notification push | API / Backend (WS handler + `sync_hub`) | Browser / Client (WS listener) | Server publishes metadata-only events after each commit; client treats them as a "go pull" trigger, never as the data itself |
| Full-snapshot payload | API / Backend | Browser / Client (decrypt + merge) | Server returns encrypted blobs only; all decryption and diffing happens client-side (zero-knowledge boundary) |
| Conflict detection | API / Backend (409 on stale `expected_revision`) | Browser / Client (live-edit banner) | Server is authoritative for "is this revision current"; client is responsible for surfacing it before the user loses work |
| Reconnect/backoff | Browser / Client | — | Pure client-side resilience concern; server has no notion of "this client is reconnecting" |
| Sync status indicator | Browser / Client | — | Presentation-only; derives from client-side WS `readyState` + last successful pull timestamp |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| axum (`ws` feature) | 0.8.9 (already pinned; add `features = ["ws"]`) | WebSocket upgrade handler, `Message` enum, `WebSocketUpgrade`/`WebSocket` types | Already the project's HTTP framework; the `ws` feature is axum's own first-party WebSocket support (no separate crate needed on the server side) `[VERIFIED: docs.rs axum 0.8.9]` |
| `tokio::sync::broadcast` | part of `tokio` 1.52.3 (already a dependency, no Cargo.toml change) | In-process multi-consumer pub/sub for the per-user `sync_hub` fan-out | Standard-library-adjacent primitive for exactly this "N subscribers, 1 producer, all get every message" shape; zero new dependency `[VERIFIED: docs.rs tokio 1.52.3]` |
| Browser `WebSocket` API | native | Client-side WS connection, reconnect loop | No client library needed — the message shape is one small JSON object; a hand-rolled reconnect/backoff loop is ~40 lines and avoids a new npm dependency for a single-purpose channel |

### Supporting (dev/test only)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `tokio-tungstenite` | 0.30.0 | WS client for `pv-server` integration tests (connects to a real `TcpListener` to drive the `/api/sync/ws` handshake) | `[dev-dependencies]` only — `tower::ServiceExt::oneshot()` cannot perform an HTTP Upgrade handshake, so a real socket + real client is required to test the WS route at all (see Common Pitfalls 2) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tokio::sync::broadcast` per-user hub | `tokio::sync::mpsc` fan-out to a manually-tracked `Vec<Sender>` per connection | `broadcast` already solves "every subscriber gets every message, lagging subscribers get `Lagged` not silently dropped" — reimplementing that with `mpsc` is strictly more code for the same guarantee |
| Native browser `WebSocket` | `socket.io-client` / `reconnecting-websocket` (npm) | Both add real value (auto-reconnect built in) but this channel carries exactly one message shape and the phase's own decisions already spec custom backoff timing — a 40-line hand-rolled client is simpler to audit for the zero-knowledge/no-ciphertext-leak guarantee than auditing a third-party library's internals |
| axum's built-in `ws` feature | `tokio-tungstenite` directly wired into axum via `hyper::upgrade` | axum's `ws` feature already wraps this exact integration (it uses `tokio-tungstenite`'s protocol layer internally) — using it directly would be reimplementing what the framework already ships |

**Installation:**
```bash
# crates/pv-server/Cargo.toml — dependencies section
# axum = { version = "0.8", features = ["ws"] }   (edit existing line, don't add a duplicate)

# crates/pv-server/Cargo.toml — dev-dependencies section
# tokio-tungstenite = "0.30"

cargo build -p pv-server   # pulls in tokio-tungstenite (protocol codec) transitively via axum's ws feature already; the dev-dep adds the *client* half for tests
```

**Version verification:** `axum` and `tokio` versions above are read directly from `Cargo.lock` (already pinned in this repo, not re-resolved). `tokio-tungstenite` version confirmed via `cargo search tokio-tungstenite` → `tokio-tungstenite = "0.30.0"` `[VERIFIED: crates.io registry, cargo search]`.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| tokio-tungstenite | crates.io | ~9 yrs (first published 2017-03-17) | 4,138,379/week | github.com/snapview/tokio-tungstenite | OK | Approved (dev-dependency only) |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

No other new external packages are introduced by this phase — axum's `ws` feature and `tokio::sync::broadcast` are both already-vendored/already-dependency-tree code, not new registry entries.

## Architecture Patterns

### System Architecture Diagram

```text
                     ┌─────────────────────────────────────────────┐
                     │              Browser tab (client)             │
                     │                                                │
  vault mutation ──▶ │  store.ts: createVaultItem/updateVaultItem/   │
  (existing Phase 2  │  deleteVaultItem   ──▶  existing CRUD calls   │──┐
   CRUD flow)        │                                                │  │
                     │  new: sync poll timer (~30s, unlock-gated)     │  │  POST/PUT/DELETE
                     │  new: WS client (connect on unlock, backoff    │  │  /api/vault/items|folders
                     │       reconnect, catch-up pull on (re)connect) │  │
                     └───────────────┬───────────────┬───────────────┘  │
                                     │ GET /api/sync?  │ WS connect       │
                                     │ since=N         │ ?token=<bearer>  │
                                     ▼                 ▼                 ▼
                     ┌─────────────────────────────────────────────────────┐
                     │                    pv-server (axum)                  │
                     │                                                       │
                     │  GET /api/sync ──▶ compare since vs users.vault_revision
                     │       │                 │                             │
                     │       │ equal            │ stale                      │
                     │       ▼                  ▼                            │
                     │  {revision:N}      {revision:N, items:[...],          │
                     │  (cheap, no body)   folders:[...]}  (full snapshot)   │
                     │                                                       │
                     │  GET /api/sync/ws ──▶ upgrade ──▶ subscribe to        │
                     │       (SessionUser via ?token=)   sync_hub[user_id]   │
                     │                                        │              │
                     │  existing item/folder handlers ────────┘              │
                     │  (create/update/delete) ──▶ 1. UPDATE ... RETURNING   │
                     │                              (bumps vault_revision    │
                     │                               same statement)         │
                     │                           ──▶ 2. sync_hub.publish(    │
                     │                              SyncEvent{...}) — best-  │
                     │                              effort, ignores          │
                     │                              zero-receiver Err        │
                     └───────────────────────────┬───────────────────────────┘
                                                  │
                                                  ▼
                                         SQLite (users.vault_revision,
                                         vault_items.revision, folders)
```

Primary use case trace: Device A edits an item → `PUT /api/vault/items/{id}` bumps `vault_items.revision` *and* `users.vault_revision` in one statement → handler publishes `SyncEvent{entity_type:"item", id, revision, change_type:"update"}` to `sync_hub[user_id]` → Device B's open WS connection receives the metadata-only frame → Device B's client fires `GET /api/sync?since=<its lastKnownRevision>` → server sees `since < vault_revision`, returns the full item/folder snapshot → Device B decrypts client-side and merges into `store.ts`.

### Recommended Project Structure
```
crates/pv-server/
├── migrations/
│   └── 0007_vault_revision.sql       # users.vault_revision column
├── src/
│   ├── lib.rs                        # AppState gains sync_hub field
│   └── routes/
│       ├── sync.rs                   # NEW: GET /api/sync, GET /api/sync/ws, SyncEvent, sync_hub helpers
│       ├── vault.rs                  # create/update/delete gain vault_revision bump + sync_hub publish
│       └── folders.rs                # create/delete gain vault_revision bump + sync_hub publish
└── tests/
    └── sync.rs                       # NEW: pull-endpoint integration tests + real-socket WS test

web/src/
├── lib/vault/
│   ├── sync.ts                       # NEW: WS client, reconnect/backoff, poll timer, catch-up pull
│   ├── syncStatus.ts                 # NEW: connection-state singleton (mirrors lib/crypto lock-state shape)
│   ├── api.ts                        # gains getSyncSnapshot(since) client
│   └── store.ts                      # gains mergeSyncSnapshot(), wires sync.ts into subscribeLockState
└── components/
    ├── shell/TopBar.tsx              # gains sync status dot
    └── vault/DetailPanel.tsx         # gains live-edit-conflict banner
```

### Pattern 1: Revision-gated cheap-check pull endpoint

**What:** `GET /api/sync?since=N` compares the client's last-known `vault_revision` against the server's current value in one query; only fetches and returns full item/folder rows if they differ.

**When to use:** Every poll tick and every WS-triggered catch-up pull — this is the *only* data-fetching path this phase introduces (WS never carries data itself, per SYNC-02).

**Example:**
```rust
// Source: derived from vault.rs's own single-statement optimistic-concurrency
// idiom (Pattern 3 below), applied to a read-then-conditionally-fetch shape.
// crates/pv-server/src/routes/sync.rs
use axum::{extract::{Query, State}, Json};
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Deserialize)]
pub struct SyncQuery {
    since: i64,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum SyncResponse {
    UpToDate { revision: i64 },
    Snapshot { revision: i64, items: Vec<super::vault::VaultItem>, folders: Vec<super::folders::FolderRecord> },
}

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

    // Reuse the exact same SELECTs vault::list / folders::list already run —
    // extract their query bodies into a shared helper rather than duplicating.
    let items = super::vault::fetch_items_for(&state.db, &session.user_id).await?;
    let folders = super::folders::fetch_folders_for(&state.db, &session.user_id).await?;
    Ok(Json(SyncResponse::Snapshot { revision, items, folders }))
}
```
`[CITED: derived from project's own Pattern 3 idiom, not an external source]`

### Pattern 2: Atomic revision bump + best-effort WS publish

**What:** Every mutating vault/folder handler's existing `UPDATE ... RETURNING` (or `INSERT ... RETURNING`) gains a `users.vault_revision = vault_revision + 1` clause in the *same* transaction/statement pairing already used for the row's own `revision`, then publishes a `SyncEvent` — a fire-and-forget call whose `Err` (zero subscribers) is deliberately swallowed.

**When to use:** `vault::create`, `vault::update`, `vault::delete`, `folders::create`, `folders::delete` — every mutation SYNC-01/02 must observe.

**Example:**
```rust
// crates/pv-server/src/routes/vault.rs — update(), extended
let result = sqlx::query(
    "UPDATE vault_items SET enc_key = ?, enc_data = ?, revision = revision + 1, updated_at = datetime('now') \
     WHERE id = ? AND user_id = ? AND revision = ? \
     RETURNING updated_at, revision",
)
// ... same binds as today ...
.fetch_optional(&state.db)
.await?;

// Separate statement (SQLite has no multi-table single-UPDATE syntax) but
// still inside the same connection-pool checkout, immediately after the
// item row's own commit succeeds — no user-visible race window because
// vault_revision is *derived* state (a change counter), not a value any
// client-side invariant depends on being exactly synchronized to the ms.
let new_global_rev: i64 = sqlx::query_scalar(
    "UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision",
)
.bind(&session.user_id)
.fetch_one(&state.db)
.await?;

state.sync_hub.publish(&session.user_id, SyncEvent {
    entity_type: EntityType::Item,
    id: id.clone(),
    revision: new_item_revision,
    change_type: ChangeType::Update,
});
// publish() internally does: if let Err(_) = sender.send(event) { /* no
// subscribers right now — expected, not an error; poll fallback covers it */ }
```
`[VERIFIED: tokio::sync::broadcast::Sender::send() returns Err(SendError) only when zero receivers are subscribed — docs.rs tokio 1.52.3, cross-checked WebSearch]`

### Pattern 3: WebSocket auth via query param + `sync_hub` subscribe

**What:** `GET /api/sync/ws` validates the `?token=` query param against `sessions.token_hash` (same hash lookup as `SessionUser`, reused not duplicated) before upgrading, then subscribes the new connection to that user's broadcast channel and forwards every event as a JSON text frame until the socket closes.

**When to use:** The single WS route this phase adds.

**Example:**
```rust
// crates/pv-server/src/routes/sync.rs
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;

#[derive(serde::Deserialize)]
pub struct WsAuthQuery {
    token: String,
}

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(auth): Query<WsAuthQuery>,
) -> Result<Response, ApiError> {
    // Reuses the SAME hash-lookup logic as SessionUser's FromRequestParts
    // impl — factor session.rs's row lookup into a shared
    // `validate_token(&pool, &token) -> Result<String /* user_id */, ApiError>`
    // helper both SessionUser and this handler call, so there is exactly one
    // place session-token validation lives.
    let user_id = crate::routes::session::validate_token(&state.db, &auth.token).await?;
    Ok(ws.on_upgrade(move |socket| handle_socket(socket, state, user_id)))
}

async fn handle_socket(mut socket: WebSocket, state: AppState, user_id: String) {
    let mut rx = state.sync_hub.subscribe(&user_id);
    loop {
        tokio::select! {
            event = rx.recv() => match event {
                Ok(ev) => {
                    let Ok(json) = serde_json::to_string(&ev) else { continue };
                    if socket.send(Message::Text(json.into())).await.is_err() {
                        break; // client disconnected
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue, // catch-up pull will fix state
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            },
            msg = socket.recv() => match msg {
                Some(Ok(Message::Close(_))) | None => break,
                _ => {} // client sends nothing meaningful; ignore
            }
        }
    }
}
```
`[CITED: axum 0.8.9 docs.rs extract::ws module — WebSocketUpgrade::on_upgrade, WebSocket::send/recv signatures]` `[VERIFIED: tokio::sync::broadcast::error::RecvError has Lagged and Closed variants — docs.rs tokio 1.52.3]`

**Query-param-before-upgrade ordering note:** `Query<T>` and `WebSocketUpgrade` are both `FromRequestParts` extractors (neither consumes the request body) — they can appear in either order in the handler signature; axum only requires the one `FromRequest` (body-consuming) extractor, if any, to be last. This project's handler above has no body extractor at all `[CITED: axum extractor ordering rules, general axum documentation]`.

### Pattern 4: Client reconnect/backoff + poll fallback (browser)

**What:** A module-singleton (same shape as `lib/crypto/index.ts`'s lock-state singleton) that owns one `WebSocket` instance, one `setInterval` poll timer, exponential backoff state, and the "last known revision" the client has merged.

**When to use:** Wired into `store.ts`'s existing `subscribeLockState` callback — start both on unlock, stop both on lock.

**Example:**
```typescript
// web/src/lib/vault/sync.ts
const POLL_INTERVAL_MS = 30_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

let ws: WebSocket | null = null;
let backoffMs = BACKOFF_START_MS;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connectWs(onEvent: (ev: SyncEvent) => void): void {
  const token = getSessionToken();
  if (token === null) return;
  const url = `${WS_BASE}/api/sync/ws?token=${encodeURIComponent(token)}`;
  ws = new WebSocket(url);
  ws.onopen = () => {
    backoffMs = BACKOFF_START_MS; // reset on success
    setSyncStatus("connected");
    void pullOnce(); // catch-up pull — WS is notification-only, pull is truth
  };
  ws.onmessage = (e) => onEvent(JSON.parse(e.data) as SyncEvent);
  ws.onclose = () => {
    setSyncStatus("reconnecting");
    reconnectTimer = setTimeout(() => connectWs(onEvent), backoffMs);
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  };
  ws.onerror = () => ws?.close(); // triggers onclose's backoff path
}

export function startSync(onEvent: (ev: SyncEvent) => void): void {
  connectWs(onEvent);
  pollTimer = setInterval(() => void pullOnce(), POLL_INTERVAL_MS);
}

export function stopSync(): void {
  ws?.close();
  ws = null;
  if (pollTimer) clearInterval(pollTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  setSyncStatus("offline");
}
```
`[CITED: standard browser WebSocket API + exponential-backoff idiom, general web platform documentation — no library-specific claim]`

### Anti-Patterns to Avoid
- **Treating WS as the data channel:** SYNC-02's contract is metadata-only; never add item/folder plaintext or ciphertext fields to `SyncEvent`. Enforce with a dedicated test that inspects raw WS frame bytes during a mutation.
- **Excluding the originating connection from broadcast:** CONTEXT.md explicitly rejects self-exclusion complexity — every open WS connection for a user gets every event, including the sender's own tab. Don't add connection-id tracking to "optimize" this away.
- **Propagating `SendError` from `sync_hub.publish()` as an HTTP error:** a user with zero open WS connections is the *normal* case (polling-only client, or between reconnects) — the mutation itself must still succeed and return 200/201/204 regardless of whether anyone was listening.
- **Testing the WS route with `oneshot()`:** the existing `tests/common/mod.rs` harness cannot exercise a WS upgrade at all (see Common Pitfalls 2) — don't discover this mid-plan.
- **Building the pull endpoint's item/folder fetch as raw duplicated SQL:** reuse (or factor out into a shared function) the exact SELECTs `vault::list`/`folders::list` already run, so the two response shapes (`GET /api/vault/items` and `GET /api/sync`'s snapshot arm) never drift.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Multi-consumer pub/sub with lag detection | A `Vec<mpsc::Sender>` you manually prune on disconnect, with your own "did this subscriber fall behind" tracking | `tokio::sync::broadcast::channel` | `broadcast` already implements bounded-capacity ring-buffer semantics with an explicit `Lagged(n)` signal instead of silently dropping or unboundedly growing memory — reimplementing this is strictly worse for the same LOC |
| WebSocket protocol framing/handshake | Manual `Sec-WebSocket-Accept` header computation, frame parsing | axum's `ws` feature (wraps `tokio-tungstenite` internally) | RFC 6455 framing is fiddly (masking, fragmentation, control frames) — this is exactly the kind of protocol-correctness problem a first-party framework feature exists to remove |
| Exponential backoff with jitter-free caps | A hand-tuned recursive `setTimeout` retry counter | The ~6-line doubling-with-cap idiom shown in Pattern 4 | Not complex enough to warrant a library (`p-retry` etc. would be overkill for one WS connection), but *do* use the standard doubling-with-max-cap shape rather than inventing a novel curve |

**Key insight:** This phase's actual complexity is not in any individual primitive (broadcast channels and WS upgrades are both well-trodden axum/tokio idioms) — it's in the *cross-cutting invariant* that the WS channel must never leak ciphertext even indirectly (e.g., via an error message that echoes back part of a request body). Every new code path touching `SyncEvent` should be reviewed against that single invariant rather than against generic WS best practices.

## Common Pitfalls

### Pitfall 1: `vault_revision` bump race between two rapid mutations on different items

**What goes wrong:** If the `UPDATE users SET vault_revision = vault_revision + 1 ... RETURNING` isn't itself atomic (e.g., split into a SELECT-then-UPDATE), two near-simultaneous mutations from different devices could read the same starting `vault_revision` and both write `N+1`, silently losing one increment.

**Why it happens:** SQLite serializes writes at the connection/transaction level, but only if the increment is expressed as a single `UPDATE ... SET x = x + 1` statement (which is safe — SQLite evaluates the right-hand side against the row's current value under the write lock) — a naive `SELECT vault_revision; ...; UPDATE ... SET vault_revision = ?` (parameterized with the previously-read value) reintroduces exactly the TOCTOU race Phase 2's Pattern 3 was designed to avoid for item `revision`.

**How to avoid:** Use `UPDATE users SET vault_revision = vault_revision + 1 WHERE id = ? RETURNING vault_revision` — never read-then-write the counter in two statements.

**Warning signs:** A test that fires two concurrent updates and asserts the final `vault_revision` is exactly `initial + 2` (not `initial + 1`) would catch this if it regresses.

### Pitfall 2: `oneshot()`-based integration tests cannot exercise the WS route

**What goes wrong:** `crates/pv-server/tests/common/mod.rs`'s `test_app()` + `tower::ServiceExt::oneshot()` pattern (used by every existing `tests/vault.rs`/`tests/auth.rs` test) sends one `Request` through the router and awaits one `Response` — it never performs a real HTTP `Upgrade: websocket` handshake over a real socket, so `WebSocketUpgrade` extraction will either fail or hang depending on how the test is written.

**Why it happens:** WebSocket upgrade is fundamentally a connection-level protocol switch (HTTP/1.1 101 Switching Protocols, then raw framed bytes over the *same* TCP connection) — `oneshot()`'s in-memory `Service::call` model has no notion of "keep this connection open for bidirectional framed messages after the response headers."

**How to avoid:** For `tests/sync.rs`'s WS-specific tests, bind a real `tokio::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0))`, run `axum::serve(listener, app).into_future()` in a `tokio::spawn`, then connect with `tokio_tungstenite::connect_async(&format!("ws://127.0.0.1:{port}/api/sync/ws?token={token}"))`. The pull-endpoint (`GET /api/sync`) tests have no such constraint and can keep using the existing `oneshot()` harness unchanged.

**Warning signs:** A WS test written against `oneshot()` that either panics with an upgrade-related error or hangs indefinitely waiting for a message that will never arrive.

### Pitfall 3: Self-originated WS echo triggering a wasted decrypt-and-diff cycle

**What goes wrong:** Since the server broadcasts to *every* open connection for a user (including the one that made the change, per the locked no-self-exclusion decision), the originating tab's own `onmessage` handler fires for its own edit, triggering a full `GET /api/sync` → decrypt → merge cycle for data that tab already has fresh in memory.

**Why it happens:** Deliberate simplicity tradeoff (CONTEXT.md explicitly accepts this cost to avoid connection-id tracking complexity).

**How to avoid:** Nothing to "avoid" here — this is accepted behavior. The mitigation is making sure the `since === revision` cheap-check path is genuinely cheap (single indexed lookup, no item/folder fetch) so the wasted round trip costs one small HTTP request, not a full snapshot fetch. Verify this in a test: after a self-triggered pull where `since` already equals the current revision, assert the response has no `items`/`folders` fields.

**Warning signs:** A test or manual trace showing the originating tab fetching a full item/folder array on every single one of its own edits (a sign the "already fresh" fast path isn't actually being hit).

### Pitfall 4: Reconnect storm amplifying poll load

**What goes wrong:** If many tabs/devices all hit a WS drop simultaneously (e.g., a brief reverse-proxy restart) and all start their backoff from the same fixed schedule (1s, 2s, 4s...) with no jitter, they can all retry in lockstep, creating synchronized load spikes on `pv-server`.

**Why it happens:** Deterministic backoff without jitter is a well-known thundering-herd source.

**How to avoid:** At single-container-self-hosted scale (this project's stated audience) this risk is low — a handful of devices per user, not thousands of clients. CONTEXT.md's ballpark figures don't mandate jitter, and adding it is a cheap, low-risk addition (`backoffMs * (0.5 + Math.random())`) the planner may include at its discretion without contradicting any locked decision.

**Warning signs:** Not a near-term concern for this project's scale; flagged for awareness only, not a blocking requirement.

### Pitfall 5: Live-edit banner clobbering in-progress typing on a false-positive trigger

**What goes wrong:** If the "item changed elsewhere" banner logic compares against the wrong baseline revision (e.g., the revision at panel-open time vs. the revision the in-progress edit's `expected_revision` would use), the banner could fire even when the *only* changed item is a different one, or fail to fire on a genuine conflict.

**Why it happens:** `DetailPanel`'s edit mode already tracks `item.revision` as its `currentRevision` baseline (Phase 2's `updateVaultItem(id, fields, currentRevision)` signature) — the new proactive banner must compare incoming `SyncEvent.id === item.id && SyncEvent.revision !== item.revision` (or the merged snapshot's row for that id), not just "any sync event fired while editing."

**How to avoid:** Gate the banner strictly on `entity_type === "item" && id === currentlyEditingItemId`, reusing the exact same revision-comparison the 409-path already performs — don't introduce a second, parallel notion of "is this item stale."

**Warning signs:** A vitest case editing item A while a `SyncEvent` for unrelated item B arrives — banner must NOT show.

## Code Examples

Verified patterns from official sources:

### axum `ws` feature — enabling and core types
```toml
# crates/pv-server/Cargo.toml
axum = { version = "0.8", features = ["ws"] }
```
```rust
// Source: docs.rs axum 0.8.9, axum::extract::ws module
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};

async fn handler(ws: WebSocketUpgrade) -> axum::response::Response {
    ws.on_upgrade(|socket: WebSocket| async move {
        // socket.recv() -> Option<Result<Message>>
        // socket.send(msg) -> Result<()>
        // socket.split() -> (SplitSink, SplitStream) for concurrent read/write
    })
}
```
`[VERIFIED: docs.rs axum 0.8.9 extract::ws]`

### tokio broadcast channel — creation and zero-receiver behavior
```rust
// Source: docs.rs tokio 1.52.3, tokio::sync::broadcast module
use tokio::sync::broadcast;

let (tx, mut rx1) = broadcast::channel::<SyncEvent>(16); // capacity 16
let rx2 = tx.subscribe(); // additional subscriber, sees only future sends

match tx.send(event) {
    Ok(n) => { /* delivered to n active receivers */ }
    Err(broadcast::error::SendError(_returned_event)) => {
        // zero receivers currently subscribed — expected when a user has
        // no open WS tabs; the value is returned so it can be logged/dropped
    }
}
```
`[VERIFIED: docs.rs tokio 1.52.3 sync::broadcast — send() returns Result, Err only on zero receivers, error carries the un-sent value]`

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `docs/ARCHITECTURE.md`'s original sketch: `GET/PUT /sync` delta-based endpoint, WS `/sync/stream`, `deleted_at`-based tombstones | This phase's locked decisions: `GET /sync` full-snapshot (no delta/CRDT), `GET /api/sync/ws`, ID-set-diffing for deletion (no tombstones) | Phase 2 (dropped `deleted_at`) + this phase's CONTEXT.md (explicit full-snapshot framing) | Simpler server logic (no delta computation, no tombstone garbage collection) at the cost of a larger payload per stale-sync pull — acceptable at expected vault sizes (tens to low-hundreds of items for a personal/family vault) |

**Deprecated/outdated:**
- Nothing external is deprecated here — this is a greenfield feature. The only "supersession" is internal: this phase's CONTEXT.md decisions supersede `docs/ARCHITECTURE.md`'s older sketch for Phase 5 (that doc itself is not updated by this research; a later `/gsd-docs-update` pass can reconcile it).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `Query<T>` and `WebSocketUpgrade` extractor ordering is unconstrained (both `FromRequestParts`, neither consumes the body) | Architecture Patterns, Pattern 3 | Low — if axum actually requires a specific order, the code simply fails to compile at plan-execution time and the planner/executor reorders the extractors; no runtime/security impact either way |
| A2 | No jitter is strictly required for the reconnect backoff at this project's self-hosted single-family scale | Common Pitfalls 4 | Low — worst case is a minor, self-resolving load spike on reconnect after a proxy restart; not a correctness or security issue |

**If this table is empty:** N/A — two low-risk items above; neither blocks planning.

## Open Questions (RESOLVED)

1. **Does `GET /api/sync`'s snapshot arm duplicate `vault::list`/`folders::list`'s SQL, or share it?**
   - What we know: CONTEXT.md explicitly leaves this to "planner's call, minimize duplication."
   - What's unclear: N/A — this is a code-organization choice, not a technical unknown.
   - Resolution: Factor the row-fetch SQL (not the axum handler signature) into `pub(crate)` helper functions in `vault.rs`/`folders.rs` (e.g. `fetch_items_for(pool, user_id)`) that both the existing list handlers and the new sync handler call. This keeps one SQL source of truth per table while letting each caller wrap it in its own response envelope.

2. **Where does `sync_hub` cleanup (dropping empty per-user broadcast channels) happen?**
   - What we know: CONTEXT.md flags this as discretionary; `tokio::sync::broadcast::Sender` has a `receiver_count()` method that reports current subscriber count.
   - What's unclear: Whether to proactively prune on every disconnect or let entries accumulate (bounded by total registered users, not connections — acceptable at this project's scale).
   - Resolution: Prune lazily — when a WS connection closes (in `handle_socket`'s loop-exit path), check `sender.receiver_count() == 0` and if so remove that user's entry from the `sync_hub` map under the mutex. This bounds memory to "currently-or-recently-connected users" without needing a background sweep task. Given the sub-second cost of recreating a channel on next connect, this is not a hot path requiring further optimization.

3. **Does the WS handshake's query-param token need a *separate* rate-limit/lockout from the existing REST auth surface?**
   - What we know: The token is the same bearer session token already validated on every REST call; no new secret is introduced.
   - What's unclear: Whether repeated failed WS upgrade attempts (invalid/expired token) need throttling beyond what already exists (nothing currently rate-limits REST auth failures either, per Phase 2/3's scope).
   - Resolution: Out of scope for this phase — matches the existing REST endpoints' unthrottled-auth-failure posture project-wide. Not a regression introduced by this phase; a project-wide rate-limiting pass (if ever done) would cover both surfaces together.

4. **Migration number for `users.vault_revision`?**
   - What we know: Latest existing migration is `0006_webauthn_states.sql`.
   - Resolution: `0007_vault_revision.sql`, additive `ALTER TABLE users ADD COLUMN vault_revision INTEGER NOT NULL DEFAULT 0` (SQLite supports `ADD COLUMN` with a constant default with no rebuild needed — same additive shape as migration `0005`, not the DROP+CREATE shape `0003`/`0004` needed for CHECK-constrained columns).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| axum `ws` feature | WS upgrade handler | Not yet enabled — requires a one-line Cargo.toml feature-flag addition | axum 0.8.9 (already pinned) | None needed — this is a build-time feature flag, not an external service; enabling it is part of this phase's own scope |
| tokio-tungstenite | WS integration test client (dev-only) | Not yet a dependency | 0.30.0 (verified on crates.io) | None needed — required for the WS test to exist at all; if omitted, WS route ships with zero automated test coverage (unacceptable per Nyquist validation below) |
| Browser `WebSocket` API | Client-side WS connection | ✓ (native, all evergreen browsers + this project's supported target set) | — | Polling fallback (already locked-decision, belt-and-suspenders) covers any environment where WS is blocked (corporate proxy, misconfigured reverse proxy) |

**Missing dependencies with no fallback:** none — both new build-time additions (axum `ws` feature, `tokio-tungstenite` dev-dep) are part of this phase's own implementation scope, not external environment prerequisites.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (server) | `cargo test` — axum integration tests via `tower::ServiceExt::oneshot()` (existing pattern) + real-socket tests via `tokio::net::TcpListener` + `tokio-tungstenite` (new, WS-only) |
| Framework (client) | Vitest 3.2.4 (existing `web/vitest.config.ts`) |
| Config file | `crates/pv-server/Cargo.toml` (test harness), `web/vitest.config.ts` (existing, no change needed) |
| Quick run command | `cargo test -p pv-server sync::` / `npm run test -- sync` (or vitest's file-scoped invocation) |
| Full suite command | `cargo test --workspace` / `npm test` (existing project-wide commands) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SYNC-01 | `GET /api/sync?since=N` returns `{revision}` only when `since == vault_revision` | integration | `cargo test -p pv-server --test sync pull_up_to_date_returns_no_body` | ❌ Wave 0 |
| SYNC-01 | `GET /api/sync?since=N` returns full item+folder snapshot when stale | integration | `cargo test -p pv-server --test sync pull_stale_returns_full_snapshot` | ❌ Wave 0 |
| SYNC-01 | Item/folder mutation atomically bumps `users.vault_revision` in the same statement as the row's own revision | integration | `cargo test -p pv-server --test sync mutation_bumps_vault_revision` | ❌ Wave 0 |
| SYNC-01 | Deletion is detected client-side via ID-set diff against snapshot (no tombstone) | unit (vitest) | `npm test -- sync.test.ts -t "detects deletion via missing id"` | ❌ Wave 0 |
| SYNC-02 | WS frame for a mutation contains only `{entity_type, id, revision, change_type}` — no ciphertext field present | integration (traffic inspection) | `cargo test -p pv-server --test sync ws_event_contains_no_ciphertext` | ❌ Wave 0 |
| SYNC-02 | WS connection without a valid `?token=` is rejected (upgrade fails or immediate close) | integration | `cargo test -p pv-server --test sync ws_rejects_invalid_token` | ❌ Wave 0 |
| SYNC-02 | Client reconnects with exponential backoff after a WS drop and fires a catch-up pull on reconnect | unit (vitest, mocked WebSocket) | `npm test -- sync.test.ts -t "reconnects with backoff and catch-up pulls"` | ❌ Wave 0 |
| SYNC-03 | Stale `expected_revision` on `PUT /api/vault/items/{id}` still returns 409 (regression guard — behavior unchanged from Phase 2) | integration | `cargo test -p pv-server --test vault update_with_stale_revision_is_conflict_and_blob_unchanged` | ✅ (existing Phase 2 test) |
| SYNC-03 | Live-edit banner shows only when the currently-open-for-edit item's own revision changes, not for unrelated items | unit (vitest) | `npm test -- DetailPanel.test.tsx -t "shows live-edit banner only for the open item"` | ❌ Wave 0 |
| SYNC-03 | Remote delete of the item open in `DetailPanel` closes the panel and shows a toast | unit (vitest) | `npm test -- DetailPanel.test.tsx -t "closes and toasts on remote delete of open item"` | ❌ Wave 0 |
| SYNC-03 | Background sync merge (WS or poll trigger) updates the list view without disrupting an unrelated in-progress edit | unit (vitest) | `npm test -- store.test.ts -t "merges snapshot without clobbering unrelated edit"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cargo test -p pv-server --test sync` (server tasks) / `npm test -- sync` or `npm test -- store` (client tasks)
- **Per wave merge:** `cargo test --workspace` and `npm test` (full suites)
- **Phase gate:** Full suite green (`cargo test --workspace && npm test`) before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `crates/pv-server/tests/sync.rs` — new integration test file covering the pull endpoint (reuses existing `tests/common/mod.rs` harness) and the WS handshake (new real-socket harness — see Common Pitfalls 2)
- [ ] `crates/pv-server/tests/common/mod.rs` — extend with a `test_server()` helper that binds a real `TcpListener` + spawns `axum::serve`, returning the bound port, for WS-only tests to reuse (the existing `test_app()`/`oneshot()` helper stays as-is for REST tests)
- [ ] `web/src/lib/vault/sync.test.ts` — new vitest file for the WS client, reconnect/backoff, and poll-timer logic (mocked `WebSocket` global — the existing project has no established WS-mocking convention yet; `vi.stubGlobal("WebSocket", MockWebSocketClass)` is the standard vitest idiom)
- [ ] `web/src/components/vault/DetailPanel.test.tsx` — extend existing file with live-edit-banner and remote-delete-closes-panel cases
- [ ] Framework install: none — `tokio-tungstenite` dev-dependency addition to `Cargo.toml` covers the server-side gap; vitest/mocking needs no new npm package (native `vi.stubGlobal`)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | WS upgrade validated against the same `sessions.token_hash` lookup as REST `SessionUser` — no separate/weaker auth path for the new surface |
| V3 Session Management | yes | Reuses existing session TTL/revocation (`DELETE /api/sessions/{id}` already invalidates the hash row a WS reconnect would fail against); no new session concept introduced |
| V4 Access Control | yes | `sync_hub` is keyed by `user_id` derived from the validated token — never trusts a client-supplied user id; a WS connection can only ever receive events for the authenticated user's own vault |
| V5 Input Validation | yes | `since` query param parsed as `i64` (axum's `Query` extractor rejects malformed input with 400 automatically); WS inbound frames are never parsed as commands in this phase's protocol (server only *sends*, client sends nothing meaningful — see Pattern 3) |
| V6 Cryptography | n/a | No new cryptographic primitives — this phase moves metadata and encrypted blobs already produced by pv-core; zero-knowledge boundary is a data-flow constraint (V14-adjacent), not a V6 crypto-implementation concern |
| V13 (API/WS-specific, ASVS 4.0's Config/API section) | yes | CORS layer already gates cross-origin REST (`routes/mod.rs`'s `cors_layer()`); WS upgrade requests should be checked for `Origin` header consistency in the same dev/prod-gated posture — flag for planner: verify axum's `ws` feature does or doesn't auto-enforce same-origin (it does NOT by default; browsers do enforce it for `WebSocket` connections from a page, but a non-browser client would not be so constrained) — acceptable at ASVS L1 given the token itself is the actual access control, not `Origin` |

### Known Threat Patterns for axum + WebSocket + tokio broadcast

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| Ciphertext or plaintext leaking into a `SyncEvent` frame (e.g., a debug `Debug`-derive on a type that includes an item's `enc_data`) | Information Disclosure | `SyncEvent` struct contains only `entity_type`, `id`, `revision`, `change_type` fields — no `Serialize`/`Debug` derive on any type that also holds ciphertext; a dedicated traffic-inspection test asserts the exact JSON key set on every WS frame during a real mutation |
| WS query-param token appearing in server access logs / reverse-proxy logs | Information Disclosure | Explicitly accepted risk per CONTEXT.md (session tokens are short-TTL, revocable, bearer-capability already) — flagged as pre-v1.0 hardening (first-message auth instead of query string), not blocking for this phase |
| Cross-user event leakage (`sync_hub` delivering user A's `SyncEvent` to user B's connection) | Spoofing / Elevation of Privilege | `sync_hub` keyed strictly by the server-validated `user_id` from the token lookup — a connection can only ever `subscribe()` to its own key; test: two authenticated users' WS connections, mutate as user A, assert user B's socket receives nothing |
| Replayed/forged WS "close" or malformed frames used to probe the handler | Tampering | axum's `ws` feature (built on `tokio-tungstenite`'s protocol layer) handles RFC 6455 frame validation/masking — malformed frames are rejected at the protocol layer before reaching `handle_socket`'s application logic; no custom frame parsing is written in this phase |
| A stale/revoked session token still accepted for a long-lived WS connection after `DELETE /api/sessions/{id}` revokes it elsewhere | Elevation of Privilege (persistence past intended revocation) | Token is validated only at *upgrade* time (handshake), not per-message — a connection established before revocation stays open until it naturally closes/reconnects. Acceptable at ASVS L1 for v0.1 (same posture as any long-lived connection without per-message re-auth) but flag for planner: consider closing open WS connections proactively on session revoke as a stretch goal, not a blocking requirement (out of SYNC-01/02/03's literal scope) |
| Resource exhaustion via unbounded WS connections per user (no connection-count cap) | Denial of Service | Not addressed by this phase's locked decisions (no cap specified); acceptable at this project's stated self-hosted/personal/family scale — flag as a discretionary, non-blocking addition if the planner wants a cheap `MAX_WS_CONNECTIONS_PER_USER` guard (mirrors the existing `MAX_ITEM_BLOB_BYTES` discretionary-limit pattern from Phase 2) |

## Sources

### Primary (HIGH confidence)
- `crates/pv-server/src/routes/vault.rs`, `folders.rs`, `session.rs`, `lib.rs`, `error.rs`, `routes/mod.rs` — existing codebase, read directly
- `crates/pv-server/tests/common/mod.rs`, `tests/vault.rs` — existing test harness conventions, read directly
- `web/src/lib/vault/store.ts`, `api.ts`, `web/src/lib/auth/api.ts`, `web/src/components/shell/TopBar.tsx`, `web/src/components/vault/DetailPanel.tsx` — existing codebase, read directly
- `Cargo.lock` — axum 0.8.9, tokio 1.52.3 pinned versions, read directly
- `cargo search tokio-tungstenite` — crates.io registry, confirms `tokio-tungstenite = "0.30.0"` exists and is current
- `gsd-tools query package-legitimacy check --ecosystem crates tokio-tungstenite` — OK verdict, 4.1M weekly downloads, 9-year-old crate, github.com/snapview/tokio-tungstenite source repo confirmed

### Secondary (MEDIUM confidence)
- docs.rs axum 0.8.9 `extract::ws` module (fetched via WebFetch) — `WebSocketUpgrade::on_upgrade`, `WebSocket::send`/`recv`/`split`, `ws` cargo feature name
- docs.rs tokio 1.52.3 `sync::broadcast` module (fetched via WebFetch + WebSearch cross-check) — `channel()`, `Sender::send`/`subscribe`, `Receiver::recv`, `RecvError::{Lagged, Closed}` variants, zero-receiver `SendError` behavior
- WebSearch: axum WebSocket testing pattern (real `TcpListener` + `axum::serve` + `tokio_tungstenite::connect_async`), cross-referencing the official `tokio-rs/axum` `examples/testing-websockets` repo path

### Tertiary (LOW confidence)
- WebSearch: axum `Query` + `WebSocketUpgrade` extractor-ordering discussion (GitHub Discussions #2061) — general community guidance, not an authoritative spec citation; flagged as A1 in the Assumptions Log

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — axum `ws` feature and `tokio::sync::broadcast` are both already-pinned dependency-tree code (no new server dependency beyond a feature flag); `tokio-tungstenite` verified via crates.io registry lookup and package-legitimacy gate
- Architecture: HIGH — every pattern is a direct extension of an already-shipped project convention (single-statement optimistic concurrency, module-singleton client stores, `SessionUser` extractor reuse)
- Pitfalls: HIGH for server-side (verified via docs.rs + codebase read), MEDIUM for client-side reconnect/jitter specifics (standard web-platform idiom, no single authoritative spec to cite)

**Research date:** 2026-07-14
**Valid until:** 2026-08-13 (30 days — axum/tokio are stable, slow-moving APIs; re-verify only if `Cargo.lock` pins change before planning starts)
