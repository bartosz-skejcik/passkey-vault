//! pv-wasm — cienka warstwa wasm-bindgen wokół pv-core.
//!
//! Surowe bajty kluczy nigdy nie przekraczają granicy WASM/JS jako
//! Vec<u8>/&[u8] — tylko nieprzezroczyste handle (patrz WasmUserKey,
//! WasmWrappingKey). Jedyny jawny wyjątek to `randomSalt`, bo sól jest
//! jawna (nie jest materiałem kluczowym). Rozpakowanie klucza poza handle
//! (np. dodanie metody zwracającej `&[u8]`) zostawiłoby niezerowalną
//! kopię w pamięci JS — dlatego zwykły sposób, by materiał klucza
//! "opuścił" handle, to skarmienie go do `wrap_user_key`/`encrypt_item`,
//! które produkują ciphertext, nie sekret.
//!
//! SANKCJONOWANY WYJĄTEK OD TEJ REGUŁY (CONTEXT.md D-02):
//! `exportUserKeyForSession`/`importUserKeyFromSession` celowo przepuszczają
//! surowe bajty `WasmUserKey` jako `Vec<u8>`/`&mut [u8]` — jedyne miejsce w
//! całym kodzie poza `randomSalt`, gdzie tak się dzieje (do Fazy 24 — patrz
//! niżej). Powód: rozszerzenie (MV3 service worker) traci cały stan WASM (w
//! tym nieprzezroczyste handle) przy idle-kill, więc musi umieć
//! zserializować User Key do `chrome.storage.session` i odtworzyć go po
//! przebudzeniu. Patrz komentarz przy `export_user_key_for_session` poniżej.
//!
//! TRZECI SANKCJONOWANY WYJĄTEK (Faza 24, `generateInviteSecret`):
//! zwraca surowe bajty `invite_secret` jako `Vec<u8>` — sekret musi
//! dosłownie pojawić się we fragmencie URL, który właściciel kopiuje jako
//! link zaproszenia, więc nie da się go zachować nieprzezroczystym i nadal
//! wyprodukować udostępnialny link. Poza tym jednym miejscem, `invite_secret`
//! wchodzi do WASM WYŁĄCZNIE przez `WasmInviteChannel::fromSecret`, które
//! zeruje bufor wywołującego natychmiast po użyciu — patrz komentarz przy
//! `WasmInviteChannel` poniżej.

