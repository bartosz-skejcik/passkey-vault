// App.tsx's top-level view-state switch (RED-first per this plan's TDD
// discipline): Test 1/2 below are this plan's Task 2 behaviors,
// unaffected by the AMENDMENT 2026-07-15 (which only supersedes
// UnlockView's PRF wiring, not App.tsx's gating order).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { mockSendMessage, mockStorageSessionGet, listeners, sessionStorageListeners } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  // Phase 12 (Plan 12-04): App.tsx's checkPendingCeremony() reads this on
  // every refreshFromScratch() -- defaults to "nothing pending" so every
  // pre-Phase-12 test in this file (which never primes it) keeps its
  // existing behavior unchanged.
  mockStorageSessionGet: vi.fn().mockResolvedValue({}),
  // CR-01: a real (not vi.fn()-stubbed) addListener/removeListener pair so
  // tests can fire a broadcast (e.g. `session.locked`) exactly like a real
  // browser.runtime.onMessage dispatch -- every currently-mounted listener
  // (App.tsx's own + ItemListView's `vault.updated` one, when mounted) gets
  // called, and removeListener genuinely stops a listener firing after its
  // owning component unmounts.
  listeners: [] as Array<(message: unknown) => void>,
  // Phase 12 (Plan 12-06, NEW BLOCKER fix): same real addListener/
  // removeListener pair, but for `browser.storage.session.onChanged` --
  // backs App.tsx's reactive re-check of PENDING_CEREMONY_KEY.
  sessionStorageListeners: [] as Array<
    (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void
  >,
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
    storage: {
      session: {
        get: mockStorageSessionGet,
        onChanged: {
          addListener: (
            fn: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void,
          ) => {
            sessionStorageListeners.push(fn);
          },
          removeListener: (
            fn: (changes: Record<string, { newValue?: unknown; oldValue?: unknown }>) => void,
          ) => {
            const idx = sessionStorageListeners.indexOf(fn);
            if (idx >= 0) sessionStorageListeners.splice(idx, 1);
          },
        },
      },
    },
  },
}));

function broadcast(message: unknown) {
  for (const listener of [...listeners]) {
    listener(message);
  }
}

/** Simulates `browser.storage.session.onChanged` firing -- `changes` mirrors
 * the real API's shape (`Record<key, {newValue?, oldValue?}>`). */
function broadcastSessionStorageChange(
  changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
) {
  for (const listener of [...sessionStorageListeners]) {
    listener(changes);
  }
}

import App from "./App";

