---
phase: 22-family-collection-data-model-server-authorization
plan: 02
subsystem: api
tags: [axum, sqlx, sqlite, x25519, zero-knowledge, identity]

requires:
  - phase: 22-family-collection-data-model-server-authorization
    provides: "Migration 0014's user_keypairs/identity_verifications tables, SessionUser extractor, validate_blob_len helper"
provides:
  - "PUT/GET /api/identity/keypair — idempotent, self-healing keypair publication (KEY-01 server half)"
  - "POST /api/identity/verify/{user_id} — per-viewer identity verification record"
  - "families::members' public_key/fingerprint/verified_at fields (wired in 22-01) now populate for real"
affects: [22-03-collections, 22-04-item-sharing, 22-05-route-sweep, 26-identity-verification-ui]

tech-stack:
  added: []
  patterns:
    - "ON CONFLICT(user_id) DO NOTHING RETURNING self-healing upsert for a single-writer-wins, all-devices-can-adopt race resolution — no coordination protocol needed because wrapped_secret_key is wrapped under the account's own UserKey, identical across every device"
    - "ON CONFLICT(...) DO UPDATE ... datetime('now') upsert for a per-viewer verification timestamp that refreshes on repeat calls instead of erroring"

key-files:
  created:
    - crates/pv-server/src/routes/identity.rs
    - crates/pv-server/tests/identity_keypair.rs
  modified:
    - crates/pv-server/src/routes/mod.rs

key-decisions:
  - "PUT/GET /api/identity/keypair and POST /api/identity/verify/{user_id} registered as literal .route() entries in router_with_cors (SessionUser-only), NOT folded into membership_routes()/family_routes() — a user's own identity keypair is not a shared family/collection/item resource, and identity_verifications is a cross-user comparison scoped to the viewer's own row, matching this plan's key_links note."
  - "Module doc comment in identity.rs describes the forbidden pv_core::identity calls (seal/unseal/unseal_collection_key, the secret-key-unwrap helper) in prose rather than as literal dotted-path text, so the file itself does not trip the plan's own zero-knowledge grep gate (grep -rn 'pv_core::identity::seal\\|pv_core::identity::unseal\\|unwrap_identity_secret_key') while still stating the prohibition explicitly for a human reader."

patterns-established:
  - "Self-healing upsert response always carries {public_key, wrapped_secret_key, adopted_existing} — the caller compares the returned public_key against what it submitted; a mismatch means 'adopt this one instead,' never an error state."

requirements-completed: [KEY-01]

coverage:
  - id: D1
    description: "PUT /api/identity/keypair publishes an account's X25519 public key and stores its wrapped private key as an opaque blob; a second PUT from the same user with a different keypair does not overwrite the first — it returns the canonical (first) values with adopted_existing: true, and a third PUT resubmitting the canonical value is idempotent (adopted_existing: false)"
    requirement: "KEY-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/identity_keypair.rs#keypair_upsert_concurrent_race_self_heals_to_canonical"
        status: pass
    human_judgment: false
  - id: D2
    description: "A malformed public_key (invalid base64, wrong decoded length, or one of the 7 known small-order X25519 encodings) is rejected with 400 and never stored, verified by the canonical row being unchanged afterward"
    requirement: "KEY-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/identity_keypair.rs#keypair_upsert_concurrent_race_self_heals_to_canonical"
        status: pass
    human_judgment: false
  - id: D3
    description: "GET /api/identity/keypair returns 404 for a user with no published keypair"
    requirement: "KEY-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/identity_keypair.rs#keypair_get_returns_404_when_absent"
        status: pass
    human_judgment: false
  - id: D4
    description: "A pre-v0.4 account generating a keypair on upgrade (PUT /api/identity/keypair) does not rewrite a single byte of an existing vault item's enc_data — proven end-to-end through real persistence, not just the crypto-layer proof Phase 21 already shipped"
    requirement: "KEY-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/identity_keypair.rs#keypair_generation_does_not_rewrite_enc_data_bytes"
        status: pass
    human_judgment: false
  - id: D5
    description: "POST /api/identity/verify/{user_id} records a per-viewer verification (idempotent on repeat calls, exactly one row per pair); the reverse direction (subject verifying viewer) is never implied; a non-existent subject user_id returns 404"
    requirement: "KEY-01"
    verification:
      - kind: integration
        ref: "crates/pv-server/tests/identity_keypair.rs#identity_verification_is_per_viewer_not_symmetric"
        status: pass
    human_judgment: false
  - id: D6
    description: "This module never calls pv_core::identity's seal/unseal/unseal_collection_key or its secret-key-unwrap helper — the server can store but never read plaintext key material"
    requirement: "KEY-01"
    verification:
      - kind: other
        ref: "grep -rn \"pv_core::identity::seal\\|pv_core::identity::unseal\\|unwrap_identity_secret_key\" crates/pv-server/src/ — zero matches"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-07-30
