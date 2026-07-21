# Phase 17: Shared Component & Visual Alignment - Research

**Researched:** 2026-07-21
**Domain:** Cross-bundler React-component sharing (Next.js/Turbopack + WXT/Vite) via a source-only, no-build monorepo package; CSS custom-property token propagation into a closed shadow-DOM content script
**Confidence:** HIGH — every claim in the sections below marked `[VERIFIED: live build]` was produced by actually running `next build`, `wxt build -b chrome`, `vitest run`, and `tsc --noEmit` against this repo's real toolchain during this research session (not simulated, not assumed), then reverting all test artifacts. The repo is confirmed clean at the end of this session (see `## Environment State Found` below for the one pre-existing exception).

## Summary

This phase's hardest problem is NOT the visual fix (that part — two new CSS custom properties, one `background:`/`color:` swap — is small and fully verified against the live tree with zero surprises). The hard problem is DS-03: this is `pv-ui`'s **first** `.tsx`/React-with-peer-dependencies file, and the commissioned research's "add `peerDependencies` + a `./components/*` exports subpath, done" plan is **necessary but not sufficient**. This research empirically built and ran the real promotion (a throwaway probe component, `pv-ui`'s real exports/peerDeps shape, real consumer builds) and found a genuine, previously-undocumented failure mode: **any peer package without its own `"exports"` field in `package.json` (e.g. `lucide-react`) fails to resolve from a file whose real filesystem path lives outside the consuming project's own directory tree** — in both Vite (vitest, and by the same mechanism WXT's own Vite pipeline) and Turbopack (`next build`), and independently in `tsc`. `react` itself (which *does* ship an `exports` map) resolves fine without any fix; `lucide-react` (which does not) does not. This is exactly the situation the real `ItemIconTile.tsx` is in: it imports both.

The clean, uniformly-verified fix is to give `packages/pv-ui` its own local `node_modules` containing `react`, `react-dom`, `lucide-react`, and `@types/react` resolvable at the versions the two consumers already pin — this single change made Vite, Turbopack, **and** `tsc --noEmit` all pass cleanly with **zero** changes to either consumer's `vite.config`/`next.config`/`tsconfig.json`. A consumer-side-only alternative (Vite `resolve.preserveSymlinks: true` + Turbopack `resolveAlias`) was also verified to fix the two *runtime* bundlers, but does **not** fix `tsc`, and a naive `tsconfig.json` `paths` override to fix `tsc` was verified to be actively harmful (it silently breaks `@types/react` resolution for the entire rest of the app — do not do this). This tension directly touches the Phase 16 "exports map is the sole resolution authority, do not re-add tsconfig paths" precedent and needs an explicit decision at plan time — see `## Critical Finding` below.

The rest of DS-04/UX-01's scope is exactly as small as CONTEXT.md/UI-SPEC describe: one CSS rule in `inpage-overlay.ts` currently reads `background: var(--color-base-200)` unconditionally on `.pv-row-icon-tile` (the bug), and `.pv-row-icon` has no `color` declaration at all for the fallback glyph. Two new tokens in `tokens.css`'s existing `[data-theme]` blocks fix both, flow automatically through the existing `inpage-theme.ts` `:root`→`[data-theme]` rewrite adapter with **zero** changes to that file, and the SVG glyphs already use `stroke="currentColor"` so the `color:` fix takes effect for free.

**Primary recommendation:** Do the DS-04/UX-01 token fix first (small, fully de-risked, zero open questions) — then do DS-03's component promotion, but resolve the `pv-ui` peer-dependency question explicitly before writing tasks (this research recommends Option A — give `pv-ui` a real local `node_modules` for its 4 peer packages via a new install step wired into the existing `predev`/`prebuild` bootstrap pattern — see `## Critical Finding`).

## Environment State Found

Before any research edits, `git status` showed two **pre-existing, uncommitted** changes not made by this research session, left over from prior exploration:
- `extension/entrypoints/popup/style.css` has an uncommitted `+@source "../../../packages/pv-ui/components/**/*.tsx";` line already added.
- `packages/pv-ui/components/_probe.tsx` exists, untracked, containing a trivial non-hook component with two unusual Tailwind arbitrary-value classes (`tracking-[13.37px] bg-[#0a1b2c]`) — clearly a prior manual probe of Tailwind content-detection, never wired to any exports-map entry and never imported by anything.

**These findings turned out to be load-bearing evidence, not noise** — this research used exactly this probe file to empirically confirm the extension's `@source` fix works (see Critical Unknown #1), then extended the same technique to web. **The planner must decide whether to formalize this into the plan** (the popup `@source` line needs to be committed, not left dangling; `_probe.tsx` should be deleted once real components exist, or kept/renamed as an intentional Tailwind-detection regression fixture — Claude's discretion, but it must not be silently left in its current half-finished, uncommitted state). This research left both files exactly as found; no other diffs remain.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| `ItemIconTile` rendering (web/popup) | Browser/Client (React component) | — | Pure presentational component, no server round-trip; favicon fetch is client-direct per zero-knowledge rule |
| `ItemIconTile` rendering (in-page dropdown/prompt) | Browser/Client (imperative shadow-DOM controller) | — | Architecturally separate from React by phase-10/11 decision; consumes the same design tokens, not the same component |
| Design tokens (`--pv-tile-bg`/`--pv-tile-fg`) | Static/Design-system source (`pv-ui/tokens.css`) | Browser/Client (both consumption paths) | Single CSS source of truth; two different consumption mechanisms (Tailwind arbitrary-variant classes for React, raw `var()` for the shadow DOM) but one value origin |
| Module resolution / bundling | Build tooling (Turbopack, WXT/Vite, tsc) | — | Not a runtime capability at all — this phase's actual technical risk lives entirely here, not in any request/response path |

