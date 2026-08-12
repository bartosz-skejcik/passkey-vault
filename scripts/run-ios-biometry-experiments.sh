#!/usr/bin/env bash
# scripts/run-ios-biometry-experiments.sh -- Phase 37, Plan 37-05, Task 1.
#
# Single orchestrator for the E1-E6 / E-SE-1/1b/2/4 experiment sequence, so
# the whole run is reproducible from one transcript. It:
#   1. refuses to run if more than one simulator is booted;
#   2. exposes `pearl_match`/`pearl_nomatch`/`enrollment_changed` shell
#      helpers wrapping `xcrun simctl spawn <UDID> notifyutil ...` (usable
#      standalone, e.g. `scripts/run-ios-biometry-experiments.sh pearl-match
#      <UDID>`) -- the SAME notification names `BiometricGateSimulatorTests`
#      sends itself (via `Process`) for in-test timing, so the mechanism
#      here is documentation-and-manual-use, not a second implementation;
#   3. runs `BiometricGateSimulatorTests` then `SecureEnclaveProbeTests`,
#      pinned to the booted device's exact UDID (never a bare device name),
#      with `-parallel-testing-enabled NO`.
#
# Instrument finding (Task 1a, ios/IOS-SPIKE-LOG.md): `xcodebuild test
# -destination "platform=iOS Simulator,name=<Name>"` clones the named
# device into an ephemeral "Clone N of <Name>" simulator that does not
# carry the source device's Face ID enrollment (35-03, 37-03's own
# transcripts). Pinning by exact `id=<UDID>` (never `name=`) plus
# `-parallel-testing-enabled NO` was verified this run (xcresulttool
# `test-results tests` reporting the deviceId of the ALREADY-BOOTED device,
# not a clone) to execute directly on the booted device -- no clone. This
# script always uses `id=<UDID>`.
#
# Shell discipline (landmine L-3, ios/IOS-SPIKE-LOG.md §3): this project's
# shell is zsh, where the bash-only post-pipe status array is spelled
# differently and is silently empty here. This script never spells that
# array literally (including in comments -- the acceptance gate greps for
# the exact token), and never pipes a command whose own exit status matters
# into `tail`/`grep` without capturing the status into a variable first.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PROJECT="ios/PasskeyVault/PasskeyVault.xcodeproj"
SCHEME="PasskeyVault"

# --- booted-device discovery / single-simulator discipline ----------------

booted_udids() {
  xcrun simctl list devices | grep -o '[0-9A-F-]\{36\}' | while read -r id; do
    xcrun simctl list devices | grep "$id" | grep -q "(Booted)" && echo "$id"
  done | sort -u
}

require_single_booted() {
  local count
  count=$(xcrun simctl list devices | grep -c "(Booted)" || true)
  if [ "$count" -gt 1 ]; then
    echo "REFUSED: more than one simulator is booted (count=${count}). This workflow's own prohibition (a prior run drove the machine to 0.7 GB free RAM by booting three) requires exactly one." >&2
    xcrun simctl list devices | grep "(Booted)" >&2
    exit 1
  fi
  if [ "$count" -eq 0 ]; then
    echo "REFUSED: no simulator is booted. Boot exactly one iPhone simulator (Face ID capable, iOS 26.5) before running this script." >&2
    exit 1
  fi
}

resolve_udid() {
  if [ -n "${1:-}" ]; then
    echo "$1"
    return
  fi
  xcrun simctl list devices | grep "(Booted)" | grep -o '[0-9A-F-]\{36\}' | head -n1
}

# --- notifyutil helpers -----------------------------------------------------
# Whether the runtime still honours these notifications is INFERRED, not
# observed, until an experiment is actually seen responding to one --
# BiometricGateSimulatorTests records, per-experiment, whether the
# notification produced an observable effect.

pearl_match() {
  local udid="$1"
  xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit_Sim.pearl.match
}

pearl_nomatch() {
  local udid="$1"
  xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit_Sim.pearl.nomatch
}

enrollment_changed() {
  local udid="$1"
  xcrun simctl spawn "$udid" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1
  xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit.enrollmentChanged
}

# --- xcodebuild invocation, pinned by UDID, no clone -----------------------

run_suite() {
  local udid="$1" suite="$2" logfile="$3"
  xcodebuild test \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -destination "platform=iOS Simulator,id=${udid}" \
    -parallel-testing-enabled NO \
    -only-testing:"PasskeyVaultTests/${suite}" \
    TEST_RUNNER_PV_TARGET_UDID="$udid" \
    PV_TARGET_UDID="$udid" \
    >"$logfile" 2>&1
  local status=$?
  return $status
}

main() {
  local cmd="${1:-run-all}"
  case "$cmd" in
    pearl-match)
      require_single_booted
      pearl_match "$(resolve_udid "${2:-}")"
      ;;
    pearl-nomatch)
      require_single_booted
      pearl_nomatch "$(resolve_udid "${2:-}")"
      ;;
    enrollment-changed)
      require_single_booted
      enrollment_changed "$(resolve_udid "${2:-}")"
      ;;
    run-all)
      require_single_booted
      local udid
      udid="$(resolve_udid "${2:-}")"
      echo "==> target UDID: ${udid}"
      echo "==> running BiometricGateSimulatorTests"
      if run_suite "$udid" "BiometricGateSimulatorTests" /tmp/pv37-05-biometric.log; then
        echo "BiometricGateSimulatorTests: PASS"
      else
        echo "BiometricGateSimulatorTests: FAIL (see /tmp/pv37-05-biometric.log)"
        tail -80 /tmp/pv37-05-biometric.log
        exit 1
      fi
      echo "==> running SecureEnclaveProbeTests"
      if run_suite "$udid" "SecureEnclaveProbeTests" /tmp/pv37-05-se.log; then
        echo "SecureEnclaveProbeTests: PASS"
      else
        echo "SecureEnclaveProbeTests: FAIL (see /tmp/pv37-05-se.log)"
        tail -80 /tmp/pv37-05-se.log
        exit 1
      fi
      ;;
    *)
      echo "usage: $0 {pearl-match|pearl-nomatch|enrollment-changed|run-all} [UDID]" >&2
      exit 2
      ;;
  esac
}

main "$@"
