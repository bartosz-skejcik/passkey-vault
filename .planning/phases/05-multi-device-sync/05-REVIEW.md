---
phase: 05-multi-device-sync
reviewed: 2026-07-14T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - crates/pv-server/Cargo.toml
  - crates/pv-server/migrations/0010_vault_revision.sql
  - crates/pv-server/src/lib.rs
  - crates/pv-server/src/main.rs
  - crates/pv-server/src/routes/folders.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/session.rs
  - crates/pv-server/src/routes/sync.rs
  - crates/pv-server/src/routes/vault.rs
  - crates/pv-server/tests/common/mod.rs
  - crates/pv-server/tests/sync.rs
  - web/src/app/page.tsx
  - web/src/components/shell/Sidebar.test.tsx
  - web/src/components/shell/Sidebar.tsx
  - web/src/components/vault/DetailPanel.test.tsx
  - web/src/components/vault/DetailPanel.tsx
  - web/src/components/vault/ErrorToast.tsx
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/vault/api.ts
  - web/src/lib/vault/errorToast.ts
  - web/src/lib/vault/remoteDelete.test.ts
  - web/src/lib/vault/remoteDelete.ts
  - web/src/lib/vault/store.test.ts
  - web/src/lib/vault/store.ts
  - web/src/lib/vault/sync.test.ts
  - web/src/lib/vault/sync.ts
  - web/src/lib/vault/syncStatus.ts
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: fixed
---

# Phase 5: Code Review Report

**Reviewed:** 2026-07-14T00:00:00Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

Reviewed the Phase 5 multi-device sync slice: the Rust `GET /api/sync` revision-gated pull, the metadata-only `GET /api/sync/ws` broadcast hub, the per-user `vault_revision` counter and its bump on every vault/folder mutation, and the browser-side sync transport (WS + 30s poll), store merge, and conflict UI.

The zero-knowledge boundary holds well: `SyncEvent` carries only `{entity_type, id, revision, change_type}`, the WS frame is never parsed client-side, `GET /api/sync` returns only opaque encrypted columns, and per-user isolation is enforced (validated token → `user_id` scoping on every query, with integration tests proving cross-user WS isolation). The reconnect backoff/jitter, `stopSync` trailing-close guard, and the stale/freed-User-Key re-check in `applySyncSnapshot` are all implemented correctly.

Three real defects surfaced. The most serious (CR-01) is a silent lost-update: the edit form sends the **live** (background-updated) item revision as the optimistic-concurrency `expected_revision`, so once background sync has refreshed the open item's revision, saving over a concurrent remote change succeeds without a 409 — defeating the very conflict protection this phase advertises. WR-01 is a non-atomic mutation/counter bump; WR-02 is a session token exposed in the WS URL query string that request-logging middleware can capture.

## Critical Issues

### CR-01: Live-edit save uses the background-updated revision as `expected_revision`, silently overwriting a concurrent remote change

**File:** `web/src/components/vault/DetailPanel.tsx:240`, `web/src/components/vault/ItemForm.tsx:235`, `web/src/lib/vault/store.ts:254-269`

**Issue:** DetailPanel passes `currentRevision={item.revision}` to `ItemForm`, where `item` is the *live* store object. When a background WS/poll sync merges a concurrent edit from another device, `applySyncSnapshot` replaces the item wholesale and its `revision` advances (e.g. 1 → 2). The `ItemForm` is keyed by `editBaselineRevision` (still 1), so it is **not** remounted and keeps the user's in-progress draft — but its `currentRevision` prop is now the live `2`. On submit, `handleSubmit` calls `updateVaultItem(itemId, cleaned, currentRevision=2)`, which sends `expected_revision: 2` to the server. The server is also at revision 2, so the `WHERE ... AND revision = ?` guard matches, the write succeeds, and the other device's change is silently overwritten. No 409 is returned, so the reactive `RevisionConflictError` / T-02-22 conflict banner never fires.

The proactive `liveConflict` banner (DetailPanel.tsx:120-121) is shown, but it is advisory only — it does not disable the Save button and its copy only warns that *Refresh* discards the user's edits, never that *Save* discards the remote change. Because background sync keeps the local revision in lockstep with the server, the reactive 409 path is effectively unreachable in exactly the multi-device-conflict scenario it was built to protect. This is a lost-update / data-loss defect at the core of the phase.

**Fix:** Send the revision the edit was *based on* (`editBaselineRevision`), not the live revision, as the optimistic-concurrency token. Thread `editBaselineRevision` down as `ItemForm`'s `currentRevision`:

