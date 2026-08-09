---
phase: 24-invitation-flow-no-smtp
plan: 02
subsystem: api
tags: [rust, axum, sqlx, sqlite, constant-time-comparison, invitations]

# Dependency graph
requires:
  - phase: 24-invitation-flow-no-smtp (Plan 24-01)
    provides: "invitations table (proof_hash column), pv_core::invite module, OptionalSessionUser extractor, families::insert_family_member/collections::insert_collection_key shared helpers"
provides:
  - "Live /api/invitations/* surface: POST create (owner-only), POST {id} metadata fetch (proof-gated, no session), POST {id}/accept (optional-session, proof-gated, the milestone's low-trust write surface), DELETE {id} revoke (owner-only)"
  - "pv_server::crypto::hash_invite_proof — server-side re-hash for constant-time proof comparison at redemption time"
  - "Working end-to-end example of the Amendment 2 proof-of-possession pattern (constant_time_eq against a stored proof_hash) other future 'possession without a shared secret' features can copy"
affects: [24-03-pv-wasm-invite-bindings, 24-04-invite-landing-ui, 24-05-owner-invite-panel, 24-06, 24-07, 24-08]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Proof-of-possession redemption: caller presents a raw value, server re-hashes and compares via crate::crypto::constant_time_eq against a stored hash — never a plain == — mirroring auth.rs::login()'s auth_hash check"
    - "Fold the single-use guard's WHERE clause AND a failed-attempt rate-limit bump into the SAME BEGIN IMMEDIATE transaction, so a wrong proof costs the attacker a counter increment but never touches status"
    - "Two literal-chain routes and two family_routes() entries deliberately share URL path strings across different HTTP methods (axum MethodRouter merge) so a session-optional public route and an owner-gated route can coexist at /api/invitations/{id}"

key-files:
  created:
    - crates/pv-server/src/routes/invitations.rs
    - crates/pv-server/tests/invitations.rs
  modified:
    - crates/pv-server/src/crypto.rs
    - crates/pv-server/src/routes/mod.rs
    - crates/pv-server/tests/membership_route_sweep.rs

key-decisions:
  - "invitations.rs never imports pv_core::invite — the one server-side hash it needs (hash_invite_proof) lives in pv_server::crypto as a textually distinct twin of pv_core::invite::hash_invite_proof, so a future reader never has to wonder whether the client-side derivation and the server-side re-hash are 'the same operation for a reason' vs. coincidentally identical bodies"
  - "accept's Pitfall-9 re-validation re-derives Collection::resolve_access/require_collection_edit's equivalent check inline against &mut *tx (both real helpers are pool-bound, not transaction-bound) rather than calling them — documented in the module and matches the plan's own read_first guidance"
  - "Deliberately does NOT bump collections.revision in the accept transaction for a collection-scoped invite — matches shipped collections::add_member's WR-05 documented wire-contract gap (a membership-only change never bumps it); CONTEXT.md's prose said it should, but the shipped precedent and this plan's own critical-correctness note override that stale prose"
  - "membership_route_sweep.rs needed a new SHARED_PATH_METHOD_EXCEPTIONS constant (Rule 1 auto-fix, found while running the sweep test): the sweep's generic 'try every HTTP method against every swept path' loop incidentally exercises POST /api/invitations/{id} (the ungated, literal fetch_metadata route) when sweeping the family_routes() DELETE entry at the same path — sending it with no body trips Json's own missing-content-type rejection (415) before any authorization logic runs, which is neither a bug nor a membership gap; that method+path combination is skipped with a documented rationale, mirroring INSUFFICIENT_LEVEL_EXCEPTIONS' existing escape-hatch shape"

patterns-established:
  - "Rate-limit-via-persisted-counter-inside-the-same-transaction: failed_attempts is bumped in the exact BEGIN IMMEDIATE transaction that already holds the write lock for the guarded status check, so the rate limit costs nothing extra and can never race against the very check it protects"

requirements-completed: [FAM-04, FAM-05, FAM-06]

