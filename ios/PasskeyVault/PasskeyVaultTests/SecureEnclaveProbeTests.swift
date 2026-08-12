//
//  SecureEnclaveProbeTests.swift
//  PasskeyVaultTests
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-05, Task 3.
//
//  E-SE-2 (capability probe), E-SE-1 (algorithm-support probe, with its
//  mandatory RSA control), E-SE-1b (the load-bearing HPKE round trip, with
//  its mismatched-`info` control), E-SE-4 (the ACC-05 R1 confirm-or-amend
//  experiment). E-SE-3 (cross-process reachability) is DEFERRED -- no
//  AutoFill extension target consumes an SE key yet (Phase 36/41 own it) --
//  and no argument in this file or in `ios/IOS-SPIKE-LOG.md` ACC-05 depends
//  on it.
//
//  Results are written to `/private/tmp/pv37-05-<name>.txt`, the same
//  channel `BiometricGateSimulatorTests.swift` established this run (its
//  header records why: `Process` is unavailable on iOS, and print()/os_log
//  do not survive a Swift Testing run under `xcodebuild test`, per 37-03).
//

import Foundation
import Testing
import CryptoKit
import Security
import LocalAuthentication
@testable import PasskeyVault

@Suite(.serialized)
struct SecureEnclaveProbeTests {

    // MARK: - E-SE-2 -- is the Secure Enclave available at all on this harness?

    @Test func eSe2_secureEnclaveAvailability() throws {
        let isAvailable = SecureEnclave.isAvailable
        ResultFile.write("ese2-isAvailable", "\(isAvailable)")

        var keyCreateStatus = "not-attempted"
        if isAvailable {
            var error: Unmanaged<CFError>?
            let attrs: [String: Any] = [
                kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrKeySizeInBits as String: 256,
                kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            ]
            let key = SecKeyCreateRandomKey(attrs as CFDictionary, &error)
            keyCreateStatus = key != nil ? "created" : "failed: \(String(describing: error))"
        } else {
            // Attempt anyway, to record the EXACT failure shape when
            // `SecureEnclave.isAvailable` already says false -- this is the
            // "errSecUnimplemented-class error" the plan's own action text
            // names.
            var error: Unmanaged<CFError>?
            let attrs: [String: Any] = [
                kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrKeySizeInBits as String: 256,
                kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            ]
            let key = SecKeyCreateRandomKey(attrs as CFDictionary, &error)
            keyCreateStatus = key != nil ? "created (despite isAvailable=false)" : "failed: \(String(describing: error))"
        }
        ResultFile.write("ese2-keycreate", keyCreateStatus)
    }

    // MARK: - E-SE-1 -- algorithm support probe, mandatory RSA control

    /// Only meaningful if E-SE-2 shows the SE unavailable/key-creation
    /// failing -- run unconditionally anyway (cheap, and the RSA control is
    /// itself informative regardless of SE availability, since
    /// `SecKeyIsAlgorithmSupported` on a NON-existent key is moot -- this
    /// probe instead checks the STATIC algorithm-capability query Apple's
    /// own API exposes independent of holding a live key, exactly as
    /// `37-RESEARCH.md`'s E-SE-1 describes).
    @Test func eSe1_algorithmSupportProbe() throws {
        // A throwaway SE-attributed key is needed to ask
        // `SecKeyIsAlgorithmSupported` meaningfully; if the SE is
        // unavailable this key will be nil and the probe records that
        // explicitly rather than guessing.
        var error: Unmanaged<CFError>?
        let attrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        ]
        guard let seKey = SecKeyCreateRandomKey(attrs as CFDictionary, &error) else {
            ResultFile.write("ese1", "SKIPPED -- no SE key available: \(String(describing: error))")
            return
        }

