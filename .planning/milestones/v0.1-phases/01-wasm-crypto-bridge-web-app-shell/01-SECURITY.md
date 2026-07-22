---
phase: 1
slug: wasm-crypto-bridge-web-app-shell
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-12
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| WASM linear memory ↔ JS heap | wasm-bindgen FFI boundary — every `pv-wasm` public function is a crossing point | Key material (must stay WASM-side), ciphertext, salts |
| Local build ↔ crates.io (`wasm-bindgen-cli`) | Supply-chain trust for the build CLI | Build tooling |
| npm registry ↔ local install | Supply-chain trust for `next`/`tailwindcss`/`daisyui`/`lucide-react` | Build/runtime JS |
| Font loading ↔ third-party CDN | Visitor-IP leak risk if fonts not self-hosted | Visitor metadata |
| Browser JS ↔ WASM via `lib/crypto/` | Intended sole crossing point for all crypto | Handles, ciphertext, non-secret status |
| Self-test UI ↔ crypto results | Careless render could leak secrets to DOM/console | Step status/detail strings |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Information Disclosure | `crates/pv-wasm/src/lib.rs` public API | high | mitigate | Opaque `#[wasm_bindgen]` struct handles only; no key-byte `Vec<u8>` returns (only non-secret `randomSalt`); verified by 01-VERIFICATION.md and code review (CR-01/CR-02 fixes added `.free()` on all paths + password-buffer zeroization) | closed |
| T-01-02 | Tampering | `scripts/build-wasm.sh` / wasm-bindgen crate↔CLI | medium | mitigate | Exact `=0.2.126` pin single-sourced from `crates/pv-wasm/Cargo.toml`, parsed by the build script; mismatch fails loudly (verified in 01-VERIFICATION.md) | closed |
| T-01-SC | Tampering | `cargo install wasm-bindgen-cli` supply chain | low | accept | Verified OK in RESEARCH.md legitimacy audit (8.3M dl/wk, canonical org); exact pin prevents silent drift — accepted risk | closed |
| T-02-SC | Tampering | npm install of next/tailwindcss/daisyui/lucide-react | high | mitigate | Blocking-human checkpoint (plan 01-02 Task 1) — user verified all four on npmjs.com and approved 2026-07-12 | closed |
| T-02-01 | Information Disclosure | Font loading (`layout.tsx`) | low | mitigate | `next/font/google` self-hosts at build time; grep confirms zero `fonts.googleapis`/`fonts.gstatic` references in `web/src` | closed |
| T-02-02 | Tampering | `globals.css` theme config surface | low | accept | Cosmetic-only failure mode; caught at 01-03 visual checkpoint — accepted risk | closed |
| T-03-01 | Information Disclosure | Any file importing wasm bindings outside `lib/crypto/` | high | mitigate | Standing grep audit: `grep -rl "from './wasm'" web/src` returns exactly `web/src/lib/crypto/index.ts` (re-verified this audit) | closed |
| T-03-02 | Information Disclosure | `SelfTestCard`/`StepRow` detail/error rendering | medium | mitigate | `runSelfTest()` emits only non-secret ciphertext prefixes/error strings; no handle ever passed to string/template/console (verified by code review iterations 1–3) | closed |
| T-03-03 | DoS (self, UX-only) | `SelfTestCard` mount lifecycle | low | mitigate | Per-step try/catch + rendered error state; WR-04 fix added per-invocation `runIdRef` guard against Strict Mode remount races | closed |

---

## Accepted Risks

| Threat ID | Risk | Rationale | Accepted By | Date |
|-----------|------|-----------|-------------|------|
| T-01-SC | Compromised future wasm-bindgen-cli release | Exact-version pin + registry legitimacy audit; drift impossible without an explicit pin change in review | plan-time threat model (autonomous run) | 2026-07-12 |
| T-02-02 | Theme tokens misplaced → wrong colors | Cosmetic only; human visual checkpoint catches it | plan-time threat model (autonomous run) | 2026-07-12 |

---

## Audit Trail

| Date | Event | Result |
|------|-------|--------|
| 2026-07-12 | Retroactive mitigation audit (secure-phase, ASVS L1) | 9/9 threats closed (7 mitigated + verified, 2 accepted); 0 open at/above block threshold (high) |
| 2026-07-12 | Supporting evidence | 01-VERIFICATION.md (passed 4/4), 01-REVIEW.md (status clean after 2 fix iterations), plan 01-02 Task 1 human npm gate approved, plan 01-03 Task 3 human browser gate approved |
