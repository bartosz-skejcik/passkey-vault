// @vitest-environment jsdom
// entrypoints/__tests__/page-bridge.test.ts — Plan 12-03 Task 1's required
// behaviors for the Chrome MAIN-world `navigator.credentials` patch
// (page-bridge.content.ts). Lives in entrypoints/__tests__/ rather than
// directly in entrypoints/ for the SAME reason content-relay.test.ts does
// (see that file's own header comment): `page-bridge.test.ts` sitting
// directly in entrypoints/ would collide, on WXT's entrypoint-name
// derivation, with BOTH page-bridge.content.ts (content-script) and
// page-bridge.ts (unlisted-script) -- a three-way name collision `npx wxt
// build` would refuse. One directory down is invisible to entrypoint
// discovery.
//
// page-bridge.content.ts imports nothing beyond
// lib/messaging/page-protocol.ts's two typed interfaces (D-02) -- no
// `wxt/browser` mock is needed here, unlike every other entrypoint test in
// this codebase; this file only needs `navigator.credentials` (stubbed,
// jsdom has no WebAuthn implementation) and `window.postMessage`/`message`
// events (jsdom implements both natively).
//
// IMPORTANT test-design note: `installPatch()` mutates `navigator.credentials`
// IN PLACE (`Object.defineProperty(navigator.credentials, "create", ...)`),
// exactly like a real browser patch would. That means the fake container's
// OWN `create`/`get` properties are overwritten by the installed wrapper the
// moment `pageBridge.main()` runs -- a test must therefore capture the
// NATIVE mock functions separately (`nativeCreate`/`nativeGet` below)
// BEFORE calling `main()`, and assert against those, never against
// `navigator.credentials.create/get` post-patch (which is the wrapper, not
// the native mock).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import pageBridgeDefinition, { isPermissionsPolicyBlocked } from "../page-bridge.content";
import type { PageBridgeRequestEnvelope, PageBridgeResponseEnvelope } from "../../lib/messaging/page-protocol";

// `defineContentScript`'s return type is the full ContentScriptDefinition
// union (isolated-world `main(ctx)` OR main-world `main()`), so a plain
// `pageBridgeDefinition.main()` call would need to satisfy BOTH arities.
// This file's entrypoint always declares `world: 'MAIN'` (no ctx param) --
// narrow the type once, here, rather than casting at every call site.
const pageBridge = pageBridgeDefinition as unknown as { main: () => void };

let nativeCreate: ReturnType<typeof vi.fn>;
let nativeGet: ReturnType<typeof vi.fn>;

function installFakeCredentialsContainer(): void {
  nativeCreate = vi.fn().mockResolvedValue({ id: "native-create-result" });
  nativeGet = vi.fn().mockResolvedValue({ id: "native-get-result" });
  Object.defineProperty(navigator, "credentials", {
    value: { create: nativeCreate, get: nativeGet },
    configurable: true,
    writable: true,
  });
}

/** Captures the outgoing request envelope page-bridge posts to
 * content-relay (the real `window.postMessage` still runs -- this is a
 * pass-through spy, not a stub) so a test can read its `nonce` and craft a
 * matching synthetic response. */
function spyOnOutgoingPostMessage(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(window, "postMessage");
}

/**
 * Simulates content-relay.content.ts's own response `postMessage` back to
 * page-bridge. Dispatched as a manually constructed `MessageEvent` (with
 * explicit `source`/`origin` init-dict fields) rather than a real
 * `window.postMessage()` call: jsdom's own `postMessage` implementation
 * does not populate `event.source`/`event.origin` for same-window delivery
 * (verified empirically -- both come back `null`/`""`), which would make
 * page-bridge's D-03/ASVS V5 same-window/same-origin check reject every
 * synthetic response regardless of correctness. A manually constructed
 * `MessageEvent` is also synchronous (no macrotask flush needed), unlike a
 * real `postMessage` round trip.
 */
function dispatchRelayResponse(envelope: PageBridgeResponseEnvelope): void {
  window.dispatchEvent(new MessageEvent("message", { data: envelope, origin: location.origin, source: window }));
}

function lastRequestEnvelope(spy: ReturnType<typeof vi.spyOn>): PageBridgeRequestEnvelope {
  const call = spy.mock.calls.at(-1);
  if (!call) {
    throw new Error("page-bridge never called window.postMessage");
  }
  return call[0] as PageBridgeRequestEnvelope;
}

