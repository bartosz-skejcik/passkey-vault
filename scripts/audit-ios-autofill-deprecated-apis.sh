#!/usr/bin/env bash
# scripts/audit-ios-autofill-deprecated-apis.sh -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-
# mi-dzy-procesami), Plan 41-08, Task 2 (E41-9 item 1): a standing structural gate over BOTH the
# host app target and the extension target's Swift sources, rejecting every deprecated
# AuthenticationServices spelling `41-RESEARCH.md`'s "The overload traps" table documents (F2).
#
# The five spellings scanned, and WHY each pattern is shaped the way it is:
#
#   1/2. `provideCredentialWithoutUserInteraction(for: ASPasswordCredentialIdentity)` and
#        `prepareInterfaceToProvideCredential(for: ASPasswordCredentialIdentity)` -- the deprecated
#        VC override PAIR (36-RESEARCH's own original finding, L-9/L-33's own numbering note in
#        `ios/IOS-SPIKE-LOG.md`): the concrete-`ASPasswordCredentialIdentity`-typed override
#        compiles, Xcode's own template writes it, and it silently never fires (Pitfall 7). Caught
#        by matching the override's own parameter TYPE, never inferred from label alone -- there is
#        no label difference on this pair (F2's own table), only the type.
#
#   3/4. `saveCredentialIdentities`/`removeCredentialIdentities` -- the store-write pair. L-33
#        (`ios/IOS-SPIKE-LOG.md`, `IdentityStoreSync.swift`'s own header) CORRECTED the plan's own
#        originally-inherited assumption: retyping the array as concrete `[ASPasswordCredentialIdentity]`
#        alone does NOT rebind the deprecated overload under this codebase's `try await` call form
#        (`@_disfavoredOverload` on the deprecated pair means the CURRENT overload wins via an
#        implicit array upcast regardless of the array's static element type). The REAL trigger,
#        verified live against this toolchain, is the RAW, non-`async` COMPLETION-HANDLER call form
#        (`store.saveCredentialIdentities(ids, completion: ...)`) -- both the current AND
#        deprecated Objective-C selectors expose that SAME completion-handler-shaped Swift name
#        with IDENTICAL argument labels (differing only by the array's ELEMENT TYPE, which the
#        completion-handler call path does not disfavor the same way the async-imported overload
#        does). This gate therefore watches for the COMPLETION-HANDLER FORM itself -- any call
#        naming `completion:` -- rather than for array element typing, which 41-04's own live
#        falsification proved does NOT reproduce the bind and would make this gate detect a pattern
#        that cannot actually cause the defect.
#
#   5.   `replaceCredentialIdentities(with:...)` -- UNAFFECTED by L-33's correction: this pair's
#        deprecated selector genuinely differs by ARGUMENT LABEL (`with:` vs the current, unlabeled
#        `_:`), the one row in F2's table distinguishable this way at all (and only visible via
#        `.apinotes`, a 16-line file a header-only read misses). Caught by the literal `with:` label.
#
# Lexical preprocessing (comment/string stripping) is copied from the EXACT technique
# `scripts/audit-ffi-opaque-handles.sh` already proved sound (CR-02: a doc comment containing one
# unbalanced brace/pattern-lookalike must never influence a scan) -- every match below runs over a
# STRIPPED copy, never the raw file, so this gate's own header prose (which necessarily quotes
# every one of these five spellings) can never trip itself, and neither can a code comment
# mentioning one of these patterns near a real call site (this task's own second RED transcript).
#
# Never relies on bash's post-pipe exit-code array (this project's shell is zsh, where that array
# is silently empty -- landmine L-3, `ios/IOS-SPIKE-LOG.md` Sec 3). Every check below inspects a
# captured variable/file directly, never `cmd | tail` followed by a status read.
#
# Missing-input precheck FAILS LOUDLY, never skips: a skip that reports success is the specific
# defect family this worktree has already produced four members of (T-41-42, this plan's own
# `<threat_model>`).
#
# Falsification transcripts (Task 2's own acceptance criteria) recorded in
# `ios/evidence/41/e41-9-gates.log`:
#   1. A deprecated VC-override spelling temporarily introduced into an extension source file ->
#      non-zero exit naming the file/line -> removed -> exit 0 again.
#   2. The SAME pattern placed inside a `//` comment near a real call site -> exit 0 (proves the
#      comment-stripping is what makes transcript 1 meaningful, not accidental).
#   3. The script pointed at a non-existent source directory -> named error, non-zero exit.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --- Precheck: the three source roots must exist, or this is an ERROR, never a skip ------------
SCAN_DIRS=(
  "ios/PasskeyVault/PasskeyVault"
  "ios/PasskeyVault/PasskeyVaultAutoFill"
  "ios/PasskeyVault/Shared"
)
# Test-only override, used exclusively by this gate's OWN missing-input falsification transcript
# (never by a real run): points ONE scan root at a caller-supplied path instead of the real tree.
if [ -n "${PV_AUDIT_DEPRECATED_APIS_SCAN_OVERRIDE:-}" ]; then
  SCAN_DIRS=("$PV_AUDIT_DEPRECATED_APIS_SCAN_OVERRIDE")
fi

for d in "${SCAN_DIRS[@]}"; do
  if [ ! -d "$d" ]; then
    echo "ERROR: expected Swift source directory missing: $d -- refusing to report PASS over an unscanned tree" >&2
    exit 1
  fi
done

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

