---
phase: 13-dual-browser-hardening
reviewed: 2026-07-20T00:00:00Z
depth: standard
scope: >-
  final targeted mini-review of the debug-driven commits landed AFTER
  13-REVIEW-2's fixes (290188c, 2eb81eb/59a0a15, f45adfe/0b52d64,
  0aa8204/0d970a7, 47b6f09, 0cb16ce/ebe451e, f90b21a, window-polish 3ac5755..f868a78)
files_reviewed: 12
files_reviewed_list:
  - extension/entrypoints/content-relay.content.ts
  - extension/entrypoints/page-bridge.content.ts
  - extension/entrypoints/page-bridge-firefox.ts
  - extension/entrypoints/background/provider-ceremony.ts
  - extension/entrypoints/background/server-unlock.ts
  - extension/entrypoints/popup/App.tsx
  - extension/entrypoints/popup/ProviderCeremonyView.tsx
  - extension/lib/window-geometry.ts
  - extension/lib/messaging/bytes-b64.ts
  - crates/pv-provider/Cargo.toml
  - web/src/components/auth/ExtUnlockBridge.tsx
  - web/src/lib/passkeys/login.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 13 (final mini-review): Code Review Report

**Reviewed:** 2026-07-20
**Depth:** standard
**Scope:** DELTA over 13-REVIEW.md + 13-REVIEW-2.md — the late, debug-driven
hardening/polish commits only (not the already-reviewed 13-06/13-07 base)
**Status:** issues_found

## Summary

This is a security-focused pass over the post-13-REVIEW-2 commits, with the
brief's seven questions verified individually rather than trusted. The late
changes hold up: the SECURED posture is not eroded. One asymmetry between the
Chrome and Firefox MAIN-world shims (the one file the phase name promises to
keep in lockstep) is a genuine — if cosmetic-only — WARNING; the other two
findings are bounded robustness notes. No blocker.

Per the brief's checklist, verified rather than assumed:

- **Q1 (DOM marker is page-writable) — SAFE.** `dataset.pvCeremonyInFlight`
  is read in exactly two places (`content-relay.content.ts:1335` and `:1410`),
  both of which only gate cosmetic overlay mounting (Surface A dropdown /
  Surface B form prompt). No TRUST/security decision consumes it. A hostile
  page setting `"1"` only suppresses the extension's own autofill overlay on
  *that* page (self-DoS); clearing it during a real ceremony only risks a
  cosmetic overlay flash. No credential path, origin pin, nonce, or unwrap gate
  reads it. Confirmed non-finding — but see WR-01 for the Firefox-side gap in
  *setting* it.
- **Q2 (`isBufferSource` widening spoof) — bounded, INFO.** The
  `Object.prototype.toString.call(...) === "[object ArrayBuffer]"` check IS
  spoofable by a page via `Symbol.toStringTag` (see IN-01), but the impact is
  bounded to the caller's own ceremony (empty-bytes → validation failure, or a
  self-inflicted throw/timeout). No wrong bytes are smuggled to a victim; the
  attacker already controls their own `publicKey` options.
- **Q3 (`.src` WAR injection) — SAFE.** `web_accessible_resources` already
  declared `page-bridge-firefox.js` (the inline `.text`/`fetch` strategy this
  replaces needed it too — `wxt.config.ts` unchanged, per the header comment),
  so no *new* fingerprinting/abuse surface. Firefox further randomizes the
  `moz-extension://<uuid>` origin per-install, so the WAR URL is not a stable
  cross-install fingerprint. Non-finding.
- **Q4 (consent window self-close) — SAFE.** `resolveCeremony`'s
  `window.close()` (`App.tsx:186`) only runs on the SUCCESS path after the
  `provider.resolveChoice` send resolves; the resolved-elsewhere branch
  (`App.tsx:296`) is guarded by `viewRef.current.kind === "provider-ceremony"`,
  so it can never close a popup showing list/detail/unlock. On Chrome's action
  popup this is the acknowledged harmless-close case.
