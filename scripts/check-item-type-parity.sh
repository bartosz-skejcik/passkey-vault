#!/usr/bin/env bash
# scripts/check-item-type-parity.sh -- Phase 38, Plan 38-03, Task 2.
#
# DR-38-B's NAMED GUARD (`ios/IOS-SPIKE-LOG.md` §1a). That record decides the
# Swift item field model is a HAND-WRITTEN mirror of
# `packages/pv-ui/vault/types.ts` -- because `crates/pv-core/src/items.rs` has
# no field model to generate from (the payload is opaque `&[u8]`) -- and
# accepts, in writing, the residual that the two can drift. This script is the
# mitigation that record names. A hand-written mirror WITHOUT it is drift
# waiting to happen, and the failure mode is silent: an item type added in the
# extension or the web client simply fails to decode on iOS, one user at a
# time.
#
# It compares NAMES, both directions:
#   TypeScript: the union members of `export type ItemType = ...`
#               (packages/pv-ui/vault/types.ts:4)
#   Swift:      the case names of `enum ItemFields`
#               (ios/PasskeyVault/PasskeyVault/Vault/ItemFields.swift)
#
# SHELL DISCIPLINE (landmine L-3, ios/IOS-SPIKE-LOG.md §3): this project's
# shell is zsh, where the bash-only post-pipe status array is spelled
# differently and the bash-only spelling is silently EMPTY here. So no check
# below takes its verdict from a pipeline's exit status. Both sides are
# captured into strings and the strings are compared with `[ "$a" = "$b" ]`.
#
# It also refuses to pass on an EMPTY extraction. A regex that stops matching
# -- because the union moved, or the enum was renamed -- would otherwise make
# both sides empty, and empty equals empty: a check that reports PASS at
# exactly the moment it stopped being able to see anything. That is this
# repo's most reliably recurring defect (landmine L-9), so it is guarded
# explicitly rather than assumed away.
#
# Exit codes:
#   0 = the six names match
#   1 = they diverge (a diff is printed)
#   2 = an extraction came back empty -- the script itself is broken, NOT a
#       pass and NOT a divergence. Never conflate this with 1.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TS_FILE="packages/pv-ui/vault/types.ts"
SWIFT_FILE="ios/PasskeyVault/PasskeyVault/Vault/ItemFields.swift"

for f in "$TS_FILE" "$SWIFT_FILE"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: $f not found -- the parity check cannot run, and that is not a pass" >&2
    exit 2
  fi
done

# --- TypeScript side -------------------------------------------------------
# `export type ItemType = "login" | "card" | ...;` -- pull every
# double-quoted token off that one line.
TS_NAMES=$(
  grep -E '^export type ItemType[[:space:]]*=' "$TS_FILE" \
    | grep -oE '"[a-zA-Z_][a-zA-Z0-9_]*"' \
    | tr -d '"' \
    | sort
)

# --- Swift side ------------------------------------------------------------
# `enum ItemFields: ... {` ... `case login(LoginFields)` ... up to the first
# line that closes the declaration at column 0. Only `case <name>(` lines are
# taken, so the computed properties' `case .login:` switch arms inside the
# same enum are not matched (they carry a dot).
SWIFT_NAMES=$(
  awk '
    /^enum ItemFields[[:space:]]*:/ { inside = 1; next }
    inside && /^}/ { inside = 0 }
    inside && /^[[:space:]]*case [a-zA-Z_][a-zA-Z0-9_]*\(/ {
      line = $0
      sub(/^[[:space:]]*case[[:space:]]+/, "", line)
      sub(/\(.*$/, "", line)
      print line
    }
  ' "$SWIFT_FILE" | sort
)

# --- the empty-extraction guard (exit 2, never 0) --------------------------
TS_COUNT=$(printf '%s\n' "$TS_NAMES" | grep -c . || true)
SWIFT_COUNT=$(printf '%s\n' "$SWIFT_NAMES" | grep -c . || true)

if [ "$TS_COUNT" -eq 0 ]; then
  echo "ERROR: extracted ZERO type names from $TS_FILE -- the union's declaration moved or changed shape." >&2
  echo "       This is a broken check, not a passing one." >&2
  exit 2
fi
if [ "$SWIFT_COUNT" -eq 0 ]; then
  echo "ERROR: extracted ZERO case names from $SWIFT_FILE -- 'enum ItemFields' moved or changed shape." >&2
  echo "       This is a broken check, not a passing one." >&2
  exit 2
fi

# --- compare ---------------------------------------------------------------
if [ "$TS_NAMES" = "$SWIFT_NAMES" ]; then
  echo "item type parity OK -- $TS_COUNT members, identical on both sides:"
  printf '%s\n' "$TS_NAMES" | sed 's/^/  - /'
  exit 0
fi

echo "ERROR: item type parity FAILED -- the Swift mirror and packages/pv-ui/vault/types.ts disagree." >&2
echo "  TypeScript ($TS_FILE): $(printf '%s' "$TS_NAMES" | tr '\n' ' ')" >&2
echo "  Swift      ($SWIFT_FILE): $(printf '%s' "$SWIFT_NAMES" | tr '\n' ' ')" >&2
echo >&2
echo "  diff (< TypeScript, > Swift):" >&2
diff <(printf '%s\n' "$TS_NAMES") <(printf '%s\n' "$SWIFT_NAMES") >&2 || true
exit 1
