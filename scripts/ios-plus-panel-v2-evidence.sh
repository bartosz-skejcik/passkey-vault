#!/usr/bin/env bash
#
# ios-plus-panel-v2-evidence.sh -- render the ＋ panel's eight-action grid and
# the QR scanner's no-camera fallback, in both appearances.
#
# Quick task 260818-lsk. Mirrors `scripts/ios-dock-evidence.sh`'s own
# mechanism exactly, at smaller scale: runs
# `VaultDockEvidenceUITests.testPlusPanelEightActionsAndScannerNoCameraFallback`
# ONCE PER APPEARANCE, exports the `XCTAttachment` screenshots out of each
# `.xcresult`, and copies them into `ios/evidence/38/plus-panel-v2/` under
# stable names. See that script's own header for why this is
# `xcresulttool export attachments` and not a host-side `simctl io
# screenshot` timing loop -- the same reasoning applies here unchanged.
#
# Usage: scripts/ios-plus-panel-v2-evidence.sh [light|dark|both]  (default: both)

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
CONFIGURATION="Debug"
TEST_ID="PasskeyVaultUITests/VaultDockEvidenceUITests/testPlusPanelEightActionsAndScannerNoCameraFallback"
EVIDENCE_DIR="ios/evidence/38/plus-panel-v2"
PREFIX="38-14"
OUT_ROOT="ios/PasskeyVault/build/plus-panel-v2-evidence"
rm -rf "$OUT_ROOT"
mkdir -p "$OUT_ROOT"

# The attachment names the test sets (`VaultDockEvidenceUITests`'
# `testPlusPanelEightActionsAndScannerNoCameraFallback`), mapped to the
# evidence filename stem.
ATTACHMENTS="plus-panel-v2-eight-actions plus-panel-v2-scanner-no-camera-fallback plus-panel-v2-manual-entry-reaches-code-form"

# Fail LOUD if the server is not up -- same reasoning as ios-dock-evidence.sh:
# without it the account registration this test does never completes, and the
# failure reads like a UI bug instead of a missing dependency.
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
    local file
    file="$(python3 - "$exported/manifest.json" "$name" <<'PY'
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
)" || { echo "ERROR: attachment '$name' not in the result bundle" >&2; return 1; }
    cp "$exported/$file" "$EVIDENCE_DIR/$PREFIX-$name-$appearance.png"
    echo "    wrote $EVIDENCE_DIR/$PREFIX-$name-$appearance.png"
    copied=$((copied + 1))
  done
  if [ "$copied" -eq 0 ]; then
    echo "ERROR: exported zero attachments -- the manifest shape changed" >&2
    return 1
  fi
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

xcrun simctl ui "$UDID" appearance light || true
echo "==> done"
