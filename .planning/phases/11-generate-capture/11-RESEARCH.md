# Phase 11: Generate & Capture - Research

**Researched:** 2026-07-14
**Domain:** Browser-extension form instrumentation (ISOLATED content script) for password generation, submit-capture, save/update-login prompts, and origin-mismatch detection — no MAIN-world code in this phase
**Confidence:** MEDIUM-HIGH

## Summary

Phase 11 does not introduce any new external technology. It is a content-script + background-message-passing feature built entirely on top of infrastructure the earlier extension phases (8-10) are expected to have already established: a WXT MV3 project, a background service worker that owns `pv-wasm` and the unlocked User Key in `chrome.storage.session`, a typed messaging layer (`lib/messaging/`), and Phase 10's field-detection/origin-context plumbing. The two pieces of genuinely new logic are (1) a signup-form detector plus generated-password suggestion, and (2) a submit-capture pipeline with a "successful login" heuristic that classifies every submit as new-login / password-change / no-op, always carrying the frame's own origin for a mismatch check against the top-level page.

The most important research finding for this phase corrects an assumption baked into CONTEXT.md D-03: the v0.1 password generator is **not** part of `pv-core`/`pv-wasm`. It is pure TypeScript (`web/src/lib/generator/{password.ts,strength.ts,wordlist.ts}`), built entirely on the standard Web Crypto `crypto.getRandomValues` API with zero I/O and zero Rust/WASM involvement `[VERIFIED: codebase]`. This is good news architecturally — `crypto.getRandomValues` exists in every JS execution context this project uses, including the MV3 background service worker's global scope (`self.crypto`) and the ISOLATED content-script world — so there is no WASM-loading concern for password generation specifically. Per CONTEXT.md D-01/D-07, the generator should still be invoked via a `generate-request` background message (not called directly in the content script) to preserve the single-choke-point message-passing discipline the architecture research locked in, and to keep the content script decryption/generation-free — but this is a deliberate architectural consistency choice, not a technical requirement of the generator's own code.

The save-new-login / password-change-update flow reuses the exact `createVaultItem(fields: ItemFields)` / `updateVaultItem(id, fields, currentRevision)` pattern already implemented in `web/src/lib/vault/store.ts` `[VERIFIED: codebase]` — the background service worker's equivalent handler must replicate this shape (encrypt via `pv-wasm`'s `encryptItem`, then call the REST `createItem`/`updateItem` contract), not invent a new persistence path. No new npm or Rust crate is required for this phase; the only new devDependency worth flagging is `@webext-core/fake-browser` for testing `chrome.storage.session`-backed logic without a real browser.

**Primary recommendation:** Build all Phase 11 logic in the ISOLATED content script (already established in Phase 10) plus new background message handlers (`generate-request`, `capture.propose-save`, `capture.confirm-save`, `capture.propose-update`) registered in the existing `lib/messaging/ext-protocol.ts` — no MAIN-world code, no new external dependency, reuse the v0.1 generator (ported as-is) and the v0.1 `createVaultItem`/`updateVaultItem` encrypt-then-REST pattern verbatim.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Signup-form field detection (new-password + confirm-password pair) | Browser / Client (ISOLATED content script) | — | Pure DOM inspection; needs live access to the page's form elements, which only a content script has |
| Generated-password suggestion (character + passphrase mode) | Browser / Client (background service worker) | ISOLATED content script (UI only) | Generation itself is a background message handler per D-01/D-07 discipline (`generate-request`); the content script only renders the suggestion UI and inserts the returned string into the field — it never runs the generator locally |
| Submit-event capture + success heuristic | Browser / Client (ISOLATED content script) | — | Requires DOM `submit` listeners, `MutationObserver`/URL-change watching, and AJAX-completion heuristics — all page-observable signals only a content script can read |
| Save-new-login / update-existing-item decision + prompt UI | Browser / Client (ISOLATED content script for the toast/banner UI) | Background service worker (match lookup + persistence) | The content script proposes; the background service worker is the only place that can query the decrypted vault (origin+username match) and hold the unlocked key |
| Item encryption (new item / updated item) | Background service worker | — | `pv-wasm`'s `encryptItem` may only run where WASM is loaded — background, per the project's single-choke-point invariant (D-01) |
| Persistence (create/update REST call) | Background service worker | pv-server (API) | Background owns the session token and the sync client (Phase 9); content script never calls pv-server directly |
| Origin/frame-mismatch computation | Browser / Client (ISOLATED content script, using `location.origin` of its own frame + a `sender.tab`-provided top-level origin from background) | Background service worker (independent re-verification via `sender` metadata) | Content script self-reports frame origin; background must independently verify via `runtime.onMessage`'s `sender` object (which the page cannot forge) before trusting any origin claim — see Pitfall 7 / Anti-Pattern 3 in ARCHITECTURE.md |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | — | Phase 11 adds no new runtime library | All required primitives (`crypto.getRandomValues`, DOM `submit`/`input` events, `MutationObserver`, `chrome.storage.session`, `browser.runtime.sendMessage`) are already-approved platform APIs or dependencies pinned by Phases 8-10 |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@webext-core/fake-browser` | latest (658.8k weekly downloads at research time) `[VERIFIED: npm registry via package-legitimacy check, OK verdict]` | In-memory `browser.storage.session`/`browser.runtime` implementation for Vitest, used by WXT's own `WxtVitest` plugin | devDependency only, for unit-testing background message handlers and the generator round trip without a real browser — see Validation Architecture |
| `wxt/testing/vitest-plugin` (bundled with `wxt`) | matches whatever `wxt` version Phase 8 pinned | `WxtVitest` Vitest plugin — polyfills `browser.*`, resolves WXT's `#imports` aliases inside test files | Import in `extension/vitest.config.ts`; needed to unit test any file that imports `#imports` or `browser.*` (background router, content-relay) `[CITED: wxt.dev/guide/essentials/unit-testing]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing the pure-TS v0.1 generator via a background message | Reimplementing password generation directly in the content script (skip the message round trip since no WASM/key material is involved) | Technically valid (generator has zero key-material dependency) but breaks CONTEXT.md D-01/D-07's single-message-registration discipline and the "content script never generates plaintext credentials outside the round trip" invariant; the extra ~1-5ms IPC round trip is immaterial for a once-per-signup-form-focus operation — keep it in background for architectural consistency |
| A generic `MutationObserver`-based success heuristic | Overriding `fetch`/`XMLHttpRequest` in the page to detect AJAX login responses | Overriding `fetch`/XHR requires MAIN-world code (out of scope this phase per D-07) and is a much larger trust-boundary surface for a heuristic that doesn't need certainty — the DOM/URL/error-absence heuristic (already locked as D-04) is sufficient and stays entirely in the ISOLATED world |

