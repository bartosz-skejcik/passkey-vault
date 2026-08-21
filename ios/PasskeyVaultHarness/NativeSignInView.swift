// NativeSignInView.swift -- Phase 43 (warunkowe-passkeys-tylko-jesli-tanie), Plan 43-08, Task 1.
// The ONE screen `PasskeyVaultHarness` carries: a single "Sign In" button that requests a REAL
// native passkey assertion via `ASAuthorizationController`/
// `ASAuthorizationPlatformPublicKeyCredentialProvider` -- the REQUESTING side of
// AuthenticationServices, never the PROVIDER side every other Swift file in this workspace
// (`CredentialProviderViewController.swift` etc.) has used so far. This is ROADMAP SC2's own
// proof surface: a native, third-party-shaped app (the "GitHub app" case), never Safari (SC3's
// own, separate surface -- 43-08-PLAN.md's own prohibition against silently narrowing SC2 to a
// second Safari run relabeled).
//
// Every Swift-facing signature below (`createCredentialAssertionRequest(challenge:)`,
// `authorizationController(controller:didCompleteWithAuthorization:)`, `presentationAnchor(for:)`,
// `credentialID`/`rawAuthenticatorData`/`signature`/`rawClientDataJSON`/`userID`) was confirmed
// against a real `swiftc -typecheck` probe on this machine's actual SDK before being written here
// (L-1/L-43's own discipline: never infer an AuthenticationServices Swift signature from the ObjC
// selector by eye) -- this plan's own `43-08-PLAN.md` Task 1 `<read_first>` names this
// requirement explicitly, since this is the FIRST plan in this phase to use the REQUESTING-side
// `ASAuthorization*` family (43-02/43-03/43-07 all used the PROVIDER-side `ASPasskey*` types).
//
// A second, narrower L-1/L-43-shaped finding, caught by a REAL `xcodebuild` (the standalone
// `swiftc -typecheck` probe above missed it -- `_ = assertion.signature`/`let x: Data =
// assertion.signature` both typecheck regardless of whether the property is `Data` or `Data!`,
// since an explicit target type silently auto-unwraps an implicitly-unwrapped optional; only a
// bare `var signatureBytes = assertion.signature`, with NO explicit annotation, reveals the real
// shape): `ASAuthorizationPublicKeyCredentialAssertion.signature` imports into Swift as `Data!`
// (implicitly-unwrapped optional), NOT plain `Data` -- its declaring header
// (`ASAuthorizationPublicKeyCredentialAssertion.h`) has no `NS_ASSUME_NONNULL_BEGIN`/
// `NS_HEADER_AUDIT_BEGIN(nullability, ...)` wrapper around it, unlike its sibling
// `ASPublicKeyCredential.h` (which DOES carry `NS_HEADER_AUDIT_BEGIN(nullability, sendability)`,
// and whose `rawClientDataJSON`/`credentialID` import as plain, non-optional `Data`). `var
// signatureBytes: Data = assertion.signature` below states the intended non-optional type
// explicitly, which is what makes the IUO auto-unwrap visible and safe here, rather than
// silently propagating an IUO through the rest of this function.
//
// The fixture is authoritative for the challenge, never this view (43-PLAN-CHECK.md N2 fix):
// this view NEVER invents its own challenge bytes. It POSTs to `crates/rp-fixture`'s own
// `POST /challenge/assert?rp_id=vault.blonie.cloud` FIRST, decodes the real `webauthn-rs`-issued
// challenge from the response, and only THEN builds the `ASAuthorizationController` request
// around it -- an app-minted challenge could never match the `AuthenticationState` the fixture's
// own `finish_passkey_authentication` later verifies against.
//
// Falsification's owning branch lives HERE, not in a shell script (43-PLAN-CHECK.md N3 fix): if
// launched with the `-PVCorruptSignature` trailing process argument (`xcrun simctl launch <udid>
// cloud.blonie.PasskeyVaultHarness -PVCorruptSignature` -- `simctl launch`'s own trailing-argument
// passthrough, confirmed against `xcrun simctl launch --help` before relying on it), this view
// flips the first byte of the encoded signature immediately before POSTing to the fixture's own
// `/assert/finish` -- a shell script cannot intercept a `URLSession` call, so the corruption must
// happen inside this app's own process.

