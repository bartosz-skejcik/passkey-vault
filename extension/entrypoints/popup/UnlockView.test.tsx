// UnlockView.tsx — password + extension-scoped PRF unlock, thin
// message-dispatch layer only. Tests 4/4b are REPLACED per the plan's
// AMENDMENT 2026-07-15 (extension-scoped PRF passkey, Plan 09-08) — the
// popup never dispatches the web-RP PRF message pair (dead this phase),
// only the ext-PRF pair. Tests 4c/4d are NEW per the same amendment (4d
// lives in its own EnrollExtPasskeyPrompt.test.tsx file).
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
type NoSessionStatus = Extract<SessionStatus, { kind: "no-session" }>;

function lockedStatus(overrides: Partial<LockedStatus> = {}): LockedStatus {
  return {
    kind: "locked",
    wasAutoLocked: false,
    autoLockMinutes: 15,
    extPasskeyEnrolled: false,
    extPasskeyPromptSuppressed: false,
    ...overrides,
  };
}

const noSessionStatus: NoSessionStatus = { kind: "no-session" };

function mockAssertion(prfBytes: ArrayBuffer | undefined): PublicKeyCredential {
  return {
    id: "credential-id-b64url",
    getClientExtensionResults: () => (prfBytes === undefined ? {} : { prf: { results: { first: prfBytes } } }),
    toJSON: () => ({ id: "credential-id-b64url" }),
  } as unknown as PublicKeyCredential;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "PublicKeyCredential", {
    value: function PublicKeyCredential() {},
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "credentials", {
    value: { get: vi.fn(), create: vi.fn() },
    configurable: true,
    writable: true,
  });
});

