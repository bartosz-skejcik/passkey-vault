#!/usr/bin/env bash
# scripts/ios-autofill-e43.sh -- Phase 43 (warunkowe-passkeys-tylko-jesli-tanie), Plan 43-03,
# Task 2. Extends `scripts/ios-autofill-e41.sh`'s established pattern (subcommand dispatch table,
# `--assert-only <path>` contract, `notifyutil`-driven simulator biometric-match loop, `pluginkit`
# provider-enablement, log-capture via `os_log` marker greps) -- never reinvents it.
#
# `tracer` subcommand: the phase's own end-to-end proof (43-03-PLAN.md Task 2's <verify>). Starts
# `crates/rp-fixture` (a fresh process per invocation, so this run's own stdout log is
# unambiguous); seeds a REAL passkey (via `crates/pv-provider/examples/ios_seed_passkey.rs`,
# genuinely registered with the fixture's own independent `webauthn-rs` verifier) onto the pinned
# simulator through the host app's `PasskeyTracerSeeder` (PV_PROBE_E43_TRACER); drives Safari to
# the fixture's own real `navigator.credentials.get()` page and taps through the system's
# confirmation surface (`AutoFillPasskeyTracerUITests`), alongside a parallel `notifyutil`
# biometric-match loop (`cmd_tracer`'s own precedent, `ios-autofill-e41.sh`); then asserts
# PASS/FAIL from `crates/rp-fixture`'s OWN `/assert/finish` log line -- RECEIVER-SIDE proof by an
# independent verifier, never "our extension logged a fill" (this plan's own `must_haves.truths`).
#
# `--corrupt-signature`: the harness's own falsification leg. Writes a marker file into the App
# Group container that `CredentialProviderViewController.swift`'s own `#if DEBUG`-gated check
# reads at ceremony-completion time, flipping one byte of the REAL signature before completing the
# assertion -- proves the fixture's own verifier genuinely fails closed (L-3/L-9), never a
# shape/`.ok`-only check.
#
# `<subcommand> --assert-only <path>` skips boot/build/install/drive entirely and runs ONLY that
# subcommand's assertions against the named evidence file -- matching `ios-autofill-e41.sh`'s own
# harness contract verbatim (see that script's own header for the full rationale).
#
# D-08 (landmine L-3, this project's shell is zsh): PIPESTATUS is empty here; the array is
# $pipestatus and is never relied on. Every check below redirects into a file/variable and is
# inspected via grep/test, never `cmd | tail` followed by a status check.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

EVIDENCE_DIR="ios/evidence/43"
DD_PATH="/tmp/pv-dd"
PV_APP_PRODUCT="$DD_PATH/Build/Products/Debug-iphonesimulator/PasskeyVault.app"
PINNED_UDID_FILE="/private/tmp/pv16.udid"
FIXTURE_PORT=8900
FIXTURE_BASE="http://localhost:${FIXTURE_PORT}"
APP_GROUP_ID="group.cloud.blonie.PasskeyVault"
BUNDLE_ID="cloud.blonie.PasskeyVault"
SEED_INPUT_FILE_NAME="pv-43-seed-passkey.json"
CORRUPT_MARKER_FILE_NAME="pv-43-corrupt-signature.marker"
STATUS_FILE_NAME="e43-tracer-seed-status.json"

usage() {
  echo "Usage: $0 {tracer} [--corrupt-signature] [--assert-only <path> --expect-ok <true|false>]" >&2
  exit 1
}

