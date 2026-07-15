// lib/autofill/blocked-origins.test.ts — proves the add -> isBlocked
// round-trip and that an unknown origin reads as not-blocked. Mocks
// wxt/browser with a real Map-backed fake for storage.local, same pattern
// entrypoints/background/ext-passkey.test.ts uses, so this file's own
// read/write logic runs for real against the fake store.
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  storageState: { store: new Map<string, unknown>() },
}));

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
  },
}));

import { addBlockedOrigin, isOriginBlocked, readBlockedOrigins } from "./blocked-origins";

beforeEach(() => {
  hoisted.storageState.store.clear();
});

describe("blocked-origins", () => {
  it("an origin that was never blocked reads as not blocked", async () => {
    await expect(isOriginBlocked("https://example.com")).resolves.toBe(false);
    await expect(readBlockedOrigins()).resolves.toEqual(new Set());
  });

  it("add -> isBlocked round-trips for the added origin", async () => {
    await addBlockedOrigin("https://example.com");

    await expect(isOriginBlocked("https://example.com")).resolves.toBe(true);
    await expect(isOriginBlocked("https://other.com")).resolves.toBe(false);
  });

  it("adding the same origin twice is idempotent (no duplicate entries)", async () => {
    await addBlockedOrigin("https://example.com");
    await addBlockedOrigin("https://example.com");

    const blocked = await readBlockedOrigins();
    expect(blocked.size).toBe(1);
    expect(blocked.has("https://example.com")).toBe(true);
  });

  it("multiple distinct origins can be blocked independently", async () => {
    await addBlockedOrigin("https://a.example.com");
    await addBlockedOrigin("https://b.example.com");

    const blocked = await readBlockedOrigins();
    expect(blocked).toEqual(new Set(["https://a.example.com", "https://b.example.com"]));
  });
});
