---
phase: 11-generate-capture
plan: 07
subsystem: ui
tags: [pv-ui, monorepo, tailwind-v4, daisyui, turbopack, wxt, vite, chrome-storage, theme-mirror]

requires:
  - phase: 11-generate-capture (11-01, 11-04, 11-05, 11-06)
    provides: extension generator/theme surfaces this plan extracted/rewired (v0.1 generator port, popup style.css hand-copy)
provides:
  - "packages/pv-ui npm package: single source of truth for the vault-dark/vault-light OKLCH token set (tokens.css) and the password/passphrase generator (generator/*), consumed by web and extension via a `file:` dependency"
  - "D-12 theme-mirror pipeline: extension/lib/theme/theme-mirror.ts (captureThemeFromWebApp/resolveTheme/watchMirroredTheme), wired into content-relay.content.ts (gated on isConfiguredServerOrigin()) and the popup (main.tsx un-hardcodes data-theme)"
  - "next.config.ts turbopack.root fix for consuming a sibling-directory workspace package under Next 16's Turbopack workspace-root auto-detection"
affects: [11-08 (in-page shadow-DOM restyling — consumes packages/pv-ui/tokens.css as raw CSS text and the same resolveTheme() chain)]

tech-stack:
  added: []
  patterns:
    - "file: dependency instead of npm/yarn workspaces for a shared local package (web/ and extension/ each keep their own package-lock.json/build pipeline)"
    - "DaisyUI theme tokens as raw `:root, [data-theme=...]` CSS custom properties instead of the `@plugin daisyui/theme` at-rule, so the same file works unmodified as plain CSS (framework-agnostic — needed for plan 11-08's shadow-DOM injection)"
    - "chrome.storage.local as a direct write target from an ISOLATED content script, no new message-passing protocol kind needed"

key-files:
  created:
    - packages/pv-ui/package.json
    - packages/pv-ui/tokens.css
    - packages/pv-ui/generator/password.ts
    - packages/pv-ui/generator/strength.ts
    - packages/pv-ui/generator/wordlist.ts
    - packages/pv-ui/generator/password.test.ts
    - package.json (root, minimal — no workspaces field)
    - extension/lib/theme/theme-mirror.ts
    - extension/lib/theme/theme-mirror.test.ts
  modified:
    - web/src/app/globals.css
    - web/next.config.ts
    - web/tsconfig.json
    - web/package.json
    - web/src/lib/generator/password.ts
    - web/src/lib/generator/strength.ts
    - web/src/lib/generator/wordlist.ts
    - extension/entrypoints/popup/style.css
    - extension/entrypoints/popup/index.html
    - extension/entrypoints/popup/main.tsx
    - extension/entrypoints/content-relay.content.ts
    - extension/entrypoints/__tests__/content-relay.test.ts
    - extension/lib/generator/password.ts
    - extension/lib/generator/strength.ts
    - extension/lib/generator/wordlist.ts
    - extension/package.json
    - Dockerfile

key-decisions:
  - "Mechanism: file:../packages/pv-ui dependency, NOT an npm/yarn workspace — web/ and extension/ each keep their own self-contained package-lock.json/build pipeline; the Dockerfile's per-project cache-split stays intact with one added COPY step instead of a lockfile restructure."
  - "packages/pv-ui/tokens.css ships as raw `:root, [data-theme=\"vault-dark\"]` / `[data-theme=\"vault-light\"]` CSS custom properties (verified byte-equivalent, down to the light-theme-inherits-from-:root cascade behavior, against the ORIGINAL `@plugin daisyui/theme` at-rule's compiled Turbopack/lightningcss output) rather than the DaisyUI at-rule macro — this is what plan 11-08's raw shadow-DOM CSS injection needs, no build step required to consume it."
  - "web/src/lib/generator/* and extension/lib/generator/* are thin `export *` re-export shims to pv-ui/generator/* — zero consumer churn, every existing import path and test file keeps working unmodified."
  - "D-12 theme mirror needs NO new message-passing protocol kind: a content script can already write chrome.storage.local directly (the same choke-point-free convention lib/autofill/blocked-origins.ts and content-relay's own isConfiguredServerOrigin() already use)."

