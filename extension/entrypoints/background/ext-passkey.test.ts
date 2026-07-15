import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions/state must be created via vi.hoisted() so they exist
// before the hoisted vi.mock() factories below run (vi.mock is hoisted to
// the top of the file by Vitest's transform, ahead of normal const
// declarations) -- same pattern as ./unlock.test.ts and
// ./vault-session.test.ts.
//
// wxt/browser is mocked with a real Map-backed fake for storage.local (so
// the local meta record round-trips through the SAME fake, exercising this
// file's own read/write/clear helpers for real). auth-api.ts,
// vault-session.ts, session-storage.ts, and the wasm-loader choke-point are
// each mocked wholesale (matching unlock.test.ts's own "mock every
// dependency, run this file's own logic for real" discipline).
const hoisted = vi.hoisted(() => {
  class ApiClientError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiClientError";
      this.status = status;
    }
  }

  return {
    ApiClientError,
    storageState: { store: new Map<string, unknown>() },
    mockCreateExtensionPasskey: vi.fn(),
    mockListExtensionPasskeys: vi.fn(),
    mockFromExtPrf: vi.fn(),
    mockWrapUserKey: vi.fn(),
    mockUnwrapUserKey: vi.fn(),
    mockEnsureHydrated: vi.fn(),
    mockGetUnlockedUserKey: vi.fn(),
    mockIsSessionUnlocked: vi.fn(),
    mockSetUnlockedUserKey: vi.fn(),
    mockReadSessionMeta: vi.fn(),
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
        async remove(key: string) {
          hoisted.storageState.store.delete(key);
        },
      },
    },
  },
}));

vi.mock("./auth-api", () => ({
  ApiClientError: hoisted.ApiClientError,
  createExtensionPasskey: hoisted.mockCreateExtensionPasskey,
  listExtensionPasskeys: hoisted.mockListExtensionPasskeys,
}));

// ext-passkey.ts imports its crypto surface exclusively from
// ../../lib/crypto/wasm-loader (never directly from ./wasm/pv_wasm.js) --
// mocking this module, not the raw wasm glue, proves that choke-point
// discipline.
vi.mock("../../lib/crypto/wasm-loader", () => ({
  initCrypto: vi.fn().mockResolvedValue(undefined),
  wrapUserKey: hoisted.mockWrapUserKey,
  unwrapUserKey: hoisted.mockUnwrapUserKey,
  WasmWrappingKey: { fromExtPrf: hoisted.mockFromExtPrf },
}));

vi.mock("./vault-session", () => ({
  ensureHydrated: hoisted.mockEnsureHydrated,
  getUnlockedUserKey: hoisted.mockGetUnlockedUserKey,
  isSessionUnlocked: hoisted.mockIsSessionUnlocked,
  setUnlockedUserKey: hoisted.mockSetUnlockedUserKey,
}));

vi.mock("./session-storage", () => ({
  readSessionMeta: hoisted.mockReadSessionMeta,
}));

import {
  handleExtEnrollStart,
  handleExtEnrollFinish,
  handleExtPrfUnlockStart,
  handleExtPrfUnlockFinish,
  hasEnrolledExtPasskey,
  readExtPasskeyPromptSuppressed,
  setExtPasskeyPromptSuppressed,
} from "./ext-passkey";

const FAKE_SESSION_META = {
  sessionToken: "tok123",
  accountEmail: "a@example.com",
  idleTimeoutMinutes: 15,
  unlockedAtMs: 0,
  wasAutoLocked: false,
};

beforeEach(() => {
  hoisted.storageState.store = new Map();
  vi.resetAllMocks();
});

