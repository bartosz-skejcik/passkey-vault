import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockLockVault, mockLogout, mockClearSessionToken, mockClearStoredEmail, mockSetLocale } =
  vi.hoisted(() => ({
    mockLockVault: vi.fn(),
    mockLogout: vi.fn(),
    mockClearSessionToken: vi.fn(),
    mockClearStoredEmail: vi.fn(),
    mockSetLocale: vi.fn(),
  }));

vi.mock("@/lib/crypto", () => ({
  lockVault: mockLockVault,
}));

vi.mock("@/lib/auth/api", () => ({
  logout: mockLogout,
}));

vi.mock("@/lib/auth/session", () => ({
  clearSessionToken: mockClearSessionToken,
  clearStoredEmail: mockClearStoredEmail,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: mockSetLocale,
    t: (key: string) => key,
  }),
}));

import Sidebar from "./Sidebar";

beforeEach(() => {
  vi.clearAllMocks();
  mockLogout.mockResolvedValue(undefined);
  // jsdom doesn't implement navigation — Sidebar's logout handler calls
  // window.location.reload(), which jsdom only logs (doesn't throw), same
  // as UnlockOverlay's 401 path.
});

describe("Sidebar settings dropdown", () => {
  it("calls lockVault() when 'Lock now' is clicked", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByTestId("sidebar-lock-now"));
    expect(mockLockVault).toHaveBeenCalledTimes(1);
  });

  it("calls logout() and clears session storage when 'Log out' is clicked", async () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByTestId("sidebar-logout"));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(mockClearSessionToken).toHaveBeenCalledTimes(1);
    expect(mockClearStoredEmail).toHaveBeenCalledTimes(1);
    expect(mockLockVault).toHaveBeenCalledTimes(1);
  });

  it("cycles the language via setLocale when the language switcher is clicked", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByTestId("sidebar-language"));
    expect(mockSetLocale).toHaveBeenCalledWith("en");
  });
});
