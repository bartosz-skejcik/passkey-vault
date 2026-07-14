//! pv-wasm — cienka warstwa wasm-bindgen wokół pv-core.
//!
//! Surowe bajty kluczy nigdy nie przekraczają granicy WASM/JS jako
//! Vec<u8>/&[u8] — tylko nieprzezroczyste handle (patrz WasmUserKey,
//! WasmWrappingKey). Jedyny wyjątek to `randomSalt`, bo sól jest jawna
//! (nie jest materiałem kluczowym). Rozpakowanie klucza poza handle
//! (np. dodanie metody zwracającej `&[u8]`) zostawiłoby niezerowalną
//! kopię w pamięci JS — dlatego jedyny sposób, by materiał klucza
//! "opuścił" handle, to skarmienie go do `wrap_user_key`/`encrypt_item`,
//! które produkują ciphertext, nie sekret.

use pv_core::{
    items::{decrypt_item as core_decrypt_item, encrypt_item as core_encrypt_item, EncryptedItem},
    kdf::{derive_master_key, wrapping_key_from_password, KdfParams},
    keys::{
        hkdf_expand_key, random_bytes, unwrap_user_key as core_unwrap_user_key,
        wrap_user_key as core_wrap_user_key, UserKey, WrappedKey, INFO_AUTH_HASH, INFO_PW_UNLOCK,
        KEY_LEN,
    },
    prf::wrapping_key_from_prf,
    CryptoError,
};
use wasm_bindgen::prelude::*;
use zeroize::{Zeroize, ZeroizeOnDrop};

// `JsValue::from_str` (and any other JsValue-constructing call) invokes a
// real wasm-bindgen JS import — on wasm32 that's the browser/JS host, but
// on the native `cargo test` target there is no host to call into, and
// wasm-bindgen's native stub panics with "function not implemented on
// non-wasm32 targets" the moment it's actually invoked (not merely
// referenced). Native tests only need the `Result` to be an `Err` — the
// exact `JsValue` payload is irrelevant off-target — so we skip the panicking
// call there and keep the real, descriptive `.to_string()` conversion for
// the actual wasm32 build that ships to the browser.
#[cfg(target_arch = "wasm32")]
fn to_js_err(e: CryptoError) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[cfg(not(target_arch = "wasm32"))]
fn to_js_err(e: CryptoError) -> JsValue {
    let _ = e.to_string(); // exercise the Display impl even off-target
    JsValue::NULL
}

/// Same native-vs-wasm32 split as `to_js_err`, for the (de)serialization
/// error paths (`serde_json::Error` doesn't implement `Into<CryptoError>`).
#[cfg(target_arch = "wasm32")]
fn to_js_str_err(msg: &str) -> JsValue {
    JsValue::from_str(msg)
}

#[cfg(not(target_arch = "wasm32"))]
fn to_js_str_err(msg: &str) -> JsValue {
    let _ = msg;
    JsValue::NULL
}

/// Nieprzezroczysty handle klucza wrapującego (pochodzącego z hasła lub PRF).
/// JS trzyma tylko ten struct — surowe bajty nigdy nie są zwracane.
#[wasm_bindgen]
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct WasmWrappingKey([u8; KEY_LEN]);

#[wasm_bindgen]
impl WasmWrappingKey {
    /// `password` is a caller-owned byte buffer (JS `Uint8Array`), never a
    /// `&str`/String — per CLAUDE.md's "no String/Vec<u8> for keys/passwords"
    /// rule. wasm-bindgen marshals `&mut [u8]` by copying the JS array into
    /// WASM linear memory and copying it back out after the call, so
    /// zeroizing it here also wipes the caller's JS-side view; the caller is
    /// still responsible for not retaining any other copy of the password.
    #[wasm_bindgen(js_name = fromPassword)]
    pub fn from_password(
        password: &mut [u8],
        salt: &[u8],
        kdf_params_json: &str,
    ) -> Result<WasmWrappingKey, JsValue> {
        let params: KdfParams = serde_json::from_str(kdf_params_json)
            .map_err(|e| to_js_str_err(&e.to_string()))?;
        let result = wrapping_key_from_password(password, salt, &params).map_err(to_js_err);
        password.zeroize(); // wipe the WASM-side (and, via copy-back, JS-side) copy regardless of outcome
        let wk = result?;
        Ok(WasmWrappingKey(*wk))
    }

