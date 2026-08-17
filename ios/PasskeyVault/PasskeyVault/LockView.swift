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
import UIKit

struct LockView: View {
    let apiClient: PvApiClient
    let account: RestoredAccount
    let onUnlocked: (UnlockedSession) -> Void

    private enum BiometricSlotState: Equatable {
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
    /// Phase 38, plan 38-13, Task 4: the irreversibility warning is now
    /// inline (a `PVWarning` callout inside the scrolling form), never a
    /// `UIAlertController` -- `37-VERIFICATION.md`'s residual item recorded
    /// that copy visibly clipped mid-sentence at AX5 inside the alert, and
    /// the alert's scroll was never driven. This flag reveals the SAME
    /// copy inline instead, where it can actually be scrolled to and read.
    @State private var showForgotPasswordWarning = false
    @State private var availability: BiometryAvailability?
    /// Phase 38, plan 38-08 (Rule 2 deviation -- `GeneratorSheet.swift`'s
    /// own acceptance criteria require a screenshot proving the sheet
    /// "reachable and generating from the locked state," and no entry
    /// point into it existed anywhere in the app yet; 38-09's create/edit
    /// form -- the sheet's REAL, permanent entry point next to a password
    /// field -- has not landed. Mirrors the SAME `#if DEBUG` /
    /// `applyForcedUITestState` pattern this file already uses for the
    /// biometric-slot screenshot matrix, never reachable outside a DEBUG
    /// build driven by `PV_UITEST_LOCK_STATE`.
    @State private var showGeneratorSheet = false
    /// `37-CONTEXT.md`'s locked decision, restated verbatim in
    /// `37-UI-SPEC.md:272`: once the envelope is invalidated by a
    /// biometric-set change, focus moves to the password field -- "the way
    /// out is inside the message." Driven centrally by the `onChange`
    /// below rather than set at each individual call site that can produce
    /// `.envelopeInvalidated`, so the DEBUG screenshot-matrix hook
    /// (`applyForcedUITestState`) exercises the exact same focus behaviour
    /// a real biometric-set-changed unlock would.
    @FocusState private var isPasswordFieldFocused: Bool

