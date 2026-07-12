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
    kdf::{wrapping_key_from_password, KdfParams},
    keys::{
        random_bytes, unwrap_user_key as core_unwrap_user_key, wrap_user_key as core_wrap_user_key,
        UserKey, WrappedKey, KEY_LEN,
    },
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
    #[wasm_bindgen(js_name = fromPassword)]
    pub fn from_password(
        password: &str,
        salt: &[u8],
        kdf_params_json: &str,
    ) -> Result<WasmWrappingKey, JsValue> {
        let params: KdfParams = serde_json::from_str(kdf_params_json)
            .map_err(|e| to_js_str_err(&e.to_string()))?;
        let wk = wrapping_key_from_password(password.as_bytes(), salt, &params)
            .map_err(to_js_err)?;
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
pub fn encrypt_item(uk: &WasmUserKey, plaintext: &str) -> Result<String, JsValue> {
    let item = core_encrypt_item(&uk.0, plaintext.as_bytes()).map_err(to_js_err)?;
    serde_json::to_string(&item).map_err(|e| to_js_str_err(&e.to_string()))
}

#[wasm_bindgen(js_name = decryptItem)]
pub fn decrypt_item(uk: &WasmUserKey, item_json: &str) -> Result<String, JsValue> {
    let item: EncryptedItem =
        serde_json::from_str(item_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let plaintext = core_decrypt_item(&uk.0, &item).map_err(to_js_err)?;
    String::from_utf8(plaintext).map_err(|e| to_js_str_err(&e.to_string()))
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
        let wrapping_key = WasmWrappingKey::from_password("test-password", &salt, &kdf_json)
            .expect("from_password should succeed");
        let user_key = WasmUserKey::generate();
        let wrapped_json = wrap_user_key(&wrapping_key, &user_key).expect("wrap should succeed");
        let unwrapped =
            unwrap_user_key(&wrapping_key, &wrapped_json).expect("unwrap should succeed");
        let item_json = encrypt_item(&unwrapped, "{\"type\":\"note\",\"body\":\"fixture\"}")
            .expect("encrypt should succeed");
        let plaintext = decrypt_item(&unwrapped, &item_json).expect("decrypt should succeed");
        assert_eq!(plaintext, "{\"type\":\"note\",\"body\":\"fixture\"}");
    }

    #[test]
    fn wrong_password_fails_to_unwrap() {
        let salt = pv_core::keys::random_bytes(16);
        let kdf_json = default_kdf_params_json();
        let wrapping_key = WasmWrappingKey::from_password("correct-password", &salt, &kdf_json)
            .expect("from_password should succeed");
        let user_key = WasmUserKey::generate();
        let wrapped_json = wrap_user_key(&wrapping_key, &user_key).expect("wrap should succeed");

        let other_wrapping_key =
            WasmWrappingKey::from_password("different-password", &salt, &kdf_json)
                .expect("from_password should succeed");
        let result = unwrap_user_key(&other_wrapping_key, &wrapped_json);
        assert!(result.is_err());
    }
}
