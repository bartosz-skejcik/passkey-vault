#!/usr/bin/env bash
# scripts/ios-vmmap-crosscheck.sh -- Phase 36, Plan 36-04, Task 2 (E7).
#
# An INDEPENDENT, out-of-process reading of the same running extension
# process's peak physical footprint, taken by `vmmap` -- a completely
# different instrument than Task 1's in-process task_info(TASK_VM_INFO)
# sampler -- so the phase's headline FILL-06 number has a second witness
# (36-RESEARCH.md SS"E7", SS"The out-of-process alternative").
#
# Usage: scripts/ios-vmmap-crosscheck.sh <in-process-evidence-log>
#   <in-process-evidence-log> is Task 1's ios/evidence/36/kdf-inprocess.log
#   (or any log carrying PVPROBE|stage=kdf lines) -- this script reads the
#   MAXIMUM peak_sampled value across every run in that file as the
#   in-process reference it compares its own live reading against.
#
# A RECORDED DEVIATION, found running this task, not assumed: 36-RESEARCH.md's
# own E7 pseudocode calls `xcrun simctl spawn <udid> vmmap --summary <pid>`.
# On this toolchain that fails outright (exit 255, "vmmap cannot examine
# process ... for unknown reasons, even though it appears to exist; try
# running with sudo"): `simctl spawn` resolves the bare command "vmmap"
# against the GUEST runtime's own copy
# (RuntimeRoot/usr/bin/vmmap), which carries NO entitlements at all
# (`codesign -d --entitlements :-` on it returns an empty plist) -- unlike
# the HOST's own /usr/bin/vmmap, which carries
# `com.apple.system-task-ports.read`/`.read.safe`. Apple Silicon runs
# simulator processes as ordinary HOST processes -- confirmed: the PID
# `launchctl list` reports inside the guest is a real host PID, resolvable
# directly via `ps -p <pid>` on the host with no `simctl spawn` involved.
# The fix: invoke the HOST's own `/usr/bin/vmmap` DIRECTLY against that
# PID, never through `simctl spawn vmmap`. `DevToolsSecurity -status`
# reporting "Developer mode is currently enabled" is what makes this work
# without an interactive authorization prompt on this machine.
#
# D-08 / landmine L-3 (this project's shell is zsh, where the bash-only
# post-pipeline status array is silently empty): every read below is
# `cmd > file 2>&1` followed by inspecting the FILE, never `cmd | tail`
# followed by that array. No `timeout` command either -- it does not exist
# on this machine (Pitfall 6) -- every potentially-slow call below runs to
# completion or fails on its own, never wrapped in a nonexistent `timeout`.
set -euo pipefail

usage() {
  echo "Usage: $0 <in-process-evidence-log>" >&2
  exit 1
}

IN_PROCESS_LOG="${1:-}"
[ -n "$IN_PROCESS_LOG" ] || usage
if [ ! -f "$IN_PROCESS_LOG" ]; then
  echo "ERROR: in-process evidence log not found: $IN_PROCESS_LOG" >&2
  exit 1
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

EVIDENCE_DIR="ios/evidence/36"
mkdir -p "$EVIDENCE_DIR"
OUT="$EVIDENCE_DIR/vmmap-crosscheck.txt"

# Pre-declared tolerance, printed alongside the two numbers so the
# classification is auditable from its own output and is never widened
# after seeing the figures (36-04-PLAN.md Task 2 action text).
TOLERANCE_BYTES=8388608 # 8 MiB, 8*1024*1024

# --- Resolve the extension's PID and capture it, FIRST, before anything else
# -----------------------------------------------------------------------------
# A SECOND RECORDED DEVIATION, found running this task, not assumed:
# 36-RESEARCH.md's own E7 pseudocode resolves the PID via
# `xcrun simctl spawn <udid> launchctl list | grep -i PasskeyVaultAutoFill`.
# That grep can NEVER match: the extension's actual bundle id is
# `cloud.blonie.PasskeyVault.AutoFill` -- WITH A DOT between "PasskeyVault"
# and "AutoFill" -- so the contiguous literal "PasskeyVaultAutoFill" (no
# dot) is not a substring of the label `launchctl list` actually prints,
# and every match attempt against it returns empty (proven by direct
# repeated observation this session: `pgrep -f` against the real compiled
# executable path DID catch the process alive at the same moment
# `launchctl list | grep -i PasskeyVaultAutoFill` found nothing). Fixed by
# matching the compiled executable's own path directly via `pgrep -f`
# against the HOST process table -- Apple Silicon runs simulator processes
# as ordinary host processes (same reasoning as the vmmap deviation above),
# so this needs no `simctl spawn` at all.
#
# A THIRD RECORDED DEVIATION: the extension's alive-window turned out to be
# genuinely narrow (observed once, live: a `pgrep` hit followed less than a
# second later by a `pgrep` miss inside the SAME script run, when the
# now-superseded ordering ran an `xcrun simctl list devices booted` call
# and a whole second `pgrep` demonstration BEFORE the real PID resolution).
# PID resolution and the `vmmap` call are therefore the FIRST two things
# this script does -- zero avoidable latency between "found alive" and
# "captured" -- with every other step (device bookkeeping, the
# search-shape demonstration) moved AFTER a successful capture, or run only
# on the failure path where timing no longer matters.
EXT_PATTERN='PasskeyVaultAutoFill\.appex/PasskeyVaultAutoFill$'
EXT_PID=$(pgrep -f "$EXT_PATTERN" | head -1 || true)

