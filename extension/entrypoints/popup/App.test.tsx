// App.tsx's top-level view-state switch (RED-first per this plan's TDD
// discipline): Test 1/2 below are this plan's Task 2 behaviors,
// unaffected by the AMENDMENT 2026-07-15 (which only supersedes
// UnlockView's PRF wiring, not App.tsx's gating order).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockSendMessage, listeners } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  // CR-01: a real (not vi.fn()-stubbed) addListener/removeListener pair so
  // tests can fire a broadcast (e.g. `session.locked`) exactly like a real
  // browser.runtime.onMessage dispatch -- every currently-mounted listener
  // (App.tsx's own + ItemListView's `vault.updated` one, when mounted) gets
  // called, and removeListener genuinely stops a listener firing after its
  // owning component unmounts.
  listeners: [] as Array<(message: unknown) => void>,
}));

vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-extension-id",
      onMessage: {
        addListener: (fn: (message: unknown) => void) => {
          listeners.push(fn);
        },
        removeListener: (fn: (message: unknown) => void) => {
          const idx = listeners.indexOf(fn);
          if (idx >= 0) listeners.splice(idx, 1);
        },
      },
    },
    tabs: { create: vi.fn() },
  },
}));

function broadcast(message: unknown) {
  for (const listener of [...listeners]) {
    listener(message);
  }
}

import App from "./App";

beforeEach(() => {
  vi.clearAllMocks();
  listeners.length = 0;
});

describe("App.tsx view-state switch", () => {
  it("Test 1: renders ServerConfigView (first-run gate) when config.get resolves null -- session.status is never called", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return null;
      throw new Error(`unexpected message in this test: ${message.kind}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading")).toBeInTheDocument();
    });
    // The first-run gate takes priority over everything else: no unlock UI
    // (email/password fields) can render without a configured server.
    expect(screen.queryByLabelText(/hasło|password/i)).not.toBeInTheDocument();
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "session.status" }),
    );
  });

  it("Test 2: config resolved + session.status 'locked' renders UnlockView (password field present)", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      if (message.kind === "session.status") {
        return {
          kind: "locked",
          wasAutoLocked: false,
          autoLockMinutes: 15,
          extPasskeyEnrolled: false,
          extPasskeyPromptSuppressed: false,
        };
      }
      throw new Error(`unexpected message in this test: ${message.kind}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText(/hasło|password/i)).toBeInTheDocument();
    });
    // Server-config's URL input must not also be present at the same time.
    expect(screen.queryByLabelText(/adres serwera|server address/i)).not.toBeInTheDocument();
  });

  it("Test 2b: session.status 'unlocked' renders neither UnlockView's password field nor ServerConfigView's URL field", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      if (message.kind === "session.status") {
        return {
          kind: "unlocked",
          autoLockMinutes: 15,
          accountEmail: "a@example.com",
          extPasskeyEnrolled: false,
          extPasskeyPromptSuppressed: false,
        };
      }
      if (message.kind === "vault.list") return { items: [], folders: [] };
      throw new Error(`unexpected message in this test: ${message.kind}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "session.status" }));
    });
    expect(screen.queryByLabelText(/hasło|password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/adres serwera|server address/i)).not.toBeInTheDocument();
  });

  it("CR-01: a session.locked broadcast while on ItemDetailView drops back to UnlockView and clears the decrypted item from view", async () => {
    let sessionStatusCalls = 0;
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      if (message.kind === "session.status") {
        sessionStatusCalls += 1;
        if (sessionStatusCalls === 1) {
          return {
            kind: "unlocked",
            autoLockMinutes: 15,
            accountEmail: "a@example.com",
            extPasskeyEnrolled: false,
            extPasskeyPromptSuppressed: false,
          };
        }
        // The lock listener's re-check -- authoritative, never trusts the
        // stale "unlocked" view it just came from.
        return {
          kind: "locked",
          wasAutoLocked: true,
          autoLockMinutes: 15,
          extPasskeyEnrolled: false,
          extPasskeyPromptSuppressed: false,
        };
      }
      if (message.kind === "vault.list") {
        return {
          items: [
            {
              id: "item-1",
              revision: 1,
              updatedAt: "2026-07-15T00:00:00Z",
              fields: { type: "login", name: "Example Login", username: "user1", password: "s3cr3t!", notes: "" },
            },
          ],
          folders: [],
        };
      }
      throw new Error(`unexpected message in this test: ${message.kind}`);
    });

    render(<App />);

    // Navigate into ItemDetailView by selecting the one item.
    await waitFor(() => {
      expect(screen.getByText("Example Login")).toBeInTheDocument();
    });
    screen.getByText("Example Login").click();

    // Now on the detail view -- the decrypted item's own heading renders.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Example Login" })).toBeInTheDocument();
    });

    // Fire the lock broadcast exactly as vault-session.ts's
    // lockVaultSession() does -- from a genuine background auto-lock.
    broadcast({ kind: "session.locked" });

    // The detail view (and its decrypted fields, held in App.tsx's own
    // React state) must be gone, replaced by UnlockView -- proving the
    // listener re-read authoritative status and reset the view from
    // "detail", not just from "list" (the bug: ItemListView's own listener
    // is unmounted while on this view, so nothing else could have reacted).
    await waitFor(() => {
      expect(screen.getByLabelText(/hasło|password/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("heading", { name: "Example Login" })).not.toBeInTheDocument();
    expect(screen.queryByText("s3cr3t!")).not.toBeInTheDocument();
  });
});
