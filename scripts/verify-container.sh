#!/usr/bin/env bash
# scripts/verify-container.sh
#
# Scripted end-to-end pass/fail gate for Phase 7's packaged image + both
# reverse-proxy reference configs (ROADMAP.md Phase 7 success criterion #3).
# NOT a demonstration — every assertion below is a real check that exits
# non-zero, naming the specific failed assertion, if it doesn't hold.
#
# What this proves:
#   - The image (Dockerfile, Plan 07-02) builds and runs.
#   - deploy/nginx.conf.example AND deploy/Caddyfile.example (Plan 07-03,
#     Tasks 1-2, byte-for-byte UNTOUCHED by this script) both correctly
#     forward the /api/sync/ws WebSocket upgrade handshake through a real,
#     dockerized nginx and a real, dockerized Caddy.
#   - Neither proxy's own access log contains the literal string `token=`
#     after a real WS request — WR-02's proxy-side closure, verified rather
#     than asserted in prose.
#
# What this does NOT prove (see docs/SELF-HOSTING.md's manual Playwright-UAT
# section instead): a full browser-driven WebAuthn passkey
# registration/PRF-unlock ceremony. That needs a real browser + authenticator
# and cannot be scripted with curl/websocat alone.
#
# Usage: bash scripts/verify-container.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.proxy-test.yml"
SCRATCH=""
FAILED_ASSERTION=""

# ---------------------------------------------------------------------------
# Cleanup: containers AND generated scratch TLS material torn down on both
# success and failure exit paths.
# ---------------------------------------------------------------------------
cleanup() {
    local exit_code=$?
    echo "--- cleanup ---"
    $COMPOSE down --remove-orphans >/dev/null 2>&1 || true
    if [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ]; then
        rm -rf "$SCRATCH"
        echo "removed scratch dir: $SCRATCH"
    fi
    if [ "$exit_code" -ne 0 ]; then
        echo "FAIL: verify-container.sh exited non-zero${FAILED_ASSERTION:+ ($FAILED_ASSERTION)}"
    fi
    exit "$exit_code"
}
trap cleanup EXIT

