// entrypoints/page-bridge.content.ts — the Chrome MAIN-world, key-free
// `navigator.credentials` RPC shim (Phase 12, Plan 12-03). This is the
// phase's single highest-severity file: it runs in the SAME JS context as
// the (potentially hostile) page, sharing its globals -- 12-CONTEXT.md's
// D-02/PROV-05 boundary is enforced here by construction, not just by
// convention: this file imports NOTHING beyond the two typed envelope
// interfaces from lib/messaging/page-protocol.ts (verified by
// scripts/audit-mainworld-boundary.sh, Task 3). No WASM bindings, no
// soft-authenticator crate bindings, no crypto or vault modules -- this
// file never holds live key material, PRF output, or the unwrapped User
// Key, even transiently. It only relays opaque, already-serialized
// ceremony data across `window.postMessage` to content-relay.content.ts
// (Task 3), which does the actual base64url encode/decode (D-21) and talks
// to the background.
//
// D-17 (cross-browser, Research Architecture Pattern 3): WXT's declarative
// `world: 'MAIN'` content-script field is Chrome-only. `exclude: ['firefox']`
// below means WXT never even generates a Firefox manifest entry for this
// file -- the Firefox variant is `page-bridge-firefox.ts` (Task 2), an
// unlisted script asset injected manually via `injectScript()` from
// content-relay.content.ts, since Firefox's MV2 content-script schema has
// no `world` field at all. (Named `page-bridge-firefox.ts`, not the plan's
// literal `page-bridge.ts`, to avoid an entrypoint-name collision with THIS
// file -- see that file's own header comment for the full rationale.)
//
// Twin file: `entrypoints/page-bridge-firefox.ts` (Task 2) contains the IDENTICAL
// patch logic for Firefox. Both files must independently satisfy the
// D-02 grep-audit, so the ~70-line patch below is duplicated verbatim
// rather than factored into a shared module (Task 2's own rationale: a
// third shared file would need its own audit-script entry, and the plan
// prefers duplication over that complexity). If you change the patch logic
// here, mirror the change in page-bridge.ts too.
import { defineContentScript } from "wxt/utils/define-content-script";
import type { PageBridgeRequestEnvelope, PageBridgeResponseEnvelope } from "../lib/messaging/page-protocol";

const REQUEST_SOURCE = "pv-page-bridge";
const RESPONSE_SOURCE = "pv-content-relay";

// CR-03 completion (12-REVIEW.md re-review, Plan 12-06): 12-05's single
// fixed RESPONSE_TIMEOUT_MS (120000ms) was WRONG -- this file's own prior
// comment here claimed the background's `waitForUnlock`/
// `awaitCeremonyConsent` ceilings and this page-side timer formed one
// "shared backstop ceiling," and that a lighter-weight ack was
// "unnecessary complexity." Both claims were incorrect: the background's
// two ceilings are ADDITIVE (waitForUnlock's 120s THEN
// awaitCeremonyConsent's own 120s, ~240s worst case for a locked-vault
// ceremony), strictly longer than this page's single 120s -- so a slow
// locked-vault confirm made the page fall through to native at 120s while
// the background was STILL awaiting the popup, then minted+persisted a
// credential the RP never received (the exact orphan CR-03 was supposed to
// close, still open on that path). The real fix is the early-ack
// handshake: content-relay.content.ts posts a `kind:"ack"` message the
// moment it accepts a request (BEFORE forwarding to the background,
// content-relay.content.ts's `postAck`) -- once that arrives, THIS file
// stops racing a fixed interaction budget entirely and becomes exclusively
// dependent on the extension's own terminal `"credential"`/`"fallthrough"`
// message, which provider-ceremony.ts (background) is guaranteed to
// eventually send (an explicit fallthrough on decline/no-match/error/
// abandon, never a silently-dropped ceremony). Two ceilings now exist for
// two DIFFERENT purposes:
// - `ACK_TIMEOUT_MS`: how long to wait for content-relay to even ACCEPT
//   the request before assuming no relay is reachable (missing extension,
//   non-provider context) and falling through to native -- short, because
//   an ack is a same-tab round trip with no human in it.
// - `EXTENSION_AUTHORITY_TIMEOUT_MS`: once acked, a generous backstop
//   purely against a truly wedged extension listener -- documented as a
//   backstop, NOT an interaction budget, since the extension always sends
//   an explicit terminal message on every real code path.
const ACK_TIMEOUT_MS = 3_000;
const EXTENSION_AUTHORITY_TIMEOUT_MS = 300_000;

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
 * delegation-aware fallback -- `top`/`self` compared by identity,
 * `location.origin` read only for the (same-origin) frame itself; `top`'s
 * `.location.origin` is read defensively inside a try/catch since a real
 * cross-origin ancestor throws a `SecurityError` on that access. */
