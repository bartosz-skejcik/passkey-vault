//! `provider_get_assertion` — the `pv-ffi` export for iOS's CTAP2-level
//! passkey ASSERTION ceremony (OPT-03, `43-RESEARCH.md`). Thin delegation
//! to `pv_provider::get_assertion_ctap2`
//! (`crates/pv-provider/src/ceremony.rs`) — no crypto logic of its own,
//! mirroring every other module in this crate (`sharing.rs`/`wire.rs`'s own
//! headers, P2: `pv-core`/`pv-provider` are never modified to accommodate
//! UniFFI, every impedance mismatch is absorbed HERE).
//!
//! `FfiProviderAssertionResult` carries ONLY public WebAuthn response
//! fields — credential id, user handle, signature, authenticator data —
//! NEVER `key_cbor` or any private-key byte. This is the T-43-02
//! mitigation (`43-02-PLAN.md`'s threat register), mirroring
//! `WasmCreateProviderResult`'s existing "no raw key material past this
//! struct" discipline (`crates/pv-wasm/src/lib.rs:481-482`). Unlike
//! `FfiUserKey`/`FfiWrappingKey`, this Record carries no handle field at
//! all, so it needs no `scripts/audit-ffi-opaque-handles.sh` allow-list
//! entry — there is no key material anywhere in this struct for that
//! script's shape-A/B/C/D scans to catch.

use pv_provider::get_assertion_ctap2;

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
