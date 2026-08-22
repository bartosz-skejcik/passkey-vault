#!/usr/bin/env bash
#
# audit-ios-colour-tokens.sh -- mechanical enforcement of the two colour rules
# that `docs/superpowers/specs/2026-08-16-ios-onboarding-and-auth-design.md` §2
# calls "easy to get wrong", plus the general no-literal-colour rule from both
# design specs' §7/§9 Done lists.
#
# WHY THIS IS A SCRIPT AND NOT A CONVENTION. Plan 38-13 demonstrated the rule
# by hand -- adding a `.white`, watching a grep fire, reverting -- which proves
# the rule was true at that instant and nothing about the next commit. This
# repo's own standard (`ios/IOS-SPIKE-LOG.md` L-9, five recorded instances of
# "a check that cannot fail") is that a gate is a re-runnable artifact or it is
# not a gate.
#
# THE BUG THIS EXISTS TO CATCH, found live in 38-13 and not theoretical:
# `.buttonStyle(.borderedProminent)` does NOT apply `PVOnAccent` to its label.
# It renders a plain white label in BOTH light and dark mode, which reintroduces
# the exact 3.34:1 AA failure the `PVOnAccent` token was created to fix. The
# failure is invisible in light mode -- where white-on-accent happens to be
# correct -- so it ships looking fine and is only wrong in dark.
#
# CHECK 3 IS A PROXIMITY HEURISTIC, stated plainly rather than dressed up as a
# parse: it requires a `PVOnAccent` within the WINDOW lines preceding each
# `.borderedProminent`. It cannot see SwiftUI's view tree, so a `PVOnAccent`
# belonging to a different subview inside the window would satisfy it. It is
# still worth having: the regression it guards against is *adding a prominent
# button with no token anywhere near it*, which this does catch.
#
# Usage: scripts/audit-ios-colour-tokens.sh [--self-test]
#   --self-test  proves each pattern can match, against a temporary file that
#                deliberately violates every rule -- so a clean run means the
#                patterns work, not that they never match anything.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="${ROOT}/ios/PasskeyVault/PasskeyVault"
# Check 2 additionally scans the EXTENSION + shared sources
# (`.planning/debug/passkey-reg-blank-sheet-discord.md`, 2026-08-22): the app-only `$SRC` above
# never covered `PasskeyRegistrationConfirmView.swift` (compiled into `PasskeyVaultAutoFill`,
# not `PasskeyVault`), so a `Color("PV...")` reference living only in the extension was
# invisible to this whole script. Check 2 is a real-colorset-exists check, not a
# target-membership check (that is `scripts/audit-ios-extension-asset-resolution.py`'s job,
# wired into `scripts/check-ios-gate.sh` as `gate_asset_resolution`) -- but scanning ALL the
# code that can reference a token is a prerequisite for either check meaning anything.
CHECK2_SRC_DIRS=(
  "${ROOT}/ios/PasskeyVault/PasskeyVault"
  "${ROOT}/ios/PasskeyVault/PasskeyVaultAutoFill"
  "${ROOT}/ios/PasskeyVault/Shared"
  "${ROOT}/ios/PasskeyVault/PvShared"
)
# The ONE generated catalog every `PV*`/`AccentColor` colorset lives in as of this session --
# `Shared/PVColors.xcassets`, not the app-only `$SRC/Assets.xcassets` (which now holds only
# AppIcon/onboarding image assets). See `scripts/gen-ios-colorsets.py`'s own `ASSETS` comment.
COLOR_ASSETS_DIR="${ROOT}/ios/PasskeyVault/Shared/PVColors.xcassets"
WINDOW=20
FAIL=0

# `\.white\b` deliberately does NOT match `.whitespacesAndNewlines`: the
# character after "white" there is "s", a word character, so the boundary
# fails. Verified by the self-test's own negative case.
LITERAL_COLOUR='\.white\b|\.black\b|Color\(red:|Color\(\.sRGB|#colorLiteral|UIColor\(red:|Color\(hex'

say() { printf '%s\n' "$*"; }

check_literal_colours() {
  say "== check 1: no literal colour in any view =="
  local hits
  # Comment-only lines are excluded: the rule is about CODE. A doc comment
  # that NAMES `.white` while explaining why it is forbidden is not a
  # violation, and on 2026-08-17 exactly that turned this gate red against
  # PVDesign.swift's own header. Lines whose first non-space token opens a
  # comment are dropped; a violation in a TRAILING comment after real code
  # is still flagged, which is the safe direction to err in.
  # NOTE ON THE REGEX BELOW, because the first attempt at it was itself a
  # check that could not fail. Writing the comment-opener alternation as
  # `(//|\\*)` makes the second branch "zero or more backslashes", which matches
  # the EMPTY string -- so the exclusion swallowed every line and the whole
  # check silently passed on a real `Color.white`. Caught only by falsifying it.
  # A literal asterisk is `\*`, one backslash. Do not "tidy" this.
  hits="$(grep -rnE --include='*.swift' "$LITERAL_COLOUR" "$SRC" \
          | grep -vE ':[0-9]+:[[:space:]]*(//|/\*|\*)' || true)"
  if [ -n "$hits" ]; then
    say "FAIL -- literal colour(s) present; every colour must be an asset-catalog token:"
    say "$hits"
    FAIL=1
  else
    say "PASS -- no literal colours"
  fi
}

