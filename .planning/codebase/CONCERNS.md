# Codebase Concerns

**Analysis Date:** 2026-07-12

## Tech Debt

**Incomplete Authentication Implementation:**
- Issue: Core auth endpoints are stubbed with TODO comments; user lookup and KDF parameter retrieval not yet implemented
- Files: `crates/pv-server/src/routes/auth.rs`
- Impact: Cannot actually authenticate users; the `/api/auth/prelogin` endpoint returns hardcoded default KDF parameters instead of querying the database
- Fix approach: Implement `users` table queries in prelogin handler; retrieve per-user `kdf_params` and `kdf_salt` from database; verify salt generation strategy (currently deterministic to prevent account enumeration, but needs testing)

**Stub Routes Without Business Logic:**
- Issue: All other auth routes missing (password-based login, WebAuthn options/verification); CRUD endpoints for items/folders not implemented; sync endpoints absent
- Files: `crates/pv-server/src/routes/auth.rs`, `crates/pv-server/src/routes/mod.rs`
- Impact: No way to register users, log in with password, perform PRF unlock, or retrieve vault items; only a healthz endpoint works
- Fix approach: Implement complete auth flow (`POST /auth/login` for password, `POST /auth/webauthn/options` and `POST /auth/webauthn/verify` for WebAuthn); wire up database queries; implement session management

**PRF Unlock Not Implemented:**
- Issue: ARCHITECTURE.md designates "PRF vault unlock as first-class feature" but no server endpoints or client logic exists
- Files: `crates/pv-core/src/prf.rs` (exists but unused), `crates/pv-server/src/routes/` (no PRF endpoints)
- Impact: Passkey unlock via WebAuthn PRF extension cannot work; users can only unlock with master password
- Fix approach: Add `/auth/webauthn/prf-options` and `/auth/webauthn/prf-verify` endpoints; integrate webauthn-rs credential verification; test hmac-secret extension flow per passkey-rs documentation

**Database Schema Exists But Unused:**
- Issue: Migrations define users, webauthn_credentials, folders, vault_items, sessions tables, but server code doesn't query them
- Files: `crates/pv-server/migrations/0001_init.sql`, `crates/pv-server/src/routes/auth.rs`
- Impact: Database is initialized but not populated or read; authentication always fails or returns dummy data
- Fix approach: Add database queries to all auth handlers; implement CRUD operations; test migration rollup

## Missing Critical Features

**Vault CRUD Operations:**
- Problem: No endpoints to retrieve, create, update, or delete vault items
- Files: `crates/pv-server/src/routes/` (entire routes module)
- Blocks: Users cannot add passwords/passphrases; vault remains empty even if authentication works

**Sync Endpoint:**
- Problem: Architecture mentions revision-based sync and WebSocket push, but no implementation
- Blocks: Multi-device sync cannot function; changes on one device don't propagate

**Sharing & Breach Monitoring:**
- Problem: ARCHITECTURE.md v0.1 roadmap lists sharing, breach monitor, attachments as v0.2–v0.3; not yet started
- Priority: Low for MVP, but blocks certain v1.0 features

## Security Considerations

**Account Enumeration Prevention - Partially Implemented:**
- Risk: Prelogin endpoint could leak whether an account exists by returning different responses for valid/invalid emails
- Files: `crates/pv-server/src/routes/auth.rs:15–17`
- Current mitigation: Returns deterministic salt for non-existent accounts to prevent enumeration; comment indicates this pattern is intentional
- Recommendations: (1) Write test to verify deterministic salt is stable across calls for same email; (2) Add rate limiting to `/auth/prelogin` to prevent brute-force enumeration; (3) Document why salt is predictable and validate this doesn't weaken KDF

**No Rate Limiting:**
- Risk: Endpoints `/auth/prelogin`, `/auth/login`, `/auth/webauthn/verify` can be brute-forced without throttling
- Files: `crates/pv-server/src/routes/` (all endpoints)
- Current mitigation: None
- Recommendations: Integrate tower-http rate limit middleware or equivalent; apply per-IP limits on sensitive endpoints

**No HTTPS Enforcement:**
- Risk: Default bind address `127.0.0.1:8620` and no visible HTTPS setup means unencrypted communication possible in production
- Files: `crates/pv-server/src/config.rs:11`
- Current mitigation: None
- Recommendations: Document reverse proxy requirement (nginx/traefik) for HTTPS in deployment; consider adding a non-localhost default check with warning

**Crypto Error Messages:**
- Risk: `CryptoError::Decrypt` returns generic message; leaks existence of decryption failures but not key material (good)
- Files: `crates/pv-core/src/error.rs:8`
- Current mitigation: Generic error message "decryption failed (wrong key or corrupted data)"
- Recommendations: Ensure HTTP endpoints do not leak whether failure is authentication vs. corrupted data; test 401 vs. 500 response codes

