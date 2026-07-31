//! Invite-secret-derived symmetric channel (FAM-04/05/06; 24-CONTEXT.md's
//! Amendment 2 adds the third, proof-of-possession derivation).
//!
//! `invite_secret = random_bytes(32)` is generated client-side and NEVER
//! transmitted in any form — it lives only in the invite link's URL fragment
//! (which browsers never send in any HTTP request). Three independent values
//! are HKDF-derived from it, each under its own versioned domain-separation
//! constant:
//!
//! - `invite_id = HKDF(invite_secret, INFO_INVITE_ID)` — safe to expose, used
//!   as the `invitations` row's public lookup handle (its `id` column).
//! - `invite_wrap_key = HKDF(invite_secret, INFO_INVITE_WRAP)` — never
//!   transmitted; wraps/unwraps the shared Collection Key for the invite.
//! - `invite_proof = HKDF(invite_secret, INFO_INVITE_PROOF)` — never
//!   transmitted at creation time (only its SHA-256 hash is); presented by
//!   the invitee's client at redemption time as proof of possessing the
//!   fragment secret, closing T-24-07 (an `invite_id` alone, observable in a
//!   log/Referer, must not be redeemable on its own).
//!
//! **This module calls ONLY `keys::aead_seal`/`keys::aead_open` (AAD-capable,
//! symmetric) — NEVER `identity::seal`/`identity::unseal` (AAD-incapable,
//! asymmetric self-seal).** The two primitives serve different layers of the
//! invite flow (this module's symmetric invite-wrap vs. the invitee's later
//! self-seal to their own identity key, built in a downstream plan) and must
//! never be conflated — `identity.rs`'s own `chachabox_rejects_nonempty_aad`
//! test proves the asymmetric primitive rejects non-empty AAD outright.

use sha2::{Digest, Sha256};
use zeroize::{Zeroize, Zeroizing};

use crate::keys::{self, KEY_LEN};
use crate::CryptoError;

/// Domain separation dla HKDF — wersjonowane, nigdy nie zmieniać wstecznie.
/// Distinct from every existing `INFO_*` constant in `keys.rs`/`identity.rs`.
pub const INFO_INVITE_ID: &[u8] = b"pv:invite-id:v1";
pub const INFO_INVITE_WRAP: &[u8] = b"pv:invite-wrap:v1";
/// Amendment 2 — the proof-of-possession leg. Without it, `invite_id` alone
/// would be redeemable by anyone who merely observed it in a log/Referer.
pub const INFO_INVITE_PROOF: &[u8] = b"pv:invite-proof:v1";

/// Derives the public `invite_id` from `invite_secret` — URL-safe, no
/// padding, since this value is a URL path segment (`/invite/{invite_id}`),
/// unlike existing `STANDARD`-encoded fields that only ever appear inside
/// JSON bodies.
pub fn derive_invite_id(invite_secret: &[u8; KEY_LEN]) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    URL_SAFE_NO_PAD.encode(keys::hkdf_expand_key(invite_secret, INFO_INVITE_ID))
}

/// Builds the AAD binding the symmetric invite-wrap to a specific
/// `invite_id` — `INFO_INVITE_WRAP || invite_id`, mirroring the
/// domain-separation-constant-as-AAD-prefix convention `identity.rs` uses for
/// `INFO_X25519_SK_WRAP`.
fn invite_wrap_aad(invite_id: &str) -> Vec<u8> {
    let mut aad = INFO_INVITE_WRAP.to_vec();
    aad.extend_from_slice(invite_id.as_bytes());
    aad
}

/// Wraps `collection_key` under `invite_secret`'s derived `invite_wrap_key`,
/// AAD-bound to `invite_id` so a wrapped blob cannot be replayed under a
/// different invite's id. The ONLY function in this module allowed to call
/// `aead_seal` — never `identity::seal`.
pub fn wrap_collection_key_for_invite(
    invite_secret: &[u8; KEY_LEN],
    invite_id: &str,
    collection_key: &[u8; KEY_LEN],
) -> Result<keys::WrappedKey, CryptoError> {
    let mut invite_wrap_key = keys::hkdf_expand_key(invite_secret, INFO_INVITE_WRAP);
    let aad = invite_wrap_aad(invite_id);
    let result = keys::aead_seal(&invite_wrap_key, collection_key, &aad);
    invite_wrap_key.zeroize();
    result
}

