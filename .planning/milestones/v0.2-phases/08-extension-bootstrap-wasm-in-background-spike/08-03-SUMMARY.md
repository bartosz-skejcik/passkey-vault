---
phase: 08-extension-bootstrap-wasm-in-background-spike
plan: 03
subsystem: extension
tags: [wxt, mv3, mv2, webextension-polyfill, service-worker, manifest, csp]

requires:
  - phase: 08-extension-bootstrap-wasm-in-background-spike (08-01, 08-02)
    provides: WXT vanilla scaffold with pinned MV3 CSP + Firefox gecko.id, WASM loader, vault-session round-trip spike, background.ts onMessage listener

provides:
  - Minimal framework-free debug popup (index.html + main.ts) that only relays browser.runtime.sendMessage({kind:'spike.roundtrip'}) to the background context
  - "build:chrome" npm script alongside existing "build:firefox"
  - Packaged (non-dev) Chrome MV3 and Firefox MV2 builds under extension/.output/, generated-manifest-verified against D-07/D-08/D-09
  - Firefox MV2 background.persistent:true now explicitly emitted in the generated manifest (was silently missing before this plan)
  - Two <human-check> UAT items queued for end-of-phase verification covering SC #1, #3, #4

affects: [09-session-unlock-core-popup-sync-client, 08-UAT]

tech-stack:
  added: []
  patterns:
    - "WXT defineBackground({ persistent: true, ... }) is the only way to get background.persistent into the generated Firefox MV2 manifest — wxt.config.ts has no equivalent knob for this field"
    - "Popup entrypoints live at extension/entrypoints/popup/index.html + main.ts; WXT bundles the <script type=module src=./main.ts> like a Vite HTML entry"

key-files:
  created:
    - extension/entrypoints/popup/index.html
    - extension/entrypoints/popup/main.ts
    - .planning/phases/08-extension-bootstrap-wasm-in-background-spike/deferred-items.md
  modified:
    - extension/package.json
    - extension/entrypoints/background.ts

key-decisions:
  - "Popup never imports wasm-loader.ts/vault-session.ts/pv_wasm.js — sendMessage-only relay per D-04, enforced by the plan's own grep acceptance criteria"
  - "Explicitly set persistent:true on defineBackground() in background.ts (not wxt.config.ts) to make D-08's MV2 persistent-background pin show up in the generated manifest.json, not just as a source-code intent"

patterns-established:
  - "Debug/spike popups (throwaway per 08-CONTEXT.md) stay vanilla TS+HTML, no framework, no design-system tokens — Phase 9's 09-UI-SPEC.md popup replaces this entirely"

requirements-completed: [EXT-01]

coverage:
  - id: D1
    description: "Minimal debug harness popup — button(s) + sendMessage-only relay to background's spike.roundtrip handler, no crypto imports"
    requirement: "EXT-01"
    verification:
      - kind: other
        ref: "cd extension && npx tsc --noEmit (clean); grep sendMessage/spike.roundtrip present in main.ts; grep confirms no import of ../background, wasm-loader, or vault-session"
        status: pass
    human_judgment: false
  - id: D2
    description: "Packaged Chrome MV3 build's generated manifest.json declares the CSP with wasm-unsafe-eval and background.type=module alongside service_worker (D-07)"
    requirement: "EXT-01"
    verification:
      - kind: other
        ref: "grep -c wasm-unsafe-eval .output/chrome-mv3/manifest.json (=1); grep -o '\"type\":\"module\"' .output/chrome-mv3/manifest.json (present)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Packaged Firefox MV2 build's generated manifest.json shows a deliberate persistent background page (background.persistent=true, background.scripts array, no service_worker field) — D-08"
    requirement: "EXT-01"
    verification:
      - kind: other
        ref: "grep -o '\"persistent\":true' .output/firefox-mv2/manifest.json (present); grep -c service_worker .output/firefox-mv2/manifest.json (=0)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both packaged manifests carry the same literal gecko.id chosen in plan 08-01 (D-09)"
    requirement: "EXT-01"
    verification:
      - kind: other
        ref: "grep -o gecko.id JSON in both .output/chrome-mv3/manifest.json and .output/firefox-mv2/manifest.json — both equal passkey-vault@extension.local"
        status: pass
    human_judgment: false
  - id: D5
    description: "Round-trip proof survives a genuine Chrome service-worker idle-kill/wake cycle against the packaged build (SC #3, D-10), with zero console errors on load (SC #1)"
    verification: []
    human_judgment: true
    rationale: "D-10 explicitly forbids a simulated/mocked termination — this requires the browser's real platform-level service-worker termination mechanism (chrome://serviceworker-internals or DevTools 'stop'), which has no CLI/headless equivalent in this environment. Queued as a <human-check> in Task 2's <verify> block for end-of-phase UAT."
  - id: D6
    description: "Firefox packaged build loads with zero console errors and a single round-trip click succeeds, with no second-click requirement (SC #4, proving the MV2 pin sidesteps the idle-kill problem entirely)"
    verification: []
    human_judgment: true
    rationale: "Firefox's about:debugging temporary-add-on flow and its background-page console have no CLI-drivable equivalent in this environment. Queued as a <human-check> in Task 2's <verify> block for end-of-phase UAT."

