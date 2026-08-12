#!/usr/bin/env bash
# scripts/check-ios-wire-shape.sh -- Phase 37, Plan 37-02, Task 2. Settles the
# milestone's highest-risk unknown (37-RESEARCH.md Summary §4, GAP 2,
# Assumptions Log row A2): the on-the-wire shape of the `pw_wrapped_uk`
# envelope, observed against a REAL stored row rather than inferred from
# `serde_json` semantics.
#
# DR-37-A (`ios/IOS-SPIKE-LOG.md` §1, committed by Plan 37-01) already decided
# the DESIGN: `pv-ffi`'s `wrap_user_key_json`/`unwrap_user_key_from_json` are
# the only encoder/decoder for the envelope on both clients, so it should be
# `serde_json`'s plain `#[derive(Serialize, Deserialize)]` output for
# `pv_core::keys::WrappedKey` -- a JSON NUMBER ARRAY for each `Vec<u8>` field
# (`{"nonce":[12,34,...],"ciphertext":[...]}`), never a base64 STRING (the
# shape Swift's `Codable` `Data` default would silently produce if the
# envelope were ever encoded on the Swift side instead -- landmine D-21's
# shape, repeating). This script confirms-or-amends that design against
# REALITY, one real row at a time -- it settles the *shape*, not *interop*: a
# symmetric-but-wrong encoding (both clients agreeing on the same wrong shape)
# would still look right here, which is why 37-03 runs the two-direction
# cross-client test.
#
# EXIT CODE CONTRACT -- distinguished by the automated verify block that
# accompanies this script (Task 2's <verify>), never conflate 1 and 2:
#   0 = PASS -- {"nonce":[...],"ciphertext":[...]} number-array shape observed
#       (DR-37-A holds, 37-RESEARCH.md A2's [INFERRED] status is superseded)
#   1 = FAIL -- a CLASSIFIED wrong shape (a base64 string, or an unrecognized
#       shape). A script whose FAIL branch is unreachable is the defect family
#       this whole phase exists to stop repeating (QA-04, landmine L-3's
#       family) -- the accompanying verify block exercises this exit on every
#       run via a fixture DB, never leaves it as a one-off hand transcript.
#   2 = refusal by PATH, before any query. The developer's real `data/pv.db`
#       has already been written to once by an out-of-scope suite in this
#       project's history (PROJECT.md's own "Czeka na ocenę Bartka" note) --
#       this script refuses to touch anything outside /private/tmp, checked
#       BEFORE opening the database, so a refusal can never be confused with
#       "the classifier ran and found nothing".
#
# Shell discipline (scripts/build-ios.sh's own rule, landmine L-3): this
# project's shell is zsh, where the bash-only post-pipe status array is
# spelled differently and the bash-only spelling is silently empty here.
# This script never relies on that array at all -- classification failure is
# caught via `cmd || VAR=fallback` (the exit status of a command substitution
# IS the substituted command's own exit status, no post-pipe status array
# involved) under `set -o pipefail`.
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/check-ios-wire-shape.sh <sqlite-db-path>

Classifies the stored pw_wrapped_uk envelope's JSON shape against a real row.

Exit code contract (fixed as of Plan 37-02, never conflate 1 and 2):
  0 = PASS -- {"nonce":[...],"ciphertext":[...]} number-array shape (serde_json,
      DR-37-A design confirmed; supersedes 37-RESEARCH.md A2's [INFERRED] tag)
  1 = FAIL -- a classified WRONG shape (base64 string, or an unrecognized shape)
  2 = refusal BEFORE any query -- <sqlite-db-path> is not under /private/tmp
      (safety: this script never opens data/pv.db or any other real database)
EOF
}

if [ "$#" -lt 1 ]; then
  usage
  exit 2
fi

DB_PATH="$1"

# Path refusal FIRST, before anything that would open the file -- a fixture
# under /private/tmp reaches the classifier below; anything else (including
# the developer's real data/pv.db) is refused by PATH alone.
case "$DB_PATH" in
  /private/tmp/*)
    ;;
  *)
    echo "REFUSED: '$DB_PATH' is not under /private/tmp -- refusing to open it. This script never queries a real database (data/pv.db or otherwise); only a throwaway /private/tmp fixture is in scope." >&2
    exit 2
    ;;
esac

if [ ! -f "$DB_PATH" ]; then
  echo "ERROR: '$DB_PATH' does not exist (refused by path check, not by this -- the path itself was under /private/tmp, but no file is there)" >&2
  exit 2
fi

RAW=$(sqlite3 "$DB_PATH" "SELECT pw_wrapped_uk FROM users ORDER BY rowid DESC LIMIT 1;" 2>/dev/null || true)
if [ -z "$RAW" ]; then
  echo "FAIL: no users row (or an empty pw_wrapped_uk) found in '$DB_PATH' -- nothing to classify" >&2
  exit 1
fi

# jq -e on the field's PARSED JSON type (`.nonce | type` -> "array" vs
# "string"), never a regex over the raw text -- the check is about the actual
# JSON type, not punctuation that happens to look right. A parse failure
# (RAW is not valid JSON at all) falls through to the catch-all FAIL branch
# below via the `|| NONCE_TYPE=...` fallback -- no post-pipe status array
# involved, `set -e` does not fire because the failure is explicitly handled
# by `||`.
NONCE_TYPE=$(printf '%s' "$RAW" | jq -e -r '.nonce | type' 2>/dev/null) || NONCE_TYPE="__unparseable__"

case "$NONCE_TYPE" in
  array)
    echo "PASS: serde_json number-array shape"
    printf 'pw_wrapped_uk (first 120 chars): %s\n' "$(printf '%s' "$RAW" | cut -c1-120)"
    echo "DR-37-A holds; this observation supersedes 37-RESEARCH.md Assumptions Log row A2's [INFERRED] status with [OBSERVED]."
    exit 0
    ;;
  string)
    echo "FAIL: pw_wrapped_uk's .nonce field is a JSON STRING (base64-shaped), not a number array." >&2
    echo "Swift's Codable Data default has leaked onto the wire despite DR-37-A -- the leak is in" >&2
    echo "AccountService.swift or PvApiClient.swift (wherever pw_wrapped_uk is produced/consumed);" >&2
    echo "pv-ffi's wrap_user_key_json/unwrap_user_key_from_json must be the ONLY encoder/decoder." >&2
    printf 'raw value: %s\n' "$RAW" >&2
    exit 1
    ;;
  *)
    echo "FAIL: pw_wrapped_uk did not classify as either the number-array or the base64-string .nonce" >&2
    echo "shape -- BOTH the inference (37-RESEARCH.md A2) and the implementation may be wrong; the" >&2
    echo "design must be re-derived before any further row is written." >&2
    printf 'raw value: %s\n' "$RAW" >&2
    exit 1
    ;;
esac
