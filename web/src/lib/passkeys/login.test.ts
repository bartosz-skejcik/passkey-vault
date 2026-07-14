import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockPasskeyLoginStart,
  mockPasskeyLoginFinish,
  mockUnlockStart,
  mockUnlockFinish,
  mockFromPrf,
  mockUnwrapUserKey,
  mockSetUnlockedUserKey,
  mockSetSessionToken,
  mockSetStoredEmail,
  mockSetPendingUnlock,
  mockBase64Decode,
} = vi.hoisted(() => ({
  mockPasskeyLoginStart: vi.fn(),
  mockPasskeyLoginFinish: vi.fn(),
  mockUnlockStart: vi.fn(),
  mockUnlockFinish: vi.fn(),
  mockFromPrf: vi.fn(),
  mockUnwrapUserKey: vi.fn(),
  mockSetUnlockedUserKey: vi.fn(),
  mockSetSessionToken: vi.fn(),
  mockSetStoredEmail: vi.fn(),
  mockSetPendingUnlock: vi.fn(),
  mockBase64Decode: vi.fn(),
}));

vi.mock("./api", () => ({
  passkeyLoginStart: mockPasskeyLoginStart,
  passkeyLoginFinish: mockPasskeyLoginFinish,
  unlockStart: mockUnlockStart,
  unlockFinish: mockUnlockFinish,
}));

vi.mock("@/lib/crypto", () => ({
  WasmWrappingKey: { fromPrf: mockFromPrf },
  unwrapUserKey: mockUnwrapUserKey,
  setUnlockedUserKey: mockSetUnlockedUserKey,
}));

vi.mock("@/lib/auth/session", () => ({
  setSessionToken: mockSetSessionToken,
  setStoredEmail: mockSetStoredEmail,
}));

vi.mock("@/lib/auth/pendingUnlock", () => ({
  setPendingUnlock: mockSetPendingUnlock,
}));

vi.mock("@/lib/auth/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/api")>("@/lib/auth/api");
  return {
    ...actual,
    base64Decode: mockBase64Decode,
  };
});

import { passkeyLogin, passkeyUnlock, buildPrfExtensions } from "./login";
import { ApiClientError } from "@/lib/auth/api";
import { setPrfUnavailableHint, takePrfUnavailableHint } from "@/lib/auth/prfUnavailable";

const FAKE_WRAPPING_KEY = { free: vi.fn() };
const FAKE_WRAPPING_KEY_2 = { free: vi.fn() };
const FAKE_USER_KEY = { free: vi.fn() };

function stubGlobals() {
  (global as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
    parseRequestOptionsFromJSON: vi.fn((json: unknown) => json),
  };
  (global as unknown as { navigator: unknown }).navigator = {
    credentials: {
      get: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubGlobals();
  takePrfUnavailableHint(); // clear any leftover one-shot flag from a prior test
  mockBase64Decode.mockImplementation((b64: string) => new Uint8Array([b64.length]));
  mockFromPrf.mockReturnValue(FAKE_WRAPPING_KEY);
});

describe("buildPrfExtensions", () => {
  it("passes map keys through unchanged and only base64-decodes values", () => {
    const result = buildPrfExtensions({ credA: "c2FsdA==", credB: "b3RoZXI=" });
    expect(mockBase64Decode).toHaveBeenCalledWith("c2FsdA==");
    expect(mockBase64Decode).toHaveBeenCalledWith("b3RoZXI=");
    const evalByCredential = (
      result as unknown as { prf: { evalByCredential: Record<string, { first: unknown }> } }
    ).prf.evalByCredential;
    expect(Object.keys(evalByCredential)).toEqual(["credA", "credB"]);
    expect(evalByCredential.credA.first).toEqual(new Uint8Array([8]));
    expect(evalByCredential.credB.first).toEqual(new Uint8Array([8]));
  });
});

describe("prfUnavailable one-shot flag", () => {
  it("returns true once after setPrfUnavailableHint(), then false on a second call", () => {
    setPrfUnavailableHint();
    expect(takePrfUnavailableHint()).toBe(true);
    expect(takePrfUnavailableHint()).toBe(false);
  });
});

describe("passkeyLogin", () => {
  function mockAssertion(prfResultBytes: ArrayBuffer | undefined) {
    return {
      toJSON: vi.fn().mockReturnValue({ id: "assertion-1" }),
      getClientExtensionResults: vi.fn().mockReturnValue(
        prfResultBytes !== undefined ? { prf: { results: { first: prfResultBytes } } } : {},
      ),
    };
  }

  beforeEach(() => {
    mockPasskeyLoginStart.mockResolvedValue({
      state_id: "state-1",
      challenge: { publicKey: { challenge: "chal" } },
      prf_salts: { "cred-1": "c2FsdA==" },
    });
  });

  it("drives the full PRF-success path: start -> get() -> finish, stashes pending unlock, never sets the prfUnavailable hint", async () => {
    const assertion = mockAssertion(new ArrayBuffer(32));
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(assertion);
    mockPasskeyLoginFinish.mockResolvedValue({
      session_token: "session-token",
      pw_wrapped_uk: "pw-wrapped-uk",
      prf_wrapped_uk: "prf-wrapped-uk",
    });

    const onStep = vi.fn();
    const result = await passkeyLogin("existing@example.com", onStep);

    expect(mockPasskeyLoginStart).toHaveBeenCalledWith({ email: "existing@example.com" });
    expect(mockPasskeyLoginFinish).toHaveBeenCalledWith({
      state_id: "state-1",
      credential: { id: "assertion-1" },
    });
    expect(mockSetSessionToken).toHaveBeenCalledWith("session-token");
    expect(mockSetStoredEmail).toHaveBeenCalledWith("existing@example.com");
    expect(mockSetPendingUnlock).toHaveBeenCalledWith(FAKE_WRAPPING_KEY, "prf-wrapped-uk");
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["start", "ceremony", "success"]);
    expect(takePrfUnavailableHint()).toBe(false);
    expect(result).toEqual({ prfUnavailable: false, cancelled: false });
  });

  it("with prf_wrapped_uk: null in the finish response, sets the prfUnavailable hint and the session, but never setPendingUnlock", async () => {
    const assertion = mockAssertion(new ArrayBuffer(32));
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(assertion);
    mockPasskeyLoginFinish.mockResolvedValue({
      session_token: "session-token",
      pw_wrapped_uk: "pw-wrapped-uk",
      prf_wrapped_uk: null,
    });

    const result = await passkeyLogin("existing@example.com");

    expect(mockSetSessionToken).toHaveBeenCalledWith("session-token");
    expect(mockSetPendingUnlock).not.toHaveBeenCalled();
    expect(takePrfUnavailableHint()).toBe(true);
    expect(result).toEqual({ prfUnavailable: true, cancelled: false });
  });

  it("never calls passkeyLoginFinish when navigator.credentials.get() rejects with NotAllowedError", async () => {
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException("dismissed", "NotAllowedError"),
    );

    const onStep = vi.fn();
    const result = await passkeyLogin("existing@example.com", onStep);

    expect(mockPasskeyLoginFinish).not.toHaveBeenCalled();
    expect(mockSetSessionToken).not.toHaveBeenCalled();
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["start", "ceremony", "cancelled"]);
    expect(result).toEqual({ prfUnavailable: false, cancelled: true });
  });

  it("rethrows and reports 'failed' on a genuine (non-cancellation) ceremony rejection", async () => {
    const genuineError = new Error("network error");
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockRejectedValue(genuineError);

    const onStep = vi.fn();
    await expect(passkeyLogin("existing@example.com", onStep)).rejects.toThrow("network error");

    expect(mockPasskeyLoginFinish).not.toHaveBeenCalled();
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["start", "ceremony", "failed"]);
  });
});

