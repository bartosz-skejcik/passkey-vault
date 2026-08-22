//! EXT-10 fast-regression backstop for `get_assertion_ctap2` (43-02-PLAN.md
//! Task 2). See `crates/pv-provider/src/ceremony.rs`'s own EXT-10
//! decision-record comment above `get_provider_assertion` for the full
//! rationale this file extends STRUCTURALLY to the new CTAP2-level entry
//! point. Mirrors `tests/response_shape.rs`'s own
//! `sign_count_is_always_zero_for_a_provider_ceremony_assertion` -- same
//! byte-offset decoding discipline, applied to `get_assertion_ctap2`'s raw
//! `authenticator_data: Vec<u8>` output directly (no base64url unwrap
//! needed here -- unlike the WebAuthn-client-level path's JSON response,
//! `GetAssertionCtap2Result` already exposes plain bytes, never a JSON
//! envelope).
//!
//! This is the permanent, FAST, in-process regression tier only -- the
//! genuine live-wire measurement against a real Safari/GitHub-app ceremony
//! is Plan 43-03's job (43-RESEARCH.md Question 7, SC2/SC3), same
//! distinction `ceremony.rs`'s own EXT-10 comment already draws for the
//! WebAuthn-client-level path.
//!
//! Consumed and extended further by Plans 43-04 (registration wire-shape
//! identity) and 43-09 (byte-identity round trip) -- this file's own
//! `pub(crate)` fixture-seeding helper exists so those later plans do not
//! have to re-derive it (43-02-PLAN.md Task 2 action).

use pv_provider::{create_provider_credential, get_assertion_ctap2, make_credential_ctap2, passkeys_from_json};

/// Mirrors `crates/pv-provider/src/lib.rs`'s own `fixture_create_request`
/// (private to that file's `#[cfg(test)] mod tests`, not importable from an
/// integration test) -- duplicated here per this crate's own
/// fixture-owning precedent (`tests/response_shape.rs`,
/// `tests/real_rp_verification.rs`'s own headers), rather than depending on
/// that file's private functions.
pub(crate) fn fixture_create_request(rp_id: &str) -> String {
    let public_key = serde_json::json!({
        "rp": { "id": rp_id, "name": "Example" },
        "user": {
            "id": passkey_types::encoding::base64url(&[1u8; 16]),
            "name": "user@example.com",
            "displayName": "User",
        },
        "challenge": passkey_types::encoding::base64url(&[2u8; 16]),
        "pubKeyCredParams": [{ "type": "public-key", "alg": -7 }],
    });
    serde_json::to_string(&serde_json::json!({ "publicKey": public_key })).unwrap()
}

/// Seeds one real passkey for `rp_id` (via a genuine
/// `create_provider_credential` ceremony, never a hand-rolled `Passkey`)
/// and returns the `existing_credentials_json` array `get_assertion_ctap2`
/// expects. `pub(crate)` visibility (rather than private) so later plans'
/// own test files in this same `tests/` integration-test crate boundary
/// can reuse this fixture-seeding helper (43-04/43-09) rather than
/// re-deriving it.
pub(crate) fn seed_one_passkey(rp_id: &str) -> String {
    let create_result =
        create_provider_credential(&fixture_create_request(rp_id), &format!("https://{rp_id}"))
            .expect("create_provider_credential should succeed");
    format!("[{}]", create_result.new_passkey_json)
}

/// WebAuthn §6.1 `authenticatorData` layout: 32-byte rpIdHash, 1-byte
/// flags, then a 4-byte big-endian signCount at offset 33..37 -- the SAME
/// offset `response_shape.rs`'s own sibling assertion test already reads
/// for the WebAuthn-client-level path.
fn sign_count_from_authenticator_data(authenticator_data: &[u8]) -> u32 {
    assert!(
        authenticator_data.len() >= 37,
        "authenticatorData must be at least 37 bytes (32 rpIdHash + 1 flags + \
         4 signCount), got {} bytes -- cannot locate the signCount field",
        authenticator_data.len()
    );
    u32::from_be_bytes([
        authenticator_data[33],
        authenticator_data[34],
        authenticator_data[35],
        authenticator_data[36],
    ])
}

/// `get_assertion_ctap2` on a seeded credential NEVER returns a
/// `GetAssertionCtap2Result` whose `authenticator_data`'s fixed 4-byte
/// counter field is anything other than zero -- EXT-10 extended
/// structurally to the new entry point, asserted on RAW WIRE BYTES, not
/// the Rust-side `Option<u32>` alone (this crate's `GetAssertionCtap2Result`
/// does not even expose a `counter` field -- the assertion below is the
/// only place this property is checked for the CTAP2 path).
#[test]
fn sign_count_is_always_zero_for_ctap2_assertion() {
    let rp_id = "example.com";
    let existing_credentials_json = seed_one_passkey(rp_id);

    let result = get_assertion_ctap2(rp_id, vec![0u8; 32], None, &existing_credentials_json)
        .expect("get_assertion_ctap2 should succeed against a seeded credential");

    assert_eq!(
        sign_count_from_authenticator_data(&result.authenticator_data),
        0,
        "EXT-10 extended to get_assertion_ctap2: the raw wire-level signCount \
         (authenticator_data bytes 33..37, decoded directly -- this function \
         never returns a base64url-wrapped string, unlike the WebAuthn-client- \
         level path) must be 0. pv-provider's Authenticator is never \
         configured with make_credentials_with_signature_counter(true) -- see \
         ceremony.rs's own decision-record comment above get_provider_assertion \
         -- matching WebAuthn L3 6.1.1's permitted 'authenticator does not \
         implement a counter' case."
    );
}

