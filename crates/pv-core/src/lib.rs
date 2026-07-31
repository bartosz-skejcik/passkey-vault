//! pv-core — współdzielony core kryptograficzny.
//!
//! Hierarchia kluczy (ARCHITECTURE.md §4):
//!
//! ```text
//!                losowy 256-bit User Key (UK)
//!                     │ wrapowany równolegle do N "recipientów"
//!      ┌──────────────┴───────────────┐
//!  master password                passkey #N
//!  → Argon2id → HKDF → wrap UK    → PRF(salt) → HKDF → wrap UK
//!
//!  UK → wrapuje per-item Cipher Keys → itemy (XChaCha20-Poly1305)
//!  UK → wrapuje X25519 IdentitySecretKey (aead_seal, INFO_X25519_SK_WRAP)
//!  IdentityPublicKey (publiczna połowa identity keypair) → zapieczętowuje
//!    (identity::seal/unseal, crypto_box::ChaChaBox) per-recipient
//!    Collection Keys (Plan 21-04) → kluczują item encryption zakresu
//!    kolekcji (Plan 21-03)
//! ```
//!
//! Serwer nigdy nie widzi UK ani żadnego klucza pośredniego — trzyma tylko
//! bloby [`keys::WrappedKey`]. Ten crate nie robi I/O i kompiluje się do WASM.

pub mod error;
pub mod identity;
pub mod invite;
pub mod items;
pub mod kdf;
pub mod keys;
pub mod prf;
pub mod totp;

pub use error::CryptoError;
