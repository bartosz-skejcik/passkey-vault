# Architecture Research

**Domain:** Self-hostable, zero-knowledge password manager with first-class passkeys (passkey provider + PRF vault unlock)
**Researched:** 2026-07-12
**Confidence:** MEDIUM overall (HIGH for repo-verified crypto/webauthn-rs facts; MEDIUM for cross-checked Bitwarden architecture patterns; LOW/directional for sync-protocol specifics not independently source-verified — flagged inline)

This document validates and deepens `docs/ARCHITECTURE.md` (the existing draft). It does not propose an alternative architecture — the draft's component diagram, key hierarchy, and data model sketch are sound and match how the two closest reference systems (Bitwarden/Vaultwarden) are actually built. This file adds the missing depth in five areas and derives a build order.

## Standard Architecture

### System Overview

The draft's diagram is correct at the box level. Zero-knowledge password managers universally split into three layers, with the crypto boundary drawn between layers 1 and 2 — the server layer never holds key material:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                              │
│  Web app (Next.js) — UI only, no crypto logic of its own         │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  pv-core (Rust → wasm-bindgen/wasm-pack)                  │    │
│  │  KDF, key wrap/unwrap, PRF→key, item encrypt/decrypt       │    │
│  │  ALL plaintext + key material lives and dies in here        │    │
│  └──────────────────────────────────────────────────────────┘    │
│  navigator.credentials.{create,get} (WebAuthn + PRF extension)   │
└──────────────────────────┬────────────────────────────────────────┘
                            │ HTTPS: REST/JSON (opaque ciphertext blobs)
                            │ WSS: sync push notifications (metadata only)
┌──────────────────────────┴────────────────────────────────────────┐
│                    API / RP Layer (axum, single container)        │
│  routes/auth.rs   — prelogin, password login, WebAuthn RP ceremony│
│  routes/sync.rs   — GET/PUT /sync (revision-gated), WS /sync/stream│
│  routes/items.rs  — CRUD on opaque encrypted blobs                │
│  middleware       — session/JWT auth, tracing                     │
│  webauthn-rs      — verifies signatures only; NEVER sees PRF output│
│  Serves static Next.js export from same port                      │
└──────────────────────────┬────────────────────────────────────────┘
                            │ SQLx
┌──────────────────────────┴────────────────────────────────────────┐
│              Data Layer (SQLite on volume, Postgres optional)     │
│  users, webauthn_credentials, vault_items, sessions, folders …    │
│  Every "secret-shaped" column is a ciphertext blob or a hash      │
└─────────────────────────────────────────────────────────────────┘
```

The one structural nuance the draft doesn't spell out: **pv-core is not just "shared crypto," it is the trust boundary.** The web app (Next.js/React) should be treated as a dumb shell around it — every operation that touches plaintext or key material (password → KDF, PRF result → unwrap, item encrypt/decrypt) must happen inside the WASM module, never in plain TypeScript/JS, even for convenience. This is the architectural rule that makes "zero-knowledge" actually true rather than aspirational.

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|-------------------------|
| pv-core (native) | Key hierarchy, KDF, PRF handling, item crypto | Rust crate, no I/O (already exists) |
| pv-core (wasm) | Same logic, exposed to JS via a narrow API | `wasm-bindgen`, built with `wasm-pack --target web` or `--target bundler` |
| pv-web-bridge | Thin TS wrapper around the wasm module: session-scoped singleton holding the unwrapped session state inside wasm memory, typed request/response DTOs | Hand-written TS module, imported by Next.js pages/hooks |
| axum RP layer | Session/token issuance, WebAuthn ceremony state, sync revision gating, static file serving | axum router + `webauthn-rs` + `tower-http::ServeDir` |
| SQLx/SQLite | Durable storage of ciphertext blobs, credential metadata, session records | `sqlx::migrate!()` embedded migrations, WAL mode |
| WS sync channel | Push "something changed, revision=N" to connected clients of the same account | axum `ws` upgrade, one broadcast channel per user (in-process; no Redis needed at solo/self-host scale) |

## Recommended Project Structure

The existing workspace layout is already correct; the addition needed is a `pv-core-wasm` bridge crate (or a `wasm` feature/target on `pv-core` itself) plus a client-side TS module:

```
crates/
├── pv-core/                 # existing — no I/O, compiles native + wasm32
│   └── src/{kdf,keys,prf,items,error}.rs
├── pv-core-wasm/             # NEW — thin wasm-bindgen surface over pv-core
│   └── src/lib.rs            # exposes only the operations the web app needs
└── pv-server/                 # existing — axum + SQLx
    ├── src/routes/
    │   ├── auth.rs            # prelogin, login, webauthn register/assert
    │   ├── sync.rs             # NEW — GET/PUT /sync, WS /sync/stream
    │   └── items.rs             # NEW — vault item CRUD
    ├── src/session.rs           # NEW — token issuance/verification middleware
    └── migrations/

