# Phase 12: Passkey Provider — Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** ~10 planned new files (extension provider surface; phases 8-11 not yet built, so no in-repo extension scaffold exists yet — analogs are drawn entirely from the v0.1 web app + pv-core/pv-wasm/pv-server)
**Analogs found:** all planned files have at least a partial analog

## Context note

Phases 8-11 (extension bootstrap, session/popup, autofill, generate/capture) have **not been executed yet** — there is no `extension/` directory, no WXT scaffold, and no existing content-script/background-messaging code in this repo to copy from. This phase's plans must therefore either (a) assume phases 8-11 land the messaging/session/background plumbing this phase builds on, or (b) the planner should note this dependency explicitly. Pattern assignments below map the **new logic this phase adds** (MAIN-world RPC shim, background passkey ceremony handler, soft-authenticator wrapper) to the closest analogous **logic patterns already proven in the v0.1 web app and pv-core/pv-server**, since those are the only real code that exists today.

## File Classification

| New/Modified File (expected, phase 12) | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `extension/entrypoints/passkey-provider.content.ts` (MAIN-world injected shim, patches `navigator.credentials.create/get`) | content-script / shim | request-response (RPC to background) | *(no direct analog — new pattern)* `web/src/lib/passkeys/enroll.ts` / `login.ts` for the WebAuthn options shape it must proxy | role-match (WebAuthn shape only) |
| `extension/entrypoints/background/passkeyProvider.ts` (background handler: receives RPC, drives passkey-rs soft authenticator + PRF, talks to session vault) | service (background orchestration) | event-driven (message passing) + CRUD (reads/writes vault passkey items) | `web/src/lib/passkeys/enroll.ts`, `web/src/lib/passkeys/login.ts` | role-match (orchestration logic, pure-function style, `onStep` callback convention) |
| `extension/lib/passkeyRpc.ts` (typed message contract between MAIN-world shim and background — key-free) | utility / message schema | request-response | `web/src/lib/passkeys/api.ts` (thin typed wire-client convention) | role-match |
| `crates/pv-wasm` additions or a new soft-authenticator wrapper crate exposing `passkey-rs` ES256 signing to WASM | service (crypto) | CRUD-ish (sign/verify) | `crates/pv-wasm/src/lib.rs` (`WasmWrappingKey`, `WasmUserKey` opaque-handle pattern) | exact (same "opaque handle, never expose raw bytes" convention) |
| `crates/pv-core/src/passkey_provider.rs` (or similar — soft-authenticator key wrap/storage helpers, domain-separated HKDF for provider-credential private keys) | service (crypto primitives) | transform | `crates/pv-core/src/prf.rs`, `crates/pv-core/src/keys.rs` | exact |
| Vault item type extension for provider-issued passkey credentials (new `ItemFields` variant, e.g. `"passkey"`) | model | CRUD | `web/src/lib/vault/types.ts` (`ItemFields` discriminated union + `normalizeItemFields`) | exact |
| `extension/lib/passkeyProvider/nativeFallback.ts` (falls through to real `navigator.credentials` when vault has no match / user declines) | utility | request-response | `web/src/lib/passkeys/login.ts`'s `isNotAllowedError` cancel-handling branch | role-match |
| `extension/lib/passkeyProvider/errors.ts` | utility | n/a | `web/src/lib/passkeys/errors.ts` | exact |
| Server-side: none expected to change except CORS allowlist (already phase-9 scoped) | config | n/a | `crates/pv-server/src/routes/mod.rs::cors_layer()` | exact |
| Security-review checklist / grep-audit script for zero-knowledge boundary (PROV-05) | test/tooling | n/a | none (new); mirrors doc-comment convention in `pv-wasm/src/lib.rs` module doc | no analog |

## Pattern Assignments

### `extension/lib/passkeyRpc.ts` (message schema, MAIN-world <-> background)

**Analog:** `web/src/lib/passkeys/api.ts` — thin typed wire-client convention (lines 1-18, 43-66)

**Pattern to copy:**
```typescript
// Thin, typed contract only — no interpretation logic here.
// Mirrors api.ts's discipline: challenge/credential/prf_challenge typed
// `unknown` at the wire boundary; the caller (background handler) is the
// only place that interprets WebAuthn JSON shapes.
export interface CreateRpcRequest {
  origin: string;
  publicKey: unknown; // PublicKeyCredentialCreationOptionsJSON, untyped at the boundary
}
export interface CreateRpcResponse {
  credential: unknown; // PublicKeyCredential.toJSON() shape, key-free
}
```
Apply the same "typed `unknown` at the boundary, real interpretation happens one layer up" discipline used throughout `web/src/lib/passkeys/api.ts` (see its module doc comment, lines 1-11) — the MAIN-world shim must NEVER deserialize/interpret credential internals; it only relays opaque JSON to the background over `chrome.runtime.sendMessage`/a `MessageChannel` bridge.

