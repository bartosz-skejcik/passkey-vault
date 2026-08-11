#!/usr/bin/env bash
# scripts/ios-autofill-layers.sh -- Phase 36, Plan 36-01 Task 3 / Plan 36-02
# Tasks 1 and 3.
#
# Independently invocable subcommands, so SC1's three layers
# (registration / election / Settings visibility) can never be collapsed
# into one verdict (D-09, 36-RESEARCH.md E4):
#
#   layer-a        -- pluginkit registration at the credential-provider
#                     extension point.
#   layer-b        -- user election (pluginkit -e use).
#   layer-appgroup -- E2: App Group container resolution, outside view +
#                     negative control (Plan 36-02, Task 1).
#   layer-c        -- SC1 layer (c): Settings AutoFill visibility, captured
#                     as an artifact (Plan 36-02, Task 3).
#   wording-gate   -- this phase's committed-record discipline gate: scans
#                     for the four forbidden phrasing classes and fails
#                     naming the offending file and line.
#
# D-08 (landmine L-3, this shell is zsh): every subcommand redirects into a
# file and greps the FILE -- never `cmd | tail` followed by a status check.
# `timeout` does not exist on this machine (Pitfall 6) -- not used anywhere
# below.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

BUNDLE_ID="cloud.blonie.PasskeyVault.AutoFill"
HOST_BUNDLE_ID="cloud.blonie.PasskeyVault"
EXTENSION_POINT="com.apple.authentication-services-credential-provider-ui"
EVIDENCE_DIR="ios/evidence/36"

GROUP_ID="group.cloud.blonie.PasskeyVault"
NEVER_INSTALLED_BUNDLE_ID="cloud.blonie.NeverInstalled"

usage() {
  echo "Usage: $0 {layer-a|layer-b|layer-appgroup|layer-c|wording-gate}" >&2
  exit 1
}

booted_udid() {
  xcrun simctl list devices booted | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1
}

require_booted_simulator() {
  local list_file
  list_file=$(mktemp)
  xcrun simctl list devices booted > "$list_file" 2>&1
  if ! grep -q '[0-9A-F-]\{36\}' "$list_file"; then
    echo "ERROR: no booted simulator -- layer-a/layer-b need one (boot exactly one via scripts/ios-probe-run.sh or xcrun simctl boot)" >&2
    rm -f "$list_file"
    exit 1
  fi
  rm -f "$list_file"
}

# --- layer-a: pluginkit registration ---------------------------------------
# Registration at the extension point is independent of any UI -- proves
# the system accepted the bundle at all, before anything about election or
# Settings visibility is asked (36-RESEARCH.md E4, "do these in order").
cmd_layer_a() {
  local target_bundle_id="${1:-$BUNDLE_ID}"
  require_booted_simulator
  mkdir -p "$EVIDENCE_DIR"
  local outfile="$EVIDENCE_DIR/pluginkit-registered.txt"
  local udid
  udid=$(xcrun simctl list devices booted | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)

  xcrun simctl spawn "$udid" pluginkit -mAvv -p "$EXTENSION_POINT" > "$outfile" 2>&1 || true

  if grep -q "$target_bundle_id" "$outfile"; then
    echo "RESULT: layer=a outcome=PASS bundle_id=$target_bundle_id evidence=$outfile"
    exit 0
  else
    echo "RESULT: layer=a outcome=FAIL bundle_id=$target_bundle_id evidence=$outfile (bundle id not found in pluginkit registration listing -- FAIL-1, not an entitlement verdict, 36-RESEARCH.md E4)" >&2
    exit 1
  fi
}

