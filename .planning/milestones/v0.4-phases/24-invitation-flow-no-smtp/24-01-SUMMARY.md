---
phase: 24-invitation-flow-no-smtp
plan: 01
subsystem: api
tags: [rust, sqlite, sqlx, hkdf, xchacha20poly1305, axum, invitations]

# Dependency graph
requires:
  - phase: 22-family-sharing-collections
    provides: "families/family_members/collections/collection_keys schema, FamilyMembership/Membership authorization extractors, SessionUser bearer-token extractor"
  - phase: 21-identity-keys-sealed-sharing
    provides: "pv_core::identity::seal/unseal (X25519 anonymous sealed box, no AAD), CollectionKey"
provides:
  - "invitations table (migration 0017), additive, with proof_hash column for Amendment 2's proof-of-possession leg"
  - "pv_core::invite module: derive_invite_id, wrap/unwrap_collection_key_for_invite (AAD-bound), derive_invite_proof, hash_invite_proof"
  - "OptionalSessionUser axum extractor (additive sibling of SessionUser)"
  - "families::insert_family_member and collections::insert_collection_key pub(crate) helpers, callable over impl SqliteExecutor<'_> from either &state.db or &mut *tx"
affects: [24-02-invitations-routes, 24-03-pv-wasm-invite-bindings, 24-04-invite-landing-ui, 24-05-owner-invite-panel]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three independent HKDF derivations from one invite_secret, each under its own versioned domain-separation constant (INFO_INVITE_ID/INFO_INVITE_WRAP/INFO_INVITE_PROOF) — never reuse one derivation's output as another's input"
    - "Shared pub(crate) INSERT helper over impl SqliteExecutor<'_> so the same write path compiles against both a bare pool (&state.db) and a transaction (&mut *tx), preventing a second parallel membership-write path"
    - "OptionalSessionUser: wrap a required FromRequestParts extractor's own call and convert Err into Ok(None) — never modify the required extractor itself"

key-files:
  created:
    - crates/pv-server/migrations/0017_invitations.sql
    - crates/pv-core/src/invite.rs
  modified:
    - crates/pv-core/src/lib.rs
    - crates/pv-server/src/routes/session.rs
    - crates/pv-server/src/routes/families.rs
    - crates/pv-server/src/routes/collections.rs

key-decisions:
  - "invite.rs calls ONLY keys::aead_seal/aead_open (AAD-capable) — identity::seal/unseal (AAD-incapable) is never imported into this file, per 24-CONTEXT.md Amendment 2's correction of ARCHITECTURE.md §7.1's undifferentiated pseudocode"
  - "proof_hash stored as raw BLOB (fixed-length SHA-256 digest), not WrappedKey-shaped JSON TEXT — mirrors user_keypairs.public_key's raw-binary convention since there is no nonce/ciphertext structure to carry"
  - "Table-level CHECK enforces collection_id/access_level/wrapped_collection_key travel together (all NULL or all NOT NULL) — no partial state permitted at the schema level"
  - "No role column on invitations — v0.4's flat model only ever adds a member at family_members.role='member', matching families::add_member's existing hardcoded literal"

patterns-established:
  - "Amendment 2's proof-of-possession leg (invite_proof/hash_invite_proof) as the template for any future 'possession of an out-of-band secret must be provable to the server without the server learning the secret' need — same shape as the existing sessions.token_hash precedent, applied to a client-derived value instead of a server-issued one"

requirements-completed: []

