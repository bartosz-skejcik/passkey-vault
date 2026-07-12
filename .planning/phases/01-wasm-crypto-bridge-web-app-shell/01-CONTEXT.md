# Phase 1: WASM Crypto Bridge & Web App Shell - Context

**Gathered:** 2026-07-12
**Status:** Ready for planning

<domain>
## Phase Boundary

The web app can load `pv-core`'s crypto entirely inside a WASM boundary, inside a datafa.st-themed shell that later phases build features into. Deliverables: (1) a version-pinned wasm-bindgen build of pv-core wired into the Next.js build, (2) a `lib/crypto/` choke-point module — the sole importer of the WASM package — exposing a typed TS facade, (3) the themed app shell (dark default, full light support), (4) a demoable crypto self-test screen running the full round-trip (derive → wrap → unwrap → encrypt → decrypt). No functional vault/auth screens — those are Phases 2–4.

</domain>

<decisions>
## Implementation Decisions

### WASM Boundary & Crypto API
- Bindings live in a new thin `crates/pv-wasm` crate wrapping pv-core — pv-core stays pure (no wasm-bindgen, no I/O) and auditable.
- Keys cross the boundary as opaque exported structs (e.g. `WasmUserKey`) — JS holds handles; raw key bytes stay in WASM linear memory, zeroized via explicit `free()`. Satisfies the "no raw key bytes returned across the boundary more than once per operation" success criterion by construction.
- RNG: `getrandom` with the `wasm_js` feature; salts/nonces generated inside WASM. Build script includes a `cargo tree -i getrandom` duplicate-major audit (research flags this as the top runtime-panic pitfall).
- TS facade: singleton `lib/crypto/` module with explicit `initCrypto()` (dynamic WASM import) + typed async wrappers. Only this module imports the wasm package — grep-auditable.

### Build Pipeline & Layout
- Next.js 16 (current stable; 15 is maintenance-only backport line). Static export (`output: "export"`) per UI-01 — 16's breaking changes don't apply under static export.
- Web app lives in `web/` at repo root (sibling of `crates/`).
- WASM build: `scripts/build-wasm.sh` — `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` → `wasm-bindgen --target web` → output into `web/src/lib/crypto/wasm/` (gitignored). Invoked from npm `prebuild`/`predev`. `wasm-bindgen` crate and `wasm-bindgen-cli` pinned to the identical version in one place (exact-match requirement).
- Package manager: npm.

### Shell UI & Self-Test
- Full dashboard skeleton per docs/UI-DESIGN.md §3: left sidebar (placeholder nav: vault/folders/tags + account block), top bar (search stub "⌘K", "+ Nowy item" stub), main column. Non-functional placeholders only.
- Theming: DaisyUI 5 custom themes `vault-dark` (default) + `vault-light` using the exact OKLCH tokens from docs/UI-DESIGN.md §5; manual toggle persisted in localStorage, initial value from system preference.
- Crypto self-test lives in the main column of the home route: a card running the full round-trip with per-step ✓/✗ status. This is the phase's demo.
- Fonts via `next/font`: DM Sans (`--font-sans`), Fuzzy Bubbles 400 (`--font-hand`, annotations only), `ui-monospace` for key/hex output.

### Claude's Discretion
- Exact pv-wasm exported function/struct names and TS type shapes.
- Self-test card visual details (within UI-DESIGN tokens; security-relevant output stays playfulness-free).
- Whether `wasm-bindgen` version pin lives in an env var, version file, or script constant — as long as it is single-sourced for crate + CLI.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `crates/pv-core` — complete crypto layer: `kdf.rs` (Argon2id + HKDF, `KdfParams`), `keys.rs` (`UserKey`, `WrappedKey`, AEAD seal/open), `items.rs` (per-item Cipher Key encrypt/decrypt), `prf.rs` (PRF → wrapping key), `error.rs` (`CryptoError`). No I/O — WASM-ready by design.
- `crates/pv-server` — axum skeleton with `/healthz`, prelogin stub; not touched this phase except workspace membership.
- Workspace `Cargo.toml` with `[workspace.dependencies]` — pv-wasm joins as third member.

### Established Patterns
- Zeroize/ZeroizeOnDrop on all key material; `expose()` as the single key-bytes access point.
- Versioned HKDF domain-separation constants (`b"pv:pw-unlock:v1"` etc.).
- Custom `CryptoError` enum; `map_err` conversions at boundaries.
- Comments mix Polish and English; module docs via `//!` with ASCII diagrams.

### Integration Points
- pv-wasm depends on pv-core only; exposes wasm-bindgen API mirroring pv-core operations.
- `web/src/lib/crypto/` imports generated bindings from `web/src/lib/crypto/wasm/` (gitignored build artifact).
- Research pins (2026-07-12): wasm-bindgen 0.2.126, getrandom 0.4.x (`wasm_js`), Next.js 16.2.x, Tailwind 4.3.x, DaisyUI 5.6.x. Verify current patches at plan time.

</code_context>

<specifics>
## Specific Ideas

- Theme must be the datafa.st reproduction from docs/UI-DESIGN.md — exact OKLCH values, 1px borders + surface steps instead of shadows, radius 16px cards / 8px fields / pill badges, `--btn-focus-scale: 0.95`.
- Warm hue rule: even greys carry the ~67° warm hue — nothing cold-blue.
- Passkey/passwordless accents = teal (#00CDB7) consistently.
- Fuzzy Bubbles + emoji only in onboarding/empty states/celebrations — never in security UI (self-test output is technical/legible).

</specifics>

<deferred>
## Deferred Ideas

- RustCrypto bumps (`chacha20poly1305` 0.10→0.11, `hkdf` 0.12→0.13) recommended by research as an early dedicated PR — belongs in Phase 1 or 2 planning as a standalone task, not decided here.
- Product name + logo (open question in UI-DESIGN §6) — not needed for shell; placeholder wordmark acceptable.

</deferred>
