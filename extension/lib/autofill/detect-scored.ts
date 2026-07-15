// lib/autofill/detect-scored.ts — scored, autocomplete-first, threshold-
// gated detector for credit-card (FILL-03) and identity (FILL-04) fields
// (D-05). Every weight and the threshold live in field-tokens.ts; this
// module only implements the scoring/resolution ALGORITHM, never an
// inlined number.
//
// This module resolves ELEMENTS only. It never reads or writes a field's
// current text -- that is plan 10-05's fill-dom.ts job. It imports no
// crypto module and holds no key material: it is pure DOM analysis of an
// untrusted page (content-relay ISOLATED world <-> page DOM trust
// boundary, T-10-09..T-10-12).
//
// Plan 10-02 (detect-login.ts) runs in a parallel worktree and is not
// available at this plan's execution time -- this module is deliberately
// self-contained against DOM primitives and field-tokens.ts only, per the
// orchestrator's resolved_facts, rather than importing a sibling module
// that does not exist yet in this worktree.

import type { CardSlot, IdentitySlot } from "./field-tokens";
import {
  CARD_AUTOCOMPLETE_TOKENS,
  cappedFallbackScore,
  FILL_THRESHOLD,
  IDENTITY_AUTOCOMPLETE_TOKENS,
  KEYWORD_FALLBACK,
  normalizeToken,
} from "./field-tokens";

/** ASVS V5: every DOM-read string is bounded before it is concatenated
 * into the matching haystack -- a hostile page must not be able to feed
 * an unbounded attribute value into the matcher (T-10-10). */
const MAX_ATTR_LEN = 200;

/** Control types that are never a plausible fill target regardless of how
 * well their markup scores. */
const NON_FILLABLE_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "checkbox",
  "radio",
  "file",
  "image",
  "reset",
  "range",
  "color",
]);

