#!/usr/bin/env bash
# scripts/ios-live-server.sh -- Phase 39, Plan 39-01, Task 1.
#
# An isolated pv-server harness every live proof in Phase 39 (and later
# phases) reuses. Purpose: a stray server on the default port, backed by
# the developer's real database (data/pv.db), has already been adopted by a
# test run once in this repo (D-23, ios/IOS-SPIKE-LOG.md STATE.md Phase 28
# finding). This script makes that class of mistake structurally harder:
# it refuses to start while anything is listening on the default port, and
# it always runs pv-server against a fresh `mktemp -d` database on a
# throwaway port.
#
# Two modes:
#   scripts/ios-live-server.sh
#       Foreground: starts the server, prints its coordinates, blocks until
#       interrupted (Ctrl-C), then tears everything down.
#   scripts/ios-live-server.sh --exec <command...>
#       Runs <command...> with PV_IOS_BASE and PV_IOS_DB exported, then
#       exits with THAT command's own exit status -- not always zero. A
#       harness that always exits zero regardless of what it wrapped is
#       exactly the failure class this phase is judged on (D-06).
#
# Env vars:
#   PV_IOS_PORT   -- port pv-server binds to (default 8621). Never 8620 --
#                    that is the default port this harness's OWN preflight
#                    refuses to run alongside.
#
# Shell discipline (landmine L-3, ios/IOS-SPIKE-LOG.md §3): this project's
# shell is zsh, where the bash-only post-pipe status array is spelled
# differently and is silently empty here. This script never relies on that
# array; `set -o pipefail` (below, via `set -euo pipefail`) plus direct
# command substitution are the only mechanisms used to detect a failed
# command inside a pipeline.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

STRAY_PORT=8620
PORT="${PV_IOS_PORT:-8621}"
# Plan 39-03: parameterized, default unchanged, so 39-01's own committed
# evidence file is never silently overwritten by a LATER plan's harness run.
# A caller that wants its own evidence header (e.g. 39-03's
# scripts/ios-sync-live-proof.sh) sets PV_IOS_EVIDENCE_FILE to its own path;
# every existing caller that does not set it keeps writing to the same file
# it always has.
EVIDENCE_FILE="${PV_IOS_EVIDENCE_FILE:-ios/evidence/39/01-server-contract.md}"

if [ "$PORT" = "$STRAY_PORT" ]; then
  echo "ERROR: PV_IOS_PORT=${PORT} -- this harness refuses to bind the default port (${STRAY_PORT})." >&2
  echo "That is the port whose stray occupation this harness's own preflight exists to detect (D-23)." >&2
  exit 2
fi

# --- preflight: refuse to proceed while the DEFAULT port is occupied ------
#
# This is a check about the DEVELOPER'S OWN environment, not about the port
# this harness itself will bind (PV_IOS_PORT, checked above) -- a stray
# pv-server already running on 8620 against data/pv.db is the exact prior
# incident D-23 records, and its presence means "this is not the only
# pv-server in play", which invalidates every later live result regardless
# of which port this harness picks for itself.
LSOF_OUTPUT="$(lsof -nP -i ":${STRAY_PORT}" 2>/dev/null || true)"
if [ -n "$LSOF_OUTPUT" ]; then
  echo "REFUSED: something is already listening on the default port :${STRAY_PORT}." >&2
  echo "A stray server on that port, backed by the developer's real database, has already been" >&2
  echo "adopted by a test run once in this repo (D-23). This harness refuses to proceed until" >&2
  echo "whatever is listening there is stopped -- even though it itself binds a different port." >&2
  echo "Offending process(es):" >&2
  echo "$LSOF_OUTPUT" >&2
  exit 2
fi

mkdir -p "$(dirname "$EVIDENCE_FILE")"

# --- locate a built pv-server binary ---------------------------------------
SERVER_BIN="${REPO_ROOT}/target/release/pv-server"
if [ ! -x "$SERVER_BIN" ]; then
  SERVER_BIN="${REPO_ROOT}/target/debug/pv-server"
fi
if [ ! -x "$SERVER_BIN" ]; then
  echo "ERROR: no pv-server binary found at target/release/pv-server or target/debug/pv-server." >&2
  echo "Build one first: cargo build -p pv-server --release" >&2
  exit 1
fi

