# Phase 17: Shared Component & Visual Alignment - Context

**Gathered:** 2026-07-21
**Status:** Ready for planning
**Mode:** Autonomous smart discuss (1 grey area, accepted by Bartek)

<domain>
## Phase Boundary

`ItemIconTile` becomes a single shared React component in `packages/pv-ui` — proving the pv-ui React-sharing pipeline end-to-end on the smallest real component — and every autofill surface (popup, in-page, web) renders item logos identically on a light, token-aligned tile.

- **In scope:** DS-03 (shared `ItemIconTile` React component), DS-04 (in-page overlays consume pv-ui design tokens as single style source), UX-01 (light tile on in-page Surface A dropdown + Surface B prompt; dark-tile inconsistency gone).
- **Out of scope:** broader component library (ItemRow/DetailPanel/dialogs — research "Phase D", post-v0.3), any React inside the in-page overlays (architecturally imperative closed-shadow by explicit decision), Firefox window behavior (Phase 18).

</domain>

<decisions>
## Implementation Decisions

### In-page tile appearance & token-drift policy (Bartek accepted 2026-07-21)
- **Tile background in vault-dark:** in-page tiles get the SAME flip as web/popup — light neutral (`zinc-100`-equivalent) in vault-dark so dark favicons (GitHub etc.) stay visible; `base-200` stays in vault-light. Mirrors Bartek's original live-review decision encoded in web's `TILE_BG = "bg-base-200 [[data-theme=vault-dark]_&]:bg-zinc-100"`.
- **Fallback type-glyph color on the light tile:** dark neutral glyph (matching web's flip behavior), so the glyph never vanishes on the light tile.
- **Scope:** EVERY in-page row tile gets the light-tile rule — dropdown (Surface A), prompt (Surface B), and any tile rendered by generate-popover/save-toast — one consistent rule, not just the two surfaces named in UX-01.
- **Token drift:** when a hand-written overlay style value differs from the pv-ui token, ADOPT the token value — small visual corrections are the point of DS-04; no pixel-freezing drifted values.

### Claude's Discretion (architecture — locked by commissioned research §Phase C)
- Promote web's `ItemIconTile.tsx` (the superset: `variant: "row" | "header"`) to `pv-ui/components/ItemIconTile.tsx`; popup passes `variant="row"`. Both import sites become shims/imports of the shared component.
- pv-ui `package.json` gains `peerDependencies: { react, react-dom, lucide-react }` and a `./components/*` exports subpath. pv-ui stays source-only — no build step. NOTE (Phase 16 decision): the exports map is the SOLE resolution authority — do NOT re-add tsconfig paths.
- Extension-only deltas: (a) `FAVICON_URL_PREFIX` indirection exists solely to dodge `server-config.test.ts`'s hard-coded-URL regex guard — either keep the prefix const in the shared component or relax the guard for pv-ui (adjust the guard, don't contort the component); (b) fold the defensive `Array.isArray(urls)` into the shared version (harmless in web).
- The shared component imports `pv-ui/vault/types`, `pv-ui/vault/search` (domainFromUrl), `pv-ui/vault/cardBrand` directly (post-Phase-16 canonical modules) — not via consumer shims.
- In-page overlays CANNOT consume the React component — they get the light-tile rule via tokens/CSS in their hand-written closed-shadow styles (the `[data-theme]` rewrite adapter from `inpage-theme.ts` applies; every new token consumed in-page needs the rewrite + a stamped carrier).
- How to express "light tile in vault-dark" as a token for the overlays (e.g. a dedicated `--pv-tile-bg` token in tokens.css with per-theme values, vs hand-authored `[data-theme="vault-dark"]` rule in overlay CSS): Claude's discretion — but the value must come from pv-ui, not be hand-copied (DS-04's whole point).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `web/src/components/vault/ItemIconTile.tsx` (179 LOC) — canonical superset: favicon-first tile (direct uncached fetch to item's own domain `/favicon.ico`, `referrerPolicy="no-referrer"`, NEVER a third-party favicon proxy — zero-knowledge rule in header comment), card-brand glyph, neutral type-icon fallback, `FAILED_FAVICON_HOSTS` set, `SIZE` map (row h-8/rounded-8, header h-6/rounded-6), `TILE_BG` with the vault-dark light-flip.
- `extension/entrypoints/popup/ItemIconTile.tsx` (182 LOC) — near-twin; deltas: `FAVICON_URL_PREFIX` const (test-guard dodge), defensive `Array.isArray(urls)`, relative imports, row-only.
- `extension/lib/autofill/inpage-overlay.ts` — `.pv-row-icon-tile` (32px/8px radius, `background: var(--color-base-200)` unconditionally — THE dark-tile bug), favicon-first `createIconTile()` at ~line 428. `inpage-theme.ts` holds the `?inline` tokens import + `:root`→`[data-theme]` rewrite + `resolveTheme()`/`watchMirroredTheme()`.
- Phase 16 outcome: `pv-ui/vault/{types,search,cardBrand,sort}.ts`, `pv-ui/clipboard.ts`, `pv-ui/i18n/*` all canonical; generator/tokens precedent for exports map entries.

### Established Patterns
- pv-ui consumption: `file:` dep + exports map (sole authority) + consumer transpile-as-own-source; web `transpilePackages: ["pv-ui"]` + `turbopack.root: ".."` already set.
- React/Tailwind/DaisyUI/lucide versions verified identical across web/extension (React 19.2.7, Tailwind 4.3.2, DaisyUI 5.6.18, lucide 1.24.0, jsx react-jsx) — peer-dep lockstep risk documented in research §4 risk 3.
- Executor worktree bootstrap (Phase 16 pattern): node_modules rsync/npm ci + `scripts/build-wasm.sh` + `npx wxt prepare`.

### Integration Points
- Importers to re-point: 4 web / 3 extension ItemIconTile import sites (research §1 blast radius).
- `server-config.test.ts` literal guard — will fire on the favicon URL in a new pv-ui path unless the guard is adjusted or the prefix-const pattern is kept.
- Tailwind class generation: the shared component's classes (`bg-base-200`, `[[data-theme=vault-dark]_&]:bg-zinc-100`, size frames) must be picked up by BOTH consumers' Tailwind content scanning — verify each consumer's Tailwind v4 source globs cover `packages/pv-ui/components/` (web via `@source`/content detection, extension via WXT/Vite pipeline), or the tile renders unstyled. This is the #1 silent-failure risk of the React-sharing step.
- In-page: `inpage-overlay.ts` CSS + `inpage-mount.ts`/`generate-popover.ts`/`save-update-toast.ts`/`mismatch-modal.ts` hand-written styles — DS-04 sweep target; tokens flow via the `?inline` + rewrite adapter.

</code_context>

<specifics>
## Specific Ideas

- UX-01's acceptance is visual: in-page dropdown/prompt tiles must visually match web/popup in both themes — screenshot-based UAT expected (Playwright, per standing authorization).
- Success criterion 3: "no duplicated or hand-copied design constants remaining in the overlay source" — plans must include a grep/audit step for hard-coded color/spacing/radius literals in the overlay files, analogous to Phase 16's zero-duplication gate.
- Both test suites + both builds must stay green; extension e2e lanes (P10/P11 in-page scenarios) are the regression net for overlay changes.

</specifics>

<deferred>
## Deferred Ideas

- Broader shared component library (ItemRow, DetailPanel, dialogs) — research "Phase D", post-v0.3.
- In-page consent panel alternative — Phase 18 (XBR-03 decision gate).

</deferred>
