#!/usr/bin/env bash
# scripts/verify-ios-server-contract.sh -- Phase 37, Plan 37-03, Task 2.
#
# Verifies the documented pv-server auth contract by exercising a LIVE,
# isolated server -- seven happy-path contract rows plus five negative
# controls, all with dummy 32-byte/16-byte values (the server never checks
# that auth_hash relates to a real password, so this is fully exercisable
# without any crypto at all, keeping every assertion independently
# falsifiable -- see 37-RESEARCH.md §E-SRV-1/E-SRV-2).
#
# Shell discipline (landmine L-3, ios/IOS-SPIKE-LOG.md §3): this project's
# shell is zsh, where the bash-only post-pipe status array is spelled
# differently and the bash spelling is silently empty here. This script
# never spells that array (its exact bash name is deliberately absent from
# this file, including in comments -- the acceptance gate greps for the
# literal token) -- curl's status is captured via `-w '%{http_code}'` into a
# variable, never grepped out of a piped stream.
#
# Output contract, because the automated gate counts it: exactly one whole
# line per verified row, starting at column 1 -- `PASS <row-name>` on
# success, `FAIL <row-name> expected=<x> got=<y>` on mismatch. Seven
# contract rows plus five negative controls means exactly 12 `PASS ` lines
# on a clean run.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SERVER_ADDR="127.0.0.1:8621"
SERVER_BASE="http://${SERVER_ADDR}"
STRAY_PORT="8620"

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  local name="$1"
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "PASS ${name}"
}

fail_row() {
  local name="$1" expected="$2" got="$3"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "FAIL ${name} expected=${expected} got=${got}"
}

# --- E-SRV-0 preflight ------------------------------------------------

if lsof -nP -i ":${STRAY_PORT}" >/dev/null 2>&1; then
  echo "REFUSED: something is already listening on :${STRAY_PORT} -- refusing to proceed. This script's own server binds only :8621; a stray process on :${STRAY_PORT} means this is not the only pv-server in play, and results could be misattributed." >&2
  lsof -nP -i ":${STRAY_PORT}" >&2 || true
  exit 2
fi

if [ -n "${PV_DB_URL:-}" ]; then
  case "$PV_DB_URL" in
    sqlite:///private/tmp/*)
      ;;
    *)
      echo "REFUSED: PV_DB_URL='${PV_DB_URL}' is not under /private/tmp -- refusing to run against it (T-37-17). This script always creates and uses its own throwaway /private/tmp database." >&2
      exit 2
      ;;
  esac
fi

DB_PATH="/private/tmp/pv-37-03-contract-$(date +%s).db"
PV_DB_URL_LOCAL="sqlite://${DB_PATH}?mode=rwc"

# --- server lifecycle ---------------------------------------------------

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

SERVER_BIN="${REPO_ROOT}/target/release/pv-server"
if [ ! -x "$SERVER_BIN" ]; then
  echo "ERROR: ${SERVER_BIN} not built -- run 'cargo build -p pv-server --release' first" >&2
  exit 1
fi

PV_ADDR="$SERVER_ADDR" PV_DB_URL="$PV_DB_URL_LOCAL" RUST_LOG=warn "$SERVER_BIN" \
  > "/tmp/pv37-contract-server-$$.log" 2>&1 &
SERVER_PID=$!

HEALTHY=0
for _ in $(seq 1 50); do
  if curl -sf "${SERVER_BASE}/healthz" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 0.3
done
if [ "$HEALTHY" -ne 1 ]; then
  echo "ERROR: pv-server did not become healthy within 15s" >&2
  cat "/tmp/pv37-contract-server-$$.log" >&2 || true
  exit 1
fi

# --- fixture values -------------------------------------------------------
#
# Dummy 32-byte auth_hash / 16-byte salt, base64-encoded -- the server never
# checks that auth_hash relates to a password (register.rs/login.rs never
# call any KDF), so the entire contract is exercisable crypto-free.
DUMMY_AUTH_HASH_B64=$(printf 'A%.0s' $(seq 1 32) | base64)
DUMMY_SALT_B64=$(printf 'S%.0s' $(seq 1 16) | base64)
KDF_DEFAULT_JSON='{"m_cost_kib":65536,"t_cost":3,"p_cost":4}'
EMAIL="contract-$(date +%s)@example.com"

