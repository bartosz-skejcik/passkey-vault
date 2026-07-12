# External Integrations

**Analysis Date:** 2026-07-12

## APIs & External Services

**WebAuthn (FIDO2):**
- **Service:** W3C WebAuthn standard (browser/OS platform authenticators)
- **Purpose:** Passkey registration and authentication for users
- **SDK/Client:** `webauthn-rs` (0.5)
- **Flows:**
  - Passkey provider: Extension patches `navigator.credentials.create/get`
  - Authenticator emulation: Passkey-rs (WASM) with hmac-secret/PRF support
  - Server verification: `webauthn-rs` validates assertions

**PRF (Pseudo-Random Function):**
- **Service:** WebAuthn hmac-secret extension (Chromium-first, fallback to password)
- **Purpose:** Derive key material from passkey for vault unlock without server seeing PRF output
- **Implementation:** Client-side HKDF expansion of 32B PRF output
- **Location:** `crates/pv-core/src/prf.rs`

**Breach Monitoring (Planned):**
- **Service:** Have I Been Pwned (HIBP) k-anonymity API
- **Purpose:** Passive password breach detection
- **Approach:** Cron job with k-anonymity (never send full password hash)
- **Status:** Not yet implemented (v1 scope)

**Email Masking (Planned):**
- **Service:** SimpleLogin or Addy.io (self-hosted option)
- **Purpose:** Masked email addresses for vault login fields
- **Status:** Not yet implemented (v1 scope); design note in `docs/ARCHITECTURE.md`

## Data Storage

**Databases:**

**SQLite (Default):**
- **Type:** File-based relational database
- **Connection:** `sqlite://data/pv.db` (configurable via `PV_DB_URL`)
- **Client:** SQLx async query builder
- **Schema:** `crates/pv-server/migrations/0001_init.sql`
- **Tables:**
  - `users` - User accounts with email, KDF parameters, password-wrapped User Key
  - `webauthn_credentials` - Passkey registrations with PRF salt and wrapped User Key
  - `folders` - User folder hierarchy
  - `vault_items` - Encrypted vault entries (logins, passkeys, cards, notes, TOTP)
  - `sessions` - Session tokens with expiry

**PostgreSQL (Optional):**
- **Type:** Full-featured relational database
- **Purpose:** Production scaling option
- **Client:** SQLx (same code, different connection string)
- **Status:** Supported by SQLx but no PostgreSQL-specific migrations yet

**File Storage:**
- **Status:** Not yet implemented
- **Planned:** Encrypted file attachments (local disk or S3)

**Caching:**
- **Status:** Not implemented
- **Note:** All data served directly from database via SQLx queries

## Authentication & Identity

**User Authentication:**
- **Type:** Multi-recipient key hierarchy
- **Recipients:** Master password (Argon2id-derived) + enrolled passkeys (PRF-derived)
- **Implementation:** `crates/pv-core/src/kdf.rs` (password path), `crates/pv-core/src/prf.rs` (passkey path)
- **KDF Algorithm:** Argon2id with configurable params (default: 64 MiB, 3 iterations, 4 lanes)
- **Recovery:** Master password always required as recovery path

**Session Management:**
- **Tokens:** Hash-based session tokens stored in `sessions` table
- **Expiry:** Configurable per-session (schema allows `expires_at`)
- **Invalidation:** ON DELETE CASCADE via user_id foreign key

**Passkey Provider (Planned):**
- **Platforms:**
  - Browser extension (WXT, MV3): MAIN-world patch to `navigator.credentials`
  - Android: `CredentialProviderService`
  - iOS: `ASCredentialProviderViewController`
- **Authentication:** hmac-secret extension (Chromium) or password fallback
- **Server Role:** Verify WebAuthn assertions via `webauthn-rs`

## Monitoring & Observability

**Error Tracking:**
- **Status:** Not implemented
- **Note:** Error types defined in `crates/pv-core/src/error.rs` (CryptoError enum)

**Logging:**
- **Framework:** Tracing + Tracing-subscriber
- **Output:** Stdout (structured, JSON-capable)
- **Filter:** `EnvFilter` from `RUST_LOG` environment variable (default: `info`)
- **HTTP Traces:** `TraceLayer` from tower-http for request/response visibility
- **Location:** `crates/pv-server/src/main.rs` (tracing initialization)

**Metrics:**
- **Status:** Not implemented
- **Note:** Infrastructure for adding metrics via tracing/tower exists

## CI/CD & Deployment

**Hosting:**
- **Target:** Self-hosted Docker container (single container deployment)
- **Status:** Dockerfile not yet created; deployment patterns TBD

**CI Pipeline:**
- **Status:** Not configured
- **Typical flow (not implemented):** cargo check → cargo build → migrate database → serve

**Build Process:**
- **Rust compilation:** Cargo to ELF binary
- **WASM compilation:** `wasm32-unknown-unknown` target for `crates/pv-core` (web/extension)
- **Database migrations:** SQLx compile-time validation + runtime `sqlx migrate!()` execution

## Environment Configuration

**Required Environment Variables:**
- `PV_ADDR` - Server bind address (default: `127.0.0.1:8620`)
- `PV_DB_URL` - Database connection string (default: `sqlite://data/pv.db`)

**Optional Environment Variables:**
- `RUST_LOG` - Tracing filter level (default: `info`)

**Secrets Handling:**
- **Status:** No `.env` files present or secrets stored
- **Current approach:** All config via environment variables
- **Server secrets:** Database credentials embedded in `PV_DB_URL`; no API keys yet

**Database Migrations:**
- **Framework:** SQLx migrations
- **Location:** `crates/pv-server/migrations/`
- **Executed at startup:** `sqlx::migrate!("./migrations").run(&db).await`
- **Auto-creation:** SQLite auto-creates database if missing (`create_if_missing(true)`)

## Webhooks & Callbacks

**Incoming Webhooks:**
- **Status:** Not implemented
- **Potential use cases:** User invitations, account recovery links (v2)

**Outgoing Webhooks:**
- **Status:** Not implemented
- **Potential use cases:** Breach notifications, sync to other services

**WebSocket (Planned):**
- **Purpose:** Real-time vault sync push notifications
- **Status:** Not yet implemented (mentioned in docs/ARCHITECTURE.md as "sync push via WS")

## External Data Sources

**Configuration Files Read:**
- `rust-toolchain.toml` - Specifies stable Rust and WASM target

**No External APIs Consumed Currently:**
- HIBP API planned but not integrated
- SimpleLogin/Addy integration planned but not implemented
- All cryptography is local (no external key services)

## Deployment Model

**Docker:**
- **Image:** Rust binary + Next.js static app (planned as single image)
- **Volumes:** Database file (`data/pv.db` or PostgreSQL connection)
- **Ports:** Single port for HTTP/WebSocket (default `8620`)
- **Environment:** `PV_ADDR`, `PV_DB_URL`, `RUST_LOG`

**Database Setup:**
1. Connection pool: 8 max connections (hardcoded in `main.rs`)
2. Automatic migration: Schema created on first startup
3. Persistent storage: SQLite file or PostgreSQL database

---

*Integration audit: 2026-07-12*
