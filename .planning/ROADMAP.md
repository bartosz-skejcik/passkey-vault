# Roadmap: Passkey Vault

## Milestones

- ✅ **v0.1 MVP** — Phases 1–7 (shipped 2026-07-14) — self-hostable, zero-knowledge password manager: server + web app, PRF passkey unlock first-class, single-container Docker. Full details: [milestones/v0.1-ROADMAP.md](milestones/v0.1-ROADMAP.md)
- ✅ **v0.2 Browser Extension** — Phases 8–13 (complete 2026-07-20, not formally milestone-closed — full implementation history kept until v1.0) — WXT MV3 Chrome + Firefox extension that is a full passkey provider on third-party sites (`credentials.create`/`credentials.get`) AND a complete autofill companion for the whole vault (login/TOTP/card/identity), reusing `pv-core`/`pv-wasm` via WASM, zero-knowledge preserved.
- 🚧 **v0.3 Polish & Hardening** (in progress) — Phases 14–20 — consolidate v0.2: one login model (Vaultwarden-style — full sign-in via ceremony window, popup = unlock-only), one design-system source of truth (`packages/pv-ui`), in-page visual consistency, the two Critical risks from v0.2's live-debugging run closed first, and server/supply-chain + CI/test-rigor hardening.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)
- Numbering is continuous across milestones — v0.2 continued from v0.1's last phase (7), starting at Phase 8; v0.3 continues from v0.2's last phase (13), starting at Phase 14.

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

### ✅ v0.2 Browser Extension (complete, not formally closed)

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
- [x] **Phase 13: Dual-Browser Hardening** - Verified Chrome/Firefox parity (or explicit, legible Firefox degradation) across every feature built above (completed 2026-07-20)

### 🚧 v0.3 Polish & Hardening (in progress)

**Milestone Goal:** Consolidate v0.2 into a single, hardened surface: one login model (Vaultwarden-style — full sign-in always through the server-origin ceremony window, popup does unlock only), one design-system source of truth (`packages/pv-ui` extended to logic/types, i18n, and the first shared React component), in-page visual consistency (light tiles, token-aligned overlays), the two Critical cross-browser/test-rigor risks closed first, and server + supply-chain hardening — without regressing the Phase-12 SECURED posture or the zero-knowledge guarantee.

**Cross-cutting technical notes (apply across multiple phases below):**

- **Risk-first ordering (Bartek-mandated):** Phase 14 closes the two Critical risks flagged by the v0.3 codebase sweep (Firefox response-direction cross-realm corruption, no real-RP-verified provider ceremony) BEFORE any UX/design-system work begins — these are silent-failure classes a green CI cannot see.
- **`packages/pv-ui` is the design-system home, not a rewrite target (D-13 kept):** DS work is incremental `export *` shim extraction in the research's measured order — pure logic/types first, then the i18n engine, then the first shared React component (`ItemIconTile`) — never a from-scratch component-library rebuild. The `file:` dependency + Docker-cache-preserving consumption model from Phase 11 is unchanged.
- **In-page overlays stay imperative/closed-shadow by design:** DS-04/UX-01 token-align the in-page surfaces; they do not gain React. This architectural line from Phases 10–11 is preserved through v0.3.
- **XBR-03 is decision-gated, not a guaranteed build:** an in-page Firefox consent panel replacing the consent window ships only if a fresh security review confirms it preserves the SECURED posture; otherwise the window model stands and the requirement closes as rejected-with-reason.

- [x] **Phase 14: Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification** - Root-cause and byte-assert-fix the Firefox response-direction Xray hole and add a real `webauthn-rs` round-trip test for the provider ceremony, before any UX/design work (completed 2026-07-20)
- [x] **Phase 15: Login & Unlock Unification (Vaultwarden Model)** - One login path (full sign-in always via the server-origin ceremony window) and one unlock mechanism (password or server-origin passkey), replacing v0.2's dual popup/ext-scoped-PRF model (completed 2026-07-20)
- [x] **Phase 16: Design System Extraction — Logic, Types & i18n** - Pure vault logic/types and the i18n engine move into `packages/pv-ui`, consumed once by web and extension (completed 2026-07-21)
- [ ] **Phase 17: Shared Component & Visual Alignment** - `ItemIconTile` becomes a single shared React component; in-page autofill surfaces render light tiles and token-aligned styling matching the web app
- [ ] **Phase 18: Firefox Window & Consent Hardening** - Ceremony/consent window centering and self-close are formalized and regression-guarded; a security review makes an explicit decision on an in-page consent alternative
- [ ] **Phase 19: Server & Supply-Chain Hardening** - CORS explicitly lists `Authorization` and concrete origins, `cargo audit`/`cargo deny` + pinned toolchain, sign-count clone-detection acted on
- [ ] **Phase 20: Test Infrastructure & CI Gate** - Full-gate CI pipeline, real-Firefox probes wired to npm scripts, a permanent byte-serialization regression gate

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

