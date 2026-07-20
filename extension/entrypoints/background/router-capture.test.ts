// entrypoints/background/router-capture.test.ts — CR-01/WR-01/WR-03/WR-04
// regression cover for router.ts's content-frame capture.propose/
// capture.confirm dispatch (11-REVIEW.md). Exercises
// registerAutofillFrameChannel() directly (a SEPARATE onMessage listener
// from registerMessageRouter() -- see router.test.ts's own header comment
// for why the two channels are independent) with a content-script-shaped
// sender (`sender.tab` defined), never the popup-shaped `OWN_SENDER`
// router.test.ts uses for the OTHER channel.
//
// CR-01's headline regression: `classifySubmit`/`confirmNewLogin`/
// `confirmUpdateLogin` must always be called with the sender-derived
// origin `assertContentSender()` resolves (mocked here as `guard.origin`),
// NEVER the payload's self-reported `frameOrigin` -- every test below
// deliberately sends a LYING payload frameOrigin distinct from the mocked
// guard.origin and asserts the TRUSTED value is what reaches the handler.
import { describe, expect, it, vi, beforeEach } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockEnsureHydrated: vi.fn(),
  mockNoteActivity: vi.fn(),
  mockGetItems: vi.fn(),
  mockEnsureItemsHydrated: vi.fn(),
  mockAssertContentSender: vi.fn(),
  mockClassifySubmit: vi.fn(),
  mockConfirmNewLogin: vi.fn(),
  mockConfirmUpdateLogin: vi.fn(),
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

vi.mock("./vault-session", () => ({
  ensureHydrated: hoisted.mockEnsureHydrated,
  noteActivity: hoisted.mockNoteActivity,
}));

vi.mock("./vault-store", () => ({
  getItems: hoisted.mockGetItems,
  getFolders: vi.fn(),
  ensureItemsHydrated: hoisted.mockEnsureItemsHydrated,
  RevisionConflictError: class RevisionConflictError extends Error {
    constructor() {
      super("item revision changed elsewhere — refresh and try again");
      this.name = "RevisionConflictError";
    }
  },
}));

vi.mock("./autofill-frame", () => ({
  assertContentSender: hoisted.mockAssertContentSender,
  handleMatchFrame: vi.fn(),
  handleFillFrame: vi.fn(),
}));

vi.mock("./capture-handler", () => ({
  classifySubmit: hoisted.mockClassifySubmit,
  confirmNewLogin: hoisted.mockConfirmNewLogin,
  confirmUpdateLogin: hoisted.mockConfirmUpdateLogin,
  LockedVaultError: class LockedVaultError extends Error {
    constructor() {
      super("cannot persist a captured login while the vault is locked");
      this.name = "LockedVaultError";
    }
  },
  OwnershipMismatchError: class OwnershipMismatchError extends Error {
    constructor() {
      super("target item does not belong to the requesting origin/account");
      this.name = "OwnershipMismatchError";
    }
  },
}));

vi.mock("./generate-handler", () => ({
  handleGenerateRequest: vi.fn(),
}));

// Handlers the router imports but this file doesn't exercise -- mocked
// purely to cut off unrelated eager imports (router.test.ts's own
// precedent for the same reason).
vi.mock("./autolock", () => ({
  armAutoLock: vi.fn(),
  AUTOLOCK_OPTIONS: [5, 15, 30, 60],
  DEFAULT_AUTOLOCK_MINUTES: 15,
}));
vi.mock("./session-storage", () => ({
  readSessionMeta: vi.fn(),
  writeSessionMeta: vi.fn(),
}));
vi.mock("./unlock", () => ({
  handleUnlockPassword: vi.fn(),
}));
vi.mock("./server-config", () => ({
  readServerConfig: vi.fn(),
  configureServer: vi.fn(),
  InvalidServerUrlError: class extends Error {},
  ServerUnreachableError: class extends Error {},
}));
vi.mock("./autofill-match", () => ({
  handleAutofillFill: vi.fn(),
  handleAutofillMatch: vi.fn(),
  handleAutofillTotpCode: vi.fn(),
}));

import { registerAutofillFrameChannel } from "./router";

// A content-script sender -- `sender.tab` IS defined, unlike
// router.test.ts's popup-shaped `OWN_SENDER` (sender.tab undefined).
// `assertContentSender` is mocked directly above, so the exact shape here
// only needs to be something that mocked function ignores.
const CONTENT_SENDER = { id: "test-ext-id", tab: { id: 7, url: "https://top.example/" }, frameId: 0 };

