#!/usr/bin/env bash
# scripts/check-qa-audit-register.sh -- Phase 42 (42-05): the structural
# coverage gate over ios/QA-AUDIT-v1.0.md. Per DR-42-B (ios/QA-AUDIT-v1.0.md),
# this gate NEVER keys on a SUMMARY heading (the five Phase 35 SUMMARY
# headings already spell the red/green section four different ways, one
# with no requirement token at all -- a heading grep produces a false FAIL,
# and loosening the pattern until it cannot fail is the exact defect family
# this phase exists to police). What IS mechanizable, and what this script
# builds, is COVERAGE and RESOLVABILITY over the register itself:
#
#   1. Coverage: every phase scripts/qa-audit-inventory.sh reports
#      IN-COVERAGE *and* having at least one SUMMARY file must have a
#      register section carrying AT LEAST ONE ROW. Section PRESENCE ALONE
#      is explicitly NOT coverage -- an empty stub (which this phase's own
#      ios/QA-AUDIT-v1.0.md deliberately carries for phases 36-41 today)
#      must not satisfy this criterion, or this gate would report PASS
#      before any real evidence was ever written. Row COUNT is what makes
#      this criterion able to fail.
#   2. The conditional asymmetry: an absent Phase 43 section is VALID (the
#      ROADMAP makes Phase 43 explicitly conditional -- ".planning/
#      ROADMAP.md" Phase 43: "Ta faza ma pelne prawo zakonczyc sie 'nie
#      zrobione' i to nie jest porazka milestone'u"). An absent or
#      row-empty section for any of 36-41 is a FAIL. Phase 43's exclusion
#      and Phase 42's exclusion are DIFFERENT things, recorded separately:
#      43 may never run at all; 42 is the phase running this very check.
#   3. Resolvability: every row's `ref` must name a file that exists and a
#      line number within that file's length.
#   4. Non-empty evidence: every row's `excerpt` must be non-empty.
#   5. The positive control: before reporting any verdict, the register
#      must have been genuinely PARSED -- rows found > 0, and the Phase 35
#      section (this project's fixed, fully-built worked example) must be
#      among the sections found. A parser matching nothing must never read
#      as a clean report (same shape as scripts/qa-audit-inventory.sh's own
#      four-guard control, and as gate_qa05's positive control in
#      scripts/check-ios-gate.sh).
#
# AUDITED RANGE, quoted from ROADMAP.md's own Phase 42 success criteria
# (the literal this script and scripts/qa-audit-inventory.sh share):
#   SC1: "Przeglad wszystkich planow faz 35-41 potwierdza, per faza z
#         konkretnym file:line dowodu: ..."
#   SC2: "Co najmniej jeden guard z kazdej fazy 35-41 dotyczacej
#         bezpieczenstwa ... ma udokumentowany dowod..."
# Two exclusions, each with its OWN one-line reason, never collapsed into
# one:
#   - Phase 42 is excluded because it is the phase RUNNING this audit; its
#     own SUMMARYs (including this very plan's 42-05-SUMMARY.md) appear on
#     disk while it is still executing, so a criterion demanding a section
#     for phase 42 could never pass.
#   - Phase 43 is excluded because it is CONDITIONAL in the ROADMAP's own
#     words and has the explicit right to end undone.
# Both exclusions are stated HERE, in this script, from plan 42-05 onward.
# 42-07 is FORBIDDEN to edit this file -- an exclusion introduced there
# would be indistinguishable from a red gate relaxed until it passed.
#
# Shell discipline (this repo's own -- L-3, scripts/check-ios-gate.sh's own
# header): no bash-only post-pipe status array (this interactive shell is
# zsh, where that spelling is silently empty); no piping into
# `tail`/`head` and reading the pipeline's exit as that command's; captures
# whose emptiness is meaningful tested explicitly, never through `|| true`.
#
# `declare -A` is NOT used anywhere in this file: this repo's
# /usr/bin/env bash resolves to macOS's stock bash 3.2 (no associative
# arrays), a landmine found writing scripts/qa-audit-inventory.sh (see that
# file's own header) and deliberately avoided here too.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

INVENTORY_SCRIPT="${QA_REGISTER_INVENTORY_SCRIPT:-scripts/qa-audit-inventory.sh}"
REGISTER_FILE="${QA_REGISTER_FILE:-ios/QA-AUDIT-v1.0.md}"

if [ ! -f "$INVENTORY_SCRIPT" ] || [ ! -r "$INVENTORY_SCRIPT" ]; then
  echo "FAIL[qa_register]: $INVENTORY_SCRIPT not found or not readable -- cannot enumerate phases" >&2
  exit 1
fi
if [ ! -f "$REGISTER_FILE" ] || [ ! -r "$REGISTER_FILE" ]; then
  echo "FAIL[qa_register]: $REGISTER_FILE not found or not readable -- nothing to check coverage against" >&2
  exit 1