function isElementHidden(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.hasAttribute("hidden")) {
      return true;
    }
    const style = node.getAttribute("style") ?? "";
    if (/display\s*:\s*none/i.test(style) || /visibility\s*:\s*hidden/i.test(style)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Whether an input is a plausible fill target at all: excludes non-text-ish
 * control types, disabled/readonly inputs, and inputs hidden from the user
 * (T-10-11 -- a hidden or offscreen input must never become a fill target
 * just because its markup scores well, Test 7).
 */
export function isFillableInput(input: HTMLInputElement): boolean {
  const type = (input.getAttribute("type") ?? "text").toLowerCase();
  if (NON_FILLABLE_TYPES.has(type)) {
    return false;
  }
  if (input.disabled || input.readOnly) {
    return false;
  }
  if (isElementHidden(input)) {
    return false;
  }
  return true;
}

function bounded(raw: string | null | undefined): string {
  return (raw ?? "").slice(0, MAX_ATTR_LEN);
}

function labelText(input: HTMLInputElement): string {
  const viaLabels = input.labels;
  if (viaLabels && viaLabels.length > 0) {
    return Array.from(viaLabels)
      .map((label) => label.textContent ?? "")
      .join(" ");
  }
  const ancestor = input.closest("label");
  return ancestor ? (ancestor.textContent ?? "") : "";
}

/** Builds the normalized haystack the keyword-fallback tier matches
 * against: name + id + placeholder + aria-label + associated label text,
 * each individually length-bounded before concatenation, then lowercased
 * with non-alphanumerics stripped via the SAME normalizeToken() the
 * fallback vocabulary itself was normalized with. */
function buildHaystack(input: HTMLInputElement): string {
  const raw = [
    bounded(input.getAttribute("name")),
    bounded(input.getAttribute("id")),
    bounded(input.getAttribute("placeholder")),
    bounded(input.getAttribute("aria-label")),
    bounded(labelText(input)),
  ].join(" ");
  return normalizeToken(raw);
}

interface Candidate<S extends string> {
  input: HTMLInputElement;
  slot: S;
  score: number;
  /** The raw, lowercased `autocomplete` attribute value that produced this
   * candidate via the tier-1 short-circuit, or null when this candidate
   * came from the tier-2 keyword fallback. Only used to distinguish
   * cc-exp-month/cc-exp-year for the split-expiry pairing below. */
  autocompleteToken: string | null;
}

function scoreField<S extends string>(
  input: HTMLInputElement,
  tokenTable: Record<string, { slot: S; weight: number }>,
  fallbackList: Array<{ keyword: string; slot: S; weight: number }>,
): Candidate<S> | null {
  const rawToken = (input.getAttribute("autocomplete") ?? "").trim().toLowerCase();
  const tokenEntry = rawToken ? tokenTable[rawToken] : undefined;
  if (tokenEntry) {
    // Autocomplete-first short-circuit (D-05, must_haves truth #1): an
    // exact standardized token is never second-guessed by the weaker
    // keyword-fallback tier for this field -- tier 2 is not even
    // consulted here.
    return { input, slot: tokenEntry.slot, score: tokenEntry.weight, autocompleteToken: rawToken };
  }

  // Tier 2 (keyword fallback) -- only reached when autocomplete is
  // absent or unrecognized.
  const haystack = buildHaystack(input);
  let best: { slot: S; score: number } | null = null;
  for (const entry of fallbackList) {
    if (haystack.includes(entry.keyword)) {
      const capped = cappedFallbackScore(entry.weight);
      if (!best || capped > best.score) {
        best = { slot: entry.slot, score: capped };
      }
    }
  }
  if (!best) {
    return null;
  }
  return { input, slot: best.slot, score: best.score, autocompleteToken: null };
}

/**
 * Resolves a group of same-slot candidates to a single winning element:
 * the highest score wins; an EXACT tie among the top score fails CLOSED
 * to null rather than picking document order (T-10-12, must_haves truth
 * #4, Test 3/Test 11). A tie means the page gave genuinely ambiguous
 * evidence -- silently guessing is how a value lands in the wrong field.
 * Do not "fix" this into a first-wins: the tie-refusal is deliberate.
 */
function resolveHighest(
  candidates: Array<{ input: HTMLInputElement; score: number }>,
): HTMLInputElement | null {
  if (candidates.length === 0) {
    return null;
  }
  const topScore = Math.max(...candidates.map((c) => c.score));
  const winners = candidates.filter((c) => c.score === topScore);
  return winners.length === 1 ? winners[0].input : null;
}

function collectCandidates<S extends string>(
  root: Document | Element,
  tokenTable: Record<string, { slot: S; weight: number }>,
  fallbackList: Array<{ keyword: string; slot: S; weight: number }>,
): Array<Candidate<S>> {
  const inputs = Array.from(root.querySelectorAll<HTMLInputElement>("input"));
  const out: Array<Candidate<S>> = [];
  for (const input of inputs) {
    if (!isFillableInput(input)) {
      continue;
    }
    const scored = scoreField(input, tokenTable, fallbackList);
    // Threshold gate (must_haves truth #2): dropped here, before
    // resolution -- a below-threshold field is never even a tie-breaking
    // candidate for its slot, let alone a returned result.
    if (scored && scored.score >= FILL_THRESHOLD) {
      out.push(scored);
    }
  }
  return out;
}

export interface CardSlots {
  cardholderName: HTMLInputElement | null;
  number: HTMLInputElement | null;
  cvv: HTMLInputElement | null;
  /** "split" when cc-exp-month and cc-exp-year both resolved as a pair
   * (Test 8); "single" otherwise (expiry holds the one field, or nothing
   * resolved at all). */
  expiryMode: "single" | "split";
  expiry: HTMLInputElement | null;
  expiryMonth: HTMLInputElement | null;
  expiryYear: HTMLInputElement | null;
  hasAny: boolean;
}

export function detectCard(root: Document | Element): CardSlots {
  const candidates = collectCandidates(root, CARD_AUTOCOMPLETE_TOKENS, KEYWORD_FALLBACK.card);
  const bySlot = (slot: CardSlot) => candidates.filter((c) => c.slot === slot);

  const cardholderName = resolveHighest(bySlot("cardholderName"));
  const number = resolveHighest(bySlot("number"));
  const cvv = resolveHighest(bySlot("cvv"));

  const expiryCandidates = bySlot("expiry");
  // cc-exp-month and cc-exp-year are two DISTINCT exact autocomplete
  // tokens that both map to the "expiry" slot in field-tokens.ts, but
  // represent two separate <input> elements on a split-expiry form. When
  // both are present, report them as a pair rather than collapsing them
  // into a single "expiry" resolution -- the filler needs to write MM and
  // YYYY into two different inputs (Test 8, precision).
  const monthCandidates = expiryCandidates.filter((c) => c.autocompleteToken === "cc-exp-month");
  const yearCandidates = expiryCandidates.filter((c) => c.autocompleteToken === "cc-exp-year");

  let expiryMode: "single" | "split" = "single";
  let expiry: HTMLInputElement | null = null;
  let expiryMonth: HTMLInputElement | null = null;
  let expiryYear: HTMLInputElement | null = null;

  if (monthCandidates.length > 0 && yearCandidates.length > 0) {
    expiryMode = "split";
    expiryMonth = resolveHighest(monthCandidates);
    expiryYear = resolveHighest(yearCandidates);
  } else {
    expiry = resolveHighest(expiryCandidates);
  }

  const hasAny =
    cardholderName !== null ||
    number !== null ||
    cvv !== null ||
    expiry !== null ||
    expiryMonth !== null ||
    expiryYear !== null;

  return { cardholderName, number, cvv, expiryMode, expiry, expiryMonth, expiryYear, hasAny };
}

export interface IdentitySlots {
  firstName: HTMLInputElement | null;
  lastName: HTMLInputElement | null;
  email: HTMLInputElement | null;
  phone: HTMLInputElement | null;
  address: HTMLInputElement | null;
  hasAny: boolean;
}

export function detectIdentity(root: Document | Element): IdentitySlots {
  const candidates = collectCandidates(root, IDENTITY_AUTOCOMPLETE_TOKENS, KEYWORD_FALLBACK.identity);
  const bySlot = (slot: IdentitySlot) => candidates.filter((c) => c.slot === slot);

  const firstName = resolveHighest(bySlot("firstName"));
  const lastName = resolveHighest(bySlot("lastName"));
  const email = resolveHighest(bySlot("email"));
  const phone = resolveHighest(bySlot("phone"));
  const address = resolveHighest(bySlot("address"));

  const hasAny =
    firstName !== null || lastName !== null || email !== null || phone !== null || address !== null;

  return { firstName, lastName, email, phone, address, hasAny };
}
