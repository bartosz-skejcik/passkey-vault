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
# command: with IPHONEOS_DEPLOYMENT_TARGET=18.0 both slices carry
# LC_BUILD_VERSION and differ in its platform field (`platform IOS` vs
# `platform IOSSIMULATOR`). Before that floor was set, the device slice
# carried the legacy LC_VERSION_MIN_IPHONEOS instead -- see WR-02 below.
# vtool cannot read a .a archive directly ("file is not mach-o"), so every
# check below extracts an object with `ar x` first (35-RESEARCH.md, verified
# against real pv-core artifacts).
#
# No bash-only pipe-status arrays anywhere (landmine L-3 -- this project's
# shell is zsh, where that array is spelled differently and the bash-only
# spelling is silently empty here). Every pipe below relies on
# `set -o pipefail`'s propagation of the pipeline's own last non-zero exit
# (`pipe | grep -qE pattern`), or avoids the pipe entirely via
# `find ... -print -quit` instead of `find ... | head -1` (the latter
# SIGPIPEs `find` under `set -euo pipefail` the moment a slice's .a contains
# more than one .o -- the common case, not theoretical).
#
# This script's own FFI-04 gate is REQUIRED to be demonstrably falsifiable
# (QA-02/QA-04) -- run with `--verify-falsifiable` after a normal build to
# prove the gate can fail, not just pass.
#
# --with-panic-probe (36-01, T-36-02): opt-in flag that appends
# `--features ffi06-probe` to both `cargo rustc` invocations AND both
# `cargo run --bin uniffi-bindgen-swift` invocations, so the SYNTHETIC
# panic vector (crates/pv-ffi/src/panic_probe.rs) is compiled in and its
# Swift binding (`ffi06SyntheticPanicProbe`) is generated. Without the
# flag (the default, and what every OTHER invocation of this script uses)
# neither is present. `PasskeyVaultTests`' "Build pv-ffi XCFramework" Run
# Script phase is the ONLY committed caller that passes this flag, so
# `FfiPanicSafetyTests.swift` keeps a probe-carrying artifact.
#
# HONEST LIMITATION, recorded rather than silently accepted: both variants
# write to the SAME single output path (`$BUILD_DIR` below) -- there is no
# per-variant output directory. So the artifact actually sitting on disk
# after this script runs is WHICHEVER variant ran last, not necessarily the
# one the caller currently building wants. Genuine per-target isolation
# (separate XCFramework/bindings output paths per variant, wired into each
# target's own Run Script phase or a build-setting-scoped output) needs a
# real per-target build product, and is left as a named follow-up for the
# phase that links a second non-test pv-ffi consumer with its own build
# ordering requirements. Today's mitigation is call-order discipline:
# scripts/ios-probe-run.sh always invokes this script with NO flag
# immediately before building the app+extension, so the appex never
# accidentally links a probe-carrying artifact left behind by a prior
# `--with-panic-probe` run.
set -euo pipefail

WITH_PANIC_PROBE=0
if [ "${1:-}" = "--with-panic-probe" ]; then
  WITH_PANIC_PROBE=1
  shift
fi
# Every expansion of this array below uses the
# `"${FEATURE_ARGS[@]+"${FEATURE_ARGS[@]}"}"` idiom, not plain
# `"${FEATURE_ARGS[@]}"`: this machine's /bin/bash is 3.2.57 (macOS ships no
# newer system bash), and bash <4.4 treats `"${arr[@]}"` on a zero-element
# array as an unbound-variable error under `set -u`, which the plain form
# hit on the very first plain (non-`--with-panic-probe`) run of this change.
FEATURE_ARGS=()
if [ "$WITH_PANIC_PROBE" -eq 1 ]; then
  FEATURE_ARGS=(--features ffi06-probe)
  echo "==> variant: --with-panic-probe (ffi06-probe compiled IN -- test-only artifact)"
