//! pv-wasm — cienka warstwa wasm-bindgen wokół pv-core.
//!
//! Surowe bajty kluczy nigdy nie przekraczają granicy WASM/JS jako
//! Vec<u8>/&[u8] — tylko nieprzezroczyste handle (patrz WasmUserKey,
//! WasmWrappingKey). Jedyny wyjątek to `randomSalt`, bo sól jest jawna
//! (nie jest materiałem kluczowym).

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
