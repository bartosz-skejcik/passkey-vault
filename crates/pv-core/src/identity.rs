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
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::keys::{aead_open, aead_seal, UserKey, WrappedKey, KEY_LEN};
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
}
