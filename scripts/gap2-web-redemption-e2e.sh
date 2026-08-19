#!/usr/bin/env bash
# scripts/gap2-web-redemption-e2e.sh -- 40-VERIFICATION.md gap 2 (SC2's web
# half; discharges WR-08, carried unresolved through two review iterations).
#
# Wires `scripts/invite-live-e2e.mjs` -- committed with zero callers, per
# the verifier's own `grep` -- to a REAL invite authored by the REAL iOS
# app: `InviteAuthoredForWebRedemptionTests.authorInviteForHostSideWebRedemption()`
# (a live XCTest, run here via `xcodebuild test-without-building`) drives
# the production `InviteService` against a live `pv-server` and hands the
# resulting invite URL to THIS script over a JSON file. This script then
# redeems it through the REAL `pv-wasm` artifact `web/` itself imports
# (`scripts/invite-live-e2e.mjs redeem`, same discipline as
# `scripts/verify-ios-web-item-interop.mjs`), and asserts the new member
# from BOTH the raw HTTP roster (receiver-side, account A's own token) and
# the node driver's own `members` subcommand.
#
# Two real clients, one continuous run: iOS/pv-ffi authors, pv-wasm redeems.
#
# Preconditions (never started/managed by this script -- same "assume the
# harness, don't rebuild it" discipline every sibling live-proof script in
# this repo follows):
#   - `scripts/ios-live-server.sh` already running (PV_IOS_BASE exported,
#     default http://127.0.0.1:8621)
#   - the PV-iPhone16 simulator already built for testing
#     (`xcodebuild build-for-testing`, Debug)
#   - `web/src/lib/crypto/wasm/pv_wasm.js` + `web/public/wasm/pv_wasm_bg.wasm`
#     present (`scripts/build-wasm.sh` if missing)
#
# Usage:
#   PV_IOS_BASE=http://127.0.0.1:8621 \
#   PV_IOS_SIMULATOR_UDID=$(cat /private/tmp/pv16.udid) \
#   bash scripts/gap2-web-redemption-e2e.sh
#
# Exit status is the run's own -- never masked to 0.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASE_URL="${PV_IOS_BASE:-http://127.0.0.1:8621}"
SIM_UDID="${PV_IOS_SIMULATOR_UDID:-}"
if [ -z "$SIM_UDID" ]; then
  echo "ERROR: PV_IOS_SIMULATOR_UDID is not set (e.g. \$(cat /private/tmp/pv16.udid))." >&2
  exit 2
fi

EVIDENCE_FILE="ios/evidence/40/40-06-ef2-web-redemption.md"
mkdir -p "$(dirname "$EVIDENCE_FILE")"

# `InviteAuthoredForWebRedemptionTests.handoffFileURL`'s own default (a
# `#filePath`-derived, host-visible repo-root dotfile) -- deliberately NOT
# passed via `PV_GAP2_HANDOFF_FILE`/env var: that env var's passthrough into
# the `xcodebuild test-without-building` simulator process was NOT observed
# live to work reliably for this target (the test itself silently fell back
# to its own default rather than failing), so this script reads from the
# SAME default the Swift side falls back to instead of relying on the env
# var round-tripping correctly.
HANDOFF_FILE="${REPO_ROOT}/.gap2-invite-handoff.json"
rm -f "$HANDOFF_FILE"

cleanup() { rm -f "$HANDOFF_FILE"; }
trap cleanup EXIT

echo "gap2: authoring a real invite on iOS (InviteService, live pv-server at ${BASE_URL})..." >&2
cd ios/PasskeyVault
PV_TEST_SERVER="$BASE_URL" \
  xcodebuild test-without-building \
    -project PasskeyVault.xcodeproj -scheme PasskeyVault \
    -destination "platform=iOS Simulator,id=${SIM_UDID}" \
    "-only-testing:PasskeyVaultTests/InviteAuthoredForWebRedemptionTests/authorInviteForHostSideWebRedemption()" \
    2>&1 | tail -20
cd "$REPO_ROOT"

if [ ! -f "$HANDOFF_FILE" ]; then
  echo "ERROR: iOS invite-authoring step did not produce a handoff file at ${HANDOFF_FILE}." >&2
  exit 1
fi

BASE_URL_ACTUAL=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).baseURL)" "$HANDOFF_FILE")
INVITE_URL=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).inviteURL)" "$HANDOFF_FILE")
EMAIL_A=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).emailA)" "$HANDOFF_FILE")
TOKEN_A=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).tokenA)" "$HANDOFF_FILE")
FAMILY_NAME=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).familyName)" "$HANDOFF_FILE")

echo "gap2: invite authored: $INVITE_URL" >&2

