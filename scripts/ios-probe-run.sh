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

# --- 1. Build the pv-ffi artifact this probe needs -----------------------
# Plain (no ffi06-probe, no kdf-probe) for every probe name except
# `sensitivity` (36-03, E5.c): that one probe alone needs
# `FfiWrappingKey.fromPasswordProbeUnchecked` (crates/pv-ffi/src/
# kdf_probe.rs), which only exists in the generated Swift bindings when
# pv-ffi was built --with-kdf-probe. Every other probe run links the
# plain variant, so the appex never carries a probe-only symbol it never
# calls (T-36-02's same discipline, extended). PasskeyVaultTests' own Run
# Script phase separately regenerates a --with-panic-probe variant into the
# SAME output path when it builds (the plan's documented shared-output-path
# limitation, scripts/build-ios.sh's own header) -- this call-order
# discipline is what keeps that from leaking into the appex build below.
if [ "$PROBE_NAME" = "sensitivity" ]; then
  echo "==> probe 'sensitivity' needs the --with-kdf-probe pv-ffi variant (E5.c)"
  "$REPO_ROOT/scripts/build-ios.sh" --with-kdf-probe
else
  "$REPO_ROOT/scripts/build-ios.sh"
fi

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
# PV_FFI_TEST_VARIANT (landmine L-11, found running 36-03 Task 2): `test`'s
# build-for-testing pass ALSO builds PasskeyVaultTests (confirmed above,
# even with -skip-testing) -- and ITS "Build pv-ffi XCFramework" Run Script
# phase used to hardcode `--with-panic-probe`, unconditionally clobbering
# whatever pv-ffi variant THIS probe run actually needs (the shared
# single-output-path limitation, scripts/build-ios.sh's own header),
# racing non-deterministically against PasskeyVaultAutoFill's own compile
# inside the SAME xcodebuild invocation -- retrying with a single-feature
# pre-rebuild before each attempt did NOT converge (the clobber happens
# INSIDE xcodebuild's own build graph, not before it), AND single-feature
# starved whichever target's compile ran first regardless: PasskeyVaultTests
# needs `ffi06-probe` (FfiPanicSafetyTests.swift, unconditionally built for
# testing) while PasskeyVaultAutoFill needs `kdf-probe` (KdfProbe.swift) --
# both are built in the SAME invocation, from the SAME shared output. The
# actual fix is at the source: the Run Script phase now reads
# `${PV_FFI_TEST_VARIANT:---with-panic-probe}`
# (ios/PasskeyVault/PasskeyVault.xcodeproj/project.pbxproj), and
# scripts/build-ios.sh now accepts BOTH `--with-panic-probe` and
# `--with-kdf-probe` together (producing one artifact carrying both
# diagnostic symbols), so passing both on the xcodebuild command line makes
# PasskeyVaultTests build a variant that satisfies EVERY target's compile
# regardless of build order, eliminating the race instead of retrying
# around it. Unset (the default) for every probe except `sensitivity`, so
# FfiPanicSafetyTests.swift (the only reason the flag existed) and every
# other probe keep their prior, already-proven behavior unchanged.
TEST_VARIANT_SETTING="PV_FFI_TEST_VARIANT="
if [ "$PROBE_NAME" = "sensitivity" ]; then
  TEST_VARIANT_SETTING="PV_FFI_TEST_VARIANT=--with-panic-probe --with-kdf-probe"
fi

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
    "$TEST_VARIANT_SETTING" \
    test
}

# L-10 (ios/IOS-SPIKE-LOG.md Sec 3): a cold-DerivedData checksum/symbol
# mismatch between the just-regenerated bindings and the linked library,
# because PasskeyVaultTests' Run Script phase declares no outputs and so
# reruns on every build, racing Xcode's own compile/link ordering. Since
# `PV_FFI_TEST_VARIANT` (above) now makes that phase build the SAME variant
# every target in this invocation needs, a BARE retry (no manual rebuild --
# the next full `xcodebuild test` invocation re-triggers the Run Script
# phase with the same correct setting) is what plan 36-01 already proved
# sufficient, for every probe including `sensitivity`. Landmine L-11
# (found running 36-03 Task 2) was this same race landing on a
# single-feature variant before PV_FFI_TEST_VARIANT existed; kept as a
# second detected signature below in case a future probe reintroduces a
# single-feature build somewhere in this chain.
MAX_ATTEMPTS=5
ATTEMPT=1
TEST_LOG=$(mktemp)
# RUN_START (found running 36-03 Task 3, blocking-issue fix, Rule 3): a
# fixed `--last 5m` window here is a false-PASS trap when two probe runs
# happen inside 5 minutes of each other -- a STALE PVPROBE| line from the
# PRIOR probe run (still inside the window) can satisfy step 6's bare
# `grep -q 'PVPROBE|'` check even when THIS run's own invocation of the
# extension never happened (observed live: the toggle-based UI test route
# flips the provider's election state each time it runs -- see
# AutoFillInvocationUITests.swift -- so a run that lands on the OFF->ON
# edge invokes the extension, and the very next run, landing on ON->OFF,
# does not). Recording the wall-clock instant just before the test attempt
# loop starts and filtering the log capture to `--start "$RUN_START"`
# instead of a fixed lookback window scopes the evidence to THIS
# invocation only, so a run that produced no new PVPROBE| line fails
# loudly instead of silently reusing a prior run's evidence.
RUN_START=$(date '+%Y-%m-%d %H:%M:%S')
while ! run_test > "$TEST_LOG" 2>&1; do
  if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
    echo "ERROR: AutoFillInvocationUITests failed after $ATTEMPT attempts (not a known flake pattern, or the known flakes did not resolve)" >&2
    tail -150 "$TEST_LOG" >&2
    rm -f "$TEST_LOG"
    exit 1
  fi
  if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope|has no member .fromPasswordProbeUnchecked.' "$TEST_LOG"; then
    echo "==> HIT landmine L-10/L-11 (cold DerivedData / shared-output-path mismatch) on the test build -- retrying (attempt $((ATTEMPT + 1))/$MAX_ATTEMPTS, ios/IOS-SPIKE-LOG.md Sec 3)"
  else
    echo "ERROR: AutoFillInvocationUITests failed (not a known flake signature)" >&2
    tail -150 "$TEST_LOG" >&2
    rm -f "$TEST_LOG"
    exit 1
  fi
  ATTEMPT=$((ATTEMPT + 1))
done
rm -f "$TEST_LOG"

# --- 6. Capture and assert -------------------------------------------------
mkdir -p ios/evidence/36
LOGFILE="ios/evidence/36/${PROBE_NAME}.log"
xcrun simctl spawn "$UDID" log show \
  --predicate 'subsystem == "cloud.blonie.PasskeyVault"' --start "$RUN_START" \
  > "$LOGFILE" 2>&1

if ! grep -q 'PVPROBE|' "$LOGFILE"; then
  echo "ERROR: no PVPROBE| line found in $LOGFILE since $RUN_START -- the extension did not run, or did not log this invocation (the provider's election toggles on every UI-test run -- see AutoFillInvocationUITests.swift -- a run landing on the ON->OFF edge does not invoke the extension; re-run this command)" >&2
  exit 1
fi
echo "==> PASS: PVPROBE| line found in $LOGFILE since $RUN_START"
grep 'PVPROBE|' "$LOGFILE"
