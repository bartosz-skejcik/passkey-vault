#!/usr/bin/env bash
# Builds the AMO source-submission archive (required because the extension
# ships bundler-minified JS + Rust-compiled WASM). The archive must let a
# reviewer rebuild extension/.output/firefox-mv2 byte-for-byte — see
# docs/store/AMO-REVIEWER-NOTES.md for the exact command sequence.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="${1:-passkey-vault-amo-source.zip}"
COMMIT=$(git rev-parse HEAD)

test -z "$(git status --porcelain -- ':!*.md')" || {
  echo "WARNING: working tree has non-doc changes — archive from a clean tree" >&2
}

echo "$COMMIT" > COMMIT
# git archive gives a deterministic, tracked-files-only tree (no node_modules,
# no .output, no .planning noise) — exactly what the reviewer needs.
git archive --format=zip -o "$OUT" \
  --add-file=COMMIT \
  HEAD \
  Cargo.toml Cargo.lock rust-toolchain.toml \
  crates scripts packages extension web/package.json PRIVACY.md \
  docs/store/AMO-REVIEWER-NOTES.md
rm COMMIT

echo "Wrote $OUT (commit $COMMIT)"
unzip -l "$OUT" | tail -3
