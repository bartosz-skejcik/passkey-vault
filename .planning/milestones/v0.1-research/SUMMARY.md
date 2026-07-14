# Project Research Summary

**Project:** passkey-vault
**Domain:** Self-hostable, zero-knowledge password manager with first-class passkeys (passkey provider + PRF vault unlock)
**Researched:** 2026-07-12
**Confidence:** MEDIUM-HIGH

## Executive Summary

passkey-vault is a Vaultwarden-class self-hosted password manager whose entire differentiation rests on two things nobody else ships well: PRF-based passkey vault unlock as the *primary*, first-class unlock path (not a hidden/broken option, as in Vaultwarden and official Bitwarden), and — in v0.2 — a full passkey *provider* (both `create` and `get`, not just `get`) via a browser extension. Experts building this class of product (validated against Bitwarden/Vaultwarden's own architecture docs) split cleanly into three layers with the crypto boundary drawn hard between client and server: a Rust `pv-core` crate compiled to WASM does every KDF/wrap/unwrap/encrypt/decrypt operation client-side, an axum server acts purely as an authenticated, opaque-blob relay (never seeing plaintext or key material), and a Next.js static-export UI is a dumb shell around the WASM core. The stack already locked in the project's own docs holds up under version-drift and library-capability scrutiny, with two decisions to make explicit before implementation starts: Next.js 15 (legacy-maintenance) vs 16 (current, low migration cost given static export), and confirming `webauthn-rs` 0.5's total lack of typed PRF support is a *non-issue* — the correct architecture is raw-JSON-extension passthrough in the client wrapper, not a workaround to route around later.

The recommended v0.1 build order follows the crypto trust boundary outward: WASM bridge crate first (nothing else can proceed without it), then password login/session machinery (simplest auth path, establishes the session model), then vault CRUD (exercises the full zero-knowledge round-trip), then WebAuthn+PRF registration, then PRF unlock/login unification, then sync, then packaging — with import/export and TOTP layered on last since they're purely additive. This ordering is deliberately chosen so each phase is independently demoable, which matters for a solo-maintainer project.

The dominant risk category is not "will the crypto work" but "will the *invariants* around the crypto hold under real usage and real self-host deployment topology." The single highest-severity risk is the passkey-deletion footgun: a user's User Key must never have its only wrapped copy be a passkey, and this must be a server-enforced invariant, not documentation. Close behind are: zero-knowledge violations leaking through "boring" infrastructure (logs, missing AEAD associated-data binding, unauthenticated server-returned key material — the exact class of finding from USENIX Security 2026's audit of Bitwarden/LastPass/Dashlane); WASM JS-boundary memory copies that bypass Rust's `zeroize` guarantees entirely; and a cluster of self-host deployment footguns (RP ID/origin mismatch behind reverse proxies, WebSocket header/timeout forwarding) that are invisible in dev and immediately visible to the self-hoster audience this product targets. All of these are v0.1-phase concerns — they must be designed in from day one, not retrofitted, because retrofitting a trust-boundary rule after code depends on the wrong shape is expensive.

## Key Findings

### Recommended Stack

The stack already pinned in the project's `Cargo.toml`/docs is sound and current: axum 0.8.9, SQLx 0.8.6 (stay off the just-released, breaking 0.9.0 for v0.1), webauthn-rs 0.5.5 (SUSE-audited, powers Kanidm — highest-confidence Rust WebAuthn RP available), and the RustCrypto primitives (argon2 0.5, chacha20poly1305, hkdf, zeroize, sha2) already in `pv-core`. Two low-risk version bumps are worth doing early as a dedicated PR: chacha20poly1305 0.10→0.11 and hkdf 0.12→0.13. WASM tooling should use `wasm-bindgen-cli` invoked directly (not `wasm-pack`, whose npm-publish-oriented pipeline is unneeded overhead here and which lags `wasm-bindgen` releases since the rustwasm org sunset) — critically, the `wasm-bindgen` crate version and `wasm-bindgen-cli` binary version must match exactly (schema-versioned protocol, silent build failures otherwise). TOTP generation belongs in `pv-core` (via `totp-rs`, WASM-exported) to keep exactly one audited crypto surface, not a second TypeScript implementation. CSV import parsing (Papa Parse) and Bitwarden-JSON parsing are the correct exception — they touch no secret material before the encryption boundary, so a battle-tested JS parser is lower-risk than reinventing it in Rust.