status: complete
---

# Phase 22 Plan 02: Identity Keypair Publication & Per-Viewer Verification Summary

**PUT/GET `/api/identity/keypair` with a self-healing, race-free upsert plus `POST /api/identity/verify/{user_id}` for per-viewer verification records — delivering KEY-01's server half with a byte-level proof that keypair generation never rewrites existing vault ciphertext.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-30T (first task commit)
- **Completed:** 2026-07-30T
- **Tasks:** 2
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `crates/pv-server/src/routes/identity.rs`: `KeypairRequest`/`KeypairResponse` structs, `upsert()` (idempotent `ON CONFLICT(user_id) DO NOTHING RETURNING` self-healing race resolution, `IdentityPublicKey::from_bytes` encoding validation — length + small-order rejection), `get()` (404 when absent), `verify()` (viewer-scoped `ON CONFLICT DO UPDATE` upsert into `identity_verifications`, 404 for a non-existent subject).
- `PUT/GET /api/identity/keypair` and `POST /api/identity/verify/{user_id}` wired into `router_with_cors` as minimal, additive literal `.route()` entries — `SessionUser`-only, deliberately not folded into `membership_routes()`/`family_routes()`.
- Byte-level proof (not just Phase 21's crypto-layer fixture proof) that `PUT /api/identity/keypair` — simulating on-upgrade keypair generation — never rewrites a single byte of an existing vault item's `enc_data`, through real persistence: create item, capture `enc_data`, generate keypair, re-fetch, assert byte-identical.
- Per-viewer, non-symmetric identity verification: idempotent same-pair upsert, no implied reverse-direction row, 404 on an unknown subject — proven by querying `identity_verifications` directly via the test's own `sqlx::SqlitePool` handle (no "list my verifications" endpoint exists in this phase's scope).
- `families::members`' `public_key`/`fingerprint`/`verified_at` fields (wired in Plan 22-01, previously always `None`) now populate for real once a user calls these two endpoints.

## Task Commits

Each task was committed atomically:

