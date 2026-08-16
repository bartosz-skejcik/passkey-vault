//
//  Dictionary.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-04. Every
//  user-visible string this phase's three surfaces render, in both PL and
//  EN. Contents come from `37-UI-SPEC.md`'s Copywriting Contract:
//
//  - 14 keys mirrored VERBATIM (same key name, same PL/EN value) from
//    `web/src/lib/i18n/dictionary.ts` / `packages/pv-ui/i18n/common.ts` --
//    transcribed from those files, not re-derived or paraphrased here.
//  - `aria.showPassword`/`aria.hidePassword` -- also mirrored verbatim
//    (`packages/pv-ui/i18n/common.ts`), needed by the password reveal/hide
//    toggle both `AuthView` and `LockView` share.
//  - `unlock.orDivider`/`unlock.submit` -- reused verbatim from the shared
//    dictionary rather than adding a second, redundant key.
//  - The remaining keys are new to iOS: `app.*`, `unlock.signedInAs`,
//    `unlock.biometricCta`, the three `unlock.biometry*`/`unlock.envelope*`
//    error-state keys, `auth.forgotPasswordCta`,
//    `auth.faceIdUsageDescription`.
//
//  `PVKey` is a plain `enum`, and `PVDictionary.entry(for:)` is an
//  EXHAUSTIVE `switch` over every case -- not a dictionary literal. Adding
//  a `PVKey` case without adding its `switch` arm here is a COMPILE error
//  ("switch must be exhaustive"), which is a stronger completeness
//  guarantee than a `[PVKey: LocalizedString]` literal would give (a
//  dictionary literal can compile with a key silently missing).
//
//  "Face ID" and "Touch ID" are Apple's trademarked terms and stay
//  UNTRANSLATED inside the Polish strings below (`unlock.biometricCta`,
//  `unlock.envelopeInvalidated`, `unlock.biometryLockedOut`,
//  `unlock.biometryDenied`, `auth.faceIdUsageDescription`) -- do not "fix"
//  this in a later translation pass.
//
//  There is deliberately NO key for the benign-cancel biometric state: that
//  state renders nothing at all (37-UI-SPEC.md's Lock/Unlock state matrix),
//  and giving it a key would invite someone to fill it in later.
//

import Foundation

/// Every distinct piece of user-visible copy across `AuthView`/`LockView`
/// (plus the one `Info.plist`-level string, `authFaceIdUsageDescription`).
/// `CaseIterable` so `I18nDictionaryTests.swift` can walk every case
/// mechanically rather than trusting a hand-maintained list.
enum PVKey: CaseIterable, Equatable {
    // Mirrored verbatim from web/src/lib/i18n/dictionary.ts +
    // packages/pv-ui/i18n/common.ts (14 keys + aria.*).
    case authEmailLabel
    case authPasswordLabel
    case authConfirmPasswordLabel
    case authLoginSubmit
    case authRegisterSubmit
    case authToggleToRegister
    case authToggleToLogin
    case authIrrecoverableWarning
    case authWrongCredentials
    case authDuplicateEmail
    case authRegistrationFailed
    case authLoginFailed
    case validationRequired
    case validationPasswordMismatch
    case ariaShowPassword
    case ariaHidePassword
    case unlockOrDivider
    case unlockSubmit
    case unlockHeading

    // New, iOS-only.
    case appServerUnreachable
    case appProcessing
    case appProcessingHint
    case unlockSignedInAs
    case unlockBiometricCta
    case unlockEnvelopeInvalidated
    case unlockBiometryLockedOut
    case unlockBiometryDenied
    case authForgotPasswordCta
    case authFaceIdUsageDescription
    // Task 4: the server line under the title on both AuthView modes.
    case authServerSubtitle

    // Phase 38, plan 38-13: onboarding (3 paged steps -- Welcome, Server,
    // AutoFill) and the auth "server line under the title" this plan adds.
    case onboardingWelcomeBody
    case onboardingWelcomeGetStarted
    case onboardingWelcomeAlreadyHaveVault

    // Task 2: the server step.
    case onboardingServerTitle
    case onboardingServerSubtitle
    case onboardingServerRowLabel
    case onboardingServerFooterValue
    case onboardingServerFooterEditing
    case onboardingServerSkip
    case onboardingServerContinue
    case onboardingServerChecking
    case onboardingServerSuccess
    case onboardingServerErrorUnreachable
    case onboardingServerErrorWrongServer

    // Task 3: the AutoFill step.
    case onboardingAutoFillTitle
    case onboardingAutoFillSubtitle
    case onboardingAutoFillListStep1
    case onboardingAutoFillListStep2
    case onboardingAutoFillListStep3
    case onboardingAutoFillFooter
    case onboardingAutoFillOpenSettings
    case onboardingAutoFillLater
    case onboardingAutoFillEnabledConfirmation
    case onboardingAutoFillDone
}

