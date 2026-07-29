---
phase: 21-crypto-foundation-asymmetric-identity-collection-keys
reviewed: 2026-07-29T23:50:06Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - crates/pv-core/Cargo.toml
  - crates/pv-core/src/identity.rs
  - crates/pv-core/src/items.rs
  - crates/pv-core/src/lib.rs
  - crates/pv-core/tests/backward_compat.rs
  - crates/pv-core/tests/fixtures/pre_v0_4_item.json
  - crates/pv-wasm/src/lib.rs
  - docs/ARCHITECTURE.md
findings:
  critical: 2
  warning: 7
  info: 6
  total: 15
status: issues_found
---

# Phase 21: Code Review Report

**Reviewed:** 2026-07-29T23:50:06Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

The phase adds an X25519 asymmetric sharing layer (`identity.rs`), collection-scoped
item AEAD (`items.rs`), and WASM bindings for both. `cargo test -p pv-core` is green
(40 tests) and `cargo clippy -p pv-core -p pv-wasm --all-targets` is clean, so there
are no mechanical defects. The defects are in the crypto contract itself.

**What I verified as sound (and how):**

- **Frozen personal-scope AAD is genuinely intact.** `git diff fe80d95..HEAD --
  crates/pv-core/src/items.rs` shows zero modifications to `build_item_aad`,
  `AAD_ITEM_KEY_PREFIX`, or `AAD_ITEM_DATA_PREFIX`; the layout is exactly
  `prefix ‖ item_id.as_bytes() ‖ revision.to_be_bytes()`, revision `0` for key-wrap and
  the real revision for data. The fixture is genuinely load-bearing: commit `8c24514`
  (fixture) predates `caa90c4` (first AAD-touching commit), and
  `pre_v0_4_item_decrypts_unchanged` passes. Length arithmetic checks out
  (`enc_key.ciphertext` = 48 = 32 + 16 tag; `enc_data.ciphertext` = 98 = 82 + 16).
- **AAD length-unambiguity holds** for all realistic inputs. `build_coll_item_aad`'s
  4-byte big-endian prefixes make `("ab","c")` vs `("a","bc")` distinct, and empty ids,
  multi-byte UTF-8 (`.len()` is byte length, matching `.as_bytes()`), and `u32::MAX`
  revision are all handled. I also hand-checked pairwise prefix distinguishability:
  `"pv:item-key:v1"` vs `"pv:item:v1"` diverge at index 7; `"pv:coll-item-key:v1"` vs
  `"pv:coll-item:v1"` diverge at index 12 — no cross-prefix collision is constructible.
- **Nonce and ephemeral discipline are correct.** Every `seal` generates a fresh
  ephemeral `SecretKey` as a function-local and a fresh random 24-byte nonce; the
  ephemeral secret is never a struct field, never returned, never cached. Since the box
  key is unique per seal, nonce reuse is doubly impossible.
- **No secret bytes cross the WASM boundary** beyond the sanctioned
  `publicKeyBytes`/`randomSalt`/`exportUserKeyForSession` set. Every new
  `#[wasm_bindgen]` signature was audited: `WasmIdentityKey` and `WasmCollectionKey`
  expose no raw-byte getter, and `unsealCollectionKey` rejects wrong lengths rather than
  truncating.
- **`ChaChaBox` really does reject non-empty AAD** — confirmed in
  `crypto_secretbox-0.1.1/src/lib.rs:272-273,316-317`
  (`if !associated_data.is_empty() { return Err(Error) }`). The regression test is a
  valid guard, and the decision to put scope binding at the item-AEAD layer is sound.
- **No swallowed crypto errors.** No `unwrap`/`expect` outside `#[cfg(test)]` in the new
  code; the two `let _ =` uses are the deliberate native-target `JsValue` stubs, not
  discarded `Result`s. Decrypt failures uniformly return `CryptoError::Decrypt` with no
  distinguishing information.

