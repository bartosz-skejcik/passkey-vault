#!/usr/bin/env bash
# scripts/ios-sync-live-proof.sh -- Phase 39, Plan 39-03, Task 1's tracer.
#
# THE live end-to-end proof for this plan's own <objective>: one login item,
# authored in the web client through the REAL crates/pv-wasm artifact web/
# itself imports (never a mock -- 38-02's own E-W1 precedent,
# scripts/verify-ios-web-item-interop.mjs's registerWeb/createItemAsWebClient,
# the same author sequence 39-01's scripts/sync-contract-probe.sh already
# established), pulled by the REAL iOS production path (`AccountService` ->
# `VaultAPI` -> `VaultStore` -> `pv-ffi` decrypt, exercised by
# `PasskeyVaultTests/SyncTracerLiveProofTests.swift` via `xcodebuild test`,
# never a hand-rolled test path), and asserted on the RECEIVING side across
# three independent checks (D-07, D-08, D-12, D-13):
#
#   1. the decrypted password on the iOS screen equals the literal the web
#      client was given (SyncTracerLiveProofTests, assertion 1).
#   2. the ciphertext strings this script persists in the App Group
#      container -- read straight off the HOST filesystem via
#      `xcrun simctl get_app_container ... groups`, the same technique
#      ios-autofill-layers.sh's own layer-appgroup already established --
#      are SHA-256-identical to the ones `curl` fetched from the SAME
#      session's `GET /api/sync?since=0` (D-13).
#   3. a second pull, answered by the up-to-date branch (nothing changed
#      server-side), leaves the persisted CIPHERTEXT AND REVISION unchanged,
#      with the watermark timestamp never moving backwards
#      (SyncTracerLiveProofTests, assertion 3, D-12/T-39-10). CR-04
#      (39-REVIEW.md): this used to be a byte-for-byte digest comparison --
#      plan 39-06 changed the up-to-date branch to re-persist a blob with a
#      FRESH `syncedAtMs` on every up-to-date pull, so a byte-identical
#      digest is no longer the right invariant; see
#      SyncTracerLiveProofTests.swift's own header for the full account.
#
# Two-stage self re-exec: the OUTER invocation (no PV_IOS_BASE set) brings
# up the isolated server via scripts/ios-live-server.sh --exec and re-execs
# itself as the INNER command, exactly mirroring
# scripts/sync-contract-probe.sh's own wrapped-not-standalone discipline
# (D-23) -- except this script owns BOTH halves itself, because this plan's
# own <verify> block invokes it directly with only --expect-password, not
# pre-wrapped.
#
# PV_IOS_EVIDENCE_FILE is pointed at /dev/null for the wrapped
# ios-live-server.sh call: THIS script writes its own evidence into
# ios/evidence/39/03-tracer.md directly, and must never overwrite 39-01's
# already-committed ios/evidence/39/01-server-contract.md (the exact hazard
# scripts/ios-live-server.sh's own PV_IOS_EVIDENCE_FILE seam, added in this
# same plan, exists to prevent).
#
# Falsification (D-08): PV_TRACER_FALSIFY_ONE_CHAR=1 authors the item with
# the REAL --expect-password literal (unchanged), but hands
# SyncTracerLiveProofTests a ONE-CHARACTER-MUTATED value to compare against
# -- decoupling "what was authored" from "what is checked" is the only way
# to falsify a check whose two sides would otherwise be the SAME shell
# variable by construction (see this script's own inline note at the mutation
# site for why a second full run with a different --expect-password value
# alone can never produce a genuine mismatch under this design).
#
# Shell discipline (L-3, ios/IOS-SPIKE-LOG.md §3): zsh's bash-only post-pipe
# status array is silently empty here; every exit code this script reacts to
# is either a direct command's own $? (captured immediately, never through a
# pipeline) or read back from a file, matching scripts/ios-live-server.sh and
# scripts/sync-contract-probe.sh's own established discipline.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EVIDENCE_FILE="ios/evidence/39/03-tracer.md"
HOST_BUNDLE_ID="cloud.blonie.PasskeyVault"
APP_GROUP_ID="group.cloud.blonie.PasskeyVault"
CACHE_FILE_NAME="vault-cache-v1.json"
SIM_UDID_FILE="/private/tmp/pv16.udid"

usage() {
  echo "Usage: $0 --expect-password <literal>" >&2
  exit 2
}

EXPECT_PASSWORD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --expect-password)
      EXPECT_PASSWORD="${2:-}"
      shift 2
      ;;
    *)
      echo "ERROR: unknown argument '$1'" >&2
      usage
      ;;
  esac
done
if [ -z "$EXPECT_PASSWORD" ]; then
  echo "ERROR: --expect-password <literal> is required and must be non-empty." >&2
  usage
fi

