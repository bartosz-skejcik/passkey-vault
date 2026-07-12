#!/usr/bin/env bash
# Reproducible WASM build for pv-wasm.
#
# Single-sourced version pin: the wasm-bindgen version is parsed straight
# out of crates/pv-wasm/Cargo.toml, never hardcoded here — a version bump
# can only happen in one place, and a crate/CLI schema mismatch fails
# loudly at build time instead of silently producing a corrupted artifact
# (see 01-CONTEXT.md's exact-match requirement).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# `cargo install` places binaries in ~/.cargo/bin, which isn't guaranteed to
# be on PATH in every shell/CI environment (rustup-managed cargo installs in
# particular). Append it defensively so a freshly-installed wasm-bindgen-cli
# is always resolvable in this script, without requiring the caller's shell
# profile to already export it.
export PATH="$HOME/.cargo/bin:$PATH"

# 1. Parse the pinned wasm-bindgen version out of crates/pv-wasm/Cargo.toml.
WASM_BINDGEN_VERSION=$(grep -m1 '^wasm-bindgen = "=' crates/pv-wasm/Cargo.toml | sed -E 's/.*"=([0-9.]+)".*/\1/')
if [ -z "$WASM_BINDGEN_VERSION" ]; then
  echo "ERROR: could not parse wasm-bindgen version from crates/pv-wasm/Cargo.toml" >&2
  exit 1
fi
echo "==> wasm-bindgen version (single-sourced): $WASM_BINDGEN_VERSION"

# 2. Install a matching wasm-bindgen-cli if not already present (idempotent).
INSTALLED_VERSION=$(wasm-bindgen --version 2>/dev/null | awk '{print $2}' || true)
if [ "$INSTALLED_VERSION" != "$WASM_BINDGEN_VERSION" ]; then
  echo "==> Installing wasm-bindgen-cli $WASM_BINDGEN_VERSION (found: ${INSTALLED_VERSION:-none})"
  cargo install wasm-bindgen-cli --version "$WASM_BINDGEN_VERSION" --locked
else
  echo "==> wasm-bindgen-cli $WASM_BINDGEN_VERSION already installed, skipping install"
fi

# 3. Build pv-wasm for wasm32-unknown-unknown.
echo "==> Building pv-wasm for wasm32-unknown-unknown"
cargo build -p pv-wasm --target wasm32-unknown-unknown --release

# 4. Duplicate-major getrandom audit — the top runtime-panic pitfall per
#    01-CONTEXT.md. More than one distinct `vX.Y` major in the resolved
#    graph means a getrandom pin has drifted and must be fixed before
#    shipping (a duplicate major can silently miss the `js`/`wasm_js`
#    feature on the version pv-core's OsRng actually resolves through).
echo "==> Auditing getrandom for duplicate majors"
# Only the root "getrandom vX.Y.Z" lines (column 0) name getrandom's own
# resolved version(s) — everything else in the tree is other packages'
# dependents at various indentation levels and must not be matched.
GETRANDOM_MAJORS=$(cargo tree -i getrandom --target wasm32-unknown-unknown -p pv-wasm | grep '^getrandom ' | grep -oE 'v[0-9]+\.[0-9]+' | sort -u)
GETRANDOM_MAJOR_COUNT=$(echo "$GETRANDOM_MAJORS" | wc -l | tr -d ' ')
if [ "$GETRANDOM_MAJOR_COUNT" -gt 1 ]; then
  echo "ERROR: duplicate getrandom majors detected in the wasm32 dependency graph:" >&2
  echo "$GETRANDOM_MAJORS" >&2
  echo "Fix the getrandom pin in crates/pv-wasm/Cargo.toml before building." >&2
  exit 1
fi
echo "==> OK: single getrandom major ($GETRANDOM_MAJORS)"

# 5. Prepare output directories.
mkdir -p web/src/lib/crypto/wasm web/public/wasm

# 6. Generate JS/TS glue with wasm-bindgen.
echo "==> Running wasm-bindgen"
wasm-bindgen --target web \
  --out-dir web/src/lib/crypto/wasm \
  target/wasm32-unknown-unknown/release/pv_wasm.wasm

# 7. Move the compiled binary into the static-asset directory (Turbopack-safe
#    split — see 01-RESEARCH.md Pitfall 1: Turbopack can't resolve
#    wasm-bindgen's default `new URL(..., import.meta.url)` asset reference,
#    so the .wasm must be a plain fetch()-able static file, never bundled).
mv web/src/lib/crypto/wasm/pv_wasm_bg.wasm web/public/wasm/pv_wasm_bg.wasm

echo "==> Done. JS/TS glue: web/src/lib/crypto/wasm/pv_wasm.js"
echo "==> Done. WASM binary: web/public/wasm/pv_wasm_bg.wasm"
