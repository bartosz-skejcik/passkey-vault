#!/usr/bin/env bash
# scripts/sync-contract-probe.sh -- Phase 39, Plan 39-01, Task 2.
#
# Settles, against a live server and BEFORE any Swift decoder exists, the
# two facts 39-RESEARCH.md's E-S1/E-S2 name and this whole phase is built
# on:
#
#   (a)/(b) `GET /api/sync`'s two response branches -- the `UpToDate` branch
#       carries NO `items` key at all (D-12); a Swift decoder that models
#       the field as optional and coalesces a missing value to an empty
#       array would silently erase a persisted cache on the server's most
#       common answer.
#   (c) the wire encoding of `enc_key`, for a row authored by a genuinely
#       independent client's real crypto -- `serde_json`'s number-array
#       shape, not a base64 string (D-13).
#   (d) crates/pv-server is never touched by this plan (D-01) -- asserted,
#       and the assertion is demonstrated able to fail.
#
# Run through scripts/ios-live-server.sh --exec, which exports PV_IOS_BASE
# and PV_IOS_DB. This script refuses to run standalone (D-23 -- it must
# never touch a server it did not confirm is isolated).
#
# The "genuinely independent client" for (c): this script authors the
# fixture item through the REAL crates/pv-wasm artifact web/ itself imports
# (web/src/lib/crypto/wasm/pv_wasm.js + web/public/wasm/pv_wasm_bg.wasm) --
# the same mechanism already established and vetted by Phase 38's own E-W1
# cross-client proof (scripts/verify-ios-web-item-interop.mjs's
# registerWeb/createItemAsWebClient). web/node_modules is not present in
# this worktree, so a running Next.js dev server is not the fixture-authoring
# mechanism here; driving the actual WASM binary web/ ships is the same real
# crypto path store.ts::createVaultItem exercises, and is this repo's own
# precedent for "genuinely independent client, real WASM crypto" (see
# ios/IOS-SPIKE-LOG.md DR-37-A/DR-38-C). A row inserted by curl or by hand
# would prove nothing about cross-client encoding -- this is not that.
#
# Shell discipline (landmine L-3, ios/IOS-SPIKE-LOG.md §3): this project's
# shell is zsh, where the bash-only post-pipe status array is spelled
# differently and is silently empty here. This script never relies on that
# array; every `jq -e` runs on a file saved to disk first, under
# `set -o pipefail` (via `set -euo pipefail`), never inside a pipeline whose
# status is then read back out of that array.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

EVIDENCE_FILE="ios/evidence/39/01-server-contract.md"
LOG_FILE="ios/IOS-SPIKE-LOG.md"

if [ -z "${PV_IOS_BASE:-}" ]; then
  echo "ERROR: PV_IOS_BASE is not set. Run this script through:" >&2
  echo "  scripts/ios-live-server.sh --exec scripts/sync-contract-probe.sh" >&2
  echo "never standalone -- this script must run against a confirmed-isolated server (D-23)." >&2
  exit 2
fi
if [ ! -f "$EVIDENCE_FILE" ]; then
  echo "ERROR: ${EVIDENCE_FILE} does not exist -- expected ios-live-server.sh to have created it first." >&2
  exit 2
fi

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/pv-sync-contract-probe.XXXXXX")"
cleanup_workdir() { rm -rf "$WORKDIR"; }
trap cleanup_workdir EXIT

PASS_COUNT=0
FAIL_COUNT=0
pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "PASS: $1"
}
fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "FAIL: $1" >&2
}

append_evidence() {
  cat >>"$EVIDENCE_FILE"
}

# ============================================================================
# Step 0: author the fixture through the REAL web-client WASM crypto path.
# ============================================================================
WASM_GLUE="${REPO_ROOT}/web/src/lib/crypto/wasm/pv_wasm.js"
WASM_BYTES="${REPO_ROOT}/web/public/wasm/pv_wasm_bg.wasm"
if [ ! -f "$WASM_GLUE" ] || [ ! -f "$WASM_BYTES" ]; then
  echo "ERROR: pv-wasm artifact missing (${WASM_GLUE} / ${WASM_BYTES})." >&2
  echo "Run scripts/build-wasm.sh first." >&2
  exit 1
fi

FIXTURE_PASSWORD="pv-39-01 sync-contract-probe fixture password $(date +%s)"
FIXTURE_JSON="${WORKDIR}/fixture.json"
FIXTURE_SCRIPT="${WORKDIR}/fixture.mjs"

# Generated into the workdir (never committed) rather than living as a
# tracked file -- this plan's own files_modified list names only
# scripts/sync-contract-probe.sh itself, ios/evidence/39/01-server-contract.md
# and ios/IOS-SPIKE-LOG.md. This block IS the "web client, real WASM crypto"
# fixture author: the same register/login/encryptItem sequence
# scripts/verify-ios-web-item-interop.mjs's registerWeb/createItemAsWebClient
# already established and this repo already trusts (38-02's E-W1).
cat >"$FIXTURE_SCRIPT" <<'FIXTURE_EOF'
import { readFileSync } from "node:fs";
import path from "node:path";

