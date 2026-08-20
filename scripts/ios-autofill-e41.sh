#!/usr/bin/env bash
# scripts/ios-autofill-e41.sh -- Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami),
# this phase's ONE evidence harness. Every plan in this phase adds its own subcommand here; no
# plan creates a second harness (41-01-PLAN.md "Artifacts this phase produces").
#
# Harness contract, binding on EVERY subcommand this script will ever gain, in this plan and every
# later one: `<subcommand> --assert-only <path>` skips boot/build/install/drive entirely and runs
# ONLY that subcommand's assertions against the named capture or evidence file. This is not a
# convenience -- it is what lets every plan in this phase falsify its own harness by pointing the
# assertion half at a deliberately degraded file, proving the subcommand CAN fail rather than only
# ever having been observed to pass. Under --assert-only a missing, unreadable, or EMPTY path exits
# non-zero with the path named -- an absent/empty file is never treated as nothing-to-check.
#
# D-08 (landmine L-3, this project's shell is zsh): PIPESTATUS is empty here; the array is
# $pipestatus and is never relied on. Every check below redirects into a file/variable and is
# inspected via grep/test, never `cmd | tail` followed by a status check.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO_ROOT="$(pwd)"

EVIDENCE_DIR="ios/evidence/41"
BRANCH_STATE_FILE="$EVIDENCE_DIR/branch-state.md"

usage() {
  echo "Usage: $0 {branch-state|e41-1|tracer|e41-5|e41-2-build|e41-2|e41-3|e41-3-policy|e41-6-encoding|e41-6|lock-build|e41-4|e41-7|e41-8|gates} [--assert-only <path>]" >&2
  exit 1
}

# --- shared: a non-empty, readable file, or a named failure ----------------
require_nonempty_file() {
  local path="$1" label="$2"
  if [ ! -f "$path" ]; then
    echo "ERROR: $label -- file does not exist: $path" >&2
    return 1
  fi
  if [ ! -r "$path" ]; then
    echo "ERROR: $label -- file is not readable: $path" >&2
    return 1
  fi
  if [ ! -s "$path" ]; then
    echo "ERROR: $label -- file is EMPTY: $path (an empty file is never treated as nothing-to-check)" >&2
    return 1
  fi
  return 0
}

# =============================================================================
# branch-state -- validates ios/evidence/41/branch-state.md (Task 1, 41-01)
# =============================================================================
#
# Fails, naming the offending row, if:
#   1. the target file is missing/unreadable/empty
#   2. any of the six row headings B1..B6 is absent
#   3. any B<N> row's own section (heading to next "## " heading, or EOF)
#      contains NEITHER a `path:line`-shaped citation NOR the literal token
#      UNRESOLVED -- a row asserted without evidence is exactly the failure
#      class this gate exists to catch, distinct from a merely-deleted
#      heading (T-41-04).
CITATION_RE='[A-Za-z0-9_./-]+\.[A-Za-z0-9]+:[0-9]+'

cmd_branch_state() {
  local target="$BRANCH_STATE_FILE"
  # ASSERT_ONLY is always true for this subcommand today -- branch-state has
  # no boot/build/install/drive half at all, it is a pure static-file
  # validator. The --assert-only flag is still accepted and honoured (same
  # contract every subcommand carries), it simply has no extra work to skip.
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    target="$2"
  fi

  if ! require_nonempty_file "$target" "branch-state"; then
    exit 1
  fi

  local failed=0
  local i heading_re section_start section_end section_text has_citation has_unresolved

  for i in 1 2 3 4 5 6; do
    heading_re="^## B${i} "
    if ! grep -qE "$heading_re" "$target"; then
      echo "FAIL: branch-state row B${i} -- heading not found in $target" >&2
      failed=1
      continue
    fi

    # Isolate this row's section: from its own heading line to the line
    # BEFORE the next "^## " heading (or EOF). awk, not sed range-to-pattern,
    # because sed's own range would need a second, DIFFERENT pattern per row
    # (the next row's exact heading text) -- awk's "next ## line, any text"
    # stop condition is uniform across all six rows.
    section_text=$(awk -v start="$heading_re" '
      BEGIN { armed = 0 }
      $0 ~ start { armed = 1; print; next }
      armed && /^## / { exit }
      armed { print }
    ' "$target")

    if [ -z "$section_text" ]; then
      echo "FAIL: branch-state row B${i} -- heading found but section body is empty in $target" >&2
      failed=1
      continue
    fi

    has_citation=$(printf '%s\n' "$section_text" | grep -cE "$CITATION_RE" || true)
    has_unresolved=$(printf '%s\n' "$section_text" | grep -cw 'UNRESOLVED' || true)

    if [ "$has_citation" -eq 0 ] && [ "$has_unresolved" -eq 0 ]; then
      echo "FAIL: branch-state row B${i} -- section contains neither a file:line citation nor the UNRESOLVED token (a row asserted without evidence, T-41-04)" >&2
      failed=1
      continue
    fi
  done

  if [ "$failed" -ne 0 ]; then
    echo "FAIL: branch-state validation failed against $target" >&2
    exit 1
  fi

  echo "PASS: branch-state -- all six rows (B1..B6) carry either a file:line citation or the UNRESOLVED token, validated against $target"
  exit 0
}

# =============================================================================
# e41-1 -- can the extension read the Phase-37 User-Key artifact without UI?
# (Task 2, 41-01).
# =============================================================================
#
# Full drive: builds pv-ffi, boots exactly one simulator (reuses an
# already-booted device, never `simctl create`, mirroring
# scripts/ios-probe-run.sh's own discipline), builds
# PasskeyVault.app+PasskeyVaultAutoFill.appex with
# PV_PROBE_SESSIONKEY defined, installs, and drives
# AutoFillInvocationUITests' primary route -- which launches the HOST app
# FIRST (seeding the real envelope via SessionKeyProbeSeeder.seed(), same
# ordered sequence PV_PROBE_KEYCHAIN's own ProbeSeeder.seed() already
# established, AutoFillInvocationUITests.swift:63-64), then toggles the
# Settings AutoFill switch, which invokes
# prepareInterfaceForExtensionConfiguration() on the extension --
# dispatching SessionKeyProbe.run() (CredentialProviderViewController.swift).
#
# This subcommand deliberately re-implements the build/boot/install/drive
# steps rather than calling scripts/ios-probe-run.sh directly: that script's
# own step 6 hardcodes both the evidence path (ios/evidence/36/) and the
# marker it asserts on (a bare `PVPROBE|`, never this phase's own
# `PVFILL|E41-1|` contract) -- calling it unmodified would capture to the
# wrong directory and always report FAIL even on a working probe.
# ios-autofill-layers.sh's own cmd_layer_c already established this same
# precedent (a phase's own subcommand re-implements the proven
# build/boot/install shape rather than repurposing a differently-contracted
# sibling script).
DD_PATH="/tmp/pv-dd"
PV_APP_PRODUCT="$DD_PATH/Build/Products/Debug-iphonesimulator/PasskeyVault.app"
PV_APPEX_PRODUCT="$PV_APP_PRODUCT/PlugIns/PasskeyVaultAutoFill.appex"
E41_1_LOG="$EVIDENCE_DIR/e41-1-silent-read.log"

# --- assertions, shared between the full drive and --assert-only ----------
#
# Fails, naming what is missing, on: a missing/unreadable/empty file (via
# require_nonempty_file); any of the three mandatory PVFILL|E41-1| lines
# (silent/nocontext/negative-control) absent; the negative control NOT
# reporting -34018; or (on a PASS-silent verdict) the host-seed digest and
# the extension-read digest missing or unequal. Prints exactly one verdict
# line and exits non-zero on FAIL-unreachable, on a missing line, or when
# the control did not fire -34018.
assert_e41_1() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-1"; then
    return 1
  fi

  local seed_line silent_line nocontext_line control_line
  seed_line=$(grep -E 'PVFILL\|E41-1\|stage=seed ' "$target" | tail -1 || true)
  silent_line=$(grep -E 'PVFILL\|E41-1\|stage=silent ' "$target" | tail -1 || true)
  nocontext_line=$(grep -E 'PVFILL\|E41-1\|stage=nocontext ' "$target" | tail -1 || true)
  control_line=$(grep -E 'PVFILL\|E41-1\|stage=negative-control ' "$target" | tail -1 || true)

  local missing=""
  [ -z "$silent_line" ] && missing="${missing}silent "
  [ -z "$nocontext_line" ] && missing="${missing}nocontext "
  [ -z "$control_line" ] && missing="${missing}negative-control "
  if [ -n "$missing" ]; then
    echo "FAIL: e41-1 -- missing PVFILL|E41-1| line(s) in $target: $missing" >&2
    return 1
  fi

  local silent_status nocontext_status control_status
  silent_status=$(printf '%s\n' "$silent_line" | grep -oE 'status=-?[0-9]+' | head -1 | cut -d= -f2)
  nocontext_status=$(printf '%s\n' "$nocontext_line" | grep -oE 'status=-?[0-9]+' | head -1 | cut -d= -f2)
  control_status=$(printf '%s\n' "$control_line" | grep -oE 'status=-?[0-9]+' | head -1 | cut -d= -f2)

  if [ -z "$silent_status" ] || [ -z "$nocontext_status" ] || [ -z "$control_status" ]; then
    echo "FAIL: e41-1 -- could not parse an integer OSStatus out of one or more PVFILL|E41-1| lines in $target" >&2
    return 1
  fi

  echo "INFO: e41-1 -- silent status=$silent_status nocontext status=$nocontext_status negative-control status=$control_status"

  # The negative control is the ONE enforcement mechanism this harness's own
  # E2 result did not already show unenforced (branch-state.md's closing
  # section). Without it firing, no verdict below means anything (Pitfall 5).
  if [ "$control_status" != "-34018" ]; then
    echo "FAIL: e41-1 -- negative control did not report -34018 (got $control_status) -- the simulator is not enforcing access groups, or the query is wrong; no verdict below is interpretable" >&2
    return 1
  fi

  local verdict=""
  if [ "$silent_status" = "0" ]; then
    verdict="PASS-silent"
  elif [ "$silent_status" = "-25308" ] && [ "$nocontext_status" = "0" ]; then
    verdict="PASS-prompted-only"
  else
    verdict="FAIL-unreachable"
  fi

  if [ "$verdict" = "PASS-silent" ]; then
    if [ -z "$seed_line" ]; then
      echo "FAIL: e41-1 -- PASS-silent verdict but no PVFILL|E41-1|stage=seed line found in $target (host-side digest missing -- a non-nil/length-only read is never accepted as the proof, QA-03)" >&2
      return 1
    fi
    local seed_digest silent_digest
    seed_digest=$(printf '%s\n' "$seed_line" | grep -oE 'digest=[0-9a-f]+' | head -1 | cut -d= -f2)
    silent_digest=$(printf '%s\n' "$silent_line" | grep -oE 'digest=[0-9a-f]+' | head -1 | cut -d= -f2)
    if [ -z "$seed_digest" ] || [ -z "$silent_digest" ]; then
      echo "FAIL: e41-1 -- PASS-silent verdict but could not parse a digest out of the seed and/or silent line in $target" >&2
      return 1
    fi
    if [ "$seed_digest" != "$silent_digest" ]; then
      echo "FAIL: e41-1 -- PASS-silent verdict but host-seed digest ($seed_digest) != extension-read digest ($silent_digest) -- a successful read of the WRONG bytes, worse than a failed read" >&2
      return 1
    fi
    echo "VERDICT: $verdict (byte-for-byte digest match: $silent_digest)"
  else
    echo "VERDICT: $verdict"
  fi

  if [ "$verdict" = "FAIL-unreachable" ]; then
    echo "FAIL: e41-1 -- verdict is FAIL-unreachable -- the access group does not reach the extension (a Phase 37 amendment, not a Phase 41 workaround, per 41-RESEARCH.md's own E41-1 spec)" >&2
    return 1
  fi

  return 0
}

# Appends the verdict, its integers, and the interpretation constraint from
# branch-state.md's own closing section, under a new "## E41-1 result"
# heading. Idempotent: any prior "## E41-1 result" section (heading through
# EOF) is stripped first, so re-running e41-1 amends rather than
# accumulates. Runs regardless of assert_e41_1's own exit code -- a
# FAIL-unreachable verdict is a real, recorded finding (escalate to Phase
# 37), not merely a harness error, and must land in the record either way.
append_branch_state_result() {
  local log_file="$1"
  local silent_line nocontext_line control_line seed_line
  silent_line=$(grep -E 'PVFILL\|E41-1\|stage=silent ' "$log_file" | tail -1 || true)
  nocontext_line=$(grep -E 'PVFILL\|E41-1\|stage=nocontext ' "$log_file" | tail -1 || true)
  control_line=$(grep -E 'PVFILL\|E41-1\|stage=negative-control ' "$log_file" | tail -1 || true)
  seed_line=$(grep -E 'PVFILL\|E41-1\|stage=seed ' "$log_file" | tail -1 || true)

  local silent_status nocontext_status control_status
  silent_status=$(printf '%s\n' "$silent_line" | grep -oE 'status=-?[0-9]+' | head -1 | cut -d= -f2)
  nocontext_status=$(printf '%s\n' "$nocontext_line" | grep -oE 'status=-?[0-9]+' | head -1 | cut -d= -f2)
  control_status=$(printf '%s\n' "$control_line" | grep -oE 'status=-?[0-9]+' | head -1 | cut -d= -f2)

  local verdict="UNDETERMINED"
  if [ -n "$silent_status" ]; then
    if [ "$silent_status" = "0" ]; then
      verdict="PASS-silent"
    elif [ "$silent_status" = "-25308" ] && [ "$nocontext_status" = "0" ]; then
      verdict="PASS-prompted-only"
    else
      verdict="FAIL-unreachable"
    fi
  fi

  local digest_note=""
  if [ "$verdict" = "PASS-silent" ]; then
    local seed_digest silent_digest
    seed_digest=$(printf '%s\n' "$seed_line" | grep -oE 'digest=[0-9a-f]+' | head -1 | cut -d= -f2)
    silent_digest=$(printf '%s\n' "$silent_line" | grep -oE 'digest=[0-9a-f]+' | head -1 | cut -d= -f2)
    if [ -n "$seed_digest" ] && [ "$seed_digest" = "$silent_digest" ]; then
      digest_note="Host-written digest (\`$seed_digest\`) and extension-read digest (\`$silent_digest\`) are byte-for-byte equal -- receiver-side, digest-based, never a non-nil/length-only check (QA-03)."
    else
      digest_note="Digest comparison INCONCLUSIVE (seed=\`${seed_digest:-missing}\` silent=\`${silent_digest:-missing}\`)."
    fi
  fi

  # Idempotent: truncate at any prior "## E41-1 result" heading (removing it
  # and everything after), then append the fresh section. Prints everything
  # unchanged when no such heading exists yet.
  local tmp_file
  tmp_file=$(mktemp)
  awk '/^## E41-1 result/ { exit } { print }' "$BRANCH_STATE_FILE" > "$tmp_file"
  mv "$tmp_file" "$BRANCH_STATE_FILE"

  {
    echo ""
    echo "## E41-1 result"
    echo ""
    echo "**Verdict: $verdict** (silent status=${silent_status:-n/a}, nocontext status=${nocontext_status:-n/a}, negative-control status=${control_status:-n/a})."
    echo ""
    if [ -n "$digest_note" ]; then
      echo "$digest_note"
      echo ""
    fi
    echo "Per this file's own closing section (\"What a PASS in this phase can and cannot mean\"): this verdict is a statement about our code's intent (did it correctly ask the OS before reading?), not about the OS's behaviour on a real device -- Phase 37's own E2 result (\`ios/IOS-SPIKE-LOG.md:1962-1979\`) already established this simulator releases ACL-protected data unconditionally, independent of any \`LAContext\`."
    echo ""
    echo "Raw evidence: \`$log_file\`."
  } >> "$BRANCH_STATE_FILE"
}

