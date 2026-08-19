#!/usr/bin/env bash
# scripts/ios-freshness-e-f1-proof.sh -- Phase 39, Plan 39-06, Task 2 (E-F1).
#
# Proves T-39-23: the freshness timestamp does NOT advance on a pull the
# server never answered, and that the comparison is shown able to fail (a
# control run where it DOES advance).
#
# THREE `xcodebuild test` invocations against `FreshnessLiveProofTests`,
# sharing one isolated `pv-server` (started once via ios-live-server.sh
# --exec) and reading their own small JSON probes back off the SAME App
# Group container the production cache already lives in (the host-read
# technique scripts/ios-sync-live-proof.sh already established):
#
#   1. CONTROL FIRST (`twoConfirmedPullsInSequenceAdvanceTheTimestamp`) --
#      it purges the cache itself and is fully self-contained, so it must
#      run and finish BEFORE the baseline below, whose own purge would
#      otherwise destroy it.
#   2. BASELINE (`establishABaselineWithAConfirmedPull`) -- purges, signs
#      up a fresh throwaway account, one confirmed pull. Leaves a REAL
#      persisted CachedSnapshot behind for step 4 to read.
#   3. STOP THE SERVER FOR REAL -- SIGTERM to the PID `lsof` reports bound
#      to the port, confirmed dead by both an empty `lsof` re-check and a
#      failing `curl healthz`. An external action; nothing in
#      FreshnessLiveProofTests.swift ever touches this.
#   4. AFTER-STOP (`aForcedPullAgainstAStoppedServerLeavesTheCacheUntouched`)
#      -- deliberately does NOT sign in (it cannot, the server is down);
#      reads the SAME persisted snapshot step 2 left via a matching
#      accountId, attempts a pull, and confirms it is unchanged.
#
# Shell discipline (L-3): zsh's bash-only PIPESTATUS is silently empty
# here; every exit code this script reacts to is a direct command's own
# $?, never read through a pipeline.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EVIDENCE_FILE="ios/evidence/39/06-freshness-host.md"
HOST_BUNDLE_ID="cloud.blonie.PasskeyVault"
APP_GROUP_ID="group.cloud.blonie.PasskeyVault"
SIM_UDID_FILE="/private/tmp/pv16.udid"
PORT="${PV_IOS_PORT:-8622}"

# --- outer invocation: bring up the isolated server, then re-exec self ----
if [ -z "${PV_IOS_BASE:-}" ]; then
  export PV_IOS_EVIDENCE_FILE="/dev/null"
  export PV_IOS_PORT="$PORT"
  exec "${REPO_ROOT}/scripts/ios-live-server.sh" --exec \
    "${REPO_ROOT}/scripts/ios-freshness-e-f1-proof.sh"
fi

# --- inner invocation: PV_IOS_BASE/PV_IOS_DB are exported ------------------
mkdir -p "$(dirname "$EVIDENCE_FILE")"

if [ ! -f "$SIM_UDID_FILE" ]; then
  echo "ERROR: no simulator udid recorded at ${SIM_UDID_FILE}." >&2
  exit 1
fi
SIM_UDID="$(cat "$SIM_UDID_FILE")"

TIMESTAMP="$(date +%s)"
ACCOUNT_ID="pv-39-06-freshness-${TIMESTAMP}@example.invalid"
ACCOUNT_PASSWORD="pv-39-06 freshness account password ${TIMESTAMP}"
CONTROL_ACCOUNT_ID="pv-39-06-freshness-control-${TIMESTAMP}@example.invalid"
CONTROL_ACCOUNT_PASSWORD="pv-39-06 freshness control password ${TIMESTAMP}"

SCRATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pv-39-06-ef1.XXXXXX")"
cleanup() { rm -rf "$SCRATCH_DIR"; }
trap cleanup EXIT

