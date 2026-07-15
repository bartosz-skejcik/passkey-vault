// ServerConfigView — pins the user-gesture permission-grant contract found
// by the real-browser Phase 9 UAT: chrome.permissions.request() MUST run in
// the popup's submit click (the gesture does not survive the sendMessage hop
// into the service worker, where Chrome throws "must be called during a
// user gesture" and the old code mislabeled it "unreachable").
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

describe("ServerConfigView — gesture-bound permission grant", () => {
  it("requests the normalized single-origin grant IN the submit handler, then dispatches config.set", async () => {
    mockPermissionsRequest.mockResolvedValue(true);
    mockSendMessage.mockResolvedValue({ ok: true });
    const onConfigured = vi.fn();

    render(<ServerConfigView locale="en" onConfigured={onConfigured} />);
    await fillAndSubmit("http://LOCALHOST:8620/");

    await waitFor(() => expect(onConfigured).toHaveBeenCalled());
    expect(mockPermissionsRequest).toHaveBeenCalledWith({
      origins: ["http://localhost:8620/*"],
    });
    // grant precedes the background dispatch
    expect(mockPermissionsRequest.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendMessage.mock.invocationCallOrder[0],
    );
    expect(mockSendMessage).toHaveBeenCalledWith({
      kind: "config.set",
      rawUrl: "http://LOCALHOST:8620/",
    });
  });

  it("denied grant → honest permission-denied copy, config.set never dispatched", async () => {
    mockPermissionsRequest.mockResolvedValue(false);

    render(<ServerConfigView locale="en" onConfigured={vi.fn()} />);
    await fillAndSubmit("http://localhost:8620");

    await waitFor(() =>
      expect(screen.getByText(/without this permission/i)).toBeInTheDocument(),
    );
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("invalid URL → no permission prompt, no message, invalid-url copy", async () => {
    render(<ServerConfigView locale="en" onConfigured={vi.fn()} />);
    await fillAndSubmit("ftp://nope");

    await waitFor(() => expect(screen.getByText(/invalid address/i)).toBeInTheDocument());
    expect(mockPermissionsRequest).not.toHaveBeenCalled();
    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
