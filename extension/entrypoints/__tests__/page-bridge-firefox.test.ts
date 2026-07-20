// @vitest-environment jsdom
// entrypoints/__tests__/page-bridge-firefox.test.ts — Plan 14-03 Task 1's
// deterministic jsdom regression coverage for Plan 14-02's Firefox
// RESPONSE-direction MAIN-world re-materialization fix
// (page-bridge-firefox.ts's `shapeCredential()`/`b64UrlToArrayBuffer`, see
// that file's own header comment and
// .planning/debug/resolved/firefox-request-xray-hole.md for the full
// history). Mirrors page-bridge.test.ts's (the Chrome twin) structure
// verbatim -- same `// @vitest-environment jsdom` header, the same
// installFakeCredentialsContainer()/spyOnOutgoingPostMessage()/
// dispatchRelayResponse()/lastRequestEnvelope() helpers (duplicated here,
// never cross-imported, per this codebase's own per-file-owns-its-helpers
// convention), same beforeEach/afterEach DOM-marker cleanup -- but imports
// pageBridgeFirefoxDefinition, { isPermissionsPolicyBlocked } from
// "../page-bridge-firefox" instead.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import pageBridgeFirefoxDefinition, { isPermissionsPolicyBlocked } from "../page-bridge-firefox";
import type { PageBridgeRequestEnvelope, PageBridgeResponseEnvelope } from "../../lib/messaging/page-protocol";

// Silence unused-import lint noise: isPermissionsPolicyBlocked is imported
// (mirroring page-bridge.test.ts's own import list exactly, per this file's
// header comment) but this file's own test cases don't exercise it directly
// -- page-bridge.test.ts's D-20(b)/WR-01 suites already cover that function
// via the Chrome twin's identical implementation (both files re-export the
// same logic verbatim, per page-bridge-firefox.ts's own header comment).
void isPermissionsPolicyBlocked;

// `defineUnlistedScript`'s runtime shape is `{ main: () => void }` -- narrow
// the type once, here, exactly like page-bridge.test.ts does for its own
// `defineContentScript`-typed default export.
const pageBridgeFirefox = pageBridgeFirefoxDefinition as unknown as { main: () => void };

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

/** Captures the outgoing request envelope page-bridge-firefox posts to
 * content-relay (the real `window.postMessage` still runs -- this is a
 * pass-through spy, not a stub) so a test can read its `nonce` and craft a
 * matching synthetic response. */
function spyOnOutgoingPostMessage(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(window, "postMessage");
}

/**
 * Simulates content-relay.content.ts's own response `postMessage` back to
 * page-bridge-firefox. Dispatched as a manually constructed `MessageEvent`
 * (with explicit `source`/`origin` init-dict fields) rather than a real
 * `window.postMessage()` call -- see page-bridge.test.ts's identical helper
 * for the full jsdom-`postMessage`-quirk rationale.
 */
function dispatchRelayResponse(envelope: PageBridgeResponseEnvelope): void {
  window.dispatchEvent(new MessageEvent("message", { data: envelope, origin: location.origin, source: window }));
}

function lastRequestEnvelope(spy: ReturnType<typeof vi.spyOn>): PageBridgeRequestEnvelope {
  const call = spy.mock.calls.at(-1);
  if (!call) {
    throw new Error("page-bridge-firefox never called window.postMessage");
  }
  return call[0] as PageBridgeRequestEnvelope;
}

beforeEach(() => {
  installFakeCredentialsContainer();
  // Fresh registration per test, patching THIS test's fake container.
  pageBridgeFirefox.main();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (document as unknown as { featurePolicy?: unknown }).featurePolicy;
  delete (document as unknown as { permissionsPolicy?: unknown }).permissionsPolicy;
  delete (document.documentElement as HTMLElement).dataset.pvCeremonyInFlight;
});

