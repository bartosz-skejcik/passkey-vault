# Phase 5: Multi-Device Sync - Context

**Gathered:** 2026-07-14
**Status:** Ready for planning
**Mode:** Smart discuss, auto-accepted (autonomous overnight run — Bartek asleep, explicit authorization to decide; UX-taste items flagged for morning review)

<domain>
## Phase Boundary

A user's vault stays in sync across multiple simultaneously-active devices/sessions. Deliverables: a cheap revision-gated `GET /sync` endpoint returning a full snapshot only when something changed, a WebSocket push channel carrying metadata-only change notifications (never ciphertext), per-item revision-based conflict resolution made visible in the UI, and a polling fallback so sync degrades gracefully when WebSocket is blocked (self-hosted reverse-proxy audience). Depends only on Phase 2 (vault CRUD + revision column already exist); does not depend on Phase 3/4 (passkeys/PRF unlock) — sync works identically regardless of which unlock method got the vault open. Import/TOTP/onboarding (Phase 6) and Docker packaging (Phase 7, where WS-behind-reverse-proxy gets end-to-end tested) are out of scope here.

</domain>

<decisions>
## Implementation Decisions

### Sync Pull Endpoint & Revision Model (auto-accepted)
- New `users.vault_revision INTEGER NOT NULL DEFAULT 0` column: a single per-user monotonic counter, incremented in the same SQL statement as every item/folder create/update/delete (no separate round trip, no race window — same optimistic-single-statement pattern Phase 2 already uses for item `revision`).
- New endpoint `GET /api/sync?since=N` — cheap-check semantics: if `since == users.vault_revision`, respond `{revision: N}` with no item/folder arrays (the "cheap" part of SYNC-01); if stale, respond `{revision: N, items: [...], folders: [...]}` — a full snapshot (both collections), matching SYNC-01's explicit "no delta/CRDT" framing.
- Additive, not a replacement: existing `GET/POST /api/vault/items`, `PUT/DELETE /api/vault/items/{id}`, `GET/POST /api/vault/folders`, `DELETE /api/vault/folders/{id}` are untouched. `GET /sync` exists purely for the poll/catch-up/WS-triggered-refetch path; individual mutations still go through the existing CRUD endpoints (which is also what bumps `vault_revision`).
- Deletion detection: no tombstones, no `deleted_at` resurrection. The client diffs the full item/folder ID set returned by `GET /sync` against its current in-memory `items`/`folders` arrays — any local id absent from the new snapshot is inferred deleted. This is consistent with Phase 2's explicit choice to hard-delete (0003 migration dropped `deleted_at` — trash/soft-delete was deferred) and with SYNC-01's full-snapshot-not-delta framing, so no schema change or new deferred-decision reversal is needed.
- `vault_revision` bump also covers folder mutations (folders currently have no per-row `revision` column and don't need one — only the global counter matters for the cheap check).

### WebSocket Push Channel — Transport & Fan-out (auto-accepted)
- Endpoint: `GET /api/sync/ws` (axum `ws` feature — not yet enabled in `pv-server/Cargo.toml`, add it). Naming keeps close to `docs/ARCHITECTURE.md`'s original `/sync/stream` sketch while matching this phase's `/api/sync` REST sibling.
- Auth: WS upgrade requests can't carry a custom `Authorization` header from browser `WebSocket` API — token passed as a query param (`?token=<bearer>`), validated through the same session-hash lookup as `SessionUser` (existing extractor logic reused, not duplicated). Query-param tokens land in server logs/proxy access logs; acceptable for v0.1 (session tokens are already bearer-capability, short-TTL, revocable via Phase 3's `DELETE /api/sessions/{id}`) — flagged as a pre-v1.0 hardening candidate (e.g. first-message auth instead of query string) alongside the existing httpOnly-cookie carry-forward from Phase 2.
- Fan-out: in-process only — no Redis/pubsub (constraint: zero required external services). `AppState` gains a `sync_hub: Arc<Mutex<HashMap<user_id, tokio::sync::broadcast::Sender<SyncEvent>>>>` (or equivalent lazily-created-per-user broadcast channel); every mutating vault/folder handler publishes a `SyncEvent` after its DB write commits. Single-container/single-process axum instance makes in-process broadcast sufficient — revisit only if the architecture ever goes multi-process.
- Message schema: `{entity_type: "item"|"folder", id: string, revision: number, change_type: "create"|"update"|"delete"}` — metadata only, matching SYNC-02's literal contract; a traffic-inspection test (WS frames captured during a mutation) asserts no ciphertext field ever appears. No self-exclusion of the originating connection: broadcast goes to every open WS connection for that `user_id` (including the tab/session that made the change) — the sender already has the fresh state locally, so its own echo triggers a same-revision `GET /sync` that is a cheap no-op, not a bug worth the complexity of connection-id tracking.
- Client reconnect: exponential backoff (e.g. 1s → 2s → 4s… capped ~30s) on WS drop; on every successful (re)connect, the client fires one `GET /sync?since=<lastKnownRevision>` catch-up pull, since WS is a *notification* channel only — missed messages during a disconnect window are self-healing because the pull is the source of truth, not the push.
- Polling fallback: regardless of WS connection state, the client also polls `GET /sync?since=<lastKnownRevision>` on a fixed interval (~30s) whenever the vault is unlocked. This is belt-and-suspenders against reverse-proxy WS misconfiguration (a documented risk explicitly deferred to Phase 7's nginx/Caddy reference config) — sync must not go silently dead just because a self-hoster's proxy doesn't forward `Upgrade` headers correctly.
- Sync (WS connect + poll timer) runs only while the vault is unlocked; on lock, the WS closes and the poll timer stops (mirrors Phase 2's existing "no plaintext work while locked" pattern — `loadAndDecryptAll` already only fires on unlock).

### Conflict Resolution & Deletion Semantics (auto-accepted)
- Per-item LWW via the existing `revision` column and optimistic-concurrency `PUT` (Phase 2, unchanged): the write that supplies a stale `expected_revision` gets a 409, exactly as today. This phase's job is making that conflict *visible* across devices proactively, not just reactively at save-time.
- Background list refresh: on a WS push or poll tick that reveals a changed `vault_revision`, the client re-pulls via `GET /sync`, re-decrypts, and merges into the `items`/`folders` store silently (list view updates live) — same trust model as Phase 2's `loadAndDecryptAll`, just triggered by a new event source instead of only by unlock.
- Remote-delete-while-viewing: if the item currently open in `DetailPanel` gets removed from the incoming snapshot (id no longer present), the panel closes and a toast explains it was deleted on another device — never leaves a phantom detail view pointing at nothing.

### Client UX: Live-Edit Conflict & Sync Indicator (auto-accepted; VISUAL/UX TASTE FLAGGED FOR MORNING REVIEW)
- Remote-edit-while-editing: if a WS/poll signal reveals a changed revision for the item currently open in `DetailPanel`'s *edit* mode, the client does NOT silently overwrite in-progress form state (would clobber unsaved typing). Instead show a small inline banner in the detail panel — "Ten element zmienił się na innym urządzeniu" / "This item changed on another device" — with a manual "refresh" action, matching Phase 2's existing `RevisionConflictError` message tone (T-02-22) but shown proactively instead of only on save-conflict.
- Sync status indicator: a minimal, unobtrusive presence indicator (small dot/pulse in `TopBar`, near where a future health-dot placeholder already lives per Phase 2's UI notes) rather than a chatty banner or toast-per-change — datafa.st's understated aesthetic, security-adjacent UI stays legible and calm. Exact treatment (color states for connected/reconnecting/offline, tooltip copy) left to the planner within `docs/UI-DESIGN.md` tokens.
- i18n PL+EN for every new string (established Phase 2 convention, reaffirmed Phase 3).

### Claude's Discretion
- Exact `SyncEvent` Rust type shape, `sync_hub` data structure/cleanup strategy (e.g., dropping empty broadcast channels when no subscribers), migration numbering, error taxonomy for the WS handshake, poll-interval/backoff constants beyond the ballpark figures above.
- Whether `GET /sync`'s full-snapshot item/folder shape exactly mirrors `GET /api/vault/items`/`/folders`' existing row shape or is a thin combined wrapper — planner's call, minimize duplication.
- Test structure: axum integration tests for `/api/sync` and the WS handshake in `crates/pv-server/tests/`, vitest for the client reconnect/backoff/merge logic — following existing per-phase conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `crates/pv-server/src/routes/vault.rs`: existing item CRUD with the single-statement optimistic-concurrency `UPDATE ... RETURNING` pattern (RESEARCH.md Pattern 3) — the model to replicate for the `vault_revision` bump.
- `crates/pv-server/src/routes/session.rs` (`SessionUser` extractor, Bearer-hash lookup) — reusable for WS query-param token validation.
- `crates/pv-server/src/lib.rs` `AppState` (`db: SqlitePool`, `session_ttl_hours`, `webauthn: Webauthn`) — gains the new `sync_hub` field here.
- `web/src/lib/vault/store.ts` — the sole in-memory vault singleton (`items`, `folders`, `useSyncExternalStore` pattern, `loadAndDecryptAll`, lock/unlock lifecycle via `subscribeLockState`). This phase's pull/merge/conflict logic extends this module rather than introducing a parallel store.
- `web/src/lib/vault/api.ts` / `web/src/lib/auth/api.ts` — `apiFetch`/`apiJson` helpers, `ApiClientError`, base64 helpers; the new `/api/sync` client and WS client should sit alongside these, reusing `apiFetch`'s base-URL/auth-header logic where applicable (WS itself needs the raw token for the query string, via `getSessionToken()`).
- `web/src/lib/vault/store.ts`'s existing `RevisionConflictError` + `isConflictError` duck-typing pattern — the proactive live-edit-conflict banner should reuse this error/message family, not invent a second vocabulary.
- Phase 3's Settings drawer + `relativeTime.ts` + `ErrorToast`/`CopyToast` components — the new "item changed elsewhere" toast and sync-status dot follow these established toast/indicator conventions.

### Established Patterns
- Zero-knowledge: server sees only ciphertext blobs + metadata (id/revision/change_type) — never plaintext, never PRF/UK material. The WS channel is the newest surface where this must be grep/traffic-auditable (mirrors Phase 1's `lib/crypto/` choke-point audit spirit).
- Runtime-checked `sqlx::query` (not `query!`/`query_as!`) throughout `pv-server` — no live `DATABASE_URL`/`.sqlx` cache requirement (Phase 2 convention, applies here too).
- Single-statement optimistic concurrency (`UPDATE ... WHERE ... RETURNING`) to avoid SELECT-then-UPDATE race windows — apply the same shape when bumping `vault_revision` alongside an item/folder mutation.
- `useSyncExternalStore`-based module-singleton stores in `web/src/lib/*` (not React Context/Redux) — the sync connection state (WS status for the TopBar indicator) should follow the same shape as `lib/crypto`'s lock-state singleton.
- i18n via the existing thin dictionary module (`web/src/lib/i18n/`), PL+EN, no framework-level locale routing (static export constraint carried since Phase 2).

### Integration Points
- `crates/pv-server/Cargo.toml`: axum currently has no `ws` feature flag — needs `features = ["ws"]` (or equivalent) added for the WebSocket upgrade handler.
- `crates/pv-server/src/routes/mod.rs`: router gains `GET /api/sync` and `GET /api/sync/ws` alongside the existing `/api/vault/*` routes.
- New migration (numbering continues from `0006_webauthn_states.sql`) adding `users.vault_revision`.
- `web/src/lib/vault/store.ts`: gains the poll timer + WS client wiring, gated on `subscribeLockState`'s existing unlock/lock hook (start on unlock, stop on lock — same lifecycle already governing `loadAndDecryptAll`).
- `web/src/components/shell/TopBar.tsx`: gains the sync-status indicator (currently just search + new-item button).
- `web/src/components/*DetailPanel*`: gains the live-edit-conflict banner (exact component TBD by planner — Phase 2's `DetailPanel` is the z-40 drawer entry point per `02-CONTEXT.md`).

</code_context>

<specifics>
## Specific Ideas

- Bartek's Proton-Pass-inspired-but-adapted direction (Phase 2 UAT) applies here too: sync should feel ambient and trustworthy, not chatty — no per-change toast spam, a single calm status signal.
- `docs/ARCHITECTURE.md`'s original sketch (`GET/PUT /sync` delta-based, WS `/sync/stream`, `deleted_at` column) predates the roadmap's binding "no delta/CRDT, full-snapshot" framing and Phase 2's decision to drop `deleted_at` entirely — this CONTEXT.md's decisions supersede that older doc for Phase 5; ARCHITECTURE.md itself is not updated by this step (planner/doc-update pass can reconcile it later if desired).

</specifics>

<deferred>
## Deferred Ideas

- Redis/external pubsub for multi-process fan-out — not needed at single-container scale; revisit only if the deployment model ever changes (would contradict the "1 container, no required external services" constraint anyway).
- WS auth hardening (first-message auth instead of query-param token) — pre-v1.0 hardening bucket, alongside the httpOnly-cookie session revisit carried forward from Phase 2.
- Tombstone/soft-delete table for true delta sync — deferred with soft-delete itself (Phase 2); full-snapshot diffing avoids needing it for v0.1.
- Cross-device "who else is viewing this item" presence UI — no requirement drives it (SYNC-01/02/03 don't ask for live cursors/presence); explicitly out of scope, not just unaddressed.
- WS-behind-reverse-proxy end-to-end verification — Phase 7's documented nginx/Caddy reference config is where this gets proven for real; this phase only needs the polling fallback to exist so Phase 7 isn't a blocker for basic sync correctness.

</deferred>
