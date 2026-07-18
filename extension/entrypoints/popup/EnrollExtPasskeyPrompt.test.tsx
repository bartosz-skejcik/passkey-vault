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
import { t } from "../../lib/i18n/dictionary";

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

  it("D-12 (new — create() throws NotAllowedError): stays silent/idle, no banner, create button remains enabled", async () => {
    (navigator.credentials.create as unknown as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockRejectedValue(new DOMException("cancelled", "NotAllowedError"));

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

    const createButton = screen.getByRole("button", { name: /create a passkey|utwórz passkey/i });
    fireEvent.click(createButton);

    await waitFor(() => expect(navigator.credentials.create).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByText(/fast unlock isn't available|szybkie odblokowanie passkeyem nie jest dostępne/i),
    ).not.toBeInTheDocument();
    expect(createButton).not.toBeDisabled();
  });

  it("D-12 (new — create() throws a non-cancel error): renders the neutral D-13 banner and disables the create button", async () => {
    (navigator.credentials.create as unknown as ReturnType<typeof vi.fn>) = vi
      .fn()
      .mockRejectedValue(new DOMException("no support", "NotSupportedError"));

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

    const createButton = screen.getByRole("button", { name: /create a passkey|utwórz passkey/i });
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(
        screen.getByText(/fast unlock isn't available|szybkie odblokowanie passkeyem nie jest dostępne/i),
      ).toBeInTheDocument();
    });
    expect(createButton).toBeDisabled();
  });

  it("skipping via 'Not now' dismisses without calling suppressPrompt", () => {
    const onDone = vi.fn();
    render(<EnrollExtPasskeyPrompt locale="en" onDone={onDone} />);

    fireEvent.click(screen.getByRole("button", { name: /not now|nie teraz/i }));

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(mockSendMessage.mock.calls.some(([m]) => m.kind === "extPasskey.suppressPrompt")).toBe(false);
  });

  it("checking 'Don't ask again' records the preference but does NOT dismiss the card", async () => {
    mockSendMessage.mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(<EnrollExtPasskeyPrompt locale="en" onDone={onDone} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /don't ask again|nie pytaj ponownie/i }));

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "extPasskey.suppressPrompt", suppress: true }),
      );
    });
    // Regression (Bartek, live test): ticking the box used to call onDone(),
    // yanking the card away mid-interaction. Dismissal must stay explicit.
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /don't ask again|nie pytaj ponownie/i })).toBeChecked();
  });

  it("can tick 'Don't ask again' AND still enrol in the same interaction", async () => {
    const prfBytes = new Uint8Array(32).fill(7).buffer;
    navigator.credentials.create = vi.fn().mockResolvedValue(mockCreatedCredential(true));
    navigator.credentials.get = vi.fn().mockResolvedValue(mockGetAssertion(prfBytes));

    const saltB64 = btoa("0123456789abcdef0123456789abcdef");
    mockSendMessage.mockImplementation(async (message: { kind: string }) => {
      if (message.kind === "extPasskey.suppressPrompt") return { ok: true };
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
    const onDone = vi.fn();
    render(<EnrollExtPasskeyPrompt locale="en" onDone={onDone} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /don't ask again|nie pytaj ponownie/i }));
    fireEvent.click(screen.getByRole("button", { name: /create a passkey|utwórz passkey/i }));

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "extPasskey.enroll.finish" }),
    );
  });
});

// Plan 13-07 (13-REVIEW.md's own D-03 seam): on Firefox, rpId=extension-id
// create() is PERMANENTLY unsupported (13-FF-WEBAUTHN-RESEARCH.md) -- this
// prompt must not advertise it. `import.meta.env.FIREFOX` is a per-MODULE
// property (ECMAScript's `import.meta` is a fresh object per module
// namespace -- confirmed empirically: mutating it from a TEST file's own
// `import.meta.env` does NOT affect the already-imported component
// module's separate `import.meta.env` object, unlike a `vi.mock`-backed
// dependency), so the actual branch switch cannot be exercised via jsdom
// env-mutation the way e.g. `navigator.credentials` mocks can be swapped
// per test. This is the SAME limitation UnlockView.test.tsx's own D-12
// suite already lives with for its `import.meta.env.FIREFOX` fallback
// (13-06-SUMMARY.md documents that branch as verified only by the real
// Firefox e2e harness, never jsdom) -- mirrored here rather than
// reinvented. This describe block therefore does two honest things
// instead: (1) a structural source-grep proving the Firefox branch exists,
// points at the NEW server-path copy key, and never references the dead
// `extPasskey.enroll.start` kind within its own conditional body (mirrors
// manifest-permissions.test.ts's own grep-based precedent for this exact
// `import.meta.env.FIREFOX` conditional-compilation pattern); (2) the
// Chrome branch's own pre-existing 7 tests above already prove
// byte-identical Chrome behavior (no FIREFOX stub applied, exactly as
// before this plan). The ACTUAL rendered Firefox behavior is verified by
// `extension/e2e-firefox/run-server-unlock.cjs` (Task 3) against a real
// Firefox build, where `import.meta.env.FIREFOX` is genuinely `true`.
describe("EnrollExtPasskeyPrompt — Firefox branch (Plan 13-07, structural)", () => {
  it("gates a server-path pointer on import.meta.env.FIREFOX, and that gated block never references the dead ext-scoped enroll CTA", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const source = await fs.readFile(
      path.join(import.meta.dirname, "EnrollExtPasskeyPrompt.tsx"),
      "utf-8",
    );

    const gateIndex = source.indexOf("import.meta.env.FIREFOX");
    expect(gateIndex).toBeGreaterThan(-1);

    // The FIREFOX-gated `if` block's own body -- everything between its
    // opening brace and the Chrome-branch `return` that follows it.
    const blockStart = source.indexOf("{", gateIndex);
    const blockEnd = source.indexOf('return (\n    <div className="flex w-[380px] flex-col gap-3', gateIndex + 1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const gatedBlock = source.slice(blockStart, blockEnd);

    expect(gatedBlock).toContain("extPasskey.serverPathPointer");
    expect(gatedBlock).not.toContain("extPasskey.enroll.start");
    expect(gatedBlock).not.toContain("extPasskey.promptCta");
    // Dismiss/suppress mechanics stay present in the Firefox branch.
    expect(gatedBlock).toContain("extPasskey.promptDontAskAgain");
    expect(gatedBlock).toContain("extPasskey.promptSkip");
  });

  it("the PL/EN copy for the new server-path pointer key exists in the dictionary", () => {
    expect(t("en", "extPasskey.serverPathPointer")).toMatch(
      /sign-in and unlock screens/i,
    );
    expect(t("pl", "extPasskey.serverPathPointer")).toMatch(
      /ekranie logowania i odblokowania/i,
    );
  });
});