describe("handleExtEnrollStart", () => {
  it("Test 2: returns fresh ceremony inputs when unlocked; returns not-unlocked WITHOUT generating material when locked", async () => {
    hoisted.mockIsSessionUnlocked.mockReturnValue(true);
    hoisted.mockReadSessionMeta.mockResolvedValue(FAKE_SESSION_META);

    const result1 = await handleExtEnrollStart();
    expect(result1.ok).toBe(true);
    if (result1.ok) {
      expect(result1.accountEmail).toBe("a@example.com");
      expect(atob(result1.prfSaltB64).length).toBe(32);
      expect(atob(result1.challengeB64).length).toBeGreaterThanOrEqual(16);
    }

    const result2 = await handleExtEnrollStart();
    expect(result2.ok).toBe(true);
    if (result1.ok && result2.ok) {
      expect(result1.challengeB64).not.toBe(result2.challengeB64);
    }

    hoisted.mockIsSessionUnlocked.mockReturnValue(false);
    const result3 = await handleExtEnrollStart();
    expect(result3).toEqual({ ok: false, error: "not-unlocked" });
    expect(hoisted.mockReadSessionMeta).toHaveBeenCalledTimes(2); // not called on the locked path
  });
});

describe("handleExtEnrollFinish", () => {
  it("Test 3 (happy path): calls createExtensionPasskey exactly once with the wrapped blob (never the raw prfBytes), persists local meta, zeroizes prfBytes", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({ tag: "uk" });
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockFromExtPrf.mockReturnValue({ free: vi.fn() });
    hoisted.mockWrapUserKey.mockReturnValue("wrapped-json-blob");
    hoisted.mockCreateExtensionPasskey.mockResolvedValue({ id: "server-id-1" });

    const prfBytes = new Uint8Array([1, 2, 3, 4]).buffer;
    const result = await handleExtEnrollFinish({
      credentialIdB64url: "cred-id-1",
      prfSaltB64: "salt-b64",
      prfBytes,
    });

    expect(result).toEqual({ ok: true });
    expect(hoisted.mockCreateExtensionPasskey).toHaveBeenCalledTimes(1);
    const postedBody = hoisted.mockCreateExtensionPasskey.mock.calls[0][0];
    expect(postedBody).toEqual({
      credential_id: "cred-id-1",
      prf_salt: "salt-b64",
      prf_wrapped_uk: "wrapped-json-blob",
    });
    // The POSTed payload must not carry a byte-equal copy of prfBytes.
    expect(JSON.stringify(postedBody)).not.toContain("1,2,3,4");

    expect(new Uint8Array(prfBytes).every((b) => b === 0)).toBe(true);

    // Local meta persisted.
    const status = await hasEnrolledExtPasskey();
    expect(status).toBe(true);
  });

  it("Test 4 (guard): with the session locked, returns not-unlocked, never calls createExtensionPasskey, writes nothing to storage", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    hoisted.mockGetUnlockedUserKey.mockReturnValue(null);

    const prfBytes = new Uint8Array([9, 9, 9]).buffer;
    const result = await handleExtEnrollFinish({
      credentialIdB64url: "cred-id-2",
      prfSaltB64: "salt-b64",
      prfBytes,
    });

    expect(result).toEqual({ ok: false, error: "not-unlocked" });
    expect(hoisted.mockCreateExtensionPasskey).not.toHaveBeenCalled();
    expect(await hasEnrolledExtPasskey()).toBe(false);
  });
});

describe("handleExtPrfUnlockStart", () => {
  it("Test 5: returns the local meta record when present (no network call); notEnrolled when absent", async () => {
    const noMetaResult = await handleExtPrfUnlockStart();
    expect(noMetaResult).toEqual({ notEnrolled: true });
    expect(hoisted.mockListExtensionPasskeys).not.toHaveBeenCalled();

    // Enroll to populate the meta record via the real enroll-finish path.
    hoisted.mockEnsureHydrated.mockResolvedValue({ tag: "uk" });
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockFromExtPrf.mockReturnValue({ free: vi.fn() });
    hoisted.mockWrapUserKey.mockReturnValue("wrapped-json-blob");
    hoisted.mockCreateExtensionPasskey.mockResolvedValue({ id: "server-id" });
    await handleExtEnrollFinish({
      credentialIdB64url: "cred-id-3",
      prfSaltB64: "salt-b64-3",
      prfBytes: new Uint8Array([1]).buffer,
    });

    const result = await handleExtPrfUnlockStart();
    expect(result).toEqual({ credentialIdB64url: "cred-id-3", prfSaltB64: "salt-b64-3" });
    expect(hoisted.mockListExtensionPasskeys).not.toHaveBeenCalled();
  });
});