fi

# --- 1. run the inventory, capture its machine-readable lines -------------
inv_output=""
inv_status=0
inv_output=$(bash "$INVENTORY_SCRIPT" 2>&1) || inv_status=$?
if [ "$inv_status" -ne 0 ]; then
  echo "FAIL[qa_register]: $INVENTORY_SCRIPT exited $inv_status -- the enumeration itself is broken; refusing to check coverage against an untrusted inventory" >&2
  echo "$inv_output" | sed 's/^/  /' >&2
  exit 1
fi

machine_lines=$(echo "$inv_output" | grep '^MACHINE|') || true
if [ -z "$machine_lines" ]; then
  echo "FAIL[qa_register]: $INVENTORY_SCRIPT produced zero MACHINE| lines -- cannot determine coverage" >&2
  exit 1
fi

# --- 2. the positive control: the register must genuinely PARSE ----------
# A markdown table DATA row inside a "## Phase NN" section, in this
# register's row schema, is a 7-column row -- 8 pipe characters, `awk -F'|'`
# NF == 9. The header row ("| claim / guard | ... |") and the separator row
# ("|---|---|...") are both 7-column shaped too, so they are excluded by
# content, not by shape: the header row's first cell reads "claim / guard"
# (trimmed) and the separator row's every cell is composed only of `-`/`:`/
# space characters.
is_header_or_separator_row() {
  local first_cell="$1" whole_row="$2"
  local trimmed
  trimmed=$(echo "$first_cell" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ "$trimmed" = "claim / guard" ]; then
    return 0
  fi
  # separator row: strip all `-`, `:`, `|`, and whitespace -- nothing must
  # remain.
  local stripped
  stripped=$(echo "$whole_row" | tr -d -- '-:| \t')
  if [ -z "$stripped" ]; then
    return 0
  fi
  return 1
}

# Extract every "## Phase NN" section's body (from that heading to the next
# "^## " heading, exclusive) into scratch files, one per phase number found
# in the register -- so per-phase row counting and per-row validation both
# read from the same extraction, and can never disagree.
GATE_SCRATCH_ROOT=$(mktemp -d)
trap 'rm -rf "$GATE_SCRATCH_ROOT"' EXIT

awk '
  /^## Phase [0-9]+/ {
    if (num != "") { close(outfile) }
    match($0, /Phase [0-9]+/)
    num = substr($0, RSTART+6, RLENGTH-6)
    outfile = "'"$GATE_SCRATCH_ROOT"'/phase-" num ".section"
    print num >> "'"$GATE_SCRATCH_ROOT"'/phase-list.txt"
    next
  }
  /^## / { if (num != "") { close(outfile); num = "" }; next }
  { if (num != "") { print > outfile } }
' "$REGISTER_FILE"

total_rows_found=0
phase35_section_found=0

# --- per-phase row counts, keyed by phase number (parallel arrays, no
#     `declare -A` -- see this file's own header) --------------------------
declare -a REGISTER_PHASE_NUMS=()
declare -a REGISTER_PHASE_ROWCOUNTS=()

