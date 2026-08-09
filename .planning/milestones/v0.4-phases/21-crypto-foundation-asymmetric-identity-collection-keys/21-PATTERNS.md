# Phase 21: Crypto Foundation — Asymmetric Identity & Collection Keys - Pattern Map

**Mapped:** 2026-07-30
**Files analyzed:** 8 (5 new, 3 modified + 1 script check-only)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `crates/pv-core/src/identity.rs` (NEW) | crypto module (key-management) | transform (pure fn, no I/O) | `crates/pv-core/src/keys.rs` (opaque-key/wrap pattern) + `crates/pv-core/src/prf.rs` (module doc/test style) | exact |
| `crates/pv-core/src/items.rs` (MODIFIED — add `build_coll_item_aad` + collection-scope encrypt/decrypt) | crypto module (transform) | transform | itself (extend existing `build_item_aad`/`encrypt_item`/`decrypt_item`) | exact |
| `crates/pv-core/src/lib.rs` (MODIFIED — register module + hierarchy diagram) | module root / config | — | itself | exact |
| `crates/pv-core/Cargo.toml` (MODIFIED — add `crypto_box` dep) | config | — | itself (existing exact-pin entries) | exact |
| `deny.toml` (MODIFIED — watch-list row) | config | — | itself (existing watch-list table) | exact |
| `crates/pv-core/tests/backward_compat.rs` (NEW) | test (integration, regression tripwire) | batch/file-I/O (fixture) | `crates/pv-provider/tests/response_shape.rs` | role-match (byte-shape regression gate; different domain) |
| `crates/pv-core/tests/fixtures/pre_v0_4_item.json` (NEW) | fixture data | file-I/O | none in-repo (new pattern) — no analog | none |
| `crates/pv-wasm/src/lib.rs` (MODIFIED — `WasmIdentityKey`, wrap/unwrap/seal/unseal exports) | WASM bridge (opaque-handle bindings) | request-response (sync FFI) | itself (`WasmWrappingKey`/`WasmUserKey` + their `#[cfg(test)] mod tests`) | exact |
| `scripts/build-wasm.sh` (verify-only, likely unmodified) | build script | — | itself | exact (no change expected — see Research) |

## Pattern Assignments

### `crates/pv-core/src/identity.rs` (NEW)

**Analog:** `crates/pv-core/src/keys.rs` (opaque-key shape, `WrappedKey`, `INFO_*` constants, wrap/unwrap pair) and `crates/pv-core/src/prf.rs` (module doc-comment style, `Zeroizing` return, test layout)

**Module doc-comment pattern** (`prf.rs` lines 1-11 — mirror this shape: what the module does, a footgun/UWAGA note, cross-reference to CONTEXT amendments):
```rust
//! Ścieżka PRF: wynik WebAuthn PRF (hmac-secret) → klucz wrapujący User Key.
//!
//! Wynik PRF (32 bajty HMAC-SHA-256 po stronie authenticatora) nigdy nie
//! opuszcza klienta. ...
//!
//! UWAGA (footgun z RESEARCH.md): ...
```
For `identity.rs`, open with what an X25519 identity keypair is, that generation is client-side only (zero-knowledge boundary — server never sees `UserKey`), and the Zeroize-gap caveat from RESEARCH.md's `## Zeroize Gap` section (state it in the module doc, not just a code comment, matching CLAUDE.md's "Security-critical decisions explained").

**Opaque-key newtype pattern** (`keys.rs` lines 27-46, `UserKey`):
```rust
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct UserKey([u8; KEY_LEN]);

impl UserKey {
    pub fn generate() -> Self {
        let mut k = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut k);
        Self(k)
    }

    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self(bytes)
    }

    pub fn expose(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}
```
Copy this shape exactly for `IdentitySecretKey`, per RESEARCH.md's `## Zeroize Gap` design (store `[u8; KEY_LEN]` directly, do NOT hold a long-lived `crypto_box::SecretKey` field, since that type's own `Drop` doesn't zeroize its raw `bytes` field). `generate()` uses `crypto_box::SecretKey::generate(&mut OsRng)` then `.to_bytes()` into the wrapper; add a private `as_crypto_box()` helper that reconstructs a transient `crypto_box::SecretKey` per seal/unseal call (documented residual-exposure caveat per RESEARCH.md).

