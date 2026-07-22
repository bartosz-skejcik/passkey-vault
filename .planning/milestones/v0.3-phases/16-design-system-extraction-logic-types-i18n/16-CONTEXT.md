# Phase 16: Design System Extraction — Logic, Types & i18n - Context

**Gathered:** 2026-07-20
**Status:** Ready for planning
**Mode:** Autonomous (infrastructure phase — no user-facing grey areas; decisions sourced from commissioned research)

<domain>
## Phase Boundary

Pure vault logic/types and the i18n engine live once in `packages/pv-ui`, consumed by both the web app and the extension via `export *` shims — closing the largest block of byte-identical duplicated code without a big-bang rewrite.

This phase covers research "Phase A" (pure logic + types) and "Phase B" (i18n engine + shared keys) from `.planning/research/v0.3/DESIGN-SYSTEM-UNIFICATION.md`:

- **In scope:** `cardBrand.ts`, `search.ts`, sort comparator (`SortOption` + `sortItems`), `clipboard.ts`, `types.ts` reconciliation (web superset canonical), i18n engine (`t`/`interpolate`/`Locale`/`resolveLocale`) + shared dictionary keys split.
- **Out of scope:** React component sharing (`ItemIconTile` → Phase 17), in-page overlay token alignment (Phase 17), any visual change. Requirements: DS-01, DS-02 only.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — pure infrastructure phase (code extraction/refactor, no user-facing behavior). The commissioned research (`.planning/research/v0.3/DESIGN-SYSTEM-UNIFICATION.md`, measured 2026-07-20 @ a3a1b85) locks the architecture:

- **Keep `file:` deps + `export *` shim template** (D-13). Do NOT migrate to npm workspaces — Docker cache-split reasoning still holds. Import paths in consumers never change.
- **Sort:** comparator (`SortOption`, `sortItems`) moves to pv-ui; `read/writeSortPreference` persistence stays in each consumer (web `localStorage` sync vs ext `browser.storage.local` async, different storage keys — platform-specific by design).
- **Types:** web `types.ts` is the canonical superset (newer optional card `pin`/`zip`, structured identity address); extension adopts it additively — verify autofill's legacy flat `address` read against `fill-dom.ts`.
- **i18n:** engine (`t`/`interpolate`/`Locale`/`resolveLocale`) extracted to `pv-ui/i18n/engine.ts`; shared keys to a common dictionary; surface-specific keys stay per-consumer and merge over the common set; in-page `autofill-dictionary.ts` keeps its own dict but imports the shared engine. `resolveLocale()` exists only ext-side today — becomes shared.
- **pv-ui stays source-only, no build step** — consumers transpile it as own source (web `transpilePackages`, ext WXT/Vite).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/pv-ui` already exists (phase 11, D-13) with the working template: `tokens.css` + `generator/*` shared via `export *` shims, `file:../packages/pv-ui` dep in both consumers, `web/next.config.ts` `transpilePackages` + `turbopack.root=".."`, Dockerfile `COPY packages/pv-ui/` before `npm ci`.
- The generator extraction (research inventory #1) is the proven end-to-end mechanism — replicate it exactly for each module.

### Established Patterns
- Shim pattern: consumer file becomes `export * from "pv-ui/<subpath>"` — zero import churn across the 37 web / 38 extension referencing files.
- `web/tsconfig.json` has `pv-ui/generator/*` path alias precedent — extend the same way for new subpaths (`vault/*`, `i18n/*`, `clipboard`).
- pv-ui `package.json` exports map must gain entries for each new subpath.

### Integration Points
- Duplicated twins (research inventory, measured): `web/src/lib/vault/{cardBrand,search,sort,types}.ts` ↔ `extension/lib/vault/*`; `web/src/lib/clipboard.ts` ↔ `extension/lib/clipboard.ts`; `web/src/lib/i18n/dictionary.ts` (746 LOC) ↔ `extension/lib/i18n/dictionary.ts` (370 LOC) + `autofill-dictionary.ts` (161 LOC).
- **Drift warning:** Phase 15 (AUTH refactor) landed AFTER the research snapshot and touched extension dictionaries (AUTH-04 keys added, ext-scoped-PRF keys purged, 15-06 structural guard test added). Re-measure the i18n twins before extraction; do not trust research LOC figures for dictionary.ts.
- Extension has whole-repo literal test guards (e.g. hard-coded-server-URL regex in `server-config.test.ts`, 15-06's ext-scoped-PRF string guard) that may fire on moved code — adjust the guard, don't contort the extracted module.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 3 is explicit: "No parallel duplicate implementation of any migrated module remains — **verified by search, not assumed**" — plans must include a grep-based verification step.
- Both test suites must pass **unchanged** (criterion 1) — the extraction is behavior-neutral; test edits are allowed only for the literal-guard adjustments noted above.
- Migration order per research: cardBrand + search + clipboard (comment-only diffs, mechanical) → sort comparator split → types reconciliation → i18n engine + key split. Each step independently shippable.

</specifics>

<deferred>
## Deferred Ideas

- React component sharing (`ItemIconTile`) and in-page overlay token alignment — already scheduled as Phase 17 (DS-03, DS-04, UX-01).
- Broader component library (ItemRow/DetailPanel/dialogs) — research "Phase D", post-v0.3 candidate.

</deferred>
