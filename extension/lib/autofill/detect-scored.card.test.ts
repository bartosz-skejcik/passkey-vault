// @vitest-environment jsdom
// lib/autofill/detect-scored.card.test.ts — pins the scored, autocomplete-
// first, threshold-gated card slot resolver (FILL-03, D-05). Covers
// 10-RESEARCH.md Pitfall 1's canonical false positive (a quantity input
// must never be scored as card evidence), the exact threshold boundary,
// the fail-closed tie rule, and the split cc-exp-month/cc-exp-year pair.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { detectCard } from "./detect-scored";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "__fixtures__");

function loadFixture(name: string): string {
  return readFileSync(path.join(FIXTURES, name), "utf-8");
}

function setBody(html: string): void {
  document.body.innerHTML = html;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("detectCard", () => {
  it("Test 1: a well-marked checkout form resolves all four slots", () => {
    setBody(loadFixture("card-checkout.html"));
    const result = detectCard(document);

    expect(result.hasAny).toBe(true);
    expect(result.expiryMode).toBe("single");
    expect(result.cardholderName).toBe(document.getElementById("cc-name"));
    expect(result.number).toBe(document.getElementById("cc-num"));
    expect(result.expiry).toBe(document.getElementById("cc-expiry"));
    expect(result.cvv).toBe(document.getElementById("cc-cvc"));
  });

  it("Test 2 (BOUNDARY): exactly-at-threshold fills, one point below does not", () => {
    // "cvv" fallback keyword weight 13 -> floor(13*0.5) = 6 = FILL_THRESHOLD.
    setBody(`<input id="at-threshold" name="cvv" type="text" />`);
    const atThreshold = detectCard(document);
    expect(atThreshold.cvv).toBe(document.getElementById("at-threshold"));
    expect(atThreshold.hasAny).toBe(true);

    // "cardinfo" fallback keyword weight 11 -> floor(11*0.5) = 5, one below
    // FILL_THRESHOLD -- must never surface as a fillable cardholderName.
    setBody(`<input id="below-threshold" name="card-info-panel" type="text" />`);
    const belowThreshold = detectCard(document);
    expect(belowThreshold.cardholderName).toBeNull();
    expect(belowThreshold.hasAny).toBe(false);
  });

  it("Test 3 (TIE / ADJACENCY): a tied number slot resolves to null; other slots still resolve", () => {
    setBody(`
      <input id="num-a" name="cardnumber" type="text" />
      <input id="num-b" name="card-number" type="text" />
      <input id="cvv-a" autocomplete="cc-csc" type="text" />
    `);
    const result = detectCard(document);

    expect(result.number).toBeNull();
    expect(result.cvv).toBe(document.getElementById("cvv-a"));
    expect(result.hasAny).toBe(true);
  });

  it("Test 4 (FALSE POSITIVE): a quantity + promo-code form yields zero card slots", () => {
    setBody(`
      <input id="qty" name="quantity" type="text" inputmode="numeric" />
      <input id="promo" name="promo-code" type="text" />
    `);
    const result = detectCard(document);

    expect(result.cardholderName).toBeNull();
    expect(result.number).toBeNull();
    expect(result.expiry).toBeNull();
    expect(result.cvv).toBeNull();
    expect(result.hasAny).toBe(false);
  });

  it("Test 5 (EMPTY): an empty document and an evidence-free document both yield all-null slots", () => {
    setBody("");
    const empty = detectCard(document);
    expect(empty.hasAny).toBe(false);
    expect(empty.cardholderName).toBeNull();
    expect(empty.number).toBeNull();
    expect(empty.expiry).toBeNull();
    expect(empty.cvv).toBeNull();

    setBody(`<input id="notes" name="notes" type="text" />`);
    const noEvidence = detectCard(document);
    expect(noEvidence.hasAny).toBe(false);
    expect(noEvidence.cardholderName).toBeNull();
    expect(noEvidence.number).toBeNull();
    expect(noEvidence.expiry).toBeNull();
    expect(noEvidence.cvv).toBeNull();
  });

  it("Test 6: an unmarked-but-conventional form resolves via the fallback tier", () => {
    setBody(loadFixture("card-fallback.html"));
    const result = detectCard(document);

    expect(result.hasAny).toBe(true);
    expect(result.cardholderName).not.toBeNull();
    expect(result.number).not.toBeNull();
    expect(result.expiry).not.toBeNull();
    expect(result.cvv).not.toBeNull();
  });

  it("Test 7: a hidden or disabled input with a perfect autocomplete match is NOT returned", () => {
    setBody(`<input id="hidden-cc" type="hidden" autocomplete="cc-number" value="4111111111111111" />`);
    expect(detectCard(document).number).toBeNull();

    setBody(`<input id="disabled-cc" disabled autocomplete="cc-number" type="text" />`);
    expect(detectCard(document).number).toBeNull();

    setBody(`<input id="css-hidden-cc" style="display:none" autocomplete="cc-number" type="text" />`);
    expect(detectCard(document).number).toBeNull();
  });

  it("Test 8 (PRECISION): split cc-exp-month/cc-exp-year resolve as a pair, not a single field", () => {
    setBody(`
      <input id="exp-month" autocomplete="cc-exp-month" type="text" />
      <input id="exp-year" autocomplete="cc-exp-year" type="text" />
    `);
    const result = detectCard(document);

    expect(result.expiryMode).toBe("split");
    expect(result.expiry).toBeNull();
    expect(result.expiryMonth).toBe(document.getElementById("exp-month"));
    expect(result.expiryYear).toBe(document.getElementById("exp-year"));
    expect(result.hasAny).toBe(true);
  });
});
