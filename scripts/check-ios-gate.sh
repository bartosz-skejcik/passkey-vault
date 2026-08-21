#!/usr/bin/env bash
# scripts/check-ios-gate.sh -- Phase 42's CI surrogate: a composer with a
# named sub-gate dispatch table. Later plans in this phase add sub-gates by
# adding a `gate_<name>` function and appending to GATES below; nothing about
# this composition frame should need rewriting.
#
# This script IS the milestone's CI surrogate, not a placeholder for one: a
# real macOS CI runner is explicitly out of scope for this milestone (ROADMAP
# Phase 42's own "Ograniczenie dowodu" -- "audyt statyczny + uruchamialne
# skrypty na symulatorze/lokalnej maszynie; nie zastępuje realnego CI
# runnera").
#
# Two landmines this file is written to never reproduce:
#   - The bash-only post-pipe exit-status array. This project's interactive
#     shell is zsh, where that array is spelled `$pipestatus` and the
#     bash-only spelling is silently empty (landmine L-3,
#     ios/IOS-SPIKE-LOG.md Sec 3). Every pipeline below either relies on
#     `set -o pipefail` propagation or avoids piping into a status check
#     entirely (capture to a variable, then test the variable).
#   - An empty result read as a pass. Every absence assertion in this file is
#     paired with a positive control over the identical command shape, run
#     BEFORE the absence check, so a misspelled pathspec, a wrong range, or a
#     detached HEAD can never be read as a pass (Pitfall 1, 42-RESEARCH.md).
#
# ROADMAP SC4's literal wording (`git log --all --full-history -- .planning/`
# returns an empty list) is unachievable -- `--all` sweeps `main`/
# `origin/main` directly and this branch inherits main's entire `.planning/`
# history from the fork point (866 commits, observed). QA-05 holds in
# substance, scoped to this branch's own commit range, and THAT is what
# `gate_qa05` below proves: this worktree has never committed planning
# documents of its own.
#
# SECOND restatement, discovered executing this plan (2026-08-20), NOT
# anticipated by 42-RESEARCH.md: plan 40-01's `1e0958a merge(40-01): bring
# ios/spike current with main -- E-F0` (2026-08-19) merged 91 of main's own
# commits into this branch to pick up server-side migrations, 36 of which
# touch `.planning/` (phase-30/31 web-extension planning docs, legitimately
# committed on `main` where `commit_docs: true`). Because `git log
# FORK..HEAD` walks every commit reachable from HEAD but not from FORK
# regardless of which parent edge of a merge it arrived by, those 36 commits
# make the PLAN'S ORIGINAL scoped query (`git log --oneline FORK..HEAD --
# .planning/`) non-empty TODAY, even though this worktree itself authored
# none of them. The FORK literal stays pinned exactly as originally chosen --
# only the query gains two clauses:
#   `git log --oneline --no-merges "$FORK"..HEAD --not <exclude-ref> -- .planning/`
# `--not <exclude-ref>` (resolved to `origin/main`, falling back to the local
# `main` ref, never silently skipped -- see resolve_qa05_exclusion_ref)
# removes every commit already reachable from main, i.e. everything that
# arrived via legitimate reconciliation rather than being authored here.
# `--no-merges` removes the reconciliation merge commit itself: its tree
# differs from its first parent under `.planning/` purely because it pulled
# main's own content, not because ios/spike originated anything under that
# path, and this is verified once by `falsify_qa05`'s F1 proof, which also
# confirms the exclusion does NOT swallow a genuine branch-authored
# `.planning/` commit (a dangling, unpushed commit is by construction on
# neither exclude-ref, and is not a merge). The true claim asserted by
# `gate_qa05` is therefore: "no `.planning/` commit was ever AUTHORED on
# `ios/spike` itself" -- commits that arrive from `main` via reconciliation
# are main's own, governed by main's own `commit_docs: true`, not by this
# worktree's `commit_docs: false`. This restatement survives every future
# main->ios/spike sync merge with no re-pinning, unlike a FORK bump would.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# One scratch root for the whole script, removed by a single EXIT trap
# (mirrors scripts/build-ios.sh's SCRATCH_ROOT idiom, including its own
# lesson: a per-function `trap ... RETURN` re-fires for the caller too).
GATE_SCRATCH_ROOT=$(mktemp -d)
trap 'rm -rf "$GATE_SCRATCH_ROOT"' EXIT

