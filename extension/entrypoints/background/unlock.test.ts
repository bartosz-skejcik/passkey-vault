import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions/classes must be created via vi.hoisted() so they exist
// before the hoisted vi.mock() factories below run (vi.mock is hoisted to
// the top of the file by Vitest's transform, ahead of normal const
// declarations) -- same pattern as ./vault-session.test.ts and
// ./server-config.test.ts.
//
// Every one of unlock.ts's dependencies is mocked wholesale here (rather
// than partially, with vi.importActual for the rest): auth-api.ts,
// vault-session.ts, session-storage.ts, and autolock.ts each themselves
// import "wxt/browser" (directly or transitively via server-config.ts) --
// mocking their whole modules means their own real bodies never execute,
// so this test never needs a "wxt/browser" fake at all. Only the WASM
// boundary (wasm-loader.ts) and these four background-context modules are
// mocked -- unlock.ts's OWN logic is what runs for real.
const hoisted = vi.hoisted(() => {
  class ApiClientError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiClientError";
      this.status = status;
    }
  }

  function base64Encode(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  function base64Decode(b64: string): Uint8Array {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  return {
    ApiClientError,
    base64Encode,
    base64Decode,
    mockPrelogin: vi.fn(),
    mockMe: vi.fn(),
    mockLogin: vi.fn(),
    mockUnlockStart: vi.fn(),
    mockUnlockFinish: vi.fn(),
    mockPasskeyLoginStart: vi.fn(),
    mockPasskeyLoginFinish: vi.fn(),
    mockDeriveAuthMaterial: vi.fn(),
    mockUnwrapUserKey: vi.fn(),
    mockFromPrf: vi.fn(),
    mockSetUnlockedUserKey: vi.fn(),
    mockReadSessionMeta: vi.fn(),
  };
});

vi.mock("./auth-api", () => ({
  ApiClientError: hoisted.ApiClientError,
  base64Encode: hoisted.base64Encode,
  base64Decode: hoisted.base64Decode,
  prelogin: hoisted.mockPrelogin,
  me: hoisted.mockMe,
  login: hoisted.mockLogin,
  unlockStart: hoisted.mockUnlockStart,
  unlockFinish: hoisted.mockUnlockFinish,
  passkeyLoginStart: hoisted.mockPasskeyLoginStart,
  passkeyLoginFinish: hoisted.mockPasskeyLoginFinish,
}));

// unlock.ts imports its crypto surface exclusively from
// ../../lib/crypto/wasm-loader (never directly from ./wasm/pv_wasm.js) --
// mocking this module, not the raw wasm glue, proves that choke-point
// discipline while keeping this test fully WASM-independent.
vi.mock("../../lib/crypto/wasm-loader", () => ({
  initCrypto: vi.fn().mockResolvedValue(undefined),
  deriveAuthMaterial: hoisted.mockDeriveAuthMaterial,
  unwrapUserKey: hoisted.mockUnwrapUserKey,
  WasmWrappingKey: { fromPrf: hoisted.mockFromPrf },
}));

vi.mock("./vault-session", () => ({
  setUnlockedUserKey: hoisted.mockSetUnlockedUserKey,
}));

vi.mock("./session-storage", () => ({
  readSessionMeta: hoisted.mockReadSessionMeta,
}));

vi.mock("./autolock", () => ({
  DEFAULT_AUTOLOCK_MINUTES: 15,
}));

// WR-08: unlock.ts's four web-RP PRF handlers (and the tests that covered
// them) are gone -- a chrome-extension:// popup cannot run a web-RP
// ceremony, so they were unreachable by construction. This file is now the
// password path's cover only; the extension-scoped PRF path was hard-removed
// in AUTH-03 (Plan 15-04), superseded by the server-origin ceremony window.
import { handleUnlockPassword } from "./unlock";

const FAKE_KDF = { m_cost_kib: 1, t_cost: 1, p_cost: 1 };
const FAKE_SALT_B64 = "c2FsdA=="; // "salt"

