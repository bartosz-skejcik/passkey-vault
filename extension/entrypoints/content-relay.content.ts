// entrypoints/content-relay.content.ts — the ISOLATED-world sensor/writer
// (plan 10-05). This is the phase's ONLY page-touching code: it senses
// which field families are present (content.detect) and writes values it
// is handed by the background (content.fill). It renders nothing, decrypts
// nothing, and imports no crypto module -- 10-CONTEXT.md D-01/D-02 and
// 10-UI-SPEC.md's Scope Note require exactly this: a pure DOM sensor/
// writer with no in-page UI and no key material.
//
// world: 'ISOLATED' is the default -- stated here explicitly so a future
// reader knows MAIN world is deliberately NOT used this phase (D-01).
// allFrames: true gives every subframe its own instance, which is what
// makes the background's per-frame addressing (frame-guard.ts's
// resolveFillTarget()/browser.tabs.sendMessage(tabId, msg, {frameId}))
// meaningful -- without it there would be only one instance per TAB, not
// per FRAME, and a fill addressed to a specific frameId would have no
// dedicated listener to reach.
//
// Do NOT add a MutationObserver-driven auto-detect here. Detection is
// strictly on-demand: it runs only in response to an explicit
// `content.detect` message the popup triggers via the background. A
// page-load- or observer-driven scan that pushed detection results to the
// background on its own would (a) violate the gesture-gate spirit
// (10-CONTEXT.md D-01/D-02) and (b) reintroduce the naive whole-document
// MutationObserver performance trap 10-RESEARCH.md's Pitfall 4 warns
// against. A later phase that needs live re-detection should add a scoped,
// debounced observer then -- this is a deliberate omission, not a gap
// (T-10-21's threat-register disposition is "avoid", not "mitigate").
//
// Plan 10-10 adds the in-page affordance BELOW the original listener
// (untouched -- the popup path keeps working exactly as before). It reuses
// the SAME detectors, drives them through 10-09's frame-scoped
// `autofill.matchFrame`/`autofill.fillFrame` channel (a SEPARATE
// background listener from the one 10-04's popup-driven `autofill.match`/
// `autofill.fill` uses), and mounts `inpage-overlay.ts`'s controller --
// this file itself never renders anything; it only decides WHEN to ask the
// controller to render and WHAT metadata to hand it. Still no
// MutationObserver: Surface A's `focusin` listener is the one guarded,
// lazy re-detect path the architecture note allows.
import { defineContentScript } from "wxt/utils/define-content-script";
import { injectScript } from "wxt/utils/inject-script";
import { browser } from "wxt/browser";
import { detectLogin } from "../lib/autofill/detect-login";
import { detectTotp } from "../lib/autofill/detect-totp";
import { detectCard, detectIdentity } from "../lib/autofill/detect-scored";
import { fillValues, type FillTargets } from "../lib/autofill/fill-dom";
import { createOverlayController, type OverlayController } from "../lib/autofill/inpage-overlay";
import { addBlockedOrigin, isOriginBlocked } from "../lib/autofill/blocked-origins";
import { classifyForm, findPasswordFieldPair } from "../lib/autofill/form-detector";
import {
  mountGenerateTrigger,
  teardownGenerateTrigger,
  getGenerateTriggerHost,
} from "../lib/autofill/generate-popover";
import { attachSubmitWatcher, captureFrameOrigin } from "../lib/autofill/submit-capture";
import { showSaveUpdateToast } from "../lib/autofill/save-update-toast";
import { showMismatchModal } from "../lib/autofill/mismatch-modal";
import { captureThemeFromWebApp } from "../lib/theme/theme-mirror";
import { sendMessage } from "../lib/messaging/ext-protocol";
import type {
  AutofillMatch,
  ContentDetectResponse,
  ContentFillRequest,
  ContentFillResponse,
  DetectedFields,
  FillKind,
} from "../lib/autofill/types";
import type { PageBridgeRequestEnvelope, PageBridgeResponseEnvelope } from "../lib/messaging/page-protocol";

/**
 * Runs every detector fresh against the current `document` and reduces
 * each result to a boolean -- the response NEVER carries a field's value,
 * only which field families were found present (T-10-18, FILL-01's
 * flagged prohibition: this module is a one-way writer, never a value
 * reader-back). Recomputes on every call; nothing is cached across
 * messages, since an SPA may have re-rendered the page between two
 * `content.detect` requests (10-RESEARCH.md D-10).
 */
function detectAll(): ContentDetectResponse {
  const login = detectLogin(document);
  const totpField = detectTotp(document);
  const card = detectCard(document);
  const identity = detectIdentity(document);

  const detected: DetectedFields = {
    login: login !== null,
    totp: totpField !== null,
    card: card.hasAny,
    identity: identity.hasAny,
  };

  return { detected, hasOtpField: totpField !== null };
}

/**
 * Re-runs the relevant detector NOW, at fill time, to resolve LIVE target
 * elements -- a `content.fill` message never reuses target elements a
 * prior `content.detect` call may have resolved, since the DOM may have
 * changed (SPA re-render) between the two round trips. Returns null only
 * for an unrecognized `kind`, which cannot happen through the typed
 * `FillValues` union in practice (defensive exhaustiveness only).
 */
function resolveFillTargets(kind: FillKind): FillTargets | null {
  switch (kind) {
    case "login": {
      const login = detectLogin(document);
      return { type: "login", username: login?.username ?? null, password: login?.password ?? null };
    }
    case "totp": {
      const code = detectTotp(document);
      return { type: "totp", code };
    }
    case "card": {
      const card = detectCard(document);
      return {
        type: "card",
        cardholderName: card.cardholderName,
        number: card.number,
        cvv: card.cvv,
        expiryMode: card.expiryMode,
        expiry: card.expiry,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
      };
    }
    case "identity": {
      const identity = detectIdentity(document);
      return {
        type: "identity",
        firstName: identity.firstName,
        lastName: identity.lastName,
        email: identity.email,
        phone: identity.phone,
        address: identity.address,
      };
    }
    default:
      return null;
  }
}

