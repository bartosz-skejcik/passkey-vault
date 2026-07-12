<!-- GSD:project-start source:PROJECT.md -->

## Project

**Passkey Vault (nazwa robocza)**

Darmowy, open-source, **self-hostable jednym kontenerem Docker** menedżer haseł, który jest **passkey providerem** na wszystkich powierzchniach klienckich (extension Chrome+Firefox → Android → iOS → Windows) i traktuje **PRF vault unlock** (odblokowanie vaulta passkeyem) jako first-class feature — nie bolt-on. Zero-knowledge: serwer nigdy nie widzi kluczy ani plaintextu. UI w ciepłej, indie-makerowej estetyce datafa.st — przeciwieństwo enterprise'owego chłodu 1Password i sterylności Bitwardena.

Dla self-hosterów (społeczność Vaultwarden/homelab), którzy chcą passkeys + PRF unlock bez ciężkiego oficjalnego Bitwardena i bez czekania na niezmergowany PR Vaultwarden #5929.

**Core Value:** **Lekki self-hostable vault (1 kontener + wtyczka Chrome/Firefox), w którym passkeys działają w pełni: jako provider dla cudzych stron i jako PRF unlock własnego vaulta.** Jeśli wszystko inne zawiedzie, to musi działać.

### Constraints

- **Deployment**: 1 kontener Docker, SQLite na wolumenie — to pozycja rynkowa; żadnych wymaganych zewnętrznych usług (S3, Redis, itp.)
- **Tech stack**: Rust (axum + SQLx) na serwerze; pv-core współdzielony przez WASM z web/extension; Next.js 15 + Tailwind v4 + DaisyUI 5 na froncie — zdecydowane w docs/
- **Krypto**: prymitywy libsodium-style (Argon2id, XChaCha20-Poly1305, HKDF-SHA256, ES256); zero-knowledge bezwzględnie — serwer nigdy nie widzi PRF output, kluczy, plaintextu
- **Design**: estetyka datafa.st wg UI-DESIGN.md (tokeny OKLCH, DM Sans + Fuzzy Bubbles, 1px bordery); security UI zawsze czytelne — playfulness nigdy w dialogach bezpieczeństwa
- **Budżet/zespół**: solo indie — pragmatyczna kolejność platform (web → extension → mobile), bez enterprise scope creep

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- Rust (edition 2021) - Full server, cryptographic core, and WASM-compiled shared library
- TypeScript (planned) - Web app (Next.js) and browser extension UI
- SQL - SQLite schema with migrations
- Kotlin (planned) - Android credential provider service
- Swift (planned) - iOS credential provider ViewController

## Runtime

- Rust stable toolchain with WASM target (`wasm32-unknown-unknown`)
- Cargo (Rust)
- npm/pnpm (planned for web/extension frontends)
- `Cargo.lock` - present, pinned dependencies

## Frameworks

- **Axum** (0.8) - Web framework for REST API and WebSocket handlers
- **webauthn-rs** (0.5) - WebAuthn/FIDO2 relying party implementation
- **SQLx** (0.8) - Async SQL query builder and executor
- **Tokio** (1.0) - Async runtime
- **Tracing** (0.1) - Structured logging framework
- **Tracing-subscriber** (0.3) - Log formatting and filtering with `EnvFilter`
- **Tower-http** (0.6) - HTTP middleware including trace layer
- **Serde** (1.0) - Serialization/deserialization framework
- **Serde_json** (1.0) - JSON support
- **UUID** (1.0) - UUID v4 generation with serde support
- **Thiserror** (2.0) - Error handling with derive macros

## Key Dependencies

- **Argon2** (0.5) - KDF (key derivation function) — password hashing
- **ChaCha20-Poly1305** (0.10) - AEAD cipher (authenticated encryption)
- **HKDF** (0.12) - Key derivation via Hmac-based key derivation function (SHA-256)
- **SHA2** (0.10) - SHA-256 hashing for HKDF and passkey signatures
- **Zeroize** (1.0) - Secure memory wiping for sensitive data
- **Base64** (0.22) - Base64 encoding (salt storage, credential serialization)
- **Anyhow** (1.0) - Flexible error handling with context chains

## Configuration

- `PV_ADDR` - Server bind address (default: `127.0.0.1:8620`)
- `PV_DB_URL` - Database connection string (default: `sqlite://data/pv.db`)
- `RUST_LOG` - Tracing filter (default: `info`)
- Location: `crates/pv-server/src/config.rs`
- Method: `Config::from_env()` with sensible defaults
- Workspace resolver: `2` (Rust 1.64+)
- Workspace members: `["crates/pv-core", "crates/pv-server"]`
- Shared dependencies via `[workspace.dependencies]`
- Rust edition: 2021

