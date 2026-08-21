# 42-05 — inventory + register: falsification transcripts

Recorded 2026-08-21. `bash --version`: GNU bash 3.2.57(1)-release (macOS stock, no associative
arrays -- see `scripts/qa-audit-inventory.sh`'s own header for the landmine this caused).
Audit-script baseline sha (this plan's own commit that last touched the three audit scripts):
`25d3a1cda079095c765c0184d23cf02701f4937f`.

## Task 1 — `scripts/qa-audit-inventory.sh`

### Baseline run (clean state)

```
$ bash scripts/qa-audit-inventory.sh; echo "inventory exit=$?"
...
=== qa-audit-inventory: control (Phase 35's four known guards) ===
found: 4/4
  FOUND: slice gate (scripts/build-ios.sh)
  FOUND: opaque-handle audit (scripts/audit-ffi-opaque-handles.sh)
  FOUND: byte-shape gate (FfiRoundTripTests.swift)
  FOUND: panic-catch proof (FfiPanicSafetyTests.swift)
CONTROL-PASS: all 4/4 of Phase 35's known guards found in .planning/phases/35-granica-ffi-rust-swift-i-szkielet/'s SUMMARY files -- the discovery mechanism is trustworthy
inventory exit=0
```

Machine-readable output (one line per discovered phase directory):

```
MACHINE|29|.planning/phases/29-a-real-settings-page-shell-migration/|6|6|OUT-OF-COVERAGE
MACHINE|30|.planning/phases/30-the-living-group-family-wide-sharing/|17|17|OUT-OF-COVERAGE
MACHINE|35|.planning/phases/35-granica-ffi-rust-swift-i-szkielet/|5|5|IN-COVERAGE
MACHINE|36|.planning/phases/36-bramka-wykonalno-ci-autofilla-entitlement-i-bud-et-pami-ci/|4|4|IN-COVERAGE
MACHINE|37|.planning/phases/37-konto-unlock-has-em-i-biometria/|5|5|IN-COVERAGE
MACHINE|38|.planning/phases/38-pe-ny-interfejs-vaulta/|13|13|IN-COVERAGE
MACHINE|39|.planning/phases/39-synchronizacja-i-cache-offline/|7|7|IN-COVERAGE
MACHINE|40|.planning/phases/40-rodzina-i-wsp-dzielenie-na-telefonie/|10|10|IN-COVERAGE
MACHINE|41|.planning/phases/41-autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami/|8|8|IN-COVERAGE
MACHINE|42|.planning/phases/42-standard-dowodu-bramka-qa-i-ci-dla-ios/|4|7|OUT-OF-COVERAGE
MACHINE|43|.planning/phases/43-warunkowe-passkeys-tylko-je-li-tanie/|0|5|OUT-OF-COVERAGE
```

Phase 42 correctly excluded (the auditing phase, own SUMMARYs in flight); Phase 43 correctly excluded
(conditional, `summaries=0` is a valid state); phases 29/30 correctly excluded (below the 35-41 bound,
a different milestone's phases -- never read for content).

### Anti-hardcode control

```
$ grep -v '^[[:space:]]*#' scripts/qa-audit-inventory.sh | grep -cE '\.planning/phases/(3[6-9]|4[01])-'
0
```

No phase 36-41 directory path is baked into an executable line.

### Falsification 1 — rename a Phase 35 guard script aside

```
$ mv scripts/audit-ffi-opaque-handles.sh scripts/audit-ffi-opaque-handles.sh.falsify-aside
$ bash scripts/qa-audit-inventory.sh; echo "exit=$?"
...
=== qa-audit-inventory: control (Phase 35's four known guards) ===
found: 3/4
  FOUND: slice gate (scripts/build-ios.sh)
  FOUND: byte-shape gate (FfiRoundTripTests.swift)
  FOUND: panic-catch proof (FfiPanicSafetyTests.swift)
  MISSING: opaque-handle audit (scripts/audit-ffi-opaque-handles.sh) (mentioned in Phase 35's SUMMARYs, but NOT FOUND on disk at scripts/audit-ffi-opaque-handles.sh)
CONTROL-FAIL: only 3/4 of Phase 35's known guards were found in .planning/phases/35-granica-ffi-rust-swift-i-szkielet/'s SUMMARY files -- the enumeration is broken, and no downstream 'no issues found in phase N' conclusion can be trusted (missing: opaque-handle audit (scripts/audit-ffi-opaque-handles.sh) (mentioned in Phase 35's SUMMARYs, but NOT FOUND on disk at scripts/audit-ffi-opaque-handles.sh))
exit=1
$ mv scripts/audit-ffi-opaque-handles.sh.falsify-aside scripts/audit-ffi-opaque-handles.sh
$ git status --porcelain -- scripts/audit-ffi-opaque-handles.sh
(empty -- restoration confirmed)
```

### Falsification 2 — a scratch `*-PLAN.md` with no matching SUMMARY

```
$ echo "scratch plan, no summary" > .planning/phases/38-pe-ny-interfejs-vaulta/38-99-PLAN.md
$ bash scripts/qa-audit-inventory.sh | grep "38-99-PLAN"; echo "exit=$?"
UNSUMMARIZED|38|.planning/phases/38-pe-ny-interfejs-vaulta/|.planning/phases/38-pe-ny-interfejs-vaulta/38-99-PLAN.md
exit=0
$ rm -f .planning/phases/38-pe-ny-interfejs-vaulta/38-99-PLAN.md
$ git status --porcelain -- .planning/phases/
(no trace of the scratch file -- it was untracked, created and deleted; restoration confirmed)
```

## Task 3 — `scripts/check-qa-audit-register.sh` / `gate_qa_register`

### R1 — by construction (the intended end-of-plan state)

```
$ bash scripts/check-ios-gate.sh --only qa_register; echo "register gate exit=$? (EXPECTED non-zero at end of this plan)"
==> running sub-gate: qa_register
OK[qa_register]: positive control holds -- 15 row(s) parsed across 7 phase section(s), Phase 35's section is among them
Excluded from coverage (printed on every run, never silently dropped):
  - phase 29 -- outside the audited range 35-41 (a different milestone phase)
  - phase 30 -- outside the audited range 35-41 (a different milestone phase)
  - phase 42 -- the phase PERFORMING this audit; its own SUMMARYs appear on disk while it is still executing, so requiring a section for phase 42 would be a criterion that can never pass
  - phase 43 -- CONDITIONAL in the ROADMAP and may legitimately end undone; an absent Phase 43 section is VALID, not a gap
FAIL[qa_register]: 6 IN-COVERAGE phase(s) with SUMMARY files lack a covered register section:
  - phase 36: register section found but carries ZERO rows (an empty stub is not coverage)
  - phase 37: register section found but carries ZERO rows (an empty stub is not coverage)
  - phase 38: register section found but carries ZERO rows (an empty stub is not coverage)
  - phase 39: register section found but carries ZERO rows (an empty stub is not coverage)
  - phase 40: register section found but carries ZERO rows (an empty stub is not coverage)
  - phase 41: register section found but carries ZERO rows (an empty stub is not coverage)
FAIL[qa_register]: scripts/check-qa-audit-register.sh exited non-zero -- see its own output above
FAIL: sub-gate 'qa_register' failed -- see message above
register gate exit=1 (EXPECTED non-zero at end of this plan)
```

Phase 42 is absent from the missing-rows list, as required; 42 and 43 are printed as excluded with
their own reasons.

### Full composed gate — RED, isolated to `qa_register`

```
$ bash scripts/check-ios-gate.sh; echo "full gate exit=$?"
==> running sub-gate: qa05
PASS[qa05]: ...
==> running sub-gate: ffi_build
PASS[ffi_build]: ...
==> running sub-gate: ffi_falsifiable
PASS[ffi_falsifiable]: ...
==> running sub-gate: ffi_opaque
PASS[ffi_opaque]: ...
==> running sub-gate: swift_tests
RETRY[swift_tests]: attempt 1 hit the L-41 bindings-transition build failure (xcodebuild exit 65) -- retrying once
PASS[swift_tests]: scheme 'PasskeyVault' present (E9 autocreated); xcodebuild test exit=0 (after 1 L-41 retry); executed-test count=5 (> 0, E8's zero-count trap did not fire); matched all required FFI identifiers: FfiRoundTripTests/fullRoundTripOnLiteralBytes() FfiRoundTripTests/embeddedNulByteSurvivesExportImportRoundTrip() FfiRoundTripTests/embeddedNulByteInNonceIsNotTruncated() FfiPanicSafetyTests/nonSentinelInputReturnsNormally() FfiPanicSafetyTests/sentinelInputThrowsCatchableDiscriminatedErrorAndHandleSurvives()
==> running sub-gate: qa_register
OK[qa_register]: positive control holds -- 15 row(s) parsed across 7 phase section(s), Phase 35's section is among them
...
FAIL: sub-gate 'qa_register' failed -- see message above
full gate exit=1
```

Four other sub-gates individually confirmed still green (`--only qa05`, and the FFI/Swift sub-gates
inside the full run above) -- the red is isolated to `qa_register` alone.

After every `xcodebuild test` invocation, parallel testing device clones purged and only the base
simulator confirmed booted:

```
$ xcrun simctl --set testing shutdown all; xcrun simctl --set testing delete all
$ xcrun simctl list devices booted
== Devices ==
-- iOS 26.5 --
    PV-iPhone16 (34992BB7-4982-4915-92C7-C7FC987802AF) (Booted)
```

### `--verify-falsifiable` — R2 and R3, scratch copies only

```
$ bash scripts/check-ios-gate.sh --only qa_register --verify-falsifiable; echo "exit=$? (EXPECTED 0)"
==> --verify-falsifiable: qa_register
--- R2: a broken reference makes the checker fail, quoting the row (scratch copy only) ---
    checker against a scratch copy with CR-01's ref broken to line 999999 exited 1, quoting the row:
      FAIL[qa_register]: phase 35 row's ref line 999999 exceeds crates/pv-ffi/src/lib.rs's length (1030 lines) -- row: | CR-01: ...
==> PASS: R2 -- the resolvability assertion's FAIL branch is reachable, zero mutation of the real register
    git diff --stat -- ios/QA-AUDIT-v1.0.md (must be empty):

--- R3: an empty/unparseable register aborts as could-not-parse, never a clean run (scratch file only) ---
    checker against an empty scratch file exited 1, naming the could-not-parse abort:
      FAIL[qa_register]: the register could not be parsed -- 0 row(s) found, Phase 35 section found=0. Its apparent cleanliness means nothing; refusing to report a verdict on an unparsed register.
==> PASS: R3 -- the positive-control parser-abort branch is reachable, zero mutation of the real register
    git diff --stat -- ios/QA-AUDIT-v1.0.md (must be empty):

==> qa_register falsification: BOTH proofs passed (R2 resolvability, R3 parser control) -- ios/QA-AUDIT-v1.0.md never mutated, only mktemp -d scratch copies
exit=0 (EXPECTED 0)
```

### Full `--verify-falsifiable` — coverage line names `qa_register`

```
$ bash scripts/check-ios-gate.sh --verify-falsifiable; echo "exit=$?"
==> --verify-falsifiable: qa05
...
==> --verify-falsifiable: ffi_build
...
==> --verify-falsifiable: ffi_falsifiable
...
==> --verify-falsifiable: ffi_opaque
...
==> --verify-falsifiable: swift_tests
...
==> --verify-falsifiable: qa_register
...
==> --verify-falsifiable: ALL defined sub-gate falsification proofs passed (qa05 ffi_build ffi_falsifiable ffi_opaque swift_tests qa_register) -- see each sub-gate's own output above for exactly what was, and was not, proven falsifiable in this fast mode
exit=0
```

`git diff --stat -- ios/QA-AUDIT-v1.0.md` empty afterward.

### The mode's own failure branch — a checker stubbed to always exit 0 must fail `--verify-falsifiable`

```
$ cat /tmp/qa-register-stub-demo/always-pass.sh
#!/usr/bin/env bash
echo "PASS[qa_register]: stub always passes (falsification-demo)"
exit 0

$ QA_REGISTER_CHECKER_SCRIPT=/tmp/qa-register-stub-demo/always-pass.sh \
    bash scripts/check-ios-gate.sh --only qa_register --verify-falsifiable
echo "exit=$? (EXPECTED non-zero: the stub always passes, so R2/R3 must catch it and fail the mode)"
==> --verify-falsifiable: qa_register
--- R2: a broken reference makes the checker fail, quoting the row (scratch copy only) ---
ERROR: qa_register R2 falsification FAILED -- the checker against a scratch copy with a broken ref exited 0; the resolvability assertion cannot fail and is therefore worthless
PASS[qa_register]: stub always passes (falsification-demo)
exit=1 (EXPECTED non-zero: the stub always passes, so R2/R3 must catch it and fail the mode)
```

The stub lived outside the repo (`/tmp/`) and was invoked only via the `QA_REGISTER_CHECKER_SCRIPT`
env-var override (the same overridable-path idiom every other `falsify_*` in `scripts/check-ios-
gate.sh` already uses) -- no repo file was mutated by this demonstration:

```
$ git diff --stat -- scripts/check-ios-gate.sh scripts/check-qa-audit-register.sh scripts/qa-audit-inventory.sh
(empty against the Audit-script baseline sha 25d3a1cda079095c765c0184d23cf02701f4937f)
```

### Audit-script baseline sha, pinned

```
$ git log -1 --format=%H -- scripts/check-ios-gate.sh scripts/check-qa-audit-register.sh scripts/qa-audit-inventory.sh
25d3a1cda079095c765c0184d23cf02701f4937f
$ git cat-file -t 25d3a1cda079095c765c0184d23cf02701f4937f
commit
$ git diff 25d3a1cda079095c765c0184d23cf02701f4937f -- scripts/check-ios-gate.sh scripts/check-qa-audit-register.sh scripts/qa-audit-inventory.sh
(empty)
```
