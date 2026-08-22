#!/usr/bin/env bash
# scripts/ios-autofill-e44.sh -- Phase 44 (zapisywanie-i-generowanie-hasel), Plan 44-03, Task 1.
# Mirrors `scripts/ios-autofill-e43.sh`'s own established pattern (subcommand dispatch,
# `--assert-only <path>` contract, pinned-simulator resolution, `pluginkit` provider election,
# `build_with_l10_retry`, log-capture via `os_log` marker greps) -- never reinvents it.
#
# `probe` subcommand: this plan's own live experiment (44-03-PLAN.md Task 1's `<verify>`). Builds
# and installs BOTH the `PasskeyVault` app+extension (carrying this plan's new capability keys +
# diagnostic overrides) and the DISTINCT `PasskeyVaultHarness` app (carrying the new
# `SavePasswordFormView`); drives the harness's own username/new-password fields + Submit
# (`SavePasswordFormHarnessUITests`); captures the EXTENSION process's own `os_log` output
# (subsystem `cloud.blonie.PasskeyVault`, category `fill`) and greps for the two new
# `PVDIAG|method=prepareInterface(for:AS...)` markers. Exits 0 EITHER WAY -- a decisive
# "fired"/"did not fire" is itself the valid, informative result this tracer exists to produce;
# prints which outcome was observed for each override independently.
#
# D-08 (this project's shell is zsh, `/usr/bin/env bash` on this host resolves to macOS's bundled
# bash 3.2): `$pipestatus`, never `$PIPESTATUS`, is this repo's own array for pipeline exit codes
# in the interactive shell -- this script itself never relies on either, every check below
# redirects into a file and is inspected via grep/test.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

EVIDENCE_DIR="ios/evidence/44"
DD_PATH="/tmp/pv-dd"
PV_APP_PRODUCT="$DD_PATH/Build/Products/Debug-iphonesimulator/PasskeyVault.app"
HARNESS_APP_PRODUCT="$DD_PATH/Build/Products/Debug-iphonesimulator/PasskeyVaultHarness.app"
PINNED_UDID_FILE="/private/tmp/pv16.udid"
BUNDLE_ID="cloud.blonie.PasskeyVault"
HARNESS_BUNDLE_ID="cloud.blonie.PasskeyVaultHarness"

usage() {
  echo "Usage: $0 probe [--assert-only <path>]" >&2
  exit 1
}

resolve_pinned_udid() {
  if [ ! -f "$PINNED_UDID_FILE" ]; then
    echo "ERROR: pinned simulator UDID file not found: $PINNED_UDID_FILE" >&2
    exit 1
  fi
  local udid
  udid=$(cat "$PINNED_UDID_FILE")
  if [ -z "$udid" ]; then
    echo "ERROR: pinned simulator UDID file is empty: $PINNED_UDID_FILE" >&2
    exit 1
  fi
  local list_file
  list_file=$(mktemp)
  xcrun simctl list devices > "$list_file" 2>&1
  if ! grep -q "$udid" "$list_file"; then
    echo "ERROR: pinned UDID $udid not found in simctl device list" >&2
    rm -f "$list_file"
    exit 1
  fi
  if ! grep "$udid" "$list_file" | grep -q "(Booted)"; then
    echo "==> booting pinned simulator $udid" >&2
    xcrun simctl boot "$udid"
    sleep 3
  fi
  rm -f "$list_file"
  echo "$udid"
}

# Same L-10 retry wrapper `ios-autofill-e43.sh`'s own `build_with_l10_retry` established -- a cold
# DerivedData mismatches the generated pv-ffi bindings against the linked library on the FIRST
# build after the "Build pv-ffi XCFramework" script phase's own Debug-config default regenerates
# them mid-build. Retried ONCE; a second failure is a real error. Same signature also covers L-41
# (a plain build-ios.sh run immediately followed by an xcodebuild invocation that regenerates
# bindings fails the FIRST attempt with "cannot find ... in scope", recovers on immediate retry).
build_with_l10_retry() {
  local udid="$1" scheme="$2" out_log="$3" action="$4"
  local run_once
  run_once() {
    xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
      -scheme "$scheme" -configuration Debug \
      -destination "platform=iOS Simulator,id=$udid" \
      -derivedDataPath "$DD_PATH" \
      "$action"
  }
  if ! run_once > "$out_log" 2>&1; then
    if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope|Testing cancelled because the build failed' "$out_log"; then
      echo "==> HIT landmine L-10/L-41 (cold DerivedData / binding-regeneration flake) -- retrying once" >&2
      if ! run_once > "$out_log" 2>&1; then
        echo "ERROR: build failed twice (not the known L-10/L-41 flake)" >&2
        tail -100 "$out_log" >&2
        return 1
      fi
    else
      echo "ERROR: build failed" >&2
      tail -100 "$out_log" >&2
      return 1
    fi
  fi
  return 0
}

