import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const {
  mockLockVault,
  mockLogout,
  mockClearSessionToken,
  mockClearStoredEmail,
  mockSetLocale,
  mockUseFolders,
  mockUseAllTags,
  mockCreateVaultFolder,
  mockUseSyncStatus,
  mockUseCollections,
  mockGetCollectionAccessList,
} = vi.hoisted(() => ({
  mockLockVault: vi.fn(),
  mockLogout: vi.fn(),
  mockClearSessionToken: vi.fn(),
  mockClearStoredEmail: vi.fn(),
  mockSetLocale: vi.fn(),
  mockUseFolders: vi.fn(),
  mockUseAllTags: vi.fn(),
  mockCreateVaultFolder: vi.fn(),
  mockUseSyncStatus: vi.fn(),
  mockUseCollections: vi.fn(),
  mockGetCollectionAccessList: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  lockVault: mockLockVault,
  // WR-12 (code review, Phase 26): lib/vault/shareRecipients.ts now
  // registers a lock-state listener at module load (clearing its cached
  // co-recipient rosters), and this tree reaches it transitively via
  // AvatarStack. Both exports must exist on this mock or the module graph
  // fails to load at all.
  subscribeLockState: () => () => {},
  isUnlocked: () => true,
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

vi.mock("@/lib/vault/syncStatus", () => ({
  useSyncStatus: mockUseSyncStatus,
}));

vi.mock("@/lib/vault/collections", () => ({
  useCollections: mockUseCollections,
}));

// Sidebar's own per-collection recipient fetch (E5's icon-only AvatarStack
// variant) — only getCollectionAccessList is exercised from this module by
// Sidebar itself; AvatarStack's own useShareRecipients hook never fetches
// here since every row passes a pre-resolved `recipients` prop (item is
// always null for the icon variant).
vi.mock("@/lib/vault/api", () => ({
  getCollectionAccessList: mockGetCollectionAccessList,
}));

// ShareDialog (Plan 26-08) is a real, independent component (own WASM/API
// surface, own test file) — Sidebar only needs to mount it with the correct
// `scope` on the two folder-variant triggers this plan owns, so a
// lightweight stand-in avoids pulling this suite into ShareDialog's own
// crypto/network surface (mirrors FamilyTab.test.tsx's RemoveMemberDialog
// stub precedent).
vi.mock("@/components/vault/ShareDialog", () => ({
  default: ({
    scope,
    onClose,
    onShared,
  }: {
    scope: unknown;
    onClose: () => void;
    onShared: () => void;
  }) => (
    <div data-testid="share-dialog-stub">
      <span data-testid="share-dialog-stub-scope">{JSON.stringify(scope)}</span>
      <button type="button" data-testid="share-dialog-stub-close" onClick={onClose}>
        close
      </button>
      <button type="button" data-testid="share-dialog-stub-shared" onClick={onShared}>
        shared
      </button>
    </div>
  ),
}));

// SharingOverviewPanel (Plan 26-11) — same reasoning as ShareDialog above.
vi.mock("@/components/vault/SharingOverviewPanel", () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="sharing-overview-panel-stub">
      <button type="button" data-testid="sharing-overview-panel-stub-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
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
  mockUseSyncStatus.mockReturnValue("connected");
  mockUseCollections.mockReturnValue([]);
  mockGetCollectionAccessList.mockResolvedValue([]);
  // jsdom doesn't implement navigation — Sidebar's logout handler calls
  // window.location.reload(), which jsdom only logs (doesn't throw), same
  // as UnlockOverlay's 401 path.
});

describe("Sidebar settings dropdown", () => {
  // Binding resolution #1 (03-UI-SPEC.md's "Resolutions" section): the
  // Phase 2 dropdown is restored — Lock now/Logout/language stay in this
  // dropdown (Logout does NOT move into SettingsPanel). Only the
  // autolock/clipboard controls moved out (to SecurityTab.tsx, Plan
  // 03-04's Task 2) — their persistence contract is now proven by
  // SettingsPanel.test.tsx instead, not here (asserting against them here
  // would be a false test of a control this file no longer renders).
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

  it("calls onOpenSettings when 'Ustawienia' is clicked in the account dropdown", () => {
    const onOpenSettings = vi.fn();
    render(<Sidebar onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByTestId("sidebar-open-settings"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
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

  // Phase 12 cross-client fix: provider-created passkey vault items are now
  // a real category, mirroring the extension popup's own type coverage.
  it("clicking the passkey category type button calls onFilterChange with an itemType filter", () => {
    const onFilterChange = vi.fn();
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByTestId("sidebar-nav-type-passkey"));
    expect(onFilterChange).toHaveBeenCalledWith({ kind: "itemType", itemType: "passkey" });
  });

  // Bug fix (Bartek live-review): a stale pre-Phase-12 placeholder button
  // (data-testid="sidebar-nav-passkeys", disabled, "soon"/"wkrótce" badge)
  // used to render alongside the real passkey category button above,
  // producing two "Passkeys" nav entries. Assert there is now exactly one.
  it("renders exactly one Passkeys nav entry (no stale disabled placeholder)", () => {
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);
    expect(screen.queryByTestId("sidebar-nav-passkeys")).not.toBeInTheDocument();
    expect(screen.getAllByText("sidebar.passkeys")).toHaveLength(1);
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

describe("Sidebar sync-status dot (SYNC-03, Plan 05-04)", () => {
  it("shows the sync-status dot only when useSyncStatus() returns reconnecting", () => {
    mockUseSyncStatus.mockReturnValue("connected");
    const { rerender } = render(<Sidebar />);
    expect(screen.queryByTestId("sync-status-dot")).not.toBeInTheDocument();

    mockUseSyncStatus.mockReturnValue("offline");
    rerender(<Sidebar />);
    expect(screen.queryByTestId("sync-status-dot")).not.toBeInTheDocument();

    mockUseSyncStatus.mockReturnValue("reconnecting");
    rerender(<Sidebar />);
    expect(screen.getByTestId("sync-status-dot")).toBeInTheDocument();
  });
});

// Plan 26-10 (26-UI-SPEC.md E2): folder-level Share entry point — a
// "Shared folders" section parallel to "Foldery", plus the first-ever
// context menu on a personal-folder row.
describe("Sidebar Shared folders section (E2, Plan 26-10)", () => {
  it("renders the section even with zero shared folders, never hidden entirely, with only the create trigger inside", () => {
    mockUseCollections.mockReturnValue([]);
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);

    expect(screen.getByTestId("sidebar-nav-shared-folders")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sidebar-nav-shared-folders"));

    expect(screen.getByTestId("sidebar-new-shared-folder-button")).toBeInTheDocument();
    expect(screen.queryByTestId(/^sidebar-shared-folder-/)).not.toBeInTheDocument();
  });

  it("lists every collection from useCollections() once the section is expanded", () => {
    mockUseCollections.mockReturnValue([
      { id: "col-1", name: "Rodzina" },
      { id: "col-2", name: "Praca wspólna" },
    ]);
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("sidebar-nav-shared-folders"));

    expect(screen.getByTestId("sidebar-shared-folder-col-1")).toHaveTextContent("Rodzina");
    expect(screen.getByTestId("sidebar-shared-folder-col-2")).toHaveTextContent("Praca wspólna");
  });

  it("the '+ Nowy udostępniony folder' trigger opens ShareDialog in folder-create variant with no seed", () => {
    mockUseCollections.mockReturnValue([]);
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("sidebar-nav-shared-folders"));
    fireEvent.click(screen.getByTestId("sidebar-new-shared-folder-button"));

    expect(screen.getByTestId("share-dialog-stub-scope")).toHaveTextContent(
      JSON.stringify({ kind: "folder", existingFolderId: null }),
    );
  });

  it("a >=40-char shared folder name truncates without breaking row height (title attr, mirrors Phase 25's email-truncation backstop)", () => {
    const longName = "a".repeat(48);
    mockUseCollections.mockReturnValue([{ id: "col-long", name: longName }]);
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("sidebar-nav-shared-folders"));

    const nameSpan = screen.getByTitle(longName);
    expect(nameSpan.className).toContain("truncate");
  });

  it("an existing personal folder row exposes a kebab with exactly one action, opening ShareDialog folder-create variant seeded with that folder's id", () => {
    mockUseFolders.mockReturnValue([{ id: "folder-1", name: "Praca" }]);
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId("sidebar-nav-folders"));

    const menu = screen.getByTestId("sidebar-folder-menu-folder-1");
    expect(within(menu).getAllByRole("button")).toHaveLength(1);

    // 26-12a gap fix: both the trigger's aria-label and the menu action's
    // text must be the dedicated `share.shareThisFolder` key, not
    // ShareDialog's own `share.ctaFolder` submit CTA this action opens.
    expect(screen.getByTestId("sidebar-folder-menu-trigger-folder-1")).toHaveAttribute(
      "aria-label",
      "share.shareThisFolder",
    );
    expect(within(menu).getByTestId("sidebar-folder-share-folder-1")).toHaveTextContent(
      "share.shareThisFolder",
    );

    fireEvent.click(within(menu).getByTestId("sidebar-folder-share-folder-1"));

    expect(screen.getByTestId("share-dialog-stub-scope")).toHaveTextContent(
      JSON.stringify({ kind: "folder", existingFolderId: "folder-1" }),
    );
  });

  it("the personal folder row's own selection button still filters by folder (kebab is additive, not a replacement)", () => {
    mockUseFolders.mockReturnValue([{ id: "folder-1", name: "Praca" }]);
    const onFilterChange = vi.fn();
    render(<Sidebar activeFilter={{ kind: "all" }} onFilterChange={onFilterChange} />);
    fireEvent.click(screen.getByTestId("sidebar-nav-folders"));
    fireEvent.click(screen.getByTestId("sidebar-folder-folder-1"));
    expect(onFilterChange).toHaveBeenCalledWith({ kind: "folder", id: "folder-1" });
  });
});

// Plan 26-10 (26-UI-SPEC.md's component inventory): the Sharing-overview
// trigger lives in the SAME account-area dropdown cluster as Lock/Logout/
// Settings, not a per-item context action.
describe("Sidebar Sharing-overview nav trigger (Plan 26-10)", () => {
  it("renders a Share2-icon, sharing.navLabel trigger in the account-area dropdown cluster alongside Lock/Logout/Settings", () => {
    render(<Sidebar />);
    const trigger = screen.getByTestId("sidebar-sharing-overview");
    expect(trigger).toBeInTheDocument();
    expect(trigger.closest("ul")).toBe(screen.getByTestId("sidebar-open-settings").closest("ul"));
  });

  it("clicking it opens SharingOverviewPanel", () => {
    render(<Sidebar />);
    expect(screen.queryByTestId("sharing-overview-panel-stub")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("sidebar-sharing-overview"));
    expect(screen.getByTestId("sharing-overview-panel-stub")).toBeInTheDocument();
  });

  it("closes SharingOverviewPanel via its own onClose callback", () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByTestId("sidebar-sharing-overview"));
    fireEvent.click(screen.getByTestId("sharing-overview-panel-stub-close"));
    expect(screen.queryByTestId("sharing-overview-panel-stub")).not.toBeInTheDocument();
  });
});