beforeEach(() => {
  installFakeCredentialsContainer();
  // Fresh registration per test, patching THIS test's fake container.
  pageBridge.main();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // Permissions-Policy tests set this directly on jsdom's shared `document`
  // -- always clear it, regardless of whether the test that set it passed
  // or threw, so it never leaks into a later, unrelated test.
  delete (document as unknown as { featurePolicy?: unknown }).featurePolicy;
  delete (document as unknown as { permissionsPolicy?: unknown }).permissionsPolicy;
  // quick-260720-16k: relay() now sets this DOM marker synchronously -- same
  // never-leak-into-a-later-test discipline as the two deletes above.
  delete (document.documentElement as HTMLElement).dataset.pvCeremonyInFlight;
});

describe("D-20(a): non-configurable accessor", () => {
  it("installs create/get as non-configurable -- a re-definition attempt throws and the patch survives", () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator.credentials, "create");
    expect(descriptor?.configurable).toBe(false);

    expect(() =>
      Object.defineProperty(navigator.credentials, "create", {
        configurable: true,
        value: () => Promise.resolve(null),
      }),
    ).toThrow();

    // The original patched function is still installed and callable.
    expect(typeof navigator.credentials.create).toBe("function");
  });

  it("fails safe (leaves the environment untouched) when the patch is attempted a second time", () => {
    // beforeEach already patched this container once (non-configurable). A
    // second main() call -- e.g. a race with another content-script
    // instance, or this same instance re-running -- must not throw, and
    // must leave the FIRST installed patch in place untouched.
    const patchedCreate = navigator.credentials.create;
    const patchedGet = navigator.credentials.get;

    expect(() => pageBridge.main()).not.toThrow();

    expect(navigator.credentials.create).toBe(patchedCreate);
    expect(navigator.credentials.get).toBe(patchedGet);
  });
});

describe("D-20(b): Permissions-Policy respected before brokering", () => {
  it("never relays and goes straight to the native original when the policy blocks this context", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    (document as unknown as { featurePolicy: { allowsFeature: () => boolean } }).featurePolicy = {
      allowsFeature: () => false,
    };

    const result = await navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);

    expect(result).toEqual({ id: "native-get-result" });
    expect(nativeGet).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
  });
});

// WR-01 fix (12-REVIEW.md, Plan 12-05): when NEITHER `document.permissionsPolicy`
// nor `document.featurePolicy` exists (routine on Firefox, and the state of
// every test above that doesn't explicitly stub one), the OLD code
// blanket-returned "not blocked" -- silently a no-op for D-20(b) on the
// entire Firefox surface. `isPermissionsPolicyBlocked` now takes an
// optional frame-context override (production always uses the real
// `window`) so this suite can simulate a sub-frame/cross-origin-top
// scenario without needing to redefine jsdom's own non-configurable
// `window.top`.
describe("WR-01: delegation-aware default when neither detection API exists", () => {
  it("top-level frame (window.top === window.self): fails open (not blocked) -- preserves the pre-fix top-level behavior", () => {
    // No frame argument -- exercises the REAL `window` default, which in
    // jsdom's single-window test environment is always top-level.
    expect(isPermissionsPolicyBlocked("get")).toBe(false);
  });

  it("sub-frame, SAME-origin with top: not blocked (Permissions-Policy's default allowlist for these two features is 'self')", () => {
    const fakeTop = { location: { origin: location.origin } };
    const fakeSelf = {};
    expect(
      isPermissionsPolicyBlocked("get", { top: fakeTop, self: fakeSelf, location: { origin: location.origin } }),
    ).toBe(false);
  });

  it("sub-frame, CROSS-origin with top: BLOCKED -- closes D-20(b)'s Firefox fail-open gap", () => {
    const fakeTop = { location: { origin: "https://attacker.example" } };
    const fakeSelf = {};
    expect(
      isPermissionsPolicyBlocked("create", {
        top: fakeTop,
        self: fakeSelf,
        location: { origin: location.origin },
      }),
    ).toBe(true);
  });

  it("sub-frame where reading top.location.origin throws (real cross-origin browser behavior): BLOCKED, not a crash", () => {
    const fakeTop = {
      get location(): never {
        throw new DOMException("Blocked a frame with origin from accessing a cross-origin frame.");
      },
    };
    const fakeSelf = {};
    expect(() =>
      isPermissionsPolicyBlocked("get", { top: fakeTop, self: fakeSelf, location: { origin: location.origin } }),
    ).not.toThrow();
    expect(
      isPermissionsPolicyBlocked("get", { top: fakeTop, self: fakeSelf, location: { origin: location.origin } }),
    ).toBe(true);
  });
});