/** Drives the real listener the way Chrome does, resolving sendResponse. */
async function send(message: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const kept = hoisted.listeners[0](message, CONTENT_SENDER, resolve);
    expect(kept).toBe(true); // async channel held open
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listeners.length = 0;
  registerAutofillFrameChannel();
});

describe("capture.propose", () => {
  it("CR-01: uses the TRUSTED sender-derived origin for classifySubmit -- never the payload's self-reported frameOrigin", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({
      ok: true,
      origin: "https://trusted.example",
      tabId: 7,
      frameId: 0,
    });
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockEnsureItemsHydrated.mockResolvedValue({ ok: true });
    hoisted.mockGetItems.mockReturnValue([]);
    hoisted.mockClassifySubmit.mockReturnValue({
      action: "new",
      frameOrigin: "https://trusted.example",
      topOrigin: "https://top.example",
      mismatch: false,
    });

    await send({
      kind: "capture.propose",
      frameOrigin: "https://attacker-lied.example", // self-report -- must be discarded
      username: "user@example.com",
      password: "pw1",
    });

    expect(hoisted.mockClassifySubmit).toHaveBeenCalledWith(
      { frameOrigin: "https://trusted.example", username: "user@example.com", password: "pw1" },
      [],
      "https://top.example",
    );
  });

  it("WR-03: gates on ensureHydrated() before classifying -- never calls classifySubmit while locked (fails closed instead of misclassifying against an empty cache)", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({
      ok: true,
      origin: "https://trusted.example",
      tabId: 7,
      frameId: 0,
    });
    hoisted.mockEnsureHydrated.mockResolvedValue(null);

    const response = await send({
      kind: "capture.propose",
      frameOrigin: "https://trusted.example",
      username: "user@example.com",
      password: "pw1",
    });

    expect(hoisted.mockClassifySubmit).not.toHaveBeenCalled();
    expect(hoisted.mockGetItems).not.toHaveBeenCalled();
    expect(hoisted.mockEnsureItemsHydrated).not.toHaveBeenCalled();
    expect(response).toEqual({
      action: "no-op",
      frameOrigin: "https://trusted.example",
      topOrigin: "",
      mismatch: true,
    });
  });

  it("WR-03 (iteration 2, REGRESSION -- fails on the cosmetic iteration-1 fix): awaits ensureItemsHydrated() before classifying, so a proposal for an already-saved credential that lands mid-pull classifies against the SETTLED cache, not a stale empty one", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({
      ok: true,
      origin: "https://trusted.example",
      tabId: 7,
      frameId: 0,
    });
    hoisted.mockEnsureHydrated.mockResolvedValue({});

    // Simulates the exact race WR-03 (iteration 2) identified: on a
    // freshly-woken service worker, ensureHydrated() resolves (the User
    // Key is available) while the item cache's initial sync pull is still
    // in flight. getItems() only reflects the existing credential AFTER
    // ensureItemsHydrated() resolves -- on the cosmetic iteration-1 fix
    // (which never calls ensureItemsHydrated() at all), classifySubmit
    // would be invoked with the still-empty array below.
    let hydrated = false;
    hoisted.mockEnsureItemsHydrated.mockImplementation(async () => {
      await Promise.resolve();
      hydrated = true;
      return { ok: true };
    });
    hoisted.mockGetItems.mockImplementation(() => (hydrated ? ["existing-item"] : []));
    hoisted.mockClassifySubmit.mockImplementation((_fields, decryptedItems: unknown[]) => ({
      action: decryptedItems.length > 0 ? "update" : "new",
      itemId: decryptedItems.length > 0 ? "item-1" : undefined,
      currentRevision: decryptedItems.length > 0 ? 1 : undefined,
      frameOrigin: "https://trusted.example",
      topOrigin: "https://top.example",
      mismatch: false,
    }));

    const response = await send({
      kind: "capture.propose",
      frameOrigin: "https://trusted.example",
      username: "user@example.com",
      password: "pw1",
    });

    expect(hoisted.mockEnsureItemsHydrated).toHaveBeenCalledTimes(1);
    expect(hoisted.mockClassifySubmit).toHaveBeenCalledWith(
      expect.anything(),
      ["existing-item"],
      "https://top.example",
    );
    expect(response).toMatchObject({ action: "update" });
  });

  it("WR-03 (iteration 2): fails closed (no-op) when the initial item-cache pull fails, rather than classifying against an unknown-state cache", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({
      ok: true,
      origin: "https://trusted.example",
      tabId: 7,
      frameId: 0,
    });
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockEnsureItemsHydrated.mockResolvedValue({ ok: false, error: new Error("network down") });

    const response = await send({
      kind: "capture.propose",
      frameOrigin: "https://trusted.example",
      username: "user@example.com",
      password: "pw1",
    });

    expect(hoisted.mockClassifySubmit).not.toHaveBeenCalled();
    expect(hoisted.mockGetItems).not.toHaveBeenCalled();
    expect(response).toEqual({
      action: "no-op",
      frameOrigin: "https://trusted.example",
      topOrigin: "",
      mismatch: true,
    });
  });

  it("fails closed on a rejected sender without calling classifySubmit, ensureHydrated, or ensureItemsHydrated", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({ ok: false });

    const response = await send({
      kind: "capture.propose",
      frameOrigin: "https://attacker.example",
      username: "user@example.com",
      password: "pw1",
    });

    expect(hoisted.mockClassifySubmit).not.toHaveBeenCalled();
    expect(hoisted.mockEnsureHydrated).not.toHaveBeenCalled();
    expect(hoisted.mockEnsureItemsHydrated).not.toHaveBeenCalled();
    expect(response).toEqual({ action: "no-op", frameOrigin: "", topOrigin: "", mismatch: true });
  });
});

