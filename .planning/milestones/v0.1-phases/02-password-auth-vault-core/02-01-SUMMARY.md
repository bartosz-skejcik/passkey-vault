---
phase: 02-password-auth-vault-core
plan: 01
subsystem: crypto
tags: [pv-core, pv-wasm, argon2id, hkdf, xchacha20poly1305, wasm-bindgen, zero-knowledge]

# Dependency graph
requires:
  - phase: 01-wasm-crypto-bridge-web-app-shell
    provides: pv-core crypto primitives (UserKey/WrappedKey/wrap-unwrap), pv-wasm opaque-handle bridge, web/src/lib/crypto/index.ts choke-point with a working self-test round-trip
provides:
  - "pv_core::items::encrypt_item/decrypt_item widened to bind AEAD associated data to item_id + revision (build_item_aad), rejecting any mismatch with Err(CryptoError::Decrypt)"
  - "pv_core::keys::INFO_AUTH_HASH domain-separation constant and pv_core::kdf::auth_hash_from_password, mirroring wrapping_key_from_password"
  - "pv-wasm's widened encryptItem/decryptItem exports (item_id, revision params) and a new deriveAuthMaterial export (WasmAuthMaterial handle with takeAuthHash/takeWrappingKey) computing one Argon2id pass and HKDF-expanding it twice"
  - "web/src/lib/crypto/index.ts established as the complete crypto facade contract: deriveAuthMaterial, generateUserKey, plus re-exported WasmUserKey/WasmWrappingKey/WasmAuthMaterial types and wrapUserKey/unwrapUserKey/encryptItem/decryptItem/randomSalt/defaultKdfParamsJson"
affects: [02-02, 02-03, 02-04, 02-05, phase-3-passkey-enrollment, phase-4-prf-unlock]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "AEAD associated-data identity binding: build_item_aad(prefix, item_id, revision) concatenates a versioned prefix + item_id bytes + revision.to_be_bytes(); key-wrap AAD is pinned to revision 0 (Cipher Key is stable across an item's revisions), payload AAD carries the real revision"
    - "Single-Argon2id-pass, dual-HKDF-expansion: call derive_master_key once, then hkdf_expand_key(mk, INFO_PW_UNLOCK) and hkdf_expand_key(mk, INFO_AUTH_HASH) — the standalone pv-core functions (wrapping_key_from_password/auth_hash_from_password) intentionally each re-run Argon2id and exist for callers that only need one output; the pv-wasm layer is where the shared-pass optimization actually happens"
    - "ZeroizeOnDrop struct with take*() mutable-borrow extraction (std::mem::take/replace) instead of consuming methods, since ZeroizeOnDrop's generated Drop impl forbids partial by-value field moves out of self"

key-files:
  created: []
  modified:
    - crates/pv-core/src/keys.rs
    - crates/pv-core/src/kdf.rs
    - crates/pv-core/src/items.rs
    - crates/pv-wasm/src/lib.rs
    - web/src/lib/crypto/index.ts
    - web/src/lib/crypto/index.test.ts

key-decisions:
  - "auth_hash_from_password and wrapping_key_from_password each independently call derive_master_key at the pv-core API level (intentional duplication, documented via doc comment) — the single-Argon2id-pass optimization lives one layer up in pv-wasm's deriveAuthMaterial, the actual call site that needs both outputs"
  - "revision stays u32 (not u64) per RESEARCH.md's reasoning — avoids wasm-bindgen BigInt marshaling friction; ample headroom (4.29B revisions/item)"

patterns-established:
  - "Item AAD identity binding (build_item_aad) is now the standard shape for any future AEAD call that must reject blob-swap/rollback splicing"
  - "take*() extraction methods for any future ZeroizeOnDrop wasm-bindgen struct that needs to yield multiple owned outputs"

requirements-completed: [VAULT-02, AUTH-01]