else
  echo "==> variant: plain (no extra features -- the artifact every non-test consumer, including the appex, links)"
fi

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
HEADERS_DIR="$BINDINGS_DIR/Headers"
XCFRAMEWORK="$BUILD_DIR/PvFfi.xcframework"
SIM_LIB="target/aarch64-apple-ios-sim/release/libpv_ffi.a"
DEVICE_LIB="target/aarch64-apple-ios/release/libpv_ffi.a"

# FFI-04 expectations, single-sourced so the gate and its falsification proof
# can never drift apart. ANCHORED: `platform IOS` is a strict prefix of
# `platform IOSSIMULATOR`, so an unanchored device check would be satisfied
# by a simulator-tagged object -- exactly the "cannot distinguish the two
# slices" defect landmine L-2 is about.
#
# The device expectation is `platform IOS` (LC_BUILD_VERSION), NOT
# `LC_VERSION_MIN_IPHONEOS`: with IPHONEOS_DEPLOYMENT_TARGET=18.0 set below
# (WR-02), the linker emits the modern load command. The old expectation was
# only ever satisfiable because the floor was silently 10.0.
DEVICE_EXPECT='^[[:space:]]*platform[[:space:]]+IOS$'
SIM_EXPECT='^[[:space:]]*platform[[:space:]]+IOSSIMULATOR$'

# One scratch root for every `ar x` below, removed by a single EXIT trap.
# Previously each helper ran `mktemp -d` and `rm -rf`'d it on the success
# path only, so the `ar x` failure path leaked a temp dir under `set -e`
# (IN-04). A per-function `trap ... RETURN` is NOT the fix -- bash fires the
# RETURN trap again for the CALLER, which under `set -u` aborted
# --verify-falsifiable with `scratch: unbound variable` after all three
# proofs had already passed.
SCRATCH_ROOT=$(mktemp -d)
trap 'rm -rf "$SCRATCH_ROOT"' EXIT
# `mktemp -d` per call, NOT a shell counter: every caller invokes this inside
# `$( ... )`, and a counter incremented in that subshell does not survive
# back to the parent -- so every call would hand back the SAME directory, the
# second slice's `ar x` would unpack on top of the first's objects (`ar:
# __.SYMDEF: Permission denied`) and the simulator check would then inspect a
# leftover DEVICE object. Caught in exactly that form by the FFI-04 gate
# while writing this change.
new_scratch() {
  mktemp -d "$SCRATCH_ROOT/slice.XXXXXX"
}


# --- vtool gate helper -------------------------------------------------
# Extracts an object from an already-assembled XCFramework slice's .a and
# greps its `vtool -show-build` output for the expected load-command
# substring. `slice_name` is the XCFramework subdirectory name
# (ios-arm64 / ios-arm64-simulator), matching 35-RESEARCH.md's own verified
# recipe shape.
#
# WR-03 (review Fazy 35): the object MUST be one of pv-ffi's own. The
# previous `find -name '*.o' -print -quit` returned whichever object the
# filesystem yielded first -- measured on the committed artifact, the device
# archive holds 668 objects of which only 7 are pv_ffi*.o, and the pick was
# `compiler_builtins-....cgu.206.rcgu.o`. That proved "SOME object in this
# archive is tagged for platform X", not "pv-ffi's own compiled code is in
# the right slice", and which object it picked was non-deterministic across
# rebuilds and filesystems. Selecting pv_ffi*.o also upgrades the gate for
# free: it now fails if a slice ships with none of this crate's code in it.
extract_pv_ffi_object() {
  local scratch="$1" slice_lib="$2"
  # `-print -quit` gets the first match without ever opening a pipe --
  # `find ... | head -1` SIGPIPEs `find` under `set -euo pipefail` the
  # moment a slice's .a contains more than one .o (L-3).
  local obj
  obj=$(find "$scratch" -name 'pv_ffi*.o' -print -quit)
  if [ -z "$obj" ]; then
    echo "ERROR: no pv_ffi*.o extracted from $slice_lib -- the slice does not contain this crate's own code, so nothing about pv-ffi's platform tagging can be concluded from it" >&2
    echo "       (objects present: $(find "$scratch" -name '*.o' | wc -l | tr -d ' '))" >&2
    return 1
  fi
  printf '%s\n' "$obj"
}