RUN_SUFFIX="$(date +%s)-$(node -e 'console.log(require("crypto").randomUUID().slice(0,8))')"
EMAIL_B="pv-gap2-b-web-${RUN_SUFFIX}@example.invalid"
PASSWORD_B="PvGap2WebRedeem-EvidencePassword!"

echo "gap2: redeeming through REAL pv-wasm (scripts/invite-live-e2e.mjs) as ${EMAIL_B}..." >&2
REDEEM_JSON=$(node scripts/invite-live-e2e.mjs redeem "$BASE_URL_ACTUAL" "$INVITE_URL" "$EMAIL_B" "$PASSWORD_B")
echo "gap2: redeem result: $REDEEM_JSON" >&2

REDEEM_OK=$(node -e "console.log(JSON.parse(process.argv[1]).ok)" "$REDEEM_JSON")
if [ "$REDEEM_OK" != "true" ]; then
  echo "ERROR: pv-wasm redemption failed: $REDEEM_JSON" >&2
  exit 1
fi

echo "gap2: receiver-side roster check (raw HTTP, account A's own token)..." >&2
MEMBERS_JSON=$(node scripts/invite-live-e2e.mjs members "$BASE_URL_ACTUAL" "$TOKEN_A")
echo "gap2: members result: $MEMBERS_JSON" >&2

MEMBER_PRESENT=$(node -e "
const parsed = JSON.parse(process.argv[1]);
const emailB = process.argv[2];
const found = (parsed.body || []).find((m) => m.email === emailB);
console.log(found ? JSON.stringify(found) : 'MISSING');
" "$MEMBERS_JSON" "$EMAIL_B")

if [ "$MEMBER_PRESENT" = "MISSING" ]; then
  echo "ERROR: ${EMAIL_B} never appeared in the roster after pv-wasm redemption: $MEMBERS_JSON" >&2
  exit 1
fi

echo "gap2: SUCCESS -- ${EMAIL_B} present in roster via real pv-wasm redemption: $MEMBER_PRESENT" >&2

cat > "$EVIDENCE_FILE" <<EOF
# 40-06-EF2 web redemption -- GAP2 closure (40-VERIFICATION.md)

**Recorded:** $(date -u +"%Y-%m-%d %H:%M:%S UTC")
**Server origin:** ${BASE_URL_ACTUAL}
**Orchestrator:** \`scripts/gap2-web-redemption-e2e.sh\` (this run), wiring
\`scripts/invite-live-e2e.mjs\` (previously committed with zero callers,
verifier-confirmed by grep) to a real invite authored by iOS.

This discharges WR-08 (carried unresolved through two 40-REVIEW.md
iterations): a redemption performed by the REAL web-client crypto
(\`web/src/lib/crypto/wasm/pv_wasm.js\` + \`web/public/wasm/pv_wasm_bg.wasm\`,
the SAME artifact \`web/\` itself imports -- never a hand-written JS
reimplementation), against an invite the REAL iOS app generated.

## Step 1: iOS authors the invite (real \`InviteService\`, real \`pv-ffi\`)

- Test: \`InviteAuthoredForWebRedemptionTests.authorInviteForHostSideWebRedemption()\`
- Owner account A: \`${EMAIL_A}\`
- Family: \`${FAMILY_NAME}\`
- Invite URL: \`${INVITE_URL}\`

## Step 2: pv-wasm redeems (real web-client crypto, HOST-side node)

\`\`\`
node scripts/invite-live-e2e.mjs redeem ${BASE_URL_ACTUAL} <inviteURL> ${EMAIL_B} <password>
${REDEEM_JSON}
\`\`\`

## Step 3: receiver-side roster proof (raw HTTP, account A's own token -- the SAME curl-equivalent discipline \`InviteTests.fetchMembersRaw\` uses)

\`\`\`
node scripts/invite-live-e2e.mjs members ${BASE_URL_ACTUAL} <tokenA>
${MEMBERS_JSON}
\`\`\`

New member found in roster: \`${MEMBER_PRESENT}\`

## What this proves, stated precisely

PROVES: an invite generated by the real iOS app (\`InviteService\`, real
\`pv-ffi\`) is redeemed successfully by the real web-client crypto (real
\`pv-wasm\`, the artifact \`web/\` imports) against the SAME live server, and
the new member is visible in the roster via a raw, receiver-side HTTP call
authenticated as the ORIGINAL iOS account. Two real clients, one continuous
run.

DOES NOT PROVE: the browser UI itself renders the redemption without an
integrity warning (same disclosed scope limit as E-W1/\`verify-ios-web-item-interop.mjs\`)
-- that needs a running Next.js dev server and a browser, neither available
in this worktree.
EOF

echo "gap2: evidence written to ${EVIDENCE_FILE}" >&2
