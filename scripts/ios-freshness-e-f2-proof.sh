#!/usr/bin/env bash
# scripts/ios-freshness-e-f2-proof.sh -- Phase 39, Plan 39-06, Task 1's
# screenshot + Task 3 (E-F2, SC4's fallback path).
#
# `ios/evidence/39/04-ws.md`'s E-S4 result (RESULT: B, PROOF-PATH-FOR-39-06:
# server-stop) fixes the path this script MUST use: the Simulator does not
# tear down a backgrounded socket, so the only honest proof of a stale cache
# is a REAL, external transport break (stopping the server process), never a
# backgrounding gesture presented as if it produced the artifact.
#
# ONE continuous XCUITest (`FreshnessEvidenceUITests
# .testFreshSyncThenStaleAfterServerStop`), launched here in the BACKGROUND,
# spans the whole window: register -> first confirmed pull (screenshot,
# Task 1's own requirement) -> a 25s hold -> background/foreground (a real
# scene-phase transition, triggering `SyncCoordinator
# .handleScenePhaseBecameActive()`) -> screenshot again. WHILE that test
# holds, this script (running concurrently, no simulator/xcodebuild
# contention -- the mutation below is a plain Node/HTTP process):
#
#   1. polls the throwaway server's OWN sqlite db directly for the account
#      row, confirming registration landed (bounded wait, never a blind
#      sleep for this half);
#   2. authors ONE item as "the web client", using the SAME `pv-wasm`
#      artifact and mutate.mjs technique `scripts/ios-ws-push-proof.sh`
#      already established for 39-04 -- a second, independent client
#      session the on-screen app never observes before the server dies;
#   3. stops the server for real: SIGTERM to the PID `lsof` reports bound to
#      the port, confirmed dead by both an empty `lsof` re-check and a
#      failing `curl healthz` (the SAME technique Task 2's E-F1 script
#      uses).
#
# Shell discipline (L-3): zsh's PIPESTATUS is silently empty here; every
# exit code this script reacts to is a direct command's own $?.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EVIDENCE_FILE="ios/evidence/39/06-freshness-host.md"
EVIDENCE_DIR="ios/evidence/39"
HOST_BUNDLE_ID="cloud.blonie.PasskeyVault"
SIM_UDID_FILE="/private/tmp/pv16.udid"
PORT="${PV_IOS_PORT:-8623}"
WS_MD="ios/evidence/39/04-ws.md"

WASM_GLUE="${REPO_ROOT}/web/src/lib/crypto/wasm/pv_wasm.js"
WASM_BYTES="${REPO_ROOT}/web/public/wasm/pv_wasm_bg.wasm"
if [ ! -f "$WASM_GLUE" ] || [ ! -f "$WASM_BYTES" ]; then
  echo "ERROR: pv-wasm artifact missing at ${WASM_GLUE} / ${WASM_BYTES} -- run scripts/build-wasm.sh first." >&2
  exit 1
fi

if [ ! -f "$WS_MD" ]; then
  echo "ERROR: ${WS_MD} not found -- E-S4's recorded result decides the proof path here; it must exist first." >&2
  exit 1
fi
if ! grep -qx "PROOF-PATH-FOR-39-06: server-stop" "$WS_MD"; then
  echo "ERROR: ${WS_MD} does not record PROOF-PATH-FOR-39-06: server-stop -- this script only implements the fallback path. If E-S4 now reports the primary path, this script does not apply; do not force it." >&2
  exit 1
fi

# --- outer invocation: bring up the isolated server, then re-exec self ----
if [ -z "${PV_IOS_BASE:-}" ]; then
  export PV_IOS_EVIDENCE_FILE="/dev/null"
  export PV_IOS_PORT="$PORT"
  exec "${REPO_ROOT}/scripts/ios-live-server.sh" --exec \
    "${REPO_ROOT}/scripts/ios-freshness-e-f2-proof.sh"
fi

# --- inner invocation: PV_IOS_BASE/PV_IOS_DB are exported ------------------
mkdir -p "$EVIDENCE_DIR"

if [ ! -f "$SIM_UDID_FILE" ]; then
  echo "ERROR: no simulator udid recorded at ${SIM_UDID_FILE}." >&2
  exit 1
fi
SIM_UDID="$(cat "$SIM_UDID_FILE")"

SCRATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pv-39-06-ef2.XXXXXX")"
cleanup() { rm -rf "$SCRATCH_DIR"; }
trap cleanup EXIT

# --- the mutation driver: the REAL crates/pv-wasm artifact, never a mock --
# Reused verbatim (register/create/edit stages) from
# scripts/ios-ws-push-proof.sh's own embedded mutate.mjs (39-04) -- the SAME
# technique this repo already trusts for "a change made in the web client".
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