## User Constraints

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**In-page tile appearance & token-drift policy (Bartek accepted 2026-07-21)**
- Tile background in vault-dark: in-page tiles get the SAME flip as web/popup — light neutral (`zinc-100`-equivalent) in vault-dark so dark favicons (GitHub etc.) stay visible; `base-200` stays in vault-light. Mirrors Bartek's original live-review decision encoded in web's `TILE_BG = "bg-base-200 [[data-theme=vault-dark]_&]:bg-zinc-100"`.
- Fallback type-glyph color on the light tile: dark neutral glyph (matching web's flip behavior), so the glyph never vanishes on the light tile.
- Scope: EVERY in-page row tile gets the light-tile rule — dropdown (Surface A), prompt (Surface B), and any tile rendered by generate-popover/save-toast — one consistent rule, not just the two surfaces named in UX-01.
- Token drift: when a hand-written overlay style value differs from the pv-ui token, ADOPT the token value — small visual corrections are the point of DS-04; no pixel-freezing drifted values.

### Claude's Discretion (architecture — locked by commissioned research §Phase C)
- Promote web's `ItemIconTile.tsx` (the superset: `variant: "row" | "header"`) to `pv-ui/components/ItemIconTile.tsx`; popup passes `variant="row"`. Both import sites become shims/imports of the shared component.
- pv-ui `package.json` gains `peerDependencies: { react, react-dom, lucide-react }` and a `./components/*` exports subpath. pv-ui stays source-only — no build step. NOTE (Phase 16 decision): the exports map is the SOLE resolution authority — do NOT re-add tsconfig paths.
  - **This research's Critical Finding directly qualifies this note — see `## Critical Finding` below. "No tsconfig paths" and "peer-dependency resolution actually works" are in tension once `pv-ui` ships real React with non-`exports`-mapped peers; a decision is needed at plan time.**
- Extension-only deltas: (a) `FAVICON_URL_PREFIX` indirection exists solely to dodge `server-config.test.ts`'s hard-coded-URL regex guard — either keep the prefix const in the shared component or relax the guard for pv-ui (adjust the guard, don't contort the component); (b) fold the defensive `Array.isArray(urls)` into the shared version (harmless in web).
- The shared component imports `pv-ui/vault/types`, `pv-ui/vault/search` (domainFromUrl), `pv-ui/vault/cardBrand` directly (post-Phase-16 canonical modules) — not via consumer shims.
- In-page overlays CANNOT consume the React component — they get the light-tile rule via tokens/CSS in their hand-written closed-shadow styles (the `[data-theme]` rewrite adapter from `inpage-theme.ts` applies; every new token consumed in-page needs the rewrite + a stamped carrier).
- How to express "light tile in vault-dark" as a token for the overlays: Claude's discretion — but the value must come from pv-ui, not be hand-copied (DS-04's whole point).

### Deferred Ideas (OUT OF SCOPE)
- Broader shared component library (ItemRow, DetailPanel, dialogs) — research "Phase D", post-v0.3.
- In-page consent panel alternative — Phase 18 (XBR-03 decision gate).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DS-03 | `ItemIconTile` exists once as a shared React component in `pv-ui`, consumed by both the web app and the extension popup | Component promotion mechanics fully mapped (source file diff is near-zero, see Code Examples); the actual blocking risk — peer-dependency resolution — is fully root-caused and two fix options are verified working, see Critical Finding |
| DS-04 | The in-page overlays consume `pv-ui` design tokens as their single style source | Audit re-verified: exactly one real bug (`.pv-row-icon-tile`'s unconditional `background: var(--color-base-200)`) plus one missing declaration (`.pv-row-icon`'s `color`); every other color/radius/border value in the 5 overlay files already references a token. `rgba()` box-shadow elevation + `999px` pill radii confirmed to have no `pv-ui` token equivalent — correctly out of scope |
| UX-01 | In-page autofill surfaces render item logos on a LIGHT tile matching web/popup | `stroke="currentColor"` confirmed on every `ROW_ICON` SVG glyph — the `.pv-row-icon { color: var(--pv-tile-fg) }` fix will visually take effect with no SVG markup changes needed; `inpage-theme.ts`'s `:root`→`[data-theme]` rewrite regex requires zero changes since the new tokens live inside the same `:root, [data-theme="vault-dark"]` / `[data-theme="vault-light"]` blocks it already rewrites |
</phase_requirements>

## Critical Finding — `pv-ui`'s Peer-Dependency Resolution Problem (DS-03's real risk)

This is the single most consequential finding of this research and should be read before planning any DS-03 tasks.

### The problem, precisely

