# Requirements: Passkey Vault — v0.3 Polish & Hardening

> Milestone v0.3. Continues from v0.2 (browser extension: provider + autofill + dual-browser,
> phases 8–13, sealed 2026-07-20). v0.3 consolidates: one login model (Vaultwarden-style —
> full sign-in through a window, popup = unlock only), one design system / component source of
> truth (extension pulls from the frontend via `packages/pv-ui` wherever architecture allows),
> in-page visual consistency, and the technical-debt + hidden-risk backlog surfaced during v0.2's
> live-debugging run (see `.planning/research/v0.3/CODEBASE-GAPS.md` and
> `DESIGN-SYSTEM-UNIFICATION.md`). Zero-knowledge is preserved throughout; the Phase-12 SECURED
> posture must not regress.
>
> **v0.2 (complete):** EXT-01..06, PROV-01..05, FILL-01..04, CAP-01/02/03, XBR-01 — all delivered
> and verified; full history in `.planning/phases/08..13`, requirement archive in
> `milestones/v0.2-REQUIREMENTS.md`. Not formally milestone-closed (no cleanup/retrospective) by
> explicit choice — full implementation history kept until v1.0.

## v0.3 Requirements

### AUTH — Login & Unlock Model (Vaultwarden-style)

- [ ] **AUTH-01**: Full sign-in to the extension ALWAYS runs through the server-origin ceremony window on both browsers; the popup no longer offers password sign-in — the popup is unlock-only. One login path, matching the Vaultwarden model.
- [ ] **AUTH-02**: The popup's unlock surface offers master-password unlock and passkey unlock (the latter via the ceremony window), with no full-login / no-session affordance inside the popup itself.
- [ ] **AUTH-03**: Vault unlock is unified onto the server-origin passkey ceremony (research option 2) — the ext-scoped PRF unlock path is retired or explicitly documented as removed — so there is a single unlock mechanism across both browsers.
- [ ] **AUTH-04**: Reconfiguring the server URL while a session or host-permission already exists is handled cleanly — the old session/host-permission is invalidated or migrated with no stranded state (closes v0.2 deferred row V-04).

### DS — Unified Design System & Components

- [ ] **DS-01**: Pure shared logic + types (card-brand detection, domain/search helpers, sort comparator, clipboard, vault item type shapes) live once in `packages/pv-ui`; the extension consumes them via re-export shims — no parallel duplicate copies remain.
- [ ] **DS-02**: A shared i18n engine lives in `pv-ui`; the web app and the extension consume the same resolver (dictionary keys may be split per surface) rather than duplicating it.
- [ ] **DS-03**: `ItemIconTile` exists once as a shared React component in `pv-ui`, consumed by both the web app and the extension popup (single source of truth for the favicon / brand tile).
- [ ] **DS-04**: The in-page overlays consume `pv-ui` design tokens as their single style source (token-aligned); their imperative closed-shadow implementation stays separate by design, but no design values are duplicated.

### UX — In-Page & Window Polish

