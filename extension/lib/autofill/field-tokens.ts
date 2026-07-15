// lib/autofill/field-tokens.ts — weight tables, threshold and fallback
// vocabulary for the scored card/identity detector (detect-scored.ts).
// Every magic number the scorer uses lives HERE — detect-scored.ts imports
// them and never inlines a weight or the threshold itself (D-05).
//
// Scoring tiers (10-RESEARCH.md Pattern 2, D-05):
//   1. `autocomplete` token match (CARD_AUTOCOMPLETE_TOKENS /
//      IDENTITY_AUTOCOMPLETE_TOKENS) — full weight, short-circuits the
//      fallback tier entirely for that field. This IS the "autocomplete-
//      first" guarantee: a standardized token is never second-guessed by
//      weaker name/id/label evidence.
//   2. name/id/placeholder/label keyword match (KEYWORD_FALLBACK) — capped
//      at floor(weight * 0.5), so the fallback tier can never structurally
//      out-score an exact autocomplete token for the same slot, even
//      though it can still clear FILL_THRESHOLD on its own (Test 6:
//      "cardnumber"/"cvv" with no autocomplete attribute at all).
//
// Slot names match web/src/lib/vault/types.ts's CardFields/IdentityFields
// EXACTLY — no parallel shape is invented here.

/** Fillable card slots — mirrors CardFields' non-common, non-`type` keys. */
export type CardSlot = "cardholderName" | "number" | "expiry" | "cvv";

/** Fillable identity slots — mirrors IdentityFields' non-common,
 * non-`type` keys. */
export type IdentitySlot = "firstName" | "lastName" | "email" | "phone" | "address";

interface TokenWeight<S extends string> {
  slot: S;
  weight: number;
}

/**
 * Standardized `autocomplete` token → { slot, weight }. Keys are the exact
 * lowercased token string as it appears in the `autocomplete` attribute.
 * Weights are illustrative, not tuned (10-RESEARCH.md A4) — see
 * FILL_THRESHOLD's comment for the tuning rule that governs any change
 * here.
 */
export const CARD_AUTOCOMPLETE_TOKENS: Record<string, TokenWeight<CardSlot>> = {
  "cc-number": { slot: "number", weight: 10 },
  "cc-csc": { slot: "cvv", weight: 10 },
  "cc-exp": { slot: "expiry", weight: 10 },
  "cc-exp-month": { slot: "expiry", weight: 9 },
  "cc-exp-year": { slot: "expiry", weight: 9 },
  "cc-name": { slot: "cardholderName", weight: 8 },
  "cc-given-name": { slot: "cardholderName", weight: 7 },
  "cc-family-name": { slot: "cardholderName", weight: 7 },
};

export const IDENTITY_AUTOCOMPLETE_TOKENS: Record<string, TokenWeight<IdentitySlot>> = {
  "given-name": { slot: "firstName", weight: 8 },
  "family-name": { slot: "lastName", weight: 8 },
  email: { slot: "email", weight: 9 },
  tel: { slot: "phone", weight: 8 },
  "tel-national": { slot: "phone", weight: 8 },
  "street-address": { slot: "address", weight: 8 },
  "address-line1": { slot: "address", weight: 8 },
  // "name" is ambiguous between a full-name field and a given-name field —
  // deliberately weak (5, below FILL_THRESHOLD on its own even before the
  // 0.5 cap would apply) so a lone `autocomplete="name"` never manufactures
  // a confident firstName fill by itself.
  name: { slot: "firstName", weight: 5 },
};

/**
 * `FILL_THRESHOLD` is the minimum score (autocomplete tier OR capped
 * fallback tier, whichever is higher for a given field) required for that
 * field to be returned as fillable at all — this is a GATE, not merely a
 * ranking cutoff (must_haves truth #2).
 *
 * 10-RESEARCH.md's Assumptions Log A4 records that this number and the
 * weight tables above are illustrative, not tuned against real forms at
 * plan-authoring time; 10-CONTEXT.md's Discretion Areas explicitly assigns
 * tuning to whoever implements this against real checkout/identity forms.
 * The rule when tuning: raising the threshold costs coverage (fewer forms
 * detected), lowering it costs trust (more wrong-field offers) — per
 * 10-RESEARCH.md Pitfall 1, a fill affordance on the wrong field erodes
 * trust faster than no affordance at all, so when in doubt prefer a missed
 * fill over a wrong one and leave the threshold where it is or raise it.
 */
