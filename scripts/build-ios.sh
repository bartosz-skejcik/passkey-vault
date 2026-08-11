#!/usr/bin/env bash
# Reproducible iOS build for pv-ffi -- cross-compiles both real iOS triples,
# generates Swift bindings via uniffi-bindgen-swift, assembles the
# XCFramework, and runs+proves the `vtool` slice gate (FFI-04).
#
# Single-sourced version pin: the uniffi version is parsed straight out of
# crates/pv-ffi/Cargo.toml, never hardcoded here -- mirrors
# scripts/build-wasm.sh's wasm-bindgen version-pin discipline (a version
# bump can only happen in one place).
#
# vtool, NEVER the Mach-O universal-binary "info" inspector (landmine L-2,
# ios/IOS-SPIKE-LOG.md §3): that tool reports bare "arm64" for BOTH the
# device and simulator slices of this crate, so a check built on it cannot
# fail. vtool -show-build distinguishes them by their actual Mach-O load
# command (LC_VERSION_MIN_IPHONEOS vs LC_BUILD_VERSION platform
# IOSSIMULATOR) -- but vtool cannot read a .a archive directly ("file is not
# mach-o"), so every check below extracts an object with `ar x` first
# (35-RESEARCH.md, verified this session against real pv-core artifacts).
#
# No bash-only pipe-status arrays anywhere (landmine L-3 -- this project's
# shell is zsh, where that array is spelled differently and the bash-only
# spelling is silently empty here). Every pipe below relies on
# `set -o pipefail`'s propagation of the pipeline's own last non-zero exit
# (`pipe | grep -qF pattern`), or avoids the pipe entirely via
# `find ... -print -quit` instead of `find ... | head -1` (the latter
# SIGPIPEs `find` under `set -euo pipefail` the moment a slice's .a contains
# more than one .o -- the common case, not theoretical).
#
# This script's own FFI-04 gate is REQUIRED to be demonstrably falsifiable
# (QA-02/QA-04) -- run with `--verify-falsifiable` after a normal build to
# prove the gate can fail, not just pass.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

export PATH="$HOME/.cargo/bin:$PATH"

# 1. Parse the pinned uniffi version out of crates/pv-ffi/Cargo.toml.
UNIFFI_VERSION=$(grep -m1 '^uniffi = { version = "=' crates/pv-ffi/Cargo.toml | sed -E 's/.*"=([0-9.]+)".*/\1/')
if [ -z "$UNIFFI_VERSION" ]; then
  echo "ERROR: could not parse uniffi version from crates/pv-ffi/Cargo.toml" >&2
  exit 1
fi
echo "==> uniffi version (single-sourced): $UNIFFI_VERSION"

BUILD_DIR="ios/PasskeyVault/build"
BINDINGS_DIR="$BUILD_DIR/swift-bindings"
XCFRAMEWORK="$BUILD_DIR/PvFfi.xcframework"
SIM_LIB="target/aarch64-apple-ios-sim/release/libpv_ffi.a"
DEVICE_LIB="target/aarch64-apple-ios/release/libpv_ffi.a"

# --- vtool gate helper -------------------------------------------------
# Extracts an object from an already-assembled XCFramework slice's .a and
# greps its `vtool -show-build` output for the expected load-command
# substring. `slice_name` is the XCFramework subdirectory name
# (ios-arm64 / ios-arm64-simulator), matching 35-RESEARCH.md's own verified
# recipe shape.
extract_and_check() {
  local slice_name="$1" expect="$2"
  local slice_lib="$XCFRAMEWORK/$slice_name/libpv_ffi.a"
  if [ ! -f "$slice_lib" ]; then
    echo "ERROR: $slice_lib not found -- XCFramework assembly did not produce the expected slice" >&2
    exit 1
  fi
  local scratch
  scratch=$(mktemp -d)
  ( cd "$scratch" && ar x "$REPO_ROOT/$slice_lib" )
  # `-print -quit` gets the first match without ever opening a pipe --
  # `find ... | head -1` SIGPIPEs `find` under `set -euo pipefail` the
  # moment a slice's .a contains more than one .o (L-3).
  local obj
  obj=$(find "$scratch" -name '*.o' -print -quit)
  if [ -z "$obj" ]; then
    echo "ERROR: no .o file extracted from $slice_lib" >&2
    rm -rf "$scratch"
    exit 1
  fi
  if ! vtool -show-build "$obj" | grep -qF "$expect"; then
    echo "ERROR: vtool gate FAILED for $slice_name -- expected '$expect' not found in 'vtool -show-build' output" >&2
    vtool -show-build "$obj" >&2 || true
    rm -rf "$scratch"
    exit 1
  fi
  echo "==> OK: $slice_name contains the expected load command ('$expect')"
  rm -rf "$scratch"
}

