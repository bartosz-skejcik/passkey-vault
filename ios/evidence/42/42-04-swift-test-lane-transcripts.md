# 42-04 — the Swift test lane: E9/E8 transcripts, `gate_swift_tests` full-gate + falsification proof

Toolchain: `xcodebuild` 26.6 (17F113); `xcrun xcresulttool version` 24757, schema 0.1.0; simulator
`PV-iPhone16` (UDID `34992BB7-4982-4915-92C7-C7FC987802AF`, `/private/tmp/pv16.udid`). Recorded
2026-08-21.

## E9 — does the scheme survive a clean checkout?

```
$ rm -rf /tmp/pv-clean-e9 && mkdir -p /tmp/pv-clean-e9 && git archive HEAD | tar -x -C /tmp/pv-clean-e9 \
  && xcodebuild -list -project /tmp/pv-clean-e9/ios/PasskeyVault/PasskeyVault.xcodeproj
...
Information about project "PasskeyVault":
    Targets:
        PasskeyVault
        PasskeyVaultTests
        PasskeyVaultUITests
        PasskeyVaultAutoFill

    Build Configurations:
        Debug
        Release

    If no build configuration is specified and -scheme is not passed then "Release" is used.

    Schemes:
        PasskeyVault
        PasskeyVaultAutoFill

list exit=0
```

**Verdict:** `xcodebuild` autocreates the `PasskeyVault` scheme from a clean, tracked-only extraction
(contains no `xcuserdata/` — gitignored, absent by construction). **No `xcshareddata/xcschemes/`
commit needed.** `files_modified` in 42-04-PLAN.md listed that path conditionally; it is NOT created —
see the SUMMARY's deviation note.

Cleanup confirmed: `rm -rf /tmp/pv-clean-e9`; `ls /tmp/pv-clean-e9` → "No such file or directory";
`git worktree list` unchanged (exactly two entries, this worktree and `main`) throughout.

`gate_swift_tests` re-asserts this finding on every real invocation (never trusted as a one-time fact)
via `xcodebuild -list -project <the real project>`, scoped strictly to the `Schemes:` section of the
output (see the "Schemes-section scoping" note below — a naive whole-output grep would false-PASS on
the `Targets:` section, since the app target is also named `PasskeyVault`).

## E8 — can `xcodebuild test` be green with zero tests?

### Run 1 (cold DerivedData state, transition failure — NOT the E8 answer, see L-41 below)

```
$ xcodebuild test -project ios/PasskeyVault/PasskeyVault.xcodeproj -scheme PasskeyVault \
  -destination "platform=iOS Simulator,id=34992BB7-4982-4915-92C7-C7FC987802AF" \
  -only-testing:PasskeyVaultTests/ThisTypeDoesNotExist -resultBundlePath /tmp/pv-zero.xcresult
...
Testing failed:
	Cannot find 'uniffi_pv_ffi_checksum_method_ffiuserkey_ffi06_synthetic_panic_probe' in scope
	Testing cancelled because the build failed.
** TEST FAILED **
exit=65
```

This is landmine **L-41** (ios/IOS-SPIKE-LOG.md) — a plain-to-panic-probe pv-ffi bindings-variant
TRANSITION artifact, not the E8 answer. The "Build pv-ffi XCFramework" Run Script phase DID run with
`features=[ffi06-probe]` in this same invocation (confirmed in the log), and the regenerated header on
disk WAS correct by the time the build failed (`grep -c ffi06 ios/PasskeyVault/build/swift-bindings/pv_ffi.swift`
→ non-zero) — the build that failed simply did not see it.

### Run 2 (immediate retry, same command, no changes) — the real E8 answer

```
$ xcodebuild test -project ios/PasskeyVault/PasskeyVault.xcodeproj -scheme PasskeyVault \
  -destination "platform=iOS Simulator,id=34992BB7-4982-4915-92C7-C7FC987802AF" \
  -only-testing:PasskeyVaultTests/ThisTypeDoesNotExist -resultBundlePath /tmp/pv-zero2.xcresult
...
Test session results, code coverage, and logs:
	/tmp/pv-zero2.xcresult
** TEST SUCCEEDED **
exit=0
```

**Outcome B, confirmed:** `xcodebuild test` exits 0 with a zero-match `-only-testing` filter on this
toolchain. This project's oldest defect family (a filter matching zero tests reported green) IS live
on iOS — independently confirmed and consistent with landmine L-30 (which found the identical shape at
method-level scope, missing trailing `()`).

### Run 3 (repeat, stability check)

```
$ xcodebuild test ... -only-testing:PasskeyVaultTests/ThisTypeDoesNotExist -resultBundlePath /tmp/pv-zero3.xcresult
...
** TEST SUCCEEDED **
exit=0
```

Confirmed stable across 3 total attempts (1 cold-transition failure unrelated to the filter question, 2
clean successes with exit 0).

### The transition itself, isolated and reproduced deliberately (establishing L-41)

