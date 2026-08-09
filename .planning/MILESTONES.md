# Milestones

## v0.4 Family & Sharing (Shipped: 2026-08-09)

Phases 21–28 · 64 plans · 548 commits · 611 files, +113,497/−509

Made the instance multi-user without giving up zero-knowledge. The server still never sees a private
key, a Collection Key, or any plaintext, and deployment is unchanged: 1 container, SQLite.

- **Asymmetric sharing layer in `pv-core`** — X25519 identity keypairs, sealed-box Collection Keys and
  scope-bound AAD, with the `crypto_box`-vs-hand-rolled decision recorded *before* any dependent code.
  Adding or removing a member rewraps keys only; a byte-level `SELECT` proves `enc_data` is untouched.
- **Family/collection model behind one uniformly-enforced membership check**, plus live shared-data
  fan-out over the existing WS channel and per-collection revision counters.
- **Invitations with no SMTP** — single-use, expiring links/codes that work for both a brand-new
  registration and an existing account, branching at redemption on whether a session exists.
- **Three access levels** (read-only / full-edit / hidden-password), with hidden-password stated
  honestly as an interface protection rather than a cryptographic one.
- **Atomic, cost-bounded re-key** on suspension and removal — proven by fault injection *and* a
  documented kill-and-revert confirming the test goes red against a broken implementation.
- **Shared items identical in web and extension** — autofill, TOTP, and real `credentials.get()`
  passkey ceremonies on third-party sites through the same item-wrap mechanism as any other item.
- **The EXT-10 spike falsified its own requirement's premise:** provider passkeys set no signature
  counter at all, iCloud Keychain and Google Password Manager both report `signCount: 0` as WebAuthn L3
  permits, and the SEC-04 anomaly classifier is structurally unreachable from a provider ceremony.

**The lesson worth carrying:** all seven original phases verified `passed`, and the cross-phase audit
then found three defects every one of them missed — each the same shape, *a server capability no client
reaches*. Phase 28 existed solely to close them. Per-phase verification cannot see a gap that lives
between phases.

Audit: `milestones/v0.4-MILESTONE-AUDIT.md` · Full details: `milestones/v0.4-ROADMAP.md`
Debt into v0.5: 5 items (orphaned `identity/verify`, export mask, add-to-existing-collection,
`pendingSharedItems` pruning, clippy ×19). Unimplemented: UX-04, FAM-10.

## v0.3 Polish & Hardening (Shipped: 2026-07-22)

**Phases completed:** 7 phases (14–20), 29 plans

**Delivered:** Consolidated v0.2 into a single hardened surface — one login model, one design-system source of truth, closed Critical risks, hardened server/supply-chain, and a full CI gate — without regressing the SECURED posture or the zero-knowledge guarantee.

**Key accomplishments:**

- Critical-risk closure first (Phase 14): XBR-02 root-caused as a WebDriver measurement artifact (real fix kept as defense-in-depth) with permanent jsdom + inline-fixture live-Firefox regression gates; QA-03 closed by a real cross-vendor `webauthn-rs` (kanidm) round-trip test verifying pv-provider's actual register+authenticate ceremonies.
- Login/unlock unification onto the Vaultwarden model (Phase 15): sign-in ALWAYS via the server-origin ceremony window (password + passkey, both browsers), popup reduced to unlock-only + server URL; the ext-scoped PRF path hard-deleted (9 files, 6 message kinds) with a permanent grep-based guard test; clean server-URL migration proven live on two servers.
- Design-system extraction (Phases 16–17): 7 canonical logic/types/i18n modules and the first shared React component (`ItemIconTile`) live once in `packages/pv-ui`, consumed by web + popup via 1-line shims and by the in-page overlays via `tokens.css` — 16/16 computed-color parity across surfaces, dark-tile inconsistency closed, exactly-8-literal overlay allowlist audited, permanent visual-regression harness (`extension/e2e-visual/`).
- Firefox window & consent hardening (Phase 18): ceremony/consent window geometry formalized (13 unit tests + live GEOM probe lane 7/7); XBR-03 in-page consent resolved REJECT-WITH-REASON after a four-dimensional security review (DEF CON 33 clickjacking class — window model stands).
- Server & supply-chain hardening (Phase 19): CORS explicit allow-headers + concrete per-install origins only (D-10 wildcard tech-debt retired, fail-loud parse), WebAuthn sign-counter anomaly surfaced (migration 0013 + classifier, hard-fail untouched), cargo-audit/cargo-deny + deny.toml + exact `=x.y.z` pins + toolchain 1.97.0.
- Test infrastructure & CI gate (Phase 20): 4-job `.github/workflows/ci.yml` reproducing the full local gate 1:1 (SHA-pinned actions, least-privilege token, supply-chain job), all 6 real-Firefox probe lanes wired to npm scripts and documented, macOS passkey-sheet suppression for unattended harness runs, and the permanent `response_shape.rs` byte-shape regression gate closing the D-21 bug class.

