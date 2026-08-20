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
  echo "Usage: $0 {branch-state|e41-1|tracer|e41-5|e41-2-build|e41-2} [--assert-only <path>]" >&2
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
  *) usage ;;
esac
