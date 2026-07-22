# Phase 16: Design System Extraction — Logic, Types & i18n - Pattern Map

**Mapped:** 2026-07-20
**Files analyzed:** 17 (5 module pairs x2 + types + i18n engine/dict split + package.json + tsconfigs)
**Analogs found:** 17 / 17 (all have a live, already-proven precedent: the Phase 11 generator extraction)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/pv-ui/vault/cardBrand.ts` | utility (pure fn) | transform | `packages/pv-ui/generator/password.ts` (already-migrated pure module) | exact (mechanism) |
| `packages/pv-ui/vault/search.ts` | utility (pure fn) | transform | `packages/pv-ui/generator/password.ts` | exact (mechanism) |
| `packages/pv-ui/vault/sort.ts` | utility (pure comparator, split from storage) | transform | `packages/pv-ui/generator/strength.ts` (pure fn, no storage) | role-match |
| `packages/pv-ui/vault/types.ts` | model/types | CRUD (shape only) | `web/src/lib/vault/types.ts` (canonical superset, moved as-is) | exact |
| `packages/pv-ui/clipboard.ts` | utility | event-driven (timer) | `packages/pv-ui/generator/password.ts` (pure move, no split) | exact (mechanism) |
| `packages/pv-ui/i18n/engine.ts` | utility (generic engine) | transform | none pre-existing — **new generic code**, patterned on `web/src/lib/i18n/dictionary.ts:724-751` (`t`/`interpolate`) + `extension/lib/i18n/dictionary.ts:296-301` (`resolveLocale`) | new-code (documented in RESEARCH Pattern 1) |
| `packages/pv-ui/i18n/common.ts` | config/data | transform | none pre-existing — **new spread-object dict**, sourced from the ~30 byte-identical overlapping keys in `web/src/lib/i18n/dictionary.ts` / `extension/lib/i18n/dictionary.ts` | new-code |
| `web/src/lib/vault/{cardBrand,search,clipboard}.ts` (→ shims) | utility (shim) | transform | `web/src/lib/generator/password.ts` (existing `export *` shim) | exact |
| `extension/lib/vault/{cardBrand,search,clipboard}.ts` (→ shims) | utility (shim) | transform | `extension/lib/generator/password.ts` (existing `export *` shim) | exact |
| `web/src/lib/vault/sort.ts` (→ split shim) | utility (shim + local persistence) | transform + storage (sync localStorage) | none pre-existing at this shape — new pattern, documented in RESEARCH Pattern 2, using `web/src/lib/vault/sort.ts` itself (pre-refactor) as the source of the persistence half | role-match (self-referential split) |
| `extension/lib/vault/sort.ts` (→ split shim) | utility (shim + local persistence) | transform + storage (async `browser.storage.local`) | `extension/lib/theme/theme-mirror.ts` / `extension/lib/autofill/blocked-origins.ts` (async `browser.storage.local` convention, per file's own header comment) | role-match |
| `web/src/lib/vault/types.ts` (→ shim, unchanged, already canonical) | model (shim) | CRUD (shape) | `web/src/lib/generator/password.ts` shim | exact (mechanism) |
| `extension/lib/vault/types.ts` (→ shim, adopts superset) | model (shim) | CRUD (shape) | `extension/lib/generator/password.ts` shim | exact (mechanism) |
| `web/src/lib/i18n/dictionary.ts` (→ thin wrapper + web-only keys) | provider/config | transform | itself, pre-refactor (`web/src/lib/i18n/dictionary.ts:724-726` current `t()`) | role-match (in-place refactor) |
| `extension/lib/i18n/dictionary.ts` (→ thin wrapper + ext-only keys) | provider/config | transform | itself, pre-refactor + `extension/lib/i18n/autofill-dictionary.ts` (already re-exports `interpolate` verbatim — proves dictionary-agnostic helpers work) | role-match (in-place refactor) |
| `extension/lib/i18n/autofill-dictionary.ts` (import engine, keep own dict) | provider/config | transform | itself, pre-refactor (already the precedent for "own dict + shared interpolate") | exact |
| `packages/pv-ui/package.json` (exports map, +7 entries) | config | — | itself, pre-refactor (already has 4 entries for `generator/*` + `tokens.css`) | exact |
| `web/tsconfig.json` (paths, +3 entries) | config | — | itself, pre-refactor (already has `pv-ui/generator/*`) | exact |

## Pattern Assignments

### `packages/pv-ui/vault/cardBrand.ts`, `search.ts`, `clipboard.ts` (utility, pure move)

**Analog:** `packages/pv-ui/generator/password.ts` + its shims `web/src/lib/generator/password.ts`, `extension/lib/generator/password.ts` (full files, 74/6/6 lines — read in full, no truncation needed)

**The exact shim template to replicate verbatim** (`web/src/lib/generator/password.ts`, full file):
```typescript
// Thin re-export shim — the real implementation now lives in
// packages/pv-ui/generator/password.ts (D-13, plan 11-07: pv-ui is the
// single source of truth for generator logic, shared by web and
// extension). This shim keeps every existing "@/lib/generator/password"
// import path (and this file's own password.test.ts) working with zero
// consumer churn.
export * from "pv-ui/generator/password";
```
Extension side is byte-identical except the import-path reference in the comment (`"../../lib/generator/password"` instead of `"@/lib/generator/password"`).

**Source content to move verbatim** — `web/src/lib/vault/cardBrand.ts` (full file, 28 lines, header comment + `CardBrand` type + `detectCardBrand()`) becomes `packages/pv-ui/vault/cardBrand.ts` unchanged; both web and extension originals (28 vs 30 lines — extension has 2 extra comment lines, confirmed comment-only diff per RESEARCH) collapse to the shim above pointing at `pv-ui/vault/cardBrand`.

`web/src/lib/clipboard.ts` (full file, 57 lines) — module-level `let clearTimer` closure (single-active-timer discipline, lines 40-57) moves verbatim to `packages/pv-ui/clipboard.ts`; both `readClipboardSeconds()`/`clampClipboardSeconds()` (browser-only `localStorage`/`navigator.clipboard`, used identically by both consumers) move too — this is a pure move, unlike `sort.ts` below, because both sides already use the same `localStorage` API for this concern (not split like `sort.ts`'s divergent persistence layer).

**Error handling pattern** (from `clipboard.ts:31-38`, replicate for any new pv-ui utility touching browser storage):
```typescript
export function readClipboardSeconds(): number {
  try {
    const stored = localStorage.getItem(CLIPBOARD_SECONDS_KEY);
    return stored !== null ? clampClipboardSeconds(Number(stored)) : DEFAULT_CLIPBOARD_SECONDS;
  } catch {
    return DEFAULT_CLIPBOARD_SECONDS;
  }
}
```

---

### `packages/pv-ui/vault/sort.ts` (utility, split migration — comparator only)

**Analog:** `packages/pv-ui/generator/strength.ts` for the "pure fn only" shape; the pre-refactor `web/src/lib/vault/sort.ts` and `extension/lib/vault/sort.ts` (both read in full, 59/67 lines) are themselves the source for the split.

**What moves to `pv-ui/vault/sort.ts` verbatim** (byte-identical on both sides today — `web/src/lib/vault/sort.ts:8-10,32-59`):
```typescript
export type SortOption = "lastUsed" | "name";
export const DEFAULT_SORT: SortOption = "lastUsed";

function byName(a: VaultItem, b: VaultItem): number {
  return a.fields.name.localeCompare(b.fields.name);
}

export function sortItems(items: VaultItem[], sortBy: SortOption): VaultItem[] {
  const copy = [...items];
  if (sortBy === "name") {
    return copy.sort(byName);
  }
  return copy.sort((a, b) => {
    if (a.lastUsedAt && b.lastUsedAt) {
      return b.lastUsedAt.localeCompare(a.lastUsedAt);
    }
    if (a.lastUsedAt && !b.lastUsedAt) return -1;
    if (!a.lastUsedAt && b.lastUsedAt) return 1;
    return byName(a, b);
  });
}
```

**What stays local** — web (`web/src/lib/vault/sort.ts:12,14-30`, sync `localStorage`, key `"pv-vault-sort"`):
```typescript
const STORAGE_KEY = "pv-vault-sort";
function isSortOption(value: string | null): value is SortOption {
  return value === "lastUsed" || value === "name";
}
export function readSortPreference(): SortOption {
  if (typeof window === "undefined") return DEFAULT_SORT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return isSortOption(raw) ? raw : DEFAULT_SORT;
}
export function writeSortPreference(sort: SortOption): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, sort);
}
```

Extension (`extension/lib/vault/sort.ts:16,18-33,62-66`, async `browser.storage.local`, key `"pv-popup-sort"`, plus extension-only `sortByLastUsed()` sugar):
```typescript
import { browser } from "wxt/browser";
const STORAGE_KEY = "pv-popup-sort";
function isSortOption(value: unknown): value is SortOption {
  return value === "lastUsed" || value === "name";
}
export async function readSortPreference(): Promise<SortOption> {
  const result = await browser.storage.local.get(STORAGE_KEY);
  const stored = (result as Record<string, unknown>)[STORAGE_KEY];
  return isSortOption(stored) ? stored : DEFAULT_SORT;
}
export async function writeSortPreference(sort: SortOption): Promise<void> {
  await browser.storage.local.set({ [STORAGE_KEY]: sort });
}

/** Kept for `sort.test.ts`'s existing coverage — extension-only convenience. */
export function sortByLastUsed(items: VaultItem[]): VaultItem[] {
  return sortItems(items, "lastUsed");
}
```

This is documented as RESEARCH's "Pattern 2: Split (not pure-shim) migration" — use it verbatim as the plan's template; do not `export *` this file.

---

### `packages/pv-ui/vault/types.ts` (model/types)

**Analog:** `web/src/lib/vault/types.ts` (canonical superset, 256 lines vs extension's 245 — additive-only per RESEARCH's verified `fill-dom.ts` read-site check). Move web's file verbatim into `pv-ui/vault/types.ts`; both `web/src/lib/vault/types.ts` and `extension/lib/vault/types.ts` become `export * from "pv-ui/vault/types"` shims. No excerpt needed beyond the shim template above — this is a pure content move, not a rewrite.

**Verification obligation carried into the plan:** confirm `extension/lib/autofill/fill-dom.ts`'s only `IdentityFields` read is the legacy flat `address` field (already verified by RESEARCH via grep) before/after the shim swap — re-run `grep -n "address" extension/lib/autofill/fill-dom.ts` as a task-level check, not just trust RESEARCH.

---

### `packages/pv-ui/i18n/engine.ts` (utility, new generic code)

**Analog:** No direct precedent exists (new code, not a move) — pattern derived from combining `web/src/lib/i18n/dictionary.ts:724-751` (`t`/`interpolate`, current closed-over-`DICTIONARY` form) and `extension/lib/i18n/dictionary.ts:296-301` (`resolveLocale`, extension-only today) and `extension/lib/i18n/autofill-dictionary.ts`'s existing `export { interpolate }` re-export (proof `interpolate` is already dictionary-agnostic).

**Current (pre-refactor) closed-over form to generalize** — `web/src/lib/i18n/dictionary.ts:724-726`:
```typescript
export function t(locale: Locale, key: keyof typeof DICTIONARY): string {
  return DICTIONARY[key][locale];
}
```

**Already dictionary-agnostic, move verbatim** — `web/src/lib/i18n/dictionary.ts:736-751` (`interpolate`, byte-identical to `extension/lib/i18n/dictionary.ts:272-287`):
```typescript
export function interpolate(template: string, vars: Record<string, string>): string {
  let result = template;
  let replacedAny = false;
  for (const [key, value] of Object.entries(vars)) {
    const token = `{${key}}`;
    if (result.includes(token)) {
      result = result.split(token).join(value);
      replacedAny = true;
    }
  }
  if (!replacedAny) {
    const extra = Object.values(vars).join(" ");
    result = extra ? `${result} ${extra}` : result;
  }
  return result;
}
```

**Move verbatim, becomes shared** — `extension/lib/i18n/dictionary.ts:296-301` (`resolveLocale`, extension-only today):
```typescript
export function resolveLocale(): Locale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  return navigator.language.toLowerCase().startsWith("pl") ? "pl" : "en";
}
```

**New generic form to write** (RESEARCH's Pattern 1, the one place this phase writes new code rather than moving it):
```typescript
export type Locale = "pl" | "en";

