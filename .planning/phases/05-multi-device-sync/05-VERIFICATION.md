---
phase: 05-multi-device-sync
verified: 2026-07-14T16:00:00Z
status: human_needed
score: 10/10 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "Two live browser sessions (same account, both unlocked). In tab A create an item, then edit it, then delete it. Watch tab B with no manual refresh."
    expected: "Each change appears in tab B within a second or two (WS push) — and at worst within ~30s (poll fallback). Deletion removes the row from tab B's list. No page reload needed."
    why_human: "Automated tests mock the WebSocket and use fake timers; the real browser WebSocket ↔ pv-server ↔ store-merge round trip is only exercisable with two live clients (Playwright self-validation)."
  - test: "Two live tabs both open the SAME item in edit mode. In tab A change a field and Save. Then in tab B (still editing the stale copy) change a different field and Save."
    expected: "Tab B's second save surfaces the conflict path (proactive live-edit-conflict banner and/or reactive 409 banner) rather than silently overwriting tab A's change. An UNRELATED item edited in parallel is never corrupted. Success criterion #3 (last-write-wins visible, no silent corruption of unrelated items)."
    why_human: "The concurrent-edit conflict is a live cross-client timing invariant; unit/integration tests prove each half (server 409 on stale revision, client baseline-revision fix CR-01) but not the true two-live-client race."
  - test: "With a live unlocked session, kill/restore the pv-server WebSocket (stop the server briefly, or drop the network) and watch the sidebar account avatar."
    expected: "A small pulsing warning dot appears on the avatar ONLY while reconnecting; it is invisible in the connected and locked/offline states. Reconnect happens on backoff, not a retry storm."
    why_human: "Requires a real WS drop against a running server to observe the reconnecting presence state end-to-end."
  - test: "Tab A has an item open in the detail panel (view mode). Tab B deletes that same item."
    expected: "In tab A the detail panel auto-closes and a calm INFO (not error) toast explains the item was changed/removed on another device — never a phantom detail view pointing at nothing."
    why_human: "Live cross-tab deletion propagation into the open detail panel; the pure predicate and toast wiring are unit-tested, the live experience is Playwright-validated."
  - test: "Tab A is EDITING an item with unsaved typed changes in a field. Tab B saves an edit to that same item."
    expected: "In tab A a proactive banner appears offering an explicit Refresh action with a consequence warning — WITHOUT wiping tab A's in-progress unsaved field values. Only clicking Refresh discards the draft and reloads fresh data."
    why_human: "Live cross-tab revision-change-while-editing; component test proves the non-destructive banner + Refresh remount, live propagation is Playwright-validated."
---

# Phase 5: Multi-Device Sync Verification Report

**Phase Goal:** A user's vault stays in sync across multiple simultaneously-active devices/sessions
**Verified:** 2026-07-14T16:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification (verified against current HEAD `1c6cf9c`, which includes the 4 post-review fix commits CR-01 `81f0e4f`, WR-01 `84e019d`, WR-02 `e221752`, fix-report `1c6cf9c`)

## Goal Achievement

Every code-level and test-level must-have is VERIFIED. All automated suites pass against current HEAD:

- `cargo test --workspace` — green. `tests/sync.rs` 7/7 including `ws_event_contains_no_ciphertext`, `ws_cross_user_isolation`, `sync_is_scoped_to_the_authenticated_user`, `mutation_bumps_vault_revision`; `tests/vault.rs` 13/13 including `update_with_stale_revision_is_conflict_and_blob_unchanged`.
- `web` vitest — 221/221 across 31 files, including `sync.test.ts`, `store.test.ts`, `DetailPanel.test.tsx` (CR-01 regression), `remoteDelete.test.ts`, `Sidebar.test.tsx`.
- `npx tsc --noEmit` — clean (exit 0).
- `cargo build -p pv-server` — zero warnings. No `TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER` debt markers in any phase-modified file.

