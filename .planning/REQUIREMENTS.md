# Requirements: Passkey Vault — v0.2 Browser Extension

> Milestone v0.2. Continues from v0.1 (server + web app, shipped 2026-07-14). The extension
> surfaces the existing v0.1 vault/crypto/sync onto third-party web pages. Zero-knowledge is
> preserved throughout: no key material or plaintext ever reaches a page's MAIN world.
> Requirement archive for v0.1: `milestones/v0.1-REQUIREMENTS.md`.

## v0.2 Requirements

### EXT — Extension foundation

- [x] **EXT-01**: Extension loads in Chrome and Firefox (WXT MV3) and runs `pv-core`/`pv-wasm` crypto in the background service worker
- [x] **EXT-02**: User unlocks the vault from the popup with the master password (and with a PRF passkey where the browser supports it); the unlocked User Key is held in `chrome.storage.session` (never `storage.local`) and survives service-worker idle-termination within the session
- [x] **EXT-03**: The session key auto-locks — cleared after a configurable idle timeout and on browser close — so an unlocked vault never persists indefinitely
- [x] **EXT-04**: In the popup the user can browse, search, and pick any vault item, backed by the existing `pv-server` REST API and WebSocket sync (multi-device revisions honored)
- [ ] **EXT-05**: The extension is ONE public build (Chrome Web Store / AMO) that connects to the user's OWN self-hosted `pv-server` — on first run the user configures their server URL (stored in the extension), it is validated (reachable / `healthz`), and all REST + WebSocket traffic targets that URL; the self-hosted server allowlists the single fixed published extension origin via CORS. No server URL is hard-coded.
- [x] **EXT-06**: The popup (icon click) offers a "fullscreen / open full vault" action that opens the configured server's v0.1 web-app frontend in a new browser tab — so the popup stays a focused surface and the full vault-management UI is NOT re-implemented inside the extension

### PROV — Passkey provider

- [ ] **PROV-01**: On a third-party site, `navigator.credentials.create()` registers a new passkey that is stored in the user's vault (ES256 soft authenticator via `passkey-rs`)
- [ ] **PROV-02**: On a third-party site, `navigator.credentials.get()` logs the user in with a passkey saved in their vault
- [ ] **PROV-03**: When the user declines, or the vault holds no matching credential, the extension falls through cleanly to the native OS authenticator (never dead-ends the ceremony)
- [ ] **PROV-04**: PRF is used where the browser allows it (Chromium-first); on Firefox / where PRF is unavailable the flow degrades honestly with a clear fallback
- [ ] **PROV-05**: The page-injected `navigator.credentials` patch is a key-free RPC shim — no User Key, PRF output, or plaintext ever crosses into the MAIN world; all crypto runs in the background (zero-knowledge; gated by a security review)

### FILL — Autofill (full vault)

- [ ] **FILL-01**: The extension detects login forms and offers to fill the saved username + password for the current origin
- [ ] **FILL-02**: The extension fills (or copies) the live TOTP code into a 2FA field for the current origin
- [ ] **FILL-03**: The extension fills credit-card fields (number, expiry, CVV, cardholder) from a saved card item
- [ ] **FILL-04**: The extension fills identity fields (name, address, email, phone — Tożsamości) from a saved identity item

### CAP — Generate & capture

- [ ] **CAP-01**: On a signup/registration form, the extension offers a generated strong password (reusing the v0.1 generator, character + passphrase modes)
- [ ] **CAP-02**: After a successful submit/login, the extension prompts the user to save the new login to the vault, attributed to the correct origin
- [ ] **CAP-03**: When the user changes a password on a site with an existing saved login, the extension detects it and offers to update the stored item

### XBR — Cross-browser

- [ ] **XBR-01**: Chrome and Firefox reach feature parity — or Firefox degrades explicitly and legibly where an API/PRF capability differs — verified in a dedicated dual-browser hardening pass

## Future Requirements (deferred beyond v0.2)

### Extension polish (v0.2.x)

- [ ] Icon-in-field indicator polish and right-click context-menu quick actions
- [ ] Cross-origin iframe card-field autofill parity (niche complexity)

### v1+

- [ ] Breach monitor / Password-Health surfaced in-extension (belongs to its own PROJECT.md item, web-app-first)
- [ ] FIDO CXF import/export inside the extension UI (belongs to the vault data layer)
- [ ] `chrome.webAuthenticationProxy`-based provider path (revisit only if w3c/webextensions#361 standardizes)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Mobile providers (Android CredentialProviderService, iOS ASCredentialProvider), Windows plugin | v2 per PROJECT.md platform order (web → extension → mobile) |
| Sharing / family collections | Separate tracked PROJECT.md item, not part of the extension milestone |
| Auto-submit login forms after fill | Anti-feature — breaks on many sites, security-surprising; fill only, user submits |
| Storing/patching for non-WebAuthn 2FA (push, SMS) | Out of the passkey/vault model |
| A second, divergent crypto implementation in JS | Reuse `pv-core`/`pv-wasm` only — the single grep-auditable crypto boundary is a v0.1 invariant |

## Traceability

Filled by the roadmapper.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EXT-01 | Phase 8 | Complete |
| EXT-02 | Phase 9 | Complete |
| EXT-03 | Phase 9 | Complete |
| EXT-04 | Phase 9 | Complete |
| EXT-05 | Phase 9 | Pending |
| EXT-06 | Phase 9 | Complete |
| PROV-01 | Phase 12 | Pending |
| PROV-02 | Phase 12 | Pending |
| PROV-03 | Phase 12 | Pending |
| PROV-04 | Phase 12 | Pending |
| PROV-05 | Phase 12 | Pending |
| FILL-01 | Phase 10 | Pending |
| FILL-02 | Phase 10 | Pending |
| FILL-03 | Phase 10 | Pending |
| FILL-04 | Phase 10 | Pending |
| CAP-01 | Phase 11 | Pending |
| CAP-02 | Phase 11 | Pending |
| CAP-03 | Phase 11 | Pending |
| XBR-01 | Phase 13 | Pending |