**`WrappedKey`-sibling pattern** (`keys.rs` lines 48-53 — `SealedKey` is new, not a replacement):
```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedKey {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}
```
`SealedKey` adds one more public field (`ephemeral_pk: [u8; 32]` or `Vec<u8>`, matching this struct's `Vec<u8>` convention for nonce/ciphertext) — see RESEARCH.md `## Sealed-Box Construction — Concrete Recommendation` for exact field set.

**Domain-separation constant pattern** (`keys.rs` lines 17-25 — the `INFO_EXT_PRF_UNLOCK` precedent comment is the exact model for explaining why a new recipient class needs its own constant):
```rust
/// Domain separation dla HKDF — wersjonowane, nigdy nie zmieniać wstecznie.
pub const INFO_PW_UNLOCK: &[u8] = b"pv:pw-unlock:v1";
pub const INFO_PRF_UNLOCK: &[u8] = b"pv:prf-unlock:v1";
pub const INFO_AUTH_HASH: &[u8] = b"pv:auth-hash:v1";
/// Extension-scoped PRF recipient (rpId = extension ID, 09-CONTEXT AMENDMENT
/// 2026-07-15) — a DIFFERENT context from `INFO_PRF_UNLOCK` (web-RP
/// credential), so it gets its own versioned constant. Never reuse
/// `INFO_PRF_UNLOCK` for this recipient class and vice versa.
pub const INFO_EXT_PRF_UNLOCK: &[u8] = b"pv:ext-prf-unlock:v1";
```
New constant: `pub const INFO_X25519_SK_WRAP: &[u8] = b"pv:x25519-sk-wrap:v1";` in `identity.rs` (RESEARCH.md `## Identity Keypair Wrap Constant`), with a comment stating it is passed as AEAD **AAD** (not HKDF info) to `aead_seal`, mirroring `wrap_user_key`'s `b"pv:uk:v1"` usage in `keys.rs` line 106 — not the HKDF-info usage `INFO_PRF_UNLOCK` has in `prf.rs` line 30. Note this dual-use convention explicitly in a comment so a future reader doesn't assume all `INFO_*` constants are HKDF-only.

**Wrap/unwrap pattern reusing `aead_seal`/`aead_open` verbatim** (`keys.rs` lines 104-122, `wrap_user_key`/`unwrap_user_key` — copy this shape exactly, including the zeroize-on-length-mismatch branch):
```rust
pub fn wrap_user_key(wrapping_key: &[u8; KEY_LEN], uk: &UserKey) -> Result<WrappedKey, CryptoError> {
    aead_seal(wrapping_key, uk.expose(), b"pv:uk:v1")
}

pub fn unwrap_user_key(
    wrapping_key: &[u8; KEY_LEN],
    blob: &WrappedKey,
) -> Result<UserKey, CryptoError> {
    let mut plain = aead_open(wrapping_key, blob, b"pv:uk:v1")?;
    if plain.len() != KEY_LEN {
        plain.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&plain);
    plain.zeroize();
    Ok(UserKey::from_bytes(k))
}
```
`wrap_identity_secret_key`/`unwrap_identity_secret_key` follow this exactly, using `INFO_X25519_SK_WRAP` in place of `b"pv:uk:v1"` — see RESEARCH.md `## Identity Keypair Wrap Constant` for the drafted signatures.

**Seal/unseal hand-written wrapper** (new composition — no in-repo analog since this is the first asymmetric primitive; RESEARCH.md `## Sealed-Box Construction — Concrete Recommendation` gives the exact pseudocode to translate 1:1 into Rust, including the "zeroize the ephemeral secret immediately, comment-heavy since this is the one piece of composition pv-core owns" instruction from CONTEXT.md).

**Error handling:** use existing `CryptoError` variants (`crates/pv-core/src/error.rs`) — `CryptoError::Encrypt`/`::Decrypt`/`::InvalidInput`. Map `crypto_box`'s `aead::Error` the same way `aead_seal`/`aead_open` map `chacha20poly1305`'s errors (`keys.rs` lines 81-101: `.map_err(|_| CryptoError::Encrypt)` / `.map_err(|_| CryptoError::Decrypt)`). Do not add a new `CryptoError` variant unless a genuinely new failure mode exists (e.g. malformed `ephemeral_pk` length on unseal — reuse `CryptoError::InvalidInput("bad ephemeral pk length")` matching the existing `"bad nonce length"` string style at `keys.rs` line 93).

**Test style** (`prf.rs` lines 51-104 — `#[cfg(test)] mod tests` in-file, negative test beside every positive round trip, plus one "cryptographically distinct" cross-context test mirroring `ext_prf_and_web_prf_keys_are_cryptographically_distinct`, lines 86-98):
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::{unwrap_user_key, wrap_user_key, UserKey};

    #[test]
    fn prf_unlock_roundtrip() { /* ... */ }

    #[test]
    fn short_prf_output_rejected() {
        assert!(wrapping_key_from_prf(&[0u8; 16]).is_err());
    }
}
```
For `identity.rs`: `generate_roundtrip` (keypair round trip through `wrap_identity_secret_key`/`unwrap_identity_secret_key`), `wrong_user_key_fails` (mirrors `wrong_key_fails` in `keys.rs` lines 137-144), `seal_unseal_roundtrip`, `wrong_recipient_cannot_unseal` (negative test beside the seal/unseal positive), and a `SecretKey::from_bytes` reconstruction round-trip test proving `as_crypto_box()` produces a usable key each call.

---

### `crates/pv-core/src/items.rs` (MODIFIED)

**Analog:** itself — the exact function/test being extended.

**Existing `build_item_aad` — untouched, frozen byte-for-byte** (lines 24-33; SC#4 depends on zero changes here):
```rust
const AAD_ITEM_KEY_PREFIX: &[u8] = b"pv:item-key:v1";
const AAD_ITEM_DATA_PREFIX: &[u8] = b"pv:item:v1";