describe("not a WebAuthn ceremony", () => {
  it("a create() call with no publicKey field falls straight through, no relay attempted", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const options = { password: {} } as unknown as CredentialCreationOptions;

    const result = await navigator.credentials.create(options);

    expect(result).toEqual({ id: "native-create-result" });
    expect(nativeCreate).toHaveBeenCalledWith(options);
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe("D-11 fallthrough: three required cases", () => {
  // CR-03 completion (Plan 12-06): renamed from "(timeout)" -- this is now
  // specifically the NO-ACK case (content-relay never even accepts the
  // request), bounded by the SHORT `ACK_TIMEOUT_MS` window, not the old
  // single 120s interaction-budget timeout. See the dedicated "CR-03
  // completion" describe block below for the ack-arrives/no-ack-arrives
  // pair of tests this plan's behavior spec requires.
  it("Case 1 (no ack): falls through to the native original when content-relay never even acks the request", async () => {
    vi.useFakeTimers();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);

    await vi.advanceTimersByTimeAsync(3_000);
    const result = await promise;

    expect(result).toEqual({ id: "native-get-result" });
    expect(nativeGet).toHaveBeenCalledTimes(1);
  });

  it("Case 2 (relay error): falls through when content-relay responds with kind:'error'", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    dispatchRelayResponse({ source: "pv-content-relay", nonce, kind: "error" });

    const result = await promise;
    expect(result).toEqual({ id: "native-get-result" });
    expect(nativeGet).toHaveBeenCalledTimes(1);
  });

  it("Case 3 (explicit fallthrough signal): falls through when content-relay responds with kind:'fallthrough'", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.create({
      publicKey: { rp: { id: "example.com" } },
    } as CredentialCreationOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    dispatchRelayResponse({ source: "pv-content-relay", nonce, kind: "fallthrough" });

    const result = await promise;
    expect(result).toEqual({ id: "native-create-result" });
    expect(nativeCreate).toHaveBeenCalledTimes(1);
  });
});

describe("DOM marker for cross-world race-closing (autofill-flash fix, quick-260720-16k)", () => {
  it("sets document.documentElement.dataset.pvCeremonyInFlight = '1' SYNCHRONOUSLY, before any async postMessage hop settles", async () => {
    vi.useFakeTimers();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);

    // Asserted BEFORE awaiting the promise or advancing any timers -- proves
    // the marker is visible in the SAME synchronous tick relay() started,
    // not after any async delivery.
    expect(document.documentElement.dataset.pvCeremonyInFlight).toBe("1");

    // Let the no-ack fallthrough settle so this test does not hang.
    await vi.advanceTimersByTimeAsync(3_000);
    await promise;
  });
});

describe("credential success", () => {
  it("shapes content-relay's decoded credential into a PublicKeyCredential-like object with getClientExtensionResults()/toJSON()", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    const decodedCredential = {
      id: "cred-1",
      rawId: new ArrayBuffer(4),
      type: "public-key",
      response: { clientDataJSON: new ArrayBuffer(8) },
      clientExtensionResults: { prf: { enabled: true } },
    };
    const credentialJson = { id: "cred-1", rawId: "AAAA", type: "public-key" };

    dispatchRelayResponse({
      source: "pv-content-relay",
      nonce,
      kind: "credential",
      credential: decodedCredential,
      credentialJson,
    });

    const result = (await promise) as unknown as {
      id: string;
      rawId: ArrayBuffer;
      getClientExtensionResults: () => unknown;
      toJSON: () => unknown;
    };

    expect(result.id).toBe("cred-1");
    expect(result.rawId).toBeInstanceOf(ArrayBuffer);
    expect(result.getClientExtensionResults()).toEqual({ prf: { enabled: true } });
    expect(result.toJSON()).toEqual(credentialJson);
    // Never falls through to the native original on a genuine success.
    expect(nativeGet).not.toHaveBeenCalled();
  });
});

