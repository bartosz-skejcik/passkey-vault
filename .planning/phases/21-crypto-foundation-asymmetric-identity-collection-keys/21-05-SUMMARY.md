---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
plan: 05
subsystem: crypto
tags: [wasm-bindgen, x25519, crypto_box, opaque-handle, zero-knowledge]

# Dependency graph
requires:
  - phase: 21-02
    provides: X25519 identity keypair primitives (IdentitySecretKey, wrap_identity_secret_key, unwrap_identity_secret_key)
  - phase: 21-03
    provides: Collection-scoped item encryption (CollectionKey, encrypt_item_for_collection, decrypt_item_for_collection, scope-bound AAD)
  - phase: 21-04
    provides: Sealed-box primitives (SealedKey, seal, unseal) using crypto_box's ChaChaBox
provides:
  - "pv-wasm opaque-handle bridge for every pv-core primitive Phase 21 introduced"
  - "WasmIdentityKey (generate, publicKeyBytes) — the sole raw-byte accessor across both new types"
  - "wrapIdentitySecretKey/unwrapIdentitySecretKey JSON-blob bridging"
  - "WasmCollectionKey (WASM-local opaque type, generate)"
  - "sealCollectionKey/unsealCollectionKey with length-checked unseal"
  - "encryptItemForCollection/decryptItemForCollection mirroring encryptItem/decryptItem exactly"