interface FrameContext {
  top: unknown;
  self: unknown;
  location: { origin: string };
}

/** WR-01 fix (12-REVIEW.md, Plan 12-05): when neither detection API is
 * available, apply the delegation-aware default for
 * `publickey-credentials-create`/`-get` instead of a blanket fail-open --
 * per the Permissions-Policy spec, both features' default allowlist is
 * `"self"`, meaning only the TOP-level document and any SAME-ORIGIN
 * descendant frame have the feature by default; a cross-origin sub-frame
 * does NOT. Returns `false` (not blocked) for the top-level frame or a
 * same-origin sub-frame; `true` (blocked) for a cross-origin sub-frame
 * (including one where merely READING `top.location.origin` throws --
 * exactly what a real cross-origin ancestor does per spec, and itself
 * proof the frame is cross-origin). */
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
 * fail-open) when neither detection API exists in this context OR the
 * query itself throws. `frame` defaults to the real `window` in production;
 * exported (this file's only named export, D-02 -- no new import surface)
 * SOLELY so tests can simulate a sub-frame/cross-origin-top scenario
 * without needing to redefine jsdom's own non-configurable `window.top`.
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
 * single matching-nonce TERMINAL response (`"credential"`/`"fallthrough"`/
 * `"error"` -- never `"ack"`, which is intercepted below and never handed
 * to the caller). CR-03 completion (Plan 12-06): two-phase wait, not one
 * fixed race.
 *
 * Phase A (no ack yet): bounded by `ACK_TIMEOUT_MS`. If no ack (and no
 * terminal message) arrives in that short window -- content-relay
 * unreachable, no extension installed, or this isn't a provider context --
 * `finish(null)` falls through to native promptly (PROV-03, D-11).
 *
 * Phase B (acked): the moment a matching-nonce ack arrives, the Phase A
 * timer is cancelled and the extension becomes the SOLE authority on this
 * ceremony's outcome -- an already-accepted request can NEVER also run
 * native, closing CR-03's orphaned-credential race even on a slow
 * locked-vault confirm. `EXTENSION_AUTHORITY_TIMEOUT_MS` still bounds Phase
 * B, but only as a backstop against a genuinely wedged extension listener
 * (the background always sends an explicit terminal message on every real
 * code path -- decline, abandon-timeout, and genuine failure all resolve
 * to `{fallthrough: true}`/`{failed: true}`), never as an interaction
 * budget. Resolves `null` on either timeout -- the caller treats `null`
 * identically to an explicit `"fallthrough"`/`"error"` response (D-11:
 * never a dead-ended promise, never a new error type the page didn't
 * trigger itself). */
function relay(
  kind: "credentials.create" | "credentials.get",
  publicKey: unknown,
): Promise<PageBridgeResponseEnvelope | null> {
  return new Promise((resolve) => {
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
      // call's nonce, is ever accepted -- everything else (including the
      // page's own scripts trying to inject a fake response) is ignored.
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
          return; // duplicate/late ack -- ignored, Phase B already entered (or already settled)
        }
        acked = true;
        // Phase A -> Phase B: cancel the short no-ack window, switch to the
        // generous wedged-listener backstop, and keep listening -- an ack
        // is never itself a terminal value handed to the caller.
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
    // D-03: target origin is ALWAYS location.origin, never '*' -- this
    // channel is page-readable by any script on the page, so a wildcard
    // target would let a same-tab-but-different-frame observer read it.
    window.postMessage(request, location.origin);
  });
}

