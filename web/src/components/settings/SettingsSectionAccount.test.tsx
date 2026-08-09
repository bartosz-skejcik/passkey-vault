import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockListPasskeys, mockListSessions } = vi.hoisted(() => ({
  mockListPasskeys: vi.fn(),
  mockListSessions: vi.fn(),
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

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

// Plan 25-09 (E6)/Phase 29 Task 2: DeleteAccountDialog has its own
// dedicated, exhaustive test file -- shallow-mocked here so this stays a
// fast, focused unit test of SettingsSectionAccount's own wiring, matching
// SecurityTab.test.tsx's original (pre-relocation) precedent verbatim.
vi.mock("./DeleteAccountDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-delete-account-dialog">
      <button type="button" data-testid="mock-delete-account-dialog-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

import SettingsSectionAccount from "./SettingsSectionAccount";

beforeEach(() => {
  vi.clearAllMocks();
  mockListPasskeys.mockResolvedValue([]);
  mockListSessions.mockResolvedValue([]);
});

describe("SettingsSectionAccount", () => {
  it("renders the Konto section containing PasskeysTab and SessionsTab", async () => {
    render(<SettingsSectionAccount />);

    expect(screen.getByTestId("settings-section-konto")).toBeInTheDocument();
    await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockListSessions).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("passkeys-add-cta")).toBeInTheDocument();
  });

  // Moved verbatim (same assertions) from SecurityTab.test.tsx's former
  // "Delete account section (E6)" describe block -- relocated, not
  // duplicated or weakened.
  describe("Delete account section (E6)", () => {
    it("renders the trigger for every account -- unconditional, no branching at the trigger level", async () => {
      render(<SettingsSectionAccount />);
      await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));

      expect(screen.getByText("account.deleteSectionHeading")).toBeInTheDocument();
      expect(screen.getByText("account.deleteSectionBody")).toBeInTheDocument();
      expect(screen.getByTestId("account-delete-trigger")).toHaveTextContent(
        "account.deleteTriggerCta",
      );
      expect(screen.queryByTestId("mock-delete-account-dialog")).not.toBeInTheDocument();
    });

    it("clicking the trigger mounts DeleteAccountDialog", async () => {
      render(<SettingsSectionAccount />);
      await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByTestId("account-delete-trigger"));
      expect(screen.getByTestId("mock-delete-account-dialog")).toBeInTheDocument();
    });

    it("closing the dialog unmounts it", async () => {
      render(<SettingsSectionAccount />);
      await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));

      fireEvent.click(screen.getByTestId("account-delete-trigger"));
      expect(screen.getByTestId("mock-delete-account-dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("mock-delete-account-dialog-close"));
      expect(screen.queryByTestId("mock-delete-account-dialog")).not.toBeInTheDocument();
    });
  });
});
