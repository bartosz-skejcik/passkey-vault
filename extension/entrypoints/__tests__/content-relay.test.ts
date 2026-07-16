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
  // D-12/plan 11-07: captureThemeFromWebApp() is mocked here rather than
  // exercised for real -- its own actual behavior (enum validation,
  // MutationObserver live-update, detach) is already fully pinned by
  // lib/theme/theme-mirror.test.ts. Exercising the REAL implementation
  // here would install a genuine MutationObserver on
  // document.documentElement on every test that reaches this gate, and
  // jsdom's `document` is shared across every `it` block in THIS file (no
  // per-test environment reset) -- content-relay.content.ts's main() is
  // deliberately fire-and-forget with no teardown hook (correct for
  // production: a real content-script instance's whole JS context is
  // destroyed on navigation), so a leftover observer from an earlier test
  // would react to a LATER test's own `data-theme` mutations and corrupt
  // its assertions. Mocking keeps these tests focused on what they're
  // actually verifying: is captureThemeFromWebApp() called exactly when
  // isConfiguredServerOrigin() gates it true, and never otherwise.
  mockCaptureThemeFromWebApp: vi.fn(),
  // Plan 12-03: backs the passkey-provider bridge's `sendMessage` calls to
  // the background (credentials.create/credentials.get). Defaults to a
  // harmless fallthrough response; individual tests override via
  // `.mockResolvedValueOnce`/`.mockImplementationOnce` as needed.
  mockSendMessage: vi.fn(),
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

vi.mock("../../lib/theme/theme-mirror", () => ({
  THEME_MIRROR_KEY: "pv-theme-mirror",
  captureThemeFromWebApp: hoisted.mockCaptureThemeFromWebApp,
}));

// Plan 12-03: the passkey-provider bridge is the ONLY thing in this file
// that calls sendMessage() -- every pre-existing test above drives
// content.detect/content.fill/focusin-focusout directly and never touches
// this mock, so overriding it here is additive, not a behavior change to
// any prior test.
vi.mock("../../lib/messaging/ext-protocol", () => ({
  sendMessage: hoisted.mockSendMessage,
}));

