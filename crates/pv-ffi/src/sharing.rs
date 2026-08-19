//! Phase 40's sharing surface — X25519 identity keypairs and Collection
//! Keys, thinly bound over `pv_core::identity`/`pv_core::items::CollectionKey`.
//!
//! DR-40-A (`ios/IOS-SPIKE-LOG.md` §1h): every function here whose value
//! reaches the server wire returns a `String` produced by `serde_json`
//! INSIDE Rust, and accepts such a `String` on the way back — mirroring
//! `pv-wasm`'s `sealCollectionKey`/`unsealCollectionKey`/
//! `wrapIdentitySecretKey`/`unwrapIdentitySecretKey`
//! (`crates/pv-wasm/src/lib.rs:250-353`), NEVER a UniFFI `Record` of `Data`
//! (the `FfiWrappedKey`/`FfiEncryptedItem` style in `lib.rs`) — Swift's
//! `JSONEncoder` would encode a `Data` field as base64 while `serde_json`
//! encodes `Vec<u8>`/`[u8; N]` as a JSON number array, and this codebase has
//! already paid for that exact divergence once (DR-38-C, this module's own
//! sibling `wire.rs`). `SealedKey.ephemeral_pk` is `[u8; 32]` — a wrong
//! encoding there fails at a DIFFERENT serde layer than a `Vec<u8>` field,
//! so DR-38-C's existing mental model does not automatically cover it, which
//! is why DR-40-A restates the rule explicitly for this module.
//!
//! `encrypt_item_for_collection`/`decrypt_item_for_collection` at the bottom
//! of this file are a Rule-2 (missing-critical-functionality) addition made
//! DURING plan 40-02's execution, not literally listed in that plan's
//! `<action>` text: `POST /api/vault/collections`' `enc_name` field is a
//! real, non-optional, `pv_core::items::encrypt_item_for_collection`-shaped
//! blob (`crates/pv-server/src/routes/collections.rs`'s own doc comment —
//! `encryptItemForCollection(ck, name, id, id, 1)`), and without a way to
//! produce/consume that blob neither this plan's own Task 2 acceptance
//! criterion ("the web app renders the iOS-created collection's decrypted
//! name") nor Task 3's reverse direction (iOS decrypts a web-authored
//! collection's name) can be satisfied — both are hard requirements of
//! *this* plan, not deferrable to 40-03. Plan 40-03 Task 1 was going to add
//! these same two functions (plus `rewrap_item_key_for_collection`, which
//! this file does NOT add — that one genuinely has no caller until 40-03);
//! its executor will find these two already present and should treat that
//! as already-done, not duplicate them. Recorded here AND in
//! `40-02-SUMMARY.md`'s Deviations section so neither reader is surprised.
//!
//! `FfiCollectionKey` exposes NO byte accessor — its only exits are the
//! collection-scoped crypto functions in this file and `seal_collection_key`
//! (T-40-08 in this plan's threat model). Its private `[u8; KEY_LEN]` field
//! is readable from this module's own `#[cfg(test)]` submodule (a
//! descendant of the module that defines it, per ordinary Rust privacy) —
//! that is how the round-trip tests below capture "the original bytes"
//! without needing a public accessor at all.
//!
//! SANCTIONED RAW-BYTES EXITS (Phase 40, plan 40-04, invite channel) — two
//! functions in this module deliberately cross the Swift/Rust boundary as
//! raw bytes, each the counterpart of an exception `pv-wasm`'s own header
//! already documents (`crates/pv-wasm/src/lib.rs:697-706`,
//! `generateInviteSecret`'s comment — the THIRD wasm-side exception, after
//! `randomSalt`/`exportUserKeyForSession`) and mirroring `lib.rs`'s own
//! FFI-03 exception pair on this crate's side:
//!
//! - `generate_invite_secret() -> Vec<u8>` — the invite secret must
//!   literally appear in the URL fragment a human forwards as an invite
//!   link; there is no ciphertext form it could take instead, since nothing
//!   yet exists to encrypt it under at the moment it is generated.
//! - `FfiInviteChannel::proof_for_redemption() -> Vec<u8>` — a bearer
//!   credential (WR-08, `pv_core::invite`'s own module header) presented in
//!   a POST body at redemption time; the server verifies it directly
//!   against its own stored hash, so no other form would let it do its job.
//!
//! Neither exit returns the invite secret itself. `FfiInviteChannel` stores
//! ONLY the raw 32-byte `invite_secret` — never a pre-derived wrap key or
//! proof, mirroring `pv_core::invite`'s own re-derivation design and
//! `WasmInviteChannel`'s recorded decision — and re-derives everything else
//! on demand. The caller MUST capture the URL-safe base64 of the secret
//! BEFORE handing the bytes to `FfiInviteChannel::from_secret`: the channel
//! zeroizes its own copy on construction, and no accessor ever returns the
//! secret again.

use std::sync::Arc;

