//! pv-ffi — cienka warstwa UniFFI wokół pv-core (iOS/Swift odpowiednik
//! `crates/pv-wasm`).
//!
//! Surowe bajty kluczy nigdy nie przekraczają granicy Swift/Rust jako
//! `Vec<u8>`/`&[u8]` — tylko nieprzezroczyste handle (patrz `FfiUserKey`,
//! `FfiWrappingKey`). Rozpakowanie klucza poza handle (np. dodanie metody
//! zwracającej surowe bajty) zostawiłoby niezerowalną kopię w pamięci
//! Swift — dlatego zwykły sposób, by materiał klucza "opuścił" handle, to
//! skarmienie go do `wrap_user_key`/`encrypt_item`, które produkują
//! ciphertext, nie sekret.
//!
//! SANKCJONOWANY WYJĄTEK OD TEJ REGUŁY (FFI-03, IOS-06 decision record —
//! `ios/IOS-SPIKE-LOG.md` §1): `export_user_key_for_session`/
//! `import_user_key_from_session` celowo przepuszczają surowe bajty
//! `FfiUserKey` jako `Vec<u8>` — jedyne miejsce w tym crate, gdzie tak się
//! dzieje. Powód RÓŻNI SIĘ od `pv-wasm`'s uzasadnienia (MV3 service worker
//! idle-kill): na iOS host app i (przyszłe, Faza 36+) rozszerzenie AutoFill
//! to DWA niezależnie planowane procesy systemowe BEZ współdzielonej
//! pamięci — App Groups i Keychain access groups to współdzielenie na
//! poziomie storage, nie pamięci. Ta para funkcji jest więc JEDYNĄ drogą,
//! którą odblokowany vault dociera do drugiego procesu — normalnym,
//! trwałym mechanizmem, nie jednorazowym wyjątkiem.
//!
//! CP-4 RESIDUAL RISK (strukturalny, nie do zamknięcia na tej granicy):
//! `pv-wasm`'s `import_user_key_from_session`/`from_password` biorą
//! `&mut [u8]`, co pozwala wasm-bindgen's mutable-slice marshalingowi
//! skopiować bufor wywołującego (JS) z powrotem WYZEROWANY po wywołaniu.
//! UniFFI NIE MA odpowiednika — `&mut [u8]`/`&mut Vec<u8>` nie są
//! poprawnymi typami argumentów `#[uniffi::export]` (istnieją tylko
//! niemutowalne `&[u8]` i własne `Vec<u8>`/`bytes`). Dlatego
//! `export_user_key_for_session`/`import_user_key_from_session` poniżej
//! biorą WŁASNE (owned) `Vec<u8>`: Rust zeruje WYŁĄCZNIE swoją kopię —
//! oryginalny bufor `Data`/`[UInt8]` po stronie Swift NIE jest retroaktywnie
//! wyzerowany przez samo wywołanie. To zaakceptowane, ograniczone ryzyko
//! rezydualne (ta sama postawa, którą `pv-wasm`'s własny nagłówek już
//! przyjmuje dla JS) — mitygacja po stronie wywołującego:
//! `data.resetBytes(in: 0..<data.count)` w Swift natychmiast po powrocie z
//! wywołania. Pełny zapis decyzji: `ios/IOS-SPIKE-LOG.md` §1, "Un-zeroized
//! Swift copies".
//!
//! `Result` NA KAŻDYM EKSPORCIE, KTÓRY MOŻE PANIKOWAĆ (WR-01, review Fazy
//! 35). UniFFI generuje swiftowy wrapper `throws` WYŁĄCZNIE dla funkcji,
//! której sygnatura w Ruście zwraca `Result<T, E: uniffi::Error>`; goły
//! zwrot generuje wrapper NIE-throwing, który rozpakowuje wywołanie przez
//! `try!` — więc panika, którą `catch_unwind` FAKTYCZNIE złapał, zamienia
//! się po stronie Swifta w niełapalny `fatalError` (patrz `panic_probe.rs`).
//! Pełny audyt wszystkich `#[uniffi::export]` w tym crate:
//!
//! | funkcja                        | zwraca                | panic path? |
//! |--------------------------------|-----------------------|-------------|
//! | `FfiUserKey::generate`         | `Result<Arc<Self>,_>` | TAK — `OsRng::fill_bytes` panikuje (`rand_core-0.6.4/src/os.rs:61-65`) |
//! | `FfiWrappingKey::from_password`| `Result<Arc<Self>,_>` | argon2/serde — złapane jako `Err` |
//! | `wrap_user_key`                | `Result<_,_>`         | — |
//! | `unwrap_user_key`              | `Result<_,_>`         | — |
//! | `encrypt_item`                 | `Result<_,_>`         | — |
//! | `decrypt_item`                 | `Result<_,_>`         | — |
//! | `import_user_key_from_session` | `Result<_,_>`         | — |
//! | `ffi06_synthetic_panic_probe`  | `Result<_,_>`         | TAK (syntetyczna, patrz `panic_probe.rs`) |
//! | `export_user_key_for_session`  | `Vec<u8>` (BEZ `Result`) | NIE — patrz niżej |
//!
//! `export_user_key_for_session` to JEDYNY eksport bez `Result`, świadomie:
//! jego całe ciało to `expose().to_vec()`. Jedyna droga do paniki byłaby
//! przez błąd alokacji, a ten w Ruście jest `abort`em, nie odwijaniem stosu
//! — `catch_unwind` i tak by go nie zobaczył, więc `Result` niczego by tu
//! nie kupił. Gdyby ta funkcja kiedykolwiek zyskała logikę mogącą panikować,
//! MUSI dostać `Result`.
//!
//! P2: `pv-core` NIGDY nie jest modyfikowany, by dopasować się do UniFFI.
//! Każdy impedance mismatch (ten plik, `FfiError` owijający
//! `CryptoError`'s `&'static str`, rozbieżność `&mut [u8]` -> `Vec<u8>`
//! powyżej) jest absorbowany tutaj — dokładnie tak, jak `pv-wasm` robi to
//! dla JS.

