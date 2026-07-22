---
phase: 17-shared-component-visual-alignment
verified: 2026-07-21T09:55:44Z
status: passed
score: 8/8 must-haves verified
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "TILE_BG/TILE_FG never converted to var(--pv-tile-bg)/var(--pv-tile-fg) inside the promoted ItemIconTile component"
    reason: "Deliberately reversed by code-review finding WR-04 (commit 378d0fb). The plan 17-03 prohibition kept the component on hand-derived Tailwind classes (bg-base-200 + manual [data-theme=vault-dark] override); the review found this meant the tile color was NOT actually single-sourced. WR-04 changed TILE_BG/TILE_FG to bg-[var(--pv-tile-bg)]/text-[var(--pv-tile-fg)] so tokens.css is the genuine single source of truth for both the light/dark flip AND the values — strengthening ROADMAP success criteria 2 & 3 rather than weakening them. Documented in 17-REVIEW-FIX.md WR-04 with compiled-CSS + 16/16 browser-parity verification."
    accepted_by: "gsd-code-review (iteration 1, 17-REVIEW-FIX.md)"
    accepted_at: "2026-07-21T09:49:53Z"
---

# Phase 17: Shared Component Visual Alignment — Verification Report

**Phase Goal:** `ItemIconTile` becomes a single shared React component in `pv-ui` — proving the pv-ui React-sharing pipeline end-to-end on the smallest real component — and every autofill surface (popup, in-page, web) renders item logos identically on a light, token-aligned tile.
**Verified:** 2026-07-21T09:55:44Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `ItemIconTile` exists once in `pv-ui`, imported by both web and popup — no second implementation remains (SC1, DS-03) | ✓ VERIFIED | `packages/pv-ui/components/ItemIconTile.tsx` (224 LOC, `"use client"`, default fn). Repo-wide grep for `function ItemIconTile` outside pv-ui returns empty. Web copy = 1-line `export { default } from "pv-ui/components/ItemIconTile"`. Extension copy = thin `variant="row"` wrapper (`PopupItemIconTile`). All 3 importers (ItemRow, DetailPanel, ItemListView) keep unchanged `./ItemIconTile` path. |
| 2 | Both consumers' shims are behavior-neutral — pre-existing tests pass with ZERO edits (DS-03) | ✓ VERIFIED | Ran live: `extension ItemIconTile.test.tsx` 9/9 pass; `web ItemRow.test.tsx` 28/28 pass. Both test files' last git touch (d61e3a7 / 3684089) predates phase execution commits — unedited. Behavior-dependent (favicon-first / card-brand short-circuit / type-glyph fallback / variant sizes) confirmed by passing suites, not presence alone. |
| 3 | Favicon zero-knowledge invariant preserved byte-for-byte in promoted component (DS-03) | ✓ VERIFIED | `src={`${FAVICON_URL_PREFIX}${hostname}/favicon.ico`}` + `referrerPolicy="no-referrer"` present. Proxy-domain grep (google/gstatic/s2/duckduckgo/proxy) empty. No crypto/wasm import on any `^import` line. |
| 4 | pv-ui React-sharing infra works: exports `./components/*` wildcard, own node_modules, dedupe, no tsconfig path workaround (DS-03) | ✓ VERIFIED | `./components/*` in exports map; `packages/pv-ui/node_modules/{react,lucide-react}` present; `package-lock.json` git-tracked; peerDeps byte-identical (react 19.2.7 / react-dom 19.2.7 / lucide-react 1.24.0). `@source` directive in both consumer CSS entries. CR-01: `resolve.dedupe:['react','react-dom','lucide-react']` in wxt.config.ts. No pv-ui `paths` alias in either tsconfig (only standard `@/*`; Phase 16 dropped pv-ui paths). |
| 5 | In-page Surface A + B render item logos on a LIGHT tile matching web/popup — dark-tile inconsistency gone (SC2, UX-01) | ✓ VERIFIED | `.pv-row-icon-tile` background = `var(--pv-tile-bg)` (no bare `var(--color-base-200)` in that rule); `.pv-row-icon` gains `color: var(--pv-tile-fg)`. `results.json`: all 10 surface reads + 6 parity comparisons pass; byte-identical computed bg across web/popup/in-page in both themes (dark `rgba(244,244,245,1)`, light `rgba(252,251,250,1)`). 10 screenshots committed. Self-validated per standing Playwright-UAT authorization. |
| 6 | In-page overlays read tile color/spacing/radius from pv-ui tokens; no duplicated design constants beyond the documented 8-literal allowlist (SC3, DS-04) | ✓ VERIFIED | tokens.css declares `--pv-tile-bg`/`--pv-tile-fg` inside both existing `[data-theme]` blocks. Executable overlay-wide audit over all 5 overlay files passes: zero non-var() color literals outside the 4-rgba() elevation/scrim allowlist, exactly 4 `border-radius:999px` pill occurrences. `inpage-theme.test.ts` regression assertions guard token placement. |
| 7 | Missing/failed favicon falls back to neutral type-glyph on the same light tile; existing fallback preserved (UX-01 empty-state, backstop) | ✓ VERIFIED | Component: `FAILED_FAVICON_HOSTS` set + `onError` handler + `TYPE_ICON` glyph map + `useState(faviconFailed)` intact. `.pv-row-icon` fallback glyph inherits `color: var(--pv-tile-fg)` on the same `--pv-tile-bg` tile. Fallback exercised by passing ItemIconTile.test.tsx (9/9). |
| 8 | Aggregate build/test/typecheck gate green across both consumers; visual-parity harness runs to completion (DS-03/DS-04/UX-01) | ✓ VERIFIED | Gate baseline (17-REVIEW-FIX.md WR-04, commits 8a4163e/2700e77/378d0fb): web 481/481 + tsc clean; ext 687/687 + tsc clean + wxt build green (chrome+firefox); visual harness 16/16 computed-color parity. `extension/e2e-visual/capture-tile-parity.mjs` (39KB) exists; `test:e2e:visual`/`pretest:e2e:visual` scripts wired. Spot-checked live: ext 9/9, web 28/28. |