check_asset_colours_exist() {
  say "== check 2: every Color(\"PV…\") names a real colorset (app + extension + shared sources) =="
  local names missing=""
  names="$(grep -rhoE --include='*.swift' 'Color\("PV[A-Za-z]+"\)' "${CHECK2_SRC_DIRS[@]}" \
           | sed -E 's/Color\("([A-Za-z]+)"\)/\1/' | sort -u || true)"
  if [ -z "$names" ]; then
    say "FAIL -- no token colours found at all; the pattern is broken, not the code"
    FAIL=1
    return
  fi
  while IFS= read -r n; do
    [ -z "$n" ] && continue
    if [ ! -d "${COLOR_ASSETS_DIR}/${n}.colorset" ]; then
      missing="${missing}${n}"$'\n'
    fi
  done <<< "$names"
  if [ -n "$missing" ]; then
    say "FAIL -- token(s) referenced in code with no colorset in ${COLOR_ASSETS_DIR}:"
    say "$missing"
    FAIL=1
  else
    say "PASS -- all $(printf '%s\n' "$names" | grep -c . ) referenced tokens have a colorset"
  fi
}

check_prominent_buttons() {
  say "== check 3: every .borderedProminent has PVOnAccent within ${WINDOW} lines above =="
  local f line n start ctx bad=""
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      n="${line%%:*}"
      start=$(( n - WINDOW )); [ "$start" -lt 1 ] && start=1
      ctx="$(sed -n "${start},${n}p" "$f")"
      if ! printf '%s' "$ctx" | grep -q 'PVOnAccent'; then
        bad="${bad}${f}:${n}"$'\n'
      fi
    done <<< "$(grep -n 'borderedProminent' "$f" || true)"
  done <<< "$(grep -rlE --include='*.swift' 'borderedProminent' "$SRC" || true)"

  if [ -n "$bad" ]; then
    say "FAIL -- prominent button(s) with no PVOnAccent nearby; SwiftUI will render the"
    say "        label plain white, which is 3.34:1 on PVAccent in dark mode:"
    say "$bad"
    FAIL=1
  else
    say "PASS -- all prominent buttons carry PVOnAccent"
  fi
}

self_test() {
  say "== self-test: proving each pattern can match =="
  local tmp; tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  mkdir -p "$tmp/Assets.xcassets"
  cat > "$tmp/Violator.swift" <<'SWIFT'
import SwiftUI
struct Violator: View {
    var body: some View {
        Button("Go") { }
            .foregroundStyle(.white)
            .buttonStyle(.borderedProminent)
            .background(Color("PVDoesNotExist"))
    }
    let s = "x".trimmingCharacters(in: .whitespacesAndNewlines)
}
SWIFT
  local ok=0
  grep -qE "$LITERAL_COLOUR" "$tmp/Violator.swift" \
    && { say "  ok: literal-colour pattern matches .white"; } || { say "  BROKEN: literal-colour pattern missed .white"; ok=1; }
  # The negative case that matters: the same pattern must NOT match the
  # Foundation API whose name merely starts with "white".
  if printf '%s\n' 'let s = x.trimmingCharacters(in: .whitespacesAndNewlines)' | grep -qE "$LITERAL_COLOUR"; then
    say "  BROKEN: literal-colour pattern false-positives on .whitespacesAndNewlines"; ok=1
  else
    say "  ok: pattern does not fire on .whitespacesAndNewlines"
  fi
  grep -q 'borderedProminent' "$tmp/Violator.swift" \
    && { say "  ok: prominent-button pattern matches"; } || { say "  BROKEN: prominent-button pattern missed"; ok=1; }
  grep -qE 'Color\("PV[A-Za-z]+"\)' "$tmp/Violator.swift" \
    && { say "  ok: token-reference pattern matches"; } || { say "  BROKEN: token-reference pattern missed"; ok=1; }
  if [ "$ok" -ne 0 ]; then say "SELF-TEST FAILED -- do not trust a clean run from this script"; return 1; fi
  say "SELF-TEST PASSED -- a clean run below means the patterns looked and found nothing"
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

self_test || exit 1
say ""
check_literal_colours
check_asset_colours_exist
check_prominent_buttons
say ""
if [ "$FAIL" -ne 0 ]; then
  say "COLOUR AUDIT: FAIL"
  exit 1
fi
say "COLOUR AUDIT: PASS"
