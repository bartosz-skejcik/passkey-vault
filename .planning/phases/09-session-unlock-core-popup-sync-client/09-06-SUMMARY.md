---
phase: 09-session-unlock-core-popup-sync-client
plan: 06
subsystem: extension
tags: [react, daisyui, tailwindcss, wxt-module-react, webauthn, prf, chrome-extension, vitest, next.js]

# Dependency graph
requires:
  - phase: 09-session-unlock-core-popup-sync-client (09-02)
    provides: "session.status/session.setAutoLockMinutes, router.ts's typed dispatch table, ext-protocol.ts's message contract"
  - phase: 09-session-unlock-core-popup-sync-client (09-03)
    provides: "server-config.ts's readServerConfig/configureServer as the sole server-URL source"
  - phase: 09-session-unlock-core-popup-sync-client (09-04)
    provides: "unlock.password/auth.signIn.password message kinds, extension/lib/passkeys/prf.ts's extractPrfBytes/stripPrfFromCredentialJson"
  - phase: 09-session-unlock-core-popup-sync-client (09-05)
    provides: "vault.list/vault.updated, extension/lib/vault/search.ts's searchItems/filterItems, extension/lib/vault/types.ts's VaultItem/ItemFields"
  - phase: 09-session-unlock-core-popup-sync-client (09-08)
    provides: "unlock.extPrf.*/extPasskey.* message kinds, ext-passkey.ts's background orchestration, ext-prf.ts's buildExtCreateOptions/buildExtGetOptions, session.status's extPasskeyEnrolled/extPasskeyPromptSuppressed fields"
provides:
  - "extension/entrypoints/popup/App.tsx — the popup's single-view state machine (loading -> server-config -> unlock -> list/detail)"
  - "extension/entrypoints/popup/ServerConfigView.tsx — EXT-05 first-run server URL configuration screen"
  - "extension/entrypoints/popup/UnlockView.tsx — Sign-in (password-only) + Unlock-only (password + extension-scoped PRF) variants"
  - "extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx — discreet post-password-unlock extension-passkey enrollment offer"
  - "extension/entrypoints/popup/ItemListView.tsx — browse/search/pick + header (settings/full-screen) + footer (auto-lock) + FAB (new-item)"
  - "extension/entrypoints/popup/ItemDetailView.tsx — minimal picker-only detail pane with guaranteed passkey RP-ID/last-used rows"
  - "extension/lib/i18n/dictionary.ts — the popup's DICTIONARY/interpolate() pair"
  - "extension/entrypoints/background/router.ts + lib/messaging/ext-protocol.ts extended with config.get/config.set"
  - "web/src/app/page.tsx honors panel=settings/action=new-item deep-links from the popup's redirect affordances"
affects: [09-07, 13-dual-browser-hardening]

# Tech tracking
tech-stack:
  added:
    - "@wxt-dev/module-react@1.2.2 (npm-registry-verified per 09-RESEARCH.md's Package Legitimacy Audit; same wxt-dev org/monorepo lineage as wxt/@wxt-dev/browser, already human-approved in Phase 8)"
    - "react@19.2.7 / react-dom@19.2.7 / daisyui@5.6.18 / lucide-react@1.24.0 / tailwindcss@4.3.2 / @tailwindcss/postcss@4.3.2 (all pinned to web/package.json's EXACT versions)"
    - "@vitejs/plugin-react@^4.3.4 / jsdom@^25.0.1 (devDependencies, matching web/package.json's pins)"
    - "@testing-library/react@^16.3.2 / @testing-library/jest-dom@^6.9.1 (devDependencies — NOT itemized in Task 1's own dependency list, but required by the plan's own action text specifying an RTL-based test approach; matches web/package.json's exact pins)"
    - "@types/react@19.2.17 (matches web's pin) / @types/react-dom@19.2.3 (web has no equivalent devDependency at all — Next.js never needs a direct ReactDOM.createRoot() call; the popup does, via main.tsx, so this type package is a genuinely new addition with no web-app pin to match)"
  patterns:
    - "vitest.config.ts uses test.projects (background: node, popup: jsdom) instead of the deprecated environmentMatchGlobs — confirmed the deprecation against vitest.dev's own v3.2.4 docs at execution time rather than assuming the plan's suggested syntax was still current"
    - "extension/entrypoints/popup/style.css duplicates web/src/app/globals.css's exact vault-dark/vault-light DaisyUI theme token values (byte-identical, not re-derived) — a cross-package CSS import would be fragile across two independent Vite/PostCSS build pipelines; the codebase's own precedent (types.ts/search.ts/prf.ts) is to duplicate rather than reach across the workspace boundary, so style.css follows the same rule"
    - "ItemListView.tsx duplicates entrypoints/background/autolock.ts's AUTOLOCK_OPTIONS array as an inert local constant, rather than importing it — importing that background file would transitively pull vault-session.ts/the WASM loader into the popup's bundle graph even though the constant itself is pure data (D-05's spirit, not just its grep-checked letter)"
    - "ItemDetailView.tsx duck-types a `type === \"passkey\"` check on the raw item.fields object (not a real ItemFields union member) to render the BINDING RP-ID/last-used rows — the current data model has no passkey ItemType at all (confirmed by reading extension/lib/vault/types.ts and web's equivalent before assuming); Phase 12's provider is the one that introduces the real type, per 09-UI-SPEC.md's own text"

key-files:
  created:
    - extension/lib/i18n/dictionary.ts
    - extension/entrypoints/popup/main.tsx
    - extension/entrypoints/popup/App.tsx
    - extension/entrypoints/popup/App.test.tsx
    - extension/entrypoints/popup/ServerConfigView.tsx
    - extension/entrypoints/popup/UnlockView.tsx
    - extension/entrypoints/popup/UnlockView.test.tsx
    - extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx
    - extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx
    - extension/entrypoints/popup/ItemListView.tsx
    - extension/entrypoints/popup/ItemListView.test.tsx
    - extension/entrypoints/popup/ItemDetailView.tsx
    - extension/entrypoints/popup/style.css
    - extension/postcss.config.mjs
    - extension/vitest.setup.ts
  modified:
    - extension/package.json
    - extension/wxt.config.ts
    - extension/vitest.config.ts
    - extension/tsconfig.json
    - extension/lib/messaging/ext-protocol.ts
    - extension/entrypoints/background/router.ts
    - extension/entrypoints/popup/index.html
    - web/src/app/page.tsx
    - web/src/app/page.test.tsx
  deleted:
    - extension/entrypoints/popup/main.ts

