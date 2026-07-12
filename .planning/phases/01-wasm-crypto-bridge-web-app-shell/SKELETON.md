# Walking Skeleton — Passkey Vault

**Phase:** 1
**Generated:** 2026-07-12

## Capability Proven End-to-End

A developer loads the themed web app in a browser and watches a real crypto round trip (derive → wrap → unwrap → encrypt → decrypt) execute entirely inside the pv-core WASM module — no server, no mocks — with per-step pass/fail rendered in the Self-Test Card and a working dark/light theme toggle.

> Note: this phase's "end-to-end" is browser UI → `lib/crypto/` facade → WASM pv-core round-trip, per the phase goal. There is deliberately no DB write and no deployment in this skeleton — pv-server is untouched (Phase 2 wires auth/vault APIs; Phase 7 packages deployment).

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | Next.js 16 (App Router), `output: "export"` static-only | Zero-knowledge constraint forbids SSR/API routes (Node layer must never see plaintext); 16 is the current stable line, static export sidesteps its breaking changes (CONTEXT.md locked) |
| Crypto boundary | New thin `crates/pv-wasm` crate wrapping pure `pv-core`; keys cross as opaque `#[wasm_bindgen]` handles (`WasmUserKey`, `WasmWrappingKey`), never raw bytes | pv-core stays auditable/pure; opaque handles satisfy "no raw key bytes across the boundary" by construction; JS-heap copies of secrets are un-zeroizable (RESEARCH.md Pitfall 3) |
| WASM build pipeline | `scripts/build-wasm.sh`: cargo → `wasm-bindgen --target web` (CLI version parsed from pv-wasm's exact `=0.2.126` pin) → JS glue into `web/src/lib/crypto/wasm/` (gitignored), binary into `web/public/wasm/` (gitignored); wired via npm `prebuild`/`predev` | Single-sourced version pin prevents crate/CLI schema drift; the binary-as-static-asset split + explicit `init('/wasm/pv_wasm_bg.wasm')` is the Turbopack-safe pattern (RESEARCH.md Pitfall 1) |
| Crypto choke point | `web/src/lib/crypto/index.ts` is the SOLE importer of the wasm bindings; `initCrypto()` singleton + typed async wrappers | Grep-auditable single-importer rule is the phase's own success criterion; every later phase calls crypto only through this facade |
| RNG | `getrandom` 0.2 with `js` feature (corrected during plan verification); salts/nonces generated inside WASM; build script runs a `cargo tree -i getrandom` duplicate-major audit | Duplicate-major getrandom is the top runtime-panic pitfall (CONTEXT.md locked) |
| Styling/theming | Tailwind v4 + DaisyUI 5 CSS-first themes `vault-dark` (default) / `vault-light`, exact OKLCH tokens from docs/UI-DESIGN.md §5; theme persisted in `localStorage['pv-theme']`, initial value via inline pre-hydration script | datafa.st aesthetic is a product constraint; CSS-first is the only config surface DaisyUI 5 reads; pre-hydration script prevents FOUC |
| Fonts | `next/font`: DM Sans (`--font-sans`), Fuzzy Bubbles 400 (`--font-hand`, annotations only — never security UI), `ui-monospace` for key/hex output | Self-hosted at build time (no CDN IP leak — privacy-positioned product); playfulness banned from security-relevant output |
| Icons | `lucide-react` | UI-SPEC autonomous pick; MIT, tree-shakeable, line-icon style fits datafa.st |
| Data layer | None this phase (pv-server untouched; SQLite/SQLx already scaffolded for Phase 2) | Phase goal is the client-side crypto boundary; first real DB read/write lands with Phase 2's auth+vault slice |
| Auth | None this phase | Password auth is Phase 2; passkey enrollment Phase 3; PRF unlock Phase 4 |
| Deployment target | Local dev only: `cd web && npm run dev` (predev builds WASM automatically) | Single-container Docker packaging is deliberately Phase 7 (roadmap decision) |
| Directory layout | `crates/{pv-core,pv-wasm,pv-server}` Rust workspace; `web/` (Next.js) sibling at repo root; `scripts/` for build tooling; `web/src/{app,components/{shell,self-test},lib/crypto}` | CONTEXT.md locked; mirrors the eventual extension client consuming the same pv-core WASM |
| Package manager | npm | CONTEXT.md locked |
| Test runners | `cargo test` (native round-trip tests in pv-wasm/pv-core) + vitest with jsdom (facade tests in `web/`) | Nyquist rule: the WASM round trip is proven natively before any browser code exists; facade behavior unit-tested with mocked bindings |

## Stack Touched in Phase 1

- [x] Project scaffold (Next.js 16 app, TypeScript, Tailwind v4 + DaisyUI 5, vitest) — plan 01-02
- [x] Routing — home route (`web/src/app/page.tsx`) rendering the full shell — plans 01-02/01-03
- [ ] Database — deliberately none this phase (see note above; Phase 2 does first real read+write)
- [x] UI — two real interactions wired: theme toggle (persists to localStorage) and self-test re-run ("Uruchom ponownie") driving actual WASM calls — plan 01-03
- [x] Deployment — documented local full-stack run: `cd web && npm run dev` (predev runs `scripts/build-wasm.sh`, rebuilding pv-wasm) — plans 01-01/01-02

## Out of Scope (Deferred to Later Slices)

- Any server interaction (pv-server untouched beyond workspace membership) — Phase 2
- Registration, login, sessions, vault items, folders/tags, search, password generator — Phase 2
- Passkey enrollment, PRF, settings screens — Phases 3–4
- Sync, import/export, TOTP, onboarding — Phases 5–6
- Docker packaging, axum `ServeDir` of the static export, RP_ID validation — Phase 7
- Product name + logo (placeholder wordmark acceptable — CONTEXT.md deferred)
- RustCrypto version bumps (`chacha20poly1305` 0.10→0.11, `hkdf` 0.12→0.13) — CONTEXT.md deferred idea, standalone task in a later plan set
- Web e2e/browser-automation test framework (Playwright) — self-test card is this phase's verification surface

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: register + log in with master password, full encrypted vault CRUD (first server slice, first DB read/write)
- Phase 3: enroll PRF passkey, manage passkeys/sessions (recovery invariant server-enforced)
- Phase 4: one-gesture passkey login + PRF vault unlock, honest non-PRF fallback
- Phase 5: multi-device sync (revision-gated pull + metadata-only WS push)
- Phase 6: import/export, TOTP, onboarding
- Phase 7: single-container Docker packaging + self-host deployment hardening