duration: ~10min
completed: 2026-07-15
status: complete
---

# Phase 8 Plan 3: Debug Harness Popup + Packaged-Build Manifest Verification Summary

**Vanilla-TS debug popup wired to the background round-trip spike via sendMessage, plus real `wxt build` (not `wxt dev`) Chrome MV3 and Firefox MV2 outputs verified field-by-field against the D-07/D-08/D-09 manifest pins — with a genuine gap found and fixed: Firefox's `background.persistent` was silently absent from the generated manifest until `defineBackground({ persistent: true })` was added.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-07-15T09:03:56+02:00 (approx, right after 08-02 completion)
- **Completed:** 2026-07-15T09:09:23+02:00
- **Tasks:** 2 completed
- **Files modified:** 5 (2 created under extension/, 1 deferred-items log, 2 modified)

## Accomplishments
- Minimal, framework-free debug popup (`index.html` + `main.ts`) that only relays `browser.runtime.sendMessage({kind:'spike.roundtrip'})` to the background context and renders the JSON result — zero crypto imports, per D-04
- `build:chrome` npm script added alongside the pre-existing `build:firefox`
- Real packaged builds produced for both browsers (`wxt build -b chrome`, `wxt build -b firefox`) and their generated `manifest.json` files inspected directly (not `wxt dev` output) — closing the exact dev-vs-packaged gap PITFALLS.md #4 warns about
- Found and fixed a real bug: Firefox's MV2 manifest was missing `background.persistent` entirely (WXT only emits it when the entrypoint itself sets `persistent`, not via `wxt.config.ts`) — fixed in `background.ts`, now confirmed present in the generated output
- Two `<human-check>` UAT items written into the plan's own `<verify>` block, ready for `08-UAT.md` harvesting at end-of-phase, covering SC #1/#3/#4

## Task Commits

Each task was committed atomically:

1. **Task 1: Minimal debug harness popup** - `3dce3cf` (feat)
2. **Task 2: Build packaged outputs + verify generated manifests** - `e97b420` (feat)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `extension/entrypoints/popup/index.html` - Two buttons ("Run round-trip spike", "Check again") + `<pre id="result">` result area
- `extension/entrypoints/popup/main.ts` - sendMessage-only relay to `{kind:'spike.roundtrip'}`, renders JSON or caught error message; no crypto imports
- `extension/package.json` - added `"build:chrome": "wxt build -b chrome"`
- `extension/entrypoints/background.ts` - added `persistent: true` to `defineBackground()` options, with an inline comment explaining why this must live here (not `wxt.config.ts`)
- `.planning/phases/08-extension-bootstrap-wasm-in-background-spike/deferred-items.md` - logged one out-of-scope Firefox build warning (see Issues Encountered)