// Reads the persisted pv-server base URL directly out of storage.local
// (the SAME "pv-server-config" key entrypoints/background/server-config.ts
// owns as its "SOLE place" write path -- this is a READ-only, best-effort
// mirror, not a second writer, so it does not violate that module's
// invariant or its standing no-hard-coded-URL grep test). A content script
// runs in the ISOLATED world with its own `storage` access (already
// declared in the manifest), so this reads storage.local directly rather
// than round-tripping through the background -- same choke-point-free
// convention lib/autofill/blocked-origins.ts already uses in this file's
// own module.
//
// Purpose: suppress the in-page autofill overlay entirely on the user's
// OWN configured vault web app (Bartek's decision, Group C review) -- it's
// vault management, not a third-party login page, and the overlay's
// top-right prompt overlapped the web app's own controls in UAT. Any parse
// failure (unconfigured server, corrupt storage, non-URL baseUrl) fails
// CLOSED to `false` (never suppress based on a guess).
const SERVER_CONFIG_STORAGE_KEY = "pv-server-config";

export async function isConfiguredServerOrigin(): Promise<boolean> {
  const result = await browser.storage.local.get(SERVER_CONFIG_STORAGE_KEY);
  const value = result[SERVER_CONFIG_STORAGE_KEY];
  if (!value || typeof value !== "object" || typeof (value as { baseUrl?: unknown }).baseUrl !== "string") {
    return false;
  }
  try {
    return new URL((value as { baseUrl: string }).baseUrl).origin === location.origin;
  } catch {
    return false;
  }
}

function isContentDetectRequest(message: unknown): boolean {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { kind?: unknown }).kind === "content.detect"
  );
}

function isContentFillRequest(message: unknown): message is ContentFillRequest {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { kind?: unknown }).kind === "content.fill"
  );
}

/**
 * Element-level counterpart to detectAll() -- WHICH element belongs to
 * WHICH FillKind, not just a boolean per family. Used only by the in-page
 * affordance's `focusin` handler below to decide what Surface A should
 * anchor to and which of this frame's matches to show (D-07's picker is
 * simply "every match of the SAME kind as the focused field" -- no
 * separate dialog). Re-run fresh on every focusin, mirroring
 * resolveFillTargets()'s own fresh-resolve-per-call convention -- an SPA
 * may have re-rendered the form since the last check.
 */
function collectFocusableFields(): Map<Element, FillKind> {
  const map = new Map<Element, FillKind>();

  const login = detectLogin(document);
  if (login) {
    if (login.username) {
      map.set(login.username, "login");
    }
    map.set(login.password, "login");
  }

  const totpField = detectTotp(document);
  if (totpField && !map.has(totpField)) {
    map.set(totpField, "totp");
  }

  const card = detectCard(document);
  for (const el of [card.cardholderName, card.number, card.cvv, card.expiry, card.expiryMonth, card.expiryYear]) {
    if (el && !map.has(el)) {
      map.set(el, "card");
    }
  }

  const identity = detectIdentity(document);
  for (const el of [identity.firstName, identity.lastName, identity.email, identity.phone, identity.address]) {
    if (el && !map.has(el)) {
      map.set(el, "identity");
    }
  }

  return map;
}

// -----------------------------------------------------------------------
// Theme-mirror capture (D-12, plan 11-07). Additive to everything above --
// it never touches content.detect/content.fill's own code path, the
// in-page affordance's overlay state, or submit-capture below.
// -----------------------------------------------------------------------

/**
 * Runs ONLY on the user's own configured pv-server web app -- the SAME
 * isConfiguredServerOrigin() gate that already suppresses the autofill
 * overlay/submit-capture there. Capturing the theme is the ONE job this
 * content script keeps on the vault app itself (D-12: "capture is the one
 * job the content script keeps on the vault app"). A third-party page
 * never has this listener attached at all -- there is nothing there for
 * this extension to mirror the theme OF.
 */
async function initThemeCapture(): Promise<void> {
  if (await isConfiguredServerOrigin()) {
    captureThemeFromWebApp(document);
  }
}

// -----------------------------------------------------------------------
// Submit-capture wiring (plan 11-02). Additive to everything above -- it
// never touches content.detect/content.fill's own code path or the in-page
// affordance's overlay state. Gated the exact same way the overlay already
// is (X-4): the user's own configured vault app and any user-blocked
// origin never get a submit-capture listener at all.
// -----------------------------------------------------------------------

/**
 * Every distinct login/signup container on the page: one per `<form>`
 * ancestor of a password field, or `document.body` for a `<form>`-less SPA
 * container (Pitfall A -- there is no narrower wrapper element this module
 * can reliably infer, so the whole-body fallback is deliberate, not an
 * oversight). Deduplicated via a Set so a form with 2+ password fields
 * (signup) only yields ONE container, not one per field.
 */
function findLoginContainers(): Array<HTMLFormElement | HTMLElement> {
  const passwordInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  const containers = new Set<HTMLFormElement | HTMLElement>();
  for (const pw of passwordInputs) {
    containers.add(pw.closest("form") ?? document.body);
  }
  return Array.from(containers);
}

/**
 * Attaches attachSubmitWatcher() to every login/signup-classified container
 * found on the page, ONLY after both suppression gates pass (X-4, mirrors
 * initialMatchAndPrompt()'s identical isConfiguredServerOrigin()/
 * isOriginBlocked() sequence). Runs once at document_idle -- no
 * MutationObserver-driven re-scan of the whole page for NEW containers
 * (attachSubmitWatcher's OWN internal MutationObserver, scoped to a single
 * already-found container, is a separate and explicitly plan-mandated
 * mechanism -- see submit-capture.ts's header comment).
 */
