//! Szyfrowanie itemów: per-item Cipher Key wrapowany pod User Key.
//!
//! Dzięki per-item kluczom rotacja UK to re-wrap N małych blobów, a sharing
//! pojedynczego itemu = przekazanie jego Cipher Key, bez dotykania UK.
//!
//! Ciphertext jest związany (AEAD associated data) z tożsamością itemu
//! (`item_id`) i, dla payloadu, jego `revision` — patrz `build_item_aad`.
//! To blokuje podmianę blobów między itemami/rewizjami przez (złośliwy albo
//! zepsuty) serwer: dowolna niezgodność AD powoduje `CryptoError::Decrypt`,
//! nie ciche zaakceptowanie (VAULT-02).

use chacha20poly1305::aead::{rand_core::RngCore, OsRng};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{
    keys::{aead_open, aead_seal, UserKey, WrappedKey, KEY_LEN},
    CryptoError,
};

const AAD_ITEM_KEY_PREFIX: &[u8] = b"pv:item-key:v1";
const AAD_ITEM_DATA_PREFIX: &[u8] = b"pv:item:v1";

/// Buduje AEAD associated data związane z tożsamością itemu: `prefix ‖
/// item_id ‖ revision (big-endian)`. Dla key-wrap AAD `revision` jest zawsze
/// `0` (Cipher Key jest stabilny przez cały cykl życia itemu, niezależnie od
/// rewizji payloadu) — patrz wywołania w `encrypt_item`/`decrypt_item`.
fn build_item_aad(prefix: &[u8], item_id: &str, revision: u32) -> Vec<u8> {
    let mut aad = prefix.to_vec();
    aad.extend_from_slice(item_id.as_bytes());
    aad.extend_from_slice(&revision.to_be_bytes());
    aad
}

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

pub fn encrypt_item(
    uk: &UserKey,
    plaintext: &[u8],
    item_id: &str,
    revision: u32,
) -> Result<EncryptedItem, CryptoError> {
    let item_key = ItemKey::generate();
    // Key-wrap AAD związane tylko z item_id (Cipher Key jest stabilny przez
    // rewizje) — tania obrona w głąb, żeby podmieniony enc_key zawiódł już
    // przy unwrap, nie dopiero przy dekrypcji payloadu.
    let enc_key = aead_seal(
        uk.expose(),
        &item_key.0,
        &build_item_aad(AAD_ITEM_KEY_PREFIX, item_id, 0),
    )?;
    // Payload AAD związane z item_id ORAZ revision — to właśnie blokuje
    // rollback/splice starej-ale-autentycznej rewizji na inny slot.
    let enc_data = aead_seal(
        &item_key.0,
        plaintext,
        &build_item_aad(AAD_ITEM_DATA_PREFIX, item_id, revision),
    )?;
    Ok(EncryptedItem { enc_key, enc_data })
}

pub fn decrypt_item(
    uk: &UserKey,
    item: &EncryptedItem,
    item_id: &str,
    revision: u32,
) -> Result<Vec<u8>, CryptoError> {
    let mut key_bytes = aead_open(
        uk.expose(),
        &item.enc_key,
        &build_item_aad(AAD_ITEM_KEY_PREFIX, item_id, 0),
    )?;
    if key_bytes.len() != KEY_LEN {
        key_bytes.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&key_bytes);
    key_bytes.zeroize();
    let item_key = ItemKey(k);
    aead_open(
        &item_key.0,
        &item.enc_data,
        &build_item_aad(AAD_ITEM_DATA_PREFIX, item_id, revision),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_roundtrip() {
        let uk = UserKey::generate();
        let payload = br#"{"type":"login","username":"bartek","password":"s3cret"}"#;
        let item = encrypt_item(&uk, payload, "item-1", 1).unwrap();
        assert_eq!(decrypt_item(&uk, &item, "item-1", 1).unwrap(), payload);
    }

    #[test]
    fn other_user_key_cannot_decrypt() {
        let uk = UserKey::generate();
        let item = encrypt_item(&uk, b"secret", "item-1", 1).unwrap();
        assert!(matches!(
            decrypt_item(&UserKey::generate(), &item, "item-1", 1),
            Err(CryptoError::Decrypt)
        ));
    }

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
}