BODY_FILE=$(mktemp)
BODY_FILE2=$(mktemp)
cleanup_bodies() {
  rm -f "$BODY_FILE" "$BODY_FILE2"
}
trap 'cleanup_bodies; cleanup' EXIT

http_post() {
  local path="$1" data="$2" out="$3"
  curl -s -o "$out" -w '%{http_code}' -X POST "${SERVER_BASE}${path}" \
    -H 'content-type: application/json' -d "$data"
}

http_get() {
  local path="$1" out="$2" auth_header="${3:-}"
  if [ -n "$auth_header" ]; then
    curl -s -o "$out" -w '%{http_code}' "${SERVER_BASE}${path}" -H "Authorization: ${auth_header}"
  else
    curl -s -o "$out" -w '%{http_code}' "${SERVER_BASE}${path}"
  fi
}

json_field() {
  local file="$1" field="$2"
  jq -r "$field" "$file" 2>/dev/null || echo ""
}

# =========================================================================
# 1. prelogin -> 200 with kdf.{m_cost_kib,t_cost,p_cost} and salt
# =========================================================================
CODE=$(http_post "/api/auth/prelogin" "{\"email\":\"${EMAIL}\"}" "$BODY_FILE")
if [ "$CODE" != "200" ]; then
  fail_row "prelogin-200" "200" "$CODE"
else
  M_COST=$(json_field "$BODY_FILE" ".kdf.m_cost_kib")
  T_COST=$(json_field "$BODY_FILE" ".kdf.t_cost")
  P_COST=$(json_field "$BODY_FILE" ".kdf.p_cost")
  SALT=$(json_field "$BODY_FILE" ".salt")
  if [ -n "$M_COST" ] && [ -n "$T_COST" ] && [ -n "$P_COST" ] && [ -n "$SALT" ] && [ "$SALT" != "null" ]; then
    pass "prelogin-200-kdf-and-salt"
  else
    fail_row "prelogin-200-kdf-and-salt" "kdf.{m_cost_kib,t_cost,p_cost}+salt present" "$(cat "$BODY_FILE")"
  fi
fi

# =========================================================================
# 2. register -> 201 with user_id (a 200 here is a CONTRACT VIOLATION)
# =========================================================================
REGISTER_BODY=$(cat <<EOF
{"email":"${EMAIL}","kdf":${KDF_DEFAULT_JSON},"salt":"${DUMMY_SALT_B64}","auth_hash":"${DUMMY_AUTH_HASH_B64}","pw_wrapped_uk":"{\"nonce\":[1,2,3],\"ciphertext\":[4,5,6]}"}
EOF
)
CODE=$(http_post "/api/auth/register" "$REGISTER_BODY" "$BODY_FILE")
if [ "$CODE" != "201" ]; then
  fail_row "register-201" "201" "$CODE (a 200 would be a contract violation, not merely a different success code)"
else
  USER_ID=$(json_field "$BODY_FILE" ".user_id")
  if [ -n "$USER_ID" ] && [ "$USER_ID" != "null" ]; then
    pass "register-201-with-user-id"
  else
    fail_row "register-201-with-user-id" "non-null user_id" "$(cat "$BODY_FILE")"
  fi
fi

# =========================================================================
# 3. same register repeated -> 409 "email already registered"
# =========================================================================
CODE=$(http_post "/api/auth/register" "$REGISTER_BODY" "$BODY_FILE")
if [ "$CODE" != "409" ]; then
  fail_row "register-repeat-409" "409" "$CODE"
else
  ERR_MSG=$(json_field "$BODY_FILE" ".error")
  if [ "$ERR_MSG" = "email already registered" ]; then
    pass "register-repeat-409-email-already-registered"
  else
    fail_row "register-repeat-409-email-already-registered" "email already registered" "$ERR_MSG"
  fi
fi

# =========================================================================
# 4. login -> 200 with session_token and pw_wrapped_uk
# =========================================================================
LOGIN_BODY="{\"email\":\"${EMAIL}\",\"auth_hash\":\"${DUMMY_AUTH_HASH_B64}\"}"
CODE=$(http_post "/api/auth/login" "$LOGIN_BODY" "$BODY_FILE")
if [ "$CODE" != "200" ]; then
  fail_row "login-200" "200" "$CODE"
