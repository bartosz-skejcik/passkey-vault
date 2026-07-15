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
import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import { detectLogin } from "../lib/autofill/detect-login";
import { detectTotp } from "../lib/autofill/detect-totp";
import { detectCard, detectIdentity } from "../lib/autofill/detect-scored";
import { fillValues, type FillTargets } from "../lib/autofill/fill-dom";
import type {
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
  },
});
