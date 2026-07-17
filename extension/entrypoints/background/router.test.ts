// router.test.ts — regression cover for the auto-lock control, which
// shipped INERT and was caught only by a real-browser UAT (picking 5 left
// the alarm at 15; reopening the popup showed 15 again). Two defects, both
// pinned here:
//   1. setAutoLockMinutes only armed the alarm and never PERSISTED the new
//      interval to session meta — so noteActivity()'s next re-arm (which
//      reads meta) clobbered it straight back, and session.status re-seeded
//      the popup's select from the stale field.
//   2. The listener fired noteActivity() concurrently with the handler, and
//      noteActivity reads the PRE-change interval — a race whose loser was
//      usually the user's new choice.
// There was no router test file at all before this, which is exactly how an
// entirely non-functional EXT-03 control passed a green suite.
import { describe, expect, it, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockArmAutoLock: vi.fn(),
  mockNoteActivity: vi.fn(),
  mockReadSessionMeta: vi.fn(),
  mockWriteSessionMeta: vi.fn(),
  mockEnsureHydrated: vi.fn(),
  mockHandleMatchFrame: vi.fn(),
  mockAssertContentSender: vi.fn(),
  mockHandleCredentialsCreate: vi.fn(),
  mockHandleCredentialsGet: vi.fn(),
  mockResolveProviderCredentialChoice: vi.fn(),
  mockTouchVaultItem: vi.fn(),
  listeners: [] as Array<(m: unknown, s: unknown, r: unknown) => unknown>,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-ext-id",
      getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
      onMessage: {
        addListener: (cb: (m: unknown, s: unknown, r: unknown) => unknown) => {
          hoisted.listeners.push(cb);
        },
      },
    },
  },
}));

vi.mock("./autolock", () => ({
  armAutoLock: hoisted.mockArmAutoLock,
  AUTOLOCK_OPTIONS: [5, 15, 30, 60],
  DEFAULT_AUTOLOCK_MINUTES: 15,
}));

vi.mock("./session-storage", () => ({
  readSessionMeta: hoisted.mockReadSessionMeta,
  writeSessionMeta: hoisted.mockWriteSessionMeta,
}));

vi.mock("./vault-session", () => ({
  ensureHydrated: hoisted.mockEnsureHydrated,
  noteActivity: hoisted.mockNoteActivity,
}));

// Handlers the router imports but this file doesn't exercise.
vi.mock("./unlock", () => ({
  handleUnlockPassword: vi.fn(),
  handleUnlockPrfStart: vi.fn(),
  handleUnlockPrfFinish: vi.fn(),
  handleSignInPrfStart: vi.fn(),
  handleSignInPrfFinish: vi.fn(),
}));
vi.mock("./ext-passkey", () => ({
  handleExtEnrollStart: vi.fn(),
  handleExtEnrollFinish: vi.fn(),
  handleExtPrfUnlockStart: vi.fn(),
  handleExtPrfUnlockFinish: vi.fn(),
  hasEnrolledExtPasskey: vi.fn().mockResolvedValue(false),
  readExtPasskeyPromptSuppressed: vi.fn().mockResolvedValue(false),
  setExtPasskeyPromptSuppressed: vi.fn(),
}));
vi.mock("./server-config", () => ({
  readServerConfig: vi.fn(),
  configureServer: vi.fn(),
  InvalidServerUrlError: class extends Error {},
  ServerUnreachableError: class extends Error {},
}));
vi.mock("./vault-store", () => ({
  getVaultList: vi.fn(),
  ensureVaultSyncStarted: vi.fn(),
  touchVaultItem: hoisted.mockTouchVaultItem,
}));
vi.mock("./autofill-frame", () => ({
  handleMatchFrame: hoisted.mockHandleMatchFrame,
  handleFillFrame: vi.fn(),
  assertContentSender: hoisted.mockAssertContentSender,
}));
vi.mock("./generate-handler", () => ({
  handleGenerateRequest: vi.fn(),
}));
vi.mock("./provider-ceremony", () => ({
  handleCredentialsCreate: hoisted.mockHandleCredentialsCreate,
  handleCredentialsGet: hoisted.mockHandleCredentialsGet,
  resolveProviderCredentialChoice: hoisted.mockResolveProviderCredentialChoice,
}));

