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
