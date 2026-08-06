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
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

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

/// Zwraca `Zeroizing<Vec<u8>>` (WR-12, consistent with `identity::unseal`'s
/// WR-06 convention), nie gołe `Vec<u8>` — odzyskany payload itemu (login/
/// passkey prywatny klucz/karta/notatka) niesie własny obowiązek
/// wyzerowania jako część typu, zamiast liczyć na to, że każdy przyszły
/// wywołujący o tym pamięta.
pub fn decrypt_item(
    uk: &UserKey,
    item: &EncryptedItem,
    item_id: &str,
    revision: u32,
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
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
    let plaintext = aead_open(
        &item_key.0,
        &item.enc_data,
        &build_item_aad(AAD_ITEM_DATA_PREFIX, item_id, revision),
    )?;
    Ok(Zeroizing::new(plaintext))
}

/// Odpakowuje Cipher Key POJEDYNCZEGO personalnego itemu spod `UserKey`
/// właściciela — budulec dla bezpośredniego udostępniania pojedynczego itemu
/// (SHARE-02, Faza 26, Plan 08): właściciel trzyma item pod własnym
/// `UserKey`iem i musi wydobyć jego Cipher Key w postaci, którą da się
/// zapieczętować (`identity::seal`) pod publiczny klucz KONKRETNEGO
/// recipienta. `enc_data` (payload) pozostaje nietknięty — ta sama
/// dyscyplina "tylko klucz, nigdy payload" co
/// `rewrap_item_key_for_collection` (KEY-02/SC 6), rozszerzona tutaj na
/// przypadek udostępniania personalnego (nie-kolekcyjnego) itemu wprost.
///
/// Zwraca `Zeroizing<[u8; KEY_LEN]>`, nie gołą tablicę — surowy materiał
/// klucza niesie własny obowiązek wyzerowania jako część typu. Jedyny
/// zamierzony dalszy krok to skarmienie go do `identity::seal` (patrz
/// `pv-wasm`'s `sealItemKeyForRecipient`) — nigdy przechowanie, nigdy zwrot
/// przez granicę WASM/JS jako gołe bajty.
pub fn unwrap_item_key_for_sharing(
    uk: &UserKey,
    enc_key: &WrappedKey,
    item_id: &str,
) -> Result<Zeroizing<[u8; KEY_LEN]>, CryptoError> {
    let mut key_bytes = aead_open(
        uk.expose(),
        enc_key,
        &build_item_aad(AAD_ITEM_KEY_PREFIX, item_id, 0),
    )?;
    if key_bytes.len() != KEY_LEN {
        key_bytes.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&key_bytes);
    key_bytes.zeroize();
    Ok(Zeroizing::new(k))
}

