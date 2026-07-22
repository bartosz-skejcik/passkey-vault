# Phase 2: Password Auth & Vault Core - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning

<domain>
## Phase Boundary

A user can create an account, log in with their master password, and fully manage an encrypted vault of items. Deliverables: registration + password login on the server (hash-po-KDF, sessions), vault CRUD on encrypted blobs with AEAD identity binding, the list-plus-detail vault UI in the Phase 1 shell, folders/tags, instant client-side search, password generator, clipboard auto-clear, and idle auto-lock with a visible lock state. Passkeys (Phase 3/4), sync push (Phase 5), import/TOTP/onboarding (Phase 6) are out of scope — but the login item type includes a passkey sub-record *section* (display placeholder) per UI-03.

</domain>

<decisions>
## Implementation Decisions

### Auth & Session Model (Claude's Discretion — user delegated: "too advanced for me, you make the decision")
- Login verification: Bitwarden-style hash-po-KDF. One client-side Argon2id(password, salt); HKDF-split into the existing wrapping key (`pv:pw-unlock:v1`) and a new domain-separated auth hash (`pv:auth-hash:v1`). Server stores only a cheap re-hash of the auth hash; password and wrapping key never leave the client.
- Sessions: opaque random 256-bit Bearer token, stored hashed in the existing `sessions` table with expiry. No JWT.
- Registration: single `POST /api/auth/register` carrying email, KDF params, salt, auth hash, and pw-wrapped User Key. No email verification in v0.1 (self-hosted).
- Auto-lock (AUTH-08): client-side idle timer, default 15 min, configurable. Lock frees the WASM UK handle only — session token survives; lock ≠ logout (satisfies AUTH-02's visibly distinct states).

### Vault Data Model & API (accepted)
- Server stores per item only `{id, user_id, enc_item_key (UK-wrapped), blob (nonce+ciphertext), revision, created, updated}` — item type, name, tags live inside the ciphertext. Folders are their own encrypted records (Bitwarden pattern). No plaintext `type` or `folder_id` columns.
- AEAD associated data: `"pv:item:v1" ‖ item_id ‖ revision` (blocks blob-swap and revision rollback). Server increments revision on PUT. A test mutates the AD and asserts decryption is rejected, not silently accepted (VAULT-02 success criterion).
- API: REST on encrypted blobs — `GET/POST /api/vault/items`, `PUT/DELETE /api/vault/items/:id`; PUT carries expected revision, 409 on mismatch (optimistic concurrency).
- Crypto: reuse pv-core `items.rs` per-item Cipher Key, extended with an AD parameter; new pv-wasm exports follow Phase 1's opaque-handle pattern. No new crypto paths outside pv-core.

### Vault UX (accepted)
- Layout: list + side detail panel per docs/UI-DESIGN.md §3 — rows with favicon, name, username, type badge; detail panel with copy buttons and a passkey sub-record section (placeholder until Phase 3). Fills the Phase 1 shell.
- Search (VAULT-04): client-side in-memory index over decrypted items (name, username, domain); instant filter-as-you-type.
- Password generator (VAULT-05): TypeScript with `crypto.getRandomValues` + rejection sampling; length-first UI, default 20 chars; passphrase mode from a bundled EFF wordlist. (Generated passwords are displayed to the user — not audited-core secret handling.)
- Clipboard (VAULT-06): auto-clear ON by default, 40s (configurable 30–60s); overwrite clipboard after timeout.

### Key Lifecycle & Lock State (accepted)
- Session token: memory + localStorage persistence (v0.1). It is an auth credential, not vault-secret material; auto-lock never touches it. httpOnly-cookie approach revisited pre-v1.0.
- Unlocked UK: single `WasmUserKey` handle inside the `lib/crypto/` singleton (Phase 1 choke-point); lock = `free()` the handle.
- Unlock flow: `prelogin` → salt + KDF params; login response carries `pw_wrapped_uk`; local WASM unwrap is the visibly distinct unlock step.
- Idle detection: DOM activity events reset the timer; auto-lock settings in plain localStorage (non-secret).

### UX decisions from user (2026-07-12)
- **Language: i18n PL+EN from the start** — switchable from day one; Phase 1's hardcoded Polish strings get migrated into the i18n layer during this phase. (Static export constraint: use a client-side i18n approach compatible with `output: "export"` — no middleware-based locale routing.)
- **Lock screen: blurred shell in the background** — the unlock overlay sits over a blurred, content-free rendering of the app shell (no item data may remain in the DOM behind it — blur is cosmetic, the vault data must actually be dropped from state on lock).
- **Item deletion: confirmation dialog, permanent delete** — no trash/soft-delete in this phase (may come later).
- **Copy feedback: toast + countdown** — "Copied" toast with a visible seconds-remaining indicator until clipboard auto-clear fires.

### Claude's Discretion
- Entire Auth & Session Model area (explicitly delegated by user).
- DB migration details, exact endpoint/request/response shapes, error taxonomy.
- i18n library choice (must work under static export; keep light — e.g. thin dictionary module over heavy framework).
- Component structure, toast implementation, dialog styling (within UI-DESIGN tokens; security dialogs always legible — no playfulness).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 1: `crates/pv-wasm` (opaque handles: `WasmWrappingKey`, `WasmUserKey`, wrap/unwrap/encrypt/decrypt, `randomSalt`, `defaultKdfParamsJson`), `web/src/lib/crypto/index.ts` (sole WASM importer; `initCrypto()`, handle lifecycle with `.free()` on all paths, password passed as zeroized `Uint8Array`), themed shell components (`Sidebar`, `TopBar`, `MainColumn`), `scripts/build-wasm.sh`.
- `crates/pv-core`: `kdf.rs` (Argon2id + HKDF with versioned INFO constants), `keys.rs` (UserKey, WrappedKey, aead_seal/open), `items.rs` (per-item Cipher Key — needs AD parameter added), `error.rs`.
- `crates/pv-server`: axum skeleton, migration 0001 (users/sessions/items groundwork — verify actual schema at plan time), prelogin stub to be made real.

### Established Patterns
- Opaque-handle WASM boundary; `lib/crypto/` choke-point (grep-audited); Zeroize everywhere; versioned HKDF domain separation; thiserror + map_err; axum routes in `routes/` modules; SQLx compile-time-checked queries.
- Phase 1 pitfalls now encoded: Tailwind v4 needs `@tailwindcss/postcss`; TypeScript pinned 5.9.3; build-wasm.sh sed-neutralizes the dead default-URL branch; getrandom 0.2/`js`.

### Integration Points
- New pv-wasm exports needed: auth-hash derivation (HKDF split), item encrypt/decrypt with AD, UK generation + pw-wrap for registration.
- Server: real `prelogin`, `register`, `login`, session middleware, vault items + folders routes; migrations extending 0001.
- Web: vault screens replace the Phase 1 self-test as the home route's main content (self-test can move behind a dev route or stay as a settings diagnostic — planner's call).

</code_context>

<specifics>
## Specific Ideas

- UI per docs/UI-DESIGN.md §3 screens 2–3: item rows with health-dot placeholder, hover 6% white, low density; detail panel (not separate page); mono font for passwords; teal reserved for passkey accents (placeholder section).
- Security UI (unlock overlay, delete confirmation) always legible — no Fuzzy Bubbles/emoji.
- Pending todo from Phase 1 UI review (resolves_phase: 2): fix vault-light `base-300` surface separation; add retry button to fatal self-test branch; fix "patrz błąd poniżej" copy — fold into this phase's UI work (todo: .planning/todos/pending/2026-07-12-ui-review-phase1-fixes.md).
- Deferred code-review info items IN-01..IN-06 in 01-REVIEW.md — planner may pick up cheap ones (e.g. `typecheck` npm script) opportunistically.

</specifics>

<deferred>
## Deferred Ideas

- Trash/soft-delete for items — explicitly deferred by user (confirm-dialog permanent delete now).
- httpOnly-cookie session hardening — pre-v1.0 revisit.
- RustCrypto bumps (chacha20poly1305 0.11, hkdf 0.13) — still deferred from Phase 1.
- Passkey sub-record editing — Phase 3 (this phase renders a placeholder section only).

</deferred>
