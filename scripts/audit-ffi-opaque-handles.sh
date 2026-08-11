#!/usr/bin/env bash
# scripts/audit-ffi-opaque-handles.sh -- FFI-02 structural gate (Phase 35,
# Plan 35-04): proves the opaque-handle guarantee against the artifact a
# Swift caller actually sees -- the GENERATED Swift bindings
# (ios/PasskeyVault/build/swift-bindings/*.swift, produced by
# scripts/build-ios.sh from crates/pv-ffi) -- never the Rust source. A
# source-level self-check only proves intent; UniFFI's code generation is
# the real boundary (crates/pv-ffi/src/lib.rs's own module header, "SC3").
#
# Rule: no function reachable on FfiUserKey/FfiWrappingKey may return raw
# key bytes (Data/[UInt8]) to Swift, except the two FFI-03 sanctioned
# exception names (`exportUserKeyForSession`/`importUserKeyFromSession` --
# see crates/pv-ffi/src/lib.rs's module header, "SANKCJONOWANY WYJATEK").
# `importUserKeyFromSession` accepts bytes and returns an opaque handle --
# it never returns raw bytes, so it is not caught by the returns-Data scan
# below; it is named here only because it is the documented other half of
# the CP-4 exception pair, not because this script needs to allow-list it
# separately.
#
# Two shapes of "byte accessor" this project's UniFFI codegen can produce,
# both scanned:
#   (A) a free top-level function whose signature mentions FfiUserKey/
#       FfiWrappingKey and returns Data/[UInt8] (the shape
#       exportUserKeyForSession itself takes: `func f(userKey: FfiUserKey)
#       -> Data`).
#   (B) an instance/static method declared INSIDE the FfiUserKey/
#       FfiWrappingKey class body that returns Data/[UInt8] (the shape a
#       hand-added `&self` accessor would take -- self is implicit, so the
#       handle type name never appears on the method's own signature line;
#       catching this requires isolating each class body first).
#
# Never rely on bash's post-pipe exit-code array (this project's shell is
# zsh, where that array is silently empty -- landmine L-3,
# ios/IOS-SPIKE-LOG.md Sec 3 / 35-RESEARCH.md). Every check below relies on
# `set -o pipefail` propagation or avoids pipes into a status check
# entirely.
#
# Demonstrated falsifiable (QA-02/QA-04) on THREE distinct inputs, not one --
# a gate whose falsification proof only covers the shape it already handles
# is not proven falsifiable:
#   1. Plain injected accessor: add a raw-byte-returning method to
#      `impl FfiUserKey` in crates/pv-ffi/src/lib.rs, re-run
#      scripts/build-ios.sh, re-run this script, observe FAIL naming the new
#      symbol; revert both, re-run both, observe PASS (35-04-SUMMARY.md).
#   2. CR-02 -- the same accessor preceded by a doc comment containing ONE
#      unbalanced `}`. Against the pre-CR-02 script this printed PASS with
#      the leak present (exit 0); it now FAILs (exit 1).
#   3. CR-03 -- the same accessor with the class declaration reworded
#      (`open class FfiUserKey:` -> `public final class FfiUserKey:`).
#      Against the pre-CR-03 script this printed PASS with the leak present
#      (exit 0); it now FAILs. Separately, a handle class that cannot be
#      found or whose body cannot be isolated is a hard ERROR with exit 1,
#      never a silent skip.
# The missing-bindings precheck is falsified the same way (a temporary
# `rm -rf` of the bindings directory).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BINDINGS_DIR="ios/PasskeyVault/build/swift-bindings"