describe("UnlockView — Unlock-only variant (session.status 'locked')", () => {
  it("Test 3: password submit calls unlock.password exactly once (no email field) and clears the password field", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      // Plan 13-06: UnlockView now fetches config.get on mount (to gate the
      // server-ceremony button's visibility) -- default to "no server
      // configured" for every pre-existing test in this file, unless a
      // test below overrides it.
      if (message.kind === "config.get") return null;
      if (message.kind === "unlock.password") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<UnlockView locale="en" status={lockedStatus()} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />);

    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();

    const passwordInput = screen.getByLabelText(/master password|hasło/i) as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock|odblokuj/i }));

    await waitFor(() => {
      const calls = mockSendMessage.mock.calls.filter(([m]) => m.kind === "unlock.password");
      expect(calls).toHaveLength(1);
    });
    expect((passwordInput as HTMLInputElement).value).toBe("");
  });

  it("Test 4 (replaced — ext-PRF ceremony): with extPasskeyEnrolled true, clicking the PRF button drives unlock.extPrf.start -> buildExtGetOptions(rpId=browser.runtime.id) -> navigator.credentials.get() -> extractPrfBytes -> unlock.extPrf.finish", async () => {
    const prfBytes = new Uint8Array(32).fill(9).buffer;
    const getMock = vi.fn().mockResolvedValue(mockAssertion(prfBytes));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      // Plan 13-06: UnlockView now fetches config.get on mount (to gate the
      // server-ceremony button's visibility) -- default to "no server
      // configured" for every pre-existing test in this file, unless a
      // test below overrides it.
      if (message.kind === "config.get") return null;
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-123", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      if (message.kind === "unlock.extPrf.finish") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    const onUnlocked = vi.fn();
    render(
      <UnlockView
        locale="en"
        status={lockedStatus({ extPasskeyEnrolled: true })}
        onUnlocked={onUnlocked} onChangeServer={vi.fn()}
      />,
    );

    const prfButton = screen.getByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i });
    fireEvent.click(prfButton);

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(false));

    expect(mockSendMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: "unlock.extPrf.start" }));
    expect(getMock).toHaveBeenCalledTimes(1);
    const getOptions = getMock.mock.calls[0][0] as CredentialRequestOptions;
    // rpId MUST come from browser.runtime.id at call time -- never a literal.
    expect(getOptions.publicKey?.rpId).toBe("test-extension-id");
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "unlock.extPrf.finish", credentialIdB64url: "cred-123" }),
    );
  });

  it("Test 4b (replaced — visibility gate): extPasskeyEnrolled false renders no PRF button and no explainer line", () => {
    render(
      <UnlockView locale="en" status={lockedStatus({ extPasskeyEnrolled: false })} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/passkey/i)).not.toBeInTheDocument();
  });

  it("Test 4b (replaced — Tier-1 explainer): extPasskeyEnrolled true but PublicKeyCredential undefined renders the Tier-1 explainer in the button's slot, no button", () => {
    // @ts-expect-error -- simulating a browser without WebAuthn support
    delete window.PublicKeyCredential;

    render(
      <UnlockView locale="en" status={lockedStatus({ extPasskeyEnrolled: true })} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/fast unlock isn't available|szybkie odblokowanie passkeyem nie jest dostępne/i),
    ).toBeInTheDocument();
  });

  it("D-12 (new — get() throws NotAllowedError): stays silent, no banner, button remains enabled, no unlock.extPrf.finish dispatch", async () => {
    const getMock = vi.fn().mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      // Plan 13-06: UnlockView now fetches config.get on mount (to gate the
      // server-ceremony button's visibility) -- default to "no server
      // configured" for every pre-existing test in this file, unless a
      // test below overrides it.
      if (message.kind === "config.get") return null;
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-123", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView locale="en" status={lockedStatus({ extPasskeyEnrolled: true })} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );

    const prfButton = screen.getByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i });
    fireEvent.click(prfButton);

    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(/fast unlock isn't available|szybkie odblokowanie passkeyem nie jest dostępne/i),
    ).not.toBeInTheDocument();
    expect(prfButton).not.toBeDisabled();
    expect(mockSendMessage.mock.calls.some(([m]) => m.kind === "unlock.extPrf.finish")).toBe(false);
  });

  it("D-12 (new — get() throws a non-cancel error): renders the neutral D-13 banner and disables the PRF button", async () => {
    const getMock = vi.fn().mockRejectedValue(new DOMException("no PRF here", "NotSupportedError"));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      // Plan 13-06: UnlockView now fetches config.get on mount (to gate the
      // server-ceremony button's visibility) -- default to "no server
      // configured" for every pre-existing test in this file, unless a
      // test below overrides it.
      if (message.kind === "config.get") return null;
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-123", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView locale="en" status={lockedStatus({ extPasskeyEnrolled: true })} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );

    const prfButton = screen.getByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i });
    fireEvent.click(prfButton);

    await waitFor(() => {
      expect(
        screen.getByText(/fast unlock isn't available|szybkie odblokowanie passkeyem nie jest dostępne/i),
      ).toBeInTheDocument();
    });
    expect(prfButton).toBeDisabled();
  });

  it("D-12 (new — extractPrfBytes returns undefined): renders the neutral banner (not text-error) and disables the PRF button", async () => {
    const getMock = vi.fn().mockResolvedValue(mockAssertion(undefined));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      // Plan 13-06: UnlockView now fetches config.get on mount (to gate the
      // server-ceremony button's visibility) -- default to "no server
      // configured" for every pre-existing test in this file, unless a
      // test below overrides it.
      if (message.kind === "config.get") return null;
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-123", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView locale="en" status={lockedStatus({ extPasskeyEnrolled: true })} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );

    const prfButton = screen.getByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i });
    fireEvent.click(prfButton);

    const banner = await screen.findByText(
      /fast unlock isn't available|szybkie odblokowanie passkeyem nie jest dostępne/i,
    );
    expect(banner).toBeInTheDocument();
    expect(banner).not.toHaveClass("text-error");
    expect(prfButton).toBeDisabled();
  });

  it("Test 4c (new — orphaned credential): unlock.extPrf.finish resolving not-enrolled renders the orphaned-passkey copy and focuses the password field", async () => {
    const getMock = vi.fn().mockResolvedValue(mockAssertion(new Uint8Array(32).fill(1).buffer));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      // Plan 13-06: UnlockView now fetches config.get on mount (to gate the
      // server-ceremony button's visibility) -- default to "no server
      // configured" for every pre-existing test in this file, unless a
      // test below overrides it.
      if (message.kind === "config.get") return null;
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-stale", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      if (message.kind === "unlock.extPrf.finish") return { ok: false, error: "not-enrolled" };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView locale="en" status={lockedStatus({ extPasskeyEnrolled: true })} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/doesn't match this vault|nie pasuje do tego sejfu/i),
      ).toBeInTheDocument();
    });
    const passwordInput = screen.getByLabelText(/master password|hasło/i);
    expect(passwordInput).toHaveFocus();
  });
});

