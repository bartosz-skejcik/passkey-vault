//! Ścieżka PRF: wynik WebAuthn PRF (hmac-secret) → klucz wrapujący User Key.
//!
//! Wynik PRF (32 bajty HMAC-SHA-256 po stronie authenticatora) nigdy nie
//! opuszcza klienta. Sól PRF jest per-credential, jawna, przechowywana na
//! serwerze obok credentialu.
//!
//! UWAGA (footgun z RESEARCH.md): usunięcie passkeya niszczy wyprowadzany
//! klucz — User Key MUSI być zawsze wrapowany również pod master password.
//! To samo dotyczy passkeya extension-scoped poniżej (09-CONTEXT AMENDMENT
//! 2026-07-15): usunięcie go NIGDY nie strandnie vaulta, bo UK jest zawsze
//! też wrapowany pod hasłem.

use zeroize::Zeroizing;

use crate::{
    keys::{self, KEY_LEN},
    CryptoError,
};

pub const PRF_OUTPUT_LEN: usize = 32;
pub const PRF_SALT_LEN: usize = 32;

/// Wynik PRF → klucz wrapujący UK (recipient passkey).
pub fn wrapping_key_from_prf(
    prf_output: &[u8],
) -> Result<Zeroizing<[u8; KEY_LEN]>, CryptoError> {
    if prf_output.len() < PRF_OUTPUT_LEN {
        return Err(CryptoError::InvalidInput("PRF output too short"));
    }
    Ok(Zeroizing::new(keys::hkdf_expand_key(prf_output, keys::INFO_PRF_UNLOCK)))
}

/// Wynik PRF z passkeya EXTENSION-SCOPED (rpId = extension ID) → klucz
/// wrapujący UK — osobny recipient class od `wrapping_key_from_prf` powyżej
/// (09-CONTEXT AMENDMENT 2026-07-15: `navigator.credentials.get()` z
/// `chrome-extension://` popupu akceptuje jako rpId WYŁĄCZNIE ID rozszerzenia,
/// nigdy web-RP id). Byte-for-byte to samo ciało co `wrapping_key_from_prf`,
/// jedyna różnica to domain-separation constant (`INFO_EXT_PRF_UNLOCK`
/// zamiast `INFO_PRF_UNLOCK`) — te dwa konteksty MUSZĄ produkować
/// kryptograficznie różne klucze z tego samego wejścia (patrz test
/// `ext_prf_and_web_prf_keys_are_cryptographically_distinct` poniżej).
pub fn wrapping_key_from_ext_prf(
    prf_output: &[u8],
) -> Result<Zeroizing<[u8; KEY_LEN]>, CryptoError> {
    if prf_output.len() < PRF_OUTPUT_LEN {
        return Err(CryptoError::InvalidInput("PRF output too short"));
    }
    Ok(Zeroizing::new(keys::hkdf_expand_key(prf_output, keys::INFO_EXT_PRF_UNLOCK)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::{unwrap_user_key, wrap_user_key, UserKey};

    #[test]
    fn prf_unlock_roundtrip() {
        let uk = UserKey::generate();
        let prf_output = [7u8; PRF_OUTPUT_LEN];
        let wk = wrapping_key_from_prf(&prf_output).unwrap();
        let blob = wrap_user_key(&wk, &uk).unwrap();
        let uk2 = unwrap_user_key(&wrapping_key_from_prf(&prf_output).unwrap(), &blob).unwrap();
        assert_eq!(uk.expose(), uk2.expose());
    }

    #[test]
    fn short_prf_output_rejected() {
        assert!(wrapping_key_from_prf(&[0u8; 16]).is_err());
    }

    #[test]
    fn ext_prf_unlock_roundtrip() {
        let uk = UserKey::generate();
        let prf_output = [7u8; PRF_OUTPUT_LEN];
        let wk = wrapping_key_from_ext_prf(&prf_output).unwrap();
        let blob = wrap_user_key(&wk, &uk).unwrap();
        let uk2 = unwrap_user_key(&wrapping_key_from_ext_prf(&prf_output).unwrap(), &blob).unwrap();
        assert_eq!(uk.expose(), uk2.expose());
    }

    /// The load-bearing new test: for the SAME `prf_output` fixture, a blob
    /// wrapped under `wrapping_key_from_ext_prf`'s key CANNOT be unwrapped by
    /// `wrapping_key_from_prf`'s key, and vice versa — proving
    /// `INFO_EXT_PRF_UNLOCK` and `INFO_PRF_UNLOCK` produce cryptographically
    /// distinct keys from identical input (09-CONTEXT AMENDMENT 2026-07-15).
    #[test]
    fn ext_prf_and_web_prf_keys_are_cryptographically_distinct() {
        let prf_output = [7u8; PRF_OUTPUT_LEN];
        let web_wk = wrapping_key_from_prf(&prf_output).unwrap();
        let ext_wk = wrapping_key_from_ext_prf(&prf_output).unwrap();

        let uk = UserKey::generate();
        let blob_wrapped_by_ext = wrap_user_key(&ext_wk, &uk).unwrap();
        assert!(unwrap_user_key(&web_wk, &blob_wrapped_by_ext).is_err());

        let blob_wrapped_by_web = wrap_user_key(&web_wk, &uk).unwrap();
        assert!(unwrap_user_key(&ext_wk, &blob_wrapped_by_web).is_err());
    }

    #[test]
    fn short_ext_prf_output_rejected() {
        assert!(wrapping_key_from_ext_prf(&[0u8; 16]).is_err());
    }
}