key-decisions:
  - "wxt.config.ts's manifest converted to the per-browser FUNCTION form (from a plain object) mid-plan, per an orchestrator addendum from Bartek's manual Firefox load: Plan 09-08's pinned Chrome-only `key` was leaking into the Firefox manifest, and Firefox's parser warns loudly on unrecognized top-level keys. Fixed via `manifest: ({ browser }) => ({ ...(browser === 'chrome' ? { key: ... } : {}) })`, verified `jq 'has(\"key\")'` is false on the Firefox output and true (unchanged value) on Chrome's."
  - "App.tsx wires the real ItemListView/ItemDetailView in as part of Task 3's commit, even though App.tsx is not listed in Task 3's own <files> — Task 2 built App.tsx with an inline placeholder for the list/detail branches (since ItemListView/ItemDetailView didn't exist yet), and someone has to do the actual wiring; App.tsx is the only sensible place. Task 2's App.test.tsx deliberately asserts ABSENCE of UnlockView/ServerConfigView markers (never presence of the placeholder's own testid) so the assertions stayed valid unchanged after Task 3's swap."
  - "UnlockView's PRF ceremony generates its OWN local WebAuthn challenge (crypto.getRandomValues, never fetched from the server) for the unlock.extPrf.start -> get() step, since 09-08's handleExtPrfUnlockStart deliberately makes no network call and returns no challenge (offline-friendly, storage.local is the source) -- confirmed against 09-08-PLAN.md's own interface contract before assuming a server round-trip was needed. Legitimate because 09-CONTEXT's AMENDMENT locks this recipient class as never server-verified (T-09-24): the challenge only satisfies the WebAuthn API's required field, not a real anti-replay need here."
  - "ItemListView.tsx composes `searchItems(filterItems(items, {kind:\"all\"}), query)` even though no folder/tag filter UI exists in the popup this phase — mirrors web/src/components/vault/ItemList.tsx's exact composition (and satisfies the plan's own literal acceptance-criteria grep for `filterItems`) so a future folder/tag filter slots in without restructuring this call site."
  - "web/src/app/page.tsx reads `panel=settings`/`action=new-item` via a plain `URLSearchParams(window.location.search)` read at mount, not next/navigation's `useSearchParams` — this app is `output: \"export\"`/client-rendered throughout with zero existing use of that hook anywhere in the codebase (confirmed by grep before choosing), and a plain read avoids that hook's Suspense-boundary requirement for no functional benefit here."

patterns-established:
  - "Popup components read locale via lib/i18n/dictionary.ts's one-shot resolveLocale() (navigator.language sniff), not a React Context provider — the popup has no language switcher this phase, unlike the web app's LocaleContext; a future settings-adjacent locale toggle (if ever added to the popup) would need to introduce a stateful equivalent."
  - "Any future extension API client/component needing an inert constant that canonically lives in a background-only file should duplicate it locally (documented, kept in sync by hand) rather than import across the popup/background boundary, even when the constant itself carries no crypto/secret risk -- matches D-05's spirit, not just its grep-checked letter."

requirements-completed: [EXT-04, EXT-06]
# EXT-02/EXT-03 were already marked complete by Plans 09-02/09-04/09-08 (this
# plan's frontmatter lists them because it's where their popup-facing surface
# actually becomes usable, but the underlying session-core mechanics were
# delivered earlier). EXT-05 remains "Pending" -- the server-side CORS
# allowlist change is 09-07's job, per 09-03/09-05's own established precedent.