```
$ bash scripts/build-ios.sh                     # plain, no --with-panic-probe
==> variant: plain (no extra features -- the artifact every non-test consumer, including the appex, links)
... exit=0
$ grep -c ffi06 ios/PasskeyVault/build/swift-bindings/pv_ffi.swift
0   (confirmed: plain build carries NO panic-probe symbol)

$ xcodebuild test -project ios/PasskeyVault/PasskeyVault.xcodeproj -scheme PasskeyVault \
  -destination "platform=iOS Simulator,id=34992BB7-4982-4915-92C7-C7FC987802AF" \
  -only-testing:PasskeyVaultTests/FfiRoundTripTests -only-testing:PasskeyVaultTests/FfiPanicSafetyTests \
  -parallel-testing-enabled NO -resultBundlePath /tmp/pv-transition.xcresult
...
Cannot find 'uniffi_pv_ffi_checksum_method_ffiuserkey_ffi06_synthetic_panic_probe' in scope
Testing cancelled because the build failed.
** TEST FAILED **
exit=65

$ xcodebuild test [identical command] -resultBundlePath /tmp/pv-transition2.xcresult
...
** TEST SUCCEEDED **
exit=0
```

Deterministically reproduced: plain build → first `xcodebuild test` attempt fails with the exact L-41
signature; immediate retry (no changes) succeeds. `gate_swift_tests` retries exactly once, gated on
this exact log signature (`Testing cancelled because the build failed`), never a blanket retry.

## The test-count assertion: exact JSON path, verified by contrast

### Zero-match bundle (`/tmp/pv-zero2.xcresult`)

`xcrun xcresulttool get test-results summary --path ... --format json`:
```json
{
  "devicesAndConfigurations" : [],
  "expectedFailures" : 0,
  "failedTests" : 0,
  "passedTests" : 0,
  "result" : "unknown",
  "skippedTests" : 0,
  "testFailures" : [],
  "title" : "Test - PasskeyVault",
  "totalTestCount" : 0
}
```

`xcrun xcresulttool get test-results tests --path ... --format json`:
```json
{
  "devices" : [ { "deviceName" : "PV-iPhone16", ... } ],
  "testNodes" : [ { "name" : "PasskeyVault", "nodeType" : "Test Plan", "result" : "unknown" } ],
  "testPlanConfigurations" : [ ... ]
}
```
No `children`, no `nodeIdentifier` anywhere — a genuinely empty executed set.

### Matching bundle (`/tmp/pv-match.xcresult`, both FFI suites, 5 tests)

```
$ xcodebuild test ... -only-testing:PasskeyVaultTests/FfiRoundTripTests \
    -only-testing:PasskeyVaultTests/FfiPanicSafetyTests -parallel-testing-enabled NO \
    -resultBundlePath /tmp/pv-match.xcresult
✔ Suite FfiPanicSafetyTests passed after 0.009 seconds.
◇ Test fullRoundTripOnLiteralBytes() started.
✔ Test fullRoundTripOnLiteralBytes() passed after 0.005 seconds.
◇ Test embeddedNulByteSurvivesExportImportRoundTrip() started.
✔ Test embeddedNulByteSurvivesExportImportRoundTrip() passed after 0.001 seconds.
◇ Test embeddedNulByteInNonceIsNotTruncated() started.
✔ Test embeddedNulByteInNonceIsNotTruncated() passed after 0.004 seconds.
✔ Test run with 5 tests in 2 suites passed after 0.019 seconds.
** TEST SUCCEEDED **
exit=0
```

`get test-results summary` → `"totalTestCount" : 5`, `"result" : "Passed"`, `"passedTests" : 5`.

`get test-results tests` → 5 `"nodeType" : "Test Case"` leaves, each carrying `nodeIdentifier`:
```
FfiPanicSafetyTests/nonSentinelInputReturnsNormally()
FfiPanicSafetyTests/sentinelInputThrowsCatchableDiscriminatedErrorAndHandleSurvives()
FfiRoundTripTests/fullRoundTripOnLiteralBytes()
FfiRoundTripTests/embeddedNulByteSurvivesExportImportRoundTrip()
FfiRoundTripTests/embeddedNulByteInNonceIsNotTruncated()
```
(shape confirmed via `jq -r '.. | .nodeIdentifier? // empty'`, walking the full nested
`testNodes[].children[]...` tree regardless of depth — Test Plan → Unit test bundle → Test Suite → Test
Case).

**Fields this plan pins the gate to (verified against xcresulttool version 24757, schema 0.1.0):**
- `.totalTestCount` (top-level int, `get test-results summary --format json`) — the positive-count
  assertion.
- `.. | .nodeIdentifier?` (recursive descent over `get test-results tests --format json`'s
  `testNodes` tree) — the named-identifier assertion. Shape: `<Suite>/<method>()`.

## The "Schemes-section scoping" precision fix

A first draft of the scheme-precondition check used a whole-output grep
(`grep -qE "^[[:space:]]*${scheme}\$"` against the FULL `xcodebuild -list` text). Falsified in both
directions before landing:

```
$ xcodebuild -list -project ios/PasskeyVault/PasskeyVault.xcodeproj | grep -E "^[[:space:]]*PasskeyVault$"
        PasskeyVault      <- from the "Targets:" section
        PasskeyVault      <- from the "Schemes:" section
```