use pv_core::{
    identity::{
        seal as core_seal, unseal_collection_key as core_unseal_collection_key,
        unwrap_identity_secret_key as core_unwrap_identity_secret_key,
        wrap_identity_secret_key as core_wrap_identity_secret_key, IdentityPublicKey,
        IdentitySecretKey, SealedKey,
    },
    items::{
        decrypt_item_for_collection as core_decrypt_item_for_collection,
        decrypt_item_payload_with_shared_key as core_decrypt_item_payload_with_shared_key,
        encrypt_item_for_collection as core_encrypt_item_for_collection,
        rewrap_item_key_for_collection as core_rewrap_item_key_for_collection,
        unwrap_item_key_for_sharing as core_unwrap_item_key_for_sharing, CollectionKey,
        EncryptedItem,
    },
    keys::{random_bytes, WrappedKey, KEY_LEN},
};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::{FfiError, FfiUserKey};

/// Nieprzezroczysty handle PRYWATNEJ połowy X25519 identity keypair —
/// mirror `pv-wasm`'s `WasmIdentityKey`. Jedyna metoda zwracająca surowe
/// bajty to `public_key_bytes` (klucz PUBLICZNY, publikowalny z założenia,
/// NIE materiał sekretny) — żadna metoda tego typu nie zwraca bajtów klucza
/// prywatnego.
#[derive(uniffi::Object)]
pub struct FfiIdentityKey(pub(crate) IdentitySecretKey);

#[uniffi::export]
impl FfiIdentityKey {
    /// DELIBERATELY `Result`, mirroring `FfiUserKey::generate`'s own
    /// reasoning (`lib.rs`'s module header, WR-01): `IdentitySecretKey::generate`
    /// calls `OsRng.fill_bytes` too, the same genuine (if remote) panic path.
    #[uniffi::constructor]
    pub fn generate() -> Result<Arc<Self>, FfiError> {
        Ok(Arc::new(FfiIdentityKey(IdentitySecretKey::generate())))
    }

    pub fn public_key_bytes(&self) -> Vec<u8> {
        self.0.public_key().to_bytes().to_vec()
    }
}

/// Nieprzezroczysty handle PUBLICZNEJ połowy X25519 identity keypair —
/// mirror `pv-wasm`'s `WasmIdentityPublicKey`. Publiczny z założenia — w
/// przeciwieństwie do `FfiIdentityKey`, surowe bajty mogą przekraczać
/// granicę Swift/Rust w OBIE strony (ten sam precedens co
/// `generate_registration_salt`).
#[derive(uniffi::Object)]
pub struct FfiIdentityPublicKey(pub(crate) IdentityPublicKey);

#[uniffi::export]
impl FfiIdentityPublicKey {
    /// Odrzuca KAŻDĄ długość inną niż dokładnie 32 bajty PRZED delegacją do
    /// `IdentityPublicKey::from_bytes` (które odrzuca 7 znanych small-order
    /// encodings — CR-01, `identity.rs`).
    #[uniffi::constructor]
    pub fn from_bytes(bytes: Vec<u8>) -> Result<Arc<Self>, FfiError> {
        let arr: [u8; KEY_LEN] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| FfiError::InvalidInput("expected 32 bytes".to_string()))?;
        let pk = IdentityPublicKey::from_bytes(arr)?;
        Ok(Arc::new(FfiIdentityPublicKey(pk)))
    }
}

