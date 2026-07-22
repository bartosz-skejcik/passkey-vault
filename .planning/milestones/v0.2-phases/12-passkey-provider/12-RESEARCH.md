# Phase 12: Passkey Provider - Research

**Researched:** 2026-07-14
**Domain:** MV3 browser extension acting as a WebAuthn/passkey provider (MAIN-world RPC shim + `passkey-rs` soft authenticator + PRF), integrating with existing `pv-core`/`pv-wasm`
**Confidence:** MEDIUM-HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Architecture / trust boundary**
- **D-01:** Three-context bridge is mandatory: MAIN-world page-bridge (key-free RPC shim, captures native `navigator.credentials` refs) → ISOLATED-world content-relay (validates/shapes `postMessage`, forwards via `browser.runtime.sendMessage`/`Port`) → background service worker (sole owner of passkey-rs, WASM, unlocked User Key, ceremony logic).
- **D-02:** The MAIN-world file must be dependency-free and never import `pv-wasm`/`passkey-rs` or touch raw key bytes, PRF output, or the unwrapped User Key — even transiently. This is the grep-auditable line PROV-05 requires and the security review checks.
- **D-03:** `window.postMessage` payloads between MAIN and ISOLATED worlds carry only opaque WebAuthn ceremony data (challenge, credential ID, signed assertion, RP/user info) — never secrets — because the channel is page-readable by any script.
- **D-04:** Injection timing uses MV3's native `world: 'MAIN'` content-script field at `document_start` (not the older `<script>`-tag injection workaround).
- **D-05:** The background service worker is the only place passkey-rs/pv-wasm are imported/instantiated — never in popup or content scripts.

