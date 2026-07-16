// @vitest-environment jsdom
// entrypoints/__tests__/content-relay.test.ts — jsdom coverage for the
// ISOLATED-world sensor/writer's 5 required behaviors (10-05-PLAN.md
// Task 2).
//
// Lives in entrypoints/__tests__/ rather than directly in entrypoints/
// alongside content-relay.content.ts (Rule 3 blocking-issue fix, not the
// plan's literal files_modified path): WXT's entrypoint auto-discovery
// (find-entrypoints.mjs) derives an entrypoint's NAME from the string
// before the first `.`/`/` in its path relative to entrypointsDir, and its
// TYPE from a `*.[jt]s?(x)` catch-all glob (type "unlisted-script") for
// any top-level .ts file that doesn't match a more specific pattern.
// `content-relay.test.ts` sitting directly in entrypoints/ collides on the
// name "content-relay" with `content-relay.content.ts` (type
// "content-script") -- `npx wxt build` fails hard with "Multiple
// entrypoints with the same name detected" before any code even runs.
// One directory level down, `*.[jt]s?(x)`'s single `*` does not cross a
// path separator, so a subdirectory is invisible to entrypoint discovery
// entirely (this is the same reason `entrypoints/background/*.ts`'s many
// non-entrypoint modules never collide with the top-level
// `entrypoints/background.ts` entrypoint). vitest's default test-file glob
// is recursive, so this file is still discovered and run exactly as
// before.
//
// `wxt/browser` is mocked (following autofill-match.test.ts's established
// direct-mock convention -- `wxt/testing`'s `fakeBrowser` is unused
// anywhere in this codebase) so the registered `runtime.onMessage` listener
// can be captured and driven directly with synthetic messages; every
// detector (detect-login/detect-totp/detect-scored) and fill-dom.ts are
// left REAL so this suite exercises the actual sensor/writer, not a
// stand-in for it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  mockAddListener: vi.fn(),
  // Backs lib/autofill/blocked-origins.ts's storage.local reads (FIX B3's
  // isOriginBlocked() gate in initialMatchAndPrompt()/handleFocusIn) --
  // same Map-backed fake pattern blocked-origins.test.ts itself uses.
  // Empty by default, so every existing test here still sees "not
  // blocked" and exercises the same code paths as before.
  storageStore: new Map<string, unknown>(),
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      onMessage: {
        addListener: hoisted.mockAddListener,
      },
    },
    storage: {
      local: {
        async get(key: string) {
          const store = hoisted.storageStore;
          return store.has(key) ? { [key]: store.get(key) } : {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) {
            hoisted.storageStore.set(k, v);
          }
        },
      },
    },
  },
}));

import contentRelay, { isConfiguredServerOrigin } from "../content-relay.content";
import type { ContentDetectResponse, ContentFillResponse } from "../../lib/autofill/types";

type Listener = (message: unknown, sender: unknown, sendResponse: (response?: unknown) => void) => unknown;

function registeredListener(): Listener {
  const call = hoisted.mockAddListener.mock.calls.at(-1);
  if (!call) {
    throw new Error("main() did not register a runtime.onMessage listener");
  }
  return call[0] as Listener;
}

beforeEach(() => {
  document.body.innerHTML = "";
  hoisted.mockAddListener.mockClear();
  hoisted.storageStore.clear();
  // Fresh registration per test, bound to a clean document each time.
  contentRelay.main({} as never);
});

describe("content-relay", () => {
  it("Test 1 (detect returns booleans only): a login form yields per-kind booleans with no field VALUE leaking into the response", () => {
    document.body.innerHTML = `
      <form>
        <input name="user" autocomplete="username" value="alice-leaked">
        <input type="password" autocomplete="current-password" value="hunter2-leaked">
      </form>
    `;

    const listener = registeredListener();
    const sendResponse = vi.fn();
    listener({ kind: "content.detect" }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledTimes(1);
    const response = sendResponse.mock.calls[0][0] as ContentDetectResponse;
    expect(response).toEqual({
      detected: { login: true, totp: false, card: false, identity: false },
      hasOtpField: false,
    });
    // No leaked field VALUE anywhere in the serialized response.
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("alice-leaked");
    expect(serialized).not.toContain("hunter2-leaked");
  });

  it("Test 2 (fill only on message): loading the script and firing load/focus/mutation events writes NOTHING until a content.fill message is delivered", () => {
    document.body.innerHTML = `<input id="pw" type="password" autocomplete="current-password">`;
    const input = document.getElementById("pw") as HTMLInputElement;

    // Simulate page-load, focus, and a DOM mutation -- none of these are
    // wired to any write path in content-relay.content.ts.
    window.dispatchEvent(new Event("load"));
    input.dispatchEvent(new Event("focus"));
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    document.body.setAttribute("data-probe", "1");
    observer.disconnect();

    expect(input.value).toBe("");
  });

  it("Test 3 (fill on message): a content.fill with a login FillValues writes username+password via fillValues, re-resolving targets at fill time", () => {
    document.body.innerHTML = `
      <form>
        <input name="user" autocomplete="username">
        <input type="password" autocomplete="current-password">
      </form>
    `;

    const listener = registeredListener();
    const sendResponse = vi.fn();
    listener(
      { kind: "content.fill", values: { type: "login", username: "bob", password: "hunter2" } },
      {},
      sendResponse,
    );

    const username = document.querySelector('input[autocomplete="username"]') as HTMLInputElement;
    const password = document.querySelector('input[autocomplete="current-password"]') as HTMLInputElement;
    expect(username.value).toBe("bob");
    expect(password.value).toBe("hunter2");
    expect(sendResponse).toHaveBeenCalledWith({ ok: true } satisfies ContentFillResponse);
  });

  it("Test 4 (unknown message ignored): a message of an unrelated kind is ignored and does not throw", () => {
    const listener = registeredListener();
    const sendResponse = vi.fn();

    expect(() => listener({ kind: "session.status" }, {}, sendResponse)).not.toThrow();
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it("Test 5 (fill-failed report): a content.fill whose detector finds no matching field returns { ok: false }", () => {
    document.body.innerHTML = `<div>no fillable field anywhere on this page</div>`;

    const listener = registeredListener();
    const sendResponse = vi.fn();
    listener(
      { kind: "content.fill", values: { type: "login", username: "bob", password: "hunter2" } },
      {},
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({ ok: false } satisfies ContentFillResponse);
  });

  describe("isConfiguredServerOrigin (own-vault-app overlay suppression)", () => {
    it("Test 6: resolves false when no pv-server-config has ever been persisted", async () => {
      await expect(isConfiguredServerOrigin()).resolves.toBe(false);
    });

    it("Test 7: resolves false when the persisted baseUrl's origin differs from the current page", async () => {
      hoisted.storageStore.set("pv-server-config", { baseUrl: "https://vault.example.com" });
      expect(new URL("https://vault.example.com").origin).not.toBe(location.origin);
      await expect(isConfiguredServerOrigin()).resolves.toBe(false);
    });

    it("Test 8: resolves true when the persisted baseUrl's origin matches the current page (jsdom's own location)", async () => {
      hoisted.storageStore.set("pv-server-config", { baseUrl: location.origin });
      await expect(isConfiguredServerOrigin()).resolves.toBe(true);
    });

    it("Test 9: resolves false (fails closed) on a corrupt/non-URL persisted baseUrl", async () => {
      hoisted.storageStore.set("pv-server-config", { baseUrl: "not a url" });
      await expect(isConfiguredServerOrigin()).resolves.toBe(false);
    });
  });
});
