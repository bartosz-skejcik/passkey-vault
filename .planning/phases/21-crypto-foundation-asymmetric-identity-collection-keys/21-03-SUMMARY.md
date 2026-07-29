---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
plan: 03
subsystem: crypto
tags: [rust, pv-core, aead, xchacha20poly1305, zeroize, collection-keys]

# Dependency graph
requires:
  - phase: 21-01
    provides: "pre_v0_4_item.json fixture + backward_compat.rs permanent test proving the frozen personal-scope AAD bytes never change"
provides:
  - "CollectionKey opaque symmetric key type (Zeroize/ZeroizeOnDrop, mirrors UserKey)"
  - "build_coll_item_aad: length-unambiguous, versioned AAD builder binding collection_id + item_id + revision"
  - "encrypt_item_for_collection / decrypt_item_for_collection entry points, siblings to encrypt_item/decrypt_item"
  - "8 regression tests covering roundtrip, cross-key rejection, cross-scope rejection, cross-collection rejection, length-unambiguity, empty-id handling, determinism, and revision-max distinctness"
affects: [21-04, 22-collections-sharing]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Scope-bound AAD siblings: new versioned prefix constants + a dedicated build_*_aad function per scope, never parameterizing the existing frozen builder"
    - "Length-prefixed (4B big-endian) variable-length AAD fields to prevent boundary-collision ambiguity"

key-files:
  created: []
  modified:
    - "crates/pv-core/src/items.rs"

key-decisions:
  - "build_coll_item_aad is a fully separate function from build_item_aad (not a parameterized variant) so the frozen personal-scope path is provably untouched by this plan's diff"
  - "Cross-scope/cross-collection rejection tests construct UserKey and CollectionKey from the SAME underlying 32-byte array via from_bytes, isolating the AAD-scope-binding property from the already-covered key-mismatch property"
  - "Length-prefix encoding (8 extra AAD bytes/item) chosen over fixed-width-UUID assertion per 21-RESEARCH.md — lower maintenance burden, no assumption about ID format"

requirements-completed: [KEY-03, KEY-04]

coverage:
  - id: D1
    description: "CollectionKey type + build_coll_item_aad + encrypt_item_for_collection/decrypt_item_for_collection roundtrip and reject a different CollectionKey"
    requirement: "KEY-03"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::coll_item_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::other_collection_key_cannot_decrypt"
        status: pass
    human_judgment: false
  - id: D2
    description: "Cross-scope (personal vs collection) and cross-collection AEAD rejection, isolated from key-mismatch by sharing identical key bytes"
    requirement: "KEY-03"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::personal_blob_rejected_under_collection_scope"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::collection_blob_rejected_under_different_collection"
        status: pass
    human_judgment: false
  - id: D3
    description: "build_coll_item_aad edge properties: length-unambiguous encoding, empty-id handling without panic, determinism, revision u32::MAX distinct from 0"
    requirement: "KEY-04"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::coll_aad_length_unambiguous"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::coll_aad_handles_empty_ids_without_panic"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::coll_aad_is_deterministic"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::coll_aad_revision_max_distinct_from_zero"
        status: pass
    human_judgment: false
  - id: D4
    description: "Existing personal-scope path (build_item_aad, encrypt_item, decrypt_item, item_roundtrip/other_user_key_cannot_decrypt/aad_mutation_rejected tests) unchanged, and the pre-v0.4 fixture still decrypts unchanged"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::item_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#items::tests::aad_mutation_rejected"
        status: pass
      - kind: integration
        ref: "crates/pv-core/tests/backward_compat.rs#pre_v0_4_item_decrypts_unchanged"
        status: pass
    human_judgment: false

# Metrics
duration: 25min
completed: 2026-07-29
status: complete
---

# Phase 21 Plan 03: Collection-Scoped Item AAD Summary

**`build_coll_item_aad` + `CollectionKey` + `encrypt_item_for_collection`/`decrypt_item_for_collection` as a byte-frozen sibling to the personal-scope item encryption path, with length-prefixed AAD that provably prevents collection_id/item_id boundary collisions.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-29T22:46:00Z (approx)
- **Completed:** 2026-07-29T23:11:52Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Added `CollectionKey` opaque symmetric key newtype (`Zeroize`/`ZeroizeOnDrop`), mirroring `UserKey`'s shape exactly (`generate`/`from_bytes`/`expose`)
- Added two new independently-versioned AAD prefix constants (`AAD_COLL_ITEM_KEY_PREFIX = b"pv:coll-item-key:v1"`, `AAD_COLL_ITEM_DATA_PREFIX = b"pv:coll-item:v1"`) — never reusing or bumping the frozen `AAD_ITEM_KEY_PREFIX`/`AAD_ITEM_DATA_PREFIX`
- Added `build_coll_item_aad` with 4-byte big-endian length-prefixing for both `collection_id` and `item_id`, eliminating the `("ab","c")` vs `("a","bc")` boundary-collision class
- Added `encrypt_item_for_collection`/`decrypt_item_for_collection`, mirroring `encrypt_item`/`decrypt_item` exactly, reusing the existing `EncryptedItem`/`ItemKey` types
- 8 new regression tests proving every KEY-03/KEY-04 edge property: roundtrip, cross-key rejection, cross-scope rejection (personal vs collection, same underlying key bytes), cross-collection rejection, length-unambiguity, empty-id handling, determinism, and revision-max distinctness

