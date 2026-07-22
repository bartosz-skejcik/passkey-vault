---
phase: 16-design-system-extraction-logic-types-i18n
plan: 04
subsystem: i18n
tags: [typescript, i18n, generics, pv-ui, monorepo]

# Dependency graph
requires: ["16-01"]
provides:
  - "packages/pv-ui/i18n/engine.ts: Locale, generic t<D>(dict, locale, key), interpolate(), resolveLocale()"
  - "packages/pv-ui/i18n/common.ts: COMMON_DICTIONARY (34 shared, value-identical keys)"
  - "web/src/lib/i18n/dictionary.ts and extension/lib/i18n/dictionary.ts refactored to thin wrappers over the shared engine, zero call-site churn"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "generic t<D extends Record<string, Record<Locale, string>>>(dict, locale, key) engine + per-consumer thin wrapper preserving each surface's own keyof narrowing — first genuinely new logic pv-ui/i18n introduces (vs. the pure move-only extraction of interpolate()/resolveLocale())"
    - "DICTIONARY = { ...COMMON_DICTIONARY, ...local-only-entries } satisfies Record<...> spread pattern for splitting a shared/local dictionary without touching call sites"
    - "vi.stubGlobal(\"navigator\", ...) (not Object.defineProperty) for environment-agnostic navigator stubbing, so one identical test file behaves correctly under both jsdom (web) and node (extension background) vitest environments"

key-files:
  created:
    - packages/pv-ui/i18n/engine.ts
    - packages/pv-ui/i18n/engine.test.ts
    - web/src/lib/i18n/engine.test.ts
    - extension/lib/i18n/engine.test.ts
    - packages/pv-ui/i18n/common.ts
  modified:
    - web/src/lib/i18n/dictionary.ts
    - extension/lib/i18n/dictionary.ts
    - extension/lib/i18n/autofill-dictionary.ts

key-decisions:
  - "Live key-by-key re-diff (Node script, brace/comment-aware object-literal extractor) of both consumers' DICTIONARY objects at execution time, per the plan's own instruction not to trust its pre-listed set blindly — confirmed exactly 34 identical / 4 divergent (vault.emptyHeading, vault.emptyBody, search.emptyResults, autolock.label), matching the plan's numbers exactly with zero discrepancy"
  - "web/extension's engine.test.ts copies import the shared engine directly from pv-ui/i18n/engine (not a local ./engine relative import) — unlike the generator/password.test.ts x3 precedent, no local engine.ts shim file exists in web/ or extension/ this phase; only the canonical packages/pv-ui/i18n/engine.test.ts uses a relative ./engine import"
  - "Test navigator stubbing uses vi.stubGlobal(\"navigator\", ...) for ALL three resolveLocale() cases (including the 'undefined' case) rather than relying on each environment's ambient default — makes the identical 3-copy test file behave correctly whether it runs under web's jsdom (navigator defined by default) or extension's node background project (navigator undefined by default)"

requirements-completed: [DS-02]