**Core technologies:**
- axum 0.8.9 + SQLx 0.8.6 (SQLite default) — server/DB layer, both current and stable, stay off SQLx 0.9 (breaking `SqlSafeStr` change) for v0.1
- webauthn-rs 0.5.5 — WebAuthn RP; has no typed PRF support by design scope, not a defect — server never needs to interpret PRF anyway
- `pv-core` (Rust) → `wasm-bindgen`/`wasm-bindgen-cli` (pinned exact version match) — the entire crypto trust boundary, compiled to WASM
- Next.js (15 legacy-maintenance vs 16 current — **needs an explicit pre-web-phase decision**, see Concerns below) with `output: "export"` — no SSR, ever, since zero-knowledge means the server/Node layer must never see plaintext
- `tower-http::ServeDir` in axum — serves the static Next.js export from the same binary/port as the API, eliminating any Node runtime from the production container
- `tokio::sync::broadcast` — in-process WS fan-out for sync push notifications, no Redis needed at solo/family scale

### Expected Features

**Must have (table stakes):** login/card/identity/secure-note/TOTP item types; passkey as a sub-record of a Login item (not a standalone top-level type for v0.1); password generator (2026 NIST-aligned: length-first 15-16+ char default, passphrase mode alongside random-character); folders/tags; instant client-side search; copy-to-clipboard with auto-clear defaulting ON (30-60s — explicitly beats Bitwarden's known-bad "Never" default); configurable auto-lock with a sane non-infinite default; Bitwarden-JSON + generic CSV import (already scoped); plain JSON/CSV **export** (recommend adding to v0.1 — not currently in Active scope, cheap, high trust-signal); multi-device sync; account/session hygiene (enrolled passkeys list, devices/sessions with revoke).

**Should have (differentiators):** PRF vault unlock as the default recommended path (not a hidden toggle); passkey provider create+get (v0.2, extension) — the sharpest edge of the market gap since even Vaultwarden/Psono/KeePassXC either lack this or only support `get`; single-container SQLite-first deployment as a hard constraint on every future feature; flat family-sharing model (no orgs/collections/roles — deliberately lighter than Bitwarden/Vaultwarden/AliasVault); server-side continuous breach monitor (v0.3, vs. Vaultwarden's client-triggered-only HIBP); CXF import/export (v0.4, correctly deferred since the transfer protocol is still draft).

**Defer (v2+):** enterprise SSO/SCIM/policy engines, full orgs/collections/groups, mobile native providers (Android/iOS), Windows MSIX plugin, OPAQUE-based auth (revisit as pre-v1.0 hardening), S3/object storage requirement, native mail/alias server. These are all explicitly Out-of-Scope per PROJECT.md and reconfirmed here as anti-features that would break the "1 container" positioning or pull scope toward the wrong (enterprise) audience.

### Architecture Approach

The system splits into three layers with the crypto trust boundary drawn hard between client and server: `pv-core`/`pv-core-wasm` is not "shared crypto utility," it *is* the trust boundary — every operation touching plaintext or key material must happen inside WASM, never in plain TypeScript, even for convenience. A single choke-point module (`apps/web/lib/crypto/`) is the only code allowed to import the WASM bindings directly, making the boundary auditable by grep. The WASM API surface must expose operations (an opaque `VaultSession` handle with `unlock_with_password`/`unlock_with_prf`/`encrypt_item`/`decrypt_item`/`lock`), never raw key bytes — any `Vec<u8>`/`String` return value crossing `wasm-bindgen` becomes an unzeroizable JS-heap copy, defeating the whole memory-hygiene design.

**Major components:**
1. `pv-core` (native, no I/O) — key hierarchy, KDF (Argon2id), PRF handling, item AEAD encrypt/decrypt; already exists
2. `pv-core-wasm` (NEW, thin wasm-bindgen surface) — curated operation-level API exposed to the client, never raw types
3. `apps/web` (Next.js static export) — dumb UI shell; `lib/crypto/` is the sole choke point importing WASM; `lib/api/` moves ciphertext only
4. axum RP/API layer — session/token issuance, WebAuthn ceremony state (separate from long-lived session state), revision-gated sync, static file serving via `ServeDir`; webauthn-rs verifies signatures only, never sees PRF output
5. SQLite/SQLx data layer — every secret-shaped column is ciphertext or a hash; WAL mode + `busy_timeout` must be explicitly configured (not SQLx/SQLite defaults)

Sync follows the Bitwarden/Vaultwarden pattern exactly: no field-level delta/CRDT — `GET /sync` is a full-snapshot pull gated by a cheap revision check, WS push carries only `{item_id, revision, change_type}` metadata (never ciphertext), and the client reacts to a push with a normal authenticated REST pull. Login and unlock are modeled as two independent concerns: login proves identity to the server (password hash or WebAuthn assertion → session token); unlock decrypts the vault locally (master-key unwrap or PRF-derived unwrap) and the server can never distinguish "vault unlocked" from "wrong password." For the PRF path, a single `navigator.credentials.get()` call serves both login (assertion → server) and unlock (PRF output → local unwrap) in one user gesture — a genuinely better UX than the password path's two separate steps.

### Critical Pitfalls

1. **PRF-derived key becomes the only copy of the User Key** — a user's OS deletes/resets a passkey outside the app with zero warning, and the wrapped User Key becomes permanently unrecoverable. Avoid by enforcing (server- and client-side) that every account always has a non-null password/recovery-code wrap; block any deletion that would leave the vault with only device-bound/unsynced passkeys and no verified password fallback; never ship a passkey-only account mode.
2. **MAIN-world `navigator.credentials` patch collides with other password-manager extensions and is exploitable by page scripts** (v0.2, extension) — confirmed via real Bitwarden/1Password GitHub incidents and a disclosed Permissions-Policy bypass. Avoid by detecting existing patches before installing your own, and doing all policy/origin validation in the isolated-world/background context, never in MAIN-world JS which lives in the same execution context as attacker page code.
3. **Zero-knowledge boundary violated through "boring" infrastructure** — logs that dump request bodies, missing AEAD associated-data binding between ciphertext and its metadata (item/field identity), and unauthenticated server-returned public keys/wrap blobs during recovery/rotation — this is the exact class of design flaw USENIX Security 2026 found across Bitwarden/LastPass/Dashlane under a malicious-server threat model, not implementation typos. Avoid by treating every server response the client trusts as attacker-controlled, binding ciphertext to item ID + revision + field name via AEAD AD, and allow-listing (not deny-listing) what tracing middleware logs on vault-data routes.
4. **WASM JS-boundary copies bypass `zeroize` entirely** — every secret crossing `wasm-bindgen` (e.g. PRF output as a JS `ArrayBuffer`) creates a JS-heap copy Rust has zero control over and no zeroization guarantee for. Avoid by minimizing round-trips (PRF bytes in once, fully-unwrapped session out), never returning raw key bytes as a WASM export, and best-effort-zeroing any JS-side buffer immediately after passing it into WASM.
5. **Self-host deployment traps invisible in dev** — RP ID/origin mismatch when a reverse-proxy domain differs from an internally-configured value (generic `SecurityError`, terrible support signal); WebSocket `Upgrade`/`Connection` headers not forwarded by default proxy configs, plus default 60s idle timeouts killing the sync socket. Avoid by requiring an explicit `RP_ID`/`PUBLIC_URL` env var (fail loudly at startup if unset for non-localhost), shipping tested reference nginx/Caddy configs, and sending WS ping/pong more frequently than common default proxy timeouts.

## Implications for Roadmap

Based on research, suggested phase structure for v0.1 (server + web app):

### Phase 1: WASM Crypto Bridge
**Rationale:** Nothing client-side can proceed without this; pure unlock of downstream work, independently testable, no product-visible output yet.
**Delivers:** `pv-core-wasm` bridge crate exposing a curated `VaultSession` API (opaque handles only, no raw key bytes ever crossing the boundary); build pipeline (`wasm-bindgen-cli` pinned to exact crate version) wired into the Next.js/monorepo build.
**Avoids:** Pitfall 6 (WASM zeroization illusions / JS-boundary copies) — the API shape decision (minimize round-trips, opaque handles) is cheap now, expensive to change once clients depend on it.

### Phase 2: Password Login + Session Machinery
**Rationale:** Simplest auth path (no WebAuthn ceremony state to juggle yet); establishes the session/token model every later authenticated endpoint depends on.
**Delivers:** `routes/auth.rs` register/login, session middleware, `sessions` table with revocable refresh tokens and a security-stamp claim for "log out everywhere."
**Uses:** axum 0.8, SQLx 0.8 with WAL mode + `busy_timeout` explicitly configured at pool init (Pitfall 7 — not SQLite/SQLx defaults).
**Implements:** Login/Unlock as two independent state machines (Architecture Pattern 3).

### Phase 3: Vault Item CRUD
**Rationale:** Exercises the full zero-knowledge round-trip (encrypt client-side → opaque blob → store → fetch → decrypt client-side) against the simplest auth already in place.
**Delivers:** Login/card/identity/secure-note/TOTP item types with AEAD associated-data binding (item ID + revision + field name) baked in from the start — not deferred.
**Addresses:** Table-stakes item taxonomy (FEATURES.md), plain JSON/CSV export (recommended v0.1 addition).
**Avoids:** Pitfall 5 (zero-knowledge violations via missing AD binding) — cheap to add now, never acceptable to skip per PITFALLS.md's technical-debt table.

### Phase 4: WebAuthn Registration + PRF Enrollment
**Rationale:** Depends on Phase 2's session model (a logged-in user enrolls a passkey) and Phase 1's PRF wrap/unwrap primitives.
**Delivers:** Two-ceremony enrollment (create → detect `enabled`, then get → obtain actual PRF bytes → wrap User Key), raw-JSON-extension passthrough in `lib/crypto/webauthn.ts` (the intended architecture given webauthn-rs 0.5's extension scope, not a workaround).
**Avoids:** Pitfall 3 (conflating PRF `enabled` with secret availability) and Pitfall 1's enrollment-time half — every enrollment must produce a verified password/recovery wrap alongside the passkey wrap, enforced server-side.

### Phase 5: PRF Unlock + WebAuthn Login (unified)
**Rationale:** Depends on Phase 4 existing; this is where login and unlock get formally unified into one user gesture (one `navigator.credentials.get()` serving both).
**Delivers:** PRF-as-primary unlock UX with mandatory, non-generic fallback messaging (browser/OS support matrix is a moving target — Pitfall 4); server-enforced invariant blocking deletion of the last non-password wrap recipient (the passkey-deletion footgun, Pitfall 1 — the single highest-severity item in the whole roadmap).
**Avoids:** Pitfall 1 (PRF-as-sole-key-copy), Pitfall 4 (silent PRF support-matrix drift).

### Phase 6: Sync Protocol
**Rationale:** Additive on top of item CRUD (Phase 3); benefits from at least two working auth paths (Phases 2 and 5) to test multi-device/multi-session scenarios realistically. Deliberately sequenced last among core mechanics.
**Delivers:** Full-snapshot `GET/PUT /sync` gated by a per-user revision counter + per-item revision for client-side merge; WS `/sync/stream` carrying metadata-only push notifications (never ciphertext); last-write-wins conflict handling (no CRDT — Anti-Pattern 1).
**Uses:** `tokio::sync::broadcast` keyed by user (no Redis needed at this scale).

### Phase 7: Single-Container Packaging + Self-Host Docs
**Rationale:** Can be scaffolded early as a thin skeleton (ongoing "keep it working" concern) but only finalized once the static export pipeline and all API routes exist; avoid a large integration-risk step at the very end.
**Delivers:** Multi-stage Dockerfile (Rust builder → Node/Next.js static-export builder → minimal runtime with only the axum binary + static assets + SQLite volume mount); `sqlx::migrate!()` on boot; documented, tested reference nginx/Caddy reverse-proxy configs with WebSocket header forwarding and appropriate timeouts pre-filled; explicit required `RP_ID`/`PUBLIC_URL` env var that fails loudly at startup if misconfigured; documented WAL-aware backup procedure (not plain file copy).
**Avoids:** Pitfall 8 (RP ID/origin mismatch, WebSocket proxy misconfiguration) and the "backup = file" trap in Pitfall 7 — both explicitly called out as never-acceptable-to-skip since self-host deployment topology is this audience's default environment, not an edge case.

### Phase Ordering Rationale

- **Crypto boundary outward, not feature-by-feature:** the build order in ARCHITECTURE.md's Deep Dive follows dependency structure (WASM bridge → auth → CRUD → WebAuthn/PRF → sync → packaging), not a feature checklist — this keeps every phase independently demoable, which matters for a solo-maintainer project where partial-phase interruption should still leave something working.
- **Password path before PRF path:** establishes session/token machinery in its simplest form before adding WebAuthn ceremony-state complexity on top.
- **AEAD associated-data binding and the passkey-deletion invariant are not separate "hardening" phases** — both must be baked into Phase 3 and Phase 4/5 respectively from day one; PITFALLS.md explicitly marks both "never acceptable" to defer given the technical-debt-vs-cost analysis.
- **Import/export and TOTP are purely additive** and correctly sequenced last within v0.1 (no new architectural surface).

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4/5 (WebAuthn + PRF):** the browser/OS PRF support matrix is explicitly a moving target (Windows Hello only gained PRF-on-`get` broadly after a Feb 2026 KB update; Safari iOS has a structural roaming-authenticator gap) — verify current-state support matrix at planning time, not from this research's snapshot.
- **Phase 7 (packaging):** Next.js 15-vs-16 decision needs to be made explicitly before scaffolding the web app phase (15 is legacy-maintenance-only as of this research); also verify Turbopack's WASM dynamic-import behavior specifically if scaffolding on Next 16 (flagged LOW-confidence gap in STACK.md).
- **Phase 6 (sync):** if v0.1 timeline is tight, STACK.md flags a legitimate scope-cut — ship pure poll-based `GET /sync` first and defer the WS push optimization to a follow-up phase.

Phases with standard patterns (skip research-phase):
- **Phase 1 (WASM bridge):** wasm-bindgen/wasm-bindgen-cli tooling and version-pinning discipline is well-documented; direct, mechanical setup.
- **Phase 2 (password login):** Bitwarden's login/unlock split is a well-verified, directly-transferable reference pattern.
- **Phase 3 (vault CRUD):** standard REST CRUD over opaque ciphertext blobs; the one non-standard addition (AEAD AD binding) is well-specified in this research.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM-HIGH | Crate/npm versions verified directly against registry APIs (HIGH); integration patterns (WASM tooling, Docker packaging, WS broadcast) cross-checked via web search but not all independently re-fetched from primary source (MEDIUM) |
| Features | MEDIUM-HIGH | Built on project's own HIGH-confidence prior competitive research (docs/RESEARCH.md); UX conventions (generator, autofill, lock behavior) cross-checked against 2+ independent sources (MEDIUM) |
| Architecture | MEDIUM | HIGH for repo-verified facts (webauthn-rs's actual extension set, confirmed via primary source); MEDIUM for cross-checked Bitwarden architecture patterns (official but single-source docs); LOW/directional for some sync-protocol specifics (third-party-generated Vaultwarden documentation, not primary source) |
| Pitfalls | MEDIUM | Mix of cross-checked findings (PRF encryption-key warnings from 2+ independent authors, real GitHub incident numbers for extension conflicts, primary USENIX Security 2026 coverage) and single-source signals (some WASM zeroization specifics, some SQLite backup guidance) |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Next.js 15 vs 16:** not resolved by this research — flagged as an explicit decision to make before scaffolding the web app phase. Recommend 16 given low migration cost under static export and 15's legacy-maintenance status, but this needs a deliberate team decision, not a default.
- **PRF browser/OS support matrix:** this research's snapshot (mid-2026) will be stale by implementation time given the pace of change (Chrome/Firefox/Windows Hello version-gated PRF support). Treat as a living reference to re-verify at Phase 4/5 planning time, not a fixed fact.
- **`chacha20poly1305` 0.10→0.11 breaking-change surface:** not independently confirmed changelog-clean in this pass — treat as a reviewed PR with crypto tests re-run, not a drive-by bump.
- **Turbopack + WASM dynamic import (if Next 16 chosen):** not independently re-verified for this specific project's import pattern — LOW-confidence gap, flag for Phase 7 planning.
- **Encrypted Bitwarden export import:** explicitly out of v0.1 scope per FEATURES.md recommendation (only unencrypted JSON export supported) — confirm this is an acceptable scope cut with the product owner, not silently under-scoped.
- **totp-rs exact WASM feature-flag names:** not independently re-verified against the crate's current `Cargo.toml` beyond its dependency list — confirm at Phase 8 (import/TOTP) implementation time.

## Sources

### Primary (HIGH confidence)
- crates.io API — direct registry queries for axum, sqlx, webauthn-rs, passkey-rs, totp-rs, credential-exchange-format, zeroize, argon2, chacha20poly1305, hkdf, wasm-bindgen family, getrandom
- npm registry API — tailwindcss, daisyui, next (dist-tags), react, wxt, otpauth, papaparse
- webauthn-rs-proto `extensions.rs` source (GitHub) — confirms exact extension set, no `prf` field
- docs.rs webauthn-rs 0.5.5 — confirms no PRF in public API
- USENIX Security 2026 / ETH Zurich zero-knowledge violations research (via Cyberinsider coverage)

### Secondary (MEDIUM confidence)
- Bitwarden Contributing Docs (authentication, push notifications, passkey/PRF/RP deep dives) — official but single-source
- Corbado PRF/RP-ID explainers, Yubico PRF developer guides
- Tim Cappalli ("Timbits") and Mr. Latte — PRF-for-encryption warning posts (independently corroborating)
- Scott Helme — 1Password Permissions-Policy bypass disclosure
- bitwarden/clients GitHub issues #7436, #14720, #13252 — extension conflict evidence
- Litestream docs, SQLite forum/backup-strategy posts — WAL/backup guidance
- axum/tower-http official examples — static file serving pattern

### Tertiary (LOW confidence)
- DeepWiki (third-party-generated) Vaultwarden Core Vault API documentation — sync protocol specifics, not primary source
- General WASM memory model background articles — context only, not project-specific

---
*Research completed: 2026-07-12*
*Ready for roadmap: yes*
