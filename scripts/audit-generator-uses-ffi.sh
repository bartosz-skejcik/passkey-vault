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

# SHIPPED code only -- the app target and the AutoFill extension target. The
# negative checks (1 and 4) scan THIS, not all of `ios/`.
#
# WHY THIS NARROWING EXISTS, and why it is not a weakening. ROADMAP SC4's own
# wording is that Swift RNG must not appear "w ścieżce generatora" -- in the
# GENERATOR PATH. Scanning all of `ios/` also scans the two test targets, and
# on 2026-08-17 that produced a FAIL on two UI tests using
# `Int.random(in: 0...9999)` to build a unique throwaway email address
# (`ItemDetailScreenshotUITests.swift:41`, `ItemFormAndFolderUITests.swift:37`).
# Neither can reach password generation: a test target is not linked into the
# shipped app, so nothing in it is in any path a user's password comes out of.
# Failing on them measures the wrong thing -- the exact defect class the rest
# of this script exists to prevent, pointed at itself.
#
# The broad scan did buy one real property, and check 5 below is what keeps it:
# a broad gate cannot be evaded by moving generator code into a directory the
# gate does not look at. Check 5 asserts the excluded test directories define
# no generator of their own and carry no charset/wordlist literal, so the
# exclusion cannot become a hiding place.
# WR-09 (38-REVIEW.md): bash ARRAYS, not space-joined strings -- the
# unquoted `$SHIPPED_SRC`/`$TEST_SRC` expansions below relied on word-
# splitting, which is deliberate for exactly two paths each but breaks
# silently (degrading the scan to a PARTIAL one, never erroring) on any
# checkout path containing a space. `"${SHIPPED_SRC[@]}"`/`"${TEST_SRC[@]}"`
# expand each element as its own argument regardless of embedded spaces.
SHIPPED_SRC=("${ROOT}/ios/PasskeyVault/PasskeyVault" "${ROOT}/ios/PasskeyVault/PasskeyVaultAutoFill")
TEST_SRC=("${ROOT}/ios/PasskeyVault/PasskeyVaultTests" "${ROOT}/ios/PasskeyVault/PasskeyVaultUITests")

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

# WR-09 (38-REVIEW.md): the original alternation did not match
# `Bool.random()`, `Double.random(in:)`, `Float.random(in:)`,
# `CGFloat.random(in:)`, `CCRandomGenerateBytes`, or a `RandomNumberGenerator`
# conformance -- all of which can build a password. `\.random\(` catches the
# general `TYPE.random(in:)` shape (covering Bool/Double/Float/CGFloat and
# any future numeric type at once); the named alternatives stay explicit
# for the zero-argument and CryptoKit-adjacent forms.
RNG_PATTERN='SystemRandomNumberGenerator|arc4random|SecRandomCopyBytes|CCRandomGenerateBytes|RandomNumberGenerator|\.randomElement|\.shuffled\(|\.random\(|Int\.random|Bool\.random|Double\.random|Float\.random|CGFloat\.random|UInt[0-9]*\.random'
# `\(` anchors on the EXACT symbol name, not a prefix match -- without it, a
# renamed binding such as `generatePassphraseRENAMED(` would still satisfy
# a bare `generatePassphrase` substring search and both checks would report
# a false PASS over a genuinely broken/renamed symbol. Demonstrated live in
# this plan's own falsification run (see 38-08-SUMMARY.md) before this
# anchor was added -- an unanchored version of check 3 passed vacuously
# against exactly the mutation it exists to catch.
CALL_PATTERN='generateCharacterPassword\(|generatePassphrase\(|generatePasswordFromRules\('
SYMBOL_PATTERN='func generateCharacterPassword\(|func generatePassphrase\(|func generatePasswordFromRules\('
LITERAL_PATTERN='abacus|abcdefghijklmnopqrstuvwxyz'

# ---------------------------------------------------------------------------
# Check 1 -- NEGATIVE: no Swift RNG API anywhere in the app's Swift source.
# ---------------------------------------------------------------------------
say "== check 1 (negative): no Swift RNG API in SHIPPED Swift source (app + appex) =="
hits1="$(grep -rnE --include='*.swift' "$RNG_PATTERN" "${SHIPPED_SRC[@]}" || true)"
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
# 44-02 Task 2 / 44-PLAN-CHECK.md B2: this threshold must genuinely depend
# on generatePasswordFromRules having its OWN real caller, not merely on
# the two pre-existing symbols. The pre-existing call-site count, measured
# live rather than assumed, is 3 (GeneratorSheet.swift calls
# generateCharacterPassword TWICE -- once for the live preview, once for
# the committed value -- plus one generatePassphrase call), not 2 as an
# earlier draft of this gate assumed. `-lt 3` would therefore be satisfied
# by the pre-existing calls ALONE and stay vacuously green with zero
# generatePasswordFromRules callers -- exactly the defect this check
# exists to prevent, pointed at itself. `-lt 4` is the threshold that
# actually requires a real fourth call site (Plan 44-05's own Task 1).
if [ "$count2" -lt 4 ]; then
  say "FAIL -- fewer than 4 call sites of generateCharacterPassword/generatePassphrase/generatePasswordFromRules outside the generated bindings (found $count2, and the 3 pre-existing calls to the first two symbols alone would already satisfy a lower threshold); check 1's zero RNG hits would be VACUOUS without a real generatePasswordFromRules caller"
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
if [ "$count3" -lt 3 ]; then
  say "FAIL -- expected ALL THREE of 'func generateCharacterPassword', 'func generatePassphrase', and 'func generatePasswordFromRules' in $BINDINGS_DIR, found $count3 matching declaration(s):"
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
say "== check 4 (negative): no Swift-side wordlist/charset literal in SHIPPED source =="
hits4="$(grep -rnE --include='*.swift' "$LITERAL_PATTERN" "${SHIPPED_SRC[@]}" || true)"
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

# ---------------------------------------------------------------------------
# Check 5 -- NEGATIVE, and it is what pays for checks 1 and 4 being narrowed.
#
# Checks 1 and 4 scan shipped code only, for the reason argued at the top of
# this file. That narrowing would be a real hole if a generator could simply be
# written inside a test target instead. It cannot be reached from the app --
# test targets are not linked into it -- but a second, drifting generator
# implementation living anywhere in this repo is exactly what DR-38-A's own
# residual risk names, so it is worth failing on rather than trusting.
#
# So: the excluded directories must define no generator of their own and carry
# no charset/wordlist literal. `Int.random` for a throwaway fixture is fine
# there; a `func generate…` or an alphabet literal is not.
# ---------------------------------------------------------------------------
say "== check 5 (negative): the EXCLUDED test dirs are not a hiding place =="
hits5="$(grep -rnE --include='*.swift' "func generateCharacterPassword|func generatePassphrase|$LITERAL_PATTERN" "${TEST_SRC[@]}" || true)"
count5="$(printf '%s' "$hits5" | grep -c . || true)"
[ -z "$hits5" ] && count5=0
say "count: $count5"
if [ "$count5" -ne 0 ]; then
  say "FAIL -- a generator definition or charset literal lives in a test target,"
  say "        which checks 1 and 4 deliberately do not scan:"
  say "$hits5"
  FAIL=1
else
  say "PASS"
fi

say ""
if [ "$FAIL" -ne 0 ]; then
  say "OVERALL: FAIL -- see the failing check(s) above"
  exit 1
fi
say "OVERALL: PASS -- all five checks hold (3 negative, 2 positive); the negative results are not vacuous"
