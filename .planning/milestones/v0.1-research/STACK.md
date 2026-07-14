# Stack Research

**Domain:** Self-hostable, zero-knowledge password manager with passkey provider + PRF vault unlock
**Researched:** 2026-07-12
**Confidence:** MEDIUM-HIGH (crate/package versions verified directly against crates.io and npm registry APIs; integration patterns cross-checked via web search, several with only single-source corroboration — flagged per item below)

This file validates the stack already locked in `docs/ARCHITECTURE.md` / `docs/RESEARCH.md` and prescribes the pieces those docs left open. Where a recommendation would contradict a locked decision, it is called out explicitly under **Concerns**, not silently substituted.

## Recommended Stack

### Core Technologies (already decided in docs/ — validated with current versions)

| Technology | Version (mid-2026) | Purpose | Why Recommended |
|------------|---------------------|---------|-----------------|
| axum | **0.8.9** (latest 0.8.x, released ~Apr 2026) | HTTP + WebSocket server framework | Matches `pv-server`'s pinned `"0.8"` range exactly. No 0.9 exists yet — 0.8 is current, not aging. Keep as-is. |
| SQLx | **0.8.6** (latest 0.8.x) — see Concerns re: 0.9.0 | Async SQL, compile-time checked queries, SQLite default / Postgres option | Matches pinned `"0.8"` range. `sqlx-cli` should track the same 0.8.x line for `sqlx migrate`. |
| webauthn-rs | **0.5.5** (latest stable; `0.6.1-dev` exists as a prerelease, not yet usable) | WebAuthn/FIDO2 relying party (server-side PRF + passkey login) | Matches pinned `"0.5"` range. SUSE-audited, powers Kanidm — the highest-confidence Rust WebAuthn RP implementation available. |
| passkey-rs (`passkey`, `passkey-client`, `passkey-authenticator`, `passkey-types`) | **0.5.0** across all sub-crates (1Password, published 2026-01-07) | Software authenticator with confirmed PRF/`hmac-secret` support, used for extension's soft authenticator in v0.2+ | Only actively maintained Rust CTAP2/passkey authenticator with PRF in source (`extensions/hmac_secret.rs`). ES256-only is a real but acceptable constraint (RPs overwhelmingly require ES256). Not needed for v0.1 (extension is v0.2), but pin now in workspace deps for continuity. |
| `credential-exchange-format` / `credential-exchange-protocol` | **0.4.0** / **0.4.0** (Bitwarden, published 2026-06-11) | FIDO CXF import/export (v0.4 milestone, not v0.1) | Confirmed current on crates.io; the two crates are split (types vs. protocol) — pull whichever the actual import/export flow needs, likely just `credential-exchange-format` for parsing files. |
| Next.js | See **Concerns** — docs specify 15, current npm stable is **16.2.10** | Web app framework | Validated version drift below; recommend re-evaluating 15 vs 16 before scaffolding. |
| React | **19.2.7** | UI library (via Next.js) | Matches Next 16's peer requirement; also compatible with Next 15.5.x if the team stays on 15. |
| Tailwind CSS | **v4, currently 4.3.2** | Styling engine | Confirmed current major and patch. No action needed. |
| DaisyUI | **v5, currently 5.6.18** | Component classes, datafa.st theme tokens | Confirmed current; v5 dropped all third-party deps (smaller `node_modules`, matches "lean container" positioning). |
| WXT | **0.20.27** | Browser extension framework (MV3, Chrome+Firefox dual-output) | Confirmed actively released (days-old versions at query time). Not needed until v0.2 but worth pinning the range now if scaffolding the extension package skeleton early. |

### Cryptographic primitives already in `pv-core` — version drift check

| Crate | Pinned (Cargo.toml) | Latest stable (crates.io) | Action |
|-------|---------------------|----------------------------|--------|
| argon2 | `"0.5"` | 0.5.3 stable (0.6.0-rc.8 exists as prerelease only) | No action — already on latest stable line. Do not jump to 0.6 while it's RC. |
| chacha20poly1305 | `"0.10"` | **0.11.0** (published 2026-06-28) | **Upgrade candidate.** `"0.10"` caret caps below 0.11 — you're one minor behind current. Check the RustCrypto AEADs changelog before bumping (MSRV moved to 1.85.0 in the 0.11 line); no confirmed breaking API changes found in this pass, but verify `XChaCha20Poly1305` construction API didn't shift before bumping in a security-sensitive crate. |
| hkdf | `"0.12"` | **0.13.0** | Minor bump available, low risk (HKDF API surface is tiny and stable across RustCrypto majors). Worth doing opportunistically. |
| zeroize | `"1"` | 1.9.0 | Already tracks latest via caret `"1"` — no action. |
| sha2 | `"0.10"` | 0.10.x current | No action. |