extract_and_check() {
  local slice_name="$1" expect="$2"
  local slice_lib="$XCFRAMEWORK/$slice_name/libpv_ffi.a"
  if [ ! -f "$slice_lib" ]; then
    echo "ERROR: $slice_lib not found -- XCFramework assembly did not produce the expected slice" >&2
    exit 1
  fi
  local scratch
  scratch=$(new_scratch)
  ( cd "$scratch" && ar x "$REPO_ROOT/$slice_lib" )
  local obj
  if ! obj=$(extract_pv_ffi_object "$scratch" "$slice_lib"); then
    exit 1
  fi
  # `-E` not `-F`: the device slice's expectation is `platform IOS`, which is
  # a PREFIX of the simulator's `platform IOSSIMULATOR` -- a substring match
  # would let a simulator-tagged object satisfy the device check (WR-02).
  if ! vtool -show-build "$obj" | grep -qE "$expect"; then
    echo "ERROR: vtool gate FAILED for $slice_name -- expected /$expect/ not found in 'vtool -show-build' output" >&2
    vtool -show-build "$obj" >&2 || true
    exit 1
  fi
  echo "==> OK: $slice_name ($(basename "$obj")) matches the expected load command (/$expect/)"
}

# --- --verify-falsifiable mode ------------------------------------------
# Proves the FFI-04 gate above can actually FAIL, not just pass (QA-02/
# QA-04). Assumes a prior plain `scripts/build-ios.sh` invocation already
# produced the XCFramework on disk (this mode does not rebuild).
#
# WR-10: this used to strip only the SIMULATOR slice, so the DEVICE half of
# the gate had never been demonstrated able to fail -- and the device half is
# the one that changes when the deployment target moves (WR-02). Both slices
# are falsified now.
falsify_slice() {
  local slice_name="$1" expect="$2" strip_platform="$3"
  echo
  echo "==> falsifying the $slice_name half of the gate (expect /$expect/, strip '$strip_platform')"
  local slice_lib="$XCFRAMEWORK/$slice_name/libpv_ffi.a"
  if [ ! -f "$slice_lib" ]; then
    echo "ERROR: $slice_lib not found -- run 'scripts/build-ios.sh' (no args) first" >&2
    exit 1
  fi
  local scratch
  scratch=$(new_scratch)
  ( cd "$scratch" && ar x "$REPO_ROOT/$slice_lib" )
  local obj
  if ! obj=$(extract_pv_ffi_object "$scratch" "$slice_lib"); then
    exit 1
  fi

  echo "==> BEFORE strip: vtool -show-build on the real (unmodified) $slice_name object"
  vtool -show-build "$obj"
  if ! vtool -show-build "$obj" | grep -qE "$expect"; then
    echo "ERROR: the real, unstripped object unexpectedly does not match /$expect/ -- nothing to falsify, the gate is untested" >&2
    exit 1
  fi

  # Write-side platform tokens are the lowercase short names ("ios",
  # "iossim"), NOT the "IOS"/"IOSSIMULATOR" strings `-show-build` prints for
  # reading (35-RESEARCH.md's own correction, verified against a real
  # extracted object).
  vtool -remove-build-version "$strip_platform" -output "$scratch/stripped.o" "$obj"

  echo "==> AFTER strip: vtool -show-build on the corrupted object"
  # vtool's own exit status after the load command has been stripped is not
  # the thing under test here -- the assertion below (grep on the captured
  # content) is. Capture defensively so a non-zero vtool exit on an
  # intentionally-corrupted object cannot abort this script under `set -e`.
  local stripped_output
  stripped_output=$(vtool -show-build "$scratch/stripped.o" 2>&1 || true)
  echo "$stripped_output"

  if echo "$stripped_output" | grep -qE "$expect"; then
    echo "ERROR: falsification FAILED -- the stripped object still matches /$expect/; the $slice_name half of the vtool gate cannot fail and is therefore worthless (L-2-shaped defect)" >&2
    exit 1
  fi

  echo "==> PASS: the corrupted $slice_name object no longer matches /$expect/ -- that half of the gate genuinely can fail (QA-02/QA-04)"
}