Status is `human_needed` (not `passed`) solely because the phase goal — a vault staying in sync across **simultaneously-active** devices — is a live multi-client experience that no automated test in this repo can exercise (WebSocket is mocked, timers faked). Those live behaviors are enumerated for Playwright self-validation by the orchestrator. There are **zero gaps/blockers**.

### Observable Truths

| #  | Truth | Status | Evidence |
| -- | ----- | ------ | -------- |
| 1  | (SC1) `GET /api/sync?since=N` cheap-checks by revision — returns `{revision}` only when unchanged, full `{revision,items,folders}` snapshot when stale, scoped strictly to the caller's `user_id` | ✓ VERIFIED | `sync.rs::pull` (untagged `SyncResponse`, `WHERE id = session.user_id`); tests `pull_up_to_date_returns_no_body`, `pull_stale_returns_full_snapshot`, `sync_is_scoped_to_the_authenticated_user` pass |
| 2  | (SC2) WS push carries metadata only — exactly `{entity_type,id,revision,change_type}`, never ciphertext; cross-user isolation; invalid/missing token rejected at upgrade | ✓ VERIFIED | `sync.rs::SyncEvent` (4 fields only), `ws_handler` validates token before `on_upgrade`; real-frame tests `ws_event_contains_no_ciphertext` (asserts exact 4-key set), `ws_cross_user_isolation`, `ws_rejects_invalid_token` pass |
| 3  | Each mutation bumps `users.vault_revision` atomically with the row's own mutation, in one transaction (WR-01 fix) — no orphaned row / lagged counter | ✓ VERIFIED | `vault.rs` + `folders.rs`: `state.db.begin()` wraps the INSERT/UPDATE/DELETE (`&mut *tx`) AND the `vault_revision = vault_revision + 1 … RETURNING` bump (`&mut *tx`), `tx.commit()`, publish only after commit; `mutation_bumps_vault_revision` + full vault suite pass |
| 4  | (SC1 client) `applySyncSnapshot` replaces items/folders wholesale (deletion via absence), skips decrypt if the vault locked mid-fetch, leaves unrelated items untouched | ✓ VERIFIED | `store.ts::applySyncSnapshot` (lock-race guard `getUnlockedUserKey() === null`, conditional per-collection replace); `store.test.ts` cases for wholesale-replace, up-to-date-no-touch, unrelated-item-undisturbed pass |
| 5  | WS client reconnects on exponential backoff (±25% jitter, capped 30s) and a deliberate `stopSync()` is never undone by a stray trailing close; 30s poll fallback runs independently | ✓ VERIFIED | `sync.ts` (`intentionalStop` guard set in both start/stop, `ws === socket` stale-socket guard, `setInterval` poll); `sync.test.ts` proves increasing backoff, no-reconnect-after-stop, independent poll tick |
| 6  | (SC3) Live-edit save sends the edit's BASELINE revision as `expected_revision` (CR-01 fix) → a concurrent remote change actually triggers the server 409 → client conflict path, never a silent overwrite | ✓ VERIFIED | `DetailPanel.tsx:240` `currentRevision={editBaselineRevision ?? item.revision}`; `store.ts::updateVaultItem` maps 409→refetch+`RevisionConflictError`; server `update` returns `Conflict("stale revision")` on `WHERE … revision = ?` miss; `DetailPanel.test.tsx` regression (rev 1 baseline vs live rev 2) + `update_with_stale_revision_is_conflict_and_blob_unchanged` pass |
| 7  | No network chatter while locked — `startSync` on unlock, `stopSync` BEFORE clearing state on lock, watermark reset to 0 | ✓ VERIFIED | `store.ts` `subscribeLockState` side effect; `store.test.ts` "startSync/stopSync called exactly once each across unlock-then-lock" passes |
| 8  | (SC3 UI) Remote deletion of the open item closes the panel + calm INFO toast — never a phantom view | ✓ VERIFIED (component); live cross-tab → human | Pure predicate `remoteDelete.ts::wasRemotelyDeleted`, `page.tsx` effect fires `showErrorToast(..., {variant:"info"})` + clears `selectedItemId`/`openInEditMode`; `remoteDelete.test.ts` 3 cases pass. Live two-tab propagation → Human Verification #4 |
| 9  | (SC3 UI) Proactive live-edit-conflict banner appears without clobbering unsaved field values; explicit Refresh with consequence warning | ✓ VERIFIED (component); live cross-tab → human | `DetailPanel.tsx` `liveConflict` derived from live `item.revision` vs captured `editBaselineRevision`; `ItemForm key` remount only on Refresh; `DetailPanel.test.tsx` non-destructive-banner case passes. Live propagation → Human Verification #5 |
| 10 | (SC3 UI) Reconnecting-only presence dot on the account avatar — invisible when connected/offline | ✓ VERIFIED (component); live WS-drop → human | `Sidebar.tsx` renders dot only for `useSyncStatus() === "reconnecting"` with `role="status"`/`aria-live`; `Sidebar.test.tsx` asserts present only for reconnecting. Live WS drop → Human Verification #3 |

