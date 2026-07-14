import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const {
  mockUseFolders,
  mockUpdateVaultItem,
  mockDeleteVaultItem,
  mockCopyWithAutoClear,
  mockReadClipboardSeconds,
  mockShowCopyToast,
  mockTotpNow,
} = vi.hoisted(() => ({
  mockUseFolders: vi.fn(),
  mockUpdateVaultItem: vi.fn(),
  mockDeleteVaultItem: vi.fn(),
  mockCopyWithAutoClear: vi.fn(),
  mockReadClipboardSeconds: vi.fn(() => 40),
  mockShowCopyToast: vi.fn(),
  mockTotpNow: vi.fn(),
}));

vi.mock("@/lib/vault/store", () => ({
  useFolders: mockUseFolders,
  updateVaultItem: mockUpdateVaultItem,
  deleteVaultItem: mockDeleteVaultItem,
}));

// ItemRow now transitively renders TotpCountdownRing for totp items, which
// calls @/lib/crypto's totpNow — mocked per store.test.ts's established
// vi.mock("@/lib/crypto", ...) pattern.
vi.mock("@/lib/crypto", () => ({
  totpNow: mockTotpNow,
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

import ItemRow from "./ItemRow";
import type { CardFields, LoginFields, TotpFields, VaultItem } from "@/lib/vault/types";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
  mockTotpNow.mockReturnValue({ code: "123456", secondsRemaining: 20 });
});

function loginItem(overrides: Partial<LoginFields> = {}): VaultItem {
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
  return { id: "item-1", revision: 1, fields };
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

function totpItem(overrides: Partial<TotpFields> = {}): VaultItem {
  const fields: TotpFields = {
    type: "totp",
    name: "GitHub",
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    issuer: "GitHub Inc",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    notes: "",
    folderId: null,
    tags: [],
    ...overrides,
  };
  return { id: "item-3", revision: 1, fields };
}

describe("ItemRow", () => {
  it("renders the login type-icon and the username as subtitle for a login item", () => {
    const { container } = render(
      <ItemRow item={loginItem()} selected={false} onClick={vi.fn()} />,
    );
    expect(container.querySelector(".lucide-vault")).not.toBeNull();
    expect(screen.getByText("bartek")).toBeInTheDocument();
  });

  it("renders the card type-icon for a card item", () => {
    const { container } = render(
      <ItemRow item={cardItem()} selected={false} onClick={vi.fn()} />,
    );
    expect(container.querySelector(".lucide-credit-card")).not.toBeNull();
  });

  it("calls onClick when the row's selection button is clicked", () => {
    const onClick = vi.fn();
    render(<ItemRow item={loginItem()} selected={false} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("item-row-select-item-1"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders the selection control as a native button, not a role=button div with interactive descendants (gap-review WR-04)", () => {
    render(<ItemRow item={loginItem()} selected={false} onClick={vi.fn()} />);
    const row = screen.getByTestId("item-row-item-1");
    expect(row).not.toHaveAttribute("role", "button");
    expect(screen.getByTestId("item-row-select-item-1").tagName).toBe("BUTTON");
  });

  it("applies selected styling when selected=true", () => {
    render(<ItemRow item={loginItem()} selected onClick={vi.fn()} />);
    expect(screen.getByTestId("item-row-item-1").className).toContain("border-primary");
  });

  it("renders the formatted relative time in the trailing column when item.updatedAt is set", () => {
    const recentIso = new Date(Date.now() - 5000).toISOString();
    const item = { ...loginItem(), updatedAt: recentIso };
    render(<ItemRow item={item} selected={false} onClick={vi.fn()} />);
    expect(screen.getByText("time.justNow")).toBeInTheDocument();
  });

  it("renders nothing in the trailing time column when item.updatedAt is undefined", () => {
    render(<ItemRow item={loginItem()} selected={false} onClick={vi.fn()} />);
    expect(screen.queryByText("time.justNow")).not.toBeInTheDocument();
  });

  it("renders the totp type-icon and the issuer as subtitle for a totp item", () => {
    const { container } = render(
      <ItemRow item={totpItem()} selected={false} onClick={vi.fn()} />,
    );
    expect(container.querySelector(".lucide-timer")).not.toBeNull();
    expect(screen.getByText("GitHub Inc")).toBeInTheDocument();
  });

  it("renders the live countdown ring (not the relative-time timestamp) for a totp item, even when updatedAt is set", () => {
    const recentIso = new Date(Date.now() - 5000).toISOString();
    const item = { ...totpItem(), updatedAt: recentIso };
    render(<ItemRow item={item} selected={false} onClick={vi.fn()} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("123456")).toBeInTheDocument();
    expect(screen.queryByText("time.justNow")).not.toBeInTheDocument();
  });

  describe("kebab + right-click context menu", () => {
    it("clicking the kebab button opens the menu and does not fire the row's onClick", () => {
      const onClick = vi.fn();
      render(<ItemRow item={loginItem()} selected={false} onClick={onClick} />);
      fireEvent.click(screen.getByTestId("item-menu-trigger-item-1"));
      expect(screen.getByTestId("context-menu-copy-username")).toBeInTheDocument();
      expect(onClick).not.toHaveBeenCalled();
    });

    it("right-clicking the row opens the same menu, prevents the native context menu, and does not fire onClick", () => {
      const onClick = vi.fn();
      render(<ItemRow item={loginItem()} selected={false} onClick={onClick} />);
      fireEvent.contextMenu(screen.getByTestId("item-row-item-1"));
      expect(screen.getByTestId("context-menu-copy-username")).toBeInTheDocument();
      expect(onClick).not.toHaveBeenCalled();
    });

    it("clicking Delete in the menu opens DeleteConfirmDialog rather than deleting directly", () => {
      render(<ItemRow item={loginItem()} selected={false} onClick={vi.fn()} />);
      fireEvent.click(screen.getByTestId("item-menu-trigger-item-1"));
      fireEvent.click(screen.getByTestId("context-menu-delete"));
      expect(screen.getByTestId("delete-confirm-dialog")).toBeInTheDocument();
      expect(mockDeleteVaultItem).not.toHaveBeenCalled();
    });

    it("clicking Edit calls onEditRequest with the item (not the plain onClick) when provided (gap-review WR-01)", () => {
      const onClick = vi.fn();
      const onEditRequest = vi.fn();
      const item = loginItem();
      render(<ItemRow item={item} selected={false} onClick={onClick} onEditRequest={onEditRequest} />);
      fireEvent.click(screen.getByTestId("item-menu-trigger-item-1"));
      fireEvent.click(screen.getByTestId("context-menu-edit"));
      expect(onEditRequest).toHaveBeenCalledWith(item);
      expect(onClick).not.toHaveBeenCalled();
    });

    it("clicking Edit falls back to onClick when onEditRequest is not provided", () => {
      const onClick = vi.fn();
      render(<ItemRow item={loginItem()} selected={false} onClick={onClick} />);
      fireEvent.click(screen.getByTestId("item-menu-trigger-item-1"));
      fireEvent.click(screen.getByTestId("context-menu-edit"));
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