### `extension/entrypoints/background/passkeyProvider.ts` (background orchestration)

**Analog:** `web/src/lib/passkeys/enroll.ts` (full file) and `web/src/lib/passkeys/login.ts` (full file)

**Core pattern to copy — pure orchestration function + step callback** (mirrors `enroll.ts` lines 25-58, `login.ts` lines 86-148):
```typescript
export type ProviderStep = "start" | "ceremony" | "cancelled" | "failed" | "success";

export async function handleCredentialsCreate(
  req: CreateRpcRequest,
  onStep?: (step: ProviderStep) => void,
): Promise<CreateRpcResponse> {
  onStep?.("start");
  // 1. Look up unlocked User Key from chrome.storage.session (background-only)
  // 2. Drive passkey-rs soft authenticator (ES256) — key material NEVER
  //    leaves this background-context function
  // 3. Attempt PRF where browser/session allows it (Chromium-first)
  // 4. On decline / no match -> native fallback (see nativeFallback.ts analog)
}
```
**Zero-knowledge / cancel-handling pattern to copy** (from `login.ts` lines 100-115): use the same `isNotAllowedError(e)` check to distinguish a genuine user cancel from a real failure, and route to native fallback rather than dead-ending the page's login flow (Success Criterion 3). Copy `web/src/lib/passkeys/errors.ts` (`isNotAllowedError`) verbatim into `extension/lib/passkeyProvider/errors.ts`.

**PRF honest-degradation pattern to copy** (from `login.ts` lines 200-221 and `web/src/lib/auth/prfUnavailable.ts`): the two-case collapse (`prf_wrapped_uk === null` vs "extension results unexpectedly absent") both route to a `prfUnavailable: true` result with a specific, user-visible message — never silent failure. Reuse `setPrfUnavailableHint()`'s convention for Firefox/non-Chromium honest degradation (Success Criterion 4).

**Opaque-handle zero-knowledge boundary** (from `pv-wasm/src/lib.rs`, module doc lines 1-9, and `enroll.ts` lines 86-119): PRF bytes / any private key material for the soft authenticator must be consumed through an opaque WASM handle (`WasmWrappingKey`-style) and `.free()`'d immediately after use in a `try/finally`, exactly as `enroll.ts` lines 95-120 do. Never assign raw key bytes to a plain JS variable that could leak to a MAIN-world postMessage.

### `crates/pv-core` — soft authenticator ES256 signing (passkey-rs integration)

**Analog:** `crates/pv-core/src/prf.rs` and `crates/pv-core/src/keys.rs` (wrap/unwrap pattern)

