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
import { sendMessage } from "../lib/messaging/ext-protocol";
import type {
  AutofillMatch,
  ContentDetectResponse,
  ContentFillRequest,
  ContentFillResponse,
  DetectedFields,
  FillKind,
} from "../lib/autofill/types";

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
      // Fire-and-forget: Plan 11-03 wires the actual handler (mismatch
      // computation, vault-item matching); this plan only proves the
      // detection layer and sends the proposal. A rejected/unhandled
      // response (no listener registered yet, torn-down extension
      // context, etc.) is swallowed here -- UI response handling
      // (toast/modal) is Plan 11-05's job, not this one.
      void sendMessage({
        kind: "capture.propose",
        frameOrigin: captureFrameOrigin(),
        username,
        password,
      }).catch(() => {
        // Intentionally ignored -- see comment above.
      });
    });
  }
}

export default defineContentScript({
  matches: ["<all_urls>"],
  allFrames: true,
  runAt: "document_idle",
  world: "ISOLATED",
  main() {
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

    async function initialMatchAndPrompt(): Promise<void> {
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
      if (frameMatches.length === 0) {
        return;
      }

      const controller = ensureOverlay();
      if (!controller.isBlocked()) {
        controller.renderFormPrompt(frameMatches);
      }
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

    document.addEventListener("focusin", (event) => {
      void handleFocusIn(event as FocusEvent);
    });

    document.addEventListener("focusout", (event) => {
      handleFocusOut(event as FocusEvent);
    });

    void initialMatchAndPrompt();
    void initSubmitCapture();
  },
});