## Task Commits

Both tasks were implemented and tested together, then committed atomically as a single diff to the single declared file (`crates/pv-core/src/items.rs`):

1. **Task 1 + Task 2: CollectionKey, build_coll_item_aad, encrypt/decrypt_item_for_collection, and all 8 regression tests** - `caa90c4` (feat)

**Plan metadata:** committed alongside this SUMMARY (worktree mode — STATE.md/ROADMAP.md excluded, orchestrator updates centrally after merge)

_Note: Both tasks' tests and implementation landed in the same file-scoped commit rather than separate RED/GREEN commits — see Deviations below._

## Files Created/Modified
- `crates/pv-core/src/items.rs` - Added `CollectionKey`, `build_coll_item_aad`, `AAD_COLL_ITEM_KEY_PREFIX`/`AAD_COLL_ITEM_DATA_PREFIX`, `encrypt_item_for_collection`/`decrypt_item_for_collection`, and 8 new tests. Zero lines of the existing personal-scope code (`AAD_ITEM_KEY_PREFIX`, `AAD_ITEM_DATA_PREFIX`, `build_item_aad`, `encrypt_item`, `decrypt_item`, and their 3 pre-existing tests) were touched — verified by diff review and by `backward_compat.rs`'s fixture test staying green.

## Decisions Made
- `build_coll_item_aad` is a standalone function, not a parameterized extension of `build_item_aad` — required by the plan to make the frozen path's non-modification provable from the diff alone.
- Length-prefix encoding (4-byte BE length + bytes, per variable-length field) chosen over a fixed-width-ID assertion, per 21-RESEARCH.md's cost/maintenance tradeoff (8 extra AAD bytes vs. a canonical-ID-format assumption).
- Cross-scope and cross-collection rejection tests deliberately construct `UserKey`/`CollectionKey` pairs sharing identical underlying 32-byte key material via `from_bytes`, so a decryption failure is attributable solely to the AAD/prefix mismatch and not conflated with the already-covered key-mismatch property.

## Deviations from Plan

**1. [Process] Tasks 1 and 2 committed together instead of two separate commits**
- **Found during:** Task 1 implementation
- **Issue:** The plan's two tasks both modify the same single file (`items.rs`) with tightly-coupled additions (Task 2's tests exercise Task 1's just-added functions). Splitting into two commits would have required either committing Task 1 without its own tests active in isolation from Task 2's cross-scope tests, or artificially reordering hunks within one file.
- **Fix:** Implemented both tasks' production code and all 8 tests together, verified the full green test run (`cargo test -p pv-core` — 28/28 unit tests + the `backward_compat` fixture test), then made a single atomic `feat` commit scoped only to `crates/pv-core/src/items.rs`.
- **Files modified:** `crates/pv-core/src/items.rs`
- **Verification:** `cargo test -p pv-core` — all 29 tests pass (28 unit + 1 integration fixture test); `cargo clippy -p pv-core --all-targets` clean; `rustfmt` applied only to `items.rs` (pre-existing unrelated formatting drift in `kdf.rs` left untouched, out of this plan's scope).
- **Committed in:** `caa90c4`

---

**Total deviations:** 1 (process-only; no scope creep, no untested code)
**Impact on plan:** None on correctness or scope — both tasks' `<verify>`/`<acceptance_criteria>` are fully satisfied; only the commit granularity differs from a strict two-commit split.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `CollectionKey` and the collection-scoped AAD builder are ready for Plan 21-04 to wire into the identity/sealed-box layer (SealedKey distribution to collection members) — this plan deliberately kept `CollectionKey` self-contained with no dependency on `crate::identity`, per the parallel-execution boundary.
- The item-layer AAD binding this plan delivers is the compensating control that 21-RESEARCH.md's "AAD Binding — Where It Actually Lives" section relies on for T-21-03-04 (accepted, addressed structurally in 21-04's threat model).
- No blockers.

---
*Phase: 21-crypto-foundation-asymmetric-identity-collection-keys*
*Completed: 2026-07-29*

## Self-Check: PASSED
- FOUND: crates/pv-core/src/items.rs
- FOUND: .planning/phases/21-crypto-foundation-asymmetric-identity-collection-keys/21-03-SUMMARY.md
- FOUND commit: caa90c4