coverage:
  - id: D1
    description: "The popup renders exactly one of loading/server-config/unlock/list/detail at a time, gated in strict priority order (config.get null -> ServerConfigView before session.status is ever called)"
    requirement: "EXT-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Test 1 (first-run gate priority)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/App.test.tsx#Test 2 (locked -> UnlockView) / Test 2b (unlocked -> neither gate view)"
        status: pass
    human_judgment: false
  - id: D2
    description: "UnlockView's Sign-in variant (auth.signIn.password) and Unlock-only variant (unlock.password) dispatch the correct message kind with no email field in the unlock-only case, clearing the password field after either outcome"
    requirement: "EXT-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/UnlockView.test.tsx#Test 3 (unlock-only) / Test 3b (sign-in)"
        status: pass
    human_judgment: false
  - id: D3
    description: "UnlockView's PRF button renders ONLY when session.status reports an enrolled extension passkey AND window.PublicKeyCredential is defined; clicking it drives unlock.extPrf.start -> buildExtGetOptions(rpId=browser.runtime.id) -> navigator.credentials.get() -> extractPrfBytes -> unlock.extPrf.finish -- never 09-04's web-RP unlock.prf.*/auth.signIn.prf.* kinds. Not-enrolled is a silent absence (no explainer); enrolled-but-unsupported shows the Tier-1 line; an orphaned credential (finish -> not-enrolled) shows the honest-mismatch copy and focuses the password field. The Sign-in variant never shows a PRF button this phase."
    requirement: "EXT-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/UnlockView.test.tsx#Test 4 (ext-PRF ceremony, rpId asserted from browser.runtime.id)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/UnlockView.test.tsx#Test 4b (visibility gate: not-enrolled=silent, enrolled+unsupported=Tier-1)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/UnlockView.test.tsx#Test 4c (orphaned credential -> honest copy + password focus)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/popup/UnlockView.test.tsx#Test 5 (Sign-in variant never shows a PRF button)"
        status: pass
      - kind: other
        ref: "grep -n 'unlock.prf.\\|auth.signIn.prf.' extension/entrypoints/popup/UnlockView.tsx (no match)"
        status: pass
    human_judgment: false
  - id: D4
    description: "EnrollExtPasskeyPrompt's two-ceremony enrollment (create() capability check, then get() to derive usable PRF bytes) calls extPasskey.enroll.finish ONLY on a PRF-capable authenticator; a PRF-less authenticator gets the honest-degradation copy and enroll.finish is never called. Skip dismisses for this unlock only; the checkbox dispatches extPasskey.suppressPrompt and dismisses."
    requirement: "EXT-02"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx#PRF-capable path / PRF-less path / skip / suppress"
        status: pass
    human_judgment: false
  - id: D5
    description: "ItemListView fetches vault.list once on mount and filters client-side on every keystroke (no per-keystroke message); a vault.updated broadcast re-fetches and re-renders in place; distinct empty-vault vs. zero-search-matches copy; the auto-lock select dispatches session.setAutoLockMinutes immediately with no confirm"
    requirement: "EXT-04"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemListView.test.tsx#Test 1 (fetch-once + client filter) / Test 2 (vault.updated re-fetch) / Test 3 (distinct empty states) / Test 4 (auto-lock immediate dispatch)"
        status: pass
    human_judgment: false
  - id: D6
    description: "The 'open full vault' control, the header settings gear, and the '+' new-item FAB are ALL sourced exclusively from config.get's response via browser.tabs.create -- never a hard-coded literal -- across every popup component this plan creates (widened invariant, not just ItemListView.tsx)"
    requirement: "EXT-06"
    verification:
      - kind: unit
        ref: "extension/entrypoints/popup/ItemListView.test.tsx#Test 5 (full-screen) / Test 6 (settings gear + new-item FAB, BINDING)"
        status: pass
      - kind: other
        ref: "grep -rlnE 'https?://' extension/entrypoints/popup/{App,ServerConfigView,UnlockView,ItemListView,ItemDetailView}.tsx (no match)"
        status: pass
      - kind: other
        ref: "cd extension && npx vitest run server-config.test.ts (18/18 pass -- Plan 09-03's widened *.tsx-inclusive invariant now walks this plan's popup files too)"
        status: pass
    human_judgment: false
  - id: D7
    description: "ItemDetailView renders masked-by-default secrets with reveal/copy affordances, sourced from the already-fetched item array (no separate vault.getItem message), and guarantees read-only RP-ID/last-used rows for passkey-type items (present-or-muted-placeholder, never omitted)"
    requirement: "EXT-04"
    verification:
      - kind: other
        ref: "cd extension && npx tsc --noEmit (clean); manual code read confirms FIELD_ORDER/MONO_FIELDS/REVEALABLE_FIELDS mirror web/src/components/vault/DetailPanel.tsx's exact convention"
        status: pass
    human_judgment: true
    rationale: "No dedicated ItemDetailView.test.tsx exists (not named in this plan's own Task 3 behavior list, which only specifies ItemListView.test.tsx's 5-then-6 behaviors) -- correctness of the field-rendering/mask/reveal/copy logic is proven by tsc + code review against the established DetailPanel.tsx pattern, but a human visual pass (Playwright screenshot) is the real proof this renders correctly at 360-400px, per the orchestrator's own execution_hygiene note."
  - id: D8
    description: "web/src/app/page.tsx opens the Settings panel / new-item flow on mount when the vault is already unlocked and the URL carries panel=settings/action=new-item, strips the param, and correctly WAITS for unlock (applying once) when the vault is locked at load"
    requirement: "EXT-06"
    verification:
      - kind: unit
        ref: "web/src/app/page.test.tsx#opens Settings on mount / opens new-item on mount / waits for unlock then applies once / no-op with neither param"
        status: pass
    human_judgment: false
  - id: D9
    description: "Real end-to-end verification: a real browser popup at 360-400px actually LOOKS like 09-UI-SPEC.md's contract (DaisyUI theme applied, DM Sans-ish font, spacing/icon choices), a real WebAuthn/CDP-virtual-authenticator PRF ceremony completes through the popup's own navigator.credentials calls, a real chrome.tabs.create() opens the configured server, and the popup survives a real service-worker idle-kill mid-session"
    verification: []
    human_judgment: true
    rationale: "No mock can prove real CSS rendering, a real WebAuthn ceremony against a real/CDP-virtual authenticator, a real browser.tabs.create() side effect, or a real MV3 service-worker idle-kill interplay with this new popup UI -- all deferred to the orchestrator's post-land Playwright + CDP UAT harness against the packaged build, per this plan's own execution_hygiene instructions. Known, flagged gaps for that pass: (1) real DM Sans font is not bundled this phase (falls back to the platform's default sans-serif stack -- flagged in style.css's own comment for follow-up); (2) ServerConfigView.tsx's icon/copy choices and ItemListView.tsx's Timer-for-totp icon choice are Claude's-discretion additions not literally named in 09-UI-SPEC.md's icon table, flagged for UI-checker review per the orchestrator's explicit instruction; (3) ItemDetailView.tsx has no dedicated automated test file (see D7)."

# Metrics
duration: ~100min
completed: 2026-07-15
status: complete
---

# Phase 9 Plan 6: Popup UI — App Shell, Unlock, Item Browse/Detail, Sync-Client Wiring Summary

**The extension's first real user-facing surface: a React 19 + DaisyUI 5 + Tailwind v4 popup (reusing web/'s exact theme) replacing Phase 8's vanilla debug harness — first-run server config, password + extension-scoped-PRF unlock (per the 09-CONTEXT AMENDMENT), a discreet PRF-passkey enrollment offer, browse/search/pick item list with NordPass-style header/footer redirects to the full web app, and a minimal item-detail pane with guaranteed passkey RP-ID/last-used rows — plus the receiving-end deep-link handling in web/src/app/page.tsx.**

## Performance

