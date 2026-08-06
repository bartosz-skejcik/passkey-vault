// Six-word identity-key fingerprint (D-4, A-9, SEC-05).
//
// WHY this exists: a member enrolling into a shared family compares their
// own and another member's fingerprint out-of-band (usually by voice) to
// detect a malicious server substituting its own public key in place of
// the real recipient's. Hex is error-prone read aloud (B/D/E confusion);
// six words drawn from a fixed list are not. See 26-CONTEXT.md D-4/A-9.
//
// This is a PURE, TOTAL, DETERMINISTIC presentation transform of the
// SHA-256 hex fingerprint the server already computes and serves
// (crates/pv-server/src/routes/families.rs:153-155, typed at
// web/src/lib/families/api.ts:31 as `FamilyMemberRecord.fingerprint`). It
// introduces no new hash, no new server field, and consumes no I/O -- it
// must never vary between two clients given the same hex input, or the
// out-of-band comparison this feature exists for produces false alarms
// and teaches users to distrust (and therefore ignore) real mismatches.
//
// Bit-slicing scheme (A-9): parse the 64-character hex string big-endian
// into 32 bytes, then slice the leading 66 bits (6 words x 11 bits/word,
// since 2048 = 2^11) into six 11-bit unsigned integers, most-significant
// bit first, each indexing FINGERPRINT_WORDLIST.
import { FINGERPRINT_WORDLIST } from "./fingerprintWordlist";

const WORD_COUNT = 6;
const BITS_PER_WORD = 11;
const HEX_LENGTH = 64; // SHA-256 = 32 bytes = 64 hex characters
const HEX_PATTERN = /^[0-9a-fA-F]+$/;

/**
 * Decode a hex string into bytes. Caller must have already validated the
 * string is well-formed (even length, hex digits only).
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Read an 11-bit big-endian unsigned integer starting at `bitOffset` out of
 * `bytes` (MSB of byte 0 is bit 0).
 */
function readBits(bytes: Uint8Array, bitOffset: number, bitCount: number): number {
  let value = 0;
  for (let i = 0; i < bitCount; i++) {
    const bitPos = bitOffset + i;
    const byteIndex = Math.floor(bitPos / 8);
    const bitInByte = 7 - (bitPos % 8);
    const bit = (bytes[byteIndex] >> bitInByte) & 1;
    value = (value << 1) | bit;
  }
  return value;
}

/**
 * Convert a server-supplied SHA-256 hex fingerprint into six words drawn
 * from FINGERPRINT_WORDLIST, in order.
 *
 * FAILS CLOSED (WR-13 discipline): a malformed or wrong-length hex string
 * throws rather than silently truncating, padding, or wrapping around to
 * produce a plausible-looking-but-wrong six-word output. A fingerprint
 * that "looks right" but isn't derived from the real input is worse than
 * an obvious error -- it would pass a careless out-of-band voice check.
 */
export function fingerprintToWords(hex: string): string[] {
  if (typeof hex !== "string" || hex.length === 0) {
    throw new Error("fingerprintToWords: hex fingerprint must be a non-empty string");
  }
  if (!HEX_PATTERN.test(hex)) {
    throw new Error(
      `fingerprintToWords: hex fingerprint must contain only hex digits (0-9a-fA-F), got: "${hex}"`,
    );
  }
  if (hex.length !== HEX_LENGTH) {
    throw new Error(
      `fingerprintToWords: expected a ${HEX_LENGTH}-character SHA-256 hex string ` +
        `(256 bits), got ${hex.length} characters`,
    );
  }

  const bytes = hexToBytes(hex);
  const words: string[] = [];
  for (let i = 0; i < WORD_COUNT; i++) {
    const index = readBits(bytes, i * BITS_PER_WORD, BITS_PER_WORD);
    words.push(FINGERPRINT_WORDLIST[index]);
  }
  return words;
}

// D-4's exact literal example format from 26-CONTEXT.md: six words
// separated by " · " (middot with a space on either side).
const WORD_SEPARATOR = " · ";

/** `fingerprintToWords(hex)` joined with D-4's " · " separator. */
export function formatFingerprintWords(hex: string): string {
  return fingerprintToWords(hex).join(WORD_SEPARATOR);
}
