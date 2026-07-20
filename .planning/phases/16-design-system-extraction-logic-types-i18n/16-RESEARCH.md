# Phase 16: Design System Extraction — Logic, Types & i18n - Research

**Researched:** 2026-07-20
**Domain:** Internal code-deduplication refactor (TypeScript, monorepo shared-package extraction) — no new runtime dependencies, no user-facing behavior change
**Confidence:** HIGH — every claim below is grounded in `diff`/`wc`/`grep`/`node` inspection of the live tree at the time of research, not the (partially stale) commissioned research doc

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

All implementation choices are at Claude's discretion — pure infrastructure phase (code extraction/refactor, no user-facing behavior). The commissioned research (`.planning/research/v0.3/DESIGN-SYSTEM-UNIFICATION.md`, measured 2026-07-20 @ a3a1b85) locks the architecture:

- **Keep `file:` deps + `export *` shim template** (D-13). Do NOT migrate to npm workspaces — Docker cache-split reasoning still holds. Import paths in consumers never change.
- **Sort:** comparator (`SortOption`, `sortItems`) moves to pv-ui; `read/writeSortPreference` persistence stays in each consumer (web `localStorage` sync vs ext `browser.storage.local` async, different storage keys — platform-specific by design).
- **Types:** web `types.ts` is the canonical superset (newer optional card `pin`/`zip`, structured identity address); extension adopts it additively — verify autofill's legacy flat `address` read against `fill-dom.ts`.
- **i18n:** engine (`t`/`interpolate`/`Locale`/`resolveLocale`) extracted to `pv-ui/i18n/engine.ts`; shared keys to a common dictionary; surface-specific keys stay per-consumer and merge over the common set; in-page `autofill-dictionary.ts` keeps its own dict but imports the shared engine. `resolveLocale()` exists only ext-side today — becomes shared.
- **pv-ui stays source-only, no build step** — consumers transpile it as own source (web `transpilePackages`, ext WXT/Vite).

### Claude's Discretion

Everything above is technically "Claude's Discretion" per CONTEXT.md's Mode ("Autonomous — infrastructure phase — no user-facing grey areas; decisions sourced from commissioned research"), but the bullets above are treated as locked because they are the commissioned research's architecture, which CONTEXT.md explicitly adopts. Within that architecture, remaining discretion areas (not locked) are:
- Exact file/subpath naming inside `pv-ui/vault/*` and `pv-ui/i18n/*` (this research proposes `vault/{cardBrand,search,sort,types}.ts`, `clipboard.ts`, `i18n/{engine,common}.ts`).
- Whether to add new extension-side test files closing the pre-existing `cardBrand.ts`/`types.ts`/`clipboard.ts` local-coverage gap (see Open Question 2) — not required by success criteria.
- Migration order within the phase (research recommends cardBrand + search + clipboard → sort split → types reconciliation → i18n engine + key split; each step independently shippable).

### Deferred Ideas (OUT OF SCOPE)

- React component sharing (`ItemIconTile`) and in-page overlay token alignment — already scheduled as Phase 17 (DS-03, DS-04, UX-01).
- Broader component library (ItemRow/DetailPanel/dialogs) — research "Phase D", post-v0.3 candidate.
</user_constraints>

## Summary

This phase moves five already-near-identical modules (`cardBrand.ts`, `search.ts`, the `sort.ts` comparator, `clipboard.ts`, `types.ts`) and the i18n engine (`t`/`interpolate`/`Locale`/`resolveLocale`) out of `web/src/lib/` and `extension/lib/` and into `packages/pv-ui`, replacing each origin file with a thin `export *` (or near-`export *`) shim. The mechanism is not new — `packages/pv-ui/generator/*` (Phase 11, Plan 11-07, decision D-13) already proves the exact pattern end-to-end: `file:` dependency (not npm workspaces), source-only package (no build step), `export *` shims for zero import-path churn, `exports` map in `pv-ui/package.json`, and (web-only) a matching `tsconfig.json` path alias. `node_modules/pv-ui` is a real symlink to `packages/pv-ui` in both consumers, so no `npm install`/`npm ci` re-run is needed to pick up new files inside it — only the `exports` map entries need to grow.

Re-measuring against the live tree (not the 2026-07-20 research snapshot, which the phase's own CONTEXT.md flagged as pre-dating Phase 15's extension-dictionary edits) confirms: `cardBrand.ts`, `search.ts`, and `clipboard.ts` are genuinely comment-only diffs — mechanical, zero-risk moves. The `sort.ts` comparator is byte-identical logic with genuinely divergent persistence (web sync `localStorage` vs extension async `browser.storage.local`, different storage keys) — CONTEXT.md's split (comparator to `pv-ui`, persistence stays local) is correct and is the one place the shim isn't a pure `export *`. `types.ts` is additive-only divergence (web has 11 extra optional-field lines the extension lacks) — verified safe to adopt because the extension's own `fill-dom.ts` only ever reads the legacy flat `address` field, never the new structured fields. The i18n engine is the one place with a real design decision: `t()` is NOT dictionary-agnostic today — it closes over each file's own module-scoped `DICTIONARY` constant — so a shared `t()` must become generic over a `dict` parameter, and each consumer must keep a thin local wrapper preserving the existing 2-arg call signature so none of the ~29 call sites (16 web + 13 extension) need to change.

