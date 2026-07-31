import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions via vi.hoisted() so they exist before the hoisted vi.mock()
// factory below runs (mirrors lib/passkeys/enroll.test.ts's convention).
const { mockGenerate, mockWrapIdentitySecretKey, mockUnwrapIdentitySecretKey } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockWrapIdentitySecretKey: vi.fn(),
  mockUnwrapIdentitySecretKey: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  WasmIdentityKey: { generate: mockGenerate },
  wrapIdentitySecretKey: mockWrapIdentitySecretKey,
  unwrapIdentitySecretKey: mockUnwrapIdentitySecretKey,
}));

import { ensureOwnIdentityKeypair } from "./ensure";
import type { WasmUserKey } from "@/lib/crypto";

const FAKE_UK = {} as WasmUserKey;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
});

describe("ensureOwnIdentityKeypair", () => {
  it("generates and publishes a fresh keypair when the account has none yet", async () => {
    const freshIsk = { publicKeyBytes: () => new Uint8Array([1, 2, 3, 4]), free: vi.fn() };
    mockGenerate.mockReturnValue(freshIsk);
    mockWrapIdentitySecretKey.mockReturnValue("wrapped-json");

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(404, { error: "not found" })) // GET /api/identity/keypair
      .mockResolvedValueOnce(
        jsonResponse(200, {
          public_key: "AQIDBA==",
          wrapped_secret_key: "wrapped-json",
          adopted_existing: false,
        }),
      ); // PUT /api/identity/keypair

    const result = await ensureOwnIdentityKeypair(FAKE_UK);

    expect(result).toBe(freshIsk);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockUnwrapIdentitySecretKey).not.toHaveBeenCalled();
    expect(freshIsk.free).not.toHaveBeenCalled();

    const putCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(putCall[0]).toContain("/api/identity/keypair");
    expect(putCall[1].method).toBe("PUT");
    const putBody = JSON.parse(putCall[1].body as string);
    expect(putBody).toEqual({ public_key: "AQIDBA==", wrapped_secret_key: "wrapped-json" });
  });

  it("unwraps and returns the ALREADY-published keypair without generating a second one", async () => {
    const unwrapped = { publicKeyBytes: () => new Uint8Array([9, 9, 9, 9]), free: vi.fn() };
    mockUnwrapIdentitySecretKey.mockReturnValue(unwrapped);

    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      jsonResponse(200, { public_key: "CQkJCQ==", wrapped_secret_key: "existing-wrapped-json" }),
    );

    const result = await ensureOwnIdentityKeypair(FAKE_UK);

    expect(result).toBe(unwrapped);
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(mockUnwrapIdentitySecretKey).toHaveBeenCalledWith(FAKE_UK, "existing-wrapped-json");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("concurrent-loser path: discards the locally-generated handle and adopts the server's canonical one", async () => {
    const localIsk = { publicKeyBytes: () => new Uint8Array([1, 1, 1, 1]), free: vi.fn() };
    const winnerIsk = { publicKeyBytes: () => new Uint8Array([2, 2, 2, 2]), free: vi.fn() };
    mockGenerate.mockReturnValue(localIsk);
    mockWrapIdentitySecretKey.mockReturnValue("local-wrapped-json");
    mockUnwrapIdentitySecretKey.mockReturnValue(winnerIsk);

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(404, { error: "not found" })) // GET
      .mockResolvedValueOnce(
        jsonResponse(200, {
          public_key: "AgICAg==",
          wrapped_secret_key: "winner-wrapped-json",
          adopted_existing: true,
        }),
      ); // PUT — lost the race

    const result = await ensureOwnIdentityKeypair(FAKE_UK);

    expect(result).toBe(winnerIsk);
    expect(localIsk.free).toHaveBeenCalledTimes(1);
    expect(mockUnwrapIdentitySecretKey).toHaveBeenCalledWith(FAKE_UK, "winner-wrapped-json");
  });
});
