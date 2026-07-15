// lib/autofill/types.ts — shapes shared across content-relay (ISOLATED
// world), background and popup for Phase 10 (Autofill). Card/identity field
// names match web/src/lib/vault/types.ts EXACTLY (cardholderName/number/
// expiry/cvv, firstName/lastName/email/phone/address) -- no parallel shape
// is invented here.
//
// Two distinct channels share this module:
//  - popup <-> background: the `autofill.*` Message kinds in
//    lib/messaging/ext-protocol.ts (AutofillMatchResult etc.) import
//    FillKind/DetectedFields/AutofillMatch from here.
//  - background <-> content-relay (a SEPARATE direction, over
//    browser.tabs.sendMessage(tabId, msg, {frameId}) -- NOT the popup<->
//    background Message union): ContentDetectRequest/Response and
//    ContentFillRequest/Response, defined at the bottom of this file. Plans
//    10-04 (background) and 10-05 (content-relay) are the two ends.
// Keeping both directions in one module is what makes "one contract" true
// across all three contexts.

/** Vault item types that have something to autofill INTO a page. "note" is
 * a vault item type (see web/src/lib/vault/types.ts's ItemType) but has no
 * fill target -- deliberately excluded from FillKind. */
export type FillKind = "login" | "totp" | "card" | "identity";

/** Which field families the content-relay detected present on the current
 * page/frame -- drives autofill.match's per-kind offering and the popup's
 * enabled/disabled affordances (10-UI-SPEC.md). */
export type DetectedFields = Record<FillKind, boolean>;

/** Metadata-only match result surfaced to the popup -- no field values, no
 * derived secrets. `maskedHint` is e.g. "••••1234" or "j***@example.com",
 * never a live credential value. */
export interface AutofillMatch {
  itemId: string;
  kind: FillKind;
  label: string;
  maskedHint: string;
}

/** An explicitly-addressed fill destination -- always a concrete frameId,
 * never "the active tab" left implicit (D-04 / frame-guard.ts). */
export interface FillTarget {
  tabId: number;
  frameId: number;
  origin: string;
}

/**
 * Plaintext values for a single fill write, background -> content-relay
 * only -- never sent to or through the popup (D-02, zero-knowledge
 * boundary). TOTP carries the DERIVED `code` only; the underlying seed
 * value never leaves the background context.
 */
export type FillValues =
  | { type: "login"; username: string; password: string }
  | { type: "totp"; code: string }
  | { type: "card"; cardholderName: string; number: string; expiry: string; cvv: string }
  | {
      type: "identity";
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      address: string;
    };

// ---------------------------------------------------------------------------
// background <-> content-relay channel (tabs.sendMessage(tabId, msg,
// {frameId}) -- a separate direction from the popup<->background `Message`
// union in lib/messaging/ext-protocol.ts). Plan 10-04 (background) and 10-05
// (content-relay) are the two ends; kept here so all three contexts import
// from one shared module.
// ---------------------------------------------------------------------------

export interface ContentDetectRequest {
  kind: "content.detect";
}

export interface ContentDetectResponse {
  detected: DetectedFields;
  hasOtpField: boolean;
}

export interface ContentFillRequest {
  kind: "content.fill";
  values: FillValues;
}

export interface ContentFillResponse {
  ok: boolean;
}
