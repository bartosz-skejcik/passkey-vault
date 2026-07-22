# Phase 14: Critical Risk Closure — Pattern Map

**Mapped:** 2026-07-20
**Files analyzed:** 8
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|--------------------|------|-----------|-----------------|----------------|
| `extension/entrypoints/page-bridge-firefox.ts` (modify `shapeCredential`) | component (MAIN-world bridge) | transform (realm re-materialization) | itself — `content-relay.content.ts`'s `bufferSourceToB64Url`/`b64UrlToArrayBuffer`/`isCrossRealmArrayBuffer` (D-21 boundary) | exact (same problem class, adjacent file) |
| `extension/entrypoints/content-relay.content.ts` (possible modify — `decodeCredentialResponseJson`/`postToPage`) | middleware/relay (ISOLATED-world) | transform (decode/encode boundary) | itself, same file's `encodePublicKeyOptions`/`isBufferSource` (request-direction fix precedent) | exact |
| `extension/entrypoints/page-bridge.content.ts` | component (Chrome MAIN-world twin) | transform | `page-bridge-firefox.ts`'s `shapeCredential` (identical-rationale twin) | exact |
| `extension/e2e-firefox/probe-request-xray.cjs` (upgrade assertions) | test (live-browser e2e probe) | request-response (real Firefox driver) | itself + `probe-provider-corruption.cjs` (sibling permanent-probe harness) | exact |
| `extension/entrypoints/__tests__/content-relay.test.ts` (extend) | test (jsdom unit) | transform | itself — existing `describe("cross-realm ArrayBuffer detection...")` block (lines 611-765) | exact |
| `crates/pv-provider/tests/real_rp_verification.rs` (new) | test (Rust integration) | request-response (ceremony round-trip) | `crates/pv-server/tests/passkeys.rs` + `crates/pv-provider/src/lib.rs`'s `create_then_get_roundtrip` test | exact (API shape) / role-match (independent-verifier framing) |
| `crates/pv-provider/Cargo.toml` (modify — dev-dependency) | config | — | itself, `[dependencies]` block's existing `passkey-types` feature-flag precedent comment | exact |
| `.planning/debug/firefox-request-xray-hole.md` (git-track/resolve/move) | doc (debug record) | — | `.planning/debug/resolved/firefox-injection-csp-blocked.md` (repo convention precedent) | exact |

## Pattern Assignments

### `extension/entrypoints/page-bridge-firefox.ts` — `shapeCredential()` (fix path (a) landing site)

**Analog:** `extension/entrypoints/content-relay.content.ts` lines 434-501 (D-21 boundary: `isCrossRealmArrayBuffer`, `isBufferSource`, `bufferSourceToB64Url`, `b64UrlToArrayBuffer`)

**Current code to change** (`page-bridge-firefox.ts:223-241`):
```typescript
function shapeCredential(
  credential: unknown,
  credentialJson: unknown,
): Credential {
  const cred = (credential ?? {}) as Record<string, unknown>;
  const extensionResults = (cred.clientExtensionResults as Record<string, unknown>) ?? {};
  return {
    ...cred,
    getClientExtensionResults: () => extensionResults,
    toJSON: () => credentialJson,
  } as unknown as Credential;
}
```
This is a SHALLOW spread — per RESEARCH.md's Anti-Patterns, it copies references, never re-creates nested `ArrayBuffer` values in the MAIN-world's own realm. This is the file where fix path (a) most likely lands.

**Cross-realm brand-check pattern to reuse** (`content-relay.content.ts:456-466`):
```typescript
function isCrossRealmArrayBuffer(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

function isBufferSource(value: unknown): value is BufferSource {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) || isCrossRealmArrayBuffer(value);
}
```

