---
phase: 26-web-app-sharing-ui-family-management
plan: 04
subsystem: api
tags: [rust, axum, sqlx, sqlite, sharing, authorization, typescript]

# Dependency graph
requires:
  - phase: 25-member-removal-suspension-re-key
    provides: "family_members.status suspend/reinstate toggle, Item/Collection::resolve_access's fm.status = 'active' authorization predicate"
  - phase: 26-01
    provides: "Wire-contract fixes this plan builds on top of (client-minted collection id, etc.)"
provides:
  - "GET /api/vault/items/{id}/shares — the missing read path for a personal item's direct-share recipient set, Membership<Item, RequireRead>-gated"
  - "suspended: bool field on BOTH collections::access_list and the new list_item_shares — one shared CoRecipientRecord vocabulary across collection-scoped and direct shares"
  - "web/src/lib/vault/api.ts::listItemShares + ItemShareEntry client wrapper; CollectionAccessEntry gains suspended"
affects: [26-06 (AvatarStack data source), 26-11 (Sharing overview)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Read-path listing endpoints flag suspended recipients rather than filtering them (A-7) — the authorization gate (Item/Collection::resolve_access) and the visibility listing (access_list/list_item_shares) are deliberately different questions answered by different queries: one enforces access NOW, the other discloses the full grant set including currently-unusable-but-restorable ones."
    - "Chaining a new HTTP method onto an already-registered membership_routes() tuple entry (get(...).post(...)) instead of adding a new vec row, to keep the cardinality tripwire test's assertion stable across additive route changes."

key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/vault.rs
    - crates/pv-server/src/routes/collections.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/vault.rs
    - crates/pv-server/tests/collections.rs
    - web/src/lib/vault/api.ts

key-decisions:
  - "CoRecipientRecord (struct) is reused verbatim from collections.rs for the new item-scoped endpoint rather than defining a parallel type — one server-side shape backs both client-side interfaces (CollectionAccessEntry, ItemShareEntry), matching the plan's explicit instruction and the D-3/D-1 'one vocabulary' requirement."
  - "The item_shares suspended-status join is scoped to the RECIPIENT's own family_members row only (fm.user_id = s.recipient_user_id), not the owner-then-recipient double join Item::resolve_access uses — this endpoint is a listing over an already-membership-gated resource, not a fresh authorization decision, so it only needs the recipient's own status, matching the plan's exact query."

patterns-established:
  - "Suspended-but-visible listing pattern: flag via a computed (fm.status = 'suspended') AS suspended boolean column read with try_get::<bool,_>, never a WHERE fm.status = 'active' filter, for any endpoint whose job is disclosure rather than access enforcement."

requirements-completed: [SHARE-02, UX-05]

coverage:
  - id: D1
    description: "GET /api/vault/items/{id}/shares returns a personal item's direct-share recipients, Membership<Item, RequireRead>-gated"
    requirement: "SHARE-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#list_item_shares_returns_active_and_flags_suspended_recipient"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#list_item_shares_for_non_member_is_404"
        status: pass
    human_judgment: false
  - id: D2
    description: "Suspended recipients are returned and flagged (never filtered) on both list_item_shares and collections::access_list, per A-7"
    requirement: "UX-05"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/vault.rs#list_item_shares_returns_active_and_flags_suspended_recipient"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#access_list_flags_suspended_co_recipient_without_filtering"
        status: pass
    human_judgment: false
  - id: D3
    description: "web/src/lib/vault/api.ts client wrapper (listItemShares) and ItemShareEntry/CollectionAccessEntry interfaces typecheck against the extended wire shape"
    verification:
      - kind: other
        ref: "cd web && npx tsc --noEmit (clean, 0 errors)"
        status: pass
    human_judgment: false

# Metrics
duration: 35min
completed: 2026-08-06
status: complete
---

# Phase 26 Plan 04: Item-Scoped Share Listing + Suspended Flag Summary

**`GET /api/vault/items/{id}/shares` (Membership<Item, RequireRead>-gated) plus a shared `suspended` field on both direct-share and collection-share listing endpoints, closing the "who is this item shared with" read-path gap for personal items.**

## Performance

- **Duration:** 35 min
- **Completed:** 2026-08-06T09:24:37Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Added `pub async fn list_item_shares` to `vault.rs`, mirroring `collections::access_list`'s shape byte-for-byte (struct, handler, error handling), gated by `Membership<Item, RequireRead>` — never `FamilyMembership<RequireEdit>`, the owner-only gate that would have answered the wrong question for this endpoint's actual callers.
- Extended the shared `CoRecipientRecord` struct with `pub suspended: bool` and updated BOTH `access_list`'s and the new `list_item_shares`'s SQL to compute it via a `family_members` join, so a suspended member's grant is flagged, never filtered — per A-7, the exact treatment `access_list` already gave collection-scoped shares (no status filter at all) is now explicit and visible.
- Registered `GET` on the already-existing `/api/vault/items/{id}/shares` route entry as a chained method (`get(vault::list_item_shares).post(vault::create_share)`), keeping `membership_routes().len()` at its pre-plan value (11) — the cardinality tripwire test passes unchanged.
- Added `listItemShares` + `ItemShareEntry` to `web/src/lib/vault/api.ts` and `suspended: boolean` to the existing `CollectionAccessEntry` interface — field-for-field identical shapes, one vocabulary for D-3's avatar stack and D-1's Sharing overview.

## Task Commits

Each task was committed atomically, TDD RED → GREEN for Task 1:

1. **Task 1 RED — failing tests** - `3173888` (test)
2. **Task 1 GREEN — implementation** - `3401bec` (feat)
3. **Task 2 — client wrapper** - `99be3f0` (feat)

_Task 1's RED phase was proven by temporarily reverting the three src files (`git checkout --` on exactly those paths, then reapplying via a saved patch) and confirming both new vault.rs tests failed with 405 (route not yet registered) and the new collections.rs test failed on the co-recipient count — a clean compile-and-fail, not a compile error, then GREEN restored the implementation and all tests passed._

## Files Created/Modified
- `crates/pv-server/src/routes/vault.rs` - New `list_item_shares` handler; imports `CoRecipientRecord` from `collections.rs`
- `crates/pv-server/src/routes/collections.rs` - `CoRecipientRecord` gains `suspended: bool`; `access_list`'s query gains the `family_members` join
- `crates/pv-server/src/routes/mod.rs` - `.get(vault::list_item_shares)` chained onto the existing `/api/vault/items/{id}/shares` tuple entry
- `crates/pv-server/tests/vault.rs` - `list_item_shares_returns_active_and_flags_suspended_recipient`, `list_item_shares_for_non_member_is_404`
- `crates/pv-server/tests/collections.rs` - `access_list_flags_suspended_co_recipient_without_filtering`
- `web/src/lib/vault/api.ts` - `listItemShares`, `ItemShareEntry`; `CollectionAccessEntry` gains `suspended`

## Decisions Made
- Reused `CoRecipientRecord` verbatim across both endpoints (no parallel type) — the plan's explicit instruction and the only way D-3/D-1 get one client-side vocabulary for both share kinds.
- The new endpoint's `family_members` join checks only the RECIPIENT's own row (`fm.user_id = s.recipient_user_id`), not the owner-then-recipient double join `Item::resolve_access` uses for its authorization decision — this endpoint runs strictly AFTER `Membership<Item, RequireRead>` has already authorized the caller, so it only needs to report each recipient's own status, not re-derive access.

## Deviations from Plan

None — plan executed exactly as written. The query, extractor choice, struct reuse, and route-registration shape all match 26-04-PLAN.md's `<action>` block precisely.

## Issues Encountered
- A fresh worktree had no `node_modules` in `web/` or `packages/pv-ui/`, and no WASM artifacts — resolved per the environment note (`npm ci` in both, `bash scripts/build-wasm.sh`) before `npx tsc --noEmit` could run clean.
- My first draft of `access_list_flags_suspended_co_recipient_without_filtering` asserted 2 co-recipient entries, forgetting `access_list` also lists the collection CREATOR's own `collection_keys` row — corrected to 3 during the RED phase before GREEN.

## User Setup Required
None - no external service configuration required.

## Threat Flags

**Authorization guard used:** `Membership<Item, RequireRead>` — the same extractor family `collections::access_list` uses for its own resource kind, resolved fresh from the DB on every request via `Item::resolve_access` (never cached, never trusted from a session/token field). "Caller has ANY access to this item" authorizes the listing; "caller is the item's owner" is deliberately NOT the gate — any member the item is shared TO must also be able to see who else holds a share on it (mirrors the sibling `collections::access_list`'s "any member with any access level" contract, and matches this codebase's one documented boundary mechanism, `membership.rs`'s module doc: "there is no per-handler `if caller_is_member(...)` anywhere in this codebase, and there must never be one").

**What a non-authorized caller observes:** `Item::resolve_access` resolving to `None` (no owner match, no `item_shares` row, no collection membership) is mapped by the shared `gate::<M>()` fn to `ApiError::NotFound` (404) — the SAME 404 a request against a nonexistent item id would produce. A caller with zero relationship to the item cannot distinguish "this item doesn't exist" from "this item exists but I have no access to its recipient list" — confirmed live by `list_item_shares_for_non_member_is_404`. This closes the 403-vs-404 oracle risk the plan's own threat model flagged (T-26-08): a differentiated status code here would let an attacker enumerate real item ids by observing which ones return 403 instead of 404.

**Response field discipline:** `CoRecipientRecord`'s field list is a closed set (`user_id`, `email`, `access_level`, `created_at`, `suspended`) built by hand from named `SELECT` columns, never a `SELECT *` or a passthrough of the DB row — `sealed_key` is never queried by either endpoint's SQL in the first place, so there is no code path that could leak it even by omission-bug. `list_item_shares_returns_active_and_flags_suspended_recipient` asserts this two ways: a raw-string substring check on the full response body (`!raw_text.contains("sealed_key")`, also checking the literal ciphertext values never leak) plus a closed-key-set assertion (`keys == vec!["access_level", "created_at", "email", "suspended", "user_id"]`) on every entry — key-absence, not "not checked" (T-22-16 discipline).

**T-26-09 (accepted, per A-7):** a suspended recipient remains visible in the listing with `suspended: true`. This is the plan's deliberate, documented disclosure-honesty choice, not a new finding — noted here for completeness since it is a real information-disclosure-adjacent behavior change to an existing endpoint (`access_list`) as well as new behavior on `list_item_shares`.

**No key material or plaintext:** Neither endpoint's query, response struct, or any log statement touches `sealed_key`, `enc_key`, or any decrypted content — both remain pure metadata listings (who, what access level, when, suspended-or-not), consistent with the project's zero-knowledge constraint.

## Next Phase Readiness
- The wire-level data source both D-3's avatar stack and D-1's Sharing overview need for a personal item's direct shares now exists and is tested against real access-control behavior (active + suspended + non-member).
- `web/src/lib/vault/api.ts::listItemShares` is ready for a UI plan to consume directly; `ItemShareEntry`/`CollectionAccessEntry` share a field shape so a single rendering component can serve both share kinds.
- No blockers for downstream plans in this phase.

---
*Phase: 26-web-app-sharing-ui-family-management*
*Completed: 2026-08-06*

## Self-Check: PASSED

- FOUND: crates/pv-server/src/routes/vault.rs (list_item_shares present)
- FOUND: crates/pv-server/src/routes/collections.rs (suspended field present)
- FOUND: crates/pv-server/src/routes/mod.rs (route chained)
- FOUND: crates/pv-server/tests/vault.rs (new tests present, passing)
- FOUND: crates/pv-server/tests/collections.rs (new test present, passing)
- FOUND: web/src/lib/vault/api.ts (listItemShares, ItemShareEntry present)
- FOUND commit 3173888 (test)
- FOUND commit 3401bec (feat)
- FOUND commit 99be3f0 (feat)
- cargo build --workspace: clean
- cargo test --workspace -p pv-server: all passing (61 in mod.rs lib unit tests, 24 vault.rs, 19 collections.rs, plus rest of suite)
- cd web && npx tsc --noEmit: clean, 0 errors
- cd web && npx vitest run src/lib/vault/: 21 files, 162 tests passing
