---
phase: 16-design-system-extraction-logic-types-i18n
reviewed: 2026-07-20T00:00:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - packages/pv-ui/package.json
  - packages/pv-ui/clipboard.ts
  - packages/pv-ui/vault/cardBrand.ts
  - packages/pv-ui/vault/search.ts
  - packages/pv-ui/vault/sort.ts
  - packages/pv-ui/vault/types.ts
  - packages/pv-ui/i18n/engine.ts
  - packages/pv-ui/i18n/engine.test.ts
  - packages/pv-ui/i18n/common.ts
  - web/tsconfig.json
  - web/src/lib/clipboard.ts
  - web/src/lib/vault/cardBrand.ts
  - web/src/lib/vault/search.ts
  - web/src/lib/vault/sort.ts
  - web/src/lib/vault/types.ts
  - web/src/lib/i18n/dictionary.ts
  - web/src/lib/i18n/engine.test.ts
  - extension/lib/clipboard.ts
  - extension/lib/vault/cardBrand.ts
  - extension/lib/vault/search.ts
  - extension/lib/vault/sort.ts
  - extension/lib/vault/types.ts
  - extension/lib/i18n/dictionary.ts
  - extension/lib/i18n/autofill-dictionary.ts
  - extension/lib/i18n/engine.test.ts
findings:
  critical: 0
  warning: 2
  info: 4
  total: 6
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-07-20T00:00:00Z
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Summary

Phase 16 extracts byte-identical logic/type/i18n modules out of `web/` and
`extension/` into a source-only shared package (`packages/pv-ui`), consumed
via a `file:` dependency, package.json `exports` map, and thin `export *`
re-export shims. I traced the wiring end-to-end (next.config
`transpilePackages`, the `node_modules/pv-ui` symlink into each consumer,
`web/tsconfig.json` `paths`, and both vitest configs) to confirm the
refactor is genuinely behavior-neutral, then adversarially checked each
shared module and each shim for regressions.

The migration holds up well. The phase's three hard constraints are all
satisfied and I verified each directly:

- **Zero-knowledge preserved.** No pv-ui module imports any crypto, key,
  PRF, WASM, or sodium/argon/chacha surface (grep-verified across
  `clipboard.ts`, `vault/*.ts`, `i18n/*.ts`). pv-ui stays pure UI/logic.
- **The 4 copy-divergent keys stay per-consumer.** `common.ts` deliberately
  omits `vault.emptyHeading`, `vault.emptyBody`, `search.emptyResults`,
  `autolock.label`; web and extension each redefine them locally with their
  own distinct PL/EN copy (web `dictionary.ts:198-199,427,442`; extension
  `dictionary.ts:65-67,75`). The `search.emptyResults` EN divergence
  ("No results for" vs "No matches for") confirms the split is real, not
  accidental.
- **No silent duplicate-key override.** Neither consumer's post-spread
  keys collide with any of the 34 `COMMON_DICTIONARY` keys, so the
  `{ ...COMMON_DICTIONARY, ... }` spread never silently overwrites a shared
  value with a divergent one.

No blockers found. The findings below are one latent-correctness landmine
now centralized into the shared engine, and several maintainability/quality
notes.

## Warnings

### WR-01: `interpolate()` silently drops values for tokens absent from the template