requirements-completed: []

coverage:
  - id: D1
    description: "packages/pv-ui ships the shared vault-dark/vault-light tokens.css and the moved generator/* logic; web and extension both consume it via a file: dependency with zero consumer churn"
    verification:
      - kind: unit
        ref: "web: npx vitest run (49 files, 345 tests) — includes web/src/lib/generator/password.test.ts exercising the shim chain"
        status: pass
      - kind: unit
        ref: "extension: npx vitest run lib/generator (9 tests) — exercises the shim chain"
        status: pass
      - kind: integration
        ref: "web: NEXT_PUBLIC_API_BASE_URL=\"\" npm run build — compiled OKLCH+lab() theme CSS diffed byte-equivalent against pre-extraction baseline build"
        status: pass
      - kind: integration
        ref: "extension: npx wxt build (chrome-mv3) + npx wxt build -b firefox (firefox-mv2) — both green, popup CSS carries the full vault-dark token block"
        status: pass
    human_judgment: false
  - id: D2
    description: "D-12 theme-mirror pipeline: captureThemeFromWebApp/resolveTheme/watchMirroredTheme in extension/lib/theme/theme-mirror.ts, wired into content-relay.content.ts (gated on isConfiguredServerOrigin()) and the popup (un-hardcoded data-theme, resolves before first render, re-stamps live)"
    verification:
      - kind: unit
        ref: "extension/lib/theme/theme-mirror.test.ts (14 tests: enum validation on read+write, MutationObserver live update + detach, mirror->prefers-color-scheme->vault-dark fallback order, storage.onChanged subscription + detach)"
        status: pass
      - kind: unit
        ref: "extension/entrypoints/__tests__/content-relay.test.ts (Tests 10-12: captureThemeFromWebApp invoked iff isConfiguredServerOrigin() gates true)"
        status: pass
      - kind: unit
        ref: "extension: npx tsc --noEmit"
        status: pass
    human_judgment: true
    rationale: "Live theme-following behavior in a real browser (popup opens with the web app's actual theme after one visit, falls back to prefers-color-scheme before that) needs a real Chrome/Firefox session with the actual pv-server web app and a real popup open/close cycle — jsdom/vitest coverage proves the storage read/write/subscribe logic correct in isolation but not the end-to-end cross-context visual result. Plan 11-08 (in-page restyling) shares this same mirror and will get its own UAT pass; recommend folding a joint 11-07+11-08 visual UAT into that plan's checkpoint rather than a standalone one here."

duration: 25min
completed: 2026-07-16
status: complete
---

# Phase 11 Plan 07: pv-ui extraction + theme mirror Summary

**Extracted the vault-dark/vault-light OKLCH tokens and password generator into a `packages/pv-ui` npm package (consumed via `file:` dependency, not workspaces) and built the D-12 theme-mirror pipeline so the extension popup follows the user's actual web-app theme instead of a hardcoded `vault-dark`.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-07-16T11:07:00Z (approx, first Read)
- **Completed:** 2026-07-16T11:31:18Z
- **Tasks:** 2
- **Files modified:** 27 (7 created new in packages/pv-ui + root package.json + theme-mirror.ts/test, 19 modified)

## Accomplishments
- `packages/pv-ui` is now the single source of truth for the OKLCH theme tokens (`tokens.css`) and the password/passphrase generator (`generator/*`) — no byte-for-byte copies remain outside it for either concern.
- web and extension both consume `pv-ui` via a `file:../packages/pv-ui` dependency; `web/src/lib/generator/*` and `extension/lib/generator/*` are now thin re-export shims, so every existing import path and test file kept working with zero consumer churn.
- Fixed a real Next.js 16 Turbopack gap along the way: Turbopack auto-detects the "workspace root" from the nearest lockfile and refuses to compile anything outside it — `web/next.config.ts` now sets `turbopack.root` one directory up so `packages/pv-ui` (a sibling of `web/`) is reachable.
- Built the D-12 theme-mirror pipeline (`extension/lib/theme/theme-mirror.ts`): the content script mirrors the web app's `data-theme` into `chrome.storage.local` (enum-validated, MutationObserver-live) whenever it's on the user's own configured server origin; the popup resolves mirror → `prefers-color-scheme` → `vault-dark` before its first render and re-stamps live via `storage.onChanged`.
- `extension/entrypoints/popup/index.html` no longer hardcodes `data-theme="vault-dark"` — confirmed absent from the actual built `popup.html`.

