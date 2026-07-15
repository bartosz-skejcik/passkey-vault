import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockGetSessionToken, mockIsOnboardingComplete, mockUseIsUnlocked } = vi.hoisted(() => ({
  mockGetSessionToken: vi.fn(),
  mockIsOnboardingComplete: vi.fn(),
  // Plan 09-06: mutable (not a fixed `() => true`) so the
  // panel=settings/action=new-item deep-link tests below can simulate
  // "locked at load, applies once after unlock" without a second mock
  // module for the same target.
  mockUseIsUnlocked: vi.fn(() => true),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionToken: mockGetSessionToken,
}));

vi.mock("@/lib/onboarding/flag", () => ({
  isOnboardingComplete: mockIsOnboardingComplete,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/crypto", () => ({
  initCrypto: () => Promise.resolve(),
  lockVault: vi.fn(),
  useIsUnlocked: mockUseIsUnlocked,
}));

vi.mock("@/lib/idle/useIdleTimer", () => ({
  useIdleTimer: () => {},
}));

vi.mock("@/lib/idle/autolock", () => ({
  AUTOLOCK_CHANGED_EVENT: "pv-autolock-changed",
  DEFAULT_AUTOLOCK_MINUTES: "15",
  readAutolockMinutes: () => 15,
}));

vi.mock("@/lib/vault/store", () => ({
  useVaultItems: () => [],
}));

vi.mock("@/lib/vault/remoteDelete", () => ({
  wasRemotelyDeleted: () => false,
}));

vi.mock("@/lib/vault/errorToast", () => ({
  showErrorToast: vi.fn(),
}));

// Every heavy shell/vault child is shallow-mocked -- this test exercises
// only page.tsx's own authed/mode/showOnboarding wiring, not any child
// component's internals (each already has its own dedicated test file).
vi.mock("@/components/shell/Sidebar", () => ({ default: () => <div data-testid="mock-sidebar" /> }));
vi.mock("@/components/shell/TopBar", () => ({ default: () => <div data-testid="mock-topbar" /> }));
vi.mock("@/components/shell/MainColumn", () => ({
  default: ({ children }: { children: ReactNode }) => (
    <div data-testid="mock-main-column">{children}</div>
  ),
}));
vi.mock("@/components/vault/ItemList", () => ({ default: () => <div data-testid="mock-item-list" /> }));
vi.mock("@/components/vault/DetailPanel", () => ({ default: () => null }));
vi.mock("@/components/vault/TypePicker", () => ({ default: () => null }));
vi.mock("@/components/vault/ItemForm", () => ({
  default: ({ type }: { type: string }) => <div data-testid="mock-item-form" data-type={type} />,
}));
vi.mock("@/components/vault/CopyToast", () => ({ default: () => null }));
vi.mock("@/components/vault/ErrorToast", () => ({ default: () => null }));
vi.mock("@/components/settings/SettingsPanel", () => ({
  default: () => <div data-testid="mock-settings-panel" />,
}));
vi.mock("@/components/auth/UnlockOverlay", () => ({ default: () => null }));

vi.mock("@/components/auth/LoginForm", () => ({
  default: ({ onToggle, onAuthed }: { onToggle: () => void; onAuthed?: () => void }) => (
    <div data-testid="mock-login-form">
      <button type="button" data-testid="mock-login-toggle" onClick={onToggle}>
        toggle
      </button>
      <button type="button" data-testid="mock-login-authed" onClick={onAuthed}>
        authed
      </button>
    </div>
  ),
}));

vi.mock("@/components/auth/RegisterForm", () => ({
  default: ({ onToggle, onAuthed }: { onToggle: () => void; onAuthed?: () => void }) => (
    <div data-testid="mock-register-form">
      <button type="button" data-testid="mock-register-toggle" onClick={onToggle}>
        toggle
      </button>
      <button type="button" data-testid="mock-register-authed" onClick={onAuthed}>
        authed
      </button>
    </div>
  ),
}));

vi.mock("@/components/onboarding/OnboardingWizard", () => ({
  default: ({ onFinish }: { onFinish: () => void }) => (
    <div data-testid="mock-onboarding-wizard">
      <button type="button" data-testid="mock-onboarding-finish" onClick={onFinish}>
        finish
      </button>
    </div>
  ),
}));

import Home from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionToken.mockReturnValue(null);
  mockIsOnboardingComplete.mockReturnValue(false);
  mockUseIsUnlocked.mockReturnValue(true);
  window.history.pushState({}, "", "/");
});