# --- outer invocation: bring up the isolated server, then re-exec self ----
if [ -z "${PV_IOS_BASE:-}" ]; then
  export PV_IOS_EVIDENCE_FILE="/dev/null"
  exec "${REPO_ROOT}/scripts/ios-live-server.sh" --exec \
    "${REPO_ROOT}/scripts/ios-sync-live-proof.sh" --expect-password "$EXPECT_PASSWORD"
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

SCRATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pv-39-03-tracer.XXXXXX")"
cleanup() { rm -rf "$SCRATCH_DIR"; }
trap cleanup EXIT

TIMESTAMP="$(date +%s)"
TRACER_EMAIL="pv-39-03-tracer-${TIMESTAMP}@example.invalid"
TRACER_ACCOUNT_PASSWORD="pv-39-03 tracer account password ${TIMESTAMP}"

# --- author one login item as the web client, through the REAL pv-wasm ----
# Generated into the scratch dir, never committed -- the same discipline
# scripts/sync-contract-probe.sh's own FIXTURE_SCRIPT already established,
# for the same reason: this plan's files_modified list names the shell
# script itself, not a second permanent .mjs file.
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

// web/src/lib/vault/store.ts:201-210's own split, reproduced verbatim (the
// same technique scripts/verify-ios-web-item-interop.mjs and
// scripts/sync-contract-probe.sh already use).
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

  // ONE login item -- fields per
  // ios/PasskeyVault/PasskeyVault/Vault/ItemFields.swift's LoginFields.
  const id = crypto.randomUUID();
  const fields = {
    type: "login",
    name: "39-03 tracer login",
    folderId: null,
    tags: [],
    username: "tracer@example.invalid",
    password: itemPassword,
    urls: [],
    notes: "",
  };
  const combined = mod.encryptItem(uk, JSON.stringify(fields), id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const create = await req("POST", "/api/vault/items", { token, body: { id, enc_key: encKey, enc_data: encData } });
  if (create.status !== 201) fail(`create item: expected 201, got ${create.status}: ${JSON.stringify(create.body)}`);

  console.log(JSON.stringify({ email, token, itemId: id, revision: create.body.revision }));
}

main().catch((e) => fail(e.stack || String(e)));
AUTHOR_EOF

AUTHOR_JSON="${SCRATCH_DIR}/author.json"
echo "==> authoring one login item as the web client (real pv-wasm) against ${PV_IOS_BASE}"
if ! node "$AUTHOR_SCRIPT" "$PV_IOS_BASE" "$WASM_GLUE" "$WASM_BYTES" \
      "$TRACER_EMAIL" "$TRACER_ACCOUNT_PASSWORD" "$EXPECT_PASSWORD" \
      >"$AUTHOR_JSON" 2>"${SCRATCH_DIR}/author.log"; then
  echo "ERROR: fixture authoring through the real web-client WASM crypto path failed." >&2
  cat "${SCRATCH_DIR}/author.log" >&2
  exit 1
fi

TOKEN="$(jq -r '.token' "$AUTHOR_JSON")"
ITEM_ID="$(jq -r '.itemId' "$AUTHOR_JSON")"
ITEM_REVISION="$(jq -r '.revision' "$AUTHOR_JSON")"
echo "==> authored item ${ITEM_ID} (revision ${ITEM_REVISION}) for ${TRACER_EMAIL}"

# --- curl the SAME session's GET /api/sync?since=0 (D-13's server side) ---
SYNC_BODY="${SCRATCH_DIR}/sync-since0.json"
echo "==> curl GET /api/sync?since=0"
curl -fsS -H "Authorization: Bearer ${TOKEN}" "${PV_IOS_BASE}/api/sync?since=0" -o "$SYNC_BODY"

CURL_ENC_KEY="$(jq -r --arg id "$ITEM_ID" '.items[] | select(.id == $id) | .enc_key' "$SYNC_BODY")"
CURL_ENC_DATA="$(jq -r --arg id "$ITEM_ID" '.items[] | select(.id == $id) | .enc_data' "$SYNC_BODY")"
if [ -z "$CURL_ENC_KEY" ] || [ -z "$CURL_ENC_DATA" ]; then
  echo "ERROR: item ${ITEM_ID} not found in the curl-fetched /api/sync body." >&2
  exit 1
fi
CURL_ENC_KEY_DIGEST="$(printf '%s' "$CURL_ENC_KEY" | shasum -a 256 | awk '{print $1}')"
CURL_ENC_DATA_DIGEST="$(printf '%s' "$CURL_ENC_DATA" | shasum -a 256 | awk '{print $1}')"
echo "    enc_key  digest (curl)      = ${CURL_ENC_KEY_DIGEST}"
echo "    enc_data digest (curl)      = ${CURL_ENC_DATA_DIGEST}"