**Crypto / authenticator**
- **D-06:** `passkey-authenticator`/`passkey-client`/`passkey-types` (passkey-rs, 1Password's open-sourced crates, pinned together at the same version) is the soft ES256 WebAuthn authenticator — do not hand-roll a WebAuthn authenticator.
- **D-07:** New passkeys created via `create()` are stored as vault credential items using the existing `pv-core` wrap/AEAD primitives (Argon2id/XChaCha20-Poly1305/HKDF-SHA256) — no second, divergent crypto implementation.
- **D-08:** All HKDF domain-separation constants used by the provider ceremony must be versioned byte strings, distinct from existing `pv:pw-unlock:v1` / `pv:prf-unlock:v1` contexts — never reused across contexts.

**Session / key lifecycle**
- **D-09:** The provider ceremony consumes the already-unlocked User Key from `chrome.storage.session` (Phase 9's session core) — it never re-derives or re-stores key material outside that established envelope. If the vault is locked when a ceremony is invoked, the background opens the popup for an unlock prompt before proceeding rather than failing the ceremony outright.
- **D-10:** Every message handler in the background treats itself as possibly just-woken (re-check `storage.session`, don't assume in-memory state survived).

**Fallback / coexistence**
- **D-11:** Fall-through to the native OS authenticator (or another installed password-manager extension) is required whenever the user declines the vault's prompt or no matching credential exists in the vault — the patched functions must never throw uncaught or dead-end the page's promise.
- **D-12:** The extension must not assume exclusive ownership of `navigator.credentials` — design for coexistence with another installed password-manager extension from the first version, verified in UAT with a second extension installed simultaneously.

**PRF / cross-browser**
- **D-13:** PRF is attempted where the browser/authenticator combination supports it (Chromium-first, feature-detected via `clientExtensionResults.prf.enabled` at ceremony time); wherever unavailable (Firefox, Safari/iOS-roaming-key combinations, etc.) the flow must degrade with an honest, specific message — never a silent failure or generic error.
- **D-14:** Password/session-based access must remain the universal fallback path everywhere in this phase's UX — PRF is never a hard requirement to complete a provider ceremony.

**Security review gate**
- **D-15:** This phase is not complete until `/gsd-secure-phase` confirms (via grep-audit) that no User Key, PRF output, or plaintext crosses into MAIN-world JS — this is a named ROADMAP success criterion (#5), not an optional nice-to-have.

### Claude's Discretion
- Exact WASM module boundary: whether passkey-rs is compiled into the same WASM binary as `pv-wasm` or a sibling module loaded alongside it in the background.
- Exact UX/UI of the in-popup ceremony prompt (which passkey to use when multiple match an RP, decline button copy, PRF-unavailable message wording) — this phase has `UI hint: yes`, so a UI-researcher/ui-phase pass is appropriate.
- Whether the "if locked, open popup and await unlock" flow (D-09) blocks the ceremony with a timeout, and what that timeout is.
- Exact mechanism for storing the newly-created passkey private key material in `chrome.storage.session` between ceremony and vault-save persistence (i.e., the precise envelope shape) — Pattern 2 in ARCHITECTURE.md describes the general shape but leaves exact structure to implementation.
- Whether/how the extension surfaces "Passkey Vault will handle this" vs. "using your device" messaging.

### Deferred Ideas (OUT OF SCOPE)
- `chrome.webAuthenticationProxy`-based provider path — explicitly deferred beyond v0.2 (revisit only if w3c/webextensions#361 standardizes).
- FIDO CXF (credential-exchange-format) import/export inside the extension UI — belongs to the vault data layer, tracked separately, not this phase.
- Icon-in-field indicator polish / right-click context-menu quick actions for the provider flow — extension polish (v0.2.x), out of this milestone's core scope.
- Dedicated dual-browser (Chrome/Firefox) verification pass and `web-ext lint`/signed-build hardening — explicitly Phase 13's job (this phase only needs to implement the Firefox PRF-fallback message itself, per D-13).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|--------------------|
| PROV-01 | On a third-party site, `navigator.credentials.create()` registers a new passkey that is stored in the user's vault (ES256 soft authenticator via `passkey-rs`) | `passkey-authenticator`/`passkey-client` 0.5.0 API confirmed (Standard Stack, Code Examples); persistence path confirmed reusing unmodified `encrypt_item`/`encryptItem` (Architecture Pattern 1) |
| PROV-02 | On a third-party site, `navigator.credentials.get()` logs the user in with a passkey saved in their vault | Same `Client`/`Authenticator` chain (`authenticate()`/`get_assertion()`); `CredentialStore::find_credentials()` reads back via `decryptItem` |
| PROV-03 | When the user declines, or the vault holds no matching credential, the extension falls through cleanly to the native OS authenticator (never dead-ends the ceremony) | Confirmed `passkey-client::Client` has no native concept of fallback (always reports Platform/internal) — fallback decision must live in this project's own router/ceremony logic (Anti-Patterns, Architecture Diagram) |
| PROV-04 | PRF is used where the browser allows it (Chromium-first); on Firefox / where PRF is unavailable the flow degrades honestly with a clear fallback | `clientExtensionResults.prf.enabled` (create-time only) / `.prf.results` (get-time only) feature-detection semantics confirmed (Common Pitfalls #2, Code Examples); `HmacSecretConfig`/`AuthenticationExtensionsPrfValues` API located in passkey-rs |
| PROV-05 | The page-injected `navigator.credentials` patch is a key-free RPC shim — no User Key, PRF output, or plaintext ever crosses into the MAIN world; all crypto runs in the background (zero-knowledge; gated by a security review) | Grep-auditable choke-point pattern confirmed against this repo's existing `web/src/lib/crypto/index.ts` convention (Common Pitfalls #5); Validation Architecture adds a concrete grep-audit script recommendation; Security Domain section maps this to ASVS V5/V6 |
</phase_requirements>

## Summary

Phase 12 has no official platform API to build on (`w3c/webextensions#361` is still open) — every shipping competitor (Bitwarden, 1Password, Dashlane) solves this the same way: monkey-patch `navigator.credentials.create`/`.get` from a MAIN-world script, relay via `postMessage` to an ISOLATED content script, forward to a privileged background context that owns the real WebAuthn/CTAP2 logic. This is the only viable architecture today, already locked in CONTEXT.md (D-01–D-05), and this research confirms and grounds it against the actual `passkey-rs` 0.5.0 API surface and this project's existing `pv-core`/`pv-wasm` code.

The critical technical finding not fully covered by CONTEXT.md: **WXT's declarative `world: 'MAIN'` content-script field is Chrome-only** — Firefox does not support it and WXT's own maintainers recommend manual `<script>`-tag injection via WXT's `injectScript()` helper for Firefox. D-04 locks "use native `world: 'MAIN'`" without a browser qualifier; the planner must decide explicitly whether Phase 12 implements the Firefox-specific injection path now (cheap, keeps parity) or ships Chrome-only MAIN-world injection and defers the Firefox variant to Phase 13 (consistent with ROADMAP's phase split, since Phase 12's own Success Criteria don't mandate a Firefox pass — only PROV-04's PRF fallback message does). Either choice is legitimate; it must not be silently missed.

`passkey-rs` 0.5.0 (`passkey-authenticator`/`passkey-client`/`passkey-types`, verified current via crates.io, published 2026-01-07) provides exactly the chain CONTEXT.md's D-06 requires: `Client` (maps `create()`/`get()` ceremonies) → `Authenticator` (does the CTAP2 crypto, ES256-only, confirmed by the crate's own "Current Limitations") → a `CredentialStore` implementation this project supplies. The output of `Authenticator::make_credential()` is a `Passkey` value that must be handed to this project's *existing* `pv-wasm::encryptItem()`/`pv-core::items::encrypt_item()` — no new crypto primitive is needed to persist it (D-07 is already directly satisfiable with code that exists today). PRF/hmac-secret support lives in `passkey_authenticator::extensions::HmacSecretConfig` and `passkey_types::webauthn::AuthenticationExtensionsPrfValues{ first, second: Bytes }`, present as inputs/outputs on both ceremonies — confirming CONTEXT.md D-13's "feature-detect via `clientExtensionResults.prf.enabled`" is only valid at `create()` time; actual PRF *values* only arrive on a subsequent `get()`.

**Primary recommendation:** Build the 3-hop bridge exactly as CONTEXT.md's D-01–D-05 specify; wire `passkey-rs`'s `Authenticator`/`Client`/`CredentialStore` trio into a new sibling WASM module (or the same `pv-wasm` binary) loaded once in the background per ARCHITECTURE.md Pattern 3; persist newly-created passkeys through the unmodified `encryptItem`/`decryptItem` pv-wasm bindings; and resolve the Firefox MAIN-world-injection gap explicitly in the plan rather than assuming WXT's declarative field "just works" cross-browser.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `navigator.credentials` patch / native-ref capture | Browser / Client (MAIN world) | — | Only the page's own JS realm can intercept calls the page makes; must stay key-free per D-02/D-05 |
| postMessage validation, DOM message relay | Browser / Client (ISOLATED content script) | — | Trust boundary between untrusted page and extension-privileged code; owns nothing beyond message shaping |
| WebAuthn/CTAP2 ceremony orchestration (passkey-rs) | Background service worker (API/Backend-equivalent tier for an extension) | — | Sole owner of WASM, unlocked User Key, passkey-rs `Authenticator`/`Client` — the extension's "server" tier |
| PRF eval + feature detection | Background service worker | Browser (native WebAuthn API call itself) | The PRF ceremony call goes through the real browser WebAuthn API (native, browser-mediated); the *result* is consumed only in background |
| New passkey credential persistence | Background (encrypt) → pv-server (opaque storage) | Database/Storage (SQLite, unchanged) | Reuses existing vault CRUD/sync — no new server routes; passkey item is just another `EncryptedItem` |
| Fall-through to native/other-provider authenticator | Browser / Client (native WebAuthn call itself) | Background (decision logic: "do we have a match?") | The actual native ceremony is browser-native; background/MAIN-world code only decides whether to intercept or fall through |
| Popup unlock-prompt trigger (if vault locked mid-ceremony) | Background (opens popup) → Popup UI | — | Consumes Phase 9's existing session core; not re-implemented here |

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `passkey-authenticator` | crates.io | published 2023-02-08, latest 2026-01-07 | ~81.5k/wk | github.com/1Password/passkey-rs | OK | Approved |
| `passkey-client` | crates.io | published 2023-02-08, latest 2026-01-07 | ~81.4k/wk | github.com/1Password/passkey-rs | OK | Approved |
| `passkey-types` | crates.io | published 2023-02-08, latest 2026-01-07 | ~93.5k/wk | github.com/1Password/passkey-rs | OK | Approved |

**Packages removed due to `[SLOP]` verdict:** none.
**Packages flagged as suspicious `[SUS]`:** none for this phase's *new* Cargo dependencies. (Note: `wxt` and `@wxt-dev/browser` — the npm-side extension framework already adopted in Phase 8, not newly introduced here — were flagged `SUS`/"too-new" by the automated legitimacy gate on their *latest published version's* recency, despite ~700-785k weekly downloads and an established GitHub repo (`wxt-dev/wxt`). This is very likely a false positive of the "too-new" heuristic reacting to a recent patch release, not a supply-chain risk, but per protocol it must be re-verified — via a `checkpoint:human-verify` — wherever Phase 8's `wxt`/`@wxt-dev/browser` version pin is (re)installed or bumped. Phase 12 does not add these as *new* dependencies; it inherits Phase 8's pin. No action needed in this phase's plan unless the pin is bumped here.)

All three `passkey-rs` crates are `[VERIFIED: crates.io registry + 1Password/passkey-rs official repo]` — confirmed both by the automated legitimacy check (`OK` verdict) and by fetching the crate's own README/docs.rs pages directly (not merely a registry existence check).

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `passkey-authenticator` | 0.5.0 [VERIFIED: crates.io, confirmed current 2026-07-14] | Soft CTAP2 authenticator: `make_credential()`/`get_assertion()`, ES256-only, PRF/hmac-secret extension | Same crate 1Password ships in their own extension; already locked by D-06 |
| `passkey-client` | 0.5.0 [VERIFIED: crates.io] | WebAuthn L3 client marshaling: `Client::register()`/`authenticate()` map directly to `create()`/`get()` | Handles origin/RP-ID validation (`RpIdVerifier`, `public-suffix`) so this project doesn't hand-roll it |
| `passkey-types` | 0.5.0 [VERIFIED: crates.io] | Shared type definitions (`webauthn::*`, `ctap2::*`) both other crates depend on | Must pin identically to the other two — all three are released from one workspace/monorepo |
| `pv-wasm` (existing, unchanged) | pinned `wasm-bindgen=0.2.126` [VERIFIED: `crates/pv-wasm/Cargo.toml`] | `encryptItem`/`decryptItem`/`wrapUserKey`/`unwrapUserKey` opaque-handle bindings | Already the project's crypto choke-point (`web/src/lib/crypto/index.ts`); reused unchanged, not forked, for the extension |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `wxt` | 0.20.27 [VERIFIED: npm, matches Phase 8/STACK.md pin] | Extension framework, dual Chrome/Firefox build | Already Phase 8's decision; Phase 12 only adds the MAIN-world entrypoint + new background message handlers on top |
| `@wxt-dev/browser` | 0.2.2 [VERIFIED: npm] | Typed `browser.*` API | Same, inherited from Phase 8 |
| `@webext-core/fake-browser` (via WXT's `WxtVitest` plugin) | current, bundled by `wxt/testing` [CITED: wxt.dev/guide/essentials/unit-testing] | In-memory `browser.*` polyfill for Vitest unit tests | Test the ceremony-routing logic (router.ts dispatch, PRF feature-detection, fall-through decisions) without a real browser |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `passkey-rs` (Rust, compiled to WASM) | Hand-rolled CTAP2/WebAuthn authenticator in TS | Never — explicitly out of scope per REQUIREMENTS.md "no second, divergent crypto implementation"; also reimplementing CTAP2 correctly is a multi-month project on its own |
| WXT declarative `world: 'MAIN'` (Chrome) | Manual `<script>` injection everywhere (both browsers) | Manual injection works identically cross-browser but adds indirection Chrome doesn't need; recommend declarative for Chrome, manual `injectScript()` only for Firefox, to minimize divergence while still being correct |
| `chrome.webAuthenticationProxy` | MAIN-world monkey-patch | Rejected — single-occupant, Chrome-only, built for remote-desktop/enterprise scenarios (already excluded in REQUIREMENTS.md Future Requirements) |

**Installation:**
```bash
# In the crate that will host the extension's authenticator logic
# (either crates/pv-wasm directly, or a new sibling crate — see
# "Discretion Areas" in CONTEXT.md, still undecided by design):
cargo add passkey-authenticator@0.5.0
cargo add passkey-client@0.5.0
cargo add passkey-types@0.5.0
```

**Version verification:** All three crate versions were verified directly against the crates.io registry API on 2026-07-14 (`max_stable_version`/`newest_version` both `0.5.0`, last published 2026-01-07) — no drift from the prior v0.2 STACK.md research on the same date.

## Architecture Patterns

### System Architecture Diagram

```
Third-party page (untrusted, MAIN world)
    │  navigator.credentials.create()/get() called by page JS
    ▼
page-bridge.content.ts (MAIN world, key-free RPC shim)
    │  captures native fn refs; serializes ceremony args
    │  window.postMessage(origin-pinned, nonce'd)          ── untrusted boundary ──
    ▼
content-relay.content.ts (ISOLATED world)
    │  validates event.source===window, origin, nonce
    │  browser.runtime.sendMessage({kind:'credentials.create'|'credentials.get', ...})
    ▼
router.ts (background service worker)
    │  re-checks storage.session (D-10: assume just-woken)
    ├─ locked? → open popup, await unlock (D-09) ──┐
    │                                                │
    ▼ unlocked                                       │
provider-ceremony.ts                                 │
    │  builds passkey-client Client + Authenticator  │
    │  + this project's CredentialStore (reads/writes│
    │  vault items via pv-wasm encrypt/decryptItem)   │
    ├─ create(): Authenticator::make_credential()     │
    │     → new Passkey → encryptItem() → vault item  │
    │     → sync-client.ts pushes to pv-server (unchanged CRUD)
    ├─ get(): decrypt matching item → Authenticator::get_assertion()
    │     → optional PRF eval (native WebAuthn PRF call, not passkey-rs)
    └─ no match / user declines → respond "fall through"
    ▼
router.ts serializes PublicKeyCredential-shaped response
    ▼
content-relay.content.ts → window.postMessage → page-bridge.content.ts
    ▼
page-bridge resolves the original create()/get() Promise
    (or, on fall-through signal, invokes the ORIGINAL native
     navigator.credentials.create/get it captured at patch time)
```

### Recommended Project Structure

Extends ARCHITECTURE.md's structure (already scaffolded by Phases 8-10) with Phase 12's new files:

```
extension/
├── entrypoints/
│   ├── background/
│   │   ├── provider-ceremony.ts   # NEW — Client/Authenticator/CredentialStore wiring, create()/get() orchestration
│   │   ├── credential-store.ts    # NEW — implements passkey-rs CredentialStore against pv-wasm encrypt/decryptItem
│   │   └── router.ts              # EXTENDED — new 'credentials.create'/'credentials.get' message cases
│   ├── page-bridge.content.ts     # NEW — MAIN world, Chrome: world:'MAIN' declarative field
│   ├── page-bridge.ts             # NEW — unlisted script asset injected manually on Firefox via injectScript()
│   └── content-relay.content.ts   # EXTENDED (from Phase 10) — new 'credentials.*' message kinds
├── lib/
│   └── messaging/
│       └── page-protocol.ts       # EXTENDED — 'credentials.create'/'credentials.get' envelope shapes
└── crates/                        # or reuse existing crates/pv-wasm — see Discretion Areas in CONTEXT.md
    └── (passkey-rs wiring, new HKDF domain-separation constant per D-08)
```

### Pattern 1: `CredentialStore` implemented against existing `pv-wasm` bindings, not a new store

**What:** `passkey-rs`'s `Authenticator` needs a type implementing its `CredentialStore` trait (`save_credential()`/`find_credentials()`). Rather than storing `Passkey` values in a separate in-memory or IndexedDB store, this project's `credential-store.ts`-equivalent Rust wiring should serialize the `Passkey` (via `serde_json`, since `passkey-types` derives `Serialize`/`Deserialize`) and hand the JSON straight to the *existing* `encryptItem(uk, plaintext_json, item_id, revision)` binding — exactly the same call `web/src/lib/crypto/index.ts` already exposes for every other vault item type.

**When to use:** Any time a new passkey is created (`credentials.create()`) or an existing one needs to be read back for a `get()` ceremony.

**Example (grounded in the actual existing code, not invented):**
```rust
// Source: crates/pv-core/src/items.rs (existing, unmodified) +
// crates/pv-wasm/src/lib.rs's #[wasm_bindgen(js_name = encryptItem)]
// binding (existing, unmodified).
//
// A newly created Passkey (from passkey_authenticator::Authenticator::
// make_credential()) is JSON-serialized (passkey-types derives Serialize)
// and passed as `plaintext` — no new pv-core function is required:
let item = core_encrypt_item(&uk, passkey_json.as_bytes(), item_id, revision)?;
```

### Pattern 2: New HKDF domain-separation constant for provider-created key material (D-08)

**What:** If any *new* wrapping/derivation step is introduced specifically for the provider ceremony (e.g., deriving an ephemeral key to protect the passkey's private key material during the short window between ceremony and vault-save persistence — ARCHITECTURE.md Pattern 2's "extension session key" recommendation), it MUST use a new, versioned byte-string constant distinct from the three that already exist.

**Existing pattern to follow exactly** [VERIFIED: `crates/pv-core/src/keys.rs:18-20`]:
```rust
pub const INFO_PW_UNLOCK: &[u8] = b"pv:pw-unlock:v1";
pub const INFO_PRF_UNLOCK: &[u8] = b"pv:prf-unlock:v1";
pub const INFO_AUTH_HASH: &[u8] = b"pv:auth-hash:v1";
```
A new constant for this phase should follow the same shape, e.g. `pub const INFO_PROVIDER_CRED: &[u8] = b"pv:passkey-provider-cred:v1";` (exact name is the planner's/executor's call — the versioned-byte-string *shape* and *never reused* rule is what's locked, per D-08).

### Pattern 3: Firefox MAIN-world injection is NOT the same code path as Chrome

**What:** [CITED: wxt.dev content-scripts docs + wxt-dev/wxt Discussion #523 / Issue #1158, cross-verified via WebSearch 2026-07-14] Firefox does not support WXT's declarative `world: 'MAIN'` content-script field the way Chrome does. WXT's own recommended workaround is to define the MAIN-world script as an **unlisted script asset** and inject it via `browser.scripting`/DOM `<script src>` injection (WXT ships an `injectScript()` helper for exactly this) from the ISOLATED-world content script, on **both** browsers if full parity is wanted, or conditionally only on Firefox if Chrome keeps the declarative field.

**When to use:** Any time this phase's MAIN-world patch needs to load correctly on Firefox, not just Chrome. Per-browser conditional entrypoint options are supported by WXT (`world` can be keyed by target browser in the entrypoint definition).

**Trade-offs:** Declarative `world:'MAIN'` (Chrome) is simpler and has zero extra injection latency; `injectScript()` (Firefox, or both-browsers-for-uniformity) adds one extra DOM step but is the only path that works on Firefox at all.

**Recommendation for this phase's plan:** Decide explicitly — either (a) implement the Firefox variant now (small extra task, keeps Phase 12's "acts as a full passkey provider" claim honestly cross-browser from day one), or (b) explicitly scope Phase 12 to Chrome-only for the MAIN-world patch and record the Firefox variant as Phase 13's job. Do not let this decision default silently to "declarative `world:'MAIN'` works everywhere" — it does not.

### Anti-Patterns to Avoid

- **Running `passkey-rs`'s `Authenticator`/`Client` inside the MAIN-world script "to save a hop":** This is Pitfall 5 verbatim — the single most severe possible mistake in this milestone. `Authenticator`/`Client`/`CredentialStore` must only ever be instantiated in the background service worker.
- **Storing the new passkey's `Passkey` value anywhere other than through `encryptItem`:** Would create a second, parallel, unencrypted-at-rest store for credential material, defeating zero-knowledge and violating REQUIREMENTS.md's "no second, divergent crypto implementation."
- **Assuming `Client`'s reported "Platform" attachment / "internal" transport means anything about actual fallback behavior:** [CITED: 1Password/passkey-rs README "Current Limitations"] `passkey-client::Client` always reports itself as a platform authenticator with "internal" transport — it has no concept of "this RP wants a roaming/native key, fall through." That decision must be made entirely by this project's own ceremony-routing logic (does the vault have a matching credential? did the user decline?), never delegated to passkey-rs.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CTAP2/WebAuthn authenticator crypto | A custom ES256 signing + attestation authenticator in TS/WASM | `passkey-authenticator`/`passkey-client`/`passkey-types` 0.5.0 | Correctly implementing WebAuthn L3 + CTAP2 (RP-ID/origin validation, attestation formats, extension negotiation) is a multi-month effort with severe security-bug surface; 1Password already maintains and ships this exact crate |
| Effective-TLD / public-suffix matching for RP-ID validation | Custom domain-suffix parser | `passkey-client`'s bundled `public-suffix` dependency (used internally by `Client`) | Public-suffix-list correctness (e.g. `co.uk`, multi-label ccTLDs) is a maintained, frequently-updated dataset — reinventing it is a known footgun |
| Cross-browser MAIN-world script injection | A single injection code path assumed to work identically on Chrome/Firefox | WXT's per-browser entrypoint config (`world:'MAIN'` for Chrome, `injectScript()` for Firefox) | Confirmed by WXT's own maintainers that Firefox genuinely lacks the declarative MAIN-world mechanism — this is a platform gap, not a WXT bug to work around differently |

**Key insight:** Every piece of this phase's "hard part" (CTAP2 crypto, RP-ID validation, MAIN-world cross-browser injection) already has a maintained, purpose-built solution (`passkey-rs`, WXT's injection helpers) — the phase's actual engineering work is the *wiring* (message routing, key material discipline, PRF feature-detection, vault persistence), not reimplementing any of these primitives.

## Runtime State Inventory

Not applicable — this phase is new feature construction (a new MAIN-world patch, a new background ceremony module, a new vault item sub-type), not a rename/refactor/migration. No existing stored data, live service config, OS-registered state, secrets, or build artifacts carry a name that this phase changes.

**Nothing found in any category** — verified by reading `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and the existing `crates/` tree; this phase only *adds* new files/constants (per D-08, a brand-new versioned HKDF constant, never colliding with or renaming `INFO_PW_UNLOCK`/`INFO_PRF_UNLOCK`/`INFO_AUTH_HASH`).

## Common Pitfalls

*(Full detail already captured in `.planning/research/PITFALLS.md` Pitfalls 1, 2, 5 and the Integration Gotchas/Security Mistakes tables — summarized here with this phase's specific angle; do not re-litigate, just apply.)*

### Pitfall 1: MAIN-world patch race / coexistence (locked as D-11/D-12)
**What goes wrong:** Another installed password-manager extension (or the browser's native passkey UI) patches `navigator.credentials` too; whichever patches last "wins," or both wrap each other.
**How to avoid:** Store native refs before patching; never throw uncaught from inside the patched functions; explicitly UAT with a second password-manager extension installed (D-12 requires this).
**Warning signs:** Double-prompts, or the extension's patch silently never firing, when a second manager is installed.

### Pitfall 2: PRF assumed available without feature-detection (locked as D-13/D-14)
**What goes wrong:** Code assumes `clientExtensionResults.prf` exists on every `get()` response.
**Why it happens:** PRF is Chromium/Android-first; Firefox (139+) and Safari/iOS-external-key combinations are narrower or absent, per the already-completed PITFALLS.md research.
**How to avoid:** Check `clientExtensionResults.prf?.enabled` at `create()` time (this is the *only* place `enabled` appears, per this phase's verified crate/spec research); at `get()` time, absence of the `prf` key means "not supported for this credential," not an error — degrade to password unlock, never throw.

### Pitfall 5: Key material reachable from the page (locked as D-02/D-15, THE central risk)
**What goes wrong:** Any raw key byte, PRF output, or unwrapped User Key value executes in or crosses through MAIN-world JS, even transiently.
**How to avoid:** The MAIN-world file (`page-bridge.content.ts`/`page-bridge.ts`) must never `import` anything from `pv-wasm`, `passkey-authenticator`, `passkey-client`, or `passkey-types` — grep-auditable, exactly like `web/src/lib/crypto/index.ts` is today the sole importer of `./wasm/pv_wasm.js` (verified: no other file under `web/src` imports it). Formalize this as an actual CI/pre-commit grep check for this phase (e.g. a script asserting no MAIN-world entrypoint file references those four package names) — the web app currently enforces this only by code-review convention, not automation; Phase 12's `/gsd-secure-phase` gate (D-15) should verify a grep, not just a manual read-through.

### New pitfall for this phase (not in prior research): Firefox declarative MAIN-world gap
**What goes wrong:** Implementing D-04 ("native `world:'MAIN'` field") without a Firefox-specific branch silently produces a extension where the passkey-provider patch simply never runs on Firefox — no error, no console warning, the page's native/other-provider flow just always wins.
**Why it happens:** WXT's Chrome-first defaults and documentation make the declarative field look cross-browser; it is not.
**How to avoid:** See Architecture Pattern 3 above — branch per-target, or explicitly scope this phase's implementation to Chrome and hand Firefox to Phase 13 with that decision written down, not defaulted.
**Warning signs:** UAT on `wxt dev -b firefox` shows `credentials.create()`/`.get()` going straight to the native browser prompt with no vault interaction at all.

## Code Examples

### `passkey-rs` `Client`/`Authenticator` wiring (registration ceremony)
```rust
// Source: 1Password/passkey-rs README (github.com/1Password/passkey-rs),
// verified against docs.rs/passkey-client 0.5.0 and docs.rs/passkey-authenticator 0.5.0.
use passkey::{
    authenticator::{Authenticator, UserValidationMethod},
    client::{Client, WebauthnError},
    types::{ctap2::*, webauthn::*, Bytes, Passkey},
};

// This project's own CredentialStore impl replaces the crate's toy
// `Option<Passkey>` example — see Architecture Pattern 1 above: it must
// wrap encrypt/decryptItem, never hold plaintext outside the ceremony's
// lifetime.
let store = PvVaultCredentialStore::new(/* handle into background's vault-session */);
let user_validation_method = PvUserValidation {}; // background-owned consent/unlock check
let my_authenticator = Authenticator::new(Aaguid::new_empty(), store, user_validation_method);
let mut my_client = Client::new(my_authenticator);

// `request` is built from the deserialized postMessage payload the
// content-relay forwarded — RP id/name/user/challenge/pubKeyCredParams
// all originate from the third-party page's original create() call.
let credential: CreatedPublicKeyCredential =
    my_client.register(origin, request, DefaultClientData).await?;
```

### PRF/hmac-secret extension configuration (authenticator side)
```rust
// Source: docs.rs/passkey-authenticator 0.5.0, extensions module —
// HmacSecretConfig/HmacSecretCredentialSupport are the CTAP2/WebAuthn
// hmac-secret authenticator-side config; AuthenticationExtensionsPrfValues
// (passkey-types) is the webauthn-level PRF input/output shape used by
// the Client to negotiate with the page/RP.
// Exact wiring call sites are not published in the crate's top-level docs
// (docs.rs module pages list the types but not a full worked PRF example) —
// this is this phase's own integration work, verify signatures directly
// against the pinned 0.5.0 source during planning/implementation, not
// assumed from this summary alone.
```

### Existing pv-core persistence call this phase reuses unchanged
```rust
// Source: crates/pv-core/src/items.rs (existing, verified in this repo)
pub fn encrypt_item(
    uk: &UserKey,
    plaintext: &[u8],   // JSON-serialized Passkey from passkey-rs
    item_id: &str,
    revision: u32,
) -> Result<EncryptedItem, CryptoError>;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `chrome.webAuthenticationProxy` proposals as "the future official API" | Still no shipped W3C API for extension credential providers | `w3c/webextensions#361` remains open [CITED, checked 2026-07-14] | MAIN-world monkey-patch remains the only cross-browser mechanism; do not architect around an API that may never land |
| Assuming WXT's declarative `world` option is uniform across browsers | Confirmed Chrome-only for `'MAIN'`; Firefox needs manual injection | Ongoing, per WXT's own docs/discussions as of this research date | Directly affects this phase's cross-browser correctness — see Pattern 3 |

**Deprecated/outdated:** None specific to this phase beyond the above; `passkey-rs` 0.5.0 is the crate's current stable release (last published 2026-01-07, no newer version at research time).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact PRF wiring call sites (how `HmacSecretConfig`/`AuthenticationExtensionsPrfValues` are threaded through `Authenticator::new()`/`make_credential()`/`get_assertion()` calls) are not fully documented on docs.rs's top-level module pages | Code Examples, Architecture Pattern 1 | If the actual 0.5.0 source API differs from the type-level summary here, the PRF ceremony wiring may need adjustment during implementation — verify directly against the pinned crate source (or its `passkey`/`passkey-authenticator` `tests/` directory) at plan/implementation time, not from this research alone |
| A2 | Firefox's WXT `injectScript()` / manual-injection recommendation is current as of this research date, sourced from WXT's own docs/discussion threads, not a hands-on test in this repo | Architecture Pattern 3, Pitfalls | If WXT has since shipped native Firefox MAIN-world support, the manual-injection workaround may be unnecessary overhead — re-check `wxt.dev` content-scripts docs against the WXT version actually pinned by Phase 8 before implementing |
| A3 | The exact directory/module layout for Phases 8-11 (background `router.ts`, `vault-session.ts`, `sync-client.ts`, content-relay messaging conventions) is inherited from ARCHITECTURE.md's *proposed* structure, not from actual Phase 8-11 SUMMARY.md files — those phases are not yet executed (0/TBD plans per ROADMAP progress table) | Recommended Project Structure, Integration Points | If Phases 8-11 land with materially different file names/conventions than ARCHITECTURE.md proposed, Phase 12's plan must re-verify against the actual Phase 8-11 SUMMARY.md files before writing tasks, not assume the proposed structure held exactly |
| A4 | The `wxt`/`@wxt-dev/browser` "too-new" `SUS` verdict from the automated package-legitimacy gate is a false positive (heuristic reacting to latest-version publish recency, not package age) | Package Legitimacy Audit | If wrong, a genuinely compromised/hijacked publish could go unchecked; mitigate by re-running the legitimacy check at the exact moment Phase 8's pin is installed/bumped, not relying on this phase's read alone |

## Open Questions

1. **Exact `CredentialStore`/`UserValidationMethod` trait implementation shape for this project**
   - What we know: The trait signatures exist (`save_credential`/`find_credentials`, user-interaction hook) and the crate ships a trivial `Option<Passkey>` example implementation.
   - What's unclear: Whether the vault-backed store should eagerly decrypt all passkey items matching an RP at `find_credentials()` time (simpler, more decrypt calls) or lazily fetch by credential ID once the RP's `allowCredentials` list is known (fewer decrypts, more round-trips to background's own vault-session state).
   - Recommendation: Decide during planning based on typical vault size — for a self-hosted personal/family vault (not enterprise scale), eager decrypt-and-filter is likely simpler and fast enough; document the choice, don't leave it implicit.

2. **Whether the ephemeral "extension session key" pattern (ARCHITECTURE.md Pattern 2, for surviving SW idle-kill) is a prerequisite dependency this phase needs from Phase 9, or something Phase 12 must extend itself for the *new* passkey's private key material specifically.**
   - What we know: Phase 9 establishes the general `chrome.storage.session` envelope for the unlocked User Key.
   - What's unclear: Whether a newly-created (but not-yet-persisted-to-server) passkey's private key material needs its own short-TTL holding pattern between the `create()` ceremony completing and the vault-save/sync round-trip completing (e.g. if the SW is killed mid-sync).
   - Recommendation: Verify against Phase 9's actual SUMMARY.md once it exists; if no such gap exists (sync completes synchronously within the ceremony's message-response cycle before responding to the page), this can be a non-issue — confirm, don't assume.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Rust stable + `wasm32-unknown-unknown` target | Compiling `passkey-rs` into WASM alongside `pv-wasm` | ✓ | cargo 1.97.0, target installed per `rust-toolchain.toml` | — |
| Node.js / npm | WXT build tooling (inherited from Phase 8) | ✓ | Node v24.18.0, npm 11.16.0 | — |
| `wasm-bindgen-cli` (pinned `=0.2.126`) | Generating JS/TS glue for the WASM binary | Not found in a quick `wasm-bindgen --version` check, but `scripts/build-wasm.sh` self-installs the exact pinned version idempotently via `cargo install wasm-bindgen-cli --version ... --locked` | auto-installed on first build | Existing build script already handles this — no new tooling needed |
| `extension/` WXT project scaffold | Everything in this phase | Not yet created (Phase 8 not yet executed) | — | Phase 12 depends on Phase 8-11 completing first per ROADMAP; verify their actual output before starting Phase 12 tasks |

**Missing dependencies with no fallback:** None — everything either already exists in the toolchain or is self-installing via the existing build script.
**Missing dependencies with fallback:** `extension/` scaffold doesn't exist yet at research time, but this is expected (Phase 12 depends on Phases 8-11, not yet started) — not a blocker for *this phase's* research, but the planner must re-verify actual Phase 8-11 output before writing Phase 12 tasks (see Assumption A3).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest, via WXT's `WxtVitest` plugin + `@webext-core/fake-browser` [CITED: wxt.dev/guide/essentials/unit-testing] |
| Config file | `extension/vitest.config.ts` — not yet created (Phase 8 scaffolding responsibility); Phase 12 adds test files under it |
| Quick run command | `npm --prefix extension test -- --run <test-file>` (exact script name TBD by Phase 8's `package.json`) |
| Full suite command | `npm --prefix extension test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|-------------|
| PROV-01 | `credentials.create()` registers a new ES256 passkey saved to the vault | unit (ceremony logic) + manual UAT (real page) | `vitest run provider-ceremony.test.ts` | ❌ Wave 0 |
| PROV-02 | `credentials.get()` authenticates with a saved passkey | unit + manual UAT | `vitest run provider-ceremony.test.ts` | ❌ Wave 0 |
| PROV-03 | Fall-through to native authenticator on decline/no-match | unit (router decision logic) + manual UAT with 2nd extension | `vitest run router.test.ts` | ❌ Wave 0 |
| PROV-04 | PRF used where available; honest fallback message elsewhere | unit (feature-detection logic, mocked `clientExtensionResults`) + manual UAT on Firefox | `vitest run prf-detection.test.ts` | ❌ Wave 0 |
| PROV-05 | MAIN-world file never touches key material (grep-audited) | automated grep check + `/gsd-secure-phase` review | `grep -rlE "pv-wasm|passkey-(authenticator|client|types)" extension/entrypoints/page-bridge*.ts` (expect zero matches) | ❌ Wave 0 — this grep script itself doesn't exist yet and should be written as part of this phase |

### Sampling Rate
- **Per task commit:** targeted `vitest run <changed-file>.test.ts`
- **Per wave merge:** full `vitest run` + the PROV-05 grep-audit script
- **Phase gate:** Full suite green + `/gsd-secure-phase` grep-audit pass before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `extension/vitest.config.ts` with `WxtVitest()` plugin — if not already established by Phase 8/9/10/11
- [ ] `extension/entrypoints/background/provider-ceremony.test.ts` — covers PROV-01/02
- [ ] `extension/entrypoints/background/router.test.ts` (extended) — covers PROV-03 fall-through decision logic
- [ ] A standalone grep-audit script (e.g. `scripts/audit-mainworld-boundary.sh`) asserting the MAIN-world entrypoint file(s) never reference `pv-wasm`/`passkey-*` — covers PROV-05, should run in CI, not just at `/gsd-secure-phase` time

*(If Phases 8-11 already established `extension/vitest.config.ts` and a general test-running convention, only the PROV-specific test files and the new grep-audit script are actual gaps — verify against their SUMMARY.md files before treating the config file itself as a Wave 0 gap.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | yes | WebAuthn ceremony itself (browser-native origin/RP-ID binding) + `passkey-client`'s `RpIdVerifier`; this project must not weaken or bypass either |
| V3 Session Management | yes (inherited from Phase 9) | `chrome.storage.session`-only unlocked-key storage, `chrome.alarms`-based auto-lock — this phase consumes, doesn't reimplement |
| V4 Access Control | yes | Background must verify `sender.tab`/`sender.frameId`/origin from `runtime.onMessage`'s sender object (not just the payload's self-reported origin) before routing a ceremony — per ARCHITECTURE.md Anti-Pattern 3 |
| V5 Input Validation | yes | `content-relay.content.ts` must validate `event.source === window`, pin `event.origin`, and require a per-message nonce round-trip before forwarding anything to background |
| V6 Cryptography | yes | ES256 signing + PRF/hmac-secret handled entirely by `passkey-rs` (never hand-rolled) and `pv-core`'s existing Argon2id/XChaCha20-Poly1305/HKDF-SHA256 primitives (never a second implementation) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Forged `postMessage` from arbitrary page script mimicking the extension's protocol | Spoofing / Tampering | `event.source===window` check, origin pinning, per-message nonce round-trip, background independently verifying `sender` metadata (not the payload's self-reported fields) |
| Key material (User Key, PRF output, unwrapped passkey private key) reachable from MAIN-world/page-observable JS | Information Disclosure | Hard architectural rule (D-02/D-15): MAIN-world file never imports `pv-wasm`/`passkey-rs`; grep-audit enforced, `/gsd-secure-phase` gate before merge |
| Two password-manager extensions racing to patch `navigator.credentials`, one silently shadowing the other | Denial of Service (of the ceremony, not the whole page) | Store native refs before patching, wrap all delegate calls in try/catch, never throw uncaught, explicit multi-extension UAT (D-12) |
| A page instrumenting the MAIN-world patch itself (prototype pollution, `Object.defineProperty` traps, Proxy on globals) to observe intermediate state | Information Disclosure / Tampering | Keep the MAIN-world script's own intermediate state limited to opaque, already-serialized ceremony data — never a live reference to anything crypto-bearing, even transiently |
| Firefox build silently shipping a non-functional passkey-provider patch (no MAIN-world injection working at all) | (Not a STRIDE security threat per se, but a correctness/trust failure — users believe the feature works) | Explicit per-browser UAT before considering PROV-01/02 "done" on a given browser; do not claim cross-browser parity Phase 12 doesn't actually implement (see Pattern 3) |

## Sources

### Primary (HIGH confidence)
- crates.io API (`passkey-authenticator`, `passkey-client`, `passkey-types`) — exact current versions (0.5.0) and publish dates, verified directly 2026-07-14
- `gsd-tools query package-legitimacy check --ecosystem crates` — OK verdicts for all three passkey-rs crates, confirmed via GitHub repo signal
- [1Password/passkey-rs README](https://github.com/1Password/passkey-rs) — fetched directly 2026-07-14; `Client`/`Authenticator`/`CredentialStore` chain, worked code examples, "Current Limitations" (ES256-only, Platform-attachment-only)
- [docs.rs/passkey-authenticator/0.5.0](https://docs.rs/passkey-authenticator/0.5.0/passkey_authenticator/) — fetched directly; `extensions` module (`HmacSecretConfig`, `HmacSecretCredentialSupport`)
- [docs.rs/passkey-types/0.5.0 AuthenticationExtensionsPrfValues](https://docs.rs/passkey-types/0.5.0/passkey_types/webauthn/struct.AuthenticationExtensionsPrfValues.html) — fetched directly; `first`/`second: Bytes` field shape
- This repo's existing code: `crates/pv-core/src/keys.rs`, `crates/pv-core/src/items.rs`, `crates/pv-core/src/prf.rs`, `crates/pv-wasm/src/lib.rs`, `web/src/lib/crypto/index.ts`, `scripts/build-wasm.sh` — read directly, ground truth for reuse patterns

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md`, `PITFALLS.md`, `STACK.md`, `FEATURES.md`, `SUMMARY.md` — completed v0.2 research, read in full
- [wxt.dev — Unit Testing](https://wxt.dev/guide/essentials/unit-testing) — WxtVitest/fake-browser, via WebSearch 2026-07-14
- [wxt-dev/wxt Discussion #523](https://github.com/wxt-dev/wxt/discussions/523) / [Issue #1158](https://github.com/wxt-dev/wxt/issues/1158) — Firefox MAIN-world limitation, via WebSearch, cross-checked against STACK.md's prior citation of the same sources
- [w3c/webextensions#361](https://github.com/w3c/webextensions/issues/361) — no shipped credential-provider extension API, confirmed still open
- [Chrome for Developers — Manifest CSP reference](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) — `wasm-unsafe-eval` requirement, via WebSearch
- WebAuthn PRF explainer / MDN WebAuthn extensions / Yubico PRF developer guide — `clientExtensionResults.prf.enabled` (create-time only) and `.prf.results.first`/`.second` (get-time only) semantics, via WebSearch

### Tertiary (LOW confidence)
- None used as load-bearing claims in this document; all WebSearch findings above were cross-checked against at least one official-docs source before being included.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified live against crates.io/npm registries on research date, matching prior STACK.md research with no drift
- Architecture: MEDIUM-HIGH — 3-hop bridge pattern fully corroborated by CONTEXT.md's locked decisions and this project's own existing crypto-choke-point code; the specific `CredentialStore`/PRF wiring call sites are MEDIUM (docs.rs module pages list types but not a full worked PRF example — flagged as Assumption A1)
- Pitfalls: MEDIUM-HIGH — five of six pitfalls are directly inherited from the already-completed, cross-checked PITFALLS.md; the new Firefox MAIN-world-injection finding is MEDIUM (WebSearch cross-checked against WXT's own discussion/issue threads, not a hands-on test in this repo)

**Research date:** 2026-07-14
**Valid until:** 30 days for the architecture/pattern guidance (stable); 7 days for the exact `wxt`/`passkey-rs` version pins if Phase 8 hasn't yet locked its own dependency versions (fast-moving npm/crates.io ecosystem, re-verify at plan time if Phase 12 planning happens more than a week after this research)
