#!/usr/bin/env bash
# scripts/qa-audit-inventory.sh -- Phase 42 (42-05): dynamic phase/SUMMARY/PLAN
# enumeration for the retrospective QA-01/QA-02/QA-03 audit that
# ios/QA-AUDIT-v1.0.md and scripts/check-qa-audit-register.sh build on top of.
#
# THE ORDERING PROBLEM THIS SCRIPT IS BUILT AGAINST (42-RESEARCH.md, "The
# ordering problem this phase cannot ignore"): Phase 42 is numbered LAST and
# audits phases 35-41. When this phase was researched, 39/40/41 did not even
# have a phase directory yet. Any phase list, guard list, or finding list
# written at plan-authoring time is therefore wrong by construction. So:
# everything below is derived from `.planning/phases/` AT RUN TIME, via a
# glob -- never from a literal list of phase directories, guard names, or
# findings.
#
# THE ONE PERMITTED LITERAL: the coverage bound 35-41. This is a NUMERIC
# comparison applied to the phase number PARSED from whatever directory the
# glob finds -- never a directory-path literal like `.planning/phases/36-`.
# The bound is taken verbatim from ROADMAP.md's own Phase 42 success
# criteria:
#   SC1: "Przeglad wszystkich planow faz 35-41 potwierdza, per faza z
#         konkretnym file:line dowodu: ..."
#   SC2: "Co najmniej jeden guard z kazdej fazy 35-41 dotyczacej
#         bezpieczenstwa ... ma udokumentowany dowod..."
# (.planning/ROADMAP.md, "### Phase 42: Standard dowodu -- bramka QA i CI dla
# iOS", Success Criteria 1 and 2.)
#
# Phases explicitly OUTSIDE the 35-41 bound, and why (printed on every run,
# never silently dropped):
#   - 42 is the phase PERFORMING this audit. Its own SUMMARYs materialise on
#     disk while it is still executing, so a coverage gate demanding a
#     section for them could never pass -- it would be auditing its own
#     in-flight work.
#   - 43 is explicitly CONDITIONAL in the ROADMAP's own words ("Ta faza ma
#     pelne prawo zakonczyc sie 'nie zrobione' i to nie jest porazka
#     milestone'u") -- an absent Phase 43 is a VALID state, not a gap.
#   - anything below 35 belongs to a DIFFERENT milestone worked in a
#     different worktree session on `main` (this worktree's own session
#     mandate: never read or reference .planning/phases/29-*/30-*). This
#     script never opens the CONTENT of any such directory -- classification
#     is derived from the directory name alone.
#
# THE CONTROL (mirrors scripts/audit-ffi-opaque-handles.sh's own
# EXPECTED_CLASSES self-check idiom): Phase 35 is a fixed, fully-built,
# already-verified phase (9/9 truths, 35-VERIFICATION.md), so its four known
# guards are a KNOWN GROUND TRUTH this script's own discovery mechanism is
# tested against -- this is NOT the "guard list for an unplanned phase"
# hardcoding the prohibitions above forbid; it is a self-test, same shape as
# EXPECTED_CLASSES. If fewer than four are found, this script exits 1: a
# silently non-matching glob must never read as a clean report over zero
# phases.
#
# Shell discipline (this repo's own, ios/IOS-SPIKE-LOG.md L-3 and
# scripts/check-ios-gate.sh's own header): no bash-only post-pipe status
# array (this interactive shell is zsh, where that spelling is silently
# empty); no piping a command into `tail`/`head` and reading the pipeline's
# exit as that command's; `find ... -print -quit` rather than piping `find`
# into `head -1`; captures whose emptiness is meaningful are tested
# explicitly, never through `|| true`.
set -euo pipefail
shopt -s nullglob

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --- the one permitted literal: the coverage bound, from ROADMAP.md -------
COVERAGE_LOW=35
COVERAGE_HIGH=41

PHASES_ROOT=".planning/phases"

# --- discovery: enumerate directories from disk, at run time --------------
declare -a PHASE_NUMS=()
declare -a PHASE_DIRS=()