describe("D-03: request envelope discipline", () => {
  it("posts with location.origin as the target origin, never '*'", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    vi.useFakeTimers();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);

    const call = postSpy.mock.calls.at(-1);
    expect(call?.[1]).toBe(location.origin);
    expect(call?.[1]).not.toBe("*");

    await vi.advanceTimersByTimeAsync(3_000);
    await promise;
  });

  it("ignores a response with a mismatched nonce (does not resolve early)", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    vi.useFakeTimers();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);
    const realNonce = lastRequestEnvelope(postSpy).nonce;

    dispatchRelayResponse({
      source: "pv-content-relay",
      nonce: `not-${realNonce}`,
      kind: "credential",
      credential: { id: "attacker-supplied" },
      credentialJson: {},
    });

    await vi.advanceTimersByTimeAsync(3_000);
    const result = await promise;

    // The mismatched-nonce message was ignored -- the call still timed out
    // (short no-ack window, since the mismatched-nonce message was never
    // accepted as this call's ack either) and fell through to native, never
    // resolving with the spoofed value.
    expect(result).toEqual({ id: "native-get-result" });
  });
});

// CR-03 completion (12-REVIEW.md re-review, Plan 12-06): the early-ack
// handshake -- content-relay.content.ts's `postAck` -- is what makes the
// extension the SOLE fallthrough authority once it accepts a request. Prior
// to this fix, the background's `waitForUnlock`+`awaitCeremonyConsent`
// ceilings were ADDITIVE (~240s worst case) against this file's single
// fixed 120s timeout, so a slow locked-vault confirm made the page fall
// through to native mid-ceremony while the background went on to
// mint+persist a credential the RP never received (12-REVIEW.md CR-03,
// re-review finding).
describe("CR-03 completion (Plan 12-06): early-ack handshake", () => {
  it("an ack cancels the short no-ack fallthrough timer -- a credential resolution arriving well after the OLD 120s interaction-budget window still returns the extension's result, never a native fallthrough", async () => {
    vi.useFakeTimers();
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    // The relay accepts the request and acks it well within the short
    // no-ack window.
    dispatchRelayResponse({ source: "pv-content-relay", nonce, kind: "ack" });

    // Advance PAST both the short no-ack window AND the OLD single 120s
    // interaction-budget timeout -- if the ack hadn't cancelled the
    // original race and switched to the extension-authority backstop, this
    // call would already have resolved to native by now.
    await vi.advanceTimersByTimeAsync(150_000);
    expect(nativeGet).not.toHaveBeenCalled();

    const decodedCredential = {
      id: "cred-1",
      rawId: new ArrayBuffer(4),
      type: "public-key",
      response: { clientDataJSON: new ArrayBuffer(8) },
    };
    const credentialJson = { id: "cred-1" };
    dispatchRelayResponse({
      source: "pv-content-relay",
      nonce,
      kind: "credential",
      credential: decodedCredential,
      credentialJson,
    });

    const result = (await promise) as unknown as { id: string };
    expect(result.id).toBe("cred-1");
    expect(nativeGet).not.toHaveBeenCalled();
  });

  it("no ack arrives within the short window (relay absent / non-provider context): falls through to native promptly, not after the old 120s ceiling", async () => {
    vi.useFakeTimers();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);

    // Well short of the OLD 120s timeout -- proves the fallthrough is now
    // bounded by the SHORT no-ack window, not the interaction budget.
    await vi.advanceTimersByTimeAsync(3_000);

    const result = await promise;
    expect(result).toEqual({ id: "native-get-result" });
    expect(nativeGet).toHaveBeenCalledTimes(1);
  });

  it("an ack followed by an explicit fallthrough resolves via that real message, never the extension-authority backstop", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.create({
      publicKey: { rp: { id: "example.com" } },
    } as CredentialCreationOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    dispatchRelayResponse({ source: "pv-content-relay", nonce, kind: "ack" });
    dispatchRelayResponse({ source: "pv-content-relay", nonce, kind: "fallthrough" });

    const result = await promise;
    expect(result).toEqual({ id: "native-create-result" });
    expect(nativeCreate).toHaveBeenCalledTimes(1);
  });

  it("a duplicate/late ack for an already-acked nonce is ignored -- does not throw, does not re-arm past the already-armed backstop", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    dispatchRelayResponse({ source: "pv-content-relay", nonce, kind: "ack" });
    expect(() =>
      dispatchRelayResponse({ source: "pv-content-relay", nonce, kind: "ack" }),
    ).not.toThrow();

    dispatchRelayResponse({ source: "pv-content-relay", nonce, kind: "fallthrough" });

    const result = await promise;
    expect(result).toEqual({ id: "native-get-result" });
  });
});