/// Read-side odpowiednik `unwrap_item_key_for_sharing`: odszyfrowuje
/// `enc_data` bezpośrednio udostępnionego (`item_shares`) personalnego itemu
/// przy użyciu Cipher Key odzyskanego przez recipienta (typowo via
/// `identity::unseal_collection_key` — ten sam nieprzezroczysty
/// 32-bajtowy nośnik, `CollectionKey`, jest reużywany tu wyłącznie jako
/// "surowy klucz", nazwa typu nie implikuje przynależności do kolekcji).
/// Używa DOKŁADNIE tego samego personalnego AAD (`AAD_ITEM_DATA_PREFIX`) co
/// `decrypt_item`'s własny krok payloadu — `enc_data` jest niedotknięte przez
/// udostępnianie (SC 6), więc recipient musi przedstawić TEN SAM AAD, pod
/// którym właściciel je zaszyfrował, inaczej AEAD odrzuci (nigdy cichy
/// błędny odczyt).
pub fn decrypt_item_payload_with_shared_key(
    item_key_bytes: &[u8; KEY_LEN],
    enc_data: &WrappedKey,
    item_id: &str,
    revision: u32,
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    let plaintext = aead_open(
        item_key_bytes,
        enc_data,
        &build_item_aad(AAD_ITEM_DATA_PREFIX, item_id, revision),
    )?;
    Ok(Zeroizing::new(plaintext))
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

    /// `bytes` is taken BY VALUE and zeroized here after being copied into
    /// `Self` (WR-11) — `[u8; KEY_LEN]` is `Copy`, so without this the
    /// callee's own parameter slot would be a second, never-wiped copy of
    /// the key even when every caller diligently zeroizes ITS copy (WR-01).
    /// This is the highest-value site for this fix: `pv-wasm`'s
    /// `encrypt_item_for_collection`/`decrypt_item_for_collection` call this
    /// on EVERY collection item operation with no local variable to zeroize
    /// on the caller side at all.
    pub fn from_bytes(mut bytes: [u8; KEY_LEN]) -> Self {
        let out = Self(bytes);
        bytes.zeroize();
        out
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

/// Zwraca `Zeroizing<Vec<u8>>` (WR-12), tak samo i z tego samego powodu co
/// `decrypt_item` powyżej — na tej ścieżce payload item bywa passkey
/// prywatnym kluczem w JSON (patrz `pv-wasm`'s provider-ceremony
/// wywołania), więc obowiązek wyzerowania jest szczególnie load-bearing.
pub fn decrypt_item_for_collection(
    ck: &CollectionKey,
    item: &EncryptedItem,
    collection_id: &str,
    item_id: &str,
    revision: u32,
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
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
    let plaintext = aead_open(
        &item_key.0,
        &item.enc_data,
        &build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, collection_id, item_id, revision),
    )?;
    Ok(Zeroizing::new(plaintext))
}

/// Rewrap-only: przenosi Cipher Key itemu spod OLD `CollectionKey`a pod NEW,
/// nigdy nie dotykając `enc_data` (KEY-02/SC 6 — "removing a member rewraps
/// keys only"). Sygnatura celowo nie przyjmuje żadnego argumentu w kształcie
/// `enc_data` — to jest sama część dowodu SC 6: dotknięcie payloadu jest
/// niemożliwe na poziomie typu, nie tylko dyscypliny runtime'owej.
///
/// Kompozycja WYŁĄCZNIE istniejących prymitywów (`aead_open`/`aead_seal`) i
/// istniejącej stałej/helpera AAD (`AAD_COLL_ITEM_KEY_PREFIX`/
/// `build_coll_item_aad`) — żadnej nowej konstrukcji kryptograficznej.
pub fn rewrap_item_key_for_collection(
    old_ck: &CollectionKey,
    new_ck: &CollectionKey,
    old_enc_key: &WrappedKey,
    collection_id: &str,
    item_id: &str,
) -> Result<WrappedKey, CryptoError> {
    let aad = build_coll_item_aad(AAD_COLL_ITEM_KEY_PREFIX, collection_id, item_id, 0);
    // WR-01 (code review, Phase 25): `Zeroizing`, not a bare `Vec<u8>` + manual
    // `.zeroize()` calls. The manual form wiped on the success path and on the
    // length-check path but NOT on `aead_seal`'s `?` — an early return there
    // left the raw, unwrapped Cipher Key sitting in the freed allocation.
    // `Zeroizing`'s `Drop` fires on EVERY exit from this function, including
    // the `?`, which is exactly why CLAUDE.md's security conventions name it as
    // the tool for this job.
    let key_bytes = Zeroizing::new(aead_open(old_ck.expose(), old_enc_key, &aad)?);
    if key_bytes.len() != KEY_LEN {
        return Err(CryptoError::Decrypt);
    }
    aead_seal(new_ck.expose(), &key_bytes, &aad)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn item_roundtrip() {
        let uk = UserKey::generate();
        let payload = br#"{"type":"login","username":"bartek","password":"s3cret"}"#;
        let item = encrypt_item(&uk, payload, "item-1", 1).unwrap();
        assert_eq!(*decrypt_item(&uk, &item, "item-1", 1).unwrap(), payload);
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

    /// SHARE-02 write/read pair round trip: unwrap the owner's own
    /// personal-scope `enc_key` into raw Cipher Key bytes, then decrypt the
    /// SAME item's `enc_data` with those bytes under the identical personal
    /// AAD `decrypt_item` itself uses — proving the two new sharing
    /// primitives compose to recover the exact original plaintext without
    /// ever touching `decrypt_item` directly.
    #[test]
    fn unwrap_item_key_for_sharing_recovers_the_key_that_decrypts_enc_data() {
        let uk = UserKey::generate();
        let payload = br#"{"type":"note","body":"share fixture"}"#;
        let item = encrypt_item(&uk, payload, "item-1", 1).unwrap();

        let item_key_bytes = unwrap_item_key_for_sharing(&uk, &item.enc_key, "item-1").unwrap();
        let plaintext =
            decrypt_item_payload_with_shared_key(&item_key_bytes, &item.enc_data, "item-1", 1)
                .unwrap();
        assert_eq!(*plaintext, payload);
    }

    #[test]
    fn unwrap_item_key_for_sharing_rejects_wrong_user_key() {
        let uk = UserKey::generate();
        let item = encrypt_item(&uk, b"secret", "item-1", 1).unwrap();
        assert!(matches!(
            unwrap_item_key_for_sharing(&UserKey::generate(), &item.enc_key, "item-1"),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn unwrap_item_key_for_sharing_rejects_enc_data_blob_as_input() {
        // Same key-wrap/payload AAD prefix separation
        // `rewrap_item_key_for_collection_rejects_enc_data_blob_as_input`
        // proves for the collection-scoped sibling — feeding enc_data where
        // enc_key is expected must be rejected, not silently accepted.
        let uk = UserKey::generate();
        let item = encrypt_item(&uk, b"secret", "item-1", 1).unwrap();
        assert!(matches!(
            unwrap_item_key_for_sharing(&uk, &item.enc_data, "item-1"),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn decrypt_item_payload_with_shared_key_rejects_wrong_revision() {
        let uk = UserKey::generate();
        let item = encrypt_item(&uk, b"secret", "item-1", 1).unwrap();
        let item_key_bytes = unwrap_item_key_for_sharing(&uk, &item.enc_key, "item-1").unwrap();
        assert!(matches!(
            decrypt_item_payload_with_shared_key(&item_key_bytes, &item.enc_data, "item-1", 2),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn decrypt_item_payload_with_shared_key_rejects_wrong_item_id() {
        let uk = UserKey::generate();
        let item = encrypt_item(&uk, b"secret", "item-1", 1).unwrap();
        let item_key_bytes = unwrap_item_key_for_sharing(&uk, &item.enc_key, "item-1").unwrap();
        assert!(matches!(
            decrypt_item_payload_with_shared_key(&item_key_bytes, &item.enc_data, "item-2", 1),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn coll_item_roundtrip() {
        let ck = CollectionKey::generate();
        let payload = br#"{"type":"login","username":"bartek","password":"s3cret"}"#;
        let item = encrypt_item_for_collection(&ck, payload, "collection-1", "item-1", 1).unwrap();
        assert_eq!(
            *decrypt_item_for_collection(&ck, &item, "collection-1", "item-1", 1).unwrap(),
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
    fn collection_blob_rejected_under_personal_scope() {
        // Kierunek odwrotny do personal_blob_rejected_under_collection_scope.
        // SC#3 wymaga, żeby blob z JEDNEGO scope'u nie odszyfrował się pod
        // ŻADNYM innym — jeden kierunek tego nie dowodzi, bo nie wyklucza
        // asymetrii w budowie AAD. Ten sam materiał klucza w obu typach, więc
        // odrzucenie wynika wyłącznie z prefiksu/AAD scope'u (IN-05).
        let key_bytes = [7u8; KEY_LEN];
        let ck = CollectionKey::from_bytes(key_bytes);
        let uk = UserKey::from_bytes(key_bytes);

        let item =
            encrypt_item_for_collection(&ck, b"secret", "collection-1", "item-1", 1).unwrap();
        assert!(matches!(
            decrypt_item(&uk, &item, "item-1", 1),
            Err(CryptoError::Decrypt)
        ));
    }

    #[test]
    fn key_wrap_prefix_not_interchangeable_with_data_prefix() {
        // Izolacja prefiksów WEWNĄTRZ jednego scope'u: AAD key-wrapa i AAD
        // payloadu muszą być rozróżnialne, inaczej podmiana enc_key<->enc_data
        // przeszłaby cicho. Prefiksy są dziś parami różne, ale nic tego nie
        // przypinało (IN-05).
        assert_ne!(
            build_item_aad(AAD_ITEM_KEY_PREFIX, "item-1", 0),
            build_item_aad(AAD_ITEM_DATA_PREFIX, "item-1", 0)
        );
        assert_ne!(
            build_coll_item_aad(AAD_COLL_ITEM_KEY_PREFIX, "collection-1", "item-1", 0),
            build_coll_item_aad(AAD_COLL_ITEM_DATA_PREFIX, "collection-1", "item-1", 0)
        );
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

    #[test]
    fn rewrap_item_key_roundtrip_preserves_plaintext_under_new_key() {
        let old_ck = CollectionKey::generate();
        let new_ck = CollectionKey::generate();
        let payload = br#"{"type":"login","username":"bartek","password":"s3cret"}"#;
        let original_item =
            encrypt_item_for_collection(&old_ck, payload, "collection-1", "item-1", 1).unwrap();
        let original_plaintext =
            decrypt_item_for_collection(&old_ck, &original_item, "collection-1", "item-1", 1)
                .unwrap();

        let rewrapped_enc_key = rewrap_item_key_for_collection(
            &old_ck,
            &new_ck,
            &original_item.enc_key,
            "collection-1",
            "item-1",
        )
        .unwrap();
        // enc_data moved, not re-derived — the rewrap-only guarantee this
        // test proves.
        let rewrapped_item = EncryptedItem {
            enc_key: rewrapped_enc_key,
            enc_data: original_item.enc_data.clone(),
        };

        let new_plaintext =
            decrypt_item_for_collection(&new_ck, &rewrapped_item, "collection-1", "item-1", 1)
                .unwrap();
        assert_eq!(*new_plaintext, *original_plaintext);
    }

    #[test]
    fn rewrap_item_key_for_collection_rejects_wrong_old_key() {
        let real_old_ck = CollectionKey::generate();
        let unrelated_ck = CollectionKey::generate();
        let new_ck = CollectionKey::generate();
        let item =
            encrypt_item_for_collection(&real_old_ck, b"secret", "collection-1", "item-1", 1)
                .unwrap();

        let result = rewrap_item_key_for_collection(
            &unrelated_ck,
            &new_ck,
            &item.enc_key,
            "collection-1",
            "item-1",
        );
        assert!(matches!(result, Err(CryptoError::Decrypt)));
    }

    #[test]
    fn rewrap_item_key_for_collection_rejects_enc_data_blob_as_input() {
        let old_ck = CollectionKey::generate();
        let new_ck = CollectionKey::generate();
        let item =
            encrypt_item_for_collection(&old_ck, b"secret", "collection-1", "item-1", 1).unwrap();

        // Feed enc_data where old_enc_key is expected — the key-wrap/payload
        // AAD prefix separation must reject it.
        let result = rewrap_item_key_for_collection(
            &old_ck,
            &new_ck,
            &item.enc_data,
            "collection-1",
            "item-1",
        );
        assert!(matches!(result, Err(CryptoError::Decrypt)));
    }

    /// SEC-07 (Plan 25-05, Task 2): 200 independent rewraps must produce 200
    /// pairwise-distinct nonces — a large-batch property test giving the
    /// collision check real statistical power, not just incidental
    /// distinctness in a small functional test.
    #[test]
    fn nonce_uniqueness_large_batch_of_item_key_rewraps() {
        use std::collections::HashSet;

        let old_ck = CollectionKey::generate();
        let new_ck = CollectionKey::generate();
        let mut nonces = Vec::with_capacity(200);
        for i in 0..200 {
            let item_id = format!("item-{i}");
            let item =
                encrypt_item_for_collection(&old_ck, b"secret", "collection-1", &item_id, 1)
                    .unwrap();
            let rewrapped = rewrap_item_key_for_collection(
                &old_ck,
                &new_ck,
                &item.enc_key,
                "collection-1",
                &item_id,
            )
            .unwrap();
            nonces.push(rewrapped.nonce);
        }
        let unique: HashSet<_> = nonces.iter().collect();
        assert_eq!(unique.len(), 200, "all 200 rewrap nonces must be pairwise-distinct");
    }
}
