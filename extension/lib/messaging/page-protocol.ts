// lib/messaging/page-protocol.ts — the typed envelope contract for the
// page-bridge (MAIN world) <-> content-relay (ISOLATED world) `postMessage`
// bridge (Phase 12, Plan 12-03).
//
// D-02/PROV-05 (grep-audited by scripts/audit-mainworld-boundary.sh, Task
// 3): `page-bridge.content.ts` (Chrome) and `page-bridge.ts` (Firefox)
// import NOTHING beyond the two interfaces this file exports. This file
// itself has ZERO runtime logic and ZERO other imports -- it can never
// become a transitive path into a forbidden module (this project's
// zero-knowledge boundary), and it can never itself need to be re-audited
// beyond a glance, since there is nothing here to hide behind.
//
// `publicKey`/`credential`/`credentialJson` stay typed `unknown` at this
// boundary (12-PATTERNS.md's "thin wire-client, typed unknown" discipline,
// the same convention lib/messaging/ext-protocol.ts already uses for
// `credentials.create`/`credentials.get`'s own `publicKey` field). Real
// interpretation of the WebAuthn JSON/binary shape happens exactly one
// layer in, in content-relay.content.ts (base64url encode/decode, D-21) --
// never here, and never in page-bridge itself.
//
// D-03 (never target '*'): both page-bridge and content-relay always call
// `window.postMessage(envelope, location.origin)` -- the target-origin
// argument is a caller discipline, not something this file's types can
// enforce, but every caller of these envelopes is documented to follow it.

/**
 * page-bridge (MAIN) -> content-relay (ISOLATED). `origin` is the page's
 * OWN `location.origin` at construction time -- content-relay does not
 * trust it as authoritative (its own `event.origin` from the platform-
 * provided `MessageEvent` is what actually gates admission, D-03/ASVS V5);
 * this field exists only for content-relay's convenience/logging.
 */
export interface PageBridgeRequestEnvelope {
  source: "pv-page-bridge";
  nonce: string;
  kind: "credentials.create" | "credentials.get";
  origin: string;
  publicKey: unknown;
}

/**
 * content-relay (ISOLATED) -> page-bridge (MAIN), matched by `nonce`
 * against the specific pending ceremony call that requested it (D-22's
 * "single matching-nonce message event" contract).
 *
 * - `"ack"`: CR-03 completion (12-REVIEW.md re-review, Plan 12-06) -- a
 *   NON-terminal "handling" signal content-relay posts as soon as a
 *   request passes ALL its validation gates, BEFORE forwarding to the
 *   background. This is what lets page-bridge stop racing a fixed
 *   interaction-budget timeout against the background's own
 *   unlock-wait/consent-await ceilings (which are ADDITIVE, ~240s, vs. the
 *   page's prior single 120s): once an ack with a matching nonce arrives,
 *   the extension is the SOLE authority on when this ceremony resolves --
 *   page-bridge cancels its short no-ack fallthrough timer and waits
 *   exclusively for a `"credential"`/`"fallthrough"` terminal message
 *   (bounded only by a generous backstop against a truly wedged listener,
 *   never an interaction budget). No ack for an INVALID/rejected request --
 *   identical to today's silent-ignore behavior.
 * - `"credential"`: a vault-backed ceremony succeeded. `credential` already
 *   has every WebAuthn binary field (`rawId`, `response.*`,
 *   `clientExtensionResults.prf.results.*`) decoded back into real
 *   `ArrayBuffer`s by content-relay (D-21) -- page-bridge never runs a
 *   base64 decoder itself, it only shapes this object into something
 *   satisfying `PublicKeyCredential`'s enumerable contract.
 *   `credentialJson` is the SAME response, kept in its original spec JSON
 *   form (base64url strings, not buffers) -- this is what the returned
 *   credential's `.toJSON()` method must hand back verbatim, since a real
 *   `PublicKeyCredential.toJSON()` returns the base64url JSON shape, not
 *   raw buffers.
 * - `"fallthrough"`: no vault match / user declined / locked-and-declined
 *   -- a normal, expected outcome, never logged as an error.
 * - `"error"`: a genuine ceremony/relay failure (WASM threw, the extension
 *   context was torn down mid-flight, etc.) -- distinguished from
 *   `"fallthrough"` for future diagnostics, but page-bridge's own fallback
 *   behavior for BOTH is identical: invoke the captured native original
 *   and return/reject with its real result (D-11).
 */
export type PageBridgeResponseEnvelope =
  | {
      source: "pv-content-relay";
      nonce: string;
      kind: "ack";
    }
  | {
      source: "pv-content-relay";
      nonce: string;
      kind: "credential";
      credential: unknown;
      credentialJson: unknown;
      prfCapable?: boolean;
      prfUnavailableReason?: string;
    }
  | {
      source: "pv-content-relay";
      nonce: string;
      kind: "fallthrough";
    }
  | {
      source: "pv-content-relay";
      nonce: string;
      kind: "error";
    };