# FORK is a PINNED LITERAL, never recomputed via `git merge-base` at run
# time: once `main` merges this branch (or this branch rebases), the
# merge-base moves and the range silently narrows to nothing -- a gate that
# stops being able to fail without anyone touching it.
FORK=6bbee654a1a591970e7c6db4d7c933d580061b07

# --- gate_qa05: the QA-05 history check -------------------------------

# Resolves the ref whose ancestry is "main's own commits", used to exclude
# reconciliation-merge-inherited commits from the QA-05 range (see the
# SECOND restatement note above). Prefers `origin/main` (the shared source of
# truth); falls back to the local `main` ref if the remote-tracking ref is
# absent. If NEITHER exists, the gate cannot establish which commits are
# main's own -- that is a FAIL, never a silent "assume nothing to exclude"
# that would let genuinely foreign commits slip through unexcluded and
# falsely fail, or worse, let the exclusion silently become a no-op.
resolve_qa05_exclusion_ref() {
  if git rev-parse --verify --quiet origin/main >/dev/null 2>&1; then
    echo origin/main
    return 0
  fi
  if git rev-parse --verify --quiet refs/heads/main >/dev/null 2>&1; then
    echo main
    return 0
  fi
  return 1
}

# The QA-05 command shape, single-sourced so the gate and its falsification
# proof can never drift apart. $1 = range end (HEAD, or a synthesized commit
# sha for falsification), $2 = pathspec. Reads the global QA05_EXCLUDE_REF,
# which callers must set (via resolve_qa05_exclusion_ref) before calling.
qa05_query() {
  local range_end="$1" pathspec="$2"
  git log --oneline --no-merges "$FORK".."$range_end" --not "$QA05_EXCLUDE_REF" -- "$pathspec"
}

gate_qa05() {
  # QA05_CONTROL_PATH is overridable only so falsify_qa05's F2 proof can
  # deliberately break the positive control's pathspec -- every real run
  # uses the default.
  local control_path="${QA05_CONTROL_PATH:-ios/}"

  if ! QA05_EXCLUDE_REF=$(resolve_qa05_exclusion_ref); then
    echo "FAIL[qa05]: could not resolve a .planning/ exclusion ref -- neither origin/main nor the local refs/heads/main exists, so the gate cannot establish which commits are main's own and refuses to report PASS on an unestablished exclusion set" >&2
    return 1
  fi

  # 1. Positive control FIRST. If this is empty, the query shape itself is
  #    broken (wrong range, wrong pathspec, detached HEAD, exclusion ref
  #    swallowing everything) and the .planning/ result below means nothing.
  #
  #    E5 discipline (this file's own header): gate_qa05 runs as the direct
  #    target of `if ! "gate_$g"` in run_gates, and bash disables `set -e`
  #    for a function's ENTIRE body when it is invoked that way (verified
  #    empirically writing this plan -- `false` mid-function did not abort
  #    under `if ! f; then`). A genuine `git log` error here would therefore
  #    NOT abort the script; it would produce empty output that is
  #    indistinguishable from "legitimately no commits found" unless the
  #    exit status is checked explicitly -- exactly the empty-read-as-pass
  #    trap this whole phase exists to police, this time one level removed
  #    (an ERROR silently read as an EMPTY RESULT silently read as a PASS).
  #    So every qa05_query call below checks its own exit status before
  #    testing emptiness of its output.
  local ctl ctl_status
  ctl=$(qa05_query HEAD "$control_path") && ctl_status=0 || ctl_status=$?
  if [ "$ctl_status" -ne 0 ]; then
    echo "FAIL[qa05]: the positive-control query itself errored (git log exit=$ctl_status) -- treating an error as a broken query shape, never as an empty result" >&2
    return 1
  fi
  if [ -z "$ctl" ]; then
    echo "FAIL[qa05]: positive control empty (query shape against -- $control_path, --no-merges, excluding \$QA05_EXCLUDE_REF=$QA05_EXCLUDE_REF, returned nothing) -- the .planning/ result would mean nothing, so this run stops here" >&2
    return 1
  fi
  local ctl_count
  ctl_count=$(printf '%s\n' "$ctl" | wc -l | tr -d ' ')

  # 2. The absence assertion. Same exit-status discipline as (1): a
  #    genuinely errored query must never be read as "found nothing".
  local bad bad_status
  bad=$(qa05_query HEAD .planning/) && bad_status=0 || bad_status=$?
  if [ "$bad_status" -ne 0 ]; then
    echo "FAIL[qa05]: the absence-assertion query itself errored (git log exit=$bad_status) -- treating an error as a broken query, never as a clean result" >&2
    return 1
  fi
  if [ -n "$bad" ]; then
    echo "FAIL[qa05]: commit(s) touching .planning/ found in ${FORK}..HEAD, not already on \$QA05_EXCLUDE_REF=$QA05_EXCLUDE_REF (i.e. authored on this branch itself, not inherited via reconciliation):" >&2
    echo "$bad" >&2
    return 1
  fi

  # 3. The precondition, asserted positively (QA-03): assert commit_docs IS
  #    false, not merely that nothing looked wrong. config.json is itself
  #    one of the tracked-and-modified planning files -- a revert would
  #    silently disarm the preventive layer plan 42-02 installs.
  if ! grep -q '"commit_docs": false' .planning/config.json; then
    echo "FAIL[qa05]: .planning/config.json does not positively state commit_docs: false" >&2
    return 1
  fi

  echo "PASS[qa05]: zero .planning/ commits authored on this branch itself since $FORK (excluding \$QA05_EXCLUDE_REF=$QA05_EXCLUDE_REF; positive control: $ctl_count commit(s) found under -- $control_path; commit_docs precondition holds)"
}

