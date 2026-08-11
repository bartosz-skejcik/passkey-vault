#!/usr/bin/env bash
# scripts/ios-memory-gate.sh -- Phase 36, Plan 36-03 (FILL-06 instrument
# bring-up). Reads an evidence log file (captured by
# `scripts/ios-probe-run.sh <probe-name>`) and asserts on its CONTENTS --
# never a live pipe into a status check (D-08). Every subcommand below
# fails loudly, naming the specific missing/mismatched field, when the log
# is absent, short, or shaped wrong.
#
# Usage: scripts/ios-memory-gate.sh {instrument|sensitivity|enforcement} <evidence-log>
#
# D-08 / landmine L-3 (this project's shell is zsh, where the bash-only
# post-pipeline status array is silently empty): every read below is
# `grep ... > file || true` followed by inspecting the FILE, or
# `set -o pipefail`'s own propagation through a single pipeline ending in
# the check itself -- never `cmd | tail` followed by that bash-only array.
# `grep -c` is never used as a bare gate either (it exits 1 on zero
# matches) -- every count below is compared to an explicit expected number
# via `[ "$n" -eq N ]`, never `grep -c ... && ...`.
set -euo pipefail

usage() {
  echo "Usage: $0 {instrument|sensitivity|enforcement|measure} <evidence-log>" >&2
  echo "       $0 wording" >&2
  exit 1
}

require_log() {
  local logfile="$1"
  if [ ! -f "$logfile" ]; then
    echo "FAIL: evidence log not found: $logfile" >&2
    exit 1
  fi
  if [ ! -s "$logfile" ]; then
    echo "FAIL: evidence log is empty: $logfile" >&2
    exit 1
  fi
}

# Extracts the value of `field=` from the FIRST line in `logfile` matching
# `grep_pattern`. Prints nothing (and the caller sees an empty string) if
# no line matches -- callers are responsible for treating an empty result
# as a missing field, never as a silent zero.
extract_field() {
  local logfile="$1" grep_pattern="$2" field="$3"
  local line
  line=$(grep -E "$grep_pattern" "$logfile" | head -1 || true)
  if [ -z "$line" ]; then
    return 0
  fi
  printf '%s\n' "$line" | grep -oE "${field}=[^ ]*" | head -1 | sed -E "s/^${field}=//"
}

# --- instrument: E5.a/E5.b -------------------------------------------------
# Asserts the sampler proved itself (a successful kernel return, a non-zero
# sampled peak, a sample count above zero -- so a sampler that never
# actually ran is visible as samples=0 rather than as a plausible-looking
# maximum) AND that the one-shot, never-a-gate availmem finding was logged
# exactly once.
cmd_instrument() {
  local logfile="$1"
  require_log "$logfile"

  local sampler_line
  sampler_line=$(grep -E 'PVPROBE\|stage=sampler' "$logfile" | head -1 || true)
  if [ -z "$sampler_line" ]; then
    echo "FAIL: no PVPROBE|stage=sampler line found in $logfile" >&2
    exit 1
  fi

  local kr samples peak
  kr=$(extract_field "$logfile" 'PVPROBE\|stage=sampler' 'kr')
  samples=$(extract_field "$logfile" 'PVPROBE\|stage=sampler' 'samples')
  peak=$(extract_field "$logfile" 'PVPROBE\|stage=sampler' 'peak_sampled')

  if [ "$kr" != "KERN_SUCCESS" ]; then
    echo "FAIL: stage=sampler kr='$kr' (expected KERN_SUCCESS) in $logfile" >&2
    exit 1
  fi
  if [ -z "$samples" ] || [ "$samples" -le 0 ] 2>/dev/null; then
    echo "FAIL: stage=sampler samples='$samples' (expected > 0) in $logfile -- the sampler thread never actually ran" >&2
    exit 1
  fi
  if [ -z "$peak" ] || [ "$peak" -le 0 ] 2>/dev/null; then
    echo "FAIL: stage=sampler peak_sampled='$peak' (expected > 0) in $logfile" >&2
    exit 1
  fi

  local availmem_count
  availmem_count=$(grep -cE 'PVPROBE\|stage=availmem' "$logfile" || true)
  if [ "$availmem_count" -ne 1 ]; then
    echo "FAIL: expected exactly 1 PVPROBE|stage=availmem line in $logfile, found $availmem_count" >&2
    exit 1
  fi
  local available
  available=$(extract_field "$logfile" 'PVPROBE\|stage=availmem' 'available_bytes')
  if [ -z "$available" ]; then
    echo "FAIL: stage=availmem line found but no available_bytes field in $logfile" >&2
    exit 1
  fi

  echo "PASS: instrument -- kr=$kr samples=$samples peak_sampled=$peak available_bytes=$available (finding only, never a gate)"
  exit 0
}