else
  SESSION_TOKEN=$(json_field "$BODY_FILE" ".session_token")
  PW_WRAPPED_UK=$(json_field "$BODY_FILE" ".pw_wrapped_uk")
  if [ -n "$SESSION_TOKEN" ] && [ "$SESSION_TOKEN" != "null" ] && [ -n "$PW_WRAPPED_UK" ] && [ "$PW_WRAPPED_UK" != "null" ]; then
    pass "login-200-with-session-token-and-pw-wrapped-uk"
  else
    fail_row "login-200-with-session-token-and-pw-wrapped-uk" "session_token+pw_wrapped_uk present" "$(cat "$BODY_FILE")"
  fi
fi

# =========================================================================
# 5. GET /api/auth/me -> 200 with the email echoed lowercased
# =========================================================================
CODE=$(http_get "/api/auth/me" "$BODY_FILE" "Bearer ${SESSION_TOKEN}")
if [ "$CODE" != "200" ]; then
  fail_row "me-200" "200" "$CODE"
else
  ME_EMAIL=$(json_field "$BODY_FILE" ".email")
  EXPECTED_EMAIL_LOWER=$(echo "$EMAIL" | tr '[:upper:]' '[:lower:]')
  if [ "$ME_EMAIL" = "$EXPECTED_EMAIL_LOWER" ]; then
    pass "me-200-email-echoed-lowercased"
  else
    fail_row "me-200-email-echoed-lowercased" "$EXPECTED_EMAIL_LOWER" "$ME_EMAIL"
  fi
fi

# =========================================================================
# 6. logout -> 204 with an EMPTY body
# =========================================================================
CODE=$(curl -s -o "$BODY_FILE" -w '%{http_code}' -X POST "${SERVER_BASE}/api/auth/logout" \
  -H "Authorization: Bearer ${SESSION_TOKEN}")
if [ "$CODE" != "204" ]; then
  fail_row "logout-204" "204" "$CODE"
else
  BODY_SIZE=$(wc -c < "$BODY_FILE" | tr -d ' ')
  if [ "$BODY_SIZE" = "0" ]; then
    pass "logout-204-empty-body"
  else
    fail_row "logout-204-empty-body" "0 bytes" "${BODY_SIZE} bytes"
  fi
fi

# =========================================================================
# 7. GET /api/auth/me with the SAME (now-revoked) token -> 401
# =========================================================================
CODE=$(http_get "/api/auth/me" "$BODY_FILE" "Bearer ${SESSION_TOKEN}")
if [ "$CODE" != "401" ]; then
  fail_row "me-after-logout-401" "401" "$CODE"
else
  pass "me-after-logout-401"
fi

# =========================================================================
# Negative control 1: register with a 31-byte auth_hash -> 400
# =========================================================================
SHORT_AUTH_HASH_B64=$(printf 'A%.0s' $(seq 1 31) | base64)
EMAIL_NC1="contract-nc1-$(date +%s)@example.com"
NC1_BODY=$(cat <<EOF
{"email":"${EMAIL_NC1}","kdf":${KDF_DEFAULT_JSON},"salt":"${DUMMY_SALT_B64}","auth_hash":"${SHORT_AUTH_HASH_B64}","pw_wrapped_uk":"{\"nonce\":[1],\"ciphertext\":[2]}"}
EOF
)
CODE=$(http_post "/api/auth/register" "$NC1_BODY" "$BODY_FILE")
if [ "$CODE" != "400" ]; then
  fail_row "register-31-byte-auth-hash-400" "400" "$CODE"
else
  ERR_MSG=$(json_field "$BODY_FILE" ".error")
  if [ "$ERR_MSG" = "salt too short or auth_hash has wrong length" ]; then
    pass "register-31-byte-auth-hash-400"
  else
    fail_row "register-31-byte-auth-hash-400" "'salt too short or auth_hash has wrong length'" "$ERR_MSG"
  fi
fi

