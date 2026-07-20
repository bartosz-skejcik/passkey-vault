// UnlockView.tsx — password-first unlock-only view (AUTH-02, Phase 15
// Plan 15-03 rewrite). This component no longer renders for a no-session
// status (App.tsx routes that to SignInView.tsx instead -- see
// SignInView.test.tsx for that surface's own tests) and no longer offers
// ext-scoped PRF (AUTH-03, removed outright). The single passkey-unlock
// path is the server-origin ceremony window, unconditionally rendered
// whenever this view is shown.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SessionStatus } from "../../lib/messaging/ext-protocol";

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
      // Plan 13-06: UnlockView listens for the background's
      // unlock.serverCeremony.state broadcast -- a no-op fake is enough for
      // every pre-existing test here (none of them dispatch through it);
      // tests that DO exercise it below capture the registered listener.
      onMessage: {
        addListener: mockOnMessageAddListener,
        removeListener: mockOnMessageRemoveListener,
      },
    },
  },
}));

import UnlockView from "./UnlockView";

type LockedStatus = Extract<SessionStatus, { kind: "locked" }>;

function lockedStatus(overrides: Partial<LockedStatus> = {}): LockedStatus {
  return {
    kind: "locked",
    wasAutoLocked: false,
    autoLockMinutes: 15,
    ...overrides,
  };
}

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

describe("UnlockView", () => {
  it("renders exactly one autofocused password input, one btn-accent passkey button, zero email input, zero sign-in button", () => {
    render(<UnlockView locale="en" status={lockedStatus()} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />);

    const passwordInputs = document.querySelectorAll("input[type=password]");
    expect(passwordInputs).toHaveLength(1);
    expect(passwordInputs[0]).toHaveFocus();

    expect(document.querySelectorAll("input[type=email]")).toHaveLength(0);
    expect(screen.queryByTestId("server-ceremony-signin-button")).not.toBeInTheDocument();

    const passkeyButton = screen.getByTestId("server-ceremony-unlock-button");
    expect(passkeyButton).toBeInTheDocument();
    expect(passkeyButton).toHaveClass("btn-accent");
    expect(passkeyButton).not.toHaveClass("btn-outline");
  });

  it("renders the Server icon-button, dispatching onChangeServer when clicked", () => {
    const onChangeServer = vi.fn();
    render(<UnlockView locale="en" status={lockedStatus()} onUnlocked={vi.fn()} onChangeServer={onChangeServer} />);

    fireEvent.click(screen.getByRole("button", { name: /change server|zmień serwer/i }));

    expect(onChangeServer).toHaveBeenCalledTimes(1);
  });

  it("Test 3: password submit calls unlock.password exactly once (no email field), calls onUnlocked() with no arguments, and clears the password field", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "unlock.password") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });
    const onUnlocked = vi.fn();

    render(<UnlockView locale="en" status={lockedStatus()} onUnlocked={onUnlocked} onChangeServer={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/master password|hasło/i) as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$|^odblokuj$/i }));

    await waitFor(() => {
      const calls = mockSendMessage.mock.calls.filter(([m]) => m.kind === "unlock.password");
      expect(calls).toHaveLength(1);
    });
    expect(mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.password", passwordB64: expect.any(String) });
    expect(passwordInput.value).toBe("");
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith());
  });

  it("a wrong password shows the inline auth.loginFailed error", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "unlock.password") return { ok: false };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<UnlockView locale="en" status={lockedStatus()} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />);

    const passwordInput = screen.getByLabelText(/master password|hasło/i);
    fireEvent.change(passwordInput, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$|^odblokuj$/i }));

    expect(await screen.findByText(/login failed|logowanie nie powiodło się/i)).toBeInTheDocument();
  });

  it("shows the session-locked notice only when wasAutoLocked is true", () => {
    const { rerender } = render(
      <UnlockView locale="en" status={lockedStatus({ wasAutoLocked: false })} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );
    expect(screen.queryByText(/session locked|sesja wygasła/i)).not.toBeInTheDocument();

    rerender(
      <UnlockView locale="en" status={lockedStatus({ wasAutoLocked: true })} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );
    expect(screen.getByText(/session locked|sesja wygasła/i)).toBeInTheDocument();
  });

  describe("server-origin ceremony passkey unlock", () => {
    it("renders unconditionally (no D-12/hasServerConfig gating) and clicking it dispatches unlock.serverCeremony.start with mode:'unlock', showing the in-flight state until the state broadcast resolves it", async () => {
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        if (message.kind === "unlock.serverCeremony.start") return { ok: true };
        throw new Error(`unexpected: ${message.kind}`);
      });
      const onUnlocked = vi.fn();

      render(
        <UnlockView locale="en" status={lockedStatus()} onUnlocked={onUnlocked} onChangeServer={vi.fn()} />,
      );
      const serverButton = screen.getByTestId("server-ceremony-unlock-button");
      fireEvent.click(serverButton);

      await waitFor(() => {
        expect(mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.start", mode: "unlock" });
      });
      expect(await screen.findByText(/finish in the opened window|dokończ w otwartym oknie/i)).toBeInTheDocument();
      expect(serverButton).toBeDisabled();
      expect(onUnlocked).not.toHaveBeenCalled();

      // The background's broadcast resolves it -- ok:true lands the unlocked session.
      latestServerCeremonyStateListener()({ kind: "unlock.serverCeremony.state", ok: true });
      await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith());
    });

    it("an ok:false state broadcast renders the calm failure line -- never a wedge -- and re-enables the button", async () => {
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        if (message.kind === "unlock.serverCeremony.start") return { ok: true };
        throw new Error(`unexpected: ${message.kind}`);
      });

      render(<UnlockView locale="en" status={lockedStatus()} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />);
      const serverButton = screen.getByTestId("server-ceremony-unlock-button");
      fireEvent.click(serverButton);
      await waitFor(() =>
        expect(mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.start", mode: "unlock" }),
      );

      latestServerCeremonyStateListener()({ kind: "unlock.serverCeremony.state", ok: false });

      expect(
        await screen.findByText(/couldn't unlock via your server|nie udało się odblokować przez stronę serwera/i),
      ).toBeInTheDocument();
      expect(screen.getByTestId("server-ceremony-unlock-button")).not.toBeDisabled();
    });

    it("a synchronous start failure shows the failure line immediately, without a wedge, and never permanently disables the button", async () => {
      mockSendMessage.mockImplementation(async (message: { kind: string }) => {
        if (message.kind === "unlock.serverCeremony.start") {
          return { ok: false, error: "not-locked" };
        }
        throw new Error(`unexpected: ${message.kind}`);
      });

      render(<UnlockView locale="en" status={lockedStatus()} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />);
      const serverButton = screen.getByTestId("server-ceremony-unlock-button");
      fireEvent.click(serverButton);

      expect(
        await screen.findByText(/couldn't unlock via your server|nie udało się odblokować przez stronę serwera/i),
      ).toBeInTheDocument();
      expect(serverButton).not.toBeDisabled();

      // Retry is always offered -- clicking again dispatches a second attempt.
      fireEvent.click(serverButton);
      await waitFor(() => {
        const calls = mockSendMessage.mock.calls.filter(([m]) => m.kind === "unlock.serverCeremony.start");
        expect(calls).toHaveLength(2);
      });
    });
  });
});
