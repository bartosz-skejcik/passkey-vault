// ServerConfigView — pins two contracts:
//
// 1. The FIRST-RUN / nothing-to-lose persist-first ordering found by the
//    second real-browser Phase 9 UAT pass: chrome.permissions.request()
//    opens a native prompt that steals focus and CLOSES the MV3 popup, so
//    config.set (which persists the server URL) MUST run and complete
//    BEFORE the permission request -- otherwise the popup closing mid-await
//    strands the user on this same screen after clicking Allow, requiring a
//    second submit. onConfigured() therefore fires as soon as config.set
//    succeeds, regardless of whether the subsequent best-effort permission
//    grant is accepted, denied, or rejects outright.
//
// 2. Plan 15-05 (AUTH-04): a switch AWAY from a server with a live session
//    or host permission goes through an explicit confirmation dialog
//    first, and the migration sequence (grant new -> sign out old ->
//    persist new -> revoke old) runs in that exact order (Pitfall 1,
//    15-RESEARCH.md).
//
// mockSendMessage is dispatched PER KIND (not a single blanket
// mockResolvedValue) -- the new handleSubmit calls config.get, config.probe,
// session.status, session.signOut, and config.set, each expecting a
// differently-shaped response, so a single flat mock would misroute.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockPermissionsRequest = vi.hoisted(() => vi.fn());
const mockPermissionsContains = vi.hoisted(() => vi.fn());
const mockPermissionsRemove = vi.hoisted(() => vi.fn());

vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    permissions: {
      request: mockPermissionsRequest,
      contains: mockPermissionsContains,
      remove: mockPermissionsRemove,
    },
    // D-11: ServerConfigView's cors-blocked branch computes the
    // extension's own origin via `browser.runtime.getURL("")` -- mirrors
    // the real Chrome/Firefox shape (a full extension-scheme URL) so
    // `new URL(...).origin` round-trips exactly like it would in a real
    // browser.
    runtime: { getURL: () => "chrome-extension://test-extension-id/" },
  },
}));

import ServerConfigView from "./ServerConfigView";

type MockMessage = { kind: string; rawUrl?: string };

/**
 * Routes `sendMessage` by `kind` -- every test supplies only the kinds it
 * cares about via `overrides`; anything else throws loudly (mirrors
 * App.test.tsx's `primeLockedWithConfig` per-kind-dispatch convention) so a
 * missing mock fails fast instead of silently misrouting.
 */
function mockMessagesByKind(overrides: Record<string, (message: MockMessage) => unknown>) {
  mockSendMessage.mockImplementation(async (message: MockMessage) => {
    if (message.kind in overrides) {
      return overrides[message.kind](message);
    }
    throw new Error(`unexpected message in this test: ${message.kind}`);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPermissionsRequest.mockResolvedValue(true);
  mockPermissionsContains.mockResolvedValue(false);
  mockPermissionsRemove.mockResolvedValue(true);
});

async function fillAndSubmit(url: string) {
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText(/adres serwera|server address/i));
  await user.type(screen.getByLabelText(/adres serwera|server address/i), url);
  await user.click(screen.getByRole("button", { name: /połącz|connect/i }));
}