    /// `prf_output` is a caller-owned byte buffer (JS `Uint8Array`) holding
    /// the raw 32-byte WebAuthn PRF extension result — same marshaling and
    /// zeroize-regardless-of-outcome discipline as `from_password` above,
    /// just no salt/KDF params needed (PRF output is already uniformly
    /// random, unlike a human-chosen password).
    #[wasm_bindgen(js_name = fromPrf)]
    pub fn from_prf(prf_output: &mut [u8]) -> Result<WasmWrappingKey, JsValue> {
        let result = wrapping_key_from_prf(prf_output).map_err(to_js_err);
        prf_output.zeroize(); // wipe the WASM-side (and, via copy-back, JS-side) copy regardless of outcome
        let wk = result?;
        Ok(WasmWrappingKey(*wk))
    }
}

/// Nieprzezroczysty handle User Key — korzeń dostępu do vaulta. Jedyny
/// sposób, by "użyć" klucza spoza handle, to funkcje wrap/encrypt poniżej.
#[wasm_bindgen]
pub struct WasmUserKey(UserKey);

#[wasm_bindgen]
impl WasmUserKey {
    #[wasm_bindgen(js_name = generate)]
    pub fn generate() -> WasmUserKey {
        WasmUserKey(UserKey::generate())
    }
}

#[wasm_bindgen(js_name = wrapUserKey)]
pub fn wrap_user_key(wrapping_key: &WasmWrappingKey, uk: &WasmUserKey) -> Result<String, JsValue> {
    let blob = core_wrap_user_key(&wrapping_key.0, &uk.0).map_err(to_js_err)?;
    serde_json::to_string(&blob).map_err(|e| to_js_str_err(&e.to_string()))
}