describe("capture.confirm", () => {
  it("CR-01/WR-01: persists a NEW login using the TRUSTED sender-derived frameOrigin, never the payload's self-reported value", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({
      ok: true,
      origin: "https://trusted.example",
      tabId: 7,
      frameId: 0,
    });
    hoisted.mockConfirmNewLogin.mockResolvedValue({ id: "item-1", revision: 1 });

    await send({
      kind: "capture.confirm",
      action: "new",
      frameOrigin: "https://attacker-lied.example",
      username: "user@example.com",
      password: "pw1",
    });

    expect(hoisted.mockConfirmNewLogin).toHaveBeenCalledWith({
      frameOrigin: "https://trusted.example",
      username: "user@example.com",
      password: "pw1",
    });
  });

  it("CR-01/WR-01: persists an UPDATE using the TRUSTED sender-derived frameOrigin, never the payload's self-reported value", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({
      ok: true,
      origin: "https://trusted.example",
      tabId: 7,
      frameId: 0,
    });
    hoisted.mockConfirmUpdateLogin.mockResolvedValue({ id: "item-1", revision: 3 });

    await send({
      kind: "capture.confirm",
      action: "update",
      frameOrigin: "https://attacker-lied.example",
      username: "user@example.com",
      password: "pw2",
      itemId: "item-1",
      currentRevision: 2,
    });

    expect(hoisted.mockConfirmUpdateLogin).toHaveBeenCalledWith(
      "item-1",
      { frameOrigin: "https://trusted.example", username: "user@example.com", password: "pw2" },
      2,
    );
  });

  it("WR-04: maps an OwnershipMismatchError from confirmUpdateLogin to {status:'error'} instead of leaking/throwing", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({
      ok: true,
      origin: "https://trusted.example",
      tabId: 7,
      frameId: 0,
    });
    const { OwnershipMismatchError } = await import("./capture-handler");
    hoisted.mockConfirmUpdateLogin.mockRejectedValue(new OwnershipMismatchError());

    const response = await send({
      kind: "capture.confirm",
      action: "update",
      frameOrigin: "https://trusted.example",
      username: "user@example.com",
      password: "pw1",
      itemId: "item-1",
      currentRevision: 2,
    });

    expect(response).toEqual({
      status: "error",
      message: "target item does not belong to the requesting origin/account",
    });
  });

  it("fails closed on a rejected sender without calling confirmNewLogin/confirmUpdateLogin", async () => {
    hoisted.mockAssertContentSender.mockReturnValue({ ok: false });

    const response = await send({
      kind: "capture.confirm",
      action: "new",
      frameOrigin: "https://attacker.example",
      username: "user@example.com",
      password: "pw1",
    });

    expect(hoisted.mockConfirmNewLogin).not.toHaveBeenCalled();
    expect(hoisted.mockConfirmUpdateLogin).not.toHaveBeenCalled();
    expect(response).toEqual({ status: "error", message: "forbidden-sender" });
  });
});