describe("ServerConfigView — nothing-to-lose path (first-run / same-url / no session-or-permission)", () => {
  it("first-run (config.get -> null): persists immediately via config.set, confirm dialog never shown, dispatches config.set BEFORE requesting the permission grant", async () => {
    mockMessagesByKind({
      "config.get": () => null,
      "config.probe": () => ({ ok: true }),
      "config.set": () => ({ ok: true }),
    });
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://LOCALHOST:8620/");

    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    expect(mockSendMessage).toHaveBeenCalledWith({
      kind: "config.set",
      rawUrl: "http://LOCALHOST:8620/",
    });
    await waitFor(() =>
      expect(mockPermissionsRequest).toHaveBeenCalledWith({
        origins: ["http://localhost:8620/*"],
      }),
    );
    // persistence precedes the (best-effort) permission request
    const configSetCallIndex = mockSendMessage.mock.calls.findIndex(
      ([m]) => m.kind === "config.set",
    );
    expect(mockSendMessage.mock.invocationCallOrder[configSetCallIndex]).toBeLessThan(
      mockPermissionsRequest.mock.invocationCallOrder[0],
    );
    expect(screen.queryByText(/zmiana serwera|changing servers/i)).not.toBeInTheDocument();
  });

  it("onConfigured fires even when the permission prompt is denied — the popup closing/losing the grant never strands the user", async () => {
    mockMessagesByKind({
      "config.get": () => null,
      "config.probe": () => ({ ok: true }),
      "config.set": () => ({ ok: true }),
    });
    mockPermissionsRequest.mockResolvedValue(false);
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://localhost:8620");

    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    await waitFor(() => expect(mockPermissionsRequest).toHaveBeenCalled());
  });

  it("onConfigured fires even when permissions.request() rejects outright (e.g. the prompt killed the popup mid-await)", async () => {
    mockMessagesByKind({
      "config.get": () => null,
      "config.probe": () => ({ ok: true }),
      "config.set": () => ({ ok: true }),
    });
    mockPermissionsRequest.mockRejectedValue(new Error("popup closed"));
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://localhost:8620");

    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
  });

  it("config.probe failure (unreachable server) → error copy shown, onConfigured never fires, config.set/permission never dispatched", async () => {
    mockMessagesByKind({
      "config.get": () => null,
      "config.probe": () => ({ ok: false, error: "unreachable" }),
    });
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://localhost:8620");

    await waitFor(() =>
      expect(screen.getByText(/can't reach that server/i)).toBeInTheDocument(),
    );
    expect(onConfigured).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "config.set" }));
    expect(mockPermissionsRequest).not.toHaveBeenCalled();
  });

  it("config.probe failure (cors-blocked) → distinct CORS-blocked copy with the extension's own origin, never the generic unreachable message", async () => {
    mockMessagesByKind({
      "config.get": () => null,
      "config.probe": () => ({ ok: false, error: "cors-blocked" }),
    });
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://localhost:8620");

    await waitFor(() =>
      expect(screen.getByText(/PV_EXTENSION_ORIGINS/i)).toBeInTheDocument(),
    );
    expect(screen.getByText("chrome-extension://test-extension-id")).toBeInTheDocument();
    expect(screen.queryByText(/can't reach that server/i)).not.toBeInTheDocument();
    expect(onConfigured).not.toHaveBeenCalled();
    expect(mockPermissionsRequest).not.toHaveBeenCalled();
  });

  it("invalid URL → no sendMessage dispatch at all, no permission prompt, invalid-url copy", async () => {
    mockSendMessage.mockImplementation(async () => {
      throw new Error("sendMessage must not be called for a locally-invalid URL");
    });
    render(<ServerConfigView locale="en" onConfigured={vi.fn()} />);
    await fillAndSubmit("ftp://nope");

    await waitFor(() => expect(screen.getByText(/invalid address/i)).toBeInTheDocument());
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockPermissionsRequest).not.toHaveBeenCalled();
  });

  it("resubmitting the SAME url as already configured never shows the confirm dialog, even with an existing session for it", async () => {
    mockMessagesByKind({
      "config.get": () => ({ baseUrl: "http://localhost:8620" }),
      "config.probe": () => ({ ok: true }),
      "config.set": () => ({ ok: true }),
      // session.status must never be called: oldConfig.baseUrl === normalized
      // short-circuits BEFORE needsConfirm() ever runs.
      "session.status": () => {
        throw new Error("session.status should not be called for a same-url resubmit");
      },
    });
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://localhost:8620");

    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "config.set" }),
    );
    expect(screen.queryByText(/zmiana serwera|changing servers/i)).not.toBeInTheDocument();
  });

  it("a NEW url when no session/permission exists for the OLD one falls through to the direct persist path, confirm dialog never shown", async () => {
    mockMessagesByKind({
      "config.get": () => ({ baseUrl: "http://old.example.com" }),
      "config.probe": () => ({ ok: true }),
      "config.set": () => ({ ok: true }),
      "session.status": () => ({ kind: "no-session" }),
    });
    mockPermissionsContains.mockResolvedValue(false);
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://new.example.com");

    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    expect(mockSendMessage).toHaveBeenCalledWith({
      kind: "config.set",
      rawUrl: "http://new.example.com",
    });
    expect(screen.queryByText(/zmiana serwera|changing servers/i)).not.toBeInTheDocument();
  });
});