export PV_TEST_SERVER="$PV_IOS_BASE"
export TEST_RUNNER_PV_TEST_SERVER="$PV_IOS_BASE"
export PV_FRESHNESS_ACCOUNT_ID="$ACCOUNT_ID"
export TEST_RUNNER_PV_FRESHNESS_ACCOUNT_ID="$ACCOUNT_ID"
export PV_FRESHNESS_ACCOUNT_PASSWORD="$ACCOUNT_PASSWORD"
export TEST_RUNNER_PV_FRESHNESS_ACCOUNT_PASSWORD="$ACCOUNT_PASSWORD"
export PV_FRESHNESS_CONTROL_ACCOUNT_ID="$CONTROL_ACCOUNT_ID"
export TEST_RUNNER_PV_FRESHNESS_CONTROL_ACCOUNT_ID="$CONTROL_ACCOUNT_ID"
export PV_FRESHNESS_CONTROL_ACCOUNT_PASSWORD="$CONTROL_ACCOUNT_PASSWORD"
export TEST_RUNNER_PV_FRESHNESS_CONTROL_ACCOUNT_PASSWORD="$CONTROL_ACCOUNT_PASSWORD"

run_test() {
  local method="$1"
  local label="$2"
  local result="${SCRATCH_DIR}/${label}.xcresult"
  local log="${SCRATCH_DIR}/${label}.log"
  echo "==> xcodebuild test: ${method}"
  local status=0
  xcodebuild test \
    -project "${REPO_ROOT}/ios/PasskeyVault/PasskeyVault.xcodeproj" \
    -scheme PasskeyVault \
    -configuration Debug \
    -destination "platform=iOS Simulator,id=${SIM_UDID}" \
    -parallel-testing-enabled NO \
    "-only-testing:PasskeyVaultTests/FreshnessLiveProofTests/${method}" \
    -resultBundlePath "$result" \
    >"$log" 2>&1 || status=$?
  local total_count
  total_count="$(xcrun xcresulttool get test-results summary --path "$result" 2>/dev/null | jq -r '.totalTestCount // 0' 2>/dev/null || echo 0)"
  if [ "$status" -ne 0 ] || [ "$total_count" -eq 0 ]; then
    echo "ERROR: ${method} FAILED (exit=${status}, totalTestCount=${total_count})." >&2
    tail -100 "$log" >&2
    exit 1
  fi
  echo "    PASSED (totalTestCount=${total_count})"
}

resolve_app_group_container() {
  xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true
  xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1 || true
  local out="${SCRATCH_DIR}/appgroup-host.txt"
  xcrun simctl get_app_container "$SIM_UDID" "$HOST_BUNDLE_ID" groups >"$out" 2>&1 || true
  local path
  path="$(awk -F'\t' -v g="$APP_GROUP_ID" '$1==g{print $2}' "$out" | head -1)"
  if [ -z "$path" ] || [ ! -d "$path" ]; then
    echo "ERROR: could not resolve the App Group container for ${APP_GROUP_ID}." >&2
    cat "$out" >&2
    exit 1
  fi
  echo "$path"
}

# --- 1. CONTROL FIRST -------------------------------------------------------
run_test "twoConfirmedPullsInSequenceAdvanceTheTimestamp()" "control"
CONTAINER_PATH="$(resolve_app_group_container)"
CONTROL_PROBE="${CONTAINER_PATH}/freshness-probe-control.json"
if [ ! -f "$CONTROL_PROBE" ]; then
  echo "ERROR: control probe not found at ${CONTROL_PROBE}." >&2
  exit 1
fi
CONTROL_BEFORE_TS="$(jq -r '.beforeTs' "$CONTROL_PROBE")"
CONTROL_BEFORE_RENDERED="$(jq -r '.beforeRendered' "$CONTROL_PROBE")"
CONTROL_AFTER_TS="$(jq -r '.afterTs' "$CONTROL_PROBE")"
CONTROL_AFTER_RENDERED="$(jq -r '.afterRendered' "$CONTROL_PROBE")"
echo "    control: before=${CONTROL_BEFORE_TS} after=${CONTROL_AFTER_TS}"

# --- 2. BASELINE (server still up) ------------------------------------------
run_test "establishABaselineWithAConfirmedPull()" "baseline"
CONTAINER_PATH="$(resolve_app_group_container)"
BEFORE_PROBE="${CONTAINER_PATH}/freshness-probe-before.json"
if [ ! -f "$BEFORE_PROBE" ]; then
  echo "ERROR: baseline probe not found at ${BEFORE_PROBE}." >&2
  exit 1
