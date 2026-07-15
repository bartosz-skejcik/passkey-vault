# Phase 9: Session Unlock Core, Popup & Sync Client - Pattern Map

**Mapped:** 2026-07-14
**Files analyzed:** ~16 new/modified files (popup UI, background session core, sync client, messaging, CORS)
**Analogs found:** 14 / 16

## Scope note

Phase 9 builds on Phase 8's bootstrap spike (`extension/entrypoints/background/wasm-loader.ts`, a proto `vault-session.ts` idle-kill/wake round-trip). This phase turns that spike into the real thing: full unlock (password + PRF), a durable `chrome.storage.session` envelope with auto-lock alarms, a popup UI, a ported REST/WS sync client, and the server-side CORS allowlist. Read `.planning/phases/08-extension-bootstrap-wasm-in-background-spike/08-PATTERNS.md` first — this file does not repeat Phase 8's WASM-loader/CSP patterns, only extends them.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `extension/entrypoints/background/vault-session.ts` (full session core, extends Phase 8 spike) | service | CRUD (key lifecycle) + event-driven (alarms) | `web/src/lib/crypto/index.ts` lines 102-141 (lock-state singleton) | role-match — storage target changes from module var to `chrome.storage.session`; no direct analog for the alarm-driven auto-lock half |
| `extension/entrypoints/background/session-storage.ts` (new: `chrome.storage.session` read/write helpers) | utility | file-I/O (storage) | none direct; nearest shape is `web/src/lib/auth/session.ts` (get/set/clear localStorage triad) | role-match (same get/set/clear shape, different storage backend + async) |
| `extension/entrypoints/background/autolock.ts` (chrome.alarms-driven idle timeout) | service | event-driven | `web/src/lib/idle/autolock.ts` (localStorage-backed timeout config/whitelist) + `web/src/lib/idle/useIdleTimer.ts` (timer arm/reset) | role-match — config/whitelist pattern reusable verbatim; timer mechanism diverges (alarms vs `setTimeout`) |
| `extension/entrypoints/background/unlock.ts` (password + PRF unlock orchestration) | service | request-response | `web/src/lib/passkeys/login.ts` (`passkeyUnlock`) + `web/src/components/auth/UnlockOverlay.tsx` (password branch, lines ~50-90) | exact — same ceremony logic, ported from React component into background message handler |
| `extension/entrypoints/background/sync-client.ts` | service | pub-sub (WS) + poll | `web/src/lib/vault/sync.ts` (whole file) | exact — same WS+30s-poll+backoff structure verbatim |
| `extension/entrypoints/background/vault-api.ts` (REST client for items/folders/sync) | service | CRUD | `web/src/lib/vault/api.ts` + `web/src/lib/auth/api.ts` (`apiFetch`/`apiJson`) | exact — same fetch/auth-header/error-shape conventions |
| `extension/entrypoints/background/vault-store.ts` (decrypted in-memory items/folders + merge) | store | CRUD | `web/src/lib/vault/store.ts` | exact — same singleton-array + `applySyncSnapshot` merge shape; `useSyncExternalStore` React hooks replaced by message-based popup queries |
| `extension/lib/messaging/ext-protocol.ts` (typed background<->popup message schema) | utility | request-response | none in web app (single-process, no cross-context messaging) | no analog — new pattern, follow RESEARCH.md's typed-schema recommendation |
| `extension/entrypoints/background/message-router.ts` (dispatches `runtime.onMessage`) | controller | event-driven | `crates/pv-server/src/routes/mod.rs` `router()` (route-table shape, lines 30-56) | role-match — same "one table mapping named actions to handlers" idea, different transport (in-process messages vs HTTP) |
| `extension/entrypoints/popup/App.tsx` (shell: locked vs unlocked view switch) | component | request-response | `web/src/app/page.tsx` (top-level lock-gated render) + `web/src/components/auth/UnlockOverlay.tsx` (locked-state gate) | role-match |
| `extension/entrypoints/popup/UnlockView.tsx` (password + PRF unlock form) | component | request-response | `web/src/components/auth/UnlockOverlay.tsx` + `web/src/components/auth/PasskeyUnlockButton.tsx` | exact — same two-affordance (password field + PRF button) layout, smaller viewport |
| `extension/entrypoints/popup/ItemListView.tsx` (browse/search) | component | request-response | `web/src/components/vault/ItemList.tsx` + `web/src/components/vault/ItemRow.tsx` | exact — same `searchItems`/`filterItems` composition, data now arrives via message round-trip instead of `useVaultItems()` |
| `extension/entrypoints/popup/ItemDetailView.tsx` (minimal detail/pick pane) | component | request-response | `web/src/components/vault/DetailPanel.tsx` | role-match — subset of fields only (no edit UI, per CONTEXT.md OUT-of-scope) |
| `extension/lib/vault/search.ts` (reused search logic) | utility | transform | `web/src/lib/vault/search.ts` | exact — copy verbatim, same pure functions, no browser API dependency |
| `extension/lib/vault/types.ts` (reused item/folder types) | model | n/a | `web/src/lib/vault/types.ts` | exact — copy verbatim (same `ItemFields`/`VaultItem`/`Folder` shapes; server contract is unchanged, D-07) |
| `crates/pv-server/src/routes/mod.rs` `cors_layer()` (modify: add extension-origin allowlist) | middleware | request-response | itself, lines 76-95 | exact — extend, do not replace, existing `PV_DEV_CORS` toggle |
| `crates/pv-server/src/config.rs` (add `PV_EXTENSION_ORIGINS` or similar env var) | config | n/a | `Config::from_env()` lines 17-28 (`PV_RP_ID`/`PV_ORIGIN` env-var + default pattern) | exact — same `std::env::var(...).unwrap_or_else(...)` shape |

