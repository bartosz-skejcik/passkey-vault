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
#
# WR-11 (41-REVIEW.md iteration 2): a raw literal used to hard-fail the ENTIRE gate, for every push
# and PR, the moment any ONE file anywhere under the three scan roots contained a legitimate
# `#"..."#` -- correct in DIRECTION (a construct this stripper cannot tokenize must never be
# silently scanned as if it were plain Swift) but disproportionate in BLAST RADIUS (an unrelated
# file's legitimate raw string literal blocked unrelated work with an error naming a stripper, not
# the pushed change). Now: refuse to report PASS for the OFFENDING FILE ONLY -- add it to
# `UNSCANNED_FILES` (reported as a named warning, never silently dropped) and skip its five-pattern
# scan, rather than `exit 1`-ing the whole gate. A file containing a raw literal that ALSO contains
# a real deprecated-API violation is still invisible to this specific gate either way (unchanged
# risk from before this fix) -- what changes is that ONE such file no longer blocks CI for every
# OTHER file in the tree.
UNSCANNED_FILES=""
file_has_unsupported_string_literal() {
  local f="$1"
  grep -qF '#"' "$f"
}

# WR-08 (41-REVIEW.md iteration 2): collapses a Swift declaration/call that spans MULTIPLE
# physical lines into one logical line before matching, so the five patterns below (each written
# assuming a single-line spelling) also catch:
#   * an argument list (a `func` signature's parameters, or a call's arguments) split across
#     several physical lines -- joined by tracking PAREN DEPTH: as long as more `(` than `)` have
#     been seen since the logical line started, the next physical line is appended;
#   * a trailing closure whose opening `{` is on the line AFTER the call's closing `)` -- legal
#     Swift, and what `swift-format` produces for a long argument list. Paren-depth joining alone
#     does NOT catch this (depth reaches zero the moment `)` closes, one line before the `{`), so a
#     second pass pulls a lone `{`-starting line up onto the immediately preceding line if THAT
#     line ends with `)`.
# Heuristic, not a real parser -- a stray unbalanced paren inside a string/character literal would
# defeat the depth count, but `strip_comments_and_strings` above already removed every string's
# CONTENTS before this function ever sees the line, so that specific failure mode cannot occur on
# its output. Two or more independent multi-line constructs on adjacent lines with no intervening
# balanced statement could still misjoin; not exercised by any file in this tree today.
join_continuations() {
  awk '
    {
      line = $0
      if (buffer == "") { buffer = line } else { buffer = buffer " " line }
      n = length(line)
      for (i = 1; i <= n; i++) {
        c = substr(line, i, 1)
        if (c == "(") depth++
        else if (c == ")") { if (depth > 0) depth-- }
      }
      if (depth <= 0) {
        out[++outN] = buffer
        buffer = ""
        depth = 0
      }
    }
    END {
      if (buffer != "") out[++outN] = buffer
      # Second pass: pull a lone `{`-starting logical line up onto the PRECEDING logical line if
      # that preceding line ends with `)` -- the trailing-closure-on-next-line shape.
      for (j = 1; j <= outN; j++) {
        cur = out[j]
        if (j < outN) {
          nxt = out[j + 1]
          trimmed = nxt
          sub(/^[[:space:]]+/, "", trimmed)
          if (cur ~ /\)[[:space:]]*$/ && trimmed ~ /^\{/) {
            print cur " " trimmed
            j++
            continue
          }
        }
        print cur
      }
    }
  ' "$1"
}

# WR-08: patterns (3)/(4)/(3b)/(4b) below now tolerate ONE level of nested parens inside the
# argument list (`ids.map(Self.wrap)`) via `(\([^()]*\)|[^()])*` -- "zero or more of: a fully
# balanced nested (...) group, or any non-paren character" -- rather than `[^)]*`, which stopped at
# the FIRST `)` found anywhere, including one belonging to a NESTED call, and therefore never
# reached the outer call's own closing paren at all. Extended regular expressions (used throughout
# this gate) cannot express arbitrary-depth paren balancing; two or more levels of nesting inside
# one of these five calls would still evade this gate -- an accepted, named limitation, not a
# silent one.
NESTED_PAREN_ARGS='(\([^()]*\)|[^()])*'

VIOLATIONS=""
SCRATCH=$(mktemp -d)
trap 'rm -rf "$SCRATCH"' EXIT

