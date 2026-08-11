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
# Demonstrated falsifiable (QA-02/QA-04): add a raw-byte-returning method to
# `impl FfiUserKey` in crates/pv-ffi/src/lib.rs, re-run scripts/build-ios.sh,
# re-run this script, observe FAIL naming the new symbol; revert both,
# re-run both, observe PASS. See 35-04-SUMMARY.md for the recorded
# transcript. The missing-bindings precheck is falsified the same way (a
# temporary `rm -rf` of the bindings directory).
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

# Isolates one class's full body by brace depth, not by line-start pattern:
# this codegen emits FUNCTION-level closing braces at column 0 too (e.g. a
# single-expression `generate()`'s closing "}" sits unindented, identical in
# shape to the class's own closing "}") -- a naive `sed -n '/^open class/,/^}/p'`
# range terminates on the FIRST such line and silently truncates the class
# body before any method declared after it, which would make this audit
# blind to exactly the accessor shape it exists to catch. Brace-depth
# counting is immune to this because it only cares about the running total,
# not which column any individual "}" happens to land in.
extract_class_body() {
  local cls="$1" file="$2"
  awk -v cls="$cls" '
    BEGIN { depth = 0; started = 0 }
    started == 0 && $0 ~ ("^open class " cls ":") { started = 1 }
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

VIOLATIONS=""

for f in "$BINDINGS_DIR"/*.swift; do
  # (A) free top-level functions: signature mentions a handle type AND
  # returns Data/[UInt8], on one line (this project's uniffi-bindgen-swift
  # output emits full signatures on a single line -- verified against the
  # real generated file this session).
  MATCHES_A=$(grep -E "^public func .*($HANDLE_TYPES).*$BYTE_RETURN_RE" "$f" || true)
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
  for cls in FfiUserKey FfiWrappingKey; do
    CLASS_BODY=$(extract_class_body "$cls" "$f")
    [ -z "$CLASS_BODY" ] && continue
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

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: raw-byte accessor(s) found on a key-handle type outside the FFI-03 sanctioned exception (exportUserKeyForSession/importUserKeyFromSession):" >&2
  echo "$VIOLATIONS" >&2
  exit 1
fi

echo "PASS: generated Swift exposes zero raw-byte accessors on FfiUserKey/FfiWrappingKey beyond exportUserKeyForSession/importUserKeyFromSession (FFI-02)"
