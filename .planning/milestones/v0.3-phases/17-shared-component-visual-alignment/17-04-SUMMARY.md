---
phase: 17-shared-component-visual-alignment
plan: 04
subsystem: testing
tags: [playwright, cdp, visual-regression, extension, chrome-devtools-protocol, shadow-dom]

# Dependency graph
requires:
  - phase: 17-02
    provides: "--pv-tile-bg/--pv-tile-fg tokens.css light-flip fix in inpage-overlay.ts's .pv-row-icon-tile/.pv-row-icon"
  - phase: 17-03
    provides: "packages/pv-ui/components/ItemIconTile.tsx as the sole shared React tile implementation, consumed by web/ and extension/popup shims"
provides:
  - "Repo-wide aggregate build/test/typecheck gate proving all 3 prior Phase 17 plans landed cleanly (web + extension, 8 commands, 0 regressions)"
  - "Zero-duplication and crypto-free boundary greps re-confirmed in aggregate across the whole packages/pv-ui surface, including the new components/ directory"
  - "An executable, closed-allowlist audit of all 5 overlay files' hand-written color/radius literals (4 rgba() elevation values + 4 border-radius:999px pill occurrences, zero undocumented hits)"
  - "extension/e2e-visual/capture-tile-parity.mjs: a standalone Playwright + CDP harness that screenshots and computed-background-color-compares the in-page shadow-DOM tile against the shared React ItemIconTile component across web/popup/in-page, in both themes"
affects: [17-shared-component-visual-alignment, extension-e2e-tooling]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Standalone (non-playwright-test-runner) Node ESM script using chromium.launchPersistentContext for extension-loaded browser automation, mirroring extension/e2e/fixtures.ts's own technique but self-contained"
    - "CDP DOM.getDocument({pierce:true}) + CSS.getComputedStyleForNode for reading computed styles inside a closed shadow root, where Playwright locators cannot reach"
    - "Canvas-based cross-color-space normalization (draw a CSS color string into a 1x1 canvas, read back 8-bit sRGB) to compare computed colors serialized in different CSS Color 4 notations (lab()/oklch()/rgb()) without a false string-mismatch"
    - "pv-server serving a static-exported web/out same-origin (PV_STATIC_DIR) instead of a separate `next dev` server, sidestepping the extension-origin-only CORS allowlist entirely for the web app half of a test harness"

key-files:
  created:
    - extension/e2e-visual/capture-tile-parity.mjs
  modified:
    - extension/package.json

key-decisions:
  - "Reused Bartek's already-running pv-server (:8620) was found to be architecturally unusable for this task: its PV_EXTENSION_ORIGINS allowlist only included a moz-extension:// origin, so every Chrome-extension background fetch would be silently CORS-blocked. The script therefore always runs its own dedicated pv-server on a separate port with the correct chrome-extension:// origin (derived at runtime from the loaded build), never touching or restarting any developer's own session -- documented in the script's own header comment as a Rule 3 deviation."
  - "The web app half of the harness is served BY that same dedicated pv-server instance via PV_STATIC_DIR (a static `next build` export), not a separate `next dev` server -- this project's own established single-container pattern, and the only way to avoid the extension-origin-only CORS allowlist blocking the web app's own API calls too."
  - "Computed background colors are normalized through a 1x1 canvas readback before comparison -- getComputedStyle()/CDP's CSS.getComputedStyleForNode() serialize colors in whatever CSS Color 4 notation the originating declaration used (lab() for Tailwind's zinc-100, oklch() for tokens.css's own literal), so a raw string comparison would report a false mismatch even for genuinely identical pixel colors."

patterns-established:
  - "Canvas 1x1 pixel readback as the standard cross-notation CSS color equality check for any future visual-parity harness in this repo"

requirements-completed: [DS-03, DS-04, UX-01]

