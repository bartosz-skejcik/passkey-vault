//! User Key i wrapowanie multi-recipient (hasło + N passkeys).

use chacha20poly1305::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload},
    XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::CryptoError;

pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 24;

/// Domain separation dla HKDF — wersjonowane, nigdy nie zmieniać wstecznie.
pub const INFO_PW_UNLOCK: &[u8] = b"pv:pw-unlock:v1";
pub const INFO_PRF_UNLOCK: &[u8] = b"pv:prf-unlock:v1";

/// Losowy 256-bit User Key — korzeń dostępu do vaulta. Nigdy nie opuszcza
/// klienta w postaci jawnej.
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

/// Zaszyfrowany blob klucza (to jedyne, co widzi serwer).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedKey {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

/// Generuje `len` losowych bajtów (OsRng). To jawna losowość (np. sól) —
/// NIE materiał kluczowy, stąd zwykły `Vec<u8>` jest tu poprawny (w
/// przeciwieństwie do kluczy, które muszą zostać nieprzezroczyste — patrz
/// `UserKey`).
pub fn random_bytes(len: usize) -> Vec<u8> {
    let mut bytes = vec![0u8; len];
    OsRng.fill_bytes(&mut bytes);
    bytes
}

pub fn hkdf_expand_key(ikm: &[u8], info: &[u8]) -> [u8; KEY_LEN] {
    let hk = Hkdf::<Sha256>::new(None, ikm);
    let mut okm = [0u8; KEY_LEN];
    hk.expand(info, &mut okm)
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    okm
}

pub(crate) fn aead_seal(
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<WrappedKey, CryptoError> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let mut nonce = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce);
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plaintext, aad })
        .map_err(|_| CryptoError::Encrypt)?;
    Ok(WrappedKey { nonce: nonce.to_vec(), ciphertext })
}

pub(crate) fn aead_open(
    key: &[u8; KEY_LEN],
    blob: &WrappedKey,
    aad: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    if blob.nonce.len() != NONCE_LEN {
        return Err(CryptoError::InvalidInput("bad nonce length"));
    }
    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .decrypt(
            XNonce::from_slice(&blob.nonce),
            Payload { msg: blob.ciphertext.as_slice(), aad },
        )
        .map_err(|_| CryptoError::Decrypt)
}

/// Wrap User Key pod kluczem recipienta (hasłowym albo PRF-owym).
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_unwrap_roundtrip() {
        let uk = UserKey::generate();
        let wk = hkdf_expand_key(b"some ikm", INFO_PW_UNLOCK);
        let blob = wrap_user_key(&wk, &uk).unwrap();
        let uk2 = unwrap_user_key(&wk, &blob).unwrap();
        assert_eq!(uk.expose(), uk2.expose());
    }

    #[test]
    fn wrong_key_fails() {
        let uk = UserKey::generate();
        let wk = hkdf_expand_key(b"some ikm", INFO_PW_UNLOCK);
        let blob = wrap_user_key(&wk, &uk).unwrap();
        let bad = hkdf_expand_key(b"other ikm", INFO_PW_UNLOCK);
        assert!(unwrap_user_key(&bad, &blob).is_err());
    }

    #[test]
    fn random_bytes_returns_requested_length() {
        let bytes = random_bytes(32);
        assert_eq!(bytes.len(), 32);
    }

    #[test]
    fn random_bytes_is_not_deterministic() {
        let a = random_bytes(32);
        let b = random_bytes(32);
        assert_ne!(a, b);
    }
}
