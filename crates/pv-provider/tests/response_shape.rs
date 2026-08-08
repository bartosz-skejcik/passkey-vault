//! QA-04: a permanent Rust unit gate that enumerates every binary WebAuthn
//! response field `pv-provider` emits (both the create AND get ceremonies)
//! and asserts each one is a base64url STRING on the wire, never a bare JSON
//! number array (e.g. `[1,2,3,...]`) -- the exact silent-regression class
//! documented in `.planning/debug/resolved/firefox-provider-corruption.md`
//! that shipped undetected through every prior `.ok`/`id`-only test because
//! nothing ever inspected the SHAPE of the other binary fields.
//!
//! This is complementary to, not a duplicate of, two other pieces of QA-03/
//! QA-04 coverage already in this crate/repo:
//!
//! - `tests/real_rp_verification.rs` (QA-03): an independent cross-vendor
//!   `webauthn-rs` Relying Party performs genuine signature/attestation
//!   verification over a real ceremony. It proves the bytes round-trip and
//!   verify correctly end-to-end, but on a regression it fails with a
//!   generic deserialize/verification error somewhere downstream -- it does
//!   not name which field broke or why.
//! - `extension/e2e-firefox/probe-request-xray.cjs`: proves live-Firefox
//!   cross-realm delivery of the REQUEST direction against a real browser
//!   session, not the wire SHAPE of pv-provider's own RESPONSE JSON in
//!   isolation.
//!
//! This file instead parses `credential_response_json` as a bare
//! `serde_json::Value` and asserts, field-by-field, that every `Bytes`
//! field is `.is_string()` AND decodes as valid base64url -- so a
//! regression of the `serialize_bytes_as_base64_string` feature (or its
//! accidental removal from `Cargo.toml`) fails LOUD and SPECIFIC, naming
//! the exact JSON field path, instead of a generic downstream error.

use pv_provider::{create_provider_credential, get_provider_assertion};
use serde_json::{json, Value};

/// Mirrors `crates/pv-provider/src/lib.rs`'s own `fixture_create_request`
/// (private to that file's `#[cfg(test)] mod tests`, not importable from an
/// integration test) -- duplicated here per this file's own fixture-owning
/// precedent, matching `tests/real_rp_verification.rs`'s independent-fixture
/// approach.
fn fixture_create_request(rp_id: &str, with_prf: bool) -> String {
    let mut public_key = json!({
        "rp": { "id": rp_id, "name": "Example" },
        "user": {
            "id": base64url(&[1u8; 16]),
            "name": "user@example.com",
            "displayName": "User",
        },
        "challenge": base64url(&[2u8; 16]),
        "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
    });
    if with_prf {
        public_key["extensions"] = json!({ "prf": {} });
    }
    serde_json::to_string(&json!({ "publicKey": public_key })).unwrap()
}

/// Mirrors `crates/pv-provider/src/lib.rs`'s own `fixture_get_request`
/// (same non-importability note as above).
fn fixture_get_request(rp_id: &str) -> String {
    let public_key = json!({
        "challenge": base64url(&[3u8; 16]),
        "rpId": rp_id,
    });
    serde_json::to_string(&json!({ "publicKey": public_key })).unwrap()
}

fn base64url(bytes: &[u8]) -> String {
    passkey_types::encoding::base64url(bytes)
}

/// Asserts `value` at `field_path` is a base64url-encoded JSON string, not a
/// bare number array -- the exact D-21/QA-04 regression shape. Panics with a
/// field-naming, regression-class-naming message on failure so a future
/// break is immediately diagnosable without re-deriving field names from
/// `ceremony.rs`.
fn assert_base64url_string_field(value: &Value, field_path: &str) {
    let as_str = value.as_str().unwrap_or_else(|| {
        panic!(
            "QA-04 regression: `{field_path}` must serialize as a base64url \
             STRING, not a bare JSON number array (the exact \
             `serialize_bytes_as_base64_string` D-21 regression class from \
             .planning/debug/resolved/firefox-provider-corruption.md) -- \
             found: {value}"
        )
    });
    assert!(
        passkey_types::encoding::try_from_base64url(as_str).is_some(),
        "QA-04 regression: `{field_path}` is a JSON string (\"{as_str}\") but \
         does not decode as valid base64url -- the field must be BOTH a \
         string AND valid base64url, not just any string"
    );
}

/// Looks up `field_path` (dot-separated) in `value`, applying
/// `assert_base64url_string_field` only if the field is present -- for
/// fields that are legitimately `Option<Bytes>` on the wire
/// (`skip_serializing_if`), matching this plan's explicit
/// assert-when-present, never-required contract.
fn assert_optional_base64url_string_field(value: &Value, field_path: &str) {
    let mut cursor = value;
    for segment in field_path.split('.') {
        match cursor.get(segment) {
            Some(next) => cursor = next,
            None => return, // absent -- legitimately optional, not asserted.
        }
    }
    if cursor.is_null() {
        return;
    }
    assert_base64url_string_field(cursor, field_path);
}

fn get_required<'a>(value: &'a Value, field_path: &str) -> &'a Value {
    let mut cursor = value;
    for segment in field_path.split('.') {
        cursor = cursor.get(segment).unwrap_or_else(|| {
            panic!(
                "QA-04 regression: required field `{field_path}` is missing \
                 entirely from the response JSON (segment `{segment}` not \
                 found) -- expected an always-present Bytes field per \
                 AuthenticatorAttestationResponse/AuthenticatorAssertionResponse"
            )
        });
    }
    cursor
}