**Key concern:** the asymmetric layer performs **no validation on recipient public
keys**, and I have a working proof of concept showing that a degenerate recipient key
makes the sealed Collection Key recoverable by anyone (CR-01). Separately, the WASM
binding that is supposed to expose sharing cannot express it — it demands the
recipient's *secret* key (CR-02). Both need to land before downstream plans build on
this foundation.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: `seal()` accepts small-order / all-zero X25519 recipient public keys — sealed Collection Key is recoverable by anyone

**File:** `crates/pv-core/src/identity.rs:153-183` (entry points: `:73-75`
`IdentityPublicKey::from_bytes`, `:69` derived `Deserialize`)

**Issue:** `seal()` hands `recipient_pk` straight to `crypto_box::ChaChaBox::new`, which
(verified in `crypto_box-0.9.1/src/lib.rs:240-247`) computes
`secret_key.scalar * public_key.0` with **no contributory / small-order check** —
upstream even leaves a `// TODO(tarcieri): validate key` in `public_key.rs`'s
deserializer. `crypto_box::SecretKey::from_bytes` applies `clamp_integer`, so every
scalar is a multiple of 8; multiplying any point whose order divides 8 (including the
all-zero identity encoding and `u = 1`) therefore yields an **all-zero shared secret**.
`ChaChaBox::new` then derives the box key as `HChaCha20(zeros, zeros)` — a fixed,
publicly computable constant.

Nothing in pv-core rejects such a key: `IdentityPublicKey::from_bytes` is `pub` with no
validation, and `IdentityPublicKey` derives `Deserialize`, so
`serde_json::from_str::<IdentityPublicKey>(server_supplied_json)` → `seal(...)` is a
fully public, unvalidated path today.

**Failure scenario (verified with a working PoC against the real crate):** Alice wants
to share collection `C` with Bob. The server (or anyone who can influence the member
directory) publishes `[0u8; 32]` as "Bob's identity public key". Alice's client calls
`seal(&bob_pk, collection_key)`. The attacker then reconstructs
`ChaChaBox::new(&PublicKey::from([0u8;32]), &any_secret_key)` — it does not even need
the `ephemeral_pk` from the blob — and decrypts:

```
[all-zero (identity point)] ATTACKER RECOVERED PLAINTEXT: [ab, ab, ab, ab, ab, ab, ab, ab] (match=true)
[u = 1 (order-4 point)]     ATTACKER RECOVERED PLAINTEXT: [ab, ab, ab, ab, ab, ab, ab, ab] (match=true)
```

The Collection Key is disclosed in plaintext, which yields every item in the shared
collection. The zero-knowledge guarantee is broken, and the collection-scoped item AAD
(KEY-03) provides no defense here — the attacker holds the *real* Collection Key and the
*real* `collection_id`, so item decryption succeeds normally.

Note this is not currently reachable *through the WASM boundary* only because
`sealCollectionKey` has the unrelated defect in CR-02. It is reachable from any Rust
caller now, and becomes directly reachable from JS the moment CR-02 is fixed — which is
precisely why validation must land in this phase, while the primitive is being frozen.

**Fix:** reject non-contributory public keys at the point of construction, so no caller
can bypass it.

```rust
/// The 8 small-order Curve25519 u-coordinates (libsodium's blocklist) plus their
/// non-canonical `u + p` aliases. Any of these produces an all-zero X25519 shared
/// secret under a clamped scalar, i.e. a publicly derivable box key.
const SMALL_ORDER_POINTS: [[u8; KEY_LEN]; 7] = [ /* 0x00.., 0x01.., 0xe0eb.., 0x5f9c.., 0xecff.., 0xedff.., 0xeeff.. */ ];

impl IdentityPublicKey {
    /// Fallible now: a recipient public key always arrives from an untrusted
    /// source (the server), so it must be validated, not just typed.
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Result<Self, CryptoError> {
        let mut canonical = bytes;
        canonical[31] &= 0x7f; // bit 255 is ignored by field decode — see WR-04
        if SMALL_ORDER_POINTS.contains(&canonical) {
            return Err(CryptoError::InvalidInput("small-order X25519 public key"));
        }
        Ok(Self(canonical))
    }
}
```

