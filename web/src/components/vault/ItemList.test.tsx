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
});