describe("Home (page.tsx) onboarding wiring", () => {
  it("shows OnboardingWizard after a successful registration when isOnboardingComplete() is false", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("mock-login-form")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("mock-login-toggle"));
    expect(screen.getByTestId("mock-register-form")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-register-authed"));

    expect(screen.getByTestId("mock-onboarding-wizard")).toBeInTheDocument();
  });

  it("never shows OnboardingWizard after a login, regardless of the flag's value", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("mock-login-form")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("mock-login-authed"));

    expect(screen.queryByTestId("mock-onboarding-wizard")).not.toBeInTheDocument();
  });

  it("does not show OnboardingWizard on registration when isOnboardingComplete() already returns true", async () => {
    mockIsOnboardingComplete.mockReturnValue(true);
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("mock-login-form")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("mock-login-toggle"));
    fireEvent.click(screen.getByTestId("mock-register-authed"));

    expect(screen.queryByTestId("mock-onboarding-wizard")).not.toBeInTheDocument();
  });

  it("OnboardingWizard's onFinish hides it and reveals the normal vault shell underneath", async () => {
    render(<Home />);
    await waitFor(() => expect(screen.getByTestId("mock-login-form")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("mock-login-toggle"));
    fireEvent.click(screen.getByTestId("mock-register-authed"));
    expect(screen.getByTestId("mock-onboarding-wizard")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("mock-onboarding-finish"));

    expect(screen.queryByTestId("mock-onboarding-wizard")).not.toBeInTheDocument();
    expect(screen.getByTestId("mock-main-column")).toBeInTheDocument();
  });
});

// Plan 09-06: receiving end of the popup's "Popup header + delegated-
// management affordances" redirects (`${baseUrl}/?panel=settings` and
// `${baseUrl}/?action=new-item`) -- without this, those deep-links land
// on a bare vault root.
describe("Home (page.tsx) — panel=settings / action=new-item query params (Plan 09-06)", () => {
  it("opens the Settings panel on mount when the URL has panel=settings and the vault is already unlocked, then strips the param", async () => {
    mockGetSessionToken.mockReturnValue("token");
    window.history.pushState({}, "", "/?panel=settings");

    render(<Home />);

    await waitFor(() => expect(screen.getByTestId("mock-settings-panel")).toBeInTheDocument());
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("opens the new-item flow on mount when the URL has action=new-item and the vault is already unlocked, then strips the param", async () => {
    mockGetSessionToken.mockReturnValue("token");
    window.history.pushState({}, "", "/?action=new-item");

    render(<Home />);

    await waitFor(() => expect(screen.getByTestId("type-picker-close")).toBeInTheDocument());
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("waits for unlock before applying a pending panel=settings param, then applies it once unlock completes", async () => {
    mockGetSessionToken.mockReturnValue("token");
    mockUseIsUnlocked.mockReturnValue(false);
    window.history.pushState({}, "", "/?panel=settings");

    const { rerender } = render(<Home />);

    expect(screen.queryByTestId("mock-settings-panel")).not.toBeInTheDocument();

    mockUseIsUnlocked.mockReturnValue(true);
    rerender(<Home />);

    await waitFor(() => expect(screen.getByTestId("mock-settings-panel")).toBeInTheDocument());
  });

  it("does nothing when neither query param is present", async () => {
    mockGetSessionToken.mockReturnValue("token");
    window.history.pushState({}, "", "/");

    render(<Home />);

    await waitFor(() => expect(screen.getByTestId("mock-main-column")).toBeInTheDocument());
    expect(screen.queryByTestId("mock-settings-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("type-picker-close")).not.toBeInTheDocument();
  });

  // Post-UAT (Bartek 2026-07-15): the popup's in-popup type MENU (NordPass
  // pattern) redirects straight to `?action=new-item&type=<id>` -- the type
  // must be preselected here so the fullscreen editor skips its own
  // TypePicker step (the popup already made the type choice).
  it("preselects the item type and skips the TypePicker when the URL has action=new-item&type=<id>", async () => {
    mockGetSessionToken.mockReturnValue("token");
    window.history.pushState({}, "", "/?action=new-item&type=login");

    render(<Home />);

    await waitFor(() => expect(screen.getByTestId("mock-item-form")).toBeInTheDocument());
    expect(screen.getByTestId("mock-item-form")).toHaveAttribute("data-type", "login");
    expect(screen.queryByTestId("type-picker-close")).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("falls back to the TypePicker when the URL's type param isn't a recognized item type", async () => {
    mockGetSessionToken.mockReturnValue("token");
    window.history.pushState({}, "", "/?action=new-item&type=bogus");

    render(<Home />);

    await waitFor(() => expect(screen.getByTestId("type-picker-close")).toBeInTheDocument());
    expect(screen.queryByTestId("mock-item-form")).not.toBeInTheDocument();
  });
});