**Plans**: 7/7 plans executed
Plans:

- [x] 13-01-PLAN.md — Firefox install + manifest/CSP/gecko hardening + web-ext lint (D-02/D-04/D-07/D-09)
- [x] 13-02-PLAN.md — PRF honest-degradation cross-browser (feature-detect module + banner copy, D-03/D-06)
- [x] 13-03-PLAN.md — Playwright Chromium harness + full Chrome UAT pass (21 SCs, 24-row checklist)
- [x] 13-04-PLAN.md — Firefox UAT pass + divergence triage/fixes + final sign-off (D-01/D-05/D-08)
- [x] 13-05-PLAN.md — moz-extension CORS: server scheme-wildcard mechanism (D-10 tech-debt flagged) + CORS-vs-unreachable UX (D-11) + self-hosting docs
- [x] 13-06-PLAN.md — Firefox passkey unlock via server-origin PRF ceremony (Bartek-mandated post-research; reuses v0.1 passkeyUnlock + content-relay channel)
- [x] 13-07-PLAN.md — Full passkey SIGN-IN via server-origin ceremony (Bartek-mandated 2026-07-18 "Zrób teraz"; reuses v0.1 passkeyLogin; + FF enroll-prompt seam fix)

**UI hint**: yes

### Phase 14: Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification

**Goal**: The two Critical risks flagged by the v0.3 codebase sweep — the unresolved Firefox response-direction cross-realm corruption and the provider ceremony never having been verified by a real relying party — are closed with byte-level proof, before any design or UX work in this milestone begins.
**Depends on**: Phase 13 (first phase of v0.3; risk-first per Bartek's explicit mandate — before any UX/design work)
**Requirements**: XBR-02, QA-03
**Success Criteria** (what must be TRUE):

  1. On real Firefox, every binary field of a WebAuthn credential returned to the page (`rawId`, `response.clientDataJSON`, `response.attestationObject`/`signature`, PRF `results.*`) is a genuine same-realm `ArrayBuffer` (or a documented contract-equivalent) — verified live, not inferred from the ISOLATED-realm decode step alone.
  2. `probe-request-xray.cjs` asserts (no longer skips) the response-direction byte-identity check, and the assertion passes.
  3. A Rust integration test feeds a provider-produced registration and authentication ceremony through an independent `webauthn-rs` verifier, and the assertion signature verifies over the real challenge — not a shape/`.ok`/`id`-only check.
  4. `.planning/debug/firefox-request-xray-hole.md` is git-tracked, resolved, and mirrored into STATE.md's Deferred/Resolved history so the record cannot be silently lost again.

**Plans:** 3/3 plans complete
Plans:
**Wave 1**

- [x] 14-01-PLAN.md — QA-03: independent webauthn-rs round-trip verification test for pv-provider's ceremony
- [x] 14-02-PLAN.md — XBR-02: live-Firefox differential root-cause probe + MAIN-world response-direction re-materialization fix

**Wave 2** *(blocked on 14-01 and 14-02 completion)*

- [x] 14-03-PLAN.md — XBR-02 regression coverage (jsdom test + hard-gated probe-request-xray.cjs) + full gate suite confirmation + debug-doc record hygiene

**UI hint**: no

### Phase 15: Login & Unlock Unification (Vaultwarden Model)

**Goal**: The extension has exactly one login path (full sign-in always through the server-origin ceremony window) and exactly one unlock mechanism (master password or the server-origin passkey ceremony from the popup) — replacing v0.2's dual popup-password-signin / ext-scoped-PRF model — and reconfiguring the server URL never leaves stranded session or permission state.
**Depends on**: Phase 14 (risk-first ordering — the AUTH refactor lands only after the two Criticals are closed)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):

  1. Full sign-in (establishing a session from a logged-out state) always opens the server-origin ceremony window on both Chrome and Firefox; the popup itself never renders a password sign-in form.
  2. From the popup, an existing-but-locked vault unlocks with the master password, or with a passkey via the ceremony window — no other unlock affordance exists inside the popup.
  3. The extension-scoped PRF unlock path (RP ID = extension id) is removed, or explicitly documented as retired; the server-origin passkey ceremony is the sole passkey-unlock mechanism, identical on both browsers.
  4. Changing the configured server URL while a session or host-permission already exists cleanly invalidates or migrates the old state — verified by reconfiguring against a second server and confirming no stranded session/permission remains.