# --- gate_qa05 falsification --------------------------------------------
#
# Proves the FAIL branches of gate_qa05 are genuinely reachable, WITHOUT
# touching any ref, branch, worktree or index in either worktree -- only
# dangling git objects (F1) and read-only re-invocations of gate_qa05 itself
# with a deliberately-broken input (F2). No `git commit` + `git reset` on the
# real branch: this worktree is not isolated from a live parallel `main`
# session, and a real commit (even one immediately reset, never --hard) would
# move this branch's ref during the window between the two commands -- the
# exact class of shared-state mutation the plan's own threat model (T-42-04)
# and prohibitions forbid. F1 below already proves the identical claim (a
# .planning/ commit "authored on the branch" turns the gate red) via a
# dangling commit-tree object instead, which is a STRICTLY STRONGER proof:
# it exercises the real query against a real commit object with zero
# shared-state mutation.
falsify_qa05() {
  echo "==> --verify-falsifiable: qa05"

  echo "--- F1: the absence assertion's FAIL branch is reachable, without any ref/branch/worktree/index mutation ---"
  local scratch_git_index="$GATE_SCRATCH_ROOT/qa05-falsify-index"
  local marker_path=".planning/.gate-falsify-marker"
  local synth
  synth=$(
    export GIT_INDEX_FILE="$scratch_git_index"
    git read-tree HEAD
    blob_sha=$(printf 'gate falsification marker -- dangling object only, never referenced by any ref\n' | git hash-object -w -t blob --stdin)
    git update-index --add --cacheinfo 100644 "$blob_sha" "$marker_path"
    tree_sha=$(git write-tree)
    git commit-tree "$tree_sha" -p HEAD -m "TEMP gate-falsification marker (dangling, never referenced by any ref)"
  )
  echo "    synthesized dangling commit: $synth (touches $marker_path, parent HEAD)"

  if ! QA05_EXCLUDE_REF=$(resolve_qa05_exclusion_ref); then
    echo "ERROR: cannot resolve exclusion ref for falsification" >&2
    exit 1
  fi

  local synth_query
  synth_query=$(qa05_query "$synth" .planning/)
  if [ -z "$synth_query" ]; then
    echo "ERROR: F1 falsification FAILED -- the synthesized commit genuinely touches .planning/ but the assertion query returned empty; the absence assertion cannot fail and is therefore worthless" >&2
    exit 1
  fi
  echo "    query against the synthesized commit (non-empty, as required):"
  echo "$synth_query" | sed 's/^/      /'
  echo "==> PASS: F1 -- the absence assertion's FAIL branch is reachable, and the --not \$QA05_EXCLUDE_REF exclusion does not swallow a genuine branch-authored .planning/ commit (a dangling, unpushed commit is on neither origin/main nor local main by construction, and it is not a merge)"

  echo
  echo "--- F2: the positive control genuinely aborts on a broken query shape, rather than reporting PASS ---"
  local f2_output f2_exit
  set +e
  f2_output=$(QA05_CONTROL_PATH="ios-path-that-does-not-exist-on-this-branch/" gate_qa05 2>&1)
  f2_exit=$?
  set -e
  if [ "$f2_exit" -eq 0 ]; then
    echo "ERROR: F2 falsification FAILED -- gate_qa05 with a deliberately broken control path exited 0; the positive control cannot fail and is therefore worthless" >&2
    echo "$f2_output" >&2
    exit 1
  fi
  if ! echo "$f2_output" | grep -q "positive control"; then
    echo "ERROR: F2 falsification FAILED -- gate_qa05 exited non-zero (exit=$f2_exit) but did not name the positive control as the reason" >&2
    echo "$f2_output" >&2
    exit 1
  fi
  echo "    gate_qa05 with a broken control path (\"ios-path-that-does-not-exist-on-this-branch/\") exited $f2_exit and named the positive control failure:"
  echo "$f2_output" | sed 's/^/      /'
  echo "==> PASS: F2 -- the positive-control abort branch is genuinely reachable"

  echo
  echo "==> qa05 falsification: BOTH proofs passed (F1 absence-assertion reachability, F2 positive-control abort) -- zero refs/branches/worktrees/index entries touched in either worktree"
}