# --- the value SyncTracerLiveProofTests is asked to compare against -------
# D-08 falsification arm: PV_TRACER_FALSIFY_ONE_CHAR=1 hands the TEST a
# mutated value while the AUTHORED item keeps the real one, so the
# comparison can genuinely fail (see this file's header for why the two
# sides cannot be decoupled any other way under this design).
CHECKED_ITEM_PASSWORD="$EXPECT_PASSWORD"
if [ "${PV_TRACER_FALSIFY_ONE_CHAR:-0}" = "1" ]; then
  CHECKED_ITEM_PASSWORD="${EXPECT_PASSWORD}X"
  echo "    (PV_TRACER_FALSIFY_ONE_CHAR=1 -- authored password unchanged, but the TEST will compare against a one-character-longer value: expect a mismatch failure)"
fi

# --- run the iOS live-proof test on the simulator --------------------------
export PV_TEST_SERVER="$PV_IOS_BASE"
export TEST_RUNNER_PV_TEST_SERVER="$PV_IOS_BASE"
export PV_TRACER_EMAIL="$TRACER_EMAIL"
export TEST_RUNNER_PV_TRACER_EMAIL="$TRACER_EMAIL"
export PV_TRACER_ACCOUNT_PASSWORD="$TRACER_ACCOUNT_PASSWORD"
export TEST_RUNNER_PV_TRACER_ACCOUNT_PASSWORD="$TRACER_ACCOUNT_PASSWORD"
export PV_TRACER_ITEM_PASSWORD="$CHECKED_ITEM_PASSWORD"
export TEST_RUNNER_PV_TRACER_ITEM_PASSWORD="$CHECKED_ITEM_PASSWORD"

RESULT_BUNDLE="${SCRATCH_DIR}/tracer.xcresult"
XC_LOG="${SCRATCH_DIR}/xcodebuild.log"
echo "==> xcodebuild test: SyncTracerLiveProofTests (sign-in + first pull + second up-to-date pull, real App Group write)"
XC_STATUS=0
xcodebuild test \
  -project "${REPO_ROOT}/ios/PasskeyVault/PasskeyVault.xcodeproj" \
  -scheme PasskeyVault \
  -configuration Debug \
  -destination "platform=iOS Simulator,id=${SIM_UDID}" \
  -parallel-testing-enabled NO \
  "-only-testing:PasskeyVaultTests/SyncTracerLiveProofTests/iOSPullsAWebAuthoredItemThroughThePersistedCacheAndASecondPullLeavesItUnchanged()" \
  -resultBundlePath "$RESULT_BUNDLE" \
  >"$XC_LOG" 2>&1 || XC_STATUS=$?

TOTAL_TEST_COUNT="$(xcrun xcresulttool get test-results summary --path "$RESULT_BUNDLE" 2>/dev/null | jq -r '.totalTestCount // 0' 2>/dev/null || echo 0)"
# L-9 family: a `-only-testing:` typo matches ZERO tests and xcodebuild still
# exits 0 -- treated as a hard failure here, never a silent pass.
if [ "$XC_STATUS" -ne 0 ] || [ "$TOTAL_TEST_COUNT" -eq 0 ]; then
  echo "ERROR: SyncTracerLiveProofTests FAILED (exit=${XC_STATUS}, totalTestCount=${TOTAL_TEST_COUNT})." >&2
  FAILURE_SUMMARY="$(xcrun xcresulttool get test-results tests --path "$RESULT_BUNDLE" 2>/dev/null | jq -r '.. | .name? // empty' | grep -E 'Expectation failed|Caught error|Issue recorded' || true)"
  if [ -n "$FAILURE_SUMMARY" ]; then
    echo "    ${FAILURE_SUMMARY}" >&2
  fi
  tail -100 "$XC_LOG" >&2
  exit 1
fi
echo "    xcodebuild test PASSED (totalTestCount=${TOTAL_TEST_COUNT})"

# --- read the persisted App Group cache straight off the HOST filesystem --
# The same outside-view technique scripts/ios-autofill-layers.sh's own
# layer-appgroup already established: `simctl get_app_container ... groups`
# resolves the container path without needing to run inside the app process
# -- but ONLY while the device is Booted. `xcodebuild test` leaves this
# simulator Shutdown once the test run completes; `simctl boot` does not
# erase device data (only `simctl erase` does), so re-booting here is safe
# and does not disturb the file this step is about to read.
echo "==> ensuring the simulator is booted (xcodebuild test leaves it Shutdown)"
xcrun simctl boot "$SIM_UDID" >/dev/null 2>&1 || true
xcrun simctl bootstatus "$SIM_UDID" -b >/dev/null 2>&1 || true