coverage:
  - id: D1
    description: "AD-bound item encryption rejects any item_id/revision mismatch with Err(CryptoError::Decrypt), not silent acceptance or a panic"
    requirement: "VAULT-02"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/items.rs#aad_mutation_rejected"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#item_roundtrip"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/items.rs#other_user_key_cannot_decrypt"
        status: pass
    human_judgment: false
  - id: D2
    description: "A single Argon2id pass produces both the auth-hash (sent to server) and the wrapping key (never sent), domain-separated via HKDF"
    requirement: "AUTH-01"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/kdf.rs#auth_hash_differs_from_wrapping_key"
        status: pass
      - kind: unit
        ref: "crates/pv-core/src/kdf.rs#auth_hash_from_password_is_deterministic"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#derive_auth_material_single_pass"
        status: pass
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#derive_auth_material_is_deterministic"
        status: pass
    human_judgment: false
  - id: D3
    description: "Phase 1's self-test still passes end-to-end against the widened item-encryption signature; lib/crypto/index.ts exposes the complete crypto facade contract for later plans"
    verification:
      - kind: unit
        ref: "crates/pv-wasm/src/lib.rs#full_roundtrip"
        status: pass
      - kind: unit
        ref: "web/src/lib/crypto/index.test.ts (4 tests: initCrypto memoization/rejection, runSelfTest ordering/partial-failure)"
        status: pass
      - kind: other
        ref: "bash scripts/build-wasm.sh — real wasm-bindgen build against the widened Rust exports, confirmed generated .d.ts exposes deriveAuthMaterial/WasmAuthMaterial/takeAuthHash/takeWrappingKey and the widened encryptItem/decryptItem signatures"
        status: pass
    human_judgment: false

duration: 25min
completed: 2026-07-13
status: complete
---

# Phase 2 Plan 1: Shared Crypto Core Extension Summary

**AD-bound item encryption (item_id/revision-keyed AAD) and single-Argon2id-pass auth-hash/wrapping-key derivation, threaded through pv-core → pv-wasm → the lib/crypto/ facade.**

## Performance

- **Duration:** 25 min
- **Completed:** 2026-07-13
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `pv_core::items::encrypt_item`/`decrypt_item` now bind ciphertext to `item_id`/`revision` via `build_item_aad`; a new `aad_mutation_rejected` test proves both an item_id mismatch and a revision mismatch fail with `Err(CryptoError::Decrypt)` — VAULT-02's literal signature security guarantee
- New `pv_core::keys::INFO_AUTH_HASH` domain-separation constant and `pv_core::kdf::auth_hash_from_password`, verified to diverge from `wrapping_key_from_password`'s output for identical inputs and to be deterministic
- `pv-wasm` gains `deriveAuthMaterial` (one `derive_master_key` Argon2id pass, HKDF-expanded twice) returning a `ZeroizeOnDrop` `WasmAuthMaterial` handle with `takeAuthHash()`/`takeWrappingKey()` extraction methods; verified single-pass output interoperates with the standalone `WasmWrappingKey::fromPassword` path and is deterministic across calls
- `encryptItem`/`decryptItem` wasm exports widened with `item_id`/`revision`; Phase 1's self-test call sites in `lib/crypto/index.ts` updated accordingly and still pass
- `web/src/lib/crypto/index.ts` now exports the full crypto facade contract for later Phase 2 plans: `deriveAuthMaterial`, `generateUserKey`, plus re-exported `WasmUserKey`/`WasmWrappingKey`/`WasmAuthMaterial` types and `wrapUserKey`/`unwrapUserKey`/`encryptItem`/`decryptItem`/`randomSalt`/`defaultKdfParamsJson`
- Ran a real `wasm-bindgen` build (`bash scripts/build-wasm.sh`) against the widened Rust exports to confirm the generated `.d.ts`/glue actually reflects the new signatures end-to-end, not just the native `cargo test` target

## Task Commits

Each task was committed atomically:

1. **Task 1: pv-core — auth-hash derivation + AD-bound item encryption** - `b14d938` (feat)
2. **Task 2: pv-wasm export widening + single-pass auth material + self-test signature fix** - `89b134e` (feat)

