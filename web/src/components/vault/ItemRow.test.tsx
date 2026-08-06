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
  mockUseCollections,
} = vi.hoisted(() => ({
  mockUseFolders: vi.fn(),
  mockUpdateVaultItem: vi.fn(),
  mockDeleteVaultItem: vi.fn(),
  mockCopyWithAutoClear: vi.fn(),
  mockReadClipboardSeconds: vi.fn(() => 40),
  mockShowCopyToast: vi.fn(),
  mockTotpNow: vi.fn(),
  mockUseCollections: vi.fn(),
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

// Plan 26-09 (Rule 3 auto-fix): ItemRow transitively renders
// ItemContextMenu, which now imports useCollections (for its own Share
// entry point's itemSharedOnCollectionNote note) — real
// "@/lib/vault/collections" has a module-load-time subscribeLockState(...)
// side effect this file's minimal "@/lib/crypto" mock doesn't cover.
// Mocking the whole module (mirrors ItemContextMenu.test.tsx/
// DetailPanel.test.tsx's identical mock) avoids loading the real module at
// all, matching this file's existing "mock what a transitively-rendered
// child needs" convention.
vi.mock("@/lib/vault/collections", () => ({
  useCollections: mockUseCollections,
}));

// ShareDialog (opened by ItemContextMenu's new Share entry, Plan 26-09) is
// a heavy component with its own network/crypto dependency chain, fully
// covered elsewhere (Plan 26-08's ShareDialog.test.tsx/.real-wasm.test.ts)
// — mocked here for the same reason ItemContextMenu.test.tsx/
// DetailPanel.test.tsx mock it: this file tests ItemRow's own rendering,
// not ShareDialog's internals.
vi.mock("./ShareDialog", () => ({
  default: () => null,
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
import type { CardFields, LoginFields, PasskeyFields, TotpFields, VaultItem } from "@/lib/vault/types";

beforeEach(() => {
  vi.clearAllMocks();
  mockUseFolders.mockReturnValue([]);
  mockTotpNow.mockReturnValue({ code: "123456", secondsRemaining: 20 });
  mockUseCollections.mockReturnValue([]);
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

function passkeyItem(overrides: Partial<PasskeyFields> = {}): VaultItem {
  const fields: PasskeyFields = {
    type: "passkey",
    name: "bartek",
    folderId: null,
    tags: [],
    rpId: "example.com",
    credentialId: "AQIDBAX6-_w",
    username: "bartek",
    userDisplayName: "Bartek Paczesny",
    rawPasskeyJson: "{}",
    ...overrides,
  };
  return { id: "item-4", revision: 1, fields };
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
  // Bartek live-review round 3 (TASK 2): a login item WITH a resolvable
  // domain now renders a favicon <img> instead of the neutral Globe tile —
  // see the dedicated favicon describe block below. This fixture has no
  // urls at all, so the Globe fallback still applies.
  it("renders the login type-icon and the username as subtitle for a login item with no URL", () => {
    const { container } = render(
      <ItemRow item={loginItem({ urls: [] })} selected={false} onClick={vi.fn()} />,
    );
    expect(container.querySelector(".lucide-globe")).not.toBeNull();
    expect(screen.getByText("bartek")).toBeInTheDocument();
  });

  // Bartek live-review round 3 (TASK 3): a card item whose number resolves
  // to a known brand now renders that brand's tile instead of the neutral
  // CreditCard icon — see the dedicated card-brand describe block below.
  it("renders the CreditCard type-icon for a card item with no number", () => {
    const { container } = render(
      <ItemRow item={cardItem({ number: "" })} selected={false} onClick={vi.fn()} />,
    );
    expect(container.querySelector(".lucide-credit-card")).not.toBeNull();
  });

  // Proton Pass-inspired card row (Bartek live-review, scope extension):
  // the subtitle masks the card number down to its last 4 digits — the full
  // number must NEVER render in the list.
  it("renders a masked last-4 subtitle for a card item, stripping spaces/dashes", () => {
    render(
      <ItemRow
        item={cardItem({ number: "4111 1111 1111 1234" })}
        selected={false}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("•••• 1234")).toBeInTheDocument();
    expect(screen.queryByText(/4111/)).not.toBeInTheDocument();
  });

  it("renders no subtitle for a card item with an empty/absent number", () => {
    const { container } = render(
      <ItemRow item={cardItem({ number: "" })} selected={false} onClick={vi.fn()} />,
    );
    expect(container.querySelector(".lucide-credit-card")).not.toBeNull();
    expect(screen.queryByText(/••••/)).not.toBeInTheDocument();
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

  // Bug fix (Bartek live-review, screenshot-verified): a selected row's
  // bottom edge previously came entirely from the *next* row's divide-y
  // top border in ItemList, so a selected row with no following sibling
  // (the sole item in a 1-item list, or the last row of any list) had no
  // bottom edge at all. The row must now own its bottom edge via
  // `last:border-b` whenever selected, so it renders identically
  // regardless of position/list length — see ItemList.test.tsx for the
  // integration-level assertion across 1-item and multi-item lists.
  it("carries a self-contained last-child bottom-border class when selected, independent of siblings", () => {
    render(<ItemRow item={loginItem()} selected onClick={vi.fn()} />);
    const className = screen.getByTestId("item-row-item-1").className;
    expect(className).toContain("last:border-b");
    expect(className).toContain("last:border-base-300");
  });

  it("does not carry the self-contained bottom-border class when unselected", () => {
    render(<ItemRow item={loginItem()} selected={false} onClick={vi.fn()} />);
    const className = screen.getByTestId("item-row-item-1").className;
    expect(className).not.toContain("last:border-b");
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

  // Phase 12 cross-client fix (live bug): before this fix, TYPE_ICON/
  // TYPE_LABEL_KEY had no "passkey" entry, so `TYPE_ICON[item.fields.type]`
  // was `undefined` and rendering `<Icon />` threw "Cannot read properties
  // of undefined (reading 'en')" at `t(TYPE_LABEL_KEY[item.fields.type])`.
  // Bartek live-review round 3 (TASK 2): a passkey item WITH a resolvable
  // rpId now renders a favicon <img> instead of the neutral KeyRound tile —
  // see the dedicated favicon describe block below. This fixture clears
  // rpId, so the KeyRound fallback still applies.
  it("renders the passkey type-icon for a passkey item with no rpId", () => {
    const { container } = render(
      <ItemRow item={passkeyItem({ rpId: "" })} selected={false} onClick={vi.fn()} />,
    );
    expect(container.querySelector(".lucide-key-round")).not.toBeNull();
  });

  // Proton Pass-inspired passkey row (Bartek live-review): PRIMARY = the
  // site (rpId), SECONDARY = the account (username, falling back to
  // userDisplayName) — NOT the synthesized `fields.name` or the generic
  // type label.
  it("renders rpId as the primary text and username as the subtitle for a passkey item", () => {
    render(<ItemRow item={passkeyItem()} selected={false} onClick={vi.fn()} />);
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("bartek")).toBeInTheDocument();
  });

  it("falls back to userDisplayName as the subtitle when a passkey item has no username", () => {
    render(
      <ItemRow
        item={passkeyItem({ username: undefined })}
        selected={false}
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByText("example.com")).toBeInTheDocument();
    expect(screen.getByText("Bartek Paczesny")).toBeInTheDocument();
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

  // Bartek live-review round 3 (TASK 2): zero-knowledge favicon rendering —
  // a login/passkey row with a resolvable domain shows a direct <img> to
  // that domain's own /favicon.ico (never a third-party proxy), falling
  // back to the neutral type-icon tile on load error or when no domain
  // resolves. Each test below uses a distinct hostname so the module-level
  // FAILED_FAVICON_HOSTS cache (ItemIconTile.tsx) never leaks a failure
  // from one test into another within this file.
  describe("favicon rendering (ItemIconTile)", () => {
    it("renders a direct favicon <img> from the login item's own domain, never a third-party proxy", () => {
      const { container } = render(
        <ItemRow
          item={loginItem({ urls: ["https://favicon-login-a.test/path"] })}
          selected={false}
          onClick={vi.fn()}
        />,
      );
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute("src", "https://favicon-login-a.test/favicon.ico");
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(container.querySelector(".lucide-globe")).toBeNull();
    });

    it("tolerates a login URL with no scheme, the same way lib/vault/search.ts's domain parsing does", () => {
      const { container } = render(
        <ItemRow
          item={loginItem({ urls: ["favicon-login-b.test"] })}
          selected={false}
          onClick={vi.fn()}
        />,
      );
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        "https://favicon-login-b.test/favicon.ico",
      );
    });

    it("falls back to the Globe type-icon when the favicon <img> fires onError, and does not re-flash it on re-render", () => {
      const { container, rerender } = render(
        <ItemRow
          item={loginItem({ urls: ["https://favicon-login-c.test"] })}
          selected={false}
          onClick={vi.fn()}
        />,
      );
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      fireEvent.error(img as Element);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".lucide-globe")).not.toBeNull();

      // Re-rendering the very same item must not attempt the broken
      // favicon again (the module-level failure cache short-circuits it).
      rerender(
        <ItemRow
          item={loginItem({ urls: ["https://favicon-login-c.test"] })}
          selected={false}
          onClick={vi.fn()}
        />,
      );
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".lucide-globe")).not.toBeNull();
    });

    it("renders a direct favicon <img> from a passkey item's rpId", () => {
      const { container } = render(
        <ItemRow
          item={passkeyItem({ rpId: "favicon-passkey-a.test" })}
          selected={false}
          onClick={vi.fn()}
        />,
      );
      const img = container.querySelector("img");
      expect(img).toHaveAttribute("src", "https://favicon-passkey-a.test/favicon.ico");
      expect(container.querySelector(".lucide-key-round")).toBeNull();
    });

    it("falls back to the KeyRound type-icon when a passkey favicon fails to load", () => {
      const { container } = render(
        <ItemRow
          item={passkeyItem({ rpId: "favicon-passkey-b.test" })}
          selected={false}
          onClick={vi.fn()}
        />,
      );
      fireEvent.error(container.querySelector("img") as Element);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".lucide-key-round")).not.toBeNull();
    });
  });

  // Bartek live-review round 3 (TASK 3): card-brand tiles — a known-brand
  // number renders that brand's tile instead of the neutral CreditCard
  // icon. Full prefix-range coverage lives in lib/vault/cardBrand.test.ts;
  // these just confirm ItemRow actually wires detectCardBrand() in.
  describe("card brand tile", () => {
    it("renders a VISA tile for a 4-prefixed card number", () => {
      const { container } = render(
        <ItemRow item={cardItem({ number: "4111111111111111" })} selected={false} onClick={vi.fn()} />,
      );
      expect(screen.getByText("VISA")).toBeInTheDocument();
      expect(container.querySelector(".lucide-credit-card")).toBeNull();
    });

    it("renders the neutral CreditCard icon for an unrecognized card number", () => {
      const { container } = render(
        <ItemRow item={cardItem({ number: "9999999999999999" })} selected={false} onClick={vi.fn()} />,
      );
      expect(container.querySelector(".lucide-credit-card")).not.toBeNull();
    });
  });
});
