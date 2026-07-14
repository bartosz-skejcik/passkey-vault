import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockListPasskeys, mockListSessions, mockLockVault } = vi.hoisted(() => ({
  mockListPasskeys: vi.fn(),
  mockListSessions: vi.fn(),
  mockLockVault: vi.fn(),
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

vi.mock("@/lib/crypto", () => ({
  lockVault: mockLockVault,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

// Heavy child components -- shallow-mocked so this stays a fast, focused
// unit test of the Settings tab wiring, not a re-test of either dialog's
// own internals (both already have their own dedicated test files).
vi.mock("../vault/ImportWizard", () => ({
  default: ({ onDone }: { onDone: () => void }) => (
    <div data-testid="mock-import-wizard">
      <button type="button" data-testid="mock-import-wizard-done" onClick={onDone}>
        done
      </button>
    </div>
  ),
}));

vi.mock("../vault/ExportDialog", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-export-dialog">
      <button type="button" data-testid="mock-export-dialog-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

import SettingsPanel from "./SettingsPanel";
import { AUTOLOCK_MINUTES_KEY } from "@/lib/idle/autolock";

beforeEach(() => {
  vi.clearAllMocks();
  mockListPasskeys.mockResolvedValue([]);
  mockListSessions.mockResolvedValue([]);
  localStorage.clear();
});

describe("SettingsPanel", () => {
  it("renders all 4 tabs and defaults to the Passkeys tab", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    expect(screen.getByTestId("settings-tab-passkeys")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-sessions")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-security")).toBeInTheDocument();
    expect(screen.getByTestId("settings-tab-importexport")).toBeInTheDocument();

    await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("passkeys-add-cta")).toBeInTheDocument();
  });

  it("switches visible content when the Sessions tab is clicked", async () => {
    render(<SettingsPanel onClose={vi.fn()} />);
    await waitFor(() => expect(mockListPasskeys).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("settings-tab-sessions"));

    await waitFor(() => expect(mockListSessions).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("passkeys-add-cta")).not.toBeInTheDocument();
  });

  it("persists the autolock minutes under AUTOLOCK_MINUTES_KEY from the Security tab (migration regression proof)", () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("settings-tab-security"));
    fireEvent.change(screen.getByTestId("sidebar-autolock-select"), { target: { value: "60" } });

    expect(localStorage.getItem(AUTOLOCK_MINUTES_KEY)).toBe("60");
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(<SettingsPanel onClose={onClose} />);

    fireEvent.click(screen.getByTestId("settings-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("replaces the Phase 3 placeholder with working Import/Export CTAs that open ImportWizard/ExportDialog", () => {
    render(<SettingsPanel onClose={vi.fn()} />);

    fireEvent.click(screen.getByTestId("settings-tab-importexport"));

    expect(screen.queryByText("settings.importExportPlaceholder")).not.toBeInTheDocument();
    expect(screen.getByTestId("settings-import-cta")).toBeInTheDocument();
    expect(screen.getByTestId("settings-export-cta")).toBeInTheDocument();

    expect(screen.queryByTestId("mock-import-wizard")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-import-cta"));
    expect(screen.getByTestId("mock-import-wizard")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mock-import-wizard-done"));
    expect(screen.queryByTestId("mock-import-wizard")).not.toBeInTheDocument();

    expect(screen.queryByTestId("mock-export-dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-export-cta"));
    expect(screen.getByTestId("mock-export-dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("mock-export-dialog-close"));
    expect(screen.queryByTestId("mock-export-dialog")).not.toBeInTheDocument();
  });
});