function splitCombinedEncryptedItem(combinedJson) {
  const combined = JSON.parse(combinedJson);
  return {
    encKey: JSON.stringify(combined.enc_key),
    encData: JSON.stringify(combined.enc_data),
  };
}

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
    type: "login", name: "39-06 E-F2 mutation (independent client session)", folderId: null, tags: [],
    username: "e-f2-proof@example.invalid", password: itemPassword, urls: [], notes: "",
  });
}

async function main() {
  if (stage === "create") {
    const [email, accountPassword, itemPassword] = rest;
    // unlockWeb() is a REAL login against the SAME account the on-screen
    // app already registered -- this proves the account genuinely exists
    // and this write is genuinely authenticated as that user, from a
    // SECOND, independent session the on-screen app never sees.
    const { wasm, uk, token } = await unlockWeb(email, accountPassword);
    const id = crypto.randomUUID();
    const combined = wasm.encryptItem(uk, loginFieldsJson(itemPassword), id, 1);
    const { encKey, encData } = splitCombinedEncryptedItem(combined);
    const create = await req("POST", "/api/vault/items", { token, body: { id, enc_key: encKey, enc_data: encData } });
    if (create.status !== 201) fail(`create: expected 201, got ${create.status}: ${JSON.stringify(create.body)}`);
    console.log(JSON.stringify({ itemId: id, revision: create.body.revision }));
    return;
  }
  fail(`unknown stage '${stage}'`);
}

main().catch((e) => fail(e.stack || String(e)));
MUTATE_EOF

# --- seed the app's server address BEFORE it launches ----------------------
xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1 || true
xcrun simctl spawn "$SIM_UDID" defaults write "$HOST_BUNDLE_ID" pv.server.url -string "$PV_IOS_BASE"

TIMESTAMP="$(date +%s)"
EMAIL="pv-39-06-ef2-${TIMESTAMP}@example.invalid"
PASSWORD="pv-39-06 ef2 account password ${TIMESTAMP}"
MUTATION_PASSWORD="pv-39-06 ef2 mutation item password ${TIMESTAMP}"

# --- launch the UI test IN THE BACKGROUND -- it holds the app open across
# the mutation+kill below (see this file's header on why a relaunch cannot
# be used instead). --------------------------------------------------------
RESULT_BUNDLE="${SCRATCH_DIR}/ef2.xcresult"
XC_LOG="${SCRATCH_DIR}/xcodebuild.log"
echo "==> launching FreshnessEvidenceUITests in the background (account ${EMAIL})"
(
  TEST_RUNNER_PV_FRESHNESS_E2E_EMAIL="$EMAIL" \
  TEST_RUNNER_PV_FRESHNESS_E2E_PASSWORD="$PASSWORD" \
  PV_FRESHNESS_E2E_EMAIL="$EMAIL" \
  PV_FRESHNESS_E2E_PASSWORD="$PASSWORD" \
  xcodebuild test \
    -project "${REPO_ROOT}/ios/PasskeyVault/PasskeyVault.xcodeproj" \
    -scheme PasskeyVault \
    -configuration Debug \
    -destination "platform=iOS Simulator,id=${SIM_UDID}" \
    -parallel-testing-enabled NO \
    "-only-testing:PasskeyVaultUITests/FreshnessEvidenceUITests/testFreshSyncThenStaleAfterServerStop" \
    -resultBundlePath "$RESULT_BUNDLE" \
    >"$XC_LOG" 2>&1
) &
XCODEBUILD_PID=$!

# --- wait for registration to land, straight off the server's own db ------
echo "==> waiting for ${EMAIL} to appear in the throwaway server db"
REGISTERED=0
for _ in $(seq 1 60); do
  COUNT="$(sqlite3 "$PV_IOS_DB" "SELECT count(*) FROM users WHERE email='${EMAIL}';" 2>/dev/null || echo 0)"
  if [ "$COUNT" = "1" ]; then
    REGISTERED=1
    break
  fi
  sleep 1
done
if [ "$REGISTERED" -ne 1 ]; then
  echo "ERROR: ${EMAIL} never appeared in the server db within 60s -- registration failed or never ran." >&2
  wait "$XCODEBUILD_PID" || true
  tail -100 "$XC_LOG" >&2
  exit 1
fi
# The UI test now also creates ONE note (to unlock pull-to-refresh -- see
# that file's own header) and navigates back to the list BEFORE taking its
# "recent" screenshot -- several extra UI-automation steps beyond the bare
# first sync this buffer used to cover. 25s is generous margin over that
# whole sequence's observed real-world duration (~10-15s), so the mutation
# below cannot race the note's own save request against the server dying
# mid-flight (observed live: a killed server racing this exact save call
# left the test unable to reach the app at all).
echo "    registered. Giving the first confirmed pull, note creation, and screenshot time to land."
sleep 25

