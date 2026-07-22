# Phase 19: Server & Supply-Chain Hardening - Research

**Researched:** 2026-07-21
**Domain:** Rust server hardening — CORS allowlist tightening, supply-chain tripwires, WebAuthn clone-detection signal surfacing
**Confidence:** HIGH (every claim below was verified directly against this repo's code, the local `~/.cargo/registry` source cache for `webauthn-rs` 0.5.5, and live crates.io registry queries — no training-data guesses on the load-bearing findings)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All implementation choices at Claude's discretion — pure server/tooling phase. Standing constraints that bind:

- **SEC-02 supersedes D-10:** the `moz-extension://*` scheme-wildcard (AllowOrigin::predicate, 13-05) was accepted tech-debt explicitly "targeted by v0.3 SEC-02" (STATE.md Deferred Items). Replacement = concrete per-install origins via `PV_EXTENSION_ORIGINS` (comma-separated concrete origins). Firefox per-profile UUID churn is the UX cost — D-11's ServerConfigView already shows the extension's own copyable origin + PV_EXTENSION_ORIGINS pointer, so the self-hoster flow exists. Keep the fixed published chrome-extension origin default. WR-07 (bare `*` rejected) must keep its existing test green.
- **Phase 18 fallout to handle:** `probe-window-geometry.cjs` and other Firefox lanes rely on `moz-extension://*` for their random/pinned probe UUIDs — after SEC-02, lanes must pass their concrete pinned origin (probe uses fixed UUID f6a7b8c9-d0e1-4234-a567-89abcdef0123 → concrete origin known ahead of time) via PV_EXTENSION_ORIGINS in their server setup. Update lane docs/env so Phase 20 CI wiring inherits working commands. Do NOT leave the lanes red.
- **SEC-01:** replace `allow_headers(Any)`/`*` with the explicit list of headers the extension+web actually send (at minimum: `authorization`, `content-type`; verify against real requests). Prove with a real Firefox preflight test (the e2e-firefox lane pattern or a direct reqwest/curl preflight assertion in a Rust test — live proof preferred per SC wording "against the real server").
- **SEC-03:** `cargo audit` and/or `cargo deny` wired as npm-style script/Make target + config file (deny.toml advisories/bans/sources); rust-toolchain.toml pinned to an exact version; exact-pin (`=x.y.z`) the watch-list crates (passkey-rs, webauthn-rs, openssl-sys if present, argon2, chacha20poly1305, hkdf, getrandom) in Cargo.toml or document why workspace pins via Cargo.lock suffice — the sweep's CODEBASE-GAPS.md wording governs; review current versions against the watch-list.
- **SEC-04:** find the webauthn-rs counter handling in the assertion-verification path; surface a regressed (non-incrementing) counter via tracing::warn + a flag on the credential row or response — do NOT hard-fail ceremonies (many authenticators, incl. passkeys in software vaults, legitimately report 0 counters; only a REGRESSION — nonzero stored > received — is suspicious). Test with a deliberately regressed counter per SC4.

**IMPORTANT — see Open Question 1 below:** this session's source-level verification found that webauthn-rs 0.5.5 already hard-fails ceremonies on genuine counter regression by default (`require_valid_counter_value: true`, unmodified by pv-server). The "do NOT hard-fail" instruction above is interpreted in this research as "do not newly weaken that existing protection" — see Open Questions for the full reasoning and the recommended resolution.

### Claude's Discretion
Everything under Locked Decisions above is explicitly framed as "Claude's Discretion — pure server/tooling phase," with the bullets above as standing constraints that bind within that discretion (no separate discretion list beyond what's noted per-item above).

### Deferred Ideas (OUT OF SCOPE)
- OPAQUE hardening (pre-v1.0 candidate per PROJECT.md)
- Per-credential counter-anomaly UI surfacing (server logs/flag suffice for v0.3)
- CI wiring of cargo audit/deny, the preflight test, and all e2e-firefox lanes (Phase 20 QA-01 — but this phase must make the commands CI-ready)
- Any client-side UI redesign (D-11's cors-blocked screen already exists and is the UX for SEC-02)
- OPAQUE or other crypto hardening beyond this phase's counter-metadata read (post-v1.0)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|--------------------|
| SEC-01 | The pv-server CORS layer explicitly lists `Authorization` (and every header the extension actually sends) in `Access-Control-Allow-Headers` instead of the wildcard `*`, which Firefox does not let cover `Authorization`. | Architecture Patterns Pattern 1 (real-socket preflight test reusing `test_server()`); Common Pitfalls #3 (only `authorization`+`content-type` are ever sent, grep-verified); Validation Architecture Wave 0 gap `cors_preflight.rs` |
| SEC-02 | The `moz-extension://*` scheme-wildcard in the CORS allowlist (D-10 tech-debt) is replaced with concrete per-install origins; a bare `*` remains fatal (WR-07 preserved). | Common Pitfalls #2 (full 4-UUID Firefox-lane inventory + README fix); Architecture Patterns (CORS diagram); existing `parse_extension_origins()`/WR-07 tests in `routes/mod.rs` (unchanged, still green) |
| SEC-03 | A supply-chain tripwire (`cargo audit` / `cargo deny`) runs in the toolchain, and the Rust toolchain + key crypto/auth crate versions (passkey-rs, webauthn-rs, openssl-sys, argon2/chacha/hkdf, getrandom) are pinned and reviewed. | Standard Stack (verified current registry versions for both tools + all watch-list crates); Code Examples (`deny.toml`, `rust-toolchain.toml` pin); Environment Availability (neither tool installed today — install step required) |
| SEC-04 | The WebAuthn sign-count clone-detection signal is acted on (surfaced / logged / flagged) rather than discarded — the counter is already persisted; the anomaly signal must not be dropped. | Summary + Open Question 1 (library already hard-fails; surfacing = distinguishing the log/DB signal, not preventing the fail); Architecture Patterns Pattern 2 (shared error classifier); Code Examples (migration `0013`); Validation Architecture Wave 0 (SQL-manipulation regression-test technique) |
</phase_requirements>

## Summary

This phase is a pure `pv-server` hardening pass with no crypto-boundary changes: tighten the CORS layer (SEC-01/02), add supply-chain tripwires (SEC-03), and surface a WebAuthn sign-counter clone-detection signal that currently only reaches `tracing::warn!(?e, ...)` inside a generic "ceremony failed" wrapper (SEC-04). All three finish handlers (`prf_wrap`, `unlock_finish`, `passkey_login_finish`) already share the exact same two-line pattern (`.map_err()` around `finish_passkey_authentication`, then `let _ = passkey.update_credential(&auth_result)`), so every fix in this phase is a **3x-repeated, mechanically identical edit** — a strong argument for extracting a shared helper.

**The single most important finding of this research session:** webauthn-rs 0.5.5 already hard-fails a ceremony with `WebauthnError::CredentialPossibleCompromise` on genuine counter regression — this is NOT something SEC-04 needs to add. `WebauthnBuilder`'s default `require_valid_counter_value: true` is untouched by `pv-server` (`lib.rs:71-77` calls plain `.build()`), and the library's internal check (`webauthn-rs-core-0.5.5/src/core.rs:1154-1174`, verified from the local registry source cache) already gates on exactly the condition CONTEXT.md describes ("nonzero stored > received is suspicious," skipping the check entirely when both counters are 0). So the ceremony is **already rejected today** — pv-server's gap is that this specific rejection reason is indistinguishable in the log from every other webauthn failure (wrong signature, expired challenge, etc.) and nothing is persisted about it. CONTEXT.md's "do NOT hard-fail ceremonies" instruction needs to be read as "do not newly introduce a hard-fail that doesn't already exist" — see Open Questions.

**Primary recommendation:** For SEC-01/02, replace `.allow_headers(Any)` with an explicit `[AUTHORIZATION, CONTENT_TYPE]` list and delete the `moz-extension://*` wildcard branch entirely, replacing it with concrete origins the operator lists per-install; prove the preflight fix with a real `TcpListener`-bound axum server + `reqwest` OPTIONS request (the codebase already has this exact harness for WS tests — reuse it, don't build new). For SEC-03, install `cargo-audit`/`cargo-deny` (both absent on this machine today), add `deny.toml`, and pin `rust-toolchain.toml`'s floating `stable` to the exact installed `1.97.0`. For SEC-04, extract a shared `handle_finish_auth_error()` helper across the 3 call sites that distinguishes `WebauthnError::CredentialPossibleCompromise` with its own `tracing::warn!` + a new DB flag column — the ceremony keeps failing exactly as it does today; only the log/DB signal changes.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CORS origin/header allowlisting | API / Backend | — | `tower-http::cors::CorsLayer` lives entirely in `pv-server`'s router construction; no client-tier change needed |
| Extension origin configuration (per-install concrete origins) | API / Backend (env var) | Browser / Client (ServerConfigView UI, unchanged) | `PV_EXTENSION_ORIGINS` is server config; D-11's copy-origin UX already exists client-side and needs no code change |
| Supply-chain vulnerability scanning | Toolchain / CI (not a runtime tier) | — | `cargo audit`/`cargo deny` run against `Cargo.lock`, outside the request path entirely |
| WebAuthn counter clone-detection signal | API / Backend | Database / Storage (new flag column) | Verification happens server-side in `finish_passkey_authentication`; persistence is the `passkeys` table |

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `reqwest` | crates.io | ~10 yrs (since 2016-10-16) | 11.3M/week | github.com/seanmonstar/reqwest | OK | Approved — new `pv-server` dev-dependency for the real-preflight integration test |
| `cargo-audit` | crates.io | ~9 yrs (since 2017-02-07) | 198K/week | github.com/rustsec/rustsec | OK | Approved — toolchain tripwire, not a project dependency |
| `cargo-deny` | crates.io | ~7 yrs (since 2019-05-13) | 93K/week | github.com/EmbarkStudios/cargo-deny | OK | Approved — toolchain tripwire, not a project dependency |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

All three verdicts came from `gsd-tools query package-legitimacy check --ecosystem crates` against the live registry — `[VERIFIED: crates.io registry]`. Existing watch-list crates (`webauthn-rs`, `passkey-authenticator`/`passkey-client`/`passkey-types`, `argon2`, `chacha20poly1305`, `hkdf`, `getrandom`, `openssl-sys`) are already-installed dependencies, not new installs this phase — their currency is covered under Standard Stack / State of the Art below, not this audit (SEC-03 is a pin/review task on existing deps, not a new-package install).

## Standard Stack

### Core (already in the workspace — no new production dependency this phase)
| Library | Version (Cargo.lock) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `webauthn-rs` | 0.5.5 `[VERIFIED: crates.io via cargo info — latest 0.5.x, "latest" tag is 0.6.1-dev pre-release]` | WebAuthn RP, incl. counter regression check | Already the project's chosen RP library; do not bump to 0.6.x pre-release for a hardening phase |
| `tower-http` (cors feature) | 0.6, features=["trace","cors","fs"] | CORS layer primitive (`CorsLayer`, `AllowOrigin`) | Already in use; SEC-01/02 only change how it's configured, not the dependency |

### Supporting (new this phase)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `reqwest` | latest `0.13.4` `[VERIFIED: crates.io — cargo info, published 2016, 11.3M/wk]` | dev-dependency, real HTTP client for the preflight integration test | Add under `[dev-dependencies]` in `crates/pv-server/Cargo.toml` only — never a production dependency |
| `cargo-audit` | `0.22.2` `[VERIFIED: crates.io — cargo search, live registry]` | RustSec advisory-DB scanner | `cargo install cargo-audit --locked` (or CI-cached binary); run as `cargo audit` |
| `cargo-deny` | `0.20.2` `[VERIFIED: crates.io — cargo search, live registry]` | license/ban/advisory/source policy engine, driven by `deny.toml` | `cargo install cargo-deny --locked`; run as `cargo deny check` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `cargo-audit` + `cargo-deny` (both) | `cargo-audit` alone | `cargo-audit` only checks RustSec advisories; `cargo-deny` additionally enforces license policy, duplicate-version bans (relevant here — the codebase already carries 3 parallel `getrandom`/`rand` version lines per CODEBASE-GAPS.md) and untrusted-source bans. CONTEXT.md says "and/or" — recommend **both**, since `deny.toml`'s `bans`/`sources` sections cover a different risk class than advisories |
| `reqwest`-based real-socket test | `tower::ServiceExt::oneshot` | `oneshot()` never performs real HTTP wire negotiation (no actual `OPTIONS` preflight round-trip) — it's exactly the mechanism SC1 explicitly asks to go beyond ("against the real server," CONTEXT.md). The codebase's own `tests/sync.rs` WS tests document this exact tradeoff for WebSocket upgrades (05-RESEARCH.md Pitfall 2) — the same logic applies to CORS preflight |
| Live-Firefox `e2e-firefox` preflight probe | Rust `reqwest` integration test | A live-Firefox probe is closer to literal browser behavior but is manual/geckodriver-dependent and NOT CI-ready without Phase 20's work. A `reqwest`-driven real-socket test IS CI-ready today, deterministic, and genuinely exercises HTTP-level preflight negotiation (not tower's in-memory `Service::call`) — satisfies "against the real server" without inheriting Phase 20's scope. Keep as PRIMARY proof; the e2e-firefox lane fix (below) is separately required regardless, for its own reasons |

**Installation:**
```bash
cargo add reqwest -p pv-server --dev
cargo install cargo-audit --locked
cargo install cargo-deny --locked
```

**Version verification performed:** `cargo info webauthn-rs` (installed toolchain, live registry query) confirmed 0.5.5 is the newest *stable* 0.5.x release; `cargo search cargo-audit`/`cargo search cargo-deny` confirmed current published versions against the live registry, not training data.

## Architecture Patterns

### System Architecture Diagram

```
Extension / Web client
    │  fetch(url, { headers: { Authorization: Bearer <token>, Content-Type: application/json } })
    ▼
┌─────────────────────────────────────────────────────────────┐
│ pv-server (axum)                                             │
│                                                                │
│  CorsLayer (routes/mod.rs cors_layer())                      │
│    ├─ PV_DEV_CORS=1 → CorsLayer::permissive() (dev escape)   │
│    └─ else → build_cors_layer(dev, PV_EXTENSION_ORIGINS)      │
│         ├─ AllowOrigin::list(concrete origins)  [SEC-02 fix] │
│         └─ .allow_headers([AUTHORIZATION, CONTENT_TYPE])      │
│                                                    [SEC-01 fix]│
│                         │                                     │
│                         ▼                                     │
│  Route handler (e.g. passkeys::unlock_finish)                 │
│    1. state.webauthn.finish_passkey_authentication(...)       │
│       ├─ Ok(auth_result)                                      │
│       └─ Err(WebauthnError::CredentialPossibleCompromise)     │
│              [library ALREADY hard-fails here — SEC-04 target]│
│                         │                                     │
│                    match on error variant                     │
│                         ├─ CredentialPossibleCompromise:       │
│                         │    tracing::warn!(counter_regression)│
│                         │    UPDATE passkeys SET               │
│                         │      counter_anomaly_at = now()      │
│                         │      WHERE credential_id = ?         │
│                         │    (still returns 400 — unchanged)   │
│                         └─ other errors: existing generic warn │
│    2. Ok path: passkey.update_credential(&auth_result)        │
│       (bookkeeping only — never reached on regression)        │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
                 SQLite `passkeys` table
                 (passkey_json blob — never decomposed;
                  new counter_anomaly_at column is additive)
```

### Recommended Project Structure
No new modules — this phase edits existing files in place:
```
crates/pv-server/src/
├── routes/mod.rs        # SEC-01/02: build_cors_layer(), parse_extension_origins()
├── routes/passkeys.rs   # SEC-04: prf_wrap (L268-275), unlock_finish (L489-508)
├── routes/auth.rs       # SEC-04: passkey_login_finish (L546-569)
├── lib.rs                # SEC-03 review touchpoint: build_webauthn() — confirm no
│                          #   require_valid_counter_value override is introduced
crates/pv-server/migrations/
└── 0013_passkey_counter_anomaly.sql   # NEW — additive flag column, SEC-04
crates/pv-server/tests/
└── cors_preflight.rs     # NEW — SEC-01's real-server proof (reuses test_server())
rust-toolchain.toml        # SEC-03: pin exact version
deny.toml                  # NEW — SEC-03: cargo-deny policy
```

### Pattern 1: Real-socket integration test (reuse, don't build)
**What:** `crates/pv-server/tests/common/mod.rs::test_server(pool)` already binds a real `TcpListener` on `127.0.0.1:0` and runs `axum::serve()` in a background `tokio::spawn`, returning `(Router, u16)`. It exists today ONLY for `tests/sync.rs`'s WebSocket tests (`oneshot()` cannot perform a real HTTP Upgrade).
**When to use:** Any test that needs genuine wire-level HTTP behavior `tower::oneshot()` cannot fake — SEC-01's real preflight proof is exactly this class of test.
**Example (new file, `crates/pv-server/tests/cors_preflight.rs`):**
```rust
// Source: pattern verified from crates/pv-server/tests/common/mod.rs:131-155 (test_server helper, already exists)
mod common;
use common::{test_app, test_server, test_pool};

#[tokio::test]
async fn firefox_preflight_with_authorization_header_succeeds_against_real_server() {
    // build_cors_layer's extension_origins_csv would come from a real
    // PV_EXTENSION_ORIGINS-equivalent value passed into test_app's AppState
    // construction (or a dedicated test_app_with_cors(csv) helper).
    let pool = test_pool().await;
    let (app, port) = test_server(pool).await;
    let _ = app; // keep the same Router clone alive per test_server's own doc contract

    let client = reqwest::Client::new();
    let res = client
        .request(reqwest::Method::OPTIONS, format!("http://127.0.0.1:{port}/api/vault/items"))
        .header("Origin", "moz-extension://a1b2c3d4-e5f6-4789-a012-3456789abcde")
        .header("Access-Control-Request-Method", "GET")
        .header("Access-Control-Request-Headers", "authorization,content-type")
        .send()
        .await
        .expect("real OPTIONS preflight over the wire");

    let allow_headers = res
        .headers()
        .get("access-control-allow-headers")
        .expect("Access-Control-Allow-Headers must be present")
        .to_str()
        .unwrap()
        .to_ascii_lowercase();
    assert!(allow_headers.contains("authorization"), "must explicitly list authorization, not *: {allow_headers}");
    assert_ne!(allow_headers, "*", "Firefox does not treat * as covering Authorization");
}
```

### Pattern 2: Shared finish-error classifier (avoids a 3x-duplicated diff)
**What:** All three finish handlers share the identical `.map_err(|e| { tracing::warn!(?e, "..."); ApiError::BadRequest(...) })` shape. SEC-04 should extract one function both to avoid drift and to centralize the DB-flag write.
**When to use:** Any place `finish_passkey_authentication`'s `Result` is matched.
**Example:**
```rust
// Source: derived from existing patterns in passkeys.rs:268-272, 489-492 and auth.rs:546-549
// (webauthn_rs::prelude::WebauthnError is the real, public enum this matches on —
//  verified via ~/.cargo/registry/.../webauthn-rs-core-0.5.5/src/error.rs:238)
async fn handle_finish_auth_error(
    db: &sqlx::SqlitePool,
    credential_id: &[u8],
    context: &'static str,
    e: webauthn_rs::prelude::WebauthnError,
) -> ApiError {
    if matches!(e, webauthn_rs::prelude::WebauthnError::CredentialPossibleCompromise) {
        tracing::warn!(
            credential_id = %base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(credential_id),
            "counter regression detected during {context} — possible cloned/compromised passkey"
        );
        // additive column, never decomposes passkey_json (0004_passkeys_rebuild.sql's rule)
        let _ = sqlx::query("UPDATE passkeys SET counter_anomaly_at = datetime('now') WHERE credential_id = ?")
            .bind(credential_id)
            .execute(db)
            .await;
    } else {
        tracing::warn!(?e, "{context} failed");
    }
    ApiError::BadRequest("passkey ceremony failed".into())
}
```

### Anti-Patterns to Avoid
- **Setting `require_valid_counter_value(false)` to "un-hard-fail" the ceremony:** This is the literal opposite of what SEC-04 should do. It would DISABLE the library's existing spec-correct clone detection — the ceremony would then silently accept a regressed counter. Nothing in CONTEXT.md or CODEBASE-GAPS.md asks for this; it would be a genuine security regression. See Open Questions for why this needs explicit confirmation before planning locks it in.
- **Decomposing `passkey_json` to add a `counter` column:** `0004_passkeys_rebuild.sql`'s own comment explicitly forbids this ("nigdy nie dekomponować" / never decompose) — the blob is `serde_json::to_string(&Passkey)` and must round-trip losslessly through webauthn-rs's own (de)serialization. A NEW, ADDITIVE column (`counter_anomaly_at`) alongside the untouched blob is the only compliant shape.
- **Reading `Passkey`'s private `counter` field via `danger-credential-internals`:** Technically possible (the feature exists, confirmed via `cargo info webauthn-rs`'s feature list) but unnecessary — `AuthenticationResult::counter()` (already public, already called inside `update_credential`) gives everything needed. Enabling a `danger-*` feature for a hardening phase whose whole point is reducing risk surface is a bad trade.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| WebAuthn sign-counter clone detection | A custom counter-comparison function | webauthn-rs's built-in `require_valid_counter_value` check (`core.rs:1154-1174`) — already active | It is already correct (spec §6.1.1 semantics: skip check when both counters are 0, hard-fail on regression) and already wired in; re-implementing it risks getting the "both-zero" exemption wrong and either false-positiving on ordinary software passkeys or missing real regressions |
| Supply-chain vulnerability tracking | A homegrown `Cargo.lock` version-diff script | `cargo-audit` (RustSec advisory DB) + `cargo-deny` (bans/licenses/sources) | Both are the community-standard tools for exactly this; a homegrown script would need its own vulnerability feed, which is a maintenance burden with zero upside |
| Real-server HTTP proof | Mocking `reqwest` or hand-rolling a raw TCP client | The existing `test_server()` helper + `reqwest` | The codebase already solved "how do I get a real socket in a `cargo test`" for WS — reuse it, don't reinvent |

**Key insight:** Every "don't hand-roll" item in this phase is really "don't re-derive something the dependency already got right" — the risk in this phase is DUPLICATING existing correct logic (webauthn-rs's counter check, the `test_server()` harness) rather than needing new algorithms.

## Common Pitfalls

### Pitfall 1: Believing SEC-04 requires preventing the ceremony from failing
**What goes wrong:** A plan that reads CONTEXT.md's "do NOT hard-fail ceremonies" literally and tries to make `update_credential`'s `Option<bool>` the sole surfacing mechanism will build a feature that **never fires on the interesting case** — a real regression already exits via `Err(WebauthnError::CredentialPossibleCompromise)` before `update_credential` is ever called.
**Why it happens:** CODEBASE-GAPS.md's Top-5 #5 and Tech-Debt table both describe the symptom as "`let _ = passkey.update_credential(&auth_result)` drops the signal," which is TRUE but describes a narrower, lower-stakes bookkeeping signal (did counter/backup-state change at all), not the clone-detection signal (which webauthn-rs already enforces upstream of that line).
**How to avoid:** Design SEC-04 around matching the `Err` branch of `finish_passkey_authentication`, not the `Ok` branch's discarded `Option<bool>`.
**Warning signs:** A test that tries to make a "regressed counter" ceremony return `200 OK` with a flag in the response body — that test is fighting the library's default and will require weakening security posture to pass.

### Pitfall 2: Wildcard removal breaking every Firefox e2e lane simultaneously
**What goes wrong:** SEC-02 removes the `moz-extension://*` predicate entirely. Five Firefox lanes (`run-core.cjs`, `run-autofill-capture.cjs`, `run-server-unlock.cjs`, `probe-provider-corruption.cjs`, `probe-window-geometry.cjs`, `probe-request-xray.cjs`) each pin a DIFFERENT `FIXED_UUID` (verified via grep — not a single shared constant):
| Lane(s) | `FIXED_UUID` |
|---|---|
| `run-core.cjs`, `run-autofill-capture.cjs` | `a1b2c3d4-e5f6-4789-a012-3456789abcde` |
| `run-server-unlock.cjs`, `probe-provider-corruption.cjs` | `b2c3d4e5-f6a7-4890-b123-456789abcdef` |
| `probe-request-xray.cjs` | `c3d4e5f6-a7b8-4901-b234-56789abcdef0` |
| `probe-window-geometry.cjs` | `f6a7b8c9-d0e1-4234-a567-89abcdef0123` |

None of these `.cjs` scripts spawn `pv-server` themselves — the `README.md` (`extension/e2e-firefox/README.md:23-29`) instructs the OPERATOR to hand-launch `cargo run -p pv-server` with `PV_EXTENSION_ORIGINS` including the wildcard. After SEC-02, the README's example command must list all four concrete `moz-extension://<uuid>` origins (not the wildcard) — e.g. `PV_EXTENSION_ORIGINS=chrome-extension://<id>,moz-extension://a1b2c3d4-e5f6-4789-a012-3456789abcde,moz-extension://b2c3d4e5-f6a7-4890-b123-456789abcdef,moz-extension://c3d4e5f6-a7b8-4901-b234-56789abcdef0,moz-extension://f6a7b8c9-d0e1-4234-a567-89abcdef0123` — or every lane not using the first UUID goes red.
**Why it happens:** Each lane predates a shared-UUID convention; they were written independently over Phases 13/14/18 (confirmed via distinct hardcoded fallback defaults per file).
**How to avoid:** Update `extension/e2e-firefox/README.md`'s prerequisite command to list all four UUIDs; do NOT assume the WR-07 wildcard-rejection test's coverage extends to "the operator remembered to update their shell". `extension/e2e-visual/capture-tile-parity.mjs` is UNAFFECTED (Chrome-only, spawns its own server with a dynamically-read Chrome extension ID, never touches `moz-extension`).
**Warning signs:** A green `run-core.cjs` but red `probe-window-geometry.cjs` (or vice versa) after the SEC-02 change — that's the UUID-mismatch, not a code regression.

### Pitfall 3: `Access-Control-Allow-Headers: *` change looks like a no-op in most tests
**What goes wrong:** The existing CORS unit tests (`routes/mod.rs`'s `mod tests`) only assert `access-control-allow-origin` — none assert `access-control-allow-headers`. A SEC-01 fix that's actually wrong (e.g., forgets a header the extension sends) will pass every EXISTING test while still being broken.
**Why it happens:** The test suite was built incrementally around D-10/WR-07 (origin allowlisting), never around header allowlisting, because `.allow_headers(Any)` "just worked" until Firefox's `Authorization` exception was discovered.
**How to avoid:** SEC-01's new test(s) must assert the actual `access-control-allow-headers` value, not just that a 2xx/successful preflight occurred. Confirmed via grep: today only `Content-Type` and `Authorization` are ever set by client code (`extension/entrypoints/background/auth-api.ts:77-85`, `web/src/lib/auth/api.ts:45-53`) — both use the identical `apiFetch`-style pattern (`Headers` object, conditional `Content-Type` when a body exists, conditional `Authorization` when a token exists). No other custom header exists anywhere in either client. The explicit list needs exactly `[authorization, content-type]` (case-insensitive per the CORS spec; tower-http lowercases).
**Warning signs:** A "passing" SEC-01 plan whose only new test asserts response status `200`/`204`, not the header value itself.

### Pitfall 4: `cargo-audit`/`cargo-deny` absent from this machine — plans that assume they're installed will silently no-op
**What goes wrong:** `command -v cargo-audit` / `command -v cargo-deny` both fail on this development machine (`error: no such command`) — confirmed directly. A plan step that runs `cargo audit` assuming it exists will error at execution time, not at planning time.
**Why it happens:** Neither tool ships with the Rust stable toolchain; both are separate `cargo install` targets.
**How to avoid:** SEC-03's plan MUST include an explicit install step (`cargo install cargo-audit --locked` / `cargo install cargo-deny --locked`) before the first invocation, and should make the resulting script/Make target check for the binary and print an actionable error if missing (matches this project's fail-loud convention already used for `Config::validate()`).
**Warning signs:** A plan step reading "run `cargo audit`" with no preceding install step.

## Code Examples

### `deny.toml` skeleton (SEC-03)
```toml
# Source: cargo-deny 0.20.2 config shape [VERIFIED: crates.io — cargo search]
# Minimal starting point; the sweep's watch-list crates (webauthn-rs, passkey-*,
# argon2, chacha20poly1305, hkdf, getrandom, openssl-sys) inform [bans] exemptions.
[advisories]
version = 2
ignore = []          # document any accepted-risk RUSTSEC IDs here with a comment

[bans]
multiple-versions = "warn"   # CODEBASE-GAPS.md already documents 3 getrandom lines
                              # as upstream-blocked (webauthn-rs + passkey-rs) — warn,
                              # not deny, until those deps converge
wildcards = "deny"

[licenses]
version = 2
allow = ["MIT", "Apache-2.0", "MPL-2.0", "BSD-3-Clause", "ISC", "Unicode-3.0"]

[sources]
unknown-registry = "deny"
unknown-git = "deny"
```

### `rust-toolchain.toml` exact pin (SEC-03)
```toml
# Source: rustc --version on this machine (1.97.0, released 2026-07-07);
# webauthn-rs 0.5.5's own rust-version requirement is 1.88 [VERIFIED via cargo info] —
# 1.97.0 comfortably satisfies it.
[toolchain]
channel = "1.97.0"
targets = ["wasm32-unknown-unknown"]
```

### Migration `0013_passkey_counter_anomaly.sql` (SEC-04)
```sql
-- Additive-only flag column — does NOT decompose passkey_json (0004's own rule).
-- NULL = no anomaly ever observed; a timestamp = the last time
-- WebauthnError::CredentialPossibleCompromise fired for this credential_id.
ALTER TABLE passkeys ADD COLUMN counter_anomaly_at TEXT;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `allow_headers(Any)` → literal `*` | Explicit header list `[AUTHORIZATION, CONTENT_TYPE]` | This phase (SEC-01) | Firefox correctly negotiates `Authorization`-bearing preflight; `Any`'s convenience is traded for an explicit, auditable allowlist |
| `moz-extension://*` scheme-scoped wildcard predicate | Concrete per-install `moz-extension://<uuid>` origins in `PV_EXTENSION_ORIGINS` | This phase (SEC-02) | D-10 tech-debt closed; self-hoster UX cost is the per-profile UUID churn — mitigated by D-11's existing copy-origin UI, unchanged this phase |
| No supply-chain scanning | `cargo audit` + `cargo deny` (manual/local this phase; CI wiring is Phase 20 QA-01) | This phase (SEC-03) | First automated tripwire against the native-OpenSSL and single-maintainer `passkey-rs` risks CODEBASE-GAPS.md flagged |
| Counter regression logged only via generic `?e` Debug print inside a shared "ceremony failed" warn | Dedicated `tracing::warn!` + DB flag on the specific `CredentialPossibleCompromise` variant | This phase (SEC-04) | Operationally distinguishable signal; ceremony's fail-closed behavior is UNCHANGED (webauthn-rs already enforces it) |

**Deprecated/outdated:** None — this phase does not touch any deprecated API surface; `webauthn-rs` 0.6.x is pre-release (`0.6.1-dev`) and deliberately NOT adopted this phase.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The explicit `Access-Control-Allow-Headers` list needs exactly `authorization` and `content-type` and no more | Common Pitfalls #3, Code Examples | LOW — directly grep-verified against both client codebases' only `fetch()` call sites (`auth-api.ts`, `web/src/lib/auth/api.ts`); a future new client header (e.g. a custom `X-` header) would need this list revisited, but nothing today sends one |
| A2 | `cargo-deny`'s `[bans] multiple-versions = "warn"` (not `"deny"`) is the right default given the existing triple `getrandom`/`rand` stack | Code Examples (deny.toml) | MEDIUM — this is a policy call, not a technical fact; CONTEXT.md doesn't specify pass/warn/deny thresholds for `cargo-deny`'s sections, so the planner or Bartek should confirm severity levels before locking `deny.toml` in |

## Open Questions (RESOLVED)

> RESOLVED 2026-07-21 by orchestrator binding decisions: Q1 → interpretation (a) — webauthn-rs's built-in counter-regression rejection stays enabled; SEC-04 = classifier + additive counter_anomaly_at surfacing (adopted in Plan 19-02 objective). Q2 → test_app cors_csv parameter, no in-process env mutation (adopted in Plan 19-01 Task 2).

1. **CONTEXT.md's "do NOT hard-fail ceremonies" instruction conflicts with webauthn-rs 0.5.5's existing default behavior.**
   - What we know: `require_valid_counter_value` defaults to `true` and is never overridden in `build_webauthn()` (`lib.rs:71-77`) — confirmed by reading the actual `WebauthnBuilder`/`.build()` call and the crate's internal check (`core.rs:1154-1174`). A genuinely regressed counter (stored > 0, new counter ≤ stored) is **already** rejected with `Err(WebauthnError::CredentialPossibleCompromise)` today, before the code ever reaches `update_credential`.
   - What's unclear: Whether CONTEXT.md's author (working from CODEBASE-GAPS.md's framing, which describes the discarded `Option<bool>` bookkeeping signal, not the library's internal hard-fail) intended "don't hard-fail" to mean (a) "don't newly disable webauthn-rs's existing protection" (trivially satisfiable — do nothing to `require_valid_counter_value`) or (b) "genuinely allow regressed-counter ceremonies to succeed with just a flag" (would require setting `require_valid_counter_value(false)`, a real security regression).
   - Recommendation: The planner should treat interpretation (a) as correct — surface the ALREADY-REJECTED ceremony's specific reason via a dedicated log line + DB flag, keep the ceremony fail-closed exactly as today. This should be called out explicitly to Bartek in the plan or PLAN.md's assumptions, since it's a meaningful reinterpretation of the CONTEXT.md wording discovered only through source-level verification this session.

2. **Should `cors_preflight.rs`'s test harness pass `PV_EXTENSION_ORIGINS`-equivalent config through `test_app`, or does `test_app`/`AppState` need a new parameter?**
   - What we know: `test_app(pool)` (`tests/common/mod.rs`) currently hardcodes RP id/origin but has no CORS-origin-csv parameter — `cors_layer()` reads `PV_EXTENSION_ORIGINS` from `std::env::var()` directly inside `routes/mod.rs`, not from `AppState`.
   - What's unclear: Whether the cleanest test shape is (a) setting the real env var in the test process (flaky under parallel `cargo test`, per the existing doc comment on `build_cors_layer`'s split-out design specifically warding against this), or (b) adding a `cors_csv: Option<String>` parameter to a new `test_app_with_cors()` helper that calls `build_cors_layer()` directly instead of going through the router's env-reading `cors_layer()` wrapper.
   - Recommendation: (b) — mirrors `build_cors_layer`'s own existing design rationale (split out specifically to avoid env-var mutation in tests) and `test_app_with_static_dir`'s established precedent of a `test_app_with_X()` variant for one specific test's needs.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `cargo` / `rustc` | All of Phase 19 | ✓ | 1.97.0 (stable, 2026-07-07) | — |
| `cargo-audit` | SEC-03 | ✗ | — | `cargo install cargo-audit --locked` (verified installable, 0.22.2 on crates.io) |
| `cargo-deny` | SEC-03 | ✗ | — | `cargo install cargo-deny --locked` (verified installable, 0.20.2 on crates.io) |
| Network access to crates.io | SEC-03 install step, `cargo audit`'s advisory-DB fetch | ✓ (confirmed — `cargo search`/`cargo info` succeeded live this session) | — | — |

**Missing dependencies with no fallback:** none — both missing tools install cleanly via `cargo install`.
**Missing dependencies with fallback:** `cargo-audit`, `cargo-deny` — both addressed by an install step at the start of the SEC-03 plan.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `cargo test --workspace` (Rust built-in test harness); `crates/pv-server/tests/*.rs` integration tests already exist and use a shared `common/mod.rs` harness |
| Config file | none — standard `cargo test` discovery; migrations run automatically inside `test_pool()`/`test_app()` |
| Quick run command | `cargo test -p pv-server` |
| Full suite command | `cargo test --workspace` (151 tests passing at last full run per STATE.md) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|-------------|
| SEC-01 | Real preflight with `Authorization` in the request succeeds against a genuinely bound TCP server, and the response's `Access-Control-Allow-Headers` explicitly lists `authorization` (not `*`) | integration | `cargo test -p pv-server --test cors_preflight` | ❌ Wave 0 — new file |
| SEC-02 | `moz-extension://*` is no longer accepted; a concrete `moz-extension://<uuid>` origin from `PV_EXTENSION_ORIGINS` IS accepted; WR-07 bare-`*` rejection stays green | unit | `cargo test -p pv-server build_cors_layer` | ✅ existing tests need editing (the current `build_cors_layer_moz_wildcard_*` tests assert the WILDCARD-ACCEPTING behavior being removed — these must be rewritten, not just extended) |
| SEC-03 | `cargo audit` and `cargo deny check` both run clean (or documented accepted-risk exceptions) against the current `Cargo.lock` | manual-only (this phase) / CI-wired in Phase 20 | `cargo audit && cargo deny check` | ❌ Wave 0 — install + `deny.toml` |
| SEC-04 | A deliberately regressed sign counter produces `WebauthnError::CredentialPossibleCompromise`, a dedicated `tracing::warn!` fires, and `counter_anomaly_at` is set on the credential row | integration | `cargo test -p pv-server --test passkeys counter_regression` (or new file) | ❌ Wave 0 — new test using the SQL-manipulation technique below |

### Sampling Rate
- **Per task commit:** `cargo test -p pv-server`
- **Per wave merge:** `cargo test --workspace`
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus a clean (or documented) `cargo audit && cargo deny check` run

### Wave 0 Gaps
- [ ] `crates/pv-server/tests/cors_preflight.rs` — covers SEC-01, needs `reqwest` as a new `[dev-dependencies]` entry and (per Open Question 2) a `test_app_with_cors()`-style helper in `common/mod.rs`
- [ ] `crates/pv-server/migrations/0013_passkey_counter_anomaly.sql` — covers SEC-04's persistence requirement
- [ ] SEC-04 regression test — **recommended technique** (verified feasible, not yet precedented in this codebase): after a real `SoftPasskey`-driven registration+auth ceremony establishes a nonzero stored counter, directly `UPDATE passkeys SET passkey_json = ?` via the test's own `sqlx::SqlitePool` handle to artificially bump the embedded JSON counter far above what the `SoftPasskey` authenticator (whose internal counter can only increment by 1 per real ceremony and has no public setter — confirmed via `webauthn-authenticator-rs-0.5.5/src/softpasskey.rs`, no `Clone` derive, private `counter: u32` field) will present on its next real assertion — then perform ONE more real ceremony and assert the `Err` branch + new log/flag. Framework install: none — `sqlx` is already a dev-path dependency via `test_pool()`.
- [ ] `deny.toml` + `cargo-audit`/`cargo-deny` binary install — covers SEC-03

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V4 Access Control | Partial | CORS is explicitly documented in this codebase as NOT the auth boundary (every state-changing route requires a bearer token regardless of Origin — confirmed via the "no `allow_credentials(true)`" note in CODEBASE-GAPS.md and this session's read of `cors_layer()`); SEC-01/02 harden defense-in-depth, not the primary access-control gate |
| V5 Input Validation | Yes | `parse_extension_origins()` (`routes/mod.rs`) is the existing fail-loud validator for `PV_EXTENSION_ORIGINS` — SEC-02 removes the `moz-extension://*` special-case branch from it, simplifying rather than expanding its surface |
| V6 Cryptography | No | Explicitly out of scope per CONTEXT.md ("must not touch pv-core crypto paths beyond reading counter metadata") |
| V7 Error Handling and Logging | Yes | SEC-04's whole purpose — distinguishing a security-relevant error (`CredentialPossibleCompromise`) from generic ceremony failures in logs, per ASVS's ambition that security-relevant events be logged distinctly |
| V14 Configuration | Yes | SEC-03's toolchain/dependency pinning and supply-chain scanning is squarely a V14 (or ASVS 5.0's renumbered dependency-management) concern |

### Known Threat Patterns for pv-server / webauthn-rs

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Cloned/duplicated authenticator private key presenting a stale or non-incrementing counter | Repudiation / Spoofing | webauthn-rs's built-in `require_valid_counter_value` check (already active, unmodified this phase) — hard-fails the ceremony; SEC-04 adds a distinguishable log + persisted flag for operator visibility |
| Overly-broad CORS `Access-Control-Allow-Headers: *` masking which headers are actually trusted cross-origin | Information Disclosure (defense-in-depth, not primary boundary here) | Explicit header allowlist (SEC-01) |
| Scheme-wildcard CORS origin predicate (`moz-extension://*`) accepting ANY installed extension's origin, not just this project's own | Spoofing (a malicious extension could also match) | Concrete per-install origin allowlist (SEC-02) — closes the D-10 tech-debt window |
| Unpatched transitive native dependency (OpenSSL 0.10.81 via `webauthn-rs` → `webauthn-rs-core`) shipping a known CVE | Tampering / Information Disclosure | `cargo audit` against the RustSec advisory DB (SEC-03) |
| Single-maintainer crypto-signing crate (`passkey-rs`/`passkey-client` 0.5.0, used by `pv-provider` for the extension's provider ceremony) going stale or compromised upstream | Tampering | `cargo deny`'s advisory + source-trust checks (SEC-03); this session confirmed `passkey-*` is STILL at 0.5.0 (no newer release exists) — the "least-maintained crypto surface" flag from CODEBASE-GAPS.md remains accurate today, not stale |

## Sources

### Primary (HIGH confidence — direct code/registry verification this session)
- `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/webauthn-rs-0.5.5/src/interface.rs` — `Passkey::update_credential()` exact semantics (lines 61-111)
- `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/webauthn-rs-core-0.5.5/src/core.rs` — the internal counter-regression hard-fail logic (lines 1130-1186) and `require_valid_counter_value` default (line 215)
- `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/webauthn-rs-core-0.5.5/src/error.rs` — `WebauthnError::CredentialPossibleCompromise` (line 238), confirms it's a public, matchable variant
- `~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/webauthn-authenticator-rs-0.5.5/src/softpasskey.rs` — `SoftPasskey`'s private, non-`Clone` `counter: u32` field and increment-per-call behavior
- `crates/pv-server/src/routes/mod.rs` — full current CORS implementation, tests, and `parse_extension_origins()`
- `crates/pv-server/src/lib.rs` — `build_webauthn()`, confirms no `require_valid_counter_value` override
- `crates/pv-server/src/routes/passkeys.rs`, `auth.rs` — the 3 finish handlers and their identical discard-pattern
- `crates/pv-server/tests/common/mod.rs` — existing `test_server()` real-socket helper, directly reusable
- `crates/pv-server/tests/passkey_login.rs`, `tests/passkeys.rs` — existing `SoftPasskey`-driven real-ceremony integration test precedent
- `extension/entrypoints/background/auth-api.ts`, `web/src/lib/auth/api.ts` — the only two client-side `fetch()` header-setting call sites
- `extension/e2e-firefox/*.cjs`, `extension/e2e-firefox/README.md` — Firefox lane UUID inventory and operator-launch convention
- `cargo info webauthn-rs`, `cargo search cargo-audit`, `cargo search cargo-deny`, `cargo search {argon2,chacha20poly1305,hkdf,getrandom,openssl-sys,passkey-*}` — live crates.io registry queries this session
- `gsd-tools query package-legitimacy check --ecosystem crates` — automated legitimacy verdicts for `reqwest`, `cargo-audit`, `cargo-deny`

### Secondary (MEDIUM confidence)
- `.planning/research/v0.3/CODEBASE-GAPS.md` — the original sweep that spawned SEC-01..04; treated as authoritative for SCOPE/wording but its counter-signal framing was corrected against source in this session (see Open Question 1)

### Tertiary (LOW confidence)
- none — every load-bearing technical claim in this document was source- or registry-verified this session

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified live against crates.io this session
- Architecture: HIGH — CORS and counter-handling code read directly, not inferred
- Pitfalls: HIGH — the counter/hard-fail finding and the 4-distinct-UUID Firefox-lane finding were both discovered via direct source reads, not assumption
- Security domain: HIGH — grounded in the same direct verification, cross-checked against CODEBASE-GAPS.md's original framing

**Research date:** 2026-07-21
**Valid until:** 2026-08-20 (30 days — stable Rust ecosystem, but re-verify `webauthn-rs`/`passkey-*` versions and `cargo-audit`/`cargo-deny` versions if planning is delayed, since these are exactly the moving-target crates this phase is about)
