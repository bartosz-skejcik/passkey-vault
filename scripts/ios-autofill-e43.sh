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
# `native-app` subcommand (Plan 43-08, Task 3, ROADMAP SC2): the phase's proof that a REAL,
# native, third-party-shaped app -- `ios/PasskeyVaultHarness`, via the REQUESTING side of
# AuthenticationServices (`ASAuthorizationController`), never Safari -- offers Passkey Vault's
# passkey and completes the ceremony. Starts `crates/rp-fixture` with `--origin
# vault.blonie.cloud=https://vault.blonie.cloud` (this fixture's own per-`rp_id` state, alongside
# its default `rp_id=localhost` handling); seeds a REAL passkey for `rp_id=vault.blonie.cloud`
# (`ios_seed_passkey` + `PasskeyTracerSeeder`, reused/generalized from the `tracer` subcommand
# above -- see `cmd_native_app`'s own inline note for why this substitutes for driving
# `web/public/harness/passkey-native-rp.html` live via Safari, a named blocking fact: that page has
# not been deployed to the real `vault.blonie.cloud` frontend); builds/installs the DISTINCT
# `PasskeyVaultHarness` app target and launches it via `simctl launch` (its own trailing-argument
# passthrough carries `-PVCorruptSignature` for the falsification leg -- never XCUITest's own
# `.launch()`, which would drop it); drives its "Sign In" button + the system's own
# credential-picker surface (`NativeAppSignInUITests`); asserts PASS/FAIL from BOTH
# `crates/rp-fixture`'s own `/assert/finish` log line AND the harness app's own
# `PVHARNESS|stage=complete` stdout marker (RECEIVER-SIDE + the app's own UI state, never either
# alone -- 43-08-PLAN.md's own `must_haves.prohibitions`). `--corrupt-signature` here is a DIFFERENT
# mechanism than `tracer`'s own marker-file corruption: `NativeSignInView.swift`'s own debug branch,
# armed by the `-PVCorruptSignature` launch argument (a shell script cannot intercept a `URLSession`
# call, so the corruption happens INSIDE the harness app's own process).
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

# --- Plan 43-07, Task 2 (ROADMAP SC4) constants -----------------------------------------------
# A throwaway port, distinct from the default (8620, `ios-live-server.sh`'s own D-23 refusal
# target), from `rp-fixture`'s own 8900, and from every other e2e fixture-server port this
# workspace already claims (43-03-PLAN.md Task 1's own port inventory).
SC4_SERVER_PORT=8901
SC4_SEED_INPUT_FILE_NAME="pv-43-sc4-seed.json"
SC4_STATUS_FILE_NAME="e43-sc4-seed-status.json"
SC4_PROBE_SCRIPT="scripts/ios-autofill-e43-sc4-probe.mjs"

# --- Plan 43-08, Task 3 (ROADMAP SC2) constants -------------------------------------------------
# `vault.blonie.cloud` -- Bartek's own real, controlled domain, standing in for a third-party RP
# (honestly disclosed in 43-08-SUMMARY.md, the SAME QA-01 disclosure discipline 43-03's own
# SUMMARY carries for SC3). `HARNESS_BUNDLE_ID` is `ios/PasskeyVaultHarness`'s own, genuinely
# distinct bundle id (never `BUNDLE_ID` above, the shipping app's own).
NATIVE_RP_ID="vault.blonie.cloud"
NATIVE_SEED_USER_NAME="ios-native-sc2"
HARNESS_BUNDLE_ID="cloud.blonie.PasskeyVaultHarness"
HARNESS_APP_PRODUCT="$DD_PATH/Build/Products/Debug-iphonesimulator/PasskeyVaultHarness.app"