apps/web/                      # Next.js (static export)
├── lib/
│   ├── crypto/                # imports pv-core-wasm; the ONLY module allowed
│   │                           #   to touch key material or plaintext
│   │   ├── vault-session.ts   # holds unwrapped-session handle, exposes
│   │   │                      #   encrypt/decrypt/lock/unlock only
│   │   └── webauthn.ts        # navigator.credentials wrapper incl. raw
│   │                          #   PRF extension JSON passthrough
│   └── api/                   # REST/WS client — moves ciphertext only
└── app/                       # routes/pages — never import wasm directly
```

### Structure Rationale

- `pv-core-wasm` is separated from `pv-core` rather than compiling `pv-core` to wasm directly and consuming it raw, because a hand-curated `wasm-bindgen` surface lets you control exactly what crosses the JS boundary (see WASM boundary design below) instead of exposing every internal Rust type.
- `apps/web/lib/crypto/` is a deliberate choke point: application code (pages, hooks, components) should never import the wasm module directly, only this wrapper, so there is exactly one place to audit for "does plaintext/key material leak into JS-land."

## Deep Dive 1 — Revision-Based Sync Protocol

**What Bitwarden/Vaultwarden actually do (verified, MEDIUM confidence):**

There is no field-level delta/diff protocol. "Delta sync" in Bitwarden's ecosystem means: the client remembers the server's last-known `revisionDate`, and `GET /sync` always returns a **full snapshot** (profile, folders, ciphers, collections) in one response. The server-side optimization (Vaultwarden's `CipherSyncData`) is about query complexity (O(n·m) → O(n+m) via precomputed joins), not about avoiding sending the whole vault. A lightweight `GET /sync/revision-date` (or equivalent) lets a client cheaply check "did anything change since my last full sync" without transferring the whole payload if nothing changed — that's the actual meaning of "revision-based" here, not per-item diffing.

Push is a separate, lightweight side channel: a SignalR (WebSocket) hub at `/notifications/hub` sends small notification messages (change type + object id + timestamp), *not* the changed object. The client reacts to a push by issuing a normal authenticated `GET /sync` (or in Bitwarden's newer SDK-mediated flow, a targeted re-fetch of just the affected cipher). Multi-instance Bitwarden Cloud uses Redis as a SignalR backplane so a push from one node reaches clients connected to another node; **this is irrelevant to a single-container self-hosted deployment** — an in-process `tokio::sync::broadcast` channel keyed by user id is the correct equivalent at this project's scale, no Redis dependency needed (this preserves the "1 container, no required external services" constraint).

**What this implies for v0.1 design** (this refines, not overrides, the draft's `GET/PUT /sync` + WS sketch):

- `GET /sync` returns the full current state (all items + folders + credential metadata) *unless* the client sends an `If-Revision-Newer-Than=<n>` style query param, in which case the server can return `304`-equivalent "nothing new" without a body. Don't build per-item diffing for v0.1 — it's not what the reference implementations do and it adds real complexity (merge/conflict logic) for no proven benefit at solo/family scale.
- Track a single monotonic `revision` counter *per user account* (not per item) for the cheap "should I sync" check, but each `vault_items` row still needs its own `revision`/`updated_at` so the client can do an efficient local merge (only replace items that actually changed) instead of re-decrypting the entire vault on every sync.
- Conflict handling: last-write-wins at the item level, keyed by server-assigned monotonic revision — this is what Bitwarden does (no CRDT, no 3-way merge). The client should detect the "I have local edits AND the server revision advanced past what I last saw for this item" case and surface a conflict to the user (duplicate item / discard local) rather than silently overwriting, but this UX affordance can be a v0.1 nice-to-have, not a blocker — LWW-with-warning is enough to ship.
- WS `/sync/stream`: pushes `{item_id, revision, change_type}` tuples only. Never pushes ciphertext over the socket unprompted — keep the WS channel metadata-only and let the client pull via the authenticated REST path, matching the reference pattern and simplifying auth (the WS connection just needs to be tied to an authenticated session; it never needs its own crypto).

## Deep Dive 2 — Session/Auth Architecture (Login vs Unlock)

**Verified pattern (Bitwarden, MEDIUM confidence, cross-checked against contributing.bitwarden.com):**

Bitwarden cleanly separates two concepts the draft correctly gestures at but doesn't fully name:

- **Login** = proving identity to the *server*. Client derives `masterKey` locally (Argon2id/PBKDF2 over password + salt), then derives a *second, distinct* KDF pass over `masterKey + password` to produce a "master password hash" — this is what's actually transmitted to `POST /connect/token` (an OAuth2 **password grant**). The server verifies this hash and never sees `masterKey`, the raw password, or anything that could reconstruct them. Response: a short-lived JWT `access_token` (carrying a security-stamp claim used to invalidate all sessions on password/key rotation), a `refresh_token`, the KDF parameters, and the user's *wrapped* User Key.
- **Unlock** = decrypting the vault *locally*. The client takes the wrapped User Key from the login response (or from a previous session) and unwraps it using the locally-held `masterKey` (password path) or the PRF-derived wrapping key (passkey path). This step never touches the server and the server cannot distinguish "vault successfully unlocked" from "wrong password entered" — it has no way to know.

**Direct implication for this project's PRF path:** the draft's §4 "Przepływ PRF unlock" already gets the two-track nature right (PRF path unwraps UK locally; assertion signature authenticates the session), but the auth architecture needs one more explicit design decision: **PRF unlock and WebAuthn login are the same ceremony, running in parallel, with two different consumers of its output.**

```
navigator.credentials.get({ publicKey: { ..., extensions: { prf: { eval: { first: perUserSalt } } } } })
        │
        ├─→ assertion (signature, authenticatorData, clientDataJSON)
        │     → sent to server → webauthn-rs verifies signature
        │     → server issues session token (this IS "login")
        │
        └─→ clientExtensionResults.prf.results.first (32 bytes)
              → stays in browser, HKDF → wrapping key → unwrap UK
              → this IS "unlock", 100% local, server never sees it