Add a matching guard inside `seal()` (defense in depth, since `SealedKey`/`Deserialize`
can construct the type) and a `Deserialize` impl that routes through the validating
constructor rather than deriving it. Cover with a test that asserts
`seal(&IdentityPublicKey::from_bytes([0u8; 32]).unwrap_err(), ..)` is unreachable and
that each blocklisted encoding is rejected.

---

### CR-02: `sealCollectionKey` requires the recipient's SECRET key — the sharing flow it exists for cannot be expressed

**File:** `crates/pv-wasm/src/lib.rs:271-278`

**Issue:** The binding's first parameter is `recipient: &WasmIdentityKey`, and
`WasmIdentityKey` wraps `pv_core::identity::IdentitySecretKey` (`:214-215`) — the
*private* half. The body then derives the public key from it:

```rust
pub fn seal_collection_key(recipient: &WasmIdentityKey, ck: &WasmCollectionKey) -> Result<String, JsValue> {
    let sealed = pv_core::identity::seal(&recipient.0.public_key(), &ck.0)...
```

So to seal a Collection Key for Bob, Alice must already hold Bob's `IdentitySecretKey`
— which is exactly the thing that never leaves Bob's client. There is no
`WasmIdentityPublicKey` type and no binding anywhere in the file that accepts recipient
public-key *bytes*, so `WasmIdentityKey::publicKeyBytes()` (`:224-227`) produces a value
that nothing in the API can consume. `identity.rs:5-7` states the public half exists so
"other recipients can seal shared Collection Keys under this key" — the boundary as
shipped makes that impossible.

**Failure scenario:** a downstream implementer wiring the sharing UI has two options,
both bad. (a) Pass Alice's own identity key, since it type-checks — she produces a
`SealedKey` only *she* can open, the invite silently "succeeds", and Bob gets a blob he
can never unseal. (b) Add a `WasmIdentityKey` constructor from raw bytes / an
`exportIdentitySecretKey` so Bob's key can be shipped to Alice — which breaks the
zero-knowledge boundary this file's own header (`:1-19`) exists to protect. Neither
failure surfaces at compile time.

The test suite cannot catch this because it cannot express the cross-party case either:
both `seal_unseal_collection_key_roundtrip` (`:888-914`) and `unseal_wrong_recipient_fails`
(`:876-886`) seal to an identity whose secret key the test holds. There is zero coverage
of the actual sharing path at the boundary.

**Fix:** introduce a public-key-only handle and make it the seal entry point, so the
secret key is not in the signature at all.

```rust
/// Recipient's X25519 public half — public by construction, so raw bytes may
/// cross the boundary in BOTH directions (unlike WasmIdentityKey).
#[wasm_bindgen]
pub struct WasmIdentityPublicKey(pv_core::identity::IdentityPublicKey);

#[wasm_bindgen]
impl WasmIdentityPublicKey {
    /// Validates the encoding — see CR-01. Rejects small-order points.
    #[wasm_bindgen(js_name = fromBytes)]
    pub fn from_bytes(bytes: &[u8]) -> Result<WasmIdentityPublicKey, JsValue> {
        let arr: [u8; KEY_LEN] = bytes.try_into().map_err(|_| to_js_str_err("expected 32 bytes"))?;
        Ok(WasmIdentityPublicKey(
            pv_core::identity::IdentityPublicKey::from_bytes(arr).map_err(to_js_err)?,
        ))
    }
}

#[wasm_bindgen(js_name = sealCollectionKey)]
pub fn seal_collection_key(
    recipient_pk: &WasmIdentityPublicKey, // public half only
    ck: &WasmCollectionKey,
) -> Result<String, JsValue> {
    let sealed = pv_core::identity::seal(&recipient_pk.0, &ck.0).map_err(to_js_err)?;
    serde_json::to_string(&sealed).map_err(|e| to_js_str_err(&e.to_string()))
}
```