## Platform Requirements

- Rust stable (toolchain file: `rust-toolchain.toml`)
- WASM target: `wasm32-unknown-unknown` (for client-side core compilation)
- SQLite development headers (for SQLx compile-time checking)
- Self-hosted Docker container (single container deployment)
- Database: SQLite (bundled, file-based) or PostgreSQL (external)
- Network: TCP listener on `PV_ADDR` for HTTP/WebSocket
- Single container: includes Rust server + Next.js static/SSR web app
- Data persistence: SQLite database file mapped to volume
- Optional: PostgreSQL for scalability

## Design Patterns

- `crates/pv-core` compiles to both:
- Zero-knowledge design: server never sees plaintext keys
- Memory safety: Zeroize all sensitive data
- **Server side:** Only encrypted blobs (`WrappedKey` structs)
- **Client side:** All decryption happens locally in WASM
- Keys managed per-item for efficient rotation and sharing

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- Module files: lowercase with snake_case (e.g., `keys.rs`, `kdf.rs`, `items.rs`, `error.rs`)
- Main entry: `main.rs`, `lib.rs`
- Submodules organized in directories (e.g., `routes/mod.rs`, `routes/auth.rs`)
- snake_case (e.g., `hkdf_expand_key`, `aead_seal`, `encrypt_item`, `decrypt_item`)
- Public functions have no special prefix
- Private/internal functions use `pub(crate)` visibility (e.g., `aead_seal`, `aead_open`)
- snake_case (e.g., `master_key`, `wrapping_key`, `plaintext`, `ciphertext`)
- Cryptographic material uses common abbreviations: `uk` (User Key), `mk` (Master Key), `wk` (wrapping key), `prf` (PRF output)
- UPPER_CASE (e.g., `KEY_LEN`, `NONCE_LEN`, `INFO_PW_UNLOCK`, `INFO_PRF_UNLOCK`)
- Domain separation constants are byte strings with version (e.g., `b"pv:pw-unlock:v1"`)
- PascalCase for structs (e.g., `UserKey`, `WrappedKey`, `KdfParams`, `CryptoError`, `AppState`)
- PascalCase for enums (e.g., `CryptoError`)
- Trait bounds use standard names (e.g., `Zeroize`, `ZeroizeOnDrop`, `Serialize`, `Deserialize`)
- Module names: lowercase snake_case (e.g., `pub mod error`, `pub mod keys`, `pub mod kdf`, `pub mod items`, `pub mod prf`)
- Test modules: always named `mod tests` and gated with `#[cfg(test)]`

## Code Style

- Uses Rust stable toolchain with default rustfmt settings (Edition 2021)
- No custom `.rustfmt.toml` or `rustfmt.config.toml` in repo — relies on project defaults
- 4-space indentation (Rust standard)
- Line length: implicit (follows common Rust practice of ~100 chars for readability)
- No explicit clippy configuration file (no `clippy.toml`)
- Assumes standard clippy rules from stable toolchain
- No `.editorconfig` or project-level linting configuration
- Module-level docs use `//!` at the top of files
- Comments mix Polish and English (project language is Polish)
- Complex concepts documented with ASCII diagrams (e.g., key hierarchy in `lib.rs`, flow diagrams in module docs)
- Inline comments use `//` for clarification on non-obvious logic
- Doc comments explain "why" not just "what"

## Import Organization

- No path aliases configured in workspace or crates
- Full module paths used throughout (e.g., `crate::keys::UserKey`)
- Relative imports within same crate use `crate::` prefix

## Error Handling

- Custom error enums for domain-specific errors (`CryptoError`)
- `anyhow::Result<T>` for top-level/operational errors (main.rs, config)
- Conversion between error types using `map_err()`

#[derive(Debug, Error)]

- Use `.map_err()` to convert error types
- Use `.context()` from `anyhow` to add operational context in server code
- Use `?` operator for error propagation
- Return meaningful error messages (not just generic variants)

## Logging

- Uses `tracing` crate for structured logging
- `tracing_subscriber` for initialization and filtering
- Configured via `EnvFilter::try_from_default_env()` with default level "info"
- Usage: `tracing::info!()`, `tracing::error!()`, `tracing::debug!()`

## Security Patterns

- Use `Zeroize` trait to clear sensitive data from memory
- Use `ZeroizeOnDrop` derive macro to automatically zeroize on drop
- Use `zeroize::Zeroizing<T>` wrapper for automatic cleanup

