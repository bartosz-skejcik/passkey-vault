# Phase 2: Password Auth & Vault Core - Research

**Researched:** 2026-07-12
**Domain:** Password-authenticated session server (axum/SQLx/SQLite), zero-knowledge vault CRUD with AEAD identity binding, and a static-export Next.js vault UI (search, generator, clipboard, i18n, auto-lock)
**Confidence:** MEDIUM overall — HIGH for the Rust/crypto extension work (verified against the actual codebase), MEDIUM for web-ecosystem findings (cross-checked WebSearch, no Context7/MCP docs provider available in this environment), LOW→confirmed for the one item that needed a targeted follow-up (SQLite in-memory pool test gotcha).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Auth & Session Model (Claude's Discretion — user delegated: "too advanced for me, you make the decision")**
- Login verification: Bitwarden-style hash-po-KDF. One client-side Argon2id(password, salt); HKDF-split into the existing wrapping key (`pv:pw-unlock:v1`) and a new domain-separated auth hash (`pv:auth-hash:v1`). Server stores only a cheap re-hash of the auth hash; password and wrapping key never leave the client.
- Sessions: opaque random 256-bit Bearer token, stored hashed in the existing `sessions` table with expiry. No JWT.
- Registration: single `POST /api/auth/register` carrying email, KDF params, salt, auth hash, and pw-wrapped User Key. No email verification in v0.1 (self-hosted).
- Auto-lock (AUTH-08): client-side idle timer, default 15 min, configurable. Lock frees the WASM UK handle only — session token survives; lock ≠ logout (satisfies AUTH-02's visibly distinct states).

**Vault Data Model & API (accepted)**
- Server stores per item only `{id, user_id, enc_item_key (UK-wrapped), blob (nonce+ciphertext), revision, created, updated}` — item type, name, tags live inside the ciphertext. Folders are their own encrypted records (Bitwarden pattern). No plaintext `type` or `folder_id` columns.
- AEAD associated data: `"pv:item:v1" ‖ item_id ‖ revision` (blocks blob-swap and revision rollback). Server increments revision on PUT. A test mutates the AD and asserts decryption is rejected, not silently accepted (VAULT-02 success criterion).
- API: REST on encrypted blobs — `GET/POST /api/vault/items`, `PUT/DELETE /api/vault/items/:id`; PUT carries expected revision, 409 on mismatch (optimistic concurrency).
- Crypto: reuse pv-core `items.rs` per-item Cipher Key, extended with an AD parameter; new pv-wasm exports follow Phase 1's opaque-handle pattern. No new crypto paths outside pv-core.

**Vault UX (accepted)**
- Layout: list + side detail panel per docs/UI-DESIGN.md §3 — rows with favicon, name, username, type badge; detail panel with copy buttons and a passkey sub-record section (placeholder until Phase 3). Fills the Phase 1 shell.
- Search (VAULT-04): client-side in-memory index over decrypted items (name, username, domain); instant filter-as-you-type.
- Password generator (VAULT-05): TypeScript with `crypto.getRandomValues` + rejection sampling; length-first UI, default 20 chars; passphrase mode from a bundled EFF wordlist. (Generated passwords are displayed to the user — not audited-core secret handling.)
- Clipboard (VAULT-06): auto-clear ON by default, 40s (configurable 30–60s); overwrite clipboard after timeout.

**Key Lifecycle & Lock State (accepted)**
- Session token: memory + localStorage persistence (v0.1). It is an auth credential, not vault-secret material; auto-lock never touches it. httpOnly-cookie approach revisited pre-v1.0.
- Unlocked UK: single `WasmUserKey` handle inside the `lib/crypto/` singleton (Phase 1 choke-point); lock = `free()` the handle.
- Unlock flow: `prelogin` → salt + KDF params; login response carries `pw_wrapped_uk`; local WASM unwrap is the visibly distinct unlock step.
- Idle detection: DOM activity events reset the timer; auto-lock settings in plain localStorage (non-secret).

**UX decisions from user (2026-07-12)**
- **Language: i18n PL+EN from the start** — switchable from day one; Phase 1's hardcoded Polish strings get migrated into the i18n layer during this phase. (Static export constraint: use a client-side i18n approach compatible with `output: "export"` — no middleware-based locale routing.)
- **Lock screen: blurred shell in the background** — the unlock overlay sits over a blurred, content-free rendering of the app shell (no item data may remain in the DOM behind it — blur is cosmetic, the vault data must actually be dropped from state on lock).
- **Item deletion: confirmation dialog, permanent delete** — no trash/soft-delete in this phase (may come later).
- **Copy feedback: toast + countdown** — "Copied" toast with a visible seconds-remaining indicator until clipboard auto-clear fires.

### Claude's Discretion
- Entire Auth & Session Model area (explicitly delegated by user).
- DB migration details, exact endpoint/request/response shapes, error taxonomy.
- i18n library choice (must work under static export; keep light — e.g. thin dictionary module over heavy framework).
- Component structure, toast implementation, dialog styling (within UI-DESIGN tokens; security dialogs always legible — no playfulness).

### Deferred Ideas (OUT OF SCOPE)
- Trash/soft-delete for items — explicitly deferred by user (confirm-dialog permanent delete now).
- httpOnly-cookie session hardening — pre-v1.0 revisit.
- RustCrypto bumps (chacha20poly1305 0.11, hkdf 0.13) — still deferred from Phase 1.
- Passkey sub-record editing — Phase 3 (this phase renders a placeholder section only).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Register with email + master password; server sees only hash-po-KDF | `users` migration (auth_hash column), pv-wasm registration export, register endpoint design below |
| AUTH-02 | Login → session token; vault unlock is a separate, visibly distinct local decryption step | Session extractor + prelogin/login/unlock flow; UI-SPEC already locks the visual distinction, this research covers the wire protocol |
| AUTH-08 | Configurable idle auto-lock (sensible default, e.g. 15 min) | DOM-event idle timer pattern, `WasmUserKey.free()` lifecycle |
| VAULT-01 | CRUD for login/card/identity/note items, server sees only ciphertext | Migration plan (drop `type`/`folder_id`), REST endpoint shapes, pv-core/pv-wasm item extension |
| VAULT-02 | AEAD AD binds ciphertext to item ID/revision/context; mutation test proves rejection | pv-core `items.rs` AD-parameter extension (concrete signatures below), mutation-test pattern |
| VAULT-03 | Folders/tags | `folders` table (existing, encrypted name) reused as-is; tag storage design |
| VAULT-04 | Instant client-side search | Client-side in-memory index pattern (no server involvement, consistent with zero-knowledge posture) |
| VAULT-05 | Password generator (16+ default, passphrase mode) | `crypto.getRandomValues` rejection sampling, bundled EFF wordlist (vendored, not an npm dependency) |
| VAULT-06 | Clipboard copy with 30–60s auto-clear | Clipboard API constraints and best-effort overwrite pattern |
| UI-03 | List+detail vault UI already specified in 02-UI-SPEC.md | Favicon privacy research (recommend deferring third-party favicon fetch) |
</phase_requirements>

## Summary

Phase 2 is mostly an *extension* exercise, not a green-field one: Phase 1 already shipped the WASM crypto choke-point, the shell, and a skeleton server with a migration that is close to — but not exactly — what CONTEXT.md's data model requires. The two structural findings that most affect planning are:

1. **The existing `vault_items` migration (0001) contradicts the locked data-model decision.** It has plaintext `type` (with a `CHECK` constraint) and a plaintext `folder_id` FK column. CONTEXT.md explicitly forbids both — item type and folder membership must live inside the encrypted blob. SQLite cannot `DROP COLUMN` a column that's part of a `CHECK` constraint or FK without a full-table rebuild, and since there is no production data yet, the pragmatic migration is `DROP TABLE` + `CREATE TABLE` (new shape) in a `0002_*.sql` migration, not an in-place `ALTER`.
2. **`pv-core::items::encrypt_item`/`decrypt_item` currently ignore item identity entirely** — they use two *static* domain-separation strings, not the `item_id ‖ revision`-bound AD that VAULT-02 requires. This is a breaking signature change (new `item_id: &str, revision: u32` parameters) that ripples through `pv-wasm`'s `encryptItem`/`decryptItem` exports and — critically — Phase 1's self-test in `web/src/lib/crypto/index.ts`, which calls both with no item identity today. The plan must budget a task for updating the self-test call sites and its vitest mocks, or the choke-point facade won't compile.

On the web side, no new npm dependencies are actually required for this phase: i18n (client-side dictionary + `<html lang>` script mirroring the existing theme-toggle pattern), the EFF wordlist (vendored as a static data file, not the abandoned `eff-diceware-passphrase` package), and the password generator (hand-rolled rejection sampling) are all better served by code already-established patterns in this codebase than by adding a dependency. The clipboard auto-clear and favicon display both have real constraints worth designing around up front: clipboard writes need a user gesture and are best-effort only, and — per the project's zero-knowledge/self-hosted privacy posture and Bitwarden/Vaultwarden's own documented favicon-privacy problem — this phase should render the neutral type-icon only and defer any third-party favicon fetch to a later phase.

**Primary recommendation:** Extend `pv-core::items` with an `item_id`/`revision`-bound AD parameter and propagate that breaking change through `pv-wasm` and the Phase 1 self-test in the same task; ship migration `0002_phase2.sql` that rebuilds `vault_items` (drop `type`/`folder_id`, add revision-driven optimistic concurrency) and adds an `auth_hash`/`auth_hash_salt` pair to `users`; implement session auth as a hand-written axum `FromRequestParts` extractor over a SHA-256-hashed bearer token (no crate needed); and build i18n/generator/wordlist as small hand-rolled TypeScript modules rather than new dependencies.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Master password → Argon2id → auth-hash + wrapping-key derivation | Browser/Client (WASM) | — | Zero-knowledge: password/derived keys never leave the client (CLAUDE.md invariant) |
| Auth-hash verification, session issuance | API/Backend | Database/Storage | Server authenticates a high-entropy hash, never a password; session tokens are opaque and hashed at rest |
| Vault unlock (UK unwrap) | Browser/Client (WASM) | — | Architecturally separate from login per AUTH-02; server has no role in this step |
| Vault item CRUD (ciphertext storage, revision bookkeeping) | API/Backend | Database/Storage | Server stores/serves opaque blobs + a plaintext integer revision only |
| Item encrypt/decrypt + AD binding | Browser/Client (WASM) | — | All plaintext and item keys stay client-side; AD construction must happen where the plaintext exists |
| Folders/tags (encrypted names) | Browser/Client (WASM) for encrypt/decrypt | API/Backend for storage | Same pattern as items — server stores `enc_name` blobs only |
| Client-side search index | Browser/Client | — | Zero-knowledge: no server-side search endpoint (Pitfall 5 in PITFALLS.md explicitly warns against this) |
| Password generator | Browser/Client | — | Pure client-side randomness; no server round-trip needed or wanted |
| Clipboard auto-clear | Browser/Client | — | Browser Clipboard API is inherently client-only |
| Idle auto-lock | Browser/Client | — | DOM activity detection + local WASM handle lifecycle; no server signal needed |
| i18n (PL/EN) | Frontend Server (SSR)/Static build | Browser/Client | Static-export constraint means "SSR tier" here means build-time only; runtime locale switch is client-side |
| Favicon display | Browser/Client (deferred fetch) | — | Deferred: no server or third-party fetch this phase — privacy default is the neutral type-icon |

## Standard Stack

### Core (already present — verified against `Cargo.lock`, no changes needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| axum | 0.8.9 [VERIFIED: Cargo.lock] | HTTP routing, extractors, middleware | Already the project's chosen framework; 0.8 removed `#[async_trait]` boilerplate for custom extractors, relevant to the session extractor built this phase |
| sqlx | 0.8.6 [VERIFIED: Cargo.lock] | Async, compile-time-checked SQL against SQLite | Already chosen; `query!`/`query_as!` macros need `DATABASE_URL` or `.sqlx` offline cache — verify offline-mode setup at plan time if CI doesn't have a live DB |
| pv-core (workspace) | 0.1.0 | Argon2id/HKDF/XChaCha20-Poly1305 crypto core | Extend, don't replace — `items.rs` needs the AD parameter (see Architecture Patterns) |
| zeroize | 1.x [VERIFIED: Cargo.lock via pv-core Cargo.toml] | Secure memory wipe | Already used throughout; extend the same discipline to any new session/auth-hash buffers |
| chacha20poly1305 | 0.10.1 [VERIFIED: Cargo.lock] | AEAD used for item/key wrapping | No change; AD parameter is passed into the existing `aead_seal`/`aead_open` | 
| hkdf | 0.12.4 [VERIFIED: Cargo.lock] | HKDF-SHA256 domain-separated key derivation | New `INFO_AUTH_HASH` constant (`b"pv:auth-hash:v1"`) added alongside the existing `INFO_PW_UNLOCK`/`INFO_PRF_UNLOCK` |
| sha2 | 0.10 [VERIFIED: Cargo.lock, currently a `pv-core`-only dependency] | Server-side cheap re-hash of the auth hash, and bearer-token hashing before storage | Add as a **direct** `pv-server` dependency (see Don't Hand-Roll) — this is server-only logic, not client crypto, so it does not belong in `pv-core`'s WASM-shared surface |

### Supporting (new, no new *packages* — all vendored/hand-rolled)

| Asset | Source | Purpose | When to Use |
|---------|---------|---------|-------------|
| EFF Large Wordlist (7776 words) | `eff.org/document/passphrase-wordlists` (public domain) [CITED: eff.org] | Passphrase-mode password generator | Vendor as a static TS/JSON array under `web/src/lib/generator/`, not an npm package (see Don't Hand-Roll) |
| Hand-rolled i18n dictionary module | New code, pattern mirrors Phase 1's theme pre-hydration script | PL/EN switching under `output: "export"` | `web/src/lib/i18n/` — a `"use client"` context/hook + two dictionary objects + an inline `<html lang>` pre-hydration script |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled i18n dictionary | `next-export-i18n` (npm, static-export-compatible) [ASSUMED — found via WebSearch, not verified against an official source; would need `package-legitimacy check` before ever being installed] | Saves ~50 lines of code but adds an external dependency for a shape CONTEXT.md's own discretion note explicitly asked to keep light; last-published-version freshness unverified in this session |
| Hand-rolled i18n dictionary | `next-intl` | CONTEXT.md explicitly rules this out via its "no middleware-based locale routing" constraint and "thin dictionary module over heavy framework" preference — `next-intl`'s idiomatic setup assumes middleware/SSR locale negotiation that static export doesn't support |
| Vendored EFF wordlist array | `eff-diceware-passphrase` npm package | Package appears unmaintained (no recent activity found); CONTEXT.md already commits to hand-rolled `crypto.getRandomValues` + rejection sampling, so the package's built-in CSRNG sampling logic would go unused anyway — only the wordlist data itself is needed |
| SHA-256 server-side auth-hash re-hash | Argon2id again, server-side (Bitwarden's historical PBKDF2-again pattern) | The re-derived `auth_hash` is already a 256-bit, uniformly-random HKDF output (not a guessable low-entropy password) by the time it reaches the server — a second slow KDF pass adds CPU cost on every login with no additional resistance to offline guessing (this is precisely the design flaw palant.info's 2023 critique identified in Bitwarden's approach) [CITED: palant.info — see Sources] |
| Hand-written axum `FromRequestParts` session extractor | `axum-auth` crate's `AuthBearer` | `AuthBearer` only extracts the raw header token; the session-hash-lookup-against-SQLx logic still has to be hand-written regardless, so the crate saves only the header-parsing boilerplate — not worth a new dependency for one `split_whitespace()` call |

**Installation:** No new `npm install` or `cargo add` commands are required for this phase's *packages*. New Cargo dependency: add `sha2 = "0.10"` directly to `crates/pv-server/Cargo.toml` (already present transitively via `pv-core`, but not usable from `pv-server` without a direct dependency declaration).

**Version verification:** `axum`, `sqlx`, `chacha20poly1305`, `hkdf`, `sha2` versions above were read directly from the repo's own `Cargo.lock` (`grep -A1 '^name = "X"$' Cargo.lock`), not training data — these are ground-truth for what's actually compiled into this workspace today, not merely "latest available."

## Package Legitimacy Audit

**No new external packages are introduced by this phase.** Every capability required (i18n, EFF wordlist, session auth, optimistic concurrency) is achievable by extending existing first-party code (`pv-core`, `pv-wasm`, `pv-server`, `web/src/lib/crypto`) or by vendoring public-domain static data (the EFF wordlist text) rather than adding a dependency. The `Alternatives Considered` table above documents packages that were evaluated and explicitly *not* recommended (`next-export-i18n`, `eff-diceware-passphrase`, `axum-auth`) — if the planner or a future phase later decides one of these is worth the dependency after all, it MUST be run through `gsd-tools query package-legitimacy check` before being added, since neither was verified against an authoritative source in this research session (both are `[ASSUMED]`, WebSearch-sourced).

One new **first-party** Cargo dependency edge is added: `sha2 = "0.10"` becomes a direct dependency of `pv-server` (currently only transitive via `pv-core`). This is not a new package to the workspace (already vetted and building at version `0.10.x` per `Cargo.lock`), so no legitimacy check is needed — it's the same crate, just a new direct edge.

**Packages removed due to [SLOP] verdict:** none — no packages were checked because none are being installed.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
                    Browser (Next.js static export, client components only)
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  Auth screens (Login/Register)          Vault shell (locked/unlocked)    │
   │        │                                        │                        │
   │        ▼                                        ▼                        │
   │  lib/crypto/index.ts  ◄── sole WASM choke-point (Phase 1 invariant) ──►  │
   │  (initCrypto, deriveAuthHash+wrap, unwrap, encryptItem/decryptItem+AD)   │
   │        │                                        │                        │
   │        │ fetch()                                │ fetch() Bearer <token> │
   └────────┼────────────────────────────────────────┼────────────────────────┘
            ▼                                        ▼
   POST /api/auth/prelogin              GET/POST /api/vault/items
   POST /api/auth/register              PUT/DELETE /api/vault/items/:id
   POST /api/auth/login                 (all bodies: opaque JSON blobs)
            │                                        │
            ▼                                        ▼
   ┌─────────────────────────────────────────────────────────────────────────┐
   │  axum router                                                             │
   │   - prelogin: SELECT kdf_params, kdf_salt WHERE email=?  (no auth)       │
   │   - register: INSERT users (auth_hash = SHA-256(client auth_hash, salt)) │
   │   - login: verify auth_hash, INSERT sessions (token_hash), return        │
   │            pw_wrapped_uk                                                 │
   │   - vault/items/*: SessionUser extractor (FromRequestParts) validates    │
   │            Bearer token against sessions.token_hash before any handler  │
   │            runs; PUT enforces `WHERE revision = ?` optimistic check      │
   └─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
   SQLite (WAL, migrations/0002_phase2.sql: users.auth_hash*, rebuilt
   vault_items without type/folder_id, folders unchanged)
```

### Recommended Project Structure

```
crates/pv-core/src/
├── items.rs           # MODIFIED — encrypt_item/decrypt_item gain item_id/revision AD params
├── keys.rs            # MODIFIED — new INFO_AUTH_HASH constant
└── kdf.rs             # MODIFIED — new auth_hash_from_password() alongside wrapping_key_from_password()

crates/pv-wasm/src/lib.rs  # MODIFIED — new exports: authHashFromPassword; encryptItem/decryptItem gain (itemId, revision) params

crates/pv-server/src/
├── routes/
│   ├── auth.rs         # MODIFIED — real prelogin (DB lookup), + register, + login
│   ├── session.rs       # NEW — SessionUser extractor (FromRequestParts), token hashing helper
│   └── vault.rs         # NEW — GET/POST /api/vault/items, PUT/DELETE /api/vault/items/:id, folders
├── error.rs             # NEW — ApiError enum + IntoResponse impl (400/401/404/409/500)
└── migrations/
    └── 0002_phase2.sql  # NEW — users.auth_hash*, rebuilt vault_items, (folders unchanged)

web/src/
├── lib/
│   ├── crypto/index.ts  # MODIFIED — new exported functions for auth-hash/register/login/vault crypto; self-test call sites updated for the new encryptItem/decryptItem signature
│   ├── i18n/             # NEW — dictionary.ts (pl/en objects), useTranslation.ts hook, locale pre-hydration script
│   ├── generator/         # NEW — password.ts (rejection sampling), wordlist.ts (vendored EFF data), strength.ts
│   ├── vault/              # NEW — client-side item store, search index, folder/tag state
│   └── clipboard.ts        # NEW — copy-with-auto-clear helper
├── components/
│   ├── auth/               # NEW — LoginForm, RegisterForm, UnlockOverlay
│   ├── vault/               # NEW — ItemList, ItemRow, DetailPanel, TypePicker, DeleteConfirmDialog
│   └── generator/            # NEW — GeneratorPopover
└── app/page.tsx              # MODIFIED — routes between Login/Register/Unlock/Shell by client auth state
```

### Pattern 1: `pv-core::items` AD-bound encrypt/decrypt (the core VAULT-02 change)

**What:** Extend the existing per-item encryption functions to bind ciphertext to item identity and revision, replacing the current *static* AAD constants for the payload with a constructed, versioned AAD.

**When to use:** Every item encrypt/decrypt call, from registration's first item write through every subsequent edit.

**Current code** (`crates/pv-core/src/items.rs`):
```rust
const AAD_ITEM_KEY: &[u8] = b"pv:item-key:v1";
const AAD_ITEM_DATA: &[u8] = b"pv:item-data:v1";

pub fn encrypt_item(uk: &UserKey, plaintext: &[u8]) -> Result<EncryptedItem, CryptoError> {
    let item_key = ItemKey::generate();
    let enc_key = aead_seal(uk.expose(), &item_key.0, AAD_ITEM_KEY)?;
    let enc_data = aead_seal(&item_key.0, plaintext, AAD_ITEM_DATA)?;
    Ok(EncryptedItem { enc_key, enc_data })
}
```

**Recommended shape** (breaking change — update every call site):
```rust
const AAD_ITEM_KEY_PREFIX: &[u8] = b"pv:item-key:v1";
const AAD_ITEM_DATA_PREFIX: &[u8] = b"pv:item:v1"; // matches CONTEXT.md's literal spec

fn build_item_aad(prefix: &[u8], item_id: &str, revision: u32) -> Vec<u8> {
    let mut aad = prefix.to_vec();
    aad.extend_from_slice(item_id.as_bytes());
    aad.extend_from_slice(&revision.to_be_bytes());
    aad
}

pub fn encrypt_item(
    uk: &UserKey,
    plaintext: &[u8],
    item_id: &str,
    revision: u32,
) -> Result<EncryptedItem, CryptoError> {
    let item_key = ItemKey::generate();
    // Key-wrap AAD bound to item_id only (item_key is stable across an item's
    // revisions) — cheap defense-in-depth so a swapped enc_key fails fast at
    // unwrap time, not only downstream at the payload-decrypt step.
    let enc_key = aead_seal(uk.expose(), &item_key.0, &build_item_aad(AAD_ITEM_KEY_PREFIX, item_id, 0))?;
    // Payload AAD bound to item_id AND revision, per CONTEXT.md's literal spec —
    // this is what blocks revision-rollback replay of a stale but authentic blob.
    let enc_data = aead_seal(&item_key.0, plaintext, &build_item_aad(AAD_ITEM_DATA_PREFIX, item_id, revision))?;
    Ok(EncryptedItem { enc_key, enc_data })
}

pub fn decrypt_item(
    uk: &UserKey,
    item: &EncryptedItem,
    item_id: &str,
    revision: u32,
) -> Result<Vec<u8>, CryptoError> {
    let mut key_bytes = aead_open(uk.expose(), &item.enc_key, &build_item_aad(AAD_ITEM_KEY_PREFIX, item_id, 0))?;
    // ... unchanged key-length check ...
    let item_key = ItemKey(k);
    aead_open(&item_key.0, &item.enc_data, &build_item_aad(AAD_ITEM_DATA_PREFIX, item_id, revision))
}
```

**Why `revision: u32` not `u64`:** SQLite's `INTEGER` column is a signed 64-bit value, but `u32` (4.29 billion revisions of one item) is enormous headroom and avoids `BigInt` friction crossing the `wasm-bindgen` boundary into TypeScript (`u64` params require JS `BigInt`, which the codebase doesn't use anywhere yet). `[ASSUMED — reasoned from wasm-bindgen's known u64/BigInt marshaling behavior, not independently re-verified this session]`.

### Pattern 2: axum `FromRequestParts` session extractor (no crate needed)

**What:** A `SessionUser` extractor that pulls the `Authorization: Bearer <token>` header, hashes the token (SHA-256), looks it up in `sessions.token_hash` via the pooled `AppState.db`, checks `expires_at`, and rejects with 401 otherwise. axum 0.8 no longer requires `#[async_trait]` for this.

**When to use:** Every `/api/vault/*` handler (never `/api/auth/prelogin|register|login`, which are unauthenticated by definition).

**Example:**
```rust
// Source: axum 0.8 FromRequestParts pattern, cross-checked against docs.rs/axum
// and the tokio-rs/axum jwt example (github.com/tokio-rs/axum/blob/main/examples/jwt/src/main.rs)
use axum::{extract::FromRequestParts, http::{request::Parts, StatusCode, header}};

pub struct SessionUser { pub user_id: String }

impl FromRequestParts<AppState> for SessionUser {
    type Rejection = StatusCode;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let auth = parts.headers.get(header::AUTHORIZATION).ok_or(StatusCode::UNAUTHORIZED)?;
        let token = auth.to_str().ok().and_then(|s| s.strip_prefix("Bearer "))
            .ok_or(StatusCode::UNAUTHORIZED)?;
        let token_hash = sha2_hash(token.as_bytes()); // new pv-server-local helper
        let row = sqlx::query!(
            "SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > datetime('now')",
            token_hash
        )
        .fetch_optional(&state.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;
        Ok(SessionUser { user_id: row.user_id })
    }
}
```
`[CITED: docs.rs/axum FromRequestParts + community pattern, cross-checked via WebSearch against the official tokio-rs/axum jwt example]`

### Pattern 3: SQLx optimistic concurrency for `PUT /api/vault/items/:id`

**What:** A single `UPDATE ... WHERE id = ? AND revision = ?` that both performs the write and detects a stale-revision conflict via `rows_affected()`.

**Example:**
```rust
// Source: standard SQLx optimistic-concurrency idiom, cross-checked WebSearch
// (SQLite has no native row-version column; the app-managed integer is correct)
let result = sqlx::query!(
    "UPDATE vault_items SET enc_key = ?, enc_data = ?, revision = revision + 1, updated_at = datetime('now')
     WHERE id = ? AND user_id = ? AND revision = ?",
    enc_key_json, enc_data_json, item_id, user_id, expected_revision
)
.execute(&state.db)
.await?;

if result.rows_affected() == 0 {
    // Either the item doesn't exist/belong to this user, or the revision didn't
    // match — distinguish via a follow-up SELECT if the client needs to know which.
    return Err(ApiError::Conflict);
}
```
`[CITED: general SQLx/optimistic-concurrency pattern, WebSearch cross-checked]`

### Pattern 4: i18n dictionary module (mirrors Phase 1's theme pre-hydration script)

**What:** No routing, no middleware, no package — a `"use client"` React context reading `localStorage['pv-locale']`, two flat dictionary objects (`pl.ts`, `en.ts`), and an inline pre-hydration `<script>` in `layout.tsx` that sets `<html lang>` before first paint (same FOUC-avoidance shape as the existing `themeInitScript`).

**Why this shape specifically:** Next.js's built-in `i18n` config and `middleware.ts` are both explicitly rejected by `output: "export"` (Next.js's own build-time error is literally `"Specified 'i18n' cannot be used with 'output: export'"`) `[CITED: Next.js docs error message, cross-checked via WebSearch across multiple independent write-ups]`. Every static-export-compatible community solution converges on the same client-only shape this pattern describes.

**Example:**
```typescript
// Source: pattern synthesized from web/src/app/layout.tsx's existing themeInitScript
// (RESEARCH cross-checked against community static-export i18n write-ups)
const localeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('pv-locale');
    var locale = (stored === 'en' || stored === 'pl') ? stored : 'pl';
    document.documentElement.setAttribute('lang', locale);
  } catch (e) {
    document.documentElement.setAttribute('lang', 'pl');
  }
})();
`;
// layout.tsx keeps <html> without a hardcoded lang="pl"; the script sets it,
// exactly as themeInitScript sets data-theme instead of a hardcoded default.
```

### Pattern 5: EFF wordlist — vendor, don't depend

**What:** Download `eff_large_wordlist.txt` (public domain, 7776 lines, `word` per line after a 5-digit dice-roll key) once, strip the dice-roll prefix, and commit it as `web/src/lib/generator/eff-wordlist.ts` (`export const EFF_WORDLIST: readonly string[]`). Select words via rejection sampling over `crypto.getRandomValues(new Uint32Array(1))[0] % 7776` — **reject and re-roll, don't just modulo**, since `2^32` isn't evenly divisible by `7776` and a naive modulo introduces a measurable (if small) bias. `[CITED: eff.org wordlist publication page — cross-checked WebSearch; the rejection-sampling requirement itself is standard CSPRNG-uniform-selection practice, `[ASSUMED]` as unstated-but-standard cryptographic hygiene]`

### Anti-Patterns to Avoid

- **Modulo-only random word/char selection:** `crypto.getRandomValues()[0] % N` without rejection sampling is a subtle, easy-to-miss bias source — always reject values that would make the modulo non-uniform (`value >= (2^32 - (2^32 % N))`) and re-roll.
- **Storing the client-computed `auth_hash` directly in the `users` table:** it must be re-hashed server-side first (even with a cheap hash) — storing it as-is makes a DB leak directly bearer-equivalent for authentication, exactly the property Bitwarden's own design tries to avoid.
- **Reusing `kdf_salt` for the server-side auth-hash re-hash:** use a separate, server-generated, per-user salt for the re-hash step — reusing the client-visible KDF salt provides no additional defense-in-depth and couples two independent security boundaries.
- **`ALTER TABLE vault_items DROP COLUMN type`:** SQLite will reject this outright because `type` participates in a `CHECK` constraint — plan the migration as a table rebuild (`CREATE TABLE ... AS SELECT` won't preserve constraints/indexes either; use the standard "new table, copy, drop, rename" sequence or, given no production data exists yet, a plain `DROP TABLE` + `CREATE TABLE`).
- **`sqlite::memory:` per-connection pools in integration tests:** each new pooled connection to a bare `:memory:` URI gets its own *separate*, empty database — migrations applied via one connection are invisible to the next. Use `sqlite::memory:?cache=shared` (SQLite shared-cache mode) or a `NamedTempFile`-backed file DB for any `SqlitePoolOptions` pool used in tests with more than one connection. `[CITED: launchbadge/sqlx GitHub issue #2510 and discussion #2011 — cross-checked via WebSearch]`

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Bearer token hashing / auth-hash re-hashing | A custom hash-then-compare loop, or reusing Argon2id server-side | `sha2::Sha256` as a **direct** `pv-server` dependency | The value being hashed is already high-entropy (256-bit HKDF/random output), so a fast cryptographic hash is correct and sufficient (see Alternatives Considered); `sha2` is already vetted and in the dependency tree via `pv-core` |
| Uniform random selection from a wordlist/charset | Naive `Math.random()` or unrejected modulo | `crypto.getRandomValues()` + explicit rejection sampling (per Pattern 5) | `Math.random()` is not cryptographically secure; unrejected modulo biases the distribution even with a CSPRNG source |
| i18n routing/locale negotiation | A hand-rolled path-based locale router | A flat client-side dictionary + `localStorage` (Pattern 4) | `output: "export"` structurally forbids Next.js's built-in i18n and middleware — building a competing router is strictly more code than the dictionary-hook shape for a 2-locale, no-SEO-routing-requirement app |
| Optimistic concurrency / row versioning | Manual `SELECT ... then compare then UPDATE` (TOCTOU race) | Single `UPDATE ... WHERE revision = ?` + `rows_affected()` check (Pattern 3) | The single-statement form is atomic under SQLite's own locking; a separate SELECT-then-UPDATE has a race window between the two statements |
| Session/CSRF-adjacent auth middleware | A generic "middleware crate" grab-bag | A purpose-built `FromRequestParts` extractor scoped to exactly this project's `sessions` table shape (Pattern 2) | The lookup is one query against one already-designed table — a generic crate would add abstraction without saving meaningful code |

**Key insight:** Nearly every "don't hand-roll" instinct in a typical web app (auth middleware, i18n routing, password generation) inverts in this specific project: the *system already has* a purpose-built crypto core (`pv-core`) and a locked, non-standard data model (no plaintext `type`/`folder_id`, static-export-only frontend) that make generic dependencies a worse fit than 50–150 lines of code that exactly match the constraints. The one place a real dependency graph decision is being made (`sha2` as a direct `pv-server` edge) is deliberately *not* a new package — it's promoting an existing, already-audited transitive dependency to direct status.

## Common Pitfalls

### Pitfall 1: The pv-core `items.rs` signature change breaks Phase 1's self-test silently at compile time — but only if the plan budgets for it

**What goes wrong:** A plan that treats "add AD to `items.rs`" as an isolated `pv-core` task will fail to compile `pv-wasm` and `web/src/lib/crypto/index.ts`'s vitest suite, because `runSelfTest()` currently calls `encryptItem(unwrappedKey, SELF_TEST_PLAINTEXT)` and `decryptItem(unwrappedKey, encryptedItemJson)` with the *old* two-argument signature.

**Why it happens:** The AD parameter is a breaking change to a function three layers (`pv-core` → `pv-wasm` → TS facade) already have call sites for, from Phase 1.

**How to avoid:** Bundle the `items.rs` signature change, the `pv-wasm` export update, and the self-test call-site update (pass a fixture `item_id`/`revision`, e.g. `"self-test-item"`, `1`) into the same task/wave — don't let a later task discover the break.

**Warning signs:** `cargo build -p pv-wasm` or `npm test` (vitest) failing immediately after the `items.rs` change with a wrong-arity error.

### Pitfall 2: SQLite `sqlite::memory:` pools silently give each connection its own empty database in integration tests

**What goes wrong:** An axum + `tower::ServiceExt::oneshot()` integration test suite that spins up `SqlitePoolOptions::new().connect("sqlite::memory:")` with more than one pooled connection will see migrations "not applied" or "data not found" nondeterministically, because each new connection opens a *fresh*, separate in-memory database.

**Why it happens:** SQLite's `:memory:` URI without shared-cache mode creates a private database per connection — this is documented SQLite behavior, not an SQLx bug.

**How to avoid:** Use `sqlite::memory:?cache=shared` with a single min-connection pool, or (more robust, avoids SQLite's shared-cache mode gotchas entirely) a `tempfile`-backed file database per test.

**Warning signs:** Tests pass with `max_connections(1)` but fail intermittently once concurrency/pool size increases.

### Pitfall 3: A cheap server-side auth-hash re-hash is *correct* here, but would be *wrong* in a different design — don't generalize the reasoning

**What goes wrong:** A future contributor (or an over-eager security review) sees `SHA-256` used for anything password-adjacent and flags it as weak, without the context that the input is already a 256-bit uniformly-random KDF output, not a low-entropy secret.

**Why it happens:** "Never use a fast hash for passwords" is good general advice that doesn't apply to *already-stretched, high-entropy* values — this project's `auth_hash` has already been through client-side Argon2id + HKDF before the server ever sees it.

**How to avoid:** Document the reasoning inline (a doc comment on the server-side re-hash function) so the design intent survives code review and onboarding, not just this research doc.

**Warning signs:** A code review comment or future PR proposing to "harden" the server-side re-hash with Argon2id — this should prompt re-reading this rationale, not an automatic accept.

### Pitfall 4: Third-party favicon fetching is a live, documented privacy leak for exactly this project's positioning

**What goes wrong:** Implementing `UI-03`'s "favicon" row element the way Bitwarden/most competitors do (fetch `https://icon-service/{domain}` client-side) sends every saved login's domain to a third party, and Vaultwarden's own community has an open, unresolved privacy discussion about even the *self-hosted* "internal" icon-fetch mode leaking cache/enumeration signals through an unauthenticated `/icons` endpoint.

**Why it happens:** It's the path of least resistance visually, and the UI-SPEC's row layout budget (32px "favicon/type-icon") makes it easy to reach for a favicon service without registering the privacy tradeoff.

**How to avoid:** Ship this phase with the neutral type-icon only (already part of the row per UI-SPEC — `Vault`/`CreditCard`/`IdCard`/`StickyNote`), no external fetch. If real favicons are wanted later, design it as an explicit opt-in setting with a self-hosted proxy (Vaultwarden's own mitigation pattern), not a default-on client-direct fetch.

**Warning signs:** Any code path that does `fetch(`https://.../favicon?domain=${item.domain}`)` (or similar) without a settings gate.

## Runtime State Inventory

Not applicable — this phase is additive (new tables/columns, new endpoints, new UI), not a rename/refactor/migration of existing identifiers. The one schema change that touches existing structure (`vault_items` rebuild) is addressed in Common Pitfalls/Architecture Patterns above as a migration-design concern, not a runtime-state concern — no data exists yet in any deployed instance (Phase 1 shipped no auth or vault-write path), so there is no live data to migrate.

## Code Examples

### Server-side auth-hash re-hash (new `pv-server`-local helper, not `pv-core`)

```rust
// crates/pv-server/src/routes/session.rs (or a new `crypto.rs`) — server-only,
// deliberately NOT in pv-core (pv-core is the WASM-shared client-crypto surface;
// this logic never runs client-side and never touches raw password/master-key
// material — see Don't Hand-Roll and Pitfall 3 for the rationale).
use sha2::{Digest, Sha256};

/// Cheap re-hash of an already-high-entropy client auth hash before storage.
/// `salt` is a server-generated per-user random value (NOT the KDF salt).
pub fn server_rehash(auth_hash: &[u8], salt: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(salt);
    hasher.update(auth_hash);
    hasher.finalize().into()
}
```

### `pv-core::kdf` — auth-hash derivation alongside the existing wrapping-key derivation

```rust
// crates/pv-core/src/kdf.rs — new function, mirrors wrapping_key_from_password
use crate::keys::INFO_AUTH_HASH; // new constant, alongside INFO_PW_UNLOCK

pub fn auth_hash_from_password(
    password: &[u8],
    salt: &[u8],
    params: &KdfParams,
) -> Result<Zeroizing<[u8; MASTER_KEY_LEN]>, CryptoError> {
    let mk = derive_master_key(password, salt, params)?;
    Ok(Zeroizing::new(keys::hkdf_expand_key(mk.as_ref(), INFO_AUTH_HASH)))
}
```
This deliberately calls `derive_master_key` a **second time from the caller's perspective at the API level** but should share the *already-computed* `mk` with `wrapping_key_from_password` in the actual registration/login flow (compute `derive_master_key` once, then HKDF-expand it twice with two different `INFO_*` constants) — don't run Argon2id twice per login. The `pv-wasm` export layer is the right place to compute `mk` once and derive both outputs from it, since that's the actual call site with both needs.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `#[async_trait]` on custom axum extractors | Native `async fn` in trait impls | axum 0.8 (already the version pinned in this workspace) | No `async-trait` dependency needed for the new `SessionUser` extractor |
| Next.js `i18n` config + middleware locale routing | Client-side dictionary/context for `output: "export"` apps | Ongoing since static export's introduction; not a recent change, but still the only viable pattern | Confirms CONTEXT.md's own steer was correct — no framework escape hatch exists |

**Deprecated/outdated:** None specific to this phase beyond what Phase 1's STATE.md already flagged (chacha20poly1305 0.11/hkdf 0.13 bumps remain deferred).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `revision: u32` (not `u64`) is the right width for the AD-bound revision counter, reasoned from wasm-bindgen's u64/BigInt friction rather than independently re-verified this session | Architecture Patterns, Pattern 1 | Low — if wrong, a later migration just widens the type; no security impact either way since AD binding works identically regardless of integer width |
| A2 | `next-export-i18n` npm package is a legitimate, currently-published package (found via WebSearch only, not checked against npm registry or an authoritative source) | Standard Stack, Alternatives Considered | Low — it is explicitly NOT recommended for use this phase; only relevant if a future contributor reconsiders the hand-rolled decision |
| A3 | The rejection-sampling requirement for `crypto.getRandomValues() % N` bias avoidance is treated as standard cryptographic hygiene, not pulled from a specific cited source this session | Architecture Patterns, Pattern 5 | Low-Medium — well-established practice, but the exact rejection threshold formula should be code-reviewed at implementation time, not taken as gospel from this doc |
| A4 | Axum `FromRequestParts` example code (Pattern 2) is a synthesized pattern cross-checked against WebSearch summaries of docs.rs and the tokio-rs/axum jwt example, not fetched verbatim from a docs provider (no Context7/MCP docs tool was available in this environment) | Architecture Patterns, Pattern 2 | Low — the pattern is a well-established, simple Rust trait impl; verify exact axum 0.8.9 trait signature (`type Rejection`, async fn shape) against `cargo doc --open -p axum` at implementation time before assuming this snippet compiles as-is |

## Open Questions (RESOLVED)

1. **(RESOLVED)** Does AD-binding `revision` on the payload alone (not the key-wrap) fully satisfy VAULT-02's "revision rollback" protection, or does it need an additional client-side highest-seen-revision check?
   - What we know: Binding AAD to `item_id ‖ revision` makes any ciphertext/AAD mismatch fail decryption outright — a malicious server can't splice item A's blob into item B's slot, or claim a different revision number than what the blob was actually encrypted for, without the client's decrypt call failing.
   - What's unclear: If the server resends an *authentically old* `(blob, revision=3)` pair (both genuinely matching, just stale) while the true current revision is 5, decryption *succeeds* — the AD-binding alone doesn't detect "this is old" if the returned revision number is presented honestly alongside its matching ciphertext. True rollback-detection needs the client to compare against a revision number it previously observed (out of scope for Phase 2's revision-gated *sync* semantics — that's SYNC-01/03 in Phase 5).
   - **Resolution:** Implemented exactly as scoped — Plan 02-01 Task 1's `aad_mutation_rejected` test asserts `Err(CryptoError::Decrypt)` on any `item_id`/`revision` AD mismatch, satisfying Phase 2's literal success criterion. The deeper rollback-detection-via-client-side-revision-tracking question is explicitly deferred to Phase 5 (sync) planning, where the revision-gated pull model is the natural place to add it — not a Phase 2 gap.

2. **(RESOLVED)** Should `folders`/tags membership be encrypted *inside* each item's payload (per CONTEXT.md's "no plaintext folder_id column"), and if so, how does VAULT-03's folder navigation avoid a full-vault decrypt on every folder switch?
   - What we know: CONTEXT.md is explicit that no plaintext `folder_id` column exists on `vault_items`. VAULT-04 already commits to full client-side, in-memory search/filter, meaning the client already decrypts the entire vault into memory on unlock.
   - What's unclear: Whether folder_id references live inside the item's ciphertext JSON payload (recommended — consistent with "type/name/tags live inside the ciphertext") or whether the planner intends some other mechanism.
   - **Resolution:** Implemented per the recommendation — `ItemFields.folderId`/`ItemFields.tags` live inside each item's encrypted payload (Plan 02-05 Task 1's `types.ts`), and folder/tag filtering is just another client-side filter predicate over the already-decrypted in-memory item list (`useVaultItems()`/`useAllTags()`, Plan 02-05 Task 1; Sidebar filter wiring, Plan 02-06 Task 3) — no separate design or server round-trip needed. Folder *definitions* are their own encrypted `folders` records (Plan 02-03 Task 2's server table; Plan 02-05 Task 1's `useFolders()`/`createVaultFolder`), matching the Bitwarden-style pattern CONTEXT.md locked.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust stable toolchain | Server/pv-core/pv-wasm build | ✓ | rustc 1.97.0 | — |
| Cargo | Build/test | ✓ | 1.97.0 | — |
| Node.js | Web build/test | ✓ | v24.18.0 | — |
| npm | Web package management | ✓ | 11.16.0 | — |
| sqlite3 CLI | Local migration inspection/debugging | ✓ | 3.51.0 | — |
| SQLx compile-time query checking | `sqlx::query!`/`query_as!` macros | ✓ (crate present) | 0.8.6 | Verify `DATABASE_URL` or committed `.sqlx` offline query cache exists before relying on macro-time checks in CI — not independently confirmed this session |

**Missing dependencies with no fallback:** none identified.
**Missing dependencies with fallback:** none identified — all required tooling is present in this environment.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (Rust) | `cargo test` — inline `#[cfg(test)] mod tests` per file (no separate `tests/` integration dir exists yet) |
| Framework (Web) | Vitest 3.x, `web/vitest.config.ts` (jsdom environment, `@vitejs/plugin-react`) |
| Config file | `web/vitest.config.ts` (exists); no Rust test config file (cargo defaults) |
| Quick run command | `cargo test -p pv-core -p pv-wasm` / `cd web && npm test` |
| Full suite command | `cargo test --workspace` / `cd web && npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| AUTH-01 | Register stores only auth-hash-derived value, never password/master key | unit (pv-core) + integration (pv-server) | `cargo test -p pv-core auth_hash`; `cargo test -p pv-server register` | ❌ Wave 0 |
| AUTH-02 | Login issues session token; unlock is a separate WASM step (no server round-trip) | integration (pv-server) + unit (pv-wasm) | `cargo test -p pv-server login`; `cargo test -p pv-wasm` | ❌ Wave 0 |
| AUTH-08 | Idle auto-lock frees the WASM UK handle after configured timeout | unit (web, vitest, fake timers) | `cd web && npm test -- idle-lock` | ❌ Wave 0 |
| VAULT-01 | CRUD round-trip for login/card/identity/note items | integration (pv-server) + unit (pv-core) | `cargo test -p pv-server vault_items`; `cargo test -p pv-core item_roundtrip` (existing, extend) | ⚠️ Extend existing `crates/pv-core/src/items.rs` test module |
| VAULT-02 | AD-mutation test proves decrypt rejection | unit (pv-core) | `cargo test -p pv-core aad_mutation_rejected` | ❌ Wave 0 — this is the phase's signature security test, must exist |
| VAULT-03 | Folder/tag create + filter | integration (pv-server) + unit (web) | `cargo test -p pv-server folders`; `cd web && npm test -- folder-filter` | ❌ Wave 0 |
| VAULT-04 | Client-side search matches name/username/domain, instant | unit (web, vitest) | `cd web && npm test -- search-index` | ❌ Wave 0 |
| VAULT-05 | Generated password meets length/charset; passphrase mode uses EFF wordlist; rejection sampling is unbiased-by-construction | unit (web, vitest) | `cd web && npm test -- generator` | ❌ Wave 0 |
| VAULT-06 | Clipboard copy triggers auto-clear after configured duration | unit (web, vitest, fake timers + mocked `navigator.clipboard`) | `cd web && npm test -- clipboard` | ❌ Wave 0 |
| UI-03 | List+detail render, row/panel content matches decrypted item | component test (web, vitest + Testing Library if added) or manual checkpoint | `cd web && npm test -- item-list` or `checkpoint:human-verify` | ❌ Wave 0 — decide unit vs. manual-checkpoint per planner's UI-testing appetite |

### Sampling Rate

- **Per task commit:** `cargo test -p <touched-crate>` and/or `cd web && npm test` (scoped to touched files)
- **Per wave merge:** `cargo test --workspace` + `cd web && npm test` (full suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus the VAULT-02 AD-mutation test specifically re-run and its failure-mode manually inspected (assert it's an `Err(CryptoError::Decrypt)`, not a panic or a silently-accepted plaintext)

### Wave 0 Gaps

- [ ] `crates/pv-server/tests/` — no integration test directory exists yet; needs a `tower::ServiceExt::oneshot()`-based harness plus the shared-cache-or-tempfile SQLite pool pattern from Common Pitfalls #2
- [ ] `crates/pv-core/src/items.rs` — extend existing `mod tests` with the AD-mutation rejection test (VAULT-02's literal success criterion)
- [ ] `web/src/lib/vault/search.test.ts`, `web/src/lib/generator/password.test.ts`, `web/src/lib/clipboard.test.ts` — new test files, no existing coverage
- [ ] Decide (planner's call) whether `web/src/lib/crypto/index.test.ts`'s existing mocks need updating in the *same* task as the `items.rs` signature change (recommended — see Common Pitfalls #1) or a dedicated follow-up task

## Security Domain

`security_enforcement` is enabled (`security_asvs_level: 1`, `security_block_on: "high"` per `.planning/config.json`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Hash-po-KDF verification (client Argon2id+HKDF, server SHA-256 re-hash of high-entropy input — see Pitfall 3 rationale); no password ever transmitted or stored |
| V3 Session Management | yes | Opaque 256-bit random bearer tokens (via existing `pv_core::keys::random_bytes`), hashed at rest (`sessions.token_hash`), server-enforced `expires_at`, `FromRequestParts` extractor validates on every protected route |
| V4 Access Control | yes | Every `/api/vault/*` query scoped by `user_id` from the validated session, never trusted from client-supplied request body/params |
| V5 Input Validation | yes | Server validates email format/uniqueness at registration; JSON body shape via `serde`; item payload sizes bounded (planner should set an explicit max blob size to avoid unbounded-storage abuse — not specified in CONTEXT.md, flagging for plan-time decision) |
| V6 Cryptography | yes | No hand-rolled primitives — reuses `pv-core`'s already-implemented Argon2id/HKDF-SHA256/XChaCha20-Poly1305; new AD construction (Pattern 1) is the only new cryptographic *design* surface this phase, and it directly implements VAULT-02's literal specification |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Blob-swap / ciphertext splicing between items or revisions | Tampering | AEAD associated data bound to `item_id ‖ revision` (Pattern 1) — server-controlled response data can't be silently substituted without failing the auth tag check |
| Bearer token theft via XSS (token in `localStorage`) | Information Disclosure / Elevation of Privilege | Accepted residual risk per CONTEXT.md's explicit decision ("httpOnly-cookie approach revisited pre-v1.0") — mitigate via standard XSS hardening elsewhere (React's default JSX escaping, no `dangerouslySetInnerHTML` outside the two pre-hydration scripts) rather than re-litigating the cookie decision this phase |
| Optimistic-concurrency race exploited to overwrite a concurrent edit undetected | Tampering | Single-statement `UPDATE ... WHERE revision = ?` + `rows_affected()` check (Pattern 3) — no TOCTOU window |
| Auth-hash brute force via server-side DB leak | Information Disclosure | Auth-hash is a 256-bit HKDF output (not a low-entropy password) before it ever reaches the server-side re-hash — offline brute force of the *client-side* Argon2id-protected password remains the actual attack surface, unaffected by server-hash speed (see Pitfall 3) |
| Session-fixation / token reuse after logout | Elevation of Privilege | Ensure a `DELETE FROM sessions WHERE token_hash = ?` (or equivalent) exists on logout — not explicitly named as a Phase 2 endpoint in CONTEXT.md; flagging for plan-time inclusion since AUTH-07 (session listing/revocation) is Phase 3 but a basic logout endpoint arguably belongs with login/session issuance in this phase |
| Zero-knowledge boundary violation via server-side vault-data logging | Information Disclosure | Per PITFALLS.md Pitfall 5 (already researched at milestone level): explicitly exclude `/api/vault/*` request/response bodies from `tower-http`'s `TraceLayer` default body logging — allow-list status/timing only |

## Sources

### Primary (HIGH confidence — read directly from this codebase, not external)
- `crates/pv-core/src/{kdf.rs, keys.rs, items.rs, error.rs}` — current crypto core implementation
- `crates/pv-wasm/src/lib.rs` — current WASM export surface
- `crates/pv-server/{src/main.rs, src/routes/{mod.rs,auth.rs}, src/config.rs, migrations/0001_init.sql}` — current server skeleton and schema
- `web/src/lib/crypto/{index.ts, index.test.ts}` — current WASM choke-point facade and its test mocks
- `Cargo.lock` (workspace) — ground-truth dependency versions (axum 0.8.9, sqlx 0.8.6, webauthn-rs 0.5.5, chacha20poly1305 0.10.1, hkdf 0.12.4)
- `.planning/phases/02-password-auth-vault-core/{02-CONTEXT.md, 02-UI-SPEC.md}`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/research/PITFALLS.md`

### Secondary (MEDIUM confidence — WebSearch cross-checked against an official/authoritative source)
- [Export Internationalization (i18n) — Next.js docs](https://nextjs.org/docs/messages/export-no-i18n) — official error message confirming `i18n`/`output: export` incompatibility
- [Data Privacy for Website Icons — Bitwarden](https://bitwarden.com/help/website-icons/) — official documentation of the favicon-fetch privacy tradeoff
- [Encryption Key Derivation / KDF algorithms — Bitwarden](https://bitwarden.com/help/kdf-algorithms/) — official documentation of the hash-po-KDF, server-rehash pattern this project's own design mirrors
- [Missing authentication for the /icons/ endpoint — dani-garcia/vaultwarden Discussion #2115](https://github.com/dani-garcia/vaultwarden/discussions/2115) — community-confirmed privacy issue in self-hosted favicon fetching
- [sqlite in-memory databases do not seem to work with connection pools — launchbadge/sqlx Issue #2510](https://github.com/launchbadge/sqlx/issues/2510) — confirms the per-connection-separate-database gotcha
- [Keeping in-memory sqlite database connection pool alive — launchbadge/sqlx Discussion #2011](https://github.com/launchbadge/sqlx/discussions/2011) — confirms `?cache=shared` mitigation
- [EFF Large Wordlist for Passphrases — Electronic Frontier Foundation](https://www.eff.org/document/passphrase-wordlists) — official source of the 7776-word list, public domain

### Tertiary (LOW confidence — WebSearch only, single-source or synthesized, flagged in Assumptions Log)
- axum 0.8 `FromRequestParts` example (Pattern 2) — synthesized from WebSearch summaries of docs.rs/axum and the `tokio-rs/axum` jwt example; not fetched verbatim (no Context7/MCP docs provider available this session) — see Assumption A4
- [Bitwarden design flaw: Server side iterations — palant.info](https://palant.info/2023/01/23/bitwarden-design-flaw-server-side-iterations/) — independent security researcher's critique, used to justify the SHA-256-not-Argon2id server-rehash recommendation; single-source but directly on-point and internally consistent with this project's own already-locked KDF design
- `next-export-i18n` / `eff-diceware-passphrase` npm package existence/health — WebSearch only, not registry-verified (see Assumptions A2, and Package Legitimacy Audit note that neither is being installed)

## Metadata

**Confidence breakdown:**
- Standard stack (Rust side): HIGH — every version claim read directly from `Cargo.lock`, not training data
- Standard stack (web side): MEDIUM — no new packages recommended, so version-drift risk is minimal, but the "don't add a package" recommendations rest on WebSearch-only package-health checks (A2)
- Architecture (AD-binding, migration rebuild): HIGH — derived directly from reading the actual current code/schema against CONTEXT.md's locked decisions, not external research
- Pitfalls: MEDIUM-HIGH — the two most consequential pitfalls (self-test breakage, SQLite in-memory pool gotcha) are both grounded in this session's direct code inspection / a specific cross-checked GitHub issue, not general pattern-matching

**Research date:** 2026-07-12
**Valid until:** 2026-08-11 (30 days — this phase's core findings are the project's own code/schema, which don't go stale; the web-ecosystem findings, e.g. Next.js static-export i18n conventions, warrant re-verification if planning is delayed past this window)
