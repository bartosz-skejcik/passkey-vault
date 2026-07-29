//! X25519 identity keypair — konto's asymmetryczna tożsamość.
//!
//! Prywatna połowa (`IdentitySecretKey`) jest wrapowana pod `UserKey` (nigdy
//! nie opuszcza klienta w postaci jawnej); publiczna połowa
//! (`IdentityPublicKey`) jest z założenia publikowalna — służy innym
//! recipientom do zapieczętowania (seal) współdzielonych Collection Keys pod
//! ten klucz (Plan 21-04). Generowanie jest wyłącznie client-side, bo
//! zawinięcie klucza prywatnego wymaga `UserKey`, którego serwer nigdy nie
//! widzi — twarda konsekwencja granicy zero-knowledge.
//!
//! **Zeroize gap (udokumentowane świadomie, patrz KEY-05 decision record
//! oraz 21-RESEARCH.md "Zeroize Gap"):** `crypto_box::SecretKey`'s własny
//! `Drop` zeruje wyłącznie wewnętrzne pole `scalar`, nigdy surowej tablicy
//! 32 bajtów. Dlatego `IdentitySecretKey` przechowuje własną tablicę bajtów
//! z własnym `Zeroize`/`ZeroizeOnDrop`, zamiast trzymać długożyjący
//! `crypto_box::SecretKey` jako pole struktury — ten ostatni jest
//! rekonstruowany tranzytywnie per wywołanie (`as_crypto_box`), nigdy
//! zapisywany na stałe.

use chacha20poly1305::aead::OsRng;
// `crypto_box` re-exports the `aead` crate verbatim (`pub use aead;`), tak
// samo jak `chacha20poly1305::aead` — to TA SAMA `aead` linia w grafie
// zależności (patrz 21-RESEARCH.md "Correction 2"), więc te dwa importy nie
// są konfliktowe, tylko dwie ścieżki do tych samych trait'ów.
use crypto_box::aead::{Aead, AeadCore};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::keys::{aead_open, aead_seal, UserKey, WrappedKey, KEY_LEN, NONCE_LEN};
use crate::CryptoError;

/// Domain separation dla wrapowania `IdentitySecretKey` pod `UserKey` —
/// przekazywane jako AEAD associated data do `aead_seal`/`aead_open`
/// (analogicznie do `wrap_user_key`'s `b"pv:uk:v1"` w `keys.rs`), NIE jako
/// HKDF `info` string — ta sama konwencja `INFO_*` pokrywa oba użycia w tym
/// codebase.
pub const INFO_X25519_SK_WRAP: &[u8] = b"pv:x25519-sk-wrap:v1";

/// Prywatna połowa X25519 identity keypair. Nigdy nie opuszcza klienta w
/// postaci jawnej — wrapowana pod `UserKey` (patrz `wrap_identity_secret_key`).
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct IdentitySecretKey([u8; KEY_LEN]);

impl IdentitySecretKey {
    pub fn generate() -> Self {
        let sk = crypto_box::SecretKey::generate(&mut OsRng);
        Self(sk.to_bytes())
    }

    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self(bytes)
    }

    /// Rekonstruuje tranzytywny `crypto_box::SecretKey` per wywołanie —
    /// nigdy nie przechowywany jako pole struktury (patrz moduł doc comment
    /// "Zeroize gap").
    fn as_crypto_box(&self) -> crypto_box::SecretKey {
        crypto_box::SecretKey::from_bytes(self.0)
    }

    pub fn public_key(&self) -> IdentityPublicKey {
        IdentityPublicKey(self.as_crypto_box().public_key().to_bytes())
    }
}

/// Publiczna połowa X25519 identity keypair. Publikowalna z założenia —
/// bezpiecznie derive'ować `Debug`/`Eq`, w przeciwieństwie do
/// `IdentitySecretKey`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityPublicKey([u8; KEY_LEN]);

impl IdentityPublicKey {
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self(bytes)
    }

    pub fn to_bytes(&self) -> [u8; KEY_LEN] {
        self.0
    }

    #[allow(dead_code)]
    fn as_crypto_box(&self) -> crypto_box::PublicKey {
        crypto_box::PublicKey::from(self.0)
    }
}

/// Wrap `IdentitySecretKey` pod `UserKey` — ponowne użycie istniejącego
/// symetrycznego `aead_seal`, żadnej nowej kryptografii.
pub fn wrap_identity_secret_key(
    uk: &UserKey,
    isk: &IdentitySecretKey,
) -> Result<WrappedKey, CryptoError> {
    aead_seal(uk.expose(), &isk.0, INFO_X25519_SK_WRAP)
}

