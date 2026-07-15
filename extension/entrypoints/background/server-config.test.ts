import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions/state must be created via vi.hoisted() so they exist
// before the hoisted vi.mock() factory below runs (vi.mock is hoisted to
// the top of the file by Vitest's transform, ahead of normal const
// declarations) -- same pattern as ../../lib/crypto/vault-session.test.ts.
//
// Unlike vault-session.ts (which takes its storage as an injected
// parameter), server-config.ts imports `browser` from "wxt/browser"
// directly (matching background.ts's convention) -- so this test mocks
// the "wxt/browser" module itself, with a real Map-backed fake for
// storage.local (so a configureServer -> readServerConfig round-trip
// through the SAME fake actually persists) and a plain vi.fn() for
// permissions.request (so call args can be asserted).
const hoisted = vi.hoisted(() => {
  return {
    storageState: { store: new Map<string, unknown>() },
    mockPermissionsRequest: vi.fn(),
  };
});

vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: {
        async get(key: string) {
          const store = hoisted.storageState.store;
          return store.has(key) ? { [key]: store.get(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          const store = hoisted.storageState.store;
          for (const [k, v] of Object.entries(items)) {
            store.set(k, v);
          }
        },
      },
    },
    permissions: {
      request: hoisted.mockPermissionsRequest,
    },
  },
}));

import {
  InvalidServerUrlError,
  ServerUnreachableError,
  configureServer,
  normalizeServerUrl,
  probeServerHealth,
  readServerConfig,
  wsUrlFromBase,
} from "./server-config";

beforeEach(() => {
  hoisted.storageState.store = new Map();
  hoisted.mockPermissionsRequest.mockReset();
  hoisted.mockPermissionsRequest.mockResolvedValue(true);
  vi.unstubAllGlobals();
});

describe("normalizeServerUrl", () => {
  it("lowercases the host and strips a trailing slash", () => {
    expect(normalizeServerUrl("http://LOCALHOST:8620/")).toBe("http://localhost:8620");
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/passwd",
    "chrome-extension://x",
    "not a url",
  ])("throws InvalidServerUrlError for %s", (rawUrl) => {
    expect(() => normalizeServerUrl(rawUrl)).toThrow(InvalidServerUrlError);
  });
});

describe("probeServerHealth", () => {
  it("resolves true only for an exact {status:\"ok\"} JSON body on an ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "ok" }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(probeServerHealth("http://localhost:8620")).resolves.toBe(true);
    expect(mockFetch).toHaveBeenCalledWith("http://localhost:8620/healthz");
  });

  it("resolves false for an ok response with an unrelated body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );
    await expect(probeServerHealth("http://localhost:8620")).resolves.toBe(false);
  });

  it("resolves false for an ok response with a different status value", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "healthy" }) }),
    );
    await expect(probeServerHealth("http://localhost:8620")).resolves.toBe(false);
  });

  it("resolves false for a non-JSON (HTML error page) body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      }),
    );
    await expect(probeServerHealth("http://localhost:8620")).resolves.toBe(false);
  });

  it("resolves false (never throws) on a network-level rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(probeServerHealth("http://localhost:8620")).resolves.toBe(false);
  });
});

describe("configureServer", () => {
  it("rejects an invalid URL before any fetch call is made", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    await expect(configureServer("javascript:alert(1)")).rejects.toThrow(InvalidServerUrlError);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(hoisted.mockPermissionsRequest).not.toHaveBeenCalled();
  });

  it("rejects with ServerUnreachableError and does not persist when the probe fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

    await expect(configureServer("http://localhost:8620")).rejects.toThrow(
      ServerUnreachableError,
    );
    expect(hoisted.storageState.store.size).toBe(0);
    expect(hoisted.mockPermissionsRequest).not.toHaveBeenCalled();
  });

  it("requests the single origin's permission, persists, and resolves the normalized config on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) }),
    );

    const config = await configureServer("http://LOCALHOST:8620/");

    expect(config).toEqual({ baseUrl: "http://localhost:8620" });
    expect(hoisted.mockPermissionsRequest).toHaveBeenCalledWith({
      origins: ["http://localhost:8620/*"],
    });
    await expect(readServerConfig()).resolves.toEqual({ baseUrl: "http://localhost:8620" });
  });
});

describe("readServerConfig", () => {
  it("resolves null when unset", async () => {
    await expect(readServerConfig()).resolves.toBeNull();
  });

  it("resolves the persisted config once configureServer has succeeded once", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "ok" }) }),
    );
    await configureServer("https://vault.example.com");
    await expect(readServerConfig()).resolves.toEqual({ baseUrl: "https://vault.example.com" });
  });
});

describe("wsUrlFromBase", () => {
  it("replaces the leading http scheme with ws", () => {
    expect(wsUrlFromBase("http://localhost:8620")).toBe("ws://localhost:8620");
  });

  it("replaces the leading https scheme with wss", () => {
    expect(wsUrlFromBase("https://vault.example.com")).toBe("wss://vault.example.com");
  });
});

// Assumption-delta invariant (see 09-03-PLAN.md's <assumption_delta_decision>):
// server-config.ts is the ONE place extension/ may read or write a
// pv-server base URL. This standing test walks the extension/ source tree
// and fails loudly the instant a future file (Plan 09-04's auth-api.ts,
// Plan 09-05's vault-api.ts/sync-client.ts, Plan 09-06's popup .tsx views,
// etc.) hard-codes an http(s) server-origin literal instead of reading
// readServerConfig()/wsUrlFromBase(). Scoped to BOTH *.ts and *.tsx --
// 09-06's popup components are .tsx, not .ts, and are exactly the files
// most likely to grow a hard-coded origin.
describe("no_other_extension_file_hard_codes_a_server_url", () => {
  it("finds no http(s) URL literal anywhere in extension/ outside this module", () => {
    const extensionRoot = join(__dirname, "..", "..");
    const skipDirs = new Set(["node_modules", ".output", ".wxt", "dist"]);
    const allowedFiles = new Set([
      join(__dirname, "server-config.ts"),
      join(__dirname, "server-config.test.ts"),
    ]);
    // Matches an http(s) URL literal inside a quoted string. Deliberately
    // does NOT match bare doc-comment prose (e.g. "See https://wxt.dev/..."
    // in wxt.config.ts) -- only a string-literal-quoted URL is a genuine
    // hard-coded-server-URL risk (the thing that could actually flow into
    // a fetch/tabs.create call).
    const urlLiteralPattern = /["'`]https?:\/\/[^"'`]+["'`]/;

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
        const lines = contents.split("\n");
        for (const line of lines) {
          const trimmed = line.trim();
          // Skip comment lines (// ... or a leading * in a /* */ block) --
          // a doc comment referencing e.g. https://developer.chrome.com is
          // not a hard-coded server URL, it never reaches a fetch/tabs call.
          if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
          if (urlLiteralPattern.test(line)) {
            offenders.push(`${fullPath}: ${trimmed}`);
          }
        }
      }
    }

    const offenders: string[] = [];
    walk(extensionRoot, offenders);
    expect(offenders).toEqual([]);
  });
});
