---
phase: 23-sync-model-extension-shared-data-fan-out
plan: 03
subsystem: api
tags: [sync, websocket, sqlite, sqlx, axum, sharing, error-handling]

# Dependency graph
requires:
  - phase: 23-sync-model-extension-shared-data-fan-out
    provides: "resolve_recipients/bump_collection_revision/bump_recipients_vault_revision helper trio, EntityType::Collection, SyncHub::publish_to_recipients, vault_items.last_editor_user_id (Plan 23-01)"
provides:
  - "ApiError::StaleRevisionShared { message, last_editor_email } — its own IntoResponse wire shape, isolated from ApiError::Conflict"
  - "update()'s 409 conflict branch attributes shared-item conflicts to the current last editor's email; personal-item conflicts stay byte-identical"
  - "collections::add_member/revoke_access emit EntityType::Collection events to the freshly-resolved recipient set"
affects: [23-05-client-sync-engine]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "IntoResponse match arm with an early return for a variant whose JSON body needs an extra field beyond the uniform (status, message) tuple every other arm shares"
    - "resolve_collection_recipients: a fresh SELECT recipient_user_id FROM collection_keys, called AFTER the mutating INSERT/DELETE so the recipient set structurally reflects post-mutation membership — mirrors vault.rs::resolve_recipients's same discipline for collections.rs"

key-files:
  created: []
  modified:
    - crates/pv-server/src/error.rs
    - crates/pv-server/src/routes/vault.rs
    - crates/pv-server/src/routes/collections.rs
    - crates/pv-server/tests/vault.rs
    - crates/pv-server/tests/collections.rs

key-decisions:
  - "StaleRevisionShared's IntoResponse arm returns early from inside the match expression (not before it) — keeps the match's other arms' code shape unchanged and documents the deviation exactly where a reader hits it, matching 23-PATTERNS.md's prescribed shape"
  - "The shared-vs-personal disambiguation and the last_editor_email lookup are combined into ONE follow-up SELECT (is_shared computed alongside a LEFT JOIN users), rather than two round trips — the existing exists-vs-not-found follow-up query already had to run, so extending its column list costs nothing extra"
  - "collections.revision is NOT bumped by add_member/revoke_access — only item mutations bump it (SYNC-04); the membership-change event carries the collection's current, unbumped revision, matching the client contract that ANY Collection-typed event means 'drop any cached Collection Key and re-fetch'"

patterns-established:
  - "Membership-change fan-out: resolve recipients fresh via a plain SELECT (no transaction needed — collection_keys writes here are already single-statement) AFTER the mutating INSERT/DELETE, then publish_to_recipients — the collections.rs analog to vault.rs's resolve_recipients-inside-tx pattern for item mutations"

requirements-completed: [SYNC-05, SYNC-06]

coverage:
  - id: D1
    description: "ApiError::StaleRevisionShared added as a new, isolated variant — ApiError::Conflict's wire shape stays byte-identical for its 15+ other call sites"
    requirement: "SYNC-06"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#stale_revision_conflict_attribution_on_personal_item_has_no_last_editor_email_key"
        status: pass
      - kind: other
        ref: "grep -F 'StaleRevisionShared' crates/pv-server/src/error.rs (new variant present, Conflict arm untouched)"
        status: pass
    human_judgment: false
  - id: D2
    description: "update()'s conflict branch attributes a shared item's stale-revision 409 to the current last editor's email (nullable when never edited since Migration 0015); personal items keep the exact existing generic conflict body"
    requirement: "SYNC-06"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#stale_revision_conflict_attribution_on_shared_item_returns_last_editor_email"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#stale_revision_conflict_attribution_on_personal_item_has_no_last_editor_email_key"
        status: pass
    human_judgment: false
  - id: D3
    description: "collections::add_member/revoke_access emit EntityType::Collection events to the correctly-scoped recipient set, resolved fresh after the mutating INSERT/DELETE — a just-added member starts receiving events immediately and a just-removed member stops and is never itself notified of the removal, proven with a real bound WebSocket"
    requirement: "SYNC-05"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#membership_change_events_add_then_remove_live"
        status: pass
    human_judgment: false

duration: 22min
completed: 2026-07-30
status: complete
---

# Phase 23 Plan 03: 409 Conflict Attribution + Collection Membership Events Summary