`pv-ui` is consumed by both `web/` and `extension/` via a `file:../packages/pv-ui` dependency, materialized as a symlink (`web/node_modules/pv-ui -> ../../packages/pv-ui`, same for extension). `packages/pv-ui` itself has **no `node_modules` of its own** — by design (D-13: "source-only, no build step"). Every file physically living under `packages/pv-ui/` therefore has **no `node_modules` anywhere in its own ancestor directory chain** (`packages/pv-ui/node_modules`, `packages/node_modules`, and repo-root `node_modules` all do not exist — confirmed, this is not an npm/yarn workspaces monorepo, root `package.json` is a bare marker file with no `workspaces` field).

`[VERIFIED: live build]` A throwaway React component (`useState` + a `lucide-react` icon) was placed at `packages/pv-ui/components/_react_probe.tsx`, given a temporary `./components/*` exports-map entry + `peerDependencies` exactly matching CONTEXT.md's discretion note, and imported from real consumer code:

| Tool | Import of `react` (has an `exports` map) | Import of `lucide-react` (no `exports` map — only legacy `main`/`module`) |
|---|---|---|
| Vite (`vitest run`, web) | ✅ resolves | ❌ `Failed to resolve import "lucide-react" ... Does the file exist?` |
| Turbopack (`next build`, web, static export) | ✅ resolves | ❌ `Module not found: Can't resolve 'lucide-react'` (only surfaces once the importing page is actually reachable — Next silently skips routes under an `_`-prefixed folder name, which produced a false "Compiled successfully" on the first attempt; re-tested with a non-underscore route name to get the real signal) |
| `tsc --noEmit` (web) | Resolves the *file* via `pv-ui`'s exports map fine, but then fails on the **nested** `import ... from "react"` inside it: `TS7016: Could not find a declaration file for module 'react'` | (never reached — fails on `react` first) |

