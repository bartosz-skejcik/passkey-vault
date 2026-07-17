// ServerConfigView — pins the persist-first contract found by the second
// real-browser Phase 9 UAT pass: chrome.permissions.request() opens a
// native prompt that steals focus and CLOSES the MV3 popup, so config.set
// (which persists the server URL) MUST run and complete BEFORE the
// permission request -- otherwise the popup closing mid-await strands the
// user on this same screen after clicking Allow, requiring a second submit.
// onConfigured() therefore fires as soon as config.set succeeds, regardless
// of whether the subsequent best-effort permission grant is accepted,
// denied, or rejects outright.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mockSendMessage = vi.hoisted(() => vi.fn());
const mockPermissionsRequest = vi.hoisted(() => vi.fn());

vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    permissions: { request: mockPermissionsRequest },
    // D-11: ServerConfigView's cors-blocked branch computes the
    // extension's own origin via `browser.runtime.getURL("")` -- mirrors
    // the real Chrome/Firefox shape (a full extension-scheme URL) so
    // `new URL(...).origin` round-trips exactly like it would in a real
    // browser.
    runtime: { getURL: () => "chrome-extension://test-extension-id/" },
  },
}));

import ServerConfigView from "./ServerConfigView";

beforeEach(() => {
  vi.clearAllMocks();
});

async function fillAndSubmit(url: string) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/adres serwera|server address/i), url);
  await user.click(screen.getByRole("button", { name: /połącz|connect/i }));
}

describe("ServerConfigView — persist-before-permission-prompt order", () => {
  it("dispatches config.set BEFORE requesting the permission grant, and fires onConfigured once config.set succeeds", async () => {
    mockSendMessage.mockResolvedValue({ ok: true });
    mockPermissionsRequest.mockResolvedValue(true);
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
    expect(mockSendMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mockPermissionsRequest.mock.invocationCallOrder[0],
    );
  });

  it("onConfigured fires even when the permission prompt is denied — the popup closing/losing the grant never strands the user", async () => {
    mockSendMessage.mockResolvedValue({ ok: true });
    mockPermissionsRequest.mockResolvedValue(false);
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://localhost:8620");

    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    await waitFor(() => expect(mockPermissionsRequest).toHaveBeenCalled());
  });

  it("onConfigured fires even when permissions.request() rejects outright (e.g. the prompt killed the popup mid-await)", async () => {
    mockSendMessage.mockResolvedValue({ ok: true });
    mockPermissionsRequest.mockRejectedValue(new Error("popup closed"));
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://localhost:8620");

    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
  });

  it("config.set failure (unreachable server) → error copy shown, onConfigured never fires, permission never requested", async () => {
    mockSendMessage.mockResolvedValue({ ok: false, error: "unreachable" });
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://localhost:8620");

    await waitFor(() =>
      expect(screen.getByText(/can't reach that server/i)).toBeInTheDocument(),
    );
    expect(onConfigured).not.toHaveBeenCalled();
    expect(mockPermissionsRequest).not.toHaveBeenCalled();
  });

  it("config.set failure (cors-blocked) → distinct CORS-blocked copy with the extension's own origin, never the generic unreachable message", async () => {
    mockSendMessage.mockResolvedValue({ ok: false, error: "cors-blocked" });
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

  it("invalid URL → no config.set dispatch, no permission prompt, invalid-url copy", async () => {
    render(<ServerConfigView locale="en" onConfigured={vi.fn()} />);
    await fillAndSubmit("ftp://nope");

    await waitFor(() => expect(screen.getByText(/invalid address/i)).toBeInTheDocument());
    expect(mockSendMessage).not.toHaveBeenCalled();
    expect(mockPermissionsRequest).not.toHaveBeenCalled();
  });
});