**Score:** 10/10 truths verified (0 present, behavior-unverified). All code+test evidence green; the live multi-client experience is routed to Human Verification per orchestrator instruction (Playwright self-validation).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `crates/pv-server/migrations/0010_vault_revision.sql` | `vault_revision` counter column | ✓ VERIFIED | Additive `ALTER TABLE users ADD COLUMN vault_revision INTEGER NOT NULL DEFAULT 0` |
| `crates/pv-server/src/routes/sync.rs` | pull + SyncHub/SyncEvent/ws_handler | ✓ VERIFIED | 195 lines; `pull`, `SyncEvent` (4 fields), `SyncHub` (subscribe/publish/prune), `ws_handler` (token-validated upgrade), `handle_socket` (select! loop) |
| `crates/pv-server/src/routes/vault.rs` | transactional bump + publish | ✓ VERIFIED | create/update/delete each: `begin()` → row mutation + counter bump on `tx` → `commit()` → `sync_hub.publish`; `fetch_items_for` helper reused by pull |
| `crates/pv-server/src/routes/folders.rs` | transactional bump + publish | ✓ VERIFIED | create/delete mirror vault.rs; `fetch_folders_for` helper reused by pull |
| `crates/pv-server/src/main.rs` | WS token log redaction (WR-02) | ✓ VERIFIED | `span_uri_field` strips query string for `/api/sync/ws`, preserves it elsewhere; 2 unit tests |
| `crates/pv-server/src/routes/session.rs` | single-source `validate_token` | ✓ VERIFIED | `pub(crate) validate_token` reused by both `SessionUser::from_request_parts` and `sync::ws_handler` |
| `web/src/lib/vault/sync.ts` | WS client + backoff + poll | ✓ VERIFIED | `startSync`/`stopSync`, intentionalStop guard, jittered backoff, onmessage deliberately unparsed |
| `web/src/lib/vault/syncStatus.ts` | 3-state status singleton + hook | ✓ VERIFIED | `setSyncStatus`/`getSyncStatus`/`subscribeSyncStatus`/`useSyncStatus` |
| `web/src/lib/vault/store.ts` | unified `applySyncSnapshot` merge | ✓ VERIFIED | single merge for initial-load + background sync; lock-race guard; lifecycle wiring |
| `web/src/lib/vault/remoteDelete.ts` | pure `wasRemotelyDeleted` predicate | ✓ VERIFIED | one pure function, 3 unit tests |
| `web/src/components/vault/DetailPanel.tsx` | proactive conflict banner + CR-01 baseline | ✓ VERIFIED | `editBaselineRevision` threaded as `currentRevision`; `liveConflict` banner + Refresh remount |
| `web/src/components/shell/Sidebar.tsx` | reconnecting-only dot | ✓ VERIFIED | gated on `useSyncStatus()`, `data-testid="sync-status-dot"` |
| `web/src/components/vault/ErrorToast.tsx` + `errorToast.ts` | info-variant toast | ✓ VERIFIED | additive `variant?: "error"\|"info"`, backward-compatible signature |
| `web/src/lib/i18n/dictionary.ts` | 5 sync copy keys | ✓ VERIFIED | all 5 keys present (`sync.reconnecting`, `itemChangedElsewhere`, `itemChangedElsewhereConsequence`, `refreshAction`, `itemDeletedElsewhere`) |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| `vault.rs`/`folders.rs` mutations | `users.vault_revision` | `UPDATE … vault_revision = vault_revision + 1 … RETURNING`, inside `tx` | ✓ WIRED |
| `vault.rs`/`folders.rs` mutations | `AppState.sync_hub.publish` | called after `tx.commit()` — 3 in vault.rs, 2 in folders.rs | ✓ WIRED |
| `sync.rs::pull` | `fetch_items_for`/`fetch_folders_for` | shared row-fetch helpers (no duplicated SELECT) | ✓ WIRED |
| `mod.rs` | `sync::pull` / `sync::ws_handler` | `.route("/api/sync", …)` + `.route("/api/sync/ws", …)` | ✓ WIRED |
| `session.rs::validate_token` | `sync.rs::ws_handler` | single hash-lookup reused by REST + WS auth | ✓ WIRED |
| `store.ts` lock lifecycle | `sync.ts::startSync/stopSync` | `subscribeLockState` gate | ✓ WIRED |
| `sync.ts` pullOnce | `api.ts::getSyncSnapshot` | `GET /api/sync?since=N` | ✓ WIRED |
| `sync.ts` WS client | `GET /api/sync/ws?token=` | browser WebSocket, token from `getSessionToken()` | ✓ WIRED |
| `page.tsx` | `remoteDelete.ts::wasRemotelyDeleted` | useEffect → info toast + selection reset | ✓ WIRED |
| `Sidebar.tsx` | `syncStatus.ts::useSyncStatus` | conditional reconnecting-dot render | ✓ WIRED |
| `DetailPanel.tsx` | `editBaselineRevision` vs live `item.revision` | proactive conflict detection (CR-01 baseline threaded to ItemForm) | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `store.ts` items/folders | `items`/`folders` | `getSyncSnapshot` → `GET /api/sync` → `fetch_items_for`/`fetch_folders_for` real SQLite SELECT | Yes | ✓ FLOWING |
| `sync.rs::pull` snapshot | `revision`/`items`/`folders` | real `SELECT vault_revision` + row-fetch helpers | Yes | ✓ FLOWING |
| WS frame | `SyncEvent` | `sync_hub.publish` on real mutation (proven by `ws_event_contains_no_ciphertext` real socket) | Yes (metadata only) | ✓ FLOWING |
| `Sidebar` dot | `syncStatus` | `setSyncStatus` from real WS onopen/onclose | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Rust workspace suite | `cargo test --workspace` | all suites pass (sync 7/7, vault 13/13, others green) | ✓ PASS |
| Sync integration (named) | `cargo test -p pv-server --test sync` | 7/7 pass | ✓ PASS |
| No-ciphertext frame | `cargo test … ws_event_contains_no_ciphertext` | pass (exact 4-key set on real socket) | ✓ PASS |
| Stale-revision conflict / blob unchanged | `cargo test … update_with_stale_revision_is_conflict_and_blob_unchanged` | pass | ✓ PASS |
| Web suite | `npm test -- --run` | 221/221 pass | ✓ PASS |
| CR-01 regression | `DetailPanel.test.tsx` | pass (Save sends baseline rev 1, not live rev 2) | ✓ PASS |
| Type check | `npx tsc --noEmit` | exit 0, clean | ✓ PASS |