/** Primes the WASM-boundary mocks with a working (opaque-handle) happy path. */
function primeHappyPathMocks() {
  hoisted.mockDeriveAuthMaterial.mockImplementation(() => ({
    takeAuthHash: () => new Uint8Array([1, 2, 3]),
    takeWrappingKey: () => ({ free: vi.fn() }),
    free: vi.fn(),
  }));
  hoisted.mockFromPrf.mockImplementation(() => ({ free: vi.fn() }));
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("handleUnlockPassword", () => {
  it("Test 1 (unlock-only, existing token): calls setUnlockedUserKey once and zeroizes passwordBytes", async () => {
    primeHappyPathMocks();
    hoisted.mockMe.mockResolvedValue({
      user_id: "u1",
      email: "a@example.com",
      pw_wrapped_uk: "wrapped-json",
    });
    hoisted.mockPrelogin.mockResolvedValue({ kdf: FAKE_KDF, salt: FAKE_SALT_B64 });
    hoisted.mockReadSessionMeta.mockResolvedValue({
      sessionToken: "tok123",
      accountEmail: "a@example.com",
      idleTimeoutMinutes: 15,
      unlockedAtMs: 0,
      wasAutoLocked: false,
    });
    const fakeUk = { tag: "uk" };
    hoisted.mockUnwrapUserKey.mockReturnValue(fakeUk);

    const passwordBytes = new Uint8Array([1, 2, 3, 4]);
    const result = await handleUnlockPassword(passwordBytes);

    expect(result).toEqual({ ok: true });
    expect(hoisted.mockLogin).not.toHaveBeenCalled();
    expect(hoisted.mockSetUnlockedUserKey).toHaveBeenCalledTimes(1);
    expect(hoisted.mockSetUnlockedUserKey).toHaveBeenCalledWith(fakeUk, "a@example.com", "tok123", 15);
    expect(passwordBytes.every((b) => b === 0)).toBe(true);
  });

  it("Test 2 (sign-in, fresh install): calls login() then setUnlockedUserKey with DEFAULT_AUTOLOCK_MINUTES, zeroizes passwordBytes", async () => {
    primeHappyPathMocks();
    hoisted.mockPrelogin.mockResolvedValue({ kdf: FAKE_KDF, salt: FAKE_SALT_B64 });
    hoisted.mockLogin.mockResolvedValue({ session_token: "newtok", pw_wrapped_uk: "wrapped-json" });
    const fakeUk = { tag: "uk" };
    hoisted.mockUnwrapUserKey.mockReturnValue(fakeUk);

    const passwordBytes = new Uint8Array([9, 9, 9]);
    const result = await handleUnlockPassword(passwordBytes, "a@example.com");

    expect(result).toEqual({ ok: true });
    expect(hoisted.mockMe).not.toHaveBeenCalled();
    expect(hoisted.mockLogin).toHaveBeenCalledWith({
      email: "a@example.com",
      auth_hash: expect.any(String),
    });
    expect(hoisted.mockSetUnlockedUserKey).toHaveBeenCalledTimes(1);
    expect(hoisted.mockSetUnlockedUserKey).toHaveBeenCalledWith(fakeUk, "a@example.com", "newtok", 15);
    expect(passwordBytes.every((b) => b === 0)).toBe(true);
  });

  it("Test 3 (unlock-only, invalid session): a 401 from me() returns invalid-credentials and never calls login()", async () => {
    primeHappyPathMocks();
    hoisted.mockMe.mockRejectedValue(new hoisted.ApiClientError(401, "unauthorized"));

    const passwordBytes = new Uint8Array([1, 2, 3]);
    const result = await handleUnlockPassword(passwordBytes);

    expect(result).toEqual({ ok: false, error: "invalid-credentials" });
    expect(hoisted.mockLogin).not.toHaveBeenCalled();
    expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
    expect(passwordBytes.every((b) => b === 0)).toBe(true);
  });
});
