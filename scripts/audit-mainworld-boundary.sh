#!/usr/bin/env bash
# scripts/audit-mainworld-boundary.sh — automated PROV-05 grep-audit gate
# (Phase 12, Plan 12-03, Task 3). Asserts the two dependency-free MAIN-world
# files (extension/entrypoints/page-bridge.content.ts, the Chrome
# declarative world:'MAIN' variant, and
# extension/entrypoints/page-bridge-firefox.ts, the Firefox unlisted-script
# variant injected via injectScript() -- named "-firefox" rather than the
# plan's literal `page-bridge.ts` to avoid a WXT entrypoint-name collision
# with page-bridge.content.ts, see that file's own header comment) never
# reference pv-wasm, the passkey-rs crate family, or this project's own
# crypto/vault modules -- the D-02/PROV-05 zero-knowledge boundary this
# phase's entire threat model rests on (12-CONTEXT.md, 12-RESEARCH.md
# Pitfall 5).
#
# This is the ONE file in Plan 12-03 where the forbidden-import literal
# string list legitimately appears verbatim -- its entire purpose is to
# grep for exactly these strings in the two MAIN-world files (never in
# itself, since this file is not one of the FILES below).
# <!-- planner-discipline-allow: pv-wasm -->
# <!-- planner-discipline-allow: lib/crypto -->
# <!-- planner-discipline-allow: lib/vault -->
# <!-- planner-discipline-allow: passkey-(authenticator|client|types) -->
#
# Run manually: bash scripts/audit-mainworld-boundary.sh
# Run as part of Task 3's verification: bash scripts/audit-mainworld-boundary.sh && npm --prefix extension test -- --run content-relay
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

FORBIDDEN='pv-wasm|passkey-(authenticator|client|types)|lib/crypto|lib/vault'
FILES="extension/entrypoints/page-bridge.content.ts extension/entrypoints/page-bridge-firefox.ts"

for f in $FILES; do
  if [ ! -f "$f" ]; then
    echo "FAIL: expected MAIN-world file missing: $f"
    exit 1
  fi
done

MATCHES=$(grep -lE "$FORBIDDEN" $FILES 2>/dev/null || true)
if [ -n "$MATCHES" ]; then
  echo "FAIL: forbidden import found in MAIN-world file(s):"
  echo "$MATCHES"
  exit 1
fi

echo "PASS: MAIN-world files are dependency-free (PROV-05)"