- **Q5 (window geometry degenerate cases) — SAFE, one INFO.** `null`/missing/
  `NaN`/`Infinity` all fall back to `{}` (browser default placement). Negative
  `left`/`top` are passed through unclamped (see IN-02) — harmless (browser
  clamps; legit on a left-of-primary monitor).
- **Q6 (ExtUnlockBridge encoding + zeroing) — SAFE.** `prfArray` is a *view*
  over `prfBytes`, so `prfArray.fill(0)` (`ExtUnlockBridge.tsx:217`) zeroes the
  underlying buffer immediately after `bytesToB64Url`, before `postMessage`.
  The signin `token` is never persisted web-side (`passkeyLoginCeremony` never
  calls `setSessionToken`/`setStoredEmail`) and drops out of scope with the
  `extra` object. `delivery-failed`/`prf-unavailable` are terminal
  `setState`s reachable only via `postFailureNotice` (guarded by
  `awaitingAckRef`) or the ack's `ok:false` branch — neither can transition
  into `success`.
- **Q7 (Cargo base64url feature) — SAFE, and a net fix.** Enabling
  `serialize_bytes_as_base64_string` makes every `passkey_types::Bytes` field
  serialize as base64url, which is exactly what the sole JS consumer
  (`content-relay.content.ts`'s `decodeCredentialResponseJson`, via
  `b64UrlToArrayBuffer`) already expects — its `typeof === "string"` guards
  would have *skipped* the pre-fix raw-number-array shape, handing the page
  un-decoded arrays. `Bytes::deserialize` accepts either shape, so no inbound
  path breaks. No other workspace consumer depends on the old array shape.

## Warnings

### WR-01: the synchronous `pvCeremonyInFlight` DOM-marker fix (quick-260720-16k) was added to the Chrome shim but NOT mirrored into the Firefox shim — the exact browser this phase hardens keeps the race the fix was meant to close

**File:** `extension/entrypoints/page-bridge.content.ts:201` (present) vs
`extension/entrypoints/page-bridge-firefox.ts:147-208` (`relay()`, absent)

**Issue:**
The Chrome MAIN-world shim sets `document.documentElement.dataset.pvCeremonyInFlight = "1"`
SYNCHRONOUSLY at the top of `relay()`, before the async `postMessage` hop — so
`content-relay.content.ts`'s Surface A/B guards (`:1335`, `:1410`) suppress the
login-autofill overlay from the very tick a ceremony is intercepted, closing
the window where a `DOMContentLoaded`-timed overlay mount could otherwise race
ahead of the (postMessage-round-trip-delayed) `passkeyCeremonyInFlight` JS flag.