Add a test that seals with only `alice_view_of_bob_pk = WasmIdentityPublicKey::from_bytes(bob.public_key_bytes())`
and unseals with Bob's `WasmIdentityKey` — i.e. a path where no single scope holds both
halves.

---

## Warnings

### WR-01: `[u8; 32]` is `Copy`, so plaintext key arrays survive un-zeroized after being wrapped in the `ZeroizeOnDrop` newtype

**Files:**
- `crates/pv-core/src/identity.rs:108-111` (`unwrap_identity_secret_key` — the X25519 private key)
- `crates/pv-core/src/items.rs:127-130` (`decrypt_item`), `crates/pv-core/src/items.rs:202-205` (`decrypt_item_for_collection`)
- `crates/pv-wasm/src/lib.rs:161-164` (`import_user_key_from_session`), `crates/pv-wasm/src/lib.rs:296-299` (`unseal_collection_key`)

**Issue:** the pattern is

```rust
let mut k = [0u8; KEY_LEN];
k.copy_from_slice(&plain);
plain.zeroize();
Ok(IdentitySecretKey::from_bytes(k))   // <-- COPIES k, does not move it
```

`[u8; 32]` implements `Copy`, so passing `k` by value copies it; the local `k` remains a
live, initialized binding holding the plaintext key and is dropped as a plain array with
no zeroization. `ZeroizeOnDrop` on the newtype only covers the newtype's copy. The heap
`Vec` (`plain`) is correctly zeroized — the stack array immediately next to it is not.

**Failure scenario:** a client unwraps its identity key on unlock. On return, the frame
that held `k` contains the raw X25519 private key. In the WASM build that memory is
never returned to an OS — it is a persistent region of `WebAssembly.Memory` linear
memory that any subsequent code reading the buffer (a debugger, a heap snapshot, an
extension crash dump uploaded for diagnostics, or a later WASM allocation reading
uninitialized bytes) can recover. The `Zeroize` discipline the file's own doc comment
claims is defeated for the highest-value byte in the module.

The precedent exists pre-phase at `crates/pv-core/src/keys.rs:118-121`, but this phase
added three new instances, so the pattern is spreading.

**Fix:** zeroize the local explicitly after the copy.

```rust
let mut k = [0u8; KEY_LEN];
k.copy_from_slice(&plain);
plain.zeroize();
let out = IdentitySecretKey::from_bytes(k);
k.zeroize();          // the newtype holds its own copy; wipe ours
Ok(out)
```

Apply at all five sites (and, for consistency, at `keys.rs:118-121`).

---

### WR-02: `IdentitySecretKey::generate()` leaves two avoidable un-zeroized copies of the private key

**File:** `crates/pv-core/src/identity.rs:45-48`

**Issue:** the module doc (`:11-18`) presents the `crypto_box::SecretKey` zeroize gap as
unavoidable and claims it is contained by never holding the type long-lived. That
reasoning does not apply to `generate()`, which routes key creation *through* the leaky
type for no benefit:

```rust
let sk = crypto_box::SecretKey::generate(&mut OsRng);
Self(sk.to_bytes())
```

Reading `crypto_box-0.9.1/src/secret_key.rs:50-55`, `SecretKey::generate` is literally
`let mut bytes = [0u8; 32]; csprng.fill_bytes(&mut bytes); bytes.into()` — that local
`bytes` is never zeroized. `from_bytes` (`:34-38`) stores the raw **unclamped** bytes in
`self.bytes` and clamps only for the derived scalar, and `impl Drop` (`:122-126`) zeroizes
**only `scalar`**. So after `generate()` returns there are two un-zeroized copies of the
private key (the local in `crypto_box::generate`, plus the dropped `SecretKey.bytes`)
plus the `to_bytes()` temporary.

**Failure scenario:** every account provisioning leaves the identity private key in two
stack locations that the code has no way to reach. In WASM linear memory these persist
for the life of the instance (same exposure surface as WR-01).