Both the app TARGET and the SCHEME are named `PasskeyVault` — identical text, different sections. A
whole-output grep cannot distinguish "exists as a target only" from "exists as a scheme" — the exact
"matched by position/whole-text instead of the real structural extent" shape this project's own review
discipline (`audit-ios-identity-store-chokepoint.sh`, fixed 6e47711 the day before this plan) watches
for. Fixed to scope the match to the `Schemes:` section specifically:

```
$ xcodebuild -list -project ios/PasskeyVault/PasskeyVault.xcodeproj \
  | awk '/^[[:space:]]*Schemes:/{found=1; next} found'
        PasskeyVault
        PasskeyVaultAutoFill

$ ... | awk '/^[[:space:]]*Schemes:/{found=1; next} found' | grep -qE "^[[:space:]]*PasskeyVaultTests\$" \
  && echo "MATCHED (bad)" || echo "correctly did not match"
correctly did not match
```

Falsified both ways: a real scheme name (`PasskeyVault`) matches within the scoped slice; a name that
exists ONLY as a target (`PasskeyVaultTests`, never a scheme) does not.

## Full composed gate — green, five sub-gates, L-41 retry firing correctly

```
$ bash scripts/check-ios-gate.sh; echo "full gate exit=$?"
...
==> running sub-gate: swift_tests
RETRY[swift_tests]: attempt 1 hit the L-41 bindings-transition build failure (xcodebuild exit 65) -- retrying once (this exact failure is known to be transitional, not a real regression; see this file's own gate_swift_tests header comment)
PASS[swift_tests]: scheme 'PasskeyVault' present (E9 autocreated); xcodebuild test exit=0 (after 1 L-41 retry); executed-test count=5 (> 0, E8's zero-count trap did not fire); matched all required FFI identifiers: FfiRoundTripTests/fullRoundTripOnLiteralBytes() FfiRoundTripTests/embeddedNulByteSurvivesExportImportRoundTrip() FfiRoundTripTests/embeddedNulByteInNonceIsNotTruncated() FfiPanicSafetyTests/nonSentinelInputReturnsNormally() FfiPanicSafetyTests/sentinelInputThrowsCatchableDiscriminatedErrorAndHandleSurvives()
==> SUMMARY: executed sub-gate(s): qa05 ffi_build ffi_falsifiable ffi_opaque swift_tests
full gate exit=0
```

This run happened to hit the L-41 transition (since `gate_ffi_build` runs plain immediately before
`gate_swift_tests`, exactly the sequence that reproduces it) — the retry fired and recovered
automatically, visibly logged, and the run still ends green with all 5 sub-gates executed.

## Full composed `--verify-falsifiable` — swift_tests F1/F2 both reachable

```
$ bash scripts/check-ios-gate.sh --verify-falsifiable; echo "falsify exit=$?"
...
==> --verify-falsifiable: swift_tests
--- F1: zero-match filter -- the positive executed-count assertion's FAIL branch ---
    gate_swift_tests with a zero-match -only-testing filter exited 1 and named the observed (zero) count -- this is E8's own finding (xcodebuild itself exits 0 on this filter) confirmed NOT sufficient to pass this sub-gate:
      FAIL[swift_tests]: executed-test count is 0 (xcodebuild's own exit was 0) -- a filter that matches zero tests is reported green by this toolchain (E8/L-30); this sub-gate refuses to call that a pass
==> PASS: F1 -- the positive-count assertion's FAIL branch is reachable

--- F2: missing identifier -- the named-FFI-identifier assertion's FAIL branch ---
    gate_swift_tests with one genuine identifier plus one bogus required identifier exited 1 and named the missing one specifically (proving the check is per-identifier, not a vacuous whole-list match):
      FAIL[swift_tests]: required FFI test identifier(s) NOT found in the executed set: FfiRoundTripTests/thisMethodDoesNotExist() -- executed identifiers were:
==> PASS: F2 -- the named-identifier assertion's FAIL branch is reachable

==> --verify-falsifiable: ALL defined sub-gate falsification proofs passed (qa05 ffi_build ffi_falsifiable ffi_opaque swift_tests) -- see each sub-gate's own output above for exactly what was, and was not, proven falsifiable in this fast mode
falsify exit=0
```

## Scope fence and cleanup

```
$ git diff --stat -- ios/PasskeyVault/PasskeyVaultTests crates/pv-ffi
(empty)

$ grep -v '^[[:space:]]*#' scripts/check-ios-gate.sh | grep -c 'xcresulttool'
5

$ grep -n "24757" scripts/check-ios-gate.sh
540:#   xcresulttool version this was verified against: 24757, schema 0.1.0
```

All scratch `.xcresult`/`.log`/`.json` files created by this task's experiments removed from `/tmp`
before task end. Post-test-run simulator purge performed (`xcrun simctl --set testing shutdown all` /
`delete all`), `PV-iPhone16` re-booted afterward — confirmed exactly one device (`PV-iPhone16`) booted,
no parallel clones remaining.