**Score:** 8/8 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/pv-ui/components/ItemIconTile.tsx` | canonical promoted component | ✓ VERIFIED | 224 LOC, imports only react/lucide-react/pv-ui subpaths, crypto-free, zero-knowledge favicon |
| `web/src/components/vault/ItemIconTile.tsx` | 1-line re-export shim | ✓ VERIFIED | header comment + `export { default } from "pv-ui/components/ItemIconTile"` |
| `extension/entrypoints/popup/ItemIconTile.tsx` | variant="row" wrapper shim | ✓ VERIFIED | `PopupItemIconTile` renders `<PvItemIconTile variant="row">`, distinct local name preserves zero-dup grep |
| `packages/pv-ui/tokens.css` | +--pv-tile-bg/--pv-tile-fg in both theme blocks | ✓ VERIFIED | dark: oklch zinc-100/zinc-600; light: base-200 / color-mix base-content 70% |
| `packages/pv-ui/package.json` + package-lock | peerDeps + ./components/* + committed lock | ✓ VERIFIED | 12 exports entries, wildcard present, lock tracked, node_modules materialized |
| `extension/lib/autofill/inpage-overlay.ts` | tile bg swap + icon color add | ✓ VERIFIED | lines 270/273 reference new tokens; no react/crypto import |
| `extension/e2e-visual/capture-tile-parity.mjs` | Playwright/CDP parity harness | ✓ VERIFIED | exists; WR-01/02/03 lifecycle hardening applied |
| `packages/pv-ui/README.md` | WR-05 consumer contract | ✓ VERIFIED | documents mandatory React dedupe + exports-map-sole-authority |
| `uat-screenshots/*.png` + results.json | 8+ screenshots, parity JSON | ✓ VERIFIED | 10 PNGs (4 surfaces × 2 themes + variants), results.json 16/16 pass |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| pv-ui peerDeps/node_modules | consumers' react/lucide resolution | exports map + wxt dedupe | ✓ WIRED — builds green both tools, negative-control proved dedupe necessary (CR-01) |
| tokens.css `--pv-tile-bg/--pv-tile-fg` | in-page overlay + React component | var() in overlay CSS + `bg-[var(--pv-tile-bg)]` Tailwind class | ✓ WIRED — same resolved RGB reaches both mechanisms (results.json parity) |
| consumer CSS `@source` directive | Tailwind scan of pv-ui components | globals.css / style.css line | ✓ WIRED — compiled CSS contains generated utility classes (WR-04 verification) |

### Overlay-Wide Audit (DS-04 SC3)

Ran the executable audit over all 5 overlay files: **PASS** — zero non-var() color literals outside the closed 4-rgba() allowlist; exactly 4 `border-radius:999px` pill occurrences. All 8 documented approved exceptions present, none silently removed.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Popup shim behavior-neutral | `npx vitest run entrypoints/popup/ItemIconTile.test.tsx` | 9/9 passed | ✓ PASS |
| Web shim behavior-neutral | `npx vitest run src/components/vault/ItemRow.test.tsx` | 28/28 passed | ✓ PASS |
| Overlay literal audit | node audit script (Plan 17-04 Task 1) | pillRadiusCount=4, 0 unexpected | ✓ PASS |
| Cross-surface computed-color parity | committed results.json | 16/16 pass, byte-identical RGB | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| DS-03 | 17-01, 17-03, 17-04 | ItemIconTile shared React component in pv-ui, single source | ✓ SATISFIED | Truths 1-4; zero-dup grep; both suites pass unedited |
| DS-04 | 17-02, 17-04 | In-page overlays consume pv-ui tokens, no duplicated design values | ✓ SATISFIED | Truth 6; overlay audit pass; tokens single-sourced |
| UX-01 | 17-02, 17-04 | In-page Surface A+B render logos on light tile matching web/popup | ✓ SATISFIED | Truths 5, 7; results.json 16/16 parity; screenshots |

All 3 phase requirement IDs accounted for. No orphaned requirements (REQUIREMENTS.md maps exactly DS-03, DS-04, UX-01 to Phase 17).

### Anti-Patterns Found

None. No debt markers (TBD/FIXME/XXX) introduced. No stub/placeholder returns. Favicon fallback, card-brand short-circuit, and type-glyph paths all fully implemented and test-covered.

### Notable Deviation (documented, accepted)

Plan 17-03 carried a prohibition that `TILE_BG`/`TILE_FG` must NOT be converted to `var(--pv-tile-*)`. Code-review finding **WR-04** (commit 378d0fb) deliberately reversed this: the component now reads `bg-[var(--pv-tile-bg)]`/`text-[var(--pv-tile-fg)]`, making tokens.css the genuine single source of truth for both the flip and the light/dark values. This **strengthens** ROADMAP success criteria 2 & 3 (all three surfaces read the identical token) rather than undermining them, and is verified by compiled-CSS grep + 16/16 browser parity. Recorded as an override, not a gap.

### Human Verification Required

None outstanding. The plan 17-04 end-of-phase visual-taste human-check is satisfied under the standing Playwright-UAT self-validation authorization: 10 committed screenshots (4 surfaces × 2 themes) plus results.json's 16/16 byte-identical computed-color parity provide the required evidence. No genuine gap found that would warrant re-demanding a fresh human render.

### Gaps Summary

No gaps. All 8 must-have truths verified against the actual codebase (not SUMMARY claims): the single shared `ItemIconTile` component exists in pv-ui with both consumers demoted to behavior-neutral shims (proven by live test runs), the pv-ui React-sharing pipeline resolves cleanly on both build tools with the CR-01 dedupe guard, and all three autofill surfaces render logos on the same light, token-aligned tile with numerically-identical computed background colors in both themes. All three requirement IDs (DS-03, DS-04, UX-01) satisfied.

---

_Verified: 2026-07-21T09:55:44Z_
_Verifier: Claude (gsd-verifier)_