# --- Lexical preprocessing (CR-02, copied verbatim from audit-ffi-opaque-handles.sh; WR-07
# (41-REVIEW.md) added `"""` multi-line string handling) -------------------------------------
# Strips `//` line comments, nested `/* */` block comments, and the CONTENTS of string literals,
# so this gate's own header prose and any code comment quoting one of the five patterns below can
# never trip the scan. Declarations/call sites themselves are code and survive stripping intact.
#
# WR-07: the original version toggled `state` on every SINGLE `"`, so a `"""` multi-line literal
# was read as string-open, string-close, string-open -- leaving the machine in `state == "string"`
# for the REST OF THE FILE, at which point every subsequent line is emitted empty and every real
# call site in it becomes invisible to the scan. That failure direction is a FALSE PASS, the one
# direction a gate must not fail in. `"""` is now recognized explicitly (real files in this tree,
# e.g. `TracerFillSeeder.swift`/`LockE41Seeder.swift`, already use multi-line JSON literals).
#
# Raw string literals (`#"..."#`) are NOT tokenized -- `refuse_unsupported_string_literals` below
# fails loud on any file containing one rather than silently mis-scanning it (T-41-42). No file in
# this tree uses one today.
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

# WR-07: fail loud on a raw string literal (`#"`) rather than silently mis-scan one -- see this
# file's own header above for why raw literals are refused rather than tokenized.
refuse_unsupported_string_literals() {
  local f="$1"
  if grep -qF '#"' "$f"; then
    echo "ERROR: $f contains a raw string literal (#\"...\"#) this gate's stripper cannot tokenize -- refusing to report PASS over an unscanned construct" >&2
    exit 1
  fi
}

VIOLATIONS=""
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

for f in "${SWIFT_FILES[@]}"; do
  refuse_unsupported_string_literals "$f"
  STRIPPED="$SCRATCH/$(echo "$f" | tr '/' '_').stripped"
  strip_comments_and_strings "$f" > "$STRIPPED"

  # (1) provideCredentialWithoutUserInteraction(for: ASPasswordCredentialIdentity)
  MATCHES=$(grep -nE 'func[[:space:]]+provideCredentialWithoutUserInteraction\(for[[:space:]]+[A-Za-z_][A-Za-z0-9_]*:[[:space:]]*ASPasswordCredentialIdentity\)' "$STRIPPED" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      VIOLATIONS="${VIOLATIONS}${f}:${line} [deprecated VC override: provideCredentialWithoutUserInteraction(for: ASPasswordCredentialIdentity)]"$'\n'
    done <<< "$MATCHES"
  fi

  # (2) prepareInterfaceToProvideCredential(for: ASPasswordCredentialIdentity)
  MATCHES=$(grep -nE 'func[[:space:]]+prepareInterfaceToProvideCredential\(for[[:space:]]+[A-Za-z_][A-Za-z0-9_]*:[[:space:]]*ASPasswordCredentialIdentity\)' "$STRIPPED" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      VIOLATIONS="${VIOLATIONS}${f}:${line} [deprecated VC override: prepareInterfaceToProvideCredential(for: ASPasswordCredentialIdentity)]"$'\n'
    done <<< "$MATCHES"
  fi

  # (3) saveCredentialIdentities(..., completion: ...) -- the completion-handler form (L-33's
  # corrected mechanism), not array element typing.
  MATCHES=$(grep -nE '\.saveCredentialIdentities\([^)]*completion:' "$STRIPPED" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      VIOLATIONS="${VIOLATIONS}${f}:${line} [deprecated store write: saveCredentialIdentities(..., completion:) completion-handler form -- L-33]"$'\n'
    done <<< "$MATCHES"
  fi

  # (4) removeCredentialIdentities(..., completion: ...) -- same shape as (3).
  MATCHES=$(grep -nE '\.removeCredentialIdentities\([^)]*completion:' "$STRIPPED" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      VIOLATIONS="${VIOLATIONS}${f}:${line} [deprecated store write: removeCredentialIdentities(..., completion:) completion-handler form -- L-33]"$'\n'
    done <<< "$MATCHES"
  fi

  # (5) replaceCredentialIdentities(with: ...) -- the deprecated LABEL form.
  MATCHES=$(grep -nE '\.replaceCredentialIdentities\(with:' "$STRIPPED" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      VIOLATIONS="${VIOLATIONS}${f}:${line} [deprecated store write: replaceCredentialIdentities(with:...) labelled form]"$'\n'
    done <<< "$MATCHES"
  fi

  # (3b)/(4b) WR-05 (41-REVIEW.md): the TRAILING-CLOSURE spelling of the completion-handler form
  # -- `store.saveCredentialIdentities(ids) { success, error in ... }` -- is the NATURAL Swift way
  # to write a completion-handler API, and patterns (3)/(4) above only match a call where the
  # literal label `completion:` appears before the closing `)`. No `completion:` label means no
  # match, so the trailing-closure spelling of the exact same deprecated bind (L-33) was silently
  # invisible to this gate. `\)[[:space:]]*\{` requires the call's own argument list to have
  # closed before a `{` opens -- distinguishing a genuine trailing closure from an unrelated `{`
  # appearing later on the same stripped line.
  MATCHES=$(grep -nE '\.(save|remove)CredentialIdentities\([^)]*\)[[:space:]]*\{' "$STRIPPED" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      VIOLATIONS="${VIOLATIONS}${f}:${line} [deprecated store write: (save|remove)CredentialIdentities(...) { ... } trailing-closure completion-handler form -- L-33, WR-05]"$'\n'
    done <<< "$MATCHES"
  fi
done

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: deprecated AuthenticationServices spelling(s) found (FILL-03, L-9/L-33):" >&2
  echo "$VIOLATIONS" >&2
  exit 1
fi

echo "PASS: no deprecated AuthenticationServices spelling found across ${#SWIFT_FILES[@]} Swift file(s) under ${SCAN_DIRS[*]} (FILL-03, L-9/L-33)"
