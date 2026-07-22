# Phase 1: WASM Crypto Bridge & Web App Shell - Pattern Map

**Mapped:** 2026-07-12
**Files analyzed:** 13
**Analogs found:** 8 / 13 (5 are greenfield with no in-repo analog — `web/` is a new Next.js app)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `Cargo.toml` (workspace root, add `pv-wasm` member) | config | CRUD (build config) | `Cargo.toml` (existing workspace root) | exact — same file, additive edit |
| `crates/pv-wasm/Cargo.toml` | config | — | `crates/pv-core/Cargo.toml` | role-match (sibling crate manifest) |
| `crates/pv-wasm/src/lib.rs` | service/utility (FFI binding layer) | transform (Rust↔JS marshaling) | `crates/pv-core/src/keys.rs` + `crates/pv-core/src/lib.rs` | role-match (wraps existing crypto ops; no prior wasm-bindgen crate exists) |
| `scripts/build-wasm.sh` | utility (build script) | batch | none in-repo (no `scripts/` dir yet) | no analog |
| `web/src/lib/crypto/index.ts` | service (choke-point facade) | request-response (async init + typed wrappers) | none (TS greenfield); pattern taken from RESEARCH.md Pattern 1 | no analog |
| `web/src/app/layout.tsx` | component (root layout) | request-response | none (greenfield) | no analog |
| `web/src/app/page.tsx` | component (home route) | request-response | none (greenfield) | no analog |
| `web/src/app/globals.css` | config (theme tokens) | — | `docs/UI-DESIGN.md` §5 (verbatim CSS block) | exact — spec already drafts the literal block to reuse |
| `web/src/components/shell/*` (Sidebar, TopBar, MainColumn) | component | request-response | none (greenfield) | no analog |
| `web/src/components/self-test/*` (SelfTestCard, StepRow) | component | request-response (drives WASM calls) | none (greenfield) | no analog |
| `web/next.config.ts` | config | — | none (greenfield) | no analog |
| `web/package.json` | config | — | none (greenfield) | no analog |
| `crates/pv-server` (workspace membership only — not touched functionally) | — | — | `crates/pv-server/Cargo.toml`, `crates/pv-server/src/main.rs` | reference only, not modified this phase |

## Pattern Assignments

### `Cargo.toml` (workspace root)

**Analog:** same file, current state (Read in full)

**Current members list** (lines 1-3):
```toml
[workspace]
resolver = "2"
members = ["crates/pv-core", "crates/pv-server"]
```

**Action:** add `"crates/pv-wasm"` as third member, preserving `resolver = "2"` and `[workspace.package]` inheritance. `[workspace.dependencies]` block (`serde`, `serde_json`, `thiserror`, `uuid`) stays shared; `pv-wasm` should pull `serde` via `.workspace = true` the same way `pv-core` does, and add `wasm-bindgen`/`getrandom` as crate-local (non-shared) deps since they're WASM-only.

---

### `crates/pv-wasm/Cargo.toml` (config)

**Analog:** `crates/pv-core/Cargo.toml`

**Full pattern to replicate:**
```toml
[package]
name = "pv-wasm"
version.workspace = true
edition.workspace = true
license.workspace = true
description = "wasm-bindgen bindings for pv-core — thin FFI layer, no crypto logic of its own."

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
pv-core = { path = "../pv-core" }
wasm-bindgen = "=0.2.126"
serde.workspace = true
serde_json.workspace = true

[target.'cfg(target_arch = "wasm32")'.dependencies]
getrandom = { version = "0.2", features = ["js"] }
```
Notes:
- `pv-core` is path-dependency, mirroring how `pv-server/Cargo.toml` depends on it (`pv-core = { path = "../pv-core" }`).
- `wasm-bindgen` version must be pinned exact (`=0.2.126`) per CONTEXT.md's exact-match requirement — single-source with `scripts/build-wasm.sh`'s CLI install version.
- `getrandom` must be pinned to the `0.2`/`js` form, not `0.4`/`wasm_js`: measured via `cargo tree -i getrandom`, pv-core's `chacha20poly1305::aead::OsRng` resolves through `chacha20poly1305` 0.10.1 → `aead` 0.5.2 → `rand_core` 0.6.4 → `getrandom` 0.2.17. Cargo does not unify features across semver-incompatible majors, so a `0.4`/`wasm_js` pin would leave the actual 0.2.17 resolution without its `js` feature and fail to compile for `wasm32-unknown-unknown`.
- `crate-type = ["cdylib", "rlib"]` is required for wasm-bindgen cdylib output (not present in any existing crate — pv-core/pv-server are plain `rlib` via default `[lib]`).

---

### `crates/pv-wasm/src/lib.rs` (FFI binding layer, transform)

**Analog:** `crates/pv-core/src/keys.rs` (for Zeroize/opaque-handle pattern) + `crates/pv-core/src/lib.rs` (for module doc style) + `crates/pv-core/src/error.rs` (for error conversion)

