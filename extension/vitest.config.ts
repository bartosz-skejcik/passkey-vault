import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
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
          exclude: ["**/node_modules/**", "entrypoints/popup/**"],
        },
      },
      {
        extends: true,
        test: {
          name: "popup",
          environment: "jsdom",
          include: ["entrypoints/popup/**/*.test.{ts,tsx}"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
    ],
  },
});
