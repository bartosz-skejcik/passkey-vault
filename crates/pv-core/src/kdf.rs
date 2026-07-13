//! Ścieżka hasłowa: master password → Argon2id → master key.

use argon2::{Algorithm, Argon2, Params, Version};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::{keys, CryptoError};

pub const MASTER_KEY_LEN: usize = 32;
pub const MIN_SALT_LEN: usize = 16;

/// Parametry KDF przechowywane per-user na serwerze (jawne).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfParams {
    pub m_cost_kib: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    /// 64 MiB / 3 iteracje / 4 lanes — zgodne z zaleceniami OWASP dla Argon2id.
    fn default() -> Self {
        Self { m_cost_kib: 64 * 1024, t_cost: 3, p_cost: 4 }
    }
}

pub fn derive_master_key(
    password: &[u8],
    salt: &[u8],
    params: &KdfParams,
) -> Result<Zeroizing<[u8; MASTER_KEY_LEN]>, CryptoError> {
    if password.is_empty() {
        return Err(CryptoError::InvalidInput("empty password"));
    }
    if salt.len() < MIN_SALT_LEN {
        return Err(CryptoError::InvalidInput("salt too short"));
    }
    let params = Params::new(params.m_cost_kib, params.t_cost, params.p_cost, Some(MASTER_KEY_LEN))
        .map_err(|_| CryptoError::Kdf)?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut out = Zeroizing::new([0u8; MASTER_KEY_LEN]);
    argon
        .hash_password_into(password, salt, out.as_mut())
        .map_err(|_| CryptoError::Kdf)?;
    Ok(out)
}

/// Hasło → klucz wrapujący User Key (recipient hasłowy).
pub fn wrapping_key_from_password(
    password: &[u8],
    salt: &[u8],
    params: &KdfParams,
) -> Result<Zeroizing<[u8; MASTER_KEY_LEN]>, CryptoError> {
    let mk = derive_master_key(password, salt, params)?;
    Ok(Zeroizing::new(keys::hkdf_expand_key(mk.as_ref(), keys::INFO_PW_UNLOCK)))
}

/// Hasło → auth-hash wysyłany na serwer (recipient logowania).
///
/// Niezależnie wywołuje `derive_master_key` (osobny, kosztowny przebieg
/// Argon2id) — to celowa duplikacja na poziomie API `pv-core`. Wywołujący,
/// który potrzebuje ZARÓWNO auth-hash, JAK I wrapping key z jednego hasła
/// (rejestracja/logowanie), powinien wołać `derive_master_key` raz i
/// rozwinąć oba wyniki przez `keys::hkdf_expand_key` z osobnymi stałymi
/// INFO_* — patrz warstwa `pv-wasm::derive_auth_material`, gdzie ta
/// optymalizacja faktycznie się dzieje.
pub fn auth_hash_from_password(
    password: &[u8],
    salt: &[u8],
    params: &KdfParams,
) -> Result<Zeroizing<[u8; MASTER_KEY_LEN]>, CryptoError> {
    let mk = derive_master_key(password, salt, params)?;
    Ok(Zeroizing::new(keys::hkdf_expand_key(mk.as_ref(), keys::INFO_AUTH_HASH)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deliberately cheap params — this test only cares about domain
    /// separation of the HKDF output, not Argon2id's real cost profile.
    fn test_params() -> KdfParams {
        KdfParams { m_cost_kib: 8 * 1024, t_cost: 1, p_cost: 1 }
    }

    #[test]
    fn auth_hash_differs_from_wrapping_key() {
        let password = b"correct horse battery staple";
        let salt = b"0123456789abcdef";
        let params = test_params();

        let wrapping_key = wrapping_key_from_password(password, salt, &params).unwrap();
        let auth_hash = auth_hash_from_password(password, salt, &params).unwrap();

        assert_ne!(wrapping_key.as_ref(), auth_hash.as_ref());
    }

    #[test]
    fn auth_hash_from_password_is_deterministic() {
        let password = b"correct horse battery staple";
        let salt = b"0123456789abcdef";
        let params = test_params();

        let a = auth_hash_from_password(password, salt, &params).unwrap();
        let b = auth_hash_from_password(password, salt, &params).unwrap();

        assert_eq!(a.as_ref(), b.as_ref());
    }
}