# --- sensitivity: E5.c, the mandatory control ------------------------------
# The two sampled peaks (8 MiB then 256 MiB) must differ by ~248 MiB
# (+-10%). This is the control the whole phase depends on: a measurement
# that cannot move reads green regardless of the truth (Pitfall 4).
EXPECTED_DELTA_BYTES=$((248 * 1024 * 1024))
TOLERANCE_PCT=10

cmd_sensitivity() {
  local logfile="$1"
  require_log "$logfile"

  local kdf_line_count
  kdf_line_count=$(grep -cE 'PVPROBE\|stage=kdf' "$logfile" || true)
  if [ "$kdf_line_count" -ne 2 ]; then
    echo "FAIL: expected exactly 2 PVPROBE|stage=kdf lines in $logfile, found $kdf_line_count" >&2
    exit 1
  fi

  local peak_8mib peak_256mib
  peak_8mib=$(extract_field "$logfile" 'PVPROBE\|stage=kdf label=8mib' 'peak_sampled')
  peak_256mib=$(extract_field "$logfile" 'PVPROBE\|stage=kdf label=256mib' 'peak_sampled')

  if [ -z "$peak_8mib" ]; then
    echo "FAIL: no PVPROBE|stage=kdf label=8mib line with a peak_sampled field found in $logfile" >&2
    exit 1
  fi
  if [ -z "$peak_256mib" ]; then
    echo "FAIL: no PVPROBE|stage=kdf label=256mib line with a peak_sampled field found in $logfile" >&2
    exit 1
  fi

  local delta
  if [ "$peak_256mib" -ge "$peak_8mib" ]; then
    delta=$((peak_256mib - peak_8mib))
  else
    delta=$((peak_8mib - peak_256mib))
  fi

  local tolerance_bytes low high
  tolerance_bytes=$((EXPECTED_DELTA_BYTES * TOLERANCE_PCT / 100))
  low=$((EXPECTED_DELTA_BYTES - tolerance_bytes))
  high=$((EXPECTED_DELTA_BYTES + tolerance_bytes))

  echo "peak_sampled(8mib)=$peak_8mib peak_sampled(256mib)=$peak_256mib delta=$delta accepted_range=[$low,$high] (target ${EXPECTED_DELTA_BYTES} +-${TOLERANCE_PCT}%)"

  if [ "$delta" -lt "$low" ] || [ "$delta" -gt "$high" ]; then
    echo "FAIL: sensitivity control -- delta=$delta bytes is outside the accepted range [$low,$high]. The instrument is not measuring the allocation; no number from this run may be recorded (D-11, Pitfall 4)." >&2
    exit 1
  fi

  echo "PASS: sensitivity -- the reported peak moved by ${delta} bytes, within +-${TOLERANCE_PCT}% of the predicted ${EXPECTED_DELTA_BYTES} byte (248 MiB) delta"
  exit 0
}

# --- enforcement: E5.d ------------------------------------------------------
# Classifies the run into exactly one of two recorded outcomes; a shape
# matching neither is NOT a result and exits non-zero (the gate classifies,
# it does not judge -- both recorded outcomes are exit-0).
ENFORCE_DELTA_BYTES=$((200 * 1024 * 1024))
ENFORCE_TOLERANCE_PCT=30

