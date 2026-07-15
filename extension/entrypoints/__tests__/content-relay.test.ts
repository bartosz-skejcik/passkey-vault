// @vitest-environment jsdom
// entrypoints/content-relay.test.ts — jsdom coverage for the ISOLATED-world
// sensor/writer's 5 required behaviors (10-05-PLAN.md Task 2).
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
}));

vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      onMessage: {
        addListener: hoisted.mockAddListener,
      },
    },
  },
}));

import contentRelay from "./content-relay.content";
import type { ContentDetectResponse, ContentFillResponse } from "../lib/autofill/types";

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
});
