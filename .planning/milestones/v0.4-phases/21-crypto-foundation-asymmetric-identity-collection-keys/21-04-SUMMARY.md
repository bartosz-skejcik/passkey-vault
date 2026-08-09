---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
plan: 04
subsystem: crypto
tags: [crypto_box, chachabox, x25519, sealed-box, pv-core, key-wrapping]

# Dependency graph
requires:
  - phase: 21-02
    provides: "IdentitySecretKey/IdentityPublicKey opaque X25519 keypair types, crypto_box =0.9.1 pinned dependency"
provides:
  - "SealedKey type — anonymous-sender sealed-box blob (ephemeral_pk + nonce + ciphertext), sibling to keys::WrappedKey"
  - "identity::seal/identity::unseal — pure-crypto Collection Key seal/unseal primitive"
  - "chachabox_rejects_nonempty_aad regression guard proving the crypto_box 0.9.1 AAD limitation"
affects: [22, 25]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fresh ephemeral crypto_box::SecretKey generated as a function-local variable per seal() call, never stored/cached/reused/returned"
    - "Empty-AAD-only ChaChaBox encrypt/decrypt convenience methods — Payload{msg,aad} form permanently avoided, backed by a named regression test"
    - "Fixed-size [u8; KEY_LEN] field (ephemeral_pk) used where a compile-time length guarantee is possible, Vec<u8> (nonce/ciphertext) only where it isn't"

key-files:
  created: []
  modified:
    - crates/pv-core/src/identity.rs
    - crates/pv-core/src/lib.rs

key-decisions:
  - "SealedKey is a new sibling type to keys::WrappedKey, not a replacement — WrappedKey stays byte-for-byte unchanged for symmetric (password/PRF) recipients"
  - "No AAD on the SealedKey/ChaChaBox layer — ChaChaBox cryptographically rejects non-empty AAD (proven by chachabox_rejects_nonempty_aad); scope-binding for collection-scoped items lives one layer down at items.rs's build_coll_item_aad (Plan 21-03), per 21-RESEARCH.md's 'AAD Binding — Where It Actually Lives'"
  - "Random (not Blake2b-derived) nonce per seal, matching aead_seal's existing discipline elsewhere in this codebase — cryptographically equivalent given a fresh ephemeral keypair is drawn per seal"
  - "ephemeral_pk is [u8; KEY_LEN] (compile-time-fixed), not Vec<u8> like nonce/ciphertext — a wrong-length ephemeral public key is a compile-time impossibility, documented by a dedicated test"

requirements-completed: [KEY-02, KEY-04]

coverage:
  - id: D1
    description: "A direct ChaChaBox::encrypt call with non-empty associated data returns Err, confirming the verified crypto_box 0.9.1 AAD limitation"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#chachabox_rejects_nonempty_aad"
        status: pass
    human_judgment: false
  - id: D2
    description: "A 32-byte payload sealed to recipient A's IdentityPublicKey unseals under A's IdentitySecretKey to byte-identical plaintext"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#seal_unseal_roundtrip"
        status: pass
    human_judgment: false
  - id: D3
    description: "The same sealed payload fails to unseal under a different, independently-generated recipient's IdentitySecretKey"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#wrong_recipient_cannot_unseal"
        status: pass
    human_judgment: false
  - id: D4
    description: "A SealedKey with a wrong-length nonce is rejected with CryptoError::InvalidInput before any AEAD call, never panics or silently truncates/pads"
    requirement: "KEY-02"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#malformed_sealed_key_wrong_nonce_length_rejected"
        status: pass
    human_judgment: false
  - id: D5
    description: "ephemeral_pk is a fixed [u8; 32] array (not Vec<u8>), so a wrong-length ephemeral public key is a compile-time impossibility"
    requirement: "KEY-04"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#malformed_sealed_key_wrong_ephemeral_pk_length_is_compile_time_impossible"
        status: pass
    human_judgment: false
  - id: D6
    description: "Full pv-core module suite, full workspace suite, and the wasm32-unknown-unknown release build all stay green with the sealed-box addition present"
    requirement: "KEY-02"
    verification:
      - kind: integration
        ref: "cargo test -p pv-core identity:: (11 passed); cargo test --workspace (all green, backward_compat fixture 1 passed); cargo build -p pv-wasm --target wasm32-unknown-unknown --release (exits 0)"
        status: pass
    human_judgment: false

# Metrics
duration: 35min
completed: 2026-07-29
status: complete
---

# Phase 21 Plan 04: Sealed-Box Collection Key Primitive Summary

**Added `SealedKey` and `identity::seal`/`identity::unseal` — the one hand-composed piece of asymmetric cryptography this crate owns: a fresh ephemeral `crypto_box::SecretKey` per call, `ChaChaBox` for the ECDH+AEAD composition, empty-AAD-only (permanently regression-tested), proven correct across two independent keypairs and proven to reject both the wrong recipient and a malformed blob.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-29T22:54:00Z
- **Completed:** 2026-07-29T23:29:02Z
- **Tasks:** 2
- **Files modified:** 2 (`crates/pv-core/src/identity.rs`, `crates/pv-core/src/lib.rs`)

## Accomplishments