# --- Precheck: real, freshly-generated bindings must exist -----------------
# "WARN and skip" is NOT an option here -- a missing-file skip would
# silently pass an unaudited state, exactly the failure class this gate
# exists to prevent.
FOUND_ANY=0
for f in "$BINDINGS_DIR"/*.swift; do
  [ -f "$f" ] && FOUND_ANY=1
done
if [ "$FOUND_ANY" -eq 0 ]; then
  echo "ERROR: generated Swift bindings not found under $BINDINGS_DIR -- run scripts/build-ios.sh first" >&2
  exit 1
fi

ALLOWED='^(exportUserKeyForSession|importUserKeyFromSession)$'
BYTE_RETURN_RE='-> *(Data|\[UInt8\])'
HANDLE_TYPES='FfiUserKey|FfiWrappingKey'
NAME_RE='^[[:space:]]*(public|open)[[:space:]]+(static[[:space:]]+)?func[[:space:]]+([A-Za-z0-9_]+).*'

# --- Lexical preprocessing (CR-02) ----------------------------------------
# Brace counting over RAW Swift text is not sound, and this was not
# hypothetical: the class-body isolation below counts "{" minus "}" per line,
# and a single unbalanced "}" appearing inside a doc comment drives the
# running depth to 0, truncating the class body before any method declared
# after it -- reported as PASS while a raw-byte accessor sat in the skipped
# region. The generated Swift ALREADY carries brace characters from prose:
# the Rust doc comments in crates/pv-ffi are copied verbatim into the
# bindings, and one of them contains
#   `caller writes an ordinary `do { try ... } catch { ... }`) for`
# which is brace-balanced only by coincidence. One future doc-comment edit
# mentioning a single closing brace would have disabled this gate silently.
#
# So: every scan below runs over a lexically preprocessed copy in which
# comments (`//` to EOL, and NESTED `/* */` -- Swift block comments nest)
# and the CONTENTS of string literals have been removed. Braces, `//`
# lookalikes and the word `class` can therefore no longer reach the scanners
# from inside a comment or a string. Declarations themselves are code and
# survive stripping intact, so violation lines still report readably.
#
# Deliberately fail-SAFE rather than fail-open on the one construct this
# lexer does not model (Swift multiline `"""` literals -- none exist in this
# codegen today, `grep -c '"""'` is 0): mis-lexing one would leave the string
# state open, which UNDER-counts closing braces and therefore over-extends a
# class body. That direction can only cause a false FAIL (loud), never a
# false PASS (silent).
strip_comments_and_strings() {
  awk '
    function strip(line,   out, i, c, d, n) {
      out = ""
      n = length(line)
      i = 1
      while (i <= n) {
        c = substr(line, i, 1)
        d = substr(line, i + 1, 1)
        if (state == "block") {
          if (c == "*" && d == "/") { cdepth--; i += 2; if (cdepth <= 0) { cdepth = 0; state = "code" } ; continue }
          if (c == "/" && d == "*") { cdepth++; i += 2; continue }
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

# Isolates one class's full body by brace depth, not by line-start pattern:
# this codegen emits FUNCTION-level closing braces at column 0 too (e.g. a
# single-expression `generate()`'s closing "}" sits unindented, identical in
# shape to the class's own closing "}") -- a naive `sed -n '/^open class/,/^}/p'`
# range terminates on the FIRST such line and silently truncates the class
# body before any method declared after it, which would make this audit
# blind to exactly the accessor shape it exists to catch. Brace-depth
# counting is immune to this because it only cares about the running total,
# not which column any individual "}" happens to land in -- but ONLY when it
# runs over comment/string-stripped input (CR-02, see above); this function
# must never be handed a raw .swift file.
#
# The declaration match is deliberately modifier-agnostic (`class <Name>`
# preceded by anything) rather than anchored to the exact `^open class `
# spelling this codegen emits today: a uniffi patch bump emitting
# `public final class FfiUserKey:` used to make this function return nothing,
# which the caller turned into a silent skip (CR-03).
extract_class_body() {
  local cls="$1" file="$2"
  awk -v cls="$cls" '
    BEGIN { depth = 0; started = 0 }
    started == 0 && $0 ~ ("(^|[^A-Za-z0-9_])class[ \t]+" cls "[ \t]*(:|\\{)") { started = 1 }
    started == 1 {
      print
      line = $0
      opens  = gsub(/\{/, "{", line)
      closes = gsub(/\}/, "}", line)
      depth += opens - closes
      if (depth <= 0) { exit }
    }
  ' "$file"
}

# Handle classes that MUST exist. Discovery below is dynamic (so a handle
# type added in Phase 36+ -- session/keychain/collection -- is audited
# automatically instead of being silently unaudited), but discovery alone
# would be fail-open: if the codegen stopped emitting a class under a name
# this script recognises, "found nothing" would read as "nothing to audit".
# These two must be found, or the run is an ERROR.
EXPECTED_CLASSES="FfiUserKey FfiWrappingKey"

VIOLATIONS=""
DISCOVERED_ALL=""
AUDITED_ALL=""

SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

for f in "$BINDINGS_DIR"/*.swift; do
  # Every scan below runs over the comment/string-stripped copy, never the
  # raw file (CR-02).
  STRIPPED="$SCRATCH/$(basename "$f").stripped"
  strip_comments_and_strings "$f" > "$STRIPPED"

  # (A) free top-level functions: signature mentions a handle type AND
  # returns Data/[UInt8], on one line (this project's uniffi-bindgen-swift
  # output emits full signatures on a single line -- verified against the
  # real generated file this session).
  MATCHES_A=$(grep -E "^public func .*($HANDLE_TYPES).*$BYTE_RETURN_RE" "$STRIPPED" || true)
  if [ -n "$MATCHES_A" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      name=$(echo "$line" | sed -E "s/$NAME_RE/\\3/")
      if ! echo "$name" | grep -qE "$ALLOWED"; then
        VIOLATIONS="${VIOLATIONS}${f} (free func): ${line}"$'\n'
      fi
    done <<< "$MATCHES_A"
  fi

  # (B) methods declared inside each handle class's own body.
  #
  # CR-03: the class list is DISCOVERED from the (stripped) bindings, not
  # hardcoded. The previous `for cls in FfiUserKey FfiWrappingKey` plus
  # `[ -z "$CLASS_BODY" ] && continue` meant (a) any handle type added by a
  # later phase was silently unaudited, and (b) any change to the class
  # declaration's spelling turned "I could not find the class" into a PASS.
  # Both were reproduced against a leaking build. This file's own header,
  # 20 lines up, states the rule: "WARN and skip is NOT an option here".
  CLASSES=$(grep -oE '(^|[^A-Za-z0-9_])class[[:space:]]+Ffi[A-Za-z0-9_]+' "$STRIPPED" \
              | sed -E 's/.*class[[:space:]]+//' | sort -u || true)
  DISCOVERED_ALL="$DISCOVERED_ALL $CLASSES"

  for cls in $CLASSES; do
    CLASS_BODY=$(extract_class_body "$cls" "$STRIPPED")
    if [ -z "$CLASS_BODY" ]; then
      echo "ERROR: found a declaration of handle class '$cls' in $f but could not isolate its body -- refusing to report PASS over an unaudited class" >&2
      exit 1
    fi
    AUDITED_ALL="$AUDITED_ALL $cls"
    MATCHES_B=$(echo "$CLASS_BODY" | grep -E "func .*$BYTE_RETURN_RE" || true)
    if [ -n "$MATCHES_B" ]; then
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        name=$(echo "$line" | sed -E "s/$NAME_RE/\\3/")
        if ! echo "$name" | grep -qE "$ALLOWED"; then
          VIOLATIONS="${VIOLATIONS}${f} [${cls} method]: ${line}"$'\n'
        fi
      done <<< "$MATCHES_B"
    fi
  done
done

# CR-03, fail-closed: an expected handle class that was never discovered
# means the codegen's shape changed under us. Reporting PASS over that is
# the exact failure class this gate exists to prevent, so it is an ERROR.
if [ -z "$(echo "$DISCOVERED_ALL" | tr -d '[:space:]')" ]; then
  echo "ERROR: no Ffi* handle classes found anywhere under $BINDINGS_DIR -- the codegen shape changed and NOTHING was audited" >&2
  exit 1
fi
for want in $EXPECTED_CLASSES; do
  if ! echo "$AUDITED_ALL" | tr ' ' '\n' | grep -qx "$want"; then
    echo "ERROR: expected handle class '$want' was not found/audited in $BINDINGS_DIR -- refusing to report PASS on an unaudited handle type (audited: $(echo "$AUDITED_ALL" | tr -s ' '))" >&2
    exit 1
  fi
done

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: raw-byte accessor(s) found on a key-handle type outside the FFI-03 sanctioned exception (exportUserKeyForSession/importUserKeyFromSession):" >&2
  echo "$VIOLATIONS" >&2
  exit 1
fi

echo "PASS: generated Swift exposes zero raw-byte accessors beyond exportUserKeyForSession/importUserKeyFromSession (FFI-02)"
echo "      audited handle classes:$(echo "$AUDITED_ALL" | tr -s ' ')"
