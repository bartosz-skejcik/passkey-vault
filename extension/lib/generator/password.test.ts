import { describe, expect, it } from "vitest";
import { generateCharacterPassword, generatePassphrase } from "./password";
import { EFF_WORDLIST } from "./wordlist";

describe("EFF_WORDLIST", () => {
  it("has exactly 7776 entries", () => {
    expect(EFF_WORDLIST.length).toBe(7776);
  });

  it("every entry is a plain lowercase word (letters/hyphens only) with no leftover dice-roll prefix", () => {
    // The EFF Large Wordlist legitimately includes a handful of
    // hyphenated compound words (e.g. "drop-down") — the invariant this
    // guards is "no digits/tabs/whitespace survived vendoring", not
    // "letters only".
    for (const word of EFF_WORDLIST) {
      expect(word).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });
});

describe("generateCharacterPassword", () => {
  it("produces a string of exactly `length` characters", () => {
    for (let i = 0; i < 20; i++) {
      const password = generateCharacterPassword(20, {
        lowercase: true,
        uppercase: true,
        digits: true,
        symbols: false,
      });
      expect(password).toHaveLength(20);
    }
  });

  it("only draws characters from the requested charsets", () => {
    for (let i = 0; i < 20; i++) {
      const password = generateCharacterPassword(64, {
        lowercase: true,
        uppercase: false,
        digits: false,
        symbols: false,
      });
      expect(password).toMatch(/^[a-z]+$/);
    }
  });

  it("draws from the full union when every charset is requested", () => {
    // Run enough iterations that all four classes are overwhelmingly
    // likely to appear at least once across the combined output.
    let combined = "";
    for (let i = 0; i < 30; i++) {
      combined += generateCharacterPassword(32, {
        lowercase: true,
        uppercase: true,
        digits: true,
        symbols: true,
      });
    }
    expect(/[a-z]/.test(combined)).toBe(true);
    expect(/[A-Z]/.test(combined)).toBe(true);
    expect(/[0-9]/.test(combined)).toBe(true);
    expect(/[^a-zA-Z0-9]/.test(combined)).toBe(true);
  });

  it("throws when no character class is selected", () => {
    expect(() =>
      generateCharacterPassword(16, {
        lowercase: false,
        uppercase: false,
        digits: false,
        symbols: false,
      }),
    ).toThrow();
  });
});

describe("generatePassphrase", () => {
  it("produces exactly `wordCount` words joined by the separator", () => {
    const passphrase = generatePassphrase(5, "-");
    const words = passphrase.split("-");
    expect(words).toHaveLength(5);
  });

  it("every word is drawn from EFF_WORDLIST", () => {
    const passphrase = generatePassphrase(6, "-");
    const words = passphrase.split("-");
    for (const word of words) {
      expect(EFF_WORDLIST).toContain(word);
    }
  });

  it("defaults to a '-' separator", () => {
    const passphrase = generatePassphrase(4);
    expect(passphrase.split("-")).toHaveLength(4);
  });
});
