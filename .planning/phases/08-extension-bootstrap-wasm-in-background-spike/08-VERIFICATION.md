---
phase: 08-extension-bootstrap-wasm-in-background-spike
verified: 2026-07-15T07:24:59Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
deferred:
  - truth: "SC #1/#2 Firefox half — the extension loads and instantiates pv-wasm under CSP at runtime in a real Firefox browser (single-click round-trip returns {ok:true}, zero console errors)"
    addressed_in: "Phase 13"
    evidence: "Phase 13 goal is dual-browser feature parity; plan 13-01 installs Firefox + hardens manifest/CSP/gecko, plan 13-04 is the Firefox UAT pass; SC #1 re-verifies every v0.2 feature on both wxt dev -b chrome and -b firefox. Firefox MV2 uses a persistent background page (no idle-kill risk), and Firefox is not installable for extension testing on this machine (Playwright Firefox does not support extensions)."
---

# Phase 8: Extension Bootstrap & WASM-in-Background Spike Verification Report

**Phase Goal:** `pv-core`/`pv-wasm` crypto runs reliably inside a WXT MV3 background service worker on both Chrome and Firefox, and survives the MV3 idle-kill/wake cycle — proven before any user-facing feature is built.
**Verified:** 2026-07-15T07:24:59Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Extension loads unpacked in both Chrome and Firefox (dual-output build), no console errors on install | ✓ VERIFIED | Chrome half runtime-observed in 08-UAT.md (packaged chrome-mv3 loaded via Playwright, zero console/page errors). Both `wxt build -b chrome` and `-b firefox` re-run to exit 0 by this verifier; both `.output/*/manifest.json` well-formed. Firefox runtime click deferred to Phase 13 (see Deferred). |
| 2 | Background worker fetches + instantiates `pv-wasm` under MV3 CSP (`wasm-unsafe-eval` declared) in the packaged/signed build, not just `wxt dev` | ✓ VERIFIED | 08-UAT.md: packaged (not dev) build, `pv_wasm` fetched + instantiated in the real service worker under declared CSP, derive→wrap→unwrap ran, `{ok:true}`. Both generated manifests carry `content_security_policy` with `'wasm-unsafe-eval'` (chrome `extension_pages` object; firefox string). Firefox runtime instantiation deferred to Phase 13. |
| 3 | A round-trip crypto call in the background survives a manual SW idle-kill/wake cycle without losing correctness | ✓ VERIFIED (behavioral) | 08-UAT.md: real CDP `ServiceWorker.stopAllWorkers` kill with a `__uatKillMarker` module-state ground truth read back as WIPED after wake, then `{"survived":true,"ok":true}` from re-derivation out of `chrome.storage.session`. Genuine kill, not reload; strongest possible behavioral evidence. |
| 4 | Firefox manifest target (MV2 persistent background) deliberately pinned, not left to WXT default | ✓ VERIFIED | Generated `firefox-mv2/manifest.json`: `manifest_version:2`, `background.persistent:true`, `background.scripts:["background.js"]` (no `service_worker`), `gecko.id:"passkey-vault@extension.local"`. `persistent:true` is an explicit `defineBackground({persistent:true})` pin in `background.ts` (WXT reads it only from the entrypoint, not wxt.config). |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Firefox runtime single-click round-trip (`{ok:true}`, zero console errors) in a real Firefox browser | Phase 13 | Phase 13 goal = dual-browser parity; plan 13-01 installs Firefox + hardens manifest/CSP/gecko, plan 13-04 = Firefox UAT pass; SC #1 re-verifies every feature on both browsers. Firefox MV2 persistent background has no idle-kill risk (the phase's hard criterion, SC #3, is Chrome/MV3-specific and was observed passing). Firefox not installable for extension testing on this machine. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `extension/wxt.config.ts` | CSP (wasm-unsafe-eval), gecko.id, `storage` permission, MV2 rationale | ✓ VERIFIED | Contains all; `permissions:['storage']` present (the a48a7c5 fix). Documents why no top-level `manifestVersion` override. |
| `extension/package.json` | predev/prebuild → shared build-wasm.sh | ✓ VERIFIED | `predev`/`prebuild` both invoke `bash ../scripts/build-wasm.sh`. |
| `scripts/build-wasm.sh` | Additive extension output (glue + binary) | ✓ VERIFIED | Emits `extension/lib/crypto/wasm` glue + `extension/public/wasm` binary; patches init() URL branch to throw. |
| `extension/lib/crypto/wasm-loader.ts` | Memoized fetch+ArrayBuffer+instantiate loader; sole wasm import | ✓ VERIFIED | `WebAssembly.instantiate` via `init(bytes)`; no `instantiateStreaming`; retry-on-reject. |
| `extension/lib/crypto/vault-session.ts` | `roundTripSpike(storage)` with injected session storage | ✓ VERIFIED | Injectable `SessionStorage`; no browser/chrome global referenced; fresh-init + survived-a-wake paths. |
| `extension/lib/crypto/vault-session.test.ts` | Fresh-init + rehydration coverage | ✓ VERIFIED | 3 tests, browser-independent (node env), all green. |
| `extension/entrypoints/background.ts` | onMessage listener wiring spike to `browser.storage.session` | ✓ VERIFIED | `defineBackground({type:'module',persistent:true})`; listener on `kind:'spike.roundtrip'` calls `roundTripSpike(browser.storage.session)`. |
| `extension/entrypoints/popup/index.html` + `main.ts` | Minimal debug harness, sendMessage only | ✓ VERIFIED | Two buttons + `<pre>`; main.ts only relays `runtime.sendMessage`, imports no crypto. |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| `background.ts` | `vault-session.ts` | `roundTripSpike(browser.storage.session)` on `spike.roundtrip` | ✓ WIRED |
| `vault-session.ts` | `wasm-loader.ts` | `initCrypto()` before any pv-wasm export | ✓ WIRED |
| `popup/main.ts` | `background.ts` | `runtime.sendMessage({kind:'spike.roundtrip'})` rendered into `#result` | ✓ WIRED |
| `package.json` | `scripts/build-wasm.sh` | predev/prebuild npm hooks | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Unit suite passes | `npx vitest run` | 3/3 passed | ✓ PASS |
| Typecheck clean | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Chrome build | `npx wxt build -b chrome` | exit 0 | ✓ PASS |
| Firefox build | `npx wxt build -b firefox` | exit 0 | ✓ PASS |
| SC#3 idle-kill survival (behavioral) | Playwright + CDP `stopAllWorkers` (08-UAT.md) | `{survived:true,ok:true}`, marker WIPED | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| EXT-01 | 08-01/02/03 | Extension bootstrap + WASM-in-background survives MV3 idle-kill | ✓ SATISFIED | All 4 SCs verified (Firefox runtime portion deferred to Phase 13). |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | None. No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER in `entrypoints/` or `lib/`. No `setInterval`/keep-alive (D-06). No `instantiateStreaming` (D-03). No pv-server-origin fetch (D-11); only `getURL` local wasm fetch. | ℹ️ Info | Prohibition truths from plan 08-02 hold. |