    var body: some View {
        // Same `PVScreenScaffold` as AuthView: content top, flex-1 spacer,
        // action stack pinned to the bottom. Lock kept hand-built spacing until
        // 2026-08-17 and visibly drifted from auth as a result.
        PVScreenScaffold {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                // The approved screens (artifact "Passkey Vault iOS Screens",
                // §"Lock — the state machine, drawn") put a Face ID glyph and
                // the title first, and demote the account to a muted line.
                // What shipped had the email as the biggest thing on screen in
                // `.title3.semibold`, no glyph, and "Unlock your vault" as the
                // title -- an instruction that duplicated the primary button.
                //
                // Nine states, ONE layout: they differ only in the status slot
                // and which control is emphasised. That is the whole reason
                // this is a single view.
                if biometryIsOffered {
                    Image(systemName: "faceid")
                        .font(.system(size: 52, weight: .light))
                        .foregroundStyle(Color("PVAccent"))
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, PVMetrics.authTitleTopSpace)
                        .accessibilityHidden(true)
                }

                PVScreenTitle(
                    title: t(.unlockHeading),
                    subtitle: account.email.isEmpty
                        ? nil
                        : t(.unlockSignedInAs, ["email": account.email]),
                    topSpace: biometryIsOffered ? PVMetrics.titleTopSpace : PVMetrics.authTitleTopSpace
                )
                .accessibilityIdentifier("lock-title")

                // THE status slot. Every non-idle state renders here and
                // nowhere else, through the one shared `StatusCallout`, so the
                // nine states read as one machine.
                if let slot = statusSlot {
                    StatusCallout(text: slot.text, tone: slot.tone)
                        .accessibilityIdentifier("lock-status-slot")
                }


                // Placeholder inside the field, one shared 46pt chrome --
                // identical to AuthView's, so the same control does not look
                // like two different controls across two screens.
                HStack(spacing: 8) {
                    Group {
                        if isPasswordRevealed {
                            TextField("", text: $password, prompt: lockPrompt)
                                .autocorrectionDisabled()
                                #if os(iOS)
                                .textInputAutocapitalization(.never)
                                #endif
                                .focused($isPasswordFieldFocused)
                                .accessibilityIdentifier("unlock-password-field")
                        } else {
                            SecureField("", text: $password, prompt: lockPrompt)
                                .focused($isPasswordFieldFocused)
                                .accessibilityIdentifier("unlock-password-field")
                        }
                    }
                    .font(.system(size: 16))

                    Button(action: { isPasswordRevealed.toggle() }) {
                        Image(systemName: isPasswordRevealed ? "eye.slash" : "eye")
                            .frame(width: 22, height: 22)
                            .contentShape(Rectangle().size(width: 44, height: PVMetrics.fieldMinHeight))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(Color("PVAccent"))
                    .accessibilityLabel(isPasswordRevealed ? t(.ariaHidePassword) : t(.ariaShowPassword))
                }
                .pvFieldChrome()
                .accessibilityLabel(t(.authPasswordLabel))

                if isProcessing {
                    Text(t(.appProcessingHint))
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                }

                if showForgotPasswordWarning {
                    // Inline, not an alert. Readable at AX5 by scrolling --
                    // which is what retires 37-VERIFICATION.md's clipped-copy
                    // residual instead of re-testing it.
                    StatusCallout(text: t(.authIrrecoverableWarning), tone: .warning)
                        .accessibilityIdentifier("lock-forgot-password-warning")
                }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        } actions: {
            if let availability, biometryIsOffered {
                biometricPrimaryButton(availability: availability)
            }

            Button(action: submitPassword) {
                Group {
                    if isProcessing {
                        ProgressView().tint(biometryIsOffered ? Color("PVAccent") : Color("PVOnAccent"))
                    } else {
                        Text(t(.unlockSubmit))
                    }
                }
            }
            .disabled(isProcessing)
            // State 1 emphasises Face ID, so the password submit becomes the
            // ghost there; in the other eight states it is the primary.
            .buttonStyle(PVPrimaryButtonStyle(isEnabled: !isProcessing))
            .opacity(biometryIsOffered ? 0 : 1)
            .frame(height: biometryIsOffered ? 0 : PVMetrics.buttonHeight)
            .accessibilityIdentifier("lock-password-submit")

            if biometryIsOffered {
                Button(action: submitPassword) {
                    Text(t(.unlockUseMasterPassword))
                }
                .disabled(isProcessing)
                .buttonStyle(PVGhostButtonStyle(isEnabled: !isProcessing))
                .accessibilityIdentifier("lock-use-master-password")
            }

            if availability?.requiresDevicePasscode == true {
                Button {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                } label: {
                    Text(t(.unlockOpenSettings))
                }
                .disabled(isProcessing)
                .buttonStyle(PVGhostButtonStyle(isEnabled: !isProcessing))
                .accessibilityIdentifier("lock-open-settings")
            }

            Button(action: { showForgotPasswordWarning.toggle() }) {
                Text(t(.authForgotPasswordCta))
            }
            .disabled(isProcessing)
            .buttonStyle(PVGhostButtonStyle(isEnabled: !isProcessing))
            .accessibilityIdentifier("lock-forgot-password-cta")
        }
        .background(Color("PVBackground"))
        .onAppear(perform: setUpOnAppear)
        .onChange(of: biometricState) { _, newState in
            // 37-CONTEXT.md lock / 37-UI-SPEC.md:272: envelope-invalidated
            // moves focus to the password field. Every path that can
            // produce `.envelopeInvalidated` (the real
            // `attemptBiometricUnlock` outcome switch, and the DEBUG
            // screenshot-matrix hook) goes through this single `onChange`,
            // so the behaviour cannot drift between the real and forced
            // paths.
            if newState == .envelopeInvalidated {
                isPasswordFieldFocused = true
            }
        }
        // Phase 38, plan 38-08 (Rule 2 deviation, see `showGeneratorSheet`'s
        // own doc comment): the generator is a FREE function taking no key
        // handle (DR-38-A) -- presenting it here, over the locked screen,
        // demonstrates that architectural fact rather than merely asserting
        // it. `GeneratorSheet` itself never reads `account`/`apiClient`/any
        // unlocked-session state.
        .sheet(isPresented: $showGeneratorSheet) {
            GeneratorSheet()
        }
    }

    @ViewBuilder
    /// State 1/2: biometry is genuinely on offer, so the glyph and the Face ID
    /// primary belong on screen. Anything else falls through to the password
    /// path, which is always present -- never hidden behind a menu.
    private var lockPrompt: Text {
        Text(t(.authPasswordLabel))
            .foregroundColor(Color("PVTextMuted").opacity(PVMetrics.placeholderOpacity))
    }

    private var biometryIsOffered: Bool {
        guard let availability, availability.isAvailable else { return false }
        return biometricState == .idle
    }

    /// The single status slot the nine states share. `nil` for state 1 (nothing
    /// has gone wrong yet) and state 9 (the spinner speaks for itself).
    private var statusSlot: (text: String, tone: StatusCallout.Tone)? {
        // A failed unlock outranks a biometric note: it is what the user just
        // did, and it is the thing they need to act on.
        if let bannerMessage {
            return (bannerMessage, .error)
        }
        switch biometricState {
        case .envelopeInvalidated:
            return (t(.unlockEnvelopeInvalidated), .warning)
        case .biometryLockedOut:
            return (t(.unlockBiometryLockedOut), .error)
        case .biometryDenied:
            return (t(.unlockBiometryDenied), .muted)
        case .idle:
            break
        }
        // States 3 and 7, both muted: the vault still opens, just not with a
        // face. State 7's copy is the surfaced form of ACC-03's write-time
        // refusal, which is why that protection class was chosen.
        if let availability, !availability.isAvailable {
            return availability.requiresDevicePasscode
                ? (t(.unlockNoPasscodeSlot), .muted)
                : (t(.unlockBiometryUnavailableSlot), .muted)
        }
        return nil
    }

