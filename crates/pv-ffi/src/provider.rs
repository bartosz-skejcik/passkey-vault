//! `provider_get_assertion`/`provider_make_credential` — the `pv-ffi`
//! exports for iOS's CTAP2-level passkey ASSERTION and REGISTRATION
//! ceremonies (OPT-03, `43-RESEARCH.md`), completing the matched pair
//! `43-RESEARCH.md` Pitfall 7 names. Thin delegation to
//! `pv_provider::get_assertion_ctap2`/`pv_provider::make_credential_ctap2`
//! (`crates/pv-provider/src/ceremony.rs`) — no crypto logic of its own,
//! mirroring every other module in this crate (`sharing.rs`/`wire.rs`'s own
//! headers, P2: `pv-core`/`pv-provider` are never modified to accommodate
//! UniFFI, every impedance mismatch is absorbed HERE).
//!
//! `FfiProviderAssertionResult`/`FfiProviderRegistrationResult` carry ONLY
//! public WebAuthn response fields — credential id, user handle, signature,
//! authenticator data / attestation object — NEVER `key_cbor` or any
//! private-key byte. This is the T-43-02/T-43-04 mitigation (`43-02-PLAN.md`/
//! `43-04-PLAN.md`'s threat registers), mirroring `WasmCreateProviderResult`'s
//! existing "no raw key material past this struct" discipline
//! (`crates/pv-wasm/src/lib.rs:481-482`). Unlike `FfiUserKey`/
//! `FfiWrappingKey`, neither Record carries a handle field at all, so
//! neither needs a `scripts/audit-ffi-opaque-handles.sh` allow-list entry —
//! there is no key material anywhere in either struct for that script's
//! shape-A/B/C/D scans to catch.

use pv_provider::{get_assertion_ctap2, make_credential_ctap2};

use crate::FfiError;

/// Native UniFFI Record (Swift struct with `Data`/`Data?` fields), mirroring
/// `pv_provider::GetAssertionCtap2Result` field-for-field — see that
/// struct's own doc comment (`ceremony.rs`) for why every field here is
/// public WebAuthn response material only.
#[derive(uniffi::Record)]
pub struct FfiProviderAssertionResult {
    pub credential_id: Vec<u8>,
    pub user_handle: Option<Vec<u8>>,
    pub signature: Vec<u8>,
    pub authenticator_data: Vec<u8>,
}

impl From<pv_provider::GetAssertionCtap2Result> for FfiProviderAssertionResult {
    fn from(r: pv_provider::GetAssertionCtap2Result) -> Self {
        FfiProviderAssertionResult {
            credential_id: r.credential_id,
            user_handle: r.user_handle,
            signature: r.signature,
            authenticator_data: r.authenticator_data,
        }
    }
}

/// Thin delegation to `pv_provider::get_assertion_ctap2` — see that
/// function's own doc comment (`crates/pv-provider/src/ceremony.rs`) for
/// the full CTAP2-vs-WebAuthn-client-level rationale (iOS hands a
/// pre-computed `clientDataHash`, never a WebAuthn options JSON, so
/// `get_provider_assertion` cannot serve this path). No panic path of its
/// own — `?`-propagated only, same shape as `wrap_user_key` — see
/// `lib.rs`'s module-header panic-audit table.
#[uniffi::export]
pub fn provider_get_assertion(
    rp_id: String,
    client_data_hash: Vec<u8>,
    allow_credential_id: Option<Vec<u8>>,
    existing_credentials_json: String,
) -> Result<FfiProviderAssertionResult, FfiError> {
    let result = get_assertion_ctap2(
        &rp_id,
        client_data_hash,
        allow_credential_id,
        &existing_credentials_json,
    )?;
    Ok(result.into())
}

/// Native UniFFI Record (Swift struct with `Data`/`String` fields), mirroring
/// `pv_provider::MakeCredentialCtap2Result` field-for-field. `credential_id`/
/// `attestation_object` are PUBLIC WebAuthn response values -- safe to return
/// to the OS. `new_passkey_json` crossing this boundary is the SAME
/// sanctioned secrecy shape `CreateProviderResult.new_passkey_json` already
/// carries on the `pv-wasm` side (secret, local-use only, the caller MUST
/// encrypt it immediately via `encrypt_item`/`encrypt_item_wire` and MUST
/// NEVER surface it to any Swift UI layer) -- stated explicitly here, not
/// merely implied. This struct carries NO handle field (same as
/// `FfiProviderAssertionResult` above) and NEVER carries `key_cbor` (the
/// private key material itself) -- T-43-04's mitigation, this struct's own
/// shape IS the enforcement point.
#[derive(uniffi::Record)]
pub struct FfiProviderRegistrationResult {
    pub credential_id: Vec<u8>,
    pub attestation_object: Vec<u8>,
    pub new_passkey_json: String,
}

impl From<pv_provider::MakeCredentialCtap2Result> for FfiProviderRegistrationResult {
    fn from(r: pv_provider::MakeCredentialCtap2Result) -> Self {
        FfiProviderRegistrationResult {
            credential_id: r.credential_id,
            attestation_object: r.attestation_object,
            new_passkey_json: r.new_passkey_json,
        }
    }
}

/// Thin delegation to `pv_provider::make_credential_ctap2` -- see that
/// function's own doc comment (`crates/pv-provider/src/ceremony.rs`) for the
/// full CTAP2-vs-WebAuthn-client-level rationale, the `existing_credentials_json`
/// deviation (needed for `excluded_credential_ids` to be honored, not a
/// no-op), and the upstream exclude-list enforcement gap this crate now
/// closes itself. No panic path of its own -- `?`-propagated only, same
/// shape as `provider_get_assertion` above -- see `lib.rs`'s module-header
/// panic-audit table.
#[uniffi::export]
pub fn provider_make_credential(
    rp_id: String,
    rp_name: Option<String>,
    user_id: Vec<u8>,
    user_name: String,
    user_display_name: Option<String>,
    client_data_hash: Vec<u8>,
    supported_algorithms: Vec<i64>,
    excluded_credential_ids: Vec<Vec<u8>>,
    existing_credentials_json: String,
) -> Result<FfiProviderRegistrationResult, FfiError> {
    let result = make_credential_ctap2(
        &rp_id,
        rp_name.as_deref(),
        user_id,
        &user_name,
        user_display_name.as_deref(),
        client_data_hash,
        &supported_algorithms,
        &excluded_credential_ids,
        &existing_credentials_json,
    )?;
    Ok(result.into())
}
