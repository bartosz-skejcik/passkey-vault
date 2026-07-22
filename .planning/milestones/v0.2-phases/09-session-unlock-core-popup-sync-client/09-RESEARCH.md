# Phase 9: Session Unlock Core, Popup & Sync Client - Research

**Researched:** 2026-07-14
**Domain:** MV3 extension session/key lifecycle (`chrome.storage.session` + `chrome.alarms`), WXT popup (React), background↔popup messaging, background REST/WS sync client, `pv-server` CORS allowlist
**Confidence:** MEDIUM-HIGH (v0.1 code patterns and `pv-wasm` API surface verified directly from source — HIGH; MV3 platform/WXT specifics verified via official docs and cross-checked community sources — MEDIUM; no MCP doc-fetch tools were available in this session, all web findings are WebSearch-sourced, not Context7)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (INVARIANT / SC #2):** The unlocked User Key (or its extension-session envelope) lives ONLY in `chrome.storage.session`, with `access_level` kept extension-only (never granted to content scripts) — never `chrome.storage.local`, never a bare module-level JS variable as the sole copy. Every background message handler must treat itself as possibly-just-woken and re-hydrate from `storage.session` rather than assuming in-memory state survived.
- **D-02 (ARCHITECTURE.md Pattern 2, INVARIANT):** Because the WASM instance itself is destroyed on SW idle-kill, the `storage.session` envelope necessarily holds exportable key material (not just an opaque WASM handle) to survive the round-trip. This is a deliberate, narrow, documented exception to the "keys never leave WASM" invariant from v0.1 — mitigated by: extension-only storage scope, no disk persistence, browser-restart clears it, and the auto-lock timer clears it early. This exception must be called out explicitly in code comments at the point it's implemented (mirrors v0.1's "why memory is zeroized" documentation convention).
- **D-03 (SC #3 / EXT-03):** Auto-lock uses `chrome.alarms` (not `setInterval`/`setTimeout`), because alarms survive SW sleep/wake while timers don't (PITFALLS.md Anti-Pattern 2, ARCHITECTURE.md). The idle timeout is configurable (EXT-03's exact wording), defaulting to a reasonable value — the specific default minutes is a planner/UX discretion call (see Discretion Areas), not locked here.
- **D-04 (SC #3):** The session also clears on browser close — `storage.session` is cleared on browser restart by platform design (MDN-documented behavior for both Chrome and Firefox), so this is satisfied by using `storage.session` correctly rather than needing separate close-detection logic.
- **D-05 (ARCHITECTURE.md Anti-Pattern 1, "single choke point"):** The popup NEVER imports WASM or pv-core directly. All unlock, decrypt, and crypto operations happen in the background service worker; popup proxies everything via `browser.runtime.sendMessage`/`Port`. This mirrors v0.1's `web/src/lib/crypto/` single-audit-point pattern, just relocated to the background context.
- **D-06 (SC #1, PITFALLS.md Pitfall 2, PROJECT constraint):** PRF unlock is attempted where the browser/authenticator supports it; Chromium-first. Where PRF is unavailable, the flow degrades honestly with a specific message — never silent failure — and master-password unlock remains the universal fallback path. (Full Chrome/Firefox parity verification is Phase 13's job; Phase 9 just needs the honest-degradation behavior to exist, not exhaustively hardened.)
- **D-07 (SC #4 / EXT-04, ARCHITECTURE.md "no server changes required"):** The sync client reuses the EXACT v0.1 REST/WS contracts unchanged (`GET /api/sync?since=N`, `GET /api/sync/ws`, bearer-token-in-query pattern) — no new server endpoints for sync itself. `sync-client.ts` in the background is structurally the same WS+30s-poll-fallback+exponential-backoff pattern as `web/src/lib/vault/sync.ts` (WS frames are notification-only triggers for a pull, never parsed as data — SYNC-02's stronger no-ciphertext-trust boundary carries over unchanged).
- **D-08 (SC #5 / EXT-04, verified gap in current server code):** `pv-server`'s CORS is currently binary — `CorsLayer::permissive()` behind `PV_DEV_CORS=1`, or no CORS layer at all otherwise (`crates/pv-server/src/routes/mod.rs`). Neither mode satisfies "CORS allowlist accepts the extension's own origin" as a real production posture: `permissive()` is far too broad to ship as the extension's answer, and "off" rejects the extension outright. Phase 9 must add an actual **allowlist** (extension origin(s), configured, not wildcard-permissive) alongside — not replacing — the existing dev-cors toggle, and this must be proven against a real request from a loaded extension build (not assumed from reading Chrome/MDN docs on background-context fetch CORS exemptions).
- **D-09 (INVARIANT, cross-cutting):** No User Key, PRF output, or plaintext item content may reach `chrome.storage.local`, a content script, or (obviously, since none exist yet in this phase) a page's MAIN-world JS. Background is the sole holder.
- **D-10 (ARCHITECTURE.md Suggested Build Order, phase sequencing):** Session core exists before sync client wiring exists before popup browse/search is meaningfully demoable — but all three ship together in this one phase per the roadmap's Success Criteria grouping; the ordering is an internal plan-sequencing concern (see PATTERNS the planner should establish), not a scope split across phases.
- **D-11 (STACK.md, already-decided at project level):** WXT + `@wxt-dev/browser` for the extension shell; `pv-wasm` reused unchanged (same `wasm-bindgen`/`getrandom` pin as web app); popup is React if Phase 8 already set up `@wxt-dev/module-react` (verify Phase 8's actual output before assuming — don't re-decide the framework choice here).

### Claude's Discretion

- **Auto-lock default idle timeout value** (5 min? 15 min? matching 1Password/Bitwarden defaults?) — EXT-03 only requires it be configurable; the default number and whether it's user-adjustable from the popup in this phase (vs. a later settings surface) is left to the planner/UI researcher.
- **Popup unlock UX details**: whether PRF is offered as a first-class parallel button next to password (like v0.1's web `UnlockOverlay.tsx`/`PasskeyUnlockButton.tsx` pattern) or presented differently in the popup's smaller real estate — reuse v0.1's visual/interaction pattern as the default assumption, but the popup's tighter viewport may call for adaptation. UI researcher's call.
- **Search UX** (instant-filter vs. debounced, fuzzy vs. substring match) — EXT-04 just requires search to work; matching v0.1 web app's existing item-list search behavior is the sensible default unless the researcher finds a strong popup-specific reason to diverge.
- **Item detail view depth in the popup** (show full item detail/reveal fields vs. minimal picker-only view) — success criteria say "browse, search, and pick any vault item"; whether "pick" implies a full detail pane or just enough to identify the item is open. Given autofill (which would consume "picked" items) is Phase 10, a minimal-but-correct detail view is a safe default.
- **Exact session-token storage location for the extension's bearer token**: v0.1 web app uses `localStorage` (already locked in v0.1 CONTEXT as an accepted, documented tradeoff, not vault-secret material). For the extension, `chrome.storage.session` is likely the better home for the bearer token too (extension-only access level, cleared with the rest of the session) rather than introducing a second storage mechanism — but this is an implementation-pattern choice for the planner, not restated as a phase-boundary invariant since the token itself is not zero-knowledge-sensitive material.
- **Whether popup and background share a single WXT entrypoint bundle for messaging types** vs. the `lib/messaging/ext-protocol.ts` typed-schema file architecture research suggests — recommended default is to follow ARCHITECTURE.md's suggested structure, but exact file layout is executor discretion.

### Deferred Ideas (OUT OF SCOPE)

- Vault item create/edit/delete from the popup (not in this phase's success criteria — natural Phase 10/11 companion once autofill's save-new-login flow exists, or a dedicated follow-on if the popup should support full CRUD independent of autofill).
- Popup settings surface beyond the auto-lock timeout control (e.g., server URL reconfiguration, account switching) — not implied by EXT-02/03/04, would be scope creep.
- Full Chrome/Firefox dual-browser parity verification and `web-ext lint` — explicitly Phase 13.
- Any content-script/page-bridge work — explicitly Phase 10 (autofill DOM detection) and Phase 12 (passkey provider MAIN-world patch).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EXT-02 | User unlocks the vault from the popup with the master password (and with a PRF passkey where the browser supports it); the unlocked User Key is held in `chrome.storage.session` (never `storage.local`) and survives service-worker idle-termination within the session | "Session Envelope Design" (Architecture Patterns §2), new pv-wasm export/import surface (Code Examples §1), ported `passkeyUnlock`/`unlockFromPassword` ceremony logic (Code Examples §4) |
| EXT-03 | The session key auto-locks — cleared after a configurable idle timeout and on browser close — so an unlocked vault never persists indefinitely | `chrome.alarms`-based auto-lock (Architecture Patterns §3, Common Pitfalls §2), storage.session browser-close-clear behavior (Pitfalls §1) |
| EXT-04 | In the popup the user can browse, search, and pick any vault item, backed by the existing `pv-server` REST API and WebSocket sync (multi-device revisions honored) | Ported `sync-client.ts` (Code Examples §5), reused `search.ts`/`filterItems` logic, CORS allowlist server change (Code Examples §6) |
</phase_requirements>

## Summary

Phase 9 has no new *product* surface to invent — every mechanism it needs already exists in v0.1 (`web/src/lib/crypto/index.ts`'s lock-state singleton, `web/src/lib/vault/sync.ts`'s WS+poll client, `web/src/lib/passkeys/login.ts`'s PRF unlock ceremony, `web/src/lib/vault/search.ts`'s filter logic) and just needs to be **relocated across a process boundary**: from a single-process Next.js page into a three-context split (popup ↔ background service worker ↔ `pv-server`). The one genuinely new piece of engineering is the **session envelope** (EXT-02/03): today's `pv-wasm` API (verified directly from `crates/pv-wasm/src/lib.rs`) has **no function that exports a `WasmUserKey`'s raw bytes, and no function that reconstructs one from raw bytes** — `WasmUserKey` only exposes `generate()`. Every existing consumer (`wrapUserKey`/`unwrapUserKey`/`encryptItem`/`decryptItem`) takes the opaque handle by reference, which is exactly the invariant v0.1 wants but is fatal for MV3: the WASM instance itself (and every handle living in its linear memory) is destroyed on service-worker idle-kill, so there is currently no way to survive that boundary at all. `pv-core::keys::UserKey` already has the two primitives needed (`expose()` and `from_bytes()`), they are simply not wired through `wasm-bindgen` yet. Phase 9 must add a small, explicitly-named, extension-only export pair to `pv-wasm` (e.g. `exportUserKeyForSession`/`importUserKeyFromSession`) that is never imported by `web/`, is documented in code as the sanctioned single exception to "raw key bytes never cross the WASM boundary," and whose only consumer is the background's `vault-session.ts`.

The second load-bearing finding is that `chrome.storage.session`'s **default `access_level` is already `TRUSTED_CONTEXTS`** (extension pages + background only — content scripts and pages cannot read it) — satisfying D-01/D-09 requires *not calling* `setAccessLevel` at all, not adding extra protection. The third is a CORS/identity coupling the v0.2 research files did not flag: Phase 8's CONTEXT.md pins Firefox's `browser_specific_settings.gecko.id` for storage-identity stability but says nothing about Chrome's extension ID, which is **randomly regenerated on every unpacked reload unless `manifest.key` is set** — without a pinned Chrome ID, D-08's CORS allowlist would need updating after every dev reload. This should be flagged to the planner as a small, cheap addition (or confirmed already done in Phase 8's actual output) before the CORS allowlist work is considered "proven."

**Primary recommendation:** Port, don't redesign — reuse the exact v0.1 sync/search/PRF-ceremony logic verbatim behind a `browser.runtime.sendMessage` proxy, add one small new `pv-wasm` export pair for the session envelope (clearly marked as the sanctioned key-export exception), use `chrome.storage.session`'s default access level unmodified, and drive auto-lock with `chrome.alarms` (never `setInterval`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Master-password / PRF unlock ceremony | Background service worker | Popup (UI only) | D-05: popup never touches WASM; background runs `deriveAuthMaterial`/`WasmWrappingKey.fromPrf`/`unwrapUserKey` exactly as `UnlockOverlay.tsx` does today, just relocated |
| Session key envelope (survive idle-kill) | Background service worker | `chrome.storage.session` (persistence) | Background owns the WASM instance and re-hydration logic; storage.session is passive key-value storage, not a code owner |
| Auto-lock timer | Background service worker | `chrome.alarms` (platform primitive) | Alarms survive SW sleep; the background's alarm listener is what actually clears the envelope |
| Vault browse/search/pick UI | Popup (React) | Background (data source) | Popup renders decrypted item list; background is where decrypt happens — popup receives plaintext-fields-for-display only after unlock, never raw ciphertext-handling logic |
| REST + WS sync client | Background service worker | pv-server (API/Backend) | Same tier as v0.1's web app sync client — background is the "browser tab" equivalent for this concern in the extension |
| CORS allowlist | API / Backend (pv-server) | — | Server-side origin check; no client-side capability, must be added in `crates/pv-server/src/routes/mod.rs` |
| Bearer session token storage | Background service worker | `chrome.storage.session` | Not vault-secret material, but lives alongside the envelope for a single storage mechanism (Discretion Area) |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `wxt` | 0.20.27 [ASSUMED — carried over from STACK.md's v0.2 research; re-verify Phase 8's actual installed version before use] | Extension framework, already scaffolded by Phase 8 | Already the project's locked decision; Phase 9 does not re-decide it |
| `@wxt-dev/browser` | 0.2.2 [ASSUMED — same carry-over] | Typed cross-browser `browser.*` API | Already scaffolded by Phase 8 per D-11 |
| `@wxt-dev/module-react` | 1.2.2 [VERIFIED: npm registry — `npm view @wxt-dev/module-react version` returned `1.2.2`, published 2026-03-14, 348k weekly downloads, `package-legitimacy check` verdict `OK`] | React support for the popup entrypoint | Only needed if Phase 8 didn't already add it for a placeholder popup; reuses the same React 19 the Next.js web app already uses, so popup component patterns (buttons, forms) can be near-identical to `UnlockOverlay.tsx`/`PasskeyUnlockButton.tsx` |
| `pv-wasm` (existing, extended) | unchanged pin (`wasm-bindgen=0.2.126`) + **new exports** | Session-key export/import pair (see Code Examples §1) | Reuses the existing choke-point crate; adds two functions, does not fork the build |
| `tower-http` (existing dependency) | `0.6` [VERIFIED: crates/pv-server/Cargo.toml, already a workspace dependency with the `cors` feature already enabled] | CORS allowlist for the extension origin(s) | Already in the dependency tree — no new crate needed, only a config change in `cors_layer()` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@webext-core/fake-browser` (bundled inside `wxt/testing`) | matches installed `wxt` version [CITED: wxt.dev/guide/essentials/unit-testing] | In-memory fake of `browser.*` APIs (including `storage.session`) for Vitest unit tests | Use for `vault-session.ts`/`sync-client.ts` unit tests instead of hand-rolling `MockWebSocket`-style fakes for `chrome.storage`/`chrome.alarms` — only the WebSocket mock (no fake-browser equivalent) still needs a hand-rolled class, following `web/src/lib/vault/sync.test.ts`'s existing `MockWebSocket` pattern |
| `vitest` + `jsdom` | already used in `web/package.json` (`vitest ^3.2.4`, `jsdom ^25.0.1`) | Test runner for `extension/` package, matching `web/`'s existing convention | Reuse the same testing stack so contributors don't context-switch between two runners |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `chrome.alarms` for auto-lock | `setInterval`/`setTimeout` in the background | Rejected outright — D-03/PITFALLS.md Pitfall 3: timers do not survive SW idle-kill, alarms do |
| New pv-wasm export pair for session envelope | Re-deriving the wrapping key from scratch on every wake (re-prompt password/PRF) | Defeats the entire "survive idle-kill without re-prompting" success criterion (SC #2); the new export pair is the only way to satisfy it without re-authenticating every ~30s |
| A hand-rolled typed-message dispatcher | A messaging library (e.g. `webext-bridge`) | Not evaluated this session — v0.1 has no precedent for a messaging library, and `browser.runtime.sendMessage` + a typed discriminated union is a well-established, dependency-free pattern; only worth reconsidering if the planner finds the hand-rolled router becoming unwieldy across Phases 10-12 |

**Installation:**
```bash
# Only if Phase 8's output did not already add the React module:
cd extension
npm i -D @wxt-dev/module-react

# No new Cargo dependency — tower-http already has the "cors" feature enabled.
# pv-wasm gets two new functions in the existing crate, not a new crate.
```

**Version verification:** `npm view @wxt-dev/module-react version` was run this session and returned `1.2.2` (published 2026-03-14, 348,585 weekly downloads) — confirmed current. `wxt`/`@wxt-dev/browser` versions are carried over from the already-completed v0.2 `STACK.md` research (dated the same day) and were NOT re-verified in this session since Phase 8 is expected to have already pinned whatever version it scaffolded with — the planner should read Phase 8's actual `extension/package.json` (once it exists) rather than assume 0.20.27/0.2.2 are still current.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `wxt` | npm | latest patch published 2026-06-23 | 785,571/wk | github.com/wxt-dev/wxt | SUS (`package-legitimacy check` flagged `too-new` — a heuristic on latest-patch age, not project age) | Approved — already the project's Phase 8 decision; downloads (785k/wk) and confirmed repo make the "too-new" signal a false positive on release cadence, not legitimacy. No new checkpoint needed since Phase 8 already installs it. |
| `@wxt-dev/browser` | npm | latest patch published 2026-07-02 | 702,102/wk | github.com/wxt-dev/wxt | SUS (same `too-new` heuristic) | Approved — same reasoning as `wxt`; official WXT monorepo package, already Phase 8's decision. |
| `@wxt-dev/module-react` | npm | published 2026-03-14 | 348,585/wk | github.com/wxt-dev/wxt | OK | Approved — this is the one package this phase may newly install (if Phase 8 didn't already). |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `wxt`, `@wxt-dev/browser` — both flagged only on a "too-new latest release" heuristic (frequent patch releases), not on download count, repo absence, or postinstall scripts (`postinstall: null` for both). Both are already Phase 8's locked stack decision (STACK.md, D-11), not a new install this phase introduces — no new `checkpoint:human-verify` is warranted for a dependency this phase does not newly add. If Phase 8's actual installed versions differ from the ones checked here, the planner should re-run `package-legitimacy check` against whatever Phase 8 actually pinned.

*`wxt` and `@wxt-dev/browser` version strings above were carried over from the v0.2-milestone `STACK.md` research (dated 2026-07-14, same research session, WebSearch/npm-registry sourced) — tag `[ASSUMED]` until Phase 8's actual `extension/package.json` is read at plan/execute time.*

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────┐         ┌──────────────────────────────────────────┐
│ Popup UI (React, WXT)        │         │ Background service worker (WXT)          │
│                              │ runtime.│                                          │
│ UnlockView ─────────────────►│sendMsg  │ router.ts (typed dispatch)                │
│  - password form             │────────►│   ├─► unlock.password  ──┐               │
│  - "Unlock with passkey" CTA │         │   ├─► unlock.prf        │               │
│                              │◄────────│   ├─► vault.list/search  ├─► vault-session.ts
│ ItemListView (search+filter) │ response│   ├─► vault.getItem      │   - storage.session
│  - reuses filterItems/       │         │   └─► session.lock       │     read/write
│    searchItems logic         │         │                          │   - alarms listener
│                              │         │  ┌───────────────────────┘   (auto-lock)
│ ItemDetailView (minimal)     │         │  │
└─────────────────────────────┘         │  ▼
                                          │ pv-wasm (background-only)
                                          │  - deriveAuthMaterial / WasmWrappingKey.fromPrf
                                          │  - unwrapUserKey / decryptItem
                                          │  - NEW: exportUserKeyForSession/
                                          │         importUserKeyFromSession
                                          │
                                          │ sync-client.ts (ported from web/src/lib/vault/sync.ts)
                                          │  - WS /api/sync/ws (notification-only)
                                          │  - 30s poll fallback + backoff
                                          └──────────────┬───────────────────────────┘
                                                         │ HTTPS/WSS (Authorization: Bearer …)
                                                         ▼
                                          ┌──────────────────────────────────────────┐
                                          │ pv-server (axum, unchanged routes)        │
                                          │  cors_layer(): NEW allowlist branch       │
                                          │   accepts chrome-extension://<id> /       │
                                          │   moz-extension://<id> in addition to     │
                                          │   the existing PV_DEV_CORS permissive     │
                                          │   toggle                                 │
                                          └──────────────────────────────────────────┘
```

A reader can trace EXT-02 (unlock) by following Popup → `runtime.sendMessage({kind:'unlock.password'|'unlock.prf'})` → `router.ts` → `vault-session.ts` (derives/unwraps via pv-wasm, then calls the NEW `exportUserKeyForSession` to persist the envelope) → response back to popup. EXT-04 (browse/search/sync) is traced by `sync-client.ts`'s WS/poll loop independently pushing snapshots into the background's in-memory item store, which the popup pulls via `vault.list`/`vault.search` messages — the popup never talks to `pv-server` directly.

### Recommended Project Structure

```
extension/                              # already scaffolded by Phase 8
├── entrypoints/
│   ├── background/
│   │   ├── index.ts                    # SW entry, registers router + alarm listener
│   │   ├── wasm-loader.ts              # from Phase 8 — fetch()+instantiate, unchanged
│   │   ├── vault-session.ts            # NEW this phase — envelope lifecycle
│   │   ├── sync-client.ts              # NEW this phase — ported from web/src/lib/vault/sync.ts
│   │   ├── vault-store.ts              # NEW this phase — in-memory decrypted item cache, background-only
│   │   └── router.ts                   # NEW this phase — runtime.onMessage typed dispatch table
│   └── popup/
│       ├── main.tsx                    # React root (via @wxt-dev/module-react)
│       ├── App.tsx                     # routes: unlock | browse/search | detail
│       ├── UnlockView.tsx              # password form + PasskeyUnlockButton-equivalent
│       ├── ItemListView.tsx            # search bar + filtered list (reuses searchItems/filterItems)
│       └── ItemDetailView.tsx          # minimal picker-only detail pane
├── lib/
│   ├── messaging/
│   │   └── ext-protocol.ts             # NEW — typed request/response message union
│   └── vault/
│       └── search.ts                   # ported verbatim from web/src/lib/vault/search.ts (no network, pure function — safe to copy as-is)
└── package.json
```

### Structure Rationale

Directory layout mirrors ARCHITECTURE.md's already-researched recommended structure (Suggested Build Order step 2), adapted to only the files Phase 9 actually needs (no `content-relay`/`page-bridge`/`provider-ceremony` files yet — those are Phases 10-12). `vault-store.ts` is a new addition not explicitly named in ARCHITECTURE.md: since the popup never decrypts (D-05), *something* in the background needs to hold the decrypted-in-memory item list for browse/search to be instant (matching v0.1's `search.ts`'s "no network call per keystroke" property) — this is a background-only cache, rebuilt from `sync-client.ts`'s snapshots, and MUST be cleared alongside the session envelope on lock/auto-lock (an easy-to-miss detail: locking the vault but leaving `vault-store.ts`'s decrypted cache populated would silently violate D-09).

### Pattern 1: Session envelope survives SW idle-kill via a new pv-wasm export pair

**What:** `pv-core::keys::UserKey` already has `expose() -> &[u8; 32]` and `from_bytes([u8; 32]) -> Self` (verified directly in `crates/pv-core/src/keys.rs:34,38`), but neither is wired through `wasm-bindgen` — `WasmUserKey` (`crates/pv-wasm/src/lib.rs:103-112`) exposes only `generate()`. Add two new wasm-bindgen exports, clearly named and commented as the sanctioned exception:

```rust
// crates/pv-wasm/src/lib.rs — NEW, extension-only exports.
// SANCTIONED EXCEPTION (see module doc + CONTEXT.md D-02): the MV3 service
// worker's WASM instance is destroyed on idle-kill, so the extension MUST
// be able to serialize a WasmUserKey's raw bytes into chrome.storage.session
// and reconstruct it on wake. This is the ONLY place raw User Key bytes
// cross the WASM boundary in the whole codebase — web/ never calls these.
#[wasm_bindgen(js_name = exportUserKeyForSession)]
pub fn export_user_key_for_session(uk: &WasmUserKey) -> Vec<u8> {
    uk.0.expose().to_vec()
}

#[wasm_bindgen(js_name = importUserKeyFromSession)]
pub fn import_user_key_from_session(bytes: &mut [u8]) -> Result<WasmUserKey, JsValue> {
    if bytes.len() != KEY_LEN {
        return Err(to_js_str_err("expected 32 bytes"));
    }
    let mut arr = [0u8; KEY_LEN];
    arr.copy_from_slice(bytes);
    bytes.zeroize(); // wipe the JS-side view via wasm-bindgen's copy-back, same pattern as from_password
    Ok(WasmUserKey(UserKey::from_bytes(arr)))
}
```

On the JS side (`vault-session.ts`), the returned `Vec<u8>` is base64-encoded and written to `chrome.storage.session` alongside a `lockedAt`/`unlockedAt` timestamp; on wake, it's base64-decoded, passed to `importUserKeyFromSession`, and the byte buffer zeroized immediately after (mirroring `deriveAuthMaterial`'s `passwordBytes.fill(0)` discipline in `web/src/lib/crypto/index.ts`).

**When to use:** Only inside `extension/entrypoints/background/vault-session.ts` — never in the popup, never in `web/`.

**Trade-offs:** +Satisfies EXT-02's idle-kill-survival requirement without re-prompting the user. −Introduces the one deliberate crack in the "opaque handle only" invariant; must be grep-auditable (a `grep -r exportUserKeyForSession extension/` should only ever match `vault-session.ts`) and documented exactly as CONTEXT.md's D-02 anticipates.

### Pattern 2: `chrome.storage.session` default access level already satisfies D-01/D-09

**What:** [VERIFIED via WebSearch, Chrome official docs cross-checked] `chrome.storage.session`'s default `access_level` is `TRUSTED_CONTEXTS` — readable only from the background service worker and other extension pages (popup, options), NOT from content scripts or web pages. Content scripts only gain access if `chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'})` is explicitly called.

**When to use:** Simply never call `setAccessLevel` anywhere in this codebase. This is a "do nothing" requirement, not a "do something" one — worth stating explicitly in the plan so a future contributor doesn't add it "to let the content script read the session" once Phase 10 exists.

**Trade-off:** None — this is the free, correct default.

### Pattern 3: Auto-lock via `chrome.alarms`, re-armed on every SW wake

**What:** [VERIFIED via WebSearch, Chrome official docs] `chrome.alarms` fires even after the service worker was idle-killed and has been woken back up — unlike `setTimeout`/`setInterval`, which are lost entirely. Minimum alarm period is 30 seconds (Chrome 120+). Alarm persistence across a full *browser* restart (not just SW restart) is not guaranteed pre-Chrome-150, so the background's startup/`onInstalled` handler should defensively re-create the alarm if the session envelope indicates the vault is still unlocked (it usually won't be, since `storage.session` itself clears on browser restart — but the alarm and the envelope are two independent platform primitives and must not be assumed to always agree).

```typescript
// vault-session.ts (background)
const ALARM_NAME = "pv-auto-lock";

async function armAutoLock(idleMinutes: number): Promise<void> {
  await browser.alarms.create(ALARM_NAME, { delayInMinutes: idleMinutes });
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    void lockVaultSession(); // clears storage.session envelope + vault-store.ts cache
  }
});

// Re-arm on every unlock AND on every message that counts as "activity"
// (mirrors v0.1's idle-timer reset pattern, just alarm-based instead of
// setTimeout-based) — re-creating an alarm with the same name replaces the
// previous one (Chrome's documented behavior), so no manual clear is needed
// before re-arming.
```

**When to use:** The single auto-lock timer for EXT-03. Do not use `setInterval` even as a supplementary "keep warm" heartbeat — PITFALLS.md's Technical Debt table explicitly flags this as "never as the primary strategy."

**Trade-off:** +Survives SW sleep/wake. −30s minimum granularity (irrelevant here since idle timeouts are realistically minutes, not seconds) and no *guaranteed* survival across a full browser restart — mitigated because `storage.session` itself already clears on browser restart (D-04), so the two mechanisms cover complementary failure modes (idle-while-running vs. browser-closed).

### Pattern 4: Typed message protocol, ported PRF/password ceremony logic behind it

**What:** `lib/messaging/ext-protocol.ts` defines a discriminated union (`{kind: 'unlock.password', payload: {...}} | {kind: 'unlock.prf'} | {kind: 'vault.search', payload: {query, filter}} | {kind: 'session.lock'} | ...`). The background's `router.ts` dispatches on `msg.kind`. The unlock ceremony logic itself (`deriveAuthMaterial` → `unwrapUserKey`, and `WasmWrappingKey.fromPrf` → `unwrapUserKey` for PRF) is ported near-verbatim from `web/src/lib/passkeys/login.ts`'s `passkeyUnlock()` and `UnlockOverlay.tsx`'s `unlockFromPassword()` — the *only* structural change is that `navigator.credentials.get()` must still be called from a context with DOM/WebAuthn access. **Verify at plan time**: MV3 service workers have no `navigator.credentials` access — the WebAuthn ceremony for PRF unlock must run in the popup (which has a normal DOM/window context) and only the resulting PRF bytes / assertion get message-passed to the background for the `WasmWrappingKey.fromPrf`/`unwrapUserKey` calls, OR the background opens/uses an offscreen document. This is a genuine platform detail this research could not fully resolve without hands-on verification in Phase 8's actual scaffold — flagged in Open Questions below.

**When to use:** All popup↔background communication.

**Trade-off:** +Single typed contract avoids ad-hoc `if (msg.type === ...)` sprawl as Phases 10-12 add more message kinds (per ARCHITECTURE.md's own scaling note). −One extra message round-trip vs. a direct function call, acceptable since unlock/search are already inherently async.

### Anti-Patterns to Avoid

- **Calling `chrome.storage.session.setAccessLevel(TRUSTED_AND_UNTRUSTED_CONTEXTS)` "to make content scripts work later":** Not needed this phase (no content scripts exist yet — Phase 10+), and doing it now would silently widen the trust boundary years before it's needed, directly undermining D-01/D-09.
- **Holding the unlocked `WasmUserKey` handle only as a background JS module-level variable, "re-deriving from storage.session only as a fallback":** Backwards from the correct design — the SW's in-memory handle IS the fallback (a same-wake-cycle fast path), `storage.session` is the source of truth every message handler must be prepared to re-hydrate from, per D-01.
- **Reusing `web/src/lib/auth/session.ts`'s `localStorage` pattern unchanged for the extension's bearer token:** `localStorage` is not available in a service worker context at all (it's a `window`/DOM API) — this would fail outright, not just be a style mismatch. Must use `chrome.storage.session` (or `.local`, though `.session` is preferred per the Discretion Area reasoning) instead.
- **Running `navigator.credentials.get()` for PRF inside the background service worker:** Service workers have no `navigator.credentials`/WebAuthn API access at all — this ceremony must run in a DOM context (popup, or a Phase-8-provided offscreen document if one exists). See Pattern 4's flagged Open Question.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WS reconnect backoff + poll fallback | A new sync algorithm for the extension | Port `web/src/lib/vault/sync.ts` almost verbatim (same `POLL_INTERVAL_MS`/`BACKOFF_START_MS`/`BACKOFF_MAX_MS` constants, same "WS frames are notification-only, never parsed" invariant) | Already correctly handles the proxy-drops-Upgrade-headers case (05-CONTEXT.md's locked decision) and the stale-socket-late-close race (`intentionalStop` guard) — re-deriving this from scratch risks reintroducing bugs v0.1 already fixed |
| PRF/password unlock ceremony orchestration | A new ceremony for the extension | Port `web/src/lib/passkeys/login.ts`'s `passkeyUnlock()` + `UnlockOverlay.tsx`'s `unlockFromPassword()` logic, including the `stripPrfFromCredentialJson`/`extractPrfBytes` zero-knowledge defense-in-depth | These functions encode subtle zero-knowledge boundary decisions (PRF bytes never logged, stripped from the JSON sent to the server) that took a full v0.1 phase to get right |
| Item search/filter | A new fuzzy-search implementation for the popup | Port `web/src/lib/vault/search.ts`'s `searchItems`/`filterItems` verbatim — it is a pure function with zero DOM/network dependencies, trivially portable | CONTEXT.md's Discretion Area explicitly recommends matching existing behavior unless there's a strong popup-specific reason to diverge; there isn't one yet |
| Auto-lock scheduling | A custom timer/heartbeat scheme | `chrome.alarms` | D-03, PITFALLS.md Pitfall 3 — this is a platform-mandated choice, not a library preference |
| CORS origin matching | Manual header inspection in a custom axum middleware | `tower_http::cors::CorsLayer::new().allow_origin(...)` (already a dependency) | Already in the dependency tree with the `cors` feature enabled; hand-rolling origin-header comparison risks subtle bypass bugs (case-sensitivity, scheme confusion) that `tower-http` already handles correctly |

**Key insight:** This phase is almost entirely a *relocation* exercise, not a *design* exercise — the risk is in accidentally changing behavior while porting (e.g., an off-by-one in backoff jitter, or forgetting the `stripPrfFromCredentialJson` defense-in-depth), not in inventing new mechanisms. The one true novel mechanism (the pv-wasm session-export pair) should be kept as small and boring as possible.

## Common Pitfalls

### Pitfall 1: Assuming `pv-wasm` already supports exporting key material — it does not

**What goes wrong:** A planner reads CONTEXT.md's D-02 ("the envelope necessarily holds exportable key material") and assumes this is just a matter of calling some existing serialization method on `WasmUserKey`. It isn't — `WasmUserKey` currently has exactly one method, `generate()`. Attempting to `JSON.stringify` a wasm-bindgen class instance, or looking for a `.toBytes()` method that doesn't exist, will fail silently or throw confusingly.

**Why it happens:** The v0.2 research files (ARCHITECTURE.md Pattern 2) describe the *need* for exportable key material at a design level but do not identify that this requires a new, unwritten `pv-wasm` export — that gap was only found by reading `crates/pv-wasm/src/lib.rs` directly in this research session.

**How to avoid:** Budget explicit plan tasks for adding `exportUserKeyForSession`/`importUserKeyFromSession` to `pv-wasm` (Rust change + `wasm-pack`/`build-wasm.sh` rebuild) before any TypeScript session-envelope code is written against them.

**Warning signs:** TypeScript code calling a method on `WasmUserKey` that doesn't type-check against the actual generated `.d.ts`.

### Pitfall 2: Chrome's extension ID is unstable across unpacked dev reloads, silently breaking the CORS allowlist

**What goes wrong:** D-08 requires an allowlist of `chrome-extension://<id>` origins. Without a fixed `manifest.key` [CITED: developer.chrome.com/docs/extensions/reference/manifest/key], Chrome generates a new random ID every time an unpacked extension is loaded/reloaded during development — so the server's allowlist works once, then silently starts rejecting requests again after the next `wxt dev` reload, looking like an intermittent CORS bug rather than an identity-instability one.

**Why it happens:** Phase 8's CONTEXT.md pins Firefox's `browser_specific_settings.gecko.id` (D-09 of that phase) for exactly this reason but does not mention Chrome's equivalent `manifest.key` pin — this looks like an oversight carried from the v0.2 research files, which also don't call it out.

**How to avoid:** Verify whether Phase 8 already pinned a `manifest.key` in `wxt.config.ts`'s Chrome manifest config; if not, this phase should add it (cheap, one config value) before the CORS allowlist work is considered "proven end-to-end" per SC #5's wording.

**Warning signs:** CORS allowlist test passes once, then starts failing after a routine `wxt dev` restart with no code change.

### Pitfall 3: Verifying idle-kill survival immediately after unlock instead of after a real 60+ second idle period

**What goes wrong:** A plan's verification step tests "unlock, then immediately reload the popup" — which never actually exercises the SW idle-kill path at all (30s+ of true inactivity is required), so the test can pass even if the session-envelope re-hydration logic is broken.

**Why it happens:** PITFALLS.md's own "Looks Done But Isn't" checklist calls this out generically; ROADMAP SC #2 explicitly requires "leaving the browser idle 60+ seconds and retrying" as the verification method.

**How to avoid:** The plan's verification/UAT step for EXT-02/SC#2 must include an explicit real-idle-wait (Chrome DevTools' service-worker "stop" button, or an actual 60+s wait), matching Phase 8's own D-10 methodology (packaged build, real termination, not simulated).

**Warning signs:** A UAT checklist item that doesn't mention a specific wait duration or explicit SW-stop action.

### Pitfall 4: Locking the vault but leaving the background's decrypted item cache (`vault-store.ts`) populated

**What goes wrong:** EXT-03's auto-lock clears the session envelope (the wrapped/exported key material) but a naive implementation might leave the already-decrypted item list (used for instant popup search) sitting in a background-module-level variable — meaning a "locked" vault still has plaintext item data resident in memory, reachable by any subsequent message handler that doesn't re-check lock state.

**Why it happens:** The session envelope and the decrypted-item cache are two separate pieces of state that must be cleared together but live in different files (`vault-session.ts` vs. `vault-store.ts`); it's easy to wire the alarm listener to only the former.

**How to avoid:** The auto-lock/`session.lock` handler must clear both the envelope AND the decrypted cache in one atomic function, analogous to `web/src/lib/crypto/index.ts`'s `lockVault()` which frees the WASM handle — except here it must also drop the plaintext item array.

**Warning signs:** Popup search still returns results immediately after a "Lock now" action, before the popup would have had time to re-request data post-unlock.

## Code Examples

### 1. pv-wasm session-export pair (new, extension-only)

See Architecture Patterns §1 above for the full Rust snippet — this is the canonical reference implementation shape; exact error-handling style should match the existing `to_js_err`/`to_js_str_err` conventions already in `crates/pv-wasm/src/lib.rs`.

### 2. Session envelope read/write shape (TypeScript, background)

```typescript
// vault-session.ts
interface SessionEnvelope {
  userKeyB64: string;      // base64(exportUserKeyForSession(uk)) — SANCTIONED exception, see D-02
  sessionToken: string;    // bearer token, not vault-secret, stored alongside for one storage mechanism
  unlockedAtMs: number;
  idleTimeoutMinutes: number;
}

const STORAGE_KEY = "pv-session-envelope";

async function readEnvelope(): Promise<SessionEnvelope | null> {
  const result = await browser.storage.session.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as SessionEnvelope | undefined) ?? null;
}

async function writeEnvelope(envelope: SessionEnvelope): Promise<void> {
  await browser.storage.session.set({ [STORAGE_KEY]: envelope });
}

async function clearEnvelope(): Promise<void> {
  await browser.storage.session.remove(STORAGE_KEY);
}
```

### 3. `chrome.alarms` auto-lock

See Architecture Patterns §3 above.

### 4. Ported unlock ceremony (background-side, illustrative shape)

```typescript
// router.ts (background) — password branch, structurally identical to
// UnlockOverlay.tsx's unlockFromPassword() but returns a message response
// instead of calling setUnlockedUserKey() directly in a React component.
async function handleUnlockPassword(passwordBytes: Uint8Array): Promise<UnlockResult> {
  await initCrypto(); // wasm-loader.ts, from Phase 8
  const account = await me(); // ported from web/src/lib/auth/api.ts
  const { kdf, salt } = await prelogin(account.email);
  const material = deriveAuthMaterial(passwordBytes, base64Decode(salt), JSON.stringify(kdf));
  const wrappingKey = material.takeWrappingKey();
  try {
    const uk = unwrapUserKey(wrappingKey, account.pw_wrapped_uk);
    const rawBytes = exportUserKeyForSession(uk); // NEW export, see Pattern 1
    await writeEnvelope({
      userKeyB64: base64Encode(rawBytes),
      sessionToken: getSessionToken()!,
      unlockedAtMs: Date.now(),
      idleTimeoutMinutes: DEFAULT_IDLE_MINUTES,
    });
    await armAutoLock(DEFAULT_IDLE_MINUTES);
    uk.free?.();
    return { ok: true };
  } finally {
    wrappingKey.free?.();
    material.free?.();
  }
}
```

### 5. Sync client port (structural diff from `web/src/lib/vault/sync.ts`)

The only required change when porting `sync.ts` into `extension/entrypoints/background/sync-client.ts` is the token source (`getSessionToken()` must read from the envelope in `storage.session`, async, instead of `localStorage`, sync) — every other constant/function (`wsUrl`, `connectWs`, `startSync`/`stopSync`, the `intentionalStop` stale-socket guard, the jittered backoff) should be ported unchanged. Because `getSessionToken()` becomes async in the extension (storage.session reads are Promise-based, unlike `localStorage.getItem`), `connectWs()`'s signature must change from synchronous to `async`, which is a small but real port cost callers must account for — the WS-open/onmessage/onclose handler wiring itself is unaffected.

### 6. `pv-server` CORS allowlist addition

```rust
// crates/pv-server/src/routes/mod.rs — additive, alongside the existing
// PV_DEV_CORS permissive toggle (do not remove it).
use tower_http::cors::AllowOrigin;

fn cors_layer() -> CorsLayer {
    let dev_cors_enabled = std::env::var("PV_DEV_CORS")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);

    if dev_cors_enabled {
        return CorsLayer::permissive();
    }

    // NEW: extension-origin allowlist, e.g. PV_EXTENSION_ORIGINS=
    // "chrome-extension://abcd…,moz-extension://def…" (comma-separated).
    let extension_origins: Vec<_> = std::env::var("PV_EXTENSION_ORIGINS")
        .unwrap_or_default()
        .split(',')
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.trim().parse().ok())
        .collect();

    if extension_origins.is_empty() {
        CorsLayer::new() // unchanged existing behavior when unset
    } else {
        CorsLayer::new().allow_origin(AllowOrigin::list(extension_origins))
    }
}
```

**Verify at plan time:** exact env var naming/shape is Claude's discretion (not locked by CONTEXT.md); `AllowOrigin::list` vs. `AllowOrigin::predicate` (the latter needed only if the Chrome extension ID is NOT pinned via `manifest.key` — see Pitfall 2) should be decided once Phase 8's actual manifest configuration is known.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| MV2 persistent background page holding unlocked key in a plain JS variable indefinitely | MV3 event-driven service worker + `chrome.storage.session` + `chrome.alarms` | Chrome's MV3 migration (ongoing since ~2021, mandatory for new Web Store listings since 2023) | This project targets MV3 from day one (Phase 8), so there is no "migration" to plan — but the pattern is genuinely different from how v0.1's web app (a normal long-lived page) holds its unlocked key, which is why this phase cannot just copy `web/src/lib/crypto/index.ts`'s module-level singleton unchanged |
| `webextension-polyfill` for cross-browser `browser.*` typing | `@wxt-dev/browser` | WXT's own stated replacement, already the project's decision | No action needed — this is inherited from Phase 8/D-11, not a new finding |

**Deprecated/outdated:** None specific to this phase beyond the above — Phase 9 is not introducing any technology old enough to have a documented predecessor pattern of its own yet.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `wxt` is still at `0.20.27` and `@wxt-dev/browser` at `0.2.2` by the time Phase 9 executes | Standard Stack | Low — these are carried over from the already-completed v0.2 STACK.md research (same day) and Phase 8 is expected to have pinned exact versions in its own lockfile; the planner should read Phase 8's actual `extension/package.json`/`package-lock.json` rather than trust this number |
| A2 | Phase 8 already added `@wxt-dev/module-react` for a placeholder popup, OR left it framework-free per its own Discretion Area | Standard Stack, Package Legitimacy Audit | Low-Medium — if Phase 8 chose no framework, this phase must add `@wxt-dev/module-react` as a genuinely new dependency (already legitimacy-checked above, so low risk, just needs the `npm i` step budgeted) |
| A3 | MV3 background service workers cannot call `navigator.credentials.get()` directly, so the PRF ceremony must run in the popup (or an offscreen document) with only the resulting bytes message-passed to background | Architecture Patterns §4 | Medium — if wrong, the plan would architect the PRF flow in the wrong context and need rework; this is exactly the kind of platform-boundary detail that should be spiked/confirmed against Phase 8's actual scaffold (or a 10-minute manual check in a real service worker console) before committing plan tasks to a specific popup-vs-offscreen split |
| A4 | Chrome's extension ID is not yet pinned via `manifest.key` in Phase 8's `wxt.config.ts` | Common Pitfalls §2 | Medium — if Phase 8 actually already pinned it (undocumented in 08-CONTEXT.md, which only mentions Firefox's `gecko.id`), this phase's CORS work is simpler than assumed; if not pinned, the CORS allowlist will appear broken after every dev reload until this is fixed |
| A5 | `chrome.storage.session`'s default `access_level` (`TRUSTED_CONTEXTS`) is unchanged in current Chrome/Firefox releases | Architecture Patterns §2 | Low — this is a stable, long-documented platform default; would only be wrong if a very recent platform change altered it, which was not surfaced in this session's WebSearch results |

## Open Questions

1. **Where does the WebAuthn PRF ceremony (`navigator.credentials.get()`) actually execute in this extension's architecture?**
   - What we know: MV3 service workers have no DOM, and therefore (per general WebExtension platform knowledge) no `navigator.credentials`. The popup DOES have a normal window/DOM context and can call it, mirroring exactly how `UnlockOverlay.tsx`/`passkeyUnlock()` already do it in the web app.
   - What's unclear: whether the ceremony should run directly in the popup component (simplest, but ties the ceremony's lifetime to the popup staying open, which WebAuthn ceremonies already require anyway since they need a user gesture) vs. Phase 8 having already established an offscreen-document pattern for something else that this phase should reuse.
   - Recommendation: Default to running the PRF `navigator.credentials.get()` call in the popup (same context as v0.1), with only the resulting `assertion`'s extracted PRF bytes and stripped-credential-JSON message-passed to the background for `WasmWrappingKey.fromPrf`/`unwrapUserKey`/`exportUserKeyForSession`. This keeps D-05's "no crypto in popup" intact (the popup only extracts already-public PRF bytes from the browser API response and forwards them — it never calls a crypto/decrypt function itself) while respecting the DOM-API constraint. Confirm this against Phase 8's actual background/popup split once that phase's SUMMARY exists.

2. **Exact default auto-lock idle-timeout value and whether it's user-configurable from the popup in this phase.**
   - What we know: CONTEXT.md explicitly defers this to planner/UI-researcher discretion; EXT-03 only requires "configurable."
   - What's unclear: the specific number and UI surface.
   - Recommendation: Default to 15 minutes (a middle-ground figure between the aggressive end of the design-space and typical competitor defaults, per SUMMARY.md's Bitwarden/1Password comparison framing) with a simple popup settings toggle; this is a UX/product call properly routed to the UI researcher or a taste-check with Bartek per the project's standing `discuss-question-level` policy, not something this research should lock further.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js / npm | `extension/` build tooling (WXT) | ✓ (used throughout this session's `npm view` calls) | not explicitly queried this session | — |
| `wxt` CLI (`npx wxt`) | Extension dev/build | Not verified this session — Phase 8 is expected to have already run `wxt init` | — | If Phase 8's scaffold is missing/incomplete, Phase 9 cannot proceed until Phase 8 completes (explicit Depends-on in ROADMAP) |
| Chrome + Firefox (manual load-unpacked / `wxt dev -b firefox`) | Manual UAT of unlock/idle-kill/CORS per CONTEXT.md's "lightweight both-browsers check" | Assumed available on the developer's machine (self-hosted/local dev project) — not verified in this research session | — | — |
| A running `pv-server` instance (local or Docker) | CORS allowlist end-to-end verification (SC #5 explicitly requires a real request, not a doc-read assumption) | Assumed available via existing `cargo run -p pv-server` / Docker Compose from v0.1 — not started/verified this session | — | — |

**Missing dependencies with no fallback:**
- Phase 8's completed `extension/` scaffold (WXT project, background WASM loading, CSP config) — this is a hard `Depends on: Phase 8` per ROADMAP and cannot be substituted.

**Missing dependencies with fallback:**
- None beyond the above hard dependency — everything else (Node/npm, browsers, `pv-server`) is standard local dev tooling already used throughout v0.1.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (`^3.2.4`, matching `web/package.json`) + `jsdom` for popup component tests |
| Config file | none yet in `extension/` — Wave 0 gap (see below); mirror `web/`'s existing `vitest` config pattern |
| Quick run command | `npm test` (once `extension/package.json` defines a `test` script analogous to `web/`'s `"test": "vitest run"`) |
| Full suite command | same — this project has no separate "quick vs. full" split in `web/`, so extension tests should follow the same single-tier convention |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXT-02 | Password unlock derives/unwraps the User Key and populates the session envelope | unit | `vitest run vault-session.test.ts` | ❌ Wave 0 |
| EXT-02 | PRF unlock path (mocked `navigator.credentials.get()`) produces the same envelope shape as password unlock | unit | `vitest run vault-session.test.ts` | ❌ Wave 0 |
| EXT-02 | Envelope round-trips through export/import (`exportUserKeyForSession`/`importUserKeyFromSession`) without data loss | unit (Rust, in `pv-wasm`) | `cargo test -p pv-wasm` | ❌ Wave 0 — new test alongside existing `full_roundtrip`/`from_prf_roundtrip` tests in `crates/pv-wasm/src/lib.rs` |
| EXT-03 | Auto-lock alarm firing clears both the envelope and the decrypted item cache | unit | `vitest run vault-session.test.ts` | ❌ Wave 0 |
| EXT-03 | Idle-kill survival (SC #2's real 60+s wait) | manual-only (justification: requires real browser service-worker termination, not mockable in Vitest per Phase 8's own D-10 methodology) | — | n/a |
| EXT-04 | `sync-client.ts` reconnect/backoff/stale-socket-guard behavior ported correctly | unit | `vitest run sync-client.test.ts` | ❌ Wave 0 — port `web/src/lib/vault/sync.test.ts`'s `MockWebSocket` pattern |
| EXT-04 | Popup search/filter over a decrypted item list | unit | `vitest run search.test.ts` (ported) | ❌ Wave 0 — copy `web/src/lib/vault/search.test.ts` fixtures |
| EXT-04 | Cross-client sync visibility (edit on web app appears in extension popup) | manual/integration (justification: requires two real running clients against one `pv-server` instance, same as v0.1's Phase 5 two-tab proof) | — | n/a |
| SC #5 (CORS) | Extension origin allowlist accepts real cross-origin request, rejects an arbitrary other origin | integration (Rust) | `cargo test -p pv-server cors` (new test) | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `vitest run <changed-test-file>` / `cargo test -p pv-wasm` or `-p pv-server` as relevant
- **Per wave merge:** full `npm test` (extension) + `cargo test` (workspace)
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus the two manual-only items (idle-kill wait, cross-client sync) explicitly checked per CONTEXT.md's lightweight Chrome+Firefox pass

### Wave 0 Gaps
- [ ] `extension/vitest.config.ts` (or equivalent) — no test framework config exists yet in the not-yet-created `extension/` package
- [ ] `extension/entrypoints/background/vault-session.test.ts` — covers EXT-02/EXT-03
- [ ] `extension/entrypoints/background/sync-client.test.ts` — covers EXT-04 (port `web/src/lib/vault/sync.test.ts`)
- [ ] `extension/lib/vault/search.test.ts` — covers EXT-04 (port `web/src/lib/vault/search.test.ts`)
- [ ] New `#[test]` functions in `crates/pv-wasm/src/lib.rs` for `export_user_key_for_session`/`import_user_key_from_session` round-trip, alongside the existing `full_roundtrip`/`from_prf_roundtrip` tests
- [ ] New CORS test in `crates/pv-server` (currently `cors_layer()` has no dedicated test per the read source file — verify before assuming one exists)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reused v0.1 password/PRF authentication ceremony (Argon2id, WebAuthn PRF) — no new auth mechanism this phase, only a new execution context for the existing one |
| V3 Session Management | yes | `chrome.storage.session` (extension-only access level) for both the vault-unlock envelope and the bearer session token; `chrome.alarms`-driven auto-lock as the session-timeout control |
| V4 Access Control | no (not directly) | No new authorization boundary introduced this phase — CORS is an origin check, not an authorization check |
| V5 Input Validation | yes | `runtime.onMessage` payloads from the popup must be validated against the typed `ext-protocol.ts` schema before dispatch (popup is same-trust as background here, but defensive validation is still good practice, especially since Phase 10+ will add a genuinely untrusted content-script/page boundary that reuses the same router) |
| V6 Cryptography | yes | Unchanged v0.1 primitives (Argon2id/XChaCha20-Poly1305/HKDF-SHA256) via the existing `pv-wasm` choke-point — never hand-rolled; the one new surface (`exportUserKeyForSession`) is a serialization boundary, not a new crypto primitive |
| V9 Communications | yes | HTTPS/WSS to `pv-server`, unchanged from v0.1; CORS allowlist is the new communications-boundary control this phase adds |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Overly-permissive CORS allowlist (predicate matching any `chrome-extension://*` origin instead of the specific extension's own ID) | Spoofing | Prefer `AllowOrigin::list` with exact origin(s) over a broad predicate wherever the extension ID can be pinned (see Pitfall 2); only fall back to a predicate if ID pinning genuinely isn't feasible, and if so, scope the predicate as narrowly as possible (e.g., a fixed known ID list read from config, not a wildcard scheme match) |
| Session envelope readable by a compromised content script | Information Disclosure | `chrome.storage.session`'s default `TRUSTED_CONTEXTS` access level (Pattern 2) — verified this phase introduces no content scripts yet, so the actual current exposure is zero, but the "never call setAccessLevel" anti-pattern must hold as a standing rule into Phase 10+ |
| Stale/replayed WS frames influencing client state | Tampering | Already mitigated by v0.1's design: WS frames are notification-only and never parsed (D-07) — carried over unchanged into `sync-client.ts` |
| Exported User Key bytes lingering in a JS variable after being written to storage.session | Information Disclosure | Zeroize the JS-side `Uint8Array`/byte buffer immediately after `writeEnvelope()`/after `importUserKeyFromSession()`, mirroring `deriveAuthMaterial`'s `passwordBytes.fill(0)` discipline — this is a manual discipline point since JS has no automatic `Zeroize` derive the way Rust does |
| Auto-lock alarm silently failing to fire (e.g., after a Chrome update resets scheduled alarms) | Denial of Service (of the *security* control, not the app) | Defensive re-arm of the alarm on every background startup/`onInstalled` AND on every unlock (Pattern 3) — never assume a single `armAutoLock()` call is sufficient for the vault's entire unlocked lifetime |

## Sources

### Primary (HIGH confidence)
- `crates/pv-wasm/src/lib.rs` — direct source read, confirms `WasmUserKey`/`WasmWrappingKey` currently expose zero raw-byte export/import surface
- `crates/pv-core/src/keys.rs` — direct source read, confirms `UserKey::expose()`/`UserKey::from_bytes()` already exist un-exposed to wasm-bindgen
- `crates/pv-server/src/routes/mod.rs` — direct source read, confirms current binary CORS posture (`permissive()` vs. no layer)
- `crates/pv-server/Cargo.toml` — direct source read, confirms `tower-http = "0.6"` with `cors` feature already enabled
- `web/src/lib/vault/sync.ts`, `web/src/lib/passkeys/login.ts`, `web/src/components/auth/UnlockOverlay.tsx`, `web/src/lib/crypto/index.ts`, `web/src/lib/vault/search.ts`, `web/src/lib/auth/api.ts`, `web/src/lib/vault/api.ts` — direct source reads of the exact v0.1 logic this phase ports
- `.planning/phases/09-.../09-CONTEXT.md`, `.planning/phases/08-.../08-CONTEXT.md`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md` — direct reads of locked scope/decisions
- `npm view @wxt-dev/module-react version` — direct registry query this session, `1.2.2` confirmed current

### Secondary (MEDIUM confidence)
- [chrome.storage | API | Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/storage) — `access_level`/`TRUSTED_CONTEXTS` default, via WebSearch
- [The extension service worker lifecycle | Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle) — idle-kill timing, via WebSearch (also already cited in the completed v0.2 PITFALLS.md/STACK.md)
- [chrome.alarms | API | Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/alarms) — alarm survival semantics, minimum period, via WebSearch
- [Manifest - key | Chrome Extensions | Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/manifest/key) — `manifest.key` stable-ID mechanism, via WebSearch, cross-checked against a Plasmo blog post independently describing the same mechanism
- [Unit Testing – WXT](https://wxt.dev/guide/essentials/unit-testing) — `wxt/testing`/`fake-browser` pattern, via WebSearch
- `.planning/research/{SUMMARY,ARCHITECTURE,STACK,PITFALLS}.md` — the already-completed v0.2 milestone research, treated as ground truth for anything already decided at that level (WXT/passkey-rs/CSP/pattern choices)

### Tertiary (LOW confidence)
- `tower_http::cors::AllowOrigin`/`CorsLayer::allow_origin` exact API shape — via WebSearch only (no Context7/docs.rs direct fetch available this session); the planner should double check the exact method signatures against `docs.rs/tower-http/0.6.x` at implementation time since this was not directly verified against the pinned `0.6` version's actual docs
- `browser.runtime.sendMessage`/`onMessage` typed-messaging conventions — general WebSearch results, no single authoritative "this is the pattern" source found this session; treated as reasonable industry-standard practice, not a verified project-specific decision

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM — core WXT/browser package versions carried over unverified from same-day v0.2 research (Phase 8 not yet executed to confirm actuals); the one newly-verified package (`@wxt-dev/module-react`) is HIGH
- Architecture: HIGH for the pv-wasm export-pair finding and the storage.session default-access-level finding (both source/doc verified directly); MEDIUM for the PRF-ceremony-execution-context question (Open Question #1, genuinely unresolved pending Phase 8's actual output)
- Pitfalls: MEDIUM-HIGH — Pitfall 1 and 4 are HIGH (source-code-grounded); Pitfall 2 (Chrome ID pinning) is MEDIUM (a real, doc-confirmed platform behavior, but its actual relevance depends on unverified Phase 8 output); Pitfall 3 is directly inherited from the already-completed PITFALLS.md (HIGH)

**Research date:** 2026-07-14
**Valid until:** 14 days for the MV3-platform-specific claims (fast-moving/no MCP-tool cross-verification this session); 30 days for the source-code-grounded pv-wasm/pv-server findings (stable unless the codebase itself changes)
