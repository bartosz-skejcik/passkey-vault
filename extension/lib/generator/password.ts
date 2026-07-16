// CSPRNG-only password/passphrase generation (VAULT-05). Never the
// non-cryptographic default JS pseudo-random API — every random draw goes
// through crypto.getRandomValues + rejection sampling (RESEARCH.md
// Pattern 5's "Don't Hand-Roll" table).
import { EFF_WORDLIST } from "./wordlist";

/**
 * Uniformly-distributed random integer in [0, max) via rejection sampling.
 * A naive `crypto.getRandomValues(...) % max` is biased whenever `max`
 * doesn't evenly divide 2**32 — this instead rejects and re-rolls any draw
 * that would fall in the biased remainder region, so every accepted value
 * has exactly equal probability.
 */
function uniformRandomIndex(max: number): number {
  if (max <= 0) {
    throw new Error("uniformRandomIndex: max must be positive");
  }
  const rejectionThreshold = 2 ** 32 - (2 ** 32 % max);
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= rejectionThreshold);
  return value % max;
}

const CHARSET = {
  lowercase: "abcdefghijklmnopqrstuvwxyz",
  uppercase: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digits: "0123456789",
  symbols: "!@#$%^&*()-_=+[]{};:,.<>?",
} as const;

export interface CharacterPasswordOptions {
  lowercase: boolean;
  uppercase: boolean;
  digits: boolean;
  symbols: boolean;
}

/**
 * Generates a `length`-character password drawn only from the union of
 * the requested character classes, via CSPRNG rejection sampling.
 */
export function generateCharacterPassword(
  length: number,
  opts: CharacterPasswordOptions,
): string {
  let alphabet = "";
  if (opts.lowercase) alphabet += CHARSET.lowercase;
  if (opts.uppercase) alphabet += CHARSET.uppercase;
  if (opts.digits) alphabet += CHARSET.digits;
  if (opts.symbols) alphabet += CHARSET.symbols;
  if (alphabet === "") {
    throw new Error("generateCharacterPassword: at least one character class must be selected");
  }

  let result = "";
  for (let i = 0; i < length; i++) {
    result += alphabet[uniformRandomIndex(alphabet.length)];
  }
  return result;
}

/**
 * Generates a `wordCount`-word Diceware-style passphrase, every word drawn
 * uniformly from EFF_WORDLIST via CSPRNG rejection sampling.
 */
export function generatePassphrase(wordCount: number, separator = "-"): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(EFF_WORDLIST[uniformRandomIndex(EFF_WORDLIST.length)]);
  }
  return words.join(separator);
}
