---
phase: 09-session-unlock-core-popup-sync-client
reviewed: 2026-07-15T00:00:00Z
depth: deep
files_reviewed: 27
files_reviewed_list:
  - crates/pv-core/src/keys.rs
  - crates/pv-core/src/prf.rs
  - crates/pv-wasm/src/lib.rs
  - crates/pv-server/src/routes/mod.rs
  - crates/pv-server/src/routes/extension_passkeys.rs
  - crates/pv-server/migrations/0011_extension_passkeys.sql
  - extension/entrypoints/background.ts
  - extension/entrypoints/background/session-storage.ts
  - extension/entrypoints/background/vault-session.ts
  - extension/entrypoints/background/autolock.ts
  - extension/entrypoints/background/router.ts
  - extension/entrypoints/background/unlock.ts
  - extension/entrypoints/background/ext-passkey.ts
  - extension/entrypoints/background/auth-api.ts
  - extension/entrypoints/background/vault-api.ts
  - extension/entrypoints/background/sync-client.ts
  - extension/entrypoints/background/vault-store.ts
  - extension/entrypoints/background/server-config.ts
  - extension/lib/server-url.ts
  - extension/lib/messaging/ext-protocol.ts
  - extension/lib/messaging/bytes-b64.ts
  - extension/lib/passkeys/prf.ts
  - extension/lib/passkeys/ext-prf.ts
  - extension/lib/crypto/wasm-loader.ts
  - extension/lib/crypto/vault-session.ts
  - extension/lib/vault/search.ts
  - extension/entrypoints/popup/App.tsx
  - extension/entrypoints/popup/UnlockView.tsx
  - extension/entrypoints/popup/ServerConfigView.tsx
  - extension/entrypoints/popup/ItemListView.tsx
  - extension/entrypoints/popup/ItemDetailView.tsx
  - extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx
  - extension/wxt.config.ts
  - web/src/app/page.tsx
findings:
  critical: 1
  warning: 8
  info: 6
  total: 15
status: issues_found
---

# Phase 9: Code Review Report

**Reviewed:** 2026-07-15
**Depth:** deep (cross-file: import graph, call chains, lock-state propagation, WASM/JS boundary)
**Files Reviewed:** 27 source files (tests read for context, not reported on)
**Status:** issues_found

## Summary

Scope: `868ba44^..HEAD` restricted to `crates/`, `extension/`, `web/src/app/`. The 9 UAT-found
defects listed in 09-07-SUMMARY.md are excluded, as are the accepted-and-documented items
(D-02 exception itself, Firefox/Phase-13 deferrals, DM Sans, ServerConfigView vs UI-SPEC).

**The crypto core holds up.** HKDF domain separation between `pv:ext-prf-unlock:v1` and
`pv:prf-unlock:v1` is real and proven by an actual cross-unwrap-fails test
(`prf.rs:87-98`), not an assertion about constants. `INFO_EXT_PRF_UNLOCK` is added, never
substituted. Zeroize-regardless-of-outcome discipline is genuinely uniform across
`fromPassword`/`fromPrf`/`fromExtPrf`/`importUserKeyFromSession`, and the wasm-bindgen
`&mut [u8]` copy-back semantics mean it reaches the JS-side view too. The server's
`extension_passkeys` blob is genuinely opaque — `prf_wrapped_uk` is bound as a string, never
parsed, never logged, and both `list`/`delete` scope by `session.user_id` with no
client-supplied id. CORS `AllowOrigin::list` is an exact-match allowlist, not a predicate.
SYNC-02 holds: `socket.onmessage` never touches `.data` (`sync-client.ts:113-116`). The WR-01
sender gate is correctly replicated in `router.ts:58` and keys off `sender.url` origin, not
`sender.tab`.

**The one real leak is on the popup side, not the crypto side**: the popup has no reaction to
a lock event at all, so an auto-lock that fires while the user is on the item-detail view
leaves a decrypted (possibly revealed) password rendered on screen. That is the T-09-18/19
class the background was carefully hardened against, re-introduced one layer up.

