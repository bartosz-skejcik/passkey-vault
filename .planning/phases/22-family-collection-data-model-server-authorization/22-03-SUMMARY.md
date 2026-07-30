---
phase: 22-family-collection-data-model-server-authorization
plan: 03
subsystem: api
tags: [axum, sqlx, sqlite, x25519, crypto_box, zero-knowledge, sharing]

# Dependency graph
requires:
  - phase: 22-01
    provides: "Membership<R,M>/FamilyMembership<M> extractors, Collection ResourceKind, gate::<M>() 404-vs-403 discipline, family_routes()/membership_routes() route tables"
provides:
  - "POST/GET /api/vault/collections, GET /api/vault/collections/{id}, POST .../members, GET .../access, DELETE .../access/{user_id}"
  - "KEY-02 per-member Collection Key fan-out proven with 3+ members (each recipient opens only their own seal)"
  - "SHARE-06 single-share revocation enforced on the very next request via the same session"
  - "Confused-deputy add-member guard (T-22-11): recipient must be a family member AND have a published identity keypair"
affects: [22-04, 22-05, 25-family-member-removal, 26-sharing-ui]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Collections resource wires Membership<Collection,_> for path-{id} routes and FamilyMembership<RequireRead> for the no-{id} create/list pair, split across family_routes()/membership_routes() so the mutating POST stays visible to the route-sweep tripwire"
    - "AccessLevel::as_str() as the canonical inverse of parse_access_level — one place an AccessLevel renders back to wire vocabulary"
    - "parse_access_level_from_request() as the BadRequest-mapping sibling of the DB-decode path's Internal-erroring parse_access_level"

key-files:
  created:
    - crates/pv-server/src/routes/collections.rs
    - crates/pv-server/tests/collections.rs
  modified:
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/src/routes/membership.rs
    - crates/pv-server/tests/common/mod.rs

key-decisions:
  - "add_member/revoke_access/access_list were implemented together with create/get/list in Task 1's commit, not deferred to Task 2, because Task 1's own pinned verify test (collection_key_fan_out_three_members_each_opens_only_own_seal) exercises POST .../members end-to-end — mirrors the existing forward-reference precedent in tests/common/mod.rs::register_second_family_member"
  - "add_member's confused-deputy guard checks recipient existence in user_keypairs only (not the actual public key bytes) — matching the plan's exact spec: server authorizes provenance (family membership + keypair existence), never validates sealed_key content (zero-knowledge boundary)"

requirements-completed: [KEY-02, SHARE-06]

coverage:
  - id: D1
    description: "POST /api/vault/collections creates the collections row and the creator's own edit collection_keys row in one transaction (KEY-02 fan-out seed)"
    requirement: "KEY-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#collection_create_wires_creator_edit_access"
        status: pass
    human_judgment: false
  - id: D2
    description: "3-member fan-out: N members yield N distinct collection_keys rows, each openable only by its own recipient's secret key"
    requirement: "KEY-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#collection_key_fan_out_three_members_each_opens_only_own_seal"
        status: pass
    human_judgment: false
  - id: D3
    description: "Adding a member creates exactly one new collection_keys row and rewrites zero bytes of vault_items.enc_data"
    requirement: "KEY-02"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#adding_member_creates_one_wrap_row_no_ciphertext_rewrite"
        status: pass
    human_judgment: false
  - id: D4
    description: "SHARE-06 revocation via DELETE /api/vault/collections/{id}/access/{user_id} is enforced on the very next request, same bearer token, no re-login"
    requirement: "SHARE-06"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#revoked_share_loses_access_on_next_request_same_session"
        status: pass
    human_judgment: false
  - id: D5
    description: "add_member confused-deputy guard rejects a non-family-member recipient with 400, never wraps-and-stores for an outsider"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#add_member_rejects_non_family_member"
        status: pass
    human_judgment: false
  - id: D6
    description: "add_member fails closed (400) on a malformed/unrecognized access_level, never defaults to a permissive level"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/collections.rs#add_member_rejects_malformed_access_level"
        status: pass
    human_judgment: false

# Metrics
duration: ~45min
completed: 2026-07-30
status: complete
---

