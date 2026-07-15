// ItemListView.tsx — browse/search/pick surface + the BINDING (Bartek
// 2026-07-15, NordPass reference) header/footer redirect affordances.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { VaultItem } from "../../lib/vault/types";

const { mockSendMessage, mockTabsCreate, mockAddListener, mockRemoveListener } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockTabsCreate: vi.fn(),
  mockAddListener: vi.fn(),
  mockRemoveListener: vi.fn(),
}));

vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { id: "test-extension-id" },
    tabs: { create: mockTabsCreate },
    runtime_onMessage_placeholder: undefined,
  },
}));

// wxt/browser's `browser.runtime.onMessage` needs its own addListener mock
// distinct from the module factory above (vi.hoisted only allows plain
// values, not nested mock wiring against the same object) -- re-assign it
// after the mock module is set up, in beforeEach, via the imported module.
import { browser } from "wxt/browser";
import ItemListView from "./ItemListView";

function loginItem(id: string, name: string, username: string): VaultItem {
  return { id, revision: 1, fields: { type: "login", name, folderId: null, tags: [], username, password: "x", urls: [], notes: "" } };
}

beforeEach(() => {
  vi.clearAllMocks();
  (browser.runtime as unknown as { onMessage: { addListener: typeof mockAddListener; removeListener: typeof mockRemoveListener } }).onMessage = {
    addListener: mockAddListener,
    removeListener: mockRemoveListener,
  };
});

describe("ItemListView", () => {
  it("Test 1: fetches vault.list once on mount and client-side-filters on every keystroke (no extra sendMessage per keystroke)", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") {
        return { items: [loginItem("1", "GitHub", "octo"), loginItem("2", "GitLab", "tanuki")], folders: [] };
      }
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    const listCallsBefore = mockSendMessage.mock.calls.filter(([m]) => m.kind === "vault.list").length;
    expect(listCallsBefore).toBe(1);

    const search = screen.getByPlaceholderText(/search|szukaj/i);
    fireEvent.change(search, { target: { value: "lab" } });

    expect(screen.getByText("GitLab")).toBeInTheDocument();
    expect(screen.queryByText("GitHub")).not.toBeInTheDocument();
    const listCallsAfter = mockSendMessage.mock.calls.filter(([m]) => m.kind === "vault.list").length;
    expect(listCallsAfter).toBe(1);
  });

  it("Test 2: a vault.updated broadcast re-fetches vault.list and re-renders in place", async () => {
    let callCount = 0;
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") {
        callCount += 1;
        return callCount === 1
          ? { items: [loginItem("1", "GitHub", "octo")], folders: [] }
          : { items: [loginItem("1", "GitHub", "octo"), loginItem("2", "New Item", "u")], folders: [] };
      }
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());

    expect(mockAddListener).toHaveBeenCalledTimes(1);
    const listener = mockAddListener.mock.calls[0][0] as (message: unknown) => void;
    listener({ kind: "vault.updated" });

    await waitFor(() => expect(screen.getByText("New Item")).toBeInTheDocument());
  });

  it("Test 3: zero items renders the vault-empty copy; a non-empty search with zero matches renders the reused no-matches line", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/empty so far/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/search|szukaj/i), { target: { value: "zzz" } });
    expect(screen.getByText(/no matches for "zzz"/i)).toBeInTheDocument();
  });

  it("Test 4: the auto-lock select's onChange calls session.setAutoLockMinutes immediately, no confirm", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "session.setAutoLockMinutes") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "session.status" })));

    const select = screen.getByLabelText(/auto-lock/i);
    fireEvent.change(select, { target: { value: "60" } });

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "session.setAutoLockMinutes", minutes: 60 }),
      );
    });
  });

  it("Test 5: the 'open full vault' control calls config.get then browser.tabs.create with the resolved baseUrl (never a hard-coded literal)", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "config.get") return { baseUrl: "https://my-configured-vault.example" };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/empty so far/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /full screen|pełny widok/i }));

    await waitFor(() => {
      expect(mockTabsCreate).toHaveBeenCalledWith({ url: "https://my-configured-vault.example" });
    });
  });

  it("Test 6 (BINDING): the header gear opens '${baseUrl}/?panel=settings' and the '+' new-item button opens '${baseUrl}/?action=new-item', both via config.get -> tabs.create", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "config.get") return { baseUrl: "https://my-configured-vault.example" };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/empty so far/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /settings|ustawienia/i }));
    await waitFor(() => {
      expect(mockTabsCreate).toHaveBeenCalledWith({ url: "https://my-configured-vault.example/?panel=settings" });
    });

    mockTabsCreate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /new item|nowy element/i }));
    await waitFor(() => {
      expect(mockTabsCreate).toHaveBeenCalledWith({ url: "https://my-configured-vault.example/?action=new-item" });
    });

    // Neither renders any in-popup form/type-picker.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
