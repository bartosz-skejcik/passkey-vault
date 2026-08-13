//
//  FfiConcurrencyTests.swift
//  PasskeyVaultTests
//
//  Phase 35 (granica-ffi-rust-swift-i-szkielet), BACKSTOP B1 — the one
//  must-have 35-VERIFICATION.md ABSTAINED on (reason: insufficient_spec),
//  rather than counting as a silent pass.
//
//  WHAT WAS ABSTAINED, AND WHY IT COULD NOT BE WAVED THROUGH. The generated
//  Swift declares `open class FfiUserKey: FfiUserKeyProtocol, @unchecked
//  Sendable` (pv_ffi.swift:590). `@unchecked` is the compiler being TOLD the
//  invariant holds — it is an assertion by the author of the generator, not
//  a proof about this type. UniFFI's Arc-backed handle model makes the claim
//  highly plausible: `FfiUserKey` wraps an `Arc<UserKey>`, every exported
//  method takes `&self`, and there is no interior mutability anywhere in
//  crates/pv-ffi. Plausible is not verified, and the verifier was right to
//  say so — this file is the missing measurement.
//
//  WHAT THIS TEST DOES. It hammers ONE shared `FfiUserKey` instance (and one
//  shared `FfiWrappingKey`) from every core of the machine at once via
//  `DispatchQueue.concurrentPerform`, mixing all four call shapes that take
//  a handle by reference: the raw-byte export, the wrap, and an
//  encrypt/decrypt pair. Then it asserts the property that actually matters
//  — every one of the concurrent exports returned the IDENTICAL 32 bytes,
//  compared against a literal authored in this file, never against another
//  call's output.
//
//  ── HOW TO RUN IT SO IT MEANS ANYTHING ──────────────────────────────────
//
//  Under a plain `xcodebuild test` this file proves only that concurrent use
//  does not crash and does not corrupt the exported bytes. That is worth
//  having, but it is NOT the backstop: a data race is undefined behaviour
//  that very often produces correct-looking output on the run you happened
//  to take. The sanitizers are what turn this from a smoke test into
//  evidence, because they instrument every memory access rather than
//  sampling outcomes:
//
//      xcodebuild test -project ios/PasskeyVault/PasskeyVault.xcodeproj \
//        -scheme PasskeyVault -destination 'platform=iOS Simulator,name=iPhone 17' \
//        -only-testing:PasskeyVaultTests/FfiConcurrencyTests \
//        -enableThreadSanitizer YES
//
//      # and, separately — TSan and ASan cannot be enabled together:
//      ... -enableAddressSanitizer YES
//
//  TSan answers "did two threads touch the same address unsynchronized";
//  ASan answers "was anything double-freed or used after free" — the two
//  halves of B1's own wording, and they need two runs.
//
//  ── THE LIMIT OF THIS EVIDENCE, STATED UP FRONT ─────────────────────────
//
//  TSan only reports races on code paths that actually EXECUTE during the
//  run. A green TSan run over this file is a statement about the four call
//  shapes below, at this iteration count, on this scheduler — not a proof
//  that `FfiUserKey` is thread-safe for all uses for all time. In
//  particular it says nothing about:
//
//    - `FfiUserKey.generate()` / `importUserKeyFromSession` racing with
//      concurrent use of a DIFFERENT handle (separate Arcs, no shared
//      state, but untested here);
//    - deallocation racing with use — the Swift runtime's own ARC keeps the
//      instance alive for this whole test, which is exactly the lifetime
//      pattern that hides double-free bugs. `deinit` ordering under
//      contention is NOT exercised;
//    - the cross-PROCESS case, which is the one Phase 41 actually needs.
//      Two OS processes do not share an address space at all, so no
//      in-process sanitizer can speak to it; that is a separate proof.
//
//  Recorded here rather than in a summary, because the next reader of this
//  file is the person most likely to over-read a green run.
//

import Foundation
import Testing
import PasskeyVault

struct FfiConcurrencyTests {

    // MARK: - Literal fixtures (authored here; never produced by code under test)

    /// The 32 bytes every concurrent export is compared against. Author-chosen
    /// literal — deliberately NOT `FfiUserKey.generate()`'s output, so the
    /// assertion below has an independent reference to compare to. A test that
    /// compared exports to each other would pass just as happily if a race
    /// corrupted all of them identically.
    private static let literalUserKeyBytes: [UInt8] = [
        0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
        0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7,
        0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7,
        0xD0, 0xD1, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7,
    ]

    private static let literalPassword: Data =
        "correct horse battery staple (ffi-concurrency-fixture)".data(using: .utf8)!

    private static let literalSalt: Data = Data([
        0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27,
        0x28, 0x29, 0x2A, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F,
    ])

    /// Cheap Argon2id params (8 MiB / t=1 / p=1), transcribed from
    /// `crates/pv-core/src/kdf.rs`'s `test_params()`. Production cost is not
    /// what this test measures, and paying 64 MiB per run here would make the
    /// iteration count below unaffordable.
    private static let cheapKdfParamsJson = "{\"m_cost_kib\":8192,\"t_cost\":1,\"p_cost\":1}"

