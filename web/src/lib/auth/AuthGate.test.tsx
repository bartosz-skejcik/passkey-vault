import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockGetSessionToken } = vi.hoisted(() => ({
  mockGetSessionToken: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionToken: mockGetSessionToken,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({ locale: "pl", setLocale: vi.fn(), t: (key: string) => key }),
}));

vi.mock("@/components/auth/LoginForm", () => ({
  default: () => <div data-testid="mock-login-form" />,
}));

vi.mock("@/components/auth/RegisterForm", () => ({
  default: () => <div data-testid="mock-register-form" />,
}));

import AuthGate from "./AuthGate";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuthGate", () => {
  it("renders children when a real, non-empty session token is present", async () => {
    mockGetSessionToken.mockReturnValue("real-token");
    render(
      <AuthGate>
        <div data-testid="protected-content">protected</div>
      </AuthGate>,
    );
    await waitFor(() => expect(screen.getByTestId("protected-content")).toBeInTheDocument());
  });

  it("renders the AuthCard (login form) when getSessionToken() returns null", async () => {
    mockGetSessionToken.mockReturnValue(null);
    render(
      <AuthGate>
        <div data-testid="protected-content">protected</div>
      </AuthGate>,
    );
    await waitFor(() => expect(screen.getByTestId("mock-login-form")).toBeInTheDocument());
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });

  // IN-02 (code review, Phase 29) falsification test: `localStorage.getItem`
  // returns `""` (NOT `null`) for an explicitly-stored empty-string value --
  // the pre-fix `getSessionToken() !== null` check alone resolved
  // `authed = true` for this case, a fail-open branch in a component whose
  // whole job is to fail closed. Confirmed to fail against the pre-fix
  // `setAuthed(getSessionToken() !== null)` implementation, which would
  // have rendered `protected-content` here instead of the AuthCard.
  it("IN-02 falsification: an empty-string session token (never null) must NOT be treated as authenticated", async () => {
    mockGetSessionToken.mockReturnValue("");
    render(
      <AuthGate>
        <div data-testid="protected-content">protected</div>
      </AuthGate>,
    );
    await waitFor(() => expect(screen.getByTestId("mock-login-form")).toBeInTheDocument());
    expect(screen.queryByTestId("protected-content")).not.toBeInTheDocument();
  });
});