**Installation:**
```bash
# extension/ (assumes phases 8-10 already scaffolded this WXT project)
npm i -D @webext-core/fake-browser
```

**Version verification:** `@webext-core/fake-browser` and `wxt` were checked via the project's `package-legitimacy check` seam against the npm registry at research time — `@webext-core/fake-browser` returned `OK` (658.8k weekly downloads, GitHub repo `aklinker1/webext-core`, no postinstall script). `wxt`/`@wxt-dev/browser` returned a `SUS`/"too-new" signal purely because they publish frequently (both have 700k+ weekly downloads, which is itself strong evidence of legitimacy) — these are pre-existing Phase 8 dependencies, not new installs introduced by this phase; see Package Legitimacy Audit below.

## Package Legitimacy Audit

| Package | Registry | Age signal | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|------------|-----------|--------------|---------|-------------|
| `@webext-core/fake-browser` | npm | published 2026-06-01 (package itself has shipped since 2023; frequent releases) | 658,821/wk | github.com/aklinker1/webext-core | OK | Approved — new devDependency for this phase |
| `wxt` | npm | latest publish 2026-06-23 ("too-new" signal — misleading for an actively-released tool) | 785,571/wk | github.com/wxt-dev/wxt | SUS ("too-new") | Not a new install — already a Phase 8 dependency; re-verified here only because this phase's testing setup depends on it. High download count + existing GitHub org strongly indicate the "too-new" flag is a false positive triggered by release cadence, not by package immaturity. No action needed; do not re-gate an already-approved Phase 8 dependency behind a fresh checkpoint. |
| `@wxt-dev/browser` | npm | latest publish 2026-07-02 ("too-new" signal, same cause as above) | 702,102/wk | github.com/wxt-dev/wxt | SUS ("too-new") | Same as above — pre-existing Phase 8 dependency, not introduced by Phase 11. |

