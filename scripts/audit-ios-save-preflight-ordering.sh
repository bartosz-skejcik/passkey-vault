#!/usr/bin/env bash
#
# audit-ios-save-preflight-ordering.sh -- WR-08 (44-REVIEW.md). `SavePasswordOverrideTests.swift`
# exercises `SavePasswordPreflight.decide(isUnlocked:)` in isolation -- a two-case identity mapping
# (`decide(false) == .refuseLocked`, `decide(true) == .proceed`) that is the function restated, not
# evidence for the actual T-43-12 security claim (44-04-SUMMARY.md coverage entry D1): that
# `CredentialProviderViewController.prepareInterface(for: ASSavePasswordRequest)` calls
# `SessionLifecycle.checkAndExpireIfNeeded(` BEFORE presenting any confirmation UI or reading the
# session key, and never after. Nothing in that unit test can fail if the override stopped calling
# `decide` at all, or called it too late.
#
# This is a STRUCTURAL gate over the REAL override source, in the same family as
# `audit-ios-identity-store-chokepoint.sh` (whose bounded-forward-window technique and
# comment/string stripper this script reuses verbatim, same rationale: a FIXED, ENUMERATED,
# single call site with a known generous gap to its neighbour -- never a general "find where a
# function ends" scanner, the CR-02/CR-03 trap `35-REVIEW.md` named).
#
# Two assertions, both against the bounded body of
# `override func prepareInterface(for request: ASSavePasswordRequest)`:
#
#   (A) `SessionLifecycle.checkAndExpireIfNeeded(` appears in the body at all (a call site that
#       stopped calling it produces no compile error -- this is the failure mode T-43-12 exists to
#       prevent from ever reaching production silently).
#   (B) No `present*(`-shaped call (a UI presentation) and no `SessionKeyReader.importUserKey(`
#       call (a session-key read) appears BEFORE the first `SessionLifecycle.checkAndExpireIfNeeded(`
#       occurrence in the body -- i.e. the lock check is not merely present, but runs first.
#
# Falsified both directions this session (transcript: ios/evidence/44/44-fix-wr08-falsification.log):
#   1. `SessionLifecycle.checkAndExpireIfNeeded(` temporarily commented out inside the function body
#      -> assertion (A) FAILS, non-zero exit, naming the missing call.
#   2. A throwaway `presentSavePasswordConfirm(` call temporarily inserted BEFORE the real
#      `checkAndExpireIfNeeded` call -> assertion (B) FAILS, non-zero exit, naming the out-of-order
#      call.
#   Both mutations reverted byte-identically; exit 0 confirmed again after each revert.
#
# Never relies on bash's post-pipe exit-code array (zsh is this project's shell -- landmine L-3).
# Missing-input precheck FAILS LOUDLY, never skips (T-41-42's own discipline, reused here).
#
# Usage: scripts/audit-ios-save-preflight-ordering.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

SRC_FILE="ios/PasskeyVault/PasskeyVaultAutoFill/CredentialProviderViewController.swift"

if [ ! -f "$SRC_FILE" ]; then
  echo "ERROR: expected source file missing: $SRC_FILE -- refusing to report PASS over an unscanned tree" >&2
  exit 1
fi

if grep -qF '#"' "$SRC_FILE"; then
  echo "ERROR: $SRC_FILE contains a raw string literal (#\"...\"#) this gate's stripper cannot tokenize -- refusing to report PASS over an unscanned construct" >&2
  exit 1
fi