import { registerAutofillFrameChannel, registerMessageRouter } from "./router";

const OWN_SENDER = { id: "test-ext-id", url: "chrome-extension://test-ext-id/popup.html" };

/** Drives the real listener the way Chrome does, resolving sendResponse. */
async function send(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const kept = hoisted.listeners[0](message, OWN_SENDER, resolve);
    expect(kept).toBe(true); // async channel held open
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listeners.length = 0;
  hoisted.mockReadSessionMeta.mockResolvedValue({
    sessionToken: "tok",
    accountEmail: "a@example.com",
    idleTimeoutMinutes: 15,
    unlockedAtMs: 1,
    wasAutoLocked: false,
  });
  registerMessageRouter();
});

describe("session.setAutoLockMinutes", () => {
  it("PERSISTS the new interval to session meta and arms the alarm with it", async () => {
    await send({ kind: "session.setAutoLockMinutes", minutes: 5 });

    expect(hoisted.mockWriteSessionMeta).toHaveBeenCalledWith(
      expect.objectContaining({ idleTimeoutMinutes: 5, sessionToken: "tok" }),
    );
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledWith(5);
  });

  it("does NOT run noteActivity for this kind — it would re-arm from the pre-change interval and race the new value", async () => {
    await send({ kind: "session.setAutoLockMinutes", minutes: 30 });
    expect(hoisted.mockNoteActivity).not.toHaveBeenCalled();
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledTimes(1);
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledWith(30);
  });

  it("rejects an out-of-whitelist value: default is persisted and armed, never the raw input", async () => {
    await send({ kind: "session.setAutoLockMinutes", minutes: 1 });
    expect(hoisted.mockWriteSessionMeta).toHaveBeenCalledWith(
      expect.objectContaining({ idleTimeoutMinutes: 15 }),
    );
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledWith(15);
  });

  it("locked session (no meta) still arms without throwing", async () => {
    hoisted.mockReadSessionMeta.mockResolvedValue(null);
    await send({ kind: "session.setAutoLockMinutes", minutes: 60 });
    expect(hoisted.mockWriteSessionMeta).not.toHaveBeenCalled();
    expect(hoisted.mockArmAutoLock).toHaveBeenCalledWith(60);
  });
});

describe("noteActivity on other kinds", () => {
  it("still re-arms on ordinary activity (session.status)", async () => {
    await send({ kind: "session.status" });
    expect(hoisted.mockNoteActivity).toHaveBeenCalled();
  });
});

describe("WR-01 rejection path", () => {
  it("a rejecting handler still resolves sendResponse with a typed error, instead of hanging the message channel forever", async () => {
    hoisted.mockEnsureHydrated.mockRejectedValue(new Error("corrupt envelope"));

    const result = await send({ kind: "session.status" });

    expect(result).toEqual({ ok: false, error: "unknown" });
  });
});

describe("WR-01 sender gate", () => {
  it("ignores a message from a tab-hosted content script on a hostile page", async () => {
    const r = hoisted.listeners[0](
      { kind: "session.status" },
      { id: "test-ext-id", url: "https://evil.example/page" },
      vi.fn(),
    );
    expect(r).toBeUndefined();
    expect(hoisted.mockNoteActivity).not.toHaveBeenCalled();
  });

  it("ignores a message from a foreign extension", async () => {
    const r = hoisted.listeners[0](
      { kind: "session.status" },
      { id: "other-ext", url: "chrome-extension://other-ext/popup.html" },
      vi.fn(),
    );
    expect(r).toBeUndefined();
  });
});

