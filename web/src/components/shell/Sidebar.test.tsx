import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const {
  mockLockVault,
  mockLogout,
  mockClearSessionToken,
  mockClearStoredEmail,
  mockSetLocale,
  mockUseFolders,
  mockUseAllTags,
  mockCreateVaultFolder,
} = vi.hoisted(() => ({
  mockLockVault: vi.fn(),
  mockLogout: vi.fn(),
  mockClearSessionToken: vi.fn(),
  mockClearStoredEmail: vi.fn(),
  mockSetLocale: vi.fn(),
  mockUseFolders: vi.fn(),
  mockUseAllTags: vi.fn(),
  mockCreateVaultFolder: vi.fn(),
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

vi.mock("@/lib/vault/store", () => ({
  useFolders: mockUseFolders,
  useAllTags: mockUseAllTags,
  createVaultFolder: mockCreateVaultFolder,
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
  mockUseFolders.mockReturnValue([]);
  mockUseAllTags.mockReturnValue([]);
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

  it("persists the clipboard-clear duration to localStorage when changed", () => {
    render(<Sidebar />);
    fireEvent.change(screen.getByTestId("sidebar-clipboard-duration"), {
      target: { value: "60" },
    });
    expect(localStorage.getItem("pv-clipboard-seconds")).toBe("60");
  });
});

describe("Sidebar nav — interactivity + folder/tag filtering", () => {
  it("every nav item (all/folders/tags) is a real interactive button, not an inert div", () => {
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);
    expect(screen.getByTestId("sidebar-nav-all").tagName).toBe("BUTTON");
    expect(screen.getByTestId("sidebar-nav-folders").tagName).toBe("BUTTON");
    expect(screen.getByTestId("sidebar-nav-tags").tagName).toBe("BUTTON");
  });

  it("clicking 'Wszystkie'/all calls onFilterChange with the all filter", () => {
    const onFilterChange = vi.fn();
    render(
      <Sidebar activeFilter={{ kind: "folder", id: "folder-1" }} onFilterChange={onFilterChange} />,
    );
    fireEvent.click(screen.getByTestId("sidebar-nav-all"));
    expect(onFilterChange).toHaveBeenCalledWith({ kind: "all" });
  });

  it("expanding Foldery lists folders from useFolders() and selecting one filters the list", () => {
    mockUseFolders.mockReturnValue([{ id: "folder-1", name: "Praca" }]);
    const onFilterChange = vi.fn();
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={onFilterChange} />);

    fireEvent.click(screen.getByTestId("sidebar-nav-folders"));
    fireEvent.click(screen.getByTestId("sidebar-folder-folder-1"));

    expect(onFilterChange).toHaveBeenCalledWith({ kind: "folder", id: "folder-1" });
  });

  it("expanding Tagi lists tags from useAllTags() and selecting one filters the list", () => {
    mockUseAllTags.mockReturnValue(["urgent"]);
    const onFilterChange = vi.fn();
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={onFilterChange} />);

    fireEvent.click(screen.getByTestId("sidebar-nav-tags"));
    fireEvent.click(screen.getByTestId("sidebar-tag-urgent"));

    expect(onFilterChange).toHaveBeenCalledWith({ kind: "tag", tag: "urgent" });
  });

  it("creates a new folder via the '+' affordance under Foldery", async () => {
    mockCreateVaultFolder.mockResolvedValue({ id: "folder-new", name: "Osobiste" });
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);

    fireEvent.click(screen.getByTestId("sidebar-nav-folders"));
    fireEvent.click(screen.getByTestId("sidebar-new-folder-button"));
    fireEvent.change(screen.getByTestId("sidebar-new-folder-name"), {
      target: { value: "Osobiste" },
    });
    fireEvent.click(screen.getByTestId("sidebar-new-folder-confirm"));

    await waitFor(() => expect(mockCreateVaultFolder).toHaveBeenCalledWith("Osobiste"));
  });

  it("marks the currently-active folder filter as selected", () => {
    mockUseFolders.mockReturnValue([{ id: "folder-1", name: "Praca" }]);
    render(
      <Sidebar activeFilter={{ kind: "folder", id: "folder-1" }} onFilterChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("sidebar-nav-folders"));
    expect(screen.getByTestId("sidebar-folder-folder-1").className).toContain("bg-primary");
  });
});

describe("Sidebar Categories/Tools restructure", () => {
  it("clicking a category type button calls onFilterChange with an itemType filter", () => {
    const onFilterChange = vi.fn();
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByTestId("sidebar-nav-type-login"));
    expect(onFilterChange).toHaveBeenCalledWith({ kind: "itemType", itemType: "login" });
  });

  it("renders the Passkeys category entry as a disabled button that never calls onFilterChange", () => {
    const onFilterChange = vi.fn();
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={onFilterChange} />);
    const passkeysButton = screen.getByTestId("sidebar-nav-passkeys");
    expect(passkeysButton).toBeDisabled();
    fireEvent.click(passkeysButton);
    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it("opens GeneratorDialog when the Tools > generator row is clicked", () => {
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("sidebar-generator-trigger"));
    expect(screen.getByTestId("generator-dialog")).toBeInTheDocument();
  });
});

describe("Sidebar i18n (gap-review IN-03)", () => {
  it("sources the account label and theme-toggle aria-label from the dictionary instead of a hardcoded Polish literal", () => {
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);
    expect(screen.getByText("sidebar.account")).toBeInTheDocument();
    expect(screen.getByLabelText("aria.toggleTheme")).toBeInTheDocument();
  });
});