**Module doc pattern** (from `crates/pv-core/src/lib.rs` lines 1-16):
```rust
//! pv-wasm — cienka warstwa wasm-bindgen wokół pv-core.
//!
//! Surowe bajty kluczy nigdy nie przekraczają granicy WASM/JS jako
//! Vec<u8>/&[u8] — tylko nieprzezroczyste handle (patrz WasmUserKey).
```

**Opaque-handle wrapping pattern** — directly mirrors `UserKey`'s `Zeroize`/`ZeroizeOnDrop`/`expose()`-gated design in `crates/pv-core/src/keys.rs` lines 21-40:
```rust
use wasm_bindgen::prelude::*;
use pv_core::keys::UserKey;

#[wasm_bindgen]
pub struct WasmUserKey(UserKey);

#[wasm_bindgen]
impl WasmUserKey {
    #[wasm_bindgen(constructor)]
    pub fn generate() -> WasmUserKey {
        WasmUserKey(UserKey::generate())
    }
    // No method returns &[u8]/Vec<u8> of key material — mirrors pv-core's
    // single expose() choke point, but pv-wasm never even calls expose()
    // outward; it stays internal to wrapping/unwrapping calls.
}
```

**Error conversion pattern** — mirrors `CryptoError`'s `thiserror`-derived enum (`crates/pv-core/src/error.rs` lines 1-13) converted at the FFI boundary via `map_err` (same idiom pv-server uses for `anyhow::Context`, e.g. `crates/pv-server/src/main.rs` line 26 `.context("invalid PV_DB_URL")`):
```rust
fn to_js_err(e: pv_core::CryptoError) -> JsValue {
    JsValue::from_str(&e.to_string())
}

#[wasm_bindgen]
pub fn wrap_user_key(wrapping_key: &[u8], uk: &WasmUserKey) -> Result<JsValue, JsValue> {
    let mut wk = [0u8; pv_core::keys::KEY_LEN];
    wk.copy_from_slice(wrapping_key);
    let blob = pv_core::keys::wrap_user_key(&wk, &uk.0).map_err(to_js_err)?;
    // WrappedKey is ciphertext (nonce+ciphertext), not secret — safe to
    // serialize as a plain JS object via serde_wasm_bindgen or JsValue::from_serde-equivalent.
    Ok(serde_wasm_bindgen::to_value(&blob).map_err(|e| JsValue::from_str(&e.to_string()))?)
}
```

**Round-trip functions to bind** (mirror exact signatures from pv-core, per RESEARCH.md Open Question 1):
- `kdf::wrapping_key_from_password` (`crates/pv-core/src/kdf.rs` lines 50-57)
- `keys::wrap_user_key` / `keys::unwrap_user_key` (`crates/pv-core/src/keys.rs` lines 89-106)
- `items::encrypt_item` / `items::decrypt_item` (`crates/pv-core/src/items.rs` lines 38-56)

**Input validation is already handled by pv-core** — do not re-validate salt length / PRF length in `pv-wasm`; just don't bypass the checks (`crates/pv-core/src/kdf.rs` lines 32-37, `crates/pv-core/src/prf.rs` lines 22-24).

---

### `scripts/build-wasm.sh` (utility, batch)

**Analog:** none in-repo. Follow RESEARCH.md's Recommended Project Structure and Pattern 1 verbatim:
```bash
#!/usr/bin/env bash
set -euo pipefail
WASM_BINDGEN_VERSION="0.2.126"  # single-sourced; must match crates/pv-wasm/Cargo.toml pin

cargo build -p pv-wasm --target wasm32-unknown-unknown --release
cargo tree -i getrandom  # duplicate-major audit per CONTEXT.md decision

wasm-bindgen --target web \
  --out-dir web/src/lib/crypto/wasm \
  target/wasm32-unknown-unknown/release/pv_wasm.wasm

mkdir -p web/public/wasm
mv web/src/lib/crypto/wasm/pv_wasm_bg.wasm web/public/wasm/pv_wasm_bg.wasm
```
Wire into `web/package.json` as `prebuild`/`predev` scripts per CONTEXT.md.

---

### `web/src/lib/crypto/index.ts` (choke-point facade, request-response)

**Analog:** none in codebase — greenfield TS. Use RESEARCH.md Pattern 1 verbatim (already vetted against the Turbopack pitfall):
```typescript
import init, { WasmUserKey /* ...pv-wasm exports */ } from "./wasm/pv_wasm.js";

let ready: Promise<void> | null = null;

export function initCrypto(): Promise<void> {
  if (!ready) {
    ready = init("/wasm/pv_wasm_bg.wasm").then(() => undefined);
  }
  return ready;
}
```
**Rule:** this is the ONLY file under `web/src` that imports from `./wasm/` — enforced by the grep-audit in RESEARCH.md's Validation Architecture:
```bash
grep -rl "from ['\"].*wasm" web/src --include="*.ts*" | grep -v "lib/crypto"
# expect empty output
```

---

### `web/src/app/globals.css` (theme config)