Secondary themes: the router has no rejection path (several handlers can and do reject, and
the message channel then simply hangs), the ext-PRF handlers' error taxonomy is inverted
relative to every other handler, and a meaningful volume of the phase's own API surface
(the entire web-RP PRF message pair, Phase 8's `spike.roundtrip` debug endpoint) ships dead.

---

## Critical Issues

### CR-01: Popup keeps rendering decrypted plaintext after an auto-lock

**File:** `extension/entrypoints/popup/App.tsx:28-109`, `extension/entrypoints/popup/ItemDetailView.tsx:40-52`

**Issue:** The background's lock path is correct — `lockVaultSession()` frees the key, clears
the envelope, then `vault-store.ts:165-176` stops sync *before* clearing the arrays and
broadcasts `vault.updated`. But **nothing in the popup ever changes view on a lock**.

`App.tsx` fetches `session.status` exactly twice: once on mount (`useEffect`, line 51-54) and
once in `handleUnlocked` (line 57). It registers no `browser.runtime.onMessage` listener. The
only listener in the whole popup is `ItemListView.tsx:87-97`, which reacts to `vault.updated`
by re-fetching `vault.list` — and `App.tsx:93-97` **unmounts `ItemListView` entirely** when
`view.kind === "detail"`, taking that listener with it.

Concrete sequence:
1. User unlocks, taps an item → `setView({ kind: "detail", item })`. The full decrypted
   `VaultItem` (password, card number, TOTP secret) now lives in React state at `App.tsx:26`
   and is read into `fieldValues` at `ItemDetailView.tsx:51`.
2. User reveals the password (`toggleReveal`, line 58-68). Plaintext is on screen.
3. No further messages are sent, so `router.ts:73`'s `noteActivity()` never re-arms →
   the `pv-auto-lock` alarm fires at the configured idle timeout.
4. `lockVaultSession(true)` runs: key freed, envelope cleared, `vault.updated` broadcast.
5. **The popup receives nothing** (no listener mounted) and keeps rendering the revealed
   password indefinitely. Re-opening a Chrome action popup is not guaranteed — the popup
   survives as long as the browser window keeps focus.

Even in the list view the failure is partial: `ItemListView` clears its rows but `App.tsx`
never returns to `UnlockView`, so the user sees a misleading "vault empty" state on a locked
vault rather than the unlock screen.

**Fix:** Give `App.tsx` a lock-state listener that re-reads authoritative status and resets
the view (which also unmounts `ItemDetailView` and drops the plaintext from React state):

```tsx
// App.tsx
useEffect(() => {
  function onBroadcast(message: unknown) {
    if (
      typeof message === "object" &&
      message !== null &&
      (message as { kind?: unknown }).kind === "vault.updated"
    ) {
      // Never trust the current view over what the background says.
      void sendMessage({ kind: "session.status" }).then((status) => {
        if (status.kind !== "unlocked") {
          setShowEnrollPrompt(false);
          setView({ kind: "unlock", status });
        }
      });
    }
  }
  browser.runtime.onMessage.addListener(onBroadcast);
  return () => browser.runtime.onMessage.removeListener(onBroadcast);
}, []);
```

Preferably add a dedicated `{ kind: "session.locked" }` broadcast from
`vault-session.ts`'s `lockVaultSession()` rather than overloading `vault.updated` (which
also fires on every ordinary sync merge, costing a `session.status` round trip each time —
see IN-02).

---

## Warnings

### WR-01: Router has no rejection path — a throwing handler hangs the popup and leaks an unhandled rejection

**File:** `extension/entrypoints/background/router.ts:75`

**Issue:** `void handle(message).then(sendResponse);` attaches no rejection handler. When
`handle()` rejects, `sendResponse` is never invoked, the channel opened by `return true`
(line 76) stays open until it closes with `undefined` + a `lastError`, and the rejection
surfaces as an unhandled promise rejection in the service worker.

