---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
plan: 02
subsystem: crypto
tags: [crypto_box, x25519, zeroize, wasm, pv-core, key-wrapping]

# Dependency graph
requires:
  - phase: 21-01
    provides: "KEY-05 decision record (crypto_box vs alternatives), pre-v0.4 backward-compat fixture"
provides:
  - "IdentitySecretKey/IdentityPublicKey opaque X25519 keypair types in pv-core"
  - "wrap_identity_secret_key/unwrap_identity_secret_key (UserKey-wrapped identity secret)"
  - "INFO_X25519_SK_WRAP domain-separation constant"
  - "crypto_box =0.9.1 pinned dependency, verified to compile native + wasm32-unknown-unknown"
affects: [21-03, 21-04]

# Tech tracking
tech-stack:
  added: ["crypto_box =0.9.1 (chacha20, alloc, rand_core features)"]
  patterns:
    - "Opaque key wrapper stores its own [u8; KEY_LEN] with #[derive(Zeroize, ZeroizeOnDrop)] rather than a long-lived third-party key type, when that type does not implement Zeroize itself"
    - "Transient reconstruction of a non-Zeroize third-party key type per call (as_crypto_box()), never stored as a struct field"

key-files:
  created:
    - crates/pv-core/src/identity.rs
  modified:
    - crates/pv-core/Cargo.toml
    - deny.toml
    - crates/pv-core/src/lib.rs

key-decisions:
  - "crypto_box feature set is [\"chacha20\", \"alloc\", \"rand_core\"] (not the plain [\"chacha20\", \"alloc\"] drafted upstream) — the rand_core feature is required for SecretKey::generate() to exist, verified by real compilation per 21-RESEARCH.md Correction 1"
  - "IdentitySecretKey stores its own [u8; 32] with Zeroize/ZeroizeOnDrop instead of holding a crypto_box::SecretKey field, because crypto_box::SecretKey's Drop only zeroizes its internal scalar, never its raw byte array (21-RESEARCH.md Correction 5 / Zeroize Gap)"
  - "wrap/unwrap reuse keys::aead_seal/aead_open verbatim with a new INFO_X25519_SK_WRAP AAD constant — no new symmetric AEAD construction introduced"

requirements-completed: [KEY-01, KEY-04, KEY-05]

coverage:
  - id: D1
    description: "IdentitySecretKey::generate() produces two independently-generated keypairs with distinct secret-key bytes and distinct public-key bytes"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#generate_produces_distinct_keypairs"
        status: pass
    human_judgment: false
  - id: D2
    description: "IdentityPublicKey round-trips through to_bytes()/from_bytes() to an equal value"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#public_key_roundtrips_through_bytes"
        status: pass
    human_judgment: false
  - id: D3
    description: "INFO_X25519_SK_WRAP is a new, versioned domain-separation constant, provably distinct from every existing INFO_* constant"
    requirement: "KEY-04"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#constant_distinctness"
        status: pass
    human_judgment: false
  - id: D4
    description: "wrap_identity_secret_key/unwrap_identity_secret_key round-trip an IdentitySecretKey through a UserKey-derived wrapping key to identical bytes"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#wrap_unwrap_roundtrip"
        status: pass
    human_judgment: false
  - id: D5
    description: "Unwrapping under the wrong UserKey fails"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#wrong_user_key_fails_to_unwrap"
        status: pass
    human_judgment: false
  - id: D6
    description: "A wrapped blob whose decrypted plaintext is not exactly 32 bytes is rejected with CryptoError::Decrypt, not silently accepted or truncated"
    requirement: "KEY-01"
    verification:
      - kind: unit
        ref: "crates/pv-core/src/identity.rs#wrapped_blob_wrong_length_rejected"
        status: pass
    human_judgment: false
  - id: D7
    description: "crypto_box compiles cleanly against the real workspace lockfile for both native and wasm32-unknown-unknown targets, with rand_core resolving to a single version"
    requirement: "KEY-05"
    verification:
      - kind: integration
        ref: "cargo tree -p pv-core -i rand_core (single rand_core v0.6.4 line)"
        status: pass
      - kind: integration
        ref: "cargo build -p pv-wasm --target wasm32-unknown-unknown --release"
        status: pass
    human_judgment: false

# Metrics
duration: 45min
completed: 2026-07-29
status: complete
---

# Phase 21 Plan 02: X25519 Identity Keypair Primitive Summary

**Added the audited `crypto_box` dependency with the compile-verified feature set and an opaque `IdentitySecretKey`/`IdentityPublicKey` pair (mirroring `UserKey`) that wraps/unwraps the identity secret under a `UserKey` via the existing symmetric `aead_seal`/`aead_open` — no new symmetric crypto, no I/O added.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-07-29T22:30:00Z
- **Completed:** 2026-07-29T23:15:03Z
- **Tasks:** 2
- **Files modified:** 4 (1 new: `crates/pv-core/src/identity.rs`; 3 modified: `crates/pv-core/Cargo.toml`, `deny.toml`, `crates/pv-core/src/lib.rs`) plus `Cargo.lock` (dependency resolution)

## Accomplishments

