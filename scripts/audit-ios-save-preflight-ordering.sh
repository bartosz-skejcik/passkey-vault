#!/usr/bin/env bash
#
# audit-ios-save-preflight-ordering.sh -- WR-08 (44-REVIEW.md), RE-ANCHORED by the 44-VERIFICATION.md
# gap-1 fix (44-gap-closure, see git log for the fixing commit). `SavePasswordOverrideTests.swift`
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
# THE BUG THIS RE-ANCHOR FIXES (44-VERIFICATION.md gap 1, reproduced independently before this fix
# and confirmed still reproducing on the pre-fix script): assertion (A) originally located the
# lock check via `grep -nF 'SessionLifecycle.checkAndExpireIfNeeded(' | head -1` over the WHOLE
# bounded function body -- i.e. "whichever call happens to come first textually". The WR-01 fix
# (commit 1fe55a0) added a SECOND `SessionLifecycle.checkAndExpireIfNeeded(` call inside the
# `runSavePipeline` closure (a re-check run AFTER the user confirms the sheet, WR-01's own stated
# purpose). That second call is declared textually EARLIER in the body than the point where
# `presentSavePasswordConfirm(` is actually invoked (Swift closures are declared where written,
# invoked later) -- so `head -1`'s single anchor was never wrong about WHICH call it found (it is
# still, correctly, the FIRST checkAndExpireIfNeeded( in the body), but that anchor is USELESS as a
# proxy for "the pre-UI check" once TWO calls exist with different runtime roles. Deleting the real
# top-of-function pre-UI check (this gate's headline mutation, see the falsification log) left the
# closure's re-check as the sole match; assertion (A) still found *a* call and still reported PASS,
# because "any match" was never the right question.
#
# THE FIX: anchor on WHAT THE CHECK FEEDS, not on textual position. `SavePasswordPreflight.decide(`
# is the single call whose `isUnlocked:` argument is the actual security decision (T-43-12) --
# there is exactly one such call in the body, immediately consuming the pre-UI check's result. This
# script now (a) requires `SavePasswordPreflight.decide(` to appear EXACTLY ONCE (ambiguous or
# absent -> hard ERROR, never a silent skip), then (b) requires
# `SessionLifecycle.checkAndExpireIfNeeded(` to appear within a small, bounded window of lines
# STRICTLY BEFORE that one `decide(` call (MAX_ANCHOR_GAP below -- the real, measured gap in the
# current tree is 1 line; the window is a generous multiple of that, never unbounded). A call
# living anywhere else in the body (e.g. inside a later closure, feeding nothing) can no longer
# satisfy assertion (A), because it is not the call `decide(` actually consumes. This is positional
# in the sense that matters (proximity to the thing it must feed), not order-of-textual-appearance
# in the whole window -- the exact distinction the original `head -1` anchor collapsed.
#
# Two assertions, both against the bounded body of
# `override func prepareInterface(for request: ASSavePasswordRequest)`:
#
#   (A) A `SessionLifecycle.checkAndExpireIfNeeded(` call appears within `MAX_ANCHOR_GAP` lines
#       BEFORE the single `SavePasswordPreflight.decide(` call in the body -- i.e. the lock check
#       genuinely feeds the security decision, not merely "some call with this name exists
#       somewhere in the function".
#   (B) No `present*(`-shaped call (a UI presentation) and no `SessionKeyReader.importUserKey(`
#       call (a session-key read) appears BEFORE that anchored check -- i.e. the lock check is not
#       merely present, but runs first.
#
# Falsified (transcript: ios/evidence/44/44-fix-wr08-falsification.log, RE-RECORDED against the
# current tree and this re-anchored script -- the prior transcript at this same path was stale,
# predating the WR-01 regression this re-anchor fixes, per 44-VERIFICATION.md gap 1 item 4):
#   1. The pre-UI lock check deleted outright, replaced with
#      `let preflight = SavePasswordPreflight.decide(isUnlocked: true)` (the EXACT mutation
#      44-VERIFICATION.md's verifier used to prove the pre-fix gate vacuous, with the WR-01
#      in-closure re-check left intact) -> assertion (A) FAILS, non-zero exit: no
#      `checkAndExpireIfNeeded(` call within MAX_ANCHOR_GAP lines before the sole `decide(` call.
#   2. The ORIGINAL WR-08 mutation re-run against the current tree: `SessionLifecycle.checkAndExpireIfNeeded(`
#      commented out entirely (both call sites untouched otherwise) -> assertion (A) FAILS,
#      non-zero exit, naming the missing anchor.
#   3. A throwaway `presentSavePasswordConfirm(` call temporarily inserted BEFORE the real
#      top-of-function `checkAndExpireIfNeeded` call -> assertion (B) FAILS, non-zero exit, naming
#      the out-of-order call.
#   All three mutations reverted byte-identically; exit 0 confirmed again after each revert.
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
say() { printf '%s\n' "$*"; }