coverage:
  - id: D1
    description: "Aggregate gate: both consumers' full build+test+typecheck chains (web: vitest/tsc/next build; extension: vitest/tsc/wxt build x2) are green with zero regressions after all three prior Phase 17 plans land"
    requirement: "DS-03"
    verification:
      - kind: unit
        ref: "web: npx vitest run (481/481 passed)"
        status: pass
      - kind: other
        ref: "web: npx tsc --noEmit (clean)"
        status: pass
      - kind: other
        ref: "web: npx next build (compiled successfully)"
        status: pass
      - kind: unit
        ref: "extension: npx vitest run (687/687 passed)"
        status: pass
      - kind: other
        ref: "extension: npx tsc --noEmit (clean)"
        status: pass
      - kind: other
        ref: "extension: npx wxt build (chrome-mv3, succeeded)"
        status: pass
      - kind: other
        ref: "extension: npx wxt build -b firefox (firefox-mv2, succeeded)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Zero remaining ItemIconTile implementations outside packages/pv-ui/components, and zero crypto-surface import lines anywhere in packages/pv-ui/{vault,i18n,components,clipboard.ts}"
    requirement: "DS-03"
    verification:
      - kind: other
        ref: "grep -rn 'function ItemIconTile' web/src extension/entrypoints --include='*.tsx' | grep -v packages/pv-ui (empty)"
        status: pass
      - kind: other
        ref: "grep -n '^import' packages/pv-ui/{vault,i18n,components}/* packages/pv-ui/clipboard.ts | grep -iE 'wasm|argon2|chacha|hkdf|derive|decrypt|prf' (empty)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Overlay-wide audit of all five overlay files confirms zero undocumented color/999px-radius literals and all 8 documented approved exceptions (4 rgba() elevation/scrim + 4 generic-pill radii) still present"
    requirement: "DS-04"
    verification:
      - kind: other
        ref: "inline node -e audit script scanning inpage-overlay.ts/inpage-mount.ts/generate-popover.ts/save-update-toast.ts/mismatch-modal.ts against the closed allowlist"
        status: pass
    human_judgment: false
  - id: D4
    description: "capture-tile-parity.mjs produces 8+ screenshots across all 4 surfaces (web ItemRow, web DetailPanel, popup list row, in-page Surface A dropdown, in-page Surface B prompt) in both themes, with every automated computed-background-color comparison passing"
    requirement: "UX-01"
    verification:
      - kind: e2e
        ref: "extension/e2e-visual/capture-tile-parity.mjs via `npm run pretest:e2e:visual && npm run test:e2e:visual` -- 10 PNGs produced, results.json: 17/17 comparisons pass (10 individual capture checks + 6 cross-surface parity checks, all pass:true, plus 1 skipped-not-failed entry)"
        status: pass
    human_judgment: false
  - id: D5
    description: "Final human visual-taste confirmation across all 5 render sites x 2 themes -- do the screenshots actually LOOK right end-to-end (dark-logo favicon legible against the light tile, .pv-list scroll-cap unchanged)"
    human_judgment: true
    rationale: "Per this project's standing Playwright-UAT-authorized self-validation precedent, the plan's own human-check block explicitly reserves final pixel-level visual-taste confirmation for Bartek even after the functional computed-color proof already passed -- the automated check proves numeric equality, not that the result looks right."

# Metrics
duration: 33min
completed: 2026-07-21
status: complete
---

# Phase 17 Plan 04: Aggregate Gate + Visual Parity Capture Summary

**Standalone Playwright/CDP harness proves the in-page shadow-DOM tile's background color numerically matches the shared React ItemIconTile component across web/popup/in-page in both themes, closing UX-01 with browser-level evidence; aggregate build/test/typecheck + zero-duplication + overlay-literal-audit gates confirm zero regressions across all three prior Phase 17 plans.**

## Performance

- **Duration:** 33 min
- **Started:** 2026-07-21T08:47:06Z
- **Completed:** 2026-07-21T09:20:00Z (approx)
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Task 1: re-ran and confirmed the full 8-command aggregate build/test/typecheck gate (web: vitest 481/481, tsc clean, next build clean; extension: vitest 687/687, tsc clean, wxt build x2 clean) is green with zero regressions after Plans 17-01/02/03 landed.
- Task 1: re-confirmed both aggregate greps (zero duplicate `ItemIconTile` implementations outside `packages/pv-ui/components`, zero crypto-surface import lines in the shared `pv-ui` package) return empty, and ran the DS-04 overlay-wide literal audit across all five overlay files -- exactly the documented 4 rgba() elevation values + 4 `border-radius:999px` pill occurrences, zero undocumented hits.
- Task 2: built `extension/e2e-visual/capture-tile-parity.mjs`, a standalone Node ESM Playwright/CDP harness that registers a dedicated test account, creates one login item, and captures + computed-style-compares the icon tile across all 4 surfaces (web ItemRow, web DetailPanel header, popup list row, in-page Surface A dropdown, in-page Surface B form prompt) in both `vault-dark`/`vault-light` themes.
- Task 2: produced 10 screenshots (exceeds the 8-surface-pair floor) plus a `results.json` recording 17 pass/fail entries -- all pass, including 6 genuine cross-mechanism parity comparisons (Tailwind-class-driven React tile vs. raw-CSS-custom-property-driven shadow tile) proving the SAME resolved color reaches both consumption paths.