**Domain-separation convention to copy** (from `crates/pv-core/src/keys.rs`, `INFO_PW_UNLOCK`/`INFO_PRF_UNLOCK` constants and `prf.rs`'s `wrapping_key_from_prf`):
```rust
// New versioned domain-separation constant for provider-credential private
// key derivation — never reuse INFO_PW_UNLOCK/INFO_PRF_UNLOCK.
pub const INFO_PROVIDER_CRED_KEY: &[u8] = b"pv:provider-cred:v1";
```
Follow the same `Zeroize + ZeroizeOnDrop` struct pattern as `UserKey`/`WrappedKey` (`crates/pv-core/src/keys.rs:23-47`) for any ES256 private key type wrapping passkey-rs's authenticator key material.

### `crates/pv-wasm/src/lib.rs` additions — opaque handle for soft-authenticator key

**Analog:** `WasmWrappingKey`/`WasmUserKey` (`crates/pv-wasm/src/lib.rs` lines 63-127)

Copy the exact opaque-handle + `to_js_err`/`to_js_str_err` native-vs-wasm32 split convention (lines 29-56) for any new `WasmProviderKey`-style struct exposing sign/verify to the background JS. No method may return raw private-key bytes — only ciphertext (wrapped) or a signature.

### Vault item model extension — new `"passkey"` item type

**Analog:** `web/src/lib/vault/types.ts` lines 1-117 (`ItemType`, `ItemFields` discriminated union, `normalizeItemFields`)

**Pattern to copy:**
```typescript
export type ItemType = "login" | "card" | "identity" | "note" | "totp" | "passkey";

interface PasskeyFields extends CommonFields {
  type: "passkey";
  rpId: string;
  credentialId: string; // base64url
  // wrapped provider-credential private key material (opaque ciphertext,
  // same "server never parses contents" convention as vault.rs enc_data)
  wrappedPrivateKey: string;
  userHandle?: string;
}
export type ItemFields = LoginFields | CardFields | IdentityFields | NoteFields | TotpFields | PasskeyFields;
```
Add a `normalizeItemFields` branch mirroring the existing legacy-login-migration branch (lines 107-117) if any future schema migration is needed — but for a brand-new item type, no legacy branch is required at introduction.

### Native fallback

**Analog:** `web/src/lib/passkeys/login.ts` lines 100-115 (`isNotAllowedError` cancel branch) combined with the "fall through cleanly" requirement (Success Criterion 3, PROV-03).

**Pattern:** the MAIN-world shim's patched `navigator.credentials.create/get` must, on background response indicating "no vault match" or "user declined the vault picker," invoke the ORIGINAL (unpatched) `navigator.credentials.create/get` saved via a closure reference before patching — never re-invoke a patched version (would recurse). Save `const originalCreate = navigator.credentials.create.bind(navigator.credentials);` at shim-install time, same closure-capture discipline used implicitly by every wasm-bindgen handle capture in `pv_wasm.js`.

## Shared Patterns

### Zero-knowledge boundary / opaque handles
**Source:** `crates/pv-wasm/src/lib.rs` (module doc, lines 1-9) + `web/src/lib/passkeys/enroll.ts` (lines 6-11, 86-120)
**Apply to:** every file touching PRF output, the User Key, or the new provider-credential private key.
```typescript
// Never assign raw key bytes to a variable that could be logged, network-
// serialized, or exposed to MAIN-world postMessage. Consume via opaque
// wasm-bindgen handle, .free() in try/finally immediately after use.
const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray
try {
  const wrappedJson = wrapUserKey(wrappingKey, uk);
} finally {
  wrappingKey.free();
}
```

### Cancel vs. failure vs. unavailable (three-way honest branching)
**Source:** `web/src/lib/passkeys/login.ts` lines 100-148, 200-221; `web/src/lib/auth/prfUnavailable.ts`
**Apply to:** the background provider handler and the native-fallback shim logic.
Always distinguish: (1) user explicitly declined (`isNotAllowedError`) → fall through to native silently; (2) genuine failure → surface/log, do not silently swallow; (3) capability unavailable (PRF unsupported on this browser) → explicit, specific user-visible message, never a silent no-op.

### Thin wire-client / typed-unknown boundary
**Source:** `web/src/lib/passkeys/api.ts` lines 1-18
**Apply to:** `extension/lib/passkeyRpc.ts` and any background<->content message contracts.
Keep message-passing modules dumb (typed `unknown` payloads); interpretation of WebAuthn JSON shapes lives exactly one layer up, in the orchestration file (`passkeyProvider.ts`), mirroring `enroll.ts`/`login.ts`'s relationship to `api.ts`.

### CORS / extension origin allowlist
**Source:** `crates/pv-server/src/routes/mod.rs` lines 24-95 (`cors_layer()`)
**Apply to:** no NEW code expected in phase 12 (already scoped to phase 9) — but if this phase needs the server to accept a provider-related endpoint (e.g., storing new `passkey` vault items), it rides the SAME `/api/vault/items` CRUD endpoints already routed in `routes/mod.rs` lines 34-35; no new route/CORS pattern needed.

### Pure-function orchestration + `onStep` callback (no framework state)
**Source:** `web/src/lib/passkeys/enroll.ts` lines 1-4 (module doc), `login.ts` lines 1-4
**Apply to:** `passkeyProvider.ts` background handler — keep it a pure async function reporting progress via a callback, NOT tied to any UI framework state, so it can be unit tested the same way `enroll.test.ts`/`login.test.ts` do (mock `navigator.credentials`, assert on step sequence).

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `extension/entrypoints/passkey-provider.content.ts` (MAIN-world `navigator.credentials` patch itself) | content-script shim | request-response | No existing MAIN-world injection code in this repo (extension scaffold doesn't exist yet — depends on Phase 8-9 groundwork); planner should treat WXT's `content_scripts` `world: "MAIN"` injection as new-pattern territory, referencing 12-RESEARCH.md's code examples instead. |
| `passkey-rs` soft-authenticator integration crate/module | service | transform | First use of `passkey-rs` in this codebase; no prior soft-authenticator wrapper to copy — follow `crates/pv-core`'s existing crypto-module conventions (small focused functions, `Zeroize`, custom error enum) rather than a concrete analog. |
| Security-review grep-audit tooling (PROV-05) | test/tooling | n/a | No existing grep-audit script in the repo; `/gsd-secure-phase` gate is process, not code — no file analog needed. |

## Metadata

**Analog search scope:** `crates/pv-core/src/`, `crates/pv-wasm/src/`, `crates/pv-server/src/routes/`, `web/src/lib/passkeys/`, `web/src/lib/vault/`, `web/src/lib/auth/` (no `extension/` directory exists yet — phases 8-11 not started)
**Files scanned:** ~20 (pv-core: 6, pv-wasm: 1, pv-server routes: 8, web/lib/passkeys: 6, web/lib/vault: 4)
**Pattern extraction date:** 2026-07-14
