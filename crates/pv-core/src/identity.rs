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
use crypto_box::aead::{rand_core::RngCore, Aead, AeadCore};
use serde::{Deserialize, Deserializer, Serialize};
use subtle::{Choice, ConstantTimeEq};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::keys::{aead_open, aead_seal, UserKey, WrappedKey, KEY_LEN, NONCE_LEN};
use crate::CryptoError;

/// Domain separation dla wrapowania `IdentitySecretKey` pod `UserKey` —
/// przekazywane jako AEAD associated data do `aead_seal`/`aead_open`
/// (analogicznie do `wrap_user_key`'s `b"pv:uk:v1"` w `keys.rs`), NIE jako
/// HKDF `info` string — ta sama konwencja `INFO_*` pokrywa oba użycia w tym
/// codebase.
pub const INFO_X25519_SK_WRAP: &[u8] = b"pv:x25519-sk-wrap:v1";

/// The 7 known small-order Curve25519 u-coordinate encodings (libsodium's
/// blocklist) — each of these has group order dividing 8, so an X25519
/// shared secret computed against one of them lands in a subgroup of at
/// most 8 publicly-enumerable values (or, for `0`/`p`, always exactly the
/// all-zero point). A recipient public key from this set makes a `seal()`ed
/// blob recoverable by anyone, without the recipient's secret key (CR-01).
///
/// Verified empirically against this workspace's exact resolved
/// `curve25519-dalek 4.1.3`: each of these 7 encodings satisfies
/// `MontgomeryPoint::mul_bits_be(<8 in big-endian bits>) == identity`,
/// and a random point does not — see `21-REVIEW-FIX.md` (CR-01) for the
/// verification script. Entries 5-7 (`p-1`/`p`/`p+1`) are the ≥p
/// "non-canonical" aliases of `-1`/`0`/`1` respectively; entries are listed
/// in their RAW (possibly non-canonical) 32-byte form because
/// `is_small_order` is always called AFTER bit-255 masking (see
/// `IdentityPublicKey::from_bytes`), which is enough to canonicalize the
/// bit-255 case, but NOT the `>= p` case — hence `p`/`p+1` still need their
/// own rows here even after masking (masking only clears bit 255, which is
/// already 0 in their encoding; the "aliasing" is via arithmetic overflow
/// mod p, not the high bit).
const SMALL_ORDER_POINTS: [[u8; KEY_LEN]; 7] = [
    // 0 (order 1 / identity element)
    [
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
    ],
    // 1 (small-order point; order divides 8)
    [
        0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
    ],
    // order-8 point (libsodium blocklist)
    [
        0xe0, 0xeb, 0x7a, 0x7c, 0x3b, 0x41, 0xb8, 0xae, 0x16, 0x56, 0xe3, 0xfa, 0xf1, 0x9f, 0xc4,
        0x6a, 0xda, 0x09, 0x8d, 0xeb, 0x9c, 0x32, 0xb1, 0xfd, 0x86, 0x62, 0x05, 0x16, 0x5f, 0x49,
        0xb8, 0x00,
    ],
    // order-8 point (libsodium blocklist)
    [
        0x5f, 0x9c, 0x95, 0xbc, 0xa3, 0x50, 0x8c, 0x24, 0xb1, 0xd0, 0xb1, 0x55, 0x9c, 0x83, 0xef,
        0x5b, 0x04, 0x44, 0x5c, 0xc4, 0x58, 0x1c, 0x8e, 0x86, 0xd8, 0x22, 0x4e, 0xdd, 0xd0, 0x9f,
        0x11, 0x57,
    ],
    // p-1 = 2^255-20 (order-2 point)
    [
        0xec, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0x7f,
    ],
    // p = 2^255-19 (non-canonical dup of 0)
    [
        0xed, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0x7f,
    ],
    // p+1 (non-canonical dup of 1)
    [
        0xee, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0x7f,
    ],
];

/// Constant-time membership check against `SMALL_ORDER_POINTS`. NEVER use
/// `==`/early-return here — the whole point is that recipient/ephemeral
/// public keys are untrusted input, and branching on secret-adjacent
/// comparison outcomes is exactly the class of bug this function exists to
/// avoid introducing.
fn is_small_order(canonical_bytes: &[u8; KEY_LEN]) -> bool {
    let mut is_bad = Choice::from(0u8);
    for candidate in SMALL_ORDER_POINTS.iter() {
        is_bad |= canonical_bytes.as_slice().ct_eq(candidate.as_slice());
    }
    is_bad.into()
}