coverage:
  - id: D1
    description: "Migration 0017 applies additively on top of 0001-0016 with no schema regression; invitations table has the proof_hash column Amendment 2 requires plus CHECK constraints for closed enums and collection-field consistency"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family.rs (test_pool() runs sqlx::migrate! including 0017 before every test — 4/4 pass)"
        status: pass
    human_judgment: false
  - id: D2
    description: "pv_core::invite provides a correct, tested, AAD-bound symmetric wrap/unwrap pair plus deterministic invite_id and invite_proof derivations, all three domain-separation constants proven pairwise distinct from each other and from every existing INFO_* constant"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/invite.rs#tests (7 tests: constant_distinctness, wrap_unwrap_roundtrip_yields_identical_bytes, unwrap_fails_with_wrong_invite_secret, unwrap_fails_with_mismatched_invite_id_aad, derive_invite_id_is_url_safe_and_deterministic, derive_invite_proof_is_deterministic_and_independent_of_the_other_two_derivations, hash_invite_proof_is_deterministic_and_differs_for_different_inputs)"
        status: pass
      - kind: unit
        ref: "cargo test -p pv-core (full suite, 56 tests including identity::tests::chachabox_rejects_nonempty_aad unchanged) — no regression"
        status: pass
    human_judgment: false
  - id: D3
    description: "OptionalSessionUser exists as a documented, additive sibling of SessionUser, compiling and available for Plan 24-02's invite-accept route to consume"
    verification:
      - kind: unit
        ref: "cargo build -p pv-server (compiles clean, no new warnings)"
        status: pass
    human_judgment: false
  - id: D4
    description: "families::add_member and collections::add_member refactored onto shared pub(crate) insert helpers with zero observable behavior change"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/family.rs (4/4 pass, unmodified) and crates/pv-server/tests/collections.rs (14/14 pass, unmodified)"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-31
status: complete
---

# Phase 24 Plan 01: Invitation Foundation (Migration + Crypto + Extractor + Helpers) Summary

**Additive `invitations` table with an Amendment-2 proof-of-possession column, a `pv_core::invite` module deriving three domain-separated values (id/wrap-key/proof) from one invite secret via AAD-bound `aead_seal`/`aead_open`, and the `OptionalSessionUser` extractor + shared membership-INSERT helpers Plan 24-02 will build on.**

## Performance

- **Duration:** ~25 min
- **Completed:** 2026-07-31T09:57:28Z
- **Tasks:** 2/2 completed
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments
- `crates/pv-server/migrations/0017_invitations.sql` — additive `invitations` table with `id` (client-computed `invite_id`), `proof_hash BLOB NOT NULL` (Amendment 2), a table-level CHECK enforcing `collection_id`/`access_level`/`wrapped_collection_key` travel together, `status`/`access_level` closed-set CHECKs, and `idx_invitations_family`.
- `crates/pv-core/src/invite.rs` (new module) — `INFO_INVITE_ID`/`INFO_INVITE_WRAP`/`INFO_INVITE_PROOF` domain-separation constants (pairwise distinct and distinct from every existing `INFO_*` constant in `keys.rs`/`identity.rs`), `derive_invite_id` (URL-safe base64, no padding), `wrap_collection_key_for_invite`/`unwrap_collection_key_for_invite` (AAD-bound to `invite_id`, calling only `keys::aead_seal`/`aead_open` — never `identity::seal`/`unseal`), `derive_invite_proof`, `hash_invite_proof`. 7 new unit tests, all passing.
- `OptionalSessionUser` in `crates/pv-server/src/routes/session.rs` — additive sibling of `SessionUser`, wrapping its `from_request_parts` and converting `Err` to `Ok(None)`; `SessionUser` itself untouched.
- `families::insert_family_member` / `collections::insert_collection_key` — shared `pub(crate)` INSERT helpers over `impl sqlx::SqliteExecutor<'_>`, extracted from the existing `add_member` handlers with zero behavior change (both integration test files pass unmodified).

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 0017 + pv-core invite-secret channel** - `3436752` (feat)
2. **Task 2: OptionalSessionUser extractor + shared membership-write helper extraction** - `d0fbc31` (feat)

