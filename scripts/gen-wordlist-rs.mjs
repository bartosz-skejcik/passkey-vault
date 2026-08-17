#!/usr/bin/env node
// scripts/gen-wordlist-rs.mjs -- Phase 38, Plan 38-04, Task 1.
//
// Regenerates crates/pv-core/src/generator/wordlist.rs from the canonical
// TypeScript source (packages/pv-ui/generator/wordlist.ts) so a hand copy
// can never drift silently (DR-38-A's "must NOT hand-transcribe the word
// list" prohibition). Prints the SHA-256 of the newline-joined list to
// stdout -- the SAME digest scripts/check-wordlist-parity.mjs independently
// recomputes from the same TypeScript source, so one literal is pinned from
// two directions and a single transposed word cannot survive both.
//
// Usage: node scripts/gen-wordlist-rs.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SOURCE_TS = "packages/pv-ui/generator/wordlist.ts";
const OUT_RS = "crates/pv-core/src/generator/wordlist.rs";
const EXPECTED_LEN = 7776;

// Exported so scripts/check-wordlist-parity.mjs can reuse the SAME
// extraction/digest logic against the SAME TypeScript source -- two
// independently-invoked call sites over one shared implementation, not two
// hand-written regexes that could drift from each other.
export function extractWordlist(tsSource) {
  const match = tsSource.match(
    /export const EFF_WORDLIST: readonly string\[\] = \[([\s\S]*?)\];/,
  );
  if (!match) {
    throw new Error(
      `could not find "export const EFF_WORDLIST: readonly string[] = [...]" in ${SOURCE_TS}`,
    );
  }
  const body = match[1];
  const words = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  return words;
}

export function digestOf(words) {
  return createHash("sha256").update(words.join("\n")).digest("hex");
}

function main() {
  const tsSource = readFileSync(path.join(ROOT, SOURCE_TS), "utf8");
  const words = extractWordlist(tsSource);

  if (words.length !== EXPECTED_LEN) {
    console.error(
      `ERROR: extracted ${words.length} words from ${SOURCE_TS}, expected ${EXPECTED_LEN}`,
    );
    process.exit(1);
  }

  const digest = digestOf(words);

  const rustEntries = words.map((w) => `    "${w}",`).join("\n");
  const rustContent = `// GENERATED FILE -- do not edit by hand.
// Produced by \`node scripts/gen-wordlist-rs.mjs\` from ${SOURCE_TS}.
// Re-run that command to regenerate after the TypeScript source changes --
// never hand-transcribe (DR-38-A, ios/IOS-SPIKE-LOG.md \`### DR-38-A\`).
//
// SHA-256 of the newline-joined list (words.join("\\n")):
// ${digest}
//
// scripts/check-wordlist-parity.mjs independently recomputes this exact
// digest from the SAME TypeScript source and compares it against the
// literal above -- this is what catches a single transposed word, which a
// length-only check cannot.

/// The EFF Large Wordlist (Diceware), ${EXPECTED_LEN} entries -- byte-for-byte
/// the same list as packages/pv-ui/generator/wordlist.ts's EFF_WORDLIST.
pub const EFF_WORDLIST: [&str; ${EXPECTED_LEN}] = [
${rustEntries}
];
`;

  writeFileSync(path.join(ROOT, OUT_RS), rustContent);
  console.log(digest);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
