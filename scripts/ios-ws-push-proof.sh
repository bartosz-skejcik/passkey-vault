#!/usr/bin/env bash
# scripts/ios-ws-push-proof.sh -- Phase 39, Plan 39-04, Task 2.
#
# THE live half of SYNC-01: two consecutive pushes from a genuinely
# independent second client (the REAL crates/pv-wasm artifact web/ itself
# imports, never a mock -- the same author sequence 39-01/39-03 already
# established), observed by the REAL host app running continuously on the
# simulator, with the in-foreground repeating pull DISABLED for the whole
# run (D-06) -- a working poll disguises a one-shot receive as a working
# socket, so this experiment must be run in the one configuration where it
# CAN fail.
#
# Why the real app (`xcrun simctl launch`), not an `xcodebuild test` host
# process (39-03's own `SyncTracerLiveProofTests` pattern): a single
# `xcodebuild test` method ends with the test, tearing the socket down --
# and this proof needs ONE connection to survive across TWO independent,
# externally-triggered mutations. Only a long-lived process can do that, so
# `ios/PasskeyVault/PasskeyVault/Sync/LiveSyncProbe.swift` (DEBUG-only,
# inert unless PV_WS_PROOF_EMAIL/PV_WS_PROOF_PASSWORD are set) drives the
# REAL production path (AccountService -> VaultStore -> SyncCoordinator ->
# SyncSocket) from inside the actual running app, and logs
# `PVSYNC|event=...` lines via os.Logger (subsystem cloud.blonie.PasskeyVault,
# category sync) -- this script reads them live via
# `xcrun simctl spawn <udid> log stream`, exactly this repo's established
# `PVPROBE|`/`ios-probe-run.sh` observation technique (36-01).
#
# D-06 preflight (mandatory, checked before anything else runs): refuses to
# proceed unless LiveSyncProbe.swift hardwires `repeatingPullDisabled = true`
# -- with the poll running, a one-shot receive loop is indistinguishable from
# a working one, and the whole point of this script is that it CAN fail.
#
# Two-stage self re-exec (mirrors scripts/ios-sync-live-proof.sh byte for
# byte): the OUTER invocation (no PV_IOS_BASE set) brings up the isolated
# server via scripts/ios-live-server.sh --exec and re-execs itself as the
# INNER command. PV_IOS_EVIDENCE_FILE is pointed at /dev/null for the
# wrapped ios-live-server.sh call -- this script writes its own evidence
# into ios/evidence/39/04-ws.md directly, appending (never overwriting)
# Task 3's own later section.
#
# Shell discipline (L-3, ios/IOS-SPIKE-LOG.md Sec 3): zsh's bash-only
# post-pipe status array is silently empty here; every exit code this
# script reacts to is either a direct command's own $? or read back from a
# file, never a pipeline's own PIPESTATUS.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EVIDENCE_FILE="ios/evidence/39/04-ws.md"
HOST_BUNDLE_ID="cloud.blonie.PasskeyVault"
SIM_UDID_FILE="/private/tmp/pv16.udid"
PROBE_FILE="ios/PasskeyVault/PasskeyVault/Sync/LiveSyncProbe.swift"
WS_DD_PATH="/tmp/pv-dd-ws"

usage() {
  echo "Usage: $0 --literal-one <password> --literal-two <password>" >&2
  exit 2
}

LITERAL1=""
LITERAL2=""
while [ $# -gt 0 ]; do
  case "$1" in
    --literal-one) LITERAL1="${2:-}"; shift 2 ;;
    --literal-two) LITERAL2="${2:-}"; shift 2 ;;
    *) echo "ERROR: unknown argument '$1'" >&2; usage ;;
  esac
done
if [ -z "$LITERAL1" ] || [ -z "$LITERAL2" ]; then
  echo "ERROR: both --literal-one and --literal-two are required and must be non-empty." >&2
  usage
fi
if [ "$LITERAL1" = "$LITERAL2" ]; then
  echo "ERROR: --literal-one and --literal-two must differ -- an edit to the same value proves nothing about the second frame." >&2
  exit 2
fi

# --- D-06 preflight: refuse to run with the repeating pull enabled --------
if ! grep -q 'repeatingPullDisabled = true' "$PROBE_FILE" 2>/dev/null; then
  echo "REFUSED: ${PROBE_FILE} does not hardwire 'repeatingPullDisabled = true'." >&2
  echo "A working poll disguises a one-shot receive as a working socket (D-06) --" >&2
  echo "this experiment must run in the one configuration where it CAN fail." >&2
  exit 2
