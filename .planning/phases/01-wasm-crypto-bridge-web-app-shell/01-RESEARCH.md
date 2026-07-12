# Phase 1: WASM Crypto Bridge & Web App Shell - Research

**Researched:** 2026-07-12
**Domain:** Rust→WASM crypto bridge (wasm-bindgen) + Next.js 16/Turbopack static-export app shell (Tailwind v4 + DaisyUI 5)
**Confidence:** MEDIUM-HIGH (package versions and legitimacy verified directly against crates.io/npm registries; the single highest-risk integration question — Turbopack + wasm-bindgen `--target web` — is cross-checked across three independent sources and has a documented, working pattern, but was not executed end-to-end in this research pass)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**WASM Boundary & Crypto API**
- Bindings live in a new thin `crates/pv-wasm` crate wrapping pv-core — pv-core stays pure (no wasm-bindgen, no I/O) and auditable.
- Keys cross the boundary as opaque exported structs (e.g. `WasmUserKey`) — JS holds handles; raw key bytes stay in WASM linear memory, zeroized via explicit `free()`. Satisfies the "no raw key bytes returned across the boundary more than once per operation" success criterion by construction.
- RNG: `getrandom` with the `wasm_js` feature; salts/nonces generated inside WASM. Build script includes a `cargo tree -i getrandom` duplicate-major audit (research flags this as the top runtime-panic pitfall).
- TS facade: singleton `lib/crypto/` module with explicit `initCrypto()` (dynamic WASM import) + typed async wrappers. Only this module imports the wasm package — grep-auditable.

**Build Pipeline & Layout**
- Next.js 16 (current stable; 15 is maintenance-only backport line). Static export (`output: "export"`) per UI-01 — 16's breaking changes don't apply under static export.
- Web app lives in `web/` at repo root (sibling of `crates/`).
- WASM build: `scripts/build-wasm.sh` — `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` → `wasm-bindgen --target web` → output into `web/src/lib/crypto/wasm/` (gitignored). Invoked from npm `prebuild`/`predev`. `wasm-bindgen` crate and `wasm-bindgen-cli` pinned to the identical version in one place (exact-match requirement).
- Package manager: npm.

**Shell UI & Self-Test**
- Full dashboard skeleton per docs/UI-DESIGN.md §3: left sidebar (placeholder nav: vault/folders/tags + account block), top bar (search stub "⌘K", "+ Nowy item" stub), main column. Non-functional placeholders only.
- Theming: DaisyUI 5 custom themes `vault-dark` (default) + `vault-light` using the exact OKLCH tokens from docs/UI-DESIGN.md §5; manual toggle persisted in localStorage, initial value from system preference.
- Crypto self-test lives in the main column of the home route: a card running the full round-trip with per-step ✓/✗ status. This is the phase's demo.
- Fonts via `next/font`: DM Sans (`--font-sans`), Fuzzy Bubbles 400 (`--font-hand`, annotations only), `ui-monospace` for key/hex output.

### Claude's Discretion
- Exact pv-wasm exported function/struct names and TS type shapes.
- Self-test card visual details (within UI-DESIGN tokens; security-relevant output stays playfulness-free).
- Whether `wasm-bindgen` version pin lives in an env var, version file, or script constant — as long as it is single-sourced for crate + CLI.

### Deferred Ideas (OUT OF SCOPE)
- RustCrypto bumps (`chacha20poly1305` 0.10→0.11, `hkdf` 0.12→0.13) recommended by research as an early dedicated PR — belongs in Phase 1 or 2 planning as a standalone task, not decided here.
- Product name + logo (open question in UI-DESIGN §6) — not needed for shell; placeholder wordmark acceptable.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UI-01 | Web app (Next.js 16, `output: "export"`, Tailwind v4 + DaisyUI 5) w theme datafa.st — dark default, pełnoprawny light; cała kryptografia wyłącznie przez choke-point moduł importujący pv-core WASM | Standard Stack (verified versions), WASM Build Tooling pattern (Turbopack workaround), Architecture Patterns (`lib/crypto/` choke-point + shell layout), Code Examples (build script, `initCrypto()`, theme CSS block) |
</phase_requirements>

## Summary

