//! Szyfrowanie itemów: per-item Cipher Key wrapowany pod User Key.
//!
//! Dzięki per-item kluczom rotacja UK to re-wrap N małych blobów, a sharing
//! pojedynczego itemu = przekazanie jego Cipher Key, bez dotykania UK.

use chacha20poly1305::aead::{rand_core::RngCore, OsRng};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{
    keys::{aead_open, aead_seal, UserKey, WrappedKey, KEY_LEN},
    CryptoError,
};

const AAD_ITEM_KEY: &[u8] = b"pv:item-key:v1";
const AAD_ITEM_DATA: &[u8] = b"pv:item-data:v1";

#[derive(Zeroize, ZeroizeOnDrop)]
struct ItemKey([u8; KEY_LEN]);

impl ItemKey {
    fn generate() -> Self {
        let mut k = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut k);
        Self(k)
    }
}

/// Postać itemu przechowywana na serwerze: dwa nieprzezroczyste bloby.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedItem {
    /// Cipher Key itemu zaszyfrowany User Key-em.
    pub enc_key: WrappedKey,
    /// Payload itemu (JSON: login/passkey/karta/notatka) zaszyfrowany Cipher Key-em.
    pub enc_data: WrappedKey,
}

pub fn encrypt_item(uk: &UserKey, plaintext: &[u8]) -> Result<EncryptedItem, CryptoError> {
    let item_key = ItemKey::generate();
    let enc_key = aead_seal(uk.expose(), &item_key.0, AAD_ITEM_KEY)?;
    let enc_data = aead_seal(&item_key.0, plaintext, AAD_ITEM_DATA)?;
    Ok(EncryptedItem { enc_key, enc_data })
}

pub fn decrypt_item(uk: &UserKey, item: &EncryptedItem) -> Result<Vec<u8>, CryptoError> {
    let mut key_bytes = aead_open(uk.expose(), &item.enc_key, AAD_ITEM_KEY)?;
    if key_bytes.len() != KEY_LEN {
        key_bytes.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&key_bytes);
    key_bytes.zeroize();
    let item_key = ItemKey(k);
    aead_open(&item_key.0, &item.enc_data, AAD_ITEM_DATA)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_roundtrip() {
        let uk = UserKey::generate();
        let payload = br#"{"type":"login","username":"bartek","password":"s3cret"}"#;
        let item = encrypt_item(&uk, payload).unwrap();
        assert_eq!(decrypt_item(&uk, &item).unwrap(), payload);
    }

    #[test]
    fn other_user_key_cannot_decrypt() {
        let uk = UserKey::generate();
        let item = encrypt_item(&uk, b"secret").unwrap();
        assert!(decrypt_item(&UserKey::generate(), &item).is_err());
    }
}
