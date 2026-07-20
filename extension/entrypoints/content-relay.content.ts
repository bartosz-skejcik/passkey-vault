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
// registerAutofillFrameChannel()), and relays the response back. This file
// remains the SOLE owner of the REQUEST-direction base64url encode and its
// own ISOLATED-world response decode (`decodeCredentialResponseJson` below
// is unchanged -- still needed and correct for its existing purpose: the
// background/WASM layer, and this file's own consumers, both still receive
// real ISOLATED-world ArrayBuffers from it); this file never touches the
// User Key, PRF output, or any passkey private key material -- only
// opaque, already-encrypted-or-public ceremony JSON.
//
// Plan 14-02 exception (`.planning/debug/resolved/firefox-request-xray-hole.md`):
// page-bridge-firefox.ts's `shapeCredential()` NOW ALSO re-decodes
// response-direction binary fields from `credentialJson` in MAIN world, on
// Firefox only -- a live-Firefox differential probe found that
// ArrayBuffers this file decodes here (ISOLATED world) arrive at the RP
// page with a broken `instanceof ArrayBuffer` prototype chain across the
// ISOLATED->MAIN `window.postMessage` hop (bytes intact, only realm
// identity broken -- see the debug doc's Evidence entry timestamped
// 2026-07-20T11:10:00Z). page-bridge-firefox.ts's own MAIN-world
// `b64UrlToArrayBuffer` closes that gap for the page's own realm. No
// equivalent Chrome-side change -- research found no Xray hazard on
// Chrome's MAIN<->ISOLATED hop, so page-bridge.content.ts is untouched.
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
// `ArrayBuffer` before being handed back to page-bridge -- which, on
// Chrome, never runs a base64 decoder of its own (on Firefox, see the
// Plan 14-02 exception immediately above).

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

/** Firefox-only Xray/cross-realm hazard (debug session
 * .planning/debug/resolved/firefox-request-xray-hole.md): a page-realm raw
 * `ArrayBuffer` (NOT a `TypedArray` view -- e.g. GitHub's webauthn-json
 * library, which sends `challenge`/credential ids as ArrayBuffer) that
 * crosses the MAIN(page-bridge-firefox.ts, same realm as the page)->
 * ISOLATED(this file) `window.postMessage` hop on real Firefox arrives
 * with a broken prototype chain relative to THIS realm's own `ArrayBuffer`
 * global -- `value instanceof ArrayBuffer` is FALSE even though the value
 * is a completely intact, genuine ArrayBuffer (confirmed empirically, real
 * Firefox 152.0.6: `Object.prototype.toString.call(value)` still
 * correctly reports `"[object ArrayBuffer]"`, and `new Uint8Array(value)`
 * in THIS realm still reads the exact original bytes byte-for-byte -- only
 * the `instanceof`/prototype-chain check is broken, never the underlying
 * data). `ArrayBuffer.isView()` is unaffected by this same hazard (an
 * internal-slot check, not a prototype-chain check -- also confirmed
 * cross-realm-safe by the same probe), which is exactly why a
 * TypedArray-shaped challenge (e.g. `new Uint8Array(32)`, every existing
 * fixture in this project's own e2e suites) never triggered this bug.
 * Chrome has no equivalent hazard on this hop (never implicated by this or
 * the earlier firefox-provider-corruption.md session) -- this check is a
 * pure widening of detection, never a narrowing, so there is no
 * browser-specific branch to maintain here. */
function isCrossRealmArrayBuffer(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.toString.call(value) === "[object ArrayBuffer]"
  );
}

function isBufferSource(value: unknown): value is BufferSource {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) || isCrossRealmArrayBuffer(value);
}

/** Base64url (no padding), matching `passkey_types`' own WebAuthn JSON
 * encoding on the Rust side (crates/pv-provider) -- deliberately NOT
 * lib/messaging/bytes-b64.ts's `bytesToB64`, which produces STANDARD
 * base64 (`+`/`/`/`=`) and would fail `passkey_types`' deserializer.
 *
 * Branches on `ArrayBuffer.isView()`, NOT `instanceof ArrayBuffer` -- see
 * isCrossRealmArrayBuffer's header comment above: `isView()` is the
 * cross-realm-safe discriminator; a cross-realm ArrayBuffer's `instanceof
 * ArrayBuffer` is unreliable (false on Firefox) but `new Uint8Array(input)`
 * still correctly reads its real bytes regardless of realm, so treating
 * "not a view" as "must be ArrayBuffer-like" (the only other shape
 * isBufferSource() ever admits) stays correct for both same-realm and
 * cross-realm inputs. */
