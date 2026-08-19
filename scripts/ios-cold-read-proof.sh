#!/usr/bin/env bash
# scripts/ios-cold-read-proof.sh -- Phase 39, Plan 39-07, Tasks 1 & 2
# (SYNC-02/SYNC-04, E-C1/E-C3/E-F1's cross-process half).
#
# THE proof no existing client in this product has had to produce: a
# snapshot written by the HOST process is read, cold, by a SECOND,
# independently scheduled process (the real credential-provider extension --
# `ios/evidence/39/02-branch-gate.md` already fixed the sentence this run is
# permitted to close on, before this script existed to tempt it).
#
# TWO REAL PROCESSES, ONE SHARED CONTAINER, timed via marker files rather
# than a blind race:
#   PHASE A -- host: `ColdReadLiveProofTests.establishHostCacheAndHoldForExternalTermination()`
#     (PasskeyVaultTests, hosted in the REAL `cloud.blonie.PasskeyVault`
#     process) signs in, pulls, writes `coldread-freshness-host.json`, then
#     HOLDS for 25s. This script polls for that marker, captures a BEFORE
#     `launchctl list`, computes its OWN independent SHA-256 over the
#     persisted cache file, issues `xcrun simctl terminate`, and captures an
#     AFTER `launchctl list` -- confirming absence, never assuming it from
#     having issued the command.
#   PHASE B -- extension: `AutoFillInvocationUITests` (Phase 36, unmodified)
#     toggles the AutoFill provider switch in Settings, invoking
#     `CredentialProviderViewController.prepareInterfaceForExtensionConfiguration()`,
#     which runs ONE real extension invocation's worth of sequential
#     evidence (see that file's own `runColdReadEvidenceSequence()` header):
#     positive read + wrong-identifier control, the SAME-snapshot freshness
#     comparison, a HOLD during which THIS script deletes the cache file
#     (the deleted-cache control), a second HOLD during which THIS script
#     writes a snapshot with a deliberately different `syncedAtMs` (the
#     freshness DIFFERENT control), each step signalled by a marker file
#     appearing in the App Group container -- polled for EXISTENCE, never
#     raced against `log stream`'s own attach latency
#     (`scripts/ios-ws-push-proof.sh`'s own documented workaround for that
#     race is unnecessary here).
#
# ONE coordinated clock, not two independent `Date()` reads separated by
# however long this whole proof takes: `REFERENCE_MS` is chosen ONCE here,
# handed to the host test via `PV_COLDREAD_REFERENCE_MS`, and written into
# the App Group container as `freshness-reference.txt` for the extension
# side to read -- see `CredentialProviderViewController.pinnedEvidenceReference()`'s
# own header.
#
# Shell discipline (L-3, ios/IOS-SPIKE-LOG.md Sec 3): zsh's bash-only
# PIPESTATUS is silently empty here; every exit code this script reacts to
# is a direct command's own $?, never read through a pipeline.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EVIDENCE_FILE="ios/evidence/39/07-cold-read.md"
HOST_BUNDLE_ID="cloud.blonie.PasskeyVault"
APP_GROUP_ID="group.cloud.blonie.PasskeyVault"
CACHE_FILE_NAME="vault-cache-v1.json"
# WR-06 (39-REVIEW.md, iteration 2): mirrors
# `AppGroupCiphertextCacheStore.currentAccountMarkerFileName` -- the
# production freshness read (`CredentialProviderViewController
# .renderFreshnessSurface()`/`.logFreshness()`, both WR-05/WR-06) discovers
# WHICH account's cache to read through this file, never the blob alone.
CACHE_MARKER_FILE_NAME="vault-cache-v1-current-account.json"
SIM_UDID_FILE="/private/tmp/pv16.udid"
DD_PATH="/tmp/pv-dd-coldread"
PORT="${PV_IOS_PORT:-8624}"
CONDITION="PV_PROBE_COLDREAD"

# --- outer invocation: bring up the isolated server, then re-exec self ----
if [ -z "${PV_IOS_BASE:-}" ]; then
  export PV_IOS_EVIDENCE_FILE="/dev/null"
  export PV_IOS_PORT="$PORT"
  exec "${REPO_ROOT}/scripts/ios-live-server.sh" --exec \
    "${REPO_ROOT}/scripts/ios-cold-read-proof.sh"
fi

# --- inner invocation: PV_IOS_BASE/PV_IOS_DB are exported ------------------
mkdir -p "$(dirname "$EVIDENCE_FILE")"

if [ ! -f "$SIM_UDID_FILE" ]; then
  echo "ERROR: no simulator udid recorded at ${SIM_UDID_FILE}." >&2
  exit 1
fi
SIM_UDID="$(cat "$SIM_UDID_FILE")"

WASM_GLUE="${REPO_ROOT}/web/src/lib/crypto/wasm/pv_wasm.js"
WASM_BYTES="${REPO_ROOT}/web/public/wasm/pv_wasm_bg.wasm"
if [ ! -f "$WASM_GLUE" ] || [ ! -f "$WASM_BYTES" ]; then
  echo "ERROR: pv-wasm artifact missing at ${WASM_GLUE} / ${WASM_BYTES} -- run scripts/build-wasm.sh first." >&2
  exit 1