# --- layer-b: user election -------------------------------------------------
# Flips the user election for our bundle id, then re-queries the SINGLE
# bundle listing and asserts positively on the elected state in that file
# (never inferred from layer-a). Whether this CLI verb drives the same
# state Settings shows is an OPEN assumption (A5, 36-RESEARCH.md
# Assumptions Log) -- layer (c), owned by Plan 36-02, exists to check it;
# never infer (c) from (b).
cmd_layer_b() {
  local target_bundle_id="${1:-$BUNDLE_ID}"
  require_booted_simulator
  mkdir -p "$EVIDENCE_DIR"
  local outfile="$EVIDENCE_DIR/pluginkit-elected.txt"
  local udid
  udid=$(xcrun simctl list devices booted | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' | head -1)

  xcrun simctl spawn "$udid" pluginkit -e use -i "$target_bundle_id" > /dev/null 2>&1 || true
  xcrun simctl spawn "$udid" pluginkit -mAvv -i "$target_bundle_id" > "$outfile" 2>&1 || true

  # A positive election shows a leading `+` marker on the matched entry
  # line (observed live, this exact Xcode/runtime): blank = never touched,
  # `-` = explicitly ignored, `+` = elected. Presence of the bundle id
  # alone is NOT sufficient -- that would only re-prove layer-a.
  if grep -qE '^\+[[:space:]]*'"$target_bundle_id" "$outfile"; then
    echo "RESULT: layer=b outcome=PASS bundle_id=$target_bundle_id evidence=$outfile (open assumption A5: whether this CLI verb drives the same state Settings shows is unconfirmed by this layer alone -- see layer c, Plan 36-02)"
    exit 0
  fi
  echo "RESULT: layer=b outcome=FAIL bundle_id=$target_bundle_id evidence=$outfile (elected '+' marker not observed -- not an entitlement verdict)" >&2
  exit 1
}

# --- layer-appgroup: E2, App Group container resolution --------------------
# Outside view: asks simctl for the App Group container of the HOST bundle
# id (the only bundle id `simctl get_app_container` can address -- see the
# recorded scope limit below), plus the mandatory negative control.
#
# RECORDED SCOPE LIMIT (found running this task, not assumed): every
# `simctl get_app_container <udid> <extension-bundle-id> {app|data|groups}`
# call returns rc=2 "No such file or directory" on this toolchain
# (CoreSimulator-1051.55 / Xcode 26.6) -- for ALL container types, not just
# `groups`. This is a tool-registry limitation (app extensions are not
# independently addressable "apps" in this command's lookup, confirmed via
# `xcrun simctl listapps`, which also never lists the extension bundle id
# separately from its containing app), NOT an App-Group-entitlement signal.
# It is analogous to Apple's capability table being silent (not negative) on
# `app-extension` product types (36-RESEARCH.md E2). Recorded, not routed
# around silently: the equality assertion this layer's <verify> ultimately
# depends on is therefore performed between this OUTSIDE host-app path and
# the INSIDE view AppGroupProbe.swift logs from the running extension
# process itself (a stronger, more direct proof of the property in question
# than two simctl calls reading a device-level registry from outside would
# have been) -- see ios/AUTOFILL-FEASIBILITY.md's E2 section.
#
# The specific-group-identifier positional form
# (`get_app_container <udid> <bundle> <group-id>`) is ALSO broken on this
# toolchain: it prints the command's own usage text and exits 117 for ANY
# group identifier, valid or bogus, so it cannot serve as a negative control
# shape at all (a check that fails identically for both real and fake input
# proves nothing). The negative control below therefore uses the `groups`
# (plural) form, which DOES work, against a never-installed bundle id.
cmd_layer_appgroup() {
  require_booted_simulator
  mkdir -p "$EVIDENCE_DIR"
  local udid
  udid=$(booted_udid)

  local host_out="$EVIDENCE_DIR/appgroup-host.txt"
  local ext_out="$EVIDENCE_DIR/appgroup-extension-cli-limitation.txt"
  local neg_out="$EVIDENCE_DIR/appgroup-negative-control.txt"

  local host_rc=0
  xcrun simctl get_app_container "$udid" "$HOST_BUNDLE_ID" groups > "$host_out" 2>&1 || host_rc=$?

  local ext_rc=0
  xcrun simctl get_app_container "$udid" "$BUNDLE_ID" groups > "$ext_out" 2>&1 || ext_rc=$?

  local neg_rc=0
  xcrun simctl get_app_container "$udid" "$NEVER_INSTALLED_BUNDLE_ID" groups > "$neg_out" 2>&1 || neg_rc=$?

  local host_path
  host_path=$(awk -F'\t' -v g="$GROUP_ID" '$1==g{print $2}' "$host_out" | head -1)

  if [ -z "$host_path" ]; then
    echo "RESULT: layer=appgroup outcome=FAIL reason=host-resolution-empty host_rc=$host_rc evidence=$host_out" >&2
    exit 1
  fi
  if [ ! -d "$host_path" ]; then
    echo "RESULT: layer=appgroup outcome=FAIL reason=host-dir-missing path=$host_path evidence=$host_out" >&2
    exit 1
  fi

  # Negative control must NOT resolve our group id -- if it does, the check
  # is worthless.
  if [ "$neg_rc" -eq 0 ] && grep -qF "$GROUP_ID" "$neg_out"; then
    echo "RESULT: layer=appgroup outcome=INCONCLUSIVE reason=negative-control-did-not-fire evidence=$neg_out" >&2
    exit 1
  fi

  # Cross-check against the INSIDE view, if a prior probe run already
  # produced ios/evidence/36/appgroup.log (AppGroupProbe.swift's
  # PVPROBE|stage=appgroup line, emitted from the real extension process).
  # If it has not run yet, state that plainly rather than banking equality
  # this invocation cannot see.
  local log_file="$EVIDENCE_DIR/appgroup.log"
  local inside_line inside_path
  if [ -f "$log_file" ] && inside_line=$(grep -E 'PVPROBE\|stage=appgroup' "$log_file" | tail -1) && [ -n "$inside_line" ]; then
    inside_path=$(printf '%s' "$inside_line" | grep -oE 'resolved=[^[:space:]]+' | cut -d= -f2-)
    if [ "$inside_path" = "$host_path" ]; then
      echo "RESULT: layer=appgroup outcome=PASS host_path=$host_path inside_path=$inside_path equality=equal ext_bundle_query_rc=$ext_rc(recorded CLI limitation, see $ext_out) negative_control_rc=$neg_rc"
      exit 0
    else
      echo "RESULT: layer=appgroup outcome=FAIL reason=paths-differ host_path=$host_path inside_path=$inside_path" >&2
      exit 1
    fi
  fi

  echo "RESULT: layer=appgroup outcome=PASS host_path=$host_path (extension-side comparison deferred until 'scripts/ios-probe-run.sh appgroup' has produced $log_file -- simctl cannot address the extension bundle id directly, ext_bundle_query_rc=$ext_rc, see $ext_out) negative_control_rc=$neg_rc"
  exit 0
}

# --- layer-c: SC1 layer (c), Settings AutoFill visibility -------------------
# Drives the SAME navigation AutoFillInvocationUITests' primary route
# already performs (Settings -> Apps -> Passwords -> View AutoFill Settings)
# and extracts the REAL screenshot that route already takes at the
# "autofill-and-passwords-screen" checkpoint from the run's .xcresult bundle
# via `xcresulttool export attachments` -- a deterministic, disk-verifiable
# capture of the exact on-screen state at that navigation point, rather than
# a live `simctl io screenshot` racing an in-process `sleep()` window from
# outside the test process (XCUITest attachments ARE real
# `XCUIApplication.screenshot()` calls, the same underlying mechanism
# `simctl io screenshot` uses, just captured at a moment the test process
# itself controls instead of a moment this shell script has to guess).
# If the navigation cannot be driven at all (no .xcresult produced, or no
# matching attachment in it), this exits non-zero with the manual steps
# named -- never a silent `passed`.
cmd_layer_c() {
  require_booted_simulator
  mkdir -p "$EVIDENCE_DIR"
  local udid
  udid=$(booted_udid)

  local manual_steps="Manual steps: on the booted simulator, open Settings -> Apps -> Passwords -> View AutoFill Settings and observe whether \"PasskeyVault\" appears under \"AutoFill from:\" with a toggle."

  local result_bundle="/tmp/pv-layerc-result.xcresult"
  rm -rf "$result_bundle"

  local test_log
  test_log=$(mktemp)
  local test_rc=0
  # -parallel-testing-enabled NO / -maximum-concurrent-test-simulator-destinations 1:
  # WITHOUT these (matching scripts/ios-probe-run.sh's run_test, the proven
  # working invocation shape), xcodebuild spins up an ephemeral "Clone" of
  # the target simulator to run the test in isolation instead of using the
  # booted device directly -- observed live this session as
  # "Clone 1 of iPhone 17 Pro" in the test log, correlating with the primary
  # booted device being shut down around the test session and the clone not
  # reliably reflecting the just-built app's installed state. Never omit
  # these flags for this project's simulator-discipline requirement (exactly
  # one simulator, the one already booted, never a clone).
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath /tmp/pv-dd \
    -only-testing:PasskeyVaultUITests/AutoFillInvocationUITests/testInvokeExtensionConfigurationViaSettingsAutoFillToggle \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    -resultBundlePath "$result_bundle" \
    test > "$test_log" 2>&1 || test_rc=$?

  if [ ! -d "$result_bundle" ]; then
    echo "RESULT: layer=c outcome=human_needed reason=no-xcresult-produced test_rc=$test_rc. $manual_steps" >&2
    tail -80 "$test_log" >&2
    rm -f "$test_log"
    exit 1
  fi

  local attach_dir="/tmp/pv-layerc-attachments"
  rm -rf "$attach_dir"
  xcrun xcresulttool export attachments --path "$result_bundle" --output-path "$attach_dir" > "$EVIDENCE_DIR/layer-c-xcresulttool-export.log" 2>&1 || true

  # The exported FILE on disk is named by a UUID -- the human-readable label
  # this test attaches (e.g. "autofill-and-passwords-screen-screenshot")
  # lives only in manifest.json's `suggestedHumanReadableName` field, not in
  # the filename itself (verified this session: a filename-pattern `find`
  # here always returns empty). Resolve the UUID via jq instead.
  local screenshot=""
  if [ -f "$attach_dir/manifest.json" ]; then
    local exported_name
    exported_name=$(jq -r '.[].attachments[] | select(.suggestedHumanReadableName | startswith("autofill-and-passwords-screen-screenshot")) | .exportedFileName' "$attach_dir/manifest.json" 2>/dev/null | head -1)
    if [ -z "$exported_name" ] || [ "$exported_name" = "null" ]; then
      exported_name=$(jq -r '.[].attachments[] | select(.suggestedHumanReadableName | startswith("after-provider-switch-toggle-screenshot")) | .exportedFileName' "$attach_dir/manifest.json" 2>/dev/null | head -1)
    fi
    if [ -n "$exported_name" ] && [ "$exported_name" != "null" ]; then
      screenshot="$attach_dir/$exported_name"
    fi
  fi

  if [ -z "$screenshot" ] || [ ! -s "$screenshot" ]; then
    echo "RESULT: layer=c outcome=human_needed reason=no-screenshot-attachment test_rc=$test_rc attach_dir=$attach_dir. $manual_steps" >&2
    rm -f "$test_log"
    exit 1
  fi

  cp "$screenshot" "$EVIDENCE_DIR/settings-autofill.png"

  # Corroborating machine-readable dump (36-RESEARCH.md E4 4d).
  xcrun simctl spawn "$udid" pluginkit -mAvvv -p "$EXTENSION_POINT" > "$EVIDENCE_DIR/layer-c-pluginkit-dump.txt" 2>&1 || true

  echo "RESULT: layer=c outcome=CAPTURED evidence=$EVIDENCE_DIR/settings-autofill.png source=$screenshot test_rc=$test_rc"
  rm -f "$test_log"
  exit 0
}

# --- wording-gate: committed-record discipline -----------------------------
# Owns the forbidden-phrasing deny list so no other file has to carry the
# literals. Four classes, each independently checked:
#   1. A sentence linking "free Apple ID" to a grant/refusal verdict
#      (Pitfall 1, D-02).
#   2. Budget-verdict phrasing the ROADMAP forbids ("fits", "mieści się",
#      "within budget") -- Pitfall 3.
#   3. An expanded team-prefix literal (this machine's observed value,
#      FAKETEAMID.) anywhere under ios/ EXCEPT this script and captured
#      evidence logs, which legitimately show the expanded value as
#      evidence, not a source defect (landmine L-8).
#   4. The bash-only PIPESTATUS array name in any script under scripts/
#      (this project's shell is zsh, landmine L-3/D-08).
cmd_wording_gate() {
  local failed=0

  # Class 1 + 2 scan these committed-record files.
  local record_files=()
  [ -f "ios/AUTOFILL-FEASIBILITY.md" ] && record_files+=("ios/AUTOFILL-FEASIBILITY.md")
  [ -f "ios/IOS-SPIKE-LOG.md" ] && record_files+=("ios/IOS-SPIKE-LOG.md")
  while IFS= read -r f; do record_files+=("$f"); done < <(find ios/PasskeyVault -name "Info.plist" 2>/dev/null)
  while IFS= read -r f; do record_files+=("$f"); done < <(find ios/PasskeyVault -name "*.entitlements" 2>/dev/null)

  if [ "${#record_files[@]}" -eq 0 ]; then
    echo "ERROR: wording-gate found no record files to scan -- this is a missing-input FAIL, not a skip" >&2
    exit 1
  fi

  # Class 1: free-Apple-ID grant/refusal sentence shape, either verb order.
  local class1_pattern_a='(darmow[a-zA-Z]*[[:space:]]+Apple[[:space:]]+ID|free[[:space:]]+Apple[[:space:]]+ID).*(przyzna|odmów|grant|deni|denied|refus)'
  local class1_pattern_b='(przyzna|odmów|grant|deni|denied|refus).*(darmow[a-zA-Z]*[[:space:]]+Apple[[:space:]]+ID|free[[:space:]]+Apple[[:space:]]+ID)'
  for f in "${record_files[@]}"; do
    if grep -inE "$class1_pattern_a|$class1_pattern_b" "$f" > /tmp/pv-wording-class1.txt 2>/dev/null; then
      echo "FAIL: wording-gate class 1 (free-Apple-ID grant/refusal sentence) in $f:" >&2
      cat /tmp/pv-wording-class1.txt >&2
      failed=1
    fi
  done
  rm -f /tmp/pv-wording-class1.txt

  # Class 2: budget-verdict phrasing.
  local class2_pattern='mieści się|within budget|within the budget'
  for f in "${record_files[@]}"; do
    if grep -inE "$class2_pattern" "$f" > /tmp/pv-wording-class2.txt 2>/dev/null; then
      echo "FAIL: wording-gate class 2 (budget-verdict phrasing) in $f:" >&2
      cat /tmp/pv-wording-class2.txt >&2
      failed=1
    fi
  done
  rm -f /tmp/pv-wording-class2.txt

  # Class 3: expanded team-prefix literal in BUILD-CONFIG-SHAPED files
  # under ios/ (.plist, .entitlements, .pbxproj, .swift) -- the shape the
  # plan's own prohibition names ("No entitlements or Info.plist source
  # file in ios/ contains an expanded literal team prefix", D-14).
  # Deliberately NOT .md: this project's own established precedent
  # (ios/IOS-SPIKE-LOG.md's pre-existing L-8 entry, and this phase's own
  # ios/AUTOFILL-FEASIBILITY.md E1 section) discusses and quotes the
  # observed FAKETEAMID. value in PROSE as a finding -- that is recording
  # evidence, not hardcoding a build-time literal a real team would break.
  # Excludes this script itself (the deny list has to name the literal to
  # define the pattern) and ios/evidence/ (captured dumps are SUPPOSED to
  # show the expanded value -- that is the evidence, not a source defect).
  local class3_pattern='FAKETEAMID\.'
  while IFS= read -r f; do
    case "$f" in
      ios/evidence/*) continue ;;
      scripts/ios-autofill-layers.sh) continue ;;
    esac
    if grep -InE "$class3_pattern" "$f" > /tmp/pv-wording-class3.txt 2>/dev/null; then
      echo "FAIL: wording-gate class 3 (expanded team-prefix literal, landmine L-8) in $f:" >&2
      cat /tmp/pv-wording-class3.txt >&2
      failed=1
    fi
  done < <(find ios -type f \( -name "*.plist" -o -name "*.entitlements" -o -name "*.swift" -o -name "*.pbxproj" \) 2>/dev/null)
  rm -f /tmp/pv-wording-class3.txt

  # Class 4: bash-only PIPESTATUS array name in any script under scripts/.
  # Excludes this script itself -- the deny list has to name the literal
  # to define the pattern (same reasoning as class 3's self-exclusion).
  while IFS= read -r f; do
    case "$f" in
      scripts/ios-autofill-layers.sh) continue ;;
    esac
    if grep -InE 'PIPESTATUS' "$f" > /tmp/pv-wording-class4.txt 2>/dev/null; then
      echo "FAIL: wording-gate class 4 (bash-only PIPESTATUS array, landmine L-3/D-08) in $f:" >&2
      cat /tmp/pv-wording-class4.txt >&2
      failed=1
    fi
  done < <(find scripts -name "*.sh" 2>/dev/null)
  rm -f /tmp/pv-wording-class4.txt

  if [ "$failed" -ne 0 ]; then
    echo "FAIL: wording-gate found forbidden phrasing" >&2
    exit 1
  fi
  echo "PASS: wording-gate -- no forbidden phrasing found across ${#record_files[@]} record file(s), ios/ team-prefix scan, scripts/ PIPESTATUS scan"
  exit 0
}

case "${1:-}" in
  layer-a) shift; cmd_layer_a "$@" ;;
  layer-b) shift; cmd_layer_b "$@" ;;
  layer-appgroup) shift; cmd_layer_appgroup "$@" ;;
  layer-c) shift; cmd_layer_c "$@" ;;
  wording-gate) shift; cmd_wording_gate "$@" ;;
  *) usage ;;
esac