/// Prywatna połowa X25519 identity keypair. Nigdy nie opuszcza klienta w
/// postaci jawnej — wrapowana pod `UserKey` (patrz `wrap_identity_secret_key`).
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct IdentitySecretKey([u8; KEY_LEN]);

impl IdentitySecretKey {
    /// Generuje bezpośrednio do własnej tablicy — NIE przez
    /// `crypto_box::SecretKey::generate` (WR-02). `SecretKey::from_bytes`
    /// przechowuje surowe bajty CSPRNG werbatim i klampuje wyłącznie
    /// wyprowadzony `scalar` (patrz `crypto_box-0.9.1/src/secret_key.rs`),
    /// więc to jest bit-for-bit równoważne temu, co robiłby `generate()` —
    /// tylko bez dwóch dodatkowych, nigdy niezerowanych kopii klucza
    /// prywatnego, które `crypto_box::SecretKey::generate` zostawia na
    /// stosie (jego własny lokalny `bytes` plus `to_bytes()`'s temp).
    pub fn generate() -> Self {
        let mut k = [0u8; KEY_LEN];
        OsRng.fill_bytes(&mut k);
        Self(k)
    }

    /// `bytes` is taken BY VALUE and zeroized here after being copied into
    /// `Self` (WR-11) — `[u8; KEY_LEN]` is `Copy`, so without this the
    /// callee's own parameter slot would be a second, never-wiped copy of
    /// the key even when every caller diligently zeroizes ITS copy (WR-01).
    pub fn from_bytes(mut bytes: [u8; KEY_LEN]) -> Self {
        let out = Self(bytes);
        bytes.zeroize();
        out
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
/// `IdentitySecretKey`. `Deserialize` jest NIE derive'owany — patrz custom
/// `impl` poniżej, który (jak `from_bytes`) waliduje/canonicalizuje zamiast
/// tworzyć wartość bezpośrednio z surowych bajtów (CR-01).
///
/// **UWAGA (WR-09) — `Eq` to NIE tożsamość klucza.** `from_bytes`
/// kanonikalizuje WYŁĄCZNIE bit 255 (ignorowany przy dekodowaniu pola
/// X25519 — WR-04); NIE redukuje modulo `p = 2^255-19`. Kodowania `>= p`
/// (dokładnie 19 z nich, u ∈ {2..18} po zamaskowaniu bitu 255 — `p`/`p+1`
/// same są odrzucane przez blocklistę, więc realny alias to u ∈ {2..18})
/// dekodują się do TEGO SAMEGO pola X25519, co ich kanoniczny odpowiednik,
/// ale porównują się jako RÓŻNE przez derive'owane `Eq`, bo bajty się
/// różnią. Żaden realny wygenerowany klucz publiczny (`IdentitySecretKey::
/// public_key()`) nigdy nie wyprodukuje takiego kodowania — okno ataku jest
/// praktycznie zerowe — ale NIE buduj na tych bajtach tabeli
/// dedup/trust-pin/revocation traktującej `Eq` jako tożsamość klucza; to
/// jest DOKŁADNIE gwarancja, której ten typ nie daje.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct IdentityPublicKey([u8; KEY_LEN]);

impl IdentityPublicKey {
    /// Fallible: klucz publiczny recipienta zawsze przychodzi z
    /// niezaufanego źródła (serwer, inny klient) — musi być walidowany, nie
    /// tylko otypowany (CR-01). Odrzuca 7 znanych small-order encodings
    /// (patrz `SMALL_ORDER_POINTS`) — którekolwiek z nich sprawiłoby, że
    /// `seal()`-owany blob byłby odzyskiwalny przez każdego, bez klucza
    /// prywatnego recipienta. Maskuje bit 255 przed porównaniem (WR-04) —
    /// ignorowany przy dekodowaniu pola X25519, więc dwie różniące się
    /// wyłącznie tym bitem wartości muszą być traktowane jako ten sam klucz.
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Result<Self, CryptoError> {
        let mut canonical = bytes;
        canonical[31] &= 0x7f;
        if is_small_order(&canonical) {
            return Err(CryptoError::InvalidInput("small-order X25519 public key"));
        }
        Ok(Self(canonical))
    }

    pub fn to_bytes(&self) -> [u8; KEY_LEN] {
        self.0
    }

    fn as_crypto_box(&self) -> crypto_box::PublicKey {
        crypto_box::PublicKey::from(self.0)
    }
}

/// Waliduje/canonicalizuje przez `from_bytes` zamiast tworzyć wartość
/// bezpośrednio z deserializowanych bajtów — derive'owany `Deserialize`
/// omijałby CR-01's walidację całkowicie (dane z JSON trafiłyby prosto do
/// prywatnego pola tuple-struct).
impl<'de> Deserialize<'de> for IdentityPublicKey {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let bytes = <[u8; KEY_LEN]>::deserialize(deserializer)?;
        IdentityPublicKey::from_bytes(bytes).map_err(serde::de::Error::custom)
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
    let out = IdentitySecretKey::from_bytes(k);
    // `[u8; KEY_LEN]` is `Copy` — `from_bytes` COPIED `k` into the newtype,
    // it did not move it. Wipe our own copy explicitly (WR-01); the newtype
    // holds an independent copy zeroized by its own `ZeroizeOnDrop`.
    k.zeroize();
    Ok(out)
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
///
/// **UWAGA (WR-10) — walidacja ENCODINGU `recipient_pk` to NIE to samo, co
/// walidacja jego PROVENANCE.** `IdentityPublicKey`'s small-order guard
/// (CR-01) odrzuca zdegenerowane klucze, ale ta funkcja NIE uwierzytelnia
/// NADAWCY ani odbiorcy — anonymous sealed box z definicji nie ma klucza
/// nadawcy, więc nie ma nic do zweryfikowania z tej strony. Każdy, kto zna
/// PUBLICZNY klucz `recipient_pk` (publikowany z założenia — patrz katalog
/// członków), może zapieczętować dowolny plaintext pod niego; a złośliwy/
/// przejęty serwer, który podmieni WŁASNY, w pełni poprawny klucz publiczny
/// jako "klucza recipienta X", odzyska każdy tak zapieczętowany Collection
/// Key. `recipient_pk` MUSI być uwierzytelniony poza tą warstwą (podpisany
/// katalog członków / TOFU pin / potwierdzenie fingerprintu) zanim trafi
/// tutaj — patrz `docs/ARCHITECTURE.md` "Trzy znane ograniczenia".
pub fn seal(recipient_pk: &IdentityPublicKey, plaintext: &[u8]) -> Result<SealedKey, CryptoError> {
    // Defense in depth (CR-01): `recipient_pk` should already be validated
    // at construction time (`IdentityPublicKey::from_bytes`/`Deserialize`
    // both canonicalize and reject small-order encodings) — this repeats
    // the check so a single future caller/refactor that gains another way
    // to build an `IdentityPublicKey` cannot silently reopen the
    // recoverable-shared-secret attack this function exists to prevent.
    // Mask bit 255 first, exactly like `from_bytes`/`unseal` do (WR-08) — an
    // `IdentityPublicKey` built by some future non-`from_bytes` constructor
    // could hold a raw, non-canonicalized bit-255-set encoding, and without
    // this mask this duplicate guard would be strictly weaker than the
    // primary one it exists to back up (a bit-255-set alias of a
    // small-order point would sail through `is_small_order` unmasked).
    let mut recipient_canonical = recipient_pk.0;
    recipient_canonical[31] &= 0x7f;
    if is_small_order(&recipient_canonical) {
        return Err(CryptoError::InvalidInput("small-order X25519 public key"));
    }

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
/// panikuje, nigdy nie ucina/dopełnia cicho. Zwraca `Zeroizing<Vec<u8>>`
/// (WR-06), nie gołe `Vec<u8>` — obowiązek wyzerowania odzyskanego materiału
/// klucza jest częścią typu, nie czymś, co wywołujący musi pamiętać zrobić
/// sam.
pub fn unseal(
    my_sk: &IdentitySecretKey,
    sealed: &SealedKey,
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    if sealed.nonce.len() != NONCE_LEN {
        return Err(CryptoError::InvalidInput("bad sealed nonce length"));
    }
    // CR-01, second boundary: `SealedKey.ephemeral_pk` is a bare
    // `[u8; KEY_LEN]` field with NO validating constructor (unlike
    // `IdentityPublicKey`) — it arrives from untrusted storage (a
    // malicious/compromised server) and `SealedKey` derives `Deserialize`
    // with no hook to intercept it. If it's a small-order encoding, the
    // shared secret this recipient computes lands in a small
    // publicly-enumerable set (or is unconditionally the all-zero box key
    // for `0`/`p`) REGARDLESS of `my_sk` — letting an attacker forge a
    // `SealedKey` that unseals to attacker-chosen bytes for EVERY recipient
    // with NO key at all (the box key becomes the fixed, publicly derivable
    // `HChaCha20(zeros, zeros)`). Canonicalize + reject exactly like
    // `IdentityPublicKey::from_bytes`.
    //
    // WR-10: this guard removes ONLY that unkeyed/degenerate-key variant.
    // It does NOT make `unseal` authenticated: an attacker who merely knows
    // this recipient's PUBLIC key (public by construction, published by the
    // server) can still forge a non-degenerate `SealedKey` this recipient
    // will happily accept — this primitive is an anonymous sealed box, it
    // has no sender key to check anything against. Sender authentication
    // (and recipient-key provenance — a malicious server could substitute
    // its OWN valid public key as "the recipient's") must be enforced by
    // the invite/sharing protocol layer that calls `seal`/`unseal`, not
    // here. See `docs/ARCHITECTURE.md` "Trzy znane ograniczenia" and
    // `seal`'s own doc comment above.
    let mut ephemeral_canonical = sealed.ephemeral_pk;
    ephemeral_canonical[31] &= 0x7f;
    if is_small_order(&ephemeral_canonical) {
        return Err(CryptoError::InvalidInput(
            "small-order X25519 ephemeral public key",
        ));
    }
    let ephemeral_pk = crypto_box::PublicKey::from(ephemeral_canonical);
    let cbox = crypto_box::ChaChaBox::new(&ephemeral_pk, &my_sk.as_crypto_box());
    let nonce = crypto_box::aead::generic_array::GenericArray::from_slice(&sealed.nonce);
    let plaintext = cbox
        .decrypt(nonce, sealed.ciphertext.as_slice())
        .map_err(|_| CryptoError::Decrypt)?;
    Ok(Zeroizing::new(plaintext))
}

/// Odpieczętuj bezpośrednio do nieprzezroczystego `CollectionKey` — odrzuca
/// dowolny plaintext, który nie ma dokładnie `KEY_LEN` bajtów (nigdy nie
/// ucina, nigdy nie panikuje). Deleguje do `unseal`, więc sprawdzenie
/// długości istnieje w jednym miejscu (WR-06) — wywołujący (np. `pv-wasm`)
/// nie musi powtarzać tej logiki.
pub fn unseal_collection_key(
    my_sk: &IdentitySecretKey,
    sealed: &SealedKey,
) -> Result<crate::items::CollectionKey, CryptoError> {
    let plain = unseal(my_sk, sealed)?;
    if plain.len() != KEY_LEN {
        return Err(CryptoError::Decrypt);
    }
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&plain);
    // `plain` (`Zeroizing<Vec<u8>>`) wipes itself on drop at the end of this
    // function's scope — no manual zeroize needed for it.
    let out = crate::items::CollectionKey::from_bytes(k);
    // `[u8; KEY_LEN]` is `Copy` — `from_bytes` copied `k`, it did not move
    // it (WR-01). Wipe our own copy explicitly.
    k.zeroize();
    Ok(out)
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
        let pk2 = IdentityPublicKey::from_bytes(pk.to_bytes())
            .expect("a real generated public key must never be small-order");
        assert_eq!(pk, pk2);
    }

    /// CR-01 regression: every one of the 7 known small-order encodings
    /// must be rejected by `from_bytes` — this is the exact boundary that
    /// was completely unvalidated before the fix (any of these reaching
    /// `seal()` makes the sealed Collection Key recoverable by anyone).
    #[test]
    fn from_bytes_rejects_all_small_order_points() {
        for candidate in SMALL_ORDER_POINTS.iter() {
            assert!(
                matches!(
                    IdentityPublicKey::from_bytes(*candidate),
                    Err(CryptoError::InvalidInput(_))
                ),
                "expected small-order point to be rejected: {candidate:02x?}"
            );
        }
    }

    /// CR-01 regression, explicit attack-vector framing (matches the
    /// review's PoC vectors literally): the all-zero recipient public key
    /// must never reach a constructed `IdentityPublicKey`.
    #[test]
    fn from_bytes_rejects_all_zero_public_key() {
        assert!(matches!(
            IdentityPublicKey::from_bytes([0u8; KEY_LEN]),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    /// CR-01 regression, explicit attack-vector framing: `u = 1` (a
    /// small-order point) must never reach a constructed
    /// `IdentityPublicKey`.
    #[test]
    fn from_bytes_rejects_u_equals_one_public_key() {
        let mut bytes = [0u8; KEY_LEN];
        bytes[0] = 1;
        assert!(matches!(
            IdentityPublicKey::from_bytes(bytes),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    /// WR-04 regression: bit 255 is ignored by the X25519 field decode, so
    /// two encodings differing only in that bit must canonicalize to the
    /// same `IdentityPublicKey` (and therefore compare equal).
    #[test]
    fn from_bytes_canonicalizes_bit_255_alias() {
        let sk = IdentitySecretKey::generate();
        let pk = sk.public_key();
        let mut aliased = pk.to_bytes();
        aliased[31] |= 0x80;
        let pk2 = IdentityPublicKey::from_bytes(aliased)
            .expect("bit-255 alias of a real public key must still be accepted");
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

    /// Task 2, Test 1: seal/unseal round-trips to identical bytes.
    ///
    /// NOTE: this test uses ONE keypair (seal to its public half, unseal with
    /// its secret half) — the fresh per-seal ephemeral keypair is what makes
    /// that a meaningful round trip rather than a no-op. The genuinely
    /// cross-party property (Alice seals holding only Bob's PUBLISHED public
    /// bytes) is proven by `seal_with_recipient_public_key_only_cross_party`
    /// in `pv-wasm`, not here. An earlier version of this comment claimed
    /// "two independently-generated keypairs", which the body never did.
    #[test]
    fn seal_unseal_roundtrip() {
        let recipient_a = IdentitySecretKey::generate();
        let payload = [0x7Au8; 32]; // Collection-Key-shaped: 32 bytes.

        let sealed = seal(&recipient_a.public_key(), &payload).unwrap();
        let opened = unseal(&recipient_a, &sealed).unwrap();

        // `opened` is `Zeroizing<Vec<u8>>` (WR-06) — deref to `Vec<u8>` for
        // the comparison.
        assert_eq!(*opened, payload.to_vec());
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

    /// CR-01, second boundary: `SealedKey.ephemeral_pk` has NO validating
    /// constructor (unlike `IdentityPublicKey`) and arrives from untrusted
    /// storage. A forged blob with a small-order `ephemeral_pk` must be
    /// rejected by `unseal` itself, not just by `IdentityPublicKey::from_bytes`
    /// (which this forged blob never passes through at all).
    #[test]
    fn unseal_rejects_small_order_ephemeral_public_key() {
        let recipient = IdentitySecretKey::generate();
        let forged = SealedKey {
            ephemeral_pk: [0u8; KEY_LEN], // all-zero: order-1 identity point.
            nonce: vec![0u8; NONCE_LEN],
            ciphertext: vec![0u8; 48],
        };
        assert!(matches!(
            unseal(&recipient, &forged),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    /// Same boundary, `u = 1` vector.
    #[test]
    fn unseal_rejects_u_equals_one_ephemeral_public_key() {
        let recipient = IdentitySecretKey::generate();
        let mut ephemeral_pk = [0u8; KEY_LEN];
        ephemeral_pk[0] = 1;
        let forged = SealedKey {
            ephemeral_pk,
            nonce: vec![0u8; NONCE_LEN],
            ciphertext: vec![0u8; 48],
        };
        assert!(matches!(
            unseal(&recipient, &forged),
            Err(CryptoError::InvalidInput(_))
        ));
    }

    /// WR-06 regression: `unseal_collection_key` rejects a plaintext that
    /// isn't exactly `KEY_LEN` bytes instead of panicking/truncating, and
    /// centralizes the length check that `pv-wasm` used to duplicate.
    #[test]
    fn unseal_collection_key_rejects_wrong_length_plaintext() {
        let recipient = IdentitySecretKey::generate();
        let sealed = seal(&recipient.public_key(), b"too short").unwrap();
        assert!(matches!(
            unseal_collection_key(&recipient, &sealed),
            Err(CryptoError::Decrypt)
        ));
    }

    /// WR-06 regression: the happy path round-trips through the new
    /// `CollectionKey`-returning helper.
    #[test]
    fn unseal_collection_key_roundtrip() {
        let recipient = IdentitySecretKey::generate();
        let payload = [0x11u8; KEY_LEN];
        let sealed = seal(&recipient.public_key(), &payload).unwrap();
        let ck = unseal_collection_key(&recipient, &sealed).unwrap();
        assert_eq!(ck.expose(), &payload);
    }

    /// SEC-07 (Plan 25-05, Task 2): 200 independent Collection Key seals
    /// (each to a distinct simulated recipient) must produce 200
    /// pairwise-distinct nonces — the SealedKey-side twin of
    /// `items::nonce_uniqueness_large_batch_of_item_key_rewraps`.
    #[test]
    fn nonce_uniqueness_large_batch_of_collection_key_seals() {
        use std::collections::HashSet;

        let ck = crate::items::CollectionKey::generate();
        let mut nonces = Vec::with_capacity(200);
        for _ in 0..200 {
            let recipient_sk = IdentitySecretKey::generate();
            let sealed = seal(&recipient_sk.public_key(), ck.expose()).unwrap();
            nonces.push(sealed.nonce);
        }
        let unique: HashSet<_> = nonces.iter().collect();
        assert_eq!(unique.len(), 200, "all 200 seal nonces must be pairwise-distinct");
    }
}
