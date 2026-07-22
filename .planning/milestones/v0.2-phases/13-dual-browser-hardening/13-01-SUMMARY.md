---
phase: 13-dual-browser-hardening
plan: 01
subsystem: extension
tags: [wxt, firefox, manifest, csp, web-ext, webextensions, mv2]

# Dependency graph
requires:
  - phase: 08-extension-bootstrap-wasm-in-background-spike
    provides: "Firefox MV2 persistent-background target, pinned gecko.id, D-09 CSP object shape"
  - phase: 09-extension-server-config-and-passkey-provider-foundation
    provides: "optional_host_permissions runtime grant flow (configureServer/server-config.ts) and the Phase-9-flagged Firefox optional_permissions gap this plan closes"
provides:
  - "Firefox strict_min_version pinned to 115.0 (browser.storage.session floor)"
  - "Firefox-branch optional_permissions host-pattern fix so browser.permissions.request() has a manifest pre-declaration on Firefox MV2"
  - "web-ext@10.5.0 devDependency + lint:firefox script wired to the real .output/firefox-mv2 build output"
  - "Clean web-ext lint pass (0 errors) on the packaged Firefox build, confirmed against real installed Firefox 152.0.6 via web-ext run"
affects: ["13-04 (cross-browser parity UAT)", "13-05 (moz-extension CORS server-side deliverable)"]

# Tech tracking
tech-stack:
  added: ["web-ext@10.5.0 (devDependency)"]
  patterns:
    - "Per-browser manifest function branching (browser === 'firefox') for keys one browser strips/needs that the other doesn't, rather than forking the whole manifest object"
    - "optional_permissions (shared MV2/MV3 key) as the Firefox-specific substitute for optional_host_permissions (MV3-only, stripped by WXT's mv3OnlyKeys on Firefox MV2)"

key-files:
  created: []
  modified:
    - extension/wxt.config.ts
    - extension/package.json
    - extension/package-lock.json

key-decisions:
  - "strict_min_version pinned to '115.0' -- the browser.storage.session floor (storage.session shipped in Firefox 115, also an ESR release); never set below 115"
  - "gecko.id left byte-for-byte unchanged (passkey-vault@extension.local, Phase 8) -- not re-derived or re-decided"
  - "CSP re-confirmed unchanged (verify-not-add, D-09) -- no per-browser CSP branch introduced; the existing WXT object shape already auto-converts correctly for Firefox MV2 via convertCspToMv2()"
  - "Firefox-branch optional_permissions (not optional_host_permissions) carries the host match-patterns on Firefox MV2, since WXT's mv3OnlyKeys strips optional_host_permissions entirely for Firefox; Chrome's optional_host_permissions branch is untouched"
  - "The anticipated content_scripts[].world:ISOLATED lint finding (Firefox 128+ only) did NOT materialize in the actual web-ext lint output -- strict_min_version stayed at 115.0, not pre-emptively bumped to 128"

patterns-established:
  - "web-ext run (installTemporaryAddon over Firefox's real RDP) as an automatable, non-interactive proxy for about:debugging's 'Load Temporary Add-on' -- proves the manifest is accepted by real Firefox, distinct from and stronger than web-ext lint's static syntax check alone"

requirements-completed: [XBR-01]

