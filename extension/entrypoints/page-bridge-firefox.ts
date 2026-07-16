// entrypoints/page-bridge-firefox.ts — the Firefox MAIN-world, key-free
// `navigator.credentials` RPC shim (Phase 12, Plan 12-03). Firefox's MV2
// content-script schema has no declarative `world: 'MAIN'` field (D-17,
// Research Architecture Pattern 3) -- WXT's own recommended workaround is
// an "unlisted script" asset (`defineUnlistedScript`, no `matches`/`world`
// of its own) injected manually into the page's real MAIN world via
// `injectScript()`, called from content-relay.content.ts's Firefox-only
// branch (Task 2's wiring) and served from
// `web_accessible_resources` (`extension/wxt.config.ts`, Task 2).
//
// NAMING DEVIATION (Rule 1, blocking-issue fix): the plan's own file list
// names this file `page-bridge.ts`. WXT's entrypoint auto-discovery derives
// an entrypoint's NAME from the string before the first `.`/`/` in its path
// -- `page-bridge.ts` and `page-bridge.content.ts` BOTH derive the name
// "page-bridge", and `npx wxt prepare`/`wxt build` refuses with "Multiple
// entrypoints with the same name detected" (verified empirically against
// the pinned WXT 0.20.27 at execution time -- not assumed). Renamed to
// `page-bridge-firefox.ts` (name-derivation boundary is the FIRST dot, so a
// hyphen keeps this a single, non-colliding entrypoint name). Referenced
// consistently as `/page-bridge-firefox.js` in content-relay.content.ts's
// `injectScript()` call and `wxt.config.ts`'s `web_accessible_resources`.
//
// Twin file: `entrypoints/page-bridge.content.ts` (Task 1) is the Chrome
// declarative `world:'MAIN'` variant with IDENTICAL patch logic. Both
// files must independently satisfy the D-02/PROV-05 grep-audit
// (scripts/audit-mainworld-boundary.sh, Task 3) -- this file imports
// NOTHING beyond the two typed envelope interfaces from
// lib/messaging/page-protocol.ts, exactly like its Chrome twin. The
// ~70-line patch below is duplicated verbatim rather than factored into a
// shared module (see page-bridge.content.ts's own header comment for the
// rationale) -- if you change the patch logic here, mirror the change
// there too.
import { defineUnlistedScript } from "wxt/utils/define-unlisted-script";
import type { PageBridgeRequestEnvelope, PageBridgeResponseEnvelope } from "../lib/messaging/page-protocol";

const REQUEST_SOURCE = "pv-page-bridge";
const RESPONSE_SOURCE = "pv-content-relay";

// D-09: see page-bridge.content.ts's identical constant for the full
// rationale -- 5000ms, this plan's own resolution of CONTEXT.md's open
// "popup-await timeout" discretion item.
const RESPONSE_TIMEOUT_MS = 5000;

const PERMISSIONS_POLICY_FEATURE: Record<"create" | "get", string> = {
  create: "publickey-credentials-create",
  get: "publickey-credentials-get",
};

/** Non-standard/experimental Permissions-Policy JS surfaces -- neither
 * `document.permissionsPolicy` (the current spec name) nor its predecessor
 * `document.featurePolicy` are in TypeScript's `lib.dom.d.ts` yet, so this
 * loosely-typed shape is declared locally rather than widening `Document`
 * globally. */
interface AllowsFeatureApi {
  allowsFeature(feature: string): boolean;
}

/**
 * D-20(b): respects `Permissions-Policy: publickey-credentials-create/get`
 * BEFORE brokering a ceremony -- silently brokering past a page's own
 * Permissions-Policy is exactly the 1Password-wrapper vulnerability class
 * (Scott Helme 2024/25). Tries the current `document.permissionsPolicy`
 * API first, falls back to the older `document.featurePolicy`, and FAILS
 * OPEN (returns `false`, i.e. "not blocked") when neither detection API
 * exists in this context -- Firefox in particular is not known to
 * implement either as of this research date, so this branch is expected
 * to fail open here routinely; the browser's own native
 * `navigator.credentials.create/get` call still enforces the real policy
 * for us if one applies.
 */
function isPermissionsPolicyBlocked(kind: "create" | "get"): boolean {
  const feature = PERMISSIONS_POLICY_FEATURE[kind];
  try {
    const doc = document as unknown as {
      permissionsPolicy?: AllowsFeatureApi;
      featurePolicy?: AllowsFeatureApi;
    };
    if (doc.permissionsPolicy && typeof doc.permissionsPolicy.allowsFeature === "function") {
      return doc.permissionsPolicy.allowsFeature(feature) === false;
    }
    if (doc.featurePolicy && typeof doc.featurePolicy.allowsFeature === "function") {
      return doc.featurePolicy.allowsFeature(feature) === false;
    }
  } catch {
    // Detection itself failed -- fail open, see doc comment above.
  }
  return false;
}

/** Sends the ceremony request to content-relay.content.ts and awaits a
 * single matching-nonce response, bounded by RESPONSE_TIMEOUT_MS (D-09).
 * Resolves `null` on timeout -- the caller treats `null` identically to an
 * explicit `"fallthrough"`/`"error"` response (D-11: never a dead-ended
 * promise, never a new error type the page didn't trigger itself). */