**Recommendation:** these are all low-risk, narrow-surface RustCrypto crates. Do the `chacha20poly1305` 0.10→0.11 and `hkdf` 0.12→0.13 bumps as a dedicated one-line PR early in v0.1 (before more code depends on their exact types), not mid-feature-work.

### Supporting Libraries (new, for the open pieces)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `wasm-bindgen` (CLI + Rust attr macro) | 0.2.126 | Rust↔JS glue for `pv-core` WASM builds | Core toolchain — see **WASM build tooling** section below for build-command prescription (not `wasm-pack`). |
| `wasm-bindgen-futures` | 0.4.76 | Bridge `Future`/Promise where WASM crypto calls need to be awaited from JS/TS | Only if any `pv-core` WASM export becomes async (e.g. wrapping a `credentials.get()` call from the extension's future MAIN-world shim); not needed for v0.1's synchronous KDF/AEAD calls. |
| `web-sys` / `js-sys` | 0.3.103 (both) | Typed bindings to browser APIs (`crypto.getRandomValues`, etc.) — pulled in transitively via `getrandom`'s `wasm_js` backend | Automatic once `getrandom`'s `wasm_js` feature is enabled; no direct dependency needed in `pv-core` unless you call browser APIs directly from Rust. |
| `getrandom` | 0.4.3 | RNG backend for `rand`/crypto crates when targeting `wasm32-unknown-unknown` | Enable the **`wasm_js`** Cargo feature (current flag name; renamed across 0.2→0.3→0.4 — see **WASM gotchas**) wherever `pv-core`'s WASM build needs OS-quality randomness (salt/nonce generation). |
| `totp-rs` | 5.7.2 | RFC 6238 TOTP code generation | **Put this in `pv-core`, compiled to WASM** — not a TS library. See **TOTP** section for rationale. |
| `tokio::sync::broadcast` | (part of `tokio`, already a dep) | Server-side WS fan-out for sync push | No new dependency — `pv-server` already depends on `tokio`; just add the `sync` feature if not already enabled by default features. |
| `tower-http` `ServeDir`/`ServeFile` | already `"0.6"` in `pv-server` | Serve the Next.js static export bundle directly from axum | See **Docker packaging** section — this replaces the need for nginx or a Node process in the container. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `wasm-bindgen-cli` (installed via `cargo install wasm-bindgen-cli` pinned to match the `wasm-bindgen` crate version) | Generates JS/TS glue + `.wasm` from `cargo build --target wasm32-unknown-unknown` output | Version **must** match the `wasm-bindgen` crate version in `Cargo.lock` exactly (schema-versioned protocol between the macro and CLI) — this is the single most common WASM build failure in this ecosystem. Pin both together in CI. |
| `cargo tree -i getrandom` / `-i rand` | Audit for duplicate major versions in the WASM dependency graph | Run this whenever a new dependency is added to `pv-core` (e.g. when `passkey-rs` or CXF crates are added in v0.2+) — see **WASM gotchas**. |
| `sqlx-cli` (0.8.x, matching `sqlx`) | Offline query verification, migrations | Run `cargo sqlx prepare` in CI so builds don't require a live DB connection to type-check queries. |

## Installation

```bash
# Rust workspace (crates/pv-core, crates/pv-server) — Cargo.toml bumps
cargo add chacha20poly1305@0.11 -p pv-core   # was 0.10 — verify AEAD construction API before merging
cargo add hkdf@0.13 -p pv-core                # was 0.12
cargo add totp-rs -p pv-core --no-default-features --features rfc6238   # verify exact feature name at implementation time

# WASM build tooling (pv-core → browser/extension)
cargo install wasm-bindgen-cli --version 0.2.126   # MUST match wasm-bindgen crate version
cargo build -p pv-core --target wasm32-unknown-unknown --release
wasm-bindgen --target web \
  target/wasm32-unknown-unknown/release/pv_core.wasm \
  --out-dir web/src/wasm

# Web app (Next.js)
npx create-next-app@latest --typescript --tailwind --app
npm install daisyui@latest
npm install papaparse@5.5.4        # CSV import parsing (client-side)

# Extension (WXT) — v0.2, not v0.1, listed here for continuity
npm install wxt@latest
npm install vite-plugin-wasm vite-plugin-top-level-await
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| `wasm-bindgen-cli` invoked directly | `wasm-pack` | If you later want to publish `pv-core`'s WASM build as a standalone npm package consumed outside this monorepo (e.g. a third-party wants to embed your crypto core). Not needed while `pv-core` is consumed in-repo by Next.js and WXT. |
| TOTP generation in `pv-core` (Rust→WASM), via `totp-rs` | `otpauth` (TS, 9.5.1 on npm) | If TOTP were ever needed in a context where WASM isn't loaded (unlikely here — the whole point of the architecture is that WASM crypto is always present client-side). Keep `otpauth` in your back pocket only for a throwaway QR-provisioning-URI parser if you don't want to write that parsing in Rust. |
| Static export (`output: "export"`) served by axum | `output: "standalone"` + Node process in container | If a genuine server-rendering or Next.js API-route need emerges later (none identified for this architecture — see rationale below). |
| axum `tower-http::ServeDir` for static assets, no reverse proxy | nginx sidecar/process-in-container | If you need TLS termination, HTTP/2, or complex routing rules the container itself won't handle — but for a single-binary self-hosted app behind the user's own reverse proxy (Caddy/Traefik/nginx on the host, à la Vaultwarden), this is unnecessary complexity inside the container. |
| SQLx 0.8.x (stay put for v0.1) | SQLx 0.9.0 | Once the `SqlSafeStr` migration cost is understood and the project is stable enough to absorb a query-string API change across every handler. Not a v0.1 concern. |
| Papa Parse (`papaparse`) for CSV import | `csv` Rust crate compiled to WASM | If you want CSV parsing to live in the same Rust core as everything else for consistency. Papa Parse is recommended instead because CSV import (unlike TOTP) has no secret-material sensitivity requiring it to be in the audited core, and Papa Parse's malformed-input handling (BOM, quoted fields, various bank/manager CSV quirks) is more battle-tested than rolling your own. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| Plasmo (extension framework) | Confirmed dead, no meaningful activity since 05.2025 | WXT (already the locked decision — just confirming it's still correct) |
| `wasm-pack` as the primary build command in CI | Its npm-publish-oriented pipeline (creates a `pkg/` dir + synthetic `package.json`) is overhead this project doesn't need since `pv-core`'s WASM output is consumed in-repo, and the tool has had recurring maintenance-lag issues since the rustwasm org sunset (07.2025) | `wasm-bindgen-cli` invoked directly against `cargo build` output (see Installation) |
| Next.js `output: "standalone"` + running Node in the container | Adds a second runtime (Node) alongside the Rust binary purely to serve pages that, in this architecture, never touch the server for vault data (zero-knowledge — decryption is 100% client-side via WASM) or auth logic (that's axum's job). Contradicts the "1 lightweight container" market position stated in PROJECT.md. | `output: "export"` static build served by axum's `ServeDir` |
| SQLx 0.9.0 for v0.1 | New, breaking `SqlSafeStr` requirement on every query string touches every handler in `pv-server`; no compelling v0.1 feature need justifies absorbing that churn now | Stay on SQLx 0.8.6 for the MVP; revisit 0.9 as a dedicated hardening-phase task once 0.9.x has more field mileage (it's ~2 months old as of this research) |
| A second TOTP library in TypeScript for code *generation* | Splits the "server never sees secrets" guarantee across two crypto implementations (Rust core + JS lib) instead of one audited core — same reasoning that put Argon2id/XChaCha20/HKDF/PRF all in `pv-core` | `totp-rs` inside `pv-core`, WASM-exported like every other crypto primitive |
| Argon2 `0.6.0-rc.*` | Prerelease — do not pin an RC version of a KDF that guards the entire key hierarchy | `argon2 = "0.5"` (already correct in Cargo.toml) |

## Stack Patterns by Variant

**If the team decides to follow docs/ARCHITECTURE.md's "Next.js 15" literally despite the version drift below:**
- Pin `next@15.5.20` (the current backport-line patch), not an older 15.0/15.1/15.2/15.3 tag.
- Everything else in this file (static export, WASM tooling, Docker packaging) applies unchanged — the 15-vs-16 decision only affects which Next major you scaffold with, not the export/serving architecture.

**If the team scaffolds fresh on Next.js 16 (recommended — see Concerns):**
- Turbopack is default; no webpack `asyncWebAssembly` experiments flag juggling needed for importing the `pv-core` WASM module — confirm Turbopack's WASM import story before locking (it should Just Work via a dynamic `import()`, but wasn't independently re-verified for Turbopack specifically in this pass — flag as LOW-confidence gap for phase-specific research when the web app phase starts).
- The breaking changes in 16 (sync request API removal, middleware→proxy.ts, Cache Components) are irrelevant under `output: "export"` since none of those server features are used.

**If v0.1 ships without WebSocket sync (pure poll-based `GET /sync`) to reduce v0.1 surface area:**
- Skip the `tokio::sync::broadcast` work entirely for the first milestone; the revision-based `GET/PUT /sync` endpoint already gives correctness, WS is purely a push-latency optimization. This is a legitimate scope-cut if v0.1 timeline is tight — flag to roadmap as a possible phase split (sync-CRUD phase vs. sync-push phase).

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `wasm-bindgen` 0.2.126 (crate) | `wasm-bindgen-cli` 0.2.126 (exact match required) | The crate/CLI schema-version check will hard-fail the build on any mismatch — pin both in one place (e.g. a `rust-toolchain`-adjacent version file or CI env var) so they can't drift independently. |
| `getrandom` 0.4.x `wasm_js` feature | `wasm-bindgen` 0.2.x, browser `Crypto.getRandomValues` | Any transitive dependency (future `passkey-rs`/CXF additions) that still resolves to `getrandom` 0.2.x via an old `rand` pin will silently build but panic at runtime in the browser with "unsupported target" — not a compile-time failure. Always `cargo tree -i getrandom` after adding a dependency to a WASM-targeted crate. |
| SQLx 0.8.x | `sqlx-cli` 0.8.x | Must match major.minor; the CLI's `cargo sqlx prepare` offline cache format is versioned to the driver. |
| Tailwind v4 | daisyUI v5 | Confirmed compatible pairing (daisyUI 5 was built specifically for the Tailwind v4 engine change, e.g. CSS-first config via `@plugin`) — this is exactly what `docs/RESEARCH.md` already specified; just confirming current patch versions (4.3.2 / 5.6.18) are still the right pairing, no v4/v5 mismatch risk. |
| Next.js `output: "export"` | Next.js Image Optimization API, Server Actions, Route Handlers, Middleware | All unavailable under static export — confirm no phase plan assumes any of these before locking this decision (e.g. if the roadmap later wants server-side HIBP breach-check proxying through a Next.js route handler instead of axum, that would force standalone mode — keep breach-check and all data-touching endpoints in axum, not Next.js, to preserve the static-export option). |
| `chacha20poly1305` 0.11 | `pv-core`'s existing `XChaCha20Poly1305` usage in `keys.rs`/`items.rs` | Not independently confirmed breaking-change-free in this pass (search did not surface a full changelog) — treat the 0.10→0.11 bump as a reviewed PR with existing crypto tests re-run, not a drive-by version bump. |

## Concerns (explicit flags against docs/ARCHITECTURE.md)

1. **Next.js 15 vs 16.** `docs/ARCHITECTURE.md` and `.planning/PROJECT.md` both specify "Next.js 15." As of this research (2026-07-12), Next.js 16 is the current stable major (`16.2.10` on the `latest` npm dist-tag) and **Next.js 15 receives patches only via a `backport` dist-tag** (`15.5.20`) — i.e., 15 is in legacy maintenance, not active development. This is a real drift from what docs/ locked in. **Recommendation:** re-evaluate 15 vs 16 before scaffolding the web app phase. Given this project's static-export architecture (see below), the 16 breaking changes (Turbopack default, sync-API removal, middleware→proxy.ts, Cache Components) mostly don't apply — so the migration cost of going straight to 16 is low, and starting a greenfield project on a maintenance-only major has no upside. This does not block v0.1 planning, but the roadmap should not hard-code "Next 15" into a phase spec without this context.

2. **Static export vs. SSR is not actually an open question once zero-knowledge is taken seriously.** `docs/ARCHITECTURE.md`'s component diagram says "Web app (Next.js static/SSR)" — leaving it open. Given (a) all vault decryption must happen client-side in WASM (zero-knowledge is a hard constraint, not a preference), and (b) the actual API surface is 100% axum, there is no remaining use case for Next.js server-side rendering or Route Handlers in this architecture. Recommend **static export exclusively**, which also directly serves the "1 lightweight container" market position (no Node runtime needed at all in production — axum alone serves both the API and the static bundle). This isn't a contradiction of a locked decision (the doc left it open) but is a strong, opinionated closure of that open question, flagged here because it also resolves the Docker packaging question below in one stroke.

## WASM Build Tooling — decision detail

**Recommendation: `wasm-bindgen` + `wasm-bindgen-cli`, invoked directly (not `wasm-pack`).**

Rationale:
- `wasm-pack`'s value proposition is packaging + publishing a WASM build as a standalone npm-installable package. This project consumes `pv-core`'s WASM output **in-repo**, from two first-party consumers (Next.js web app, WXT extension) — there's no npm-publish step to automate.
- The `rustwasm` GitHub org was sunset in July 2025; `wasm-bindgen` and `wasm-pack` moved to independent maintenance homes. Both remain usable, but `wasm-pack` in particular has a history of maintenance-lag relative to `wasm-bindgen` releases — adding an indirection layer with its own update cadence is unwanted risk for a security-sensitive crypto core.
- Direct `wasm-bindgen-cli` invocation is a 3-line build script (`cargo build --target wasm32-unknown-unknown --release` → `wasm-bindgen --target web ... --out-dir ...`) that both the Next.js build pipeline and the WXT/Vite build pipeline can shell out to identically, keeping the WASM build step framework-agnostic and easy to wire into a monorepo task runner (Turborepo/Nx/plain npm scripts — not yet decided, out of scope here).
- **Critical version-pinning gotcha:** the `wasm-bindgen` crate (in `Cargo.toml`) and the `wasm-bindgen-cli` binary must be the *exact same version* — they share a schema-versioned wire protocol and a mismatch is a hard build failure with a clear (if easy to miss in CI logs) error message. Pin both together.
- `uniffi` (mentioned as a later option in PROJECT.md/ARCHITECTURE.md for mobile) is correctly deferred — it targets Kotlin/Swift FFI, not browser WASM, and has no role in the v0.1/v0.2 web+extension scope.

**WASM gotcha to flag for the implementation phase:** `getrandom`'s browser backend requires the **`wasm_js`** Cargo feature (current name as of `getrandom` 0.4.x; this flag has been renamed across major versions — 0.2 used `js`). Because `pv-core` will accumulate more dependencies over time (CXF crates in v0.4, potentially `passkey-rs` if any core logic is shared), run `cargo tree -i getrandom` and `cargo tree -i rand` whenever adding a dependency to `pv-core` — a transitive dependency silently resolving to an older `getrandom`/`rand` major will build successfully but panic at runtime in the browser ("unsupported target"), not fail at compile time. This is the single highest-leverage WASM pitfall for this specific project shape (many small crypto/protocol crates converging on one WASM-targeted core).

## Next.js Static Export vs SSR — decision detail

**Recommendation: `output: "export"`, no server runtime in the container.**

- The web app's job is: fetch encrypted blobs from the axum API, decrypt them client-side via the `pv-core` WASM module, render the vault UI. None of that requires or benefits from server-side rendering — in fact, SSR-ing decrypted vault contents would be a zero-knowledge violation by construction (the Node server would need the plaintext to render it).
- Auth flows (password login, PRF/WebAuthn ceremonies) are also entirely client-driven against axum endpoints (`navigator.credentials.get/create`, KDF derivation in WASM) — no Next.js Route Handler or Server Action has a role to play.
- This means the "SSR" half of docs/ARCHITECTURE.md's "static/SSR" open question has no actual use case in this specific architecture, and closing it to static-export-only **also answers the Docker packaging question**: a single Rust binary (axum) can serve the static Next.js export via `tower_http::services::ServeDir` alongside its own API/WebSocket routes on the same port, with zero additional runtime (no Node, no nginx) in the container.
- Trade-off being accepted: no Image Optimization API, no ISR, no Server Actions, no Middleware. None of these are needed for this app's UI (dashboard-style SPA behind auth); flag to the roadmap only if a later phase (e.g. a public marketing/landing page bundled in the same app) wants server-rendered SEO content — that would be the one legitimate reason to reconsider and would likely be handled as a *separate* small static/SSG page, not by abandoning static export for the authenticated app shell.

## Docker Packaging — decision detail

**Recommendation: multi-stage build, single final image, no nginx, no Node runtime.**

Stage outline:
1. **Rust builder stage** — compile `pv-server` (native binary) and `pv-core` (wasm32-unknown-unknown via `wasm-bindgen-cli`, per above).
2. **Node builder stage** — `next build` with `output: "export"`, consuming the WASM artifacts produced in stage 1 (copy them into the Next.js source tree or serve as a public static asset before build, depending on how the WASM module is imported).
3. **Final runtime stage** — minimal base image (e.g. `debian:bookworm-slim` or `gcr.io/distroless/cc` if the Rust binary is statically-linkable enough) containing only: the `pv-server` binary, the Next.js static export output directory, and an empty `/data` volume mount point for the SQLite file. `pv-server` is configured (via a small addition to its router) to serve the static export directory at `/` and its API/WS routes under `/api` and `/sync` (or similar), so one process, one port, one container — matching the Vaultwarden-style "one lightweight container" positioning exactly.

This directly resolves the earlier web search finding that most Docker/Next.js guides assume a *multi-container* setup (nginx + Node + backend) — that pattern exists because most stacks don't have a capable HTTP server already in the loop. This project does (axum), so the reverse-proxy/static-file-serving role nginx would normally play is redundant.

## WebSocket Sync Approach — decision detail

**Recommendation: `tokio::sync::broadcast` channel per connected client set, keyed by user, layered on top of (not replacing) the revision-based `GET/PUT /sync` REST flow already specified in `docs/ARCHITECTURE.md` §6.**

- Standard axum pattern (confirmed via the framework's own example set): a `broadcast::Sender<SyncEvent>` lives in shared `AppState` (or a per-user map of senders if you want to avoid fanning out irrelevant events to unrelated users — likely the right call here since this isn't a shared-workspace app, just multi-device sync for one account plus optional family sharing later).
- On any mutating REST call (`PUT /items/*`, etc.), the handler both persists the change and publishes a `SyncEvent { revision, item_id }` (no plaintext, no keys — just enough for clients to know "pull `/sync` again") to the broadcast channel.
- Each WebSocket connection (`GET /sync/stream` per docs/ARCHITECTURE.md's API sketch) subscribes to that user's channel and forwards events as they arrive; the client then does a normal authenticated `GET /sync` pull to fetch the actual (still-encrypted) delta. This keeps the WS channel itself free of any sensitive payload — it's a "something changed, go pull" signal, not a data channel — which is the simplest correct design and avoids having to reason about WS-level encryption separately from the REST layer's.
- `broadcast` (fan-out, lossy-if-slow-consumer) is the right primitive here, not `mpsc` (point-to-point) — multiple tabs/devices for the same user all need the same event.

## TOTP Generation — decision detail

**Recommendation: `totp-rs` inside `pv-core`, WASM-exported, not a TypeScript library.**

- The TOTP secret is vault data like any other field (login password, card number) — it must never exist in plaintext outside the client's decrypted memory space. Putting TOTP code generation in a *second*, separately-audited crypto surface (a JS library) fragments the "one audited core" property that already governs every other primitive in `pv-core` (Argon2id, XChaCha20-Poly1305, HKDF, PRF handling).
- `totp-rs` 5.7.2's required dependency set (`base32`, `constant_time_eq`, `hmac`, `sha1`, `sha2`) is lean and has no forced network or OS-RNG dependency for the *generation* path (RNG is only needed for *secret creation*, which is gated behind an optional `rand` feature you can leave off if `pv-core` already has its own vetted RNG sourcing via `getrandom`/`wasm_js`) — so it should compile cleanly to `wasm32-unknown-unknown` with `default-features = false` and the specific TOTP-algorithm feature(s) enabled (exact feature flag naming to confirm against the crate's current `Cargo.toml` at implementation time — not independently re-verified beyond the dependency list in this pass).
- SHA-1 is required (Google Authenticator/most authenticator apps default to it despite being deprecated elsewhere) — `totp-rs` supports SHA1/SHA256/SHA512 per-account, matching real-world provisioning URIs.
- `otpauth` (TS, 9.5.1) remains a reasonable fallback only if the team decides mid-implementation that keeping TOTP in Rust/WASM is more friction than value — but the recommendation is to keep it in `pv-core` for architectural consistency, and this is a low-risk, low-effort addition (TOTP is a small, well-specified algorithm; no meaningful "vendor lock-in" risk either way).

## Bitwarden JSON + CSV Import — decision detail

**Recommendation: parse both client-side, in TypeScript (not Rust/WASM), immediately after fetch/file-read, converting to the app's own internal item model before anything touches the encryption layer.**

- Bitwarden's **unencrypted** JSON export (the format any Vaultwarden/Bitwarden user would produce for a one-time migration) is plain JSON — `folders[]`, `items[]` with typed fields (`login`, `card`, `identity`, `secureNote`) — trivially parseable with `JSON.parse` + a hand-written TS interface; no library needed beyond your own mapping code.
- Bitwarden's **encrypted** JSON export (password-protected or account-restricted) requires re-implementing Bitwarden's own KDF+AES-CBC-HMAC decryption client-side to even read it — this is meaningfully more work and a different trust/complexity trade-off. **Recommendation for v0.1 scope: support only the unencrypted JSON export path**, and treat encrypted-export import as an explicit backlog item (flag to roadmap) rather than silently under-scoping it — most self-hosters exporting for a one-time migration will use the plain JSON export.
- CSV import: use **Papa Parse** (`papaparse` 5.5.4) for the actual parsing (RFC 4180 compliance, handles the malformed/quirky CSVs real password managers export). This is intentionally *not* a Rust/WASM crate — unlike TOTP, CSV parsing touches no secret material before the app's own mapping layer decides which columns are which and encrypts the result; using a battle-tested JS parser here is lower-risk than hand-rolling CSV handling in Rust for marginal "one core" purity benefit.
- Both import paths should feed into a single internal "staged import" TS module that normalizes Bitwarden-JSON-shape and various CSV column layouts (Bitwarden CSV, Chrome/Firefox password export CSV, 1Password CSV, generic) into one `VaultItemDraft[]` shape, which is then the *only* thing that touches the WASM encryption calls — keeping the format-specific parsing logic fully separate from the crypto boundary.

## Sources

- crates.io API (`https://crates.io/api/v1/crates/<name>`) — direct registry queries for exact version numbers and publish dates: `axum` (0.8.9), `sqlx` (0.9.0 / 0.8.6), `webauthn-rs` (0.5.5 stable / 0.6.1-dev), `passkey`/`passkey-client`/`passkey-authenticator`/`passkey-types` (0.5.0), `totp-rs` (5.7.2 + its dependency graph), `credential-exchange-format`/`credential-exchange-protocol` (0.4.0), `zeroize` (1.9.0), `argon2` (0.5.3 stable / 0.6.0-rc.8), `chacha20poly1305` (0.11.0), `hkdf` (0.13.0), `wasm-bindgen`/`web-sys`/`js-sys`/`wasm-bindgen-futures`, `rand`/`rand_core`/`getrandom` (0.4.3) — HIGH confidence (primary registry source).
- npm registry API (`https://registry.npmjs.org/<pkg>`) — `tailwindcss` (4.3.2), `daisyui` (5.6.18), `next` (dist-tags: `latest`=16.2.10, `backport`=15.5.20), `react` (19.2.7), `wxt` (0.20.27), `otpauth` (9.5.1), `papaparse` (5.5.4) — HIGH confidence (primary registry source).
- WebSearch (multiple queries, see tool trace) — wasm-bindgen/wasm-pack ecosystem status and rustwasm org sunset, Next.js `standalone` vs `export` semantics, axum WebSocket broadcast pattern, Bitwarden JSON export schema, Docker/Next.js containerization patterns, `getrandom` `wasm_js` feature behavior, SQLx 0.9 `SqlSafeStr` breaking change, Next.js 16 breaking-change surface — MEDIUM confidence (cross-checked against official docs/GitHub sources cited within each search's results, but not independently re-fetched from primary source in every case — see per-item confidence notes above and in `research-store`).
- `docs/RESEARCH.md`, `docs/ARCHITECTURE.md`, `.planning/PROJECT.md`, `.planning/codebase/STACK.md` — locked decisions and existing pinned versions this file validates against.

---
*Stack research for: self-hostable zero-knowledge password manager (passkey provider + PRF vault unlock), v0.1 milestone*
*Researched: 2026-07-12*
