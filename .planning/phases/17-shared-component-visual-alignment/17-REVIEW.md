---
phase: 17-shared-component-visual-alignment
reviewed: 2026-07-21T00:00:00Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - packages/pv-ui/components/ItemIconTile.tsx
  - packages/pv-ui/package.json
  - packages/pv-ui/package-lock.json
  - packages/pv-ui/tokens.css
  - web/src/components/vault/ItemIconTile.tsx
  - web/src/app/globals.css
  - web/package.json
  - web/vitest.config.ts
  - extension/entrypoints/popup/ItemIconTile.tsx
  - extension/entrypoints/popup/style.css
  - extension/lib/autofill/inpage-overlay.ts
  - extension/lib/autofill/inpage-theme.test.ts
  - extension/package.json
  - extension/vitest.config.ts
  - extension/e2e-visual/capture-tile-parity.mjs
  - Dockerfile
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
status: issues_found
---

# Phase 17: Code Review Report

**Reviewed:** 2026-07-21
**Depth:** standard
**Files Reviewed:** 16
**Status:** issues_found

## Summary

Phase 17 promotes `ItemIconTile` into `packages/pv-ui/components/` (the first shared `.tsx`), adds `--pv-tile-bg/--pv-tile-fg` theme tokens, wires `@source` scanning into both consumers' CSS, and adds a Playwright visual-parity harness. The security invariants the phase called out (zero-knowledge direct-to-domain favicon with `no-referrer`, crypto-free pv-ui, closed-shadow React-free in-page overlays, byte-identical peer pins) all hold in the reviewed source — no injection, secret, or zero-knowledge regression was found. The favicon `<img>` correctly fetches `https://<own-domain>/favicon.ico` with `referrerPolicy="no-referrer"` and never proxies through pv-server; the in-page overlay stays imperative/closed-shadow.

The headline defect is a **duplicate-React hazard that was fixed only for the vitest configs but left unguarded in the extension's production build path** — the exact mechanism the test configs document as "breaks every hook / Invalid hook call" applies verbatim to `wxt build`'s Vite/rollup pass, and a second physical React copy is present on disk. Secondary findings concern the visual-parity harness's process/lifecycle robustness and a maintainability gap where the new tile tokens are not actually the single source of truth for the React component.

## Critical Issues

### CR-01: Duplicate React in the packaged extension build — dedupe applied to vitest only, not to `wxt build`

**File:** `extension/vitest.config.ts:41` (fix belongs in `extension/wxt.config.ts`)
**Issue:**
The shared `ItemIconTile` (`packages/pv-ui/components/ItemIconTile.tsx`) uses `useState`/`useEffect`. Both consumers reach it through a symlink: `extension/node_modules/pv-ui -> ../../packages/pv-ui` (verified on disk), and `packages/pv-ui/node_modules/react` **physically exists** (installed by the `predev`/`prebuild` `cd ../packages/pv-ui && npm ci`, verified on disk). A bare `import "react"` from inside `packages/pv-ui/components/` therefore resolves — via realpath/`resolve.symlinks` walk — to pv-ui's **own** React copy, a second instance distinct from `extension/node_modules/react`.