    /// Enough iterations that the scheduler genuinely interleaves, small
    /// enough that a TSan run (which slows execution 5–15×) still finishes in
    /// a reasonable time. `concurrentPerform` spreads these across all
    /// available cores.
    private static let iterations = 256

    // MARK: - B1: one handle, every core, all four call shapes

    /// BACKSTOP B1. Exercises `exportUserKeyForSession`, `wrapUserKey`,
    /// `encryptItem` and `decryptItem` concurrently against a SINGLE shared
    /// `FfiUserKey` (and a single shared `FfiWrappingKey`), then asserts every
    /// export returned the identical, correct 32 bytes.
    ///
    /// The test's own bookkeeping is guarded by an `NSLock`, and the lock is
    /// taken ONLY around the result-array mutation — never around an FFI call.
    /// If it wrapped the calls it would serialize the very concurrency under
    /// test and the whole file would be theatre.
    @Test func sharedHandleSurvivesConcurrentUse() throws {
        let userKey = try importUserKeyFromSession(bytes: Data(Self.literalUserKeyBytes))
        let wrappingKey = try FfiWrappingKey.fromPassword(
            password: Self.literalPassword,
            salt: Self.literalSalt,
            kdfParamsJson: Self.cheapKdfParamsJson
        )

        let lock = NSLock()
        var exports: [Data] = []
        var roundTripFailures: [String] = []
        var thrown: [String] = []

        exports.reserveCapacity(Self.iterations)

        DispatchQueue.concurrentPerform(iterations: Self.iterations) { i in
            do {
                // (1) The sanctioned raw-byte export (FFI-03) — the call B1
                //     names explicitly, and the only one that can leak key
                //     material if a race corrupts it.
                let exported = exportUserKeyForSession(userKey: userKey)

                // (2) Wrap — takes both shared handles by reference at once.
                let wrapped = try wrapUserKey(wrappingKey: wrappingKey, userKey: userKey)

                // (3)+(4) Encrypt then decrypt, with a per-iteration item id so
                //     each thread drives distinct AAD through the same handle.
                let itemId = "ffi-concurrency-\(i)"
                let plaintext = "payload for iteration \(i)"
                let item = try encryptItem(
                    userKey: userKey,
                    plaintext: plaintext,
                    itemId: itemId,
                    revision: UInt32(i)
                )
                let decrypted = try decryptItem(
                    userKey: userKey,
                    item: item,
                    itemId: itemId,
                    revision: UInt32(i)
                )

                lock.lock()
                exports.append(exported)
                if decrypted != plaintext {
                    roundTripFailures.append(
                        "iteration \(i): decrypted \(decrypted.debugDescription) != \(plaintext.debugDescription)"
                    )
                }
                if wrapped.ciphertext.isEmpty || wrapped.nonce.isEmpty {
                    roundTripFailures.append("iteration \(i): wrapUserKey produced an empty component")
                }
                lock.unlock()
            } catch {
                lock.lock()
                thrown.append("iteration \(i): \(error)")
                lock.unlock()
            }
        }

        #expect(thrown.isEmpty, "FFI calls threw under concurrent use: \(thrown.prefix(5))")
        #expect(
            roundTripFailures.isEmpty,
            "encrypt/decrypt or wrap misbehaved under concurrency: \(roundTripFailures.prefix(5))"
        )

        // The load-bearing assertion: every export equals the ORIGINAL literal.
        #expect(exports.count == Self.iterations, "lost exports: got \(exports.count)")

        let expected = Data(Self.literalUserKeyBytes)
        let mismatched = exports.filter { $0 != expected }
        #expect(
            mismatched.isEmpty,
            """
            \(mismatched.count)/\(exports.count) concurrent exports did NOT equal the literal \
            32-byte User Key. This is the corrupted-export half of B1 failing.
            """
        )

        // Guard against the assertion above passing vacuously: if `exports`
        // were empty or `expected` were somehow the wrong length, the filter
        // would find nothing and the test would go green having proven zero.
        #expect(expected.count == 32)
        #expect(exports.first?.count == 32)
    }

    /// Falsification control for the test above.
    ///
    /// `sharedHandleSurvivesConcurrentUse` asserts that N concurrent exports
    /// all equal a literal. That assertion has a failure mode this project has
    /// been bitten by repeatedly (L-9, "a check that cannot fail"): if the
    /// comparison itself were wrong — wrong literal, wrong length, an equality
    /// that always holds — it would pass no matter what the FFI did.
    ///
    /// So: import a DIFFERENT literal key, export it, and confirm the same
    /// comparison REJECTS it. If this test ever goes green, the assertion in
    /// the test above is inert and both are worthless.
    @Test func exportComparisonCanActuallyFail() throws {
        var otherBytes = Self.literalUserKeyBytes
        otherBytes[0] ^= 0xFF  // single-bit-pattern difference, nothing else

        let otherKey = try importUserKeyFromSession(bytes: Data(otherBytes))
        let exported = exportUserKeyForSession(userKey: otherKey)

        #expect(exported.count == 32)
        #expect(
            exported != Data(Self.literalUserKeyBytes),
            "the equality used by sharedHandleSurvivesConcurrentUse cannot distinguish two different keys — that test proves nothing"
        )
    }
}
