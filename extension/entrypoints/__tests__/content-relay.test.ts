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
  // Plan 12-07: the in-page overlay is mocked here (rather than exercised
  // for real, unlike every OTHER detector/writer in this file) because the
  // passkey-priority coordination tests below need to assert WHICH overlay
  // methods were called and with what arguments (renderFormPrompt/
  // renderFieldDropdown/clearFieldDropdown) -- inpage-overlay.ts's own real
  // rendering behavior is already fully pinned by inpage-overlay.test.ts.
  // No pre-existing test in this file touches the overlay at all (none of
  // Tests 1-15 assert on Surface A/B rendering), so this mock is additive,
  // not a behavior change to any prior test.
  mockRenderFormPrompt: vi.fn(),
  mockRenderFieldDropdown: vi.fn(),
  mockClearFieldDropdown: vi.fn(),
  mockIsBlocked: vi.fn(() => false),
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

// Plan 12-07: see hoisted.mockRenderFormPrompt's own comment above. `host`
// is a real (unattached) DOM node -- `handleFocusOut`'s
// `overlay.host.contains(related)` guard needs a real `Node.contains()`
// implementation, even though none of the tests below exercise focusout.
vi.mock("../../lib/autofill/inpage-overlay", () => ({
  createOverlayController: vi.fn(() => ({
    host: document.createElement("div"),
    renderFormPrompt: hoisted.mockRenderFormPrompt,
    renderFieldDropdown: hoisted.mockRenderFieldDropdown,
    clearFieldDropdown: hoisted.mockClearFieldDropdown,
    dismiss: vi.fn(),
    blockSite: vi.fn(),
    isDismissed: vi.fn(() => false),
    isBlocked: hoisted.mockIsBlocked,
    destroy: vi.fn(),
  })),
}));