cmd_enforcement() {
  local logfile="$1"
  require_log "$logfile"

  local ordinals
  ordinals=$( (grep -oE 'PVPROBE\|stage=enforce ordinal=[0-9]+' "$logfile" \
    | grep -oE 'ordinal=[0-9]+' | sed -E 's/ordinal=//' | tr '\n' ',') || true)

  case "$ordinals" in
    "1,2,3,")
      local phys1 phys2
      phys1=$(grep -E 'PVPROBE\|stage=enforce ordinal=1 ' "$logfile" | head -1 | grep -oE 'phys=[0-9]+' | sed -E 's/phys=//')
      phys2=$(grep -E 'PVPROBE\|stage=enforce ordinal=2 ' "$logfile" | head -1 | grep -oE 'phys=[0-9]+' | sed -E 's/phys=//')
      if [ -z "$phys1" ] || [ -z "$phys2" ]; then
        echo "FAIL: ordinals 1,2,3 present but phys= field missing on ordinal 1 or 2 in $logfile -- unclassifiable" >&2
        exit 1
      fi
      local rise low high
      rise=$((phys2 - phys1))
      low=$((ENFORCE_DELTA_BYTES * (100 - ENFORCE_TOLERANCE_PCT) / 100))
      high=$((ENFORCE_DELTA_BYTES * (100 + ENFORCE_TOLERANCE_PCT) / 100))
      if [ "$rise" -ge "$low" ] && [ "$rise" -le "$high" ]; then
        echo "CLASSIFICATION: survived -- all 3 ordinals present, footprint rose by $rise bytes between ordinal 1 ($phys1) and ordinal 2 ($phys2), within [$low,$high] of the ~200 MB allocation. This confirms, empirically, that this simulator does not enforce a memory kill on the extension process (E5.d)."
        exit 0
      else
        echo "FAIL: all 3 ordinals present but the footprint rise ($rise bytes, from $phys1 to $phys2) does not match the ~200 MB allocation shape (expected [$low,$high]) -- unclassifiable, not a result" >&2
        exit 1
      fi
      ;;
    ""|"1,"|"1,2,")
      # A strict prefix of "1,2,3," (zero, one, or two ordinals logged
      # before the sequence stopped) -- the process died mid-run. Recorded
      # as a finding, never smoothed over: this OVERTURNS both research
      # probes' no-jetsam-on-simulator conclusion (Open Question 7).
      echo "CLASSIFICATION: process died -- sequence truncated (ordinals observed: '${ordinals:-<none>}'), the process did not survive to log all 3 ordinals. This overturns both research probes' no-jetsam-on-simulator conclusion."
      exit 0
      ;;
    *)
      echo "FAIL: PVPROBE|stage=enforce ordinal sequence '$ordinals' in $logfile matches neither recorded outcome (all-3-present-with-matching-rise, or a clean truncation to '', '1,', or '1,2,') -- an unclassifiable run is not a result" >&2
      exit 1
      ;;
  esac
}

# --- measure: E6, the FILL-06 measurement itself --------------------------
# Reads an evidence log (ios/evidence/36/kdf-inprocess.log or
# kdf-coldstart.log), extracts every PVPROBE|stage=kdf run's metrics,
# computes D = peak_sampled - baseline (the KDF's own cost) and
# R-B = residual - baseline (the allocator residual) PER RUN, and
# classifies the whole SERIES against the thresholds declared in
# 36-RESEARCH.md SS"E6" (defined here, before any run is read):
#   FAIL      -- any run's peak_sampled > 110 MiB, or any run's R-B > 8 MiB
#   MARGINAL  -- (treated as FAIL for design purposes) 90 MiB < peak <= 110 MiB
#   PASS      -- every run's peak_sampled <= 90 MiB and R-B <= 8 MiB
# plus an INDEPENDENT tripwire, checked regardless of band: any run's
# D >= 32 MiB (three shipping competitors' documented guidance,
# 36-RESEARCH.md "Competitor precedent").
#
# Exits non-zero ONLY when the log is unparseable or a run is missing a
# required field -- a FAILING measurement is a real result, and this gate
# reports it (both to stdout and in its own exit code, which stays 0) rather
# than hiding it behind a non-zero exit (36-04-PLAN.md Task 1 action text).
FAIL_THRESHOLD_BYTES=$((110 * 1024 * 1024))
MARGINAL_THRESHOLD_BYTES=$((90 * 1024 * 1024))
RESIDUAL_THRESHOLD_BYTES=$((8 * 1024 * 1024))
TRIPWIRE_D_BYTES=$((32 * 1024 * 1024))

