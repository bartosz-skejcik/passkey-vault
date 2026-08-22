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
APP_GROUP_ID="group.cloud.blonie.PasskeyVault"
# Plan 44-05, Task 2: a distinct port from `ios-autofill-e43.sh`'s own `SC4_SERVER_PORT` (8901) --
# both scripts can run in the same session without colliding.
SC_GENERATE_SERVER_PORT=8902
# Plan 44-04, Task 3: a distinct port again from BOTH SC4_SERVER_PORT (8901) and
# SC_GENERATE_SERVER_PORT (8902) -- all three throwaway-server scripts can run in the same session
# without colliding.
SC_SAVE_SERVER_PORT=8903
# Plan 44-06, Task 2: a distinct port again from all three above.
SC_INSERT_SERVER_PORT=8904
# Reused, never duplicated -- `scripts/ios-autofill-e43-sc4-probe.mjs`'s own `find-login` action
# (added by this plan) is the SAME real `pv-wasm` client `sc4`/`sc-generate`'s own receiver-side
# proofs already trust (the E-W1 precedent).
SC4_PROBE_SCRIPT="scripts/ios-autofill-e43-sc4-probe.mjs"

usage() {
  echo "Usage: $0 probe [--run2] [--assert-only <path> [--run2]]" >&2
  echo "       $0 sc-generate [--skip-red-control]" >&2
  echo "       $0 sc-save [--skip-red-control]" >&2
  echo "       $0 sc-insert [--skip-red-control]" >&2
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
  # Optional 5th arg (Plan 44-05 Task 2): extra `SWIFT_ACTIVE_COMPILATION_CONDITIONS`, mirroring
  # `ios-autofill-e43.sh`'s own `extra_conditions` pattern -- needed to enable
  # `PasskeyRegistrationSc4Seeder`'s own call site in `PasskeyVaultApp.swift` (gated behind
  # `PV_PROBE_E43_SC4`, not `DEBUG`) so `sc-generate` can seed a genuinely unlocked session before
  # driving the harness's own generate affordance.
  local extra_conditions="${5:-}"
  local run_once
  run_once() {
    xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
      -scheme "$scheme" -configuration Debug \
      -destination "platform=iOS Simulator,id=$udid" \
      -derivedDataPath "$DD_PATH" \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) $extra_conditions" \
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

# `ios-autofill-e43.sh`'s own `app_group_dir` -- the plural `groups` form is the one that actually
# resolves the path on this toolchain (live finding, that script's own header).
app_group_dir() {
  local udid="$1"
  xcrun simctl get_app_container "$udid" "$BUNDLE_ID" groups 2>/dev/null \
    | awk -F'\t' -v g="$APP_GROUP_ID" '$1 == g { print $2 }' || true
}

# `probe`: this plan's own live experiment. `--run2` (Task 1b / checkpoint resolution): drives
# BOTH `SavePasswordFormHarnessUITests` methods (the original save/generate-silent-path drive PLUS
# the new `testDriveGeneratePasswordAffordance`), writes to a NEW evidence file
# (`44-03-probe-run2.log`), and greps for the two additional `performWithoutUserInteraction...`
# markers on top of the original two `prepareInterface(for:AS...)` markers -- run 1's own evidence
# file (`44-03-probe.log`) is never touched.
cmd_probe() {
  mkdir -p "$EVIDENCE_DIR"

  local run2=0
  if [ "${1:-}" = "--run2" ]; then
    run2=1
  fi

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

  local only_testing_args=(-only-testing:PasskeyVaultUITests/SavePasswordFormHarnessUITests/testDriveSavePasswordForm)
  local evidence_log="$EVIDENCE_DIR/44-03-probe.log"
  if [ "$run2" = "1" ]; then
    # Task 1b / checkpoint resolution: drive BOTH methods (original save/generate-silent-path
    # drive + the new generate-with-UI affordance drive), write to a NEW evidence file, never
    # touch run 1's.
    only_testing_args=(-only-testing:PasskeyVaultUITests/SavePasswordFormHarnessUITests)
    evidence_log="$EVIDENCE_DIR/44-03-probe-run2.log"
    echo "==> probe --run2: driving the harness form (BOTH SavePasswordFormHarnessUITests methods)"
  else
    echo "==> probe: driving the harness form (SavePasswordFormHarnessUITests)"
  fi

  local ui_test_log
  ui_test_log=$(mktemp)
  local ui_result=0
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    "${only_testing_args[@]}" \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    test > "$ui_test_log" 2>&1 || ui_result=$?

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

  if assert_probe "$evidence_log" "$run2"; then
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
# never called our override"). Second arg (optional, "1"): also check the two Task 1b /
# checkpoint-resolution silent-path markers.
assert_probe() {
  local target="$1"
  local run2="${2:-0}"
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
  if [ "$run2" = "1" ]; then
    if grep -q 'PVDIAG|method=performWithoutUserInteractionIfPossible(savePasswordRequest:)' "$target"; then
      echo "VERDICT: performWithoutUserInteractionIfPossible(savePasswordRequest:) FIRED -- $(grep 'PVDIAG|method=performWithoutUserInteractionIfPossible(savePasswordRequest:)' "$target" | head -1)"
    else
      echo "VERDICT: performWithoutUserInteractionIfPossible(savePasswordRequest:) DID NOT FIRE in this run"
    fi
    if grep -q 'PVDIAG|method=performWithoutUserInteraction(generatePasswordsRequest:)' "$target"; then
      echo "VERDICT: performWithoutUserInteraction(generatePasswordsRequest:) FIRED -- $(grep 'PVDIAG|method=performWithoutUserInteraction(generatePasswordsRequest:)' "$target" | head -1)"
    else
      echo "VERDICT: performWithoutUserInteraction(generatePasswordsRequest:) DID NOT FIRE in this run"
    fi
  fi
  return 0
}

# `sc-generate`: Plan 44-05, Task 2. Drives `SavePasswordFormHarnessUITests.testDriveGeneratePasswordOffer`
# (configuration X, 44-03-SUMMARY.md: tap the new-password field with no typing, then tap the
# system's own "Strong Password" QuickType affordance) -- the SILENT entry point
# (`performWithoutUserInteraction(generatePasswordsRequest:)`) is proven to fire by this same
# configuration already (44-03); this run ALSO settles, live, whether the interactive variant
# (`prepareInterface(for: ASGeneratePasswordsRequest)`) now fires, now that the silent handler
# answers with a real candidate instead of `.userCanceled` (44-03-SUMMARY.md's own open question).
# Reports BOTH outcomes honestly via `os_log` marker greps (never inferred from the UI test's own
# PASS/FAIL, which is not the load-bearing evidence -- same discipline `probe`'s own header states).
#
# If the interactive screen appears: exports its screenshot (`xcresulttool export attachments`,
# `ios-dock-evidence.sh`'s own established technique) for SAVE-04's pixel proof, and greps the
# harness's own `PVHARNESS|stage=candidate-observed` rule-compliance booleans (never the raw
# password) to confirm the offered candidate satisfies the harness's own rules descriptor.
#
# `--skip-red-control`: skip the mandatory RED-control mutation/rebuild/revert cycle (44-PLAN-CHECK.md
# W4) -- only for a quick iteration re-run; the plan's own acceptance criteria require the RED
# control to have been run and recorded at least once.
cmd_sc_generate() {
  mkdir -p "$EVIDENCE_DIR"
  local skip_red_control=0
  if [ "${1:-}" = "--skip-red-control" ]; then
    skip_red_control=1
  fi

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> sc-generate: pinned simulator UDID: $udid"

  # A locked vault refuses BEFORE ever reaching pv-ffi (this plan's own Task 1 lock-gating
  # discipline, mirroring every other entry point) -- this surface needs a genuinely unlocked
  # session to reach the dispatch logic at all, so this subcommand seeds one via
  # `PasskeyRegistrationSc4Seeder` (`ios-autofill-e43.sh`'s own real-unlock mechanism, VERBATIM,
  # never a throwaway/mock unlock), against an isolated throwaway `pv-server`.
  local server_pid="" db_dir=""
  cleanup_sc_generate() {
    if [ -n "${server_pid:-}" ]; then
      kill "$server_pid" >/dev/null 2>&1 || true
      wait "$server_pid" 2>/dev/null || true
    fi
    if [ -n "${db_dir:-}" ]; then
      rm -rf "$db_dir"
    fi
  }
  trap cleanup_sc_generate EXIT

  local stray_port="$SC_GENERATE_SERVER_PORT"
  if lsof -nP -i ":${stray_port}" >/dev/null 2>&1; then
    echo "ERROR: something is already listening on :${stray_port} -- refusing to proceed" >&2
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
  db_dir=$(mktemp -d "${TMPDIR:-/tmp}/pv-e44-05-sc-generate.XXXXXX")
  local db_url="sqlite://${db_dir}/pv.db?mode=rwc"
  local server_base="http://127.0.0.1:${SC_GENERATE_SERVER_PORT}"
  PV_ADDR="127.0.0.1:${SC_GENERATE_SERVER_PORT}" PV_DB_URL="$db_url" RUST_LOG=warn "$server_bin" > "${db_dir}/pv-server.log" 2>&1 &
  server_pid=$!
  local healthy=0
  for _ in $(seq 1 50); do
    if curl -fsS "${server_base}/healthz" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 0.3
  done
  if [ "$healthy" -ne 1 ]; then
    echo "ERROR: pv-server did not become healthy on ${server_base} within 15s" >&2
    cat "${db_dir}/pv-server.log" >&2
    exit 1
  fi
  echo "==> sc-generate: pv-server healthy on ${server_base} (isolated, throwaway db)"

  echo "==> sc-generate: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> sc-generate: building PasskeyVault app+extension (PV_PROBE_E43_SC4, for the real-unlock seeder)"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-05-build.log build "PV_PROBE_E43_SC4"

  echo "==> sc-generate: building PasskeyVaultHarness app"
  build_with_l10_retry "$udid" "PasskeyVaultHarness" /tmp/pv-e44-05-harness-build.log build

  echo "==> sc-generate: building the UI test bundle (PasskeyVaultUITests)"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-05-build-for-testing.log build-for-testing "PV_PROBE_E43_SC4"

  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  xcrun simctl install "$udid" "$HARNESS_APP_PRODUCT"
  ensure_provider_enabled "$udid"

  # First launch: creates the App Group container on disk.
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  local group_dir
  group_dir=$(app_group_dir "$udid")
  if [ -z "$group_dir" ]; then
    echo "ERROR: App Group container not found after first launch" >&2
    exit 1
  fi

  local reg_email reg_password
  reg_email="pv-e44-05-sc-generate-$(date +%s)@example.invalid"
  reg_password="pv-e44-05 sc-generate fixture password $(date +%s) $$"
  local seed_input_file="${group_dir}/pv-43-sc4-seed.json"
  local status_file="${group_dir}/e43-sc4-seed-status.json"
  rm -f "$status_file"
  echo "{\"serverBaseURL\":\"${server_base}\",\"email\":\"${reg_email}\",\"password\":\"${reg_password}\"}" \
    > "$seed_input_file"
  echo "==> sc-generate: launching host app to seed a REAL unlocked session (PasskeyRegistrationSc4Seeder, verbatim from ios-autofill-e43.sh)"
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  local waited=0
  while [ ! -f "$status_file" ]; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -gt 30 ]; then
      echo "ERROR: PasskeyRegistrationSc4Seeder never wrote its status marker within 30s" >&2
      exit 1
    fi
  done
  if ! grep -q '"status":"ok"' "$status_file"; then
    echo "ERROR: PasskeyRegistrationSc4Seeder reported a non-ok status:" >&2
    cat "$status_file" >&2
    exit 1
  fi
  echo "==> sc-generate: seed confirmed ok (real host-unlock + Secret C written)"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  xcrun simctl launch --terminate-running-process "$udid" "$HARNESS_BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 1

  local out_root="ios/PasskeyVault/build/sc-generate"
  rm -rf "$out_root"
  mkdir -p "$out_root"

  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')

  local result="$out_root/result.xcresult"
  local ui_test_log="$out_root/xcodebuild.log"
  local ui_result=0
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/SavePasswordFormHarnessUITests/testDriveGeneratePasswordOffer \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    -resultBundlePath "$result" \
    test > "$ui_test_log" 2>&1 || ui_result=$?

  echo "==> sc-generate: XCUITest drive exit $ui_result (see $ui_test_log)"

  # --- routing verdict: silent + interactive, from the EXTENSION process's own os_log ------------
  local ext_log="$out_root/extension-pvfill.log"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run_start" \
    2>&1 | grep 'PVFILL|entry=generate-' > "$ext_log" || true
  cp "$ext_log" "$EVIDENCE_DIR/44-05-sc-generate-pvfill.log"

  local silent_fired=0
  local ui_fired=0
  if grep -q 'PVFILL|entry=generate-silent stage=generate status=ok' "$ext_log"; then
    silent_fired=1
    echo "VERDICT: performWithoutUserInteraction(generatePasswordsRequest:) FIRED and answered with a real candidate -- $(grep 'PVFILL|entry=generate-silent stage=generate' "$ext_log" | head -1)"
  else
    echo "VERDICT: performWithoutUserInteraction(generatePasswordsRequest:) did NOT report a successful generate in this run"
    grep 'PVFILL|entry=generate-silent' "$ext_log" || echo "  (no generate-silent PVFILL| lines at all)"
  fi
  if grep -q 'PVFILL|entry=generate-ui stage=generate status=ok' "$ext_log"; then
    ui_fired=1
    echo "VERDICT: prepareInterface(for: ASGeneratePasswordsRequest) FIRED (the interactive variant) -- $(grep 'PVFILL|entry=generate-ui' "$ext_log" | head -1)"
  else
    echo "VERDICT: prepareInterface(for: ASGeneratePasswordsRequest) did NOT fire in this run (44-03-SUMMARY.md's open question -- reported honestly, not assumed)"
  fi

  # --- harness-side candidate compliance (rule-honouring booleans, never the raw password) --------
  local harness_log="$out_root/harness-pvharness.log"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVaultHarness"' --start "$run_start" \
    2>&1 | grep 'PVHARNESS|stage=candidate-observed' > "$harness_log" || true
  cp "$harness_log" "$EVIDENCE_DIR/44-05-sc-generate-candidate-compliance.log"
  local offer_found=0
  if [ -s "$harness_log" ]; then
    offer_found=1
    echo "== candidate compliance (rules descriptor: minlength 10-20, lower/upper/digit) =="
    cat "$harness_log"
    if grep -q 'lengthOk=false\|hasLower=false\|hasUpper=false\|hasDigit=false' "$harness_log"; then
      echo "FAIL: the offered candidate violates the harness's own rules descriptor" >&2
      exit 1
    fi
    echo "PASS: the offered candidate satisfies the harness's own rules descriptor"
  else
    echo "== no candidate-observed line -- the interactive offer screen's own candidate text was never read this run =="
  fi

  # --- SAVE-04 pixel proof ---------------------------------------------------------------------
  #
  # Live finding, this run (recorded in full in 44-05-SUMMARY.md): the interactive
  # `prepareInterface(for: ASGeneratePasswordsRequest)` variant does NOT fire under the one
  # driveable trigger this toolchain offers (the QuickType "Strong Password" affordance always
  # routes to the SILENT entry point instead). This settles 44-03-SUMMARY.md's own open question
  # as a genuine negative -- not "not yet proven" -- and the plan's own pre-authorized fallback
  # applies: a DIRECT invocation of the real, production `GeneratePasswordOfferView`
  # (`Shared/GeneratePasswordOfferView.swift`, moved there for exactly this reason) from a
  # host-side route (`GeneratePasswordOfferPreviewHost.swift`, `PasskeyVault` app target, gated
  # behind `PV_PROBE_E44_05_OFFER`) -- with the explicit "system routing unproven for this screen"
  # disclosure, never presented as if the live system path had been exercised.
  if [ "$offer_found" = "1" ]; then
    echo "==> sc-generate: interactive offer screen appeared via LIVE system routing this run -- unexpected, given the finding above. Capturing pixel proof from the live route."
    local exported="$out_root/attachments"
    xcrun xcresulttool export attachments --path "$result" --output-path "$exported" >/dev/null
    local screenshot_file
    screenshot_file="$(python3 - "$exported/manifest.json" "generate-offer-found-screenshot" <<'PY'
import json, sys
manifest_path, wanted = sys.argv[1], sys.argv[2]
with open(manifest_path) as f:
    manifest = json.load(f)
for test in manifest:
    for att in test.get("attachments", []):
        name = att.get("suggestedHumanReadableName") or ""
        if name == wanted or name.startswith(wanted + "_"):
            print(att["exportedFileName"])
            sys.exit(0)
sys.exit(1)
PY
)" || { echo "ERROR: 'generate-offer-found-screenshot' attachment not in the result bundle" >&2; exit 1; }
    local live_dest="$EVIDENCE_DIR/44-05-sc-generate-offer-GREEN.png"
    cp "$exported/$screenshot_file" "$live_dest"
    local pv_info_hex_live pv_bg_hex_live
    pv_info_hex_live="$(python3 -c 'import json; d=json.load(open("ios/PasskeyVault/Shared/PVColors.xcassets/PVInfo.colorset/Contents.json")); c=d["colors"][0]["color"]["components"]; print(f"{int(c[\"red\"],16):02X}{int(c[\"green\"],16):02X}{int(c[\"blue\"],16):02X}")')"
    pv_bg_hex_live="$(python3 -c 'import json; d=json.load(open("ios/PasskeyVault/Shared/PVColors.xcassets/PVBackground.colorset/Contents.json")); c=d["colors"][0]["color"]["components"]; print(f"{int(c[\"red\"],16):02X}{int(c[\"green\"],16):02X}{int(c[\"blue\"],16):02X}")')"
    python3 scripts/measure-ios-color-token.py "$live_dest" \
      --expect "PVInfo=$pv_info_hex_live" --expect "PVBackground=$pv_bg_hex_live" --mode present --tolerance 2
  else
    echo "==> sc-generate: interactive offer screen did NOT appear via live system routing (settled negative) -- capturing SAVE-04's pixel proof via the direct-invocation fallback"
    sc_generate_direct_invocation_pixel_proof "$udid" "$skip_red_control"
  fi

  exit 0
}

# The plan's own pre-authorized fallback: since `prepareInterface(for: ASGeneratePasswordsRequest)`
# does not fire live on this toolchain, render the REAL production `GeneratePasswordOfferView`
# directly via `GeneratePasswordOfferPreviewHost` (compiled in only under `PV_PROBE_E44_05_OFFER`,
# `PasskeyVault` app target -- `Shared/` already ships this exact view into the extension target
# too, confirmed via `scripts/audit-ios-extension-asset-resolution.py` PASS in this plan's Task 1).
# W4 (44-PLAN-CHECK.md): the RED control MUST be a genuinely unresolved-asset render, never a
# deliberately-wrong-hex substitution -- temporarily renames
# `Color("PVInfo")`/`Color("PVBackground")` to an unresolvable name, rebuilds, screenshots the
# resulting (genuinely blank) render, asserts `measure-ios-color-token.py` FAILS against it
# (`--tolerance 2`, the same anti-false-positive precedent `ios/IOS-SPIKE-LOG.md` §19 already
# established -- the default tolerance lets `PVBackground`'s near-white `#FCFBFA` false-positive
# match the platform's own `#FFFFFF` fallback), then reverts and rebuilds to restore the real
# GREEN artifact.
sc_generate_direct_invocation_pixel_proof() {
  local udid="$1" skip_red_control="$2"
  local pv_info_hex pv_bg_hex
  pv_info_hex="$(python3 - <<'PY'
import json
with open("ios/PasskeyVault/Shared/PVColors.xcassets/PVInfo.colorset/Contents.json") as f:
    data = json.load(f)
c = data["colors"][0]["color"]["components"]
print(f"{int(c['red'],16):02X}{int(c['green'],16):02X}{int(c['blue'],16):02X}")
PY
)"
  pv_bg_hex="$(python3 - <<'PY'
import json
with open("ios/PasskeyVault/Shared/PVColors.xcassets/PVBackground.colorset/Contents.json") as f:
    data = json.load(f)
c = data["colors"][0]["color"]["components"]
print(f"{int(c['red'],16):02X}{int(c['green'],16):02X}{int(c['blue'],16):02X}")
PY
)"

  echo "==> sc-generate: direct-invocation GREEN -- building PasskeyVault with PV_PROBE_E44_05_OFFER"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-05-offer-build.log build "PV_PROBE_E44_05_OFFER"
  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  local green_dest="$EVIDENCE_DIR/44-05-sc-generate-offer-GREEN.png"
  xcrun simctl io "$udid" screenshot "$green_dest"
  echo "==> sc-generate: wrote $green_dest"
  echo "==> sc-generate: measuring real GREEN render (PVInfo=$pv_info_hex, PVBackground=$pv_bg_hex)"
  python3 scripts/measure-ios-color-token.py "$green_dest" \
    --expect "PVInfo=$pv_info_hex" --expect "PVBackground=$pv_bg_hex" --mode present --tolerance 2

  if [ "$skip_red_control" = "1" ]; then
    echo "==> sc-generate: --skip-red-control set -- restoring the ordinary (non-probe) build and skipping the RED control"
    build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-05-restore-build.log build
    return 0
  fi

  local view_file="ios/PasskeyVault/Shared/GeneratePasswordOfferView.swift"
  echo "==> sc-generate: RED control -- unresolving PVInfo/PVBackground in $view_file"
  cp "$view_file" "/tmp/pv-e44-05-offerview-backup.swift"
  sed -i '' \
    -e 's/Color("PVInfo")/Color("PVInfoZZZUNRESOLVED")/g' \
    -e 's/Color("PVBackground")/Color("PVBackgroundZZZUNRESOLVED")/g' \
    "$view_file"

  local restored=0
  restore() {
    if [ "$restored" = "0" ]; then
      cp "/tmp/pv-e44-05-offerview-backup.swift" "$view_file"
      restored=1
    fi
  }
  trap restore EXIT

  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-05-red-build.log build "PV_PROBE_E44_05_OFFER"
  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  local red_dest="$EVIDENCE_DIR/44-05-sc-generate-offer-RED.png"
  xcrun simctl io "$udid" screenshot "$red_dest"
  echo "==> sc-generate: RED control screenshot -- $red_dest"

  restore
  trap - EXIT
  echo "==> sc-generate: RED control -- reverted $view_file, rebuilding to restore the real (non-probe) artifact"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-05-restore-build.log build

  set +e
  python3 scripts/measure-ios-color-token.py "$red_dest" \
    --expect "PVInfo=$pv_info_hex" --expect "PVBackground=$pv_bg_hex" --mode present --tolerance 2
  local red_status=$?
  set -e
  if [ "$red_status" -eq 0 ]; then
    echo "ERROR: RED control unexpectedly PASSED -- the unresolved-asset render was not genuinely blank" >&2
    exit 1
  fi
  echo "CONFIRMED RED: measure-ios-color-token.py correctly FAILED against the genuinely unresolved-asset render (exit $red_status)"
}

# `sc-save`: Plan 44-04, Task 3 (SAVE-01's live receiver-side proof + SAVE-04's pixel proof for the
# save surface). Drives `testDriveSaveViaGeneratedPassword` (configuration X, 44-03-SUMMARY.md: tap
# the new-password field with NO typing, tap the system's own "Strong Password" QuickType
# affordance, let the field fill, THEN submit) against a REAL, isolated, throwaway `pv-server`,
# seeded with a genuinely unlocked session (`PasskeyRegistrationSc4Seeder`, reused verbatim from
# `ios-autofill-e43.sh`/`sc-generate`, per <live_findings> item 4). Captures the extension
# process's own `PVFILL|entry=save-*` routing verdict, then performs the receiver-side proof via
# `SC4_PROBE_SCRIPT find-login` (an INDEPENDENT `pv-wasm` client, never this process's own
# assertion) BOTH before (absence check) and after (presence + byte-match against the harness's
# own separately-captured ground-truth fill value) the drive.
#
# `--skip-red-control`: skip the mandatory RED-control mutation/rebuild/revert cycle
# (44-PLAN-CHECK.md W4) -- only for a quick iteration re-run; the plan's own acceptance criteria
# require the RED control to have been run and recorded at least once.
cmd_sc_save() {
  mkdir -p "$EVIDENCE_DIR"
  local skip_red_control=0
  if [ "${1:-}" = "--skip-red-control" ]; then
    skip_red_control=1
  fi

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> sc-save: pinned simulator UDID: $udid"

  # --- throwaway, isolated pv-server (D-23 discipline: never the developer's own data/pv.db) ----
  local server_pid="" db_dir=""
  cleanup_sc_save() {
    if [ -n "${server_pid:-}" ]; then
      kill "$server_pid" >/dev/null 2>&1 || true
      wait "$server_pid" 2>/dev/null || true
    fi
    if [ -n "${db_dir:-}" ]; then
      rm -rf "$db_dir"
    fi
  }
  trap cleanup_sc_save EXIT

  # LIVE FINDING, this session: a plain `lsof -i :<port>` (no state filter) also matches the
  # extension process's own now-CLOSED client-side socket from a prior run's `createItem` POST --
  # a stale, non-listening connection lingering in the kernel's own TIME_WAIT-shaped bookkeeping,
  # never a real port conflict. Scoped to `LISTEN` specifically, matching this precheck's own
  # actual intent ("is a SERVER already bound here").
  if lsof -nP -i ":${SC_SAVE_SERVER_PORT}" 2>/dev/null | grep -q LISTEN; then
    echo "ERROR: something is already listening on :${SC_SAVE_SERVER_PORT} -- refusing to proceed" >&2
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
  db_dir=$(mktemp -d "${TMPDIR:-/tmp}/pv-e44-04-sc-save.XXXXXX")
  local db_url="sqlite://${db_dir}/pv.db?mode=rwc"
  local server_base="http://127.0.0.1:${SC_SAVE_SERVER_PORT}"
  PV_ADDR="127.0.0.1:${SC_SAVE_SERVER_PORT}" PV_DB_URL="$db_url" RUST_LOG=warn "$server_bin" > "${db_dir}/pv-server.log" 2>&1 &
  server_pid=$!
  local healthy=0
  for _ in $(seq 1 50); do
    if curl -fsS "${server_base}/healthz" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 0.3
  done
  if [ "$healthy" -ne 1 ]; then
    echo "ERROR: pv-server did not become healthy on ${server_base} within 15s" >&2
    cat "${db_dir}/pv-server.log" >&2
    exit 1
  fi
  echo "==> sc-save: pv-server healthy on ${server_base} (isolated, throwaway db)"

  # --- real, throwaway account, via the SAME real pv-wasm client scripts/ios-autofill-e43.sh's
  # own sc4 already trusts (E-W1) -----------------------------------------------------------------
  local wasm_glue="${REPO_ROOT}/web/src/lib/crypto/wasm/pv_wasm.js"
  local wasm_bytes="${REPO_ROOT}/web/public/wasm/pv_wasm_bg.wasm"
  if [ ! -f "$wasm_glue" ] || [ ! -f "$wasm_bytes" ]; then
    echo "ERROR: pv-wasm artifact missing (${wasm_glue} / ${wasm_bytes}). Run scripts/build-wasm.sh first." >&2
    exit 1
  fi
  local sc_save_email sc_save_password sc_save_username
  sc_save_email="pv-e44-04-sc-save-$(date +%s)@example.invalid"
  sc_save_password="pv-e44-04 sc-save fixture password $(date +%s) $$"
  sc_save_username="pv-e44-04-sc-save-user-$(date +%s)"

  echo "==> sc-save: registering throwaway account ${sc_save_email} via real pv-wasm client" | tee "${db_dir}/sc-save.log"
  node "$SC4_PROBE_SCRIPT" register "$server_base" "$wasm_glue" "$wasm_bytes" "$sc_save_email" "$sc_save_password" \
    >> "${db_dir}/sc-save.log" 2>&1 || { echo "ERROR: account registration failed -- see ${db_dir}/sc-save.log" >&2; exit 1; }

  local before_file="$EVIDENCE_DIR/44-04-sc-save-before.json"
  local after_file="$EVIDENCE_DIR/44-04-sc-save-after.json"
  echo "==> sc-save: capturing the BEFORE snapshot (must show no login item for ${sc_save_username})"
  node "$SC4_PROBE_SCRIPT" find-login "$server_base" "$wasm_glue" "$wasm_bytes" "$sc_save_email" "$sc_save_password" "$sc_save_username" "$before_file" \
    >> "${db_dir}/sc-save.log" 2>&1 || { echo "ERROR: BEFORE find-login failed -- see ${db_dir}/sc-save.log" >&2; exit 1; }
  if ! python3 -c "import json,sys; d=json.load(open('$before_file')); sys.exit(0 if d.get('found') is False else 1)"; then
    echo "ERROR: the BEFORE snapshot already shows a login item for ${sc_save_username} -- the account is not genuinely fresh" >&2
    cat "$before_file" >&2
    exit 1
  fi
  echo "==> sc-save: BEFORE snapshot confirmed absent ($before_file)"

  # --- build+install app+extension (PV_PROBE_E43_SC4, for the real-unlock seeder) + harness -------
  echo "==> sc-save: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> sc-save: building PasskeyVault app+extension (PV_PROBE_E43_SC4)"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-04-build.log build "PV_PROBE_E43_SC4"

  echo "==> sc-save: building PasskeyVaultHarness app"
  build_with_l10_retry "$udid" "PasskeyVaultHarness" /tmp/pv-e44-04-harness-build.log build

  echo "==> sc-save: building the UI test bundle (PasskeyVaultUITests)"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-04-build-for-testing.log build-for-testing "PV_PROBE_E43_SC4"

  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  xcrun simctl install "$udid" "$HARNESS_APP_PRODUCT"
  ensure_provider_enabled "$udid"

  # First launch: creates the App Group container on disk.
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  local group_dir
  group_dir=$(app_group_dir "$udid")
  if [ -z "$group_dir" ]; then
    echo "ERROR: App Group container not found after first launch" >&2
    exit 1
  fi

  local seed_input_file="${group_dir}/pv-43-sc4-seed.json"
  local status_file="${group_dir}/e43-sc4-seed-status.json"
  rm -f "$status_file"
  echo "{\"serverBaseURL\":\"${server_base}\",\"email\":\"${sc_save_email}\",\"password\":\"${sc_save_password}\"}" \
    > "$seed_input_file"
  echo "==> sc-save: launching host app to seed a REAL unlocked session (PasskeyRegistrationSc4Seeder, verbatim from ios-autofill-e43.sh)"
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  local waited=0
  while [ ! -f "$status_file" ]; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -gt 30 ]; then
      echo "ERROR: PasskeyRegistrationSc4Seeder never wrote its status marker within 30s" >&2
      exit 1
    fi
  done
  if ! grep -q '"status":"ok"' "$status_file"; then
    echo "ERROR: PasskeyRegistrationSc4Seeder reported a non-ok status:" >&2
    cat "$status_file" >&2
    exit 1
  fi
  echo "==> sc-save: seed confirmed ok (real host-unlock + Secret C written)"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  xcrun simctl launch --terminate-running-process "$udid" "$HARNESS_BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 1

  local out_root="ios/PasskeyVault/build/sc-save"
  rm -rf "$out_root"
  mkdir -p "$out_root"

  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')

  local result="$out_root/result.xcresult"
  local ui_test_log="$out_root/xcodebuild.log"
  local ui_result=0
  # LIVE FINDING, this session: a plain (non-prefixed) env var set on the invoking `xcodebuild`
  # process does NOT propagate into the XCUITest RUNNER process (a separate simulator-launched app)
  # -- confirmed by the saved item's own username genuinely landing as the Swift default fallback
  # ("pv-e44-04-sc-save-user", 22 bytes, not the per-run unique value), not a decrypt/parse/type
  # mismatch (`ios/evidence/44/44-04-sc-save-after.json`'s own `debug` block ruled those out).
  # `TEST_RUNNER_<VAR>` is xcodebuild's own documented mechanism for exactly this -- it strips the
  # prefix and injects the remainder into the runner's own process environment. This is a LATENT
  # bug this same plain-env-var pattern already carried in `ios-autofill-e43.sh`'s own
  # `PV_E43_SC4_USERNAME` (never caught there because that script's own `assert_sc4_snapshot` never
  # checks the exact username value, only `isPasskeyShape`/`rpId`) -- recorded here, not fixed
  # there (out of this plan's own file scope).
  TEST_RUNNER_PV_E44_04_SC_SAVE_USERNAME="$sc_save_username" \
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/SavePasswordFormHarnessUITests/testDriveSaveViaGeneratedPassword \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    -resultBundlePath "$result" \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_E43_SC4" \
    test > "$ui_test_log" 2>&1 || ui_result=$?

  echo "==> sc-save: XCUITest drive exit $ui_result (see $ui_test_log)"

  # --- routing verdict: silent-generate-seeded save chain, from the EXTENSION process's own
  # os_log -------------------------------------------------------------------------------------
  local ext_log="$out_root/extension-pvfill.log"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run_start" \
    2>&1 | grep -E 'PVFILL\|entry=save|PVFILL\|entry=generate-silent' > "$ext_log" || true
  cp "$ext_log" "$EVIDENCE_DIR/44-04-sc-save-pvfill.log"

  local confirm_presented=0
  if grep -q 'PVFILL|entry=save stage=confirm status=confirmed' "$ext_log"; then
    confirm_presented=1
    echo "VERDICT: prepareInterface(for: ASSavePasswordRequest) FIRED and the confirmation was CONFIRMED -- $(grep 'PVFILL|entry=save stage=confirm' "$ext_log" | head -1)"
  elif grep -q 'PVFILL|entry=save stage=confirm status=skipped-generated-password-filled' "$ext_log"; then
    echo "VERDICT: prepareInterface(for: ASSavePasswordRequest) FIRED for a .generatedPasswordFilled event (no confirm UI, per the header) -- $(grep 'PVFILL|entry=save stage=confirm' "$ext_log" | head -1)"
  elif grep -q 'PVFILL|entry=save ' "$ext_log"; then
    echo "VERDICT: prepareInterface(for: ASSavePasswordRequest) fired, but did not reach a confirmed/skipped completion in this run:"
    grep 'PVFILL|entry=save ' "$ext_log"
  else
    echo "VERDICT: prepareInterface(for: ASSavePasswordRequest) did NOT fire in this run"
    grep 'PVFILL|entry=save-silent' "$ext_log" || echo "  (no save-silent PVFILL| lines at all)"
  fi

  # --- ground-truth password, read from the harness's own UserDefaults (never a public log line,
  # T-44-06) ------------------------------------------------------------------------------------
  local harness_container observed_password=""
  harness_container=$(xcrun simctl get_app_container "$udid" "$HARNESS_BUNDLE_ID" data 2>/dev/null || true)
  if [ -n "$harness_container" ]; then
    local prefs_plist="${harness_container}/Library/Preferences/${HARNESS_BUNDLE_ID}.plist"
    if [ -f "$prefs_plist" ]; then
      observed_password=$(plutil -extract "pv-e44-04-sc-save-observed-password" raw -o - "$prefs_plist" 2>/dev/null || true)
    fi
  fi
  if [ -n "$observed_password" ]; then
    echo "==> sc-save: harness observed a filled password (length ${#observed_password}) -- never printed verbatim"
  else
    echo "==> sc-save: harness recorded NO observed password this run (the field was never filled)"
  fi

  # --- receiver-side proof: an INDEPENDENT pv-wasm client reads the LIVE server directly (L-17) --
  echo "==> sc-save: capturing the AFTER snapshot (direct GET /api/vault/items, bypassing any client cache)"
  sleep 2
  node "$SC4_PROBE_SCRIPT" find-login "$server_base" "$wasm_glue" "$wasm_bytes" "$sc_save_email" "$sc_save_password" "$sc_save_username" "$after_file" \
    >> "${db_dir}/sc-save.log" 2>&1 || { echo "ERROR: AFTER find-login failed -- see ${db_dir}/sc-save.log" >&2; exit 1; }
  cp "${db_dir}/sc-save.log" "$EVIDENCE_DIR/44-04-sc-save-probe.log"

  local receiver_side_pass=0
  if python3 -c "import json,sys; d=json.load(open('$after_file')); sys.exit(0 if d.get('found') is True else 1)"; then
    local server_password
    server_password=$(python3 -c "import json; print(json.load(open('$after_file'))['password'])")
    if [ -n "$observed_password" ] && [ "$server_password" = "$observed_password" ]; then
      receiver_side_pass=1
      echo "PASS: sc-save -- an INDEPENDENT pv-wasm client decrypted a server-visible login item for ${sc_save_username}, byte-matching the harness's own separately-captured fill value ($after_file)"
    elif [ -z "$observed_password" ]; then
      echo "PARTIAL: sc-save -- a server-visible, independently-decrypted login item for ${sc_save_username} exists ($after_file), but the harness never captured its own ground-truth fill value this run -- presence proven, byte-match NOT proven this run"
    else
      echo "FAIL: sc-save -- the server-visible item's decrypted password does NOT byte-match the harness's own observed fill value" >&2
      exit 1
    fi
  else
    echo "FAIL: sc-save -- no server-visible login item for ${sc_save_username} after the drive ($after_file)" >&2
    exit 1
  fi

  # --- SAVE-04 pixel proof ------------------------------------------------------------------------
  local pv_success_hex pv_bg_hex
  pv_success_hex="$(python3 - <<'PY'
import json
with open("ios/PasskeyVault/Shared/PVColors.xcassets/PVSuccess.colorset/Contents.json") as f:
    data = json.load(f)
c = data["colors"][0]["color"]["components"]
print(f"{int(c['red'],16):02X}{int(c['green'],16):02X}{int(c['blue'],16):02X}")
PY
)"
  pv_bg_hex="$(python3 - <<'PY'
import json
with open("ios/PasskeyVault/Shared/PVColors.xcassets/PVBackground.colorset/Contents.json") as f:
    data = json.load(f)
c = data["colors"][0]["color"]["components"]
print(f"{int(c['red'],16):02X}{int(c['green'],16):02X}{int(c['blue'],16):02X}")
PY
)"

  if [ "$confirm_presented" = "1" ]; then
    echo "==> sc-save: SavePasswordConfirmView appeared via LIVE system routing this run -- capturing GREEN pixel proof from the live route"
    local exported="$out_root/attachments"
    xcrun xcresulttool export attachments --path "$result" --output-path "$exported" >/dev/null
    local screenshot_file
    screenshot_file="$(python3 - "$exported/manifest.json" "save-confirm-found-screenshot" <<'PY'
