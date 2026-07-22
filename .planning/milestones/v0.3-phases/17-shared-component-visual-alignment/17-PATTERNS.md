# Phase 17: Shared Component & Visual Alignment - Pattern Map

**Mapped:** 2026-07-21
**Files analyzed:** 9 (create/modify)
**Analogs found:** 9 / 9

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/pv-ui/components/ItemIconTile.tsx` (NEW) | component | request-response (client render + direct favicon fetch) | `web/src/components/vault/ItemIconTile.tsx` | exact (verbatim promotion source) |
| `web/src/components/vault/ItemIconTile.tsx` (MODIFY → shim) | component (re-export shim) | n/a | `web/src/lib/vault/cardBrand.ts` (Phase 16 shim) | exact |
| `extension/entrypoints/popup/ItemIconTile.tsx` (MODIFY → shim) | component (thin wrapper) | request-response | `extension/lib/vault/cardBrand.ts` (Phase 16 shim) | role-match (shim pattern; this one wraps a component, not `export *`) |
| `packages/pv-ui/package.json` (MODIFY) | config | n/a | itself, prior state (Phase 16 exports map growth) | exact |
| `packages/pv-ui/tokens.css` (MODIFY) | config/design-token | n/a | itself, prior state (existing `[data-theme]` blocks) | exact |
| `extension/lib/autofill/inpage-overlay.ts` (MODIFY, CSS-only) | utility (imperative shadow-DOM builder) | event-driven / DOM-mutation | itself, prior state — `.pv-row-icon-tile`/`.pv-row-icon` rules | exact |
| `packages/pv-ui/components/_probe.tsx` (DELETE or repurpose) | test/fixture | n/a | none — pre-existing scratch file, decide fate | n/a |
| `web/src/app/globals.css` (MODIFY, add `@source`) | config | n/a | `extension/entrypoints/popup/style.css` (already has the equivalent `@import` line; `@source` line itself was found uncommitted there per RESEARCH) | role-match |
| `extension/entrypoints/popup/style.css` (MODIFY, commit `@source` line) | config | n/a | `web/src/app/globals.css` (needs the same `@source` added fresh) | role-match |
| `packages/pv-ui/node_modules` install step + `Dockerfile` (Option A, if chosen) | config/build | n/a | existing `predev`/`prebuild: bash ../scripts/build-wasm.sh` bootstrap steps in `web/package.json`/`extension/package.json`; existing `COPY packages/pv-ui/` + `npm ci` staging in `Dockerfile` | role-match |

## Pattern Assignments

### `packages/pv-ui/components/ItemIconTile.tsx` (NEW — component, request-response)

**Analog:** `web/src/components/vault/ItemIconTile.tsx` (179 LOC, promote verbatim, then fold in extension deltas)

**Imports pattern** (web source, lines 1-7 — becomes pv-ui-relative post-promotion per CONTEXT.md discretion: import `pv-ui/vault/types`, `pv-ui/vault/search`, `pv-ui/vault/cardBrand` directly, NOT via either consumer's shim):
```typescript
"use client";

import { useEffect, useState } from "react";
import { CreditCard, Globe, IdCard, KeyRound, StickyNote, Timer } from "lucide-react";
import type { ItemType, VaultItem } from "pv-ui/vault/types";
import { domainFromUrl } from "pv-ui/vault/search";
import { detectCardBrand, type CardBrand } from "pv-ui/vault/cardBrand";
```
Note: `"use client"` directive is REQUIRED — confirmed in RESEARCH.md (a probe component omitting it hit Next's Server-Component boundary error immediately).

**Core pattern — favicon-first tile with card-brand + type-glyph fallback** (web source, lines 34-125): hostname resolution (`faviconHostnameFor`), module-level `FAILED_FAVICON_HOSTS` cache, `useState`+`useEffect` re-derivation keyed on `hostname`, card-brand short-circuit before favicon render, direct `<img src="https://${hostname}/favicon.ico">` with `referrerPolicy="no-referrer"` and `onError` fallback to `TYPE_ICON` glyph. Copy this block near-verbatim.

**Extension-only deltas to fold in** (from `extension/entrypoints/popup/ItemIconTile.tsx`, lines 23-33 and 55):
```typescript
// Keep this const in the shared component (UI-SPEC recommendation — harmless in web,
// dodges server-config.test.ts's guard without touching its regex):
const FAVICON_URL_PREFIX = "https://";
// ...used as: src={`${FAVICON_URL_PREFIX}${hostname}/favicon.ico`}