coverage:
  - id: D1
    description: "web-ext lint passes clean (0 errors) on the packaged Firefox build"
    requirement: "XBR-01"
    verification:
      - kind: automated_ui
        ref: "cd extension && npm run build:firefox && npm run lint:firefox"
        status: pass
    human_judgment: false
  - id: D2
    description: "strict_min_version, gecko.id, and CSP are correctly reflected in the generated Firefox MV2 manifest.json"
    requirement: "XBR-01"
    verification:
      - kind: automated_ui
        ref: ".output/firefox-mv2/manifest.json inspected post-build: strict_min_version=115.0, gecko.id=passkey-vault@extension.local (unchanged), csp=script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; (unchanged)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Firefox optional_permissions manifest pre-declaration exists so browser.permissions.request() can prompt/grant on Firefox MV2"
    requirement: "XBR-01"
    verification:
      - kind: automated_ui
        ref: ".output/firefox-mv2/manifest.json optional_permissions=[http://*/*, https://*/*] confirmed present; live permission-prompt-and-grant exercise deferred to 13-04 (no GUI-interaction tooling in this execution session)"
        status: unknown
    human_judgment: true
    rationale: "Manifest pre-declaration is machine-verified, but confirming the browser.permissions.request() dialog actually renders and grants requires clicking through a real Firefox permission prompt -- an interactive step this headless execution session has no tool to drive. Deferred to 13-04's live walk per the plan's explicit escape hatch."
  - id: D4
    description: "A real WASM crypto operation succeeds in the packaged Firefox build (vault-unlock round-trip), proving wasm-unsafe-eval is functionally sufficient"
    requirement: "XBR-01"
    verification:
      - kind: automated_ui
        ref: "web-ext run install of the packaged firefox-mv2 build into real Firefox 152.0.6 succeeded ('Installed ... as a temporary add-on', no manifest-parse errors); WebAssembly.validate(pv_wasm_bg.wasm) returned true on the packaged binary"
        status: unknown
    human_judgment: true
    rationale: "Successful temporary-add-on install and WASM binary structural validity are the automatable proxies available in this session. The literal acceptance bar -- triggering ONE vault-unlock round trip inside the loaded extension and confirming no CompileError/EvalError in the background console -- requires typing into the popup UI and clicking Unlock, which needs GUI/mouse-keyboard interaction this session has no tool for. Deferred to 13-04's live walk, per the plan's explicit instruction to record what remains when a truly-interactive step is impossible headlessly."

# Metrics
duration: 12min
completed: 2026-07-17
status: complete
---

# Phase 13 Plan 01: Firefox Manifest/CSP/Gecko Hardening Summary

**Pinned Firefox's `strict_min_version` to 115.0, fixed the Phase-9-flagged `optional_permissions` gap that silently broke `browser.permissions.request()` on Firefox MV2, and wired `web-ext@10.5.0` + `lint:firefox` — confirming a clean lint pass and successful real-Firefox temporary-add-on install on the packaged build.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-17T09:40:30+02:00 (approx, first read of current file state)
- **Completed:** 2026-07-17T09:52:00+02:00 (approx)
- **Tasks:** 3
- **Files modified:** 3 (`extension/wxt.config.ts`, `extension/package.json`, `extension/package-lock.json`)