- [ ] **UX-01**: The in-page autofill surfaces (Surface A in-field dropdown + Surface B prompt) render item logos on a LIGHT tile, matching the web `ItemIconTile` and the popup — no more dark-tile inconsistency.
- [ ] **UX-02**: The Firefox consent + ceremony windows are centered over the active window, sized to their content, and self-close on resolution — formalized and regression-guarded (carries v0.2's window-polish work into a verified requirement).

### XBR — Cross-Browser Hardening

- [ ] **XBR-02**: Response-direction cross-realm binary integrity on Firefox — WebAuthn credential fields returned to the page (`rawId`, `clientDataJSON`, `attestationObject`, `signature`, `authenticatorData`) are genuine same-realm `ArrayBuffer`s (or contract-equivalent); root-caused, fixed, byte-asserted in the harness, and the tracking doc git-tracked.
- [ ] **XBR-03**: (Decision-gated) In-page provider consent on Firefox — evaluate a closed-shadow-DOM consent panel as an alternative to the consent window, with clickjack mitigations, ONLY if a fresh security review confirms it preserves the SECURED posture; otherwise the window model stands and this is documented as rejected-with-reason.

### SEC — Server & Supply-Chain Hardening

- [ ] **SEC-01**: The pv-server CORS layer explicitly lists `Authorization` (and every header the extension actually sends) in `Access-Control-Allow-Headers` instead of the wildcard `*`, which Firefox does not let cover `Authorization`.
- [ ] **SEC-02**: The `moz-extension://*` scheme-wildcard in the CORS allowlist (D-10 tech-debt) is replaced with concrete per-install origins; a bare `*` remains fatal (WR-07 preserved).
- [ ] **SEC-03**: A supply-chain tripwire (`cargo audit` / `cargo deny`) runs in the toolchain, and the Rust toolchain + key crypto/auth crate versions (passkey-rs, webauthn-rs, openssl-sys, argon2/chacha/hkdf, getrandom) are pinned and reviewed.
- [ ] **SEC-04**: The WebAuthn sign-count clone-detection signal is acted on (surfaced / logged / flagged) rather than discarded — the counter is already persisted; the anomaly signal must not be dropped.

### QA — Test Rigor & CI

- [ ] **QA-01**: A CI pipeline (`.github/workflows`) runs the full gate — cargo workspace tests, extension vitest, web vitest, tsc (both), both wxt builds, web-ext lint, and the MAIN-world boundary audit — on push / PR.
- [ ] **QA-02**: The manual real-Firefox probes (server-unlock, provider-corruption, request-xray, CSP-strict) are each wired to an npm script and documented as a harness lane — no orphan probe files reachable only by hand.
- [ ] **QA-03**: The passkey provider has a real `webauthn-rs` round-trip test that verifies an actual assertion/attestation (real bytes, real signature verification) — not shape/`.ok`/`id`-only assertions — closing the fixture blind spot that hid the v0.2 serialization bug.
- [ ] **QA-04**: Rust WebAuthn response serialization has a unit gate asserting base64url byte shape for every binary field, and the cross-realm harness asserts real recovered bytes (not merely presence).

## Future Requirements (deferred beyond v0.3)

### v1.0 hardening
- OPAQUE migration for password login (currently hash-after-KDF)
- Full security audit of the hand-rolled crypto boundary before v1.0
- Milestone cleanup + retrospective for v0.2 / v0.3 (phase-dir archival — deliberately deferred to keep full implementation history until v1.0)

### v1+
- Sharing (encrypted links + family sharing), Password Health + breach monitor, attachments (disk storage trait), FIDO CXF import/export, email-masking integration — carried from v0.2 Active/Future.

## Out of Scope (v0.3)

| Feature | Reason |
|---------|--------|
| New end-user features | v0.3 is polish / hardening / consolidation only; feature work resumes v1+ |
| Big-bang design-system rewrite | DS work is incremental extraction into `pv-ui` (logic → i18n → components), never a from-scratch rebuild |
| React components inside the in-page overlays | Deliberate phase-10/11 architectural line — imperative closed-shadow stays; token-aligned only |
| Mobile / Windows providers, Bitwarden API compat, enterprise (SSO/SCIM/orgs), S3 attachments, RSA key layer | Unchanged from prior milestones (v2 / out of scope) |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 15 | Pending |
| AUTH-02 | Phase 15 | Pending |
| AUTH-03 | Phase 15 | Pending |
| AUTH-04 | Phase 15 | Pending |
| DS-01 | Phase 16 | Pending |
| DS-02 | Phase 16 | Pending |
| DS-03 | Phase 17 | Pending |
| DS-04 | Phase 17 | Pending |
| UX-01 | Phase 17 | Pending |
| UX-02 | Phase 18 | Pending |
| XBR-02 | Phase 14 | Pending |
| XBR-03 | Phase 18 | Pending |
| SEC-01 | Phase 19 | Pending |
| SEC-02 | Phase 19 | Pending |
| SEC-03 | Phase 19 | Pending |
| SEC-04 | Phase 19 | Pending |
| QA-01 | Phase 20 | Pending |
| QA-02 | Phase 20 | Pending |
| QA-03 | Phase 14 | Pending |
| QA-04 | Phase 20 | Pending |