## Files Created/Modified
- `crates/pv-server/migrations/0017_invitations.sql` - new `invitations` table + index
- `crates/pv-core/src/invite.rs` - new module: invite-secret HKDF derivations + AAD-bound wrap/unwrap
- `crates/pv-core/src/lib.rs` - added `pub mod invite;`
- `crates/pv-server/src/routes/session.rs` - added `OptionalSessionUser`
- `crates/pv-server/src/routes/families.rs` - extracted `insert_family_member`, `add_member` now calls it
- `crates/pv-server/src/routes/collections.rs` - extracted `insert_collection_key`, `add_member` now calls it

## Decisions Made
- `invite.rs` never imports `pv_core::identity` for sealing — only `keys::aead_seal`/`aead_open`. The plan's critical-correctness note about not conflating the two primitives was followed literally; `identity::seal`/`unseal`'s own `chachabox_rejects_nonempty_aad` regression test was re-verified passing unchanged, confirming the AAD-incapable primitive still rejects non-empty AAD.
- `proof_hash` is `BLOB NOT NULL`, not a `WrappedKey`-shaped JSON `TEXT` column — it is a plain fixed-length SHA-256 digest with no nonce/ciphertext structure, mirroring `user_keypairs.public_key BLOB`'s convention rather than `collection_keys.sealed_key TEXT`'s.
- No `role` column on `invitations` — the flat v0.4 model only ever grants `family_members.role = 'member'` via an invite, matching `families::add_member`'s existing hardcoded literal exactly.

## Deviations from Plan

None — plan executed exactly as written. `unwrap_collection_key_for_invite`'s implementation went through one internal simplification during authoring (an initial draft over-complicated the error-propagation shape trying to zeroize `invite_wrap_key` after a fallible `aead_open` call); the final version zeroizes the wrapping key immediately after the `aead_open` call returns (success or failure) and then propagates the `Result` with `?`, matching `unwrap_user_key`'s established shape in `keys.rs`. This was caught and fixed before any commit — no separate deviation-tracked fix was needed since it never reached a passing-but-wrong state.

## Threat Flags

The plan's own `<threat_model>` in 24-01-PLAN.md already scoped T-24-01, T-24-02, T-24-03, and T-24-21 against this exact set of files, and this plan's tests directly verify each mitigation (`constant_distinctness` for T-24-02; `unwrap_fails_with_mismatched_invite_id_aad` and the never-importing-`identity`-module discipline for T-24-01; no `Debug`/`Display`/logging of secret material anywhere in `invite.rs` for T-24-03; `derive_invite_proof`'s independent domain-separation constant for T-24-21). No NEW threat-adjacent surface was introduced beyond what the plan already flagged:

| Flag | File | Description |
|------|------|--------------|
| threat_flag: none-new | crates/pv-core/src/invite.rs | No new attack surface beyond the plan's own threat register — this module has no I/O, no network endpoint, and is not yet wired to any route (Plan 24-02 does that). Flagging explicitly per the phase's "populate or state nothing found" requirement. |
| threat_flag: deferred-boundary | crates/pv-server/src/routes/session.rs (`OptionalSessionUser`) | Not itself a new boundary — it degrades a required-auth failure into `None` rather than rejecting the request — but it is inert until Plan 24-02 attaches it to a live route. The security property that matters (the actual authorization/grant decision must never depend on whether a session was present, only on the stored `invitations` row) is NOT yet exercised by any test in this plan; Plan 24-02's own test suite is where that property must be proven, not here. |

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Plan 24-02 (invitations routes: create/get-public/accept/revoke) can now: (1) migrate against `invitations` directly, (2) call `pv_core::invite`'s six public functions from client-side/test-simulation code, (3) attach `OptionalSessionUser` to the accept handler, and (4) call `families::insert_family_member`/`collections::insert_collection_key` from inside its own `BEGIN IMMEDIATE` transaction without writing a second parallel INSERT path. No blockers.

## Self-Check: PASSED

All created/modified files verified present on disk; both task commits (`3436752`, `d0fbc31`) verified present in `git log`.

---
*Phase: 24-invitation-flow-no-smtp*
*Completed: 2026-07-31*
