#!/usr/bin/env bash
# scripts/audit-ios-cache-ciphertext.sh -- Phase 39, Plan 39-05, Task 1
# (SYNC-03's ciphertext-only gate, `39-RESEARCH.md`
# "## The SYNC-03 gate, constructed so it can actually fail").
#
# SC3 asks for a grep of the persisted cache showing only ciphertext/
# revision fields. A search for ABSENCE is this project's forbidden gate
# shape (QA-03) and is separately vacuous three ways: a wrong path, an empty
# artifact, or a cache that was never written all report the same "found
# nothing" success. This gate is THREE checks, two of them positive:
#
#   Check 0 (existence, first, its own distinct message) -- the branch-H
#   cache artifact must actually exist. A missing artifact is checked
#   BEFORE any content assertion runs, so an absent cache can never be
#   misread as a clean one (Pitfall 11, 39-RESEARCH.md).
#
#   Check 1 (POSITIVE, receiver-side) -- for the item id given on the
#   command line, the cache's persisted `enc_data` string is byte-equal
#   (compared by SHA-256 digest) to what an INDEPENDENT `curl` against the
#   running server's `GET /api/vault/items` returns for that same row. This
#   also proves the cache is not stale/empty garbage: a zero-item cache
#   fails here.
#
#   Check 2 (POSITIVE, closed allowlist) -- every JSON key appearing
#   anywhere in the cache document must be a member of an explicit
#   allowlist, derived from `PvShared/CachedSnapshot.swift`'s own field
#   names (`CachedSnapshot`, `CachedSnapshot.Item`, `CachedSnapshot.Folder`).
#   A key not on the list is a violation, collected and reported by name --
#   this is strictly stronger than searching for known-bad strings: a field
#   added in a later phase fails CLOSED, not silently.
#
#   Check 3 (NEGATIVE, with a live canary) -- the raw cache bytes must not
#   contain the canary literal given on the command line at all. This check
#   alone is the classically vacuous shape (Pitfall 11); it is only trusted
#   here because Checks 0-2 already establish the artifact is real, and
#   because this script's own falsification programme (`ios/evidence/39/
#   05-gates.md`) shows it going red against a genuine injected leak.
#
# --- Inputs ------------------------------------------------------------
#   --item-id <id>      required, non-empty. The server-assigned id of a
#                        real, already-synced item -- read off the create
#                        response or the server's own item list, never
#                        typed from memory (a wrong id makes Check 1
#                        compare a row against itself-that-isn't).
#   --canary <literal>   required, non-empty. The exact plaintext literal
#                        that was encrypted as that item's password. Must
#                        appear in NO tracked source file (this script's own
#                        acceptance criteria greps for that).
#
# Two more required inputs come from the environment, not argv -- they
# describe WHERE the live server and its account session are, which is
# infrastructure the two CLI flags above (about WHICH item/literal) do not
# encode:
#   PV_IOS_BASE   required. The running pv-server's base URL (the same
#                 variable `scripts/ios-live-server.sh` exports).
#   PV_GATE_TOKEN required. A valid Bearer session token for the account
#                 that owns --item-id, used for Check 1's independent curl.
#
# Both `--item-id`/`--canary` and `PV_IOS_BASE`/`PV_GATE_TOKEN` are
# asserted non-empty as this script's first act -- an unset canary would
# turn Check 3's fixed-string search for absence into a search for the
# empty string, the single most vacuous form this gate could take.
#
# --- Branch H cache location (39-02's DR-1, ios/evidence/39/02-branch-gate.md)
# The App Group container (`group.cloud.blonie.PasskeyVault`), read from the
# HOST side via `xcrun simctl get_app_container ... groups` -- the same
# outside-view technique `scripts/ios-sync-live-proof.sh` already
# established, never a second literal for the file name
# (`AppGroupCiphertextCacheStore.fileName`, `PvShared/
# CiphertextCacheStore.swift`).
#
# zsh reminder (L-3, ios/IOS-SPIKE-LOG.md Sec 3): this project's shell is
# zsh, where the bash-only post-pipe exit-code array is silently empty.
# Nothing below reads that array -- every check below is written as an
# assertion over a saved intermediate file/variable, never a pipeline whose
# status is then needed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