**Plans**: 7/7 plans executed

Plans:
**Wave 1**

- [x] 15-01-PLAN.md — Ceremony window password sign-in relay (Wave 1)
- [x] 15-02-PLAN.md — AUTH-04 teardown module: clearSessionMeta/logout/signOutVaultSession (Wave 1)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 15-03-PLAN.md — Popup re-layout: SignInView hero + UnlockView password-first rewrite (Wave 2)
- [x] 15-05-PLAN.md — AUTH-04 confirm dialog + migration sequencing (Wave 2)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 15-04-PLAN.md — Ext-scoped PRF hard deletion + router/protocol surgery (Wave 3)
- [x] 15-07-PLAN.md — e2e rework (Playwright + Firefox harness) + phase-close gate (Wave 3)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 15-06-PLAN.md — Dictionary final cleanup + AUTH-03 structural guard test (Wave 4)

**UI hint**: yes

### Phase 16: Design System Extraction — Logic, Types & i18n

**Goal**: Pure vault logic/types and the i18n engine live once in `packages/pv-ui`, consumed by both the web app and the extension via `export *` shims — closing the largest block of byte-identical duplicated code without a big-bang rewrite.
**Depends on**: Phase 15 (numeric sequencing; this phase has no technical dependency on the AUTH refactor and could in principle run in parallel)
**Requirements**: DS-01, DS-02
**Success Criteria** (what must be TRUE):

  1. Card-brand detection, domain/search helpers, the sort comparator, clipboard, and vault item type shapes are defined once in `pv-ui`; web and extension import them through shims, and both test suites pass unchanged.
  2. A single i18n resolver (`t`/`interpolate`/`Locale`/`resolveLocale`) lives in `pv-ui`; the web app and extension both call the same engine, with dictionary keys split per surface where needed.
  3. No parallel duplicate implementation of any migrated module remains in `web/` or `extension/` — verified by search, not assumed.

**Plans:** 6/6 plans complete
Plans:
**Wave 1**

- [x] 16-01-PLAN.md — pv-ui config scaffolding: package.json exports map (+7) + web/tsconfig.json paths (+3)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 16-02-PLAN.md — types.ts reconciliation: web superset moves to pv-ui, both consumers shim
- [x] 16-03-PLAN.md — cardBrand + clipboard mechanical pure moves, both consumers shim
- [x] 16-04-PLAN.md — i18n engine (t/interpolate/resolveLocale) + common dictionary split + both consumers' dictionary.ts refactor

**Wave 3** *(blocked on 16-02 completion)*

- [x] 16-05-PLAN.md — search.ts pure move + sort.ts comparator split-move, both consumers

**Wave 4** *(blocked on Waves 2-3 completion)*

- [x] 16-06-PLAN.md — phase-gate: repo-wide zero-duplication grep + full build/test suite both consumers

**UI hint**: no

### Phase 17: Shared Component & Visual Alignment

**Goal**: `ItemIconTile` becomes a single shared React component — proving the pv-ui React-sharing pipeline end-to-end on the smallest real component — and every autofill surface (popup, in-page, web) renders item logos identically on a light, token-aligned tile.
**Depends on**: Phase 16
**Requirements**: DS-03, DS-04, UX-01
**Success Criteria** (what must be TRUE):

  1. `ItemIconTile` exists once as a React component in `pv-ui`, imported by both the web app and the extension popup — no second implementation remains.
  2. The in-page autofill dropdown (Surface A) and the in-page prompt (Surface B) render item logos on a light tile that visually matches the web app and popup — the prior dark-tile inconsistency is gone.
  3. The in-page overlays' hand-written styles read their color/spacing/radius values from `pv-ui` design tokens, with no duplicated or hand-copied design constants remaining in the overlay source.

**Plans:** 2/4 plans executed
Plans:
**Wave 1**

- [x] 17-01-PLAN.md — pv-ui peer-dependency infra (Option A: local node_modules for react/react-dom/lucide-react) + @source Tailwind scaffolding
- [x] 17-02-PLAN.md — DS-04/UX-01: --pv-tile-bg/--pv-tile-fg tokens + in-page `.pv-row-icon-tile`/`.pv-row-icon` CSS fix

**Wave 2** *(blocked on 17-01 completion)*

