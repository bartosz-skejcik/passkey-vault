# Phase 14: Critical Risk Closure — Cross-Realm Integrity & Real-RP Verification - Research

**Researched:** 2026-07-20
**Domain:** Firefox WebExtension cross-realm (Xray) postMessage semantics + independent cross-vendor WebAuthn RP verification (webauthn-rs vs. passkey-rs)
**Confidence:** MEDIUM — codebase mechanics and webauthn-rs 0.5 API are HIGH confidence (direct code read + Context7); the exact root-cause mechanism of the response-direction Xray discrepancy is MEDIUM/LOW confidence (candidate list, not a proven single cause) and must be empirically settled during execution per the phase's own "byte-level proof, verified live" bar.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**XBR-02 root-cause discipline (Claude's discretion, applied)**
- Empirical root-cause BEFORE fix, mirroring the request-direction session's method. The standalone-probe-vs-real-flow discrepancy (isolated probe: ISOLATED→MAIN instanceof:true; real product flow: instanceof:false) is UNEXPLAINED and must be explained as part of root-causing — the phase goal demands "verified live, not inferred". Probes must run on real Firefox (geckodriver harness, same infra as probe-request-xray.cjs), evaluating from the RP page's own MAIN-world context.
- Candidate variables to isolate (from the debug doc's blind spots): the double hop (background→ISOLATED `runtime.sendMessage` JSON, then ISOLATED decode, then ISOLATED→MAIN `window.postMessage`), how `decodeCredentialResponseJson` materializes ArrayBuffers (fresh `new ArrayBuffer` vs `.buffer` of a Uint8Array view), envelope nesting, and `shapeCredential()`'s `...cred` spread in page-bridge-firefox.ts (MAIN world).
- Fix preference order: (a) make every returned binary field a genuine same-realm ArrayBuffer for the page — e.g. re-materialize binary fields in the MAIN world (page-bridge-firefox.ts already legitimately contains MAIN-world decode code per the prior session's SECURED note: "base64url helper functions living in MAIN world are fine"); (b) only if (a) provably conflicts with SECURED constraints or the D-21 encode/decode-ownership boundary, fall back to the ROADMAP's sanctioned alternative: a documented contract-equivalent, with the exact guarantees written down (toString.call brand + byte-intact + toJSON()). Prefer (a): real-world RP libraries (webauthn-json et al.) branch on `instanceof`.
- D-21 tension to resolve during research: content-relay.content.ts's header claims 100% encode/decode ownership, yet page-bridge-firefox.ts demonstrably ships MAIN-world decode already, and the prior session's constraints bless MAIN-world b64url helpers. Resolve against actual code; do not let the comment veto the correct fix. If ownership wording must change, update the comment in the same commit.
- Chrome must not regress: content-relay.content.ts is shared by both builds; page-bridge.content.ts (Chrome) has an identical-rationale shapeCredential. Any shared-path change re-runs the Chrome gates.

**SECURED constraints (carried over verbatim, non-negotiable)**
- Do NOT touch validation/nonce/origin/consent logic.
- `scripts/audit-mainworld-boundary.sh` must stay exit 0.
- Never `git add -A`; atomic commits with explicit paths.

**Probe assertion upgrade (success criterion 2)**
- `probe-request-xray.cjs`'s XRAY-CREATE/XRAY-GET rows stop skipping the response-direction check: assert for each returned binary field (`rawId`, `response.clientDataJSON`, create: `attestationObject`; get: `signature` + `authenticatorData`; PRF `results.*` where the fixture exercises them) BOTH the realm contract (instanceof — or the documented contract-equivalent if path (b) was taken, with the probe asserting exactly what the contract promises) AND byte-level identity (decoded bytes match expected/roundtrip values). "Currently KNOWN to fail" comment block gets removed with the fix.
- Keep the probe permanent, headed, against the CSP-strict fixture — same prerequisites as today (pv-server on :8620, prebuilt firefox-mv2).

**QA-03 Rust round-trip test (Claude's discretion, applied)**
- Independence pairing: ceremony produced by `crates/pv-provider` (passkey-rs soft authenticator — the REAL provider code path), verified by `webauthn-rs` 0.5 acting as an independent RP implementation. Two unrelated codebases = genuine cross-verification; this is the automated stand-in for "a real relying party".
- Placement: integration test under `crates/pv-provider/tests/` (create the dir), with `webauthn-rs` as a dev-dependency (workspace already pins 0.5 via pv-server; `danger-allow-state-serialisation` only if state handoff requires it). If dependency layering makes pv-provider/tests hostile, fallback placement is `crates/pv-server/tests/` — but provider-side is preferred so the test survives server refactors.
- What must be exercised: full register → verify attestation → authenticate → verify assertion signature over the REAL challenge issued by the webauthn-rs RP. The test must consume the provider's serialized JSON output at the same boundary the extension background consumes (the serde path that carried the v0.2 `serialize_bytes_as_base64_string` bug), so the byte-serialization blind spot stays closed. Shape/`.ok`/`id`-only assertions explicitly do not count.
- ES256 only (the provider's alg); no need to matrix other algorithms this phase.

**Record hygiene (success criterion 4)**
- `git add .planning/debug/firefox-request-xray-hole.md` as part of this phase's first commit touching the topic (the doc must never again exist only untracked).
- On response-direction fix landing: update the doc's Resolution for the response direction, set status resolved, move to `.planning/debug/resolved/` (repo convention: firefox-injection-csp-blocked.md precedent), and mirror the closure into STATE.md (flip the OPEN blocker entry + Deferred Items row to resolved).
- The doc's `awaiting_human_verify` (Bartek's live github.com retest of the REQUEST-direction fix) stays truthfully recorded — do not mark human verification as done. The webauthn-rs round-trip + upgraded probe are the automated closure evidence for this phase; a note in the doc should say the real-github.com retest remains open for Bartek at his leisure.

**Gates (all must pass before the phase closes)**
- extension vitest (651 baseline + new tests), `npx tsc --noEmit`, `npm run build:chrome` + `npm run build:firefox`, `bash scripts/audit-mainworld-boundary.sh` exit 0.
- Firefox harness: `run-core.cjs` (17 PASS + 1 OBSERVED baseline), `run-server-unlock.cjs` (15 PASS/2 INFO/0 FAIL), upgraded `probe-request-xray.cjs` all-PASS including the new response-direction assertions.
- Chrome: `npx playwright test --project=chromium-ceremony` 5/5 (headed — headless hangs, see 13-03).
- `cargo test --workspace` green including the new QA-03 integration test.

### Claude's Discretion
Everything above — this phase has no user-visible surface. If a genuinely user-facing decision emerges mid-phase (e.g. the fix forces a visible behavior change in the ceremony flow), stop and ask Bartek then.

### Deferred Ideas (OUT OF SCOPE)
- The CORS `Access-Control-Allow-Headers: *` vs `Authorization` on Firefox — already scheduled as SEC-01 (Phase 19).
- npm-script lanes + CI wiring for all real-Firefox probes — QA-02/QA-01 (Phase 20).
- `Symbol.toStringTag` spoof-hardening of the widened isBufferSource (ceremony-local DoS at worst, same trust boundary — noted in the debug doc's blind spots; revisit only if Phase 18's security review flags it).
- CORS `Access-Control-Allow-Headers: *` warning (SEC-01, Phase 19); wiring probes into npm scripts/CI (QA-02/QA-01, Phase 20); any UX/design work; the ext-scoped PRF/auth refactor (Phase 15) — all explicitly out of scope for this phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| XBR-02 | Response-direction cross-realm binary integrity on Firefox — WebAuthn credential fields returned to the page (`rawId`, `clientDataJSON`, `attestationObject`, `signature`, `authenticatorData`) are genuine same-realm `ArrayBuffer`s (or contract-equivalent); root-caused, fixed, byte-asserted in the harness, and the tracking doc git-tracked. | Full data-flow trace of the MAIN↔ISOLATED postMessage hop (Architecture Patterns/System Architecture Diagram), candidate root-cause mechanisms (Pitfall 1/2, Open Question 1), existing D-21 encode/decode pattern to reuse for the fix (Code Examples), existing jsdom cross-realm test technique to extend (Pattern 1), and the exact probe file/assertions to upgrade (Validation Architecture) |
| QA-03 | The passkey provider has a real `webauthn-rs` round-trip test that verifies an actual assertion/attestation (real bytes, real signature verification) — not shape/`.ok`/`id`-only assertions — closing the fixture blind spot that hid the v0.2 serialization bug. | Verified `webauthn-rs` 0.5.5 API (Standard Stack, Pattern 2, Code Examples — Context7-sourced), `pv-provider`'s exact public API surface (`create_provider_credential`/`get_provider_assertion`, verified via direct code read), test placement recommendation and Cargo dependency changes (Recommended Project Structure), cross-vendor JSON-compatibility risk flagged as the first task to verify (Pitfall 3, Open Question 2), origin/rp_id configuration guidance (Pitfall 4) |
</phase_requirements>

## Summary

This phase closes two Critical risks with runnable evidence, not inference. XBR-02 requires proving (or fixing) that every binary field of a Firefox-relayed WebAuthn credential is a genuine same-realm `ArrayBuffer` in the RP page's own context. QA-03 requires an independent cross-vendor Rust verifier (webauthn-rs, kanidm) checking a real signature over a real challenge produced by this project's own provider ceremony (pv-provider, built on 1Password's passkey-rs family) — the "shape/`.ok`/`id`-only" class of check is explicitly disallowed.

For XBR-02, direct code reading (not inference) locates the precise mechanism candidates. `content-relay.content.ts` (ISOLATED world) constructs the response's `ArrayBuffer`s locally via `b64UrlToArrayBuffer()` and ships them across a SINGLE `window.postMessage(envelope, location.origin)` hop into MAIN world (`page-bridge-firefox.ts`), which then does `shapeCredential()` — a shallow `{...cred, ...}` spread that does **not** re-create nested values, so it structurally cannot be the point where an `ArrayBuffer`'s realm identity changes. The debug doc's own STEP-1 real-Firefox probe (00:30:00Z) found the reverse (ISOLATED→MAIN) hop clean using a *minimal, standalone* extension; but a later *real product* end-to-end run (01:00:00Z) found `credential.rawId instanceof ArrayBuffer === false` in the RP page's own MAIN-world context, with data intact. Firefox's Xray-wrapper architecture for content-script↔page object sharing is a documented source of exactly this instanceof-false/data-intact signature — MDN's own advice is to use `cloneInto()`/`exportFunction()` rather than relying on `postMessage` for anything beyond primitives, which is corroborating (MEDIUM confidence) but does not by itself explain the isolated-probe-vs-real-flow discrepancy; this needs a live-Firefox differential probe (Research Priority 1 below) before choosing a fix.

For QA-03, `pv-provider`'s public API (`create_provider_credential`/`get_provider_assertion` in `crates/pv-provider/src/ceremony.rs`) already takes/returns plain JSON strings matching the spec's `*OptionsJSON`/response JSON shape (base64url, via `passkey-types`' `serialize_bytes_as_base64_string` feature). `webauthn-rs` 0.5.5 (already an existing pv-server dependency) exposes exactly the matching RP-side API: `WebauthnBuilder::new(rp_id, &rp_origin) → build() → Webauthn`, then `start_passkey_registration`/`finish_passkey_registration` and `start_passkey_authentication`/`finish_passkey_authentication`. `RegisterPublicKeyCredential`/`PublicKeyCredential` both derive `Serialize`/`Deserialize`, so `pv-provider`'s `credential_response_json` string should deserialize directly into them — **this exact cross-vendor JSON compatibility has never been exercised in this codebase** (the existing `pv-server` tests use `webauthn_authenticator_rs::softpasskey::SoftPasskey`, which is kanidm's OWN soft authenticator — same-vendor as webauthn-rs, not an independent implementation) and must be verified empirically as this phase's first task, not assumed.

**Primary recommendation:** For XBR-02, run a live-Firefox differential probe that varies exactly ONE variable at a time (envelope field count, whether the ArrayBuffer is same-tick-constructed vs. round-tripped through a background `sendMessage`, and whether the value is read immediately in the `message` listener vs. after being spread into a new object) to root-cause the isolated-probe-vs-real-flow gap, THEN fix by re-materializing binary fields as genuinely MAIN-world-native `ArrayBuffer`s inside `shapeCredential()` (fix path (a), per CONTEXT.md's preference order) using `new Uint8Array(...).buffer`/`Uint8Array.from()` constructed with the MAIN world's OWN globals — never assume `{...cred}` alone fixes anything. For QA-03, build the integration test under `crates/pv-provider/tests/`, feed `pv-provider`'s `credential_response_json` output directly into `webauthn-rs`'s `RegisterPublicKeyCredential`/`PublicKeyCredential` deserializers, and treat any field-shape mismatch as a first-class finding to report, not silently patch around.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Cross-realm binary field materialization (XBR-02) | Browser / Client (extension content scripts, ISOLATED + MAIN world) | — | Entirely a same-tab, same-process JS realm-identity problem; no server or network involved |
| Response-direction byte-level probe assertion | Browser / Client (extension e2e harness, Node/geckodriver) | — | Test-infrastructure tier, drives the real browser exactly as the RP page would |
| Real-RP independent ceremony verification (QA-03) | API / Backend (Rust crates, in-process) | — | Two independent Rust crate families (`pv-provider`/passkey-rs vs. `webauthn-rs`) verifying a WebAuthn ceremony in-process; no HTTP/network layer needed for this test |
| Record hygiene (git-tracking + STATE.md mirror) | N/A (repo hygiene, not runtime) | — | Documentation/process concern, not an architectural tier |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `webauthn-rs` | 0.5.5 (pinned, `Cargo.lock` `[VERIFIED: Cargo.lock]`) | Independent RP-side WebAuthn verifier for QA-03 | Already a `pv-server` dependency (kanidm project); mature, ASVS-aligned relying-party implementation; genuinely independent codebase from `passkey-rs` (1Password), satisfying "two unrelated codebases" per CONTEXT.md |
| `passkey-authenticator` / `passkey-client` / `passkey-types` | 0.5.0 (pinned, `Cargo.lock` `[VERIFIED: Cargo.lock]`) | Already the `pv-provider` ceremony producer — no version change needed | Existing, already-approved dependency; QA-03 exercises it as-is, does not add or bump it |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `uuid` | 1.x (workspace dep, `[VERIFIED: Cargo.toml]`) | `Uuid::new_v4()` for `start_passkey_registration`'s `user_unique_id` argument | Add as a `pv-provider` dev-dependency via `uuid.workspace = true` — already a workspace dependency used elsewhere (`pv-server`), not a new external package |
| `url` | 2.5.8 (pinned, `[VERIFIED: Cargo.lock]`) | `Url::parse(...)` for both `webauthn-rs`'s `WebauthnBuilder::new` and `pv-provider`'s own `parse_origin` | Already a normal (non-dev) dependency of `pv-provider` — no addition needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `webauthn-rs` as the independent verifier | `webauthn_authenticator_rs::softpasskey::SoftPasskey` (already a `pv-server` dev-dependency) | Rejected — `SoftPasskey` is kanidm's OWN client/authenticator implementation, same vendor as `webauthn-rs`. Pairing it with `webauthn-rs` (already proven to work in `pv-server/tests/passkeys.rs`) is NOT a genuine cross-vendor check; it would not close the QA-03 gap CONTEXT.md defines ("two unrelated codebases") |
| Placing the test in `crates/pv-provider/tests/` | Placing it in `crates/pv-server/tests/` | CONTEXT.md's stated fallback if `pv-provider` cannot cleanly dev-depend on `webauthn-rs` (e.g. a circular/dependency-graph conflict). No such conflict was found during this research — `pv-provider` has zero existing dependency on anything in `pv-server`'s graph, and Cargo dev-dependencies do not create workspace cycles. Prefer `crates/pv-provider/tests/` per CONTEXT.md's own preference (survives server refactors) |
| Xray-safe realm re-materialization inside `shapeCredential()` (MAIN world) | A "documented contract-equivalent" fallback (no `instanceof` guarantee, only `toString.call`/byte-intact) | CONTEXT.md's explicit fallback ONLY if re-materialization provably conflicts with SECURED constraints or D-21 ownership. No such conflict is evident from this research — `page-bridge-firefox.ts` already legitimately contains MAIN-world decode helpers per the prior session's SECURED note. Fix (a) should be attempted first |

**Installation:**
```bash
# crates/pv-provider/Cargo.toml — add under [dev-dependencies]:
# webauthn-rs = { version = "0.5", features = ["danger-allow-state-serialisation"] }  # only if state must cross a serialization boundary; NOT needed for an in-process test holding PasskeyRegistration/PasskeyAuthentication as local Rust values
# webauthn-rs = "0.5"
# uuid.workspace = true
```
No `npm install` is needed for XBR-02 — it is a pure code fix inside already-present files (`content-relay.content.ts`, `page-bridge-firefox.ts`) plus test extensions to already-present files (`content-relay.test.ts`, `probe-request-xray.cjs`).

**Version verification performed:** `webauthn-rs 0.5.5`, `webauthn-rs-proto 0.5.5`, `webauthn-authenticator-rs 0.5.5`, `passkey-types/client/authenticator 0.5.0`, `coset 0.4.2`, `url 2.5.8`, `pollster 1.0.1` — all confirmed via `grep` against the repo's own `Cargo.lock` `[VERIFIED: Cargo.lock]`. No new crates.io lookups were needed since every crate this phase touches is already a pinned, in-lockfile dependency; no new external package is being introduced.

## Package Legitimacy Audit

**No new external packages are introduced by this phase.** Every crate this phase's QA-03 work touches (`webauthn-rs`, `uuid`, `url`) is already a pinned dependency elsewhere in this workspace's `Cargo.lock` (`pv-server` already depends on `webauthn-rs 0.5.5`; `uuid` is a `[workspace.dependencies]` entry already used by `pv-server`; `url` is already a normal `pv-provider` dependency). The only change is a NEW dev-dependency EDGE (`pv-provider` → `webauthn-rs`) using an ALREADY-approved, already-in-lockfile package — this does not require a fresh legitimacy check per the Package Legitimacy Gate's own scope ("every phase that installs external packages"); no package is being installed for the first time in this repository.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `webauthn-rs` 0.5.5 | crates.io | multi-year, actively maintained (kanidm project) | high (already vetted as a `pv-server` production dependency in Phase 9/12) | github.com/kanidm/webauthn-rs | OK (pre-existing) | Approved — new dev-dep edge only |
| `uuid` 1.x | crates.io | mature, ubiquitous | very high | github.com/uuid-rs/uuid | OK (pre-existing) | Approved — new dev-dep edge only |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```text
XBR-02 — response-direction data flow (Firefox, per real create()/get() ceremony)
==================================================================================

  RP page's own script (MAIN world)
    │  navigator.credentials.create()/get()  [patched accessor]
    ▼
  page-bridge-firefox.ts (MAIN world, same realm as the page)
    │  broker() → relay(kind, publicKey)
    │  window.postMessage(request, location.origin)   ── MAIN → ISOLATED ──▶
    ▼
  content-relay.content.ts (ISOLATED world)
    │  handleProviderPageMessage() validates origin/nonce/shape
    │  encodePublicKeyOptions() base64url-encodes binary fields (D-21)
    │  → runtime.sendMessage() to background (JSON-serializes)
    ▼
  background (WASM: pv-provider ceremony via pv-wasm)  [not touched this phase]
    │  create_provider_credential() / get_provider_assertion()
    │  ← credentialResponseJson: String (base64url fields)
    ▼
  content-relay.content.ts (ISOLATED world)
    │  respondToPage() → decodeCredentialResponseJson()
    │    b64UrlToArrayBuffer() constructs ArrayBuffers HERE (ISOLATED realm)
    │  postToPage(): window.postMessage(envelope, location.origin)
    │                                                  ── ISOLATED → MAIN ──▶
    ▼                                        ← THE HOP UNDER INVESTIGATION →
  page-bridge-firefox.ts (MAIN world)
    │  relay()'s onMessage receives `data.credential` (real ArrayBuffers?)
    │  shapeCredential(credential, credentialJson)
    │    { ...credential, getClientExtensionResults, toJSON }  ← SHALLOW spread,
    │    does NOT re-create nested ArrayBuffer values or change their realm
    ▼
  RP page's own script receives the return value of create()/get()
    │  credential.rawId instanceof ArrayBuffer  →  OBSERVED FALSE in real flow
    │  Object.prototype.toString.call(credential.rawId)  →  "[object ArrayBuffer]"
    │  new Uint8Array(credential.rawId)  →  correct, uncorrupted bytes
    ▼
  A real RP library (e.g. webauthn-json-style) branching on `instanceof`
  may reject a genuinely valid credential — THIS is the risk XBR-02 closes.


QA-03 — independent cross-vendor verification data flow (Rust, in-process)
============================================================================

  webauthn-rs::Webauthn (kanidm, RP role)
    │  start_passkey_registration(uuid, name, display_name, None)
    │  → (CreationChallengeResponse, PasskeyRegistration)   [state kept local]
    │  serde_json::to_string(&ccr)  →  request_json: String
    ▼
  pv-provider::create_provider_credential(request_json, origin)
    │  (passkey-rs / 1Password family, REAL provider code path)
    │  → CreateProviderResult { credential_response_json, new_passkey_json }
    ▼
  webauthn-rs::Webauthn
    │  serde_json::from_str::<RegisterPublicKeyCredential>(&credential_response_json)
    │  finish_passkey_registration(&reg, &state)  →  Passkey (webauthn-rs's own type)
    │      ── genuine cross-vendor signature/attestation verification happens HERE ──
    ▼
  (repeat the pattern for authentication: start/finish_passkey_authentication,
   feeding pv-provider::get_provider_assertion's credential_response_json into
   webauthn-rs's PublicKeyCredential deserializer)
    │
    ▼
  Assertion signature verifies over the REAL challenge issued by webauthn-rs —
  NOT a shape/.ok/id-only check (CONTEXT.md's explicit bar).
```

### Recommended Project Structure
```
crates/pv-provider/
├── src/                      # UNCHANGED this phase
│   ├── ceremony.rs           # create_provider_credential / get_provider_assertion — consumed as-is
│   ├── credential_store.rs
│   ├── error.rs
│   └── lib.rs
├── tests/                    # NEW directory (Cargo dev-dependency test target)
│   └── real_rp_verification.rs   # QA-03: webauthn-rs round-trip, register+authenticate
└── Cargo.toml                # NEW [dev-dependencies]: webauthn-rs, uuid.workspace = true

extension/entrypoints/
├── content-relay.content.ts  # XBR-02 root-cause site + likely fix landing (if fix path (b) chosen)
├── page-bridge-firefox.ts    # XBR-02 likely fix site (shapeCredential re-materialization, fix path (a))
├── page-bridge.content.ts    # Chrome twin — verify unaffected, mirror only if a shared-file change is made
└── __tests__/
    └── content-relay.test.ts # extend cross-realm describe block for RESPONSE direction (jsdom iframe technique)

extension/e2e-firefox/
└── probe-request-xray.cjs    # upgrade XRAY-CREATE/XRAY-GET to assert response-direction realm+byte identity

.planning/debug/
├── firefox-request-xray-hole.md         # git-track, resolve, then MOVE to resolved/
└── resolved/
    └── firefox-request-xray-hole.md     # final location (matches firefox-injection-csp-blocked.md precedent)
```

### Pattern 1: jsdom hidden-`<iframe>` cross-realm reproduction (existing precedent to extend)
**What:** `content-relay.test.ts`'s `crossRealmArrayBuffer()` helper (lines 611-637) creates an `ArrayBuffer` using a hidden `<iframe>`'s own `contentWindow.ArrayBuffer`/`Uint8Array` constructors, giving jsdom a genuinely separate JS realm without needing real Firefox.
**When to use:** Deterministic, CI-safe reproduction of the SAME instanceof-false/toString.call-true/data-intact signature the real Firefox Xray hazard produces. Already used for the 5 REQUEST-direction tests; the identical technique should be extended for RESPONSE-direction coverage (a `<iframe>` "posts" a `credential`-shaped object with cross-realm `ArrayBuffer` fields into the test's own realm, then asserts `shapeCredential()`'s output).
**Example:**
```typescript
// Source: extension/entrypoints/__tests__/content-relay.test.ts:611-637 (existing code, VERIFIED via Read)
function crossRealmArrayBuffer(bytes: number[]): ArrayBuffer {
  const iframe = document.createElement("iframe");
  document.body.appendChild(iframe);
  const otherWin = iframe.contentWindow as unknown as {
    ArrayBuffer: typeof ArrayBuffer;
    Uint8Array: typeof Uint8Array;
  };
  const buffer = new otherWin.ArrayBuffer(bytes.length);
  const view = new otherWin.Uint8Array(buffer);
  bytes.forEach((b, i) => { view[i] = b; });
  if (buffer instanceof ArrayBuffer) {
    throw new Error("test setup bug: crossRealmArrayBuffer is same-realm, not cross-realm");
  }
  return buffer as unknown as ArrayBuffer;
}
```
**Important caveat:** this jsdom technique reproduced the REQUEST-direction bug deterministically, but the debug doc's own STEP-1 evidence shows a *minimal standalone real-Firefox* probe of the RESPONSE direction did NOT reproduce the bug — only the real multi-field product flow did. A jsdom-only regression test for the RESPONSE direction is valuable for CI (once the mechanism is understood and a fix exists), but it is NOT a substitute for `probe-request-xray.cjs`'s live-Firefox assertion — the phase's own success criterion 1 explicitly requires "verified live, not inferred from the ISOLATED-realm decode step alone."

### Pattern 2: `webauthn-rs`'s two-phase ceremony API (register/authenticate)
**What:** `Webauthn::start_passkey_registration(...)` returns a `(CreationChallengeResponse, PasskeyRegistration)` pair — the first half is sent to the "client" (here: fed as JSON into `pv-provider::create_provider_credential`), the second half (`PasskeyRegistration`) is server-side ceremony state that must be held and passed to `finish_passkey_registration`. Same two-phase shape for authentication (`PasskeyAuthentication`).
**When to use:** QA-03's integration test — since this is a single in-process Rust test function, the `PasskeyRegistration`/`PasskeyAuthentication` state can simply be a local variable; NO serialization/`danger-allow-state-serialisation` feature is needed (that feature exists for crossing an HTTP request boundary, which `pv-server`'s own routes already do — this test has no such boundary).
**Example:**
```rust
// Source: Context7 /websites/rs_webauthn-rs_webauthn_rs (docs.rs/webauthn-rs, VERIFIED via Context7 query)
// and crates/pv-server/src/routes/passkeys.rs (VERIFIED via Read — existing in-repo usage pattern)
use webauthn_rs::prelude::*;

let rp_id = "example.com";
let rp_origin = Url::parse("https://example.com").expect("valid url");
let webauthn = WebauthnBuilder::new(rp_id, &rp_origin)
    .expect("valid config")
    .build()
    .expect("valid config");

let (ccr, reg_state) = webauthn
    .start_passkey_registration(Uuid::new_v4(), "qa03@example.com", "QA-03", None)
    .expect("start registration");

let request_json = serde_json::to_string(&ccr).expect("serialize CreationChallengeResponse");
// request_json is fed into pv_provider::create_provider_credential(&request_json, "https://example.com")

// ... after obtaining credential_response_json from pv-provider:
let reg: RegisterPublicKeyCredential = serde_json::from_str(&credential_response_json)
    .expect("deserialize pv-provider's response into webauthn-rs's own type — VERIFY empirically, do not assume");
let passkey = webauthn.finish_passkey_registration(&reg, &reg_state)
    .expect("finish registration — genuine cross-vendor signature verification happens here");
```

### Anti-Patterns to Avoid
- **Assuming the shapeCredential `{...cred}` spread is the bug:** it is a shallow copy — it copies references to nested values (like `rawId`), it does not re-create them in a new realm. Do not "fix" this by rewriting the spread; the actual re-materialization (if fix path (a) is chosen) must explicitly construct NEW `ArrayBuffer`/`Uint8Array` instances using the executing (MAIN-world) realm's own constructors for every affected field.
- **Assuming the isolated STEP-1 probe (00:30:00Z) settles the response direction:** it does not — the debug doc itself flags the standalone-probe-vs-real-flow discrepancy as unexplained. Treat that probe's "instanceof: true" finding as inconclusive for the real flow, not as evidence the response direction is clean.
- **Shape/`.ok`/`id`-only assertions for QA-03:** explicitly forbidden by CONTEXT.md and REQUIREMENTS.md QA-03. The test must call `finish_passkey_registration`/`finish_passkey_authentication` and assert they return `Ok(...)`, not merely that a response object has an `id` field.
- **Using `webauthn_authenticator_rs::softpasskey::SoftPasskey` as the QA-03 "independent" side:** it shares a vendor (kanidm) with `webauthn-rs`, so pairing them does not demonstrate cross-vendor interop — this is what `pv-server/tests/passkeys.rs` already does for its OWN unrelated purpose, and it must not be mistaken for satisfying QA-03.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-realm object identity in Firefox WebExtensions | A custom deep-clone/rewrap utility for postMessage payloads | Re-materialize ONLY the specific binary fields that need `instanceof` correctness, using the receiving realm's own `ArrayBuffer`/`Uint8Array` constructors (the existing `bufferSourceToB64Url`/`b64UrlToArrayBuffer` pattern already in this codebase) | A general-purpose cross-realm object rewrapper is a much larger surface than this bug needs; the existing base64url encode/decode boundary (D-21) already solves the identical problem for the REQUEST direction — reuse its shape, don't invent a new mechanism |
| WebAuthn RP-side signature/attestation verification | A hand-rolled COSE/CBOR/ES256 verifier for the QA-03 test | `webauthn-rs`'s `finish_passkey_registration`/`finish_passkey_authentication` | This is exactly the class of cryptographic code this project's own `.claude/CLAUDE.md` conventions and WebAuthn's own complexity make hand-rolling dangerous; `webauthn-rs` IS the "real RP" stand-in CONTEXT.md specifies |

**Key insight:** Both problems in this phase have an existing, in-repo, already-proven mechanism one hop away — D-21's base64url boundary for XBR-02, and `pv-server`'s own existing `webauthn-rs` usage pattern for QA-03. The work is adapting/extending these patterns to a new boundary (MAIN-world re-materialization; cross-vendor JSON interop), not inventing new cryptographic or realm-management machinery.

## Common Pitfalls

### Pitfall 1: Treating the standalone isolated probe's "response direction is clean" finding as authoritative
**What goes wrong:** A fix (or a probe) built on the assumption that ISOLATED→MAIN postMessage is inherently safe for ArrayBuffers (because a minimal standalone test showed `instanceof: true`) will fail to reproduce, and therefore fail to fix, the real product bug.
**Why it happens:** The debug doc's own STEP-1 evidence entry (00:30:00Z) tested a MINIMAL envelope shape; the 01:00:00Z entry found the REAL multi-field product flow behaves oppositely. Some variable present in the real flow (envelope complexity, timing, number of fields, or something about how `handleProviderPageMessage`'s validation/nonce/nested-object machinery touches the value before `postToPage()`) changes the outcome, and it has not yet been isolated.
**How to avoid:** Build a live-Firefox DIFFERENTIAL probe (not just a pass/fail probe) that varies exactly one candidate variable at a time against the REAL extension code path (not a fresh minimal extension), starting from the candidates CONTEXT.md lists: envelope nesting depth/field count, `.buffer` vs `new ArrayBuffer` construction, whether the value passes through `respondToPage()`'s JSON.parse/decode chain vs. being posted directly.
**Warning signs:** A "fix" that only changes `shapeCredential()`'s spread syntax without adding genuine re-materialization of nested binary fields; a probe that reports PASS using a reshaped-but-still-minimal envelope rather than driving the actual product code path end-to-end.

### Pitfall 2: Firefox Xray wrappers and postMessage — MDN's own guidance is incomplete for this exact scenario
**What goes wrong:** Relying purely on `window.postMessage()`'s structured-clone algorithm for complex nested objects crossing content-script↔page boundaries can produce values whose PROTOTYPE CHAIN (instanceof) doesn't match the receiving realm even when the underlying DATA is byte-correct — this is a documented Firefox WebExtension caveat, but MDN's "Sharing objects with page scripts" page does not exhaustively document postMessage's specific behavior for nested ArrayBuffers (confirmed via direct WebFetch of that page — see Sources). `[CITED: developer.mozilla.org — general Xray/sharing caveats, MEDIUM confidence; does not fully explain this specific nested-object case]`
**Why it happens:** Xray vision is Firefox's mechanism for protecting privileged (content-script) code from being tampered with by less-privileged (page) code, and by extension it governs how content-script-created host objects (like `ArrayBuffer`) appear when handed to the page — even via structured-clone channels like `postMessage`, which are generally assumed to be realm-neutral but are not guaranteed to be in every WebExtension implementation detail.
**How to avoid:** Do not assume postMessage always fully "de-realm-ifies" nested values. Where `instanceof` correctness in the RECEIVING realm matters (e.g. because a real RP library's client code branches on it), explicitly re-construct the value using that realm's own constructors after receipt, rather than trusting the clone.
**Warning signs:** `instanceof` checks passing in a minimal/isolated test but failing in the full product flow — a strong signal that SOME structural difference (not the isolated test's own realm mechanics) is responsible, and the isolated test is not representative.

### Pitfall 3: Assuming `pv-provider`'s response JSON is automatically compatible with `webauthn-rs`'s Rust types
**What goes wrong:** `passkey-types` (1Password) and `webauthn-rs-proto` (kanidm) are two independently-maintained Rust crate families that both target the same WebAuthn spec JSON wire format, but their `Serialize`/`Deserialize` implementations were never designed with cross-compatibility as an explicit goal. Assuming `serde_json::from_str::<RegisterPublicKeyCredential>(&pv_provider_response)` will "just work" without verifying it is exactly the unproven leap this phase exists to test.
**Why it happens:** Both libraries independently implement the same spec (`*OptionsJSON`/response JSON conventions are well-defined by the WebAuthn spec's own JSON serialization appendix), so a HIGH degree of compatibility is likely, but field-name edge cases (e.g. optional-field omission vs. `null`, `authenticatorAttachment` presence, `transports` array shape, extension-results nesting) have not been diffed against each other in this codebase.
**How to avoid:** Make the FIRST task of the QA-03 plan a direct pass-through spike: serialize `webauthn-rs`'s `CreationChallengeResponse` → feed to `pv-provider::create_provider_credential` → take its `credential_response_json` → deserialize into `webauthn-rs`'s `RegisterPublicKeyCredential` → call `finish_passkey_registration`. If ANY step fails to compile/deserialize/verify, that failure IS a finding to report (possibly requiring a small field-mapping adapter), not a blocker to route around silently.
**Warning signs:** `serde_json::from_str` succeeding but with silently-defaulted/missing optional fields; `finish_passkey_registration` failing on origin/rp_id validation because `pv-provider`'s `origin_url` parsing and `webauthn-rs`'s `WebauthnBuilder`'s `rp_origin` weren't given IDENTICAL strings.

### Pitfall 4: `rp_id`/origin mismatches between the two independent RP-side configs
**What goes wrong:** `pv-provider::create_provider_credential`/`get_provider_assertion` take an `origin: &str` argument that must parse as a URL and match what's embedded in the WebAuthn request's `rp.id`/`rpId`; `webauthn-rs`'s `WebauthnBuilder::new(rp_id, &rp_origin)` independently enforces "`rp_id` must be an effective domain of `rp_origin`" `[VERIFIED: Context7 docs.rs/webauthn-rs]`. Using `"localhost"` (as `pv-server`'s own dev config and `pv-provider`'s existing `allows_insecure_localhost(true)` flag both accommodate) adds an extra layer of special-casing that is unnecessary for an in-process test with no real network origin.
**Why it happens:** `pv-provider`'s existing test fixtures already use `"https://example.com"` successfully (see `crates/pv-provider/src/lib.rs`'s own `create_then_get_roundtrip` test) — reusing that exact string for BOTH `webauthn-rs`'s `WebauthnBuilder` and `pv-provider`'s `origin` argument sidesteps localhost-specific flags entirely on both sides.
**How to avoid:** Use `rp_id = "example.com"`, `rp_origin = Url::parse("https://example.com")` for `webauthn-rs`, and pass the literal string `"https://example.com"` as `pv-provider`'s `origin` argument — no `allows_insecure_localhost` equivalent is needed or available on the `webauthn-rs` side; keeping both origins identical and non-localhost is the simplest path.
**Warning signs:** `WebauthnBuilder::new` returning `Err` (rp_id/origin domain mismatch); `pv-provider`'s `parse_origin`/`Client::register` rejecting the origin the RP's `CreationChallengeResponse` embedded.

### Pitfall 5: `Symbol.toStringTag` spoofing residual risk if the fix widens detection further
**What goes wrong:** If the RESPONSE-direction fix follows the SAME pattern as the REQUEST-direction fix (widening `isBufferSource`-style detection via `Object.prototype.toString.call`), it inherits the SAME residual spoofing risk the REQUEST-direction fix already accepted and documented (IN-01, `content-relay.test.ts` lines 767-794): a page could spoof `Symbol.toStringTag` on a plain object to fake `"[object ArrayBuffer]"`, and an unguarded `new Uint8Array(fake)` on a crafted huge `length` throws synchronously.
**Why it happens:** This is a deliberate, already-accepted tradeoff for the REQUEST direction (a ceremony-local DoS at worst, same trust boundary as today, not a validation/origin/consent bypass) — but if the RESPONSE-direction fix re-materializes fields using similar detection logic, the SAME try/catch discipline `handleProviderPageMessage`'s existing IN-01 fix demonstrates must be applied to whatever new code path does the materialization, or a new unguarded-throw wedge risk is introduced.
**How to avoid:** Wrap any new binary-field re-materialization logic in `shapeCredential()` (or wherever it lands) in a try/catch that falls back cleanly (matching the existing pattern), rather than letting a malformed/spoofed value throw uncaught into the RP page's promise chain.
**Warning signs:** A new code path that calls `new Uint8Array(x)` or similar on an un-trusted-shape value without a surrounding try/catch.

## Code Examples

### Existing D-21 base64url encode/decode boundary (reuse this pattern, don't reinvent)
```typescript
// Source: extension/entrypoints/content-relay.content.ts:481-501 (VERIFIED via Read, existing code)
function bufferSourceToB64Url(input: BufferSource): string {
  const bytes = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input as ArrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToArrayBuffer(b64url: string): ArrayBuffer {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(paddingNeeded));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
```
If fix path (a) is chosen (MAIN-world re-materialization inside `shapeCredential()`), the natural implementation is to run the base64url-encoded `credentialJson` (already available as the SAME-shape original JSON string per `postToPage`'s existing `credentialJson` field, since `respondToPage()` already parses `response.credentialResponseJson` into `credentialJson` before decoding) through an analogous `b64UrlToArrayBuffer`-style decoder EXECUTING IN MAIN WORLD, rather than trusting the ISOLATED-world-decoded `credential` object's nested values to survive the postMessage hop unchanged.

### webauthn-rs finish_passkey_authentication (existing in-repo precedent)
```rust
// Source: crates/pv-server/src/routes/passkeys.rs (VERIFIED via Read, existing production code)
let auth_result = state.webauthn
    .finish_passkey_authentication(&req.credential, &auth_state)
    .map_err(|e| { /* ... */ });
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| REQUEST-direction raw `ArrayBuffer` left undetected by `isBufferSource()` | `isBufferSource()` widened to accept `Object.prototype.toString.call(value) === "[object ArrayBuffer]"` in addition to `instanceof`/`isView` | This session (commits referenced in `.planning/debug/firefox-request-xray-hole.md`, 2026-07-20) | Fixed the REQUEST direction only; explicitly does NOT cover the RESPONSE direction this phase must close |
| No real-RP verification of the provider ceremony | This phase adds `webauthn-rs`-verified round-trip | Phase 14 (in progress) | Closes a genuine, previously-untested blind spot: the v0.2 `serialize_bytes_as_base64_string` bug (resolved in `.planning/debug/resolved/firefox-provider-corruption.md`) was only caught because a LATER debug session happened to look; a permanent cross-vendor test prevents recurrence |

**Deprecated/outdated:** none specific to this phase's domain — both `webauthn-rs` 0.5.5 and `passkey-*` 0.5.0 are current pinned major versions with no known deprecation notices found during this research.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `pv-provider`'s `credential_response_json`/request JSON shapes will deserialize cleanly into `webauthn-rs`'s `RegisterPublicKeyCredential`/`PublicKeyCredential`/`CredentialCreationOptions` types without a field-mapping adapter | QA-03 Standard Stack, Pitfall 3 | If wrong, the QA-03 task needs an extra adapter-struct task before the round-trip test can compile/pass — moderate scope increase, not a phase blocker |
| A2 | Firefox's Xray-wrapper/postMessage interaction (MDN's general guidance) is the actual mechanism behind the response-direction instanceof-false signature, rather than something specific to this project's own envelope/nonce/validation code | XBR-02 Summary, Pitfall 2 | If wrong, a fix built on the Xray-wrapper theory (MAIN-world re-materialization) might still work empirically (it directly targets the observed symptom regardless of root cause) but the root-cause explanation in the final debug-doc resolution would be incomplete, and success criterion 1's "verified live" bar demands the discrepancy actually be explained, not just paved over |
| A3 | `WebauthnBuilder::new("example.com", &Url::parse("https://example.com")?)` paired with `pv-provider`'s own `"https://example.com"` origin argument is sufficient with no `allows_insecure_localhost`-equivalent flag needed on the `webauthn-rs` side | Pitfall 4 | Low risk — this exact origin string is already proven to work in `pv-provider`'s own existing test suite; if `webauthn-rs` rejects it for an unrelated reason (e.g. HTTPS-scheme enforcement without a real TLS cert being needed, since this is all in-process with no real network), that would surface immediately as a compile/test-run failure, not a silent gap |
| A4 | Adding `webauthn-rs` as a `pv-provider` dev-dependency creates no Cargo workspace dependency-graph conflict | Alternatives Considered (test placement) | Low risk, but not exhaustively verified via an actual `cargo check` in this research session — the planner's first task should confirm this compiles cleanly before committing to the `crates/pv-provider/tests/` placement over the `crates/pv-server/tests/` fallback |

**If this table is empty:** N/A — see entries above; none of these assumptions concern compliance/retention/security-standard tradeoffs that would need Bartek's confirmation (CONTEXT.md already delegates all decisions in this phase to Claude's discretion), but A1/A2 are genuine technical unknowns the phase's own execution must resolve empirically per its "byte-level proof" bar.

## Open Questions

1. **What exactly differs between the debug doc's minimal STEP-1 standalone probe and the real product flow for the RESPONSE direction?**
   - What we know: Both constructed a content-script-native `ArrayBuffer` and posted it to the page; the minimal probe showed `instanceof: true`, the real flow shows `instanceof: false`, with byte-identical data in both cases. Nesting depth was reportedly ruled out by the debug doc's own follow-up (envelope reshaped to mirror the real credential-response shape, still `instanceof: true`).
   - What's unclear: Whether the actual variable is something about `content-relay.content.ts`'s OWN validation/nonce/ack machinery running before `postToPage()` (e.g. `postAck()`'s own earlier `window.postMessage` call altering some shared Xray-wrapper cache state for that `window` reference), timing (a message arriving mid-ceremony vs. isolated), or something about the SPECIFIC constructor path `b64UrlToArrayBuffer` uses (`new Uint8Array(binary.length)` then `.buffer`) vs. whatever the standalone probe used.
   - Recommendation: Build a live-Firefox differential probe as this phase's FIRST XBR-02 task, varying exactly one candidate at a time against the REAL `content-relay.content.ts`/`page-bridge-firefox.ts` code (not a fresh throwaway extension), starting with: (a) does an EARLIER `postAck()` postMessage on the SAME nonce/window before the credential postMessage change the outcome; (b) does going through the full `respondToPage()`→`decodeCredentialResponseJson()` call chain (vs. a bare inline `b64UrlToArrayBuffer` call) change the outcome; (c) does the number of sibling fields in the envelope (kind/credential/credentialJson/prfCapable/prfUnavailableReason) matter beyond what was already ruled out.

2. **Does `webauthn-rs`'s `CreationChallengeResponse`/`RegisterPublicKeyCredential` JSON shape match `passkey-types`' `CredentialCreationOptions`/response shape byte-for-byte, or are there field-name/optionality gaps?**
   - What we know: Both target the WebAuthn spec's JSON conventions; `webauthn-rs`'s `CreationChallengeResponse` has a single `public_key: PublicKeyCredentialCreationOptions` field (Context7-confirmed) matching `pv-provider`'s own documented `{"publicKey": ...}` wrapping convention. `pv-server`'s own routes already prove `RegisterPublicKeyCredential`/`PublicKeyCredential` deserialize correctly from a REAL BROWSER's native WebAuthn JSON.
   - What's unclear: Whether `passkey-types`' independently-implemented struct definitions produce/consume the IDENTICAL JSON shape as `webauthn-rs-proto`'s — this has never been tested in this codebase.
   - Recommendation: Make this the first, cheapest task of QA-03 — a minimal `#[test]` that just does the round-trip and reports exactly what breaks (if anything) before building out the full register+authenticate test.

3. **Is `crates/pv-provider/tests/webauthn-rs` dev-dependency edge free of workspace-graph conflicts?**
   - What we know: `pv-provider`'s existing dependency graph (`passkey-authenticator`/`passkey-client`/`passkey-types`/`coset`/`pollster`/`url`) has no overlap with `pv-server`'s graph beyond shared workspace deps (`serde`/`serde_json`/`thiserror`).
   - What's unclear: Whether `webauthn-rs`'s own transitive dependencies (it pulls in `openssl`-family or `ring`-family crypto crates, `webauthn-rs-proto`, etc.) introduce a slow build or a genuine conflict when added as a dev-dependency to a crate that also depends on `coset`/`passkey-*`.
   - Recommendation: `cargo check -p pv-provider --tests` immediately after adding the dependency, before writing the test body — cheap to verify, expensive to discover late.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Real Firefox binary (`/Applications/Firefox.app/...`) + geckodriver | XBR-02 live probes, `run-core.cjs`, `run-server-unlock.cjs`, `probe-request-xray.cjs` | Assumed ✓ (existing harness already runs against it per CONTEXT.md's stated baselines) | Firefox 152.0.6 (per debug doc's own probe evidence) | None — this phase's success criterion 1 explicitly requires LIVE Firefox verification; no simulated substitute satisfies it (jsdom iframe technique is a useful REGRESSION test, not a substitute for the live gate) |
| `pv-server` running on `:8620` | `probe-request-xray.cjs` and other e2e-firefox probes | Assumed ✓ (existing prerequisite, unchanged this phase) | — | None needed — start via existing project scripts before running probes |
| `cargo`/Rust toolchain | QA-03 integration test | ✓ (project's primary toolchain, always available in this repo) | per `rust-toolchain.toml` | — |
| Chromium (headed, for `chromium-ceremony` project) | Regression gate (Chrome must not regress) | Assumed ✓ (existing harness, headed required per 13-03 precedent) | — | None — headless is documented to hang for this specific project (13-03-SUMMARY.md) |

**Missing dependencies with no fallback:**
- None identified as blocking — all required tooling is already an established part of this project's existing harness; this phase adds no NEW environment dependency.

**Missing dependencies with fallback:**
- None.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework (extension) | Vitest (jsdom environment) — `extension/package.json` `"test": "vitest run"` `[VERIFIED: package.json]` |
| Framework (extension e2e) | Custom Node/`selenium-webdriver` (Firefox/geckodriver) scripts under `extension/e2e-firefox/` + Playwright for Chrome (`extension/playwright.config.ts`) |
| Framework (Rust) | `cargo test` (workspace), built-in `#[test]`/`#[tokio::test]` |
| Config file (extension unit) | `extension/vitest.config.ts` (not read this session; existing, unchanged) |
| Quick run command | `npm --prefix extension test -- --run content-relay` (existing precedent, `audit-mainworld-boundary.sh`'s own header comment) |
| Full suite command (extension) | `npm --prefix extension test` (vitest run, 651 baseline `[CITED: firefox-request-xray-hole.md]`) |
| Full suite command (Rust) | `cargo test --workspace` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| XBR-02 (jsdom regression) | Response-direction cross-realm ArrayBuffer fields are correctly detected/re-materialized | unit (jsdom cross-realm iframe technique) | `npm --prefix extension test -- --run content-relay` | ✅ extend existing `describe("cross-realm ArrayBuffer detection...")` block in `content-relay.test.ts` |
| XBR-02 (live-Firefox proof) | Every returned binary field is a genuine same-realm ArrayBuffer (or documented contract-equivalent) on REAL Firefox | e2e (real browser) | `node extension/e2e-firefox/probe-request-xray.cjs` | ✅ upgrade existing XRAY-CREATE/XRAY-GET rows from "known-failing, not asserted" to hard assertions |
| QA-03 | Provider ceremony verifies against an independent RP (webauthn-rs), real signature over real challenge | integration | `cargo test -p pv-provider --test real_rp_verification` | ❌ Wave 0 — new file `crates/pv-provider/tests/real_rp_verification.rs` |
| Record hygiene (success criterion 4) | Debug doc is git-tracked, resolved, moved, mirrored into STATE.md | repo-hygiene (not a test) | `git add .planning/debug/firefox-request-xray-hole.md` then move to `resolved/` | N/A — process step |

### Sampling Rate
- **Per task commit:** `npm --prefix extension test -- --run content-relay` (fast jsdom subset) and/or `cargo test -p pv-provider` for QA-03 work
- **Per wave merge:** Full suite per gate list below
- **Phase gate:** All gates below green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `crates/pv-provider/tests/real_rp_verification.rs` — new file, covers QA-03 (register + authenticate, independent webauthn-rs verifier)
- [ ] `crates/pv-provider/Cargo.toml` `[dev-dependencies]` — add `webauthn-rs = "0.5"` and `uuid.workspace = true`
- [ ] Extend `extension/entrypoints/__tests__/content-relay.test.ts`'s cross-realm describe block for RESPONSE direction (new `it(...)` cases mirroring the existing REQUEST-direction pattern)
- [ ] Upgrade `extension/e2e-firefox/probe-request-xray.cjs`'s XRAY-CREATE/XRAY-GET to capture and assert (not just log) `rawId`/`response.*`/PRF-results realm+byte identity

*(Framework install: none needed — vitest, cargo test, and the e2e-firefox harness are all already installed and configured.)*

### Full gate list this phase must leave green (CONTEXT.md, verbatim baselines)
- `npm --prefix extension test` (vitest, 651 baseline + new response-direction tests)
- `npx tsc --noEmit` (extension)
- `npm run build:chrome` + `npm run build:firefox` (extension)
- `bash scripts/audit-mainworld-boundary.sh` — exit 0
- `node extension/e2e-firefox/run-core.cjs` — 17 PASS + 1 OBSERVED baseline
- `node extension/e2e-firefox/run-server-unlock.cjs` — 15 PASS / 2 INFO / 0 FAIL baseline
- `node extension/e2e-firefox/probe-request-xray.cjs` — all-PASS INCLUDING new response-direction assertions
- `npx playwright test --project=chromium-ceremony` — 5/5 (headed)
- `cargo test --workspace` — green, including the new QA-03 test

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | WebAuthn/passkey ceremony itself (unchanged this phase — this phase VERIFIES it more rigorously, does not alter auth logic) |
| V3 Session Management | no | Not touched this phase |
| V4 Access Control | no | Not touched this phase |
| V5 Input Validation | yes | `handleProviderPageMessage`'s existing origin/nonce/shape validation (D-03/ASVS V5) — CONTEXT.md explicitly forbids touching this logic; any XBR-02 fix must land WITHOUT weakening it |
| V6 Cryptography | yes (verification only) | `webauthn-rs`'s own ES256 signature verification (QA-03) — never hand-rolled; this phase adds a verifier, does not implement crypto |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|----------------------|
| A page spoofing `Symbol.toStringTag` to fake an ArrayBuffer-shaped object (already-known residual risk, IN-01) | Tampering / Denial of Service | Existing try/catch discipline in `handleProviderPageMessage`; ANY new re-materialization code added for XBR-02's fix must adopt the same guard (Pitfall 5) |
| A hostile page attempting to read/tamper with the provider ceremony postMessage channel | Tampering / Information Disclosure | D-03's `location.origin`-only postMessage targeting, `event.source !== window` / `event.origin !== location.origin` checks, single-use nonce ledger — all UNCHANGED and MUST STAY unchanged per CONTEXT.md's explicit constraint |
| Signature/attestation forgery in a WebAuthn ceremony | Spoofing / Tampering | `webauthn-rs`'s own cryptographic verification (ES256) — exactly what QA-03 exercises as the independent check |

## Sources

### Primary (HIGH confidence)
- `/websites/rs_webauthn-rs_webauthn_rs` (Context7, sourced from docs.rs/webauthn-rs) — `WebauthnBuilder::new`, `start_passkey_registration`, `finish_passkey_registration`, `start_passkey_authentication`, `finish_passkey_authentication`, `CreationChallengeResponse`, `RegisterPublicKeyCredential`, `danger-allow-state-serialisation` feature — all `[VERIFIED: Context7 / docs.rs]`
- Direct codebase reads (`[VERIFIED: codebase]`): `extension/entrypoints/content-relay.content.ts` (full file), `extension/entrypoints/page-bridge-firefox.ts` (full file), `extension/entrypoints/page-bridge.content.ts` (full file), `extension/entrypoints/__tests__/content-relay.test.ts` (cross-realm section), `extension/e2e-firefox/probe-request-xray.cjs` (full file), `crates/pv-provider/src/{ceremony.rs,credential_store.rs,error.rs,lib.rs}`, `crates/pv-provider/Cargo.toml`, `crates/pv-server/Cargo.toml`, `crates/pv-server/src/routes/passkeys.rs`, `crates/pv-server/src/routes/auth.rs`, `crates/pv-server/tests/{passkeys.rs,passkey_login.rs,extension_passkeys.rs,unlock.rs}`, `scripts/audit-mainworld-boundary.sh`, `Cargo.lock` (pinned versions), `.planning/debug/firefox-request-xray-hole.md` (full doc), `.planning/debug/resolved/firefox-injection-csp-blocked.md` (convention precedent)

### Secondary (MEDIUM confidence)
- [MDN — Share objects with page scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Sharing_objects_with_page_scripts) — `[CITED]` general Xray/cloneInto/exportFunction guidance for content-script↔page object sharing; corroborates the class of hazard XBR-02 investigates but does not exhaustively document postMessage's specific nested-ArrayBuffer behavior — treat as supporting evidence, not proof of the exact mechanism
- WebSearch results on "Firefox WebExtension content script postMessage to page ArrayBuffer instanceof Xray wrapper" — `[CITED]` corroborates that Xray wrappers are a documented, general source of instanceof-mismatch-with-intact-data symptoms in this exact browser/architecture, consistent with (but not conclusive proof of) the observed bug

### Tertiary (LOW confidence)
- None used as load-bearing claims in this document — all findings above either trace to a direct codebase read, Context7-sourced official docs, or a fetched MDN page; genuinely unresolved questions are recorded in Open Questions rather than asserted.

## Metadata

**Confidence breakdown:**
- Standard stack (webauthn-rs API, pv-provider API): HIGH — Context7 + direct codebase reads, cross-checked against existing production usage in `pv-server`
- Architecture (XBR-02 data-flow mapping): HIGH for the mechanical trace (direct code read); MEDIUM/LOW for the ROOT CAUSE of the response-direction discrepancy specifically — this is the phase's own open empirical question, not something research alone can settle
- Pitfalls: HIGH for QA-03 pitfalls (grounded in direct code/API comparison); MEDIUM for XBR-02 Pitfall 2 (Xray mechanism) since MDN's own docs are incomplete for this exact scenario

**Research date:** 2026-07-20
**Valid until:** 2026-08-19 (30 days — stack is stable; the debug doc's own findings are the primary time-sensitive input and are unlikely to change unless a new Firefox release alters Xray-wrapper/postMessage semantics)