// Fold the defensive Array.isArray guard into faviconHostnameFor():
const urls = Array.isArray(item.fields.urls) ? item.fields.urls : [];
const url = urls.find((u) => u.trim() !== "");
```

**Size/variant contract** (web source, lines 51-54, 63-70) — carried verbatim, `variant` prop default `"row"`:
```typescript
const SIZE = {
  row: { frame: "h-8 w-8 rounded-[8px]", icon: 18 },
  header: { frame: "h-6 w-6 rounded-[6px]", icon: 14 },
} as const;
```

**Tile bg/fg — DO NOT convert to CSS tokens** (web source, lines 60-61) — UI-SPEC is explicit these stay Tailwind arbitrary-variant strings, unchanged through promotion:
```typescript
const TILE_BG = "bg-base-200 [[data-theme=vault-dark]_&]:bg-zinc-100";
const TILE_FG = "text-base-content/70 [[data-theme=vault-dark]_&]:text-zinc-600";
```

**Card-brand tiles** (web source, lines 131-179) — copy `CardBrandTile` verbatim, pure CSS + inline SVG, no external asset.

**Error handling pattern:** silent-only — a failed favicon fetch never throws or surfaces an error; it flips `faviconFailed` state and permanently caches the hostname in the module-level `Set`. No try/catch needed; this is an `onError` DOM callback.

---

### `web/src/components/vault/ItemIconTile.tsx` (MODIFY → re-export shim)

**Analog:** `web/src/lib/vault/cardBrand.ts` (Phase 16 shim pattern)

**Shim pattern to copy** (full file, `web/src/lib/vault/cardBrand.ts`):
```typescript
// Thin re-export shim — the real implementation now lives in
// packages/pv-ui/vault/cardBrand.ts (D-13, plan 16-03: pv-ui is the
// single source of truth for card-brand detection, shared by web and
// extension). This shim keeps every existing "./cardBrand" /
// "@/lib/vault/cardBrand" import path (and this file's own
// cardBrand.test.ts) working with zero consumer churn.
export * from "pv-ui/vault/cardBrand";
```

Adapted for a default-export React component (UI-SPEC Component Contract table, verbatim target):
```typescript
export { default } from "pv-ui/components/ItemIconTile";
```
4 existing web importers stay unchanged (import from `./ItemIconTile` / `@/components/vault/ItemIconTile` as before).

---

### `extension/entrypoints/popup/ItemIconTile.tsx` (MODIFY → thin wrapper shim)

**Analog:** `extension/lib/vault/cardBrand.ts` (Phase 16 shim, adapted — this file needs a wrapper, not a bare `export *`, because it must pin `variant="row"`)

**Pattern** (per UI-SPEC Component Contract table):
```typescript
import ItemIconTile from "pv-ui/components/ItemIconTile";
export default function PopupItemIconTile({ item }: { item: VaultItem }) {
  return <ItemIconTile item={item} variant="row" />;
}
```
3 existing extension importers stay unchanged. Note: `VaultItem` type should import from `pv-ui/vault/types` in the shim too, matching Phase 16's direct-pv-ui-import convention (not `../../lib/vault/types`).

---

### `packages/pv-ui/package.json` (MODIFY — add exports subpath + peerDependencies)

**Analog:** itself, prior state (existing `exports` map growth pattern from Phase 16 entries like `./vault/cardBrand`)

**Pattern to copy** (existing entries, lines 21-24, as the template for the new subpath):
```json
"./vault/cardBrand": {
  "types": "./vault/cardBrand.ts",
  "default": "./vault/cardBrand.ts"
}
```

**New entry + peerDeps, verified-working shape** (RESEARCH.md `## Code Examples`, Option A):
```json
{
  "exports": {
    "...": "...(existing entries unchanged)...",
    "./components/*": {
      "types": "./components/*.tsx",
      "default": "./components/*.tsx"
    }
  },
  "peerDependencies": {
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "lucide-react": "1.24.0"
  },
  "devDependencies": {
    "react": "19.2.7",
    "react-dom": "19.2.7",
    "lucide-react": "1.24.0",
    "@types/react": "19.2.17"
  }
}
```
**Critical caveat (must be resolved before writing this task):** `peerDependencies` alone installs nothing — Option A (recommended in RESEARCH.md) requires `devDependencies` too PLUS a new install step (`npm ci` inside `packages/pv-ui`) wired into the existing `predev`/`prebuild` bootstrap pattern already used by `web/package.json` and `extension/package.json` (`prebuild: bash ../scripts/build-wasm.sh`-style). This is a genuinely new decision point, not a copy-paste — see RESEARCH.md `## Critical Finding` and `## Open Questions` #1.

