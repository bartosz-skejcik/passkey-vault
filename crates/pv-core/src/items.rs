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

/// Wersjonowane prefiksy dla itemów w scope'ie kolekcji (KEY-03) — NIEZALEŻNE
/// od `AAD_ITEM_KEY_PREFIX`/`AAD_ITEM_DATA_PREFIX` powyżej. Item przeniesiony
/// między scope'ami (personal <-> collection) albo między dwiema kolekcjami
/// musi failować przy dekrypcji, nie zostać po cichu zreinterpretowany — stąd
/// osobna wersja `:v1` tutaj, a nie reużycie/bump istniejących stałych.
const AAD_COLL_ITEM_KEY_PREFIX: &[u8] = b"pv:coll-item-key:v1";
const AAD_COLL_ITEM_DATA_PREFIX: &[u8] = b"pv:coll-item:v1";

/// Buduje AEAD associated data dla itemu w scope'ie kolekcji: `prefix ‖
/// len(collection_id) (4B big-endian) ‖ collection_id ‖ len(item_id) (4B
/// big-endian) ‖ item_id ‖ revision (4B big-endian)`.
///
/// Długościowe prefiksy (a nie proste sklejenie dwóch zmiennodługościowych
/// pól) są konieczne, żeby uniknąć kolizji granicznej: bez nich
/// `("ab", "c")` i `("a", "bc")` dałyby identyczne bajty AAD. Koszt to
/// tylko 8 dodatkowych bajtów AAD na item w scope'ie kolekcji — tańsze niż
/// wymuszanie stałej szerokości identyfikatorów (np. asercja UUID).
fn build_coll_item_aad(
    prefix: &[u8],
    collection_id: &str,
    item_id: &str,
    revision: u32,
) -> Vec<u8> {
    let mut aad = prefix.to_vec();
    aad.extend_from_slice(&(collection_id.len() as u32).to_be_bytes());
    aad.extend_from_slice(collection_id.as_bytes());
    aad.extend_from_slice(&(item_id.len() as u32).to_be_bytes());
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
    // `[u8; KEY_LEN]` is `Copy` — `ItemKey(k)` copied `k`, it did not move
    // it (WR-01). Wipe our own copy explicitly.
    k.zeroize();
    aead_open(
        &item_key.0,
        &item.enc_data,
        &build_item_aad(AAD_ITEM_DATA_PREFIX, item_id, revision),
    )
}

/// Losowy 256-bit klucz kolekcji — analogiczny do `UserKey`, ale scope'owany
/// do jednej kolekcji zamiast całego vaulta. Nieprzezroczysty, samodzielny
/// typ lokalny dla `items.rs`: sealing/dystrybucja do członków kolekcji to
/// zadanie warstwy tożsamości (`crate::identity`, inny plan), nie tego typu.
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct CollectionKey([u8; KEY_LEN]);

impl CollectionKey {
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

pub fn encrypt_item_for_collection(
    ck: &CollectionKey,
    plaintext: &[u8],
    collection_id: &str,
    item_id: &str,
    revision: u32,
) -> Result<EncryptedItem, CryptoError> {
    let item_key = ItemKey::generate();
    // Key-wrap AAD związane tylko z collection_id/item_id (Cipher Key jest
    // stabilny przez rewizje) — analogicznie do `encrypt_item`, ale scope
    // wiąże teraz też collection_id.
    let enc_key = aead_seal(
        ck.expose(),
        &item_key.0,
        &build_coll_item_aad(AAD_COLL_ITEM_KEY_PREFIX, collection_id, item_id, 0),
    )?;
    // Payload AAD związane z collection_id, item_id ORAZ revision.
    let enc_data = aead_seal(
        &item_key.0,
        plaintext,
        &build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, collection_id, item_id, revision),
    )?;
    Ok(EncryptedItem { enc_key, enc_data })
}

