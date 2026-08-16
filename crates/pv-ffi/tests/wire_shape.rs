//! Byte-shape regression test for `pv-ffi`'s wire functions (DR-38-C, E-W1).
//!
//! Modelled on `crates/pv-provider/tests/response_shape.rs` (FFI-05): the
//! assertions are made **on the parsed JSON value**, not on the Rust type
//! that produced it. Asserting on the Rust type would only prove that
//! `WrappedKey` still has two fields — it could never catch the defect this
//! file exists for, which is a change in how those fields are *encoded*.
//!
//! The defect being guarded against: `pv-server` stores `enc_key`/`enc_data`
//! as opaque `TEXT` and never parses them, so it returns `201` for a base64
//! encoding just as happily as for the number-array encoding every other
//! client writes. Nothing on the iOS side can notice. The failure surfaces in
//! the *web* client as an integrity warning on a row iOS wrote. See landmine
//! L-17 in `ios/IOS-SPIKE-LOG.md` §3.
//!
//! Falsifiability, demonstrated rather than claimed (38-02 Task 1): with
//! `encrypt_item_wire`'s body temporarily changed to base64-encode the nonce,
//! `nonce_is_a_json_number_array_never_a_base64_string` fails. The transcript
//! is in `38-02-SUMMARY.md`. A guard never seen red is not a guard.

use pv_ffi::{
    decrypt_item_combined_json, decrypt_item_wire, encrypt_item_combined_json, encrypt_item_wire,
    FfiError, FfiUserKey,
};
use serde_json::Value;

const PLAINTEXT: &str = r#"{"type":"note","name":"wire fixture","folderId":null,"tags":[],"body":"hello"}"#;
const ITEM_ID: &str = "8f14e45f-ceea-467a-9ba5-1c1a2b3c4d5e";

/// THE test this file exists for. Both item columns must encode their two
/// byte fields as JSON **arrays of numbers**, matching `serde_json`'s default
/// `Vec<u8>` encoding — which is what `pv-wasm` (and therefore the web client
/// and the extension) writes and reads. A JSON *string* here means Foundation's
/// base64 default leaked into the persistence path and every row iOS writes is
/// undecryptable elsewhere.
#[test]
fn nonce_is_a_json_number_array_never_a_base64_string() {
    let uk = FfiUserKey::generate().unwrap();
    let wire = encrypt_item_wire(&uk, PLAINTEXT.to_string(), ITEM_ID.to_string(), 1).unwrap();

    for (label, json) in [("enc_key", &wire.enc_key_json), ("enc_data", &wire.enc_data_json)] {
        let parsed: Value = serde_json::from_str(json).expect("column must be valid JSON");
        let obj = parsed.as_object().unwrap_or_else(|| panic!("{label} must be a JSON object"));

        for member in ["nonce", "ciphertext"] {
            let v = obj
                .get(member)
                .unwrap_or_else(|| panic!("{label} must carry a `{member}` member"));
            assert!(
                v.is_array(),
                "{label}.{member} must be a JSON ARRAY of numbers (serde_json's Vec<u8> \
                 encoding, what every other client reads); it is {v:?}. A JSON string here \
                 is the base64 hazard DR-38-C exists to prevent."
            );
            // Not merely "an array" — an array of integers in byte range.
            // An array of base64 chunks would satisfy `is_array()`.
            for element in v.as_array().unwrap() {
                let n = element
                    .as_u64()
                    .unwrap_or_else(|| panic!("{label}.{member} element must be a number"));
                assert!(n <= 255, "{label}.{member} element {n} is not a byte");
            }
        }
        assert_eq!(obj.len(), 2, "{label} must carry exactly nonce + ciphertext");
    }
}

#[test]
fn wire_round_trips_the_exact_plaintext() {
    let uk = FfiUserKey::generate().unwrap();
    let wire = encrypt_item_wire(&uk, PLAINTEXT.to_string(), ITEM_ID.to_string(), 1).unwrap();
    let back = decrypt_item_wire(
        &uk,
        wire.enc_key_json,
        wire.enc_data_json,
        ITEM_ID.to_string(),
        1,
    )
    .unwrap();
    assert_eq!(back, PLAINTEXT);
}

