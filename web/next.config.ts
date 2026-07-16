import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "export",
  // D-13 (plan 11-07): pv-ui (packages/pv-ui, a `file:` dependency) ships
  // raw, untranspiled TypeScript source -- Next only transpiles files
  // inside this app's own src/ by default, so a workspace package needs
  // an explicit opt-in or its .ts imports fail to build.
  transpilePackages: ["pv-ui"],
  turbopack: {
    // Turbopack auto-detects the "workspace root" by walking up to the
    // nearest package-manager lockfile -- which is web/package-lock.json,
    // i.e. THIS directory, since web/ and extension/ deliberately keep
    // their own lockfiles rather than a root npm workspace (D-13's
    // mechanism choice, see 11-07-SUMMARY.md). Without this override,
    // Turbopack refuses to compile ../packages/pv-ui at all ("files
    // outside of the workspace root are not compiled") even though
    // `transpilePackages` above says it should. One directory up is
    // exactly far enough to include packages/pv-ui as a sibling of web/.
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
