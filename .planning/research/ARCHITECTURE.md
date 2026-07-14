# Architecture Research

**Domain:** MV3 browser extension for a zero-knowledge passkey provider / password manager (WXT, Chrome+Firefox), integrating with existing pv-core/pv-wasm/pv-server
**Researched:** 2026-07-14
**Confidence:** MEDIUM (triangulated from Chrome/Mozilla official docs, Bitwarden's own public architecture docs, and WXT docs; no direct inspection of Bitwarden/1Password source, no direct experiment run in this repo yet)

## Standard Architecture

### System Overview

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Third-party web page (untrusted, MAIN world)                              │
│  ┌─────────────────────────────────────────────────────────────────┐     │
│  │ pv-page-bridge.js  (WXT content script, world: 'MAIN')           │     │
│  │  - saves native navigator.credentials.create/get in closure       │     │
│  │  - reassigns navigator.credentials.create/get                    │     │
│  │  - NO extension API access, NO WASM, NO key material              │     │
│  │  - talks only via window.postMessage(origin-scoped, nonce'd)      │     │
│  └───────────────────────────┬─────────────────────────────────────┘     │
└──────────────────────────────┼───────────────────────────────────────────┘
                                │ window.postMessage (untrusted boundary)
┌──────────────────────────────┼───────────────────────────────────────────┐
│ Extension: ISOLATED content script (per-tab, DOM + extension API access)  │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │ pv-relay.ts — validates postMessage origin/shape, forwards to    │     │
│  │ background via browser.runtime.sendMessage; also owns autofill   │     │
│  │ field-detection + form-submit capture (login/card/identity)      │     │
│  └───────────────────────────┬────────────────────────────────────┘     │
└──────────────────────────────┼───────────────────────────────────────────┘
                                │ runtime.sendMessage / runtime.Port
┌──────────────────────────────┼───────────────────────────────────────────┐
│ Extension: background service worker (MV3, event-driven, idle-killed)    │
│  ┌────────────────────────────────────────────────────────────────┐     │
│  │ pv-background.ts                                                 │     │
│  │  - loads pv-wasm (same choke-point crypto as web app)            │     │
│  │  - owns in-memory unlocked User Key handle (opaque, WASM-side)   │     │
│  │  - persists ONLY encrypted session material to storage.session   │     │
│  │  - runs passkey-rs soft authenticator (PRF-capable) for provider │     │
│  │    create/get ceremonies                                         │     │
│  │  - talks to pv-server: REST (auth/sync/CRUD) + WS (/api/sync/ws) │     │
│  └───────────┬──────────────────────────────────┬───────────────────┘     │
│              │                                  │                         │
│  ┌───────────┴───────────┐          ┌───────────┴────────────┐           │
│  │ Popup UI (WXT React)   │          │ chrome.storage.session  │           │
│  │ unlock, browse, search │          │ (encrypted-at-rest      │           │
│  │ item picker for fill   │          │  wrapped-UK envelope,   │           │
│  └────────────────────────┘          │  cleared on browser     │           │
│                                       │  restart/update)        │           │
│                                       └─────────────────────────┘           │
└───────────────────────────────────────────────────────────────────────────┘
                                │ HTTPS/WSS
                                ▼
                    pv-server (axum, unchanged from v0.1)
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| MAIN-world page bridge | Shadows `navigator.credentials.{create,get}`; captures native refs for fallback; has zero trust, zero secrets | WXT content script, `world: 'MAIN'`, no imports beyond a thin postMessage protocol client |
| ISOLATED content script (relay) | Trust boundary between untrusted page and extension; validates/shapes messages; owns DOM-level autofill (field detection, form-submit capture) | WXT content script, default `world: 'ISOLATED'`; `browser.runtime.sendMessage`/`Port` to background |
| Background service worker | Single owner of unlocked User Key handle, WASM instance, passkey-rs authenticator state, sync connection; all crypto and all server calls happen here | WXT `entrypoints/background/main.ts`, MV3 service worker |
| Popup UI | Vault browse/search/unlock/settings; talks to background only, never touches WASM or crypto directly | WXT popup entrypoint, React, reuses web app's `lib/crypto/` choke-point client, but all calls proxy to background |
| `chrome.storage.session` | Ephemeral, in-memory-only cross-SW-wake persistence for the wrapped/encrypted unlock envelope so the SW can re-derive access without prompting again after idle-kill | `storage.session` API, `access_level` kept extension-only (never granted to content scripts) |
| pv-wasm (reused) | Same crate/bindings as web app; opaque-handle keys; loaded once in background context | wasm-bindgen output, bundled by WXT, CSP `wasm-unsafe-eval` |
| passkey-rs (new, WASM) | Soft WebAuthn authenticator with PRF/hmac-secret emulation; runs credential create/get ceremonies for third-party RPs when the extension acts as provider | Rust crate compiled to the *same* WASM artifact as pv-wasm or a sibling module loaded in background |
| pv-server client (reused) | REST for auth/sync/CRUD, WS for `/api/sync/ws`; same API surface v0.1 web app already speaks | fetch/WebSocket wrapper in background, token in `storage.session` (extension-only), not exposed to content scripts |

## Recommended Project Structure

```
extension/                       # new WXT project (sibling to web/)
├── wxt.config.ts                # MV3 manifest gen, dual Chrome/Firefox targets, CSP (wasm-unsafe-eval)
├── entrypoints/
│   ├── background/
│   │   ├── index.ts             # SW entry: registers listeners, boots WASM lazily on first message
│   │   ├── wasm-loader.ts       # fetch()+instantiate pv-wasm ArrayBuffer (not instantiateStreaming)
│   │   ├── vault-session.ts     # unlocked-UK handle lifecycle, storage.session read/write, re-hydrate on wake
│   │   ├── provider-ceremony.ts # passkey-rs create/get ceremony orchestration (PRF included)
│   │   ├── sync-client.ts       # REST + WS client, reuses pv-server contracts from v0.1
│   │   └── router.ts            # runtime.onMessage / onConnect dispatch table
│   ├── content-relay.content.ts # ISOLATED world: postMessage<->runtime bridge + autofill DOM logic
│   ├── page-bridge.content.ts   # MAIN world: navigator.credentials patch (thin, no deps)
│   └── popup/
│       ├── main.tsx             # React root
│       └── ...                  # unlock, item list/search, settings — talks only to background
├── lib/
│   ├── messaging/                # typed message schemas shared by all 3 contexts (page/content/background)
│   │   ├── page-protocol.ts      # page<->content postMessage envelope (nonce, origin pinning)
│   │   └── ext-protocol.ts       # content<->background / popup<->background runtime messages
│   └── crypto/                   # thin wrapper around pv-wasm bindings, background-only import
├── public/
│   └── pv_wasm_bg.wasm           # bundled wasm binary (via WXT asset pipeline)
└── package.json                  # depends on pv-wasm build output (workspace link, mirrors web/)
```

### Structure Rationale

- **Three-context split (page/content/background) mirrors the trust boundary, not convenience.** The MAIN-world file must stay minimal and dependency-free because it executes inside the hostile page's JS realm — any bug there is page-observable. Bitwarden's shipped design uses the same "save native refs, reassign, relay via postMessage → content script → background" shape; we follow it rather than inventing a new pattern.
- **`lib/messaging/` as a typed contract layer** prevents the classic extension bug class: content script and background silently drifting on message shape. Two protocols, not one — page↔content (untrusted, must validate everything) is a different trust tier than content↔background (trusted, extension-internal).
- **Only the background imports pv-wasm/passkey-rs.** Popup and content scripts never load WASM or touch key material directly; they proxy through background messages. This keeps the "single grep-auditable choke-point" property from v0.1 (`web/src/lib/crypto/`) — for the extension the choke-point is background-only, not popup+background.

## Architectural Patterns

### Pattern 1: MAIN-world shim + ISOLATED relay + background broker (3-hop bridge)

**What:** The page-visible `navigator.credentials.create/get` override lives in a MAIN-world content script with no extension privileges. It never talks to the background directly (it can't — MAIN world has no `browser.*` API). It posts a message to `window`, which the ISOLATED-world content script (injected into the same frame) picks up via a `message` event listener, validates, and forwards over `browser.runtime.sendMessage`/`Port` to the background service worker, which owns the actual WebAuthn/PRF ceremony logic and vault access.

**When to use:** Any time page-context JS needs extension-privileged capability (credential ceremonies, vault reads) — this is the only architecture available in MV3 today; there is no official "extension provides WebAuthn" API (w3c/webextensions#361 still open).

**Trade-offs:** +Keeps untrusted code minimal and auditable; +survives Chrome/Firefox both since both support MAIN world content scripts. −3 hops of messaging add latency (typically imperceptible, tens of ms) and require careful message-origin validation at each boundary (a compromised page could spam the postMessage channel — must nonce/reply-match and reject unexpected origins). −Two menedżery patching the same page fight over which override wins (known ecosystem-wide issue, not specific to us — see PITFALLS.md-equivalent content).

**Example (message envelope shape, not full code):**
```typescript
// page-bridge.content.ts (MAIN world)
window.postMessage({ pv: true, id: crypto.randomUUID(), kind: 'credentials.create', payload: serializedOptions }, location.origin);

// content-relay.content.ts (ISOLATED world)
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data?.pv) return;
  browser.runtime.sendMessage({ ...e.data, tabOrigin: location.origin });
});

// router.ts (background)
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.kind === 'credentials.create') return providerCeremony.create(msg.payload, sender.tab, msg.tabOrigin);
});
```

### Pattern 2: Ephemeral unlocked-key survival across SW idle-kill via `chrome.storage.session`

**What:** The background service worker is killed ~30s after its last event with no unload hook. The unwrapped User Key (or a WASM opaque handle to it) that lives only in the SW's JS heap is destroyed on every kill. To avoid re-prompting the user for master password/PRF on every idle wake, store a short-TTL, still-locked-behind-something envelope in `storage.session` (in-memory only, never touches disk, cleared on browser restart/extension update) — e.g., the User Key encrypted under an ephemeral per-session key that itself lives only as long as the popup was last open, or a short "grace period" timestamp gating auto-relock.

**When to use:** Any MV3 extension holding decrypted secrets that must survive across SW wake/sleep cycles within one browser session, but must NOT survive browser restart (that boundary should force re-unlock).

**Trade-offs:** +No plaintext key ever hits `storage.local`/disk; +`storage.session` access can be scoped extension-only (default) so content scripts and pages can never read it even if compromised. −WASM opaque-handle keys (v0.1's pattern: "raw key bytes never cross the WASM boundary") don't survive SW termination — the WASM instance itself is destroyed, so on every wake you must re-instantiate WASM AND re-import the key material from the envelope, meaning the envelope necessarily holds exportable key bytes (base64/JSON) for that round-trip, not just an opaque handle. This is a deliberate, narrow exception to the "keys never leave WASM" invariant and needs its own threat-model note (mitigated by: extension-only storage.session, no disk persistence, browser-restart clears it, and a configurable inactivity auto-lock that clears it early).
**Recommendation:** define an explicit "extension session key" scope in pv-wasm/pv-core (or a small extension-local wrapper) distinct from the web app's in-memory-only choke-point, and document it as the one sanctioned place where wrapped key bytes are allowed to leave a single WASM instance's memory — still never leaving the background JS context, never touching `storage.local`, never reachable by content scripts.

### Pattern 3: WASM loaded once, lazily, in the background context only

**What:** `pv-wasm` (and the new `passkey-rs`-based authenticator, likely compiled into the same or a sibling WASM module) is fetched and instantiated exactly once, on first background message that needs crypto, inside `entrypoints/background/wasm-loader.ts`. Popup and content scripts never `import` WASM; they always go through background messages.

**When to use:** Standard for any MV3 extension shipping WASM — CSP requires `wasm-unsafe-eval` in `content_security_policy.extension_pages`, and `WebAssembly.instantiateStreaming` from extension-packaged `.wasm` has had cross-browser reliability issues, so `fetch()` → `ArrayBuffer` → `WebAssembly.instantiate()` is the safer, more portable path (works identically on Chrome and Firefox, avoids MIME-type quirks with `moz-extension://`/`chrome-extension://` URLs).

**Trade-offs:** +Single audit point retained (mirrors web app's `lib/crypto/` choke-point, just relocated to background); +avoids loading WASM 3x (popup+content+background) which would triple memory/init cost and triple the attack surface. −Every popup/content-script crypto need becomes an async message round-trip instead of a direct call — acceptable given security ops are already inherently async (WebAuthn ceremonies, network calls).

## Data Flow

### Request Flow — Third-party site calls `navigator.credentials.get()` (login with saved passkey)

```
Page JS calls navigator.credentials.get(publicKeyOptions)
    ↓ (patched fn, MAIN world)
page-bridge.content.ts serializes options → window.postMessage
    ↓ (DOM message event, validated by origin)
content-relay.content.ts → browser.runtime.sendMessage({kind:'credentials.get', ...})
    ↓ (runtime message, MV3 wakes SW if idle)
background/router.ts → provider-ceremony.ts
    ↓ needs unlocked UK? → vault-session.ts checks storage.session envelope
    ↓  (if locked) → opens popup for unlock prompt, awaits response
    ↓ passkey-rs (WASM) performs assertion ceremony incl. PRF eval if requested
    ↓ result serialized (PublicKeyCredential shape)
background → runtime response → content-relay → window.postMessage → page-bridge
    ↓
page-bridge resolves the original navigator.credentials.get() Promise with the assertion
```

### Request Flow — Autofill on a login form (existing saved item, no passkey involved)

```
User focuses a password field
    ↓
content-relay.content.ts (DOM field-detection) → runtime.sendMessage({kind:'autofill.match', origin})
    ↓
background queries decrypted-in-WASM vault items matching origin (never sends full vault to content script)
    ↓ returns only the matched item's fillable fields (already-decrypted plaintext, single item, short-lived)
content-relay fills DOM fields directly (never re-exposes to page JS beyond native input events)
```

### Sync / Server Communication

```
background/sync-client.ts
    ↔ REST: POST /api/auth/*, GET/PUT vault CRUD — same contracts as v0.1 web app
    ↔ WS: /api/sync/ws (token in query, revision-gated push) — identical protocol to web app's WS client
    ↔ bearer session token stored in storage.session (extension-only access level), never in storage.local
```

Reusing the exact same REST/WS contracts pv-server already exposes to the web app means **no server changes are required for v0.2** — the extension is just another authenticated client. The only new server-side consideration is CORS/origin allowlisting if the extension makes direct fetches from a `chrome-extension://` origin (verify `pv-server`'s CORS config permits extension origins, or proxy is not needed since it's not a content-script fetch, it's a background-context fetch which is not subject to page CORS in the same way — confirm with a quick CSP/CORS check during planning).

## Scaling Considerations

Not applicable in the traditional "requests per second" sense — this is a client extension. The relevant "scale" axis is **cross-tab / cross-frame consistency**:

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1 tab, 1 frame | Direct 3-hop bridge as described; no coordination needed |
| Many tabs open simultaneously | Background is the single source of truth (one SW instance per extension, shared across all tabs) — no per-tab state duplication needed; `storage.session` read is naturally shared |
| Iframes / cross-origin embeds on one page | Each frame gets its own content script instance; MAIN-world patch must apply per-frame; background must track `sender.tab.id` + frame origin to avoid leaking one origin's autofill match to a different embedded origin |
| Multiple extension instances (Chrome + Firefox open) | No shared state between browsers by design (each has its own storage.session) — sync via pv-server is the only cross-instance channel, already handled by existing WS sync |

### Scaling Priorities

1. **First real risk: SW cold-start latency on WASM re-init.** Every idle-kill + wake means re-fetching/re-instantiating WASM before the first crypto op can run. Mitigate by keeping the WASM binary small and instantiation fast (already true for pv-wasm per v0.1 decisions), and by treating "SW just woke up" as a normal, frequent code path (test it explicitly, not just cold app start).
2. **Second: message validation cost/complexity growth as more ceremony types are added** (create, get, conditional mediation, autofill match, capture-on-submit). Keep the typed protocol layer (`lib/messaging/`) as the single place new message kinds are registered, to avoid ad-hoc `if (msg.type === ...)` sprawl across three files.

## Anti-Patterns

### Anti-Pattern 1: Loading WASM or importing crypto in the popup or content script

**What people do:** Import `pv-wasm` directly in the popup bundle "for simplicity" so popup UI can decrypt/encrypt without round-tripping through background.
**Why it's wrong:** Breaks the single-choke-point audit property that v0.1 established (`web/src/lib/crypto/`); duplicates WASM instances (memory, init cost); and worse, if the popup ever needs to run inside a context reachable from a compromised content script (it doesn't currently, but the risk of future refactors making this true is real), it multiplies the attack surface for key material handling.
**Do this instead:** Popup always proxies through `browser.runtime.sendMessage` to background for anything crypto-related. Popup owns UI/UX state only (search filter, selected item, unlock form fields) — the actual unlock ceremony and decrypt call happen in background, which returns only the minimal decrypted result needed (e.g., autofill values for one item, not the whole vault).

### Anti-Pattern 2: Persisting the raw unlocked User Key to `storage.local` "to survive restarts smoothly"

**What people do:** To avoid the UX friction of re-unlocking after every browser restart, some extensions are tempted to persist the unlocked key (or a long-lived unlock token) to `storage.local`, which is disk-backed and survives restarts.
**Why it's wrong:** Directly violates the zero-knowledge/local-secrecy invariant this project is built on — disk-persisted plaintext key material is a forensic target (disk image, backup, sync via browser account sync if the user has Chrome/Firefox account sync enabled on `storage.local`-adjacent settings) and defeats the entire point of PRF/password-gated unlock.
**Do this instead:** Use `storage.session` exclusively for anything unlocked-secret-adjacent (cleared on restart by design); implement a configurable auto-lock timer in background using `chrome.alarms` (survives SW sleep, unlike `setTimeout`) to proactively clear the session envelope after inactivity, independent of the SW's own idle-kill.

### Anti-Pattern 3: Trusting `postMessage` sender identity without validation

**What people do:** MAIN-world script posts a message and the ISOLATED content script listener assumes anything arriving on `window` with the right-looking shape came from the legitimate page bridge.
**Why it's wrong:** Any script running on the page (including the page itself, or another injected script) can call `window.postMessage` with an arbitrary payload mimicking the extension's protocol, potentially tricking the content script into forwarding attacker-controlled data to background as if it were a legitimate WebAuthn request, or triggering autofill/credential disclosure through a forged request.
**Do this instead:** Validate `event.source === window`, pin `event.origin` to the current frame's expected origin, include a per-message nonce that must round-trip, and have background independently verify `sender.tab`/`sender.frameId`/`sender.origin` from the `runtime.onMessage` sender object (which the page cannot forge) rather than trusting only the payload's self-reported origin field.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| pv-server (existing) | Background makes REST + WS calls exactly as v0.1 web app does — same auth/session/sync/CRUD endpoints, same bearer-token-in-query-stripped-from-logs WS pattern | No server changes expected for v0.2; verify CORS/origin allowlist accepts `chrome-extension://<id>` and `moz-extension://<id>` origins during planning (background-context fetches, not page-context, so page CORS restrictions don't apply, but pv-server's own allowlist config might) |
| Third-party RP websites | Passive integration via patched `navigator.credentials` — extension never calls out to third-party servers itself; it only intercepts calls the page already makes | Must fall through to native WebAuthn when user declines or when RP requires a capability the soft authenticator (passkey-rs, ES256-only) can't satisfy |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| Page (MAIN world) ↔ ISOLATED content script | `window.postMessage`, origin-pinned, nonce'd | Untrusted boundary — treat page as hostile even though it's "our own patch" running there |
| ISOLATED content script ↔ background SW | `browser.runtime.sendMessage` / `Port` (typed protocol in `lib/messaging/ext-protocol.ts`) | Trusted boundary, but background must still verify `sender` metadata, not just payload |
| Popup ↔ background SW | Same `runtime.sendMessage`/`Port` channel and protocol as content scripts | Popup has zero direct crypto/WASM/network access |
| Background ↔ pv-wasm / passkey-rs (WASM) | Direct in-process function calls after one-time `fetch()`+`instantiate()` | Only this context imports/instantiates WASM |
| Background ↔ pv-server | HTTPS/WSS, reusing v0.1 client contracts | Bearer token lives in `storage.session`, extension-only access level |
| Background ↔ `chrome.storage.session` | Read/write on SW wake and on lock/unlock/timeout events | The only place unlocked-adjacent key material may persist across SW restarts; never `storage.local` |

## Suggested Build Order (respecting dependencies)

1. **WXT scaffold + background WASM loading spike.** Stand up the bare WXT project (Chrome+Firefox targets), get `pv-wasm` fetched/instantiated inside a background service worker with correct CSP (`wasm-unsafe-eval`), and prove a round-trip crypto call (e.g., decrypt a test item) survives a manual SW idle-kill/wake cycle. This de-risks the two hardest unknowns (WASM-in-MV3-SW, key survival across idle-kill) before building anything user-facing.
2. **Background session/unlock core + popup shell.** Implement `vault-session.ts` (storage.session envelope, auto-lock via `chrome.alarms`), wire the popup for unlock (password first; PRF unlock reuses v0.1 PRF logic once the WASM+passkey-rs authenticator exists) and basic item browse/search — this is "vault access from the extension," independent of the provider/autofill surface.
3. **Sync client in background.** Port the web app's REST+WS sync client into `sync-client.ts`; verify multi-device sync (already proven live in 2 tabs for web app) now also works with the extension as a third synced client. Do this before autofill/provider work so vault data is real, not mocked.
4. **Autofill (login/card/identity/TOTP fill on existing forms).** Lower-risk, higher day-to-day value than the provider patch, and validates the content-relay ↔ background messaging pattern end-to-end on read-heavy, non-security-critical operations first.
5. **Generate & capture (password generator on signup forms, save-new-login prompt on submit, change-password detection).** Builds on the same content-relay DOM instrumentation from step 4; still no MAIN-world patch needed yet.
6. **Passkey provider: MAIN-world patch + passkey-rs soft authenticator + PRF.** Highest-risk, highest-novelty piece — do it last, once the messaging pipeline (steps 1–4) and WASM/session lifecycle (steps 1–2) are proven solid, since this is where an untrusted-boundary bug is most consequential (forged WebAuthn ceremonies) and where the "race with the browser/other password managers" risk (w3c/webextensions#361) lives.
7. **Dual-browser hardening pass (Firefox-specific quirks).** WXT's dual-output handles most manifest differences, but PRF is Chromium-first per project research — explicitly verify/document the Firefox fallback-to-password-unlock path and any WASM/CSP divergence before calling v0.2 done.

This order is deliberately "prove the scary infra first (1), then vault access (2-3), then read-mostly page integration (4-5), then the highest-risk write/impersonation surface (6), then cross-browser polish (7)" — each step produces a demoable, mergeable slice rather than a big-bang integration at the end.

## Sources

- [Migrate to a service worker — Chrome for Developers](https://developer.chrome.com/docs/extensions/mv3/migrating_to_service_workers/) — MEDIUM
- [Offscreen Documents in Manifest V3 — Chrome for Developers](https://developer.chrome.com/blog/Offscreen-Documents-in-Manifest-v3) — MEDIUM
- [chrome.storage API — Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/storage) — MEDIUM
- [storage.session — MDN](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session) — MEDIUM
- [Content Scripts — WXT](https://wxt.dev/guide/essentials/content-scripts.html) — MEDIUM
- [WXT entrypoints guide](https://wxt.dev/guide/essentials/entrypoints.html) — MEDIUM
- [Bitwarden Contributing Docs — Browser extension passkey provider](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/provider/browser-extension/) — MEDIUM (self-published by Bitwarden about their own shipped architecture)
- [Bitwarden — transitions from Manifest v2 to v3](https://bitwarden.com/blog/bitwarden-manifest-v3/) — MEDIUM
- [PRF WebAuthn and its role in passkeys — Bitwarden blog](https://bitwarden.com/blog/prf-webauthn-and-its-role-in-passkeys/) — MEDIUM
- [Developers Guide to PRF — Yubico](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html) — MEDIUM
- [w3c/webextensions#361 — official credential-provider API for extensions (open, Safari opposed)](https://github.com/w3c/webextensions/issues/361) — MEDIUM (already cited in project's own RESEARCH.md)
- Chromium bug tracker / groups threads on WASM-in-MV3 CSP requirements — LOW-MEDIUM (community threads, cross-checked against official CSP docs)

---
*Architecture research for: MV3 browser extension integration (v0.2 milestone)*
*Researched: 2026-07-14*
