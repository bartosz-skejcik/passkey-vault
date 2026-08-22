// NativeCreateView.swift -- `.planning/debug/passkey-reg-blank-sheet-discord.md` diagnostic,
// 2026-08-22. The REGISTRATION counterpart to `NativeSignInView.swift` (Plan 43-08's own SC2
// ASSERTION proof): a single "Create Passkey" button that requests a REAL native passkey
// REGISTRATION via `ASAuthorizationController`/`ASAuthorizationPlatformPublicKeyCredentialProvider
// .createCredentialRegistrationRequest(challenge:name:userID:)` -- the REQUESTING side, exactly
// like `NativeSignInView.swift`, just the sibling ceremony.
//
// WHY THIS FILE EXISTS: no prior plan in this codebase ever drove a passkey REGISTRATION request
// from a genuine native (non-Safari) app through the system's own credential-picker surface.
// 43-07/SC4 proved registration via SAFARI's own `navigator.credentials.create()` (a completely
// different requesting surface); 43-08/SC2 proved a native app's ASSERTION reaches PV's real
// extension, but never registration. That gap is exactly Bartek's real-device symptom shape
// (Discord, a native app, "Add a Passkey" -> blank white sheet) -- this view exists to settle,
// live, whether `CredentialProviderViewController.prepareInterface(forPasskeyRegistration:)` is
// even CALLED for this specific requesting surface, for both an UNLOCKED and a LOCKED vault.
//
// No `crates/rp-fixture` round trip is needed for this diagnostic (unlike `NativeSignInView`'s own
// SC2 proof, which must verify RECEIVER-side against an independent verifier) -- the question this
// view exists to answer is ROUTING ("did the system call our override at all, and what did it log
// doing so"), not cryptographic correctness of the resulting attestation. The challenge is
// therefore a locally-generated random 32 bytes, never fetched from a server -- `pv-provider`'s own
// authenticator signs whatever `clientDataHash` it is given; nothing downstream of this view
// verifies that signature for this diagnostic's purpose.
//
// `userID`/`name` are unique per launch (timestamp-suffixed) so a second run on the SAME
// already-registered simulator does not collide with `excludeCredentials` from a prior run.

import AuthenticationServices
import Combine
import SwiftUI
import os

private let createLogger = Logger(subsystem: "cloud.blonie.PasskeyVaultHarness", category: "register")

private let createRpId = "vault.blonie.cloud"

@MainActor
final class NativeCreateCoordinator: NSObject, ObservableObject {
    @Published var statusText: String = "Ready"

    func createPasskey() {
        createLogger.log("PVHARNESS|stage=start kind=register")
        statusText = "Requesting passkey creation..."

        var challenge = Data(count: 32)
        _ = challenge.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 32, $0.baseAddress!) }
        var userID = Data(count: 16)
        _ = userID.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, 16, $0.baseAddress!) }
        let userName = "ios-native-register-\(Int(Date().timeIntervalSince1970))"

        let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(relyingPartyIdentifier: createRpId)
        let request = provider.createCredentialRegistrationRequest(challenge: challenge, name: userName, userID: userID)
        let controller = ASAuthorizationController(authorizationRequests: [request])
        controller.delegate = self
        controller.presentationContextProvider = self
        createLogger.log("PVHARNESS|stage=performRequests rpId=\(createRpId, privacy: .public) userName=\(userName, privacy: .public)")
        controller.performRequests()
    }
}

extension NativeCreateCoordinator: ASAuthorizationControllerDelegate {
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        guard let registration = authorization.credential as? ASAuthorizationPlatformPublicKeyCredentialRegistration else {
            createLogger.error("PVHARNESS|stage=ceremony status=failed reason=unexpected-credential-type kind=register")
            statusText = "Failed: unexpected credential type"
            createLogger.log("PVHARNESS|stage=complete status=failed kind=register")
            return
        }
        createLogger.log(
            "PVHARNESS|stage=ceremony status=ok kind=register credentialIdLen=\(registration.credentialID.count, privacy: .public) hasAttestation=\(registration.rawAttestationObject != nil, privacy: .public)"
        )
        statusText = "Created"
        createLogger.log("PVHARNESS|stage=complete status=ok kind=register")
    }

    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        createLogger.error("PVHARNESS|stage=ceremony status=failed kind=register reason=\(String(describing: error), privacy: .public)")
        statusText = "Failed: \(error.localizedDescription)"
        createLogger.log("PVHARNESS|stage=complete status=failed kind=register")
    }
}

extension NativeCreateCoordinator: ASAuthorizationControllerPresentationContextProviding {
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
        if let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
           let window = scene.windows.first(where: { $0.isKeyWindow }) ?? scene.windows.first {
            return window
        }
        return ASPresentationAnchor()
    }
}

struct NativeCreateView: View {
    @StateObject private var coordinator = NativeCreateCoordinator()

    var body: some View {
        VStack(spacing: 24) {
            Text("Register a NEW passkey. rp_id=\(createRpId)")
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Create Passkey") {
                coordinator.createPasskey()
            }
            .accessibilityIdentifier("nativeCreate.button")
            Text(coordinator.statusText)
                .accessibilityIdentifier("nativeCreate.status")
        }
        .padding()
    }
}