- New `SealedKey { ephemeral_pk: [u8; 32], nonce: Vec<u8>, ciphertext: Vec<u8> }` in `crates/pv-core/src/identity.rs` — a sibling to `keys::WrappedKey`, never a replacement; `ephemeral_pk` is intentionally a fixed-size array (compile-time length guarantee) where `nonce`/`ciphertext` stay `Vec<u8>`
- `seal(recipient_pk, plaintext)`: generates a fresh, function-local `crypto_box::SecretKey` per call via `ChaChaBox::new`, draws a fresh random nonce via `ChaChaBox::generate_nonce`, encrypts with the empty-AAD convenience method only — the ephemeral secret is never stored, cached, or reused across calls
- `unseal(my_sk, sealed)`: validates `sealed.nonce.len() == NONCE_LEN` before any AEAD call (returns `CryptoError::InvalidInput`, never panics/truncates), reconstructs the box from the blob's `ephemeral_pk` and the caller's `IdentitySecretKey`
- Permanent regression test `chachabox_rejects_nonempty_aad`: proves a direct `ChaChaBox::encrypt` call with non-empty `Payload.aad` returns `Err`, confirming the verified `crypto_box` 0.9.1 limitation (21-RESEARCH.md Correction 4) so a future contributor reaching for `Payload`'s `aad` field gets an immediate named test failure instead of silently assuming AAD support
- `seal_unseal_roundtrip`/`wrong_recipient_cannot_unseal`: proves a 32-byte payload round-trips to identical bytes across two independently-generated `IdentitySecretKey`s, and fails to unseal under a different recipient's key
- `malformed_sealed_key_wrong_nonce_length_rejected`/`malformed_sealed_key_wrong_ephemeral_pk_length_is_compile_time_impossible`: proves the malformed-blob edge cases from KEY-02's coverage report — one is a runtime check, the other a compile-time impossibility, documented as such
- `lib.rs`'s key-hierarchy diagram: minor clarity correction (`IdentitySecretKey (publiczna połowa)` → `IdentityPublicKey`, naming the actual type `seal`/`unseal` operate on and the module/functions doing the sealing) — no structural change

## Task Commits

Each task was committed atomically:

1. **Task 1: SealedKey type + seal/unseal ephemeral-keypair wrapper** - `2d7575c` (feat)
2. **Task 2: Cross-keypair seal/unseal round trip, wrong-recipient rejection, malformed-blob rejection** - `7fefc00` (test)

## Files Created/Modified

- `crates/pv-core/src/identity.rs` - Added `SealedKey`, `seal`, `unseal`, and 5 new tests (`chachabox_rejects_nonempty_aad`, `seal_unseal_roundtrip`, `wrong_recipient_cannot_unseal`, `malformed_sealed_key_wrong_nonce_length_rejected`, `malformed_sealed_key_wrong_ephemeral_pk_length_is_compile_time_impossible`); added `crypto_box::aead::{Aead, AeadCore}` trait imports and `NONCE_LEN` to the existing `crate::keys` import
- `crates/pv-core/src/lib.rs` - Minor factual-clarity correction to the sealing branch of the key-hierarchy ASCII diagram

## Decisions Made

- `ChaChaBox` rejects non-empty AAD (verified both by source reading and by this plan's own `chachabox_rejects_nonempty_aad` runtime test) — no AAD parameter was added to `seal`/`unseal`; scope-binding for collection-scoped items is Plan 21-03's `build_coll_item_aad`, one layer down, per 21-RESEARCH.md's "AAD Binding — Where It Actually Lives"
- Random nonce per seal (via `ChaChaBox::generate_nonce`), not a Blake2b-derived deterministic one like libsodium's/`crypto_box`'s own rejected `seal()` feature — cryptographically equivalent given a fresh ephemeral keypair is generated per seal, and consistent with `aead_seal`'s existing discipline elsewhere in this codebase
- Did not enable `crypto_box`'s built-in `seal`/`unseal` (gated behind the optional `seal` feature) — it hardcodes `SalsaBox`, not `ChaChaBox`, breaking this project's XChaCha20Poly1305-consistency rationale; this was found and deliberately rejected in Plan 21-02's KEY-05 decision, not overlooked
- `ephemeral_pk` uses `[u8; KEY_LEN]` rather than `Vec<u8>` specifically so a wrong-length ephemeral public key is impossible to construct, not merely rejected at runtime — documented by its own dedicated test rather than a length-check branch in `unseal`

## Deviations from Plan

None — plan executed exactly as written. Both tasks' acceptance criteria and truths were met exactly as specified; the ephemeral-secret-key zeroize caveat was documented in code comments rather than worked around, per the plan's own explicit instruction not to attempt a `.zeroize()` call `crypto_box::SecretKey` doesn't support.

## Issues Encountered

None of note. `unseal`'s nonce-length check originally referenced `keys::NONCE_LEN` via a fully-qualified module path that wasn't imported at file scope (only inside the test module) — corrected in the same task pass by adding `NONCE_LEN` to the existing `use crate::keys::{...}` import list; verified by a clean `cargo build -p pv-core` before any test run, no separate fix commit needed since this was caught before Task 1's commit.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `identity::seal`/`identity::unseal` are ready for Phase 22/25's actual collection/membership orchestration (row persistence, multi-recipient rewrap on add/remove) — this plan delivered only the pure-crypto primitive and its tests, as scoped
- `crates/pv-core/src/items.rs` was not touched, as required (owned by the concurrent Plan 21-03 executor this wave)
- Full verification triple confirmed green with the sealed-box addition present: `cargo test -p pv-core identity::` (11 passed), `cargo test --workspace` (all green, including the wave-1 `backward_compat` fixture test), `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` (exits 0)

---
*Phase: 21-crypto-foundation-asymmetric-identity-collection-keys*
*Completed: 2026-07-29*

## Self-Check: PASSED

- FOUND: crates/pv-core/src/identity.rs
- FOUND: crates/pv-core/src/lib.rs
- FOUND commit: 2d7575c (Task 1)
- FOUND commit: 7fefc00 (Task 2)