**Byte re-materialization pattern to reuse/adapt for MAIN-world construction** (`content-relay.content.ts:481-501`):
```typescript
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
**Adaptation note:** if fix path (a) is chosen, a MAIN-world-executing version of `b64UrlToArrayBuffer` must run INSIDE `page-bridge-firefox.ts` (using `page-bridge-firefox.ts`'s own `ArrayBuffer`/`Uint8Array`/`atob` globals, not content-relay's ISOLATED-world ones) against the ALREADY-AVAILABLE `credentialJson` string (the same-shape original JSON `respondToPage()` already parses per `postToPage`'s `credentialJson` field — RESEARCH.md's Code Examples section, line 357) — i.e., decode `rawId`/`response.*`/PRF `results.*` fields a SECOND time, natively, in MAIN world, rather than trusting the ISOLATED-world-decoded `credential` object's nested values to survive the postMessage hop.

**Fields that need coverage** (mirrors `content-relay.content.ts:600` `RESPONSE_BINARY_FIELDS` + the PRF path at lines 637-655):
```typescript
const RESPONSE_BINARY_FIELDS = ["clientDataJSON", "attestationObject", "authenticatorData", "signature", "publicKey"];
// plus: top-level rawId, response.userHandle, clientExtensionResults.prf.results.{first,second}
```

**Error-handling / spoof-guard discipline to mirror** (Pitfall 5, IN-01 precedent — `content-relay.content.ts:784-802`, `handleProviderPageMessage`'s encode-time try/catch): any new MAIN-world re-materialization logic must be wrapped so a malformed/spoofed value cannot throw uncaught into the RP page's promise chain — matches `broker()`'s existing outer `try { ... } catch { return original(options); }` in this same file (lines 251-276), which is already the fail-safe pattern this file uses everywhere.

---

### `extension/entrypoints/content-relay.content.ts` — root-cause/fix site (fallback if path (b) or ISOLATED-side changes needed)

**Analog:** itself — same file's `decodeCredentialResponseJson` (lines 609-658) and `postToPage`/`respondToPage` (lines 675-744)

**Header/ownership comment to amend if D-21 wording changes** (`content-relay.content.ts:360-383`):
```typescript
// this is the ONLY place in this file that ever touches base64url encode/decode --
// page-bridge itself stays completely free of any encoding logic (D-21), ...
```
Per CONTEXT.md: if fix path (a) lands MAIN-world decode logic in `page-bridge-firefox.ts`, this comment's "100% ownership" claim must be updated in the SAME commit — do not let the comment veto the correct fix (already-existing MAIN-world b64url helpers precedent noted in `page-bridge-firefox.ts`'s own file header, lines 1-39).

**Existing decode-side pattern (already correct, reused as reference shape):**
```typescript
// content-relay.content.ts:609-658, decodeCredentialResponseJson()
// full field list: rawId, response.{clientDataJSON,attestationObject,authenticatorData,signature,publicKey},
// response.userHandle, clientExtensionResults.prf.results.{first,second}
```

---

### `extension/entrypoints/page-bridge.content.ts` — Chrome twin (verify-unaffected or mirror)

**Analog:** `page-bridge-firefox.ts`'s `shapeCredential` (identical-rationale duplicate per both files' own header comments: "duplicated verbatim rather than factored into a shared module... if you change the patch logic here, mirror the change there too")

Action: confirm Chrome's MAIN<->ISOLATED hop (declarative `world:'MAIN'`, no Xray hazard per `content-relay.content.ts:452-454` "Chrome has no equivalent hazard on this hop") stays a no-op for this fix; only mirror the change if the shared file (`content-relay.content.ts`) itself changes in a way both builds consume.

---

### `extension/e2e-firefox/probe-request-xray.cjs` — upgrade response-direction assertions

**Analog:** itself (full file read, 383 lines) + `probe-provider-corruption.cjs` (sibling permanent-probe convention, cited in this file's own header)

**Harness skeleton to keep unchanged** (`probe-request-xray.cjs:71-165`): geckodriver `Builder`/`firefox.Options`, fixed profile UUID (`PV_FF_FIXED_UUID`), CSP-strict fixture server on `:8899` via `/provider-csp`, `record()`/`shot()` helpers writing to `RESULTS_FILE`/`SHOTS`.

**`record()` pattern (reuse exactly):**
```javascript
const results = {};
function record(id, status, notes) {
  results[id] = { status, notes };
  fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`\n[${status}] ${id}\n  ${notes}\n`);
}
```

**Currently-skipped assertion to upgrade to hard assertion** (`probe-request-xray.cjs:260-296`, especially the "KNOWN to fail" comment block at lines 37-56 which must be REMOVED with the fix):
```javascript
// Captured but NOT gated today:
rawIdIsArrayBuffer: cred.rawId instanceof ArrayBuffer,
rawIdToStringTag: Object.prototype.toString.call(cred.rawId),
rawIdCtorName: cred.rawId && cred.rawId.constructor ? cred.rawId.constructor.name : null,
rawIdIsView: ArrayBuffer.isView(cred.rawId),
```
Upgrade target: for each response-direction binary field (`rawId`, `response.clientDataJSON`, create: `attestationObject`; get: `signature`+`authenticatorData`; PRF `results.*` where exercised), assert BOTH the realm contract (`instanceof` — or documented contract-equivalent) AND byte-level identity (decoded bytes match expected), following the SAME `challengeMatches`-style PASS/FAIL branch already used for the request direction (lines 293-296, 356-358):
```javascript
const challengeMatches = createResult.clientDataParsed && createResult.clientDataParsed.challenge === CREATE_EXPECTED_B64URL;
record('XRAY-CREATE', challengeMatches ? 'PASS' : 'FAIL', `...`);
```
New probe row candidates for the differential root-cause step (Open Question 1, RESEARCH.md): follow the SAME `driver.executeScript(...)` + `ensurePopup()` + consent-click + `driver.switchTo().window(rpTabHandle)` + `driver.executeScript('return window.__pv_xray_...')` round-trip shape already used for `XRAY-CREATE`/`XRAY-GET` (lines 240-296, 315-359).

---

### `extension/entrypoints/__tests__/content-relay.test.ts` — extend RESPONSE-direction jsdom coverage

**Analog:** itself — existing `describe("cross-realm ArrayBuffer detection (Firefox Xray hole fix)", ...)` block, lines 611-765

**Hidden-iframe cross-realm helper to reuse verbatim:**
```typescript
// content-relay.test.ts:618-637
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