import json, sys
manifest_path, wanted = sys.argv[1], sys.argv[2]
with open(manifest_path) as f:
    manifest = json.load(f)
for test in manifest:
    for att in test.get("attachments", []):
        name = att.get("suggestedHumanReadableName") or ""
        if name == wanted or name.startswith(wanted + "_"):
            print(att["exportedFileName"])
            sys.exit(0)
sys.exit(1)
PY
)" || { echo "ERROR: 'save-confirm-found-screenshot' attachment not in the result bundle" >&2; exit 1; }
    local live_dest="$EVIDENCE_DIR/44-04-sc-save-confirm-GREEN.png"
    cp "$exported/$screenshot_file" "$live_dest"
    python3 scripts/measure-ios-color-token.py "$live_dest" \
      --expect "PVSuccess=$pv_success_hex" --expect "PVBackground=$pv_bg_hex" --mode present --tolerance 2
    echo "==> sc-save: GREEN pixel proof PASSED against the LIVE system-routed screenshot"
  else
    echo "==> sc-save: SavePasswordConfirmView did NOT appear via live system routing (settled negative this run) -- capturing SAVE-04's pixel proof via the direct-invocation fallback"
  fi

  sc_save_direct_invocation_pixel_proof "$udid" "$skip_red_control" "$confirm_presented" "$pv_success_hex" "$pv_bg_hex"

  exit 0
}