Root cause, confirmed by inspecting `node_modules/react/package.json` vs `node_modules/lucide-react/package.json`: `react` ships a modern `"exports"` map (self-contained conditional-exports resolution, anchored at the package's own directory once *found*); `lucide-react` ships only legacy `main`/`module` fields, which both Vite's and Turbopack's default resolvers walk for via an ancestor-`node_modules` filesystem search **starting from the importing file's own directory** — and that search comes up empty for any file physically outside `web/`'s or `extension/`'s own tree.

This is **not** a hypothetical monorepo-symlink gotcha — it was reproduced end-to-end against this repo's real build commands, and it is exactly the failure mode the real `ItemIconTile.tsx` will hit the moment it's promoted (it imports both `react`'s `useState`/`useEffect` and five `lucide-react` icons).

### Two verified fixes — a decision is needed

**Option A — give `pv-ui` its own local `node_modules` (recommended).** `[VERIFIED: live build]` Symlinking `packages/pv-ui/node_modules/{react,react-dom,lucide-react}` and `packages/pv-ui/node_modules/@types/react` to the matching packages already installed in `web/node_modules/` made **all three** tools pass cleanly — `vitest run` (no `preserveSymlinks` needed), `next build` static export (no `resolveAlias` needed, real HTML output confirmed containing the rendered probe markup), and `tsc --noEmit` (0 errors, full clean run across the whole `web/` program). Zero changes to any consumer's `vite.config.ts`, `next.config.ts`, or `tsconfig.json`.
  - In the real repo this must be a genuine `npm install` (or `npm ci` against a committed `packages/pv-ui/package-lock.json`) — not hand-made symlinks — installed as a **new bootstrap step**, mirroring the existing `predev`/`prebuild: bash ../scripts/build-wasm.sh` pattern already used by both `web/package.json` and `extension/package.json`.
  - Docker implication: `Dockerfile`'s web-builder stage already does `COPY packages/pv-ui/ /app/packages/pv-ui/` before `npm ci` for `web/` — this stage needs one added line (`RUN cd /app/packages/pv-ui && npm ci` or equivalent) before the `web/` install.
  - Tension to flag explicitly: this adds an **install step** to `pv-ui` where none existed before. It does **not** add a build/transpile step (pv-ui still ships raw, untranspiled `.tsx`/`.ts` source — the D-13 "source-only" property is preserved), and the root `.gitignore`'s bare `node_modules/` pattern already covers `packages/pv-ui/node_modules/` at any depth so nothing extra needs committing except a new `package-lock.json`. But this is close enough to the CONTEXT.md phrase "pv-ui stays source-only — no build step" that the planner should surface it as an explicit, named decision rather than silently building it in.

**Option B — consumer-side config patches only (no new install step, but incomplete).** `[VERIFIED: live build]` `resolve.preserveSymlinks: true` in `web/vitest.config.ts`'s `resolve` block fixed Vite; `turbopack.resolveAlias: { "lucide-react": "lucide-react" }` in `next.config.ts` fixed Turbopack. **This does NOT fix `tsc`** — a `tsconfig.json` `paths` override was also tested (`"react": ["./node_modules/react"]`) and **actively broke the rest of the app's type-checking**: it silently redirects the *entire* app's `"react"` resolution away from `@types/react`'s real declarations to the untyped raw JS entry, producing dozens of new `implicitly has an 'any' type` errors across unrelated files (`ItemForm.tsx`, `ItemRow.tsx`, `TotpCountdownRing.tsx`, etc. — confirmed, then reverted). **Do not attempt this narrow-looking fix** — it looks targeted but is global in effect. If Option B is chosen, `tsc`'s peer-dep gap for `pv-ui/components/*.tsx` needs a different, more careful resolution (e.g., a project-reference-scoped `tsconfig.json` inside `pv-ui` itself, or accepting that `tsc --noEmit` type-checks `pv-ui`'s own `.tsx` files only once, from a dedicated `pv-ui`-local tsc run, never re-checked strictly from each consumer's program) — not designed or verified in this research session; treat as an open sub-problem if Option B is chosen instead of A.

Every consumer-visible behavior (CSS classes, prop shape, runtime output) is identical either way — this choice is pure internal plumbing and does not affect UAT.

### Critical Unknown #3 answered — `FAVICON_URL_PREFIX` / `server-config.test.ts` guard

`[VERIFIED: source read]` `server-config.test.ts`'s `walk()` guard scopes its file-tree walk to `extensionRoot = join(__dirname, "..", "..")` (i.e. `extension/` itself) and additionally has `node_modules` in its `skipDirs` set. `packages/pv-ui` lives at the repo root, **outside** `extension/`'s own tree — the guard's walk never reaches `packages/pv-ui/components/ItemIconTile.tsx` at all, regardless of the `extension/node_modules/pv-ui` symlink (which would be skipped anyway). **The `FAVICON_URL_PREFIX` indirection is not technically required once the component lives in `pv-ui`** — UI-SPEC's recommendation to keep it anyway (harmless, zero behavior change, avoids touching an unrelated guard regex) remains the right call, just now confirmed as a stylistic choice rather than a technical necessity.

## Standard Stack

No new external packages are introduced by this phase — `react`, `react-dom`, `lucide-react` are already pinned identically (`19.2.7` / `19.2.7` / `1.24.0`) in both `web/package.json` and `extension/package.json` `[VERIFIED: package.json read]`, and `pv-ui`'s `peerDependencies` entry should mirror those exact pinned versions (not a loose range) to keep the single-instance guarantee explicit. No `## Package Legitimacy Audit` is required — no new packages, only new `peerDependencies` entries for packages already vetted and running in production in both consumers.

## Architecture Patterns

### System Architecture Diagram

```
                    packages/pv-ui/  (source-only, no build step)
                    ├── tokens.css  ── raw CSS custom properties
                    ├── vault/{types,search,cardBrand}.ts  ── pure logic (Phase 16, canonical)
                    └── components/ItemIconTile.tsx  ── NEW this phase (DS-03)
                              │  needs: react, react-dom, lucide-react resolvable
                              │  from files physically OUTSIDE any consumer's node_modules tree
                              │
              ┌───────────────┼────────────────────────────┐
              │                                             │
    web/ (Next.js 16 / Turbopack)                extension/ (WXT / Vite)
    ItemRow.tsx, DetailPanel.tsx                 popup/ItemListView.tsx
    import ItemIconTile from                     import ItemIconTile from
      "./ItemIconTile" (shim →                     "./ItemIconTile" (shim →
      re-exports pv-ui/components/*)                re-exports pv-ui/components/*)
              │                                             │
              └──────────────┬──────────────────────────────┘
                              │  BOTH render identical Tailwind classes:
                              │  TILE_BG = "bg-base-200 [[data-theme=vault-dark]_&]:bg-zinc-100"
                              ▼
                    Tailwind content scanner
                    (each consumer's OWN CSS entry file needs
                     @source "../../../packages/pv-ui/components/**/*.tsx"
                     — NOT auto-detected across the sibling-directory
                     boundary by default, verified both ways)

    ── separate, token-aligned-not-component-shared path ──

    extension/lib/autofill/inpage-overlay.ts (closed shadow DOM, no React)
    buildIconTile() → .pv-row-icon-tile { background: var(--pv-tile-bg) }  ← DS-04/UX-01 fix
                       .pv-row-icon    { color: var(--pv-tile-fg) }        ← NEW declaration
              │
              ▼
    inpage-theme.ts: tokensCss.replace(/(^|\})(\s*):root\s*,/gm, "$1$2[data-theme],")
              │  (already handles ANY token added inside the existing
              │   :root,[data-theme="vault-dark"] / [data-theme="vault-light"]
              │   blocks in tokens.css — zero changes needed to this file)
              ▼
    packages/pv-ui/tokens.css  ── SAME file, gains --pv-tile-bg/--pv-tile-fg
```

### Recommended Project Structure
```
packages/pv-ui/
├── components/
│   ├── ItemIconTile.tsx     # promoted from web's superset (variant: "row" | "header")
│   └── _probe.tsx           # pre-existing scratch file — DELETE, or repurpose as a
│                             # committed Tailwind-@source regression fixture (decide, don't leave dangling)
├── tokens.css                # +2 custom properties inside existing [data-theme] blocks
└── package.json               # +peerDependencies, +"./components/*" exports subpath
web/src/components/vault/ItemIconTile.tsx    # becomes: export { default } from "pv-ui/components/ItemIconTile";
extension/entrypoints/popup/ItemIconTile.tsx # becomes: thin shim rendering <ItemIconTile variant="row" />
extension/lib/autofill/inpage-overlay.ts     # CSS-only edit: 2 declarations, no structural change
```

### Pattern 1: Promoting a component while keeping both import sites zero-churn
**What:** Web's `ItemIconTile.tsx` (179 LOC) becomes `pv-ui/components/ItemIconTile.tsx` verbatim (`"use client"` directive preserved — confirmed required; a probe component omitting it hit Next's Server-Component boundary error immediately). Both original file paths become one-line re-export shims.
**When to use:** Any component with an already-proven superset/subset relationship between two near-identical implementations (this is the exact Phase-16 `export *` shim template, applied to a `.tsx` default export instead of named exports).
**Example:**
```typescript
// web/src/components/vault/ItemIconTile.tsx (after promotion)
export { default } from "pv-ui/components/ItemIconTile";

// extension/entrypoints/popup/ItemIconTile.tsx (after promotion)
import ItemIconTile from "pv-ui/components/ItemIconTile";
export default function PopupItemIconTile({ item }: { item: VaultItem }) {
  return <ItemIconTile item={item} variant="row" />;
}
```

### Pattern 2: A token that must reach both a Tailwind arbitrary-variant class AND a raw CSS custom property
**What:** `TILE_BG`/`TILE_FG` in the React component stay Tailwind arbitrary-variant strings (`bg-base-200 [[data-theme=vault-dark]_&]:bg-zinc-100`) — UI-SPEC is explicit this is correct and should NOT be converted to `var(--pv-tile-bg)` inside the `.tsx`. The **same resolved values** are expressed as plain `--pv-tile-bg`/`--pv-tile-fg` custom properties in `tokens.css` for the shadow-DOM consumer, which has no Tailwind at all.
**When to use:** Any design value that must be consumed identically by a Tailwind-driven React tree and a hand-written shadow-DOM stylesheet — don't force one consumption mechanism onto the other; keep two synchronized *expressions* of one *value*, both sourced from `pv-ui`.
**Example:**
```css
/* packages/pv-ui/tokens.css — inside the EXISTING blocks, not new ones */
:root,
[data-theme="vault-dark"] {
  /* ...existing tokens unchanged... */
  --pv-tile-bg: oklch(96.7% 0.001 286.375);  /* Tailwind v4 zinc-100 */
  --pv-tile-fg: oklch(44.2% 0.017 285.786);  /* Tailwind v4 zinc-600 */
}
[data-theme="vault-light"] {
  /* ...existing tokens unchanged... */
  --pv-tile-bg: var(--color-base-200);
  --pv-tile-fg: color-mix(in oklch, var(--color-base-content) 70%, transparent);
}
```
```css
/* extension/lib/autofill/inpage-overlay.ts, the actual DS-04/UX-01 fix — verified against live source */
.pv-row-icon-tile {
  /* ...unchanged... */
  background: var(--pv-tile-bg);   /* was: var(--color-base-200) — the bug, confirmed at line 270 */
}
.pv-row-icon {
  width: 16px; height: 16px; flex-shrink: 0;
  color: var(--pv-tile-fg);        /* NEW declaration — none exists today; the SVGs already use
                                       stroke="currentColor" (confirmed in ROW_ICON), so this alone
                                       fixes the fallback-glyph flip, no markup change needed */
}
```

### Pattern 3: Tailwind v4 content scanning across a sibling-directory package boundary
**What:** Neither Turbopack's `transpilePackages`/`turbopack.root` (already set for JS bundling) nor WXT's default Vite pipeline automatically extends Tailwind's own **CSS class-name scanning** into `packages/pv-ui/components/**/*.tsx` — these are two independent concerns (JS module resolution vs. CSS content detection) and fixing one does not fix the other.
**When to use:** Any time a Tailwind-driven consumer needs classes generated for a `.tsx` file living outside its own directory tree.
**Example:**
```css
/* Needed in BOTH web/src/app/globals.css (currently MISSING) and
   extension/entrypoints/popup/style.css (already present, uncommitted —
   see Environment State Found). Path depth verified identical for both
   files (3 levels up to repo root in each case). */
@import "pv-ui/tokens.css";
@source "../../../packages/pv-ui/components/**/*.tsx";
@plugin "daisyui";
```
`[VERIFIED: live build]` Without this line, a build of either project silently omits every Tailwind class used only inside `pv-ui/components/*.tsx` — no error, no warning, just unstyled output (confirmed: `grep`ing the compiled CSS for a known arbitrary-value class from the probe component found nothing without `@source`, found it immediately with it, in both `wxt build -b chrome` and `next build --output export`).

### Anti-Patterns to Avoid
- **Assuming Turbopack's `transpilePackages`/`turbopack.root` fixes Tailwind content scanning too:** it does not — they solve JS module resolution, not CSS class detection. Verified as two independently-failing, independently-fixed problems.
- **A blunt `tsconfig.json` `paths` override for bare `"react"`/`"lucide-react"` specifiers:** verified to silently redirect ALL of that app's react imports away from `@types/react`, producing dozens of unrelated `implicitly has an 'any' type` errors. If a tsconfig fix is chosen at all, it must be narrowly scoped (e.g., only inside a `pv-ui`-local project, never a blanket `paths` entry in the consumer's own root tsconfig).
- **Converting `TILE_BG`/`TILE_FG` to `var(--pv-tile-bg)` inside the React component:** UI-SPEC is explicit this is wrong — the Tailwind arbitrary-variant form is correct and unchanged; only the shadow-DOM CSS needs the new custom properties.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Peer-dependency single-instance guarantee across a symlinked source-only package | A custom module-alias shim layer per consumer | `pv-ui`'s own local `node_modules` (Option A) OR the two documented bundler config knobs (Option B) — both already standard, documented mechanisms (`resolve.preserveSymlinks`, `turbopack.resolveAlias`) | Both are first-party, documented bundler features for exactly this monorepo-symlink class of problem — a hand-rolled resolver plugin would duplicate what these already do correctly |
| Shadow-DOM CSS custom-property propagation | A new `:host`/carrier-stamping mechanism for the two new tokens | The existing `inpage-theme.ts` `:root`→`[data-theme]` regex rewrite, unmodified | It already generically rewrites the ENTIRE `tokens.css` file's selector shape at import time — any token added inside the existing `:root, [data-theme="vault-dark"]` / `[data-theme="vault-light"]` blocks is automatically covered, confirmed by re-reading the adapter's actual regex logic |