**Analog:** `docs/UI-DESIGN.md` §5 — exact block already drafted, reuse verbatim (see RESEARCH.md Pattern 3, lines 273-312 of RESEARCH.md). Do not create `tailwind.config.js` theme sections (Anti-Pattern, DaisyUI 5 is CSS-first only).

---

### `web/src/app/layout.tsx`, `page.tsx`, `components/shell/*`, `components/self-test/*`

**Analog:** none — greenfield Next.js app. No existing React/Next code in this repo to pattern-match against. Follow:
- RESEARCH.md's "Don't Hand-Roll" table: inline pre-hydration `<script>` for theme (not `useEffect`) to avoid FOUC.
- `next/font` for DM Sans / Fuzzy Bubbles (not manual `<link>`).
- Shell layout structure per `docs/UI-DESIGN.md` §3 (sidebar/topbar/main column) — read that doc directly at plan/build time for exact component boundaries.
- Self-test card is the sole functional surface this phase; it calls `initCrypto()` then the derive→wrap→unwrap→encrypt→decrypt round trip, rendering per-step ✓/✗ (see RESEARCH.md System Architecture Diagram).

---

## Shared Patterns

### Zeroize / opaque-handle discipline (crypto boundary)
**Source:** `crates/pv-core/src/keys.rs` lines 21-40 (`UserKey`), `crates/pv-core/src/items.rs` lines 18-27 (`ItemKey`)
**Apply to:** `crates/pv-wasm/src/lib.rs` — every exported struct wrapping key material (`WasmUserKey`) must derive nothing extra on the JS side; JS never receives raw bytes. `WrappedKey`/`EncryptedItem` (ciphertext, not secret) may cross as plain serializable objects, matching their existing `#[derive(Serialize, Deserialize)]` in pv-core.

### Domain-separated HKDF constants
**Source:** `crates/pv-core/src/keys.rs` lines 17-19 (`INFO_PW_UNLOCK`, `INFO_PRF_UNLOCK`)
**Apply to:** No new constants needed this phase — `pv-wasm` must call existing pv-core functions that already apply these; do not introduce new domain-separation strings in the binding layer.

### Error handling: `CryptoError` → boundary conversion
**Source:** `crates/pv-core/src/error.rs` (full file, `thiserror`-derived enum)
**Apply to:** `crates/pv-wasm/src/lib.rs` — convert every `Result<T, CryptoError>` to `Result<T, JsValue>` via `.map_err(to_js_err)` at each `#[wasm_bindgen]` function boundary; never `unwrap()`/`expect()` on a `CryptoError` inside the binding layer (pv-core itself only uses `.expect()` once, for a length invariant that cannot fail — `crates/pv-core/src/keys.rs` line 53 — not a pattern to replicate for FFI-facing code).

### Module-doc style (`//!` headers, mixed PL/EN comments)
**Source:** `crates/pv-core/src/lib.rs` lines 1-16, `crates/pv-core/src/prf.rs` lines 1-9
**Apply to:** `crates/pv-wasm/src/lib.rs` top-of-file doc comment — same tone/format (Polish prose, English technical terms), explain the "why" of opaque handles as prf.rs explains the PRF footgun.

### Workspace crate manifest shape
**Source:** `crates/pv-core/Cargo.toml` (full file)
**Apply to:** `crates/pv-wasm/Cargo.toml` — `version.workspace = true` / `edition.workspace = true` / `license.workspace = true`, shared deps via `.workspace = true` (serde, serde_json), crate-local deps declared directly (as pv-core does for argon2/chacha20poly1305/etc.).

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md patterns instead — all RESEARCH.md Code Examples/Patterns 1-3 are already vetted for these):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `scripts/build-wasm.sh` | utility | batch | No `scripts/` directory exists yet; first build script in repo |
| `web/src/lib/crypto/index.ts` | service | request-response | No prior WASM/TS integration in repo — first web app |
| `web/src/app/layout.tsx` | component | request-response | Greenfield Next.js app |
| `web/src/app/page.tsx` | component | request-response | Greenfield Next.js app |
| `web/src/components/shell/*` | component | request-response | Greenfield Next.js app |
| `web/src/components/self-test/*` | component | request-response | Greenfield Next.js app |
| `web/next.config.ts`, `web/package.json` | config | — | Greenfield Next.js app |

For all of the above, RESEARCH.md's Architecture Patterns section (Pattern 1-3), Code Examples, and Recommended Project Structure are the primary source of truth — this repo has no prior JS/TS/React code to pattern-match against.

## Metadata

**Analog search scope:** `crates/pv-core/src/`, `crates/pv-server/src/`, workspace root `Cargo.toml`, `crates/pv-core/Cargo.toml`, `crates/pv-server/Cargo.toml`
**Files scanned:** `lib.rs`, `keys.rs`, `kdf.rs`, `items.rs`, `prf.rs`, `error.rs` (pv-core, full reads); `main.rs` (pv-server, partial read, lines 1-40); both crate manifests and workspace root `Cargo.toml` (full reads)
**Pattern extraction date:** 2026-07-12
