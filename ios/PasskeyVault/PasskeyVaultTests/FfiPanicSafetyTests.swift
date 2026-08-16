//
//  FfiPanicSafetyTests.swift
//  PasskeyVaultTests
//
//  Phase 35 (granica-ffi-rust-swift-i-szkielet), plan 35-05. Proves FFI-06/
//  CP-3: a Rust panic crossing the pv-ffi boundary surfaces to Swift as a
//  catchable error (never a process crash), and the FfiUserKey handle
//  involved survives the caught panic uncorrupted.
//
//  The panic vector under test (`ffi06SyntheticPanicProbe`,
//  crates/pv-ffi/src/panic_probe.rs) is SYNTHETIC and clearly labeled as
//  such -- no genuine, attacker-reachable panic exists in pv-core's/
//  pv-provider's production code today (re-confirmed by this plan's own
//  Task 1 precondition check: every `.unwrap()`/`.expect()` in
//  crates/pv-core/src/*.rs and crates/pv-provider/src/*.rs falls inside a
//  `#[cfg(test)] mod tests` block except `pv-core/src/keys.rs:78`'s
//  `.expect()`, which asserts a compile-time-fixed 32-byte HKDF-SHA256
//  output length that can never fail). This probe is never called by
//  production Swift code -- only this test file calls it.
//
//  LOAD-BEARING DISCOVERY (see crates/pv-ffi/src/panic_probe.rs's own doc
//  comment and 35-05-SUMMARY.md for the full transcript): the probe
//  deliberately returns `Result<String, FfiError>` in Rust, never a bare
//  `String`, even though the non-panic path is infallible. UniFFI only
//  generates a Swift `throws` wrapper (using `rustCallWithError`, whose
//  caller writes an ordinary `do { try ... } catch { ... }`) for a Rust
//  function whose signature returns `Result<T, E: uniffi::Error>`. A bare
//  `-> String` return generates a NON-throwing Swift wrapper that
//  force-unwraps the underlying FFI call with `try!` -- so a caught panic
//  (UniFFI's `CALL_UNEXPECTED_ERROR` -> the generated file's fileprivate
//  `UniffiInternalError.rustPanic`) would still be intercepted by
//  `catch_unwind` at the Rust/C boundary (never raw undefined behavior),
//  but the generated Swift codegen's own `try!` would then immediately
//  trigger an uncatchable `fatalError` -- a real Swift runtime trap, NOT
//  the "catchable error (throws/Result)" SC5 requires. Confirmed empirically
//  this session by inspecting the real generated
//  `ios/PasskeyVault/build/swift-bindings/pv_ffi.swift` for both signature
//  shapes before settling on the `Result`-returning one.
//
//  `pv_ffi.swift` (built fresh on every test run by the "Build pv-ffi
//  XCFramework" Run Script phase) is compiled into the `PasskeyVault` APP
//  target, not this test target (37-02 moved module ownership there -- see
//  FfiRoundTripTests.swift's own header for the full reason). `import
//  PasskeyVault` below reaches FfiUserKey/FfiError/
//  importUserKeyFromSession/exportUserKeyForSession through the app module.
//
//  DISCRIMINATION NOTE: the caught-panic error is UniFFI's own
//  `UniffiInternalError.rustPanic(message)`, declared `fileprivate` inside
//  the generated pv_ffi.swift -- it cannot be named/cast to from this file.
//  Discrimination therefore proceeds by (a) confirming the caught error is
//  NOT an `FfiError` (an ordinary `catch let error as FfiError` branch that
//  must NOT fire), and (b) asserting the generic `Error`'s
//  `localizedDescription` contains the exact literal panic message text
//  `crates/pv-ffi/src/panic_probe.rs` passes to `panic!()` -- proving this
//  really is UniFFI's `catch_unwind` path, not an ordinary `Result::Err`
//  return.
//

//  COMPILE-TIME GATING (38-01, Task 2 -- gating only, no assertion changed).
//  The "Build pv-ffi XCFramework" Run Script phase used to pass
//  `--with-panic-probe` as its own default, so `ffi06_synthetic_panic_probe`
//  was compiled into EVERY PasskeyVault.app, Release included. That phase now
//  derives the flag from `$CONFIGURATION`: Debug still gets the probe (this
//  file needs it), Release gets a plain artifact. Consequently
//  `ffi06SyntheticPanicProbe` does NOT exist in the generated Swift bindings
//  under Release, and this file would fail to COMPILE in a Release test build.
//  `#if DEBUG` is therefore required for the Release build to work at all --
//  it is not a way of quietly dropping coverage. Every assertion below is
//  unchanged and still runs in the Debug configuration, which is the
//  configuration `xcodebuild test` uses.
//
//  This does NOT close the per-target split (one shared Run Script phase, one
//  shared artifact path, whichever invocation ran last wins). Phase 41 owns
//  that; see crates/pv-ffi/Cargo.toml's [features] comment for the residual.

