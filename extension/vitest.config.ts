import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  // Plan 11-08 (inpage-theme.ts): Vite's `?inline`/`?raw`/`?url` import
  // suffixes run an EXTRA `server.fs.allow` access check independent of
  // normal module resolution (`isServerAccessDeniedForTransform` in Vite's
  // transform middleware) -- confirmed by reading Vite 7.3.6's own source
  // at execution time after `pv-ui/tokens.css?inline` failed with "Denied
  // ID" under vitest despite resolving fine through plain `import` (no
  // suffix) resolution. `fs.allow` defaults to Vite's auto-detected
  // workspace root, which walks up from `extension/`'s own directory to
  // its nearest lockfile (`extension/package-lock.json`, i.e. `extension/`
  // itself) -- the SAME sibling-directory workspace-root boundary problem
  // 11-07-SUMMARY.md's deviation #1 hit with Next.js's Turbopack for this
  // exact `packages/pv-ui` package, just enforced by Vite's dev-server
  // fs-access layer instead of a bundler's module resolver. Widening
  // `fs.allow` to the monorepo root (one directory up) makes
  // `packages/pv-ui` (a sibling of `extension/`) servable, mirroring
  // `web/next.config.ts`'s `turbopack.root` fix.
  server: {
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
  test: {
    // Plan 11-08 (inpage-theme.ts): vitest's own default `css: false`
    // stubs EVERY `*.css`-like import (including a `?inline` query
    // suffix) to an empty module BEFORE Vite's real CSS pipeline (and
    // therefore its `?inline` transform) ever runs -- confirmed by a
    // throwaway smoke test at execution time (an unconfigured run
    // resolved `pv-ui/tokens.css?inline` to a zero-length string, not the
    // real token CSS). `css: true` opts every project back into Vite's
    // real CSS processing, which IS what `?inline` needs to actually
    // return `tokens.css`'s processed text -- this does not change
    // anything for the popup project's plain `import "./style.css"`
    // side-effect import (still injected as a no-op style tag under
    // jsdom, exactly as before).
    css: true,
    // Background/lib tests (Plans 09-01..09-05/09-08) need "node" -- they
    // exercise chrome.storage/WASM-loader mocks, not the DOM. Plan 09-06's
    // popup component tests need a real DOM (React Testing Library).
    // `environmentMatchGlobs` is deprecated as of this project's pinned
    // vitest v3.2.7 (removed entirely in v4) -- `projects` is the
    // supported replacement, confirmed against vitest.dev's own migration
    // guide at execution time rather than assumed.
    // Phase 10 (Plan 10-01): the DOM-detection tests plans 10-02/10-03/10-05
    // add (extension/lib/autofill/**, extension/entrypoints/
    // content-relay.test.ts) run under the "background" project below (they
    // are not excluded from it) but opt into jsdom PER FILE via a
    // `// @vitest-environment jsdom` docblock at the top of the test file.
    // Verified at execution time against this project's pinned vitest
    // v3.2.7: the docblock override applies even though the "background"
    // project's own configured default is "node" -- confirmed with a throw-
    // away smoke test before this comment was written. This keeps
    // background/lib code running under node by default (unchanged) while
    // giving individual DOM-heavy test files real `window`/`document`
    // without a third project or restructuring this file's shape.
    projects: [
      {
        extends: true,
        test: {
          name: "background",
          environment: "node",
          // 13-03-PLAN.md: "e2e/**" holds @playwright/test specs
          // (extension/e2e/dual-browser.spec.ts), which vitest must never
          // collect -- Playwright's `test()`/`expect()` are a different
          // framework than vitest's, and without this exclusion the
          // "background" project's default include glob
          // (`**/*.{test,spec}.?(c|m)[jt]s?(x)`) would pick the Playwright
          // spec up and crash `npm test`.
          exclude: ["**/node_modules/**", "entrypoints/popup/**", "e2e/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "popup",
          environment: "jsdom",
          include: ["entrypoints/popup/**/*.test.{ts,tsx}"],
          exclude: ["e2e/**"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