function bufferSourceToB64Url(input: BufferSource): string {
  const bytes = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input as ArrayBuffer);
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
 *
 * Every gate below (replay check, ack, `passkeyCeremonyInFlight`/overlay
 * suppression) stays STRICTLY SYNCHRONOUS -- 12-07's own conditional-
 * mediation race guard depends on `passkeyCeremonyInFlight` being claimed
 * in the SAME tick this handler runs, before a racing `DOMContentLoaded`
 * (and its `initialMatchAndPrompt()`) ever gets a chance to check it. Only
 * the configured-server-origin refusal check (`dispatchProviderCeremony`,
 * below) is async -- and it runs AFTER these synchronous gates, never
 * before them, so it can never delay this handler's own critical section.
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

  // IN-01 (13-REVIEW-3.md): a page can spoof `Symbol.toStringTag` so an
  // ordinary object reports `Object.prototype.toString.call(...) ===
  // "[object ArrayBuffer]"` (isCrossRealmArrayBuffer's own header comment),
  // which `encodePublicKeyOptions`'s buffer-source detection honors. A
  // crafted huge `length` then makes `bufferSourceToB64Url`'s
  // `new Uint8Array(fake)` throw a RangeError. The ack above has already
  // fired, so the page's relay() is waiting on a terminal message -- an
  // unguarded throw here would abort BEFORE `passkeyCeremonyInFlight`/
  // `overlayCoordinator?.hide()` ever run and leave the DOM marker (set by
  // page-bridge's relay(), see WR-01) stuck, wedging that page's overlay
  // for the whole session. Every provider-side error elsewhere in this
  // file responds with an explicit terminal message and cleans up (see
  // `dispatchProviderCeremony`'s catch below) -- this closes the one path
  // that instead silently wedged until EXTENSION_AUTHORITY_TIMEOUT_MS.
  let encodedPublicKey: unknown;
  try {
    encodedPublicKey = encodePublicKeyOptions(publicKey);
  } catch {
    postToPage(nonce, { kind: "fallthrough" });
    delete document.documentElement.dataset.pvCeremonyInFlight;
    return;
  }

  // Plan 12-07: the page is running a WebAuthn ceremony through this bridge
  // -- passkey always takes priority over the Phase-10 login overlay, so
  // hide it now, BEFORE the forward. This is purely additive coordination
  // around the existing ack/encode/forward above -- none of those lines
  // moved or changed.
  passkeyCeremonyInFlight = true;
  overlayCoordinator?.hide();

  void dispatchProviderCeremony(nonce, kind, encodedPublicKey);
}

/**
 * Bartek live-UAT bug follow-up (.planning/debug/resolved/
 * signin-passkeyless-spin.md, provider-hijack diagnosis): the MAIN-world
 * page-bridge patch (page-bridge.content.ts / page-bridge-firefox.ts)
 * installs on `<all_urls>` unconditionally -- including the user's OWN
 * configured pv-server origin -- so EVERY `navigator.credentials.get/create()`
 * call there (v0.1's own login/unlock/enroll on the web app itself, AND
 * ExtUnlockBridge's server-origin ceremony window, which is the SAME
 * origin) was being captured as a provider ceremony instead of running as
 * real WebAuthn. Confirmed empirically: `navigator.credentials.get.toString()`
 * in the ceremony window returned the RPC shim (`n=>d("get",n,t)`), not
 * `[native code]`. For a locked/no-session vault this deadlocks --
 * `provider-ceremony.ts`'s `ensureHydrated()` -> `openPopupAndAwaitUnlock()`
 * opens ANOTHER extension window asking the user to sign in, while the
 * ORIGINAL ceremony (which the user was trying to sign in FROM) sits
 * blocked awaiting that popup's own unlock -- Bartek's reported "third
 * window with an email input."
 *
 * Refused HERE, at the ISOLATED-world/extension-controlled content-relay
 * layer -- never by trying to conditionally un-inject or exclude the
 * MAIN-world patch itself (Chrome's declarative `world:'MAIN'` content-script
 * registration is static per extension install, cannot be scoped per-tab
 * or re-evaluated when the user reconfigures their server at runtime).
 * `isConfiguredServerOrigin()` has no cache -- reads storage.local fresh on
 * EVERY message -- so this check runs PER MESSAGE, not per injection: a
 * server reconfiguration takes effect on the very next ceremony, not just
 * ones after a fresh page load.
 *
 * The ack/nonce-consumption/overlay-hide above already happened
 * synchronously (see handleProviderPageMessage's own header comment on why
 * that MUST stay synchronous) -- refusing here simply responds with an
 * explicit `fallthrough` immediately (real native WebAuthn proceeds
 * normally, D-11) instead of ever reaching the background, and un-hides
 * the overlay exactly like every other non-credential outcome already
 * does below. The D-03/nonce/relay machinery for the provider stays fully
 * intact for every OTHER (non-configured-server) origin -- this is a
 * narrow, origin-scoped refusal, not a weakening of the provider boundary
 * itself.
 */
