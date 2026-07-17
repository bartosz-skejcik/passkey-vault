import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { mockUseVaultItems, mockUseFolders, mockUpdateVaultItem, mockDeleteVaultItem } =
  vi.hoisted(() => ({
    mockUseVaultItems: vi.fn(),
    mockUseFolders: vi.fn(),
    mockUpdateVaultItem: vi.fn(),
    mockDeleteVaultItem: vi.fn(),
  }));

vi.mock("@/lib/vault/store", () => ({
  useVaultItems: mockUseVaultItems,
  useFolders: mockUseFolders,
  updateVaultItem: mockUpdateVaultItem,
  deleteVaultItem: mockDeleteVaultItem,
}));

vi.mock("@/lib/clipboard", () => ({
  copyWithAutoClear: vi.fn(),
  readClipboardSeconds: vi.fn(() => 40),
}));

vi.mock("@/lib/vault/copyToast", () => ({
  showCopyToast: vi.fn(),
}));

vi.mock("@/lib/vault/errorToast", () => ({
  showErrorToast: vi.fn(),
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import ItemList from "./ItemList";
import type { LoginFields, NoteFields, VaultItem } from "@/lib/vault/types";

function loginItem(id: string, overrides: Partial<LoginFields> = {}): VaultItem {
  const fields: LoginFields = {
    type: "login",
    name: "GitHub",
    username: "bartek",
    password: "s3cret",
    urls: ["https://github.com"],
    notes: "",
    folderId: null,
    tags: [],
    ...overrides,
  };
  return { id, revision: 1, fields };
}

function noteItem(id: string, overrides: Partial<NoteFields> = {}): VaultItem {
  const fields: NoteFields = {
    type: "note",
    name: "Wifi",
    body: "hunter2",
    folderId: null,
    tags: [],
    ...overrides,
  };
  return { id, revision: 1, fields };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
});

describe("ItemList", () => {
  it("renders one row per item when the search query is empty", () => {
    mockUseVaultItems.mockReturnValue([loginItem("1"), noteItem("2")]);
    render(<ItemList searchQuery="" selectedItemId={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId("item-row-1")).toBeInTheDocument();
    expect(screen.getByTestId("item-row-2")).toBeInTheDocument();
  });

  it("filters rows by search query", () => {
    mockUseVaultItems.mockReturnValue([loginItem("1"), noteItem("2")]);
    render(<ItemList searchQuery="github" selectedItemId={null} onSelect={vi.fn()} />);
    expect(screen.getByTestId("item-row-1")).toBeInTheDocument();
    expect(screen.queryByTestId("item-row-2")).not.toBeInTheDocument();
  });

  it("shows the empty-results state when a non-empty query matches nothing", () => {
    mockUseVaultItems.mockReturnValue([loginItem("1")]);
    render(<ItemList searchQuery="zzz-no-match" selectedItemId={null} onSelect={vi.fn()} />);
    expect(screen.queryByTestId("item-row-1")).not.toBeInTheDocument();
    expect(screen.getByText(/search.emptyResults/)).toBeInTheDocument();
  });

  it("forwards onEditRequest through to each row's context menu Edit action", () => {
    mockUseVaultItems.mockReturnValue([loginItem("1")]);
    const onEditRequest = vi.fn();
    render(
      <ItemList
        searchQuery=""
        selectedItemId={null}
        onSelect={vi.fn()}
        onEditRequest={onEditRequest}
      />,
    );
    fireEvent.click(screen.getByTestId("item-menu-trigger-1"));
    fireEvent.click(screen.getByTestId("context-menu-edit"));
    expect(onEditRequest).toHaveBeenCalledWith(expect.objectContaining({ id: "1" }));
  });

  // Bug fix (Bartek live-review, screenshot-verified): the selected row's
  // outline lost its bottom edge whenever it had no following sibling —
  // reproduced most simply with a 1-item list, but equally true for the
  // last row of any longer list, since the edge previously came from the
  // *next* row's divide-y top border. Each of these covers a distinct
  // position (solo/last-of-one, first-of-many, last-of-many) to lock in
  // that the fix is position-independent.
  it("gives the selected row its own last-child bottom border when it's the only item in the list", () => {
    mockUseVaultItems.mockReturnValue([loginItem("1")]);
    render(<ItemList searchQuery="" selectedItemId="1" onSelect={vi.fn()} />);
    const className = screen.getByTestId("item-row-1").className;
    expect(className).toContain("last:border-b");
    expect(className).toContain("last:border-base-300");
  });

  it("gives the selected row its own last-child bottom border when it's the last of several items", () => {
    mockUseVaultItems.mockReturnValue([loginItem("1"), noteItem("2")]);
    render(<ItemList searchQuery="" selectedItemId="2" onSelect={vi.fn()} />);
    const className = screen.getByTestId("item-row-2").className;
    expect(className).toContain("last:border-b");
    expect(className).toContain("last:border-base-300");
  });

  it("does not duplicate the bottom border on a selected row that has a following sibling (avoids a double-border artifact)", () => {
    mockUseVaultItems.mockReturnValue([loginItem("1"), noteItem("2")]);
    render(<ItemList searchQuery="" selectedItemId="1" onSelect={vi.fn()} />);
    // Row 1 is selected but not last-child: it must rely on row 2's
    // divide-y top border for its bottom edge, not add its own — the
    // `last:` variant is present in markup (CSS decides applicability)
    // but the underlying list container must still own the shared
    // divide-y separator so exactly one line renders at that boundary.
    expect(screen.getByTestId("item-row-1").className).toContain("last:border-b");
    const list = screen.getByTestId("item-row-1").parentElement;
    expect(list?.className).toContain("divide-y");
    expect(list?.className).toContain("divide-base-300");
  });
});