/**
 * Shapes content-relay's already-decoded `credential` (real ArrayBuffers,
 * D-21) into a plain object satisfying `PublicKeyCredential`'s enumerable
 * contract (`id`, `rawId`, `type`, `response`, `getClientExtensionResults()`,
 * `toJSON()`). A real `PublicKeyCredential` cannot be constructed directly
 * by page script (WebAuthn has no public constructor for it) -- returning a
 * spec-shaped plain object instead is the same approach Bitwarden/1Password's
 * extensions use, not an oversight. `toJSON()` returns `credentialJson`
 * (the ORIGINAL base64url JSON shape, not the decoded-buffers view) because
 * that is what a real `PublicKeyCredential.toJSON()` returns per spec.
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
      // Not a WebAuthn ceremony (e.g. the page asked for a `password`
      // credential via the unrelated Credential Management API) -- nothing
      // for this provider to broker.
      return original(options);
    }

    const messageKind = kind === "create" ? "credentials.create" : "credentials.get";
    if (isPermissionsPolicyBlocked(kind)) {
      // D-20(b): never broker past a blocking Permissions-Policy -- the
      // native call correctly rejects on its own.
      return original(options);
    }

    const response = await relay(messageKind, publicKey);
    if (response === null || response.kind !== "credential") {
      // Timeout (null), explicit fallthrough, or a relay/ceremony error --
      // D-11: always fall through to the real native result, never a
      // dead-ended promise or a fabricated error.
      return original(options);
    }

    return shapeCredential(response.credential, response.credentialJson);
  } catch {
    // ANY exception inside this wrapper (not from the original call
    // itself) falls through to the original call too -- never propagates a
    // new/different error to the page (D-11).
    return original(options);
  }
}

/**
 * Installs the patch. D-20(a): the accessor is installed via
 * `Object.defineProperty` with `configurable: false` -- `world:'MAIN'` +
 * `document_start` does NOT guarantee running before the page's own inline
 * scripts (Chromium bug 634381, still open), so a plainly-assigned patch
 * could be silently re-defined or restored by a racing page script;
 * non-configurable closes the re-definition half of that race. Native refs
 * are captured BEFORE the patch is installed (D-11/D-12) -- this is what
 * makes fallthrough, and coexistence with another installed
 * password-manager extension, possible at all.
 */
function installPatch(): void {
  let originalCreate: CredentialsContainer["create"];
  let originalGet: CredentialsContainer["get"];
  try {
    originalCreate = navigator.credentials.create.bind(navigator.credentials);
    originalGet = navigator.credentials.get.bind(navigator.credentials);
  } catch {
    // No navigator.credentials at all in this context -- nothing to patch,
    // nothing broken either.
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
    // Object.defineProperty itself threw -- the property is already
    // non-configurable (another party, e.g. a second password manager,
    // got here first). Fail SAFE: leave the environment untouched, native
    // WebAuthn keeps working, this provider simply doesn't serve this page
    // (D-12 coexistence).
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  world: "MAIN",
  runAt: "document_start",
  // D-17: Firefox has no declarative world:'MAIN' -- page-bridge.ts (Task
  // 2) is the Firefox variant, injected manually via injectScript() from
  // content-relay.content.ts. Excluding this entrypoint from the Firefox
  // build entirely (rather than letting it silently degrade to an
  // ineffective ISOLATED-world no-op there) keeps exactly one MAIN-world
  // patch attempt per browser.
  exclude: ["firefox"],
  main() {
    installPatch();
  },
});
