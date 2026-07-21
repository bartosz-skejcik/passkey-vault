import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Plan 17-03: packages/pv-ui/components/*.tsx is imported via a
    // symlinked (not workspace-hoisted) `file:` dependency
    // (node_modules/pv-ui -> ../../packages/pv-ui). Vite resolves the
    // symlink's realpath before running Node module resolution, so a bare
    // `import "react"`/`"lucide-react"` from inside packages/pv-ui/
    // resolves against packages/pv-ui/node_modules's OWN copy (installed
    // for tsc/Turbopack per 17-01) instead of this project's
    // node_modules -- two separate React module instances loaded in the
    // same test run break every hook (`useContext` on a `null` dispatcher,
    // "Invalid hook call"). `dedupe` forces Vite to resolve these packages
    // to a single instance regardless of which node_modules tree the
    // importer's realpath would otherwise walk up to.
    dedupe: ["react", "react-dom", "lucide-react"],
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