fn build_item_aad(prefix: &[u8], item_id: &str, revision: u32) -> Vec<u8> {
    let mut aad = prefix.to_vec();
    aad.extend_from_slice(item_id.as_bytes());
    aad.extend_from_slice(&revision.to_be_bytes());
    aad
}
```

**New sibling function — do not parameterize the existing one** (RESEARCH.md `## Scope-Bound AAD — Concrete Design` gives the exact body to add, length-prefixed per field to avoid the `("ab","c")` vs `("a","bc")` ambiguity):
```rust
const AAD_COLL_ITEM_KEY_PREFIX: &[u8] = b"pv:coll-item-key:v1";
const AAD_COLL_ITEM_DATA_PREFIX: &[u8] = b"pv:coll-item:v1";

fn build_coll_item_aad(prefix: &[u8], collection_id: &str, item_id: &str, revision: u32) -> Vec<u8> {
    let mut aad = prefix.to_vec();
    aad.extend_from_slice(&(collection_id.len() as u32).to_be_bytes());
    aad.extend_from_slice(collection_id.as_bytes());
    aad.extend_from_slice(&(item_id.len() as u32).to_be_bytes());
    aad.extend_from_slice(item_id.as_bytes());
    aad.extend_from_slice(&revision.to_be_bytes());
    aad
}
```
New `encrypt_item_for_collection`/`decrypt_item_for_collection` entry points mirror `encrypt_item`/`decrypt_item` (lines 55-104) exactly, swapping `uk: &UserKey` for a Collection Key `&[u8; KEY_LEN]` and `build_item_aad` for `build_coll_item_aad`. Keep `ItemKey` (lines 35-44) and `EncryptedItem` (lines 46-53) unchanged and shared between personal/collection paths — only the AAD builder and the top-level key differ.

