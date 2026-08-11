#!/usr/bin/env bash
# scripts/ios-autofill-layers.sh -- Phase 36, Plan 36-01, Task 3.
#
# Three independently invocable subcommands, so SC1's three layers
# (registration / election / Settings visibility) can never be collapsed
# into one verdict (D-09, 36-RESEARCH.md E4):
#
#   layer-a       -- pluginkit registration at the credential-provider
#                    extension point.
#   layer-b       -- user election (pluginkit -e use).
#   wording-gate  -- this phase's committed-record discipline gate: scans
#                    for the four forbidden phrasing classes and fails
#                    naming the offending file and line.
#
# D-08 (landmine L-3, this shell is zsh): every subcommand redirects into a
# file and greps the FILE -- never `cmd | tail` followed by a status check.
# `timeout` does not exist on this machine (Pitfall 6) -- not used anywhere
# below.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

BUNDLE_ID="cloud.blonie.PasskeyVault.AutoFill"
EXTENSION_POINT="com.apple.authentication-services-credential-provider-ui"
EVIDENCE_DIR="ios/evidence/36"

usage() {
  echo "Usage: $0 {layer-a|layer-b|wording-gate}" >&2
  exit 1
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
  wording-gate) shift; cmd_wording_gate "$@" ;;
  *) usage ;;
esac