if [ -f "$GATE_SCRATCH_ROOT/phase-list.txt" ]; then
  while IFS= read -r pnum; do
    [ -z "$pnum" ] && continue
    section_file="$GATE_SCRATCH_ROOT/phase-$pnum.section"
    [ -f "$section_file" ] || continue

    rowcount=0
    while IFS= read -r line; do
      case "$line" in
        '|'*)
          ;;
        *)
          continue
          ;;
      esac
      ncols=$(echo "$line" | awk -F'|' '{print NF}')
      [ "$ncols" -eq 9 ] || continue
      first_cell=$(echo "$line" | awk -F'|' '{print $2}')
      if is_header_or_separator_row "$first_cell" "$line"; then
        continue
      fi
      rowcount=$((rowcount + 1))
      total_rows_found=$((total_rows_found + 1))

      # --- 3/4. resolvability + non-empty excerpt, checked per row -------
      ref_cell=$(echo "$line" | awk -F'|' '{print $5}')
      excerpt_cell=$(echo "$line" | awk -F'|' '{print $6}')

      ref_spec=$(echo "$ref_cell" | grep -oE '`[^`]+:[0-9]+(-[0-9]+)?`' | head -1) || true
      if [ -z "$ref_spec" ]; then
        echo "FAIL[qa_register]: phase $pnum row's ref does not contain a resolvable \`file:line\` token -- row: $line" >&2
        exit 1
      fi
      ref_spec="${ref_spec#\`}"
      ref_spec="${ref_spec%\`}"
      ref_file="${ref_spec%%:*}"
      ref_lines="${ref_spec#*:}"
      ref_start="${ref_lines%%-*}"

      if [ ! -f "$ref_file" ]; then
        echo "FAIL[qa_register]: phase $pnum row's ref names a file that does not exist: $ref_file -- row: $line" >&2
        exit 1
      fi
      file_len=$(wc -l < "$ref_file" | tr -d ' ')
      if [ "$ref_start" -gt "$file_len" ]; then
        echo "FAIL[qa_register]: phase $pnum row's ref line $ref_start exceeds $ref_file's length ($file_len lines) -- row: $line" >&2
        exit 1
      fi

      trimmed_excerpt=$(echo "$excerpt_cell" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
      if [ -z "$trimmed_excerpt" ]; then
        echo "FAIL[qa_register]: phase $pnum row has an empty excerpt -- a citation with no quoted evidence is a gap, not a row -- row: $line" >&2
        exit 1
      fi
    done < "$section_file"

    REGISTER_PHASE_NUMS+=("$pnum")
    REGISTER_PHASE_ROWCOUNTS+=("$rowcount")

    if [ "$pnum" -eq 35 ]; then
      phase35_section_found=1
    fi
  done < "$GATE_SCRATCH_ROOT/phase-list.txt"
fi

if [ "$total_rows_found" -eq 0 ] || [ "$phase35_section_found" -eq 0 ]; then
  echo "FAIL[qa_register]: the register could not be parsed -- $total_rows_found row(s) found, Phase 35 section found=$phase35_section_found. Its apparent cleanliness means nothing; refusing to report a verdict on an unparsed register." >&2
  exit 1
fi
echo "OK[qa_register]: positive control holds -- $total_rows_found row(s) parsed across ${#REGISTER_PHASE_NUMS[@]} phase section(s), Phase 35's section is among them"

# --- helper: row count for a given phase number, 0 if no section ---------
rowcount_for_phase() {
  local want="$1" i
  for i in "${!REGISTER_PHASE_NUMS[@]}"; do
    if [ "${REGISTER_PHASE_NUMS[$i]}" -eq "$want" ]; then
      echo "${REGISTER_PHASE_ROWCOUNTS[$i]}"
      return 0
    fi
  done
  echo "-1"   # -1 == no section at all (distinct from 0 == empty section)
}

# --- 1/2. coverage + the conditional asymmetry ----------------------------
declare -a missing_or_empty=()
declare -a excluded_report=()

while IFS= read -r ml; do
  [ -z "$ml" ] && continue
  # MACHINE|phase_number|directory|summary_count|plan_count|coverage
  IFS='|' read -r _tag num dir summary_count plan_count coverage <<< "$ml"

  if [ "$coverage" != "IN-COVERAGE" ]; then
    if [ "$num" -eq 42 ]; then
      excluded_report+=("phase 42 -- the phase PERFORMING this audit; its own SUMMARYs appear on disk while it is still executing, so requiring a section for phase 42 would be a criterion that can never pass")
    elif [ "$num" -eq 43 ]; then
      excluded_report+=("phase 43 -- CONDITIONAL in the ROADMAP and may legitimately end undone; an absent Phase 43 section is VALID, not a gap")
    else
      excluded_report+=("phase $num -- outside the audited range 35-41 (a different milestone phase)")
    fi
    continue
  fi

  if [ "$summary_count" -eq 0 ]; then
    # IN-COVERAGE but zero SUMMARY files on disk: nothing to audit yet: not
    # a coverage requirement (mirrors the Phase-43 asymmetry logic, but for
    # an in-range phase that simply has not produced SUMMARYs). None of
    # 35-41 are in this state today; kept as an explicit branch rather than
    # an assumption.
    excluded_report+=("phase $num -- IN-COVERAGE but has zero SUMMARY files on disk; nothing to audit yet")
    continue
  fi

  rc=$(rowcount_for_phase "$num")
  if [ "$rc" -eq -1 ]; then
    missing_or_empty+=("phase $num: NO register section found (expected '## Phase $num')")
  elif [ "$rc" -eq 0 ]; then
    missing_or_empty+=("phase $num: register section found but carries ZERO rows (an empty stub is not coverage)")
  fi
done <<< "$machine_lines"

echo "Excluded from coverage (printed on every run, never silently dropped):"
for line in "${excluded_report[@]}"; do
  echo "  - $line"
done

if [ "${#missing_or_empty[@]}" -gt 0 ]; then
  echo "FAIL[qa_register]: ${#missing_or_empty[@]} IN-COVERAGE phase(s) with SUMMARY files lack a covered register section:" >&2
  for line in "${missing_or_empty[@]}"; do
    echo "  - $line" >&2
  done
  exit 1
fi

echo "PASS[qa_register]: every IN-COVERAGE phase with SUMMARY files on disk has a register section carrying at least one row; all $total_rows_found row(s) resolve to a real file:line with a non-empty excerpt"
exit 0
