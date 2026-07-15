# Phase 10: Autofill — Login, TOTP, Card & Identity - Research

**Researched:** 2026-07-14
**Domain:** MV3 browser-extension content-script autofill (ISOLATED-world DOM field detection + fill) talking to a background service worker over a typed message contract; zero-knowledge preserved (background is sole decrypt boundary)
**Confidence:** MEDIUM-HIGH (grounded in the project's own already-completed v0.2 curated research — ARCHITECTURE/PITFALLS/STACK/FEATURES.md — plus live npm-registry verification and targeted web verification this session; MV3 content-script/sender-verification specifics are MEDIUM since no hands-on experiment has run in this repo yet — Phase 8/9 haven't been executed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01: No MAIN-world code in this phase.** Autofill is implemented entirely in an ISOLATED-world content script (`content-relay`) that owns DOM field-detection and fill, talking to the background service worker over `browser.runtime.sendMessage`/`Port`. (ARCHITECTURE.md: MAIN-world is reserved for the passkey-provider patch in Phase 12; autofill needs no page-context override.)
- **D-02: Background is the sole decrypt/crypto boundary.** The content-relay never imports `pv-wasm` or touches key material; it sends `{kind: 'autofill.match', origin}`-style requests and receives only the minimal plaintext fill values needed for the matched item(s) — never the whole vault. (INVARIANT: zero-knowledge / no key material outside background; ARCHITECTURE.md Anti-Pattern 1.)
- **D-03: Every fill requires an explicit user gesture.** No autofill on page load, no silent fill. (ROADMAP SC #5; PITFALLS.md Pitfall 7 mitigation; REQUIREMENTS.md "Out of Scope" — auto-submit is the sibling anti-feature already forbidden.)
- **D-04: Cross-origin iframe fills are refused by default.** Top-level-page credentials/card/identity data must never fill into a cross-origin iframe; a subframe only gets fills if its own origin independently matches a stored item. This must be verified against a deliberately constructed adversarial iframe test page before the phase is considered done. (ROADMAP SC #5 — explicit acceptance criterion; PITFALLS.md Pitfall 7, citing the real historical Bitwarden CVE-class bug and Mozilla Bugzilla #786276.)
- **D-05: `autocomplete`-attribute-first, score-thresholded field detection for card/identity.** Prioritize standardized `autocomplete` values (`cc-number`, `cc-exp`, `cc-csc`, `given-name`, `family-name`, `street-address`, etc.) as the primary signal; fall back to name/id/label-text pattern matching only when `autocomplete` is absent; require a minimum confidence score before showing any fill affordance. Never fill card/identity data without an explicit click (higher stakes than login). (PITFALLS.md Pitfall 6 — this is the documented mitigation for the "false positive / erodes trust" failure mode, not a discretionary choice.)
- **D-06: Login fields use the well-established `type="password"`/`autocomplete="username|current-password"` signal**, not heuristic scoring — login detection is lower-risk and standardized (per FEATURES.md, login autofill complexity is MEDIUM vs. card/identity's MEDIUM-HIGH specifically because of this).
- **D-07: Multi-account picker when more than one saved login matches the current origin** — explicit ROADMAP SC #1 requirement, not a nice-to-have.
- **D-08: TOTP fill reuses the existing RFC 6238 code generator from pv-core/WASM (v0.1 Phase 6)** — no new TOTP math is written in this phase; the extension only reads the live code from background and fills/copies it. (PROJECT.md validated requirement; CLAUDE.md "reuse pv-core, do not reimplement crypto.")
- **D-09: Message protocol lives in a typed contract layer** (e.g. `lib/messaging/`), distinct message kinds for page↔content (not used this phase) vs. content↔background (used this phase) — avoids ad-hoc `if (msg.type === ...)` sprawl as later phases (11, 12) add more message kinds to the same channel. (ARCHITECTURE.md's explicit scaling-risk callout.)
- **D-10: Content-relay must recompute frame/origin context on every fill request** — never trust a cached assumption that a frame's origin equals the top-level page's origin, since content scripts run per-frame including nested iframes. (PITFALLS.md Pitfall 7's root cause.)
- **D-11: Depends on Phase 9's session core** — Phase 10 assumes an unlocked `chrome.storage.session` key already exists; it does not implement unlock, lock, or auto-lock timeout itself (that's Phase 9 / EXT-02/03). If Phase 9 isn't complete when Phase 10 plans, the plan must treat "vault unlocked" as a precondition/fixture, not something this phase builds.
- **D-12: No autofill of card/identity data without an explicit click, ever** (stricter than login) — explicitly separate from D-03 because PITFALLS.md calls out card/identity as needing an even higher confirmation bar than login/password fill.

### Claude's Discretion

- Exact visual affordance for "a fillable field was detected" (icon-in-field overlay vs. browser-native-looking dropdown vs. extension-popup-driven picker) — FEATURES.md flags icon-in-field polish as v0.2.x, so Phase 10's MVP affordance can be minimal (e.g., trigger fill from the popup's item list rather than an in-page overlay) as long as D-03/D-12 (gesture-gated) hold. UI-hint is set on this phase in ROADMAP, so a UI-researcher pass is expected to resolve this.
- Whether the multi-account picker (D-07) renders in-page (overlay) or in the popup.
- Exact score thresholds/weights for the card/identity detection heuristic (D-05) — PITFALLS.md prescribes the *approach* (autocomplete-first, scored, thresholded) but not exact numeric weights; executor may tune based on a curated set of real-world test forms.
- Whether TOTP "fill" writes into the field directly or falls back to clipboard-copy-with-toast when no OTP-shaped field is detected (ROADMAP SC #2 explicitly allows either: "fills or copies").
- Internal message-kind naming/shape within the `lib/messaging/` contract layer (D-09) — implementation detail, not a product decision.
- How the content-relay decides "current origin" for MutationObserver-driven SPA re-detection (debounce/throttle strategy) — PITFALLS.md's technical-debt table flags naive whole-document MutationObservers as a performance anti-pattern; the specific debounce approach is an executor call.

### Deferred Ideas (OUT OF SCOPE)

- Icon-in-field indicator polish (v0.2.x, FEATURES.md).
- Right-click context-menu quick actions (v0.2.x, FEATURES.md).
- Cross-origin iframe card-field autofill *parity* with 1Password (v1+, explicitly out of v0.2 per REQUIREMENTS.md "Future Requirements").
- Password-change detection and save/update prompts — these are Phase 11 (CAP-02/03), not Phase 10, but share the same content-relay DOM instrumentation this phase builds; Phase 11's planner should reuse Phase 10's form-detection plumbing rather than rebuilding it.
- Conditional-mediation-aware autofill (`signal.mediation === 'conditional'`) — mentioned in FEATURES.md as an alternative to icon+click for future refinement, not required for Phase 10's gesture-gating bar.
- Passkey provider (`navigator.credentials` MAIN-world patch) — Phase 12, no MAIN-world work exists in Phase 10 at all (D-01).
- Generated-password suggestion, save-new-login prompt, password-change detection — Phase 11 (CAP-01/02/03).
- Session unlock, popup shell, REST/WS sync client — Phase 9 (hard dependency, treated as precondition fixture per D-11).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FILL-01 | The extension detects login forms and offers to fill the saved username + password for the current origin | `type="password"`/`autocomplete="username\|current-password"` deterministic detection (D-06); origin-match query against background (Pattern 1); multi-account picker (D-07, Pattern 4) |
| FILL-02 | The extension fills (or copies) the live TOTP code into a 2FA field for the current origin | Reuse `totpNow()` WASM export unchanged (D-08, Code Examples §TOTP); OTP-field heuristic (`autocomplete="one-time-code"`, `inputmode="numeric"`, short maxlength); clipboard-copy fallback discretion |
| FILL-03 | The extension fills credit-card fields (number, expiry, CVV, cardholder) from a saved card item | `autocomplete`-first scored heuristic (D-05, Pattern 2); explicit-click gate (D-12); Pitfall 6 mitigation |
| FILL-04 | The extension fills identity fields (name, address, email, phone — Tożsamości) from a saved identity item | Same scored heuristic engine as FILL-03, different `autocomplete` token set (`given-name`/`family-name`/`street-address`/`tel`/`email`) |

All four requirements share one content-relay + one background `autofill.match`/`autofill.fill` message pair (Pattern 1) and one frame/origin verification gate (Pattern 3, D-04/D-10) — they are variations in *what* gets matched and filled, not in the underlying plumbing.
</phase_requirements>

## Summary

Phase 10 is a pure **read-and-fill** feature built entirely inside the ISOLATED-world content script this project calls `content-relay` — no MAIN-world code exists in this phase (D-01), which means the highest-risk architectural piece (the page-observable execution context) is simply not in play yet. The mechanics are: a user gesture (click) triggers the content-relay to ask the background service worker "what fills the field(s) near this click, for this exact frame's origin?"; the background is the only place `pv-wasm` is imported and the only place the unlocked User Key (already living in `chrome.storage.session` per Phase 9) is touched; it returns the minimal plaintext needed for a single matched item, never the whole vault. The content-relay then writes that value into the DOM using native input-value-setting + a synthetic `input`/`change` event (so frameworks like React observe the change) and never re-exposes it to the page beyond that native DOM write.

Two field-detection tiers apply: login fields (username/password) use the well-established, standardized `type="password"` + `autocomplete="username|current-password"` signal — deterministic, no scoring needed (D-06). Card and identity fields have no equivalently strong single signal, so this phase implements a **scored, `autocomplete`-first heuristic** (D-05): accumulate confidence from `autocomplete` token matches first, fall back to name/id/label-text substring matching only when `autocomplete` is absent, and require a score threshold before ever showing a fill affordance — this is the documented, converged-upon mitigation for the false-positive problem that has bitten every competitor in this space (PITFALLS.md Pitfall 6). TOTP fill is the cheapest of the four: it reuses `totpNow()` (already shipped, unmodified, in `pv-wasm`) — the extension's job is purely to detect an OTP-shaped input (`autocomplete="one-time-code"`, `inputmode="numeric"`, short `maxlength`) and either fill it or fall back to clipboard-copy.

The one piece of this phase with genuine security consequence is the same-origin/top-frame verification gate (D-04/D-10), because unlike the WebAuthn ceremony (Phase 12) which gets RP-ID/origin binding enforced by the browser itself, **autofill has no platform-enforced origin protection** — this project must implement it manually, exactly the way real historical CVE-class bugs (Bitwarden's cross-origin-iframe autofill leak; Mozilla Bugzilla #786276) got fixed industry-wide. The content-relay must independently recompute `document.location.origin` (never cache it) and use `window.self !== window.top` to detect subframes; the background must independently re-derive the sender's frame/tab identity from `runtime.onMessage`'s `sender` object (never trust a payload-declared origin string, since any page script can spoof a `postMessage`/message payload). Given D-01 means there's no page-originated postMessage hop in this phase at all (content-relay talks directly to background via `runtime.sendMessage`), the spoofing surface is narrower than Phase 12's will be — but the frame-vs-origin confusion (a legitimate content-script instance running inside an attacker's iframe) is still fully in scope and is exactly what the adversarial-iframe UAT (ROADMAP SC #5) is designed to catch.

**Primary recommendation:** Build one typed message contract (`lib/messaging/ext-protocol.ts`, using `@webext-core/messaging`'s `defineExtensionMessaging<ProtocolMap>()` rather than hand-rolling `if (msg.kind === ...)` dispatch) carrying exactly two request shapes — `autofill.match` (read-only: "what item(s) match this frame's origin/field-set?") and `autofill.fill` (the click-gated request that returns plaintext for one selected item) — and implement field detection as two independent scorers (deterministic login/TOTP, scored card/identity) inside the single content-relay entrypoint, gated by the frame/origin check on every request.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DOM field detection (login/TOTP/card/identity) | Browser / Client (ISOLATED content script) | — | Only the content script has DOM access; must never touch key material (D-02), so it's pure detection + fill, no decrypt logic |
| Field-detection scoring/thresholding | Browser / Client (content-relay) | — | Runs against DOM structure the content script already has; background never sees raw DOM, only an origin + a minimal field-shape descriptor if needed for matching context |
| Origin/frame verification (D-04/D-10) | Browser / Client (content-relay, first check) | Background (second, authoritative check via `sender`) | Defense in depth — content-relay's own `window.self !== window.top`/`location.origin` check is a UX-speed first gate; background's independent `sender.tab`/`sender.frameId` re-derivation is the actual security boundary, since content-relay code itself is not fully trusted (it runs adjacent to a hostile page) |
| Item matching by origin | API / Backend-equivalent (Background service worker) | — | Background already holds the decrypted-in-WASM vault items (via Phase 9's session); matching-by-origin is a query over that in-memory set, not something content-relay can do without seeing plaintext |
| Decrypt / plaintext fill-value production | Background service worker only | — | Zero-knowledge invariant: only background imports `pv-wasm`; single choke point (ARCHITECTURE.md Anti-Pattern 1) |
| TOTP live-code generation | Background service worker (via `pv-wasm.totpNow`) | — | Same choke-point rule; content-relay never computes TOTP itself, only requests-and-fills the returned code |
| Multi-account picker UI (D-07) | Browser / Client (content-relay in-page) OR Popup UI | — (executor/UI-researcher choice) | Either tier is architecturally valid since both already talk to background over the same message contract; a pure UX call, not a security-tier call |
| Message contract / typed protocol layer | Browser / Client + Background (shared `lib/messaging/`) | — | Both ends import the same `ProtocolMap` type; this is intentionally a shared-but-not-privileged layer — it carries only opaque request/response shapes, no key material |
| Persistent unlocked-key storage | Background service worker / `chrome.storage.session` | — | Owned entirely by Phase 9; Phase 10 only *reads* the fact that a session exists (via a background-internal check), never touches `storage.session` directly from content-relay |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| WXT | 0.20.27 [VERIFIED: npm registry] | Extension framework already scaffolded by Phase 8; Phase 10 adds a new `content-relay` content-script entrypoint to the existing project, no new framework decision | Already the project's locked decision (STACK.md); confirmed still current via `npm view wxt version` this session |
| `@wxt-dev/browser` | 0.2.2 [VERIFIED: npm registry] | Typed cross-browser `browser.*` API — same package Phase 8/9 already depend on | Reused unchanged; avoids `chrome.*`/`browser.*` branching in content-relay code |
| `pv-wasm` (existing, unchanged) | pinned per v0.1 (`wasm-bindgen=0.2.126`) | `totpNow()` export is the entire TOTP mechanism this phase needs; no other `pv-wasm` exports are called directly by content-relay — only by background | D-08; already shipped, zero new crypto work |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@webext-core/messaging` | 3.0.2 [VERIFIED: npm registry — published 2026-06-01, 73,477 weekly downloads] | Typed `defineExtensionMessaging<ProtocolMap>()` wrapper providing `sendMessage`/`onMessage` across content-relay ↔ background | Satisfies D-09's "typed contract layer" requirement directly; authored by WXT's own maintainer (`aklinker1`) and is WXT's own documented recommendation (wxt.dev/guide/essentials/messaging) over hand-rolled `runtime.sendMessage`/`onMessage` dispatch — use for every content↔background message this phase introduces (`autofill.match`, `autofill.fill`) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@webext-core/messaging` | Hand-rolled `browser.runtime.onMessage.addListener` + a manual `switch(msg.kind)` | Zero new dependency, but reproduces exactly the "ad-hoc message-shape drift" scaling risk ARCHITECTURE.md explicitly warns about as more message kinds accumulate across Phases 10-12; not recommended given D-09 already names a typed-contract-layer requirement |
| `@webext-core/messaging` | `webext-bridge` (6.0.1, [VERIFIED: npm registry], OK legitimacy verdict, 7,640 weekly downloads) | A legitimate, popular alternative with a similar API surface; `@webext-core/messaging` is preferred here specifically because it's maintained by WXT's own author and is the project the WXT docs point to, giving tighter alignment with the already-adopted framework |
| Hand-rolled `autocomplete`-first scored field detection (locked in D-05) | `fathom-web` (Mozilla's own DOM-scoring DSL, used inside Firefox itself for its native card/address autofill) | See **Package Legitimacy Audit** below — `fathom-web`'s last npm publish was 2021 and it carries a `[SUS]` legitimacy verdict (low weekly downloads) despite being a legitimate, still-`git`-hosted Mozilla project (`github.com/mozilla/fathom`). CONTEXT.md's D-05 already locks in a simpler hand-rolled scored heuristic (autocomplete-first, threshold-gated) rather than adopting a general-purpose scoring DSL — for four field categories (login/TOTP/card/identity) with a known, small `autocomplete` token vocabulary, a ~100-150 line hand-rolled scorer is proportionate and avoids pulling in an under-maintained third-party dependency. **Recommendation: do not add `fathom-web` to this phase's dependencies; keep D-05's hand-rolled scorer.** |

**Installation:**
```bash
cd extension
npm install @webext-core/messaging@3.0.2
```

**Version verification:** Confirmed live via `npm view <pkg> version` / `npm view <pkg> time.modified` on 2026-07-14 (this session):
- `wxt@0.20.27` — last published 2026-06-23
- `@wxt-dev/browser@0.2.2` — current
- `@webext-core/messaging@3.0.2` — last published 2026-06-01, 73,477 weekly downloads
- `webext-bridge@6.0.1` — last published 2024-02-20, 7,640 weekly downloads (alternative, not recommended — see above)
- `fathom-web@3.7.3` (latest tag) — but the flagged legitimacy check resolved a stale `2021-03-10` publish record with only 139 weekly downloads; **not recommended for this phase**, see audit below.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@webext-core/messaging` | npm | last publish 2026-06-01 (actively maintained) | 73,477/wk | `github.com/aklinker1/webext-core` | OK | Approved |
| `webext-bridge` | npm | last publish 2024-02-20 | 7,640/wk | `github.com/zikaari/webext-bridge` | OK | Not adopted (alternative only — see rationale above) |
| `fathom-web` | npm | last publish 2021-03-10 (stale, 5 yrs) | 139/wk | `github.com/mozilla/fathom` | **SUS** (low-downloads signal) | **REMOVED from Standard Stack recommendation** — legitimate Mozilla project but stale/low-adoption on npm specifically; D-05's locked hand-rolled heuristic is the recommended path instead |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `fathom-web` — flagged for low downloads/staleness, not for illegitimacy (it is Mozilla's real, still-git-hosted project). Since it is **not being adopted** into this phase's dependency list (D-05 already locks in the simpler alternative), no `checkpoint:human-verify` gate is needed — the planner should simply not add this package. If a future phase (e.g., a v0.2.x polish pass) reconsiders adopting it, that plan must add a `checkpoint:human-verify` task before `npm install fathom-web`.

*No new package in this phase's actual recommended dependency list (`@webext-core/messaging`) requires a `checkpoint:human-verify` gate — its legitimacy signals are clean (OK verdict, current maintenance, high adoption, official-WXT-author provenance).*

## Architecture Patterns

### System Architecture Diagram

```
User clicks a detected field's affordance (gesture — D-03/D-12)
        │
        ▼
┌─────────────────────────────────────────────────────────────────┐
│ content-relay.content.ts  (ISOLATED world, per-frame instance)   │
│                                                                   │
│  1. Field scanner (MutationObserver, debounced) tags candidate   │
│     inputs: login (type=password/autocomplete) | TOTP (autocomplete│
│     =one-time-code/inputmode=numeric) | card/identity (scored)   │
│  2. On click: recompute frame context FRESH (D-10) —             │
│     origin = document.location.origin (never cached)             │
│     isTopFrame = (window.self === window.top)                    │
│  3. sendMessage('autofill.match', {origin, isTopFrame, kind})    │
└───────────────────────────┬───────────────────────────────────────┘
                             │ @webext-core/messaging (typed, runtime.sendMessage under the hood)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ background/router.ts  (MV3 service worker)                       │
│                                                                   │
│  4. Independently re-derive sender identity from                 │
│     runtime.onMessage's own `sender` object                      │
│     (sender.tab.id / sender.frameId) — NEVER trust payload origin│
│  5. If isTopFrame === false AND origin !== top-frame's origin:   │
│     only match items whose stored origin === the SUBFRAME's own  │
│     origin (D-04) — top-level credentials never leak in          │
│  6. Query already-decrypted-in-WASM session vault items          │
│     (Phase 9's session) filtered by origin match                 │
│  7. Return ONLY the matched item(s)' minimal metadata             │
│     (name, masked username) for 'autofill.match'                 │
└───────────────────────────┬───────────────────────────────────────┘
                             │ (multi-match → picker UI, D-07)
                             ▼
              User confirms which item (if >1 match)
                             │
                             ▼ sendMessage('autofill.fill', {itemId})
┌─────────────────────────────────────────────────────────────────┐
│ background: re-verify origin/frame AGAIN (never trust the first  │
│ check alone — this is a second request, re-check sender)         │
│  8. Decrypt the ONE matched item in pv-wasm (background-only)     │
│  9. For TOTP: call pv-wasm.totpNow(secret, algo, digits, period,  │
│     Date.now()/1000) — live code, computed fresh, never cached   │
│  10. Return ONLY the fillable field values for this ONE item     │
└───────────────────────────┬───────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│ content-relay: writes values into DOM via native value setter +  │
│ synthetic input/change events (so React/Vue-controlled inputs    │
│ observe the change) — values never re-enter extension messaging  │
│ after this point                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
extension/
├── entrypoints/
│   ├── content-relay.content.ts   # NEW this phase — ISOLATED world, matches: ["<all_urls>"], allFrames: true
│   └── background/
│       ├── router.ts              # extended (not replaced) — adds autofill.match/autofill.fill handlers
│       └── autofill-match.ts       # NEW — origin-matching + item-decrypt orchestration, background-only
├── lib/
│   ├── messaging/
│   │   └── ext-protocol.ts        # NEW — ProtocolMap for @webext-core/messaging (D-09); autofill.* message kinds added here
│   └── autofill/
│       ├── detect-login.ts        # NEW — deterministic type=password/autocomplete scanner (D-06)
│       ├── detect-totp.ts         # NEW — autocomplete=one-time-code / inputmode=numeric scanner
│       ├── detect-scored.ts       # NEW — shared scored heuristic engine for card + identity (D-05)
│       ├── field-tokens.ts        # NEW — autocomplete token tables (cc-number/cc-exp/cc-csc/given-name/etc.)
│       └── fill-dom.ts            # NEW — native value-setter + synthetic event dispatch, shared by all 4 fill kinds
└── package.json                   # adds @webext-core/messaging@3.0.2
```

### Structure Rationale

- **One content-script entrypoint, four detectors, one fill-writer.** All four requirements (FILL-01..04) share the same click-gate → message → decrypt → fill round-trip; only the *matching logic* differs (deterministic vs. scored). Splitting detectors into separate files (`detect-login.ts`, `detect-totp.ts`, `detect-scored.ts`) keeps the login/TOTP path's simplicity from being polluted by the card/identity scorer's added complexity, while still sharing `fill-dom.ts`'s native-value-setter logic (React-controlled-input compatibility is identical regardless of field type).
- **`lib/messaging/ext-protocol.ts` is additive, not a new file tree.** Phase 9 likely already created a `lib/messaging/` directory for its own unlock/browse/sync messages (per ARCHITECTURE.md's recommended structure); Phase 10's plan should extend that existing `ProtocolMap`, not create a parallel one — verify Phase 9's actual output before assuming the file doesn't exist yet.
- **`autofill-match.ts` stays background-only and separate from `router.ts`'s dispatch table**, mirroring the existing project convention of small, focused modules (CLAUDE.md: "small focused functions... larger functions break into helpers") — `router.ts` should stay a thin dispatch table, not accumulate business logic.

### Pattern 1: Two-phase match-then-fill request (never fill on the first request)

**What:** `autofill.match` is a cheap, read-only query returning only *metadata* (item name, masked username — enough to render a picker) for items whose stored origin matches the current frame. `autofill.fill` is the second, explicitly-user-confirmed request (after either auto-selecting the sole match, or the user picking one from a multi-match list) that actually returns plaintext fill values for exactly one item.

**When to use:** Every fill kind (login/TOTP/card/identity) — this two-phase split is what makes D-07's multi-account picker possible without ever sending more than one item's plaintext to the content-relay at a time.

**Trade-offs:** +Minimizes plaintext exposure window (only one item's data ever crosses into content-relay memory); +naturally supports the picker. −Two round-trips instead of one adds a small latency cost, acceptable given this is already an inherently async, user-gesture-gated operation.

**Example (message shapes, via `@webext-core/messaging`'s `ProtocolMap`):**
```typescript
// lib/messaging/ext-protocol.ts
export interface ExtProtocolMap {
  'autofill.match'(data: {
    origin: string;       // recomputed fresh by content-relay, never cached
    isTopFrame: boolean;  // window.self === window.top, recomputed fresh
    kind: 'login' | 'totp' | 'card' | 'identity';
  }): Array<{ itemId: string; label: string; maskedHint: string }>;

  'autofill.fill'(data: { itemId: string; kind: 'login' | 'totp' | 'card' | 'identity' }):
    | { type: 'login'; username: string; password: string }
    | { type: 'totp'; code: string; secondsRemaining: number }
    | { type: 'card'; number: string; expiry: string; cvv: string; cardholderName: string }
    | { type: 'identity'; firstName: string; lastName: string; email: string; phone: string; address: string };
}

// content-relay.content.ts
import { defineExtensionMessaging } from '@webext-core/messaging';
const { sendMessage } = defineExtensionMessaging<ExtProtocolMap>();

async function onFieldClicked(kind: 'login' | 'totp' | 'card' | 'identity') {
  const origin = document.location.origin;               // D-10: recomputed fresh, never cached
  const isTopFrame = window.self === window.top;          // safe cross-origin comparison
  const matches = await sendMessage('autofill.match', { origin, isTopFrame, kind });
  const chosen = matches.length === 1 ? matches[0] : await showPicker(matches); // D-07
  if (!chosen) return;
  const result = await sendMessage('autofill.fill', { itemId: chosen.itemId, kind });
  fillDom(result); // fill-dom.ts — native setter + synthetic events
}
```

### Pattern 2: `autocomplete`-first scored detection for card/identity (D-05)

**What:** Score every candidate `<input>` by checking, in priority order: (1) exact `autocomplete` token match against a known table (`cc-number`→+10, `cc-exp`→+10, `given-name`→+8, etc.); (2) `name`/`id` substring match against a smaller weighted keyword list only when `autocomplete` is absent or unrecognized (+3 to +5 depending on specificity); (3) nearby `<label>`/`aria-label` text match (+2, weakest signal). Sum scores per field, require a minimum threshold (executor-tuned, discretion area) before the field is considered fillable at all.

**When to use:** Card (FILL-03) and identity (FILL-04) only — login (FILL-06 signal) and TOTP have strong-enough single signals to skip scoring entirely (Pattern 3 below covers those).

**Trade-offs:** +Handles the huge real-world variance in how sites mark up payment/identity forms (PITFALLS.md Pitfall 6: many sites don't use `autocomplete="cc-number"` correctly, or hide fields for PCI reasons); +threshold gate directly prevents the false-positive failure mode that erodes user trust. −Requires a curated set of real checkout/identity forms to tune weights against (not just a synthetic test fixture) — budget UAT time for this, not just unit tests against a fixture page.

**Example:**
```typescript
// lib/autofill/field-tokens.ts
export const CARD_AUTOCOMPLETE_TOKENS: Record<string, number> = {
  'cc-number': 10, 'cc-exp': 10, 'cc-exp-month': 9, 'cc-exp-year': 9,
  'cc-csc': 10, 'cc-name': 8, 'cc-type': 5,
};
export const IDENTITY_AUTOCOMPLETE_TOKENS: Record<string, number> = {
  'given-name': 8, 'family-name': 8, 'name': 5, 'email': 9, 'tel': 8,
  'street-address': 8, 'address-line1': 8, 'postal-code': 6, 'country': 5,
};

// lib/autofill/detect-scored.ts
function scoreField(input: HTMLInputElement, tokens: Record<string, number>): number {
  const autocomplete = input.autocomplete?.toLowerCase().trim() ?? '';
  if (tokens[autocomplete]) return tokens[autocomplete];
  // fall back to name/id substring match only when autocomplete is absent/unrecognized
  const haystack = `${input.name} ${input.id}`.toLowerCase();
  let score = 0;
  for (const [token, weight] of Object.entries(tokens)) {
    const bareToken = token.replace(/^cc-|^street-|^given-|^family-/, '');
    if (haystack.includes(bareToken)) score = Math.max(score, Math.floor(weight * 0.5));
  }
  return score;
}
const FILL_THRESHOLD = 6; // executor-tunable per Discretion Areas
```

### Pattern 3: Deterministic login/TOTP detection (D-06)

**What:** Login fields are found via `input[type="password"]` combined with `autocomplete="current-password"`/`"new-password"`/`"username"` on sibling inputs — no scoring, this is a standardized, near-universal signal. TOTP fields are found via `autocomplete="one-time-code"` first, falling back to `input[inputmode="numeric"]` with a short `maxlength` (4-8) near text like "code"/"verification"/"2FA" only as a secondary signal (still much stronger than card/identity's ambiguity, but the fallback exists because not every site implements `autocomplete="one-time-code"` yet).

**When to use:** FILL-01, FILL-02 — always prefer this deterministic path over Pattern 2's scoring; only fall back to scoring for card/identity where no equivalent standardized single-attribute signal exists.

**Trade-offs:** +Extremely low false-positive rate; +cheap to compute (no scoring loop needed). −TOTP's fallback path re-introduces some heuristic risk, mitigated by requiring the OTP field to still be gesture-clicked, not auto-filled.

### Pattern 4: Frame/origin verification gate re-computed on every message (D-04/D-10)

**What:** Both `autofill.match` and `autofill.fill` handlers in `background/autofill-match.ts` independently re-derive frame identity from the `runtime.onMessage` `sender` object (`sender.tab.id`, `sender.frameId`, and — where available — `sender.origin`/`sender.url`) rather than trusting the payload's self-reported `origin`/`isTopFrame` fields. If the sender's frame is a subframe (`sender.frameId !== 0`) and its own origin differs from the tab's top-level-frame origin, the background must restrict matching to items whose stored origin equals the **subframe's own** origin only — never the top-level page's origin (D-04's core rule).

**When to use:** Every single `autofill.*` message, both phases (match and fill) — do not check once and cache the result across the two-request round-trip; each message is independently verified.

**Trade-offs:** +This is the actual security boundary (payload fields are attacker-influenceable if the content-relay itself is ever compromised or confused; `sender` metadata is populated by the browser itself and cannot be forged by page/content-script code). −Slightly more background-side bookkeeping per request; negligible cost given autofill is already infrequent/user-gated.

**Example:**
```typescript
// background/autofill-match.ts
onMessage('autofill.match', async ({ data, sender }) => {
  // NEVER trust data.origin/data.isTopFrame alone — cross-check against sender
  const tab = await browser.tabs.get(sender.tabId);
  const isSubframe = sender.frameId !== 0; // 0 == top frame, per Chrome/Firefox convention
  const effectiveOrigin = data.origin; // still read from payload (content-relay's own DOM read is authoritative for the *frame's own* origin — sender doesn't expose it directly), but the isSubframe fact comes from `sender`, not from the payload's self-reported isTopFrame
  if (isSubframe) {
    // D-04: only match items whose stored origin equals THIS frame's own origin —
    // never fall back to matching the top-level tab's URL/origin for a subframe.
    return matchItemsByOrigin(effectiveOrigin, { allowTopLevelFallback: false });
  }
  return matchItemsByOrigin(effectiveOrigin, { allowTopLevelFallback: false }); // top frame: origin IS the effective origin already
});
```

### Anti-Patterns to Avoid

- **Caching the frame's origin at content-script injection time and reusing it for later fill requests:** SPA navigation (History API pushState) doesn't reload the content script, so a cached origin can go stale relative to the actual current page state; recompute `document.location.origin` fresh on every gesture (D-10).
- **Trusting `sender.tab.url` alone without checking `sender.frameId`:** `sender.tab.url` is typically the top-level tab's URL even when the message came from a subframe — using it without also checking `frameId !== 0` is exactly how a naive implementation reintroduces the cross-origin-iframe leak (Pitfall 7) despite "checking the origin."
- **Running the field-detection MutationObserver unscoped on `document.body` with no debounce:** PITFALLS.md's Performance Traps table flags this explicitly — scope the observer to form-relevant subtrees and debounce (discretion area, but do not skip debouncing entirely).
- **Auto-selecting the single match and filling without any click when only one item matches:** D-03/D-12 require an explicit gesture regardless of match count — "there's only one candidate" is not an exception to the gesture-gate; the *initial* click that triggers `autofill.match` already satisfies the gesture requirement, but that same click (or an immediately-following confirm for card/identity per D-12's stricter bar) must be what triggers `autofill.fill`, not a bare page-load or focus event.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Content-script ↔ background typed messaging | Ad-hoc `if (msg.kind === 'autofill.match')` dispatch chains | `@webext-core/messaging`'s `defineExtensionMessaging<ProtocolMap>()` | D-09 explicitly calls for a typed contract layer; this is WXT's own documented recommendation and avoids the message-shape-drift scaling risk ARCHITECTURE.md names for Phases 10-12 accumulating message kinds on one channel |
| TOTP code generation | A JS RFC 6238 implementation, or re-deriving it from scratch in the extension | `pv_wasm.totpNow(secret, algorithm, digits, period, unixTimeSeconds)` — already shipped, RFC-6238-verified against known-answer test vectors in `crates/pv-core/src/totp.rs` | D-08; CLAUDE.md "reuse pv-core, do not reimplement crypto" — this project already has a tested, WASM-compiled TOTP generator; writing a second one in JS would be a second, divergent implementation of the exact anti-pattern REQUIREMENTS.md's "Out of Scope" table forbids |
| Cross-browser `chrome.*`/`browser.*` API differences | Manual `typeof browser !== 'undefined' ? browser : chrome` branching in content-relay | `@wxt-dev/browser` (already a project dependency since Phase 8) | Already the established pattern; content-relay should import the same typed `browser` object every other extension context uses |
| React/Vue-controlled-input-compatible DOM value writes | A one-off `input.value = x` per field type | A single shared `fill-dom.ts` helper using the native `HTMLInputElement.prototype` value setter (via `Object.getOwnPropertyDescriptor`) + dispatching synthetic `input`/`change` events | Setting `.value` directly on a React-controlled input does not trigger React's internal change detection (a well-known React quirk) — using the native setter descriptor and dispatching a real `Event('input', {bubbles:true})` is the standard workaround; writing this once in `fill-dom.ts` avoids four near-duplicate, subtly-buggy copies (one per fill kind) |

**Key insight:** Every "don't hand-roll" item in this phase is about *reuse of what the project or its immediate ecosystem already has* (pv-wasm's TOTP, WXT's own messaging recommendation, WXT's own browser-API polyfill) rather than about pulling in unfamiliar third-party dependencies — the one candidate third-party dependency this domain suggests (`fathom-web`) was deliberately evaluated and rejected (see Package Legitimacy Audit) in favor of the project's own already-locked, simpler hand-rolled scorer, which is proportionate to a four-category, small-vocabulary detection problem.

## Common Pitfalls

### Pitfall 1: Form-detection false positives on card/identity fields (PITFALLS.md Pitfall 6)

**What goes wrong:** Loose heuristics propose filling a checkout form's unrelated numeric field (e.g., a "quantity" input superficially resembling a CVV field), or the fill affordance visually breaks a site's custom-styled form.
**Why it happens:** Card/identity forms have far weaker standardized markup than login forms; aggressive heuristics that maximize "coverage" also maximize false positives.
**How to avoid:** D-05's `autocomplete`-first scored approach with a real threshold, verified against a curated set of real-world checkout/identity forms (not just a synthetic fixture) before considering the phase done.
**Warning signs:** UAT across real sites surfaces mismatched field targeting; users report the fill affordance appearing on unrelated fields.

### Pitfall 2: Cross-origin iframe autofill leak (PITFALLS.md Pitfall 7 — historical Bitwarden CVE-class bug, Mozilla Bugzilla #786276)

**What goes wrong:** Top-level-page credentials fill into an attacker-controlled cross-origin iframe embedded on the same page.
**Why it happens:** Content scripts run per-frame; it's easy to key matching off a frame's *own* origin correctly while forgetting that a subframe's origin can legitimately (or maliciously) differ from the top page's, and the background trusts `sender.tab.url` (top-level) instead of `sender.frameId`+the frame's actual origin.
**How to avoid:** D-04/D-10's two-sided check — content-relay recomputes its own frame's origin fresh every request; background independently re-derives `sender.frameId`/`sender.tabId` and never falls back to the top-level tab's origin for a subframe request (Pattern 4).
**Warning signs:** A deliberately constructed adversarial iframe test page (ROADMAP SC #5's explicit UAT requirement) shows any fill into a cross-origin subframe.

### Pitfall 3: `MessageSender` metadata differences between Chrome and Firefox

**What goes wrong:** Code written against Chrome's `runtime.MessageSender` shape (which reliably includes `frameId`/`documentId`) may not behave identically on Firefox, where support for some `MessageSender` fields (e.g., `origin`) has lagged Chrome's (tracked historically in Mozilla Bugzilla #1787379; `frameId` itself was added in Firefox per Bugzilla #1354337, now fixed in modern Firefox). `MessageSender` also does not explicitly label whether a message came from a content script, a page, or another extension context — Chrome's own developer docs flag this ambiguity as a footgun. [CITED: developer.chrome.com/docs/extensions/reference/api/runtime, Mozilla Bugzilla #1354337/#1787379]
**Why it happens:** Teams write and test the sender-verification logic against Chrome only, then discover Firefox's `sender` object is shaped slightly differently.
**How to avoid:** Verify `sender.id === browser.runtime.id` (confirms same-extension origin) in addition to `sender.frameId`/`sender.tab.id`; test the frame/origin verification gate on both `wxt dev -b chrome` and `wxt dev -b firefox` per this project's standing dual-browser UAT convention (PITFALLS.md Pitfall 8), not just Chrome.
**Warning signs:** Frame-verification logic that works in Chrome dev testing throws or silently misbehaves on Firefox.

### Pitfall 4: Naive whole-document `MutationObserver` slows down SPA pages (PITFALLS.md Performance Traps)

**What goes wrong:** Re-running field-detection heuristics on every DOM mutation via an unscoped `MutationObserver` on `document.body` noticeably slows down heavy SPA pages (React dashboards, feeds with frequent re-renders).
**Why it happens:** It's the simplest implementation, but does not scale to real-world sites with frequent unrelated re-renders.
**How to avoid:** Debounce/throttle detection runs; scope the observer to form-relevant subtrees where feasible; short-circuit if no `<form>`/`<input>` ancestors actually changed. Exact debounce window is an executor discretion call, but should not be skipped.
**Warning signs:** Extension noticeably slows down on real SPA sites during early UAT, not just at scale.

### Pitfall 5: Setting `.value` directly on a React/Vue-controlled input doesn't trigger the framework's change detection

**What goes wrong:** `input.value = 'foo'` appears to work visually but the site's own JS framework state doesn't update, so the form submits stale/empty data even though the field visibly shows the filled value.
**Why it happens:** React (and similar frameworks) intercept the native `value` setter via a custom property descriptor; a raw assignment bypasses React's internal tracking, so no `onChange` fires.
**How to avoid:** Use the native `HTMLInputElement.prototype`'s value setter descriptor explicitly (bypassing any framework-patched setter on the instance) then dispatch a real, bubbling `input` event (and `change` for good measure) — the standard, widely-documented workaround (Don't Hand-Roll table, `fill-dom.ts`).
**Warning signs:** Fill "looks like it worked" in manual testing (field shows the value) but a subsequent real form submit on the actual site fails validation or sends empty data — must be caught by testing on real framework-heavy sites, not just a static HTML fixture.

## Code Examples

### TOTP fill via existing `pv-wasm` export (D-08 — reuse, no new crypto)

```typescript
// background/autofill-match.ts (background-only — content-relay never calls this directly)
import { totpNow } from 'pv-wasm'; // same wrapper the web app's TotpCountdownRing.tsx already uses

function fillTotp(item: DecryptedTotpItem) {
  const { code, secondsRemaining } = totpNow(
    item.secret,
    item.algorithm,
    item.digits,
    item.period,
    Math.floor(Date.now() / 1000), // caller ALWAYS supplies the clock — totpNow never reads it itself
  );
  return { type: 'totp' as const, code, secondsRemaining };
}
```

### Native-setter DOM fill (React/Vue-safe — Pitfall 5)

```typescript
// lib/autofill/fill-dom.ts
function setNativeValue(input: HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(input);
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(input, value); // bypass any framework-patched instance setter
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}
```

### Frame-origin recomputation on every gesture (D-10)

```typescript
// content-relay.content.ts
function currentFrameContext() {
  return {
    origin: document.location.origin,       // NEVER cache this at injection time
    isTopFrame: window.self === window.top, // safe cross-origin comparison, never throws
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| Autofill triggered on page load / field focus, no user gesture | Explicit click required before any fill (D-03/D-12) | Industry-wide convergence after cross-origin-iframe autofill CVE-class bugs (Bitwarden; Mozilla Bugzilla #786276) | This is now the accepted baseline for any password-manager-class extension, not an optional hardening step |
| Hand-rolled `if (msg.type === ...)` message dispatch per extension | Typed message-contract libraries (`@webext-core/messaging`, `webext-bridge`) recommended by framework maintainers (WXT docs) | WXT's own docs (current as of 2026) explicitly recommend `@webext-core/messaging` over raw `runtime.sendMessage` | Reduces message-shape drift bugs as more message kinds accumulate across a multi-phase extension build (directly relevant here since Phases 10-12 all add message kinds to the same channel) |
| Assuming `chrome.*` MV3 semantics apply identically to Firefox's background execution model | Firefox MV3 uses non-persistent "event pages," not true service workers — behaviorally different idle/lifecycle timing (established in Phase 8's own bootstrap research, PITFALLS.md Pitfall 8) | Documented divergence, not new this phase, but still binding on any sender-verification code Phase 10 writes | `sender`/`MessageSender` field availability differs slightly cross-browser (Pitfall 3 above) — code must be tested on both, not assumed identical |

**Deprecated/outdated:**
- Trusting a page-originated `postMessage`'s self-reported origin field as authoritative — established anti-pattern (ARCHITECTURE.md Anti-Pattern 3) from the Phase 12 passkey-provider research, restated here because the same "never trust payload-declared origin, always re-derive from platform-provided sender metadata" principle applies to this phase's `sender`-based frame verification even though there's no MAIN-world `postMessage` hop in Phase 10 itself.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `@webext-core/messaging`'s `defineExtensionMessaging<ProtocolMap>()` API shape (as described in Architecture Patterns/Don't Hand-Roll) matches the current 3.0.2 release exactly — confirmed only via WebSearch summaries of the official docs page, not a direct Context7/doc fetch this session | Standard Stack, Pattern 1, Don't Hand-Roll | Low — if the exact API differs slightly (e.g., generic parameter name), the planner/executor should do a quick `npm view @webext-core/messaging` + read the installed package's `.d.ts` before writing the first task; does not change the architectural recommendation to use a typed contract library |
| A2 | `chrome.runtime.MessageSender.frameId` (0 = top frame) is available and reliable on both current Chrome and current Firefox MV3 builds for this project's target versions — based on WebSearch of Chrome/MDN docs and historical Bugzilla tickets, not a live test against a running extension in this repo (Phase 8/9 haven't executed yet) | Pattern 4, Pitfall 3 | Medium — if Firefox's current release still has gaps in `sender.frameId`/`sender.origin` availability, the frame-verification gate's Firefox path may need a fallback (e.g., cross-checking `sender.tab.url` against an explicit "is this a known-embedded-iframe" heuristic); this should be spot-checked during Phase 10's own dual-browser UAT, not assumed correct from research alone |
| A3 | `fathom-web`'s stale npm publish (2021) and low download count reflect general low third-party npm adoption of a niche declarative-DOM-scoring library, not that Mozilla's own project is abandoned (the GitHub repo itself may still be actively used inside Firefox's C++/JS codebase, just not npm-published) | Package Legitimacy Audit, Alternatives Considered | Low — regardless of `fathom-web`'s actual maintenance status, D-05 already locks in the simpler hand-rolled approach, so this assumption only affects whether a *future* phase might reconsider adopting it, not this phase's plan |
| A4 | The exact numeric score threshold and per-token weights shown in Pattern 2's code example (`FILL_THRESHOLD = 6`, token weights 5-10) are illustrative starting points, not tuned against real forms | Pattern 2 (Code Examples) | Low — CONTEXT.md's Discretion Areas already flags exact weights/thresholds as an executor-tuning call against a curated real-form set; the illustrative numbers should not be treated as locked |

## Open Questions

1. **Has Phase 9 (session core) actually been executed by the time Phase 10 plans/executes?**
   - What we know: ROADMAP.md's Progress table shows Phase 9 as "Not started" as of this research date; CONTEXT.md's D-11 explicitly instructs treating "vault unlocked" as a precondition/fixture if Phase 9 isn't done.
   - What's unclear: Whether the planner should stub a fixture (e.g., a hand-seeded `chrome.storage.session` entry for dev/UAT purposes) or whether execution should simply be blocked until Phase 9 lands.
   - Recommendation: The planner should check actual repository state (`extension/` directory contents, Phase 9's own SUMMARY files) at plan time rather than trusting this research's snapshot — if Phase 9 genuinely hasn't executed, the plan must include an explicit fixture/mock for "already-unlocked session" so Phase 10's own tests aren't blocked, per D-11's own instruction.

2. **Exact `lib/messaging/` file layout Phase 9 already established (if it has run) vs. what Phase 10 should extend.**
   - What we know: ARCHITECTURE.md's recommended structure names `lib/messaging/page-protocol.ts` (page↔content, unused until Phase 12) and `lib/messaging/ext-protocol.ts` (content↔background, used by both Phase 9 and Phase 10).
   - What's unclear: Whether Phase 9 actually created these files with this naming, or diverged.
   - Recommendation: Planner must read Phase 9's actual SUMMARY.md/code (if it exists) before assuming `ext-protocol.ts`'s current shape; extend, don't recreate.

3. **Adversarial cross-origin iframe UAT fixture — hand-built vs. reusable convention (flagged as an open question in CONTEXT.md itself).**
   - What we know: No existing v0.1 phase built a two-origin test fixture (v0.1 had no browser-extension surface).
   - What's unclear: Whether this phase should build a small standalone two-port local test harness (e.g., two `python -m http.server` instances on different ports, or two `localhost`/`127.0.0.1` origins) as a reusable fixture for this and future phases (Phase 11/12 will likely need similar adversarial pages).
   - Recommendation: Build a minimal, checked-in throwaway test page pair (e.g., `extension/e2e-fixtures/adversarial-iframe/`) documented well enough that Phase 11/12 can reuse the pattern rather than each phase inventing its own.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Building/running the WXT extension project | ✓ | v24.18.0 | — |
| npm | Installing `@webext-core/messaging` and running the extension build | ✓ | 11.16.0 | — |
| Google Chrome (app) | Manual dev-mode testing (`wxt dev -b chrome`), adversarial-iframe UAT | ✓ | (app present, version not queried) | — |
| Firefox (app) | Manual dev-mode testing (`wxt dev -b firefox`), dual-browser UAT convention | ✗ (not found at `/Applications/Firefox.app`) | — | Install Firefox before UAT, or use `web-ext run` against a downloaded Firefox Developer Edition build; this phase's D-04 adversarial-iframe UAT and PITFALLS.md's standing dual-browser convention both require an actual Firefox pass eventually — flag for the human before UAT if Firefox remains unavailable |
| `web-ext` (Mozilla CLI) | Firefox packaging/lint (referenced by STACK.md, not strictly required until Phase 13) | ✗ (not installed) | — | Not blocking for Phase 10 itself (no packaged/signed build requirement in this phase's success criteria — that's Phase 8's and Phase 13's concern); install later via `npm install -g web-ext` when Phase 13's hardening pass needs it |
| Rust/Cargo (for `pv-wasm` rebuilds, if the WASM artifact needs any change) | Not expected to change in this phase (D-08: `totpNow` reused unmodified) | ✓ | rustc 1.97.0 / cargo 1.97.0 | — |

**Missing dependencies with no fallback:** none — Firefox's absence has a documented fallback (install before UAT) and does not block planning/implementation of the content-relay/background logic itself.

**Missing dependencies with fallback:**
- Firefox app — install before running this phase's dual-browser UAT pass (chrome-only development can proceed first, per PITFALLS.md's explicit note that Chrome-only iteration is acceptable *during* development, just not at UAT/ship time).
- `web-ext` CLI — not needed until Phase 13's packaged/signed Firefox build verification; install then.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^3.2.4 (already the project's established test runner — `web/package.json`'s `test` script; `extension/` does not exist yet as of this research, so its own `package.json`/vitest config is a Wave 0 gap for whichever phase creates it first — likely Phase 8) |
| Config file | none yet in `extension/` — depends on Phase 8/9 scaffolding; WXT ships an official Vitest integration (`WxtVitest` plugin exposing a fake `browser` global via `wxt/testing`), which the extension's `vitest.config.ts` should use once created |
| Quick run command | `cd extension && npx vitest run lib/autofill` (once the project exists) |
| Full suite command | `cd extension && npm test` (mirrors `web/`'s `vitest run` convention) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FILL-01 | Login form detected via `type=password`/`autocomplete`; multi-account picker shown when >1 match | unit (jsdom fixture) | `npx vitest run lib/autofill/detect-login.test.ts` | ❌ Wave 0 |
| FILL-02 | TOTP field detected; `totpNow()` result fills or copies | unit + integration (mock `pv-wasm.totpNow`) | `npx vitest run lib/autofill/detect-totp.test.ts` | ❌ Wave 0 |
| FILL-03 | Card fields scored/thresholded, filled only on explicit click | unit (curated real-world checkout HTML fixtures) | `npx vitest run lib/autofill/detect-scored.card.test.ts` | ❌ Wave 0 |
| FILL-04 | Identity fields scored/thresholded, filled only on explicit click | unit (curated real-world identity-form HTML fixtures) | `npx vitest run lib/autofill/detect-scored.identity.test.ts` | ❌ Wave 0 |
| (D-04, SC #5) | Cross-origin iframe fill refused | manual/e2e (adversarial two-origin test page — `human_needed`, per this project's Playwright-UAT-authorized convention, self-validated with a real loaded extension, not simulable in jsdom) | n/a — manual UAT against `extension/e2e-fixtures/adversarial-iframe/` | ❌ Wave 0 (fixture pages themselves) |

### Sampling Rate

- **Per task commit:** `npx vitest run lib/autofill` (targeted, fast)
- **Per wave merge:** `npm test` (full extension suite, once it exists) + a manual Chrome dev-mode smoke pass on the curated real-form fixture set
- **Phase gate:** Full suite green + the adversarial cross-origin iframe manual UAT (D-04/SC #5) passed on at least Chrome before `/gsd-verify-work`; Firefox pass strongly recommended per PITFALLS.md's standing convention, blocking only if Firefox becomes available in time (see Environment Availability).

### Wave 0 Gaps

- [ ] `extension/` project itself — depends on Phase 8 (bootstrap) and Phase 9 (session core) actually existing; if either hasn't executed by Phase 10's plan time, Wave 0 of this phase's plan must include scaffolding a minimal stand-in (see Open Question 1).
- [ ] `extension/vitest.config.ts` using WXT's official `WxtVitest` plugin (`wxt/testing`) for a fake `browser` global — needed before any of the unit tests above can run.
- [ ] `lib/autofill/*.test.ts` fixture HTML — both synthetic (login/TOTP, cheap to construct) and curated real-world (card/identity — copy a handful of real checkout/identity form HTML snapshots, sanitized of any live PII/tracking scripts, into test fixtures).
- [ ] `extension/e2e-fixtures/adversarial-iframe/` — two-origin manual test harness for D-04's mandatory UAT case (not unit-testable in jsdom, since jsdom does not enforce real cross-origin `postMessage`/frame-origin semantics the way a real browser does).
- [ ] `lib/messaging/ext-protocol.ts` — if Phase 9 hasn't created this yet, Phase 10 is the first phase to actually need the typed contract layer; verify before assuming it pre-exists.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V1 Architecture | yes | Trust-boundary diagram (System Architecture Diagram above) must be kept current as later phases add MAIN-world code; background remains the sole crypto choke point (D-02) |
| V2 Authentication | no | This phase does not touch unlock/authentication — that's Phase 9's completed concern; Phase 10 only reads the fact that a session is unlocked |
| V3 Session Management | no (indirect) | Phase 10 does not manage session lifecycle; it must not extend/refresh the session's TTL as a side effect of an autofill request (verify this doesn't happen as an unintended interaction with Phase 9's `chrome.alarms` auto-lock) |
| V4 Access Control | **yes — primary** | Frame/origin verification gate (D-04/D-10, Pattern 4) is this phase's core access-control mechanism; background must independently re-derive `sender.frameId`/`sender.tab.id`, never trust payload-declared origin/frame fields |
| V5 Input Validation | yes | `autocomplete`/`name`/`id`/label-text strings read from the (untrusted) page DOM by the scored detector (Pattern 2) must be treated as untrusted input — bound string lengths before scoring/logging to avoid a hostile page feeding pathologically long attribute values into the scorer; message payloads (`itemId`, `kind`) must be validated against known enum values before being used to key a vault lookup |
| V6 Cryptography | no (reuse only) | No new cryptography in this phase — `totpNow()` reused unmodified (D-08); no key derivation/encryption logic is written |
| V7 Error Handling & Logging | yes | Fill failures (no match, decrypt error) must fail closed (no partial fill, no fallback to a wrong item) and must never log plaintext fill values (username/password/card/identity fields) to `console.*` or `tracing`-equivalent extension logs |
| V8 Data Protection | yes | Plaintext fill values must be transient — held only long enough to write into the DOM, never persisted to any storage (`chrome.storage.local`/`.session`), never cached in a content-relay module-level variable beyond the single fill operation |
| V9 Communication | yes (internal only) | `runtime.sendMessage`/`@webext-core/messaging` traffic between content-relay and background is extension-internal (not visible to the page's own JS) but still carries plaintext fill values on the `autofill.fill` response — this channel itself is the trust boundary Pitfall from Phase 12's research (Anti-Pattern 3) generalizes to: even an "internal" channel must not be assumed automatically safe from a compromised-content-script scenario, hence the independent `sender` re-verification |
| V10 Malicious/Untrusted Code | yes | The content-relay executes in the ISOLATED world (not directly observable by page JS as *code*, per Chrome/Firefox's content-script isolation guarantees), but DOM values it *writes* are inherently page-visible (unavoidable — that's what autofill is); the detection *scoring* logic must not `eval`/construct code from DOM-read strings under any circumstance |

### Known Threat Patterns for MV3 content-script autofill

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-origin iframe credential leak (fill top-level creds into an attacker's embedded subframe) | Spoofing + Information Disclosure | D-04/D-10 frame/origin re-verification on every request (Pattern 4); historical precedent: Bitwarden CVE-class bug, Mozilla Bugzilla #786276 |
| TOCTOU on frame identity (page navigates/rewrites DOM between `autofill.match` and `autofill.fill` requests) | Tampering | Background re-verifies `sender`/origin independently on the *second* request too, not just the first (Pattern 4's "never cache across the two-request round-trip" rule) |
| Malicious page feeding pathologically-crafted `autocomplete`/`name`/`id`/label strings to bias the scorer into flagging an attacker-chosen field as "card number" to harvest a fill | Tampering + Information Disclosure | Bound string lengths before scoring; threshold-gate (D-05) plus the mandatory explicit click (D-12) means even a successful scorer manipulation still requires the user to notice and click a wrongly-labeled affordance — defense in depth, not a single point of failure |
| Compromised/buggy content-relay instance sending a forged `autofill.fill` request with an attacker-controlled `itemId` for a *different* origin's item | Elevation of Privilege | Background must validate the requested `itemId` actually belongs to an item matched in the *same* `autofill.match` response for the *same verified origin* — never trust an `itemId` in isolation without re-checking origin ownership server-side-equivalent (i.e., in background's own item-lookup logic) |
| Plaintext fill values logged inadvertently (e.g., a debug `console.log(result)` left in during development) | Information Disclosure | Code-review checklist item (mirrors the project's existing grep-auditable-crypto-boundary convention) — no `console.*` call may reference a decrypted fill-value variable; enforce via code review, not just intent |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/10-autofill-login-totp-card-identity/10-CONTEXT.md` — locked decisions, discretion areas, deferred ideas (this phase's authoritative scope)
- `.planning/research/ARCHITECTURE.md`, `PITFALLS.md`, `STACK.md`, `FEATURES.md`, `SUMMARY.md` — curated v0.2 research, dated 2026-07-14, already vetted against official Chrome/Mozilla/WXT/Bitwarden/1Password sources
- `crates/pv-core/src/totp.rs`, `crates/pv-wasm/src/lib.rs` (`totp_now`/`totpNow`) — read directly this session; exact function signature and JSON return shape confirmed from source
- `web/src/lib/crypto/index.ts` — confirmed the existing `totpNow()` TS wrapper's exact signature/behavior (bigint conversion, JSON.parse) this session
- `web/src/lib/vault/types.ts` — confirmed exact `CardFields`/`IdentityFields`/`LoginFields`/`TotpFields` shapes this phase's fill responses must match
- npm registry (`npm view wxt/@wxt-dev/browser/@webext-core/messaging/webext-bridge/fathom-web version` + `time.modified`) — verified exact current versions and publish recency directly, this session
- `gsd-tools query package-legitimacy check` — verdict/signals for `fathom-web` (SUS), `webext-bridge` (OK), `@webext-core/messaging` (OK) — run directly this session

### Secondary (MEDIUM confidence)
- WebSearch: "chrome.runtime.MessageSender frameId documentId..." — Chrome for Developers `runtime` API docs, MDN `runtime.MessageSender`, Mozilla Bugzilla #1354337/#1787379 (cross-checked)
- WebSearch: "WebAuthn conditional mediation autocomplete=webauthn..." — MDN `isConditionalMediationAvailable`, Corbado/Yubico/Authsignal technical explainers (cross-checked against each other; confirms the standardized `autocomplete` token family this phase's own heuristics build on, though conditional-mediation itself is out of this phase's scope per CONTEXT.md's Deferred Ideas)
- WebSearch: "@webext-core/messaging WXT typed messaging..." — official `webext-core.aklinker1.io/messaging` docs page, WXT's own `wxt.dev/guide/essentials/messaging` guide (cross-checked)
- WebSearch: "content script detect top-level frame window.top === window.self..." — MDN cross-window-communication guidance, multiple independent practitioner sources converging on the same `window.self !== window.top` primitive

### Tertiary (LOW confidence)
- None — every claim above was either read directly from this repo's source, verified live against the npm registry/legitimacy-check tool, or cross-checked against at least two independent web sources during this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified live via npm registry this session; `@webext-core/messaging` recommendation cross-checked against WXT's own documented guidance
- Architecture: MEDIUM-HIGH — directly derived from this project's own already-completed, multi-source-triangulated ARCHITECTURE.md/PITFALLS.md, extended with this session's targeted verification of `MessageSender`/frame-detection specifics; no hands-on experiment run in this repo yet since Phase 8/9 haven't executed
- Pitfalls: HIGH — Pitfalls 1/2 are directly inherited from the project's own curated, multi-source PITFALLS.md (official docs + historical CVE-class precedent); Pitfalls 3/4/5 verified this session against official/practitioner sources

**Research date:** 2026-07-14
**Valid until:** 30 days for the architecture/pitfalls guidance (stable, MV3-platform-level); 7 days for the exact npm package version pins (`@webext-core/messaging`, `webext-bridge`) given this ecosystem's faster release cadence — re-verify versions at plan/execute time if this research is more than a week old.