**Passkey Deletion Footgun:**
- Risk: ARCHITECTURE.md §4 and prf.rs:8 document: "usunięcie passkeya niszczy wyprowadzany klucz — User Key MUSI być zawsze wrapowany również pod master password"
- Files: `crates/pv-core/src/prf.rs:8`, `docs/ARCHITECTURE.md:86`
- Current mitigation: Design comment present; schema supports `pw_wrapped_uk` alongside `prf_wrapped_uk`
- Recommendations: Enforce in application logic (prevent deletion of last passkey if no password recovery is set); add test covering this scenario

## Performance Bottlenecks

**Argon2id Parameters at Default:**
- Problem: `KdfParams::default()` sets 64 MiB, 3 iterations, 4 parallelism (OWASP-compliant but high-memory)
- Files: `crates/pv-core/src/kdf.rs:20–24`
- Cause: Memory-hard KDF is expensive; may be slow on resource-constrained servers or under high load
- Improvement path: Profile KDF latency; consider making parameters tunable per-user or instance; add caching of derived keys where safe (never in logs)

**No Connection Pooling Configuration:**
- Problem: SQLite pool defaults to max 8 connections; no configuration visible for production tuning
- Files: `crates/pv-server/src/main.rs:27–28`
- Cause: Hardcoded pool size may be insufficient under load
- Improvement path: Make pool size configurable via env var; document recommended values for SQLite vs. PostgreSQL

## Fragile Areas

**Auth Flow Stub:**
- Files: `crates/pv-server/src/routes/auth.rs`
- Why fragile: Returns hardcoded `KdfParams::default()` and empty salt; any change to default params requires code changes, not database migration
- Safe modification: Implement database queries before adding any new auth features; add integration test that exercises full auth flow end-to-end
- Test coverage: No server-side tests exist for auth handlers; only pv-core unit tests

**Webauthn Credential Verification:**
- Files: `crates/pv-server/src/` (not yet implemented)
- Why fragile: `webauthn-rs` dependency is present but completely unused; when integrated, will handle complex credential verification, cloning detection, sign count tracking
- Safe modification: Add webauthn module; write extensive tests for credential registration and assertion verification; reference webauthn-rs examples
- Test coverage: Gap — no tests for WebAuthn flows

**PRF Integration:**
- Files: `crates/pv-core/src/prf.rs` (working unit tests) vs. `crates/pv-server/src/` (no integration)
- Why fragile: prf.rs expects PRF output as bytes; server must extract from WebAuthn PRF extension, pass to core, then verify assertion on server side; multiple points of failure
- Safe modification: Add end-to-end test covering WebAuthn credential with PRF extension → server verification → user unlock
- Test coverage: Gap — no integration or server tests

## Test Coverage Gaps

**No Server Endpoint Tests:**
- What's not tested: All HTTP endpoints (healthz works, but prelogin never tested; other endpoints don't exist)
- Files: `crates/pv-server/src/routes/` (entire module)
- Risk: Endpoints can be broken without detection; logic errors in database queries will not be caught
- Priority: High — should have integration tests before shipping any auth flow

**No Database Integration Tests:**
- What's not tested: Migration correctness, foreign key constraints, user creation/query flow
- Files: `crates/pv-server/migrations/0001_init.sql`, `crates/pv-server/src/` (all database-touching code)
- Risk: Schema mismatches or migration failures only caught in production
- Priority: High — add tests using test database (sqlite in-memory or ephemeral)

**No WebAuthn Flow Tests:**
- What's not tested: Credential registration, assertion verification, PRF extension handling, sign count tracking, cloning detection
- Files: `crates/pv-server/src/` (not yet implemented)
- Risk: Critical security path untested
- Priority: High — implement before merging any WebAuthn code

**Minimal Crypto Tests:**
- What's not tested: Key hierarchy end-to-end (password → master key → user key → item key); multi-recipient wrapping/unwrapping under adversarial conditions
- Files: `crates/pv-core/src/keys.rs:109–129` (only happy-path tests), `crates/pv-core/src/items.rs:58–76`
- Risk: Cryptographic bugs (e.g., zeroization failures, nonce reuse, format confusion) can persist
- Priority: Medium — add adversarial tests (wrong key, tampered blob, truncated nonce); add property-based tests (roundtrip under random inputs)

**No Config Validation Tests:**
- What's not tested: Invalid database URLs, missing required env vars, malformed bind addresses
- Files: `crates/pv-server/src/config.rs:8–15`
- Risk: Silent failures or crashes during startup in production
- Priority: Low — add tests for error cases

## Known Bugs

**Prelogin Returns Empty Salt:**
- Symptoms: `prelogin()` handler returns `salt: String::new()` (empty string)
- Files: `crates/pv-server/src/routes/auth.rs:26`
- Trigger: Call `POST /api/auth/prelogin` with any email
- Workaround: Client must generate its own salt (breaks account enumeration mitigation); user cannot log in
- Notes: Schema supports per-user `kdf_salt` (BLOB, NOT NULL); seed this in user creation and return in prelogin