## Pattern Assignments

### `extension/entrypoints/background/session-storage.ts` (utility, file-I/O)

**Analog:** `web/src/lib/auth/session.ts` (whole file, lines 1-57)

**Shape to copy** (get/set/clear triad, defensive try/catch):
```typescript
const SESSION_TOKEN_KEY = "pv-session-token";

export function getSessionToken(): string | null {
  try {
    return localStorage.getItem(SESSION_TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setSessionToken(token: string): void {
  try {
    localStorage.setItem(SESSION_TOKEN_KEY, token);
  } catch { /* private mode etc. */ }
}
```

**Divergence (must apply):** every one of these becomes `async` (`chrome.storage.session.get`/`.set`/`.remove` are all Promise-based), and the *bearer session token* moves into this same `chrome.storage.session` area per CONTEXT.md's Discretion Area note ("chrome.storage.session is likely the better home for the bearer token too... rather than introducing a second storage mechanism") — do not keep a separate `localStorage`-equivalent for the extension; there is no `localStorage` persistence model that fits MV3 background contexts anyway. Use a single storage area with distinct keys (e.g., `pv-session-token`, `pv-uk-envelope`, `pv-account-email`) mirroring the three key names `web/src/lib/auth/session.ts` already uses.

**Critical namespacing (D-01/D-09 invariant):** set `chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` once at background startup — this is the concrete API call satisfying "access_level kept extension-only (never granted to content scripts)". No web-app analog for this call exists (browser-only API); follow RESEARCH.md's Pattern 2 guidance directly.

---

### `extension/entrypoints/background/vault-session.ts` (service, CRUD + event-driven)

**Analog:** `web/src/lib/crypto/index.ts` lines 102-141 (`currentUserKey`, `setUnlockedUserKey`, `getUnlockedUserKey`, `lockVault`) — same lifecycle shape as Phase 8's spike already noted, now made durable and complete.

**Pattern to copy (function surface):**
```typescript
let currentUserKey: WasmUserKey | null = null; // in-memory cache ONLY — never trusted alone

export function getUnlockedUserKey(): WasmUserKey | null {
  return currentUserKey; // may be null on a fresh SW instance — caller must re-hydrate first
}
```

