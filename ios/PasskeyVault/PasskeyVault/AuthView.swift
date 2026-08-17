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

    /// `initialMode` lets Phase 38's onboarding (`OnboardingWelcomeStep`'s
    /// two controls) land the flow on sign-in or registration without a
    /// second, redundant `@AppStorage` flag -- `ContentView` passes through
    /// the `OnboardingEntryIntent` it received from `OnboardingView`'s
    /// completion callback. Defaulted to `.signIn` so every other existing
    /// call site (and every test) is unaffected.
    init(apiClient: PvApiClient, initialMode: Mode = .signIn, onUnlocked: @escaping (UnlockedSession) -> Void) {
        self.apiClient = apiClient
        self.onUnlocked = onUnlocked
        _mode = State(initialValue: initialMode)
    }

    @State private var mode: Mode
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
        // `PVScreenScaffold` carries the approved layout: content top, a
        // `flex:1` spacer, action stack pinned to the BOTTOM with a 9pt gap,
        // 20pt horizontal page padding. All four numbers come from the
        // artifact's own stylesheet via `PVMetrics` -- see `Core/PVDesign.swift`
        // for why they live in one place now.
        PVScreenScaffold {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                // The title names the ACTION, not the app -- "Sign in" /
                // "Create your vault", per the approved visual reference
                // (artifact "Passkey Vault iOS Screens", §"Auth"). Phase 37
                // shipped the static app name here; 38-13 left it because the
                // design spec's §4 says "Structure is unchanged", which is
                // about LAYOUT, not copy. Corrected 2026-08-17.
                //
                // The preposition is mode-specific and comes from two
                // dictionary keys, never interpolation: you sign in TO a
                // server, you create a vault ON one, and Polish's "do"/"na"
                // govern different cases so no single template covers both.
                PVScreenTitle(
                    title: t(mode == .signIn ? .authSignInTitle : .authRegisterTitle),
                    subtitle: t(
                        mode == .signIn ? .authServerSubtitle : .authServerSubtitleRegister,
                        ["host": ServerSettings.resolved.host ?? ServerSettings.resolved.absoluteString]
                    )
                )
                .accessibilityIdentifier("auth-title")

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

                    // A PVWarning CALLOUT, not muted footnote text. The design
                    // spec §4 says "inline `PVWarning` callout" in those
                    // words, and the approved screens draw it as a tinted
                    // block with a dot. Rendering irreversibility in the same
                    // grey as a field hint is the one thing this copy must not
                    // do -- it is the only genuinely unrecoverable action in
                    // the whole product.
                    StatusCallout(text: t(.authIrrecoverableWarning), tone: .warning)
                        .accessibilityIdentifier("auth-irrecoverable-warning")
                } else {
                    // Sign-in states the same fact as reassurance, not as a
                    // warning: nothing irreversible happens on this screen, so
                    // a PVWarning treatment here would cry wolf and dull the
                    // register one.
                    Text(t(.authSignInReassurance))
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("auth-signin-reassurance")
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

                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } actions: {
            Button(action: submit) {
                Group {
                    if isProcessing {
                        ProgressView().tint(Color("PVOnAccent"))
                    } else {
                        Text(mode == .signIn ? t(.authLoginSubmit) : t(.authRegisterSubmit))
                    }
                }
            }
            .disabled(isProcessing)
            .buttonStyle(PVPrimaryButtonStyle(isEnabled: !isProcessing))
            // Stable identifiers so UI tests stop targeting these controls by
            // their visible copy -- correcting the copy broke four test files
            // that tapped `app.buttons["Log in"]`.
            .accessibilityIdentifier("auth-submit")

            Button(action: toggleMode) {
                Text(mode == .signIn ? t(.authToggleToRegister) : t(.authToggleToLogin))
            }
            .disabled(isProcessing)
            .buttonStyle(PVGhostButtonStyle(isEnabled: !isProcessing))
            .accessibilityIdentifier("auth-toggle-mode")
        }
    }

    @ViewBuilder
    private func fieldGroup<Content: View>(labelKey: PVKey, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(t(labelKey))
                .font(.footnote)
                .foregroundStyle(Color("PVTextMuted"))
            // The field sits ON `PVSurface`, as a rounded block. A bare
            // `TextField` on `PVBackground` has no visible edge at all: the
            // label reads as a heading and the input as empty space, which is
            // what shipped until 2026-08-17. The approved screens draw every
            // input as a surface-filled 11pt-radius row (the reference's own
            // `.field` rule), and `PVSurface` exists in the token table for
            // exactly this -- "cards, list cells, fields, sheets".
            // `.field`: PVSurface, 11pt radius, 12/14 padding, 46pt minimum
            // height -- all from `PVMetrics`, so this and every other field in
            // the app cannot drift apart.
            content().pvFieldChrome()
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