## Decisions Made
- Popup is intentionally vanilla DOM APIs (no React/Vue), matching 08-CONTEXT.md's "throwaway debug harness" framing — Phase 9 replaces it per 09-UI-SPEC.md
- `persistent: true` belongs on the `defineBackground()` call in `background.ts`, not `wxt.config.ts` — verified against `node_modules/wxt/dist/core/utils/manifest.mjs`, which reads `background.options.persistent` (the entrypoint's own option), not any config-level equivalent. This field is ignored by WXT for both Chrome MV3 and Firefox MV3 code paths, so setting it unconditionally is safe.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Firefox MV2 generated manifest was missing `background.persistent` entirely**
- **Found during:** Task 2 (`wxt build -b firefox`, inspecting the generated `.output/firefox-mv2/manifest.json`)
- **Issue:** The plan's own acceptance criteria require the generated Firefox manifest to show `"persistent":true` (D-08, SC #4). Before this fix, `background` in the generated manifest was only `{"scripts":["background.js"]}` — the `persistent` key was silently absent because `JSON.stringify` drops `undefined` values, and WXT reads `persistent` from the background *entrypoint's* own `defineBackground()` options, not from `wxt.config.ts` (which has no equivalent field). This meant D-08's "deliberate MV2 persistent background page, not an implicit default" pin was not actually provable from the generated output — exactly the acceptance criterion this plan's Task 2 requires.
- **Fix:** Added `persistent: true` to the `defineBackground({...})` call in `extension/entrypoints/background.ts`, with an inline comment explaining the WXT internals (verified by reading `node_modules/wxt/dist/core/utils/manifest.mjs`) and why this is inert for Chrome MV3 / Firefox MV3 builds.
- **Files modified:** `extension/entrypoints/background.ts`
- **Verification:** Rebuilt `wxt build -b firefox`; `.output/firefox-mv2/manifest.json` now contains `"background":{"persistent":true,"scripts":["background.js"]}` with no `service_worker` field. Re-ran `npx tsc --noEmit` (clean).
- **Committed in:** `e97b420` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix, required for this plan's own acceptance criteria)
**Impact on plan:** Necessary for correctness — without it, Task 2's stated acceptance criterion ("Generated Firefox manifest.json contains `"persistent":true`") would have failed. No scope creep; the fix is scoped to the exact field the plan's own tasks require.

## Issues Encountered
- `wxt build -b firefox` emits a WARN about `data_collection_permissions` (new Firefox policy effective Nov 3, 2025; existing extensions exempt for now). This is unrelated to any file this plan touches — it fires for any Firefox build of this extension regardless of popup/background content, does not fail the build, and does not affect any manifest field this plan verifies. Logged (not fixed) in `deferred-items.md`, to revisit before any real AMO submission (out of scope through at least Phase 13).

## Human-Check Items Queued for End-of-Phase UAT

These are written verbatim into `08-03-PLAN.md`'s `<verify>` block (Task 2) and should be harvested into `08-UAT.md`:

1. **Chrome real service-worker idle-kill/wake (SC #1, #3, D-10):**
   - Open `chrome://extensions`, enable Developer mode, "Load unpacked", select `extension/.output/chrome-mv3`.
   - Open the popup, click "Run round-trip spike" — expect `{ok: true, survived: false}`.
   - In the background service worker's DevTools (or `chrome://serviceworker-internals`), use the real "stop"/terminate control — NOT a page reload, NOT disabling/re-enabling the extension.
   - Re-open the popup, click "Check again" — expect `{ok: true, survived: true}`.
   - Expected throughout: zero console errors on the extension's card or in the background console on load.
   - Why human: D-10 forbids a simulated/mocked termination; requires real platform-level service-worker termination with no CLI/headless equivalent.

2. **Firefox MV2 single-click round-trip (SC #1, #4):**
   - Open `about:debugging#/runtime/this-firefox`, "Load Temporary Add-on", select `extension/.output/firefox-mv2/manifest.json`.
   - Open the background page's persistent "Inspect" console (no service-worker entry — expected MV2 difference from Chrome).
   - Click "Run round-trip spike" once — expect `{ok: true}` with zero console errors, no second click needed (this is exactly what the MV2 persistent-background pin buys).
   - Why human: `about:debugging`'s temporary-add-on flow and background-page console have no CLI-drivable equivalent.

## Next Phase Readiness
- Both packaged builds are byte-verified against D-07/D-08/D-09; the debug popup is wired end-to-end at the messaging layer. The only remaining gap before Phase 8 can be declared fully verified is the two queued `<human-check>` items above (real-browser SC #1/#3/#4), which the end-of-phase UAT pass should run against `extension/.output/chrome-mv3` and `extension/.output/firefox-mv2` exactly as built here.
- Phase 9 (session-unlock-core-popup-sync-client) will replace this throwaway popup entirely per `09-UI-SPEC.md` — nothing here should be treated as durable UI.

## Self-Check: PASSED

All created files confirmed present on disk; both task commits (`3dce3cf`, `e97b420`) confirmed in `git log --all`.

---
*Phase: 08-extension-bootstrap-wasm-in-background-spike*
*Completed: 2026-07-15*