import contentRelay, { isConfiguredServerOrigin } from "../content-relay.content";
import type { ContentDetectResponse, ContentFillResponse } from "../../lib/autofill/types";
import type { PageBridgeRequestEnvelope, PageBridgeResponseEnvelope } from "../../lib/messaging/page-protocol";

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
  hoisted.mockCaptureThemeFromWebApp.mockClear();
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

  describe("theme-mirror capture (D-12, plan 11-07)", () => {
    async function flushMicrotasks(): Promise<void> {
      await Promise.resolve();
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
    }

    it("Test 10: on the user's own configured pv-server web app, captureThemeFromWebApp(document) is invoked", async () => {
      hoisted.storageStore.set("pv-server-config", { baseUrl: location.origin });

      // Re-run main() -- beforeEach's own call happened before this test
      // configured storage above, and initThemeCapture() reads
      // isConfiguredServerOrigin() at call time.
      contentRelay.main({} as never);
      await flushMicrotasks();

      expect(hoisted.mockCaptureThemeFromWebApp).toHaveBeenCalledTimes(1);
      expect(hoisted.mockCaptureThemeFromWebApp).toHaveBeenCalledWith(document);
    });

    it("Test 11: on a third-party page (not the configured server origin), captureThemeFromWebApp is never invoked", async () => {
      // No pv-server-config persisted at all -- isConfiguredServerOrigin()
      // resolves false, same as any ordinary third-party page.
      contentRelay.main({} as never);
      await flushMicrotasks();

      expect(hoisted.mockCaptureThemeFromWebApp).not.toHaveBeenCalled();
    });

    it("Test 12: a blocked/unrelated origin with no server config still never invokes capture", async () => {
      hoisted.storageStore.set("pv-server-config", { baseUrl: "https://a-different-vault.example.com" });

      contentRelay.main({} as never);
      await flushMicrotasks();

      expect(hoisted.mockCaptureThemeFromWebApp).not.toHaveBeenCalled();
    });
  });

  // Plan 12-03, Task 3: the provider bridge's `window` "message" listener
  // (D-22, registered synchronously inside `main()`, independent of the
  // `browser.runtime.onMessage` listener every other test above exercises).
  // D-03/ASVS V5 requires REJECT/IGNORE (no forwarding, no response) on any
  // of: wrong `event.source`, wrong `event.origin`, or a replayed nonce --
  // three explicit required test cases.
  describe("passkey-provider bridge: window message validation (D-03/ASVS V5)", () => {
    async function flushMicrotasks(): Promise<void> {
      await Promise.resolve();
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
      // The response half of this bridge posts back to the page via a
      // REAL `window.postMessage` (never a synthetic dispatchEvent, unlike
      // this test file's own request-side simulation) -- jsdom delivers
      // that asynchronously on a macrotask, so a microtask-only flush is
      // not enough for tests that assert on the POSTED-BACK response.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function validRequest(nonce: string): PageBridgeRequestEnvelope {
      return {
        source: "pv-page-bridge",
        nonce,
        kind: "credentials.get",
        origin: location.origin,
        publicKey: { rpId: "example.com" },
      };
    }

    beforeEach(() => {
      hoisted.mockSendMessage.mockReset();
      hoisted.mockSendMessage.mockResolvedValue({ fallthrough: true });
    });

    it("Test 13: rejects a message whose event.source is not window -- never forwarded to the background", async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: validRequest("nonce-wrong-source"),
          origin: location.origin,
          // A different object than `window` -- simulates a message
          // relayed from a DIFFERENT frame/window pretending to be the
          // page's own script.
          source: {} as unknown as MessageEventSource,
        }),
      );
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("Test 14: rejects a message whose event.origin does not match location.origin -- never forwarded", async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: validRequest("nonce-wrong-origin"),
          origin: "https://attacker.example.com",
          source: window,
        }),
      );
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("Test 15: a replayed (already-consumed) nonce is silently ignored on the second delivery", async () => {
      const nonce = "nonce-replay-test";

      window.dispatchEvent(new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }));
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);

      // Same nonce again -- must NOT be forwarded a second time.
      window.dispatchEvent(new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }));
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it("a well-formed, valid message IS forwarded via sendMessage with the base64url-encoded publicKey", async () => {
      const nonce = "nonce-valid";
      window.dispatchEvent(new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }));
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
      expect(hoisted.mockSendMessage).toHaveBeenCalledWith({
        kind: "credentials.get",
        publicKey: { rpId: "example.com" },
      });
    });

    it("posts the credential response back to the page with binary fields decoded to ArrayBuffers", async () => {
      const nonce = "nonce-credential-response";
      const rawIdB64Url = "AQID"; // base64url for bytes [1,2,3]
      hoisted.mockSendMessage.mockResolvedValueOnce({
        fallthrough: false,
        credentialResponseJson: JSON.stringify({
          id: "cred-1",
          rawId: rawIdB64Url,
          type: "public-key",
          response: { clientDataJSON: rawIdB64Url, authenticatorData: rawIdB64Url, signature: rawIdB64Url },
        }),
      });

      const received: PageBridgeResponseEnvelope[] = [];
      window.addEventListener("message", (e) => {
        const data = (e as MessageEvent).data as { source?: unknown };
        if (data?.source === "pv-content-relay") {
          received.push((e as MessageEvent).data as PageBridgeResponseEnvelope);
        }
      });

      window.dispatchEvent(new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }));
      await flushMicrotasks();

      expect(received).toHaveLength(1);
      const response = received[0];
      expect(response.kind).toBe("credential");
      if (response.kind === "credential") {
        expect(response.nonce).toBe(nonce);
        const credential = response.credential as { rawId: ArrayBuffer; response: { clientDataJSON: ArrayBuffer } };
        expect(credential.rawId).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(credential.rawId)).toEqual(new Uint8Array([1, 2, 3]));
        expect(credential.response.clientDataJSON).toBeInstanceOf(ArrayBuffer);
      }
    });
  });
});