/// `get_assertion_ctap2` called twice in a row against the SAME seeded
/// store (simulating two separate assertions against the same credential)
/// produces the SAME zero counter both times -- no accidental state
/// mutation leaking between calls (each call reconstructs its own
/// `PvCredentialStore::from_passkeys_json`, so this also proves that
/// reconstruction path itself never smuggles a counter through).
#[test]
fn sign_count_stays_zero_across_two_consecutive_calls() {
    let rp_id = "example.com";
    let existing_credentials_json = seed_one_passkey(rp_id);

    let first = get_assertion_ctap2(rp_id, vec![1u8; 32], None, &existing_credentials_json)
        .expect("first get_assertion_ctap2 call should succeed");
    let second = get_assertion_ctap2(rp_id, vec![2u8; 32], None, &existing_credentials_json)
        .expect("second get_assertion_ctap2 call should succeed");

    assert_eq!(
        sign_count_from_authenticator_data(&first.authenticator_data),
        0,
        "first assertion's raw wire-level signCount must be 0"
    );
    assert_eq!(
        sign_count_from_authenticator_data(&second.authenticator_data),
        0,
        "second assertion against the SAME seeded store must ALSO be 0 -- \
         proving no accidental per-call counter mutation leaks between two \
         independent get_assertion_ctap2 invocations"
    );
}

/// 43-09-PLAN.md Task 1 (ROADMAP SC5, the Rust-layer half of the "structural,
/// not invented" claim): `create_provider_credential` (WebAuthn-client-level,
/// the extension's own path) and `make_credential_ctap2` (CTAP2-level, iOS's
/// own path) are TWO DIFFERENT entry points into the SAME `PvCredentialStore`/
/// `passkey_to_json`/`passkeys_from_json` wire mirror (`credential_store.rs`) --
/// called with equivalent logical inputs (same `rp_id`, same user id/name/
/// display name), they must produce `new_passkey_json` that decodes, via the
/// ONE shared `passkeys_from_json` function, to `Passkey` values whose
/// `rp_id`/`user_handle`/`username` fields are byte-for-byte IDENTICAL. Only
/// `key`/`credential_id` are excluded -- each call mints its own fresh
/// keypair, which must legitimately differ (two independent ceremonies, not
/// one credential synced twice).
#[test]
fn ctap2_and_client_level_registration_produce_the_same_wire_shape() {
    let rp_id = "example.com";
    let user_id_bytes = vec![1u8; 16];
    let user_name = "user@example.com";
    let user_display_name = "User";

    // WebAuthn-client-level path: create_provider_credential, driven by this
    // file's own fixture_create_request (SAME rp_id/user id/name/display
    // name as the CTAP2 call below).
    let client_create_result =
        create_provider_credential(&fixture_create_request(rp_id), &format!("https://{rp_id}"))
            .expect("create_provider_credential should succeed");
    let client_passkeys = passkeys_from_json(&format!("[{}]", client_create_result.new_passkey_json))
        .expect("client-level new_passkey_json must decode via passkeys_from_json");
    assert_eq!(client_passkeys.len(), 1, "exactly one passkey must decode from the client-level path");
    let client_passkey = &client_passkeys[0];

    // CTAP2-level path: make_credential_ctap2, driven by the SAME logical
    // inputs -- an arbitrary but valid client_data_hash (iOS pre-hashes
    // clientDataJSON before crossing the FFI boundary; make_credential_ctap2
    // never inspects its bytes beyond passing them through to the
    // authenticator), ES256 in supported_algorithms (T-43-06), no exclude
    // list, empty existing_credentials_json (a fresh registration, mirroring
    // create_provider_credential's own empty-store start).
    let ctap2_result = make_credential_ctap2(
        rp_id,
        Some("Example"),
        user_id_bytes.clone(),
        user_name,
        Some(user_display_name),
        vec![9u8; 32],
        &[-7],
        &[],
        "[]",
    )
    .expect("make_credential_ctap2 should succeed");
    let ctap2_passkeys = passkeys_from_json(&format!("[{}]", ctap2_result.new_passkey_json))
        .expect("CTAP2-level new_passkey_json must decode via passkeys_from_json");
    assert_eq!(ctap2_passkeys.len(), 1, "exactly one passkey must decode from the CTAP2-level path");
    let ctap2_passkey = &ctap2_passkeys[0];

    // Field-for-field equality on every field EXCEPT key/credential_id --
    // this IS the "byte-for-byte interop is a consequence of using the same
    // code" claim, proven directly at the Rust layer.
    assert_eq!(
        client_passkey.rp_id, ctap2_passkey.rp_id,
        "rp_id must be identical across both entry points"
    );
    assert_eq!(
        client_passkey.user_handle, ctap2_passkey.user_handle,
        "user_handle must be identical across both entry points"
    );
    assert_eq!(
        client_passkey.username, ctap2_passkey.username,
        "username must be identical across both entry points"
    );

    // Legitimate difference, asserted explicitly (never silently ignored):
    // each ceremony mints its own fresh ES256 keypair, so credential_id
    // (and the key itself) MUST differ between two independent
    // registrations -- this is not a byte-identity failure, it is the
    // expected shape of "two ceremonies, not one credential synced twice".
    assert_ne!(
        Vec::from(client_passkey.credential_id.clone()),
        Vec::from(ctap2_passkey.credential_id.clone()),
        "credential_id legitimately differs -- each entry point mints its own fresh keypair"
    );
}