# --- shared: a non-empty, readable file, or a named failure ----------------
require_nonempty_file() {
  local path="$1" label="$2"
  if [ ! -f "$path" ]; then
    echo "ERROR: $label -- file does not exist: $path" >&2
    return 1
  fi
  if [ ! -r "$path" ]; then
    echo "ERROR: $label -- file is not readable: $path" >&2
    return 1
  fi
  if [ ! -s "$path" ]; then
    echo "ERROR: $label -- file is EMPTY: $path (an empty file is never treated as nothing-to-check)" >&2
    return 1
  fi
  return 0
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

# Same L-10 retry wrapper `ios-autofill-e41.sh`'s own `build_with_l10_retry` established -- a cold
# DerivedData mismatches the generated pv-ffi bindings against the linked library on the FIRST
# build after the "Build pv-ffi XCFramework" script phase's own Debug-config default regenerates
# them mid-build. Retried ONCE; a second failure is a real error.
build_with_l10_retry() {
  local udid="$1" extra_conditions="$2" out_log="$3" action="$4"
  local run_once
  run_once() {
    xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
      -scheme PasskeyVault -configuration Debug \
      -destination "platform=iOS Simulator,id=$udid" \
      -derivedDataPath "$DD_PATH" \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) $extra_conditions" \
      "$action"
  }
  if ! run_once > "$out_log" 2>&1; then
    if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope' "$out_log"; then
      echo "==> HIT landmine L-10 (cold DerivedData mismatch) -- retrying once" >&2
      if ! run_once > "$out_log" 2>&1; then
        echo "ERROR: build failed twice (not the known L-10 flake)" >&2
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
  if xcrun simctl spawn "$udid" pluginkit -m -p com.apple.authentication-services-credential-provider-ui 2>/dev/null | grep -q '^+'; then
    return 0
  fi
  echo "==> pluginkit re-election insufficient -- falling back to the Settings toggle via XCUITest" >&2
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/AutoFillInvocationUITests/testInvokeExtensionConfigurationViaSettingsAutoFillToggle \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    test > /tmp/pv-e43-enable-provider.log 2>&1 || true
}

# CLI-only (`notifyutil`), never the Simulator.app GUI menu -- `ios-autofill-e41.sh`'s own
# established precedent (unreliable in a headless session).
ensure_biometric_enrollment() {
  local udid="$1"
  xcrun simctl spawn "$udid" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 >/dev/null 2>&1 || true
  xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit.enrollmentChanged >/dev/null 2>&1 || true
}

# Long-lived background loop -- Safari's own LocalAuthentication confirmation window was observed
# live (Phase 41) NOT to open at a predictable offset from test start, so this posts continuously
# for the loop's whole life. Same mechanism `ios-autofill-e41.sh`'s own `run_pearl_match_loop`
# established.
run_pearl_match_loop() {
  local udid="$1"
  while true; do
    xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit_Sim.pearl.match >/dev/null 2>&1 || true
    sleep 0.3
  done
}

# The exact path `xcrun simctl get_app_container` resolves for a named App Group -- no
# scan-by-file-presence needed (unlike `ios-autofill-e41.sh`'s own `app_group_container_dir`,
# which predates this direct form and has to scan because it cannot assume the group id up
# front); this script always wants the ONE App Group this product uses.
app_group_dir() {
  local udid="$1"
  # `simctl get_app_container <udid> <bundle-id> <group-id>` (the single-group positional form)
  # was found live, this session, to print `simctl`'s own usage text and exit 117 rather than the
  # path -- only the plural `groups` form (a tab-separated `<group-id>\t<path>` listing) works on
  # this toolchain. Parsed with awk, never `grep -o`/cut on an assumed column count.
  xcrun simctl get_app_container "$udid" "$BUNDLE_ID" groups 2>/dev/null \
    | awk -F'\t' -v g="$APP_GROUP_ID" '$1 == g { print $2 }' || true
}

start_fixture() {
  local out_log="$1"
  pkill -f "target/debug/rp-fixture" >/dev/null 2>&1 || true
  sleep 0.5
  (cd "$REPO_ROOT" && nohup cargo run -p rp-fixture -- --port "$FIXTURE_PORT" > "$out_log" 2>&1 &)
  local waited=0
  while ! curl -sf -o /dev/null "${FIXTURE_BASE}/?rp_id=localhost&mode=get" 2>/dev/null; do
    sleep 0.5
    waited=$((waited + 1))
    if [ "$waited" -gt 60 ]; then
      echo "ERROR: crates/rp-fixture did not become ready on ${FIXTURE_BASE} within 30s" >&2
      cat "$out_log" >&2
      return 1
    fi
  done
}

