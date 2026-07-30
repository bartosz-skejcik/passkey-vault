---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
fixed_at: 2026-07-30T00:16:55Z
review_path: .planning/phases/21-crypto-foundation-asymmetric-identity-collection-keys/21-REVIEW.md
iteration: 1
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 21: Code Review Fix Report

**Fixed at:** 2026-07-30T00:16:55Z
**Source review:** .planning/phases/21-crypto-foundation-asymmetric-identity-collection-keys/21-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope (critical_warning): 9 (2 critical, 7 warning)
- Fixed: 9
- Skipped: 0
- Info findings (IN-01..IN-06): left untouched per `fix_scope`, entries in REVIEW.md unmodified.

**Verification (run against the final committed state, in the isolated worktree):**
- `cargo test --workspace` — all green (pv-core: 47 unit + `backward_compat.rs` 1/1 == 48; pv-wasm: 24; pv-provider: 4+1+2; pv-server: 41+2+9+2+5+8+10+4+4+7+5+18). `pre_v0_4_item_decrypts_unchanged` still passes — `build_item_aad` and the personal-scope AAD prefixes are untouched.
- `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` — clean, no errors (confirms `subtle`/`curve25519-dalek` stay `wasm32-unknown-unknown`-portable).
- `cargo clippy --workspace --all-targets` — zero warnings.
- `bash scripts/check-supply-chain.sh` — exit 0; `advisories ok, bans ok, licenses ok, sources ok`. Two pre-existing `warn`-level notices (duplicate `thiserror-impl` v1/v2, yanked `spin` v0.9.8 via `flume`/`sqlx-sqlite`) are unrelated to this fix pass and were present before it.

## Fixed Issues

### CR-01: `seal()` accepted small-order/all-zero X25519 recipient public keys

**Files modified:** `crates/pv-core/src/identity.rs`, `crates/pv-core/Cargo.toml`, `Cargo.lock`, `crates/pv-wasm/src/lib.rs`
**Commit:** `0b36c76`
**Status:** fixed: requires human verification (see rationale below)