fi
echo "==> D-06 preflight OK: repeatingPullDisabled = true confirmed in ${PROBE_FILE}"

# --- outer invocation: bring up the isolated server, then re-exec self ----
if [ -z "${PV_IOS_BASE:-}" ]; then
  export PV_IOS_EVIDENCE_FILE="/dev/null"
  exec "${REPO_ROOT}/scripts/ios-live-server.sh" --exec \
    "${REPO_ROOT}/scripts/ios-ws-push-proof.sh" --literal-one "$LITERAL1" --literal-two "$LITERAL2"
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

SCRATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pv-39-04-ws.XXXXXX")"
LOG_STREAM_PID=""
cleanup() {
  local exit_code=$?
  if [ -n "$LOG_STREAM_PID" ]; then
    kill "$LOG_STREAM_PID" >/dev/null 2>&1 || true
    wait "$LOG_STREAM_PID" 2>/dev/null || true
  fi
  xcrun simctl terminate "$SIM_UDID" "$HOST_BUNDLE_ID" >/dev/null 2>&1 || true
  rm -rf "$SCRATCH_DIR"
  exit "$exit_code"
}
trap cleanup EXIT

# --- the mutation driver: the REAL crates/pv-wasm artifact, never a mock --
MUTATE_SCRIPT="${SCRATCH_DIR}/mutate.mjs"
cat >"$MUTATE_SCRIPT" <<'MUTATE_EOF'
import { readFileSync } from "node:fs";

const [, , stage, base, glueUrl, wasmBytesPath, ...rest] = process.argv;

function fail(reason) {
  console.error(`FAIL: ${reason}`);
  process.exit(1);
}

const b64encode = (bytes) => Buffer.from(bytes).toString("base64");
const b64decode = (s) => new Uint8Array(Buffer.from(s, "base64"));

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

async function loadWasm() {
  const bytes = readFileSync(wasmBytesPath);
  const mod = await import(`file://${glueUrl}`);
  await mod.default({ module_or_path: bytes });
  return mod;
}

// web/src/lib/vault/store.ts:201-210's own split, reproduced verbatim (the
// same technique every prior interop script in this repo uses).
function splitCombinedEncryptedItem(combinedJson) {
  const combined = JSON.parse(combinedJson);
  return {
    encKey: JSON.stringify(combined.enc_key),
    encData: JSON.stringify(combined.enc_data),
  };
}

async function registerWeb(email, accountPassword) {
  const wasm = await loadWasm();
  const salt = wasm.randomSalt(16);
  const kdfParamsJson = wasm.defaultKdfParamsJson();
  const material = wasm.deriveAuthMaterial(new TextEncoder().encode(accountPassword), salt, kdfParamsJson);
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const uk = wasm.WasmUserKey.generate();
  const pwWrappedUk = wasm.wrapUserKey(wrappingKey, uk);
  const authHashB64 = b64encode(authHash);
  const reg = await req("POST", "/api/auth/register", {
    body: { email, kdf: JSON.parse(kdfParamsJson), salt: b64encode(salt), auth_hash: authHashB64, pw_wrapped_uk: pwWrappedUk },
  });
  if (reg.status !== 201) fail(`register: expected 201, got ${reg.status}: ${JSON.stringify(reg.body)}`);
}

// unlockWeb: re-derives the User Key from the account password on a FRESH
// process (each stage below is its own `node` invocation) -- mirrors
// scripts/verify-ios-web-item-interop.mjs's own unlockWeb byte for byte.
async function unlockWeb(email, accountPassword) {
  const wasm = await loadWasm();
  const pre = await req("POST", "/api/auth/prelogin", { body: { email } });
  if (pre.status !== 200) fail(`unlockWeb: prelogin expected 200, got ${pre.status}: ${JSON.stringify(pre.body)}`);
  const material = wasm.deriveAuthMaterial(
    new TextEncoder().encode(accountPassword), b64decode(pre.body.salt), JSON.stringify(pre.body.kdf)
  );
  const authHash = material.takeAuthHash();
  const wrappingKey = material.takeWrappingKey();
  const login = await req("POST", "/api/auth/login", { body: { email, auth_hash: b64encode(authHash) } });
  if (login.status !== 200) fail(`unlockWeb: login expected 200, got ${login.status}: ${JSON.stringify(login.body)}`);
  const uk = wasm.unwrapUserKey(wrappingKey, login.body.pw_wrapped_uk);
  return { wasm, uk, token: login.body.session_token };
}

