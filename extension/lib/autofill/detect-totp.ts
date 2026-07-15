// lib/autofill/detect-totp.ts — one-time-code detection: the standardized
// autocomplete signal wins outright; a bounded, corroboration-requiring
// fallback applies only when no standardized field exists (10-RESEARCH.md
// Pattern 3). Pure DOM analysis over a Document/Element -- no crypto, no
// chrome.* calls, no key material.

import { isFillableInput } from "./detect-login";

/** Every DOM-read attribute is bounded to this length before matching --
 * these strings are attacker-controlled input from an untrusted page
 * (10-RESEARCH.md ASVS V5). A pathologically long aria-label must not
 * become a performance problem in the matcher (T-10-07). */
const MAX_ATTR_LEN = 200;

/** Small, explicit code-ish vocabulary (10-02-PLAN.md Task 2). Includes the
 * Polish "kod" -- the product's primary UI language is Polish, so a
 * Polish-language site is a first-class case, not an afterthought. */
const CODE_VOCAB = [
  "otp",
  "totp",
  "2fa",
  "mfa",
  "code",
  "token",
  "verification",
  "authenticator",
  "kod",
];

/** autocomplete tokens that mark a card-payment field. Explicit rather than
 * a bare prefix test so "cc-csc" (the CVV box) is unambiguously present in
 * this file as a literal, load-bearing exclusion -- T-10-06's mitigation,
 * not defensive padding: a checkout page is exactly where a short numeric
 * field with a small maxlength lives, and filling a TOTP code into a CVV
 * box would be both a visible bug and a trust breach (Test 4). */
const CREDIT_CARD_AUTOCOMPLETE_PREFIXES = ["cc-csc", "cc-number", "cc-name", "cc-exp", "cc-type"];

function bound(value: string | null | undefined): string {
  return (value ?? "").slice(0, MAX_ATTR_LEN);
}

function autocompleteTokens(el: HTMLInputElement): string[] {
  return bound(el.getAttribute("autocomplete")).toLowerCase().split(/\s+/).filter(Boolean);
}

function isCreditCardField(el: HTMLInputElement): boolean {
  return autocompleteTokens(el).some(
    (token) =>
      CREDIT_CARD_AUTOCOMPLETE_PREFIXES.includes(token) ||
      (token.startsWith("cc-") && token !== "cc-")
  );
}

function labelTextFor(el: HTMLInputElement): string {
  const id = el.getAttribute("id");
  if (id && el.ownerDocument) {
    const escaped = id.replace(/(["\\])/g, "\\$1");
    const label = el.ownerDocument.querySelector(`label[for="${escaped}"]`);
    if (label) return bound(label.textContent);
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel) return bound(wrappingLabel.textContent);
  return "";
}

/** A code-ish textual cue in the field's own name/id/placeholder/aria-label
 * or its associated <label>, matched against CODE_VOCAB. Required as
 * corroboration alongside the numeric+bounded-maxlength shape -- an
 * unbounded numeric input is a quantity box as often as a code box
 * (Test 5), so shape alone is never sufficient for the fallback tier. */
function hasCodeCue(el: HTMLInputElement): boolean {
  const haystack = [
    bound(el.getAttribute("name")),
    bound(el.getAttribute("id")),
    bound(el.getAttribute("placeholder")),
    bound(el.getAttribute("aria-label")),
    labelTextFor(el),
  ]
    .join(" ")
    .toLowerCase();

  return CODE_VOCAB.some((word) => haystack.includes(word));
}

function maxLengthInRange(el: HTMLInputElement): boolean {
  const raw = el.getAttribute("maxlength");
  if (raw === null) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 4 && n <= 8;
}

function isNumericShaped(el: HTMLInputElement): boolean {
  if (el.getAttribute("inputmode") === "numeric") return true;
  if (el.type === "tel") return true;
  const pattern = bound(el.getAttribute("pattern"));
  if (pattern && /\\d/.test(pattern)) return true;
  return false;
}

/**
 * Tier 2 (fallback): qualifies ONLY when all of the following hold
 * simultaneously (10-02-PLAN.md Task 2) --
 *   - not `type="password"`
 *   - not a card-payment `autocomplete` field (cc-csc/cc-number/any cc-*)
 *   - numeric-shaped: `inputmode="numeric"`, or `type="tel"`, or a
 *     `pattern` containing `\d`
 *   - `maxlength` between 4 and 8 inclusive
 *   - a code-ish textual cue is present (hasCodeCue)
 */
function qualifiesAsFallbackOtp(el: HTMLInputElement): boolean {
  if (el.type === "password") return false;
  if (isCreditCardField(el)) return false;
  if (!isNumericShaped(el)) return false;
  if (!maxLengthInRange(el)) return false;
  if (!hasCodeCue(el)) return false;
  return true;
}

/**
 * Detects a one-time-code (TOTP/2FA) input field. Tier 1 -- the first
 * fillable `input[autocomplete="one-time-code"]` -- wins outright and is
 * returned immediately when present, regardless of any other attribute.
 * Tier 2 -- the bounded, corroboration-requiring fallback -- only runs
 * when tier 1 found nothing. Returns `null` when neither tier qualifies.
 *
 * Reuses `isFillableInput()` from `detect-login.ts` rather than
 * duplicating the honeypot/anti-bot predicate.
 */
export function detectTotp(root: Document | Element): HTMLInputElement | null {
  const fillable = Array.from(root.querySelectorAll<HTMLInputElement>("input")).filter(
    isFillableInput
  );

  const standardized = fillable.find((el) => autocompleteTokens(el).includes("one-time-code"));
  if (standardized) return standardized;

  return fillable.find(qualifiesAsFallbackOtp) ?? null;
}