# The plan's own pre-authorized fallback (and, regardless of live routing, the cheap standalone
# route for the mandatory RED control -- see `SavePasswordConfirmPreviewHost.swift`'s own header).
# W4 (44-PLAN-CHECK.md): the RED control MUST be a genuinely unresolved-asset render, never a
# deliberately-wrong-hex substitution -- temporarily renames `Color("PVSuccess")`/
# `Color("PVBackground")` in `SavePasswordConfirmView.swift` to an unresolvable name, rebuilds,
# screenshots the resulting (genuinely blank) render, asserts `measure-ios-color-token.py` FAILS
# against it (`--tolerance 2`, `ios/IOS-SPIKE-LOG.md` §19's own anti-false-positive precedent: at
# the default tolerance, `PVBackground`'s near-white `#FCFBFA` false-positive-matches the
# platform's own `#FFFFFF` unresolved-asset fallback), then reverts and rebuilds to restore the
# real GREEN artifact.
sc_save_direct_invocation_pixel_proof() {
  local udid="$1" skip_red_control="$2" confirm_presented="$3" pv_success_hex="$4" pv_bg_hex="$5"

  if [ "$confirm_presented" != "1" ]; then
    echo "==> sc-save: direct-invocation GREEN -- building PasskeyVault with PV_PROBE_E44_04_CONFIRM"
    build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-04-confirm-build.log build "PV_PROBE_E44_04_CONFIRM"
    xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
    xcrun simctl install "$udid" "$PV_APP_PRODUCT"
    xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
    sleep 2
    local green_dest="$EVIDENCE_DIR/44-04-sc-save-confirm-GREEN.png"
    xcrun simctl io "$udid" screenshot "$green_dest"
    echo "==> sc-save: wrote $green_dest (direct-invocation, system routing UNPROVEN for this screen)"
    echo "==> sc-save: measuring direct-invocation GREEN render (PVSuccess=$pv_success_hex, PVBackground=$pv_bg_hex)"
    python3 scripts/measure-ios-color-token.py "$green_dest" \
      --expect "PVSuccess=$pv_success_hex" --expect "PVBackground=$pv_bg_hex" --mode present --tolerance 2
  fi

  if [ "$skip_red_control" = "1" ]; then
    echo "==> sc-save: --skip-red-control set -- restoring the ordinary (non-probe) build and skipping the RED control"
    build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-04-restore-build.log build
    return 0
  fi

  local view_file="ios/PasskeyVault/Shared/SavePasswordConfirmView.swift"
  echo "==> sc-save: RED control -- unresolving PVSuccess/PVBackground in $view_file"
  cp "$view_file" "/tmp/pv-e44-04-confirmview-backup.swift"
  sed -i '' \
    -e 's/Color("PVSuccess")/Color("PVSuccessZZZUNRESOLVED")/g' \
    -e 's/Color("PVBackground")/Color("PVBackgroundZZZUNRESOLVED")/g' \
    "$view_file"

  local restored=0
  restore() {
    if [ "$restored" = "0" ]; then
      cp "/tmp/pv-e44-04-confirmview-backup.swift" "$view_file"
      restored=1
    fi
  }
  trap restore EXIT

  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-04-red-build.log build "PV_PROBE_E44_04_CONFIRM"
  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  local red_dest="$EVIDENCE_DIR/44-04-sc-save-confirm-RED.png"
  xcrun simctl io "$udid" screenshot "$red_dest"
  echo "==> sc-save: RED control screenshot -- $red_dest"

  restore
  trap - EXIT
  echo "==> sc-save: RED control -- reverted $view_file, rebuilding to restore the real (non-probe) artifact"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-04-restore-build.log build

  set +e
  python3 scripts/measure-ios-color-token.py "$red_dest" \
    --expect "PVSuccess=$pv_success_hex" --expect "PVBackground=$pv_bg_hex" --mode present --tolerance 2
  local red_status=$?
  set -e
  if [ "$red_status" -eq 0 ]; then
    echo "ERROR: RED control unexpectedly PASSED -- the unresolved-asset render was not genuinely blank" >&2
    exit 1
  fi
  echo "CONFIRMED RED: measure-ios-color-token.py correctly FAILED against the genuinely unresolved-asset render (exit $red_status)"
}