### Probe Execution

No probe scripts declared for this phase (`scripts/*/tests/probe-*.sh` not present). Not applicable — coverage is via cargo integration tests + vitest, both run above.

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
| ----------- | -------------- | ----------- | ------ | -------- |
| SYNC-01 | 05-01, 05-03 | Revision-gated full-snapshot pull (`GET /sync` cheap revision check) | ✓ SATISFIED | Truths 1, 4; sync.rs + store.ts + tests. REQUIREMENTS.md: Complete |
| SYNC-02 | 05-02, 05-03 | WS pushes metadata-only `{item_id, revision, change_type}`, never ciphertext | ✓ SATISFIED | Truth 2; SyncEvent 4-field + real-frame test. REQUIREMENTS.md: Complete |
| SYNC-03 | 05-03, 05-04 | Multi-device concurrent use; conflicts resolved per-item by revision | ✓ SATISFIED (code); live session → human | Truths 6, 8, 9, 10; server 409 + CR-01 client fix + conflict UI, all component/integration tested. Genuine two-live-client experience → Human Verification #1, #2 (Playwright) |

**Note (documentation lag, not a code gap):** `REQUIREMENTS.md` still marks SYNC-03 as `[ ]` / `Pending` (lines 33 and 121) while SYNC-01/SYNC-02 are `Complete`. The SYNC-03 deliverables (per-item 409 conflict resolution, CR-01 baseline-revision fix, remote-delete toast, proactive conflict banner, reconnecting dot) are all present and tested at HEAD. Recommend flipping SYNC-03 to Complete once the orchestrator's live Playwright pass confirms the end-to-end multi-device experience.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | none | — | No `TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER` in any phase-modified file; no stub/empty-return anti-patterns; `cargo build` zero warnings |