coverage:
  - id: T1
    description: "packages/pv-ui/i18n/engine.ts exports Locale/t<D>()/interpolate()/resolveLocale(); 3 identical engine.test.ts copies (canonical + web + extension) all green"
    requirement: "DS-02"
    verification:
      - kind: unit
        ref: "TDD RED->GREEN: web `npx vitest run src/lib/i18n/engine.test.ts` (6/6) and extension `npx vitest run lib/i18n/engine.test.ts` (6/6)"
        status: pass
    human_judgment: false
  - id: T2
    description: "packages/pv-ui/i18n/common.ts holds exactly the verified 34 shared keys; web/src/lib/i18n/dictionary.ts refactored to a thin wrapper (same 286 total key count, t()/interpolate()/Locale signature unchanged)"
    requirement: "DS-02"
    verification:
      - kind: unit
        ref: "Live key-by-key diff script confirming 34 identical / 4 divergent"
        status: pass
      - kind: integration
        ref: "web: npx vitest run (480/480 passed, up from 474 pre-plan baseline + 6 new engine tests)"
        status: pass
      - kind: integration
        ref: "web: npx tsc --noEmit (clean)"
        status: pass
      - kind: manual
        ref: "throwaway vitest smoke test: Object.keys(DICTIONARY).length === 286 (unchanged from pre-refactor)"
        status: pass
    human_judgment: false
  - id: T3
    description: "extension/lib/i18n/dictionary.ts refactored to a thin wrapper (same 81 total key count including all 4 divergent-copy keys with extension-specific text preserved); autofill-dictionary.ts imports interpolate/Locale from pv-ui/i18n/engine directly"
    requirement: "DS-02"
    verification:
      - kind: integration
        ref: "extension: npx vitest run (684/684 passed, up from 678 pre-plan baseline + 6 new engine tests)"
        status: pass
      - kind: integration
        ref: "extension: npx tsc --noEmit (clean)"
        status: pass
      - kind: integration
        ref: "extension: npx vitest run entrypoints/background/server-config.test.ts entrypoints/__tests__/no-ext-scoped-prf-strings.test.ts (25/25, both structural guards pass)"
        status: pass
      - kind: manual
        ref: "throwaway vitest smoke test: Object.keys(DICTIONARY).length === 81 (unchanged from pre-refactor)"
        status: pass
    human_judgment: false

duration: ~25min (incl. fresh-worktree environment bootstrap)
completed: 2026-07-20
status: complete
---

# Phase 16 Plan 04: Shared i18n Engine + common.ts Dictionary Split Summary

**Extracted `t`/`interpolate`/`Locale`/`resolveLocale` into a single shared `packages/pv-ui/i18n/engine.ts` (with a genuinely generic `t<D>()`, the one new-logic piece of this move-heavy extraction), split 34 byte-identical dictionary keys into `packages/pv-ui/i18n/common.ts`, and refactored both consumers' `dictionary.ts` into thin wrappers — zero call-site churn, zero copy drift, DS-02 closed.**

## Performance

- **Duration:** ~25 min (includes one-time fresh-worktree environment bootstrap: `node_modules` provisioning, WASM build, `wxt prepare`)
- **Tasks:** 3 completed (Task 1 TDD: RED then GREEN)
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments

- `packages/pv-ui/i18n/engine.ts` is now the single shared i18n resolver: `Locale` type (moved verbatim), a new generic `t<D extends Record<string, Record<Locale, string>>>(dict, locale, key)` (the only genuinely new logic this extraction writes — today's per-file `t()` was never generic), `interpolate()` moved byte-for-byte from web's dictionary.ts, `resolveLocale()` moved byte-for-byte from extension's dictionary.ts.
- Followed strict TDD for Task 1: wrote 3 identical failing `engine.test.ts` copies first (confirmed RED in both web and extension vitest runs — `Cannot find module`), committed RED, then implemented `engine.ts` to GREEN (6/6 in both consumers).
- `packages/pv-ui/i18n/common.ts` holds `COMMON_DICTIONARY` — exactly 34 key-name-AND-value-identical entries, re-verified via a live Node script diff of both consumers' actual `DICTIONARY` objects at execution time (not trusted from the plan's own pre-listed set) — confirmed the exact same 34/4 split the plan's RESEARCH found, with zero discrepancy.
- `web/src/lib/i18n/dictionary.ts` refactored to a thin wrapper: `DICTIONARY` now spreads `COMMON_DICTIONARY` plus its remaining 252 web-only entries (286 total, unchanged); `t()` delegates to the shared engine; `interpolate`/`Locale` re-exported unchanged.
- `extension/lib/i18n/dictionary.ts` refactored the same way: spreads `COMMON_DICTIONARY` plus its remaining 47 extension-only entries, **including all 4 divergent-copy keys** (`vault.emptyHeading`, `vault.emptyBody`, `search.emptyResults`, `autolock.label`) with their extension-specific PL/EN copy preserved verbatim (81 total, unchanged); also re-exports `resolveLocale`.
- `extension/lib/i18n/autofill-dictionary.ts`'s `interpolate`/`Locale` imports switched from `./dictionary` to `pv-ui/i18n/engine` directly — `AUTOFILL_DICTIONARY` and its own local `t()` untouched.