#[wasm_bindgen(js_name = unwrapUserKey)]
pub fn unwrap_user_key(
    wrapping_key: &WasmWrappingKey,
    wrapped_json: &str,
) -> Result<WasmUserKey, JsValue> {
    let blob: WrappedKey =
        serde_json::from_str(wrapped_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let uk = core_unwrap_user_key(&wrapping_key.0, &blob).map_err(to_js_err)?;
    Ok(WasmUserKey(uk))
}

#[wasm_bindgen(js_name = encryptItem)]
pub fn encrypt_item(
    uk: &WasmUserKey,
    plaintext: &str,
    item_id: &str,
    revision: u32,
) -> Result<String, JsValue> {
    let item =
        core_encrypt_item(&uk.0, plaintext.as_bytes(), item_id, revision).map_err(to_js_err)?;
    serde_json::to_string(&item).map_err(|e| to_js_str_err(&e.to_string()))
}

#[wasm_bindgen(js_name = decryptItem)]
pub fn decrypt_item(
    uk: &WasmUserKey,
    item_json: &str,
    item_id: &str,
    revision: u32,
) -> Result<String, JsValue> {
    let item: EncryptedItem =
        serde_json::from_str(item_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let plaintext = core_decrypt_item(&uk.0, &item, item_id, revision).map_err(to_js_err)?;
    String::from_utf8(plaintext).map_err(|e| to_js_str_err(&e.to_string()))
}

/// Generuje bieżący kod TOTP (RFC 6238) z sekretu itemu — nieprzezroczysty
/// handle NIE jest tu potrzebny (patrz komentarz na górze pliku): sekret
/// TOTP nie jest materiałem kluczowym najwyższego rzędu, tylko wartością
/// przechowywaną per-item, do której klient i tak ma jawny dostęp po
/// odszyfrowaniu itemu. Ta funkcja NIGDY sama nie odczytuje zegara — czas
/// zawsze przychodzi jawnie od wywołującego (JS `Date.now()`), zgodnie z
/// `pv_core::totp::generate_code`'s own contract.
#[wasm_bindgen(js_name = totpNow)]
pub fn totp_now(
    secret_b32: &str,
    algorithm: &str,
    digits: usize,
    period: u64,
    unix_time_seconds: u64,
) -> Result<String, JsValue> {
    let (code, seconds_remaining) =
        pv_core::totp::generate_code(secret_b32, algorithm, digits, period, unix_time_seconds)
            .map_err(to_js_err)?;
    serde_json::to_string(&serde_json::json!({
        "code": code,
        "secondsRemaining": seconds_remaining
    }))
    .map_err(|e| to_js_str_err(&e.to_string()))
}

/// Nieprzezroczysty handle zawierający ZAROWNO wrapping key JAK I auth-hash
/// pochodzące z jednego przebiegu Argon2id (patrz `derive_auth_material`).
/// Konsumowanie pól odbywa się przez metody `take*` (mutable-borrow), nie
/// `self`-by-value — `ZeroizeOnDrop` generuje `Drop`, więc Rust nie pozwala
/// na częściowy move pola ze struktury, która ma niestandardowy Drop.
#[wasm_bindgen]
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct WasmAuthMaterial {
    wrapping_key: [u8; KEY_LEN],
    auth_hash: Vec<u8>,
}

#[wasm_bindgen]
impl WasmAuthMaterial {
    /// Zabiera auth-hash, zostawiając puste `Vec` na miejscu (zerowalne przy
    /// ewentualnym Drop `self`). Bezpieczne do wywołania niezależnie od
    /// kolejności/tego, czy druga metoda `take*` też zostanie wywołana.
    #[wasm_bindgen(js_name = takeAuthHash)]
    pub fn take_auth_hash(&mut self) -> Vec<u8> {
        std::mem::take(&mut self.auth_hash)
    }

    /// Zabiera wrapping key jako nowy `WasmWrappingKey` handle, zostawiając
    /// wyzerowane bajty na miejscu.
    #[wasm_bindgen(js_name = takeWrappingKey)]
    pub fn take_wrapping_key(&mut self) -> WasmWrappingKey {
        let bytes = std::mem::replace(&mut self.wrapping_key, [0u8; KEY_LEN]);
        WasmWrappingKey(bytes)
    }
}

/// Wykonuje JEDEN przebieg Argon2id (`derive_master_key`) i rozwija jego
/// wynik przez HKDF dwukrotnie — raz z `INFO_PW_UNLOCK` (wrapping key), raz
/// z `INFO_AUTH_HASH` (auth-hash) — zamiast wołać
/// `wrapping_key_from_password`/`auth_hash_from_password`, które każde
/// niezależnie powtórzyłyby kosztowny przebieg Argon2id. To jest właściwe
/// miejsce na tę optymalizację: rejestracja/logowanie potrzebują OBU
/// wyjść z JEDNEGO hasła.
#[wasm_bindgen(js_name = deriveAuthMaterial)]
pub fn derive_auth_material(
    password: &mut [u8],
    salt: &[u8],
    kdf_params_json: &str,
) -> Result<WasmAuthMaterial, JsValue> {
    let params: KdfParams =
        serde_json::from_str(kdf_params_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let result = derive_master_key(password, salt, &params).map_err(to_js_err);
    password.zeroize(); // wipe regardless of outcome
    let mk = result?;
    let wrapping_key = hkdf_expand_key(mk.as_ref(), INFO_PW_UNLOCK);
    let auth_hash = hkdf_expand_key(mk.as_ref(), INFO_AUTH_HASH).to_vec();
    Ok(WasmAuthMaterial { wrapping_key, auth_hash })
}

#[wasm_bindgen(js_name = defaultKdfParamsJson)]
pub fn default_kdf_params_json() -> String {
    serde_json::to_string(&KdfParams::default()).expect("KdfParams always serializes")
}

/// Zwraca `len` losowych bajtów — jawna sól, nie materiał kluczowy. Jedyny
/// sanktowany wyjątek od reguły "brak Vec<u8> w publicznym API".
#[wasm_bindgen(js_name = randomSalt)]
pub fn random_salt(len: usize) -> Vec<u8> {
    random_bytes(len)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_roundtrip() {
        let salt = pv_core::keys::random_bytes(16);
        let kdf_json = default_kdf_params_json();
        let mut password = b"test-password".to_vec();
        let wrapping_key = WasmWrappingKey::from_password(&mut password, &salt, &kdf_json)
            .expect("from_password should succeed");
        let user_key = WasmUserKey::generate();
        let wrapped_json = wrap_user_key(&wrapping_key, &user_key).expect("wrap should succeed");
        let unwrapped =
            unwrap_user_key(&wrapping_key, &wrapped_json).expect("unwrap should succeed");
        let item_json = encrypt_item(
            &unwrapped,
            "{\"type\":\"note\",\"body\":\"fixture\"}",
            "self-test-item",
            1,
        )
        .expect("encrypt should succeed");
        let plaintext = decrypt_item(&unwrapped, &item_json, "self-test-item", 1)
            .expect("decrypt should succeed");
        assert_eq!(plaintext, "{\"type\":\"note\",\"body\":\"fixture\"}");
    }

    #[test]
    fn from_prf_roundtrip() {
        let mut prf_output = [7u8; 32];
        let wrapping_key = WasmWrappingKey::from_prf(&mut prf_output)
            .expect("from_prf should succeed on a 32-byte fixture");
        let user_key = WasmUserKey::generate();
        let wrapped_json = wrap_user_key(&wrapping_key, &user_key).expect("wrap should succeed");
        let unwrapped =
            unwrap_user_key(&wrapping_key, &wrapped_json).expect("unwrap should succeed");
        assert_eq!(unwrapped.0.expose(), user_key.0.expose());
    }

    #[test]
    fn from_prf_rejects_short_input() {
        let mut short = [0u8; 16];
        let result = WasmWrappingKey::from_prf(&mut short);
        assert!(result.is_err());
    }

    #[test]
    fn wrong_password_fails_to_unwrap() {
        let salt = pv_core::keys::random_bytes(16);
        let kdf_json = default_kdf_params_json();
        let mut correct_password = b"correct-password".to_vec();
        let wrapping_key =
            WasmWrappingKey::from_password(&mut correct_password, &salt, &kdf_json)
                .expect("from_password should succeed");
        let user_key = WasmUserKey::generate();
        let wrapped_json = wrap_user_key(&wrapping_key, &user_key).expect("wrap should succeed");

        let mut different_password = b"different-password".to_vec();
        let other_wrapping_key =
            WasmWrappingKey::from_password(&mut different_password, &salt, &kdf_json)
                .expect("from_password should succeed");
        let result = unwrap_user_key(&other_wrapping_key, &wrapped_json);
        assert!(result.is_err());
    }

    #[test]
    fn derive_auth_material_single_pass() {
        let salt = pv_core::keys::random_bytes(16);
        let kdf_json = default_kdf_params_json();

        let mut password_for_wk = b"test-password".to_vec();
        let reference_wrapping_key =
            WasmWrappingKey::from_password(&mut password_for_wk, &salt, &kdf_json)
                .expect("from_password should succeed");

        let mut password = b"test-password".to_vec();
        let mut material = derive_auth_material(&mut password, &salt, &kdf_json)
            .expect("derive_auth_material should succeed");

        let auth_hash = material.take_auth_hash();
        let wrapping_key = material.take_wrapping_key();

        // auth-hash and wrapping-key diverge (different HKDF info strings).
        assert_ne!(auth_hash, wrapping_key.0.to_vec());

        // The wrapping key produced by deriveAuthMaterial must be
        // interoperable with the standalone from_password path: wrap with
        // one, unwrap with the other.
        let user_key = WasmUserKey::generate();
        let wrapped_json =
            wrap_user_key(&reference_wrapping_key, &user_key).expect("wrap should succeed");
        let unwrapped =
            unwrap_user_key(&wrapping_key, &wrapped_json).expect("unwrap should succeed");
        assert_eq!(unwrapped.0.expose(), user_key.0.expose());
    }

    #[test]
    fn derive_auth_material_is_deterministic() {
        let salt = pv_core::keys::random_bytes(16);
        let kdf_json = default_kdf_params_json();

        let mut password_a = b"test-password".to_vec();
        let mut material_a = derive_auth_material(&mut password_a, &salt, &kdf_json)
            .expect("derive_auth_material should succeed");
        let auth_hash_a = material_a.take_auth_hash();
        let wrapping_key_a = material_a.take_wrapping_key();

        let mut password_b = b"test-password".to_vec();
        let mut material_b = derive_auth_material(&mut password_b, &salt, &kdf_json)
            .expect("derive_auth_material should succeed");
        let auth_hash_b = material_b.take_auth_hash();
        let wrapping_key_b = material_b.take_wrapping_key();

        assert_eq!(auth_hash_a, auth_hash_b);

        // Interoperability check in lieu of comparing raw bytes directly
        // (WasmWrappingKey's bytes are private): wrap with one, unwrap with
        // the other.
        let user_key = WasmUserKey::generate();
        let wrapped_json = wrap_user_key(&wrapping_key_a, &user_key).expect("wrap should succeed");
        let unwrapped =
            unwrap_user_key(&wrapping_key_b, &wrapped_json).expect("unwrap should succeed");
        assert_eq!(unwrapped.0.expose(), user_key.0.expose());
    }

    #[test]
    fn totp_now_returns_rfc6238_json_shape() {
        // RFC 6238 Appendix B SHA1 vector (see pv-core's totp.rs tests).
        let json = totp_now(
            "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
            "SHA1",
            8,
            30,
            59,
        )
        .expect("totp_now should succeed on a valid RFC 6238 vector");
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["code"], "94287082");
        assert_eq!(parsed["secondsRemaining"], 1);
    }

    #[test]
    fn totp_now_rejects_invalid_secret() {
        let result = totp_now("not-valid-base32!!!", "SHA1", 6, 30, 100);
        assert!(result.is_err());
    }
}