if [ -d "$PHASES_ROOT" ]; then
  for d in "$PHASES_ROOT"/*/; do
    base=$(basename "$d")
    if [[ "$base" =~ ^([0-9]+)- ]]; then
      PHASE_NUMS+=("${BASH_REMATCH[1]}")
      PHASE_DIRS+=("$d")
    fi
    # A directory whose name does not start with digits-dash is not a phase
    # directory at all (there are none today) -- silently excluded from the
    # phase table, never counted as a phase and never counted as an error;
    # this glob only ever enumerates `NN-*` directories by construction.
  done
fi

if [ "${#PHASE_DIRS[@]}" -eq 0 ]; then
  echo "ERROR: no NN-* directories found under $PHASES_ROOT -- enumeration produced zero phases; nothing downstream can be trusted" >&2
  exit 1
fi

# --- classification helper -------------------------------------------------
# Numeric comparison only -- never a directory-path literal. Prints the
# classification AND, for every OUT-OF-COVERAGE phase, the reason -- so the
# exclusion is a visible part of every run's output, never an invisible
# narrowing of what this script (or the coverage gate built on top of it)
# examines.
classify_phase() {
  local num="$1"
  if [ "$num" -ge "$COVERAGE_LOW" ] && [ "$num" -le "$COVERAGE_HIGH" ]; then
    echo "IN-COVERAGE|"
    return 0
  fi
  if [ "$num" -eq 42 ]; then
    echo "OUT-OF-COVERAGE|phase 42 is the phase PERFORMING this audit; its own SUMMARYs are on disk while it is still executing, so a coverage gate demanding a section for them could never pass"
    return 0
  fi
  if [ "$num" -eq 43 ]; then
    echo "OUT-OF-COVERAGE|phase 43 is explicitly CONDITIONAL in the ROADMAP's own words and has the right to end undone; an absent Phase 43 is a VALID state, not a gap"
    return 0
  fi
  echo "OUT-OF-COVERAGE|phase $num is outside the audited range $COVERAGE_LOW-$COVERAGE_HIGH named by ROADMAP.md's own Phase 42 success criteria (a different milestone phase; its content is never read by this script)"
}

# --- per-phase enumeration --------------------------------------------------
# Machine-readable and human-readable output are built together, in one
# pass, so they can never disagree about which phases exist or how they were
# counted.
declare -a MACHINE_LINES=()
declare -a UNSUMMARIZED_LINES=()
declare -a CANDIDATE_LINES=()
declare -a HUMAN_LINES=()

# Verification-reference candidate patterns (crude, deliberately so -- see
# the header comment on qa_audit_candidates below): a plain unit-test runner
# invocation, textually near one of the crypto/bytes/time/server keywords.
# This produces a CANDIDATE LIST for a human reader (42-06/42-07) to judge;
# it renders no verdict of its own. QA-01 is a semantic property -- "does
# this claim rest on a mock?" -- and no pattern match decides that.
CMD_PATTERN='cargo[[:space:]]+test|xcodebuild[[:space:]]+test|vitest'
CLAIM_KEYWORD_PATTERN='crypto|kryptogr|bajt|byte|klucz|key|szyfr|encrypt|decrypt|plaintext|ciphertext|czas|time|server|serwer|network|siec|http'

qa_audit_candidates() {
  local num="$1" dir="$2"
  local f
  for f in "$dir"*-SUMMARY.md; do
    [ -f "$f" ] || continue
    local hits hits_status
    hits=$(grep -noE "$CMD_PATTERN" "$f" 2>/dev/null) && hits_status=0 || hits_status=$?
    if [ "$hits_status" -gt 1 ]; then
      echo "ERROR: grep on $f exited $hits_status (not 0/1) while scanning for candidate commands" >&2
      exit 1
    fi
    [ -z "$hits" ] && continue
    local line
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      local lineno="${line%%:*}"
      local hitline="${line#*:}"
      local window_start=$(( lineno > 3 ? lineno - 3 : 1 ))
      local window
      window=$(sed -n "${window_start},$(( lineno + 3 ))p" "$f")
      if echo "$window" | grep -qiE "$CLAIM_KEYWORD_PATTERN"; then
        CANDIDATE_LINES+=("CANDIDATE|$num|$f|$lineno|$(echo "$hitline" | tr '|' '¦')")
      fi
    done <<< "$hits"
  done
}

for i in "${!PHASE_DIRS[@]}"; do
  dir="${PHASE_DIRS[$i]}"
  num="${PHASE_NUMS[$i]}"
  base=$(basename "$dir")

  summary_count=0
  for f in "$dir"*-SUMMARY.md; do
    [ -f "$f" ] && summary_count=$((summary_count + 1))
  done

  plan_count=0
  declare -a plan_files=()
  for f in "$dir"*-PLAN.md; do
    [ -f "$f" ] || continue
    plan_count=$((plan_count + 1))
    plan_files+=("$f")
  done

  # UNSUMMARIZED: filename presence only (no content read) -- the hook that
  # closes the ROADMAP-SC1 scoping hole (SC1 asks for a review of *plans*; a
  # claim made only in a plan and never carried into a SUMMARY would
  # otherwise be invisible to a SUMMARY-first audit).
  for pf in "${plan_files[@]}"; do
    prefix="${pf%-PLAN.md}"
    expected_summary="${prefix}-SUMMARY.md"
    if [ ! -f "$expected_summary" ]; then
      UNSUMMARIZED_LINES+=("UNSUMMARIZED|$num|$dir|$pf")
    fi
  done

  classification=$(classify_phase "$num")
  coverage="${classification%%|*}"
  reason="${classification#*|}"

  MACHINE_LINES+=("MACHINE|$num|$dir|$summary_count|$plan_count|$coverage")

  if [ "$coverage" = "IN-COVERAGE" ]; then
    reason_suffix=""
  else
    reason_suffix=" -- $reason"
  fi
  HUMAN_LINES+=("$(printf '%-4s %-70s summaries=%-3s plans=%-3s %s%s' "$num" "$base" "$summary_count" "$plan_count" "$coverage" "$reason_suffix")")

  # Content is only ever read (verification-reference candidate scan) for
  # IN-COVERAGE phases -- "Nothing outside 35-41 is ever read by this script"
  # (this file's own header).
  if [ "$coverage" = "IN-COVERAGE" ]; then
    qa_audit_candidates "$num" "$dir"
  fi
done

echo "=== qa-audit-inventory: human-readable ==="
echo "coverage bound (ROADMAP.md Phase 42 SC1/SC2, literal $COVERAGE_LOW-$COVERAGE_HIGH):"
printf '%-4s %-70s %-14s %-11s %s\n' "num" "directory" "summaries" "plans" "coverage"
for line in "${HUMAN_LINES[@]}"; do
  echo "$line"
done

echo
echo "=== qa-audit-inventory: unsummarized plans (*-PLAN.md with no matching *-SUMMARY.md) ==="
if [ "${#UNSUMMARIZED_LINES[@]}" -eq 0 ]; then
  echo "(none found)"
else
  for line in "${UNSUMMARIZED_LINES[@]}"; do
    echo "$line"
  done
fi

echo
echo "=== qa-audit-inventory: QA-01 candidate list (plain-unit-test-runner references textually near a crypto/bytes/time/server keyword -- a CANDIDATE list for a human reader to judge, not a verdict) ==="
if [ "${#CANDIDATE_LINES[@]}" -eq 0 ]; then
  echo "(none found)"
else
  for line in "${CANDIDATE_LINES[@]}"; do
    echo "$line"
  done
fi

echo
echo "=== qa-audit-inventory: machine-readable (MACHINE|phase_number|directory|summary_count|plan_count|coverage) ==="
for line in "${MACHINE_LINES[@]}"; do
  echo "$line"
done

# --- the control: Phase 35's four known guards must be discoverable -------
# Phase 35 is located dynamically (via the same PHASE_NUMS/PHASE_DIRS this
# script already built), never via a hardcoded `.planning/phases/35-...`
# path literal outside this section.
echo
echo "=== qa-audit-inventory: control (Phase 35's four known guards) ==="

phase35_dir=""
for i in "${!PHASE_NUMS[@]}"; do
  if [ "${PHASE_NUMS[$i]}" -eq 35 ]; then
    phase35_dir="${PHASE_DIRS[$i]}"
    break
  fi
done

if [ -z "$phase35_dir" ]; then
  echo "CONTROL-FAIL: no phase directory numbered 35 was discovered by the glob above -- the enumeration is broken and no downstream 'no issues found in phase N' conclusion can be trusted" >&2
  exit 1
fi

# Parallel indexed arrays, NOT `declare -A`: this repo's /usr/bin/env bash
# resolves to macOS's stock bash 3.2 (Apple ships no newer bash --
# associative arrays are a bash-4+ feature), where `declare -A` with a
# space-or-paren-bearing key silently mis-parses and throws "unbound
# variable" on an unrelated word from inside the key string -- verified
# empirically writing this script. None of this repo's other gate scripts
# (check-ios-gate.sh, audit-ffi-opaque-handles.sh, build-ios.sh) use
# `declare -A` either; this is why.
#
# Each guard is FOUND only if BOTH hold: (a) Phase 35's own SUMMARY files
# actually MENTION it (the claim this control checks is grounded in that
# phase's own transcripts, not invented here), AND (b) the artifact still
# EXISTS ON DISK at its known path. (b) is what makes this control
# falsifiable by renaming a real guard script aside -- (a) alone would not
# move, since Phase 35's SUMMARY text never changes.
GUARD_NAMES=(
  "slice gate (scripts/build-ios.sh)"
  "opaque-handle audit (scripts/audit-ffi-opaque-handles.sh)"
  "byte-shape gate (FfiRoundTripTests.swift)"
  "panic-catch proof (FfiPanicSafetyTests.swift)"
)
GUARD_REGEXES=(
  'build-ios\.sh'
  'audit-ffi-opaque-handles\.sh'
  'FfiRoundTripTests'
  'FfiPanicSafetyTests'
)
GUARD_PATHS=(
  "scripts/build-ios.sh"
  "scripts/audit-ffi-opaque-handles.sh"
  "ios/PasskeyVault/PasskeyVaultTests/FfiRoundTripTests.swift"
  "ios/PasskeyVault/PasskeyVaultTests/FfiPanicSafetyTests.swift"
)

found_count=0
declare -a found_guards=()
declare -a missing_guards=()
for gi in "${!GUARD_NAMES[@]}"; do
  guard_name="${GUARD_NAMES[$gi]}"
  pattern="${GUARD_REGEXES[$gi]}"
  guard_path="${GUARD_PATHS[$gi]}"
  mentioned=0
  for f in "$phase35_dir"*-SUMMARY.md; do
    [ -f "$f" ] || continue
    if grep -qE "$pattern" "$f"; then
      mentioned=1
      break
    fi
  done
  if [ "$mentioned" -eq 1 ] && [ -f "$guard_path" ]; then
    found_count=$((found_count + 1))
    found_guards+=("$guard_name")
  elif [ "$mentioned" -eq 1 ]; then
    missing_guards+=("$guard_name (mentioned in Phase 35's SUMMARYs, but NOT FOUND on disk at $guard_path)")
  else
    missing_guards+=("$guard_name (not mentioned in any Phase 35 SUMMARY)")
  fi
done

echo "found: ${found_count}/4"
for g in "${found_guards[@]:-}"; do
  [ -n "$g" ] && echo "  FOUND: $g"
done
for g in "${missing_guards[@]:-}"; do
  [ -n "$g" ] && echo "  MISSING: $g"
done

if [ "$found_count" -lt 4 ]; then
  echo "CONTROL-FAIL: only $found_count/4 of Phase 35's known guards were found in $phase35_dir's SUMMARY files -- the enumeration is broken, and no downstream 'no issues found in phase N' conclusion can be trusted (missing: ${missing_guards[*]:-none})" >&2
  exit 1
fi

echo "CONTROL-PASS: all 4/4 of Phase 35's known guards found in $phase35_dir's SUMMARY files -- the discovery mechanism is trustworthy"
exit 0
