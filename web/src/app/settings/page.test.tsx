import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

// Mock set combines page.test.tsx's own auth/unlock wiring (Pitfall 1's
// zero-session-mount closure) with SettingsPanel.test.tsx's shallow-mock
// set (heavy children with their own dedicated test files) -- letting
// PasskeysTab/SessionsTab/SecurityTab AND (per this task's own literal
// requirement) LoginForm/RegisterForm render for real, per
// 29-PATTERNS.md's/29-01-PLAN.md's explicit instruction.
const { mockGetSessionToken, mockUseIsUnlocked, mockListPasskeys, mockListSessions } = vi.hoisted(
  () => ({
    mockGetSessionToken: vi.fn(),
    // Mutable, defaulting to true (per plan) -- unlike page.test.tsx's own
    // default, this suite never needs to exercise the locked/blurred branch.
    mockUseIsUnlocked: vi.fn(() => true),
    mockListPasskeys: vi.fn(),
    mockListSessions: vi.fn(),
  }),
);

vi.mock("@/lib/auth/session", () => ({
  getSessionToken: mockGetSessionToken,
  setSessionToken: vi.fn(),
  clearSessionToken: vi.fn(),
  getStoredEmail: () => null,
  setStoredEmail: vi.fn(),
  clearStoredEmail: vi.fn(),
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
  useIsUnlocked: mockUseIsUnlocked,
}));

vi.mock("@/lib/passkeys/api", () => ({
  listPasskeys: mockListPasskeys,
  renamePasskey: vi.fn(),
  deletePasskey: vi.fn(),
}));

vi.mock("@/lib/sessions/api", () => ({
  listSessions: mockListSessions,
  revokeSession: vi.fn(),
}));

// Heavy children with their own dedicated test files -- shallow-mocked so
// this stays a fast, focused test of the /settings page shell wiring, same
// precedent as SettingsPanel.test.tsx.
vi.mock("@/components/settings/FamilyTab", () => ({
  default: () => <div data-testid="mock-family-tab" />,
}));

vi.mock("@/components/vault/ImportWizard", () => ({
  default: () => <div data-testid="mock-import-wizard" />,
}));

vi.mock("@/components/vault/ExportDialog", () => ({
  default: () => <div data-testid="mock-export-dialog" />,
}));

import SettingsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseIsUnlocked.mockReturnValue(true);
  mockListPasskeys.mockResolvedValue([]);
  mockListSessions.mockResolvedValue([]);
});

describe("/settings page", () => {
  it("shows the login AuthCard and renders NO settings content for a zero-session mount (Pitfall 1)", () => {
    mockGetSessionToken.mockReturnValue(null);

    render(<SettingsPage />);

    // Real, non-mocked-away LoginForm element.
    expect(screen.getByTestId("login-email")).toBeInTheDocument();
    expect(screen.getByTestId("login-submit")).toBeInTheDocument();

    expect(screen.queryByTestId("settings-section-konto")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-bezpieczenstwo")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-dane")).not.toBeInTheDocument();
    expect(screen.queryByTestId("settings-section-rodzina")).not.toBeInTheDocument();
  });

  it("renders all four headed sections with zero interaction for a session mount", async () => {
    mockGetSessionToken.mockReturnValue("token");

    render(<SettingsPage />);

    await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("settings-section-konto")).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-bezpieczenstwo")).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-dane")).toBeInTheDocument();
    expect(screen.getByTestId("settings-section-rodzina")).toBeInTheDocument();

    // Each group label appears twice (the <h2> heading + its jump-nav
    // link) -- getAllByText, not getByText, to avoid a strict-mode clash.
    expect(screen.getAllByText("settings.groupAccount").length).toBeGreaterThan(0);
    expect(screen.getAllByText("settings.groupSecurity").length).toBeGreaterThan(0);
    expect(screen.getAllByText("settings.groupData").length).toBeGreaterThan(0);
    expect(screen.getAllByText("settings.groupFamily").length).toBeGreaterThan(0);
  });

  it("renders the four <h2> group headings in DOM order Konto -> Bezpieczeństwo -> Dane -> Rodzina i udostępnianie", async () => {
    mockGetSessionToken.mockReturnValue("token");

    render(<SettingsPage />);
    await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      "settings.groupAccount",
      "settings.groupSecurity",
      "settings.groupData",
      "settings.groupFamily",
    ]);
  });

  it("renders the jump-nav landmark with exactly four links in order konto/bezpieczenstwo/dane/rodzina", async () => {
    mockGetSessionToken.mockReturnValue("token");

    render(<SettingsPage />);
    await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));

    const nav = screen.getByRole("navigation", { name: "settings.jumpNavLabel" });
    const links = within(nav).getAllByRole("link");
    expect(links).toHaveLength(4);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "#konto",
      "#bezpieczenstwo",
      "#dane",
      "#rodzina",
    ]);
  });

  it("renders the back-to-vault link as a real anchor to /", async () => {
    mockGetSessionToken.mockReturnValue("token");

    render(<SettingsPage />);
    await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));

    const backLink = screen.getByTestId("settings-back-to-vault");
    expect(backLink.tagName).toBe("A");
    expect(backLink.getAttribute("href")).toBe("/");
  });

  // T-29-13 (29-SECURITY.md): the register-corrections section of that audit
  // found this exact gap -- SettingsShell mounts all four sections
  // unconditionally, and PasskeysTab/SessionsTab fetched from a bare
  // `useEffect(..., [])` with no unlock guard. A locked-but-authenticated
  // deep link to /settings therefore issued GET /api/passkeys and
  // GET /api/sessions and painted real rows into the DOM behind nothing but
  // a cosmetic `blur-md`. This is the top-level assertion that matters: the
  // document itself must contain none of the sensitive strings, and neither
  // endpoint may be called, while locked.
  it("does not fetch or render passkey/session data for a session mount with a locked vault (T-29-13)", async () => {
    mockGetSessionToken.mockReturnValue("token");
    mockUseIsUnlocked.mockReturnValue(false);
    mockListPasskeys.mockResolvedValue([
      {
        id: "pk-1",
        name: "Sensitive YubiKey Label",
        prf_capable: true,
        created_at: "2026-07-14 09:00:00",
        last_used_at: null,
      },
    ]);
    mockListSessions.mockResolvedValue([
      {
        id: "sess-1",
        user_agent: "SensitiveSessionUA/1.0",
        created_at: "2026-07-14 08:00:00",
        last_used_at: null,
        current: false,
      },
    ]);

    render(<SettingsPage />);

    // Give any (incorrectly firing) effect a turn of the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    expect(mockListPasskeys).not.toHaveBeenCalled();
    expect(mockListSessions).not.toHaveBeenCalled();
    expect(screen.queryByText("Sensitive YubiKey Label")).not.toBeInTheDocument();
    expect(screen.queryByText("SensitiveSessionUA/1.0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("passkey-row-pk-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("session-row-sess-1")).not.toBeInTheDocument();

    // The unlock affordance must still be reachable -- this is a gate, not
    // a dead end.
    expect(screen.getByTestId("unlock-password")).toBeInTheDocument();
  });
});
