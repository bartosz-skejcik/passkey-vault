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
//! | `derive_auth_material`         | `Result<FfiAuthMaterial,_>` | argon2/serde — złapane jako `Err` (identyczny kształt co `from_password`, ten sam CR-01/WR-11 tor) |
//! | `wrap_user_key_json`           | `Result<String,_>`    | — |
//! | `unwrap_user_key_from_json`    | `Result<Arc<FfiUserKey>,_>` | — |
//! | `default_kdf_params_json`      | `String` (BEZ `Result`) | NIE — `serde_json::to_string` na stałym `KdfParams::default()`; mirror `pv-wasm`'s bezargumentowego odpowiednika, ten sam brak `Result` |
//! | `generate_registration_salt`   | `Vec<u8>` (BEZ `Result`) | NIE — `random_bytes(16)`, jawna sól (nie materiał klucza), ten sam kształt co `export_user_key_for_session` poniżej (jedyna panika byłaby alokacyjnym `abort`em, którego `catch_unwind` i tak nie zobaczy) |
//! | `export_user_key_for_session`  | `Vec<u8>` (BEZ `Result`) | NIE — patrz niżej |
//! | `encrypt_item_wire`            | `Result<FfiEncryptedItemWire,_>` | serde_json — złapane jako `Err` (38-02, DR-38-C; patrz `wire.rs`) |
//! | `decrypt_item_wire`            | `Result<String,_>`    | serde_json/utf8 — złapane jako `Err` |
//! | `encrypt_item_combined_json`   | `Result<String,_>`    | serde_json — złapane jako `Err` |
//! | `decrypt_item_combined_json`   | `Result<String,_>`    | serde_json/utf8 — złapane jako `Err` |
//! | `FfiIdentityKey::generate`     | `Result<Arc<Self>,_>` | TAK — ten sam `OsRng::fill_bytes` tor co `FfiUserKey::generate` (`sharing.rs`) |
//! | `FfiIdentityKey::public_key_bytes` | `Vec<u8>` (BEZ `Result`) | NIE — klucz PUBLICZNY, publikowalny z założenia |
//! | `FfiIdentityPublicKey::from_bytes` | `Result<Arc<Self>,_>` | długość/small-order — złapane jako `Err` |
//! | `wrap_identity_secret_key`     | `Result<String,_>`    | serde_json — złapane jako `Err` |
//! | `unwrap_identity_secret_key`   | `Result<Arc<FfiIdentityKey>,_>` | serde_json — złapane jako `Err` |
//! | `FfiCollectionKey::generate`   | `Result<Arc<Self>,_>` | TAK — ten sam `OsRng::fill_bytes` tor |
//! | `seal_collection_key`          | `Result<String,_>`    | serde_json — złapane jako `Err` |
//! | `unseal_collection_key`        | `Result<Arc<FfiCollectionKey>,_>` | serde_json/small-order — złapane jako `Err` |
//! | `encrypt_item_for_collection`  | `Result<String,_>`    | serde_json — złapane jako `Err` |
//! | `decrypt_item_for_collection`  | `Result<String,_>`    | serde_json/utf8 — złapane jako `Err` |
//! | `rewrap_item_key_for_collection` | `Result<String,_>`  | serde_json — złapane jako `Err` (40-03) |
//! | `seal_item_key_for_recipient`  | `Result<String,_>`    | serde_json — złapane jako `Err` (40-03) |
//! | `decrypt_item_with_shared_key` | `Result<String,_>`    | serde_json/utf8 — złapane jako `Err` (40-03) |
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

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
use pv_core::{
    items::{decrypt_item as core_decrypt_item, encrypt_item as core_encrypt_item, EncryptedItem},
    kdf::{wrapping_key_from_password, KdfParams},
    keys::{
        hkdf_expand_key, random_bytes, unwrap_user_key as core_unwrap_user_key,
        wrap_user_key as core_wrap_user_key, UserKey, WrappedKey, INFO_AUTH_HASH, INFO_PW_UNLOCK,
        KEY_LEN,
    },
};
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

pub mod error;
pub use error::FfiError;

// DR-38-C (`ios/IOS-SPIKE-LOG.md` §1a): the JSON wire encoding of the item
// and folder columns is produced by `serde_json` HERE, never by Swift's
// `JSONEncoder` — see that module's own header for why the two shapes
// (record-shaped `encrypt_item`/`decrypt_item` above, JSON-string-shaped
// `*_wire`/`*_combined_json` there) deliberately coexist and which one the
// persistence path must use.
pub mod wire;
pub use wire::{
    decrypt_item_combined_json, decrypt_item_wire, encrypt_item_combined_json, encrypt_item_wire,
    FfiEncryptedItemWire,
};