## Task Commits

1. **Task 1: Aggregate build/test/typecheck gate + zero-duplication + crypto-free close-out** - verification-only, no files modified, no commit (plan frontmatter's own `<files></files>` for this task is empty)
2. **Task 2: Playwright/CDP visual parity capture across all 4 surfaces, both themes** - `73359b0` (feat)

**Plan metadata:** (this commit, made by the orchestrator after all worktree agents in the wave complete)

## Files Created/Modified
- `extension/e2e-visual/capture-tile-parity.mjs` - standalone Playwright/CDP screenshot + computed-background-color visual-parity harness; self-manages its own dedicated pv-server + static web export, never touching a developer's own dev session
- `extension/package.json` - added `test:e2e:visual` / `pretest:e2e:visual` npm scripts

## Decisions Made
- Reusing the already-running pv-server on `:8620` (a developer's own dev session) was found architecturally unusable: its `PV_EXTENSION_ORIGINS` only allowed a `moz-extension://` origin, so every fetch from the freshly-loaded Chrome extension would be CORS-blocked. The script always starts its own dedicated pv-server instance on a separate port, configured with the correct `chrome-extension://<id>` origin derived at runtime -- documented in the script's own header comment. Never touches or restarts any developer's own session.
- The web app half of the harness is served by that SAME dedicated pv-server via `PV_STATIC_DIR` (a static `next build` export), not a separate `next dev` server -- avoids a second CORS boundary entirely and matches this project's own established single-container serving pattern.
- Computed background colors are normalized through a 1x1 canvas pixel readback before any comparison, since `getComputedStyle()` and CDP's `CSS.getComputedStyleForNode()` preserve the originating CSS color-function notation (Tailwind's `zinc-100` serializes as `lab(...)`, `tokens.css`'s own `--pv-tile-bg` literal serializes as `oklch(...)`) -- a raw string comparison would report false mismatches for genuinely identical colors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Never reuse an already-healthy pv-server whose CORS allowlist doesn't include this run's extension origin**
- **Found during:** Task 2, initial script run
- **Issue:** The plan's Step 0 literally describes probing `:8620` and reusing it if healthy. A healthy instance WAS running, but its `PV_EXTENSION_ORIGINS` only listed a `moz-extension://` origin from a prior Firefox session -- every Chrome-extension background fetch (register/login/vault calls) would be silently CORS-blocked, defeating 3 of the script's 4 surfaces.
- **Fix:** The script always starts its own dedicated pv-server on a separate port (`8630` by default), configured with the correct extension origin computed at runtime from the loaded build. The reuse-if-healthy / bounded-30s-timeout / kill-only-what-we-started contract from Step 0 is preserved verbatim, just against this dedicated port.
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** Script runs end-to-end, all 4 surfaces populate real data.
- **Committed in:** `73359b0`

**2. [Rule 1 - Bug] Web app CORS failure when using a separate `next dev` server**
- **Found during:** Task 2, second script iteration
- **Issue:** A separate `next dev` server on its own port also failed closed with a generic "Nie udało się utworzyć konta" error -- pv-server's CORS layer only ever allows the extension's own origin, never a plain browser tab origin, so RegisterForm.tsx's fetch calls were CORS-blocked.
- **Fix:** Build web/ as a static export (`next build`, `NEXT_PUBLIC_API_BASE_URL=""`) and serve it via the same dedicated pv-server instance's `PV_STATIC_DIR`, eliminating the CORS boundary entirely (same-origin API calls, this project's own established single-container pattern).
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** Registration + item creation succeed against the static-served web app.
- **Committed in:** `73359b0`

**3. [Rule 1 - Bug] Wrong toggle-to-register button matched by a positional selector**
- **Found during:** Task 2 debugging
- **Issue:** `LoginForm.tsx` renders `PasskeyUnlockButton` (also `type="button"`) BEFORE its own toggle-to-register link -- a positional `.first()` match on `button[type="button"]` clicked the passkey button instead, silently leaving the register form unreached.
- **Fix:** Text-matched the toggle link directly (`button:has-text("Zarejestruj"), button:has-text("Sign up")`).
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** Register form now reliably reached.
- **Committed in:** `73359b0`

**4. [Rule 1 - Bug] Onboarding wizard skip control text-matched incorrectly**
- **Found during:** Task 2 debugging
- **Issue:** UI-04's onboarding wizard blocks every click behind a `fixed inset-0` backdrop-blur scrim until dismissed. The plan's assumed "Pomiń"/"Skip" text match doesn't exist on step 1's actual control (`ImportWizard`'s own `data-testid="import-wizard-skip"`), so the scrim stayed up and every subsequent click hung until Playwright's retry budget expired.
- **Fix:** Dismiss via `[data-testid="import-wizard-skip"]` (advances to step 3) then `[data-testid="onboarding-step3-finish"]`.
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** Onboarding reliably dismissed, item creation proceeds.
- **Committed in:** `73359b0`

**5. [Rule 1 - Bug] Detail panel scrim intercepted the second theme iteration's row click**
- **Found during:** Task 2 debugging
- **Issue:** DetailPanel stays open across the loop's second iteration; its own `[data-testid="side-panel-scrim"]` (a `fixed inset-0` overlay) intercepted the fresh row click intended to re-open it.
- **Fix:** Close the detail panel via `[data-testid="detail-panel-close"]` before each iteration's row click.
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** Both theme iterations complete cleanly.
- **Committed in:** `73359b0`

**6. [Rule 1 - Bug] 420px popup-sized viewport caused real visual overlap on web/fixture pages**
- **Found during:** Task 2 debugging
- **Issue:** The persistent context's default viewport (420x700, sized for the real popup surface) made DetailPanel's `md:w-[400px]` aside nearly fill the whole web page, and inpage-overlay.ts's `position:fixed; right:16; width:352px` panel overlapped the bare fixture form's naturally-flowing fields on a 420px-wide page -- both genuine layout collisions, not shadow-DOM piercing bugs.
- **Fix:** Set a real desktop viewport (1280x900) for the web page and a wider viewport (1000x800) for the fixture page; only the popup page keeps the context's 420x700 default.
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** Row clicks and field focus no longer intercept.
- **Committed in:** `73359b0`

**7. [Rule 1 - Bug] Popup's own `.bg-base-200` selector matched the wrong element**
- **Found during:** Task 2 debugging
- **Issue:** An unscoped `.locator(".bg-base-200").first()` matched `ItemListView.tsx`'s own search/sort header bar (also plain `bg-base-200`, no dark-theme flip, rendered before the item row in DOM order) instead of the actual `ItemIconTile` tile -- silently produced the LIGHT theme's value even during the "vault-dark" capture.
- **Fix:** Scoped to `button .bg-base-200` -- the item row tile is the only `.bg-base-200` nested inside an actual `<button>` in this popup.
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** Computed value correctly flips between themes.
- **Committed in:** `73359b0`

**8. [Rule 1 - Bug] Popup theme toggle applied to the wrong DOM element**
- **Found during:** Task 2 debugging
- **Issue:** `main.tsx` stamps `data-theme` on `document.body`, not `document.documentElement` (unlike web's `layout.tsx`). Setting `documentElement` left `<body>` un-stamped, so the popup's OVERALL chrome never visually re-themed even though the tile's own default-block token still resolved correctly via `:root`.
- **Fix:** Set `data-theme` on `document.body` for the popup specifically.
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** popup-list-vault-dark.png now correctly shows the dark chrome.
- **Committed in:** `73359b0`

**9. [Rule 1 - Bug] Color-space-notation string mismatch produced false parity failures**
- **Found during:** Task 2 debugging
- **Issue:** `getComputedStyle()` (web/popup) and CDP's `CSS.getComputedStyleForNode` (in-page) serialize resolved colors in whatever CSS color-function notation the originating declaration used -- Tailwind's precompiled `zinc-100` reports as `lab(96.1634 0.0993311 -0.364041)`, `tokens.css`'s own `--pv-tile-bg: oklch(96.7% 0.001 286.375)` literal reports as `oklch(...)`. A raw string comparison reported 5 false mismatches even though both values represent the exact same real pixel color (UI-SPEC.md itself documents the oklch() literal as "verified against tailwindcss/theme.css" to equal zinc-100).
- **Fix:** Added a `normalizeColor()` helper that renders any CSS color string into a 1x1 canvas and reads back quantized 8-bit sRGB, giving a true color-space-agnostic comparison. All captured values now normalize to identical `rgba(244, 244, 245, 1.000)` (dark) / `rgba(252, 251, 250, 1.000)` (light) across all 4 surfaces.
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** All 6 cross-surface parity comparisons pass with matching normalized RGB values.
- **Committed in:** `73359b0`

**10. [Rule 3 - Blocking] Popup server-config screen race on first render**
- **Found during:** Task 2 debugging (final flakiness)
- **Issue:** An immediate (non-waiting) `.count()` check right after `popup.goto()` raced the popup's own first React render (WASM init + an initial `chrome.storage` read); when it lost the race, the server-URL fill/submit branch was silently skipped, leaving the config screen up and the subsequent sign-in wait timing out.
- **Fix:** Wait up to 8s for either the config screen or a later-stage screen to actually render before branching.
- **Files modified:** extension/e2e-visual/capture-tile-parity.mjs
- **Verification:** Three consecutive clean runs after the fix, zero flakiness.
- **Committed in:** `73359b0`

---

**Total deviations:** 10 auto-fixed (9 Rule 1 bug fixes, 1 Rule 3 blocking-issue fix). All were required to make the harness itself functionally correct -- none represent scope creep beyond the plan's own Task 2 objective. No architectural changes (Rule 4) were needed.
**Impact on plan:** All fixes are internal to the new test harness script; zero product-code changes. The plan's own literal Step 0/Step 5 wording (probe-and-reuse the developer's `:8620`/`:3000` session) was found genuinely incompatible with a Chrome-extension-loaded test harness's CORS requirements and was replaced with a self-contained dedicated-server pattern, documented in the script's own header comment for future maintainers.

## Issues Encountered
See Deviations above -- all issues were debugging/iteration friction in building the NEW test harness itself, resolved via the auto-fix rules. No issues in the existing product code; the harness confirms zero regressions across all three prior plans.

## User Setup Required
None - no external service configuration required.

## Known Stubs
None.

## Threat Flags
None - the new script only adds test-only automation (its own dedicated pv-server instance, own dedicated `@example.local` test account, own local fixture HTTP server), matching this project's established e2e/e2e-firefox harness conventions (T-17-10/T-17-11 in this plan's own threat model). No new production network endpoint, auth path, or schema change was introduced.

## Next Phase Readiness
- Phase 17's 3 ROADMAP success criteria are all proven true in aggregate: (1) `ItemIconTile` exists exactly once, imported by both web and the extension popup (Plans 17-01/17-03, re-confirmed here); (2) the in-page dropdown/prompt tiles visually match web/popup in both themes, with the prior dark-tile bug gone (Plan 17-02, proven here with browser-level computed-color evidence); (3) the in-page overlays' hand-written styles read tile colors from `pv-ui` tokens with no duplicated/hand-copied constants (Plan 17-02, re-confirmed via this plan's own overlay-wide literal audit).
- Bartek's own end-of-phase visual-taste UAT is the one remaining open item (`D5` above, `human_judgment: true`) -- 10 screenshots are ready under `.planning/phases/17-shared-component-visual-alignment/uat-screenshots/` for that review.
- `extension/e2e-visual/capture-tile-parity.mjs` is a reusable harness for any future in-page-vs-shared-component visual regression check (documented default ports: pv-server `:8630`, fixture form `:8896`; override via `PV_TILE_PARITY_*` env vars to avoid colliding with a parallel run).

---
*Phase: 17-shared-component-visual-alignment*
*Completed: 2026-07-21*

## Self-Check: PASSED

- FOUND: extension/e2e-visual/capture-tile-parity.mjs
- FOUND: test:e2e:visual / pretest:e2e:visual scripts in extension/package.json
- FOUND: commit 73359b0
- FOUND: .planning/phases/17-shared-component-visual-alignment/uat-screenshots/results.json
- FOUND: 10 PNG screenshots under uat-screenshots/ (>= 8 required)
