import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions must be created via vi.hoisted() so they exist before the
// hoisted vi.mock() factory below runs (vi.mock is hoisted to the top of
// the file by Vitest's transform, ahead of normal const declarations) —
// same pattern as web/src/lib/crypto/index.test.ts.
const {
  mockInitCrypto,
  mockFromPassword,
  mockGenerate,
  mockWrapUserKey,
  mockUnwrapUserKey,
  mockDefaultKdfParamsJson,
  mockRandomSalt,
} = vi.hoisted(() => ({
  mockInitCrypto: vi.fn(),
  mockFromPassword: vi.fn(),
  mockGenerate: vi.fn(),
  mockWrapUserKey: vi.fn(),
  mockUnwrapUserKey: vi.fn(),
  mockDefaultKdfParamsJson: vi.fn(),
  mockRandomSalt: vi.fn(),
}));

// vault-session.ts must import its crypto surface exclusively from
// ./wasm-loader (never directly from ./wasm/pv_wasm.js) — mocking this
// module, not the raw wasm glue, is what proves that choke-point discipline
// while keeping this test fully browser-independent.
vi.mock("./wasm-loader", () => ({
  initCrypto: mockInitCrypto,
  WasmWrappingKey: { fromPassword: mockFromPassword },
  WasmUserKey: { generate: mockGenerate },
  wrapUserKey: mockWrapUserKey,
  unwrapUserKey: mockUnwrapUserKey,
  defaultKdfParamsJson: mockDefaultKdfParamsJson,
  randomSalt: mockRandomSalt,
}));

import type { SessionStorage } from "./vault-session";

// Trivial Map-backed fake — no browser API mocking needed at all, which is
// the whole point of vault-session.ts taking its storage dependency as an
// injected parameter rather than a global import (D-05).
function makeFakeStorage(initial: Record<string, unknown> = {}): SessionStorage {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    async get(key: string) {
      return store.has(key) ? { [key]: store.get(key) } : {};
    },
    async set(items: Record<string, unknown>) {
      for (const [key, value] of Object.entries(items)) {
        store.set(key, value);
      }
    },
  };
}

function primeHappyPathMocks() {
  mockInitCrypto.mockResolvedValue(undefined);
  mockRandomSalt.mockReturnValue(new Uint8Array(16).fill(7));
  mockDefaultKdfParamsJson.mockReturnValue("{}");
  mockFromPassword.mockReturnValue({ tag: "wrapping-key" });
  mockGenerate.mockReturnValue({ tag: "user-key" });
  mockWrapUserKey.mockReturnValue("wrapped-json");
  mockUnwrapUserKey.mockReturnValue({ tag: "unwrapped-user-key" });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("roundTripSpike", () => {
  it("fresh init (empty session store): derives, generates, wraps, persists, and self-verifies via unwrap", async () => {
    primeHappyPathMocks();
    const { roundTripSpike } = await import("./vault-session");
    const storage = makeFakeStorage();

    const result = await roundTripSpike(storage);

    expect(result).toEqual({ survived: false, ok: true });
    expect(mockInitCrypto).toHaveBeenCalledTimes(1);
    expect(mockRandomSalt).toHaveBeenCalledTimes(1);
    expect(mockFromPassword).toHaveBeenCalledTimes(1);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockWrapUserKey).toHaveBeenCalledTimes(1);
    expect(mockUnwrapUserKey).toHaveBeenCalledTimes(1); // self-verify before returning

    const stored = await storage.get("spikeEnvelope");
    expect(stored.spikeEnvelope).toMatchObject({ wrappedJson: "wrapped-json" });
    expect((stored.spikeEnvelope as { saltB64: string }).saltB64).toEqual(expect.any(String));
  });

  it("survived-a-wake (pre-existing spikeEnvelope): re-derives from the persisted salt, unwraps, and never writes a new envelope", async () => {
    primeHappyPathMocks();
    const storage = makeFakeStorage({
      spikeEnvelope: {
        wrappedJson: "persisted-wrapped-json",
        saltB64: "AQIDBAUGBwgJCgsMDQ4PEA==",
      },
    });
    const setSpy = vi.spyOn(storage, "set");
    const { roundTripSpike } = await import("./vault-session");

    const result = await roundTripSpike(storage);

    expect(result).toEqual({ survived: true, ok: true });
    expect(mockInitCrypto).toHaveBeenCalledTimes(1);
    expect(mockGenerate).not.toHaveBeenCalled(); // no fresh UserKey generated on the survived path
    expect(mockRandomSalt).not.toHaveBeenCalled(); // reuses the persisted salt, doesn't mint a new one
    expect(mockFromPassword).toHaveBeenCalledTimes(1);
    expect(mockUnwrapUserKey).toHaveBeenCalledWith(
      { tag: "wrapping-key" },
      "persisted-wrapped-json",
    );
    expect(setSpy).not.toHaveBeenCalled(); // must not write a new envelope in this path
  });

  it("never references a global chrome/browser object — the injected SessionStorage is the only storage access", async () => {
    // This vitest.config.ts runs with environment: "node" (no chrome/browser
    // global exists at all). If vault-session.ts referenced one directly,
    // both cases above would already throw a ReferenceError; this case
    // additionally asserts the happy path resolves cleanly with a fake that
    // implements nothing beyond the plain SessionStorage shape.
    primeHappyPathMocks();
    const { roundTripSpike } = await import("./vault-session");

    await expect(roundTripSpike(makeFakeStorage())).resolves.toEqual({
      survived: false,
      ok: true,
    });
  });
});