// UI-06 / DR-38-A (`ios/IOS-SPIKE-LOG.md` §1a): the password/passphrase
// generator, exported as free functions taking no `FfiUserKey` -- see that
// module's own header for the full rationale and the measured wasm-size
// decision.
pub mod generator;
pub use generator::{
    generate_character_password, generate_passphrase, generator_bounds,
    FfiCharacterPasswordOptions, FfiGeneratorBounds,
};

// UI-05 (`ios/IOS-SPIKE-LOG.md` §1f): TOTP code generation, exported as a
// free function -- see that module's own header for the secret-as-plain-
// string rationale (mirroring `pv-wasm`'s `totpNow`) and the `usize`/`u32`
// cast this file absorbs.
pub mod totp;
pub use totp::{totp_now, FfiTotpCode};

// Phase 40 (rodzina-i-współdzielenie-na-telefonie), plans 40-02/40-03: X25519
// identity keypairs and Collection Keys -- see that module's own header for
// DR-40-A (the `String`-via-`serde_json` wire contract every export here
// follows) and for the Rule-2 rationale behind
// `encrypt_item_for_collection`/`decrypt_item_for_collection` living there
// already, ahead of plan 40-03's own scope.
pub mod sharing;
pub use sharing::{
    decrypt_item_for_collection, decrypt_item_with_shared_key, encrypt_item_for_collection,
    rewrap_item_key_for_collection, seal_collection_key, seal_item_key_for_recipient,
    unseal_collection_key, unwrap_identity_secret_key, wrap_identity_secret_key, FfiCollectionKey,
    FfiIdentityKey, FfiIdentityPublicKey,
};

// TEST-ONLY (`#[cfg(test)]`): observes what this crate actually hands back
// to the allocator, so the CR-01 zeroization regression is asserted on real
// freed bytes rather than on the shape of the source. Never compiled into
// the iOS staticlib — see the module's own doc comment.
#[cfg(test)]
mod heap_probe;

// FFI-06/CP-3 synthetic panic probe — see crates/pv-ffi/src/panic_probe.rs's
// own module doc for the full "synthetic, never called by production code"
// disclosure. Feature-gated (`ffi06-probe`, default-on).
//
// The gate belongs on the MODULE DECLARATION, not only on the `impl` inside
// it (WR-04, review Fazy 35): with only the inner `impl` gated, the module's
// `use` and its `PANIC_SENTINEL` const still compiled under
// `--no-default-features`, producing two warnings. That is precisely the
// configuration this crate's own Cargo.toml DEBT note instructs a later
// phase to adopt, so the noise would have landed on whoever does the flip,
// at the moment they are least able to tell it apart from a real problem.
#[cfg(feature = "ffi06-probe")]
mod panic_probe;

// Phase 36, Plan 36-03 (E5.c) diagnostic-only probe constructor — see
// crates/pv-ffi/src/kdf_probe.rs's own module doc for the full rationale
// (skips ONLY validate_kdf_params's upper bound, for one fixed 256 MiB
// diagnostic value that is never server-supplied). Feature-gated
// (`kdf-probe`, default-off), mirroring `ffi06-probe`'s gate placement on
// the module DECLARATION rather than only the inner `impl` (WR-04).
#[cfg(feature = "kdf-probe")]
mod kdf_probe;

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

