# v0.3 Codebase Gaps & Latent Risks — Sweep for Polish & Hardening

**Date:** 2026-07-20
**Scope:** Rust `pv-server`/`pv-core`/`pv-provider`, WXT MV3/MV2 extension, Next.js web app.
**Method:** Direct code reads of the CORS layer, the three relay/bridge files, the MAIN-world audit script, the Firefox Xray debug record; grep sweeps for sensitive logging / swallowed errors / panics; parallel sub-agent sweeps of `.planning/**` deferred+review docs, the dependency graph, and test-coverage blind spots. Every claim below was verified against code, not the planning prose alone.

**The meta-lesson this sweep applies:** v0.2's green suites hid seven real bug classes because fixtures were "too polite" (localhost / no CSP / `Uint8Array`-only / assert `.ok` not bytes / jsdom has no Xray wrappers). So findings are weighted toward *what a passing CI still cannot see*.

---

## TOP 5 — MUST-FIX / MUST-DECIDE IN v0.3

1. **[Critical] RESPONSE-direction Firefox Xray hole is open, un-root-caused, and has NO passing regression gate.** `decodeCredentialResponseJson` (content-relay.content.ts:609) builds real ArrayBuffers in the ISOLATED realm; after `shapeCredential` posts them back to the page (MAIN world) on Firefox, `credential.rawId instanceof ArrayBuffer === false` (data intact, contract violated). A real RP library that branches on `instanceof` mishandles a valid credential. `probe-request-xray.cjs:52-56` **deliberately does not assert** this because it is known-failing. **The only tracking doc — `.planning/debug/firefox-request-xray-hole.md` — is UNTRACKED in git and not mirrored into STATE.md**, so the follow-up can be lost. → Fix now (dedicated debug session) + git-track the record.

2. **[Critical] The provider ceremony is never verified by a real relying party — mocks all the way down.** `create_provider_credential` / `get_provider_assertion` (`pv-provider/src/ceremony.rs`) are asserted only for JSON *shape* (`id`/`type`/`prf.enabled`) in `pv-provider/src/lib.rs`; the background tests fully mock the WASM calls; the only browser run (`run-core.cjs`) drives a localhost fixture RP that never verifies the signature (`result.ok && result.id`). **No test ever feeds a provider-produced assertion into an independent verifier** (`webauthn-rs`, already a server dep) to confirm the signature verifies over the challenge. The `id` field (a spec `String`) is exactly what stayed green through the entire v0.2 serialization bug. → Fix now: add a Rust integration test that round-trips provider output through `webauthn-rs` registration+authentication.

3. **[Warning] There is no CI at all, and the real-Firefox probes that catch the "impolite" bugs are manual — two unreachable from any npm script.** No `.github/workflows/`. `probe-request-xray.cjs` and `probe-provider-corruption.cjs` are labelled "kept PERMANENTLY" yet are wired to no `package.json` script; the CSP-strict rows only run on a hand-typed `npm run test:e2e:firefox:core`. Also: the Rust byte-serialization root cause (the `serialize_bytes_as_base64_string` feature) has no unit-test gate, so dropping it again keeps every Rust test green. → Add a CI workflow (even manual-dispatch) running the Firefox `.cjs` suite; wire the two orphan probes; add a real-bytes base64url assertion in `pv-provider/src/lib.rs`.

4. **[Warning] CORS: `Allow-Headers: *` misses `Authorization` on Firefox, plus the accepted `moz-extension://*` wildcard.** `build_cors_layer()` uses `.allow_headers(Any)` (mod.rs:153,160) → emits `*`; the extension sends `Authorization: Bearer <token>` (auth-api.ts:83), which Firefox does not treat as covered by `*`. The `moz-extension://*` predicate (mod.rs:150-152, D-10) is knowingly accepted (CORS is not the auth boundary). → Harden both at the next CORS touch: enumerate `Authorization`+`Content-Type`; plan per-install concrete origins.