async function initSubmitCapture(): Promise<void> {
  if (await isConfiguredServerOrigin()) {
    return;
  }
  if (await isOriginBlocked(location.origin)) {
    return;
  }

  for (const container of findLoginContainers()) {
    if (classifyForm(container) === "none") {
      continue;
    }

    attachSubmitWatcher(container, (username, password) => {
      // Plan 11-05's UI response wiring: the ONE integration point tying
      // 11-02's submit-capture output through 11-03's classification into
      // the correct surface. Routes on `response.mismatch` -- `true`
      // ALWAYS goes to mismatch-modal.ts (T-11-14, unconditional on the
      // origin-mismatch flag, including a rare `action:'no-op'` mismatch);
      // `false` goes to save-update-toast.ts, which itself renders nothing
      // for `action:'no-op'` (Pitfall B). A rejected/unhandled response (no
      // listener registered, torn-down extension context, etc.) shows no
      // UI at all -- there is nothing to route without a response.
      const frameOrigin = captureFrameOrigin();
      void sendMessage({ kind: "capture.propose", frameOrigin, username, password })
        .then((response) => {
          if (response.mismatch) {
            showMismatchModal({
              action: response.action,
              itemId: response.itemId,
              currentRevision: response.currentRevision,
              frameOrigin: response.frameOrigin,
              topOrigin: response.topOrigin,
              username,
              password,
            });
          } else {
            showSaveUpdateToast({
              action: response.action,
              itemId: response.itemId,
              currentRevision: response.currentRevision,
              frameOrigin: response.frameOrigin,
              username,
              password,
            });
          }
        })
        .catch(() => {
          // Intentionally ignored -- see comment above.
        });
    });
  }
}

/**
 * D-22: runs `fn` once the document has at least started parsing its body
 * (`readyState !== "loading"`, i.e. `interactive`/`complete`) -- a close
 * approximation of the prior `document_idle` entrypoint timing (browsers
 * inject a document_idle script "between document_end and immediately
 * after window.onload"), now that this whole entrypoint runs at
 * `document_start` instead (D-22's early-listener requirement). If the
 * document is already past "loading" by the time this runs, `fn` executes
 * immediately/synchronously -- no artificial delay is ever added.
 */
function runWhenDocumentReady(fn: () => void): void {
  if (document.readyState !== "loading") {
    fn();
    return;
  }
  document.addEventListener("DOMContentLoaded", fn, { once: true });
}

// -----------------------------------------------------------------------
// Passkey-provider bridge (Phase 12, Plan 12-03). This is content-relay's
// half of the D-01 three-hop bridge: page-bridge.content.ts/page-bridge-firefox.ts
// (MAIN world, key-free) postMessage a WebAuthn ceremony request here;
// this ISOLATED-world listener validates it (D-03/ASVS V5), forwards it to
// the background over the content-frame channel (router.ts,
// registerAutofillFrameChannel()), and relays the response back. This is
// the ONLY place in this file that ever touches base64url encode/decode --
// page-bridge itself stays completely free of any encoding logic (D-21),
// and this file never touches the User Key, PRF output, or any passkey
// private key material -- only opaque, already-encrypted-or-public
// ceremony JSON.
//
// D-21 (base64url boundary): MAIN<->ISOLATED postMessage is
// structured-clone (real ArrayBuffers survive the hop), but the
// ISOLATED->background `runtime.sendMessage` hop JSON-serializes its
// payload (Chrome mangles ArrayBuffer -> `{}`). Every binary field in the
// RP's `PublicKeyCredentialCreationOptions`/`RequestOptions` is therefore
// converted to a base64url STRING (matching the spec's own
// `*OptionsJSON`/response JSON shape, and `passkey_types`' own
// `Vec<u8>`<->base64url convention on the Rust side, crates/pv-provider)
// before `sendMessage`, and every binary field in the background's
// `credentialResponseJson` response is decoded back into a real
// `ArrayBuffer` before being handed back to page-bridge -- which never
// runs a base64 decoder of its own.

const RESPONSE_SOURCE = "pv-content-relay";
const REQUEST_SOURCE = "pv-page-bridge";

// D-03/ASVS V5: single-use, short-lived (30s) nonce ledger -- a replayed
// request nonce (the page trying to resubmit a captured earlier message)
// is silently ignored, never re-forwarded to the background.
const NONCE_TTL_MS = 30_000;
const seenNonces = new Map<string, number>();

// Passkey-priority overlay coordination (Plan 12-07, Bartek live-review
// 2026-07-17): PASSKEY ALWAYS PRIORITY -- when a page runs a WebAuthn
// ceremony through this bridge, the Phase-10 login autofill overlay (Surface
// A field dropdown + Surface B form prompt) must not compete with it. This
// module-level flag/coordinator pair is how the module-level
// `handleProviderPageMessage` below (registered once, at document_start,
// independent of any single `main()` invocation) reaches into the
// `main()`-scoped overlay state without either side needing to know the
// other's internals: `handleProviderPageMessage` only ever calls
// `overlayCoordinator?.hide()`/`.allow()`, and `main()` is the only place
// that assigns what those two calls actually do. `overlayCoordinator` is
// reassigned on every `main()` invocation (mirrors `overlay`/`frameMatches`
// being fresh per invocation); `passkeyCeremonyInFlight` is reset to `false`
// at the top of `main()` too, so a repeated `main()` call (tests; in
// production a content script's main() runs exactly once) never leaks an
// in-flight flag from a torn-down prior instance.
let passkeyCeremonyInFlight = false;
let overlayCoordinator: { hide(): void; allow(): void } | null = null;

function pruneExpiredNonces(now: number): void {
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= now) {
      seenNonces.delete(nonce);
    }
  }
}

function isPageBridgeRequest(data: unknown): data is PageBridgeRequestEnvelope {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const candidate = data as Partial<PageBridgeRequestEnvelope>;
  return (
    candidate.source === REQUEST_SOURCE &&
    typeof candidate.nonce === "string" &&
    candidate.nonce.length > 0 &&
    (candidate.kind === "credentials.create" || candidate.kind === "credentials.get")
  );
}