uniffi::setup_scaffolding!();

use std::sync::Arc;

use pv_core::{
    items::{decrypt_item as core_decrypt_item, encrypt_item as core_encrypt_item, EncryptedItem},
    kdf::{wrapping_key_from_password, KdfParams},
    keys::{
        unwrap_user_key as core_unwrap_user_key, wrap_user_key as core_wrap_user_key, UserKey,
        WrappedKey, KEY_LEN,
    },
};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub mod error;
pub use error::FfiError;

// TEST-ONLY (`#[cfg(test)]`): observes what this crate actually hands back
// to the allocator, so the CR-01 zeroization regression is asserted on real
// freed bytes rather than on the shape of the source. Never compiled into
// the iOS staticlib — see the module's own doc comment.
#[cfg(test)]
mod heap_probe;

// FFI-06/CP-3 synthetic panic probe — see crates/pv-ffi/src/panic_probe.rs's
// own module doc for the full "synthetic, never called by production code"
// disclosure. Feature-gated (`ffi06-probe`, default-on).
mod panic_probe;

/// Nieprzezroczysty handle User Key — korzeń dostępu do vaulta. Jedyny
/// sposób, by "użyć" klucza spoza handle, to funkcje wrap/encrypt poniżej
/// (i export/import session pair, patrz nagłówek modułu). Brak Zeroize
/// derive tutaj — deleguje do `UserKey`'s własnego `ZeroizeOnDrop` (mirror
/// `pv-wasm`'s `WasmUserKey`).
#[derive(uniffi::Object)]
pub struct FfiUserKey(UserKey);

#[uniffi::export]
impl FfiUserKey {
    /// DELIBERATELY returns `Result<_, FfiError>` although it never produces
    /// `Err` — the same load-bearing reason `panic_probe.rs`'s probe does
    /// (35-05): UniFFI emits a Swift `throws` wrapper ONLY for a Rust
    /// signature returning `Result<T, E: uniffi::Error>`. A bare return
    /// generates a NON-throwing wrapper that force-unwraps with `try!`, so a
    /// panic that `catch_unwind` DID catch is then converted by the generated
    /// Swift into an uncatchable `fatalError` — a process kill, which in an
    /// AutoFill extension is the worst possible outcome.
    ///
    /// This function has a genuine panic path, so that is not theoretical
    /// (WR-01, review Fazy 35): `UserKey::generate()` calls
    /// `OsRng.fill_bytes`, and `rand_core-0.6.4/src/os.rs:61-65` is
    /// literally `if let Err(e) = self.try_fill_bytes(dest) { panic!(...) }`.
    /// Remote on iOS; not structurally impossible, and exactly the class of
    /// failure where a catchable error matters.
    #[uniffi::constructor]
    pub fn generate() -> Result<Arc<Self>, FfiError> {
        Ok(Arc::new(FfiUserKey(UserKey::generate())))
    }
}

/// Nieprzezroczysty handle klucza wrapującego (pochodzącego z hasła).
/// Swift trzyma tylko ten struct — surowe bajty nigdy nie są zwracane.
#[derive(Zeroize, ZeroizeOnDrop, uniffi::Object)]
pub struct FfiWrappingKey([u8; KEY_LEN]);

