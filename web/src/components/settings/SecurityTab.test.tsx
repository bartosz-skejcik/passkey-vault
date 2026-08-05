import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

// Plan 25-09 (E6): DeleteAccountDialog has its own dedicated, exhaustive
// test file (DeleteAccountDialog.test.tsx) -- shallow-mocked here so this
// stays a fast, focused unit test of SecurityTab's own wiring (the "Delete
// account" section renders + the trigger mounts the dialog), matching
// SettingsPanel.test.tsx's identical shallow-mock precedent for FamilyTab/
// ImportWizard/ExportDialog.
vi.mock("./DeleteAccountDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-delete-account-dialog">
      <button type="button" data-testid="mock-delete-account-dialog-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

import SecurityTab from "./SecurityTab";
import { AUTOLOCK_MINUTES_KEY } from "@/lib/idle/autolock";
import { CLIPBOARD_SECONDS_KEY } from "@/lib/clipboard";

beforeEach(() => {
  localStorage.clear();
});

describe("SecurityTab", () => {
  it("renders the autolock select and persists a change under AUTOLOCK_MINUTES_KEY", () => {
    render(<SecurityTab />);

    fireEvent.change(screen.getByTestId("sidebar-autolock-select"), { target: { value: "60" } });
    expect(localStorage.getItem(AUTOLOCK_MINUTES_KEY)).toBe("60");
  });

  it("renders the clipboard duration slider and persists a change under CLIPBOARD_SECONDS_KEY", () => {
    render(<SecurityTab />);

    fireEvent.change(screen.getByTestId("sidebar-clipboard-duration"), { target: { value: "45" } });
    expect(localStorage.getItem(CLIPBOARD_SECONDS_KEY)).toBe("45");
  });

  describe("Delete account section (E6)", () => {
    it("renders the trigger for every account -- unconditional, no branching at the trigger level", () => {
      render(<SecurityTab />);

      expect(screen.getByText("account.deleteSectionHeading")).toBeInTheDocument();
      expect(screen.getByText("account.deleteSectionBody")).toBeInTheDocument();
      expect(screen.getByTestId("account-delete-trigger")).toHaveTextContent(
        "account.deleteTriggerCta",
      );
      expect(screen.queryByTestId("mock-delete-account-dialog")).not.toBeInTheDocument();
    });

    it("clicking the trigger mounts DeleteAccountDialog", () => {
      render(<SecurityTab />);

      fireEvent.click(screen.getByTestId("account-delete-trigger"));
      expect(screen.getByTestId("mock-delete-account-dialog")).toBeInTheDocument();
    });

    it("closing the dialog unmounts it", () => {
      render(<SecurityTab />);

      fireEvent.click(screen.getByTestId("account-delete-trigger"));
      expect(screen.getByTestId("mock-delete-account-dialog")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("mock-delete-account-dialog-close"));
      expect(screen.queryByTestId("mock-delete-account-dialog")).not.toBeInTheDocument();
    });
  });
});
