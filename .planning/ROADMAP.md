# Roadmap: Passkey Vault

## Overview

v0.1 delivers a self-hostable, zero-knowledge password manager (server + web app only — no extension yet) where PRF passkey unlock is a first-class citizen from day one, not a bolt-on. The build follows the crypto trust boundary outward from the existing `pv-core`/`pv-server` foundation: first bridge `pv-core` to WASM behind a themed web shell (nothing client-side can work without it), then stand up the simplest auth path (password) together with full vault item CRUD — the first real end-to-end zero-knowledge slice a user can actually use. From there, passkey enrollment and account-security management land as their own phase (the passkey-deletion recovery invariant lives here, server-enforced, not just discouraged in UI copy), followed by the PRF unlock+login unification phase (one passkey gesture logs in and unlocks the vault, with a first-class fallback when PRF isn't available). Multi-device sync, then import/export + TOTP + onboarding, are additive on top of a working vault. Single-container Docker packaging and self-host deployment hardening (RP_ID/proxy correctness) close out v0.1, since self-host deployment topology is this product's whole audience, not an edge case.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: WASM Crypto Bridge & Web App Shell** - Bridge `pv-core` to WASM behind a themed Next.js shell; prove a full crypto round-trip through the choke-point module
- [ ] **Phase 2: Password Auth & Vault Core** - Register, log in with a master password, and fully manage an encrypted vault of items — the first real end-to-end zero-knowledge slice
- [ ] **Phase 3: Passkey Enrollment & Account Security** - Enroll a PRF passkey, manage passkeys/sessions, with the recovery invariant server-enforced
- [ ] **Phase 4: PRF Unlock & Login Unification** - Log in and unlock the vault in one passkey gesture, with an honest fallback when PRF isn't available
- [ ] **Phase 5: Multi-Device Sync** - Keep the vault in sync across simultaneously-active devices/sessions
- [ ] **Phase 6: Import/Export, TOTP & Onboarding** - Bring in an existing password manager's data, see live TOTP codes, export back out
- [ ] **Phase 7: Self-Host Packaging & Deployment** - Ship as one Docker container that fails loudly, not mysteriously, when misconfigured

## Phase Details

### Phase 1: WASM Crypto Bridge & Web App Shell

**Goal**: The web app can load `pv-core`'s crypto entirely inside a WASM boundary, inside a themed shell that later phases build features into
**Mode:** mvp
**Depends on**: Nothing (builds on existing `pv-core`/`pv-server` foundation)
**Requirements**: UI-01
**Success Criteria** (what must be TRUE):

  1. Running the Next.js app shows the datafa.st-themed shell (dark default, full light-mode support) — no functional screens yet beyond a crypto self-test
  2. `pv-core` compiles to WASM via a version-pinned `wasm-bindgen`/`wasm-bindgen-cli` build step wired into the app build
  3. A demoable round-trip (derive a key, wrap it, unwrap it, encrypt+decrypt a sample item) succeeds entirely inside `lib/crypto/`, the sole module importing the WASM bindings
  4. No raw key bytes are ever returned across the WASM boundary more than once per operation (grep-auditable: only `lib/crypto/` imports the wasm package)

**Plans**: 1/3 plans executed

- [x] 01-01-PLAN.md
- [ ] 01-02-PLAN.md
- [ ] 01-03-PLAN.md

**UI hint**: yes

### Phase 2: Password Auth & Vault Core

**Goal**: A user can create an account, log in with their master password, and fully manage an encrypted vault of items
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-08, VAULT-01, VAULT-02, VAULT-03, VAULT-04, VAULT-05, VAULT-06, UI-03
**Success Criteria** (what must be TRUE):

  1. User can register with email + master password; the server only ever stores/receives a hash-post-KDF, never the password itself
  2. User can log in with the master password and receive a session token; the vault only unlocks after a separate, local-only decryption step — login and unlock are visibly distinct states
  3. User can create, edit, and delete login (with a passkey sub-record section)/card/identity/note items in a list-plus-detail panel; the server only ever stores ciphertext blobs
  4. Each item's ciphertext is bound via AEAD associated data to its item ID/revision/field context — a test that mutates the AD context proves decryption is rejected, not silently accepted
  5. User can organize items into folders/tags, search instantly client-side, generate a strong password (16+ char default, passphrase mode alongside character mode), copy a field to clipboard (auto-clears in 30-60s, on by default), and the vault auto-locks after a configurable idle period

**Plans**: TBD
**UI hint**: yes

### Phase 3: Passkey Enrollment & Account Security

**Goal**: A user can enroll a passkey with PRF for future vault unlock, and manage passkeys/sessions from a settings screen, without ever being able to strand their vault
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: AUTH-03, AUTH-05, AUTH-06, AUTH-07, UI-05
**Success Criteria** (what must be TRUE):

  1. User can enroll a passkey via a two-ceremony flow (`create` registers the credential, a follow-up `get` evaluates PRF and wraps the User Key); the passkey wrap is added alongside — never replacing — the password wrap
  2. From Settings, user sees enrolled passkeys (name/date/last-used), can rename them, and can delete a passkey with a clear recovery warning
  3. Deleting a passkey that would leave the vault with no password/recovery fallback is blocked by the server itself (verified by calling the API directly, not just observing the UI), not merely discouraged in copy
  4. From Settings, user sees active sessions/devices and can revoke any of them individually

**Plans**: TBD
**UI hint**: yes

### Phase 4: PRF Unlock & Login Unification

**Goal**: A user can log in and unlock the vault in one passkey gesture, with a first-class, honest fallback whenever PRF isn't available
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: AUTH-04, AUTH-09, UI-02
**Success Criteria** (what must be TRUE):

  1. On the unlock/login screen, a prominent teal "Unlock with passkey" button sits above the master-password field (PRF-first framing)
  2. One `navigator.credentials.get()` gesture both authenticates the user (assertion → server session) and unlocks the vault locally (PRF output → local unwrap of the User Key); PRF output never leaves the client
  3. In a fresh browser session on a PRF-enrolled account, the user unlocks with just the passkey gesture — no password entry required
  4. When PRF is unavailable (browser/OS/authenticator lacks support), the user sees a specific, readable explanation and a working password-unlock fallback — never a generic error or a silent hang

**Plans**: TBD
**UI hint**: yes

### Phase 5: Multi-Device Sync

**Goal**: A user's vault stays in sync across multiple simultaneously-active devices/sessions
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: SYNC-01, SYNC-02, SYNC-03
**Success Criteria** (what must be TRUE):

  1. A change made on one logged-in device (create/edit/delete an item) is retrievable via `GET /sync` on a second device using a cheap revision check — no unnecessary full re-fetch when nothing changed
  2. A WebSocket push notifies other active sessions of a change via metadata only (`{item_id, revision, change_type}`) — traffic inspection confirms ciphertext never traverses the push channel
  3. When two devices edit concurrently, the conflict resolves per-item by revision (last-write-wins is visible and doesn't silently corrupt unrelated items)

**Plans**: TBD

### Phase 6: Import/Export, TOTP & Onboarding

**Goal**: A new user can bring their existing passwords in during onboarding, see live TOTP codes in the vault, and export everything back out
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: VAULT-07, IMPEX-01, IMPEX-02, IMPEX-03, IMPEX-04, UI-04
**Success Criteria** (what must be TRUE):

  1. During a 3-step onboarding flow, importing from another password manager is offered as the first step
  2. User can import a Bitwarden JSON or CSV export, and CSV exports from NordPass/1Password/LastPass/KeePass, entirely client-side — no plaintext ever sent to the server
  3. User can import a generic CSV/JSON with manual column mapping
  4. User can export the full vault to JSON and CSV, with a clear plaintext warning shown before export
  5. Vault items of type TOTP show a live, counting-down code generated locally from the item's secret

**Plans**: TBD
**UI hint**: yes

### Phase 7: Self-Host Packaging & Deployment

**Goal**: The whole system runs self-hosted from a single Docker container against a real reverse proxy, and fails loudly instead of mysteriously when misconfigured
**Mode:** mvp
**Depends on**: Phases 1-6 (needs the full app + WS + static export to package)
**Requirements**: DEPLOY-01, DEPLOY-02
**Success Criteria** (what must be TRUE):

  1. `docker run` of a single built image serves the API, WebSocket, and the static Next.js export on one port, running migrations automatically on boot, with SQLite persisted on a mounted volume
  2. Starting the server without a valid `RP_ID`/`PUBLIC_URL` (for a non-localhost deployment) fails immediately at startup with a specific, actionable error — not a generic runtime WebAuthn `SecurityError` discovered later by a user
  3. Behind a reference nginx/Caddy reverse-proxy config (documented and tested), passkey registration/login and the sync WebSocket both work end-to-end, not just direct-to-container

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. WASM Crypto Bridge & Web App Shell | 1/3 | In Progress|  |
| 2. Password Auth & Vault Core | 0/TBD | Not started | - |
| 3. Passkey Enrollment & Account Security | 0/TBD | Not started | - |
| 4. PRF Unlock & Login Unification | 0/TBD | Not started | - |
| 5. Multi-Device Sync | 0/TBD | Not started | - |
| 6. Import/Export, TOTP & Onboarding | 0/TBD | Not started | - |
| 7. Self-Host Packaging & Deployment | 0/TBD | Not started | - |