fi

SCRATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pv-39-07-coldread.XXXXXX")"
cleanup() { rm -rf "$SCRATCH_DIR"; }
trap cleanup EXIT

echo "==> ensuring the simulator is booted"
xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1 || true

# --- the fixture author: real pv-wasm, register + ONE login item ----------
AUTHOR_SCRIPT="${SCRATCH_DIR}/author.mjs"
cat >"$AUTHOR_SCRIPT" <<'AUTHOR_EOF'
import { readFileSync } from "node:fs";

const [, , base, glueUrl, wasmBytesPath, email, accountPassword, itemPassword] = process.argv;

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

const b64encode = (bytes) => Buffer.from(bytes).toString("base64");

async function req(method, pathname, { body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text.length ? JSON.parse(text) : {};
  } catch {
    parsed = { rawBody: text };
  }
  return { status: res.status, body: parsed };
}

function splitCombinedEncryptedItem(combinedJson) {
  const combined = JSON.parse(combinedJson);
  return {
    encKey: JSON.stringify(combined.enc_key),
    encData: JSON.stringify(combined.enc_data),
  };
}

async function main() {
  const bytes = readFileSync(wasmBytesPath);
  const mod = await import(`file://${glueUrl}`);
  await mod.default({ module_or_path: bytes });

  const salt = mod.randomSalt(16);
  const kdfParamsJson = mod.defaultKdfParamsJson();
  const material = mod.deriveAuthMaterial(new TextEncoder().encode(accountPassword), salt, kdfParamsJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const uk = mod.WasmUserKey.generate();
  const pwWrappedUk = mod.wrapUserKey(wrappingKey, uk);
  const authHashB64 = b64encode(authHash);

  const reg = await req("POST", "/api/auth/register", {
    body: { email, kdf: JSON.parse(kdfParamsJson), salt: b64encode(salt), auth_hash: authHashB64, pw_wrapped_uk: pwWrappedUk },
  });
  if (reg.status !== 201) fail(`register: expected 201, got ${reg.status}: ${JSON.stringify(reg.body)}`);

  const login = await req("POST", "/api/auth/login", { body: { email, auth_hash: authHashB64 } });
  if (login.status !== 200) fail(`login: expected 200, got ${login.status}: ${JSON.stringify(login.body)}`);
  const token = login.body.session_token;
  if (!token) fail("login response carried no session_token");

  const id = crypto.randomUUID();
  const fields = {
    type: "login", name: "39-07 cold-read fixture", folderId: null, tags: [],
    username: "coldread@example.invalid", password: itemPassword, urls: [], notes: "",
  };
  const combined = mod.encryptItem(uk, JSON.stringify(fields), id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const create = await req("POST", "/api/vault/items", { token, body: { id, enc_key: encKey, enc_data: encData } });
  if (create.status !== 201) fail(`create item: expected 201, got ${create.status}: ${JSON.stringify(create.body)}`);

  console.log(JSON.stringify({ email, itemId: id, revision: create.body.revision }));
}

main().catch((e) => fail(e.stack || String(e)));
AUTHOR_EOF

TIMESTAMP="$(date +%s)"
COLDREAD_EMAIL="pv-39-07-coldread-${TIMESTAMP}@example.invalid"
COLDREAD_PASSWORD="pv-39-07 coldread account password ${TIMESTAMP}"
COLDREAD_ITEM_PASSWORD="pv-39-07 coldread item password ${TIMESTAMP}"

echo "==> authoring one login item as the web client (real pv-wasm) against ${PV_IOS_BASE}"
AUTHOR_JSON="${SCRATCH_DIR}/author.json"
if ! node "$AUTHOR_SCRIPT" "$PV_IOS_BASE" "$WASM_GLUE" "$WASM_BYTES" \
      "$COLDREAD_EMAIL" "$COLDREAD_PASSWORD" "$COLDREAD_ITEM_PASSWORD" \
      >"$AUTHOR_JSON" 2>"${SCRATCH_DIR}/author.log"; then
  echo "ERROR: fixture authoring through the real web-client WASM crypto path failed." >&2
  cat "${SCRATCH_DIR}/author.log" >&2
  exit 1
fi
echo "    account: ${COLDREAD_EMAIL}"

# --- ONE coordinated clock (see this file's own header) --------------------
REFERENCE_MS="$(python3 -c 'import time; print(int(time.time() * 1000))')"
echo "==> pinned evidence reference (epoch ms): ${REFERENCE_MS}"

resolve_app_group_container() {
  local out tries=0
  out="${SCRATCH_DIR}/appgroup-host.txt"
  while [ "$tries" -lt 90 ]; do
    xcrun simctl get_app_container "$SIM_UDID" "$HOST_BUNDLE_ID" groups >"$out" 2>&1 || true
    local path
    path="$(awk -F'\t' -v g="$APP_GROUP_ID" '$1==g{print $2}' "$out" | head -1)"
    if [ -n "$path" ] && [ -d "$path" ]; then
      echo "$path"
      return 0
    fi
    tries=$((tries + 1))
    sleep 1
  done
  echo "ERROR: could not resolve the App Group container for ${APP_GROUP_ID} after 90s." >&2
  cat "$out" >&2
  return 1
}

wait_for_file() {
  local path="$1" timeout_s="$2" waited=0
  while [ ! -f "$path" ]; do
    if [ "$waited" -ge "$timeout_s" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 0
}

# =============================================================================
# PHASE A -- host: real cache write, real running process, real termination
# =============================================================================
echo
echo "==> PHASE A: host sync (ColdReadLiveProofTests, hosted in the real app process)"

HOST_LOG="${SCRATCH_DIR}/host.log"
HOST_RESULT="${SCRATCH_DIR}/host.xcresult"
(
  PV_TEST_SERVER="$PV_IOS_BASE" TEST_RUNNER_PV_TEST_SERVER="$PV_IOS_BASE" \
  PV_COLDREAD_EMAIL="$COLDREAD_EMAIL" TEST_RUNNER_PV_COLDREAD_EMAIL="$COLDREAD_EMAIL" \
  PV_COLDREAD_ACCOUNT_PASSWORD="$COLDREAD_PASSWORD" TEST_RUNNER_PV_COLDREAD_ACCOUNT_PASSWORD="$COLDREAD_PASSWORD" \
  PV_COLDREAD_REFERENCE_MS="$REFERENCE_MS" TEST_RUNNER_PV_COLDREAD_REFERENCE_MS="$REFERENCE_MS" \
  xcodebuild test \
    -project "${REPO_ROOT}/ios/PasskeyVault/PasskeyVault.xcodeproj" \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=${SIM_UDID}" \
    -derivedDataPath "$DD_PATH" \
    -parallel-testing-enabled NO \
    "-only-testing:PasskeyVaultTests/ColdReadLiveProofTests/establishHostCacheAndHoldForExternalTermination()" \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) $CONDITION" \
    -resultBundlePath "$HOST_RESULT" \
    >"$HOST_LOG" 2>&1
) &
HOST_XCODEBUILD_PID=$!

echo "==> resolving the App Group container"
CONTAINER_PATH="$(resolve_app_group_container)"
echo "    ${CONTAINER_PATH}"

echo "==> writing the pinned reference for the extension side"
printf '%s\n' "$REFERENCE_MS" >"${CONTAINER_PATH}/freshness-reference.txt"

HOST_PROBE="${CONTAINER_PATH}/coldread-freshness-host.json"
# Fresh run: a prior attempt in this same (reused) simulator/App-Group
# container may have left its OWN coldread-freshness-host.json behind --
# found live, this exact staleness silently satisfied `wait_for_file`
# below on a PRIOR run's file before THIS run's host test had written
# anything, producing a FRESHNESS-HOST value pinned to a DIFFERENT
# REFERENCE_MS than this run's own (ios-probe-run.sh's own RUN_START-scoped
# log capture exists to prevent exactly this class of stale-evidence
# false-positive). Removed here so the wait below can only be satisfied by
# THIS run's own write.
rm -f "$HOST_PROBE"
echo "==> waiting for ${HOST_PROBE} (host's first-pull write + freshness computation)"
if ! wait_for_file "$HOST_PROBE" 120; then
  echo "ERROR: ${HOST_PROBE} never appeared within 120s." >&2
  wait "$HOST_XCODEBUILD_PID" || true
  tail -150 "$HOST_LOG" >&2
  exit 1
fi
echo "    present."

# --- BEFORE: the host process IS running (confirmed, not assumed) ----------
# Retried, not one-shot: `launchctl list`'s own view of a just-launched
# XCTest-hosted process was observed, live, to occasionally lag a beat
# behind the marker file's own appearance (the file write itself PROVES the
# process was alive to perform it, but the simulator's launchd service
# registry can take a moment longer to reflect it) -- a single query here
# would risk recording a false "0 before", which is indistinguishable from
# "never confirmed running" and would make the whole BEFORE/AFTER pair
# meaningless (this plan's own prohibition against assuming absence).
LAUNCHCTL_BEFORE="${SCRATCH_DIR}/launchctl-before.txt"
LAUNCHCTL_BEFORE_COUNT=0
for _ in $(seq 1 20); do
  xcrun simctl spawn "$SIM_UDID" launchctl list 2>&1 | grep -i "$HOST_BUNDLE_ID" >"$LAUNCHCTL_BEFORE" || true
  LAUNCHCTL_BEFORE_COUNT="$(wc -l <"$LAUNCHCTL_BEFORE" | tr -d ' ')"
  if [ "$LAUNCHCTL_BEFORE_COUNT" -gt 0 ]; then
    break
  fi
  sleep 0.5
done
echo "==> BEFORE launchctl list (matches: ${LAUNCHCTL_BEFORE_COUNT})"
cat "$LAUNCHCTL_BEFORE"
if [ "$LAUNCHCTL_BEFORE_COUNT" -eq 0 ]; then
  echo "ERROR: the host process was never observed running in launchctl before termination -- 'cold' cannot be claimed without this. Aborting rather than proceeding on an unconfirmed BEFORE state." >&2
  wait "$HOST_XCODEBUILD_PID" || true
  exit 1
fi

# --- the host's own write digest, computed independently of any read -------
HOST_CACHE_FILE="${CONTAINER_PATH}/${CACHE_FILE_NAME}"
HOST_MARKER_FILE="${CONTAINER_PATH}/${CACHE_MARKER_FILE_NAME}"
if [ ! -f "$HOST_CACHE_FILE" ]; then
  echo "ERROR: ${HOST_CACHE_FILE} not found -- the host's first pull did not persist a cache." >&2
  exit 1
fi
HOST_WRITE_DIGEST="$(shasum -a 256 "$HOST_CACHE_FILE" | awk '{print $1}')"
echo "==> HOST-WRITE-DIGEST (sha256 over the raw persisted file): ${HOST_WRITE_DIGEST}"

FRESHNESS_HOST="$(jq -r '.rendered' "$HOST_PROBE")"
echo "==> FRESHNESS-HOST: ${FRESHNESS_HOST}"

# --- terminate, then confirm absence (never assumed) ------------------------
echo "==> xcrun simctl terminate ${SIM_UDID} ${HOST_BUNDLE_ID}"
xcrun simctl terminate "$SIM_UDID" "$HOST_BUNDLE_ID" >/dev/null 2>&1 || true

# Poll briefly for the process to actually leave launchctl's listing --
# `simctl terminate` returning is not itself evidence of anything (this
# plan's own prohibition).
TERMINATED=0
for _ in $(seq 1 20); do
  if ! xcrun simctl spawn "$SIM_UDID" launchctl list 2>&1 | grep -qi "$HOST_BUNDLE_ID"; then
    TERMINATED=1
    break
  fi
  sleep 0.5
done

LAUNCHCTL_AFTER="${SCRATCH_DIR}/launchctl-after.txt"
xcrun simctl spawn "$SIM_UDID" launchctl list 2>&1 | grep -i "$HOST_BUNDLE_ID" >"$LAUNCHCTL_AFTER" || true
LAUNCHCTL_AFTER_COUNT="$(wc -l <"$LAUNCHCTL_AFTER" | tr -d ' ')"
echo "==> AFTER launchctl list (matches: ${LAUNCHCTL_AFTER_COUNT})"
cat "$LAUNCHCTL_AFTER" || true

if [ "$TERMINATED" -ne 1 ] || [ "$LAUNCHCTL_AFTER_COUNT" -ne 0 ]; then
  echo "ERROR: the host process was not confirmed absent after simctl terminate." >&2
  wait "$HOST_XCODEBUILD_PID" || true
  exit 1
fi
echo "    confirmed absent."

# The host's own xcodebuild test invocation is now EXPECTED to fail (its
# process was just killed mid-HOLD) -- this is the point, not a bug. Never
# asserted on.
HOST_XC_STATUS=0
wait "$HOST_XCODEBUILD_PID" || HOST_XC_STATUS=$?
echo "==> host xcodebuild test invocation exited ${HOST_XC_STATUS} (killed mid-HOLD by design; not asserted on)"

# =============================================================================
# PHASE B -- extension: ONE real invocation, sequential holds+controls
# =============================================================================
echo
echo "==> PHASE B: extension invocation (AutoFillInvocationUITests, unmodified)"

xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1 || true

EVIDENCE_1_JSON="${CONTAINER_PATH}/coldread-evidence-1.json"
FRESHNESS_1_TXT="${CONTAINER_PATH}/freshness-evidence-1.txt"
EVIDENCE_2_JSON="${CONTAINER_PATH}/coldread-evidence-2.json"
FRESHNESS_2_TXT="${CONTAINER_PATH}/freshness-evidence-2.txt"

# Fresh run: clear any markers a prior attempt in this same container may
# have left, so a wait below cannot be satisfied by stale evidence.
rm -f "$EVIDENCE_1_JSON" "$FRESHNESS_1_TXT" "$EVIDENCE_2_JSON" "$FRESHNESS_2_TXT"

# `AutoFillInvocationUITests`' own election toggle FLIPS on every run
# (ios-probe-run.sh's own documented header: "a run landing on the
# ON->OFF edge does not invoke the extension") -- this script cannot know
# in advance which edge THIS run lands on, since prior sessions in this
# same reused simulator leave the switch in whatever state their own last
# run left it. Retried up to twice: two consecutive toggles necessarily
# cover both edges, so the SECOND attempt (if needed) is guaranteed to be
# the ON-landing one, without ever querying pluginkit's own election state
# directly (Phase 36's layer-b technique, not duplicated here).
EXT_LOG="${SCRATCH_DIR}/ext.log"
EXT_RESULT="${SCRATCH_DIR}/ext.xcresult"
EXT_XCODEBUILD_PID=""
INVOKED=0
for attempt in 1 2; do
  echo "==> extension invocation attempt ${attempt}/2"
  (
    xcodebuild test \
      -project "${REPO_ROOT}/ios/PasskeyVault/PasskeyVault.xcodeproj" \
      -scheme PasskeyVault -configuration Debug \
      -destination "platform=iOS Simulator,id=${SIM_UDID}" \
      -derivedDataPath "$DD_PATH" \
      -parallel-testing-enabled NO \
      "-only-testing:PasskeyVaultUITests/AutoFillInvocationUITests/testInvokeExtensionConfigurationViaSettingsAutoFillToggle()" \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) $CONDITION" \
      -resultBundlePath "${EXT_RESULT}.${attempt}" \
      >"${EXT_LOG}.${attempt}" 2>&1
  ) &
  EXT_XCODEBUILD_PID=$!

  echo "==> waiting for coldread-evidence-1.json + freshness-evidence-1.txt (positive read + SAME-snapshot freshness)"
  if wait_for_file "$EVIDENCE_1_JSON" 150 && wait_for_file "$FRESHNESS_1_TXT" 20; then
    INVOKED=1
    EXT_RESULT="${EXT_RESULT}.${attempt}"
    EXT_LOG="${EXT_LOG}.${attempt}"
    break
  fi
  echo "    no markers this attempt -- likely the OFF-landing toggle edge (not invoked); waiting for this invocation to finish before retrying"
  wait "$EXT_XCODEBUILD_PID" || true
done

if [ "$INVOKED" -ne 1 ]; then
  echo "ERROR: extension evidence markers never appeared after 2 toggle attempts." >&2
  tail -150 "${EXT_LOG}.2" >&2 2>/dev/null || tail -150 "${EXT_LOG}.1" >&2 2>/dev/null || true
  exit 1
fi
CR1_STATUS="$(jq -r '.status' "$EVIDENCE_1_JSON")"
CR1_DIGEST="$(jq -r '.digest // empty' "$EVIDENCE_1_JSON")"
CR1_ITEMS="$(jq -r '.itemCount // empty' "$EVIDENCE_1_JSON")"
CR1_NEG="$(jq -r '.negativeStatus' "$EVIDENCE_1_JSON")"
FRESHNESS_EXT="$(cat "$FRESHNESS_1_TXT")"
echo "    coldread-1: status=${CR1_STATUS} digest=${CR1_DIGEST} items=${CR1_ITEMS} negative=${CR1_NEG}"
echo "    FRESHNESS-EXT: ${FRESHNESS_EXT}"

echo "==> deleting the cache file DURING the extension's HOLD 1 (Task 1's deleted-cache control)"
rm -f "$HOST_CACHE_FILE"
if [ -f "$HOST_CACHE_FILE" ]; then
  echo "ERROR: deletion of ${HOST_CACHE_FILE} did not take effect." >&2
  exit 1
fi

echo "==> waiting for coldread-evidence-2.json (deleted-cache control)"
if ! wait_for_file "$EVIDENCE_2_JSON" 60; then
  echo "ERROR: coldread-evidence-2.json never appeared." >&2
  wait "$EXT_XCODEBUILD_PID" || true
  tail -150 "$EXT_LOG" >&2
  exit 1
fi
CR2_STATUS="$(jq -r '.status' "$EVIDENCE_2_JSON")"
CR2_NEG="$(jq -r '.negativeStatus' "$EVIDENCE_2_JSON")"
echo "    coldread-2 (deleted-cache control): status=${CR2_STATUS} negative=${CR2_NEG}"

echo "==> writing a snapshot with a DIFFERENT syncedAtMs DURING the extension's HOLD 2 (Task 2's control)"
DIFFERENT_SYNCED_AT_MS=$((REFERENCE_MS - 7200000))
DIFFERENT_ACCOUNT_ID="39-07-different-snapshot-control@example.invalid"
DIFFERENT_SERVER_BASE_URL="http://127.0.0.1:0"
python3 - "$HOST_CACHE_FILE" "$DIFFERENT_SYNCED_AT_MS" "$DIFFERENT_ACCOUNT_ID" "$DIFFERENT_SERVER_BASE_URL" <<'PY'
import json, sys
path, synced_at_ms, account_id, server_base_url = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
snapshot = {
    "schemaVersion": 1,
    "revision": 1,
    "syncedAtMs": synced_at_ms,
    "accountId": account_id,
    "serverBaseURL": server_base_url,
    "items": [],
    "folders": [],
}
with open(path, "w") as f:
    json.dump(snapshot, f)
PY
echo "    wrote syncedAtMs=${DIFFERENT_SYNCED_AT_MS} (reference ${REFERENCE_MS} minus 2h) to ${HOST_CACHE_FILE}"

# WR-06 (39-REVIEW.md, iteration 2): the marker must be rewritten ALONGSIDE
# the blob, to the SAME account/server pair -- production
# (`CredentialProviderViewController.renderFreshnessSurface()`/
# `.logFreshness()`) discovers which account to read through this marker
# file, not the blob's own `accountId` field. Before this fix, the marker
# still named the ORIGINAL `COLDREAD_EMAIL`/`PV_IOS_BASE` pair while the
# blob above carried this control's different identity --
# `readCurrentSnapshot(accountId:serverBaseURL:)`'s cross-account rejection
# (D-19) then refused the blob outright, and FRESHNESS-EXT-CONTROL measured
# "a rejected snapshot renders as absent" (`Not synced yet`) rather than
# this control's actual claim, "a different snapshot renders differently".
python3 - "$HOST_MARKER_FILE" "$DIFFERENT_ACCOUNT_ID" "$DIFFERENT_SERVER_BASE_URL" <<'PY'
import json, sys
path, account_id, server_base_url = sys.argv[1], sys.argv[2], sys.argv[3]
marker = {"accountId": account_id, "serverBaseURL": server_base_url}
with open(path, "w") as f:
    json.dump(marker, f)
PY
echo "    wrote current-account marker accountId=${DIFFERENT_ACCOUNT_ID} serverBaseURL=${DIFFERENT_SERVER_BASE_URL} to ${HOST_MARKER_FILE}"

echo "==> waiting for freshness-evidence-2.txt (the DIFFERENT control)"
if ! wait_for_file "$FRESHNESS_2_TXT" 60; then
  echo "ERROR: freshness-evidence-2.txt never appeared." >&2
  wait "$EXT_XCODEBUILD_PID" || true
  tail -150 "$EXT_LOG" >&2
  exit 1
fi
FRESHNESS_EXT_CONTROL="$(cat "$FRESHNESS_2_TXT")"
echo "    FRESHNESS-EXT-CONTROL: ${FRESHNESS_EXT_CONTROL}"

echo "==> waiting for AutoFillInvocationUITests to finish"
EXT_XC_STATUS=0
wait "$EXT_XCODEBUILD_PID" || EXT_XC_STATUS=$?
EXT_TOTAL_TEST_COUNT="$(xcrun xcresulttool get test-results summary --path "$EXT_RESULT" 2>/dev/null | jq -r '.totalTestCount // 0' 2>/dev/null || echo 0)"
if [ "$EXT_XC_STATUS" -ne 0 ] || [ "$EXT_TOTAL_TEST_COUNT" -eq 0 ]; then
  echo "ERROR: AutoFillInvocationUITests FAILED (exit=${EXT_XC_STATUS}, totalTestCount=${EXT_TOTAL_TEST_COUNT})." >&2
  tail -150 "$EXT_LOG" >&2
  exit 1
fi
echo "    PASSED (totalTestCount=${EXT_TOTAL_TEST_COUNT})"

# --- the backstop truth: the extension BINARY, not the build succeeding ----
# Xcode 26.6's Debug configuration links the target's real code into a
# SIDECAR `<Target>.debug.dylib` next to the on-disk Mach-O executable,
# which itself becomes a thin loader stub (`___debug_blank_executor_main`)
# -- found live this run: the plain executable alone carries ~80 symbols
# total and matches nothing, even though the extension demonstrably ran the
# real code above (matching digests, correct freshness strings). The
# `.debug.dylib`, when present, is what actually carries the compiled
# module's symbols; fall back to the plain executable for configurations
# (e.g. Release) where this indirection does not apply.
APPEX_DIR="${DD_PATH}/Build/Products/Debug-iphonesimulator/PasskeyVault.app/PlugIns/PasskeyVaultAutoFill.appex"
APPEX_BINARY="${APPEX_DIR}/PasskeyVaultAutoFill.debug.dylib"
if [ ! -f "$APPEX_BINARY" ]; then
  APPEX_BINARY="${APPEX_DIR}/PasskeyVaultAutoFill"
fi
if [ ! -f "$APPEX_BINARY" ]; then
  echo "ERROR: no built extension binary found under ${APPEX_DIR}." >&2
  exit 1
fi
NM_OUTPUT="${SCRATCH_DIR}/nm-appex.txt"
nm "$APPEX_BINARY" 2>/dev/null | grep "AppGroupCiphertextCacheStore" >"$NM_OUTPUT" || true
NM_COUNT="$(wc -l <"$NM_OUTPUT" | tr -d ' ')"
echo "==> nm ${APPEX_BINARY} | grep AppGroupCiphertextCacheStore -> ${NM_COUNT} matches"
if [ "$NM_COUNT" -eq 0 ]; then
  echo "ERROR: the extension binary carries no AppGroupCiphertextCacheStore symbol -- the shared module did not link into this target." >&2
  exit 1
fi

# --- export the extension-surface screenshot --------------------------------
EXPORTED="${SCRATCH_DIR}/attachments"
xcrun xcresulttool export attachments --path "$EXT_RESULT" --output-path "$EXPORTED" >/dev/null
SCREENSHOT_DEST="ios/evidence/39/39-07-coldread-freshness.png"
python3 - "$EXPORTED/manifest.json" "after-provider-switch-toggle-screenshot" "$SCREENSHOT_DEST" "$EXPORTED" <<'PY'
import json, shutil, sys
manifest_path, wanted, dest, exported_dir = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
with open(manifest_path) as f:
    manifest = json.load(f)
for test in manifest:
    for att in test.get("attachments", []):
        name = att.get("suggestedHumanReadableName") or ""
        if name == wanted or name.startswith(wanted + "_"):
            shutil.copy(f"{exported_dir}/{att['exportedFileName']}", dest)
            print(f"wrote {dest}")
            sys.exit(0)
sys.exit(1)
PY
if [ ! -s "$SCREENSHOT_DEST" ]; then
  echo "ERROR: ${SCREENSHOT_DEST} was not produced or is empty." >&2
  exit 1
fi

# --- FAKETEAMID discipline (D-05) -------------------------------------------
# `grep -rl` (list files WITH a match) rather than `-rc | grep -v ":0"`:
# under this script's own `set -o pipefail`, a genuinely-zero-hits grep
# (the desired, PASSING outcome here) exits 1, and pipefail propagates that
# upstream failure through the pipe even though `wc`/`tr` both exit 0 --
# found live, this exact shape aborted the script under `set -e` on its
# very first clean run. `|| true` on the assignment is the belt: `wc -l`
# on empty input is always "0" regardless.
FAKETEAMID_HITS="$(grep -rl "FAKETEAMID" ios/PasskeyVault/PasskeyVaultAutoFill 2>/dev/null | wc -l | tr -d ' ')" || true
if [ "$FAKETEAMID_HITS" -ne 0 ]; then
  echo "ERROR: expanded team-prefix literal found under ios/PasskeyVault/PasskeyVaultAutoFill (D-05)." >&2
  exit 1
fi

# --- comparisons, computed not narrated -------------------------------------
if [ "$FRESHNESS_HOST" = "$FRESHNESS_EXT" ]; then
  FRESHNESS_MATCH="SAME"
else
  FRESHNESS_MATCH="DIFFERENT"
fi
if [ "$FRESHNESS_HOST" = "$FRESHNESS_EXT_CONTROL" ]; then
  FRESHNESS_MATCH_CONTROL="SAME"
else
  FRESHNESS_MATCH_CONTROL="DIFFERENT"
fi

DIGEST_MATCH="no"
[ "$HOST_WRITE_DIGEST" = "$CR1_DIGEST" ] && DIGEST_MATCH="yes"

echo
echo "==> DIGEST-MATCH: host=${HOST_WRITE_DIGEST} reader=${CR1_DIGEST} match=${DIGEST_MATCH}"
echo "==> FRESHNESS-MATCH: ${FRESHNESS_MATCH}"
echo "==> FRESHNESS-MATCH-CONTROL: ${FRESHNESS_MATCH_CONTROL}"

# =============================================================================
# Evidence
# =============================================================================
{
  echo "# Phase 39, Plan 39-07 -- cold-read proof evidence"
  echo
  echo "## Task 1 -- the cold read (E-C1/E-C3, SYNC-02)"
  echo
  echo "- Server: ${PV_IOS_BASE}"
  echo "- Simulator UDID: ${SIM_UDID}"
  echo "- Account: ${COLDREAD_EMAIL}"
  echo "- App Group container (host path): ${CONTAINER_PATH}"
  echo "- Pinned evidence reference (epoch ms): ${REFERENCE_MS}"
  echo
  echo "### Host write digest vs. the reader's digest"
  echo
  echo "| side | SHA-256 |"
  echo "|---|---|"
  echo "| host (independently computed over the raw persisted file) | \`${HOST_WRITE_DIGEST}\` |"
  echo "| extension (the digest \`CacheColdReadProbe\` computed over the bytes it read) | \`${CR1_DIGEST}\` |"
  echo
  if [ "$DIGEST_MATCH" = "yes" ]; then
    echo "**IDENTICAL.** Item count reported by the reader: ${CR1_ITEMS}."
  else
    echo "**DIFFER -- see stderr of this run.**"
  fi
  echo
  echo "### Host process absence (confirmed, not assumed)"
  echo
  echo "\`\`\`"
  echo "\$ xcrun simctl spawn ${SIM_UDID} launchctl list | grep -i ${HOST_BUNDLE_ID}   # BEFORE terminate"
  if [ -s "$LAUNCHCTL_BEFORE" ]; then cat "$LAUNCHCTL_BEFORE"; else echo "(no output)"; fi
  echo
  echo "\$ xcrun simctl terminate ${SIM_UDID} ${HOST_BUNDLE_ID}"
  echo
  echo "\$ xcrun simctl spawn ${SIM_UDID} launchctl list | grep -i ${HOST_BUNDLE_ID}   # AFTER terminate"
  if [ -s "$LAUNCHCTL_AFTER" ]; then cat "$LAUNCHCTL_AFTER"; else echo "(no output -- absent)"; fi
  echo "\`\`\`"
  echo
  echo "The word \"cold\" applies to this read: the BEFORE capture shows the host process present (${LAUNCHCTL_BEFORE_COUNT} matching line(s)), the AFTER capture shows it absent (${LAUNCHCTL_AFTER_COUNT} matching lines), both captured around a real \`xcrun simctl terminate\` -- never assumed from having issued that command."
  echo
  echo "### Wrong-sharing-identifier negative control (E-C1)"
  echo
  echo "Repeated against \`group.cloud.blonie.PasskeyVault.NeverDeclared\`, an identifier this bundle does NOT declare in \`PasskeyVaultAutoFill.entitlements\`:"
  echo
  echo "- First invocation (cache present): \`${CR1_NEG}\`"
  echo "- Second invocation (cache deleted): \`${CR2_NEG}\`"
  echo
  if [ "$CR1_NEG" = "resolve_failed" ] && [ "$CR2_NEG" = "resolve_failed" ]; then
    echo "Both fail with \`resolve_failed\` (\`containerURL(forSecurityApplicationGroupIdentifier:)\` returns nil for an identifier this bundle is not entitled to) -- the platform enforces the boundary on this setup, so the positive read above is not vacuous."
  else
    echo "**At least one run did NOT fail -- the boundary was not observed to be enforced. The positive result above must be qualified accordingly, not reported as a clean pass.**"
  fi
  echo
  echo "### Deleted-cache control"
  echo
  echo "With \`${HOST_CACHE_FILE}\` removed and the same read repeated: \`status=${CR2_STATUS}\`."
  if [ "$CR2_STATUS" = "absent" ]; then
    echo
    echo "The reader reports absence, not a stale in-process copy -- proving it reads STORAGE, not memory."
  else
    echo
    echo "**Did NOT report absence -- see stderr of this run.**"
  fi
  echo
  echo "### Extension binary carries the shared module (backstop truth)"
  echo
  echo "\`\`\`"
  echo "\$ nm ${APPEX_BINARY} | grep AppGroupCiphertextCacheStore"
  if [ -s "$NM_OUTPUT" ]; then head -5 "$NM_OUTPUT"; else echo "(no output)"; fi
  echo "... (${NM_COUNT} total matching lines)"
  echo "\`\`\`"
  echo
  echo "The built extension binary is inspected directly, not inferred from the build succeeding."
  echo
  echo "## Task 2 -- the AutoFill surface's own last-synced line, both processes observed rendering the same instant (SYNC-04)"
  echo
  echo "FRESHNESS-HOST: ${FRESHNESS_HOST}"
  echo "FRESHNESS-EXT: ${FRESHNESS_EXT}"
  echo "FRESHNESS-MATCH: ${FRESHNESS_MATCH}"
  echo "FRESHNESS-SCREENSHOT: ${SCREENSHOT_DEST}"
  echo
  echo "Both strings are the SAME production formatter (\`PvShared/SyncFreshness.describe(syncedAtMs:reference:)\`), called independently by the host process and the extension process, against the SAME persisted snapshot and the SAME pinned reference instant (\`${REFERENCE_MS}\`)."
  echo
  echo "### The control (comparison shown able to say DIFFERENT, D-06/D-08)"
  echo
  echo "The identical capture-and-compare mechanism, re-run with the extension deliberately pointed at a snapshot whose \`syncedAtMs\` is \`${DIFFERENT_SYNCED_AT_MS}\` (the pinned reference minus two hours) instead of the host's real value:"
  echo
  echo "FRESHNESS-EXT-CONTROL: ${FRESHNESS_EXT_CONTROL}"
  echo "FRESHNESS-MATCH-CONTROL: ${FRESHNESS_MATCH_CONTROL}"
  echo
  if [ "$FRESHNESS_MATCH_CONTROL" = "DIFFERENT" ]; then
    echo "The mechanism reports DIFFERENT when the underlying instant genuinely differs -- \"SAME\" above is not indistinguishable from a comparison that never ran."
  else
    echo "**The control did NOT emit DIFFERENT -- the comparison is not shown live. See stderr of this run.**"
  fi
  echo
} >>"$EVIDENCE_FILE"

FINAL_STATUS=0
if [ "$DIGEST_MATCH" != "yes" ]; then FINAL_STATUS=1; fi
if [ "$CR1_NEG" != "resolve_failed" ] || [ "$CR2_NEG" != "resolve_failed" ]; then FINAL_STATUS=1; fi
if [ "$CR2_STATUS" != "absent" ]; then FINAL_STATUS=1; fi
if [ "$FRESHNESS_MATCH" != "SAME" ]; then FINAL_STATUS=1; fi
if [ "$FRESHNESS_MATCH_CONTROL" != "DIFFERENT" ]; then FINAL_STATUS=1; fi
case "$CR1_ITEMS" in
  ''|*[!0-9]*) FINAL_STATUS=1 ;;
  *) [ "$CR1_ITEMS" -ge 1 ] || FINAL_STATUS=1 ;;
esac

if [ "$FINAL_STATUS" -ne 0 ]; then
  echo "ERROR: one or more assertions above did not hold -- see the evidence file and stderr." >&2
  exit 1
fi

echo
echo "==> PASS: cold read digest-identical, both negative controls fired, freshness SAME with a live DIFFERENT control."