# --- gate_ffi_build / gate_ffi_falsifiable / gate_ffi_opaque -----------
# 42-03: composes the two shell gates Phase 35 already built --
# scripts/build-ios.sh (plain, and its own --verify-falsifiable mode), and
# scripts/audit-ffi-opaque-handles.sh -- by INVOKING them, never by
# reimplementing their logic (the slice-check and the opaque-handle scan
# each stay in exactly one place). The one structural hole this composer
# closes by construction, that neither existing script closes on its own
# (35-REVIEW.md WR-05): scripts/audit-ffi-opaque-handles.sh audits whatever
# generated bindings an EARLIER build happened to leave on disk -- ios/**/
# build/ is gitignored, so adding a raw-byte accessor to the FFI source and
# running the audit without rebuilding prints PASS over stale bindings.
# gate_ffi_opaque below asserts, POSITIVELY, that no source under
# crates/pv-ffi/src/ is newer than the generated bindings BEFORE consulting
# the audit's verdict, rather than only checking that some bindings file
# happens to exist.
#
# Every path below is overridable via an environment variable, exactly
# mirroring gate_qa05's own QA05_CONTROL_PATH idiom -- so this composer's own
# --verify-falsifiable mode can drive each sub-gate's FAIL path against a
# deliberately-wrong path with ZERO mutation of any real script, build
# artifact, or source file. Every real invocation (no override set) uses the
# default.
FFI_BUILD_SCRIPT_DEFAULT="scripts/build-ios.sh"
FFI_XCFRAMEWORK_DEFAULT="ios/PasskeyVault/build/PvFfi.xcframework"
FFI_BINDINGS_DIR_DEFAULT="ios/PasskeyVault/build/swift-bindings"
FFI_AUDIT_SCRIPT_DEFAULT="scripts/audit-ffi-opaque-handles.sh"