Handlers that *do* reject, by design or omission:
- `unlock.ts:128` — `handleUnlockPrfStart` explicitly `throw e` for any non-404.
- `unlock.ts:185` — `handleSignInPrfStart`, same.
- `ext-passkey.ts:199-242` — `handleExtPrfUnlockFinish` has `try`/`finally` with **no catch** (see WR-03).
- `getSessionStatus` (`router.ts:184`) → `ensureHydrated()` (`vault-session.ts:97-99`) —
  `initCrypto()` or `importUserKeyFromSession()` throwing on a corrupt envelope rejects
  `session.status`, which rejects `App.tsx:34`'s `refreshFromScratch()` and strands the popup
  on the loading spinner forever.

**Fix:**

```ts
void handle(message).then(
  sendResponse,
  (e: unknown) => {
    console.error("[passkey-vault] handler failed", message.kind, e);
    sendResponse({ ok: false, error: "unknown" });
  },
);
```

and give `ensureHydrated()` a `try/catch` that treats an un-importable envelope as locked
(clear it and return `null`) rather than throwing.

### WR-02: Inverted error classification in `handleExtEnrollFinish`

**File:** `extension/entrypoints/background/ext-passkey.ts:148-152`

**Issue:**

```ts
} catch (e) {
  if (e instanceof ApiClientError) {
    return { ok: false, error: "unknown" };
  }
  return { ok: false, error: "unreachable" };
}
```

This is backwards relative to every sibling handler. An `ApiClientError` means the server
*answered* (it is reachable) and is reported as `"unknown"`; a non-API failure (a WASM error
from `fromExtPrf`, a `ServerNotConfiguredError`, a storage write failure) is reported as
`"unreachable"` — telling the user their server is down when it isn't. There is also no 401
branch, so an expired token during enrollment renders a generic failure instead of routing the
user back to sign-in (contrast `unlock.ts:103-106` and `ext-passkey.ts:211-214`, which both
handle 401 correctly).

**Fix:**

```ts
} catch (e) {
  if (e instanceof ApiClientError) {
    return e.status === 401
      ? { ok: false, error: "invalid-credentials" }
      : { ok: false, error: "unknown" };
  }
  if (e instanceof ServerNotConfiguredError) return { ok: false, error: "unknown" };
  return { ok: false, error: "unreachable" }; // genuine network/fetch failure
}
```

(`"invalid-credentials"` needs adding to this handler's response union in
`ext-protocol.ts:123`, or map 401 to `"unknown"` and note it — but do not keep the current
inversion.)

### WR-03: `handleExtPrfUnlockFinish` has no catch — the new ext-PRF unlock path can reject

**File:** `extension/entrypoints/background/ext-passkey.ts:205-242`

**Issue:** The outer block is `try { ... } finally { prfArray.fill(0); wrappingKey?.free?.(); }`
with no `catch`. Every sibling (`handleUnlockPassword:102`, `handleUnlockPrfFinish:164`,
`handleSignInPrfFinish:222`) catches and returns a typed result. Rejection sources here:
`initCrypto()` (line 206), `WasmWrappingKey.fromExtPrf(prfArray)` (line 223 — throws on a
short/malformed PRF buffer, and this input crosses the popup boundary as a base64 string that
`b64ToBytes` will happily decode to any length), `clearExtPasskeyMeta()`, `readSessionMeta()`,
`setUnlockedUserKey()` (line 237). Combined with WR-01, a short `prfB64` from the popup hangs
the unlock button forever with no error shown.

**Fix:** wrap in `catch` mirroring `handleUnlockPrfFinish:164-169`:

```ts
} catch (e) {
  if (e instanceof ApiClientError && e.status === 401) {
    return { ok: false, error: "invalid-credentials" };
  }
  return { ok: false, error: "unknown" };
} finally {
  prfArray.fill(0);
  wrappingKey?.free?.();
}
```

### WR-04: The base64 hop leaves un-zeroizable raw User Key bytes in the SW heap — and the doc comment claims otherwise

**File:** `extension/entrypoints/background/vault-session.ts:61-76`, `:98`, `:131-137`