beforeEach(() => {
  vi.clearAllMocks();
  listeners.length = 0;
  sessionStorageListeners.length = 0;
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

  // Phase 12 (Plan 12-04, Task 3): the provider-ceremony ViewState takeover
  // -- mounted when chrome.storage.session carries provider-ceremony.ts's
  // multi-match picker payload (`{requestId, rpId, candidates}`), checked
  // FIRST in refreshFromScratch(), before config.get/session.status. No
  // popup-router.test.tsx exists -- these live here per the plan's own
  // instruction.
  describe("Phase 12: provider-ceremony ViewState takeover", () => {
    const CANDIDATES = [
      { itemId: "cred-1", label: "alice" },
      { itemId: "cred-2", label: "bob" },
    ];

    it("a pending multi-match picker payload takes over focus immediately -- session.status/config.get are never even called", async () => {
      mockStorageSessionGet.mockResolvedValue({
        "pv-pending-provider-ceremony": {
          requestId: "req-1",
          kind: "get",
          rpId: "example.com",
          prfRequested: false,
          candidates: CANDIDATES,
        },
      });
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        throw new Error(`unexpected message in this test: ${message.kind}`);
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId("provider-credential-row-cred-1")).toBeInTheDocument();
      });
      expect(screen.getByTestId("provider-credential-row-cred-2")).toBeInTheDocument();
      expect(screen.getByText("example.com")).toBeInTheDocument();
      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it("no pending ceremony: renders the ordinary flow unchanged (config.get still runs)", async () => {
      mockStorageSessionGet.mockResolvedValue({});
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        if (message.kind === "config.get") return null;
        throw new Error(`unexpected message in this test: ${message.kind}`);
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByRole("heading")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("provider-confirm")).not.toBeInTheDocument();
    });

    it("selecting a candidate then confirming sends provider.resolveChoice with that itemId, then returns to the list view", async () => {
      mockStorageSessionGet.mockResolvedValue({
        "pv-pending-provider-ceremony": {
          requestId: "req-1",
          kind: "get",
          rpId: "example.com",
          prfRequested: false,
          candidates: CANDIDATES,
        },
      });
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        if (message.kind === "provider.resolveChoice") return { ok: true };
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
      await waitFor(() => screen.getByTestId("provider-credential-row-cred-2"));

      screen.getByTestId("provider-credential-row-cred-2").click();
      // Selection is async React state -- wait for the re-render to reflect
      // it before clicking confirm, otherwise confirm's click handler still
      // closes over the PRE-selection render.
      await waitFor(() => {
        expect(screen.getByTestId("provider-credential-row-cred-2")).toHaveAttribute(
          "aria-checked",
          "true",
        );
      });
      screen.getByTestId("provider-confirm").click();

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          kind: "provider.resolveChoice",
          requestId: "req-1",
          itemId: "cred-2",
        });
      });
      // Resolution returns to the popup's ordinary flow (list, since the
      // vault was already unlocked -- resolvePasskeyChoice only runs
      // post-unlock).
      await waitFor(() => {
        expect(screen.queryByTestId("provider-confirm")).not.toBeInTheDocument();
      });
    });

    it("declining (Use something else) sends provider.resolveChoice with itemId: null", async () => {
      mockStorageSessionGet.mockResolvedValue({
        "pv-pending-provider-ceremony": {
          requestId: "req-2",
          kind: "get",
          rpId: "example.com",
          prfRequested: false,
          candidates: CANDIDATES,
        },
      });
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        if (message.kind === "provider.resolveChoice") return { ok: true };
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
      await waitFor(() => screen.getByTestId("provider-decline"));

      screen.getByTestId("provider-decline").click();

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          kind: "provider.resolveChoice",
          requestId: "req-2",
          itemId: null,
        });
      });
    });

    it("a single-candidate picker payload pre-selects it -- CTA enabled with no radiogroup rendered", async () => {
      mockStorageSessionGet.mockResolvedValue({
        "pv-pending-provider-ceremony": {
          requestId: "req-3",
          kind: "get",
          rpId: "example.com",
          prfRequested: false,
          candidates: [{ itemId: "cred-1", label: "alice" }],
        },
      });
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        throw new Error(`unexpected message in this test: ${message.kind}`);
      });

      render(<App />);

      await waitFor(() => {
        expect(screen.getByTestId("provider-confirm")).toBeEnabled();
      });
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    });

    // Phase 12 (Plan 12-05, Decision A): create()/single-match get() now
    // ALSO write this same payload shape (`kind: "create"`/`"get"`) --
    // these two tests close 12-04-SUMMARY's documented gap ("the
    // create()/single-get consent states are unreachable in production
    // today").
    it("Decision A: a pending 'create' consent payload mounts the create-consent screen, with no candidate list", async () => {
      mockStorageSessionGet.mockResolvedValue({
        "pv-pending-provider-ceremony": {
          requestId: "req-create-1",
          kind: "create",
          rpId: "example.com",
          account: "alice@example.com",
          prfRequested: false,
          candidates: [],
        },
      });
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        if (message.kind === "provider.resolveChoice") return { ok: true };
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
        expect(screen.getByTestId("provider-confirm")).toBeInTheDocument();
      });
      expect(screen.getByText("example.com")).toBeInTheDocument();
      expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
      // CTA must be enabled with no candidate to select at all -- create()
      // has no picker list.
      expect(screen.getByTestId("provider-confirm")).toBeEnabled();

      screen.getByTestId("provider-confirm").click();

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          kind: "provider.resolveChoice",
          requestId: "req-create-1",
          itemId: "confirmed",
        });
      });
    });

    it("Decision A: declining a pending 'create' consent payload sends provider.resolveChoice with itemId: null", async () => {
      mockStorageSessionGet.mockResolvedValue({
        "pv-pending-provider-ceremony": {
          requestId: "req-create-2",
          kind: "create",
          rpId: "example.com",
          prfRequested: false,
          candidates: [],
        },
      });
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        if (message.kind === "provider.resolveChoice") return { ok: true };
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
      await waitFor(() => screen.getByTestId("provider-decline"));

      screen.getByTestId("provider-decline").click();

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          kind: "provider.resolveChoice",
          requestId: "req-create-2",
          itemId: null,
        });
      });
    });

    it("Decision A: a pending single-match 'get' consent payload confirms with the pre-selected candidate's itemId", async () => {
      mockStorageSessionGet.mockResolvedValue({
        "pv-pending-provider-ceremony": {
          requestId: "req-get-single-1",
          kind: "get",
          rpId: "example.com",
          prfRequested: false,
          candidates: [{ itemId: "cred-solo", label: "alice" }],
        },
      });
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        if (message.kind === "provider.resolveChoice") return { ok: true };
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
        expect(screen.getByTestId("provider-confirm")).toBeEnabled();
      });
      expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();

      screen.getByTestId("provider-confirm").click();

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({
          kind: "provider.resolveChoice",
          requestId: "req-get-single-1",
          itemId: "cred-solo",
        });
      });
    });

    // Phase 12 (Plan 12-06, NEW BLOCKER fix): 12-05's checkPendingCeremony()
    // was only ever called ONCE, at mount -- on the locked-vault sequence
    // (popup opens on UnlockView because the vault is locked -> user
    // unlocks -> provider-ceremony.ts's awaitCeremonyConsent() writes the
    // REAL consent payload only AFTER that unlock resolves) that one-shot
    // check ran too early, so the consent screen never appeared and the
    // ceremony silently fell through to native. These tests exercise the
    // new `storage.session.onChanged` reactive listener that closes this
    // gap.
    describe("NEW BLOCKER fix (12-06): storage.session.onChanged reactive re-check", () => {
      it("locked-vault sequence: a 'create' consent payload written AFTER mount (post-unlock) reactively mounts ProviderCeremonyView", async () => {
        mockStorageSessionGet.mockResolvedValueOnce({}); // nothing pending yet, at mount
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

        // Background writes the real consent payload right after the user
        // unlocks -- simulated here directly via the storage.session
        // onChanged broadcast (no real unlock flow needed for this test;
        // UnlockView's own unlock wiring is exercised elsewhere).
        const createPayload = {
          requestId: "req-locked-create",
          kind: "create",
          rpId: "example.com",
          account: "alice@example.com",
          prfRequested: false,
          candidates: [],
        };
        mockStorageSessionGet.mockResolvedValue({ "pv-pending-provider-ceremony": createPayload });
        broadcastSessionStorageChange({
          "pv-pending-provider-ceremony": { newValue: createPayload },
        });

        await waitFor(() => {
          expect(screen.getByTestId("provider-confirm")).toBeInTheDocument();
        });
        expect(screen.getByText("example.com")).toBeInTheDocument();
        expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
        // The password field is gone -- the ceremony view took over focus,
        // not merely rendered alongside UnlockView.
        expect(screen.queryByLabelText(/hasło|password/i)).not.toBeInTheDocument();
      });

      it("locked-vault sequence: a single-match 'get' consent payload written AFTER mount reactively mounts ProviderCeremonyView, pre-selected", async () => {
        mockStorageSessionGet.mockResolvedValueOnce({});
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

        const getPayload = {
          requestId: "req-locked-get-single",
          kind: "get",
          rpId: "example.com",
          prfRequested: false,
          candidates: [{ itemId: "cred-solo", label: "alice" }],
        };
        mockStorageSessionGet.mockResolvedValue({ "pv-pending-provider-ceremony": getPayload });
        broadcastSessionStorageChange({
          "pv-pending-provider-ceremony": { newValue: getPayload },
        });

        await waitFor(() => {
          expect(screen.getByTestId("provider-confirm")).toBeEnabled();
        });
        expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/hasło|password/i)).not.toBeInTheDocument();
      });

      it("an onChanged event for an UNRELATED session key does not trigger a ceremony re-check or remount", async () => {
        mockStorageSessionGet.mockResolvedValue({});
        mockSendMessage.mockImplementation(async (message: { kind: string }) => {
          if (message.kind === "config.get") return null;
          throw new Error(`unexpected message in this test: ${message.kind}`);
        });

        render(<App />);
        await waitFor(() => {
          expect(screen.getByRole("heading")).toBeInTheDocument();
        });

        const callsBefore = mockStorageSessionGet.mock.calls.length;
        broadcastSessionStorageChange({ "pv-server-config": { newValue: { baseUrl: "https://x" } } });
        // Flush any microtask an (incorrect) reactive re-check would have
        // queued before asserting nothing happened.
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(mockStorageSessionGet.mock.calls.length).toBe(callsBefore);
        expect(screen.queryByTestId("provider-confirm")).not.toBeInTheDocument();
      });

      it("removing PENDING_CEREMONY_KEY while ProviderCeremonyView is shown returns to the prior/list view", async () => {
        const pendingPayload = {
          requestId: "req-abandon-1",
          kind: "get",
          rpId: "example.com",
          prfRequested: false,
          candidates: CANDIDATES,
        };
        mockStorageSessionGet.mockResolvedValue({ "pv-pending-provider-ceremony": pendingPayload });
        mockSendMessage.mockImplementation(async (message: { kind: string }) => {
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
        await waitFor(() => screen.getByTestId("provider-credential-row-cred-1"));

        // The key disappears (background resolved/abandoned the ceremony)
        // while THIS popup instance is still showing the ceremony view for
        // it -- the storage.session.get() re-check that follows must see
        // the key already gone.
        mockStorageSessionGet.mockResolvedValue({});
        broadcastSessionStorageChange({
          "pv-pending-provider-ceremony": { oldValue: pendingPayload, newValue: undefined },
        });

        await waitFor(() => {
          expect(screen.queryByTestId("provider-confirm")).not.toBeInTheDocument();
        });
        // Returned to the popup's ordinary flow (list, since the payload
        // only ever exists once the vault is unlocked, D-09).
        await waitFor(() => {
          expect(mockSendMessage).toHaveBeenCalledWith({ kind: "session.status" });
        });
      });
    });
  });
});