**Fix:** generate directly. Because `from_bytes` stores the raw CSPRNG output verbatim
and only the scalar is clamped, this is bit-for-bit equivalent to what `crypto_box` does
— and it removes `crypto_box` from the key-creation path entirely.

```rust
pub fn generate() -> Self {
    let mut k = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut k);   // identical to crypto_box::SecretKey::generate
    Self(k)
}
```

Keep the existing round-trip test (`public_key_roundtrips_through_bytes`,
`seal_unseal_roundtrip`) as the equivalence proof. The residual, genuinely unavoidable
gap then applies only to the transient reconstructions in `as_crypto_box` and the
ephemeral seal secret — and the module doc should be narrowed to say so.

---

### WR-03: ARCHITECTURE.md asserts the ephemeral seal secret is zeroized; it is not, and the same section contradicts itself

**File:** `docs/ARCHITECTURE.md` — "Decyzja D", "Odrzucone alternatywy" final bullet, vs
"Dwa znane ograniczenia" item 2

**Issue:** the rejected-alternatives bullet describes the hand-rolled wrapper as
"...**efemeryczny sekret zeroizowany natychmiast po użyciu**, nigdy nie przechowywany
ani reużywany." No zeroization happens. `identity.rs:170-177` states the opposite
explicitly: "NIE próbuj ręcznie zerować `crypto_box::SecretKey` — nie ma takiej metody",
and I confirmed in `crypto_box-0.9.1/src/secret_key.rs:122-126` that `Drop` clears only
`scalar`. Limitation item 2, six lines further down the same section, then correctly
says the transient instance "wciąż nie gwarantuje zeroizacji swojej surowej kopii
`bytes` przy drop".

**Failure scenario:** this is the document a future security reviewer or auditor reads
first. The stronger, false claim appears in the "why we chose this" argument, where it
carries the most persuasive weight; the correction appears in a paragraph a reader
skimming the decision may never reach. A threat model built on the first claim will
under-account for ephemeral-secret residue.

**Fix:** replace "efemeryczny sekret zeroizowany natychmiast po użyciu" with
"efemeryczny sekret jest lokalną zmienną jednego wywołania, nigdy nie przechowywany ani
reużywany — jego surowa kopia `bytes` NIE jest zeroizowana (patrz ograniczenie 2
poniżej)", so the section states one consistent thing.

---

### WR-04: `IdentityPublicKey` derives `Eq` over non-canonical encodings — cryptographically identical keys compare unequal

**File:** `crates/pv-core/src/identity.rs:69-79`

**Issue:** the doc comment asserts it is "bezpiecznie derive'ować `Debug`/`Eq`" because
the value is public. Publicness is not the relevant property — *canonicality* is. X25519
u-coordinates have multiple valid byte encodings: bit 255 is masked during field decode,
and `u` and `u + (2^255 - 19)` decode to the same field element. `from_bytes` stores raw
bytes with no canonicalization, so `Eq` distinguishes encodings that the cryptography
treats as one key.

**Failure scenario (verified with a PoC):** take a victim's real public key and set bit 7
of byte 31.

```
canonical == aliased (derived Eq)? false
victim unsealed blob addressed to the ALIASED encoding: 0123456789abcdef0123456789abcdef
```

Any check keyed on these bytes is therefore bypassable: a trust-pin / TOFU comparison
(`stored_pk == fetched_pk`) reports a spurious key rotation, an "is this recipient
already enrolled?" dedup check admits the same member twice, and a byte-keyed
revocation or blocklist is evaded by re-publishing an aliased encoding of a revoked key.
None of that is exploitable today (nothing compares these bytes yet), which is exactly
why it should be fixed while the type is being frozen rather than after four call sites
depend on the current behavior.

**Fix:** canonicalize in the constructor (folds naturally into CR-01's validating
`from_bytes`), and add a test asserting `from_bytes(pk)` and
`from_bytes(pk with bit 255 set)` compare equal.

```rust
let mut canonical = bytes;
canonical[31] &= 0x7f;              // bit 255 is ignored by field decode
// reject or reduce u >= p (2^255 - 19)
```