// Phase 10 (Plan 10-01, T-10-01): handle()'s own assertPopupSender() guard,
// independent of the WR-01 top-level gate above. A real hostile content
// script never reaches this point today (WR-01's sender.url check already
// rejects it before handle() runs) -- this pins the SECOND, independent
// layer directly, so it stays proven even if a later plan legitimately
// widens the WR-01 gate to admit content-relay senders for autofill.*
// traffic (exactly the scenario the code comments warn about).
describe("handle() privilege-tier guard (T-10-01)", () => {
  it("refuses session.status when the sender DOCUMENT's origin is a web page, even when id/url would pass the top-level gate", async () => {
    // The layer-2 guard prefers sender.origin -- a content-script shape
    // reaching handle() (if layer-1 is ever widened) reports the WEB
    // page's origin, and that alone must refuse it.
    const result = await new Promise((resolve) => {
      hoisted.listeners[0](
        { kind: "session.status" },
        {
          id: "test-ext-id",
          url: "chrome-extension://test-ext-id/popup.html",
          origin: "https://evil.example",
          tab: { id: 7 },
        },
        resolve,
      );
    });
    expect(result).toEqual({ ok: false, error: "forbidden-sender" });
    expect(hoisted.mockEnsureHydrated).not.toHaveBeenCalled();
  });

  it("refuses vault.list from the same web-origin sender shape", async () => {
    const result = await new Promise((resolve) => {
      hoisted.listeners[0](
        { kind: "vault.list" },
        {
          id: "test-ext-id",
          url: "chrome-extension://test-ext-id/popup.html",
          origin: "https://evil.example",
          tab: { id: 7 },
        },
        resolve,
      );
    });
    expect(result).toEqual({ ok: false, error: "forbidden-sender" });
  });

  // quick-260717: vault.touch shares the same "vault." prefix WR-01 gate as
  // vault.list -- pinned separately so a future refactor of that startsWith
  // check can't silently exempt this newer kind.
  it("refuses vault.touch from the same web-origin sender shape", async () => {
    const result = await new Promise((resolve) => {
      hoisted.listeners[0](
        { kind: "vault.touch", itemId: "item-1" },
        {
          id: "test-ext-id",
          url: "chrome-extension://test-ext-id/popup.html",
          origin: "https://evil.example",
          tab: { id: 7 },
        },
        resolve,
      );
    });
    expect(result).toEqual({ ok: false, error: "forbidden-sender" });
    expect(hoisted.mockTouchVaultItem).not.toHaveBeenCalled();
  });

  it("dispatches vault.touch for a genuine popup sender, calling touchVaultItem with the item id", async () => {
    const result = await new Promise((resolve) => {
      hoisted.listeners[0]({ kind: "vault.touch", itemId: "item-42" }, OWN_SENDER, resolve);
    });
    expect(result).toEqual({ ok: true });
    expect(hoisted.mockTouchVaultItem).toHaveBeenCalledWith("item-42");
  });

  it("dispatches session.status normally for popup.html opened AS A TAB -- extension-origin document with `tab` defined (real-Chrome UAT regression)", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    const result = await new Promise((resolve) => {
      hoisted.listeners[0](
        { kind: "session.status" },
        {
          id: "test-ext-id",
          url: "chrome-extension://test-ext-id/popup.html",
          origin: "chrome-extension://test-ext-id",
          tab: { id: 12 },
        },
        resolve,
      );
    });
    expect(result).not.toEqual({ ok: false, error: "forbidden-sender" });
  });

  it("still dispatches session.status normally for the ordinary popup sender (no `tab`)", async () => {
    // Explicit resolved value -- vi.clearAllMocks() in beforeEach clears
    // call history but not a prior test's mockRejectedValue()
    // implementation, so this test does not silently inherit another
    // test's failure-mode mock.
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
    const result = await send({ kind: "session.status" });
    expect(result).not.toEqual({ ok: false, error: "forbidden-sender" });
    expect(result).toEqual(expect.objectContaining({ kind: "locked" }));
  });
});

