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
  echo "Usage: $0 {branch-state|e41-1} [--assert-only <path>]" >&2
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

case "${1:-}" in
  branch-state) shift; cmd_branch_state "$@" ;;
  e41-1) shift; cmd_e41_1 "$@" ;;
  *) usage ;;
esac