# gate_ffi_build -- invokes scripts/build-ios.sh (no args): builds both real
# iOS triples, generates Swift bindings, assembles the XCFramework, and runs
# that script's OWN slice gate. A missing/unreadable script is exit 1 naming
# it, never a skip (per this file's own header discipline and
# audit-ffi-opaque-handles.sh's "WARN and skip is NOT an option" precedent).
gate_ffi_build() {
  local script="${FFI_BUILD_SCRIPT:-$FFI_BUILD_SCRIPT_DEFAULT}"

  if [ ! -f "$script" ] || [ ! -r "$script" ]; then
    echo "FAIL[ffi_build]: $script not found or not readable -- cannot run the pv-ffi build" >&2
    return 1
  fi

  if ! bash "$script"; then
    echo "FAIL[ffi_build]: $script exited non-zero -- see its own output above" >&2
    return 1
  fi
  echo "PASS[ffi_build]: $script completed (both triples built, Swift bindings generated, XCFramework assembled, its own slice gate ran)"
}

# gate_ffi_falsifiable -- invokes scripts/build-ios.sh --verify-falsifiable,
# which does NOT rebuild (that script's own header) and requires the
# XCFramework already on disk from a prior plain invocation. That ordering
# dependency is encoded explicitly here rather than assumed from GATES list
# order or caller discipline: a caller running `--only ffi_falsifiable`
# alone (no prior ffi_build in the same invocation) gets a named FAIL up
# front, not a confusing failure from deep inside build-ios.sh.
gate_ffi_falsifiable() {
  local script="${FFI_BUILD_SCRIPT:-$FFI_BUILD_SCRIPT_DEFAULT}"
  local xcframework="${XCFRAMEWORK_PATH:-$FFI_XCFRAMEWORK_DEFAULT}"

  if [ ! -f "$script" ] || [ ! -r "$script" ]; then
    echo "FAIL[ffi_falsifiable]: $script not found or not readable -- cannot run its --verify-falsifiable mode" >&2
    return 1
  fi

  if [ ! -d "$xcframework" ]; then
    echo "FAIL[ffi_falsifiable]: $xcframework not found -- $script --verify-falsifiable does not rebuild; the ffi_build sub-gate (a plain '$script' run) must run first in this invocation" >&2
    return 1
  fi

  if ! bash "$script" --verify-falsifiable; then
    echo "FAIL[ffi_falsifiable]: $script --verify-falsifiable exited non-zero -- see its own output above" >&2
    return 1
  fi
  echo "PASS[ffi_falsifiable]: $script --verify-falsifiable proved both slice-gate halves (device+simulator) and the WR-03 pv-ffi-object guard can genuinely fail"
}