- Pinned `crypto_box = "=0.9.1"` with the corrected feature set (`chacha20`, `alloc`, `rand_core`) in `crates/pv-core/Cargo.toml`, and added the matching watch-list row to `deny.toml`
- New `crates/pv-core/src/identity.rs`: `IdentitySecretKey` (opaque `[u8; 32]` wrapper with its own `Zeroize`/`ZeroizeOnDrop`, since `crypto_box::SecretKey` does not implement `Zeroize`) and `IdentityPublicKey`, with `generate()`, `from_bytes()`, `public_key()`/`to_bytes()`, and a private `as_crypto_box()` that reconstructs the third-party type transiently per call — never stored as a field
- `wrap_identity_secret_key`/`unwrap_identity_secret_key` reuse `keys::aead_seal`/`keys::aead_open` verbatim with the new `INFO_X25519_SK_WRAP` domain-separation constant as AAD, including the same length-check-then-zeroize discipline as `unwrap_user_key`
- Registered `pub mod identity;` in `lib.rs` and extended the "Hierarchia kluczy" ASCII diagram to describe the two new branches (identity key wrap here, Collection Key sealing landing in Plan 21-04)
- Verified against the real workspace lockfile: `cargo tree -p pv-core -i rand_core` resolves to a single `rand_core v0.6.4`; `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` succeeds with `crypto_box` present; `cargo deny check` reports `advisories ok, bans ok, licenses ok, sources ok` with no new findings

## Task Commits

Each task was committed atomically:

1. **Task 1: crypto_box dependency + IdentitySecretKey/IdentityPublicKey generate — thinnest end-to-end slice** - `6c70ee7` (feat)
2. **Task 2: wrap_identity_secret_key/unwrap_identity_secret_key — UserKey-wrapped secret storage** - `264e9a6` (feat)

_Note: split into two atomic commits matching the plan's two tasks, even though both tasks were authored in the same working session._

## Files Created/Modified

- `crates/pv-core/src/identity.rs` - New module: `IdentitySecretKey`, `IdentityPublicKey`, `INFO_X25519_SK_WRAP`, `wrap_identity_secret_key`, `unwrap_identity_secret_key`, and 6 tests
- `crates/pv-core/Cargo.toml` - Added `crypto_box = { version = "=0.9.1", default-features = false, features = ["chacha20", "alloc", "rand_core"] }`
- `deny.toml` - Added watch-list row for `crypto_box 0.9.1`
- `crates/pv-core/src/lib.rs` - Registered `pub mod identity;` and extended the key-hierarchy diagram
- `Cargo.lock` - Updated by adding the new dependency

## Decisions Made

- Used the corrected `crypto_box` feature set (`chacha20`, `alloc`, `rand_core`) per 21-RESEARCH.md's Verified Corrections — the plain `["chacha20", "alloc"]` set drafted in 21-CONTEXT.md does not compile against `SecretKey::generate()`
- `IdentitySecretKey` stores its own `[u8; 32]` with `Zeroize`/`ZeroizeOnDrop` rather than a long-lived `crypto_box::SecretKey` field, because the latter's `Drop` only zeroizes its internal `scalar`, never the raw byte array — documented in both the module doc comment and this summary per project convention (CLAUDE.md: "Security-critical decisions explained")
- No new symmetric AEAD construction: `wrap_identity_secret_key`/`unwrap_identity_secret_key` call `keys::aead_seal`/`keys::aead_open` directly

## Deviations from Plan

None - plan executed exactly as written. One planned-context file (`21-PATTERNS.md`) referenced in the plan's `<context>` and `<read_first>` sections did not exist on disk; proceeded using `21-RESEARCH.md`'s "Zeroize Gap — Wrapper Type Design Implication" section (which contains the equivalent concrete code shape) and `keys.rs` as the pattern source instead, per the plan's own read_first fallback ordering. This is not a deviation from delivered behavior — all acceptance criteria and truths were met exactly as specified.

## Issues Encountered

- Initial single-file write triggered an `unused import: self` warning (the `keys` module import was only used inside `#[cfg(test)]`) — fixed by scoping `use crate::keys;` to the test module only. No functional impact; verified clean recompile with zero warnings.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `IdentitySecretKey`/`IdentityPublicKey` and the wrap/unwrap pair are ready for Plan 21-04 (sealed Collection Key construction, which seals per-recipient Collection Keys under `IdentityPublicKey`)
- `crypto_box` is proven to compile cleanly for both native and `wasm32-unknown-unknown` targets against this workspace's real lockfile — no blockers for Plan 21-03 (scope-bound AAD) or 21-04
- `crates/pv-core/src/items.rs` was not touched, as required (owned by the concurrent Plan 21-03 executor this wave)

---
*Phase: 21-crypto-foundation-asymmetric-identity-collection-keys*
*Completed: 2026-07-29*

## Self-Check: PASSED

- FOUND: crates/pv-core/src/identity.rs
- FOUND: .planning/phases/21-crypto-foundation-asymmetric-identity-collection-keys/21-02-SUMMARY.md
- FOUND commit: 6c70ee7 (Task 1)
- FOUND commit: 264e9a6 (Task 2)
- FOUND commit: be52d9d (this SUMMARY)
