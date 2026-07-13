import { beforeEach, describe, expect, it, vi } from "vitest";
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
  mockMe,
  mockPrelogin,
  mockBase64Decode,
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
  mockMe: vi.fn(),
  mockPrelogin: vi.fn(),
  mockBase64Decode: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionToken.mockReturnValue("session-token");
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
    fireEvent.click(screen.getByTestId("unlock-submit"));

    await waitFor(() => expect(mockSetUnlockedUserKey).toHaveBeenCalledTimes(1));
    expect(mockUnwrapUserKey).toHaveBeenCalledWith(
      expect.anything(),
      "wrapped-uk-json",
    );
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
});