5. **[Warning] Supply-chain watch items with no automated tripwire.** `webauthn-rs 0.5.5` transitively ships native **OpenSSL 0.10.81** in the server container; **passkey-rs 0.5.0** (1Password) signs live assertions and is the least-maintained crypto surface; three parallel `rand`/`getrandom` stacks compiled in. No `cargo audit`/`cargo deny` in CI. → Add `cargo audit`/`cargo deny` gate; pin the `stable` toolchain to an exact version.

---

## SECURITY / ZERO-KNOWLEDGE BOUNDARY

### Confirmed clean (verified, not assumed)
- **No sensitive-material logging.** Grep of every `console.*` in `entrypoints/`+`lib/` and every `tracing::*` in the crates found no PRF output, User Key, session token, password, or plaintext logged. The one passkey-adjacent server log (`passkeys.rs:270`) logs only the opaque webauthn error `e`.
- **Relay channels are origin-pinned, source-checked, single-use-nonce'd.** Both the provider bridge (`handleProviderPageMessage`, content-relay.content.ts:764) and the ext-unlock bridge (`handleExtUnlockBridgeMessage`, :1154) check `event.source === window && event.origin === location.origin`, validate envelope shape, and consume a single-use nonce. Provider nonce: 30 s TTL + prune (`seenNonces`, :391); ext-unlock nonce: per-injection Set + background-side single-use record. Response `postMessage` target is always `location.origin`, never `*` (:678, :694, :1148).
- **No `allow_credentials(true)` on the CORS layer** — bearer-token model, no cookies, so the wildcard-origin predicate cannot be leveraged for credentialed cross-origin reads.
- **The MAIN-world key-free invariant holds at source and (when built) at bundle level.** `audit-mainworld-boundary.sh` greps both page-bridge source files and the emitted bundles.

### Findings