**Key insight:** every piece of new machinery this phase might look like it needs (a new token-carrier mechanism, a new resolver shim, a new build step for `pv-ui`) is either already unnecessary (the shadow-DOM adapter is generic) or already a documented, first-party bundler feature (Vite's `preserveSymlinks`, Turbopack's `resolveAlias`, or a plain `npm install`) — resist inventing anything bespoke here.

## Common Pitfalls

### Pitfall 1: Trusting the "Compiled successfully" Turbopack message without confirming the route was actually reachable
**What goes wrong:** Next.js App Router silently excludes any route segment folder prefixed with `_` from routing. A probe page placed at `app/__probe_page/page.tsx` produced a clean "Compiled successfully" build with **zero errors** — but the page (and therefore its `pv-ui/components` import) was never actually bundled at all. The real `lucide-react` resolution failure only surfaced once the probe was moved to a non-underscore route name.
**Why it happens:** Next's build pipeline doesn't warn when it excludes a route by naming convention; a "successful" build with fewer errors than expected can mean "your test never ran," not "your fix worked."
**How to avoid:** Any manual verification of a new `pv-ui` React import must use a real, reachable route (or an existing test/page), and should confirm the actual output (rendered HTML/DOM), not just a zero-exit-code build.
**Warning signs:** A build "succeeding" when a known-risky new import was expected to at least warn.