Dictionary key overlap was directly measured (not estimated): of 38 keys sharing the exact same key-name between the two `DICTIONARY` objects, 34 are byte-identical and 4 have genuinely different, purposeful copy (web vs extension UX text differs for `vault.emptyHeading`, `vault.emptyBody`, `search.emptyResults`, `autolock.label`). Those 4 must NOT be lifted into the shared `common.ts` — doing so and letting either side "win" would silently change the other surface's live copy, violating this phase's explicit "no visual change" boundary.

**Primary recommendation:** Do five small, independently-shippable extractions in the research's stated order (cardBrand → search → clipboard → sort-comparator-split → types-reconciliation → i18n-engine-and-key-split), each ending in `cd web && npx vitest run && npx tsc --noEmit && npx next build` and `cd extension && npx vitest run && npx tsc --noEmit && npx wxt build && npx wxt build -b firefox`, plus a grep-based "no duplicate implementation survives" check per success criterion 3.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Card-brand detection (`detectCardBrand`) | Browser / Client | — | Pure function over an already-decrypted, user-typed card number; runs identically in the web tab and the extension popup — zero-knowledge boundary already satisfied (nothing leaves the client) |
| Domain/search helpers (`domainFromUrl`, `searchItems`, `filterItems`) | Browser / Client | — | Operates on the in-memory decrypted `VaultItem[]` array already held client-side in both web and popup |
| Sort comparator (`sortItems`, `SortOption`) | Browser / Client | — | Pure array sort; the persistence adapter (`localStorage` vs `browser.storage.local`) is deliberately NOT shared — it is genuinely platform-specific storage API, not duplicated logic |
| Clipboard copy + auto-clear | Browser / Client | — | Uses `navigator.clipboard`/`localStorage`, both browser-only APIs available identically in a Next.js tab and a WXT popup |
| Vault item type shapes (`VaultItem`, `ItemFields`, `normalizeItemFields`) | Browser / Client | — | Compile-time types + a pure normalization function describing the client-held decrypted item shape; no I/O |
| i18n engine (`t`, `interpolate`, `Locale`, `resolveLocale`) | Browser / Client | — | Runs entirely client-side; `resolveLocale()` reads `navigator.language` in both a DOM document (popup) and a Node-vitest environment (guarded) |

There is no Frontend-Server (SSR) or API/Backend tier involvement in this phase — `web/` runs as a static export (`output: "export"` in `next.config.ts`), and none of the six migrated concerns touch `pv-server` or any network boundary. This map is intentionally single-tier: every capability in DS-01/DS-02 already lives, and stays, in the browser-client tier on both surfaces.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DS-01 | Pure shared logic + types (card-brand detection, domain/search helpers, sort comparator, clipboard, vault item type shapes) live once in `packages/pv-ui`; the extension consumes them via re-export shims — no parallel duplicate copies remain | Duplication Inventory (measured diffs for all 5 concerns), Migration Order, `types.ts` reconciliation safety proof (fill-dom.ts read-only check), sort-comparator/persistence split rationale |
| DS-02 | A shared i18n engine lives in `pv-ui`; the web app and the extension consume the same resolver (dictionary keys may be split per surface) rather than duplicating it | i18n Engine Genericization Design, Dictionary Key Overlap Measurement, Divergent-Copy Guard |
</phase_requirements>

## Standard Stack

### Core

No new libraries are introduced by this phase. It is a pure internal code-motion refactor within the existing, already-proven `pv-ui` consumption model.

| Mechanism | Status | Purpose | Why Standard (for this repo) |
|-----------|--------|---------|-------------------------------|
| `pv-ui` as a `file:../packages/pv-ui` dependency | Already in place (`web/package.json`, `extension/package.json`) | Single-source shared package, source-only, no build step | Proven by Phase 11's generator + tokens extraction; preserves Docker's per-project `npm ci` cache-split (D-13) |
| `export * from "pv-ui/<subpath>"` shim | Already the template (`generator/*`) | Zero import-path churn at all consumer call sites | Same pattern the generator extraction already validated across both consumers |
| `package.json` `exports` map (pv-ui) | Already has 4 entries, needs 7 more | Declares which pv-ui subpaths are importable, with `types`/`default` conditions | Required by `moduleResolution: "Bundler"` (both `web/tsconfig.json` and `extension/.wxt/tsconfig.json` use this mode) to resolve subpath imports |
| `web/tsconfig.json` `paths` alias per new subpath | Already has 1 entry (`pv-ui/generator/*`), needs more | Belt-and-suspenders IDE/tsc resolution alongside the `exports` map | 11-07-SUMMARY.md's own deviation log: Turbopack's initial resolution attempt used this alias before the `turbopack.root` fix; kept as the established double-declaration pattern |

