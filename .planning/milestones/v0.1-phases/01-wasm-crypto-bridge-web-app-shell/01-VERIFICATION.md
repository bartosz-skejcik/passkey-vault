---
phase: 01-wasm-crypto-bridge-web-app-shell
verified: 2026-07-12T22:12:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 1: WASM Crypto Bridge & Web App Shell Verification Report

**Phase Goal:** The web app can load `pv-core`'s crypto entirely inside a WASM boundary, inside a themed shell that later phases build features into
**Verified:** 2026-07-12T22:12:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth (ROADMAP Success Criterion) | Status | Evidence |
| --- | --------------------------------- | ------ | -------- |
| 1 | Running the Next.js app shows the datafa.st-themed shell (dark default, full light-mode support) — no functional screens beyond a crypto self-test | ✓ VERIFIED | `globals.css` defines both `vault-dark` (`default: true`, `color-scheme: dark`) and `vault-light` DaisyUI 5 CSS-first themes with the exact UI-DESIGN.md §5 OKLCH tokens; pre-hydration `<script>` in `layout.tsx` resolves theme before paint (no `useEffect` sets `data-theme`); `page.tsx` composes `Sidebar`/`TopBar`/`MainColumn` with only inert stubs (`aria-disabled`/`disabled`) + `SelfTestCard`; `npm run build` exit 0, `out/_next/static/chunks/*.css` contains compiled `vault-dark`/`#e16540` tokens, `out/index.html` contains `pv-theme` (×2) + "Crypto Self-Test". Browser round trip (dark default, full light switch + reload persistence, clean console) human-verified & approved in Task 3 (01-03). |
| 2 | pv-core compiles to WASM via a version-pinned wasm-bindgen/wasm-bindgen-cli build step wired into the app build | ✓ VERIFIED | `crates/pv-wasm` is workspace member; `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` exit 0; `build-wasm.sh` single-sources the `=0.2.126` pin from `pv-wasm/Cargo.toml` (no duplicate literal), installs matching `wasm-bindgen-cli`, runs getrandom duplicate-major audit (reported single `v0.2`); `web/package.json` `prebuild`/`predev` invoke `../scripts/build-wasm.sh` — confirmed running in the `npm run build` log. |
| 3 | A demoable round-trip (derive → wrap → unwrap → encrypt+decrypt) succeeds entirely inside `lib/crypto/`, the sole module importing the WASM bindings | ✓ VERIFIED | Native `cargo test -p pv-core -p pv-wasm` = 10 pass incl. `pv_wasm::tests::full_roundtrip` + `wrong_password_fails_to_unwrap`; `runSelfTest()` executes the 5 ordered steps via the facade; `npm test` = 4/4 vitest (memoization, rejection, 5-step happy path, partial-failure); generated glue exports exactly match facade imports (`WasmWrappingKey`, `WasmUserKey`, `wrapUserKey`, `unwrapUserKey`, `encryptItem`, `decryptItem`, `defaultKdfParamsJson`, `randomSalt`); browser 5/5 green human-verified in Task 3. |
| 4 | No raw key bytes are ever returned across the WASM boundary more than once per operation (grep-auditable: only `lib/crypto/` imports the wasm package) | ✓ VERIFIED | `grep -rl "from ['\"]\./wasm" web/src` returns only `web/src/lib/crypto/index.ts`; `Vec<u8>` audit on `pv-wasm/src/lib.rs` finds no `pub fn` returning raw bytes except sanctioned non-secret `randomSalt`; `WasmWrappingKey`/`WasmUserKey` are opaque handles with no byte-exposing method; `.d.ts` confirms every key-bearing function returns handles or ciphertext/JSON strings. |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `crates/pv-wasm/Cargo.toml` | New member, wasm-bindgen `=0.2.126`, wasm32-only getrandom `js` | ✓ VERIFIED | Exact pin present; `[target.'cfg(target_arch="wasm32")']` getrandom 0.2 + `js` |
| `crates/pv-wasm/src/lib.rs` | Opaque handles + 7 exported fns + `randomSalt` | ✓ VERIFIED | All present; native round-trip + wrong-key tests pass |
| `crates/pv-core/src/keys.rs` | `random_bytes(len)` helper | ✓ VERIFIED | `pub fn random_bytes` at line 53; unit tests pass |
| `scripts/build-wasm.sh` | Reproducible, single-sourced pin, getrandom audit, 2-dir split, sed neutralization | ✓ VERIFIED | Runs exit 0; produces glue + binary in correct dirs; sed replaces dead `new URL` branch (0 remaining) |
| `web/package.json` | dev/build/prebuild/predev/test scripts, pinned deps | ✓ VERIFIED | prebuild/predev call build-wasm.sh; build exit 0 |
| `web/next.config.ts` | `output: "export"` | ✓ VERIFIED | Present line 4; static export produced `web/out/` |
| `web/src/app/globals.css` | vault-dark + vault-light exact tokens | ✓ VERIFIED | Both `@plugin "daisyui/theme"` blocks; no tailwind.config.js |
| `web/src/app/layout.tsx` | next/font + pre-hydration theme script | ✓ VERIFIED | DM Sans + Fuzzy Bubbles; inline `<script>`, zero `useEffect` |
| `web/postcss.config.mjs` | Tailwind v4 PostCSS pipeline | ✓ VERIFIED | `@tailwindcss/postcss` plugin; compiled CSS confirmed in output |
| `web/src/lib/crypto/index.ts` | initCrypto() + runSelfTest(), sole wasm importer | ✓ VERIFIED | Singleton init w/ explicit path; 5-step self-test; only importer |
| `web/src/lib/crypto/index.test.ts` | Facade vitest coverage | ✓ VERIFIED | 4 cases pass |
| `web/src/components/shell/{Sidebar,TopBar,MainColumn}.tsx` | Shell surfaces | ✓ VERIFIED | Substantive; theme toggle writes pv-theme; inert stubs documented |
| `web/src/components/self-test/{SelfTestCard,StepRow}.tsx` | Live self-test UI | ✓ VERIFIED | Calls real facade on mount; Check/X status; verbatim error state |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `Cargo.toml` workspace | `crates/pv-wasm` | members array | ✓ WIRED | Third member alongside pv-core/pv-server |
| `build-wasm.sh` | `pv-wasm/Cargo.toml` | grep/sed version parse | ✓ WIRED | Parses `=0.2.126`, no duplicate literal |
| `web/package.json` prebuild/predev | `scripts/build-wasm.sh` | `bash ../scripts/build-wasm.sh` | ✓ WIRED | Ran in build log, produced binary |
| `lib/crypto/index.ts` | generated `./wasm/pv_wasm.js` | named imports | ✓ WIRED | Import names ≡ glue `js_name` exports (verified) |
| `initCrypto()` | `web/public/wasm/pv_wasm_bg.wasm` | `init('/wasm/pv_wasm_bg.wasm')` | ✓ WIRED | Explicit path matches binary location; served in `out/wasm/` |
| `layout.tsx` script ↔ `globals.css` | data-theme values | vault-dark/vault-light | ✓ WIRED | Names match; Sidebar toggle writes same pv-theme key |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Native crypto round-trip | `cargo test -p pv-core -p pv-wasm` | 10 passed (incl. full_roundtrip, wrong_password_fails) | ✓ PASS |
| wasm32 compilation | `cargo build -p pv-wasm --target wasm32-unknown-unknown --release` | exit 0 | ✓ PASS |
| Reproducible WASM build | `bash scripts/build-wasm.sh` | exit 0; glue+binary in correct dirs; single getrandom major | ✓ PASS |
| Facade unit tests | `cd web && npm test` | 4/4 passed | ✓ PASS |
| Static export build | `cd web && npm run build` | exit 0; out/index.html + out/wasm/pv_wasm_bg.wasm + compiled theme CSS | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| UI-01 | 01-01, 01-02, 01-03 | Next.js 16 static-export app, datafa.st theme (dark default + full light), all crypto through a choke-point module importing pv-core WASM | ✓ SATISFIED | All four ROADMAP success criteria verified above; REQUIREMENTS.md maps UI-01 → Phase 1 (marked Complete). No orphaned requirements for this phase. |

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX` debt markers, no `TODO`/`HACK`/`not yet implemented`/`coming soon` in phase source files. Shell stubs (search input, "+ Nowy item" button, Vault/Foldery/Tagi nav) are intentional, documented, `disabled`/`aria-disabled` inert placeholders explicitly scoped to Phase 2 per UI-SPEC — not undocumented debt.

### Human Verification Required

None outstanding. The Task 3 browser checkpoint (01-03) — dark default with coral accents, full-surface light-theme switch persisting across reload, 5/5 live self-test green, re-run stays green, zero console errors — was walked and explicitly approved by the user during execution. That gate covers every residual visual/runtime behavior; no genuinely uncovered item remains.

### Gaps Summary

No gaps. All four ROADMAP success criteria are observably true in the codebase, re-confirmed by re-running every automated check (cargo test, wasm32 build, build-wasm.sh, npm test, npm run build) after the post-review fix commits rather than trusting SUMMARY claims. The WASM boundary is real and isolated to `lib/crypto/index.ts`; key material never crosses as raw bytes; the themed shell builds and renders with compiled tokens; the demoable derive→wrap→unwrap→encrypt→decrypt round trip passes natively, in the facade unit tests, and (per the approved human checkpoint) in a live browser against the real compiled module.

---

_Verified: 2026-07-12T22:12:00Z_
_Verifier: Claude (gsd-verifier)_