```

This means a single `navigator.credentials.get()` call in the client can serve both purposes in one user gesture (one Touch ID / security key tap), which is a genuinely nicer UX than password login (separate login step, then separate unlock). For the password path, login and unlock are two separate operations by necessity (server round-trip for the hash, then local unwrap), and v0.1 must implement both. **Recommendation:** implement the password path fully first (simpler, no WebAuthn ceremony state to manage) to establish the session/token machinery, then add the PRF path as an alternate credential for the *same* login endpoint shape — this validates the build-order intuition in the milestone context.

**Token issuance/refresh, adapted to this project's "no required external services" constraint:**
- Short-lived access token (e.g., 15–30 min) + longer-lived refresh token, both server-issued, both opaque or JWT — a JWT is fine here since axum has no reason to avoid it and it saves a DB lookup per request, but the `sessions` table (already in the draft's data model) should still track refresh tokens by hash so they're revocable (password change, "log out everywhere," lost device) even though access tokens are stateless.
- The `sstamp`-equivalent (a per-user "security stamp" that increments on password change or credential removal) should be embedded in the access token and checked on each protected route — this is what makes "log out all sessions" work without a token blocklist, and it's cheap to add to the existing `users` table.
- **Do not conflate WebAuthn ceremony state with session state.** webauthn-rs needs a short-lived server-side (or signed-cookie) "in-progress ceremony" state between the `/webauthn/options` and `/webauthn/verify` calls (a `PasskeyRegistration`/`PasskeyAuthentication` struct that must round-trip). This is unrelated to the long-lived session token issued *after* verification succeeds — keep them as separate concerns in `routes/auth.rs`.

## Deep Dive 3 — WebAuthn RP Flow with PRF, End-to-End

**Critical, repo-verified finding (HIGH confidence — cross-checked via docs.rs for `webauthn-rs` 0.5.5 and the `webauthn-rs-proto` source on GitHub):**

**`webauthn-rs` 0.5.x has no typed support for the WebAuthn "prf" extension.** `webauthn-rs-proto/src/extensions.rs` defines exactly these extensions:
- Registration: `credProtect`, `uvm`, `credProps`, `minPinLength`, `hmacCreateSecret`
- Authentication: `appid`, `uvm`, `hmacGetSecret`

There is no `prf` field on `RequestRegistrationExtensions`, `RequestAuthenticationExtensions`, `RegistrationExtensionsClientOutputs`, or `AuthenticationExtensionsClientOutputs`. There is no open GitHub issue in `kanidm/webauthn-rs` tracking PRF support at time of research. Note `hmacCreateSecret`/`hmacGetSecret` are **not** the same thing as the browser-facing `prf` extension — those fields correspond to the CTAP2 `hmac-secret` authenticator-extension bytes in `authenticatorData`, which is a lower-level, different (though related) mechanism from the WebAuthn Level-3 JS-facing `prf` extension that browsers expose via `navigator.credentials.{create,get}({ publicKey: { extensions: { prf: {...} } } })`.

**This does not block the project, but it changes exactly where the client/server boundary for extensions sits.** Because the server-side RP never needs to interpret or verify the PRF result (it's consumed entirely client-side, see Deep Dive 2), the missing typed support in webauthn-rs is a non-issue *if* the architecture is built the right way from the start:

1. **Registration (enrollment) with PRF:**
   - Server: `webauthn-rs` `start_passkey_registration()` produces a `CreationChallengeResponse` (serializes to the standard `PublicKeyCredentialCreationOptions` JSON).
   - Client (before calling `navigator.credentials.create`): **manually merge** `{ extensions: { prf: {} } }` into the deserialized JSON (requesting PRF capability, no salt needed at registration time — most authenticators just need the flag set to provision the underlying secret; per-credential salts are supplied later at assertion time).
   - Browser returns a credential whose `getClientExtensionResults().prf.enabled` indicates PRF availability for this credential — read this directly in JS/TS, not via webauthn-rs's typed output (which will simply ignore the unrecognized field).
   - The raw `PublicKeyCredential` response (attestationObject, clientDataJSON, etc. — *not* the prf output) is sent to `webauthn-rs`'s `finish_passkey_registration()` as normal; webauthn-rs doesn't need to know PRF was involved to validate the attestation.
   - Immediately after registration succeeds, do a **first PRF evaluation** (a `navigator.credentials.get()` with `extensions.prf.eval.first = perCredentialSalt`) to obtain the 32-byte PRF output and wrap the User Key under it (`blob_pkN` in the draft's model) — this is a second round-trip the draft's flow diagram doesn't currently show explicitly but is required, since registration alone does not yield a PRF *output*, only PRF *capability*.
2. **Assertion (unlock + login) with PRF:**
   - Server: `start_passkey_authentication()` produces a `RequestChallengeResponse`.
   - Client: merge `{ extensions: { prf: { eval: { first: perCredentialSalt } } } }` into the JSON before calling `navigator.credentials.get()`. The salt should be per-credential (stored server-side as public metadata, e.g. `webauthn_credentials.prf_salt` — already in the draft's data model) so rotating one passkey doesn't affect others.
   - Browser returns both the assertion (signature etc., sent to `finish_passkey_authentication()` for signature verification → session issuance) and `clientExtensionResults.prf.results.first` (32 bytes, consumed only in JS/WASM to unwrap the User Key — never sent to the server).
3. **Practical consequence for the WASM/TS boundary:** the "raw JSON extension injection" step must live in the client wrapper (`apps/web/lib/crypto/webauthn.ts`), not inside `pv-core-wasm`, since it's DOM/browser-API glue, not cryptography — but the salt generation and the PRF-output→wrapping-key derivation belongs inside `pv-core`/`pv-core-wasm` (it already exists as `pv-core/src/prf.rs`).
4. **passkey-rs's ES256-only limitation** (already flagged in the draft as a risk) does not interact with PRF support — PRF/hmac-secret is negotiated independently of the signature algorithm, so this doesn't compound the webauthn-rs gap.

**Recommendation:** treat "raw extensions JSON passthrough" as a first-class, deliberately designed seam in the client WebAuthn wrapper from day one, not a workaround bolted on later — it is the correct architecture given webauthn-rs's current scope, not a stopgap for a future webauthn-rs release. If a future webauthn-rs version *does* add typed PRF support, only `apps/web/lib/crypto/webauthn.ts` should need to change (it can then trust the typed output over the manually-parsed one).

## Deep Dive 4 — WASM Boundary Design (pv-core → Next.js)

**API granularity — expose operations, not primitives.** The wasm-bindgen surface should mirror the "operation" level of `pv-core`'s existing modules (`kdf`, `keys`, `prf`, `items`), not expose low-level types like raw byte buffers for keys crossing the boundary as loosely-typed arrays. Concretely, `pv-core-wasm` should expose something like:

```rust
// pv-core-wasm/src/lib.rs — illustrative shape, not final API
#[wasm_bindgen]
pub struct VaultSession { /* holds UserKey internally, never exposed */ }