/// Inverse of [`wrap_collection_key_for_invite`] — unwraps `blob` back to the
/// original Collection Key bytes, validating the decrypted length is exactly
/// `KEY_LEN` before copying into a fixed array (mirrors `unwrap_user_key`'s
/// length-check-then-zeroize discipline in `keys.rs`, including zeroizing the
/// intermediate `Vec<u8>` on the length-mismatch error path too).
pub fn unwrap_collection_key_for_invite(
    invite_secret: &[u8; KEY_LEN],
    invite_id: &str,
    blob: &keys::WrappedKey,
) -> Result<[u8; KEY_LEN], CryptoError> {
    let mut invite_wrap_key = keys::hkdf_expand_key(invite_secret, INFO_INVITE_WRAP);
    let aad = invite_wrap_aad(invite_id);
    let opened = keys::aead_open(&invite_wrap_key, blob, &aad);
    invite_wrap_key.zeroize();
    let mut plain = opened?;

    if plain.len() != KEY_LEN {
        plain.zeroize();
        return Err(CryptoError::Decrypt);
    }
    let mut out = [0u8; KEY_LEN];
    out.copy_from_slice(&plain);
    plain.zeroize();
    Ok(out)
}

/// Derives the raw proof-of-possession value (Amendment 2) — deterministic,
/// reused by the client for BOTH the creation-time hash (see
/// [`hash_invite_proof`]) and the redemption-time presentation, never itself
/// transmitted at creation time.
///
/// WR-08 (24-REVIEW.md): `invite_proof` is a bearer credential — presenting
/// it is what authorises reading invite metadata and redeeming. Returned
/// wrapped in `Zeroizing` (not a bare `[u8; KEY_LEN]`) so it is zeroized on
/// drop, matching this same file's own discipline three functions up
/// (`wrap_collection_key_for_invite` explicitly zeroizes `invite_wrap_key`)
/// and CLAUDE.md's standing rule to wrap key material in `Zeroizing<T>`.
pub fn derive_invite_proof(invite_secret: &[u8; KEY_LEN]) -> Zeroizing<[u8; KEY_LEN]> {
    Zeroizing::new(keys::hkdf_expand_key(invite_secret, INFO_INVITE_PROOF))
}

