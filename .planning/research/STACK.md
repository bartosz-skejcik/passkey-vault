# Stack Research

**Domain:** Browser extension (MV3, Chrome + Firefox dual-output) that is a WebAuthn passkey provider + zero-knowledge password-manager autofill client
**Researched:** 2026-07-14
**Confidence:** HIGH (framework/library versions verified via npm registry + crates.io API; MV3 platform behavior verified via Chrome for Developers / MDN / Bugzilla / GitHub issues)

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **WXT** | 0.20.27 (npm, verified via registry) | Extension framework — dev server, HMR, file-based entrypoints, manifest generation, dual Chrome+Firefox build (`wxt build -b firefox`) | Already the stated decision in PROJECT.md/ARCHITECTURE.md ("Plasmo martwy od 05.2025"); only maintained MV3-first framework with true dual-output. Actively released (0.20.x, commits within last 24h at time of research). |
| **@wxt-dev/module-react** | 1.2.2 (npm) | React support inside WXT entrypoints (popup, options, and — critically — content-script UI) | Needed only if popup/UI is React; DaisyUI/Tailwind v4 already used on the Next.js web app (v0.1), so reusing React keeps one component mental model across web + extension. If the team prefers no framework for the popup, skip this — WXT is framework-agnostic. |
| **@wxt-dev/browser** | 0.2.2 (npm) | Cross-browser `browser.*` typed API (webextension-polyfill successor, TS-typed) | WXT's own polyfill layer; avoids hand-rolling `chrome.*` vs `browser.*` branching. |
| **wasm-bindgen** | =0.2.126 (already pinned in `crates/pv-wasm/Cargo.toml`) | Rust↔JS bridge for `pv-core`/`pv-wasm` inside the extension | Existing v0.1 choke-point — reuse unchanged. Do not bump independently of the web app; version is pinned exact (`=0.2.126`) for reproducibility. |
| **passkey-authenticator** (part of passkey-rs workspace) | 0.5.0 (crates.io, published 2026-01-07) | Soft WebAuthn authenticator (CTAP2-shaped, ES256, PRF/hmac-secret emulation) run in-extension to answer `credentials.create`/`credentials.get` | 1Password's own open-sourced crate — same one powering their extension's WASM authenticator. Confirms ES256-only + PRF support already noted in ARCHITECTURE.md §8. Pull in `passkey-client` (WebAuthn L3 client logic) + `passkey-types` alongside `passkey-authenticator`; all three are pure-Rust and WASM-clean (the `psl` public-suffix dependency, currently 2.1.218, is pure Rust and compiles to WASM with no shims needed). |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `credential-exchange-format` | 0.4.0 (crates.io, published 2026-06-11) | FIDO CXF type definitions for import/export | This is a v0.2.5-ish backlog item ("Import/eksport FIDO CXF" in Active requirements), NOT needed for the MAIN-world provider or autofill itself — pull in only when that specific requirement is planned. Spec is still Review Draft (contributors: Apple/Google/Microsoft/1Password/Bitwarden/Dashlane) — expect breaking changes; the crate explicitly warns it does not zeroize sensitive values, so wrap any decoded secrets immediately in `pv-core` types before they leave the CXF layer. |
| `getrandom` (`js` feature) | 0.2.x (already pinned per v0.1 decision) | CSPRNG inside WASM | Reuse existing decision (`getrandom 0.2 js`, not `0.4 wasm_js`) — same dependency graph constraint (`chacha20poly1305 0.10 → rand_core 0.6 → getrandom 0.2.17`) applies unchanged inside the extension bundle. |
| `zeroize` (+ `derive`) | 1.x (already a dependency) | Memory hygiene for any key material touched in extension-side Rust/WASM | Already project convention; extend to any new PRF/authenticator state structs. |
| Vite (via WXT) | bundled with WXT 0.20.x | Bundler for content scripts / background / popup | Not a separate install — WXT wraps Vite; relevant because MAIN-world injected script and the WASM loader both need to survive Vite's content-script bundling (see Version Compatibility below). |
| `webextension-polyfill` types | superseded by `@wxt-dev/browser` | — | Do not add on top of `@wxt-dev/browser`; redundant. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `wxt build -b chrome` / `wxt build -b firefox` | Dual-output production builds | Produces two separate `.output/` dirs with browser-specific manifests; CI should build both on every push. |
| `web-ext` (Mozilla) | Firefox packaging/lint/sign | WXT can invoke it internally for Firefox zip/signing; needed for AMO submission later. |
| `wasm-pack` or existing `scripts/build-wasm.sh` | Compile `pv-core`/`pv-wasm` to `wasm32-unknown-unknown` | Reuse the v0.1 script; extension build must run this as a pre-step (or `postinstall`) so both web app and extension consume the same `.wasm` artifact — do not fork the build. |

## Installation