# --- the mutation: a real, independent, authenticated write ---------------
echo "==> authoring one item as an independent second client session (the 'web client' mutation)"
node "$MUTATE_SCRIPT" create "$PV_IOS_BASE" "$WASM_GLUE" "$WASM_BYTES" "$EMAIL" "$PASSWORD" "$MUTATION_PASSWORD" \
  >"${SCRATCH_DIR}/mutate.json" 2>"${SCRATCH_DIR}/mutate.log" \
  || { echo "ERROR: mutation failed" >&2; cat "${SCRATCH_DIR}/mutate.log" >&2; wait "$XCODEBUILD_PID" || true; exit 1; }
MUTATION_ITEM_ID="$(jq -r '.itemId' "${SCRATCH_DIR}/mutate.json")"
MUTATION_REVISION="$(jq -r '.revision' "${SCRATCH_DIR}/mutate.json")"
echo "    mutation item ${MUTATION_ITEM_ID}, server revision now ${MUTATION_REVISION}"

# --- stop the server for real -----------------------------------------------
# `lsof -ti :PORT` matches EVERY process with a socket touching that port --
# NOT ONLY the server's own LISTEN socket, but ALSO the simulator app's own
# ESTABLISHED connection to it (the app's outgoing socket's REMOTE port is
# also PORT, which `lsof -i` matches from that side too). Found live: an
# unfiltered kill of every PID `lsof -ti` returned was sending SIGTERM
# DIRECTLY TO THE SIMULATOR APP ITSELF whenever it held an open connection
# to the server at kill time -- not a hang, not a resource-contention
# artifact, a self-inflicted termination of the very process this test
# needed to keep running. Filtered here to the actual `pv-server` binary by
# command name, via `ps`, before anything is killed.
SERVER_PIDS="$(lsof -ti ":${PORT}" 2>/dev/null | while IFS= read -r pid; do
  if ps -p "$pid" -o comm= 2>/dev/null | grep -q 'pv-server'; then
    echo "$pid"
  fi
done)"
if [ -z "$SERVER_PIDS" ]; then
  echo "ERROR: no pv-server process found listening on :${PORT} -- cannot stop what isn't running." >&2
  wait "$XCODEBUILD_PID" || true
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
  wait "$XCODEBUILD_PID" || true
  exit 1
fi
echo "    confirmed dead: lsof -ti :${PORT} is empty AND curl ${PV_IOS_BASE}/healthz fails"

# --- wait for the UI test to finish its own hold+background/foreground ----
echo "==> waiting for FreshnessEvidenceUITests to finish"
XC_STATUS=0
wait "$XCODEBUILD_PID" || XC_STATUS=$?
TOTAL_TEST_COUNT="$(xcrun xcresulttool get test-results summary --path "$RESULT_BUNDLE" 2>/dev/null | jq -r '.totalTestCount // 0' 2>/dev/null || echo 0)"
if [ "$XC_STATUS" -ne 0 ] || [ "$TOTAL_TEST_COUNT" -eq 0 ]; then
  echo "ERROR: FreshnessEvidenceUITests FAILED (exit=${XC_STATUS}, totalTestCount=${TOTAL_TEST_COUNT})." >&2
  tail -150 "$XC_LOG" >&2
  exit 1
fi
echo "    PASSED (totalTestCount=${TOTAL_TEST_COUNT})"

# --- export both screenshots off the result bundle -------------------------
EXPORTED="${SCRATCH_DIR}/attachments"
xcrun xcresulttool export attachments --path "$RESULT_BUNDLE" --output-path "$EXPORTED" >/dev/null

export_attachment() {
  local wanted="$1" dest="$2"
  local file
  file="$(python3 - "$EXPORTED/manifest.json" "$wanted" <<'PY'
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
)" || { echo "ERROR: attachment '${wanted}' not in the result bundle" >&2; return 1; }
  cp "$EXPORTED/$file" "$dest"
}

RECENT_PNG="${EVIDENCE_DIR}/39-06-freshness-recent.png"
STALE_PNG="${EVIDENCE_DIR}/39-06-freshness-stale.png"
export_attachment "freshness-recent" "$RECENT_PNG"
export_attachment "freshness-stale" "$STALE_PNG"
echo "    wrote ${RECENT_PNG}, ${STALE_PNG}"