1. **Task 1: PUT/GET /api/identity/keypair — idempotent, self-healing upsert, wired end-to-end** - `eac04f9` (feat)
2. **Task 2: Byte-level no-re-encryption proof (KEY-01 SC#5) + per-viewer identity verification** - `09e960b` (feat)

## Files Created/Modified
- `crates/pv-server/src/routes/identity.rs` - `KeypairRequest`, `KeypairResponse`, `upsert()`, `get()`, `verify()`, module-level zero-knowledge-boundary doc comment
- `crates/pv-server/src/routes/mod.rs` - `pub mod identity;` + two literal `.route()` entries for `/api/identity/*` (minimal, additive — no other line touched, per this wave's shared-file coordination with Plan 22-03)
- `crates/pv-server/tests/identity_keypair.rs` - 4 integration tests: `keypair_upsert_concurrent_race_self_heals_to_canonical`, `keypair_get_returns_404_when_absent`, `keypair_generation_does_not_rewrite_enc_data_bytes`, `identity_verification_is_per_viewer_not_symmetric`

## Decisions Made
- `PUT/GET /api/identity/keypair` and `POST /api/identity/verify/{user_id}` registered as literal `.route()` entries (not `membership_routes()`/`family_routes()`) — matches the plan's own `key_links` note that a user's own keypair and per-viewer verification record are not shared-membership resources.
- Reworded the module doc comment's description of the forbidden `pv_core::identity` calls into prose (e.g. "the secret-key-unwrap helper" instead of the literal identifier `unwrap_identity_secret_key`) after discovering the plan's own acceptance-criteria grep (`grep -rn "pv_core::identity::seal\|pv_core::identity::unseal\|unwrap_identity_secret_key" crates/pv-server/src/routes/identity.rs`) matched the doc comment itself, not just real call sites — the doc comment still names every forbidden function unambiguously for a human reader, just not as a literally-matching dotted path.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Doc comment text tripped the plan's own zero-knowledge grep gate**
- **Found during:** Task 1 (writing `identity.rs`'s module doc comment exactly as the plan's `<action>` specified, quoting `pv_core::identity::unwrap_identity_secret_key` literally)
- **Issue:** The plan's own acceptance criterion (`grep -rn "pv_core::identity::seal\|pv_core::identity::unseal\|unwrap_identity_secret_key" crates/pv-server/src/routes/identity.rs` must produce zero matches) is a literal text scan over the whole file, including doc comments — but the plan's `<action>` text also instructed writing that exact identifier into the doc comment. The two instructions were mutually exclusive as literally specified.
- **Fix:** Reworded the doc comment to describe the forbidden functions in prose instead of as a literal dotted Rust path, preserving the same explicit prohibition for a human reader while satisfying the grep-based acceptance check.
- **Files modified:** `crates/pv-server/src/routes/identity.rs`
- **Verification:** `grep -rn "pv_core::identity::seal\|pv_core::identity::unseal\|unwrap_identity_secret_key" crates/pv-server/src/` — zero matches; all tests still pass.
- **Committed in:** `eac04f9` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** No scope creep — the fix only changes doc-comment wording, not any behavior, and the same prohibition is still stated explicitly for future readers.

## Issues Encountered
- `cargo test -p pv-server <name1> <name2> -- --test-threads=1` (the plan's literal verify command syntax) is not accepted by cargo 1.97 — cargo only accepts a single positional `TESTNAME` filter before `--`. Ran the equivalent multi-filter invocation against the specific test binary instead (`cargo test -p pv-server --test identity_keypair -- <name1> <name2> --test-threads=1`), which the underlying libtest harness does support, and confirmed the exact same "test result: ok. 2 passed" output the plan's verify step required.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `families::members`'s `public_key`/`fingerprint`/`verified_at` fields are now populated by real data once a user calls `PUT /api/identity/keypair` / `POST /api/identity/verify/{id}`.
- `PUT/GET /api/identity/keypair` and `POST /api/identity/verify/{user_id}` are registered as an explicit allowlist exception (literal `.route()` calls outside `membership_routes()`/`family_routes()`) — Plan 22-05's route-sweep test needs to enumerate this exception alongside `POST /api/families`.
- `crates/pv-server/src/routes/mod.rs`'s edit stayed minimal and additive (module declaration + two `.route()` calls only) as required for this wave's shared-file coordination with Plan 22-03.

---
*Phase: 22-family-collection-data-model-server-authorization*
*Completed: 2026-07-30*

## Self-Check: PASSED
- FOUND: crates/pv-server/src/routes/identity.rs
- FOUND: crates/pv-server/tests/identity_keypair.rs
- FOUND: crates/pv-server/src/routes/mod.rs
- FOUND: .planning/phases/22-family-collection-data-model-server-authorization/22-02-SUMMARY.md
- FOUND: commit eac04f9 (Task 1)
- FOUND: commit 09e960b (Task 2)