describe("UnlockView — Sign-in variant (session.status 'no-session')", () => {
  it("Test 3b: password submit calls auth.signIn.password with email (not unlock.password) and clears the password field", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      // Plan 13-06: UnlockView now fetches config.get on mount (to gate the
      // server-ceremony button's visibility) -- default to "no server
      // configured" for every pre-existing test in this file, unless a
      // test below overrides it.
      if (message.kind === "config.get") return null;
      if (message.kind === "auth.signIn.password") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<UnlockView locale="en" status={noSessionStatus} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: "a@example.com" } });
    const passwordInput = screen.getByLabelText(/master password|hasło/i) as HTMLInputElement;
    fireEvent.change(passwordInput, { target: { value: "s3cr3t" } });
    fireEvent.click(screen.getByRole("button", { name: /unlock|odblokuj/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "auth.signIn.password", email: "a@example.com" }),
      );
    });
    expect(mockSendMessage.mock.calls.some(([m]) => m.kind === "unlock.password")).toBe(false);
    expect(passwordInput.value).toBe("");
  });

  it("Test 5: the Sign-in variant NEVER renders a PRF button or explainer this phase, regardless of PublicKeyCredential support", () => {
    render(<UnlockView locale="en" status={noSessionStatus} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /passkey/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/passkey/i)).not.toBeInTheDocument();
  });
});

describe("UnlockView — server-origin ceremony secondary path (Plan 13-06)", () => {
  function latestServerCeremonyStateListener(): (message: unknown) => void {
    const call = mockOnMessageAddListener.mock.calls.at(-1);
    if (!call) {
      throw new Error("onServerCeremonyState listener was never registered");
    }
    return call[0] as (message: unknown) => void;
  }

  it("D-12/known-impossible: NEVER renders when no server is configured, even with the ext-scoped path unusable", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return null;
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView
        locale="en"
        status={lockedStatus({ extPasskeyEnrolled: true })}
        onUnlocked={vi.fn()}
        onChangeServer={vi.fn()}
      />,
    );

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledWith({ kind: "config.get" }));
    expect(
      screen.queryByTestId("server-ceremony-unlock-button"),
    ).not.toBeInTheDocument();
  });

  it("D-12 dynamic signal: appears once a genuine (non-cancel) ext-scoped PRF failure is observed this session, with a configured server", async () => {
    const getMock = vi.fn().mockRejectedValue(new DOMException("no PRF here", "NotSupportedError"));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-123", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView
        locale="en"
        status={lockedStatus({ extPasskeyEnrolled: true })}
        onUnlocked={vi.fn()}
        onChangeServer={vi.fn()}
      />,
    );

    // Not shown before any ceremony attempt.
    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledWith({ kind: "config.get" }));
    expect(screen.queryByTestId("server-ceremony-unlock-button")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i }));

    await waitFor(() => {
      expect(screen.getByTestId("server-ceremony-unlock-button")).toBeInTheDocument();
    });
    // Password path stays fully visible alongside (D-06).
    expect(screen.getByLabelText(/master password|hasło/i)).toBeInTheDocument();
  });

  it("clicking the button dispatches unlock.serverCeremony.start and shows the in-flight state until the state broadcast resolves it", async () => {
    const getMock = vi.fn().mockRejectedValue(new DOMException("no PRF here", "NotSupportedError"));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-123", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      if (message.kind === "unlock.serverCeremony.start") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    const onUnlocked = vi.fn();
    render(
      <UnlockView
        locale="en"
        status={lockedStatus({ extPasskeyEnrolled: true })}
        onUnlocked={onUnlocked}
        onChangeServer={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i }));
    const serverButton = await screen.findByTestId("server-ceremony-unlock-button");

    fireEvent.click(serverButton);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.start", mode: "unlock" });
    });
    expect(await screen.findByText(/finish in the opened window|dokończ w otwartym oknie/i)).toBeInTheDocument();
    expect(serverButton).toBeDisabled();
    expect(onUnlocked).not.toHaveBeenCalled();

    // The background's broadcast resolves it -- ok:true lands the unlocked session.
    latestServerCeremonyStateListener()({ kind: "unlock.serverCeremony.state", ok: true });
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(false));
  });

  it("an ok:false state broadcast (timeout/failure) renders the calm failure line -- never a wedge -- and re-enables the button", async () => {
    const getMock = vi.fn().mockRejectedValue(new DOMException("no PRF here", "NotSupportedError"));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-123", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      if (message.kind === "unlock.serverCeremony.start") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView
        locale="en"
        status={lockedStatus({ extPasskeyEnrolled: true })}
        onUnlocked={vi.fn()}
        onChangeServer={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i }));
    const serverButton = await screen.findByTestId("server-ceremony-unlock-button");
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

  it("a synchronous start failure (e.g. no-server-configured/not-locked) shows the failure line immediately, without a wedge", async () => {
    const getMock = vi.fn().mockRejectedValue(new DOMException("no PRF here", "NotSupportedError"));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-123", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      if (message.kind === "unlock.serverCeremony.start") {
        return { ok: false, error: "not-locked" };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView
        locale="en"
        status={lockedStatus({ extPasskeyEnrolled: true })}
        onUnlocked={vi.fn()}
        onChangeServer={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i }));
    const serverButton = await screen.findByTestId("server-ceremony-unlock-button");
    fireEvent.click(serverButton);

    expect(
      await screen.findByText(/couldn't unlock via your server|nie udało się odblokować przez stronę serwera/i),
    ).toBeInTheDocument();
    expect(serverButton).not.toBeDisabled();
  });
});