#[wasm_bindgen]
impl VaultSession {
    pub fn unlock_with_password(email: &str, password: &str, kdf_params: JsValue, wrapped_uk: JsValue) -> Result<VaultSession, JsError>;
    pub fn unlock_with_prf(prf_output: &[u8], wrapped_uk: JsValue) -> Result<VaultSession, JsError>;
    pub fn encrypt_item(&self, plaintext_json: &str) -> Result<JsValue, JsError>; // returns {enc_key, enc_data}
    pub fn decrypt_item(&self, enc_item: JsValue) -> Result<String, JsError>;
    pub fn lock(self); // consumes self, drop triggers zeroize
}
```

The `VaultSession` handle — not raw key bytes — is what the TS layer holds. This means the *unwrapped User Key never exists as a JS-visible value at any point*; it lives exclusively inside wasm linear memory for the lifetime of the `VaultSession` object, and `Drop`/`ZeroizeOnDrop` (already used throughout `pv-core`, per the codebase map) clears it when the session is dropped or the tab is locked/closed.

**Memory/zeroization caveats specific to WASM (cross-checked, MEDIUM confidence):**

1. **Zeroize works correctly *inside* wasm linear memory.** `Zeroize`/`ZeroizeOnDrop` perform ordinary writes to the module's own linear memory (a flat `ArrayBuffer` under the hood); this is unaffected by compiling to wasm32 and works exactly as it does natively. This is not the risk.
2. **The risk is anything that crosses the JS/wasm boundary via `wasm-bindgen`'s default (de)serialization.** Passing a `&[u8]` into wasm is zero-copy (a view into linear memory), but *returning* data to JS as a `Vec<u8>`/`String`/`JsValue` (e.g. via `serde-wasm-bindgen` or `#[wasm_bindgen]` return types) **allocates a new JS-heap object** — a copy that lives outside wasm's control, subject to the JS engine's garbage collector, with no zeroization guarantee and no deterministic free time. Every accidental "just return the key as bytes for convenience" is a plaintext-key copy that JS's GC may retain in memory (or in a heap snapshot/devtools capture) indefinitely.
3. **Practical rule for `pv-core-wasm`:** key material and plaintext must never be a return value or parameter type that becomes a JS-owned copy. Only *derived, safe-to-expose* results (ciphertext blobs, boolean success flags, opaque session handles) should cross the boundary as JS values. Where the PRF output itself (32 raw bytes, sensitive) must cross from the browser's WebAuthn API into wasm, pass it in and immediately consume/zero the JS-side `Uint8Array` (`crypto.getRandomValues`-style buffers can be explicitly zeroed with `.fill(0)` — WebAuthn API results cannot be scrubbed from browser-internal memory, but the app's own copy can and should be).
4. **No mlock-equivalent exists in the browser.** OS-level page-swap protection (which `zeroize`/`secrecy`-style crates rely on natively for defense-in-depth) has no analog for browser tabs — wasm linear memory can be swapped to disk by the OS under memory pressure like any other process memory, and there's nothing the app can do about it. This is an accepted, unavoidable risk of any browser-based zero-knowledge vault (same exposure Bitwarden's own web vault and browser extension have) — document it as a known limitation, don't treat it as a gap unique to this project.
5. **Multi-instance/tab consideration:** if the user has the vault open in two tabs, each gets its own wasm module instance with its own linear memory — there is no shared-memory unlock state across tabs by default (this is a UX question, not a security flaw: each tab must independently unlock).