# =========================================================================
# Negative control 2: register with a 15-byte salt -> 400, same message
# =========================================================================
SHORT_SALT_B64=$(printf 'S%.0s' $(seq 1 15) | base64)
EMAIL_NC2="contract-nc2-$(date +%s)@example.com"
NC2_BODY=$(cat <<EOF
{"email":"${EMAIL_NC2}","kdf":${KDF_DEFAULT_JSON},"salt":"${SHORT_SALT_B64}","auth_hash":"${DUMMY_AUTH_HASH_B64}","pw_wrapped_uk":"{\"nonce\":[1],\"ciphertext\":[2]}"}
EOF
)
CODE=$(http_post "/api/auth/register" "$NC2_BODY" "$BODY_FILE")
if [ "$CODE" != "400" ]; then
  fail_row "register-15-byte-salt-400" "400" "$CODE"
else
  ERR_MSG=$(json_field "$BODY_FILE" ".error")
  if [ "$ERR_MSG" = "salt too short or auth_hash has wrong length" ]; then
    pass "register-15-byte-salt-400"
  else
    fail_row "register-15-byte-salt-400" "'salt too short or auth_hash has wrong length'" "$ERR_MSG"
  fi
fi

# =========================================================================
# Negative control 3: login with an unknown email -> 401
# =========================================================================
UNKNOWN_EMAIL="contract-unknown-$(date +%s)@example.com"
UNKNOWN_LOGIN_BODY="{\"email\":\"${UNKNOWN_EMAIL}\",\"auth_hash\":\"${DUMMY_AUTH_HASH_B64}\"}"
CODE=$(http_post "/api/auth/login" "$UNKNOWN_LOGIN_BODY" "$BODY_FILE")
if [ "$CODE" != "401" ]; then
  fail_row "login-unknown-email-401" "401" "$CODE"
else
  pass "login-unknown-email-401"
fi
cp "$BODY_FILE" "${BODY_FILE}.unknown-email"

# =========================================================================
# Negative control 4: login with a known email + wrong hash -> 401, body
# BYTE-IDENTICAL to negative control 3's body (the no-enumeration-oracle
# property is the actual claim -- assert equality, not just "both 401").
# =========================================================================
WRONG_AUTH_HASH_B64=$(printf 'W%.0s' $(seq 1 32) | base64)
WRONG_LOGIN_BODY="{\"email\":\"${EMAIL}\",\"auth_hash\":\"${WRONG_AUTH_HASH_B64}\"}"
CODE=$(http_post "/api/auth/login" "$WRONG_LOGIN_BODY" "$BODY_FILE2")
if [ "$CODE" != "401" ]; then
  fail_row "login-wrong-hash-401-body-identical" "401" "$CODE"
else
  if cmp -s "${BODY_FILE}.unknown-email" "$BODY_FILE2"; then
    pass "login-wrong-hash-401-body-identical"
  else
    fail_row "login-wrong-hash-401-body-identical" "$(cat "${BODY_FILE}.unknown-email")" "$(cat "$BODY_FILE2")"
  fi
fi
rm -f "${BODY_FILE}.unknown-email"

# =========================================================================
# Negative control 5: GET /api/auth/me with the header spelled
# "bearer <token>" (lowercase b) -> 401 -- a fresh login is needed since
# the earlier session_token was revoked by logout above (step 6).
# =========================================================================
CODE=$(http_post "/api/auth/login" "$LOGIN_BODY" "$BODY_FILE")
FRESH_TOKEN=""
if [ "$CODE" = "200" ]; then
  FRESH_TOKEN=$(json_field "$BODY_FILE" ".session_token")
fi
if [ -z "$FRESH_TOKEN" ] || [ "$FRESH_TOKEN" = "null" ]; then
  fail_row "me-lowercase-bearer-401" "a fresh session_token to test against" "login returned: $(cat "$BODY_FILE")"
else
  CODE=$(http_get "/api/auth/me" "$BODY_FILE" "bearer ${FRESH_TOKEN}")
  if [ "$CODE" != "401" ]; then
    fail_row "me-lowercase-bearer-401" "401" "$CODE"
  else
    pass "me-lowercase-bearer-401"
  fi
fi

# =========================================================================
# Summary + exit contract
# =========================================================================
echo
echo "==> ${PASS_COUNT} PASS, ${FAIL_COUNT} FAIL"
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
if [ "$PASS_COUNT" -ne 12 ]; then
  echo "ERROR: expected exactly 12 PASS rows (7 contract + 5 negative controls), got ${PASS_COUNT}" >&2
  exit 1
fi
exit 0