echo "==> resolving the App Group container (host/outside view)"
HOST_GROUPS_OUT="${SCRATCH_DIR}/appgroup-host.txt"
xcrun simctl get_app_container "$SIM_UDID" "$HOST_BUNDLE_ID" groups >"$HOST_GROUPS_OUT" 2>&1 || true
CONTAINER_PATH="$(awk -F'\t' -v g="$APP_GROUP_ID" '$1==g{print $2}' "$HOST_GROUPS_OUT" | head -1)"
if [ -z "$CONTAINER_PATH" ] || [ ! -d "$CONTAINER_PATH" ]; then
  echo "ERROR: could not resolve the App Group container for ${APP_GROUP_ID}." >&2
  cat "$HOST_GROUPS_OUT" >&2
  exit 1
fi
CACHE_FILE="${CONTAINER_PATH}/${CACHE_FILE_NAME}"
if [ ! -f "$CACHE_FILE" ]; then
  echo "ERROR: persisted cache file not found at ${CACHE_FILE}." >&2
  exit 1
fi

PERSISTED_ENC_KEY="$(jq -r --arg id "$ITEM_ID" '.items[] | select(.id == $id) | .encKey' "$CACHE_FILE")"
PERSISTED_ENC_DATA="$(jq -r --arg id "$ITEM_ID" '.items[] | select(.id == $id) | .encData' "$CACHE_FILE")"
if [ -z "$PERSISTED_ENC_KEY" ] || [ -z "$PERSISTED_ENC_DATA" ]; then
  echo "ERROR: item ${ITEM_ID} not found in the persisted cache file (${CACHE_FILE})." >&2
  exit 1
fi
PERSISTED_ENC_KEY_DIGEST="$(printf '%s' "$PERSISTED_ENC_KEY" | shasum -a 256 | awk '{print $1}')"
PERSISTED_ENC_DATA_DIGEST="$(printf '%s' "$PERSISTED_ENC_DATA" | shasum -a 256 | awk '{print $1}')"
echo "    enc_key  digest (persisted) = ${PERSISTED_ENC_KEY_DIGEST}"
echo "    enc_data digest (persisted) = ${PERSISTED_ENC_DATA_DIGEST}"

DIGESTS_OK=1
if [ "$CURL_ENC_KEY_DIGEST" != "$PERSISTED_ENC_KEY_DIGEST" ]; then
  echo "ERROR: enc_key digest MISMATCH -- curl=${CURL_ENC_KEY_DIGEST} persisted=${PERSISTED_ENC_KEY_DIGEST}" >&2
  DIGESTS_OK=0
fi
if [ "$CURL_ENC_DATA_DIGEST" != "$PERSISTED_ENC_DATA_DIGEST" ]; then
  echo "ERROR: enc_data digest MISMATCH -- curl=${CURL_ENC_DATA_DIGEST} persisted=${PERSISTED_ENC_DATA_DIGEST}" >&2
  DIGESTS_OK=0
fi

# --- evidence ---------------------------------------------------------------
{
  echo "## Live proof run -- $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo
  echo "- Server: ${PV_IOS_BASE}"
  echo "- Simulator UDID: ${SIM_UDID}"
  echo "- Tracer account: ${TRACER_EMAIL}"
  echo "- Item id: ${ITEM_ID}, revision after create: ${ITEM_REVISION}"
  echo "- --expect-password literal (verbatim): \`${EXPECT_PASSWORD}\`"
  if [ "${PV_TRACER_FALSIFY_ONE_CHAR:-0}" = "1" ]; then
    echo "- **PV_TRACER_FALSIFY_ONE_CHAR=1** -- the value checked against was \`${CHECKED_ITEM_PASSWORD}\` (one character mutated), the authored item kept the real literal above"
  fi
  echo "- xcodebuild test totalTestCount: ${TOTAL_TEST_COUNT}, exit status: ${XC_STATUS}"
  echo "- App Group container (host path): ${CONTAINER_PATH}"
  echo
  echo "### D-13 digest comparison (enc_key/enc_data, curl-fetched vs. persisted store)"
  echo
  echo "| field | curl (same session) | persisted store |"
  echo "|---|---|---|"
  echo "| enc_key | \`${CURL_ENC_KEY_DIGEST}\` | \`${PERSISTED_ENC_KEY_DIGEST}\` |"
  echo "| enc_data | \`${CURL_ENC_DATA_DIGEST}\` | \`${PERSISTED_ENC_DATA_DIGEST}\` |"
  echo
  if [ "$DIGESTS_OK" -eq 1 ]; then
    echo "Digests are IDENTICAL for both fields."
  else
    echo "**Digests DIFFER -- see this run's stderr.**"
  fi
  echo
} >>"$EVIDENCE_FILE"

if [ "$DIGESTS_OK" -ne 1 ]; then
  exit 1
fi

echo "==> PASS: rendered password matches, ciphertext digests match, the up-to-date pull left the persisted ciphertext/revision unchanged (syncedAtMs advanced, never regressed)."
