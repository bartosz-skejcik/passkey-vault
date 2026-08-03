import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockUseIsUnlocked,
  mockSetUnlockedUserKey,
  mockUnwrapUserKey,
  mockDeriveAuthMaterial,
  mockGetSessionToken,
  mockClearSessionToken,
  mockClearStoredEmail,
  mockGetStoredEmail,
  mockTakePendingUnlock,
  mockTakePrfUnavailableHint,
  mockMe,
  mockPrelogin,
  mockBase64Decode,
  mockPasskeyUnlock,
} = vi.hoisted(() => ({
  mockUseIsUnlocked: vi.fn(),
  mockSetUnlockedUserKey: vi.fn(),
  mockUnwrapUserKey: vi.fn(),
  mockDeriveAuthMaterial: vi.fn(),
  mockGetSessionToken: vi.fn(),
  mockClearSessionToken: vi.fn(),
  mockClearStoredEmail: vi.fn(),
  mockGetStoredEmail: vi.fn(),
  mockTakePendingUnlock: vi.fn(),
  mockTakePrfUnavailableHint: vi.fn(),
  mockMe: vi.fn(),
  mockPrelogin: vi.fn(),
  mockBase64Decode: vi.fn(),
  mockPasskeyUnlock: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  initCrypto: () => Promise.resolve(),
  useIsUnlocked: mockUseIsUnlocked,
  setUnlockedUserKey: mockSetUnlockedUserKey,
  unwrapUserKey: mockUnwrapUserKey,
  deriveAuthMaterial: mockDeriveAuthMaterial,
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionToken: mockGetSessionToken,
  clearSessionToken: mockClearSessionToken,
  clearStoredEmail: mockClearStoredEmail,
  getStoredEmail: mockGetStoredEmail,
}));

vi.mock("@/lib/auth/pendingUnlock", () => ({
  takePendingUnlock: mockTakePendingUnlock,
}));

vi.mock("@/lib/auth/prfUnavailable", () => ({
  takePrfUnavailableHint: mockTakePrfUnavailableHint,
}));

vi.mock("@/lib/passkeys/login", () => ({
  passkeyUnlock: mockPasskeyUnlock,
}));

vi.mock("@/lib/auth/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/api")>("@/lib/auth/api");
  return {
    ...actual,
    me: mockMe,
    prelogin: mockPrelogin,
    base64Decode: mockBase64Decode,
  };
});

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import UnlockOverlay from "./UnlockOverlay";

const originalPublicKeyCredential = (global as unknown as { PublicKeyCredential?: unknown })
  .PublicKeyCredential;