- [ ] 17-03-PLAN.md — DS-03: promote ItemIconTile to packages/pv-ui/components, both consumers become shims

**Wave 3** *(blocked on 17-02 and 17-03 completion)*

- [ ] 17-04-PLAN.md — Aggregate gate + Playwright/computed-style visual parity capture across all surfaces, both themes

**UI hint**: yes

### Phase 18: Firefox Window & Consent Hardening

**Goal**: The Firefox ceremony/consent window's centering and self-close behavior is formalized and protected by a regression check, and a fresh security review makes an explicit, documented decision on whether an in-page consent alternative can safely replace it.
**Depends on**: Phase 17
**Requirements**: UX-02, XBR-03
**Success Criteria** (what must be TRUE):

  1. The Firefox consent and ceremony windows open centered over the active window, sized to their content, and self-close on resolution — verified live and covered by a regression test/assertion so it cannot silently drift again.
  2. A dedicated, fresh security review of a closed-shadow-DOM in-page consent panel (including clickjack mitigations) is completed and its verdict is written down.
  3. The requirement resolves either way: the in-page panel ships only if the review clears it without regressing the SECURED posture, or the window model is confirmed as the standing implementation with the rejection reason recorded.

**Plans**: TBD
**UI hint**: yes

### Phase 19: Server & Supply-Chain Hardening

**Goal**: The server's CORS boundary and supply-chain posture close the gaps the v0.3 codebase sweep flagged, and a regressed WebAuthn sign counter is surfaced instead of silently discarded.
**Depends on**: Phase 18
**Requirements**: SEC-01, SEC-02, SEC-03, SEC-04
**Success Criteria** (what must be TRUE):

  1. `Access-Control-Allow-Headers` explicitly lists `Authorization` and every header the extension sends (no `*` wildcard); a Firefox preflight for an `Authorization`-bearing request succeeds against the real server.
  2. The CORS allowlist accepts only concrete per-install extension origins — the `moz-extension://*` scheme wildcard is gone — while a bare `*` origin still fails (WR-07 preserved).
  3. `cargo audit`/`cargo deny` runs as part of the toolchain, and the Rust toolchain plus key crypto/auth crate versions (passkey-rs, webauthn-rs, openssl-sys, argon2/chacha/hkdf, getrandom) are pinned to exact versions and reviewed against the sweep's watch-list.
  4. A WebAuthn assertion carrying a regressed (non-incrementing) sign counter is surfaced — logged or flagged — rather than silently dropped, verified against a deliberately regressed counter in a test.

**Plans**: TBD

### Phase 20: Test Infrastructure & CI Gate

**Goal**: The full verification surface — cargo workspace tests, extension/web vitest, both wxt builds, the MAIN-world boundary audit, and the real-Firefox probes — runs automatically on every push/PR, and the Rust byte-serialization bug class that hid the v0.2 regression has a permanent regression gate.
**Depends on**: Phase 19
**Requirements**: QA-01, QA-02, QA-04
**Success Criteria** (what must be TRUE):

  1. A `.github/workflows` CI pipeline runs the full gate — cargo workspace tests, extension vitest, web vitest, `tsc` (both), both `wxt` builds, `web-ext lint`, and the MAIN-world boundary audit — on push/PR, and is green against the current `main`.
  2. Every manual real-Firefox probe (server-unlock, provider-corruption, request-xray, CSP-strict) is wired to its own npm script and documented as a harness lane — none is reachable only by a hand-typed command anymore.
  3. A Rust unit test asserts base64url byte shape for every binary WebAuthn response field, and fails if the serialization path (e.g. `serialize_bytes_as_base64_string`) regresses to a bare number array.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20

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
| 13. Dual-Browser Hardening | v0.2 | 7/7 | Complete    | 2026-07-20 |
| 14. Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification | v0.3 | 3/3 | Complete    | 2026-07-20 |
| 15. Login & Unlock Unification (Vaultwarden Model) | v0.3 | 7/7 | Complete    | 2026-07-20 |
| 16. Design System Extraction — Logic, Types & i18n | v0.3 | 6/6 | Complete    | 2026-07-21 |
| 17. Shared Component & Visual Alignment | v0.3 | 2/4 | In Progress|  |
| 18. Firefox Window & Consent Hardening | v0.3 | 0/TBD | Not started | - |
| 19. Server & Supply-Chain Hardening | v0.3 | 0/TBD | Not started | - |
| 20. Test Infrastructure & CI Gate | v0.3 | 0/TBD | Not started | - |