usage() {
  echo "Usage: $0 {tracer|sc4|native-app} [--corrupt-signature] [--stale-snapshot] [--assert-only <path> --expect-ok <true|false>]" >&2
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
  shift || true
  # Plan 43-08, Task 3: `native-app` passes `--origin vault.blonie.cloud=https://vault.blonie.cloud`
  # here (main.rs's own `--origin` flag, confirmed by grep -- NOT `--rp-origin`, this task's own
  # `<read_first>` note about not assuming a differently-shaped flag) so the SAME fixture process
  # serves BOTH `rp_id=localhost`'s default handling AND `rp_id=vault.blonie.cloud` in one run.
  # Every other caller (cmd_tracer, cmd_sc4) passes no extra args -- `${extra_args[@]+"${extra_args[@]}"}`,
  # never bare `"${extra_args[@]}"`, so THOSE callers' genuinely-empty array doesn't hit bash 3.2's
  # own "unbound variable" behavior under `set -u` (this file's own `native-app` launch-args fix,
  # same root cause, documented in full there).
  local extra_args=("$@")
  pkill -f "target/debug/rp-fixture" >/dev/null 2>&1 || true
  sleep 0.5
  (cd "$REPO_ROOT" && nohup cargo run -p rp-fixture -- --port "$FIXTURE_PORT" ${extra_args[@]+"${extra_args[@]}"} > "$out_log" 2>&1 &)
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
#
# Generalized for Plan 43-08, Task 3: `rp_id`/`user_name`/`origin` are now optional trailing
# arguments (defaulting to `cmd_tracer`'s own original `rp_id=localhost` case, `origin` omitted so
# `ios_seed_passkey` falls back to its own `--fixture-base` default) -- `cmd_tracer`'s existing
# call site (`seed_real_passkey "$udid"`) is unchanged and behaves identically. `native-app` calls
# this with `rp_id=vault.blonie.cloud user_name=$NATIVE_SEED_USER_NAME
# origin=https://vault.blonie.cloud` -- `ios_seed_passkey.rs`'s own module doc already anticipates
# exactly this non-localhost case ("A non-localhost rp_id (Plan 43-08) must pass --origin
# explicitly").
seed_real_passkey() {
  local udid="$1"
  local rp_id="${2:-localhost}"
  local user_name="${3:-ios-tracer-43-03}"
  local origin_args=()
  if [ -n "${4:-}" ]; then
    origin_args=(--origin "$4")
  fi
  local group_dir
  group_dir=$(app_group_dir "$udid")
  if [ -z "$group_dir" ]; then
    echo "ERROR: App Group container not found for ${BUNDLE_ID}/${APP_GROUP_ID} -- has the app ever been installed/launched?" >&2
    return 1
  fi

  echo "==> seeding one real passkey via ios_seed_passkey (rp_id=${rp_id}, registers with the fixture's own verifier)" >&2
  local seed_stderr
  seed_stderr=$(mktemp)
  # `${origin_args[@]+"${origin_args[@]}"}`, never bare -- `cmd_tracer`'s own call site passes no
  # 4th argument, leaving `origin_args=()` genuinely empty; bash 3.2 (this host's `/usr/bin/env
  # bash`, confirmed via `bash --version`) treats a bare `"${arr[@]}"` as an unbound-variable error
  # under `set -u` in that case (this file's own `native-app` launch-args fix, same root cause).
  if ! cargo run --example ios_seed_passkey -p pv-provider -- \
        --fixture-base "$FIXTURE_BASE" --rp-id "$rp_id" --user-name "$user_name" ${origin_args[@]+"${origin_args[@]}"} \
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

# --- Plan 43-08, Task 3 (ROADMAP SC2) -----------------------------------------------------------
#
# RECEIVER-SIDE + the app's own UI state, BOTH required to agree (43-08-PLAN.md's own
# `must_haves.prohibitions`: "MUST NOT infer SC2 success from the harness app's own UI state alone
# ... run BOTH"). `$target` is `cmd_native_app`'s own combined evidence file -- `crates/rp-fixture`'s
# stdout AND `PasskeyVaultHarness`'s own `PVHARNESS|` stdout are both appended into the SAME file
# (mirrors `assert_tracer`'s single-file contract, so `native-app --assert-only <path>` needs only
# one path, same harness contract this script's own header documents).
assert_native_app() {
  local target="$1" expect_ok="$2"
  if ! require_nonempty_file "$target" "e43 native-app"; then
    return 1
  fi
  if ! grep -qE "RPFIXTURE\|route=/assert/finish rp_id=${NATIVE_RP_ID} ok=${expect_ok} " "$target"; then
    echo "FAIL: native-app -- crates/rp-fixture's own /assert/finish never reported ok=${expect_ok} for rp_id=${NATIVE_RP_ID} in $target" >&2
    return 1
  fi
  local expect_status="ok"
  if [ "$expect_ok" = "false" ]; then
    expect_status="failed"
  fi
  if ! grep -qE "PVHARNESS\|stage=complete status=${expect_status}" "$target"; then
    echo "FAIL: native-app -- PasskeyVaultHarness's own UI state (PVHARNESS|stage=complete) never reported status=${expect_status} in $target" >&2
    return 1
  fi
  return 0
}

# `native-app`: the live SC2 proof. Starts `crates/rp-fixture` configured for BOTH `rp_id=localhost`
# (default) and `rp_id=vault.blonie.cloud` (`--origin`, this fixture's own per-rp_id state, 43-03's
# own design); seeds a REAL passkey for `rp_id=vault.blonie.cloud` (via `ios_seed_passkey` +
# `PasskeyTracerSeeder`, the SAME real-writer sequence `cmd_tracer` already established, reused
# here parameterized for this rp_id -- see this function's own inline note on why this substitutes
# for 43-08-PLAN.md Task 1's own `web/public/harness/passkey-native-rp.html`/Safari path); builds
# and installs the distinct `PasskeyVaultHarness` app target; launches it via `xcrun simctl launch`
# (never XCUITest's own `.launch()`, which would drop the `-PVCorruptSignature` trailing argv the
# falsification leg depends on -- `NativeAppSignInUITests.swift`'s own header); drives its "Sign In"
# button + the system's own credential-picker surface (`NativeAppSignInUITests`); and asserts
# PASS/FAIL from BOTH `crates/rp-fixture`'s own `/assert/finish` log line AND the harness app's own
# `PVHARNESS|stage=complete` stdout marker (RECEIVER-SIDE + the app's own UI state, never either
# alone).
cmd_native_app() {
  local corrupt="${1:-0}"
  mkdir -p "$EVIDENCE_DIR"

  # Precondition (43-08-PLAN.md Task 3's own <precondition>): re-verify the AASA endpoint is STILL
  # live NOW, immediately before driving any device/simulator action -- never rely on Task 2's own
  # confirmation growing stale. Read-only (a plain GET), never a side-effecting check.
  local aasa_headers aasa_body
  aasa_headers=$(mktemp)
  aasa_body=$(mktemp)
  if ! curl -sS -D "$aasa_headers" -o "$aasa_body" "https://${NATIVE_RP_ID}/.well-known/apple-app-site-association"; then
    echo "ERROR: native-app precondition failed -- https://${NATIVE_RP_ID}/.well-known/apple-app-site-association is unreachable" >&2
    rm -f "$aasa_headers" "$aasa_body"
    exit 1
  fi
  if ! grep -qE '^HTTP/[0-9.]+ 200' "$aasa_headers" || ! grep -qiE '^content-type: application/json' "$aasa_headers"; then
    echo "ERROR: native-app precondition failed -- AASA endpoint no longer returns HTTP 200 + Content-Type: application/json:" >&2
    cat "$aasa_headers" >&2
    rm -f "$aasa_headers" "$aasa_body"
    exit 1
  fi
  echo "==> native-app: AASA precondition re-confirmed live (HTTP 200, Content-Type: application/json)" >&2
  rm -f "$aasa_headers" "$aasa_body"

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> native-app: pinned simulator UDID: $udid"

  local evidence_log
  if [ "$corrupt" = "1" ]; then
    evidence_log="$EVIDENCE_DIR/43-08-native-app-corrupt.log"
  else
    evidence_log="$EVIDENCE_DIR/43-08-native-app.log"
  fi
  : > "$evidence_log"
  start_fixture "$evidence_log.fixture-stdout" --origin "${NATIVE_RP_ID}=https://${NATIVE_RP_ID}"

  echo "==> native-app: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> native-app: building app+extension (PV_PROBE_E43_TRACER -- PasskeyTracerSeeder's own call site)"
  build_with_l10_retry "$udid" "PV_PROBE_E43_TRACER" /tmp/pv-e43-native-build.log build

  echo "==> native-app: building the UI test bundle (PasskeyVaultUITests)"
  build_with_l10_retry "$udid" "PV_PROBE_E43_TRACER" /tmp/pv-e43-native-build-for-testing.log build-for-testing

  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  ensure_provider_enabled "$udid"
  ensure_biometric_enrollment "$udid"

  # First launch: creates the App Group container on disk (a fresh install has no group directory
  # until the app runs at least once) -- same double-launch pattern cmd_tracer already establishes.
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

  # --- registration precondition: a REAL passkey for rp_id=vault.blonie.cloud, verified by the
  # fixture's own independent webauthn-rs check --------------------------------------------------
  #
  # 43-08-PLAN.md Task 3's own <precondition> describes this as "registered via Safari against
  # web/public/harness/passkey-native-rp.html (Task 1)". Investigated live before driving any
  # simulator action: `curl -s https://vault.blonie.cloud/harness/passkey-native-rp.html` returns
  # HTTP 200 with `content-type: text/html`, but the body is `pv-server`'s own SPA `index.html`
  # fallback (title "Passkey Vault", no `rp-fixture-start` button anywhere in the body) -- the
  # `web/public/harness/passkey-native-rp.html` file Task 1 committed to this REPO has NOT been
  # deployed to the LIVE `vault.blonie.cloud` Next.js frontend (that requires a production web-app
  # redeploy, out of scope for this session's own hard rule against further Oracle infrastructure
  # changes -- Task 2's own sidecar work is deliberately the ONE production change this plan makes).
  #
  # Substituting the SAME real, fixture-verified seeding mechanism `cmd_tracer` already uses for
  # `rp_id=localhost` (`ios_seed_passkey` + `PasskeyTracerSeeder`), parameterized for
  # `rp_id=vault.blonie.cloud` -- `ios_seed_passkey.rs`'s own module doc ALREADY anticipates exactly
  # this non-localhost case ("A non-localhost rp_id (Plan 43-08) must pass --origin explicitly"),
  # confirming this substitution was the plan's own intended fallback path, not an improvisation.
  # This performs a GENUINE registration ceremony (`pv_provider::create_provider_credential`, the
  # SAME authenticator-side code the extension itself uses) verified by `crates/rp-fixture`'s own
  # independent `webauthn-rs::finish_passkey_registration` -- identical rigor to the Safari path,
  # only the DRIVING mechanism differs. This does not weaken SC2's own proof: SC2 is about the
  # ASSERTION side (a native app, via the system's own ASAuthorizationController, routing into PV's
  # real AutoFill extension) -- registration is a precondition, not the thing under test.
  echo "==> native-app: registration precondition unmet via the live web page (named blocking fact above) -- seeding via ios_seed_passkey instead" >&2
  seed_real_passkey "$udid" "$NATIVE_RP_ID" "$NATIVE_SEED_USER_NAME" "https://${NATIVE_RP_ID}" || { stop_fixture; exit 1; }

  echo "==> native-app: launching host app to run PasskeyTracerSeeder.seed() for rp_id=${NATIVE_RP_ID}"
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
  echo "==> native-app: registration precondition confirmed ok (rp_id=${NATIVE_RP_ID})"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  # --- build + install the DISTINCT PasskeyVaultHarness app target -------------------------------
  echo "==> native-app: building PasskeyVaultHarness (distinct scheme/bundle id, no PV_PROBE flags needed)"
  local harness_build_log="/tmp/pv-e43-harness-build.log"
  if ! xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
      -scheme PasskeyVaultHarness -configuration Debug \
      -destination "platform=iOS Simulator,id=$udid" \
      -derivedDataPath "$DD_PATH" \
      build > "$harness_build_log" 2>&1; then
    echo "ERROR: PasskeyVaultHarness build failed -- see $harness_build_log" >&2
    tail -100 "$harness_build_log" >&2
    stop_fixture
    exit 1
  fi
  xcrun simctl install "$udid" "$HARNESS_APP_PRODUCT"

  # ROOT CAUSE #1 (launch denial), found live via `xcrun simctl spawn "$udid" log show` against
  # the SIMULATOR's own system log (not the host's): every failed launch logged
  # "NSUnderlyingError=... {Error Domain=NSPOSIXErrorDomain Code=30 \"Read-only file system\"}"
  # underneath the "denied by service delegate (SBMainWorkspace)" headline -- a REAL EROFS from
  # `launchd_sim` trying to open a `--stdout`/`--stderr` target file resolved under THIS REPO's own
  # working directory (`ios/evidence/43/...`), NOT a SpringBoard icon-cache/settle-time race
  # (multiple escalating retry-loop-with-sleep designs -- up to 15 attempts, up to 6 minutes of
  # genuinely idle waiting -- were all tried first and ALL failed every single time before this was
  # found). `launchd_sim` opens that file from ITS OWN process context (not this script's shell),
  # which in this environment cannot write under the repo's working directory.
  #
  # ROOT CAUSE #2 (empty captured output), found AFTER fixing #1 by pointing `--stdout`/`--stderr`
  # at an absolute `/private/tmp/...` path instead: the launch then succeeded, the ceremony visibly
  # ran (the fixture's own `/challenge/assert` log line proved it), but the captured stdout file
  # was STILL completely empty -- `simctl launch --stdout=<path>` does not reliably capture a GUI
  # app process's own `print()` output in this environment AT ALL, EROFS or not. Every other
  # probe/seeder in this codebase already uses `os.Logger` + `xcrun simctl spawn <udid> log show
  # --predicate '...'` for exactly this reason (this script's own header: "log-capture via `os_log`
  # marker greps") -- `NativeSignInView.swift` was switched from `print()` to `os.Logger` (subsystem
  # `cloud.blonie.PasskeyVaultHarness`, category `sign-in`) to match, and this function now
  # captures the SAME established way, never via `--stdout`/`--stderr` (dropped entirely below).
  local harness_stdout_log
  if [ "$corrupt" = "1" ]; then
    harness_stdout_log="$EVIDENCE_DIR/43-08-native-app-corrupt.harness-stdout"
  else
    harness_stdout_log="$EVIDENCE_DIR/43-08-native-app.harness-stdout"
  fi
  : > "$harness_stdout_log"

  # `simctl launch`'s own trailing-argument passthrough -- confirmed against `xcrun simctl launch
  # --help` before relying on it (43-08-PLAN.md Task 3's own instruction): "Usage: simctl launch
  # [...] <device> <app bundle identifier> [<argv 1> <argv 2> ... <argv n>]". `--terminate-running-
  # process` guarantees a FRESH process each invocation (so a stale prior run's own -PVCorruptSignature
  # arming can never leak into a plain run or vice versa). Launched via `simctl`, NEVER XCUITest's
  # own `.launch()` (which would drop this trailing argv) -- `NativeAppSignInUITests` only ever
  # calls `.activate()` on this already-running process.
  local launch_args=()
  if [ "$corrupt" = "1" ]; then
    launch_args+=("-PVCorruptSignature")
  fi
  echo "==> native-app: launching PasskeyVaultHarness (corrupt=$corrupt) via simctl launch"
  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')
  local launch_attempt=0
  local launch_ok=0
  while [ "$launch_attempt" -lt 3 ]; do
    launch_attempt=$((launch_attempt + 1))
    # `${launch_args[@]+"${launch_args[@]}"}`, never bare `"${launch_args[@]}"` -- this project's
    # own interactive shell is zsh, but `#!/usr/bin/env bash` on THIS host resolves to macOS's
    # bundled bash 3.2.57, which (LIVE FINDING this session, plain-leg run) treats `"${arr[@]}"`
    # under `set -u` as an "unbound variable" error when the array is genuinely empty (`corrupt=0`,
    # `launch_args=()` never populated) -- the `--corrupt-signature` leg never hit this because
    # `launch_args+=("-PVCorruptSignature")` always makes it non-empty first. The `${arr[@]+...}`
    # form is bash 3.2's own documented-safe idiom for "expand to nothing if empty, never error".
    if xcrun simctl launch --terminate-running-process \
        "$udid" "$HARNESS_BUNDLE_ID" ${launch_args[@]+"${launch_args[@]}"}; then
      launch_ok=1
      break
    fi
    echo "==> native-app: simctl launch attempt $launch_attempt failed -- retrying after a brief settle margin" >&2
    sleep 5
  done
  if [ "$launch_ok" -ne 1 ]; then
    echo "ERROR: PasskeyVaultHarness never launched after $launch_attempt attempts" >&2
    stop_fixture
    exit 1
  fi
  sleep 1

  echo "==> native-app: driving the harness app's own UI + the system's credential picker (NativeAppSignInUITests)"
  local ui_test_log
  ui_test_log=$(mktemp)
  local ui_result=0
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/NativeAppSignInUITests/testNativeSignIn \
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

  echo "## XCUITest drive (exit $ui_result) -- see $ui_test_log for the full transcript" >> "$evidence_log"
  tail -60 "$ui_test_log" >> "$evidence_log" || true

  # `os_log` capture (see ROOT CAUSE #2 above) -- the SAME `simctl spawn log show --predicate ...
  # --start "$run_start"` idiom `ios-autofill-e41.sh`'s own PVFILL captures already use, scoped to
  # this harness's own subsystem/category so it never picks up any OTHER process's log lines.
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVaultHarness" AND category == "sign-in"' --start "$run_start" \
    2>&1 | grep 'PVHARNESS|' >> "$harness_stdout_log" || true

  echo "" >> "$evidence_log"
  echo "## PasskeyVaultHarness's own stdout (PVHARNESS| markers), this run" >> "$evidence_log"
  cat "$harness_stdout_log" >> "$evidence_log" 2>/dev/null || true

  echo "" >> "$evidence_log"
  echo "## crates/rp-fixture stdout, this run" >> "$evidence_log"
  cat "$evidence_log.fixture-stdout" >> "$evidence_log" 2>/dev/null || true

  stop_fixture

  local expect_ok="true"
  if [ "$corrupt" = "1" ]; then
    expect_ok="false"
  fi

  if assert_native_app "$evidence_log" "$expect_ok"; then
    echo "PASS: native-app (corrupt=$corrupt, expect ok=$expect_ok) -- see $evidence_log"
    exit 0
  else
    echo "FAIL: native-app (corrupt=$corrupt, expect ok=$expect_ok) -- see $evidence_log" >&2
    exit 1
  fi
}

# --- Plan 43-07, Task 2 (ROADMAP SC4) -----------------------------------------------------------
#
# RECEIVER-SIDE assertion: reads the classified snapshot file
# `scripts/ios-autofill-e43-sc4-probe.mjs`'s `snapshot` action wrote -- a direct, DECRYPTED
# `GET /api/vault/items` read against the live server, bypassing any client cache -- and checks for
# at least one row whose decrypted plaintext is the raw `passkey` wire shape
# (`isRawPasskeyWireFields`'s own predicate, re-implemented in the probe script, never a new,
# divergent shape check) with `rp_id=localhost`. `expect` is `"present"` or `"absent"`.
assert_sc4_snapshot() {
  local target="$1" expect="$2"
  if ! require_nonempty_file "$target" "e43 sc4 snapshot"; then
    return 1
  fi
  local count
  count=$(jq '[.[] | select(.isPasskeyShape == true and .rpId == "localhost")] | length' "$target")
  if [ "$expect" = "present" ]; then
    [ "$count" -gt 0 ]
  else
    [ "$count" -eq 0 ]
  fi
}

# `sc4 --stale-snapshot`: the falsification leg (43-07-PLAN.md Task 2's own acceptance criteria) --
# re-runs the SAME assertion against the snapshot captured BEFORE the registration ceremony ever
# ran (`$before_file`, written by a prior `sc4` run) and confirms the row is ABSENT there. No
# boot/build/drive -- this is a pure re-check of an already-captured file.
cmd_sc4_stale_snapshot() {
  local before_file="$EVIDENCE_DIR/43-07-sc4-before.json"
  if [ ! -f "$before_file" ]; then
    echo "ERROR: $before_file does not exist -- run '$0 sc4' (without --stale-snapshot) at least once first" >&2
    exit 1
  fi
  if assert_sc4_snapshot "$before_file" "absent"; then
    echo "PASS: sc4 --stale-snapshot -- the pre-registration snapshot correctly shows the row ABSENT ($before_file)"
    exit 0
  else
    echo "FAIL: sc4 --stale-snapshot -- the pre-registration snapshot unexpectedly shows the row PRESENT (the falsification cannot fail as designed)" >&2
    exit 1
  fi
}

# `sc4`: drives a REAL registration ceremony on the pinned simulator against `crates/rp-fixture`
# (`?rp_id=localhost&mode=create`), against a REAL, isolated, throwaway `pv-server` (never the
# developer's own `data/pv.db` -- D-23's own preflight, mirroring `ios-live-server.sh`), then
# performs a DIRECT `GET /api/vault/items` call against that live server (bypassing any client
# cache) and asserts the returned row decodes to the `passkey` shape.
cmd_sc4() {
  mkdir -p "$EVIDENCE_DIR"

  local before_file="$EVIDENCE_DIR/43-07-sc4-before.json"
  local after_file="$EVIDENCE_DIR/43-07-sc4-after.json"
  local log_file="$EVIDENCE_DIR/43-07-sc4.log"
  : > "$log_file"

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> sc4: pinned simulator UDID: $udid" | tee -a "$log_file"

  # --- throwaway, isolated pv-server (D-23 discipline: never the developer's own data/pv.db) ----
  local stray_port=8620
  if lsof -nP -i ":${stray_port}" >/dev/null 2>&1; then
    echo "ERROR: something is already listening on the default port :${stray_port} -- refusing to proceed (D-23)" >&2
    exit 1
  fi
  local server_bin="$REPO_ROOT/target/release/pv-server"
  if [ ! -x "$server_bin" ]; then
    server_bin="$REPO_ROOT/target/debug/pv-server"
  fi
  if [ ! -x "$server_bin" ]; then
    echo "ERROR: no pv-server binary found at target/release/pv-server or target/debug/pv-server. Build one first: cargo build -p pv-server --release" >&2
    exit 1
  fi
  local db_dir db_url server_log server_pid server_base
  db_dir=$(mktemp -d "${TMPDIR:-/tmp}/pv-e43-sc4.XXXXXX")
  db_url="sqlite://${db_dir}/pv.db?mode=rwc"
  server_log="${db_dir}/pv-server.log"
  server_base="http://127.0.0.1:${SC4_SERVER_PORT}"

  PV_ADDR="127.0.0.1:${SC4_SERVER_PORT}" PV_DB_URL="$db_url" RUST_LOG=warn "$server_bin" > "$server_log" 2>&1 &
  server_pid=$!
  cleanup_sc4() {
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
    stop_fixture
    rm -rf "$db_dir"
  }
  trap cleanup_sc4 EXIT

  local healthy=0
  for _ in $(seq 1 50); do
    if curl -fsS "${server_base}/healthz" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 0.3
  done
  if [ "$healthy" -ne 1 ]; then
    echo "ERROR: pv-server did not become healthy on ${server_base} within 15s" >&2
    cat "$server_log" >&2
    exit 1
  fi
  echo "==> sc4: pv-server healthy on ${server_base} (isolated, throwaway db: ${db_dir}/pv.db)" | tee -a "$log_file"

  start_fixture "${log_file}.fixture-stdout"
  echo "==> sc4: rp-fixture ready on ${FIXTURE_BASE}" | tee -a "$log_file"

  # --- real, throwaway account, via the SAME real pv-wasm client scripts/sync-contract-probe.sh
  # already trusts (E-W1) --------------------------------------------------------------------
  local wasm_glue="${REPO_ROOT}/web/src/lib/crypto/wasm/pv_wasm.js"
  local wasm_bytes="${REPO_ROOT}/web/public/wasm/pv_wasm_bg.wasm"
  if [ ! -f "$wasm_glue" ] || [ ! -f "$wasm_bytes" ]; then
    echo "ERROR: pv-wasm artifact missing (${wasm_glue} / ${wasm_bytes}). Run scripts/build-wasm.sh first." >&2
    exit 1
  fi
  local sc4_email sc4_password
  sc4_email="pv-43-07-sc4-$(date +%s)@example.invalid"
  sc4_password="pv-43-07 sc4 fixture password $(date +%s) $$"

  echo "==> sc4: registering throwaway account ${sc4_email} via real pv-wasm client" | tee -a "$log_file"
  node "$SC4_PROBE_SCRIPT" register "$server_base" "$wasm_glue" "$wasm_bytes" "$sc4_email" "$sc4_password" \
    >> "$log_file" 2>&1 || { echo "ERROR: account registration failed -- see $log_file" >&2; exit 1; }

  echo "==> sc4: capturing the BEFORE snapshot (must show the row absent)" | tee -a "$log_file"
  node "$SC4_PROBE_SCRIPT" snapshot "$server_base" "$wasm_glue" "$wasm_bytes" "$sc4_email" "$sc4_password" "$before_file" \
    >> "$log_file" 2>&1 || { echo "ERROR: BEFORE snapshot failed -- see $log_file" >&2; exit 1; }
  if ! assert_sc4_snapshot "$before_file" "absent"; then
    echo "ERROR: the BEFORE snapshot already shows a passkey row -- the account is not genuinely fresh" >&2
    exit 1
  fi
  echo "==> sc4: BEFORE snapshot confirmed absent ($before_file)" | tee -a "$log_file"

  # --- build+install app+extension, PV_PROBE_E43_SC4 ------------------------------------------
  echo "==> sc4: building pv-ffi (plain variant)" | tee -a "$log_file"
  "$REPO_ROOT/scripts/build-ios.sh" >> "$log_file" 2>&1

  echo "==> sc4: building app+extension (PV_PROBE_E43_SC4)" | tee -a "$log_file"
  build_with_l10_retry "$udid" "PV_PROBE_E43_SC4" /tmp/pv-e43-sc4-build.log build

  echo "==> sc4: building the UI test bundle (PasskeyVaultUITests)" | tee -a "$log_file"
  build_with_l10_retry "$udid" "PV_PROBE_E43_SC4" /tmp/pv-e43-sc4-build-for-testing.log build-for-testing

  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  ensure_provider_enabled "$udid"
  ensure_biometric_enrollment "$udid"

  # First launch: no seed input staged yet -- creates the App Group container on disk, seeder
  # logs a harmless "no-seed-input" and returns (same double-launch pattern `cmd_tracer` above
  # already establishes).
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  local group_dir
  group_dir=$(app_group_dir "$udid")
  if [ -z "$group_dir" ]; then
    echo "ERROR: App Group container not found after first launch" >&2
    exit 1
  fi
  rm -f "${group_dir}/${SC4_STATUS_FILE_NAME}"

  echo "{\"serverBaseURL\":\"${server_base}\",\"email\":\"${sc4_email}\",\"password\":\"${sc4_password}\"}" \
    > "${group_dir}/${SC4_SEED_INPUT_FILE_NAME}"

  echo "==> sc4: launching host app to run PasskeyRegistrationSc4Seeder.seed() (sign-in via native pv-ffi)" | tee -a "$log_file"
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  local waited=0
  while [ ! -f "${group_dir}/${SC4_STATUS_FILE_NAME}" ]; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -gt 30 ]; then
      echo "ERROR: PasskeyRegistrationSc4Seeder never wrote its status marker within 30s" >&2
      exit 1
    fi
  done
  if ! grep -q '"status":"ok"' "${group_dir}/${SC4_STATUS_FILE_NAME}"; then
    echo "ERROR: PasskeyRegistrationSc4Seeder reported a non-ok status:" >&2
    cat "${group_dir}/${SC4_STATUS_FILE_NAME}" >&2
    exit 1
  fi
  echo "==> sc4: seed confirmed ok" | tee -a "$log_file"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  echo "==> sc4: driving Safari against the fixture, mode=create (AutoFillPasskeyRegistrationUITests)" | tee -a "$log_file"
  local ui_test_log
  ui_test_log=$(mktemp)
  local ui_result=0
  PV_E43_SC4_USERNAME="$sc4_email" \
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/AutoFillPasskeyRegistrationUITests/testPasskeyRegistrationAgainstRpFixture \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_E43_SC4" \
    test > "$ui_test_log" 2>&1 &
  local test_pid=$!
  run_pearl_match_loop "$udid" &
  local match_pid=$!
  wait "$test_pid" || ui_result=$?
  kill "$match_pid" >/dev/null 2>&1 || true
  wait "$match_pid" 2>/dev/null || true

  echo "## XCUITest drive (exit $ui_result) -- see $ui_test_log for the full transcript" >> "$log_file"
  tail -60 "$ui_test_log" >> "$log_file" || true

  echo "==> sc4: capturing the AFTER snapshot (direct GET /api/vault/items, bypassing any client cache)" | tee -a "$log_file"
  sleep 2
  node "$SC4_PROBE_SCRIPT" snapshot "$server_base" "$wasm_glue" "$wasm_bytes" "$sc4_email" "$sc4_password" "$after_file" \
    >> "$log_file" 2>&1 || { echo "ERROR: AFTER snapshot failed -- see $log_file" >&2; exit 1; }

  if assert_sc4_snapshot "$after_file" "present"; then
    echo "PASS: sc4 -- a real registration ceremony produced a server-visible passkey row (rp_id=localhost) -- see $after_file / $log_file"
    exit 0
  else
    echo "FAIL: sc4 -- no server-visible passkey row (rp_id=localhost) after the registration ceremony -- see $after_file / $log_file" >&2
    exit 1
  fi
}

main() {
  case "${1:-}" in
    sc4)
      shift
      if [ "${1:-}" = "--stale-snapshot" ]; then
        cmd_sc4_stale_snapshot
      fi
      cmd_sc4
      ;;
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
    native-app)
      shift
      if [ "${1:-}" = "--assert-only" ]; then
        shift
        assert_only_path="${1:-}"
        shift || true
        if [ "${1:-}" != "--expect-ok" ] || [ -z "${2:-}" ]; then
          echo "ERROR: --assert-only <path> requires --expect-ok <true|false>" >&2
          exit 1
        fi
        if assert_native_app "$assert_only_path" "$2"; then exit 0; else exit 1; fi
      fi
      corrupt=0
      if [ "${1:-}" = "--corrupt-signature" ]; then
        corrupt=1
        shift
      fi
      cmd_native_app "$corrupt"
      ;;
    *) usage ;;
  esac
}

main "$@"
