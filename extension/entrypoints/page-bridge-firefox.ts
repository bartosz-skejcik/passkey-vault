// entrypoints/page-bridge-firefox.ts — the Firefox MAIN-world, key-free
// `navigator.credentials` RPC shim (Phase 12, Plan 12-03). Firefox's MV2
// content-script schema has no declarative `world: 'MAIN'` field (D-17,
// Research Architecture Pattern 3) -- WXT's own recommended workaround is
// an "unlisted script" asset (`defineUnlistedScript`, no `matches`/`world`
// of its own) injected manually into the page's real MAIN world, called
// from content-relay.content.ts's Firefox-only branch (Task 2's wiring) and
// served from `web_accessible_resources` (`extension/wxt.config.ts`, Task
// 2). Injection mechanism: `injectPageBridgeFirefoxScript()` (a small local
// function in content-relay.content.ts, NOT WXT's own `injectScript()`
// helper) sets `script.src = browser.runtime.getURL(...)` -- fixed by debug
// session .planning/debug/resolved/firefox-injection-csp-blocked.md after
// discovering WXT's `injectScript()` picks an INLINE `script.text` strategy
// for MV2 builds, which a strict page CSP (`script-src-elem`) blocks; a
// `.src`-based moz-extension:// load of the same resource is not blocked
// (confirmed live, real Firefox + a CSP-strict fixture page).
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
// injection call and `wxt.config.ts`'s `web_accessible_resources`.
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
import { ACK_TIMEOUT_MS, EXTENSION_AUTHORITY_TIMEOUT_MS } from "../lib/messaging/ceremony-timeouts";

const REQUEST_SOURCE = "pv-page-bridge";
const RESPONSE_SOURCE = "pv-content-relay";

// CR-03 completion (12-REVIEW.md re-review, Plan 12-06): see
// page-bridge.content.ts's identical constants for the full rationale --
// the early-ack handshake (content-relay.content.ts's `postAck`) makes the
// extension the sole fallthrough authority once it accepts a request, so
// this file no longer races a single fixed interaction-budget timeout
// against the background's own (additive, ~240s worst case) unlock-wait/
// consent-await ceilings.
// ACK_TIMEOUT_MS / EXTENSION_AUTHORITY_TIMEOUT_MS are imported from the shared
// lib/messaging/ceremony-timeouts module (single source of truth; CR-03
// invariant guarded by ceremony-timeouts.test.ts).

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

/** Minimal window-shape this file actually reads for the WR-01
 * delegation-aware fallback -- see page-bridge.content.ts's identical
 * type/rationale (this file duplicates the patch logic verbatim, per this
 * file's own header comment). */
interface FrameContext {
  top: unknown;
  self: unknown;
  location: { origin: string };
}

/** WR-01 fix (12-REVIEW.md, Plan 12-05): see page-bridge.content.ts's
 * identical function for the full rationale. This is the branch Firefox
 * (which implements neither `permissionsPolicy` nor `featurePolicy`, so
 * this fallback fires on EVERY ceremony there, not just occasionally)
 * previously fell into unconditionally, blanket-failing open -- D-20(b)
 * was therefore silently a no-op on the entire Firefox surface until this
 * fix. */
function isBlockedByDelegationDefault(frame: FrameContext): boolean {
  if (frame.top === frame.self) {
    return false; // top-level document -- always has the feature.
  }
  try {
    const top = frame.top as { location?: { origin?: unknown } } | null | undefined;
    return top?.location?.origin !== frame.location.origin;
  } catch {
    return true; // cross-origin access threw -- definitely not same-origin.
  }
}

/**
 * D-20(b): respects `Permissions-Policy: publickey-credentials-create/get`
 * BEFORE brokering a ceremony -- silently brokering past a page's own
 * Permissions-Policy is exactly the 1Password-wrapper vulnerability class
 * (Scott Helme 2024/25). Tries the current `document.permissionsPolicy`
 * API first, falls back to the older `document.featurePolicy`, and -- WR-01
 * fix -- applies `isBlockedByDelegationDefault` (never a blanket
 * fail-open) when neither detection API exists in this context (routine on
 * Firefox) OR the query itself throws. `frame` defaults to the real
 * `window` in production; exported (this file's only named export, D-02 --
 * no new import surface) SOLELY so tests can simulate a sub-frame/
 * cross-origin-top scenario without needing to redefine jsdom's own
 * non-configurable `window.top`.
 */