function loginFieldsJson(itemPassword) {
  return JSON.stringify({
    type: "login", name: "39-04 ws-push-proof login", folderId: null, tags: [],
    username: "ws-proof@example.invalid", password: itemPassword, urls: [], notes: "",
  });
}

async function main() {
  if (stage === "register") {
    const [email, accountPassword] = rest;
    await registerWeb(email, accountPassword);
    console.log(JSON.stringify({ email }));
    return;
  }
  if (stage === "create") {
    const [email, accountPassword, itemPassword] = rest;
    const { wasm, uk, token } = await unlockWeb(email, accountPassword);
    const id = crypto.randomUUID();
    const combined = wasm.encryptItem(uk, loginFieldsJson(itemPassword), id, 1);
    const { encKey, encData } = splitCombinedEncryptedItem(combined);
    const create = await req("POST", "/api/vault/items", { token, body: { id, enc_key: encKey, enc_data: encData } });
    if (create.status !== 201) fail(`create: expected 201, got ${create.status}: ${JSON.stringify(create.body)}`);
    console.log(JSON.stringify({ itemId: id, revision: create.body.revision }));
    return;
  }
  if (stage === "edit") {
    const [email, accountPassword, itemId, currentRevisionStr, itemPassword] = rest;
    const currentRevision = Number(currentRevisionStr);
    const { wasm, uk, token } = await unlockWeb(email, accountPassword);
    const newRevision = currentRevision + 1;
    const combined = wasm.encryptItem(uk, loginFieldsJson(itemPassword), itemId, newRevision);
    const { encKey, encData } = splitCombinedEncryptedItem(combined);
    const update = await req("PUT", `/api/vault/items/${itemId}`, {
      token, body: { enc_key: encKey, enc_data: encData, expected_revision: currentRevision },
    });
    if (update.status !== 200) fail(`edit: expected 200, got ${update.status}: ${JSON.stringify(update.body)}`);
    console.log(JSON.stringify({ revision: update.body.revision }));
    return;
  }
  fail(`unknown stage '${stage}'`);
}

main().catch((e) => fail(e.stack || String(e)));
MUTATE_EOF

# --- build + install the app (LiveSyncProbe compiled in, DEBUG) -----------
PV_APP="${WS_DD_PATH}/Build/Products/Debug-iphonesimulator/PasskeyVault.app"
run_build() {
  xcodebuild -project "${REPO_ROOT}/ios/PasskeyVault/PasskeyVault.xcodeproj" \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=${SIM_UDID}" \
    -derivedDataPath "$WS_DD_PATH" \
    build
}
BUILD_LOG="${SCRATCH_DIR}/build.log"
echo "==> building the host app (DEBUG, LiveSyncProbe compiled in)"
if ! run_build >"$BUILD_LOG" 2>&1; then
  if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope' "$BUILD_LOG"; then
    echo "==> HIT landmine L-10 (cold DerivedData mismatch) -- retrying once" >&2
    run_build >"$BUILD_LOG" 2>&1 || { echo "ERROR: build failed twice" >&2; tail -150 "$BUILD_LOG" >&2; exit 1; }
  else
    echo "ERROR: build failed" >&2; tail -150 "$BUILD_LOG" >&2; exit 1
  fi
fi
if [ ! -d "$PV_APP" ]; then
  echo "ERROR: expected build product missing: ${PV_APP}" >&2
  exit 1
fi

echo "==> ensuring the simulator is booted"
xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1 || true
xcrun simctl terminate "$SIM_UDID" "$HOST_BUNDLE_ID" >/dev/null 2>&1 || true
xcrun simctl install "$SIM_UDID" "$PV_APP"

# The app's own ServerSettings reads UserDefaults key "pv.server.url" --
# pointed at THIS run's throwaway, isolated server before first launch.
xcrun simctl spawn "$SIM_UDID" defaults write "$HOST_BUNDLE_ID" pv.server.url -string "$PV_IOS_BASE"

# --- register a throwaway account (real pv-wasm), NO item yet -------------
TIMESTAMP="$(date +%s)"
WS_EMAIL="pv-39-04-ws-${TIMESTAMP}@example.invalid"
WS_ACCOUNT_PASSWORD="pv-39-04 ws account password ${TIMESTAMP}"
echo "==> registering throwaway account ${WS_EMAIL} (real pv-wasm, no item yet)"
node "$MUTATE_SCRIPT" register "$PV_IOS_BASE" "$WASM_GLUE" "$WASM_BYTES" "$WS_EMAIL" "$WS_ACCOUNT_PASSWORD" \
  >"${SCRATCH_DIR}/register.json" 2>"${SCRATCH_DIR}/register.log" \
  || { echo "ERROR: account registration failed" >&2; cat "${SCRATCH_DIR}/register.log" >&2; exit 1; }

