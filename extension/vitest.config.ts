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
        },
      },
    ],
  },
});
