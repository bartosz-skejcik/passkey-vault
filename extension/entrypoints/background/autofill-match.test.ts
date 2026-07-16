// entrypoints/background/autofill-match.test.ts — plan 10-04's 7 required
// behaviors. frame-guard.ts (resolveFillTarget/itemMatchesOrigin) is left
// REAL/unmocked so this suite exercises the actual origin/frame gate, not
// a stand-in for it -- only vault-session (ensureHydrated), vault-store
// (getItems), the wasm-loader crypto choke-point (totpNow), and
// wxt/browser's tabs.* are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockEnsureHydrated: vi.fn(),
  mockGetItems: vi.fn(),
  mockTotpNow: vi.fn(),
  mockTabsQuery: vi.fn(),
  mockTabsSendMessage: vi.fn(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    // `runtime.id`/`getURL` are only exercised via the cross-import of
    // `handleMatchFrame` (autofill-frame.ts) in Test 8's overlay-pinning
    // case below -- handleAutofillMatch itself never touches `runtime`.
    runtime: {
      id: "test-ext-id",
      getURL: (p: string) => `chrome-extension://test-ext-id/${p}`,
    },
    tabs: {
      query: hoisted.mockTabsQuery,
      sendMessage: hoisted.mockTabsSendMessage,
    },
  },
}));

vi.mock("./vault-session", () => ({
  ensureHydrated: hoisted.mockEnsureHydrated,
}));

vi.mock("./vault-store", () => ({
  getItems: hoisted.mockGetItems,
}));

vi.mock("../../lib/crypto/wasm-loader", () => ({
  totpNow: hoisted.mockTotpNow,
}));

import { handleAutofillFill, handleAutofillMatch, handleAutofillTotpCode } from "./autofill-match";
import { handleMatchFrame } from "./autofill-frame";
import type { VaultItem } from "../../lib/vault/types";

const POPUP_SENDER = {
  id: "test-ext-id",
  url: "chrome-extension://test-ext-id/popup.html",
} as never;

// A distinctive, greppable password so Test 2 can assert it never appears
// anywhere in the serialized match response.
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

function totpItem(id: string, secret = "JBSWY3DPEHPK3PXP", issuer = ""): VaultItem {
  return {
    id,
    revision: 1,
    fields: {
      type: "totp",
      name: `TOTP ${id}`,
      folderId: null,
      tags: [],
      secret,
      issuer,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      notes: "",
    },
  };
}

function cardItem(id: string): VaultItem {
  return {
    id,
    revision: 1,
    fields: {
      type: "card",
      name: `Card ${id}`,
      folderId: null,
      tags: [],
      cardholderName: "Jane Doe",
      number: "4111111111111111",
      expiry: "12/30",
      cvv: "123",
      notes: "",
    },
  };
}

function identityItem(id: string): VaultItem {
  return {
    id,
    revision: 1,
    fields: {
      type: "identity",
      name: `Identity ${id}`,
      folderId: null,
      tags: [],
      firstName: "Jane",
      lastName: "Doe",
      email: "jane@example.com",
      phone: "",
      address: "",
      notes: "",
    },
  };
}

// Genuine content-script sender shape (mirrors autofill-frame.test.ts's own
// CONTENT_SENDER fixture) -- only used by Test 8's overlay-pinning case
// below, which cross-imports handleMatchFrame to prove the relaxation this
// plan adds to handleAutofillMatch does NOT leak into the overlay channel.
const CONTENT_SENDER = {
  id: "test-ext-id",
  tab: { id: 7 },
  origin: "https://bank.example",
  frameId: 0,
} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Test 1: locked fail-closed", () => {
  beforeEach(() => {
    hoisted.mockEnsureHydrated.mockResolvedValue(null);
  });

  it("match returns empty matches and never touches tabs.query or the content-relay", async () => {
    const result = await handleAutofillMatch(POPUP_SENDER);
    expect(result.matches).toEqual([]);
    expect(hoisted.mockTabsQuery).not.toHaveBeenCalled();
    expect(hoisted.mockTabsSendMessage).not.toHaveBeenCalled();
    expect(hoisted.mockTotpNow).not.toHaveBeenCalled();
  });

  it("fill returns {ok:false, reason:'locked'} and never reads items or derives a TOTP code", async () => {
    const result = await handleAutofillFill(
      { kind: "autofill.fill", itemId: "item-1", kind_: "login" },
      POPUP_SENDER,
    );
    expect(result).toEqual({ ok: false, reason: "locked" });
    expect(hoisted.mockGetItems).not.toHaveBeenCalled();
    expect(hoisted.mockTotpNow).not.toHaveBeenCalled();
  });

  it("totpCode returns {ok:false} and never calls totpNow", async () => {
    const result = await handleAutofillTotpCode(
      { kind: "autofill.totpCode", itemId: "totp-1" },
      POPUP_SENDER,
    );
    expect(result.ok).toBe(false);
    expect(hoisted.mockTotpNow).not.toHaveBeenCalled();
  });
});

