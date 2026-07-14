---
phase: 05-multi-device-sync
plan: 02
subsystem: api
tags: [axum, websocket, tokio, broadcast, sync, push, rust, tokio-tungstenite]

requires:
  - phase: 05-multi-device-sync (plan 01)
    provides: users.vault_revision atomic bump sites in vault.rs/folders.rs, GET /api/sync pull endpoint, tests/sync.rs harness
  - phase: 03-passkeys
    provides: sessions table + SessionUser bearer-token hash validation this plan factors into validate_token()
provides:
  - "SyncHub — in-process per-user tokio::sync::broadcast fan-out hub on AppState (lazy channel creation, prune-on-disconnect)"
  - "SyncEvent {entity_type, id, revision, change_type} — metadata-only wire type, snake_case serialization per 05-CONTEXT.md's locked schema"
  - "GET /api/sync/ws — WebSocket upgrade authenticated via ?token= through the same validate_token() hash lookup as REST"
  - "sync_hub.publish() wired into every vault/folder mutation handler (item create/update/delete, folder create/delete)"
  - "tests/common::test_server() real-TcpListener harness for WS integration tests (oneshot() cannot exercise an Upgrade handshake)"
affects: [05-03-client-sync, 05-04, 07-docker-packaging]

tech-stack:
  added: [tokio-tungstenite 0.30 (dev-only), futures-util 0.3 (dev-only), axum ws feature]
  patterns:
    - "Per-user broadcast fan-out: Arc<Mutex<HashMap<user_id, broadcast::Sender>>>, channel created lazily on subscribe, pruned when receiver_count()==0 on disconnect"
    - "Best-effort publish: missing entry or zero-receiver SendError are silent no-ops, never HTTP errors"
    - "WS auth via query param validated BEFORE on_upgrade with the same validate_token() the REST extractor uses — single source of truth"
    - "Real-socket WS test harness: TcpListener::bind(port 0) + axum::serve in tokio::spawn, SAME Router clone shared between the served app and oneshot() mutation driver"

key-files:
  created: []
  modified:
    - crates/pv-server/Cargo.toml
    - crates/pv-server/src/lib.rs
    - crates/pv-server/src/main.rs
    - crates/pv-server/src/routes/session.rs
    - crates/pv-server/src/routes/sync.rs
    - crates/pv-server/src/routes/vault.rs
    - crates/pv-server/src/routes/folders.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/common/mod.rs
    - crates/pv-server/tests/sync.rs

key-decisions:
  - "Session tokens are standard base64 — WS test URLs percent-encode +/= (a raw + in a query string decodes as a space and silently 401s); flagged for Plan 05-03's client to use encodeURIComponent, which the research's Pattern 4 already does."
  - "futures-util added as an explicit dev-dependency (test code calls StreamExt::next() on tokio-tungstenite's stream directly; it was only a transitive dep before)."

patterns-established:
  - "SyncEvent carries exactly four fields and nothing capable of holding ciphertext — enforced by an exact-JSON-key-set assertion on a real WS frame, not code inspection"
  - "validate_token(db, token) in session.rs is the single session-validation implementation for all auth surfaces (REST header + WS query param)"

requirements-completed: [SYNC-02]

coverage:
  - id: D1
    description: "WS upgrade with a missing/invalid ?token= is rejected at the handshake (401, never a silently-open anonymous socket)"
    requirement: "SYNC-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync.rs#ws_rejects_invalid_token"
        status: pass
    human_judgment: false
  - id: D2
    description: "A real mutation's WS frame carries EXACTLY {entity_type, id, revision, change_type} — no ciphertext field, proven at the raw-frame level"
    requirement: "SYNC-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync.rs#ws_event_contains_no_ciphertext"
        status: pass
    human_judgment: false
  - id: D3
    description: "Two distinct authenticated users' WS connections never cross — user A's mutation is invisible to user B's socket"
    requirement: "SYNC-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/sync.rs#ws_cross_user_isolation"
        status: pass
    human_judgment: false
  - id: D4
    description: "The SessionUser/validate_token refactor and AppState.sync_hub field regress nothing (auth, vault, passkeys, sessions, sync pull suites all green)"
    requirement: "SYNC-02"
    verification:
      - kind: integration
        ref: "cargo test --workspace (auth 9, vault 13, passkeys 10, passkey_login 7, sessions 4, unlock 4, sync 7, unit suites)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-14