```bash
# Extension scaffold (in a new package, e.g. extension/)
npx wxt@latest init extension
cd extension
npm i @wxt-dev/browser
npm i -D @wxt-dev/module-react   # only if popup uses React

# Rust side — add to crates/pv-server or a new crates/pv-authenticator crate
cargo add passkey-authenticator@0.5.0
cargo add passkey-client@0.5.0
cargo add passkey-types@0.5.0
# CXF only when that backlog item is actually planned:
# cargo add credential-exchange-format@0.4.0
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|--------------------------|
| WXT | Plasmo | Never for this project — Plasmo has been unmaintained since 05.2025 (already the documented decision); do not reconsider. |
| WXT | Hand-rolled Vite + manual manifest.json per browser | Only if WXT's MAIN-world/runtime-registration abstractions become a blocker; adds significant maintenance burden for dual-manifest management — avoid unless WXT proves broken for a specific requirement. |
| passkey-rs (`passkey-authenticator`/`passkey-client`) | Hand-rolled CTAP2/WebAuthn client logic | Never — this is exactly the "klocek" already decided in ARCHITECTURE.md; reimplementing CTAP2 is out of scope for a solo indie project. |
| `credential-exchange-format` crate | Hand-rolled CXF JSON parsing | If the crate's Review-Draft churn causes breakage close to a release deadline, a minimal hand-rolled parser for the subset of CXF fields actually needed (login/TOTP/card/identity) is an acceptable fallback — but prefer the crate first since Bitwarden/1Password co-maintain it. |
| React (`@wxt-dev/module-react`) for popup | Vanilla/vue/svelte via other WXT modules | If the web app's DaisyUI/Tailwind React components need to be shared 1:1 with the popup, React is the pragmatic choice (matches Next.js web app). If the popup UI diverges significantly and is small, a framework-free popup is also fine — WXT doesn't force a choice. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|--------------|
| MAIN-world content scripts registered via WXT's declarative `world: 'MAIN'` option, relying on it working identically in both browsers | **Firefox does not support MV3 main-world content scripts** the way Chrome does — confirmed via WXT's own GitHub discussion (#523/#1158): Firefox needs a manually injected `<script>` element instead of the declarative main-world registration. Treating this as "the same on both browsers" will silently break the passkey-provider patch on Firefox only. | Define the MAIN-world patch as an **unlisted script asset**, inject it via `document.createElement('script')` from an ISOLATED-world content script on **both** browsers (skip WXT's `world: 'MAIN'` declarative option entirely for cross-browser parity), and communicate isolated↔main via `window.postMessage` (same pattern Bitwarden/1Password use, per w3c/webextensions#361 discussion). |
| `chrome.webAuthenticationProxy` as the primary provider mechanism | It's single-occupant (built for remote-desktop/enterprise use cases) and Chrome-only — cannot be the cross-browser passkey-provider mechanism. Already flagged in RESEARCH.md. | The MAIN-world `navigator.credentials.create`/`.get` monkey-patch + `postMessage` bridge to background (documented pattern, same as Bitwarden/Dashlane; official API tracked but stalled at w3c/webextensions#361). |
| Storing the unwrapped User Key / unlock state in a plain module-level JS variable in the MV3 background (service worker in Chrome / event page in Firefox) | Chrome terminates the service worker after ~30s idle with no pending events; **any in-memory global is lost on termination**, silently "re-locking" the vault or worse, causing races where a stale key reference is used. Confirmed via Chrome for Developers service-worker lifecycle docs. | Persist unlock **session state** (not the raw key) via `chrome.storage.session` (in-memory, cleared on browser close, not idle-timeout-safe by default either — verify TTL behavior) or re-derive/re-fetch the wrapped key material on each service-worker wake and re-unwrap in WASM per-use; treat the service worker as stateless between wake events, matching the "resilient against unexpected termination" guidance from Chrome docs. This is a phase-planning-level risk already flagged in PROJECT.md §Known risks ("cykl życia MV3 service-workera vs. odblokowany klucz") — this research confirms the mechanism, planning should design the actual state machine. |
| Bumping `wasm-bindgen` or `getrandom` versions independently for the extension build | `wasm-bindgen` is pinned exact (`=0.2.126`) in `pv-wasm/Cargo.toml`; `getrandom 0.2 js` was a measured v0.1 decision tied to the `chacha20poly1305 0.10 → rand_core 0.6` graph. A different pin in the extension build would produce two divergent WASM artifacts from the same source, defeating the whole point of a shared `pv-core`/`pv-wasm` choke-point. | Extension build consumes the exact same `pv-wasm` build output as the web app (same `Cargo.lock`, same build script) — one WASM binary, two JS consumers (Next.js web app + extension). |
| CSP `unsafe-eval` or any non-`'self'`/`'wasm-unsafe-eval'` script-src for the extension pages/service worker | MV3 CSP forbids remote/external code and generic `unsafe-eval`; only `'self'`, `'none'`, and `'wasm-unsafe-eval'` are legal values for `script-src`/`object-src`/`worker-src`. | Explicitly declare `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"}` — WXT should be configured to emit this; verify it does not fall back to a stricter default that silently disables WASM. |

## Stack Patterns by Variant