**Test structure to mirror for RESPONSE direction** (request-direction example, lines 639-671 — same `it(...)` shape: dispatch `MessageEvent`, `flushMicrotasks()`, assert on `hoisted.mockSendMessage`/output shape, byte-decode via `Buffer.from(..., "base64url")`):
```typescript
it("a cross-realm (non-TypedArray) ArrayBuffer challenge IS base64url-encoded before sendMessage, and survives a JSON round-trip", async () => {
  const nonce = "nonce-xray-challenge";
  const challengeBytes = [200, 199, 198, 197, 196];
  const request: PageBridgeRequestEnvelope = { /* ... */ publicKey: { rpId: "example.com", challenge: crossRealmArrayBuffer(challengeBytes) } };
  window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
  await flushMicrotasks();
  expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
  const sentMessage = hoisted.mockSendMessage.mock.calls[0][0];
  const roundTripped = JSON.parse(JSON.stringify(sentMessage)) as { publicKey: { challenge: unknown } };
  expect(typeof roundTripped.publicKey.challenge).toBe("string");
  const decoded = Buffer.from(roundTripped.publicKey.challenge as string, "base64url");
  expect(Array.from(decoded)).toEqual(challengeBytes);
});
```
For the new RESPONSE-direction tests, this needs adapting to simulate the ISOLATED→MAIN hop instead (posting a `credential`-shaped `PageBridgeResponseEnvelope` with cross-realm `ArrayBuffer` fields, per `crossRealmArrayBuffer()`, into whatever consumes it — `shapeCredential()` if testable in isolation, or a decode helper extracted for testability).

**Spoof-guard test precedent (IN-01, lines 778-809)** — same "throws inside encode/decode, clean fallthrough, DOM marker cleaned up" contract to apply to any NEW re-materialization code path.

---

### `crates/pv-provider/tests/real_rp_verification.rs` (new file)

**Analog:** `crates/pv-server/tests/passkeys.rs` (webauthn-rs RP-side API usage) + `crates/pv-provider/src/lib.rs`'s `#[cfg(test)] mod tests` (ceremony-producer usage, fixture-building pattern)

**webauthn-rs two-phase ceremony pattern to reuse** (`crates/pv-server/src/routes/passkeys.rs`):
```rust
use webauthn_rs::prelude::{ /* ... */ };
// registration
.start_passkey_registration(user_uuid, &email, &req.display_name, Some(exclude))
.finish_passkey_registration(&req.credential, &persisted.reg)
// authentication
.start_passkey_authentication(std::slice::from_ref(&passkey))
.finish_passkey_authentication(&req.credential, &auth_state)
```