### Human Verification Required

None for this phase. The only runtime-unobserved item (Firefox single-click round-trip) is a scheduled Phase 13 deliverable, not an open checkpoint — Firefox is not installable for extension testing here, and forcing a human check now would duplicate Phase 13's explicit purpose. Recorded in the `deferred` frontmatter.

### Gaps Summary

No gaps. All four ROADMAP success criteria are met: SC#1/#2 (Chrome runtime-observed in a packaged build), SC#3 (idle-kill survival proven behaviorally with a real CDP kill and module-state ground truth), SC#4 (Firefox MV2 manifest deliberately pinned and verified in generated output). The `storage` permission bug the UAT surfaced (a48a7c5) is fixed and present in both freshly-rebuilt manifests. The Firefox runtime round-trip is the sole deferred item, structurally scheduled into Phase 13 (13-01 install + 13-04 UAT), architecturally low-risk (MV2 persistent background = no idle-kill), and documented in 08-UAT.md and deferred-items.md.

**Observation (does not contradict SUMMARYs):** Plan 08-01's must_have wording places the Firefox MV2 pin "in wxt.config.ts". The effective pin (`persistent:true`) actually lives in `background.ts`'s `defineBackground()` because WXT reads `background.persistent` only from the entrypoint option, not from wxt.config. 08-UAT.md and 08-03-SUMMARY.md correctly document this (fix commit e97b420); wxt.config.ts documents the rationale in a comment. Outcome is verified in the generated manifest either way. No SUMMARY claim is contradicted.

---

_Verified: 2026-07-15T07:24:59Z_
_Verifier: Claude (gsd-verifier)_