# `sc-insert`: Plan 44-06, Task 2 (SAVE-03's own live drive + receiver-correctness proof + SAVE-04
# pixel proof for the text-to-insert surface). Seeds a REAL, throwaway account against a REAL,
# isolated, throwaway `pv-server` and creates ONE real, server-visible TOTP item via an
# INDEPENDENT `pv-wasm` client (`scripts/ios-autofill-e43-sc4-probe.mjs create-totp` -- never this
# app's own encryption path, so the secret/algorithm/digits/period are a genuine independent
# ground truth). Then signs IN (`TotpInsertSc6Seeder`, real sync pull, `PasskeyInteropSeeder`'s own
# established shape) so the extension's own cold cache genuinely holds the item, and attempts ONE
# genuine live drive (`testDriveTextToInsertAffordance`) before falling back to the plan's own
# pre-authorized direct-invocation route if `prepareInterfaceForUserChoosingTextToInsert()` does
# not fire live (this surface's own historical finding, `ios/IOS-SPIKE-LOG.md`: never observed to
# fire, Plan 44-03).
#
# `--skip-red-control`: skip the mandatory RED-control mutation/rebuild/revert cycle
# (44-PLAN-CHECK.md W4) -- only for a quick iteration re-run; the plan's own acceptance criteria
# require the RED control to have been run and recorded at least once.
cmd_sc_insert() {
  mkdir -p "$EVIDENCE_DIR"
  local skip_red_control=0
  if [ "${1:-}" = "--skip-red-control" ]; then
    skip_red_control=1
  fi

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> sc-insert: pinned simulator UDID: $udid"

  # --- throwaway, isolated pv-server (D-23 discipline: never the developer's own data/pv.db) ----
  local server_pid="" db_dir=""
  cleanup_sc_insert() {
    if [ -n "${server_pid:-}" ]; then
      kill "$server_pid" >/dev/null 2>&1 || true
      wait "$server_pid" 2>/dev/null || true
    fi
    if [ -n "${db_dir:-}" ]; then
      rm -rf "$db_dir"
    fi
  }
  trap cleanup_sc_insert EXIT

  if lsof -nP -i ":${SC_INSERT_SERVER_PORT}" 2>/dev/null | grep -q LISTEN; then
    echo "ERROR: something is already listening on :${SC_INSERT_SERVER_PORT} -- refusing to proceed" >&2
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
  db_dir=$(mktemp -d "${TMPDIR:-/tmp}/pv-e44-06-sc-insert.XXXXXX")
  local db_url="sqlite://${db_dir}/pv.db?mode=rwc"
  local server_base="http://127.0.0.1:${SC_INSERT_SERVER_PORT}"
  PV_ADDR="127.0.0.1:${SC_INSERT_SERVER_PORT}" PV_DB_URL="$db_url" RUST_LOG=warn "$server_bin" > "${db_dir}/pv-server.log" 2>&1 &
  server_pid=$!
  local healthy=0
  for _ in $(seq 1 50); do
    if curl -fsS "${server_base}/healthz" >/dev/null 2>&1; then healthy=1; break; fi
    sleep 0.3
  done
  if [ "$healthy" -ne 1 ]; then
    echo "ERROR: pv-server did not become healthy on ${server_base} within 15s" >&2
    cat "${db_dir}/pv-server.log" >&2
    exit 1
  fi
  echo "==> sc-insert: pv-server healthy on ${server_base} (isolated, throwaway db)"

  # --- real, throwaway account + one real TOTP item, via the SAME real pv-wasm client
  # scripts/ios-autofill-e43.sh's own sc4 already trusts (E-W1) -----------------------------------
  local wasm_glue="${REPO_ROOT}/web/src/lib/crypto/wasm/pv_wasm.js"
  local wasm_bytes="${REPO_ROOT}/web/public/wasm/pv_wasm_bg.wasm"
  if [ ! -f "$wasm_glue" ] || [ ! -f "$wasm_bytes" ]; then
    echo "ERROR: pv-wasm artifact missing (${wasm_glue} / ${wasm_bytes}). Run scripts/build-wasm.sh first." >&2
    exit 1
  fi
  local sc_insert_email sc_insert_password
  sc_insert_email="pv-e44-06-sc-insert-$(date +%s)@example.invalid"
  sc_insert_password="pv-e44-06 sc-insert fixture password $(date +%s) $$"
  # RFC 6238 Appendix B's own SHA1 test secret -- the SAME literal `TotpFfiTests.swift`/
  # `TextToInsertDispatchTests.swift`/`scripts/totp-oracle.py --selftest` all already trust
  # (never a fresh, unvalidated secret for this plan's own live drive).
  local totp_name="PV Live TOTP" totp_secret="GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" totp_algo="SHA1" totp_digits=8 totp_period=30

  echo "==> sc-insert: registering throwaway account ${sc_insert_email} + one real TOTP item via independent pv-wasm client"
  node "$SC4_PROBE_SCRIPT" register "$server_base" "$wasm_glue" "$wasm_bytes" "$sc_insert_email" "$sc_insert_password" \
    >> "${db_dir}/sc-insert.log" 2>&1 || { echo "ERROR: account registration failed -- see ${db_dir}/sc-insert.log" >&2; exit 1; }
  local totp_out_file="$EVIDENCE_DIR/44-06-sc-insert-totp-fixture.json"
  node "$SC4_PROBE_SCRIPT" create-totp "$server_base" "$wasm_glue" "$wasm_bytes" "$sc_insert_email" "$sc_insert_password" \
    "$totp_name" "$totp_secret" "$totp_algo" "$totp_digits" "$totp_period" "$totp_out_file" \
    >> "${db_dir}/sc-insert.log" 2>&1 || { echo "ERROR: create-totp failed -- see ${db_dir}/sc-insert.log" >&2; cat "${db_dir}/sc-insert.log" >&2; exit 1; }
  echo "==> sc-insert: one real, server-visible TOTP item created ($totp_out_file)"

  # --- build+install app+extension (PV_PROBE_E44_06_SEED, for the real-sign-in+real-sync seeder)
  # + harness ---------------------------------------------------------------------------------------
  echo "==> sc-insert: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> sc-insert: building PasskeyVault app+extension (PV_PROBE_E44_06_SEED)"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-06-build.log build "PV_PROBE_E44_06_SEED"

  echo "==> sc-insert: building PasskeyVaultHarness app"
  build_with_l10_retry "$udid" "PasskeyVaultHarness" /tmp/pv-e44-06-harness-build.log build

  echo "==> sc-insert: building the UI test bundle (PasskeyVaultUITests)"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-06-build-for-testing.log build-for-testing "PV_PROBE_E44_06_SEED"

  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  xcrun simctl install "$udid" "$HARNESS_APP_PRODUCT"
  ensure_provider_enabled "$udid"

  # First launch: creates the App Group container on disk.
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  local group_dir
  group_dir=$(app_group_dir "$udid")
  if [ -z "$group_dir" ]; then
    echo "ERROR: App Group container not found after first launch" >&2
    exit 1
  fi

  local seed_input_file="${group_dir}/pv-44-06-sc-insert-seed.json"
  local status_file="${group_dir}/e44-06-sc-insert-seed-status.json"
  rm -f "$status_file"
  echo "{\"serverBaseURL\":\"${server_base}\",\"email\":\"${sc_insert_email}\",\"password\":\"${sc_insert_password}\"}" \
    > "$seed_input_file"
  echo "==> sc-insert: launching host app to seed a REAL sign-in + REAL sync pull (TotpInsertSc6Seeder)"
  xcrun simctl launch "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  local waited=0
  while [ ! -f "$status_file" ]; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -gt 30 ]; then
      echo "ERROR: TotpInsertSc6Seeder never wrote its status marker within 30s" >&2
      exit 1
    fi
  done
  if ! grep -q '"status":"ok"' "$status_file"; then
    echo "ERROR: TotpInsertSc6Seeder reported a non-ok status:" >&2
    cat "$status_file" >&2
    exit 1
  fi
  echo "==> sc-insert: seed confirmed ok (real sign-in + real sync pull -- the TOTP item is genuinely cached)"
  xcrun simctl terminate "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true

  xcrun simctl launch --terminate-running-process "$udid" "$HARNESS_BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 1

  local out_root="ios/PasskeyVault/build/sc-insert"
  rm -rf "$out_root"
  mkdir -p "$out_root"

  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')

  local result="$out_root/result.xcresult"
  local ui_test_log="$out_root/xcodebuild.log"
  local ui_result=0
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/SavePasswordFormHarnessUITests/testDriveTextToInsertAffordance \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    -resultBundlePath "$result" \
    test > "$ui_test_log" 2>&1 || ui_result=$?

  echo "==> sc-insert: XCUITest drive exit $ui_result (see $ui_test_log)"

  # --- routing verdict: from the EXTENSION process's own os_log --------------------------------
  local ext_log="$out_root/extension-pvfill.log"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run_start" \
    2>&1 | grep 'PVFILL|entry=text-insert' > "$ext_log" || true
  cp "$ext_log" "$EVIDENCE_DIR/44-06-sc-insert-pvfill.log"

  local fired=0
  if grep -q 'PVFILL|entry=text-insert stage=select status=ok' "$ext_log"; then
    fired=1
    echo "VERDICT: prepareInterfaceForUserChoosingTextToInsert() FIRED and a selection was completed -- $(grep 'PVFILL|entry=text-insert stage=select' "$ext_log" | head -1)"
  elif grep -q 'PVFILL|entry=text-insert' "$ext_log"; then
    echo "VERDICT: prepareInterfaceForUserChoosingTextToInsert() fired, but no selection was completed in this run:"
    grep 'PVFILL|entry=text-insert' "$ext_log"
  else
    echo "VERDICT: prepareInterfaceForUserChoosingTextToInsert() did NOT fire in this run (this surface's own historical finding, ios/IOS-SPIKE-LOG.md -- reported honestly, not assumed)"
  fi

  # --- SAVE-04 pixel proof + receiver-correctness ------------------------------------------------
  local pv_accent_hex pv_bg_hex
  pv_accent_hex="$(python3 - <<'PY'
