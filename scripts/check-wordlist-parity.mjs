#!/usr/bin/env node
// scripts/check-wordlist-parity.mjs -- Phase 38, Plan 38-04, Task 1.
//
// Recomputes the SHA-256 of the newline-joined TypeScript word list
// (packages/pv-ui/generator/wordlist.ts) and compares it against the
// literal pinned in the header of the GENERATED Rust file
// (crates/pv-core/src/generator/wordlist.rs, produced by
// scripts/gen-wordlist-rs.mjs). Exits non-zero on mismatch.
//
// This script recomputes ONE digest from TypeScript and checks it against
// BOTH Rust-side consumers of that digest:
//   1. `wordlist.rs`'s own GENERATED header comment (produced by
//      `gen-wordlist-rs.mjs`).
//   2. `generator.rs`'s `EXPECTED_WORDLIST_SHA256` test constant, which
//      independently hashes the COMPILED Rust array and asserts it equals
//      that literal.
//
// WR-08 (38-REVIEW.md): before this fix, checks 1 and 2 were pinned from
// TWO DIFFERENT literals with nothing asserting they were ever equal to
// each other -- this script never hashed the Rust array, and
// `generator.rs`'s own test never compared against `wordlist.rs`'s header.
// Edit the generated array by hand AND update the test constant (or leave
// a stale header comment) and both sides would pass while TypeScript and
// Rust disagreed -- exactly the transposition this pair is advertised to
// catch. Recomputing ONE digest here and checking it against BOTH
// consumers closes that gap: the three values (TypeScript, `wordlist.rs`'s
// header, `generator.rs`'s constant) are now pinned as one.
//
// A length check alone (7776 == 7776) cannot see a transposition; this can.
//
// Usage: node scripts/check-wordlist-parity.mjs [expected-digest-hex]
//   With no argument, reads the pinned literal out of the generated Rust
//   file's own header comment (still checked against `generator.rs`'s
//   constant regardless of where `expected` came from).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extractWordlist, digestOf } from "./gen-wordlist-rs.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const SOURCE_TS = "packages/pv-ui/generator/wordlist.ts";
const GENERATED_RS = "crates/pv-core/src/generator/wordlist.rs";
const GENERATOR_RS = "crates/pv-core/src/generator.rs";

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

// WR-08 fix: the SECOND consumer -- `generator.rs`'s own test constant,
// which hashes the COMPILED Rust array, not the generated file's header
// comment. A two-line regex read, as the finding names.
function readExpectedDigestFromGeneratorConstant() {
  const rsContent = readFileSync(path.join(ROOT, GENERATOR_RS), "utf8");
  const match = rsContent.match(
    /EXPECTED_WORDLIST_SHA256:\s*&str\s*=\s*\n?\s*"([0-9a-f]{64})"/,
  );
  if (!match) {
    throw new Error(
      `could not find EXPECTED_WORDLIST_SHA256 in ${GENERATOR_RS}`,
    );
  }
  return match[1];
}

function main() {
  const expected = process.argv[2] ?? readExpectedDigestFromRustHeader();
  const expectedFromGeneratorConstant = readExpectedDigestFromGeneratorConstant();

  const tsSource = readFileSync(path.join(ROOT, SOURCE_TS), "utf8");
  const words = extractWordlist(tsSource);
  const actual = digestOf(words);

  let failed = false;

  if (actual !== expected) {
    console.error(`ERROR: wordlist parity FAILED (${GENERATED_RS})`);
    console.error(`  expected (from ${GENERATED_RS}): ${expected}`);
    console.error(`  actual   (recomputed from ${SOURCE_TS}): ${actual}`);
    failed = true;
  }

  if (actual !== expectedFromGeneratorConstant) {
    console.error(`ERROR: wordlist parity FAILED (${GENERATOR_RS})`);
    console.error(
      `  expected (from ${GENERATOR_RS}'s EXPECTED_WORDLIST_SHA256): ${expectedFromGeneratorConstant}`,
    );
    console.error(`  actual   (recomputed from ${SOURCE_TS}): ${actual}`);
    failed = true;
  }

  if (expected !== expectedFromGeneratorConstant) {
    console.error(
      `ERROR: ${GENERATED_RS}'s header and ${GENERATOR_RS}'s EXPECTED_WORDLIST_SHA256 disagree with EACH OTHER`,
    );
    console.error(`  ${GENERATED_RS}: ${expected}`);
    console.error(`  ${GENERATOR_RS}: ${expectedFromGeneratorConstant}`);
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    `wordlist parity OK -- ${words.length} words, digest ${actual}, ` +
      `pinned identically in ${SOURCE_TS}, ${GENERATED_RS}, and ${GENERATOR_RS}`,
  );
}

main();
