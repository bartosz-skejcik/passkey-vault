//! `PvCredentialStore` — an in-memory `passkey_authenticator::CredentialStore`
//! adapter constructed from a caller-supplied JSON array of already-decrypted
//! `Passkey` blobs. Performs NO decryption, NO network I/O, NO calls into
//! `pv-core` — the caller (this crate's own `ceremony.rs`, itself only ever
//! invoked from `pv-wasm`) is responsible for decrypting the vault item
//! before construction and re-encrypting whatever this store ends up
//! holding after the ceremony completes (Architecture Pattern 1: "reuse
//! existing encryptItem/decryptItem, don't build a second store").
//!
//! ## Why a hand-rolled JSON mirror of `Passkey` (`SerializablePasskey`)
//!
//! `passkey_types::Passkey` does NOT derive `Serialize`/`Deserialize` — its
//! `key: CoseKey` field (from the `coset` crate) has no serde support at
//! all, only `coset::CborSerializable` (CBOR, via `ciborium`). 12-RESEARCH.md
//! Assumption A1 flagged the exact call-site shapes as unverified from
//! summaries alone; this is exactly that gap. We mirror `Passkey`'s public
//! fields into a serde-friendly DTO, CBOR-encoding just the `CoseKey` field
//! (`key_cbor: Vec<u8>`) via `coset::CborSerializable::to_vec`/`from_slice`,
//! and JSON-encode everything else directly. This keeps `new_passkey_json`/
//! `updated_passkey_json` (Task 1's contract) a valid opaque JSON string
//! without inventing a second on-disk format — the CBOR bytes are just one
//! field's worth of ciphertext-adjacent payload, immediately re-encrypted by
//! `pv-wasm`'s `core_encrypt_item` (Task 2), never persisted as-is.

use async_trait::async_trait;
use coset::{CborSerializable, CoseKey};
use passkey_authenticator::{
    CredentialStore, DiscoverabilitySupport, StoreInfo, UiHint, UserCheck, UserValidationMethod,
};
use passkey_types::{
    ctap2::{
        get_assertion::Options,
        make_credential::{PublicKeyCredentialRpEntity, PublicKeyCredentialUserEntity},
        Ctap2Error, StatusCode,
    },
    webauthn::PublicKeyCredentialDescriptor,
    CredentialExtensions, Passkey, StoredHmacSecret,
};
use serde::{Deserialize, Serialize};

use crate::error::PvProviderError;

#[derive(Serialize, Deserialize)]
struct SerializableStoredHmacSecret {
    cred_with_uv: Vec<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    cred_without_uv: Option<Vec<u8>>,
}

#[derive(Serialize, Deserialize, Default)]
struct SerializableCredentialExtensions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hmac_secret: Option<SerializableStoredHmacSecret>,
}

/// Serde-friendly mirror of `passkey_types::Passkey` — see this module's
/// header comment for why this exists instead of deriving `Serialize`/
/// `Deserialize` directly on `Passkey` (it can't; upstream doesn't provide
/// it). Field names deliberately match `Passkey`'s own field names 1:1 so
/// the mapping stays obviously correct on inspection.
#[derive(Serialize, Deserialize)]
struct SerializablePasskey {
    /// CBOR-encoded `CoseKey` (contains the private key material) — see
    /// module header comment.
    key_cbor: Vec<u8>,
    credential_id: Vec<u8>,
    rp_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    user_handle: Option<Vec<u8>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    user_display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    counter: Option<u32>,
    #[serde(default)]
    extensions: SerializableCredentialExtensions,
}

fn passkey_to_serializable(pk: &Passkey) -> Result<SerializablePasskey, PvProviderError> {
    let key_cbor = pk
        .key
        .clone()
        .to_vec()
        .map_err(|e| PvProviderError::Serde(format!("CoseKey CBOR encode failed: {e}")))?;
    Ok(SerializablePasskey {
        key_cbor,
        credential_id: Vec::from(pk.credential_id.clone()),
        rp_id: pk.rp_id.clone(),
        user_handle: pk.user_handle.as_ref().map(|b| Vec::from(b.clone())),
        username: pk.username.clone(),
        user_display_name: pk.user_display_name.clone(),
        counter: pk.counter,
        extensions: SerializableCredentialExtensions {
            hmac_secret: pk.extensions.hmac_secret.as_ref().map(|h| {
                SerializableStoredHmacSecret {
                    cred_with_uv: h.cred_with_uv.clone(),
                    cred_without_uv: h.cred_without_uv.clone(),
                }
            }),
        },
    })
}

fn serializable_to_passkey(s: SerializablePasskey) -> Result<Passkey, PvProviderError> {
    let key = CoseKey::from_slice(&s.key_cbor)
        .map_err(|e| PvProviderError::Serde(format!("CoseKey CBOR decode failed: {e}")))?;
    Ok(Passkey {
        key,
        credential_id: s.credential_id.into(),
        rp_id: s.rp_id,
        user_handle: s.user_handle.map(Into::into),
        username: s.username,
        user_display_name: s.user_display_name,
        counter: s.counter,
        extensions: CredentialExtensions {
            hmac_secret: s.extensions.hmac_secret.map(|h| StoredHmacSecret {
                cred_with_uv: h.cred_with_uv,
                cred_without_uv: h.cred_without_uv,
            }),
        },
    })
}

