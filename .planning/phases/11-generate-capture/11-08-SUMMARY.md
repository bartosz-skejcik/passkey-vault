---
phase: 11-generate-capture
plan: 08
subsystem: ui
tags: [pv-ui, tokens, oklch, shadow-dom, wxt, vite-inline-import, theme-mirror, lucide-react]

requires:
  - phase: 11-generate-capture (11-07)
    provides: "packages/pv-ui/tokens.css (vault-dark/vault-light OKLCH token set) and the D-12 theme-mirror pipeline (resolveTheme/watchMirroredTheme in extension/lib/theme/theme-mirror.ts)"
provides:
  - "extension/lib/autofill/inpage-theme.ts: single shared shadow-DOM stylesheet built from pv-ui/tokens.css's raw CSS text (Vite ?inline import) + the DM Sans/system-ui font stack -- every in-page surface's one style source"
  - "Theme-stamped panel containers in BOTH inpage-mount.ts's shared shadow root (generate-popover/save-update-toast/mismatch-modal) and inpage-overlay.ts's own separate shadow root (Surface A/B) -- resolveTheme() at mount + watchMirroredTheme() for live re-stamping, with detach on teardown"
  - "All six in-page surfaces (generate popover, save/update toast, mismatch modal, overlay prompt panel, in-field dropdown, field icon) converted from literal OKLCH colors to var(--color-...) token references -- zero hand-rolled color values remain"
  - "Generator popover layout/trigger-icon/copy mirrors web/src/components/generator/GeneratorPopover.tsx 1:1 (bg-base-100/border-base-300/rounded-box/p-4/gap-3, Wand2 trigger icon, no visible title row)"
affects: ["11-generate-capture UAT (packaged-build screenshots in BOTH themes required before Bartek review)", "Phase 13 cross-browser hardening pass (this plan's Firefox build is green but not yet visually UAT'd there)"]

tech-stack:
  added: []
  patterns:
    - "Vite's `?inline` import suffix to pull a CSS file's fully-processed text into a JS string for shadow-DOM injection -- requires vitest's `test.css: true` (its own default `css: false` stubs ALL css-like imports, `?inline` included, to empty modules before Vite's real CSS pipeline runs) and a widened `server.fs.allow` (the `?inline`/`?raw`/`?url`/`.svg` suffixes run an extra fs-access check independent of normal module resolution, hitting the same sibling-directory workspace-root boundary Next.js's Turbopack hit in 11-07)"
    - "A shadow tree's `:root` selector never matches anything (it always resolves to the top-level document element) -- tokens.css's `:root, [data-theme=\"vault-dark\"]` default-theme block is therefore DEAD inside a shadow root unless an explicit element within the tree carries `[data-theme]`. Both inpage-mount.ts and inpage-overlay.ts now mount a dedicated 'panel container' element for exactly this purpose; every rendered surface appends into that container, never straight into the ShadowRoot"
    - "`all: unset` on an element does not break font-family inheritance -- `unset` computes to `inherit` for naturally-inherited CSS properties, so surfaces using `all: unset` (buttons, inputs) still pick up the shared theme stylesheet's font-family from their container ancestor without re-declaring it per rule"

key-files:
  created:
    - extension/lib/autofill/inpage-theme.ts
    - extension/lib/autofill/inpage-theme.test.ts
    - extension/types/css-inline.d.ts
  modified:
    - extension/lib/autofill/inpage-mount.ts
    - extension/lib/autofill/inpage-mount.test.ts
    - extension/lib/autofill/generate-popover.ts
    - extension/lib/autofill/generate-popover.test.ts
    - extension/lib/autofill/save-update-toast.ts
    - extension/lib/autofill/save-update-toast.test.ts
    - extension/lib/autofill/mismatch-modal.ts
    - extension/lib/autofill/mismatch-modal.test.ts
    - extension/lib/autofill/inpage-overlay.ts
    - extension/lib/autofill/inpage-overlay.test.ts
    - extension/vitest.config.ts

