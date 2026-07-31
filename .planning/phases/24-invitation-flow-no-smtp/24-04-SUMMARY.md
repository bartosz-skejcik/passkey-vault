---
phase: 24-invitation-flow-no-smtp
plan: 04
subsystem: api
tags: [rust, axum, sqlx, sqlite, tokio, websocket, concurrency-testing, security-headers]

# Dependency graph
requires:
  - phase: 24-invitation-flow-no-smtp (Plan 24-02)
    provides: "Live /api/invitations/* surface (create, fetch_metadata, accept, revoke) with Amendment 2 proof-of-possession"
provides:
  - "Genuinely concurrent (real multi-connection pool, tokio::spawn + Arc<Barrier>, 20 trials) proof that accept's single-use guard yields exactly one winner and the loser is a clean 404, never a 500"
  - "Real-WebSocket proof that an existing collection member receives a live EntityType::Collection event the instant a new member joins via invite"
  - "Adversarial proof that the pre-redemption metadata response never leaks a collection-scoped invite's enc_name"
  - "Adversarial proof (Amendment 2 / T-24-07) that invite_id alone, across 6 request variants, is rejected identically to a never-existed id on both fetch_metadata and accept"
  - "Global Referrer-Policy: strict-origin-when-cross-origin header on every response (T-24-10)"