## Task Commits

1. **Task 1 RED: failing engine.test.ts (3 copies)** - `0e685c2` (test)
2. **Task 1 GREEN: pv-ui/i18n/engine.ts implementation** - `dcec5bf` (feat)
3. **Task 2: pv-ui/i18n/common.ts + web dictionary.ts thin-wrapper refactor** - `ccc2e7f` (feat)
4. **Task 3: extension dictionary.ts thin-wrapper refactor + autofill-dictionary.ts engine import switch** - `e603561` (feat)

_Note: no plan-metadata commit in worktree mode — the orchestrator commits shared STATE.md/ROADMAP.md updates centrally after merge; this SUMMARY.md is committed separately below per worktree protocol._

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed the full RED -> GREEN cycle:
- RED (`0e685c2`, `test(16-04): ...`): 3 identical `engine.test.ts` copies added; confirmed failing in both web (`Cannot find module './engine'`... resolved to `pv-ui/i18n/engine`) and extension vitest runs before any implementation existed.
- GREEN (`dcec5bf`, `feat(16-04): ...`): `packages/pv-ui/i18n/engine.ts` implemented; all 3 test copies pass (6/6 each in web and extension); full suites (web 480/480, extension 684/684) and `tsc --noEmit` confirmed clean in both, proving zero regression from the new export.

No REFACTOR-phase commit was needed — the implementation was correct on the first GREEN pass with no follow-up cleanup required.

## Files Created/Modified

- `packages/pv-ui/i18n/engine.ts` (new) — `Locale`, `t<D>()`, `interpolate()`, `resolveLocale()`
- `packages/pv-ui/i18n/engine.test.ts` (new) — canonical test, orphan-but-kept (not wired into any script, mirrors the `generator/password.test.ts` x3 precedent)
- `web/src/lib/i18n/engine.test.ts` (new) — local recreation, imports `pv-ui/i18n/engine` directly
- `extension/lib/i18n/engine.test.ts` (new) — local recreation, imports `pv-ui/i18n/engine` directly
- `packages/pv-ui/i18n/common.ts` (new) — `COMMON_DICTIONARY`, 34 verified shared keys
- `web/src/lib/i18n/dictionary.ts` (modified) — thin wrapper; 34 keys' definitions removed (now arrive via spread), `t()` delegates to `tEngine`, `interpolate`/`Locale` re-exported
- `extension/lib/i18n/dictionary.ts` (modified) — thin wrapper; 34 keys' definitions removed (the 4 divergent keys kept local), `t()` delegates to `tEngine`, `interpolate`/`Locale`/`resolveLocale` re-exported
- `extension/lib/i18n/autofill-dictionary.ts` (modified) — `interpolate`/`Locale` imports repointed from `./dictionary` to `pv-ui/i18n/engine`

## Decisions Made