describe("response-direction MAIN-world re-materialization (Firefox Xray hole fix)", () => {
  /** Constructs a real ArrayBuffer filled with `bytes` using a DIFFERENT
   * jsdom realm's own `ArrayBuffer`/`Uint8Array` constructors (a hidden
   * iframe's `contentWindow`) -- `result instanceof ArrayBuffer` is `false`
   * against THIS file's `ArrayBuffer` global, exactly mirroring the real
   * Firefox ISOLATED-world(content-relay.content.ts)->MAIN-world
   * (page-bridge-firefox.ts) `window.postMessage` hop this fix addresses.
   * Copied verbatim from content-relay.test.ts's own helper of the same
   * name (that file's own "cross-realm ArrayBuffer detection" describe
   * block), per this project's per-file-owns-its-test-helpers convention. */
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
    if (buffer instanceof ArrayBuffer) {
      throw new Error("test setup bug: crossRealmArrayBuffer is same-realm, not cross-realm");
    }
    return buffer as unknown as ArrayBuffer;
  }

  function b64url(bytes: number[]): string {
    return Buffer.from(bytes).toString("base64url");
  }

  it("re-materializes credential.rawId as a MAIN-world-native ArrayBuffer with byte-exact contents (get() flow)", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    const rawIdBytes = [1, 2, 3, 4, 5, 6, 7, 8];
    const clientDataJSONBytes = Array.from(new TextEncoder().encode(JSON.stringify({ type: "webauthn.get" })));

    dispatchRelayResponse({
      source: "pv-content-relay",
      nonce,
      kind: "credential",
      credential: {
        id: "cred-xray-1",
        type: "public-key",
        rawId: crossRealmArrayBuffer(rawIdBytes),
        response: { clientDataJSON: crossRealmArrayBuffer(clientDataJSONBytes) },
      },
      credentialJson: {
        id: "cred-xray-1",
        rawId: b64url(rawIdBytes),
        type: "public-key",
        response: { clientDataJSON: b64url(clientDataJSONBytes) },
      },
    });

    const result = (await promise) as unknown as {
      rawId: ArrayBuffer;
      response: { clientDataJSON: ArrayBuffer };
    };

    // The RESOLVED credential is checked in THIS test file's own realm --
    // a merely-passed-through cross-realm value would fail this exact
    // assertion (the same signature the debug doc's own real-Firefox
    // evidence used: instanceof false pre-fix, true post-fix).
    expect(result.rawId instanceof ArrayBuffer).toBe(true);
    expect(Array.from(new Uint8Array(result.rawId))).toEqual(rawIdBytes);

    expect(result.response.clientDataJSON instanceof ArrayBuffer).toBe(true);
    expect(Array.from(new Uint8Array(result.response.clientDataJSON))).toEqual(clientDataJSONBytes);
  });

  it("re-materializes response.authenticatorData and response.signature as MAIN-world-native ArrayBuffers (get()'s own RESPONSE_BINARY_FIELDS entries beyond clientDataJSON)", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    const authenticatorDataBytes = [11, 22, 33, 44];
    const signatureBytes = [55, 66, 77];

    dispatchRelayResponse({
      source: "pv-content-relay",
      nonce,
      kind: "credential",
      credential: {
        id: "cred-authdata-sig",
        type: "public-key",
        rawId: crossRealmArrayBuffer([1]),
        response: {
          clientDataJSON: crossRealmArrayBuffer([2]),
          authenticatorData: crossRealmArrayBuffer(authenticatorDataBytes),
          signature: crossRealmArrayBuffer(signatureBytes),
        },
      },
      credentialJson: {
        id: "cred-authdata-sig",
        rawId: b64url([1]),
        type: "public-key",
        response: {
          clientDataJSON: b64url([2]),
          authenticatorData: b64url(authenticatorDataBytes),
          signature: b64url(signatureBytes),
        },
      },
    });

    const result = (await promise) as unknown as {
      response: { authenticatorData: ArrayBuffer; signature: ArrayBuffer };
    };

    expect(result.response.authenticatorData instanceof ArrayBuffer).toBe(true);
    expect(Array.from(new Uint8Array(result.response.authenticatorData))).toEqual(authenticatorDataBytes);
    expect(result.response.signature instanceof ArrayBuffer).toBe(true);
    expect(Array.from(new Uint8Array(result.response.signature))).toEqual(signatureBytes);
  });

  it("a field credentialJson does not cover (id/type) still passes through unchanged from credential -- the fix is additive, not a full-object replacement", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.get({ publicKey: { rpId: "example.com" } } as CredentialRequestOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    const rawIdBytes = [9, 9, 9, 9];

    dispatchRelayResponse({
      source: "pv-content-relay",
      nonce,
      kind: "credential",
      credential: {
        id: "cred-passthrough",
        type: "public-key",
        rawId: crossRealmArrayBuffer(rawIdBytes),
        response: { clientDataJSON: crossRealmArrayBuffer([1, 2, 3]) },
      },
      // credentialJson deliberately omits `id`/`type` -- neither field is
      // covered by shapeCredential()'s rematerialization, so both must
      // fall through untouched from `credential`, layered by `{...cred, ...}`.
      credentialJson: {
        rawId: b64url(rawIdBytes),
        response: { clientDataJSON: b64url([1, 2, 3]) },
      },
    });

    const result = (await promise) as unknown as { id: string; type: string };
    expect(result.id).toBe("cred-passthrough");
    expect(result.type).toBe("public-key");
  });

  it("re-materializes response.attestationObject as a MAIN-world-native ArrayBuffer (create() flow -- the field get() does not exercise)", async () => {
    const postSpy = spyOnOutgoingPostMessage();
    const promise = navigator.credentials.create({
      publicKey: { rp: { id: "example.com" } },
    } as CredentialCreationOptions);
    const nonce = lastRequestEnvelope(postSpy).nonce;

    const attestationObjectBytes = [10, 20, 30, 40, 50];

    dispatchRelayResponse({
      source: "pv-content-relay",
      nonce,
      kind: "credential",
      credential: {
        id: "cred-attestation",
        type: "public-key",
        rawId: crossRealmArrayBuffer([1]),
        response: {
          clientDataJSON: crossRealmArrayBuffer([2]),
          attestationObject: crossRealmArrayBuffer(attestationObjectBytes),
        },
      },
      credentialJson: {
        id: "cred-attestation",
        rawId: b64url([1]),
        type: "public-key",
        response: {
          clientDataJSON: b64url([2]),
          attestationObject: b64url(attestationObjectBytes),
        },
      },
    });

    const result = (await promise) as unknown as {
      response: { attestationObject: ArrayBuffer };
    };

    expect(result.response.attestationObject instanceof ArrayBuffer).toBe(true);
    expect(Array.from(new Uint8Array(result.response.attestationObject))).toEqual(attestationObjectBytes);
  });
});