describe("ServerConfigView — AUTH-04 server-change confirmation dialog", () => {
  function primeChangeScenario() {
    mockMessagesByKind({
      "config.get": () => ({ baseUrl: "https://old.example.com" }),
      "config.probe": () => ({ ok: true }),
      "session.status": () => ({
        kind: "locked",
        wasAutoLocked: false,
        autoLockMinutes: 15,
        extPasskeyEnrolled: false,
        extPasskeyPromptSuppressed: false,
      }),
      "session.signOut": () => ({ ok: true }),
      "config.set": () => ({ ok: true }),
    });
  }

  it("a NEW url with an existing session for the OLD one shows the confirm dialog with the OLD hostname interpolated, BEFORE any config.set call", async () => {
    primeChangeScenario();
    render(<ServerConfigView locale="en" onConfigured={vi.fn()} />);
    await fillAndSubmit("https://new.example.com");

    await waitFor(() =>
      expect(screen.getByText(/changing servers will sign you out of old\.example\.com/i)).toBeInTheDocument(),
    );
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "config.set" }),
    );
  });

  it("confirming: permissions.request(new origin) is called BEFORE sendMessage(session.signOut), which is called BEFORE sendMessage(config.set)", async () => {
    primeChangeScenario();
    render(<ServerConfigView locale="en" onConfigured={vi.fn()} />);
    await fillAndSubmit("https://new.example.com");
    await screen.findByText(/changing servers will sign you out of old\.example\.com/i);

    await userEvent.click(screen.getByRole("button", { name: /switch server/i }));

    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith({ kind: "config.set", rawUrl: "https://new.example.com" }),
    );
    expect(mockPermissionsRequest).toHaveBeenCalledWith({
      origins: ["https://new.example.com/*"],
    });
    expect(mockSendMessage).toHaveBeenCalledWith({ kind: "session.signOut" });

    const signOutCallIndex = mockSendMessage.mock.calls.findIndex(
      ([m]) => m.kind === "session.signOut",
    );
    const configSetCallIndex = mockSendMessage.mock.calls.findIndex(
      ([m]) => m.kind === "config.set",
    );
    expect(mockPermissionsRequest.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendMessage.mock.invocationCallOrder[signOutCallIndex],
    );
    expect(mockSendMessage.mock.invocationCallOrder[signOutCallIndex]).toBeLessThan(
      mockSendMessage.mock.invocationCallOrder[configSetCallIndex],
    );
  });

  it("a config.set failure after signOut leaves migrationError shown, the dialog open, both buttons re-enabled, and onConfigured() NOT called", async () => {
    mockMessagesByKind({
      "config.get": () => ({ baseUrl: "https://old.example.com" }),
      "config.probe": () => ({ ok: true }),
      "session.status": () => ({
        kind: "locked",
        wasAutoLocked: false,
        autoLockMinutes: 15,
        extPasskeyEnrolled: false,
        extPasskeyPromptSuppressed: false,
      }),
      "session.signOut": () => ({ ok: true }),
      "config.set": () => ({ ok: false, error: "unreachable" }),
    });
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("https://new.example.com");
    await screen.findByText(/changing servers will sign you out of old\.example\.com/i);

    await userEvent.click(screen.getByRole("button", { name: /switch server/i }));

    await waitFor(() =>
      expect(screen.getByText(/couldn't switch servers/i)).toBeInTheDocument(),
    );
    expect(onConfigured).not.toHaveBeenCalled();
    // Dialog stays open with both buttons present and re-enabled.
    const confirmButton = screen.getByRole("button", { name: /switch server/i });
    const cancelButton = screen.getByRole("button", { name: /^cancel$/i });
    expect(confirmButton).not.toBeDisabled();
    expect(cancelButton).not.toBeDisabled();
  });

  it("a successful full sequence calls onConfigured() and fires permissions.remove(old origin) best-effort", async () => {
    primeChangeScenario();
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("https://new.example.com");
    await screen.findByText(/changing servers will sign you out of old\.example\.com/i);

    await userEvent.click(screen.getByRole("button", { name: /switch server/i }));

    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    await waitFor(() =>
      expect(mockPermissionsRemove).toHaveBeenCalledWith({
        origins: ["https://old.example.com/*"],
      }),
    );
    expect(screen.queryByText(/changing servers will sign you out of/i)).not.toBeInTheDocument();
  });

  it("cancelling the confirm dialog closes it without any signOut/config.set dispatch", async () => {
    primeChangeScenario();
    render(<ServerConfigView locale="en" onConfigured={vi.fn()} />);
    await fillAndSubmit("https://new.example.com");
    await screen.findByText(/changing servers will sign you out of old\.example\.com/i);

    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(
        screen.queryByText(/changing servers will sign you out of/i),
      ).not.toBeInTheDocument(),
    );
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "session.signOut" }),
    );
    expect(mockSendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "config.set" }),
    );
  });
});
