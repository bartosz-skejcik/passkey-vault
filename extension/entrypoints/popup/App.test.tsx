// App.tsx's top-level view-state switch (RED-first per this plan's TDD
// discipline): Test 1/2 below are this plan's Task 2 behaviors,
// unaffected by the AMENDMENT 2026-07-15 (which only supersedes
// UnlockView's PRF wiring, not App.tsx's gating order).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));

vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { id: "test-extension-id", onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    tabs: { create: vi.fn() },
  },
}));

import App from "./App";

beforeEach(() => {
  vi.clearAllMocks();
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
});