**A new isolated `ApiError` variant attributes shared-item stale-revision 409s to the last editor's email without touching `Conflict`'s existing wire shape, and `collections.rs`'s `add_member`/`revoke_access` now fan out `EntityType::Collection` events to a membership set resolved fresh at emit time — a live WebSocket test proves both the add and remove directions.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-07-30T14:55:00Z (approx.)
- **Completed:** 2026-07-30T14:58:58Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- `ApiError::StaleRevisionShared { message, last_editor_email }` is a NEW variant with its own `IntoResponse` arm (an early return, since its JSON body carries an extra key the uniform `(status, message)` tuple can't express) — `ApiError::Conflict`'s wire shape is untouched, verified by a test asserting the personal-item 409 body has exactly the `error` key.
- `update()`'s existing exists-vs-not-found disambiguation is extended with ONE combined follow-up query: is the item shared (`collection_id IS NOT NULL` or an `item_shares` row), and if so, what's `last_editor_user_id`'s email via `LEFT JOIN users`. Shared items get `StaleRevisionShared`; personal items keep the byte-identical `Conflict("stale revision")`.
- `collections::add_member` and `collections::revoke_access` both now call a new `resolve_collection_recipients` helper AFTER their mutating `INSERT`/`DELETE`, then `publish_to_recipients` an `EntityType::Collection` event — membership resolution is fresh at emit time, never cached, so a just-added member is naturally included and a just-removed member is naturally excluded with zero invalidation logic.
- A new live test (`membership_change_events_add_then_remove_live`) proves the full SC 2 sequence end-to-end against a real bound socket: B's already-open WS receives a Collection frame right after being added, another after the owner's next item mutation, and then ZERO frames (500ms timeout) after B is removed and the owner mutates again.

## Task Commits

Each task was committed atomically:

1. **Task 1: ApiError::StaleRevisionShared + update()'s attributed 409** - `f17e16f` (feat)
2. **Task 2: collections.rs membership-change events + SC2 live add/remove test** - `947d844` (feat)

## Files Created/Modified

- `crates/pv-server/src/error.rs` - new `ApiError::StaleRevisionShared` variant with its own `IntoResponse` arm
- `crates/pv-server/src/routes/vault.rs` - `update()`'s conflict branch extended with the shared-vs-personal disambiguation + attribution query
- `crates/pv-server/src/routes/collections.rs` - new `resolve_collection_recipients` helper; `add_member`/`revoke_access` both emit `EntityType::Collection` events after their mutation
- `crates/pv-server/tests/vault.rs` - two new tests: shared-item attribution, personal-item byte-identical shape
- `crates/pv-server/tests/collections.rs` - new live WS test proving add/remove membership fan-out

## Decisions Made

- The `IntoResponse` early-return lives INSIDE the match expression's `StaleRevisionShared` arm, not before the match — keeps every other arm's code untouched and puts the deviation comment exactly where a reader encounters it, matching 23-PATTERNS.md's prescribed shape over the alternative of an `if let` guard before the match.
- The shared/personal disambiguation and the last-editor-email lookup are combined into a single follow-up SQL query (computing `is_shared` alongside a `LEFT JOIN users` for the email) rather than two separate queries — the existing exists-vs-not-found follow-up already had to run in this code path, so extending its column list is free; a second round trip would not be.
- `collections.revision` is deliberately NOT bumped by `add_member`/`revoke_access` — only item mutations bump it per SYNC-04's design. The membership-change event simply carries the collection's current (unbumped) revision, which is sufficient because the client contract for any `Collection`-typed event is "drop any cached Collection Key and re-fetch," not "compare against a specific revision number."

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria (grep checks + `cargo test`) passed without needing any Rule 1-4 auto-fixes.

## Issues Encountered

None — both tasks' tests passed on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `ApiError::StaleRevisionShared` is ready for Plan 23-05's client-side conflict-attribution UI work (`DetailPanel.tsx`'s `revision-conflict-banner`) to consume `last_editor_email` from the 409 body.
- `collections.rs`'s membership-change events close the other half of SYNC-05's live-effect guarantee (Plan 23-01 closed it for item mutations inside an existing collection; this plan closes it for the membership-change moment itself).
- No blockers. `cargo test -p pv-server --test vault --test collections` and `cargo test --workspace` both exit 0 (all pre-existing tests plus 3 new tests in this plan).

---
*Phase: 23-sync-model-extension-shared-data-fan-out*
*Completed: 2026-07-30*

## Self-Check: PASSED

- FOUND: crates/pv-server/src/error.rs (StaleRevisionShared variant present)
- FOUND: crates/pv-server/src/routes/vault.rs (attribution query present)
- FOUND: crates/pv-server/src/routes/collections.rs (resolve_collection_recipients + publish_to_recipients call sites present)
- FOUND: crates/pv-server/tests/vault.rs (2 new tests present)
- FOUND: crates/pv-server/tests/collections.rs (1 new live test present)
- FOUND: commit f17e16f (Task 1)
- FOUND: commit 947d844 (Task 2)
