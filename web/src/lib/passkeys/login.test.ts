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

  it("CR-01: strips clientExtensionResults.prf from the credential JSON before POSTing passkeyLoginFinish, even when the browser's toJSON() includes it", async () => {
    const assertionWithLeakyToJson = {
      toJSON: vi.fn().mockReturnValue({
        id: "assertion-1",
        clientExtensionResults: { prf: { results: { first: "base64url-prf-secret" } } },
      }),
      getClientExtensionResults: vi.fn().mockReturnValue({
        prf: { results: { first: new ArrayBuffer(32) } },
      }),
    };
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      assertionWithLeakyToJson,
    );
    mockPasskeyLoginFinish.mockResolvedValue({
      session_token: "session-token",
      pw_wrapped_uk: "pw-wrapped-uk",
      prf_wrapped_uk: "prf-wrapped-uk",
    });

    await passkeyLogin("existing@example.com");

    const postedCredential = mockPasskeyLoginFinish.mock.calls[0][0].credential as {
      id: string;
      clientExtensionResults?: { prf?: unknown };
    };
    expect(postedCredential.id).toBe("assertion-1");
    expect(postedCredential.clientExtensionResults?.prf).toBeUndefined();
    // extractPrfBytes still reads from the ORIGINAL assertion (unaffected by
    // the strip applied to the toJSON()-derived payload) so the wrapping key
    // can still be derived.
    expect(mockFromPrf).toHaveBeenCalled();
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

  // Bartek live-UAT bug (13-07 signin flow): a zero-passkey account's
  // anti-enumeration DUMMY challenge (T-04-01) still invokes a REAL
  // navigator.credentials.get() -- whose native, out-of-DOM picker can hang
  // indefinitely with no code-level bound. Simulates a spec-compliant
  // browser that honors the AbortSignal passed via the `signal` option
  // (rejects with AbortError once aborted) -- exactly what
  // getAssertionWithTimeout (login.ts) relies on.
  it("a gesture that never resolves is aborted after the bounded timeout, reported as a genuine failure (not cancelled)", async () => {
    vi.useFakeTimers();
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockImplementation(
      (options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const onStep = vi.fn();
    const resultPromise = passkeyLogin("existing@example.com", onStep);
    // Attach a handler immediately -- prevents a spurious "unhandled
    // rejection" report between now and the real assertion below, since the
    // actual rejection only fires once fake timers are advanced past the
    // internal setTimeout.
    const settled = resultPromise.catch((e: unknown) => e);
    // Flush the microtask queue so passkeyLoginStart's awaited mock resolves
    // and navigator.credentials.get() is actually invoked before advancing
    // fake timers past the internal setTimeout.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    const caught = await settled;
    expect(caught).toMatchObject({ name: "AbortError" });
    expect(mockPasskeyLoginFinish).not.toHaveBeenCalled();
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["start", "ceremony", "failed"]);
    vi.useRealTimers();
  });

  it("a gesture that resolves BEFORE the bounded timeout is unaffected (positive path stays intact)", async () => {
    vi.useFakeTimers();
    const assertion = mockAssertion(new ArrayBuffer(32));
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(assertion);
    mockPasskeyLoginFinish.mockResolvedValue({
      session_token: "session-token",
      pw_wrapped_uk: "pw-wrapped-uk",
      prf_wrapped_uk: "prf-wrapped-uk",
    });

    const result = await passkeyLogin("existing@example.com");
    // Advancing well past the timeout afterwards must not retroactively
    // fail an already-settled ceremony (the internal setTimeout is cleared).
    await vi.advanceTimersByTimeAsync(60_000);

    expect(result).toEqual({ prfUnavailable: false, cancelled: false });
    vi.useRealTimers();
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

  it("CR-01: strips clientExtensionResults.prf from the credential JSON before POSTing unlockFinish, even when the browser's toJSON() includes it", async () => {
    mockUnlockStart.mockResolvedValue({
      state_id: "state-2",
      challenge: { publicKey: { challenge: "chal2" } },
      prf_salts: { "cred-2": "c2FsdA==" },
    });
    const assertionWithLeakyToJson = {
      toJSON: vi.fn().mockReturnValue({
        id: "assertion-2",
        clientExtensionResults: { prf: { results: { first: "base64url-prf-secret" } } },
      }),
      getClientExtensionResults: vi.fn().mockReturnValue({
        prf: { results: { first: new ArrayBuffer(32) } },
      }),
    };
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(
      assertionWithLeakyToJson,
    );
    mockUnlockFinish.mockResolvedValue({ prf_wrapped_uk: "prf-wrapped-uk-2" });
    mockUnwrapUserKey.mockReturnValue(FAKE_USER_KEY);

    await passkeyUnlock();

    const postedCredential = mockUnlockFinish.mock.calls[0][0].credential as {
      id: string;
      clientExtensionResults?: { prf?: unknown };
    };
    expect(postedCredential.id).toBe("assertion-2");
    expect(postedCredential.clientExtensionResults?.prf).toBeUndefined();
    expect(mockFromPrf).toHaveBeenCalled();
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

  // Same bounded-timeout guard as passkeyLogin's own (see that describe
  // block's own comment) -- unlock mode shares getAssertionWithTimeout.
  it("a gesture that never resolves is aborted after the bounded timeout, reported as a genuine failure (not cancelled)", async () => {
    vi.useFakeTimers();
    mockUnlockStart.mockResolvedValue({
      state_id: "state-2",
      challenge: { publicKey: { challenge: "chal2" } },
      prf_salts: {},
    });
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockImplementation(
      (options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }),
    );

    const onStep = vi.fn();
    const resultPromise = passkeyUnlock(onStep);
    const settled = resultPromise.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(60_000);

    const caught = await settled;
    expect(caught).toMatchObject({ name: "AbortError" });
    expect(mockUnlockFinish).not.toHaveBeenCalled();
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["start", "ceremony", "failed"]);
    vi.useRealTimers();
  });
});