function isBufferSource(value: unknown): value is BufferSource {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

/** Base64url (no padding), matching `passkey_types`' own WebAuthn JSON
 * encoding on the Rust side (crates/pv-provider) -- deliberately NOT
 * lib/messaging/bytes-b64.ts's `bytesToB64`, which produces STANDARD
 * base64 (`+`/`/`/`=`) and would fail `passkey_types`' deserializer. */
function bufferSourceToB64Url(input: BufferSource): string {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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

interface CredentialDescriptorLike {
  id?: unknown;
  [key: string]: unknown;
}

function encodeCredentialDescriptor(descriptor: unknown): unknown {
  if (typeof descriptor !== "object" || descriptor === null) {
    return descriptor;
  }
  const d = descriptor as CredentialDescriptorLike;
  if (!isBufferSource(d.id)) {
    return descriptor;
  }
  return { ...d, id: bufferSourceToB64Url(d.id) };
}

/** Converts the page's raw `PublicKeyCredentialCreationOptions`/
 * `RequestOptions` (real `ArrayBuffer`/`TypedArray` fields, survived the
 * MAIN<->ISOLATED structured-clone postMessage hop unmodified) into the
 * spec `*OptionsJSON` shape -- base64url strings in place of every binary
 * field -- before this ever reaches `runtime.sendMessage` (D-21). Only the
 * three binary-bearing fields WebAuthn actually defines on these options
 * (`challenge`, `user.id`, `excludeCredentials[].id`/`allowCredentials[].id`)
 * are touched; every other field passes through unchanged. */
function encodePublicKeyOptions(publicKey: unknown): unknown {
  if (typeof publicKey !== "object" || publicKey === null) {
    return publicKey;
  }
  const src = publicKey as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };

  if (isBufferSource(src.challenge)) {
    out.challenge = bufferSourceToB64Url(src.challenge);
  }

  if (typeof src.user === "object" && src.user !== null) {
    const user = src.user as Record<string, unknown>;
    if (isBufferSource(user.id)) {
      out.user = { ...user, id: bufferSourceToB64Url(user.id) };
    }
  }

  if (Array.isArray(src.excludeCredentials)) {
    out.excludeCredentials = src.excludeCredentials.map(encodeCredentialDescriptor);
  }

  if (Array.isArray(src.allowCredentials)) {
    out.allowCredentials = src.allowCredentials.map(encodeCredentialDescriptor);
  }

  // CR-01 fix (12-REVIEW.md): the RP's own `extensions.prf.eval.first`/
  // `.second` (and every `evalByCredential[*].first`/`.second`) are
  // real ArrayBuffer/TypedArray inputs too -- they survive the MAIN<->
  // ISOLATED structured-clone postMessage hop intact, but the SAME
  // ISOLATED->background `runtime.sendMessage` JSON-serialization that
  // motivates every other field above mangles them to `{}` just as
  // surely. Left unencoded, ANY RP that sends PRF `eval` inputs on
  // create()/get() (the primary provider-PRF use case, D-16) fails to
  // even PARSE in the background (`serde_json` rejects `{}` where a
  // base64url string is required) and silently falls through to native.
  // Only these two binary-bearing sub-fields of `extensions.prf` are
  // touched; every other extension (and every other `prf` field, e.g.
  // `results` -- a RESPONSE-side field, never present on a REQUEST) is
  // left untouched.
  if (typeof src.extensions === "object" && src.extensions !== null) {
    const ext = { ...(src.extensions as Record<string, unknown>) };
    const prf = ext.prf as
      | { eval?: Record<string, unknown>; evalByCredential?: Record<string, unknown> }
      | undefined;
    if (prf?.eval) {
      const e = { ...prf.eval };
      if (isBufferSource(e.first)) {
        e.first = bufferSourceToB64Url(e.first);
      }
      if (isBufferSource(e.second)) {
        e.second = bufferSourceToB64Url(e.second);
      }
      ext.prf = { ...prf, eval: e };
    }
    if (prf?.evalByCredential) {
      const byId: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(prf.evalByCredential)) {
        const vv = v as Record<string, unknown>;
        byId[k] = {
          ...vv,
          ...(isBufferSource(vv.first) ? { first: bufferSourceToB64Url(vv.first) } : {}),
          ...(isBufferSource(vv.second) ? { second: bufferSourceToB64Url(vv.second) } : {}),
        };
      }
      ext.prf = { ...(ext.prf as object), evalByCredential: byId };
    }
    out.extensions = ext;
  }

  return out;
}

const RESPONSE_BINARY_FIELDS = ["clientDataJSON", "attestationObject", "authenticatorData", "signature", "publicKey"];

/** Decodes the background's `credentialResponseJson` (a JSON STRING whose
 * binary fields are already base64url per `passkey_types`' own Serialize
 * impl, matching the spec response JSON shape) back into a plain object
 * with REAL `ArrayBuffer`s for `rawId`/`response.*`/PRF results -- the
 * exact reverse of `encodePublicKeyOptions` above (D-21). Returns `null`
 * on any parse failure (malformed JSON from a genuinely broken ceremony,
 * never trusted blindly). */
function decodeCredentialResponseJson(json: string): unknown | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }

  const out: Record<string, unknown> = { ...parsed };

  if (typeof parsed.rawId === "string") {
    out.rawId = b64UrlToArrayBuffer(parsed.rawId);
  }

  if (typeof parsed.response === "object" && parsed.response !== null) {
    const response = parsed.response as Record<string, unknown>;
    const decodedResponse: Record<string, unknown> = { ...response };
    for (const field of RESPONSE_BINARY_FIELDS) {
      if (typeof response[field] === "string") {
        decodedResponse[field] = b64UrlToArrayBuffer(response[field] as string);
      }
    }
    if (typeof response.userHandle === "string") {
      decodedResponse.userHandle = b64UrlToArrayBuffer(response.userHandle as string);
    }
    out.response = decodedResponse;
  }

  const extensionResults = parsed.clientExtensionResults;
  if (typeof extensionResults === "object" && extensionResults !== null) {
    const ext = extensionResults as Record<string, unknown>;
    const prf = ext.prf;
    if (typeof prf === "object" && prf !== null) {
      const prfObj = prf as Record<string, unknown>;
      const results = prfObj.results;
      if (typeof results === "object" && results !== null) {
        const r = results as Record<string, unknown>;
        const decodedResults: Record<string, unknown> = { ...r };
        for (const field of ["first", "second"]) {
          if (typeof r[field] === "string") {
            decodedResults[field] = b64UrlToArrayBuffer(r[field] as string);
          }
        }
        out.clientExtensionResults = { ...ext, prf: { ...prfObj, results: decodedResults } };
      }
    }
  }

  return out;
}

/** `Omit<Union, K>` does not distribute over a discriminated union in
 * TypeScript (it collapses to the intersection of member keys), so this
 * payload shape is spelled out directly rather than derived from
 * `PageBridgeResponseEnvelope` via `Omit`. */
type ProviderResponsePayload =
  | {
      kind: "credential";
      credential: unknown;
      credentialJson: unknown;
      prfCapable?: boolean;
      prfUnavailableReason?: string;
    }
  | { kind: "fallthrough" }
  | { kind: "error" };