describe("Test 2: match returns metadata only", () => {
  it("two matching login items -> two AutofillMatch entries, no password anywhere in the serialized response", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://bank.example/login" }]);
    hoisted.mockTabsSendMessage.mockResolvedValue({
      detected: { login: true, totp: false, card: false, identity: false },
      hasOtpField: false,
    });
    hoisted.mockGetItems.mockReturnValue([
      loginItem("item-1", ["https://bank.example/x"]),
      loginItem("item-2", ["https://bank.example/y"]),
    ]);

    const result = await handleAutofillMatch(POPUP_SENDER);

    expect(result.pageState).toBe("ok");
    expect(result.matches).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(SECRET_PASSWORD);
  });
});

describe("Test 3: fill-time re-verification (TOCTOU)", () => {
  it("refuses a fill when the active tab navigated to a different origin since match", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    // The tab is now on evil.example, even though the item was originally
    // matched against bank.example.
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://evil.example/page" }]);
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://bank.example/x"])]);

    const result = await handleAutofillFill(
      { kind: "autofill.fill", itemId: "item-1", kind_: "login" },
      POPUP_SENDER,
    );

    expect(result).toEqual({ ok: false, reason: "origin-mismatch" });
    expect(hoisted.mockTabsSendMessage).not.toHaveBeenCalled();
  });
});

describe("Test 4: itemId origin ownership", () => {
  it("refuses a well-formed itemId belonging to a DIFFERENT origin's item", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://shop.example/checkout" }]);
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://other-bank.example/x"])]);

    const result = await handleAutofillFill(
      { kind: "autofill.fill", itemId: "item-1", kind_: "login" },
      POPUP_SENDER,
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; reason: string }).reason).toMatch(/^(no-match|origin-mismatch)$/);
    expect(hoisted.mockTabsSendMessage).not.toHaveBeenCalled();
  });
});

describe("Test 5: frame-addressed dispatch", () => {
  it("dispatches to the resolved tabId with an explicit {frameId} option, not a tab-wide broadcast", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 7, url: "https://bank.example/login" }]);
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://bank.example/x"])]);
    hoisted.mockTabsSendMessage.mockResolvedValue({ ok: true });

    const result = await handleAutofillFill(
      { kind: "autofill.fill", itemId: "item-1", kind_: "login" },
      POPUP_SENDER,
    );

    expect(result).toEqual({ ok: true });
    expect(hoisted.mockTabsSendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ kind: "content.fill" }),
      expect.objectContaining({ frameId: 0 }),
    );
  });
});

describe("Test 6: TOTP freshness", () => {
  it("derives with the current unix time on each call, distinct across a period boundary, and never returns the secret", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([totpItem("totp-1", "JBSWY3DPEHPK3PXP")]);
    hoisted.mockTotpNow.mockReturnValueOnce({ code: "111111", secondsRemaining: 1 });
    hoisted.mockTotpNow.mockReturnValueOnce({ code: "222222", secondsRemaining: 30 });

    const t1 = 1_700_000_000_000;
    const t2 = 1_700_000_031_000; // +31s -- past a 30s period boundary
    const nowSpy = vi.spyOn(Date, "now").mockReturnValueOnce(t1).mockReturnValueOnce(t2);

    const r1 = await handleAutofillTotpCode({ kind: "autofill.totpCode", itemId: "totp-1" }, POPUP_SENDER);
    const r2 = await handleAutofillTotpCode({ kind: "autofill.totpCode", itemId: "totp-1" }, POPUP_SENDER);

    expect(r1).toEqual({ ok: true, code: "111111", secondsRemaining: 1 });
    expect(r2).toEqual({ ok: true, code: "222222", secondsRemaining: 30 });
    expect(hoisted.mockTotpNow).toHaveBeenNthCalledWith(
      1,
      "JBSWY3DPEHPK3PXP",
      "SHA1",
      6,
      30,
      Math.floor(t1 / 1000),
    );
    expect(hoisted.mockTotpNow).toHaveBeenNthCalledWith(
      2,
      "JBSWY3DPEHPK3PXP",
      "SHA1",
      6,
      30,
      Math.floor(t2 / 1000),
    );
    expect(JSON.stringify(r1)).not.toContain("JBSWY3DPEHPK3PXP");
    expect(JSON.stringify(r2)).not.toContain("JBSWY3DPEHPK3PXP");

    nowSpy.mockRestore();
  });
});

