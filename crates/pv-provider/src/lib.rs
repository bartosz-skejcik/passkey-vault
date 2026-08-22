//! pv-provider — `passkey-rs` (1Password) soft ES256 WebAuthn authenticator
//! and vault-backed `CredentialStore` adapter for the extension's passkey
//! provider ceremony (Phase 12, PROV-01/PROV-02/PROV-04).
//!
//! This crate is the ONLY place `passkey-authenticator`/`passkey-client`/
//! `passkey-types` are used — never `pv-core` directly, and never the
//! extension's MAIN-world page-bridge (D-02/D-05). That invariant is
//! UNCHANGED by this crate's Phase 43 addition (see
//! `43-RESEARCH.md`'s "The exception this phase must ask for").
//!
//! This crate has TWO callers, not one (the "only ever called from
//! `crates/pv-wasm`" sentence below was stale as of Phase 43 -- only the
//! caller-COUNT was wrong, the passkey-crate-usage invariant above still
//! holds exactly as written):
//!
//! - `crates/pv-wasm` (Task 2), which wraps [`create_provider_credential`]/
//!   [`get_provider_assertion`] — the browser extension's WebAuthn-CLIENT-
//!   level ceremonies — with `pv-core`'s existing `encrypt_item`/
//!   `decrypt_item` so the plaintext private key material this crate
//!   briefly produces (`new_passkey_json`/`updated_passkey_json`) never
//!   crosses the WASM->JS boundary as a return value.
//! - `crates/pv-ffi` (Phase 43, OPT-03), which wraps [`get_assertion_ctap2`]
//!   — iOS's CTAP2-LEVEL assertion ceremony — and (43-04) [`make_credential_ctap2`]
//!   — iOS's CTAP2-LEVEL registration ceremony, completing the matched pair
//!   43-RESEARCH.md Pitfall 7 names — the same way for the Swift boundary.
//!   See those functions' own doc comments (`crates/pv-provider/src/ceremony.rs`)
//!   for why the WebAuthn-client-level functions above cannot serve iOS's
//!   provider path at all (iOS hands a pre-computed `clientDataHash`, never a
//!   WebAuthn options JSON).
//!
//! D-08 note: this crate introduces ZERO new HKDF domain-separation
//! contexts. The previously planned ephemeral-wrap module
//! (`crates/pv-core/src/provider.rs`, `INFO_PROVIDER_CRED_KEY`) was
//! DE-SCOPED per 12-CONTEXT.md's ADDENDUM D-19 — re-encrypting an
//! already-encrypted `EncryptedItem` with a seed stored next to the
//! ciphertext adds no confidentiality. D-08 is satisfied vacuously.

mod ceremony;
mod credential_store;
mod error;

pub use ceremony::{
    create_provider_credential, get_assertion_ctap2, get_provider_assertion,
    make_credential_ctap2, CreateProviderResult, GetAssertionCtap2Result,
    GetProviderAssertionResult, MakeCredentialCtap2Result,
};
// 43-09-PLAN.md Task 1 (deviation, Rule 3 -- blocking): `passkeys_from_json`
// was `pub` inside the private `credential_store` module but never
// re-exported here, so no external `tests/` integration-test crate could
// call it (only in-crate `#[cfg(test)]` modules could, via `use
// crate::credential_store::passkeys_from_json`). This plan's own byte-
// identity round-trip test decodes BOTH `create_provider_credential`'s and
// `make_credential_ctap2`'s `new_passkey_json` output through this SAME
// function (never a second, hand-rolled JSON parse) to prove they produce
// structurally identical `Passkey` values -- re-exporting it is the minimal
// fix, not a functional change to any ceremony entry point.
pub use credential_store::{passkeys_from_json, PvCredentialStore, PvUserValidation};
pub use error::PvProviderError;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

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

    fn fixture_get_request(rp_id: &str, allow_credential_id_b64: Option<&str>) -> String {
        let mut public_key = json!({
            "challenge": base64url(&[3u8; 16]),
            "rpId": rp_id,
        });
        if let Some(id) = allow_credential_id_b64 {
            public_key["allowCredentials"] =
                json!([{ "type": "public-key", "id": id }]);
        }
        serde_json::to_string(&json!({ "publicKey": public_key })).unwrap()
    }

    fn base64url(bytes: &[u8]) -> String {
        passkey_types::encoding::base64url(bytes)
    }

    #[test]
    fn create_then_get_roundtrip() {
        let request_json = fixture_create_request("example.com", false);
        let create_result = create_provider_credential(&request_json, "https://example.com")
            .expect("create_provider_credential should succeed");

        let created: serde_json::Value =
            serde_json::from_str(&create_result.credential_response_json).unwrap();
        assert_eq!(created["type"], "public-key");
        let created_id = created["id"].as_str().expect("id must be a string").to_string();
        assert!(!created_id.is_empty());

        let new_passkey_value: serde_json::Value =
            serde_json::from_str(&create_result.new_passkey_json)
                .expect("new_passkey_json must parse as JSON");
        assert!(new_passkey_value.is_object());
        assert!(!new_passkey_value.as_object().unwrap().is_empty());

        // Feed new_passkey_json (wrapped in a single-element array) into
        // get_provider_assertion with a fresh get-request.
        let existing_credentials_json = format!("[{}]", create_result.new_passkey_json);
        let get_request_json = fixture_get_request("example.com", None);

        let get_result = get_provider_assertion(
            &get_request_json,
            "https://example.com",
            &existing_credentials_json,
        )
        .expect("get_provider_assertion should succeed");

        let asserted: serde_json::Value =
            serde_json::from_str(&get_result.credential_response_json).unwrap();
        assert_eq!(asserted["id"], created_id);
    }

    #[test]
    fn origin_mismatch_rejected() {
        let request_json = fixture_create_request("example.com", false);
        let create_result = create_provider_credential(&request_json, "https://example.com")
            .expect("create_provider_credential should succeed");

        let existing_credentials_json = format!("[{}]", create_result.new_passkey_json);
        let get_request_json = fixture_get_request("example.com", None);

        // passkey-client's own RpIdVerifier/origin validation (D-06) must
        // reject this — proving the library does the validation, not a
        // manual check in this crate.
        let result = get_provider_assertion(
            &get_request_json,
            "https://evil.example",
            &existing_credentials_json,
        );
        assert!(result.is_err(), "origin mismatch must be rejected");
    }

    #[test]
    fn prf_capable_credential() {
        let request_json = fixture_create_request("example.com", true);
        let create_result = create_provider_credential(&request_json, "https://example.com")
            .expect("create_provider_credential should succeed");

        let created: serde_json::Value =
            serde_json::from_str(&create_result.credential_response_json).unwrap();
        let prf_enabled = created["clientExtensionResults"]["prf"]["enabled"]
            .as_bool()
            .expect("clientExtensionResults.prf.enabled must be present and a bool");
        assert!(
            prf_enabled,
            "PRF must be reported enabled when the create request includes the prf extension \
             (D-06/D-07/D-16/PROV-04) — passkey-rs's own HmacSecretConfig support, not browser \
             detection"
        );
    }
}
