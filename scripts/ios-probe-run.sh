#!/usr/bin/env bash
# scripts/ios-probe-run.sh -- Phase 36, Plan 36-01, Task 1.
#
# Builds PasskeyVault.app + PasskeyVaultAutoFill.appex for a probe run,
# installs on exactly one simulator, drives AutoFillInvocationUITests (the
# real, automated, repeatable trigger for the extension), captures the
# resulting os_log output, and asserts the PVPROBE| marker is present.
#
# Usage: scripts/ios-probe-run.sh <probe-name>
#   <probe-name> is a single lower-case word with no separators (the
#   contract every plan in this phase uses, 36-01-PLAN.md "Artifacts this
#   phase produces"). It is upper-cased and prefixed PV_PROBE_ to become the
#   SWIFT_ACTIVE_COMPILATION_CONDITIONS value passed to the extension
#   target's build.
#
# SIMULATOR DISCIPLINE (top operational risk this phase, per plan
# constraints): reuses an already-booted device if one exists; otherwise
# boots exactly ONE simulator from the existing device list. NEVER
# `simctl create`. Never opens Simulator.app.
#
# D-08 (landmine L-3, this project's shell is zsh): never read a
# bash-only post-pipeline status array. Every xcodebuild/log invocation
# below redirects to a file and is inspected via `grep`/`test`, never
# `cmd | tail` followed by a status check.
#
# LANDMINE L-10 (ios/IOS-SPIKE-LOG.md Sec 3): the "Build pv-ffi XCFramework"
# Run Script phase on PasskeyVaultTests declares no inputPaths/outputPaths,
# so on a COLD DerivedData the first build/test invocation in a given state
# can fail with `Crash: ... at uniffiEnsurePvFfiInitialized()` (a checksum
# mismatch between the just-regenerated Swift bindings and the linked
# library) or a plain "cannot find 'uniffi_...' in scope" compile error --
# a second, identical invocation passes. Both `run_build` and `run_test`
# below retry ONCE on that exact signature and print a note when it fires,
# rather than treating it as a real failure.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

PROBE_NAME="${1:-}"
if [ -z "$PROBE_NAME" ]; then
  echo "Usage: $0 <probe-name>" >&2
  exit 1
fi
# Mechanical derivation, single-sourced (36-01-PLAN.md "Build-product path
# contract"): PV_PROBE_ + upper-cased probe name.
CONDITION="PV_PROBE_$(printf '%s' "$PROBE_NAME" | tr '[:lower:]' '[:upper:]')"
echo "==> probe: $PROBE_NAME (SWIFT_ACTIVE_COMPILATION_CONDITIONS=$CONDITION)"

DD_PATH="/tmp/pv-dd"
PV_APP="$DD_PATH/Build/Products/Debug-iphonesimulator/PasskeyVault.app"
PV_APPEX="$PV_APP/PlugIns/PasskeyVaultAutoFill.appex"

# --- 1. Ensure the plain (no ffi06-probe) pv-ffi artifact is on disk -----
# so the appex links the variant that never carries the synthetic panic
# probe (T-36-02). PasskeyVaultTests' own Run Script phase later
# regenerates a --with-panic-probe variant into the SAME output path when
# it builds (the plan's documented shared-output-path limitation,
# scripts/build-ios.sh's own header) -- this call-order discipline is what
# keeps that from leaking into the appex build below.
"$REPO_ROOT/scripts/build-ios.sh"