# WR-03: the gate must also fail when a slice contains none of pv-ffi's own
# code. This cannot be demonstrated by mutating target/**/libpv_ffi.a and
# re-running the whole script -- cargo detects the tampered output and
# rebuilds it (confirmed: the run came back exit 0 with both slices OK) -- so
# it is proven here, against the REAL archive, on a scratch copy with
# pv_ffi*.o removed.
falsify_missing_pv_ffi_objects() {
  local slice_name="$1"
  local slice_lib="$XCFRAMEWORK/$slice_name/libpv_ffi.a"
  echo
  echo "==> falsifying the 'slice must contain pv-ffi's own code' guard on $slice_name"
  local scratch
  scratch=$(new_scratch)
  ( cd "$scratch" && ar x "$REPO_ROOT/$slice_lib" && find . -name 'pv_ffi*.o' -delete )
  echo "    scratch copy retains $(find "$scratch" -name '*.o' | wc -l | tr -d ' ') non-pv_ffi objects (the shape the old '-name *.o -print -quit' happily accepted)"
  if extract_pv_ffi_object "$scratch" "$slice_lib (scratch copy, pv_ffi objects removed)" >/dev/null 2>"$scratch/err"; then
    echo "ERROR: falsification FAILED -- extract_pv_ffi_object returned an object from a slice containing none of pv-ffi's code; the WR-03 guard cannot fail" >&2
    exit 1
  fi
  cat "$scratch/err"
  echo "==> PASS: the gate refuses a slice with no pv-ffi code instead of validating an unrelated object (WR-03)"
}