---

### WR-05: `WasmCollectionKey::generate()` routes the Collection Key through a plain heap `Vec<u8>` that is never zeroized

**File:** `crates/pv-wasm/src/lib.rs:263-268`

**Issue:**

```rust
let bytes = random_bytes(KEY_LEN);
let mut k = [0u8; KEY_LEN];
k.copy_from_slice(&bytes);
WasmCollectionKey(k)
```

`random_bytes` returns a plain `Vec<u8>` and is documented at
`crates/pv-core/src/keys.rs:55-58` as being for *public* randomness (salts) and
explicitly **not** key material. Here it produces a 256-bit Collection Key. `bytes` is
dropped without zeroization, so the heap allocation is freed with the key intact. This
also violates CLAUDE.md's "DO NOT use `String` or `Vec<u8>` for keys/passwords" and is
inconsistent with the sibling `pv_core::items::CollectionKey::generate`
(`items.rs:146-150`), which fills the stack array directly, and with
`unseal_collection_key` (`:291-298`), which does zeroize its `Vec`.

**Failure scenario:** every "create shared collection" action leaves a plaintext
Collection Key in freed WASM heap memory. Because WASM linear memory is never returned
to an OS, that region stays readable for the life of the module instance and will be
handed to the next allocation of the same size — a `serde_json` buffer, for instance,
whose spare capacity may then be written out or logged.

**Fix:** mirror `pv_core::items::CollectionKey::generate` and never materialize a heap
copy.

```rust
pub fn generate() -> WasmCollectionKey {
    let mut k = [0u8; KEY_LEN];
    chacha20poly1305::aead::rand_core::RngCore::fill_bytes(
        &mut chacha20poly1305::aead::OsRng, &mut k,
    );
    WasmCollectionKey(k)
}
```

(or `let bytes = zeroize::Zeroizing::new(random_bytes(KEY_LEN));` if the current shape
must be kept).

---

### WR-06: `pv_core::identity::unseal` returns raw secret bytes as a bare `Vec<u8>` with no caller obligation

**File:** `crates/pv-core/src/identity.rs:188-200`

**Issue:** `unseal` is the public API for recovering a Collection Key and returns
`Result<Vec<u8>, CryptoError>` — an unwrapped heap buffer of key material, with no
`Zeroizing` wrapper and no doc-comment statement that the caller must zeroize it. This
contradicts CLAUDE.md's key-handling rule and the crate's own newtype convention (every
other key in pv-core is an opaque `ZeroizeOnDrop` type). The one current caller
(`pv-wasm:291-298`) happens to zeroize; the next caller has no signal at all, and the
signature actively suggests none is needed.

There is also no pv-core-level helper that converts a `SealedKey` into a
`CollectionKey`, so each caller must independently remember the length check. A native
caller writing the obvious `k.copy_from_slice(&plain)` against a short plaintext panics
(a WASM trap in the browser build) instead of returning `CryptoError::Decrypt`.

**Failure scenario:** Plan 21-06+ adds a native/server-side or extension-side consumer
of `unseal`, forgets to zeroize (nothing in the signature or docs prompts it), and the
Collection Key is left in freed heap memory — the same exposure as WR-05, in code that
looks correct.

**Fix:** make the type carry the obligation, and add the length-validating helper so the
check exists once.

```rust
pub fn unseal(my_sk: &IdentitySecretKey, sealed: &SealedKey)
    -> Result<zeroize::Zeroizing<Vec<u8>>, CryptoError> { ... }

/// Unseal directly into an opaque CollectionKey; rejects any plaintext that is
/// not exactly KEY_LEN bytes (never truncates, never panics).
pub fn unseal_collection_key(my_sk: &IdentitySecretKey, sealed: &SealedKey)
    -> Result<crate::items::CollectionKey, CryptoError> { ... }
```

Then have `pv-wasm`'s `unsealCollectionKey` delegate to it instead of re-implementing the
check.

