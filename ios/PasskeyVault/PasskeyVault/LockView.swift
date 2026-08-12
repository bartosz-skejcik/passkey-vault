//
//  LockView.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. The lock/unlock
//  screen: biometric status slot (auto-invoked once per `onAppear`, per the
//  37-CONTEXT.md cold-launch lock) -> `unlock.orDivider` -> the ALWAYS
//  present, always enabled password path -> `unlock.submit` -> the honest
//  forgot-password dead end. Every user-visible string routes through
//  `t(_:)` -- no bare string literal handed directly to a `Text` view in this file.
//
//  This view builds the MECHANISM only. It does not, and must not, claim
//  that biometric ENFORCEMENT was observed -- 37-05 owns that observation.
//

import SwiftUI

struct LockView: View {
    let apiClient: PvApiClient
    let account: RestoredAccount
    let onUnlocked: (UnlockedSession) -> Void

    private enum BiometricSlotState {
        case idle
        case envelopeInvalidated
        case biometryLockedOut
        case biometryDenied
    }

    @State private var password = ""
    @State private var isPasswordRevealed = false
    @State private var isProcessing = false
    @State private var bannerMessage: String?
    @State private var biometricState: BiometricSlotState = .idle
    @State private var didAutoPromptBiometrics = false
    @State private var showForgotPasswordAlert = false
    @State private var availability: BiometryAvailability?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !account.email.isEmpty {
                    Text(t(.unlockSignedInAs, ["email": account.email]))
                        .font(.title3)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .foregroundStyle(Color("PVTextPrimary"))
                }

                Text(t(.unlockHeading))
                    .font(.title)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color("PVTextPrimary"))

                if let availability, availability.isAvailable {
                    biometricSlot(availability: availability)

                    Text(t(.unlockOrDivider))
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text(t(.authPasswordLabel))
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                    HStack {
                        if isPasswordRevealed {
                            TextField("", text: $password)
                                .autocorrectionDisabled()
                                #if os(iOS)
                                .textInputAutocapitalization(.never)
                                #endif
                        } else {
                            SecureField("", text: $password)
                        }
                        Button(action: { isPasswordRevealed.toggle() }) {
                            Image(systemName: isPasswordRevealed ? "eye.slash" : "eye")
                                .frame(width: 44, height: 44)
                        }
                        .accessibilityLabel(isPasswordRevealed ? t(.ariaHidePassword) : t(.ariaShowPassword))
                        .tint(Color("PVAccent"))
                    }
                }

                if let bannerMessage {
                    Text(bannerMessage)
                        .font(.footnote)
                        .foregroundStyle(Color("PVError"))
                        .padding(8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Color("PVSurface"))
                }

                if isProcessing {
                    Text(t(.appProcessingHint))
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                }

                Button(action: submitPassword) {
                    Group {
                        if isProcessing {
                            ProgressView()
                        } else {
                            Text(t(.unlockSubmit))
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 48)
                }
                .disabled(isProcessing)
                .tint(Color("PVAccent"))
                .buttonStyle(.borderedProminent)

                Button(action: { showForgotPasswordAlert = true }) {
                    Text(t(.authForgotPasswordCta))
                }
                .tint(Color("PVAccent"))
                .disabled(isProcessing)
            }
            .padding()
            .disabled(isProcessing)
            .opacity(isProcessing ? 0.5 : 1.0)
        }
        .background(Color("PVBackground"))
        .onAppear(perform: setUpOnAppear)
        .alert(t(.authForgotPasswordCta), isPresented: $showForgotPasswordAlert) {
            // No action, no recovery path -- none exists.
        } message: {
            Text(t(.authIrrecoverableWarning))
        }
    }

    @ViewBuilder
    private func biometricSlot(availability: BiometryAvailability) -> some View {
        switch biometricState {
        case .idle:
            Button(action: { attemptBiometricUnlock(availability: availability) }) {
                Text(biometricCtaText(availability: availability))
            }
            .disabled(isProcessing)
            .buttonStyle(.bordered)
            .tint(Color("PVAccent"))
        case .envelopeInvalidated:
            Text(t(.unlockEnvelopeInvalidated))
                .font(.footnote)
                .foregroundStyle(Color("PVError"))
                .fixedSize(horizontal: false, vertical: true)
        case .biometryLockedOut:
            Text(t(.unlockBiometryLockedOut))
                .font(.footnote)
                .foregroundStyle(Color("PVError"))
                .fixedSize(horizontal: false, vertical: true)
        case .biometryDenied:
            Text(t(.unlockBiometryDenied))
                .font(.footnote)
                .foregroundStyle(Color("PVError"))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func biometricCtaText(availability: BiometryAvailability) -> String {
        t(.unlockBiometricCta, ["method": availability.methodName])
    }

    private func setUpOnAppear() {
        let currentAvailability = BiometricUnlockService.biometryAvailability()
        availability = currentAvailability

        guard currentAvailability.isAvailable, !didAutoPromptBiometrics else { return }
        didAutoPromptBiometrics = true
        attemptBiometricUnlock(availability: currentAvailability)
    }

    private func attemptBiometricUnlock(availability: BiometryAvailability) {
        Task {
            let outcome = await BiometricUnlockService.unlockWithBiometrics(reason: t(.unlockHeading))
            switch outcome {
            case let .unlocked(userKey):
                biometricState = .idle
                onUnlocked(UnlockedSession(token: account.token, userKey: userKey))
            case .envelopeInvalidated:
                biometricState = .envelopeInvalidated
            case .biometryLockedOut:
                biometricState = .biometryLockedOut
            case .biometryDenied:
                biometricState = .biometryDenied
            case .locked, .benignCancel:
                // Benign cancel: revert silently, no banner, no retry
                // counter. `.locked`: report "locked" via the idle button
                // remaining available for a manual retry -- never treated
                // as "missing".
                biometricState = .idle
            case .unexpected:
                biometricState = .idle
            }
        }
    }

    /// Reuses `AccountService.signIn` verbatim -- `preloginKdf` against the
    /// SERVER's own stored salt/params, `deriveAuthMaterial`, `POST login`
    /// (mints a fresh session token, replacing the stored one), then
    /// `unwrapUserKeyFromJson` against the account's `pw_wrapped_uk`. Never
    /// a second, hand-rolled derivation path -- this is the SAME tested
    /// route `AuthView`'s sign-in submit already exercises. On success, the
    /// biometric envelope is silently re-armed (37-CONTEXT.md's locked
    /// decision: no separate "re-enable Face ID" toggle for the user to
    /// tap).
    private func submitPassword() {
        guard !password.isEmpty else { return }
        bannerMessage = nil
        isProcessing = true
        Task {
            defer { isProcessing = false }
            let service = AccountService(apiClient: apiClient)
            do {
                let session = try await service.signIn(email: account.email, password: password)
                try? BiometricUnlockService.enrol(userKey: session.userKey)
                onUnlocked(session)
            } catch let error as PvApiError {
                bannerMessage = mapUnlockError(error)
            } catch {
                bannerMessage = t(.authWrongCredentials)
            }
        }
    }

    private func mapUnlockError(_ error: PvApiError) -> String {
        switch error {
        case .invalidCredentials:
            return t(.authWrongCredentials)
        case .network:
            return t(.appServerUnreachable)
        default:
            return t(.authWrongCredentials)
        }
    }
}
