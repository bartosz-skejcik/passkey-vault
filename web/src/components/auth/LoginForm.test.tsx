import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockDeriveAuthMaterial,
  mockPrelogin,
  mockLogin,
  mockBase64Encode,
  mockBase64Decode,
  mockSetSessionToken,
  mockSetStoredEmail,
  mockSetPendingUnlock,
} = vi.hoisted(() => ({
  mockDeriveAuthMaterial: vi.fn(),
  mockPrelogin: vi.fn(),
  mockLogin: vi.fn(),
  mockBase64Encode: vi.fn(),
  mockBase64Decode: vi.fn(),
  mockSetSessionToken: vi.fn(),
  mockSetStoredEmail: vi.fn(),
  mockSetPendingUnlock: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  initCrypto: () => Promise.resolve(),
  deriveAuthMaterial: mockDeriveAuthMaterial,
}));

vi.mock("@/lib/auth/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/api")>("@/lib/auth/api");
  return {
    ...actual,
    prelogin: mockPrelogin,
    login: mockLogin,
    base64Encode: mockBase64Encode,
    base64Decode: mockBase64Decode,
  };
});

vi.mock("@/lib/auth/session", () => ({
  setSessionToken: mockSetSessionToken,
  setStoredEmail: mockSetStoredEmail,
}));

vi.mock("@/lib/auth/pendingUnlock", () => ({
  setPendingUnlock: mockSetPendingUnlock,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import LoginForm from "./LoginForm";
import { ApiClientError } from "@/lib/auth/api";

function fillForm(email: string, password: string) {
  fireEvent.change(screen.getByTestId("login-email"), { target: { value: email } });
  fireEvent.change(screen.getByTestId("login-password"), { target: { value: password } });
}

const FAKE_WRAPPING_KEY = { free: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockBase64Encode.mockImplementation((bytes: Uint8Array) => `b64:${bytes.length}`);
  mockBase64Decode.mockReturnValue(new Uint8Array(16));
  mockPrelogin.mockResolvedValue({
    kdf: { m_cost_kib: 65536, t_cost: 3, p_cost: 4 },
    salt: "c2FsdA==",
  });
  const material = {
    takeAuthHash: vi.fn().mockReturnValue(new Uint8Array(32)),
    takeWrappingKey: vi.fn().mockReturnValue(FAKE_WRAPPING_KEY),
    free: vi.fn(),
  };
  mockDeriveAuthMaterial.mockReturnValue(material);
  mockLogin.mockResolvedValue({ session_token: "session-token", pw_wrapped_uk: "wrapped-uk-json" });
});

describe("LoginForm", () => {
  it("derives once against prelogin's salt/kdf, then stashes the pending unlock instead of unwrapping directly", async () => {
    const onAuthed = vi.fn();
    render(<LoginForm onToggle={() => {}} onAuthed={onAuthed} />);

    fillForm("existing@example.com", "correcthorsebattery1");
    fireEvent.click(screen.getByTestId("login-submit"));

    await waitFor(() => expect(mockSetPendingUnlock).toHaveBeenCalled());

    expect(mockPrelogin).toHaveBeenCalledWith("existing@example.com");
    expect(mockDeriveAuthMaterial).toHaveBeenCalledTimes(1);
    expect(mockLogin).toHaveBeenCalledWith({
      email: "existing@example.com",
      auth_hash: "b64:32",
    });
    expect(mockSetSessionToken).toHaveBeenCalledWith("session-token");
    expect(mockSetStoredEmail).toHaveBeenCalledWith("existing@example.com");
    expect(mockSetPendingUnlock).toHaveBeenCalledWith(FAKE_WRAPPING_KEY, "wrapped-uk-json");
    // Regresja z UAT: bez onAuthed page.tsx zostawał na formularzu logowania.
    await waitFor(() => expect(onAuthed).toHaveBeenCalledTimes(1));
  });

  it("surfaces a 401 as a single generic inline error, not an unhandled rejection", async () => {
    mockLogin.mockRejectedValue(new ApiClientError(401, "unauthorized"));
    render(<LoginForm onToggle={() => {}} />);

    fillForm("wrong@example.com", "wrongpassword");
    fireEvent.click(screen.getByTestId("login-submit"));

    expect(await screen.findByText("auth.wrongCredentials")).toBeInTheDocument();
    expect(mockSetPendingUnlock).not.toHaveBeenCalled();
    expect(mockSetSessionToken).not.toHaveBeenCalled();
  });
});
