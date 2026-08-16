# BACKSTOP B1 — FfiUserKey concurrency, sanitizer evidence

Date: 2026-08-16 · Harness: iPhone 17 Pro simulator, iOS 26.5, Xcode 26.6

## Instrument proven live (five independent indicators)
- swiftc flag `-sanitize\=thread` present in compile commands (note: xcodebuild escapes the `=`,
  which is why a naive grep for `-sanitize=thread` finds nothing and must not be trusted)
  occurrences in build log: 14
- build products under `Objects-normal-tsan/`
- `libclang_rt.tsan_iossim_dynamic.dylib` linked into BOTH app and test binaries:
    	@rpath/libclang_rt.tsan_iossim_dynamic.dylib (compatibility version 0.0.0, current version 0.0.0)
- `TSAN_OPTIONS=color=never:...:halt_on_error=1` set in the test process environment
- the tsan dylib present in `XCTestBundleInjectPath`

## Falsification — the instrument was shown able to FAIL
A temporary test (ZZTsanFalsificationProbe, deleted after the run) drove 64 threads x 500
unsynchronized increments of one shared Int. Under the identical TSan configuration:

    FAIL: PasskeyVault (13898) encountered an error :: Early unexpected exit ...
      (Underlying Error: Crash: PasskeyVault at closure #1 in
       ZZTsanFalsificationProbe.deliberateRaceMustBeReported())
    FAIL: deliberateRaceMustBeReported() :: Test crashed with signal abrt.

SIGABRT at exactly the racy closure is halt_on_error=1 firing. An uninstrumented build runs
that loop harmlessly and passes -- so a green run on FfiConcurrencyTests means something.

## Result — FfiConcurrencyTests under TSan
    Test case 'FfiConcurrencyTests/exportComparisonCanActuallyFail()' passed on 'Clone 1 of iPhone 17 Pro - PasskeyVault (12328)' (0.002 seconds)
    Test case 'FfiConcurrencyTests/sharedHandleSurvivesConcurrentUse()' passed on 'Clone 1 of iPhone 17 Pro - PasskeyVault (12328)' (0.022 seconds)
    Test case 'FfiConcurrencyTests/exportComparisonCanActuallyFail()' passed on 'Clone 1 of iPhone 17 Pro - PasskeyVault (12328)' (0.000 seconds)
    Test case 'FfiConcurrencyTests/sharedHandleSurvivesConcurrentUse()' passed on 'Clone 1 of iPhone 17 Pro - PasskeyVault (12328)' (0.017 seconds)
    ** TEST SUCCEEDED **

## AddressSanitizer — the second half of B1 (double-free / use-after-free)

Instrumentation: `-sanitize\=address` in compile commands (16 occurrences),
`libclang_rt.asan_iossim_dynamic.dylib` present in XCTestBundleInjectPath.

HONEST NOTE ON A DISCREPANCY: unlike TSan, the ASan runtime is NOT link-time-embedded in the
app binary (`otool -L` shows no asan dylib) -- it is injected at load time instead. That
asymmetry is why the link-time check alone was NOT accepted as proof for ASan, and why the
falsification below was run rather than inferred.

Falsification (ZZAsanFalsificationProbe, deleted after the run): a 4-byte heap allocation
written at offset 512.

    ** TEST FAILED **
    FAIL: deliberateHeapOverflowMustBeReported() :: Crash: PasskeyVault at
          ZZAsanFalsificationProbe.deliberateHeapOverflowMustBeReported()

ASan is live and able to fail. FfiConcurrencyTests under the same configuration:
    Test case 'FfiConcurrencyTests/exportComparisonCanActuallyFail()' passed on 'Clone 1 of iPhone 17 Pro - PasskeyVault (16459)' (0.003 seconds)
    Test case 'FfiConcurrencyTests/sharedHandleSurvivesConcurrentUse()' passed on 'Clone 1 of iPhone 17 Pro - PasskeyVault (16459)' (0.017 seconds)
    Test case 'FfiConcurrencyTests/exportComparisonCanActuallyFail()' passed on 'Clone 1 of iPhone 17 Pro - PasskeyVault (16459)' (0.000 seconds)
    Test case 'FfiConcurrencyTests/sharedHandleSurvivesConcurrentUse()' passed on 'Clone 1 of iPhone 17 Pro - PasskeyVault (16459)' (0.012 seconds)
    ** TEST SUCCEEDED **

## Verdict

B1 DISCHARGED. One shared FfiUserKey + one shared FfiWrappingKey, 256 concurrent iterations
across four call shapes (export / wrap / encrypt / decrypt), under TSan and ASan separately,
both instruments independently shown able to fail. No data race, no memory error, and all 256
concurrent exports byte-identical to an independently-authored literal.

STILL NOT PROVEN (see the test file header): deallocation racing with use (ARC holds the
instance alive for the whole test, so deinit-under-contention is untested), and the
cross-PROCESS case Phase 41 needs -- no in-process sanitizer can speak to that one.
