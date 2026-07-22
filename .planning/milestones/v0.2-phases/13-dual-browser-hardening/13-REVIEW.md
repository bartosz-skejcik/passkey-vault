---
phase: 13-dual-browser-hardening
reviewed: 2026-07-18T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - crates/pv-provider/src/ceremony.rs
  - crates/pv-server/src/config.rs
  - crates/pv-server/src/routes/mod.rs
  - extension/entrypoints/background/router.ts
  - extension/entrypoints/background/server-config.ts
  - extension/entrypoints/background/server-unlock.ts
  - extension/entrypoints/content-relay.content.ts
  - extension/entrypoints/popup/ItemIconTile.tsx
  - extension/entrypoints/popup/ItemListView.tsx
  - extension/entrypoints/popup/UnlockView.tsx
  - extension/lib/messaging/bytes-b64.ts
  - extension/lib/messaging/ext-protocol.ts
  - extension/lib/vault/cardBrand.ts
  - extension/lib/vault/search.ts
  - extension/lib/vault/sort.ts
  - web/src/app/page.tsx
  - web/src/components/auth/ExtUnlockBridge.tsx
  - web/src/lib/passkeys/login.ts
findings:
  critical: 1
  warning: 2
  info: 2
  total: 5
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2026-07-18
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed all six phase-13 plans with a security-critical focus on plan 13-06's
server-origin PRF unlock (threat model T-13-11..T-13-14) plus the popup UI round
(ItemIconTile / ItemListView / sort / cardBrand).