#[test]
fn create_response_binary_fields_are_base64url_strings() {
    let request_json = fixture_create_request("example.com", true);
    let create_result = create_provider_credential(&request_json, "https://example.com")
        .expect("create_provider_credential should succeed");

    let response: Value = serde_json::from_str(&create_result.credential_response_json)
        .expect("credential_response_json must parse as JSON");

    // Always-present Bytes fields on the outer PublicKeyCredential /
    // AuthenticatorAttestationResponse.
    for field_path in ["rawId", "response.clientDataJSON", "response.attestationObject", "response.authenticatorData"]
    {
        assert_base64url_string_field(get_required(&response, field_path), field_path);
    }

    // Optional Bytes fields -- asserted only when present, never required.
    // `response.publicKey` (Option<Bytes>, skip_serializing_if) may be
    // absent depending on attestation format/COSE key extraction support.
    assert_optional_base64url_string_field(&response, "response.publicKey");
    // PRF results depend on authenticator support at creation time and may
    // legitimately be absent even though this fixture requested the prf
    // extension -- explicit assumption: presence is NOT required here,
    // only shape-when-present.
    assert_optional_base64url_string_field(&response, "clientExtensionResults.prf.results.first");
    assert_optional_base64url_string_field(&response, "clientExtensionResults.prf.results.second");
}

#[test]
fn get_response_binary_fields_are_base64url_strings() {
    let create_request_json = fixture_create_request("example.com", false);
    let create_result = create_provider_credential(&create_request_json, "https://example.com")
        .expect("create_provider_credential should succeed (setup for get ceremony)");

    let existing_credentials_json = format!("[{}]", create_result.new_passkey_json);
    let get_request_json = fixture_get_request("example.com");

    let get_result = get_provider_assertion(
        &get_request_json,
        "https://example.com",
        &existing_credentials_json,
    )
    .expect("get_provider_assertion should succeed");

    let response: Value = serde_json::from_str(&get_result.credential_response_json)
        .expect("credential_response_json must parse as JSON");

    // Always-present Bytes fields on the outer PublicKeyCredential /
    // AuthenticatorAssertionResponse.
    for field_path in ["rawId", "response.clientDataJSON", "response.authenticatorData", "response.signature"] {
        assert_base64url_string_field(get_required(&response, field_path), field_path);
    }

    // `response.userHandle` is Option<Bytes> -- assert shape only if present.
    assert_optional_base64url_string_field(&response, "response.userHandle");
}

/// EXT-10 Task 1: a full create-then-get ceremony's `signCount` measured off
/// the RAW WIRE BYTES of `authenticatorData` -- not `updated_passkey_json`'s
/// `Option<u32>` (a weaker, code-read-only claim already known from
/// `ceremony.rs`'s doc comments). Per the WebAuthn spec (§6.1
/// `authenticatorData`), the structure is:
///   - bytes 0..32:  rpIdHash (32 bytes)
///   - byte  32:     flags (1 byte)
///   - bytes 33..37: signCount, 4-byte big-endian u32
///   - bytes 37..:   attestedCredentialData / extensions (variable, get
///     ceremonies never carry this)
/// This test decodes `response.authenticatorData` from the base64url string
/// on the wire (never through any typed Rust wrapper that might silently
/// normalize an absent counter to a default) and reads bytes 33..37 directly.
#[test]
fn sign_count_is_always_zero_for_a_provider_ceremony_assertion() {
    let create_request_json = fixture_create_request("example.com", false);
    let create_result = create_provider_credential(&create_request_json, "https://example.com")
        .expect("create_provider_credential should succeed (setup for get ceremony)");

    let existing_credentials_json = format!("[{}]", create_result.new_passkey_json);
    let get_request_json = fixture_get_request("example.com");

    let get_result = get_provider_assertion(
        &get_request_json,
        "https://example.com",
        &existing_credentials_json,
    )
    .expect("get_provider_assertion should succeed");

    let response: Value = serde_json::from_str(&get_result.credential_response_json)
        .expect("credential_response_json must parse as JSON");

    let auth_data_b64 = get_required(&response, "response.authenticatorData")
        .as_str()
        .expect("response.authenticatorData must be a base64url string (QA-04 wire contract)");
    let auth_data_bytes = passkey_types::encoding::try_from_base64url(auth_data_b64)
        .expect("response.authenticatorData must decode as valid base64url");

    assert!(
        auth_data_bytes.len() >= 37,
        "authenticatorData must be at least 37 bytes (32 rpIdHash + 1 flags + 4 signCount), \
         got {} bytes -- cannot locate the signCount field",
        auth_data_bytes.len()
    );

    // WebAuthn §6.1: signCount is a 4-byte big-endian u32 at offset 33..37,
    // immediately after the 32-byte rpIdHash and the 1-byte flags.
    let sign_count = u32::from_be_bytes([
        auth_data_bytes[33],
        auth_data_bytes[34],
        auth_data_bytes[35],
        auth_data_bytes[36],
    ]);

    assert_eq!(
        sign_count, 0,
        "EXT-10: a provider-ceremony assertion's raw wire-level signCount \
         (authenticatorData bytes 33..37, decoded from the actual base64url \
         response field -- not inferred from `updated_passkey_json` or any \
         other Rust-side Option<u32>) must be 0. `pv-provider`'s \
         `Authenticator` is never configured with \
         `make_credentials_with_signature_counter(true)` (see ceremony.rs), \
         matching WebAuthn L3 §6.1.1's permitted \"authenticator does not \
         implement a counter\" case and the observed behavior of iCloud \
         Keychain / Google Password Manager for synced passkeys. This is the \
         permanent fast in-process regression tier only -- the genuine live \
         wire measurement against a real browser is 27-06's job."
    );
    assert!(
        get_result.updated_passkey_json.is_none(),
        "companion check: no authenticator-side mutation should have \
         occurred either (weaker claim, already known from the code read, \
         but should stay consistent with the wire-level measurement above)"
    );
}