function postToPage(nonce: string, rest: ProviderResponsePayload): void {
  const envelope: PageBridgeResponseEnvelope = { source: RESPONSE_SOURCE, nonce, ...rest };
  // D-03: target origin is ALWAYS location.origin, never '*'.
  window.postMessage(envelope, location.origin);
}

/** CR-03 completion (12-REVIEW.md re-review, Plan 12-06): posted the moment
 * a request passes ALL of handleProviderPageMessage's validation gates
 * (source/origin/shape/non-replay), BEFORE the sendMessage forward to the
 * background. This is NOT a response -- it is a "handling" signal that lets
 * page-bridge's relay() cancel its short no-ack fallthrough window and
 * become exclusively dependent on the extension's own eventual
 * `"credential"`/`"fallthrough"` terminal message, so an
 * extension-accepted ceremony can never ALSO fall through to native
 * mid-flight (the orphaned-credential race CR-03 exists to close). Never
 * sent for a rejected/invalid request -- identical to today's silent-ignore
 * behavior for those. D-03: target origin is ALWAYS location.origin. */
function postAck(nonce: string): void {
  const envelope: PageBridgeResponseEnvelope = { source: RESPONSE_SOURCE, nonce, kind: "ack" };
  window.postMessage(envelope, location.origin);
}

interface ProviderCeremonyResponseLike {
  fallthrough: boolean;
  failed?: boolean;
  credentialResponseJson?: string;
  prfCapable?: boolean;
  prfUnavailableReason?: string;
}

/** Returns the `ProviderResponsePayload["kind"]` it posted to the page --
 * Plan 12-07's `handleProviderPageMessage` uses this return value (rather
 * than re-deriving its own classification of `response`) to decide whether
 * to clear `passkeyCeremonyInFlight`/call `overlayCoordinator?.allow()`, so
 * there is exactly ONE place that decides "credential" vs
 * "fallthrough"/"error" for a given ceremony response. Every existing
 * postToPage() call site/argument below is byte-for-byte unchanged from
 * before this plan -- only the `return` statements are new. */
function respondToPage(nonce: string, response: ProviderCeremonyResponseLike): ProviderResponsePayload["kind"] {
  if (response.failed) {
    postToPage(nonce, { kind: "error" });
    return "error";
  }
  if (response.fallthrough || typeof response.credentialResponseJson !== "string") {
    postToPage(nonce, { kind: "fallthrough" });
    return "fallthrough";
  }

  let credentialJson: unknown;
  try {
    credentialJson = JSON.parse(response.credentialResponseJson);
  } catch {
    postToPage(nonce, { kind: "error" });
    return "error";
  }
  const credential = decodeCredentialResponseJson(response.credentialResponseJson);
  if (credential === null) {
    postToPage(nonce, { kind: "error" });
    return "error";
  }

  postToPage(nonce, {
    kind: "credential",
    credential,
    credentialJson,
    prfCapable: response.prfCapable,
    prfUnavailableReason: response.prfUnavailableReason,
  });
  return "credential";
}

/**
 * D-22: registered at the TOP of `main()`, unconditionally and
 * synchronously -- NOT gated on this file's document-ready deferral below
 * -- so a page calling `credentials.get()` before the rest of this content
 * script's DOM-dependent init has run (e.g. conditional UI, invoked at
 * `document_start`) never posts into a void. D-03/ASVS V5: rejects/ignores
 * silently (no forwarding, no response) on ANY validation failure -- wrong
 * `event.source`, wrong origin, malformed envelope, or a replayed nonce.
 */
function handleProviderPageMessage(event: MessageEvent): void {
  if (event.source !== window || event.origin !== location.origin) {
    return;
  }
  if (!isPageBridgeRequest(event.data)) {
    return;
  }

  const { nonce, kind, publicKey } = event.data;
  const now = Date.now();
  pruneExpiredNonces(now);
  if (seenNonces.has(nonce)) {
    return; // replay -- silently ignored, never re-forwarded (D-03/ASVS V5)
  }
  seenNonces.set(nonce, now + NONCE_TTL_MS);

  // CR-03 completion: every validation gate above has now passed -- ack
  // BEFORE forwarding to the background (see postAck's own header comment).
  postAck(nonce);

  const encodedPublicKey = encodePublicKeyOptions(publicKey);

  // Plan 12-07: the page is running a WebAuthn ceremony through this bridge
  // -- passkey always takes priority over the Phase-10 login overlay, so
  // hide it now, BEFORE the forward. This is purely additive coordination
  // around the existing ack/encode/forward above -- none of those lines
  // moved or changed.
  passkeyCeremonyInFlight = true;
  overlayCoordinator?.hide();

  const dispatched =
    kind === "credentials.create"
      ? sendMessage({ kind: "credentials.create", publicKey: encodedPublicKey })
      : sendMessage({ kind: "credentials.get", publicKey: encodedPublicKey });

  dispatched
    .then((response) => {
      const respondedKind = respondToPage(nonce, response);
      // A "credential" response means the passkey WAS used -- keep the
      // login overlay suppressed (there is nothing left to log into with a
      // fallback credential once a passkey ceremony has completed). Any
      // other outcome (fallthrough -- no matching vault passkey / user
      // declined; or a genuine ceremony error) means the passkey path did
      // NOT complete, so the login overlay is re-offered.
      if (respondedKind !== "credential") {
        passkeyCeremonyInFlight = false;
        overlayCoordinator?.allow();
      }
    })
    .catch(() => {
      postToPage(nonce, { kind: "error" });
      passkeyCeremonyInFlight = false;
      overlayCoordinator?.allow();
    });
}

/** D-17: Firefox has no declarative `world:'MAIN'` content-script field
 * (Research Architecture Pattern 3) -- page-bridge-firefox.ts (Plan 12-03, Task 2)
 * is injected manually via WXT's `injectScript()` helper, served from
 * `web_accessible_resources` (extension/wxt.config.ts). Chrome keeps
 * page-bridge.content.ts's declarative `world:'MAIN'` field and does NOT
 * also run this -- `import.meta.env.FIREFOX` gates it so the two injection
 * tracks never both fire for the same browser (would double-patch). Fired
 * fire-and-forget at the very top of `main()`, alongside the postMessage
 * listener above -- not gated on document-ready -- to get Firefox as close
 * to Chrome's document_start timing as this mechanism allows.
 */
