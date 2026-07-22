---
phase: 16-design-system-extraction-logic-types-i18n
plan: 01
subsystem: infra
tags: [typescript, package-exports, tsconfig, monorepo, pv-ui]

# Dependency graph
requires: []
provides:
  - "packages/pv-ui/package.json exports map with 7 new subpaths (vault/cardBrand, vault/search, vault/sort, vault/types, clipboard, i18n/engine, i18n/common) ready for Wave 2/3 file creation"
  - "web/tsconfig.json paths map with 3 new pv-ui subpath aliases (pv-ui/vault/*, pv-ui/i18n/*, pv-ui/clipboard)"
  - "verified pre-migration baseline: web vitest 474/474, web tsc clean, extension vitest 678/678, extension tsc clean"
affects: [16-02, 16-03, 16-04, 16-05, 16-06]

# Tech tracking
tech-stack:
  added: []
  patterns: ["package.json exports map subpath convention ({types, default} two-key shape) extended to vault/i18n/clipboard subpaths, mirroring the existing generator/* precedent from Phase 11 Plan 11-07"]

key-files:
  created: []
  modified:
    - packages/pv-ui/package.json
    - web/tsconfig.json

key-decisions:
  - "extension/tsconfig.json required zero edits — moduleResolution bundler resolves pv-ui subpaths via the package.json exports map alone, confirmed by the pre-existing pv-ui/generator/* precedent and re-confirmed by a green extension tsc --noEmit after this plan's changes"
  - "Fresh worktree checkout required running scripts/build-wasm.sh (Rule 3, blocking issue) before the plan's own baseline verify step could run — web's vitest suite fails at import-resolution with no built WASM glue, this is expected first-run environment setup, not a plan defect"
  - "extension tsc --noEmit failed once after the WASM build alone (WXT's generated PublicPath type didn't yet know about extension/public/wasm/pv_wasm_bg.wasm because postinstall's wxt prepare ran before the WASM artifact existed) — re-running npx wxt prepare after the WASM build regenerated the type and resolved it (Rule 3, blocking issue, no source change)"

requirements-completed: [DS-01, DS-02]

coverage:
  - id: D1
    description: "packages/pv-ui/package.json exports map gains 7 new subpaths (./vault/cardBrand, ./vault/search, ./vault/sort, ./vault/types, ./clipboard, ./i18n/engine, ./i18n/common), all 4 pre-existing entries kept byte-identical"
    requirement: "DS-01"
    verification:
      - kind: unit
        ref: "node -e exports-map presence/byte-identity check (Task 1 automated verify)"
        status: pass
    human_judgment: false
  - id: D2
    description: "web/tsconfig.json paths map gains 3 new pv-ui subpath aliases (pv-ui/vault/*, pv-ui/i18n/*, pv-ui/clipboard); extension/tsconfig.json left untouched; full pre-migration baseline (web+extension vitest and tsc) confirmed green"
    requirement: "DS-02"
    verification:
      - kind: unit
        ref: "node -e paths-map presence/byte-identity check (Task 2 automated verify)"
        status: pass
      - kind: integration
        ref: "web: npx vitest run (474/474 passed)"
        status: pass
      - kind: integration
        ref: "web: npx tsc --noEmit (clean)"
        status: pass
      - kind: integration
        ref: "extension: npx vitest run (678/678 passed)"
        status: pass
      - kind: integration
        ref: "extension: npx tsc --noEmit (clean, after re-running wxt prepare)"
        status: pass
    human_judgment: false

duration: 15min
completed: 2026-07-20
status: complete
---

# Phase 16 Plan 01: pv-ui Exports Map + web tsconfig Paths Aliases Summary

**Added the 7 pv-ui package.json exports entries and 3 web/tsconfig.json paths aliases every Wave 2/3 migration plan in Phase 16 needs, with a fully green pre-migration baseline (web+extension vitest and tsc) as proof this pure-config change is zero-behavior-change.**

## Performance

- **Duration:** ~15 min
- **Tasks:** 2 completed
- **Files modified:** 2

## Accomplishments
- `packages/pv-ui/package.json` exports map grew from 4 to 11 entries — the 7 new subpaths (`./vault/cardBrand`, `./vault/search`, `./vault/sort`, `./vault/types`, `./clipboard`, `./i18n/engine`, `./i18n/common`) unblock 4 independent Wave-2/3 plans that will each write `export * from "pv-ui/<subpath>"` shims.
- `web/tsconfig.json` paths map grew from 2 to 5 entries — added `pv-ui/vault/*`, `pv-ui/i18n/*`, `pv-ui/clipboard` as belt-and-suspenders IDE/tsc resolution, mirroring the existing `pv-ui/generator/*` precedent.
- `extension/tsconfig.json` confirmed to need zero edits — `moduleResolution: bundler` resolves pv-ui subpaths via the package.json exports map alone, verified by a green `extension` `tsc --noEmit` after this plan's changes.
- Established and verified the pre-migration baseline every Wave 2/3 plan builds on: web vitest 474/474, web tsc clean, extension vitest 678/678, extension tsc clean.

