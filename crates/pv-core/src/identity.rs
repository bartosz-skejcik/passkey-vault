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

use crate::keys::KEY_LEN;

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
}
