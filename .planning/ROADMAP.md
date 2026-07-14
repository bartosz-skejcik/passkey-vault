# Roadmap: Passkey Vault

## Milestones

- ✅ **v0.1 MVP** — Phases 1–7 (shipped 2026-07-14) — self-hostable, zero-knowledge password manager: server + web app, PRF passkey unlock first-class, single-container Docker. Full details: [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)
- 🚧 **v0.2 Browser Extension** (in progress) — Phases 8–13 — WXT MV3 Chrome + Firefox extension that is a full passkey provider on third-party sites (`credentials.create`/`credentials.get`) AND a complete autofill companion for the whole vault (login/TOTP/card/identity), reusing `pv-core`/`pv-wasm` via WASM, zero-knowledge preserved.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)
- Numbering is continuous across milestones — v0.2 continues from v0.1's last phase (7), starting at Phase 8.

Decimal phases appear between their surrounding integers in numeric order.

<details>
<summary>✅ v0.1 MVP (Phases 1–7) — SHIPPED 2026-07-14</summary>

- [x] Phase 1: WASM Crypto Bridge & Web App Shell (3/3 plans) — completed 2026-07-12
- [x] Phase 2: Password Auth & Vault Core (8/8 plans) — completed 2026-07-13
- [x] Phase 3: Passkey Enrollment & Account Security (4/4 plans) — completed 2026-07-14
- [x] Phase 4: PRF Unlock & Login Unification (3/3 plans) — completed 2026-07-14
- [x] Phase 5: Multi-Device Sync (4/4 plans) — completed 2026-07-14
- [x] Phase 6: Import/Export, TOTP & Onboarding (4/4 plans) — completed 2026-07-14
- [x] Phase 7: Self-Host Packaging & Deployment (3/3 plans) — completed 2026-07-14

Delivered: 30/30 requirements, all phases verified passed, cross-phase integration clean (5/5 E2E flows). Audit: [milestones/v0.1-MILESTONE-AUDIT.md](milestones/v0.1-MILESTONE-AUDIT.md). Known deferred: container/proxy E2E (human_needed on a Docker host — see phase-07 07-UAT.md); CSV-TOTP export fidelity.

</details>

### 🚧 v0.2 Browser Extension (in progress)

**Milestone Goal:** A WXT MV3 extension (Chrome + Firefox) that makes Passkey Vault a full passkey provider on other people's sites, and a complete autofill companion for the whole vault — without ever letting key material, PRF output, or plaintext reach a page's JS context.

**Cross-cutting technical notes (apply across multiple phases below):**
- **CORS allowlist**: `pv-server` needs to accept requests from the extension's own origin (`chrome-extension://<id>` / `moz-extension://<id>`). This is a small server-side change, surfaced in Phase 9 where the extension's background sync client first calls the API.
- **Session key storage**: the unlocked User Key must live only in `chrome.storage.session` — never `chrome.storage.local`, never a module-level JS variable. This constraint is established as the foundation in Phase 9 and must hold through every later phase that touches the unlocked key (autofill in Phase 10, the passkey provider in Phase 12).

- [ ] **Phase 8: Extension Bootstrap & WASM-in-Background Spike** - Bare WXT project on both browsers; `pv-wasm` runs in the background service worker and survives an idle-kill/wake cycle
- [ ] **Phase 9: Session Unlock Core, Popup & Sync Client** - Unlock the vault from the popup (password + PRF where supported), browse/search items, real REST+WS sync as a third synced client
- [ ] **Phase 10: Autofill — Login, TOTP, Card & Identity** - Detect forms and fill saved logins, live TOTP codes, cards, and identities into the current page
- [ ] **Phase 11: Generate & Capture** - Suggest a generated password on signup, prompt to save new logins after submit, detect password changes
- [ ] **Phase 12: Passkey Provider** - `navigator.credentials.create()`/`.get()` on third-party sites via a MAIN-world key-free RPC shim, `passkey-rs` + PRF, native fallback — security-review gated
- [ ] **Phase 13: Dual-Browser Hardening** - Verified Chrome/Firefox parity (or explicit, legible Firefox degradation) across every feature built above

