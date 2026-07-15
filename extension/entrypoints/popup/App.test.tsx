// App.tsx's top-level view-state switch (RED-first per this plan's TDD
// discipline): Test 1/2 below are this plan's Task 2 behaviors,
// unaffected by the AMENDMENT 2026-07-15 (which only supersedes
// UnlockView's PRF wiring, not App.tsx's gating order).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
      // Phase 10 (Plan 10-06): ItemListView now mounts OnThisPageSection,
      // which fires its own autofill.match on mount -- benign here, this
      // test is not about autofill.
      if (message.kind === "autofill.match") {
        return {
          pageState: "restricted",
          origin: null,
          detected: { login: false, totp: false, card: false, identity: false },
          matches: [],
        };
      }
      throw new Error(`unexpected message in this test: ${message.kind}`);
    });

    render(<App />);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "session.status" }));
    });
    expect(screen.queryByLabelText(/hasło|password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/adres serwera|server address/i)).not.toBeInTheDocument();
  });

  // EXT-05's "editable later" clause (09-VERIFICATION.md gap 1): before
  // this, ServerConfigView was reachable ONLY when config === null, so a
  // user who mistyped their URL or moved their server was stuck forever.
  describe("EXT-05: Change server re-entry", () => {
    const LOCKED_STATUS = {
      kind: "locked",
      wasAutoLocked: false,
      autoLockMinutes: 15,
      extPasskeyEnrolled: false,
      extPasskeyPromptSuppressed: false,
    };

    function primeLockedWithConfig(configSet?: (rawUrl: string) => unknown) {
      mockSendMessage.mockImplementation(async (message: { kind: string; rawUrl?: string }) => {
        if (message.kind === "config.get") return { baseUrl: "https://old.example.com" };
        if (message.kind === "session.status") return LOCKED_STATUS;
        if (message.kind === "config.set") return configSet?.(message.rawUrl ?? "") ?? { ok: true };
        throw new Error(`unexpected message in this test: ${message.kind}`);
      });
    }

    it("renders a Change server link on the unlock view", async () => {
      primeLockedWithConfig();
      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /zmień serwer|change server/i })).toBeInTheDocument();
      });
    });

    it("clicking it opens the config view PRE-FILLED with the currently-persisted URL", async () => {
      primeLockedWithConfig();
      render(<App />);
      await waitFor(() => screen.getByRole("button", { name: /zmień serwer|change server/i }));

      screen.getByRole("button", { name: /zmień serwer|change server/i }).click();

      const urlInput = await screen.findByLabelText(/adres serwera|server address/i);
      // The seed is what makes this usable: a stuck user edits their typo
      // rather than retyping the whole URL from memory.
      expect(urlInput).toHaveValue("https://old.example.com");
    });

    it("cancel returns to the unlock view without changing anything", async () => {
      primeLockedWithConfig();
      render(<App />);
      await waitFor(() => screen.getByRole("button", { name: /zmień serwer|change server/i }));
      screen.getByRole("button", { name: /zmień serwer|change server/i }).click();
      await screen.findByLabelText(/adres serwera|server address/i);

      screen.getByRole("button", { name: /anuluj|cancel/i }).click();

      await waitFor(() => {
        expect(screen.getByLabelText(/hasło|password/i)).toBeInTheDocument();
      });
      expect(screen.queryByLabelText(/adres serwera|server address/i)).not.toBeInTheDocument();
      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ kind: "config.set" }),
      );
    });

    it("a successful change dispatches config.set (same normalize -> probe -> persist path) and leaves the config view", async () => {
      const configSetCalls: string[] = [];
      primeLockedWithConfig((rawUrl) => {
        configSetCalls.push(rawUrl);
        return { ok: true };
      });
      render(<App />);
      await waitFor(() => screen.getByRole("button", { name: /zmień serwer|change server/i }));
      screen.getByRole("button", { name: /zmień serwer|change server/i }).click();

      const urlInput = await screen.findByLabelText(/adres serwera|server address/i);
      fireEvent.change(urlInput, { target: { value: "https://new.example.com" } });
      fireEvent.submit(urlInput.closest("form")!);

      // Reconfigure MUST go through the identical validation path as first
      // run -- config.set is what probes /healthz before persisting, so a
      // reconfigure can no more save an unreachable server than a first run.
      await waitFor(() => {
        expect(configSetCalls).toEqual(["https://new.example.com"]);
      });
      await waitFor(() => {
        expect(screen.queryByLabelText(/adres serwera|server address/i)).not.toBeInTheDocument();
      });
    });
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
      // Phase 10 (Plan 10-06): ItemListView now mounts OnThisPageSection,
      // which fires its own autofill.match on mount -- restricted (no
      // matches) so this test's single "Example Login" text assertion
      // stays unambiguous (a match here would duplicate that text into the
      // on-page section too).
      if (message.kind === "autofill.match") {
        return {
          pageState: "restricted",
          origin: null,
          detected: { login: false, totp: false, card: false, identity: false },
          matches: [],
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
