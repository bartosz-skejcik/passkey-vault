---
phase: 30-the-living-group-family-wide-sharing
plan: 03
subsystem: api
tags: [rust, axum, sqlx, sqlite, invitations, zero-knowledge, family-sharing]

# Dependency graph
requires:
  - phase: 30-the-living-group-family-wide-sharing (30-01)
    provides: "30-DECISION-FSH-02.md's chosen mechanism and the additive invitation_family_wide_keys sibling table (migration 0019)"
provides:
  - "CreateInvitationRequest.family_wide_keys / InvitationPublicResponse.family_wide_keys -- the invite-time-wrap half of FSH-02, widening the invite wire contract additively"
  - "AcceptInvitationRequest.family_wide_sealed_keys -- accept() atomically grants N family-wide collections inside the SAME BEGIN IMMEDIATE transaction as the existing single-collection grant and family-membership insert"
  - "28 passing tests/invitations.rs integration tests (23 pre-existing, unmodified in intent, plus 5 new for Task 1 and 5 new for Task 2) proving the additive widening never regresses the existing single-collection-scope invite path"
affects: [30-04, 30-05, 30-06, 30-07, 30-08, 30-09, 30-10, 30-11, 30-12, 30-13, 30-14, 30-15, 30-16, 30-17]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Additive wire-contract widening: a new Vec field on an existing request/response struct, #[serde(default)] on the request side, never a repurposed singular field -- mirrors the schema's own additive-sibling-table discipline at the Rust type layer"
    - "Per-entry validation loop BEFORE any DB work, reusing the exact same validators (parse_access_level_from_request, validate_blob_len, require_collection_edit) the existing singular-field validation already calls -- one canonical validator, N call sites"
    - "Server-side access_level is always read from the invitation's own stored row inside the transaction, never trusted from the accept-time request body -- the request only supplies the recipient-encrypted sealed_for_self blob"

key-files:
  created: []
  modified:
    - crates/pv-server/src/routes/invitations.rs
    - crates/pv-server/tests/invitations.rs

key-decisions:
  - "A transaction (state.db.begin()) is now used unconditionally in create(), even for a family_wide_keys-empty request -- keeps the empty-array path a single code path (never a special case) with byte-identical end state to the pre-plan single-statement version"
  - "The plan's Task 1 behavior prose says a caller lacking edit on a family_wide_keys collection_id gets '400' -- the actual require_collection_edit/gate() call this validation reuses returns ApiError::NotFound (404) for no-access-at-all, matching every other no-access check in this codebase (membership.rs's own documented None -> NotFound rule). Implemented and tested against the ACTUAL 404 behavior, not the plan's imprecise prose -- this is the same check every other collection-edit gate in the codebase already uses, so a different status code here would itself be the inconsistency."

patterns-established:
  - "fanouts: Vec<(String, Vec<String>, i64)> replacing the prior Option<(...)> -- a mutation handler that can now produce zero, one, or N Collection-typed SyncEvents publishes them all in one post-commit loop, never conditionally special-cased per count"

requirements-completed: [FSH-02, FSH-03]