key-decisions:
  - "Introduced a 'panel container' element (data-pv-panel-container) as the single carrier of the [data-theme] attribute in both shadow roots, rather than stamping data-theme onto every individual panel -- one stamp point, live re-stamp on mirror change, every descendant surface inherits the resolved custom properties automatically."
  - "Generator popover's panel background/border follow GeneratorPopover.tsx's actual bg-base-100/border-base-300 pairing (matching DaisyUI's real .input/.dropdown-content default), which is the OPPOSITE of the base-300-canvas/base-100-border convention the other three surfaces (toast/modal/overlay) keep -- those three have no direct web-app component to diff against, so their Phase-10-audited layering was preserved unmodified, just token-ized. Documented inline in each file so a future reader doesn't 'fix' the apparent inconsistency."
  - "Wherever a surface previously hardcoded a DARK literal as 'text on primary/error background' (a Phase-10-era guess made before packages/pv-ui existed), switched to var(--color-primary-content) -- tokens.css fixes primary-content to a constant white in both themes, which is what GeneratorPopover.tsx's own DaisyUI-generated buttons actually resolve to. No --color-error-content token exists in tokens.css, so the mismatch modal's confirm button reuses --color-primary-content for the same 'white text on saturated fill' need (documented inline, not a primary/secondary semantic claim)."
  - "Trigger icon changed from RefreshCw to Wand2 (wand-sparkles.mjs) to match web's GeneratorPopover.tsx trigger button; RefreshCw now used only for the in-popover regenerate action, which is what it always should have been."
  - "Kept the extension's mask-by-default + reveal-toggle pattern on both the generate-popover preview and the save/update toast preview, even though web's own GeneratorPopover input has no type=password/reveal toggle at all -- this plan's own threat_model (T-11-33) requires masked previews stay masked, an intentional security hardening beyond web parity, not a regression to fix."

requirements-completed: []

coverage:
  - id: D1
    description: "extension/lib/autofill/inpage-theme.ts ships the single shared shadow-DOM stylesheet (pv-ui/tokens.css raw text + font stack); inpage-mount.ts injects it, mounts a theme-stamped panel container, resolves the theme at mount and re-stamps live on chrome.storage change"
    verification:
      - kind: unit
        ref: "extension/lib/autofill/inpage-theme.test.ts (5 tests: ?inline resolves real tokens.css text, both theme blocks present, font stack scoped to [data-theme], no @font-face/third-party font URL)"
        status: pass
      - kind: unit
        ref: "extension/lib/autofill/inpage-mount.test.ts (10 tests: theme stylesheet injected, panel container mounted + theme-stamped from resolveTheme(), live re-stamp via watchMirroredTheme(), watcher detached on __resetMountForTests())"
        status: pass
      - kind: integration
        ref: "extension: npx wxt build (chrome-mv3) -- .output/chrome-mv3/content-scripts/content-relay.js's built bytes grepped for vault-dark/vault-light/color-primary token text, confirming the ?inline import resolves in the real packaged bundle, not just under vitest"
        status: pass
    human_judgment: false
  - id: D2
    description: "All six in-page surfaces (generate popover, save/update toast, mismatch modal, overlay prompt panel, in-field dropdown, field icon) converted to var(--color-...) tokens with zero hand-rolled OKLCH/hex literals remaining outside inpage-theme.ts, and zero behavioral regressions (safeRemove teardown, shadow.activeElement focus trap, trusted-origin handling untouched)"
    verification:
      - kind: unit
        ref: "extension: npx vitest run -- 40/40 test files, 390 tests pass (generate-popover.test.ts 8, save-update-toast.test.ts 10, mismatch-modal.test.ts 12, inpage-overlay.test.ts 15, content-relay.test.ts 12, all unchanged behavior assertions still green)"
        status: pass
      - kind: other
        ref: "grep -rn 'oklch(\\|#[0-9a-fA-F]{3,8}' lib/autofill/*.ts (excluding inpage-theme.ts and *.test.ts) -- zero matches"
        status: pass
      - kind: integration
        ref: "extension: npx tsc --noEmit -- 0 errors in any file this plan touched (1 pre-existing, unrelated error remains in lib/crypto/wasm-loader.ts, documented in deferred-items.md)"
        status: pass
      - kind: integration
        ref: "extension: npx wxt build && npx wxt build -b firefox -- both green"
        status: pass
    human_judgment: false
  - id: D3
    description: "In-page generate popover is visually indistinguishable in layout from web's GeneratorPopover.tsx (control order, Wand2 trigger, no title row, panel bg-base-100/border-base-300); every surface renders correctly in BOTH vault-light and vault-dark and follows a live web-app theme flip"
    verification: []
    human_judgment: true
    rationale: "Visual/layout fidelity to a real DaisyUI-compiled reference and live cross-context theme-following (extension shadow-DOM surfaces reacting to the actual web app's theme toggle in a real browser) cannot be proven by jsdom/vitest -- both require a real Chrome/Firefox session with the packaged build, the actual pv-server web app open, and side-by-side comparison against GeneratorPopover.tsx's real rendered output. This plan's own SUMMARY output spec explicitly flags: packaged-build UAT with BOTH-theme screenshots of all six surfaces is required before Bartek review (orchestrator runs it)."