fi
BEFORE_TS="$(jq -r '.ts' "$BEFORE_PROBE")"
BEFORE_RENDERED="$(jq -r '.rendered' "$BEFORE_PROBE")"
echo "    baseline: before=${BEFORE_TS}"

# --- 3. STOP THE SERVER FOR REAL --------------------------------------------
# `lsof -ti :PORT` matches EVERY process with a socket touching that port --
# NOT ONLY the server's own LISTEN socket, but ALSO the app's own
# ESTABLISHED connection to it from the OTHER side (39-06 Task 3's own
# finding, ios/evidence/39/06-freshness-host.md -- an unfiltered kill here
# risks terminating the very client process the proof needs to keep
# running). Filtered to the actual `pv-server` binary by command name.
SERVER_PIDS="$(lsof -ti ":${PORT}" 2>/dev/null | while IFS= read -r pid; do
  if ps -p "$pid" -o comm= 2>/dev/null | grep -q 'pv-server'; then
    echo "$pid"
  fi
done)"
if [ -z "$SERVER_PIDS" ]; then
  echo "ERROR: no pv-server process found listening on :${PORT} -- cannot stop what isn't running." >&2
  exit 1
fi
echo "==> stopping pv-server: kill -TERM $(echo "$SERVER_PIDS" | tr '\n' ' ') (PID(s) resolved via lsof -ti :${PORT}, filtered to pv-server by command name)"
echo "$SERVER_PIDS" | while IFS= read -r pid; do
  [ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null || true
done
DEAD=0
for _ in $(seq 1 50); do
  if [ -z "$(lsof -ti ":${PORT}" 2>/dev/null || true)" ] && ! curl -fsS -m 1 "${PV_IOS_BASE}/healthz" >/dev/null 2>&1; then
    DEAD=1
    break
  fi
  sleep 0.2
done
if [ "$DEAD" -ne 1 ]; then
  echo "ERROR: pv-server (PID ${SERVER_PID}) did not die within 10s of SIGTERM." >&2
  exit 1
fi
echo "    confirmed dead: lsof -ti :${PORT} is empty AND curl ${PV_IOS_BASE}/healthz fails"

# --- 4. AFTER-STOP (server down) --------------------------------------------
run_test "aForcedPullAgainstAStoppedServerLeavesTheCacheUntouched()" "after-stop"
CONTAINER_PATH="$(resolve_app_group_container)"
AFTER_PROBE="${CONTAINER_PATH}/freshness-probe-after.json"
if [ ! -f "$AFTER_PROBE" ]; then
  echo "ERROR: after-stop probe not found at ${AFTER_PROBE}." >&2
  exit 1
fi
AFTER_TS="$(jq -r '.ts' "$AFTER_PROBE")"
AFTER_RENDERED="$(jq -r '.rendered' "$AFTER_PROBE")"
echo "    after-stop: after=${AFTER_TS}"

# --- assertions, shell-side (the test itself already asserted these; this
# is the evidence-writer's own independent confirmation) --------------------
FAIL=0
if [ "$BEFORE_TS" != "$AFTER_TS" ]; then
  echo "ERROR: BEFORE-TS (${BEFORE_TS}) != AFTER-TS (${AFTER_TS}) -- the timestamp moved on a failed pull." >&2
  FAIL=1
fi
if [ "$BEFORE_RENDERED" != "$AFTER_RENDERED" ]; then
  echo "ERROR: rendered string changed across the failed pull." >&2
  FAIL=1
fi
if [ "$CONTROL_BEFORE_TS" = "$CONTROL_AFTER_TS" ]; then
  echo "ERROR: control pair did not differ -- the comparison itself is not live." >&2
  FAIL=1
fi

# --- evidence ----------------------------------------------------------------
{
  echo "# Phase 39, Plan 39-06 -- freshness evidence (host app)"
  echo
  echo "## Task 2 -- E-F1: the timestamp does not advance when the server cannot answer"
  echo
  echo "- Server: ${PV_IOS_BASE}"
  echo "- Simulator UDID: ${SIM_UDID}"
  echo "- Baseline account: ${ACCOUNT_ID}"
  echo "- Control account: ${CONTROL_ACCOUNT_ID}"
  echo "- App Group container (host path): ${CONTAINER_PATH}"
  echo
  echo "### Methodology note on the rendered strings"
  echo
  echo "Both processes render \`SyncFreshness.describe(syncedAtMs:reference:)\` with \`reference\`"
  echo "pinned to the synced instant itself (elapsed = 0), not to \"now\" -- two independent"
  echo "\`xcodebuild test\` invocations, separated by the host script's kill sequence, would"
  echo "otherwise risk the RELATIVE phrase crossing a minute boundary between captures for reasons"
  echo "unrelated to whether the freshness value moved. This still calls the real production"
  echo "formatter; only the reference instant fed to it is pinned for reproducibility."
  echo
  echo "### Failed-pull comparison"
  echo
  echo "| capture | stored \`syncedAtMs\` | rendered string |"
  echo "|---|---|---|"
  echo "| before (server up, confirmed pull) | \`${BEFORE_TS}\` | \`${BEFORE_RENDERED}\` |"
  echo "| after (server stopped, forced pull) | \`${AFTER_TS}\` | \`${AFTER_RENDERED}\` |"
  echo
  if [ "$BEFORE_TS" = "$AFTER_TS" ] && [ "$BEFORE_RENDERED" = "$AFTER_RENDERED" ]; then
    echo "**Identical.** The stored timestamp and the rendered string are unchanged across the"
    echo "failed pull."
  else
    echo "**NOT identical -- see stderr of this run.**"
  fi
  echo
  echo "### Control (comparison shown able to fail, D-08)"
  echo
  echo "With the server up throughout, two confirmed pulls 1.5s apart:"
  echo
  echo "| capture | stored \`syncedAtMs\` | rendered string |"
  echo "|---|---|---|"
  echo "| control before | \`${CONTROL_BEFORE_TS}\` | \`${CONTROL_BEFORE_RENDERED}\` |"
  echo "| control after | \`${CONTROL_AFTER_TS}\` | \`${CONTROL_AFTER_RENDERED}\` |"
  echo
  if [ "$CONTROL_BEFORE_TS" != "$CONTROL_AFTER_TS" ]; then
    echo "**Different.** The same comparison DOES report a difference when a second pull actually"
    echo "succeeds, proving \"unchanged\" above is not indistinguishable from a comparison that"
    echo "never ran."
  else
    echo "**NOT different -- the control did not advance. See stderr of this run.**"
  fi
  echo
  echo "### Means of stopping the server"
  echo
  echo "\`kill -TERM \${SERVER_PID}\`, where \`SERVER_PID\` was resolved via \`lsof -ti :${PORT}\` --"
  echo "an external action against the real, separate \`pv-server\` process, never a flag inside"
  echo "client code. Confirmed dead by BOTH an empty \`lsof -ti :${PORT}\` re-check AND a failing"
  echo "\`curl ${PV_IOS_BASE}/healthz\`."
  echo
  echo "### What every visible sync-related surface displayed during the failed pull"
  echo
  echo "This app builds no separate connection indicator (\`SyncStatusView\`'s own header) --"
  echo "the ONLY sync-related surface is the last-synced text, and \`FreshnessLiveProofTests"
  echo ".aForcedPullAgainstAStoppedServerLeavesTheCacheUntouched()\` asserts its underlying value"
  echo "(\`store.currentSnapshot?.syncedAtMs\`) is unchanged (see the table above) -- no surface"
  echo "anywhere claimed the pull succeeded; the pull's own error is caught and swallowed by"
  echo "\`VaultStore.refresh()\`'s caller-visible contract exactly as it is for any other network"
  echo "failure, never surfaced as a success."
  echo
  echo "\`\`\`"
  echo "E-F1-BEFORE-TS: ${BEFORE_TS}"
  echo "E-F1-AFTER-TS: ${AFTER_TS}"
  echo "E-F1-CONTROL-BEFORE-TS: ${CONTROL_BEFORE_TS}"
  echo "E-F1-CONTROL-AFTER-TS: ${CONTROL_AFTER_TS}"
  echo "\`\`\`"
  echo
} >>"$EVIDENCE_FILE"

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi

echo "==> PASS: E-F1 -- failed pull leaves the freshness value unchanged; control shows the comparison is live."