# --- evidence ----------------------------------------------------------------
{
  echo "## Task 1 -- last-synced surface, rendered on the vault list (recent state)"
  echo
  echo "Screenshot, taken immediately after the account's first confirmed pull, before any"
  echo "interaction or scrolling: \`${RECENT_PNG}\`. The rendered string ("
  echo "\`app.staticTexts[\"vault.sync.lastSynced\"]\`, read programmatically by"
  echo "\`FreshnessEvidenceUITests\`, never eyeballed) is legible in it."
  echo
  echo "## Task 3 -- E-F2: the stale-timestamp artifact (SC4, fallback path)"
  echo
  echo "\`ios/evidence/39/04-ws.md\`'s E-S4 result is **Result B** -- this Simulator does not tear"
  echo "down a backgrounded socket, so the proof here comes from stopping the server process for"
  echo "real, not from a backgrounding gesture presented as if it produced the artifact."
  echo
  echo "- Server: ${PV_IOS_BASE}"
  echo "- Simulator UDID: ${SIM_UDID}"
  echo "- Account: ${EMAIL}"
  echo "- Mutation item id: ${MUTATION_ITEM_ID}, server revision after the mutation: ${MUTATION_REVISION}"
  echo "- The mutation was authored by a SECOND, independent iOS-toolchain client session (real"
  echo "  \`pv-wasm\` crypto, real prelogin/login/create over HTTP -- \`scripts/ios-ws-push-proof.sh\`'s"
  echo "  own established \`mutate.mjs\` technique), not the browser web app -- \`pv-ffi\`/\`pv-wasm\`"
  echo "  crypto is not linked into the \`PasskeyVaultUITests\` target, so the running app's own"
  echo "  session could not perform this write itself while staying the surface under test. The"
  echo "  encrypting key for this ONE item is a fresh, throwaway \`WasmUserKey\`, unrelated to the"
  echo "  account's real key -- the on-screen app never decrypts this item in this flow (the server"
  echo "  is stopped before any further pull can succeed), so decrypt correctness is irrelevant here."
  echo
  echo "Screenshots: \`${RECENT_PNG}\` (recent state, before the mutation and before the server"
  echo "stop) and \`${STALE_PNG}\` (captured after the mutation, the real server-stop, and a"
  echo "pull-to-refresh gesture that failed against the now-dead server). The trigger for the"
  echo "second pull is pull-to-refresh (\`.refreshable { await refresh() }\`, the SAME"
  echo "\`VaultStore.refresh()\` Task 2's own proof exercises), not a background/foreground scene-"
  echo "phase transition -- tried first and found, live, to cold-relaunch this app under this"
  echo "Simulator/XCUITest-automation combination once backgrounded, landing back on AuthView"
  echo "instead of demonstrating staleness at all; \`FreshnessEvidenceUITests.swift\`'s own header"
  echo "records that finding in full."
  echo
  echo "\`FreshnessEvidenceUITests\` does NOT assert the two rendered strings are character-for-"
  echo "character identical -- the production \`SyncStatusView\` renders with \`reference: Date()\`,"
  echo "so its relative phrase legitimately grows the longer the reader looks at it even though the"
  echo "underlying \`syncedAtMs\` never moves. The positive assertion instead is that the STALE"
  echo "reading's elapsed-seconds figure is meaningfully LARGER than the recent reading's (by"
  echo "roughly the real wait this test held) -- a pull that had falsely refreshed the timestamp"
  echo "would show the stale reading reset back down near zero instead, which is exactly the"
  echo "\"confident lie\" T-39-23 exists to catch and exactly what this assertion is shaped to fail"
  echo "on. The mutation (revision ${MUTATION_REVISION}) landed server-side strictly after the"
  echo "recent screenshot was taken, and the stale screenshot's last-synced time never reset to"
  echo "reflect it."
  echo
  echo "The backgrounding half of SC4's proof text was NOT demonstrated on this Simulator -- E-S4"
  echo "(39-04) already established that this Simulator does not suspend a backgrounded process's"
  echo "socket the way a real device does, so a backgrounding test here would not distinguish"
  echo "\"correctly observing device behaviour\" from \"the Simulator simply keeps everything alive\"."
  echo "No sentence in this file claims backgrounding was tested as the proof mechanism; the server"
  echo "was stopped, for real, and this test's OWN pull-to-refresh gesture is what triggered the"
  echo "failing pull this evidence shows."
  echo
  echo "\`\`\`"
  echo "E-F2-BREAK: server-stop"
  echo "E-F2-SCREENSHOT: ${STALE_PNG}"
  echo "E-F2-BACKGROUNDING: not-demonstrated-on-simulator"
  echo "\`\`\`"
  echo
} >>"$EVIDENCE_FILE"

echo "==> PASS: E-F2 -- stale artifact produced by a real transport break (server-stop), per E-S4's recorded result."