stop_fixture() {
  pkill -f "target/debug/rp-fixture" >/dev/null 2>&1 || true
}

# Seeds a REAL passkey (registered with the fixture's own independent verifier) via
# `crates/pv-provider/examples/ios_seed_passkey.rs`, and stages its plaintext into the App Group
# container for `PasskeyTracerSeeder` (host app, PV_PROBE_E43_TRACER) to consume on next launch.
seed_real_passkey() {
  local udid="$1"
  local group_dir
  group_dir=$(app_group_dir "$udid")
  if [ -z "$group_dir" ]; then
    echo "ERROR: App Group container not found for ${BUNDLE_ID}/${APP_GROUP_ID} -- has the app ever been installed/launched?" >&2
    return 1
  fi

  echo "==> tracer: seeding one real passkey via ios_seed_passkey (registers with the fixture's own verifier)" >&2
  local seed_stderr
  seed_stderr=$(mktemp)
  if ! cargo run --example ios_seed_passkey -p pv-provider -- \
        --fixture-base "$FIXTURE_BASE" --rp-id localhost --user-name ios-tracer-43-03 \
        > "${group_dir}/${SEED_INPUT_FILE_NAME}" 2>"$seed_stderr"; then
    echo "ERROR: ios_seed_passkey failed:" >&2
    cat "$seed_stderr" >&2
    rm -f "$seed_stderr"
    return 1
  fi
  cat "$seed_stderr" >&2
  rm -f "$seed_stderr"
  if ! require_nonempty_file "${group_dir}/${SEED_INPUT_FILE_NAME}" "seed-passkey-plaintext"; then
    return 1
  fi
}