import json
with open("ios/PasskeyVault/Shared/PVColors.xcassets/PVAccent.colorset/Contents.json") as f:
    data = json.load(f)
c = data["colors"][0]["color"]["components"]
print(f"{int(c['red'],16):02X}{int(c['green'],16):02X}{int(c['blue'],16):02X}")
PY
)"
  pv_bg_hex="$(python3 - <<'PY'
import json
with open("ios/PasskeyVault/Shared/PVColors.xcassets/PVBackground.colorset/Contents.json") as f:
    data = json.load(f)
c = data["colors"][0]["color"]["components"]
print(f"{int(c['red'],16):02X}{int(c['green'],16):02X}{int(c['blue'],16):02X}")
PY
)"

  if [ "$fired" = "1" ]; then
    echo "==> sc-insert: TextToInsertListView appeared via LIVE system routing this run -- capturing GREEN pixel proof from the live route"
    local exported="$out_root/attachments"
    xcrun xcresulttool export attachments --path "$result" --output-path "$exported" >/dev/null
    local screenshot_file
    screenshot_file="$(python3 - "$exported/manifest.json" "insert-row-found" <<'PY'
import json, sys
manifest_path, wanted = sys.argv[1], sys.argv[2]
with open(manifest_path) as f:
    manifest = json.load(f)
