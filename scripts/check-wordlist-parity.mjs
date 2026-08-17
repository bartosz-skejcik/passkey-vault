#!/usr/bin/env node
// scripts/check-wordlist-parity.mjs -- Phase 38, Plan 38-04, Task 1.
//
// Recomputes the SHA-256 of the newline-joined TypeScript word list
// (packages/pv-ui/generator/wordlist.ts) and compares it against the
// literal pinned in the header of the GENERATED Rust file
// (crates/pv-core/src/generator/wordlist.rs, produced by
// scripts/gen-wordlist-rs.mjs). Exits non-zero on mismatch.
//
// This script and generator.rs's own `wordlist_digest` test pin the SAME
// literal from two independent directions -- Node recomputing from
// TypeScript here, Rust asserting its own compiled-in array against a
// pasted literal there -- so a single transposed word in EITHER source
// fails at least one side. A length check alone (7776 == 7776) cannot see
// a transposition; this can.
//
// Usage: node scripts/check-wordlist-parity.mjs [expected-digest-hex]
//   With no argument, reads the pinned literal out of the generated Rust
//   file's own header comment.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractWordlist, digestOf } from "./gen-wordlist-rs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SOURCE_TS = "packages/pv-ui/generator/wordlist.ts";
const GENERATED_RS = "crates/pv-core/src/generator/wordlist.rs";

function readExpectedDigestFromRustHeader() {
  const rsContent = readFileSync(path.join(ROOT, GENERATED_RS), "utf8");
  const match = rsContent.match(
    /SHA-256 of the newline-joined list[\s\S]*?\n\/\/ ([0-9a-f]{64})/,
  );
  if (!match) {
    throw new Error(
      `could not find a pinned SHA-256 literal in ${GENERATED_RS}'s header comment`,
    );
  }
  return match[1];
}

function main() {
  const expected = process.argv[2] ?? readExpectedDigestFromRustHeader();

  const tsSource = readFileSync(path.join(ROOT, SOURCE_TS), "utf8");
  const words = extractWordlist(tsSource);
  const actual = digestOf(words);

  if (actual !== expected) {
    console.error(`ERROR: wordlist parity FAILED`);
    console.error(`  expected (from ${GENERATED_RS}): ${expected}`);
    console.error(`  actual   (recomputed from ${SOURCE_TS}): ${actual}`);
    process.exit(1);
  }

  console.log(`wordlist parity OK -- ${words.length} words, digest ${actual}`);
}

main();