## Task Commits

1. **Task 1: pv-ui package.json exports map — add 7 new subpaths** - `919e076` (feat)
2. **Task 2: web/tsconfig.json paths aliases + pre-migration baseline verification** - `26c796e` (feat)

_Note: no plan-metadata commit in worktree mode — the orchestrator commits shared STATE.md/ROADMAP.md updates centrally after merge; this SUMMARY.md is committed separately below per worktree protocol._

## Files Created/Modified
- `packages/pv-ui/package.json` - exports map: 4 → 11 entries (7 new subpaths added, all pointing at `.ts` files that don't exist yet — inert until Wave 2/3 creates them)
- `web/tsconfig.json` - compilerOptions.paths: 2 → 5 entries (3 new aliases added)

## Decisions Made
- extension/tsconfig.json required zero edits (see key-decisions above) — confirmed, not assumed, via a passing `tsc --noEmit` after this plan's changes.
- Fresh worktree checkout needed `scripts/build-wasm.sh` run before any web vitest/tsc could pass (WASM glue is a gitignored build artifact, not a plan defect) — see Deviations.
- extension's WXT-generated `PublicPath` type needed a `wxt prepare` re-run after the WASM build placed `extension/public/wasm/pv_wasm_bg.wasm` on disk (postinstall's `wxt prepare` ran before that file existed) — see Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Fresh worktree missing WASM build artifacts**
- **Found during:** Task 2 (baseline verification step)
- **Issue:** `npx vitest run` in `web/` failed 3 test files with `Failed to resolve import "./wasm/pv_wasm.js"` — `web/src/lib/crypto/wasm/` and `extension/lib/crypto/wasm/` are gitignored build outputs (confirmed via `git check-ignore -v`) that a fresh worktree checkout never has until `scripts/build-wasm.sh` runs. Not a plan defect — this plan doesn't touch crypto/WASM code at all.
- **Fix:** Ran `./scripts/build-wasm.sh` (builds `pv-wasm` for `wasm32-unknown-unknown`, runs `wasm-bindgen` for both `web/` and `extension/` output targets).
- **Files modified:** none tracked (all outputs are gitignored build artifacts: `web/src/lib/crypto/wasm/`, `web/public/wasm/`, `extension/lib/crypto/wasm/`, `extension/public/wasm/`).
- **Verification:** Re-ran `npx vitest run` in `web/` — 474/474 passed.
- **Committed in:** n/a (gitignored artifacts, nothing to commit).

**2. [Rule 3 - Blocking issue] extension tsc failure from stale WXT-generated PublicPath type**
- **Found during:** Task 2 (baseline verification step, after the WASM-build fix above)
- **Issue:** `npx tsc --noEmit` in `extension/` failed with `No overload matches this call` on `lib/crypto/wasm-loader.ts:125` — `extension/public/wasm/pv_wasm_bg.wasm` didn't exist yet when `npm ci`'s `postinstall` ran `wxt prepare`, so WXT's generated `PublicPath` union type didn't include it.
- **Fix:** Re-ran `npx wxt prepare` after the WASM build to regenerate WXT's type declarations from the now-present `public/wasm/pv_wasm_bg.wasm`.
- **Files modified:** none tracked (WXT's generated types live in the gitignored `.wxt/` directory).
- **Verification:** Re-ran `npx tsc --noEmit` in `extension/` — clean, zero errors.
- **Committed in:** n/a (gitignored generated types, nothing to commit).

---

**Total deviations:** 2 auto-fixed (both Rule 3 — blocking issues, both environment-setup-only, zero tracked-file changes beyond the plan's own two files).
**Impact on plan:** Both deviations were pure fresh-worktree environment bootstrapping (gitignored build artifacts and generated types), required to even run the plan's own mandated verification commands. No scope creep, no source-code changes beyond `packages/pv-ui/package.json` and `web/tsconfig.json` exactly as planned.

## Issues Encountered
None beyond the environment-bootstrapping deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Every exports subpath and path-alias Wave 2 (Plans 16-02 through 16-04) and Wave 3 needs is now declared and resolvable. No consumer's build/test/type-check state has moved beyond the pre-plan baseline — confirmed green across all four gates (web vitest, web tsc, extension vitest, extension tsc). No blockers for downstream plans.

---
*Phase: 16-design-system-extraction-logic-types-i18n*
*Completed: 2026-07-20*

## Self-Check: PASSED

- FOUND: packages/pv-ui/package.json
- FOUND: web/tsconfig.json
- FOUND: .planning/phases/16-design-system-extraction-logic-types-i18n/16-01-SUMMARY.md
- FOUND: 919e076 (Task 1 commit)
- FOUND: 26c796e (Task 2 commit)
- FOUND: f69b546 (SUMMARY.md commit)