**If the popup/options UI reuses DaisyUI/Tailwind v4 components from the Next.js web app:**
- Use `@wxt-dev/module-react` + share a `ui/` component package (or copy-paste the small subset actually needed) between `web/` and `extension/`.
- Because the datafa.st design tokens (OKLCH, DM Sans + Fuzzy Bubbles) are already built for React/Tailwind in `web/` — rebuilding them framework-free would duplicate design-system work with no benefit.

**If injecting the WebAuthn provider patch:**
- Use an unlisted unlisted-script asset injected via `<script>` tag from an ISOLATED-world content script (not WXT's declarative `world: 'MAIN'`), with `postMessage` bridging to the background/service-worker for the actual authenticator (`passkey-rs`) calls.
- Because this is the only pattern that works identically on Chrome and Firefox MV3 today (see "What NOT to Use").

**If holding vault-unlock state across MV3 service-worker restarts:**
- Use `chrome.storage.session` (Chrome) / equivalent event-page-safe pattern (Firefox, which uses non-persistent event pages rather than true service workers — Firefox's model tolerates longer-lived state more gracefully, but should not be relied upon for parity).
- Because Firefox and Chrome have genuinely different MV3 background execution models (`service_worker` vs `scripts` event page) — this is a real behavioral fork, not just a manifest syntax difference, and needs its own design pass in phase planning, not just a library choice.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|------------------|-------|
| `wxt@0.20.27` | `wasm-bindgen=0.2.126` WASM output | WXT's Vite pipeline needs the `.wasm` asset treated as a static/binary import (`?url` or `vite-plugin-wasm`-style handling) inside a content script bundle — content scripts have a **separate**, more restrictive bundling context than the extension pages (popup/options/background); verify WASM loads correctly from a content-script-adjacent context specifically, not just from the background/popup, since the autofill/detection logic likely needs `pv-core` decrypt calls close to the DOM. |
| `passkey-authenticator@0.5.0` / `passkey-client@0.5.0` / `passkey-types@0.5.0` | Same workspace release — pin all three to `0.5.0` together | These are published from the same `passkey-rs` monorepo/release; do not mix minor versions across the three crates. |
| `credential-exchange-format@0.4.0` | FIDO Alliance CXF spec, Review Draft (as of the crate's stated target) | Spec is pre-1.0 and actively changing (contributors include Apple/Google/Microsoft/1Password/Bitwarden/Dashlane) — expect a version bump requirement whenever the spec advances; do not treat 0.4.0's on-wire format as stable long-term. |
| Chrome MV3 CSP (`wasm-unsafe-eval`) | Firefox MV3 CSP | Firefox has historically been more permissive here but the project should target the strictest common denominator (`'self' 'wasm-unsafe-eval'`) so one manifest CSP policy works for both, rather than branching CSP per browser. |

## Sources

- npm registry (`registry.npmjs.org/wxt`, `/@wxt-dev/browser`, `/@wxt-dev/module-react`) — verified exact current versions directly via API, HIGH confidence
- crates.io API (`crates.io/api/v1/crates/passkey-authenticator`, `/credential-exchange-format`, `/psl`) — verified exact current versions + publish dates directly via API, HIGH confidence
- [WXT GitHub — MainWorldContentScriptEntrypointOptions](https://wxt.dev/api/reference/wxt/interfaces/mainworldcontentscriptentrypointoptions) and [Discussion #523](https://github.com/wxt-dev/wxt/discussions/523) / [Issue #1158](https://github.com/wxt-dev/wxt/issues/1158) — Firefox MAIN-world limitation, HIGH confidence (primary source, corroborated across issue + discussion)
- [1Password/passkey-rs GitHub](https://github.com/1Password/passkey-rs) + [blog.1password.com/passkey-crates](https://blog.1password.com/passkey-crates/) — architecture, ES256/PRF/hmac-secret support, WASM compilation of `psl`, HIGH confidence (primary vendor source, already project's stated decision)
- [w3c/webextensions#361](https://github.com/w3c/webextensions/issues/361) — official confirmation the Credential Management API integration gap is real and unresolved; Dashlane cited as an extension already forced into the monkey-patch pattern, HIGH confidence
- [Chrome for Developers — extension service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — 30s idle termination, event-driven reset behavior, HIGH confidence (primary vendor doc)
- [Chrome for Developers — Manifest CSP reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) — `wasm-unsafe-eval` requirement, HIGH confidence (primary vendor doc)
- [Firefox Extension Workshop — MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/) + [MDN `background`](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background) — Firefox event-page vs Chrome service_worker distinction, HIGH confidence
- [crates.io — credential-exchange-format](https://crates.io/crates/credential-exchange-format) — Review Draft status, zeroize caveat, contributor list, HIGH confidence
- Existing project files: `crates/pv-wasm/Cargo.toml`, `.planning/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/RESEARCH.md` — v0.1 pinned versions and prior decisions reused as-is, HIGH confidence (project ground truth)

---
*Stack research for: Browser extension (WXT MV3, Chrome + Firefox) — Passkey Vault v0.2*
*Researched: 2026-07-14*
