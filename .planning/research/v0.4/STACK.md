# Stack Research — v0.4 Family & Sharing

**Domain:** Zero-knowledge multi-user sharing layer for an existing Rust/WASM password manager
**Researched:** 2026-07-29
**Confidence:** HIGH (crate versions verified live against crates.io dependency graphs; audit claim verified via web search; all recommendations checked against actual pinned versions in this repo's `Cargo.toml` files, not assumed)

This is an **additive** research pass. It does not revisit anything already shipped (Argon2id, HKDF-SHA256, XChaCha20-Poly1305, ES256/webauthn-rs, axum, SQLx, SQLite) — those are validated and out of scope. It answers exactly one new question: **what does `pv-core` need to let User A encrypt a key to User B, who A has never authenticated with, using only B's public key?**

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `crypto_box` | `0.9.1` (exact-pin `=0.9.1`, matching this repo's existing exact-pin style for crypto crates) | X25519 ECDH + AEAD "box" primitive — the asymmetric layer sharing needs | Only stable public-key-encryption crate in the RustCrypto org (same publisher as `chacha20poly1305`, `hkdf`, `sha2`, `argon2` already pinned here). **Cure53-audited** (funded by Threema, no significant findings, audited at v0.7.1 — the audited code path is unchanged in 0.9.1). Its optional `chacha20` feature swaps the AEAD from XSalsa20Poly1305 to **XChaCha20Poly1305** — the exact cipher `pv-core::keys::aead_seal`/`aead_open` already use. Its dependency graph resolves `rand_core ^0.6` (via `curve25519-dalek 4.x`) and `aead ^0.5` — **identical** to what `chacha20poly1305 =0.10.1` already pulls in. Zero new `rand_core`/`getrandom` lines introduced (verified against live crates.io dependency data, not assumed) |
| new `pv-core::keypair` module (hand-written, no new crate) | n/a | Wraps `crypto_box::{SecretKey, PublicKey}` behind an opaque, `Zeroize`-wrapped type, following the existing `UserKey` pattern in `keys.rs` | Consistent with this codebase's rule: raw key material never gets a `pub` accessor beyond a single `expose()`-style method. `crypto_box::SecretKey` already implements `Zeroize`, so this is a thin wrapper, not new cryptography |

### Supporting Libraries

No new crates are needed for schema (SQLx feature set is unchanged — `sqlite`, `uuid`, `migrate`, `runtime-tokio` already cover everything below) or for invitation tokens (existing `random_bytes()`, `base64` 0.22, `sha2` 0.10 already in `pv-core`/`pv-server` are sufficient — see "Invitation Links" below).

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `chacha20` (optional dep of `crypto_box`) | `^0.9` (pulled in automatically when enabling `crypto_box`'s `chacha20` feature) | Stream cipher backing `ChaChaBox` | Only needs declaring the feature flag: `crypto_box = { version = "=0.9.1", features = ["chacha20"] }`. Do **not** add `chacha20` as a direct dependency — let `crypto_box` own that edge, it already resolves to the same `^0.9` line as `chacha20poly1305`'s own `chacha20` dependency |

## Installation

```toml
# crates/pv-core/Cargo.toml — add to [dependencies]
crypto_box = { version = "=0.9.1", default-features = false, features = ["chacha20", "alloc"] }
```

No `npm install` — this is a Rust workspace crate; the WASM bridge (`pv-wasm`) picks it up transitively once `pv-core` exposes the new keypair/seal API through the existing opaque-handle pattern.

No SQL driver changes — `sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "uuid", "migrate"] }` in `pv-server/Cargo.toml` is unchanged; new tables are just new migration files.

## 1. Asymmetric crypto layer — comparison

The current hierarchy (`pv-core::keys`) is **entirely symmetric**: a wrapping key (from Argon2id or PRF via HKDF) directly seals the `UserKey` with XChaCha20-Poly1305. Sharing breaks this — User A must encrypt *something* (a Collection Key, or a per-item Cipher Key) so that only User B can open it, without A and B ever having exchanged a shared secret out of band. That requires public-key encryption. Three real options exist in the Rust ecosystem; a fourth (roll a custom construction from already-pinned primitives) was considered and rejected.

| Criterion | `crypto_box` 0.9.1 (X25519 sealed-box style) | `hpke` 0.14.0 (RFC 9180) | `rsa` 0.9.10 (RSA-OAEP, Bitwarden's approach) |
|---|---|---|---|
| **Primitive** | X25519 ECDH → HKDF-like key derivation (internal) → XSalsa20Poly1305 or XChaCha20Poly1305 (`chacha20` feature) | DHKEM(X25519 or P-256, HKDF-SHA256) + separately-selected AEAD, per IETF RFC 9180 | RSA-OAEP-SHA1/SHA256, 2048–4096-bit modulus |
| **WASM (`wasm32-unknown-unknown`)** | Yes — pure Rust, no OS syscalls beyond an injected RNG (caller supplies `OsRng`, same as this repo already does for AEAD nonces) | Yes in principle (pure Rust), but its default feature set drags in `ml-kem`/`x-wing` post-quantum KEM code unless explicitly disabled | Yes, but RSA keygen is CPU-heavy in WASM (no hardware accel), and it's a much bigger, harder-to-audit codebase for a browser-embedded core |
| **Audit status** | **Cure53-audited** (Threema-funded, v0.7.1, no significant findings; audited construction unchanged through 0.9.1) | No dedicated third-party audit found; used inside larger audited systems (e.g. MLS implementations) but not independently audited itself | RustCrypto `rsa` crate carries an **open, unfixed advisory**: `RUSTSEC-2023-0071` "Marvin Attack" (timing side-channel key recovery), no patched release as of this research (Feb 2026 was the most recent public status). This repo's own `deny.toml` already documents this advisory as dormant/unreachable via `sqlx-mysql`'s optional `rsa` transitive dep — deliberately adding `rsa` as a *direct*, *actually-compiled* dependency for sharing would turn a currently-inert advisory into a live one |
| **Maintenance** | RustCrypto `nacl-compat` — same org, same cadence as `chacha20poly1305`/`hkdf` already pinned. Stable since Aug 2023 (0.9.0), 3 years in production use | Actively maintained (rozbb/rust-hpke), but **0.14.0 was published 2026-07-09 — 3 weeks before this research**, and its `x25519-dalek` optional KEM pins `^3.0.0`, published 2026-07-06, **also 3 weeks old**. Too fresh to trust for a security-critical layer in a project that otherwise exact-pins everything and tracks dependency graphs by hand | Actively maintained, but the crate's own 0.10 line is still release-candidate (`0.10.0-rc.18`), and the stable 0.9.10 carries the unfixed advisory above |
| **Key sizes / ciphertext overhead** | 32-byte public key, 32-byte secret key, ~48 bytes of AEAD overhead (nonce + tag) per wrapped blob | Similar to `crypto_box` when using the X25519 KEM variant; larger with the P-256 KEM | 2048-bit key = 256-byte ciphertext per wrap — 5-8× the overhead of X25519 for the same security margin, and RSA keygen/storage is the exact complexity Bitwarden's model was already rejected for in this project (see Key Decisions: "Hierarchia kluczy: multi-recipient wrap UK bez warstwy RSA") |
| **Composes with existing `chacha20poly1305`/`hkdf` pins?** | **Yes, exactly.** `chacha20` feature makes it XChaCha20Poly1305 (same cipher, same `chacha20 ^0.9` dependency line already resolved by `chacha20poly1305 =0.10.1`); resolves `rand_core ^0.6` — identical to the existing chain. Verified against live crates.io dependency data, not assumed | **No.** Its optional `hkdf` dependency requires `^0.13` (this repo pins `=0.12.4`) and optional `chacha20poly1305` dependency requires `^0.11.0` (this repo pins `=0.10.1`). Adopting `hpke` would force bumping two already-pinned, already-audited-by-inspection crates as a side effect of an unrelated feature — a version-graph disruption this project's own pinning discipline (`deny.toml` watch-list) exists specifically to avoid | No — RSA needs its own OAEP padding/hashing stack; doesn't touch HKDF or XChaCha20-Poly1305 at all, so it would sit as a fully parallel, second crypto stack next to the existing one |
| **Verdict** | **RECOMMENDED** | Rejected: too new, forces upgrading pinned dependencies, no independent audit | Rejected: open unpatched timing-attack advisory, larger keys, already explicitly rejected in PROJECT.md for the UK-wrapping layer (same reasoning applies here) |

**Why not hand-roll a construction from already-pinned primitives instead of adding `crypto_box`?** A raw `x25519-dalek` ECDH → existing `hkdf`/`chacha20poly1305` composition was also considered — it would technically avoid adding any new crate. It was rejected because (a) `x25519-dalek`'s current stable release (3.0.0) is likewise 3 weeks old and pulls `rand_core ^0.10`, breaking the same dependency-graph alignment `crypto_box` preserves, and (b) hand-composing a KEM out of primitives is exactly the kind of "rolled crypto" a security reviewer would flag — `crypto_box` **is** that composition, already built and independently audited. Using the audited crate instead of re-deriving its logic is the lower-risk choice even though it's technically a "new dependency."

### Integration point in `pv-core`

```text
Existing (unchanged):
  master password → Argon2id → HKDF → wrap UK
  passkey PRF      → HKDF     → wrap UK
  UK → wraps per-item Cipher Key → item (XChaCha20-Poly1305)

New for sharing:
  User B: crypto_box::SecretKey::generate(&mut OsRng) (once, client-side)
    → public key uploaded to server (plaintext, it's public by design)
    → secret key wrapped under B's own UK via the EXISTING aead_seal()
      (new domain-separation constant, e.g. INFO_X25519_SK_WRAP = b"pv:x25519-sk-wrap:v1")
      → stored server-side as `x25519_wrapped_sk` blob, same shape as `pw_wrapped_uk`

  User A shares a Collection Key CK with User B:
    ephemeral_sk = crypto_box::SecretKey::generate(&mut OsRng)   // used once, discarded
    box = ChaChaBox::new(&B_public_key, &ephemeral_sk)
    ciphertext = box.encrypt(nonce, CK)
    → store {ephemeral_pk, nonce, ciphertext} — this IS the sealed-box pattern
      (crypto_box has no built-in `seal()`, so the ephemeral-keypair-per-share
      wrapper is hand-written in pv-core, ~15 lines, mirroring what libsodium's
      crypto_box_seal does internally)
    ephemeral_sk is zeroized immediately after use — never stored, never reused
```

This is a **new sibling wrapping mechanism**, not a replacement — `WrappedKey` (nonce+ciphertext, symmetric) stays exactly as-is for the password/PRF recipients on `UserKey`; a new `SealedKey` type (ephemeral_pk + nonce + ciphertext) is added alongside it for the asymmetric recipients on shared Collection/item keys. Both ultimately produce plaintext key bytes the same way the rest of `pv-core` already expects.

## 2. SQLite schema / SQLx changes

No SQLx version or feature change — same `sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite", "uuid", "migrate"] }`. This is additive migrations only, continuing from `0013_passkey_counter_anomaly.sql`.

### New tables (shape, not final DDL — for the roadmap/planner to size phases against)

| Table | Purpose | Key columns |
|---|---|---|
| `user_keypairs` | One X25519 identity per user, generated client-side at first-share-or-invite-accept time | `user_id` (PK/FK → users), `public_key BLOB`, `wrapped_secret_key TEXT` (JSON `SealedKey`-shape blob, wrapped under that user's own UK — server never unwraps it) |
| `families` | The sharing group itself | `id`, `owner_user_id`, `name`, `created_at` |
| `family_members` | Membership + role | `family_id`, `user_id`, `role CHECK (role IN ('owner','member'))`, `joined_at` — composite PK `(family_id, user_id)` |
| `family_invites` | One-time invite tokens (§3) | `id`, `family_id`, `token_hash BLOB NOT NULL UNIQUE`, `created_by`, `expires_at`, `used_at` (NULL = still valid) |
| `collections` | Shared folder | `id`, `family_id`, `enc_name TEXT` (wrapped under the Collection Key, same pattern as existing `folders.enc_name`) |
| `collection_keys` | Per-recipient wrapped Collection Key — the fan-out point | `collection_id`, `recipient_user_id`, `sealed_key TEXT` (JSON `SealedKey`: ephemeral_pk+nonce+ciphertext), `access_level CHECK (access_level IN ('read','edit','hidden_password'))` — composite PK `(collection_id, recipient_user_id)` |
| `item_shares` | Direct single-item share, bypassing collections | Same shape as `collection_keys` but keyed on `(item_id, recipient_user_id)`; item's existing `enc_key` (Cipher Key wrapped under owner's UK) gets **additional** rows here, one `SealedKey` per direct recipient, wrapping the *same* Cipher Key |

**Critical modeling point**, directly reusing what already exists: today `vault_items.enc_key` = Cipher Key wrapped once, under the owner's UK. For a shared item, the Cipher Key does **not change** — it just gets wrapped *additional* times, once per recipient (in `collection_keys` or `item_shares`), the same multi-recipient pattern `webauthn_credentials.prf_wrapped_uk` already uses for passkeys wrapping the UK. **`enc_data` (the actual payload ciphertext) never needs re-encryption when sharing changes** — only the wrapped-key rows do. This is what keeps member-removal cheap (see below) and it requires zero changes to `items.rs`'s existing `encrypt_item`/`decrypt_item`.

### Re-key on member removal — the O(collection), not O(vault), guarantee

Removing a member from a `collection` must invalidate their access to everything in it. Because the Collection Key (not each item's Cipher Key) is what's wrapped per-recipient, revocation is:

1. Generate a new Collection Key (client-side, in the browser of any remaining member with admin rights)
2. Re-wrap every remaining member's `collection_keys` row under the new key (N-1 `SealedKey` operations, N = remaining members — cheap, independent of vault size)
3. Re-wrap every item's `enc_key` in that collection under the new Collection Key (M operations, M = items in *that collection*, not the whole vault — `enc_data` payload ciphertext is untouched)
4. `DELETE` the removed member's `collection_keys` row

This must run as **one SQLx transaction** (`sqlx::Pool::begin()` → sequence of `UPDATE`/`DELETE` → `commit()`), not as a cascade. This is the one place a straight `ON DELETE CASCADE` is actively wrong: deleting a `family_members` row must **not** simply cascade-delete the corresponding `collection_keys` rows before the re-key has happened, or the remaining members are left holding a Collection Key an ex-member also still has cached client-side (not actually invalidated). `ON DELETE CASCADE` is fine for pure bookkeeping — e.g. deleting a `family` cascades to `family_members`/`collections`/`family_invites` — but member *removal from a specific collection* is an application-level, transactional re-key operation, not a schema-level cascade. This mirrors how `pv-server` already treats WebAuthn counter anomalies (Phase 19, `SEC-04`) as an explicit classified operation rather than an implicit DB trigger.

## 3. Invitation links without SMTP

No new crate. This reuses primitives already in the tree, in the same shape as the existing `sessions` table (`token_hash BLOB NOT NULL UNIQUE`, raw token only ever shown once to the client that generated it):

```rust
// Already exists in pv-core::keys — nothing new to write here:
let raw_token = random_bytes(32);              // pv-core::keys::random_bytes (OsRng)
let link = format!("https://host/invite/{}", base64::encode_url_safe(&raw_token)); // base64 0.22, already pinned
// Server stores only:
let token_hash = Sha256::digest(&raw_token);    // sha2 0.10, already pinned in pv-server
// INSERT INTO family_invites (token_hash, expires_at, ...)
```

Verification on accept: hash the presented token, look up by unique index (not a manual constant-time compare loop — the DB unique index already gives an all-or-nothing lookup, and the token has 256 bits of entropy so there's no meaningful timing side-channel to defend against here, unlike password comparison). `expires_at` + `used_at` columns give one-time-use + expiry without any background job — a lazy check at accept-time (`WHERE used_at IS NULL AND expires_at > now()`) is enough; no cron, no external state.

This is the same pattern as `sessions.token_hash` (migration `0001_init.sql`) and needs no library beyond what `pv-server`/`pv-core` already depend on.

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| `rsa` crate for the sharing keypair | Open, unpatched `RUSTSEC-2023-0071` (Marvin Attack timing side-channel); this repo's own `deny.toml` already treats `rsa` as a dormant risk it's carefully *not* compiling — adding it as a direct dependency for sharing would compile the vulnerable code path for real. Also: this is literally the Bitwarden pattern the project's own Key Decisions table already rejected ("RSA layer w hierarchii kluczy (jak u Bitwardena)") | `crypto_box` (X25519) |
| `hpke` crate (RFC 9180) | Forces bumping already-pinned `hkdf` (`=0.12.4` → needs `^0.13`) and `chacha20poly1305` (`=0.10.1` → needs `^0.11.0`) as a side effect; both the crate (0.14.0) and its X25519 KEM dependency (`x25519-dalek 3.0.0`) were published ~3 weeks before this research — too fresh for a security layer in a project that hand-tracks its dependency graph via `deny.toml` | `crypto_box` — same underlying primitive, ships today at a version compatible with what's already pinned |
| `sodiumoxide` / `libsodium-sys` / any libsodium FFI binding | The "libsodium-style" language in this project's constraints describes *primitive choice* (Argon2id, XChaCha20-Poly1305), not "must literally FFI into C libsodium." A C FFI dependency **cannot compile to `wasm32-unknown-unknown`** the way this repo's WASM bridge requires (`pv-core` has zero I/O and zero C dependencies today specifically so it stays WASM-portable) — this would break the one hard architectural invariant the whole crypto core exists to preserve | `crypto_box` — pure Rust, same NaCl-compatible primitive, actually compiles to `wasm32-unknown-unknown` |
| `age` crate | Tempting because "encrypt to X25519 recipients" is its headline feature, but it's a *file-format* library (its own ASCII-armor/stanza framing, `scrypt`-based passphrase mode, CLI-oriented) — much heavier than needed to wrap one 32-byte key, and its container format doesn't map cleanly onto this project's `WrappedKey`-shaped JSON blobs | `crypto_box` at the primitive level — wrap exactly the bytes needed, in the existing blob shape |
| Redis / any external cache for invite tokens or session-adjacent sharing state | Violates the single-container, no-required-external-services constraint (`PROJECT.md` Constraints: "żadnych wymaganych zewnętrznych usług (S3, Redis, itp.)") — and is unnecessary: a `token_hash UNIQUE` column with `expires_at`/`used_at` does the whole job inside the existing SQLite file | New SQLite table (`family_invites`), same volume, same backup story |
| SMTP / `lettre` or any mailer crate | Explicitly out of scope per `PROJECT.md` ("Własny serwer mailowy do email maskingu" is deferred, and invites are explicitly required to work "bez SMTP") — even a client-side "send via mailto:" is fine, but the *server* must never require outbound mail delivery to function | One-time link/code the family owner copies and shares out-of-band (chat, in person, any channel they already use) |
| A generic RBAC/policy-engine crate (`casbin`, `oso`) | This milestone has exactly 3 fixed access levels (`read`/`edit`/`hidden_password`) on exactly 2 resource kinds (collection, item) — a `CHECK (access_level IN (...))` column is the same pattern `vault_items.type` already uses, and is trivially auditable. A policy engine is unbounded scope for a bounded, small enum | `CHECK` constraint + application-level `match` on the enum |
| Full Vaultwarden-style "Organizations" (nested collections, groups, custom roles) | `PROJECT.md` Out of Scope: "Pełne organizacje (kolekcje, grupy, role jak Vaultwarden) — v1 to konta osobiste + rodzina; organizacje odsuwałyby MVP." Family + flat collections + per-item share is the entire v0.4 surface | The schema above (`families`/`collections`/`item_shares`) — flat, no nesting, no custom role definitions |
| Re-encrypting `vault_items.enc_data` on every membership change | O(vault) cost the project explicitly wants to avoid (`PROJECT.md` Key context: "projekt musi unikać kosztu O(cały vault)") | Only re-wrap `enc_key`/`collection_keys`/`item_shares` rows — payload ciphertext (`enc_data`) is untouched, per the re-key design above |

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `crypto_box = "=0.9.1"` (features: `chacha20`, `alloc`) | `chacha20poly1305 = "=0.10.1"` (already pinned) | Both resolve `chacha20 ^0.9` and `aead ^0.5` — verified identical dependency requirements via crates.io, not assumed. No duplicate cipher implementation in the dependency tree |
| `crypto_box = "=0.9.1"` | `rand_core` chain already present via `chacha20poly1305`/`webauthn-rs` | Resolves `curve25519-dalek ^4` → `rand_core ^0.6.4` (normal dep) — same major line as the existing `rand_core 0.6` chain documented in this repo's Key Decisions ("getrandom 0.2 `js`"). No new `getrandom` line introduced |
| `crypto_box` | `wasm32-unknown-unknown` | Pure Rust, no OS syscalls beyond an RNG the caller supplies (this repo already supplies `OsRng` via `chacha20poly1305`'s `aead::rand_core::OsRng` re-export for nonce generation — the same `OsRng` instance can generate X25519 keypairs) |
| New `family_invites`/`collection_keys`/`item_shares` tables | `sqlx = "0.8"` (unchanged) | Plain migrations, same `sqlite`/`uuid`/`migrate` feature set already enabled in `pv-server/Cargo.toml` — no SQLx version bump needed. (`sqlx 0.9.0` exists upstream as of this research but adopting it is an unrelated decision, out of scope here — do not couple it to this milestone) |

## Sources

- crates.io API (live queries, 2026-07-29): `hpke`, `crypto_box`, `x25519-dalek`, `chacha20poly1305`, `rsa`, `argon2`, `hkdf`, `sha2`, `rand_core`, `getrandom`, `sqlx`, `axum`, `webauthn-rs`, `crypto_secretbox` — max/stable versions and full dependency graphs (`/dependencies` endpoint) fetched directly, not inferred from memory
- `RUSTSEC-2023-0071` (rsa crate Marvin Attack) — https://rustsec.org/advisories/RUSTSEC-2023-0071.html — confirmed open/unpatched as of most recent indexed status
- Web search: crypto_box Cure53 audit (Threema-funded, v0.7.1, no significant findings) — cross-referenced against RustCrypto/nacl-compat GitHub org
- `docs.rs/crypto_box` — public API surface (`SalsaBox`, `ChaChaBox`, `SecretKey`, `PublicKey`), confirmed no built-in sealed-box helper (hence the hand-written ephemeral-keypair wrapper documented above)
- This repository: `Cargo.toml`, `crates/pv-core/Cargo.toml`, `crates/pv-server/Cargo.toml`, `crates/pv-core/src/keys.rs`, `crates/pv-core/src/lib.rs`, `crates/pv-server/migrations/000{1,3}_*.sql`, `deny.toml`, `docs/ARCHITECTURE.md`, `.planning/PROJECT.md` — existing pins, key hierarchy, schema conventions, and out-of-scope decisions verified directly from source, not assumed

---
*Stack research for: v0.4 Family & Sharing — asymmetric crypto layer, schema, invitations*
*Researched: 2026-07-29*