// Phase 10 (Plan 10-09): registerAutofillFrameChannel() is a SECOND,
// INDEPENDENT listener from registerMessageRouter() -- this pins that a
// content-script sender reaches the NEW listener for its two kinds while
// the popup router's WR-01 addListener-level gate (registered above, in
// this same beforeEach) still refuses that exact sender shape for
// session.status, unchanged.
describe("registerAutofillFrameChannel", () => {
  const CONTENT_SENDER = { id: "test-ext-id", tab: { id: 7 }, origin: "https://a.example" };

  it("accepts a content-sender autofill.matchFrame message on the frame channel, while the popup router still refuses a content-sender session.status", async () => {
    hoisted.mockHandleMatchFrame.mockResolvedValue({
      pageState: "ok",
      origin: "https://a.example",
      detected: { login: true, totp: false, card: false, identity: false },
      matches: [],
    });
    registerAutofillFrameChannel();
    expect(hoisted.listeners).toHaveLength(2); // popup router (index 0) + frame channel (index 1)

    const frameResult = await new Promise((resolve) => {
      const kept = hoisted.listeners[1](
        {
          kind: "autofill.matchFrame",
          detected: { login: true, totp: false, card: false, identity: false },
        },
        CONTENT_SENDER,
        resolve,
      );
      expect(kept).toBe(true); // async channel held open
    });
    expect(frameResult).toEqual(expect.objectContaining({ pageState: "ok" }));
    expect(hoisted.mockHandleMatchFrame).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "autofill.matchFrame" }),
      CONTENT_SENDER,
    );

    // The SAME content-script sender still gets refused by the popup
    // router's own WR-01 addListener-level gate for session.status -- the
    // new channel does not widen that gate at all.
    const popupResult = hoisted.listeners[0]({ kind: "session.status" }, CONTENT_SENDER, vi.fn());
    expect(popupResult).toBeUndefined();
  });

  it("returns undefined for a kind that isn't one of its two -- steps aside for the popup router", () => {
    registerAutofillFrameChannel();
    const result = hoisted.listeners[1]({ kind: "session.status" }, CONTENT_SENDER, vi.fn());
    expect(result).toBeUndefined();
    expect(hoisted.mockHandleMatchFrame).not.toHaveBeenCalled();
  });
});

