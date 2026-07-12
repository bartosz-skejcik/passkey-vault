<!-- refreshed: 2026-07-12 -->
# Architecture

**Analysis Date:** 2026-07-12

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                    Client Layer                              │
│  (Web App + Extension + Mobile — Future)                    │
│  crypto: pv-core compiled to WASM                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ REST/JSON + WebSocket
┌──────────────────────────┴──────────────────────────────────┐
│                  API Layer (axum)                            │
│  routes/auth.rs - WebAuthn + PRF unlock                     │
│  routes/mod.rs - Router, healthz endpoint                   │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│             Crypto & Business Logic Layer                    │
│  pv-core: key hierarchy, KDF, PRF, encryption               │
│  • kdf.rs - Password derivation (Argon2id + HKDF)           │
│  • keys.rs - User Key wrapping, domain separation           │
│  • prf.rs - PRF result → wrapping key                       │
│  • items.rs - Per-item encryption (XChaCha20-Poly1305)      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────┴──────────────────────────────────┐
│           Data Access Layer (SQLx + SQLite)                  │
│  Migrations: 0001_init.sql                                   │
│  Connection pool: AppState.db (8 connections max)            │
└─────────────────────────────────────────────────────────────┘
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

**Overall:** Layered architecture with clear separation between HTTP boundary (axum), business logic (pv-core crypto), and persistence (SQLx + SQLite).

**Key Characteristics:**
- **Zero-knowledge design**: Server never sees plaintext or unwrapped User Key — only encrypted blobs (`WrappedKey`)
- **Multi-recipient key wrapping**: Same User Key wrapped independently by password and each enrolled passkey, enabling credential rotation without full re-encryption
- **WASM-compatible crypto**: `pv-core` compiles to WASM with no I/O, enabling code reuse across web app, extension, and future mobile clients
- **Type-safe crypto**: `Zeroize` and `ZeroizeOnDrop` traits automatically clear sensitive memory; wrapping key types enforce single-use intent

## Layers

**Presentation / API Layer:**
- Purpose: HTTP endpoints, request/response marshaling, connection lifecycle
- Location: `crates/pv-server/src/routes/`
- Contains: Route handlers using axum extractors and middleware
- Depends on: pv-core for crypto operations, SQLx/AppState for data access
- Used by: Browser clients via REST/JSON, future WebSocket sync push

**Crypto Core Layer:**
- Purpose: Key derivation, wrapping/unwrapping, authenticated encryption, PRF handling
- Location: `crates/pv-core/src/`
- Contains: `kdf.rs`, `keys.rs`, `prf.rs`, `items.rs`, `error.rs`
- Depends on: Standard crypto crates (argon2, chacha20poly1305, hkdf, sha2) — no I/O
- Used by: pv-server for authentication and key management; compiled to WASM for clients

**Data Persistence Layer:**
- Purpose: Database connection, query execution, schema migrations
- Location: `crates/pv-server/migrations/`, AppState in `main.rs`
- Contains: SQLite connection pool, migration files (Flyway-style)
- Depends on: SQLx runtime (tokio async)
- Used by: Route handlers via `State(state).db`

## Data Flow

### Primary Request Path: Authentication / PRF Unlock

1. **Client initiates login:** `POST /api/auth/prelogin` with email (`crates/pv-server/src/routes/auth.rs:21`)
2. **Server looks up user** (TODO: implement lookup) and returns `KdfParams` (OWASP-recommended Argon2id settings) and KDF salt — both stored in `users` table (`crates/pv-server/migrations/0001_init.sql:5-12`)
3. **Client derives wrapping key:**
   - For password path: `password → Argon2id(salt, params) → master_key → HKDF-expand(INFO_PW_UNLOCK) → wrapping_key` (`crates/pv-core/src/kdf.rs:50-56`)
   - For passkey/PRF path: `prf_output (32 bytes) → HKDF-expand(INFO_PRF_UNLOCK) → wrapping_key` (`crates/pv-core/src/prf.rs:21-27`)
4. **Client unwraps User Key:** `wrapping_key → decrypt(blob_pw or blob_pkN) → User Key` (`crates/pv-core/src/keys.rs:93-105`)
5. **Client decrypts vault:** `User Key → decrypt per-item blobs → vault accessible locally` (`crates/pv-core/src/items.rs:45-56`)

### Secondary Flow: Item Encryption

1. **On create/update:** Client calls `encrypt_item(User Key, plaintext)` (`crates/pv-core/src/items.rs:38-42`)
2. **Item encryption process:**
   - Generate random per-item Cipher Key
   - Seal Cipher Key under User Key with AAD = "pv:item-key:v1" → `enc_key` blob
   - Seal plaintext (JSON) under Cipher Key with AAD = "pv:item-data:v1" → `enc_data` blob
3. **Blobs sent to server:** `EncryptedItem { enc_key, enc_data }` stored in `vault_items` table
4. **On retrieve:** `decrypt_item(User Key, item)` reverses: unlock Cipher Key, then decrypt payload

**State Management:**
- **Client-side:** User Key is derived and held in memory; never persisted or sent to server
- **Server-side:** Only encrypted `WrappedKey` blobs in database; no plaintext or intermediate keys ever stored
- **Session:** Authenticated via WebAuthn assertion signature verification; token stored in `sessions` table with hashed token

## Key Abstractions

**UserKey:**
- Purpose: 256-bit random key that is the root of access to the vault
- Examples: `crates/pv-core/src/keys.rs:23-40` (struct, generate, from_bytes, expose)
- Pattern: Private inner bytes, `Zeroize + ZeroizeOnDrop` for automatic memory clearing; single `expose()` method signals key material access
- Invariant: Never leaves client in plaintext form

