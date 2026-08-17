#!/usr/bin/env bash
#
# ios-dock-evidence.sh -- render the vault dock's evidence screenshots and print
# its measured geometry, in both appearances.
#
# Runs `VaultDockEvidenceUITests.testDockEvidence` ONCE PER APPEARANCE, exports
# the `XCTAttachment` screenshots out of each `.xcresult`, and copies them into
# `ios/evidence/38/` under stable names. The test method is single-copy; only the
# simulator's appearance differs between the two runs, so the light and dark
# shots are guaranteed to be of the same states rather than of two hand-written
# sequences that can drift apart.
#
# WHY `xcresulttool export attachments` AND NOT AN EXTERNAL `simctl io
# screenshot` LOOP. The predecessor rig held each state still for 7-12 s so a
# host-side capture loop could grab it, then left a human to pick the right frame
# out of ~50. That is a timing race dressed up as a harness. Attachments are
# named at the moment they are taken, so the mapping from state to file is
# recorded by the test rather than reconstructed afterwards -- `manifest.json`
# carries `suggestedHumanReadableName` for every file.
#
# The ONE state that genuinely cannot be captured this way is the mid-scroll
# minimised bar, because the gesture API is synchronous. That is solved inside
# the test (a background-queue screenshot fired partway into a
# `thenHoldForDuration:` hold), not out here.
#
# Requires: a live `pv-server` on 127.0.0.1:8621 (the fixture registers a real
# account and creates 21 real encrypted items through it).
#
# Usage: scripts/ios-dock-evidence.sh [light|dark|both]      (default: both)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

UDID_FILE="/private/tmp/pv16.udid"
if [ ! -f "$UDID_FILE" ]; then
  echo "ERROR: $UDID_FILE not found -- write the iPhone 16 simulator's UDID there." >&2
  exit 1
fi
UDID="$(cat "$UDID_FILE")"

PROJECT="ios/PasskeyVault/PasskeyVault.xcodeproj"
SCHEME="PasskeyVault"
# Debug ONLY. A Release build of this app crashes swift-frontend
# (ios/evidence/38/L14-RELEASE-BUILD-CRASH.md).
CONFIGURATION="Debug"
TEST_ID="PasskeyVaultUITests/VaultDockEvidenceUITests/testDockEvidence"
EVIDENCE_DIR="ios/evidence/38"
# The attachment names already start with "dock-", so the prefix must not.
PREFIX="38-06b"
# A STABLE, gitignored output root rather than `mktemp -d` with a cleanup trap.
# The first run of this script failed an assertion and the trap deleted the
# xcodebuild log along with the bundle -- so the one artifact needed to diagnose
# the failure was destroyed by the harness at exactly the moment it mattered.
# Logs and result bundles are cheap; a lost failure is not.
OUT_ROOT="ios/PasskeyVault/build/dock-evidence"
rm -rf "$OUT_ROOT"
mkdir -p "$OUT_ROOT"

# The attachment names the test sets, mapped to the evidence filename stem.
# Keep in lock-step with `VaultDockEvidenceUITests`' `attach(...)` calls.
ATTACHMENTS="dock-at-rest dock-minimized-mid-scroll dock-panel-open-minimized dock-panel-open dock-panel-dismissed-by-tab-change"

# Fail LOUD if the server is not up: without it the fixture never seeds, the
# test waits out its 180 s timeout and the failure reads like a UI bug.
if ! curl -fsS -m 5 http://127.0.0.1:8621/healthz >/dev/null; then
  echo "ERROR: no pv-server answering on http://127.0.0.1:8621/healthz" >&2
  echo "       start it first: PV_ADDR=127.0.0.1:8621 cargo run -p pv-server" >&2
  exit 1
fi