## Accomplishments
- Re-confirmed (not re-declared) the already-shipped identical CSP (`script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`) and the already-pinned `gecko.id` (`passkey-vault@extension.local`) survive unchanged through the packaged build
- Added `browser_specific_settings.gecko.strict_min_version: '115.0'` — the `browser.storage.session` API floor
- Closed the Phase-9-flagged Firefox `optional_permissions` gap: Firefox MV2 strips `optional_host_permissions` entirely (WXT's `mv3OnlyKeys`), so the host match-patterns (`http://*/*`, `https://*/*`) now live under Firefox's `optional_permissions` instead, leaving Chrome's `optional_host_permissions` branch untouched
- Added `web-ext@10.5.0` devDependency (re-vetted at install time: official Mozilla repo, no postinstall script, 10.5.0 confirmed latest) and a `lint:firefox` script targeting the real `.output/firefox-mv2` output directory
- `npm run build:firefox && npm run lint:firefox` passes with **0 errors** (15 pre-existing/unrelated warnings — see below)
- `web-ext run` successfully installed the packaged Firefox build as a temporary add-on in real Firefox 152.0.6, with no manifest-parse errors — a stronger, non-lint signal that the manifest is accepted by an actual Firefox instance
- The packaged `pv_wasm_bg.wasm` binary passes `WebAssembly.validate()` (structurally valid, not corrupt/truncated by the build)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add web-ext tooling (actual delta only)** - `80fca9d` (chore)
2. **Task 2: Add strict_min_version + Firefox optional_permissions fix; re-confirm gecko.id/CSP/MV2 unchanged (D-04, D-07, D-09)** - `e0c304b` (feat)
3. **Task 3: Verify web-ext lint + runtime WASM smoke test on the packaged Firefox build (D-02)** - no new commit (verification-only task; no file changes beyond what Task 2 already committed)

**Plan metadata:** (this commit, see final_commit step)

## Files Created/Modified
- `extension/package.json` - Added `web-ext@10.5.0` devDependency (pinned, no caret) and `lint:firefox` script (`web-ext lint --source-dir ./.output/firefox-mv2`)
- `extension/package-lock.json` - Lockfile update from `npm i -D web-ext@10.5.0`
- `extension/wxt.config.ts` - Added `browser_specific_settings.gecko.strict_min_version: '115.0'` beside the unchanged `gecko.id`; added a `browser === 'firefox'` conditional block declaring `optional_permissions: ['http://*/*', 'https://*/*']`, leaving the existing unconditional `optional_host_permissions` (Chrome/MV3) untouched

## Decisions Made
- `strict_min_version: '115.0'` — the `browser.storage.session` floor (9 non-test files depend on `storage.session`, which shipped in Firefox 115; 115 also happens to be an ESR release). Never set below 115.
- Firefox host-permission pre-declaration lives under `optional_permissions` (the shared MV2/MV3 key), not `optional_host_permissions` (MV3-only per WXT's `mv3OnlyKeys`, confirmed by reading `node_modules/wxt/dist/core/utils/manifest.mjs` directly rather than assuming)
- CSP and `gecko.id` were explicitly left untouched — this plan's job was re-confirmation, not re-declaration; verified byte-for-byte against Phase 8's shipped values both in `wxt.config.ts` and in the generated `.output/firefox-mv2/manifest.json`
- The plan's anticipated `content_scripts[].world:ISOLATED` lint finding (which would have required deciding whether to bump `strict_min_version` to 128) did not appear in the actual `web-ext lint` output — resolved by not acting on it, per the plan's explicit instruction to wait for real lint output rather than pre-empting

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written. No Rule 1/2/3 auto-fixes were needed; the manifest changes matched the plan's ground-truth-verified action exactly.

### Out-of-scope discovery (not fixed, logged per scope boundary)

**Pre-existing unhandled rejection in `entrypoints/popup/App.test.tsx` causes `npm --prefix extension test` to exit 1**
- **Found during:** Post-task gate check (`npm --prefix extension test`, required by the orchestrator's gate list)
- **Symptom:** All 514/514 tests pass (`Test Files 45 passed (45)`, `Tests 514 passed (514)`), but Vitest additionally reports 1 unhandled rejection (`TypeError: Cannot read properties of undefined (reading 'request')` at `ServerConfigView.tsx:95:32`, surfacing during `App.test.tsx`), which makes the process exit 1 despite zero failing tests.
- **Root cause:** `App.test.tsx`'s `browser` mock omits a `permissions` key (unlike `ServerConfigView.test.tsx`, which mocks it), so `browser.permissions.request(...)` throws synchronously on undefined member access inside `handleSubmit`'s fire-and-forget call, and that throw escapes as an unobserved promise rejection.
- **Why out of scope:** `App.test.tsx` was last modified in Phase 12 (commit `7c56380`), and this plan touched only `extension/wxt.config.ts` and `extension/package.json` — neither of which is imported by, or affects, `App.test.tsx`'s mock setup. Per the deviation rules' scope boundary ("only auto-fix issues directly caused by the current task's changes"), this pre-existing, unrelated test-mock gap was **not** fixed here.
- **Logged to:** `.planning/phases/13-dual-browser-hardening/deferred-items.md`
- **Status:** Deferred to the next plan/phase touching `App.test.tsx` or `entrypoints/popup/` test mocks.

---

**Total deviations:** 0 auto-fixed; 1 out-of-scope item logged and deferred (not fixed).
**Impact on plan:** None on this plan's own deliverables — all Task 1-3 acceptance criteria met. The deferred test-mock gap is pre-existing (Phase 12) and does not affect Firefox manifest/CSP correctness.

## Issues Encountered

**Interactive WASM smoke test could not be fully completed in this execution session.** The plan's Task 3 acceptance criteria call for loading the packaged Firefox build via `about:debugging` and triggering one real vault-unlock WASM round-trip, observing the background console for `CompileError`/`EvalError`. This execution session has no GUI/mouse-keyboard automation tool available (no computer-use, no Playwright-with-Firefox-extension support — Playwright's patched Firefox build does not support loading unpacked WebExtensions the way Chromium does via `--load-extension`; a deprecated/abandoned `firefox-client` npm package was found and NOT installed, since it is a holder package with no real implementation).

What WAS completed automatically, per the plan's explicit escape hatch ("if a truly-interactive step is impossible headlessly, do the automatable parts... and record exactly what remains for the 13-04 walk"):
1. `npm run build:firefox && npm run lint:firefox` — 0 errors (hard gate, met)
2. `web-ext run --source-dir .output/firefox-mv2` against real installed Firefox 152.0.6 — output: `Installed /Users/j5on/.work/projects/passkey-vault/extension/.output/firefox-mv2 as a temporary add-on` with **no manifest-parse errors or warnings from Firefox itself** (this exercises Firefox's real RDP `installTemporaryAddon` call, the same code path `about:debugging`'s "Load Temporary Add-on" button uses — a materially stronger signal than `web-ext lint`'s static syntax check alone). The launched Firefox process and all child processes were confirmed fully terminated after the check (no orphaned processes).
3. `WebAssembly.validate()` against the packaged `.output/firefox-mv2/wasm/pv_wasm_bg.wasm` binary — returned `true` (the wasm binary itself is structurally valid, not corrupted by the Firefox-targeted build)

**What remains for 13-04's live walk (explicitly deferred, not attempted here):**
- Load `.output/firefox-mv2/manifest.json` via `about:debugging#/runtime/this-firefox` → "Load Temporary Add-on"
- Trigger one vault-unlock WASM round-trip in the popup UI
- Confirm no `CompileError`/`EvalError: Refused to compile` in the background console (Firefox's equivalent of the background page inspector)
- Exercise the `browser.permissions.request({origins:[...]})` dialog for a concrete server origin end-to-end (manifest pre-declaration via `optional_permissions` is machine-verified in this plan; the actual prompt-and-grant UI interaction is not)

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `wxt.config.ts` and `package.json` are ready for 13-04's cross-browser parity UAT: the packaged Firefox build has a real, deliberately-pinned version floor, a working host-permission pre-declaration path, and passes `web-ext lint` clean
- 13-04 must complete the deferred interactive verification: the `about:debugging` load + vault-unlock WASM round-trip + live permission-prompt exercise (D3/D4 coverage entries above marked `human_judgment: true`, `status: unknown`, pending that walk)
- 13-05 (moz-extension CORS server-side deliverable, D-10/EXT-05) is unblocked to proceed in parallel — this plan's scope note is unchanged: `configureServer()`'s pre-grant `/healthz` probe and Firefox's CORS enforcement against it remain 13-05's job, not this plan's
- Deferred, unrelated test-mock gap in `App.test.tsx` (see `deferred-items.md`) should be picked up by whichever future plan next touches `entrypoints/popup/` test mocks — it currently causes `npm --prefix extension test` to exit 1 despite 514/514 tests passing

---
*Phase: 13-dual-browser-hardening*
*Completed: 2026-07-17*

## Self-Check: PASSED

All created/modified files exist on disk (`extension/wxt.config.ts`, `extension/package.json`, `extension/package-lock.json`, this SUMMARY, `deferred-items.md`). Both task commits (`80fca9d`, `e0c304b`) verified present in `git log`.