### Pitfall 2: `.pv-row-icon-tile` vs `.pv-row-icon` — two different fixes, don't conflate them
**What goes wrong:** `.pv-row-icon-tile` (the tile background, line 261-271 of `inpage-overlay.ts`) needs its EXISTING `background: var(--color-base-200)` declaration changed. `.pv-row-icon` (the fallback glyph, line 273) currently has NO color declaration at all and needs a NEW one added — it's not a swap, it's an addition.
**Why it happens:** Easy to assume both need the same "find and replace an existing value" treatment when auditing quickly.
**How to avoid:** Confirmed via direct source read — `.pv-row-icon { width: 16px; height: 16px; flex-shrink: 0; }` has zero color-related properties today.
**Warning signs:** A diff that only touches one line in `inpage-overlay.ts`'s CSS block when UX-01 explicitly requires both background AND glyph-fill parity.

### Pitfall 3: Assuming the existing e2e suite is a regression net for the exact surfaces this phase touches
**What goes wrong:** CONTEXT.md/UI-SPEC's framing ("extension e2e lanes P10/P11 are the regression net for overlay changes") is only partially true. `[VERIFIED: source read]` The Playwright suite's own `P10-SC1` test (`extension/e2e/dual-browser.spec.ts`) drives autofill via the **popup's** `[data-testid="on-this-page-section"]` list — a completely different, already-React/Tailwind-correct surface — and never touches `renderFieldDropdown()`/`.pv-row-icon-tile` at all (confirmed: zero matches for `data-pv-row`, `renderFieldDropdown`, `renderFormPrompt`, or `pv-panel-prompt` anywhere in that spec file). `P11-SC2/SC3/SC4` similarly only touch `data-pv-toast` (`save-update-toast.ts`, confirmed to render no icon tile). The ONLY existing harness that actually exercises the in-page dropdown/prompt tile is a **separate, Firefox-only, Selenium-driven, screenshot-based manual probe** (`extension/e2e-firefox/run-autofill-capture.cjs`, wired to `npm run test:e2e:firefox:autofill`) — its own `P10-SC1`..`SC5`/`P11-SC1`..`SC4` scenarios DO click through `surfaceBRowPoint()` coordinates and save screenshots, but assert via orange-primary-color pixel clustering on CONFIRM buttons, not on the tile background color itself — so it exercises the surface but would not automatically fail on a wrong tile color; a human still needs to look at the saved screenshots.
**Why it happens:** Two different test suites (Playwright/Chromium `dual-browser.spec.ts` and Selenium/Firefox `run-autofill-capture.cjs`) happen to share `P10-SC*`/`P11-SC*` naming for genuinely different test bodies covering different surfaces — easy to conflate "the P10 suite passed" with "the in-page dropdown was exercised."
**How to avoid:** Treat the Firefox screenshot harness's saved `.ff-screenshots-*` output as the real automated-adjacent regression net for this phase, and plan for a genuine human/Playwright-authorized visual UAT pass (per CONTEXT.md's own "screenshot-based UAT expected" framing) as the PRIMARY verification for UX-01, not a supplementary nice-to-have.
**Warning signs:** A plan that lists "P10/P11 e2e green" as sufficient proof of UX-01 without a screenshot review step.