affects: [24-05, 24-06, 24-07, 24-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Genuinely-concurrent-race test pattern: file:{uuid}?mode=memory&cache=shared pool with busy_timeout(5s), max_connections(4)/min_connections(1), tokio::spawn racers gated on Arc<Barrier>, tokio::join! only on the resulting JoinHandles — never common::test_pool()'s max_connections(1), which serializes any race on pool acquisition rather than the SQLite write lock"
    - "Real-bound-server + tokio_tungstenite for WS fan-out proofs — tower::ServiceExt::oneshot cannot perform a WebSocket Upgrade handshake"
    - "Adversarial substring assertion for metadata non-leak: serde_json::to_string(&body).contains(secret_value) rather than a mere key-presence check"
    - "Global response middleware applied at the SAME chain point CorsLayer wraps the router, so both cover the static-file SPA fallback identically"

key-files:
  created: []
  modified:
    - crates/pv-server/tests/invitations.rs
    - crates/pv-server/src/routes/mod.rs

key-decisions:
  - "Rejected the original (plan-checker-flagged) concurrency test design that reused common::test_pool() — that pool is max_connections(1) on a bare sqlite::memory: URI, which would serialize both racers on POOL ACQUISITION and prove nothing about the SQLite write lock. Rebuilt with a fresh file:{uuid}?mode=memory&cache=shared pool per trial, mirroring tests/collections.rs's revoke_access_last_key_holder_guard_is_atomic_under_concurrency exactly, plus a 5s busy_timeout the analog itself doesn't need but this test's own 500-vs-404 assertion does"
  - "referrer_policy_middleware is layered at the identical chain point CorsLayer already wraps router_with_cors (before the static-file fallback is attached) so both middlewares cover the complete router — including a served index.html/asset — not just the /api/* sub-chain"
  - "The invite_id-alone adversarial test deliberately excludes an outright-missing invite_proof JSON field as a fourth variant — that fails Json<T> deserialization before the handler runs at all (axum's own generic rejection), a request-shape distinction this codebase already accepts everywhere Json<T> is used, not a new gap this test needed to cover"
  - "publish_keypair/recv_ws_json/url_encode_token helpers are duplicated locally in tests/invitations.rs rather than exported from tests/sync_shared.rs or tests/collections.rs, matching this codebase's established per-test-binary helper duplication convention"

patterns-established:
  - "A test proving a concurrency guarantee MUST use a genuinely multi-connection shared-cache pool with a busy_timeout matching production, never the single-connection default test pool — codified here as the SECOND instance of this exact pattern (after tests/collections.rs), making it a recognizable idiom for future concurrency proofs in this codebase"

requirements-completed: [FAM-04, FAM-05]

coverage:
  - id: D1
    description: "Two brand-new users racing accept against the same single-use invite, both presenting the correct invite_proof and released at the same instant, produce exactly one 200 and one clean 404 (never a 500) across 20 trials x 3 verification runs (60 total races); family_members never contains both racers nor neither for any trial"
    requirement: "FAM-04"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#concurrent_redemption_exactly_one_wins"
        status: pass
    human_judgment: false
  - id: D2
    description: "An existing collection member with a live WebSocket connection receives a real EntityType::Collection frame the instant a new member joins that collection via invite (real bound server, real tokio_tungstenite socket)"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#accept_fans_out_collection_event_to_existing_member_over_websocket"
        status: pass
    human_judgment: false
  - id: D3
    description: "A collection-scoped invite's pre-redemption metadata response never contains the collection's own enc_name value anywhere in its JSON body, and still carries exactly the five documented fields"
    requirement: "FAM-05"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_metadata_collection_scoped_never_leaks_collection_enc_name"
        status: pass
    human_judgment: false
  - id: D4
    description: "invite_id alone (no proof, wrong-but-well-formed proof, or malformed proof) is rejected identically to a never-existed id on both fetch_metadata and accept, across all 6 variants, and never consumes the real invite (Amendment 2 / T-24-07)"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_id_alone_without_correct_proof_is_rejected_on_metadata_and_accept"
        status: pass
    human_judgment: false
  - id: D5
    description: "Every HTTP response — including a bare /healthz probe and (structurally, via the shared cors-layer chain point) the static-file SPA fallback — carries Referrer-Policy: strict-origin-when-cross-origin"
    verification:
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#routes::tests::healthz_response_carries_referrer_policy_header"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-07-31
status: complete
---

# Phase 24 Plan 04: Adversarial Concurrency, WebSocket, and Metadata-Leak Proofs Summary

**Replaced a false-proof concurrency test (pool-acquisition serialization, not SQLite write-lock contention) with a genuine multi-connection race proof, added a real-WebSocket collection-join fan-out proof, an adversarial enc_name-leak substring check, a six-variant Amendment 2 proof-of-possession sweep, and a global `Referrer-Policy` header.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-31T12:10:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 2

## Accomplishments

- `concurrent_redemption_exactly_one_wins` (Task 1) — two brand-new users race `accept` against the SAME single-use invite, both presenting the objectively correct `invite_proof`, released at the same instant via a shared `Arc<Barrier>`, each on its own `tokio::spawn`ed task against a genuinely multi-connection (`max_connections(4)`) `file:{uuid}?mode=memory&cache=shared` pool with the same 5-second `busy_timeout` production uses. 20 trials, 3 consecutive verification runs (60 total races): `double_wins == 0`, `zero_wins == 0`, no loser status is ever `500`, `family_members` never contains both racers nor neither.
- `accept_fans_out_collection_event_to_existing_member_over_websocket` (Task 2) — a real bound server (`common::test_server`) and a real `tokio_tungstenite` WebSocket connection prove an existing collection member receives a live `EntityType::Collection` frame (`change_type: "update"`, `id` = the joined collection) the instant a brand-new invitee's `accept` commits.
- `invitation_metadata_collection_scoped_never_leaks_collection_enc_name` (Task 2) — creates a collection with a distinctive `enc_name`, fetches the pre-redemption metadata with the correct `invite_proof`, and asserts both (a) the response's key set is exactly the five documented fields and (b) `serde_json::to_string(&body)` does not contain the `enc_name` string anywhere as a substring.
- `invitation_id_alone_without_correct_proof_is_rejected_on_metadata_and_accept` (Task 2) — the Amendment 2 adversarial test T-24-07's `mitigate` disposition needed and previously lacked: three variants (empty / wrong-but-well-formed / malformed `invite_proof`) x two endpoints (`fetch_metadata`, `accept`) all render byte-identical bodies to a request against a genuinely unknown id, and none of the six attempts ever flips the real invite's status off `pending`.
- `referrer_policy_middleware` (`crates/pv-server/src/routes/mod.rs`) — sets `Referrer-Policy: strict-origin-when-cross-origin` on every response via `axum::middleware::from_fn`, layered at the exact same chain point `CorsLayer` already wraps `router_with_cors` (before the static-file fallback is attached), so a served `index.html`/asset also carries the header, not only `/api/*` responses. Proven by a new `healthz_response_carries_referrer_policy_header` unit test mirroring the existing `probe_router` idiom.

## Task Commits

Each task was committed atomically:

1. **Task 1: Genuinely concurrent double-redemption proof** - `375ea43` (test)
2. **Task 2: Real-WebSocket fan-out proof + adversarial metadata-leak + invite_id-alone rejection + Referrer-Policy** - `0d4aba7` (feat)

## Files Created/Modified
- `crates/pv-server/tests/invitations.rs` - added `concurrent_redemption_exactly_one_wins` (Task 1); added `publish_keypair`/`recv_ws_json`/`url_encode_token` local helpers plus `accept_fans_out_collection_event_to_existing_member_over_websocket`, `invitation_metadata_collection_scoped_never_leaks_collection_enc_name`, `invitation_id_alone_without_correct_proof_is_rejected_on_metadata_and_accept` (Task 2)
- `crates/pv-server/src/routes/mod.rs` - added `referrer_policy_middleware`, layered it alongside `cors` in `router_with_cors`, and added `healthz_response_carries_referrer_policy_header` to the existing `#[cfg(test)] mod tests`

## Decisions Made
- The original concurrency test design (reusing `common::test_pool()`, `max_connections(1)` on a bare `sqlite::memory:` URI) was rejected before being written — it would have serialized both racers on POOL ACQUISITION rather than the SQLite write lock, proving nothing about the exact `SQLITE_BUSY_SNAPSHOT` bug class this repo already shipped once (commit `c94c379`). Rebuilt per the plan's mandated pattern: a fresh `file:{uuid}?mode=memory&cache=shared` pool per trial with `busy_timeout(5s)`, mirroring `tests/collections.rs::revoke_access_last_key_holder_guard_is_atomic_under_concurrency` exactly.
- `referrer_policy_middleware` is layered at the identical point `cors` already wraps `router_with_cors` — verified this covers the static-file SPA fallback branch too, since `.fallback_service(...)` is attached to the already-`.layer()`-wrapped router and axum's layering wraps the whole `Router::call`, including internal fallback dispatch.
- The `invite_id`-alone adversarial test's three variants (empty / wrong-but-well-formed / malformed) deliberately exclude an outright-missing `invite_proof` JSON field — that fails `Json<T>` deserialization before the handler runs (axum's generic rejection), a distinction this codebase already accepts everywhere `Json<T>` is used.
- `publish_keypair`/`recv_ws_json`/`url_encode_token` are duplicated locally in `tests/invitations.rs` rather than exported from `tests/sync_shared.rs`, matching this codebase's established per-test-binary helper duplication convention (documented in each helper's own doc comment).

