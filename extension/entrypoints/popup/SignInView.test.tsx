// SignInView.tsx — the popup's signed-out hero (AUTH-01). Zero input
// elements, exactly one button, dispatches unlock.serverCeremony.start with
// mode:"signin", resolves via the unlock.serverCeremony.state broadcast.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { mockSendMessage, mockOnMessageAddListener, mockOnMessageRemoveListener } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
  mockOnMessageAddListener: vi.fn(),
  mockOnMessageRemoveListener: vi.fn(),
}));

vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-extension-id",
      onMessage: {
        addListener: mockOnMessageAddListener,
        removeListener: mockOnMessageRemoveListener,
      },
    },
  },
}));

import SignInView from "./SignInView";

function latestServerCeremonyStateListener(): (message: unknown) => void {
  const call = mockOnMessageAddListener.mock.calls.at(-1);
  if (!call) {
    throw new Error("onServerCeremonyState listener was never registered");
  }
  return call[0] as (message: unknown) => void;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SignInView", () => {
  it("renders zero input elements, exactly one button, and the Server icon-button", () => {
    render(<SignInView locale="en" onSignedIn={vi.fn()} onChangeServer={vi.fn()} />);

    expect(document.querySelectorAll("input")).toHaveLength(0);
    expect(screen.getByTestId("server-ceremony-signin-button")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2); // sign-in CTA + Server icon-button
    expect(screen.getByRole("button", { name: /change server|zmień serwer/i })).toBeInTheDocument();
  });

  it("renders the wordmark at Heading role (no Display escalation)", () => {
    render(<SignInView locale="en" onSignedIn={vi.fn()} onChangeServer={vi.fn()} />);
    expect(screen.getByText("Passkey Vault")).toBeInTheDocument();
  });

  it("clicking the sign-in button dispatches unlock.serverCeremony.start with mode:'signin' exactly once and shows in-flight copy", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "unlock.serverCeremony.start") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<SignInView locale="en" onSignedIn={vi.fn()} onChangeServer={vi.fn()} />);
    const button = screen.getByTestId("server-ceremony-signin-button");
    fireEvent.click(button);

    await waitFor(() => {
      const calls = mockSendMessage.mock.calls.filter(([m]) => m.kind === "unlock.serverCeremony.start");
      expect(calls).toHaveLength(1);
    });
    expect(mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.start", mode: "signin" });
    expect(await screen.findByText(/finish in the opened window|dokończ w otwartym oknie/i)).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it("a subsequent ok:true broadcast calls onSignedIn()", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "unlock.serverCeremony.start") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });
    const onSignedIn = vi.fn();

    render(<SignInView locale="en" onSignedIn={onSignedIn} onChangeServer={vi.fn()} />);
    fireEvent.click(screen.getByTestId("server-ceremony-signin-button"));
    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.start", mode: "signin" }),
    );

    latestServerCeremonyStateListener()({ kind: "unlock.serverCeremony.state", ok: true });

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
  });

  it("a subsequent ok:false broadcast shows the failure copy and leaves the button re-clickable (not permanently disabled)", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "unlock.serverCeremony.start") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<SignInView locale="en" onSignedIn={vi.fn()} onChangeServer={vi.fn()} />);
    const button = screen.getByTestId("server-ceremony-signin-button");
    fireEvent.click(button);
    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.start", mode: "signin" }),
    );

    latestServerCeremonyStateListener()({ kind: "unlock.serverCeremony.state", ok: false });

    expect(
      await screen.findByText(/couldn't sign in via your server|nie udało się zalogować przez stronę serwera/i),
    ).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("a synchronous start failure (rejected sendMessage) sets the failed line without a wedge", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "unlock.serverCeremony.start") throw new Error("network error");
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<SignInView locale="en" onSignedIn={vi.fn()} onChangeServer={vi.fn()} />);
    const button = screen.getByTestId("server-ceremony-signin-button");
    fireEvent.click(button);

    expect(
      await screen.findByText(/couldn't sign in via your server|nie udało się zalogować przez stronę serwera/i),
    ).toBeInTheDocument();
    expect(button).not.toBeDisabled();
  });

  it("clicking the Server icon-button calls onChangeServer", () => {
    const onChangeServer = vi.fn();
    render(<SignInView locale="en" onSignedIn={vi.fn()} onChangeServer={onChangeServer} />);

    fireEvent.click(screen.getByRole("button", { name: /change server|zmień serwer/i }));

    expect(onChangeServer).toHaveBeenCalledTimes(1);
  });
});