if [ -z "$EXT_PID" ]; then
  # Not alive -- NOW run the search-shape demonstration (Pitfall 6
  # discipline) so a negative from the line above actually means something,
  # before reporting the honest gap. Timing no longer matters on this path.
  echo "==> search-shape demonstration: the SAME pgrep -f shape used above, against a known-present process (SpringBoard)"
  SPRINGBOARD_HIT=$(pgrep -f 'SpringBoard\.app/SpringBoard$' | head -1 || true)
  if [ -n "$SPRINGBOARD_HIT" ]; then
    echo "    PASS: pgrep -f found SpringBoard at host PID $SPRINGBOARD_HIT -- this search shape can return a hit, so the negative above means something"
  else
    echo "ERROR: search-shape demonstration FAILED -- pgrep -f found no SpringBoard process against a simulator known to have it running; this script's own search shape cannot be trusted" >&2
    exit 1
  fi
  echo "ERROR: PasskeyVaultAutoFill is not alive (no PID matching /$EXT_PATTERN/) -- E7 not obtained. The extension process must be caught while alive (this task's own precondition); inferring the cross-check from the in-process number would defeat the whole purpose of an independent witness." >&2
  exit 1
fi
echo "==> extension PID: $EXT_PID"

# --- The out-of-process reading itself -------------------------------------
# HOST vmmap, DIRECTLY -- never `simctl spawn vmmap` (see the deviation note
# above). Runs IMMEDIATELY after the PID is resolved, no intervening calls.
if ! /usr/bin/vmmap --summary "$EXT_PID" >"$OUT" 2>&1; then
  echo "ERROR: vmmap exited non-zero against PID $EXT_PID -- E7 not obtained. Output:" >&2
  cat "$OUT" >&2
  exit 1
fi

# --- Now that the capture is safely on disk, the bookkeeping / discipline
# steps that timing no longer depends on. -----------------------------------
BOOTED_LIST_FILE=$(mktemp)
xcrun simctl list devices booted >"$BOOTED_LIST_FILE" 2>&1
UDID=$(grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' "$BOOTED_LIST_FILE" | head -1 || true)
rm -f "$BOOTED_LIST_FILE"
echo "==> simulator UDID: ${UDID:-<none found>}"
echo "==> search-shape demonstration: the SAME pgrep -f shape used above, against a known-present process (SpringBoard)"
SPRINGBOARD_HIT=$(pgrep -f 'SpringBoard\.app/SpringBoard$' | head -1 || true)
if [ -n "$SPRINGBOARD_HIT" ]; then
  echo "    PASS: pgrep -f found SpringBoard at host PID $SPRINGBOARD_HIT -- this search shape can return a hit, corroborating the positive capture above"
else
  echo "    NOTE: SpringBoard not found by this demonstration -- does not invalidate the capture already on disk, but recorded"
fi

if ! grep -qF 'Physical footprint' "$OUT"; then
  echo "ERROR: vmmap ran but produced no 'Physical footprint' line in $OUT -- E7 not obtained (process likely exited mid-read)" >&2
  exit 1
fi

OUT_CURRENT=$(grep -E '^Physical footprint:' "$OUT" | head -1 | grep -oE '[0-9.]+[KMG]' | head -1 || true)
OUT_PEAK=$(grep -E '^Physical footprint \(peak\):' "$OUT" | head -1 | grep -oE '[0-9.]+[KMG]' | head -1 || true)
if [ -z "$OUT_PEAK" ]; then
  echo "ERROR: could not parse 'Physical footprint (peak)' value out of $OUT -- E7 not obtained" >&2
  exit 1
fi
echo "==> out-of-process reading: current=${OUT_CURRENT:-<unparsed>} peak=$OUT_PEAK (raw vmmap units, full output in $OUT)"

# Converts vmmap's human-readable K/M/G suffix to a byte count.
to_bytes() {
  local v="$1" num unit
  num=$(printf '%s' "$v" | sed -E 's/[KMG]$//')
  unit=$(printf '%s' "$v" | grep -oE '[KMG]$' || true)
  case "$unit" in
  K) awk -v n="$num" 'BEGIN{printf "%.0f", n*1024}' ;;
  M) awk -v n="$num" 'BEGIN{printf "%.0f", n*1024*1024}' ;;
  G) awk -v n="$num" 'BEGIN{printf "%.0f", n*1024*1024*1024}' ;;
  *) echo "0" ;;
  esac
}
OUT_PEAK_BYTES=$(to_bytes "$OUT_PEAK")

# --- The in-process reference (Task 1's evidence) ---------------------------
IN_PROCESS_MAX=$(grep -oE 'peak_sampled=[0-9]+' "$IN_PROCESS_LOG" | sed -E 's/peak_sampled=//' | sort -n | tail -1 || true)
if [ -z "$IN_PROCESS_MAX" ]; then
  echo "ERROR: no peak_sampled= field found anywhere in $IN_PROCESS_LOG -- cannot compare" >&2
  exit 1
fi

if [ "$OUT_PEAK_BYTES" -ge "$IN_PROCESS_MAX" ]; then
  DIFF=$((OUT_PEAK_BYTES - IN_PROCESS_MAX))
else
  DIFF=$((IN_PROCESS_MAX - OUT_PEAK_BYTES))
fi
echo "in_process_max=$IN_PROCESS_MAX out_of_process_peak=$OUT_PEAK_BYTES difference=$DIFF tolerance=$TOLERANCE_BYTES(8MiB, pre-declared)"
if [ "$DIFF" -le "$TOLERANCE_BYTES" ]; then
  echo "CLASSIFICATION: agreement -- the two independent instruments agree within the pre-declared 8 MiB tolerance"
else
  echo "CLASSIFICATION: divergence -- the two independent instruments differ by more than the pre-declared 8 MiB tolerance. Reported as a finding, never averaged, never resolved, never picked one over the other."
fi
