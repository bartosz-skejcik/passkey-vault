---
phase: 12-passkey-provider
reviewed: 2026-07-16T17:55:04Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - extension/entrypoints/page-bridge.content.ts
  - extension/entrypoints/page-bridge-firefox.ts
  - extension/entrypoints/content-relay.content.ts
  - extension/lib/messaging/page-protocol.ts
  - extension/lib/messaging/ext-protocol.ts
  - extension/entrypoints/background/router.ts
  - extension/entrypoints/background/provider-ceremony.ts
  - extension/entrypoints/background/credential-store.ts
  - extension/lib/crypto/wasm-loader.ts
  - extension/lib/vault/types.ts
  - extension/entrypoints/popup/App.tsx
  - extension/entrypoints/popup/ProviderCeremonyView.tsx
  - crates/pv-provider/src/ceremony.rs
  - crates/pv-provider/src/credential_store.rs
  - crates/pv-wasm/src/lib.rs
  - crates/pv-provider/src/lib.rs
  - crates/pv-provider/src/error.rs
  - scripts/audit-mainworld-boundary.sh
  - extension/wxt.config.ts
findings:
  critical: 3
  warning: 4
  info: 4
  total: 11
status: issues_found
---

# Phase 12: Passkey Provider - Code Review Report

**Reviewed:** 2026-07-16T17:55:04Z
**Depth:** deep
**Files Reviewed:** 14 source files (crates/pv-provider, crates/pv-wasm, extension/)
**Status:** issues_found

## Summary

The zero-knowledge trust boundary itself holds up well: no plaintext private-key material crosses the WASM→JS boundary (`WasmCreateProviderResult`/`WasmGetProviderResult` expose only ciphertext + public response JSON; `new_passkey_json` stays a local `String`), origin/RP-ID binding is genuinely delegated to `passkey-client` (proven by the `origin_mismatch_rejected` test), the MAIN-world files are import-clean, the ISOLATED-world message gate (`event.source===window` + origin-pin + single-use nonce ledger) is correct, and `guard.origin` (sender-verified) — never a payload field — is the only origin fed to the ceremony.

However, the phase ships with **three correctness BLOCKERs that make the provider silently non-functional for large, common classes of real ceremonies** — and each one fails *safe* (fall-through to native), so no test and no happy-path UAT catches them:

1. The base64url boundary (D-21) is **incomplete** — PRF `eval` inputs are left as `ArrayBuffer` and mangled to `{}` on the `sendMessage` hop, breaking the entire request the moment an RP requests PRF-with-eval (the headline provider-PRF feature, D-16).
2. `credentials.get()` with an **omitted `rpId`** (spec-valid and extremely common) can never match a vault credential — the candidate filter keys on `""`.
3. The MAIN-world `RESPONSE_TIMEOUT_MS = 5000` is far shorter than any human interaction, so it **kills the only reachable consent surface** (the multi-match picker) and the D-09 locked-unlock path, and for `create()` while locked it **creates an orphaned vault/server credential the RP never received**.

Plus Firefox-specific Permissions-Policy fail-open, a browser-blaming PRF copy string that contradicts D-16, and the assessed background leak behind the known `waitForUnlock` gap.

## Structural Findings (fallow)

No `<structural_findings>` block was provided with this review; no structural pre-pass to reconcile.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: D-21 base64url boundary omits PRF `eval` inputs — every PRF-with-eval ceremony fails and falls through to native