- Re-verified the 34/4 dictionary key split live at execution time via a purpose-built Node script (brace/comment-aware object-literal extractor, since the DICTIONARY objects use TS `satisfies` syntax that plain `require()`/`JSON.parse` can't handle) rather than trusting the plan's own pre-listed key names — the plan explicitly required this re-verification given Phase 15's unrelated 370->301-line edit to extension's dictionary.ts between research and this plan's execution. Result: exact match, zero discrepancy, no note needed in this section beyond confirming the process ran.
- Deviated the test files' import source from the literal generator-precedent pattern: web/extension's `engine.test.ts` import `pv-ui/i18n/engine` directly rather than a local relative `./engine`, since (unlike the generator precedent) this plan does not create a local `engine.ts` shim file in either consumer — the plan's own action text called this out explicitly ("each importing directly from `pv-ui/i18n/engine`").
- Used `vi.stubGlobal("navigator", ...)` for every `resolveLocale()` test case (including the "undefined" case), rather than relying on each vitest project's ambient default (jsdom for web vs. node for extension's background project) — this keeps the file byte-identical across all three copies while behaving correctly regardless of which environment runs it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Fresh worktree missing `node_modules` and WASM build artifacts**
- **Found during:** initial environment verification, before Task 1
- **Issue:** This worktree had no `node_modules` in `web/` or `extension/` at all (unlike Plan 16-01's worktree, which apparently had them pre-provisioned or ran `npm install` itself) — a completely fresh worktree checkout. Additionally, once `node_modules` existed, `web`'s vitest failed on missing WASM glue (`./wasm/pv_wasm.js`, a gitignored build artifact) and `extension`'s vitest/tsc failed on a stale/missing WXT-generated `.wxt/tsconfig.json` and types.
- **Fix:** `rsync -a` copied `node_modules/` from the main repo checkout into this worktree for both `web/` and `extension/` (confirmed the `pv-ui` symlink inside each — a relative symlink `../../packages/pv-ui` — correctly re-resolves to *this worktree's own* `packages/pv-ui` after the copy, not the main repo's, since relative symlink targets resolve against their physical containing directory). Then ran `scripts/build-wasm.sh` (produces `web/src/lib/crypto/wasm/`, `web/public/wasm/`, `extension/lib/crypto/wasm/`, `extension/public/wasm/` — all gitignored) and `npx wxt prepare` in `extension/` (regenerates `.wxt/` gitignored types/tsconfig).
- **Files modified:** none tracked (all outputs are gitignored: `node_modules/`, `*/wasm/`, `.wxt/`).
- **Verification:** Post-fix baseline: web vitest 474/474 + tsc clean; extension vitest 678/678 + tsc clean — matching Plan 16-01's own documented pre-migration baseline exactly, confirming this was pure environment bootstrapping with zero effect on source state.
- **Committed in:** n/a (gitignored artifacts, nothing to commit).

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking issue, environment-setup-only, zero tracked-file changes beyond the plan's own 8 files).
**Impact on plan:** Pure fresh-worktree environment bootstrapping, required to even run the plan's own mandated verification commands. No scope creep, no source-code changes beyond what Tasks 1-3 specify.

## Known Stubs

None — this plan introduces zero UI-facing stubs; both dictionaries' full key sets remain wired exactly as before, only relocated.

## Threat Flags

None — this plan's own `<threat_model>` (T-16-06/07/08) already covers the new surface (pure string lookup/substitution/locale-detection, zero I/O, zero crypto imports; compile-time `keyof` narrowing preserved per-consumer; live re-diff proof against copy drift). No additional trust-boundary-relevant surface was introduced beyond what that threat model already anticipated.

## Issues Encountered

None beyond the environment-bootstrapping deviation documented above.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

DS-02 closes: `packages/pv-ui/i18n/engine.ts` is the single shared i18n resolver consumed identically by web and extension; dictionary keys are split with zero copy drift on either surface (live-diff-verified, not just plan-text-verified). No consumer's test/type-check state moved beyond an incremental addition (6 new passing tests each, everything else unchanged). No blockers for downstream plans (16-05, 16-06).

---
*Phase: 16-design-system-extraction-logic-types-i18n*
*Completed: 2026-07-20*

## Self-Check: PASSED

- FOUND: packages/pv-ui/i18n/engine.ts
- FOUND: packages/pv-ui/i18n/engine.test.ts
- FOUND: web/src/lib/i18n/engine.test.ts
- FOUND: extension/lib/i18n/engine.test.ts
- FOUND: packages/pv-ui/i18n/common.ts
- FOUND: 0e685c2 (Task 1 RED commit)
- FOUND: dcec5bf (Task 1 GREEN commit)
- FOUND: ccc2e7f (Task 2 commit)
- FOUND: e603561 (Task 3 commit)
