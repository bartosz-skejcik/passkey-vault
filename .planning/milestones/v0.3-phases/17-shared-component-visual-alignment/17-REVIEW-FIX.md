---
phase: 17-shared-component-visual-alignment
fixed_at: 2026-07-21T09:49:53Z
review_path: .planning/phases/17-shared-component-visual-alignment/17-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 17: Code Review Fix Report

**Fixed at:** 2026-07-21T09:49:53Z
**Source review:** .planning/phases/17-shared-component-visual-alignment/17-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (CR-01 + WR-01..WR-04, per explicit fix_scope instruction; WR-05 was intentionally excluded)
- Fixed: 5
- Skipped: 0

All fixes were applied and committed in an isolated git worktree (`gsd-reviewfix/17-<pid>`), then fast-forwarded onto `main`.

## Fixed Issues

### CR-01: Duplicate React in the packaged extension build — dedupe applied to vitest only, not to `wxt build`

**Files modified:** `extension/wxt.config.ts`
**Commit:** `8a4163e` — "fix(17): CR-01 dedupe React/lucide-react in extension production build"
**Applied fix:** Added a `vite: () => ({ resolve: { dedupe: ["react", "react-dom", "lucide-react"] } })` block to `wxt.config.ts`, mirroring the dedupe already present in `extension/vitest.config.ts`, exactly as the review's fix suggestion specified.

**Verification performed (beyond the standard 3-tier check):**
- `tsc --noEmit` on the extension: 0 errors (matches the unmodified main-repo baseline after symlinking in gitignored build artifacts — `.wxt/`, wasm glue — that a fresh worktree lacks).
- Ran `wxt build -b chrome --analyze` (real production build) and inspected the rollup-plugin-visualizer `stats.html` module graph for every `react`/`react-dom`/`lucide-react` module id bundled.
- **Negative control:** reverted the fix, rebuilt, and confirmed the hazard is real — `packages/pv-ui/node_modules/lucide-react/...` was bundled as a SEPARATE module instance alongside `extension/node_modules/lucide-react/...` (react/react-dom themselves happened to converge anyway in this exact Vite/rollup version via CommonJS-interop realpath normalization, but lucide-react — pure ESM — did not, proving the duplication mechanism the review described is real and un-guarded without the fix).
- **Positive verification:** restored the fix, rebuilt, and confirmed only `extension/node_modules/{react,react-dom,lucide-react}` module ids appear in the bundle — zero references to `packages/pv-ui/node_modules/*` for any of the three packages.
- `npx vitest run` (extension): 687/687 passing.

### WR-01: `cargo run` child is orphaned on SIGTERM — parity harness leaks a server and deletes its live DB

**Files modified:** `extension/e2e-visual/capture-tile-parity.mjs`
**Commit:** `2700e77` — "fix(17): WR-01/WR-02/WR-03 harden tile-parity e2e harness lifecycle"
**Applied fix:** Spawned the own `cargo run -p pv-server` child with `detached: true` (making it the leader of its own POSIX process group), and changed `cleanup()` to signal the whole group via `process.kill(-pid, "SIGTERM")`, wait (bounded, 5s) for the child's own `exit` event before proceeding, then escalate to `process.kill(-pid, "SIGKILL")` for anything still alive. This closes the race where the SQLite DB was deleted while the orphaned server still held it open.

### WR-02: Reuse-if-healthy + fixed registration email breaks every run after the first against a reused server

**Files modified:** `extension/e2e-visual/capture-tile-parity.mjs` (same commit as WR-01)
**Commit:** `2700e77`
**Applied fix:** Made `EMAIL` per-run (`uat-tile-parity-${RUN}@example.local`, still overridable via `PV_TILE_PARITY_EMAIL`), matching the already-per-run `tile-parity-${RUN}.db` naming — the simpler of the review's two suggested fixes. Required moving the `RUN` constant's declaration above `EMAIL`'s (both are top-level `const`s; referencing `RUN` before its own line executes would throw a temporal-dead-zone `ReferenceError`) — verified with `node --check` and a full harness run afterward.

### WR-03: `ensureWebStaticExport` reuses any pre-existing `web/out` regardless of freshness

**Files modified:** `extension/e2e-visual/capture-tile-parity.mjs` (same commit as WR-01/WR-02)
**Commit:** `2700e77`
**Applied fix:** Added a `newestMtimeUnder()` helper that walks `web/src` for its newest file mtime (skipping `node_modules`/`.next`/`out` defensively), and gated the `web/out` reuse branch on `outIndex`'s mtime being `>=` that newest source mtime. A stale export now triggers a rebuild with an explicit log line instead of being silently reused.

**Note on WR-01/WR-02/WR-03 grouping:** these three fixes were committed together in a single commit rather than three separate ones, because they land in the same file with genuinely interdependent edits (WR-02's `RUN`/`EMAIL` reordering, WR-01's `cleanup()` extension). Each finding was independently verified (see below) before being folded into this one commit; splitting them further would have meant re-deriving the same diff context three times for no isolation benefit.