// Plan 13-07 (Bartek mandate, "Zrób teraz" + "the button must exist on the
// login screen"): the SIGN-IN variant's own server-origin ceremony button --
// unlike the locked-variant secondary path above, this is NOT gated on any
// "unusable" signal; it appears on BOTH browsers whenever a server is
// configured.
describe("UnlockView — sign-in variant server-origin ceremony button (Plan 13-07)", () => {
  function latestServerCeremonyStateListener(): (message: unknown) => void {
    const call = mockOnMessageAddListener.mock.calls.at(-1);
    if (!call) {
      throw new Error("onServerCeremonyState listener was never registered");
    }
    return call[0] as (message: unknown) => void;
  }

  it("does NOT render when no server is configured", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return null;
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView locale="en" status={noSessionStatus} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );

    await waitFor(() => expect(mockSendMessage).toHaveBeenCalledWith({ kind: "config.get" }));
    expect(screen.queryByTestId("server-ceremony-signin-button")).not.toBeInTheDocument();
  });

  it("renders whenever a server IS configured -- unconditionally, unlike the locked-variant's own D-12 gate -- with the email field and password form both still present (D-06)", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView locale="en" status={noSessionStatus} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );

    expect(await screen.findByTestId("server-ceremony-signin-button")).toBeInTheDocument();
    expect(screen.getByLabelText(/^email$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/master password|hasło/i)).toBeInTheDocument();
  });

  it("clicking dispatches unlock.serverCeremony.start with mode:'signin' and shows the in-flight state until the state broadcast resolves it", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      if (message.kind === "unlock.serverCeremony.start") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    const onUnlocked = vi.fn();
    render(
      <UnlockView locale="en" status={noSessionStatus} onUnlocked={onUnlocked} onChangeServer={vi.fn()} />,
    );
    const signinButton = await screen.findByTestId("server-ceremony-signin-button");
    fireEvent.click(signinButton);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.start", mode: "signin" });
    });
    expect(await screen.findByText(/finish in the opened window|dokończ w otwartym oknie/i)).toBeInTheDocument();
    expect(signinButton).toBeDisabled();
    expect(onUnlocked).not.toHaveBeenCalled();

    latestServerCeremonyStateListener()({ kind: "unlock.serverCeremony.state", ok: true });
    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(false));
  });

  it("an ok:false state broadcast renders the sign-in-specific calm failure line -- never a wedge -- and re-enables the button", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      if (message.kind === "unlock.serverCeremony.start") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView locale="en" status={noSessionStatus} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );
    const signinButton = await screen.findByTestId("server-ceremony-signin-button");
    fireEvent.click(signinButton);
    await waitFor(() =>
      expect(mockSendMessage).toHaveBeenCalledWith({ kind: "unlock.serverCeremony.start", mode: "signin" }),
    );

    latestServerCeremonyStateListener()({ kind: "unlock.serverCeremony.state", ok: false });

    expect(
      await screen.findByText(/couldn't sign in via your server|nie udało się zalogować przez stronę serwera/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("server-ceremony-signin-button")).not.toBeDisabled();
  });

  it("the locked-variant's own server-ceremony-unlock-button never appears on the sign-in variant", async () => {
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "config.get") return { baseUrl: "https://vault.example.com" };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView locale="en" status={noSessionStatus} onUnlocked={vi.fn()} onChangeServer={vi.fn()} />,
    );

    await screen.findByTestId("server-ceremony-signin-button");
    expect(screen.queryByTestId("server-ceremony-unlock-button")).not.toBeInTheDocument();
  });
});
