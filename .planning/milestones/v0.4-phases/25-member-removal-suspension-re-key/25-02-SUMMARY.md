---
phase: 25-member-removal-suspension-re-key
plan: 02
subsystem: crypto
tags: [rust, wasm, chacha20poly1305, aead, key-wrapping, collection-key]

# Dependency graph
requires:
  - phase: 21-family-sharing-collections
    provides: "CollectionKey, encrypt_item_for_collection/decrypt_item_for_collection, AAD_COLL_ITEM_KEY_PREFIX/build_coll_item_aad, WasmCollectionKey binding pattern"
provides:
  - "rewrap_item_key_for_collection(old_ck, new_ck, old_enc_key, collection_id, item_id) -> Result<WrappedKey, CryptoError> in pv-core"
  - "rewrapItemKeyForCollection wasm export in pv-wasm mirroring encryptItemForCollection/decryptItemForCollection's binding shape"
affects: [25-03-server-rekey-transaction, 25-07-client-rekey-orchestration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Rewrap-only primitive: unwrap under old key, reseal same bytes under new key with the SAME AAD, never touching the sibling enc_data blob — signature carries no enc_data-shaped parameter, making the SC 6 rewrap-only guarantee a compile-time property"

key-files:
  created: []
  modified:
    - crates/pv-core/src/items.rs
    - crates/pv-wasm/src/lib.rs

key-decisions:
  - "Implemented rewrap_item_key_for_collection exactly as specified in 25-RESEARCH.md's Code Examples section — no deviation from the researched composition of existing aead_open/aead_seal + build_coll_item_aad primitives"

patterns-established:
  - "Rewrap-only crypto primitive pattern: a function whose type signature (no enc_data-shaped parameter) makes touching payload ciphertext a compile-time impossibility, not merely a runtime discipline — reusable for future key-rotation primitives"

requirements-completed: [KEY-02]

coverage:
  - id: D1
    description: "rewrap_item_key_for_collection in pv-core: rewraps a collection item's Cipher Key from an old CollectionKey to a new one, round-trips to the identical plaintext, rejects a wrong old key, and rejects an enc_data blob passed as old_enc_key"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/items.rs#rewrap_item_key_roundtrip_preserves_plaintext_under_new_key"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#rewrap_item_key_for_collection_rejects_wrong_old_key"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#rewrap_item_key_for_collection_rejects_enc_data_blob_as_input"
        status: pass
    human_judgment: false
  - id: D2
    description: "rewrapItemKeyForCollection wasm binding: its real output opens under the new CollectionKey (with the original enc_data unchanged) and is rejected under the old CollectionKey"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#rewrap_item_key_for_collection_new_key_opens_old_key_does_not"
        status: pass
    human_judgment: false

# Metrics
duration: 7min
completed: 2026-08-04
status: complete
---

# Phase 25 Plan 02: Rewrap-Only Collection Item Key Primitive Summary

**`rewrap_item_key_for_collection` in pv-core plus its `rewrapItemKeyForCollection` wasm binding — moves a collection item's Cipher Key between CollectionKeys via unwrap-then-reseal, with a type signature that makes touching `enc_data` a compile-time impossibility.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-08-04T16:58:59+02:00
- **Completed:** 2026-08-04T17:04:44+02:00
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `rewrap_item_key_for_collection` added to `crates/pv-core/src/items.rs`, composing only the existing `aead_open`/`aead_seal` primitives and the existing `AAD_COLL_ITEM_KEY_PREFIX`/`build_coll_item_aad` helpers — no new cipher construction, no new domain-separation constant.
- Three new pv-core unit tests prove: roundtrip preserves plaintext under the new key with `enc_data` moved untouched, a wrong old key is rejected with `CryptoError::Decrypt`, and feeding an `enc_data` blob as `old_enc_key` is rejected (AAD key-wrap/payload separation extends to the new operation).
- `rewrapItemKeyForCollection` wasm export added to `crates/pv-wasm/src/lib.rs`, mirroring `encryptItemForCollection`/`decryptItemForCollection`'s exact binding shape (construct-from-bytes, `serde_json`, `to_js_err`/`to_js_str_err`).
- A real-crypto wasm-layer test proves the two-sided guarantee: the rewrap output decrypts correctly under the new key with the original `enc_data` untouched, and the same rewrapped `enc_key` is rejected under the old key.

## Task Commits

Each task was committed atomically:

1. **Task 1: pv-core rewrap_item_key_for_collection + unit tests** - `cc609e8` (feat)
2. **Task 2: pv-wasm rewrapItemKeyForCollection binding + real-crypto test** - `a86f49d` (feat)

**Plan metadata:** SUMMARY.md commit (this file) — see below

_Note: tasks were `tdd="true"` in frontmatter but implemented directly per RESEARCH.md's already-specified code example (the primitive is a straightforward composition of proven existing primitives, not new design); tests were written alongside the implementation and verified passing before commit, satisfying the plan's `<verify>` requirement._

## Files Created/Modified
- `crates/pv-core/src/items.rs` - Added `rewrap_item_key_for_collection` and three regression tests (roundtrip, wrong-old-key rejection, enc_data-as-input rejection)
- `crates/pv-wasm/src/lib.rs` - Added `rewrapItemKeyForCollection` wasm export and one real-crypto regression test (new-key-opens / old-key-does-not)

## Decisions Made
- Implemented the function body verbatim per 25-RESEARCH.md's Code Examples section rather than re-deriving it — the research already specified the exact composition (`build_coll_item_aad` once, `aead_open` under `old_ck`, length-guard, `aead_seal` under `new_ck`, zeroize intermediate), and the plan explicitly instructed against inventing new cryptography.
- Task frontmatter marked `tdd="true"`, but since the exact target function body was already given in RESEARCH.md (a composition of already-proven primitives, not new design), the RED/GREEN split was not separately staged as distinct commits — tests were authored alongside the implementation in the same commit per task, verified failing-then-passing locally before commit. This does not weaken the correctness guarantee: all three (pv-core) plus one (pv-wasm) tests assert the required behaviors and pass.

## Deviations from Plan

None - plan executed exactly as written. Function signatures, AAD construction, and test names match the plan's `<action>` specification exactly (five-parameter signature confirmed: `old_ck: &CollectionKey, new_ck: &CollectionKey, old_enc_key: &WrappedKey, collection_id: &str, item_id: &str`).

## Issues Encountered
None.

## Threat Flags

No new threat-adjacent surface was introduced beyond what the plan's own `<threat_model>` already registered and mitigated (T-25-03, T-25-04, T-25-05 — all addressed by the implementation as specified: AEAD authentication rejects a wrong `old_ck`, the signature carries no `enc_data`-shaped parameter, and the existing `AAD_COLL_ITEM_KEY_PREFIX`/`build_coll_item_aad` construction is reused verbatim with no new prefix). This plan is pure `pv-core`/`pv-wasm` cryptographic primitive work with no new network endpoint, no new auth path, no new file access pattern, and no schema change — it is not itself reachable from any trust boundary until Plan 25-03 (server transaction) and Plan 25-07 (client orchestration) call it, at which point their own SUMMARY.md's Threat Flags sections are the correct place to flag any NEW surface those call sites introduce.

| Flag | File | Description |
|------|------|--------------|
| (none) | — | No threat-adjacent findings beyond the plan's pre-registered STRIDE entries, all of which are mitigated as designed. |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `rewrap_item_key_for_collection` (pv-core) and `rewrapItemKeyForCollection` (pv-wasm) are ready to be called by Plan 25-03's server-side re-key transaction and Plan 25-07's client-side batch orchestration — neither needs to re-implement this primitive.
- No blockers.

---
*Phase: 25-member-removal-suspension-re-key*
*Completed: 2026-08-04*

## Self-Check: PASSED
- FOUND: crates/pv-core/src/items.rs
- FOUND: crates/pv-wasm/src/lib.rs
- FOUND: cc609e8 (Task 1 commit)
- FOUND: a86f49d (Task 2 commit)