# --- --verify-falsifiable mode ------------------------------------------
# Proves the FFI-04 gate above can actually FAIL, not just pass (QA-02/
# QA-04). Assumes a prior plain `scripts/build-ios.sh` invocation already
# produced the XCFramework on disk (this mode does not rebuild).
run_verify_falsifiable() {
  echo "==> --verify-falsifiable: proving the vtool gate CAN fail"
  local slice_lib="$XCFRAMEWORK/ios-arm64-simulator/libpv_ffi.a"
  if [ ! -f "$slice_lib" ]; then
    echo "ERROR: $slice_lib not found -- run 'scripts/build-ios.sh' (no args) first" >&2
    exit 1
  fi
  local scratch
  scratch=$(mktemp -d)
  ( cd "$scratch" && ar x "$REPO_ROOT/$slice_lib" )
  local obj
  obj=$(find "$scratch" -name '*.o' -print -quit)
  if [ -z "$obj" ]; then
    echo "ERROR: no .o file extracted from $slice_lib" >&2
    rm -rf "$scratch"
    exit 1
  fi

  echo "==> BEFORE strip: vtool -show-build on the real (unmodified) simulator object"
  vtool -show-build "$obj"
  if ! vtool -show-build "$obj" | grep -qF "platform IOSSIMULATOR"; then
    echo "ERROR: the real, unstripped object unexpectedly does not contain 'platform IOSSIMULATOR' -- nothing to falsify, the gate is untested" >&2
    rm -rf "$scratch"
    exit 1
  fi

  # Write-side platform token is the lowercase short name "iossim", NOT the
  # "IOSSIMULATOR" string `-show-build` prints for reading (35-RESEARCH.md's
  # own correction, verified this session against a real extracted object).
  vtool -remove-build-version iossim -output "$scratch/stripped.o" "$obj"

  echo "==> AFTER strip: vtool -show-build on the corrupted object"
  # vtool's own exit status after the load command has been stripped is not
  # the thing under test here -- the assertion below (grep on the captured
  # content) is. Capture defensively so a non-zero vtool exit on an
  # intentionally-corrupted object cannot abort this script under `set -e`.
  local stripped_output
  stripped_output=$(vtool -show-build "$scratch/stripped.o" 2>&1 || true)
  echo "$stripped_output"

  if echo "$stripped_output" | grep -qF "platform IOSSIMULATOR"; then
    echo "ERROR: falsification FAILED -- the stripped object still reports 'platform IOSSIMULATOR'; the vtool gate cannot fail and is therefore worthless (L-2-shaped defect)" >&2
    rm -rf "$scratch"
    exit 1
  fi

  echo "==> PASS: the corrupted object's 'vtool -show-build' output does NOT contain 'platform IOSSIMULATOR' -- the gate genuinely can fail (QA-02/QA-04 falsification proof)"
  rm -rf "$scratch"
}

if [ "${1:-}" = "--verify-falsifiable" ]; then
  run_verify_falsifiable
  exit 0
fi

# 2. Build both real iOS triples as staticlib (crate-type must include
#    "staticlib" for iOS linking -- mozilla/uniffi-rs
#    docs/manual/src/tutorial/Prerequisites.md; verified locally against
#    pv-core in the research session).
# `--lib` disambiguates the target: pv-ffi's package now has two targets
# (the lib target, and the auto-discovered `uniffi-bindgen-swift` bin target
# at src/bin/) -- `--crate-type` cannot apply itself to "the package" when
# more than one target exists, it must be told which one.
echo "==> Building pv-ffi for aarch64-apple-ios-sim (staticlib, release)"
cargo rustc -p pv-ffi --lib --target aarch64-apple-ios-sim --crate-type staticlib --release

echo "==> Building pv-ffi for aarch64-apple-ios (staticlib, release)"
cargo rustc -p pv-ffi --lib --target aarch64-apple-ios --crate-type staticlib --release

# 3. Generate Swift bindings via uniffi-bindgen-swift (crates/pv-ffi's own
#    bin target -- uniffi-bindgen-swift is not published standalone on
#    crates.io, see crates/pv-ffi/src/bin/uniffi-bindgen-swift.rs's header).
#    library mode introspects embedded UniFFI metadata directly from the
#    compiled object (goblin-based, cross-platform-safe) -- either slice's
#    .a carries the same metadata, so bindings are generated once and reused
#    for BOTH -headers arguments below (verified 35-RESEARCH.md).
echo "==> Generating Swift bindings (uniffi-bindgen-swift)"
mkdir -p "$BINDINGS_DIR"
cargo run -p pv-ffi --bin uniffi-bindgen-swift -- \
  "$DEVICE_LIB" "$BINDINGS_DIR" \
  --xcframework --modulemap --modulemap-filename module.modulemap

# 4. Assemble the XCFramework (verified this session against real pv-core
#    .a files -- produces PvFfi.xcframework/ios-arm64/ and
#    .../ios-arm64-simulator/, these exact directory names).
echo "==> Assembling PvFfi.xcframework"
rm -rf "$XCFRAMEWORK"
xcodebuild -create-xcframework \
  -library "$DEVICE_LIB" -headers "$BINDINGS_DIR" \
  -library "$SIM_LIB" -headers "$BINDINGS_DIR" \
  -output "$XCFRAMEWORK"

# 5. The vtool gate (FFI-04) -- MUST extract an object first, vtool cannot
#    read a .a directly.
echo "==> Running the vtool slice gate"
extract_and_check "ios-arm64" "LC_VERSION_MIN_IPHONEOS"
extract_and_check "ios-arm64-simulator" "platform IOSSIMULATOR"

echo "==> Done. XCFramework: $XCFRAMEWORK"
echo "==> Done. Swift bindings: $BINDINGS_DIR"
