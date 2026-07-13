import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { CardFields, IdentityFields, LoginFields, NoteFields, VaultItem } from "@/lib/vault/types";

const {
  mockUseFolders,
  mockUpdateVaultItem,
  mockCopyWithAutoClear,
  mockReadClipboardSeconds,
  mockShowCopyToast,
} = vi.hoisted(() => ({
  mockUseFolders: vi.fn(),
  mockUpdateVaultItem: vi.fn(),
  mockCopyWithAutoClear: vi.fn(),
  mockReadClipboardSeconds: vi.fn(() => 40),
  mockShowCopyToast: vi.fn(),
}));

vi.mock("@/lib/vault/store", () => ({
  useFolders: mockUseFolders,
  updateVaultItem: mockUpdateVaultItem,
}));

vi.mock("@/lib/clipboard", () => ({
  copyWithAutoClear: mockCopyWithAutoClear,
  readClipboardSeconds: mockReadClipboardSeconds,
}));

vi.mock("@/lib/vault/copyToast", () => ({
  showCopyToast: mockShowCopyToast,
}));

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import ItemContextMenu from "./ItemContextMenu";

function loginItem(overrides: Partial<LoginFields> = {}): VaultItem {
  const fields: LoginFields = {
    type: "login",
    name: "GitHub",
    username: "bartek",
    password: "s3cret",
    urls: [],
    notes: "",
    folderId: null,
    tags: [],
    ...overrides,
  };
  return { id: "item-1", revision: 3, fields };
}

function cardItem(overrides: Partial<CardFields> = {}): VaultItem {
  const fields: CardFields = {
    type: "card",
    name: "Visa",
    cardholderName: "Bartek",
    number: "4111111111111111",
    expiry: "12/30",
    cvv: "123",
    notes: "",
    folderId: null,
    tags: [],
    ...overrides,
  };
  return { id: "item-2", revision: 1, fields };
}

function identityItem(overrides: Partial<IdentityFields> = {}): VaultItem {
  const fields: IdentityFields = {
    type: "identity",
    name: "Me",
    firstName: "Bartek",
    lastName: "P",
    email: "bartek@example.com",
    phone: "",
    address: "",
    notes: "",
    folderId: null,
    tags: [],
    ...overrides,
  };
  return { id: "item-3", revision: 1, fields };
}

function noteItem(overrides: Partial<NoteFields> = {}): VaultItem {
  const fields: NoteFields = {
    type: "note",
    name: "Wifi",
    body: "hunter2",
    folderId: null,
    tags: [],
    ...overrides,
  };
  return { id: "item-4", revision: 1, fields };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
});

describe("ItemContextMenu", () => {
  it("offers copy-username and copy-password for a login item with both fields set", () => {
    render(
      <ItemContextMenu item={loginItem()} onClose={vi.fn()} onEdit={vi.fn()} onDeleteRequest={vi.fn()} />,
    );
    expect(screen.getByTestId("context-menu-copy-username")).toBeInTheDocument();
    expect(screen.getByTestId("context-menu-copy-password")).toBeInTheDocument();
  });

  it("offers only copy-card-number for a card item with number set", () => {
    render(
      <ItemContextMenu item={cardItem()} onClose={vi.fn()} onEdit={vi.fn()} onDeleteRequest={vi.fn()} />,
    );
    expect(screen.getByTestId("context-menu-copy-number")).toBeInTheDocument();
    expect(screen.queryByTestId("context-menu-copy-username")).not.toBeInTheDocument();
  });

  it("offers only copy-email for an identity item with email set", () => {
    render(
      <ItemContextMenu item={identityItem()} onClose={vi.fn()} onEdit={vi.fn()} onDeleteRequest={vi.fn()} />,
    );
    expect(screen.getByTestId("context-menu-copy-email")).toBeInTheDocument();
  });

  it("offers no copy actions for a note item", () => {
    render(
      <ItemContextMenu item={noteItem()} onClose={vi.fn()} onEdit={vi.fn()} onDeleteRequest={vi.fn()} />,
    );
    expect(screen.queryByTestId("context-menu-copy-username")).not.toBeInTheDocument();
    expect(screen.queryByTestId("context-menu-copy-password")).not.toBeInTheDocument();
    expect(screen.queryByTestId("context-menu-copy-number")).not.toBeInTheDocument();
    expect(screen.queryByTestId("context-menu-copy-email")).not.toBeInTheDocument();
  });

  it("copying a field writes through the auto-clear clipboard helper, shows a toast, and closes the menu", () => {
    const onClose = vi.fn();
    render(
      <ItemContextMenu item={loginItem()} onClose={onClose} onEdit={vi.fn()} onDeleteRequest={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("context-menu-copy-password"));
    expect(mockCopyWithAutoClear).toHaveBeenCalledWith("s3cret", expect.any(Number));
    expect(mockShowCopyToast).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("choosing a folder under Move calls updateVaultItem with the expected folderId and closes", () => {
    mockUseFolders.mockReturnValue([{ id: "folder-1", name: "Praca" }]);
    const onClose = vi.fn();
    const item = loginItem();
    render(
      <ItemContextMenu item={item} onClose={onClose} onEdit={vi.fn()} onDeleteRequest={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId("context-menu-move-folder-1"));

    expect(mockUpdateVaultItem).toHaveBeenCalledWith(
      "item-1",
      { ...item.fields, folderId: "folder-1" },
      3,
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("choosing 'no folder' under Move calls updateVaultItem with folderId: null", () => {
    const item = loginItem();
    render(
      <ItemContextMenu item={item} onClose={vi.fn()} onEdit={vi.fn()} onDeleteRequest={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("context-menu-move-none"));
    expect(mockUpdateVaultItem).toHaveBeenCalledWith(
      "item-1",
      { ...item.fields, folderId: null },
      3,
    );
  });

  it("clicking Edit calls onEdit and closes the menu", () => {
    const onEdit = vi.fn();
    const onClose = vi.fn();
    render(
      <ItemContextMenu item={loginItem()} onClose={onClose} onEdit={onEdit} onDeleteRequest={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("context-menu-edit"));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking Delete calls onDeleteRequest without performing a direct delete", () => {
    const onDeleteRequest = vi.fn();
    render(
      <ItemContextMenu
        item={loginItem()}
        onClose={vi.fn()}
        onEdit={vi.fn()}
        onDeleteRequest={onDeleteRequest}
      />,
    );
    fireEvent.click(screen.getByTestId("context-menu-delete"));
    expect(onDeleteRequest).toHaveBeenCalledTimes(1);
    expect(mockUpdateVaultItem).not.toHaveBeenCalled();
  });
});