**`WebauthnBuilder` construction pattern** (`crates/pv-server/src/lib.rs:71-76`):
```rust
pub fn build_webauthn(rp_id: &str, rp_origin: &str) -> anyhow::Result<webauthn_rs::prelude::Webauthn> {
    let origin_url = webauthn_rs::prelude::Url::parse(rp_origin).context("invalid PV_ORIGIN")?;
    let webauthn = webauthn_rs::prelude::WebauthnBuilder::new(rp_id, &origin_url)
        // ...
}
```
Per RESEARCH.md Pitfall 4: use `rp_id = "example.com"`, `rp_origin = "https://example.com"` for BOTH `webauthn-rs`'s `WebauthnBuilder` and `pv-provider`'s own `origin` argument — the exact origin string `pv-provider`'s OWN test fixtures already use successfully (see below), avoiding any `allows_insecure_localhost` special-casing.

**Provider-side ceremony call pattern to feed webauthn-rs's challenge into** (`crates/pv-provider/src/ceremony.rs:78-135`, `137-192` — `create_provider_credential`/`get_provider_assertion` public API, unchanged this phase, consumed as-is):
```rust
pub fn create_provider_credential(request_json: &str, origin: &str) -> Result<CreateProviderResult, PvProviderError>
pub fn get_provider_assertion(request_json: &str, origin: &str, existing_credentials_json: &str) -> Result<GetProviderAssertionResult, PvProviderError>
// CreateProviderResult { credential_response_json: String, new_passkey_json: String }
// GetProviderAssertionResult { credential_response_json: String, updated_passkey_json: Option<String> }
```

**Existing round-trip test shape to model the NEW file's structure on** (`crates/pv-provider/src/lib.rs:71-104`, `create_then_get_roundtrip`):
```rust
#[test]
fn create_then_get_roundtrip() {
    let request_json = fixture_create_request("example.com", false);
    let create_result = create_provider_credential(&request_json, "https://example.com")
        .expect("create_provider_credential should succeed");
    // ... feed new_passkey_json into get_provider_assertion as existing_credentials_json ...
}
```
**Key difference for the new test:** replace this fixture's hand-built `serde_json::json!({...})` request with a REAL `webauthn-rs`-issued `CreationChallengeResponse`/`RequestChallengeResponse` (via `start_passkey_registration`/`start_passkey_authentication`), and replace the shape/`.ok`/`id`-only assertions with `webauthn-rs`'s own `finish_passkey_registration`/`finish_passkey_authentication` calls (which must return `Ok(...)`) — per CONTEXT.md, shape-only checks explicitly do not satisfy QA-03.

**Forbidden pattern (explicitly do not use as the "independent" side):** `webauthn_authenticator_rs::softpasskey::SoftPasskey` (used in `crates/pv-server/tests/passkeys.rs` for an unrelated purpose) — same vendor (kanidm) as `webauthn-rs`, not a genuine cross-vendor pairing.

---

### `crates/pv-provider/Cargo.toml` (modify)

**Analog:** itself — existing `[dependencies]` block's `passkey-types` entry with its own inline rationale comment (lines 13-31), the established style for documenting WHY a dependency/feature is added:
```toml
[dependencies]
async-trait = "0.1"
coset = "0.4"
passkey-authenticator = "0.5.0"
passkey-client = "0.5.0"
# D-21 fix (.planning/debug/resolved/firefox-provider-corruption.md): ...
passkey-types = { version = "0.5.0", features = ["serialize_bytes_as_base64_string"] }
pollster = "1"
serde.workspace = true
serde_json.workspace = true
thiserror.workspace = true
url = "2"
```
**New dev-dependency to add** (per RESEARCH.md Installation section):
```toml
[dev-dependencies]
webauthn-rs = "0.5"
uuid.workspace = true
```
Follow the same convention: a short comment explaining WHY (QA-03 independent-verifier requirement, cross-vendor pairing rationale) — mirroring the `passkey-types` feature-flag comment's style.

---

### `.planning/debug/firefox-request-xray-hole.md` (record hygiene)

**Analog:** `.planning/debug/resolved/firefox-injection-csp-blocked.md` (repo convention precedent for resolved debug docs — cited directly in `page-bridge-firefox.ts`'s own header comment, lines 11-16, and in RESEARCH.md's Recommended Project Structure)