cmd_e41_1() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_1 "$2"; then
      exit 0
    else
      exit 1
    fi
  fi

  mkdir -p "$EVIDENCE_DIR"

  echo "==> e41-1: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  # --- exactly one simulator, mirroring scripts/ios-probe-run.sh -----------
  local BOOTED_LIST_FILE UDID
  BOOTED_LIST_FILE=$(mktemp)
  xcrun simctl list devices booted > "$BOOTED_LIST_FILE" 2>&1
  UDID=$(grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' "$BOOTED_LIST_FILE" | head -1 || true)
  rm -f "$BOOTED_LIST_FILE"

  if [ -z "$UDID" ]; then
    local AVAILABLE_LIST_FILE
    AVAILABLE_LIST_FILE=$(mktemp)
    xcrun simctl list devices available > "$AVAILABLE_LIST_FILE" 2>&1
    UDID=$(awk '/-- iOS 26.5 --/{f=1;next} /^--/{f=0} f && /iPhone/{print; exit}' "$AVAILABLE_LIST_FILE" \
      | grep -oE '[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}' || true)
    rm -f "$AVAILABLE_LIST_FILE"
    if [ -z "$UDID" ]; then
      echo "ERROR: no already-booted simulator and no iOS 26.5 iPhone available to boot" >&2
      exit 1
    fi
    echo "==> booting $UDID (the ONE simulator this run needs)"
    xcrun simctl boot "$UDID"
  fi
  echo "==> simulator UDID: $UDID"

  # --- build app + extension, PV_PROBE_SESSIONKEY defined ------------------
  run_build() {
    xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
      -scheme PasskeyVault -configuration Debug \
      -destination "platform=iOS Simulator,id=$UDID" \
      -derivedDataPath "$DD_PATH" \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_SESSIONKEY" \
      build
  }
  local BUILD_LOG
  BUILD_LOG=$(mktemp)
  if ! run_build > "$BUILD_LOG" 2>&1; then
    if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope' "$BUILD_LOG"; then
      echo "==> HIT landmine L-10 (cold DerivedData mismatch) -- retrying once" >&2
      if ! run_build > "$BUILD_LOG" 2>&1; then
        echo "ERROR: app+extension build failed twice (not the known L-10 flake)" >&2
        tail -100 "$BUILD_LOG" >&2
        rm -f "$BUILD_LOG"
        exit 1
      fi
    else
      echo "ERROR: app+extension build failed" >&2
      tail -100 "$BUILD_LOG" >&2
      rm -f "$BUILD_LOG"
      exit 1
    fi
  fi
  rm -f "$BUILD_LOG"

  if [ ! -d "$PV_APP_PRODUCT" ] || [ ! -d "$PV_APPEX_PRODUCT" ]; then
    echo "ERROR: expected build product missing: $PV_APP_PRODUCT / $PV_APPEX_PRODUCT" >&2
    exit 1
  fi

  # --- install ---------------------------------------------------------------
  xcrun simctl install "$UDID" "$PV_APP_PRODUCT"

  # --- drive: AutoFillInvocationUITests primary route -----------------------
  local RUN_START
  RUN_START=$(date '+%Y-%m-%d %H:%M:%S')
  run_test() {
    xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
      -scheme PasskeyVault -configuration Debug \
      -destination "platform=iOS Simulator,id=$UDID" \
      -derivedDataPath "$DD_PATH" \
      -only-testing:PasskeyVaultUITests/AutoFillInvocationUITests/testInvokeExtensionConfigurationViaSettingsAutoFillToggle \
      -skip-testing:PasskeyVaultTests \
      -parallel-testing-enabled NO \
      -maximum-concurrent-test-simulator-destinations 1 \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_SESSIONKEY" \
      test
  }
  local MAX_ATTEMPTS=5 ATTEMPT=1 TEST_LOG
  TEST_LOG=$(mktemp)
  while ! run_test > "$TEST_LOG" 2>&1; do
    if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
      echo "ERROR: AutoFillInvocationUITests failed after $ATTEMPT attempts" >&2
      tail -150 "$TEST_LOG" >&2
      rm -f "$TEST_LOG"
      exit 1
    fi
    if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope|has no member .fromPasswordProbeUnchecked.' "$TEST_LOG"; then
      echo "==> HIT landmine L-10/L-11 -- retrying (attempt $((ATTEMPT + 1))/$MAX_ATTEMPTS)"
    else
      echo "ERROR: AutoFillInvocationUITests failed (not a known flake signature)" >&2
      tail -150 "$TEST_LOG" >&2
      rm -f "$TEST_LOG"
      exit 1
    fi
    ATTEMPT=$((ATTEMPT + 1))
  done
  rm -f "$TEST_LOG"

  # --- capture: subsystem+category scoped, RUN_START-filtered --------------
  xcrun simctl spawn "$UDID" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$RUN_START" \
    > "$E41_1_LOG" 2>&1

  # --- amend branch-state.md with the raw verdict, BEFORE the pass/fail exit
  # below -- a FAIL-unreachable verdict is still a real, recorded finding
  # (escalate to Phase 37, per 41-RESEARCH.md's own E41-1 spec), not merely
  # a harness error, so it must land in the record even on a non-zero exit.
  append_branch_state_result "$E41_1_LOG"

  # --- assert -----------------------------------------------------------
  if assert_e41_1 "$E41_1_LOG"; then
    echo "PASS: e41-1 -- see $E41_1_LOG and the amended ios/evidence/41/branch-state.md \"E41-1 result\" section"
    exit 0
  else
    echo "FAIL: e41-1 -- see $E41_1_LOG and the amended ios/evidence/41/branch-state.md \"E41-1 result\" section" >&2
    exit 1
  fi
}

# =============================================================================
# tracer -- the end-to-end "AutoFill fills one real password" proof (Task 1, 41-03)
# =============================================================================
#
# Full drive: starts a LOCAL static-file server on 127.0.0.1:8765 serving a self-contained login
# form (never a `data:` URL -- `ASCredentialServiceIdentifier(type: .domain)` matching is
# host-based, F3 `41-RESEARCH.md`, and a `data:` page carries no host at all, discovered
# empirically running this exact test live); boots the PINNED simulator
# (`/private/tmp/pv16.udid`, never "any already-booted" -- this phase's own harness contract);
# builds the app+extension with `PV_PROBE_FILLTRACER` (the seeder,
# `ios/PasskeyVault/PasskeyVault/TracerFillSeeder.swift`); ensures the AutoFill provider is
# electable (Phase 36 SC1) and that Face ID enrollment is set (CLI-only, via `notifyutil`, never
# the Simulator.app GUI menu -- observed live to be unreliable in this headless session); drives
# `AutoFillFillUITests` while a PARALLEL, external loop posts
# `com.apple.BiometricKit_Sim.pearl.match` for the run's whole duration (Safari's OWN
# LocalAuthentication confirmation gate before injecting a password into a web page -- discovered
# empirically to be a SEPARATE system-level step, independent of our own provider's silent read,
# `scripts/run-ios-biometry-experiments.sh`'s own `pearl_match` mechanism); then re-runs twice
# more with the two acceptance-criteria falsification legs armed via marker files
# `TracerFillSeeder.swift` checks at seed time (an env var was observed live NOT to reach the
# launched host app's own process at all).
TRACER_WWW_DIR="/tmp/pv-tracer-www"
TRACER_PORT=8765
TRACER_FILL_LOG="$EVIDENCE_DIR/tracer-fill.log"
PINNED_UDID_FILE="/private/tmp/pv16.udid"

# Shared L-10 retry wrapper (mirrors cmd_e41_1's own `run_build` discipline): a cold DerivedData
# mismatches the generated pv-ffi bindings against the linked library on the FIRST build after the
# "Build pv-ffi XCFramework" script phase's own Debug-config default (`--with-panic-probe`)
# regenerates them mid-build. Retried ONCE; a second failure is a real error.
build_with_l10_retry() {
  local udid="$1" extra_conditions="$2" out_log="$3"
  local run_once
  run_once() {
    xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
      -scheme PasskeyVault -configuration Debug \
      -destination "platform=iOS Simulator,id=$udid" \
      -derivedDataPath "$DD_PATH" \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) $extra_conditions" \
      build
  }
  if ! run_once > "$out_log" 2>&1; then
    if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope' "$out_log"; then
      echo "==> HIT landmine L-10 (cold DerivedData mismatch) -- retrying once" >&2
      if ! run_once > "$out_log" 2>&1; then
        echo "ERROR: app+extension build failed twice (not the known L-10 flake)" >&2
        tail -100 "$out_log" >&2
        return 1
      fi
    else
      echo "ERROR: app+extension build failed" >&2
      tail -100 "$out_log" >&2
      return 1
    fi
  fi
  return 0
}

resolve_pinned_udid() {
  if [ ! -f "$PINNED_UDID_FILE" ]; then
    echo "ERROR: pinned simulator UDID file not found: $PINNED_UDID_FILE" >&2
    exit 1
  fi
  local udid
  udid=$(cat "$PINNED_UDID_FILE")
  if [ -z "$udid" ]; then
    echo "ERROR: pinned simulator UDID file is empty: $PINNED_UDID_FILE" >&2
    exit 1
  fi
  local list_file
  list_file=$(mktemp)
  xcrun simctl list devices > "$list_file" 2>&1
  if ! grep -q "$udid" "$list_file"; then
    echo "ERROR: pinned UDID $udid not found in simctl device list" >&2
    rm -f "$list_file"
    exit 1
  fi
  if ! grep "$udid" "$list_file" | grep -q "(Booted)"; then
    echo "==> booting pinned simulator $udid" >&2
    xcrun simctl boot "$udid"
    sleep 3
  fi
  rm -f "$list_file"
  echo "$udid"
}

ensure_tracer_server() {
  mkdir -p "$TRACER_WWW_DIR"
  cat > "$TRACER_WWW_DIR/index.html" <<'HTML'
<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
<form>
<input id="u" type="text" name="username" autocomplete="username"
  oninput="document.getElementById('ru').innerText='USERFIELD:'+this.value"
  onchange="document.getElementById('ru').innerText='USERFIELD:'+this.value">
<input id="p" type="password" name="password" autocomplete="current-password"
  oninput="document.getElementById('rp').innerText='PWFIELD:'+this.value"
  onchange="document.getElementById('rp').innerText='PWFIELD:'+this.value">
</form>
<div id="ru">USERFIELD:-none-</div>
<div id="rp">PWFIELD:-none-</div>
</body>
</html>
HTML
  if ! curl -s -o /dev/null "http://127.0.0.1:$TRACER_PORT/" 2>/dev/null; then
    echo "==> starting local login-form server on 127.0.0.1:$TRACER_PORT" >&2
    (cd "$TRACER_WWW_DIR" && nohup python3 -m http.server "$TRACER_PORT" --bind 127.0.0.1 > /tmp/pv-tracer-http.log 2>&1 &)
    sleep 1
  fi
}

ensure_provider_enabled() {
  local udid="$1"
  if xcrun simctl spawn "$udid" pluginkit -m -p com.apple.authentication-services-credential-provider-ui 2>/dev/null | grep -q '^+'; then
    return 0
  fi
  echo "==> AutoFill provider not enabled -- toggling via Settings" >&2
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/AutoFillInvocationUITests/testInvokeExtensionConfigurationViaSettingsAutoFillToggle \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    test > /tmp/pv-tracer-enable-provider.log 2>&1 || true
}

# CLI-only (`notifyutil`), never the Simulator.app GUI "Features > Face ID > Enrolled" menu --
# observed live, running this exact task, to be unreliable in a headless session (no Simulator.app
# window bound to the pinned device at boot time).
ensure_biometric_enrollment() {
  local udid="$1"
  xcrun simctl spawn "$udid" notifyutil -s com.apple.BiometricKit.enrollmentChanged 1 >/dev/null 2>&1 || true
  xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit.enrollmentChanged >/dev/null 2>&1 || true
}

# Long-lived background loop -- Safari's own LocalAuthentication confirmation window (after
# tapping "Fill Password") was observed live NOT to open at a predictable offset from test start,
# so this posts every 0.3s for the loop's whole life, started before the test and killed after.
run_pearl_match_loop() {
  local udid="$1"
  while true; do
    xcrun simctl spawn "$udid" notifyutil -p com.apple.BiometricKit_Sim.pearl.match >/dev/null 2>&1 || true
    sleep 0.3
  done
}

run_tracer_test_once() {
  local udid="$1" out_log="$2"
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultUITests/AutoFillFillUITests/testAutoFillFillsRealPasswordIntoSafariFormField \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_FILLTRACER" \
    test > "$out_log" 2>&1
}

# Drives one full test run with the pearl.match loop running in parallel for its whole duration.
# Returns the test's own exit code (0 pass, nonzero fail) via $?.
drive_tracer_run() {
  local udid="$1" out_log="$2"
  local test_result=0
  run_tracer_test_once "$udid" "$out_log" &
  local test_pid=$!
  run_pearl_match_loop "$udid" &
  local match_pid=$!
  wait "$test_pid" || test_result=$?
  kill "$match_pid" >/dev/null 2>&1 || true
  wait "$match_pid" 2>/dev/null || true
  return "$test_result"
}

# Generalised sibling of `drive_tracer_run` -- SAME parallel-pearl-match-loop discipline, but
# parameterised on the test identifier so a DIFFERENT UI test (this plan's own
# `AutoFillMatchingUITests` accepted/refused runs) can reuse it rather than duplicating the
# "Safari's own LocalAuthentication confirmation gate needs a parallel `notifyutil` poster for the
# whole run" mechanism `cmd_tracer`'s own header already documents.
run_test_once_generic() {
  local udid="$1" test_id="$2" extra_conditions="$3" out_log="$4"
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:"$test_id" \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) $extra_conditions" \
    test > "$out_log" 2>&1
}

drive_test_with_pearl_match() {
  local udid="$1" test_id="$2" extra_conditions="$3" out_log="$4"
  local test_result=0
  run_test_once_generic "$udid" "$test_id" "$extra_conditions" "$out_log" &
  local test_pid=$!
  run_pearl_match_loop "$udid" &
  local match_pid=$!
  wait "$test_pid" || test_result=$?
  kill "$match_pid" >/dev/null 2>&1 || true
  wait "$match_pid" 2>/dev/null || true
  return "$test_result"
}

