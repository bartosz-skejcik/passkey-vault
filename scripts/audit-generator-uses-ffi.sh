#!/usr/bin/env bash
#
# audit-generator-uses-ffi.sh -- E-G1, the UI-06 / ROADMAP SC4 gate made
# falsifiable. `38-RESEARCH.md` §"Pitfall 11 -- A generator grep that cannot
# fail": as SC4 is literally worded ("grep for the absence of Swift RNG
# APIs"), it passes TRIVIALLY on a generator that never calls Rust at all --
# a check that cannot usefully fail. This script is four checks, two
# NEGATIVE and two POSITIVE, ALL FOUR of which must hold. An empty negative
# result only means something once a positive result has proven the Rust
# call path actually exists; without the positive pair, "zero RNG hits"
# is equally true of a generator wired to Rust and one that was never
# wired to anything.
#
#   1. NEGATIVE -- no Swift random-number API anywhere in this app's source.
#   2. POSITIVE -- Swift genuinely CALLS the FFI generator (a real call
#      site, outside the generated bindings file itself).
#   3. POSITIVE -- the symbol exists in the GENERATED Swift bindings, i.e.
#      pv-ffi really exports it (never trust intent -- the generated
#      artifact is the real boundary, same discipline
#      `audit-ffi-opaque-handles.sh`'s own header states).
#   4. NEGATIVE -- no Swift-side copy of the EFF wordlist or the charset
#      literals (a copy is drift by construction -- T-38-08-02).
#
# TWO STRUCTURAL RULES, both paid for once already in this repository and
# not re-learned here for free:
#
#   L-3 (`ios/IOS-SPIKE-LOG.md` §3): the shell is zsh, where the bash
#   bash-only post-pipe exit-status array is silently empty in zsh -- a
#   status read off the END of a pipe reads as "" and can never report a
#   failure. Nothing below reads a status from a pipe; every check captures
#   grep's OUTPUT into a variable first (`hits="$(grep ... || true)"`) and
#   tests the STRING, never an exit code sitting after a pipe. (This
#   script's own acceptance check greps for that array's literal name, so
#   it is deliberately not spelled out here -- see this repo's own
#   `IOS-SPIKE-LOG.md` §3 for the exact identifier if the pattern is
#   unclear.)
#
#   CR-02/CR-03 (`.planning/phases/35-.../35-REVIEW.md`, referenced by
#   `audit-ffi-opaque-handles.sh`'s own header): a prior audit in this repo
#   reported PASS with the real defect present, twice, because it extracted
#   a RANGE of the file (by line pattern) instead of scanning the WHOLE
#   file, and the extraction silently truncated before the violating line.
#   Every check below greps the WHOLE file set with `-r`, never a sed/awk
#   range extraction, and prints its raw hit COUNT so a silent truncation
#   would show up as a suspiciously small number rather than vanishing.
#
# Falsified one arm at a time, all four, each observed FAILING under a
# targeted mutation and then reverted -- transcripts recorded in
# `ios/IOS-SPIKE-LOG.md` (E-G1 section) and this plan's SUMMARY, never
# merely asserted here.
#
# Usage: scripts/audit-generator-uses-ffi.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/ios"
BINDINGS_DIR="${ROOT}/ios/PasskeyVault/build/swift-bindings"

FAIL=0

say() { printf '%s\n' "$*"; }

# --- Precheck: real, freshly-generated bindings must exist ----------------
# Same discipline as `audit-ffi-opaque-handles.sh`'s own precheck: "WARN and
# skip" is not an option -- a missing-bindings skip would silently pass an
# unaudited state, exactly the failure class checks 2/3 exist to catch.
if [ ! -d "$BINDINGS_DIR" ] || [ -z "$(find "$BINDINGS_DIR" -maxdepth 1 -name '*.swift' -print -quit 2>/dev/null)" ]; then
  say "ERROR: generated Swift bindings not found under $BINDINGS_DIR -- run scripts/build-ios.sh first" >&2
  exit 1
fi