export const FILL_THRESHOLD = 6;

/** One fallback-vocabulary entry: matching `keyword` inside a field's
 * normalized haystack contributes `floor(weight * 0.5)` to that field's
 * score for `slot`, only when the field carries no recognized
 * `autocomplete` token (tier 2, never consulted before tier 1 fails). */
interface KeywordEntry<S extends string> {
  keyword: string;
  slot: S;
  weight: number;
}

/**
 * Normalizes a haystack fragment (or a KEYWORD_FALLBACK keyword) for
 * matching: lowercase, then strip everything that is not an ASCII letter
 * or digit. This makes `card_number`, `cardNumber` and `card-number` (and
 * their Polish-diacritic equivalents, which are stripped to their closest
 * ASCII skeleton) all collapse onto one comparable form. Exported so
 * detect-scored.ts builds its haystack with the exact same rule this
 * module used to author its keyword list — one normalization function,
 * never two independently-maintained ones.
 */
export function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Weights below are chosen so a strong single-purpose fallback keyword
// (e.g. "cardnumber", "cvv") clears FILL_THRESHOLD on its own after the
// 0.5 cap, while staying below the top autocomplete-tier score for the
// same slot (10 for number/csc/expiry) — the fallback tier earns real
// coverage (Test 6) without ever being able to out-rank an exact token.
const CARD_KEYWORDS: Array<KeywordEntry<CardSlot>> = [
  { keyword: "cardnumber", slot: "number", weight: 14 },
  { keyword: "card-number", slot: "number", weight: 14 },
  { keyword: "numerkarty", slot: "number", weight: 14 },
  { keyword: "cvv", slot: "cvv", weight: 13 },
  { keyword: "cvc", slot: "cvv", weight: 13 },
  { keyword: "kodcvv", slot: "cvv", weight: 13 },
  { keyword: "securitycode", slot: "cvv", weight: 13 },
  { keyword: "expiry", slot: "expiry", weight: 13 },
  { keyword: "expdate", slot: "expiry", weight: 13 },
  { keyword: "waznosc", slot: "expiry", weight: 13 },
  { keyword: "dataważności", slot: "expiry", weight: 13 },
  { keyword: "cardholder", slot: "cardholderName", weight: 12 },
  { keyword: "imienazwiskonakarcie", slot: "cardholderName", weight: 12 },
  { keyword: "nameoncard", slot: "cardholderName", weight: 12 },
];

const IDENTITY_KEYWORDS: Array<KeywordEntry<IdentitySlot>> = [
  { keyword: "firstname", slot: "firstName", weight: 13 },
  { keyword: "imie", slot: "firstName", weight: 13 },
  { keyword: "lastname", slot: "lastName", weight: 13 },
  { keyword: "nazwisko", slot: "lastName", weight: 13 },
  { keyword: "email", slot: "email", weight: 14 },
  { keyword: "telefon", slot: "phone", weight: 13 },
  { keyword: "phone", slot: "phone", weight: 13 },
  { keyword: "adres", slot: "address", weight: 12 },
  { keyword: "street", slot: "address", weight: 12 },
  { keyword: "ulica", slot: "address", weight: 12 },
  { keyword: "kodpocztowy", slot: "address", weight: 11 },
  { keyword: "postal", slot: "address", weight: 11 },
];

/** Pre-normalized fallback vocabulary, keyed by family so detect-scored.ts
 * only iterates the entries relevant to the slot family it's resolving. */
export const KEYWORD_FALLBACK: {
  card: Array<KeywordEntry<CardSlot>>;
  identity: Array<KeywordEntry<IdentitySlot>>;
} = {
  card: CARD_KEYWORDS.map((e) => ({ ...e, keyword: normalizeToken(e.keyword) })),
  identity: IDENTITY_KEYWORDS.map((e) => ({ ...e, keyword: normalizeToken(e.keyword) })),
};

/** Applies the fallback tier's structural cap — never inline `* 0.5` or
 * `Math.floor` at a call site, this is the one place that rule lives. */
export function cappedFallbackScore(weight: number): number {
  return Math.floor(weight * 0.5);
}