// --- Server-supplied KdfParams bounds (WR-11, review Fazy 35) -----------
//
// `kdf_params_json` reaches this boundary from the server's
// `POST /api/auth/prelogin` response. In a zero-knowledge product that input
// is UNTRUSTED by construction — the whole premise is that the server may be
// hostile or compromised.
//
// Why an unvalidated `m_cost_kib` is worse than an ordinary bad input:
// `argon2::Params::new` accepts `m_cost_kib` all the way up to `0x0FFFFFFF`
// (256 GiB) and then Argon2id allocates — and WRITES — a block array of
// exactly that size. Whichever way that ends, `catch_unwind` (the mechanism
// the whole IOS-06 panic-safety argument rests on) never sees it and no
// `FfiError` ever reaches Swift:
//
//   * where the allocator REFUSES the request, Rust calls
//     `handle_alloc_error`, which is an `abort` — not an unwind;
//   * where it does not refuse, the process is killed while faulting the
//     pages in. MEASURED, not assumed: on this macOS dev host
//     `Vec::<u8>::with_capacity(268435455 * 1024)` returns a valid pointer
//     (lazy VA reservation, exit 0) on a 16 GB machine — so the *abort*
//     shape the review predicted is only one of the two, and on Darwin the
//     realistic outcome is a memory blow-up rather than a clean abort.
//
// On iOS both shapes are a silent process kill, and inside the AutoFill
// extension a jetsam kill leaves no user-visible trace at all. The check
// therefore has to happen HERE, before anything is allocated, not deeper in
// `pv-core` (P2 — `pv-core` is never modified to suit a binding).
//
// CHOSEN CEILINGS AND THE REASONING, so the numbers are auditable:
//
//   * `MAX_M_COST_KIB = 96 MiB`. The production profile is
//     `KdfParams::default()` = **64 MiB / t=3 / p=4**
//     (`crates/pv-core/src/kdf.rs:20-25`), so this accepts the real
//     parameters with 1.5x headroom — a routine server-side raise (OWASP
//     revising its Argon2id guidance upward) does not need a client release.
//     It is also below the ~120 MB credential-provider ceiling, the only
//     figure anyone has for the tightest process this code is expected to
//     run in, so an ACCEPTED value is never knowingly over that budget while
//     the GiB-class value that turns into an abort is refused outright.
//   * `MAX_T_COST = 10` (production 3) and `MAX_P_COST = 8` (production 4).
//     Neither can abort — an absurd `t_cost` is a hang, not a crash — but an
//     unbounded time multiplier on the unlock path is a denial of service
//     the same untrusted server controls, and bounding them is free.
//
// HONESTY, so nobody over-trusts these constants: 96 MiB is NOT proven
// survivable inside a credential-provider extension. The ~120 MB ceiling is
// weakly sourced (an unattributed vendor KB article), the one real
// measurement that exists (~64.06 MB `phys_footprint` for the 64 MiB
// profile) was taken in a HOST APP process, and even the legitimate default
// may not fit (landmine L-6, `ios/IOS-SPIKE-LOG.md` §3). This is a CRASH
// GUARD, not the memory budget. Phase 36's FILL-06 owns the measured number
// and must tighten these constants once it exists.
//
// UPPER BOUNDS ONLY, deliberately. The same untrusted server can also send
// params that are too WEAK (`{"m_cost_kib":8,"t_cost":1,"p_cost":1}`) — a
// downgrade attack. That is a real issue and it is NOT closed here: the
// answer to it is a policy floor checked against the account's own stored
// parameters (server-side history), not a hardcoded constant at the FFI
// boundary, and a floor here would reject the cheap 8 MiB/t=1/p=1 test
// profile this crate's own tests and `FfiRoundTripTests.swift` both use on
// purpose. Recorded as out of scope, not overlooked.
const MAX_M_COST_KIB: u32 = 96 * 1024;
const MAX_T_COST: u32 = 10;
const MAX_P_COST: u32 = 8;

/// Rejects out-of-range server-supplied Argon2id parameters with a catchable
/// `FfiError` BEFORE `wrapping_key_from_password` allocates anything.
///
/// Returns `InvalidInput` (never `Kdf`) on purpose: `Kdf` is what
/// `argon2::Params::new`'s own validation produces, and the tests
/// discriminate the two so that "the guard fired" cannot be confused with
/// "argon2 happened to reject it anyway".
fn validate_kdf_params(params: &KdfParams) -> Result<(), FfiError> {
    if params.m_cost_kib > MAX_M_COST_KIB {
        return Err(FfiError::InvalidInput(format!(
            "m_cost_kib {} exceeds the accepted maximum {}",
            params.m_cost_kib, MAX_M_COST_KIB
        )));
    }
    if params.t_cost > MAX_T_COST {
        return Err(FfiError::InvalidInput(format!(
            "t_cost {} exceeds the accepted maximum {}",
            params.t_cost, MAX_T_COST
        )));
    }
    if params.p_cost > MAX_P_COST {
        return Err(FfiError::InvalidInput(format!(
            "p_cost {} exceeds the accepted maximum {}",
            params.p_cost, MAX_P_COST
        )));
    }
    Ok(())
}

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
    ///
    /// WR-11 (review Fazy 35) — ten sam NIEZAUFANY `kdf_params_json` steruje
    /// rozmiarem alokacji Argon2id, a nieudana alokacja w Ruście to `abort`,
    /// nie odwinięcie stosu: `catch_unwind` jej NIE widzi i żaden `FfiError`
    /// nie dociera do Swifta. Dlatego `validate_kdf_params` odrzuca wartości
    /// spoza zakresu PRZED jakąkolwiek alokacją — pełne uzasadnienie granic
    /// przy stałych `MAX_*` powyżej.
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
        // BEFORE `wrapping_key_from_password` — that call is where the
        // attacker-sized block array would be allocated (WR-11).
        validate_kdf_params(&params)?;
        let wk = wrapping_key_from_password(&password, &salt, &params)?;
        Ok(Arc::new(FfiWrappingKey(*wk)))
    }
}