    /// State 1's PRIMARY action. The approved screens make Face ID the primary
    /// and keep the password one tap away as a ghost -- never hidden behind a
    /// menu. The former `biometricSlot` also rendered the three biometric error
    /// texts; those moved into `statusSlot`, so all nine states share one slot.
    private func biometricPrimaryButton(availability: BiometryAvailability) -> some View {
        Button(action: { attemptBiometricUnlock(availability: availability) }) {
            HStack(spacing: 8) {
                Image(systemName: "faceid")
                Text(biometricCtaText(availability: availability))
            }
            .foregroundStyle(Color("PVOnAccent"))
            .frame(maxWidth: .infinity, minHeight: 48)
        }
        .disabled(isProcessing)
        .tint(Color("PVAccent"))
        .buttonStyle(.borderedProminent)
        .accessibilityIdentifier("lock-biometric-primary")
    }

    private func biometricCtaText(availability: BiometryAvailability) -> String {
        t(.unlockBiometricCta, ["method": availability.methodName])
    }

    private func setUpOnAppear() {
        #if DEBUG
        // TEST-ONLY (Task 5 screenshot matrix). See `ContentView`'s matching
        // hook comment for the rationale and the repo-wide precedent this
        // follows. Bypasses the real `BiometricUnlockService`/Keychain round
        // trip entirely so every documented slot state renders
        // deterministically for a screenshot, without needing Face ID
        // actually enrolled in the simulator (a state Task 5's own matrix
        // records as NOT-PRODUCIBLE here where it cannot be).
        if let forcedState = ProcessInfo.processInfo.environment["PV_UITEST_LOCK_STATE"] {
            // Deferred one runloop tick (`Task { @MainActor in ... }`, not a
            // direct synchronous call): mirrors the REAL
            // `attemptBiometricUnlock` path, where `.envelopeInvalidated`
            // is only ever reached after an `await` completes, well after
            // the view has finished its initial appearance -- setting
            // `@FocusState` synchronously during `onAppear` itself, before
            // the window/responder chain has settled, is unreliable and
            // silently drops the focus request (verified empirically: the
            // WR-03/FIX-3 focus test failed with the same code applying
            // this state synchronously, and passed once deferred).
            Task { @MainActor in
                applyForcedUITestState(forcedState)
            }
            return
        }
        #endif
        let currentAvailability = BiometricUnlockService.biometryAvailability()
        availability = currentAvailability

        guard currentAvailability.isAvailable, !didAutoPromptBiometrics else { return }
        didAutoPromptBiometrics = true
        attemptBiometricUnlock(availability: currentAvailability)
    }

    #if DEBUG
    private func applyForcedUITestState(_ raw: String) {
        let fakeAvailability = BiometryAvailability(isAvailable: true, methodName: "Face ID", biometryStateHash: nil)
        switch raw {
        case "idle":
            availability = fakeAvailability
            biometricState = .idle
        case "envelopeInvalidated":
            availability = fakeAvailability
            biometricState = .envelopeInvalidated
        case "biometryLockedOut":
            availability = fakeAvailability
            biometricState = .biometryLockedOut
        case "biometryDenied":
            availability = fakeAvailability
            biometricState = .biometryDenied
        case "processing":
            availability = fakeAvailability
            biometricState = .idle
            isProcessing = true
        case "banner":
            availability = fakeAvailability
            biometricState = .idle
            bannerMessage = t(.appServerUnreachable)
        // Phase 38, plan 38-13, Task 4: renamed from "forgotAlert" -- it no
        // longer presents an alert, it reveals the inline warning. Drives
        // the SAME `showForgotPasswordWarning` flag the real button toggles,
        // so the screenshot evidence and the user's experience cannot
        // diverge (the "backstop" truth this plan names explicitly).
        case "forgotWarning":
            availability = fakeAvailability
            biometricState = .idle
            showForgotPasswordWarning = true
        // §5 state 5, "Wrong password": added so the screenshot matrix can
        // capture this state distinctly from state 8 ("Offline", the
        // existing "banner" case above) -- both render through the same
        // `bannerMessage` slot today (a pre-existing gap from the
        // one-layout design recorded in this plan's SUMMARY rather than
        // fixed here, since fixing it would mean giving the two states
        // different visual treatment, which is a restructuring this plan's
        // own prohibitions rule out).
        case "wrongPassword":
            availability = fakeAvailability
            biometricState = .idle
            bannerMessage = t(.authWrongCredentials)
        case "noBiometry":
            availability = BiometryAvailability(isAvailable: false, methodName: "Face ID", biometryStateHash: nil)
            biometricState = .idle
        // Phase 38, plan 38-08: presents `GeneratorSheet` over the locked
        // screen for the "reachable and generating from the locked state"
        // screenshot -- see `showGeneratorSheet`'s own doc comment.
        case "generatorSheet":
            availability = fakeAvailability
            biometricState = .idle
            showGeneratorSheet = true
        default:
            break
        }
    }
    #endif

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
