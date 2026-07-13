import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockDeriveAuthMaterial,
  mockGenerateUserKey,
  mockRandomSalt,
  mockDefaultKdfParamsJson,
  mockWrapUserKey,
  mockSetUnlockedUserKey,
  mockRegister,
  mockLogin,
  mockBase64Encode,
  mockSetSessionToken,
  mockSetStoredEmail,
} = vi.hoisted(() => ({
  mockDeriveAuthMaterial: vi.fn(),
  mockGenerateUserKey: vi.fn(),
  mockRandomSalt: vi.fn(),
  mockDefaultKdfParamsJson: vi.fn(),
  mockWrapUserKey: vi.fn(),
  mockSetUnlockedUserKey: vi.fn(),
  mockRegister: vi.fn(),
  mockLogin: vi.fn(),
  mockBase64Encode: vi.fn(),
  mockSetSessionToken: vi.fn(),
  mockSetStoredEmail: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  initCrypto: () => Promise.resolve(),
  deriveAuthMaterial: mockDeriveAuthMaterial,
  generateUserKey: mockGenerateUserKey,
  randomSalt: mockRandomSalt,
  defaultKdfParamsJson: mockDefaultKdfParamsJson,
  wrapUserKey: mockWrapUserKey,
  setUnlockedUserKey: mockSetUnlockedUserKey,
}));

vi.mock("@/lib/auth/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/api")>("@/lib/auth/api");
  return {
    ...actual,
    register: mockRegister,
    login: mockLogin,
    base64Encode: mockBase64Encode,
  };
});

vi.mock("@/lib/auth/session", () => ({
  setSessionToken: mockSetSessionToken,
  setStoredEmail: mockSetStoredEmail,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import RegisterForm from "./RegisterForm";
import { ApiClientError } from "@/lib/auth/api";

function fillForm(email: string, password: string, confirmPassword: string) {
  fireEvent.change(screen.getByTestId("register-email"), { target: { value: email } });
  fireEvent.change(screen.getByTestId("register-password"), { target: { value: password } });
  fireEvent.change(screen.getByTestId("register-confirm-password"), {
    target: { value: confirmPassword },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockBase64Encode.mockImplementation((bytes: Uint8Array) => `b64:${bytes.length}`);
  mockRandomSalt.mockReturnValue(new Uint8Array(16));
  mockDefaultKdfParamsJson.mockReturnValue('{"m_cost_kib":65536,"t_cost":3,"p_cost":4}');
  const material = {
    takeAuthHash: vi.fn().mockReturnValue(new Uint8Array(32)),
    takeWrappingKey: vi.fn().mockReturnValue({ free: vi.fn() }),
    free: vi.fn(),
  };
  mockDeriveAuthMaterial.mockReturnValue(material);
  mockGenerateUserKey.mockReturnValue({ free: vi.fn() });
  mockWrapUserKey.mockReturnValue("wrapped-uk-json");
  mockRegister.mockResolvedValue({ user_id: "user-1" });
  mockLogin.mockResolvedValue({ session_token: "session-token", pw_wrapped_uk: "wrapped-uk-json" });
});

describe("RegisterForm", () => {
  it("shows a mismatch validation error and fires no network call when passwords differ", async () => {
    render(<RegisterForm onToggle={() => {}} />);

    fillForm("new@example.com", "correcthorsebattery1", "correcthorsebattery2");
    fireEvent.click(screen.getByTestId("register-submit"));

    expect(await screen.findByText("validation.passwordMismatch")).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockDeriveAuthMaterial).not.toHaveBeenCalled();
  });

  it("derives auth material once, registers, logs in with the same auth_hash, and unlocks immediately", async () => {
    render(<RegisterForm onToggle={() => {}} />);

    fillForm("new@example.com", "correcthorsebattery1", "correcthorsebattery1");
    fireEvent.click(screen.getByTestId("register-submit"));

    await waitFor(() => expect(mockLogin).toHaveBeenCalled());

    expect(mockDeriveAuthMaterial).toHaveBeenCalledTimes(1);
    expect(mockRegister).toHaveBeenCalledTimes(1);
    expect(mockRegister.mock.calls[0][0].auth_hash).toBe(mockLogin.mock.calls[0][0].auth_hash);
    expect(mockSetSessionToken).toHaveBeenCalledWith("session-token");
    expect(mockSetStoredEmail).toHaveBeenCalledWith("new@example.com");
    expect(mockSetUnlockedUserKey).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 409 duplicate-email conflict as a field-level error", async () => {
    mockRegister.mockRejectedValue(new ApiClientError(409, "email already registered"));
    render(<RegisterForm onToggle={() => {}} />);

    fillForm("dup@example.com", "correcthorsebattery1", "correcthorsebattery1");
    fireEvent.click(screen.getByTestId("register-submit"));

    expect(await screen.findByText("auth.duplicateEmail")).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
    expect(mockSetUnlockedUserKey).not.toHaveBeenCalled();
  });
});