# Reused verbatim from scripts/audit-ios-identity-store-chokepoint.sh -- see that file's own
# header for the design rationale (comment/string-STRIPPED scanning, CR-02's own technique).
strip_comments_and_strings() {
  awk '
    function strip(line,   out, i, c, d, e, n) {
      out = ""
      n = length(line)
      i = 1
      while (i <= n) {
        c = substr(line, i, 1)
        d = substr(line, i + 1, 1)
        e = substr(line, i + 2, 1)
        if (state == "block") {
          if (c == "*" && d == "/") { cdepth--; i += 2; if (cdepth <= 0) { cdepth = 0; state = "code" } ; continue }
          if (c == "/" && d == "*") { cdepth++; i += 2; continue }
          i++
          continue
        }
        if (state == "triple") {
          if (c == "\"" && d == "\"" && e == "\"") { state = "code"; i += 3; continue }
          i++
          continue
        }
        if (state == "string") {
          if (c == "\\") { i += 2; continue }
          if (c == "\"") { state = "code"; i++; continue }
          i++
          continue
        }
        if (c == "/" && d == "/") { break }
        if (c == "/" && d == "*") { state = "block"; cdepth = 1; i += 2; continue }
        if (c == "\"" && d == "\"" && e == "\"") { state = "triple"; i += 3; continue }
        if (c == "\"") { state = "string"; i++; continue }
        out = out c
        i++
      }
      return out
    }
    BEGIN { state = "code"; cdepth = 0 }
    { print strip($0) }
  ' "$1"
}

SIGNATURE_PATTERN='^[[:space:]]*override func prepareInterface\(for request: ASSavePasswordRequest\)'
start_line="$(grep -nE "$SIGNATURE_PATTERN" "$SRC_FILE" | head -1 | cut -d: -f1 || true)"
if [ -z "$start_line" ]; then
  echo "ERROR: could not find 'override func prepareInterface(for request: ASSavePasswordRequest)' in $SRC_FILE" >&2
  exit 1
fi

total_lines="$(wc -l < "$SRC_FILE" | tr -d ' ')"
# Bounded forward window: the next member declaration at the SAME 4-space class-member
# indentation, or a 250-line cap, whichever comes first -- generous (the real body is ~180 lines
# per this gate's own header) but never unbounded.
next_decl_line="$(tail -n "+$((start_line + 1))" "$SRC_FILE" | grep -nE '^    (override|private|static) func ' | head -1 | cut -d: -f1 || true)"
if [ -n "$next_decl_line" ]; then
  end_line=$((start_line + next_decl_line - 1))
else
  end_line=$((start_line + 250))
fi
if [ "$end_line" -gt "$total_lines" ]; then
  end_line="$total_lines"
fi

WINDOW_FILE="$(mktemp)"
trap 'rm -f "$WINDOW_FILE"' EXIT
sed -n "${start_line},${end_line}p" "$SRC_FILE" > "$WINDOW_FILE"

STRIPPED_FILE="$(mktemp)"
trap 'rm -f "$WINDOW_FILE" "$STRIPPED_FILE"' EXIT
strip_comments_and_strings "$WINDOW_FILE" > "$STRIPPED_FILE"

FAIL=0

check_line="$(grep -nF 'SessionLifecycle.checkAndExpireIfNeeded(' "$STRIPPED_FILE" | head -1 | cut -d: -f1 || true)"
say() { printf '%s\n' "$*"; }

say "== assertion (A): SessionLifecycle.checkAndExpireIfNeeded( appears in the body (lines ${start_line}-${end_line} of $SRC_FILE) =="
if [ -z "$check_line" ]; then
  say "FAIL -- no SessionLifecycle.checkAndExpireIfNeeded( call found in prepareInterface(for: ASSavePasswordRequest)'s own body"
  FAIL=1
else
  say "PASS (found at window-relative line $check_line)"
fi

if [ -n "$check_line" ]; then
  say "== assertion (B): no present*(/SessionKeyReader.importUserKey( call appears BEFORE that check =="
  before_hits="$(head -n "$((check_line - 1))" "$STRIPPED_FILE" | grep -nE '\bpresent[A-Za-z]*\(|SessionKeyReader\.importUserKey\(' || true)"
  if [ -n "$before_hits" ]; then
    say "FAIL -- a UI presentation or session-key read occurs BEFORE the lock check:"
    say "$before_hits"
    FAIL=1
  else
    say "PASS"
  fi
fi

say ""
if [ "$FAIL" -ne 0 ]; then
  say "OVERALL: FAIL -- see the failing assertion(s) above"
  exit 1
fi
say "OVERALL: PASS -- prepareInterface(for: ASSavePasswordRequest) checks the lock state first, before any UI/session-key read"