/// Hashes `invite_proof` with SHA-256 — this is what the inviter's client
/// sends as `proof_hash` at creation time. The server never calls this
/// function itself; it has its own re-hash (added by a downstream plan) for
/// the SEPARATE job of verifying a client-submitted `invite_proof` at
/// redemption time, kept textually distinct so `pv-core` never gains a
/// reason to be imported by `pv-server`'s route code.
pub fn hash_invite_proof(invite_proof: &[u8; KEY_LEN]) -> [u8; 32] {
    Sha256::new().chain_update(invite_proof).finalize().into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity;
    use crate::keys as pv_keys;

    fn random_secret() -> [u8; KEY_LEN] {
        let bytes = pv_keys::random_bytes(KEY_LEN);
        let mut out = [0u8; KEY_LEN];
        out.copy_from_slice(&bytes);
        out
    }

    #[test]
    fn constant_distinctness() {
        assert_ne!(INFO_INVITE_ID, INFO_INVITE_WRAP);
        assert_ne!(INFO_INVITE_ID, INFO_INVITE_PROOF);
        assert_ne!(INFO_INVITE_WRAP, INFO_INVITE_PROOF);

        assert_ne!(INFO_INVITE_ID, pv_keys::INFO_PW_UNLOCK);
        assert_ne!(INFO_INVITE_ID, pv_keys::INFO_PRF_UNLOCK);
        assert_ne!(INFO_INVITE_ID, pv_keys::INFO_EXT_PRF_UNLOCK);
        assert_ne!(INFO_INVITE_ID, pv_keys::INFO_AUTH_HASH);
        assert_ne!(INFO_INVITE_ID, identity::INFO_X25519_SK_WRAP);

        assert_ne!(INFO_INVITE_WRAP, pv_keys::INFO_PW_UNLOCK);
        assert_ne!(INFO_INVITE_WRAP, pv_keys::INFO_PRF_UNLOCK);
        assert_ne!(INFO_INVITE_WRAP, pv_keys::INFO_EXT_PRF_UNLOCK);
        assert_ne!(INFO_INVITE_WRAP, pv_keys::INFO_AUTH_HASH);
        assert_ne!(INFO_INVITE_WRAP, identity::INFO_X25519_SK_WRAP);

        assert_ne!(INFO_INVITE_PROOF, pv_keys::INFO_PW_UNLOCK);
        assert_ne!(INFO_INVITE_PROOF, pv_keys::INFO_PRF_UNLOCK);
        assert_ne!(INFO_INVITE_PROOF, pv_keys::INFO_EXT_PRF_UNLOCK);
        assert_ne!(INFO_INVITE_PROOF, pv_keys::INFO_AUTH_HASH);
        assert_ne!(INFO_INVITE_PROOF, identity::INFO_X25519_SK_WRAP);
    }

    #[test]
    fn wrap_unwrap_roundtrip_yields_identical_bytes() {
        let secret = random_secret();
        let invite_id = derive_invite_id(&secret);
        let collection_key = [0x42u8; KEY_LEN];

        let wrapped = wrap_collection_key_for_invite(&secret, &invite_id, &collection_key).unwrap();
        let unwrapped = unwrap_collection_key_for_invite(&secret, &invite_id, &wrapped).unwrap();

        assert_eq!(collection_key, unwrapped);
    }

    #[test]
    fn unwrap_fails_with_wrong_invite_secret() {
        let secret = random_secret();
        let other_secret = random_secret();
        let invite_id = derive_invite_id(&secret);
        let collection_key = [0x7au8; KEY_LEN];

        let wrapped = wrap_collection_key_for_invite(&secret, &invite_id, &collection_key).unwrap();
        assert!(unwrap_collection_key_for_invite(&other_secret, &invite_id, &wrapped).is_err());
    }

    #[test]
    fn unwrap_fails_with_mismatched_invite_id_aad() {
        let secret = random_secret();
        let invite_id = derive_invite_id(&secret);
        let different_invite_id = "not-the-real-invite-id";
        let collection_key = [0x11u8; KEY_LEN];

        let wrapped = wrap_collection_key_for_invite(&secret, &invite_id, &collection_key).unwrap();
        assert!(unwrap_collection_key_for_invite(&secret, different_invite_id, &wrapped).is_err());
    }

    #[test]
    fn derive_invite_id_is_url_safe_and_deterministic() {
        let secret = random_secret();
        let a = derive_invite_id(&secret);
        let b = derive_invite_id(&secret);
        assert_eq!(a, b);
        assert!(!a.contains('+'));
        assert!(!a.contains('/'));
        assert!(!a.contains('='));
    }

    // IN-06 (24-REVIEW.md): renamed from `..._is_deterministic_and_independent_
    // of_the_other_two_derivations` — asserting pairwise `assert_ne!` is a much
    // weaker property than "independent" implies; this name no longer
    // overclaims what is actually proven (a smoke test that the three
    // derivations differ, not a domain-separation proof).
    #[test]
    fn derive_invite_proof_is_deterministic_and_differs_from_the_other_two_derivations() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};

        let secret = random_secret();
        let a = derive_invite_proof(&secret);
        let b = derive_invite_proof(&secret);
        assert_eq!(*a, *b);

        // WR-08: `a`/`b` are now `Zeroizing<[u8; KEY_LEN]>` (zeroized on
        // drop) — `*a` dereferences to the inner array for comparison
        // against the bare-array outputs of the other two derivations.
        assert_ne!(*a, pv_keys::hkdf_expand_key(&secret, INFO_INVITE_WRAP));

        let invite_id = derive_invite_id(&secret);
        let invite_id_bytes = URL_SAFE_NO_PAD.decode(invite_id).unwrap();
        assert_ne!(a.to_vec(), invite_id_bytes);
    }

    #[test]
    fn hash_invite_proof_is_deterministic_and_differs_for_different_inputs() {
        let secret_a = random_secret();
        let secret_b = random_secret();
        let proof_a = derive_invite_proof(&secret_a);
        let proof_b = derive_invite_proof(&secret_b);

        assert_eq!(hash_invite_proof(&proof_a), hash_invite_proof(&proof_a));
        assert_ne!(hash_invite_proof(&proof_a), hash_invite_proof(&proof_b));
    }
}