```tsx
// DetailPanel.tsx — pass the baseline captured at edit-entry, not item.revision
<ItemForm
  key={`${item.id}-${editBaselineRevision}`}
  type={item.fields.type}
  mode="edit"
  itemId={item.id}
  currentRevision={editBaselineRevision ?? item.revision}
  initialFields={item.fields}
  /* ... */
/>
```

Now a concurrent remote change makes `expected_revision` (baseline) `!=` the server's current revision, the server returns 409, and the existing `RevisionConflictError` → refetch → banner path (store.ts:270-276) engages as designed. Note that `encryptItem`'s AD revision in `updateVaultItem` must then also be derived from the baseline (`editBaselineRevision + 1`) so the ciphertext AD matches the revision the server will actually assign.

## Warnings

### WR-01: Mutation and `vault_revision` bump are not atomic — a partial failure strands the row un-synced and wedges the creator

**File:** `crates/pv-server/src/routes/vault.rs:74-107` (create), `:184-220` (update), `:246-263` (delete); `crates/pv-server/src/routes/folders.rs:48-63`, `:119-136`

**Issue:** Each handler runs the row mutation and the `UPDATE users SET vault_revision = vault_revision + 1` as **two separate autocommitted statements** (confirmed: no `pool.begin()` / transaction anywhere in `routes/`). The module comments call this "single-statement discipline," but that only makes each statement individually atomic — the pair is not. If the connection drops (or the process crashes) after the INSERT/UPDATE/DELETE commits but before the counter bump commits, the data mutation is durable while the counter is not.

Consequences: (a) other devices polling `GET /api/sync?since=N` see the unchanged counter, return `UpToDate`, and **never pull the orphaned change** until some unrelated future mutation bumps the counter; (b) for `create`, the handler then returns `?`-propagated `Internal` (500), so the client's `createVaultItem` throws and never adds the item locally — yet the row is persisted server-side, and a retry with the same client UUID hits `ON CONFLICT DO NOTHING` → `None` → 409 "item id already exists", leaving the user permanently unable to reconcile a row they can neither see nor recreate.

**Fix:** Wrap each mutation and its counter bump in a single transaction so they commit or roll back together:

```rust
let mut tx = state.db.begin().await?;
// INSERT/UPDATE/DELETE ... .execute(&mut *tx).await?;
// UPDATE users SET vault_revision = vault_revision + 1 ... .fetch_one(&mut *tx).await?;
tx.commit().await?;
```

Publish the `SyncEvent` only after `commit()` succeeds.

### WR-02: Session token in the WS URL query string is captured by request-logging middleware and reverse-proxy access logs

**File:** `crates/pv-server/src/routes/sync.rs:149-167`, `crates/pv-server/src/main.rs:30`