function relay(
  kind: "credentials.create" | "credentials.get",
  publicKey: unknown,
): Promise<PageBridgeResponseEnvelope | null> {
  return new Promise((resolve) => {
    const nonce = crypto.randomUUID();
    let settled = false;

    function cleanup(): void {
      window.clearTimeout(timeoutId);
      window.removeEventListener("message", onMessage);
    }

    function finish(value: PageBridgeResponseEnvelope | null): void {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }

    function onMessage(event: MessageEvent): void {
      // D-03/ASVS V5: only a same-window, same-origin message shaped
      // exactly like content-relay's own response envelope, matching THIS
      // call's nonce, is ever accepted.
      if (event.source !== window || event.origin !== location.origin) {
        return;
      }
      const data = event.data as Partial<PageBridgeResponseEnvelope> | null | undefined;
      if (
        typeof data !== "object" ||
        data === null ||
        data.source !== RESPONSE_SOURCE ||
        data.nonce !== nonce
      ) {
        return;
      }
      finish(data as PageBridgeResponseEnvelope);
    }

    const timeoutId = window.setTimeout(() => finish(null), RESPONSE_TIMEOUT_MS);
    window.addEventListener("message", onMessage);

    const request: PageBridgeRequestEnvelope = {
      source: REQUEST_SOURCE,
      nonce,
      kind,
      origin: location.origin,
      publicKey,
    };
    // D-03: target origin is ALWAYS location.origin, never '*'.
    window.postMessage(request, location.origin);
  });
}

/**
 * Shapes content-relay's already-decoded `credential` (real ArrayBuffers,
 * D-21) into a plain object satisfying `PublicKeyCredential`'s enumerable
 * contract. See page-bridge.content.ts's identical function for the full
 * rationale (no public `PublicKeyCredential` constructor exists for page
 * script to use).
 */
function shapeCredential(
  credential: unknown,
  credentialJson: unknown,
): Credential {
  const cred = (credential ?? {}) as Record<string, unknown>;
  const extensionResults = (cred.clientExtensionResults as Record<string, unknown>) ?? {};
  return {
    ...cred,
    getClientExtensionResults: () => extensionResults,
    toJSON: () => credentialJson,
  } as unknown as Credential;
}

/** `original` is deliberately loosely typed (`unknown` options in, real
 * result out) -- `installPatch()` below always pairs it correctly with a
 * matching `options` shape at each call site (create with
 * `CredentialCreationOptions`, get with `CredentialRequestOptions`); trying
 * to express that pairing as a single intersection parameter type produces
 * an unsound signature (a value typed as ONLY `CredentialRequestOptions`
 * does not actually satisfy `CredentialCreationOptions`'s required fields
 * too), so this internal helper accepts the union of both instead. */
async function broker(
  kind: "create" | "get",
  options: CredentialCreationOptions | CredentialRequestOptions | undefined,
  original: (options?: CredentialCreationOptions | CredentialRequestOptions) => Promise<Credential | null>,
): Promise<Credential | null> {
  try {
    const publicKey = (options as { publicKey?: unknown } | undefined)?.publicKey;
    if (publicKey === undefined) {
      return original(options);
    }

    const messageKind = kind === "create" ? "credentials.create" : "credentials.get";
    if (isPermissionsPolicyBlocked(kind)) {
      return original(options);
    }

    const response = await relay(messageKind, publicKey);
    if (response === null || response.kind !== "credential") {
      return original(options);
    }

    return shapeCredential(response.credential, response.credentialJson);
  } catch {
    return original(options);
  }
}

/**
 * Installs the patch. D-20(a): the accessor is installed via
 * `Object.defineProperty` with `configurable: false` (see
 * page-bridge.content.ts's identical function for the full Chromium
 * bug 634381 rationale -- applies equally on Firefox as a defense against
 * any racing page script). Native refs are captured BEFORE the patch is
 * installed (D-11/D-12).
 */
function installPatch(): void {
  let originalCreate: CredentialsContainer["create"];
  let originalGet: CredentialsContainer["get"];
  try {
    originalCreate = navigator.credentials.create.bind(navigator.credentials);
    originalGet = navigator.credentials.get.bind(navigator.credentials);
  } catch {
    return;
  }

  try {
    Object.defineProperty(navigator.credentials, "create", {
      configurable: false,
      enumerable: true,
      writable: false,
      value: (options?: CredentialCreationOptions) =>
        broker(
          "create",
          options,
          originalCreate as (
            options?: CredentialCreationOptions | CredentialRequestOptions,
          ) => Promise<Credential | null>,
        ),
    });
    Object.defineProperty(navigator.credentials, "get", {
      configurable: false,
      enumerable: true,
      writable: false,
      value: (options?: CredentialRequestOptions) =>
        broker(
          "get",
          options,
          originalGet as (
            options?: CredentialCreationOptions | CredentialRequestOptions,
          ) => Promise<Credential | null>,
        ),
    });
  } catch {
    // Already non-configurable (another party got here first) -- fail
    // safe, leave the environment untouched (D-12 coexistence).
  }
}

export default defineUnlistedScript(() => {
  installPatch();
});