**Prelogin KDF Params Are Defaults:**
- Symptoms: All users receive same KDF params (64 MiB, 3 iterations, 4 parallelism) regardless of registration time or preferences
- Files: `crates/pv-server/src/routes/auth.rs:26`
- Trigger: Call `POST /api/auth/prelogin`
- Workaround: None (hardcoded); all users pay same memory cost
- Notes: Allows per-user tuning later but not used now

## Dependencies at Risk

**webauthn-rs 0.5.x — Future Upgrade Path Uncertain:**
- Risk: webauthn-rs 0.5.x will eventually reach EOL; WebAuthn spec evolves (conditional UI, multi-device transports, passkey attestation format changes)
- Impact: May need major version bump for spec compliance; breaking API changes likely
- Migration plan: Monitor webauthn-rs changelog; budget upgrade time before EOL; test thoroughly with real passkey devices

**passkey-rs (1Password) — Single Maintainer Risk:**
- Risk: Crate documentation shows PRF support exists (`extensions/hmac_secret.rs`) but is lightly tested in open source
- Impact: PRF unlock may have edge cases (different browser versions, authenticators, attestation formats)
- Migration plan: Run extensive PRF tests across browsers/devices before shipping; monitor GitHub issues; consider external audit if PRF unlock is critical feature

**sqlite + SQLx — Dialect Lock-In:**
- Risk: Schema is SQLite-specific (AUTO INCREMENT, default datetime('now')); migration to PostgreSQL requires careful scripting
- Impact: Multi-tenant deployments may require PostgreSQL; switching costs time
- Migration plan: ARCHITECTURE.md already notes this; keep PostgreSQL compatibility in mind during schema design; use SQLx compile-time checks to catch SQL errors early

## Scaling Limits

**SQLite Single-File Database:**
- Current capacity: One connection per user; 8 connection pool → ~8 concurrent users
- Limit: SQLite lacks row-level locking; concurrent writes can block readers
- Scaling path: Default to PostgreSQL for production; migration documented in ARCHITECTURE.md; consider connection pooling middleware (PgBouncer)

**Argon2id Memory Per User:**
- Current capacity: 64 MiB per KDF operation; 8 concurrent users = 512 MiB peak
- Limit: Memory-hard KDF scales with user count; high-volume login spikes cause OOM risk
- Scaling path: Implement KDF result caching (with key derivation rotation); consider rate limiting to spread load; tune Argon2 params for production instance size

**Nonce Uniqueness (AEAD):**
- Current capacity: XChaCha20 uses 24-byte nonce; 2^192 nonces per key before reuse risk
- Limit: Per-key encryption of unlimited items with unique nonces is safe; re-key strategy needed if key lifetime exceeds 2^100 encryptions (per crypto best practice)
- Scaling path: Implement key rotation policy; document when to rotate User Key and per-item keys; monitor key age in telemetry (future)

## Architectural Constraints

**Threading Model:**
- Single-threaded event loop (Tokio); multi-threaded runtime spawned with `tokio::main`
- Worker threads used for: Database operations (SQLx), system I/O (TcpListener)
- Constraint: Argon2id (CPU-bound) runs on Tokio thread; high-memory KDF can block other tasks
- Mitigation: Consider `tokio::task::spawn_blocking` wrapper for CPU-heavy KDF if contention observed

**Global State:**
- `AppState { db: SqlitePool }` is cloned per request (cheap); no shared mutable state observed
- Constraint: Pool size is global (8 connections); no per-tenant limits
- Mitigation: Good design; no known race conditions

**Module-Level Singletons:**
- RNG (`OsRng`) in cryptographic functions is thread-safe (Rust's rand crate)
- Tracing subscriber initialized once at startup; no dynamic reconfiguration
- Constraint: No hot-reload of logging config

## Anti-Patterns

### Hardcoded Defaults in Business Logic

**What happens:** `prelogin()` returns `KdfParams::default()` and empty salt instead of querying database
**Why it's wrong:** Blocks user registration flow; makes database schema unused; prevents per-user KDF tuning; testing is easier but production is broken
**Do this instead:** Load `kdf_params` and `kdf_salt` from `users` table by email; return 404 with fake salt if user not found (account enumeration prevention)

### TODO Comments Without Context

**What happens:** Two TODO comments in auth.rs reference registration flow ("TODO przy implementacji rejestracji") without linking to issue tracker or roadmap
**Why it's wrong:** Context is lost; future maintainers won't know priority or acceptance criteria; blocks feature flagging
**Do this instead:** Replace with GitHub issue numbers (`TODO: see #123 — implement user registration with email verification`); add to project roadmap document

### Unused Dependencies

**What happens:** `webauthn-rs 0.5` is in Cargo.lock but not imported or used; same with `tower-http::trace`
**Why it's wrong:** Increases binary size and dependency audit surface without benefit; makes it unclear when integration begins
**Do this instead:** Add `#[allow(unused)]` if intentionally deferred, or document the implementation phase; create GitHub issue for "integrate webauthn-rs" and move TODO there

---

*Concerns audit: 2026-07-12*