import AuthenticationServices
import Combine
import SwiftUI

/// `rp_id` this harness always requests against -- `vault.blonie.cloud`, Bartek's own real,
/// controlled domain, standing in for a third-party RP (honestly disclosed in this plan's own
/// SUMMARY, never implying a real external company's app was exercised -- QA-01's own disclosure
/// discipline, restated for SC2 here the same way 43-03's SUMMARY restated it for SC3).
private let harnessRpId = "vault.blonie.cloud"

/// `crates/rp-fixture`'s own fixed loopback port (43-03's own port inventory, `main.rs`'s module
/// doc). The harness app running on the SIMULATOR reaches the host Mac's `localhost` directly --
/// the SAME networking fact every other `crates/rp-fixture` consumer in this workspace already
/// relies on (`AutoFillPasskeyTracerUITests.swift`, `AutoFillPasskeyRegistrationUITests.swift`).
private let fixtureBaseURL = "http://localhost:8900"

/// Unpadded base64url (webauthn-rs's own `Base64UrlSafeData` convention) -- Foundation has no
/// built-in base64url codec, so this is a small, self-contained pair of helpers, never an
/// external dependency for two functions this narrow.
private enum Base64URL {
    static func decode(_ string: String) -> Data? {
        var padded = string.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while padded.count % 4 != 0 {
            padded += "="
        }
        return Data(base64Encoded: padded)
    }

    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

enum NativeSignInError: Error {
    case challengeFetchFailed
    case challengeDecodeFailed
    case unexpectedCredentialType
    case finishRequestFailed
}

/// The wire shape `crates/rp-fixture`'s own `/assert/finish` handler deserializes
/// (`webauthn_rs::prelude::PublicKeyCredential`) -- byte-identical to `main.rs`'s own JS
/// `encodeCredentialJson(cred, isRegistration: false)` helper, just produced in Swift instead of
/// JS. `id` is base64url of the SAME bytes as `rawId` -- the browser's own `PublicKeyCredential.id`
/// convention, mirrored here for wire compatibility with the SAME fixture endpoint.
private struct AssertResponsePayload: Encodable {
    let authenticatorData: String
    let clientDataJSON: String
    let signature: String
    let userHandle: String?
}

private struct AssertCredentialPayload: Encodable {
    let id: String
    let rawId: String
    let type: String
    let response: AssertResponsePayload
    let clientExtensionResults: [String: String]
}

private struct VerifyResult: Decodable {
    let ok: Bool
    let reason: String
}

@MainActor
final class NativeSignInCoordinator: NSObject, ObservableObject {
    @Published var statusText: String = "Ready"

    /// `-PVCorruptSignature`: the falsification leg's own arming flag, read ONCE at process
    /// start from `CommandLine.arguments` (never `#if DEBUG`-stripped -- this target has no
    /// Release configuration to protect, matching this plan's own action text).
    private let corruptSignature = CommandLine.arguments.contains("-PVCorruptSignature")

    func signIn() {
        print("PVHARNESS|stage=start corrupt=\(corruptSignature)")
        statusText = "Requesting challenge..."
        Task {
            do {
                let challenge = try await fetchChallenge()
                print("PVHARNESS|stage=challenge status=ok bytes=\(challenge.count)")
                statusText = "Requesting passkey..."
                requestAssertion(challenge: challenge)
            } catch {
                print("PVHARNESS|stage=challenge status=failed reason=\(error)")
                statusText = "Failed: \(error)"
            }
        }
    }

    // MARK: - Step 1: the fixture issues the challenge, never this app (N2).