enum PVDictionary {
    static func entry(for key: PVKey) -> LocalizedString {
        switch key {
        // MARK: - Mirrored verbatim

        case .authEmailLabel:
            return LocalizedString(pl: "Email", en: "Email")
        case .authPasswordLabel:
            return LocalizedString(pl: "Hasło główne", en: "Master password")
        case .authConfirmPasswordLabel:
            return LocalizedString(pl: "Powtórz hasło główne", en: "Confirm master password")
        case .authLoginSubmit:
            return LocalizedString(pl: "Zaloguj się", en: "Log in")
        case .authRegisterSubmit:
            return LocalizedString(pl: "Załóż konto", en: "Create account")
        case .authToggleToRegister:
            return LocalizedString(pl: "Nie masz konta? Zarejestruj się", en: "No account yet? Sign up")
        case .authToggleToLogin:
            return LocalizedString(pl: "Masz już konto? Zaloguj się", en: "Already have an account? Log in")
        case .authIrrecoverableWarning:
            return LocalizedString(
                pl: "Zapamiętaj to hasło. Nie da się go odzyskać. Nikt, łącznie z nami, nie ma do niego dostępu.",
                en: "Remember this password. It cannot be recovered. No one, including us, has access to it."
            )
        case .authWrongCredentials:
            return LocalizedString(pl: "Nieprawidłowy email lub hasło", en: "Invalid email or password")
        case .authDuplicateEmail:
            return LocalizedString(
                pl: "Konto z tym adresem email już istnieje",
                en: "An account with this email already exists"
            )
        case .authRegistrationFailed:
            return LocalizedString(
                pl: "Nie udało się utworzyć konta. Spróbuj ponownie.",
                en: "Account creation failed. Please try again."
            )
        case .authLoginFailed:
            return LocalizedString(
                pl: "Logowanie nie powiodło się. Spróbuj ponownie.",
                en: "Login failed. Please try again."
            )
        case .validationRequired:
            return LocalizedString(pl: "To pole jest wymagane", en: "This field is required")
        case .validationPasswordMismatch:
            return LocalizedString(pl: "Hasła nie są identyczne", en: "Passwords don't match")
        case .ariaShowPassword:
            return LocalizedString(pl: "Pokaż hasło", en: "Show password")
        case .ariaHidePassword:
            return LocalizedString(pl: "Ukryj hasło", en: "Hide password")
        case .unlockOrDivider:
            return LocalizedString(pl: "lub", en: "or")
        case .unlockSubmit:
            return LocalizedString(pl: "Odblokuj", en: "Unlock")
        case .unlockHeading:
            return LocalizedString(pl: "Odblokuj vault", en: "Unlock your vault")

        // MARK: - New, iOS-only

        case .appServerUnreachable:
            return LocalizedString(
                pl: "Nie udało się połączyć z serwerem. Sprawdź połączenie internetowe i spróbuj ponownie.",
                en: "Couldn't reach the server. Check your internet connection and try again."
            )
        case .appProcessing:
            return LocalizedString(pl: "Przetwarzanie…", en: "Processing…")
        case .appProcessingHint:
            return LocalizedString(pl: "To może potrwać kilka sekund", en: "This can take a few seconds")
        case .unlockSignedInAs:
            return LocalizedString(pl: "Zalogowano jako {email}", en: "Signed in as {email}")
        case .unlockBiometricCta:
            return LocalizedString(pl: "Odblokuj przez {method}", en: "Unlock with {method}")
        case .unlockEnvelopeInvalidated:
            return LocalizedString(
                pl: "Zmieniono odcisk palca lub twarz zapisane w Face ID/Touch ID. Odblokuj hasłem głównym "
                    + "poniżej — biometria włączy się ponownie automatycznie.",
                en: "The fingerprint or face enrolled in Face ID/Touch ID changed. Unlock with your master "
                    + "password below — biometrics will re-enable automatically."
            )
        case .unlockBiometryLockedOut:
            return LocalizedString(
                pl: "Zbyt wiele nieudanych prób. Face ID/Touch ID jest tymczasowo zablokowane na tym "
                    + "urządzeniu — użyj hasła głównego, albo odblokuj ekran telefonu, żeby odblokować sensor.",
                en: "Too many failed attempts. Face ID/Touch ID is temporarily locked on this device — use "
                    + "your master password, or unlock your phone's screen to re-enable the sensor."
            )
        case .unlockBiometryDenied:
            return LocalizedString(
                pl: "Passkey Vault nie ma dostępu do Face ID/Touch ID. Włącz go w Ustawienia → Passkey Vault "
                    + "→ Face ID, albo odblokuj hasłem głównym poniżej.",
                en: "Passkey Vault doesn't have access to Face ID/Touch ID. Enable it in Settings → Passkey "
                    + "Vault → Face ID, or unlock with your master password below."
            )
        case .authForgotPasswordCta:
            return LocalizedString(pl: "Nie pamiętam hasła głównego", en: "I forgot my master password")
        case .authFaceIdUsageDescription:
            return LocalizedString(
                pl: "Passkey Vault używa Face ID, żeby odblokować Twój vault.",
                en: "Passkey Vault uses Face ID to unlock your vault."
            )
        case .authServerSubtitle:
            return LocalizedString(pl: "do {host}", en: "to {host}")

        // MARK: - Phase 38, plan 38-13: onboarding + auth server line

        case .onboardingWelcomeBody:
            return LocalizedString(
                pl: "Twoje hasła i passkeye, na serwerze, który kontrolujesz. Nic nie opuszcza tego "
                    + "telefonu bez szyfrowania.",
                en: "Your passwords and passkeys, on a server you control. Nothing leaves this phone "
                    + "unencrypted."
            )
        case .onboardingWelcomeGetStarted:
            return LocalizedString(pl: "Zacznij", en: "Get started")
        case .onboardingWelcomeAlreadyHaveVault:
            return LocalizedString(pl: "Mam już vault", en: "I already have a vault")

        case .onboardingServerTitle:
            return LocalizedString(pl: "Gdzie żyje Twój vault", en: "Where your vault lives")
        case .onboardingServerSubtitle:
            return LocalizedString(
                pl: "To jest już skonfigurowane. Zmień to tylko, jeśli prowadzisz własny serwer.",
                en: "This is already set up for you. Change it only if you run your own server."
            )
        case .onboardingServerRowLabel:
            return LocalizedString(pl: "Serwer", en: "Server")
        case .onboardingServerFooterValue:
            return LocalizedString(
                pl: "Połączono. Twój vault jest hostowany pod {host} — domyślny adres dla nowych kont. "
                    + "Prowadzisz własny serwer? Dotknij, żeby wpisać swój adres.",
                en: "Connected. Your vault is hosted at {host} — the default for new accounts. "
                    + "Self-hosting? Tap to enter your own address."
            )
        case .onboardingServerFooterEditing:
            return LocalizedString(
                pl: "Musi zaczynać się od https://. Sprawdzimy adres przed przejściem dalej.",
                en: "Must start with https://. We'll check the address before continuing."
            )
        case .onboardingServerSkip:
            return LocalizedString(pl: "Pomiń", en: "Skip")
        case .onboardingServerContinue:
            return LocalizedString(pl: "Dalej", en: "Continue")
        case .onboardingServerChecking:
            return LocalizedString(pl: "Sprawdzanie…", en: "Checking…")
        case .onboardingServerSuccess:
            return LocalizedString(
                pl: "Osiągalny — to jest Passkey Vault.",
                en: "Reachable — this is a Passkey Vault."
            )
        case .onboardingServerErrorUnreachable:
            return LocalizedString(
                pl: "Nie udało się połączyć z {host}: {reason}",
                en: "Couldn't reach {host}: {reason}"
            )
        case .onboardingServerErrorWrongServer:
            return LocalizedString(
                pl: "Coś odpowiedziało pod {host}, ale to nie wygląda na Passkey Vault.",
                en: "Something answered at {host}, but it doesn't look like a Passkey Vault."
            )

        case .onboardingAutoFillTitle:
            return LocalizedString(pl: "Wypełniaj hasła wszędzie", en: "Fill passwords anywhere")
        case .onboardingAutoFillSubtitle:
            return LocalizedString(
                pl: "Włącz Passkey Vault w Ustawieniach, a Twoje loginy pojawią się nad klawiaturą, w "
                    + "każdej aplikacji i na każdej stronie.",
                en: "Turn on Passkey Vault in Settings and your logins appear above the keyboard, in "
                    + "any app or website."
            )
        case .onboardingAutoFillListStep1:
            return LocalizedString(pl: "1. Otwórz Ustawienia", en: "1. Open Settings")
        case .onboardingAutoFillListStep2:
            return LocalizedString(pl: "2. Ogólne → AutoFill", en: "2. General → AutoFill")
        case .onboardingAutoFillListStep3:
            return LocalizedString(pl: "3. Włącz Passkey Vault", en: "3. Turn on Passkey Vault")
        case .onboardingAutoFillFooter:
            return LocalizedString(
                pl: "iOS pozwala to zrobić tylko z poziomu Ustawień — żadna aplikacja nie może włączyć "
                    + "tego sama za Ciebie. Możesz wrócić do tego w dowolnym momencie.",
                en: "iOS only lets you do this from Settings — no app can turn it on for you. You can "
                    + "come back to this any time."
            )
        case .onboardingAutoFillOpenSettings:
            return LocalizedString(pl: "Otwórz Ustawienia", en: "Open Settings")
        case .onboardingAutoFillLater:
            return LocalizedString(pl: "Później", en: "Later")
        case .onboardingAutoFillEnabledConfirmation:
            return LocalizedString(
                pl: "AutoFill jest włączony. Passkey Vault zaproponuje Twoje loginy nad klawiaturą.",
                en: "AutoFill is on. Passkey Vault will offer your logins above the keyboard."
            )
        case .onboardingAutoFillDone:
            return LocalizedString(pl: "Gotowe", en: "Done")
        }
    }
}