**Divergence — this is the phase's core new work (no analog for the full loop):**
1. `setUnlockedUserKey(uk)`: free any existing handle, assign to `currentUserKey`, **then** export key bytes and `await sessionStorage.setUnlockedKeyBytes(bytes)`; zeroize the transient JS byte buffer immediately after the `set()` call resolves or rejects (mirrors Phase 8 PATTERNS.md's "Zeroize-regardless-of-outcome discipline", sourced from `crates/pv-wasm/src/lib.rs`'s unconditional-zeroize-before-return convention).
2. `ensureHydrated()`: called at the top of every background message handler (unlock, list items, sync pull) — if `currentUserKey === null`, `await sessionStorage.getUnlockedKeyBytes()`; if present, re-instantiate `pv-wasm` (Phase 8's `wasm-loader.ts`) and re-import bytes into a fresh opaque handle before proceeding; if absent, the vault is genuinely locked.
3. `lockVault()`: clears both `currentUserKey` and `chrome.storage.session`, then fires `stopSync()` (see sync-client below) — mirrors `web/src/lib/vault/store.ts`'s `subscribeLockState` handler (lines 325-338: stop sync BEFORE clearing in-memory arrays, so no in-flight sync callback fires after arrays are cleared).

---

### `extension/entrypoints/background/autolock.ts` (service, event-driven)

**Analog:** `web/src/lib/idle/autolock.ts` (whole file, 30 lines) — config/whitelist/default-value pattern to copy verbatim:
```typescript
export const AUTOLOCK_OPTIONS = [1, 5, 15, 30, 60];
export const DEFAULT_AUTOLOCK_MINUTES = "15";

export function readAutolockMinutes(): number {
  // same whitelist-validated read, source now chrome.storage.session/local
  // instead of localStorage — corrupted/out-of-whitelist values fall back
  // to DEFAULT_AUTOLOCK_MINUTES exactly as the web app does.
}
```

**Divergence (D-03, no analog):** the actual timer mechanism is NOT `web/src/lib/idle/useIdleTimer.ts`'s `setTimeout`-based hook (that pattern dies with the service worker) — use `chrome.alarms.create("pv-autolock", { delayInMinutes })` plus `chrome.alarms.onAlarm.addListener` calling `lockVault()`. Reset the alarm (clear + recreate) on every "activity" message from the popup (e.g., popup opened, item viewed) the same way `useIdleTimer.ts` resets its `setTimeout` on activity — same reset semantics, alarm-backed implementation.

---

### `extension/entrypoints/background/unlock.ts` (service, request-response)

**Analog A (password path):** `web/src/components/auth/UnlockOverlay.tsx` password-submit handler — derive `deriveAuthMaterial`/`WasmWrappingKey.fromPassword`-equivalent, then `unwrapUserKey`, then `setUnlockedUserKey`.

**Analog B (PRF path, copy near-verbatim):** `web/src/lib/passkeys/login.ts` `passkeyUnlock()` (lines 157-221) — port this function's body almost unchanged into the background context:
```typescript
const finish = await unlockFinish({ state_id: start.state_id, credential: stripPrfFromCredentialJson(assertion) });
if (finish.prf_wrapped_uk !== null) {
  const prfBytes = extractPrfBytes(assertion);
  if (prfBytes !== undefined) {
    const prfArray = new Uint8Array(prfBytes);
    const wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect
    try {
      const uk = unwrapUserKey(wrappingKey, finish.prf_wrapped_uk);
      setUnlockedUserKey(uk); // now: sync export to chrome.storage.session too, see vault-session.ts
    } finally {
      wrappingKey.free?.();
    }
  }
}
```
**Divergence:** `navigator.credentials.get()` for WebAuthn assertions is available in an MV3 background service worker (it's a standard Web API, not DOM-dependent) — verify this holds during implementation per RESEARCH.md's PRF-availability notes; if the ceremony must instead run in the popup's DOM context (popups are real documents), move the ceremony call there and pass only the resulting assertion JSON + derived key bytes to the background via message — but the zero-knowledge boundary (D-05: popup never touches raw crypto) still requires unwrap/`setUnlockedUserKey` to happen only in the background. `stripPrfFromCredentialJson`/`extractPrfBytes`/`buildPrfExtensions` helpers copy verbatim from `login.ts` lines 39-75 — same PRF-stripping defense-in-depth applies unchanged (D-06/D-09).

**Honest-degradation message (D-06):** reuse `web/src/lib/auth/prfUnavailable.ts`'s `setPrfUnavailableHint()` concept — surface a specific, non-silent "PRF unavailable, use your master password" state to `UnlockView.tsx`, not a generic error.

---

### `extension/entrypoints/background/sync-client.ts` (service, pub-sub)

**Analog:** `web/src/lib/vault/sync.ts` — copy the ENTIRE file's structure with only the token-source and env-var swapped:
```typescript
const POLL_INTERVAL_MS = 30_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

function wsUrl(token: string): string {
  const base = /* extension config: server URL, likely a stored setting, not NEXT_PUBLIC_API_BASE_URL */;
  const query = `?token=${encodeURIComponent(token)}`; // percent-encoding still required — same base64 '+' pitfall
  return `${base.replace(/^http/, "ws")}/api/sync/ws${query}`;
}
```
Same WS-notification-only / never-parsed-as-data invariant (D-07) applies unchanged: `socket.onmessage` triggers `pullOnce()` and nothing else. Same idempotent `startSync`/`stopSync` re-entry guard, same ±25% jitter backoff. `getSessionToken()` now reads from the async `session-storage.ts` helper instead of synchronous `localStorage` — every call site in the ported file must be adjusted for the `await`.

---

### `extension/entrypoints/background/vault-api.ts` / `vault-store.ts` (service + store, CRUD)

**Analog:** `web/src/lib/vault/api.ts` (whole file) + `web/src/lib/vault/store.ts` (`applySyncSnapshot`, `decryptItemRow`, `recombineEncryptedItem` — lines 146-204).

Copy the `apiJson`/`ItemRow`/`FolderRow`/`SyncSnapshot` wire shapes verbatim (server contract unchanged, D-07). Copy `applySyncSnapshot`'s wholesale-replace merge semantics verbatim (lines 178-196) — no diff/tombstone logic, matches v0.1 exactly. Since this phase excludes CRUD (CONTEXT.md OUT-of-scope), only port the **read path**: `getSyncSnapshot`, `decryptItemRow`, `decryptFolderRow`, the `useVaultItems`-equivalent getter — omit `createVaultItem`/`updateVaultItem`/`deleteVaultItem`/`RevisionConflictError` entirely (dead code for this phase; do not port it prematurely).

**Divergence:** no `useSyncExternalStore` (no React tree in the background) — instead, `vault-store.ts`'s `notifyListeners()` becomes a `chrome.runtime.sendMessage`/port broadcast to any open popup, so `ItemListView.tsx` can subscribe to live updates while open.

---

### `extension/lib/messaging/ext-protocol.ts` (new, no analog)

No existing codebase pattern for cross-context typed messaging (the web app is single-process). Follow RESEARCH.md's ARCHITECTURE.md recommended structure directly: a discriminated-union message type (`{type: "unlock", ...} | {type: "listItems"} | {type: "search", query: string} | ...`) shared by both `background/message-router.ts` and every popup view — mirrors the *spirit* of `web/src/lib/vault/api.ts`'s exported wire-shape interfaces (`ItemRow`, `SyncSnapshot`) as the single source of truth both ends import, just for an in-process channel instead of HTTP JSON.

---

### `extension/entrypoints/popup/UnlockView.tsx` (component, request-response)

**Analog:** `web/src/components/auth/UnlockOverlay.tsx` (whole file) + `web/src/components/auth/PasskeyUnlockButton.tsx`.

Same two-affordance layout — password field + submit, PRF button alongside — adapted to the popup's narrower viewport (CONTEXT.md Discretion Area). All actual crypto calls (`initCrypto`, `unwrapUserKey`, `setUnlockedUserKey`) that `UnlockOverlay.tsx` currently makes directly are, in the extension, replaced by a single `sendMessage({type: "unlock", ...})` call per D-05 — the popup component becomes a thin form + message-dispatch layer, never importing `@/lib/crypto` or WASM directly.

---

### `extension/entrypoints/popup/ItemListView.tsx` / `ItemDetailView.tsx` (component, request-response)

**Analog:** `web/src/components/vault/ItemList.tsx` (whole file, 40 lines) + `web/src/components/vault/ItemRow.tsx` + `web/src/components/vault/DetailPanel.tsx`.

Copy `ItemList.tsx`'s composition of `filterItems(items, filter)` then `searchItems(..., searchQuery)` verbatim (`extension/lib/vault/search.ts` is a straight copy of `web/src/lib/vault/search.ts`, zero browser-API dependency, safe to reuse as-is). The `items` array itself now arrives via a `sendMessage({type: "listItems"})` response (populated by `vault-store.ts` in the background) instead of the `useVaultItems()` hook — no `useSyncExternalStore` needed unless the popup wires up a `runtime.onMessage` listener for live push updates (recommended, matching v0.1's reactive-store feel).

---

## Shared Patterns

### Async storage-backed get/set/clear triad
**Source:** `web/src/lib/auth/session.ts` (whole file)
**Apply to:** `session-storage.ts`, `autolock.ts`'s config half — same defensive try/catch-around-storage-op shape, made `async` for `chrome.storage.session`.

### WASM choke-point / opaque-handle discipline (carried over from Phase 8)
**Source:** `web/src/lib/crypto/index.ts` (file header, lines 1-9)
**Apply to:** `vault-session.ts`, `unlock.ts` — only `background/` files import `pv-wasm`; popup/content-script code never does (D-05). This is the extension's equivalent of the existing grep-auditable web-app convention.

### Zeroize-regardless-of-outcome
**Source:** `crates/pv-wasm/src/lib.rs` (`from_password`/`from_prf` unconditional-zeroize-before-return) and `web/src/lib/crypto/index.ts` `deriveAuthMaterial`'s `finally { passwordBytes.fill(0) }`
**Apply to:** `vault-session.ts`'s key-bytes export/import round-trip into `chrome.storage.session` — zero the transient JS buffer in a `finally` immediately after the storage call settles.

### WS-notification-only / never-parsed-as-data sync boundary
**Source:** `web/src/lib/vault/sync.ts` lines 88-91 (`socket.onmessage = () => { void pullOnce(); }`)
**Apply to:** `sync-client.ts` — identical invariant, unchanged rationale (D-07, stronger form of SYNC-02's no-ciphertext-trust boundary).

### Env-var-gated server config
**Source:** `crates/pv-server/src/config.rs` `Config::from_env()` (lines 17-28)
**Apply to:** the new `PV_EXTENSION_ORIGINS` (or similarly-named) config field — same `std::env::var("X").ok().and_then(...).unwrap_or(default)` shape as `rp_id`/`rp_origin`/`session_ttl_hours`.

### Explicit env-gated CORS, extended not replaced
**Source:** `crates/pv-server/src/routes/mod.rs` `cors_layer()` (lines 76-95)
**Apply to:** D-08's allowlist work — current shape is a binary `PV_DEV_CORS` toggle between `CorsLayer::permissive()` and empty `CorsLayer::new()`. Extend to also parse an explicit list of allowed origins (`chrome-extension://<id>`, `moz-extension://<id>`) via `CorsLayer::new().allow_origin(AllowOrigin::list(...))`, applied regardless of `PV_DEV_CORS`'s state — the dev toggle and the extension allowlist are orthogonal, both must be able to be true/false independently. Verify against a real request (D-08), not just unit-tested against a mocked `Origin` header.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `extension/lib/messaging/ext-protocol.ts` | utility (typed schema) | request-response | v0.1 is a single-process web app with no cross-context messaging; this is a genuinely new pattern, follow RESEARCH.md ARCHITECTURE.md directly. |
| `chrome.storage.session.setAccessLevel(...)` call site | config/security | n/a | Browser-only API with no server/web-app equivalent; MDN-documented, not derivable from existing code. |
| `chrome.alarms`-driven auto-lock timer | service | event-driven | `web/src/lib/idle/useIdleTimer.ts` is `setTimeout`-based and dies with the SW; alarms API has no prior use in this repo. |

## Metadata

**Analog search scope:** `web/src/lib/crypto/`, `web/src/lib/auth/`, `web/src/lib/vault/`, `web/src/lib/idle/`, `web/src/lib/passkeys/`, `web/src/components/auth/`, `web/src/components/vault/`, `crates/pv-server/src/routes/`, `crates/pv-server/src/config.rs`, `.planning/phases/08-extension-bootstrap-wasm-in-background-spike/08-PATTERNS.md`, `.planning/research/ARCHITECTURE.md`
**Files scanned:** ~20
**Pattern extraction date:** 2026-07-14