## Deep Dive 5 — Single-Container Topology

**Static Next.js export + API + WS on one port.** The standard axum pattern (verified against official axum examples and tower-http docs) is:

```rust
let app = Router::new()
    .route("/healthz", get(healthz))
    .nest("/api", api_routes(state.clone()))
    .route("/sync/stream", get(ws_upgrade_handler))
    .fallback_service(
        ServeDir::new("./static")
            .not_found_service(ServeFile::new("./static/index.html")) // SPA/export fallback
    );
```

Since the web app is a Next.js **static export** (not SSR), this is straightforward: `next build && next export` (or `output: 'export'` in `next.config`) produces a plain `dist/`-style directory that `tower-http::ServeDir` serves as-is, with a fallback to `index.html` for client-side routes. Embedding the static assets *into the binary itself* (via `rust-embed` or `include_dir!`) is an option for a truly single-artifact deploy, but for a Docker-based "1 container" deployment (the project's actual constraint, not "1 binary"), serving from a directory baked into the image at build time is simpler and avoids bloating compile times — recommend `ServeDir` over binary-embedding for v0.1, revisit embedding only if the project later wants a single downloadable binary distribution outside Docker.

**Migrations on boot.** `sqlx::migrate!()` embeds `.sql` files into the server binary at compile time (already partially in place — `0001_init.sql` exists) and running `sqlx::migrate!().run(&pool).await` before the router starts accepting connections is the standard, correct pattern — this is what the existing `pv-server/src/main.rs` should do for every future migration, no separate migration step/tooling needed in the Docker entrypoint.

**Backup story.** For a SQLite-on-a-volume single container, the standard self-hosted pattern (used across the Vaultwarden-adjacent homelab ecosystem) is **Litestream** running as a co-process in the same container (not a sidecar container, to preserve "1 container"), continuously streaming WAL changes to an external target (S3-compatible, SFTP, or a second local path for simple cases). Two important caveats surfaced in research:
- SQLite + WAL mode requires the database file to sit on **local** storage (a Docker named volume backed by local disk is fine; a network-filesystem-backed bind mount, common with Docker Desktop on macOS/Windows, can corrupt the WAL) — worth a callout in self-host docs.
- Litestream is a good default recommendation to *document* (README/self-host guide) rather than bundle as a hard requirement — keep the "zero required external services" promise intact by making the backup target configurable/optional (a simple periodic `.sqlite` file copy to the volume is an acceptable v0.1 fallback; Litestream integration can be a v0.2+ polish item once there's a real user base worried about data loss).

## Architectural Patterns

### Pattern 1: Crypto Trust Boundary as a Single Import Choke Point

**What:** All key material and plaintext operations are confined to one module (`pv-core` natively, `pv-core-wasm` + its thin TS wrapper on the client) that is the *only* thing in the codebase allowed to import the wasm bindings directly.
**When to use:** Any zero-knowledge client where "the server never sees X" is a security claim, not just a preference.
**Trade-offs:** Slightly more boilerplate at the TS boundary (typed request/response DTOs instead of ad-hoc object passing) in exchange for an auditable, enforceable trust boundary — a code reviewer (or a future security audit, already flagged as a pre-v1.0 need in PROJECT.md) can grep for wasm imports outside this one directory and be done.

### Pattern 2: Metadata-Only Push, Data-Pull-on-Demand

**What:** WebSocket/push channel carries only `{id, revision, change_type}` notifications; actual encrypted payloads always travel over the authenticated REST path.
**When to use:** Any sync system where the push channel's availability/reliability guarantees are weaker than the REST API's (reconnects, missed messages, etc.).
**Trade-offs:** One extra round-trip per change vs. pushing full payloads over WS, but massively simplifies WS auth/encryption concerns (the WS channel never needs to carry anything sensitive) and sidesteps WS message-ordering/delivery-guarantee complexity entirely — the client can always fall back to a full `GET /sync` if it suspects it missed a push.

### Pattern 3: Login/Unlock as Two Independent State Machines Sharing One Ceremony

**What:** Server-side session issuance (login) and client-side key unwrapping (unlock) are modeled as separate concerns that happen to share a single WebAuthn ceremony's output when using a passkey, but are two separate steps when using a password.
**When to use:** Any password manager supporting multiple unlock methods (password + N passkeys) where the server needs a uniform way to issue sessions regardless of which method was used.
**Trade-offs:** Slightly more state to track (ceremony state vs. session state vs. unlock state) but avoids conflating "the user is who they say they are" with "the vault is now readable," which is the correct security model — an attacker who steals a session token still cannot read the vault.

## Data Flow

### Registration Flow (password + first passkey, PRF-enabled)

```
User submits email+password
    → pv-core-wasm: Argon2id(password, salt) → masterKey
    → pv-core-wasm: HKDF(masterKey, "pw-unlock") → wrappingKey
    → pv-core-wasm: generate UserKey, wrap under wrappingKey → blob_pw
    → POST /api/auth/register {email, kdf_params, salt, blob_pw, login_hash}
    → server stores users row, issues session

User adds a passkey (enrollment)
    → GET /api/webauthn/register/options → CreationChallengeResponse
    → client merges {extensions:{prf:{}}} into options JSON
    → navigator.credentials.create(...) → credential + prf.enabled
    → POST /api/webauthn/register/verify {credential} → webauthn-rs verifies
    → client: navigator.credentials.get({extensions:{prf:{eval:{first:salt}}}})
        → prf.results.first (32B) → HKDF → wrappingKey2
        → pv-core-wasm: wrap UserKey under wrappingKey2 → blob_pk1
    → POST /api/webauthn/credentials/{id}/prf {prf_salt, blob_pk1}
```

### PRF Unlock + Login Flow (steady state)

```
User clicks "Unlock with passkey"
    → GET /api/webauthn/authenticate/options → RequestChallengeResponse
    → client merges {extensions:{prf:{eval:{first: stored_salt}}}}
    → navigator.credentials.get(...) → assertion + prf.results.first
    → [parallel, client-side only] prf.results.first → HKDF → unwrap blob_pkN → UserKey
        → pv-core-wasm: VaultSession ready, vault decryptable locally
    → [server round-trip] POST /api/webauthn/authenticate/verify {assertion}
        → webauthn-rs verifies signature (never sees prf.results)
        → server issues access_token + refresh_token
    → client now has both a valid session (for API calls) and an unlocked vault (for display)
```

### Sync Flow (steady state, one item edited on Device A)

```
Device A: user edits item
    → pv-core-wasm: encrypt_item() → {enc_key, enc_data}
    → PUT /api/items/{id} {enc_key, enc_data} → server bumps item.revision, user.revision
    → server: broadcast {item_id, revision, change_type: "update"} on user's WS channel

Device B: connected via WS /sync/stream
    → receives {item_id, revision, "update"}
    → GET /api/items/{id} (or GET /sync if revision gap is large)
    → pv-core-wasm: decrypt_item() → merges into local state
```

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|---------------------------|
| Solo/family (this project's actual target) | SQLite + WAL, in-process broadcast channel for WS, full-snapshot `/sync` — everything in the draft is correctly sized for this |
| Small self-hosted community instance (tens of accounts) | SQLite still fine; consider connection pool sizing (already capped at 8 in `AppState`); no architecture change needed |
| Larger self-hosted (hundreds+, hypothetical) | Postgres (already an SQLx-supported swap per the draft); WS broadcast would need a backplane (Redis) if horizontally scaled across instances — explicitly out of scope for this project's "1 container" positioning, not worth designing for now |

### Scaling Priorities

1. **First bottleneck (theoretical, not expected in practice):** full-snapshot `/sync` payload size if a user accumulates thousands of items — mitigated by the per-item `revision` field already in the draft's data model enabling client-side incremental merge even though the wire format is a full pull.
2. **Second bottleneck:** SQLite write concurrency under WAL is fine for this workload (single-writer-at-a-time is not a real constraint for a personal/family vault); not worth Postgres migration pressure at target scale.

## Anti-Patterns

### Anti-Pattern 1: Building Real Delta/CRDT Sync for v0.1

**What people do:** Over-engineer conflict-free replicated data types or field-level diffing because "sync" sounds like it needs it.
**Why it's wrong:** Neither Bitwarden nor Vaultwarden do this; it's substantial complexity (merge logic, conflict UX, vector clocks or similar) with no validated user need at solo/family scale, and it delays the v0.1 milestone for a capability the reference ecosystem doesn't even have.
**Do this instead:** Full-snapshot pull gated by a cheap revision check, last-write-wins at the item level, WS push carries only change notifications. Revisit only if real multi-device conflict pain shows up post-v0.1.

### Anti-Pattern 2: Letting webauthn-rs's Typed Extensions Dictate the PRF Design

**What people do:** Wait for or work around a library's typed extension support before implementing a feature the spec already allows via passthrough.
**Why it's wrong:** webauthn-rs's lack of typed `prf` support is irrelevant to whether PRF works — the server never needs to interpret the PRF value. Treating this as a blocker (or building an awkward workaround) misunderstands where the trust boundary actually is.
**Do this instead:** Design the raw-JSON-extension-passthrough seam in the client WebAuthn wrapper as the intended architecture from day one (see Deep Dive 3).

### Anti-Pattern 3: Returning Raw Key Bytes from WASM to JS "For Convenience"

**What people do:** Expose a `get_user_key_bytes() -> Vec<u8>` style function from the wasm module because it's easier to debug or pass around in JS.
**Why it's wrong:** Any `Vec<u8>`/`String`/plain-object return value crossing `wasm-bindgen` becomes a JS-heap-owned copy outside Rust's `Zeroize` guarantees, defeating the entire memory-hygiene design already built into `pv-core` (see WASM Boundary Design above).
**Do this instead:** Expose only opaque session handles and pre-derived, safe-to-expose results (ciphertext, booleans) across the boundary; keep every "raw key bytes" value inside wasm linear memory for its entire lifetime.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|----------------------|-------|
| None required for v0.1 core | — | Matches the "1 container, no required external services" constraint; even backup (Litestream) should be optional/documented, not wired as a hard dependency |
| Browser WebAuthn API | `navigator.credentials.create/get` with raw `extensions.prf` JSON passthrough | See Deep Dive 3 — this is a browser API, not a network service |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|----------------|-------|
| Next.js app ↔ pv-core-wasm | Direct in-process wasm-bindgen calls (no network) | Only via the `apps/web/lib/crypto/` choke point (Pattern 1) |
| Next.js app ↔ axum API | REST/JSON over HTTPS, ciphertext blobs only | Session token via `Authorization` header |
| Next.js app ↔ axum WS | WSS, metadata-only notifications | Auth via same session token at upgrade time |
| axum routes ↔ webauthn-rs | In-process function calls | Ceremony state (challenge) must round-trip between `/options` and `/verify` calls — server-side session/signed-cookie, separate from the long-lived auth session |
| axum routes ↔ SQLx/SQLite | In-process pool | All secret-shaped columns are ciphertext or hashes; no plaintext ever written |

## Build Order Implications

Derived directly from the dependency structure above, refining the milestone context's own intuition ("auth before sync, WASM bindings before web app crypto"):

1. **`pv-core-wasm` bridge crate + build pipeline** (wasm-pack, TS type generation) — nothing client-side can proceed without this; it's pure unlock of downstream work, no product-visible output yet.
2. **Password login + session/token issuance** (server: `routes/auth.rs` register/login/session middleware; client: `lib/crypto/vault-session.ts` password path) — establishes the session machinery in its simplest form (no WebAuthn ceremony state to juggle yet) and is a prerequisite for every authenticated endpoint after it.
3. **Vault item CRUD over REST** (`routes/items.rs` + client encrypt/decrypt calls through pv-core-wasm) — exercises the full zero-knowledge round-trip (encrypt client-side → opaque blob → store → fetch → decrypt client-side) with the simplest possible auth already in place from step 2.
4. **WebAuthn registration + PRF enrollment** (server: `routes/auth.rs` webauthn endpoints using webauthn-rs; client: `lib/crypto/webauthn.ts` with raw extensions passthrough) — depends on step 2's session model (a logged-in user enrolls a passkey) and step 1's PRF wrap/unwrap primitives (already in `pv-core/src/prf.rs`).
5. **PRF unlock + WebAuthn login** (the parallel-consumer flow in Deep Dive 2) — depends on step 4 existing; this is where "login" and "unlock" get formally unified into one user gesture.
6. **Sync protocol** (`routes/sync.rs` full-snapshot GET/PUT + revision check, WS `/sync/stream` metadata push) — deliberately last among the core mechanics, since it's additive on top of item CRUD (step 3) and benefits from at least two auth paths (steps 2 and 5) existing to be tested against realistically (multi-device/multi-session scenarios).
7. **Single-container packaging** (Dockerfile serving the Next.js static export via `ServeDir` + migrations-on-boot, already largely mechanical given `sqlx::migrate!()` is in place) — can be scaffolded early (as a thin skeleton) but only finalized once the static export pipeline and all API routes exist; treat as an ongoing "keep it working" concern rather than a discrete late phase, to avoid a large integration-risk step at the end.
8. **Import (Bitwarden JSON/CSV) and TOTP** — purely additive vault-item-shaped features layered on top of steps 3–6; no new architectural surface, safe to sequence last within v0.1.

This ordering keeps every phase's "definition of done" independently demoable (wasm bridge compiles + unit-testable → password auth works end-to-end → vault CRUD works end-to-end → passkey enrollment works → PRF unlock works → multi-device sync works → containerized deploy works), which matters for a solo-maintainer project where partial-phase interruption should still leave something working.

## Sources

- `docs/ARCHITECTURE.md` (existing project draft, validated against this research)
- `.planning/codebase/ARCHITECTURE.md` (current code state)
- [webauthn-rs GitHub repository](https://github.com/kanidm/webauthn-rs) — repo structure, no PRF-specific issue found
- [webauthn-rs-proto extensions.rs source](https://raw.githubusercontent.com/kanidm/webauthn-rs/master/webauthn-rs-proto/src/extensions.rs) — confirms exact extension set (no `prf` field), HIGH-confidence primary source
- [docs.rs webauthn-rs 0.5.5](https://docs.rs/webauthn-rs/latest/webauthn_rs/) — confirms no PRF mentions in public API docs
- [Corbado — Passkeys & WebAuthn PRF for End-to-End Encryption](https://www.corbado.com/blog/passkeys-prf-webauthn) — PRF salt/context-hashing behavior, registration-time vs retroactive PRF enablement
- [Yubico Developers Guide to PRF](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html) and [CTAP2 HMAC Secret Deep Dive](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/CTAP2_HMAC_Secret_Deep_Dive.html) — PRF/hmac-secret relationship
- [Bitwarden Contributing Docs — Authentication deep dive](https://contributing.bitwarden.com/architecture/deep-dives/authentication/) — login vs unlock, OAuth2 password grant, token claims (MEDIUM confidence, single-source but official)
- [Bitwarden Contributing Docs — Push Notifications](https://contributing.bitwarden.com/architecture/deep-dives/push-notifications/) and [Other Client Push Notifications](https://contributing.bitwarden.com/architecture/deep-dives/push-notifications/non-mobile/) — SignalR hub, Redis backplane, Web Push migration (MEDIUM confidence)
- [DeepWiki — dani-garcia/vaultwarden Core Vault API](https://deepwiki.com/dani-garcia/vaultwarden/3.1-core-api) — full-snapshot `/sync`, `CipherSyncData` optimization (LOW-MEDIUM confidence, third-party-generated documentation, not primary source)
- [Litestream Docker guide](https://litestream.io/guides/docker/) and [benbjohnson/litestream-docker-example](https://github.com/benbjohnson/litestream-docker-example) — single-container backup pattern, WAL-on-local-storage caveat
- [axum static-file-server example](https://github.com/tokio-rs/axum/blob/main/examples/static-file-server/src/main.rs) and [tower-http ServeDir SPA fallback discussion](https://github.com/tokio-rs/axum/discussions/1309) — static serving pattern
- [sqlx::migrate! macro docs](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html) — embedded migrations pattern
- [wasm-bindgen — Zero-garbage memory transfers issue #495](https://github.com/wasm-bindgen/wasm-bindgen/issues/495) — JS-heap copy/GC-pressure behavior of the JS/wasm boundary
- General WASM memory model background: [A practical guide to WebAssembly memory](https://radu-matei.com/blog/practical-guide-to-wasm-memory/), [WebAssembly.org design discussion #1397](https://github.com/WebAssembly/design/issues/1397) (LOW confidence, background context only, not project-specific)

---
*Architecture research for: self-hostable zero-knowledge password manager with passkey provider + PRF unlock*
*Researched: 2026-07-12*
