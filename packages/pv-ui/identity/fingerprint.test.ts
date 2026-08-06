import { describe, expect, it } from "vitest";
import { FINGERPRINT_WORDLIST } from "./fingerprintWordlist";
import { fingerprintToWords, formatFingerprintWords } from "./fingerprint";

// Known-answer vector, hand-computed independently of the implementation
// (see this plan's derivation notes): a fixed 64-char SHA-256-shaped hex
// string, its expected 11-bit indices (leading 66 bits, big-endian,
// 6 x 11-bit groups), and the words those indices resolve to against the
// real vendored FINGERPRINT_WORDLIST.
const KNOWN_HEX = "a3f5c91b7e2d40689fabc123456789deadbeef0011223344556677889900aabb";
const KNOWN_INDICES = [1311, 1394, 566, 2018, 1696, 418];
const KNOWN_WORDS = ["physical", "purity", "egg", "wisdom", "staff", "crowd"];

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

describe("fingerprintToWords", () => {
  it("matches the hand-computed known-answer vector", () => {
    expect(fingerprintToWords(KNOWN_HEX)).toEqual(KNOWN_WORDS);
  });

  it("matches the hand-computed 11-bit indices, not just the resulting words", () => {
    // Guards against an off-by-one in the bit-slicing itself: if the
    // slicing were shifted by even one bit, a different (but still
    // in-range) word could coincidentally look plausible. Comparing the
    // indices closes that gap.
    const words = fingerprintToWords(KNOWN_HEX);
    const actualIndices = words.map((word) => FINGERPRINT_WORDLIST.indexOf(word));
    expect(actualIndices).toEqual(KNOWN_INDICES);
  });

  it("is a total, pure function: identical hex always produces identical words, in identical order", () => {
    const first = fingerprintToWords(KNOWN_HEX);
    const second = fingerprintToWords(KNOWN_HEX);
    expect(second).toEqual(first);
    // repeated calls must not share/mutate any hidden state
    const third = fingerprintToWords(KNOWN_HEX);
    expect(third).toEqual(first);
  });

  it("always returns exactly 6 words", () => {
    expect(fingerprintToWords(KNOWN_HEX)).toHaveLength(6);
  });

  it("throws on a wrong-length hex string rather than silently truncating or padding", () => {
    expect(() => fingerprintToWords(KNOWN_HEX.slice(0, 63))).toThrow();
    expect(() => fingerprintToWords(KNOWN_HEX + "a")).toThrow();
    expect(() => fingerprintToWords("")).toThrow();
  });

  it("throws on non-hex characters rather than silently producing a partial word list", () => {
    const malformed = "g" + KNOWN_HEX.slice(1);
    expect(() => fingerprintToWords(malformed)).toThrow();
    expect(() => fingerprintToWords("not-a-hex-string-at-all-".repeat(3))).toThrow();
  });
});

describe("formatFingerprintWords", () => {
  it("joins the six words with D-4's ' · ' separator", () => {
    expect(formatFingerprintWords(KNOWN_HEX)).toBe(KNOWN_WORDS.join(" · "));
  });

  it("propagates the same fail-closed behavior as fingerprintToWords on malformed input", () => {
    expect(() => formatFingerprintWords("zz")).toThrow();
  });
});
