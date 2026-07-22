---
phase: 16-design-system-extraction-logic-types-i18n
fixed_at: 2026-07-21T00:26:00Z
review_path: .planning/phases/16-design-system-extraction-logic-types-i18n/16-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 16: Code Review Fix Report

**Fixed at:** 2026-07-21T00:26:00Z
**Source review:** .planning/phases/16-design-system-extraction-logic-types-i18n/16-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (fix_scope: critical_warning — WR-01, WR-02; no critical findings existed)
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: `interpolate()` silently drops values for tokens absent from the template

**Files modified:** `packages/pv-ui/i18n/engine.ts`, `packages/pv-ui/i18n/engine.test.ts`, `web/src/lib/i18n/engine.test.ts`, `extension/lib/i18n/engine.test.ts`
**Commit:** `aae1e80`
**Applied fix:** Replaced the accumulating `replacedAny` boolean (set true the moment any single token is matched, which then short-circuits the trailing append-fallback for the *whole* call) with a single up-front `hasAnyToken` check against the **original** template, computed independently of the substitution loop. This decouples "should we treat this as a fully token-less test-double call" from "did we happen to replace something already" — the exact conflation flagged by the review. Applied the reviewer's suggested implementation verbatim (it was already correct and idiomatic).

Verification note: I traced the reviewer's own suggested-fix code against their illustrative example (`interpolate("Hello {name}", { name: "Bob", count: "5" })`) and confirmed via a standalone Node repro that both the old and new implementations return `"Hello Bob"` for that specific mixed case — the fix does not append unmatched values, it only removes the fragile boolean-conflation pattern (the reviewer's stated goal was "do not conflate 'some tokens matched' with 'all vars consumed'", which is a robustness/maintainability fix, not a behavior-changing one for today's call sites, consistent with the review's own note that "today's real call sites happen to pass exactly the tokens their templates contain, so it is unreached"). Added the reviewer-requested "mixed case (one present token + one absent)" regression test with an assertion that matches the verified actual output (`"Hello Bob"`, not `"Hello Bob 5"`) to all three `engine.test.ts` copies (`packages/pv-ui`, `web`, `extension`), preserving the existing triplication convention documented in IN-04.

### WR-02: `web/tsconfig.json` `paths` is a second source of truth for pv-ui resolution that can drift from `exports`

**Files modified:** `web/tsconfig.json`
**Commit:** `643606f`
**Applied fix:** Removed all four redundant `pv-ui/*` wildcard `paths` entries (`pv-ui/generator/*`, `pv-ui/vault/*`, `pv-ui/i18n/*`, `pv-ui/clipboard`) from `web/tsconfig.json`, leaving only the `@/*` app alias — matching `extension/tsconfig.json`, which already relies solely on `packages/pv-ui/package.json`'s `exports` map. Confirmed `moduleResolution: "bundler"` (TypeScript 5.9.3) resolves `pv-ui/*` subpath imports directly via `exports` with no `paths` override needed, so `exports` is now genuinely the single source of truth on both consumers, closing the drift risk described in the finding (the wildcard `paths` entries were over-permissive relative to the explicit per-file `exports` map — a new file added under `packages/pv-ui/vault/` would have type-checked via the wildcard `paths` without being importable at runtime).

## Verification

Ran all four gates from a clean baseline (pre-existing wasm build artifacts copied into the isolated worktree from the main repo, since they are gitignored; extension's generated `.wxt/types` were regenerated via `wxt prepare` after the wasm public asset was in place — both are pre-existing environment-setup steps, not source changes) before and after each fix:

| Gate | Baseline | After WR-01 | After WR-02 |
|---|---|---|---|
| `web && npx vitest run` | 480/480 pass | 481/481 pass (+1 new test) | 481/481 pass |
| `web && npx tsc --noEmit` | clean | clean | clean |
| `extension && npx vitest run` | 684/684 pass | 685/685 pass (+1 new test) | 685/685 pass (one transient unrelated flake on first post-WR-02 run, reproduced clean — 53/53 files, 685/685 — on immediate re-run; no extension file was touched by WR-02) |
| `extension && npx tsc --noEmit` | clean | clean | clean |

No regressions introduced. All pre-existing tests stay green.

## Skipped Issues

None — both in-scope findings (WR-01, WR-02) were fixed.

---

_Fixed: 2026-07-21T00:26:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
