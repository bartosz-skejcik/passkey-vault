// EnrollExtPasskeyPrompt.tsx — Test 4d (new, AMENDMENT 2026-07-15): the
// discreet post-password-unlock enrollment prompt for the
// extension-scoped PRF passkey. Mirrors web/src/lib/passkeys/enroll.ts's
// two-ceremony shape (create() to check PRF capability, then a second
// get() with the returned salt to actually derive PRF bytes).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

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

import EnrollExtPasskeyPrompt from "./EnrollExtPasskeyPrompt";

function mockCreatedCredential(prfEnabled: boolean): PublicKeyCredential {
  return {
    id: "new-cred-id",
    getClientExtensionResults: () => (prfEnabled ? { prf: { enabled: true } } : { prf: { enabled: false } }),
  } as unknown as PublicKeyCredential;
}

function mockGetAssertion(prfBytes: ArrayBuffer): PublicKeyCredential {
  return {
    id: "new-cred-id",
    getClientExtensionResults: () => ({ prf: { results: { first: prfBytes } } }),
  } as unknown as PublicKeyCredential;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "credentials", {
    value: { create: vi.fn(), get: vi.fn() },
    configurable: true,
    writable: true,
  });
});

describe("EnrollExtPasskeyPrompt", () => {
  it("Test 4d (PRF-capable path): create() -> checks prf.enabled -> second get() ceremony -> extPasskey.enroll.finish with credentialIdB64url/prfSaltB64/prfBytes", async () => {
    const prfBytes = new Uint8Array(32).fill(4).buffer;
    (navigator.credentials.create as unknown as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(mockCreatedCredential(true));
    (navigator.credentials.get as unknown as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(mockGetAssertion(prfBytes));

    const saltB64 = btoa("0123456789abcdef0123456789abcdef");
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "extPasskey.enroll.start") {
        return {
          ok: true,
          accountEmail: "a@example.com",
          userHandleB64: btoa("userhandle"),
          challengeB64: btoa("challenge"),
          prfSaltB64: saltB64,
        };
      }
      if (message.kind === "extPasskey.enroll.finish") return { ok: true };
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<EnrollExtPasskeyPrompt locale="en" onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /create a passkey|utwórz passkey/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "extPasskey.enroll.finish",
          credentialIdB64url: "new-cred-id",
          prfSaltB64: saltB64,
        }),
      );
    });
    expect(navigator.credentials.create).toHaveBeenCalledTimes(1);
    expect(navigator.credentials.get).toHaveBeenCalledTimes(1);
  });

  it("Test 4d (PRF-less path): create() reports prf.enabled=false -> renders the honest-degradation line and NEVER calls enroll.finish", async () => {
    (navigator.credentials.create as unknown as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockResolvedValue(mockCreatedCredential(false));

    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "extPasskey.enroll.start") {
        return {
          ok: true,
          accountEmail: "a@example.com",
          userHandleB64: btoa("userhandle"),
          challengeB64: btoa("challenge"),
          prfSaltB64: btoa("0123456789abcdef0123456789abcdef"),
        };
      }
      throw new Error(`unexpected: ${message.kind}`);
    });

    render(<EnrollExtPasskeyPrompt locale="en" onDone={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /create a passkey|utwórz passkey/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/doesn't support PRF|nie wspiera PRF/i),
      ).toBeInTheDocument();
    });
    expect(mockSendMessage.mock.calls.some(([m]) => m.kind === "extPasskey.enroll.finish")).toBe(false);
  });

  it("skipping via 'Not now' dismisses without calling suppressPrompt", () => {
    const onDone = vi.fn();
    render(<EnrollExtPasskeyPrompt locale="en" onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: /not now|nie teraz/i }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls.some(([m]) => m.kind === "extPasskey.suppressPrompt")).toBe(false);
  });

  it("checking 'Don't ask again' dispatches extPasskey.suppressPrompt and dismisses", async () => {
    mockSendMessage.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<EnrollExtPasskeyPrompt locale="en" onDone={onDone} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /don't ask again|nie pytaj ponownie/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "extPasskey.suppressPrompt", suppress: true }),
      );
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