/// Unwrap `IdentitySecretKey` spod `UserKey`. Odrzuca blob, którego
/// odszyfrowany plaintext nie ma dokładnie `KEY_LEN` (32) bajtów —
/// analogicznie do `unwrap_user_key`'s length check w `keys.rs`.
pub fn unwrap_identity_secret_key(
    uk: &UserKey,
    blob: &WrappedKey,
) -> Result<IdentitySecretKey, CryptoError> {
    let mut plain = aead_open(uk.expose(), blob, INFO_X25519_SK_WRAP)?;
    if plain.len() != KEY_LEN {
        plain.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&plain);
    plain.zeroize();
    Ok(IdentitySecretKey::from_bytes(k))
}

/// Zapieczętowany (anonymous-sender sealed-box) blob — typowo 32-bajtowy
/// Collection Key zapieczętowany pod `IdentityPublicKey` jednego recipienta.
/// Nowy sibling `keys::WrappedKey`, NIE zamiennik — `WrappedKey { nonce,
/// ciphertext }` zostaje bez zmian dla symetrycznych recipientów
/// (hasło/PRF); `SealedKey` dodaje `ephemeral_pk`, bo ten layer jest
/// asymetryczny (Plan 21-04, KEY-02).
///
/// `ephemeral_pk` jest celowo `[u8; KEY_LEN]`, NIE `Vec<u8>` jak
/// `nonce`/`ciphertext` — publiczny klucz X25519 ma zawsze dokładnie 32
/// bajty, więc niepoprawna długość jest niemożliwością na etapie kompilacji
/// (typ po prostu się nie skompiluje z innym rozmiarem tablicy), zamiast
/// być runtime-checkiem jak dla `nonce` w `unseal` poniżej.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SealedKey {
    pub ephemeral_pk: [u8; KEY_LEN],
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// Zapieczętuj `plaintext` (typowo: 32-bajtowy Collection Key) pod
/// `IdentityPublicKey` recipienta — anonymous-sender sealed box (KEY-02).
///
/// Świeży, jednorazowy ephemeralny `crypto_box::SecretKey` jest generowany
/// per wywołanie jako zmienna lokalna funkcji — nigdy nie jest polem
/// struktury, nigdy nie jest zwracany, nigdy nie jest cache'owany ani
/// ponownie użyty między dwoma wywołaniami `seal()`. To JEDYNY fragment
/// kompozycji kryptograficznej, który ten crate pisze ręcznie — `crypto_box`
/// nie ma wbudowanego `seal()` dla `ChaChaBox` (tylko dla odrzuconego,
/// zahardkodowanego na `SalsaBox` opcjonalnego `seal` feature, patrz KEY-05
/// decision record oraz 21-RESEARCH.md "Correction 3" — świadomie
/// znalezione i odrzucone, nie przeoczone).
///
/// UWAGA: `ChaChaBox` odrzuca niepuste associated data (zweryfikowane
/// względem źródeł crypto_box 0.9.1, patrz test
/// `chachabox_rejects_nonempty_aad` poniżej) — celowo NIE dodawaj tu
/// parametru `aad`. Scope-binding dla itemów w zakresie kolekcji
/// (collection_id, recipient) dzieje się jedną warstwę niżej, w
/// `items.rs`'s `build_coll_item_aad` (Plan 21-03) — patrz
/// 21-RESEARCH.md "AAD Binding — Where It Actually Lives".
pub fn seal(recipient_pk: &IdentityPublicKey, plaintext: &[u8]) -> Result<SealedKey, CryptoError> {
    // Fresh ephemeral keypair, local to this call only.
    let ephemeral_sk = crypto_box::SecretKey::generate(&mut OsRng);
    let ephemeral_pk = ephemeral_sk.public_key();

    let cbox = crypto_box::ChaChaBox::new(&recipient_pk.as_crypto_box(), &ephemeral_sk);
    // Zawsze świeży losowy nonce (jak `aead_seal` gdzie indziej w tym
    // module) — NIGDY deterministycznie wyprowadzany (patrz doc comment
    // funkcji o tradeoffie względem libsodium's Blake2b-derived nonce w
    // 21-RESEARCH.md).
    let nonce = crypto_box::ChaChaBox::generate_nonce(&mut OsRng);
    // Empty-AAD convenience method (`encrypt(&nonce, plaintext)`) — NIE
    // `Payload { msg, aad }` — patrz UWAGA w doc comment powyżej.
    let ciphertext = cbox
        .encrypt(&nonce, plaintext)
        .map_err(|_| CryptoError::Encrypt)?;

    // `ephemeral_sk` drops here at the end of scope. Its `Drop` zeroizes
    // only the internal `scalar` field — `crypto_box::SecretKey` nie
    // implementuje `zeroize::Zeroize` (ten sam udokumentowany "Zeroize
    // gap" co dla długożyjącego `IdentitySecretKey`, patrz module doc
    // comment na górze pliku). NIE próbuj ręcznie zerować
    // `crypto_box::SecretKey` — nie ma takiej metody. Ekspozycja jest tu
    // węższa niż dla długożyjącego klucza: ten sekret istnieje tylko przez
    // czas trwania tego jednego wywołania funkcji.
    Ok(SealedKey {
        ephemeral_pk: *ephemeral_pk.as_bytes(),
        nonce: nonce.to_vec(),
        ciphertext,
    })
}

