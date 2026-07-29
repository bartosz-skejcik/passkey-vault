# Phase 21: Crypto Foundation — Asymmetric Identity & Collection Keys - Research

**Researched:** 2026-07-30
**Domain:** Rust/WASM asymmetric crypto primitive (X25519 sealed-box) added to an existing symmetric key hierarchy (`pv-core`)
**Confidence:** HIGH — every claim in "Verified Corrections" and "crypto_box 0.9.1 Concrete API" was confirmed by actually downloading `crypto_box-0.9.1` from crates.io, reading its source, and compiling/running real code against this workspace's exact pinned dependency graph (not by reading docs.rs summaries alone). See `## Verification Methodology`.

## Summary

Milestone-level research (`.planning/research/v0.4/STACK.md` §1, `ARCHITECTURE.md`, `PITFALLS.md`) already made the `crypto_box` vs. `hpke` vs. `rsa` decision and CONTEXT.md already locked it in. This document does NOT re-litigate that choice. Its job is to turn the locked decision into plan-ready specifics — and in doing so it found **two load-bearing corrections** to claims in the existing research/CONTEXT that change what the plan must contain:

1. **The feature flag set specified in CONTEXT.md is incomplete and will not compile.** `crypto_box = { version = "=0.9.1", default-features = false, features = ["chacha20", "alloc"] }` does **not** expose `SecretKey::generate()` — verified by an actual failed compile (`E0599: no associated function... generate`). The `rand_core` feature must be added: `features = ["chacha20", "alloc", "rand_core"]`. Confirmed by a second compile that succeeds and produces a working roundtrip.
2. **`crypto_box::SecretKey` does NOT implement `zeroize::Zeroize`.** ARCHITECTURE.md's claim ("`crypto_box::SecretKey` already implements `Zeroize`, so this is a thin wrapper") is wrong — verified by both reading `secret_key.rs`'s source (only a hand-written `Drop` that zeroizes the internal `scalar` field, never the raw `bytes: [u8; 32]` field) and by a failed compile trying to call `.zeroize()` on it directly. This is a real, small residual-exposure gap in the audited crate that the decision record must document honestly, and it changes how the opaque wrapper type should be built (see `## Zeroize Gap`).

Everything else in CONTEXT.md's decision holds up under direct verification: the "zero new `rand_core`/`getrandom` lines" claim is **true** (confirmed via `cargo tree` against this exact workspace, both native and `wasm32-unknown-unknown` targets, before and after adding `crypto_box`), `crypto_box` has **no AAD support** on its `ChaChaBox`/`SalsaBox` encrypt/decrypt calls (confirmed both by the crate's own doc comment and by a failing runtime test), and — a genuinely new finding not in any prior research — **`crypto_box` 0.9.1 DOES ship a built-in `crypto_box_seal`-equivalent (`PublicKey::seal`/`SecretKey::unseal`, gated behind the optional `seal` feature)**, which CONTEXT.md/STACK.md/ARCHITECTURE.md all state does not exist. It is not the recommended path (it hardcodes `SalsaBox`, not `ChaChaBox`, breaking the project's XChaCha20Poly1305-consistency rationale), but the decision record should show this was found and deliberately not used, not silently missed.

**Primary recommendation:** Proceed with `crypto_box =0.9.1`, `default-features = false, features = ["chacha20", "alloc", "rand_core"]` (note the added `rand_core` feature vs. CONTEXT.md's draft), hand-write the ephemeral-keypair sealed-box wrapper exactly as CONTEXT.md describes (not the crate's built-in `seal()`, which is SalsaBox-only), bind AAD via the item/Collection-Key layer's own `aead_seal` (which does support AAD) rather than via `ChaChaBox.encrypt` (which does not), and design the opaque `IdentityKey`/`SecretKey` wrapper type to store its own `[u8; 32]` + `Zeroize`/`ZeroizeOnDrop` (matching `UserKey`'s existing pattern) rather than relying on `crypto_box::SecretKey`'s own (incomplete) Drop behavior.

## User Constraints (from CONTEXT.md)

<user_constraints>

### Locked Decisions