**Test to extend — `aad_mutation_rejected`** (lines 128-140, the exact pattern SC#3 says to mirror for cross-scope rejection):
```rust
#[test]
fn aad_mutation_rejected() {
    let uk = UserKey::generate();
    let item = encrypt_item(&uk, b"secret", "item-1", 1).unwrap();

    // Revision mismatch — same item_id, wrong revision.
    let revision_mismatch = decrypt_item(&uk, &item, "item-1", 2);
    assert!(matches!(revision_mismatch, Err(CryptoError::Decrypt)));

    // item_id mismatch — same revision, different item.
    let item_id_mismatch = decrypt_item(&uk, &item, "item-2", 1);
    assert!(matches!(item_id_mismatch, Err(CryptoError::Decrypt)));
}
```
Add sibling tests: personal-scope blob rejected under collection scope and vice versa (needs a common decrypt path or a direct `aead_open` call with the wrong AAD builder), collection-A blob rejected under collection-B AAD, plus the length-unambiguous regression test RESEARCH.md mandates:
```rust
assert_ne!(build_coll_item_aad(prefix, "ab", "c", 0), build_coll_item_aad(prefix, "a", "bc", 0));
```
Keep existing `item_roundtrip`/`other_user_key_cannot_decrypt`/`aad_mutation_rejected` (lines 110-140) passing unchanged — do not edit their bodies.

---

### `crates/pv-core/src/lib.rs` (MODIFIED)

**Analog:** itself.

**Module registration pattern** (lines 18-23 — alphabetical `pub mod` list):
```rust
pub mod error;
pub mod items;
pub mod kdf;
pub mod keys;
pub mod prf;
pub mod totp;

pub use error::CryptoError;
```
Add `pub mod identity;` in alphabetical position (after `error`, before `items`).

**Hierarchy doc-comment to extend** (lines 1-17 — the ASCII diagram needs an asymmetric/sharing branch added, not replaced):
```rust
//! pv-core — współdzielony core kryptograficzny.
//!
//! Hierarchia kluczy (ARCHITECTURE.md §4):
//!
//! ```text
//!                losowy 256-bit User Key (UK)
//!                     │ wrapowany równolegle do N "recipientów"
//!      ┌──────────────┴───────────────┐
//!  master password                passkey #N
//!  → Argon2id → HKDF → wrap UK    → PRF(salt) → HKDF → wrap UK
//!
//!  UK → wrapuje per-item Cipher Keys → itemy (XChaCha20-Poly1305)
//! ```
```
Add a branch showing `UK → wraps X25519 IdentitySecretKey (aead_seal, INFO_X25519_SK_WRAP)` and `X25519 public key seals Collection Keys (crypto_box, per-recipient) → coll-scoped item AAD`, matching the existing "why" framing from CLAUDE.md's doc-comment convention.

---

### `crates/pv-core/Cargo.toml` (MODIFIED)

**Analog:** itself — exact-pin style for existing crypto deps.

**Existing exact-pin pattern** (lines 9-18):
```toml
[dependencies]
argon2 = "=0.5.3"
chacha20poly1305 = "=0.10.1"
hkdf = "=0.12.4"
sha2 = "0.10"
zeroize = { version = "1", features = ["derive"] }
serde.workspace = true
thiserror.workspace = true
base64 = "0.22"
totp-rs = { version = "5.7.2", default-features = false, features = ["otpauth"] }
```
Add, per CONTEXT.md/RESEARCH.md's verified-correct feature set (RESEARCH.md `## Verified Corrections — Correction 1` — CONTEXT.md's own draft is missing `rand_core` and will not compile):
```toml
crypto_box = { version = "=0.9.1", default-features = false, features = ["chacha20", "alloc", "rand_core"] }
```
Do not add `chacha20` as a direct dependency (CONTEXT.md hard constraint — let `crypto_box` own that edge).

---

### `deny.toml` (MODIFIED)

**Analog:** itself — existing watch-list table format (lines 13-23).

**Existing row format:**
```
# | Crate                  | Cargo.lock version | Direct decl (crate's Cargo.toml)      | Pin action this plan                          |
# | argon2                   | 0.5.3               | yes — pv-core                           | exact-pinned Task 2 ("=0.5.3")                  |
```
Add a matching row for `crypto_box`: `| crypto_box | 0.9.1 | yes — pv-core | exact-pinned this phase ("=0.9.1") |`. No changes needed to `[advisories]`, `[bans]`, `[licenses]`, or `[sources]` sections unless `cargo deny check` surfaces a new license/advisory — verify empirically per the file's own convention of only adding entries backed by a real run (see the `ignore = []` comment's evidentiary style, lines 32-45, as the model for any new justification comment).