/// DR-40-A: `String` produced by `serde_json::to_string` of the
/// `pv_core::keys::WrappedKey` `wrap_identity_secret_key` returns — never a
/// `Record`. Mirrors `pv-wasm`'s `wrapIdentitySecretKey`.
#[uniffi::export]
pub fn wrap_identity_secret_key(
    uk: &FfiUserKey,
    isk: &FfiIdentityKey,
) -> Result<String, FfiError> {
    let blob = core_wrap_identity_secret_key(&uk.0, &isk.0)?;
    serde_json::to_string(&blob).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

/// Inverse of `wrap_identity_secret_key`. Any malformed `wrapped_json`
/// (including a base64-string-shaped envelope a Swift-side `Codable`
/// default would have produced) returns a catchable `FfiError::InvalidInput`,
/// never a panic — same discipline as `lib.rs`'s `unwrap_user_key_from_json`.
#[uniffi::export]
pub fn unwrap_identity_secret_key(
    uk: &FfiUserKey,
    wrapped_json: String,
) -> Result<Arc<FfiIdentityKey>, FfiError> {
    let blob = serde_json::from_str(&wrapped_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    let isk = core_unwrap_identity_secret_key(&uk.0, &blob)?;
    Ok(Arc::new(FfiIdentityKey(isk)))
}

/// Nieprzezroczysty handle Collection Key — mirror `pv-wasm`'s
/// `WasmCollectionKey`. Żadna metoda tego typu nie zwraca surowych bajtów
/// (T-40-08) — jedyne wyjścia to `seal_collection_key` i
/// `encrypt_item_for_collection`/`decrypt_item_for_collection` poniżej.
#[derive(Zeroize, ZeroizeOnDrop, uniffi::Object)]
pub struct FfiCollectionKey([u8; KEY_LEN]);

#[uniffi::export]
impl FfiCollectionKey {
    /// DELIBERATELY `Result` — same `OsRng.fill_bytes` panic path as
    /// `FfiIdentityKey::generate`/`FfiUserKey::generate`.
    #[uniffi::constructor]
    pub fn generate() -> Result<Arc<Self>, FfiError> {
        let ck = CollectionKey::generate();
        Ok(Arc::new(FfiCollectionKey(*ck.expose())))
    }
}

/// Zapieczętowuje `ck` pod PUBLICZNYM kluczem recipienta — przyjmuje
/// `&FfiIdentityPublicKey`, NIE `&FfiIdentityKey` (sender z definicji nie
/// posiada klucza prywatnego recipienta). DR-40-A: `String` z `serde_json`
/// tej samej `pv_core::identity::SealedKey`.
#[uniffi::export]
pub fn seal_collection_key(
    recipient_pk: &FfiIdentityPublicKey,
    ck: &FfiCollectionKey,
) -> Result<String, FfiError> {
    let sealed = core_seal(&recipient_pk.0, &ck.0)?;
    serde_json::to_string(&sealed).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

/// Odpieczętowuje `sealed_json` pod `my_identity_key`. Deleguje do
/// `pv_core::identity::unseal_collection_key` — długość plaintextu
/// walidowana raz, w pv-core.
#[uniffi::export]
pub fn unseal_collection_key(
    my_identity_key: &FfiIdentityKey,
    sealed_json: String,
) -> Result<Arc<FfiCollectionKey>, FfiError> {
    let sealed: SealedKey = serde_json::from_str(&sealed_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    let collection_key = core_unseal_collection_key(&my_identity_key.0, &sealed)?;
    Ok(Arc::new(FfiCollectionKey(*collection_key.expose())))
}

// --- Rule-2 addition: collection-scoped item crypto, minimal surface -----
//
// See this file's module header for why these two (and NOT
// `rewrap_item_key_for_collection`/`seal_item_key_for_recipient`/
// `decrypt_item_with_shared_key`, which stay plan 40-03's job) exist here.

/// Encrypts `plaintext` under a Collection Key — mirrors `pv-wasm`'s
/// `encryptItemForCollection` 1:1 in argument order. DR-40-A: `String` via
/// `serde_json` of the resulting `EncryptedItem`.
#[uniffi::export]
pub fn encrypt_item_for_collection(
    ck: &FfiCollectionKey,
    plaintext: String,
    collection_id: String,
    item_id: String,
    revision: u32,
) -> Result<String, FfiError> {
    let collection_key = CollectionKey::from_bytes(ck.0);
    let item = core_encrypt_item_for_collection(
        &collection_key,
        plaintext.as_bytes(),
        &collection_id,
        &item_id,
        revision,
    )?;
    serde_json::to_string(&item).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

/// Inverse of `encrypt_item_for_collection` — mirrors `pv-wasm`'s
/// `decryptItemForCollection` 1:1. Moves the plaintext out of the
/// `Zeroizing` buffer with `mem::take` before `String::from_utf8`, exactly
/// like `lib.rs`'s `decrypt_item` (WR-12) — never `.clone()`.
#[uniffi::export]
pub fn decrypt_item_for_collection(
    ck: &FfiCollectionKey,
    item_json: String,
    collection_id: String,
    item_id: String,
    revision: u32,
) -> Result<String, FfiError> {
    let collection_key = CollectionKey::from_bytes(ck.0);
    let item: EncryptedItem = serde_json::from_str(&item_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    let mut plaintext = core_decrypt_item_for_collection(
        &collection_key,
        &item,
        &collection_id,
        &item_id,
        revision,
    )?;
    let bytes = std::mem::take(&mut *plaintext);
    String::from_utf8(bytes).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

/// Rewrap-only: przenosi Cipher Key itemu spod OLD `FfiCollectionKey`a pod
/// NEW, nigdy nie dotykając `enc_data` (KEY-02/SC 6 — "removing a member
/// rewraps keys only") — mirrors `pv-wasm`'s `rewrapItemKeyForCollection`
/// 1:1. Sygnatura celowo nie przyjmuje żadnego argumentu w kształcie
/// `enc_data` — to jest sama część dowodu SC 6: dotknięcie payloadu jest
/// niemożliwe na poziomie typu, nie tylko dyscypliny runtime'owej.
#[uniffi::export]
pub fn rewrap_item_key_for_collection(
    old_ck: &FfiCollectionKey,
    new_ck: &FfiCollectionKey,
    old_enc_key_json: String,
    collection_id: String,
    item_id: String,
) -> Result<String, FfiError> {
    let old_collection_key = CollectionKey::from_bytes(old_ck.0);
    let new_collection_key = CollectionKey::from_bytes(new_ck.0);
    let old_enc_key: WrappedKey = serde_json::from_str(&old_enc_key_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    let new_enc_key = core_rewrap_item_key_for_collection(
        &old_collection_key,
        &new_collection_key,
        &old_enc_key,
        &collection_id,
        &item_id,
    )?;
    serde_json::to_string(&new_enc_key).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

/// SHARE-02's write-side primitive for iOS: odpakowuje `uk`iem Cipher Key
/// POJEDYNCZEGO personalnego itemu z jego własnego `enc_key`, po czym
/// zapieczętowuje ten Cipher Key pod `recipient_pk` — mirrors `pv-wasm`'s
/// `sealItemKeyForRecipient` 1:1 w kolejności argumentów. `enc_key_json` to
/// WYŁĄCZNIE `EncryptedItem.enc_key` (nigdy `enc_data`) — ta sama sygnaturowa
/// dyscyplina co `rewrap_item_key_for_collection`, które strukturalnie nie
/// przyjmuje payloadu jako argumentu.
///
/// T-40-11: odzyskane surowe bajty Cipher Key NIGDY nie opuszczają
/// `Zeroizing` — nie są kopiowane do żadnego lokalnego `Vec<u8>`/`[u8; 32]`,
/// który sam nie jest `Zeroizing`, i nigdy nie przekraczają granicy FFI w
/// żadnym kierunku (tylko `identity::seal`'s wynik, ciphertext, przekracza).
#[uniffi::export]
pub fn seal_item_key_for_recipient(
    uk: &FfiUserKey,
    enc_key_json: String,
    item_id: String,
    recipient_pk: &FfiIdentityPublicKey,
) -> Result<String, FfiError> {
    let enc_key: WrappedKey = serde_json::from_str(&enc_key_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    let item_key_bytes: Zeroizing<[u8; KEY_LEN]> =
        core_unwrap_item_key_for_sharing(&uk.0, &enc_key, &item_id)?;
    let sealed = core_seal(&recipient_pk.0, item_key_bytes.as_slice())?;
    serde_json::to_string(&sealed).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

/// SHARE-02's read-side counterpart of `seal_item_key_for_recipient`:
/// odszyfrowuje `enc_data` bezpośrednio udostępnionego (`item_shares`)
/// personalnego itemu przy użyciu Cipher Key już odzyskanego po stronie
/// recipienta (typowo via `unseal_collection_key` na jego własnym
/// `item_shares.sealed_key`) — mirrors `pv-wasm`'s `decryptItemWithSharedKey`
/// 1:1. `ck` tutaj jest WYŁĄCZNIE nośnikiem 32 nieprzezroczystych bajtów;
/// nazwa typu NIE implikuje przynależności do kolekcji.
///
/// Ta ścieżka CELOWO używa PERSONALNEGO AAD
/// (`decrypt_item_payload_with_shared_key`), NIE scope'owanego kolekcyjnie —
/// `enc_data` jest nietknięte przez sharing (SC 6), więc recipient musi
/// przedstawić DOKŁADNIE TEN SAM AAD, pod którym właściciel je zaszyfrował.
/// Przyszły reader, który "poprawi" to na AAD kolekcyjne, zepsuje KAŻDY
/// bezpośredni share.
#[uniffi::export]
pub fn decrypt_item_with_shared_key(
    ck: &FfiCollectionKey,
    enc_data_json: String,
    item_id: String,
    revision: u32,
) -> Result<String, FfiError> {
    let enc_data: WrappedKey = serde_json::from_str(&enc_data_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    let mut plaintext =
        core_decrypt_item_payload_with_shared_key(&ck.0, &enc_data, &item_id, revision)?;
    let bytes = std::mem::take(&mut *plaintext);
    String::from_utf8(bytes).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

// --- Invite channel (Phase 40, plan 40-04) --------------------------------
//
// See this file's module header (SANCTIONED RAW-BYTES EXITS) for why
// `generate_invite_secret` and `FfiInviteChannel::proof_for_redemption` are
// the only two raw-byte exits this section adds.

/// Generuje świeży 32-bajtowy `invite_secret` — mirror `pv-wasm`'s
/// `generateInviteSecret` (`crates/pv-wasm/src/lib.rs:697-706`). Ten sam
/// `random_bytes` co reszta tego pliku/`pv-core`'s CSPRNG — żadna nowa
/// logika losowości. `Vec<u8>` bez `Result`, ten sam kształt co
/// `generate_registration_salt` (`lib.rs`) — jawna losowość, nie materiał
/// klucza, ten sam precedens.
#[uniffi::export]
pub fn generate_invite_secret() -> Vec<u8> {
    random_bytes(KEY_LEN)
}

/// Nieprzezroczysty handle kanału zaproszenia (Phase 40, `pv_core::invite`)
/// — mirror `pv-wasm`'s `WasmInviteChannel`. Trzyma WYŁĄCZNIE surowy
/// `invite_secret`, NIGDY pre-derived wrap key ani proof —
/// `wrap_collection_key_for_invite`/`unwrap_collection_key_for_invite`/
/// `derive_invite_proof`/`hash_invite_proof` same wewnętrznie na nowo
/// derywują to, czego potrzebują z sekretu + `invite_id`; zadaniem tego
/// handle'a jest tylko przechowywać to, czego te funkcje potrzebują, nie
/// reimplementować ich derywacji. `invite_id` jest jawnie NIE-sekretny
/// (`#[zeroize(skip)]`), `invite_secret` zeruje się przy Drop. Żadna metoda
/// tego structu nie zwraca `invite_secret`'s bajtów wprost — wyłącznie jego
/// jednokierunkowe derywacje przekraczają granicę.
#[derive(Zeroize, ZeroizeOnDrop, uniffi::Object)]
pub struct FfiInviteChannel {
    #[zeroize(skip)]
    invite_id: String,
    invite_secret: [u8; KEY_LEN],
}

#[uniffi::export]
impl FfiInviteChannel {
    /// Buduje kanał WYŁĄCZNIE z surowych bajtów sekretu (własnego wyjścia
    /// `generate_invite_secret`, lub fragmentu linku zaproszenia) — NIGDY z
    /// samego `invite_id`, bo `invite_id` nie pozwala odtworzyć ani wrap
    /// key, ani proof. Odrzuca KAŻDĄ długość inną niż dokładnie 32 bajty.
    /// Derywuje `invite_id` raz, przy konstrukcji.
    #[uniffi::constructor]
    pub fn from_secret(secret: Vec<u8>) -> Result<Arc<Self>, FfiError> {
        let arr: [u8; KEY_LEN] = secret
            .as_slice()
            .try_into()
            .map_err(|_| FfiError::InvalidInput("expected 32 bytes".to_string()))?;
        let invite_id = pv_core::invite::derive_invite_id(&arr);
        Ok(Arc::new(FfiInviteChannel { invite_id, invite_secret: arr }))
    }

    /// Jedyne pole tego handle'a, które NIE jest sekretem — deterministyczne:
    /// ten sam `invite_secret` zawsze produkuje ten sam `invite_id`,
    /// niezależnie od tego, na którym niezależnie skonstruowanym handle'u
    /// zostanie wywołane.
    pub fn invite_id(&self) -> String {
        self.invite_id.clone()
    }

    /// Wartość, którą klient ZAPRASZAJĄCEGO wysyła jako `proof_hash` przy
    /// tworzeniu zaproszenia — `SHA-256(invite_proof)`, digest a nie
    /// sekret. NIE mylić z `proof_for_redemption`.
    pub fn proof_hash_for_creation(&self) -> Vec<u8> {
        let proof = pv_core::invite::derive_invite_proof(&self.invite_secret);
        pv_core::invite::hash_invite_proof(&proof).to_vec()
    }

    /// Surowa (NIE zahaszowana) wartość, którą klient ZAPROSZONEGO
    /// prezentuje przy odbiorze zaproszenia — drugi sankcjonowany
    /// raw-bajtowy wyjątek tego modułu (patrz nagłówek pliku). WR-08: bearer
    /// credential.
    pub fn proof_for_redemption(&self) -> Vec<u8> {
        pv_core::invite::derive_invite_proof(&self.invite_secret).to_vec()
    }

    /// Zawija `ck` pod `invite_wrap_key` derywowanym z tego kanału,
    /// AAD-bound do `self.invite_id`. DR-40-A: `String` przez `serde_json`.
    pub fn wrap_collection_key(&self, ck: &FfiCollectionKey) -> Result<String, FfiError> {
        let blob = pv_core::invite::wrap_collection_key_for_invite(
            &self.invite_secret,
            &self.invite_id,
            &ck.0,
        )?;
        serde_json::to_string(&blob).map_err(|e| FfiError::InvalidInput(e.to_string()))
    }

    /// Odwrotność `wrap_collection_key`. Na kanale zbudowanym z INNEGO
    /// sekretu (a więc z innym `invite_id`, więc inną AAD) to zawodzi
    /// zamknięte.
    pub fn unwrap_collection_key(
        &self,
        wrapped_json: String,
    ) -> Result<Arc<FfiCollectionKey>, FfiError> {
        let blob: WrappedKey = serde_json::from_str(&wrapped_json)
            .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
        let collection_key = pv_core::invite::unwrap_collection_key_for_invite(
            &self.invite_secret,
            &self.invite_id,
            &blob,
        )?;
        Ok(Arc::new(FfiCollectionKey(collection_key)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pv_core::keys::NONCE_LEN;

    // --- Task 1 tests ------------------------------------------------

    /// Captures the original 32 public-key bytes as an owned array BEFORE
    /// the wrap call (never re-derived by the code under test).
    #[test]
    fn identity_keypair_wrap_unwrap_roundtrip() {
        let uk = FfiUserKey::generate().expect("generate is infallible today");
        let isk = FfiIdentityKey::generate().expect("generate is infallible today");
        let expected_pk_bytes = isk.public_key_bytes();

        let wrapped_json =
            wrap_identity_secret_key(&uk, &isk).expect("wrap_identity_secret_key should succeed");
        let unwrapped = unwrap_identity_secret_key(&uk, wrapped_json)
            .expect("unwrap_identity_secret_key should succeed");

        assert_eq!(unwrapped.public_key_bytes(), expected_pk_bytes);
    }

    #[test]
    fn identity_public_key_rejects_small_order_and_wrong_length() {
        let too_short = vec![0u8; 31];
        assert!(FfiIdentityPublicKey::from_bytes(too_short).is_err());

        let all_zero = vec![0u8; KEY_LEN];
        assert!(FfiIdentityPublicKey::from_bytes(all_zero).is_err());
    }

    #[test]
    fn unwrap_identity_secret_key_with_wrong_user_key_errors() {
        let uk = FfiUserKey::generate().expect("generate is infallible today");
        let other_uk = FfiUserKey::generate().expect("generate is infallible today");
        let isk = FfiIdentityKey::generate().expect("generate is infallible today");

        let wrapped_json =
            wrap_identity_secret_key(&uk, &isk).expect("wrap_identity_secret_key should succeed");
        let result = unwrap_identity_secret_key(&other_uk, wrapped_json);
        assert!(result.is_err());
    }

    // --- Task 2 tests ------------------------------------------------

    /// Captures the original Collection Key bytes as an owned array BEFORE
    /// the seal call, via this module's own private field (the test
    /// submodule is a descendant of the module defining `FfiCollectionKey`,
    /// so ordinary Rust privacy grants it access) — `FfiCollectionKey` has
    /// no public byte accessor by design (T-40-08).
    #[test]
    fn seal_unseal_collection_key_roundtrip_on_literal_bytes() {
        let recipient = FfiIdentityKey::generate().expect("generate is infallible today");
        let recipient_pk_bytes = recipient.public_key_bytes();
        let recipient_pk = FfiIdentityPublicKey::from_bytes(recipient_pk_bytes)
            .expect("a real generated public key must never be small-order");

        let ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let original: [u8; KEY_LEN] = ck.0;

        let sealed_json =
            seal_collection_key(&recipient_pk, &ck).expect("seal_collection_key should succeed");
        let unsealed = unseal_collection_key(&recipient, sealed_json)
            .expect("unseal_collection_key should succeed");

        assert_eq!(unsealed.0, original);
    }

    #[test]
    fn unseal_collection_key_rejects_small_order_ephemeral_pk() {
        let recipient = FfiIdentityKey::generate().expect("generate is infallible today");
        let forged = SealedKey {
            ephemeral_pk: [0u8; KEY_LEN], // all-zero: order-1 identity point.
            nonce: vec![0u8; NONCE_LEN],
            ciphertext: vec![0u8; 48],
        };
        let forged_json = serde_json::to_string(&forged).expect("SealedKey always serializes");

        let result = unseal_collection_key(&recipient, forged_json);
        assert!(result.is_err());
    }

    #[test]
    fn unseal_collection_key_with_other_recipient_key_errors() {
        let recipient_a = FfiIdentityKey::generate().expect("generate is infallible today");
        let recipient_b = FfiIdentityKey::generate().expect("generate is infallible today");
        let recipient_a_pk_bytes = recipient_a.public_key_bytes();
        let recipient_a_pk = FfiIdentityPublicKey::from_bytes(recipient_a_pk_bytes)
            .expect("a real generated public key must never be small-order");

        let ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let sealed_json = seal_collection_key(&recipient_a_pk, &ck)
            .expect("seal_collection_key should succeed");

        let result = unseal_collection_key(&recipient_b, sealed_json);
        assert!(result.is_err());
    }

    // --- Rule-2 addition tests (encrypt/decrypt_item_for_collection) -

    #[test]
    fn collection_item_encrypt_decrypt_roundtrip() {
        let ck = FfiCollectionKey::generate().expect("generate is infallible today");
        // Multi-byte UTF-8 (🔑) + an embedded NUL, per this plan's own
        // acceptance criteria (Task 1) — a truncation or re-encoding bug
        // would be visible in either.
        let plaintext = "{\"type\":\"note\",\"body\":\"sharing fixture 🔑\\u0000tail\"}".to_string();

        let item_json = encrypt_item_for_collection(
            &ck,
            plaintext.clone(),
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
            1,
        )
        .expect("encrypt_item_for_collection should succeed");

        let decrypted = decrypt_item_for_collection(
            &ck,
            item_json,
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
            1,
        )
        .expect("decrypt_item_for_collection should succeed");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn collection_item_decrypt_rejects_wrong_collection_id() {
        let ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let item_json = encrypt_item_for_collection(
            &ck,
            "fixture".to_string(),
            "collection-a".to_string(),
            "item-fixture".to_string(),
            1,
        )
        .expect("encrypt_item_for_collection should succeed");

        let result = decrypt_item_for_collection(
            &ck,
            item_json,
            "collection-b".to_string(),
            "item-fixture".to_string(),
            1,
        );
        assert!(result.is_err());
    }

    #[test]
    fn collection_item_decrypt_rejects_wrong_item_id() {
        let ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let item_json = encrypt_item_for_collection(
            &ck,
            "fixture".to_string(),
            "collection-fixture".to_string(),
            "item-a".to_string(),
            1,
        )
        .expect("encrypt_item_for_collection should succeed");

        let result = decrypt_item_for_collection(
            &ck,
            item_json,
            "collection-fixture".to_string(),
            "item-b".to_string(),
            1,
        );
        assert!(result.is_err());
    }

    #[test]
    fn collection_item_decrypt_rejects_wrong_revision() {
        let ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let item_json = encrypt_item_for_collection(
            &ck,
            "fixture".to_string(),
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
            1,
        )
        .expect("encrypt_item_for_collection should succeed");

        let result = decrypt_item_for_collection(
            &ck,
            item_json,
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
            2,
        );
        assert!(result.is_err());
    }

    /// Proves the rewrap-only guarantee end to end through the FFI surface:
    /// the SAME `enc_data` string (byte-identical) decrypts under `new_ck`
    /// afterward and no longer decrypts under `old_ck`.
    #[test]
    fn rewrap_item_key_moves_item_to_new_collection_key() {
        let old_ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let new_ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let plaintext = "{\"type\":\"note\",\"body\":\"rewrap fixture 🔑\\u0000tail\"}".to_string();

        let item_json = encrypt_item_for_collection(
            &old_ck,
            plaintext.clone(),
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
            1,
        )
        .expect("encrypt_item_for_collection should succeed");
        let item: EncryptedItem =
            serde_json::from_str(&item_json).expect("encrypt_item_for_collection's own output must parse");
        let old_enc_key_json =
            serde_json::to_string(&item.enc_key).expect("WrappedKey always serializes");
        let original_enc_data_json =
            serde_json::to_string(&item.enc_data).expect("WrappedKey always serializes");

        let new_enc_key_json = rewrap_item_key_for_collection(
            &old_ck,
            &new_ck,
            old_enc_key_json,
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
        )
        .expect("rewrap_item_key_for_collection should succeed");
        let new_enc_key: WrappedKey =
            serde_json::from_str(&new_enc_key_json).expect("rewrap_item_key_for_collection's own output must parse");

        let rewrapped_item = EncryptedItem { enc_key: new_enc_key, enc_data: item.enc_data.clone() };
        // enc_data moved, not re-derived — byte-identical to what
        // encrypt_item_for_collection produced (acceptance criterion).
        let rewrapped_enc_data_json =
            serde_json::to_string(&rewrapped_item.enc_data).expect("WrappedKey always serializes");
        assert_eq!(rewrapped_enc_data_json, original_enc_data_json);
        let rewrapped_item_json =
            serde_json::to_string(&rewrapped_item).expect("EncryptedItem always serializes");

        let decrypted_under_new = decrypt_item_for_collection(
            &new_ck,
            rewrapped_item_json.clone(),
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
            1,
        )
        .expect("decrypt under new_ck should succeed");
        assert_eq!(decrypted_under_new, plaintext);

        let result_under_old = decrypt_item_for_collection(
            &old_ck,
            rewrapped_item_json,
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
            1,
        );
        assert!(result_under_old.is_err());
    }

    // --- Task 2 tests (direct-share item-key path) -------------------

    /// End-to-end SHARE-02 direct-share path through the real FFI: owner
    /// unwraps their personal item's Cipher Key and seals it to a SECOND,
    /// independently generated recipient identity key; the recipient
    /// unseals and decrypts `enc_data` (untouched by sharing, SC 6) and
    /// recovers the ORIGINAL plaintext byte-for-byte.
    #[test]
    fn seal_item_key_for_recipient_then_recipient_decrypts_payload() {
        use pv_core::items::encrypt_item as core_encrypt_item_personal;

        let owner_uk = FfiUserKey::generate().expect("generate is infallible today");
        let recipient = FfiIdentityKey::generate().expect("generate is infallible today");
        let recipient_pk_bytes = recipient.public_key_bytes();
        let recipient_pk = FfiIdentityPublicKey::from_bytes(recipient_pk_bytes)
            .expect("a real generated public key must never be small-order");

        let plaintext = "{\"type\":\"login\",\"password\":\"s3cret 🔑\\u0000tail\"}".to_string();
        let item = core_encrypt_item_personal(&owner_uk.0, plaintext.as_bytes(), "item-fixture", 1)
            .expect("encrypt_item should succeed");
        let enc_key_json =
            serde_json::to_string(&item.enc_key).expect("WrappedKey always serializes");
        let enc_data_json =
            serde_json::to_string(&item.enc_data).expect("WrappedKey always serializes");

        let sealed_json = seal_item_key_for_recipient(
            &owner_uk,
            enc_key_json,
            "item-fixture".to_string(),
            &recipient_pk,
        )
        .expect("seal_item_key_for_recipient should succeed");
        let recovered_ck = unseal_collection_key(&recipient, sealed_json)
            .expect("unseal_collection_key should succeed");

        let decrypted = decrypt_item_with_shared_key(
            &recovered_ck,
            enc_data_json,
            "item-fixture".to_string(),
            1,
        )
        .expect("decrypt_item_with_shared_key should succeed");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn decrypt_item_with_shared_key_rejects_wrong_revision() {
        use pv_core::items::encrypt_item as core_encrypt_item_personal;

        let owner_uk = FfiUserKey::generate().expect("generate is infallible today");
        let recipient = FfiIdentityKey::generate().expect("generate is infallible today");
        let recipient_pk_bytes = recipient.public_key_bytes();
        let recipient_pk = FfiIdentityPublicKey::from_bytes(recipient_pk_bytes)
            .expect("a real generated public key must never be small-order");

        // revision 0, deliberately: matches the constant the falsification
        // transcript below hardcodes, so that mutation reproduces the exact
        // false-positive pass this test exists to catch.
        let item = core_encrypt_item_personal(&owner_uk.0, b"secret", "item-fixture", 0)
            .expect("encrypt_item should succeed");
        let enc_key_json =
            serde_json::to_string(&item.enc_key).expect("WrappedKey always serializes");
        let enc_data_json =
            serde_json::to_string(&item.enc_data).expect("WrappedKey always serializes");

        let sealed_json = seal_item_key_for_recipient(
            &owner_uk,
            enc_key_json,
            "item-fixture".to_string(),
            &recipient_pk,
        )
        .expect("seal_item_key_for_recipient should succeed");
        let recovered_ck = unseal_collection_key(&recipient, sealed_json)
            .expect("unseal_collection_key should succeed");

        let result = decrypt_item_with_shared_key(
            &recovered_ck,
            enc_data_json,
            "item-fixture".to_string(),
            2,
        );
        assert!(result.is_err());
    }

    // --- Task 1 tests (invite channel) --------------------------------

    #[test]
    fn invite_secret_is_32_bytes() {
        let secret = generate_invite_secret();
        assert_eq!(secret.len(), KEY_LEN);
    }

    #[test]
    fn invite_channel_from_secret_rejects_wrong_length() {
        let too_short = vec![0u8; 31];
        assert!(FfiInviteChannel::from_secret(too_short).is_err());

        let too_long = vec![0u8; 33];
        assert!(FfiInviteChannel::from_secret(too_long).is_err());
    }

    /// Compares against `pv_core::invite::derive_invite_id` called
    /// independently on the same fixed 32-byte literal -- never the
    /// wrapper compared to itself.
    #[test]
    fn invite_id_matches_pv_core_derivation() {
        let secret: [u8; KEY_LEN] = [0x5cu8; KEY_LEN];
        let expected = pv_core::invite::derive_invite_id(&secret);

        let channel = FfiInviteChannel::from_secret(secret.to_vec())
            .expect("from_secret should succeed on a 32-byte literal");

        assert_eq!(channel.invite_id(), expected);
    }

    /// Wraps a `FfiCollectionKey` under the invite channel, unwraps it on
    /// the SAME channel, and proves the recovered key is functionally
    /// identical by decrypting a fixture that was encrypted under the
    /// ORIGINAL key -- not merely comparing raw bytes to raw bytes.
    #[test]
    fn invite_wrap_unwrap_collection_key_roundtrip() {
        let secret = generate_invite_secret();
        let channel = FfiInviteChannel::from_secret(secret)
            .expect("from_secret should succeed on generate_invite_secret's own output");

        let ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let original: [u8; KEY_LEN] = ck.0;

        let plaintext = "{\"type\":\"note\",\"body\":\"invite fixture 🔑\\u0000tail\"}".to_string();
        let item_json = encrypt_item_for_collection(
            &ck,
            plaintext.clone(),
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
            1,
        )
        .expect("encrypt_item_for_collection should succeed");

        let wrapped_json = channel
            .wrap_collection_key(&ck)
            .expect("wrap_collection_key should succeed");
        let recovered = channel
            .unwrap_collection_key(wrapped_json)
            .expect("unwrap_collection_key should succeed");

        assert_eq!(recovered.0, original);

        let decrypted = decrypt_item_for_collection(
            &recovered,
            item_json,
            "collection-fixture".to_string(),
            "item-fixture".to_string(),
            1,
        )
        .expect(
            "decrypting a fixture encrypted under the original ck, using the recovered ck, \
             must succeed",
        );
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn invite_unwrap_with_different_secret_errors() {
        let secret_a = generate_invite_secret();
        let secret_b = generate_invite_secret();
        let channel_a = FfiInviteChannel::from_secret(secret_a)
            .expect("from_secret should succeed on generate_invite_secret's own output");
        let channel_b = FfiInviteChannel::from_secret(secret_b)
            .expect("from_secret should succeed on generate_invite_secret's own output");

        let ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let wrapped_json = channel_a
            .wrap_collection_key(&ck)
            .expect("wrap_collection_key should succeed");

        let result = channel_b.unwrap_collection_key(wrapped_json);
        assert!(result.is_err());
    }

    /// Proves the AAD binding is to `invite_id` SPECIFICALLY, not merely
    /// "some channel-derived value": forges a blob wrapped under the SAME
    /// secret but a DIFFERENT invite_id (via `pv_core::invite` directly,
    /// bypassing `from_secret`'s own correct re-derivation), then attempts
    /// to unwrap it through the real channel (whose `invite_id` is the
    /// correct derivation) -- must fail. A control unwrap of the
    /// correctly-wrapped blob on the same channel confirms the failure is
    /// about the invite_id mismatch, not a broken channel.
    #[test]
    fn invite_unwrap_with_different_invite_id_errors() {
        let secret = generate_invite_secret();
        let channel = FfiInviteChannel::from_secret(secret.clone())
            .expect("from_secret should succeed on generate_invite_secret's own output");

        let ck = FfiCollectionKey::generate().expect("generate is infallible today");
        let wrapped_json = channel
            .wrap_collection_key(&ck)
            .expect("wrap_collection_key should succeed");

        let mut secret_arr = [0u8; KEY_LEN];
        secret_arr.copy_from_slice(&secret);
        let forged_wrapped = pv_core::invite::wrap_collection_key_for_invite(
            &secret_arr,
            "not-the-real-invite-id",
            &ck.0,
        )
        .expect("wrap_collection_key_for_invite should succeed");
        let forged_json =
            serde_json::to_string(&forged_wrapped).expect("WrappedKey always serializes");

        let result = channel.unwrap_collection_key(forged_json);
        assert!(result.is_err());

        // Control: the correctly-wrapped blob still unwraps fine on the
        // same channel -- the failure above is specifically about the
        // invite_id mismatch, not a broken channel.
        let recovered = channel.unwrap_collection_key(wrapped_json);
        assert!(recovered.is_ok());
    }
}