coverage:
  - id: D1
    description: "Owner can create a family-only or collection-scoped invite; proof_hash is required on every invite (Amendment 2 applies universally, not just to collection-scoped grants)"
    requirement: "FAM-04"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_create_and_fetch_metadata_with_correct_proof_returns_exactly_documented_fields"
        status: pass
    human_judgment: false
  - id: D2
    description: "Pre-redemption metadata fetch (POST, not GET) returns exactly the five documented fields with no session, gated by the correct invite_proof via constant-time comparison; a wrong proof or unknown id render byte-identical bodies"
    requirement: "FAM-05"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_fetch_metadata_wrong_proof_returns_same_404_as_unknown_id"
        status: pass
    human_judgment: false
  - id: D3
    description: "A brand-new registered user can accept a family-only invite with the correct proof (creates membership, flips status), and a collection-scoped invite produces a real collection_keys row with the invite's own access_level, round-tripping the real server-stored wrapped_collection_key blob"
    requirement: "FAM-06"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_family_only_by_brand_new_user_with_correct_proof_creates_membership_and_marks_accepted"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_collection_scoped_produces_real_collection_keys_row"
        status: pass
    human_judgment: false
  - id: D4
    description: "A wrong proof never burns the invite (status stays pending, failed_attempts bumps); accept requires a session (401 with none); an already-a-member redeeming a different invite is idempotent (already_member: true, no duplicate row, invite still consumed)"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_wrong_proof_returns_unified_failure_and_leaves_status_pending"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_with_no_authorization_header_returns_401"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_by_existing_family_member_is_idempotent_and_reports_already_member"
        status: pass
    human_judgment: false
  - id: D5
    description: "Owner can revoke a pending invite; revoked/expired/consumed/wrong-proof/rate-limited-out all render the exact same {\"error\": ...} body shape — the unified-failure-cause guarantee now includes wrong-proof as a tested cause (closes T-24-07 with a regression test)"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_revoke_then_metadata_and_accept_render_unified_failure_even_with_correct_proof"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_rate_limit_ceiling_blocks_further_attempts_even_with_correct_proof"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_response_bodies_never_distinguish_failure_cause"
        status: pass
    human_judgment: false
  - id: D6
    description: "The inviter's granting authority (family ownership / collection edit-access) is re-validated live at accept time, not assumed from creation time; a revoked ownership leaves the invite exactly pending, not silently consumed. No handler ever writes identity_verifications."
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_accept_rejects_when_inviters_family_ownership_no_longer_holds"
        status: pass
      - kind: integration
        ref: "crates/pv-server/tests/invitations.rs#invitation_flow_never_writes_identity_verifications"
        status: pass
    human_judgment: false
  - id: D7
    description: "membership_route_sweep.rs proves an unrelated caller cannot reach either new family_routes() entry (create, revoke); cardinality tripwire and literal-route allowlist stay accurate"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/membership_route_sweep.rs#membership_route_sweep_rejects_non_member_on_every_route"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#routes::tests::membership_routes_table_has_expected_cardinality"
        status: pass
      - kind: unit
        ref: "crates/pv-server/src/routes/mod.rs#routes::tests::router_literal_routes_match_documented_allowlist"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-07-31
status: complete
---

# Phase 24 Plan 02: Invitation Routes (Create/Fetch-Metadata/Accept/Revoke) Summary

**`/api/invitations/*` wired end-to-end against the real router — family-only and collection-scoped invite creation, a proof-gated no-session metadata fetch, a proof-gated optional-session accept that reuses Phase 22's shared membership-write helpers, and owner-only revoke — with the Amendment 2 proof-of-possession leg (`constant_time_eq` against a stored `proof_hash`) proven on both read and write paths by 17 new integration tests.**

## Performance

