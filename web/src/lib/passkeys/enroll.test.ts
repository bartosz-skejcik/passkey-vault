import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockRegisterStart,
  mockRegisterFinish,
  mockPrfWrap,
  mockGetUnlockedUserKey,
  mockWrapUserKey,
  mockFromPrf,
} = vi.hoisted(() => ({
  mockRegisterStart: vi.fn(),
  mockRegisterFinish: vi.fn(),
  mockPrfWrap: vi.fn(),
  mockGetUnlockedUserKey: vi.fn(),
  mockWrapUserKey: vi.fn(),
  mockFromPrf: vi.fn(),
}));

vi.mock("./api", () => ({
  registerStart: mockRegisterStart,
  registerFinish: mockRegisterFinish,
  prfWrap: mockPrfWrap,
}));

vi.mock("@/lib/crypto", () => ({
  getUnlockedUserKey: mockGetUnlockedUserKey,
  wrapUserKey: mockWrapUserKey,
  WasmWrappingKey: { fromPrf: mockFromPrf },
}));

import { enrollPasskey } from "./enroll";

const FAKE_USER_KEY = { free: vi.fn() };
const FAKE_WRAPPING_KEY = { free: vi.fn() };

function stubGlobals() {
  (global as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {
    parseCreationOptionsFromJSON: vi.fn((json: unknown) => json),
    parseRequestOptionsFromJSON: vi.fn((json: unknown) => json),
  };
  (global as unknown as { navigator: unknown }).navigator = {
    credentials: {
      create: vi.fn(),
      get: vi.fn(),
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubGlobals();
  mockGetUnlockedUserKey.mockReturnValue(FAKE_USER_KEY);
  mockRegisterStart.mockResolvedValue({
    state_id: "state-1",
    challenge: { publicKey: { challenge: "chal" } },
    prf_salt: "c2FsdA==",
  });
  mockRegisterFinish.mockResolvedValue({
    passkey_id: "passkey-1",
    name: "My passkey",
    prf_challenge: { publicKey: { challenge: "chal2" } },
    prf_state_id: "state-2",
    prf_salt: "c2FsdA==",
  });
  mockFromPrf.mockReturnValue(FAKE_WRAPPING_KEY);
  mockWrapUserKey.mockReturnValue("wrapped-uk-json");
  mockPrfWrap.mockResolvedValue({ prf_capable: true });
});

describe("enrollPasskey", () => {
  it("drives the full PRF-success path and calls prfWrap with the wrapped blob", async () => {
    const credential = {
      toJSON: vi.fn().mockReturnValue({ id: "cred-1" }),
    };
    (global.navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      credential,
    );
    const assertion = {
      toJSON: vi.fn().mockReturnValue({ id: "assertion-1" }),
      getClientExtensionResults: vi.fn().mockReturnValue({
        prf: { results: { first: new ArrayBuffer(32) } },
      }),
    };
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(assertion);

    const onStep = vi.fn();
    await enrollPasskey("My passkey", onStep);

    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["step1", "step2", "doneWithPrf"]);
    expect(mockPrfWrap).toHaveBeenCalledWith("passkey-1", {
      state_id: "state-2",
      credential: { id: "assertion-1" },
      prf_wrapped_uk: "wrapped-uk-json",
    });
    // IN-02: the PRF-derived WASM wrapping-key handle must be explicitly
    // freed (ZeroizeOnDrop only fires on Rust-side drop, which for a
    // wasm-bindgen object requires `.free()` or unpredictable GC).
    expect(FAKE_WRAPPING_KEY.free).toHaveBeenCalledTimes(1);
  });

  it("frees the wrapping-key handle even when prfWrap rejects (IN-02 finally)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const credential = { toJSON: vi.fn().mockReturnValue({ id: "cred-1" }) };
    (global.navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      credential,
    );
    const assertion = {
      toJSON: vi.fn().mockReturnValue({ id: "assertion-1" }),
      getClientExtensionResults: vi.fn().mockReturnValue({
        prf: { results: { first: new ArrayBuffer(32) } },
      }),
    };
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(assertion);
    mockPrfWrap.mockRejectedValue(new Error("server rejected prf-wrap"));

    const onStep = vi.fn();
    await enrollPasskey("My passkey", onStep);

    expect(FAKE_WRAPPING_KEY.free).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("strips clientExtensionResults.prf from the serialized assertion before POSTing it (WR-04)", async () => {
    const credential = { toJSON: vi.fn().mockReturnValue({ id: "cred-1" }) };
    (global.navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      credential,
    );
    const assertion = {
      // Simulates a hypothetical future browser that DOES serialize the raw
      // PRF eval output into `toJSON()`'s clientExtensionResults — the fix
      // must strip it defensively regardless of whether real browsers
      // currently do this.
      toJSON: vi.fn().mockReturnValue({
        id: "assertion-1",
        clientExtensionResults: { prf: { results: { first: "c2VjcmV0Ynl0ZXM=" } } },
      }),
      getClientExtensionResults: vi.fn().mockReturnValue({
        prf: { results: { first: new ArrayBuffer(32) } },
      }),
    };
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(assertion);

    const onStep = vi.fn();
    await enrollPasskey("My passkey", onStep);

    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["step1", "step2", "doneWithPrf"]);
    expect(mockPrfWrap).toHaveBeenCalledWith("passkey-1", {
      state_id: "state-2",
      credential: { id: "assertion-1", clientExtensionResults: {} },
      prf_wrapped_uk: "wrapped-uk-json",
    });
  });

  it("resolves to doneNoPrf and never calls prfWrap when the authenticator has no PRF support", async () => {
    const credential = { toJSON: vi.fn().mockReturnValue({ id: "cred-1" }) };
    (global.navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      credential,
    );
    const assertion = {
      toJSON: vi.fn().mockReturnValue({ id: "assertion-1" }),
      getClientExtensionResults: vi.fn().mockReturnValue({}),
    };
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(assertion);

    const onStep = vi.fn();
    await enrollPasskey("My passkey", onStep);

    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["step1", "step2", "doneNoPrf"]);
    expect(mockPrfWrap).not.toHaveBeenCalled();
  });

  it("resolves a step-2 get() rejection to doneNoPrf, never cancelled/failed (Pitfall 3 regression)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const credential = { toJSON: vi.fn().mockReturnValue({ id: "cred-1" }) };
    (global.navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      credential,
    );
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException("dismissed", "NotAllowedError"),
    );

    const onStep = vi.fn();
    await enrollPasskey("My passkey", onStep);

    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["step1", "step2", "doneNoPrf"]);
    expect(mockPrfWrap).not.toHaveBeenCalled();
    // IN-03: an expected user dismissal is not a "real" failure — it must
    // not be logged as one.
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("resolves a genuine prfWrap failure to doneNoPrf but logs it distinctly from 'no PRF support' (IN-03)", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const credential = { toJSON: vi.fn().mockReturnValue({ id: "cred-1" }) };
    (global.navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(
      credential,
    );
    const assertion = {
      toJSON: vi.fn().mockReturnValue({ id: "assertion-1" }),
      getClientExtensionResults: vi.fn().mockReturnValue({
        prf: { results: { first: new ArrayBuffer(32) } },
      }),
    };
    (global.navigator.credentials.get as ReturnType<typeof vi.fn>).mockResolvedValue(assertion);
    const wrapError = new Error("server rejected prf-wrap: assertion verification failed");
    mockPrfWrap.mockRejectedValue(wrapError);

    const onStep = vi.fn();
    await enrollPasskey("My passkey", onStep);

    // Outward UI behavior is unchanged (Pitfall 3: the step-1 credential
    // already exists, so this still reports as a successful, no-PRF
    // enrollment) — only the observability signal is new.
    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["step1", "step2", "doneNoPrf"]);
    // A genuine wrap/verification failure — as opposed to the authenticator
    // honestly having no PRF support — must be distinguishable in the logs.
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0][0]).toMatch(/prf wrap failed/i);
    expect(consoleErrorSpy.mock.calls[0][1]).toBe(wrapError);
    consoleErrorSpy.mockRestore();
  });

  it("resolves a step-1 create() NotAllowedError rejection to cancelled", async () => {
    (global.navigator.credentials.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DOMException("dismissed", "NotAllowedError"),
    );

    const onStep = vi.fn();
    await enrollPasskey("My passkey", onStep);

    expect(onStep.mock.calls.map((c) => c[0])).toEqual(["step1", "cancelled"]);
    expect(mockRegisterFinish).not.toHaveBeenCalled();
  });

  it("throws before any network call when the vault is locked", async () => {
    mockGetUnlockedUserKey.mockReturnValue(null);
    const onStep = vi.fn();

    await expect(enrollPasskey("My passkey", onStep)).rejects.toThrow(
      "vault must be unlocked to enroll a passkey",
    );
    expect(mockRegisterStart).not.toHaveBeenCalled();
    expect(onStep).not.toHaveBeenCalled();
  });
});