#[derive(Zeroize, ZeroizeOnDrop)]

## Function Design

- Small focused functions (most crypto functions are 3-15 lines)
- Larger functions break down into smaller helper functions
- Example: `decrypt_item()` in `items.rs` calls `aead_open()` internally
- Use byte arrays with fixed size where possible (e.g., `[u8; KEY_LEN]`)
- Use slices for variable-length inputs (e.g., `&[u8]`)
- Pass borrowed references by default
- Shared const definitions for magic numbers (`KEY_LEN`, `NONCE_LEN`, etc.)
- Custom result types for crypto operations: `Result<T, CryptoError>`
- Operational errors: `anyhow::Result<T>`
- Use `Ok(value)` and `Err(error)` consistently

## Module Design

- Use `pub` for public API, nothing for private
- Re-export important types from `lib.rs`: `pub use error::CryptoError;`
- `routes/mod.rs` collects all routes into a single router function
- Each route module (e.g., `auth.rs`) exports request/response types

## Dependency Management

- Defined in root `Cargo.toml` under `[workspace.dependencies]`
- Shared across crates via `.workspace = true`

## Comments and Documentation

- Complex cryptographic operations documented with references and assumptions
- Security-critical decisions explained (e.g., why memory is zeroized)
- Non-obvious implementation details (e.g., domain separation constant rationale)
- TODO items for incomplete/placeholder code (found in `auth.rs`)
- Marked clearly with `TODO:` comment
- Include context about when/how to address

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| AppState | Holds shared database connection pool | `crates/pv-server/src/main.rs` |
| Router | HTTP routing setup, middleware (tracing) | `crates/pv-server/src/routes/mod.rs` |
| Prelogin Handler | Returns KDF parameters and deterministic salt for user | `crates/pv-server/src/routes/auth.rs` |
| KDF Module | Argon2id password hashing, HKDF expansion, wrapping key derivation | `crates/pv-core/src/kdf.rs` |
| Keys Module | User Key generation, wrapping/unwrapping, AEAD sealing/opening | `crates/pv-core/src/keys.rs` |
| PRF Module | Converts WebAuthn PRF output to User Key wrapping key | `crates/pv-core/src/prf.rs` |
| Items Module | Per-item encryption/decryption with XChaCha20-Poly1305 | `crates/pv-core/src/items.rs` |
| Error Types | Domain-specific error enum for crypto failures | `crates/pv-core/src/error.rs` |

## Pattern Overview

- **Zero-knowledge design**: Server never sees plaintext or unwrapped User Key — only encrypted blobs (`WrappedKey`)
- **Multi-recipient key wrapping**: Same User Key wrapped independently by password and each enrolled passkey, enabling credential rotation without full re-encryption
- **WASM-compatible crypto**: `pv-core` compiles to WASM with no I/O, enabling code reuse across web app, extension, and future mobile clients
- **Type-safe crypto**: `Zeroize` and `ZeroizeOnDrop` traits automatically clear sensitive memory; wrapping key types enforce single-use intent

## Layers

- Purpose: HTTP endpoints, request/response marshaling, connection lifecycle
- Location: `crates/pv-server/src/routes/`
- Contains: Route handlers using axum extractors and middleware
- Depends on: pv-core for crypto operations, SQLx/AppState for data access
- Used by: Browser clients via REST/JSON, future WebSocket sync push
- Purpose: Key derivation, wrapping/unwrapping, authenticated encryption, PRF handling
- Location: `crates/pv-core/src/`
- Contains: `kdf.rs`, `keys.rs`, `prf.rs`, `items.rs`, `error.rs`
- Depends on: Standard crypto crates (argon2, chacha20poly1305, hkdf, sha2) — no I/O
- Used by: pv-server for authentication and key management; compiled to WASM for clients
- Purpose: Database connection, query execution, schema migrations
- Location: `crates/pv-server/migrations/`, AppState in `main.rs`
- Contains: SQLite connection pool, migration files (Flyway-style)
- Depends on: SQLx runtime (tokio async)
- Used by: Route handlers via `State(state).db`

## Data Flow

### Primary Request Path: Authentication / PRF Unlock

### Secondary Flow: Item Encryption

- **Client-side:** User Key is derived and held in memory; never persisted or sent to server
- **Server-side:** Only encrypted `WrappedKey` blobs in database; no plaintext or intermediate keys ever stored
- **Session:** Authenticated via WebAuthn assertion signature verification; token stored in `sessions` table with hashed token

## Key Abstractions