status: complete
---

# Phase 5 Plan 02: WebSocket Push Channel Summary

**`GET /api/sync/ws` metadata-only push channel: per-user `tokio::sync::broadcast` SyncHub on AppState, token-validated upgrade reusing the REST session hash lookup, publish calls wired into all five vault/folder mutation handlers, proven ciphertext-free and cross-user-isolated at the raw WS-frame level.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-14T12:09:19Z
- **Tasks:** 2 completed (Task 2 TDD: RED → GREEN)
- **Files modified:** 10

## Accomplishments
- `SyncHub` (`Arc<Mutex<HashMap<user_id, broadcast::Sender<SyncEvent>>>>`) on `AppState`: channels created lazily on first `subscribe()`, pruned from the map when the last WS connection for a user disconnects — memory bounded to currently-or-recently-connected users with no background sweep task.
- `SyncEvent {entity_type, id, revision, change_type}` with `snake_case` serde — exactly 05-CONTEXT.md's locked wire schema (`"item"`/`"folder"`, `"create"`/`"update"`/`"delete"`), and structurally incapable of carrying ciphertext (T-05-04 mitigation).
- `GET /api/sync/ws`: `?token=` validated via `session::validate_token()` (the SessionUser extractor's hash-then-lookup-with-expiry logic, factored out — one implementation, two auth surfaces) BEFORE `on_upgrade`; invalid tokens get the same 401 every REST endpoint returns. `handle_socket` runs 05-RESEARCH.md Pattern 3's `tokio::select!` loop verbatim (forward events as `Message::Text`, continue past `Lagged`, break on `Closed`/client disconnect, prune on exit).
- All five mutation handlers (`vault.rs` create/update/delete, `folders.rs` create/delete) publish a `SyncEvent` immediately after Plan 05-01's `vault_revision` bump: items use their own per-row revision for create (`1`) and update (`expected_revision + 1`); item delete and both folder events use the freshly-bumped global `vault_revision` (deleted rows and folders have no per-row revision).
- `tests/common::test_server()`: real `TcpListener` on port 0 + `axum::serve` in a spawned task, returning the SAME `Router` clone for `oneshot()`-driven mutations — both share one `AppState`/`SyncHub` instance (a second `test_app()` call would silently break every WS test).
- 3 new WS integration tests (7 total in `tests/sync.rs`), all green: handshake rejection, exact-key-set no-ciphertext frame inspection, cross-user isolation.

## Task Commits

Each task was committed atomically:

1. **Task 1: SyncHub/SyncEvent + AppState wiring + WS upgrade handler + validate_token refactor** - `f9d46c1` (feat)
2. **Task 2: Publish wiring + real-socket test harness + WS integration tests** - `4b286a4` (test, RED) → `7598218` (feat, GREEN)

**Plan metadata:** (this commit)

_Note: Task 2 was TDD — `4b286a4` adds the harness and 3 WS tests with `ws_event_contains_no_ciphertext` and `ws_cross_user_isolation` confirmed failing (no publish wired yet; `ws_rejects_invalid_token` passed immediately since Task 1's handler already rejects). `7598218` wires the five publish calls to make all 7 sync tests pass. No REFACTOR commit needed._

## Files Created/Modified
- `crates/pv-server/Cargo.toml` - axum gains `features = ["ws"]`; `tokio-tungstenite 0.30` + `futures-util 0.3` dev-dependencies
- `crates/pv-server/src/routes/session.rs` - hash-then-lookup-with-expiry factored into `pub(crate) validate_token()`; `SessionUser::from_request_parts` now a thin wrapper
- `crates/pv-server/src/routes/sync.rs` - `EntityType`, `ChangeType`, `SyncEvent`, `SyncHub` (subscribe/publish/prune_if_empty), `WsAuthQuery`, `ws_handler`, `handle_socket`
- `crates/pv-server/src/lib.rs` - `AppState.sync_hub: SyncHub` field
- `crates/pv-server/src/main.rs` - `sync_hub: SyncHub::default()` in AppState construction
- `crates/pv-server/src/routes/mod.rs` - `GET /api/sync/ws` route
- `crates/pv-server/src/routes/vault.rs` - 3 publish calls after existing revision bumps; delete's bump binding un-underscored and consumed
- `crates/pv-server/src/routes/folders.rs` - 2 publish calls, both carrying the global `vault_revision`
- `crates/pv-server/tests/common/mod.rs` - `test_server()` real-socket harness; `test_app()`'s AppState literal gains `sync_hub: Default::default()`
- `crates/pv-server/tests/sync.rs` - `ws_rejects_invalid_token`, `ws_event_contains_no_ciphertext`, `ws_cross_user_isolation` + `url_encode_token` helper

## Decisions Made
- **WS test URLs percent-encode the session token** (`+`→`%2B`, `/`→`%2F`, `=`→`%3D`): tokens are standard base64, and a raw `+` in a query string is decoded as a space by axum's `Query` extractor (form-urlencoded convention), producing a spurious 401. Plan 05-03's browser client must use `encodeURIComponent` for the same reason — 05-RESEARCH.md Pattern 4's sketch already does.
- **`futures-util` added as explicit dev-dependency** — the test file imports `StreamExt` directly to drive tokio-tungstenite's stream; relying on it only transitively would not compile.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Percent-encoded the base64 session token in WS test URLs**
- **Found during:** Task 2 (WS integration tests, RED phase)
- **Issue:** `connect_async` with the raw base64 token in `?token=` got 401 on every valid-token test — `+` in base64 decodes as a space in a query string, so `validate_token` hashed a different string than login issued
- **Fix:** Added `url_encode_token()` test helper escaping `+`/`/`/`=`; documented the client-side implication for Plan 05-03
- **Files modified:** crates/pv-server/tests/sync.rs
- **Verification:** Both valid-token WS tests connect and pass
- **Committed in:** `4b286a4` (RED commit)

**2. [Rule 3 - Blocking] Added futures-util dev-dependency**
- **Found during:** Task 2 (test harness compilation)
- **Issue:** Test code imports `futures_util::StreamExt` (per the plan's own interface notes) but the crate had no direct `futures-util` dependency
- **Fix:** `futures-util = "0.3"` in `[dev-dependencies]` (already in the dependency tree transitively; no new registry package)
- **Files modified:** crates/pv-server/Cargo.toml, Cargo.lock
- **Verification:** `cargo test --workspace` green
- **Committed in:** `4b286a4` (RED commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 - blocking)
**Impact on plan:** Both fixes were necessary to compile/pass the tests the plan itself specified. No scope creep; no new external packages beyond what 05-RESEARCH.md already audited (futures-util was already a transitive dependency of tokio-tungstenite/axum).

## Issues Encountered
None beyond the auto-fixed items above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 05-03 (client sync) can connect to a live, tested `ws://…/api/sync/ws?token=` contract; it MUST `encodeURIComponent` the token (see Decisions Made) and treat frames purely as "go pull" triggers.
- The accepted threat-model items (T-05-06 query-param token in logs, T-05-07 no proactive close-on-revoke) remain flagged for pre-v1.0 hardening as per plan/CONTEXT — no new surface added beyond them.
- `cargo test --workspace` fully green (sync 7/7, vault 13/13, auth 9/9, passkeys 10/10, passkey_login 7/7, sessions 4/4, unlock 4/4); `cargo build --workspace` clean with zero warnings.

---
*Phase: 05-multi-device-sync*
*Completed: 2026-07-14*

## Self-Check: PASSED

All modified files verified present on disk (`sync.rs`, `tests/sync.rs`, `tests/common/mod.rs`, this SUMMARY.md); all task commit hashes (`f9d46c1`, `4b286a4`, `7598218`) plus the docs commit (`01ef90e`) verified present in `git log --oneline --all`; no unexpected file deletions across the plan's commit range.
