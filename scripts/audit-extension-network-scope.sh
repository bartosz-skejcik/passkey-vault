#!/usr/bin/env bash
# scripts/audit-extension-network-scope.sh -- Plan 43-06 (OPT-03), Task 3 (43-PLAN-CHECK.md C2): the
# standing structural gate over the AutoFill extension's new network capability (DR-43-A,
# `ios/IOS-SPIKE-LOG.md` §1). Mirrors `scripts/audit-ios-identity-store-chokepoint.sh`'s own shape:
# assertion-style, allow-list-of-N, comment-and-string-stripped source scan, falsifiable by
# injection+revert.
#
# Two independent assertions, both against the REAL sources reachable from the
# `PasskeyVaultAutoFill` TARGET -- `ios/PasskeyVault/PasskeyVaultAutoFill/` and
# `ios/PasskeyVault/Shared/` (the extension links nothing else; `ios/PasskeyVault/PasskeyVault/`
# and `ios/PasskeyVault/PvShared/` are out of scope for THIS gate -- the host app's own,
# unconstrained `VaultAPI` usage there is not what T-43-10 is about):
#
#   (A) Every `VaultAPI(` CONSTRUCTION site in a scanned file is inside an EXPLICIT, reviewed
#       allow-list. Ground-truthed against the real tree, THIS session: the allow-list is
#       currently EMPTY -- nothing under `PasskeyVaultAutoFill/` or `Shared/` constructs a
#       `VaultAPI` today (Task 1/Task 2 of this plan add the TYPE and its host-side retry caller
#       only; ContentView.swift's own retry-hook construction is host-only, outside these two scan
#       roots). Plan 43-07's registration confirmation-flow file is expected to be the FIRST entry
#       added here, reviewed at that time.
#
#   (B) No file reachable from the extension target calls any `VaultAPI` method OTHER than
#       `createItem` -- `sync`, `deleteItem`, `touchItem`, `updateItem`, `createFolder`,
#       `deleteFolder` are all refused, scanned as CALLS (`.methodName(`), never as the struct's
#       own DEFINITIONS (`func methodName(`) in `Shared/VaultAPI.swift` itself, which this gate
#       must not trip on merely for DEFINING the full API surface Task 1's own DR-43-A explains
#       (`Shared/VaultAPI.swift`'s header: the full method surface stays physically present so
#       host call sites compile unchanged; this gate is what keeps it UN-CALLED from the extension
#       side).
#
# Every scan below runs over a comment/string-STRIPPED copy (the exact CR-02 technique
# `scripts/audit-ios-identity-store-chokepoint.sh` already proved sound, copied verbatim) -- so
# this file's own header prose (which necessarily quotes every pattern/anchor below) can never
# trip itself, and a call that has been COMMENTED OUT is correctly treated as ABSENT, not present.
#
# Never relies on bash's post-pipe exit-code array (zsh is this project's shell -- landmine L-3).
# Missing-input precheck FAILS LOUDLY, never skips.
#
# Falsification transcript (Task 3's own acceptance criteria), recorded in
# `ios/evidence/43/43-06-network-scope-falsification.log`:
#   1. A throwaway `VaultAPI(...)` construction added to a file NOT on the allow-list (a scratch
#      file under `PasskeyVaultAutoFill/`) -> non-zero exit naming that file/line -> removed ->
#      exit 0 again.
#   2. A throwaway `.sync(` (or another non-`createItem` method) call added to that SAME scratch
#      file -> non-zero exit naming it under assertion (B) -> removed -> exit 0 again.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --- Precheck: the two source roots must exist, or this is an ERROR, never a skip -------------
SCAN_DIRS=(
  "ios/PasskeyVault/PasskeyVaultAutoFill"
  "ios/PasskeyVault/Shared"
)
# Test-only override, used exclusively by this gate's OWN missing-input falsification transcript.
if [ -n "${PV_AUDIT_NETWORK_SCOPE_SCAN_OVERRIDE:-}" ]; then
  SCAN_DIRS=("$PV_AUDIT_NETWORK_SCOPE_SCAN_OVERRIDE")
fi