import Foundation
import Testing
import PasskeyVault

#if DEBUG

struct FfiPanicSafetyTests {

    // MARK: - Shared literal fixture (provenance: authored in this file,
    // never produced by calling FfiUserKey.generate()/any code under test)

    /// Hard-coded literal 32-byte User Key -- author-chosen, NOT
    /// `FfiUserKey.generate()`'s output (same SC2 discipline as
    /// FfiRoundTripTests.swift's `originalUserKeyBytes`).
    private static let literalUserKeyBytes: [UInt8] = [
        0xE0, 0xE1, 0xE2, 0xE3, 0xE4, 0xE5, 0xE6, 0xE7,
        0xE8, 0xE9, 0xEA, 0xEB, 0xEC, 0xED, 0xEE, 0xEF,
        0xF0, 0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7,
        0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF,
    ]

    /// The exact sentinel byte pattern `crates/pv-ffi/src/panic_probe.rs`
    /// defines as `PANIC_SENTINEL` (`b"FFI06-PANIC"`).
    private static let panicSentinel: Data = "FFI06-PANIC".data(using: .utf8)!

    private static func makeFixtureUserKey() throws -> FfiUserKey {
        #expect(literalUserKeyBytes.count == 32)
        return try importUserKeyFromSession(bytes: Data(literalUserKeyBytes))
    }

    // MARK: - Test 1a (control, non-sentinel input): returns normally

    /// A non-sentinel byte input returns NORMALLY (no throw) -- the
    /// "well-formed input" half of SC5's adversarial-input shape, and the
    /// control case for Test 1b's discrimination logic: if the
    /// discrimination were broken (e.g. treating every call as a panic),
    /// this case would be the one that fails.
    @Test func nonSentinelInputReturnsNormally() throws {
        let userKey = try Self.makeFixtureUserKey()
        let result = try userKey.ffi06SyntheticPanicProbe(sentinel: Data([0x00]))
        #expect(result == "no panic: 1 non-sentinel bytes")
    }

    // MARK: - Test 1b (SC5, RED first) + Test 2 (B2 backstop)

    /// Test 1b: the SAME method, called with the exact sentinel byte
    /// pattern, throws a catchable Swift error -- never crashes the test
    /// process -- and that error is positively discriminated from an
    /// ordinary `FfiError` case (proving this is UniFFI's `catch_unwind`
    /// path, not a normal `Result::Err` return).
    ///
    /// Test 2 (B2 backstop, handle-integrity): immediately AFTER Test 1b's
    /// catch, on the EXACT SAME `FfiUserKey` instance used in the panicking
    /// call, `exportUserKeyForSession` still returns the original 32-byte
    /// literal byte-for-byte -- proving the handle survived the panic
    /// uncorrupted, not merely that the process didn't crash. Combined into
    /// one test function (rather than two independent `@Test` cases)
    /// because the backstop assertion is only meaningful against the exact
    /// same handle instance the panicking call used.
    @Test func sentinelInputThrowsCatchableDiscriminatedErrorAndHandleSurvives() throws {
        let userKey = try Self.makeFixtureUserKey()

        do {
            _ = try userKey.ffi06SyntheticPanicProbe(sentinel: Self.panicSentinel)
            Issue.record(
                "expected ffi06SyntheticPanicProbe to throw for the sentinel input, it returned a value"
            )
        } catch let error as FfiError {
            Issue.record("""
                expected a caught-panic error (UniFFI's catch_unwind path), got an ordinary \
                FfiError case instead -- discrimination failed: \(error)
                """)
        } catch {
            // Expected path: the XCTest process is still running (this
            // catch block executed) -- positive, receiver-side proof the
            // panic did not crash the process (QA-03). Discriminate from an
            // ordinary FfiError by asserting the caught error's description
            // carries the literal panic message text.
            let description = error.localizedDescription
            #expect(description.contains("FFI-06 synthetic panic probe"))
            #expect(description.contains("deliberately test-only, never called by production code"))
        }

        // Test 2 (B2 backstop): the SAME `userKey` instance, re-used
        // immediately after the caught panic, still exports the exact
        // original 32 bytes -- not `.count`, not "call succeeded".
        let reExported = exportUserKeyForSession(userKey: userKey)
        #expect(Array(reExported) == Self.literalUserKeyBytes)
        #expect(reExported.count == 32)
    }
}

#endif  // DEBUG -- see the COMPILE-TIME GATING note in this file's header