run_appearance() {
  local appearance="$1"
  local result="$OUT_ROOT/$appearance.xcresult"
  local exported="$OUT_ROOT/$appearance-attachments"

  echo "==> appearance: $appearance"
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || xcrun simctl boot "$UDID" || true
  xcrun simctl ui "$UDID" appearance "$appearance"

  # `id=` and never `name=`: two simulators can share a name, and the wrong one
  # booting is indistinguishable from a hang.
  #
  # `caffeinate -i` because this run takes minutes (a real registration plus 21
  # real encrypted item creations) and a sleeping machine kills xcodebuild
  # mid-seed.
  #
  # No `| tee`-style pipe-status games: this shell is zsh, where bash's
  # PIPESTATUS is spelled `$pipestatus`, and the bash spelling is silently empty
  # here (landmine L-3). The build log is redirected to a file and the exit
  # status read directly instead.
  local log="$OUT_ROOT/$appearance-xcodebuild.log"
  set +e
  caffeinate -i xcodebuild test \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "id=$UDID" \
    -only-testing:"$TEST_ID" \
    -parallel-testing-enabled NO \
    -resultBundlePath "$result" \
    > "$log" 2>&1
  local status=$?
  set -e

  # The measured geometry is the other half of this script's output, and it is
  # printed whether the run passed or failed -- a failed clearance assertion is
  # exactly when the numbers matter most.
  echo "--- PV-DOCK-GEOM ($appearance) ---"
  grep -a 'PV-DOCK-GEOM' "$log" | sed 's/^[[:space:]]*//' | sort -u || true
  grep -a 'PV-DOCK-TREE' "$log" | sed 's/^[[:space:]]*//' || true
  echo "----------------------------------"

  if [ "$status" -ne 0 ]; then
    echo "ERROR: xcodebuild test FAILED for $appearance (exit $status). Tail:" >&2
    tail -40 "$log" >&2
    echo "full log: $ROOT/$log" >&2
    echo "result bundle: $ROOT/$result" >&2
    return "$status"
  fi

  xcrun xcresulttool export attachments \
    --path "$result" --output-path "$exported" >/dev/null

  mkdir -p "$EVIDENCE_DIR"
  local copied=0
  for name in $ATTACHMENTS; do
    # `manifest.json` maps `suggestedHumanReadableName` -> `exportedFileName`.
    # Resolved with python rather than a grep, because the JSON nests one array
    # per test and a line-oriented match would pair the wrong two fields.
    local file
    file="$(python3 - "$exported/manifest.json" "$name" <<'PY'
import json, sys
manifest_path, wanted = sys.argv[1], sys.argv[2]
with open(manifest_path) as f:
    manifest = json.load(f)
for test in manifest:
    for att in test.get("attachments", []):
        # XCTest rewrites the name as "<given>_<n>_<UUID>.png" before it reaches
        # the manifest, so an equality match finds nothing. Prefix, anchored, so
        # "dock-panel-open" cannot be satisfied by "dock-panel-open-2".
        name = att.get("suggestedHumanReadableName") or ""
        if name == wanted or name.startswith(wanted + "_"):
            print(att["exportedFileName"])
            sys.exit(0)
sys.exit(1)
PY
)" || { echo "ERROR: attachment '$name' not in the result bundle" >&2; return 1; }
    cp "$exported/$file" "$EVIDENCE_DIR/$PREFIX-$name-$appearance.png"
    echo "    wrote $EVIDENCE_DIR/$PREFIX-$name-$appearance.png"
    copied=$((copied + 1))
  done
  # A copy loop that copies nothing must not report success (this repo's own
  # L-9: a check that cannot fail is not a check).
  if [ "$copied" -eq 0 ]; then
    echo "ERROR: exported zero attachments -- the manifest shape changed" >&2
    return 1
  fi

  # GROUND TRUTH for the panel's clearance above the dock, measured from the
  # pixels just exported. The UI test measures the same thing off accessibility
  # frames, which stop 16 pt short of the glass card's real bottom edge -- so the
  # test is the regression gate and this is the number to quote.
  echo "--- panel-to-dock gap, measured from pixels ($appearance) ---"
  python3 "$ROOT/scripts/measure-ios-dock-panel.py" \
    --label "$appearance-expanded" \
    "$EVIDENCE_DIR/$PREFIX-dock-panel-open-$appearance.png" | tail -4
  python3 "$ROOT/scripts/measure-ios-dock-panel.py" \
    --label "$appearance-minimised" \
    "$EVIDENCE_DIR/$PREFIX-dock-panel-open-minimized-$appearance.png" | tail -4
  echo "-------------------------------------------------------------"
}

case "${1:-both}" in
  light) run_appearance light ;;
  dark)  run_appearance dark ;;
  both)
    run_appearance light
    run_appearance dark
    ;;
  *) echo "usage: $0 [light|dark|both]" >&2; exit 2 ;;
esac

# Leave the simulator where a human expects to find it.
xcrun simctl ui "$UDID" appearance light || true
echo "==> done"