**Plan metadata:** committed alongside this summary

## Files Created/Modified
- `crates/pv-core/src/keys.rs` - Added `INFO_AUTH_HASH: &[u8] = b"pv:auth-hash:v1"` domain-separation constant
- `crates/pv-core/src/kdf.rs` - Added `auth_hash_from_password` (mirrors `wrapping_key_from_password`) plus its `mod tests` (`auth_hash_differs_from_wrapping_key`, `auth_hash_from_password_is_deterministic`)
- `crates/pv-core/src/items.rs` - Replaced static `AAD_ITEM_KEY`/`AAD_ITEM_DATA` constants with `AAD_ITEM_KEY_PREFIX`/`AAD_ITEM_DATA_PREFIX` + `build_item_aad`; widened `encrypt_item`/`decrypt_item` with `item_id`/`revision`; updated `item_roundtrip`/`other_user_key_cannot_decrypt`; added `aad_mutation_rejected`
- `crates/pv-wasm/src/lib.rs` - Widened `encryptItem`/`decryptItem` exports; added `WasmAuthMaterial` struct (`takeAuthHash`/`takeWrappingKey`) and `deriveAuthMaterial` export; updated `full_roundtrip` test fixture; added `derive_auth_material_single_pass`/`derive_auth_material_is_deterministic` tests
- `web/src/lib/crypto/index.ts` - Added `deriveAuthMaterial`, `generateUserKey`; re-exported `WasmUserKey`/`WasmWrappingKey`/`WasmAuthMaterial` types and `wrapUserKey`/`unwrapUserKey`/`encryptItem`/`decryptItem`/`randomSalt`/`defaultKdfParamsJson`; fixed self-test call sites to pass `("self-test-item", 1)`
- `web/src/lib/crypto/index.test.ts` - Added `mockDeriveAuthMaterial` to the hoisted mock factory and `vi.mock` wiring for the new wasm export

## Decisions Made
- `auth_hash_from_password`/`wrapping_key_from_password` each independently re-run `derive_master_key` at the `pv-core` API level — this is intentional, documented duplication; the single-Argon2id-pass optimization is deliberately pushed to `pv-wasm::deriveAuthMaterial`, the one real call site (registration/login) that needs both outputs from one hash
- `WasmAuthMaterial` extraction uses mutable-borrow `take*()` methods (`std::mem::take`/`std::mem::replace`) rather than consuming-`self` methods, because `#[derive(ZeroizeOnDrop)]` generates a `Drop` impl and Rust forbids partial by-value moves out of a type with a custom `Drop`

## Deviations from Plan

None - plan executed exactly as written. One addition beyond the plan's literal text: added a `mod tests` block to `crates/pv-core/src/kdf.rs` (which had no test module before) to directly assert the Task 1 `<behavior>` claim that `auth_hash_from_password` diverges from and is deterministic alongside `wrapping_key_from_password` — this is Rule 2 (missing critical test coverage for a security-relevant domain-separation guarantee the plan's own behavior spec calls out), not a scope change.

## Issues Encountered
None - both tasks compiled and passed on the first implementation pass. Additionally ran the real `wasm-bindgen` build (not required by the plan's stated verify command, but a natural extra check given this plan's job is establishing the wasm/TS facade contract) to confirm generated bindings match the new signatures; it succeeded cleanly with no warnings beyond expected getrandom audit output.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The full crypto facade contract (`deriveAuthMaterial`, `generateUserKey`, `wrapUserKey`/`unwrapUserKey`/`encryptItem`/`decryptItem`/`randomSalt`/`defaultKdfParamsJson`, plus opaque handle types) is available from `web/src/lib/crypto/index.ts` for Plans 02-02 (register/login server), 02-03 (vault CRUD server), 02-04 (auth UI), and 02-05 (vault UI) to consume without ever importing `./wasm` directly.
- No blockers identified for subsequent plans in this phase.

---
*Phase: 02-password-auth-vault-core*
*Completed: 2026-07-13*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commits (`b14d938`, `89b134e`) verified present in git history.
