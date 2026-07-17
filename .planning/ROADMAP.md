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

- **Public extension ↔ self-hosted server (EXT-05)**: There is ONE public extension build (Chrome Web Store / AMO), and every user points it at THEIR OWN self-hosted `pv-server`. Therefore (a) the server base URL is **user-configured at runtime and stored in the extension** — never hard-coded or compile-time baked; the background sync/REST/WS client reads it from config; (b) the extension's published origin (`chrome-extension://<fixed-published-id>` / `moz-extension://<id>`) is **fixed and known**, so the CORS story is: each **self-hosted `pv-server` allowlists that one known published extension origin**. The server-config onboarding + URL validation + CORS handshake land in Phase 9 (first phase that talks to the API) and every later phase consumes the Phase-9 client abstraction (no phase re-derives a server URL).
- **Popup delegates full management to the web app (EXT-06)**: The popup is a focused surface (unlock, browse/search/pick, autofill source). A "fullscreen / open full vault" action opens the **configured server's v0.1 web-app frontend in a new tab** — the full vault-management UI is NOT re-implemented inside the extension. This scopes every UI phase: build compact popup/in-page surfaces, defer heavy management to the web app.
- **Session key storage**: the unlocked User Key must live only in `chrome.storage.session` — never `chrome.storage.local`, never a module-level JS variable. This constraint is established as the foundation in Phase 9 and must hold through every later phase that touches the unlocked key (autofill in Phase 10, the passkey provider in Phase 12).

- [x] **Phase 8: Extension Bootstrap & WASM-in-Background Spike** - Bare WXT project on both browsers; `pv-wasm` runs in the background service worker and survives an idle-kill/wake cycle (completed 2026-07-15)
- [x] **Phase 9: Session Unlock Core, Popup & Sync Client** - Unlock the vault from the popup (password + PRF where supported), browse/search items, real REST+WS sync as a third synced client (completed 2026-07-15)
- [x] **Phase 10: Autofill — Login, TOTP, Card & Identity** - Detect forms and fill saved logins, live TOTP codes, cards, and identities into the current page (completed 2026-07-16)
- [x] **Phase 11: Generate & Capture** - Suggest a generated password on signup, prompt to save new logins after submit, detect password changes (completed 2026-07-16)
- [x] **Phase 12: Passkey Provider** - `navigator.credentials.create()`/`.get()` on third-party sites via a MAIN-world key-free RPC shim, `passkey-rs` + PRF, native fallback — security-review gated (completed 2026-07-17)
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

**Plans:** 3/3 plans complete
Plans:

- [x] 08-01-PLAN.md — Scaffold extension/ (WXT), pin CSP/Firefox-MV2/gecko.id, extend build-wasm.sh for extension/ output
- [x] 08-02-PLAN.md — wasm-loader.ts + vault-session.ts round-trip proof with chrome.storage.session survival (TDD), wired into background.ts
- [x] 08-03-PLAN.md — Debug popup harness, packaged builds for both browsers, manifest verification + end-of-phase human-check for SC #1/#3/#4

### Phase 9: Session Unlock Core, Popup & Sync Client