**Quality gates:** 20/20 requirements satisfied (audit passed), 7/7 phases verified + Nyquist-compliant + threat-secure; per-phase code reviews (opus) with all Critical/Warning findings fixed; integration checker 5/5 seams wired.

**Note:** v0.2's phase directories (8–13; milestone completed 2026-07-20 but never formally closed) were archived alongside this close under `milestones/v0.2-phases/`.

---



---

## v0.1 MVP (Shipped: 2026-07-14)

**Phases completed:** 7 phases, 29 plans, 67 tasks

**Key accomplishments:**

- New `pv-wasm` crate bridges pv-core's Argon2id/HKDF/XChaCha20-Poly1305 crypto to `wasm32-unknown-unknown` through opaque-handle wasm-bindgen types (`WasmWrappingKey`, `WasmUserKey`), plus a reproducible `scripts/build-wasm.sh` that single-sources the wasm-bindgen version pin and audits for duplicate `getrandom` majors.
- Hand-authored Next.js 16 static-export scaffold (`web/`) with both `vault-dark`/`vault-light` DaisyUI 5 CSS-first themes matching docs/UI-DESIGN.md §5's exact OKLCH tokens, `next/font`-loaded DM Sans + Fuzzy Bubbles, a flash-free inline pre-hydration theme script, and `prebuild`/`predev` wired to plan 01-01's `scripts/build-wasm.sh` — verified via a from-scratch `npm install && npm run build` producing a working `web/out/` static export.
- The phase's demoable slice: a datafa.st-themed shell (Sidebar/TopBar/MainColumn, vault-dark default with persisting vault-light toggle) plus a SelfTestCard that runs a real derive→wrap→unwrap→encrypt→decrypt round trip through the compiled pv-wasm module via the new `lib/crypto/` choke-point facade — verified 5/5 green in a live browser with a clean console.
- AD-bound item encryption (item_id/revision-keyed AAD) and single-Argon2id-pass auth-hash/wrapping-key derivation, threaded through pv-core → pv-wasm → the lib/crypto/ facade.
- Real axum auth API (`prelogin`/`register`/`login`/`logout`/`me`) over a hashed bearer-token `SessionUser` extractor, backed by a new `pv-server` lib+bin split and an in-memory integration-test harness — the server never stores a password, a wrapping key, or a client-computed auth_hash verbatim.
- Session-scoped REST CRUD for vault items and folders over the rebuilt encrypted-blob schema — optimistic-concurrency revisions on items, zero plaintext type/folder metadata, and cross-user access uniformly returning 404, never a silent overwrite or existence-confirming 403.
- The browser half of AUTH-01/AUTH-02/AUTH-08: registration (one password entry, lands unlocked), login (lands authenticated-but-locked), the architecturally-distinct unlock overlay over a data-free blurred shell, idle auto-lock that frees the WASM UserKey handle without killing the session, and the PL/EN i18n contract every later component consumes.
- The first real, demoable vault slice — create a login/card/identity/note item (with folder + freeform tags), see it appear instantly in an in-memory-searched list, and open a detail panel showing genuinely decrypted fields, all through the real server API and real AD-bound XChaCha20-Poly1305 encryption, not mocks.
- Vault edit/delete with revision-conflict handling, a CSPRNG character+passphrase generator backed by the real vendored EFF wordlist, a clipboard auto-clear guarantee with a live-countdown toast, functional folder/tag filtering, and three UAT-driven fixes (overlay drawer layout, multi-URL logins, interactive sidebar nav) — completing all ten of Phase 2's requirement IDs.
- Closes UAT gaps GAP-02-02/03/04: a Categories/Folders/Tags/Tools sidebar with a working standalone password generator, server-truthful relative "last updated" timestamps on every item row, and a kebab/right-click action menu that reuses every existing safe clipboard/concurrency/delete primitive.
- Detail-panel passwords and card numbers now render as a fixed-length mask with a per-field Eye/EyeOff reveal toggle beside the copy button (CVV stays masked with no toggle, reveal state resets on item switch), and the password-generator popover anchors via dropdown-end with a viewport-clamped width so it can never overflow the viewport — closing GAP-02-01 and GAP-02-05.
- webauthn-rs 0.5 wired into a real, persisted-state two-ceremony passkey enrollment pipeline (register/start, register/finish, prf-wrap) with a `passkeys`/`webauthn_states` schema rebuild and end-to-end SoftPasskey-driven integration test coverage — no browser required, no in-memory ceremony state.
- Ownership-scoped CRUD for passkey management (list/rename/delete, with a server-enforced 409 recovery-invariant guard) and session management (list with current-session marking, revoke), directly mirroring vault.rs's established shape — completing AUTH-05/AUTH-06/AUTH-07's backend API surface.
- 1. [Rule 3 - Blocking] `WasmWrappingKey` was type-only exported from `lib/crypto/index.ts`, blocking `enroll.ts`'s `WasmWrappingKey.fromPrf(...)` call
- The Settings drawer that makes phase 3's backend and enrollment ceremony reachable: 4-tab z-40 drawer opened from the sidebar account button, with passkey list/rename/delete (409-strand-guard surfaced as a visible alert), session list with current-device marking and individual + bulk revoke, and the Security tab absorbing the old dropdown's controls.
- Four new WebAuthn authentication endpoints (`passkey-login/start|finish`, `unlock/start|finish`) that both call the real `finish_passkey_authentication` verification gate — one issues a session for any enrolled passkey, the other structurally cannot issue a session and only offers PRF-capable credentials.
- A single `navigator.credentials.get()` gesture now both authenticates (session created) and unlocks (User Key unwrapped) via a shared teal `PasskeyUnlockButton`, with all three AUTH-09 fallback tiers (no-WebAuthn-support, PRF-unavailable, genuine-failure) plus silent cancellation independently tested on both `LoginForm` and `UnlockOverlay`.
- Pełny regression sweep green, a 9-krokowy real-browser walkthrough (Playwright + CDP virtual authenticator z PRF) potwierdził wszystkie 4 kryteria fazy — i złapał jednego realnego buga (anulowana ceremonia logowania renderowała vault bez sesji), naprawionego i pokrytego testem regresyjnym w `12261e8`.
- `users.vault_revision` atomic counter bumped inside every existing vault-item/folder mutation, plus a new `GET /api/sync?since=N` cheap-check/full-snapshot pull endpoint proven by 4 real-SQLite integration tests.
- `GET /api/sync/ws` metadata-only push channel: per-user `tokio::sync::broadcast` SyncHub on AppState, token-validated upgrade reusing the REST session hash lookup, publish calls wired into all five vault/folder mutation handlers, proven ciphertext-free and cross-user-isolated at the raw WS-frame level.
- Browser-side sync transport: WS client with jittered exponential-backoff reconnect and a 30s poll fallback, both funneling into one internal pullOnce(); store.ts's initial load and background sync unified into a single `applySyncSnapshot` merge with a revision watermark and a lock-race guard — all proven by vitest with a mocked global WebSocket and fake timers.
- Three small, deliberately-quiet UI surfaces (a reconnecting-only presence dot, a non-destructive proactive live-edit-conflict banner, and a calm auto-close-plus-toast on remote deletion) make Plan 05-03's client sync engine visible to the user without turning it chatty.
- RFC 6238 TOTP code generation added to pv-core via totp-rs, exposed through a pv-wasm `totpNow` export, and wired end-to-end as a fifth `ItemType` across TypePicker/ItemForm/DetailPanel/ItemRow/Sidebar with a live coral countdown ring component.
- Pure, framework-free import mapping layer for Bitwarden JSON/CSV, NordPass/1Password/LastPass/KeePass CSV, and a generic manual-mapping fallback -- all producing a shared `MappedItemDraft` intermediate shape, backed by papaparse@5.5.4 for RFC 4180-correct CSV parsing.
- A 640px `ImportWizard` (file select → auto-detect/manual-map → preview → write-loop → summary) driving Plan 06-02's mapping layer through the existing `createVaultItem`/`createVaultFolder` primitives, plus a client-side JSON/CSV export pipeline gated behind `ExportDialog`'s plaintext-warning confirmation — both wired into Settings' Import/Eksport tab, replacing the Phase 3 placeholder.
- A full-screen 3-step first-run onboarding takeover (`OnboardingWizard`) that embeds Plan 06-03's real `ImportWizard` as Step 1, offers static PRF/auto-lock orientation as Step 2, and a calm finish screen as Step 3 — triggered once, only after registration, gated by a per-browser `localStorage` flag.
- `Config::validate()` fail-fast RP_ID/ORIGIN checks, `router()`'s `Option<PathBuf>` SPA-fallback static serving, SQLite WAL + busy_timeout in `build_pool`, and SIGTERM-aware graceful shutdown — the pure-Rust server-side prerequisites for Phase 7's single-container Docker packaging.
- A 3-stage `Dockerfile` (real `pv-core`/`pv-wasm` compiled from source, only `pv-server` manifest-stubbed for cache-split) producing a single self-contained image, a `docker-compose.yml` reference deployment with a named-volume-persisted SQLite database, and a Polish `docs/SELF-HOSTING.md` quickstart — the packaging half of Phase 7's self-hostable single-container deployment.
- `deploy/nginx.conf.example` and `deploy/Caddyfile.example` both forward the sync WebSocket's upgrade handshake and strip the live session token from their own access logs (closing Phase 5's WR-02 gap on the proxy side), plus a scripted `scripts/verify-container.sh` gate that fronts the packaged image with real dockerized nginx AND Caddy, acquires a real session token, and asserts HTTPS healthz + WS upgrade + log redaction end-to-end.

---
