import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/i18n/LocaleContext", () => ({
  useLocale: () => ({
    locale: "pl",
    setLocale: vi.fn(),
    t: (key: string) => key,
  }),
}));

import ItemRow from "./ItemRow";
import type { CardFields, LoginFields, VaultItem } from "@/lib/vault/types";

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

  it("calls onClick when the row is clicked", () => {
    const onClick = vi.fn();
    render(<ItemRow item={loginItem()} selected={false} onClick={onClick} />);
    fireEvent.click(screen.getByTestId("item-row-item-1"));
    expect(onClick).toHaveBeenCalledTimes(1);
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
});
