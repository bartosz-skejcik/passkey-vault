// UnlockView.tsx — password + extension-scoped PRF unlock, thin
// message-dispatch layer only. Tests 4/4b are REPLACED per the plan's
// AMENDMENT 2026-07-15 (extension-scoped PRF passkey, Plan 09-08) — the
// popup never dispatches unlock.prf.*/auth.signIn.prf.* (dead this phase),
// only unlock.extPrf.*. Tests 4c/4d are NEW per the same amendment (4d
// lives in its own EnrollExtPasskeyPrompt.test.tsx file).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { SessionStatus } from "../../lib/messaging/ext-protocol";

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(),
}));

vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: mockSendMessage,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: { id: "test-extension-id" },
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
      if (message.kind === "unlock.password") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<UnlockView locale="en" status={lockedStatus()} onUnlocked={vi.fn()} />);

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
        onUnlocked={onUnlocked}
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
      <UnlockView locale="en" status={lockedStatus({ extPasskeyEnrolled: false })} onUnlocked={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/passkey/i)).not.toBeInTheDocument();
  });

  it("Test 4b (replaced — Tier-1 explainer): extPasskeyEnrolled true but PublicKeyCredential undefined renders the Tier-1 explainer in the button's slot, no button", () => {
    // @ts-expect-error -- simulating a browser without WebAuthn support
    delete window.PublicKeyCredential;

    render(
      <UnlockView locale="en" status={lockedStatus({ extPasskeyEnrolled: true })} onUnlocked={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: /unlock with passkey|odblokuj passkeyem/i })).not.toBeInTheDocument();
    expect(
      screen.getByText(/doesn't support passkey sign-in|nie obsługuje logowania passkeyem/i),
    ).toBeInTheDocument();
  });

  it("Test 4c (new — orphaned credential): unlock.extPrf.finish resolving not-enrolled renders the orphaned-passkey copy and focuses the password field", async () => {
    const getMock = vi.fn().mockResolvedValue(mockAssertion(new Uint8Array(32).fill(1).buffer));
    (navigator.credentials.get as unknown as typeof getMock) = getMock;

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "unlock.extPrf.start") {
        return { credentialIdB64url: "cred-stale", prfSaltB64: btoa("0123456789abcdef0123456789abcdef") };
      }
      if (message.kind === "unlock.extPrf.finish") return { ok: false, error: "not-enrolled" };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(
      <UnlockView locale="en" status={lockedStatus({ extPasskeyEnrolled: true })} onUnlocked={vi.fn()} />,
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
      if (message.kind === "auth.signIn.password") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<UnlockView locale="en" status={noSessionStatus} onUnlocked={vi.fn()} />);

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
    render(<UnlockView locale="en" status={noSessionStatus} onUnlocked={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /passkey/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/passkey/i)).not.toBeInTheDocument();
  });
});
