// ItemDetailView.test.tsx — NordPass-style last-used tracking (quick-260717).
// This view decrypts/copies CLIENT-SIDE in the popup document (unlike every
// autofill/ceremony touch-point, which already runs in the background), so
// its copy/reveal affordances go through the lightweight `vault.touch`
// message kind (lib/messaging/ext-protocol.ts) instead of a duplicated
// fetch -- this suite pins that wiring.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { VaultItem } from "../../lib/vault/types";

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));

vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

import ItemDetailView from "./ItemDetailView";

function loginItem(id: string): VaultItem {
  return {
    id,
    revision: 1,
    fields: {
      type: "login",
      name: "GitHub",
      folderId: null,
      tags: [],
      username: "octocat",
      password: "hunter2",
      urls: [],
      notes: "",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSendMessage.mockResolvedValue({ ok: true });
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

describe("ItemDetailView last-used touch wiring", () => {
  it("sends vault.touch with the item's id when a copy button is clicked", async () => {
    const item = loginItem("item-1");
    render(<ItemDetailView locale="en" item={item} onBack={vi.fn()} />);

    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    fireEvent.click(copyButtons[0]);

    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith({ kind: "vault.touch", itemId: "item-1" }),
    );
  });

  it("sends vault.touch when a masked field is revealed, but not when it is re-hidden", async () => {
    const item = loginItem("item-2");
    render(<ItemDetailView locale="en" item={item} onBack={vi.fn()} />);

    const revealButtons = screen.getAllByRole("button", { name: /show password|reveal/i });
    fireEvent.click(revealButtons[0]);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    expect(mockSendMessage).toHaveBeenCalledWith({ kind: "vault.touch", itemId: "item-2" });

    const hideButtons = screen.getAllByRole("button", { name: /hide password/i });
    fireEvent.click(hideButtons[0]);
    expect(mockSendMessage).toHaveBeenCalledTimes(1);
  });

  it("never throws even if the vault.touch message rejects (fire-and-forget)", async () => {
    mockSendMessage.mockRejectedValue(new Error("offline"));
    const item = loginItem("item-3");
    render(<ItemDetailView locale="en" item={item} onBack={vi.fn()} />);

    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    expect(() => fireEvent.click(copyButtons[0])).not.toThrow();
  });
});

// 27-08 (Task 3) -- E3 hidden-password mask + honesty note, shared-folder
// note, header badge, undecryptable banner.
describe("27-08: shared-item E3 treatment", () => {
  function hiddenPasswordItem(id: string): VaultItem {
    return {
      id,
      revision: 1,
      fields: {
        type: "login",
        name: "Family Netflix",
        folderId: null,
        tags: [],
        username: "octocat",
        password: "hunter2",
        urls: [],
        notes: "",
      },
      isShared: true,
      collectionId: "col-1",
      accessLevel: "hidden_password",
    };
  }

  it("Test 1: a hidden_password-access item's password row shows the mask, no Eye/EyeOff, no copy, and the exact honesty note (EN)", async () => {
    const item = hiddenPasswordItem("item-hp-en");
    render(<ItemDetailView locale="en" item={item} onBack={vi.fn()} />);

    expect(screen.getByText("•".repeat(10))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show password|hide password/i })).not.toBeInTheDocument();
    // Only the username field's copy button remains -- the password field's
    // copy affordance is omitted entirely.
    expect(screen.getAllByRole("button", { name: /copy/i })).toHaveLength(1);
    expect(
      screen.getByText(
        "The owner shared this password as hidden — this popup masks it and won't let you copy it. Autofill on the page still works. This is an interface protection only — you hold the key either way, so it isn't a cryptographic one.",
      ),
    ).toBeInTheDocument();
  });

  it("Test 1b: the exact honesty note renders in PL too", async () => {
    const item = hiddenPasswordItem("item-hp-pl");
    render(<ItemDetailView locale="pl" item={item} onBack={vi.fn()} />);

    expect(
      screen.getByText(
        "Właściciel udostępnił to hasło jako ukryte — to okno je maskuje i nie pozwala go skopiować. Automatyczne wypełnianie na stronie nadal działa. To tylko zabezpieczenie interfejsu — klucz i tak jest w rękach odbiorcy, więc to nie jest ochrona kryptograficzna.",
      ),
    ).toBeInTheDocument();
  });

  it("Test 2: a personal item (accessLevel undefined) shows the same reveal/copy affordances as today -- zero behavior change", async () => {
    const item = loginItem("item-personal");
    render(<ItemDetailView locale="en" item={item} onBack={vi.fn()} />);

    expect(screen.getByRole("button", { name: /show password/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /copy/i })).toHaveLength(2); // username + password
    expect(screen.queryByTestId("hidden-password-extension-note")).not.toBeInTheDocument();
  });

  it("Test 3: a collection-scoped item shows share.itemSharedOnCollectionNote interpolated with the real folder name", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") {
        return {
          items: [],
          folders: [],
          pending: [],
          collections: [{ id: "col-1", name: "Rodzina", accessLevel: "edit" }],
        };
      }
      return { ok: true };
    });
    const item: VaultItem = { ...loginItem("item-collection"), isShared: true, collectionId: "col-1" };
    render(<ItemDetailView locale="en" item={item} onBack={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByText(/This item is part of the shared folder "Rodzina"/i),
      ).toBeInTheDocument(),
    );
  });

  it("Test 4: a direct-shared item (collectionId null, isShared true) shows nothing in the folder-note slot", async () => {
    const item: VaultItem = { ...loginItem("item-direct"), isShared: true, collectionId: null };
    render(<ItemDetailView locale="en" item={item} onBack={vi.fn()} />);

    expect(screen.queryByTestId("item-shared-on-collection-note")).not.toBeInTheDocument();
    // But the header badge still carries the "shared" fact.
    expect(screen.getByRole("img", { name: "Shared item" })).toBeInTheDocument();
  });

  it("Test 5: an undecryptable:true item shows the warning banner", async () => {
    const item: VaultItem = { ...loginItem("item-broken"), undecryptable: true };
    render(<ItemDetailView locale="en" item={item} onBack={vi.fn()} />);

    expect(screen.getByTestId("undecryptable-item-banner")).toBeInTheDocument();
    expect(screen.getByTestId("undecryptable-item-banner")).toHaveTextContent(/failed to decrypt/i);
  });
});