coverage:
  - id: D1
    description: "create() validates and additively persists N family_wide_keys entries (per-entry access_level/blob-length/require_collection_edit validation before any DB work; one invitation_family_wide_keys row per entry, same transaction as the invitations INSERT) -- an empty/absent array behaves byte-identically to today"
    requirement: "FSH-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_create_with_two_family_wide_keys_inserts_both_rows_and_fetch_metadata_returns_both"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_create_with_invalid_family_wide_access_level_rejects_and_writes_nothing"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_create_with_family_wide_collection_caller_lacks_edit_on_rejects"
        status: pass
    human_judgment: false
  - id: D2
    description: "fetch_metadata() returns the invitation's own family_wide_keys entries ({collection_id, access_level, wrapped_collection_key} each) alongside the existing singular collection_id/wrapped_collection_key fields, which may independently be null or set"
    requirement: "FSH-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_create_with_two_family_wide_keys_inserts_both_rows_and_fetch_metadata_returns_both"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_create_and_fetch_metadata_with_correct_proof_returns_exactly_documented_fields"
        status: pass
    human_judgment: false
  - id: D3
    description: "accept() threads N family_wide_sealed_keys entries into the SAME BEGIN IMMEDIATE transaction as the existing single-collection grant (if any) and the family-membership insert -- one collection_keys row and one post-commit SyncEvent per entry; an entry's collection_id not present in this invitation's own invitation_family_wide_keys rows is silently dropped, never trusted from the request"
    requirement: "FSH-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_grants_single_collection_and_two_family_wide_collections_atomically"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_ignores_family_wide_sealed_key_entry_with_no_matching_invitation_row"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#accept_fans_out_a_collection_event_per_family_wide_collection_over_websocket"
        status: pass
    human_judgment: false
  - id: D4
    description: "A pre-existing collection_keys conflict on ANY one family_wide_sealed_keys entry fails the WHOLE accept() call closed -- the invite is never partially consumed, and the non-conflicting entries plus the family-membership insert roll back together with it (T-30-09)"
    requirement: "FSH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_family_wide_conflict_on_one_entry_fails_the_whole_call_and_rolls_back"
        status: pass
    human_judgment: false
  - id: D5
    description: "Zero regression to the existing single-collection-scope invite path: an invite carrying zero family-wide keys/seals behaves byte-for-byte like today's flow (same collection_keys row count, same response field values, same 23 pre-existing tests unmodified in intent)"
    requirement: "FSH-03"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs (full suite, 28 tests, cargo test --test invitations)"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_with_no_family_wide_sealed_keys_matches_pre_existing_behavior"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/membership.rs -- cargo test --lib membership:: (11 tests, resolve_access untouched)"
        status: pass
    human_judgment: false

duration: ~12min (coding + test window; excludes context-gathering)
completed: 2026-08-10
status: complete
---

# Phase 30 Plan 03: Invite Wire Contract Widening for Family-Wide Keys Summary

**`CreateInvitationRequest`/`InvitationPublicResponse`/`AcceptInvitationRequest` widened additively to carry N family-wide collection keys per invite, via the `invitation_family_wide_keys` sibling table -- `accept()` grants all of them atomically inside the existing single transaction, with zero regression to the existing single-collection-scope invite flow.**

## Performance

- **Duration:** ~12 min (coding + test iterations; commit c664e47 to 8e51f29)
- **Completed:** 2026-08-10T11:33:07Z
- **Tasks:** 2
- **Files modified:** 2 (`crates/pv-server/src/routes/invitations.rs`, `crates/pv-server/tests/invitations.rs`)

## Accomplishments
- `create()` now validates and additively persists a `family_wide_keys: Vec<FamilyWideKeyEntry>` array (each `{collection_id, access_level, wrapped_collection_key}`) -- per-entry `parse_access_level_from_request`/`validate_blob_len`/`require_collection_edit` validation BEFORE any DB work, then one `invitation_family_wide_keys` row per entry inside the same transaction as the `invitations` INSERT (never an orphaned invitations row on partial-entry failure)
- `fetch_metadata()` adds a second `SELECT` against `invitation_family_wide_keys`, returning every entry alongside the existing (independently null/set) singular `collection_id`/`wrapped_collection_key` fields
- `accept()`'s existing `BEGIN IMMEDIATE` transaction now also threads `family_wide_sealed_keys: Vec<FamilyWideSealedKeyEntry>` -- fetches this invitation's OWN `invitation_family_wide_keys` collection_id/access_level set fresh inside the transaction, filters the request to only entries the invitation itself named (T-30-07, never trusting a client-submitted `collection_id`), reads `access_level` from the invitation row (never the request), and calls the existing `collections::insert_collection_key` helper per surviving entry
- Any single `insert_collection_key` conflict (a pre-existing `collection_keys` row) fails the WHOLE `accept()` call closed -- the invite stays exactly `pending`, and every other grant in the same request (including the family-membership insert) rolls back with it
- The post-commit fan-out loop now publishes one `EntityType::Collection` `SyncEvent` per newly-granted collection (single-collection grant plus every family-wide grant), not only the one that existed before this plan
- 10 new `tests/invitations.rs` integration tests cover every behavior bullet in both tasks (create-time validation x3, create+fetch round trip x1, accept atomicity/conflict/mismatch/no-op/fan-out x5, plus the two pre-existing exact-field-count assertions updated from 5 to 6 keys to reflect the new additive `family_wide_keys` response field)

