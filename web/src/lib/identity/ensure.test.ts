import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions via vi.hoisted() so they exist before the hoisted vi.mock()
// factory below runs (mirrors lib/passkeys/enroll.test.ts's convention).
const {
  mockGenerate,
  mockWrapIdentitySecretKey,
  mockUnwrapIdentitySecretKey,
  mockGetUnlockedUserKey,
} = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockWrapIdentitySecretKey: vi.fn(),
  mockUnwrapIdentitySecretKey: vi.fn(),
  // WR-15: ensureOwnIdentityKeypair re-verifies that the caller's `uk` is
  // still the CURRENT unlocked handle after each await.
  mockGetUnlockedUserKey: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  WasmIdentityKey: { generate: mockGenerate },
  wrapIdentitySecretKey: mockWrapIdentitySecretKey,
  unwrapIdentitySecretKey: mockUnwrapIdentitySecretKey,
  getUnlockedUserKey: mockGetUnlockedUserKey,
}));

import { ensureOwnIdentityKeypair, StaleUserKeyError } from "./ensure";
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
  // Default: the vault stayed unlocked under the SAME key for the whole
  // call, which is the normal production case.
  mockGetUnlockedUserKey.mockReturnValue(FAKE_UK);
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

  // WR-07 (24-REVIEW.md): a `putIdentityKeypair` rejection (network drop,
  // 500, 401 after a session expiry) must not leak the freshly-generated
  // WASM handle -- `redeemInviteFlow` calls this on the low-trust
  // redemption path, so this is not an exotic failure.
  it("WR-07 regression guard: frees the freshly-generated handle if publishing it fails", async () => {
    const freshIsk = { publicKeyBytes: () => new Uint8Array([5, 6, 7, 8]), free: vi.fn() };
    mockGenerate.mockReturnValue(freshIsk);
    mockWrapIdentitySecretKey.mockReturnValue("wrapped-json");

    (global.fetch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(jsonResponse(404, { error: "not found" })) // GET /api/identity/keypair
      .mockRejectedValueOnce(new Error("network drop")); // PUT /api/identity/keypair

    await expect(ensureOwnIdentityKeypair(FAKE_UK)).rejects.toThrow("network drop");

    expect(freshIsk.free).toHaveBeenCalledTimes(1);
  });

  // WR-15 (code review, Phase 26): `uk` is dereferenced AFTER each await,
  // and lockVault() FREES the current WasmUserKey. Phase 26 calls this on
  // every unlock path (publishOnUnlock), so an unlock immediately followed
  // by a lock/autolock -- or merely a slow network -- routinely dereferenced
  // a freed handle, which wasm-bindgen turns into "null pointer passed to
  // Rust". Checking identity rather than nullity matters: a lock-then-unlock
  // cycle installs a BRAND NEW handle, so a `=== null` guard passes while
  // `uk` is stale.
  describe("WR-15: a lock (or lock+re-unlock) mid-flight is detected, never dereferenced", () => {
    it("throws StaleUserKeyError instead of unwrapping under a freed handle after the GET", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        mockGetUnlockedUserKey.mockReturnValue(null); // lockVault() fired
        return jsonResponse(200, { public_key: "AQID", wrapped_secret_key: "w" });
      });

      await expect(ensureOwnIdentityKeypair(FAKE_UK)).rejects.toThrow(StaleUserKeyError);
      expect(mockUnwrapIdentitySecretKey).not.toHaveBeenCalled();
    });

    it("detects a lock-then-RE-UNLOCK, which a nullity-only guard would miss", async () => {
      (global.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
        // A brand-new handle is installed -- non-null, but NOT `uk`.
        mockGetUnlockedUserKey.mockReturnValue({} as WasmUserKey);
        return jsonResponse(200, { public_key: "AQID", wrapped_secret_key: "w" });
      });

      await expect(ensureOwnIdentityKeypair(FAKE_UK)).rejects.toThrow(StaleUserKeyError);
      expect(mockUnwrapIdentitySecretKey).not.toHaveBeenCalled();
    });

    it("frees the freshly-generated handle when the lock lands after the PUT", async () => {
      const freshIsk = { publicKeyBytes: () => new Uint8Array([1, 1, 1, 1]), free: vi.fn() };
      mockGenerate.mockReturnValue(freshIsk);
      mockWrapIdentitySecretKey.mockReturnValue("wrapped-json");

      (global.fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(jsonResponse(404, { error: "not found" }))
        .mockImplementationOnce(async () => {
          mockGetUnlockedUserKey.mockReturnValue(null);
          return jsonResponse(200, {
            public_key: "AQIDBA==",
            wrapped_secret_key: "wrapped-json",
            adopted_existing: false,
          });
        });

      await expect(ensureOwnIdentityKeypair(FAKE_UK)).rejects.toThrow(StaleUserKeyError);
      expect(freshIsk.free).toHaveBeenCalledTimes(1);
    });
  });
});