run_verify_falsifiable() {
  echo "==> --verify-falsifiable: proving BOTH halves of the vtool gate CAN fail"
  falsify_slice "ios-arm64"           "$DEVICE_EXPECT" "ios"
  falsify_slice "ios-arm64-simulator" "$SIM_EXPECT"    "iossim"
  falsify_missing_pv_ffi_objects "ios-arm64-simulator"
  echo
  echo "==> ALL falsification proofs passed"
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
# WR-02 (review Fazy 35): cargo never reads project.pbxproj, so without this
# the Rust slices were built against rustc's ancient apple-ios defaults --
# measured on the committed XCFramework BEFORE this line existed:
#   ios-arm64            : LC_VERSION_MIN_IPHONEOS   version 10.0
#   ios-arm64-simulator  : LC_BUILD_VERSION platform IOSSIMULATOR minos 14.0
# against `IPHONEOS_DEPLOYMENT_TARGET = 18.0` in project.pbxproj (4 places).
# 35-CONTEXT.md:130-132 flagged exactly this ("Raising the Rust-side floor
# needs IPHONEOS_DEPLOYMENT_TARGET set explicitly in the build script's
# environment") and it was never done.
#
# COUPLED CONSEQUENCE, handled deliberately rather than worked around:
# raising the device floor past 12.0 makes the linker emit LC_BUILD_VERSION
# (`platform IOS`) instead of LC_VERSION_MIN_IPHONEOS, so the FFI-04 gate's
# device expectation changes with it -- see the `extract_and_check` calls at
# the bottom of this script. The gate was NOT weakened to accept both
# spellings; it asserts the one that is now true, and both slices are
# re-proven falsifiable by `--verify-falsifiable`.
export IPHONEOS_DEPLOYMENT_TARGET=18.0
echo "==> IPHONEOS_DEPLOYMENT_TARGET=$IPHONEOS_DEPLOYMENT_TARGET (must match project.pbxproj)"

# rustc reads IPHONEOS_DEPLOYMENT_TARGET from the environment at compile
# time, but CARGO DOES NOT TRACK IT in its fingerprint -- so with warm build
# artifacts, setting the line above changes nothing and the slices keep the
# floor they were originally compiled with. Observed exactly that on the
# first run of this change: cargo printed `Finished release profile in
# 0.34s` and the device object still reported LC_VERSION_MIN_IPHONEOS
# version 10.0. The FFI-04 gate caught it (which is the gate doing its job),
# but a build script that needs a manual `cargo clean` to be correct is a
# trap. Note it is not enough to delete just libpv_ffi.a: the archive bundles
# objects from every dependency rlib, and those were compiled with the old
# floor too -- the whole triple has to go.
stamp_and_clean_if_floor_changed() {
  local triple="$1"
  local stamp="target/$triple/.pv-ios-deployment-target"
  if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$IPHONEOS_DEPLOYMENT_TARGET" ]; then
    return 0
  fi
  if [ -d "target/$triple/release" ]; then
    echo "==> deployment floor for $triple is unrecorded or differs from $IPHONEOS_DEPLOYMENT_TARGET -- cleaning (cargo cannot detect this itself)"
    cargo clean --release --target "$triple"
  fi
  mkdir -p "target/$triple"
  printf '%s\n' "$IPHONEOS_DEPLOYMENT_TARGET" > "$stamp"
}
stamp_and_clean_if_floor_changed aarch64-apple-ios-sim
stamp_and_clean_if_floor_changed aarch64-apple-ios

echo "==> Building pv-ffi for aarch64-apple-ios-sim (staticlib, release)"
cargo rustc -p pv-ffi --lib --target aarch64-apple-ios-sim --crate-type staticlib --release "${FEATURE_ARGS[@]+"${FEATURE_ARGS[@]}"}"

echo "==> Building pv-ffi for aarch64-apple-ios (staticlib, release)"
cargo rustc -p pv-ffi --lib --target aarch64-apple-ios --crate-type staticlib --release "${FEATURE_ARGS[@]+"${FEATURE_ARGS[@]}"}"

# 3. Generate Swift bindings via uniffi-bindgen-swift (crates/pv-ffi's own
#    bin target -- uniffi-bindgen-swift is not published standalone on
#    crates.io, see crates/pv-ffi/src/bin/uniffi-bindgen-swift.rs's header).
#    library mode introspects embedded UniFFI metadata directly from the
#    compiled object (goblin-based, cross-platform-safe) -- either slice's
#    .a carries the same metadata, so bindings are generated once and reused
#    for BOTH -headers arguments below (verified 35-RESEARCH.md).
#    Two separate invocations into two separate directories:
#      - $HEADERS_DIR (.h + module.modulemap only) -- fed to `-headers`
#        below, so the XCFramework's per-slice Headers/ carries only the C
#        side, never the .swift source.
#      - $BINDINGS_DIR (.swift only) -- consumed directly by
#        ios/PasskeyVault/PasskeyVault.xcodeproj as an explicit Sources
#        build-phase file reference (35-03), never embedded in the
#        XCFramework itself.
#    --module-name pv_ffiFFI on the headers invocation is REQUIRED, not
#    cosmetic: uniffi-bindgen-swift's generated .swift always does
#    `#if canImport(pv_ffiFFI) import pv_ffiFFI` (the `<crate>FFI` naming
#    convention is hardcoded into the swift-sources codegen, independent of
#    any --module-name flag on THAT invocation), so the modulemap's
#    declared module name must be the exact string `pv_ffiFFI` or the
#    import silently falls through the #if guard and every FFI symbol goes
#    unresolved. The as-committed 35-02 invocation omitted --swift-sources,
#    --headers, and --module-name entirely -- it produced only a
#    `module pv_ffi { ... }` modulemap with no matching .h/.swift files at
#    all, which 35-02's own verification never caught because no Swift code
#    anywhere in the repo yet tried to `import` it (Rule 1/3 fix, 35-03).
#    Deliberately OMITTING --xcframework here: that flag makes
#    uniffi-bindgen-swift emit a `framework module` declaration, which Clang
#    resolves its `header "..."` entry relative to a `<Name>.framework/
#    Headers/` bundle layout -- NOT relative to the directory the
#    module.modulemap file itself lives in. Our Headers/ dir is a plain
#    directory (fed to `-I`/HEADER_SEARCH_PATHS via the assembled
#    XCFramework's own per-slice Headers/, not `-F`/FRAMEWORK_SEARCH_PATHS
#    for an actual .framework bundle), so a `framework module` declaration
#    there fails with "header 'pv_ffiFFI.h' not found" even though the file
#    sits right next to the modulemap -- verified this session by reproducing
#    the exact failure with a standalone `swiftc -I ... -typecheck` outside
#    Xcode entirely. Dropping --xcframework emits a plain `module pv_ffiFFI {
#    header "pv_ffiFFI.h" ... }` instead, which resolves the header relative
#    to the modulemap's own directory and imports cleanly (verified the same
#    way, same standalone repro, now exit 0). This is still assembled into a
#    real .xcframework by `xcodebuild -create-xcframework` below (a library-
#    type xcframework, not a proper Apple `.framework` bundle) -- the
#    `--xcframework` CLI flag on uniffi-bindgen-swift and the unrelated
#    `xcodebuild -create-xcframework` command share a name by coincidence,
#    not by requirement (Rule 1 fix, 35-03).
echo "==> Generating Swift bindings (uniffi-bindgen-swift)"
mkdir -p "$HEADERS_DIR"
cargo run -p pv-ffi --bin uniffi-bindgen-swift "${FEATURE_ARGS[@]+"${FEATURE_ARGS[@]}"}" -- \
  "$DEVICE_LIB" "$HEADERS_DIR" \
  --headers --modulemap --modulemap-filename module.modulemap --module-name pv_ffiFFI
cargo run -p pv-ffi --bin uniffi-bindgen-swift "${FEATURE_ARGS[@]+"${FEATURE_ARGS[@]}"}" -- \
  "$DEVICE_LIB" "$BINDINGS_DIR" \
  --swift-sources

# 4. Assemble the XCFramework (verified this session against real pv-core
#    .a files -- produces PvFfi.xcframework/ios-arm64/ and
#    .../ios-arm64-simulator/, these exact directory names).
echo "==> Assembling PvFfi.xcframework"
rm -rf "$XCFRAMEWORK"
xcodebuild -create-xcframework \
  -library "$DEVICE_LIB" -headers "$HEADERS_DIR" \
  -library "$SIM_LIB" -headers "$HEADERS_DIR" \
  -output "$XCFRAMEWORK"

# 5. The vtool gate (FFI-04) -- MUST extract an object first, vtool cannot
#    read a .a directly.
#    Expectations are ANCHORED regexes, not substrings: `platform IOS` is a
#    prefix of `platform IOSSIMULATOR`, so an unanchored device check would
#    be satisfied by a simulator-tagged object -- a gate that cannot
#    distinguish the two slices is the L-2 defect all over again.
echo "==> Running the vtool slice gate"
extract_and_check "ios-arm64"           "$DEVICE_EXPECT"
extract_and_check "ios-arm64-simulator" "$SIM_EXPECT"

echo "==> Done. XCFramework: $XCFRAMEWORK"
echo "==> Done. Swift bindings: $BINDINGS_DIR"
