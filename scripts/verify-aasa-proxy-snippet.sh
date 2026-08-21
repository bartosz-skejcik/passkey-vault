#!/usr/bin/env bash
# scripts/verify-aasa-proxy-snippet.sh -- Phase 43 (warunkowe-passkeys-tylko-jesli-tanie), Plan
# 43-08, Task 1.
#
# A repo-local, throwaway-container check proving `ios/PasskeyVaultHarness/AASA-DEPLOY.md`'s own
# reference nginx `location =` block returns HTTP 200 AND `Content-Type: application/json` --
# never status alone. This plan's own revision confirmed EMPIRICALLY (a throwaway probe, run and
# cleaned up during planning) that serving this same file through pv-server's own static
# `ServeDir` fallback returns `application/octet-stream` for this extensionless path -- the exact
# "looks right, silently wrong" failure shape Phase 29's `rewrite_nested_static_route` precedent
# already cost this project once. This script exists to keep that specific check alive and
# re-runnable, never re-asserted from memory.
#
# Fully repo-local/CI-safe -- touches NO Bartek infrastructure. Mirrors
# `scripts/verify-container.sh`'s own `trap cleanup EXIT` discipline (containers torn down on both
# success and failure paths), NOT wired into that script's own Phase-7-scoped harness (this is
# harness-only infra for THIS phase's SC2 proof, a different scope -- 43-08-PLAN.md's own
# `<read_first>` note).
#
# Usage: bash scripts/verify-aasa-proxy-snippet.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

CONTAINER_NAME="pv-aasa-snippet-verify-$$"
HOST_PORT=8623
SCRATCH=""

cleanup() {
    local exit_code=$?
    echo "--- cleanup ---"
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
    if [ -n "$SCRATCH" ] && [ -d "$SCRATCH" ]; then
        rm -rf "$SCRATCH"
        echo "removed scratch dir: $SCRATCH"
    fi
    if [ "$exit_code" -ne 0 ]; then
        echo "FAIL: verify-aasa-proxy-snippet.sh exited non-zero"
    fi
    exit "$exit_code"
}
trap cleanup EXIT

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

# Repo-local scratch dir, NOT $TMPDIR -- mirrors scripts/verify-container.sh's own convention
# exactly: colima (this machine's docker context) only mounts $HOME by default, and macOS's own
# $TMPDIR (/var/folders/...) lives outside it, so a container bind-mount sourced from $TMPDIR
# fails with "not a directory" inside the colima VM even though the host path is genuinely a
# directory -- confirmed live, this session, before switching to this repo-local form.
SCRATCH=$(mktemp -d ./.verify-aasa-scratch.XXXXXX)
SCRATCH=$(cd "$SCRATCH" && pwd)

# --- the EXACT snippet AASA-DEPLOY.md Section 2 documents -- byte-for-byte, never re-derived. ---
cat > "$SCRATCH/nginx.conf" << 'EOF'
events {
    worker_connections 16;
}

http {
    server {
        listen 80;

        location = /.well-known/apple-app-site-association {
            default_type application/json;
            return 200 '{"webcredentials":{"apps":["4S7F2M7YLW.cloud.blonie.PasskeyVaultHarness"]}}';
        }
    }
}
EOF

echo "--- booting throwaway nginx:1-alpine ---"
docker run -d --name "$CONTAINER_NAME" \
    -p "${HOST_PORT}:80" \
    -v "$SCRATCH/nginx.conf:/etc/nginx/nginx.conf:ro" \
    nginx:1-alpine >/dev/null

# --- wait for readiness (bounded, never an unbounded loop) -----------------------------------
ready=0
for _ in $(seq 1 30); do
    if curl -sf -o /dev/null "http://127.0.0.1:${HOST_PORT}/.well-known/apple-app-site-association" 2>/dev/null; then
        ready=1
        break
    fi
    sleep 0.5
done
if [ "$ready" -ne 1 ]; then
    docker logs "$CONTAINER_NAME" >&2 || true
    fail "nginx never became ready on 127.0.0.1:${HOST_PORT} within 15s"
fi

RESPONSE_HEADERS=$(mktemp)
RESPONSE_BODY=$(mktemp)
curl -sS -D "$RESPONSE_HEADERS" -o "$RESPONSE_BODY" "http://127.0.0.1:${HOST_PORT}/.well-known/apple-app-site-association"

# --- assertion 1: HTTP status -----------------------------------------------------------------
if ! grep -qE '^HTTP/[0-9.]+ 200' "$RESPONSE_HEADERS"; then
    cat "$RESPONSE_HEADERS" >&2
    rm -f "$RESPONSE_HEADERS" "$RESPONSE_BODY"
    fail "expected HTTP 200, got:"
fi
pass "HTTP status is 200"

# --- assertion 2: Content-Type -- NEVER status alone (this IS the vacuous-gate risk this script
# exists to catch: pv-server's own ServeDir fallback returns 200 for this path too, with the
# WRONG Content-Type -- application/octet-stream, confirmed during planning). ------------------
if ! grep -qiE '^content-type: application/json' "$RESPONSE_HEADERS"; then
    cat "$RESPONSE_HEADERS" >&2
    rm -f "$RESPONSE_HEADERS" "$RESPONSE_BODY"
    fail "expected Content-Type: application/json, got:"
fi
pass "Content-Type is application/json"

# --- assertion 3: body matches the documented JSON exactly -------------------------------------
EXPECTED_BODY='{"webcredentials":{"apps":["4S7F2M7YLW.cloud.blonie.PasskeyVaultHarness"]}}'
ACTUAL_BODY=$(cat "$RESPONSE_BODY")
if [ "$ACTUAL_BODY" != "$EXPECTED_BODY" ]; then
    echo "expected: $EXPECTED_BODY" >&2
    echo "actual:   $ACTUAL_BODY" >&2
    rm -f "$RESPONSE_HEADERS" "$RESPONSE_BODY"
    fail "response body does not match AASA-DEPLOY.md's documented JSON"
fi
pass "body matches AASA-DEPLOY.md's documented JSON exactly"

rm -f "$RESPONSE_HEADERS" "$RESPONSE_BODY"
echo "PASS: verify-aasa-proxy-snippet.sh -- the reference nginx snippet is correct in isolation"
