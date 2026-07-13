import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions must be created via vi.hoisted() so they exist before the
// hoisted vi.mock() factory below runs (vi.mock is hoisted to the top of
// the file by Vitest's transform, ahead of normal const declarations).
const {
  mockInit,
  mockFromPassword,
  mockGenerate,
  mockWrapUserKey,
  mockUnwrapUserKey,
  mockEncryptItem,
  mockDecryptItem,
  mockDefaultKdfParamsJson,
  mockRandomSalt,
  mockDeriveAuthMaterial,
} = vi.hoisted(() => ({
  mockInit: vi.fn(),
  mockFromPassword: vi.fn(),
  mockGenerate: vi.fn(),
  mockWrapUserKey: vi.fn(),
  mockUnwrapUserKey: vi.fn(),
  mockEncryptItem: vi.fn(),
  mockDecryptItem: vi.fn(),
  mockDefaultKdfParamsJson: vi.fn(),
  mockRandomSalt: vi.fn(),
  mockDeriveAuthMaterial: vi.fn(),
}));

vi.mock("./wasm/pv_wasm.js", () => ({
  default: mockInit,
  WasmWrappingKey: { fromPassword: mockFromPassword },
  WasmUserKey: { generate: mockGenerate },
  wrapUserKey: mockWrapUserKey,
  unwrapUserKey: mockUnwrapUserKey,
  encryptItem: mockEncryptItem,
  decryptItem: mockDecryptItem,
  defaultKdfParamsJson: mockDefaultKdfParamsJson,
  randomSalt: mockRandomSalt,
  deriveAuthMaterial: mockDeriveAuthMaterial,
}));

const SELF_TEST_PLAINTEXT = '{"type":"note","body":"self-test fixture"}';

function primeHappyPathMocks() {
  mockInit.mockResolvedValue(undefined);
  mockRandomSalt.mockReturnValue(new Uint8Array(16));
  mockDefaultKdfParamsJson.mockReturnValue("{}");
  mockFromPassword.mockReturnValue({});
  mockGenerate.mockReturnValue({});
  mockWrapUserKey.mockReturnValue("wrapped-json");
  mockUnwrapUserKey.mockReturnValue({});
  mockEncryptItem.mockReturnValue("encrypted-json");
  mockDecryptItem.mockReturnValue(SELF_TEST_PLAINTEXT);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("initCrypto", () => {
  it("memoizes the underlying wasm init() call across repeated invocations", async () => {
    mockInit.mockResolvedValue(undefined);
    const { initCrypto } = await import("./index");

    const first = initCrypto();
    const second = initCrypto();

    expect(first).toBe(second);
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(mockInit).toHaveBeenCalledTimes(1);
  });

  it("propagates a rejection from the underlying wasm init() call", async () => {
    const initError = new Error("wasm binary failed to load");
    mockInit.mockRejectedValue(initError);
    const { initCrypto } = await import("./index");

    await expect(initCrypto()).rejects.toThrow("wasm binary failed to load");
  });
});

describe("runSelfTest", () => {
  it("resolves 5 ordered, passing steps against mocked bindings", async () => {
    primeHappyPathMocks();
    const { runSelfTest } = await import("./index");

    const results = await runSelfTest();

    expect(results).toHaveLength(5);
    expect(results.map((r) => r.name)).toEqual([
      "Derive User Key",
      "Wrap",
      "Unwrap",
      "Encrypt item",
      "Decrypt item",
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("reports a partial failure without aborting earlier steps", async () => {
    primeHappyPathMocks();
    mockDecryptItem.mockImplementation(() => {
      throw new Error("decrypt boom");
    });
    const { runSelfTest } = await import("./index");

    const results = await runSelfTest();

    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName["Derive User Key"].ok).toBe(true);
    expect(byName["Wrap"].ok).toBe(true);
    expect(byName["Unwrap"].ok).toBe(true);
    expect(byName["Encrypt item"].ok).toBe(true);
    expect(byName["Decrypt item"].ok).toBe(false);
    expect(byName["Decrypt item"].error).toContain("decrypt boom");
  });
});