---

### `crates/pv-core/tests/backward_compat.rs` (NEW)

**Analog:** `crates/pv-provider/tests/response_shape.rs` — this repo's only existing "cross-cutting regression proof lives in `tests/`, not inside `src/`'s `#[cfg(test)] mod tests`" precedent.

**Structural pattern to copy** (module doc-comment explaining *why* this test exists as a standalone regression tripwire, not a duplicate of other coverage — lines 1-28 of the analog):
```rust
//! QA-04: a permanent Rust unit gate that enumerates every binary WebAuthn
//! response field `pv-provider` emits ... and asserts each one is a
//! base64url STRING on the wire, never a bare JSON number array ...
//! the exact silent-regression class documented in
//! `.planning/debug/resolved/firefox-provider-corruption.md` that shipped
//! undetected through every prior `.ok`/`id`-only test because nothing ever
//! inspected the SHAPE ...
```
For `backward_compat.rs`, open with: this proves SC#4 ("pre-v0.4 vault survives without re-encrypting a single byte") via committed fixture data, not a same-run round trip — cite RESEARCH.md's own "Why this genuinely proves SC#4 rather than being circular" paragraph almost verbatim as the module doc.

**Test-body pattern** (analog's `#[test] fn create_response_binary_fields_are_base64url_strings()`, lines 126-152 — parse committed/generated data, assert field-by-field with a panic message that names the exact regression class):
```rust
#[test]
fn pre_v0_4_item_decrypts_unchanged() {
    let uk = UserKey::from_bytes([0x42; 32]);
    let json = include_str!("fixtures/pre_v0_4_item.json");
    let item: EncryptedItem = serde_json::from_str(json).unwrap();
    let plaintext = decrypt_item(&uk, &item, "fixture-item-pre-v0.4", 1).unwrap();
    assert_eq!(plaintext, /* same fixed plaintext the generator used */);
}
```
This exact body is already drafted in RESEARCH.md `## Pre-v0.4 Fixture Strategy` — copy it directly, including the fixed `[0x42; 32]` UserKey and fixed `item_id`/`revision` (reproducible, not tied to ephemeral randomness, per the analog's own "fixture-owning" precedent of duplicating fixtures rather than importing private test-only functions across crate boundaries — see analog's `fixture_create_request` comment, lines 33-37).

**Fixture-generation is a ONE-SHOT, not part of the regular suite** — no in-repo analog for this half; RESEARCH.md's `## Pre-v0.4 Fixture Strategy` steps 1-3 are the concrete procedure (throwaway `#[test]`/example binary run once against the pre-change `encrypt_item`, output committed, generator then deleted/`#[ignore]`d so `cargo test` never regenerates it).

---

### `crates/pv-wasm/src/lib.rs` (MODIFIED)

**Analog:** itself — `WasmWrappingKey`/`WasmUserKey` opaque-handle pattern and their `#[cfg(test)] mod tests`.

**Opaque-handle struct + impl pattern** (lines 68-134):
```rust
#[wasm_bindgen]
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct WasmWrappingKey([u8; KEY_LEN]);

#[wasm_bindgen]
impl WasmWrappingKey {
    #[wasm_bindgen(js_name = fromPassword)]
    pub fn from_password(
        password: &mut [u8],
        salt: &[u8],
        kdf_params_json: &str,
    ) -> Result<WasmWrappingKey, JsValue> {
        let params: KdfParams = serde_json::from_str(kdf_params_json)
            .map_err(|e| to_js_str_err(&e.to_string()))?;
        let result = wrapping_key_from_password(password, salt, &params).map_err(to_js_err);
        password.zeroize();
        let wk = result?;
        Ok(WasmWrappingKey(*wk))
    }
}

#[wasm_bindgen]
pub struct WasmUserKey(UserKey);

#[wasm_bindgen]
impl WasmUserKey {
    #[wasm_bindgen(js_name = generate)]
    pub fn generate() -> WasmUserKey {
        WasmUserKey(UserKey::generate())
    }
}
```
`WasmIdentityKey(IdentitySecretKey)` follows the `WasmUserKey` shape exactly (private inner field, `generate()` static ctor). Public-key-bytes accessor is safe to return raw (public by construction — matches the reasoning already used for `random_salt`, line ~414, no "sanctioned exception" comment needed since it's not secret). No method may return the private scalar/bytes — RESEARCH.md's drafted `pv-wasm Exposure` section gives the exact function signatures (`wrapIdentitySecretKey`, `unwrapIdentitySecretKey`, `sealCollectionKey`, `unsealCollectionKey`).

**Wrap/unwrap JSON-blob bridging pattern** (lines 167-182 — `wrapUserKey`/`unwrapUserKey`, the exact shape `wrapIdentitySecretKey`/`unwrapIdentitySecretKey` copy):
```rust
#[wasm_bindgen(js_name = wrapUserKey)]
pub fn wrap_user_key(wrapping_key: &WasmWrappingKey, uk: &WasmUserKey) -> Result<String, JsValue> {
    let blob = core_wrap_user_key(&wrapping_key.0, &uk.0).map_err(to_js_err)?;
    serde_json::to_string(&blob).map_err(|e| to_js_str_err(&e.to_string()))
}

#[wasm_bindgen(js_name = unwrapUserKey)]
pub fn unwrap_user_key(
    wrapping_key: &WasmWrappingKey,
    wrapped_json: &str,
) -> Result<WasmUserKey, JsValue> {
    let blob: WrappedKey =
        serde_json::from_str(wrapped_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let uk = core_unwrap_user_key(&wrapping_key.0, &blob).map_err(to_js_err)?;
    Ok(WasmUserKey(uk))
}
```

**Error mapping helpers to reuse verbatim** (lines 45-66 — target-gated `to_js_err`/`to_js_str_err`, already exist, do not duplicate):
```rust
#[cfg(target_arch = "wasm32")]
fn to_js_err(e: CryptoError) -> JsValue { /* ... */ }
#[cfg(not(target_arch = "wasm32"))]
fn to_js_err(e: CryptoError) -> JsValue { /* ... */ }
```

**"Sanctioned exception" comment pattern** (lines 136-144) — copy this style ONLY if a genuinely new raw-byte-crossing exception is needed; RESEARCH.md is explicit the new identity/Collection Key types must NOT grow this surface, so no new sanctioned-exception block should appear for them. `sealCollectionKey`'s `collection_key_bytes: &[u8]` parameter is the one deliberate, narrow exception RESEARCH.md calls out (mirrors how `WrappedKey`/`EncryptedItem` already cross as JSON blobs, not opaque handles) — document it inline the same way, not as a new sanctioned-exception banner comment.

**Test pattern** (lines 423-479, `full_roundtrip`/`from_prf_roundtrip`/`from_prf_rejects_short_input` — in-file `#[cfg(test)] mod tests`, positive round trip + negative rejection test pairs):
```rust
#[test]
fn full_roundtrip() { /* generate -> wrap -> unwrap -> compare */ }

#[test]
fn from_prf_rejects_short_input() {
    let result = WasmWrappingKey::from_prf(&mut short);
    assert!(result.is_err());
}
```
New tests: `identity_key_generate_wrap_unwrap_roundtrip`, `identity_key_wrong_user_key_fails`, `seal_unseal_collection_key_roundtrip`, `unseal_wrong_recipient_fails`.

---

## Shared Patterns

### Opaque `Zeroize + ZeroizeOnDrop` newtype
**Source:** `crates/pv-core/src/keys.rs` lines 27-46 (`UserKey`)
**Apply to:** `IdentitySecretKey` in `identity.rs`, and any Collection Key type introduced
```rust
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct UserKey([u8; KEY_LEN]);
```
No `pub` byte field, single `expose()`-style accessor, `from_bytes`/`generate` constructors.

### Versioned `pv:...:v1` domain-separation constants
**Source:** `crates/pv-core/src/keys.rs` lines 17-25
**Apply to:** `INFO_X25519_SK_WRAP` (`identity.rs`), `AAD_COLL_ITEM_KEY_PREFIX`/`AAD_COLL_ITEM_DATA_PREFIX` (`items.rs`)
- Never reuse an existing constant for a new recipient/scope class — always mint a new versioned one, with an in-code comment explaining why (the `INFO_EXT_PRF_UNLOCK` comment is the exact model).

### `aead_seal`/`aead_open` reuse for symmetric wrapping
**Source:** `crates/pv-core/src/keys.rs` lines 73-102 (`pub(crate)`, XChaCha20-Poly1305 with AAD)
**Apply to:** `wrap_identity_secret_key`/`unwrap_identity_secret_key` in `identity.rs` — no new symmetric crypto needed, call these two functions directly.

### Error handling — map crate-specific errors to existing `CryptoError`
**Source:** `crates/pv-core/src/error.rs` + usage at `keys.rs` lines 81-101
**Apply to:** all new `identity.rs`/`items.rs` functions — `.map_err(|_| CryptoError::Encrypt)` / `::Decrypt` / `::InvalidInput("...")`. Do not introduce a parallel error type for `crypto_box`.

### In-file test module with mandatory negative test beside every positive round trip
**Source:** `crates/pv-core/src/prf.rs` lines 51-104, `crates/pv-core/src/keys.rs` lines 124-158, `crates/pv-core/src/items.rs` lines 106-140
**Apply to:** every new/modified function in `identity.rs` and `items.rs`.

### Comment style: Polish + English mix, "why" not just "what", ASCII diagrams in crypto modules
**Source:** module doc-comments throughout `keys.rs`, `prf.rs`, `items.rs`, `lib.rs`
**Apply to:** `identity.rs`'s module doc, `lib.rs`'s hierarchy-diagram extension, the KEY-05 decision-record narrative in `docs/ARCHITECTURE.md` §4.

### Exact-pin crypto dependency style
**Source:** `crates/pv-core/Cargo.toml` lines 10-12, `deny.toml` watch-list lines 13-23
**Apply to:** the new `crypto_box = "=0.9.1"` line and its `deny.toml` watch-list row.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `crates/pv-core/tests/fixtures/pre_v0_4_item.json` | fixture data | file-I/O | No `tests/fixtures/` directory precedent exists anywhere in the Rust crates today (verified by RESEARCH.md's own grep) — this phase establishes the pattern. Use RESEARCH.md `## Pre-v0.4 Fixture Strategy` directly; there is nothing in-repo to copy from beyond the general "committed test data, generated once, never regenerated by the regular suite" principle.
| The hand-written sealed-box seal/unseal composition itself (`ChaChaBox::new` + ephemeral keypair generation/zeroize) | crypto primitive | transform | First asymmetric primitive in this codebase — no existing analog composition. Use RESEARCH.md `## Sealed-Box Construction — Concrete Recommendation`'s pseudocode as the primary source instead of a codebase analog.

## Metadata

**Analog search scope:** `crates/pv-core/src/`, `crates/pv-wasm/src/`, `crates/pv-provider/tests/`, `deny.toml`, `scripts/build-wasm.sh`
**Files scanned:** `keys.rs`, `items.rs`, `prf.rs`, `lib.rs`, `error.rs`, `Cargo.toml` (pv-core), `deny.toml`, `pv-wasm/src/lib.rs`, `pv-provider/tests/response_shape.rs`, `scripts/build-wasm.sh`
**Pattern extraction date:** 2026-07-30
