---
phase: 17-shared-component-visual-alignment
plan: 01
subsystem: infra
tags: [tailwind, npm, monorepo, exports-map, react, lucide-react, docker, wxt, turbopack, vite]

# Dependency graph
requires:
  - phase: 16-design-system-extraction
    provides: packages/pv-ui with pure .ts/.css exports (no runtime peer deps), exports-map-is-sole-authority precedent (WR-02)
provides:
  - packages/pv-ui local node_modules for react/react-dom/lucide-react (Option A fix for Turbopack/Vite/tsc resolution of a .tsx importing lucide-react from outside either consumer's own node_modules)
  - packages/pv-ui/package.json ./components/* exports wildcard subpath, ready for any future .tsx under packages/pv-ui/components/
  - Both consumers' prebuild/predev bootstrap chains and the Dockerfile web-builder stage materialize pv-ui's own install automatically
  - Tailwind @source directive in both consumers' CSS entry points, scanning packages/pv-ui/components/**/*.tsx for classes
  - Live, build-verified proof (not inferred) that a real .tsx importing both react and lucide-react resolves cleanly under vitest, tsc --noEmit, next build (Turbopack), and wxt build -b chrome (Vite)
affects: [17-02, 17-03, 17-04, future pv-ui React components]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "packages/pv-ui gets its own local node_modules for react/react-dom/lucide-react peer deps, installed via npm install/npm ci, gitignored but with a committed package-lock.json — the fix for a source-only shared package whose consumers each have independent, non-workspace node_modules trees"
    - "Both consumers' prebuild/predev scripts chain `bash ../scripts/build-wasm.sh && (cd ../packages/pv-ui && npm ci)` — mirrors the existing WASM bootstrap pattern"
    - "Dockerfile web-builder stage: `RUN cd /app/packages/pv-ui && npm ci` runs right after COPY packages/pv-ui/ and before web's own --ignore-scripts npm ci, since --ignore-scripts also skips web's own prebuild hook"

key-files:
  created:
    - packages/pv-ui/package-lock.json
  modified:
    - packages/pv-ui/package.json
    - web/package.json
    - extension/package.json
    - Dockerfile
    - web/src/app/globals.css
    - extension/entrypoints/popup/style.css

key-decisions:
  - "packages/pv-ui/package.json's pre-existing exports map already had 11 entries (not 10 as PLAN.md's <read_first> claimed) — the correct post-task total after adding ./components/* is 12, not the plan's hardcoded verify-script assertion of 11. Documented as a deviation; all 11 pre-existing entries preserved verbatim, only the new wildcard entry added."
  - "Smoke component (packages/pv-ui/components/_infra-smoke.tsx) proved real resolution + Tailwind class generation via a genuine side-effect import in both consumers' real bundled entrypoints (web/src/app/layout.tsx, extension/entrypoints/popup/main.tsx), never an unreachable route — then fully removed with a second green pass confirming no dangling scaffold."

patterns-established:
  - "Any future packages/pv-ui/components/*.tsx file needs zero new package.json exports entries — the ./components/* wildcard already covers it"

requirements-completed: [DS-03]

coverage:
  - id: D1
    description: "packages/pv-ui/package.json declares peerDependencies/devDependencies for react/react-dom/lucide-react byte-identical to web/extension's locked versions, plus @types/react in devDependencies, and a ./components/* exports wildcard subpath"
    requirement: "DS-03"
    verification:
      - kind: unit
        ref: "node -e version-match assertion (Task 1 <verify> block, adjusted for actual 12-entry exports count)"
        status: pass
    human_judgment: false
  - id: D2
    description: "packages/pv-ui/node_modules resolves react and lucide-react for a file physically outside either consumer's own node_modules tree, proven live against vitest, tsc --noEmit, next build (Turbopack), and wxt build -b chrome (Vite) via a throwaway smoke component, twice (present and removed)"
    requirement: "DS-03"
    verification:
      - kind: unit
        ref: "web: npx vitest run (481 tests), npx tsc --noEmit, npx next build — all green with smoke present and after removal"
        status: pass
      - kind: unit
        ref: "extension: npx vitest run (685 tests), npx tsc --noEmit, npx wxt build -b chrome — all green with smoke present and after removal"
        status: pass
      - kind: other
        ref: "grep marker classes tracking-[13.37px] / bg-[#0a1b2c] in web/out/_next/static/chunks/*.css and extension/.output/chrome-mv3/assets/*.css"
        status: pass
    human_judgment: false
  - id: D3
    description: "Neither web/tsconfig.json nor extension/tsconfig.json gains a new path alias — exports map + pv-ui's own local node_modules remain the sole resolution mechanism"
    requirement: "DS-03"
    verification:
      - kind: other
        ref: "git diff shows no tsconfig.json changes in either consumer across this plan's commits"
        status: pass
    human_judgment: false
  - id: D4
    description: "Both consumers' CSS entry points gain the @source directive for packages/pv-ui/components/**/*.tsx"
    requirement: "DS-03"
    verification:
      - kind: unit
        ref: "grep -q '@source \"../../../packages/pv-ui/components/**/*.tsx\";' in both web/src/app/globals.css and extension/entrypoints/popup/style.css"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-21
status: complete
---

# Phase 17 Plan 01: pv-ui Peer-Dependency Infra Fix Summary

**packages/pv-ui gets its own local node_modules for react/react-dom/lucide-react (Option A), wired into both consumers' bootstrap hooks and the Dockerfile, plus the Tailwind @source directive both consumers need — live-verified via a throwaway smoke component that a real .tsx importing both react and lucide-react resolves cleanly under vitest, tsc, Turbopack (next build), and Vite (wxt build).**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-21T08:25:21Z (approx, from STATE.md handoff)
- **Completed:** 2026-07-21T08:32:04Z
- **Tasks:** 2
- **Files modified:** 7 (5 config/build files + 2 CSS files); 1 file created (package-lock.json); 1 file created-then-deleted (net zero diff, the smoke component)

## Accomplishments
- packages/pv-ui/package.json now declares peerDependencies/devDependencies for react (19.2.7), react-dom (19.2.7), lucide-react (1.24.0), plus @types/react (19.2.17) in devDependencies only — every version copy-pasted verbatim from web/package.json and extension/package.json's own locked versions
- packages/pv-ui/node_modules materialized via `npm install`, with package-lock.json committed for reproducibility
- Added `./components/*` exports wildcard subpath to packages/pv-ui/package.json — covers every future file under packages/pv-ui/components/ with zero further exports-map edits
- Wired `(cd ../packages/pv-ui && npm ci)` into web/package.json's and extension/package.json's prebuild/predev scripts, chained after the existing `bash ../scripts/build-wasm.sh` step
- Dockerfile web-builder stage gains `RUN cd /app/packages/pv-ui && npm ci` immediately after `COPY packages/pv-ui/ /app/packages/pv-ui/` and before web's own `--ignore-scripts npm ci`
- Both web/src/app/globals.css and extension/entrypoints/popup/style.css gain `@source "../../../packages/pv-ui/components/**/*.tsx";` so Tailwind's content scanner reaches shared components
- Live-proved the whole pipeline with a throwaway `packages/pv-ui/components/_infra-smoke.tsx` (useState + lucide-react Globe icon + two unmistakable marker Tailwind arbitrary-value classes), side-effect-imported into both consumers' REAL bundled entrypoints (web/src/app/layout.tsx, extension/entrypoints/popup/main.tsx — never an unreachable route). Ran the full vitest/tsc/build chain for both consumers TWICE: once with the smoke component present (confirming marker classes `tracking-[13.37px]` and `bg-[#0a1b2c]` reached the compiled CSS in both web/out/_next/static/chunks/*.css and extension/.output/chrome-mv3/assets/*.css), and once after fully removing the smoke component + both temporary imports (confirming zero dangling references and continued green builds)

## Task Commits

Each task was committed atomically:

1. **Task 1: pv-ui peerDependencies/devDependencies + exports subpath + install step wiring** - `e4dfed8` (feat)
2. **Task 2: @source directives + throwaway smoke component proving Vite/Turbopack/tsc/WXT resolution** - `bad3bbd` (feat)

_Note: the smoke component itself (packages/pv-ui/components/_infra-smoke.tsx) and its two temporary import lines were created and fully removed within Task 2's own work, before that commit — zero net diff on those three files, per the plan's explicit "Deleted: none persist past this plan" artifact contract._

## Files Created/Modified
- `packages/pv-ui/package.json` - +peerDependencies, +devDependencies, +./components/* exports wildcard (12 total exports entries — see Deviations)
- `packages/pv-ui/package-lock.json` - new, committed, makes the 4 peer packages reproducibly installable
- `web/package.json` - prebuild/predev gain `(cd ../packages/pv-ui && npm ci)`
- `extension/package.json` - prebuild/predev gain `(cd ../packages/pv-ui && npm ci)`
- `Dockerfile` - web-builder stage gains `RUN cd /app/packages/pv-ui && npm ci`
- `web/src/app/globals.css` - +`@source "../../../packages/pv-ui/components/**/*.tsx";`
- `extension/entrypoints/popup/style.css` - +`@source "../../../packages/pv-ui/components/**/*.tsx";`

## Decisions Made
- Used the plan's Option A fix exactly as specified (local node_modules for pv-ui's peer deps) rather than any tsconfig path-alias workaround, preserving the Phase 16 "exports map is sole authority" precedent (WR-02).
- Smoke-test verification used a genuine side-effect import in each consumer's real bundled entrypoint (never an underscore-prefixed/unreachable route), per RESEARCH.md's own Pitfall 1 warning about false "Compiled successfully" signals from unreached code paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Plan documentation error] Exports-map baseline was 11 entries, not 10 as PLAN.md's `<read_first>` claimed**
- **Found during:** Task 1's verification step
- **Issue:** PLAN.md's Task 1 `<read_first>` describes packages/pv-ui/package.json as having a "current 10-entry exports map", and the automated `<verify>` script hardcodes `Object.keys(pv.exports).length !== 11` as its success assertion (10 existing + 1 new). Reading the actual file showed the pre-existing exports map already had 11 entries (tokens.css, generator/password, generator/strength, generator/wordlist, vault/cardBrand, vault/search, vault/sort, vault/types, clipboard, i18n/engine, i18n/common) — a planning-time miscount, not an implementation bug.
- **Fix:** Implemented the task's `<action>` exactly as written (added exactly one new `./components/*` wildcard entry, touching nothing else), then ran the verify script with the count assertion corrected to `!== 12` (11 pre-existing + 1 new) to match the real, correct baseline. All 11 pre-existing entries are preserved byte-for-byte; only the new wildcard entry was added.
- **Files modified:** packages/pv-ui/package.json (same file the task already modified — no additional files touched)
- **Verification:** Ran the corrected assertion; confirmed all 12 exports entries present, all 11 originals untouched, `./components/*` correctly shaped as `{ "types": "./components/*.tsx", "default": "./components/*.tsx" }`
- **Committed in:** e4dfed8 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 plan-documentation-error correction, no code/behavior change)
**Impact on plan:** Zero impact on the actual deliverable — the exports map content is exactly what the plan's `<action>` specified; only the plan's own pre-existing-count assumption (and the verify script's hardcoded number derived from it) was stale. No scope creep, no architectural change.

## Issues Encountered
None beyond the exports-count deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 17-03's real `ItemIconTile.tsx` promotion into `packages/pv-ui/components/` can now build cleanly under vitest, tsc, Turbopack (next build), and Vite (wxt build) in both web/ and extension/, with zero tsconfig workaround — this plan's own smoke test is live proof of exactly that build pipeline, not an inference from RESEARCH.md's prior probe.
- No blockers for 17-02/17-03/17-04.

---
*Phase: 17-shared-component-visual-alignment*
*Completed: 2026-07-21*

## Self-Check: PASSED

All created/modified files confirmed present on disk; both task commits (`e4dfed8`, `bad3bbd`) confirmed in git log.