    private func fetchChallenge() async throws -> Data {
        guard let url = URL(string: "\(fixtureBaseURL)/challenge/assert?rp_id=\(harnessRpId)") else {
            throw NativeSignInError.challengeFetchFailed
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw NativeSignInError.challengeFetchFailed
        }
        guard
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let publicKey = json["publicKey"] as? [String: Any],
            let challengeB64 = publicKey["challenge"] as? String,
            let challenge = Base64URL.decode(challengeB64)
        else {
            throw NativeSignInError.challengeDecodeFailed
        }
        return challenge
    }

    // MARK: - Step 2/3: the REAL, requesting-side ASAuthorizationController ceremony.

    private func requestAssertion(challenge: Data) {
        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: harnessRpId)
        let request = provider.createCredentialAssertionRequest(challenge: challenge)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
    }

    // MARK: - Step 4/5: extract the assertion, (maybe) corrupt it, POST to the fixture's own
    // independent verifier.

    fileprivate func handleAssertion(_ assertion: ASAuthorizationPlatformPublicKeyCredentialAssertion) {
        print("PVHARNESS|stage=ceremony status=ok")
        statusText = "Verifying..."
        var signatureBytes: Data = assertion.signature
        if corruptSignature, signatureBytes.count > 0 {
            signatureBytes[signatureBytes.startIndex] ^= 0xFF
            print("PVHARNESS|stage=corrupt status=applied")
        }
        let payload = AssertCredentialPayload(
            id: Base64URL.encode(assertion.credentialID),
            rawId: Base64URL.encode(assertion.credentialID),
            type: "public-key",
            response: AssertResponsePayload(
                authenticatorData: Base64URL.encode(assertion.rawAuthenticatorData),
                clientDataJSON: Base64URL.encode(assertion.rawClientDataJSON),
                signature: Base64URL.encode(signatureBytes),
                userHandle: assertion.userID.isEmpty ? nil : Base64URL.encode(assertion.userID)
            ),
            clientExtensionResults: [:]
        )
        Task {
            await postFinish(payload: payload)
        }
    }

    private func postFinish(payload: AssertCredentialPayload) async {
        guard let url = URL(string: "\(fixtureBaseURL)/assert/finish?rp_id=\(harnessRpId)") else {
            statusText = "Failed: bad fixture URL"
            return
        }
        do {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(payload)
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw NativeSignInError.finishRequestFailed
            }
            let result = try JSONDecoder().decode(VerifyResult.self, from: data)
            print("PVHARNESS|stage=network status=ok ok=\(result.ok) reason=\(result.reason)")
            statusText = result.ok ? "Signed in" : "Failed: \(result.reason)"
            print("PVHARNESS|stage=complete status=\(result.ok ? "ok" : "failed")")
        } catch {
            print("PVHARNESS|stage=network status=failed reason=\(error)")
            statusText = "Failed: \(error)"
            print("PVHARNESS|stage=complete status=failed")
        }
    }
}

extension NativeSignInCoordinator: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let assertion = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialAssertion else {
            print("PVHARNESS|stage=ceremony status=failed reason=unexpected-credential-type")
            statusText = "Failed: unexpected credential type"
            print("PVHARNESS|stage=complete status=failed")
            return
        }
        handleAssertion(assertion)
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        print("PVHARNESS|stage=ceremony status=failed reason=\(error)")
        statusText = "Failed: \(error.localizedDescription)"
        print("PVHARNESS|stage=complete status=failed")
    }
}

extension NativeSignInCoordinator: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
           let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first {
            return window
        }
        return ASPresentationAnchor()
    }
}

struct NativeSignInView: View {
    @StateObject private var coordinator = NativeSignInCoordinator()

    var body: some View {
        VStack(spacing: 24) {
            Text("PasskeyVaultHarness")
                .font(.headline)
            Text("TEST-ONLY -- ROADMAP SC2 proof surface. rp_id=\(harnessRpId)")
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Sign In") {
                coordinator.signIn()
            }
            .accessibilityIdentifier("nativeSignIn.button")
            Text(coordinator.statusText)
                .accessibilityIdentifier("nativeSignIn.status")
        }
        .padding()
    }
}