/// Serializes a single `Passkey` (INCLUDING its private key) to this crate's
/// JSON mirror format. Used for `new_passkey_json`/`updated_passkey_json` —
/// callers (`pv-wasm`) MUST treat the result as secret and feed it straight
/// into `core_encrypt_item`, never return it to JS as-is.
pub fn passkey_to_json(pk: &Passkey) -> Result<String, PvProviderError> {
    let serializable = passkey_to_serializable(pk)?;
    serde_json::to_string(&serializable)
        .map_err(|e| PvProviderError::Serde(format!("Passkey JSON encode failed: {e}")))
}

/// Parses a JSON array of this crate's `Passkey` mirror format (as produced
/// by `passkey_to_json`, wrapped in `[...]`) into owned `Passkey` values.
pub fn passkeys_from_json(json: &str) -> Result<Vec<Passkey>, PvProviderError> {
    let serializables: Vec<SerializablePasskey> = serde_json::from_str(json)
        .map_err(|e| PvProviderError::Serde(format!("Passkey JSON array decode failed: {e}")))?;
    serializables.into_iter().map(serializable_to_passkey).collect()
}

/// In-memory `CredentialStore` adapter over a caller-supplied `Vec<Passkey>`.
/// No decryption, no I/O — see module header comment.
pub struct PvCredentialStore {
    passkeys: Vec<Passkey>,
}

impl PvCredentialStore {
    /// Construct from a JSON array of already-decrypted `Passkey` blobs (see
    /// `passkeys_from_json`). Empty JSON array (`"[]"`) is valid — represents
    /// a brand-new registration ceremony with no existing credentials for
    /// this RP yet.
    pub fn from_passkeys_json(json: &str) -> Result<Self, PvProviderError> {
        Ok(Self { passkeys: passkeys_from_json(json)? })
    }

    /// Borrowed view of the store's current `Passkey` list — used both
    /// before construction is consumed by `Authenticator::new` (to snapshot
    /// pre-ceremony state, e.g. sign counters) and after a ceremony
    /// completes (via `Authenticator::store()`) to find the resulting
    /// credential.
    pub(crate) fn passkeys(&self) -> &[Passkey] {
        &self.passkeys
    }

    /// Consumes the store, returning its current `Passkey` list — used after
    /// a ceremony completes to find the (possibly newly-saved or
    /// newly-updated) credential the caller cares about.
    pub fn into_passkeys(self) -> Vec<Passkey> {
        self.passkeys
    }
}

#[async_trait]
impl CredentialStore for PvCredentialStore {
    type PasskeyItem = Passkey;

    async fn find_credentials(
        &self,
        ids: Option<&[PublicKeyCredentialDescriptor]>,
        rp_id: &str,
        _user_handle: Option<&[u8]>,
    ) -> Result<Vec<Self::PasskeyItem>, StatusCode> {
        let matches: Vec<Passkey> = self
            .passkeys
            .iter()
            .filter(|pk| pk.rp_id == rp_id)
            .filter(|pk| {
                ids.is_none_or(|list| list.iter().any(|d| d.id == pk.credential_id))
            })
            .cloned()
            .collect();
        if matches.is_empty() {
            Err(Ctap2Error::NoCredentials.into())
        } else {
            Ok(matches)
        }
    }

    async fn save_credential(
        &mut self,
        cred: Passkey,
        _user: PublicKeyCredentialUserEntity,
        _rp: PublicKeyCredentialRpEntity,
        _options: Options,
    ) -> Result<(), StatusCode> {
        self.passkeys.push(cred);
        Ok(())
    }

    async fn update_credential(&mut self, cred: &Self::PasskeyItem) -> Result<(), StatusCode> {
        if let Some(existing) = self
            .passkeys
            .iter_mut()
            .find(|pk| pk.credential_id == cred.credential_id)
        {
            *existing = cred.clone();
        } else {
            self.passkeys.push(cred.clone());
        }
        Ok(())
    }

    async fn get_info(&self) -> StoreInfo {
        // ForcedDiscoverable: our vault always stores the user_handle
        // (Passkey::user_handle) alongside the credential, so every passkey
        // this store returns is effectively a discoverable credential from
        // the RP's point of view. This matches passkey-authenticator's own
        // `MemoryStore` reference impl.
        StoreInfo { discoverability: DiscoverabilitySupport::ForcedDiscoverable }
    }
}

/// Trivial `UserValidationMethod`: unconditionally reports the user as
/// present+verified. This is safe ONLY because real user consent already
/// happened via the popup ceremony UI (Plan 12-04) before `create_provider_
/// credential`/`get_provider_assertion` is ever invoked — per D-09's
/// ordering guarantee, the background never calls into this crate before
/// the vault is unlocked and, for create/get, before the popup ceremony has
/// resolved to a confirm. This type performs NO UI/consent logic of its own;
/// it exists only to satisfy `Authenticator::new`'s trait bound.
pub struct PvUserValidation;

#[async_trait]
impl UserValidationMethod for PvUserValidation {
    type PasskeyItem = Passkey;

    async fn check_user<'a>(
        &self,
        _hint: UiHint<'a, Self::PasskeyItem>,
        _presence: bool,
        _verification: bool,
    ) -> Result<UserCheck, Ctap2Error> {
        Ok(UserCheck { presence: true, verification: true })
    }

    fn is_presence_enabled(&self) -> bool {
        true
    }

    fn is_verification_enabled(&self) -> Option<bool> {
        Some(true)
    }
}