`page-bridge-firefox.ts`'s `relay()` — which BOTH files' header comments
declare must be "duplicated verbatim" ("if you change the patch logic here,
mirror the change there too") — never sets the marker. Nothing else sets it on
Firefox either: `content-relay` only ever *reads* and *deletes* it. So on
Firefox the synchronous suppression path is dead code, and a conditional-UI
`credentials.get()` fired at `document_start` can still let
`initialMatchAndPrompt()` mount the overlay in the gap before the postMessage
that sets `passkeyCeremonyInFlight` lands — precisely the race quick-260720-16k
exists to eliminate, on the one surface ("dual-browser hardening") the phase is
named for.

Impact is cosmetic-only (a brief autofill-overlay flash during a passkey
ceremony; no credential, key, origin-pin, or nonce path is affected), which is
why this is WARNING not BLOCKER. But it is a silently incomplete fix that
violates the files' own explicit mirror-invariant, and it is invisible to the
suite: `page-bridge.test.ts:262` asserts the synchronous marker set against the
CHROME file only — there is no equivalent Firefox test.

**Fix:** mirror the one line into `page-bridge-firefox.ts`'s `relay()`, exactly
as the header comments require:

```ts
return new Promise((resolve) => {
  document.documentElement.dataset.pvCeremonyInFlight = "1"; // mirror page-bridge.content.ts:201
  const nonce = crypto.randomUUID();
  // ...
```

Add a Firefox-variant test asserting the synchronous set, symmetric with
`page-bridge.test.ts:262`, so the mirror-invariant is guarded, not just
documented.

## Info

### IN-01: `isCrossRealmArrayBuffer` is spoofable via `Symbol.toStringTag`, and `bufferSourceToB64Url` has an unguarded throw path reachable from the non-try/catch message handler

**File:** `extension/entrypoints/content-relay.content.ts:456-462`
(`isCrossRealmArrayBuffer`), `:481-490` (`bufferSourceToB64Url`), `:784`
(unguarded call site in `handleProviderPageMessage`)

**Issue:**
`Object.prototype.toString.call(value)` honors an ordinary object's
`Symbol.toStringTag`, so a page can make a plain object report
`"[object ArrayBuffer]"`:

```js
const fake = { length: 2 ** 40 };
fake[Symbol.toStringTag] = "ArrayBuffer";
// isCrossRealmArrayBuffer(fake) === true  ->  isBufferSource(fake) === true
```

`bufferSourceToB64Url(fake)` then takes the non-view branch,
`new Uint8Array(fake)`. For a benign `{}` this yields empty bytes (a `""`
encode → downstream length-check failure, harmless). For a crafted huge
`length`, `new Uint8Array({length: 2**40})` throws `RangeError`. That call site
(`:784`, inside `handleProviderPageMessage` → `encodePublicKeyOptions`) is NOT
wrapped in try/catch, so the throw aborts the handler AFTER `postAck` already
fired and BEFORE `passkeyCeremonyInFlight`/`dispatchProviderCeremony` run — the
page's `relay()` enters Phase B and waits `EXTENSION_AUTHORITY_TIMEOUT_MS`
before falling through to native, and the `dataset.pvCeremonyInFlight="1"`
marker (set in Chrome's `relay()`) is never deleted, permanently suppressing
that page's overlay for the session.

Every consequence is self-inflicted on the attacker's own page (they already
own their `publicKey` options); no victim origin, key, or cross-page state is
reachable — hence INFO. Still worth closing as defense-in-depth: the provider
boundary's own contract is "any provider-side error falls through to native,"
which this throw path violates by wedging for the backstop timeout instead.

**Fix:** wrap the encode in the same fall-through discipline the rest of the
bridge uses (so a malformed options object cleanly yields native WebAuthn), and
optionally reject an absurd length in `bufferSourceToB64Url`:

```ts
let encodedPublicKey: unknown;
try {
  encodedPublicKey = encodePublicKeyOptions(publicKey);
} catch {
  postToPage(nonce, { kind: "fallthrough" });
  delete document.documentElement.dataset.pvCeremonyInFlight;
  return;
}
```

### IN-02: `centeredWindowPosition` passes negative `left`/`top` through unclamped

**File:** `extension/lib/window-geometry.ts:59-62`

**Issue:** Centering a wider consent/ceremony window (480px or 380px) over a
narrow or edge-positioned source window yields a negative `left`
(e.g. source at `left:0, width:380`, new `width:480` → `left:-50`). The
non-finite guards above correctly reject `NaN`/`Infinity`/missing → `{}`
(browser default), but a finite negative is forwarded verbatim to
`browser.windows.create()`. Harmless in practice — Chrome clamps an
off-screen window back on-screen, and a negative `left` is legitimate on a
monitor positioned left of the primary — so this is noted only for awareness,
not a defect. No clamp is strictly better than a wrong one (clamping to `0`
would break genuine multi-monitor placement). Optional: clamp to `>= 0` only
when the computed position would place the *entire* window off the source
monitor.

---

_Reviewed: 2026-07-20_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard (final delta over 13-REVIEW.md + 13-REVIEW-2.md)_