/// The negative direction as a real test, not a comment: hand
/// `decrypt_item_wire` the exact shape Swift's default `JSONEncoder` would
/// have produced for a `Data` field — a base64 string where the number array
/// belongs — and require a **catchable** `FfiError`, never a panic.
#[test]
fn decrypt_rejects_the_base64_shaped_envelope_swift_would_have_written() {
    let uk = FfiUserKey::generate().unwrap();
    let wire = encrypt_item_wire(&uk, PLAINTEXT.to_string(), ITEM_ID.to_string(), 1).unwrap();

    // Re-encode enc_key the way Foundation would: both byte fields as base64
    // strings, everything else identical.
    let real: Value = serde_json::from_str(&wire.enc_key_json).unwrap();
    let b64 = |v: &Value| {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let bytes: Vec<u8> =
            v.as_array().unwrap().iter().map(|e| e.as_u64().unwrap() as u8).collect();
        Value::String(STANDARD.encode(bytes))
    };
    let foundation_shaped = serde_json::json!({
        "nonce": b64(&real["nonce"]),
        "ciphertext": b64(&real["ciphertext"]),
    })
    .to_string();

    let result = decrypt_item_wire(
        &uk,
        foundation_shaped,
        wire.enc_data_json,
        ITEM_ID.to_string(),
        1,
    );
    assert!(
        matches!(result, Err(FfiError::InvalidInput(_))),
        "a base64-shaped envelope must be rejected with a catchable InvalidInput, got {result:?}"
    );
}

/// The AAD binding is load-bearing, not decorative: the payload AAD carries
/// the revision (`pv_core::items::build_item_aad`), so decrypting at the
/// wrong revision must fail rather than silently return the old plaintext.
#[test]
fn wrong_revision_fails_to_decrypt() {
    let uk = FfiUserKey::generate().unwrap();
    let wire = encrypt_item_wire(&uk, PLAINTEXT.to_string(), ITEM_ID.to_string(), 1).unwrap();
    let result = decrypt_item_wire(
        &uk,
        wire.enc_key_json,
        wire.enc_data_json,
        ITEM_ID.to_string(),
        2,
    );
    assert!(result.is_err(), "revision 2 must not open a revision-1 payload");
}

/// Same, for the item id half of the AAD — this is the one that catches an
/// uppercase Foundation UUID being sent where a lowercase one was encrypted.
#[test]
fn wrong_item_id_fails_to_decrypt() {
    let uk = FfiUserKey::generate().unwrap();
    let wire = encrypt_item_wire(&uk, PLAINTEXT.to_string(), ITEM_ID.to_string(), 1).unwrap();
    let result = decrypt_item_wire(
        &uk,
        wire.enc_key_json,
        wire.enc_data_json,
        ITEM_ID.to_uppercase(),
        1,
    );
    assert!(
        result.is_err(),
        "an uppercased item id must not open the payload — Foundation's UUID.uuidString is \
         uppercase where every other client mints lowercase, so this is a live hazard, not a \
         hypothetical one"
    );
}

/// The folder column's shape: ONE combined JSON value carrying both halves,
/// byte-identical to `pv-wasm`'s `encryptItem` output (which is what the web
/// client writes into `folders.enc_name`).
#[test]
fn combined_json_carries_both_halves_and_round_trips() {
    let uk = FfiUserKey::generate().unwrap();
    let folder_plaintext = r#"{"name":"Praca"}"#;
    let combined =
        encrypt_item_combined_json(&uk, folder_plaintext.to_string(), ITEM_ID.to_string(), 1)
            .unwrap();

    let parsed: Value = serde_json::from_str(&combined).unwrap();
    let obj = parsed.as_object().expect("combined form must be a JSON object");
    assert_eq!(obj.len(), 2, "combined form must be exactly enc_key + enc_data");
    for half in ["enc_key", "enc_data"] {
        let inner = obj.get(half).unwrap_or_else(|| panic!("missing `{half}`"));
        assert!(inner["nonce"].is_array(), "{half}.nonce must be a number array");
        assert!(inner["ciphertext"].is_array(), "{half}.ciphertext must be a number array");
    }

    let back = decrypt_item_combined_json(&uk, combined, ITEM_ID.to_string(), 1).unwrap();
    assert_eq!(back, folder_plaintext);
}

/// The split and combined encodings are the same bytes, differently packaged
/// — which is what makes it safe for the web client to `JSON.stringify` the
/// two halves of one combined value into the two item columns
/// (`splitCombinedEncryptedItem`, `web/src/lib/vault/store.ts:201`) while
/// handing folders the combined string whole. If these two functions ever
/// drifted apart, a folder written by iOS and an item written by iOS would
/// disagree about encoding and only one of them would break.
#[test]
fn split_columns_are_the_combined_form_taken_apart() {
    let uk = FfiUserKey::generate().unwrap();
    let wire = encrypt_item_wire(&uk, PLAINTEXT.to_string(), ITEM_ID.to_string(), 1).unwrap();

    // Recombine the way the web client's decrypt path does, then decrypt
    // through the COMBINED function. Cross-checking the two encoders against
    // each other is the point; a self-comparison would prove nothing.
    let recombined = serde_json::json!({
        "enc_key": serde_json::from_str::<Value>(&wire.enc_key_json).unwrap(),
        "enc_data": serde_json::from_str::<Value>(&wire.enc_data_json).unwrap(),
    })
    .to_string();

    let back = decrypt_item_combined_json(&uk, recombined, ITEM_ID.to_string(), 1).unwrap();
    assert_eq!(back, PLAINTEXT);
}