#[uniffi::export]
impl FfiWrappingKey {
    /// `password`/`salt` to bufory wywołującego (Swift `Data`), przyjęte
    /// jako własne `Vec<u8>` — UniFFI nie ma `&mut [u8]` (patrz nagłówek
    /// modułu, CP-4). Rust zeruje WYŁĄCZNIE swoją kopię `password` — ale
    /// robi to na KAŻDEJ ścieżce wyjścia, bo wyzerowanie jest własnością
    /// TYPU (`Zeroizing<Vec<u8>>`'s `Drop`), nie kolejnością instrukcji.
    /// Bufor po stronie Swift pozostaje odpowiedzialnością wywołującego.
    ///
    /// CR-01 (review Fazy 35) — dlaczego to musi być własność typu: wersja
    /// z jawnym `password.zeroize()` PO parsowaniu JSON-a nigdy nie
    /// wykonywała się na ścieżce `?`-return z `serde_json::from_str`, a
    /// `kdf_params_json` pochodzi z odpowiedzi NIEZAUFANEGO serwera
    /// (`POST /api/auth/prelogin`). Wrogi serwer mógł więc DETERMINISTYCZNIE,
    /// przy każdej próbie odblokowania, oddać master password alokatorowi z
    /// nietkniętymi bajtami, zwracając zepsuty JSON. `Vec<u8>` nie jest
    /// `ZeroizeOnDrop`. Regresja pilnowana przez
    /// `tests::from_password_zeroizes_its_password_copy_on_the_parse_error_path`,
    /// które patrzy na FAKTYCZNIE zwolnione bajty (`crate::heap_probe`), a
    /// nie na kształt kodu.
    #[uniffi::constructor]
    pub fn from_password(
        password: Vec<u8>,
        salt: Vec<u8>,
        kdf_params_json: String,
    ) -> Result<Arc<Self>, FfiError> {
        // Wipe-on-every-exit-path, including the `?` below and a panic
        // unwind — not just the paths we remembered to write out (CR-01).
        let password = Zeroizing::new(password);
        let params: KdfParams = serde_json::from_str(&kdf_params_json)
            .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
        let wk = wrapping_key_from_password(&password, &salt, &params)?;
        Ok(Arc::new(FfiWrappingKey(*wk)))
    }
}

/// Mirror `pv_core::keys::WrappedKey` dokładnie: `nonce`/`ciphertext`.
/// Native UniFFI Record (Swift struct z polami `Data`), NIE JSON string —
/// per 35-RESEARCH.md's Open Question 3 recommendation.
#[derive(uniffi::Record)]
pub struct FfiWrappedKey {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
}

impl From<WrappedKey> for FfiWrappedKey {
    fn from(w: WrappedKey) -> Self {
        FfiWrappedKey { nonce: w.nonce, ciphertext: w.ciphertext }
    }
}

impl From<FfiWrappedKey> for WrappedKey {
    fn from(w: FfiWrappedKey) -> Self {
        WrappedKey { nonce: w.nonce, ciphertext: w.ciphertext }
    }
}

/// Mirror `pv_core::items::EncryptedItem`'s dokładny dwupolowy kształt.
#[derive(uniffi::Record)]
pub struct FfiEncryptedItem {
    pub enc_key: FfiWrappedKey,
    pub enc_data: FfiWrappedKey,
}

impl From<EncryptedItem> for FfiEncryptedItem {
    fn from(item: EncryptedItem) -> Self {
        FfiEncryptedItem { enc_key: item.enc_key.into(), enc_data: item.enc_data.into() }
    }
}

impl From<FfiEncryptedItem> for EncryptedItem {
    fn from(item: FfiEncryptedItem) -> Self {
        EncryptedItem { enc_key: item.enc_key.into(), enc_data: item.enc_data.into() }
    }
}

#[uniffi::export]
pub fn wrap_user_key(
    wrapping_key: &FfiWrappingKey,
    user_key: &FfiUserKey,
) -> Result<FfiWrappedKey, FfiError> {
    let blob = core_wrap_user_key(&wrapping_key.0, &user_key.0)?;
    Ok(blob.into())
}

#[uniffi::export]
pub fn unwrap_user_key(
    wrapping_key: &FfiWrappingKey,
    wrapped: FfiWrappedKey,
) -> Result<Arc<FfiUserKey>, FfiError> {
    let blob: WrappedKey = wrapped.into();
    let uk = core_unwrap_user_key(&wrapping_key.0, &blob)?;
    Ok(Arc::new(FfiUserKey(uk)))
}

