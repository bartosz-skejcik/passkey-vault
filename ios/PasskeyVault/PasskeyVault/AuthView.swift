//
//  AuthView.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. Sign-in +
//  registration, one view with a mode switch -- mirrors the web app's own
//  `LoginForm.tsx`/`RegisterForm.tsx` toggle pattern (`37-UI-SPEC.md`
//  `## Screen Inventory`). Every user-visible string routes through
//  `t(_:)` -- no bare string literal handed directly to a `Text` view in this file.
//

import SwiftUI

struct AuthView: View {
    enum Mode {
        case signIn
        case register
    }

    let apiClient: PvApiClient
    let onUnlocked: (UnlockedSession) -> Void

    @State private var mode: Mode = .signIn
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var isPasswordRevealed = false
    @State private var isProcessing = false
    @State private var bannerMessage: String?
    @State private var showValidationErrors = false

    private var passwordsLiveMismatch: Bool {
        mode == .register && !password.isEmpty && !confirmPassword.isEmpty && password != confirmPassword
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                // Item 1: app name, plain, not localized (37-UI-SPEC.md).
                Text(verbatim: "Passkey Vault")
                    .font(.title)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color("PVTextPrimary"))

                fieldGroup(labelKey: .authEmailLabel) {
                    TextField("", text: $email)
                        .textContentType(.emailAddress)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                }
                if showValidationErrors && email.isEmpty {
                    Text(t(.validationRequired)).font(.footnote).foregroundStyle(Color("PVError"))
                }

                fieldGroup(labelKey: .authPasswordLabel) {
                    passwordField(text: $password)
                }
                if showValidationErrors && password.isEmpty {
                    Text(t(.validationRequired)).font(.footnote).foregroundStyle(Color("PVError"))
                }

                if mode == .register {
                    fieldGroup(labelKey: .authConfirmPasswordLabel) {
                        passwordField(text: $confirmPassword)
                    }
                    if passwordsLiveMismatch {
                        Text(t(.validationPasswordMismatch))
                            .font(.footnote)
                            .foregroundStyle(Color("PVError"))
                    } else if showValidationErrors && confirmPassword.isEmpty {
                        Text(t(.validationRequired)).font(.footnote).foregroundStyle(Color("PVError"))
                    }

                    Text(t(.authIrrecoverableWarning))
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                        .fixedSize(horizontal: false, vertical: true)
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

                Button(action: submit) {
                    Group {
                        if isProcessing {
                            ProgressView()
                        } else {
                            Text(mode == .signIn ? t(.authLoginSubmit) : t(.authRegisterSubmit))
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: 48)
                }
                .disabled(isProcessing)
                .tint(Color("PVAccent"))
                .buttonStyle(.borderedProminent)

                Button(action: toggleMode) {
                    Text(mode == .signIn ? t(.authToggleToRegister) : t(.authToggleToLogin))
                }
                .tint(Color("PVAccent"))
                .disabled(isProcessing)
            }
            .padding()
            .disabled(isProcessing)
            .opacity(isProcessing ? 0.5 : 1.0)
        }
        .background(Color("PVBackground"))
    }

    @ViewBuilder
    private func fieldGroup<Content: View>(labelKey: PVKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(t(labelKey))
                .font(.footnote)
                .foregroundStyle(Color("PVTextMuted"))
            content()
        }
    }

    @ViewBuilder
    private func passwordField(text: Binding<String>) -> some View {
        HStack {
            if isPasswordRevealed {
                TextField("", text: text)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
            } else {
                SecureField("", text: text)
            }
            Button(action: { isPasswordRevealed.toggle() }) {
                Image(systemName: isPasswordRevealed ? "eye.slash" : "eye")
                    .frame(width: 44, height: 44)
            }
            .accessibilityLabel(isPasswordRevealed ? t(.ariaHidePassword) : t(.ariaShowPassword))
            .tint(Color("PVAccent"))
        }
    }

    private func toggleMode() {
        mode = (mode == .signIn) ? .register : .signIn
        bannerMessage = nil
        showValidationErrors = false
    }

    private func submit() {
        showValidationErrors = true
        guard !email.isEmpty, !password.isEmpty else { return }
        if mode == .register {
            guard !confirmPassword.isEmpty, password == confirmPassword else { return }
        }

        bannerMessage = nil
        isProcessing = true
        Task {
            defer { isProcessing = false }
            let service = AccountService(apiClient: apiClient)
            do {
                let session: UnlockedSession
                switch mode {
                case .signIn:
                    session = try await service.signIn(email: email, password: password)
                case .register:
                    session = try await service.register(email: email, password: password)
                }
                try? BiometricUnlockService.enrol(userKey: session.userKey)
                onUnlocked(session)
            } catch let error as PvApiError {
                bannerMessage = Self.message(for: error, mode: mode)
            } catch {
                bannerMessage = t(mode == .signIn ? .authLoginFailed : .authRegistrationFailed)
            }
        }
    }

    private static func message(for error: PvApiError, mode: Mode) -> String {
        switch error {
        case .invalidCredentials:
            return t(.authWrongCredentials)
        case let .httpError(status, _):
            if mode == .register && status == 409 {
                return t(.authDuplicateEmail)
            }
            return t(mode == .signIn ? .authLoginFailed : .authRegistrationFailed)
        case .network:
            return t(.appServerUnreachable)
        case .unexpectedResponse:
            return t(mode == .signIn ? .authLoginFailed : .authRegistrationFailed)
        }
    }
}