# gate_ffi_opaque -- two steps, in order:
#   1. The freshness precondition (WR-05), asserted POSITIVELY: the
#      generated Swift bindings file must exist and be non-empty, AND no
#      *.rs under crates/pv-ffi/src/ may be newer than it. `find ... -print
#      -quit` throughout, never `find ... | head` (this file's own header,
#      Two landmines section -- the SIGPIPE reason is scripts/build-ios.sh's
#      own extract_pv_ffi_object comment).
#   2. scripts/audit-ffi-opaque-handles.sh itself, only once (1) holds.
#
# E5 discipline (mirrors gate_qa05's own comment on this): this function
# runs as the direct target of `if ! "gate_$g"` in run_gates, and bash
# disables `set -e` for a function's ENTIRE body when invoked that way -- so
# every `find` here that could itself error (missing directory, etc.) must
# have its exit status checked explicitly, never inferred from whether its
# captured output happens to be empty. An errored freshness query read as
# "found nothing stale" would be exactly the empty-read-as-pass trap this
# whole phase exists to police.
gate_ffi_opaque() {
  local audit_script="${FFI_AUDIT_SCRIPT:-$FFI_AUDIT_SCRIPT_DEFAULT}"
  local bindings_dir="${BINDINGS_DIR_PATH:-$FFI_BINDINGS_DIR_DEFAULT}"

  if [ ! -f "$audit_script" ] || [ ! -r "$audit_script" ]; then
    echo "FAIL[ffi_opaque]: $audit_script not found or not readable -- cannot run the FFI-02 opaque-handle audit" >&2
    return 1
  fi

  local bindings_file bf_status
  bindings_file=$(find "$bindings_dir" -maxdepth 1 -name '*.swift' -print -quit 2>/dev/null) && bf_status=0 || bf_status=$?
  if [ "$bf_status" -ne 0 ] || [ -z "$bindings_file" ] || [ ! -s "$bindings_file" ]; then
    echo "FAIL[ffi_opaque]: no non-empty generated Swift bindings file found under $bindings_dir (find exit=$bf_status) -- run the ffi_build sub-gate (a plain '$FFI_BUILD_SCRIPT_DEFAULT' run) first" >&2
    return 1
  fi

  local stale stale_status
  stale=$(find crates/pv-ffi/src -name '*.rs' -newer "$bindings_file" -print -quit 2>/dev/null) && stale_status=0 || stale_status=$?
  if [ "$stale_status" -ne 0 ]; then
    echo "FAIL[ffi_opaque]: the freshness query itself errored (find exit=$stale_status) -- treating an error as a broken query, never as a fresh result" >&2
    return 1
  fi
  if [ -n "$stale" ]; then
    echo "FAIL[ffi_opaque]: $bindings_file is STALE -- $stale (under crates/pv-ffi/src/) is newer than the generated bindings, so the audit's verdict below would be about code that is no longer there. Re-run the ffi_build sub-gate to regenerate bindings, then re-run this sub-gate." >&2
    return 1
  fi
  echo "OK[ffi_opaque]: freshness precondition holds -- $bindings_file exists, is non-empty, and no source under crates/pv-ffi/src/ is newer than it"

  if ! bash "$audit_script"; then
    echo "FAIL[ffi_opaque]: $audit_script exited non-zero -- see its own output above" >&2
    return 1
  fi
  echo "PASS[ffi_opaque]: bindings provably fresh (see OK line above), and $audit_script reports zero raw-byte accessors outside its sanctioned exceptions"
}

# --- gate_ffi_* falsification -------------------------------------------
# Each proves its own FAIL path is genuinely reachable via the overridable
# path variables above -- ZERO mutation of any real script, build artifact,
# or source file (the same "no ref/branch/worktree/index mutation" standard
# falsify_qa05 already holds itself to, adapted to plain paths). Where a
# sub-gate delegates to an already-self-falsifying underlying mode
# (gate_ffi_falsifiable -> `scripts/build-ios.sh --verify-falsifiable`),
# this DELEGATES to that mode rather than duplicating its corruption logic.
# scripts/audit-ffi-opaque-handles.sh has no such built-in mode of its own --
# its own opaque-handle SCAN is proven falsifiable only by manual source
# mutation (this plan's Task 2, M3; recorded in 42-03-SUMMARY.md), and
# falsify_ffi_opaque says so explicitly rather than claiming coverage this
# fast mode does not have.
falsify_ffi_build() {
  echo "==> --verify-falsifiable: ffi_build"
  local out status
  set +e
  out=$(FFI_BUILD_SCRIPT="scripts/build-ios-does-not-exist.sh" gate_ffi_build 2>&1)
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "ERROR: ffi_build falsification FAILED -- gate_ffi_build with a deliberately missing script path exited 0" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! echo "$out" | grep -q "not found or not readable"; then
    echo "ERROR: ffi_build falsification FAILED -- exited non-zero (exit=$status) but did not name the missing-script guard" >&2
    echo "$out" >&2
    exit 1
  fi
  echo "    gate_ffi_build with a missing script path exited $status and named the missing-script guard:"
  echo "$out" | sed 's/^/      /'
  echo "==> PASS: ffi_build's missing-prerequisite FAIL path is reachable, zero mutation of the real script or any build artifact"
  echo "NOTE: ffi_build's other FAIL path (a genuine build error from a real compile) is not exercised by this fast mode -- corrupting a real cross-compile is expensive and out of scope here; it is proven manually as this plan's Task 2 M1a mutation (see 42-03-SUMMARY.md)."
}