/// Odpieczętuj `SealedKey` pod własnym `IdentitySecretKey`. Odrzuca blob z
/// niepoprawną długością `nonce` PRZED jakąkolwiek operacją AEAD — nigdy nie
/// panikuje, nigdy nie ucina/dopełnia cicho.
pub fn unseal(my_sk: &IdentitySecretKey, sealed: &SealedKey) -> Result<Vec<u8>, CryptoError> {
    if sealed.nonce.len() != NONCE_LEN {
        return Err(CryptoError::InvalidInput("bad sealed nonce length"));
    }
    // `ephemeral_pk` jest `[u8; KEY_LEN]` w typie `SealedKey` -- niepoprawna
    // długość jest tu niemożliwością kompilacji, nie runtime-checkiem
    // (patrz doc comment `SealedKey` powyżej).
    let ephemeral_pk = crypto_box::PublicKey::from(sealed.ephemeral_pk);
    let cbox = crypto_box::ChaChaBox::new(&ephemeral_pk, &my_sk.as_crypto_box());
    let nonce = crypto_box::aead::generic_array::GenericArray::from_slice(&sealed.nonce);
    cbox.decrypt(nonce, sealed.ciphertext.as_slice())
        .map_err(|_| CryptoError::Decrypt)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys;

    #[test]
    fn generate_produces_distinct_keypairs() {
        let a = IdentitySecretKey::generate();
        let b = IdentitySecretKey::generate();
        assert_ne!(a.0, b.0);
        assert_ne!(a.public_key().to_bytes(), b.public_key().to_bytes());
    }

    #[test]
    fn public_key_roundtrips_through_bytes() {
        let sk = IdentitySecretKey::generate();
        let pk = sk.public_key();
        let pk2 = IdentityPublicKey::from_bytes(pk.to_bytes());
        assert_eq!(pk, pk2);
    }

    #[test]
    fn constant_distinctness() {
        assert_ne!(INFO_X25519_SK_WRAP, keys::INFO_PW_UNLOCK);
        assert_ne!(INFO_X25519_SK_WRAP, keys::INFO_PRF_UNLOCK);
        assert_ne!(INFO_X25519_SK_WRAP, keys::INFO_AUTH_HASH);
        assert_ne!(INFO_X25519_SK_WRAP, keys::INFO_EXT_PRF_UNLOCK);
    }

    #[test]
    fn wrap_unwrap_roundtrip() {
        let uk = UserKey::generate();
        let isk = IdentitySecretKey::generate();
        let expected_pk = isk.public_key().to_bytes();

        let blob = wrap_identity_secret_key(&uk, &isk).unwrap();
        let isk2 = unwrap_identity_secret_key(&uk, &blob).unwrap();

        assert_eq!(isk2.public_key().to_bytes(), expected_pk);
    }

    #[test]
    fn wrong_user_key_fails_to_unwrap() {
        let uk = UserKey::generate();
        let other_uk = UserKey::generate();
        let isk = IdentitySecretKey::generate();

        let blob = wrap_identity_secret_key(&uk, &isk).unwrap();
        assert!(unwrap_identity_secret_key(&other_uk, &blob).is_err());
    }

    #[test]
    fn wrapped_blob_wrong_length_rejected() {
        let uk = UserKey::generate();
        // Wrap a deliberately-wrong-length byte slice (not 32 bytes)
        // directly through `keys::aead_seal` with `INFO_X25519_SK_WRAP` as
        // AAD, bypassing `wrap_identity_secret_key`'s fixed-size input.
        let wrong_length_plaintext = b"too short";
        let blob = aead_seal(uk.expose(), wrong_length_plaintext, INFO_X25519_SK_WRAP).unwrap();

        let result = unwrap_identity_secret_key(&uk, &blob);
        assert!(matches!(result, Err(CryptoError::Decrypt)));
    }

    /// Permanent regression guard (Task 1): a direct `ChaChaBox::encrypt`
    /// call with non-empty associated data MUST fail, confirming the
    /// verified crypto_box 0.9.1 limitation documented in the module doc
    /// comment and in `seal`/`unseal`'s own doc comments. A future
    /// contributor reaching for `Payload`'s `aad` field on this box gets an
    /// immediate, named test failure instead of silently AAD-less
    /// behavior being assumed to bind scope. See 21-RESEARCH.md
    /// "Correction 4".
    #[test]
    fn chachabox_rejects_nonempty_aad() {
        use crypto_box::aead::Payload;

        let sk = crypto_box::SecretKey::generate(&mut OsRng);
        let pk = sk.public_key();
        let cbox = crypto_box::ChaChaBox::new(&pk, &sk);
        let nonce = crypto_box::ChaChaBox::generate_nonce(&mut OsRng);

        let result = cbox.encrypt(
            &nonce,
            Payload { msg: b"hello", aad: b"non-empty" },
        );
        assert!(result.is_err());
    }

    /// Task 2, Test 1: seal/unseal round-trips to identical bytes across
    /// two independently-generated identity keypairs.
    #[test]
    fn seal_unseal_roundtrip() {
        let recipient_a = IdentitySecretKey::generate();
        let payload = [0x7Au8; 32]; // Collection-Key-shaped: 32 bytes.

        let sealed = seal(&recipient_a.public_key(), &payload).unwrap();
        let opened = unseal(&recipient_a, &sealed).unwrap();

        assert_eq!(opened, payload.to_vec());
    }

    /// Task 2, Test 2: the same sealed payload must NOT unseal under a
    /// different, independently-generated recipient's secret key.
    #[test]
    fn wrong_recipient_cannot_unseal() {
        let recipient_a = IdentitySecretKey::generate();
        let recipient_b = IdentitySecretKey::generate();
        let payload = [0x7Au8; 32];

        let sealed = seal(&recipient_a.public_key(), &payload).unwrap();
        assert!(unseal(&recipient_b, &sealed).is_err());
    }

    /// Task 2, Test 3: a `SealedKey` with a wrong-length `nonce` is
    /// rejected with `CryptoError::InvalidInput` before any AEAD call runs
    /// — never panics, never silently truncates/pads.
    #[test]
    fn malformed_sealed_key_wrong_nonce_length_rejected() {
        let recipient = IdentitySecretKey::generate();
        let payload = [0x7Au8; 32];

        let mut sealed = seal(&recipient.public_key(), &payload).unwrap();
        sealed.nonce = vec![0u8; 12]; // 12 bytes instead of NONCE_LEN (24).

        let result = unseal(&recipient, &sealed);
        assert!(matches!(result, Err(CryptoError::InvalidInput(_))));
    }

    /// Task 2, Test 4: `ephemeral_pk` is a fixed `[u8; 32]` array in
    /// `SealedKey`'s type (not a `Vec<u8>`), so a wrong-length ephemeral
    /// public key is a compile-time impossibility rather than a runtime
    /// check — this test's mere existence (constructing `SealedKey`
    /// directly with a 32-byte array literal, and it compiling) is the
    /// proof. `nonce`/`ciphertext` intentionally stay `Vec<u8>` because
    /// their lengths are not a fixed protocol constant the way an X25519
    /// public key's 32 bytes is.
    #[test]
    fn malformed_sealed_key_wrong_ephemeral_pk_length_is_compile_time_impossible() {
        let sealed = SealedKey {
            ephemeral_pk: [0u8; KEY_LEN], // Compiles ONLY at exactly KEY_LEN (32) bytes.
            nonce: vec![0u8; NONCE_LEN],
            ciphertext: vec![0u8; 48],
        };
        assert_eq!(sealed.ephemeral_pk.len(), KEY_LEN);
    }
}