async function dispatchProviderCeremony(
  nonce: string,
  kind: "credentials.create" | "credentials.get",
  encodedPublicKey: unknown,
): Promise<void> {
  if (await isConfiguredServerOrigin()) {
    postToPage(nonce, { kind: "fallthrough" });
    passkeyCeremonyInFlight = false;
    delete document.documentElement.dataset.pvCeremonyInFlight;
    overlayCoordinator?.allow();
    return;
  }

  const dispatched =
    kind === "credentials.create"
      ? sendMessage({ kind: "credentials.create", publicKey: encodedPublicKey })
      : sendMessage({ kind: "credentials.get", publicKey: encodedPublicKey });

  try {
    const response = await dispatched;
    const respondedKind = respondToPage(nonce, response);
    // A "credential" response means the passkey WAS used -- keep the
    // login overlay suppressed (there is nothing left to log into with a
    // fallback credential once a passkey ceremony has completed). Any
    // other outcome (fallthrough -- no matching vault passkey / user
    // declined; or a genuine ceremony error) means the passkey path did
    // NOT complete, so the login overlay is re-offered.
    if (respondedKind !== "credential") {
      passkeyCeremonyInFlight = false;
      delete document.documentElement.dataset.pvCeremonyInFlight;
      overlayCoordinator?.allow();
    }
  } catch {
    postToPage(nonce, { kind: "error" });
    passkeyCeremonyInFlight = false;
    delete document.documentElement.dataset.pvCeremonyInFlight;
    overlayCoordinator?.allow();
  }
}

/**
 * Firefox MAIN-world injection primitive (CSP-blocked-inline fix, debug
 * session .planning/debug/resolved/firefox-injection-csp-blocked.md).
 *
 * WXT's own `injectScript()` helper (`wxt/utils/inject-script`, pinned
 * wxt@0.20.27) picks a DIFFERENT DOM-construction strategy per manifest
 * version: `script.src = url` (a real `moz-extension://`
 * web_accessible_resources load) for MV3, but for MV2 -- which is this
 * project's own deliberate Firefox build target (wxt.config.ts) -- it
 * instead does `script.text = await fetch(url).then(r => r.text())`,
 * producing a plain INLINE `<script>` element with no `src` attribute at
 * all. An inline script element is governed by the PAGE's own
 * `Content-Security-Policy: script-src-elem` directive; any site with a
 * non-permissive CSP (confirmed live on github.com, and reproduced via a
 * throwaway extension against a local CSP-strict fixture during this debug
 * session) silently blocks it, so the Firefox provider shim never installs
 * there and every ceremony falls through to native.
 *
 * A `.src`-based load of the SAME extension resource, inserted by the SAME
 * privileged content script, is NOT blocked by the page's CSP -- confirmed
 * empirically (real Firefox 152 + geckodriver) and corroborated by MDN/
 * community docs as a long-standing, version-independent Firefox
 * WebExtension property ("web-accessible extension resources are not
 * blocked by CORS or CSP"), NOT tied to any specific Firefox version (unlike
 * declarative `content_scripts[].world:'MAIN'`, which MDN browser-compat-data
 * confirms only landed in Firefox 128). This function therefore bypasses
 * `injectScript()` entirely for this one call site (its only call site in
 * the whole extension/ tree) rather than fighting its MV2-specific branch
 * via the `modifyScript` hook -- that would still pay for a discarded
 * `fetch()` call and lose the real `load`/`error` event signal WXT's own
 * MV3 path gets from `makeLoadedPromise`. This is exactly what WXT's MV3
 * branch already does; Firefox's MV2 build needs the identical `.src`
 * strategy here, never the `.text` one. Still requires
 * `web_accessible_resources` to declare `page-bridge-firefox.js`
 * (wxt.config.ts, unchanged by this fix) -- CSP-exemption is unrelated to
 * that separate, still-required resource-visibility permission.
 */
function injectPageBridgeFirefoxScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = browser.runtime.getURL("/page-bridge-firefox.js");
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("failed to load page-bridge-firefox.js")),
      { once: true },
    );
    // keepInDom-equivalent: never removed after load, matching the prior
    // injectScript(..., { keepInDom: true }) call this replaces.
    (document.head ?? document.documentElement).append(script);
  });
}

/** D-17: Firefox has no declarative `world:'MAIN'` content-script field
 * (Research Architecture Pattern 3) -- page-bridge-firefox.ts (Plan 12-03, Task 2)
 * is injected manually via `injectPageBridgeFirefoxScript()` above, served
 * from `web_accessible_resources` (extension/wxt.config.ts). Chrome keeps
 * page-bridge.content.ts's declarative `world:'MAIN'` field and does NOT
 * also run this -- `import.meta.env.FIREFOX` gates it so the two injection
 * tracks never both fire for the same browser (would double-patch). Fired
 * fire-and-forget at the very top of `main()`, alongside the postMessage
 * listener above -- not gated on document-ready -- to get Firefox as close
 * to Chrome's document_start timing as this mechanism allows.
 *
 * Bartek live-UAT bug follow-up (.planning/debug/resolved/
 * signin-passkeyless-spin.md, provider-hijack diagnosis): on the user's OWN
 * configured pv-server origin, this now skips the injection ENTIRELY --
 * `navigator.credentials.get/create` stay genuinely native there (verified
 * via `[native code]` toString(), not just "refused after the fact" by
 * dispatchProviderCeremony's own origin check below, which is the
 * FUNCTIONAL backstop for the one case this injection-time check cannot
 * cover: Chrome's declarative `world:'MAIN'` registration has no per-tab
 * runtime exclusion mechanism at all, so page-bridge.content.ts's patch
 * unavoidably installs there regardless -- dispatchProviderCeremony's
 * refusal is what keeps THAT patch transparently inert on Chrome). Checked
 * fresh on every call -- `main()` (and therefore this function) reruns on
 * every fresh navigation/content-script (re)injection of this ceremony-
 * window-or-vault-app page, so a server reconfiguration is honored on the
 * very next page load of that origin, not just the one the extension was
 * installed under. This injection-time skip is EXACTLY why the CSP-inline
 * fix above did not need to become a declarative content_scripts
 * `world:'MAIN'` rewrite (the alternative fix this debug session
 * considered and rejected) -- that route has no per-tab exclusion at all,
 * which would have silently regressed this genuinely-native guarantee.
 */