for test in manifest:
    for att in test.get("attachments", []):
        name = att.get("suggestedHumanReadableName") or ""
        if name == wanted or name.startswith(wanted + "_"):
            print(att["exportedFileName"])
            sys.exit(0)
sys.exit(1)
PY
)" || { echo "ERROR: 'insert-row-found' attachment not in the result bundle" >&2; exit 1; }
    local live_dest="$EVIDENCE_DIR/44-06-sc-insert-list-GREEN.png"
    cp "$exported/$screenshot_file" "$live_dest"
    python3 scripts/measure-ios-color-token.py "$live_dest" \
      --expect "PVAccent=$pv_accent_hex" --expect "PVBackground=$pv_bg_hex" --mode present --tolerance 2
    echo "==> sc-insert: GREEN pixel proof PASSED against the LIVE system-routed screenshot -- SAVE-03 fired and completed a real, system-routed selection against a genuinely cached TOTP item; the receiver-correctness byte-comparison below still runs through the direct-invocation route, since the live path's own PVFILL| line never carries the code value (T-44-14)."
    sc_insert_direct_invocation_proof "$udid" "$skip_red_control" "$pv_accent_hex" "$pv_bg_hex" "1"
  else
    echo "==> sc-insert: prepareInterfaceForUserChoosingTextToInsert() did NOT appear via live system routing (this surface's own historical finding repeats) -- capturing SAVE-04's pixel proof AND the receiver-correctness proof via the plan's own pre-authorized direct-invocation fallback"
    sc_insert_direct_invocation_proof "$udid" "$skip_red_control" "$pv_accent_hex" "$pv_bg_hex" "0"
  fi

  exit 0
}