**Verification performed for WR-01/02/03:**
- `node --check extension/e2e-visual/capture-tile-parity.mjs`: syntax OK.
- Ran the harness **end-to-end for real** (`node e2e-visual/capture-tile-parity.mjs`) against a packaged Chrome extension, a freshly-built `web/out` static export, and this script's own `cargo run` pv-server on port 8630 — the harness completed successfully (see WR-04's verification section below for the actual run log/results, since the same run also exercises WR-04's fix).
- Confirmed via `ps`/process-group inspection during the run that `cargo run`'s spawn used `detached: true` as intended, and that `cleanup()`'s negative-pid `process.kill()` calls did not throw on a live process group.

### WR-04: Tile color is not actually single-sourced — React component hardcodes its own values instead of the new tokens

**Files modified:** `packages/pv-ui/components/ItemIconTile.tsx`, `extension/e2e-visual/capture-tile-parity.mjs`
**Commit:** `378d0fb` — "fix(17): WR-04 make React ItemIconTile read --pv-tile-bg/--pv-tile-fg"
**Applied fix:** Replaced `ItemIconTile.tsx`'s independently-derived `TILE_BG`/`TILE_FG` (a `bg-base-200`/`text-base-content/70` pair plus a manual `[[data-theme=vault-dark]_&]:bg-zinc-100`/`text-zinc-600` override) with Tailwind v4 arbitrary-value classes that read the CSS custom properties directly: `bg-[var(--pv-tile-bg)]` / `text-[var(--pv-tile-fg)]`. `tokens.css` already declares both properties per-theme (the `:root, [data-theme=vault-dark]` block and the `[data-theme=vault-light]` override), so this makes tokens.css the genuine single source of truth for both the flip AND the light/dark values, matching what the in-page overlay CSS already did.

Because this changed the tile's rendered CSS class, `capture-tile-parity.mjs`'s own color-reading locators (`.bg-base-200`, in three places) no longer matched anything and needed updating as a direct, necessary follow-through — otherwise the harness itself (this phase's own visual-parity proof mechanism) would silently stop finding the tile. Updated all three to `[class*="pv-tile-bg"]` (an attribute-substring match, avoiding the need to CSS-escape the arbitrary-value selector's literal brackets/parens), keeping the pre-existing `button`-scoping on the popup locator as defense-in-depth.

**Verification performed (this finding required the strongest evidence per the task instructions):**
- `tsc --noEmit` clean on both `extension/` and `web/` (0 errors, matching each project's own unmodified baseline).
- `npx vitest run` on both `extension/` (687/687) and `web/` (481/481) — no regressions, including the existing `entrypoints/popup/ItemIconTile.test.tsx` (9/9 passing unchanged).
- Grepped the **compiled** production CSS from both a real `wxt build -b chrome` and a real `next build` static export, confirming Tailwind v4's `@source` scan of `packages/pv-ui/components/**/*.tsx` (already wired into both `web/src/app/globals.css` and `extension/entrypoints/popup/style.css`) actually generates the new utility classes:
  - `.bg-\[var\(--pv-tile-bg\)\]{background-color:var(--pv-tile-bg)}`
  - `.text-\[var\(--pv-tile-fg\)\]{color:var(--pv-tile-fg)}`
  present in both the extension popup's compiled CSS and web's static-export compiled CSS.
- **Ran the full visual-parity Playwright/CDP harness end-to-end** (`node e2e-visual/capture-tile-parity.mjs`) against a real packaged Chrome extension, a real `next build` static export served by a real `cargo run` pv-server, and a real fixture page for the in-page shadow-DOM overlay. Result: **16/16 results passing, 0 failing**, with byte-identical computed `background-color` across all three surfaces (web `ItemRow`/`DetailPanel`, extension popup, in-page overlay dropdown/prompt) in both themes:
  - vault-dark: `rgba(244, 244, 245, 1.000)` on web, popup, and in-page (dropdown + prompt) alike.
  - vault-light: `rgba(252, 251, 250, 1.000)` on web, popup, and in-page (dropdown + prompt) alike.
  - All `parity-*` comparison entries in `results.json` (`parity-web-vs-inpage-dropdown-*`, `parity-popup-vs-inpage-dropdown-*`, `parity-web-vs-inpage-prompt-*`) report `pass: true`.
  - The regenerated screenshot/log/results.json artifacts produced by this verification run were reverted (`git checkout --`) before committing, since they are tracked UAT fixtures from the phase's own prior execution and regenerating them was outside this fix task's scope — only the source-code diffs were committed.

## Skipped Issues

None — all 5 in-scope findings (CR-01, WR-01, WR-02, WR-03, WR-04) were fixed and verified.

---

_Fixed: 2026-07-21T09:49:53Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
