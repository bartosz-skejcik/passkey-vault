#!/usr/bin/env bash
# scripts/audit-mainworld-boundary.sh — automated PROV-05 grep-audit gate
# (Phase 12, Plan 12-03, Task 3; strengthened Plan 12-05, Task 6, IN-02).
# Asserts the two dependency-free MAIN-world files
# (extension/entrypoints/page-bridge.content.ts, the Chrome declarative
# world:'MAIN' variant, and extension/entrypoints/page-bridge-firefox.ts,
# the Firefox unlisted-script variant injected via injectScript() -- named
# "-firefox" rather than the plan's literal `page-bridge.ts` to avoid a WXT
# entrypoint-name collision with page-bridge.content.ts, see that file's own
# header comment) never reference pv-wasm, the passkey-rs crate family, or
# this project's own crypto/vault modules -- the D-02/PROV-05 zero-knowledge
# boundary this phase's entire threat model rests on (12-CONTEXT.md,
# 12-RESEARCH.md Pitfall 5).
#
# IN-02 fix (12-REVIEW.md): the original version of this script only grepped
# the two SOURCE files' top-level literal strings -- it does not follow
# imports transitively and does not inspect what actually SHIPS. A future
# edit that imports a *different* lib/messaging/* module with runtime deps
# (lib/messaging is not in the forbidden set) would pass the source-only
# check while still pulling forbidden code into the MAIN world. This
# version ADDITIONALLY greps the emitted MAIN-world bundle(s) under
# extension/.output/**/ (built by `npx wxt build -b chrome`/`-b firefox`)
# for the forbidden symbols, so the guarantee tracks what actually ships,
# not just the two source files' top lines. If no build output exists yet
# (a fresh checkout that has never run `wxt build`), the bundle check is
# skipped with a warning -- this script does NOT invoke a build itself (that
# would add a slow, fragile dependency no other check in this repo has);
# run `npx wxt build -b chrome && npx wxt build -b firefox` first (or via
# `npm --prefix extension run build`) to exercise the bundle-level check.
# The exit-0/exit-1 contract is preserved either way -- this script still
# exits 0 on a clean tree with no prior build.
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

echo "PASS: MAIN-world source files are dependency-free (PROV-05)"

# --- IN-02: bundle-level check --------------------------------------------
# A bundler could inline a forbidden module's CODE (not its literal import
# path string) into the emitted chunk without the source file's own text
# ever containing "pv-wasm"/"lib/crypto"/etc. -- this grep therefore uses a
# NARROWER, symbol-shaped pattern (real identifiers/paths this project's own
# forbidden modules would leave behind if inlined or referenced by a runtime
# import()/require() call) rather than the source-level FORBIDDEN regex
# above, which would false-positive on minified bundlers' own unrelated
# text. Both page-bridge.content.ts's declarative world:'MAIN' Chrome
# content-script AND page-bridge-firefox.ts's unlisted-script asset (built
# for every target, injected only on Firefox at runtime) are checked,
# across every build output directory found.
BUNDLE_FORBIDDEN='pv-wasm|passkey_authenticator|passkey_client|passkey_types|lib/crypto/|lib/vault/'
BUNDLE_GLOBS=(
  "extension/.output/*/content-scripts/page-bridge.js"
  "extension/.output/*/page-bridge-firefox.js"
)

BUNDLE_FILES=()
for glob in "${BUNDLE_GLOBS[@]}"; do
  for f in $glob; do
    [ -f "$f" ] && BUNDLE_FILES+=("$f")
  done
done

if [ "${#BUNDLE_FILES[@]}" -eq 0 ]; then
  echo "WARN: no built MAIN-world bundle found under extension/.output/** -- skipping bundle-level check (source-only PASS above still holds)."
  echo "      Run 'npx wxt build -b chrome && npx wxt build -b firefox' (from extension/) to exercise this check."
  exit 0
fi

BUNDLE_MATCHES=$(grep -lE "$BUNDLE_FORBIDDEN" "${BUNDLE_FILES[@]}" 2>/dev/null || true)
if [ -n "$BUNDLE_MATCHES" ]; then
  echo "FAIL: forbidden symbol found in a BUILT MAIN-world bundle:"
  echo "$BUNDLE_MATCHES"
  exit 1
fi

echo "PASS: built MAIN-world bundle(s) are dependency-free (PROV-05, IN-02) -- checked: ${BUNDLE_FILES[*]}"
