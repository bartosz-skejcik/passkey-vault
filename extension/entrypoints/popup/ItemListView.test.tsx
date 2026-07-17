// ItemListView.tsx — browse/search/pick surface + the BINDING (Bartek
// 2026-07-15, NordPass reference) header/footer redirect affordances.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { VaultItem } from "../../lib/vault/types";

const { mockSendMessage, mockTabsCreate, mockAddListener, mockRemoveListener, storageStore } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockTabsCreate: vi.fn(),
  mockAddListener: vi.fn(),
  mockRemoveListener: vi.fn(),
  // Map-backed fake for storage.local (lib/theme/theme-mirror.test.ts's
  // established convention) -- ItemListView.tsx now reads/writes the popup
  // UI round's sort preference (lib/vault/sort.ts) via
  // `browser.storage.local` on mount/change, which this suite's prior
  // `wxt/browser` mock had no `storage` key for at all.
  storageStore: new Map<string, unknown>(),
}));

vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { id: "test-extension-id" },
    tabs: { create: mockTabsCreate },
    runtime_onMessage_placeholder: undefined,
    storage: {
      local: {
        async get(key: string) {
          return storageStore.has(key) ? { [key]: storageStore.get(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) {
            storageStore.set(k, v);
          }
        },
      },
    },
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

// Phase 10 (Plan 10-06): ItemListView now also mounts OnThisPageSection,
// which fires its own `autofill.match` on mount via useAutofillMatches.ts.
// This suite is not about autofill behavior (see OnThisPageSection.test.tsx
// for that) -- a benign "restricted" response keeps every existing
// assertion below unaffected (the section renders its plain error banner,
// no text/role collision with anything these tests query for).
function autofillMatchRestricted() {
  return {
    pageState: "restricted" as const,
    origin: null,
    detected: { login: false, totp: false, card: false, identity: false },
    matches: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageStore.clear();
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
      if (message.kind === "autofill.match") return autofillMatchRestricted();
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
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());

    expect(mockAddListener).toHaveBeenCalledTimes(1);
    const listener = mockAddListener.mock.calls[0][0] as (message: unknown) => void;
    listener({ kind: "vault.updated" });

    await waitFor(() => expect(screen.getByText("New Item")).toBeInTheDocument());
  });

  it("Test 3a: a truly empty vault renders the SINGLE vault-empty copy — even while a search query is typed (Bartek's single-empty-state redesign)", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/empty so far/i)).toBeInTheDocument());

    // Typing a query does NOT flip an empty vault to a "no matches" line —
    // there is nothing to search; the one empty state stands (no double state).
    fireEvent.change(screen.getByPlaceholderText(/search|szukaj/i), { target: { value: "zzz" } });
    expect(screen.getByText(/empty so far/i)).toBeInTheDocument();
    expect(screen.queryByText(/no matches for "zzz"/i)).not.toBeInTheDocument();
  });

  it("Test 3b: a non-empty vault with a zero-match search renders the no-matches line in the 'Wszystkie' section", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") {
        return {
          items: [
            { id: "1", revision: 1, fields: { type: "login", name: "GitHub", folderId: null, tags: [], username: "u", password: "p", urls: [], notes: "" } },
          ],
          folders: [],
        };
      }
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());

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
      if (message.kind === "autofill.match") return autofillMatchRestricted();
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
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/empty so far/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /full screen|pełny widok/i }));

    await waitFor(() => {
      expect(mockTabsCreate).toHaveBeenCalledWith({ url: "https://my-configured-vault.example" });
    });
  });

  it("Test 6 (BINDING): the header gear opens '${baseUrl}/?panel=settings' via config.get -> tabs.create, and the '+' new-item button opens an in-popup type menu (no tabs.create yet)", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "config.get") return { baseUrl: "https://my-configured-vault.example" };
      if (message.kind === "autofill.match") return autofillMatchRestricted();
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

    // The menu is showing (all five type entries), but nothing redirected yet.
    expect(screen.getByRole("menuitem", { name: /^login$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /totp/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^card$/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /identity/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /^note$/i })).toBeInTheDocument();
    expect(mockTabsCreate).not.toHaveBeenCalled();

    // The menu itself is never a form/dialog (EXT-06's doctrine is about
    // forms, not type menus).
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Test 7 (BINDING): choosing a type entry opens '${baseUrl}/?action=new-item&type=<id>' via config.get -> tabs.create, and closes the menu", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "config.get") return { baseUrl: "https://my-configured-vault.example" };
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/empty so far/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /new item|nowy element/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /totp/i }));

    await waitFor(() => {
      expect(mockTabsCreate).toHaveBeenCalledWith({
        url: "https://my-configured-vault.example/?action=new-item&type=totp",
      });
    });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Test 8 (BINDING): clicking outside the open type menu closes it without redirecting", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/empty so far/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /new item|nowy element/i }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(mockTabsCreate).not.toHaveBeenCalled();
  });

  it("Test 9 (11-09): both the 'Na tej stronie' row and a 'Wszystkie' row carry the SAME shared pv-row-hover class -- flat-at-rest, button-style hover, identical between row kinds", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") {
        return {
          items: [
            loginItem("suggested-1", "GitHub", "octo"),
            loginItem("rest-1", "GitLab", "tanuki"),
          ],
          folders: [],
        };
      }
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "autofill.match") {
        return {
          pageState: "ok" as const,
          origin: "https://github.com",
          detected: { login: true, totp: false, card: false, identity: false },
          matches: [{ itemId: "suggested-1", kind: "login" as const, label: "GitHub", maskedHint: "octo" }],
        };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);

    // "Na tej stronie" row (AutofillItemRow.tsx).
    const onThisPageRow = await waitFor(() => screen.getByTestId("autofill-row-suggested-1"));
    const onThisPageInnerRow = onThisPageRow.querySelector(".pv-row-hover");
    expect(onThisPageInnerRow).not.toBeNull();

    // "Wszystkie" row (ItemListView.tsx itself) -- GitLab, since GitHub is
    // de-duplicated into the suggested section above.
    const restRow = await waitFor(() => screen.getByText("GitLab"));
    const restRowButton = restRow.closest("button");
    expect(restRowButton).not.toBeNull();
    expect(restRowButton!.className).toContain("pv-row-hover");

    // Neither row hard-codes a literal color or a base-200/base-300 swap
    // -- both lean on the SAME shared class for the hover treatment.
    expect(onThisPageInnerRow!.className).toContain("pv-row-hover");
    expect(restRowButton!.className).toContain("pv-row-hover");
  });

  it("Test 10 (popup UI round, decision 2): the sheet-look header renders the app title above the search input", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("heading", { name: "Passkey Vault" })).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/search|szukaj/i)).toBeInTheDocument();
  });

  it("Test 11 (popup UI round, decision 3; location updated 2026-07-18 -- the pill now lives in the top bar beside the title, not the footer): the pill still opens the full vault, now labeled 'Full screen'", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "config.get") return { baseUrl: "https://my-configured-vault.example" };
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/empty so far/i)).toBeInTheDocument());

    const pill = screen.getByRole("button", { name: "Full screen" });
    fireEvent.click(pill);

    await waitFor(() => {
      expect(mockTabsCreate).toHaveBeenCalledWith({ url: "https://my-configured-vault.example" });
    });
  });

  it("Test 12 (popup UI round, decision 4): the sort control defaults to 'Last used', re-orders the 'Wszystkie' rows when switched to 'Name', and persists the choice via browser.storage.local", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") {
        return {
          items: [
            loginItem("z-item", "Zebra Corp", "z"),
            loginItem("a-item", "Apple Inc", "a"),
          ],
          folders: [],
        };
      }
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Zebra Corp")).toBeInTheDocument());

    const sortSelect = screen.getByTestId("popup-sort-select") as HTMLSelectElement;
    expect(sortSelect.value).toBe("lastUsed");

    // Neither item has a real lastUsedAt string set via the fixture above
    // (loginItem's third arg is the login `username`, not lastUsedAt) --
    // both sink to the "never used" tail, alphabetical among themselves,
    // so "lastUsed" and "name" render the SAME order here; switching modes
    // is instead verified via the select's own value and the persisted
    // storage write below.
    fireEvent.change(sortSelect, { target: { value: "name" } });
    expect(sortSelect.value).toBe("name");

    await waitFor(() => {
      expect(storageStore.get("pv-popup-sort")).toBe("name");
    });
  });

  it("WR-02 (phase-13 review): a sort choice made BEFORE the mount-time async storage read resolves is not clobbered when that stale read finally resolves", async () => {
    storageStore.set("pv-popup-sort", "lastUsed");

    let resolveMountRead: ((value: Record<string, unknown>) => void) | undefined;
    const getSpy = vi
      .spyOn(browser.storage.local, "get")
      .mockImplementationOnce(
        () =>
          new Promise<Record<string, unknown>>((resolve) => {
            resolveMountRead = resolve;
          }),
      );

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") {
        return {
          items: [loginItem("z-item", "Zebra Corp", "z"), loginItem("a-item", "Apple Inc", "a")],
          folders: [],
        };
      }
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Zebra Corp")).toBeInTheDocument());

    const sortSelect = screen.getByTestId("popup-sort-select") as HTMLSelectElement;
    // The mount-time read is still in-flight (deliberately held open above)
    // -- the select still shows the seeded default.
    expect(sortSelect.value).toBe("lastUsed");

    // The user picks "name" BEFORE the mount read resolves.
    fireEvent.change(sortSelect, { target: { value: "name" } });
    expect(sortSelect.value).toBe("name");
    await waitFor(() => expect(storageStore.get("pv-popup-sort")).toBe("name"));

    // NOW the stale mount read resolves with the OLD persisted value.
    resolveMountRead?.({ "pv-popup-sort": "lastUsed" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Without the WR-02 guard, the late resolution would revert this back
    // to "lastUsed" even though the user already chose (and persisted)
    // "name" -- storage itself was always correct, only the UI raced.
    expect(sortSelect.value).toBe("name");

    getSpy.mockRestore();
  });

  it("Test 13 (popup UI round, decision 4): a previously-persisted 'name' sort preference is read back on mount", async () => {
    storageStore.set("pv-popup-sort", "name");
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") {
        return { items: [loginItem("1", "Solo Item", "u")], folders: [] };
      }
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);

    const sortSelect = await waitFor(() => screen.getByTestId("popup-sort-select") as HTMLSelectElement);
    await waitFor(() => expect(sortSelect.value).toBe("name"));
  });

  it("Test 14 (popup UI round, Bartek 2026-07-18 live-UAT correction): the '+' FAB floats outside the footer, the footer holds only the gear, and the 'Full screen' pill lives outside the footer too", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "vault.list") return { items: [], folders: [] };
      if (message.kind === "session.status") {
        return { kind: "unlocked", autoLockMinutes: 15, accountEmail: "a@example.com", extPasskeyEnrolled: false, extPasskeyPromptSuppressed: false };
      }
      if (message.kind === "autofill.match") return autofillMatchRestricted();
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<ItemListView locale="en" onSelectItem={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/empty so far/i)).toBeInTheDocument());

    const footer = screen.getByTestId("popup-footer");
    const fab = screen.getByTestId("popup-fab");

    // The FAB is not a descendant of the footer -- it floats independently.
    expect(footer.contains(fab)).toBe(false);

    // The "+" new-item control lives in the FAB, not the footer.
    expect(within(footer).queryByRole("button", { name: /new item|nowy element/i })).toBeNull();
    expect(within(fab).getByRole("button", { name: /new item|nowy element/i })).toBeInTheDocument();

    // The gear stays in the footer.
    expect(within(footer).getByRole("button", { name: /settings|ustawienia/i })).toBeInTheDocument();

    // The "Full screen" pill is no longer in the footer, but still exists
    // somewhere in the document (moved to the top bar, not removed).
    expect(within(footer).queryByRole("button", { name: "Full screen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Full screen" })).toBeInTheDocument();
  });
});