**WrappedKey:**
- Purpose: Encrypted blob (nonce + ciphertext) representing an encrypted key or data
- Examples: `crates/pv-core/src/keys.rs:44-47`; used in `pv-core/src/items.rs:31-35` for `EncryptedItem`
- Pattern: JSON-serializable struct with separate nonce and ciphertext fields; produced by `aead_seal()`, consumed by `aead_open()`
- Rationale: XChaCha20-Poly1305 requires unique 24-byte nonce per encryption; storing nonce with ciphertext enables decryption without server-side state

**ItemKey:**
- Purpose: Per-item 256-bit encryption key, generated fresh for each vault item
- Examples: `crates/pv-core/src/items.rs:19-27`
- Pattern: Private struct (module-private), only accessible via encrypt/decrypt functions; automatically zeroized on drop
- Benefit: Enables fine-grained key rotation (rewrap N item keys on User Key rotation) vs. full re-encryption

**KdfParams:**
- Purpose: Argon2id configuration stored per-user on server (public, transmitted to client)
- Examples: `crates/pv-core/src/kdf.rs:14-24`
- Pattern: Serializable struct with defaults matching OWASP recommendations (64 MiB, 3 iterations, 4 parallelism)

## Entry Points

**Server Main:**
- Location: `crates/pv-server/src/main.rs:14-45`
- Triggers: `cargo run -p pv-server`
- Responsibilities:
  - Parse config from env vars (`PV_ADDR`, `PV_DB_URL`)
  - Initialize tracing/logging with env filter
  - Connect to SQLite, run migrations
  - Start axum server with graceful shutdown on CTRL+C

**Health Check:**
- Location: `crates/pv-server/src/routes/mod.rs:9`
- Route: `GET /healthz`
- Returns: `{ "status": "ok" }`

**Prelogin Endpoint:**
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

**What happens:** If User Key ever leaves the client in plaintext form (sent to server, logged, or stored), the zero-knowledge property is violated.

**Why it's wrong:** Server compromise becomes a complete vault compromise; defeats the entire security model.

**Do this instead:** Client derives User Key locally from KDF output or PRF result; only encrypted `WrappedKey` blobs are transmitted. See `crates/pv-core/src/keys.rs:93-105` for correct unwrapping pattern (stays in client memory).

### Reusing Nonces in XChaCha20-Poly1305

**What happens:** If the same key-nonce pair is used to encrypt two different plaintexts, an attacker can recover plaintext via nonce reuse attacks.

**Why it's wrong:** XChaCha20-Poly1305 security depends on unique nonces per key; reuse leaks keystream.

**Do this instead:** Generate fresh random nonce for every encryption via `OsRng.fill_bytes()`. See `crates/pv-core/src/keys.rs:63-64` and always store nonce with ciphertext. Current pattern in `aead_seal()` is correct.

### Mutable User Key References

**What happens:** If User Key is borrowed as `&mut`, accumulator code could modify it in place, violating the assumption that User Key is constant throughout a session.

**Why it's wrong:** Mutation allows for accidental key corruption or cryptographic confusion.

**Do this instead:** Keep `UserKey.expose()` as `&[u8; KEY_LEN]` (immutable). If intermediate key material must be modified (e.g., during hashing), use temporary `Zeroizing<Vec<u8>>` buffers — see `crates/pv-core/src/items.rs:46-54`.

### Missing AAD (Additional Authenticated Data)

**What happens:** If ciphertext is encrypted without AAD, an attacker can swap ciphertexts from one context to another (e.g., swap `enc_key` and `enc_data` blobs in an item).

**Why it's wrong:** AEAD provides integrity for both ciphertext AND associated data; omitting AAD loses this protection.

**Do this instead:** Always include context-specific AAD when sealing. Examples: `aead_seal(key, plaintext, b"pv:item-key:v1")` vs. `aead_seal(key, plaintext, b"pv:item-data:v1")`. See `crates/pv-core/src/items.rs:15-16` and `crates/pv-core/src/keys.rs:90`.

## Error Handling

**Strategy:** Result-based error propagation using `CryptoError` enum for crypto operations and `anyhow::Result` for application-level failures.

**Patterns:**
- Crypto errors are explicit: `CryptoError::Kdf`, `CryptoError::Encrypt`, `CryptoError::Decrypt`, `CryptoError::InvalidInput(msg)` — see `crates/pv-core/src/error.rs`
- Route handlers propagate errors via `?` operator; axum converts `Result` to HTTP response (default is 500)
- Database errors use `anyhow::Context` for error chaining (e.g., `.context("invalid PV_DB_URL")`) — see `crates/pv-server/src/main.rs:22-26`
- Sensitive data (e.g., User Key) is zeroized before returning error to prevent accidental leakage

## Cross-Cutting Concerns

**Logging:** Configured via tracing + tracing_subscriber; env var `RUST_LOG` controls level (default "info"). HTTP requests traced via `tower_http::trace::TraceLayer` middleware.

**Validation:** 
- Crypto layer validates input lengths (salt ≥ 16 bytes, PRF output ≥ 32 bytes) — see `crates/pv-core/src/kdf.rs:32-37` and `crates/pv-core/src/prf.rs:24-26`
- Nonce length validated before decryption — `crates/pv-core/src/keys.rs:76-78`
- Route handlers TODO: Add email format and body validation

**Authentication:** 
- Password-based: Client sends hash derived from master password + salt; server verifies against stored `pw_wrapped_uk` (TODO: implement)
- Passkey-based: WebAuthn assertion verified via `webauthn-rs` (TODO: implement verification handler)
- Session tokens stored in `sessions` table with hash and expiry; TODO: implement session middleware

---

*Architecture analysis: 2026-07-12*
