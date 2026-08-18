#!/usr/bin/env bash
# scripts/audit-sync-decision-records.sh -- Phase 39, Plan 39-05, Task 2
# (E-G2, 39-RESEARCH.md).
#
# SYNC-05's requirement is that the reason APNs silent push is absent lives
# IN CODE, not only in ROADMAP.md, and carries an actual argument -- not a
# bare token. A gate that only greps for the literal string "SYNC-05" would
# pass over `// SYNC-05` with no reasoning behind it, which is exactly the
# shape this requirement exists to prevent. So this script asserts THREE
# things, all inside the SAME comment block the token itself sits in (never
# "anywhere in the file", which would let an unrelated line elsewhere
# satisfy a reasoning term the record itself never actually states):
#
#   1. the SYNC-05 token is present under the sync layer's source root;
#   2. the surrounding comment block also names, in its own words:
#        (a) a server-side sending capability APNs would require,
#        (b) the required-external-dependency conclusion that follows from
#            it (against this product's one-container, no-required-
#            external-services position), and
#        (c) the accepted, stated user-visible consequence (a backgrounded
#            app receives no vault updates);
#   3. the FILL-03 identity-store hook's own marker is present somewhere
#      under the same root, so that named-hook obligation cannot quietly
#      disappear in a later refactor without this gate noticing.
#
# "Same comment block" is found by expanding outward from the token's own
# line while adjacent lines are themselves `//`/`///` comment lines -- never
# a fixed line-count window, which could either clip the real reasoning or
# accidentally reach into unrelated code above/below it.
#
# Filtering note (so this gate cannot become self-satisfying through its own
# prose): the only lines ever inspected are comment lines from the AUDITED
# file, isolated by the block-expansion above -- this script's own header
# (including this very sentence) lives in scripts/, which is never inside
# the scanned root, so it can never contribute a match to its own gate.
#
# zsh reminder (L-3, ios/IOS-SPIKE-LOG.md Sec 3): this project's shell is
# zsh, where the bash-only post-pipe exit-code array is silently empty.
# Nothing below reads that array -- every check is either a direct
# command's own $? (via `set -euo pipefail` propagation) or a plain string
# test over a variable already captured by command substitution.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ROOT="ios/PasskeyVault/PasskeyVault/Sync"

usage() {
  echo "Usage: $0 [--root <path>]" >&2
  exit 2
}

while [ $# -gt 0 ]; do
  case "$1" in
    --root)
      ROOT="${2:-}"
      shift 2
      ;;
    *)
      echo "ERROR: unknown argument '$1'" >&2
      usage
      ;;
  esac
done

if [ -z "$ROOT" ]; then
  usage
fi

if [ ! -d "$ROOT" ]; then
  echo "FAIL: sync source root does not exist: $ROOT" >&2
  exit 1
fi

# --- expand a token's own line into the contiguous // or /// comment block
# it sits inside, over ONE file at a time. Never a fixed window -- the block
# grows exactly as far as adjacent lines are themselves comment lines.
extract_comment_block() {
  local file="$1" needle="$2"
  awk -v needle="$needle" '
    { lines[NR] = $0; total = NR }
    index($0, needle) > 0 && !found { found = NR }
    END {
      if (!found) { exit 1 }
      start = found
      while (start > 1 && lines[start - 1] ~ /^[[:space:]]*\/\//) start--
      end = found
      while (end < total && lines[end + 1] ~ /^[[:space:]]*\/\//) end++
      for (i = start; i <= end; i++) print lines[i]
    }
  ' "$file"
}

# --- check 1: the token exists somewhere under ROOT -------------------------
TOKEN_FILES=$(grep -rl "SYNC-05" "$ROOT" 2>/dev/null || true)
if [ -z "$TOKEN_FILES" ]; then
  echo "FAIL: no file under '$ROOT' contains the SYNC-05 token -- this is either a vacuous run (wrong path) or the record has gone missing." >&2
  exit 1
fi

# --- check 2: the reasoning terms co-occur in the SAME comment block -------
COMMENT_BLOCK=""
RECORD_FILE=""
for f in $TOKEN_FILES; do
  BLOCK="$(extract_comment_block "$f" "SYNC-05" 2>/dev/null || true)"
  if [ -n "$BLOCK" ]; then
    COMMENT_BLOCK="$BLOCK"
    RECORD_FILE="$f"
    break
  fi
done
if [ -z "$COMMENT_BLOCK" ]; then
  echo "FAIL: found the SYNC-05 token but could not isolate its surrounding comment block -- refusing to report PASS over an unaudited record." >&2
  exit 1
fi

# Prose in this codebase wraps across `//` lines (see the quoted record
# itself: "APNs sending\n  capability", "REQUIRED\n  EXTERNAL DEPENDENCY"),
# so a reasoning phrase can legitimately straddle a line break. Searching
# line-by-line would miss a wrapped phrase and falsely report it absent --
# strip each line's leading `//`/`///` comment marker FIRST (otherwise the
# marker itself lands mid-phrase once lines are joined, e.g. "sending //
# capability", which matches nothing), then collapse to one
# whitespace-normalized line before matching.
NORMALIZED_BLOCK="$(printf '%s\n' "$COMMENT_BLOCK" \
  | sed -E 's#^[[:space:]]*//+[[:space:]]?##' \
  | tr '\n' ' ' | tr -s '[:space:]' ' ')"

MISSING=""
if ! printf '%s' "$NORMALIZED_BLOCK" | grep -qi "sending capability"; then
  MISSING="${MISSING}[a server-side sending capability] "
fi
if ! printf '%s' "$NORMALIZED_BLOCK" | grep -qi "required external dependency"; then
  MISSING="${MISSING}[the required-external-dependency conclusion] "
fi
if ! printf '%s' "$NORMALIZED_BLOCK" | grep -qi "no vault updates"; then
  MISSING="${MISSING}[the stated user-visible consequence] "
fi
if [ -n "$MISSING" ]; then
  echo "FAIL: SYNC-05 token found in ${RECORD_FILE}, but its comment block is missing reasoning term(s): ${MISSING}-- a bare token is not a decision record." >&2
  exit 1
fi

# --- check 3: the FILL-03 identity-store hook marker is present ------------
if ! grep -rq "FILL-03" "$ROOT" 2>/dev/null; then
  echo "FAIL: no file under '$ROOT' contains the FILL-03 identity-store hook marker." >&2
  exit 1
fi

echo "PASS: SYNC-05's decision record (reasoning, not just the token) found in ${RECORD_FILE}; FILL-03 hook marker present under ${ROOT}"