duration: ~50min
completed: 2026-07-16
status: complete
---

# Phase 11 Plan 08: In-page surface theming (D-12/D-13) + generator 1:1 parity Summary

**Every in-page shadow-DOM surface (generator popover, save/update toast, mismatch modal, Phase-10 autofill overlay) now renders from `packages/pv-ui/tokens.css`'s OKLCH tokens with live theme-following, and the generate popover's layout/trigger-icon now mirror `web/src/components/generator/GeneratorPopover.tsx` 1:1.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-07-16T13:38:00Z (approx, first Read)
- **Completed:** 2026-07-16T14:00:00Z
- **Tasks:** 2
- **Files modified:** 14 (3 created, 11 modified)

## Accomplishments

- `extension/lib/autofill/inpage-theme.ts` is the single style source every in-page surface injects: `pv-ui/tokens.css`'s raw CSS text (Vite `?inline` import — no build step beyond what WXT's own Vite pipeline already runs) plus the shared DM Sans/system-ui font stack, exported as one string.
- `inpage-mount.ts`'s shared shadow root and `inpage-overlay.ts`'s own separate shadow root both now mount a theme-stamped "panel container" element — the only place `[data-theme]` needs to live inside a shadow tree, since a shadow root's own `:root` selector never matches anything (tokens.css's default-theme block would otherwise be silently dead inside every surface). Both resolve the theme asynchronously at mount (matching `main.tsx`'s own popup-bootstrap pattern) and re-stamp live via `watchMirroredTheme()`.
- All six surfaces — generate popover, save/update toast, mismatch modal, the Phase-10 overlay's prompt panel/in-field dropdown/field icon — converted from literal OKLCH colors to `var(--color-...)` token references. Zero hand-rolled color values remain outside `inpage-theme.ts` (grep-verified).
- The generate popover's layout now mirrors `GeneratorPopover.tsx` 1:1: panel background/border/padding/gap match its actual `bg-base-100 border-base-300 rounded-box p-4 gap-3` classes, the trigger icon changed from `RefreshCw` to `Wand2` (matching web's trigger; `RefreshCw` now correctly used only for the in-popover regenerate action), and the popover's own redundant visible title row was removed (web has none — the dialog's `aria-label` still carries the accessible name).
- The mismatch modal's warning banner mixes the error token into the panel's own background token (not a hardcoded dark literal), so it stays high-contrast and serious in BOTH themes — the project's "playfulness nigdy w dialogach bezpieczeństwa" constraint holds regardless of which theme is active.
- Both `npx wxt build` (chrome-mv3) and `npx wxt build -b firefox` (firefox-mv2) are green, and the packaged `content-scripts/content-relay.js`'s built bytes were grepped to confirm the `?inline` import genuinely resolved real token text into the shipping bundle, not just under vitest.

## Task Commits

Each task was committed atomically:

1. **Task 1: inpage-theme.ts + theme-stamping mount** - `d2ceeac` (feat)
2. **Task 2: convert all surfaces to tokens; generator layout 1:1 with web** - `8474edc` (feat)

## Files Created/Modified