affects: [22-family-collection-data-model, 26-web-app-sharing-ui, 27-extension-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "WASM-local opaque type with no pv-core counterpart (WasmCollectionKey mirrors the WasmWrappingKey precedent)"
    - "publicKeyBytes as a sanctioned raw-byte exception requiring no banner comment (public key material is not secret, same reasoning as randomSalt)"

key-files:
  created: []
  modified:
    - crates/pv-wasm/src/lib.rs

key-decisions:
  - "WasmCollectionKey stays a WASM-local opaque type with no pv-core-side counterpart struct, exactly like WasmWrappingKey — a deliberate deviation from 21-RESEARCH.md's literal raw-&[u8]-parameter draft signatures, made to preserve the file's 'no raw key bytes cross the boundary' rule"
  - "Task 1's own seal_unseal_collection_key_roundtrip test genuinely depends on Task 2's encryptItemForCollection/decryptItemForCollection (per the plan's own behavior spec, since WasmCollectionKey exposes no raw-byte getter) — split the two task commits so Task 1's commit ships its other 3 tests, and moved that one test into Task 2's commit where it compiles and passes; documented here rather than silently reordering the plan's task numbering"

requirements-completed: [KEY-01, KEY-02, KEY-03, KEY-04]

coverage:
  - id: D1
    description: "WasmIdentityKey generate/wrap/unwrap round-trips identically by public-key bytes; wrapping under the wrong UserKey fails"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::identity_key_generate_wrap_unwrap_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::identity_key_wrong_user_key_fails"
        status: pass
    human_judgment: false
  - id: D2
    description: "WasmCollectionKey sealed to one identity's public key and unsealed via that same identity round-trips; unsealing via a different identity fails"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::seal_unseal_collection_key_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::unseal_wrong_recipient_fails"
        status: pass
    human_judgment: false
  - id: D3
    description: "encryptItemForCollection/decryptItemForCollection round-trip a plaintext through a WasmCollectionKey with matching collection_id/item_id/revision, mirroring encryptItem/decryptItem's shape; wrong collection_id fails"
    requirement: "KEY-03"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::collection_item_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#tests::collection_item_wrong_collection_id_fails"
        status: pass
    human_judgment: false
  - id: D4
    description: "No new #[wasm_bindgen] method returns raw identity-secret-key or Collection-Key bytes to JS — publicKeyBytes is the sole new raw-byte-returning addition"
    requirement: "KEY-04"
    verification:
      - kind: manual_procedural
        ref: "grep -n \"pub fn.*-> Vec<u8>\\|pub fn.*-> \\[u8\" crates/pv-wasm/src/lib.rs — confirms only export_user_key_for_session, public_key_bytes, take_auth_hash, random_salt return raw bytes (all pre-existing sanctioned exceptions plus the one new, public-key-only exception)"
        status: pass
    human_judgment: false

duration: ~35min
completed: 2026-07-30
status: complete
---

# Phase 21 Plan 05: pv-wasm Opaque-Handle Bridge for Identity Keys & Collection Keys Summary

**Extended `crates/pv-wasm/src/lib.rs` with `WasmIdentityKey`/`WasmCollectionKey` opaque handles and six new `#[wasm_bindgen]` functions bridging Phase 21's X25519 identity keypair, sealed-box, and collection-scoped item encryption primitives to JS — closing every pv-core primitive this phase introduced behind the existing zero-raw-secret-bytes boundary.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-30
- **Tasks:** 2
- **Files modified:** 1 (`crates/pv-wasm/src/lib.rs`)

## Accomplishments
- `WasmIdentityKey` opaque handle (generate/publicKeyBytes) wrapping `pv_core::identity::IdentitySecretKey`, with `wrapIdentitySecretKey`/`unwrapIdentitySecretKey` mirroring `wrapUserKey`/`unwrapUserKey`'s JSON-blob bridging exactly
- `WasmCollectionKey` as a WASM-local opaque type (no pv-core-side counterpart struct, mirroring `WasmWrappingKey`'s precedent) with `sealCollectionKey`/`unsealCollectionKey` bridging `pv_core::identity::seal`/`unseal`
- `unsealCollectionKey` rejects wrong-length unsealed payloads via `to_js_str_err` before ever touching the fixed-size array copy, mirroring `importUserKeyFromSession`'s reject-don't-truncate discipline
- `encryptItemForCollection`/`decryptItemForCollection` mirror `encryptItem`/`decryptItem`'s body shape exactly, bridging `pv_core::items::{encrypt_item_for_collection, decrypt_item_for_collection}`
- 6 new tests added to the existing native `#[cfg(test)] mod tests` block (no browser required): 4 for Task 1's identity/collection-key primitives, 2 for Task 2's collection-item encryption
- Every pv-core primitive Phase 21 introduced (identity keypair generate/wrap/unwrap, Collection Key seal/unseal, collection-scoped item encrypt/decrypt) is now reachable from JS — closing CONTEXT.md's "pv-wasm opaque-handle exposure... downstream phases consume a finished bridge" scope line

## Task Commits

Each task was committed atomically:

1. **Task 1: WasmIdentityKey + WasmCollectionKey opaque handles, wrap/unwrap, seal/unseal bindings** - `762df61` (feat)
2. **Task 2: encryptItemForCollection/decryptItemForCollection bindings** - `6466095` (feat)

_Note: Task 1's own `seal_unseal_collection_key_roundtrip` test was moved into Task 2's commit — see Deviations below._

## Files Created/Modified
- `crates/pv-wasm/src/lib.rs` - Added `WasmIdentityKey`, `WasmCollectionKey`, `wrapIdentitySecretKey`, `unwrapIdentitySecretKey`, `sealCollectionKey`, `unsealCollectionKey`, `encryptItemForCollection`, `decryptItemForCollection`, and 6 new tests (233 lines added total across both commits)

## Decisions Made
- `WasmCollectionKey` is a WASM-local opaque type with no pv-core-side counterpart type, exactly mirroring the existing `WasmWrappingKey` precedent — a deliberate deviation from 21-RESEARCH.md's literal raw-`&[u8]`-parameter draft signatures, made specifically to preserve the file's "raw key bytes never cross the WASM/JS boundary" rule per the plan's explicit instruction.
- `unsealCollectionKey` does a `KEY_LEN` length check on the unsealed payload (mirroring `importUserKeyFromSession`'s discipline) rather than silently truncating a mismatched length.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Split Task 1's `seal_unseal_collection_key_roundtrip` test into Task 2's commit**
- **Found during:** Task 1 (attempting to write the plan's own specified test body)
- **Issue:** The plan's Task 1 behavior spec for `seal_unseal_collection_key_roundtrip` explicitly requires comparing round-trip correctness "via a round-trip through `encryptItemForCollection`/`decryptItemForCollection`, since `WasmCollectionKey` exposes no raw-byte getter" — but those two functions are Task 2's deliverables, not Task 1's. Writing Task 1's commit with this test included would not compile (functions don't exist yet); writing a workaround test using only Task 1's own primitives would deviate from the plan's explicit test specification without adding real proof value (WasmCollectionKey genuinely has no raw-byte accessor to compare against directly, by design).
- **Fix:** Committed Task 1 with its other 3 tests (`identity_key_generate_wrap_unwrap_roundtrip`, `identity_key_wrong_user_key_fails`, `unseal_wrong_recipient_fails`), all of which compile and pass standalone. Added `seal_unseal_collection_key_roundtrip` in Task 2's commit, immediately after `encryptItemForCollection`/`decryptItemForCollection` land, using the exact comparison approach the plan specified.
- **Files modified:** `crates/pv-wasm/src/lib.rs` (both commits)
- **Verification:** `cargo test -p pv-wasm` green after each commit (18/21 tests at Task 1, 21/21 at Task 2); all 4 of Task 1's originally-specified tests exist and pass by the time Task 2 lands.
- **Committed in:** `762df61` (Task 1, 3 of 4 tests), `6466095` (Task 2, the deferred 4th test + Task 2's own 2 tests)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking cross-task test dependency)
**Impact on plan:** No scope change. Both tasks' full test coverage exists by the end of the plan (all 4 Task-1-specified tests + both Task-2-specified tests pass); only the exact commit each test lands in shifted by one commit, documented here for traceability.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Every pv-core primitive Phase 21 introduced (identity keypair, sealed Collection Key, collection-scoped item encryption) is reachable from JS through this opaque-handle bridge, with no raw secret key byte ever crossing the boundary (`publicKeyBytes` is the sole sanctioned exception, returning public key material only).
- Downstream phases (22+, per CONTEXT.md's phase-boundary) can consume this finished bridge directly — no phase needs to re-do pv-wasm binding work for these primitives.
- Verified: `cargo test -p pv-wasm` (21/21 passing), `cargo test --workspace` (all crates green, including the wave-1 `--test backward_compat` fixture regression test), `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` (exit 0), `scripts/check-supply-chain.sh` (advisories/bans/licenses/sources ok).

---
*Phase: 21-crypto-foundation-asymmetric-identity-collection-keys*
*Completed: 2026-07-30*