HOST_BUNDLE_ID="cloud.blonie.PasskeyVault"
APP_GROUP_ID="group.cloud.blonie.PasskeyVault"
CACHE_FILE_NAME="vault-cache-v1.json"
SIM_UDID_FILE="/private/tmp/pv16.udid"

usage() {
  echo "Usage: $0 --item-id <id> --canary <literal>" >&2
  echo "  (also requires PV_IOS_BASE and PV_GATE_TOKEN in the environment)" >&2
  exit 2
}

ITEM_ID=""
CANARY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --item-id) ITEM_ID="${2:-}"; shift 2 ;;
    --canary) CANARY="${2:-}"; shift 2 ;;
    *) echo "ERROR: unknown argument '$1'" >&2; usage ;;
  esac
done

# --- non-empty guards, first act (D-08's own vacuity warning) --------------
if [ -z "$ITEM_ID" ]; then
  echo "ERROR: --item-id is required and must be non-empty." >&2
  usage
fi
if [ -z "$CANARY" ]; then
  echo "ERROR: --canary is required and must be non-empty -- an unset canary would search for the empty string, which is present everywhere and proves nothing." >&2
  usage
fi
if [ -z "${PV_IOS_BASE:-}" ]; then
  echo "ERROR: PV_IOS_BASE is required (the running pv-server's base URL)." >&2
  exit 2
fi
if [ -z "${PV_GATE_TOKEN:-}" ]; then
  echo "ERROR: PV_GATE_TOKEN is required (a valid Bearer session token for the account that owns --item-id)." >&2
  exit 2
fi

if [ ! -f "$SIM_UDID_FILE" ]; then
  echo "ERROR: no simulator udid recorded at ${SIM_UDID_FILE}." >&2
  exit 1
fi
SIM_UDID="$(cat "$SIM_UDID_FILE")"

SCRATCH_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pv-39-05-gate.XXXXXX")"
cleanup() { rm -rf "$SCRATCH_DIR"; }
trap cleanup EXIT

# =============================================================================
# Check 0 -- existence, separately and FIRST. A search over a missing
# artifact fails for the wrong reason and can be misread as a pass in a
# tolerant chain (Pitfall 11) -- so this is its own check, with its own
# wording, before any content is ever read.
# =============================================================================
HOST_GROUPS_OUT="${SCRATCH_DIR}/appgroup-host.txt"
xcrun simctl get_app_container "$SIM_UDID" "$HOST_BUNDLE_ID" groups >"$HOST_GROUPS_OUT" 2>&1 || true
CONTAINER_PATH="$(awk -F'\t' -v g="$APP_GROUP_ID" '$1==g{print $2}' "$HOST_GROUPS_OUT" | head -1)"
if [ -z "$CONTAINER_PATH" ] || [ ! -d "$CONTAINER_PATH" ]; then
  echo "FAIL (Check 0 -- existence): the App Group container for ${APP_GROUP_ID} could not be resolved on simulator ${SIM_UDID} -- the cache was never written, or the simulator is not the one the host app ran on." >&2
  exit 1
fi
CACHE_FILE="${CONTAINER_PATH}/${CACHE_FILE_NAME}"
if [ ! -f "$CACHE_FILE" ]; then
  echo "FAIL (Check 0 -- existence): no cache artifact at ${CACHE_FILE} -- the cache was never written. This is a DIFFERENT failure from a bad ciphertext match; do not confuse the two." >&2
  exit 1
fi

# =============================================================================
# Check 1 -- POSITIVE, receiver-side byte equality. Also the check that
# stops a zero-item cache from being vacuously "clean" (D-07): item count
# must be at least one.
# =============================================================================
CACHE_ITEM_COUNT="$(jq '.items | length' "$CACHE_FILE")"
if [ "$CACHE_ITEM_COUNT" -lt 1 ]; then
  echo "FAIL (Check 1 -- byte equality): the persisted cache has zero items -- a zero-item cache can never pass this check, by construction (D-07)." >&2
  exit 1