## Deviations from Plan

None - plan executed exactly as written. The plan's own `<critical_correctness_notes>` (avoid `max_connections` on a bare `:memory:` URI, avoid `tokio::join!` on raw futures, keep `busy_timeout`/`min_connections(1)`) were followed to the letter and verified working on the first test run.

## Issues Encountered

None. Both tasks' tests passed on the first `cargo build`/`cargo test` cycle with no debugging iteration required — the underlying production code (Plan 24-02's `accept`/`fetch_metadata` handlers) was already correctly implemented; this plan's job was proving it adversarially, and the proofs confirmed the implementation is sound.

**Note on task-commit reconstruction:** both tasks touch `crates/pv-server/tests/invitations.rs`, and Task 2's edits (import line, helper functions, three new tests) were interleaved with Task 1's single trailing test block in a way that made a clean `git add -p` hunk split impossible for the final contiguous append region. To preserve atomic per-task commits, Task 2's additions were temporarily reverted from the working tree (verified against `git show HEAD:...` for `routes/mod.rs`, and a saved copy for the `invitations.rs` helper/test sections), Task 1 was committed in isolation (rebuilt and re-tested to confirm it stood alone correctly), and Task 2's content was then restored and committed second. No content was lost; both isolated and combined states were rebuilt and re-tested at each step.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Plans 24-05 through 24-08 are unblocked. The phase's two sharpest claims (SC 4's "exactly one successful join" and FAM-05's "leaks no vault metadata") are now proven by tests that could actually catch a regression, and the Amendment 2 proof-of-possession guarantee (invite_id alone is provably insufficient) has the adversarial test its own `mitigate` threat-register disposition required. `Referrer-Policy` closes the one remaining information-disclosure gap CONTEXT.md flagged but did not implement. No blockers.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: none-new | crates/pv-server/tests/invitations.rs | This plan introduces zero new production attack surface — it is entirely test code proving guarantees Plan 24-02's `invitations.rs` module already implements (T-24-05's atomic guarded UPDATE, T-24-07's proof-of-possession gate, T-24-09's five-field metadata response). No new endpoint, no new column, no new trust boundary. |
| threat_flag: none-new | crates/pv-server/src/routes/mod.rs | `referrer_policy_middleware` is a strictly additive response-header layer (T-24-10, this plan's own threat register) with no read/write access to request state, session data, or the database — it cannot introduce a new information-disclosure or injection surface. Verified it does not interfere with `acao_header_for`-based CORS assertions (a different header, unaffected) or the structural route-scan tests (`router_literal_routes_match_documented_allowlist`, `router_wrapper_and_whole_file_route_scan_has_no_blind_spot`), which only scan for `.route(`/`.nest(`/`.merge(` calls — `.layer(...)` is not in that forbidden set and the full test suite confirms no regression. |

## Self-Check: PASSED

- `crates/pv-server/tests/invitations.rs` — FOUND, contains `concurrent_redemption_exactly_one_wins`, `accept_fans_out_collection_event_to_existing_member_over_websocket`, `invitation_metadata_collection_scoped_never_leaks_collection_enc_name`, `invitation_id_alone_without_correct_proof_is_rejected_on_metadata_and_accept` (verified via successful Edit/Read tool calls and `cargo test` output above).
- `crates/pv-server/src/routes/mod.rs` — FOUND, contains `referrer_policy_middleware` and `healthz_response_carries_referrer_policy_header`.
- Commits `375ea43` and `0d4aba7` — both FOUND in `git log --oneline` on the current branch.
- `cargo test -p pv-server --test invitations --test sync_shared -- --test-threads=2` — 32 tests, all pass.
- `cargo test -p pv-server routes::tests` — 23 tests, all pass.
- `cargo test -p pv-server` (full workspace crate suite) — all green, zero failures.
- `concurrent_redemption_exactly_one_wins` re-run 5 times total across this session (well over the mandated 3 consecutive runs) — deterministic pass every time.
- `cargo test -p pv-server --test collections revoke_access_last_key_holder_guard_is_atomic_under_concurrency` (the analog) — still passes, `git diff --stat -- crates/pv-server/tests/collections.rs` confirms the file is untouched.

---
*Phase: 24-invitation-flow-no-smtp*
*Completed: 2026-07-31*
