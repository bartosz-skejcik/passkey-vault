---
phase: 08-extension-bootstrap-wasm-in-background-spike
reviewed: 2026-07-15T00:00:00Z
depth: deep
files_reviewed: 9
files_reviewed_list:
  - extension/wxt.config.ts
  - extension/entrypoints/background.ts
  - extension/entrypoints/popup/index.html
  - extension/entrypoints/popup/main.ts
  - extension/lib/crypto/wasm-loader.ts
  - extension/lib/crypto/vault-session.ts
  - extension/lib/crypto/vault-session.test.ts
  - extension/vitest.config.ts
  - scripts/build-wasm.sh
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: findings
---

# Phase 8: Code Review Report

**Reviewed:** 2026-07-15
**Depth:** deep
**Files Reviewed:** 9
**Status:** findings

## Summary

Reviewed the Phase 8 extension bootstrap + WASM-in-background spike across all
five review lenses (zero-knowledge boundary, MV3 lifecycle correctness,
build-wasm.sh additivity/idempotency, and JS-boundary zeroization hygiene).

The zero-knowledge boundary holds. The spike envelope persisted to
`chrome.storage.session` contains only `wrappedJson` (ciphertext blob) + a
base64 salt (non-secret) — no key material, PRF output, or plaintext. Password
bytes are zeroized in `finally` blocks after every KDF call. The debug popup
does no crypto and imports no crypto modules (D-04 respected). The MV3 CSP is
correctly scoped (`'wasm-unsafe-eval'`, no `unsafe-eval`), the onMessage
listener registers synchronously at worker startup, `initCrypto()` is memoized
with correct retry-on-failure semantics, and there is no top-level await. The
onMessage router reads only `message.kind` (no property assignment/merge — no
prototype-pollution surface). build-wasm.sh's extension output is genuinely
additive and idempotent, generated from the same compiled `.wasm` as the web
output.

No Critical issues. One Warning (latent message-sender validation gap that
becomes exploitable once content scripts land) and three Info items.

## Structural Findings (fallow)

No structural pre-pass was provided for this review.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: onMessage router does not validate `sender` — latent once content scripts are introduced

**File:** `extension/entrypoints/background.ts:31-46`
**Issue:** The `browser.runtime.onMessage` listener accepts any message whose
`kind === 'spike.roundtrip'` from any extension-internal sender without
inspecting the second `sender` argument. In the current phase this is **not
exploitable**: no `content_scripts` are declared and no `externally_connectable`
is configured, so web pages cannot reach `onMessage` (that path is
`onMessageExternal`), and there are no content scripts yet. The handler also
returns only `{ survived, ok }` booleans, never key material. However, Phase 10
(autofill) introduces content scripts, which run adjacent to hostile page DOM
and *can* call `runtime.sendMessage` into this exact listener. Establishing the
sender-validation pattern now — while the router is small — prevents a
content-script-reachable crypto trigger from silently shipping later.
**Fix:** Validate the sender before dispatching. For a background that should
only answer its own extension pages/popup:
```ts
browser.runtime.onMessage.addListener((message: unknown, sender) => {
  // Reject anything originating from a tab/content-script or a foreign extension.
  if (sender.id !== browser.runtime.id || sender.tab !== undefined) {
    return undefined;
  }
  // ... existing kind check ...
});
```
Adjust the policy when content scripts legitimately need to message the
background (Phase 10), but make the allow-list explicit rather than implicit.

## Info

### IN-01: `unwrapped !== undefined` check can never be false (misleading dead comparison)

**File:** `extension/lib/crypto/vault-session.ts:88-89`
**Issue:** `unwrapUserKey` (crates/pv-wasm/src/lib.rs:120-129) returns
`Result<WasmUserKey, JsValue>`, which surfaces in JS as *either a `WasmUserKey`
object or a thrown exception* — it never returns `undefined`. So on the
survived-a-wake path, `ok: unwrapped !== undefined` is always `true` when
reached; an actual unwrap failure throws and rejects the promise (correctly
caught in background.ts's `.catch`). The comparison implies a non-throwing
failure mode that does not exist, and diverges from the fresh-init path
(line 111) which correctly relies on throw-only semantics by discarding the
self-verify result.
**Fix:** Rely on throw-only semantics consistently — drop the comparison:
```ts
unwrapUserKey(wrappingKey, envelope.wrappedJson); // throws on failure
return { survived: true, ok: true };
```

### IN-02: build-wasm.sh sed neutralization fails silently if wasm-bindgen codegen drifts

**File:** `scripts/build-wasm.sh:78, 104`
**Issue:** Steps 6b and 8b use `sed -i` to replace the generated
`module_or_path = new URL('pv_wasm_bg.wasm', import.meta.url);` line. `sed`
exits 0 whether or not the pattern matches, so if a future wasm-bindgen version
changes that generated line, the dead-branch neutralization is silently skipped
and the bundler-breaking `new URL(..., import.meta.url)` pattern reappears in
both outputs with no error. The wasm-bindgen version is pinned (mitigating
this today), and both outputs would fail identically (so it is not a
*divergence* between web and extension), but it is a silent-failure risk in the
one script the phase relies on for reproducibility.
**Fix:** Assert the pattern is present before substituting (or verify the
replacement afterward), e.g. per target:
```sh
grep -q "new URL('pv_wasm_bg.wasm', import.meta.url)" "$GLUE" \
  || { echo "ERROR: wasm-bindgen glue pattern not found — codegen drifted, neutralization skipped" >&2; exit 1; }
```

### IN-03: Persisted envelope shape is trusted without validation on the wake path

**File:** `extension/lib/crypto/vault-session.ts:74, 79`
**Issue:** `existing[ENVELOPE_KEY] as SpikeEnvelope` casts stored data without
runtime validation; if `saltB64` were absent or non-string, `base64ToSalt` /
`atob` would throw. This is **not a security issue** — `chrome.storage.session`
is in-memory and only writable by this extension's own contexts, not
attacker-controlled — and the throw is caught and surfaced cleanly by
background.ts. Noted only because Phase 9's real vault-session logic inherits
this shape; when the persisted envelope carries security meaning, add a shape
guard (typeof checks on `wrappedJson`/`saltB64`) before use.
**Fix:** Add a small type guard before the survived-path branch, or defer to
Phase 9 with a TODO if this spike file is discarded as planned.

---

_Reviewed: 2026-07-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Resolution (2026-07-15, orchestrator fix pass)

| Finding | Outcome | Commit |
|---------|---------|--------|
| WR-01 sender validation | FIXED — with a correction: the suggested `sender.tab !== undefined` check broke the extension's own pages opened in tabs (caught by re-running the real-browser UAT); replaced with a sender.url own-origin check | a1c304b |
| IN-01 dead comparison | FIXED — throw-only semantics on both paths | a1c304b |
| IN-02 silent sed | FIXED — grep-guard both targets, loud exit 1 on codegen drift | 2523a2a |
| IN-03 envelope shape trust | FIXED — type guard, malformed envelope fails loudly | a1c304b |

Post-fix evidence: vitest 3/3, tsc clean, both wxt builds green, build-wasm.sh green with guards active, and the full Chrome kill/wake UAT re-run PASSED (survived:true, marker WIPED, 0 console errors).