RNG_PATTERN='SystemRandomNumberGenerator|arc4random|SecRandomCopyBytes|\.randomElement|\.shuffled\(|Int\.random|UInt[0-9]*\.random'
# `\(` anchors on the EXACT symbol name, not a prefix match -- without it, a
# renamed binding such as `generatePassphraseRENAMED(` would still satisfy
# a bare `generatePassphrase` substring search and both checks would report
# a false PASS over a genuinely broken/renamed symbol. Demonstrated live in
# this plan's own falsification run (see 38-08-SUMMARY.md) before this
# anchor was added -- an unanchored version of check 3 passed vacuously
# against exactly the mutation it exists to catch.
CALL_PATTERN='generateCharacterPassword\(|generatePassphrase\('
SYMBOL_PATTERN='func generateCharacterPassword\(|func generatePassphrase\('
LITERAL_PATTERN='abacus|abcdefghijklmnopqrstuvwxyz'

# ---------------------------------------------------------------------------
# Check 1 -- NEGATIVE: no Swift RNG API anywhere in the app's Swift source.
# ---------------------------------------------------------------------------
say "== check 1 (negative): no Swift RNG API anywhere under ios/ =="
hits1="$(grep -rnE --include='*.swift' "$RNG_PATTERN" "$SRC" || true)"
count1="$(printf '%s' "$hits1" | grep -c . || true)"
[ -z "$hits1" ] && count1=0
say "count: $count1"
if [ "$count1" -ne 0 ]; then
  say "FAIL -- Swift random-number API found (must be zero):"
  say "$hits1"
  FAIL=1
else
  say "PASS"
fi

# ---------------------------------------------------------------------------
# Check 2 -- POSITIVE: Swift genuinely calls the FFI generator, from a real
# call site OUTSIDE the generated bindings file (which trivially "calls"
# nothing -- it IS the declaration). Without this, check 1's zero result
# would be equally true of a generator that was never wired to Rust at all.
# ---------------------------------------------------------------------------
say "== check 2 (positive): a real Swift call site of the FFI generator, outside the generated bindings =="
allhits2="$(grep -rnE --include='*.swift' "$CALL_PATTERN" "$SRC" || true)"
hits2="$(printf '%s\n' "$allhits2" | grep -vF "$BINDINGS_DIR" || true)"
count2="$(printf '%s' "$hits2" | grep -c . || true)"
[ -z "$hits2" ] && count2=0
say "count: $count2"
if [ "$count2" -lt 1 ]; then
  say "FAIL -- zero call sites of generateCharacterPassword/generatePassphrase outside the generated bindings; check 1's zero RNG hits would be VACUOUS without this"
  FAIL=1
else
  say "PASS"
  say "$hits2"
fi

# ---------------------------------------------------------------------------
# Check 3 -- POSITIVE: the symbol exists in the GENERATED Swift bindings --
# proof that pv-ffi really exports it, not merely that Swift source intends
# to call something by that name.
# ---------------------------------------------------------------------------
say "== check 3 (positive): the generator symbols exist in the GENERATED Swift bindings =="
hits3="$(grep -rnE --include='*.swift' "$SYMBOL_PATTERN" "$BINDINGS_DIR" || true)"
count3="$(printf '%s' "$hits3" | grep -c . || true)"
[ -z "$hits3" ] && count3=0
say "count: $count3"
if [ "$count3" -lt 2 ]; then
  say "FAIL -- expected BOTH 'func generateCharacterPassword' and 'func generatePassphrase' in $BINDINGS_DIR, found $count3 matching declaration(s):"
  say "$hits3"
  FAIL=1
else
  say "PASS"
  say "$hits3"
fi

# ---------------------------------------------------------------------------
# Check 4 -- NEGATIVE: no Swift-side copy of the EFF wordlist or the
# charset literals. A copy is drift by construction (T-38-08-02).
# ---------------------------------------------------------------------------
say "== check 4 (negative): no Swift-side wordlist/charset literal anywhere under ios/ =="
hits4="$(grep -rnE --include='*.swift' "$LITERAL_PATTERN" "$SRC" || true)"
count4="$(printf '%s' "$hits4" | grep -c . || true)"
[ -z "$hits4" ] && count4=0
say "count: $count4"
if [ "$count4" -ne 0 ]; then
  say "FAIL -- Swift-side wordlist/charset literal found (must be zero):"
  say "$hits4"
  FAIL=1
else
  say "PASS"
fi

say ""
if [ "$FAIL" -ne 0 ]; then
  say "OVERALL: FAIL -- see the failing check(s) above"
  exit 1
fi
say "OVERALL: PASS -- all four checks hold (2 negative, 2 positive); the negative results are not vacuous"