## Task Commits

Each task was committed atomically:

1. **Task 1: packages/pv-ui — tokens + generator extracted, web and extension rewired** - `83f3165` (feat)
2. **Task 2a: theme-mirror pipeline (TDD RED)** - `be119df` (test)
2. **Task 2b: theme-mirror pipeline (TDD GREEN)** - `d1da9ce` (feat)
2. **Task 2c: wire theme mirror into content-relay + un-hardcode popup** - `fd15837` (feat)

_TDD task (Task 2) has 3 commits: test → feat → feat (no separate refactor commit needed — GREEN implementation required no cleanup pass)._

## Files Created/Modified

- `packages/pv-ui/tokens.css` - vault-dark/vault-light OKLCH tokens as raw `[data-theme]` custom properties
- `packages/pv-ui/generator/{password,strength,wordlist}.ts` + `password.test.ts` - moved generator logic + its test, unchanged content
- `packages/pv-ui/package.json` - `exports` map for `./tokens.css` and `./generator/*` subpaths
- `package.json` (root) - minimal, documents the `file:` mechanism choice (no `workspaces` field)
- `web/next.config.ts` - `transpilePackages: ["pv-ui"]` + `turbopack.root` (Turbopack workspace-root fix)
- `web/tsconfig.json` - `pv-ui/generator/*` path alias (belt-and-suspenders alongside package.json `exports`)
- `web/src/app/globals.css` - `@import "pv-ui/tokens.css"` replaces the inline theme blocks
- `web/src/lib/generator/{password,strength,wordlist}.ts` - re-export shims
- `extension/entrypoints/popup/style.css` - `@import "pv-ui/tokens.css"` replaces the hand-synced token copy; "manual sync" comment deleted
- `extension/lib/generator/{password,strength,wordlist}.ts` - re-export shims
- `extension/lib/theme/theme-mirror.ts` - `captureThemeFromWebApp`/`resolveTheme`/`watchMirroredTheme`
- `extension/entrypoints/content-relay.content.ts` - `initThemeCapture()` wired behind `isConfiguredServerOrigin()`
- `extension/entrypoints/popup/index.html` - drops hardcoded `data-theme`
- `extension/entrypoints/popup/main.tsx` - resolves theme before first render, re-stamps live
- `Dockerfile` - web-builder stage `COPY packages/pv-ui/` before `npm ci`

## Decisions Made

