#!/usr/bin/env bash
# scripts/ios-autofill-e41.sh -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami),
# this phase's ONE evidence harness. Every plan in this phase adds its own subcommand here; no
# plan creates a second harness (41-01-PLAN.md "Artifacts this phase produces").
#
# Harness contract, binding on EVERY subcommand this script will ever gain, in this plan and every
# later one: `<subcommand> --assert-only <path>` skips boot/build/install/drive entirely and runs
# ONLY that subcommand's assertions against the named capture or evidence file. This is not a
# convenience -- it is what lets every plan in this phase falsify its own harness by pointing the
# assertion half at a deliberately degraded file, proving the subcommand CAN fail rather than only
# ever having been observed to pass. Under --assert-only a missing, unreadable, or EMPTY path exits
# non-zero with the path named -- an absent/empty file is never treated as nothing-to-check.
#
# D-08 (landmine L-3, this project's shell is zsh): PIPESTATUS is empty here; the array is
# $pipestatus and is never relied on. Every check below redirects into a file/variable and is
# inspected via grep/test, never `cmd | tail` followed by a status check.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

EVIDENCE_DIR="ios/evidence/41"
BRANCH_STATE_FILE="$EVIDENCE_DIR/branch-state.md"

usage() {
  echo "Usage: $0 {branch-state|e41-1} [--assert-only <path>]" >&2
  exit 1
}

# --- shared: a non-empty, readable file, or a named failure ----------------
require_nonempty_file() {
  local path="$1" label="$2"
  if [ ! -f "$path" ]; then
    echo "ERROR: $label -- file does not exist: $path" >&2
    return 1
  fi
  if [ ! -r "$path" ]; then
    echo "ERROR: $label -- file is not readable: $path" >&2
    return 1
  fi
  if [ ! -s "$path" ]; then
    echo "ERROR: $label -- file is EMPTY: $path (an empty file is never treated as nothing-to-check)" >&2
    return 1
  fi
  return 0
}

# =============================================================================
# branch-state -- validates ios/evidence/41/branch-state.md (Task 1, 41-01)
# =============================================================================
#
# Fails, naming the offending row, if:
#   1. the target file is missing/unreadable/empty
#   2. any of the six row headings B1..B6 is absent
#   3. any B<N> row's own section (heading to next "## " heading, or EOF)
#      contains NEITHER a `path:line`-shaped citation NOR the literal token
#      UNRESOLVED -- a row asserted without evidence is exactly the failure
#      class this gate exists to catch, distinct from a merely-deleted
#      heading (T-41-04).
CITATION_RE='[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:[0-9]+'

cmd_branch_state() {
  local target="$BRANCH_STATE_FILE"
  # ASSERT_ONLY is always true for this subcommand today -- branch-state has
  # no boot/build/install/drive half at all, it is a pure static-file
  # validator. The --assert-only flag is still accepted and honoured (same
  # contract every subcommand carries), it simply has no extra work to skip.
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    target="$2"
  fi

  if ! require_nonempty_file "$target" "branch-state"; then
    exit 1
  fi

  local failed=0
  local i heading_re section_start section_end section_text has_citation has_unresolved

  for i in 1 2 3 4 5 6; do
    heading_re="^## B${i} "
    if ! grep -qE "$heading_re" "$target"; then
      echo "FAIL: branch-state row B${i} -- heading not found in $target" >&2
      failed=1
      continue
    fi

    # Isolate this row's section: from its own heading line to the line
    # BEFORE the next "^## " heading (or EOF). awk, not sed range-to-pattern,
    # because sed's own range would need a second, DIFFERENT pattern per row
    # (the next row's exact heading text) -- awk's "next ## line, any text"
    # stop condition is uniform across all six rows.
    section_text=$(awk -v start="$heading_re" '
      BEGIN { armed = 0 }
      $0 ~ start { armed = 1; print; next }
      armed && /^## / { exit }
      armed { print }
    ' "$target")

    if [ -z "$section_text" ]; then
      echo "FAIL: branch-state row B${i} -- heading found but section body is empty in $target" >&2
      failed=1
      continue
    fi

    has_citation=$(printf '%s\n' "$section_text" | grep -cE "$CITATION_RE" || true)
    has_unresolved=$(printf '%s\n' "$section_text" | grep -cw 'UNRESOLVED' || true)

    if [ "$has_citation" -eq 0 ] && [ "$has_unresolved" -eq 0 ]; then
      echo "FAIL: branch-state row B${i} -- section contains neither a file:line citation nor the UNRESOLVED token (a row asserted without evidence, T-41-04)" >&2
      failed=1
      continue
    fi
  done

  if [ "$failed" -ne 0 ]; then
    echo "FAIL: branch-state validation failed against $target" >&2
    exit 1
  fi

  echo "PASS: branch-state -- all six rows (B1..B6) carry either a file:line citation or the UNRESOLVED token, validated against $target"
  exit 0
}

# =============================================================================
# e41-1 -- can the extension read the Phase-37 User-Key artifact without UI?
# (Task 2, 41-01). Placeholder dispatch target until Task 2 implements it.
# =============================================================================
cmd_e41_1() {
  echo "ERROR: e41-1 subcommand not yet implemented (41-01 Task 2)" >&2
  exit 1
}

case "${1:-}" in
  branch-state) shift; cmd_branch_state "$@" ;;
  e41-1) shift; cmd_e41_1 "$@" ;;
  *) usage ;;
esac