#[uniffi::export]
pub fn encrypt_item(
    user_key: &FfiUserKey,
    plaintext: String,
    item_id: String,
    revision: u32,
) -> Result<FfiEncryptedItem, FfiError> {
    let item = core_encrypt_item(&user_key.0, plaintext.as_bytes(), &item_id, revision)?;
    Ok(item.into())
}

#[uniffi::export]
pub fn decrypt_item(
    user_key: &FfiUserKey,
    item: FfiEncryptedItem,
    item_id: String,
    revision: u32,
) -> Result<String, FfiError> {
    let item: EncryptedItem = item.into();
    let mut plaintext = core_decrypt_item(&user_key.0, &item, &item_id, revision)?;
    // `Zeroizing<Vec<u8>>` — move the inner `Vec<u8>` out via `mem::take`
    // (mirrors `pv-wasm`'s `decrypt_item`/WR-12 discipline) instead of
    // `.clone()`ing the plaintext.
    let bytes = std::mem::take(&mut *plaintext);
    String::from_utf8(bytes).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

// SANKCJONOWANY WYJĄTEK (FFI-03, patrz nagłówek modułu) — jedyna para
// funkcji poza konstruktorami, które przepuszczają surowe bajty User Key
// przez granicę Swift/Rust. `export_user_key_for_session` jest jawnie
// nazwana i audytowalna; nic innego w tym pliku nie zwraca surowych bajtów
// klucza.
#[uniffi::export]
pub fn export_user_key_for_session(user_key: &FfiUserKey) -> Vec<u8> {
    user_key.0.expose().to_vec()
}

/// Odwrotność `export_user_key_for_session` — odtwarza `FfiUserKey` z jego
/// wyeksportowanych bajtów. Odrzuca KAŻDE wejście, którego długość nie jest
/// dokładnie 32 bajty, z catchable `FfiError` — NIGDY nie ucina, nie
/// dopełnia zerami, nie akceptuje krótszego bufora. Zeruje WYŁĄCZNIE
/// własną (Rust-ową) kopię `bytes` niezależnie od wyniku — oryginalny
/// bufor po stronie Swift NIE jest retroaktywnie wyzerowany (CP-4, patrz
/// nagłówek modułu).
///
/// Ta funkcja była poprawna także w wersji z dwoma jawnymi wywołaniami
/// `bytes.zeroize()` — ale tylko dlatego, że OBIE ścieżki wyjścia akurat je
/// wołały. Jedno dodane `?` odtworzyłoby CR-01 tutaj, więc wyzerowanie jest
/// teraz własnością typu (`Zeroizing<Vec<u8>>`), tak samo jak w
/// `FfiWrappingKey::from_password`.
#[uniffi::export]
pub fn import_user_key_from_session(bytes: Vec<u8>) -> Result<Arc<FfiUserKey>, FfiError> {
    let bytes = Zeroizing::new(bytes);
    if bytes.len() != KEY_LEN {
        return Err(FfiError::InvalidInput("expected 32 bytes".to_string()));
    }
    let mut arr = [0u8; KEY_LEN];
    arr.copy_from_slice(&bytes);
    let out = FfiUserKey(UserKey::from_bytes(arr));
    // `[u8; KEY_LEN]` is `Copy` — `UserKey::from_bytes` copied `arr`, it did
    // not move it (mirrors pv-core/pv-wasm's own WR-01 discipline). Wipe our
    // own copy explicitly.
    arr.zeroize();
    Ok(Arc::new(out))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::heap_probe::{Probe, SENTINEL};

    /// Deliberately cheap Argon2id params — this phase does not measure KDF
    /// memory (that is Phase 36's FILL-06 job); mirrors `pv-core::kdf`'s own
    /// `test_params()`. NEVER the production default (64 MiB / t=3 / p=4).
    fn cheap_kdf_params_json() -> String {
        serde_json::to_string(&KdfParams { m_cost_kib: 8 * 1024, t_cost: 1, p_cost: 1 })
            .expect("KdfParams always serializes")
    }

    /// Test 1 (RED first, per this task's TDD discipline): mirrors
    /// `pv-wasm`'s `full_roundtrip` — generate -> wrap -> unwrap -> encrypt
    /// -> decrypt, byte-for-byte plaintext equality.
    #[test]
    fn full_roundtrip() {
        let salt = pv_core::keys::random_bytes(16);
        let kdf_json = cheap_kdf_params_json();
        let password = b"test-password".to_vec();
        let wrapping_key = FfiWrappingKey::from_password(password, salt, kdf_json)
            .expect("from_password should succeed");
        let user_key = FfiUserKey::generate().expect("generate is infallible today");
        let wrapped = wrap_user_key(&wrapping_key, &user_key).expect("wrap should succeed");
        let unwrapped = unwrap_user_key(&wrapping_key, wrapped).expect("unwrap should succeed");
        let item = encrypt_item(
            &unwrapped,
            "{\"type\":\"note\",\"body\":\"fixture\"}".to_string(),
            "self-test-item".to_string(),
            1,
        )
        .expect("encrypt should succeed");
        let plaintext = decrypt_item(&unwrapped, item, "self-test-item".to_string(), 1)
            .expect("decrypt should succeed");
        assert_eq!(plaintext, "{\"type\":\"note\",\"body\":\"fixture\"}");
    }

    /// Test 2: export/import session round trip — captures the original 32
    /// exposed bytes as an owned array BEFORE calling export (mirrors
    /// `pv-wasm`'s `export_import_user_key_roundtrip` discipline: comparing
    /// against a second, unrelated `generate()` call would be wrong).
    #[test]
    fn export_import_user_key_roundtrip() {
        let uk = FfiUserKey::generate().expect("generate is infallible today");
        let original: [u8; 32] = *uk.0.expose();
        let exported = export_user_key_for_session(&uk);
        let imported = import_user_key_from_session(exported).expect("import should succeed");
        assert_eq!(imported.0.expose(), &original);
    }

    /// Test 3: `import_user_key_from_session` rejects a 16-byte input with
    /// `Err`, never truncating/zero-padding/accepting it (mirrors
    /// `pv-wasm`'s `import_user_key_from_session_rejects_wrong_length`).
    #[test]
    fn import_user_key_from_session_rejects_wrong_length() {
        let short = vec![0u8; 16];
        let result = import_user_key_from_session(short);
        assert!(result.is_err());
    }

    /// CR-01 regression (Faza 35 code review). RED before the fix, green
    /// after: on `from_password`'s `kdf_params_json` parse-error path — the
    /// path an UNTRUSTED server reaches at will by returning malformed JSON
    /// from `POST /api/auth/prelogin` — the Rust-owned heap copy of the
    /// master password must not reach the allocator with its bytes intact.
    ///
    /// Deliberately NOT a source-shape assertion: this observes the bytes of
    /// the block actually being freed (`crate::heap_probe`). And it carries
    /// its own control, so it cannot pass because the probe is blind rather
    /// than because the wipe happened.
    #[test]
    fn from_password_zeroizes_its_password_copy_on_the_parse_error_path() {
        let salt = pv_core::keys::random_bytes(16);

        let probe = Probe::arm();
        let password = SENTINEL.to_vec();
        let result = FfiWrappingKey::from_password(
            password,
            salt,
            "{ this is not valid KdfParams JSON }".to_string(),
        );
        let leaked = probe.sentinel_reached_allocator();
        drop(probe);

        assert!(result.is_err(), "malformed kdf_params_json must be rejected");
        assert!(
            !leaked,
            "the master password's Rust-owned heap copy was released to the allocator with its \
             bytes intact on from_password's early-return path (CR-01)"
        );

        // Control: the probe genuinely CAN see an un-zeroized buffer of
        // exactly this shape going back to the allocator. Without this, the
        // assertion above would be a check that cannot fail.
        let control = Probe::arm();
        drop(std::hint::black_box(SENTINEL.to_vec()));
        let control_saw_it = control.sentinel_reached_allocator();
        drop(control);
        assert!(
            control_saw_it,
            "heap probe control FAILED: the probe cannot observe an un-zeroized sentinel buffer \
             at all, so the assertion above proves nothing"
        );
    }

    /// Test 4: unwrapping with the wrong wrapping key fails (`Err`, never a
    /// silently-wrong key) — mirrors `pv-wasm`'s `wrong_password_fails_to_unwrap`.
    #[test]
    fn wrong_wrapping_key_fails_to_unwrap() {
        let salt = pv_core::keys::random_bytes(16);
        let kdf_json = cheap_kdf_params_json();
        let correct_wrapping_key = FfiWrappingKey::from_password(
            b"correct-password".to_vec(),
            salt.clone(),
            kdf_json.clone(),
        )
        .expect("from_password should succeed");
        let user_key = FfiUserKey::generate().expect("generate is infallible today");
        let wrapped =
            wrap_user_key(&correct_wrapping_key, &user_key).expect("wrap should succeed");

        let other_wrapping_key =
            FfiWrappingKey::from_password(b"different-password".to_vec(), salt, kdf_json)
                .expect("from_password should succeed");
        let result = unwrap_user_key(&other_wrapping_key, wrapped);
        assert!(result.is_err());
    }
}