## Code Examples

### `pv-ui/package.json` — verified-working shape (Option A)
```json
{
  "name": "pv-ui",
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
Note: `devDependencies` here is what makes Option A's `npm install`-inside-`pv-ui` step actually materialize a local, resolvable `node_modules` — `peerDependencies` alone installs nothing.

### `Dockerfile` web-builder stage — one new line (Option A)
```dockerfile
# Source: Dockerfile lines 90-106, existing COPY packages/pv-ui/ step
COPY packages/pv-ui/ /app/packages/pv-ui/
RUN cd /app/packages/pv-ui && npm ci   # NEW — satisfies pv-ui's own peer deps locally
COPY web/package.json web/package-lock.json ./
RUN npm ci --ignore-scripts
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|---------------|--------|
| `pv-ui` ships pure `.ts` logic/types/i18n only (Phase 16) | `pv-ui` ships its first `.tsx` React component with runtime peer dependencies (this phase) | Phase 17 (this phase) | The "source-only, zero install step" invariant that held cleanly through Phase 16 needs re-examination — this research found it does not survive contact with a peer package lacking an `exports` map, unmodified |

**Deprecated/outdated:** none — this is new ground for the project, not a migration away from something.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Option A (`pv-ui` gets its own local `node_modules` via a new install step) is the recommended fix, over Option B (consumer-config-only patches) | Critical Finding | If the team strongly prefers zero new install steps for architectural-purity reasons, Option B is verified to work for runtime bundling but leaves `tsc`'s peer-dep gap unresolved — a genuinely open sub-problem this research did not fully solve. This is presented as a recommendation, not a locked decision — flag for confirmation at plan/discuss time. |
| A2 | `packages/pv-ui/components/_probe.tsx` and the uncommitted `@source` line in `extension/entrypoints/popup/style.css` are safe, intentional leftovers from a prior exploratory session (not a broken half-applied change that needs investigating as a bug) | Environment State Found | If this assumption is wrong (e.g., it's evidence of an interrupted, more consequential change), the planner should `git log`/ask before building on top of it. This research treated it purely as empirical test material and left it untouched either way. |

## Open Questions

1. **Should `pv-ui`'s peer-dependency resolution be fixed via Option A (local `node_modules` + install step) or Option B (consumer bundler config only)?**
   - What we know: Option A is fully verified to fix all three tools (Vite, Turbopack, tsc) uniformly with zero consumer config changes, at the cost of a new install step + one new Dockerfile line. Option B fixes only the two runtime bundlers and leaves `tsc` unresolved (with a documented dead-end already ruled out).
   - What's unclear: Whether "no build step" in CONTEXT.md's discretion note was meant to also forbid "no install step" — this wasn't anticipated when that note was written (Phase 16 never shipped a `.tsx` with peer deps).
   - Recommendation: Default to Option A unless the user has a strong reason to keep `pv-ui` install-free; surface this explicitly rather than silently picking.

2. **Should the pre-existing uncommitted `_probe.tsx` + `@source` line be formalized, deleted, or replaced?**
   - What we know: `_probe.tsx` is currently untracked, unused, and not wired to anything; the `@source` line in the popup's `style.css` is uncommitted and, per this research, correct and necessary — but `web/src/app/globals.css` is missing the equivalent line entirely.
   - What's unclear: Whether `_probe.tsx` should become a permanent Tailwind-detection regression fixture (a legitimate pattern — a trivial, arbitrary-value-bearing `.tsx` file whose presence in the compiled CSS proves the `@source` scanning still works) or simply be deleted once the real `ItemIconTile.tsx` exists and serves that role implicitly.
   - Recommendation: Add the matching `@source` line to `web/src/app/globals.css` in Wave 0; decide `_probe.tsx`'s fate as part of the same task (delete is the simpler default, since the real promoted component supersedes its purpose).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node/npm toolchain | all builds/tests this phase touches | ✓ | project-pinned (verified via live `npm run build`/`vitest run`) | — |
| `wasm-bindgen`/Rust toolchain | `predev`/`prebuild` WASM step (unrelated to this phase's scope, but runs on every build invocation) | ✓ | already cached/working, confirmed by every build run in this session | — |
| Docker | only relevant if Option A's Dockerfile line is implemented | not exercised this session (no container build run) | — | plan/execute-phase should confirm the new `RUN cd /app/packages/pv-ui && npm ci` line in an actual `docker build` before declaring Option A done |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7 (web + extension, both already configured), Playwright 1.61.1 (`extension/e2e/dual-browser.spec.ts`, Chromium), Selenium/geckodriver (`extension/e2e-firefox/*.cjs`, Firefox, screenshot-based) |
| Config file | `web/vitest.config.ts`, `extension/vitest.config.ts` (multi-project: `background`/`popup`), `extension/playwright.config.ts` |
| Quick run command | `cd web && npx vitest run src/components/vault/ItemRow.test.tsx` / `cd extension && npx vitest run entrypoints/popup/ItemIconTile.test.tsx` |
| Full suite command | `cd web && npm test`, `cd extension && npm test && npm run test:e2e:chrome` |

### Phase Requirement → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|--------------------|-------------|
| DS-03 | `ItemIconTile` renders identically after promotion (favicon-first, card-brand, type-glyph fallback, both variants) | unit | `npx vitest run src/components/vault/ItemRow.test.tsx` (web, embeds the favicon-rendering describe block) + `npx vitest run entrypoints/popup/ItemIconTile.test.tsx` (extension) | ✅ both exist today, exercise the pre-promotion implementations — must stay green post-promotion with zero test-file changes (proves the shim is truly zero-behavior-change) |
| DS-03 | Zero remaining second implementation | static/grep | `grep -rL "pv-ui/components/ItemIconTile" $(grep -rl "function ItemIconTile" web/src extension/entrypoints)` (or equivalent — mirrors Phase 16's own zero-duplication grep gate) | ❌ Wave 0 — write as an explicit verification step, not a persistent test file |
| DS-04 | `.pv-row-icon-tile` never regresses to a bare `--color-base-200` | static/grep | `grep -n "background:\s*var(--color-base-200)" extension/lib/autofill/inpage-overlay.ts \| grep -B2 pv-row-icon-tile` returns zero matches | ❌ Wave 0 gap — recommend a small vitest test asserting `tokens.css` contains `--pv-tile-bg`/`--pv-tile-fg` in both `[data-theme]` blocks, mirroring `server-config.test.ts`'s own standing-invariant-test pattern |
| UX-01 | In-page dropdown/prompt tiles visually match web/popup, both themes | visual/manual | Playwright screenshot UAT (per CONTEXT.md, standing authorization) + re-run of `npm run test:e2e:firefox:autofill` (existing Selenium harness, exercises Surface A/B, screenshots require human review — see Pitfall 3) | ✅ harness exists, but produces screenshots for human review, not an automated pass/fail on tile color |

### Sampling Rate
- **Per task commit:** targeted `vitest run` on the touched test file(s) above
- **Per wave merge:** `npm test` (both projects) + `npx tsc --noEmit` (both projects) + `npm run build`/`npm run build:chrome`/`npm run build:firefox`
- **Phase gate:** full suite green + Playwright/Firefox screenshot UAT reviewed by a human before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `web/src/app/globals.css` — add `@source "../../../packages/pv-ui/components/**/*.tsx";` (currently missing; verified required)
- [ ] Decide + commit `extension/entrypoints/popup/style.css`'s already-present uncommitted `@source` line (currently dangling)
- [ ] Decide `packages/pv-ui/components/_probe.tsx`'s fate (delete, or formalize as a regression fixture)
- [ ] A small `tokens.css`-content assertion test (new) — asserts `--pv-tile-bg`/`--pv-tile-fg` exist in both theme blocks, so a future accidental deletion is caught by `npm test` rather than only by visual UAT
- [ ] Whichever peer-dependency fix (Option A or B) is chosen needs its own smoke verification wired in — a throwaway `.tsx` importing both `react` and `lucide-react` from `pv-ui/components/*`, exercised by `vitest run` + `next build` + `wxt build -b chrome` + `tsc --noEmit`, then deleted once the real `ItemIconTile.tsx` promotion covers the same ground

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-------------------|
| V2 Authentication | no | Not touched by this phase |
| V3 Session Management | no | Not touched by this phase |
| V4 Access Control | no | Not touched by this phase |
| V5 Input Validation | no | No new user input paths introduced; the promoted component's inputs (`VaultItem`, `variant`) are unchanged in shape from the existing, already-shipped implementations |
| V6 Cryptography | no | Not touched — this phase never imports `pv-core`/WASM crypto modules |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|-----------------------|
| Third-party favicon-proxy data exfiltration (an attacker-controlled or ad-tech favicon relay learning which vault items exist / which domains a user has saved) | Information Disclosure | Already mitigated, and MUST be preserved byte-for-byte through the promotion: `[VERIFIED: source read]` both `web/src/components/vault/ItemIconTile.tsx` and the in-page `buildIconTile()` fetch `${hostname}/favicon.ico` DIRECT (never a `google.com/s2/favicons`-style third-party relay) with `referrerPolicy="no-referrer"` on every `<img>`/`img` element. This is documented as a zero-knowledge/privacy invariant in the source header comments and in this repo's own `CLAUDE.md` Constraints — the promotion must not introduce any indirection (e.g. a caching proxy, a `pv-server`-routed fetch) between the tile and the item's own domain. |
| Cross-realm ArrayBuffer/ArrayBuffer-adjacent confusion (Firefox Xray, per the resolved XBR-02 debug session) | Tampering | Not applicable — this phase touches no WebAuthn/binary-credential code paths at all |