Action: `git add` the doc (currently untracked per git status), update its Resolution section for the response direction, set status resolved, move to `.planning/debug/resolved/firefox-request-xray-hole.md`, mirror closure into STATE.md (flip OPEN blocker + Deferred Items row). Keep `awaiting_human_verify` (Bartek's live github.com retest) explicitly open/truthful — do not mark it done.

## Shared Patterns

### D-03/ASVS V5 — postMessage origin discipline (non-negotiable, SECURED)
**Source:** `content-relay.content.ts` (`handleProviderPageMessage`, lines 764-767) and `page-bridge-firefox.ts` (`relay()`'s `onMessage`, lines 180-186; `postToPage`-equivalent send at line 219)
**Apply to:** ANY new MAIN-world or ISOLATED-world code this phase adds.
```typescript
// receive side:
if (event.source !== window || event.origin !== location.origin) { return; }
// send side:
window.postMessage(envelope, location.origin); // NEVER '*'
```

### Fail-safe try/catch discipline (IN-01 precedent)
**Source:** `page-bridge-firefox.ts`'s `broker()` (lines 251-276) and `content-relay.content.ts`'s encode-time guard (referenced at lines 784-802)
**Apply to:** Any new binary-field re-materialization code (Pitfall 5) — wrap in try/catch, fall through cleanly rather than throwing uncaught into the RP page's promise chain.
```typescript
try {
  // re-materialization logic
} catch {
  return original(options); // or equivalent clean fallthrough
}
```

### Cross-realm brand-check widening (the established fix style to extend, not reinvent)
**Source:** `content-relay.content.ts:456-501` (`isCrossRealmArrayBuffer`, `isBufferSource`, `bufferSourceToB64Url`, `b64UrlToArrayBuffer`)
**Apply to:** `page-bridge-firefox.ts` (and `page-bridge.content.ts` if shared-path changes ripple there) — widen detection via `Object.prototype.toString.call`, keep changes minimal and realm-safe, prove with before/after probe runs. Do NOT build a general-purpose deep-clone/rewrap utility (Don't Hand-Roll, RESEARCH.md) — re-materialize ONLY the specific binary fields that need `instanceof` correctness.

### webauthn-rs RP-side API (independent verifier for QA-03)
**Source:** `crates/pv-server/src/lib.rs:71-76` (`build_webauthn`), `crates/pv-server/src/routes/passkeys.rs` (ceremony calls)
**Apply to:** `crates/pv-provider/tests/real_rp_verification.rs`
```rust
let webauthn = WebauthnBuilder::new(rp_id, &rp_origin)?.build()?;
let (ccr, reg_state) = webauthn.start_passkey_registration(Uuid::new_v4(), "qa03@example.com", "QA-03", None)?;
// feed serde_json::to_string(&ccr) into pv_provider::create_provider_credential(...)
let reg: RegisterPublicKeyCredential = serde_json::from_str(&credential_response_json)?;
let passkey = webauthn.finish_passkey_registration(&reg, &reg_state)?;
```

### Permanent-probe harness conventions (Node/geckodriver)
**Source:** `extension/e2e-firefox/probe-request-xray.cjs` (full file), sibling `probe-provider-corruption.cjs`
**Apply to:** any new differential root-cause probe rows added to `probe-request-xray.cjs`
- `record(id, status, notes)` writes incrementally to a `results-*.json` file after every check.
- `shot(driver, name)` screenshots numbered sequentially into a `.ff-screenshots-*` dir.
- Fixed profile UUID (`PV_FF_FIXED_UUID`) + `moz-extension://` origin, CSP-strict fixture server, `sleep()`/`tryFind()` polling helpers — all reused unchanged.

## No Analog Found

None — every file this phase touches has a strong, directly-applicable in-repo analog (the phase is explicitly a hardening/verification phase over existing Phase 12/13 code, not new-surface work).

## Metadata

**Analog search scope:** `extension/entrypoints/`, `extension/entrypoints/__tests__/`, `extension/e2e-firefox/`, `crates/pv-provider/src/`, `crates/pv-provider/`, `crates/pv-server/src/`, `crates/pv-server/tests/`, `.planning/debug/`, `.planning/debug/resolved/`
**Files scanned:** 8 target files + 6 analog source files fully read (page-bridge-firefox.ts, ceremony.rs, pv-provider/Cargo.toml, pv-provider/src/lib.rs, content-relay.content.ts lines 360-1000+, probe-request-xray.cjs, content-relay.test.ts lines 590-810) + grep sweeps over passkeys.rs, pv-server/src/lib.rs, pv-server/src/config.rs
**Pattern extraction date:** 2026-07-20