### Info-Level Deviations (deliberately unfixed per review scope — NOT blockers)

Per the code review fix report and the orchestrator's instruction, IN-01 and IN-02 were intentionally left unfixed and must not fail verification:

- **IN-01** (`sync.rs`): `SyncEvent.revision` carries per-item revision for create/update but the global `vault_revision` for delete/folders. Harmless today — the client deliberately never parses the WS payload (`sync.ts` `onmessage` is unconditionally a "go pull" trigger, confirmed at line 88). Latent trap for future clients only.
- **IN-02** (`store.ts:179`): `lastKnownRevision` advances before the `getUnlockedUserKey()` lock-race guard. Self-heals — a re-unlock always pulls with hardcoded `since=0`. Transient watermark inconsistency only, no data missed.

### Human Verification Required

Five live multi-client browser behaviors (see frontmatter `human_verification` for full test/expected/why). These are the ONLY items not exercisable by automated tests (WebSocket mocked, timers faked) — they realize the phase goal of *simultaneously-active* devices and are for Playwright self-validation by the orchestrator:

1. End-to-end two-tab create/edit/delete propagation via live WS + poll (SC1+SC2+SC3).
2. Concurrent same-item edit → conflict surfaced, unrelated item uncorrupted (SC3, last-write-wins visible).
3. Reconnecting-only presence dot on a real WS drop/restore.
4. Remote-delete of the open item → panel auto-close + calm info toast in the other tab.
5. Live-edit-conflict → proactive non-destructive Refresh banner in the editing tab.

### Gaps Summary

No gaps and no blockers. All server and client code for SYNC-01/02/03 exists at HEAD, is substantive, is fully wired, and passes every automated suite (`cargo test --workspace`, `npm test`, `tsc --noEmit`) including the three post-review fixes CR-01/WR-01/WR-02. The critical CR-01 lost-update defect — the one that would have made the conflict protection unreachable in exactly the multi-device scenario this phase advertises — is fixed and covered by a regression test. Status is `human_needed` purely because "stays in sync across simultaneously-active devices" is inherently a live multi-client experience; those behaviors are enumerated above for Playwright self-validation.

---

_Verified: 2026-07-14T16:00:00Z_
_Verifier: Claude (gsd-verifier)_