**File:** `extension/entrypoints/content-relay.content.ts:468-495` (`encodePublicKeyOptions`)
**Issue:** `encodePublicKeyOptions` base64url-encodes only `challenge`, `user.id`, `excludeCredentials[].id`, and `allowCredentials[].id`. It shallow-copies the rest (`{ ...src }`), so `extensions.prf.eval.first` / `.second` (and `evalByCredential`) — supplied by the RP as raw `ArrayBuffer`/`TypedArray`, which survive the MAIN→ISOLATED structured-clone hop intact — are **not** encoded. On the very next hop (ISOLATED→background `runtime.sendMessage`), Chrome JSON-serializes and turns those `ArrayBuffer`s into `{}` (the exact failure mode the whole `*B64`/D-21 discipline exists to prevent). In the background, `JSON.stringify({ publicKey: req.publicKey })` then produces `"eval":{"first":{}}`, and `serde_json::from_str::<CredentialRequestOptions>` (ceremony.rs:129) / `CredentialCreationOptions` rejects `{}` where a base64url `Bytes` string is required → `PvProviderError::Serde` → handler returns `{ failed: true }` → page-bridge falls through to native. Net effect: **any RP that sends PRF `eval` inputs on `get()` (the primary provider-PRF use case, D-16's "works on Firefox too" headline) never gets served by the vault at all** — the request cannot even be parsed. This is precisely the "binary leaking as `{}`" the review brief asked to hunt for, and it defeats a first-class feature while looking like a benign fall-through.
**Fix:** Encode the PRF eval inputs (and any other binary extension inputs) before `sendMessage`. In `encodePublicKeyOptions`, after copying `extensions`:
```ts
if (typeof src.extensions === "object" && src.extensions !== null) {
  const ext = { ...(src.extensions as Record<string, unknown>) };
  const prf = ext.prf as { eval?: Record<string, unknown>; evalByCredential?: Record<string, unknown> } | undefined;
  if (prf?.eval) {
    const e = { ...prf.eval };
    if (isBufferSource(e.first)) e.first = bufferSourceToB64Url(e.first);
    if (isBufferSource(e.second)) e.second = bufferSourceToB64Url(e.second);
    ext.prf = { ...prf, eval: e };
  }
  if (prf?.evalByCredential) {
    const byId: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(prf.evalByCredential)) {
      const vv = v as Record<string, unknown>;
      byId[k] = {
        ...vv,
        ...(isBufferSource(vv.first) ? { first: bufferSourceToB64Url(vv.first) } : {}),
        ...(isBufferSource(vv.second) ? { second: bufferSourceToB64Url(vv.second) } : {}),
      };
    }
    ext.prf = { ...(ext.prf as object), evalByCredential: byId };
  }
  out.extensions = ext;
}
```
Add a `get()`-with-`prf.eval` fixture to the round-trip test so this regression is gated.

### CR-02: `credentials.get()` with an omitted `rpId` never matches a vault credential

**File:** `extension/entrypoints/background/provider-ceremony.ts:274-282, 412-417` (`extractRpId` / `handleCredentialsGet`)
**Issue:** `extractRpId` returns `""` when the RP's request omits `rpId`. Per the WebAuthn spec, `rpId` is *optional* on `get()` and defaults to the caller origin's effective domain — many real relying parties rely on that default and send no `rpId`. `handleCredentialsGet` then calls `findMatchingPasskeyItems(getItems(), "")`, and every stored passkey item has a concrete `rpId` (e.g. `"example.com"`), so the filter matches nothing → `{ fallthrough: true }`. Result: **the vault silently refuses to serve `get()` for every RP that omits `rpId`**, even when a perfectly matching credential exists. `passkey-client` itself would compute the correct effective `rpId` from the origin, but the pre-WASM candidate lookup short-circuits before it ever runs. Fails safe (native fall-through), so no unit test or happy-path UAT (which uses an explicit `rpId` fixture) catches it.
**Fix:** Default the lookup key to the sender origin's host when `rpId` is absent:
```ts
const rpId = extractRpId(req.publicKey) || (() => {
  try { return new URL(senderOrigin).hostname; } catch { return ""; }
})();
```
(`passkey-client` still performs the authoritative registrable-suffix validation during signing, so this only widens the candidate search, it does not weaken origin binding.)

### CR-03: `RESPONSE_TIMEOUT_MS = 5000` breaks the only reachable consent UI and orphans locked-vault `create()` credentials

**File:** `extension/entrypoints/page-bridge.content.ts:45` and `extension/entrypoints/page-bridge-firefox.ts:42` (`RESPONSE_TIMEOUT_MS`)
**Issue:** The MAIN-world `relay()` resolves `null` (→ native fall-through) after a hard 5-second timeout for *every* ceremony. Two consequences:
- **Multi-match picker (the ONLY interactive consent surface in the whole feature) is unusable.** `resolvePasskeyChoice` opens the popup and awaits the user's selection; a human cannot see the popup, read the anti-phishing consent screen, pick an account, and confirm within 5s of the original `get()` call. The page falls through to native at 5s while the extension picker is still open — the user sees *both* prompts, and when they finally pick, `handleCredentialsGet` signs a valid assertion that page-bridge has already discarded (`settled === true`). The consent gate (D-11) is effectively dead.
- **Locked-vault `create()` orphans a credential.** With the vault locked, `openPopupAndAwaitUnlock()` awaits an unlock the user cannot complete in 5s. Page-bridge times out → native `create()` runs → the RP registers a *native* passkey. Then the user unlocks (~8-15s), the background resumes, `wasmCreateProviderCredential` mints a **new** passkey and persists it to the vault and the server — a credential whose public key the RP never received. The vault now holds a phantom passkey that will not authenticate against that RP. This is a real data-integrity divergence, not just a UX wart.
- The header comment ("long enough for a popup-unlock round trip") is simply incorrect for any human-in-the-loop path.
**Fix:** Decouple the page-side safety-net timeout from the interactive budget: raise it well past a human interaction window (e.g. 120000ms) so interactive paths can complete, and additionally gate `persistPendingProviderItem`/the create response on the ceremony still being live (e.g. resolve `openPopupAndAwaitUnlock` with a cancellable token, and skip persistence if the page already abandoned the ceremony). A background→page "still working" heartbeat, or having the page await a background-owned resolution rather than a fixed client timer, is the more robust structural fix. Mirror the change in both `page-bridge.content.ts` and `page-bridge-firefox.ts` (they duplicate the constant verbatim).

## Warnings

### WR-01: Permissions-Policy check fails open on Firefox — D-20(b) is not enforced there

**File:** `extension/entrypoints/page-bridge-firefox.ts:71-88` (and `page-bridge.content.ts:73-90`)
**Issue:** `isPermissionsPolicyBlocked` returns `false` ("not blocked") when neither `document.permissionsPolicy` nor `document.featurePolicy` exists — and, as the file's own comment admits, Firefox implements neither, so on Firefox the provider brokers ceremonies **without ever consulting `Permissions-Policy: publickey-credentials-create/get`**. D-20(b) ("respect Permissions-Policy before brokering; if it blocks, don't broker") is therefore silently a no-op on the entire Firefox surface. Origin/RP-ID binding still holds (so this is not direct credential theft), but the specific "silently brokering past a page's own policy" class D-20(b) was written to close (the 1Password-wrapper issue) remains open on Firefox.
**Fix:** Where the detection surface is absent, fall back to the delegation-aware default rather than blanket fail-open: for a *sub-frame*, treat the feature as blocked unless the frame is same-origin with the top document (the browser default for these two policy-controlled features is `"self"`), and only fail-open for the top-level frame. At minimum, document this as an accepted, security-review-tracked Firefox gap in `deferred-items.md` rather than an inline `return false`.

### WR-02: `prfUnavailableNote` copy blames "this browser," contradicting D-16 (capability-driven, never browser)

**File:** `extension/lib/i18n/dictionary.ts:216-219` (`provider.prfUnavailableNote`)
**Issue:** The user-facing string reads "Ta przeglądarka nie obsługuje rozszerzenia PRF… / This browser doesn't support the PRF extension this site requested." Under D-16 the provider computes PRF entirely in WASM (`HmacSecretConfig`) regardless of browser, and `derivePrfCapability`'s actual reason is credential/authenticator-scoped ("the vault-backed authenticator did not report hmac-secret support"). Attributing unavailability to the *browser* is factually wrong for the provider role and re-introduces the browser-framing D-16 explicitly forbids — it will confuse users on Firefox where provider-PRF is supposed to work.
**Fix:** Reword to attribute the limitation to the credential/site request, not the browser, e.g. "Ta strona poprosiła o PRF, którego ten passkey nie obsługuje…" / "This site requested a PRF feature this passkey can't provide…". Keep the trigger wired to the real capability signal (already correct).

### WR-03: Known `waitForUnlock()` gap — assessed NOT user-facing/exploitable, but leaks background state

**File:** `extension/entrypoints/background/provider-ceremony.ts:206-217` (`waitForUnlock`), `224-231` (`openPopupAndAwaitUnlock`)
**Issue (assessment of the pre-documented gap, per review brief — not raised as new):** `waitForUnlock()` never resolves and never `unsubscribe()`s if the user closes the popup while the vault stays locked. Contrary to the deferred-items note wording, the *page's* promise does **not** hang indefinitely — the MAIN-world 5s timeout (CR-03) resolves it to native fall-through. So the defect is **not user-facing and not exploitable**: what actually leaks is a permanently-pending `subscribeSessionLockState` subscription plus a stale `pv-pending-provider-ceremony: true` entry in `chrome.storage.session`, both reclaimed on the next MV3 idle-kill. Net severity is low (background resource hygiene), but it is a real leak and it interacts with CR-03: fixing CR-03's timeout structurally (cancellable resolution) is what should also cancel this subscription.
**Fix:** Give `openPopupAndAwaitUnlock`/`waitForUnlock` a cancellation path (abort signal or timeout) that calls `unsubscribe()` and removes `PENDING_CEREMONY_KEY`; wire it to the same ceremony-abandoned signal proposed in CR-03.

### WR-04: `PENDING_CEREMONY_KEY: true` boolean flag is written but never read or cleared

**File:** `extension/entrypoints/background/provider-ceremony.ts:225` (`openPopupAndAwaitUnlock`), cross-ref `extension/entrypoints/popup/App.tsx:91-106`
**Issue:** `openPopupAndAwaitUnlock` writes `{ [PENDING_CEREMONY_KEY]: true }`, but `App.tsx`'s `checkPendingCeremony` only accepts the *object* picker payload (`isPendingCeremonyPickerPayload` requires `requestId`+`candidates`), so the boolean is never consumed by any reader. It is also never removed on the unlock success path (only `resolvePasskeyChoice` removes the key), so after a locked `create()`/single-`get()` completes, a stale `true` lingers in `storage.session` for the rest of the session, sharing a key whose other writer (`resolvePasskeyChoice`) uses an incompatible object shape. It is harmless today (no reader trips on the boolean) but it is dead, confusing state on a security-sensitive storage key.
**Fix:** Either drop the boolean write entirely (App.tsx already handles the locked case via `session.status`→UnlockView), or clear it after `waitForUnlock()` resolves; do not overload one storage key with two incompatible value shapes.

## Info

### IN-01: D-20(a) non-configurable accessor and D-12 coexistence are in direct tension

**File:** `extension/entrypoints/page-bridge.content.ts:250-275` (and firefox twin `225-250`)
**Issue:** Installing `navigator.credentials.create/get` as `configurable: false, writable: false` (mandated by D-20a) means whichever password-manager extension patches the property *first* permanently locks out all others — a later PM's own `Object.defineProperty` throws. D-12 asks the design to coexist with a second PM "from the first version." The `try/catch` here only protects *this* extension when it loses the race; it cannot un-break the *other* PM when this extension wins it. This is an inherent D-20a↔D-12 conflict worth surfacing explicitly to the security-phase review (most PMs also use non-configurable, so the practical outcome is "first installed wins"), and it should be exercised in the D-12 two-extensions UAT.
**Fix:** No code fix available while D-20a stands; document the accepted trade-off and add the two-PM install-order case to the security-phase checklist.

### IN-02: MAIN-world grep-audit is shallow (top-level literal strings, no transitive/bundle check)

**File:** `scripts/audit-mainworld-boundary.sh:31-46`
**Issue:** The audit greps only the two entry files for a fixed literal set (`pv-wasm|passkey-…|lib/crypto|lib/vault`). It does not follow imports transitively and does not inspect the built MAIN-world bundle. Today the sole import (`lib/messaging/page-protocol`, a zero-import pure-types file) makes this sound, but a future edit that imports a *different* `lib/messaging/*` module with runtime deps would pass the audit while pulling forbidden code into the MAIN world. `lib/messaging` is not in the forbidden set.
**Fix:** Add a bundle-level assertion (grep the emitted MAIN-world chunk under `.output/**` for the forbidden symbols) or an import-graph check, so the guarantee tracks what actually ships, not just the two source files' top lines.

### IN-03: MAIN-world response can be spoofed by same-page script — self-harm only, not a cross-boundary vuln

**File:** `extension/entrypoints/page-bridge.content.ts:119-137` (`onMessage`)
**Issue:** The ceremony request is `window.postMessage`'d in the page's MAIN world, so any script on the page can read the fresh `nonce` and immediately post a forged `{ source: "pv-content-relay", nonce, kind: "credential"|"fallthrough", … }` that passes every gate and is accepted as the first matching-nonce response. Because the page *is* the relying party for its own `navigator.credentials` call, this only lets a page tamper with a ceremony it already fully controls (inject/suppress its own result) — there is no cross-origin or secret-exfiltration path (no User Key/PRF secret ever travels on this channel). Documented for completeness; not actionable as a vulnerability.
**Fix:** None required. If defense-in-depth is desired later, deliver responses over a `MessageChannel` port transferred to content-relay rather than broadcast `postMessage`.

### IN-04: `SerializablePasskey` mirror silently drops any future `passkey_types` fields

**File:** `crates/pv-provider/src/credential_store.rs:61-123`
**Issue:** The hand-rolled DTO mirrors `Passkey`/`StoredHmacSecret`/`CredentialExtensions` field-by-field (CBOR only for `key`). The round-trip is sound for the pinned 0.5.0 shape, but a future `passkey-rs` bump that adds a field to any of these structs would silently lose it on the `passkey_to_json`→`passkeys_from_json` round-trip (potentially corrupting a stored credential) with no compile error. The pin mitigates this today.
**Fix:** Add a `#[deny]`-style guard or a test that constructs a fully-populated `Passkey` and asserts field-count/round-trip equality, so an upstream field addition breaks CI rather than data.

---

_Reviewed: 2026-07-16T17:55:04Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