async function injectFirefoxPageBridge(): Promise<void> {
  if (!import.meta.env.FIREFOX) {
    return;
  }
  if (await isConfiguredServerOrigin()) {
    return;
  }
  void injectPageBridgeFirefoxScript().catch((e: unknown) => {
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
// MAIN-world file needed here) postMessages {nonce, prfB64, prfWrappedUk}
// to this ISOLATED-world listener; this file validates it (T-13-11: origin
// pinned to the CONFIGURED server, event.source/shape/single-use-nonce --
// mirrors handleProviderPageMessage's own D-03/ASVS V5 discipline), forwards
// it to the background over the SAME content-frame channel
// credentials.create/get use (router.ts's registerAutofillFrameChannel(),
// T-13-14), and relays the ack back. D-21's base64url boundary is enforced
// TWICE for this flow, at both hops: ExtUnlockBridge.tsx encodes the PRF
// output to base64url in PAGE scope before ever posting it (Bartek live
// finding, Zen Browser/Firefox -- a raw typed array crossing the MAIN-page
// -> ISOLATED-world postMessage hop reads as silently corrupted garbage
// through Firefox's Xray wrappers, where a JSON-safe string does not), and
// this file forwards that string verbatim to the background over the
// ISOLATED-world -> background sendMessage hop (which JSON-serializes and
// would mangle a raw ArrayBuffer, same root cause as the provider bridge's
// own D-21 boundary) -- this file no longer does the encoding itself for a
// current build, only relays an already-encoded string; a legacy raw
// BufferSource `prf` field is still accepted and encoded HERE as a
// deploy-skew fallback (see `ExtUnlockBridgeMessage`'s own header comment).
// The raw User Key never crosses this hop either direction (T-13-12) --
// only PRF output + the already-encrypted prf_wrapped_uk blob; the unwrap
// happens exclusively in entrypoints/background/server-unlock.ts.
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

// Plan 13-07 (Bartek mandate, full SIGN-IN): `token`/`accountEmail` are
// OPTIONAL -- present only when ExtUnlockBridge is running a `signin`-mode
// ceremony (web/src/lib/passkeys/login.ts's `passkeyLoginCeremony`, which
// identifies the user by EMAIL, not a discoverable credential -- see that
// file's own header comment). Both are forwarded VERBATIM to the
// background, exactly as received -- `token` is the server's opaque
// bearer-string session token (base64-shaped but never decoded/re-encoded
// here or in the background, unlike the PRF ArrayBuffer field: there is no
// encode/decode boundary for a value that is only ever compared/stored as
// an opaque string, mirroring unlock.ts's own `auth.signIn.password`
// handling). This file never interprets `mode` itself -- the pending
// record's own mode (server-unlock.ts) is what decides whether a given
// combination of fields is legal (T-13-16); this relay's only job is
// faithful forwarding.
//
// `failed: true` (Bartek live-UAT bug fix, .planning/debug/resolved/
// signin-passkeyless-spin.md): ExtUnlockBridge's own EXPLICIT "this
// ceremony reached a terminal, calmly-explained failure state" notice --
// distinct from the PRF-bearing shape above (`prf`/`prfWrappedUk` absent).
// Previously the bridge only ever posted on full PRF success, so any other
// terminal outcome (no-passkeys/not-signed-in/genuine ceremony failure)
// left completeServerUnlock() unreached -- the popup's in-flight spinner
// and the background's pending record were only ever resolved by
// server-unlock.ts's own 120s CEREMONY_TIMEOUT_MS alarm, not immediately
// (T-13-13 violation, confirmed via live Firefox reproduction). This relay
// forwards `failed: true` through untouched, same faithful-forwarding
// discipline as every other field here.
// `prfB64` (Bartek live finding, Zen Browser/Firefox): ExtUnlockBridge.tsx
// now encodes the PRF output to a base64url STRING in PAGE SCOPE before
// ever calling postMessage -- see that file's own `bytesToB64Url` header
// comment for the full root-cause diagnosis (a raw typed array crossing
// this MAIN-page -> ISOLATED-world postMessage hop reads as silently
// corrupted garbage through Firefox's Xray wrappers; a JSON-safe string
// does not). `prf` (the old raw-BufferSource shape) is kept as a fallback
// ONLY for deploy skew -- an old web/out build paired with a newer
// extension build -- and is validated/accepted exactly as before; it never
// exhibited the Firefox bug (Chrome's isolated world gets a clean
// structured-clone, which is why this file's original implementation
// looked correct there). `prfB64` takes precedence whenever both happen to
// be present.
interface ExtUnlockBridgeMessage {
  source: typeof EXT_UNLOCK_REQUEST_SOURCE;
  nonce: string;
  failed?: true;
  prfB64?: string;
  prf?: ArrayBuffer;
  prfWrappedUk?: string;
  token?: string;
  accountEmail?: string;
}

/** Base64url-shaped, non-empty -- `-`/`_` in place of standard base64's
 * `+`/`/`, no padding (matches ExtUnlockBridge.tsx's own `bytesToB64Url`
 * page-side encoder, and this file's own `bufferSourceToB64Url` below).
 * Shape-only: a transport-format check, not a length/content validator --
 * the background's `b64UrlToBytes` decode + PRF-length check
 * (crates/pv-core/src/prf.rs) are what actually reject a malformed or
 * too-short PRF value; this just keeps a non-base64url string (or empty
 * string) from ever being forwarded as if it were one. */
function isBase64UrlShaped(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9_-]+$/.test(value);
}

function isExtUnlockBridgeMessage(data: unknown): data is ExtUnlockBridgeMessage {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  const c = data as Partial<ExtUnlockBridgeMessage>;
  if (c.source !== EXT_UNLOCK_REQUEST_SOURCE || typeof c.nonce !== "string" || c.nonce.length === 0) {
    return false;
  }
  if (c.failed === true) {
    // No PRF material is expected (or required) on an explicit failure
    // notice -- token/accountEmail are irrelevant too, this shape carries
    // nothing but the nonce.
    return true;
  }
  if (isBase64UrlShaped(c.prfB64)) {
    // Preferred, page-encoded string form -- see this interface's own
    // header comment. Takes precedence over the legacy `prf` field below
    // regardless of whether that field is also present.
    return (
      typeof c.prfWrappedUk === "string" &&
      (c.token === undefined || typeof c.token === "string") &&
      (c.accountEmail === undefined || typeof c.accountEmail === "string")
    );
  }
  // Legacy BufferSource fallback (deploy skew only -- see header comment).
  return (
    isBufferSource(c.prf) &&
    typeof c.prfWrappedUk === "string" &&
    (c.token === undefined || typeof c.token === "string") &&
    (c.accountEmail === undefined || typeof c.accountEmail === "string")
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

  const { nonce, failed, prf, prfB64, prfWrappedUk, token, accountEmail } = event.data;
  if (seenExtUnlockNonces.has(nonce)) {
    return; // replay -- silently ignored, never re-forwarded (T-13-11)
  }
  seenExtUnlockNonces.add(nonce);

  try {
    const response =
      failed === true
        ? await sendMessage({ kind: "unlock.serverCeremony.relay", nonce, failed: true })
        : await sendMessage({
            kind: "unlock.serverCeremony.relay",
            nonce,
            // isExtUnlockBridgeMessage already proved EITHER prfB64
            // (preferred, page-encoded string -- forwarded verbatim,
            // untouched by this file) OR prf (legacy BufferSource
            // fallback, encoded here exactly as before) is present
            // whenever failed !== true.
            prfB64: prfB64 ?? bufferSourceToB64Url(prf as ArrayBuffer),
            prfWrappedUk: prfWrappedUk as string,
            token,
            accountEmail,
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
    void injectFirefoxPageBridge();
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
      if (passkeyCeremonyInFlight || document.documentElement.dataset.pvCeremonyInFlight === "1") {
        // Plan 12-07: a passkey ceremony is already in flight (e.g. a
        // page's conditional-mediation `credentials.get()` fired at
        // document_start, before this document-ready-deferred pass even
        // runs) -- passkey always takes priority, so the login overlay
        // does not mount at all here. `overlayCoordinator.allow()` is what
        // re-offers it if/when the ceremony falls through.
        // quick-260720-16k: also checks the DOM marker page-bridge.content.ts
        // sets SYNCHRONOUSLY (before its async postMessage hop) -- closes
        // the real gap where `passkeyCeremonyInFlight` (only set once
        // `handleProviderPageMessage` receives that postMessage) could
        // still be `false` for a brief window a `DOMContentLoaded`-timed
        // initial mount could race ahead of.
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

      if (passkeyCeremonyInFlight || document.documentElement.dataset.pvCeremonyInFlight === "1") {
        // Plan 12-07: a passkey ceremony is in flight -- Surface A does not
        // mount for the duration (same passkey-priority rule as Surface B
        // above). The generate-password trigger branch above this point is
        // a SEPARATE affordance (not part of the login overlay) and is
        // deliberately unguarded.
        // quick-260720-16k: also checks the DOM marker (see
        // initialMatchAndPrompt's identical comment above).
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