describe("handleExtPrfUnlockFinish", () => {
  it("Test 6 (happy path): calls setUnlockedUserKey exactly once with the existing session meta, zeroizes prfBytes", async () => {
    hoisted.mockListExtensionPasskeys.mockResolvedValue([
      { credential_id: "cred-id-4", prf_salt: "salt", prf_wrapped_uk: "wrapped-blob", created_at: "now" },
    ]);
    hoisted.mockFromExtPrf.mockReturnValue({ free: vi.fn() });
    const fakeUk = { tag: "uk" };
    hoisted.mockUnwrapUserKey.mockReturnValue(fakeUk);
    hoisted.mockReadSessionMeta.mockResolvedValue(FAKE_SESSION_META);

    const prfBytes = new Uint8Array([5, 6, 7]).buffer;
    const result = await handleExtPrfUnlockFinish({ credentialIdB64url: "cred-id-4", prfBytes });

    expect(result).toEqual({ ok: true });
    expect(hoisted.mockSetUnlockedUserKey).toHaveBeenCalledTimes(1);
    expect(hoisted.mockSetUnlockedUserKey).toHaveBeenCalledWith(fakeUk, "a@example.com", "tok123", 15);
    expect(new Uint8Array(prfBytes).every((b) => b === 0)).toBe(true);
  });

  it("Test 7 (orphaned credential): no matching row -> not-enrolled, clears stale meta, never calls setUnlockedUserKey; 401 -> invalid-credentials", async () => {
    // Populate a stale meta record first.
    hoisted.mockEnsureHydrated.mockResolvedValue({ tag: "uk" });
    hoisted.mockGetUnlockedUserKey.mockReturnValue({ tag: "uk" });
    hoisted.mockFromExtPrf.mockReturnValue({ free: vi.fn() });
    hoisted.mockWrapUserKey.mockReturnValue("wrapped-json-blob");
    hoisted.mockCreateExtensionPasskey.mockResolvedValue({ id: "server-id" });
    await handleExtEnrollFinish({
      credentialIdB64url: "cred-id-orphan",
      prfSaltB64: "salt-b64",
      prfBytes: new Uint8Array([1]).buffer,
    });
    expect(await hasEnrolledExtPasskey()).toBe(true);

    hoisted.mockListExtensionPasskeys.mockResolvedValueOnce([]); // no matching row
    const result = await handleExtPrfUnlockFinish({
      credentialIdB64url: "cred-id-orphan",
      prfBytes: new Uint8Array([1, 2]).buffer,
    });
    expect(result).toEqual({ ok: false, error: "not-enrolled" });
    expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
    expect(await hasEnrolledExtPasskey()).toBe(false); // stale meta cleared

    hoisted.mockListExtensionPasskeys.mockRejectedValueOnce(new hoisted.ApiClientError(401, "expired"));
    const result2 = await handleExtPrfUnlockFinish({
      credentialIdB64url: "cred-id-orphan",
      prfBytes: new Uint8Array([1, 2]).buffer,
    });
    expect(result2).toEqual({ ok: false, error: "invalid-credentials" });
    expect(hoisted.mockSetUnlockedUserKey).not.toHaveBeenCalled();
  });
});

describe("prompt-suppression pref", () => {
  it("Test 8: setExtPasskeyPromptSuppressed persists the pref, readExtPasskeyPromptSuppressed reflects it", async () => {
    expect(await readExtPasskeyPromptSuppressed()).toBe(false);
    await setExtPasskeyPromptSuppressed(true);
    expect(await readExtPasskeyPromptSuppressed()).toBe(true);
  });
});