falsify_ffi_falsifiable() {
  echo "==> --verify-falsifiable: ffi_falsifiable"

  echo "--- ordering-dependency FAIL path (zero mutation -- overridden path only) ---"
  local out status
  set +e
  out=$(XCFRAMEWORK_PATH="ios/PasskeyVault/build/PvFfi-does-not-exist.xcframework" gate_ffi_falsifiable 2>&1)
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "ERROR: ffi_falsifiable falsification FAILED -- gate_ffi_falsifiable with a deliberately absent XCFramework path exited 0" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! echo "$out" | grep -q "must run first"; then
    echo "ERROR: ffi_falsifiable falsification FAILED -- exited non-zero (exit=$status) but did not name the ordering dependency" >&2
    echo "$out" >&2
    exit 1
  fi
  echo "    gate_ffi_falsifiable with an absent XCFramework path exited $status and named the ordering dependency:"
  echo "$out" | sed 's/^/      /'
  echo "==> PASS: the ordering-dependency FAIL path is reachable, zero mutation of any real artifact"

  echo
  echo "--- delegated proof: the underlying slice gate's OWN self-falsification mode (not duplicated here) ---"
  local xcframework="${FFI_XCFRAMEWORK_DEFAULT}"
  if [ ! -d "$xcframework" ]; then
    echo "ERROR: cannot delegate -- $xcframework is absent; run the ffi_build sub-gate (a plain scripts/build-ios.sh) first" >&2
    exit 1
  fi
  bash scripts/build-ios.sh --verify-falsifiable
  echo "==> PASS: scripts/build-ios.sh --verify-falsifiable's own proof (both slice-gate halves + the WR-03 pv-ffi-object guard) delegated to, not reimplemented"
}

falsify_ffi_opaque() {
  echo "==> --verify-falsifiable: ffi_opaque"

  echo "--- missing-bindings FAIL path (zero mutation -- overridden path only) ---"
  local out status
  set +e
  out=$(BINDINGS_DIR_PATH="ios/PasskeyVault/build/swift-bindings-does-not-exist" gate_ffi_opaque 2>&1)
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "ERROR: ffi_opaque falsification FAILED -- gate_ffi_opaque with a deliberately absent bindings dir exited 0" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! echo "$out" | grep -q "no non-empty generated Swift bindings"; then
    echo "ERROR: ffi_opaque falsification FAILED -- exited non-zero (exit=$status) but did not name the missing-bindings guard" >&2
    echo "$out" >&2
    exit 1
  fi
  echo "    gate_ffi_opaque with an absent bindings dir exited $status and named the missing-bindings guard:"
  echo "$out" | sed 's/^/      /'
  echo "==> PASS: the missing-bindings FAIL path is reachable, zero mutation of any real artifact"

  echo
  echo "--- staleness FAIL path (a SCRATCH COPY of the real bindings file, dated 2000-01-01 -- zero mutation of the real bindings or of crates/pv-ffi/src/) ---"
  local real_bindings
  real_bindings=$(find "$FFI_BINDINGS_DIR_DEFAULT" -maxdepth 1 -name '*.swift' -print -quit)
  if [ -z "$real_bindings" ]; then
    echo "ERROR: cannot stage the staleness proof -- no real bindings file present under $FFI_BINDINGS_DIR_DEFAULT; run the ffi_build sub-gate first" >&2
    exit 1
  fi
  local scratch_stale_dir scratch_bindings
  scratch_stale_dir="$GATE_SCRATCH_ROOT/ffi-opaque-staleness"
  mkdir -p "$scratch_stale_dir"
  scratch_bindings="$scratch_stale_dir/$(basename "$real_bindings")"
  cp "$real_bindings" "$scratch_bindings"
  touch -t 200001010000 "$scratch_bindings"
  set +e
  out=$(BINDINGS_DIR_PATH="$scratch_stale_dir" gate_ffi_opaque 2>&1)
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    echo "ERROR: ffi_opaque falsification FAILED -- gate_ffi_opaque against an artificially stale (2000-01-01) bindings copy exited 0" >&2
    echo "$out" >&2
    exit 1
  fi
  if ! echo "$out" | grep -q "STALE"; then
    echo "ERROR: ffi_opaque falsification FAILED -- exited non-zero (exit=$status) but did not name staleness" >&2
    echo "$out" >&2
    exit 1
  fi
  echo "    gate_ffi_opaque against a scratch bindings copy dated 2000-01-01 exited $status and named staleness:"
  echo "$out" | sed 's/^/      /'
  echo "==> PASS: the freshness precondition's FAIL path is reachable, against a real (copied, never mutated in place) bindings file"

  echo
  echo "==> NOT proven falsifiable in THIS automated mode: scripts/audit-ffi-opaque-handles.sh's own opaque-handle scan (shapes A/B/C/D). That script has no --verify-falsifiable flag of its own -- its scan's falsifiability is demonstrated by manual source mutation (inject a raw-byte accessor into crates/pv-ffi/src/lib.rs, rebuild, re-audit, revert), recorded as this plan's Task 2 M3 in 42-03-SUMMARY.md, not by this fast composer-level mode. Do not read this invocation's PASS as covering that half."
}