## Task Commits

Each task was committed atomically:

1. **Task 1: create()/fetch_metadata() carry family-wide wraps** - `c664e47` (feat)
2. **Task 2: accept() threads N self-seals into the SAME transaction** - `8e51f29` (feat)

## Files Created/Modified
- `crates/pv-server/src/routes/invitations.rs` - `FamilyWideKeyEntry`/`FamilyWideSealedKeyEntry` structs; `CreateInvitationRequest.family_wide_keys`, `InvitationPublicResponse.family_wide_keys`, `AcceptInvitationRequest.family_wide_sealed_keys`; `create()`'s per-entry validation + transactional insert loop; `fetch_metadata()`'s second SELECT; `accept()`'s family-wide loop inside the existing transaction and the `fanouts: Vec<...>` post-commit publish loop
- `crates/pv-server/tests/invitations.rs` - `create_collection_with_id` helper (generalizes `create_collection` to a caller-chosen id, needed by multi-collection tests); 10 new tests; 2 pre-existing exact-field-count assertions updated (5 -> 6 keys) to reflect the new additive response field

## Decisions Made
- Used `state.db.begin()` unconditionally in `create()` (even for an empty `family_wide_keys`), rather than branching to a transaction only when the array is non-empty -- one code path, byte-identical end state for the empty case, matching this codebase's stated preference for avoiding special-cased branches when the general path costs nothing extra
- Wrote the "caller lacks edit on a family_wide_keys collection_id" test against the ACTUAL `404 NotFound` this validation renders (via the same `require_collection_edit`/`gate()` the existing single-collection path already calls), not the plan prose's literal "400" -- see Deviations below
- `access_level` for a family-wide grant at `accept()` time is always read from the invitation's own stored `invitation_family_wide_keys` row inside the transaction, never from the request body -- mirrors the plan's own explicit instruction and closes the same class of trust gap T-30-07 covers for `collection_id`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug in plan prose, not shipped code] "400" behavior bullet corrected to the actual `404 NotFound`**
- **Found during:** Task 1, writing `invitation_create_with_family_wide_collection_caller_lacks_edit_on_rejects`
- **Issue:** The plan's Task 1 behavior bullet states a `family_wide_keys` entry whose `collection_id` the caller does not hold `edit` on renders `400`. The validation this plan is directed to reuse (`membership::require_collection_edit` -> `gate::<RequireEdit>(None)`) returns `ApiError::NotFound` (404) for "no access at all" -- this is `membership.rs`'s own documented, codebase-wide rule (`gate()`'s doc comment: "no-access-at-all stays `NotFound`"), identical to what the existing single-collection-scope path already renders when an owner lacks edit on `collection_id`.
- **Fix:** Implemented and tested against the actual 404 behavior. Diverging from the codebase's one canonical no-access rule to manufacture a 400 here would itself be the inconsistency -- and would require either a second decoding of the SAME `gate()` result or a bespoke error mapping this plan did not ask for and no other call site of `require_collection_edit` has.
- **Files modified:** `crates/pv-server/tests/invitations.rs` (test written against 404, with an explanatory comment)
- **Verification:** `invitation_create_with_family_wide_collection_caller_lacks_edit_on_rejects` passes
- **Committed in:** `c664e47` (Task 1 commit)

**2. [Rule 3 - Blocking, test-scope-only] `tests/invitations.rs` modified despite not being listed in the plan's `files_modified`**
- **Found during:** Task 1, first attempt at running the plan's stated verify command
- **Issue:** The plan's frontmatter lists only `crates/pv-server/src/routes/invitations.rs` under `files_modified`, but its own acceptance criteria explicitly require "Every behavior bullet above passes as a `#[cfg(test)]` unit test or `tests/invitations.rs` integration test" and "existing invite-creation tests ... remain green". `invitations.rs`'s handlers require real DB/family/collection fixtures only `tests/invitations.rs`'s existing helper suite provides -- a `#[cfg(test)] mod tests` inline in the route file was not a realistic substitute without duplicating that fixture machinery. Additionally, the response shape genuinely widened (a new `family_wide_keys` key on every `fetch_metadata` response), which mechanically breaks the two pre-existing exact-field-count assertions (`obj.len() == 5`, an `expected_keys` `HashSet` of 5) -- these could not stay green unmodified while also being an honest test of the new six-field shape.
- **Fix:** Modified `tests/invitations.rs`: added `create_collection_with_id` (generalizing the existing single-hardcoded-id `create_collection` helper), added 10 new tests, and updated the two exact-field-count assertions from 5 to 6 keys (the count of keys itself is preserved as a meaningful assertion, only the number and the explicit key list changed to include `family_wide_keys`).
- **Files modified:** `crates/pv-server/tests/invitations.rs`
- **Verification:** All 28 tests in `tests/invitations.rs` pass (`cargo test --test invitations`); no other test file in the repo references these two assertions
- **Committed in:** `c664e47` (Task 1 commit), extended in `8e51f29` (Task 2 commit)

**3. [Rule 3 - Blocking] Plan's stated verify command does not run any of this plan's tests**
- **Found during:** Task 1, running `cargo test --lib invitations:: 2>&1 | tail -30` as written in both tasks' `<verify>` blocks
- **Issue:** `invitations.rs` has no inline `#[cfg(test)] mod tests` (confirmed: zero `#[cfg(test)]` occurrences in the route file, both before and after this plan). `cargo test --lib invitations::` runs the `pv-server` library's unit-test binary filtered to paths matching `invitations::` and reports "0 tests" -- it silently passes without exercising anything this plan changed, because every invitations test in this codebase is an integration test in `tests/invitations.rs`, a SEPARATE test binary `--lib` does not include.
- **Fix:** Ran `cargo test --test invitations` (the correct binary selector for this codebase's actual test layout) for verification instead, in addition to the plan's literal command (which passed vacuously, 0 tests, both times, as expected).
- **Files modified:** None (verification-only correction)
- **Verification:** `cargo test --test invitations` -> 28 passed, 0 failed, both after Task 1 and after Task 2
- **Committed in:** N/A (verification methodology only, no code change)

---

**Total deviations:** 3 auto-fixed (1 plan-prose bug corrected against actual codebase behavior, 1 blocking test-file-scope gap, 1 blocking verify-command correction)
**Impact on plan:** All three were necessary to honestly test the plan's own behavior bullets and acceptance criteria; none touched `membership.rs`/`resolve_access`, none altered the additive-sibling-table shape, and none weakened any of Task 2's threat-register mitigations (T-30-07/T-30-08/T-30-09 -- all three verified passing above).

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `crates/pv-server/src/routes/invitations.rs` now exposes the full invite-carried half of FSH-02's hybrid mechanism (`family_wide_keys`/`family_wide_sealed_keys`) that the client-side invite-generation flow (a later plan, per 30-DECISION-FSH-02.md's own architectural map) will POST/consume.
- `crates/pv-server/src/routes/membership.rs`'s `Collection::resolve_access`/`Item::resolve_access` were NOT touched by this plan (confirmed: `git diff --stat` on both commits shows only `invitations.rs`/`tests/invitations.rs`), as the plan's own critical rule required.
- Every `<automated>` verify block in this plan starts with `set -o pipefail` per the plan's own header (both tasks' `<verify>` blocks unchanged from the plan as written).
- The lazy-reseal fallback (this decision record's second, required-not-optional half) and the client-side `generateInviteLink`/`redeemInviteFlow` wiring into this widened wire contract remain the job of later plans in this phase -- this plan is scoped to the server-side wire contract and its atomicity/trust-boundary guarantees only, matching its own stated objective.
- 30-14's planned adversarial test (inspecting every row/request body on this path for leaked key material) can build directly on this plan's shipped shape: `wrapped_collection_key`/`sealed_for_self` in the new plural fields are byte-identical in opacity to the existing singular fields this server already never unwraps.

---
*Phase: 30-the-living-group-family-wide-sharing*
*Completed: 2026-08-10*

## Self-Check: PASSED