**Installation:** None. No `npm install` is required for either consumer — `node_modules/pv-ui` is a real symlink to `packages/pv-ui` in both `web/` and `extension/` `[VERIFIED: file inspection, ls -la shows `lrwxr-xr-x … pv-ui -> ../../packages/pv-ui]`, so new files/subpaths added inside `packages/pv-ui` are visible to both consumers immediately, without reinstalling.

### Supporting

| Item | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| TypeScript `moduleResolution: "Bundler"` | Already pinned in both `web/tsconfig.json` and `extension/.wxt/tsconfig.json` (generated, extends WXT's own) | Enables `package.json` `exports`-map-based subpath resolution without needing per-subpath `paths` entries on the extension side | Already active — no change needed; confirms the extension needs **zero** tsconfig edits for the new subpaths (verified: `generator/*` already resolves in the extension with no `paths` entry at all) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `file:` dependency + `export *` shims | npm/yarn workspaces | Rejected — already decided (D-13) and reaffirmed in CONTEXT.md's locked decisions; would collapse the two independent `package-lock.json` files the Dockerfile's per-project cache-split stage depends on |
| Generic `t(dict, locale, key)` + thin per-consumer wrapper | A single shared `t(locale, key)` closing over one merged super-dictionary | Rejected — would force every call site's `keyof typeof DICTIONARY` type to widen to the union of ALL surfaces' keys, losing the "does this key even exist for my surface" compile-time check that autofill-dictionary.ts's separate `AUTOFILL_DICTIONARY`/`t` pair currently gives; also cannot represent the 4 genuinely-divergent-copy keys (see Common Pitfalls) |
| Third-party i18n library (e.g., i18next) | — | Not evaluated — out of scope. The existing 20-ish-line dict + `t()` + `interpolate()` engine is tested, proven, and does exactly what PL/EN static-dictionary lookup needs; adopting a framework would be scope creep against this phase's explicit "extraction, not rewrite" boundary |

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages — it is a pure move of first-party TypeScript already in the repository into `packages/pv-ui`, consumed via the already-approved `file:` mechanism. No `npm install`/`pip install`/`cargo add` occurs. No `checkpoint:human-verify` gate is needed for package installation in this phase's plan.

## Architecture Patterns

### System Architecture Diagram

```
                    packages/pv-ui/  (source-only, no build step)
                    ┌─────────────────────────────────────────────┐
                    │  vault/cardBrand.ts   (detectCardBrand)      │
                    │  vault/search.ts      (domainFromUrl,        │
                    │                        searchItems,          │
                    │                        filterItems)          │
                    │  vault/sort.ts        (SortOption,           │
                    │                        DEFAULT_SORT,         │
                    │                        sortItems — pure      │
                    │                        comparator ONLY)      │
                    │  vault/types.ts       (VaultItem, ItemFields,│
                    │                        normalizeItemFields — │
                    │                        web superset canon)   │
                    │  clipboard.ts         (copy + auto-clear)    │
                    │  i18n/engine.ts       (t<D>, interpolate,    │
                    │                        Locale, resolveLocale)│
                    │  i18n/common.ts       (~30 byte-identical    │
                    │                        shared dict keys —   │
                    │                        excludes the 4       │
                    │                        divergent-copy keys) │
                    └───────────────┬───────────────┬─────────────┘
                                    │ export *        │ export *
                                    │ (symlinked,      │ (symlinked,
                                    │ no install step) │ no install step)
                    ┌───────────────▼───────────┐  ┌──▼─────────────────────────┐
                    │  web/src/lib/…              │  │  extension/lib/…            │
                    │  vault/cardBrand.ts (shim)   │  │  vault/cardBrand.ts (shim)   │
                    │  vault/search.ts   (shim)   │  │  vault/search.ts   (shim)   │
                    │  vault/sort.ts (comparator   │  │  vault/sort.ts (comparator   │
                    │   shimmed, sync localStorage │  │   shimmed, async             │
                    │   read/write LOCAL, key       │  │   browser.storage.local      │
                    │   pv-vault-sort)              │  │   LOCAL, key pv-popup-sort,  │
                    │                                │  │   + local sortByLastUsed)    │
                    │  vault/types.ts    (shim)     │  │  vault/types.ts    (shim)    │
                    │  clipboard.ts      (shim)     │  │  clipboard.ts      (shim)    │
                    │  i18n/dictionary.ts            │  │  i18n/dictionary.ts           │
                    │   = {...COMMON, ...webOnly}    │  │   = {...COMMON, ...extOnly}   │
                    │   local t()/interpolate()/     │  │   local t()/resolveLocale()/  │
                    │   wrappers over engine.ts       │  │   interpolate() wrappers      │
                    │                                │  │  i18n/autofill-dictionary.ts │
                    │                                │  │   (unchanged shape, imports  │
                    │                                │  │   engine.ts's interpolate    │
                    │                                │  │   directly, as it already    │
                    │                                │  │   does today from dictionary)│
                    └───────────────────────────────┘  └───────────────────────────────┘
                       37-ish importers, paths           26-ish importers, paths
                       unchanged                          unchanged
```

### Recommended Project Structure

```
packages/pv-ui/
├── vault/
│   ├── cardBrand.ts       # moved verbatim from web/src/lib/vault/cardBrand.ts
│   ├── search.ts          # moved verbatim
│   ├── sort.ts            # SortOption, DEFAULT_SORT, sortItems ONLY — no read/writeSortPreference
│   └── types.ts           # web's superset adopted as canonical
├── clipboard.ts            # moved verbatim (both sides already use localStorage)
├── i18n/
│   ├── engine.ts           # t<D>(dict, locale, key), interpolate(), Locale, resolveLocale()
│   └── common.ts           # only the ~30 byte-identical shared keys (excludes the 4 divergent ones)
└── package.json             # exports map grows by 7 subpaths
```

### Pattern 1: Generic dictionary-agnostic `t()`

**What:** Today, `web/src/lib/i18n/dictionary.ts`'s `t()` is `function t(locale: Locale, key: keyof typeof DICTIONARY): string { return DICTIONARY[key][locale]; }` — it closes over the file's own module-scoped `DICTIONARY` constant, it is NOT parameterized. `extension/lib/i18n/dictionary.ts` has an independent, differently-scoped copy of the exact same function body against its own `DICTIONARY`. `extension/lib/i18n/autofill-dictionary.ts` already proves `interpolate` is dictionary-agnostic (it re-exports it verbatim from `dictionary.ts`) but has to define its OWN local `t()` against `AUTOFILL_DICTIONARY` because the existing `t()` cannot be reused across two different dictionary shapes.

**When to use:** This is the one place this phase requires new code, not moved code — a generic engine function plus a thin per-consumer wrapper that preserves the existing 2-arg call signature at every call site.

**Example:**
```typescript
// pv-ui/i18n/engine.ts (NEW code, not a move)
export type Locale = "pl" | "en";

export function t<D extends Record<string, Record<Locale, string>>>(
  dict: D,
  locale: Locale,
  key: keyof D,
): string {
  return dict[key][locale];
}

// Source: verbatim from web/src/lib/i18n/dictionary.ts:736-750 — dictionary-agnostic already
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

// Source: verbatim from extension/lib/i18n/dictionary.ts:296-300
export function resolveLocale(): Locale {
  if (typeof navigator === "undefined") return "en";
  return navigator.language.toLowerCase().startsWith("pl") ? "pl" : "en";
}
```

```typescript
// web/src/lib/i18n/dictionary.ts (AFTER refactor — thin local wrapper, zero call-site churn)
import { COMMON_DICTIONARY } from "pv-ui/i18n/common";
import { t as tEngine, interpolate, type Locale } from "pv-ui/i18n/engine";
export { interpolate };
export type { Locale };

export const DICTIONARY = {
  ...COMMON_DICTIONARY,
  // ...web-only keys (unchanged content, unchanged from today's file)...
} satisfies Record<string, { pl: string; en: string }>;

// Preserves the EXACT existing signature every call site already uses.
export function t(locale: Locale, key: keyof typeof DICTIONARY): string {
  return tEngine(DICTIONARY, locale, key);
}
```

### Pattern 2: Split (not pure-shim) migration for `sort.ts`

**What:** Unlike `cardBrand`/`search`/`clipboard` (pure `export *`), `sort.ts` on both sides currently exports both the pure comparator (`SortOption`, `DEFAULT_SORT`, `sortItems`) AND platform-specific persistence (`readSortPreference`/`writeSortPreference`). Both sides' existing `sort.test.ts` imports both from the same local `./sort` — so the post-refactor local `sort.ts` must re-export the pv-ui comparator AND keep defining the local persistence functions in the same file, not a pure `export *`.

**When to use:** Any time a source file bundles a genuinely shareable pure function with a genuinely platform-specific side-effecting one.

**Example:**
```typescript
// web/src/lib/vault/sort.ts (AFTER refactor)
export { type SortOption, DEFAULT_SORT, sortItems } from "pv-ui/vault/sort";
import { DEFAULT_SORT, type SortOption } from "pv-ui/vault/sort";

const STORAGE_KEY = "pv-vault-sort"; // unchanged
function isSortOption(value: string | null): value is SortOption { /* unchanged */ }