function injectFirefoxPageBridge(): void {
  if (!import.meta.env.FIREFOX) {
    return;
  }
  void injectScript("/page-bridge-firefox.js", { keepInDom: true }).catch((e: unknown) => {
    console.error("[passkey-vault] failed to inject page-bridge-firefox.js", e);
  });
}

// A real browser only ever calls a content script's main() ONCE per
// injection -- this guard exists so tests (and any other repeated main()
// invocation) don't accumulate multiple `window` "message" listeners, each
// racing to consume the same single-use nonce for a later dispatch. Not
// itself part of any threat-model boundary -- purely idempotency hygiene.
let registeredProviderListener: ((event: MessageEvent) => void) | null = null;

function registerProviderPageMessageListener(): void {
  if (registeredProviderListener !== null) {
    window.removeEventListener("message", registeredProviderListener);
  }
  registeredProviderListener = handleProviderPageMessage;
  window.addEventListener("message", registeredProviderListener);
}

// -----------------------------------------------------------------------
// Server-origin ext-unlock relay (Plan 13-06, 13-FF-WEBAUTHN-RESEARCH.md
// option 1). This is content-relay's half of the ceremony bridge:
// web/src/components/auth/ExtUnlockBridge.tsx (a REAL page, not a
// MAIN-world shim -- it already owns the whole ceremony, no separate
// MAIN-world file needed here) postMessages {nonce, prf, prfWrappedUk} to
// this ISOLATED-world listener; this file validates it (T-13-11: origin
// pinned to the CONFIGURED server, event.source/shape/single-use-nonce --
// mirrors handleProviderPageMessage's own D-03/ASVS V5 discipline), forwards
// it to the background over the SAME content-frame channel
// credentials.create/get use (router.ts's registerAutofillFrameChannel(),
// T-13-14), and relays the ack back. This is the ONLY place base64url
// encoding happens for this flow (D-21) -- ExtUnlockBridge posts the REAL
// PRF ArrayBuffer (postMessage structured-clones it fine), and this file
// converts it to a base64url STRING before the sendMessage hop (which JSON-
// serializes and would otherwise mangle it, same root cause as the provider
// bridge's own D-21 boundary). The raw User Key never crosses this hop
// either direction (T-13-12) -- only PRF output + the already-encrypted
// prf_wrapped_uk blob; the unwrap happens exclusively in
// entrypoints/background/server-unlock.ts.
const EXT_UNLOCK_REQUEST_SOURCE = "pv-ext-unlock-bridge";
const EXT_UNLOCK_RESPONSE_SOURCE = "pv-content-relay";

// T-13-11: a SEPARATE single-use nonce ledger from the provider bridge's
// own `seenNonces` above -- deliberately not shared, since these are two
// independently-scoped channels with independently-issued nonces (this
// channel's nonce is BACKGROUND-issued, embedded in the ceremony window's
// URL, unlike the provider bridge's page-generated one). Every entry here
// is consumed on first delivery and never expires on its own (a fresh
// content-script injection per navigation naturally resets this Set; the
// background's own pending record is ALSO single-use and time-bounded,
// T-13-13's "both relay- and background-side" mitigation).
const seenExtUnlockNonces = new Set<string>();

interface ExtUnlockBridgeMessage {
  source: typeof EXT_UNLOCK_REQUEST_SOURCE;
  nonce: string;
  prf: ArrayBuffer;
  prfWrappedUk: string;
}

function isExtUnlockBridgeMessage(data: unknown): data is ExtUnlockBridgeMessage {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const c = data as Partial<ExtUnlockBridgeMessage>;
  return (
    c.source === EXT_UNLOCK_REQUEST_SOURCE &&
    typeof c.nonce === "string" &&
    c.nonce.length > 0 &&
    isBufferSource(c.prf) &&
    typeof c.prfWrappedUk === "string"
  );
}

function postExtUnlockResult(nonce: string, ok: boolean): void {
  // D-03: target origin is ALWAYS location.origin, never '*'.
  window.postMessage(
    { source: EXT_UNLOCK_RESPONSE_SOURCE, kind: "pv-ext-unlock-result", nonce, ok },
    location.origin,
  );
}

async function handleExtUnlockBridgeMessage(event: MessageEvent): Promise<void> {
  if (event.source !== window || event.origin !== location.origin) {
    return;
  }
  if (!isExtUnlockBridgeMessage(event.data)) {
    return;
  }
  // T-13-11 (relay-side half of the "both relay- and background-side"
  // origin pin -- server-unlock.ts's completeServerUnlock is the other
  // half): event.origin === location.origin above only proves the message
  // came from THIS document; it does NOT prove this document IS the user's
  // CONFIGURED server. A hostile page on some OTHER origin this content
  // script also runs on (matches: ["<all_urls>"]) must never reach this far.
  if (!(await isConfiguredServerOrigin())) {
    return;
  }

  const { nonce, prf, prfWrappedUk } = event.data;
  if (seenExtUnlockNonces.has(nonce)) {
    return; // replay -- silently ignored, never re-forwarded (T-13-11)
  }
  seenExtUnlockNonces.add(nonce);

  const prfB64 = bufferSourceToB64Url(prf);
  try {
    const response = await sendMessage({
      kind: "unlock.serverCeremony.relay",
      nonce,
      prfB64,
      prfWrappedUk,
    });
    postExtUnlockResult(nonce, response.ok);
  } catch {
    postExtUnlockResult(nonce, false);
  }
}

let registeredExtUnlockListener: ((event: MessageEvent) => void) | null = null;