# --- composer: sub-gate dispatch table ----------------------------------
# 42-01 supplied qa05. 42-03 appends the three FFI sub-gates above, in the
# order build -> falsifiable-slice-gate -> opaque-handle audit (each depends
# on the one before it having produced fresh artifacts). Later plans in this
# phase append further to GATES and add a matching
# gate_<name>/falsify_<name> pair; nothing about the frame below should need
# rewriting.
GATES=(qa05 ffi_build ffi_falsifiable ffi_opaque)

ONLY=""
VERIFY_FALSIFIABLE=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --only)
      ONLY="${2:-}"
      if [ -z "$ONLY" ]; then
        echo "ERROR: --only requires a sub-gate name argument" >&2
        exit 1
      fi
      shift 2
      ;;
    --verify-falsifiable)
      VERIFY_FALSIFIABLE=1
      shift
      ;;
    *)
      echo "ERROR: unknown argument '$1'" >&2
      exit 1
      ;;
  esac
done

# Resolve which sub-gates this invocation runs, directly at top level (never
# inside a process-substitution subshell): an `exit` inside `< <(...)` only
# terminates that background subshell, NOT the main script -- a real bug
# caught running this exact script's own `--only nosuchgate` case during
# Task 1 (the error printed, but the script then hit an unrelated "unbound
# variable" on an empty $to_run and STILL reported exit 0). An unknown
# --only name is a hard failure with the valid names listed, never a silent
# no-op that would report PASS having executed nothing.
TO_RUN=()
if [ -n "$ONLY" ]; then
  FOUND=0
  for g in "${GATES[@]}"; do
    [ "$g" = "$ONLY" ] && FOUND=1
  done
  if [ "$FOUND" -eq 0 ]; then
    echo "ERROR: unknown sub-gate '$ONLY' -- valid sub-gate names: ${GATES[*]}" >&2
    exit 1
  fi
  TO_RUN=("$ONLY")
else
  TO_RUN=("${GATES[@]}")
fi

run_gates() {
  local -a executed=()
  local g
  for g in "${TO_RUN[@]}"; do
    echo "==> running sub-gate: $g"
    if ! "gate_$g"; then
      echo "FAIL: sub-gate '$g' failed -- see message above" >&2
      exit 1
    fi
    executed+=("$g")
  done
  echo "==> SUMMARY: executed sub-gate(s): ${executed[*]}"
}

run_falsifications() {
  local g
  for g in "${TO_RUN[@]}"; do
    if ! declare -F "falsify_$g" >/dev/null; then
      echo "ERROR: no falsification defined for sub-gate '$g'" >&2
      exit 1
    fi
    "falsify_$g"
  done
  echo
  echo "==> --verify-falsifiable: ALL defined sub-gate falsification proofs passed (${TO_RUN[*]}) -- see each sub-gate's own output above for exactly what was, and was not, proven falsifiable in this fast mode"
}

if [ "$VERIFY_FALSIFIABLE" -eq 1 ]; then
  run_falsifications
  exit 0
fi

run_gates
exit 0