/// Wynik jednego przebiegu Argon2id, rozgałęzionego na DWA HKDF-e (37-02) —
/// `wrapping_key` (handle, `INFO_PW_UNLOCK`) i `auth_hash_b64` (jawny
/// `String`, `INFO_AUTH_HASH`, base64 STANDARD). `auth_hash` celowo
/// przekracza granicę jako tekst, nie `Vec<u8>`: to poświadczenie serwerowe,
/// które i tak trafia do ciała JSON jako base64, więc ten kształt trzyma
/// surowe bajty z dala od granicy w ogóle i nie zostawia Swiftowi żadnego
/// własnego kodowania do wykonania. Native UniFFI Record (mirror
/// `FfiWrappedKey`'s own precedent), nie JSON string.
#[derive(uniffi::Record)]
pub struct FfiAuthMaterial {
    pub wrapping_key: Arc<FfiWrappingKey>,
    pub auth_hash_b64: String,
}

/// Jeden przebieg Argon2id -> DWA rozwinięcia HKDF (`INFO_PW_UNLOCK`,
/// `INFO_AUTH_HASH`) — mirror `pv-wasm`'s `derive_auth_material`
/// (`crates/pv-wasm/src/lib.rs:670-683`). NIGDY nie wołać
/// `wrapping_key_from_password` i `auth_hash_from_password` osobno dla tego
/// samego hasła — każda z nich niezależnie uruchamia Argon2id, więc dwa
/// przebiegi 64 MiB to landmine L-6 (`ios/IOS-SPIKE-LOG.md` §3), a nie
/// tylko marnotrawstwo.
///
/// `password` opakowany w `Zeroizing` jako PIERWSZA instrukcja — dokładnie
/// ten sam CR-01 tor co `FfiWrappingKey::from_password`: `kdf_params_json`
/// pochodzi z odpowiedzi NIEZAUFANEGO serwera (`POST /api/auth/prelogin`),
/// a jego błąd parsowania jest `?`-returnem. Wyzerowanie musi być
/// własnością TYPU, nie kolejności instrukcji, albo ten sam bug wróciłby
/// tutaj w nowej funkcji. `validate_kdf_params` (WR-11) odrzuca wartości
/// spoza zakresu PRZED przebiegiem Argon2id poniżej — ta sama alokacyjna
/// przyczyna co w `from_password`.
///
/// Wołanie funkcji Argon2id w pełni kwalifikowane przez `pv_core::kdf::`
/// (nigdy niekwalifikowany `use` tej nazwy) jest CELOWE: dokładnie jedno
/// wystąpienie jej identyfikatora w tym pliku jest samo w sobie
/// sprawdzalnym dowodem "dokładnie jeden przebieg Argon2id na ścieżce
/// auth-material" (37-02 acceptance criterion), a nie tylko deklaracją w
/// prozie.
#[uniffi::export]
pub fn derive_auth_material(
    password: Vec<u8>,
    salt: Vec<u8>,
    kdf_params_json: String,
) -> Result<FfiAuthMaterial, FfiError> {
    let password = Zeroizing::new(password);
    let params: KdfParams = serde_json::from_str(&kdf_params_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
    validate_kdf_params(&params)?;
    let mk = pv_core::kdf::derive_master_key(&password, &salt, &params)?;
    let wrapping_key_bytes = hkdf_expand_key(mk.as_ref(), INFO_PW_UNLOCK);
    let auth_hash_bytes = hkdf_expand_key(mk.as_ref(), INFO_AUTH_HASH);
    Ok(FfiAuthMaterial {
        wrapping_key: Arc::new(FfiWrappingKey(wrapping_key_bytes)),
        auth_hash_b64: BASE64_STANDARD.encode(auth_hash_bytes),
    })
}

/// `KdfParams::default()` jako JSON — mirror `pv-wasm`'s
/// `default_kdf_params_json` (`crates/pv-wasm/src/lib.rs:685-688`), sama
/// bezargumentowa, bez `Result` sygnatura. Jedyne źródło domyślnych
/// parametrów KDF przy rejestracji — Swift nigdy nie trzyma własnego
/// numerycznego literału Argon2id.
#[uniffi::export]
pub fn default_kdf_params_json() -> String {
    serde_json::to_string(&KdfParams::default()).expect("KdfParams always serializes")
}

/// Dokładnie 16 losowych bajtów — jawna sól rejestracyjna, NIE materiał
/// klucza. Sankcjonowany, nazwany wyjątek od reguły "brak gołego `Vec<u8>`
/// w publicznym API", ten sam precedens co `pv-wasm`'s `randomSalt`
/// (`crates/pv-wasm/src/lib.rs:690-695`) i `pv-core/src/keys.rs`'s własny
/// komentarz, że jawna losowość nie jest materiałem klucza.
#[uniffi::export]
pub fn generate_registration_salt() -> Vec<u8> {
    random_bytes(16)
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

/// DR-37-A (`ios/IOS-SPIKE-LOG.md` §1): `serde_json` owns the
/// `pw_wrapped_uk` wire encoding on BOTH clients — Swift never encodes or
/// decodes the envelope itself, it moves an opaque `String` between
/// `pv-ffi` and the HTTP body. This and `unwrap_user_key_from_json` below
/// are the ONLY functions in this crate that ever see the envelope's
/// textual form.
#[uniffi::export]
pub fn wrap_user_key_json(
    wrapping_key: &FfiWrappingKey,
    user_key: &FfiUserKey,
) -> Result<String, FfiError> {
    let blob = core_wrap_user_key(&wrapping_key.0, &user_key.0)?;
    serde_json::to_string(&blob).map_err(|e| FfiError::InvalidInput(e.to_string()))
}

/// Inverse of `wrap_user_key_json` — see that function's doc comment
/// (DR-37-A). Any malformed `wrapped_json` (including a base64-string-shaped
/// envelope a Swift-side `Codable` default would have produced) returns a
/// catchable `FfiError::InvalidInput`, never a panic.
#[uniffi::export]
pub fn unwrap_user_key_from_json(
    wrapping_key: &FfiWrappingKey,
    wrapped_json: String,
) -> Result<Arc<FfiUserKey>, FfiError> {
    let blob: WrappedKey = serde_json::from_str(&wrapped_json)
        .map_err(|e| FfiError::InvalidInput(e.to_string()))?;
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

    /// Asserts the shared shape of the two WR-11 rejection tests below: the
    /// error must be `InvalidInput` NAMING the offending parameter, never
    /// merely "an error happened". `FfiError::Kdf` — what `argon2`'s own
    /// `Params::new` validation produces — must NOT satisfy it: a `Kdf`
    /// error would mean the rejection came from somewhere that only runs
    /// AFTER the point where the allocation would already have happened.
    fn assert_rejected_by_the_bounds_guard(
        result: Result<Arc<FfiWrappingKey>, FfiError>,
        expected_param: &str,
    ) {
        match result {
            Err(FfiError::InvalidInput(msg)) => assert!(
                msg.contains(expected_param),
                "the rejection must name the offending parameter ({expected_param}), got: {msg}"
            ),
            Err(other) => panic!(
                "expected FfiError::InvalidInput from the WR-11 bounds guard, got {other:?} -- \
                 a Kdf error means argon2's own validation rejected it instead, i.e. AFTER the \
                 point where a larger-but-still-argon2-legal value would have run"
            ),
            Ok(_) => panic!("an out-of-range {expected_param} was accepted"),
        }
    }

    /// WR-11 regression (Faza 35 code review) — the end-to-end case, and the
    /// one this guard's falsification transcript is taken on, because it is
    /// the only hostile value that is safe to run with the guard REMOVED.
    ///
    /// 131072 KiB = 128 MiB: over the 96 MiB ceiling, exactly 2x the
    /// production profile, and small enough that an unguarded run merely
    /// completes an expensive Argon2id pass and returns `Ok` — which is what
    /// makes this test go RED rather than take the host down with it.
    #[test]
    fn from_password_rejects_over_ceiling_m_cost_end_to_end() {
        let salt = pv_core::keys::random_bytes(16);
        let over_ceiling = r#"{"m_cost_kib":131072,"t_cost":3,"p_cost":4}"#;
        assert_rejected_by_the_bounds_guard(
            FfiWrappingKey::from_password(
                b"any-password".to_vec(),
                salt,
                over_ceiling.to_string(),
            ),
            "m_cost_kib",
        );
    }

    /// WR-11 — the process-killing class the guard actually exists for.
    ///
    /// `m_cost_kib = 0x0FFFFFFF` (268435455 KiB = 256 GiB) is ACCEPTED by
    /// `argon2`'s own `Params::new`; `MAX_M_COST` is exactly that value. So
    /// without `validate_kdf_params` this input reaches the block-array
    /// allocation, and a hostile `POST /api/auth/prelogin` response is all
    /// it takes to get there.
    ///
    /// FALSIFICATION LIMIT, recorded rather than glossed: this test was NOT
    /// executed with the guard removed. Measured on the macOS dev host,
    /// `Vec::<u8>::with_capacity(268435455 * 1024)` SUCCEEDS (lazy VA
    /// reservation, exit 0) on a 16 GB machine, so an unguarded run would
    /// not abort quickly — it would fault in hundreds of GiB, i.e. perform
    /// the exact process-killing behaviour the guard exists to prevent, on
    /// the developer's machine. `ulimit -v` cannot bound it either
    /// (`setrlimit failed: invalid argument` — RLIMIT_AS is unsupported on
    /// Darwin). The guard's falsifiability is therefore proven by
    /// `from_password_rejects_over_ceiling_m_cost_end_to_end` and
    /// `kdf_param_bounds_reject_exactly_one_past_the_maximum`, which
    /// exercise the same single code path with safe values; this test pins
    /// the argon2-legal extreme.
    #[test]
    fn from_password_rejects_argon2s_own_max_m_cost() {
        let salt = pv_core::keys::random_bytes(16);
        let hostile = r#"{"m_cost_kib":268435455,"t_cost":1,"p_cost":1}"#;
        assert_rejected_by_the_bounds_guard(
            FfiWrappingKey::from_password(b"any-password".to_vec(), salt, hostile.to_string()),
            "m_cost_kib",
        );
    }

    /// WR-11 control. Without this, the guard above could be satisfied by a
    /// ceiling low enough to break the actual product, and nothing would say
    /// so. `KdfParams::default()` IS the production profile
    /// (`crates/pv-core/src/kdf.rs`), and this runs a REAL 64 MiB / t=3 / p=4
    /// Argon2id pass through the same entry point Swift calls.
    #[test]
    fn from_password_accepts_the_real_production_kdf_params() {
        let production = KdfParams::default();
        // Transcribed from crates/pv-core/src/kdf.rs's `Default` impl, so a
        // silent change to the production profile fails HERE rather than
        // silently widening what this control actually proves.
        assert_eq!(
            (production.m_cost_kib, production.t_cost, production.p_cost),
            (64 * 1024, 3, 4),
            "the production KDF profile moved -- re-check MAX_M_COST_KIB/MAX_T_COST/MAX_P_COST"
        );
        assert!(validate_kdf_params(&production).is_ok());

        let json = serde_json::to_string(&production).expect("KdfParams always serializes");
        let salt = pv_core::keys::random_bytes(16);
        let result = FfiWrappingKey::from_password(b"any-password".to_vec(), salt, json);
        assert!(
            result.is_ok(),
            "the real production KDF parameters must still derive a wrapping key"
        );
    }

    /// WR-11 boundary. Asserted on `validate_kdf_params` directly rather than
    /// through `from_password`, so the exact-max cases cost no Argon2id run.
    /// Each field is proven to accept its maximum AND reject maximum+1 — a
    /// guard that only rejects absurd values would pass a test that only fed
    /// it absurd values.
    #[test]
    fn kdf_param_bounds_reject_exactly_one_past_the_maximum() {
        let at_max =
            KdfParams { m_cost_kib: MAX_M_COST_KIB, t_cost: MAX_T_COST, p_cost: MAX_P_COST };
        assert!(validate_kdf_params(&at_max).is_ok(), "the maximum itself must be accepted");

        let over_m = KdfParams { m_cost_kib: MAX_M_COST_KIB + 1, ..at_max.clone() };
        assert!(matches!(validate_kdf_params(&over_m), Err(FfiError::InvalidInput(_))));

        let over_t = KdfParams { t_cost: MAX_T_COST + 1, ..at_max.clone() };
        assert!(matches!(validate_kdf_params(&over_t), Err(FfiError::InvalidInput(_))));

        let over_p = KdfParams { p_cost: MAX_P_COST + 1, ..at_max.clone() };
        assert!(matches!(validate_kdf_params(&over_p), Err(FfiError::InvalidInput(_))));
    }

    /// 37-02 Test (i): `derive_auth_material`'s `auth_hash_b64` decodes to
    /// exactly 32 bytes, and those bytes differ from the returned wrapping
    /// key's effect — proven by successfully wrapping/unwrapping with the
    /// returned wrapping key while the decoded auth hash sits alongside it
    /// as a genuinely different 32 bytes (never asserted by comparing an
    /// opaque handle's address; the wrapping key's EFFECT is what matters).
    #[test]
    fn derive_auth_material_single_argon2_pass_and_auth_hash_is_32_bytes() {
        let salt = pv_core::keys::random_bytes(16);
        let kdf_json = cheap_kdf_params_json();
        let password = b"test-password".to_vec();

        let material = derive_auth_material(password.clone(), salt.clone(), kdf_json.clone())
            .expect("derive_auth_material should succeed");

        let auth_hash_bytes = base64::engine::general_purpose::STANDARD
            .decode(&material.auth_hash_b64)
            .expect("auth_hash_b64 must be valid base64");
        assert_eq!(auth_hash_bytes.len(), 32, "auth_hash must be exactly 32 bytes");

        // The wrapping key derive_auth_material returned must be
        // interoperable with the standalone from_password path (same
        // INFO_PW_UNLOCK derivation): wrap with a reference key derived via
        // from_password, unwrap with the one derive_auth_material returned.
        let reference_wrapping_key = FfiWrappingKey::from_password(password, salt, kdf_json)
            .expect("from_password should succeed");
        let user_key = FfiUserKey::generate().expect("generate is infallible today");
        let wrapped =
            wrap_user_key(&reference_wrapping_key, &user_key).expect("wrap should succeed");
        let unwrapped =
            unwrap_user_key(&material.wrapping_key, wrapped).expect("unwrap should succeed");
        assert_eq!(unwrapped.0.expose(), user_key.0.expose());

        // auth_hash_bytes must differ from the wrapping key's own bytes --
        // domain separation (INFO_PW_UNLOCK vs INFO_AUTH_HASH) actually took
        // effect, not merely "some 32 bytes came back".
        assert_ne!(
            auth_hash_bytes.as_slice(),
            material.wrapping_key.0.as_slice(),
            "auth_hash and wrapping_key must diverge (different HKDF info strings)"
        );
    }

    /// 37-02 Test (ii): malformed `kdf_params_json` returns `Err`, and the
    /// sentinel password does not reach the allocator intact — reuses
    /// `crate::heap_probe::Probe`/`SENTINEL` and its control exactly as
    /// `from_password_zeroizes_its_password_copy_on_the_parse_error_path`
    /// does (same CR-01 shape, new function).
    #[test]
    fn derive_auth_material_zeroizes_its_password_copy_on_the_parse_error_path() {
        let salt = pv_core::keys::random_bytes(16);

        let probe = Probe::arm();
        let password = SENTINEL.to_vec();
        let result = derive_auth_material(
            password,
            salt,
            "{ this is not valid KdfParams JSON }".to_string(),
        );
        let leaked = probe.sentinel_reached_allocator();
        drop(probe);

        assert!(result.is_err(), "malformed kdf_params_json must be rejected");
        assert!(
            !leaked,
            "derive_auth_material's Rust-owned heap copy of the master password was released to \
             the allocator with its bytes intact on the parse-error path (CR-01)"
        );

        // Control: the probe genuinely CAN see an un-zeroized buffer of
        // exactly this shape going back to the allocator.
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

    /// 37-02 Test (iii): `wrap_user_key_json`'s output parses as JSON with
    /// `nonce`/`ciphertext` keys (DR-37-A's `serde_json`-owned shape) and
    /// round-trips through `unwrap_user_key_from_json` to the same 32
    /// exposed bytes.
    #[test]
    fn wrap_user_key_json_round_trips_and_has_serde_json_shape() {
        let salt = pv_core::keys::random_bytes(16);
        let kdf_json = cheap_kdf_params_json();
        let wrapping_key = FfiWrappingKey::from_password(
            b"test-password".to_vec(),
            salt,
            kdf_json,
        )
        .expect("from_password should succeed");
        let user_key = FfiUserKey::generate().expect("generate is infallible today");

        let wrapped_json =
            wrap_user_key_json(&wrapping_key, &user_key).expect("wrap_user_key_json should succeed");

        let parsed: serde_json::Value =
            serde_json::from_str(&wrapped_json).expect("wrap_user_key_json output must be valid JSON");
        assert!(parsed.get("nonce").is_some(), "wrapped JSON must have a `nonce` key");
        assert!(parsed.get("ciphertext").is_some(), "wrapped JSON must have a `ciphertext` key");

        let unwrapped = unwrap_user_key_from_json(&wrapping_key, wrapped_json)
            .expect("unwrap_user_key_from_json should succeed");
        assert_eq!(unwrapped.0.expose(), user_key.0.expose());
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

    /// 37-03 Task 3 (b), E-SRV-4: pins `INFO_AUTH_HASH`/`INFO_PW_UNLOCK`'s
    /// derivation output on the RUST side against hard-coded hex literals,
    /// computed ONCE (via a throwaway test, transcribed here, never
    /// re-derived by this test itself -- see the comment on each literal)
    /// for a fixed password/salt/cheap-params fixture. The SAME
    /// password/salt/params literals and the SAME two hex strings are
    /// pasted into `ios/PasskeyVault/PasskeyVaultTests/
    /// PvDerivationVectorTests.swift`, so a one-character change to either
    /// `INFO_AUTH_HASH` or `INFO_PW_UNLOCK` (`crates/pv-core/src/keys.rs`)
    /// moves this test's own hex output away from the pasted literal here
    /// AND away from the independently pasted literal in Swift -- two
    /// independent falsifiable pins on the same two constants, not one
    /// shared helper that could move both together and prove nothing
    /// (mirrors this file's own `derive_master_key` fully-qualified-call
    /// discipline: a shared code path would let a regression hide behind
    /// "the test still compares X to X").
    #[test]
    fn derivation_vectors_pin_info_auth_hash_and_info_pw_unlock() {
        // Fixed literal fixture -- password bytes, 16-byte salt, cheap
        // Argon2id params (8 MiB / t=1 / p=1, mirrors cheap_kdf_params_json
        // above). NEVER the production default -- this test's cost is
        // deliberately cheap, matching this crate's own established
        // "cheap params for unit tests" discipline.
        let password = b"pv-derivation-vector-fixture (37-03 PvDerivationVectorTests)";
        let salt: [u8; 16] = [
            0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D,
            0x2E, 0x2F,
        ];
        let params = KdfParams { m_cost_kib: 8 * 1024, t_cost: 1, p_cost: 1 };

        let mk = pv_core::kdf::derive_master_key(password, &salt, &params)
            .expect("derive_master_key should succeed on this fixture");
        let auth_hash = hkdf_expand_key(mk.as_ref(), INFO_AUTH_HASH);
        let pw_unlock = hkdf_expand_key(mk.as_ref(), INFO_PW_UNLOCK);

        fn hex(bytes: &[u8]) -> String {
            bytes.iter().map(|b| format!("{b:02x}")).collect()
        }

        // Computed ONCE via a throwaway `cargo test` snippet against this
        // exact fixture (37-03 Task 3 execution transcript) and pasted here
        // as literals -- never generated by this test itself, which would
        // make the assertion below compare a value to itself.
        const EXPECTED_AUTH_HASH_HEX: &str =
            "786142abb2fe4277bba3cca9846834c0f365b37efc9556089f1f179fa60c8b77";
        const EXPECTED_PW_UNLOCK_HEX: &str =
            "ae9d3c1a3d5460ff450d805e82148e276fcec988035d36bf121cb5d9c5ea8deb";

        // Sanity on the pasted literals themselves: HKDF-SHA256 output here
        // is exactly KEY_LEN (32) bytes, i.e. 64 hex characters -- guards
        // against a copy-paste error in the literals above independently of
        // whether the derivation itself is correct.
        assert_eq!(EXPECTED_AUTH_HASH_HEX.len(), 64, "pasted auth-hash hex literal must be 64 chars (32 bytes)");
        assert_eq!(EXPECTED_PW_UNLOCK_HEX.len(), 64, "pasted pw-unlock hex literal must be 64 chars (32 bytes)");

        assert_eq!(hex(&auth_hash), EXPECTED_AUTH_HASH_HEX, "INFO_AUTH_HASH derivation output moved -- re-check crates/pv-core/src/keys.rs's INFO_AUTH_HASH constant");
        assert_eq!(hex(&pw_unlock), EXPECTED_PW_UNLOCK_HEX, "INFO_PW_UNLOCK derivation output moved -- re-check crates/pv-core/src/keys.rs's INFO_PW_UNLOCK constant");
        assert_ne!(auth_hash, pw_unlock, "domain separation: INFO_AUTH_HASH and INFO_PW_UNLOCK must diverge");
    }
}
