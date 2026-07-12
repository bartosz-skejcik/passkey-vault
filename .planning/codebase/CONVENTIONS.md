# Coding Conventions

**Analysis Date:** 2026-07-12

## Naming Patterns

**Files:**
- Module files: lowercase with snake_case (e.g., `keys.rs`, `kdf.rs`, `items.rs`, `error.rs`)
- Main entry: `main.rs`, `lib.rs`
- Submodules organized in directories (e.g., `routes/mod.rs`, `routes/auth.rs`)

**Functions:**
- snake_case (e.g., `hkdf_expand_key`, `aead_seal`, `encrypt_item`, `decrypt_item`)
- Public functions have no special prefix
- Private/internal functions use `pub(crate)` visibility (e.g., `aead_seal`, `aead_open`)

**Variables:**
- snake_case (e.g., `master_key`, `wrapping_key`, `plaintext`, `ciphertext`)
- Cryptographic material uses common abbreviations: `uk` (User Key), `mk` (Master Key), `wk` (wrapping key), `prf` (PRF output)

**Constants:**
- UPPER_CASE (e.g., `KEY_LEN`, `NONCE_LEN`, `INFO_PW_UNLOCK`, `INFO_PRF_UNLOCK`)
- Domain separation constants are byte strings with version (e.g., `b"pv:pw-unlock:v1"`)

**Types:**
- PascalCase for structs (e.g., `UserKey`, `WrappedKey`, `KdfParams`, `CryptoError`, `AppState`)
- PascalCase for enums (e.g., `CryptoError`)
- Trait bounds use standard names (e.g., `Zeroize`, `ZeroizeOnDrop`, `Serialize`, `Deserialize`)

**Modules:**
- Module names: lowercase snake_case (e.g., `pub mod error`, `pub mod keys`, `pub mod kdf`, `pub mod items`, `pub mod prf`)
- Test modules: always named `mod tests` and gated with `#[cfg(test)]`

## Code Style

**Formatting:**
- Uses Rust stable toolchain with default rustfmt settings (Edition 2021)
- No custom `.rustfmt.toml` or `rustfmt.config.toml` in repo — relies on project defaults
- 4-space indentation (Rust standard)
- Line length: implicit (follows common Rust practice of ~100 chars for readability)

**Linting:**
- No explicit clippy configuration file (no `clippy.toml`)
- Assumes standard clippy rules from stable toolchain
- No `.editorconfig` or project-level linting configuration

**Documentation Comments:**
- Module-level docs use `//!` at the top of files
- Comments mix Polish and English (project language is Polish)
- Complex concepts documented with ASCII diagrams (e.g., key hierarchy in `lib.rs`, flow diagrams in module docs)
- Inline comments use `//` for clarification on non-obvious logic
- Doc comments explain "why" not just "what"

Example from `crates/pv-core/src/lib.rs`:
```rust
//! pv-core — współdzielony core kryptograficzny.
//!
//! Hierarchia kluczy (ARCHITECTURE.md §4):
//!
//! ```text
//!                losowy 256-bit User Key (UK)
//!                     │ wrapowany równolegle do N "recipientów"
//! ...
```

## Import Organization

**Order:**
1. External crate imports (alphabetically within group)
2. Internal crate imports (`use crate::...`)
3. Module declarations (`mod ...`)

**Example from `crates/pv-core/src/keys.rs`:**
```rust
use chacha20poly1305::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload},
    XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::CryptoError;
```

**Path Aliases:**
- No path aliases configured in workspace or crates
- Full module paths used throughout (e.g., `crate::keys::UserKey`)
- Relative imports within same crate use `crate::` prefix

## Error Handling

**Strategy:** 
- Custom error enums for domain-specific errors (`CryptoError`)
- `anyhow::Result<T>` for top-level/operational errors (main.rs, config)
- Conversion between error types using `map_err()`

**Patterns:**

From `crates/pv-core/src/error.rs`:
```rust
use thiserror::Error;

#[derive(Debug, Error)]
pub enum CryptoError {
    #[error("key derivation failed")]
    Kdf,
    #[error("decryption failed (wrong key or corrupted data)")]
    Decrypt,
    #[error("encryption failed")]
    Encrypt,
    #[error("invalid input: {0}")]
    InvalidInput(&'static str),
}
```

From `crates/pv-core/src/keys.rs`:
```rust
pub(crate) fn aead_seal(
    key: &[u8; KEY_LEN],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<WrappedKey, CryptoError> {
    let cipher = XChaCha20Poly1305::new(key.into());
    // ...
    let ciphertext = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: plaintext, aad })
        .map_err(|_| CryptoError::Encrypt)?;
    Ok(WrappedKey { nonce: nonce.to_vec(), ciphertext })
}
```

From `crates/pv-server/src/main.rs`:
```rust
let db_opts: SqliteConnectOptions = cfg
    .db_url
    .parse::<SqliteConnectOptions>()
    .context("invalid PV_DB_URL")?
    .create_if_missing(true);