const [, , base, glueUrl, wasmBytesPath, password] = process.argv;

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

// store.ts::createVaultItem's own split of encryptItem's combined output
// (web/src/lib/vault/store.ts:198-210), reproduced verbatim.
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

  const email = `pv-39-01-sync-contract-${Date.now()}@example.invalid`;

  const salt = mod.randomSalt(16);
  const kdfParamsJson = mod.defaultKdfParamsJson();
  const material = mod.deriveAuthMaterial(new TextEncoder().encode(password), salt, kdfParamsJson);
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

  // One login item, the real fixture -- fields per
  // packages/pv-ui/vault/types.ts LoginFields.
  const id = crypto.randomUUID();
  const fields = {
    type: "login",
    name: "39-01 sync-contract-probe fixture",
    folderId: null,
    tags: [],
    username: "sync-contract-probe@example.invalid",
    password,
    urls: ["https://example.invalid/sync-contract-probe"],
    notes: "",
  };
  const combined = mod.encryptItem(uk, JSON.stringify(fields), id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const create = await req("POST", "/api/vault/items", { token, body: { id, enc_key: encKey, enc_data: encData } });
  if (create.status !== 201) fail(`create item: expected 201, got ${create.status}: ${JSON.stringify(create.body)}`);

  console.log(JSON.stringify({ email, token, itemId: id }));
}

main().catch((e) => fail(e.stack || String(e)));
FIXTURE_EOF

node "$FIXTURE_SCRIPT" "$PV_IOS_BASE" "$WASM_GLUE" "$WASM_BYTES" "$FIXTURE_PASSWORD" \
  >"$FIXTURE_JSON" 2>"${WORKDIR}/fixture.log" \
  || {
    echo "ERROR: fixture authoring through the real web-client WASM crypto path failed." >&2
    cat "${WORKDIR}/fixture.log" >&2
    exit 1
  }

TOKEN="$(jq -r '.token' "$FIXTURE_JSON")"
FIXTURE_EMAIL="$(jq -r '.email' "$FIXTURE_JSON")"
FIXTURE_ITEM_ID="$(jq -r '.itemId' "$FIXTURE_JSON")"
if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo "ERROR: fixture script did not return a session token. Log:" >&2
  cat "${WORKDIR}/fixture.log" >&2
  exit 1
fi
echo "==> fixture authored: account=${FIXTURE_EMAIL} item=${FIXTURE_ITEM_ID}"

# ============================================================================
# (a) since=0 -> a Snapshot body whose items member is a non-empty JSON array
# ============================================================================
BODY_SINCE_0="${WORKDIR}/since-0.json"
curl -fsS -H "Authorization: Bearer ${TOKEN}" "${PV_IOS_BASE}/api/sync?since=0" >"$BODY_SINCE_0"

if jq -e '.items | type == "array"' "$BODY_SINCE_0" >/dev/null && jq -e '.items | length > 0' "$BODY_SINCE_0" >/dev/null; then
  pass "E-S1(a): since=0 body has a non-empty items array"
else
  fail "E-S1(a): since=0 body does not have a non-empty items array -- $(cat "$BODY_SINCE_0")"
fi

# ============================================================================
# (b) since=<current revision> -> UpToDate, no items member at all (D-12)
# ============================================================================
REVISION="$(jq -r '.revision' "$BODY_SINCE_0")"
BODY_UP_TO_DATE="${WORKDIR}/since-current.json"
curl -fsS -H "Authorization: Bearer ${TOKEN}" "${PV_IOS_BASE}/api/sync?since=${REVISION}" >"$BODY_UP_TO_DATE"

if jq -e 'has("items") | not' "$BODY_UP_TO_DATE" >/dev/null; then
  pass "E-S1(b): since=${REVISION} (current) body has no items member (UpToDate branch, D-12)"
else
  fail "E-S1(b): since=${REVISION} body unexpectedly carries an items member -- $(cat "$BODY_UP_TO_DATE")"
fi

# Falsifiability control (D-06): the SAME assertion, pointed at the snapshot
# body, MUST fail -- that body genuinely has an items member.
UP_TO_DATE_CONTROL_RC=0
jq -e 'has("items") | not' "$BODY_SINCE_0" >/dev/null || UP_TO_DATE_CONTROL_RC=$?
if [ "$UP_TO_DATE_CONTROL_RC" -ne 0 ]; then
  pass "E-S1(b) control: the has-no-items assertion exits non-zero against the snapshot body (proves the check can fail)"