beforeEach(() => {
  vi.clearAllMocks();
  (global as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = {};
  mockGetSessionToken.mockReturnValue("session-token");
  mockTakePrfUnavailableHint.mockReturnValue(false);
  mockPasskeyUnlock.mockResolvedValue({ prfUnavailable: false });
});

afterEach(() => {
  (global as unknown as { PublicKeyCredential?: unknown }).PublicKeyCredential =
    originalPublicKeyCredential;
});

describe("UnlockOverlay", () => {
  it("renders nothing when the vault is already unlocked", () => {
    mockUseIsUnlocked.mockReturnValue(true);
    const { container } = render(<UnlockOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when there is no session token", () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockGetSessionToken.mockReturnValue(null);
    const { container } = render(<UnlockOverlay />);
    expect(container).toBeEmptyDOMElement();
  });

  it("one-click unlocks from pending material without a password prompt", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue({
      wrappingKey: { free: vi.fn() },
      pwWrappedUk: "wrapped-uk-json",
    });
    mockUnwrapUserKey.mockReturnValue({ free: vi.fn() });

    render(<UnlockOverlay />);

    expect(screen.queryByTestId("unlock-password")).not.toBeInTheDocument();
    expect(screen.queryByTestId("passkey-unlock-button")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unlock-submit"));

    await waitFor(() => expect(mockSetUnlockedUserKey).toHaveBeenCalledTimes(1));
    expect(mockUnwrapUserKey).toHaveBeenCalledWith(
      expect.anything(),
      "wrapped-uk-json",
    );
  });

  it("WR-02: on a failed pending unlock, shows the error, clears the pending material, falls back to the password form, and never re-invokes the freed wasm handle on a second click", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    const freeMock = vi.fn();
    mockTakePendingUnlock.mockReturnValue({
      wrappingKey: { free: freeMock },
      pwWrappedUk: "wrapped-uk-json",
    });
    mockUnwrapUserKey.mockImplementation(() => {
      throw new Error("corrupt pw_wrapped_uk");
    });

    render(<UnlockOverlay />);

    // Starts on the one-click pending fast path — no password field yet.
    expect(screen.queryByTestId("unlock-password")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("unlock-submit"));

    // Failure must be visible (previously silent — no `{error}` render
    // existed in the pending branch's JSX).
    expect(await screen.findByText("auth.loginFailed")).toBeInTheDocument();
    expect(freeMock).toHaveBeenCalledTimes(1);
    expect(mockSetUnlockedUserKey).not.toHaveBeenCalled();
    expect(mockUnwrapUserKey).toHaveBeenCalledTimes(1);

    // Falls through to the password form once `pending` is cleared — the
    // fast-path button/branch is gone, replaced by the standard password
    // form (a re-render, not a page reload).
    await waitFor(() => expect(screen.getByTestId("unlock-password")).toBeInTheDocument());

    // A second click now hits the password form's own submit handler, never
    // the freed wrappingKey handle — must not throw ("null pointer passed to
    // rust" was the WR-02 symptom before this fix).
    fireEvent.change(screen.getByTestId("unlock-password"), {
      target: { value: "correcthorsebattery1" },
    });
    expect(() => fireEvent.click(screen.getByTestId("unlock-submit"))).not.toThrow();
    // The freed pending wrappingKey is never touched again.
    expect(mockUnwrapUserKey).toHaveBeenCalledTimes(1);
    expect(freeMock).toHaveBeenCalledTimes(1);
  });

  it("shows a password field and unwraps via me()+prelogin() when no pending material exists", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue(null);
    mockGetStoredEmail.mockReturnValue("existing@example.com");
    mockMe.mockResolvedValue({
      user_id: "u1",
      email: "existing@example.com",
      pw_wrapped_uk: "wrapped-uk-json",
    });
    mockPrelogin.mockResolvedValue({
      kdf: { m_cost_kib: 65536, t_cost: 3, p_cost: 4 },
      salt: "c2FsdA==",
    });
    mockBase64Decode.mockReturnValue(new Uint8Array(16));
    const material = {
      takeWrappingKey: vi.fn().mockReturnValue({ free: vi.fn() }),
      takeAuthHash: vi.fn().mockReturnValue(new Uint8Array(32)),
      free: vi.fn(),
    };
    mockDeriveAuthMaterial.mockReturnValue(material);
    mockUnwrapUserKey.mockReturnValue({ free: vi.fn() });

    render(<UnlockOverlay />);

    fireEvent.change(screen.getByTestId("unlock-password"), {
      target: { value: "correcthorsebattery1" },
    });
    fireEvent.click(screen.getByTestId("unlock-submit"));

    await waitFor(() => expect(mockSetUnlockedUserKey).toHaveBeenCalledTimes(1));
    expect(mockMe).toHaveBeenCalledTimes(1);
    expect(mockPrelogin).toHaveBeenCalledWith("existing@example.com");
  });

  it("clears the session and forces a re-render into the unauthenticated state on a 401 from me()", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue(null);
    mockGetStoredEmail.mockReturnValue("existing@example.com");
    const { ApiClientError } = await import("@/lib/auth/api");
    mockMe.mockRejectedValue(new ApiClientError(401, "unauthorized"));

    render(<UnlockOverlay />);

    fireEvent.change(screen.getByTestId("unlock-password"), {
      target: { value: "correcthorsebattery1" },
    });
    fireEvent.click(screen.getByTestId("unlock-submit"));

    await waitFor(() => expect(mockClearSessionToken).toHaveBeenCalledTimes(1));
    expect(mockClearStoredEmail).toHaveBeenCalledTimes(1);
    expect(mockSetUnlockedUserKey).not.toHaveBeenCalled();
  });

  it("renders the passkey button in the pending === null branch when WebAuthn is supported", () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue(null);

    render(<UnlockOverlay />);

    expect(screen.getByTestId("passkey-unlock-button")).toBeInTheDocument();
  });

  it("shows the tier-1 explainer instead of the button when window.PublicKeyCredential is undefined", () => {
    (global as unknown as { PublicKeyCredential: unknown }).PublicKeyCredential = undefined;
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue(null);

    render(<UnlockOverlay />);

    expect(screen.queryByTestId("passkey-unlock-button")).not.toBeInTheDocument();
    expect(screen.getByText("unlock.passkeyUnsupported")).toBeInTheDocument();
  });

  it("shows the PRF-unavailable explainer and autofocuses the password field when takePrfUnavailableHint() returns true at mount", () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue(null);
    mockTakePrfUnavailableHint.mockReturnValue(true);

    render(<UnlockOverlay />);

    expect(screen.getByText("unlock.prfUnavailableExplainer")).toBeInTheDocument();
    expect(screen.getByTestId("unlock-password")).toHaveFocus();
  });

  it("shows unlock.passkeyFailed on a genuine passkeyUnlock rejection", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue(null);
    mockPasskeyUnlock.mockRejectedValue(new Error("network error"));

    render(<UnlockOverlay />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    expect(await screen.findByText("unlock.passkeyFailed")).toBeInTheDocument();
    expect(mockSetUnlockedUserKey).not.toHaveBeenCalled();
  });

  // Production bug 260803-cnd (Bartek, vault.blonie.cloud): POST
  // /api/passkeys/unlock/start returned 401 once the fixed 7-day session TTL
  // expired -- his passkey/PRF enrollment was completely healthy the whole
  // time, but handlePasskeyUnlock's bare catch showed unlock.passkeyFailed
  // ("couldn't use your passkey"), telling him the wrong thing was broken.
  // This test would genuinely fail if that fix were reverted: without the
  // 401 branch, passkeyUnlock's rejection falls into the generic catch and
  // renders unlock.passkeyFailed instead of clearing the dead session.
  it("260803-cnd: a 401 from passkeyUnlock (expired session) clears the session instead of showing unlock.passkeyFailed", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue(null);
    const { ApiClientError } = await import("@/lib/auth/api");
    mockPasskeyUnlock.mockRejectedValue(new ApiClientError(401, "unauthorized"));

    render(<UnlockOverlay />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    // Mirrors the existing "clears the session ... on a 401 from me()" test
    // above (unlockFromPassword's own 401 path) — jsdom doesn't implement
    // real navigation, so window.location.reload() is a caught no-op here
    // (see Sidebar.test.tsx's own comment on the same jsdom behavior); the
    // session-clearing calls are what's actually asserted.
    await waitFor(() => expect(mockClearSessionToken).toHaveBeenCalledTimes(1));
    expect(mockClearStoredEmail).toHaveBeenCalledTimes(1);
    expect(mockSetUnlockedUserKey).not.toHaveBeenCalled();
    expect(screen.queryByText("unlock.passkeyFailed")).not.toBeInTheDocument();
  });

  it("shows no error text when passkeyUnlock resolves a silent cancellation", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue(null);
    mockPasskeyUnlock.mockResolvedValue({ prfUnavailable: false });

    render(<UnlockOverlay />);
    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    await waitFor(() => expect(mockPasskeyUnlock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("unlock.passkeyFailed")).not.toBeInTheDocument();
  });

  it("surfaces the PRF-unavailable explainer in the same session when passkeyUnlock resolves { prfUnavailable: true } (e.g. a same-session 404/null), without a page reload", async () => {
    mockUseIsUnlocked.mockReturnValue(false);
    mockTakePendingUnlock.mockReturnValue(null);
    mockPasskeyUnlock.mockResolvedValue({ prfUnavailable: true });

    render(<UnlockOverlay />);
    expect(screen.queryByText("unlock.prfUnavailableExplainer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("passkey-unlock-button"));

    await waitFor(() =>
      expect(screen.getByText("unlock.prfUnavailableExplainer")).toBeInTheDocument(),
    );
  });
});
