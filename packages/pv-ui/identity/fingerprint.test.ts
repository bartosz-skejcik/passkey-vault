import { describe, expect, it } from "vitest";
import { FINGERPRINT_WORDLIST } from "./fingerprintWordlist";

describe("wordlist", () => {
  it("has exactly 2048 entries", () => {
    expect(FINGERPRINT_WORDLIST.length).toBe(2048);
  });

  it("every entry is a unique, lowercase, non-empty string", () => {
    const seen = new Set<string>();
    for (const word of FINGERPRINT_WORDLIST) {
      expect(typeof word).toBe("string");
      expect(word.length).toBeGreaterThan(0);
      expect(word).toBe(word.toLowerCase());
      // a duplicate would collapse two distinct 11-bit indices onto the
      // same displayed word, silently reducing collision resistance.
      expect(seen.has(word)).toBe(false);
      seen.add(word);
    }
    expect(seen.size).toBe(2048);
  });
});