## Phase Details

### Phase 8: Extension Bootstrap & WASM-in-Background Spike
**Goal**: `pv-core`/`pv-wasm` crypto runs reliably inside a WXT MV3 background service worker on both Chrome and Firefox, and survives the MV3 idle-kill/wake cycle — proven before any user-facing feature is built.
**Depends on**: Nothing new (builds on the existing v0.1 `pv-core`/`pv-wasm` foundation; first phase of v0.2)
**Requirements**: EXT-01
**Success Criteria** (what must be TRUE):
  1. The extension loads unpacked in both Chrome and Firefox (WXT dual-output build) with no console errors on install.
  2. The background service worker fetches and instantiates `pv-wasm` under MV3's CSP (`wasm-unsafe-eval` explicitly declared) in the packaged/signed build for both browsers — not just `wxt dev`.
  3. A round-trip crypto call executed in the background (e.g., derive → wrap → unwrap) survives a manual service-worker idle-kill/wake cycle without losing correctness.
  4. Firefox's manifest target (MV2 persistent background page vs. MV3 event page) is deliberately pinned in `wxt.config.ts`, not left to WXT's default.
**Plans**: TBD

### Phase 9: Session Unlock Core, Popup & Sync Client
**Goal**: Users can unlock, browse, and search their vault from the extension's popup interface, backed by the real `pv-server` REST/WebSocket API and multi-device sync, with the unlocked key held safely for the session.
**Depends on**: Phase 8
**Requirements**: EXT-02, EXT-03, EXT-04
**Success Criteria** (what must be TRUE):
  1. User unlocks the vault from the popup with the master password, and with a PRF passkey where the browser supports it.
  2. The unlocked User Key lives only in `chrome.storage.session` (never `storage.local`) and the vault stays usable across a service-worker idle-kill/wake cycle within the session — verified after leaving the browser idle 60+ seconds and retrying.
  3. The session auto-locks — the key is cleared after a configurable idle timeout and on browser close, so an unlocked vault never persists indefinitely.
  4. In the popup, the user can browse, search, and pick any vault item, and an edit made on another synced device (or the v0.1 web app) appears via the same REST + WebSocket sync used in v0.1.
  5. `pv-server`'s CORS allowlist accepts the extension's own origin (`chrome-extension://<id>` / `moz-extension://<id>`), verified end-to-end against a real request, not assumed.
**Plans**: TBD
**UI hint**: yes

### Phase 10: Autofill — Login, TOTP, Card & Identity
**Goal**: Users can autofill saved vault items (logins, TOTP codes, cards, identities) into web forms on the sites they visit.
**Depends on**: Phase 9
**Requirements**: FILL-01, FILL-02, FILL-03, FILL-04
**Success Criteria** (what must be TRUE):
  1. The extension detects a login form on the current origin and offers to fill the saved username + password (with a picker when multiple accounts match).
  2. The live TOTP code fills or copies into a detected 2FA field for the current origin.
  3. Credit-card fields (number, expiry, CVV, cardholder) fill from a saved card item on a same-origin form.
  4. Identity fields (name, address, email, phone) fill from a saved identity item.
  5. Nothing autofills without an explicit user gesture, and nothing fills top-level-page credentials into a cross-origin iframe — verified against a deliberately constructed adversarial iframe test page.
**Plans**: TBD
**UI hint**: yes

### Phase 11: Generate & Capture
**Goal**: Users get proactive help creating strong passwords on signup and keeping saved logins in sync with what they actually use on sites.
**Depends on**: Phase 10
**Requirements**: CAP-01, CAP-02, CAP-03
**Success Criteria** (what must be TRUE):
  1. On a signup/registration form, the extension offers a generated strong password (character and passphrase modes, reusing the v0.1 generator).
  2. After a successful submit/login, the extension prompts the user to save the new login to the vault, attributed to the correct origin.
  3. When the user changes a password on a site with an existing saved login, the extension detects the change and offers to update the stored item instead of creating a duplicate.
  4. Save/update prompts always show the actual originating domain and warn explicitly on any origin mismatch (e.g., a form embedded in a cross-origin iframe).