function registerExtUnlockBridgeListener(): void {
  if (registeredExtUnlockListener !== null) {
    window.removeEventListener("message", registeredExtUnlockListener);
  }
  registeredExtUnlockListener = (event) => {
    void handleExtUnlockBridgeMessage(event);
  };
  window.addEventListener("message", registeredExtUnlockListener);
}

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  // D-22 (Phase 12, Plan 12-03): changed from `document_idle` to
  // `document_start` so the provider postMessage listener below can
  // register as early as possible -- a page calling `credentials.get()`
  // early (conditional UI) must never postMessage into a void. WXT ties
  // `runAt` to the WHOLE entrypoint file, not to individual statements
  // inside `main()`, so the pre-existing document_idle-dependent init
  // calls (`initialMatchAndPrompt`/`initSubmitCapture`/`initThemeCapture`,
  // all of which query the live DOM) are explicitly deferred below via
  // `runWhenDocumentReady()` rather than left to run at document_start
  // where `document.body` may not exist yet -- their OWN timing is
  // unchanged from before this plan; only the provider listener (and,
  // fire-and-forget, the Firefox page-bridge injection) now runs earlier.
  runAt: "document_start",
  world: "ISOLATED",
  main() {
    // D-22: registered FIRST, synchronously, before anything else in this
    // function -- see handleProviderPageMessage's own header comment.
    registerProviderPageMessageListener();
    injectFirefoxPageBridge();
    // Plan 13-06: registered early alongside the provider listener above --
    // ExtUnlockBridge.tsx's ceremony is gesture-gated (a user click, well
    // after page load), so early timing isn't load-bearing here the way it
    // is for the provider bridge's conditional-mediation case, but
    // registering it here keeps every window "message" listener this file
    // owns in one place, at the top of main().
    registerExtUnlockBridgeListener();

    // Plan 12-07: fresh per `main()` invocation, same idempotency-hygiene
    // rationale as `registeredProviderListener` above -- a real content
    // script only ever calls `main()` once, but tests (and any other
    // repeated invocation) must not leak an in-flight flag from a
    // torn-down prior instance into a fresh one.
    passkeyCeremonyInFlight = false;

    // Single onMessage listener dispatching the two background<->
    // content-relay payloads (ContentDetectRequest/ContentFillRequest,
    // lib/autofill/types.ts). Writes ONLY happen inside the
    // content.fill branch below -- there is no other code path in this
    // file capable of calling fillValues().
    browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
      if (isContentDetectRequest(message)) {
        const response: ContentDetectResponse = detectAll();
        sendResponse(response);
        return true;
      }

      if (isContentFillRequest(message)) {
        const targets = resolveFillTargets(message.values.type);
        const result = targets ? fillValues(message.values, targets) : { ok: false, filledCount: 0 };
        const response: ContentFillResponse = { ok: result.ok };
        sendResponse(response);
        return true;
      }

      return undefined; // unrelated message kind -- ignored, never throws
    });

    // -----------------------------------------------------------------
    // In-page affordance (plan 10-10). Additive to the listener above --
    // it never touches content.detect/content.fill's own code path, and a
    // frame with no matches / a blocked site renders nothing (no visible
    // page footprint, no wasted round trip beyond the one matchFrame
    // call this module itself chooses to make).
    // -----------------------------------------------------------------
    let overlay: OverlayController | null = null;
    let frameMatches: AutofillMatch[] = [];
    let lastDropdownAnchor: HTMLElement | null = null;
    // Bumped on every focusin -- lets an in-flight lazy match request
    // detect it has been superseded by a NEWER focusin before it acts on
    // a stale result (the "guarded" half of the single guarded/debounced
    // focusin listener the architecture note requires; no MutationObserver
    // anywhere in this file).
    let focusGeneration = 0;

    function ensureOverlay(): OverlayController {
      if (overlay === null) {
        overlay = createOverlayController({
          onPick: (itemId, kind) => {
            void handlePick(itemId, kind);
          },
          onBlock: () => {
            void addBlockedOrigin(location.origin);
          },
        });
      }
      return overlay;
    }

    async function requestFrameMatches(detected: DetectedFields): Promise<AutofillMatch[]> {
      try {
        const result = await sendMessage({ kind: "autofill.matchFrame", detected });
        return result.pageState === "ok" ? result.matches : [];
      } catch {
        // No content-relay-reachable background (extension context torn
        // down mid-navigation, etc.) -- fail closed to no matches, never
        // fabricate a result.
        return [];
      }
    }

    async function handlePick(itemId: string, kind: FillKind): Promise<void> {
      try {
        const result = await sendMessage({ kind: "autofill.fillFrame", itemId, kind_: kind });
        if (result.ok) {
          // Plaintext never reached this module -- the background's
          // handleFillFrame (10-09) dispatched the actual write straight
          // to the content.fill branch above. Close the affordance the
          // user just acted through; Surface B is suppressed for the rest
          // of the page session (form is filled, no reason to re-show
          // it), Surface A's dropdown is cleared but NOT permanently
          // blocked (the user may still focus a different field, e.g. a
          // card field on the same page, later).
          overlay?.dismiss();
          if (lastDropdownAnchor) {
            overlay?.renderFieldDropdown(lastDropdownAnchor, []);
          }
        }
      } catch {
        // Leave the overlay open so the user can retry -- no in-page
        // toast exists at this layer (the popup already owns "fill
        // failed" messaging for its own surface).
      }
    }

    // Plan 12-07: the ONE place Surface B's `renderFormPrompt(frameMatches)`
    // call is made -- shared by `initialMatchAndPrompt()`'s own render below
    // and `overlayCoordinator.allow()`'s re-offer after a ceremony falls
    // through, so there is exactly one implementation of "render the form
    // prompt if this frame has matches and Surface B isn't blocked", never
    // two copies that could drift.
    function renderSurfaceBIfMatches(): void {
      if (frameMatches.length === 0) {
        return;
      }
      const controller = ensureOverlay();
      if (!controller.isBlocked()) {
        controller.renderFormPrompt(frameMatches);
      }
    }

    async function initialMatchAndPrompt(): Promise<void> {
      if (passkeyCeremonyInFlight) {
        // Plan 12-07: a passkey ceremony is already in flight (e.g. a
        // page's conditional-mediation `credentials.get()` fired at
        // document_start, before this document-ready-deferred pass even
        // runs) -- passkey always takes priority, so the login overlay
        // does not mount at all here. `overlayCoordinator.allow()` is what
        // re-offers it if/when the ceremony falls through.
        return;
      }

      if (await isConfiguredServerOrigin()) {
        // The user's own configured pv-server web app -- never show the
        // overlay here (Bartek's decision; see isConfiguredServerOrigin's
        // header comment).
        return;
      }

      if (await isOriginBlocked(location.origin)) {
        // Persisted block from a prior page load (Group A's blocked-origins
        // store) -- suppress Surface B entirely, matching blockSite()'s
        // in-session contract of suppressing BOTH surfaces (FIX B3).
        return;
      }

      const { detected } = detectAll();
      const anyDetected = detected.login || detected.totp || detected.card || detected.identity;
      if (!anyDetected) {
        return;
      }

      frameMatches = await requestFrameMatches(detected);
      renderSurfaceBIfMatches();
    }

    async function handleFocusIn(event: FocusEvent): Promise<void> {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      // Generate-password trigger (Plan 11-04, Surface 1): checked BEFORE
      // the collectFocusableFields()/kind lookup below -- a signup
      // password field is not necessarily one detect-login.ts's own
      // heuristic would resolve as a login-fillable target, and the two
      // affordances must never stack in the same trailing-padding corner
      // (orchestrator focus-loop coordination note, 2026-07-16). A
      // signup-classified password field is handled ENTIRELY by this
      // branch -- it returns unconditionally (gated origin or not) so the
      // Phase 10 "PV" autofill icon never mounts for it either.
      if (target instanceof HTMLInputElement && target.type === "password") {
        const container = target.closest("form") ?? document.body;
        if (classifyForm(container) === "signup") {
          if (await isConfiguredServerOrigin()) {
            return;
          }
          if (await isOriginBlocked(location.origin)) {
            return;
          }
          const pair = findPasswordFieldPair(container);
          mountGenerateTrigger(target, pair);
          return;
        }
      }

      const kind = collectFocusableFields().get(target);
      if (kind === undefined) {
        return; // not a field this content-relay would ever offer to fill
      }

      if (passkeyCeremonyInFlight) {
        // Plan 12-07: a passkey ceremony is in flight -- Surface A does not
        // mount for the duration (same passkey-priority rule as Surface B
        // above). The generate-password trigger branch above this point is
        // a SEPARATE affordance (not part of the login overlay) and is
        // deliberately unguarded.
        return;
      }

      if (await isConfiguredServerOrigin()) {
        // The user's own configured pv-server web app -- never show
        // Surface A here either (same suppression as initialMatchAndPrompt).
        return;
      }

      if (await isOriginBlocked(location.origin)) {
        // Persisted block (FIX B3) -- suppress Surface A too, matching
        // blockSite()'s "both surfaces" contract across a reload.
        return;
      }

      const controller = ensureOverlay();
      if (controller.isBlocked()) {
        return;
      }

      if (frameMatches.length === 0) {
        // Lazy re-detect -- an SPA may have rendered this frame's fields
        // (and thus its matches) after the document_idle pass above.
        const generation = ++focusGeneration;
        const { detected } = detectAll();
        frameMatches = await requestFrameMatches(detected);
        if (generation !== focusGeneration) {
          return; // superseded by a newer focusin while this awaited
        }
      }

      const kindMatches = frameMatches.filter((match) => match.kind === kind);
      if (kindMatches.length === 0) {
        return;
      }

      lastDropdownAnchor = target;
      controller.renderFieldDropdown(target, kindMatches);
    }

    function handleFocusOut(event: FocusEvent): void {
      const related = event.relatedTarget;

      // Generate-trigger teardown (Plan 11-04), in the SAME handler that
      // tears down the Phase 10 "PV" icon below -- not a second, parallel
      // teardown path. Same shadow-DOM event-retargeting guard as the
      // overlay check further down: a click on the trigger/popover's own
      // DOM (inpage-mount.ts's SHARED host, a different element from
      // inpage-overlay.ts's own `overlay.host`) fires focusout on the
      // field first, observed here as `relatedTarget === generateHost`.
      // Idempotent no-op when nothing is mounted.
      const generateHost = getGenerateTriggerHost();
      if (!(generateHost && related instanceof Node && generateHost.contains(related))) {
        teardownGenerateTrigger();
      }

      if (overlay === null) {
        return; // Surface A was never mounted -- nothing to tear down
      }

      // Guard: a click on a dropdown row or the "PV" field icon fires
      // focusout on the field FIRST (its target moves from the input into
      // the closed shadow root's own DOM). Shadow-DOM event retargeting
      // means a listener outside the shadow tree observes relatedTarget as
      // the HOST element, not the actual row/icon inside it -- so
      // `overlay.host.contains(relatedTarget)` (true for the host itself,
      // since Node.contains() includes self) is the correct check here,
      // not a descendant lookup into the (closed, unreachable) shadow tree.
      // Skipping the clear in this case is what lets the row's own click
      // handler fire onPick before Surface A is torn down.
      if (related instanceof Node && overlay.host.contains(related)) {
        return;
      }

      overlay.clearFieldDropdown();
    }

    // Plan 12-07: wires the module-level `handleProviderPageMessage`'s
    // `overlayCoordinator?.hide()`/`.allow()` calls to THIS `main()`
    // invocation's overlay state. `hide()` uses only the SOFT/REVERSIBLE
    // overlay methods (`clearFieldDropdown()`/`renderFormPrompt([])`) --
    // never `dismiss()`/`blockSite()`, which permanently suppress for the
    // rest of the page session and would make a fallthrough re-offer
    // impossible. `allow()` reuses `renderSurfaceBIfMatches()` (the exact
    // same render call `initialMatchAndPrompt()` makes) rather than
    // duplicating its match-rendering logic; Surface A simply re-mounts on
    // the next `focusin` once `passkeyCeremonyInFlight` is cleared, so
    // `allow()` has nothing further to do for Surface A itself.
    overlayCoordinator = {
      hide(): void {
        overlay?.clearFieldDropdown();
        overlay?.renderFormPrompt([]);
      },
      allow(): void {
        renderSurfaceBIfMatches();
      },
    };

    document.addEventListener("focusin", (event) => {
      void handleFocusIn(event as FocusEvent);
    });

    document.addEventListener("focusout", (event) => {
      handleFocusOut(event as FocusEvent);
    });

    // D-22 (see this file's own entrypoint-config comment above): this
    // entrypoint now runs at document_start, but detectAll()/DOM queries
    // inside these three calls need at least a parsed `document.body` --
    // deferring them to the same "DOM ready" point the old document_idle
    // timing effectively guaranteed keeps their behavior identical to
    // before this plan, while the provider listener/injection above (and
    // the two document.addEventListener registrations, which are always
    // safe to attach regardless of parse state) still run immediately.
    runWhenDocumentReady(() => {
      void initialMatchAndPrompt();
      void initSubmitCapture();
      void initThemeCapture();
    });
  },
});