**Goal**: Users can unlock, browse, and search their vault from the extension's popup interface, backed by the real `pv-server` REST/WebSocket API and multi-device sync, with the unlocked key held safely for the session.
**Depends on**: Phase 8
**Requirements**: EXT-02, EXT-03, EXT-04, EXT-05, EXT-06
**Success Criteria** (what must be TRUE):

  1. On first run the user configures their own self-hosted `pv-server` URL in the extension; the URL is validated (reachable, e.g. `/healthz`) before use, persisted, and editable later — nothing is hard-coded. (EXT-05)
  2. User unlocks the vault from the popup with the master password, and with a PRF passkey where the browser supports it.
  3. The unlocked User Key lives only in `chrome.storage.session` (never `storage.local`) and the vault stays usable across a service-worker idle-kill/wake cycle within the session — verified after leaving the browser idle 60+ seconds and retrying.
  4. The session auto-locks — the key is cleared after a configurable idle timeout and on browser close, so an unlocked vault never persists indefinitely.
  5. In the popup, the user can browse, search, and pick any vault item, and an edit made on another synced device (or the v0.1 web app) appears via the same REST + WebSocket sync used in v0.1 — all targeting the user-configured server URL.
  6. The self-hosted `pv-server`'s CORS allowlist accepts the fixed published extension origin (`chrome-extension://<published-id>` / `moz-extension://<id>`), verified end-to-end against a real request, not assumed. (EXT-05)
  7. The popup exposes a "fullscreen / open full vault" action that opens the configured server's v0.1 web-app frontend in a new browser tab; the popup does not re-implement full vault management. (EXT-06)

**Plans**: 6/8 plans executed
Plans:
**Wave 1**

- [x] 09-01-PLAN.md — pv-wasm session export/import pair + pv-server CORS allowlist
- [x] 09-03-PLAN.md — Server URL configuration, healthz validation, optional host permissions (EXT-05)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 09-02-PLAN.md — chrome.storage.session envelope, autolock, router, ext-protocol

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 09-04-PLAN.md — Password + PRF unlock ceremony (EXT-02)
- [x] 09-05-PLAN.md — REST + WS sync client, vault store, search (EXT-04)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 09-08-PLAN.md — Extension-scoped PRF passkey: pv-core ext-PRF constant, /api/extension-passkeys blob CRUD, background enroll/unlock kinds, manifest.key pin (EXT-02; added 2026-07-15 per 09-CONTEXT AMENDMENT — web-RP passkeys are unusable from the popup)

**Wave 5** *(blocked on Wave 4 completion)*

- [x] 09-06-PLAN.md — Popup UI: server config, unlock (password + ext-PRF passkey), enrollment prompt, browse/search/pick, open full vault (EXT-02/03/04/06)

**Wave 6** *(blocked on Wave 5 completion)*

- [x] 09-07-PLAN.md — Manual UAT checkpoint for all 7 success criteria

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

**Plans**: 7/9 plans executed
Plans:

- [x] 10-01-PLAN.md — Message contract (autofill.* kinds) + frame-guard origin/frame access-control gate + router sender-threading (D-04/D-09/D-10)
- [x] 10-02-PLAN.md — Deterministic login + TOTP detection (type=password/one-time-code, no scoring) (FILL-01/FILL-02, D-06)
- [x] 10-03-PLAN.md — Scored autocomplete-first card + identity detection with threshold gate + curated fixtures (FILL-03/FILL-04, D-05)
- [x] 10-04-PLAN.md — Background match/fill/totpCode handlers: origin-gated decrypt, live totpNow, frame-addressed dispatch, fill-time re-verification (D-02/D-08)
- [x] 10-05-PLAN.md — ISOLATED content-relay (detect/fill, all-frames, crypto-free) + native-setter React-safe fill-dom (D-01, Pitfall 5)
- [x] 10-06-PLAN.md — Popup "Na tej stronie" autofill UI: picker, TOTP fill/copy, card/identity second-confirm (D-07/D-12, UI-SPEC)
- [x] 10-07-PLAN.md — Adversarial cross-origin-iframe fixture + SC#5 UAT gate + real-forms framework-fill checklist (SC#5 proven; blocking-human taste checkpoint surfaced 2 scope decisions below)
- [x] 10-09-PLAN.md — Content-frame protocol (autofill.matchFrame/fillFrame) + background handlers + dedicated content-sender guard (Bartek: in-page affordance, security half)
- [ ] 10-10-PLAN.md — In-page shadow-DOM overlay: in-field dropdown (focus) + form-detect prompt, NordPass-style, crypto-free; blocking-human taste checkpoint (Bartek)