| Sev | Item | file:line | Why a green suite misses it | v0.3 disposition |
|---|---|---|---|---|
| Warning | `Allow-Headers: *` ≠ `Authorization` on Firefox (see Top-5 #2) | `crates/pv-server/src/routes/mod.rs:153,160` | Tests hit the layer via `tower::oneshot` and only assert the `ACAO` header, never a Firefox preflight of `Authorization` | Fix: enumerate headers |
| Warning (accepted) | `moz-extension://*` wildcard predicate (D-10) | `mod.rs:150-152,168-186` | Unit tests confirm the predicate *works*; they don't question that a per-install UUID allowlist would be safer | Accept+document; plan concrete-origin config |
| Info | MAIN-world audit is grep-shallow — checks only the two source files + two hard-coded bundle globs, does not follow a future `import` of a runtime-bearing `lib/messaging/*` module transitively (IN-02, acknowledged) | `scripts/audit-mainworld-boundary.sh:49-50,80-84` | The script is the gate; nothing tests the gate's blind spot | Harden later: bundle-graph check or import-lint |
| Info | Bundle-level audit **silently skips** when no build output exists (exit 0 with only a WARN) | `audit-mainworld-boundary.sh:93-97` | CI that never runs `wxt build` first gets a green "PASS" that only checked source lines | Harden: make CI build before auditing, or fail if no bundle |
| Info | signin `accountEmail` persisted verbatim, not bound to the token's authenticated account (13-REVIEW-2 IN-01; trim landed, binding gap open) | `server-unlock.ts:352`, `ExtUnlockBridge.tsx:182` | Equal-trust model documented; no test asserts cross-account binding | Accept+document |
| Info | No rate limiting on `/api/auth/*`; no HTTPS enforcement/warning; last-passkey-deletion not guarded in app logic (v0.1-era CONCERNS.md, verify against current code) | `crates/pv-server/src/routes/auth.rs`, `config.rs` | No endpoint/abuse tests exist at all | Harden: verify current state first, then add |

---

## CROSS-REALM / FIREFOX HAZARDS

### Already fixed since the debug run (verified in code + git log — do NOT re-scope)
- **REQUEST-direction Xray hole: FIXED** (f90b21a). `isCrossRealmArrayBuffer` (content-relay.content.ts:456) + widened `isBufferSource` (:465) + `bufferSourceToB64Url` now branches on `ArrayBuffer.isView` (:482).
- **WR-01 `pvCeremonyInFlight` FF mirror: FIXED** (0a78bd7). Both shims now set the synchronous DOM marker (`page-bridge-firefox.ts:160`, `page-bridge.content.ts:201`). The earlier "not mirrored into FF" review note is stale.
- **IN-01 unguarded encode throw: FIXED** (6d6138c). `encodePublicKeyOptions` is now wrapped in try/catch that posts `fallthrough` and clears the DOM marker (content-relay.content.ts:798-805), closing the `toStringTag`-spoof RangeError wedge.

### Open

| Sev | Item | file:line | Why a green suite misses it | v0.3 disposition |
|---|---|---|---|---|
| **Critical** | RESPONSE-direction Xray hole (see Top-5 #1) — `rawId`/`response.*`/PRF `results.*` are `instanceof ArrayBuffer === false` in the real FF page realm; unexplained standalone-probe-vs-real-flow discrepancy | `content-relay.content.ts:609-658` (decode) → `page-bridge-firefox.ts:230` (`shapeCredential`) | Every e2e assertion checks `result.ok && result.id` (a spec `String`), never `credential.rawId instanceof ArrayBuffer`; `probe-request-xray.cjs:52-56` explicitly omits the gate as known-failing | **Fix now**: dedicated debug session; then flip the probe assertion to a gate |
| Warning | The RESPONSE-direction tracking record is **untracked in git** and absent from STATE.md Deferred Items | `.planning/debug/firefox-request-xray-hole.md` (status `awaiting_human_verify`, not in `resolved/`) | Not a code/test issue — a process gap that loses the only root-cause writeup | Fix now: git-track it + add a STATE.md deferred row |
| Info | Provider MAIN-world response is spoofable by a same-page script (self-harm only, no cross-boundary leak) — IN-03 | `page-bridge.content.ts` broker/response path | Documented as no cross-boundary vuln | Accept; `MessageChannel` port if defense-in-depth wanted |

---

## TEST-COVERAGE BLIND SPOTS

**Structural fact underlying everything: there is no CI.** No `.github/workflows/` exists — every real-Firefox probe runs only when someone hand-types the npm script, and two of the most important probes aren't wired to any script at all. So "green suite" in practice means `vitest run` + the Chrome playwright project; the entire real-Xray / real-CSP / real-serialization surface never executes unless invoked manually.

**Credit where due (verified):** bug classes 1 (self-hijack), 2 (failure-notice wedge), 3 (REQUEST-direction Xray), 5-JS-side (base64url), and 7 (general `instanceof` widening) each got a real, deterministic byte-or-behavior regression probe — `content-relay.test.ts`'s iframe cross-realm tests with byte-exact `Buffer.from(...,'base64url')` decode + a same-realm self-check that throws if the fixture regresses to a friendly realm are the template to reuse. The v0.2 lesson was largely internalized; the gaps below are what remains.

| Sev | Item | Where | Why green misses it | v0.3 disposition |
|---|---|---|---|---|
| **Critical** | No gating probe for the RESPONSE-direction Xray bug (class 4). `page-bridge.test.ts` + `content-relay.test.ts` response tests *do* assert `rawId instanceof ArrayBuffer` — but construct+check in the same jsdom realm, the one condition that can't reproduce a cross-realm break | `probe-request-xray.cjs:52-56` (gate omitted); `page-bridge.test.ts` "credential success"; `content-relay.content.ts:609` decode path | jsdom has no Xray wrappers; the real-FF probe deliberately doesn't assert it | Add (a) a jsdom cross-realm-iframe test on `decodeCredentialResponseJson` output, (b) promote the real-FF `rawId instanceof` to a gate once fixed |
| **Critical** | Provider ceremony never verified by a real RP (see Top-5 #2) — shape-only assertions + mocked WASM + non-verifying localhost fixture | `pv-provider/src/lib.rs` tests; `provider-ceremony.test.ts` (mocks); `run-core.cjs` (`result.ok && result.id`) | A self-consistent passkey-rs client loop passes even if the emitted signature would be rejected by a spec RP | Add a `webauthn-rs` round-trip integration test |
| Warning | Rust byte-serialization root cause (class 5) has no automated gate — dropping `serialize_bytes_as_base64_string` again keeps every Rust test green | `crates/pv-provider/Cargo.toml`; `pv-provider/src/lib.rs` asserts `id`/`type` only | No test inspects that `rawId`/`clientDataJSON` are base64url *strings* vs a JSON number array | Add a real-bytes base64url assertion (deterministic, no browser) |
| Warning | All real-FF probes are manual; `probe-request-xray.cjs` + `probe-provider-corruption.cjs` are wired to **no** npm script | `extension/package.json` scripts | `npm test` + Chrome playwright are the only routine runs; these never fire | Wire `test:e2e:firefox:probe-*` scripts + a CI workflow |
| Warning | Chrome e2e (`dual-browser.spec.ts`) uses localhost fixtures + CDP virtual authenticators only — no real verifying RP, no CSP header, no raw-`ArrayBuffer`, friendly `Uint8Array` challenges | `extension/e2e/dual-browser.spec.ts` | Virtual authenticators accept whatever the shim emits; P12-SC1/SC2 run with no authenticator at all | Accept for cross-realm (Chrome has no Xray), but add a CSP-header + raw-ArrayBuffer variant |
| Warning | Server has ~no endpoint/DB/WebAuthn-flow integration tests; crypto tests happy-path-only (v0.1-era CONCERNS.md — verify current state) | `crates/pv-server/src/routes/`, `pv-core` | Coverage counts pass while whole route families are untested | Harden: verify then add route+flow tests |
| Info | Pre-existing unhandled promise rejection in `App.test.tsx` via `ServerConfigView.tsx` (`browser.permissions.request` mock gap) — recurs Phases 10-13, suite still green | `entrypoints/popup/ServerConfigView.tsx:111`, `App.test.tsx` | Rejection is swallowed; suite reports pass | Fix now (trivial): add `permissions.request` to the mock |
| Info | Pre-existing `tsc --noEmit`: `vault-session.ts:184` TS2345 (real fix needed) + `wasm-loader.ts` TS2307/2769 (self-resolve once WASM built) | `entrypoints/background/vault-session.ts:184`, `lib/crypto/wasm-loader.ts` | Type errors don't fail the vitest run | Fix now: `vault-session.ts`; provision WASM in CI |
| Info | `router.test.ts` fails to load (missing-WASM + unmocked autofill-match imports); predates Phase 11 | `entrypoints/background/router.test.ts` | A non-loading test file is silently absent from the green count | Fix: install `wasm-bindgen-cli` in CI or mock |
| Info | `SerializablePasskey` hand-rolled DTO silently drops any future `passkey_types` field on round-trip (pin mitigates) — IN-04 | `crates/pv-provider/src/credential_store.rs:61-123` | No round-trip/field-count guard test | Harden: add a field-count round-trip test |
| Info | Full passkey SIGN-IN on Firefox un-automatable (geckodriver virtual-authenticator `NS_ERROR_NOT_IMPLEMENTED` + anti-enumeration dummy challenge) — closed by Bartek live UAT 2026-07-20 | `run-server-unlock.cjs` | By construction; human UAT is the only coverage | Accept (by-construction) |
| Info | CSP regression (class 6) guarded structurally in jsdom (source-grep that `injectPageBridgeFirefoxScript` uses `.src`, never `.text`/`fetch`), behaviorally only in real FF | `content-relay.test.ts`, `manifest-permissions.test.ts`, `run-core.cjs` CSP-STRICT | The jsdom guard is a grep, not a behavior | Accept (reasonable proxy; needs the CI wiring above) |

---

## TECH DEBT & CORRECTNESS

| Sev | Item | file:line | Note | v0.3 disposition |
|---|---|---|---|---|
| Info | WebAuthn sign-count **clone-detection signal is discarded**. `let _ = passkey.update_credential(&auth_result)` drops the `Option<bool>` that flags a counter regression. The mutated counter *is* persisted (verified: the passkey is re-serialized + `UPDATE`d right after), so this is signal-loss, not counter-loss. | `passkeys.rs:275,508`, `auth.rs:569` | Low risk (modern authenticators keep counter 0; assertion signature is the real gate), but a cloned-authenticator warning is silently dropped | Harden: log/act on `Some(false)` regression |
| Info | `sync_hub` mutex `.expect("… poisoned")` panics the handler task on poison | `crates/pv-server/src/routes/sync.rs:119,129,140` | A poisoned lock aborts that request; server survives | Accept or recover gracefully |
| Info | Silent file removes in test-DB teardown (`let _ = std::fs::remove_file`) | `crates/pv-server/src/lib.rs:112-114` | Test-only cleanup | Accept |
| Info | IMPEX-04: CSV export lossy for non-default TOTP (algorithm/digits/period/issuer dropped) | `web/.../toCsv.ts` | JSON export is lossless | Harden: widen CSV or note on dialog |
| Info | favicon `<img>` hard-codes `https://` regardless of stored scheme (http/LAN hosts show no favicon) — 13-REVIEW IN-01, documented | `ItemIconTile.tsx:114` | Intentional web-parity; silent fallback | Accept+document |
| Info | `centeredWindowPosition` passes negative `left`/`top` unclamped (browser clamps) | `lib/window-geometry.ts:59-62` | Harmless | Accept |
| Info | 3 open UI-review WARNINGs (light-theme base-300 borders; SelfTestCard fatal-branch retry; error-copy order) — labeled v0.2 polish candidates | STATE.md Deferred | Cosmetic | Polish in v0.3 |
| Info | `web/.env.local` `NEXT_PUBLIC_API_BASE_URL` breaks same-origin `web/out` fetch; routed around at build, not fixed | `web/.env.local` | Bartek action item | Fix now (config hygiene) |
| Info | FF `data_collection_permissions` required for new AMO listings from 2025-11-03 | `wxt.config.ts` | AMO submission-time only | Revisit pre-AMO |

---

## DEPENDENCY / SUPPLY-CHAIN

*(Full table in the sweep; headline items.)* No `*` constraints anywhere; core RustCrypto stack (`argon2 0.5.3`, `chacha20poly1305 0.10.1`, `hkdf 0.12.4`, `sha2 0.10.9`, `zeroize 1.9.0`, `subtle 2.6.1`) all current-patch and healthy.

| Sev | Item | Note | v0.3 disposition |
|---|---|---|---|
| Warning | Native **OpenSSL 0.10.81** ships in the server container via `webauthn-rs` → `webauthn-rs-core` | Real C-lib CVE surface for a security product; no automated tripwire | Add `cargo audit`/`cargo deny` to CI; track base-image openssl |
| Warning | **passkey-rs (1Password) 0.5.0** signs live assertions; slowest-moving crypto surface, single-maintainer | Confirm latest 0.5.x patch; subscribe to advisories | Monitor; consider external audit |
| Warning | Triple `rand`/`rand_core`/`getrandom` stacks (0.8/0.9/0.10; 0.2/0.3/0.4) compiled in | Upstream-blocked by webauthn-rs + passkey-rs; larger CSPRNG audit surface | Accept+document; recheck on next bump |
| Info | `rust-toolchain.toml` pins floating `stable`, not an exact version | Build drift across compiler releases | Pin exact version for reproducible builds |
| Info | `wxt ^0.20.27` — caret on a pre-1.0 build framework is the loosest extension pin | Runtime deps are otherwise mostly exact; no JS WebAuthn lib (crypto stays in audited Rust — positive) | Tighten to `~0.20.27` |
| Info | `webauthn-rs 0.5.x` will need a major bump as the spec evolves (conditional UI, transports, attestation) | Monitor changelog | Budget upgrade |

---

## Notes on stale review items (do not re-scope)
- 12-REVIEW CR-01/02/03 + WR-01..04 were all fixed in plans 12-05/12-06 (12-SECURITY: 17/17 threats closed).
- The three items the doc-sweep flagged "verify" (WR-01 FF mirror, IN-01 throw guard, REQUEST-direction Xray) are **confirmed landed** in commits 0a78bd7 / 6d6138c / f90b21a. Only the **RESPONSE-direction** hole remains genuinely open.