export function isPermissionsPolicyBlocked(
  kind: "create" | "get",
  frame: FrameContext = window,
): boolean {
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
    // Detection itself failed -- fall through to the delegation-aware
    // default below, same as "neither API exists".
  }
  return isBlockedByDelegationDefault(frame);
}

/** Sends the ceremony request to content-relay.content.ts and awaits a
 * single matching-nonce TERMINAL response. See page-bridge.content.ts's
 * identical function for the full two-phase (`ACK_TIMEOUT_MS` ->
 * `EXTENSION_AUTHORITY_TIMEOUT_MS`) rationale -- this file duplicates the
 * patch logic verbatim, per this file's own header comment. */
function relay(
  kind: "credentials.create" | "credentials.get",
  publicKey: unknown,
): Promise<PageBridgeResponseEnvelope | null> {
  return new Promise((resolve) => {
    // quick-260720-16k: set SYNCHRONOUSLY, before the async postMessage hop
    // below even starts -- content-relay.content.ts's Surface A/B guards
    // read this DOM marker (in addition to their existing
    // passkeyCeremonyInFlight JS flag, which is only set AFTER a postMessage
    // round-trip lands) so a page's login-autofill overlay is suppressed
    // from the SAME synchronous tick this ceremony was intercepted in,
    // closing the real async gap a focusin/DOMContentLoaded-timed mount
    // could otherwise race ahead of. A plain DOM attribute, not a JS
    // variable, because MAIN-world (this file) and ISOLATED-world
    // (content-relay.content.ts) content scripts share the same DOM but not
    // the same JS heap. Mirrors page-bridge.content.ts's relay() verbatim,
    // per this file's own header comment.
    document.documentElement.dataset.pvCeremonyInFlight = "1";
    const nonce = crypto.randomUUID();
    let settled = false;
    let acked = false;
    let timeoutId: number;

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
      if (data.kind === "ack") {
        if (acked || settled) {
          return; // duplicate/late ack -- ignored
        }
        acked = true;
        window.clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => finish(null), EXTENSION_AUTHORITY_TIMEOUT_MS);
        return;
      }
      finish(data as PageBridgeResponseEnvelope);
    }

    timeoutId = window.setTimeout(() => finish(null), ACK_TIMEOUT_MS);
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

/** Firefox-only MAIN-world response-direction re-materialization (Plan
 * 14-02, `.planning/debug/resolved/firefox-request-xray-hole.md`'s
 * response-direction follow-up): content-relay.content.ts's
 * `decodeCredentialResponseJson()` already builds real `ArrayBuffer`s for
 * every response-direction binary field (D-21), born in the ISOLATED-world
 * realm and delivered to this file across the ISOLATED->MAIN
 * `window.postMessage` hop (a structured-clone transfer, which preserves
 * genuine `ArrayBuffer`-ness). A live-Firefox differential investigation
 * (debug doc Evidence entries timestamped 2026-07-20T11:10:00Z and
 * 2026-07-20T11:30:00Z) found the ORIGINAL `instanceof ArrayBuffer: false`
 * signal that motivated this fix was itself an artifact of the WebDriver/
 * geckodriver `executeScript` measurement technique used to observe it --
 * a genuine RP page's own bundled/inline JS (verified via an actual inline
 * `<script>` fixture, no WebDriver `executeScript` involved) correctly
 * sees `instanceof ArrayBuffer: true` for these fields even WITHOUT this
 * function, both before and after this commit. This re-materialization is
 * kept anyway as a defense-in-depth, architecture-symmetric measure (it
 * mirrors the already-shipped REQUEST-direction fix's own MAIN-world
 * re-materialization pattern, costs nothing at runtime, and removes any
 * remaining dependency on postMessage's cross-realm structured-clone
 * behavior continuing to preserve `ArrayBuffer` identity across Firefox
 * versions) -- see the 11:30:00Z Evidence entry for the full investigation
 * and its "keep as defense-in-depth" rationale. Copied verbatim from
 * content-relay.content.ts's own `b64UrlToArrayBuffer` (same algorithm),
 * but executed against THIS file's own native `atob`/`Uint8Array`/
 * `ArrayBuffer` globals -- native-globals-only, so this addition cannot
 * trip `scripts/audit-mainworld-boundary.sh`'s FORBIDDEN-import regex. */
function b64UrlToArrayBuffer(b64url: string): ArrayBuffer {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const paddingNeeded = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + "=".repeat(paddingNeeded));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Mirrors content-relay.content.ts's own `RESPONSE_BINARY_FIELDS` list
 * (`response.*` binary fields `decodeCredentialResponseJson` decodes) --
 * kept in sync manually, per this file's own header comment on why the
 * ~70-line patch is duplicated rather than shared. */
const RESPONSE_BINARY_FIELDS = ["clientDataJSON", "attestationObject", "authenticatorData", "signature", "publicKey"];

/**
 * Shapes content-relay's already-decoded `credential` (real ArrayBuffers,
 * D-21) into a plain object satisfying `PublicKeyCredential`'s enumerable
 * contract. See page-bridge.content.ts's identical function for the full
 * rationale (no public `PublicKeyCredential` constructor exists for page
 * script to use).
 *
 * Firefox-only addition (see `b64UrlToArrayBuffer`'s header comment above):
 * every response-direction binary field is ALSO re-decoded here, straight
 * from `credentialJson`'s already-available base64url STRING form (never
 * from `credential`'s ISOLATED-decoded `ArrayBuffer` values, whose realm
 * identity is what's broken), using the MAIN-world-native
 * `b64UrlToArrayBuffer` above -- the resulting `ArrayBuffer`s are genuinely
 * born in THIS realm, so `instanceof ArrayBuffer` resolves correctly for
 * the page. Purely additive: only decodes a field when `credentialJson`'s
 * corresponding value is a `string` (mirrors `decodeCredentialResponseJson`'s
 * own `typeof === "string"` guard), and layers over `{...cred, ...}` so any
 * field `credentialJson` does not cover still falls back to `credential`'s
 * existing value. No inner try/catch -- `broker()`'s existing outer
 * try/catch already wraps this call site and falls through to native
 * `original(options)` on any thrown error (a malformed/spoofed
 * `credentialJson` field making `atob`/`new Uint8Array` throw), matching
 * the already-accepted IN-01/Pitfall-5 fail-safe precedent.
 */
function shapeCredential(
  credential: unknown,
  credentialJson: unknown,
): Credential {
  const cred = (credential ?? {}) as Record<string, unknown>;
  const extensionResults = (cred.clientExtensionResults as Record<string, unknown>) ?? {};

  const json = (credentialJson ?? {}) as Record<string, unknown>;
  const rematerialized: Record<string, unknown> = {};

  if (typeof json.rawId === "string") {
    rematerialized.rawId = b64UrlToArrayBuffer(json.rawId);
  }

  if (typeof json.response === "object" && json.response !== null) {
    const jsonResponse = json.response as Record<string, unknown>;
    const existingResponse = (cred.response as Record<string, unknown>) ?? {};
    const rematerializedResponse: Record<string, unknown> = { ...existingResponse };
    for (const field of RESPONSE_BINARY_FIELDS) {
      if (typeof jsonResponse[field] === "string") {
        rematerializedResponse[field] = b64UrlToArrayBuffer(jsonResponse[field] as string);
      }
    }
    if (typeof jsonResponse.userHandle === "string") {
      rematerializedResponse.userHandle = b64UrlToArrayBuffer(jsonResponse.userHandle as string);
    }
    rematerialized.response = rematerializedResponse;
  }

  const jsonExtResults = json.clientExtensionResults;
  if (typeof jsonExtResults === "object" && jsonExtResults !== null) {
    const jsonPrf = (jsonExtResults as Record<string, unknown>).prf;
    if (typeof jsonPrf === "object" && jsonPrf !== null) {
      const jsonResults = (jsonPrf as Record<string, unknown>).results;
      if (typeof jsonResults === "object" && jsonResults !== null) {
        const r = jsonResults as Record<string, unknown>;
        const existingPrf = (extensionResults.prf as Record<string, unknown>) ?? {};
        const existingResults = (existingPrf.results as Record<string, unknown>) ?? {};
        const rematerializedResults: Record<string, unknown> = { ...existingResults };
        for (const field of ["first", "second"]) {
          if (typeof r[field] === "string") {
            rematerializedResults[field] = b64UrlToArrayBuffer(r[field] as string);
          }
        }
        rematerialized.clientExtensionResults = {
          ...extensionResults,
          prf: { ...existingPrf, results: rematerializedResults },
        };
      }
    }
  }

  const mergedExtensionResults =
    (rematerialized.clientExtensionResults as Record<string, unknown>) ?? extensionResults;

  return {
    ...cred,
    ...rematerialized,
    getClientExtensionResults: () => mergedExtensionResults,
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