cmd_measure() {
  local logfile="$1"
  require_log "$logfile"

  local run_count
  run_count=$(grep -cE 'PVPROBE\|stage=kdf' "$logfile" || true)
  if [ "$run_count" -eq 0 ]; then
    echo "FAIL: no PVPROBE|stage=kdf lines found in $logfile -- unparseable" >&2
    exit 1
  fi

  echo "measure: $logfile -- $run_count run(s)"
  echo "thresholds (bytes): FAIL peak>$FAIL_THRESHOLD_BYTES(110MiB) | MARGINAL ${MARGINAL_THRESHOLD_BYTES}(90MiB)<peak<=$FAIL_THRESHOLD_BYTES(110MiB) | PASS peak<=$MARGINAL_THRESHOLD_BYTES(90MiB) and R-B<=$RESIDUAL_THRESHOLD_BYTES(8MiB) | tripwire D>=$TRIPWIRE_D_BYTES(32MiB)"

  local worst_band="PASS"
  local tripwire_fired="no"
  local n=0
  local seq_keys=""
  while IFS= read -r line; do
    n=$((n + 1))
    local run label standin baseline peak residual samples ledger inv
    run=$(printf '%s\n' "$line" | grep -oE 'run=[0-9]+' | head -1 | sed -E 's/run=//')
    label=$(printf '%s\n' "$line" | grep -oE 'label=[^ ]*' | head -1 | sed -E 's/label=//')
    standin=$(printf '%s\n' "$line" | grep -oE 'standin=[^ ]*' | head -1 | sed -E 's/standin=//')
    baseline=$(printf '%s\n' "$line" | grep -oE 'baseline=[0-9]+' | head -1 | sed -E 's/baseline=//')
    peak=$(printf '%s\n' "$line" | grep -oE 'peak_sampled=[0-9]+' | head -1 | sed -E 's/peak_sampled=//')
    residual=$(printf '%s\n' "$line" | grep -oE 'residual=[0-9]+' | head -1 | sed -E 's/residual=//')
    samples=$(printf '%s\n' "$line" | grep -oE 'samples=[0-9]+' | head -1 | sed -E 's/samples=//')
    ledger=$(printf '%s\n' "$line" | grep -oE 'ledger_peak=-?[0-9]+' | head -1 | sed -E 's/ledger_peak=//')
    # `|| true`: the single-invocation log has no `inv=` field at all, so
    # this grep legitimately finds nothing on every line there -- under
    # `set -o pipefail` an unmatched grep's exit 1 would otherwise abort
    # the whole script (`set -e`), even though "no inv field" is a normal,
    # expected shape here, not a parse error.
    inv=$( (printf '%s\n' "$line" | grep -oE 'inv=[0-9]+' | head -1 | sed -E 's/inv=//') || true)

    if [ -z "$run" ] || [ -z "$baseline" ] || [ -z "$peak" ] || [ -z "$residual" ]; then
      echo "FAIL: run entry #$n in $logfile is missing a required field (run/baseline/peak_sampled/residual) -- unparseable" >&2
      exit 1
    fi

    # Sequence key for the gap/duplicate check below: the assembled
    # coldstart log's five lines all carry run=1 (each is invocation N's
    # OWN first ordinal) and are distinguished by `inv=`, so `inv` is the
    # key when present; the single-invocation log has no `inv` field at
    # all, so `run` (1..5) is the key there. This is what catches a
    # DELETED line as a genuine gap rather than as a self-consistently
    # smaller count (the defect this project calls "a check that cannot
    # fail" -- L-9 shape, ios/IOS-SPIKE-LOG.md SS3): removing one run's
    # line changes $run_count too, so a bare count comparison against
    # itself can never disagree with itself.
    if [ -n "$inv" ]; then
      seq_keys="$seq_keys $inv"
    else
      seq_keys="$seq_keys $run"
    fi

    local d rb band tripwire
    d=$((peak - baseline))
    rb=$((residual - baseline))
    if [ "$peak" -gt "$FAIL_THRESHOLD_BYTES" ] || [ "$rb" -gt "$RESIDUAL_THRESHOLD_BYTES" ]; then
      band="FAIL"
    elif [ "$peak" -gt "$MARGINAL_THRESHOLD_BYTES" ]; then
      band="MARGINAL"
    else
      band="PASS"
    fi
    tripwire="no"
    if [ "$d" -ge "$TRIPWIRE_D_BYTES" ]; then
      tripwire="YES"
      tripwire_fired="yes"
    fi
    if [ "$band" != "PASS" ] && [ "$worst_band" = "PASS" ]; then
      worst_band="$band"
    elif [ "$band" = "FAIL" ]; then
      worst_band="FAIL"
    fi

    echo "run=$run label=${label:-<none>} standin=${standin:-false} baseline=$baseline peak_sampled=$peak D=$d residual=$residual R-B=$rb ledger_peak=${ledger:-<none>} samples=${samples:-<none>} band=$band tripwire=$tripwire"
  done < <(grep -E 'PVPROBE\|stage=kdf' "$logfile")

  if [ "$n" -ne "$run_count" ]; then
    echo "FAIL: expected $run_count run(s) in $logfile, parsed $n -- unparseable" >&2
    exit 1
  fi

  # Gap/duplicate check: the sequence keys collected above must be EXACTLY
  # the permutation 1..N, N=$n -- a deleted line changes $n right along with
  # itself, so the count check above alone can never catch a missing run
  # (it would just be comparing $n against a $run_count derived from the
  # SAME mutated file). This is the check that actually can fail.
  local expected got
  expected=$(seq 1 "$n" | tr '\n' ',')
  got=$(printf '%s\n' $seq_keys | sort -n | tr '\n' ',')
  if [ "$got" != "$expected" ]; then
    echo "FAIL: run/invocation sequence in $logfile is '$got', expected the complete permutation '$expected' for $n parsed line(s) -- a run is missing or duplicated, unparseable" >&2
    exit 1
  fi

  echo "SERIES CLASSIFICATION: $worst_band -- competitor tripwire fired: $tripwire_fired"
  exit 0
}

# --- wording: reuses the same forbidden-phrasing deny list -----------------
# Thin delegator to scripts/ios-autofill-layers.sh wording-gate (36-04-PLAN.md
# Task 3 action text: "extend ... OR add a wording subcommand ... that reuses
# the same deny list", so the deny list is never duplicated in two places).
cmd_wording() {
  exec "$(dirname "${BASH_SOURCE[0]}")/ios-autofill-layers.sh" wording-gate
}

case "${1:-}" in
  instrument) shift; [ -n "${1:-}" ] || usage; cmd_instrument "$1" ;;
  sensitivity) shift; [ -n "${1:-}" ] || usage; cmd_sensitivity "$1" ;;
  enforcement) shift; [ -n "${1:-}" ] || usage; cmd_enforcement "$1" ;;
  measure) shift; [ -n "${1:-}" ] || usage; cmd_measure "$1" ;;
  wording) shift; cmd_wording ;;
  *) usage ;;
esac
