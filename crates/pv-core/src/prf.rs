//! Ścieżka PRF: wynik WebAuthn PRF (hmac-secret) → klucz wrapujący User Key.
//!
//! Wynik PRF (32 bajty HMAC-SHA-256 po stronie authenticatora) nigdy nie
//! opuszcza klienta. Sól PRF jest per-credential, jawna, przechowywana na
//! serwerze obok credentialu.
//!
//! UWAGA (footgun z RESEARCH.md): usunięcie passkeya niszczy wyprowadzany
//! klucz — User Key MUSI być zawsze wrapowany również pod master password.

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
}
