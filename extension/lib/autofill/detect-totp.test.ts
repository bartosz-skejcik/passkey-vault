// @vitest-environment jsdom
// lib/autofill/detect-totp.test.ts — jsdom coverage for the one-time-code
// detector: standardized signal first, a corroboration-requiring bounded
// fallback second (10-RESEARCH.md Pattern 3). Fixtures are inline HTML
// strings assigned to document.body.innerHTML -- no network, no real
// sites, per 10-02-PLAN.md Task 2.

import { describe, expect, it, beforeEach } from "vitest";
import { detectTotp } from "./detect-totp";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("detectTotp", () => {
  it("Test 1: autocomplete=one-time-code wins outright regardless of other attributes", () => {
    document.body.innerHTML = `
      <input type="text" autocomplete="one-time-code" name="whatever" maxlength="20">
    `;

    const result = detectTotp(document);

    expect(result).toBe(document.querySelector('input[autocomplete="one-time-code"]'));
  });

  it("Test 2: no one-time-code field -- inputmode=numeric + maxlength=6 + code-ish label is returned by the fallback", () => {
    document.body.innerHTML = `
      <label for="code">Verification code</label>
      <input id="code" inputmode="numeric" maxlength="6">
    `;

    const result = detectTotp(document);

    expect(result).toBe(document.querySelector("#code"));
  });

  it("Test 3: a type=password field is NEVER returned as OTP, even with inputmode=numeric + short maxlength", () => {
    document.body.innerHTML = `
      <input type="password" inputmode="numeric" maxlength="6" name="otp">
    `;

    expect(detectTotp(document)).toBeNull();
  });

  it("Test 4: a card CVV (autocomplete=cc-csc) is NEVER returned by the fallback, even with a matching code-ish placeholder", () => {
    document.body.innerHTML = `
      <input id="cvv" autocomplete="cc-csc" maxlength="4" inputmode="numeric" placeholder="Security code">
    `;

    expect(detectTotp(document)).toBeNull();
  });

  it("Test 5: a bare numeric input with no maxlength and no code-ish cue is NOT returned -- fallback requires corroboration", () => {
    document.body.innerHTML = `
      <input id="qty" inputmode="numeric" name="quantity">
    `;

    expect(detectTotp(document)).toBeNull();
  });

  it("Test 6: returns null when nothing qualifies", () => {
    document.body.innerHTML = `
      <input type="text" name="q">
    `;

    expect(detectTotp(document)).toBeNull();
  });
});