**Sealed-Box Construction (KEY-05):**
- Use the `crypto_box` crate, exact-pinned `=0.9.1`, with `default-features = false` and `features = ["chacha20", "alloc"]` (**see Verified Corrections — must add `"rand_core"`**). Rejected: `hpke` 0.14.0 (forces bumping pinned `hkdf`/`chacha20poly1305`; too-new, no independent audit) and `rsa` 0.9.10 (open `RUSTSEC-2023-0071`; already-rejected Bitwarden pattern).
- Rationale to record: `crypto_box` is the only stable public-key-encryption crate in the RustCrypto org already publishing this project's other pinned primitives; Cure53-audited (Threema-funded, at 0.7.1, construction unchanged through 0.9.1); its `chacha20` feature makes the AEAD XChaCha20-Poly1305 — the exact cipher `aead_seal` already uses; its dependency graph resolves `rand_core ^0.6`/`aead ^0.5` identically to `chacha20poly1305 =0.10.1`, introducing zero new `rand_core`/`getrandom` lines. **Verify that last claim against the actual resolved lockfile during execution rather than trusting the research note** — this research did so; see `## Verified Corrections`.
- Do not hand-assemble X25519-ECDH over `hkdf`/`aead_seal`: `x25519-dalek 3.0.0` pulls `rand_core ^0.10`, breaking the graph alignment; hand-composing a KEM is rolled crypto.
- `crypto_box` has no built-in `seal()` [**PARTIALLY WRONG — see Verified Corrections**: it does, but it's SalsaBox-only and not the recommended path anyway], so the anonymous-sender wrapper is hand-written: fresh ephemeral `SecretKey` per seal, `ChaChaBox::new(&recipient_pk, &ephemeral_sk)`, encrypt, store `{ephemeral_pk, nonce, ciphertext}`, zeroize the ephemeral secret immediately.
- Do not add `chacha20` as a direct `pv-core` dependency — let `crypto_box` own that edge.
- Add the new pin to `deny.toml`'s watch-list in the same change.

**Identity Keypair Lifecycle (KEY-01, KEY-04):**
- Secret key at rest: wrapped under the account's own `UserKey` via existing `aead_seal`, under new constant `INFO_X25519_SK_WRAP = b"pv:x25519-sk-wrap:v1"`. Server stores an opaque blob, exactly like `pw_wrapped_uk`. Public key stored in the clear.
- Generation is client-side only (server never sees `UserKey`).
- Generation timing: lazily, on first unlock that observes no published public key — idempotent upsert, one code path for new accounts and pre-v0.4 upgrades. Phase 21 owns only the pure-crypto generation/wrap/unwrap functions and their tests — server persistence is Phase 22.
- Opaque type, following the `UserKey` precedent: `Zeroize + ZeroizeOnDrop` wrapper with a single `expose()`-style accessor, no `pub` raw-byte field. Raw secret bytes must not cross the WASM boundary.
- `SealedKey` is a new sibling type, not a replacement. `WrappedKey { nonce, ciphertext }` stays byte-for-byte unchanged; `SealedKey { ephemeral_pk, nonce, ciphertext }` is added alongside it.

**Scope-Bound AAD and Backward Compatibility (KEY-03, KEY-04, SC#3, SC#4):**
- Personal-scope AAD is **frozen exactly as-is**: `b"pv:item-key:v1" ‖ item_id ‖ 0u32_be` and `b"pv:item:v1" ‖ item_id ‖ revision_be`. Do not append a scope discriminator, do not bump `v1`.
- Collection scope gets its own new versioned prefixes including the collection id: `b"pv:coll-item-key:v1" ‖ collection_id ‖ item_id ‖ 0u32_be` and `b"pv:coll-item:v1" ‖ collection_id ‖ item_id ‖ revision_be`.
- Length-unambiguous concatenation required: encode each variable-length field length-prefixed, or assert both ids are fixed-width canonical UUID strings and test that assertion.
- Cross-context rejection test mandatory, extending `aad_mutation_rejected`: personal-scope blob must fail under collection scope and vice versa; collection A must fail under collection B; existing item_id/revision mismatch cases keep passing.
- Backward-compatibility proof must use **committed fixture data**, not a freshly-generated round trip.

### Claude's Discretion

Everything above is Claude's-Discretion, recorded as concrete choices. The planner may deviate only with explicit written rationale, and never on: (1) personal-scope AAD bytes frozen, (2) server never sees an unwrapped secret key or Collection Key.

### Deferred Ideas (OUT OF SCOPE)

- Signed identity keys / trust-on-first-use verification ledger — Phase 26 (UX-05/SEC-05) exposes fingerprints; that's the whole v0.4 trust model.
- Post-quantum KEM (X-Wing/ML-KEM via `hpke`) — not for v0.4.
- Key rotation for the X25519 identity keypair itself — no v0.4 requirement; `:v1` suffixes keep the door open.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| KEY-01 | Every account has an X25519 identity keypair; private key wrapped by UserKey, public key published; pre-v0.4 accounts get one on upgrade without re-encrypting the vault | `## crypto_box 0.9.1 Concrete API` (keypair gen/wrap), `## Pre-v0.4 Fixture Strategy` (proves SC#4's "without re-encrypting"), `## pv-wasm Exposure` |
| KEY-02 | A shared collection has its own Collection Key, sealed independently per member's public key; add/remove rewraps keys only | `## Sealed-Box Construction — Concrete Recommendation` (seal/unseal wrapper design) — full collection/DB wiring is Phase 22/25, this phase delivers the pure-crypto seal/unseal primitive it depends on |
| KEY-03 | Item AAD binds scope (personal vs. collection); moved items can't be silently reinterpreted | `## Scope-Bound AAD — Concrete Design`, `## Length-Unambiguous AAD Encoding` |
| KEY-04 | Personal/shared key derivation use distinct versioned `pv:...:v1` domain-separation constants | `## Scope-Bound AAD`, `## Identity Keypair Wrap Constant` |
| KEY-05 | Sealed-box implementation choice (`crypto_box` vs. hand-rolled) made and recorded as a first-class decision, before any dependent code | `## Verified Corrections`, `## KEY-05 Decision Record — Ready-to-Write Content`, `## Package Legitimacy Audit` |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| X25519 identity keypair generation, wrap/unwrap under UserKey | Shared crypto core (`pv-core`, compiled native + WASM) | — | Zero-knowledge boundary: only a client holding the unwrapped `UserKey` can produce/consume this; server never touches it |
| Sealed-box seal/unseal of a Collection Key | `pv-core` | — | Same zero-knowledge boundary; pure function, no I/O, no server dependency |
| Scope-bound item AAD builder (personal vs. collection) | `pv-core` | — | Extends the existing `items.rs` AAD scheme; must stay byte-compatible with today's personal-scope items |
| Opaque WASM handle exposure of the above | `pv-wasm` (WASM bridge) | Browser/Client (extension + web, as consumers) | Following the existing `WasmUserKey`/`WasmWrappingKey` opaque-handle pattern; raw secret bytes never cross the boundary |
| Decision record (KEY-05) | Documentation (`PROJECT.md` Key Decisions table + `docs/ARCHITECTURE.md` §4) | — | Not a runtime component, but this phase's first deliverable per SC#1's ordering requirement |
| Server persistence of public key / wrapped secret key / Collection Key rows | API / Backend (`pv-server`) | — | **Explicitly out of scope for Phase 21** (belongs to Phase 22) — flagged here only so the planner does not accidentally pull it in |

## Verification Methodology

Every claim below tagged `[VERIFIED: ...]` was confirmed in this research session by one or more of:
1. Downloading the real `crypto_box-0.9.1.crate` tarball from `static.crates.io` and reading its actual source (`src/lib.rs`, `src/public_key.rs`, `src/secret_key.rs`, the registry-normalized `Cargo.toml`).
2. Temporarily adding `crypto_box = { version = "=0.9.1", ... }` to this workspace's real `crates/pv-core/Cargo.toml`, running `cargo tree`/`cargo check`/`cargo build --target wasm32-unknown-unknown` against the real lockfile, then reverting (`git checkout --`) — confirmed clean via `git status` before and after.
3. A standalone scratch Cargo project (outside the workspace) compiling and **running** real `crypto_box` code (keypair generation, `ChaChaBox` encrypt/decrypt roundtrip, an AAD-rejection test, a `Zeroize`-trait compile test) to observe actual runtime/compiler behavior, not just documentation prose.
4. `curl` against the live `crates.io` API (with a proper User-Agent) for the package's real age/downloads/repository, for the Package Legitimacy Audit.

This is a stronger evidence bar than the milestone-level research used (which was HIGH-confidence but based on crates.io dependency-graph *metadata* and docs.rs summaries, not compiled/run code) — hence the two corrections below.

## Verified Corrections

These override the corresponding claims in `.planning/research/v0.4/STACK.md`, `ARCHITECTURE.md`, and `21-CONTEXT.md`. Treat this section as authoritative for Phase 21 planning; the milestone docs are not being edited.

### Correction 1 — Feature flags must include `rand_core`

CONTEXT.md's specified feature set:
```toml
crypto_box = { version = "=0.9.1", default-features = false, features = ["chacha20", "alloc"] }
```
`[VERIFIED: crates.io source + compile]` This does **not** compile against any code calling `SecretKey::generate()`:
```
error[E0599]: no associated function or constant named `generate` found for struct `SecretKey`
```
Reason: in `crypto_box` 0.9.1's `Cargo.toml`, `SecretKey::generate` is gated `#[cfg(feature = "rand_core")]` in `src/secret_key.rs`, and the `rand_core` feature is **not** implied by `chacha20` or `alloc`. It's a separate, independent feature flag (`rand_core = ["aead/rand_core"]` — distinct from the default `getrandom` feature, which is `["aead/getrandom", "rand_core"]` and pulls in more than needed).

**Corrected feature set** (verified to compile and produce a working roundtrip):
```toml
crypto_box = { version = "=0.9.1", default-features = false, features = ["chacha20", "alloc", "rand_core"] }
```

Do **not** enable the default `getrandom` feature on `crypto_box` — this project already supplies its own `OsRng` (re-exported via `chacha20poly1305::aead::rand_core::OsRng`, from the same `rand_core 0.6.4` line `crypto_box`'s `rand_core` feature resolves to), so `crypto_box`'s own `getrandom` re-export path is unnecessary and would be a second, redundant route to the same randomness source.

### Correction 2 — Dependency-graph claim is TRUE (re-verified, not just trusted)

`[VERIFIED: cargo tree against real workspace lockfile, both native and wasm32-unknown-unknown targets]`

With `crypto_box =0.9.1, features = ["chacha20","alloc","rand_core"]` added to `crates/pv-core/Cargo.toml`:
- `cargo tree -p pv-core -i rand_core` → single `rand_core v0.6.4`, reached via the pre-existing `chacha20poly1305 → aead → crypto-common → rand_core` path. `crypto_box`'s own `curve25519-dalek 4.1.3` dependency, notably, does **not** itself pull `rand_core` at all in this resolution (curve25519-dalek's own `rand_core` feature is off by default and `crypto_box` doesn't enable it — `crypto_box`'s `SecretKey::generate` fills the RNG-supplied bytes itself and does its own scalar-clamping, it doesn't delegate randomness to curve25519-dalek).
- `cargo tree -p pv-core -i getrandom` → single `getrandom v0.2.17`.
- `cargo tree -p pv-core --duplicates` → empty (no duplicate-version warnings at all).
- Real WASM build: `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` (the actual crate/target `build-wasm.sh` builds) succeeds cleanly with `crypto_box` present.
- `build-wasm.sh`'s own getrandom-duplicate-majors audit line (`cargo tree -i getrandom --target wasm32-unknown-unknown -p pv-wasm | grep '^getrandom '`) reports a single major, `v0.2` — the exact gate the script hard-fails the build on, still green.

**Conclusion: the "zero new `rand_core`/`getrandom` lines" claim holds.** This was re-derived from the actual resolved graph, not re-trusted from the milestone note, per CONTEXT.md's own instruction to do so.

### Correction 3 — `crypto_box` DOES have a built-in sealed-box, but it's the wrong cipher for this project

`[VERIFIED: crates.io source read]` CONTEXT.md, STACK.md, and ARCHITECTURE.md all state `crypto_box` "has no built-in `seal()`". This is not quite right: `crypto_box` 0.9.1 ships an optional `seal` cargo feature (`seal = ["dep:blake2", "alloc"]`) that adds:
```rust
// src/public_key.rs
#[cfg(feature = "seal")]
pub fn seal(&self, csprng: &mut impl CryptoRngCore, plaintext: &[u8]) -> Result<Vec<u8>, aead::Error>

// src/secret_key.rs
#[cfg(feature = "seal")]
pub fn unseal(&self, ciphertext: &[u8]) -> Result<Vec<u8>, aead::Error>
```
This is a genuine, faithful reimplementation of libsodium's `crypto_box_seal`/`crypto_box_seal_open` — it generates a fresh ephemeral keypair internally, derives the nonce as `Blake2b-24byte(ephemeral_pk ‖ recipient_pk)` (see `## Sealed-Box Construction` below for the exact function), and prepends the ephemeral public key to the ciphertext (`out = ephemeral_pk ‖ ciphertext`), returning one opaque `Vec<u8>`.

**Why this is still not the right call for this project**, despite existing:
1. **It is hardcoded to `SalsaBox` (XSalsa20Poly1305), not `ChaChaBox`.** `src/public_key.rs`'s `seal()` body literally constructs `SalsaBox::new(self, &ephemeral_sk)` — there is no `chacha20`-feature variant of `seal()`/`unseal()` in this crate. Using it would mean the sealed-Collection-Key blobs use a *different* AEAD cipher (XSalsa20Poly1305) than every other AEAD operation in this codebase (XChaCha20Poly1305 via `aead_seal`/`chacha20poly1305`), directly contradicting CONTEXT.md's own stated rationale for choosing `crypto_box` in the first place ("its `chacha20` feature makes the AEAD XChaCha20-Poly1305 — the exact cipher `aead_seal` already uses").
2. **It adds an unnecessary dependency** (`blake2`, only needed for the `seal` feature's internal nonce derivation) that the hand-written wrapper doesn't need, since CONTEXT.md's design uses a random 24-byte nonce (via `OsRng`) rather than a deterministic Blake2b-derived one (see next section for why this is fine).
3. **It has no AAD parameter**, same limitation as the general `encrypt`/`decrypt` methods (see Correction 4).

**Recommendation: do not enable the `seal` feature.** Keep CONTEXT.md's hand-written ephemeral-keypair-per-seal wrapper using `ChaChaBox`. The decision record should note that the built-in `seal()` was found and evaluated, and rejected specifically for the cipher mismatch, not overlooked — this closes a "why didn't you just use the crate's own primitive" question a future reviewer would otherwise raise.

### Correction 4 — `crypto_box`'s AEAD calls reject non-empty AAD (confirmed by both doc comment and a failing runtime test)

`[VERIFIED: crates.io source + a real failing call at runtime]` `src/lib.rs`'s doc comment on `CryptoBox<C>` states explicitly:

> "Note that additional associated data (AAD) is not supported and encryption operations will return `aead::Error` if it is provided as an argument."

Confirmed by running a real `ChaChaBox::encrypt(&nonce, Payload { msg, aad: b"non-empty" })` call: it returns `Err(aead::Error)`. An empty-AAD call (`ChaChaBox::encrypt(&nonce, plaintext)`, which is the `Aead::encrypt` convenience method — internally `aad = &[]`) succeeds and roundtrips correctly.

**This directly answers open question #4 from the phase brief: no, a Collection-Key seal cannot be bound to `(collection_id, recipient_user_id)` through `ChaChaBox`'s own AEAD tag.** See `## AAD Binding — Where It Actually Lives` for the concrete recommendation this leads to.

### Correction 5 — `crypto_box::SecretKey` does NOT implement `zeroize::Zeroize`

`[VERIFIED: crates.io source + a real failing compile]` ARCHITECTURE.md's `pv-core::keypair` row states: "`crypto_box::SecretKey` already implements `Zeroize`, so this is a thin wrapper, not new cryptography." This is incorrect. Reading `src/secret_key.rs`:

```rust
pub struct SecretKey {
    pub(crate) bytes: [u8; KEY_SIZE],
    pub(crate) scalar: Scalar,
}
// ...
impl Drop for SecretKey {
    fn drop(&mut self) {
        self.scalar.zeroize();
    }
}
```

`SecretKey` has a hand-written `Drop` that zeroizes only the `scalar` field (the value actually used for X25519 scalar multiplication) — it never zeroizes the raw `bytes: [u8; 32]` field, and `SecretKey` implements **no** `zeroize::Zeroize` trait at all (confirmed by a real compile attempt: `sk.zeroize()` fails with `E0599: the method zeroize exists ... but its trait bounds were not satisfied ... SecretKey: Zeroize`). Since `bytes` is `pub(crate)` (private outside the `crypto_box` crate), `pv-core` cannot manually zero it either.

**Practical impact for KEY-01's opaque wrapper type:** see `## Zeroize Gap — Wrapper Type Design Implication` below. This is a small, honestly-documentable residual exposure in an otherwise-audited crate, not a blocker — but the decision record must state it plainly, matching this project's zero-tolerance-for-unstated-crypto-caveats convention (CLAUDE.md: "Security-critical decisions explained").

## crypto_box 0.9.1 Concrete API

`[VERIFIED: crates.io source + compiled/run code]`

```rust
// Cargo.toml
crypto_box = { version = "=0.9.1", default-features = false, features = ["chacha20", "alloc", "rand_core"] }

// Keypair generation — requires a CryptoRngCore-bound RNG. This project's
// existing OsRng (re-exported from chacha20poly1305::aead::rand_core::OsRng,
// already imported in keys.rs) satisfies the bound — same rand_core 0.6 line.
use crypto_box::{ChaChaBox, PublicKey, SecretKey};
use chacha20poly1305::aead::{OsRng, Aead, AeadCore};

let sk = SecretKey::generate(&mut OsRng);      // -> SecretKey
let pk = sk.public_key();                       // -> PublicKey

// Byte access (both directions):
let pk_bytes: [u8; 32] = *pk.as_bytes();         // -> &[u8; 32], deref/copy for owned
let pk2 = PublicKey::from(pk_bytes);             // reconstruct from bytes -- VERIFIED roundtrips (Eq/PartialEq via constant-time compare)
let sk_bytes: [u8; 32] = sk.to_bytes();          // secret bytes, handle with care (see Zeroize Gap)
let sk2 = SecretKey::from_bytes(sk_bytes);       // reconstruct

// The box (ECDH + AEAD), constructed once per (recipient_pk, sender_or_ephemeral_sk) pair:
let sender_box = ChaChaBox::new(&recipient_pk, &ephemeral_sk);
let nonce = ChaChaBox::generate_nonce(&mut OsRng);   // VERIFIED: 24 bytes -- matches pv-core::keys::NONCE_LEN exactly
let ciphertext: Vec<u8> = sender_box.encrypt(&nonce, plaintext.as_ref())?;  // VERIFIED: overhead = 16 bytes (Poly1305 tag), ciphertext.len() == plaintext.len() + 16

let recipient_box = ChaChaBox::new(&ephemeral_pk, &recipient_sk);
let plaintext: Vec<u8> = recipient_box.decrypt(&nonce, ciphertext.as_slice())?;

// AAD is REJECTED (Correction 4) -- do not attempt this:
// sender_box.encrypt(&nonce, Payload { msg: plaintext, aad: b"anything" }) -> Err(aead::Error)
```

Key facts, all directly verified:
- `SecretKey` implements `Clone`, `Eq`/`PartialEq` (constant-time via `subtle::ConstantTimeEq` on the scalar — no timing side channel on comparison), `Debug` (via `finish_non_exhaustive()` — does **not** print raw bytes, safe to derive/leave as-is if the pv-core wrapper ever needs Debug).
- `PublicKey` implements `Clone, Debug, Eq, PartialEq, Hash` — safe to derive-print since it's public material.
- Nonce size: 24 bytes (`AeadCore::NonceSize = U24`) — identical to `pv-core::keys::NONCE_LEN`, so the existing `[u8; NONCE_LEN]` convention in `WrappedKey` extends cleanly to `SealedKey`.
- Ciphertext overhead: 16 bytes (Poly1305 tag) — same as `chacha20poly1305`'s own overhead, so a 32-byte Collection Key seals to a 48-byte ciphertext, matching STACK.md's estimate.
- `alloc` feature is real in 0.9.1 and gates exactly what's needed (`aead/alloc`, enabling the `Vec<u8>`-returning `encrypt`/`decrypt` convenience methods used above) — confirmed via the registry-normalized `Cargo.toml`. Nothing else needed is removed by leaving `default-features = false`.

## Zeroize Gap — Wrapper Type Design Implication

Because `crypto_box::SecretKey`'s own `Drop` leaves its raw `bytes` field unzeroized (Correction 5), **do not store a long-lived `crypto_box::SecretKey` directly as the field of pv-core's opaque identity-key wrapper type.** Instead, mirror `UserKey`'s existing pattern exactly:

```rust
// crates/pv-core/src/identity.rs (new module)
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct IdentitySecretKey([u8; KEY_LEN]);   // KEY_LEN == 32, same const as keys.rs

impl IdentitySecretKey {
    pub fn generate() -> Self {
        let sk = crypto_box::SecretKey::generate(&mut OsRng);
        Self(sk.to_bytes())   // sk (and its unzeroized `bytes` copy) drops here -- see caveat below
    }

    fn as_crypto_box(&self) -> crypto_box::SecretKey {
        crypto_box::SecretKey::from_bytes(self.0)   // reconstructed fresh for each seal/unseal call
    }

    pub fn public_key(&self) -> crypto_box::PublicKey {
        self.as_crypto_box().public_key()
    }
}
```

This gives `IdentitySecretKey` itself the same `Zeroize + ZeroizeOnDrop` guarantee every other key type in this codebase has, with a single accessor path (no `pub` byte field) — the project's hard invariant is satisfied for the type pv-core actually stores and passes around. The residual gap is narrower and must be stated plainly in the decision record: **every time `as_crypto_box()` reconstructs a transient `crypto_box::SecretKey` for a seal/unseal call, that transient's raw `bytes` copy is not guaranteed zeroized when it drops at the end of the call.** This is a genuine, small, unavoidable-given-the-crate's-current-API residual exposure (the memory is typically overwritten quickly by subsequent stack/heap reuse, and is not exposed to any other process), not a fabricated one — document it exactly as described here in the KEY-05 decision record rather than silently working around it or claiming it doesn't exist. It does not change the recommendation (the alternative, hand-rolling ECDH via `x25519-dalek`, has its own already-rejected problems — see CONTEXT.md), but it must be on the record.

## Sealed-Box Construction — Concrete Recommendation

CONTEXT.md's hand-written wrapper is correct; here is the exact construction with the nonce-strategy tradeoff made explicit, since it differs from what the crate's own (rejected) built-in `seal()` does:

```
seal(recipient_pk, plaintext) -> SealedKey { ephemeral_pk, nonce, ciphertext }:
    ephemeral_sk = crypto_box::SecretKey::generate(&mut OsRng)
    ephemeral_pk = ephemeral_sk.public_key()
    box          = ChaChaBox::new(&recipient_pk, &ephemeral_sk)
    nonce        = ChaChaBox::generate_nonce(&mut OsRng)     // random, NOT Blake2b-derived
    ciphertext   = box.encrypt(&nonce, plaintext)?
    // ephemeral_sk drops here -- Drop zeroizes its `scalar` field (Correction 5's residual bytes-copy caveat applies)
    SealedKey { ephemeral_pk: ephemeral_pk.to_bytes(), nonce: nonce.to_vec(), ciphertext }

unseal(my_secret_key: &IdentitySecretKey, sealed: &SealedKey) -> Result<Vec<u8>, CryptoError>:
    ephemeral_pk = PublicKey::from(sealed.ephemeral_pk)   // 32 bytes, from the blob
    box          = ChaChaBox::new(&ephemeral_pk, &my_secret_key.as_crypto_box())
    box.decrypt(Nonce::from_slice(&sealed.nonce), sealed.ciphertext.as_slice())
```

**Random nonce vs. libsodium's Blake2b-derived nonce — the tradeoff, stated explicitly (per the phase brief's explicit ask):**

libsodium's `crypto_box_seal` (and this crate's own `seal()` feature, Correction 3) derives the nonce deterministically as `Blake2b-24(ephemeral_pk ‖ recipient_pk)` instead of using a random nonce. The reason libsodium does this is to save the 24 bytes of nonce from the wire format (the nonce is recomputable by the recipient from the two public keys already present) — a bandwidth optimization, **not** a security requirement. Since:
1. A fresh ephemeral keypair is generated **per seal**, and
2. XChaCha20-Poly1305's 24-byte nonce space is large enough that random-nonce collision probability is cryptographically negligible even across a very large number of seals (this is the same reasoning `aead_seal` already relies on for every other AEAD operation in this codebase),

...using a random nonce (CONTEXT.md's chosen design, storing `{ephemeral_pk, nonce, ciphertext}` explicitly rather than deriving the nonce) is **cryptographically equivalent in security to the deterministic derivation** — the nonce's only job is uniqueness-per-key-pair-use, and a fresh-ephemeral-key-per-seal already guarantees a fresh symmetric key per seal regardless of nonce reuse concerns *across different seals*. The random-nonce approach is simpler to implement (no `blake2` dependency, no bespoke nonce-derivation function to test) and matches this codebase's existing `aead_seal` convention of "always draw a fresh random nonce, never derive one" — consistency with the rest of the crypto module is worth the extra 24 stored bytes at this project's scale (a Collection Key blob, not a hot-path high-volume value).

**On omitting the recipient's public key from the nonce (an explicit question in the phase brief):** libsodium's Blake2b nonce derivation includes `recipient_pk` specifically so that if the *same* ephemeral keypair were ever accidentally reused across two different recipients, the resulting nonces would still differ (defense in depth against ephemeral-key reuse bugs). Since this design already re-derives an entirely fresh ephemeral keypair per seal (never reused, immediately zeroized), that defense-in-depth property is redundant here — the random nonce already provides a fresh value independent of any reuse bug in the ephemeral key. No AAD or other binding to `recipient_pk` is needed at the `SealedKey` layer to compensate; nothing is being given up by omitting it. (Binding to `collection_id`/`recipient_user_id` for the purpose of detecting a server-side ciphertext-swap attack is a separate concern — addressed next.)

## AAD Binding — Where It Actually Lives

Since `ChaChaBox` rejects AAD (Correction 4), the Collection-Key `SealedKey` blob itself cannot be cryptographically bound to `(collection_id, recipient_user_id)` the way `build_item_aad` binds items to `(item_id, revision)`. This is a real, verified constraint — not a gap to silently paper over, but one that does not block this phase's success criteria, for a specific reason worth recording:

- **The scope-binding requirement this phase must actually satisfy (KEY-03, SC#3) lives one layer down, at the item-encryption layer** (`items.rs`'s `aead_seal`/`aead_open`, which *does* support AAD) — not at the `SealedKey`/Collection-Key-wrapping layer. SC#3's mandated cross-context rejection test is specifically about item ciphertext failing to decrypt under the wrong scope's key/AAD, which this phase delivers via the scope-aware AAD builder (`## Scope-Bound AAD — Concrete Design` below), completely independent of whether the `SealedKey` layer has its own AAD.
- **What a swapped `SealedKey` row actually achieves for an attacker, absent AAD:** if a malicious/compromised server swaps one member's `collection_key_recipients` row's `{ephemeral_pk, nonce, ciphertext}` for a different, same-shape blob (e.g. from a different collection), `unseal()` on the victim's device either (a) fails outright — most likely, since it's a different ephemeral keypair/ciphertext combination and `ChaChaBox` decryption already fails loudly on any bit mismatch (it's still a full AEAD, just without an *extra* AAD dimension) — or (b) in the vanishingly unlikely case it doesn't fail, produces 32 bytes of garbage that is not a valid Collection Key for anything real, which then fails to decrypt any actual item (since item ciphertext AAD is bound to the real `collection_id`, per KEY-03). **There is no plausible attack where AAD-less sealing at this one layer, combined with AAD-bound item encryption at the layer below it, results in silent acceptance of the wrong key for the wrong scope** — the actual security property KEY-03 cares about (an item cannot be silently reinterpreted after moving between scopes) is enforced at the item layer regardless.
- **Recommendation:** proceed without AAD on the `SealedKey`/ChaChaBox layer (there is no `crypto_box` API path to add it without abandoning `ChaChaBox` for a hand-rolled construction, which CONTEXT.md's own reasoning already rejects as "rolled crypto"). Document this explicitly in the KEY-05 decision record as a scoped, understood limitation, with the reasoning above, rather than letting a future reviewer discover the AAD-less seal call and assume it was an oversight.

## Scope-Bound AAD — Concrete Design

Direct implementation of CONTEXT.md's frozen personal-scope / new collection-scope split, extending `build_item_aad` in `crates/pv-core/src/items.rs`. `[VERIFIED: item_id/collection_id are always `Uuid::new_v4().to_string()` canonical hyphenated form — grepped every ID-generation call site in `crates/pv-server/src/routes/*.rs`, all use this exact pattern]`.

```rust
// EXISTING — untouched, byte-for-byte (SC#4 depends on this):
const AAD_ITEM_KEY_PREFIX: &[u8] = b"pv:item-key:v1";
const AAD_ITEM_DATA_PREFIX: &[u8] = b"pv:item:v1";

fn build_item_aad(prefix: &[u8], item_id: &str, revision: u32) -> Vec<u8> {
    let mut aad = prefix.to_vec();
    aad.extend_from_slice(item_id.as_bytes());
    aad.extend_from_slice(&revision.to_be_bytes());
    aad
}

// NEW — collection-scope siblings, own prefixes, own function (do not
// parameterize build_item_aad with an Option<&str> collection_id -- that
// would touch the existing function's signature/callers; keep it a
// completely separate function so the frozen path is provably untouched):
const AAD_COLL_ITEM_KEY_PREFIX: &[u8] = b"pv:coll-item-key:v1";
const AAD_COLL_ITEM_DATA_PREFIX: &[u8] = b"pv:coll-item:v1";

fn build_coll_item_aad(prefix: &[u8], collection_id: &str, item_id: &str, revision: u32) -> Vec<u8> {
    let mut aad = prefix.to_vec();
    // Length-unambiguous encoding -- see next section for why this matters
    // and which of the two options this codebase should use.
    aad.extend_from_slice(&(collection_id.len() as u32).to_be_bytes());
    aad.extend_from_slice(collection_id.as_bytes());
    aad.extend_from_slice(&(item_id.len() as u32).to_be_bytes());
    aad.extend_from_slice(item_id.as_bytes());
    aad.extend_from_slice(&revision.to_be_bytes());
    aad
}
```

## Length-Unambiguous AAD Encoding

CONTEXT.md offers two options: length-prefix, or assert-fixed-width-UUID-and-test-it. `[VERIFIED]` every `item_id`/`collection_id` in this codebase is generated via `Uuid::new_v4().to_string()` (grepped `crates/pv-server/src/routes/{auth,folders,extension_passkeys,passkeys,webauthn_state}.rs` — all five ID-generating call sites use this exact pattern), which always produces a fixed 36-ASCII-byte canonical hyphenated string (`8-4-4-4-12` hex digits). Both options are therefore *currently* safe.

**Recommendation: use the length-prefix encoding shown above (4-byte big-endian length prefix per variable-length field), not the fixed-width assertion.** Reasoning:
- It is strictly more robust — it stays correct even if a future ID format changes (e.g., a non-UUID collection slug, or UUIDs stored/passed in a different serialization), with zero code change to `build_coll_item_aad` itself.
- It costs 8 extra bytes of AAD per collection-scoped item (2 × 4-byte length prefixes) — negligible; AAD is not transmitted or stored anywhere separately, it is recomputed at encrypt/decrypt time from already-known IDs.
- It avoids adding a *third* invariant this crate must uphold forever (frozen personal AAD, frozen collection AAD shape, **and** "item_id/collection_id must always be exactly 36 bytes") — the length-prefix approach only needs the two AAD shapes to stay frozen, which is already the mandate.

If the planner instead prefers the fixed-width-assertion route (simpler code, matches today's implicit assumption more literally), it must add a debug-assertion or an explicit `CryptoError::InvalidInput` return when either ID's length isn't exactly 36 bytes, plus a unit test asserting that a crafted 35-byte-vs-1-byte split and a 36-byte-vs-0-byte-style ambiguity are both rejected by the length check before ever reaching AEAD. Either approach satisfies KEY-03; length-prefixing is simply the lower-maintenance default recommended here.

**Test to prove correctness (required, in addition to the cross-context rejection test)**: assert that `build_coll_item_aad(prefix, "ab", "c", 0) != build_coll_item_aad(prefix, "a", "bc", 0)` — the exact ambiguity CONTEXT.md names. With the length-prefix encoding this is automatically true; write the test as a permanent regression guard regardless.

## Identity Keypair Wrap Constant

New domain-separation constant, following the existing `INFO_*` convention in `keys.rs` exactly:

```rust
pub const INFO_X25519_SK_WRAP: &[u8] = b"pv:x25519-sk-wrap:v1";
```

Wrap/unwrap reuse the existing `pub(crate) aead_seal`/`aead_open` verbatim — no new symmetric crypto:

```rust
pub fn wrap_identity_secret_key(
    uk: &UserKey,
    isk: &IdentitySecretKey,
) -> Result<WrappedKey, CryptoError> {
    aead_seal(uk.expose(), &isk.0, INFO_X25519_SK_WRAP)
}

pub fn unwrap_identity_secret_key(
    uk: &UserKey,
    blob: &WrappedKey,
) -> Result<IdentitySecretKey, CryptoError> {
    let mut plain = aead_open(uk.expose(), blob, INFO_X25519_SK_WRAP)?;
    // same length-check + zeroize-on-mismatch pattern as unwrap_user_key
    ...
}
```

Note this uses `INFO_X25519_SK_WRAP` as the **AAD**, not as an HKDF `info` string (unlike `INFO_PW_UNLOCK`/`INFO_PRF_UNLOCK`, which are HKDF info strings) — this mirrors `wrap_user_key`'s own existing pattern exactly (`aead_seal(wrapping_key, uk.expose(), b"pv:uk:v1")`, where the constant is passed as AAD to `aead_seal`, not through HKDF). Keep this consistent: the `INFO_*` naming convention is shared across both uses (HKDF info vs. AEAD AAD) in the existing codebase, so reusing the same constant style for a new AEAD-AAD use is idiomatic, not a naming mismatch.

## Pre-v0.4 Fixture Strategy

`[VERIFIED: no `tests/fixtures/` directory precedent exists anywhere in the Rust crates today]` — grepped for `fixture`/`fixtures` across `crates/`; the only fixture pattern in this codebase is `pv-provider`'s inline `fixture_create_request()`/`fixture_get_request()` functions (generated fresh at test time, not committed data). This phase introduces a genuinely new pattern; here is the concrete, minimal mechanism, sized to actually prove "no re-encryption" per SC#4:

**Directory layout:**
```
crates/pv-core/tests/
├── fixtures/
│   └── pre_v0_4_item.json      # committed EncryptedItem JSON, generated ONCE from pre-change code
└── backward_compat.rs           # new integration test file (mirrors pv-provider/tests/response_shape.rs's
                                  # placement precedent: cross-cutting regression proof lives in tests/,
                                  # not inside src/items.rs's #[cfg(test)] mod tests)
```

**Generation procedure (must happen BEFORE any AAD/module code in this phase changes anything in `items.rs`/`keys.rs`):**

1. As the very first action of this phase (even before the KEY-05 decision record commit, or in the same initial commit — before touching `items.rs`), write a throwaway `#[test]` (or a `cargo run --example generate_fixture` if the plan prefers a real binary) that:
   - Uses a **fixed, hardcoded** 32-byte `UserKey` (e.g., `UserKey::from_bytes([0x42; 32])` or any fixed pattern — explicitly a test fixture, never treated as a real secret) so the fixture is reproducible and inspectable in a code review, not tied to ephemeral randomness.
   - Uses fixed `item_id = "fixture-item-pre-v0.4"` and `revision = 1`, and a fixed plaintext JSON payload.
   - Calls the **current, unmodified** `encrypt_item(&uk, plaintext, item_id, revision)`.
   - Serializes the resulting `EncryptedItem` to JSON and writes it to `crates/pv-core/tests/fixtures/pre_v0_4_item.json` via `std::fs::write` (legitimate: this is test-harness code with real I/O, not the `pv-core` library itself, which stays I/O-free).
2. Run it once, inspect the output, commit `pre_v0_4_item.json` **in its own commit**, before any subsequent commit touches `items.rs`'s AAD scheme.
3. Delete or `#[ignore]` the throwaway generator so it isn't accidentally re-run and doesn't silently regenerate/overwrite the fixture on a future `cargo test` (a generator that re-runs on every test invocation defeats the entire "prove against the OLD code path" purpose — this must be a one-shot, deliberately-run action, not part of the regular test suite).
4. Write the permanent test in `backward_compat.rs`:
   ```rust
   #[test]
   fn pre_v0_4_item_decrypts_unchanged() {
       let uk = UserKey::from_bytes([0x42; 32]);   // same fixed bytes as the generator used
       let json = include_str!("fixtures/pre_v0_4_item.json");
       let item: EncryptedItem = serde_json::from_str(json).unwrap();
       let plaintext = decrypt_item(&uk, &item, "fixture-item-pre-v0.4", 1).unwrap();
       assert_eq!(plaintext, /* the same fixed plaintext bytes the generator used, also hardcoded here */);
   }
   ```

**Why this genuinely proves SC#4 rather than being circular:** since `decrypt_item`'s personal-scope path (the AAD prefixes, `build_item_aad`, `aead_seal`/`aead_open`) is explicitly frozen by this phase's own locked decisions, this test is *expected* to pass trivially even without any of Phase 21's changes. Its actual value is as a **committed regression tripwire**: it fails loudly, by name, the moment any future change (in this phase or a later one) accidentally perturbs `AAD_ITEM_KEY_PREFIX`, `AAD_ITEM_DATA_PREFIX`, or `build_item_aad`'s byte layout — the exact "every shipped vault breaks" failure mode CONTEXT.md calls out as the hard constraint. A same-run round trip (encrypt-then-decrypt in one test) cannot catch this class of regression, because it would always use whatever the *current* code produces on both sides — which is precisely why CONTEXT.md mandates committed fixture data instead.

## pv-wasm Exposure

Follows the exact `WasmWrappingKey`/`WasmUserKey` opaque-handle precedent in `crates/pv-wasm/src/lib.rs` — verified against that file's actual pattern (private inner field, no raw-byte-returning method except the sanctioned D-02 `chrome.storage.session` exception, which does **not** extend to the new identity/Collection Key types per CONTEXT.md's explicit "do not grow the sanctioned-exception surface" instruction from the milestone ARCHITECTURE.md).

```rust
#[wasm_bindgen]
pub struct WasmIdentityKey(IdentitySecretKey);

#[wasm_bindgen]
impl WasmIdentityKey {
    #[wasm_bindgen(js_name = generate)]
    pub fn generate() -> WasmIdentityKey {
        WasmIdentityKey(IdentitySecretKey::generate())
    }

    // Public key IS safe to return as raw bytes -- it's public by construction,
    // same reasoning as randomSalt/exportUserKeyForSession's D-02 note, except
    // this one needs no "sanctioned exception" comment since it's not secret.
    #[wasm_bindgen(js_name = publicKeyBytes)]
    pub fn public_key_bytes(&self) -> Vec<u8> {
        self.0.public_key().to_bytes().to_vec()
    }
    // No method returns the private scalar/bytes.
}

#[wasm_bindgen(js_name = wrapIdentitySecretKey)]
pub fn wrap_identity_secret_key(uk: &WasmUserKey, isk: &WasmIdentityKey) -> Result<String, JsValue> { ... }

#[wasm_bindgen(js_name = unwrapIdentitySecretKey)]
pub fn unwrap_identity_secret_key(uk: &WasmUserKey, wrapped_json: &str) -> Result<WasmIdentityKey, JsValue> { ... }

#[wasm_bindgen(js_name = sealCollectionKey)]
pub fn seal_collection_key(recipient_pubkey_bytes: &[u8], collection_key_bytes: &[u8]) -> Result<String, JsValue> {
    // returns SealedKey JSON. NOTE: collection_key_bytes as a raw &[u8] parameter
    // is a deliberate, narrow exception mirroring how WrappedKey/EncryptedItem
    // already cross the boundary as JSON-serialized blobs, not as opaque
    // handles -- but a freshly-*generated* Collection Key should be minted via
    // an opaque WasmCollectionKey handle (mirroring WasmUserKey) wherever it's
    // generated client-side, with raw bytes only extracted at the point of
    // sealing/unsealing, exactly as WasmUserKey's bytes only ever flow into
    // wrap_user_key/encrypt_item, never returned raw. Full WasmCollectionKey
    // type + encryptItemForCollection/decryptItemForCollection bindings
    // (mirroring encryptItem/decryptItem but keyed by Collection Key instead
    // of UserKey) are this phase's job per CONTEXT.md's "pv-wasm opaque-handle
    // exposure... downstream phases consume a finished bridge" scope line --
    // size this as its own task, following encrypt_item/decrypt_item's
    // existing two-function shape.
    ...
}

#[wasm_bindgen(js_name = unsealCollectionKey)]
pub fn unseal_collection_key(my_identity_key: &WasmIdentityKey, sealed_json: &str) -> Result<Vec<u8>, JsValue> { ... }
```

**`build-wasm.sh` impact: none required.** The script's version-pinning (wasm-bindgen), asset-splitting (Turbopack-safe `.wasm` placement), and getrandom-duplicate-majors audit are all mechanism-level and apply unchanged regardless of which `pv-core` functions are exposed — confirmed by the real `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` run in this research passing cleanly with `crypto_box` present, using the exact same target/profile the script invokes.

**WASM-specific misbehavior check:** none found. `crypto_box`'s only OS-level dependency is the caller-supplied RNG (already satisfied by this project's existing `OsRng` wiring for `wasm32-unknown-unknown` via `getrandom = "0.2", features = ["js"]` in `pv-wasm/Cargo.toml`, unchanged by this phase) — confirmed by the real WASM build succeeding.

## KEY-05 Decision Record — Ready-to-Write Content

SC#1 requires this record exist, be written **before** any dependent code, and land per the existing convention: a row in `.planning/PROJECT.md`'s Key Decisions table (matching the XBR-03 precedent format: `Decision | Rationale | Outcome`) plus a fuller narrative addition to `docs/ARCHITECTURE.md` §4 (which already has a "Hierarchia kluczy" diagram this phase extends with an asymmetric branch).

**Minimum content the record must state** (all now backed by this research's direct verification, not just cited from the milestone research):
1. Chosen: `crypto_box =0.9.1`, features `["chacha20", "alloc", "rand_core"]` (note: differs from the milestone research's draft feature list — `rand_core` is required, verified by a failed-then-fixed compile).
2. Rejected `hpke` 0.14.0 and `rsa` 0.9.10, with the STACK.md §1 reasoning (too-new/forces pin bumps; open unpatched advisory + already-rejected Bitwarden pattern).
3. Rejected hand-rolled X25519-ECDH (`x25519-dalek`), with the `rand_core ^0.10` graph-break reasoning.
4. **Found-and-rejected: the crate's own built-in `seal`/`unseal` (Correction 3)** — hardcodes SalsaBox not ChaChaBox, breaking cipher consistency; not used.
5. **Dependency-graph claim independently re-verified** (Correction 2) — cite the specific `cargo tree` commands run and their single-version results, both native and `wasm32-unknown-unknown`.
6. **AAD limitation stated plainly** (Correction 4) — `ChaChaBox` has no AAD; scope-binding is enforced one layer down at the item AEAD, with the reasoning from `## AAD Binding — Where It Actually Lives`.
7. **Zeroize gap stated plainly** (Correction 5) — `crypto_box::SecretKey` does not implement `Zeroize`; the opaque wrapper type stores its own byte array instead (per `## Zeroize Gap`), with the residual transient-reconstruction caveat documented, not hidden.

## Package Legitimacy Audit

`[VERIFIED: crates.io API, live query with proper User-Agent]`

| Package | Registry | Age | Downloads (all-time) | Source Repo | Verdict | Disposition |
|---------|----------|-----|----------------------|--------------|---------|-------------|
| `crypto_box` `=0.9.1` | crates.io | Crate created 2020-02-25 (~5.4 yrs); this version line last published 2025-10-05 | 8,207,397 | `github.com/RustCrypto/nacl-compat` (matches; RustCrypto org, same publisher as this project's other pinned crypto crates) | OK | Approved — install as specified in `## Verified Corrections — Correction 1` |

No other new external packages are introduced by this phase (per CONTEXT.md: "Do not add `chacha20` as a direct `pv-core` dependency — let `crypto_box` own that edge" — confirmed above, `chacha20 0.9.1` and `crypto_secretbox 0.1.1` both arrive transitively via `crypto_box`, never as direct `pv-core` dependencies, and `cargo tree` shows each resolves to exactly one version).

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

Note on provenance: `crypto_box` was originally identified by the milestone-level STACK.md research (via crates.io dependency-graph queries and a web-searched audit claim), not independently re-discovered by this phase's research — so per this agent's provenance rule, the *package name itself* traces to `[ASSUMED]`-tier discovery even though this session independently re-verified its existence, age, downloads, source repository, and exact API surface via direct registry/source access (`[VERIFIED]`-tier for all the *behavioral* claims in this document). The distinction: "crypto_box is a real, appropriately-aged, high-download, RustCrypto-org-hosted crate" is `[VERIFIED]` in this session; "crypto_box is the right crate to search for in the first place" traces back to STACK.md's `[ASSUMED]`-provenance discovery. Both check out under scrutiny — recorded for completeness per the provenance protocol, not because either checkable claim actually failed.

## Common Pitfalls

### Pitfall 1: Missing the `rand_core` feature
**What goes wrong:** `SecretKey::generate` is unavailable at compile time, discovered only when the identity-keypair-generation task is actually implemented (not at `cargo add` time, since `cargo add`/`cargo tree` don't fail on missing-feature-for-a-specific-function — only actually calling the function does).
**Why it happens:** CONTEXT.md's feature list (`["chacha20", "alloc"]`) was written from the milestone research's Cargo.toml sketch, which didn't include a compile check.
**How to avoid:** Use the corrected feature list from `## Verified Corrections — Correction 1` in the very first `Cargo.toml` edit task.
**Warning signs:** `error[E0599]: no associated function or constant named 'generate' found for struct 'SecretKey'`.

### Pitfall 2: Reaching for `Payload { msg, aad }` on `ChaChaBox`
**What goes wrong:** A future contributor, familiar with `chacha20poly1305`'s `Payload` pattern (used throughout `keys.rs`'s own `aead_seal`), instinctively tries the same pattern on `ChaChaBox`, expecting AAD support that isn't there.
**Why it happens:** `crypto_box` re-exports `aead::Payload` and it type-checks fine at the call site — the failure is a **runtime** `Err(aead::Error)`, not a compile error, so it's easy to miss in a code review that doesn't run the test.
**How to avoid:** A code comment at the `seal`/`unseal` call site stating plainly "ChaChaBox rejects non-empty AAD (verified against crypto_box 0.9.1 source) — do not add an `aad` parameter here; scope binding happens at the item AEAD layer, see `items.rs`." Also add a unit test that asserts a non-empty-AAD call errors, as a permanent doc-by-test.
**Warning signs:** Any PR adding an `aad`/`associated_data` parameter to the seal/unseal wrapper functions.

### Pitfall 3: Storing `crypto_box::SecretKey` as the wrapper's field
**What goes wrong:** `#[derive(Zeroize, ZeroizeOnDrop)] struct IdentitySecretKey(crypto_box::SecretKey);` — this **will not compile** (crypto_box::SecretKey doesn't implement `Zeroize`, Correction 5), so this specific mistake is at least compiler-caught, not silent. The subtler version: a hand-written `Drop` on the wrapper that assumes `crypto_box::SecretKey`'s own `Drop` already handles zeroization completely (it doesn't — only the `scalar` field, not `bytes`).
**Prevention:** Store the raw `[u8; 32]` directly in the wrapper (per `## Zeroize Gap`), reconstruct `crypto_box::SecretKey` transiently per call.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `crypto_box` (the package name/choice itself) is the right crate for this problem | Package Legitimacy Audit | Low — independently re-verified in this session on every behavioral axis (existence, age, downloads, source repo, exact API); only the *initial discovery* traces to prior research, not this session's own web search |

No other claims in this document are tagged `[ASSUMED]` — every other technical claim was verified via direct source read, real compilation, or a live registry query in this session (see `## Verification Methodology`).

## Open Questions

None blocking. The two open questions named explicitly in the phase brief (crypto_box API details, AAD-on-sealed-box) are both resolved definitively above (`## crypto_box 0.9.1 Concrete API`, `## AAD Binding — Where It Actually Lives`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust stable toolchain + `wasm32-unknown-unknown` target | All of pv-core/pv-wasm work | ✓ | confirmed via `rustup target list --installed` | — |
| `crypto_box` on crates.io | KEY-05 | ✓ | 0.9.1 (downloaded and compiled in this session) | — |
| Local `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` | pv-wasm exposure verification | ✓ | ran clean in this session | — |

No missing dependencies; no fallback needed.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (native), workspace-standard — no new framework needed |
| Config file | none — plain `#[cfg(test)] mod tests` (unit) + new `crates/pv-core/tests/*.rs` (integration), matching `pv-provider/tests/response_shape.rs`'s existing precedent |
| Quick run command | `cargo test -p pv-core` |
| Full suite command | `cargo test --workspace` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| KEY-01 | Identity keypair generate/wrap/unwrap roundtrip; wrong UK fails to unwrap | unit | `cargo test -p pv-core identity:: -- --exact` (module name per plan) | ❌ Wave 0 — new `identity.rs` module |
| KEY-02 | Seal/unseal roundtrip to identical bytes across two independently-generated keypairs | unit | `cargo test -p pv-core identity::tests::seal_unseal_roundtrip` | ❌ Wave 0 |
| KEY-02 | Non-empty AAD on ChaChaBox is rejected (documents Correction 4 as a permanent regression guard) | unit | `cargo test -p pv-core identity::tests::chachabox_rejects_aad` | ❌ Wave 0 |
| KEY-03 | Cross-context rejection: personal blob fails under collection AAD and vice versa; collection A fails under collection B; existing item_id/revision mismatch cases still pass | unit | `cargo test -p pv-core items::tests::aad_mutation_rejected` (extended) | ✅ exists, needs extension |
| KEY-03 | Length-unambiguous encoding: `("ab","c") != ("a","bc")` AAD collision proof | unit | `cargo test -p pv-core items::tests::coll_aad_length_unambiguous` | ❌ Wave 0 |
| KEY-01/SC#4 | Pre-v0.4 fixture decrypts unchanged under current (personal-scope) code | integration | `cargo test -p pv-core --test backward_compat` | ❌ Wave 0 — new `tests/backward_compat.rs` + committed fixture |
| KEY-05/SC#1 | Decision record exists and predates dependent code (process check, not a runtime test) | manual/process | `git log --oneline -- .planning/PROJECT.md docs/ARCHITECTURE.md` timestamp precedes crypto module commits | n/a |
| pv-wasm exposure | WASM opaque-handle roundtrip (generate → wrap → unwrap → seal → unseal) | unit (native `cargo test`, not requiring an actual browser) | `cargo test -p pv-wasm` | ❌ Wave 0 — new tests mirroring `full_roundtrip`/`from_prf_roundtrip` in `pv-wasm/src/lib.rs` |

### Sampling Rate

- **Per task commit:** `cargo test -p pv-core` (fast, no I/O, no WASM build needed for pure-crypto tasks)
- **Per wave merge:** `cargo test --workspace` + `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` (the real WASM build, matching this research's own verification step — must stay green with the new crate present)
- **Phase gate:** Full suite green + `scripts/check-supply-chain.sh` (picks up the new `deny.toml` watch-list row) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `crates/pv-core/src/identity.rs` — new module: `IdentitySecretKey`, seal/unseal, generate
- [ ] `crates/pv-core/tests/fixtures/pre_v0_4_item.json` — committed fixture (generated per `## Pre-v0.4 Fixture Strategy`, its own commit, before any AAD code changes)
- [ ] `crates/pv-core/tests/backward_compat.rs` — new integration test file
- [ ] Extension to `crates/pv-core/src/items.rs`'s existing `#[cfg(test)] mod tests` for the new collection-scope AAD tests
- [ ] New tests in `crates/pv-wasm/src/lib.rs`'s existing `#[cfg(test)] mod tests` for the new WASM bindings
- Framework install: none — `cargo test` already fully wired at workspace level, no new dependency needed for testing itself

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Out of scope — this phase has no login/session surface |
| V3 Session Management | no | Out of scope |
| V4 Access Control | no | Out of scope — membership authorization is Phase 22 |
| V5 Input Validation | yes | Length-checked key/blob deserialization (mirrors existing `unwrap_user_key`'s length check); reject malformed `SealedKey` JSON before AEAD operations, same pattern as `aead_open`'s existing `blob.nonce.len() != NONCE_LEN` check |
| V6 Cryptography | yes | `crypto_box` (Cure53-audited, RustCrypto org) — never hand-rolled; all key material `Zeroize`/`ZeroizeOnDrop`; domain-separated AAD/HKDF constants per existing convention; nonces always fresh-random via `OsRng`, never derived/reused |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Key-substitution / MITM via server-supplied public keys (a shared-secret-establishment concern once identity pubkeys exist) | Spoofing | **Out of scope for THIS phase** (no server persistence/fetch of pubkeys yet — Phase 22/26 own the fetch path and SEC-05's fingerprint UI); flagged here so the planner does not attempt to "fix" it prematurely with no server code to anchor the mitigation in |
| Cross-scope ciphertext replay (personal blob presented as collection blob or vice versa) | Tampering | KEY-03's scope-bound AAD (`## Scope-Bound AAD — Concrete Design`) — this phase's actual deliverable |
| Nonce reuse across seals | Tampering / Information Disclosure | Fresh `OsRng`-drawn nonce per `aead_seal`/`ChaChaBox::generate_nonce` call, never a constructed-once-reused cipher/nonce pair — same discipline as existing `aead_seal` |
| Key material lingering in memory after use | Information Disclosure | `Zeroize + ZeroizeOnDrop` on all pv-core key types, including the new `IdentitySecretKey`; the one documented residual gap (Correction 5's transient `crypto_box::SecretKey` reconstruction) is disclosed, not hidden, in the KEY-05 decision record |
| Rolled/hand-composed cryptography | Tampering (weakened primitive) | `crypto_box` (audited) used for the ECDH+AEAD composition; the only hand-written composition is the ephemeral-keypair-per-seal wrapper, which mirrors a well-known, audited construction (libsodium's `crypto_box_seal`) closely enough to be low-risk, and is now cross-checked against the crate's own built-in (rejected-for-cipher-mismatch) implementation of the same idea (Correction 3) |

## Sources

### Primary (HIGH confidence — direct source/registry verification in this session)
- `static.crates.io/crates/crypto_box/crypto_box-0.9.1.crate` — downloaded and read: `Cargo.toml` (normalized), `src/lib.rs`, `src/public_key.rs`, `src/secret_key.rs`
- `crates.io` API (`https://crates.io/api/v1/crates/crypto_box`, live query) — age, downloads, repository, max stable version
- This repository, direct read: `crates/pv-core/src/{keys.rs,items.rs,lib.rs}`, `crates/pv-core/Cargo.toml`, `Cargo.toml` (workspace), `deny.toml`, `crates/pv-wasm/src/lib.rs`, `crates/pv-wasm/Cargo.toml`, `scripts/build-wasm.sh`, `crates/pv-provider/tests/response_shape.rs`, `crates/pv-server/src/routes/{auth,folders,extension_passkeys,passkeys,webauthn_state}.rs` (UUID generation grep), `docs/ARCHITECTURE.md` §4, `.planning/PROJECT.md` Key Decisions table
- Real compiled/run code in this session: `cargo tree`, `cargo check`, `cargo build --target wasm32-unknown-unknown --release` against both the real workspace (temporarily modified, then reverted — confirmed clean via `git status`) and an isolated scratch Cargo project

### Secondary (MEDIUM confidence — prior milestone research, re-verified where load-bearing)
- `.planning/research/v0.4/STACK.md` §1 (crypto_box/hpke/rsa comparison — decision not re-litigated, only the dependency-graph and API claims were re-verified)
- `.planning/research/v0.4/ARCHITECTURE.md` (key hierarchy diagram, integration points — two claims corrected, see `## Verified Corrections`)
- `.planning/research/v0.4/PITFALLS.md` (Pitfall 1, 2, 4 — directly informed this document's AAD/domain-separation design)

### Tertiary (LOW confidence)
- None used unverified in this document — every claim carries either `[VERIFIED: ...]` or is explicitly logged in `## Assumptions Log`.

## Metadata

**Confidence breakdown:**
- Standard stack (crypto_box version/features/API): HIGH — directly compiled and run against the real crate source and this workspace's real lockfile
- Architecture (sealed-box construction, AAD design, fixture strategy): HIGH — grounded in direct reads of `items.rs`/`keys.rs`/`lib.rs` and the crate's actual behavior, not speculative
- Pitfalls: HIGH for the two verified corrections (feature flags, Zeroize gap); MEDIUM for the broader pitfall list (inherited from milestone PITFALLS.md, itself HIGH-confidence per its own sourcing)

**Research date:** 2026-07-30
**Valid until:** Re-verify if `crypto_box`'s pin ever moves off `=0.9.1`, or if the underlying `rand_core`/`aead`/`chacha20` chain that `chacha20poly1305 =0.10.1` resolves changes (e.g. a future `chacha20poly1305` version bump) — otherwise stable indefinitely, since this is a one-time architectural decision, not a fast-moving ecosystem area.