**Packages removed due to [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** `wxt`, `@wxt-dev/browser` — both are frequent-release false positives already vetted in `.planning/research/STACK.md` at the milestone level; no new `checkpoint:human-verify` needed for this phase since they are not being installed here. If Phase 8 has not yet actually run `npm install` for these, the planner for Phase 8 (not Phase 11) owns that checkpoint.

*No packages discovered via WebSearch/training data without registry+docs confirmation are used in this phase — the generator reuse is a direct codebase read, not a WebSearch discovery.*

## Architecture Patterns

### System Architecture Diagram

```
Signup / login page (untrusted, any world)
       │  user focuses a new-password field
       ▼
┌───────────────────────────────────────────────────────────────────┐
│ ISOLATED content script (content-relay, Phase 10 base + Phase 11) │
│                                                                     │
│  1. form-detector.ts                                               │
│     - scores form: new-password + confirm-password pair            │
│       (type=password count ≥2, autocomplete="new-password", or     │
│       name/id heuristics) → signup-mode                            │
│     - scores form: single password field submit on an existing     │
│       origin-matched saved login → login-submit-mode                │
│                                                                     │
│  2a. [signup-mode] renders inline suggestion UI near the field  ───┼──► sendMessage({kind:'generate-request', mode, opts})
│      on user click, fills the field with the returned string        │        │
│                                                                     │        ▼
│  2b. [any form] submit-capture.ts attaches a `submit` listener +    │   background/router.ts
│      MutationObserver/URL-change watcher; on success heuristic     │        │
│      (no visible error text, URL/history change, or a subsequent   │        ▼
│      authenticated-looking page) fires:                             │   generator.ts (ported v0.1
│      sendMessage({kind:'capture.propose-save', origin, frameOrigin, │   password.ts/strength.ts/
│                    topOrigin, username, password})            ─────┼──► wordlist.ts, runs
│                                                                     │   crypto.getRandomValues in
│  3. background responds: 'new' | 'update:<itemId>' | 'no-match'     │   the SW's own global scope)
│     content script renders save-toast / update-toast, showing       │        │
│     the frameOrigin explicitly and a mismatch warning if            │        ▼
│     frameOrigin !== topOrigin                                       │   returns password string
│                                                                     │◄───────┘
│  4. user confirms → sendMessage({kind:'capture.confirm-save', ...}) │
└──────────────────────────┬──────────────────────────────────────────┘
                            │ runtime.sendMessage (trusted boundary,
                            │ sender.tab/sender.frameId verified server-side)
                            ▼
┌───────────────────────────────────────────────────────────────────┐
│ background service worker (Phase 8/9 foundation)                   │
│                                                                     │
│  router.ts → capture-handler.ts                                    │
│    - 'capture.propose-save': re-reads chrome.storage.session for    │
│      the unlocked-key envelope (worker may have just woken),        │
│      queries decrypted-in-memory vault items for origin+username    │
│      match (reuses Phase 10's item-matching logic) → classify       │
│    - 'capture.confirm-save' (new): encryptItem(uk, JSON.stringify   │
│      (LoginFields), id, 1) → createItem(id, encKey, encData)         │
│    - 'capture.confirm-save' (update): encryptItem(uk, ..., id,       │
│      currentRevision+1) → updateItem(id, encKey, encData,            │
│      currentRevision) — same encrypt-then-REST shape as              │
│      web/src/lib/vault/store.ts's createVaultItem/updateVaultItem    │
│    - 'generate-request': runs ported generator, returns plaintext    │
│      password string only (no persistence side-effect)               │
└──────────────────────────┬──────────────────────────────────────────┘
                            │ HTTPS (existing Phase 9 sync-client)
                            ▼
                     pv-server /api/vault/items (unchanged)
```

### Recommended Project Structure

```
extension/                                   # existing WXT project from Phase 8
├── entrypoints/
│   ├── content-relay.content.ts             # Phase 10 base; add:
│   ├── content/
│   │   ├── form-detector.ts                 # NEW: signup vs. login-submit form scoring
│   │   ├── generate-suggestion-ui.ts        # NEW: inline suggestion popover/dropdown
│   │   ├── submit-capture.ts                # NEW: submit listener + success heuristic
│   │   └── save-update-toast.ts             # NEW: save/update prompt banner, origin warning
│   └── background/
│       ├── router.ts                        # Phase 8/9 base; add 4 new message kinds here
│       ├── generator.ts                     # NEW: ported password.ts/strength.ts/wordlist.ts
│       └── capture-handler.ts               # NEW: origin+username match, encrypt+create/update
├── lib/
│   ├── messaging/
│   │   └── ext-protocol.ts                  # add: 'generate-request', 'capture.propose-save',
│   │                                          #      'capture.confirm-save' message shapes
│   └── generator/                            # ported copy of web/src/lib/generator/*.ts
│       ├── password.ts
│       ├── strength.ts
│       └── wordlist.ts
```

### Structure Rationale

- **`lib/generator/` is a byte-for-byte port, not a reimplementation.** `password.ts`/`strength.ts`/`wordlist.ts` have zero DOM/Node/pv-core dependencies (only `crypto.getRandomValues`), so they can be copied unchanged into the extension package. If the monorepo later adds an npm workspace root (`web/` + `extension/` as siblings — not yet set up; there is no root `package.json` today `[VERIFIED: codebase — no workspace config found]`), this could become a shared `packages/generator` instead of a copy; that refactor is out of scope for Phase 11 and should not block it — a copy that is diffed against `web/src/lib/generator/` in code review is an acceptable, honest interim state, not silent drift, provided both copies stay under test.
- **All four new message kinds register in the existing `ext-protocol.ts` file**, per D-07 — this avoids the "ad-hoc `if (msg.type === ...)` sprawl" anti-pattern ARCHITECTURE.md's Scaling Considerations section explicitly warns against as the message-kind count grows across phases.
- **`capture-handler.ts` is a new background module, not a change to `vault-session.ts` or `sync-client.ts`** — it depends on both (needs the unlocked key from `vault-session.ts`, needs `createItem`/`updateItem` from `sync-client.ts`'s REST layer) but owns none of their state, keeping single-responsibility per module.

### Pattern 1: Success heuristic for AJAX/SPA login forms (no full-page reload)

**What:** After a `submit` event fires (or, if the form has no `<form>` wrapper at all — common in SPA logins — after a click on a submit-styled button), start a short observation window (recommend 1.5-3s, tunable — CONTEXT.md leaves the exact threshold to the planner/executor) that watches for: (a) absence of a newly-appeared error-looking element (heuristic: text matching common error patterns, or an element with `role="alert"`/`aria-invalid`), (b) a `history.pushState`/`popstate`/`location.href` change, or (c) disappearance of the original login form from the DOM (a common SPA tell that the view re-rendered post-auth). Any of (a)+(b), (a)+(c), or a full navigation event counts as "success."

**When to use:** Every submit-capture on a form the detector classified as `login-submit-mode`.

**Example (heuristic shape, not full code):**
```typescript
// entrypoints/content/submit-capture.ts (ISOLATED world)
function watchForSuccess(form: HTMLFormElement, snapshot: { url: string }): void {
  const start = Date.now();
  const observer = new MutationObserver(() => {
    const stillPresent = document.body.contains(form);
    const urlChanged = location.href !== snapshot.url;
    const errorVisible = document.querySelector('[role="alert"], [aria-invalid="true"]') !== null;
    if ((!stillPresent || urlChanged) && !errorVisible) {
      observer.disconnect();
      proposeSave(); // sends 'capture.propose-save' to background
    }
    if (Date.now() - start > 3000) observer.disconnect(); // give up, no proposal
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
```

### Pattern 2: Password-change diff against an existing matched item

**What:** `capture.propose-save` in the background first attempts an origin+username match against already-decrypted vault items (reusing whatever matching function Phase 10's autofill introduced for consistency — CONTEXT.md explicitly leaves fuzzy-vs-exact matching to the planner, informed by Phase 10's approach). If a match exists and the submitted password differs from the stored `LoginFields.password`, respond `'update:<itemId>'` instead of `'new'`; the content script then renders an "update saved password?" prompt instead of "save new login?", and on confirm calls the same `updateVaultItem`-shaped path (`encryptItem` at `currentRevision + 1` → `updateItem` with `expected_revision`).

**When to use:** CAP-03 — every `capture.propose-save` request, not just ones where no match was found.

**Example (message shape):**
```typescript
// background/capture-handler.ts
async function classifySubmit(origin: string, username: string, password: string) {
  const match = findLoginByOriginAndUsername(origin, username); // reuse Phase 10 helper
  if (match === null) return { action: 'new' as const };
  if (match.fields.password === password) return { action: 'no-op' as const }; // unchanged
  return { action: 'update' as const, itemId: match.id, currentRevision: match.revision };
}
```

### Pattern 3: Origin-mismatch computation (D-06 / Pitfall 7)

**What:** The content script records its **own frame's** `location.origin` (`frameOrigin`) at capture time — never inherited from `window.top`, which could be forged or simply unavailable cross-origin. It also independently asks the background for the tab's top-level origin (background gets this via `sender.tab.url` from the trusted `runtime.onMessage` sender object, which content scripts cannot forge — see ARCHITECTURE.md Anti-Pattern 3). If `frameOrigin !== topOrigin`, the save/update prompt must show both explicitly and require an extra confirm step.

**When to use:** Every `capture.propose-save`/`capture.propose-update`, unconditionally — this is D-06, a required part of the initial implementation.

**Example:**
```typescript
// background/router.ts
browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.kind === 'capture.propose-save') {
    const topOrigin = sender.tab?.url ? new URL(sender.tab.url).origin : null;
    // frameOrigin comes from msg.frameOrigin (content script's self-report) but is
    // ALWAYS cross-checked against topOrigin server-side before trusting it in the UI copy.
    return captureHandler.classify({ ...msg, topOrigin });
  }
});
```

### Anti-Patterns to Avoid

- **Running the generator inline in the content script "since it's just Web Crypto, no WASM needed":** technically works, but violates D-01/D-07's single-message-registration discipline this project has locked in project-wide; keep it in background via `generate-request` for architectural consistency with every other crypto-adjacent operation.
- **Trusting the content script's self-reported `frameOrigin` without a background-side cross-check:** the whole point of D-06 is that a compromised/malicious page could lie about its own frame's origin in the message payload; background must independently derive `topOrigin` from `sender.tab.url` (trusted) and never take the content script's word alone for the origin displayed in a security-relevant warning.
- **Auto-saving on a "successful" heuristic without a user-confirm step:** the success heuristic is a *trigger for showing a prompt*, never a trigger for silently writing to the vault — this mirrors the project's existing anti-auto-submit stance (REQUIREMENTS.md's Out of Scope table: "Auto-submit login forms after fill").
- **Re-deriving `pv-wasm`'s `encryptItem` output shape from scratch:** reuse the exact `{enc_key, enc_data}`-splitting/JSON-combining logic already implemented in `web/src/lib/vault/store.ts` (see `recombineEncryptedItem`/`splitCombinedEncryptedItem` in that file) rather than inventing a new wire shape for the extension's background handler.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| CSPRNG password/passphrase generation | A new random-password generator for the extension | Port `web/src/lib/generator/{password.ts,strength.ts,wordlist.ts}` unchanged | Already implements uniform rejection-sampling over `crypto.getRandomValues` correctly (biased-modulo bug already avoided); CAP-01 explicitly requires reuse, not reimplementation (D-03) |
| Vault item encryption for a new/updated login | A parallel encrypt path in the extension | `pv-wasm`'s `encryptItem`, invoked with the same `{uk, plaintext, id, revision}` signature `web/src/lib/vault/store.ts` already uses | Single grep-auditable crypto choke-point invariant (D-01); a second implementation is exactly the "divergent JS crypto implementation" the project's REQUIREMENTS.md Out-of-Scope table forbids |
| Origin/frame trust verification | A custom `postMessage`-origin-string check trusting client-reported data | `sender.tab`/`sender.frameId`/`sender.url` from `browser.runtime.onMessage`'s trusted `sender` argument | Content scripts cannot forge the `sender` object the browser attaches to `runtime.onMessage`; this is the only tamper-proof origin signal available (ARCHITECTURE.md Anti-Pattern 3) |
| Browser API mocking for tests | Hand-rolled `chrome.storage`/`browser.runtime` stubs | `@webext-core/fake-browser` via WXT's `WxtVitest` plugin | In-memory, spec-accurate implementation already used by WXT's own test suite; avoids maintaining a bespoke mock that silently drifts from real `chrome.storage.session` semantics |

**Key insight:** Every piece of "don't hand-roll" guidance in this phase points back to a file that already exists in `web/` — Phase 11's job is disciplined *reuse* across a new execution context (content script + background service worker), not new invention. The only genuinely new code is DOM-facing heuristics (form detection, success detection, origin display) that have no v0.1 analog because the web app never needed to observe someone else's page.

## Common Pitfalls

(Inherited directly from `.planning/research/PITFALLS.md`, scoped to what's relevant for this phase — see that file for the full milestone-wide list.)

### Pitfall A: Submit-capture fires on AJAX forms with no full-page reload (PITFALLS.md context, Feature research D-04)
**What goes wrong:** A naive implementation listens only for the `submit` event on a `<form>` element and/or a full `beforeunload`/navigation event — many modern login forms are `<div>`-based SPA components with `event.preventDefault()` and a `fetch()` call, never firing a real form submission or page navigation at all.
**Why it happens:** Developers test against a handful of classic server-rendered login forms first and generalize from there.
**How to avoid:** Layer three signals (submit event OR submit-button click, DOM/error-absence check, URL/history change) as in Pattern 1 above, rather than relying on any single event type.
**Warning signs:** Save-prompt never appears on modern SPA sites (React/Vue login components) during UAT, even though the login clearly succeeded.

### Pitfall B: Password-change detection fires on password-manager-driven re-typing, not a real change
**What goes wrong:** If the extension itself just filled a password via autofill (Phase 10) and the user then submits, a naive diff-against-stored-password check sees "submitted password == stored password" and correctly no-ops — but if the user manually retypes the *same* password (e.g., copy-pasted from elsewhere) it should also no-op, not offer a needless "update?" prompt.
**Why it happens:** The diff logic in Pattern 2 already handles this correctly by comparing plaintext values, but only if the comparison happens **after** decryption in the background (where the stored plaintext is available) — a mistake would be trying to diff hashes or ciphertext instead.
**How to avoid:** Always compare plaintext-to-plaintext in the background handler (which already holds the decrypted vault in memory per Phase 9's session model), never compare against ciphertext or attempt the diff in the content script (which has no decrypted data at all).
**Warning signs:** "Update saved password?" prompts appearing when the user didn't actually change anything.

### Pitfall C: Generated-password suggestion UI conflicting with the browser's own native suggestion
**What goes wrong:** Chrome/Firefox/Safari all ship a native "suggest strong password" affordance on `type="password"` fields with `autocomplete="new-password"`. Two overlapping suggestion UIs (native + extension) on the same field is visually confusing and a known friction point across the whole password-manager-extension category.
**Why it happens:** The extension's own detection heuristic fires on the exact same signal (`autocomplete="new-password"`) the browser uses for its native feature, with no coordination mechanism between them (there is no API to detect/suppress the browser's native suggestion).
**How to avoid:** Design the extension's suggestion UI to be click-triggered (e.g., icon-in-field) rather than auto-popping-open on focus, so it doesn't visually race the native browser popover; this is consistent with D-04/D-06's "explicit user gesture" pattern used elsewhere in this milestone. Exact UI treatment is left to Claude's discretion per CONTEXT.md.
**Warning signs:** UAT screenshots show both a native "Suggested strong password" bubble and the extension's own suggestion open simultaneously, overlapping.

## Code Examples

### Ported generator invocation from a background message handler
```typescript
// background/generator.ts — ported unchanged from web/src/lib/generator/password.ts
// Source: web/src/lib/generator/password.ts (v0.1, verified in this repo)
export function generateCharacterPassword(length: number, opts: CharacterPasswordOptions): string {
  // ...identical implementation, crypto.getRandomValues works in the MV3 SW's `self.crypto`...
}

// background/router.ts
browser.runtime.onMessage.addListener((msg) => {
  if (msg.kind === 'generate-request') {
    return msg.mode === 'passphrase'
      ? generatePassphrase(msg.wordCount ?? 6)
      : generateCharacterPassword(msg.length ?? 20, msg.opts);
  }
});
```

### Encrypt-then-persist for a new captured login (mirrors `createVaultItem`)
```typescript
// background/capture-handler.ts
// Source: pattern verified in web/src/lib/vault/store.ts createVaultItem/updateVaultItem
async function confirmNewLogin(uk: WasmUserKey, fields: LoginFields): Promise<void> {
  const id = crypto.randomUUID();
  const combined = encryptItem(uk, JSON.stringify(fields), id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined); // same helper, ported
  await createItem(id, encKey, encData); // same REST contract as web app
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| MV2 persistent background page holding form-fill state indefinitely | MV3 event-driven service worker; state must round-trip through `chrome.storage.session` on every message | Chrome MV3 migration (2023+), still the live constraint | Every `capture.*`/`generate-request` handler must re-check `chrome.storage.session` at call time rather than assuming an in-memory reference from a previous message survived |

**Deprecated/outdated:**
- None specific to this phase beyond the MV3 lifecycle point above (already covered project-wide in `.planning/research/PITFALLS.md` Pitfall 3).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | Exact success-heuristic timing window (1.5-3s) is a reasonable default | Pattern 1 | Too short: misses slow AJAX logins, no save-prompt shown. Too long: prompt feels delayed. CONTEXT.md already flags this as an open discretion area to validate empirically in UAT — treat the number in this doc as a starting point, not a spec. |
| A2 | Phases 8-10 will produce the exact file layout shown in ARCHITECTURE.md's "Recommended Project Structure" (`entrypoints/background/router.ts`, `lib/messaging/ext-protocol.ts`, etc.) | Recommended Project Structure | If earlier phases named/organized files differently, the planner must adapt Phase 11's new files to the actual layout rather than assuming these exact paths — verify against the real repo state at plan/execute time, since phases 8-10 had not yet been executed as of this research pass `[VERIFIED: codebase — extension/ directory does not exist yet]` |
| A3 | Phase 10 already introduced an origin+username login-matching helper that Phase 11's `capture-handler.ts` can reuse for password-change detection | Pattern 2 | If Phase 10's actual matching function differs in shape/name from what's assumed here, Phase 11 must adapt to call it correctly rather than duplicate matching logic — this is explicitly left as a planner decision in CONTEXT.md's Discretion Areas |
| A4 | No root npm workspace exists linking `web/` and `extension/` as sibling packages today | Structure Rationale | If Phase 8 already introduced a workspace (unconfirmed, not yet built), the generator port could be a shared package instead of a copy — re-verify at Phase 11 plan time |

**If this table is empty:** N/A — see entries above; all are planner-facing confirmations needed because Phases 8-10 have not executed yet at the time of this research.

## Open Questions

1. **Exact shape of Phase 10's origin+username matching helper**
   - What we know: Phase 10 (Autofill) necessarily builds some origin-scoped login-matching logic to offer autofill on a form (FEATURES.md: "Per-domain match & multi-account picker").
   - What's unclear: The exact function signature/module location, since Phase 10 has not been planned/executed yet.
   - Recommendation: Phase 11's planner should locate and reuse Phase 10's actual matching function (by module name once it exists) rather than re-deriving one from this research doc's assumed shape; if Phase 10 hasn't landed a reusable helper, Phase 11 should add one and flag it for Phase 10 to adopt retroactively (consistency, not duplication).

2. **Toast/prompt persistence across the SW idle-kill window between "propose" and "confirm"**
   - What we know: The user may take more than 30s to read a save-prompt banner and click "confirm," by which point the background service worker may have been idle-killed and woken again (Pitfall 3).
   - What's unclear: Whether the `capture.confirm-save` message should re-send the full field payload (username/password/origin) so the woken worker doesn't need any surviving in-memory state, or whether a short-lived `chrome.storage.session` "pending capture" record keyed by a nonce is cleaner.
   - Recommendation: Prefer re-sending the full payload from the content script on confirm (the content script's own DOM-scoped closure survives as long as the tab/frame is alive, unlike the background's JS heap) — this sidesteps the SW-wake problem entirely rather than requiring a new session-storage sub-schema. Planner should confirm this against however Phase 9's session model actually shapes `chrome.storage.session` once built.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|--------------|-----------|---------|----------|
| `extension/` WXT project (Phase 8 output) | All of Phase 11 | ✗ (not yet scaffolded as of this research pass) | — | None — Phase 11 execution is blocked until Phases 8-10 land the project structure; this is expected sequencing per ROADMAP.md's `Depends on: Phase 10`, not a gap in this research |
| `web/src/lib/generator/*.ts` (v0.1 source of truth) | Generated-password suggestion | ✓ | Current `web/` HEAD | — |
| `web/src/lib/vault/store.ts` encrypt/persist pattern | Save-new-login / update-item | ✓ | Current `web/` HEAD | — |
| Node/npm | Building/testing the extension | ✓ (used throughout `web/`) | — | — |

**Missing dependencies with no fallback:**
- The `extension/` WXT project itself does not exist yet — this phase cannot execute until Phases 8, 9, and 10 are complete, per the roadmap's explicit dependency chain. This research is being produced ahead of that sequencing and should be re-validated against the actual repo state (file layout, message-protocol names, Phase 10's matching helper) at plan/execute time.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (project standard — `web/package.json` already uses `vitest ^3.2.4`; `extension/` should match) |
| Config file | `extension/vitest.config.ts` (does not exist yet — Wave 0 gap) |
| Quick run command | `npm --prefix extension test -- --run generator capture` (once configured) |
| Full suite command | `npm --prefix extension test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| CAP-01 | Generated password (character mode) matches requested length/charset | unit | `vitest run generator/password.test.ts` | ❌ Wave 0 (port `web/src/lib/generator/password.test.ts`'s assertions into the extension's copy) |
| CAP-01 | Generated passphrase draws from EFF wordlist, correct word count | unit | `vitest run generator/password.test.ts` | ❌ Wave 0 |
| CAP-01 | `generate-request` background handler returns a string, never throws on valid input | unit (via `WxtVitest` + `@webext-core/fake-browser`) | `vitest run background/router.test.ts` | ❌ Wave 0 |
| CAP-02 | Submit-capture success heuristic classifies a scripted DOM fixture (form removed + no error) as "success" | unit (jsdom/happy-dom fixture) | `vitest run content/submit-capture.test.ts` | ❌ Wave 0 |
| CAP-02 | `capture.propose-save` with no existing match returns `{action:'new'}` | unit | `vitest run background/capture-handler.test.ts` | ❌ Wave 0 |
| CAP-03 | `capture.propose-save` with an origin+username match and a differing password returns `{action:'update', itemId, currentRevision}` | unit | `vitest run background/capture-handler.test.ts` | ❌ Wave 0 |
| CAP-03 | Same password resubmitted returns `{action:'no-op'}` (Pitfall B) | unit | `vitest run background/capture-handler.test.ts` | ❌ Wave 0 |
| ROADMAP SC#4 (D-06) | `frameOrigin !== topOrigin` triggers an explicit mismatch flag in the response payload | unit | `vitest run background/capture-handler.test.ts` | ❌ Wave 0 |
| ROADMAP SC#4 (D-06) | Adversarial cross-origin iframe manual UAT — a form embedded in a cross-origin iframe on a throwaway test page shows the mismatch warning before any save | manual-only (justified: requires a real cross-origin iframe + real browser extension load, not reproducible in jsdom) | — (Playwright UAT fixture recommended, see `.playwright-mcp/uat-fixtures/`) | ❌ Wave 0 — add a fixture HTML page with a cross-origin `<iframe>` login form |

### Sampling Rate
- **Per task commit:** `npm --prefix extension test -- --run <touched-module>`
- **Per wave merge:** `npm --prefix extension test`
- **Phase gate:** Full suite green before `/gsd-verify-work`, plus the manual adversarial-iframe UAT case (D-06 requires this explicitly, not just automated coverage)

### Wave 0 Gaps
- [ ] `extension/vitest.config.ts` + `WxtVitest` plugin wiring — none exists yet (extension project itself doesn't exist)
- [ ] `@webext-core/fake-browser` install as devDependency
- [ ] Port `web/src/lib/generator/password.test.ts`'s test cases into `extension/lib/generator/password.test.ts`
- [ ] A cross-origin iframe UAT fixture page (HTML, two origins) for the D-06 adversarial test case — recommend adding under `.playwright-mcp/uat-fixtures/` matching the project's existing UAT-fixture convention

*(These gaps are expected — Phase 8 is responsible for the base `extension/` scaffold and its own `vitest.config.ts`; Phase 11 only needs to extend it with the generator/capture-specific test files listed above.)*

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|----------------|---------|--------------------|
| V2 Authentication | No (this phase touches no auth ceremony — that's Phase 12) | — |
| V3 Session Management | Yes | Reuses Phase 9's `chrome.storage.session`-held unlocked-key envelope; every `capture.*`/`generate-request` handler must re-read it at call time rather than assume in-memory survival (Pitfall 3) |
| V4 Access Control | Yes | Background must independently derive origin/frame trust from `sender.tab`/`sender.frameId` (browser-supplied, tamper-proof) rather than trusting content-script-self-reported origin fields in the message payload (D-06, Anti-Pattern 3) |
| V5 Input Validation | Yes | The `lib/messaging/ext-protocol.ts` typed schemas validate every new message kind's shape before the background handler acts on it; treat any message the schema rejects as a no-op, never a throw that could crash the router |
| V6 Cryptography | Yes | `encryptItem`/`pv-wasm` only — never a second, hand-rolled encryption path for the captured login item (Don't Hand-Roll table) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Forged `capture.propose-save`/`capture.confirm-save` message claiming a different origin than the page's actual origin | Spoofing | Background derives `topOrigin` from `sender.tab.url` (tamper-proof), never trusts the content script's self-reported `frameOrigin` alone for the security-relevant display copy (D-06) |
| Cross-origin iframe silently capturing/saving a login attributed to the wrong site (historical Bitwarden CVE-class bug, PITFALLS.md Pitfall 7) | Spoofing / Information Disclosure | Explicit mismatch warning + extra confirm step whenever `frameOrigin !== topOrigin`; never silently attribute a save to the top-level origin when the form's own frame differs |
| A page racing the "success heuristic" by rapidly re-rendering its DOM to trigger a false-positive save-prompt before the user has actually authenticated | Tampering | The success heuristic requires *absence* of an error signal AND a DOM/URL change within the observation window — a page can force a DOM mutation but the save/update is still gated behind an explicit user confirm click (Anti-Pattern: "Auto-saving on a heuristic without a user-confirm step") |
| Replay of a stale `capture.confirm-save` after the underlying item was already updated elsewhere (multi-device sync race) | Tampering | Reuse the existing `updateVaultItem`'s revision-conflict handling (`RevisionConflictError` on a 409) — the background capture handler must treat a 409 from `updateItem` the same way `web/src/lib/vault/store.ts` already does: refetch, surface a conflict message, never silently overwrite |

## Sources

### Primary (HIGH confidence)
- `web/src/lib/generator/password.ts`, `strength.ts`, `wordlist.ts` — read directly, confirms pure-TS/Web-Crypto generator with no pv-core/WASM dependency `[VERIFIED: codebase]`
- `web/src/lib/vault/store.ts` (`createVaultItem`, `updateVaultItem`, `RevisionConflictError`) — read directly, confirms exact encrypt-then-REST persistence pattern to replicate in background `[VERIFIED: codebase]`
- `web/src/lib/vault/api.ts`/`types.ts` — read directly, confirms `createItem`/`updateItem` REST contract and `LoginFields` shape `[VERIFIED: codebase]`
- `.planning/research/{SUMMARY,ARCHITECTURE,STACK,FEATURES,PITFALLS}.md` — completed same-day v0.2 milestone research, already citing Chrome for Developers/MDN/W3C/Bitwarden primary sources `[CITED — inherited from prior research pass]`
- `.planning/phases/11-generate-capture/11-CONTEXT.md` — locked decisions D-01 through D-09, phase boundary, discretion areas `[project source of truth]`
- [Unit Testing — WXT](https://wxt.dev/guide/essentials/unit-testing) — `WxtVitest` plugin, `@webext-core/fake-browser` usage pattern `[CITED]`
- `gsd-tools query package-legitimacy check` — verified `@webext-core/fake-browser` (OK), `wxt`/`@wxt-dev/browser` ("too-new" false-positive, pre-existing Phase 8 deps) `[VERIFIED: npm registry via package-legitimacy seam]`

### Secondary (MEDIUM confidence)
- [@webext-core/fake-browser — npm](https://www.npmjs.com/package/@webext-core/fake-browser) — corroborates download count / maintenance signal
- [Bitwarden — cross-origin iframe autofill CVE-class bug](https://www.techspot.com/news/97951-bitwarden-password-manager-browser-extension-has-known-exploit.html) — already cited in `.planning/research/PITFALLS.md`, reused here for D-06's rationale

### Tertiary (LOW confidence)
- None new to this phase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new external dependency beyond a devDependency already validated via the package-legitimacy seam; all core logic is a direct, verified port/reuse of existing codebase files
- Architecture: MEDIUM-HIGH — the message-passing/tier split is directly inherited from the already-researched milestone ARCHITECTURE.md; the exact file layout is an assumption (A2) since Phases 8-10 have not executed yet
- Pitfalls: MEDIUM-HIGH — grounded in the milestone-wide PITFALLS.md plus this phase's own codebase-verified integration points; the AJAX-success-heuristic timing threshold (A1) is explicitly left as an empirical UAT tuning parameter, not a hard spec

**Research date:** 2026-07-14
**Valid until:** 30 days, OR immediately upon Phase 8/9/10 actually landing (re-verify Open Questions #1-2 and Assumption A2/A3/A4 against the real repo state before/at Phase 11 plan time)