**Issue:** WS auth passes the live session bearer token as `?token=<token>` (unavoidable given the browser `WebSocket` API can't set headers). The server applies `TraceLayer::new_for_http()` (main.rs:30), whose default `MakeSpan` records the full request `uri` — including the query string — as a span field. At the default `info` filter the span (created at `DEBUG`) is not emitted, but any operator who raises `RUST_LOG` to `debug`/`trace` while diagnosing sync issues will write live session tokens into the logs. The same token is also exposed to the reverse proxy the project explicitly plans for Phase 7 Docker packaging (nginx/Caddy access logs record the full request line by default), and to browser history. The percent-encoding mitigation (sync.ts:59-71) addresses correctness of the value, not its exposure.

**Fix:** Prevent the token from reaching log sinks. Either configure the trace layer with a custom `make_span_with` that redacts the query string for `/api/sync/ws`, or move the token off the query string entirely (e.g. a short-lived single-use WS ticket issued over the authenticated REST channel and exchanged in the first WS frame). At minimum, document that reverse-proxy access logging must strip the `token` query param for this route.

## Info

### IN-01: `SyncEvent.revision` carries inconsistent semantics across event kinds

**File:** `crates/pv-server/src/routes/vault.rs:106` (item create → per-item `1`), `:231` (item update → per-item revision), `:273` (item delete → **global** `vault_revision`); `crates/pv-server/src/routes/folders.rs:73`, `:145` (folders → global `vault_revision`)

**Issue:** The `revision` field means "the item's own row revision" for item create/update, but "the user's global `vault_revision`" for item delete and for all folder events. This is harmless today only because the client deliberately ignores the WS payload (`socket.onmessage` triggers a pull without reading the body). It is a latent trap: any future client (or the planned mobile/extension surfaces) that starts trusting `event.revision` as a per-entity version will silently mishandle deletes and folders.

**Fix:** Document the mixed semantics on the `SyncEvent` type, or normalize the field (e.g. always the global `vault_revision`, since that is the value the client actually gates its pull on) so the wire contract has one meaning.

### IN-02: `applySyncSnapshot` advances `lastKnownRevision` before the lock/User-Key check

**File:** `web/src/lib/vault/store.ts:178-186`

**Issue:** `lastKnownRevision = snapshot.revision` runs at the top of `applySyncSnapshot`, before the `getUnlockedUserKey() === null` bail. If a lock event races an in-flight fetch, the early-return correctly skips decrypt/merge, but the watermark has already been advanced to a non-zero value while the vault is locked (the lock handler's `lastKnownRevision = 0` reset ran earlier, so it does not re-clear it). This self-heals — the next unlock's `loadAndDecryptAll()` always pulls with a hardcoded `since=0` — so no data is missed, but the module-level watermark is transiently inconsistent with the "locked = revision 0" invariant the lock handler establishes.

**Fix:** Move the `lastKnownRevision` assignment below the `uk === null` guard so the watermark only advances when the snapshot is actually applied.

---

## Fix Report

**Fixed at:** 2026-07-14T13:41:47Z

All Critical and Warning findings were fixed. The two Info findings (IN-01,
IN-02) were intentionally left unfixed per the fix scope for this pass — see
their entries above for the still-outstanding issue and suggested fix.

### CR-01: Live-edit save uses the background-updated revision as `expected_revision`, silently overwriting a concurrent remote change

**Status:** fixed
**Commit:** `81f0e4f`
**Files:** `web/src/components/vault/DetailPanel.tsx`, `web/src/components/vault/DetailPanel.test.tsx`

`DetailPanel`'s `ItemForm` now receives `currentRevision={editBaselineRevision ?? item.revision}` instead of the live `item.revision`. `store.ts`'s `updateVaultItem` already derived both the AEAD/AD revision (`currentRevision + 1`) and the wire `expected_revision` from whatever revision it's called with, so no change was needed there — passing the baseline through was the only fix required. Added a regression test (`DetailPanel.test.tsx`) proving: open edit at rev 1 → background sync rerenders with a bumped item at rev 2 → Save calls `updateVaultItem` with `expected_revision = 1` (the baseline), not `2` (the live/background-advanced revision). Full web suite (221 tests) and `tsc --noEmit` pass.

### WR-01: Mutation and `vault_revision` bump are not atomic

**Status:** fixed
**Commit:** `84e019d`
**Files:** `crates/pv-server/src/routes/vault.rs`, `crates/pv-server/src/routes/folders.rs`

Wrapped each handler's row mutation and its `vault_revision` bump in a single `state.db.begin()` / `tx.commit()` transaction across `vault.rs` (`create`, `update`, `delete`) and `folders.rs` (`create`, `delete`). `SyncEvent` publication now happens only after `commit()` succeeds. Response shapes are unchanged. `cargo test --workspace` (all 13 vault.rs integration tests plus the full suite) passes; `cargo build --workspace` has zero new warnings.

### WR-02: Session token in the WS URL query string is captured by request-logging middleware

**Status:** fixed
**Commit:** `e221752`
**Files:** `crates/pv-server/src/main.rs`

Added a custom `make_span` passed to `TraceLayer::new_for_http().make_span_with(...)` in `main.rs` that reports the request `uri` span field as path-only (no query string) for `/api/sync/ws`, leaving `DefaultMakeSpan`'s normal full-URI behavior untouched for every other route. Kept the existing bearer-token-over-query-param auth mechanism as-is (a ticket endpoint was explicitly out of scope for this fix). Added a doc comment noting Phase 7's Docker packaging must separately document reverse-proxy access-log stripping of the `token` query param, since a reverse proxy logs the raw request line before this middleware ever runs. Added two unit tests (`main.rs::tests`) on the extracted pure `span_uri_field` helper, proving the token is stripped for `/api/sync/ws` and every other route's full uri (including its query string) is preserved unchanged. `cargo test --workspace` passes; `cargo build --workspace` has zero new warnings.

### IN-01, IN-02: not fixed (out of scope for this pass)

Left as documented above — see the Info section for file/line references and suggested fixes.

---

_Reviewed: 2026-07-14T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Fixed: 2026-07-14T13:41:47Z_
_Fixer: Claude (gsd-code-fixer)_