This phase has one genuinely hard technical risk and one well-trodden path. The hard risk: **Turbopack (Next.js 16's default bundler) does not statically resolve the `new URL('foo_bg.wasm', import.meta.url)` pattern that wasm-bindgen's `--target web` glue code uses internally for its zero-argument `init()`** [CITED: multiple 2026 sources, see below]. This is confirmed across three independent sources (a GitHub discussion on `vercel/next.js`, and two 2026 blog write-ups specifically about Rust/WASM + Next.js 16/Turbopack). The fix is not exotic: `--target web` output's `init()` function accepts an explicit URL/Response/BufferSource argument by design [CITED: wasm-bindgen official docs, "Without a Bundler"] — so the build script copies the compiled `.wasm` binary into `web/public/`, and `lib/crypto/` calls `init('/wasm/pv_wasm_bg.wasm')` explicitly instead of relying on the zero-arg default that Turbopack can't trace. This sidesteps the bundler problem entirely rather than fighting it with `next.config.ts` asset-alias workarounds (which exist for other WASM use cases like Emscripten modules, but are unnecessary here since we already control the JS glue's init call).

The well-trodden path: `wasm-bindgen`/`wasm-bindgen-cli` at the exact-match pinned version (0.2.126, confirmed current via crates.io), `getrandom` 0.4.3 with the `wasm_js` Cargo feature (confirmed sufficient alone — no `RUSTFLAGS` cfg required for this feature specifically, per current docs.rs), and DaisyUI 5's CSS-first `@plugin "daisyui/theme"` syntax (already correctly drafted in `docs/UI-DESIGN.md` §5) are all stable, current, and match what CONTEXT.md already locked in.

**Primary recommendation:** Build `pv-wasm` with `wasm-bindgen --target web`, copy the resulting `.wasm` binary into `web/public/wasm/` (not `lib/crypto/wasm/` as CONTEXT.md's literal wording suggests — see Architecture Patterns for the split), keep the JS/TS glue in `web/src/lib/crypto/wasm/` (gitignored, imported only by `lib/crypto/`), and call `init('/wasm/pv_wasm_bg.wasm')` explicitly in `initCrypto()` to bypass Turbopack's unresolved WASM-asset-detection gap.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Crypto operations (derive/wrap/unwrap/encrypt/decrypt) | Browser/Client (WASM) | — | Zero-knowledge is a hard constraint (docs/ARCHITECTURE.md, REQUIREMENTS.md AUTH-01/02); pv-core has no I/O and is WASM-only by design — no server or build-time execution path exists or should exist |
| WASM binary delivery | CDN/Static (served asset) | Build tooling | The compiled `.wasm` is a static asset served alongside the Next.js export, not bundled/transformed by Turbopack — this is the resolution to the Turbopack asset-detection gap, not a workaround to route around |
| App shell rendering (sidebar/topbar/theme) | Browser/Client | CDN/Static | Next.js `output: "export"` — pre-rendered HTML/CSS/JS served as static files, hydrated client-side; no Node runtime, no SSR (locked, see REQUIREMENTS.md "Out of Scope": SSR/API routes forbidden for zero-knowledge reasons) |
| Theme persistence (dark/light toggle) | Browser/Client | — | `localStorage` + inline pre-hydration `<script>` to avoid FOUC; no server involvement, no cookies |
| Font loading (DM Sans, Fuzzy Bubbles) | CDN/Static | Browser/Client | `next/font` self-hosts font files as build-time static assets; served alongside the static export, applied via CSS variables at hydration |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `wasm-bindgen` (crate) | 0.2.126 [VERIFIED: crates.io, published 2026-06-24] | Rust↔JS glue macro for `pv-wasm` | Canonical Rust WASM interop; the crate/CLI schema is versioned and must match exactly |
| `wasm-bindgen-cli` | 0.2.126 (exact match to crate) [VERIFIED: crates.io] | Generates JS/TS glue + `.wasm` from `cargo build --target wasm32-unknown-unknown` output | Direct invocation (not `wasm-pack`) — see Alternatives |
| `getrandom` | 0.4.3 [VERIFIED: crates.io, published 2026-06-17] | RNG backend for `pv-core`'s `OsRng`/`rand_core` on `wasm32-unknown-unknown` | `wasm_js` feature routes to `Crypto.getRandomValues` — the only correct browser RNG source |
| `next` | 16.2.10 [VERIFIED: npm registry `latest` dist-tag] | Web app framework, static export | Matches locked decision; `15.5.20` exists only on the `backport` dist-tag (maintenance-only) |
| `react` / `react-dom` | 19.2.7 [VERIFIED: npm registry] | UI library (Next 16 peer requirement) | — |
| `typescript` | 7.0.2 [VERIFIED: npm registry] | Type checking | Current major; use with `create-next-app`'s TS template |
| `tailwindcss` | 4.3.2 [VERIFIED: npm registry] | Styling engine (CSS-first config) | Locked; DaisyUI 5 requires the Tailwind v4 engine |
| `daisyui` | 5.6.18 [VERIFIED: npm registry] | Component classes + custom theme tokens | Locked; v5 is CSS-first (`@plugin "daisyui/theme"`), no `tailwind.config.js` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `lucide-react` | 1.24.0 [VERIFIED: npm registry] `[SUS — see Package Legitimacy Audit]` | Icon set for sidebar/topbar/self-test status icons | Locked in UI-SPEC.md as the icon library (no Radix/shadcn this phase) |
| `wasm-bindgen-futures` | 0.4.76 [VERIFIED: crates.io] | Bridges `Future`↔`Promise` if any `pv-wasm` export becomes async | Not needed for this phase's synchronous KDF/AEAD self-test calls — pin in workspace deps for continuity only, don't add to `pv-wasm`'s `Cargo.toml` unless an export actually needs it |
| `web-sys` / `js-sys` | 0.3.103 [VERIFIED: crates.io] | Typed browser API bindings | Pulled in transitively via `getrandom`'s `wasm_js` backend; no direct dependency needed in `pv-wasm` unless calling browser APIs directly |
| `@types/node`, `@types/react` | 26.1.1 / 19.2.17 [VERIFIED: npm registry] | TS types for the Next.js scaffold | Standard `create-next-app --typescript` devDependencies |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `wasm-bindgen-cli` invoked directly in `scripts/build-wasm.sh` | `wasm-pack` | Only worth it if `pv-core`/`pv-wasm`'s WASM build is ever published as a standalone npm package for third-party consumption — not the case here (in-repo consumer only). `wasm-pack` also has a history of maintenance-lag behind `wasm-bindgen` releases since the rustwasm org sunset (07/2025). |
| `init('/wasm/pv_wasm_bg.wasm')` with an explicit public-path URL | `next.config.ts` Turbopack `resolveAlias`/asset-rule workaround | The alias-based workaround (used for Emscripten-style modules with a fixed internal `.wasm` reference) is more fragile and undocumented for `--target web`'s specific `new URL(..., import.meta.url)` shape; the explicit-`init()`-argument approach is a first-class, spec'd wasm-bindgen feature and avoids depending on Turbopack's evolving (currently incomplete) WASM asset-detection heuristics entirely. |
| DaisyUI 5 CSS-first themes | shadcn/ui + Radix primitives | Explicitly deferred per UI-SPEC.md — no Radix primitives needed this phase; shadcn stays uninitialized. |

**Installation:**
```bash
# Rust
cargo install wasm-bindgen-cli --version 0.2.126   # must match wasm-bindgen crate version exactly

# Web app scaffold (from repo root)
npx create-next-app@16.2.10 web --typescript --tailwind --app --no-src-dir=false --import-alias "@/*"
cd web
npm install daisyui@5.6.18 lucide-react@1.24.0
```

**Version verification:** All versions above were confirmed live against the crates.io API (`GET /api/v1/crates/<name>`) and the npm registry (`npm view <pkg> version` / `dist-tags`) on 2026-07-12 — not taken from training data. `wasm-bindgen`, `wasm-bindgen-cli`, `getrandom`, `next`, `tailwindcss`, `daisyui`, `lucide-react` versions match exactly what `.planning/research/STACK.md` already pinned; this phase's research re-confirms them at plan time as that milestone doc instructed.

## Package Legitimacy Audit

| Package | Registry | Age (first publish, approx.) | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-------------------------------|-----------|--------------|---------|-------------|
| `wasm-bindgen` | crates | 2018 | 8.3M/wk | github.com/wasm-bindgen/wasm-bindgen | OK | Approved |
| `wasm-bindgen-futures` | crates | 2018 | 4.9M/wk | github.com/wasm-bindgen/wasm-bindgen | OK | Approved |
| `getrandom` | crates | 2019 | 34.6M/wk | github.com/rust-random/getrandom | OK | Approved |
| `web-sys` / `js-sys` | crates | 2018 | 5.6M–7.8M/wk | github.com/wasm-bindgen/wasm-bindgen | OK | Approved |
| `react` / `react-dom` | npm | long-established | 121–153M/wk | github.com/facebook/react | OK | Approved |
| `next` | npm | long-established | 44.7M/wk | github.com/vercel/next.js | SUS (`too-new`) | Approved — false positive, see note |
| `tailwindcss` | npm | long-established | 107.7M/wk | github.com/tailwindlabs/tailwindcss | SUS (`too-new`) | Approved — false positive, see note |
| `daisyui` | npm | long-established | 694K/wk | github.com/saadeghi/daisyui | SUS (`too-new`) | Approved — false positive, see note |
| `lucide-react` | npm | long-established | 74.2M/wk | github.com/lucide-icons/lucide | SUS (`too-new`) | Approved — false positive, see note |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `next`, `tailwindcss`, `daisyui`, `lucide-react` — all flagged solely on the `too-new` heuristic signal, which measures **most-recent-publish recency** (these are actively-maintained packages with frequent patch releases, all published within the last two weeks), not package age or trust. Weekly download counts (694K–153M) and matching, long-established GitHub source repos make the `too-new` signal a false positive for all four — but per protocol these are still tagged `[SUS]` and the planner **must** add a `checkpoint:human-verify` task before the `npm install` step that pulls these in, even though this research assesses them as safe to proceed.

*No packages in this phase were discovered via WebSearch/training data without registry cross-check — all version numbers above are `[VERIFIED]` against the live registry, not `[ASSUMED]`.*

## Architecture Patterns

### System Architecture Diagram

```text
                     ┌─────────────────────────────────────────┐
                     │         Browser (client tier)            │
                     │                                           │
  page load ────────▶│  Next.js static export (HTML/CSS/JS)     │
                     │        │                                  │
                     │        ▼                                  │
                     │  React shell renders (sidebar/topbar/     │
                     │  main column) — no data fetch yet          │
                     │        │                                  │
                     │        ▼                                  │
                     │  Home route mounts Self-Test card          │
                     │        │                                  │
                     │        ▼                                  │
                     │  card calls lib/crypto/.initCrypto()  ─────┼──▶ fetch('/wasm/pv_wasm_bg.wasm')
                     │        │                                  │        (static asset, same origin)
                     │        ▼                                  │
                     │  lib/crypto/ (SOLE importer of the         │
                     │  generated wasm-bindgen JS glue)            │
                     │        │                                  │
                     │        ▼                                  │
                     │  WASM linear memory: pv-wasm ⊃ pv-core     │
                     │  ┌───────────────────────────────────┐    │
                     │  │ derive_master_key()  (Argon2id)    │    │
                     │  │        │                            │    │
                     │  │        ▼                            │    │
                     │  │ wrap_user_key()      (XChaCha20)    │    │
                     │  │        │                            │    │
                     │  │        ▼                            │    │
                     │  │ unwrap_user_key()                   │    │
                     │  │        │                            │    │
                     │  │        ▼                            │    │
                     │  │ encrypt_item() / decrypt_item()     │    │
                     │  └───────────────────────────────────┘    │
                     │        │  (opaque handles only cross      │
                     │        │   the boundary; raw bytes never   │
                     │        ▼   leave WASM linear memory)       │
                     │  per-step ✓/✗ status → Self-Test card UI    │
                     └─────────────────────────────────────────┘

  No network calls to pv-server this phase — self-test is fully client-local.
```

### Recommended Project Structure
```
crates/
├── pv-core/                  # unchanged — pure crypto, no wasm-bindgen
├── pv-server/                # unchanged this phase
└── pv-wasm/                  # NEW — thin wasm-bindgen binding crate
    ├── Cargo.toml             # depends on pv-core (path) + wasm-bindgen + getrandom(wasm_js)
    └── src/
        └── lib.rs             # #[wasm_bindgen] opaque structs + fns mirroring pv-core ops

scripts/
└── build-wasm.sh              # cargo build --target wasm32-unknown-unknown --release
                                # → wasm-bindgen --target web
                                # → splits output: JS/TS glue → web/src/lib/crypto/wasm/ (gitignored)
                                #                  .wasm binary → web/public/wasm/ (gitignored)

web/                            # NEW — Next.js 16 app, repo-root sibling of crates/
├── public/
│   └── wasm/                   # .wasm binary lands here (gitignored, build artifact)
├── src/
│   ├── app/
│   │   ├── layout.tsx           # next/font setup, theme pre-hydration script, DaisyUI data-theme
│   │   ├── page.tsx              # home route — shell + Self-Test card
│   │   └── globals.css           # @import "tailwindcss"; @plugin "daisyui"; theme blocks
│   ├── components/
│   │   ├── shell/                # Sidebar, TopBar, MainColumn (non-functional placeholders)
│   │   └── self-test/            # SelfTestCard, StepRow
│   └── lib/
│       └── crypto/
│           ├── index.ts          # the SOLE module importing wasm/ — initCrypto() + typed wrappers
│           └── wasm/              # generated JS/TS glue (gitignored build artifact)
├── next.config.ts               # output: "export"
└── package.json
```

### Pattern 1: WASM init with explicit public-path URL (Turbopack-safe)
**What:** Call the generated `init()` with an explicit string URL instead of the zero-argument default.
**When to use:** Always, in this project — this is the fix for the Turbopack `new URL(..., import.meta.url)` asset-detection gap.
**Example:**
```typescript
// web/src/lib/crypto/index.ts
// Source: wasm-bindgen "Without a Bundler" guide (init() accepts URL string | Response | BufferSource | WebAssembly.Module)
import init, { WasmUserKey, deriveWrappingKey /* ...pv-wasm exports */ } from "./wasm/pv_wasm.js";

let ready: Promise<void> | null = null;

export function initCrypto(): Promise<void> {
  if (!ready) {
    // Explicit path into public/ — NOT the zero-arg default, which Turbopack
    // cannot statically resolve (new URL('pv_wasm_bg.wasm', import.meta.url)
    // inside the generated glue is not asset-graph-traced by Turbopack as of
    // Next.js 16.2).
    ready = init("/wasm/pv_wasm_bg.wasm").then(() => undefined);
  }
  return ready;
}

// All other lib/crypto/ exports (self-test, future item encrypt/decrypt calls)
// await initCrypto() before touching wasm bindings. This module is the ONLY
// file in web/src that imports from ./wasm/ — grep-auditable per UI-01.
```

### Pattern 2: Opaque exported struct for key handles
**What:** Keys never cross the WASM boundary as raw bytes more than once per operation — JS holds an opaque handle, Rust owns the memory.
**When to use:** For `UserKey` and any other key material `pv-wasm` exposes to the self-test flow.
**Example:**
```rust
// crates/pv-wasm/src/lib.rs
// Source: wasm-bindgen struct-export design (docs.rs/wasm-bindgen — exported structs
// are boxed as Box<RefCell<T>> and returned to JS as an opaque pointer wrapper)
use wasm_bindgen::prelude::*;
use pv_core::keys::UserKey;

#[wasm_bindgen]
pub struct WasmUserKey(UserKey);

#[wasm_bindgen]
impl WasmUserKey {
    /// Generuje nowy User Key wewnątrz WASM linear memory — surowe bajty
    /// nigdy nie trafiają do JS.
    #[wasm_bindgen(constructor)]
    pub fn generate() -> WasmUserKey {
        WasmUserKey(UserKey::generate())
    }

    // NOTE: no method here returns &[u8] / Vec<u8> of key material.
    // Only opaque handles and boolean/status results cross the boundary.
    // `free()` is auto-generated by wasm-bindgen; calling any method after
    // free() panics in Rust (safe panic, not UB) rather than reading freed memory.
}
```

### Pattern 3: DaisyUI 5 CSS-first custom theme
**What:** Themes declared entirely in CSS via `@plugin "daisyui/theme"`, no `tailwind.config.js`.
**When to use:** `vault-dark` (default) and `vault-light` theme blocks in `globals.css`.
**Example:**
```css
/* web/src/app/globals.css */
/* Source: docs/UI-DESIGN.md §5 (already-drafted block, confirmed current DaisyUI 5.6.18 syntax) */
@import "tailwindcss";
@plugin "daisyui";

@plugin "daisyui/theme" {
  name: "vault-dark";
  default: true;
  color-scheme: dark;
  --color-primary: oklch(65.31% 0.1637 37.22);
  --color-primary-content: oklch(100% 0 0);
  --color-secondary: oklch(82.36% 0.0962 242.82);
  --color-accent: oklch(74.51% 0.167 183.61);
  --color-neutral: oklch(42.02% 0 0);
  --color-base-100: oklch(26.86% 0 0);
  --color-base-200: oklch(24.78% 0 0);
  --color-base-300: oklch(23.93% 0 0);
  --color-base-content: oklch(89.80% 0.0017 67.80);
  --color-info: oklch(72.06% 0.191 231.6);
  --color-success: oklch(64.80% 0.150 160);
  --color-warning: oklch(84.71% 0.199 83.87);
  --color-error: oklch(71.76% 0.221 22.18);
  --radius-box: 1rem;
  --radius-field: 0.5rem;
  --radius-selector: 1.9rem;
  --border: 1px;
}

@plugin "daisyui/theme" {
  name: "vault-light";
  color-scheme: light;
  --color-base-100: oklch(100% 0 0);
  --color-base-200: oklch(98.86% 0.0017 67.80);
  --color-base-300: oklch(98.86% 0.0017 67.80);
  --color-base-content: oklch(26.86% 0 0);
  /* primary/secondary/accent/semantic tokens unchanged from vault-dark — OKLCH
     hue/chroma is theme-invariant per UI-SPEC.md's Color section */
}
```

### Anti-Patterns to Avoid
- **Relying on `init()`'s zero-argument default under Turbopack:** works fine under Webpack (Next 15 default) but silently fails or errors under Turbopack (Next 16 default) because the internal `new URL('pv_wasm_bg.wasm', import.meta.url)` isn't asset-graph-traced. Always pass an explicit path.
- **Returning raw key bytes (`Vec<u8>`/`&[u8]`) from any `#[wasm_bindgen]` method:** violates the phase's own grep-auditable success criterion and creates an un-zeroizable JS-heap copy of secret material (see Pitfall 6 below).
- **Putting the `.wasm` binary in `lib/crypto/wasm/` alongside the JS glue and importing it as a JS module:** this re-triggers the exact Turbopack bundler-import problem this pattern is designed to avoid. The binary must be a `fetch()`-able static asset (`public/`), not a bundler-processed import.
- **Configuring DaisyUI via `tailwind.config.js`:** DaisyUI 5 + Tailwind v4 is CSS-first only; a `tailwind.config.js` theme block is silently ignored.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Rust↔JS type marshaling for exported crypto functions | Manual `wasm_bindgen::JsValue` serialization / raw pointer FFI | `#[wasm_bindgen]` macro on `pv-wasm` structs/functions | Handles the ABI, ownership transfer, and panic-safety (`free()` neutering) correctly; hand-rolled FFI in a crypto-adjacent crate is a large, avoidable attack surface |
| Theme dark/light flash-of-wrong-theme prevention | Client `useEffect` that sets `data-theme` after hydration | Inline pre-hydration `<script>` in `layout.tsx` that reads `localStorage`/`prefers-color-scheme` before paint (already locked in CONTEXT.md/UI-SPEC.md) | `useEffect` runs after first paint — guaranteed FOUC; the inline script pattern is the standard fix for every dark-mode-capable static site |
| Font self-hosting/optimization | Manual `<link>` to Google Fonts CDN or manual `@font-face` + file copying | `next/font/google` / `next/font/local` | Handles build-time download, subsetting, `font-display: swap`, and CSS-variable wiring automatically; a manual CDN `<link>` also leaks visitor IPs to Google at every page load, which is a mild but avoidable privacy regression for a self-hosted, privacy-positioned product |

**Key insight:** The one place this phase is tempted to hand-roll something non-obvious is the WASM-loading glue itself (custom `fetch` + `WebAssembly.instantiate` calls to route around Turbopack). Resist this — wasm-bindgen's `--target web` output already supports exactly the "explicit URL" use case needed here as a first-class, documented API (`init(url)`); no custom loader code is needed, only a build-script decision about *where* the `.wasm` file ends up.

## Common Pitfalls

### Pitfall 1: Turbopack can't resolve wasm-bindgen's default `.wasm` asset reference
**What goes wrong:** Calling `await init()` with no arguments (the pattern shown in most wasm-bindgen tutorials, which predate Turbopack) either fails to build or fails at runtime with a 404/unresolved-module error once bundled by Turbopack (Next.js 16's default bundler, no config needed to enable it).
**Why it happens:** wasm-bindgen's `--target web` glue resolves the `.wasm` file's location via `new URL('pv_wasm_bg.wasm', import.meta.url)`. Webpack 5 special-cases this exact syntax; Turbopack (as of the Next.js 16.2 line, mid-2026) does not yet trace it through its asset graph [CITED: `vercel/next.js` discussion #75430; corroborated by two independent 2026 technical write-ups].
**How to avoid:** Copy the compiled `.wasm` binary into `web/public/wasm/` as part of `scripts/build-wasm.sh`, and call `init('/wasm/pv_wasm_bg.wasm')` explicitly in `initCrypto()` — this is a supported, spec'd argument to the generated `init()` function, not a workaround bolted onto an unsupported path.
**Warning signs:** Build succeeds but the self-test card's first crypto call hangs or rejects with a fetch/404 error in the browser console; `next dev` works (dev server sometimes falls back differently) but `next build && next start`-equivalent static serving fails.

### Pitfall 2: `wasm-bindgen` crate/CLI version drift breaks the build with a confusing error
**What goes wrong:** `cargo build` succeeds, but `wasm-bindgen --target web ...` fails with a schema-version mismatch error that doesn't clearly say "reinstall the CLI at the matching version."
**Why it happens:** The crate (compiled into `pv-wasm`) and the CLI binary share a schema-versioned wire protocol; any patch-version drift (e.g. crate on 0.2.126, CLI still 0.2.100 from a stale global install) is a hard failure [CITED: wasm-bindgen GitHub issues #2544, #2619].
**How to avoid:** Single-source the version (CONTEXT.md leaves the mechanism to Claude's discretion — a `WASM_BINDGEN_VERSION` file or script constant read by both `Cargo.toml`-adjacent tooling and `scripts/build-wasm.sh`'s `cargo install wasm-bindgen-cli --version $(cat ...)` call is sufficient) so a version bump can only happen in one place.
**Warning signs:** Build error mentioning "schema version" or "it looks like the Rust project used to create this wasm file was linked against a different version."

### Pitfall 3: WASM secret material leaks through JS-side copies that `zeroize` cannot reach
**What goes wrong:** Even with `Zeroize`/`ZeroizeOnDrop` correctly applied throughout `pv-core`, any secret that crosses the `wasm-bindgen` boundary as a plain value (not an opaque handle) leaves an unzeroizable copy in JS-managed heap memory that only GC (non-deterministic) can reclaim.
**Why it happens:** `zeroize` only controls memory it's told to clear inside Rust's own linear memory — it has no visibility into the JS heap on the other side of the FFI boundary [documented in `.planning/research/PITFALLS.md` Pitfall 6, cross-referenced here since it's directly actionable in this phase's API design].
**How to avoid:** This is exactly why CONTEXT.md's opaque-struct-handle decision matters architecturally, not just stylistically — design every `pv-wasm` export so raw key/secret bytes never appear as a `Vec<u8>`/`Uint8Array` return value. The self-test's demoable round-trip should return only booleans/status strings and (for the optional technical-detail row in the UI-SPEC self-test card) truncated, non-secret hex fragments of ciphertext/nonces — never plaintext or key material.
**Warning signs:** Any `#[wasm_bindgen]` function signature with a `Vec<u8>` or `&[u8]` return type that isn't already ciphertext (ciphertext is fine — the AEAD blob is not secret on its own).

### Pitfall 4: DaisyUI 5 theme block silently ignored if placed in the wrong config surface
**What goes wrong:** Copy-pasting a DaisyUI 4-style `tailwind.config.js` `daisyui: { themes: [...] }` block (common in older tutorials/AI training data) has no effect under DaisyUI 5 + Tailwind v4 — the app renders with DaisyUI defaults, not the `vault-dark`/`vault-light` tokens.
**Why it happens:** DaisyUI 5's biggest structural change is CSS-first configuration via `@plugin "daisyui/theme"` inside the CSS entrypoint; `tailwind.config.js` is not read for theme definitions at all in this version line [CITED: daisyUI 5 upgrade guide].
**How to avoid:** Use the exact `@plugin "daisyui/theme" { ... }` block already drafted in `docs/UI-DESIGN.md` §5 verbatim in `globals.css` — do not create a `tailwind.config.js` theme section.
**Warning signs:** Theme toggle changes `data-theme` attribute correctly but colors don't change, or colors are DaisyUI's stock `light`/`dark` palette instead of the coral/teal `vault-dark` tokens.

## Code Examples

Verified patterns from official/primary sources (see Pattern 1–3 above for the full, phase-specific versions):

### wasm-bindgen without-a-bundler init signature
```javascript
// Source: rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html
import init, { add } from './pkg/without_a_bundler.js';

async function run() {
  // Accepts: URL string | WebAssembly.Module | ArrayBuffer | Response | Promise<any of these>
  await init('./pkg/without_a_bundler_bg.wasm');
  const result = add(1, 2);
}
```

### getrandom wasm_js Cargo feature (pv-wasm's Cargo.toml)
```toml
# Source: docs.rs/getrandom/latest/getrandom — "enable the wasm_js crate feature"
# The Cargo feature alone is sufficient for 0.4.x; no RUSTFLAGS/.cargo/config.toml
# cfg flag is required for wasm_js specifically (that mechanism is for OPT-IN
# backends like rdrand/linux_getrandom, not the default web backend).
[target.'cfg(target_arch = "wasm32")'.dependencies]
getrandom = { version = "0.4", features = ["wasm_js"] }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|-------------------|---------------|--------|
| Webpack 5 as Next.js default bundler (special-cases `new URL(..., import.meta.url)` for WASM) | Turbopack as Next.js 16 default (does not yet special-case this pattern) | Next.js 16.0 (Turbopack became default) | Any wasm-bindgen tutorial/example written before ~2025 that relies on `init()`'s zero-arg default will silently break under a fresh Next.js 16 scaffold; must use explicit-URL `init()` pattern from day one of this phase |
| `getrandom` 0.2.x `js` feature | `getrandom` 0.4.x `wasm_js` feature | renamed across 0.2→0.3→0.4 | Any tutorial/AI-generated snippet referencing `features = ["js"]` is stale; `.planning/research/PITFALLS.md` and `STACK.md` already flag this |
| `tailwind.config.js` `daisyui.themes` array | `@plugin "daisyui/theme" { ... }` in CSS | DaisyUI 5 (2025) | Already correctly reflected in `docs/UI-DESIGN.md` — no drift to correct here, just confirming currency |

**Deprecated/outdated:**
- `wasm-pack` as the primary build driver for in-repo (non-published) WASM consumers — still functional but unnecessary indirection; direct `wasm-bindgen-cli` invocation is simpler and avoids `wasm-pack`'s post-rustwasm-sunset maintenance lag (already established in `.planning/research/STACK.md`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `getrandom` 0.4.x's `wasm_js` feature requires no additional `RUSTFLAGS`/`.cargo/config.toml` cfg flag (contradicted by one lower-confidence WebSearch snippet that suggested a `getrandom_backend="wasm_js"` cfg is needed) — this research's docs.rs fetch is the higher-confidence, more current source and states the Cargo feature alone is sufficient | Code Examples, Common Pitfalls | If wrong: WASM build compiles but panics at runtime with "unsupported target" when `pv-wasm` calls into `OsRng`. Low-cost to verify — the very first `cargo build -p pv-wasm --target wasm32-unknown-unknown` in this phase will either work or fail loudly; not a silent risk. Planner should add a smoke-test task early (build + load in browser) before building out the full self-test UI. |
| A2 | The exact `init('/wasm/pv_wasm_bg.wasm')` explicit-URL pattern resolves Turbopack's asset-detection gap in Next.js 16.2.x specifically (verified against wasm-bindgen's own documented `init()` API, but not executed end-to-end against a live Turbopack 16.2 build in this research session) | Summary, Architecture Patterns Pattern 1, Pitfall 1 | If wrong (e.g. Turbopack also intercepts and mis-resolves the runtime `fetch('/wasm/...')` call, not just the build-time `new URL` pattern): the fallback is `next dev --webpack` / a Turbopack-disabling flag for local dev, or serving the `.wasm` from an explicit Next.js Route Handler — both add complexity CONTEXT.md's static-export-only architecture doesn't currently need. Should be the very first thing verified when this phase starts execution (a minimal `init()` + one exported function call, before building the full self-test UI). |
| A3 | `lucide-react` 1.24.0 and `next`/`tailwindcss`/`daisyui`'s `[SUS]` "too-new" verdicts are recency-heuristic false positives, not actual legitimacy concerns (based on download counts and matching established source repos, not an independent trust audit of this specific patch release) | Package Legitimacy Audit | Low — these are among the most widely-used packages in the JS ecosystem; a supply-chain compromise of any of them would be a major, immediately-public incident, not a silent risk specific to this project. Per protocol, planner still gates the `npm install` behind a `checkpoint:human-verify` task. |

## Open Questions

1. **Exact `pv-wasm` exported function/struct surface for the self-test round-trip**
   - What we know: the round-trip is derive → wrap → unwrap → encrypt → decrypt, mapping directly onto `pv-core`'s existing `kdf::wrapping_key_from_password`, `keys::wrap_user_key`/`unwrap_user_key`, `items::encrypt_item`/`decrypt_item`.
   - What's unclear: exact TS type shapes and whether intermediate values (e.g. the wrapped-key blob) are returned as opaque handles too, or as serializable JSON (safe, since `WrappedKey` is ciphertext, not secret) — CONTEXT.md explicitly leaves this to Claude's discretion.
   - Recommendation: `WrappedKey`-shaped return values (nonce + ciphertext, already `Serialize`/`Deserialize` in `pv-core`) can safely cross the boundary as plain JS objects since they're not secret; only `UserKey`/derived-key material needs the opaque-handle treatment. Planner should design the `pv-wasm` API surface as the first concrete task of this phase.

2. **Whether the `.wasm` binary needs a cache-busting filename or explicit no-cache header from the static export**
   - What we know: `wasm-bindgen`'s output filename includes a content hash suffix already in some configurations, but not universally, and this phase serves the export via `next dev`/local static preview only (axum `ServeDir` integration is Phase 7).
   - What's unclear: whether a stale-cached `.wasm` in `public/wasm/` could cause a version mismatch between the JS glue and the binary during local iteration.
   - Recommendation: not a blocking concern for this phase (single-developer local iteration); flag for Phase 7's deployment research to set appropriate cache headers on the static export.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| Rust toolchain (`wasm32-unknown-unknown` target) | `pv-wasm` compilation | ✓ | rustc 1.97.0, target already installed per `rust-toolchain.toml` | — |
| `wasm-bindgen-cli` | `scripts/build-wasm.sh` | ✗ (not yet installed) | — | `cargo install wasm-bindgen-cli --version 0.2.126` — this is an expected, first-task install, not a blocker |
| Node.js / npm | Next.js app | ✓ | node v24.18.0, npm 11.16.0 | — |
| Docker | none this phase | ✗ | — | Not needed until Phase 7 (Self-Host Packaging) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** `wasm-bindgen-cli` — install is a normal, expected first step of this phase's execution, not an environment gap.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Rust: `cargo test` (existing, used by `pv-core`'s unit tests). Web: none yet — Phase 1 introduces the Next.js app from scratch. |
| Config file | none — see Wave 0 |
| Quick run command | `cargo test -p pv-wasm` (Rust-side, if any non-`#[wasm_bindgen]`-gated logic exists); browser-side self-test is manual/visual per UI-SPEC.md (the self-test card *is* the test surface for this phase) |
| Full suite command | `cargo test --workspace` plus a manual browser check of the self-test card (all 5 steps green) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| UI-01 | `pv-core` crypto round-trip (derive→wrap→unwrap→encrypt→decrypt) succeeds entirely inside `lib/crypto/` via WASM | manual (self-test UI is the verification surface, per phase's own success criteria) | visual check: self-test card shows 5/5 ✓ in both `vault-dark` and `vault-light` | ❌ Wave 0 — self-test card is this phase's deliverable |
| UI-01 | Only `lib/crypto/` imports the wasm package | static/grep-audit | `grep -rl "from ['\"].*wasm" web/src --include="*.ts*" \| grep -v "lib/crypto"` (expect empty output) | ❌ Wave 0 — add as a CI-able script or manual verification step |
| UI-01 | No raw key bytes returned across the WASM boundary more than once per operation | code review (structural, not runtime-testable) | manual review of every `#[wasm_bindgen]` fn signature in `pv-wasm/src/lib.rs` for `Vec<u8>`/`&[u8]` returns of secret material | ❌ Wave 0 — add as an explicit plan-checker/code-review gate |

### Sampling Rate
- **Per task commit:** `cargo build -p pv-wasm --target wasm32-unknown-unknown` (fast compile check) + `npm run build` (web) once the app exists
- **Per wave merge:** full self-test round-trip in browser (both themes) + the grep-audit for `lib/crypto/` choke-point isolation
- **Phase gate:** self-test card green (5/5) in `vault-dark` and `vault-light`; grep-audit passes; no `Vec<u8>`/`&[u8]` secret-material returns in `pv-wasm` public API (manual review)

### Wave 0 Gaps
- [ ] `crates/pv-wasm/` — does not exist yet, this phase creates it
- [ ] `web/` — does not exist yet, this phase creates it (Next.js scaffold)
- [ ] `scripts/build-wasm.sh` — does not exist yet
- [ ] No existing web-side test framework (Vitest/Playwright) — out of scope for this phase per its own success criteria (self-test card *is* the verification surface); a future phase introducing functional vault screens should add one

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | no | Phase 1 has no auth screens (Phases 2–4) |
| V3 Session Management | no | No sessions this phase |
| V4 Access Control | no | No access-controlled resources this phase |
| V5 Input Validation | yes (narrow) | `pv-wasm` exported functions validate input lengths before calling into `pv-core` (which already validates: salt ≥16 bytes, PRF output ≥32 bytes) — no new validation logic needed, just don't bypass `pv-core`'s existing checks at the WASM boundary |
| V6 Cryptography | yes (by construction, not new work) | `pv-wasm` must not introduce any new cryptographic primitive or reimplement anything `pv-core` already does — it is a pure binding layer. The security-relevant work this phase actually does is *boundary design* (opaque handles, minimal round-trips), covered under Common Pitfalls #3, not primitive selection. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|------------------------|
| Secret material (key bytes) leaked via JS-heap copies at the WASM boundary | Information Disclosure | Opaque exported-struct handles only; no `Vec<u8>`/`&[u8]` return of key/secret material from any `#[wasm_bindgen]` function (Pitfall 3 above) |
| Stale/mismatched `wasm-bindgen` crate vs. CLI producing a corrupted or unexpectedly-shaped `.wasm` binary | Tampering (build-integrity, not runtime) | Exact-version pinning in one single-sourced location (CONTEXT.md decision); build fails loudly on mismatch rather than silently producing a bad artifact |
| A future phase accidentally importing the wasm package outside `lib/crypto/`, bypassing the intended choke point | Elevation of Privilege (of a sort — an uncontrolled crypto call site) | Grep-auditable single-importer rule (already the phase's own success criterion); enforce with the audit script listed in Validation Architecture |

*No server-side threat surface exists in this phase (no `pv-server` changes) — the security domain here is entirely about the client-side WASM boundary design, not network/auth/access-control, which is why most ASVS categories above are marked "no" for this specific phase.*

## Sources

### Primary (HIGH confidence)
- crates.io API (`https://crates.io/api/v1/crates/<name>`) — direct registry queries, 2026-07-12: `wasm-bindgen` (0.2.126), `wasm-bindgen-cli` (0.2.126), `getrandom` (0.4.3), `wasm-bindgen-futures` (0.4.76), `web-sys` (0.3.103), `js-sys` (0.3.103), `chacha20poly1305` (0.11.0)
- npm registry (`npm view <pkg> version` / `dist-tags`), 2026-07-12: `next` (16.2.10 latest / 15.5.20 backport), `react`/`react-dom` (19.2.7), `typescript` (7.0.2), `tailwindcss` (4.3.2), `daisyui` (5.6.18), `lucide-react` (1.24.0), `@types/node` (26.1.1), `@types/react` (19.2.17)
- `gsd-tools query package-legitimacy check` — npm + crates ecosystem verdicts for all newly-introduced packages this phase
- Existing codebase: `crates/pv-core/src/{lib,keys,kdf,items,prf,error}.rs`, `Cargo.toml` (workspace), `crates/pv-server/src/main.rs`, `rust-toolchain.toml`

### Secondary (MEDIUM confidence)
- [Loading .wasm files as assets with Turbopack — vercel/next.js Discussion #75430](https://github.com/vercel/next.js/discussions/75430)
- [Making WebAssembly Work in Next.js 16 with Turbopack — Riku Block](https://rikublock.dev/docs/tutorials/nextjs-turbo-wasm/) (fetch blocked by 403; findings corroborated via other sources)
- [Rust Wasm for Next.js: 2026 Compilation Strategies & Performance — Nandann Creative Agency](https://www.nandann.com/blog/rust-wasm-nextjs-2026-compilation-strategies)
- [Turbopack in 2026: The Complete Guide — Pockit Blog](https://pockit.tools/blog/turbopack-nextjs-bundler-complete-guide/)
- [Without a Bundler — The `wasm-bindgen` Guide](https://rustwasm.github.io/docs/wasm-bindgen/examples/without-a-bundler.html) — `init()` argument signature
- [`getrandom` — docs.rs](https://docs.rs/getrandom/latest/getrandom/) — `wasm_js` feature setup
- [wasm-bindgen version mismatch — GitHub Issue #2544 / #2619](https://github.com/wasm-bindgen/wasm-bindgen/issues/2544)
- [daisyUI 5 release notes / upgrade guide](https://daisyui.com/docs/v5/?lang=en)
- `.planning/research/STACK.md`, `.planning/research/PITFALLS.md` — milestone-level research this phase extends, not repeats
- `docs/UI-DESIGN.md` — theme token source of truth (verbatim CSS block reused)

### Tertiary (LOW confidence)
- WebSearch AI-summarized snippet suggesting a `getrandom_backend="wasm_js"` RUSTFLAGS cfg is required — contradicted by the higher-confidence direct docs.rs fetch (see Assumption A1); flagged, not treated as fact

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version number directly confirmed against crates.io/npm registry APIs this session, not carried over from training data or the milestone STACK.md without re-verification
- Architecture (Turbopack/wasm-bindgen integration): MEDIUM — the `init(url)` fix is documented, spec'd wasm-bindgen behavior (HIGH-confidence primitive), but its specific interaction with Next.js 16.2's Turbopack has not been executed end-to-end in this research pass (three independent secondary sources corroborate the underlying bundler gap, none show this exact fix applied to a wasm-bindgen `--target web` + Next.js static export project specifically) — flagged as Assumption A2, should be the first thing verified when execution starts
- Pitfalls: MEDIUM-HIGH — WASM/zeroize boundary pitfalls carried forward from the already-thorough milestone `PITFALLS.md`; Turbopack-specific pitfall is newly researched this session with 3-source corroboration

**Research date:** 2026-07-12
**Valid until:** 2026-08-11 (30 days) — shorter re-check window recommended specifically for the Turbopack/wasm-bindgen interaction (Assumption A2), since Turbopack's WASM support is actively evolving; re-verify against current Turbopack release notes if execution of this phase is delayed more than a few weeks past this research date
