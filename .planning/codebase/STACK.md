# Technology Stack

**Analysis Date:** 2026-07-12

## Languages

**Primary:**
- Rust (edition 2021) - Full server, cryptographic core, and WASM-compiled shared library
- TypeScript (planned) - Web app (Next.js) and browser extension UI

**Secondary:**
- SQL - SQLite schema with migrations
- Kotlin (planned) - Android credential provider service
- Swift (planned) - iOS credential provider ViewController

## Runtime

**Environment:**
- Rust stable toolchain with WASM target (`wasm32-unknown-unknown`)

**Package Manager:**
- Cargo (Rust)
- npm/pnpm (planned for web/extension frontends)

**Lockfile:**
- `Cargo.lock` - present, pinned dependencies

## Frameworks

**Backend:**
- **Axum** (0.8) - Web framework for REST API and WebSocket handlers
  - Location: `crates/pv-server/src/`
  - Handles routing, state management, graceful shutdown

**Cryptography:**
- **webauthn-rs** (0.5) - WebAuthn/FIDO2 relying party implementation
  - Signature verification, credential lifecycle management
  - Full spec compliance: ES256 (ECDSA P-256)

**Database:**
- **SQLx** (0.8) - Async SQL query builder and executor
  - Runtime: tokio
  - Supports: SQLite (default) and PostgreSQL
  - Migration framework: `sqlx migrate!()` macro for compile-time checked migrations
  - Migrations location: `crates/pv-server/migrations/0001_init.sql`

**Async Runtime:**
- **Tokio** (1.0) - Async runtime
  - Features: multi-threaded runtime, signal handling

**Observability:**
- **Tracing** (0.1) - Structured logging framework
- **Tracing-subscriber** (0.3) - Log formatting and filtering with `EnvFilter`
- **Tower-http** (0.6) - HTTP middleware including trace layer

**Build & Dev:**
- **Serde** (1.0) - Serialization/deserialization framework
  - Derive macros for JSON encoding (part of workspace dependencies)
- **Serde_json** (1.0) - JSON support
- **UUID** (1.0) - UUID v4 generation with serde support
- **Thiserror** (2.0) - Error handling with derive macros

## Key Dependencies

**Cryptographic Primitives:**
- **Argon2** (0.5) - KDF (key derivation function) — password hashing
  - Config: Argon2id, OWASP recommended parameters (64 MiB memory, 3 iterations, 4 parallelism)
  - Location of usage: `crates/pv-core/src/kdf.rs`
- **ChaCha20-Poly1305** (0.10) - AEAD cipher (authenticated encryption)
  - Uses extended nonce variant (XChaCha20-Poly1305) for random nonce safety
  - Location: `crates/pv-core/src/keys.rs`, `crates/pv-core/src/items.rs`
- **HKDF** (0.12) - Key derivation via Hmac-based key derivation function (SHA-256)
  - Used for domain-separated key expansion from master keys and PRF outputs
- **SHA2** (0.10) - SHA-256 hashing for HKDF and passkey signatures

**Memory Safety:**
- **Zeroize** (1.0) - Secure memory wiping for sensitive data
  - Derive macro: `#[derive(Zeroize, ZeroizeOnDrop)]`
  - Used for: UserKey, ItemKey, master keys in all crypto modules
  - Location: `crates/pv-core/src/` (all modules)

**Data Serialization:**
- **Base64** (0.22) - Base64 encoding (salt storage, credential serialization)

**Error Handling:**
- **Anyhow** (1.0) - Flexible error handling with context chains
  - Server-side: database connection errors, config parsing, migration failures

## Configuration

**Environment Variables:**
- `PV_ADDR` - Server bind address (default: `127.0.0.1:8620`)
- `PV_DB_URL` - Database connection string (default: `sqlite://data/pv.db`)
  - Format: SQLite file path or PostgreSQL connection string
- `RUST_LOG` - Tracing filter (default: `info`)
  - Via `EnvFilter::try_from_default_env()`

**Config Loading:**
- Location: `crates/pv-server/src/config.rs`
- Method: `Config::from_env()` with sensible defaults

**Build Configuration:**
- Workspace resolver: `2` (Rust 1.64+)
- Workspace members: `["crates/pv-core", "crates/pv-server"]`
- Shared dependencies via `[workspace.dependencies]`
- Rust edition: 2021

## Platform Requirements

**Development:**
- Rust stable (toolchain file: `rust-toolchain.toml`)
- WASM target: `wasm32-unknown-unknown` (for client-side core compilation)
- SQLite development headers (for SQLx compile-time checking)

**Production:**
- Self-hosted Docker container (single container deployment)
- Database: SQLite (bundled, file-based) or PostgreSQL (external)
- Network: TCP listener on `PV_ADDR` for HTTP/WebSocket

**Container Details:**
- Single container: includes Rust server + Next.js static/SSR web app
- Data persistence: SQLite database file mapped to volume
- Optional: PostgreSQL for scalability

## Design Patterns

**Shared Core Cryptography:**
- `crates/pv-core` compiles to both:
  - Native Rust library for server
  - WASM binary for web app and browser extension (same source code)
- Zero-knowledge design: server never sees plaintext keys
- Memory safety: Zeroize all sensitive data

**Zero-Knowledge Architecture:**
- **Server side:** Only encrypted blobs (`WrappedKey` structs)
- **Client side:** All decryption happens locally in WASM
- Keys managed per-item for efficient rotation and sharing

---

*Stack analysis: 2026-07-12*