**Issue:** This is the D-02 exception's actual residue, and it is the one place the phase's
zeroize story is not accurate as written. `setUnlockedUserKey`'s doc comment (line 109-113)
states it "Zeroizes the transient JS buffer in a `finally` regardless of write outcome
(T-09-06)", and `wasm-loader.ts:35-40` frames the export/import pair as the only raw-bytes
crossing. Both are true of the `Uint8Array` — and both omit the strings:

```ts
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);  // <- immutable string, raw UK bytes, cannot be wiped
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);   // <- same, on the hydrate path (line 98)
  ...
}
```

Each unlock/hydrate leaves at least one immutable JS string holding the raw 32 User Key bytes
(plus the rope fragments `+=` produces) in the service worker heap. `exported.fill(0)`
(line 136) wipes the array; nothing can wipe the strings. Crucially, **`lockVaultSession()`
cannot clear them either** — so after an auto-lock the User Key material is still resident in
the SW heap until GC happens to collect it, which is exactly the property the key envelope's
clear-on-lock design exists to deny.

This is bounded (same-process, extension-context heap only; not reachable by a page, a content
script, `storage.local`, a log, or the server), so it is not a zero-knowledge break. But it is
undocumented, unlike the equivalent exposure at the popper boundary — `UnlockView.tsx:103-108`
explicitly names and bounds its own b64-string exposure. The asymmetry means a future reader
will believe the invariant is stronger than it is.

**Fix:** (a) at minimum, document it honestly — amend `setUnlockedUserKey`'s and
`ensureHydrated`'s doc comments and `bytesToBase64`/`base64ToBytes` to state that the
intermediate binary string and the base64 string are immutable, cannot be zeroized, are not
cleared by a lock, and are bounded to the SW heap; mirror `UnlockView.tsx:103-108`'s wording.
(b) Better, shrink the residue: chunk the encode so no single string ever holds the whole key,
or move the b64 encode into `pv-wasm` (`export_user_key_for_session` returns a base64 `String`
directly), which removes the raw-byte JS string from the export path entirely and leaves only
the ciphertext-equivalent base64 that already lives in `storage.session` by design.

### WR-05: Unlock never arms the auto-lock alarm — arming is incidental

**File:** `extension/entrypoints/background/vault-session.ts:114-140`

**Issue:** `setUnlockedUserKey()` imports `armAutoLock` (line 28) but never calls it; the only
callers are `noteActivity()` (line 173), `router.ts:231`, and `background.ts:79`. On the
unlock path, `router.ts:73`'s `void noteActivity()` runs *before* `handle(message)`, at which
point `isSessionUnlocked()` is still `false`, so it returns at `vault-session.ts:169-171`
without arming. The alarm only gets armed because `App.tsx:57`'s `handleUnlocked` happens to
send a follow-up `session.status`.

That makes EXT-03's security control dependent on an incidental UI round trip. Any path that
unlocks without a follow-up message — the popup closing on the unlock click, a future
options-page or auto-unlock caller, a `handleUnlocked` that early-returns at `App.tsx:58-65` —
leaves the vault unlocked with **no alarm at all** until the next message or a browser
restart. It also means the fix for the UAT-found inert-control bug (`5228ea4`) rests on the
same incidental path.

**Fix:** arm explicitly where the state transition actually happens:

```ts
// vault-session.ts, end of setUnlockedUserKey, before notifyLockListeners()
await armAutoLock(idleTimeoutMinutes);
notifyLockListeners();
```

This is safe against the `session.setAutoLockMinutes` race documented at `router.ts:66-72` —
that guard is about `noteActivity()` reading a pre-change interval, whereas this call uses the
interval it is itself writing.

### WR-06: The MV3 poll fallback is a `setInterval` — it dies in exactly the scenario it exists for

**File:** `extension/entrypoints/background/sync-client.ts:149-151`, `:130-133`

**Issue:** The module header (lines 4-7) states the 30s poll is "the belt-and-suspenders
fallback ... sync must not go silently dead behind a reverse proxy that drops Upgrade
headers". It is implemented as `setInterval` (line 149), and the WS reconnect backoff as
`setTimeout` (line 130) — both of which an MV3 idle-kill destroys, which is the precise
anti-pattern `autolock.ts:1-7` calls out and rejects for the same reason.

