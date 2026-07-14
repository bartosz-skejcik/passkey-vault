---
phase: 5
slug: multi-device-sync
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-14
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from 05-RESEARCH.md § Validation Architecture and the 4-plan/8-task breakdown.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | cargo test (pv-server, incl. new `tests/sync.rs` — both `oneshot()`-based REST tests and a new real-socket WS harness) + vitest (web) |
| **Config file** | Cargo.toml (workspace); web/vitest.config.ts |
| **Quick run command** | `cargo test -p pv-server --test sync` / `npm --prefix web test -- sync` |
| **Full suite command** | `cargo test --workspace && (cd web && npm test) && (cd web && npm run build)` |
| **Estimated runtime** | ~120 seconds |

---

## Sampling Rate

- **After every task commit:** Run the crate/package-scoped test for the touched surface (`cargo test -p pv-server --test sync` or `cd web && npm test -- <file>`)
- **After every plan wave:** Run full suite (`cargo test --workspace` and `npm --prefix web test`)
- **Before `/gsd-verify-work`:** Full suite must be green; a manual two-tab cross-device check is recommended (see Manual-Only Verifications) but is non-blocking
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 01 | 1 | SYNC-01 | — | Every vault/folder mutation atomically bumps `users.vault_revision` via a single `UPDATE ... SET x = x + 1 ... RETURNING` statement (never SELECT-then-UPDATE); `list()` handlers deduped into `fetch_items_for`/`fetch_folders_for` | integration (Rust) | `cargo test -p pv-server --test vault` | ✅ (existing, must stay green) | ⬜ pending |
| 05-01-02 | 01 | 1 | SYNC-01 | T-05-01, T-05-02 | `GET /api/sync?since=N` cheap-checks (`pull_up_to_date_returns_no_body`), returns a full snapshot when stale (`pull_stale_returns_full_snapshot`), bumps monotonically (`mutation_bumps_vault_revision`), and is user-scoped (`sync_is_scoped_to_the_authenticated_user`) | integration (Rust) | `cargo test -p pv-server --test sync` | ❌ Wave 0 (new file) | ⬜ pending |
| 05-02-01 | 02 | 2 | SYNC-02 | T-05-04, T-05-05, T-05-06 | `SyncHub`/`SyncEvent` exist; `validate_token` is the single session-hash-lookup implementation reused by REST and WS; `GET /api/sync/ws` upgrades only a validated token | build/regression (Rust) | `cargo test -p pv-server --test auth --test vault --test sync` | ✅ (existing, must stay green) | ⬜ pending |
| 05-02-02 | 02 | 2 | SYNC-02 | T-05-04, T-05-05 | `ws_rejects_invalid_token`, `ws_event_contains_no_ciphertext` (exact 4-key frame assertion), `ws_cross_user_isolation` — real-socket harness via `test_server()` + `tokio-tungstenite` | integration (Rust, real TCP socket) | `cargo test -p pv-server --test sync` | ❌ Wave 0 (new tests + new `test_server()` harness) | ⬜ pending |
| 05-03-01 | 03 | 3 | SYNC-01, SYNC-02 | T-05-09, T-05-10 | WS reconnect backoff (jittered, capped, strictly increasing across drops); `stopSync()` genuinely prevents a trailing-close reconnect (`intentionalStop` guard under direct test); poll timer fires independently of WS state | unit (vitest, mocked WebSocket + fake timers) | `npm --prefix web test -- sync.test.ts` | ❌ Wave 0 (new file) | ⬜ pending |
| 05-03-02 | 03 | 3 | SYNC-01, SYNC-03 | — | `applySyncSnapshot` replaces items/folders wholesale (deletion via absence); up-to-date snapshot leaves in-memory state untouched but advances the revision watermark; unlock/lock lifecycle starts/stops sync exactly once each; unrelated-item merge does not corrupt sibling entries | unit (vitest) | `npm --prefix web test -- store.test.ts` | ✅ (existing, extended) | ⬜ pending |
| 05-04-01 | 04 | 4 | SYNC-03 | — | Sync-status dot renders ONLY for `"reconnecting"`; error-toast `variant` field is additive/backward-compatible | component (vitest) | `npm --prefix web test -- "Sidebar\|ErrorToast"` | ✅ (existing, extended) | ⬜ pending |
| 05-04-02 | 04 | 4 | SYNC-03 | T-05-12 | `wasRemotelyDeleted` predicate (3 cases); proactive live-edit-conflict banner never clobbers unsaved typing until Refresh is explicitly clicked; banner absent for a never-edited item | unit + component (vitest) | `npm --prefix web test -- "DetailPanel\|remoteDelete"` | ❌ Wave 0 (remoteDelete.test.ts new; DetailPanel.test.tsx extended) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `crates/pv-server/tests/sync.rs` — new integration test file covering SYNC-01's pull endpoint (reuses existing `tests/common/mod.rs` `oneshot()` harness) and SYNC-02's WS handshake/frame/isolation behavior (new real-socket harness)
- [ ] `crates/pv-server/tests/common/mod.rs` — extended with `test_server(pool) -> (Router, u16)`, binding a real `TcpListener` + spawning `axum::serve`, sharing the SAME `AppState`/`SyncHub` as the returned `Router` clone used for `oneshot()`-driven mutations in the same test
- [ ] `web/src/lib/vault/sync.test.ts` — new vitest file for the WS client, reconnect/backoff, and poll-timer logic (`vi.stubGlobal("WebSocket", MockWebSocketClass)` + `vi.useFakeTimers()` — this codebase's first WS-mocking convention)
- [ ] `web/src/lib/vault/remoteDelete.test.ts` — new vitest file for the pure `wasRemotelyDeleted` predicate (no React rendering needed)
- [ ] Framework install: `tokio-tungstenite = "0.30"` `[dev-dependencies]` addition to `crates/pv-server/Cargo.toml` (Plan 05-02, already Package-Legitimacy-audited OK in 05-RESEARCH.md) covers the server-side WS-testing gap; vitest needs no new npm package (native `vi.stubGlobal`/`vi.useFakeTimers`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|--------------------|
| Real two-tab/two-device live sync (create in tab A, watch it appear in tab B without refresh) | SYNC-01, SYNC-02, SYNC-03 | End-to-end WS+poll behavior across two real browser contexts is not covered by any single automated test (each layer is unit/integration-tested in isolation) | Morning review: run `cargo run -p pv-server` + `npm --prefix web run dev`, open two browser tabs/profiles logged into the same account, unlock both, create/edit/delete an item in tab A, confirm it appears in tab B within ~1s (WS) and within 30s even with DevTools throttling the WS closed (poll fallback) |
| Sync-status dot / live-edit-conflict banner / remote-delete toast visual taste | SYNC-03, UI-05-adjacent | Aesthetic judgment (05-UI-SPEC.md's "Morning review notes" flags 4 discretionary taste calls made autonomously overnight) | Morning review with screenshots per 05-UI-SPEC.md's Morning review notes — none are blocking, all are reversible follow-ups |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all `❌` references from the per-task verification map
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-07-14 (generated during autonomous overnight run; map populated from the final 4-plan/8-task breakdown)