        let decryptSupported = SecKeyIsAlgorithmSupported(
            seKey, .decrypt, .eciesEncryptionCofactorVariableIVX963SHA256AESGCM
        )
        let keyExchangeSupported = SecKeyIsAlgorithmSupported(
            seKey, .keyExchange, .ecdhKeyExchangeCofactorX963SHA256
        )
        // MANDATORY CONTROL: RSA on an EC key MUST report false. If it
        // reports true, the harness itself is lying and every other result
        // in this file is void.
        let rsaControlSupported = SecKeyIsAlgorithmSupported(seKey, .decrypt, .rsaEncryptionOAEPSHA256)

        ResultFile.write(
            "ese1",
            "decrypt-ecies=\(decryptSupported) keyExchange-ecdh=\(keyExchangeSupported) rsaControl=\(rsaControlSupported)"
        )
        #expect(rsaControlSupported == false, "RSA control MUST be false on an EC key -- if true, this harness is lying")
    }

    // MARK: - E-SE-1b -- the load-bearing HPKE round trip, with its mismatched-info control

    @Test func eSe1b_hpkeRoundTripOverSecureEnclaveKeyAgreement() throws {
        guard SecureEnclave.isAvailable else {
            ResultFile.write("ese1b", "SKIPPED -- SecureEnclave.isAvailable=false")
            return
        }

        let literalBytes: [UInt8] = [
            0xB0, 0xB1, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6, 0xB7,
            0xB8, 0xB9, 0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF,
            0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7,
            0xC8, 0xC9, 0xCA, 0xCB, 0xCC, 0xCD, 0xCE, 0xCF,
        ]
        let plaintext = Data(literalBytes)
        let info = Data("pv37-05-ese1b-info".utf8)
        let wrongInfo = Data("pv37-05-ese1b-WRONG-info".utf8)

        do {
            let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey()
            let recipientPublicKey = privateKey.publicKey

            let sender = try HPKE.Sender(
                recipientKey: recipientPublicKey,
                ciphersuite: .P256_SHA256_AES_GCM_256,
                info: info
            )
            var senderCopy = sender
            let sealed = try senderCopy.seal(plaintext)

            var recipient = try HPKE.Recipient(
                privateKey: privateKey,
                ciphersuite: .P256_SHA256_AES_GCM_256,
                info: info,
                encapsulatedKey: senderCopy.encapsulatedKey
            )
            let opened = try recipient.open(sealed)
            let roundTripMatches = (opened == plaintext)
            ResultFile.write("ese1b-roundtrip", "matches=\(roundTripMatches)")
            #expect(roundTripMatches)

            // Mismatched-info CONTROL: opening with the WRONG info MUST throw.
            var mismatchThrew = false
            do {
                var recipientWrongInfo = try HPKE.Recipient(
                    privateKey: privateKey,
                    ciphersuite: .P256_SHA256_AES_GCM_256,
                    info: wrongInfo,
                    encapsulatedKey: senderCopy.encapsulatedKey
                )
                _ = try recipientWrongInfo.open(sealed)
            } catch {
                mismatchThrew = true
            }
            ResultFile.write("ese1b-control", "mismatchedInfoThrew=\(mismatchThrew)")
            #expect(mismatchThrew, "opening with a mismatched HPKE info string MUST throw")
        } catch {
            ResultFile.write("ese1b", "FAILED -- \(error)")
            Issue.record("E-SE-1b: HPKE round trip over an SE key failed: \(error)")
        }
    }

    // MARK: - E-SE-4 -- the ACC-05 R1 confirm-or-amend experiment

    /// Builds BOTH artifacts side by side -- a generic-password Keychain
    /// item under `.biometryCurrentSet` (the plain ACC-03 design) and an SE
    /// key from E-SE-1b's own mechanism -- then records, under a simulated
    /// failed biometry AND a simulated enrolment change, whether each gates/
    /// invalidates, and whether the outcomes are equivalent.
    ///
    /// **This harness's OWN limits already answer most of this before any
    /// SE-specific behaviour is observed:** E2 (`BiometricGateSimulatorTests`)
    /// showed the plain Keychain item is NOT gated by biometry at all on
    /// this simulator (Result B); E5 showed `.biometryCurrentSet`
    /// invalidation is NOT simulated on an enrolled-set change either. If
    /// the SE-key side ALSO shows no enforcement (SE unavailable, per
    /// E-SE-2), NEITHER side of R1's comparison can be exercised here, and
    /// the correct, honest outcome is "R1 stays [INFERRED], SE-side
    /// untestable on this harness" -- never a manufactured pass.
    @Test func eSe4_confirmOrAmendAccc05R1() throws {
        guard SecureEnclave.isAvailable else {
            ResultFile.write(
                "ese4",
                "UNTESTABLE -- SecureEnclave.isAvailable=false on this harness; R1 stays [INFERRED], reason recorded"
            )
            return
        }

        // SE side: does creating/using the SE key itself require biometry
        // on THIS harness at all (mirroring the plain-Keychain-item probe)?
        var acError: Unmanaged<CFError>?
        guard let ac = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly,
            [.biometryCurrentSet],
            &acError
        ) else {
            ResultFile.write("ese4", "UNTESTABLE -- SecAccessControlCreateWithFlags failed: \(String(describing: acError))")
            return
        }

        var seKeygenOutcome = "not-run"
        do {
            let context = LAContext()
            defer { context.invalidate() }
            let privateKey = try SecureEnclave.P256.KeyAgreement.PrivateKey(
                accessControl: ac,
                authenticationContext: context
            )
            // If key GENERATION itself succeeded with no biometric prompt
            // and no error, the SE side is, on THIS harness, exactly as
            // ungated as the plain Keychain item (E2's Result B) --
            // consistent, not contradictory, with the plain-item finding.
            seKeygenOutcome = "succeeded-without-observed-gate"
            ResultFile.write("ese4-se-keygen", "succeeded-without-observed-gate publicKeyLen=\(privateKey.publicKey.rawRepresentation.count)")
        } catch {
            // Observed this run: creating an SE key with a biometric
            // accessControl AND an authenticationContext hits the SAME
            // LocalAuthentication "-1020 not supported on iOS Simulator"
            // wall E3-alt's `evaluateAccessControl` call already hit -- a
            // FOURTH instance of this exact error this session, reinforcing
            // that ANY code path routing through LocalAuthentication's own
            // biometric evaluation (not just Keychain's implicit gate) is
            // categorically unavailable on this simulator/Xcode
            // combination, independent of whether the key is a plain
            // Keychain item or an SE key.
            seKeygenOutcome = "failed-la-not-supported"
            ResultFile.write("ese4-se-keygen", "FAILED -- \(error)")
        }

        switch seKeygenOutcome {
        case "succeeded-without-observed-gate":
            ResultFile.write(
                "ese4",
                "R1 CONFIRMED-CONSISTENT -- neither the plain Keychain item (E2/E5) nor SE key creation on this harness showed biometric enforcement; the two designs are behaviourally EQUIVALENT here (both ungated), which is consistent with R1's claim of no marginal gain, but is NOT the realistic-threat comparison R1 actually makes (stolen locked device / offline extraction / backup exfiltration) -- this harness cannot exercise that comparison at all, so R1 stays [INFERRED] rather than being upgraded to [OBSERVED] on the strength of this result"
            )
        case "failed-la-not-supported":
            ResultFile.write(
                "ese4",
                "R1 UNTESTABLE-CONSISTENT -- SE key creation UNDER a biometric accessControl+LAContext fails with the SAME -1020 'not supported on iOS Simulator' error E3-alt's evaluateAccessControl already hit (a fourth instance this session). This means the REALISTIC-THREAT comparison R1 makes (does the SE key gate/invalidate strictly better than the plain Keychain item under a real biometric challenge) cannot be exercised for EITHER side on this harness -- not because the two designs were shown equivalent, but because LocalAuthentication's own gating APIs are categorically unavailable here. R1 stays [INFERRED]; this is NOT an upgrade to [OBSERVED], and it is also not evidence against R1 -- it is an honest non-result."
            )
        default:
            ResultFile.write("ese4", "UNEXPECTED -- seKeygenOutcome=\(seKeygenOutcome)")
        }
    }
}