for d in "${SCAN_DIRS[@]}"; do
  if [ ! -d "$d" ]; then
    echo "ERROR: expected Swift source directory missing: $d -- refusing to report PASS over an unscanned tree" >&2
    exit 1
  fi
done

# --- Assertion (A)'s allow-list: exact file paths, reviewed, each with its own justification ----
# Deliberately EMPTY today -- see this file's own header above for why. Plan 43-07 adds the first
# entry (its own registration confirmation-flow file) when it wires the first real caller.
ALLOWLIST=()

is_allowlisted() {
  local candidate="$1" entry
  for entry in "${ALLOWLIST[@]:-}"; do
    [ -n "$entry" ] && [ "$candidate" = "$entry" ] && return 0
  done
  return 1
}

# --- Lexical preprocessing (CR-02, copied verbatim from audit-ios-identity-store-chokepoint.sh) -
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

# A raw string literal (`#"..."#`) this stripper cannot tokenize -- refuse to report PASS over an
# unscanned construct, matching the identity-store gate's own WR-07 discipline. No file in this
# tree uses one today.
refuse_unsupported_string_literals() {
  local f="$1"
  if grep -qF '#"' "$f"; then
    echo "ERROR: $f contains a raw string literal (#\"...\"#) this gate's stripper cannot tokenize -- refusing to report PASS over an unscanned construct" >&2
    exit 1
  fi
}

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

SWIFT_FILES=()
for d in "${SCAN_DIRS[@]}"; do
  while IFS= read -r -d '' f; do
    SWIFT_FILES+=("$f")
  done < <(find "$d" -type f -name '*.swift' -print0)
done
if [ "${#SWIFT_FILES[@]}" -eq 0 ]; then
  echo "ERROR: no .swift files found under ${SCAN_DIRS[*]} -- refusing to report PASS over an unscanned tree" >&2
  exit 1
fi

CONSTRUCT_PATTERN='VaultAPI\('
OTHER_METHOD_PATTERN='\.sync\(|\.deleteItem\(|\.touchItem\(|\.updateItem\(|\.createFolder\(|\.deleteFolder\('

VIOLATIONS_A=""
VIOLATIONS_B=""

for f in "${SWIFT_FILES[@]}"; do
  refuse_unsupported_string_literals "$f"
  STRIPPED="$SCRATCH/$(echo "$f" | tr '/' '_').stripped"
  strip_comments_and_strings "$f" > "$STRIPPED"

  CONSTRUCT_MATCHES=$(grep -nE "$CONSTRUCT_PATTERN" "$STRIPPED" || true)
  if [ -n "$CONSTRUCT_MATCHES" ] && ! is_allowlisted "$f"; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      VIOLATIONS_A="${VIOLATIONS_A}${f}:${line} [VaultAPI construction OUTSIDE the allow-list]"$'\n'
    done <<< "$CONSTRUCT_MATCHES"
  fi

  if is_allowlisted "$f"; then
    OTHER_MATCHES=$(grep -nE "$OTHER_METHOD_PATTERN" "$STRIPPED" || true)
    if [ -n "$OTHER_MATCHES" ]; then
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        VIOLATIONS_B="${VIOLATIONS_B}${f}:${line} [VaultAPI method call OTHER than .createItem( from an allow-listed file]"$'\n'
      done <<< "$OTHER_MATCHES"
    fi
  fi
done

if [ -n "$VIOLATIONS_A" ] || [ -n "$VIOLATIONS_B" ]; then
  echo "FAIL: extension network-scope violation(s) found (T-43-10):" >&2
  if [ -n "$VIOLATIONS_A" ]; then
    echo "-- Assertion (A), VaultAPI construction outside the allow-list:" >&2
    echo "$VIOLATIONS_A" >&2
  fi
  if [ -n "$VIOLATIONS_B" ]; then
    echo "-- Assertion (B), a non-createItem VaultAPI method called from an allow-listed file:" >&2
    echo "$VIOLATIONS_B" >&2
  fi
  exit 1
fi

echo "PASS: the AutoFill extension constructs VaultAPI ONLY from the reviewed allow-list (${ALLOWLIST[*]:-<empty>}), and every such construction site calls ONLY .createItem( (T-43-10, DR-43-A)"