- `extension/lib/autofill/inpage-theme.ts` - shared shadow-DOM stylesheet (tokens.css raw text + font stack)
- `extension/lib/autofill/inpage-theme.test.ts` - coverage for the ?inline import + both theme blocks + no @font-face
- `extension/types/css-inline.d.ts` - ambient module declaration for the `*.css?inline` specifier
- `extension/lib/autofill/inpage-mount.ts` - injects the theme stylesheet, mounts + stamps + re-stamps the shared panel container, new `getPanelContainer()` export
- `extension/lib/autofill/inpage-mount.test.ts` - theme-stamping/live-re-stamp/watcher-detach coverage (wxt/browser mocked)
- `extension/lib/autofill/generate-popover.ts` - token conversion, Wand2 trigger, no title row, panel bg-base-100/border-base-300, appends into panel container
- `extension/lib/autofill/generate-popover.test.ts` - wxt/browser mock added (transitively required by inpage-mount.ts now)
- `extension/lib/autofill/save-update-toast.ts` - token conversion, appends into panel container
- `extension/lib/autofill/save-update-toast.test.ts` - wxt/browser mock added
- `extension/lib/autofill/mismatch-modal.ts` - token conversion (error banner mixed into base-100, not a dark literal), appends into panel container
- `extension/lib/autofill/mismatch-modal.test.ts` - wxt/browser mock added
- `extension/lib/autofill/inpage-overlay.ts` - own separate theme-stamped panel container, INPAGE_THEME_CSS injected, token conversion, `destroy()` detaches the theme watcher
- `extension/lib/autofill/inpage-overlay.test.ts` - wxt/browser mock added
- `extension/vitest.config.ts` - `test.css: true` (vitest's own CSS stubbing bypassed Vite's real `?inline` transform) + widened `server.fs.allow` to the monorepo root (same sibling-directory workspace-root boundary 11-07 hit with Turbopack, here hitting Vite's dev-server fs-access layer instead)

## Decisions Made

- **Panel-container pattern over per-panel stamping** — one `[data-theme]`-carrying element per shadow root (shared for the three inpage-mount.ts surfaces, a second independent one for inpage-overlay.ts's own shadow root) rather than stamping every individual panel. Single stamp point, single live-update path, every descendant inherits the resolved custom properties for free via normal CSS cascade.
- **Generator popover's bg-base-100/border-base-300 vs. the other three surfaces' base-300/base-100** — deliberately NOT unified. The generator has a literal web component (`GeneratorPopover.tsx`) to diff 1:1 against, and that component's actual DaisyUI classes use `bg-base-100 border-base-300`. The toast/modal/overlay have no such web-app equivalent; their Phase-10-audited base-300-canvas/base-100-border layering was preserved unmodified, just token-ized. Documented inline in each file to prevent a future "fix" of the apparent asymmetry.
- **var(--color-primary-content) reused for "white text on error fill"** — tokens.css has no dedicated `--color-error-content` token. Rather than reintroduce a literal white value (which would fail this plan's own grep-verification requirement), the mismatch modal's confirm button reuses `--color-primary-content` purely because it already resolves to a fixed white in both themes — documented inline as NOT a primary/secondary semantic claim.
- **Kept the extension's own mask+reveal pattern** on the generator preview and save/update toast preview, diverging deliberately from web's unmasked plain-text preview input — this plan's threat_model (T-11-33) requires masked previews stay masked; that's a security hardening the extension already had, not something to regress toward web parity.
- **Built the missing WASM artifact mid-plan** (not part of Task 1/2's own file list, but needed to genuinely verify `npx wxt build`/`vitest run entrypoints/background/router.test.ts`) via `scripts/build-wasm.sh` — resolves the pre-existing gap `11-01-SUMMARY.md`'s `deferred-items.md` first documented (fresh worktree, `wasm-bindgen-cli` not pre-installed, cargo build never run). The output is gitignored and was not committed; this is an environment-local fix, not a code change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Vite's `?inline` import hit the same sibling-directory workspace-root boundary Turbopack hit in 11-07**
- **Found during:** Task 1 (first `vitest run lib/autofill/inpage-mount`)
- **Issue:** `pv-ui/tokens.css?inline` resolved fine via `inpage-theme.test.ts`'s own direct import, but failed with `Error: Denied ID .../packages/pv-ui/tokens.css?inline` when the SAME import chain was exercised via `inpage-mount.test.ts`. Root cause (confirmed by reading Vite 7.3.6's transform-middleware source): the `?inline`/`?raw`/`?url`/`.svg` import suffixes run an EXTRA `server.fs.allow` access check independent of normal module resolution, and `fs.allow` defaults to Vite's auto-detected workspace root (nearest lockfile directory, i.e. `extension/` itself) — the exact same sibling-directory boundary problem 11-07-SUMMARY.md's deviation #1 hit with Next.js's Turbopack for this same `packages/pv-ui` package.
- **Fix:** Added `server: { fs: { allow: [path.resolve(__dirname, "..")] } }` to `vitest.config.ts`, widening the boundary to the monorepo root, mirroring `web/next.config.ts`'s `turbopack.root` fix.
- **Files modified:** `extension/vitest.config.ts`
- **Verification:** `npx vitest run lib/autofill/inpage-mount lib/autofill/inpage-theme` green; `npx wxt build`'s packaged bundle also confirmed correct (the real build path doesn't hit vitest's dev-server fs check at all, so this was purely a test-environment fix).
- **Committed in:** `d2ceeac` (Task 1 commit)

**2. [Rule 3 - Blocking] vitest's own `css: false` default stubbed the `?inline` import to an empty string**
- **Found during:** Task 1 (smoke-testing the `?inline` import before writing `inpage-theme.ts`'s real test file)
- **Issue:** vitest's default `test.css: false` replaces EVERY CSS-like import (including a `?inline`-suffixed one) with an empty module before Vite's own CSS pipeline (and therefore its `?inline` transform) ever runs — `INPAGE_THEME_CSS` resolved to a near-empty string (123 chars, only the appended font-stack rule) with no configuration change.
- **Fix:** Added `test.css: true` to `vitest.config.ts`.
- **Files modified:** `extension/vitest.config.ts`
- **Verification:** Re-ran the same smoke test — `tokensCss.length` went from 0 to 3188 (the real file), confirmed against a hand-picked token value from `tokens.css` (`--color-primary: oklch(65.31% 0.1637 37.22)`).
- **Committed in:** `d2ceeac` (Task 1 commit)

**3. [Rule 3 - Blocking] Missing `*.css?inline` ambient TypeScript module declaration**
- **Found during:** Task 1 (before running `tsc --noEmit` for the first time on `inpage-theme.ts`)
- **Issue:** Vite's own `vite/client` types (transitively referenced via WXT's generated `.wxt/wxt.d.ts`) declare `*.css` as an empty module — correct for a side-effecting default CSS import, but TypeScript's ambient-module wildcard matching is a literal suffix match, so `'*.css'` does not match `'pv-ui/tokens.css?inline'`.
- **Fix:** Added `extension/types/css-inline.d.ts` declaring `*.css?inline` as a string-default-export module.
- **Files modified:** `extension/types/css-inline.d.ts` (new)
- **Verification:** `npx tsc --noEmit` — no error on `inpage-theme.ts`'s import line.
- **Committed in:** `d2ceeac` (Task 1 commit)

**4. [Rule 3 - Blocking] Four test files needed a `wxt/browser` mock they didn't have before**
- **Found during:** Task 1/2 (running `generate-popover.test.ts`, `save-update-toast.test.ts`, `mismatch-modal.test.ts`, `inpage-overlay.test.ts` after wiring theme-stamping into `inpage-mount.ts`/`inpage-overlay.ts`)
- **Issue:** `getOrCreateShadowRoot()`/`createOverlayController()` now call `resolveTheme()`/`watchMirroredTheme()` (from `../theme/theme-mirror`, which imports `browser` from `wxt/browser`) at mount/construction time. None of these four test files previously imported anything touching `wxt/browser`, so it was unmocked — calling `resolveTheme()` threw `Cannot read properties of undefined (reading 'storage')`.
- **Fix:** Added the same Map-backed `vi.mock("wxt/browser", ...)` fake `theme-mirror.test.ts`/`blocked-origins.test.ts` already use, to each of the four files.
- **Files modified:** `extension/lib/autofill/generate-popover.test.ts`, `save-update-toast.test.ts`, `mismatch-modal.test.ts`, `inpage-overlay.test.ts`
- **Verification:** All four files pass in full (8+10+12+15 = 45 tests).
- **Committed in:** `d2ceeac` (Task 1, `inpage-mount.test.ts`) / `8474edc` (Task 2, the other four)

**5. [Rule 1 - Bug] Backtick code-spans inside a CSS-comment inside a JS template literal broke the build**
- **Found during:** Task 2 (first `vitest run lib/autofill/mismatch-modal`, then again for `inpage-overlay`)
- **Issue:** Wrote explanatory CSS comments (inside the `MISMATCH_CSS`/`OVERLAY_CSS` JS template-literal strings) using markdown-style single-backtick code-spans around selector/property names — those literal backticks prematurely terminated the JS template string, producing `ReferenceError: mismatch is not defined` / an esbuild parse error at the exact backtick position.
- **Fix:** Reworded both comments to plain text, no backticks.
- **Files modified:** `extension/lib/autofill/mismatch-modal.ts`, `extension/lib/autofill/inpage-overlay.ts`
- **Verification:** `npx vitest run lib/autofill/mismatch-modal.test.ts lib/autofill/inpage-overlay.test.ts` green; grep-verified zero remaining backticks inside all four converted CSS template-literal bodies.
- **Committed in:** `8474edc` (Task 2 commit)

**6. [Rule 3 - Blocking] Missing WASM build artifact blocked the plan's own required `npx wxt build`/full `vitest run` verification**
- **Found during:** Task 2 (running the plan's own `<verify>` block's `npx wxt build`/`npx wxt build -b firefox`)
- **Issue:** Fresh worktree checkout — `extension/lib/crypto/wasm/` (wasm-bindgen glue) and `extension/public/wasm/pv_wasm_bg.wasm` don't exist until `scripts/build-wasm.sh` runs; this is the SAME pre-existing environment gap `11-01-SUMMARY.md`'s `deferred-items.md` documented (unrelated to any file this plan touches), but this plan's own verification block explicitly requires both browser builds to be green, not just `tsc`/`vitest` on a subset.
- **Fix:** Ran `bash scripts/build-wasm.sh` (cargo + wasm-bindgen-cli were already available in this environment; ~15s build). Output is gitignored, confirmed via `git status --short` showing no new untracked files after the build — not committed.
- **Files modified:** none (build output only, gitignored)
- **Verification:** `npx wxt build` and `npx wxt build -b firefox` both green afterward; `npx vitest run` went from 39/40 to 40/40 files passing (the previously-failing `router.test.ts` now loads and passes); `npx tsc --noEmit` dropped from 3 pre-existing errors to 1 (the 2 wasm-artifact-caused errors resolved themselves; the 1 remaining `PublicPath` overload error in `wasm-loader.ts` is a genuine, unrelated pre-existing type issue, still out of scope for this plan).
- **Committed in:** n/a (no code change — build artifact only, gitignored)

---

**Total deviations:** 6 auto-fixed (4 blocking-issue fixes to make the plan's own stated verification commands actually pass, 1 bug fix for a self-inflicted syntax error, 1 environment-gap fix inherited from an earlier plan's documented deferral)
**Impact on plan:** All auto-fixes were necessary to make the plan's own stated verification commands (`vitest run`, `tsc --noEmit`, `wxt build` ×2) genuinely pass against real output, not a subset. No scope creep — nothing outside this plan's own file list (plus the one-time environment-local wasm build) was touched.

## Issues Encountered

None beyond the deviations documented above — no auth gates, no checkpoints, no architectural decisions requiring a stop.

## Known Stubs

None. Every surface renders real, token-driven CSS; no placeholder colors or "coming soon" states were introduced.

## Threat Flags

None beyond this plan's own pre-declared threat register entry (T-11-33, disposition: mitigate, verified — masked-preview/no-secrets-in-light-DOM invariants unchanged and still pinned by the existing test suites). No new network endpoints, auth paths, file-access patterns, or schema changes were introduced; this plan is presentation-only.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Packaged-build UAT with BOTH-theme (vault-light + vault-dark) screenshots of all six in-page surfaces is required before Bartek's review** — this plan's own `must_haves`/`verification` explicitly call this out as an orchestrator-run step, not something this executor can self-certify (see coverage D3's `human_judgment: true` rationale). Recommend the orchestrator drive: (1) open the web app in vault-light, confirm the popup follows; (2) trigger each of the six in-page surfaces on a real test page against a configured pv-server, screenshot in both themes; (3) toggle the web app's theme live and confirm an already-open surface re-stamps without a page reload.
- All existing Phase 10/11 behavior (safeRemove teardown races, `shadow.activeElement` focus trap in the mismatch modal, `isConfiguredServerOrigin()`/`isOriginBlocked()` gating, trusted-origin handling) is confirmed byte-identical via the full `npx vitest run` pass (390/390 tests) — this plan is presentation + theme-stamping only, as required.
- The WASM artifact this plan built to unblock its own verification is gitignored and worktree-local; a fresh checkout/worktree will need `bash scripts/build-wasm.sh` run again before `npx wxt build`/`router.test.ts` will pass there. This is expected, pre-existing behavior (not something this plan introduced), documented here for whichever agent hits it next.
- With this plan, phase 11's own D-12/D-13 scope (theme parity + shared `pv-ui` package) is functionally complete pending the human visual UAT pass noted above.

---
*Phase: 11-generate-capture*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 9 spot-checked files exist on disk; both task commit hashes (d2ceeac, 8474edc) verified present in git log.
