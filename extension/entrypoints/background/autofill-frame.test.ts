// entrypoints/background/autofill-frame.test.ts — plan 10-09's 5 required
// behaviors for the content-relay<->background channel. frame-guard.ts
// (originFromContentSender/itemMatchesOrigin) AND autofill-match.ts's pure
// helpers (asFillKind/maskedHintFor/buildFillValues/EMPTY_DETECTED) are left
// REAL/unmocked -- this suite exercises the actual origin/frame gate and the
// actual field-mapping logic, not stand-ins for them (mirrors
// autofill-match.test.ts's own precedent). Only vault-session
// (ensureHydrated), vault-store (getItems), the wasm-loader crypto
// choke-point (totpNow, pulled in transitively via autofill-match.ts), and
// wxt/browser's runtime.id + tabs.sendMessage are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockEnsureHydrated: vi.fn(),
  mockGetItems: vi.fn(),
  mockTouchVaultItem: vi.fn(),
  mockTotpNow: vi.fn(),
  mockTabsSendMessage: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-ext-id",
      getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
    },
    tabs: {
      sendMessage: hoisted.mockTabsSendMessage,
    },
  },
}));

vi.mock("./vault-session", () => ({
  ensureHydrated: hoisted.mockEnsureHydrated,
}));

vi.mock("./vault-store", () => ({
  getItems: hoisted.mockGetItems,
  touchVaultItem: hoisted.mockTouchVaultItem,
}));

vi.mock("../../lib/crypto/wasm-loader", () => ({
  totpNow: hoisted.mockTotpNow,
}));

import { assertContentSender, handleFillFrame, handleMatchFrame } from "./autofill-frame";
import { EMPTY_DETECTED } from "./autofill-match";
import type { VaultItem } from "../../lib/vault/types";

// A distinctive, greppable password so the fill-response test can assert it
// never appears anywhere in the serialized response.
const SECRET_PASSWORD = "hunter2-do-not-leak";

function loginItem(id: string, urls: string[], username = "user@example.com"): VaultItem {
  return {
    id,
    revision: 1,
    fields: {
      type: "login",
      name: `Login ${id}`,
      folderId: null,
      tags: [],
      username,
      password: SECRET_PASSWORD,
      urls,
      notes: "",
    },
  };
}

// Genuine content-script sender: tab defined, own extension id, a parseable
// web-page origin, an explicit frameId -- exactly the platform-provided
// shape a real ISOLATED-world content script reports.
const CONTENT_SENDER = {
  id: "test-ext-id",
  tab: { id: 7 },
  origin: "https://a.example",
  frameId: 0,
} as never;

// A popup sender -- no `tab`, extension-origin document. assertPopupSender
// would accept this; assertContentSender must refuse it (this channel is
// content-script-only).
const POPUP_SENDER = {
  id: "test-ext-id",
  url: "chrome-extension://test-ext-id/popup.html",
} as never;

// Same tab/origin shape as CONTENT_SENDER but a DIFFERENT extension id --
// simulates a foreign extension somehow reaching this listener.
const FOREIGN_SENDER = {
  id: "other-ext-id",
  tab: { id: 7 },
  origin: "https://a.example",
  frameId: 0,
} as never;