---

### `packages/pv-ui/tokens.css` (MODIFY — add `--pv-tile-bg`/`--pv-tile-fg`)

**Analog:** itself, prior state — existing `[data-theme]` block structure (lines 32-33, 54-55)

**Exact insertion pattern** (UI-SPEC Color section, verified against `tailwindcss/theme.css` zinc-100/zinc-600):
```css
:root,
[data-theme="vault-dark"] {
  /* ...existing tokens unchanged... */
  --pv-tile-bg: oklch(96.7% 0.001 286.375);  /* = Tailwind v4 zinc-100 */
  --pv-tile-fg: oklch(44.2% 0.017 285.786);  /* = Tailwind v4 zinc-600 */
}

[data-theme="vault-light"] {
  /* ...existing tokens unchanged... */
  --pv-tile-bg: var(--color-base-200);
  --pv-tile-fg: color-mix(in oklch, var(--color-base-content) 70%, transparent);
}
```
Must be added INSIDE the existing blocks (not new selector blocks) so `inpage-theme.ts`'s `:root`→`[data-theme]` regex rewrite (`tokensCss.replace(/(^|\})(\s*):root\s*,/gm, "$1$2[data-theme],")`) automatically covers them — zero changes needed to `inpage-theme.ts` itself.

---

### `extension/lib/autofill/inpage-overlay.ts` (MODIFY — CSS-only, 2 declarations)

**Analog:** itself, prior state (lines 261-273 — this is a targeted find/replace + one addition, not a new pattern)

**Current buggy state** (verified source read, lines 261-273):
```css
.pv-row-icon-tile {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-base-200);
}
.pv-row-favicon { width: 100%; height: 100%; object-fit: contain; }
.pv-row-icon { width: 16px; height: 16px; flex-shrink: 0; }
```

**Target fix** (UI-SPEC In-Page Token Contract, exact diff):
```css
.pv-row-icon-tile {
  /* ...unchanged... */
  background: var(--pv-tile-bg);   /* was: var(--color-base-200) — the dark-tile bug */
}
.pv-row-icon {
  width: 16px; height: 16px; flex-shrink: 0;
  color: var(--pv-tile-fg);        /* NEW declaration — none exists today. SVGs (ROW_ICON,
                                       injected via .innerHTML at line ~448) already use
                                       stroke="currentColor", so this alone fixes the glyph flip. */
}
```
**Pitfall (RESEARCH.md Pitfall 2):** `.pv-row-icon-tile` is a value SWAP on an existing declaration; `.pv-row-icon` needs a NEW `color` declaration added — do not treat both as the same kind of diff.

Both `renderFieldDropdown()` (Surface A) and `renderFormPrompt()` (Surface B) route through the same `buildIconTile()` (line 436) and the same `.pv-row-icon-tile`/`.pv-row-icon` classes — one CSS fix covers both surfaces named in UX-01.

---

### `web/src/app/globals.css` / `extension/entrypoints/popup/style.css` (MODIFY — `@source` line)

**Analog:** each other (cross-reference — one already has the `@import`, needs `@source` added; extension's `@source` line reportedly exists uncommitted per RESEARCH's Environment State Found, but was NOT found in current source read — verify at execution time whether it needs adding fresh or was already reverted)