# --- Anchor: the single SavePasswordPreflight.decide( call, not "any" checkAndExpireIfNeeded( ---
# See this file's own header for why textual-first-match ("head -1" over the whole window) is the
# defect this replaces. `decide(` is required EXACTLY ONCE: zero means the decision call itself was
# removed/renamed (the whole gate has no anchor left to check against); more than one is ambiguous
# about which call the lock check must feed. Either case is a hard ERROR, never a silent skip.
DECIDE_PATTERN='SavePasswordPreflight\.decide\('
decide_matches="$(grep -nE "$DECIDE_PATTERN" "$STRIPPED_FILE" || true)"
decide_count=0
if [ -n "$decide_matches" ]; then
  decide_count="$(printf '%s\n' "$decide_matches" | wc -l | tr -d ' ')"
fi
if [ "$decide_count" -ne 1 ]; then
  echo "ERROR: expected exactly one 'SavePasswordPreflight.decide(' call in prepareInterface(for: ASSavePasswordRequest)'s body (lines ${start_line}-${end_line} of $SRC_FILE), found ${decide_count} -- this gate's anchor is ambiguous or the decision call itself is missing/renamed; refusing to report PASS with no unambiguous anchor to check against" >&2
  exit 1
fi
decide_line="$(printf '%s\n' "$decide_matches" | cut -d: -f1)"

# The real, measured gap in the current tree is 1 line (checkAndExpireIfNeeded( on the line
# immediately before decide(). MAX_ANCHOR_GAP is a generous multiple of that -- bounded, never
# unbounded -- so a genuinely unrelated, distant checkAndExpireIfNeeded( call earlier in the body
# (e.g. belonging to a neighbouring closure) cannot be mistaken for the one feeding this decision.
MAX_ANCHOR_GAP=10
gap_window_start=$(( decide_line - MAX_ANCHOR_GAP ))
if [ "$gap_window_start" -lt 1 ]; then
  gap_window_start=1
fi

check_matches="$(sed -n "${gap_window_start},${decide_line}p" "$STRIPPED_FILE" | grep -nF 'SessionLifecycle.checkAndExpireIfNeeded(' || true)"
check_line=""
if [ -n "$check_matches" ]; then
  # Closest match to decide_line within the small window (the window is already bounded to
  # MAX_ANCHOR_GAP lines, so "last match in the window" IS "closest to decide_line" -- not a
  # head/tail-over-an-absence-proving-command; this selects among KNOWN-PRESENT matches).
  check_rel_line="$(printf '%s\n' "$check_matches" | awk -F: '{ln=$1} END{if (NR>0) print ln}')"
  if [ -n "$check_rel_line" ]; then
    check_line=$(( gap_window_start + check_rel_line - 1 ))
  fi
fi

say "== assertion (A): a SessionLifecycle.checkAndExpireIfNeeded( call feeds the sole SavePasswordPreflight.decide( call (window-relative line ${decide_line}), within ${MAX_ANCHOR_GAP} lines before it (lines ${start_line}-${end_line} of $SRC_FILE) =="
if [ -z "$check_line" ]; then
  say "FAIL -- no SessionLifecycle.checkAndExpireIfNeeded( call found within ${MAX_ANCHOR_GAP} lines before SavePasswordPreflight.decide( (window-relative line ${decide_line}) -- the lock-state decision is not fed by a real lock check this close to it"
  FAIL=1
else
  say "PASS (found at window-relative line $check_line, $(( decide_line - check_line )) line(s) before the decision)"
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
