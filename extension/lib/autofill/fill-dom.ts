// lib/autofill/fill-dom.ts — framework-safe DOM value writer shared by all
// four fill kinds (plan 10-05). setNativeValue() bypasses any
// framework-patched instance-level `value` setter (React's classic
// controlled-input pattern) by resolving the value setter from the
// element's own prototype (`HTMLInputElement.prototype`/
// `HTMLTextAreaElement.prototype`) via `Object.getOwnPropertyDescriptor`
// and calling it directly, then dispatching a bubbling `input` event and a
// bubbling `change` event so a React/Vue-controlled component's onChange
// handler actually fires. This is 10-RESEARCH.md's Pitfall 5: a naive
// `input.value = x` writes through whatever instance setter the framework
// installed (or triggers no framework-visible event at all), leaving the
// framework's own state stale -- the field LOOKS filled but the form
// submits the framework's last-known (empty) value.
//
// This module holds no key material and imports no crypto module -- it is
// a pure DOM writer. It never reads a field's EXISTING value and returns
// it anywhere (the flagged FILL-01 prohibition) -- every function here
// only writes.

import type { CardSlots, IdentitySlots } from "./detect-scored";
import type { FillValues } from "./types";

/** The two element kinds a resolved fill target can ever be. */
export type Fillable = HTMLInputElement | HTMLTextAreaElement;

/**
 * Writes `value` into `input` via the native prototype value setter,
 * bypassing any instance-level setter override a framework's reconciler
 * may have installed on this specific DOM node, then dispatches a
 * bubbling `input` event and a bubbling `change` event.
 */
export function setNativeValue(input: Fillable, value: string): void {
  const proto = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) {
    descriptor.set.call(input, value);
  } else {
    // Unreachable in a real browser or jsdom (both always expose this
    // descriptor on their respective prototypes) -- defensive fallback
    // only, still not a literal `.value =` assignment on the passed-in
    // input.
    Reflect.set(input, "value", value);
  }
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export interface LoginTargets {
  username: Fillable | null;
  password: Fillable | null;
}

export interface TotpTargets {
  code: Fillable | null;
}

/** Mirrors detect-scored.ts's CardSlots minus `hasAny` -- the content-relay
 * passes detectCard()'s result straight through as this shape. */
export type CardTargets = Pick<
  CardSlots,
  "cardholderName" | "number" | "cvv" | "expiryMode" | "expiry" | "expiryMonth" | "expiryYear"
>;

/** Mirrors detect-scored.ts's IdentitySlots minus `hasAny`. */
export type IdentityTargets = Pick<
  IdentitySlots,
  "firstName" | "lastName" | "email" | "phone" | "address"
>;

/** The per-kind element map the content-relay resolved via the detectors,
 * one flat shape per FillValues variant (`type` is the shared
 * discriminant). Content-relay re-resolves this fresh on every
 * `content.fill` -- fillValues() itself never re-runs a detector. */
export type FillTargets =
  | ({ type: "login" } & LoginTargets)
  | ({ type: "totp" } & TotpTargets)
  | ({ type: "card" } & CardTargets)
  | ({ type: "identity" } & IdentityTargets);

interface ParsedExpiry {
  month: string;
  yearShort: string;
  yearLong: string;
}

/** Accepts `MM/YY`, `MM/YYYY`, and `MM / YY` (loose whitespace around the
 * slash). Returns null when the raw string doesn't match this shape --
 * callers fall back rather than writing garbage into a split field. */
function parseExpiry(raw: string): ParsedExpiry | null {
  const match = raw.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!match) return null;
  const month = match[1].padStart(2, "0");
  const yearRaw = match[2];
  const yearLong = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  const yearShort = yearRaw.length === 2 ? yearRaw : yearRaw.slice(-2);
  return { month, yearShort, yearLong };
}

/** Picks the 2- or 4-digit form to match `el`'s expected width -- a
 * `maxlength="2"` year field gets the short form ("26"), any other/unset
 * maxlength gets the long form ("2026"). */
function yearForField(el: Fillable, parsed: ParsedExpiry): string {
  return el.maxLength === 2 ? parsed.yearShort : parsed.yearLong;
}

/**
 * Writes `values` into the resolved `targets` element map. Never throws on
 * a missing or detached (SPA-removed) target -- skips it and keeps going.
 * A fill that lands nothing (`filledCount === 0`) is reported as a
 * failure (`ok: false`) so the caller can surface a fill-failed result.
 */
export function fillValues(values: FillValues, targets: FillTargets): { ok: boolean; filledCount: number } {
  let filledCount = 0;

  const write = (el: Fillable | null | undefined, value: string | null | undefined) => {
    if (el == null || value == null) return;
    if (!document.contains(el)) return; // vanished field -- skip, never throw
    setNativeValue(el, value);
    filledCount += 1;
  };

  if (values.type === "login" && targets.type === "login") {
    write(targets.username, values.username);
    write(targets.password, values.password);
  } else if (values.type === "totp" && targets.type === "totp") {
    write(targets.code, values.code);
  } else if (values.type === "card" && targets.type === "card") {
    write(targets.cardholderName, values.cardholderName);
    write(targets.number, values.number);
    write(targets.cvv, values.cvv);

    if (targets.expiryMode === "split" && (targets.expiryMonth || targets.expiryYear)) {
      const parsed = parseExpiry(values.expiry);
      if (parsed) {
        write(targets.expiryMonth, parsed.month);
        write(targets.expiryYear, targets.expiryYear ? yearForField(targets.expiryYear, parsed) : null);
      } else if (targets.expiry) {
        // Parsing failed but a single expiry field also exists -- fall
        // back to writing the raw string there rather than dropping it.
        write(targets.expiry, values.expiry);
      }
      // else: parsing failed and no single expiry field exists -- skip
      // this slot entirely rather than writing a malformed value.
    } else {
      write(targets.expiry, values.expiry);
    }
  } else if (values.type === "identity" && targets.type === "identity") {
    write(targets.firstName, values.firstName);
    write(targets.lastName, values.lastName);
    write(targets.email, values.email);
    write(targets.phone, values.phone);
    write(targets.address, values.address);
  }

  return { ok: filledCount > 0, filledCount };
}
