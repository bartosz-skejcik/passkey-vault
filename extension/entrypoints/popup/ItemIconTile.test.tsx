// ItemIconTile.test.tsx — popup UI round (Bartek-decided, FINAL, decision
// 1): the ported favicon/card-brand tile. Mirrors web/src/components/vault/
// ItemRow.test.tsx's own "favicon rendering (ItemIconTile)" / "card brand
// tile" describe blocks (same assertions, ported to this popup's own
// component/types modules), since this is a verbatim port of that same
// component. Each favicon test uses a distinct hostname so the
// module-level FAILED_FAVICON_HOSTS cache never leaks a failure from one
// test into another within this file.
import { describe, expect, it } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import ItemIconTile from "./ItemIconTile";
import type { CardFields, LoginFields, NoteFields, PasskeyFields, VaultItem } from "../../lib/vault/types";

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
  return { id: "1", revision: 1, fields };
}

function passkeyItem(overrides: Partial<PasskeyFields> = {}): VaultItem {
  const fields: PasskeyFields = {
    type: "passkey",
    name: "GitHub passkey",
    folderId: null,
    tags: [],
    rpId: "github.com",
    credentialId: "abc123",
    rawPasskeyJson: "{}",
    ...overrides,
  };
  return { id: "2", revision: 1, fields };
}

function cardItem(overrides: Partial<CardFields> = {}): VaultItem {
  const fields: CardFields = {
    type: "card",
    name: "My Visa",
    folderId: null,
    tags: [],
    cardholderName: "Bartek",
    number: "4111111111111111",
    expiry: "12/30",
    cvv: "123",
    notes: "",
    ...overrides,
  };
  return { id: "3", revision: 1, fields };
}

function noteItem(overrides: Partial<NoteFields> = {}): VaultItem {
  const fields: NoteFields = {
    type: "note",
    name: "Wifi password",
    folderId: null,
    tags: [],
    body: "hunter2",
    ...overrides,
  };
  return { id: "4", revision: 1, fields };
}

describe("ItemIconTile", () => {
  describe("favicon rendering", () => {
    it("renders a direct favicon <img> from the login item's own domain, never a third-party proxy", () => {
      const { container } = render(
        <ItemIconTile item={loginItem({ urls: ["https://favicon-login-a.test/path"] })} />,
      );
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img).toHaveAttribute("src", "https://favicon-login-a.test/favicon.ico");
      expect(img).toHaveAttribute("alt", "");
      expect(img).toHaveAttribute("referrerpolicy", "no-referrer");
      expect(img).toHaveAttribute("loading", "lazy");
      expect(container.querySelector(".lucide-globe")).toBeNull();
    });

    it("tolerates a login URL with no scheme, the same way lib/vault/search.ts's domain parsing does", () => {
      const { container } = render(
        <ItemIconTile item={loginItem({ urls: ["favicon-login-b.test"] })} />,
      );
      expect(container.querySelector("img")).toHaveAttribute(
        "src",
        "https://favicon-login-b.test/favicon.ico",
      );
    });

    it("falls back to the Globe type-icon when the favicon <img> fires onError, and does not re-flash it on re-render", () => {
      const { container, rerender } = render(
        <ItemIconTile item={loginItem({ urls: ["https://favicon-login-c.test"] })} />,
      );
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      fireEvent.error(img as Element);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".lucide-globe")).not.toBeNull();

      // Re-rendering the very same item must not attempt the broken
      // favicon again (the module-level failure cache short-circuits it).
      rerender(<ItemIconTile item={loginItem({ urls: ["https://favicon-login-c.test"] })} />);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".lucide-globe")).not.toBeNull();
    });

    it("renders a direct favicon <img> from a passkey item's rpId", () => {
      const { container } = render(
        <ItemIconTile item={passkeyItem({ rpId: "favicon-passkey-a.test" })} />,
      );
      const img = container.querySelector("img");
      expect(img).toHaveAttribute("src", "https://favicon-passkey-a.test/favicon.ico");
      expect(container.querySelector(".lucide-key-round")).toBeNull();
    });

    it("falls back to the KeyRound type-icon when a passkey favicon fails to load", () => {
      const { container } = render(
        <ItemIconTile item={passkeyItem({ rpId: "favicon-passkey-b.test" })} />,
      );
      fireEvent.error(container.querySelector("img") as Element);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".lucide-key-round")).not.toBeNull();
    });

    it("falls back to the neutral type-icon for a login item with no urls at all", () => {
      const { container } = render(<ItemIconTile item={loginItem({ urls: [] })} />);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".lucide-globe")).not.toBeNull();
    });

    it("falls back to the neutral StickyNote icon for a note item (no favicon target at all)", () => {
      const { container } = render(<ItemIconTile item={noteItem()} />);
      expect(container.querySelector("img")).toBeNull();
      expect(container.querySelector(".lucide-sticky-note")).not.toBeNull();
    });
  });

  describe("card brand tile", () => {
    it("renders a VISA tile for a 4-prefixed card number", () => {
      const { container } = render(<ItemIconTile item={cardItem({ number: "4111111111111111" })} />);
      expect(screen.getByText("VISA")).toBeInTheDocument();
      expect(container.querySelector(".lucide-credit-card")).toBeNull();
    });

    it("renders the neutral CreditCard icon for an unrecognized card number", () => {
      const { container } = render(<ItemIconTile item={cardItem({ number: "9999999999999999" })} />);
      expect(container.querySelector(".lucide-credit-card")).not.toBeNull();
    });
  });
});