`extension/vitest.config.ts` fixes exactly this with `dedupe: ["react", "react-dom", "lucide-react"]`, and its own comment spells out the failure mode: *"two separate React module instances loaded in the same test run break every hook (useContext on a null dispatcher, Invalid hook call)."* That same resolution mechanic governs the shipped build:
- `wxt build` runs Vite/rollup. `@wxt-dev/module-react` (verified: `dist/index.mjs`) only calls `addViteConfig(... react(vite))` and adds import presets — it sets **no** `resolve.dedupe`. `extension/wxt.config.ts` sets no `vite`/`resolve` block either.
- Rollup (the build path, unlike `wxt dev`'s esbuild optimizeDeps) honors `resolve.dedupe`, not optimizeDeps — so the packaged popup can bundle two Reacts and crash the popup with "Invalid hook call" the moment `PvItemIconTile` renders inside the popup's React tree.

The web build is **not** affected: Next 16 injects `createVendoredReactAliases` (verified in `next/dist/build/webpack-config.js`), forcing a single vendored React across `transpilePackages`. Only the extension's Vite build lacks an equivalent guard.

**Fix:** Mirror the vitest dedupe into the real build config in `extension/wxt.config.ts`:
```ts
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    resolve: { dedupe: ["react", "react-dom", "lucide-react"] },
  }),
  // ...existing manifest(...)
});
```
Then confirm empirically: `wxt build -b chrome` and grep the emitted popup chunk(s) under `.output/chrome-mv3/` for a single React instance (or run `npm run test:e2e:visual`, which drives the packaged popup — a green run of `configureAndSignInPopup` disproves the hazard, a hang at the `select` wait confirms it).

## Warnings

### WR-01: `cargo run` child is orphaned on SIGTERM — parity harness leaks a server and deletes its live DB

**File:** `extension/e2e-visual/capture-tile-parity.mjs:214-224, 304-324`
**Issue:** `ownPvServerProc = spawn("cargo", ["run", "-p", "pv-server"], ...)` and teardown does `ownPvServerProc.kill("SIGTERM")`. `cargo run` does not forward SIGTERM to the child `pv-server` binary it spawns, so the actual server is orphaned — it keeps holding `PV_PORT` (8630) and the SQLite file. `cleanup()` then `fs.rmSync`s the DB (and `-wal`/`-shm`) out from under the still-running orphan. A subsequent run's `ensurePvServer` sees the orphan as "already healthy" and reuses it, now pointed at a deleted/stale DB — producing confusing, non-deterministic failures. This violates the "kill-only-what-we-started" contract the file claims to preserve.
**Fix:** Spawn detached and kill the whole process group, e.g. `spawn("cargo", [...], { detached: true, ... })` and `process.kill(-ownPvServerProc.pid, "SIGTERM")` in cleanup; or build once (`cargo build -p pv-server --release`) and `spawn` the binary directly so the PID you hold is the server itself.

### WR-02: Reuse-if-healthy + fixed registration email breaks every run after the first against a reused server

**File:** `extension/e2e-visual/capture-tile-parity.mjs:53, 202-207, 332-358`
**Issue:** `EMAIL` is a constant (`uat-tile-parity@example.local`) and `registerAndCreateItem` only ever performs a **register** (`register-submit`) with no "already registered → log in instead" fallback. When `ensurePvServer` takes its reuse branch (an already-healthy server on 8630 — including one left over per WR-01), that server's DB already has this email, so `register-submit` fails and the harness dies at `new-item-button` wait. The reuse path is thus only correct for the very first run.
**Fix:** Either make the account per-run (`EMAIL = \`uat-tile-parity-${RUN}@example.local\``, matching the already-per-run DB), or detect an existing-account error and fall through to the login path.

### WR-03: `ensureWebStaticExport` reuses any pre-existing `web/out` regardless of freshness

**File:** `extension/e2e-visual/capture-tile-parity.mjs:243-248`
**Issue:** The guard is `if (fs.existsSync(outIndex)) { reuse; return; }`. The comment claims it reuses "this run's own earlier build," but there is no run-marker or mtime check — a stale static export from an unrelated prior commit is silently reused. The whole point of this harness is to prove web-vs-in-page tile parity; running it against an outdated `web/out` can report a false pass or a false mismatch that has nothing to do with the current source.
**Fix:** Gate on a per-run sentinel written into `web/out` (or compare `outIndex` mtime against the newest file under `web/src`), and rebuild when stale. At minimum, force a rebuild when `PV_TILE_PARITY_*` inputs change.

### WR-04: Tile color is not actually single-sourced — React component hardcodes its own values instead of the new tokens

**File:** `packages/pv-ui/components/ItemIconTile.tsx:85-86` vs `packages/pv-ui/tokens.css:52-53,67-68`
**Issue:** The phase adds `--pv-tile-bg`/`--pv-tile-fg` to fix the dark-tile bug, but only the in-page overlay CSS consumes them (`inpage-overlay.ts:270,273` → `var(--pv-tile-bg)`/`var(--pv-tile-fg)`). The React `ItemIconTile` re-derives the same colors independently via Tailwind arbitrary variants: `TILE_BG = "bg-base-200 [[data-theme=vault-dark]_&]:bg-zinc-100"` and `TILE_FG = "... [[data-theme=vault-dark]_&]:text-zinc-600"`. Parity between `bg-zinc-100` and `oklch(96.7% 0.001 286.375)` is held together only by the e2e harness (which needs a live server + browser and is best-effort). A future edit to `--pv-tile-bg` in tokens.css will silently NOT propagate to the React tile, reintroducing the exact dark-tile divergence this phase set out to kill — undetected by unit tests.
**Fix:** Have the React component reference the tokens too, so the token is genuinely the single source of truth, e.g. `bg-[var(--pv-tile-bg)]` / `text-[var(--pv-tile-fg)]` (both already exist for every theme in tokens.css). This also removes the `zinc-100 == oklch(...)` "verified equal" assumption entirely.

### WR-05: Web build correctness depends on an undocumented Next internal (vendored React alias)

**File:** `web/next.config.ts` (context) / `packages/pv-ui/package.json:59-64`
**Issue:** The web build survives the same symlink + second-React-copy setup as CR-01 only because Next 16 happens to alias React to its vendored copy (`createVendoredReactAliases`). Nothing in the repo asserts or documents this dependency, so a Next upgrade/config change (or a switch away from the App Router alias behavior) could reintroduce the duplicate-React crash on web with no guard rail. The root cause — pv-ui shipping a physically-installed React under its own `node_modules` while being consumed via symlink — is a known "Invalid hook call" footgun for any bundler that isn't Next.
**Fix:** Add an explicit, self-documenting guard on the web side too (Turbopack/webpack `resolveAlias` for `react`/`react-dom`, or the same dedupe intent), and/or add a short note in `packages/pv-ui`'s README that consumers MUST dedupe React because pv-ui installs its own copy for `tsc`/standalone typechecking.

## Info

### IN-01: In-page favicon-failed host cache grows unbounded for the page session

**File:** `extension/lib/autofill/inpage-overlay.ts:107` and `packages/pv-ui/components/ItemIconTile.tsx:29`
**Issue:** `FAILED_FAVICON_HOSTS` is a module-level `Set` that is only ever added to, never pruned. For the component this is bounded by vault size; for the content-script instance it accumulates per distinct failing host over the page session. Not a correctness or security issue (and perf is out of v1 scope), noted only for awareness.
**Fix:** None required; optionally cap the set or clear it on controller `destroy()`.

### IN-02: Parity harness relies on DOM order to disambiguate prompt vs dropdown tiles

**File:** `extension/e2e-visual/capture-tile-parity.mjs:639-643, 652-658`
**Issue:** With the dropdown open, both Surface B and Surface A render `.pv-row-icon-tile` nodes, and `cdpQuery(..., pierce:true)` returns all of them across the whole document. The code takes `promptTiles[0]` (first) and `dropdownTiles[dropdownTiles.length - 1]` (last), assuming the later-appended dropdown is last in traversal order. This works today but is fragile — a change in append order or an extra surface would silently read the wrong tile's background and mis-report parity.
**Fix:** Scope each `cdpQuery` to the intended panel (e.g. match tiles whose ancestor carries `data-pv-surface="prompt"` vs `"dropdown"`) rather than relying on global index position.

---

_Reviewed: 2026-07-21_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