// Phase 12 (Plan 12-02): credentials.create/credentials.get dispatch on the
// SAME content-frame channel as autofill.matchFrame/capture.* above -- NEVER
// on the popup-facing isProtocolMessage()/handle() channel, whose WR-01 gate
// rejects every content-script sender and would silently drop every
// ceremony. Each handler calls assertContentSender(sender) first and passes
// guard.origin (the sender-verified origin) to handleCredentialsCreate/
// handleCredentialsGet -- there is no origin field on either message shape
// for a caller to spoof in the first place (mirrors autofill.matchFrame's
// own "no origin field" discipline); the fixtures below instead put a
// deliberately-lying "origin-shaped" value INSIDE `publicKey` (a field the
// RP legitimately controls) to make the point concrete: only guard.origin
// ever reaches the handler, regardless of what the payload itself claims.
describe("credentials.create / credentials.get content-frame dispatch", () => {
  const CONTENT_SENDER = { id: "test-ext-id", tab: { id: 7 }, origin: "https://trusted.example" };

  beforeEach(() => {
    registerAutofillFrameChannel();
  });

  it("credentials.create: dispatches to handleCredentialsCreate with the SENDER-verified guard.origin, never a payload-embedded value", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({
      ok: true,
      origin: "https://trusted.example",
      tabId: 7,
      frameId: 0,
    });
    hoisted.mockHandleCredentialsCreate.mockResolvedValue({ fallthrough: false, credentialResponseJson: "{}" });

    const result = await new Promise((resolve) => {
      const kept = hoisted.listeners[1](
        {
          kind: "credentials.create",
          publicKey: { rp: { id: "attacker-lied.example" } }, // RP-controlled, not a sender-origin spoof vector
        },
        CONTENT_SENDER,
        resolve,
      );
      expect(kept).toBe(true);
    });

    expect(hoisted.mockHandleCredentialsCreate).toHaveBeenCalledWith(
      { publicKey: { rp: { id: "attacker-lied.example" } } },
      "https://trusted.example",
    );
    expect(result).toEqual({ fallthrough: false, credentialResponseJson: "{}" });
  });

  it("credentials.get: dispatches to handleCredentialsGet with the SENDER-verified guard.origin", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({
      ok: true,
      origin: "https://trusted.example",
      tabId: 7,
      frameId: 0,
    });
    hoisted.mockHandleCredentialsGet.mockResolvedValue({ fallthrough: true });

    const result = await new Promise((resolve) => {
      hoisted.listeners[1](
        { kind: "credentials.get", publicKey: { rpId: "example.com" } },
        CONTENT_SENDER,
        resolve,
      );
    });

    expect(hoisted.mockHandleCredentialsGet).toHaveBeenCalledWith(
      { publicKey: { rpId: "example.com" } },
      "https://trusted.example",
    );
    expect(result).toEqual({ fallthrough: true });
  });

  it("rejects a sender that fails assertContentSender -- handleCredentialsCreate/Get are never called", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({ ok: false });

    const result = await new Promise((resolve) => {
      hoisted.listeners[1](
        { kind: "credentials.create", publicKey: {} },
        CONTENT_SENDER,
        resolve,
      );
    });

    expect(hoisted.mockHandleCredentialsCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ fallthrough: true });
  });

  it("credentials.create/get are NOT handled by isProtocolMessage()/handle() -- the popup router's WR-01 gate would silently drop every ceremony", async () => {
    // listeners[0] is the popup router (registerMessageRouter(), from the
    // top-level beforeEach). A same-extension-origin (popup-shaped) sender
    // still gets undefined -- these kinds simply aren't in its switch.
    const popupResult = hoisted.listeners[0](
      { kind: "credentials.create", publicKey: {} },
      OWN_SENDER,
      vi.fn(),
    );
    expect(popupResult).toBeUndefined();
    expect(hoisted.mockHandleCredentialsCreate).not.toHaveBeenCalled();
  });

  // Phase 12 (Plan 12-04, deviation): unlike credentials.create/get,
  // provider.resolveChoice IS handled by the popup router (handle()) --
  // it's the popup->background direction, gated by the SAME WR-01
  // addListener check as every other popup-facing kind (registerMessageRouter's
  // top-level beforeEach already sets that channel up).
  it("provider.resolveChoice: dispatches to resolveProviderCredentialChoice for a same-extension-origin (popup) sender", async () => {
    const result = await send({
      kind: "provider.resolveChoice",
      requestId: "req-1",
      itemId: "item-1",
    });

    expect(hoisted.mockResolveProviderCredentialChoice).toHaveBeenCalledWith("req-1", "item-1");
    expect(result).toEqual({ ok: true });
  });

  it("provider.resolveChoice: a content-script sender is refused by the popup router's WR-01 gate, never reaches resolveProviderCredentialChoice", async () => {
    const popupResult = hoisted.listeners[0](
      { kind: "provider.resolveChoice", requestId: "req-1", itemId: null },
      CONTENT_SENDER,
      vi.fn(),
    );
    expect(popupResult).toBeUndefined();
    expect(hoisted.mockResolveProviderCredentialChoice).not.toHaveBeenCalled();
  });

  it("an unrecognized kind still falls through both dispatch chains unmodified -- no regression against existing phase 9-11 kinds", async () => {
    const frameResult = hoisted.listeners[1]({ kind: "autofill.match" }, CONTENT_SENDER, vi.fn());
    expect(frameResult).toBeUndefined();
    expect(hoisted.mockHandleCredentialsCreate).not.toHaveBeenCalled();
    expect(hoisted.mockHandleCredentialsGet).not.toHaveBeenCalled();
  });
});