**File:** `packages/pv-ui/i18n/engine.ts:37-52`
**Issue:** The fallback logic keys off a single boolean `replacedAny`. As
soon as *one* `{token}` is found and replaced, `replacedAny` becomes `true`
and the trailing fallback block is skipped entirely — so any `vars` entry
whose `{token}` is **not** present in the template is silently discarded
with no error and no trace. Example:
`interpolate("Hello {name}", { name: "Bob", count: "5" })` returns
`"Hello Bob"` and `count` vanishes. Conversely, when the template contains
*no* tokens at all (e.g. a stubbed identity `t()` returning the bare key),
*every* value is appended space-joined, which is only correct for the
test-double path. This module is now the single shared substitution engine
for both surfaces, so any future call site that passes an extra/mismatched
var inherits a silent-data-loss bug. Today's real call sites happen to pass
exactly the tokens their templates contain, so it is unreached — but it is a
correctness landmine centralized by this extraction.
**Fix:** Track per-key substitution and only fall back for genuinely
token-less templates; do not conflate "some tokens matched" with "all vars
consumed":
```ts
export function interpolate(template: string, vars: Record<string, string>): string {
  const hasAnyToken = Object.keys(vars).some((k) => template.includes(`{${k}}`));
  if (!hasAnyToken) {
    const extra = Object.values(vars).join(" ");
    return extra ? `${template} ${extra}` : template;
  }
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{${key}}`).join(value);
  }
  return result;
}
```
At minimum, add a unit test for the mixed case (one present token + one
absent) to lock the intended behavior.

### WR-02: `web/tsconfig.json` `paths` is a second source of truth for pv-ui resolution that can drift from `exports`

**File:** `web/tsconfig.json:25-41`
**Issue:** Web resolves pv-ui two independent ways: at build/test time via
the `node_modules/pv-ui` symlink + package.json `exports`
(`packages/pv-ui/package.json`), and for type-checking via these tsconfig
`paths` wildcards (`pv-ui/vault/*`, `pv-ui/i18n/*`, `pv-ui/clipboard`, ...).
They currently agree, but they are maintained separately: adding a new pv-ui
subpath export (or renaming one) requires editing both files, and the
extension deliberately has **no** pv-ui `paths` at all (it relies solely on
`exports`). A future export added only to `package.json` will type-check on
the extension but silently fall back to the wildcard `paths` on web (or
vice-versa), producing a resolution split that only surfaces as a confusing
type error later. This is a maintainability/robustness hazard introduced by
carrying both mechanisms.
**Fix:** Drop the redundant `pv-ui/*` entries from `web/tsconfig.json`
`paths` and let `exports` be the single source of truth (as the extension
already does), or add a check that keeps the two in sync. Keep only the `@/*`
app alias in `paths`.

## Info

### IN-01: `autofill-dictionary.ts` reimplements the engine's `t()` indexing instead of delegating to it

**File:** `extension/lib/i18n/autofill-dictionary.ts:160-162`
**Issue:** DS-02's stated goal is to make the dictionary lookup generic and
shared (`tEngine(dict, locale, key)`). `dictionary.ts` adopts it, but this
file keeps its own hand-written `AUTOFILL_DICTIONARY[key][locale]` accessor
— functionally identical to `engine.ts:t`, just not routed through it. It is
a missed dedup: the one line the extraction was meant to eliminate survives
here.
**Fix:** `import { t as tEngine } from "pv-ui/i18n/engine";` and
`return tEngine(AUTOFILL_DICTIONARY, locale, key);`, preserving the local
`keyof typeof AUTOFILL_DICTIONARY` narrowing exactly as `dictionary.ts` does.

### IN-02: Shared module-level mutable `clearTimer` singleton depends on single instantiation

**File:** `packages/pv-ui/clipboard.ts:40-57`
**Issue:** The "single-active-timer" clipboard-auto-clear guarantee relies
on `clearTimer` being module-scoped state instantiated exactly once per
consumer. Current wiring guarantees a single resolved path (both the runtime
`exports` resolution and the `export *` shim point at the same
`packages/pv-ui/clipboard.ts`, and tsconfig `paths` is type-only), so there
is one instance and the guarantee holds today. Flagging only because moving
this mutable singleton across a package boundary makes it fragile: if pv-ui
is ever resolved via two physical paths (a monorepo hoist change, a second
bundler entry, a duplicated dependency), you would get two independent
timers and a stale clear could fail to cancel — a security-relevant
auto-clear regression that would be silent.
**Fix:** No change required now. If defensiveness is wanted, hang the timer
handle off a `globalThis` symbol so duplicate module instances still share
one timer, and/or add a comment asserting the single-instance invariant.

### IN-03: `copyWithAutoClear` fire-and-forgets `navigator.clipboard.writeText` rejections

**File:** `packages/pv-ui/clipboard.ts:52-56`
**Issue:** Both `void navigator.clipboard.writeText(value)` and the
timeout's `void navigator.clipboard.writeText("")` discard the returned
promise. If the write rejects (permissions/focus loss), it becomes an
unhandled rejection and the auto-clear can fail without any signal. Behavior
is ported verbatim (pre-existing, best-effort by design), so this is a
robustness note, not a regression.
**Fix:** Attach a no-op/`.catch()` (e.g. `.catch(() => {})`) to make the
best-effort intent explicit and suppress unhandled-rejection noise.

### IN-04: Three byte-identical `engine.test.ts` copies duplicated across packages

**File:** `packages/pv-ui/i18n/engine.test.ts:1-60`,
`web/src/lib/i18n/engine.test.ts:1-60`, `extension/lib/i18n/engine.test.ts:1-60`
**Issue:** The same test body is maintained in three places (differing only
in the import specifier: `./engine` vs `pv-ui/i18n/engine`). This is a
deliberate, documented choice mirroring the `password.test.ts` x3 precedent
(each consumer exercises the shared module through its own resolver), and I
confirmed both consumer copies resolve `pv-ui/i18n/engine` via the
`node_modules/pv-ui` symlink + `exports` (web vitest aliases only `@`), so
the tests do run. Noting the triplication as a maintenance cost: an assertion
change must be applied in all three, and there is no guard that they stay
in sync.
**Fix:** Acceptable as-is per the established precedent; if drift becomes a
problem, factor the shared assertions into a helper imported by all three
thin runners.

---

_Reviewed: 2026-07-20T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