// A tab-hosted sender with neither `origin` nor a parseable `url` --
// originFromContentSender() returns null for this shape.
const UNPARSEABLE_SENDER = {
  id: "test-ext-id",
  tab: { id: 7 },
  frameId: 0,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("assertContentSender", () => {
  it("passes for a genuine content-script sender, resolving origin/tabId/frameId from the platform-provided sender", () => {
    expect(assertContentSender(CONTENT_SENDER)).toEqual({
      ok: true,
      origin: "https://a.example",
      tabId: 7,
      frameId: 0,
    });
  });

  it("refuses a popup sender (no tab, extension-origin document)", () => {
    expect(assertContentSender(POPUP_SENDER)).toEqual({ ok: false });
  });

  it("refuses a foreign extension id even with an otherwise valid tab/origin shape", () => {
    expect(assertContentSender(FOREIGN_SENDER)).toEqual({ ok: false });
  });

  it("refuses a sender whose origin/url neither parse", () => {
    expect(assertContentSender(UNPARSEABLE_SENDER)).toEqual({ ok: false });
  });
});

describe("handleMatchFrame", () => {
  it("returns matches only for items bound to the SENDER's own origin; an item bound to a different origin is absent even though it exists in the store", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://a.example/x"]),
      loginItem("item-2", ["https://other.example/y"]),
    ]);

    const result = await handleMatchFrame(
      {
        kind: "autofill.matchFrame",
        detected: { login: true, totp: false, card: false, identity: false },
      },
      CONTENT_SENDER,
    );

    expect(result.pageState).toBe("ok");
    expect(result.matches).toEqual([
      { itemId: "item-1", kind: "login", label: "Login item-1", maskedHint: "user@example.com" },
    ]);
  });

  it("ignores any origin-looking field on the payload -- the resolved origin is always the SENDER's, never one named in the message", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    // Item stored ONLY for the payload's claimed origin, never for the real
    // sender origin (https://a.example) -- if the handler ever read the
    // payload's origin instead of the sender's, this item would match.
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://victim.example/x"])]);

    const result = await handleMatchFrame(
      {
        kind: "autofill.matchFrame",
        detected: { login: true, totp: false, card: false, identity: false },
        // The real request shape (ext-protocol.ts) carries no origin field
        // at all -- this simulates a caller trying to smuggle one in via the
        // payload anyway; `as never` bypasses the type system the same way
        // an adversarial/hand-crafted message would at the JSON boundary.
        origin: "https://victim.example",
      } as never,
      CONTENT_SENDER,
    );

    expect(result.origin).toBe("https://a.example");
    expect(result.matches).toEqual([]);
  });

  it("returns an empty restricted result for a non-content-script sender, never touching ensureHydrated", async () => {
    const result = await handleMatchFrame(
      {
        kind: "autofill.matchFrame",
        detected: { login: true, totp: false, card: false, identity: false },
      },
      POPUP_SENDER,
    );

    expect(result).toEqual({
      pageState: "restricted",
      origin: null,
      detected: EMPTY_DETECTED,
      matches: [],
    });
    expect(hoisted.mockEnsureHydrated).not.toHaveBeenCalled();
    expect(hoisted.mockGetItems).not.toHaveBeenCalled();
  });
});

describe("handleFillFrame", () => {
  it("refuses with reason 'origin-mismatch' when the item's origin does not match the sender's origin", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://other.example/x"])]);

    const result = await handleFillFrame(
      { kind: "autofill.fillFrame", itemId: "item-1", kind_: "login" },
      CONTENT_SENDER,
    );

    expect(result).toEqual({ ok: false, reason: "origin-mismatch" });
    expect(hoisted.mockTabsSendMessage).not.toHaveBeenCalled();
  });

  it("dispatches content.fill to {tabId: sender.tab.id, frameId: sender.frameId} when the item matches, and the response never carries a field value", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://a.example/x"])]);
    hoisted.mockTabsSendMessage.mockResolvedValue({ ok: true });

    const result = await handleFillFrame(
      { kind: "autofill.fillFrame", itemId: "item-1", kind_: "login" },
      CONTENT_SENDER,
    );

    expect(result).toEqual({ ok: true });
    expect(JSON.stringify(result)).not.toContain(SECRET_PASSWORD);
    expect(hoisted.mockTabsSendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ kind: "content.fill" }),
      { frameId: 0 },
    );
    // NordPass-style last-used tracking (quick-260717): a successful
    // in-page overlay fill touches the item, mirroring handleAutofillFill's
    // popup-driven counterpart (autofill-match.ts).
    expect(hoisted.mockTouchVaultItem).toHaveBeenCalledWith("item-1");
  });

  it("refuses with reason 'locked' when the vault is locked, never reading items or dispatching a fill", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);

    const result = await handleFillFrame(
      { kind: "autofill.fillFrame", itemId: "item-1", kind_: "login" },
      CONTENT_SENDER,
    );

    expect(result).toEqual({ ok: false, reason: "locked" });
    expect(hoisted.mockGetItems).not.toHaveBeenCalled();
    expect(hoisted.mockTabsSendMessage).not.toHaveBeenCalled();
  });

  it("refuses a non-content-script sender without dispatching a fill", async () => {
    const result = await handleFillFrame(
      { kind: "autofill.fillFrame", itemId: "item-1", kind_: "login" },
      POPUP_SENDER,
    );

    expect(result.ok).toBe(false);
    expect(hoisted.mockTabsSendMessage).not.toHaveBeenCalled();
  });
});