export function t<D extends Record<string, Record<Locale, string>>>(
  dict: D,
  locale: Locale,
  key: keyof D,
): string {
  return dict[key][locale];
}
```

**Consumer-side thin wrapper** (both `web/src/lib/i18n/dictionary.ts` and `extension/lib/i18n/dictionary.ts` after refactor, zero call-site churn at ~29 existing call sites):
```typescript
import { COMMON_DICTIONARY } from "pv-ui/i18n/common";
import { t as tEngine, interpolate, type Locale } from "pv-ui/i18n/engine";
export { interpolate };
export type { Locale };

export const DICTIONARY = {
  ...COMMON_DICTIONARY,
  // ...surface-only keys, unchanged content from today's file...
} satisfies Record<string, { pl: string; en: string }>;

export function t(locale: Locale, key: keyof typeof DICTIONARY): string {
  return tEngine(DICTIONARY, locale, key);
}
```

---

### `packages/pv-ui/i18n/common.ts` (config/data, new spread-object dict)

**Analog:** none pre-existing — new file. Source data: the ~30 keys that share both key-name AND exact `{pl, en}` value across `web/src/lib/i18n/dictionary.ts` (751 lines total, `DICTIONARY` block at lines 8-722) and `extension/lib/i18n/dictionary.ts` (301 lines, `DICTIONARY` block at lines 20-~260). **Do not trust RESEARCH's "38 keys / 34 identical / 4 divergent" count without re-diffing** — Pitfall 4/drift-warning in CONTEXT.md applies; re-run the key-by-key comparison as a task step before writing this file, since Phase 15 landed after the research snapshot and touched extension dictionaries.

**Known-divergent keys to exclude from `common.ts`** (per RESEARCH measurement, re-verify): `vault.emptyHeading`, `vault.emptyBody`, `search.emptyResults`, `autolock.label` — these must stay as local-only entries in each consumer's own `DICTIONARY` spread, never in `common.ts`.

**Shape to use** (RESEARCH Open Question 1, recommended answer):
```typescript
export const COMMON_DICTIONARY = {
  "auth.passwordLabel": { pl: "Hasło główne", en: "Master password" },
  "auth.loginSubmit": { pl: "Zaloguj się", en: "Log in" },
  // ...remaining verified-identical keys...
} satisfies Record<string, { pl: string; en: string }>;
```

---

### `packages/pv-ui/package.json` (config, exports map)

**Analog:** itself pre-refactor — already has the exact shape needed, just needs 7 more entries (full file read, 21 lines):
```jsonc
{
  "exports": {
    "./tokens.css": "./tokens.css",
    "./generator/password": { "types": "./generator/password.ts", "default": "./generator/password.ts" },
    "./generator/strength": { "types": "./generator/strength.ts", "default": "./generator/strength.ts" },
    "./generator/wordlist": { "types": "./generator/wordlist.ts", "default": "./generator/wordlist.ts" },
    "./vault/cardBrand": { "types": "./vault/cardBrand.ts", "default": "./vault/cardBrand.ts" },
    "./vault/search":    { "types": "./vault/search.ts",    "default": "./vault/search.ts" },
    "./vault/sort":      { "types": "./vault/sort.ts",      "default": "./vault/sort.ts" },
    "./vault/types":     { "types": "./vault/types.ts",     "default": "./vault/types.ts" },
    "./clipboard":       { "types": "./clipboard.ts",       "default": "./clipboard.ts" },
    "./i18n/engine":     { "types": "./i18n/engine.ts",     "default": "./i18n/engine.ts" },
    "./i18n/common":     { "types": "./i18n/common.ts",     "default": "./i18n/common.ts" }
  }
}
```

---

### `web/tsconfig.json` (config, paths aliases — extension needs NONE)

**Analog:** itself pre-refactor (full file read, 39 lines) — already has one entry to extend:
```jsonc
"paths": {
  "@/*": ["./src/*"],
  "pv-ui/generator/*": ["../packages/pv-ui/generator/*"],
  "pv-ui/vault/*": ["../packages/pv-ui/vault/*"],
  "pv-ui/i18n/*": ["../packages/pv-ui/i18n/*"],
  "pv-ui/clipboard": ["../packages/pv-ui/clipboard.ts"]
}
```
Extension's `tsconfig.json` (WXT-generated, extends its own) needs zero edits — `moduleResolution: "bundler"` already resolves `generator/*` today with no `paths` entry, verified by RESEARCH.

## Shared Patterns

### Shim template (`export *`)
**Source:** `web/src/lib/generator/password.ts` and `extension/lib/generator/password.ts` (both full files, shown above under cardBrand/search/clipboard section)
**Apply to:** `cardBrand.ts`, `search.ts`, `clipboard.ts`, `types.ts` on both web and extension. Comment must reference the specific pv-ui subpath and preserve the "zero consumer churn" framing.

### Split-shim template (comparator moved, storage stays local)
**Source:** RESEARCH's Pattern 2 (embedded above under `sort.ts` section), grounded in the pre-refactor `sort.ts` files themselves
**Apply to:** `web/src/lib/vault/sort.ts`, `extension/lib/vault/sort.ts` only — the one file pair that is NOT a pure `export *`.

### Generic-engine + thin-wrapper i18n pattern
**Source:** `extension/lib/i18n/autofill-dictionary.ts`'s existing `export { interpolate }` re-export (proves the "own dict, shared engine helper" shape already works in this codebase) + RESEARCH Pattern 1
**Apply to:** `web/src/lib/i18n/dictionary.ts`, `extension/lib/i18n/dictionary.ts`, `extension/lib/i18n/autofill-dictionary.ts` (keeps own `AUTOFILL_DICTIONARY`, imports `interpolate` from `pv-ui/i18n/engine` instead of re-exporting from local `dictionary.ts`).

### Grep-based zero-duplication verification
**Source:** `extension/lib/*/server-config.test.ts`'s `no_other_extension_file_hard_codes_a_server_url`-style walker (structural literal-string guard convention already used in this codebase)
**Apply to:** success criterion 3 — add a one-off (or persistent, planner's discretion) grep step per migrated symbol, e.g.:
```bash
grep -rn "function detectCardBrand\|function domainFromUrl\|function sortItems\|function copyWithAutoClear" web/src extension/lib --include="*.ts" | grep -v "/pv-ui/"
```
Expect zero non-shim hits outside `pv-ui/`.

## No Analog Found

None — every file in scope has either a direct structural analog (the Phase 11 generator shim) or is explicitly documented as new code with its source material identified above (i18n engine generalization, `common.ts`).

## Metadata

**Analog search scope:** `packages/pv-ui/generator/`, `web/src/lib/{vault,generator,i18n}/`, `extension/lib/{vault,generator,i18n,autofill,theme}/`, `web/tsconfig.json`, `packages/pv-ui/package.json`
**Files scanned:** 17 target files + 4 precedent files (`generator/password.ts` x3, `package.json`, `web/tsconfig.json`)
**Pattern extraction date:** 2026-07-20