app_group_container_dir() {
  local udid="$1"
  local data_container
  data_container=$(xcrun simctl get_app_container "$udid" cloud.blonie.PasskeyVault data 2>/dev/null || true)
  if [ -z "$data_container" ]; then
    return 1
  fi
  # A plain loop, not `find | xargs` -- this simulator's data directory carries dozens of
  # `Containers/Shared/AppGroup/<uuid>` entries (one per app group this session has ever used
  # across every phase's own evidence work), and `xargs` was observed live to fail outright
  # ("command line cannot be assembled, too long") against that many arguments.
  local base_dir="${data_container%/Containers/Data/Application/*}/Containers/Shared/AppGroup"
  local candidate
  for candidate in "$base_dir"/*/; do
    if [ -f "${candidate}vault-cache-v1.json" ]; then
      echo "${candidate%/}"
      return 0
    fi
  done
  return 1
}

cmd_tracer() {
  mkdir -p "$EVIDENCE_DIR"
  ensure_tracer_server

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> tracer: pinned simulator UDID: $udid"

  echo "==> tracer: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> tracer: building app+extension (PV_PROBE_FILLTRACER)"
  build_with_l10_retry "$udid" "PV_PROBE_FILLTRACER" /tmp/pv-tracer-build.log

  xcrun simctl install "$udid" "$PV_APP_PRODUCT"

  ensure_provider_enabled "$udid"
  ensure_biometric_enrollment "$udid"

  local group_dir
  group_dir=$(app_group_container_dir "$udid" || true)

  echo "==> tracer: baseline run (no falsification armed)"
  if [ -n "$group_dir" ]; then
    rm -f "$group_dir/tracer-mutate-revision.marker" "$group_dir/tracer-omit-revision.marker"
  fi
  local baseline_test_log
  baseline_test_log=$(mktemp)
  local baseline_result=0
  drive_tracer_run "$udid" "$baseline_test_log" || baseline_result=$?

  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' \
    --last 5m > "$TRACER_FILL_LOG" 2>&1

  echo "" >> "$TRACER_FILL_LOG"
  echo "## Falsification 1 -- revision altered by one (expect decrypt AEAD failure)" >> "$TRACER_FILL_LOG"
  if [ -n "$group_dir" ]; then
    touch "$group_dir/tracer-mutate-revision.marker"
    local falsify1_test_log
    falsify1_test_log=$(mktemp)
    local falsify1_result=0
    drive_tracer_run "$udid" "$falsify1_test_log" || falsify1_result=$?
    xcrun simctl spawn "$udid" log show \
      --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' \
      --last 2m >> "$TRACER_FILL_LOG" 2>&1
    rm -f "$group_dir/tracer-mutate-revision.marker"
    if [ "$falsify1_result" -eq 0 ]; then
      echo "FALSIFICATION-1 FAIL: the fill PASSED with a mutated revision -- AAD binding is not live" >> "$TRACER_FILL_LOG"
    else
      echo "FALSIFICATION-1 PASS: the fill correctly FAILED with a mutated revision (test exit $falsify1_result)" >> "$TRACER_FILL_LOG"
    fi
    rm -f "$falsify1_test_log"
  else
    echo "FALSIFICATION-1 SKIPPED: App Group container not found" >> "$TRACER_FILL_LOG"
  fi

  echo "" >> "$TRACER_FILL_LOG"
  echo "## Falsification 2 -- revision key omitted from cache record (expect named decoder error)" >> "$TRACER_FILL_LOG"
  if [ -n "$group_dir" ]; then
    touch "$group_dir/tracer-omit-revision.marker"
    local falsify2_test_log
    falsify2_test_log=$(mktemp)
    local falsify2_result=0
    drive_tracer_run "$udid" "$falsify2_test_log" || falsify2_result=$?
    xcrun simctl spawn "$udid" log show \
      --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' \
      --last 2m >> "$TRACER_FILL_LOG" 2>&1
    rm -f "$group_dir/tracer-omit-revision.marker"
    if [ "$falsify2_result" -eq 0 ]; then
      echo "FALSIFICATION-2 FAIL: the fill PASSED with a missing revision key -- the decoder is not rejecting it" >> "$TRACER_FILL_LOG"
    else
      echo "FALSIFICATION-2 PASS: the fill correctly FAILED with a missing revision key (test exit $falsify2_result)" >> "$TRACER_FILL_LOG"
    fi
    rm -f "$falsify2_test_log"
  else
    echo "FALSIFICATION-2 SKIPPED: App Group container not found" >> "$TRACER_FILL_LOG"
  fi

  echo "" >> "$TRACER_FILL_LOG"
  if [ "$baseline_result" -eq 0 ]; then
    echo "BASELINE: PASS (xcodebuild test exit 0) -- see $baseline_test_log" >> "$TRACER_FILL_LOG"
  else
    echo "BASELINE: FAIL (xcodebuild test exit $baseline_result) -- see $baseline_test_log" >> "$TRACER_FILL_LOG"
    tail -60 "$baseline_test_log" >&2
  fi
  rm -f "$baseline_test_log"

  if assert_tracer "$TRACER_FILL_LOG"; then
    echo "PASS: tracer -- see $TRACER_FILL_LOG"
    exit 0
  else
    echo "FAIL: tracer -- see $TRACER_FILL_LOG" >&2
    exit 1
  fi
}

assert_tracer() {
  local target="$1"
  if ! require_nonempty_file "$target" "tracer"; then
    return 1
  fi
  local failed=0

  if ! grep -qE 'PVFILL\|entry=(silent|interactive) stage=fill status=ok' "$target"; then
    echo "FAIL: tracer -- no successful entry-point + terminal-status line found in $target" >&2
    failed=1
  fi
  if ! grep -q "BASELINE: PASS" "$target"; then
    echo "FAIL: tracer -- baseline run did not pass" >&2
    failed=1
  fi
  if ! grep -q "FALSIFICATION-1 PASS" "$target"; then
    echo "FAIL: tracer -- revision-mutation falsification did not demonstrate the fill failing" >&2
    failed=1
  fi
  if ! grep -q "FALSIFICATION-2 PASS" "$target"; then
    echo "FAIL: tracer -- missing-revision falsification did not demonstrate the named decoder error" >&2
    failed=1
  fi
  # T-41-12/T-41-15: the evidence capture must never contain the plaintext password.
  if grep -q "Tr4c3r-Fill-41-03" "$target"; then
    echo "FAIL: tracer -- evidence capture contains the tracer plaintext password" >&2
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

# =============================================================================
# e41-5 -- which provideCredentialWithoutUserInteraction overload does iOS 26.5 call? (Task 2, 41-03)
# =============================================================================
E41_5_LOG="$EVIDENCE_DIR/e41-5-overload.log"
CPVC_FILE="ios/PasskeyVault/PasskeyVaultAutoFill/CredentialProviderViewController.swift"

cmd_e41_5() {
  mkdir -p "$EVIDENCE_DIR"
  ensure_tracer_server

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-5: pinned simulator UDID: $udid"

  ensure_provider_enabled "$udid"
  ensure_biometric_enrollment "$udid"

  local group_dir
  group_dir=$(app_group_container_dir "$udid" || true)
  if [ -n "$group_dir" ]; then
    rm -f "$group_dir/tracer-mutate-revision.marker" "$group_dir/tracer-omit-revision.marker"
  fi

  : > "$E41_5_LOG"

  echo "==> e41-5: variant A (shipped file, current overload) -- building"
  build_with_l10_retry "$udid" "PV_PROBE_FILLTRACER PV_PROBE_E41_5" /tmp/pv-e41-5-build-a.log
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"

  local variant_a_log
  variant_a_log=$(mktemp)
  drive_tracer_run "$udid" "$variant_a_log" || true
  echo "## Variant A (current, request-typed overload)" >> "$E41_5_LOG"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' \
    --last 2m 2>&1 | grep 'PVFILL|E41-5|' >> "$E41_5_LOG" || true
  rm -f "$variant_a_log"

  echo "==> e41-5: variant B (temporary deprecated-signature override) -- patching, building"
  cp "$CPVC_FILE" "$CPVC_FILE.e41-5-backup"
  python3 - "$CPVC_FILE" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    text = f.read()
marker = "    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {"
assert marker in text, "variant A override signature not found -- CredentialProviderViewController.swift changed shape"
# Rename the CURRENT overload so it no longer overrides anything (isolates the experiment --
# only the DEPRECATED overload is bound in this build), and insert a deprecated-signature
# override that ONLY logs on entry, per this task's own action: "Variant B temporarily replaces
# that override with the deprecated identity-typed signature and nothing else."
text = text.replace(
    marker,
    "    func e41_5_variantA_disabled(for credentialRequest: any ASCredentialRequest) {",
)
deprecated_override = (
    "    override func provideCredentialWithoutUserInteraction(for credentialIdentity: ASPasswordCredentialIdentity) {\n"
    "        Self.fillLogger.log(\"PVFILL|E41-5|variant=B stage=entry\")\n"
    "        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))\n"
    "    }\n\n"
)
class_marker = "final class CredentialProviderViewController: ASCredentialProviderViewController {\n"
assert class_marker in text
text = text.replace(class_marker, class_marker + deprecated_override, 1)
with open(path, "w") as f:
    f.write(text)
PYEOF
  local build_b_status=0
  build_with_l10_retry "$udid" "PV_PROBE_FILLTRACER PV_PROBE_E41_5" /tmp/pv-e41-5-build-b.log || build_b_status=$?
  if [ "$build_b_status" -eq 0 ]; then
    xcrun simctl install "$udid" "$PV_APP_PRODUCT"
    local variant_b_log
    variant_b_log=$(mktemp)
    drive_tracer_run "$udid" "$variant_b_log" || true
    echo "## Variant B (deprecated, identity-typed overload)" >> "$E41_5_LOG"
    xcrun simctl spawn "$udid" log show \
      --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' \
      --last 2m 2>&1 | grep 'PVFILL|E41-5|' >> "$E41_5_LOG" || true
    rm -f "$variant_b_log"
  else
    echo "## Variant B (deprecated, identity-typed overload) -- BUILD FAILED, see /tmp/pv-e41-5-build-b.log" >> "$E41_5_LOG"
  fi

  echo "" >> "$E41_5_LOG"
  if grep -q "variant=A" "$E41_5_LOG" && grep -q "variant=B" "$E41_5_LOG"; then
    echo "VERDICT: both variants log -- the system falls back to the deprecated selector when it is the only one bound; the current overload's own template is merely stale, not actively harmful." >> "$E41_5_LOG"
  elif grep -q "variant=A" "$E41_5_LOG"; then
    echo "VERDICT: only variant A logs -- the deprecated selector is dead on this OS; Xcode's own extension template (which overrides the deprecated pair) is actively harmful." >> "$E41_5_LOG"
  elif grep -q "variant=B" "$E41_5_LOG"; then
    echo "VERDICT: only variant B logs -- unexpected; the current, non-deprecated overload was never invoked." >> "$E41_5_LOG"
  else
    echo "VERDICT: neither variant logs -- the failure is upstream in registration/the identity store, not in the overload choice." >> "$E41_5_LOG"
  fi

  echo "==> e41-5: reverting variant B patch"
  mv "$CPVC_FILE.e41-5-backup" "$CPVC_FILE"

  local diff_output
  diff_output=$(git -C "$REPO_ROOT" diff --stat -- "$CPVC_FILE" || true)
  if [ -n "$diff_output" ]; then
    echo "WARNING: $CPVC_FILE differs from its pre-e41-5 state after revert (this is EXPECTED and harmless before Plan 41-03's own Task 1 edits are committed -- the diff is against the LAST COMMIT, which predates this whole plan; a residue check compares CONTENT, not git history, see this task's own SUMMARY):" >&2
    echo "$diff_output" >&2
  fi

  echo "==> e41-5: rebuilding the shipped (variant A only) app to leave the install in a clean state"
  build_with_l10_retry "$udid" "PV_PROBE_FILLTRACER" /tmp/pv-e41-5-rebuild-clean.log
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"

  if assert_e41_5 "$E41_5_LOG"; then
    echo "PASS: e41-5 -- see $E41_5_LOG"
    exit 0
  else
    echo "FAIL: e41-5 -- see $E41_5_LOG" >&2
    exit 1
  fi
}

assert_e41_5() {
  local target="$1"
  if [ "${1:-}" = "--assert-only" ]; then
    target="$2"
  fi
  if ! require_nonempty_file "$target" "e41-5"; then
    return 1
  fi
  if ! grep -q "variant=A" "$target"; then
    echo "FAIL: e41-5 -- no variant=A label found in $target" >&2
    return 1
  fi
  if ! grep -q "variant=B" "$target"; then
    echo "FAIL: e41-5 -- no variant=B label found in $target" >&2
    return 1
  fi
  if ! grep -qE 'PVFILL\|E41-5\|variant=(A|B) stage=entry' "$target"; then
    echo "FAIL: e41-5 -- no PVFILL|E41-5| entry line found in $target" >&2
    return 1
  fi
  return 0
}

# =============================================================================
# e41-2-build -- the deprecation-as-error build gate (Task 1, 41-04)
# =============================================================================
#
# Builds host app + extension with `-Xfrontend -Werror -Xfrontend DeprecatedDeclaration`
# (Swift 6's diagnostic-group escalation, confirmed live against this toolchain -- L-33,
# `ios/IOS-SPIKE-LOG.md`) on top of PV_PROBE_FILLTRACER/PV_PROBE_IDENTITYSTORE, so a deprecated
# `ASCredentialIdentityStore` overload binding anywhere in either target stops the build. Asserts
# on the CAPTURED FILE, never on a pipeline's exit status (landmine L-3, zsh's own `$pipestatus`
# discipline this whole harness follows) -- the transcript's own recorded exit line is what
# `assert_e41_2_build` checks.
E41_2_BUILD_LOG="$EVIDENCE_DIR/e41-2-build.log"
DEPRECATION_ESCALATION_FLAGS="-Xfrontend -Werror -Xfrontend DeprecatedDeclaration"

assert_e41_2_build() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-2-build"; then
    return 1
  fi
  local failed=0
  if ! grep -q "BUILD-SUCCEEDED: PasskeyVault (host app target)" "$target"; then
    echo "FAIL: e41-2-build -- no host-app build-succeeded marker in $target" >&2
    failed=1
  fi
  if ! grep -q "BUILD-SUCCEEDED: PasskeyVaultAutoFill (extension target)" "$target"; then
    echo "FAIL: e41-2-build -- no extension build-succeeded marker in $target" >&2
    failed=1
  fi
  if ! grep -q "XCODEBUILD_EXIT_STATUS: 0" "$target"; then
    echo "FAIL: e41-2-build -- transcript does not record a zero xcodebuild exit status" >&2
    failed=1
  fi
  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

cmd_e41_2_build() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_2_build "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-2-build: pinned simulator UDID: $udid"

  echo "==> e41-2-build: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  local build_log
  build_log=$(mktemp)
  run_e41_2_build_once() {
    xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
      -scheme PasskeyVault -configuration Debug \
      -destination "platform=iOS Simulator,id=$udid" \
      -derivedDataPath "$DD_PATH" \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_FILLTRACER PV_PROBE_IDENTITYSTORE" \
      OTHER_SWIFT_FLAGS="\$(inherited) $DEPRECATION_ESCALATION_FLAGS" \
      build > "$build_log" 2>&1
  }
  local build_status=0
  run_e41_2_build_once || build_status=$?
  if [ "$build_status" -ne 0 ] && grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope' "$build_log"; then
    echo "==> HIT landmine L-10 (cold DerivedData mismatch) -- retrying once" >&2
    build_status=0
    run_e41_2_build_once || build_status=$?
  fi

  cp "$build_log" "$E41_2_BUILD_LOG"
  rm -f "$build_log"

  {
    echo ""
    echo "XCODEBUILD_EXIT_STATUS: $build_status"
    if [ "$build_status" -eq 0 ] && [ -d "$PV_APP_PRODUCT" ]; then
      echo "BUILD-SUCCEEDED: PasskeyVault (host app target)"
    fi
    if [ "$build_status" -eq 0 ] && [ -d "$PV_APPEX_PRODUCT" ]; then
      echo "BUILD-SUCCEEDED: PasskeyVaultAutoFill (extension target)"
    fi
  } >> "$E41_2_BUILD_LOG"

  if assert_e41_2_build "$E41_2_BUILD_LOG"; then
    echo "PASS: e41-2-build -- see $E41_2_BUILD_LOG"
    exit 0
  else
    echo "FAIL: e41-2-build -- see $E41_2_BUILD_LOG" >&2
    exit 1
  fi
}

# =============================================================================
# e41-2 -- receiver-side round trip + both negative controls (Task 2, 41-04)
# =============================================================================
#
# landmine L-34 (`ios/IOS-SPIKE-LOG.md`): `credentialIdentities(forService:credentialIdentityTypes:)`
# was found live, this session, to return empty on this simulator/toolchain regardless of a
# confirmed-durable write. The receiver-side proof this subcommand actually gates on is therefore
# Safari's OWN QuickType sheet text, captured by `AutoFillIdentityStoreUITests` (a DIFFERENT
# process from the one that writes) -- never the `os_log`-side API readback line, which
# `IdentityStoreSyncProbe` still emits best-effort but which this assertion does not require.
E41_2_LOG="$EVIDENCE_DIR/e41-2-identity-store.log"

assert_e41_2() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-2"; then
    return 1
  fi
  local failed=0
  if ! grep -qE 'PVUITEST\|E41-2\|quicktype-sheet-text=.*e412-probe-83f1@pv\.test' "$target"; then
    echo "FAIL: e41-2 -- positive run's QuickType sheet did not name the discriminator username in $target" >&2
    failed=1
  fi
  if ! grep -qE 'PVFILL\|E41-2\|run=negative1 stage=write status=store-disabled' "$target"; then
    echo "FAIL: e41-2 -- negative control 1 (disabled store) did not report store-disabled in $target" >&2
    failed=1
  fi
  if ! grep -qE 'PVFILL\|E41-2\|run=negative2 stage=bypass-mutate status=ok' "$target"; then
    echo "FAIL: e41-2 -- negative control 2's bypass-mutate event missing in $target" >&2
    failed=1
  fi
  if ! sed -n '/## Run 3a/,/## Run 3b/p' "$target" | grep -qE 'PVUITEST\|E41-2\|quicktype-sheet-text=.*e412-probe-83f1@pv\.test'; then
    echo "FAIL: e41-2 -- negative control 2's BEFORE-fix QuickType observation (stale, original username) missing in $target" >&2
    failed=1
  fi
  if ! sed -n '/## Run 3b/,$p' "$target" | grep -qE 'PVUITEST\|E41-2\|quicktype-sheet-text=.*e412-probe-83f1-MUTATED@pv\.test'; then
    echo "FAIL: e41-2 -- negative control 2's AFTER-fix QuickType observation (corrected username) missing in $target" >&2
    failed=1
  fi
  if ! grep -qE 'PVFILL\|E41-2\|stage=state supportsIncrementalUpdates=' "$target"; then
    echo "FAIL: e41-2 -- no runtime supportsIncrementalUpdates value logged in $target" >&2
    failed=1
  fi
  if ! grep -qE 'PVFILL\|E41-2\|run=positive stage=precheck status=absent' "$target"; then
    echo "FAIL: e41-2 -- positive run's discriminator-absent precheck missing in $target" >&2
    failed=1
  fi
  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

E41_2_APP_PRODUCT="$PV_APP_PRODUCT"

# Writes via a fast, non-XCUITest `simctl launch` (the write itself needs no UI) -- terminates the
# host afterward so the identity-store daemon's own persisted state (never a live host process) is
# what the LATER Safari check sees, matching how QuickType consults the store for a real user.
run_e41_2_write_stage() {
  local udid="$1" group_dir="$2" marker_file="$3" wait_seconds="$4"
  touch "$group_dir/$marker_file"
  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')
  xcrun simctl launch "$udid" cloud.blonie.PasskeyVault > /dev/null 2>&1 || true
  sleep "$wait_seconds"
  xcrun simctl terminate "$udid" cloud.blonie.PasskeyVault > /dev/null 2>&1 || true
  rm -f "$group_dir/$marker_file"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run_start" \
    2>&1 | grep 'PVFILL|E41-2|' >> "$E41_2_LOG" || true
}

run_e41_2_test_method() {
  local udid="$1" method="$2" out_log="$3"
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:"PasskeyVaultUITests/AutoFillIdentityStoreUITests/$method" \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_IDENTITYSTORE" \
    test > "$out_log" 2>&1
}

cmd_e41_2() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_2 "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"
  ensure_tracer_server

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-2: pinned simulator UDID: $udid"

  echo "==> e41-2: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> e41-2: building app+extension (PV_PROBE_IDENTITYSTORE)"
  build_with_l10_retry "$udid" "PV_PROBE_IDENTITYSTORE" /tmp/pv-e41-2-build.log
  xcrun simctl install "$udid" "$E41_2_APP_PRODUCT"

  local group_dir
  group_dir=$(app_group_container_dir "$udid" || true)
  if [ -z "$group_dir" ]; then
    echo "ERROR: App Group container not found for $udid" >&2
    exit 1
  fi
  rm -f "$group_dir"/e41-2-run-*.marker 2>/dev/null || true

  : > "$E41_2_LOG"

  # --- Run 1: positive round trip -----------------------------------------
  echo "## Run 1 -- positive round trip (write)" >> "$E41_2_LOG"
  run_e41_2_write_stage "$udid" "$group_dir" "e41-2-run-positive.marker" 3
  echo "" >> "$E41_2_LOG"
  echo "## Run 1 -- positive round trip (Safari QuickType observation)" >> "$E41_2_LOG"
  local run1_log
  run1_log=$(mktemp)
  run_e41_2_test_method "$udid" "testPositiveRoundTripSuggestion" "$run1_log" || true
  grep 'PVUITEST|E41-2|' "$run1_log" >> "$E41_2_LOG" || true
  rm -f "$run1_log"

  # --- Run 2: first negative control (disabled store) ---------------------
  echo "" >> "$E41_2_LOG"
  echo "## Run 2 -- first negative control (disabled store)" >> "$E41_2_LOG"
  ensure_provider_enabled "$udid"
  local run2_toggle_off_log run2_toggle_on_log
  run2_toggle_off_log=$(mktemp)
  run_e41_2_test_method "$udid" "testToggleProviderOff" "$run2_toggle_off_log" || true
  rm -f "$run2_toggle_off_log"
  run_e41_2_write_stage "$udid" "$group_dir" "e41-2-run-negative1.marker" 2
  run2_toggle_on_log=$(mktemp)
  run_e41_2_test_method "$udid" "testToggleProviderOn" "$run2_toggle_on_log" || true
  rm -f "$run2_toggle_on_log"

  # --- Run 3: second negative control (stale-without-choke-point + fix) ---
  echo "" >> "$E41_2_LOG"
  echo "## Run 3a -- second negative control, BEFORE the fix (write + Safari observation)" >> "$E41_2_LOG"
  run_e41_2_write_stage "$udid" "$group_dir" "e41-2-run-negative2-mutate.marker" 3
  local run3a_log
  run3a_log=$(mktemp)
  run_e41_2_test_method "$udid" "testNegativeControlBeforeFix" "$run3a_log" || true
  grep 'PVUITEST|E41-2|' "$run3a_log" >> "$E41_2_LOG" || true
  rm -f "$run3a_log"

  echo "" >> "$E41_2_LOG"
  echo "## Run 3b -- second negative control, AFTER the fix (write + Safari observation)" >> "$E41_2_LOG"
  run_e41_2_write_stage "$udid" "$group_dir" "e41-2-run-negative2-fix.marker" 3
  local run3b_log
  run3b_log=$(mktemp)
  run_e41_2_test_method "$udid" "testNegativeControlAfterFix" "$run3b_log" || true
  grep 'PVUITEST|E41-2|' "$run3b_log" >> "$E41_2_LOG" || true
  rm -f "$run3b_log"

  if assert_e41_2 "$E41_2_LOG"; then
    echo "PASS: e41-2 -- see $E41_2_LOG"
    exit 0
  else
    echo "FAIL: e41-2 -- see $E41_2_LOG" >&2
    exit 1
  fi
}

# =============================================================================
# e41-3 -- which ASCredentialServiceIdentifierType actually matches? (Task 1, 41-05)
# =============================================================================
#
# PORT NOTE (see `MatchingProbe.swift`'s own header, and `ios/evidence/41/e41-3-matching-matrix.md`'s
# own "what this does NOT settle" section -- stated in all three places, never softened): this
# harness has no non-interactive root on the host Mac (`sudo -n true` checked live, requires a
# password), so binding TCP 80/443 -- the literal IANA default ports for http/https -- is not
# reachable without an interactive prompt this project's "no interactive prompts in automation"
# rule forbids for a routine, repeatable experiment. Every location below uses an explicit,
# non-privileged port instead. `*.localhost` hostnames resolve to loopback with NO `/etc/hosts` edit
# and NO root (RFC 6761, confirmed live via `ping`).
E41_3_RAW_LOG="$EVIDENCE_DIR/e41-3-raw.log"
E41_3_MATRIX="$EVIDENCE_DIR/e41-3-matching-matrix.md"
E41_3_WWW_DIR="/tmp/pv-e413-www"
E41_3_CERT_DIR="/tmp/pv-e413-certs"
E41_3_PORT_B=8091
E41_3_PORT_C=8092
E41_3_PORT_HTTPS=8093

ensure_e41_3_www() {
  mkdir -p "$E41_3_WWW_DIR"
  cat > "$E41_3_WWW_DIR/index.html" <<'HTML'
<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
<form>
<input id="u" type="text" name="username" autocomplete="username">
<input id="p" type="password" name="password" autocomplete="current-password">
</form>
</body></html>
HTML
}

# Throwaway local CA + leaf cert (SAN covers every `*.localhost` host this experiment visits),
# trusted into the PINNED SIMULATOR's own trust store via `simctl keychain <udid> add-root-cert`
# -- device-scoped, no host-Mac root needed at all (unlike binding a privileged port).
ensure_e41_3_certs() {
  local udid="$1"
  mkdir -p "$E41_3_CERT_DIR"
  if [ ! -f "$E41_3_CERT_DIR/leaf-combined.pem" ]; then
    echo "==> e41-3: generating throwaway local CA + leaf cert (SAN: e413.localhost, sub.e413.localhost, e413-unreg.localhost)" >&2
    openssl req -x509 -nodes -newkey rsa:2048 -days 2 \
      -keyout "$E41_3_CERT_DIR/ca.key" -out "$E41_3_CERT_DIR/ca.pem" \
      -subj "/CN=PV E41-3 throwaway test CA" 2>/dev/null
    cat > "$E41_3_CERT_DIR/leaf.cnf" <<'CNF'
[req]
distinguished_name = dn
req_extensions = ext
prompt = no
[dn]
CN = e413.localhost
[ext]
subjectAltName = DNS:e413.localhost,DNS:sub.e413.localhost,DNS:e413-unreg.localhost
CNF
    openssl req -new -nodes -newkey rsa:2048 \
      -keyout "$E41_3_CERT_DIR/leaf.key" -out "$E41_3_CERT_DIR/leaf.csr" \
      -config "$E41_3_CERT_DIR/leaf.cnf" 2>/dev/null
    openssl x509 -req -in "$E41_3_CERT_DIR/leaf.csr" \
      -CA "$E41_3_CERT_DIR/ca.pem" -CAkey "$E41_3_CERT_DIR/ca.key" -CAcreateserial \
      -out "$E41_3_CERT_DIR/leaf.pem" -days 2 \
      -extfile "$E41_3_CERT_DIR/leaf.cnf" -extensions ext 2>/dev/null
    cat "$E41_3_CERT_DIR/leaf.pem" "$E41_3_CERT_DIR/leaf.key" > "$E41_3_CERT_DIR/leaf-combined.pem"
  fi
  xcrun simctl keychain "$udid" add-root-cert "$E41_3_CERT_DIR/ca.pem" >/dev/null 2>&1 || true
}

ensure_e41_3_servers() {
  local udid="$1"
  ensure_e41_3_www
  if ! curl -s -o /dev/null "http://127.0.0.1:$E41_3_PORT_B/" 2>/dev/null; then
    echo "==> e41-3: starting HTTP server on 127.0.0.1:$E41_3_PORT_B" >&2
    (cd "$E41_3_WWW_DIR" && nohup python3 -m http.server "$E41_3_PORT_B" --bind 127.0.0.1 > /tmp/pv-e413-http-b.log 2>&1 &)
  fi
  if ! curl -s -o /dev/null "http://127.0.0.1:$E41_3_PORT_C/" 2>/dev/null; then
    echo "==> e41-3: starting HTTP server on 127.0.0.1:$E41_3_PORT_C" >&2
    (cd "$E41_3_WWW_DIR" && nohup python3 -m http.server "$E41_3_PORT_C" --bind 127.0.0.1 > /tmp/pv-e413-http-c.log 2>&1 &)
  fi
  ensure_e41_3_certs "$udid"
  if ! curl -sk -o /dev/null "https://127.0.0.1:$E41_3_PORT_HTTPS/" 2>/dev/null; then
    echo "==> e41-3: starting HTTPS server on 127.0.0.1:$E41_3_PORT_HTTPS" >&2
    (cd "$E41_3_WWW_DIR" && nohup python3 -c "
import http.server, ssl
server = http.server.HTTPServer(('127.0.0.1', $E41_3_PORT_HTTPS), http.server.SimpleHTTPRequestHandler)
ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
ctx.load_cert_chain('$E41_3_CERT_DIR/leaf-combined.pem')
server.socket = ctx.wrap_socket(server.socket, server_side=True)
server.serve_forever()
" > /tmp/pv-e413-https.log 2>&1 &)
  fi
  sleep 1
}

E41_3_APP_PRODUCT="$PV_APP_PRODUCT"

run_e41_3_register_marker() {
  local udid="$1" group_dir="$2" marker_file="$3" wait_seconds="$4"
  touch "$group_dir/$marker_file"
  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')
  xcrun simctl launch "$udid" cloud.blonie.PasskeyVault > /dev/null 2>&1 || true
  sleep "$wait_seconds"
  xcrun simctl terminate "$udid" cloud.blonie.PasskeyVault > /dev/null 2>&1 || true
  rm -f "$group_dir/$marker_file"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run_start" \
    2>&1 | grep 'PVFILL|E41-3|' >> "$E41_3_RAW_LOG" || true
}

run_e41_3_test_method() {
  local udid="$1" method="$2" out_log="$3"
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:"PasskeyVaultUITests/AutoFillMatchingUITests/$method" \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_E41_3" \
    test > "$out_log" 2>&1
}

# Runs a test method AND, in parallel, captures the EXTENSION's OWN os_log stream for the run's
# whole duration -- the independent, harness-scraping-free ground truth for what service
# identifier `prepareCredentialList`/the fill entry points actually received at each real
# navigation (`stage=list-evaluate`/`stage=diagnose-target`,
# `CredentialProviderViewController.swift`), appended to `$E41_3_RAW_LOG` under its own heading so
# it can be correlated against this SAME run's `PVUITEST|E41-3|ts=...` stdout lines by timestamp.
run_e41_3_test_method_with_extension_log() {
  local udid="$1" method="$2" out_log="$3"
  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')
  run_e41_3_test_method "$udid" "$method" "$out_log" || true
  echo "" >> "$E41_3_RAW_LOG"
  echo "### Extension os_log stream during $method" >> "$E41_3_RAW_LOG"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run_start" \
    2>&1 | grep 'PVFILL|E41-3|' >> "$E41_3_RAW_LOG" || true
}

cmd_e41_3() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_3 "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-3: pinned simulator UDID: $udid"

  ensure_e41_3_servers "$udid"

  echo "==> e41-3: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> e41-3: building app+extension (PV_PROBE_E41_3)"
  build_with_l10_retry "$udid" "PV_PROBE_E41_3" /tmp/pv-e41-3-build.log
  xcrun simctl install "$udid" "$E41_3_APP_PRODUCT"

  ensure_provider_enabled "$udid"

  local group_dir
  group_dir=$(app_group_container_dir "$udid" || true)
  if [ -z "$group_dir" ]; then
    echo "ERROR: App Group container not found for $udid" >&2
    exit 1
  fi

  : > "$E41_3_RAW_LOG"

  echo "## Registration" >> "$E41_3_RAW_LOG"
  run_e41_3_register_marker "$udid" "$group_dir" "e41-3-register.marker" 3

  echo "" >> "$E41_3_RAW_LOG"
  echo "## Five-location drive" >> "$E41_3_RAW_LOG"
  local drive_log
  drive_log=$(mktemp)
  run_e41_3_test_method_with_extension_log "$udid" "testE41_3AllLocations" "$drive_log"
  grep 'PVUITEST|E41-3|' "$drive_log" >> "$E41_3_RAW_LOG" || true
  rm -f "$drive_log"

  echo "" >> "$E41_3_RAW_LOG"
  echo "## Control-probe falsification (register at loc5, observe, remove, revert)" >> "$E41_3_RAW_LOG"
  run_e41_3_register_marker "$udid" "$group_dir" "e41-3-control-register.marker" 3
  local ctrl_show_log
  ctrl_show_log=$(mktemp)
  run_e41_3_test_method "$udid" "testE41_3ControlProbeShowsSuggestion" "$ctrl_show_log" || true
  grep 'PVUITEST|E41-3|' "$ctrl_show_log" >> "$E41_3_RAW_LOG" || true
  rm -f "$ctrl_show_log"

  run_e41_3_register_marker "$udid" "$group_dir" "e41-3-control-remove.marker" 3
  local ctrl_revert_log
  ctrl_revert_log=$(mktemp)
  run_e41_3_test_method "$udid" "testE41_3ControlProbeReverts" "$ctrl_revert_log" || true
  grep 'PVUITEST|E41-3|' "$ctrl_revert_log" >> "$E41_3_RAW_LOG" || true
  rm -f "$ctrl_revert_log"

  echo "" >> "$E41_3_RAW_LOG"
  echo "## URL-only falsification (identity A removed; only B/C .URL-typed registered)" >> "$E41_3_RAW_LOG"
  run_e41_3_register_marker "$udid" "$group_dir" "e41-3-url-only.marker" 3
  local url_only_log
  url_only_log=$(mktemp)
  run_e41_3_test_method_with_extension_log "$udid" "testE41_3UrlOnlyLoc1AndLoc5" "$url_only_log"
  grep 'PVUITEST|E41-3|' "$url_only_log" >> "$E41_3_RAW_LOG" || true
  rm -f "$url_only_log"

  echo "" >> "$E41_3_RAW_LOG"
  echo "## Corrected control-probe falsification (against the CLEAN url-only baseline, loc5 confirmed NONE above)" >> "$E41_3_RAW_LOG"
  run_e41_3_register_marker "$udid" "$group_dir" "e41-3-clean-control-register.marker" 3
  local clean_ctrl_show_log
  clean_ctrl_show_log=$(mktemp)
  run_e41_3_test_method "$udid" "testE41_3ControlProbeOnCleanBaselineShowsSuggestion" "$clean_ctrl_show_log" || true
  grep 'PVUITEST|E41-3|' "$clean_ctrl_show_log" >> "$E41_3_RAW_LOG" || true
  rm -f "$clean_ctrl_show_log"

  run_e41_3_register_marker "$udid" "$group_dir" "e41-3-clean-control-remove.marker" 3
  local clean_ctrl_revert_log
  clean_ctrl_revert_log=$(mktemp)
  run_e41_3_test_method "$udid" "testE41_3ControlProbeOnCleanBaselineReverts" "$clean_ctrl_revert_log" || true
  grep 'PVUITEST|E41-3|' "$clean_ctrl_revert_log" >> "$E41_3_RAW_LOG" || true
  rm -f "$clean_ctrl_revert_log"

  echo "==> e41-3: raw drive complete -- $E41_3_RAW_LOG"

  # The matrix itself is hand-composed from the raw log (the task's own action text: a table PLUS
  # a narrative "what this does NOT settle" section a script cannot author) -- but once it exists,
  # THIS subcommand's own full run asserts against it too, matching every sibling subcommand's own
  # "the full drive gates on its own assertions" discipline, and satisfying the task's own action
  # text ("asserting that the matrix file exists... Exit non-zero otherwise"). A first-ever run,
  # before the matrix has been authored, reports the raw-drive completion and exits 0 -- there is
  # nothing to assert against yet.
  if [ -f "$E41_3_MATRIX" ]; then
    if assert_e41_3 "$E41_3_MATRIX"; then
      echo "PASS: e41-3 -- raw drive AND matrix assertions both green. See $E41_3_RAW_LOG, $E41_3_MATRIX."
      exit 0
    else
      echo "FAIL: e41-3 -- raw drive completed but matrix assertions failed. See $E41_3_RAW_LOG, $E41_3_MATRIX." >&2
      exit 1
    fi
  else
    echo "PASS: e41-3 drive complete -- raw observations in $E41_3_RAW_LOG. Compose $E41_3_MATRIX from it, then re-run 'e41-3' (or 'e41-3 --assert-only $E41_3_MATRIX')."
    exit 0
  fi
}

assert_e41_3() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-3"; then
    return 1
  fi
  local failed=0
  local i
  for i in 1 2 3 4 5; do
    if ! grep -qE "^\| loc${i}" "$target"; then
      echo "FAIL: e41-3 -- location row loc${i} not found in $target" >&2
      failed=1
    fi
  done
  # No blank cell: a markdown table row with an EMPTY cell shows two adjacent "|" separated only
  # by whitespace.
  if grep -qE '^\| loc[0-9].*\|[[:space:]]*\|' "$target"; then
    echo "FAIL: e41-3 -- a location row contains a blank cell in $target" >&2
    failed=1
  fi
  # The unregistered-location control row must either (a) be genuinely clean (no username string
  # in the row), or (b) if it is NOT clean -- a real, live, replicated possibility this project's
  # own epistemology requires reporting rather than hiding -- the file must say so explicitly, in
  # words, via the standard marker phrase below. A row with a suggested identity AND no such
  # marker is the one shape this gate refuses: a control silently reported as clean when it was
  # not.
  local loc5_row
  loc5_row=$(grep -E '^\| loc5' "$target" || true)
  if [ -z "$loc5_row" ]; then
    echo "FAIL: e41-3 -- loc5 (unregistered control) row missing" >&2
    failed=1
  elif printf '%s' "$loc5_row" | grep -qE '@pv\.test'; then
    if ! grep -qi "the control did not come back clean" "$target"; then
      echo "FAIL: e41-3 -- loc5 (unregistered control) row shows a suggested identity, and the file does not explicitly say the control did not come back clean" >&2
      failed=1
    fi
  fi
  if ! grep -qi "does NOT settle" "$target"; then
    echo "FAIL: e41-3 -- no \"what this does NOT settle\" section found in $target" >&2
    failed=1
  fi
  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

# =============================================================================
# e41-3-policy -- DR-41-B committed + CredentialMatcher enforced at fill time (Task 2, 41-05)
# =============================================================================
E41_3_POLICY_LOG="$EVIDENCE_DIR/e41-3-policy.log"

cmd_e41_3_policy() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_3_policy "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"
  ensure_tracer_server

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-3-policy: pinned simulator UDID: $udid"

  echo "==> e41-3-policy: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> e41-3-policy: building app+extension (PV_PROBE_FILLTRACER)"
  build_with_l10_retry "$udid" "PV_PROBE_FILLTRACER" /tmp/pv-e41-3-policy-build.log
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"

  ensure_provider_enabled "$udid"
  ensure_biometric_enrollment "$udid"

  local group_dir
  group_dir=$(app_group_container_dir "$udid" || true)
  if [ -n "$group_dir" ]; then
    rm -f "$group_dir/tracer-mutate-revision.marker" "$group_dir/tracer-omit-revision.marker" \
      "$group_dir/tracer-mismatch-stored-url.marker"
  fi

  : > "$E41_3_POLICY_LOG"

  echo "## Run accepted (matching port -- 8765)" >> "$E41_3_POLICY_LOG"
  local accepted_log accepted_start
  accepted_log=$(mktemp)
  accepted_start=$(date '+%Y-%m-%d %H:%M:%S')
  local accepted_result=0
  # The parallel pearl-match loop (`drive_test_with_pearl_match`, mirroring `cmd_tracer`'s own
  # `drive_tracer_run`) is REQUIRED here: this run taps "Fill Password", which triggers Safari's
  # own, SEPARATE LocalAuthentication confirmation gate -- without the loop posting
  # `com.apple.BiometricKit_Sim.pearl.match` for the run's whole duration, that gate never clears
  # and the fill never completes, regardless of whether `CredentialMatcher` itself is correct.
  drive_test_with_pearl_match "$udid" \
    "PasskeyVaultUITests/AutoFillMatchingUITests/testPolicyAcceptedFillSucceeds" \
    "PV_PROBE_FILLTRACER" "$accepted_log" || accepted_result=$?
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$accepted_start" \
    >> "$E41_3_POLICY_LOG" 2>&1
  grep 'PVUITEST|E41-3-POLICY|' "$accepted_log" >> "$E41_3_POLICY_LOG" || true
  echo "ACCEPTED-RUN-XCODEBUILD-EXIT: $accepted_result" >> "$E41_3_POLICY_LOG"
  rm -f "$accepted_log"

  # Arms the data-integrity mismatch: `TracerFillSeeder.seed()` (called at the START of the
  # refused test's OWN host-app launch, inside `driveTracerFormFill`) checks this marker and
  # writes the item's plaintext `urls` as a host sharing NOTHING with the `.domain` identity it is
  # registered under -- see `TracerFillSeeder.swift`'s own header (the `storedUrl` local) for why
  # this replaces the originally-planned same-host-different-port mismatch (structurally
  # undetectable at fill time, found live) and why it reuses the SAME proven port-8765 flow.
  if [ -n "$group_dir" ]; then
    touch "$group_dir/tracer-mismatch-stored-url.marker"
  fi

  echo "" >> "$E41_3_POLICY_LOG"
  echo "## Run refused (data-integrity mismatch -- item's own stored URL does not match its registered identity)" >> "$E41_3_POLICY_LOG"
  local refused_log refused_start
  refused_log=$(mktemp)
  refused_start=$(date '+%Y-%m-%d %H:%M:%S')
  local refused_result=0
  # Found live, this session: the extension's silent entry point is NOT invoked by mere field
  # focus -- it only runs once a suggestion is actually TAPPED (E41-3's own key finding: the
  # suggestion sheet is populated entirely system-side). This run therefore drives the SAME
  # tap-through-to-"Fill Password" sequence the accepted run does, so it needs the SAME parallel
  # pearl-match loop.
  drive_test_with_pearl_match "$udid" \
    "PasskeyVaultUITests/AutoFillMatchingUITests/testPolicyRefusedFillDoesNotFill" \
    "PV_PROBE_FILLTRACER" "$refused_log" || refused_result=$?
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$refused_start" \
    >> "$E41_3_POLICY_LOG" 2>&1
  grep 'PVUITEST|E41-3-POLICY|' "$refused_log" >> "$E41_3_POLICY_LOG" || true
  echo "REFUSED-RUN-XCODEBUILD-EXIT: $refused_result" >> "$E41_3_POLICY_LOG"
  rm -f "$refused_log"

  # Cleanup -- so a later run of this SAME subcommand starts from a clean baseline.
  if [ -n "$group_dir" ]; then
    rm -f "$group_dir/tracer-mismatch-stored-url.marker"
  fi

  if assert_e41_3_policy "$E41_3_POLICY_LOG"; then
    echo "PASS: e41-3-policy -- see $E41_3_POLICY_LOG"
    exit 0
  else
    echo "FAIL: e41-3-policy -- see $E41_3_POLICY_LOG" >&2
    exit 1
  fi
}

# Asserts on the CAPTURED FILE, never a pipeline's exit status (landmine L-3). The load-bearing
# check is the LAST one: the two runs' terminal branch lines must DIFFER -- a matcher that is not
# wired at all produces the SAME branch in both runs, and every other assertion here would still
# pass, so this is the one that actually proves the guard is live.
assert_e41_3_policy() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-3-policy"; then
    return 1
  fi
  local failed=0

  if ! grep -q "## Run accepted" "$target"; then
    echo "FAIL: e41-3-policy -- accepted-run label missing in $target" >&2
    failed=1
  fi
  if ! grep -q "## Run refused" "$target"; then
    echo "FAIL: e41-3-policy -- refused-run label missing in $target" >&2
    failed=1
  fi
  if ! grep -qE 'field-value-equal=true' "$target"; then
    echo "FAIL: e41-3-policy -- accepted run's field-value equality line missing/false in $target" >&2
    failed=1
  fi
  if ! sed -n '/## Run refused/,$p' "$target" | grep -qE 'PVFILL\|entry=(silent|interactive) stage=matcher status=refused'; then
    echo "FAIL: e41-3-policy -- refused run's matcher-refusal branch line missing under the PVFILL| marker in $target" >&2
    failed=1
  fi
  if ! grep -qE 'field-still-original=true' "$target"; then
    echo "FAIL: e41-3-policy -- refused run's field-still-original assertion missing/false in $target" >&2
    failed=1
  fi
  if ! grep -qE 'DR-41-B' "ios/IOS-SPIKE-LOG.md" || ! grep -q "e41-3-matching-matrix.md" "ios/IOS-SPIKE-LOG.md"; then
    echo "FAIL: e41-3-policy -- ios/IOS-SPIKE-LOG.md does not carry a DR-41-B heading citing ios/evidence/41/e41-3-matching-matrix.md by path" >&2
    failed=1
  fi

  # The load-bearing differential check: extract each run's OWN terminal branch line (accepted =
  # "stage=fill status=ok"; refused = "stage=matcher status=refused") and require they differ.
  local accepted_section refused_section accepted_terminal refused_terminal
  accepted_section=$(sed -n '/## Run accepted/,/## Run refused/p' "$target")
  refused_section=$(sed -n '/## Run refused/,$p' "$target")
  accepted_terminal=$(printf '%s\n' "$accepted_section" | grep -oE 'stage=(fill status=ok|matcher status=refused)' | tail -1 || true)
  refused_terminal=$(printf '%s\n' "$refused_section" | grep -oE 'stage=(fill status=ok|matcher status=refused)' | tail -1 || true)
  if [ -z "$accepted_terminal" ] || [ -z "$refused_terminal" ]; then
    echo "FAIL: e41-3-policy -- could not extract a terminal branch line from one or both runs in $target" >&2
    failed=1
  elif [ "$accepted_terminal" = "$refused_terminal" ]; then
    echo "FAIL: e41-3-policy -- the two runs' terminal branch lines are IDENTICAL ($accepted_terminal) -- the matcher is not wired (or not differentiating), and every other assertion here would still pass without it" >&2
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

# =============================================================================
# e41-6-encoding -- the host-writes-then-extension-reads encoding proof (Task 1, 41-06)
# =============================================================================
#
# Six write/read digest pairs (encKey.nonce, encKey.ciphertext, encData.nonce,
# encData.ciphertext, itemId, revision) PLUS two named-rejection proofs (wrong encoding, missing
# revision) -- see `CacheEncodingProbe.swift` (host)/`CipherCacheReader.logEncodingProofDigests()`
# (extension) for the write/read halves. Drives the SAME `AutoFillInvocationUITests` primary route
# e41-1 uses (host launch -> Settings AutoFill toggle -> `prepareInterfaceForExtensionConfiguration()`)
# -- the one entry point that reaches BOTH the host-side seed (`PV_PROBE_FILLTRACER`) and the
# extension-side read probe (`PV_PROBE_CACHE_ENCODING`) in one ordered run.
E41_6_ENCODING_LOG="$EVIDENCE_DIR/e41-6-encoding.log"

cmd_e41_6_encoding() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_6_encoding "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-6-encoding: pinned simulator UDID: $udid"

  echo "==> e41-6-encoding: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> e41-6-encoding: building app+extension (PV_PROBE_FILLTRACER PV_PROBE_CACHE_ENCODING)"
  build_with_l10_retry "$udid" "PV_PROBE_FILLTRACER PV_PROBE_CACHE_ENCODING" /tmp/pv-e41-6-encoding-build.log
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"

  local run_start
  run_start=$(date '+%Y-%m-%d %H:%M:%S')

  run_e41_6_encoding_test() {
    xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
      -scheme PasskeyVault -configuration Debug \
      -destination "platform=iOS Simulator,id=$udid" \
      -derivedDataPath "$DD_PATH" \
      -only-testing:PasskeyVaultUITests/AutoFillInvocationUITests/testInvokeExtensionConfigurationViaSettingsAutoFillToggle \
      -skip-testing:PasskeyVaultTests \
      -parallel-testing-enabled NO \
      -maximum-concurrent-test-simulator-destinations 1 \
      SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_FILLTRACER PV_PROBE_CACHE_ENCODING" \
      test
  }
  local MAX_ATTEMPTS=5 ATTEMPT=1 TEST_LOG
  TEST_LOG=$(mktemp)
  while ! run_e41_6_encoding_test > "$TEST_LOG" 2>&1; do
    if [ "$ATTEMPT" -ge "$MAX_ATTEMPTS" ]; then
      echo "ERROR: e41-6-encoding drive failed after $ATTEMPT attempts" >&2
      tail -150 "$TEST_LOG" >&2
      rm -f "$TEST_LOG"
      exit 1
    fi
    if grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope' "$TEST_LOG"; then
      echo "==> HIT landmine L-10 -- retrying (attempt $((ATTEMPT + 1))/$MAX_ATTEMPTS)"
    else
      echo "ERROR: e41-6-encoding drive failed (not a known flake signature)" >&2
      tail -150 "$TEST_LOG" >&2
      rm -f "$TEST_LOG"
      exit 1
    fi
    ATTEMPT=$((ATTEMPT + 1))
  done
  rm -f "$TEST_LOG"

  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run_start" \
    > "$E41_6_ENCODING_LOG" 2>&1

  if assert_e41_6_encoding "$E41_6_ENCODING_LOG"; then
    echo "PASS: e41-6-encoding -- see $E41_6_ENCODING_LOG"
    exit 0
  else
    echo "FAIL: e41-6-encoding -- see $E41_6_ENCODING_LOG" >&2
    exit 1
  fi
}

# Fails, naming what is missing/mismatched, on: a missing/unreadable/empty file; any of the six
# write/read digest field pairs absent or unequal; the wrong-encoding rejection reporting
# `unexpected-success` (or absent entirely); the missing-revision rejection reporting the same; OR
# a raw plaintext leak (T-41-01) -- searches the capture for the known tracer plaintext and fails
# if found (this subcommand's own build never decrypts anything, so this should never fire; it is
# a backstop, not the primary mechanism).
E41_6_ENCODING_FIELDS="encKey.nonce encKey.ciphertext encData.nonce encData.ciphertext itemId revision"

assert_e41_6_encoding() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-6-encoding"; then
    return 1
  fi
  local failed=0
  local field write_digest read_digest
  for field in $E41_6_ENCODING_FIELDS; do
    write_digest=$(grep -E "PVFILL\|E41-6\|stage=write-digest field=${field} " "$target" | grep -oE 'digest=[0-9a-f]+' | tail -1 | cut -d= -f2 || true)
    read_digest=$(grep -E "PVFILL\|E41-6\|stage=read-digest field=${field} " "$target" | grep -oE 'digest=[0-9a-f]+' | tail -1 | cut -d= -f2 || true)
    if [ -z "$write_digest" ] || [ -z "$read_digest" ]; then
      echo "FAIL: e41-6-encoding -- missing write and/or read digest for field=$field in $target" >&2
      failed=1
    elif [ "$write_digest" != "$read_digest" ]; then
      echo "FAIL: e41-6-encoding -- digest mismatch for field=$field: write=$write_digest read=$read_digest in $target" >&2
      failed=1
    fi
  done

  if ! grep -qE 'PVFILL\|E41-6\|stage=wrong-encoding-rejection status=rejected' "$target"; then
    echo "FAIL: e41-6-encoding -- wrong-encoding-rejection did not report status=rejected in $target" >&2
    failed=1
  fi
  if grep -qE 'PVFILL\|E41-6\|stage=wrong-encoding-rejection status=unexpected-success' "$target"; then
    echo "FAIL: e41-6-encoding -- wrong-encoding-rejection reported unexpected-success (the decoder accepted the opposite encoding) in $target" >&2
    failed=1
  fi

  if ! grep -qE 'PVFILL\|E41-6\|stage=missing-revision-rejection status=rejected' "$target"; then
    echo "FAIL: e41-6-encoding -- missing-revision-rejection did not report status=rejected in $target" >&2
    failed=1
  fi
  if grep -qE 'PVFILL\|E41-6\|stage=missing-revision-rejection status=unexpected-success' "$target"; then
    echo "FAIL: e41-6-encoding -- missing-revision-rejection reported unexpected-success in $target" >&2
    failed=1
  fi

  if grep -q "Tr4c3r-Fill-41-03!" "$target"; then
    echo "FAIL: e41-6-encoding -- capture contains the tracer plaintext password (T-41-01)" >&2
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

# =============================================================================
# e41-6 -- cold, offline, cache-only fill (Task 2, 41-06, FILL-05)
# =============================================================================
#
# Full sequence: build once; seed the tracer item via a plain `xcrun simctl launch` (NEVER an
# XCUITest launch -- this happens BEFORE the shutdown this task's own cold definition pivots on,
# so it is not the prohibited "host app launched after boot"); make pv-server provably
# unreachable (stop it, curl against its default port, record the command + exit code); `simctl
# shutdown` + `boot`; re-enroll biometry (does not survive the cycle -- L-3x, this session);
# read-only-check the provider is still elected (NEVER re-toggle it here -- that would need a host
# app launch); drive `AutoFillColdOfflineUITests` (no host-app launch anywhere in its own code) via
# Safari; capture the extension pid observed strictly after the boot timestamp. Then two more
# structural falsifications: a live second cold cycle with the cached record deleted (expect
# FAIL), and a live server-UP check (expect the unreachability assertion to report FAIL) -- plus
# three evidence-mutation falsifications (missing pid line, injected post-boot host-launch line,
# flipped field-value-equal) proving `assert_e41_6` itself can fail.
E41_6_LOG="$EVIDENCE_DIR/e41-6-cold-offline.log"
E41_6_COLD_TEST_ID="PasskeyVaultUITests/AutoFillColdOfflineUITests/testColdOfflineFillFromCacheOnly"
E41_6_TRACER_ITEM_ID="tracer-item-41-03"
PV_SERVER_DEFAULT_PORT=8620
PV_SERVER_HEALTH_URL="http://127.0.0.1:${PV_SERVER_DEFAULT_PORT}/healthz"

stop_pv_server_if_running() {
  local pids
  pids=$(lsof -tiTCP:"${PV_SERVER_DEFAULT_PORT}" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "==> e41-6: stopping pv-server process(es) on :${PV_SERVER_DEFAULT_PORT}: $pids" >&2
    kill $pids >/dev/null 2>&1 || true
    sleep 1
  fi
}

# Records ONE command + its exit code + interpretation into $2 (appended). Returns curl's OWN
# exit code -- 0 means the server answered (reachable), non-zero means it did not (unreachable,
# the expected outcome for this task's baseline).
record_server_unreachable_check() {
  local out_file="$1"
  local http_status curl_exit
  set +e
  http_status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 2 "$PV_SERVER_HEALTH_URL" 2>/dev/null)
  curl_exit=$?
  set -e
  echo "SERVER-UNREACHABLE-CHECK: command=\`curl -sS -o /dev/null -w '%{http_code}' --max-time 2 $PV_SERVER_HEALTH_URL\` http_status=${http_status:-000} exit_code=$curl_exit" >> "$out_file"
  if [ "$curl_exit" -eq 0 ]; then
    echo "SERVER-UNREACHABLE-CHECK-RESULT: FAIL (curl succeeded -- server is reachable)" >> "$out_file"
  else
    echo "SERVER-UNREACHABLE-CHECK-RESULT: PASS (curl failed as expected, exit=$curl_exit)" >> "$out_file"
  fi
  return "$curl_exit"
}

# Briefly starts the REAL pv-server binary (never modified -- HARD RULES) on the default port
# against a throwaway `mktemp -d` database (never data/pv.db, D-23's own discipline,
# `scripts/ios-live-server.sh`'s own precedent), for exactly long enough to demonstrate
# `record_server_unreachable_check`'s own assertion reporting FAIL when the server genuinely IS
# reachable -- the falsification leg for the offline claim (Pitfall 3).
run_server_up_falsification() {
  local out_file="$1"
  local server_bin="$REPO_ROOT/target/release/pv-server"
  if [ ! -x "$server_bin" ]; then
    server_bin="$REPO_ROOT/target/debug/pv-server"
  fi
  if [ ! -x "$server_bin" ]; then
    echo "SERVER-UP-FALSIFICATION: SKIPPED (no pv-server binary at target/release or target/debug)" >> "$out_file"
    return 0
  fi
  local db_dir server_pid
  db_dir=$(mktemp -d "${TMPDIR:-/tmp}/pv-e41-6-falsify.XXXXXX")
  PV_ADDR="127.0.0.1:${PV_SERVER_DEFAULT_PORT}" PV_DB_URL="sqlite://${db_dir}/pv.db?mode=rwc" RUST_LOG=warn \
    "$server_bin" > "${db_dir}/pv-server.log" 2>&1 &
  server_pid=$!
  local healthy=0 i
  for i in $(seq 1 30); do
    if curl -fsS "$PV_SERVER_HEALTH_URL" >/dev/null 2>&1; then
      healthy=1
      break
    fi
    sleep 0.3
  done
  if [ "$healthy" -ne 1 ]; then
    echo "SERVER-UP-FALSIFICATION: SKIPPED (pv-server did not become healthy in time)" >> "$out_file"
    kill "$server_pid" >/dev/null 2>&1 || true
    wait "$server_pid" 2>/dev/null || true
    rm -rf "$db_dir"
    return 0
  fi
  local falsify_result=0
  if record_server_unreachable_check "$out_file"; then
    # curl succeeded (exit 0) -- the EXPECTED outcome of this falsification (server genuinely up).
    falsify_result=0
  fi
  local last_line
  last_line=$(grep "^SERVER-UNREACHABLE-CHECK-RESULT:" "$out_file" | tail -1)
  kill "$server_pid" >/dev/null 2>&1 || true
  wait "$server_pid" 2>/dev/null || true
  rm -rf "$db_dir"
  if printf '%s' "$last_line" | grep -q "FAIL (curl succeeded"; then
    echo "SERVER-UP-FALSIFICATION: PASS (with the server genuinely UP, the unreachability check correctly reported FAIL)" >> "$out_file"
  else
    echo "SERVER-UP-FALSIFICATION: FAIL (with the server genuinely UP, the unreachability check did NOT report FAIL -- the check proves nothing)" >> "$out_file"
    return 1
  fi
  return 0
}

extension_pid_after() {
  local udid="$1" start="$2"
  xcrun simctl spawn "$udid" log show --style ndjson --start "$start" \
    --predicate 'processImagePath CONTAINS "PasskeyVaultAutoFill"' 2>/dev/null \
    | jq -r '.processID' 2>/dev/null | sort -un | tail -1
}

# Seeds the tracer item via a plain `xcrun simctl launch` -- NEVER an XCUITest launch, and NEVER
# after the shutdown this task pivots its whole cold definition on. Waits for
# `TracerFillSeeder`'s own completion marker (`tracer-seed-status.json`, App Group container)
# rather than a blind sleep.
seed_before_shutdown() {
  local udid="$1" group_dir="$2"
  rm -f "$group_dir/tracer-seed-status.json" "$group_dir/tracer-mutate-revision.marker" \
    "$group_dir/tracer-omit-revision.marker" "$group_dir/tracer-mismatch-stored-url.marker"
  xcrun simctl launch "$udid" cloud.blonie.PasskeyVault >/dev/null 2>&1 || true
  local waited=0
  while [ "$waited" -lt 20 ]; do
    if [ -f "$group_dir/tracer-seed-status.json" ] && grep -q '"status":"ok"' "$group_dir/tracer-seed-status.json"; then
      xcrun simctl terminate "$udid" cloud.blonie.PasskeyVault >/dev/null 2>&1 || true
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  xcrun simctl terminate "$udid" cloud.blonie.PasskeyVault >/dev/null 2>&1 || true
  return 1
}

run_e41_6_cold_test_once() {
  local udid="$1" out_log="$2"
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:"$E41_6_COLD_TEST_ID" \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS="\$(inherited) PV_PROBE_FILLTRACER" \
    test > "$out_log" 2>&1
}

drive_e41_6_cold_test() {
  local udid="$1" out_log="$2"
  local test_result=0
  run_e41_6_cold_test_once "$udid" "$out_log" &
  local test_pid=$!
  run_pearl_match_loop "$udid" &
  local match_pid=$!
  wait "$test_pid" || test_result=$?
  kill "$match_pid" >/dev/null 2>&1 || true
  wait "$match_pid" 2>/dev/null || true
  return "$test_result"
}

# One full "shutdown -> boot -> re-enroll -> drive" cycle, appended to $3. Returns the drive's own
# xcodebuild exit code (0 = fill succeeded).
run_one_cold_cycle() {
  local udid="$1" section_label="$2" out_file="$3"
  echo "" >> "$out_file"
  echo "## $section_label" >> "$out_file"
  local shutdown_ts boot_ts
  shutdown_ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "SHUTDOWN-TIMESTAMP: $shutdown_ts" >> "$out_file"
  xcrun simctl shutdown "$udid" >/dev/null 2>&1 || true
  xcrun simctl boot "$udid"
  xcrun simctl bootstatus "$udid" -b >/dev/null 2>&1 || true
  boot_ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "BOOT-TIMESTAMP: $boot_ts" >> "$out_file"
  sleep 2

  # L-3x (this session): passcode/biometry enrollment does not survive simctl shutdown+boot --
  # re-enroll via CLI, never the Simulator.app GUI menu (`cmd_tracer`'s own header: unreliable
  # headless).
  ensure_biometric_enrollment "$udid"

  # L-3x (this session, found live running this exact task): this task's own PRECONDITION --
  # "the AutoFill provider remains enabled in Settings across a simulator shutdown and boot" --
  # is FALSE on this simulator/toolchain. `pluginkit -m`'s registration entry (no `+`) SURVIVES
  # the cycle, but the user ELECTION state (the `+` prefix) does NOT: measured live, twice,
  # reproducibly. A cold Safari drive with the election unset never surfaces our suggestion at
  # all (the "Passwords" accessory sheet never gains a "PasskeyVault" row, confirmed live).
  # `pluginkit -e use -i <id>` is a CLI-only re-election -- `pluginkit` is a system tool, not our
  # app, so re-running it here is NOT the prohibited "host app launched after boot"; the
  # alternative (`AutoFillInvocationUITests`' Settings toggle) genuinely would launch the host
  # app and is never used here. Applied UNCONDITIONALLY (idempotent when already elected), then
  # verified read-only.
  xcrun simctl spawn "$udid" pluginkit -e use -i cloud.blonie.PasskeyVault.AutoFill >/dev/null 2>&1 || true
  if ! xcrun simctl spawn "$udid" pluginkit -m -p com.apple.authentication-services-credential-provider-ui 2>/dev/null | grep -q '^+'; then
    echo "PROVIDER-ELECTED-AFTER-BOOT: false" >> "$out_file"
    echo "FAIL: e41-6 -- AutoFill provider still not elected after cold boot even after \`pluginkit -e use\` (CLI-only re-election) -- see 41-06-SUMMARY.md's own landmine note" >&2
    return 90
  fi
  echo "PROVIDER-ELECTED-AFTER-BOOT: true (re-elected via \`pluginkit -e use -i cloud.blonie.PasskeyVault.AutoFill\` -- see landmine note, this election does NOT survive a simulator shutdown+boot on this toolchain)" >> "$out_file"

  local drive_log drive_result=0
  drive_log=$(mktemp)
  drive_e41_6_cold_test "$udid" "$drive_log" || drive_result=$?
  echo "COLD-DRIVE-XCODEBUILD-EXIT: $drive_result" >> "$out_file"
  grep 'PVUITEST|E41-6|' "$drive_log" >> "$out_file" || true
  rm -f "$drive_log"

  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$boot_ts" \
    >> "$out_file" 2>&1

  local ext_pid
  ext_pid=$(extension_pid_after "$udid" "$boot_ts")
  if [ -n "$ext_pid" ]; then
    echo "EXTENSION-PID-AFTER-BOOT: $ext_pid" >> "$out_file"
  else
    echo "EXTENSION-PID-AFTER-BOOT: none-observed" >> "$out_file"
  fi

  return "$drive_result"
}

cmd_e41_6() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_6 "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"
  ensure_tracer_server

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-6: pinned simulator UDID: $udid"

  echo "==> e41-6: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> e41-6: building app+extension (PV_PROBE_FILLTRACER)"
  build_with_l10_retry "$udid" "PV_PROBE_FILLTRACER" /tmp/pv-e41-6-build.log
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"

  ensure_provider_enabled "$udid"

  local group_dir
  group_dir=$(app_group_container_dir "$udid" || true)
  if [ -z "$group_dir" ]; then
    echo "ERROR: e41-6 -- App Group container not found" >&2
    exit 1
  fi

  : > "$E41_6_LOG"

  echo "## Pre-shutdown seed (baseline)" >> "$E41_6_LOG"
  if ! seed_before_shutdown "$udid" "$group_dir"; then
    echo "SEED-STATUS: fail" >> "$E41_6_LOG"
    cat "$group_dir/tracer-seed-status.json" 2>/dev/null >> "$E41_6_LOG" || echo "STATUS-MARKER-MISSING" >> "$E41_6_LOG"
    echo "FAIL: e41-6 -- pre-shutdown seed did not complete -- see $E41_6_LOG" >&2
    exit 1
  fi
  echo "SEED-STATUS: ok" >> "$E41_6_LOG"

  local expected_digest
  expected_digest=$(printf '%s' "Tr4c3r-Fill-41-03!" | shasum -a 256 | awk '{print $1}')
  echo "PRE-SHUTDOWN-PLAINTEXT-DIGEST: $expected_digest" >> "$E41_6_LOG"

  echo "" >> "$E41_6_LOG"
  echo "## Server-unreachable proof (baseline -- server DOWN, expected)" >> "$E41_6_LOG"
  stop_pv_server_if_running
  record_server_unreachable_check "$E41_6_LOG" || true

  local baseline_result=0
  run_one_cold_cycle "$udid" "Cold fill drive (baseline -- host app NEVER launched from this point on)" "$E41_6_LOG" || baseline_result=$?
  echo "BASELINE-COLD-CYCLE-RESULT: $baseline_result" >> "$E41_6_LOG"

  # --- Falsification 1 (live, aimed at the claim): delete the cached record for that item, ------
  # re-run the WHOLE cold sequence, and observe the fill fail with nothing to fill -- proving the
  # baseline fill above came from the cache and not from anywhere else.
  echo "" >> "$E41_6_LOG"
  echo "## Falsification 1 -- cached record deleted before the SAME cold sequence (expect nothing to fill)" >> "$E41_6_LOG"
  if ! seed_before_shutdown "$udid" "$group_dir"; then
    echo "FALSIFICATION-1: SKIPPED (reseed did not complete)" >> "$E41_6_LOG"
  else
    local cache_file="$group_dir/vault-cache-v1.json"
    if [ -f "$cache_file" ]; then
      local tmp_cache
      tmp_cache=$(mktemp)
      jq --arg id "$E41_6_TRACER_ITEM_ID" '.items |= map(select(.id != $id))' "$cache_file" > "$tmp_cache"
      mv "$tmp_cache" "$cache_file"
      echo "CACHE-RECORD-DELETED: $E41_6_TRACER_ITEM_ID" >> "$E41_6_LOG"
    else
      echo "FALSIFICATION-1: SKIPPED (cache file not found at $cache_file)" >> "$E41_6_LOG"
    fi
    local falsify1_result=0
    run_one_cold_cycle "$udid" "Cold fill drive (Falsification 1 -- cache record deleted)" "$E41_6_LOG" || falsify1_result=$?
    if [ "$falsify1_result" -ne 0 ]; then
      echo "FALSIFICATION-1 PASS: the fill correctly FAILED with the cached record deleted (drive exit $falsify1_result)" >> "$E41_6_LOG"
    else
      echo "FALSIFICATION-1 FAIL: the fill PASSED even with the cached record deleted -- the fill is not actually cache-sourced" >> "$E41_6_LOG"
    fi
  fi

  # --- Falsification 2 (live, cheap): the server genuinely UP must flip the unreachability check.
  echo "" >> "$E41_6_LOG"
  echo "## Falsification 2 -- server genuinely UP (expect the unreachability check to report FAIL)" >> "$E41_6_LOG"
  run_server_up_falsification "$E41_6_LOG" || true
  # Restore the baseline's own real proof as the LAST server-unreachable-check lines in the file
  # -- re-confirm the server is down again after the falsification above.
  stop_pv_server_if_running
  record_server_unreachable_check "$E41_6_LOG" || true

  if assert_e41_6 "$E41_6_LOG"; then
    echo "PASS: e41-6 -- see $E41_6_LOG"
    exit 0
  else
    echo "FAIL: e41-6 -- see $E41_6_LOG" >&2
    exit 1
  fi
}

# Fails, naming what is missing, on: a missing/unreadable/empty file; SHUTDOWN-TIMESTAMP or
# BOOT-TIMESTAMP absent; no EXTENSION-PID-AFTER-BOOT line (or it reports none-observed); no
# SERVER-UNREACHABLE-CHECK command+exit-code line, or the RESULT line does not read PASS; the
# provider not confirmed elected after boot; a `PVFILL|stage=seed` line anywhere in the capture
# (the host app was launched -- this task's own hard prohibition); no PVUITEST|E41-6| success line
# with field-value-equal=true; the cache-deletion falsification not reporting PASS; the
# server-up falsification not reporting PASS.
assert_e41_6() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-6"; then
    return 1
  fi
  local failed=0

  if ! grep -q "SHUTDOWN-TIMESTAMP:" "$target"; then
    echo "FAIL: e41-6 -- no SHUTDOWN-TIMESTAMP line in $target" >&2
    failed=1
  fi
  if ! grep -q "BOOT-TIMESTAMP:" "$target"; then
    echo "FAIL: e41-6 -- no BOOT-TIMESTAMP line in $target" >&2
    failed=1
  fi

  local pid_line
  pid_line=$(grep -E "^EXTENSION-PID-AFTER-BOOT: " "$target" | head -1 || true)
  if [ -z "$pid_line" ]; then
    echo "FAIL: e41-6 -- no EXTENSION-PID-AFTER-BOOT line in $target" >&2
    failed=1
  elif printf '%s' "$pid_line" | grep -q "none-observed"; then
    echo "FAIL: e41-6 -- EXTENSION-PID-AFTER-BOOT reports no pid observed in $target" >&2
    failed=1
  fi

  if ! grep -qE '^SERVER-UNREACHABLE-CHECK: command=' "$target"; then
    echo "FAIL: e41-6 -- no recorded server-unreachable command+exit-code line in $target" >&2
    failed=1
  fi
  if ! grep -qE '^SERVER-UNREACHABLE-CHECK-RESULT: PASS' "$target"; then
    echo "FAIL: e41-6 -- no SERVER-UNREACHABLE-CHECK-RESULT: PASS line in $target" >&2
    failed=1
  fi

  if ! grep -qE '^PROVIDER-ELECTED-AFTER-BOOT: true' "$target"; then
    echo "FAIL: e41-6 -- provider not confirmed elected after a cold boot in $target" >&2
    failed=1
  fi

  if grep -qE 'PVFILL\|stage=seed ' "$target"; then
    echo "FAIL: e41-6 -- capture contains a host-app seed line -- the host app was launched after a boot, voiding the cold claim (this task's own hard prohibition)" >&2
    failed=1
  fi

  if ! grep -qE 'PVUITEST\|E41-6\|status=ok identity-survived=true field-value-equal=true' "$target"; then
    echo "FAIL: e41-6 -- no PVUITEST|E41-6| success line with field-value-equal=true in $target" >&2
    failed=1
  fi

  if ! grep -q "FALSIFICATION-1 PASS" "$target"; then
    echo "FAIL: e41-6 -- cache-deletion falsification (Falsification 1) did not report PASS in $target" >&2
    failed=1
  fi

  if ! grep -q "SERVER-UP-FALSIFICATION: PASS" "$target"; then
    echo "FAIL: e41-6 -- server-up falsification (Falsification 2) did not report PASS in $target" >&2
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

# =============================================================================
# lock-build -- both targets build clean with deprecation warnings escalated to
# errors, LockMarkerTests' five predicate cases pass by name (Task 1, 41-07)
# =============================================================================
#
# `-Werror DeprecatedDeclaration` (this Swift toolchain's own per-diagnostic-group promotion,
# `swiftc -print-diagnostic-groups`/`-Werror <group>`, confirmed live this session -- NOT
# `SWIFT_TREAT_WARNINGS_AS_ERRORS=YES`, which would also fail the build on this repo's many
# PRE-EXISTING, out-of-scope main-actor-isolation/Swift-6-mode warnings, exactly the SCOPE
# BOUNDARY this project's own executor rules forbid auto-fixing) escalates ONLY deprecated-API
# usage to a build error -- F2's own concern (the identity-store/ViewController overload traps)
# made mechanically enforceable, not merely documented. Confirmed clean against this repo's
# CURRENT state before this task ever ran (no deprecated spelling anywhere in either target).
#
# Runs `PasskeyVaultTests/LockMarkerTests` (never a suite a later task creates) via `xcodebuild
# test`, which builds BOTH the host app target and the `PasskeyVaultAutoFill` extension target as
# a precondition (the extension is an "Embed Foundation Extensions" dependency of the host app
# target, confirmed live this session via `grep -c "target 'PasskeyVaultAutoFill'"` against a
# `PasskeyVaultTests`-only run) -- one `xcodebuild` invocation covers both targets' own build
# gate, never two separate builds.
LOCK_BUILD_LOG="$EVIDENCE_DIR/lock-build.log"
LOCK_MARKER_TEST_CASES=(
  "anInstantInsideTheIdleWindowIsUnlocked"
  "anInstantExactlyAtTheIdleBoundaryIsStillUnlocked"
  "anInstantOneSecondPastTheIdleBoundaryIsExpired"
  "aMarkerDatedInTheFutureIsNeverUnlocked"
  "aMarkerFromADifferentBootIsNeverValidRegardlessOfElapsedTime"
)

run_lock_build_once() {
  local udid="$1" out_log="$2"
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:PasskeyVaultTests/LockMarkerTests \
    -skip-testing:PasskeyVaultUITests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    OTHER_SWIFT_FLAGS='$(inherited) -Werror DeprecatedDeclaration' \
    test > "$out_log" 2>&1
}

assert_lock_build() {
  local target="$1"
  if ! require_nonempty_file "$target" "lock-build"; then
    return 1
  fi
  local failed=0

  if ! grep -qE '^XCODEBUILD-EXIT: 0$' "$target"; then
    echo "FAIL: lock-build -- recorded exit status is not zero in $target" >&2
    failed=1
  fi
  if ! grep -q '\*\* TEST SUCCEEDED \*\*' "$target"; then
    echo "FAIL: lock-build -- no '** TEST SUCCEEDED **' marker in $target" >&2
    failed=1
  fi
  if ! grep -q "target 'PasskeyVault'" "$target"; then
    echo "FAIL: lock-build -- no evidence the PasskeyVault (host) target was built in $target" >&2
    failed=1
  fi
  if ! grep -q "target 'PasskeyVaultAutoFill'" "$target"; then
    echo "FAIL: lock-build -- no evidence the PasskeyVaultAutoFill (extension) target was built in $target" >&2
    failed=1
  fi

  local case_name
  for case_name in "${LOCK_MARKER_TEST_CASES[@]}"; do
    if ! grep -qE "Test ${case_name}\(\) passed" "$target"; then
      echo "FAIL: lock-build -- no passed-result line for predicate case '$case_name' in $target" >&2
      failed=1
    fi
  done

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

cmd_lock_build() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_lock_build "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> lock-build: pinned simulator UDID: $udid"

  echo "==> lock-build: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  local raw_log result=0
  raw_log=$(mktemp)
  run_lock_build_once "$udid" "$raw_log" || result=$?
  if [ "$result" -ne 0 ] && grep -qE 'uniffiEnsurePvFfiInitialized|cannot find .* in scope' "$raw_log"; then
    echo "==> HIT landmine L-10 (cold DerivedData mismatch) -- retrying once" >&2
    result=0
    run_lock_build_once "$udid" "$raw_log" || result=$?
  fi

  : > "$LOCK_BUILD_LOG"
  echo "## lock-build -- both targets, -Werror DeprecatedDeclaration, LockMarkerTests" >> "$LOCK_BUILD_LOG"
  cat "$raw_log" >> "$LOCK_BUILD_LOG"
  echo "" >> "$LOCK_BUILD_LOG"
  echo "XCODEBUILD-EXIT: $result" >> "$LOCK_BUILD_LOG"
  rm -f "$raw_log"

  if assert_lock_build "$LOCK_BUILD_LOG"; then
    echo "PASS: lock-build -- see $LOCK_BUILD_LOG"
    exit 0
  else
    echo "FAIL: lock-build -- see $LOCK_BUILD_LOG" >&2
    exit 1
  fi
}

# =============================================================================
# e41-4 -- host unlocks (real ACC-04), extension fills; the check shown able to
# refuse when the marker is artificially expired (Task 2, 41-07)
# =============================================================================
#
# TWO test methods, not one shared method switched by an environment variable -- found live,
# this session: `TEST_RUNNER_<VAR>` (Xcode's documented env-var passthrough to the XCTest RUNNER
# process, distinct from `XCUIApplication.launchEnvironment`, which only reaches the LAUNCHED APP
# under test) did NOT actually reach `ProcessInfo.processInfo.environment` inside the test method
# on this toolchain -- confirmed by an isolated run that unconditionally took the unexpired branch
# regardless of the override. `AutoFillLockUITests.swift`'s own header records the same finding.
# Run 1 (`testE41_4_UnexpiredHostUnlockThenExtensionFillsSilently`) -- real biometric unlock, then
# an immediate silent fill. Run 2 (`testE41_4_ExpiredMarkerRefusesTheFill`) -- the IDENTICAL real
# unlock sequence, with `e41-lock-marker-offset.marker` set to a NEGATIVE offset
# (`AutoFillLockE41TestHook`, applied by the SAME real unlock's own production call site) --
# proving the lazy check can refuse, never a second, hand-written "locked" simulation.
E41_4_LOG="$EVIDENCE_DIR/e41-4-host-unlock-then-fill.log"
E41_4_UNEXPIRED_TEST_ID="PasskeyVaultUITests/AutoFillLockUITests/testE41_4_UnexpiredHostUnlockThenExtensionFillsSilently"
E41_4_EXPIRED_TEST_ID="PasskeyVaultUITests/AutoFillLockUITests/testE41_4_ExpiredMarkerRefusesTheFill"

run_e41_4_scenario() {
  local udid="$1" test_id="$2" out_log="$3"
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:"$test_id" \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS='$(inherited) PV_PROBE_E41_LOCK' \
    test > "$out_log" 2>&1
}

drive_e41_4_scenario() {
  local udid="$1" test_id="$2" out_log="$3"
  local result=0
  run_e41_4_scenario "$udid" "$test_id" "$out_log" &
  local test_pid=$!
  run_pearl_match_loop "$udid" &
  local match_pid=$!
  wait "$test_pid" || result=$?
  kill "$match_pid" >/dev/null 2>&1 || true
  wait "$match_pid" 2>/dev/null || true
  return "$result"
}

assert_e41_4() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-4"; then
    return 1
  fi
  local failed=0

  if ! grep -qE '^RUN1-XCODEBUILD-EXIT: 0$' "$target"; then
    echo "FAIL: e41-4 -- unexpired run's own test method did not exit 0 in $target" >&2
    failed=1
  fi
  if ! grep -qE '^RUN2-XCODEBUILD-EXIT: 0$' "$target"; then
    echo "FAIL: e41-4 -- expired run's own test method (asserting the field stays UNFILLED) did not exit 0 in $target" >&2
    failed=1
  fi

  local run1_section run2_section run1_kind run2_kind
  run1_section=$(awk '/^## Run 1/{f=1} f && /^## Run 2/{exit} f' "$target")
  run2_section=$(awk '/^## Run 2/{f=1} f' "$target")

  run1_kind=$(printf '%s\n' "$run1_section" | grep -oE 'entry=(silent|interactive) stage=(fill status=ok|lock-check status=locked)' | head -1)
  run2_kind=$(printf '%s\n' "$run2_section" | grep -oE 'entry=(silent|interactive) stage=(fill status=ok|lock-check status=locked)' | head -1)

  if [ -z "$run1_kind" ]; then
    echo "FAIL: e41-4 -- no branch line found for the unexpired run in $target" >&2
    failed=1
  fi
  if [ -z "$run2_kind" ]; then
    echo "FAIL: e41-4 -- no branch line found for the expired run in $target" >&2
    failed=1
  fi
  if [ -n "$run1_kind" ] && [ -n "$run2_kind" ] && [ "$run1_kind" = "$run2_kind" ]; then
    echo "FAIL: e41-4 -- both runs took the SAME branch ($run1_kind) -- the lazy check is not wired" >&2
    failed=1
  fi

  # WR-08 (41-REVIEW.md): `run2_kind` above classifies run 2 by its FIRST matching branch line
  # only -- a run 2 that refuses on the silent entry point and then FILLS on the interactive
  # fallback still yields `run2_kind = ...locked` (the first, silent-entry-point line), passes the
  # inequality test above, and this log-side assertion would report green even though a fill
  # actually happened somewhere in the expired run. This is the missing NEGATIVE assertion: scan
  # the WHOLE run-2 section (not just its first matching line) for ANY successful fill, on ANY
  # entry point.
  if printf '%s\n' "$run2_section" | grep -qE 'entry=(silent|interactive) stage=fill status=ok'; then
    echo "FAIL: e41-4 -- the EXPIRED run recorded a successful fill on some entry point" >&2
    failed=1
  fi

  if grep -qE 'stage=fill status=ok' "$target" && ! printf '%s\n' "$run1_kind" | grep -q 'stage=fill status=ok'; then
    echo "FAIL: e41-4 -- the unexpired run did not take the silent no-ceremony branch DR-41-A(b) predicts" >&2
    failed=1
  fi

  # T-41-12/T-41-15/T-41-38: no plaintext in the capture.
  if grep -q "E41-Lock-07-Fill!" "$target"; then
    echo "FAIL: e41-4 -- evidence capture contains the E41-4 plaintext password" >&2
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

cmd_e41_4() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_4 "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"
  ensure_tracer_server

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-4: pinned simulator UDID: $udid"

  echo "==> e41-4: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> e41-4: building app+extension (PV_PROBE_E41_LOCK)"
  build_with_l10_retry "$udid" "PV_PROBE_E41_LOCK" /tmp/pv-e41-4-build.log
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"

  ensure_provider_enabled "$udid"
  ensure_biometric_enrollment "$udid"

  local group_dir
  group_dir=$(app_group_container_dir "$udid" || true)
  if [ -z "$group_dir" ]; then
    echo "ERROR: e41-4 -- App Group container not found" >&2
    exit 1
  fi
  rm -f "$group_dir/e41-lock-marker-offset.marker"

  : > "$E41_4_LOG"

  # `--start "$ts"` per run, NEVER `--last Nm` -- a sliding lookback window was observed LIVE,
  # this session, to overlap between two runs started less than N minutes apart, contaminating
  # Run 2's own section with Run 1's leftover entries and making the branch-differentiation
  # assertion below pick up the WRONG (earlier) line. `run_one_cold_cycle`'s own established
  # `--start "$boot_ts"` precedent (cmd_e41_6) is the fix, applied here too.
  echo "## Run 1 -- unexpired (real biometric unlock, immediate silent fill)" >> "$E41_4_LOG"
  local run1_start run1_log run1_result=0
  run1_start=$(date '+%Y-%m-%d %H:%M:%S')
  run1_log=$(mktemp)
  drive_e41_4_scenario "$udid" "$E41_4_UNEXPIRED_TEST_ID" "$run1_log" || run1_result=$?
  echo "RUN1-XCODEBUILD-EXIT: $run1_result" >> "$E41_4_LOG"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run1_start" >> "$E41_4_LOG" 2>&1
  echo "" >> "$E41_4_LOG"
  rm -f "$run1_log"

  echo "## Run 2 -- artificially expired (marker offset -10800s, applied by the same real unlock)" >> "$E41_4_LOG"
  echo "-10800" > "$group_dir/e41-lock-marker-offset.marker"
  local run2_start run2_log run2_result=0
  run2_start=$(date '+%Y-%m-%d %H:%M:%S')
  run2_log=$(mktemp)
  drive_e41_4_scenario "$udid" "$E41_4_EXPIRED_TEST_ID" "$run2_log" || run2_result=$?
  echo "RUN2-XCODEBUILD-EXIT: $run2_result" >> "$E41_4_LOG"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run2_start" >> "$E41_4_LOG" 2>&1
  rm -f "$group_dir/e41-lock-marker-offset.marker" "$run2_log"

  if assert_e41_4 "$E41_4_LOG"; then
    echo "PASS: e41-4 -- see $E41_4_LOG"
    exit 0
  else
    echo "FAIL: e41-4 -- see $E41_4_LOG" >&2
    exit 1
  fi
}

# =============================================================================
# e41-7 -- extension-only activity keeps the session alive (ACC-07), expiry
# deletes the real Secret C and a fresh unlock recreates it (ACC-06), a
# backward-clock model does not resurrect an expired session (Task 3, 41-07)
# =============================================================================
E41_7_LOG="$EVIDENCE_DIR/e41-7-lock.log"
E41_7_ACC07_TEST_ID="PasskeyVaultUITests/AutoFillLockUITests/testE41_7_ACC07_ExtensionOnlyActivityKeepsHostSessionAlive"
E41_7_ACC06_TEST_ID="PasskeyVaultUITests/AutoFillLockUITests/testE41_7_ACC06_ExpiryDeletesRealKeychainEntryAndFreshUnlockRecreatesIt"
E41_7_BACKWARD_TEST_ID="PasskeyVaultUITests/AutoFillLockUITests/testE41_7_BackwardClockDoesNotResurrectAnExpiredSession"

run_e41_7_test() {
  local udid="$1" test_id="$2" out_log="$3"
  xcodebuild -project ios/PasskeyVault/PasskeyVault.xcodeproj \
    -scheme PasskeyVault -configuration Debug \
    -destination "platform=iOS Simulator,id=$udid" \
    -derivedDataPath "$DD_PATH" \
    -only-testing:"$test_id" \
    -skip-testing:PasskeyVaultTests \
    -parallel-testing-enabled NO \
    -maximum-concurrent-test-simulator-destinations 1 \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS='$(inherited) PV_PROBE_E41_LOCK' \
    test > "$out_log" 2>&1
}

drive_e41_7_test() {
  local udid="$1" test_id="$2" out_log="$3"
  local result=0
  run_e41_7_test "$udid" "$test_id" "$out_log" &
  local test_pid=$!
  run_pearl_match_loop "$udid" &
  local match_pid=$!
  wait "$test_pid" || result=$?
  kill "$match_pid" >/dev/null 2>&1 || true
  wait "$match_pid" 2>/dev/null || true
  return "$result"
}

assert_e41_7() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-7"; then
    return 1
  fi
  local failed=0

  local acc07_section acc06_section backward_section
  acc07_section=$(awk '/^## ACC-07/{f=1} f && /^## ACC-06/{exit} f' "$target")
  acc06_section=$(awk '/^## ACC-06/{f=1} f && /^## Backward/{exit} f' "$target")
  backward_section=$(awk '/^## Backward/{f=1} f' "$target")

  if ! printf '%s\n' "$acc07_section" | grep -qE '^ACC07-XCODEBUILD-EXIT: 0$'; then
    echo "FAIL: e41-7 -- ACC-07 leg's own test method did not exit 0 in $target" >&2
    failed=1
  fi
  if ! printf '%s\n' "$acc07_section" | grep -q 'PVLOCK|'; then
    echo "FAIL: e41-7 -- ACC-07 leg's marker line is missing in $target" >&2
    failed=1
  fi
  if ! printf '%s\n' "$acc07_section" | grep -q 'stage=host-launch-read writer=extension'; then
    echo "FAIL: e41-7 -- ACC-07 leg's host-launch-read never showed writer=extension (receiver-side match) in $target" >&2
    failed=1
  fi

  if ! printf '%s\n' "$acc06_section" | grep -qE '^ACC06-XCODEBUILD-EXIT: 0$'; then
    echo "FAIL: e41-7 -- ACC-06 leg's own test method did not exit 0 in $target" >&2
    failed=1
  fi
  if ! printf '%s\n' "$acc06_section" | grep -q 'stage=sessionkey-delete'; then
    echo "FAIL: e41-7 -- ACC-06 leg's explicit delete log line is missing in $target" >&2
    failed=1
  fi
  if ! printf '%s\n' "$acc06_section" | grep -qE 'stage=lock-check status=locked'; then
    echo "FAIL: e41-7 -- ACC-06 leg never observed the interaction-required branch in $target" >&2
    failed=1
  fi
  if ! printf '%s\n' "$acc06_section" | grep -qE 'entry=(silent|interactive) stage=fill status=ok'; then
    echo "FAIL: e41-7 -- ACC-06 leg's fresh-unlock recreate did not observe a successful fill in $target" >&2
    failed=1
  fi

  if ! printf '%s\n' "$backward_section" | grep -qE '^BACKWARD-XCODEBUILD-EXIT: 0$'; then
    echo "FAIL: e41-7 -- backward-clock leg's own test method did not exit 0 in $target" >&2
    failed=1
  fi
  if ! printf '%s\n' "$backward_section" | grep -q 'PVLOCK|'; then
    echo "FAIL: e41-7 -- backward-clock leg's marker line is missing in $target" >&2
    failed=1
  fi
  if ! printf '%s\n' "$backward_section" | grep -qE 'stage=lock-check status=locked'; then
    echo "FAIL: e41-7 -- backward-clock leg did not record a still-expired session in $target" >&2
    failed=1
  fi

  if grep -q "E41-Lock-07-Fill!" "$target"; then
    echo "FAIL: e41-7 -- evidence capture contains the E41-7 plaintext password" >&2
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

cmd_e41_7() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_7 "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"
  ensure_tracer_server

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-7: pinned simulator UDID: $udid"

  echo "==> e41-7: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> e41-7: building app+extension (PV_PROBE_E41_LOCK)"
  build_with_l10_retry "$udid" "PV_PROBE_E41_LOCK" /tmp/pv-e41-7-build.log
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"

  ensure_provider_enabled "$udid"
  ensure_biometric_enrollment "$udid"

  local group_dir
  group_dir=$(app_group_container_dir "$udid" || true)
  if [ -z "$group_dir" ]; then
    echo "ERROR: e41-7 -- App Group container not found" >&2
    exit 1
  fi
  rm -f "$group_dir/e41-lock-marker-offset.marker"

  : > "$E41_7_LOG"

  # `--start "$ts"` per leg, NEVER `--last Nm` -- see e41-4's own note on the live overlap this
  # caused (a sliding lookback window contaminating a later section with an earlier leg's lines).
  echo "## ACC-07 -- extension-only activity keeps the host session alive" >> "$E41_7_LOG"
  local acc07_start acc07_log acc07_result=0
  acc07_start=$(date '+%Y-%m-%d %H:%M:%S')
  acc07_log=$(mktemp)
  drive_e41_7_test "$udid" "$E41_7_ACC07_TEST_ID" "$acc07_log" || acc07_result=$?
  echo "ACC07-XCODEBUILD-EXIT: $acc07_result" >> "$E41_7_LOG"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$acc07_start" >> "$E41_7_LOG" 2>&1
  echo "" >> "$E41_7_LOG"
  rm -f "$acc07_log"

  echo "## ACC-06 -- expiry deletes the real Keychain entry; fresh unlock recreates it (also this task's forward-clock leg: real elapsed time causing real expiry)" >> "$E41_7_LOG"
  local acc06_start acc06_log acc06_result=0
  acc06_start=$(date '+%Y-%m-%d %H:%M:%S')
  acc06_log=$(mktemp)
  drive_e41_7_test "$udid" "$E41_7_ACC06_TEST_ID" "$acc06_log" || acc06_result=$?
  echo "ACC06-XCODEBUILD-EXIT: $acc06_result" >> "$E41_7_LOG"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$acc06_start" >> "$E41_7_LOG" 2>&1
  echo "" >> "$E41_7_LOG"
  rm -f "$acc06_log"

  echo "## Backward-clock -- a future-dated marker (the rewound-clock model, see AutoFillLockE41TestHook.swift) must not resurrect a session" >> "$E41_7_LOG"
  echo "3600" > "$group_dir/e41-lock-marker-offset.marker"
  local backward_start backward_log backward_result=0
  backward_start=$(date '+%Y-%m-%d %H:%M:%S')
  backward_log=$(mktemp)
  drive_e41_7_test "$udid" "$E41_7_BACKWARD_TEST_ID" "$backward_log" || backward_result=$?
  echo "BACKWARD-XCODEBUILD-EXIT: $backward_result" >> "$E41_7_LOG"
  xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$backward_start" >> "$E41_7_LOG" 2>&1
  rm -f "$group_dir/e41-lock-marker-offset.marker" "$backward_log"

  if assert_e41_7 "$E41_7_LOG"; then
    echo "PASS: e41-7 -- see $E41_7_LOG"
    exit 0
  else
    echo "FAIL: e41-7 -- see $E41_7_LOG" >&2
    exit 1
  fi
}

# =============================================================================
# e41-8 -- FILL-04 demonstration: a password filled on a third-party domain, entitlement dump
# captured as CONTEXT ONLY, never the proof (Task 1, 41-08)
# =============================================================================
E41_8_LOG="$EVIDENCE_DIR/e41-8-thirdparty.log"
E41_8_WWW_DIR="/tmp/pv-e418-www"
# CORRECTED live, this session: the original host (a fresh `.localhost` subdomain) never
# propagated to QuickType across 4 retried attempts -- isolated to E41-3's own unresolved
# Falsification-3 finding (`ios/evidence/41/e41-3-matching-matrix.md`). `127.0.0.1` is the SAME
# host `TracerFillSeeder.seed()`'s own tracer item already uses (single-item, `IdentityStoreSync`
# incremental registration), proven reliable across every prior plan in this phase. See
# `AutoFillThirdPartyDomainUITests.swift`'s own header for the full reasoning, including why a
# loopback address still satisfies "no site-association file could exist."
E41_8_HOST="127.0.0.1"
E41_8_PORT=8770

# Binding the server to 127.0.0.1 (HTTP only, matching the tracer's own `ensure_tracer_server`
# shape, never `ensure_e41_3_servers`'s HTTPS leg, which this test does not need).
ensure_e41_8_server() {
  mkdir -p "$E41_8_WWW_DIR"
  cat > "$E41_8_WWW_DIR/index.html" <<'HTML'
<!DOCTYPE html>
<html>
<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
<form>
<input id="u" type="text" name="username" autocomplete="username"
  oninput="document.getElementById('ru').innerText='USERFIELD:'+this.value"
  onchange="document.getElementById('ru').innerText='USERFIELD:'+this.value">
<input id="p" type="password" name="password" autocomplete="current-password"
  oninput="document.getElementById('rp').innerText='PWFIELD:'+this.value"
  onchange="document.getElementById('rp').innerText='PWFIELD:'+this.value">
</form>
<div id="ru">USERFIELD:-none-</div>
<div id="rp">PWFIELD:-none-</div>
</body>
</html>
HTML
  if ! curl -s -o /dev/null "http://127.0.0.1:$E41_8_PORT/" 2>/dev/null; then
    echo "==> starting E41-8 third-party-domain login-form server on 127.0.0.1:$E41_8_PORT (reachable as http://$E41_8_HOST:$E41_8_PORT/)" >&2
    (cd "$E41_8_WWW_DIR" && nohup python3 -m http.server "$E41_8_PORT" --bind 127.0.0.1 > /tmp/pv-e418-http.log 2>&1 &)
    sleep 1
  fi
}

run_e41_8_test_once() {
  local udid="$1" out_log="$2"
  run_test_once_generic "$udid" \
    "PasskeyVaultUITests/AutoFillThirdPartyDomainUITests/testFillsPasswordOnThirdPartyDomainWithoutAssociatedDomains" \
    "PV_PROBE_E41_8" "$out_log"
}

# Same parallel-pearl-match-loop discipline as `drive_test_with_pearl_match`: tapping "Fill
# Password" triggers Safari's own, separate LocalAuthentication confirmation gate, which never
# clears without a `notifyutil` poster running for the whole drive.
drive_e41_8_test() {
  local udid="$1" out_log="$2"
  local test_result=0
  run_e41_8_test_once "$udid" "$out_log" &
  local test_pid=$!
  run_pearl_match_loop "$udid" &
  local match_pid=$!
  wait "$test_pid" || test_result=$?
  kill "$match_pid" >/dev/null 2>&1 || true
  wait "$match_pid" 2>/dev/null || true
  return "$test_result"
}

cmd_e41_8() {
  if [ "${1:-}" = "--assert-only" ]; then
    if [ -z "${2:-}" ]; then
      echo "ERROR: --assert-only requires a <path> argument" >&2
      exit 1
    fi
    if assert_e41_8 "$2"; then exit 0; else exit 1; fi
  fi

  mkdir -p "$EVIDENCE_DIR"
  ensure_e41_8_server

  local udid
  udid=$(resolve_pinned_udid)
  echo "==> e41-8: pinned simulator UDID: $udid"

  echo "==> e41-8: building pv-ffi (plain variant)"
  "$REPO_ROOT/scripts/build-ios.sh"

  echo "==> e41-8: building app+extension (PV_PROBE_E41_8)"
  build_with_l10_retry "$udid" "PV_PROBE_E41_8" /tmp/pv-e41-8-build.log
  xcrun simctl install "$udid" "$PV_APP_PRODUCT"

  ensure_provider_enabled "$udid"
  ensure_biometric_enrollment "$udid"

  : > "$E41_8_LOG"
  echo "## Positive proof -- password filled on a third-party domain (${E41_8_HOST}:${E41_8_PORT})" >> "$E41_8_LOG"
  local fill_log fill_result=0 run_start
  fill_log=$(mktemp)
  run_start=$(date '+%Y-%m-%d %H:%M:%S')
  drive_e41_8_test "$udid" "$fill_log" || fill_result=$?
  grep 'PVUITEST|E41-8|' "$fill_log" >> "$E41_8_LOG" || true
  echo "XCODEBUILD-EXIT: $fill_result" >> "$E41_8_LOG"
  rm -f "$fill_log"

  # WINDOWS.md #18: prepareCredentialList (the 'list' entry point) SessionLifecycle gate was never
  # observed firing live in any prior Phase-41 plan. This run's own driving code includes a
  # fallback path that taps the "Passwords" keyboard accessory (opening the system's own
  # credential-list sheet, which invokes `prepareCredentialList(for:)`) whenever the direct
  # single-suggestion sheet does not appear immediately -- so IF that fallback fired on any of
  # this run's retry attempts, the extension's own `PVLOCK|entry=list stage=lazy-check` log line
  # (`SessionLifecycle.checkAndExpireIfNeeded(entryPoint: "list", ...)`,
  # `CredentialProviderViewController.prepareCredentialList`) will be present in the captured
  # window below. Recorded honestly either way -- present closes #18; absent leaves it open,
  # exactly as this plan's own instructions require.
  echo "" >> "$E41_8_LOG"
  echo "## WINDOWS #18 check -- did prepareCredentialList (the 'list' entry point) fire live during this run?" >> "$E41_8_LOG"
  local extension_log
  extension_log=$(xcrun simctl spawn "$udid" log show \
    --predicate 'subsystem == "cloud.blonie.PasskeyVault" AND category == "fill"' --start "$run_start" 2>&1 || true)
  if echo "$extension_log" | grep -q 'PVLOCK|entry=list stage=lazy-check'; then
    echo "$extension_log" | grep 'PVLOCK|entry=list stage=lazy-check' >> "$E41_8_LOG"
    echo "WINDOWS-18: OBSERVED LIVE -- prepareCredentialList's SessionLifecycle gate fired during this run" >> "$E41_8_LOG"
  else
    echo "WINDOWS-18: NOT observed in this run -- the 'Passwords' accessory fallback path was not exercised (a direct single-suggestion sheet appeared instead, or nothing was offered); #18 remains open" >> "$E41_8_LOG"
  fi

  echo "" >> "$E41_8_LOG"
  echo "## Entitlement dump -- CONTEXT ONLY, never the proof (QA-03; the field-value-equal line above is the load-bearing proof)" >> "$E41_8_LOG"
  echo "### App: $PV_APP_PRODUCT/PasskeyVault" >> "$E41_8_LOG"
  python3 "$REPO_ROOT/scripts/sim-entitlements.py" "$PV_APP_PRODUCT/PasskeyVault" >> "$E41_8_LOG" 2>&1 \
    || echo "(app entitlement dump failed/absent -- see output above)" >> "$E41_8_LOG"
  echo "" >> "$E41_8_LOG"
  echo "### Extension: $PV_APPEX_PRODUCT/PasskeyVaultAutoFill" >> "$E41_8_LOG"
  python3 "$REPO_ROOT/scripts/sim-entitlements.py" "$PV_APPEX_PRODUCT/PasskeyVaultAutoFill" >> "$E41_8_LOG" 2>&1 \
    || echo "(extension entitlement dump failed/absent -- see output above)" >> "$E41_8_LOG"

  echo "" >> "$E41_8_LOG"
  echo "## Entitlement-dump-tool falsifier -- sim-entitlements.py against a binary with no entitlements section" >> "$E41_8_LOG"
  local falsifier_out falsifier_exit=0
  falsifier_out=$(python3 "$REPO_ROOT/scripts/sim-entitlements.py" /bin/ls 2>&1) || falsifier_exit=$?
  echo "$falsifier_out" >> "$E41_8_LOG"
  echo "FALSIFIER-EXIT: $falsifier_exit (expect 2)" >> "$E41_8_LOG"

  if assert_e41_8 "$E41_8_LOG"; then
    echo "PASS: e41-8 -- see $E41_8_LOG"
    exit 0
  else
    echo "FAIL: e41-8 -- see $E41_8_LOG" >&2
    exit 1
  fi
}

# Asserts on the CAPTURED FILE, never a pipeline's exit status (landmine L-3).
assert_e41_8() {
  local target="$1"
  if ! require_nonempty_file "$target" "e41-8"; then
    return 1
  fi
  local failed=0

  if ! grep -qE 'field-value-equal=true' "$target"; then
    echo "FAIL: e41-8 -- no field-value-equal=true line found in $target" >&2
    failed=1
  fi
  if ! grep -q "CONTEXT ONLY" "$target"; then
    echo "FAIL: e41-8 -- entitlement dump section is not explicitly labelled CONTEXT ONLY in $target" >&2
    failed=1
  fi
  if ! grep -q "### App:" "$target" || ! grep -q "### Extension:" "$target"; then
    echo "FAIL: e41-8 -- missing app or extension entitlement dump section header in $target" >&2
    failed=1
  fi
  if ! grep -qE '<\?xml|<plist' "$target"; then
    echo "FAIL: e41-8 -- no entitlements plist content found in $target" >&2
    failed=1
  fi
  if ! grep -qE 'FALSIFIER-EXIT: 2 ' "$target"; then
    echo "FAIL: e41-8 -- entitlement-dump-tool falsifier did not record exit 2 in $target" >&2
    failed=1
  fi
  # T-41-12/T-41-15: the evidence capture must never contain the plaintext password.
  if grep -q "E418-3rdParty-NoAD!" "$target"; then
    echo "FAIL: e41-8 -- evidence capture contains the plaintext third-party-domain password" >&2
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    return 1
  fi
  return 0
}

# =============================================================================
# gates -- runs BOTH Task 2/Task 3 structural gates together (Task 3, 41-08)
# =============================================================================
cmd_gates() {
  mkdir -p "$EVIDENCE_DIR"
  local failed=0

  echo "==> gates: audit-ios-autofill-deprecated-apis.sh"
  if bash "$REPO_ROOT/scripts/audit-ios-autofill-deprecated-apis.sh"; then
    echo "gates: deprecated-API gate PASS"
  else
    echo "gates: deprecated-API gate FAIL" >&2
    failed=1
  fi

  echo "==> gates: audit-ios-identity-store-chokepoint.sh"
  if bash "$REPO_ROOT/scripts/audit-ios-identity-store-chokepoint.sh"; then
    echo "gates: choke-point gate PASS"
  else
    echo "gates: choke-point gate FAIL" >&2
    failed=1
  fi

  if [ "$failed" -ne 0 ]; then
    echo "FAIL: gates -- at least one structural gate failed" >&2
    exit 1
  fi
  echo "PASS: gates -- both structural gates exit 0"
  exit 0
}

case "${1:-}" in
  branch-state) shift; cmd_branch_state "$@" ;;
  e41-1) shift; cmd_e41_1 "$@" ;;
  tracer)
    shift
    if [ "${1:-}" = "--assert-only" ]; then
      if [ -z "${2:-}" ]; then
        echo "ERROR: --assert-only requires a <path> argument" >&2
        exit 1
      fi
      if assert_tracer "$2"; then exit 0; else exit 1; fi
    fi
    cmd_tracer
    ;;
  e41-5)
    shift
    if [ "${1:-}" = "--assert-only" ]; then
      if [ -z "${2:-}" ]; then
        echo "ERROR: --assert-only requires a <path> argument" >&2
        exit 1
      fi
      if assert_e41_5 "$2"; then exit 0; else exit 1; fi
    fi
    cmd_e41_5
    ;;
  e41-2-build) shift; cmd_e41_2_build "$@" ;;
  e41-2) shift; cmd_e41_2 "$@" ;;
  e41-3) shift; cmd_e41_3 "$@" ;;
  e41-3-policy) shift; cmd_e41_3_policy "$@" ;;
  e41-6-encoding) shift; cmd_e41_6_encoding "$@" ;;
  e41-6) shift; cmd_e41_6 "$@" ;;
  lock-build) shift; cmd_lock_build "$@" ;;
  e41-4) shift; cmd_e41_4 "$@" ;;
  e41-7) shift; cmd_e41_7 "$@" ;;
  e41-8) shift; cmd_e41_8 "$@" ;;
  gates) shift; cmd_gates "$@" ;;
  *) usage ;;
esac