pass() { echo "PASS: $1"; }
fail() { FAILED_ASSERTION="$1"; echo "FAIL: $1" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 1. Scratch directory: throwaway self-signed cert for nginx-test + a
#    tls-internal-forced derivative Caddyfile for caddy-test. Neither shipped
#    example file is mutated — both are test-only, generated, disposable
#    material bridging "real TLS reference config" to "bootable in a
#    sandboxed test run with no public DNS/port 80/443 reachability."
# ---------------------------------------------------------------------------
# Create the scratch dir INSIDE the repo root (we cd'd here above), not in
# $TMPDIR/var-folders. The proxy-test containers bind-mount the generated
# certs + Caddyfile from this dir; on macOS Docker hosts (Colima, Docker
# Desktop, Rancher) the system temp dir is NOT shared into the Linux VM, so a
# /var/folders or /tmp scratch fails with "not a directory" on the file
# bind-mount. The project dir is always shared (it's the build context), so a
# repo-local scratch works identically on macOS and Linux. Cleanup rm -rf's it.
SCRATCH="$(mktemp -d ./.verify-scratch.XXXXXX)"
SCRATCH="$(cd "$SCRATCH" && pwd)"   # absolute path for bind-mount sources
echo "scratch dir: $SCRATCH"

echo "generating throwaway self-signed TLS pair for nginx-test..."
openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout "$SCRATCH/privkey.pem" -out "$SCRATCH/fullchain.pem" \
    -days 1 -subj '/CN=vault.example.com' 2>&1 | tail -5

echo "generating tls-internal-forced test derivative of deploy/Caddyfile.example..."
echo "(test-only transformation of the shipped file, not a divergent hand-maintained"
echo " copy — production deployments use deploy/Caddyfile.example verbatim, real ACME)"
# awk (not sed) for BSD/GNU portability: sed's one-line `a\text` append idiom
# is GNU-only and errors on macOS/BSD sed ("extra characters after \"). awk
# appends `    tls internal` immediately after the site-address opening line.
awk '{print} /vault\.example\.com \{/{print "    tls internal"}' deploy/Caddyfile.example > "$SCRATCH/Caddyfile.test"

export PV_TEST_CERTS_DIR="$SCRATCH"
export PV_TEST_CADDYFILE="$SCRATCH/Caddyfile.test"

# ---------------------------------------------------------------------------
# 2. Build the image, bring up the compose overlay, wait for pv-server's own
#    healthcheck via a bounded retry loop (never a blind sleep).
# ---------------------------------------------------------------------------
echo "building image + starting pv-server, nginx-test, caddy-test..."
$COMPOSE up -d --build

echo "waiting for pv-server's own healthz (bounded retry loop)..."
PV_READY=0
for _ in $(seq 1 30); do
    if curl -sf http://127.0.0.1:8620/healthz >/dev/null 2>&1; then
        PV_READY=1
        break
    fi
    sleep 2
done
[ "$PV_READY" -eq 1 ] || fail "pv-server never became healthy (curl http://127.0.0.1:8620/healthz) within 60s"
pass "pv-server healthz reachable directly (pre-proxy)"

# ---------------------------------------------------------------------------
# 3. Acquire a REAL session token BEFORE any WS assertion. ws_handler
#    (crates/pv-server/src/routes/sync.rs) validates ?token= via
#    session::validate_token(&state.db, &auth.token) BEFORE ws.on_upgrade(...)
#    runs. A fresh container's sessions table starts empty — any
#    placeholder/fabricated token gets rejected with 401 unconditionally, so
#    a real token is a hard precondition for the WS assertions below.
# ---------------------------------------------------------------------------
echo "registering + logging in a throwaway account directly against pv-server..."
EMAIL="verify-container-$RANDOM@example.invalid"
SALT_B64=$(openssl rand -base64 16)
AUTH_HASH_B64=$(openssl rand -base64 32)

# Build the JSON body in a variable FIRST, then pass "$VAR" to curl. Do NOT
# inline `-d "$(python3 -c "...")"`: nesting a python -c double-quoted string
# (containing `{...}` dicts) inside curl's own -d "..." makes the shell treat
# the inner quotes as closing the outer, un-quoting the braces so bash brace-
# expands each dict field into a separate broken statement. The variable-
# assignment form ($(...) not inside outer double quotes) quotes correctly.
REGISTER_BODY=$(python3 -c "
import json, sys
print(json.dumps({
    'email': sys.argv[1],
    'kdf': {'m_cost_kib': 65536, 't_cost': 3, 'p_cost': 4},
    'salt': sys.argv[2],
    'auth_hash': sys.argv[3],
    'pw_wrapped_uk': '{}',
}))
" "$EMAIL" "$SALT_B64" "$AUTH_HASH_B64")
REGISTER_STATUS=$(curl -s -o "$SCRATCH/register.json" -w '%{http_code}' \
    -X POST http://127.0.0.1:8620/api/auth/register \
    -H 'Content-Type: application/json' \
    -d "$REGISTER_BODY")
[ "$REGISTER_STATUS" = "201" ] || fail "POST /api/auth/register did not return 201 (got $REGISTER_STATUS, body: $(cat "$SCRATCH/register.json"))"
pass "registered throwaway account ($EMAIL)"

LOGIN_BODY=$(python3 -c "
import json, sys
print(json.dumps({'email': sys.argv[1], 'auth_hash': sys.argv[2]}))
" "$EMAIL" "$AUTH_HASH_B64")
LOGIN_STATUS=$(curl -s -o "$SCRATCH/login.json" -w '%{http_code}' \
    -X POST http://127.0.0.1:8620/api/auth/login \
    -H 'Content-Type: application/json' \
    -d "$LOGIN_BODY")
[ "$LOGIN_STATUS" = "200" ] || fail "POST /api/auth/login did not return 200 (got $LOGIN_STATUS, body: $(cat "$SCRATCH/login.json"))"

SESSION_TOKEN=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['session_token'])" "$SCRATCH/login.json")
[ -n "$SESSION_TOKEN" ] || fail "login response did not contain a session_token"
pass "obtained a real session token from /api/auth/login"

# base64-STANDARD tokens can contain '+', '/', '=' — all reserved/meaningful
# in a URL query string. Percent-encode before interpolating into ?token=.
TOKEN_ENCODED=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$SESSION_TOKEN")

# ---------------------------------------------------------------------------
# 4. For EACH proxy: assert HTTPS healthz, a completed WS upgrade using the
#    real token, and absence of `token=` in that proxy's own access log.
# ---------------------------------------------------------------------------
assert_proxy() {
    local name="$1" port="$2" log_cmd="$3"

    echo "--- asserting $name (port $port) ---"

    local healthz_status
    # Use --resolve (not a bare Host: header) so the TLS SNI is
    # vault.example.com, matching the served cert. Caddy selects its cert by
    # SNI, so a `-H Host:` request to https://127.0.0.1 sends SNI=127.0.0.1,
    # finds no matching cert, and the handshake fails (000). nginx isn't
    # SNI-strict so it tolerated the old form; --resolve is correct for both.
    healthz_status=$(curl -sk -o /dev/null -w '%{http_code}' --resolve "vault.example.com:${port}:127.0.0.1" "https://vault.example.com:${port}/healthz")
    [ "$healthz_status" = "200" ] || fail "$name: HTTPS /healthz did not return 200 (got $healthz_status)"
    pass "$name: HTTPS healthz reachable"

    local ws_status
    ws_status=$(python3 - "$port" "$TOKEN_ENCODED" <<'PYEOF'
import ssl, sys, base64, hashlib, os, socket

port = sys.argv[1]
token = sys.argv[2]

ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

raw = socket.create_connection(("127.0.0.1", int(port)), timeout=10)
sock = ctx.wrap_socket(raw, server_hostname="vault.example.com")

key = base64.b64encode(os.urandom(16)).decode()
req = (
    f"GET /api/sync/ws?token={token} HTTP/1.1\r\n"
    "Host: vault.example.com\r\n"
    "Upgrade: websocket\r\n"
    "Connection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\n"
    "Sec-WebSocket-Version: 13\r\n"
    "\r\n"
)
sock.sendall(req.encode())
resp = sock.recv(4096).decode(errors="replace")
sock.close()

status_line = resp.splitlines()[0] if resp else ""
print(status_line.split(" ", 1)[1].split(" ")[0] if " " in status_line else "000")
PYEOF
)
    [ "$ws_status" = "101" ] || fail "$name: WS upgrade did not return 101 (got $ws_status — a 401 means the session token didn't make it through, not a proxy-config failure)"
    pass "$name: WS upgrade handshake completed (101)"

    local log_output
    log_output=$(eval "$log_cmd" 2>/dev/null || true)
    if echo "$log_output" | grep -q 'token='; then
        fail "$name: access log contains 'token=' — WR-02 redaction did not apply"
    fi
    pass "$name: access log does not contain 'token=' (WR-02 redaction confirmed)"
}

# nginx's access_log path (/var/log/nginx/access.log) is symlinked to
# /dev/stdout in the official nginx image, so `cat`-ing it inside the
# container blocks forever (reading the live stdout stream). Read nginx's
# captured stdout via `compose logs` instead. Caddy's `output file` writes a
# REAL file, so `cat` is correct there.
assert_proxy "nginx-test" 8621 "$COMPOSE logs nginx-test"
assert_proxy "caddy-test" 8622 "$COMPOSE exec -T caddy-test cat /var/log/caddy/access.log"

echo ""
echo "=== ALL ASSERTIONS PASSED ==="
echo "pv-server healthz: PASS"
echo "throwaway account register+login: PASS"
echo "nginx-test: HTTPS healthz + WS upgrade + log redaction: PASS"
echo "caddy-test: HTTPS healthz + WS upgrade + log redaction: PASS"