```

**Key principles:**
- Use `.map_err()` to convert error types
- Use `.context()` from `anyhow` to add operational context in server code
- Use `?` operator for error propagation
- Return meaningful error messages (not just generic variants)

## Logging

**Framework:** 
- Uses `tracing` crate for structured logging
- `tracing_subscriber` for initialization and filtering

**Patterns:**
- Configured via `EnvFilter::try_from_default_env()` with default level "info"
- Usage: `tracing::info!()`, `tracing::error!()`, `tracing::debug!()`

From `crates/pv-server/src/main.rs`:
```rust
tracing_subscriber::fmt()
    .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
    .init();

// ...

tracing::info!("pv-server listening on http://{}", cfg.addr);
// ...
tracing::info!("shutting down");
```

## Security Patterns

**Sensitive Data Handling:**
- Use `Zeroize` trait to clear sensitive data from memory
- Use `ZeroizeOnDrop` derive macro to automatically zeroize on drop
- Use `zeroize::Zeroizing<T>` wrapper for automatic cleanup

From `crates/pv-core/src/keys.rs`:
```rust
#[derive(Zeroize, ZeroizeOnDrop)]
pub struct UserKey([u8; KEY_LEN]);
```

From `crates/pv-core/src/kdf.rs`:
```rust
pub fn derive_master_key(
    password: &[u8],
    salt: &[u8],
    params: &KdfParams,
) -> Result<Zeroizing<[u8; MASTER_KEY_LEN]>, CryptoError> {
    // ...
    let mut out = Zeroizing::new([0u8; MASTER_KEY_LEN]);
    // ... use out ...
    Ok(out)  // Automatically zeroized when dropped
}
```

## Function Design

**Size:** 
- Small focused functions (most crypto functions are 3-15 lines)
- Larger functions break down into smaller helper functions
- Example: `decrypt_item()` in `items.rs` calls `aead_open()` internally

**Parameters:**
- Use byte arrays with fixed size where possible (e.g., `[u8; KEY_LEN]`)
- Use slices for variable-length inputs (e.g., `&[u8]`)
- Pass borrowed references by default
- Shared const definitions for magic numbers (`KEY_LEN`, `NONCE_LEN`, etc.)

**Return Values:**
- Custom result types for crypto operations: `Result<T, CryptoError>`
- Operational errors: `anyhow::Result<T>`
- Use `Ok(value)` and `Err(error)` consistently

## Module Design

**Exports:**
- Use `pub` for public API, nothing for private
- Re-export important types from `lib.rs`: `pub use error::CryptoError;`

From `crates/pv-core/src/lib.rs`:
```rust
pub mod error;
pub mod items;
pub mod kdf;
pub mod keys;
pub mod prf;

pub use error::CryptoError;
```

**Barrel Files:**
- `routes/mod.rs` collects all routes into a single router function
- Each route module (e.g., `auth.rs`) exports request/response types

## Dependency Management

**Workspace Dependencies:**
- Defined in root `Cargo.toml` under `[workspace.dependencies]`
- Shared across crates via `.workspace = true`

From root `Cargo.toml`:
```toml
[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "2"
uuid = { version = "1", features = ["v4", "serde"] }
```

## Comments and Documentation

**When to Comment:**
- Complex cryptographic operations documented with references and assumptions
- Security-critical decisions explained (e.g., why memory is zeroized)
- Non-obvious implementation details (e.g., domain separation constant rationale)
- TODO items for incomplete/placeholder code (found in `auth.rs`)

**TODOs/FIXMEs:**
- Marked clearly with `TODO:` comment
- Include context about when/how to address

From `crates/pv-server/src/routes/auth.rs`:
```rust
/// Sól KDF (base64). Dla nieistniejących kont zwracana deterministycznie,
/// żeby nie ujawniać istnienia konta — TODO przy implementacji rejestracji.
pub salt: String,

// TODO: lookup users.kdf_params po emailu; na razie sensowne defaulty.
```

---

*Convention analysis: 2026-07-12*