import contentRelay, { isConfiguredServerOrigin } from "../content-relay.content";
import type { ContentDetectResponse, ContentFillResponse } from "../../lib/autofill/types";
import type { PageBridgeRequestEnvelope, PageBridgeResponseEnvelope } from "../../lib/messaging/page-protocol";
// CR-01 regression coverage (phase-13 review): imported for REAL (never
// mocked -- lib/messaging/bytes-b64.ts is pure, no browser-runtime deps) so
// the round-trip test below exercises the ACTUAL background-side decoder
// (server-unlock.ts's own import) against this file's ACTUAL relay-side
// encoder output, with no mock standing in for either half of the boundary.
import { b64ToBytes, b64UrlToBytes } from "../../lib/messaging/bytes-b64";

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
  delete document.documentElement.dataset.pvCeremonyInFlight;
  hoisted.mockAddListener.mockClear();
  hoisted.storageStore.clear();
  hoisted.mockCaptureThemeFromWebApp.mockClear();
  hoisted.mockRenderFormPrompt.mockClear();
  hoisted.mockRenderFieldDropdown.mockClear();
  hoisted.mockClearFieldDropdown.mockClear();
  hoisted.mockIsBlocked.mockReset();
  hoisted.mockIsBlocked.mockReturnValue(false);
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

    it("posts an ack, THEN the credential response, back to the page with binary fields decoded to ArrayBuffers", async () => {
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

      // CR-03 completion (Plan 12-06): the ack is posted BEFORE the
      // background is even called -- it always arrives first, as a
      // separate, non-terminal message.
      expect(received).toHaveLength(2);
      expect(received[0]).toEqual({ source: "pv-content-relay", nonce, kind: "ack" });
      const response = received[1];
      expect(response.kind).toBe("credential");
      if (response.kind === "credential") {
        expect(response.nonce).toBe(nonce);
        const credential = response.credential as { rawId: ArrayBuffer; response: { clientDataJSON: ArrayBuffer } };
        expect(credential.rawId).toBeInstanceOf(ArrayBuffer);
        expect(new Uint8Array(credential.rawId)).toEqual(new Uint8Array([1, 2, 3]));
        expect(credential.response.clientDataJSON).toBeInstanceOf(ArrayBuffer);
      }
    });

    // CR-03 completion (12-REVIEW.md re-review, Plan 12-06): the early-ack
    // handshake itself -- content-relay's half. See page-bridge.test.ts's
    // "CR-03 completion" describe block for the page-bridge half (ack
    // cancels the no-ack timer / no-ack falls through promptly).
    it("CR-03 completion: a VALID request is acked immediately, before the background is ever called", async () => {
      const nonce = "nonce-ack-before-forward";
      hoisted.mockSendMessage.mockResolvedValueOnce({ fallthrough: true });
      const postSpy = vi.spyOn(window, "postMessage");

      window.dispatchEvent(new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }));
      await flushMicrotasks();

      const ackCallIndex = postSpy.mock.calls.findIndex(
        (call) => (call[0] as { kind?: unknown; nonce?: unknown })?.kind === "ack" && (call[0] as { nonce?: unknown }).nonce === nonce,
      );
      expect(ackCallIndex).toBeGreaterThanOrEqual(0);
      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
      // The ack's own postMessage call happened strictly BEFORE sendMessage
      // was invoked -- vitest's invocationCallOrder is a global monotonic
      // counter shared across every mock/spy in the test.
      expect(postSpy.mock.invocationCallOrder[ackCallIndex]).toBeLessThan(
        hoisted.mockSendMessage.mock.invocationCallOrder[0],
      );
    });

    it("CR-03 completion: an INVALID request (replayed nonce) gets no ack -- same as no forward", async () => {
      const nonce = "nonce-ack-replay-test";
      const acks: unknown[] = [];
      window.addEventListener("message", (e) => {
        const data = (e as MessageEvent).data as Partial<PageBridgeResponseEnvelope>;
        if (data?.source === "pv-content-relay" && data.kind === "ack") {
          acks.push(data);
        }
      });

      window.dispatchEvent(new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }));
      await flushMicrotasks();
      expect(acks).toHaveLength(1); // the first, valid delivery IS acked

      // Same nonce again -- a replay, rejected before the ack call site.
      window.dispatchEvent(new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }));
      await flushMicrotasks();
      expect(acks).toHaveLength(1); // still just the one ack -- the replay got none
    });

    // CR-01 fix (12-REVIEW.md, Phase 12 Plan 12-05): before this fix,
    // `encodePublicKeyOptions` never touched `extensions.prf.eval.first`/
    // `.second`/`evalByCredential[*].first`/`.second` -- real ArrayBuffers
    // that survived the MAIN<->ISOLATED postMessage hop intact but were
    // mangled to `{}` by the ISOLATED->background `runtime.sendMessage`
    // JSON-serialization, breaking every PRF-with-eval ceremony. These
    // tests assert the encoded output is a base64url STRING that survives
    // an actual `JSON.parse(JSON.stringify(...))` round-trip (the exact
    // hop that used to mangle it) -- never `{}`.
    it("CR-01: extensions.prf.eval.first/second ArrayBuffers are base64url-encoded before sendMessage, and survive a JSON round-trip", async () => {
      const nonce = "nonce-prf-eval";
      const request: PageBridgeRequestEnvelope = {
        source: "pv-page-bridge",
        nonce,
        kind: "credentials.get",
        origin: location.origin,
        publicKey: {
          rpId: "example.com",
          extensions: {
            prf: {
              eval: {
                first: new Uint8Array([9, 8, 7]).buffer,
                second: new Uint8Array([6, 5, 4]).buffer,
              },
            },
          },
        },
      };

      window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
      const sentMessage = hoisted.mockSendMessage.mock.calls[0][0];
      // The exact hop that used to mangle a raw ArrayBuffer into `{}`.
      const roundTripped = JSON.parse(JSON.stringify(sentMessage)) as {
        publicKey: { extensions: { prf: { eval: { first: unknown; second: unknown } } } };
      };
      const evalOut = roundTripped.publicKey.extensions.prf.eval;
      expect(typeof evalOut.first).toBe("string");
      expect(evalOut.first).not.toEqual({});
      expect(typeof evalOut.second).toBe("string");
      expect(evalOut.second).not.toEqual({});
    });

    it("CR-01: extensions.prf.evalByCredential[*].first/second ArrayBuffers are also base64url-encoded", async () => {
      const nonce = "nonce-prf-evalbycredential";
      const request: PageBridgeRequestEnvelope = {
        source: "pv-page-bridge",
        nonce,
        kind: "credentials.get",
        origin: location.origin,
        publicKey: {
          rpId: "example.com",
          extensions: {
            prf: {
              evalByCredential: {
                "cred-1": { first: new Uint8Array([1, 2, 3]).buffer },
              },
            },
          },
        },
      };

      window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
      const sentMessage = hoisted.mockSendMessage.mock.calls[0][0];
      const roundTripped = JSON.parse(JSON.stringify(sentMessage)) as {
        publicKey: { extensions: { prf: { evalByCredential: Record<string, { first: unknown }> } } };
      };
      const byCred = roundTripped.publicKey.extensions.prf.evalByCredential["cred-1"];
      expect(typeof byCred.first).toBe("string");
      expect(byCred.first).not.toEqual({});
    });

    it("CR-01: extensions.prf.eval is also encoded on a credentials.create request (WebAuthn L3 allows prf.eval on create)", async () => {
      const nonce = "nonce-prf-eval-create";
      const request: PageBridgeRequestEnvelope = {
        source: "pv-page-bridge",
        nonce,
        kind: "credentials.create",
        origin: location.origin,
        publicKey: {
          rp: { id: "example.com", name: "Example" },
          extensions: { prf: { eval: { first: new Uint8Array([1, 1, 1]).buffer } } },
        },
      };

      window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
      const sentMessage = hoisted.mockSendMessage.mock.calls[0][0];
      const roundTripped = JSON.parse(JSON.stringify(sentMessage)) as {
        publicKey: { extensions: { prf: { eval: { first: unknown } } } };
      };
      expect(typeof roundTripped.publicKey.extensions.prf.eval.first).toBe("string");
    });

    // Firefox Xray/cross-realm hole fix (debug session .planning/debug/
    // resolved/firefox-request-xray-hole.md): on real Firefox, a raw
    // (non-TypedArray) `ArrayBuffer` a page constructs (e.g. GitHub's
    // webauthn-json library, which sends `challenge`/credential ids as
    // ArrayBuffer, not TypedArray) crosses the MAIN(page-bridge-firefox.ts)
    // -> ISOLATED(this file) `window.postMessage` hop with a broken
    // prototype chain -- `value instanceof ArrayBuffer` is FALSE relative to
    // THIS file's own `ArrayBuffer` global, even though the value is a
    // completely intact ArrayBuffer. These tests reproduce that exact
    // cross-realm identity break WITHOUT needing real Firefox: a hidden
    // `<iframe>` gives jsdom a genuinely separate JS realm with its own
    // `ArrayBuffer`/`Uint8Array` globals, so an ArrayBuffer constructed via
    // `iframe.contentWindow.ArrayBuffer` fails `instanceof ArrayBuffer` in
    // THIS file's realm exactly the way a real page-realm ArrayBuffer fails
    // it in content-relay.content.ts's ISOLATED-world realm on real Firefox
    // (confirmed empirically identical during the debug session's own
    // real-Firefox probe: instanceof false, `Object.prototype.toString.call`
    // still "[object ArrayBuffer]", `new Uint8Array(value)` still reads the
    // real bytes). Every OTHER test in this file uses same-realm
    // `new Uint8Array([...]).buffer`, which would NOT have caught this bug
    // (same-realm instanceof always succeeds) -- these tests exist
    // specifically to close that fixture-coverage gap. Nested inside THIS
    // describe (rather than a sibling) so `flushMicrotasks()` above stays
    // in scope -- it's testing the same bridge's same forwarding behavior.
    describe("cross-realm ArrayBuffer detection (Firefox Xray hole fix)", () => {
      /** Constructs a real ArrayBuffer filled with `bytes` using a
       * DIFFERENT jsdom realm's own `ArrayBuffer`/`Uint8Array`
       * constructors (a hidden iframe's `contentWindow`) --
       * `result instanceof ArrayBuffer` is `false` against THIS file's
       * `ArrayBuffer` global, exactly mirroring the real Firefox
       * MAIN<->ISOLATED postMessage hazard this fix addresses. */
      function crossRealmArrayBuffer(bytes: number[]): ArrayBuffer {
        const iframe = document.createElement("iframe");
        document.body.appendChild(iframe);
        const otherWin = iframe.contentWindow as unknown as {
          ArrayBuffer: typeof ArrayBuffer;
          Uint8Array: typeof Uint8Array;
        };
        const buffer = new otherWin.ArrayBuffer(bytes.length);
        const view = new otherWin.Uint8Array(buffer);
        bytes.forEach((b, i) => {
          view[i] = b;
        });
        // Sanity: this really is a cross-realm value from THIS file's own
        // perspective -- if this ever starts passing, jsdom's iframe realm
        // isolation changed and this whole test technique needs revisiting.
        if (buffer instanceof ArrayBuffer) {
          throw new Error("test setup bug: crossRealmArrayBuffer is same-realm, not cross-realm");
        }
        return buffer as unknown as ArrayBuffer;
      }

      it("a cross-realm (non-TypedArray) ArrayBuffer challenge IS base64url-encoded before sendMessage, and survives a JSON round-trip", async () => {
        const nonce = "nonce-xray-challenge";
        const challengeBytes = [200, 199, 198, 197, 196];
        const request: PageBridgeRequestEnvelope = {
          source: "pv-page-bridge",
          nonce,
          kind: "credentials.get",
          origin: location.origin,
          publicKey: {
            rpId: "example.com",
            challenge: crossRealmArrayBuffer(challengeBytes),
          },
        };

        window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
        await flushMicrotasks();

        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
        const sentMessage = hoisted.mockSendMessage.mock.calls[0][0];
        // The exact hop that used to mangle a raw ArrayBuffer into `{}` --
        // this is the literal mechanism of the bug: pre-fix,
        // `isBufferSource()` never detected the cross-realm ArrayBuffer, so
        // `challenge` was forwarded UNTOUCHED and JSON.stringify'd it to `{}`.
        const roundTripped = JSON.parse(JSON.stringify(sentMessage)) as {
          publicKey: { challenge: unknown };
        };
        expect(typeof roundTripped.publicKey.challenge).toBe("string");
        expect(roundTripped.publicKey.challenge).not.toEqual({});
        // Byte-exact: decodes back to the ORIGINAL bytes, proving no
        // corruption -- only the detection was broken, never the data.
        const decoded = Buffer.from(roundTripped.publicKey.challenge as string, "base64url");
        expect(Array.from(decoded)).toEqual(challengeBytes);
      });

      it("a cross-realm ArrayBuffer user.id IS base64url-encoded (create() flow)", async () => {
        const nonce = "nonce-xray-userid";
        const userIdBytes = [1, 2, 3, 4];
        const request: PageBridgeRequestEnvelope = {
          source: "pv-page-bridge",
          nonce,
          kind: "credentials.create",
          origin: location.origin,
          publicKey: {
            rp: { id: "example.com", name: "Example" },
            user: { id: crossRealmArrayBuffer(userIdBytes), name: "xray@example.com", displayName: "Xray" },
          },
        };

        window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
        await flushMicrotasks();

        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
        const sentMessage = hoisted.mockSendMessage.mock.calls[0][0];
        const roundTripped = JSON.parse(JSON.stringify(sentMessage)) as {
          publicKey: { user: { id: unknown } };
        };
        expect(typeof roundTripped.publicKey.user.id).toBe("string");
        const decoded = Buffer.from(roundTripped.publicKey.user.id as string, "base64url");
        expect(Array.from(decoded)).toEqual(userIdBytes);
      });

      it("a cross-realm ArrayBuffer allowCredentials[].id IS base64url-encoded (get() flow)", async () => {
        const nonce = "nonce-xray-allowcred";
        const credIdBytes = [10, 20, 30];
        const request: PageBridgeRequestEnvelope = {
          source: "pv-page-bridge",
          nonce,
          kind: "credentials.get",
          origin: location.origin,
          publicKey: {
            rpId: "example.com",
            allowCredentials: [{ type: "public-key", id: crossRealmArrayBuffer(credIdBytes) }],
          },
        };

        window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
        await flushMicrotasks();

        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
        const sentMessage = hoisted.mockSendMessage.mock.calls[0][0];
        const roundTripped = JSON.parse(JSON.stringify(sentMessage)) as {
          publicKey: { allowCredentials: Array<{ id: unknown }> };
        };
        expect(typeof roundTripped.publicKey.allowCredentials[0].id).toBe("string");
        const decoded = Buffer.from(roundTripped.publicKey.allowCredentials[0].id as string, "base64url");
        expect(Array.from(decoded)).toEqual(credIdBytes);
      });

      it("a same-realm TypedArray challenge (existing behavior) is UNCHANGED by this fix", async () => {
        const nonce = "nonce-xray-control-typedarray";
        const request: PageBridgeRequestEnvelope = {
          source: "pv-page-bridge",
          nonce,
          kind: "credentials.get",
          origin: location.origin,
          publicKey: { rpId: "example.com", challenge: new Uint8Array([5, 5, 5]) },
        };

        window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
        await flushMicrotasks();

        const sentMessage = hoisted.mockSendMessage.mock.calls[0][0];
        const roundTripped = JSON.parse(JSON.stringify(sentMessage)) as { publicKey: { challenge: unknown } };
        expect(typeof roundTripped.publicKey.challenge).toBe("string");
        const decoded = Buffer.from(roundTripped.publicKey.challenge as string, "base64url");
        expect(Array.from(decoded)).toEqual([5, 5, 5]);
      });

      it("a plain object is NOT detected as a BufferSource (no false-positive widening)", async () => {
        const nonce = "nonce-xray-control-plain-object";
        const request: PageBridgeRequestEnvelope = {
          source: "pv-page-bridge",
          nonce,
          kind: "credentials.get",
          origin: location.origin,
          publicKey: { rpId: "example.com", challenge: { notAnArrayBuffer: true } as unknown },
        };

        window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
        await flushMicrotasks();

        const sentMessage = hoisted.mockSendMessage.mock.calls[0][0] as { publicKey: { challenge: unknown } };
        // Left untouched -- a plain object is not, and must never become, a
        // BufferSource match.
        expect(sentMessage.publicKey.challenge).toEqual({ notAnArrayBuffer: true });
      });
    });

    // IN-01 (13-REVIEW-3.md): isCrossRealmArrayBuffer (above) trusts
    // `Object.prototype.toString.call(...)`, which honors an ordinary
    // object's own `Symbol.toStringTag` -- a page can therefore make a
    // plain `{}` masquerade as an ArrayBuffer. Unlike the legitimate
    // cross-realm case above (a REAL ArrayBuffer from another realm,
    // correctly detected and correctly encoded), a spoofed fake with a
    // huge `length` makes bufferSourceToB64Url's `new Uint8Array(fake)`
    // throw a RangeError. This describe asserts handleProviderPageMessage's
    // encode-time try/catch turns that throw into the same clean-fallthrough
    // contract every other provider-side error path uses, instead of
    // wedging the ceremony for the EXTENSION_AUTHORITY_TIMEOUT_MS backstop.
    describe("IN-01: Symbol.toStringTag spoof does not wedge the ceremony (13-REVIEW-3.md)", () => {
      function spoofedHugeLengthArrayBuffer(): unknown {
        // 2**50 (~1.1 petabytes), not 2**40 (~1.1 terabytes): verified
        // empirically against this project's pinned Node/V8 at execution
        // time -- `new Uint8Array({length: 2**40, ...})` does NOT throw
        // synchronously (V8 lazily backs a >1TB-but-<2**50 typed array via
        // virtual memory, then the array-like element-copy loop runs ~2**40
        // iterations, which never realistically completes -- it hangs the
        // test rather than reproducing the fast RangeError this fix
        // guards). 2**50 reliably throws immediately (RangeError, "Array
        // buffer allocation failed") on this same engine -- confirmed with
        // a throwaway timed probe before writing this assertion, not
        // assumed from IN-01's illustrative snippet.
        const fake: Record<PropertyKey, unknown> = { length: 2 ** 50 };
        Object.defineProperty(fake, Symbol.toStringTag, { value: "ArrayBuffer" });
        return fake;
      }

      it("a toStringTag-spoofed huge-length object throws inside encodePublicKeyOptions -- clean fallthrough, never forwarded, DOM marker cleaned up", async () => {
        const nonce = "nonce-spoofed-huge-length";

        // Simulates page-bridge's own synchronous marker set (WR-01, this
        // same review) -- proves the catch path actually CLEANS UP the
        // marker, not merely that it was never set in this test.
        document.documentElement.dataset.pvCeremonyInFlight = "1";

        const received: PageBridgeResponseEnvelope[] = [];
        window.addEventListener("message", (e) => {
          const data = (e as MessageEvent).data as { source?: unknown };
          if (data?.source === "pv-content-relay") {
            received.push((e as MessageEvent).data as PageBridgeResponseEnvelope);
          }
        });

        const request: PageBridgeRequestEnvelope = {
          source: "pv-page-bridge",
          nonce,
          kind: "credentials.get",
          origin: location.origin,
          publicKey: { rpId: "example.com", challenge: spoofedHugeLengthArrayBuffer() },
        };
        window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
        await flushMicrotasks();

        // The throw is caught BEFORE the background is ever called -- an
        // aborted-but-acked ceremony (the exact bug) would instead have
        // acked and then gone silent, never reaching this assertion's
        // "not called" branch believably (it would also never have been
        // called, but for the WRONG reason -- see the terminal-response
        // assertion below for the real proof).
        expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
        // Terminal response IS an explicit ack + fallthrough -- same
        // contract as every other provider-side error path (D-11), not a
        // silently abandoned promise.
        expect(received.map((r) => r.kind)).toEqual(["ack", "fallthrough"]);
        // The DOM marker is cleaned up, not left wedged for the session.
        expect(document.documentElement.dataset.pvCeremonyInFlight).toBeUndefined();
      });
    });
  });

  // Bartek live-UAT bug follow-up (.planning/debug/resolved/
  // signin-passkeyless-spin.md, provider-hijack diagnosis): the MAIN-world
  // page-bridge patch installs on <all_urls> unconditionally -- including
  // the user's OWN configured pv-server origin -- so a WebAuthn ceremony
  // running ON that origin (v0.1's own login/unlock/enroll, AND
  // ExtUnlockBridge's server-origin ceremony window) must be refused here,
  // at the ISOLATED-world layer, rather than captured as a provider
  // ceremony. Confirmed via live Firefox reproduction:
  // navigator.credentials.get.toString() in the ceremony window returned
  // the RPC shim, not [native code], before this fix.
  describe("provider bridge refuses ceremonies on the configured server origin (provider-hijack fix)", () => {
    async function flushMicrotasks(): Promise<void> {
      await Promise.resolve();
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
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

    it("on the configured server origin: never forwards to the background, and posts back an ack immediately followed by an explicit fallthrough (never waits out ACK_TIMEOUT_MS/EXTENSION_AUTHORITY_TIMEOUT_MS)", async () => {
      hoisted.storageStore.set("pv-server-config", { baseUrl: location.origin });
      const nonce = "nonce-configured-origin-get";

      const received: PageBridgeResponseEnvelope[] = [];
      window.addEventListener("message", (e) => {
        const data = (e as MessageEvent).data as { source?: unknown };
        if (data?.source === "pv-content-relay") {
          received.push((e as MessageEvent).data as PageBridgeResponseEnvelope);
        }
      });

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
      // The ack is still posted synchronously (12-07's conditional-mediation
      // race guard requires the nonce/ack/overlay-hide sequence to stay
      // synchronous for EVERY message, refused or not) -- immediately
      // followed by the terminal fallthrough once the async origin check
      // resolves, well within the page bridge's own ack->terminal-message
      // budget.
      expect(received).toEqual([
        { source: "pv-content-relay", nonce, kind: "ack" },
        { source: "pv-content-relay", nonce, kind: "fallthrough" },
      ]);
    });

    it("on the configured server origin: refuses credentials.create too", async () => {
      hoisted.storageStore.set("pv-server-config", { baseUrl: location.origin });
      const nonce = "nonce-configured-origin-create";
      const request: PageBridgeRequestEnvelope = {
        source: "pv-page-bridge",
        nonce,
        kind: "credentials.create",
        origin: location.origin,
        publicKey: { rp: { id: "example.com", name: "Example" } },
      };

      window.dispatchEvent(new MessageEvent("message", { data: request, origin: location.origin, source: window }));
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("re-checks FRESH on every message, not cached at injection time -- a runtime server reconfiguration takes effect on the very next ceremony", async () => {
      // No server configured yet -- forwards normally.
      const firstNonce = "nonce-before-config";
      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(firstNonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);

      // Server reconfigured to THIS origin mid-session (no new injection,
      // same content-relay instance/module state).
      hoisted.storageStore.set("pv-server-config", { baseUrl: location.origin });
      hoisted.mockSendMessage.mockClear();

      const secondNonce = "nonce-after-config";
      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(secondNonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("a DIFFERENT (non-matching) configured server origin still forwards normally -- only the exact configured origin is refused", async () => {
      hoisted.storageStore.set("pv-server-config", { baseUrl: "https://a-different-vault.example.com" });
      const nonce = "nonce-different-configured-origin";

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
    });
  });

  // Plan 12-07 (Bartek live-review 2026-07-17, github.com): PASSKEY ALWAYS
  // PRIORITY. When a site has both a vault passkey AND a login form, the
  // provider bridge above and the Phase-10 login overlay (Surface A field
  // dropdown + Surface B form prompt) used to show at once. These tests
  // pin the coordination: the overlay is soft-hidden (reversible --
  // clearFieldDropdown()/renderFormPrompt([]), NEVER dismiss()/blockSite())
  // for the duration of a ceremony, and re-offered only on a
  // non-"credential" outcome (fallthrough/error/rejected).
  describe("passkey-priority overlay coordination (12-07, Bartek live-review 2026-07-17)", () => {
    async function flushMicrotasks(): Promise<void> {
      await Promise.resolve();
      await Promise.resolve();
      // Same rationale as the provider-bridge describe block above: some
      // assertions in this block observe a `window.postMessage`-delivered
      // event, which jsdom queues as a macrotask.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const sampleMatch = { itemId: "item-1", kind: "login", label: "alice@example.com", maskedHint: "a***@example.com" };

    function mountLoginForm(): { username: HTMLInputElement } {
      document.body.innerHTML = `
        <form>
          <input name="user" autocomplete="username">
          <input type="password" autocomplete="current-password">
        </form>
      `;
      return { username: document.querySelector('input[autocomplete="username"]') as HTMLInputElement };
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

    /** Routes the shared `sendMessage` mock: `autofill.matchFrame` always
     * resolves with `sampleMatch` (so the login overlay has something to
     * show); a `credentials.get`/`credentials.create` ceremony resolves
     * ONLY when the test explicitly calls the returned function -- this is
     * what lets a test observe overlay state WHILE a ceremony is still in
     * flight, before choosing how it resolves. */
    function wireSendMessage(): (response: unknown) => void {
      let resolveCeremony!: (value: unknown) => void;
      const ceremonyPromise = new Promise((resolve) => {
        resolveCeremony = resolve;
      });
      hoisted.mockSendMessage.mockReset();
      hoisted.mockSendMessage.mockImplementation((message: { kind: string }) => {
        if (message.kind === "autofill.matchFrame") {
          return Promise.resolve({ pageState: "ok", matches: [sampleMatch] });
        }
        return ceremonyPromise;
      });
      return resolveCeremony;
    }

    it("forwarding a ceremony soft-hides an already-shown overlay -- clearFieldDropdown() + renderFormPrompt([]), never dismiss()/blockSite()", async () => {
      mountLoginForm();
      wireSendMessage();
      contentRelay.main({} as never);
      await flushMicrotasks();

      // Surface B mounted on the initial pass -- the frame has a match.
      expect(hoisted.mockRenderFormPrompt).toHaveBeenCalledWith([sampleMatch]);
      hoisted.mockRenderFormPrompt.mockClear();

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest("nonce-hide"), origin: location.origin, source: window }),
      );
      await flushMicrotasks();

      expect(hoisted.mockClearFieldDropdown).toHaveBeenCalledTimes(1);
      expect(hoisted.mockRenderFormPrompt).toHaveBeenCalledWith([]);
    });

    it("Surface A: while a ceremony is in flight, focusing a detected login field does not mount the field dropdown", async () => {
      const { username } = mountLoginForm();
      wireSendMessage();
      contentRelay.main({} as never);
      await flushMicrotasks();

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest("nonce-inflight-a"), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      hoisted.mockRenderFieldDropdown.mockClear();

      username.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await flushMicrotasks();

      expect(hoisted.mockRenderFieldDropdown).not.toHaveBeenCalled();
    });

    it("Surface B: the initial form-prompt render is skipped when a ceremony is already in flight before document-ready fires (conditional-mediation race)", async () => {
      // Drain the outer beforeEach()'s own `main()` call first -- it ran
      // its `initialMatchAndPrompt()` synchronously (default jsdom
      // readyState "complete") against the THEN-empty document, and that
      // fire-and-forget promise chain is still pending. Without draining
      // it here (while the document is still empty, so it resolves as a
      // harmless no-match early-return), it would resume mid-test after
      // `mountLoginForm()` below has populated the DOM -- a test-only
      // artifact of `document` being shared across every `it` in this
      // file (see this file's own header comment), not a real race any
      // production single-`main()`-invocation page can hit.
      await flushMicrotasks();

      mountLoginForm();
      wireSendMessage();

      // Simulate document_start timing (this entrypoint's real `runAt`):
      // readyState is "loading" so `runWhenDocumentReady()` defers
      // `initialMatchAndPrompt()` to DOMContentLoaded instead of calling it
      // synchronously -- exactly like production. Re-invoking `main()`
      // instead (readyState left at its jsdom-default "complete") would
      // also reset `passkeyCeremonyInFlight` (test-idempotency hygiene,
      // mirroring `registeredProviderListener`'s own convention) and mask
      // the guard this test exists to pin.
      Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
      try {
        contentRelay.main({} as never);

        // The page's own conditional-mediation `credentials.get()` fires
        // before DOMContentLoaded -- the flag is set before
        // `initialMatchAndPrompt()` ever gets a chance to run.
        window.dispatchEvent(
          new MessageEvent("message", { data: validRequest("nonce-race"), origin: location.origin, source: window }),
        );

        document.dispatchEvent(new Event("DOMContentLoaded"));
        await flushMicrotasks();

        expect(hoisted.mockRenderFormPrompt).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(document, "readyState", { value: "complete", configurable: true });
      }
    });

    it("on a fallthrough response, the flag clears and the login overlay is re-offered (Surface B re-renders, Surface A can mount again)", async () => {
      const { username } = mountLoginForm();
      const resolveCeremony = wireSendMessage();
      contentRelay.main({} as never);
      await flushMicrotasks();

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest("nonce-fallthrough"), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      hoisted.mockRenderFormPrompt.mockClear(); // drop the hide()'s renderFormPrompt([]) call

      resolveCeremony({ fallthrough: true });
      await flushMicrotasks();

      expect(hoisted.mockRenderFormPrompt).toHaveBeenCalledWith([sampleMatch]);

      username.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await flushMicrotasks();
      expect(hoisted.mockRenderFieldDropdown).toHaveBeenCalled();
    });

    it("on a ceremony error response (response.failed), the flag also clears and the login overlay is re-offered", async () => {
      mountLoginForm();
      const resolveCeremony = wireSendMessage();
      contentRelay.main({} as never);
      await flushMicrotasks();

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest("nonce-error"), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      hoisted.mockRenderFormPrompt.mockClear();

      resolveCeremony({ fallthrough: false, failed: true });
      await flushMicrotasks();

      expect(hoisted.mockRenderFormPrompt).toHaveBeenCalledWith([sampleMatch]);
    });

    it("regression: a ceremony promise that rejects outright (.catch) also clears the flag and re-offers the overlay", async () => {
      mountLoginForm();
      hoisted.mockSendMessage.mockReset();
      hoisted.mockSendMessage.mockImplementation((message: { kind: string }) => {
        if (message.kind === "autofill.matchFrame") {
          return Promise.resolve({ pageState: "ok", matches: [sampleMatch] });
        }
        return Promise.reject(new Error("relay unreachable"));
      });
      contentRelay.main({} as never);
      await flushMicrotasks();
      hoisted.mockRenderFormPrompt.mockClear();

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest("nonce-catch"), origin: location.origin, source: window }),
      );
      await flushMicrotasks();

      expect(hoisted.mockRenderFormPrompt).toHaveBeenCalledWith([sampleMatch]);
    });

    it("on a credential response (passkey used), the overlay stays suppressed -- no re-render, Surface A still does not mount", async () => {
      const { username } = mountLoginForm();
      const resolveCeremony = wireSendMessage();
      contentRelay.main({} as never);
      await flushMicrotasks();

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest("nonce-credential"), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      hoisted.mockRenderFormPrompt.mockClear();
      hoisted.mockRenderFieldDropdown.mockClear();

      resolveCeremony({
        fallthrough: false,
        credentialResponseJson: JSON.stringify({
          id: "cred-1",
          rawId: "AQID",
          type: "public-key",
          response: { clientDataJSON: "AQID", authenticatorData: "AQID", signature: "AQID" },
        }),
      });
      await flushMicrotasks();

      expect(hoisted.mockRenderFormPrompt).not.toHaveBeenCalled();

      username.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await flushMicrotasks();
      expect(hoisted.mockRenderFieldDropdown).not.toHaveBeenCalled();
    });

    it("regression (no security gate weakened): a valid ceremony still acks + forwards + responds exactly as before; an invalid (wrong-origin) request is still silently ignored", async () => {
      mountLoginForm();
      const resolveCeremony = wireSendMessage();
      contentRelay.main({} as never);
      await flushMicrotasks();

      const received: Array<{ source?: unknown; nonce?: unknown; kind?: unknown }> = [];
      window.addEventListener("message", (e) => {
        const data = (e as MessageEvent).data as { source?: unknown };
        if (data?.source === "pv-content-relay") {
          received.push(data as { source?: unknown; nonce?: unknown; kind?: unknown });
        }
      });

      // Invalid: wrong origin -- D-03/ASVS V5 silent-ignore, unchanged by
      // this plan (never forwarded, never acked).
      window.dispatchEvent(
        new MessageEvent("message", {
          data: validRequest("nonce-still-invalid"),
          origin: "https://attacker.example.com",
          source: window,
        }),
      );
      await flushMicrotasks();
      expect(received).toHaveLength(0);

      // Valid: acked, then forwarded, with the same base64url-encoded
      // publicKey shape as before this plan.
      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest("nonce-still-valid"), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      expect(received).toEqual([{ source: "pv-content-relay", nonce: "nonce-still-valid", kind: "ack" }]);
      expect(hoisted.mockSendMessage).toHaveBeenCalledWith({
        kind: "credentials.get",
        publicKey: { rpId: "example.com" },
      });

      resolveCeremony({ fallthrough: true });
      await flushMicrotasks();
      expect(received).toContainEqual({ source: "pv-content-relay", nonce: "nonce-still-valid", kind: "fallthrough" });
    });

    // quick-260720-16k: the DOM-marker race fix -- these three tests prove
    // `document.documentElement.dataset.pvCeremonyInFlight` alone (set
    // directly, bypassing postMessage AND passkeyCeremonyInFlight entirely)
    // is sufficient to block/clear both surfaces, mirroring how
    // page-bridge.content.ts's relay() writes it in production (a separate
    // MAIN-world file this test suite does not load).
    it("Surface A: setting the DOM marker directly (no postMessage/passkeyCeremonyInFlight involved) blocks handleFocusIn's field-dropdown mount", async () => {
      const { username } = mountLoginForm();
      wireSendMessage();
      contentRelay.main({} as never);
      await flushMicrotasks();

      document.documentElement.dataset.pvCeremonyInFlight = "1";

      username.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await flushMicrotasks();

      expect(hoisted.mockRenderFieldDropdown).not.toHaveBeenCalled();
    });

    it("Surface B: setting the DOM marker directly before document-ready blocks the initial form-prompt render", async () => {
      // Drain the outer beforeEach()'s own `main()` call first -- same
      // rationale as the "conditional-mediation race" test above.
      await flushMicrotasks();

      mountLoginForm();
      wireSendMessage();

      Object.defineProperty(document, "readyState", { value: "loading", configurable: true });
      try {
        contentRelay.main({} as never);

        // Set the marker directly (mirroring page-bridge.content.ts's own
        // synchronous write) instead of dispatching a MessageEvent to flip
        // passkeyCeremonyInFlight.
        document.documentElement.dataset.pvCeremonyInFlight = "1";

        document.dispatchEvent(new Event("DOMContentLoaded"));
        await flushMicrotasks();

        expect(hoisted.mockRenderFormPrompt).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(document, "readyState", { value: "complete", configurable: true });
      }
    });

    it("the DOM marker (set externally, mirroring page-bridge's synchronous write) is cleared alongside passkeyCeremonyInFlight on a fallthrough response, and Surface A/B become available again", async () => {
      const { username } = mountLoginForm();
      const resolveCeremony = wireSendMessage();
      contentRelay.main({} as never);
      await flushMicrotasks();

      // Simulates page-bridge's write -- page-bridge.content.ts is a
      // separate MAIN-world file this test suite does not load.
      document.documentElement.dataset.pvCeremonyInFlight = "1";

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest("nonce-dom-marker-clear"), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      hoisted.mockRenderFormPrompt.mockClear();

      resolveCeremony({ fallthrough: true });
      await flushMicrotasks();

      expect(document.documentElement.dataset.pvCeremonyInFlight).toBeUndefined();

      username.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await flushMicrotasks();
      expect(hoisted.mockRenderFieldDropdown).toHaveBeenCalled();
    });
  });

  // Plan 13-06: the server-origin ext-unlock relay -- a SEPARATE `window`
  // "message" listener from the passkey-provider bridge above (different
  // source string, different nonce ledger, different forwarded message
  // kind). Mirrors that describe block's dispatchEvent-based simulation
  // convention (jsdom's real `window.postMessage` does not populate
  // `event.source`/`event.origin` for same-window delivery -- see that
  // block's own header comment).
  describe("server-origin ext-unlock relay (Plan 13-06, T-13-11/T-13-12/T-13-14)", () => {
    async function flushMicrotasks(): Promise<void> {
      await Promise.resolve();
      await new Promise((resolve) => queueMicrotask(() => resolve(undefined)));
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    /** Mirrors ExtUnlockBridge.tsx's own `bytesToB64Url` PAGE-SIDE encoder
     * algorithm byte-for-byte (web/ and extension/ are separate packages
     * with no shared module to import here) -- used to build test messages
     * the way a REAL browser (post Firefox-Xray-wrapper fix) actually sends
     * them: already encoded to a base64url STRING before content-relay ever
     * sees them, never a raw BufferSource. */
    function pageEncodeB64Url(bytes: Uint8Array): string {
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    function validRequest(nonce: string) {
      return {
        source: "pv-ext-unlock-bridge",
        nonce,
        prfB64: pageEncodeB64Url(new Uint8Array([1, 2, 3, 4])),
        prfWrappedUk: "prf-wrapped-uk-blob",
      };
    }

    beforeEach(() => {
      hoisted.mockSendMessage.mockReset();
      hoisted.mockSendMessage.mockResolvedValue({ ok: true });
      // Configured server = THIS document's own origin -- the gate every
      // test below either satisfies or deliberately violates.
      hoisted.storageStore.set("pv-server-config", { baseUrl: location.origin });
    });

    it("a well-formed, PAGE-ENCODED message on the CONFIGURED server origin is forwarded via sendMessage with the base64url PRF string preserved verbatim", async () => {
      const nonce = "nonce-ext-unlock-valid";
      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
      const call = hoisted.mockSendMessage.mock.calls[0][0] as {
        kind: string;
        nonce: string;
        prfB64: string;
        prfWrappedUk: string;
      };
      expect(call.kind).toBe("unlock.serverCeremony.relay");
      expect(call.nonce).toBe(nonce);
      expect(call.prfWrappedUk).toBe("prf-wrapped-uk-blob");
      // Forwarded byte-for-byte identical to what the page sent -- this
      // relay no longer does any encoding of its own for the page-encoded
      // path, it only validates and relays (D-21, Firefox Xray-wrapper
      // fix).
      expect(call.prfB64).toBe(validRequest(nonce).prfB64);
      const decoded = atob(call.prfB64.replace(/-/g, "+").replace(/_/g, "/"));
      expect(Array.from(decoded, (c) => c.charCodeAt(0))).toEqual([1, 2, 3, 4]);
    });

    it("CR-01/Firefox-Xray-fix regression: a REAL 32-byte PRF, encoded PAGE-SIDE via the exact ExtUnlockBridge.tsx algorithm, round-trips byte-for-byte through the relay's verbatim forward -> ACTUAL background decoder (b64UrlToBytes), across many random iterations and a fixed '-'/'_' vector -- and the OLD standard-base64 decoder (b64ToBytes) demonstrably throws on the same output", async () => {
      // Fixed 32-byte vector, chosen so its base64url form is KNOWN to
      // contain both '-' and '_' (computed offline, not left to chance) --
      // this is the exact class of payload that made ~74% of real PRF
      // outputs fail before the original CR-01 fix, and the same class the
      // Firefox Xray-wrapper hazard corrupted regardless of charset (any
      // byte value, not just '-'/'_'-producing ones) before THIS fix moved
      // the encode into page scope.
      const fixedPrf = new Uint8Array([
        21, 52, 83, 114, 145, 176, 207, 238, 13, 44, 75, 106, 137, 168, 199, 230, 5, 36, 67, 98, 129, 160, 191, 222,
        253, 28, 59, 90, 121, 152, 183, 214,
      ]);

      const vectors = [fixedPrf];
      for (let i = 0; i < 20; i++) {
        const random = new Uint8Array(32);
        crypto.getRandomValues(random);
        vectors.push(random);
      }

      let sawDashOrUnderscore = false;
      for (let i = 0; i < vectors.length; i++) {
        const prf = vectors[i];
        const nonce = `round-trip-${i}`;
        // PAGE-SIDE encode -- exercises the new path directly: the relay
        // receives an already-encoded string, exactly as a real browser
        // (post-fix, every browser including Firefox) sends it.
        const prfB64Sent = pageEncodeB64Url(prf);
        hoisted.mockSendMessage.mockClear();
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "pv-ext-unlock-bridge", nonce, prfB64: prfB64Sent, prfWrappedUk: "blob" },
            origin: location.origin,
            source: window,
          }),
        );
        await flushMicrotasks();

        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
        const { prfB64 } = hoisted.mockSendMessage.mock.calls[0][0] as { prfB64: string };

        // Forwarded verbatim -- the relay does not re-encode a page-encoded
        // string.
        expect(prfB64).toBe(prfB64Sent);
        // The ACTUAL background-side decoder (server-unlock.ts's own
        // import) recovers every byte exactly.
        expect(Array.from(b64UrlToBytes(prfB64))).toEqual(Array.from(prf));

        if (prfB64.includes("-") || prfB64.includes("_")) {
          sawDashOrUnderscore = true;
          // This is CR-01 itself, demonstrated directly: the OLD decoder
          // (a raw atob, standard base64 only) throws on this same
          // relay-produced string.
          expect(() => b64ToBytes(prfB64)).toThrow();
        }
      }
      // Guards against a vacuously-true test: at least one vector (the
      // fixed one, deterministically) must have actually exercised the
      // '-'/'_' charset difference.
      expect(sawDashOrUnderscore).toBe(true);
    });

    it("legacy BufferSource fallback (deploy skew: old web/out build, newer extension build) -- a raw ArrayBuffer `prf` field with no prfB64 is still encoded here and forwarded correctly", async () => {
      const prf = new Uint8Array([
        21, 52, 83, 114, 145, 176, 207, 238, 13, 44, 75, 106, 137, 168, 199, 230, 5, 36, 67, 98, 129, 160, 191, 222,
        253, 28, 59, 90, 121, 152, 183, 214,
      ]);
      const nonce = "nonce-ext-unlock-legacy-fallback";
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "pv-ext-unlock-bridge", nonce, prf: prf.buffer, prfWrappedUk: "legacy-blob" },
          origin: location.origin,
          source: window,
        }),
      );
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
      const call = hoisted.mockSendMessage.mock.calls[0][0] as { prfB64: string; prfWrappedUk: string };
      expect(call.prfWrappedUk).toBe("legacy-blob");
      expect(Array.from(b64UrlToBytes(call.prfB64))).toEqual(Array.from(prf));
    });

    it("rejects a message with a non-base64url-shaped prfB64 (e.g. containing '+'/'=') -- falls through to the legacy-shape check, and with no valid BufferSource `prf` either, is never forwarded", async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "pv-ext-unlock-bridge",
            nonce: "nonce-ext-unlock-bad-b64",
            prfB64: "not+valid/base64=",
            prfWrappedUk: "blob",
          },
          origin: location.origin,
          source: window,
        }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("rejects a message with an empty-string prfB64 -- never forwarded", async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "pv-ext-unlock-bridge",
            nonce: "nonce-ext-unlock-empty-b64",
            prfB64: "",
            prfWrappedUk: "blob",
          },
          origin: location.origin,
          source: window,
        }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("posts the ack/result back to the page with the background's ok value", async () => {
      const nonce = "nonce-ext-unlock-result";
      hoisted.mockSendMessage.mockResolvedValueOnce({ ok: true });

      const received: unknown[] = [];
      window.addEventListener("message", (e) => {
        const data = (e as MessageEvent).data as { source?: unknown; kind?: unknown };
        if (data?.source === "pv-content-relay" && data?.kind === "pv-ext-unlock-result") {
          received.push(data);
        }
      });

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();

      expect(received).toEqual([{ source: "pv-content-relay", kind: "pv-ext-unlock-result", nonce, ok: true }]);
    });

    it("a sendMessage rejection still posts back ok:false rather than leaving the page waiting forever", async () => {
      const nonce = "nonce-ext-unlock-throws";
      hoisted.mockSendMessage.mockRejectedValueOnce(new Error("no receiver"));

      const received: unknown[] = [];
      window.addEventListener("message", (e) => {
        const data = (e as MessageEvent).data as { source?: unknown; kind?: unknown };
        if (data?.source === "pv-content-relay" && data?.kind === "pv-ext-unlock-result") {
          received.push(data);
        }
      });

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();

      expect(received).toEqual([{ source: "pv-content-relay", kind: "pv-ext-unlock-result", nonce, ok: false }]);
    });

    it("T-13-11: single-use -- a replayed (already-forwarded) nonce is silently ignored on the second delivery", async () => {
      const nonce = "nonce-ext-unlock-replay";
      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);

      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1); // not forwarded again
    });

    it("T-13-11: rejects a message whose event.source is not window -- never forwarded", async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: validRequest("nonce-ext-unlock-wrong-source"),
          origin: location.origin,
          source: {} as unknown as MessageEventSource,
        }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("T-13-11: rejects a message whose event.origin does not match location.origin -- never forwarded", async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: validRequest("nonce-ext-unlock-wrong-origin"),
          origin: "https://attacker.example.com",
          source: window,
        }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("T-13-11: rejects a well-formed, same-origin-delivered message when THIS document is NOT the configured server -- never forwarded", async () => {
      hoisted.storageStore.set("pv-server-config", { baseUrl: "https://a-different-vault.example.com" });

      window.dispatchEvent(
        new MessageEvent("message", {
          data: validRequest("nonce-ext-unlock-not-configured-server"),
          origin: location.origin,
          source: window,
        }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("rejects a shape-invalid message (missing prfWrappedUk) -- never forwarded", async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { source: "pv-ext-unlock-bridge", nonce: "nonce-ext-unlock-bad-shape", prf: new ArrayBuffer(4) },
          origin: location.origin,
          source: window,
        }),
      );
      await flushMicrotasks();
      expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
    });

    it("does not interfere with the passkey-provider bridge's own nonce ledger -- the same nonce string on both channels forwards independently", async () => {
      const sharedNonce = "shared-nonce-across-channels";
      hoisted.mockSendMessage.mockResolvedValue({ fallthrough: true });

      // The passkey-provider bridge message is deliberately sent while
      // pv-server-config is UNSET (a plain, non-configured-server page) --
      // this describe block's own beforeEach pins pv-server-config to
      // location.origin for the ext-unlock relay half below, but a REAL
      // provider-bridge credentials.get() on the configured server origin
      // is now refused by design (provider-hijack fix, see the dedicated
      // "provider bridge refuses ceremonies on the configured server
      // origin" describe block above) -- this test's own point (two
      // independent nonce ledgers, proven via a shared nonce VALUE) is
      // orthogonal to that origin-scoping, so the provider-bridge message
      // is sent as an ordinary third-party-page ceremony here.
      hoisted.storageStore.delete("pv-server-config");
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "pv-page-bridge",
            nonce: sharedNonce,
            kind: "credentials.get",
            origin: location.origin,
            publicKey: { rpId: "example.com" },
          },
          origin: location.origin,
          source: window,
        }),
      );
      await flushMicrotasks();

      // Restored for the ext-unlock relay half below, which DOES require
      // being on the configured server origin (T-13-11).
      hoisted.storageStore.set("pv-server-config", { baseUrl: location.origin });
      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(sharedNonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(2);
      expect(hoisted.mockSendMessage).toHaveBeenNthCalledWith(1, {
        kind: "credentials.get",
        publicKey: { rpId: "example.com" },
      });
      expect(hoisted.mockSendMessage).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ kind: "unlock.serverCeremony.relay", nonce: sharedNonce }),
      );
    });

    // Plan 13-07 (Bartek mandate, full SIGN-IN) -- CR-01 lesson applied: a
    // REAL round-trip for the new opaque `token`/`accountEmail` fields,
    // through the ACTUAL relay forwarding path (no mocks of this file's own
    // logic) -- unlike the PRF field, the token is never encoded/decoded
    // (it is an opaque bearer STRING, mirrors unlock.ts's own
    // `auth.signIn.password` handling), so the "round trip" here is
    // byte-for-byte identity through the relay's own message construction,
    // exercised with a REALISTIC standard-base64-shaped token (containing
    // `+`/`/`/`=`, the exact charset CR-01 showed a naive implementation
    // can mishandle at a boundary) to guard against any future encode step
    // silently mangling it.
    it("signin mode: forwards token/accountEmail fields VERBATIM (real base64-shaped token containing +/=, unmodified end to end)", async () => {
      const nonce = "nonce-ext-unlock-signin";
      const realisticToken = "aB3+xyz/QDzP9k7f2Lp8mN0vR6tW1hU4jK5cE7sG2iZ==";
      window.dispatchEvent(
        new MessageEvent("message", {
          data: {
            source: "pv-ext-unlock-bridge",
            nonce,
            prf: new Uint8Array([9, 8, 7, 6]).buffer,
            prfWrappedUk: "signin-blob",
            token: realisticToken,
            accountEmail: "signin-user@example.com",
          },
          origin: location.origin,
          source: window,
        }),
      );
      await flushMicrotasks();

      expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
      const call = hoisted.mockSendMessage.mock.calls[0][0] as {
        kind: string;
        token?: string;
        accountEmail?: string;
      };
      expect(call.kind).toBe("unlock.serverCeremony.relay");
      // Byte-for-byte identical to what the page sent -- no encode/decode
      // boundary touches this field anywhere in the relay.
      expect(call.token).toBe(realisticToken);
      expect(call.accountEmail).toBe("signin-user@example.com");
    });

    it("unlock mode: token/accountEmail are simply ABSENT from the forwarded payload when the page never sent them", async () => {
      const nonce = "nonce-ext-unlock-no-signin-fields";
      window.dispatchEvent(
        new MessageEvent("message", { data: validRequest(nonce), origin: location.origin, source: window }),
      );
      await flushMicrotasks();

      const call = hoisted.mockSendMessage.mock.calls[0][0] as { token?: string; accountEmail?: string };
      expect(call.token).toBeUndefined();
      expect(call.accountEmail).toBeUndefined();
    });

    // Bartek live-UAT bug fix (.planning/debug/resolved/
    // signin-passkeyless-spin.md): ExtUnlockBridge's own explicit "this
    // ceremony reached a terminal, calmly-explained failure state" notice --
    // no prf/prfWrappedUk at all, unlike every other case above.
    describe("explicit failure notice (failed: true)", () => {
      function failureRequest(nonce: string) {
        return { source: "pv-ext-unlock-bridge", nonce, failed: true };
      }

      it("forwards a well-formed failure notice via sendMessage with failed:true, no prfB64/prfWrappedUk fields", async () => {
        const nonce = "nonce-ext-unlock-failed";
        window.dispatchEvent(
          new MessageEvent("message", { data: failureRequest(nonce), origin: location.origin, source: window }),
        );
        await flushMicrotasks();

        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
        expect(hoisted.mockSendMessage).toHaveBeenCalledWith({
          kind: "unlock.serverCeremony.relay",
          nonce,
          failed: true,
        });
      });

      it("posts the ack/result back to the page with the background's ok value, same as the success path", async () => {
        const nonce = "nonce-ext-unlock-failed-ack";
        hoisted.mockSendMessage.mockResolvedValueOnce({ ok: false, error: "ceremony-failed" });

        const received: unknown[] = [];
        window.addEventListener("message", (e) => {
          const data = (e as MessageEvent).data as { source?: unknown; kind?: unknown };
          if (data?.source === "pv-content-relay" && data?.kind === "pv-ext-unlock-result") {
            received.push(data);
          }
        });

        window.dispatchEvent(
          new MessageEvent("message", { data: failureRequest(nonce), origin: location.origin, source: window }),
        );
        await flushMicrotasks();

        expect(received).toEqual([{ source: "pv-content-relay", kind: "pv-ext-unlock-result", nonce, ok: false }]);
      });

      it("T-13-11: single-use -- a replayed failure notice is silently ignored on the second delivery", async () => {
        const nonce = "nonce-ext-unlock-failed-replay";
        window.dispatchEvent(
          new MessageEvent("message", { data: failureRequest(nonce), origin: location.origin, source: window }),
        );
        await flushMicrotasks();
        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);

        window.dispatchEvent(
          new MessageEvent("message", { data: failureRequest(nonce), origin: location.origin, source: window }),
        );
        await flushMicrotasks();
        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1); // not forwarded again
      });

      it("rejects a well-formed failure-notice message when THIS document is NOT the configured server -- never forwarded", async () => {
        hoisted.storageStore.set("pv-server-config", { baseUrl: "https://a-different-vault.example.com" });

        window.dispatchEvent(
          new MessageEvent("message", {
            data: failureRequest("nonce-ext-unlock-failed-not-configured-server"),
            origin: location.origin,
            source: window,
          }),
        );
        await flushMicrotasks();
        expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
      });
    });

    // Plan 15-01: the master-password sign-in path through this SAME
    // ceremony window (AMENDMENT, 15-CONTEXT.md) -- a THIRD, mutually
    // exclusive payload shape (no prf/prfB64/prfWrappedUk fields at all).
    describe("password-shaped payload (Plan 15-01)", () => {
      function passwordRequest(nonce: string) {
        return { source: "pv-ext-unlock-bridge", nonce, passwordB64: "abc", email: "a@b.c" };
      }

      it("a same-window postMessage of {source, nonce, passwordB64, email} (no prf fields) is accepted and forwarded as the password-shaped unlock.serverCeremony.relay message, never the PRF shape", async () => {
        const nonce = "nonce-ext-unlock-password";
        window.dispatchEvent(
          new MessageEvent("message", { data: passwordRequest(nonce), origin: location.origin, source: window }),
        );
        await flushMicrotasks();

        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);
        const call = hoisted.mockSendMessage.mock.calls[0][0] as {
          kind: string;
          nonce: string;
          passwordB64: string;
          email: string;
        };
        expect(call).toEqual({
          kind: "unlock.serverCeremony.relay",
          nonce,
          passwordB64: "abc",
          email: "a@b.c",
        });
        expect(call).not.toHaveProperty("prfB64");
        expect(call).not.toHaveProperty("prfWrappedUk");
        expect(call).not.toHaveProperty("token");
        expect(call).not.toHaveProperty("accountEmail");
      });

      it("rejects a password-shaped message with an empty-string passwordB64 -- never forwarded", async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "pv-ext-unlock-bridge", nonce: "nonce-ext-unlock-pw-empty-b64", passwordB64: "", email: "a@b.c" },
            origin: location.origin,
            source: window,
          }),
        );
        await flushMicrotasks();
        expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
      });

      it("rejects a password-shaped message with an empty-string email -- never forwarded", async () => {
        window.dispatchEvent(
          new MessageEvent("message", {
            data: { source: "pv-ext-unlock-bridge", nonce: "nonce-ext-unlock-pw-empty-email", passwordB64: "abc", email: "" },
            origin: location.origin,
            source: window,
          }),
        );
        await flushMicrotasks();
        expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
      });

      it("T-13-11: rejects a well-formed password-shaped message when THIS document is NOT the configured server -- never forwarded", async () => {
        hoisted.storageStore.set("pv-server-config", { baseUrl: "https://a-different-vault.example.com" });

        window.dispatchEvent(
          new MessageEvent("message", {
            data: passwordRequest("nonce-ext-unlock-pw-not-configured-server"),
            origin: location.origin,
            source: window,
          }),
        );
        await flushMicrotasks();
        expect(hoisted.mockSendMessage).not.toHaveBeenCalled();
      });

      it("T-13-11: single-use -- a replayed password-shaped nonce is silently ignored on the second delivery", async () => {
        const nonce = "nonce-ext-unlock-pw-replay";
        window.dispatchEvent(
          new MessageEvent("message", { data: passwordRequest(nonce), origin: location.origin, source: window }),
        );
        await flushMicrotasks();
        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1);

        window.dispatchEvent(
          new MessageEvent("message", { data: passwordRequest(nonce), origin: location.origin, source: window }),
        );
        await flushMicrotasks();
        expect(hoisted.mockSendMessage).toHaveBeenCalledTimes(1); // not forwarded again
      });

      it("posts the ack/result back to the page with the background's ok value, same as the PRF path", async () => {
        const nonce = "nonce-ext-unlock-pw-result";
        hoisted.mockSendMessage.mockResolvedValueOnce({ ok: false, error: "invalid-credentials" });

        const received: unknown[] = [];
        window.addEventListener("message", (e) => {
          const data = (e as MessageEvent).data as { source?: unknown; kind?: unknown };
          if (data?.source === "pv-content-relay" && data?.kind === "pv-ext-unlock-result") {
            received.push(data);
          }
        });

        window.dispatchEvent(
          new MessageEvent("message", { data: passwordRequest(nonce), origin: location.origin, source: window }),
        );
        await flushMicrotasks();

        expect(received).toEqual([{ source: "pv-content-relay", kind: "pv-ext-unlock-result", nonce, ok: false }]);
      });
    });
  });

  // Bartek live-UAT bug follow-up (.planning/debug/resolved/
  // signin-passkeyless-spin.md, provider-hijack diagnosis): Firefox has no
  // declarative `world:'MAIN'` content-script exclusion, so THIS file's own
  // manual injectPageBridgeFirefoxScript() call is the only place that can
  // prevent page-bridge-firefox.js from installing on the configured server
  // origin at all -- letting navigator.credentials.get/create stay
  // genuinely native there. `import.meta.env.FIREFOX` is fixed `false` in
  // this (Chrome-oriented) jsdom test build and cannot be toggled per-test
  // (EnrollExtPasskeyPrompt.test.tsx's own documented limitation, same
  // per-module `import.meta` constraint) -- this is therefore a structural
  // source check, mirroring that file's own precedent; the actual runtime
  // behavior (a real Firefox build, `import.meta.env.FIREFOX === true`) is
  // verified by extension/e2e-firefox/run-server-unlock.cjs's
  // assertNativeWebAuthn() (P13-06-NATIVE-WEBAUTHN / P13-07-NATIVE-WEBAUTHN).
  //
  // CSP-blocked-inline fix (debug session .planning/debug/resolved/
  // firefox-injection-csp-blocked.md): the injection call itself moved from
  // WXT's injectScript() helper (which picks a page-CSP-vulnerable inline
  // `script.text` strategy for this project's MV2 Firefox build) to a local
  // injectPageBridgeFirefoxScript() using `script.src` (CSP-exempt, per that
  // session's live-Firefox verification) -- this test's own structural
  // assertions were updated to match the new call name, but the FUNCTIONAL
  // guarantee under test (FIREFOX gate, then origin check, then -- only for
  // a non-configured origin -- the actual injection call) is unchanged.
  describe("injectFirefoxPageBridge — skips injection on the configured server origin (structural, Firefox-only branch)", () => {
    it("checks isConfiguredServerOrigin() and returns BEFORE calling injectPageBridgeFirefoxScript(), inside the FIREFOX-gated body", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const source = await fs.readFile(path.join(import.meta.dirname, "../content-relay.content.ts"), "utf-8");

      const fnStart = source.indexOf("async function injectFirefoxPageBridge()");
      expect(fnStart).toBeGreaterThan(-1);
      const fnBodyStart = source.indexOf("{", fnStart);
      const fnBodyEnd = source.indexOf("\n}\n", fnBodyStart);
      const fnBody = source.slice(fnBodyStart, fnBodyEnd);

      const firefoxGateIndex = fnBody.indexOf("import.meta.env.FIREFOX");
      const originCheckIndex = fnBody.indexOf("isConfiguredServerOrigin()");
      const injectCallIndex = fnBody.indexOf("injectPageBridgeFirefoxScript(");

      expect(firefoxGateIndex).toBeGreaterThan(-1);
      expect(originCheckIndex).toBeGreaterThan(-1);
      expect(injectCallIndex).toBeGreaterThan(-1);
      // Order matters: the FIREFOX gate first (this whole function is a
      // Firefox-only concern), THEN the origin check, THEN (only for a
      // NON-configured origin) the actual injection call.
      expect(firefoxGateIndex).toBeLessThan(originCheckIndex);
      expect(originCheckIndex).toBeLessThan(injectCallIndex);
    });
  });

  // CSP-blocked-inline fix (debug session .planning/debug/resolved/
  // firefox-injection-csp-blocked.md): pins the ACTUAL DOM-construction
  // strategy inside injectPageBridgeFirefoxScript() itself -- a regression
  // to WXT's original inline `script.text = <fetched source>` approach
  // would silently reintroduce the CSP-blocked bug (confirmed live via a
  // throwaway extension + a real Firefox + a CSP-strict fixture page during
  // that debug session: the inline form is blocked by a page's
  // `script-src-elem` CSP directive, a `.src`-based moz-extension:// load is
  // not) without ever failing a JS exception this jsdom suite could catch.
  describe("injectPageBridgeFirefoxScript — always src-based, never inline (CSP-blocked-inline regression guard)", () => {
    it("sets script.src via browser.runtime.getURL and never assigns script.text/.textContent", async () => {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const source = await fs.readFile(path.join(import.meta.dirname, "../content-relay.content.ts"), "utf-8");

      const fnStart = source.indexOf("function injectPageBridgeFirefoxScript()");
      expect(fnStart).toBeGreaterThan(-1);
      const fnBodyStart = source.indexOf("{", fnStart);
      const fnBodyEnd = source.indexOf("\n}\n", fnBodyStart);
      const fnBody = source.slice(fnBodyStart, fnBodyEnd);

      expect(fnBody).toMatch(/script\.src\s*=\s*browser\.runtime\.getURL\(\s*["']\/page-bridge-firefox\.js["']\s*\)/);
      expect(fnBody).not.toMatch(/\.text\s*=/);
      expect(fnBody).not.toMatch(/\.textContent\s*=/);
      expect(fnBody).not.toMatch(/\bfetch\(/);
    });
  });
});