for f in "${SWIFT_FILES[@]}"; do
  if file_has_unsupported_string_literal "$f"; then
    UNSCANNED_FILES="${UNSCANNED_FILES}${f}"$'\n'
    continue
  fi
  STRIPPED="$SCRATCH/$(echo "$f" | tr '/' '_').stripped"
  strip_comments_and_strings "$f" > "$STRIPPED"
  JOINED="$STRIPPED.joined"
  join_continuations "$STRIPPED" > "$JOINED"

  # (1) provideCredentialWithoutUserInteraction(for: ASPasswordCredentialIdentity)
  # (2) prepareInterfaceToProvideCredential(for: ASPasswordCredentialIdentity)
  # Scanned against the JOINED file: `\([[:space:]]*for` (not `\(for`) tolerates the space
  # `join_continuations` inserts when the parameter list's opening paren and `for` land on
  # originally-separate physical lines.
  for name in provideCredentialWithoutUserInteraction prepareInterfaceToProvideCredential; do
    MATCHES=$(grep -nE "func[[:space:]]+${name}\([[:space:]]*for[[:space:]]+[A-Za-z_][A-Za-z0-9_]*:[[:space:]]*ASPasswordCredentialIdentity[[:space:]]*\)" "$JOINED" || true)
    if [ -n "$MATCHES" ]; then
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        VIOLATIONS="${VIOLATIONS}${f}:(joined ${line}) [deprecated VC override: ${name}(for: ASPasswordCredentialIdentity)]"$'\n'
      done <<< "$MATCHES"
    fi
  done

  # (3) saveCredentialIdentities(..., completion: ...) / (4) removeCredentialIdentities(...) --
  # the completion-handler form (L-33's corrected mechanism), not array element typing. Scanned
  # against the UN-joined stripped file: this shape does not depend on line continuation, only on
  # the nested-paren-aware argument match above.
  for name in save remove; do
    MATCHES=$(grep -nE "\\.${name}CredentialIdentities\\(${NESTED_PAREN_ARGS}completion:" "$STRIPPED" || true)
    if [ -n "$MATCHES" ]; then
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        VIOLATIONS="${VIOLATIONS}${f}:${line} [deprecated store write: ${name}CredentialIdentities(..., completion:) completion-handler form -- L-33]"$'\n'
      done <<< "$MATCHES"
    fi
  done

  # (5) replaceCredentialIdentities(with: ...) -- the deprecated LABEL form.
  MATCHES=$(grep -nE '\.replaceCredentialIdentities\(with:' "$STRIPPED" || true)
  if [ -n "$MATCHES" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      VIOLATIONS="${VIOLATIONS}${f}:${line} [deprecated store write: replaceCredentialIdentities(with:...) labelled form]"$'\n'
    done <<< "$MATCHES"
  fi

  # (3b)/(4b) WR-05 (41-REVIEW.md iteration 1): the TRAILING-CLOSURE spelling of the
  # completion-handler form -- `store.saveCredentialIdentities(ids) { success, error in ... }` --
  # is the NATURAL Swift way to write a completion-handler API, and patterns (3)/(4) above only
  # match a call where the literal label `completion:` appears before the closing `)`. WR-08
  # (iteration 2): scanned against the JOINED file (catches a trailing closure's `{` landing on
  # the NEXT physical line) using the nested-paren-aware argument match (catches
  # `ids.map(Self.wrap)`-shaped arguments) -- both weaknesses WR-08 itself named as still open
  # after WR-05's own fix.
  for name in save remove; do
    MATCHES=$(grep -nE "\\.${name}CredentialIdentities\\(${NESTED_PAREN_ARGS}\\)[[:space:]]*\\{" "$JOINED" || true)
    if [ -n "$MATCHES" ]; then
      while IFS= read -r line; do
        [ -z "$line" ] && continue
        VIOLATIONS="${VIOLATIONS}${f}:(joined ${line}) [deprecated store write: ${name}CredentialIdentities(...) { ... } trailing-closure completion-handler form -- L-33, WR-05, WR-08]"$'\n'
      done <<< "$MATCHES"
    fi
  done
done

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: deprecated AuthenticationServices spelling(s) found (FILL-03, L-9/L-33):" >&2
  echo "$VIOLATIONS" >&2
  exit 1
fi

UNSCANNED_COUNT=0
if [ -n "$UNSCANNED_FILES" ]; then
  UNSCANNED_COUNT=$(printf '%s' "$UNSCANNED_FILES" | grep -c . || true)
  echo "WARNING: the following file(s) contain a raw string literal (#\"...\"#) this gate's stripper cannot tokenize -- SKIPPED, not scanned, never silently reported as clean (WR-11, 41-REVIEW.md iteration 2):" >&2
  echo "$UNSCANNED_FILES" >&2
fi

SCANNED_COUNT=$((${#SWIFT_FILES[@]} - UNSCANNED_COUNT))
echo "PASS: no deprecated AuthenticationServices spelling found across ${SCANNED_COUNT} Swift file(s) under ${SCAN_DIRS[*]} (${UNSCANNED_COUNT} skipped, see WARNING above) (FILL-03, L-9/L-33)"