describe("passkeyUnlock", () => {
  function mockAssertion(prfResultBytes: ArrayBuffer | undefined) {
    return {
      toJSON: vi.fn().mockReturnValue({ id: "assertion-2" }),
      getClientExtensionResults: vi.fn().mockReturnValue(
        prfResultBytes !== undefined ? { prf: { results: { first: prfResultBytes } } } : {},
      ),
    };
  }

  beforeEach(() => {
    mockFromPrf.mockReturnValue(FAKE_WRAPPING_KEY_2);
  });

  it("returns { prfUnavailable: true } and never calls navigator.credentials.get() when unlockStart 404s", async () => {
    mockUnlockStart.mockRejectedValue(new ApiClientError(404, "no prf-capable passkeys"));

    const onStep = vi.fn();
    const result = await passkeyUnlock(onStep);

    expect(result).toEqual({ prfUnavailable: true, cancelled: false });
    expect(global.navigator.credentials.get).not.toHaveBeenCalled();
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["start"]);
  });

  it("rethrows and reports 'failed' on a genuine (non-404) unlockStart failure", async () => {
    mockUnlockStart.mockRejectedValue(new ApiClientError(500, "internal error"));

    const onStep = vi.fn();
    await expect(passkeyUnlock(onStep)).rejects.toThrow("internal error");
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["start", "failed"]);
  });

  it("PRF-success path calls unwrapUserKey then setUnlockedUserKey directly, and does not call setPendingUnlock", async () => {
    mockUnlockStart.mockResolvedValue({
      state_id: "state-2",
      challenge: { publicKey: { challenge: "chal2" } },
      prf_salts: { "cred-2": "c2FsdA==" },
    });
    const assertion = mockAssertion(new ArrayBuffer(32));
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(assertion);
    mockUnlockFinish.mockResolvedValue({ prf_wrapped_uk: "prf-wrapped-uk-2" });
    mockUnwrapUserKey.mockReturnValue(FAKE_USER_KEY);

    const onStep = vi.fn();
    const result = await passkeyUnlock(onStep);

    expect(mockUnlockFinish).toHaveBeenCalledWith({
      state_id: "state-2",
      credential: { id: "assertion-2" },
    });
    expect(mockUnwrapUserKey).toHaveBeenCalledWith(FAKE_WRAPPING_KEY_2, "prf-wrapped-uk-2");
    expect(mockSetUnlockedUserKey).toHaveBeenCalledWith(FAKE_USER_KEY);
    expect(mockSetPendingUnlock).not.toHaveBeenCalled();
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["start", "ceremony", "success"]);
    expect(result).toEqual({ prfUnavailable: false, cancelled: false });
  });

  it("cancellation (NotAllowedError) during the ceremony is a silent no-op", async () => {
    mockUnlockStart.mockResolvedValue({
      state_id: "state-2",
      challenge: { publicKey: { challenge: "chal2" } },
      prf_salts: {},
    });
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException("dismissed", "NotAllowedError"),
    );

    const onStep = vi.fn();
    const result = await passkeyUnlock(onStep);

    expect(mockUnlockFinish).not.toHaveBeenCalled();
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["start", "ceremony", "cancelled"]);
    expect(result).toEqual({ prfUnavailable: false, cancelled: true });
  });
});