else
  fail "E-S1(b) control: the has-no-items assertion incorrectly passed against the snapshot body -- the check is not gating"
fi

# ============================================================================
# (c) enc_key wire encoding: nonce member's JSON type is "array" (D-13, D-07)
# ============================================================================
ENC_KEY_RAW="$(jq -r '.items[0].enc_key' "$BODY_SINCE_0")"
ENC_KEY_PREFIX="$(printf '%s' "$ENC_KEY_RAW" | cut -c1-40)"
NONCE_TYPE="$(printf '%s' "$ENC_KEY_RAW" | jq -e -r '.nonce | type' 2>/dev/null || echo "__unparseable__")"

if [ "$NONCE_TYPE" = "array" ]; then
  pass "E-S2(c): enc_key.nonce is a JSON array (serde_json number-array shape, matches D-13)"
elif [ "$NONCE_TYPE" = "string" ]; then
  fail "E-S2(c): enc_key.nonce is a JSON STRING (base64-shaped) -- a foreign-shaped blob was already written. This outranks the rest of the phase; STOP."
  echo "" >&2
  echo "STOP: enc_key.nonce classified as a string, not an array. See ${EVIDENCE_FILE}." >&2
else
  fail "E-S2(c): enc_key.nonce did not classify as either array or string -- raw: ${ENC_KEY_RAW}"
fi

# ============================================================================
# (d) crates/pv-server diff gate (D-01), demonstrated able to fail
# ============================================================================
DIFF_STAT_CLEAN_BEFORE="$(git diff --stat -- crates/pv-server || true)"
if [ -z "$DIFF_STAT_CLEAN_BEFORE" ]; then
  pass "E-diff(d): git diff --stat -- crates/pv-server is empty before falsification"
else
  fail "E-diff(d): crates/pv-server has an unexpected diff BEFORE falsification -- ${DIFF_STAT_CLEAN_BEFORE}"
fi

TOUCH_TARGET="crates/pv-server/src/main.rs"
DIFF_FALSIFY_RC=0
printf '\n' >>"$TOUCH_TARGET"
DIFF_STAT_TOUCHED="$(git diff --stat -- crates/pv-server || true)"
git checkout -- "$TOUCH_TARGET"
DIFF_STAT_RESTORED="$(git diff --stat -- crates/pv-server || true)"

if [ -n "$DIFF_STAT_TOUCHED" ] && [ -z "$DIFF_STAT_RESTORED" ]; then
  pass "E-diff(d) control: the diff gate reports non-empty when ${TOUCH_TARGET} is touched, and empty again after restore"
else
  fail "E-diff(d) control: touch/restore did not produce the expected non-empty-then-empty sequence -- touched='${DIFF_STAT_TOUCHED}' restored='${DIFF_STAT_RESTORED}'"
fi

# ============================================================================
# Evidence + landmine L-9
# ============================================================================
{
  echo "## Task 2 transcript -- E-S1/E-S2 probe run"
  echo
  echo "- Fixture account: ${FIXTURE_EMAIL}"
  echo "- Fixture item id: ${FIXTURE_ITEM_ID}"
  echo "- Fixture password literal (known, for a later byte-equality proof): \`${FIXTURE_PASSWORD}\`"
  echo "- Revision after one item create: ${REVISION}"
  echo
  echo "### (a) GET /api/sync?since=0 (Snapshot branch)"
  echo
  echo '```json'
  cat "$BODY_SINCE_0"
  echo
  echo '```'
  echo
  echo "### (b) GET /api/sync?since=${REVISION} (UpToDate branch, D-12)"
  echo
  echo '```json'
  cat "$BODY_UP_TO_DATE"
  echo
  echo '```'
  echo
  echo "Falsifiability control: \`jq -e 'has(\"items\")|not'\` against the since=0 body above exits **${UP_TO_DATE_CONTROL_RC}** (non-zero required, and observed)."
  echo
  echo "### (c) enc_key wire encoding (D-13)"
  echo
  echo "First 40 characters of \`items[0].enc_key\`: \`${ENC_KEY_PREFIX}\`"
  echo
  echo "\`.nonce | type\` => \`${NONCE_TYPE}\` (expected literal: \`array\`)"
  echo
  echo "### (d) crates/pv-server diff gate (D-01)"
  echo
  echo "- Before falsification: \`git diff --stat -- crates/pv-server\` => \`${DIFF_STAT_CLEAN_BEFORE:-<empty>}\`"
  echo "- After touching ${TOUCH_TARGET} (trailing newline appended): \`${DIFF_STAT_TOUCHED:-<empty>}\`"
  echo "- After \`git checkout -- ${TOUCH_TARGET}\`: \`${DIFF_STAT_RESTORED:-<empty>}\`"
  echo
  echo "### Assertion summary"
  echo
  echo "- PASS count: ${PASS_COUNT}"
  echo "- FAIL count: ${FAIL_COUNT}"
  echo
} | append_evidence