The failure compounds: behind an Upgrade-stripping proxy there is no WebSocket to keep the
service worker alive, so the SW idles out within ~30s, taking the poll timer *and* the
reconnect timer with it. Sync is then dead until something else wakes the worker — in practice
only the popup opening, which triggers its own pull anyway. The fallback provides no coverage
in its own stated scenario. (When the WS *is* healthy it keeps the SW alive and the timers
work — i.e. the fallback only works when it isn't needed.)

**Fix:** back the poll with `chrome.alarms` (the `alarms` permission is already declared in
`wxt.config.ts:83`), the way `autolock.ts` does:

```ts
const POLL_ALARM = "pv-sync-poll";
// startSync:
void browser.alarms.create(POLL_ALARM, { periodInMinutes: 0.5 });
// stopSync:
void browser.alarms.clear(POLL_ALARM);
// registered synchronously at startup, alongside registerAutoLockAlarmListener():
browser.alarms.onAlarm.addListener((a) => { if (a.name === POLL_ALARM) void pullOnce(); });
```

Note Chrome clamps `periodInMinutes` to ≥1 minute in release builds — an honest 60s poll that
actually survives is strictly better than a 30s poll that doesn't. Same treatment for the
reconnect timer.

### WR-07: `PV_EXTENSION_ORIGINS` silently drops malformed entries and panics the server on `*`

**File:** `crates/pv-server/src/routes/mod.rs:100-110`

**Issue:**

```rust
let origins: Vec<_> = extension_origins_csv
    .split(',')
    .map(str::trim)
    .filter(|s| !s.is_empty())
    .filter_map(|s| s.parse().ok())   // silently discards anything unparseable
    .collect();
if origins.is_empty() {
    CorsLayer::new() // unchanged existing behavior when unset
}
```

Two operator footguns on a security-relevant env var:

1. **Silent drop.** A typo'd/whitespace-mangled origin is discarded with no log. If every
   entry is dropped, the allowlist collapses to "no CORS layer" — which is
   indistinguishable at runtime from "operator never set the var", and presents to the user as
   an opaque browser CORS error with nothing in the server log to correlate. (It fails closed,
   which is right; it fails *silently*, which is not.)
2. **Panic on `*`.** `AllowOrigin::list` panics when the iterator contains `*` ("Wildcard
   origin (`*`) cannot be passed to `AllowOrigin::list`"). `PV_EXTENSION_ORIGINS=*` is a
   plausible thing for a self-hoster to try, and it aborts server startup inside `router()`
   with a tower-http panic message instead of a diagnosable error.

**Fix:**

```rust
let mut origins = Vec::new();
for raw in extension_origins_csv.split(',').map(str::trim).filter(|s| !s.is_empty()) {
    if raw == "*" {
        tracing::error!("PV_EXTENSION_ORIGINS must list concrete extension origins, not '*' — ignoring");
        continue;
    }
    match raw.parse::<HeaderValue>() {
        Ok(v) => origins.push(v),
        Err(_) => tracing::error!(origin = raw, "PV_EXTENSION_ORIGINS entry is not a valid origin — ignoring"),
    }
}
if !origins.is_empty() {
    tracing::info!(count = origins.len(), "CORS allowlist active for extension origins");
}
```

Add a test for the `*` input so the panic can never come back.

### WR-08: Substantial dead surface shipped — including Phase 8's debug endpoint the code says should be gone

**Files:** `extension/entrypoints/background.ts:14`, `:83-113`; `extension/lib/crypto/vault-session.ts` (whole file); `extension/entrypoints/background/router.ts:93-97`, `:121-146`; `extension/entrypoints/background/unlock.ts:119-225`; `extension/entrypoints/background/auth-api.ts:187-199`, `:235-239`; `extension/lib/passkeys/prf.ts:40-82`

**Issue:** Verified unreachable by grep across `extension/` (excluding tests):

- **`spike.roundtrip` / `roundTripSpike`.** `vault-session.ts:1-6` says the Phase-8 spike backs
  "the throwaway debug popup's `spike.roundtrip` message **until Plan 09-05 replaces the popup
  entirely**". 09-06 did replace it — `popup/main.ts` was deleted — and nothing sends
  `spike.roundtrip` any more. Yet `background.ts:83-113` still registers a listener that, on
  demand, runs a full Argon2id derivation under a **hard-coded password**
  (`vault-session.ts:46`) and writes a `spikeEnvelope` to `chrome.storage.session`. It is
  sender-gated and the spike UK is throwaway, so this is not a live vulnerability — but it is
  a debug code path with a hard-coded credential shipping to users, and its own comment says
  it should already be gone.
- **The entire web-RP PRF pair.** `UnlockView.tsx:14-16` states outright that "those message
  kinds stay dead from this component". Nothing dispatches `unlock.prf.start/finish` or
  `auth.signIn.prf.start/finish`, so `router.ts:121-146`'s cases, `unlock.ts:119-225`'s four
  handlers, and `auth-api.ts:187-199`'s `unlockStart`/`unlockFinish` (plus
  `passkeyLoginStart`/`passkeyLoginFinish`) are all unreachable.
- **`prf.ts:40-82`** — `buildPrfExtensions` and `stripPrfFromCredentialJson` have zero callers.
  `prf.ts:8-16`'s header still claims "this file is the ONLY thing the popup needs to
  prepare/consume a WebAuthn PRF ceremony", which is now false; the popup uses `ext-prf.ts`
  and only `extractPrfBytes` from here.
- **`auth-api.ts:235-239`** — `deleteExtensionPasskey` has no caller (no delete UI this phase),
  though `crates/pv-server` implements the route.

The router cases matter most: they widen `isProtocolMessage`'s accepted surface and feed
`credentialJson: unknown` into handlers no shipped code exercises, meaning any regression in
them is invisible to UAT.

**Fix:** delete `background.ts:14` + `:83-113` and `lib/crypto/vault-session.ts` (its tests
too). Either delete the web-RP PRF pair now, or — if it is genuinely reserved for a future
options page — move it behind an explicit `// RESERVED (Phase N):` marker and drop the
`router.ts` cases so unreachable code is not routable. Delete `buildPrfExtensions`/
`stripPrfFromCredentialJson` and correct `prf.ts`'s header, which is now inaccurate.

---

## Info

### IN-01: `applySyncSnapshot` advances the revision watermark before the lock re-check

**File:** `extension/entrypoints/background/vault-store.ts:108-116`

**Issue:** `lastKnownRevision = snapshot.revision` (line 109) runs *before* the
`getUnlockedUserKey() === null` guard (line 113-116). The T-09-19 property holds — no items are
decrypted or repopulated after a lock — but the watermark is still mutated. Sequence: lock
resets `lastKnownRevision = 0` (line 171); an in-flight `getSyncSnapshot(0).then(applySyncSnapshot)`
from `ensureVaultSyncStarted:154` (which, unlike `pullOnce`, is not gated by
`activeCallbacks`) then lands and sets it back to a stale non-zero N while locked. On the next
unlock, `startSync`'s `getSinceRevision: () => lastKnownRevision` closure hands the server
stale N, so the WS `onopen` catch-up pull gets a no-op "up to date" reply. It self-heals via
the unconditional `getSyncSnapshot(0)` on the same line, so impact is one wasted round trip.

**Fix:** move line 109 below the guard, so a snapshot that wasn't merged never claims to have
been:

```ts
export function applySyncSnapshot(snapshot: SyncSnapshot): void {
  const uk = getUnlockedUserKey();
  if (uk === null) return;
  lastKnownRevision = snapshot.revision;
  ...
}
```

### IN-02: `applySyncSnapshot` broadcasts `vault.updated` twice per snapshot

**File:** `extension/entrypoints/background/vault-store.ts:117-124`

**Issue:** A full snapshot has both `items` and `folders`, so `notifyListeners()` fires at
line 119 and again at line 123 — two `browser.runtime.sendMessage` broadcasts, and (via
`ItemListView.tsx:87-97`) two `vault.list` round trips per sync. This gets worse if CR-01's fix
hangs a `session.status` fetch off the same broadcast.

**Fix:** hoist to a single call after both branches:

```ts
let changed = false;
if (snapshot.items !== undefined) { items = snapshot.items.map(...); changed = true; }
if (snapshot.folders !== undefined) { folders = snapshot.folders.map(...); changed = true; }
if (changed) notifyListeners();
```

### IN-03: `create` validates `credential_id`/`prf_wrapped_uk` non-empty but not `prf_salt`, and has no per-user row cap

**File:** `crates/pv-server/src/routes/extension_passkeys.rs:52-63`

**Issue:** The trim-then-check at line 54 covers `credential_id` and `prf_wrapped_uk` but skips
`prf_salt`; `STANDARD.decode("")` succeeds, so an empty salt is accepted and stored. Harmless
today (the client always generates 32 random bytes at `ext-passkey.ts:98`) but it's a
zero-length public-salt row the client will later feed to `prf.eval.first`. Separately, there
is no cap on rows per user and no size bound on `prf_wrapped_uk` beyond axum's default body
limit, so an authenticated user can grow the table without bound.

**Fix:** include `prf_salt` in the emptiness check and assert the decoded length matches
`pv_core::prf::PRF_SALT_LEN`:

```rust
let prf_salt = STANDARD.decode(req.prf_salt.trim())
    .map_err(|_| ApiError::BadRequest("prf_salt must be valid base64".into()))?;
if prf_salt.len() != pv_core::prf::PRF_SALT_LEN {
    return Err(ApiError::BadRequest("prf_salt must be 32 bytes".into()));
}
```

### IN-04: `AUTOLOCK_OPTIONS` hand-duplicated across three files with no gate

**File:** `extension/entrypoints/popup/ItemListView.tsx:24-31` (vs `extension/entrypoints/background/autolock.ts:16`, vs `web/src/lib/idle/autolock.ts`)

**Issue:** The D-05 rationale for not importing from `autolock.ts` is sound (it drags the
WASM-adjacent import chain into the popup bundle), but "Keep the two arrays in sync by hand"
is not a control. Drift means the popup offers a value `validateIdleMinutes()`
(`autolock.ts:27-31`) and `setAutoLockMinutes()` (`router.ts:223-225`) will silently reject
back to 15 — the exact symptom of the UAT-found inert-control bug, minus the visible cause.

**Fix:** move the constant into a pure shared module (`extension/lib/autolock-options.ts`),
the same extraction `lib/server-url.ts` already applies to solve the identical problem, and
import it from both sides.

### IN-05: Debug `console.log` in the production background entry point

**File:** `extension/entrypoints/background.ts:34`

**Issue:** `console.log('[passkey-vault] background context started')` runs on every service
worker wake. No secrets are logged, but it is a leftover diagnostic. If it is deliberately kept
as a lifecycle marker, say so in a comment; otherwise drop it, or route it through a
`import.meta.env.DEV` guard.

### IN-06: Copied secrets are never cleared from the system clipboard

**File:** `extension/entrypoints/popup/ItemDetailView.tsx:77-87`

**Issue:** `handleCopy` writes the password/card number/TOTP secret to the system clipboard
with `navigator.clipboard.writeText(value)` and never clears it. The 1500ms `setTimeout`
(line 86) only resets the check-mark icon. The plaintext then outlives the popup, the
auto-lock, and the browser session in every clipboard manager on the machine. This matches the
v0.1 web app's behavior, so it is a carried-over gap rather than a Phase 9 regression — but
CR-01's scenario (auto-lock while a secret is on screen) makes it more visible, and a password
manager clearing the clipboard on a timer is table stakes.

**Fix:** track a clipboard-clear timer and wipe on lock and on a bounded timeout:

```ts
setTimeout(() => { void navigator.clipboard.writeText("").catch(() => {}); }, 30_000);
```

Worth raising as a cross-cutting item for a later phase rather than fixing only in the popup.

---

_Reviewed: 2026-07-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
