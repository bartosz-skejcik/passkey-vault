#!/usr/bin/env bash
# scripts/audit-ffi-opaque-handles.sh -- FFI-02 structural gate (Phase 35,
# Plan 35-04): proves the opaque-handle guarantee against the artifact a
# Swift caller actually sees -- the GENERATED Swift bindings
# (ios/PasskeyVault/build/swift-bindings/*.swift, produced by
# scripts/build-ios.sh from crates/pv-ffi) -- never the Rust source. A
# source-level self-check only proves intent; UniFFI's code generation is
# the real boundary (crates/pv-ffi/src/lib.rs's own module header, "SC3").
#
# Rule: no function reachable on any handle class (originally
# FfiUserKey/FfiWrappingKey; Phase 40 added FfiIdentityKey/FfiCollectionKey/
# FfiInviteChannel to $HANDLE_TYPES and $EXPECTED_CLASSES, plan 40-04) may
# return raw key bytes (Data/[UInt8]) to Swift, except the two FFI-03
# sanctioned exception names (`exportUserKeyForSession`/
# `importUserKeyFromSession` -- see crates/pv-ffi/src/lib.rs's module
# header, "SANKCJONOWANY WYJATEK") and the reviewed, exact-named entries in
# $CLASS_METHOD_BYTE_ALLOWLIST/$FREE_FUNC_NO_HANDLE_BYTE_ALLOWLIST below.
# `importUserKeyFromSession` accepts bytes and returns an opaque handle --
# it never returns raw bytes, so it is not caught by the returns-Data scan
# below; it is named here only because it is the documented other half of
# the CP-4 exception pair, not because this script needs to allow-list it
# separately.
#
# Four shapes of "byte accessor" this project's UniFFI codegen can produce,
# all scanned:
#   (A) a free top-level function whose signature mentions FfiUserKey/
#       FfiWrappingKey and returns Data/[UInt8] (the shape
#       exportUserKeyForSession itself takes: `func f(userKey: FfiUserKey)
#       -> Data`).
#   (B) an instance/static method declared INSIDE the FfiUserKey/
#       FfiWrappingKey class body that returns Data/[UInt8] (the shape a
#       hand-added `&self` accessor would take -- self is implicit, so the
#       handle type name never appears on the method's own signature line;
#       catching this requires isolating each class body first).
#   (C) a generated `struct` (from `#[derive(uniffi::Record)]`) that carries
#       BOTH a stored property typed as a handle (FfiUserKey/FfiWrappingKey)
#       AND a stored property typed Data/[UInt8] in the SAME struct body --
#       e.g. a hypothetical `FfiAuthMaterial { wrappingKey: FfiWrappingKey,
#       raw: Data }`. Neither (A) nor (B) sees this: it is not a function
#       returning bytes given a handle, it is a Record smuggling raw bytes
#       out ALONGSIDE a handle in the same value -- a caller who only holds
#       the struct already has both. Introduced 37-02 (Task 1's
#       `FfiAuthMaterial`), closed the same plan (Task 3) so the gate does
#       not ship one release behind the shape it needs to catch. Allowlisted
#       by exact `<StructName>.<propertyName>` pair (empty today) --
#       `generateRegistrationSalt`'s own return (a free function returning
#       `Data` with NO handle-typed argument at all) is not a shape-C match
#       by construction (shape C is about a struct BODY, not a free
#       function's return type); see shape D below for what actually covers
#       it.
#   (D) a free top-level function returning Data/[UInt8] whose signature
#       names NO handle type at all (Phase 40, plan 40-04) -- shape A
#       REQUIRES the signature to mention one of $HANDLE_TYPES, so a free
#       function naming none (no handle-typed argument OR return) was
#       previously invisible to every shape this script had, even though
#       its return may still be key material. `generateRegistrationSalt`
#       and `generateInviteSecret` are the two REVIEWED, NAMED
#       non-key-material exceptions today ($FREE_FUNC_NO_HANDLE_BYTE_ALLOWLIST),
#       kept in an exact-name allowlist with the same discipline as shapes
#       B/C's own allowlists.
#
# Never rely on bash's post-pipe exit-code array (this project's shell is
# zsh, where that array is silently empty -- landmine L-3,
# ios/IOS-SPIKE-LOG.md Sec 3 / 35-RESEARCH.md). Every check below relies on
# `set -o pipefail` propagation or avoids pipes into a status check
# entirely.
#
# Demonstrated falsifiable (QA-02/QA-04) on FOUR distinct inputs, not one --
# a gate whose falsification proof only covers the shape it already handles
# is not proven falsifiable. (Phases 35/37 history; Phase 40, plan 40-04's
# OWN four falsification inputs -- one per new handle class plus one
# unlisted free function -- are recorded further down, near
# EXPECTED_CLASSES/FREE_FUNC_NO_HANDLE_BYTE_ALLOWLIST, and in
# 40-04-SUMMARY.md.):
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
#   4. Shape C (37-02, Task 3) -- a temporary `pub raw: Vec<u8>` field added
#      to `FfiAuthMaterial` (`crates/pv-ffi/src/lib.rs`), re-run
#      scripts/build-ios.sh, re-run this script: FAILs, naming
#      `FfiAuthMaterial.raw`; revert both, re-run both, observe PASS
#      (37-02-SUMMARY.md has the transcript). A struct declaring a
#      handle-typed field whose body cannot be isolated is the same hard
#      ERROR as (2)/(3) above, never a silent skip.
# The missing-bindings precheck is falsified the same way (a temporary
# `rm -rf` of the bindings directory).
#
# `generateRegistrationSalt() -> Data` (37-02) and `generateInviteSecret()
# -> Data` (40-04) are REVIEWED, NAMED non-key-material byte exports, not
# leaks this gate needs to catch: both are free functions with NO
# handle-typed argument or return at all (shape A requires the signature to
# MENTION a handle type; neither does), and each returns explicit
# randomness, not key material -- the same sanctioned shape as `pv-wasm`'s
# `randomSalt`/`generateInviteSecret` (`crates/pv-wasm/src/lib.rs:690-706`)
# and `export_user_key_for_session`'s own FFI-03 exception above. Both are
# kept in `$FREE_FUNC_NO_HANDLE_BYTE_ALLOWLIST` (shape D) rather than only
# recorded here in prose, so a future unlisted free function of the same
# shape is caught rather than silently joining an ad-hoc "reviewed" list.
#
# Phase 40, plan 40-04's OWN four falsification inputs (distinct from the
# Phases 35/37 history above -- each covers surface THIS plan added):
#   1. A method returning `Vec<u8>` of the secret added to `FfiIdentityKey`
#      in Rust (`crates/pv-ffi/src/sharing.rs`), rebuilt, re-audited: FAILs,
#      naming the injected symbol. Reverted: PASSes again.
#   2. The same, on `FfiCollectionKey`.
#   3. The same, on `FfiInviteChannel`.
#   4. A top-level `#[uniffi::export] pub fn` returning `Vec<u8>` whose
#      signature names no handle type at all, added to
#      `crates/pv-ffi/src/sharing.rs`, rebuilt, re-audited: FAILs (shape D).
#      Reverted: PASSes again.
# All four transcripts are recorded in 40-04-SUMMARY.md.
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
# Phase 40, plan 40-04: extended from the original two Phase-35 types to all
# five handle types this project now generates -- widening this list only
# STRENGTHENS shapes A/C (more free-function/struct-field surface becomes
# reachable to the scanner), never relaxes BYTE_RETURN_RE itself.
HANDLE_TYPES='FfiUserKey|FfiWrappingKey|FfiIdentityKey|FfiCollectionKey|FfiInviteChannel'
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
#
# Generalised over the declaration KEYWORD (37-02, Task 3): shape C isolates
# `struct` bodies (UniFFI Records) with the exact same brace-depth-over-
# stripped-input technique shape B already uses for `class` bodies -- the
# codegen emits the identical "function-level closing brace at column 0"
# trap for both, so a second, independent isolator for structs would just be
# this one with `class` typo'd to `struct`. `keyword` defaults to `class` so
# every existing shape-B call site is unchanged.
extract_body() {
  local cls="$1" file="$2" keyword="${3:-class}"
  awk -v cls="$cls" -v keyword="$keyword" '
    BEGIN { depth = 0; started = 0 }
    started == 0 && $0 ~ ("(^|[^A-Za-z0-9_])" keyword "[ \t]+" cls "[ \t]*(:|\\{)") { started = 1 }
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

# Backward-compatible alias -- shape B's own call sites read more clearly
# spelled this way, and nothing about renaming the underlying function
# should force touching every existing caller in the same change.
extract_class_body() {
  extract_body "$1" "$2" class
}

# Handle classes that MUST exist. Discovery below is dynamic (so a handle
# type added in Phase 36+ -- session/keychain/collection -- is audited
# automatically instead of being silently unaudited), but discovery alone
# would be fail-open: if the codegen stopped emitting a class under a name
# this script recognises, "found nothing" would read as "nothing to audit".
# These must be found, or the run is an ERROR.
#
# Phase 40, plan 40-04: extended from the original two Phase-35 types with
# the three handle classes Phase 40 introduced (FfiIdentityKey,
# FfiCollectionKey, FfiInviteChannel). Discovery (shape B, below) already
# scanned these dynamically before this change -- this list is the "MUST be
# found or ERROR" floor, not a switch that turns scanning on: without it, a
# future codegen rename/drop of one of these three classes would silently
# stop being audited instead of failing loud, which is the exact CR-03
# failure class this file's own header describes.
EXPECTED_CLASSES="FfiUserKey FfiWrappingKey FfiIdentityKey FfiCollectionKey FfiInviteChannel"

# Shape C's allowlist, keyed by exact `<StructName>.<propertyName>` pairs
# (space-separated, empty today). Every entry here is a REVIEWED, DELIBERATE
# exception -- adding one is a security decision, not a convenience.
STRUCT_HANDLE_BYTE_ALLOWLIST=""

# Shape B's class-method allowlist (Phase 40, plan 40-02), keyed by exact
# `<ClassName>.<methodName>` pairs -- same discipline as
# STRUCT_HANDLE_BYTE_ALLOWLIST above, added because shape B previously had
# NO named exceptions at all (`$ALLOWED` only ever matches the two FFI-03
# free-function names, which by construction never appear as a class
# method). `FfiIdentityKey.publicKeyBytes` is the X25519 identity keypair's
# PUBLIC half -- publishable by design (KEY-02/DR-40-A, `crates/pv-ffi/src/
# sharing.rs`'s own module header), never the private half, mirroring
# `pv-wasm`'s own `WasmIdentityKey.publicKeyBytes` and this file's own
# reviewed `generateRegistrationSalt` reasoning ("explicit, non-secret value
# crossing the boundary as bytes on purpose", not key material leaking out
# of a handle that is supposed to keep it opaque). Falsified 40-02: with
# this entry removed, the gate FAILs naming
# `FfiIdentityKey.publicKeyBytes`; restored, it PASSes again (see
# 40-02-SUMMARY.md for the transcript).
#
# Phase 40, plan 40-04: two more exact names, both on `FfiInviteChannel` and
# both justified in `crates/pv-ffi/src/sharing.rs`'s own module header
# ("SANCTIONED RAW-BYTES EXITS"/task-1 doc comments):
#   - `FfiInviteChannel.proofHashForCreation` -- a SHA-256 DIGEST of the
#     proof-of-possession value (`proof_hash_for_creation` in Rust), sent at
#     invite-creation time. A hash, not the secret itself.
#   - `FfiInviteChannel.proofForRedemption` -- the raw bearer credential
#     (WR-08) presented in a POST body at redemption time; the server
#     verifies it directly against its own stored hash, so no other form
#     would let it do its job.
CLASS_METHOD_BYTE_ALLOWLIST="FfiIdentityKey.publicKeyBytes FfiInviteChannel.proofHashForCreation FfiInviteChannel.proofForRedemption"

# Shape D's allowlist (Phase 40, plan 40-04) -- top-level free functions
# returning Data/[UInt8] whose signature names NO handle type at all (shape
# A's own scan requires one of $HANDLE_TYPES to appear in the signature, so
# a free function naming none was previously invisible to every shape this
# script had). Keyed by exact function name only (no class prefix -- these
# are free functions, not methods). Both entries here are REVIEWED,
# non-key-material byte exports:
#   - `generateRegistrationSalt` -- an explicit 16-byte registration salt
#     (this file's own header, above, already reviewed this one before
#     shape D existed to formally catch it).
#   - `generateInviteSecret` -- sanctioned raw-bytes exit #1
#     (`crates/pv-ffi/src/sharing.rs`'s own module header): the invite
#     secret must literally appear in the URL fragment a human forwards.
FREE_FUNC_NO_HANDLE_BYTE_ALLOWLIST="generateRegistrationSalt generateInviteSecret"

VIOLATIONS=""
DISCOVERED_ALL=""
AUDITED_ALL=""
STRUCTS_AUDITED_ALL=""

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

  # (D) top-level free functions returning Data/[UInt8] whose signature
  # names NO handle type at all (Phase 40, plan 40-04). Shape A above
  # REQUIRES the signature to mention one of $HANDLE_TYPES -- a free
  # function naming none (e.g. a hypothetical future free function that
  # reimplements a key accessor without taking the handle as an argument at
  # all) is invisible to shape A even though its return value may still be
  # key material. Same BYTE_RETURN_RE, unmodified; the only difference from
  # shape A is the ABSENCE, not presence, of a handle-type match.
  MATCHES_D=$(grep -E "^public func .*$BYTE_RETURN_RE" "$STRIPPED" | grep -Ev "($HANDLE_TYPES)" || true)
  if [ -n "$MATCHES_D" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      name=$(echo "$line" | sed -E "s/$NAME_RE/\\3/")
      if ! echo " $FREE_FUNC_NO_HANDLE_BYTE_ALLOWLIST " | grep -qF " $name "; then
        VIOLATIONS="${VIOLATIONS}${f} (free func, no handle type in signature): ${line}"$'\n'
      fi
    done <<< "$MATCHES_D"
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
        key="${cls}.${name}"
        if ! echo "$name" | grep -qE "$ALLOWED" \
           && ! echo " $CLASS_METHOD_BYTE_ALLOWLIST " | grep -qF " $key "; then
          VIOLATIONS="${VIOLATIONS}${f} [${cls} method]: ${line}"$'\n'
        fi
      done <<< "$MATCHES_B"
    fi
  done

  # (C) generated `struct` (Record) bodies carrying BOTH a handle-typed
  # field AND a Data/[UInt8]-typed field (see this file's own header, shape
  # C). Discovery is dynamic, same reasoning as (B)'s CR-03 fix -- a struct
  # this script has never seen gets audited automatically, never silently
  # skipped. Unlike EXPECTED_CLASSES, there is no "N structs MUST exist"
  # floor: a build with zero handle-carrying structs is legitimately clean,
  # but a struct that IS found and DOES carry a handle-typed field, whose
  # body cannot then be isolated, is the same hard ERROR shape (B) uses --
  # never a silent skip.
  STRUCTS=$(grep -oE '(^|[^A-Za-z0-9_])struct[[:space:]]+Ffi[A-Za-z0-9_]+' "$STRIPPED" \
              | sed -E 's/.*struct[[:space:]]+//' | sort -u || true)

  for st in $STRUCTS; do
    STRUCT_BODY=$(extract_body "$st" "$STRIPPED" struct)
    if [ -z "$STRUCT_BODY" ]; then
      echo "ERROR: found a declaration of struct '$st' in $f but could not isolate its body -- refusing to report PASS over an unaudited struct" >&2
      exit 1
    fi

    # Gate: this struct only matters to shape C if it carries a stored
    # property whose type IS a handle. A struct with no handle-typed field
    # (e.g. FfiWrappedKey: nonce/ciphertext both Data, no handle at all)
    # cannot smuggle a raw handle+bytes pair out of the same value, so it is
    # simply not this shape's concern -- `continue`, not a violation.
    HAS_HANDLE_FIELD=$(echo "$STRUCT_BODY" | grep -E "public var [A-Za-z0-9_]+: *($HANDLE_TYPES)\\b" || true)
    if [ -z "$HAS_HANDLE_FIELD" ]; then
      continue
    fi
    STRUCTS_AUDITED_ALL="$STRUCTS_AUDITED_ALL $st"

    MATCHES_C=$(echo "$STRUCT_BODY" | grep -E "public var [A-Za-z0-9_]+: *(Data|\\[UInt8\\])\\b" || true)
    if [ -n "$MATCHES_C" ]; then
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        propname=$(echo "$line" | sed -E 's/.*public var ([A-Za-z0-9_]+):.*/\1/')
        key="${st}.${propname}"
        if ! echo " $STRUCT_HANDLE_BYTE_ALLOWLIST " | grep -qF " $key "; then
          VIOLATIONS="${VIOLATIONS}${f} [${st} struct, handle-carrying, raw-byte field]: ${line}"$'\n'
        fi
      done <<< "$MATCHES_C"
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
  echo "FAIL: raw-byte accessor(s)/field(s) found on or alongside a key-handle type outside the FFI-03 sanctioned exception (exportUserKeyForSession/importUserKeyFromSession) or the shape-C allowlist:" >&2
  echo "$VIOLATIONS" >&2
  exit 1
fi

echo "PASS: generated Swift exposes zero raw-byte accessors beyond exportUserKeyForSession/importUserKeyFromSession, and zero handle-carrying structs smuggle a raw-byte field alongside the handle (FFI-02, shapes A/B/C/D)"
echo "      audited handle classes:$(echo "$AUDITED_ALL" | tr -s ' ')"
echo "      audited handle-carrying structs:$(echo "$STRUCTS_AUDITED_ALL" | tr -s ' ')"