# Phase 22 Plan 03: Collections Resource — KEY-02 Fan-Out + SHARE-06 Revocation Summary

**Collections CRUD wired through `Membership<Collection,_>`/`FamilyMembership<RequireRead>`, with a proven 3-member Collection Key fan-out (each recipient opens only their own sealed row) and single-share revocation enforced on the very next request.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-30
- **Tasks:** 2 completed
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `POST/GET /api/vault/collections`, `GET /api/vault/collections/{id}`, `POST .../members`, `GET .../access`, `DELETE .../access/{user_id}` all live and gated by the shared `Membership<Collection,_>`/`FamilyMembership<M>` extractors from Plan 22-01 — no per-handler `if caller_is_member(...)` anywhere in this file.
- KEY-02's per-member fan-out is proven with 3 real family members: each recipient's own `IdentitySecretKey` opens only their own `collection_keys.sealed_key` row, and a cross-member unseal attempt against another recipient's row fails, all via `pv_core::identity::seal`/`unseal_collection_key` called ONLY from the test file (client-side simulation) — the server never calls these.
- SHARE-06 single-share revocation is proven enforced on the very next request, reusing the revoked user's own still-valid bearer token (no re-login) — falls out for free because `Membership<Collection,_>` resolves access fresh from the DB on every request, with no cache anywhere to invalidate.
- Adding a member is proven to create exactly one new `collection_keys` row and rewrite zero bytes of an existing item's `enc_data` (byte-level DB comparison).
- The `add_member` confused-deputy guard (T-22-11, RESEARCH.md Pitfall 9) rejects both a non-family-member recipient and a malformed `access_level` with `400`, never silently wrapping-and-storing for an outsider or defaulting to a permissive level.

## Task Commits

Each task was committed atomically:

