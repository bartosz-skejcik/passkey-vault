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
  hits="$(grep -rnE --include='*.swift' "$LITERAL_COLOUR" "$SRC" || true)"
  if [ -n "$hits" ]; then
    say "FAIL -- literal colour(s) present; every colour must be an asset-catalog token:"
    say "$hits"
    FAIL=1
  else
    say "PASS -- no literal colours"
  fi
}

check_asset_colours_exist() {
  say "== check 2: every Color(\"PV…\") names a real colorset =="
  local names missing=""
  names="$(grep -rhoE --include='*.swift' 'Color\("PV[A-Za-z]+"\)' "$SRC" \
           | sed -E 's/Color\("([A-Za-z]+)"\)/\1/' | sort -u || true)"
  if [ -z "$names" ]; then
    say "FAIL -- no token colours found at all; the pattern is broken, not the code"
    FAIL=1
    return
  fi
  while IFS= read -r n; do
    [ -z "$n" ] && continue
    if [ ! -d "${SRC}/Assets.xcassets/${n}.colorset" ]; then
      missing="${missing}${n}"$'\n'
    fi
  done <<< "$names"
  if [ -n "$missing" ]; then
    say "FAIL -- token(s) referenced in code with no colorset in Assets.xcassets:"
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