The hardening story is largely solid: the CORS moz-extension wildcard predicate
(config.rs / routes/mod.rs) is well-guarded (bare `*` stays fatal, only a
UUID-shaped `moz-extension://<uuid>` passes the predicate); the relay routing
split (`unlock.serverCeremony.relay` on the content-frame `assertContentSender`
channel vs `unlock.serverCeremony.start` on the popup-gated channel) matches
T-13-14; ExtUnlockBridge holds PRF/blob in function scope, zeroes the view after
`postMessage`, never unlocks the web app itself, and never touches web storage
(T-13-12); the double origin-pin (relay-side `isConfiguredServerOrigin()` +
background-side `new URL(config.baseUrl).origin !== callerOrigin`) is genuinely
independent; and the FAVICON_URL_PREFIX extraction does NOT weaken the
hard-coded-URL guard (the guard regex requires at least one char after
`https://`, so the bare-prefix literal legitimately doesn't match).

However there is one BLOCKER that makes the entire server-origin unlock feature
non-functional in production, plus two robustness gaps against T-13-13's
"never wedges" guarantee and the popup-sort race. The BLOCKER is invisible to
the whole test suite because the unit tests feed `btoa("prf")` (a
+/-free ASCII string) through a mocked `WasmWrappingKey.fromPrf`, and the
Firefox harness never reached the real PRF-completion path (it stops at the
no-passkeys empty-state — the very D5 "human live-UAT" item).

## Critical Issues

### CR-01: PRF output is base64url-encoded on the relay side but standard-base64-decoded in the background — real server-origin unlock fails ~74% of the time

**File:** `extension/entrypoints/content-relay.content.ts:892` (encode) and
`extension/entrypoints/background/server-unlock.ts:226` (decode)

**Issue:**
The relay encodes the real PRF `ArrayBuffer` with `bufferSourceToB64Url(prf)`,
which produces **base64url** (`+`→`-`, `/`→`_`, padding stripped):

```ts
// content-relay.content.ts:892
const prfB64 = bufferSourceToB64Url(prf);   // base64url: '-' and '_', no '='
```

The background then decodes it with `b64ToBytes`, which is a **standard-base64**
decoder — a raw `atob(b64)` with no `-`→`+` / `_`→`/` substitution
(`extension/lib/messaging/bytes-b64.ts:32-39`):

```ts
// server-unlock.ts:226
const prfArray = b64ToBytes(args.prfB64);    // atob(base64url) -> throws on '-'/'_'
```

The PRF output is 32 random bytes. Its standard-base64 form contains a `+` or
`/` (hence a `-` or `_` after base64url conversion) with probability
≈ 1 − (62/64)^43 ≈ **74%**. `atob()` throws `InvalidCharacterError` on `-`/`_`,
which is swallowed by `completeServerUnlock`'s `try/catch` and surfaces as
`{ ok:false, error:"unwrap-failed" }`. So roughly 3 of every 4 legitimate
server-origin unlock attempts (with a valid PRF and a correct blob) fail; the
remaining ~26% only work by accident of `atob`'s tolerance of missing padding.

This is the flow's headline feature (Firefox passkey unlock), and it is broken
for its actual purpose. The provider bridge legitimately uses
`bufferSourceToB64Url` because ITS receiver is the Rust `passkey_types`
base64url deserializer — but this new relay's receiver is JS `b64ToBytes`
(standard base64), so the encoder was copied without matching the decoder.

**Why no test caught it:** `server-unlock.test.ts` builds `prfB64: btoa("prf")`
(ASCII, no `+`/`/`) and mocks `WasmWrappingKey.fromPrf`, so neither the
base64url charset nor byte-correctness is exercised. The content-relay tests
mock `sendMessage` and never run the background decode. The Firefox harness
explicitly stops at the no-passkeys empty-state (coverage D5 is the untested
human item). The encode↔decode boundary has zero real end-to-end coverage.

**Fix:** make the encoder and decoder agree. Simplest: encode with the standard
base64 helper the decoder already expects:

```ts
// content-relay.content.ts — use the standard-base64 helper matching b64ToBytes
import { bytesToB64 } from "../lib/messaging/bytes-b64";
// ...
const prf = event.data.prf;
const prfB64 = bytesToB64(
  prf instanceof ArrayBuffer ? new Uint8Array(prf) : new Uint8Array(prf.buffer, prf.byteOffset, prf.byteLength),
);
```

Alternatively add a base64url-aware decode in `server-unlock.ts` (reuse
content-relay's own `b64UrlToArrayBuffer`) instead of `b64ToBytes`. Either way,
add a test that round-trips a real 32-byte `crypto.getRandomValues` buffer
through `bufferSourceToB64Url`/whatever-encoder → the actual background decoder,
asserting the bytes survive — the current `btoa("prf")` fixture must not be the
only coverage.

## Warnings

### WR-01: `completeServerUnlock` invalid-nonce path clears the pending record + timeout alarm but never broadcasts — popup wedges and the legitimate ceremony is destroyed (violates T-13-13)

**File:** `extension/entrypoints/background/server-unlock.ts:214-219`

**Issue:**
`clearPending()` runs unconditionally *before* the nonce is validated, and it
also clears the timeout alarm (`browser.alarms.clear(ALARM_NAME)`). On a
nonce mismatch the function returns without closing the window and, critically,
**without `broadcastCeremonyState(false)`**:

```ts
const pending = await readPending();
await clearPending();                 // also removes the 120s timeout alarm
if (pending === null || pending.nonce !== args.nonce) {
  return { ok: false, error: "invalid-nonce" };   // no broadcast, no window close
}
```

Consequences, both reachable:
1. **Popup wedge.** `UnlockView` set `serverCeremonyBusy = true` and resolves
   ONLY on the `unlock.serverCeremony.state` broadcast. On invalid-nonce no
   broadcast fires, and the safety-net alarm was just cleared, so the in-flight
   "Finish in the opened window…" state never resolves — directly contradicting
   T-13-13's "every pending path … must resolve UnlockView's in-flight UI" and
   the plan's "never wedges" acceptance criterion.
2. **Legit ceremony destroyed.** Because the pending record is consumed before
   the nonce check, ANY mismatched delivery (e.g. a rapid re-trigger where an
   abandoned window's ExtUnlockBridge posts the stale nonce A after
   `startServerUnlock` has already rotated to pending nonce B, per the module's
   own "latest wins" behavior) wipes the *current* pending record. The user's
   real, in-flight unlock can then no longer complete (`pending === null`).

The password path stays available, so it is not a full lockout — hence WARNING,
matching the register's own "medium" rating for T-13-13 — but the stated
mitigation is not actually met.

**Fix:** on the invalid-nonce branch, resolve the in-flight UI and clean up the
window, consistent with the `expired` branch just below it:

```ts
if (pending === null || pending.nonce !== args.nonce) {
  await closeWindowIfAny(pending);
  await broadcastCeremonyState(false);
  return { ok: false, error: "invalid-nonce" };
}
```

Consider also NOT clearing a still-valid pending on a mismatched delivery (only
consume it when `pending.nonce === args.nonce`), so a stale/forged nonce cannot
destroy an in-progress legitimate ceremony. The replay guarantee is already
enforced by the relay-side single-use `seenExtUnlockNonces` set plus the
consume-on-match path.

### WR-02: popup sort preference read can clobber a user's just-made choice (async-read race)

**File:** `extension/entrypoints/popup/ItemListView.tsx:142` (with
`extension/lib/vault/sort.ts:25`)

**Issue:**
On mount, `void readSortPreference().then(setSortOption)` fires an async
`browser.storage.local.get`. If the user changes the sort `<select>` before that
read resolves, `handleSortChange` sets `sortOption = next` and persists it — but
the still-in-flight `readSortPreference()` then resolves with the *old* stored
value and calls `setSortOption(oldValue)`, visually reverting the user's choice
(storage is correct, the UI is stale until reopen). The web version
(`web/src/app/page.tsx:81`) avoids this by reading synchronous localStorage;
the popup's async storage reintroduces the race the sync API doesn't have.

**Fix:** guard the mount read against a subsequent user selection, e.g. track a
"user has interacted" ref (or a cancelled flag) and skip `setSortOption` from
the mount read once the user has changed the control:

```ts
const userPickedRef = useRef(false);
useEffect(() => {
  void readSortPreference().then((s) => { if (!userPickedRef.current) setSortOption(s); });
}, []);
// in handleSortChange: userPickedRef.current = true;
```

## Info

### IN-01: favicon `<img>` forces `https://` regardless of the item's stored scheme

**File:** `extension/entrypoints/popup/ItemIconTile.tsx:114`

**Issue:** `src={`${FAVICON_URL_PREFIX}${hostname}/favicon.ico`}` hard-codes
`https://` even when the login item's stored URL was `http://` (e.g. a
LAN/self-hosted service on plain http). Such hosts will always miss the favicon
and fall back to the type-icon tile. Harmless (the fallback is silent and
expected), but the tile will never show a favicon for http-only hosts. The
direct-fetch/no-referrer/no-proxy zero-knowledge posture is otherwise correctly
implemented. Optionally derive the scheme from the item's URL when available.

### IN-02: `detectCardBrand` requires ≥4 digits before recognizing 2221–2720 Mastercard range

**File:** `extension/lib/vault/cardBrand.ts:18`

**Issue:** `fourDigit = Number(digits.slice(0, 4))` means a partially-entered
card number in the 2221–2720 Mastercard BIN block is not detected until the 4th
digit is present (e.g. `"22"` → `22`, out of range). This only affects the
transient tile glyph while typing/partial data and matches the web port
byte-for-byte, so it is cosmetic — noted for awareness, not a correctness defect
(the full number always classifies correctly).

---

_Reviewed: 2026-07-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