# The plan's own pre-authorized fallback (and, regardless of live routing, the cheap standalone
# route for the mandatory RED control -- see `TextToInsertListPreviewHost.swift`'s own header).
# ALSO the receiver-correctness proof's own route regardless of live-fire outcome (the live path's
# own `PVFILL|` line never carries the code value, T-44-14, so a byte-level oracle comparison needs
# a real tap somewhere this script can read the resulting value back from -- `UserDefaults`, never
# a log line). W4 (44-PLAN-CHECK.md): the RED control MUST be a genuinely unresolved-asset render,
# never a deliberately-wrong-hex substitution -- temporarily renames `Color("PVAccent")`/
# `Color("PVBackground")` in `TextToInsertListView.swift` to an unresolvable name, rebuilds,
# screenshots the resulting (genuinely blank) render, asserts `measure-ios-color-token.py` FAILS
# against it (`--tolerance 2`, `ios/IOS-SPIKE-LOG.md`'s own §19 anti-false-positive precedent), then
# reverts and rebuilds to restore the real GREEN artifact.
sc_insert_direct_invocation_proof() {
  local udid="$1" skip_red_control="$2" pv_accent_hex="$3" pv_bg_hex="$4" live_fired="$5"

  if [ "$live_fired" != "1" ]; then
    echo "==> sc-insert: direct-invocation GREEN -- building PasskeyVault with PV_PROBE_E44_06_INSERT"
    build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-06-insert-build.log build "PV_PROBE_E44_06_INSERT"
    xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
    xcrun simctl install "$udid" "$PV_APP_PRODUCT"
    xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
    sleep 2
    local green_dest="$EVIDENCE_DIR/44-06-sc-insert-list-GREEN.png"
    xcrun simctl io "$udid" screenshot "$green_dest"
    echo "==> sc-insert: wrote $green_dest (direct-invocation, system routing UNPROVEN for this screen)"
    python3 scripts/measure-ios-color-token.py "$green_dest" \
      --expect "PVAccent=$pv_accent_hex" --expect "PVBackground=$pv_bg_hex" --mode present --tolerance 2
    echo "==> sc-insert: direct-invocation GREEN pixel proof PASSED"
  else
    echo "==> sc-insert: building PasskeyVault with PV_PROBE_E44_06_INSERT (receiver-correctness route only -- GREEN pixel proof already captured from the live route)"
    build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-06-insert-build.log build "PV_PROBE_E44_06_INSERT"
    xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
    xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  fi

  # Clear any stale ground-truth marker from a prior run before this one -- UserDefaults on the
  # HOST app's own bundle id (T-44-06: never App Group, this is the direct-invocation host).
  xcrun simctl spawn "$udid" defaults delete "$BUNDLE_ID" pv-e44-06-sc-insert-observed-code >/dev/null 2>&1 || true
  xcrun simctl spawn "$udid" defaults delete "$BUNDLE_ID" pv-e44-06-sc-insert-observed-time >/dev/null 2>&1 || true
  xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2

  # Drive a REAL tap on the SwiftUI row -- exercises the SAME `TextToInsertDispatch.freshCode` call
  # `completeTextToInsert` makes, capturing a genuinely fresh recompute for the receiver-correctness
  # comparison below.
  local tap_log="/tmp/pv-e44-06-insert-tap.log"
  local tap_result=0
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/TextToInsertPreviewHostUITests/testTapPreviewRow \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_E44_06_INSERT" \
    test > "$tap_log" 2>&1 || tap_result=$?
  echo "==> sc-insert: direct-invocation tap drive exit $tap_result (see $tap_log)"

  # LIVE FINDING, this session: `UserDefaults.synchronize()` is a documented no-op on modern iOS
  # (Apple's own header: "this method is unnecessary and shouldn't be used") -- it does NOT force
  # an immediate disk flush, unlike what its name/`SavePasswordFormView.swift`'s own comment
  # implies. The plist write lands asynchronously, on the OS's own schedule, typically within
  # ~1-2s of the in-memory `set()` call. Reading the plist back IMMEDIATELY after `xcodebuild test`
  # returns raced this write and lost (`observed-code` present, `observed-time` absent, observed
  # live). Polled with a bounded retry instead of a single read.
  local app_container observed_code="" observed_time=""
  app_container=$(xcrun simctl get_app_container "$udid" "$BUNDLE_ID" data 2>/dev/null || true)
  if [ -n "$app_container" ]; then
    local prefs_plist="${app_container}/Library/Preferences/${BUNDLE_ID}.plist"
    local attempt=0
    while [ "$attempt" -lt 10 ]; do
      attempt=$((attempt + 1))
      if [ -f "$prefs_plist" ]; then
        observed_code=$(plutil -extract "pv-e44-06-sc-insert-observed-code" raw -o - "$prefs_plist" 2>/dev/null || true)
        observed_time=$(plutil -extract "pv-e44-06-sc-insert-observed-time" raw -o - "$prefs_plist" 2>/dev/null || true)
      fi
      if [ -n "$observed_code" ] && [ -n "$observed_time" ]; then
        break
      fi
      sleep 1
    done
  fi

  if [ -n "$observed_code" ] && [ -n "$observed_time" ]; then
    local oracle_json oracle_code
    oracle_json=$(python3 scripts/totp-oracle.py --secret GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ --algorithm SHA1 --digits 8 --period 30 --time "$observed_time" --json)
    oracle_code=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['code'])" "$oracle_json")
    echo "==> sc-insert: direct-invocation selection observed at t=$observed_time"
    if [ "$observed_code" = "$oracle_code" ]; then
      echo "PASS: sc-insert -- the inserted code matches an INDEPENDENT RFC 6238 oracle for the same secret/time (direct-invocation route; recomputed through the SAME TextToInsertDispatch.freshCode call completeTextToInsert makes)"
    else
      echo "FAIL: sc-insert -- inserted code ($observed_code) does NOT match the independent oracle ($oracle_code) at t=$observed_time" >&2
      exit 1
    fi
  else
    echo "ERROR: direct-invocation tap drive never captured an observed code/time -- receiver-correctness proof not obtained this run" >&2
    exit 1
  fi

  if [ "$skip_red_control" = "1" ]; then
    echo "==> sc-insert: --skip-red-control set -- restoring the ordinary (non-probe) build and skipping the RED control"
    build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-06-restore-build.log build
    return 0
  fi

  local view_file="ios/PasskeyVault/Shared/TextToInsertListView.swift"
  echo "==> sc-insert: RED control -- unresolving PVAccent/PVBackground in $view_file"
  cp "$view_file" "/tmp/pv-e44-06-listview-backup.swift"
  sed -i '' \
    -e 's/Color("PVAccent")/Color("PVAccentZZZUNRESOLVED")/g' \
    -e 's/Color("PVBackground")/Color("PVBackgroundZZZUNRESOLVED")/g' \
    "$view_file"

  local restored=0
  restore() {
    if [ "$restored" = "0" ]; then
      cp "/tmp/pv-e44-06-listview-backup.swift" "$view_file"
      restored=1
    fi
  }
  trap restore EXIT

  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-06-red-build.log build "PV_PROBE_E44_06_INSERT"
  xcrun simctl uninstall "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"
  xcrun simctl launch --terminate-running-process "$udid" "$BUNDLE_ID" >/dev/null 2>&1 || true
  sleep 2
  local red_dest="$EVIDENCE_DIR/44-06-sc-insert-list-RED.png"
  xcrun simctl io "$udid" screenshot "$red_dest"
  echo "==> sc-insert: RED control screenshot -- $red_dest"

  restore
  trap - EXIT
  echo "==> sc-insert: RED control -- reverted $view_file, rebuilding to restore the real (non-probe) artifact"
  build_with_l10_retry "$udid" "PasskeyVault" /tmp/pv-e44-06-restore-build.log build

  set +e
  python3 scripts/measure-ios-color-token.py "$red_dest" \
    --expect "PVAccent=$pv_accent_hex" --expect "PVBackground=$pv_bg_hex" --mode present --tolerance 2
  local red_status=$?
  set -e
  if [ "$red_status" -eq 0 ]; then
    echo "ERROR: RED control unexpectedly PASSED -- the unresolved-asset render was not genuinely blank" >&2
    exit 1
  fi
  echo "CONFIRMED RED: measure-ios-color-token.py correctly FAILED against the genuinely unresolved-asset render (exit $red_status)"
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
        shift || true
        local assert_run2=0
        if [ "${1:-}" = "--run2" ]; then
          assert_run2=1
        fi
        if assert_probe "$path" "$assert_run2"; then
          exit 0
        else
          exit 1
        fi
      fi
      cmd_probe "${1:-}"
      ;;
    sc-generate)
      cmd_sc_generate "${1:-}"
      ;;
    sc-save)
      cmd_sc_save "${1:-}"
      ;;
    sc-insert)
      cmd_sc_insert "${1:-}"
      ;;
    *)
      usage
      ;;
  esac
}

main "$@"
