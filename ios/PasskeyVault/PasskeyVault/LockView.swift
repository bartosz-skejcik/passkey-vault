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

import Combine
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
    /// State 8 -- Offline (design-conformance §"38-11", addendum A3). Set
    /// two ways, both real: a `ServerReachability.check` probe on appear,
    /// and any unlock attempt that fails with a transport error (never a
    /// real invalid-credentials rejection, which stays state 5). Rendered
    /// through `statusSlot` as its OWN muted treatment, distinct from state
    /// 5's `PVError` banner -- the gap `38-13-SUMMARY.md`/design-
    /// conformance §"38-11" both named and left for this plan to close.
    @State private var isOffline = false
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
                    // STATE 1/2 -- the biometry-ready hero. Centred, 48pt from
                    // the top, a 56pt Face ID glyph, a 24pt title and a 15.5pt
                    // muted line. Crucially it has NO password field, NO account
                    // line and NO forgot link: the artifact's own markup for
                    // this state is a `.hero` div and a two-button stack, and
                    // nothing else. An earlier pass built the left-aligned form
                    // here and recorded it as a minor deviation; it is not
                    // minor, it is a different screen.
                    VStack(spacing: 6) {
                        Image(systemName: "faceid")
                            .font(.system(size: PVMetrics.faceIdGlyphSize, weight: .light))
                            .foregroundStyle(Color("PVAccent"))
                            .accessibilityHidden(true)
                        Text(t(.unlockHeading))
                            .font(.system(size: PVMetrics.lockHeroTitleSize, weight: .bold))
                            .foregroundStyle(Color("PVTextPrimary"))
                            .accessibilityIdentifier("lock-title")
                        Text(biometricCtaText(availability: availability ?? BiometryAvailability(
                            isAvailable: true, methodName: "Face ID", biometryStateHash: nil
                        )))
                            .font(.system(size: PVMetrics.heroBodySize))
                            .foregroundStyle(Color("PVTextMuted"))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: PVMetrics.heroBodyMaxWidth)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.top, PVMetrics.lockHeroTopSpace)
                } else {
                    PVScreenTitle(
                        title: t(.unlockHeading),
                        subtitle: account.email.isEmpty
                            ? nil
                            : t(.unlockSignedInAs, ["email": account.email]),
                        topSpace: PVMetrics.authTitleTopSpace
                    )
                    .accessibilityIdentifier("lock-title")

                    if let slot = statusSlot {
                        StatusCallout(text: slot.text, tone: slot.tone)
                            .accessibilityIdentifier("lock-status-slot")
                    }

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
                }

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
            .disabled(isProcessing || isThrottled)
            // State 1 emphasises Face ID, so the password submit becomes the
            // ghost there; in the other eight states it is the primary.
            .buttonStyle(PVPrimaryButtonStyle(isEnabled: !isProcessing && !isThrottled))
            .opacity(biometryIsOffered ? 0 : 1)
            .frame(height: biometryIsOffered ? 0 : PVMetrics.buttonHeight)
            .accessibilityIdentifier("lock-password-submit")

            if biometryIsOffered {
                Button(action: { prefersPasswordEntry = true }) {
                    Text(t(.unlockUseMasterPassword))
                }
                .disabled(isProcessing || isThrottled)
                .buttonStyle(PVGhostButtonStyle(isEnabled: !isProcessing && !isThrottled))
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
                .disabled(isProcessing || isThrottled)
                .buttonStyle(PVGhostButtonStyle(isEnabled: !isProcessing && !isThrottled))
                .accessibilityIdentifier("lock-open-settings")
            }

            // The forgot link belongs to the password states only. State 1's
            // markup carries exactly two controls.
            if !biometryIsOffered {
                Button(action: { showForgotPasswordWarning.toggle() }) {
                    Text(t(.authForgotPasswordCta))
                }
                .disabled(isProcessing || isThrottled)
                .buttonStyle(PVGhostButtonStyle(isEnabled: !isProcessing && !isThrottled))
                .accessibilityIdentifier("lock-forgot-password-cta")
            }
        }
        .background(Color("PVBackground"))
        .onAppear {
            restoreThrottleState()
            setUpOnAppear()
        }
        // Fires only while a throttle is running. `throttledUntil` is cleared
        // the moment it elapses, which stops the timer AND re-enables the
        // controls in the same update.
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { now in
            guard throttledUntil != nil else { return }
            tick = now
            if throttleRemaining == nil {
                throttledUntil = nil
                UserDefaults.standard.removeObject(forKey: Self.throttleDeadlineKey)
            }
        }
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

    /// Set by the "Use master password" ghost: leaves the hero and shows the
    /// password form, which is what "the password stays one tap away and is never
    /// hidden behind a menu" means in the artifact's own caption for state 1.
    @State private var prefersPasswordEntry = false

    // MARK: - Throttle (state 6) and the wrong-password count (state 5)
    //
    // POLICY, decided 2026-08-17 and stated rather than buried: FIVE attempts,
    // then a THIRTY second wait. The deadline is persisted, so force-quitting
    // the app does not clear it.
    //
    // THIS IS NOT A SECURITY CONTROL, and must never be described as one. An
    // attacker holding the device can delete and reinstall the app, or ignore it
    // entirely and attack the stored ciphertext offline. What actually protects
    // the vault against guessing is Argon2id at 64 MiB / t=3 -- a cost this
    // counter does not add to. This exists so a mistyped password says something
    // useful, and so a pocket-dial cannot burn through attempts silently.
    // `pv-server` enforces nothing of the kind; if real rate limiting is wanted
    // it belongs there, and would be a different decision.
    private static let maxAttemptsBeforeThrottle = 5
    private static let throttleSeconds: TimeInterval = 30
    private static let throttleDeadlineKey = "pv.lock.throttleUntil"

    @State private var failedAttempts = 0
    @State private var throttledUntil: Date?
    /// Ticked once a second only while a throttle is running, so the countdown
    /// is live without a timer firing for the entire life of the screen.
    @State private var tick = Date()

    /// Whole seconds left, or `nil` when not throttled.
    private var throttleRemaining: Int? {
        guard let throttledUntil else { return nil }
        let left = Int(ceil(throttledUntil.timeIntervalSince(tick)))
        return left > 0 ? left : nil
    }

    private var isThrottled: Bool { throttleRemaining != nil }

    /// `nil` until a password has actually been rejected.
    @State private var attemptsLeft: Int?

    private var biometryIsOffered: Bool {
        if prefersPasswordEntry { return false }
        guard let availability, availability.isAvailable else { return false }
        return biometricState == .idle
    }

    /// The single status slot the nine states share. `nil` for state 1 (nothing
    /// has gone wrong yet) and state 9 (the spinner speaks for itself).
    private var statusSlot: (text: String, tone: StatusCallout.Tone)? {
        // State 6 outranks everything: while it is running, nothing else the
        // user could read changes what they can do.
        if let left = throttleRemaining {
            return (t(.unlockThrottledSlot, ["seconds": String(left)]), .error)
        }
        // State 5 -- the artifact states the consequence BEFORE it arrives, so
        // the throttle is never a surprise. `authWrongCredentials` ("Invalid
        // email or password") was rendering here instead, which says nothing
        // about what is about to happen.
        if let left = attemptsLeft {
            return (
                t(.unlockWrongPasswordSlot, ["attempts": String(left), "wait": String(Int(Self.throttleSeconds))]),
                .error
            )
        }
        // State 8 -- Offline. Outranks the generic banner (a transport
        // failure now routes HERE, never into `bannerMessage` -- see
        // `submitPassword`'s catch branch) and stays BELOW states 5/6: a
        // throttle or a wrong-password count already in progress from a
        // still-reachable earlier attempt is more specific than "can't
        // reach the server right now" and must not be masked by it.
        // Distinct MUTED treatment from state 5's `PVError`, per
        // design-conformance's own gap table -- the vault still opens
        // (Unlock stays offered), the copy just tells the truth about sync.
        if isOffline {
            return (t(.unlockOfflineSlot), .muted)
        }
        // Any other failure (unexpected, non-transport) keeps the banner.
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
        }
        .disabled(isProcessing || isThrottled)
        // `PVPrimaryButtonStyle`, not `.borderedProminent`: on iOS 26 the system
        // prominent style renders a CAPSULE, and the artifact's `.btn` is a 12pt
        // radius. This one was missed when auth and onboarding were converted.
        .buttonStyle(PVPrimaryButtonStyle(isEnabled: !isProcessing && !isThrottled))
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

        probeReachabilityOnAppear()

        guard currentAvailability.isAvailable, !didAutoPromptBiometrics else { return }
        didAutoPromptBiometrics = true
        attemptBiometricUnlock(availability: currentAvailability)
    }

    /// State 8's OTHER trigger (addendum A3): a real probe against the
    /// configured server, run once per appearance -- independent of whether
    /// the user ever attempts an unlock. `ServerReachability.check` is the
    /// SAME probe 38-12's onboarding "Server" step already uses; reusing it
    /// here means this screen and that one can never disagree about what
    /// "reachable" means.
    private func probeReachabilityOnAppear() {
        Task {
            let result = await ServerReachability.check(apiClient.baseURL)
            switch result {
            case .reachable:
                isOffline = false
            case .unreachable, .wrongServer:
                isOffline = true
            }
        }
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
        // State 8, "Offline" (addendum A3, plan 38-11) -- drives the SAME
        // `isOffline` property both real triggers (the on-appear probe and a
        // transport-failed unlock attempt) set, so this screenshot cannot
        // drift from the real muted treatment `statusSlot` now gives it,
        // distinct from state 5/the generic "banner" case above.
        case "offline":
            availability = fakeAvailability
            biometricState = .idle
            isOffline = true
            // Mirrors `wrongPassword`/`throttled`'s own precedent just below:
            // BOTH of those real states are only ever reached AFTER the user
            // has already left the biometry hero (`prefersPasswordEntry`
            // becomes true the moment "Use master password" is tapped, and
            // neither state is reachable without a submitted password
            // first). The offline probe can in principle fire WHILE the hero
            // is still showing (it runs on appear, independent of
            // `prefersPasswordEntry`) -- but the muted slot this state
            // exists to prove only renders in the shared password-primary
            // layout (`biometryIsOffered == false`), so a representative
            // screenshot needs the SAME precondition those two states
            // already establish for themselves.
            prefersPasswordEntry = true
        // Phase 38, plan 38-13, Task 4: renamed from "forgotAlert" -- it no
        // longer presents an alert, it reveals the inline warning. Drives
        // the SAME `showForgotPasswordWarning` flag the real button toggles,
        // so the screenshot evidence and the user's experience cannot
        // diverge (the "backstop" truth this plan names explicitly).
        case "forgotWarning":
            availability = fakeAvailability
            biometricState = .idle
            showForgotPasswordWarning = true
        // §5 state 5, "Wrong password" -- now visually distinct from state 8
        // "Offline" above (addendum A3 closed the gap this comment used to
        // describe): state 5 is `.error`/`PVError`, state 8 is `.muted`.
        case "wrongPassword":
            // Drives the REAL state-5 path -- `attemptsLeft`, the same property
            // `registerFailedAttempt` sets -- not a hand-written banner. The old
            // hook set `bannerMessage` to `authWrongCredentials`, which is
            // exactly the wrong copy this fix replaces; a screenshot taken
            // through it would have shown the bug as if it were the design.
            availability = fakeAvailability
            biometricState = .idle
            prefersPasswordEntry = true
            attemptsLeft = 2
        case "throttled":
            // State 6, through the real deadline property so the countdown, the
            // disabled controls and the slot all come from production code.
            availability = fakeAvailability
            biometricState = .idle
            prefersPasswordEntry = true
            throttledUntil = Date().addingTimeInterval(28)
            tick = Date()
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
        // While throttled the submit is disabled, but guard here too: the
        // control is not the only way to reach this (return key, and any future
        // caller), and a disabled-looking button that still works is worse than
        // no throttle at all.
        guard !password.isEmpty, !isThrottled else { return }
        bannerMessage = nil
        isProcessing = true
        Task {
            defer { isProcessing = false }
            let service = AccountService(apiClient: apiClient)
            do {
                let session = try await service.signIn(email: account.email, password: password)
                try? BiometricUnlockService.enrol(userKey: session.userKey)
                clearThrottleState()
                isOffline = false
                onUnlocked(session)
            } catch let error as PvApiError {
                if case .invalidCredentials = error {
                    // A real credential rejection means the server WAS
                    // reachable -- clears any stale offline slot from an
                    // earlier probe rather than leaving two contradictory
                    // signals on screen.
                    isOffline = false
                    registerFailedAttempt()
                } else if case .network = error {
                    // Addendum A3: a transport-failed unlock attempt routes
                    // to the muted Offline slot, never the generic `.error`
                    // banner -- distinct from a real wrong password.
                    isOffline = true
                } else {
                    isOffline = false
                    bannerMessage = mapUnlockError(error)
                }
            } catch {
                isOffline = false
                registerFailedAttempt()
            }
        }
    }

    /// State 5 -> state 6. Counts DOWN, because the number a user cares about is
    /// what is left, not how many they have burned.
    private func registerFailedAttempt() {
        password = ""
        failedAttempts += 1
        let left = Self.maxAttemptsBeforeThrottle - failedAttempts
        if left <= 0 {
            let until = Date().addingTimeInterval(Self.throttleSeconds)
            throttledUntil = until
            tick = Date()
            attemptsLeft = nil
            failedAttempts = 0
            // Persisted so force-quitting does not clear the wait. Still
            // trivially bypassable by reinstalling -- see the policy note on
            // `maxAttemptsBeforeThrottle`; this is a UX guard, not a control.
            UserDefaults.standard.set(until.timeIntervalSince1970, forKey: Self.throttleDeadlineKey)
        } else {
            attemptsLeft = left
        }
    }

    private func clearThrottleState() {
        failedAttempts = 0
        attemptsLeft = nil
        throttledUntil = nil
        UserDefaults.standard.removeObject(forKey: Self.throttleDeadlineKey)
    }

    /// Restores a deadline written before the app was killed, and drops one that
    /// has already elapsed so a stale key cannot lock the screen forever.
    private func restoreThrottleState() {
        let stored = UserDefaults.standard.double(forKey: Self.throttleDeadlineKey)
        guard stored > 0 else { return }
        let until = Date(timeIntervalSince1970: stored)
        if until > Date() {
            throttledUntil = until
            tick = Date()
        } else {
            UserDefaults.standard.removeObject(forKey: Self.throttleDeadlineKey)
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