export function readSortPreference(): SortOption {
  if (typeof window === "undefined") return DEFAULT_SORT;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return isSortOption(raw) ? raw : DEFAULT_SORT;
}
export function writeSortPreference(sort: SortOption): void { /* unchanged, sync localStorage */ }
```
```typescript
// extension/lib/vault/sort.ts (AFTER refactor) — keeps its own sortByLastUsed sugar (web has none)
export { type SortOption, DEFAULT_SORT, sortItems } from "pv-ui/vault/sort";
import { browser } from "wxt/browser";
import { DEFAULT_SORT, sortItems, type SortOption } from "pv-ui/vault/sort";
// ...async browser.storage.local read/write, STORAGE_KEY = "pv-popup-sort", unchanged...

/** Kept for sort.test.ts's existing coverage — extension-only convenience, no web equivalent. */
export function sortByLastUsed(items: VaultItem[]): VaultItem[] {
  return sortItems(items, "lastUsed");
}
```

### Anti-Patterns to Avoid

- **Merging the 4 divergent-copy i18n keys into `common.ts`:** `vault.emptyHeading`, `vault.emptyBody`, `search.emptyResults`, and `autolock.label` share a key NAME between web and extension but have genuinely different PL/EN text `[VERIFIED: node script diff of both DICTIONARY objects, 34/38 identical, 4/38 divergent]`. Lifting either surface's copy into `common.ts` and letting the other surface "inherit" it would silently change that surface's live UI text — a visual/copy change, which this phase's success criteria explicitly forbid. Keep these 4 as local-only entries in each consumer's own `DICTIONARY`, not in `common.ts`.
- **Deleting a local test file just because its logic moved:** Phase 11-07's own deviation log (Deviation #3) shows this exact mistake already happened once with `web/src/lib/generator/password.test.ts` — the file was moved wholesale to `pv-ui` and had to be recreated locally so `cd web && npm test` still exercised the shim chain. `web/src/lib/vault/cardBrand.test.ts`, `identityAddress.test.ts`, and `web/src/lib/clipboard.test.ts` exist ONLY on the web side today (the extension has no local tests for `cardBrand.ts`, `types.ts`, or `clipboard.ts`) — do not let these vanish or silently stay orphaned during the move.
- **Widening `t()`'s `keyof` to the union of every surface's keys:** would defeat the whole point of per-surface dictionaries (compile-time "does this key exist for my surface" checking) and is unnecessary — the generic-engine + local-wrapper pattern above avoids it entirely.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|--------------|-----|
| Shared source across two independently-built npm projects | A new build step (bundling pv-ui to `dist/`, publishing to a private registry, etc.) | The existing source-only `file:` + symlink + `exports` map mechanism | Already proven for `tokens.css` + `generator/*`; a build step would be new infrastructure this phase does not need and CONTEXT.md explicitly locks against ("pv-ui stays source-only, no build step") |
| PL/EN string lookup + `{token}` interpolation | A third-party i18n framework (i18next, react-intl, FormatJS) | The existing ~20-line `t()`/`interpolate()`/`DICTIONARY` engine, generalized to accept a `dict` parameter | The existing engine already does exactly what's needed (static 2-locale dictionary lookup with simple token substitution); a framework is unjustified scope for this phase |
| Detecting "did a duplicate implementation survive the migration" | Manual visual code review / trusting the diff | A grep-based verification step (success criterion 3 is explicit: "verified by search, not assumed") | Manual review misses stray copies; a repo-wide grep for the moved function/type names outside `pv-ui/` and outside the shim files is the only way to prove zero-duplication, matching the pattern `server-config.test.ts`'s own `no_other_extension_file_hard_codes_a_server_url` walker already uses in this codebase |

**Key insight:** every piece of "shared infrastructure" this phase needs (source-only package delivery, shim re-export, generic-function pattern) already exists somewhere in this codebase as a working precedent (`generator/*` for delivery+shim, `autofill-dictionary.ts`'s `interpolate` re-export for dictionary-agnostic engine functions). The task is disciplined replication, not invention.

## Runtime State Inventory

> Included because this phase is a refactor/code-extraction phase (files move location; module boundaries change).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — the persisted values (`localStorage["pv-vault-sort"]`, `browser.storage.local["pv-popup-sort"]`, `localStorage["pv-clipboard-seconds"]`) keep their existing keys, formats, and storage APIs; the sort/clipboard extraction moves only the pure logic, never the storage key names or the storage call sites `[VERIFIED: grep for STORAGE_KEY/CLIPBOARD_SECONDS_KEY string literals — unchanged in the migration plan]` | None |
| Live service config | None — no external service (n8n, Datadog, etc.) is touched; this is a purely local monorepo refactor | None |
| OS-registered state | None | None |
| Secrets/env vars | None — no `.env`, SOPS key, or CI secret name references any of the six migrated modules | None |
| Build artifacts | `extension/.output/{chrome-mv3,firefox-mv2}` and `web/.next/`/`web/out/` will be stale relative to the new pv-ui subpath imports until the next build; this is expected and already the verification step (`npx wxt build`/`npx next build` per extraction step, matching 11-07's own verification commands) — not a hazard, just a required rebuild | Rebuild via the plan's own verification commands (already required by success criterion 1) |

**Node module resolution note (not a "runtime state" category but adjacent):** `node_modules/pv-ui` is a real symlink in both `web/` and `extension/` (`[VERIFIED: ls -la]`), so no `npm install`/`npm ci` re-run is needed after adding new files/subpaths inside `packages/pv-ui` — only the `exports` map (and, web-only, `tsconfig.json` `paths`) need new entries.

## Common Pitfalls

### Pitfall 1: `t()` is not currently dictionary-agnostic
**What goes wrong:** A naive `export * from "pv-ui/i18n/engine"` shim for `t` fails to compile or silently type-erases, because today's `t(locale, key)` closes over one specific `DICTIONARY` object per file — there is no shared shape to `export *` without either widening every call site's key-space or breaking the per-surface "does this key exist here" compile check.
**Why it happens:** The current implementation was independently written twice (web, then extension "following the exact structural pattern"), each closing over its own local constant — a natural but non-generic starting point.
**How to avoid:** Move to the generic `t<D>(dict, locale, key)` engine function (Pattern 1 above) and keep each consumer's local `t(locale, key)` as a thin, signature-preserving wrapper. Zero call-site churn at the ~29 existing `t(locale, key)` call sites.
**Warning signs:** TypeScript errors like "Type 'string' is not assignable to type `keyof typeof DICTIONARY`" at call sites, or a `t()` shim that silently accepts any string key without narrowing (losing the existing compile-time safety).

### Pitfall 2: Same-named i18n keys with different copy
**What goes wrong:** Assuming "same key name across both DICTIONARYs = safe to dedupe" and merging `vault.emptyHeading`/`vault.emptyBody`/`search.emptyResults`/`autolock.label` into `common.ts` changes one surface's actual visible microcopy — an unintended visual/behavior change this phase's success criteria explicitly forbid ("no visual change").
**Why it happens:** 34 of 38 same-named keys ARE byte-identical, making it easy to assume all 38 are safe to fold together without checking each one.
**How to avoid:** `[VERIFIED: node script comparing both DICTIONARY objects key-by-key]` — before writing `common.ts`, diff every candidate key's `{pl, en}` value across both dictionaries; only include genuinely identical ones. The plan should include this exact check as a task step, not trust the key-name match alone.
**Warning signs:** A UAT/visual-diff step showing web or extension copy text changed after the i18n extraction with no corresponding CONTEXT.md decision authorizing a copy change.

### Pitfall 3: Losing test coverage during the move (repeats a known deviation)
**What goes wrong:** Moving `cardBrand.ts`'s implementation to `pv-ui/vault/cardBrand.ts` and naively also moving `cardBrand.test.ts` there leaves `web/src/lib/vault/` with a shim file and NO local test exercising the shim chain — exactly what happened to `web/src/lib/generator/password.test.ts` in Phase 11-07 (its own documented Deviation #3).
**Why it happens:** "Move the implementation" is easy to over-apply to "move everything with that name," including the test.
**How to avoid:** Follow the established pattern: canonical test lives in `pv-ui` alongside the implementation (optional, e.g. `pv-ui/generator/password.test.ts` already does this for the generator); each consumer that has a local test file today keeps a local test file post-move, exercising its own shim's import chain. Note that `cardBrand.test.ts`, `types.test.ts` (web `types.test.ts` exists; extension has none), and `clipboard.test.ts` currently exist ONLY on the web side — the extension side genuinely has zero local coverage for these three modules today `[VERIFIED: find web/src/lib/vault extension/lib/vault -name "*.test.ts"]`. Do not assume symmetric coverage exists to preserve; there is a real, pre-existing gap.
**Warning signs:** `cd web && npx vitest run` test-file count drops after a task; a shim file whose corresponding local `*.test.ts` disappeared without an explicit decision to move (not delete) it.

### Pitfall 4: Structural literal-string guards can fire on moved/duplicated code, but are scoped narrowly here — verify, don't assume
**What goes wrong:** CONTEXT.md flags that the extension has whole-repo literal guards (`server-config.test.ts`'s hard-coded-URL walk, `no-ext-scoped-prf-strings.test.ts`'s forbidden-substring walk) that "may fire on moved code."
**Why it happens:** These are real repo-wide grep-based test guards.
**How to avoid / what was verified:** Both guards were checked against the live tree this session: `server-config.test.ts`'s walker scopes to `extension/` and explicitly skips `node_modules` `[VERIFIED: read server-config.test.ts:252-267]` — since `pv-ui` lives outside `extension/` and its symlinked copy inside `extension/node_modules/pv-ui` is skip-listed, this guard will NOT fire on the migration. `no-ext-scoped-prf-strings.test.ts`'s forbidden substrings (`extPasskey.`, `extPrf`, `ext-passkey`, `ext-prf`, `prf-capability`) were grepped against every file this phase touches (`dictionary.ts`, `autofill-dictionary.ts` on both sides) and found clean `[VERIFIED: grep -nE, zero matches]`. Re-run both guard tests after each extraction step anyway, since they are cheap and the whole point is "verified by search, not assumed" (success criterion 3's own wording).
**Warning signs:** Either guard test failing after an extraction step — treat as a real signal to fix, not to relax the guard (per CONTEXT.md: "adjust the guard, don't contort the extracted module" — but in THIS phase's case, no guard is expected to fire at all).

### Pitfall 5: `types.ts` reconciliation — verify the additive-only claim before trusting it
**What goes wrong:** Adopting web's `types.ts` (superset: optional `CardFields.pin`/`zip`, structured `IdentityFields.addressLine1..country`) as canonical for the extension without checking whether the extension's autofill code reads any of the OLD flat shape in a way that would break if new optional fields appear.
**Why it happens:** "Additive-only" is easy to assert and hard to fully verify without checking every read site.
**How to avoid / what was verified:** `extension/lib/autofill/fill-dom.ts` (the only autofill file that touches `IdentityFields`) reads exactly one field — the legacy flat `address` string, via `write(targets.address, values.address)` — and never reads any structured field `[VERIFIED: grep "address" extension/lib/autofill/fill-dom.ts]`. The web-only `identityAddress.ts` compose helpers (which turn structured fields into the flat string for display/autofill) are NOT part of this phase's migration scope (they're ItemForm.tsx-specific composition logic, not part of the `types.ts` shape reconciliation) — leave them in `web/src/lib/vault/`, do not move them to `pv-ui`.
**Warning signs:** A TypeScript error in `extension/lib/autofill/fill-dom.ts` or `extension/entrypoints/background/autofill-match.ts` after adopting the superset type — would indicate an unverified read site was missed.

## Code Examples

### Existing shim pattern (already proven, replicate verbatim for each new pure module)
```typescript
// Source: extension/lib/generator/password.ts (Phase 11, D-13) — the exact template to copy
export * from "pv-ui/generator/password";
```

### pv-ui `package.json` exports map — additions needed this phase
```jsonc
// Source: packages/pv-ui/package.json — existing shape, 7 new entries needed
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

### `web/tsconfig.json` — path aliases to add (extension needs NONE, verified)
```jsonc
// Source: web/tsconfig.json — existing "pv-ui/generator/*" entry is the precedent
"paths": {
  "@/*": ["./src/*"],
  "pv-ui/generator/*": ["../packages/pv-ui/generator/*"],
  "pv-ui/vault/*": ["../packages/pv-ui/vault/*"],
  "pv-ui/i18n/*": ["../packages/pv-ui/i18n/*"],
  "pv-ui/clipboard": ["../packages/pv-ui/clipboard.ts"]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|---------------|-------------------|---------------|--------|
| Independent hand-copied logic in `web/` and `extension/` for cardBrand/search/sort/clipboard/types/i18n, kept in sync manually (some files literally document "mirror-not-cross-import" as a deliberate convention) | Single source in `packages/pv-ui`, both consumers shim | This phase (16) | ~1,200–1,500 combined LOC of parallel-maintained duplication collapses to ~700 LOC in one location + thin shims; a future bugfix in shared logic becomes one edit instead of two mechanically-synced edits |
| `t(locale, key)` closing over a module-private `DICTIONARY` | `t<D>(dict, locale, key)` generic engine + per-consumer thin wrapper preserving the old call signature | This phase (16) | Enables true engine sharing without widening any surface's compile-time key-space or forcing a single merged dictionary |

**Deprecated/outdated:**
- The `extension/lib/clipboard.ts` header comment's "mirror-not-cross-import convention" framing: this predates `pv-ui` (Phase 11) and is now obsolete — both files already use identical `localStorage`-based logic and are a pure `export *` candidate, not a mirror-by-convention one.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|----------------|
| A1 | `web/tsconfig.json`'s `pv-ui/generator/*` path alias is strictly necessary (not just belt-and-suspenders) for `next build`/`tsc` to resolve pv-ui subpaths, given `moduleResolution: "bundler"` should already read the `exports` map | Standard Stack, Code Examples | Low — 11-07-SUMMARY.md's own deviation log shows the alias WAS added and DID matter for the initial Turbopack resolution attempt (before the `turbopack.root` fix), so replicating it is the safe, already-validated choice even if theoretically redundant under pure `exports`-map resolution |

**If this table is empty:** N/A — the one assumption above is low-risk and defensively resolved by following the proven precedent rather than the theoretically-minimal path.

## Open Questions (RESOLVED)

1. **Should `common.ts` exist as a separate file, or should the ~30 shared keys just live inline in each consumer's `DICTIONARY` initializer via spread, with no intermediate export?**
   - What we know: CONTEXT.md explicitly names `pv-ui/i18n/common.ts` as the target (research Phase B wording, reaffirmed in this phase's locked decisions).
   - What's unclear: Whether `common.ts` should export a single `COMMON_DICTIONARY` object (spread into each consumer's `DICTIONARY`) or export a `common(locale, key)` helper — the spread-object form is simpler and keeps `keyof typeof DICTIONARY` correctly widened per-consumer.
   - Recommendation: Use the spread-object form (`export const COMMON_DICTIONARY = {...} satisfies Record<string, {pl:string;en:string}>`) — matches Pattern 1's example above and requires no new runtime concept beyond what `DICTIONARY` already is.
   - RESOLVED: spread-object form adopted — Plan 16-04 Task 2 creates `pv-ui/i18n/common.ts` exporting `COMMON_DICTIONARY`, spread into each consumer's `DICTIONARY`.

2. **Should the extension gain new local test files for `cardBrand.ts`/`types.ts`/`clipboard.ts` to close the coverage gap noted in Pitfall 3?**
   - What we know: The extension currently has zero local test coverage for these three modules; only `search.test.ts` and `sort.test.ts` exist locally.
   - What's unclear: Success criterion 1 requires "both test suites pass unchanged" — it does not require NEW coverage. Adding tests is a legitimate opportunity but arguably out of this phase's stated scope (behavior-neutral extraction).
   - Recommendation: Leave as Claude's discretion at plan time; not required for success criteria, but flagged here so it isn't silently lost as "someone else's problem" if the planner chooses to add it.
   - RESOLVED: extension-side test gap deliberately left as-is — Plan 16-03 explicitly records the decision (behavior-neutral extraction; new coverage out of phase scope). Not silently dropped.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|-----------------|---------|--------------------|
| V2 Authentication | No | Not touched — no auth code is migrated |
| V3 Session Management | No | Not touched |
| V4 Access Control | No | Not touched |
| V5 Input Validation | No (unchanged) | `detectCardBrand`/`searchItems`/`sortItems`/`normalizeItemFields` are pure functions over already-client-side-decrypted data; their existing input-handling behavior is moved verbatim, not modified |
| V6 Cryptography | No | Zero-knowledge boundary is unaffected — none of the six migrated modules ever touch key material, PRF output, or ciphertext; `cardBrand.ts`'s own header comment already documents "this only ever runs client-side over an already-decrypted number" |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Silent microcopy/behavior drift introduced by a "pure refactor" that isn't actually behavior-neutral | Tampering (of intended behavior, not an external attacker) | Grep-based verification (success criterion 3) + the divergent-copy exclusion (Pitfall 2) + running both existing test suites unchanged (success criterion 1) — this phase's own acceptance criteria already function as the mitigation |

This phase introduces no new attack surface (no new endpoints, no new stored data, no new external input parsing) — it moves existing, already-reviewed client-side logic between files. The relevant "security" bar for this phase is behavioral equivalence, which the plan's own verification loop (both test suites green, both builds green, grep-verified zero duplication) already covers.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3.2.4 (web) / 3.2.7 (extension, pinned per `extension/vitest.config.ts` comments) |
| Config file | `web/vitest.config.ts`, `extension/vitest.config.ts` |
| Quick run command | `cd web && npx vitest run <path>` / `cd extension && npx vitest run <path>` |
| Full suite command | `cd web && npx vitest run && npx tsc --noEmit` / `cd extension && npx vitest run && npx tsc --noEmit` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|---------------------|--------------|
| DS-01 | `cardBrand`/`search`/`sort` comparator/`clipboard`/`types` produce identical behavior after moving to `pv-ui` | unit | `cd web && npx vitest run src/lib/vault src/lib/clipboard.test.ts && cd ../extension && npx vitest run lib/vault lib/clipboard` | ✅ existing files, most need no new content, just continued-passing |
| DS-01 | No parallel duplicate implementation survives | structural/grep | `grep -rn "function detectCardBrand\|function domainFromUrl\|function sortItems\|function copyWithAutoClear" web/src extension/lib --include="*.ts" \| grep -v "/pv-ui/" ` (adapt per-symbol; expect exactly zero non-shim hits outside `pv-ui/`) | ❌ Wave 0 — this is a one-off verification command in the plan, not a persistent test file (mirrors `server-config.test.ts`'s own precedent if the planner wants a permanent guard) |
| DS-02 | Shared engine (`t`/`interpolate`/`Locale`/`resolveLocale`) produces identical output on both surfaces; dictionary key split preserves exact existing copy | unit | `cd web && npx vitest run src/lib/i18n && cd ../extension && npx vitest run lib/i18n` | ⚠️ Neither `dictionary.ts` currently has a dedicated `.test.ts` (`t`/`interpolate` are exercised indirectly via component tests) — Wave 0 gap: add `pv-ui/i18n/engine.test.ts` covering the new generic `t<D>()` directly |
| DS-02 | Both test suites pass unchanged (success criterion 1) | integration | `cd web && npx vitest run && npx tsc --noEmit && npx next build` / `cd extension && npx vitest run && npx tsc --noEmit && npx wxt build && npx wxt build -b firefox` | ✅ all commands already exist as `package.json` scripts or documented `npx` invocations (11-07-SUMMARY.md precedent) |

### Sampling Rate
- **Per task commit:** `cd web && npx vitest run <changed-path>` / `cd extension && npx vitest run <changed-path>` (fast, matches 11-07's own per-task verification granularity)
- **Per wave merge:** Full suite both sides + both builds (`next build`, `wxt build`, `wxt build -b firefox`)
- **Phase gate:** Full suite green + the grep-based zero-duplication check green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `packages/pv-ui/i18n/engine.test.ts` — covers DS-02's new generic `t<D>(dict, locale, key)` directly (neither existing dictionary.ts has a dedicated test file for `t`/`interpolate` today; they're only exercised indirectly through component tests, per `grep -rl` results)
- [ ] No other Wave-0 test-framework gaps — both `web/vitest.config.ts` and `extension/vitest.config.ts` already run and are already correctly configured for `.ts` files inside a sibling `packages/` directory (proven by the existing `generator/password.test.ts` passing today)

## Sources

### Primary (HIGH confidence)
- Live-tree file inspection (`Read`, `diff`, `wc -l`, `grep`, `node -e`) against the actual repository state as of this research session — every LOC/diff/key-overlap figure in this document was measured directly, not taken from the (partially-stale, per CONTEXT.md's own drift warning) commissioned research doc
- `.planning/phases/11-generate-capture/11-07-SUMMARY.md` — the proven end-to-end precedent for this exact extraction mechanism, including its 5 documented deviations (Turbopack workspace-root, CSS `@import` ordering, lost test coverage, 2x test-isolation leaks)
- `.planning/research/v0.3/DESIGN-SYSTEM-UNIFICATION.md` — commissioned research; used for migration-order and consumption-model guidance, cross-checked (not trusted blindly) against the live tree per CONTEXT.md's explicit instruction

### Secondary (MEDIUM confidence)
- None — this phase required no external documentation lookup (no new libraries, no new APIs); all findings are first-party codebase inspection

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — the mechanism is already implemented and working in this exact codebase (generator/tokens.css), not inferred from documentation
- Architecture: HIGH — every diff/overlap figure was measured directly against the live tree this session
- Pitfalls: HIGH — grounded in a real, documented prior deviation (11-07's test-coverage loss) plus direct measurement of the 4 divergent dictionary keys and the `t()` closure problem

**Research date:** 2026-07-20
**Valid until:** Effectively indefinite for the architectural findings (internal code shape doesn't drift like external APIs) — but re-verify the dictionary key-overlap/divergence numbers immediately before planning if any i18n-touching quick task or phase lands between this research and `/gsd-plan-phase 16` executing, per the same drift risk CONTEXT.md already flagged once for Phase 15.