**Plans**: TBD
**UI hint**: yes

### Phase 12: Passkey Provider
**Goal**: On third-party sites, the extension acts as a full passkey provider — registering and authenticating with vault-stored passkeys — without ever exposing key material to the page.
**Depends on**: Phase 11 (deliberately sequenced last among the feature phases per research risk-reduction order; the messaging pipeline proven in Phases 10–11 and the session core from Phase 9 are prerequisites)
**Requirements**: PROV-01, PROV-02, PROV-03, PROV-04, PROV-05
**Success Criteria** (what must be TRUE):
  1. On a third-party site, `navigator.credentials.create()` registers a new ES256 passkey (via `passkey-rs`) that is saved to the user's vault.
  2. `navigator.credentials.get()` logs the user in with a passkey already saved in their vault.
  3. When the user declines, or the vault has no matching credential, the ceremony falls through cleanly to the native OS authenticator — verified with another password-manager extension installed simultaneously, never dead-ending the page's login flow.
  4. PRF is used where the browser allows it (Chromium-first); on Firefox or wherever PRF is unavailable, the flow degrades honestly with a clear, specific fallback message.
  5. A security review (`/gsd-secure-phase`) confirms the MAIN-world `navigator.credentials` patch is a key-free RPC shim — grep-audited to prove no User Key, PRF output, or plaintext ever crosses into MAIN-world JS.
**Plans**: TBD
**UI hint**: yes

### Phase 13: Dual-Browser Hardening
**Goal**: Chrome and Firefox reach verified feature parity for the whole v0.2 extension — or Firefox degrades explicitly and legibly wherever an API/PRF capability genuinely differs.
**Depends on**: Phase 12 (every feature must exist before the hardening pass)
**Requirements**: XBR-01
**Success Criteria** (what must be TRUE):
  1. Every v0.2 feature (unlock/session, autofill, generate & capture, passkey provider) is manually re-verified on both `wxt dev -b chrome` and `wxt dev -b firefox` (or a signed `web-ext` build).
  2. The Firefox packaged/signed build passes `web-ext lint` with the WASM CSP (`wasm-unsafe-eval`) configuration intact.
  3. Wherever Firefox lacks a capability the Chromium build has (most notably PRF), the UI communicates it explicitly instead of silently failing or degrading.
  4. `browser_specific_settings.gecko` (extension ID, `strict_min_version`) is pinned deliberately in `wxt.config.ts`, not left to a WXT/dev-mode default that would break persisted `chrome.storage.session` state across dev sessions.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. WASM Crypto Bridge & Shell | v0.1 | 3/3 | Complete | 2026-07-12 |
| 2. Password Auth & Vault Core | v0.1 | 8/8 | Complete | 2026-07-13 |
| 3. Passkey Enrollment & Account Security | v0.1 | 4/4 | Complete | 2026-07-14 |
| 4. PRF Unlock & Login Unification | v0.1 | 3/3 | Complete | 2026-07-14 |
| 5. Multi-Device Sync | v0.1 | 4/4 | Complete | 2026-07-14 |
| 6. Import/Export, TOTP & Onboarding | v0.1 | 4/4 | Complete | 2026-07-14 |
| 7. Self-Host Packaging & Deployment | v0.1 | 3/3 | Complete | 2026-07-14 |
| 8. Extension Bootstrap & WASM-in-Background Spike | v0.2 | 0/TBD | Not started | - |
| 9. Session Unlock Core, Popup & Sync Client | v0.2 | 0/TBD | Not started | - |
| 10. Autofill — Login, TOTP, Card & Identity | v0.2 | 0/TBD | Not started | - |
| 11. Generate & Capture | v0.2 | 0/TBD | Not started | - |
| 12. Passkey Provider | v0.2 | 0/TBD | Not started | - |
| 13. Dual-Browser Hardening | v0.2 | 0/TBD | Not started | - |
