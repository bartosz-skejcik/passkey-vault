// Structural gate against the recurring "green tests, dead extension" bug:
// twice in a row (storage in Phase 8, alarms in Phase 9/09-02) a
// permission-gated chrome.* API was used without declaring the permission
// in wxt.config.ts. Unit tests mock the browser object so they can't see
// it; builds don't validate it; only a real-browser load fails — and an
// undefined API thrown during main() aborts service-worker startup so
// EVERY message hangs. This test greps the real sources against the real
// config so the third occurrence dies in vitest instead.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// APIs whose browser.<name>.* usage REQUIRES a same-named manifest
// permission entry. (Deliberately conservative: only APIs where usage
// without the permission yields `undefined` at runtime. `tabs.create`
// needs no permission, so `tabs` is not listed.)
const PERMISSION_GATED_APIS = [
  "alarms",
  "storage",
  "notifications",
  "contextMenus",
  "cookies",
  "history",
  "bookmarks",
  "idle",
  "downloads",
  "webNavigation",
  "privacy",
] as const;

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".output" || entry === "wasm") continue;
      collectSourceFiles(full, acc);
    } else if (
      full.endsWith(".ts") &&
      !full.endsWith(".test.ts") &&
      !full.endsWith(".d.ts")
    ) {
      acc.push(full);
    }
  }
  return acc;
}

describe("manifest permissions cover every permission-gated API in use", () => {
  const configText = readFileSync(join(__dirname, "wxt.config.ts"), "utf8");
  const sources = [
    ...collectSourceFiles(join(__dirname, "entrypoints")),
    ...collectSourceFiles(join(__dirname, "lib")),
  ];

  for (const api of PERMISSION_GATED_APIS) {
    const usagePattern = new RegExp(`\\b(?:browser|chrome)\\.${api}\\.`);
    const usedIn = sources.filter((f) => usagePattern.test(readFileSync(f, "utf8")));
    if (usedIn.length === 0) continue;

    it(`declares '${api}' (used in ${usedIn.map((f) => f.split("/extension/")[1]).join(", ")})`, () => {
      // Matches 'alarms' inside the permissions array literal. Comment-only
      // mentions elsewhere can't satisfy this because the quote characters
      // are required.
      expect(configText).toMatch(new RegExp(`permissions:\\s*\\[[^\\]]*['"]${api}['"]`));
    });
  }

  it("sanity: the gate itself sees at least the storage usage", () => {
    const storageUsers = sources.filter((f) =>
      /\b(?:browser|chrome)\.storage\./.test(readFileSync(f, "utf8")),
    );
    expect(storageUsers.length).toBeGreaterThan(0);
  });
});