**Applied fix:**
- `IdentityPublicKey::from_bytes` is now fallible (`Result<Self, CryptoError>`): it masks bit 255 (RFC 7748 field-decode, also fixes WR-04) and rejects any of the 7 known small-order Curve25519 encodings (libsodium's blocklist: `0`, `1`, two order-8 points, and the ≥p aliases `p-1`/`p`/`p+1`) via a **constant-time** membership check (`subtle::ConstantTimeEq`, OR-accumulated into a `subtle::Choice`, converted to `bool` only at the end — no `==`/early-return on secret-adjacent data).
- `IdentityPublicKey`'s `Deserialize` is no longer derived — a custom impl routes untrusted JSON through the same validating `from_bytes`, so `serde_json::from_str::<IdentityPublicKey>(server_supplied_json)` can no longer construct an unvalidated value.
- **Second boundary (defense in depth, per the review's explicit ask):** `SealedKey.ephemeral_pk` is a bare `[u8; 32]` with no validating constructor at all (unlike `IdentityPublicKey`), and it arrives from untrusted storage on `unseal()`'s path. A malicious/tampered blob setting it to a small-order point would make the recipient's shared secret land in a small enumerable set (or the fixed all-zero box key) *regardless of the recipient's real secret key* — letting an attacker forge a `SealedKey` that "successfully" unseals to attacker-chosen bytes for every recipient. `unseal()` now canonicalizes and rejects it with the same check before touching `crypto_box`.
- `seal()` also re-checks `recipient_pk` internally (redundant with `from_bytes`/`Deserialize`, but cheap insurance against a future refactor adding another construction path).
- Added `subtle = "=2.6.1"` as a **direct** (previously transitive-only) dependency of `pv-core`, exact-pinned. It was already resolved at exactly this version via `crypto_box -> curve25519-dalek -> subtle`, so this does not move the resolved graph (`Cargo.lock` diff is a single added dependency-edge line).
- Added regression tests with the literal attack vectors: `from_bytes_rejects_all_zero_public_key`, `from_bytes_rejects_u_equals_one_public_key`, `from_bytes_rejects_all_small_order_points` (all 7), `unseal_rejects_small_order_ephemeral_public_key`, `unseal_rejects_u_equals_one_ephemeral_public_key`, plus WASM-boundary equivalents (`wasm_identity_public_key_from_bytes_rejects_small_order`).

**Verification method for the 7 blocklist constants (documented in-code):** empirically checked against this workspace's exact resolved `curve25519-dalek 4.1.3` — each of the 7 encodings satisfies `MontgomeryPoint::mul_bits_be(<literal integer 8, big-endian bits>) == identity`, confirming true order dividing 8; a random point does not. (An earlier attempt to verify via `crypto_box::SecretKey`'s own `Scalar::from_bytes_mod_order(clamp_integer(..))` path gave misleading results, because that path additionally reduces mod the prime subgroup order `l`, which is a different — and wrong — question from "does this point have small order"; `mul_bits_be` against the literal integer 8 is the correct test and is what the fix's code comment now records.)

**Why "requires human verification" despite full green tests:** this is a from-scratch constant-time small-order rejection implemented against a third-party crate's undocumented internals (`crypto_box` has no built-in validation — confirmed via its own `// TODO(tarcieri): validate key` upstream). The 9 new/adapted tests all pass, `cargo clippy` is clean, and the constants were independently verified against the exact resolved `curve25519-dalek` version rather than transcribed from memory — but this is exactly the class of security-critical cryptographic logic (right blocklist, right boundary, right constant-time discipline) where automated test-passing does not substitute for a second reviewer's read of the diff before downstream sharing plans build on it, per this phase's own review verdict ("Both need to land before downstream plans build on this foundation").

---

### CR-02: `sealCollectionKey` required the recipient's SECRET key

**Files modified:** `crates/pv-wasm/src/lib.rs`
**Commit:** `0b36c76` (same commit as CR-01 — see note below)
**Status:** fixed

**Applied fix:** added `WasmIdentityPublicKey`, an opaque handle wrapping `pv_core::identity::IdentityPublicKey`, constructed via `fromBytes` (which routes through the now-validating `IdentityPublicKey::from_bytes`, so CR-01's rejection applies at the WASM boundary too). `sealCollectionKey` now takes `&WasmIdentityPublicKey` instead of `&WasmIdentityKey` — sealing is now expressible holding only the recipient's public value, never their secret key. No secret-key-bytes export was added; `publicKeyBytes()` (already the sanctioned public-value exception) is the only raw-bytes crossing involved.

Added `seal_with_recipient_public_key_only_cross_party`: Bob generates his identity keypair once; only his public bytes are used to build `WasmIdentityPublicKey` for the seal call (the `bob` secret-key handle is never touched at seal time); only Bob's real `WasmIdentityKey` can unseal it. This is the cross-party case the review noted was entirely missing from the original test suite (`seal_unseal_collection_key_roundtrip`/`unseal_wrong_recipient_fails` both self-sealed to an identity whose secret key the test held).

**Note on commit bundling:** CR-01 and CR-02 landed in the same commit (`0b36c76`) together with WR-01/02/04/05/06, because `pv-wasm` directly calls `pv_core::identity`'s public API (`IdentityPublicKey::from_bytes`'s now-fallible signature, `unseal`'s now-`Zeroizing`-wrapped return type). Splitting `crates/pv-core/src/identity.rs` from `crates/pv-wasm/src/lib.rs` into separate commits would have left an intermediate commit where the workspace does not compile — violating the "each commit is a complete, working, tested unit" invariant this fixer is supposed to preserve. This was a deliberate trade-off in favor of every commit being buildable/testable in isolation, over one-commit-per-finding-ID purity.

---

### WR-01: `[u8; 32]` is `Copy` — plaintext key arrays survived un-zeroized after being wrapped in a `ZeroizeOnDrop` newtype

**Files modified:** `crates/pv-core/src/identity.rs` (site 1, bundled into `0b36c76`), `crates/pv-core/src/items.rs`, `crates/pv-core/src/keys.rs` (sites 2/3, plus the bonus consistency site the review called out), `crates/pv-wasm/src/lib.rs` (site 4, bundled into `0b36c76`)
**Commits:** `0b36c76` (identity.rs, pv-wasm sites), `65582a6` (items.rs, keys.rs sites)
**Status:** fixed

**Applied fix:** at every flagged site (`identity.rs::unwrap_identity_secret_key`, `items.rs::decrypt_item`, `items.rs::decrypt_item_for_collection`, `pv-wasm::import_user_key_from_session`, and — for consistency, as the review suggested — `keys.rs::unwrap_user_key`), added an explicit `k.zeroize()` call on the local `[u8; KEY_LEN]` array immediately after it is copied into the owning newtype. The fifth original site (`pv-wasm::unseal_collection_key`) was eliminated entirely rather than patched: it now delegates to the new `pv_core::identity::unseal_collection_key` helper (see WR-06), which internally applies the same zeroize-after-copy pattern once, in `pv-core`, instead of being duplicated at the WASM boundary.

---

### WR-02: `IdentitySecretKey::generate()` left two avoidable un-zeroized copies of the private key

**Files modified:** `crates/pv-core/src/identity.rs`
**Commit:** `0b36c76`
**Status:** fixed

**Applied fix:** `generate()` now fills its own `[u8; KEY_LEN]` directly via `OsRng.fill_bytes(&mut k)` instead of routing through `crypto_box::SecretKey::generate()`. Per `crypto_box-0.9.1/src/secret_key.rs`, `SecretKey::from_bytes` stores the raw CSPRNG output verbatim (only the derived `scalar` is clamped), so this is bit-for-bit equivalent to what `crypto_box` did — while removing `crypto_box::SecretKey`'s own un-zeroized local plus the `to_bytes()` temporary from the key-creation path entirely. `generate_produces_distinct_keypairs` and the existing round-trip tests remain the equivalence proof and still pass.

---

### WR-03: ARCHITECTURE.md asserted the ephemeral seal secret is zeroized; it is not, and the same section contradicted itself

**Files modified:** `docs/ARCHITECTURE.md`
**Commit:** `9511283`
**Status:** fixed

**Applied fix:** replaced "efemeryczny sekret zeroizowany natychmiast po użyciu" with "efemeryczny sekret jest lokalną zmienną jednego wywołania, nigdy nie przechowywany ani reużywany — jego surowa kopia `bytes` NIE jest zeroizowana (patrz ograniczenie 2 poniżej)", exactly as the review suggested, so the "Odrzucone alternatywy" bullet no longer contradicts "Dwa znane ograniczenia" item 2 six lines below it.

---

### WR-04: `IdentityPublicKey` derived `Eq` over non-canonical encodings

**Files modified:** `crates/pv-core/src/identity.rs`
**Commit:** `0b36c76`
**Status:** fixed

**Applied fix:** folded into CR-01's validating `from_bytes`/`Deserialize` as the review suggested — bit 255 is masked (`canonical[31] &= 0x7f`) before the small-order check and before storing, so any two encodings differing only in that ignored bit canonicalize to the same `IdentityPublicKey` and therefore compare equal via the still-derived `Eq`/`PartialEq`. `from_bytes_canonicalizes_bit_255_alias` asserts `from_bytes(pk)` and `from_bytes(pk with bit 255 set)` are equal.

---

### WR-05: `WasmCollectionKey::generate()` routed the Collection Key through a plain heap `Vec<u8>`

**Files modified:** `crates/pv-wasm/src/lib.rs`
**Commit:** `0b36c76`
**Status:** fixed

**Applied fix:** delegates to `pv_core::items::CollectionKey::generate()` (which already fills its stack array directly via `OsRng`) and copies only the final `[u8; KEY_LEN]` out via `.expose()`, instead of calling `random_bytes()` (documented as being for public randomness/salts, never key material) and copying out of an un-zeroized heap `Vec<u8>`.

---

### WR-06: `pv_core::identity::unseal` returned raw secret bytes as a bare `Vec<u8>` with no caller obligation

**Files modified:** `crates/pv-core/src/identity.rs`, `crates/pv-wasm/src/lib.rs`
**Commit:** `0b36c76`
**Status:** fixed

**Applied fix:** `unseal` now returns `Result<zeroize::Zeroizing<Vec<u8>>, CryptoError>` — the zeroize obligation is carried by the type, not left to caller discipline. Added `unseal_collection_key(my_sk, sealed) -> Result<crate::items::CollectionKey, CryptoError>`, which delegates to `unseal` and centralizes the `KEY_LEN`-exact-length check (never truncates, never panics) so it exists in exactly one place. `pv-wasm`'s `unsealCollectionKey` binding now delegates to this new helper instead of re-implementing the length check and zeroize dance itself.

---

### WR-07: new transitive crypto crates got no `deny.toml` watch-list row

**Files modified:** `deny.toml`
**Commit:** `5ea1ee9`
**Status:** fixed

**Applied fix:** added rows for `crypto_secretbox` (0.1.1), `curve25519-dalek` (4.1.3, noting the `>= 4.1.3` requirement for RUSTSEC-2024-0344), `curve25519-dalek-derive` (0.1.1), and `fiat-crypto` (0.2.9) — all `Cargo.lock-pin-only`, transitive via `crypto_box`/`curve25519-dalek` — following the existing `getrandom`/`openssl-sys` row format. Also added a row for `subtle` (2.6.1), which CR-01's fix promoted from transitive-only to a direct `pv-core` dependency (exact-pinned `=2.6.1`).

## Skipped Issues

None — all 9 in-scope findings (CR-01, CR-02, WR-01 through WR-07) were fixed. IN-01 through IN-06 were left untouched per `fix_scope: critical_warning`; their entries in `21-REVIEW.md` are unmodified.

---

_Fixed: 2026-07-30T00:16:55Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
