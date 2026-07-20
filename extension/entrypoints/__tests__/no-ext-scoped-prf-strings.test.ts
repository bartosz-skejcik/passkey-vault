import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Phase 15 Plan 06 -- the mechanical AUTH-03 closure proof. AUTH-03's own
// clause is "verified by search, not assumed": Plans 15-03/15-04 removed
// every live consumer of the ext-scoped-PRF path (rpId = extension id) and
// its 6 message kinds, and this plan's Task 1 purged the now-dead
// dictionary keys -- but a one-time deletion pass is not a durable
// guarantee. This test is that guarantee: a permanent, structural,
// grep-based walk that fails any FUTURE PR that reintroduces an
// ext-scoped-PRF string literal anywhere in extension/entrypoints/ or
// extension/lib/, mirroring server-config.test.ts's own
// no_other_extension_file_hard_codes_a_server_url walk/skipDirs/
// allowedFiles/pattern-match structure.
//
// Two deliberate differences from that precedent:
// 1. This guard DOES scan *.test.ts/*.test.tsx files too (unlike the
//    URL-literal guard, which excludes test files as legitimate
//    mock-fixture territory) -- a leftover `extPasskey.enroll.start`
//    string inside a stale test fixture is exactly the kind of orphan
//    this guard exists to catch.
// 2. The skip-dirs set does NOT exclude `e2e` the way the URL-literal
//    guard does -- a leftover ext-scoped-PRF string inside e2e/ IS
//    meaningful signal here (Plan 15-07 is expected to have already
//    removed it), unlike e2e/'s legitimate throwaway URL literals.
describe("no_ext_scoped_prf_strings_survive", () => {
  it("finds no ext-scoped-PRF string literal anywhere in entrypoints/ or lib/", () => {
    const extensionRoot = join(__dirname, "..", "..");
    const walkRoots = [join(extensionRoot, "entrypoints"), join(extensionRoot, "lib")];
    const skipDirs = new Set(["node_modules", ".output", ".wxt", "dist"]);
    const allowedFiles = new Set([join(__dirname, "no-ext-scoped-prf-strings.test.ts")]);
    // The 5 ext-scoped-PRF literal substrings AUTH-03's hard removal
    // (Plans 15-03/15-04/this plan's Task 1) eliminated every live
    // reference to. A match on ANY of these anywhere in the walked source
    // is a regression -- either a reintroduced message kind, dictionary
    // key, or capability-probe string from the deleted rpId=extension-id
    // path.
    const forbiddenSubstrings = ["extPasskey.", "extPrf", "ext-passkey", "ext-prf", "prf-capability"];

    function walk(dir: string, offenders: string[]) {
      for (const entry of readdirSync(dir)) {
        if (skipDirs.has(entry)) continue;
        const fullPath = join(dir, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
          walk(fullPath, offenders);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry)) continue;
        if (allowedFiles.has(fullPath)) continue;
        const contents = readFileSync(fullPath, "utf-8");
        for (const substring of forbiddenSubstrings) {
          if (contents.includes(substring)) {
            offenders.push(`${fullPath}: contains "${substring}"`);
          }
        }
      }
    }

    const offenders: string[] = [];
    for (const root of walkRoots) {
      walk(root, offenders);
    }
    expect(offenders).toEqual([]);
  });
});