ensure_provider_enabled() {
  local udid="$1"
  if xcrun simctl spawn "$udid" pluginkit -m -p com.apple.authentication-services-credential-provider-ui 2>/dev/null | grep -q '^+'; then
    return 0
  fi
  echo "==> AutoFill provider not enabled -- re-electing via pluginkit -e use (CLI-only re-election)" >&2
  xcrun simctl spawn "$udid" pluginkit -e use -i "${BUNDLE_ID}.AutoFill" >/dev/null 2>&1 || true
}

# `probe`: this plan's own live experiment.
cmd_probe() {
  mkdir -p "$EVIDENCE_DIR"

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> probe: pinned simulator UDID: $udid"

  echo "==> probe: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> probe: building PasskeyVault app+extension (new capabilities + diagnostic overrides)"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-build.log build

  echo "==> probe: building PasskeyVaultHarness app (new SavePasswordFormView)"
  build_with_l10_retry "$udid" "PasskeyVaultHarness" /tmp/pv-e44-harness-build.log build

  echo "==> probe: building the UI test bundle (PasskeyVaultUITests)"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-build-for-testing.log build-for-testing

  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  xcrun simctl install "$udid" "$HARNESS_APP_PRODUCT"
  ensure_provider_enabled "$udid"

  # First launch of the shipping app: creates the App Group container on disk / registers the
  # extension process at least once (mirrors ios-autofill-e43.sh's own double-launch pattern).
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  echo "==> probe: launching PasskeyVaultHarness (SavePasswordFormView is its third section)"
  xcrun simctl launch --terminate-running-process "$udid" "$HARNESS_BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 1

  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')

  echo "==> probe: driving the harness form (SavePasswordFormHarnessUITests)"
  local ui_test_log
  ui_test_log=$(mktemp)
  local ui_result=0
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/SavePasswordFormHarnessUITests/testDriveSavePasswordForm \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    test > "$ui_test_log" 2>&1 || ui_result=$?

  local evidence_log="$EVIDENCE_DIR/44-03-probe.log"
  : > "$evidence_log"
  echo "## XCUITest drive (exit $ui_result) -- see $ui_test_log for the full transcript" >> "$evidence_log"
  tail -60 "$ui_test_log" >> "$evidence_log" || true

  # log-capture via `os_log` marker greps -- the EXTENSION process's own subsystem
  # (`cloud.blonie.PasskeyVault`, category `fill`), the same idiom every prior probe/seeder in
  # this codebase already uses (ios-autofill-e43.sh's own header: "log-capture via os_log marker
  # greps"). Scoped with `--start "$run_start"` so a stale prior-run marker can never be misread
  # as this run's own evidence.
  echo "" >> "$evidence_log"
  echo "## PVDIAG| markers from the extension process (subsystem cloud.blonie.PasskeyVault), this run" >> "$evidence_log"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run_start" \
    2>&1 | grep 'PVDIAG|' >> "$evidence_log" || true

  if assert_probe "$evidence_log"; then
    echo "PASS: probe -- see $evidence_log for the decisive fired/did-not-fire verdict"
    exit 0
  else
    echo "FAIL: probe -- $evidence_log unreadable or empty" >&2
    exit 1
  fi
}

# Prints a decisive fired/did-not-fire verdict for EACH override independently. Exits 0 either
# way (a decisive negative is a valid, informative result) -- only fails if the evidence file
# itself is missing/unreadable/empty (a genuine harness malfunction, distinct from "the system
# never called our override").
assert_probe() {
  local target="$1"
  if [ ! -f "$target" ] || [ ! -r "$target" ] || [ ! -s "$target" ]; then
    echo "ERROR: probe evidence file missing/empty: $target" >&2
    return 1
  fi
  if grep -q 'PVDIAG|method=prepareInterface(for:ASSavePasswordRequest)' "$target"; then
    echo "VERDICT: ASSavePasswordRequest override FIRED -- $(grep 'PVDIAG|method=prepareInterface(for:ASSavePasswordRequest)' "$target" | head -1)"
  else
    echo "VERDICT: ASSavePasswordRequest override DID NOT FIRE in this run"
  fi
  if grep -q 'PVDIAG|method=prepareInterface(for:ASGeneratePasswordsRequest)' "$target"; then
    echo "VERDICT: ASGeneratePasswordsRequest override FIRED -- $(grep 'PVDIAG|method=prepareInterface(for:ASGeneratePasswordsRequest)' "$target" | head -1)"
  else
    echo "VERDICT: ASGeneratePasswordsRequest override DID NOT FIRE in this run"
  fi
  return 0
}

main() {
  if [ $# -lt 1 ]; then
    usage
  fi
  local subcommand="$1"
  shift || true

  case "$subcommand" in
    probe)
      if [ "${1:-}" = "--assert-only" ]; then
        shift
        local path="${1:-}"
        if [ -z "$path" ]; then
          echo "ERROR: --assert-only requires a path" >&2
          exit 1
        fi
        if assert_probe "$path"; then
          exit 0
        else
          exit 1
        fi
      fi
      cmd_probe
      ;;
    *)
      usage
      ;;
  esac
}

main "$@"