---

### WR-07: the new transitive crypto crates got no `deny.toml` watch-list row

**File:** `deny.toml:13-24`

**Issue:** the `crypto_box` row is present and correct (`=0.9.1`, matching
`crates/pv-core/Cargo.toml:12`'s `default-features = false, features = ["chacha20",
"alloc", "rand_core"]`). But `git diff fe80d95..HEAD -- Cargo.lock` shows the pin pulled
in four new crates, none of which got a row: `crypto_secretbox 0.1.1`,
`curve25519-dalek 4.1.3`, `curve25519-dalek-derive`, and `fiat-crypto 0.2.9`.
`curve25519-dalek` is where the X25519 scalar multiplication actually executes, and
`crypto_secretbox` is where the AEAD and the non-empty-AAD rejection live — i.e. the two
crates this phase's security properties most directly depend on. The table's stated
contract is "one row per crate the codebase sweep flagged".

**Failure scenario:** `curve25519-dalek` has a history of timing advisories
(RUSTSEC-2024-0344, fixed in 4.1.3 — today's lock is on the good version, which is
precisely why it needs a row). With no row and no direct declaration, a future
`cargo update` that moves the transitive resolve leaves no reviewer-facing record that
this is a crate whose version matters, and the "Cargo.lock-pin-only" rationale is never
written down the way it was for `getrandom` and `openssl-sys`.

**Fix:** add three rows following the existing `getrandom`/`openssl-sys` format, e.g.

```
# | crypto_secretbox  | 0.1.1  | no — transitive via crypto_box | Cargo.lock-pin-only; AEAD + non-empty-AAD rejection depend on it |
# | curve25519-dalek  | 4.1.3  | no — transitive via crypto_box | Cargo.lock-pin-only; performs the X25519 scalar mult; >= 4.1.3 required for RUSTSEC-2024-0344 |
# | fiat-crypto       | 0.2.9  | no — transitive via curve25519-dalek | Cargo.lock-pin-only; formally-verified field arithmetic backend |
```

---

## Info

### IN-01: stale `#[allow(dead_code)]` suppresses nothing

**File:** `crates/pv-core/src/identity.rs:81`

**Issue:** `IdentityPublicKey::as_crypto_box` is annotated `#[allow(dead_code)]`, but it
is used by `seal` at `:158`. The attribute is a leftover from Plan 21-02 (before 21-04
added `seal`). `cargo clippy --all-targets` is clean either way, so the attribute
currently has no effect — but it will silently hide a real dead-code signal if `seal`'s
implementation ever changes.

**Fix:** delete the attribute.

---

### IN-02: `build_coll_item_aad` truncates length prefixes via `as u32`

**File:** `crates/pv-core/src/items.rs:59,61`

**Issue:** `(collection_id.len() as u32).to_be_bytes()` silently wraps for ids of
2^32 bytes or more, at which point the length-prefix unambiguity the function exists to
provide is lost (`len = 2^32` and `len = 0` encode identically). I could not construct a
realistic trigger — ids are UUIDs and a 4 GiB identifier would fail long before this —
so this is completeness, not an exploitable path.

**Fix:** make the function fallible rather than lossy:

```rust
let cid_len = u32::try_from(collection_id.len())
    .map_err(|_| CryptoError::InvalidInput("collection_id too long"))?;
```

---

### IN-03: `backward_compat.rs`'s provenance pointer is unactionable

**File:** `crates/pv-core/tests/backward_compat.rs:5-6`

**Issue:** the doc comment directs the reader to
`git log --oneline -- crates/pv-core/tests/fixtures/` to find "the sibling generator that
produced it and was then deleted". That command returns only the fixture commit
(`8c24514`). Per `8c24514`'s own commit message the generator lived at
`crates/pv-core/examples/generate_fixture.rs` and was **never committed** (deliberately,
so it cannot silently regenerate the fixture), so no git command can surface it.