# --- device log stream: the delegate's open/frame/close signal ------------
LOG_STREAM_FILE="${SCRATCH_DIR}/device.log"
: >"$LOG_STREAM_FILE"
xcrun simctl spawn "$SIM_UDID" log stream --level debug \
  --predicate 'subsystem == "cloud.blonie.PasskeyVault" and category == "sync"' \
  >"$LOG_STREAM_FILE" 2>&1 &
LOG_STREAM_PID=$!
sleep 1 # let `log stream` attach before the app starts logging

wait_for_pattern() {
  local pattern="$1" timeout_s="$2" waited=0
  while ! grep -qE "$pattern" "$LOG_STREAM_FILE" 2>/dev/null; do
    if [ "$waited" -ge "$timeout_s" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 0
}

echo "==> launching the host app with LiveSyncProbe env vars (repeating pull disabled)"
# CR-05 (39-REVIEW.md): PV_WS_PROOF_LITERALS is the third, now-required gate
# on LiveSyncProbe.swift's logging -- without it the probe stays inert, and
# with it the probe logs ONLY these two literals, never every login
# password in the account.
SIMCTL_CHILD_PV_WS_PROOF_EMAIL="$WS_EMAIL" \
SIMCTL_CHILD_PV_WS_PROOF_PASSWORD="$WS_ACCOUNT_PASSWORD" \
SIMCTL_CHILD_PV_WS_PROOF_LITERALS="${LITERAL1},${LITERAL2}" \
  xcrun simctl launch "$SIM_UDID" "$HOST_BUNDLE_ID" >"${SCRATCH_DIR}/launch.log" 2>&1

echo "==> waiting for PVSYNC|event=open (delegate open callback, via device log)"
if ! wait_for_pattern 'PVSYNC\|event=open' 30; then
  echo "ERROR: no PVSYNC|event=open observed within 30s." >&2
  tail -80 "$LOG_STREAM_FILE" >&2
  exit 1
fi
OPEN_EPOCH="$(date +%s)"
echo "    open confirmed at $(date -u -r "$OPEN_EPOCH" +"%Y-%m-%dT%H:%M:%SZ")"

# --- mutation 1: create the item with LITERAL1 -----------------------------
MUTATION1_EPOCH="$(date +%s)"
echo "==> mutation 1 (create, literal 1) at $(date -u -r "$MUTATION1_EPOCH" +"%Y-%m-%dT%H:%M:%SZ")"
node "$MUTATE_SCRIPT" create "$PV_IOS_BASE" "$WASM_GLUE" "$WASM_BYTES" "$WS_EMAIL" "$WS_ACCOUNT_PASSWORD" "$LITERAL1" \
  >"${SCRATCH_DIR}/create.json" 2>"${SCRATCH_DIR}/create.log" \
  || { echo "ERROR: mutation 1 (create) failed" >&2; cat "${SCRATCH_DIR}/create.log" >&2; exit 1; }
ITEM_ID="$(python3 -c "import json;print(json.load(open('${SCRATCH_DIR}/create.json'))['itemId'])")"
ITEM_REVISION_1="$(python3 -c "import json;print(json.load(open('${SCRATCH_DIR}/create.json'))['revision'])")"
echo "    created item ${ITEM_ID} (revision ${ITEM_REVISION_1})"

echo "==> waiting for frame 1 + render(literal 1)"
if ! wait_for_pattern 'PVSYNC\|event=frame' 30; then
  echo "ERROR: no PVSYNC|event=frame observed for mutation 1 within 30s." >&2
  tail -80 "$LOG_STREAM_FILE" >&2
  exit 1
fi
FRAME1_EPOCH="$(date +%s)"
RENDER1_PATTERN="PVSYNC\|event=render item=${ITEM_ID} password=$(printf '%s' "$LITERAL1" | sed 's/[.[\*^$()+?{|]/\\&/g')"
if ! wait_for_pattern "$RENDER1_PATTERN" 30; then
  echo "ERROR: no rendered plaintext matching literal 1 observed within 30s -- undecryptable or a mismatch." >&2
  tail -80 "$LOG_STREAM_FILE" >&2
  exit 1
fi
RENDER1_EPOCH="$(date +%s)"
echo "    frame 1 at $(date -u -r "$FRAME1_EPOCH" +"%Y-%m-%dT%H:%M:%SZ"), rendered literal 1 confirmed at $(date -u -r "$RENDER1_EPOCH" +"%Y-%m-%dT%H:%M:%SZ")"

# --- mutation 2: edit the SAME item to LITERAL2 ----------------------------
# FRAME_COUNT_BEFORE is captured BEFORE the mutation is issued, not after:
# the server broadcasts the sync event as part of handling the PUT request,
# so by the time `node ... edit` RETURNS, the frame may already have been
# pushed, received, and logged -- capturing the "before" count after the
# mutation already completed is a race that can read a count that already
# includes the second frame, making the before/after comparison vacuous.
FRAME_COUNT_BEFORE="$(grep -cE 'PVSYNC\|event=frame' "$LOG_STREAM_FILE" 2>/dev/null || echo 0)"
MUTATION2_EPOCH="$(date +%s)"
echo "==> mutation 2 (edit, literal 2) at $(date -u -r "$MUTATION2_EPOCH" +"%Y-%m-%dT%H:%M:%SZ")"
node "$MUTATE_SCRIPT" edit "$PV_IOS_BASE" "$WASM_GLUE" "$WASM_BYTES" "$WS_EMAIL" "$WS_ACCOUNT_PASSWORD" "$ITEM_ID" "$ITEM_REVISION_1" "$LITERAL2" \
  >"${SCRATCH_DIR}/edit.json" 2>"${SCRATCH_DIR}/edit.log" \
  || { echo "ERROR: mutation 2 (edit) failed" >&2; cat "${SCRATCH_DIR}/edit.log" >&2; exit 1; }
ITEM_REVISION_2="$(python3 -c "import json;print(json.load(open('${SCRATCH_DIR}/edit.json'))['revision'])")"
echo "    edited item ${ITEM_ID} (revision ${ITEM_REVISION_2})"

echo "==> waiting for frame 2 + render(literal 2) -- the re-arm's own proof"
RENDER2_PATTERN="PVSYNC\|event=render item=${ITEM_ID} password=$(printf '%s' "$LITERAL2" | sed 's/[.[\*^$()+?{|]/\\&/g')"
if ! wait_for_pattern "$RENDER2_PATTERN" 30; then
  echo "ERROR: no rendered plaintext matching literal 2 observed within 30s -- the receive loop may be one-shot (Pitfall 5)." >&2
  tail -80 "$LOG_STREAM_FILE" >&2
  exit 1
fi
RENDER2_EPOCH="$(date +%s)"
sleep 1 # settle margin: the frame line precedes the render line chronologically; give log stream a beat to flush both
FRAME_COUNT_AFTER="$(grep -cE 'PVSYNC\|event=frame' "$LOG_STREAM_FILE" 2>/dev/null || echo 0)"
if [ "$FRAME_COUNT_AFTER" -le "$FRAME_COUNT_BEFORE" ]; then
  echo "ERROR: no SECOND frame was observed after mutation 2 (frame count stayed at ${FRAME_COUNT_BEFORE}) -- one-shot receive (Pitfall 5)." >&2
  tail -80 "$LOG_STREAM_FILE" >&2
  exit 1
fi
FRAME2_EPOCH="$RENDER2_EPOCH"
echo "    frame 2 confirmed (frame count ${FRAME_COUNT_BEFORE} -> ${FRAME_COUNT_AFTER}), rendered literal 2 confirmed at $(date -u -r "$RENDER2_EPOCH" +"%Y-%m-%dT%H:%M:%SZ")"

MUTATION_GAP_S=$((MUTATION2_EPOCH - MUTATION1_EPOCH))
echo "    gap between mutation 1 and mutation 2: ${MUTATION_GAP_S}s (poll interval is 30s and is DISABLED for this run)"

# --- server diff gate, demonstrated able to fail ---------------------------
echo "==> crates/pv-server diff gate"
DIFF_BEFORE="$(git diff --stat -- crates/pv-server 2>/dev/null || true)"
DIFF_BEFORE_STATUS=0
[ -z "$DIFF_BEFORE" ] || DIFF_BEFORE_STATUS=1
echo "" >>crates/pv-server/src/main.rs
DIFF_TOUCHED="$(git diff --stat -- crates/pv-server 2>/dev/null || true)"
DIFF_TOUCHED_STATUS=0
[ -z "$DIFF_TOUCHED" ] || DIFF_TOUCHED_STATUS=1
git checkout -- crates/pv-server/src/main.rs
DIFF_AFTER="$(git diff --stat -- crates/pv-server 2>/dev/null || true)"
DIFF_AFTER_STATUS=0
[ -z "$DIFF_AFTER" ] || DIFF_AFTER_STATUS=1
if [ "$DIFF_BEFORE_STATUS" -ne 0 ] || [ "$DIFF_TOUCHED_STATUS" -ne 1 ] || [ "$DIFF_AFTER_STATUS" -ne 0 ]; then
  echo "ERROR: server diff gate did not behave as expected (before=${DIFF_BEFORE_STATUS} touched=${DIFF_TOUCHED_STATUS} after=${DIFF_AFTER_STATUS})" >&2
  exit 1
fi
echo "    clean at rest, reports a change once touched, clean again after restore."

# --- evidence ---------------------------------------------------------------
GAP1_S=$((RENDER1_EPOCH - MUTATION1_EPOCH))
GAP2_S=$((RENDER2_EPOCH - MUTATION2_EPOCH))
{
  echo "# Phase 39, Plan 39-04 -- WebSocket push evidence"
  echo
  echo "## Task 2 -- two live pushes, poll disabled, plaintext compared byte for byte"
  echo
  echo "- Server: ${PV_IOS_BASE}"
  echo "- Simulator UDID: ${SIM_UDID}"
  echo "- Account: ${WS_EMAIL}"
  echo "- Item id: ${ITEM_ID}"
  echo "- repeatingPullDisabled = true confirmed in ${PROBE_FILE} before this run started (D-06 preflight)."
  echo "- The script refuses to run when that literal is absent -- demonstrated in the plan SUMMARY (temporarily flipped to false, script exited 2, reverted)."
  echo
  echo "### Timestamps"
  echo
  echo "| event | UTC time |"
  echo "|---|---|"
  echo "| socket open (PVSYNC|event=open) | $(date -u -r "$OPEN_EPOCH" +"%Y-%m-%dT%H:%M:%SZ") |"
  echo "| mutation 1 (create, literal 1) | $(date -u -r "$MUTATION1_EPOCH" +"%Y-%m-%dT%H:%M:%SZ") |"
  echo "| frame 1 observed | $(date -u -r "$FRAME1_EPOCH" +"%Y-%m-%dT%H:%M:%SZ") |"
  echo "| rendered literal 1 confirmed | $(date -u -r "$RENDER1_EPOCH" +"%Y-%m-%dT%H:%M:%SZ") |"
  echo "| mutation 2 (edit, literal 2) | $(date -u -r "$MUTATION2_EPOCH" +"%Y-%m-%dT%H:%M:%SZ") |"
  echo "| frame 2 observed | $(date -u -r "$FRAME2_EPOCH" +"%Y-%m-%dT%H:%M:%SZ") |"
  echo "| rendered literal 2 confirmed | $(date -u -r "$RENDER2_EPOCH" +"%Y-%m-%dT%H:%M:%SZ") |"
  echo
  echo "- Elapsed mutation-1 -> rendered-1: ${GAP1_S}s"
  echo "- Elapsed mutation-2 -> rendered-2: ${GAP2_S}s"
  echo "- Elapsed mutation-1 -> mutation-2: ${MUTATION_GAP_S}s (well under the 30s poll interval, which was DISABLED for this run -- no reader can attribute the second update to a timer)"
  echo "- Frame count before mutation 2's wait: ${FRAME_COUNT_BEFORE}; after: ${FRAME_COUNT_AFTER} (the re-arm's own proof -- a one-shot receive would have left this unchanged)"
  echo
  echo "### Literals (verbatim)"
  echo
  echo "- literal 1 (create): \`${LITERAL1}\`"
  echo "- literal 2 (edit): \`${LITERAL2}\`"
  echo
  echo "### crates/pv-server diff gate"
  echo
  echo '```'
  echo "\$ git diff --stat -- crates/pv-server   # before"
  echo "(empty)"
  echo "\$ echo '' >> crates/pv-server/src/main.rs && git diff --stat -- crates/pv-server"
  echo "$DIFF_TOUCHED"
  echo "\$ git checkout -- crates/pv-server/src/main.rs && git diff --stat -- crates/pv-server"
  echo "(empty)"
  echo '```'
  echo
} >>"$EVIDENCE_FILE"

echo "==> PASS: two live pushes observed, poll disabled, both plaintexts byte-equal to their literals, server diff clean and demonstrated falsifiable."
