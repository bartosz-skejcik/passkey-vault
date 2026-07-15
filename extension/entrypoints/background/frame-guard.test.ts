// entrypoints/background/frame-guard.test.ts — adversarial unit coverage of
// the origin/frame access-control gate (D-04/D-10). Every predicate under
// test is pure -- no DOM needed, runs under the "background" project's node
// environment -- so a browser fake is needed ONLY for assertPopupSender's
// `browser.runtime.id` read.
import { describe, expect, it, vi } from "vitest";

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-ext-id",
      getURL: (path: string) => `chrome-extension://test-ext-id/${path}`,
    },
  },
}));

import {
  assertPopupSender,
  itemMatchesOrigin,
  originFromContentSender,
  resolveFillTarget,
} from "./frame-guard";
import type { VaultItem } from "../../lib/vault/types";

function loginItem(urls: string[]): VaultItem {
  return {
    id: "item-1",
    revision: 1,
    fields: {
      type: "login",
      name: "Bank",
      folderId: null,
      tags: [],
      username: "user",
      password: "pw",
      urls,
      notes: "",
    },
  };
}

describe("itemMatchesOrigin", () => {
  it("Test 1: matches a login item whose stored URL hostname equals the frame origin's hostname", () => {
    const item = loginItem(["https://bank.example/login"]);
    expect(itemMatchesOrigin(item, "https://bank.example")).toBe(true);
  });

  it("Test 2 (D-04 adversarial case): a cross-origin subframe (https://evil.example) never matches a login item stored for the TOP-level page's origin (https://bank.example), even though the top-level origin itself DOES match", () => {
    const item = loginItem(["https://bank.example/login"]);
    // The top-level page's own origin matches...
    expect(itemMatchesOrigin(item, "https://bank.example")).toBe(true);
    // ...but a hostile iframe embedded in that same top-level page has its
    // OWN origin, and must never inherit the parent page's match.
    expect(itemMatchesOrigin(item, "https://evil.example")).toBe(false);
  });

  it("Test 3: scheme mismatch (item stored for https://x.example, frame is http://x.example) never matches -- an http frame is not the https origin", () => {
    const item = loginItem(["https://x.example/login"]);
    expect(itemMatchesOrigin(item, "http://x.example")).toBe(false);
  });

  it("card/identity items match ANY http(s) origin (not origin-bound data), totp items never match this gate (no stored URL to compare, strictly origin-bound by omission)", () => {
    const card: VaultItem = {
      id: "card-1",
      revision: 1,
      fields: {
        type: "card",
        name: "Visa",
        folderId: null,
        tags: [],
        cardholderName: "A B",
        number: "4111111111111111",
        expiry: "12/30",
        cvv: "123",
        notes: "",
      },
    };
    const identity: VaultItem = {
      id: "id-1",
      revision: 1,
      fields: {
        type: "identity",
        name: "Home",
        folderId: null,
        tags: [],
        firstName: "A",
        lastName: "B",
        email: "a@example.com",
        phone: "",
        address: "",
        notes: "",
      },
    };
    const totp: VaultItem = {
      id: "totp-1",
      revision: 1,
      fields: {
        type: "totp",
        name: "2FA",
        folderId: null,
        tags: [],
        secret: "JBSWY3DPEHPK3PXP",
        issuer: "",
        algorithm: "SHA1",
        digits: 6,
        period: 30,
        notes: "",
      },
    };
    expect(itemMatchesOrigin(card, "https://checkout.example")).toBe(true);
    expect(itemMatchesOrigin(identity, "https://any-shop.example")).toBe(true);
    expect(itemMatchesOrigin(totp, "https://bank.example")).toBe(false);
  });
});

describe("resolveFillTarget", () => {
  it("Test 4: derives origin from the platform-provided tab URL and returns an explicit frameId 0 for a normal http(s) tab -- ignoring any conflicting origin field on the input", () => {
    const input = {
      tabId: 42,
      tabUrl: "https://real-bank.example/account",
      // NOT part of resolveFillTarget's real parameter type -- simulates a
      // caller trying to smuggle a spoofed origin in via the payload;
      // asserts there is no code path that ever reads it (T-10-02).
      origin: "https://evil.example",
    };
    const result = resolveFillTarget(input);
    expect(result).toEqual({
      ok: true,
      target: { tabId: 42, frameId: 0, origin: "https://real-bank.example" },
    });
  });

  it("Test 5: returns a restricted result for chrome://, about:, and file:// tab URLs, and for a tab with no URL at all -- never a fill target", () => {
    const restrictedUrls: Array<string | undefined> = [
      "chrome://extensions",
      "about:debugging",
      "file:///etc/passwd",
      undefined,
    ];
    for (const tabUrl of restrictedUrls) {
      expect(resolveFillTarget({ tabId: 1, tabUrl })).toEqual({
        ok: false,
        reason: "restricted",
      });
    }
  });
});

describe("assertPopupSender", () => {
  it("Test 6: refuses (false) a content script -- tab defined, web-page origin, own ext id", () => {
    expect(
      assertPopupSender({
        tab: { id: 7 },
        id: "test-ext-id",
        origin: "https://evil.example",
        url: "https://evil.example/page",
      } as never),
    ).toBe(false);
  });

  it("Test 6: passes (true) for a tab-less action popup with no origin/url reported", () => {
    expect(assertPopupSender({ id: "test-ext-id" } as never)).toBe(true);
  });

  it("Test 6: passes (true) for popup.html opened AS A TAB -- tab defined but extension-origin document (real-Chrome UAT regression)", () => {
    expect(
      assertPopupSender({
        tab: { id: 12 },
        id: "test-ext-id",
        origin: "chrome-extension://test-ext-id",
        url: "chrome-extension://test-ext-id/popup.html",
      } as never),
    ).toBe(true);
  });

  it("Test 6: refuses a web-origin sender even without a tab (origin wins over tab-lessness)", () => {
    expect(
      assertPopupSender({ id: "test-ext-id", origin: "https://evil.example" } as never),
    ).toBe(false);
  });

  it("Test 6: refuses a sender with a foreign extension id even at extension origin", () => {
    expect(
      assertPopupSender({
        id: "some-other-extension-id",
        origin: "chrome-extension://some-other-extension-id",
      } as never),
    ).toBe(false);
  });
});

describe("originFromContentSender", () => {
  it("Test 7: prefers sender.origin when present", () => {
    expect(
      originFromContentSender({
        origin: "https://page.example",
        url: "https://other.example/x",
      } as never),
    ).toBe("https://page.example");
  });

  it("Test 7: falls back to new URL(sender.url).origin when sender.origin is absent (Firefox parity, 10-RESEARCH.md Pitfall 3)", () => {
    expect(originFromContentSender({ url: "https://page.example/path?x=1" } as never)).toBe(
      "https://page.example",
    );
  });

  it("Test 7: returns null (never a guess) when neither sender.origin nor a parseable sender.url is present", () => {
    expect(originFromContentSender({} as never)).toBeNull();
    expect(originFromContentSender({ url: "not-a-url" } as never)).toBeNull();
  });
});