I verified independently that the fixture is nonetheless genuinely load-bearing:
`build_item_aad` and both personal-scope prefixes are untouched by this phase's diff, and
`8c24514` (fixture) precedes `caa90c4` (first AAD-touching commit). The tripwire works;
only the pointer is wrong, which will cost the next reader time and may lead them to
conclude the fixture was regenerated post-change.

**Fix:** cite the real path and the commit hash whose message records the generation
parameters: "generated once by `crates/pv-core/examples/generate_fixture.rs`,
intentionally never committed — see commit `8c24514`'s message for the exact
key/item_id/revision/plaintext inputs."

---

### IN-04: ARCHITECTURE.md overstates cipher compatibility between the two layers

**File:** `docs/ARCHITECTURE.md`, "Decyzja D", `crypto_box` selection paragraph

**Issue:** the doc says the `chacha20` feature gives "AEAD **XChaCha20-Poly1305 —
dokładnie ten cipher, którego `keys::aead_seal` już używa**". Same primitive family, but
the constructions are not interchangeable. Verified in source:
`ChaChaBox = CryptoBox<chacha20::ChaCha20Legacy>` over `crypto_secretbox`, which
**prepends** the Poly1305 tag (`crypto_secretbox-0.1.1/src/lib.rs:249-261`) and uses the
legacy 64-bit counter, whereas `chacha20poly1305::XChaCha20Poly1305` used by
`keys::aead_seal` **appends** the tag and uses the IETF 32-bit counter. Ciphertexts are
not byte-compatible between the two layers.

Worth stating precisely because "exactly the same cipher" invites a future reader to
assume a `WrappedKey` ciphertext and a `SealedKey` ciphertext are interchangeable, or
that one layer's decrypt could be pointed at the other's blob.

**Fix:** say "the same primitive family (XChaCha20-Poly1305), in NaCl
`crypto_secretbox` framing — tag-prepended and 64-bit counter, therefore NOT
byte-interoperable with `keys::aead_seal`'s IETF construction".

---

### IN-05: cross-scope isolation coverage is one-directional

**File:** `crates/pv-core/src/items.rs:278-291`

**Issue:** `personal_blob_rejected_under_collection_scope` covers personal → collection
using identical key material, which is the right shape of test. The reverse (a
collection-scoped blob fed to `decrypt_item` with the same bytes as a `UserKey`) has no
test, and neither does key-wrap-prefix vs data-prefix isolation within a single scope (a
`enc_data` blob presented as an `enc_key`). I hand-verified that all four prefixes are
pairwise distinguishable within their leading bytes, so no collision exists today —
nothing pins that property.

**Fix:** add the mirror-image test plus one prefix-swap test:

```rust
#[test]
fn collection_blob_rejected_under_personal_scope() {
    let key_bytes = [7u8; KEY_LEN];
    let ck = CollectionKey::from_bytes(key_bytes);
    let uk = UserKey::from_bytes(key_bytes);
    let item = encrypt_item_for_collection(&ck, b"secret", "collection-1", "item-1", 1).unwrap();
    assert!(matches!(decrypt_item(&uk, &item, "item-1", 1), Err(CryptoError::Decrypt)));
}
```

---

### IN-06: two crypto dependencies still carry caret ranges (pre-existing)

**File:** `crates/pv-core/Cargo.toml:14,19`

**Issue:** `sha2 = "0.10"` and `totp-rs = "5.7.2"` are caret ranges, while every other
crypto dependency in the same file is exact-pinned with a matching `deny.toml`
watch-list row (`argon2 =0.5.3`, `chacha20poly1305 =0.10.1`, `crypto_box =0.9.1`,
`hkdf =0.12.4`). `sha2` backs HKDF-SHA256 across the whole key hierarchy and the passkey
signature path. Neither was introduced by this phase (the Cargo.toml diff adds only the
`crypto_box` line), so this is noted for scope-completeness rather than as phase
regression.

**Fix:** exact-pin both and add watch-list rows, consistent with the SEC-03 policy the
file already applies to the other four.

---

_Reviewed: 2026-07-29T23:50:06Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