use pv_core::{
    items::{decrypt_item as core_decrypt_item, encrypt_item as core_encrypt_item, EncryptedItem},
    kdf::{derive_master_key, wrapping_key_from_password, KdfParams},
    keys::{
        hkdf_expand_key, random_bytes, unwrap_user_key as core_unwrap_user_key,
        wrap_user_key as core_wrap_user_key, UserKey, WrappedKey, INFO_AUTH_HASH, INFO_PW_UNLOCK,
        KEY_LEN,
    },
    prf::{wrapping_key_from_ext_prf, wrapping_key_from_prf},
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

    /// `prf_output` is the raw 32-byte WebAuthn PRF result from the
    /// EXTENSION-SCOPED passkey (rpId = extension ID, 09-CONTEXT AMENDMENT
    /// 2026-07-15) — a separate recipient class from `from_prf` above, hence
    /// `wrapping_key_from_ext_prf`'s own domain-separation constant. Same
    /// marshaling and zeroize-regardless-of-outcome discipline as `from_prf`.
    #[wasm_bindgen(js_name = fromExtPrf)]
    pub fn from_ext_prf(prf_output: &mut [u8]) -> Result<WasmWrappingKey, JsValue> {
        let result = wrapping_key_from_ext_prf(prf_output).map_err(to_js_err);
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

// SANCTIONED EXCEPTION (CONTEXT.md D-02): the MV3 extension's service
// worker destroys its WASM instance (and every opaque handle in its linear
// memory) on idle-kill, so the extension MUST be able to serialize a
// WasmUserKey's raw bytes into chrome.storage.session and reconstruct it
// on wake. This is the ONLY place raw User Key bytes cross the WASM
// boundary as a Vec<u8> in the whole codebase — web/ NEVER calls these two
// functions; only extension/entrypoints/background/vault-session.ts may.
// Callers MUST zeroize the JS-side byte buffer immediately after writing
// it to chrome.storage.session (Phase 9 Wave 2's responsibility).
#[wasm_bindgen(js_name = exportUserKeyForSession)]
pub fn export_user_key_for_session(uk: &WasmUserKey) -> Vec<u8> {
    uk.0.expose().to_vec()
}

/// Inverse of `exportUserKeyForSession` — reconstructs a `WasmUserKey` from
/// its raw exported bytes. `bytes` is zeroized (WASM-side, and via
/// wasm-bindgen's mutable-slice copy-back, the JS-side view too)
/// regardless of success or failure, mirroring `from_password`'s/
/// `from_prf`'s zeroize-regardless-of-outcome discipline.
#[wasm_bindgen(js_name = importUserKeyFromSession)]
pub fn import_user_key_from_session(bytes: &mut [u8]) -> Result<WasmUserKey, JsValue> {
    if bytes.len() != KEY_LEN {
        bytes.zeroize();
        return Err(to_js_str_err("expected 32 bytes"));
    }
    let mut arr = [0u8; KEY_LEN];
    arr.copy_from_slice(bytes);
    bytes.zeroize();
    let out = WasmUserKey(UserKey::from_bytes(arr));
    // `[u8; KEY_LEN]` is `Copy` — `UserKey::from_bytes` copied `arr`, it did
    // not move it (WR-01, Phase 21 code review). Wipe our own copy
    // explicitly.
    arr.zeroize();
    Ok(out)
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
    let mut plaintext = core_decrypt_item(&uk.0, &item, item_id, revision).map_err(to_js_err)?;
    // `core_decrypt_item` now returns `Zeroizing<Vec<u8>>` (WR-12) — move
    // the inner `Vec<u8>` out via `mem::take` (leaves an empty, already-
    // zero `Vec` in `plaintext`'s place) instead of `.clone()`ing it, so
    // building the returned `String` costs zero extra heap copies of the
    // plaintext beyond the one `String::from_utf8` already needed to make.
    let bytes = std::mem::take(&mut *plaintext);
    String::from_utf8(bytes).map_err(|e| to_js_str_err(&e.to_string()))
}

/// Nieprzezroczysty handle X25519 identity keypair (Plan 21-02/21-04) —
/// prywatna połowa tożsamości konta. Jedyna metoda zwracająca surowe bajty
/// to `publicKeyBytes`, bo klucz publiczny jest z założenia jawny (ta sama
/// logika co `randomSalt` poniżej) — żadna metoda tego typu nie zwraca
/// bajtów klucza prywatnego.
#[wasm_bindgen]
pub struct WasmIdentityKey(pv_core::identity::IdentitySecretKey);

#[wasm_bindgen]
impl WasmIdentityKey {
    #[wasm_bindgen(js_name = generate)]
    pub fn generate() -> WasmIdentityKey {
        WasmIdentityKey(pv_core::identity::IdentitySecretKey::generate())
    }

    #[wasm_bindgen(js_name = publicKeyBytes)]
    pub fn public_key_bytes(&self) -> Vec<u8> {
        self.0.public_key().to_bytes().to_vec()
    }
}

#[wasm_bindgen(js_name = wrapIdentitySecretKey)]
pub fn wrap_identity_secret_key(
    uk: &WasmUserKey,
    isk: &WasmIdentityKey,
) -> Result<String, JsValue> {
    let blob = pv_core::identity::wrap_identity_secret_key(&uk.0, &isk.0).map_err(to_js_err)?;
    serde_json::to_string(&blob).map_err(|e| to_js_str_err(&e.to_string()))
}

#[wasm_bindgen(js_name = unwrapIdentitySecretKey)]
pub fn unwrap_identity_secret_key(
    uk: &WasmUserKey,
    wrapped_json: &str,
) -> Result<WasmIdentityKey, JsValue> {
    let blob: WrappedKey =
        serde_json::from_str(wrapped_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let isk = pv_core::identity::unwrap_identity_secret_key(&uk.0, &blob).map_err(to_js_err)?;
    Ok(WasmIdentityKey(isk))
}

/// Nieprzezroczysty handle PUBLICZNEJ połowy X25519 identity keypair
/// (CR-01/CR-02, Phase 21 code review). W przeciwieństwie do
/// `WasmIdentityKey` (który owija PRYWATNĄ połowę i nigdy nie zwraca jej
/// surowych bajtów), ten handle jest publiczny z założenia — surowe bajty
/// mogą przekraczać granicę WASM/JS w OBIE strony (tak samo jak
/// `randomSalt`), bo to jest dokładnie ten "publikowalny" materiał, który
/// inny recipient musi umieć zrekonstruować z samych bajtów, żeby
/// zapieczętować (`sealCollectionKey`) coś pod cudzy klucz, NIGDY nie
/// widząc jego prywatnej połowy.
#[wasm_bindgen]
pub struct WasmIdentityPublicKey(pv_core::identity::IdentityPublicKey);

#[wasm_bindgen]
impl WasmIdentityPublicKey {
    /// Waliduje/canonicalizuje przez `pv_core::identity::IdentityPublicKey::from_bytes`
    /// (odrzuca small-order encodings — CR-01) zamiast tworzyć wartość
    /// bezpośrednio z surowych bajtów.
    #[wasm_bindgen(js_name = fromBytes)]
    pub fn from_bytes(bytes: &[u8]) -> Result<WasmIdentityPublicKey, JsValue> {
        let arr: [u8; KEY_LEN] = bytes
            .try_into()
            .map_err(|_| to_js_str_err("expected 32 bytes"))?;
        let pk = pv_core::identity::IdentityPublicKey::from_bytes(arr).map_err(to_js_err)?;
        Ok(WasmIdentityPublicKey(pk))
    }
}

/// Nieprzezroczysty handle Collection Key (Plan 21-03) — WASM-lokalny typ
/// mirror'ujący `WasmWrappingKey`'s wzorzec (żaden pv-core-owy typ nie
/// odpowiada temu handle'owi 1:1; `pv_core::items::CollectionKey` istnieje,
/// ale ten handle owija surowe bajty osobno, tak samo jak `WasmWrappingKey`
/// owija `[u8; KEY_LEN]` zamiast trzymać `UserKey`). Żadna metoda nie
/// zwraca surowych bajtów.
#[wasm_bindgen]
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct WasmCollectionKey([u8; KEY_LEN]);

#[wasm_bindgen]
impl WasmCollectionKey {
    /// Deleguje do `pv_core::items::CollectionKey::generate` (WR-05) —
    /// wypełnia tablicę bezpośrednio, zamiast przechodzić przez
    /// `random_bytes`'s niezerowalny heap `Vec<u8>` (ta funkcja jest
    /// udokumentowana w `keys.rs` jako przeznaczona wyłącznie do jawnej
    /// losowości typu sól, NIE do materiału kluczowego).
    #[wasm_bindgen(js_name = generate)]
    pub fn generate() -> WasmCollectionKey {
        let ck = pv_core::items::CollectionKey::generate();
        WasmCollectionKey(*ck.expose())
    }
}

/// Zapieczętowuje `ck` pod PUBLICZNYM kluczem recipienta (CR-02): przyjmuje
/// `&WasmIdentityPublicKey`, NIE `&WasmIdentityKey` — sealing musi być
/// wyrażalny mając wyłącznie publiczną połowę recipienta (dokładnie to, co
/// `WasmIdentityKey::publicKeyBytes()` produkuje), nigdy jego prywatny
/// klucz, którego sender z definicji nie posiada.
#[wasm_bindgen(js_name = sealCollectionKey)]
pub fn seal_collection_key(
    recipient_pk: &WasmIdentityPublicKey,
    ck: &WasmCollectionKey,
) -> Result<String, JsValue> {
    let sealed = pv_core::identity::seal(&recipient_pk.0, &ck.0).map_err(to_js_err)?;
    serde_json::to_string(&sealed).map_err(|e| to_js_str_err(&e.to_string()))
}

/// Odpieczętowuje `sealed_json` pod `my_identity_key`. Deleguje do
/// `pv_core::identity::unseal_collection_key` (WR-06) — długość plaintextu
/// jest walidowana raz, w pv-core, zamiast być zduplikowana tutaj.
#[wasm_bindgen(js_name = unsealCollectionKey)]
pub fn unseal_collection_key(
    my_identity_key: &WasmIdentityKey,
    sealed_json: &str,
) -> Result<WasmCollectionKey, JsValue> {
    let sealed: pv_core::identity::SealedKey =
        serde_json::from_str(sealed_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let collection_key =
        pv_core::identity::unseal_collection_key(&my_identity_key.0, &sealed).map_err(to_js_err)?;
    Ok(WasmCollectionKey(*collection_key.expose()))
}

#[wasm_bindgen(js_name = encryptItemForCollection)]
pub fn encrypt_item_for_collection(
    ck: &WasmCollectionKey,
    plaintext: &str,
    collection_id: &str,
    item_id: &str,
    revision: u32,
) -> Result<String, JsValue> {
    let collection_key = pv_core::items::CollectionKey::from_bytes(ck.0);
    let item = pv_core::items::encrypt_item_for_collection(
        &collection_key,
        plaintext.as_bytes(),
        collection_id,
        item_id,
        revision,
    )
    .map_err(to_js_err)?;
    serde_json::to_string(&item).map_err(|e| to_js_str_err(&e.to_string()))
}

#[wasm_bindgen(js_name = decryptItemForCollection)]
pub fn decrypt_item_for_collection(
    ck: &WasmCollectionKey,
    item_json: &str,
    collection_id: &str,
    item_id: &str,
    revision: u32,
) -> Result<String, JsValue> {
    let collection_key = pv_core::items::CollectionKey::from_bytes(ck.0);
    let item: EncryptedItem =
        serde_json::from_str(item_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let mut plaintext = pv_core::items::decrypt_item_for_collection(
        &collection_key,
        &item,
        collection_id,
        item_id,
        revision,
    )
    .map_err(to_js_err)?;
    // See `decrypt_item` above — `Zeroizing<Vec<u8>>` (WR-12), moved out via
    // `mem::take` rather than cloned.
    let bytes = std::mem::take(&mut *plaintext);
    String::from_utf8(bytes).map_err(|e| to_js_str_err(&e.to_string()))
}

/// Rewrap-only: przenosi Cipher Key spod OLD `CollectionKey`a pod NEW,
/// nigdy nie dotykając `enc_data` — mirroring `encryptItemForCollection`/
/// `decryptItemForCollection`'s binding shape (construct-from-bytes,
/// serde_json, `to_js_err`/`to_js_str_err`).
#[wasm_bindgen(js_name = rewrapItemKeyForCollection)]
pub fn rewrap_item_key_for_collection(
    old_ck: &WasmCollectionKey,
    new_ck: &WasmCollectionKey,
    old_enc_key_json: &str,
    collection_id: &str,
    item_id: &str,
) -> Result<String, JsValue> {
    let old_collection_key = pv_core::items::CollectionKey::from_bytes(old_ck.0);
    let new_collection_key = pv_core::items::CollectionKey::from_bytes(new_ck.0);
    let old_enc_key: WrappedKey =
        serde_json::from_str(old_enc_key_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let new_enc_key = pv_core::items::rewrap_item_key_for_collection(
        &old_collection_key,
        &new_collection_key,
        &old_enc_key,
        collection_id,
        item_id,
    )
    .map_err(to_js_err)?;
    serde_json::to_string(&new_enc_key).map_err(|e| to_js_str_err(&e.to_string()))
}

/// Nieprzezroczysty wynik `wasmCreateProviderCredential` — WYŁĄCZNIE dwa
/// pola: publiczna odpowiedź WebAuthn (`credential_response_json`) i
/// już-zaszyfrowany vault item (`encrypted_item_json`). `pv_provider`'s
/// `new_passkey_json` (surowy plaintext Passkey, materiał klucza
/// prywatnego) NIGDY nie staje się polem tego structu ani wartością zwracaną
/// do JS — istnieje wyłącznie jako lokalna zmienna wewnątrz
/// `wasm_create_provider_credential`, skonsumowana przez `core_encrypt_item`
/// przed returnem (T-12-01 mitigation; PROV-05 grep-audit boundary).
#[wasm_bindgen]
pub struct WasmCreateProviderResult {
    credential_response_json: String,
    encrypted_item_json: String,
}

#[wasm_bindgen]
impl WasmCreateProviderResult {
    #[wasm_bindgen(js_name = credentialResponseJson)]
    pub fn credential_response_json(&self) -> String {
        self.credential_response_json.clone()
    }

    #[wasm_bindgen(js_name = encryptedItemJson)]
    pub fn encrypted_item_json(&self) -> String {
        self.encrypted_item_json.clone()
    }
}

/// Nieprzezroczysty wynik `wasmGetProviderAssertion` — WYŁĄCZNIE dwa pola:
/// publiczna asercja WebAuthn i (opcjonalnie) na nowo zaszyfrowany vault
/// item, jeśli passkey-rs zmutował stan credentiala (np. sign counter)
/// podczas ceremonii. `updated_encrypted_item_json` jest `None`, gdy nic się
/// nie zmieniło (domyślny przypadek — patrz komentarz w `pv-provider`'s
/// `ceremony.rs`).
#[wasm_bindgen]
pub struct WasmGetProviderResult {
    credential_response_json: String,
    updated_encrypted_item_json: Option<String>,
}

#[wasm_bindgen]
impl WasmGetProviderResult {
    #[wasm_bindgen(js_name = credentialResponseJson)]
    pub fn credential_response_json(&self) -> String {
        self.credential_response_json.clone()
    }

    #[wasm_bindgen(js_name = updatedEncryptedItemJson)]
    pub fn updated_encrypted_item_json(&self) -> Option<String> {
        self.updated_encrypted_item_json.clone()
    }
}

/// Rejestruje nowy passkey (`pv_provider::create_provider_credential`) i
/// NATYCHMIAST, w tej samej funkcji, szyfruje wynikowy plaintext Passkey
/// (`new_passkey_json`, materiał klucza prywatnego) przez ISTNIEJĄCY
/// `core_encrypt_item` — zero nowych prymitywów kryptograficznych (D-07).
/// `new_passkey_json` opuszcza scope tej funkcji jako lokalna `String` i
/// nigdy nie jest przypisywana do pola zwracanego do JS (T-12-01).
#[wasm_bindgen(js_name = wasmCreateProviderCredential)]
pub fn wasm_create_provider_credential(
    uk: &WasmUserKey,
    request_json: &str,
    origin: &str,
    item_id: &str,
) -> Result<WasmCreateProviderResult, JsValue> {
    let result = pv_provider::create_provider_credential(request_json, origin)
        .map_err(|e| to_js_str_err(&e.to_string()))?;
    let encrypted_item =
        core_encrypt_item(&uk.0, result.new_passkey_json.as_bytes(), item_id, 1).map_err(to_js_err)?;
    let encrypted_item_json =
        serde_json::to_string(&encrypted_item).map_err(|e| to_js_str_err(&e.to_string()))?;
    Ok(WasmCreateProviderResult {
        credential_response_json: result.credential_response_json,
        encrypted_item_json,
    })
}

/// Odszyfrowuje `matching_item_json` (JEDEN pasujący zaszyfrowany vault item)
/// ISTNIEJĄCYM `core_decrypt_item`, przekazuje odzyskany plaintext Passkey
/// JSON jako jednoelementową tablicę do `pv_provider::get_provider_assertion`,
/// i jeśli passkey-rs zwróci `updated_passkey_json` (zmieniony sign
/// counter), re-szyfruje go `core_encrypt_item`-em z `revision + 1` przed
/// returnem. Plaintext Passkey JSON (przed i po) istnieje wyłącznie jako
/// lokalne zmienne — nigdy jako pole zwracane do JS.
#[wasm_bindgen(js_name = wasmGetProviderAssertion)]
pub fn wasm_get_provider_assertion(
    uk: &WasmUserKey,
    request_json: &str,
    origin: &str,
    matching_item_json: &str,
    item_id: &str,
    revision: u32,
) -> Result<WasmGetProviderResult, JsValue> {
    let item: EncryptedItem =
        serde_json::from_str(matching_item_json).map_err(|e| to_js_str_err(&e.to_string()))?;
    let mut plaintext = core_decrypt_item(&uk.0, &item, item_id, revision).map_err(to_js_err)?;
    // See `decrypt_item` above — `Zeroizing<Vec<u8>>` (WR-12), moved out via
    // `mem::take` rather than cloned.
    let bytes = std::mem::take(&mut *plaintext);
    let passkey_json =
        String::from_utf8(bytes).map_err(|e| to_js_str_err(&e.to_string()))?;
    // KNOWN LIMITATION (WR-12, not fixed this phase): `format!` below
    // allocates a SECOND, never-zeroized heap copy of `passkey_json` (a
    // passkey private key in JSON form) to build the one-element JSON
    // array `pv_provider::get_provider_assertion` expects. Closing this
    // fully requires changing that function's signature to accept
    // `&[&str]` and building `PvCredentialStore` from individually-parsed
    // JSON strings instead of one pre-joined array string — a cross-crate
    // change to `pv-provider` (outside this phase's reviewed files) left
    // for a follow-up rather than applied without full context on its own
    // test coverage (`pv-provider/tests/{response_shape,real_rp_verification}.rs`).
    let existing_credentials_json = format!("[{passkey_json}]");

    let result = pv_provider::get_provider_assertion(request_json, origin, &existing_credentials_json)
        .map_err(|e| to_js_str_err(&e.to_string()))?;

    let updated_encrypted_item_json = match result.updated_passkey_json {
        Some(updated_json) => {
            let encrypted = core_encrypt_item(&uk.0, updated_json.as_bytes(), item_id, revision + 1)
                .map_err(to_js_err)?;
            Some(serde_json::to_string(&encrypted).map_err(|e| to_js_str_err(&e.to_string()))?)
        }
        None => None,
    };

    Ok(WasmGetProviderResult {
        credential_response_json: result.credential_response_json,
        updated_encrypted_item_json,
    })
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

/// Generuje świeży 32-bajtowy `invite_secret` — TRZECI, wąsko zakresowany
/// wyjątek od reguły "surowe bajty klucza nigdy nie przekraczają granicy
/// WASM/JS" (obok `randomSalt`/`exportUserKeyForSession` — patrz komentarz na
/// górze pliku). Uzasadnienie: `invite_secret` musi dosłownie pojawić się we
/// fragmencie URL, który właściciel kopiuje jako link zaproszenia — nie ma
/// sposobu, by zachować go nieprzezroczystym i nadal wyprodukować
/// udostępnialny link.
#[wasm_bindgen(js_name = generateInviteSecret)]
pub fn generate_invite_secret() -> Vec<u8> {
    random_bytes(KEY_LEN)
}

/// Nieprzezroczysty handle kanału zaproszenia (Faza 24, `pv_core::invite`) —
/// trzyma WYŁĄCZNIE surowy `invite_secret`, NIE pre-derived wrap key ani
/// proof, bo `wrap_collection_key_for_invite`/`unwrap_collection_key_for_invite`/
/// `derive_invite_proof`/`hash_invite_proof` same wewnętrznie na nowo
/// derywują to, czego potrzebują z sekretu + `invite_id` — zadaniem tego
/// handle'a jest tylko przechowywać to, czego te funkcje potrzebują, nie
/// reimplementować ich derywacji. `invite_id` jest jawnie NIE-sekretny
/// (`#[zeroize(skip)]` — zerowanie `String` dorzuciłoby pytanie o
/// dependency-feature, którego to zadanie nie musi rozstrzygać), a
/// `invite_secret` nadal zeruje się przy Drop.
///
/// Żadna metoda tego structu nie zwraca `invite_secret`'s bajtów wprost —
/// wyłącznie jego jednokierunkowe derywacje (`inviteId` jako string, metody
/// proof jako bajty) przekraczają granicę.
#[wasm_bindgen]
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct WasmInviteChannel {
    #[zeroize(skip)]
    invite_id: String,
    invite_secret: [u8; KEY_LEN],
}

#[wasm_bindgen]
impl WasmInviteChannel {
    /// Buduje kanał WYŁĄCZNIE z surowych bajtów sekretu (własnego wyjścia
    /// `generateInviteSecret`, lub fragmentu linku zaproszenia) — NIGDY z
    /// samego `invite_id`, bo `invite_id` nie pozwala odtworzyć ani wrap
    /// key, ani proof. Waliduje długość, kopiuje bajty do lokalnej tablicy,
    /// derywuje `invite_id`. `secret` (bufor wywołującego) jest zerowany na
    /// końcu bez względu na wynik — tak samo jak `from_password`.
    #[wasm_bindgen(js_name = fromSecret)]
    pub fn from_secret(secret: &mut [u8]) -> Result<WasmInviteChannel, JsValue> {
        if secret.len() != KEY_LEN {
            secret.zeroize();
            return Err(to_js_str_err("expected 32 bytes"));
        }
        let mut secret_array = [0u8; KEY_LEN];
        secret_array.copy_from_slice(secret);
        secret.zeroize();
        let invite_id = pv_core::invite::derive_invite_id(&secret_array);
        Ok(WasmInviteChannel {
            invite_id,
            invite_secret: secret_array,
        })
    }

    /// Jedyne pole tego handle'a, które NIE jest sekretem — bezpieczne do
    /// zwrócenia. Deterministyczne: ten sam `invite_secret` zawsze produkuje
    /// ten sam `invite_id`, niezależnie od tego, na którym niezależnie
    /// skonstruowanym handle'u zostanie wywołane.
    #[wasm_bindgen(js_name = inviteId)]
    pub fn invite_id(&self) -> String {
        self.invite_id.clone()
    }

    /// Wartość, którą klient ZAPRASZAJĄCEGO wysyła jako `proof_hash` przy
    /// `POST /api/invitations` (Plan 24-02) — `SHA-256(invite_proof)`.
    /// Warstwa web sama base64-koduje ten `Vec<u8>` (Plan 24-05), zgodnie z
    /// istniejącą konwencją `publicKeyBytes()`/`randomSalt`'a (surowe bajty
    /// na wyjściu, kodowanie po stronie web). NIE mylić z
    /// `proofForRedemption` — to jest HASH (dowód, że twórca będzie mógł go
    /// później odtworzyć), nie surowa wartość.
    #[wasm_bindgen(js_name = proofHashForCreation)]
    pub fn proof_hash_for_creation(&self) -> Vec<u8> {
        // WR-08 (24-REVIEW.md): `derive_invite_proof` now returns
        // `Zeroizing<[u8; KEY_LEN]>`, so `proof` (a bearer credential) is
        // zeroized automatically when it drops at the end of this scope --
        // previously a bare `[u8; KEY_LEN]` dropped un-zeroized here.
        let proof = pv_core::invite::derive_invite_proof(&self.invite_secret);
        pv_core::invite::hash_invite_proof(&proof).to_vec()
    }

    /// Surowa (NIE zahaszowana) wartość, którą klient ZAPROSZONEGO wysyła
    /// jako `invite_proof` do OBU endpointów (metadata fetch i accept, Plan
    /// 24-02). NIGDY nie mylić z `proofHashForCreation` — ta metoda zwraca
    /// to, co faktycznie prezentuje odbiorca, nie jego hash.
    #[wasm_bindgen(js_name = proofForRedemption)]
    pub fn proof_for_redemption(&self) -> Vec<u8> {
        pv_core::invite::derive_invite_proof(&self.invite_secret).to_vec()
    }

    /// Zawija `ck` pod `invite_wrap_key` derywowanym z tego kanału,
    /// AAD-bound do `self.invite_id`. Deleguje do
    /// `pv_core::invite::wrap_collection_key_for_invite` — żadna nowa
    /// logika kryptograficzna w tym pliku.
    #[wasm_bindgen(js_name = wrapCollectionKey)]
    pub fn wrap_collection_key(&self, ck: &WasmCollectionKey) -> Result<String, JsValue> {
        let blob = pv_core::invite::wrap_collection_key_for_invite(
            &self.invite_secret,
            &self.invite_id,
            &ck.0,
        )
        .map_err(to_js_err)?;
        serde_json::to_string(&blob).map_err(|e| to_js_str_err(&e.to_string()))
    }

    /// Odwrotność `wrapCollectionKey` — odtwarza `WrappedKey` z JSON-a,
    /// deleguje do `pv_core::invite::unwrap_collection_key_for_invite`.
    /// Na kanale zbudowanym z INNEGO sekretu (a więc z innym `invite_id`,
    /// więc inną AAD) to zawodzi zamknięte — dokładnie własność, na której
    /// polega odrzucenie T-24-11/T-24-23-adjacent podszywania.
    #[wasm_bindgen(js_name = unwrapCollectionKey)]
    pub fn unwrap_collection_key(&self, wrapped_json: &str) -> Result<WasmCollectionKey, JsValue> {
        let blob: WrappedKey =
            serde_json::from_str(wrapped_json).map_err(|e| to_js_str_err(&e.to_string()))?;
        let collection_key = pv_core::invite::unwrap_collection_key_for_invite(
            &self.invite_secret,
            &self.invite_id,
            &blob,
        )
        .map_err(to_js_err)?;
        Ok(WasmCollectionKey(collection_key))
    }
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
    fn from_ext_prf_roundtrip_and_zeroizes_input() {
        let mut prf_output = [7u8; 32];
        let wrapping_key = WasmWrappingKey::from_ext_prf(&mut prf_output)
            .expect("from_ext_prf should succeed on a 32-byte fixture");
        assert!(prf_output.iter().all(|&b| b == 0), "input buffer must be zeroized after the call");

        let user_key = WasmUserKey::generate();
        let wrapped_json = wrap_user_key(&wrapping_key, &user_key).expect("wrap should succeed");
        let unwrapped =
            unwrap_user_key(&wrapping_key, &wrapped_json).expect("unwrap should succeed");
        assert_eq!(unwrapped.0.expose(), user_key.0.expose());
    }

    #[test]
    fn from_ext_prf_rejects_short_input_and_still_zeroizes() {
        let mut short = [9u8; 16];
        let result = WasmWrappingKey::from_ext_prf(&mut short);
        assert!(result.is_err());
        assert!(short.iter().all(|&b| b == 0), "input buffer must be zeroized even on failure");
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

    #[test]
    fn export_import_user_key_roundtrip() {
        let uk = WasmUserKey::generate();
        // Capture the original exposed bytes as an owned array before the
        // export call borrows `uk` — comparing against a second, unrelated
        // `WasmUserKey::generate()` would be wrong (different key material).
        let original: [u8; 32] = *uk.0.expose();
        let mut exported = export_user_key_for_session(&uk);
        let imported =
            import_user_key_from_session(&mut exported).expect("import should succeed");
        assert_eq!(imported.0.expose(), &original);
    }

    #[test]
    fn import_user_key_from_session_rejects_wrong_length() {
        let mut short = vec![0u8; 16];
        let result = import_user_key_from_session(&mut short);
        assert!(result.is_err());
    }

    #[test]
    fn import_user_key_from_session_zeroizes_input_on_success() {
        let uk = WasmUserKey::generate();
        let mut exported = export_user_key_for_session(&uk);
        let _imported =
            import_user_key_from_session(&mut exported).expect("import should succeed");
        assert!(exported.iter().all(|&b| b == 0));
    }

    // --- Task 2 (12-01): provider ceremony bindings -----------------------

    fn provider_base64url(bytes: &[u8]) -> String {
        use base64::Engine;
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
    }

    fn provider_fixture_create_request(rp_id: &str) -> String {
        serde_json::json!({
            "publicKey": {
                "rp": { "id": rp_id, "name": "Example" },
                "user": {
                    "id": provider_base64url(&[1u8; 16]),
                    "name": "user@example.com",
                    "displayName": "User",
                },
                "challenge": provider_base64url(&[2u8; 16]),
                "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
            }
        })
        .to_string()
    }

    fn provider_fixture_get_request(rp_id: &str) -> String {
        serde_json::json!({
            "publicKey": {
                "challenge": provider_base64url(&[3u8; 16]),
                "rpId": rp_id,
            }
        })
        .to_string()
    }

    #[test]
    fn wasm_create_then_get_roundtrip() {
        let uk = WasmUserKey::generate();
        let request_json = provider_fixture_create_request("example.com");
        let result =
            wasm_create_provider_credential(&uk, &request_json, "https://example.com", "item-1")
                .expect("wasm_create_provider_credential should succeed");

        // encrypted_item_json decrypts via the EXISTING decrypt_item
        // binding back to the plaintext Passkey mirror JSON.
        let plaintext_json = decrypt_item(&uk, &result.encrypted_item_json(), "item-1", 1)
            .expect("decrypt_item should succeed");
        let plaintext: serde_json::Value = serde_json::from_str(&plaintext_json).unwrap();
        let credential_id_bytes: Vec<u8> = plaintext["credential_id"]
            .as_array()
            .expect("credential_id must be a JSON array")
            .iter()
            .map(|v| v.as_u64().expect("credential_id byte must be a number") as u8)
            .collect();

        // Consistent with (same credential id as) credential_response_json.
        let response: serde_json::Value =
            serde_json::from_str(&result.credential_response_json()).unwrap();
        let response_id_b64 = response["id"].as_str().expect("id must be a string");
        use base64::Engine;
        let response_id_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(response_id_b64)
            .expect("id must be valid base64url");
        assert_eq!(credential_id_bytes, response_id_bytes);

        // WasmCreateProviderResult exposes ONLY credential_response_json()/
        // encrypted_item_json() (see this struct's definition above) — no
        // method/field returns raw private-key bytes or the intermediate
        // plaintext Passkey JSON (`new_passkey_json` never leaves
        // wasm_create_provider_credential's body as anything but ciphertext,
        // enforced by this file's struct definition + the PROV-05 grep audit).
    }

    #[test]
    fn wasm_get_assertion_from_encrypted_item() {
        let uk = WasmUserKey::generate();
        let request_json = provider_fixture_create_request("example.com");
        let create_result =
            wasm_create_provider_credential(&uk, &request_json, "https://example.com", "item-1")
                .expect("wasm_create_provider_credential should succeed");

        let get_request_json = provider_fixture_get_request("example.com");
        let get_result = wasm_get_provider_assertion(
            &uk,
            &get_request_json,
            "https://example.com",
            &create_result.encrypted_item_json(),
            "item-1",
            1,
        )
        .expect("wasm_get_provider_assertion should succeed");

        let created: serde_json::Value =
            serde_json::from_str(&create_result.credential_response_json()).unwrap();
        let asserted: serde_json::Value =
            serde_json::from_str(&get_result.credential_response_json()).unwrap();
        assert_eq!(created["id"], asserted["id"]);
    }

    // --- Task 1 (21-05): WasmIdentityKey + WasmCollectionKey bindings -----

    #[test]
    fn identity_key_generate_wrap_unwrap_roundtrip() {
        let uk = WasmUserKey::generate();
        let isk = WasmIdentityKey::generate();
        let expected_pk = isk.public_key_bytes();

        let wrapped_json =
            wrap_identity_secret_key(&uk, &isk).expect("wrap should succeed");
        let unwrapped = unwrap_identity_secret_key(&uk, &wrapped_json)
            .expect("unwrap should succeed");

        assert_eq!(unwrapped.public_key_bytes(), expected_pk);
    }

    #[test]
    fn identity_key_wrong_user_key_fails() {
        let uk = WasmUserKey::generate();
        let other_uk = WasmUserKey::generate();
        let isk = WasmIdentityKey::generate();

        let wrapped_json =
            wrap_identity_secret_key(&uk, &isk).expect("wrap should succeed");
        let result = unwrap_identity_secret_key(&other_uk, &wrapped_json);
        assert!(result.is_err());
    }

    #[test]
    fn unseal_wrong_recipient_fails() {
        let recipient = WasmIdentityKey::generate();
        let other_recipient = WasmIdentityKey::generate();
        let ck = WasmCollectionKey::generate();

        let recipient_pk = WasmIdentityPublicKey::from_bytes(&recipient.public_key_bytes())
            .expect("a real generated public key must never be small-order");
        let sealed_json =
            seal_collection_key(&recipient_pk, &ck).expect("seal should succeed");
        let result = unseal_collection_key(&other_recipient, &sealed_json);
        assert!(result.is_err());
    }

    #[test]
    fn seal_unseal_collection_key_roundtrip() {
        let recipient = WasmIdentityKey::generate();
        let ck = WasmCollectionKey::generate();

        let recipient_pk = WasmIdentityPublicKey::from_bytes(&recipient.public_key_bytes())
            .expect("a real generated public key must never be small-order");
        let sealed_json =
            seal_collection_key(&recipient_pk, &ck).expect("seal should succeed");
        let unsealed = unseal_collection_key(&recipient, &sealed_json)
            .expect("unseal should succeed");

        // WasmCollectionKey exposes no raw-byte getter — prove equivalence
        // via a round trip through encryptItemForCollection/
        // decryptItemForCollection instead (something the original key
        // encrypts, the unsealed key must be able to decrypt).
        let item_json = encrypt_item_for_collection(
            &ck,
            "{\"type\":\"note\",\"body\":\"fixture\"}",
            "collection-1",
            "item-1",
            1,
        )
        .expect("encrypt should succeed");
        let plaintext =
            decrypt_item_for_collection(&unsealed, &item_json, "collection-1", "item-1", 1)
                .expect("decrypt with unsealed key should succeed");
        assert_eq!(plaintext, "{\"type\":\"note\",\"body\":\"fixture\"}");
    }

    /// CR-02 regression: the real sharing flow. Bob generates his identity
    /// keypair once; only its PUBLIC bytes are "published" (as they would
    /// be via the server). Alice reconstructs a public-key-only handle from
    /// those bytes alone and seals with it — she never touches `bob` (the
    /// secret half) at seal time. This is exactly the boundary CR-02 found
    /// missing: sealing must be expressible holding only the recipient's
    /// PUBLIC value, and only Bob's real secret-key handle can unseal it.
    #[test]
    fn seal_with_recipient_public_key_only_cross_party() {
        let bob = WasmIdentityKey::generate();
        let bob_public_key_bytes = bob.public_key_bytes();

        let alice_view_of_bob_pk = WasmIdentityPublicKey::from_bytes(&bob_public_key_bytes)
            .expect("valid public key bytes");
        let ck = WasmCollectionKey::generate();
        let sealed_json = seal_collection_key(&alice_view_of_bob_pk, &ck)
            .expect("seal with public-key-only handle should succeed");

        let unsealed = unseal_collection_key(&bob, &sealed_json)
            .expect("bob should be able to unseal what alice sealed to his public key");

        let item_json = encrypt_item_for_collection(
            &ck,
            "{\"type\":\"note\",\"body\":\"cross-party fixture\"}",
            "collection-1",
            "item-1",
            1,
        )
        .expect("encrypt should succeed");
        let plaintext =
            decrypt_item_for_collection(&unsealed, &item_json, "collection-1", "item-1", 1)
                .expect("bob's unsealed key should decrypt what alice's ck encrypted");
        assert_eq!(plaintext, "{\"type\":\"note\",\"body\":\"cross-party fixture\"}");
    }

    /// CR-01 regression at the WASM boundary: `WasmIdentityPublicKey::fromBytes`
    /// must reject small-order encodings (all-zero) that a malicious/buggy
    /// server could hand to a JS caller before it ever reaches `sealCollectionKey`.
    #[test]
    fn wasm_identity_public_key_from_bytes_rejects_small_order() {
        let result = WasmIdentityPublicKey::from_bytes(&[0u8; KEY_LEN]);
        assert!(result.is_err());
    }

    #[test]
    fn wasm_identity_public_key_from_bytes_rejects_wrong_length() {
        let result = WasmIdentityPublicKey::from_bytes(&[0u8; 16]);
        assert!(result.is_err());
    }

    // --- Task 2 (21-05): encryptItemForCollection/decryptItemForCollection

    #[test]
    fn collection_item_roundtrip() {
        let ck = WasmCollectionKey::generate();
        let item_json = encrypt_item_for_collection(
            &ck,
            "{\"type\":\"login\",\"username\":\"bartek\"}",
            "collection-1",
            "item-1",
            1,
        )
        .expect("encrypt should succeed");
        let plaintext =
            decrypt_item_for_collection(&ck, &item_json, "collection-1", "item-1", 1)
                .expect("decrypt should succeed");
        assert_eq!(plaintext, "{\"type\":\"login\",\"username\":\"bartek\"}");
    }

    #[test]
    fn collection_item_wrong_collection_id_fails() {
        let ck = WasmCollectionKey::generate();
        let item_json =
            encrypt_item_for_collection(&ck, "secret", "collection-1", "item-1", 1)
                .expect("encrypt should succeed");
        let result =
            decrypt_item_for_collection(&ck, &item_json, "collection-2", "item-1", 1);
        assert!(result.is_err());
    }

    // --- Task 2 (25-02): rewrapItemKeyForCollection

    #[test]
    fn rewrap_item_key_for_collection_new_key_opens_old_key_does_not() {
        let old_ck = WasmCollectionKey::generate();
        let new_ck = WasmCollectionKey::generate();
        let plaintext = "{\"type\":\"login\",\"username\":\"bartek\"}";
        let item_json = encrypt_item_for_collection(
            &old_ck,
            plaintext,
            "collection-1",
            "item-1",
            1,
        )
        .expect("encrypt should succeed");
        let item: EncryptedItem =
            serde_json::from_str(&item_json).expect("item json should parse");
        let old_enc_key_json =
            serde_json::to_string(&item.enc_key).expect("enc_key json should serialize");

        let new_enc_key_json = rewrap_item_key_for_collection(
            &old_ck,
            &new_ck,
            &old_enc_key_json,
            "collection-1",
            "item-1",
        )
        .expect("rewrap should succeed");

        // enc_data left byte-for-byte untouched — only enc_key is swapped.
        let rewrapped_item = EncryptedItem {
            enc_key: serde_json::from_str(&new_enc_key_json).expect("new enc_key should parse"),
            enc_data: item.enc_data.clone(),
        };
        let rewrapped_item_json =
            serde_json::to_string(&rewrapped_item).expect("rewrapped item should serialize");

        let decrypted_under_new = decrypt_item_for_collection(
            &new_ck,
            &rewrapped_item_json,
            "collection-1",
            "item-1",
            1,
        )
        .expect("decrypt under new key should succeed");
        assert_eq!(decrypted_under_new, plaintext);

        let decrypted_under_old = decrypt_item_for_collection(
            &old_ck,
            &rewrapped_item_json,
            "collection-1",
            "item-1",
            1,
        );
        assert!(decrypted_under_old.is_err());
    }
}

// NEW, SEPARATE module from `mod tests` above (NOT merged into it) — a
// second `mod tests` with the same name in this file would be a compile
// error, and this distinct module name is also what makes the filtered
// `cargo test -p pv-wasm invite_channel_tests::` command actually match
// something (full test paths become `pv_wasm::invite_channel_tests::...`).
#[cfg(test)]
mod invite_channel_tests {
    use super::*;

    #[test]
    fn invite_id_is_deterministic_for_the_same_secret() {
        let secret = random_bytes(KEY_LEN);
        let mut secret_a = secret.clone();
        let mut secret_b = secret.clone();
        let channel_a =
            WasmInviteChannel::from_secret(&mut secret_a).expect("from_secret should succeed");
        let channel_b =
            WasmInviteChannel::from_secret(&mut secret_b).expect("from_secret should succeed");

        assert_eq!(channel_a.invite_id(), channel_b.invite_id());
    }

    #[test]
    fn proof_hash_for_creation_and_proof_for_redemption_are_different_but_each_is_stable_across_two_channels_built_from_the_same_secret(
    ) {
        let secret = random_bytes(KEY_LEN);
        let mut secret_a = secret.clone();
        let mut secret_b = secret.clone();
        let channel_a =
            WasmInviteChannel::from_secret(&mut secret_a).expect("from_secret should succeed");
        let channel_b =
            WasmInviteChannel::from_secret(&mut secret_b).expect("from_secret should succeed");

        let hash_a = channel_a.proof_hash_for_creation();
        let proof_a = channel_a.proof_for_redemption();
        // The two methods on the SAME channel must return DIFFERENT bytes.
        assert_ne!(hash_a, proof_a);

        let hash_b = channel_b.proof_hash_for_creation();
        let proof_b = channel_b.proof_for_redemption();
        // Each of the two methods is stable across two independently
        // constructed channels built from the identical secret.
        assert_eq!(hash_a, hash_b);
        assert_eq!(proof_a, proof_b);
    }

    #[test]
    fn wrap_unwrap_roundtrip_via_two_independently_constructed_channels() {
        // Construct TWO WasmInviteChannels from copies of the SAME secret
        // bytes, wrap with one, unwrap with the other — proving the
        // invitee's browser, holding only the fragment secret, can decrypt
        // what the owner's browser wrapped.
        let secret = random_bytes(KEY_LEN);
        let mut secret_a = secret.clone();
        let mut secret_b = secret.clone();
        let owner_channel =
            WasmInviteChannel::from_secret(&mut secret_a).expect("from_secret should succeed");
        let invitee_channel =
            WasmInviteChannel::from_secret(&mut secret_b).expect("from_secret should succeed");

        let ck = WasmCollectionKey::generate();
        let wrapped_json = owner_channel
            .wrap_collection_key(&ck)
            .expect("wrap should succeed");
        let unwrapped = invitee_channel
            .unwrap_collection_key(&wrapped_json)
            .expect("unwrap should succeed");

        // WasmCollectionKey exposes no raw-byte getter — prove equivalence
        // via an encrypt/decrypt round trip, mirroring
        // seal_unseal_collection_key_roundtrip's existing idiom above.
        let item_json = encrypt_item_for_collection(
            &ck,
            "{\"type\":\"note\",\"body\":\"fixture\"}",
            "collection-1",
            "item-1",
            1,
        )
        .expect("encrypt should succeed");
        let plaintext =
            decrypt_item_for_collection(&unwrapped, &item_json, "collection-1", "item-1", 1)
                .expect("decrypt with unwrapped key should succeed");
        assert_eq!(plaintext, "{\"type\":\"note\",\"body\":\"fixture\"}");
    }

    #[test]
    fn unwrap_fails_across_different_secrets() {
        let mut secret_a = random_bytes(KEY_LEN);
        let mut secret_b = random_bytes(KEY_LEN);
        let channel_a =
            WasmInviteChannel::from_secret(&mut secret_a).expect("from_secret should succeed");
        let channel_b =
            WasmInviteChannel::from_secret(&mut secret_b).expect("from_secret should succeed");

        let ck = WasmCollectionKey::generate();
        let wrapped_json = channel_a
            .wrap_collection_key(&ck)
            .expect("wrap should succeed");
        let result = channel_b.unwrap_collection_key(&wrapped_json);
        assert!(result.is_err());
    }

    #[test]
    fn generate_invite_secret_returns_32_distinct_bytes_across_two_calls() {
        let a = generate_invite_secret();
        let b = generate_invite_secret();
        assert_eq!(a.len(), KEY_LEN);
        assert_eq!(b.len(), KEY_LEN);
        assert_ne!(a, b);
    }
}
