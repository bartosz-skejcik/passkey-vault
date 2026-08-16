# L-14 — Release build crash, raw transcript

Date: 2026-08-16 · Xcode 26.6 (17F113) · Swift 6.3.3 · iPhone 17 Pro simulator

Tree: clean. A stray uncommitted 38-01 edit to `scripts/build-ios.sh` (left behind by an
execution agent that died mid-run) was reverted FIRST, and the crash reproduced identically
afterwards — so it is not an artifact of partial in-flight work.

## `-O` (Release default) — reproduced twice

```
Please submit a bug report (https://swift.org/contributing/#reporting-bugs) and include the crash backtrace.
Stack dump:
0.	Program arguments: swift-frontend -frontend -c .../swift-bindings/pv_ffi.swift
	<+15 app sources> ... -swift-version 5 -O ... -enable-default-cmo -num-threads 8
	[argv elided. The load-bearing part: pv_ffi.swift is compiled in the SAME
	 whole-module frontend invocation as the app sources, at -O, with default CMO.]
1.	Apple Swift version 6.3.3 (swiftlang-6.3.3.1.3 clang-2100.1.1.101)
2.	Compiling with effective version 5.10
3.	While evaluating request ExecuteSILPipelineRequest(Run pipelines { PrepareOptimizationPasses, EarlyModulePasses, HighLevel,Function+EarlyLoopOpt, HighLevel,Module+StackPromote, MidLevel,Function, ClosureSpecialize, LowLevel,Function, LateLoopOpt, SIL Debug Info Generator } on SIL for PasskeyVault)
4.	While running pass #54311 SILFunctionTransform "EarlyPerfInliner" on SILFunction "@$s12PasskeyVault15UniffiHandleMap33_3020C04B17195456C4681D445E4E403DLLCfD".
Stack dump without symbol names (ensure you have llvm-symbolizer in your PATH or set the environment var `LLVM_SYMBOLIZER_PATH` to point to it):
4  swift-frontend           0x000000010614b44c isCallerAndCalleeLayoutConstraintsCompatible(swift::FullApplySite) + 236
5  swift-frontend           0x000000010614b44c isCallerAndCalleeLayoutConstraintsCompatible(swift::FullApplySite) + 236
** BUILD FAILED **
```

**Reading the stack:** frames 4 and 5 are the same function at the *same address*
(`0x000000010614b44c`). That is unbounded recursion in
`isCallerAndCalleeLayoutConstraintsCompatible`, not a deep-but-finite stack.

**The symbol:** `@$s12PasskeyVault15UniffiHandleMap...fD` demangles to
`PasskeyVault.(UniffiHandleMap in _3020C04B...).deinit` — the generic
`fileprivate final class UniffiHandleMap<T>` that `uniffi-bindgen-swift` emits into
`pv_ffi.swift` (~line 406). **Generator output.** It cannot be fixed by editing our sources,
and it is not reachable by the opaque-handle audit, which reads the generated Swift for API
shape rather than compiling it optimized.

## `-Osize` — same crash

Run separately with `SWIFT_OPTIMIZATION_LEVEL=-Osize`: also `** BUILD FAILED **`, also
carrying the `EarlyPerfInliner` signature (2 matching lines). That run's console transcript was
lost to a `/tmp` sweep before capture; it is recorded here as a stated observation rather than
reproduced text, because pasting a transcript I no longer hold is precisely the defect class
this project has already paid for once today (36's unsourced 89,163,912).

## `-Onone` (Debug) — builds

Not re-run for this record: Debug **is** `-Onone`, and it built and ran green repeatedly on
this same tree today — `FfiConcurrencyTests` under TSan and under ASan, plus the Phase 35–37
suites. The negative case rests on that history, not on an absent run.

## What the argv detail implies for the fix

`pv_ffi.swift` is compiled **into the app module**, alongside every app source, in one
invocation. That is why workaround option 2 (isolate the generated bindings into their own
module, built `-Onone`, with the app left optimized) is structurally sound rather than a
guess — it removes the generated deinit from the app module's SIL pipeline entirely. It is
also per-target build-graph work, which **Phase 41 already owns**.