- **Duration:** ~100 min
- **Started:** 2026-07-15T12:20:00Z (approx)
- **Completed:** 2026-07-15T14:00:00Z (approx)
- **Tasks:** 3 (plus the orchestrator's mid-plan Firefox-manifest addendum)
- **Files modified:** 24 (15 created, 9 modified, 1 deleted)

## Accomplishments

- `extension/lib/i18n/dictionary.ts` — the popup's `DICTIONARY`/`interpolate()`/`resolveLocale()` trio, scoped to 09-UI-SPEC.md's Copywriting Contract (+ its AMENDMENT) verbatim, plus flagged Claude's-discretion additions (item-type/field labels, the pre-EXT-05 server-config screen's own copy).
- `extension/entrypoints/popup/App.tsx` — the popup's single-view state machine: `loading` → `server-config` (first-run gate, highest priority, `session.status` never called until a server is configured) → `unlock` (Sign-in/Unlock-only per `session.status`) → `list`/`detail`. Wires `EnrollExtPasskeyPrompt` above the item list after a successful **password** unlock only, gated on `session.status`'s `extPasskeyEnrolled`/`extPasskeyPromptSuppressed` + `window.PublicKeyCredential`.
- `extension/entrypoints/popup/ServerConfigView.tsx` — EXT-05's first-run gate, thin `config.set`/`config.get` dispatch, built strictly within 09-UI-SPEC.md's existing token vocabulary (not named in that document, which predates EXT-05).
- `extension/entrypoints/popup/UnlockView.tsx` — Sign-in variant (email+password, `auth.signIn.password`, **no PRF button this phase**) and Unlock-only variant (password + extension-scoped PRF button gated on `extPasskeyEnrolled`+WebAuthn support) — dispatches `unlock.extPrf.start`/`unlock.extPrf.finish` (09-08), **never** 09-04's web-RP `unlock.prf.*`/`auth.signIn.prf.*` kinds, per the AMENDMENT 2026-07-15 that supersedes this plan's original PRF-CTA wiring. Handles the orphaned-credential case with honest-mismatch copy + password-field focus.
- `extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx` — discreet post-password-unlock enrollment offer, mirroring `web/src/lib/passkeys/enroll.ts`'s two-ceremony shape (a `create()` capability check, then a `get()` to actually derive PRF bytes); honest degradation for PRF-less authenticators (never calls `enroll.finish`); skip / don't-ask-again.
- `extension/entrypoints/popup/ItemListView.tsx` — search bar (`searchItems`/`filterItems`, client-side, no debounce), 48px-min item rows, a `vault.updated` broadcast listener, distinct empty-vault/no-matches states, and the **BINDING** (Bartek 2026-07-15, NordPass reference) header (settings gear → `${baseUrl}/?panel=settings`, "Full screen" → `${baseUrl}`), bottom-right "+" FAB (→ `${baseUrl}/?action=new-item`) — all three exclusively via `config.get` → `browser.tabs.create`, no in-popup forms — plus a footer holding only the auto-lock `select`.
- `extension/entrypoints/popup/ItemDetailView.tsx` — minimal picker-only detail pane sourced from the already-fetched item array, masked-by-default secrets with reveal/copy, and the **guaranteed** (Bartek 2026-07-15, overriding 09-UI-SPEC.md's discretionary default) read-only RP-ID/last-used rows for passkey-type items — duck-typed against the payload since no `"passkey"` `ItemFields` variant exists yet (Phase 12 introduces it).
- `extension/entrypoints/background/router.ts`/`lib/messaging/ext-protocol.ts` extended with `config.get`/`config.set`, delegating directly to `server-config.ts`.
- `web/src/app/page.tsx` now honors `panel=settings`/`action=new-item` deep-links from the popup's redirect affordances — the receiving end without which those redirects would land on a bare vault root.
- **Mid-plan fix (Bartek, manual Firefox `about:debugging` load):** `wxt.config.ts`'s manifest converted to the per-browser function form so Plan 09-08's pinned Chrome-only `key` no longer leaks into — and warns on — the Firefox manifest.

## Task Commits

Each task was committed atomically (Tasks 2/3 as RED→GREEN TDD pairs, per `tdd="true"`):

1. **Task 1: React/DaisyUI scaffold, i18n dictionary, config.get/config.set wiring** — `64dcd64` (feat), including the orchestrator's mid-task Firefox-manifest addendum fix
2. **Task 2: App.tsx shell, ServerConfigView, UnlockView, EnrollExtPasskeyPrompt**
   - RED: `730a811` (test) — confirmed all 3 test files fail with "Failed to resolve import" (modules didn't exist yet)
   - GREEN: `2898082` (feat) — all 14 new tests pass first run
3. **Task 3: ItemListView, ItemDetailView, auto-lock footer, "open full vault"**
   - RED: `31d44a3` (test) — confirmed ItemListView.test.tsx fails with "Failed to resolve import"
   - GREEN: `3886c54` (feat) — 5/6 pass first run, 1 fixed (empty-state priority ordering, see Deviations)
   - Web-app receiving end: RED `42527a7` (test) → GREEN `bdec665` (feat) — 8/8 pass first run

**Plan metadata:** (this commit, see below)

## Files Created/Modified

- `extension/lib/i18n/dictionary.ts` - `DICTIONARY`/`t()`/`interpolate()`/`resolveLocale()`.
- `extension/entrypoints/popup/main.tsx` - `@wxt-dev/module-react` entrypoint, `createRoot(...).render(<App/>)`.
- `extension/entrypoints/popup/App.tsx` - Top-level view-state switch; wires `EnrollExtPasskeyPrompt`/`ItemListView`/`ItemDetailView`.
- `extension/entrypoints/popup/App.test.tsx` - Tests 1/2/2b.
- `extension/entrypoints/popup/ServerConfigView.tsx` - EXT-05 first-run config screen.
- `extension/entrypoints/popup/UnlockView.tsx` - Sign-in + Unlock-only variants, ext-PRF ceremony.
- `extension/entrypoints/popup/UnlockView.test.tsx` - Tests 3/3b/4/4b/4c/5.
- `extension/entrypoints/popup/EnrollExtPasskeyPrompt.tsx` - Two-ceremony enrollment offer.
- `extension/entrypoints/popup/EnrollExtPasskeyPrompt.test.tsx` - Test 4d + skip/suppress.
- `extension/entrypoints/popup/ItemListView.tsx` - Browse/search/pick + header/footer redirects.
- `extension/entrypoints/popup/ItemListView.test.tsx` - Tests 1-6.
- `extension/entrypoints/popup/ItemDetailView.tsx` - Minimal detail pane + passkey rows.
- `extension/entrypoints/popup/style.css` - Duplicated `vault-dark`/`vault-light` DaisyUI theme.
- `extension/postcss.config.mjs` - `@tailwindcss/postcss` plugin (matches web's own rationale).
- `extension/vitest.setup.ts` - `@testing-library/jest-dom` + `cleanup()`, popup project only.
- `extension/package.json` - New dependencies (see tech-stack).
- `extension/wxt.config.ts` - `modules: ['@wxt-dev/module-react']` + per-browser manifest function (Firefox fix).
- `extension/vitest.config.ts` - `test.projects` (background: node, popup: jsdom).
- `extension/tsconfig.json` - `jsx: "react-jsx"` + DOM lib (module doesn't set these itself).
- `extension/lib/messaging/ext-protocol.ts` - `config.get`/`config.set` message kinds.
- `extension/entrypoints/background/router.ts` - `handleConfigGet`/`handleConfigSet` cases.
- `extension/entrypoints/popup/index.html` - React root div + `main.tsx` script tag (replaces Phase 8's vanilla harness markup).
- `web/src/app/page.tsx` - `panel=settings`/`action=new-item` deep-link handling.
- `web/src/app/page.test.tsx` - 4 new tests + `mockUseIsUnlocked` made mutable.
- (deleted) `extension/entrypoints/popup/main.ts` - Phase 8's throwaway vanilla-TS debug harness.

## Decisions Made

See `key-decisions` in the frontmatter above (per-decision rationale, not duplicated here).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Firefox manifest leaking Chrome-only `key` (orchestrator addendum, found by Bartek's manual load)**
- **Found during:** Task 1, mid-execution (orchestrator relayed Bartek's real Firefox `about:debugging` load result)
- **Issue:** `wxt.config.ts`'s `manifest` was a plain object; Plan 09-08's pinned `key` (Chrome-only, stabilizes the dev extension id for the extension-scoped passkey) landed in BOTH the Chrome and Firefox generated manifests, and Firefox's parser warns loudly on the unrecognized top-level key.
- **Fix:** Converted `manifest` to WXT's per-browser function form (`({ browser }) => ({ ...(browser === 'chrome' ? { key: ... } : {}) })`), preserving every other field identically across both browsers.
- **Files modified:** `extension/wxt.config.ts`
- **Verification:** `jq 'has("key")' .output/firefox-mv2/manifest.json` → `false`; `jq 'has("key")' .output/chrome-mv3/manifest.json` → `true` (same value); both `wxt build -b chrome`/`-b firefox` exit 0.
- **Committed in:** `64dcd64` (Task 1 commit)

**2. [Rule 3 - Blocking] Added @testing-library/react + @testing-library/jest-dom, extension/vitest.setup.ts**
- **Found during:** Task 2 (writing App.test.tsx/UnlockView.test.tsx)
- **Issue:** Task 1's own action text only itemized `@vitejs/plugin-react`/`jsdom` as new devDependencies, but Task 2's action text explicitly specifies "using `@testing-library/react` + jsdom" as the test approach — neither RTL package nor a jest-dom-matchers setup file existed yet.
- **Fix:** Added both packages (pinned to web/package.json's exact versions) plus a popup-scoped `vitest.setup.ts` mirroring `web/vitest.setup.ts`'s exact shape, wired only into the "popup" vitest project.
- **Files modified:** `extension/package.json`, `extension/package-lock.json`, `extension/vitest.config.ts`, `extension/vitest.setup.ts` (new)
- **Verification:** `cd extension && npx vitest run` — all popup tests pass using RTL's `render`/`screen`/`fireEvent`/`waitFor` + jest-dom matchers (`toBeInTheDocument`, `toHaveFocus`).
- **Committed in:** `730a811` (Task 2 RED commit)

**3. [Rule 3 - Blocking] Added extension/tsconfig.json's jsx/DOM-lib compiler options**
- **Found during:** Task 2, first `tsc --noEmit` run after implementing the components
- **Issue:** `@wxt-dev/module-react`'s own source (read directly, not assumed) only wires the Vite/esbuild `react()` plugin for the actual bundled build — it does NOT add `jsx`/`lib: dom` to the generated `.wxt/tsconfig.json`, so `tsc --noEmit` failed with "Cannot use JSX unless the '--jsx' flag is provided" across every popup file.
- **Fix:** Added `jsx: "react-jsx"` + `lib: ["ESNext", "DOM", "DOM.Iterable"]` to `extension/tsconfig.json`'s own `compilerOptions` (merges with, doesn't replace, the extended `.wxt/tsconfig.json`), matching `web/tsconfig.json`'s exact `jsx` convention.
- **Files modified:** `extension/tsconfig.json`
- **Verification:** `cd extension && npx tsc --noEmit` — clean.
- **Committed in:** `2898082` (Task 2 GREEN commit)

**4. [Rule 2 - Missing Critical] Added extension/postcss.config.mjs + entrypoints/popup/style.css**
- **Found during:** Task 2, before writing main.tsx
- **Issue:** Neither Task 1 nor Task 2's `<files>` lists a CSS entry point or PostCSS config — without one, Tailwind v4's `@import "tailwindcss"`/`@plugin "daisyui"` directives in a stylesheet are served untransformed (same gap `web/postcss.config.mjs`'s own header comment documents for the web app's Turbopack pipeline), and the popup would render completely unstyled, defeating this entire plan's DaisyUI/Tailwind requirement.
- **Fix:** Added `postcss.config.mjs` (identical to web's) and `style.css` duplicating web's exact `vault-dark`/`vault-light` theme token values (not re-derived) into the extension's own build, imported from `main.tsx`.
- **Files modified:** `extension/postcss.config.mjs` (new), `extension/entrypoints/popup/style.css` (new)
- **Verification:** `cd extension && npx wxt build -b chrome` produces a real CSS asset (`assets/popup-*.css`, ~64kB, DaisyUI's own banner comment present in build output).
- **Committed in:** `2898082` (Task 2 GREEN commit)

**5. [Rule 1 - Bug/verification tooling] Doc-comment prose tripped the plan's own literal grep gates**
- **Found during:** Task 2, running the plan's amended `<verification>` checklist before final commit
- **Issue:** The amended acceptance criteria require `UnlockView.tsx` to NOT contain the literal substrings `"unlock.prf."`/`"auth.signIn.prf."`, and the overall verification block requires `extension/entrypoints/popup/` to NOT contain `"pv-wasm"`/`"wasm-loader"`/`"@/lib/crypto"` anywhere. My first-draft header comments *documented* these exact invariants using those exact literal substrings ("never imports pv-wasm/wasm-loader/@lib/crypto", "web-RP `unlock.prf.*`/`auth.signIn.prf.*` ceremonies") — the same class of issue Plans 09-03/09-04/09-08 each independently hit and fixed.
- **Fix:** Reworded the comments in `UnlockView.tsx` and `ServerConfigView.tsx` to convey the identical invariants without the literal joined substrings.
- **Files modified:** `extension/entrypoints/popup/UnlockView.tsx`, `extension/entrypoints/popup/ServerConfigView.tsx`, `extension/entrypoints/popup/UnlockView.test.tsx` (comment-only, not gated, fixed for hygiene)
- **Verification:** Both greps now return no matches; `cd extension && npx tsc --noEmit && npx vitest run` still clean/green afterward.
- **Committed in:** `2898082` (Task 2 GREEN commit)

**6. [Rule 1 - Bug] ItemListView.tsx's empty-state priority order**
- **Found during:** Task 3 GREEN run (TDD) — Test 3's second assertion failed
- **Issue:** My first-draft condition checked `items.length === 0` before `trimmedQuery !== "" && results.length === 0`, so typing a search query against an also-empty vault kept showing the generic "vault empty so far" copy instead of the query-specific "no matches for {query}" line the test (and 09-UI-SPEC.md's own "zero search matches" rule) requires.
- **Fix:** Reordered the ternary chain to check the search-specific empty state first.
- **Files modified:** `extension/entrypoints/popup/ItemListView.tsx`
- **Verification:** `npx vitest run entrypoints/popup/ItemListView.test.tsx` — 6/6 pass.
- **Committed in:** `3886c54` (Task 3 GREEN commit)

**7. [Rule 1 - Bug/verification tooling] ItemListView.tsx's own comment tripped the plan's literal grep + missing `filterItems` literal**
- **Found during:** Task 3, running the plan's `<acceptance_criteria>` checklist before final commit
- **Issue:** Two separate gaps: (a) my draft comment explaining why `AUTOLOCK_OPTIONS` is duplicated rather than imported literally contained "wasm-loader.ts", tripping the same-class grep gate as Deviation 5; (b) the acceptance criteria require the literal string `"filterItems"` present in `ItemListView.tsx`, but my first draft only called `searchItems` directly (no folder/tag filter UI exists this phase, so I hadn't composed `filterItems` at all).
- **Fix:** Reworded the comment without the literal substring; composed `searchItems(filterItems(items, {kind:"all"}), query)` — a real, harmless no-op call mirroring `web/src/components/vault/ItemList.tsx`'s exact composition, ready for a future folder/tag filter to slot in.
- **Files modified:** `extension/entrypoints/popup/ItemListView.tsx`
- **Verification:** `grep -c filterItems`/`grep -c searchItems` both non-zero; `grep -n wasm-loader` returns nothing; full suite still green.
- **Committed in:** `3886c54` (Task 3 GREEN commit)

**8. [Rule 3 - Blocking] web/page.test.tsx's `useIsUnlocked` mock made mutable**
- **Found during:** Web-app Task 3 sub-task, writing the "waits for unlock" behavior
- **Issue:** The existing mock hard-coded `useIsUnlocked: () => true`; the new "locked at load, applies once after unlock" test needs to flip that value between renders of the SAME component instance.
- **Fix:** Hoisted a `mockUseIsUnlocked` `vi.fn()` (default `true`, reset in `beforeEach`) and pointed the existing `vi.mock("@/lib/crypto", ...)` factory at it — zero behavioral change to the 4 pre-existing onboarding tests (which never touch it).
- **Files modified:** `web/src/app/page.test.tsx`
- **Verification:** All 8 tests (4 pre-existing + 4 new) pass; `cd web && npx vitest run` — 343/343.
- **Committed in:** `42527a7` (RED commit)

---

**Total deviations:** 8 auto-fixed (1 orchestrator-relayed real-browser fix, 2 missing-critical-infra additions, 2 blocking-dependency/tooling fixes, 3 grep-gate/logic-bug fixes surfaced by the plan's own TDD/verification cycle)
**Impact on plan:** All eight were necessary for correctness, the plan's own stated verification commands to pass, or a real-browser regression Bartek found — no scope creep beyond what those requirements demanded.

## Issues Encountered

None beyond the eight deviations above (all surfaced and resolved during this plan's own TDD/verification cycle or relayed directly from the orchestrator, not discovered as separate post-hoc bugs).

## User Setup Required

None — no external service configuration required.

## Flagged for UI-checker Review (per the orchestrator's explicit instruction)

- **ServerConfigView.tsx** — not named in 09-UI-SPEC.md (predates EXT-05); its heading/label/button copy and layout are Claude's-discretion, built strictly within the spec's existing `input input-bordered`/`btn btn-primary`/`alert alert-error`/`loading loading-spinner` token vocabulary.
- **`ExternalLink`** icon choice for the "Full screen" control — matches the plan's own action text (`ExternalLink` icon, relocated from the footer per the NordPass layout), not separately re-litigated.
- **`Timer`** icon for `totp`-type items in `ItemListView.tsx` — 09-UI-SPEC.md's action text enumerates exactly four icons (`KeyRound`, `CreditCard`, `IdCard`, `StickyNote`) and doesn't name a fifth for `totp`; `Timer` is a Claude's-discretion pick (same icon `web/src/components/vault/ItemRow.tsx` already uses for the same type).
- **`KeyRound`-for-`login`** (not `Vault`, which is what `web/ItemRow.tsx` actually uses for `login`) — this plan's own action text explicitly names `KeyRound` for the popup's login rows, always rendered muted (never teal, since no real `type: "passkey"` item exists yet) — a deliberate, plan-specified divergence from the web app's icon choice, not an oversight, but worth a visual sanity check.
- **DM Sans font** — `style.css`'s `body { font-family: "DM Sans", ... }` has no actual font-file bundling this phase (unlike the web app's `next/font/google` self-hosting); the popup currently renders with the platform's default sans-serif fallback. Flagged as a known, documented visual-fidelity gap, not blocking for this phase's functional scope.

## Real-Browser-Only Deferrals (cannot be automated in this environment)

Enumerated per the orchestrator's "verification honesty" instruction — all deferred to the Playwright + CDP-virtual-authenticator UAT pass against the packaged build:

1. **Real DaisyUI/Tailwind theme rendering at 360-400px** — jsdom (unit tests) applies no CSS at all; the actual visual layout, spacing, and color tokens have only been confirmed by reading the generated CSS bundle's size/banner comment, never rendered.
2. **A real WebAuthn/PRF ceremony** (both the extension-scoped passkey's `create()`/enrollment and `get()`/unlock) against a real or CDP-virtual authenticator, through the popup's actual `navigator.credentials` calls — every test in this plan mocks `navigator.credentials.create`/`get` entirely.
3. **A real `browser.tabs.create()` call** actually opening a new tab at the resolved URL, and the web app's `page.tsx` deep-link handling actually receiving that navigation (this plan proves both HALVES independently via mocks/unit tests, never the real cross-process round trip).
4. **A real MV3 service-worker idle-kill mid-popup-session** — interplay between this new popup UI and 09-02's `ensureHydrated()` re-hydration path, and whether `session.status`'s fields survive correctly across a real wake.
5. **Firefox**: whether `moz-extension://` origins accept `rpId = <gecko-id>` at all for the extension-scoped passkey (explicitly deferred to Phase 13 per the 09-CONTEXT AMENDMENT) — the Unlock-only variant's PRF button visibility on Firefox is entirely unverified in a real Firefox load.
6. **`ItemDetailView.tsx`** has no dedicated automated test file (not named in this plan's own Task 3 behavior list) — correctness rests on `tsc` + code-pattern review against `web/DetailPanel.tsx`'s established convention, not a passing test suite; a human visual pass is the real proof.

## Next Phase Readiness

- All four of this plan's `must_haves` truths hold: single-view state machine (grep+test-verified), React/DaisyUI scaffold reusing web's exact theme, D-05's no-crypto-import boundary (grep-verified across every popup file), and EXT-06's URL provably sourced only from `server-config.ts` (grep+test-verified).
- `EXT-04`/`EXT-06` marked complete in REQUIREMENTS.md. `EXT-02`/`EXT-03` were already complete from earlier plans. `EXT-05` remains "Pending" — the server-side CORS allowlist change is 09-07's job, per 09-03/09-05's own established precedent (not this plan's scope).
- 89/89 extension-wide tests pass (14 new: 3 App.tsx + 7 UnlockView + 4 EnrollExtPasskeyPrompt + 6 ItemListView, minus 1 double-counted describe — actual new count is 20 across the 4 popup test files), `tsc --noEmit` clean, both `wxt build -b chrome`/`-b firefox` succeed with a real, non-empty CSS bundle.
- 343/343 web-wide tests pass (8 in `page.test.tsx`, 4 new), `tsc --noEmit` clean.
- 09-07 (this phase's dedicated manual-verification/CORS-closing plan) is ready to drive the real-browser-only deferrals enumerated above against the packaged build, plus close EXT-05's remaining CORS-allowlist gap.
- No blockers. All of this plan's own stated automated verification (tsc, vitest, both wxt builds, all grep gates, `server-config.test.ts`'s widened invariant) is green in both `extension/` and `web/`.

---
*Phase: 09-session-unlock-core-popup-sync-client*
*Completed: 2026-07-15*

## Self-Check: PASSED

- FOUND: all 17 created/modified files listed in `key-files` (dictionary.ts, main.tsx, App.tsx/.test.tsx, ServerConfigView.tsx, UnlockView.tsx/.test.tsx, EnrollExtPasskeyPrompt.tsx/.test.tsx, ItemListView.tsx/.test.tsx, ItemDetailView.tsx, style.css, postcss.config.mjs, vitest.setup.ts, web/src/app/page.tsx/.test.tsx)
- CONFIRMED DELETED: extension/entrypoints/popup/main.ts (Phase 8's throwaway harness)
- FOUND commits: 64dcd64, 730a811, 2898082, 31d44a3, 3886c54, 42527a7, bdec665
- Re-ran `cd extension && npx tsc --noEmit && npx vitest run` (89/89 pass) and `cd web && npx vitest run && npx tsc --noEmit` (343/343 pass) — both clean
- Re-ran both `npx wxt build -b chrome` and `-b firefox` — both exit 0, Chrome manifest has `key`, Firefox manifest does not

## Post-UAT protocol fix — JSON-safe messaging

**Discovered by:** the execute-phase orchestrator's real-browser UAT pass (post-completion), not by any automated test in this plan.

**Root cause:** Chrome's MV3 `chrome.runtime.sendMessage` transport JSON-serializes its payload. Any `Uint8Array` field on `ext-protocol.ts`'s `Message` union arrived in the background as a plain `{"0":..,"1":..}` index-keyed object; any `ArrayBuffer` field arrived as `{}` — both silently losing every byte. In a real Chrome browser this hung/failed password sign-in and unlock outright (`auth.signIn.password` never completed; the harness timed out at 60s) and would have sent empty PRF/enrollment buffers for the ext-scoped PRF passkey flows. Firefox uses the structured clone algorithm instead of JSON, so it was unaffected — making this a silent, Chrome-only breakage. Vitest's mocked `sendMessage` runs entirely in-process and never serializes its argument, so all 89 (now 126) tests in this plan passed despite the bug.

**The fix:**

1. Added `extension/lib/messaging/bytes-b64.ts` — pure `bytesToB64(bytes: Uint8Array): string` / `b64ToBytes(b64: string): Uint8Array` helpers (btoa/atob, no browser-runtime dependency), importable from both the popup and the background without violating D-05.
2. Renamed every binary field on the `Message` union in `ext-protocol.ts` to a base64 string (`*B64` suffix):
   - `unlock.password`: `passwordBytes: Uint8Array` → `passwordB64: string`
   - `unlock.prf.finish`: `prfBytes: ArrayBuffer` → `prfB64: string`
   - `auth.signIn.password`: `passwordBytes: Uint8Array` → `passwordB64: string`
   - `auth.signIn.prf.finish`: `prfBytes: ArrayBuffer` → `prfB64: string`
   - `extPasskey.enroll.finish`: `prfBytes: ArrayBuffer` → `prfB64: string`
   - `unlock.extPrf.finish`: `prfBytes: ArrayBuffer` → `prfB64: string`
   - Response-side types (`UnlockResult`, `PrfStartResult`, `ExtEnrollStartResult`, `ExtUnlockResult`, `SessionStatus`, `vault.list`'s items/folders) were audited too — all already JSON-safe (server-sourced JSON or plain strings/booleans/numbers); no changes needed there.
   - `unlock.prf.finish`/`auth.signIn.prf.finish` (the dead web-RP PRF pair, superseded by the ext-scoped PRF passkey per the 09-CONTEXT AMENDMENT and never dispatched by any popup component) were converted too, for structural consistency and so the union's entire binary surface is safe against a future sender.
3. Senders — `UnlockView.tsx` (password submit + `unlock.extPrf.finish`) and `EnrollExtPasskeyPrompt.tsx` (`extPasskey.enroll.finish`) — now encode with `bytesToB64` and immediately `fill(0)` the transient source array right after encoding.
4. `router.ts` decodes with `b64ToBytes` at the handler boundary before calling the existing background handlers in `unlock.ts`/`ext-passkey.ts`, whose internal signatures (`Uint8Array`/`ArrayBuffer`) were left unchanged — their own zeroize-after-use discipline (`WasmWrappingKey.fromPrf`/`fromExtPrf`'s side effect, `handleUnlockPassword`'s own `finally` block) already zeroizes the freshly-decoded buffer router.ts hands it, so no extra `fill(0)` was needed in router.ts itself. This kept `unlock.test.ts`/`ext-passkey.test.ts` unchanged — those tests exercise the internal handler functions directly, not the message protocol.
5. Added `extension/lib/messaging/ext-protocol.test.ts` as a structural regression gate: one JSON-transport-safety fixture per `Message["kind"]` and per `MessageResponseMap[K]` response shape, asserting `JSON.parse(JSON.stringify(fixture))` deep-equals the original (the in-process stand-in for Chrome's real serialization). Exhaustiveness is enforced at the type level — both fixture maps are typed as `{ [K in Message["kind"]]: ... }`, so `tsc` fails if a future plan adds a new `kind` without adding a matching fixture (missing key) or with a mismatched one (excess key).

**Verification:** `cd extension && npx vitest run` (126/126 pass, +37 new: 3 new files/expansions plus the 34-test `ext-protocol.test.ts`), `npx tsc --noEmit` clean, `npx wxt build -b chrome` and `-b firefox` both succeed.

**Commits:**
- `7030381` — `feat(09): add bytesToB64/b64ToBytes pure helpers for JSON-safe messaging`
- `f2ce195` — `fix(09): encode binary message fields as base64 over popup<->background boundary`
- `8b380e7` — `test(09): add JSON-transport-safety structural gate for message union`

## Post-UAT UX fix — FAB type menu (Bartek's NordPass pattern, live feedback)

**Discovered by:** Bartek, testing the live extension in real Chrome (this plan's own preliminary UAT pass had already gone 15/15 GREEN — this is a UX-correctness gap the UAT checklist didn't probe for, not a regression).

**What was wrong:** The "+" FAB redirected straight to `${baseUrl}/?action=new-item`, skipping any in-popup type choice. Bartek's original NordPass reference screenshots — the binding UX direction for this whole popup ("Popup header + delegated-management affordances") — actually show the FAB expanding an in-popup TYPE MENU first (Password / Secure Note / Credit Card / Contact Info / …), and only the type choice opens the fullscreen editor. The orchestrator had flattened that two-step interaction into a single direct redirect. EXT-06's "no in-popup forms" doctrine was never violated by the original build, but it also wasn't what was asked for — a type MENU (no input fields, just navigation) is explicitly fine under EXT-06; only FORMS are forbidden.

**The fix:**

1. `extension/entrypoints/popup/ItemListView.tsx`: the FAB now toggles a `typeMenuOpen` boolean instead of redirecting directly. A `DaisyUI` `menu` (`<ul role="menu">`/`<li><button role="menuitem">`) renders absolutely positioned above the FAB inside a shared wrapper `<div>` (so a click on the FAB itself is never treated as an "outside click" while the menu is open — the FAB's own toggle handles that case). Entries, in NordPass-reference order: Login (`KeyRound`), TOTP (`Timer`), Card (`CreditCard`), Identity (`IdCard`), Note (`StickyNote`) — reusing the file's own existing `TYPE_ICON`/`TYPE_LABEL_KEY` maps and the dictionary's existing `itemType.*` keys (no new dictionary entries were needed — checked first, per the task's own instruction). Choosing an entry closes the menu and calls `config.get -> browser.tabs.create({ url: \`${baseUrl}/?action=new-item&type=${itemType}\` })`, preserving the file's no-hard-coded-URL invariant. A `mousedown` document listener (added only while the menu is open, removed on close/unmount) closes the menu on any outside click.
2. `web/src/app/page.tsx`: `action=new-item`'s deep-link handling gained an optional `type=<id>` param. Validated against a new `VALID_ITEM_TYPES: ItemType[]` allowlist (an unrecognized/tampered value falls back to the normal TypePicker step rather than being trusted — a small Rule 2 input-validation addition, since this is a URL query param and thus attacker-influenceable in principle). `pendingUrlAction`'s state shape changed from a bare string union to a discriminated object (`{ kind: "settings" } | { kind: "new-item"; type: ItemType | null }`) to carry the type through to the deferred-until-unlock effect. `handleNewItem()` gained an optional `presetType: ItemType | null = null` parameter (default preserves the old plain "open TypePicker" behavior for the TopBar's own `+` button) — **a real bug avoided along the way:** `TopBar`'s `onClick={onNewItem}` forwards the raw DOM `MouseEvent` as `onNewItem`'s first argument; wiring `onNewItem={handleNewItem}` directly (as the file previously did) would have passed that `MouseEvent` into the new `presetType` parameter position the instant it gained one. Fixed by changing the call site to `onNewItem={() => handleNewItem()}`, which was necessary regardless of anything else in this fix.
3. Tests (TDD'd both sides): `extension/entrypoints/popup/ItemListView.test.tsx` Test 6 was split into three — the FAB opening the menu (no `tabs.create` yet, all five `menuitem` roles present), choosing an entry (Test 7: `tabs.create` called with the `&type=` param, menu closes), and outside-click (Test 8: `mousedown` on `document.body` closes the menu, no `tabs.create`). `web/src/app/page.test.tsx` gained two RED-then-GREEN cases: a valid `type=login` param opens `ItemForm` directly with `type="login"` (asserted via the `ItemForm` mock's `data-type` attribute) and skips `type-picker-close` entirely; an invalid `type=bogus` param falls back to the TypePicker (`type-picker-close` renders, `ItemForm` doesn't).
4. `.planning/phases/09-session-unlock-core-popup-sync-client/09-UI-SPEC.md`'s "Popup header + delegated-management affordances" section was amended in place to describe the type-menu interaction (superseding its prior "NO type-picker menu in the popup this phase" line) and the web-side `type=<id>` param.

**No dictionary changes were needed** — `extension/lib/i18n/dictionary.ts` already had all five `itemType.*` PL/EN label keys from this same plan's original Item List work; the menu reuses them verbatim.

**Judgment calls:**
- Menu entry order (Login, TOTP, Card, Identity, Note) follows Bartek's NordPass reference screenshots' own ordering (primary type first, then the two "quick-add" types, then the remainder) rather than the arbitrary `ItemType` declaration order in `types.ts`.
- The menu uses `role="menu"`/`role="menuitem"` (not a `<dialog>` or any DaisyUI `modal`), so the existing "no in-popup dialog" test assertion in Test 6 continues to hold — this was a deliberate signal that the fix stays a navigation menu, never a form.
- `web/src/app/page.tsx`'s `VALID_ITEM_TYPES` allowlist is a small unplanned Rule 2 addition (missing input validation on a URL-controlled value) rather than trusting the raw query param — flagged here since it wasn't explicitly requested but is a correctness/security baseline for any query-param-driven state.

**Verification:** `cd extension && npx vitest run` (128/128 pass, +3 new in `ItemListView.test.tsx`), `npx tsc --noEmit` clean, `npx wxt build -b chrome` and `-b firefox` both succeed. `cd web && npx vitest run` (345/345 pass, +2 new in `page.test.tsx`), `npx tsc --noEmit` clean.

**Commits:**
- `943b936` — `test(09): RED — page.tsx preselects/validates action=new-item's type param`
- `7d56a99` — `feat(09): page.tsx preselects item type from new-item deep-link's type param`
- `c4f3e68` — `test(09): extend ItemListView FAB tests for type menu open/choose/outside-click`
- `6026c97` — `fix(09): FAB expands in-popup type menu before redirecting to new-item editor`
- (this commit) — `docs(09): document FAB type-menu post-UAT UX fix`

**Nothing else in the protocol was found binary-unsafe beyond the six fields listed above.** All response-map shapes were audited line-by-line (see item 2) and confirmed JSON-safe as originally written.
