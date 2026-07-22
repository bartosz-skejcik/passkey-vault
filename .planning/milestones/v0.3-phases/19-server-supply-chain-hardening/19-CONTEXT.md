# Phase 19: Server & Supply-Chain Hardening - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning
**Mode:** Autonomous (infrastructure phase — skipped discuss per smart-discuss infrastructure rule)

<domain>
## Phase Boundary

The server's CORS boundary and supply-chain posture close the gaps the v0.3 codebase sweep flagged, and a regressed WebAuthn sign counter is surfaced instead of silently discarded.

- **In scope:** SEC-01 (Access-Control-Allow-Headers explicit list, no `*`; Firefox preflight with Authorization succeeds), SEC-02 (concrete per-install extension origins only — `moz-extension://*` wildcard removed, WR-07 bare-`*` rejection preserved), SEC-03 (cargo audit/deny in toolchain; Rust toolchain + crypto/auth crate versions pinned exact and reviewed vs sweep watch-list), SEC-04 (regressed sign counter surfaced — logged/flagged, not silently dropped; verified by test with a deliberately regressed counter).
- **Out of scope:** CI wiring of the new tooling (Phase 20 QA-01 — but make the commands CI-ready), any client-side UI redesign (D-11's cors-blocked screen already exists and is the UX for SEC-02), OPAQUE or other crypto hardening (post-v1.0).

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices at Claude's discretion — pure server/tooling phase. Standing constraints that bind:

- **SEC-02 supersedes D-10:** the `moz-extension://*` scheme-wildcard (AllowOrigin::predicate, 13-05) was accepted tech-debt explicitly "targeted by v0.3 SEC-02" (STATE.md Deferred Items). Replacement = concrete per-install origins via `PV_EXTENSION_ORIGINS` (comma-separated concrete origins). Firefox per-profile UUID churn is the UX cost — D-11's ServerConfigView already shows the extension's own copyable origin + PV_EXTENSION_ORIGINS pointer, so the self-hoster flow exists. Keep the fixed published chrome-extension origin default. WR-07 (bare `*` rejected) must keep its existing test green.
- **Phase 18 fallout to handle:** `probe-window-geometry.cjs` and other Firefox lanes rely on `moz-extension://*` for their random/pinned probe UUIDs — after SEC-02, lanes must pass their concrete pinned origin (probe uses fixed UUID f6a7b8c9-d0e1-4234-a567-89abcdef0123 → concrete origin known ahead of time) via PV_EXTENSION_ORIGINS in their server setup. Update lane docs/env so Phase 20 CI wiring inherits working commands. Do NOT leave the lanes red.
- **SEC-01:** replace `allow_headers(Any)`/`*` with the explicit list of headers the extension+web actually send (at minimum: `authorization`, `content-type`; verify against real requests). Prove with a real Firefox preflight test (the e2e-firefox lane pattern or a direct reqwest/curl preflight assertion in a Rust test — live proof preferred per SC wording "against the real server").
- **SEC-03:** `cargo audit` and/or `cargo deny` wired as npm-style script/Make target + config file (deny.toml advisories/bans/sources); rust-toolchain.toml pinned to an exact version; exact-pin (`=x.y.z`) the watch-list crates (passkey-rs, webauthn-rs, openssl-sys if present, argon2, chacha20poly1305, hkdf, getrandom) in Cargo.toml or document why workspace pins via Cargo.lock suffice — the sweep's CODEBASE-GAPS.md wording governs; review current versions against the watch-list.
- **SEC-04:** find the webauthn-rs counter handling in the assertion-verification path; surface a regressed (non-incrementing) counter via tracing::warn + a flag on the credential row or response — do NOT hard-fail ceremonies (many authenticators, incl. passkeys in software vaults, legitimately report 0 counters; only a REGRESSION — nonzero stored > received — is suspicious). Test with a deliberately regressed counter per SC4.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- CORS setup: `crates/pv-server/src/routes/mod.rs` (or wherever AllowOrigin::predicate lives — 13-05 D-10 implementation, logs the wildcard warning at boot). WR-07 rejection test exists (bare `*` fails).
- webauthn-rs 0.5 assertion verification (login/unlock finish handlers) — counter lives in AuthenticationResult; server currently discards/ignores counter updates (QA sweep finding).
- cargo test --workspace suite (151 tests at last full run) — the Rust regression net.
- e2e-firefox lanes + their server-bootstrap conventions (Phase 18's probe docs) for the live Firefox preflight proof.

### Established Patterns
- Config via env (`Config::from_env()`, fail-loud `Config::validate()` — Phase 7 pattern for new env semantics).
- Boot-time tracing::warn for security-posture notes (D-10 wildcard warning is the template — SEC-02 removes its wildcard branch).
- Probe lanes with own npm scripts; keep names in the `test:e2e:firefox:*` family.

### Integration Points
- `PV_EXTENSION_ORIGINS` env parsing + AllowOrigin predicate; ServerConfigView (D-11) client-side copy already references it.
- STATE.md Deferred Items row for D-10 → mark resolved by SEC-02 when done.
- Phase 20 will wire: cargo audit/deny command, the preflight test, all lanes — make each runnable via a single documented command.

</code_context>

<specifics>
## Specific Ideas

- SC1 demands a REAL preflight proof against the running server (not just unit-testing the tower-http layer config).
- SC4 demands a test with a deliberately regressed counter — a Rust integration test on the finish handler is the natural shape.
- Keep zero-knowledge invariants untouched; this phase must not touch pv-core crypto paths beyond reading counter metadata.

</specifics>

<deferred>
## Deferred Ideas

- OPAQUE hardening (pre-v1.0 candidate per PROJECT.md), per-credential counter-anomaly UI surfacing (server logs/flag suffice for v0.3).

</deferred>