- **Duration:** ~45 min
- **Completed:** 2026-07-31T10:20:00Z
- **Tasks:** 2/2 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `crates/pv-server/src/routes/invitations.rs` (new module) — `create` (owner-only, family-only or collection-scoped, `proof_hash` always required), `fetch_metadata` (POST, no session, Amendment 2 proof-gated, exactly five response fields), `accept` (`OptionalSessionUser`, proof-gated, `BEGIN IMMEDIATE`, Pitfall-9 live re-validation of the inviter's authority, reuses `families::insert_family_member`/`collections::insert_collection_key`, fans out `EntityType::Collection` on a collection-scoped join), `revoke` (owner-only, family-id-scoped).
- `crates/pv-server/src/crypto.rs` — `hash_invite_proof`, the server-side twin of Plan 24-01's client-side `pv_core::invite::hash_invite_proof`, used with `constant_time_eq` (never `==`) at both `fetch_metadata` and `accept`.
- `crates/pv-server/src/routes/mod.rs` — two literal `.route()` entries (`POST /api/invitations/{id}`, `POST /api/invitations/{id}/accept`) and two `family_routes()` entries (`POST /api/invitations`, `DELETE /api/invitations/{id}`); `LITERAL_ROUTES_NOT_MEMBERSHIP_GATED` and the cardinality tripwire (`family_routes().len() == 6`) updated.
- `crates/pv-server/tests/invitations.rs` (new, 12 tests) — happy path, wrong-proof/no-auth edge cases (Task 1); collection-scoped round trip, already-a-member idempotency, revoke/rate-limit/ownership-change unified-failure proofs, the six-cause unified-body sweep, and the zero-`identity_verifications`-writes proof (Task 2).
- `crates/pv-server/tests/membership_route_sweep.rs` — seeds a real pending invitation and sweeps both new `family_routes()` entries; documents and skips the one shared-path/different-method case the `POST`+`DELETE` merge introduces.

## Task Commits

Each task was committed atomically:

1. **Task 1: invitations.rs happy path (family-only) — create, fetch_metadata, accept — wired end-to-end** - `58a0802` (feat)
2. **Task 2: Collection-scoped branch + already-a-member + revoke + rate-limit + unified-failure-causes + Pitfall-9 proof** - `de5a000` (feat)

## Files Created/Modified
- `crates/pv-server/src/routes/invitations.rs` - new module: create/fetch_metadata/accept/revoke handlers + request/response types
- `crates/pv-server/src/crypto.rs` - added `hash_invite_proof` + a unit test
- `crates/pv-server/src/routes/mod.rs` - wired the four new routes, updated the allowlist and cardinality tripwire
- `crates/pv-server/tests/invitations.rs` - new integration test file, 12 tests
- `crates/pv-server/tests/membership_route_sweep.rs` - seeded a real invitation, extended `TestIds`/`substitute()`, added `SHARED_PATH_METHOD_EXCEPTIONS`

## Decisions Made
- `invitations.rs`'s module doc comment states it MUST NEVER call `pv_core::invite`'s derive/wrap/unwrap functions or `pv_core::identity::seal`/`unseal` — verified by the fact that this module's only import from `pv_core`-adjacent code is `crate::crypto::hash_invite_proof` (server-local), never `pv_core::invite`.
- `fetch_metadata` and `accept` both treat a base64-decode failure or wrong-length `invite_proof` as a proof MISMATCH (via `unwrap_or_default()` before hashing), never a distinct `BadRequest` — a malformed proof is exactly as unrevealing as a wrong one, per Amendment 2.
- `accept`'s Pitfall-9 re-validation queries are written inline against `&mut *tx` rather than calling `Collection::resolve_access`/`require_collection_edit` (both pool-bound), per the plan's own explicit guidance.
- Deliberately did NOT bump `collections.revision` in the accept transaction for a collection-scoped join — matches shipped `collections::add_member`'s documented WR-05 wire-contract gap, overriding CONTEXT.md's stale prose per this plan's own critical-correctness note.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `membership_route_sweep.rs`'s generic per-method loop tripped a 415 on the shared `/api/invitations/{id}` path**
- **Found during:** Task 2, wiring `DELETE /api/invitations/{id}` (revoke) into `family_routes()`
- **Issue:** The sweep's existing loop tries all four HTTP methods (GET/POST/PUT/DELETE) against every swept path, asserting every non-405 status is 404 (or a documented 403). Once `family_routes()` gained a `DELETE /api/invitations/{id}` entry sharing a path with the already-registered literal `POST /api/invitations/{id}` (`fetch_metadata`, intentionally ungated per Amendment 2), the sweep's POST attempt against this shared URL hit `fetch_metadata`'s `Json` extractor with no body/content-type, producing `415 Unsupported Media Type` instead of the expected 404 — a false test failure, not a real membership gap (the DELETE method, which the sweep actually cares about for this `family_routes()` entry, correctly returned 404).
- **Fix:** Added a documented `SHARED_PATH_METHOD_EXCEPTIONS` constant (mirroring `INSUFFICIENT_LEVEL_EXCEPTIONS`'s existing escape-hatch shape) naming `"POST /api/invitations/{id}"` and skipping it in the per-method loop, with a comment explaining the shared-path/different-trust-boundary rationale so a future reader doesn't mistake this for a coverage gap.
- **Files modified:** `crates/pv-server/tests/membership_route_sweep.rs`
- **Verification:** `membership_route_sweep_rejects_non_member_on_every_route` passes; the DELETE method on this same path still asserts 404 for both the unrelated caller and (implicitly, via `family_routes()`'s own scoping) the general sweep discipline.
- **Committed in:** `de5a000` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - bug in test harness interaction, not production code)
**Impact on plan:** No scope creep — the fix is confined to the test file this plan already modifies, and it does not weaken the sweep's actual security guarantee (the DELETE-gated revoke route is still fully swept).

## Issues Encountered
- Whole-crate `cargo clippy -p pv-server -- -D warnings` (the plan's own `<verification>` block) fails on 18 pre-existing `clippy::explicit_auto_deref` lints in `crates/pv-server/src/routes/vault.rs` (lines 588–1107), a file this plan never touches (confirmed via `git diff --stat HEAD -- crates/pv-server/src/routes/vault.rs`, empty). Per the executor's SCOPE BOUNDARY rule, this was logged to `.planning/phases/24-invitation-flow-no-smtp/deferred-items.md` and to the cross-phase `WINDOWS.md` ledger (`--kind deviation`, entry #1) rather than fixed. `cargo build --workspace` (Task 1's own acceptance criterion) and `cargo clippy -p pv-server --tests -- -D warnings` scoped to the new `invitations.rs` file (Task 2's own acceptance criterion) are both clean.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Plan 24-03 (pv-wasm invite bindings) can proceed independently — it touches only `crates/pv-wasm`, unaffected by this plan's server-side work. Plans 24-04/24-05 (invite landing UI, owner invite panel) now have a real, tested `/api/invitations/*` server surface to call: `POST /api/invitations` (create), `POST /api/invitations/{id}` (metadata, no session), `POST /api/invitations/{id}/accept` (optional session), `DELETE /api/invitations/{id}` (revoke). No blockers. The `deferred-items.md` clippy note is the one open item carried forward — not a blocker for any downstream plan in this phase.

## Threat Flags

| Flag | File | Description |
|------|------|--------------|
| threat_flag: none-new | crates/pv-server/src/routes/invitations.rs | Every attack surface this module introduces is already named and disposed as `mitigate` in this plan's own `<threat_model>` (T-24-04 BEGIN IMMEDIATE transaction, T-24-05 atomic guarded UPDATE, T-24-06 AcceptInvitationRequest's closed field set, T-24-07 proof-of-possession via constant_time_eq, T-24-08 live re-validation of inviter authority, T-24-09 exactly-five-field metadata response, T-24-22 wrong-proof-never-burns-the-invite). Each mitigation is directly exercised by a named test in `tests/invitations.rs` (cross-referenced in the `coverage` block above) — no additional surface beyond the plan's own register was introduced. |
| threat_flag: shared-path-different-trust-boundary | crates/pv-server/src/routes/mod.rs | `POST /api/invitations/{id}` (the Amendment 2 metadata fetch — deliberately NO session/membership extractor at all) and `DELETE /api/invitations/{id}` (owner-only, `FamilyMembership<RequireEdit>`-gated revoke) now share one URL path string, dispatched by axum purely on HTTP method via `MethodRouter` merge. Verified this cannot cross-contaminate: each registration's handler independently declares its own extractor set with no shared mutable state between them, and `router_wrapper_and_whole_file_route_scan_has_no_blind_spot`/`router_literal_routes_match_documented_allowlist` both still pass, proving the merge is accounted for in the structural route audit. Flagged so a future author adding a THIRD method to either registration re-verifies this independence rather than assuming "same path" implies "same trust boundary" — `tests/membership_route_sweep.rs`'s new `SHARED_PATH_METHOD_EXCEPTIONS` constant documents the one test-harness interaction this sharing produces (a 415 on an unauthenticated-by-design POST attempt with no body, not a security gap). |

## Self-Check: PASSED

All created/modified files verified present on disk (confirmed via successful Read/Edit/Write tool calls throughout execution); both task commits (`58a0802`, `de5a000`) verified present in `git log --oneline --all`.

---
*Phase: 24-invitation-flow-no-smtp*
*Completed: 2026-07-31*