describe("Test 7: idle-kill rehydration", () => {
  it("a fill succeeds when ensureHydrated() rehydrates a key on a woken service worker, not just the in-memory fast path", async () => {
    // ensureHydrated() resolving a real handle is exactly the woken-SW
    // scenario: currentUserKey started null but the persisted envelope
    // re-imported successfully. The handler must not give up on that fast
    // path miss -- it awaits ensureHydrated() as its sole source of truth
    // (see this file's header comment for why isSessionUnlocked() is
    // deliberately NOT used as a hard pre-gate).
    hoisted.mockEnsureHydrated.mockResolvedValue({ rehydrated: true });
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://bank.example/login" }]);
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://bank.example/x"])]);
    hoisted.mockTabsSendMessage.mockResolvedValue({ ok: true });

    const result = await handleAutofillFill(
      { kind: "autofill.fill", itemId: "item-1", kind_: "login" },
      POPUP_SENDER,
    );

    expect(result).toEqual({ ok: true });
    expect(hoisted.mockEnsureHydrated).toHaveBeenCalled();
  });
});

describe("Test 8: D-11 popup login relaxation (11-06, Bartek 2026-07-16)", () => {
  it("login item, origin matches, detected.login is false (page has no login form) -- still included", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://bank.example/dashboard" }]);
    hoisted.mockTabsSendMessage.mockResolvedValue({
      detected: { login: false, totp: false, card: false, identity: false },
    });
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://bank.example/x"])]);

    const result = await handleAutofillMatch(POPUP_SENDER);

    expect(result.pageState).toBe("ok");
    expect(result.matches).toEqual([
      { itemId: "item-1", kind: "login", label: "Login item-1", maskedHint: "u***@example.com" },
    ]);
  });

  it("card item is still excluded when detected.card is false -- cards are not origin-bound, so relaxing them would surface every card everywhere", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://shop.example/dashboard" }]);
    hoisted.mockTabsSendMessage.mockResolvedValue({
      detected: { login: false, totp: false, card: false, identity: false },
    });
    hoisted.mockGetItems.mockReturnValue([cardItem("card-1")]);

    const result = await handleAutofillMatch(POPUP_SENDER);

    expect(result.matches).toEqual([]);
  });

  it("identity item is still excluded when detected.identity is false -- same non-origin-bound rationale as cards", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://shop.example/dashboard" }]);
    hoisted.mockTabsSendMessage.mockResolvedValue({
      detected: { login: false, totp: false, card: false, identity: false },
    });
    hoisted.mockGetItems.mockReturnValue([identityItem("identity-1")]);

    const result = await handleAutofillMatch(POPUP_SENDER);

    expect(result.matches).toEqual([]);
  });

  it("totp item with a matching issuer is still excluded when detected.totp is false -- the 10-08 policy (issuer-match AND detected.totp) is unchanged", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://github.com/dashboard" }]);
    hoisted.mockTabsSendMessage.mockResolvedValue({
      detected: { login: false, totp: false, card: false, identity: false },
    });
    hoisted.mockGetItems.mockReturnValue([totpItem("totp-1", "JBSWY3DPEHPK3PXP", "GitHub")]);

    const result = await handleAutofillMatch(POPUP_SENDER);

    expect(result.matches).toEqual([]);
  });

  it("unreachable content-relay still returns empty matches -- this plan never fabricates reachability, only relaxes the 'detect ran, nothing login-shaped found' case", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockTabsQuery.mockResolvedValue([{ id: 1, url: "https://bank.example/dashboard" }]);
    hoisted.mockTabsSendMessage.mockRejectedValue(new Error("no receiver"));
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://bank.example/x"])]);

    const result = await handleAutofillMatch(POPUP_SENDER);

    expect(result.pageState).toBe("unreachable");
    expect(result.matches).toEqual([]);
  });

  it("overlay channel (handleMatchFrame, autofill-frame.ts) is UNCHANGED by this plan -- a login item is still excluded when the caller's own detected.login is false", async () => {
    hoisted.mockEnsureHydrated.mockResolvedValue({});
    hoisted.mockGetItems.mockReturnValue([loginItem("item-1", ["https://bank.example/x"])]);

    const result = await handleMatchFrame(
      {
        kind: "autofill.matchFrame",
        detected: { login: false, totp: false, card: false, identity: false },
      },
      CONTENT_SENDER,
    );

    expect(result.matches).toEqual([]);
  });
});