pub fn decrypt_item_for_collection(
    ck: &CollectionKey,
    item: &EncryptedItem,
    collection_id: &str,
    item_id: &str,
    revision: u32,
) -> Result<Vec<u8>, CryptoError> {
    let mut key_bytes = aead_open(
        ck.expose(),
        &item.enc_key,
        &build_coll_item_aad(AAD_COLL_ITEM_KEY_PREFIX, collection_id, item_id, 0),
    )?;
    if key_bytes.len() != KEY_LEN {
        key_bytes.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&key_bytes);
    key_bytes.zeroize();
    let item_key = ItemKey(k);
    // `[u8; KEY_LEN]` is `Copy` — `ItemKey(k)` copied `k`, it did not move
    // it (WR-01). Wipe our own copy explicitly.
    k.zeroize();
    aead_open(
        &item_key.0,
        &item.enc_data,
        &build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, collection_id, item_id, revision),
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

    #[test]
    fn coll_item_roundtrip() {
        let ck = CollectionKey::generate();
        let payload = br#"{"type":"login","username":"bartek","password":"s3cret"}"#;
        let item = encrypt_item_for_collection(&ck, payload, "collection-1", "item-1", 1).unwrap();
        assert_eq!(
            decrypt_item_for_collection(&ck, &item, "collection-1", "item-1", 1).unwrap(),
            payload
        );
    }

    #[test]
    fn other_collection_key_cannot_decrypt() {
        let ck = CollectionKey::generate();
        let item =
            encrypt_item_for_collection(&ck, b"secret", "collection-1", "item-1", 1).unwrap();
        assert!(matches!(
            decrypt_item_for_collection(
                &CollectionKey::generate(),
                &item,
                "collection-1",
                "item-1",
                1
            ),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn personal_blob_rejected_under_collection_scope() {
        // Ten sam materiał klucza w obu typach — dowodzi, że odrzucenie
        // wynika z AAD/prefiksu scope'u, nie z niezgodności kluczy (to już
        // pokrywają other_user_key_cannot_decrypt/other_collection_key_cannot_decrypt).
        let key_bytes = [7u8; KEY_LEN];
        let uk = UserKey::from_bytes(key_bytes);
        let ck = CollectionKey::from_bytes(key_bytes);

        let item = encrypt_item(&uk, b"secret", "item-1", 1).unwrap();
        assert!(matches!(
            decrypt_item_for_collection(&ck, &item, "collection-1", "item-1", 1),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn collection_blob_rejected_under_different_collection() {
        let ck = CollectionKey::generate();
        let item =
            encrypt_item_for_collection(&ck, b"secret", "collection-a", "item-1", 1).unwrap();
        assert!(matches!(
            decrypt_item_for_collection(&ck, &item, "collection-b", "item-1", 1),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn coll_aad_length_unambiguous() {
        let a = build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, "ab", "c", 0);
        let b = build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, "a", "bc", 0);
        assert_ne!(a, b);
    }

    #[test]
    fn coll_aad_handles_empty_ids_without_panic() {
        // Nie panikuje na pustym collection_id.
        let _ = build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, "", "item-1", 0);

        // Producent/konsument z niezgodnym pustym-vs-niepustym collection_id
        // musi failować na poziomie AEAD, nie ciszej się dopasować.
        let ck = CollectionKey::generate();
        let item = encrypt_item_for_collection(&ck, b"secret", "", "item-1", 1).unwrap();
        assert!(matches!(
            decrypt_item_for_collection(&ck, &item, "x", "item-1", 1),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn coll_aad_is_deterministic() {
        let a = build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, "collection-1", "item-1", 3);
        let b = build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, "collection-1", "item-1", 3);
        assert_eq!(a, b);
    }

    #[test]
    fn coll_aad_revision_max_distinct_from_zero() {
        let a = build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, "c1", "i1", u32::MAX);
        let b = build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, "c1", "i1", 0);
        assert_ne!(a, b);
    }
}