- Purpose: 256-bit random key that is the root of access to the vault
- Examples: `crates/pv-core/src/keys.rs:23-40` (struct, generate, from_bytes, expose)
- Pattern: Private inner bytes, `Zeroize + ZeroizeOnDrop` for automatic memory clearing; single `expose()` method signals key material access
- Invariant: Never leaves client in plaintext form
- Purpose: Encrypted blob (nonce + ciphertext) representing an encrypted key or data
- Examples: `crates/pv-core/src/keys.rs:44-47`; used in `pv-core/src/items.rs:31-35` for `EncryptedItem`
- Pattern: JSON-serializable struct with separate nonce and ciphertext fields; produced by `aead_seal()`, consumed by `aead_open()`
- Rationale: XChaCha20-Poly1305 requires unique 24-byte nonce per encryption; storing nonce with ciphertext enables decryption without server-side state
- Purpose: Per-item 256-bit encryption key, generated fresh for each vault item
- Examples: `crates/pv-core/src/items.rs:19-27`
- Pattern: Private struct (module-private), only accessible via encrypt/decrypt functions; automatically zeroized on drop
- Benefit: Enables fine-grained key rotation (rewrap N item keys on User Key rotation) vs. full re-encryption
- Purpose: Argon2id configuration stored per-user on server (public, transmitted to client)
- Examples: `crates/pv-core/src/kdf.rs:14-24`
- Pattern: Serializable struct with defaults matching OWASP recommendations (64 MiB, 3 iterations, 4 parallelism)

## Entry Points

- Location: `crates/pv-server/src/main.rs:14-45`
- Triggers: `cargo run -p pv-server`
- Responsibilities:
- Location: `crates/pv-server/src/routes/mod.rs:9`
- Route: `GET /healthz`
- Returns: `{ "status": "ok" }`
- Location: `crates/pv-server/src/routes/auth.rs:21-27`
- Route: `POST /api/auth/prelogin`
- Request: `{ "email": "user@example.com" }`
- Response: `{ "kdf": { "m_cost_kib": 65536, "t_cost": 3, "p_cost": 4 }, "salt": "..." }`
- Current Status: Stub — returns hardcoded defaults; TODO: lookup user in database

## Architectural Constraints

- **Threading:** Tokio multi-threaded async runtime (tokio::spawn, async/await blocks); SQLite connection pool with max 8 connections to handle concurrent requests without blocking
- **Global state:** `AppState` holds shared `SqlitePool`; connection pool itself is thread-safe (Arc-wrapped internally by sqlx)
- **Circular imports:** None detected (workspace uses clear module hierarchy: main.rs → routes → crypto → errors)
- **No I/O in pv-core:** Crypto crate has zero dependencies on tokio, sqlx, or network libraries — enables WASM compilation and client-side reuse
- **Secret handling:** Sensitive types use `Zeroize` trait; `Zeroizing<T>` wrapper for temporary buffers; DO NOT use `String` or `Vec<u8>` for keys/passwords
- **Domain separation:** All HKDF invocations use versioned INFO constants (`b"pv:pw-unlock:v1"`, `b"pv:prf-unlock:v1"`, etc.) to prevent key reuse across contexts

## Anti-Patterns

### Exposing User Key beyond Client

### Reusing Nonces in XChaCha20-Poly1305

### Mutable User Key References

### Missing AAD (Additional Authenticated Data)

## Error Handling

- Crypto errors are explicit: `CryptoError::Kdf`, `CryptoError::Encrypt`, `CryptoError::Decrypt`, `CryptoError::InvalidInput(msg)` — see `crates/pv-core/src/error.rs`
- Route handlers propagate errors via `?` operator; axum converts `Result` to HTTP response (default is 500)
- Database errors use `anyhow::Context` for error chaining (e.g., `.context("invalid PV_DB_URL")`) — see `crates/pv-server/src/main.rs:22-26`
- Sensitive data (e.g., User Key) is zeroized before returning error to prevent accidental leakage

## Cross-Cutting Concerns

- Crypto layer validates input lengths (salt ≥ 16 bytes, PRF output ≥ 32 bytes) — see `crates/pv-core/src/kdf.rs:32-37` and `crates/pv-core/src/prf.rs:24-26`
- Nonce length validated before decryption — `crates/pv-core/src/keys.rs:76-78`
- Route handlers TODO: Add email format and body validation
- Password-based: Client sends hash derived from master password + salt; server verifies against stored `pw_wrapped_uk` (TODO: implement)
- Passkey-based: WebAuthn assertion verified via `webauthn-rs` (TODO: implement verification handler)
- Session tokens stored in `sessions` table with hash and expiry; TODO: implement session middleware

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
