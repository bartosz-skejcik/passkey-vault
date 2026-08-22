#!/usr/bin/env bash
#
# audit-evidence-no-plaintext-secrets.sh -- CR-04 (44-REVIEW.md), fix item 5. A decrypted
# plaintext credential was committed to `ios/evidence/44/44-04-sc-save-after.json` by
# `scripts/ios-autofill-e43-sc4-probe.mjs`'s `doFindLogin` -- this script exists so that class of
# defect fails a scan instead of being caught only by manual review.
#
# Scans every JSON file under `ios/evidence/**` for a `"password"` or `"secret"` key carrying a
# non-empty STRING value. Deliberately does NOT flag `passwordSha256`/`passwordLength`/
# `secretB32` (a fixed, synthetic RFC 6238 test vector, not a live credential) -- only the exact
# key names `password` and `secret`, matched with a JSON-aware parser (never a bare grep for the
# substring "password", which would also flag `passwordSha256`/`passwordLength` and turn this
# into a check nobody could keep green).
#
# Intended to run as a pre-commit check (no husky/lefthook/pre-commit-framework is configured in
# this repo yet -- wiring this in is a separate, repo-level decision; until then, run it by hand
# before committing anything under `ios/evidence/`, and CI should invoke it directly).
#
# Usage: scripts/audit-evidence-no-plaintext-secrets.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EVIDENCE_DIR="${ROOT}/ios/evidence"

if [ ! -d "$EVIDENCE_DIR" ]; then
  echo "ERROR: expected evidence directory missing: $EVIDENCE_DIR" >&2
  exit 1
fi

FAIL=0

while IFS= read -r -d '' f; do
  hit="$(python3 -c '
import json, sys
path = sys.argv[1]
try:
    with open(path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
except Exception:
    sys.exit(0)

found = []

def walk(node, key_path):
    if isinstance(node, dict):
        for k, v in node.items():
            if k in ("password", "secret") and isinstance(v, str) and v:
                found.append(f"{key_path}.{k}" if key_path else k)
            walk(v, f"{key_path}.{k}" if key_path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            walk(v, f"{key_path}[{i}]")

walk(data, "")
if found:
    print(",".join(found))
' "$f" || true)"
  if [ -n "$hit" ]; then
    echo "FAIL: $f -- non-empty string value at key(s): $hit" >&2
    FAIL=1
  fi
done < <(find "$EVIDENCE_DIR" -type f -name '*.json' -print0)

if [ "$FAIL" -ne 0 ]; then
  echo "OVERALL: FAIL -- a plaintext password/secret value was found under ios/evidence/ (see above)" >&2
  exit 1
fi
echo "OVERALL: PASS -- no plaintext password/secret string values found under ios/evidence/"