_Note: 10-08's TOTP issuer-match fix (Bartek's checkpoint decision) landed inline as commit ee01c31; 10-09/10-10 add the in-page affordance he requested at the 10-07 checkpoint, replacing the popup-only MVP scope the UI-SPEC had flagged for his confirmation._

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

**Plans**: 9/9 plans executed
Plans:

- [x] 11-01-PLAN.md — Messaging protocol extension (generate-request/capture.propose/capture.confirm) + v0.1 generator port + generate-request background handler
- [x] 11-02-PLAN.md — Signup/login form detection + AJAX/SPA-aware submit-capture success heuristic (ISOLATED content script)
- [x] 11-03-PLAN.md — Background capture classification (new/update/no-op), independent origin-mismatch verification, and encrypt-then-persist
- [x] 11-04-PLAN.md — Shadow-root UI mount + generate-password popover (Surface 1, CAP-01)
- [x] 11-05-PLAN.md — Save/update toast + origin-mismatch modal + adversarial cross-origin-iframe UAT fixture (Surfaces 2/3, CAP-02/CAP-03, D-06)
- [x] 11-06-PLAN.md — Suggested bez formularza: popupowa sekcja "Na tej stronie" pokazuje loginy origin-match na stronach bez wykrytego formularza (D-11, addendum Bartka 2026-07-16)
- [x] 11-07-PLAN.md — Parytet motywu i stylu z frontendem: lustro motywu z web appa, tokeny vault-light/dark na wszystkich powierzchniach (in-page + overlay z 10 + popup), generator 1:1 z GeneratorPopover (D-12, Bartek 2026-07-16)
- [x] 11-08-PLAN.md — Restyling powierzchni in-page na tokenach pv-ui (overlay z 10 + popover/toast/modal z 11), generator layout 1:1 z GeneratorPopover, motyw live za lustrem (D-12/D-13)
- [x] 11-09-PLAN.md — Live-review Bartka: scroll list kont w dropdownie/prompcie in-page, button-style hover na wierszach popupu, polaryzacja hover w vault-light

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

**Plans**: 4/4 plans executed

- [x] 12-01-PLAN.md
- [x] 12-02-PLAN.md
- [x] 12-03-PLAN.md
- [x] 12-04-PLAN.md

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

**Plans**: 6/6 plans executed
Plans:

- [x] 13-01-PLAN.md — Firefox install + manifest/CSP/gecko hardening + web-ext lint (D-02/D-04/D-07/D-09)
- [x] 13-02-PLAN.md — PRF honest-degradation cross-browser (feature-detect module + banner copy, D-03/D-06)
- [x] 13-03-PLAN.md — Playwright Chromium harness + full Chrome UAT pass (21 SCs, 24-row checklist)
- [x] 13-04-PLAN.md — Firefox UAT pass + divergence triage/fixes + final sign-off (D-01/D-05/D-08)
- [x] 13-05-PLAN.md — moz-extension CORS: server scheme-wildcard mechanism (D-10 tech-debt flagged) + CORS-vs-unreachable UX (D-11) + self-hosting docs
- [x] 13-06-PLAN.md — Firefox passkey unlock via server-origin PRF ceremony (Bartek-mandated post-research; reuses v0.1 passkeyUnlock + content-relay channel)

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
| 8. Extension Bootstrap & WASM-in-Background Spike | v0.2 | 3/3 | Complete    | 2026-07-15 |
| 9. Session Unlock Core, Popup & Sync Client | v0.2 | 8/8 | Complete    | 2026-07-15 |
| 10. Autofill — Login, TOTP, Card & Identity | v0.2 | 7/9 | Complete    | 2026-07-16 |
| 11. Generate & Capture | v0.2 | 9/9 | Complete    | 2026-07-16 |
| 12. Passkey Provider | v0.2 | 7/7 | Complete    | 2026-07-17 |
| 13. Dual-Browser Hardening | v0.2 | 6/6 | In Progress|  |