# --- 2. Exactly one simulator ---------------------------------------------
BOOTED_LIST_FILE=$(mktemp)
xcrun simctl list devices booted > "$BOOTED_LIST_FILE" 2>&1
UDID=$(grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' "$BOOTED_LIST_FILE" | head -1 || true)
rm -f "$BOOTED_LIST_FILE"

if [ -z "$UDID" ]; then
  AVAILABLE_LIST_FILE=$(mktemp)
  xcrun simctl list devices available > "$AVAILABLE_LIST_FILE" 2>&1
  # First iPhone under the iOS 26.5 runtime header -- never `simctl create`.
  UDID=$(awk '/-- iOS 26.5 --/{f=1;next} /^--/{f=0} f && /iPhone/{print; exit}' "$AVAILABLE_LIST_FILE" \
    | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' || true)
  rm -f "$AVAILABLE_LIST_FILE"
  if [ -z "$UDID" ]; then
    echo "ERROR: no already-booted simulator and no iOS 26.5 iPhone available to boot" >&2
    exit 1
  fi
  echo "==> booting $UDID (the ONE simulator this run needs)"
  xcrun simctl boot "$UDID"
fi
echo "==> simulator UDID: $UDID"

# --- 3. Build app + extension ---------------------------------------------
# Deliberately the `build` action, not `test`: `test`'s build-for-testing
# pass ALSO builds PasskeyVaultTests (verified live -- even with
# `-skip-testing:PasskeyVaultTests`, which only skips RUNNING it, not
# building it), racing its --with-panic-probe script phase against this
# step's plain artifact. A plain `build` action only builds the scheme's
# Run target (PasskeyVault + its explicit PasskeyVaultAutoFill dependency),
# never touching PasskeyVaultTests at all.
run_build() {
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$UDID" \
    -derivedDataPath "$DD_PATH" \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) $CONDITION" \
    build
}

BUILD_LOG=$(mktemp)
if ! run_build > "$BUILD_LOG" 2>&1; then
  if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope' "$BUILD_LOG"; then
    echo "==> HIT landmine L-10 (cold DerivedData mismatch) on the app+extension build -- retrying once (ios/IOS-SPIKE-LOG.md Sec 3, L-10)"
    if ! run_build > "$BUILD_LOG" 2>&1; then
      echo "ERROR: app+extension build failed twice (not the known L-10 flake)" >&2
      tail -100 "$BUILD_LOG" >&2
      rm -f "$BUILD_LOG"
      exit 1
    fi
  else
    echo "ERROR: app+extension build failed" >&2
    tail -100 "$BUILD_LOG" >&2
    rm -f "$BUILD_LOG"
    exit 1
  fi
fi
rm -f "$BUILD_LOG"

if [ ! -d "$PV_APP" ]; then
  echo "ERROR: expected build product missing: $PV_APP" >&2
  exit 1
fi
if [ ! -d "$PV_APPEX" ]; then
  echo "ERROR: expected build product missing: $PV_APPEX" >&2
  exit 1
fi
echo "==> PV_APP=$PV_APP"
echo "==> PV_APPEX=$PV_APPEX"

# --- 4. Install ------------------------------------------------------------
xcrun simctl install "$UDID" "$PV_APP"

# --- 5. Drive the real invocation via AutoFillInvocationUITests -----------
run_test() {
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$UDID" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/AutoFillInvocationUITests \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) $CONDITION" \
    test
}

TEST_LOG=$(mktemp)
if ! run_test > "$TEST_LOG" 2>&1; then
  if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope' "$TEST_LOG"; then
    echo "==> HIT landmine L-10 (cold DerivedData mismatch) on the test build -- retrying once (ios/IOS-SPIKE-LOG.md Sec 3, L-10)"
    if ! run_test > "$TEST_LOG" 2>&1; then
      echo "ERROR: AutoFillInvocationUITests failed twice (not the known L-10 flake)" >&2
      tail -150 "$TEST_LOG" >&2
      rm -f "$TEST_LOG"
      exit 1
    fi
  else
    echo "ERROR: AutoFillInvocationUITests failed" >&2
    tail -150 "$TEST_LOG" >&2
    rm -f "$TEST_LOG"
    exit 1
  fi
fi
rm -f "$TEST_LOG"

# --- 6. Capture and assert -------------------------------------------------
mkdir -p ios/evidence/36
LOGFILE="ios/evidence/36/${PROBE_NAME}.log"
xcrun simctl spawn "$UDID" log show \
  --predicate 'subsystem == "cloud.blonie.PasskeyVault"' --last 5m \
  > "$LOGFILE" 2>&1

if ! grep -q 'PVPROBE|' "$LOGFILE"; then
  echo "ERROR: no PVPROBE| line found in $LOGFILE -- the extension did not run, or did not log" >&2
  exit 1
fi
echo "==> PASS: PVPROBE| line found in $LOGFILE"
grep 'PVPROBE|' "$LOGFILE"