fi

SERVER_ITEMS="${SCRATCH_DIR}/server-items.json"
curl -fsS -H "Authorization: Bearer ${PV_GATE_TOKEN}" "${PV_IOS_BASE}/api/vault/items" -o "$SERVER_ITEMS"

SERVER_ENC_DATA="$(jq -r --arg id "$ITEM_ID" '.[] | select(.id == $id) | .enc_data' "$SERVER_ITEMS")"
if [ -z "$SERVER_ENC_DATA" ]; then
  echo "FAIL (Check 1 -- byte equality): item ${ITEM_ID} was not found in the independently-fetched GET /api/vault/items response." >&2
  exit 1
fi
CACHED_ENC_DATA="$(jq -r --arg id "$ITEM_ID" '.items[] | select(.id == $id) | .encData' "$CACHE_FILE")"
if [ -z "$CACHED_ENC_DATA" ]; then
  echo "FAIL (Check 1 -- byte equality): item ${ITEM_ID} was not found in the persisted cache (${CACHE_FILE})." >&2
  exit 1
fi

SERVER_DIGEST="$(printf '%s' "$SERVER_ENC_DATA" | shasum -a 256 | awk '{print $1}')"
CACHED_DIGEST="$(printf '%s' "$CACHED_ENC_DATA" | shasum -a 256 | awk '{print $1}')"
if [ "$SERVER_DIGEST" != "$CACHED_DIGEST" ]; then
  echo "FAIL (Check 1 -- byte equality): enc_data digest MISMATCH -- server=${SERVER_DIGEST} cache=${CACHED_DIGEST}" >&2
  exit 1
fi

# =============================================================================
# Check 2 -- POSITIVE, closed allowlist. Derived from
# PvShared/CachedSnapshot.swift's own field names -- every JSON key
# appearing ANYWHERE in the cache document must be a member of this list.
# A key not on it is a violation, collected and reported by name.
# =============================================================================
ALLOWLIST="schemaVersion revision syncedAtMs accountId serverBaseURL items folders id encKey encData updatedAt lastUsedAt isShared collectionId lastEditorEmail encName"

# paths(scalars) walks every path to a leaf scalar value; filtering to
# string-typed path segments yields exactly the object KEY names used
# anywhere in the document (array indices are always numbers, never
# strings, so this cannot accidentally pick up a string array element).
ALL_KEYS="$(jq -r '[paths(scalars)[] | select(type == "string")] | unique | .[]' "$CACHE_FILE")"

UNKNOWN_KEYS=""
while IFS= read -r key; do
  [ -z "$key" ] && continue
  if ! printf ' %s ' "$ALLOWLIST" | grep -qF " $key "; then
    UNKNOWN_KEYS="${UNKNOWN_KEYS}${key} "
  fi
done <<<"$ALL_KEYS"

if [ -n "$UNKNOWN_KEYS" ]; then
  echo "FAIL (Check 2 -- closed allowlist): key(s) not on the allowlist found in the cache: ${UNKNOWN_KEYS}" >&2
  exit 1
fi

# =============================================================================
# Check 3 -- NEGATIVE, live canary. A fixed-string search of the RAW cache
# bytes for the canary literal must find ZERO hits.
# =============================================================================
if grep -qF -- "$CANARY" "$CACHE_FILE"; then
  echo "FAIL (Check 3 -- live canary): the canary literal was found in the raw cache bytes at ${CACHE_FILE} -- a decrypted field has leaked into the ciphertext-only cache." >&2
  exit 1
fi

echo "PASS (SYNC-03): the persisted cache at ${CACHE_FILE} holds only allowlisted, ciphertext-shaped fields -- byte-equal to the server's own copy for item ${ITEM_ID}, and the canary literal is absent from its raw bytes."
echo "      cache item count: ${CACHE_ITEM_COUNT}"
echo "      enc_data digest (server == cache): ${SERVER_DIGEST}"