1. **Task 1: Collections CRUD wired through Membership\<Collection,_\> + 3-member fan-out proof** - `e29d0f8` (feat) — includes `add_member`/`revoke_access`/`access_list` alongside `create`/`get`/`list`, since Task 1's own pinned verify test exercises `POST .../members` end-to-end (a documented forward reference).
2. **Task 2: Add-member endpoint, single-share revocation (SHARE-06), co-recipient visibility** - `38daa80` (test) — adds the remaining four named tests covering the no-ciphertext-rewrite proof, revocation-on-next-request, and the two confused-deputy/malformed-input negative paths. No production code changes were needed (already landed in Task 1's commit).

## Files Created/Modified
- `crates/pv-server/src/routes/collections.rs` - Collections resource: `create`, `get`, `list`, `add_member`, `revoke_access`, `access_list` handlers; `CreateCollectionRequest`/`CollectionResponse`/`AddMemberRequest`/`CoRecipientRecord` types. Never calls `pv_core::identity::{seal,unseal,unseal_collection_key}`.
- `crates/pv-server/src/routes/mod.rs` - Registers `collections` module; wires `/api/vault/collections` into `family_routes()` and the four `{id}`-scoped routes into `membership_routes()`.
- `crates/pv-server/src/routes/membership.rs` - Adds `AccessLevel::as_str()` (canonical inverse of `parse_access_level`) and `parse_access_level_from_request()` (BadRequest-mapping wrapper for caller-facing validation).
- `crates/pv-server/tests/collections.rs` - 6 integration tests: `collection_create_wires_creator_edit_access`, `collection_key_fan_out_three_members_each_opens_only_own_seal`, `adding_member_creates_one_wrap_row_no_ciphertext_rewrite`, `revoked_share_loses_access_on_next_request_same_session`, `add_member_rejects_non_family_member`, `add_member_rejects_malformed_access_level`.
- `crates/pv-server/tests/common/mod.rs` - Adds `register_third_family_member`, mirroring `register_second_family_member` for the 3-member fan-out fixture.

## Decisions Made
- **Task boundary vs. verify boundary mismatch, resolved by landing full implementation in Task 1.** The plan's Task 1 `<verify>` command pins `collection_key_fan_out_three_members_each_opens_only_own_seal` to pass, and that test's own behavior spec (Task 1's `<behavior>` section) explicitly grants access "via `POST /api/vault/collections/{id}/members`" — Task 2's endpoint. Rather than leave Task 1's own pinned verify command unsatisfiable, `add_member`/`revoke_access`/`access_list` (including the confused-deputy guard and `parse_access_level_from_request`) were implemented in Task 1's commit. This exactly mirrors the plan's own precedent in `tests/common/mod.rs::register_second_family_member`'s doc comment ("safe to land ahead of Task 3 within this same plan's commit sequence"). Task 2's commit then adds only the remaining four tests — no further production code was needed, since Task 2's action-section spec for `add_member`/`revoke_access`/`access_list` was already satisfied by Task 1's implementation.
- **Test fix: list-emptiness assertion moved from an unrelated stranger to a second family member.** The original test draft asserted `GET /api/vault/collections` returns `200` with an empty list for a completely unrelated (non-family-member) user. That's wrong: `FamilyMembership<RequireRead>` correctly 404s a non-family-member outright (existence-never-leaks, Plan 22-01's discipline) before the handler body runs. Fixed to use a second family member with no `collection_keys` row of their own, correctly isolating the "family member sees only their own collections" property.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Doc comment substring accidentally matched the `unseal`/`seal`-call acceptance-criterion grep**
- **Found during:** Task 1, acceptance-criteria self-check
- **Issue:** `collections.rs`'s module doc comment originally read "...via `pv_core::identity::seal` under the RECIPIENT's own published..." — this literal substring matches the plan's own acceptance-criterion grep (`grep -rn "pv_core::identity::seal\|pv_core::identity::unseal" crates/pv-server/src/routes/collections.rs` must produce zero matches), even though it's prose in a comment, not an actual function call.
- **Fix:** Reworded the sentence to describe the same fact ("via `pv_core`'s identity-sealing helper, see this module's own prohibition below") without the literal contiguous substring.
- **Files modified:** `crates/pv-server/src/routes/collections.rs`
- **Verification:** `grep -rn "pv_core::identity::seal\|pv_core::identity::unseal" crates/pv-server/src/routes/collections.rs` now produces zero matches; `cargo test -p pv-server --test collections` still passes.
- **Committed in:** `e29d0f8` (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — cosmetic doc-comment wording, no behavior change)
**Impact on plan:** No scope creep. The task-boundary resolution above (implementing add_member/revoke_access/access_list in Task 1) is documented as a Decision, not a deviation, since it's required to satisfy the plan's own pinned verify command and mirrors an existing precedent in the codebase.

## Issues Encountered
- **Cargo version limitation:** this workspace's `cargo 1.97.0` does not accept multiple `TESTNAME` positional filters in a single `cargo test` invocation (`cargo test TESTNAME1 TESTNAME2 -- ...` errors with "unexpected argument"). The plan's `<verify>` commands are written with multiple space-separated test names. Verified functional equivalence instead: ran the full `tests/collections.rs` file (all 6 named tests, exact match on names) and confirmed `test result: ok. 6 passed`, then re-ran each of the plan's individually-named pinned tests one at a time to confirm each passes standalone. No test failures encountered; this is a verify-command syntax mismatch with the installed cargo version, not an implementation defect.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 22-04 (item-level sharing, `Membership<Item,_>`) can build directly on `Collection`'s established pattern in this file — `combine_access`'s dual-grant resolution in `membership.rs` already anticipates `item_shares` alongside `collection_keys`.
- Plan 22-05's route-sweep test can enumerate `family_routes()`/`membership_routes()` and find every route this plan registers, including `/api/vault/collections` via `family_routes()` (never a literal `.route()` call — verified via `grep -n '\.route("/api/vault/collections"' crates/pv-server/src/routes/mod.rs` producing zero matches).
- No blockers. `cargo test --workspace` is green; `cargo test -p pv-server --test collections` passes all 6 named tests.

---
*Phase: 22-family-collection-data-model-server-authorization*
*Completed: 2026-07-30*

## Self-Check: PASSED
- FOUND: crates/pv-server/src/routes/collections.rs
- FOUND: crates/pv-server/tests/collections.rs
- FOUND: .planning/phases/22-family-collection-data-model-server-authorization/22-03-SUMMARY.md
- FOUND: commit e29d0f8
- FOUND: commit 38daa80