cmd_tracer() {
  local corrupt="${1:-0}"
  mkdir -p "$EVIDENCE_DIR"

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> tracer: pinned simulator UDID: $udid"

  local fixture_log
  if [ "$corrupt" = "1" ]; then
    fixture_log="$EVIDENCE_DIR/43-03-tracer-corrupt.log"
  else
    fixture_log="$EVIDENCE_DIR/43-03-tracer.log"
  fi
  : > "$fixture_log"
  start_fixture "$fixture_log.fixture-stdout"

  echo "==> tracer: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> tracer: building app+extension (PV_PROBE_E43_TRACER)"
  build_with_l10_retry "$udid" "PV_PROBE_E43_TRACER" /tmp/pv-e43-build.log build

  echo "==> tracer: building the UI test bundle (PasskeyVaultUITests)"
  build_with_l10_retry "$udid" "PV_PROBE_E43_TRACER" /tmp/pv-e43-build-for-testing.log build-for-testing

  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  ensure_provider_enabled "$udid"
  ensure_biometric_enrollment "$udid"

  # Launch once, install the App Group container on disk (a fresh install has no group directory
  # until the app runs at least once), then seed the real passkey and re-launch so
  # `PasskeyTracerSeeder.seed()` picks up the staged plaintext.
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  local group_dir
  group_dir=$(app_group_dir "$udid")
  if [ -z "$group_dir" ]; then
    echo "ERROR: App Group container still not found after first launch" >&2
    stop_fixture
    exit 1
  fi
  rm -f "${group_dir}/${STATUS_FILE_NAME}"

  seed_real_passkey "$udid" || { stop_fixture; exit 1; }

  if [ "$corrupt" = "1" ]; then
    echo "==> tracer: arming --corrupt-signature falsification marker"
    touch "${group_dir}/${CORRUPT_MARKER_FILE_NAME}"
  else
    rm -f "${group_dir}/${CORRUPT_MARKER_FILE_NAME}"
  fi

  echo "==> tracer: launching host app to run PasskeyTracerSeeder.seed()"
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  local waited=0
  while [ ! -f "${group_dir}/${STATUS_FILE_NAME}" ]; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -gt 20 ]; then
      echo "ERROR: PasskeyTracerSeeder never wrote its status marker within 20s" >&2
      stop_fixture
      exit 1
    fi
  done
  if ! grep -q '"status":"ok"' "${group_dir}/${STATUS_FILE_NAME}"; then
    echo "ERROR: PasskeyTracerSeeder reported a non-ok status:" >&2
    cat "${group_dir}/${STATUS_FILE_NAME}" >&2
    stop_fixture
    exit 1
  fi
  echo "==> tracer: seed confirmed ok"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')

  echo "==> tracer: driving Safari against the fixture (AutoFillPasskeyTracerUITests)"
  local ui_test_log
  ui_test_log=$(mktemp)
  local ui_result=0
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/AutoFillPasskeyTracerUITests/testPasskeyAssertionAgainstRpFixture \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_E43_TRACER" \
    test > "$ui_test_log" 2>&1 &
  local test_pid=$!
  run_pearl_match_loop "$udid" &
  local match_pid=$!
  wait "$test_pid" || ui_result=$?
  kill "$match_pid" >/dev/null 2>&1 || true
  wait "$match_pid" 2>/dev/null || true

  echo "## XCUITest drive (exit $ui_result) -- see $ui_test_log for the full transcript" >> "$fixture_log"
  tail -40 "$ui_test_log" >> "$fixture_log" || true

  echo "" >> "$fixture_log"
  echo "## crates/rp-fixture stdout, this run" >> "$fixture_log"
  cat "$fixture_log.fixture-stdout" >> "$fixture_log" 2>/dev/null || true

  stop_fixture
  rm -f "${group_dir}/${CORRUPT_MARKER_FILE_NAME}"

  local expect_ok="true"
  if [ "$corrupt" = "1" ]; then
    expect_ok="false"
  fi

  if assert_tracer "$fixture_log" "$expect_ok"; then
    echo "PASS: tracer (corrupt=$corrupt, expect ok=$expect_ok) -- see $fixture_log"
    exit 0
  else
    echo "FAIL: tracer (corrupt=$corrupt, expect ok=$expect_ok) -- see $fixture_log" >&2
    exit 1
  fi
}

# RECEIVER-SIDE assertion: crates/rp-fixture's OWN /assert/finish log line, from its OWN stdout,
# never the extension's own PVFILL log alone (this plan's own must_haves.truths).
assert_tracer() {
  local target="$1" expect_ok="$2"
  if ! require_nonempty_file "$target" "e43 tracer"; then
    return 1
  fi
  if ! grep -qE "RPFIXTURE\|route=/assert/finish rp_id=localhost ok=${expect_ok} " "$target"; then
    echo "FAIL: tracer -- crates/rp-fixture's own /assert/finish never reported ok=${expect_ok} for rp_id=localhost in $target" >&2
    return 1
  fi
  return 0
}

main() {
  case "${1:-}" in
    tracer)
      shift
      if [ "${1:-}" = "--assert-only" ]; then
        shift
        assert_only_path="${1:-}"
        shift || true
        if [ "${1:-}" != "--expect-ok" ] || [ -z "${2:-}" ]; then
          echo "ERROR: --assert-only <path> requires --expect-ok <true|false>" >&2
          exit 1
        fi
        if assert_tracer "$assert_only_path" "$2"; then exit 0; else exit 1; fi
      fi
      corrupt=0
      if [ "${1:-}" = "--corrupt-signature" ]; then
        corrupt=1
        shift
      fi
      cmd_tracer "$corrupt"
      ;;
    *) usage ;;
  esac
}

main "$@"