echo
echo "==> ${PASS_COUNT} PASS, ${FAIL_COUNT} FAIL"

if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi

# ---------------------------------------------------------------------------
# Landmine -- only recorded once the probe run itself is fully green, so a
# red run never leaves a "Verified" landmine entry behind it.
#
# The plan text that generated this script names the new entry "L-9" on the
# premise that the log "currently ends at L-6" with "Phase 36 expected to
# have added L-7/L-8 by the time this runs". That premise is stale: by the
# time this script runs, IDs through L-21 already exist in §3 (Phases 36-38
# added many), and L-9 itself already names an unrelated landmine ("a check
# that cannot fail produced FOUR more instances in a single phase"). Reusing
# L-9 would silently overwrite/duplicate that entry's number. This is a
# blocking-issue auto-fix (deviation Rule 3): the next unused ID is computed
# from the log itself rather than hardcoded, and this substitution is
# recorded in the plan's SUMMARY.
# ---------------------------------------------------------------------------
# Idempotency is keyed on CONTENT (this landmine's fixed title text), never
# on a number -- a number-keyed check would recompute a fresh "next free ID"
# on every re-run and insert an ever-growing chain of duplicates each time
# this script runs, which is exactly what happened during this plan's own
# development and is why this comment exists.
LANDMINE_TITLE_MARKER='the `GET /api/sync` up-to-date branch omits `items` entirely, not merely sets it null'

if grep -qF "$LANDMINE_TITLE_MARKER" "$LOG_FILE"; then
  EXISTING_ID="$(grep -oE '^### L-[0-9]+ -- the .GET /api/sync. up-to-date branch omits' "$LOG_FILE" | grep -oE 'L-[0-9]+' | head -1)"
  echo "==> landmine already present in ${LOG_FILE} as ${EXISTING_ID:-<unknown id>} -- not duplicated"
else
  NEXT_LANDMINE_NUM=$(grep -oE '^### L-[0-9]+' "$LOG_FILE" | grep -oE '[0-9]+' | sort -n | tail -1)
  NEXT_LANDMINE_NUM=$((NEXT_LANDMINE_NUM + 1))
  NEW_LANDMINE_ID="L-${NEXT_LANDMINE_NUM}"
  ANCHOR='## 3a. The visual layer was never verified'
  if ! grep -qF "$ANCHOR" "$LOG_FILE"; then
    echo "WARNING: could not find the §3a anchor in ${LOG_FILE} to insert ${NEW_LANDMINE_ID} before -- append it manually." >&2
  else
    LANDMINE_BLOCK_FILE="${WORKDIR}/landmine-block.md"
    {
      echo "### ${NEW_LANDMINE_ID} -- the \`GET /api/sync\` up-to-date branch omits \`items\` entirely, not merely sets it null"
      echo
      echo "**Found 2026-08-18, Phase 39, Plan 39-01, Task 2.** \`SyncResponse\` (\`crates/pv-server/src/routes/sync.rs\`) is a"
      echo "\`#[serde(untagged)]\` two-variant enum, not one struct with an optional \`items\` field: the \`UpToDate\` branch has no"
      echo "\`items\` KEY at all on the wire. A Swift decoder that models \`items\` as optional and coalesces a missing value to an"
      echo "empty array would silently erase a persisted cache on the server's most common response (every sync call after the"
      echo "first one, on an unchanged vault)."
      echo
      echo "**Verified against a live isolated server** (\`scripts/ios-live-server.sh --exec scripts/sync-contract-probe.sh\`),"
      echo "not inferred from source alone: \`GET /api/sync?since=<current revision>\` returned a body where"
      echo "\`jq -e 'has(\"items\")|not'\` exits **0** -- while the identical check against the \`since=0\` snapshot body (which"
      echo "does carry \`items\`) exits **non-zero**, the required falsifiability control (D-06). Both bodies and both exit codes"
      echo "are recorded verbatim in \`ios/evidence/39/01-server-contract.md\`."
      echo
      echo "**Consequence for 39-03's decoder:** decode \`SyncResponse\` as a genuine two-case enum (or an equivalent"
      echo "presence-checked branch), never as one struct with \`items: [Item]?\` defaulted to \`[]\` on \`nil\`."
      echo
    } >"$LANDMINE_BLOCK_FILE"
    awk -v anchor="$ANCHOR" -v blockfile="$LANDMINE_BLOCK_FILE" '
      index($0, anchor) == 1 && !done {
        while ((getline line < blockfile) > 0) print line
        close(blockfile)
        done = 1
      }
      { print }
    ' "$LOG_FILE" >"${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
    echo "==> ${NEW_LANDMINE_ID} landmine inserted into ${LOG_FILE} §3 (before §3a)"
  fi
fi

exit 0