- **`file:` dependency over npm/yarn workspaces** — the plan explicitly left this to executor discretion ("outcome over mechanism"). Workspaces would require restructuring `web/package-lock.json` and `extension/package-lock.json` into one root lockfile, which the Dockerfile's existing per-project cache-split stage (`COPY web/package.json web/package-lock.json ./` then `npm ci`) depends on. `file:` deps needed only one added `COPY packages/pv-ui/` line in the Dockerfile and zero lockfile restructuring, while still satisfying "single source, no drift possible without a failing test."
- **Raw CSS custom properties instead of `@plugin "daisyui/theme"`** for `tokens.css` — verified via a byte-level diff against the pre-extraction build's compiled CSS that this reproduces DaisyUI's own generated output exactly (including the `:root`-cascade behavior where `vault-light` only overrides `color-scheme` + the three `base-*` tokens and inherits everything else). This form requires no PostCSS/DaisyUI plugin to produce working custom properties — exactly what plan 11-08's raw shadow-DOM CSS injection needs.
- **`turbopack.root` fix (Rule 3 — blocking issue)** — not anticipated by the plan; Next 16's Turbopack silently refuses to compile files outside its auto-detected workspace root (nearest lockfile directory), which is `web/` itself since it deliberately keeps its own lockfile. Fixed via `turbopack.root: path.join(__dirname, "..")` in `next.config.ts`.
- **D-12 needs no new message-passing protocol kind** — a content script can already write `chrome.storage.local` directly (established convention), so `captureThemeFromWebApp` is called straight from `content-relay.content.ts`'s `main()`, no round trip through the background service worker.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Turbopack workspace-root boundary blocked resolving `packages/pv-ui`**
- **Found during:** Task 1 (web build verification)
- **Issue:** `export * from "pv-ui/generator/password"` failed with "Module not found" under `next build` (Turbopack) even with `transpilePackages: ["pv-ui"]` set — Turbopack auto-detects the workspace root by walking up to the nearest package-manager lockfile (`web/package-lock.json`, i.e. `web/` itself), and refuses to compile anything outside that boundary ("files outside of the workspace root are not compiled").
- **Fix:** Added `turbopack: { root: path.join(__dirname, "..") }` to `web/next.config.ts`, widening the boundary to the monorepo root (one directory up) so `packages/pv-ui` (a sibling of `web/`) is reachable. Also added a `pv-ui/generator/*` path alias in `web/tsconfig.json` as a belt-and-suspenders fallback (Turbopack's error output showed it was already respecting tsconfig `paths` for the initial resolution attempt, just refusing the resulting path due to the root boundary).
- **Files modified:** `web/next.config.ts`, `web/tsconfig.json`
- **Verification:** `NEXT_PUBLIC_API_BASE_URL="" npx next build` green; compiled theme CSS diffed byte-equivalent (OKLCH values + lightningcss's auto-generated `lab()` fallback) against a pre-extraction baseline build captured before any changes.
- **Committed in:** `83f3165` (Task 1 commit)

**2. [Rule 1 - Bug] `@import` ordering violated CSS spec after inserting the shared-tokens import**
- **Found during:** Task 1 (extension `wxt build`)
- **Issue:** Placing `@import "pv-ui/tokens.css";` after `@plugin "daisyui";` in both `globals.css` and `style.css` triggered a `vite:css` warning: "`@import` must precede all other statements." Non-fatal but a real spec violation that could silently misbehave under a stricter bundler.
- **Fix:** Reordered both files so every `@import` statement (`tailwindcss`, then `pv-ui/tokens.css`) precedes `@plugin "daisyui";`.
- **Files modified:** `web/src/app/globals.css`, `extension/entrypoints/popup/style.css`
- **Verification:** Rebuilt both — no warning, identical compiled CSS content otherwise.
- **Committed in:** `83f3165` (Task 1 commit)

**3. [Rule 1 - Bug] `web/src/lib/generator/password.test.ts` was over-moved, losing web's own local generator test coverage**
- **Found during:** Task 1 (post-move verification — `npx vitest run src/lib/generator` returned "No test files found")
- **Issue:** The move to `packages/pv-ui/generator/password.test.ts` removed the ONLY copy of that test from `web/src/lib/generator/`, unlike `extension/lib/generator/password.test.ts` which was correctly left in place (per the plan's own "test files may remain as-is if they exercise the shims" guidance) — an inconsistency, not an intentional asymmetry.
- **Fix:** Recreated `web/src/lib/generator/password.test.ts` with the same content, exercising the local shim chain (`./password` → `pv-ui/generator/password`), mirroring the extension's existing pattern.
- **Files modified:** `web/src/lib/generator/password.test.ts`
- **Verification:** `cd web && npx vitest run` — 49 files, 345 tests, all pass.
- **Committed in:** `83f3165` (Task 1 commit)

**4. [Rule 1 - Bug] Test-isolation leak: a real `captureThemeFromWebApp` MutationObserver left running across `it()` blocks corrupted a later test's assertion**
- **Found during:** Task 2 (TDD GREEN — `theme-mirror.test.ts`)
- **Issue:** jsdom's `document` is shared across every `it` block in a test file (no per-test environment reset). A `MutationObserver` created by `captureThemeFromWebApp()` in one test and never detached kept reacting to a LATER test's own `data-theme` mutations, causing `detach() stops the observer from reacting to further flips` to fail with the wrong captured value.
- **Fix:** Added a tracked-detach helper + `afterEach` sweep in `theme-mirror.test.ts` so every test that creates an observer (except the dedicated detach test, which detaches itself inline) gets cleaned up between tests.
- **Files modified:** `extension/lib/theme/theme-mirror.test.ts`
- **Verification:** All 14 tests in the file pass, independent of run order.
- **Committed in:** `d1da9ce` (Task 2 GREEN commit)

**5. [Rule 1 - Bug] Same leak class recurred in the `content-relay.test.ts` integration tests for the theme-capture wiring**
- **Found during:** Task 2 (wiring `initThemeCapture()` into `content-relay.content.ts`)
- **Issue:** `content-relay.content.ts`'s `main()` is deliberately fire-and-forget with no teardown hook (correct for production — a real content-script instance's whole JS context is destroyed on navigation). Exercising the REAL `captureThemeFromWebApp` in `content-relay.test.ts` (which calls `main()` fresh in every test's `beforeEach`, matching the file's existing convention) would install a genuine `MutationObserver` that leaks across tests exactly like deviation #4, corrupting a "not on the configured origin" negative-assertion test.
- **Fix:** Mocked `../../lib/theme/theme-mirror`'s `captureThemeFromWebApp` in `content-relay.test.ts` and reframed the new tests as wiring/gating checks ("is it called, and with what argument, exactly when `isConfiguredServerOrigin()` gates true") rather than re-exercising the module's own behavior — which is already fully covered by `theme-mirror.test.ts`'s 14 tests. Cleaner separation of concerns as a side effect, not just a workaround.
- **Files modified:** `extension/entrypoints/__tests__/content-relay.test.ts`
- **Verification:** `npx vitest run lib/theme entrypoints/__tests__/content-relay` — 26 tests, all pass, independent of run order.
- **Committed in:** `fd15837` (Task 2 wiring commit)

---

**Total deviations:** 5 auto-fixed (1 Turbopack workspace-root blocking issue, 1 CSS spec-compliance bug, 1 lost test-coverage bug, 2 test-isolation leak bugs)
**Impact on plan:** All auto-fixes were necessary to make the plan's own stated verification commands (`npm run build`, `wxt build`, `vitest run`) actually pass, or to restore test coverage the move itself accidentally dropped. No scope creep — nothing outside Task 1/Task 2's own files was touched.

## Issues Encountered

None beyond the deviations documented above — no auth gates, no checkpoints, no architectural decisions requiring a stop.

## Known Stubs

None. `packages/pv-ui/tokens.css` intentionally omits the DaisyUI-generated `lab()` progressive-enhancement fallback and the `theme-controller` radio-input selector variant (neither used by this app — theme is set imperatively via `data-theme`, not radio inputs) — a deliberate, documented trade-off (see `tokens.css`'s own header comment), not a stub blocking any goal.

## Threat Flags

None. The theme-mirror pipeline's own surface (T-11-30/T-11-31) was already scoped in the plan's own threat model and mitigated exactly as specified (enum validation both directions, `isConfiguredServerOrigin()` gating). No new network endpoints, auth paths, or schema changes were introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `packages/pv-ui/tokens.css` is ready for plan 11-08 to consume as raw CSS text for the in-page shadow-DOM surfaces — it's already framework-agnostic plain CSS by design.
- `resolveTheme()`/`watchMirroredTheme()` from `extension/lib/theme/theme-mirror.ts` are ready for 11-08's in-page overlay/popover/toast/modal to import directly for theme resolution, without needing any new plumbing.
- The 3 in-page files that still carry their own hardcoded token copies (`extension/lib/autofill/inpage-overlay.ts`, `save-update-toast.ts`, `generate-popover.ts`) are exactly what 11-08 is scoped to restyle — confirmed via grep, not touched by this plan (per the orchestrator's explicit "you are NOT touching those files this plan" reinforcement).
- **Recommend a joint visual UAT for 11-07+11-08 together** (see coverage D2's rationale) rather than a standalone real-browser check here, since the mirror's end-to-end visual payoff (popup actually following the web app's theme) is most meaningfully verified alongside 11-08's in-page restyling in the same session.

---
*Phase: 11-generate-capture*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 9 spot-checked files exist on disk; all 4 task commit hashes (83f3165, be119df, d1da9ce, fd15837) verified present in git log.