# --- throwaway database, never data/pv.db, never the developer's own -------
DB_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pv-ios-live.XXXXXX")"
DB_PATH="${DB_DIR}/pv.db"
DB_URL="sqlite://${DB_PATH}?mode=rwc"
SERVER_LOG="${DB_DIR}/pv-server.log"
BASE_URL="http://127.0.0.1:${PORT}"

# --- lifecycle: start, poll healthz, tear down on ANY exit path ------------
SERVER_PID=""
cleanup() {
  local exit_code=$?
  if [ -n "$SERVER_PID" ]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$DB_DIR"
  exit "$exit_code"
}
trap cleanup EXIT

PV_ADDR="127.0.0.1:${PORT}" PV_DB_URL="$DB_URL" RUST_LOG=warn "$SERVER_BIN" \
  >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

HEALTHY=0
for _ in $(seq 1 50); do
  if curl -fsS "${BASE_URL}/healthz" >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 0.3
done
if [ "$HEALTHY" -ne 1 ]; then
  echo "ERROR: pv-server did not become healthy on ${BASE_URL} within 15s." >&2
  echo "--- server log ---" >&2
  cat "$SERVER_LOG" >&2 || true
  exit 1
fi

# --- evidence header: overwritten fresh on every invocation; later scripts
# (e.g. scripts/sync-contract-probe.sh, run through --exec) append their own
# sections to this same file rather than creating a second one. -----------
SERVER_SHA="$(git rev-parse HEAD)"
SERVER_DIRTY="$(git status --porcelain -- crates/pv-server 2>/dev/null || true)"

{
  echo "# Phase 39, Plan 39-01 -- server contract evidence"
  echo
  echo "## Server identity"
  echo
  echo "- Port: ${PORT}"
  echo "- Database (mktemp -d, throwaway): ${DB_PATH}"
  if [ -n "$SERVER_DIRTY" ]; then
    echo "- pv-server git SHA: **UNRELIABLE** -- crates/pv-server has an uncommitted diff at harness start, so repo HEAD does not fully identify the running binary:"
    echo '```'
    echo "$SERVER_DIRTY"
    echo '```'
  else
    echo "- pv-server git SHA (repo HEAD at harness start; crates/pv-server working tree is clean, confirmed by \`git status --porcelain -- crates/pv-server\` below): ${SERVER_SHA}"
  fi
  echo "- Binary run: ${SERVER_BIN}"
  echo
  echo "## lsof preflight (default port :${STRAY_PORT})"
  echo
  echo '```'
  echo "\$ lsof -nP -i :${STRAY_PORT}"
  if [ -n "$LSOF_OUTPUT" ]; then
    echo "$LSOF_OUTPUT"
  else
    echo "(no output -- nothing was listening; harness proceeded to bind :${PORT} instead)"
  fi
  echo '```'
  echo
  echo "## crates/pv-server working-tree state at harness start"
  echo
  echo '```'
  echo "\$ git status --porcelain -- crates/pv-server"
  if [ -n "$SERVER_DIRTY" ]; then
    echo "$SERVER_DIRTY"
  else
    echo "(empty -- no local changes)"
  fi
  echo '```'
  echo
} >"$EVIDENCE_FILE"

echo "PV_IOS_PORT=${PORT}"
echo "PV_IOS_DB=${DB_PATH}"
echo "PV_IOS_BASE=${BASE_URL}"

export PV_IOS_BASE="$BASE_URL"
export PV_IOS_DB="$DB_PATH"

if [ "${1:-}" = "--exec" ]; then
  shift
  if [ "$#" -eq 0 ]; then
    echo "ERROR: --exec requires a command, e.g. --exec scripts/sync-contract-probe.sh" >&2
    exit 2
  fi
  # Run the wrapped command's argv directly ("$@"), never through eval or a
  # re-parsed string -- the caller's own quoting (e.g. sh -c '...') already
  # protects any $VAR references inside it from expanding against THIS
  # shell; re-parsing would risk collapsing them to empty before the
  # wrapped command ever sees them.
  set +e
  "$@"
  RC=$?
  set -e
  exit "$RC"
fi

if [ -n "${1:-}" ]; then
  echo "ERROR: unrecognized argument '$1' -- usage: $0 [--exec <command...>]" >&2
  exit 2
fi

echo "ios-live-server: foreground mode -- pv-server on ${BASE_URL}, db=${DB_PATH}. Ctrl-C to stop."
wait "$SERVER_PID"