**Current state, both files** (verified source read):
```css
/* web/src/app/globals.css */
@import "tailwindcss";
@import "pv-ui/tokens.css";
@plugin "daisyui";

/* extension/entrypoints/popup/style.css */
@import "tailwindcss";
@import "pv-ui/tokens.css";
@plugin "daisyui";
```
Neither file currently has an `@source` line (grep found none in either at pattern-mapping time — RESEARCH's "already present, uncommitted" claim for the popup file did not reproduce in this read; treat as needing to be ADDED FRESH to both, and verify via `npm run build`/`wxt build -b chrome` per RESEARCH's Pattern 3).

**Required addition** (RESEARCH.md Pattern 3, verified-necessary):
```css
@import "pv-ui/tokens.css";
@source "../../../packages/pv-ui/components/**/*.tsx";
@plugin "daisyui";
```
Path depth verified identical for both files (3 levels up to repo root in each case).

---

## Shared Patterns

### Zero-knowledge favicon fetch (hard security invariant — applies to the shared component)
**Source:** `web/src/components/vault/ItemIconTile.tsx` lines 16-22 (header comment) + lines 102-107 (implementation)
**Apply to:** `packages/pv-ui/components/ItemIconTile.tsx` — MUST be preserved byte-for-byte
```typescript
<img
  src={`https://${hostname}/favicon.ico`}
  alt=""
  loading="lazy"
  referrerPolicy="no-referrer"
  ...
/>
```
Never a third-party favicon proxy (Google/DDG/s2 endpoints), never routed through `pv-server`. This is a project CLAUDE.md Constraints-level invariant, not just a code style choice.

### Phase 16 shim template (`export *` re-export)
**Source:** `web/src/lib/vault/cardBrand.ts`, `extension/lib/vault/cardBrand.ts`
**Apply to:** `web/src/components/vault/ItemIconTile.tsx` (default-export variant: `export { default } from "..."`), and as the conceptual template for `extension/entrypoints/popup/ItemIconTile.tsx`'s thin wrapper (which additionally must pin `variant="row"`, so it cannot be a bare `export *`)

### pv-ui exports-map-as-sole-authority
**Source:** `packages/pv-ui/package.json` (existing `exports` map), Phase 16 precedent referenced in both CONTEXT.md and UI-SPEC.md
**Apply to:** the new `./components/*` subpath — do NOT re-add `tsconfig.json` path aliases in either consumer to compensate for peer-dep resolution gaps (RESEARCH.md's Anti-Patterns section: a blunt `tsconfig.json` `paths` override for bare `"react"`/`"lucide-react"` was verified to silently break `@types/react` resolution app-wide — do not attempt this even if it looks like the obvious fix for the `tsc` peer-dep gap)

### Shadow-DOM token rewrite adapter (already generic — zero changes needed)
**Source:** `extension/lib/autofill/inpage-theme.ts` lines 33, 53
**Apply to:** the two new `--pv-tile-bg`/`--pv-tile-fg` tokens — no code change to this file required, only to `tokens.css` (must stay inside the existing `:root,[data-theme="vault-dark"]` / `[data-theme="vault-light"]` blocks, not new selector blocks)

## No Analog Found

None — every file in scope has a strong same-role/same-data-flow analog (mostly "itself, prior state" for CSS/config edits, or a Phase 16 shim/promotion precedent for the new component). The one genuinely novel piece — `pv-ui`'s first peer-dependency install step — has no in-repo analog beyond the structurally-similar `predev`/`prebuild: bash ../scripts/build-wasm.sh` bootstrap pattern; RESEARCH.md's `## Critical Finding` and `## Code Examples` are the authoritative source for this piece, not a codebase file.

## Metadata

**Analog search scope:** `web/src/components/vault/`, `web/src/lib/vault/`, `extension/entrypoints/popup/`, `extension/lib/vault/`, `extension/lib/autofill/`, `packages/pv-ui/` (package.json, tokens.css, vault/)
**Files scanned:** 9 read directly (ItemIconTile.tsx ×2, cardBrand.ts shims ×2, cardBrand.ts source, package.json, tokens.css, inpage-theme.ts, inpage-overlay.ts excerpt), plus globals.css/style.css/server-config.test.ts grepped
**Pattern extraction date:** 2026-07-21
