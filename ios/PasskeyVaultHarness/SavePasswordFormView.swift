// SavePasswordFormView.swift -- Phase 44 (zapisywanie-i-generowanie-hasel), Plan 44-03, Task 1.
//
// TEST-ONLY, same discipline as `NativeSignInView.swift`/`NativeCreateView.swift` (never
// distributed, Debug-only, no App Group/production entitlement). This screen exists to settle
// Open Question 1/2 (44-RESEARCH.md): does a REAL text-entry surface -- a genuine `UITextField`
// carrying `.textContentType(.newPassword)` and a real `UITextInputPasswordRules` descriptor --
// actually cause the system to invoke `PasskeyVaultAutoFill`'s new
// `prepareInterface(for: ASSavePasswordRequest)` / `prepareInterface(for:
// ASGeneratePasswordsRequest)` overrides, live, on this toolchain.
//
// WHY `UIViewRepresentable`-wrapped `UITextField`, never a plain SwiftUI `TextField`/`SecureField`:
// `UITextInputPasswordRules` is a `UITextField`/`UITextView` property (`UITextInputTraits`); no
// SwiftUI-native field type exposes it (confirmed absent from this repo: zero
// `textContentType`/`passwordRules`/`SecureField` occurrences carrying password rules anywhere
// before this file -- 44-PLAN-CHECK.md's own read_first note). This is Apple's own
// documented-correct mechanism ("Customizing Password AutoFill Rules", 44-RESEARCH.md Secondary
// source), not a workaround.
//
// `.username` on the first field, `.newPassword` + a real, non-trivial rules descriptor
// (`minlength: 10; maxlength: 20; required: lower; required: upper; required: digit;`) on the
// second -- the SAME DSL shape Plan 44-02's `parse_password_rules` was built against, so a future
// live probe against THIS descriptor string exercises the identical grammar the Rust parser
// already proves it can parse.
//
// "Submit" unfocuses both fields (never merely disables the button) -- this is the one
// user-observable action this harness offers the system to trigger `.formDidDisappear`/
// `.userInitiated`-shaped save/generate heuristics against, per this task's own `<action>` text.

import SwiftUI
import UIKit
import os

private let saveFormLogger = Logger(subsystem: "cloud.blonie.PasskeyVaultHarness", category: "save-password-form")

/// A UIKit `UITextField` wrapped for SwiftUI, carrying real `textContentType`/`passwordRules`.
/// Hands the created `UITextField` back via `onCreate` so the parent view can call
/// `resignFirstResponder()` on Submit -- `UIViewRepresentable` alone has no SwiftUI-native way to
/// drive first-responder resignation from a sibling button without holding the underlying view.
struct PVAutoFillTextField: UIViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var textContentType: UITextContentType?
    var passwordRules: UITextInputPasswordRules?
    var isSecure: Bool = false
    var accessibilityId: String
    var onCreate: (UITextField) -> Void = { _ in }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.placeholder = placeholder
        field.textContentType = textContentType
        field.passwordRules = passwordRules
        field.isSecureTextEntry = isSecure
        field.autocapitalizationType = .none
        field.autocorrectionType = .no
        field.borderStyle = .roundedRect
        field.accessibilityIdentifier = accessibilityId
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.textChanged), for: .editingChanged)
        onCreate(field)
        return field
    }

    func updateUIView(_ uiView: UITextField, context: Context) {
        if uiView.text != text {
            uiView.text = text
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(text: $text)
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var text: Binding<String>

        init(text: Binding<String>) {
            self.text = text
        }

        @objc func textChanged(_ sender: UITextField) {
            text.wrappedValue = sender.text ?? ""
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            textField.resignFirstResponder()
            return true
        }
    }
}

struct SavePasswordFormView: View {
    @State private var username: String = ""
    @State private var password: String = ""
    @State private var statusText: String = "Ready"
    @State private var usernameField: UITextField?
    @State private var passwordField: UITextField?

    /// A real, non-trivial rules descriptor -- the SAME DSL shape Plan 44-02's
    /// `parse_password_rules` was built against (minlength/maxlength/required lower/upper/digit).
    ///
    /// `max-consecutive: 4;` added for 44-VERIFICATION.md gap 2 item 3 -- `GeneratePasswordDispatch
    /// .resolve` passes `rulesText` through to `generatePasswordFromRules` COMPLETELY UNPARSED on
    /// the Swift side (DR-44-B, that type's own header) straight into `pv-core`'s real
    /// `parse_password_rules`, which DOES support `max-consecutive` (unlike the coarse,
    /// per-class-only mapping 44-RESEARCH.md's Decision A3 explicitly rejected) -- so this clause
    /// is genuinely honoured by a live-generated candidate, not merely accepted by the parser.
    private let newPasswordRules = UITextInputPasswordRules(
        descriptor: "minlength: 10; maxlength: 20; required: lower; required: upper; required: digit; max-consecutive: 4;"
    )

    /// Set true after Submit -- conditionally removes BOTH fields from the view hierarchy
    /// (never merely resigns first responder). `ASSavePasswordRequestEvent.formDidDisappear`'s
    /// own header doc names this exact shape ("a form is submitted or removed from the screen") --
    /// this harness gives the system that REAL removal signal, not just a resigned keyboard, so
    /// this tracer's live probe exercises both plausible trigger shapes
    /// (`.userInitiated`-via-resign AND `.formDidDisappear`-via-removal), never assumes which one
    /// the system actually watches for.
    @State private var formDismissed = false

    /// Plan 44-06 (SAVE-03's own live drive). A separate, plain (non-secure) field carrying
    /// `.textContentType(.oneTimeCode)` -- the content type Apple's own AutoFill design ties to
    /// verification-code suggestions; `ProvidesTextToInsert`'s own doc comment
    /// (`ASCredentialProviderViewController.h`) names "a list of any insertable text with
    /// selectable fields" as this override's own trigger shape, and a one-time-code field is the
    /// one place iOS already shows a THIRD-PARTY-extensible QuickType suggestion for arbitrary
    /// inserted text (SMS/Mail codes today; `ProvidesTextToInsert` is this extension's own path
    /// into that same list). `otpField`'s own `onCreate` capture mirrors `usernameField`/
    /// `passwordField` above.
    @State private var otpText: String = ""
    @State private var otpField: UITextField?

    var body: some View {
        VStack(spacing: 16) {
            Text("New-account form (SAVE-01/02 tracer). rpId=vault.blonie.cloud")
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)

            if !formDismissed {
                PVAutoFillTextField(
                    text: $username,
                    placeholder: "Username",
                    textContentType: .username,
                    passwordRules: nil,
                    isSecure: false,
                    accessibilityId: "savePasswordForm.username",
                    onCreate: { usernameField = $0 }
                )
                .frame(height: 36)

                PVAutoFillTextField(
                    text: $password,
                    placeholder: "New password",
                    textContentType: .newPassword,
                    passwordRules: newPasswordRules,
                    isSecure: true,
                    accessibilityId: "savePasswordForm.password",
                    onCreate: { passwordField = $0 }
                )
                .frame(height: 36)

                Button("Submit") {
                    submit()
                }
                .accessibilityIdentifier("savePasswordForm.submit")

                // Plan 44-06 -- deliberately OUTSIDE the username/password pair above, its own
                // separate field so tapping it never disturbs the save/generate fields' own state.
                PVAutoFillTextField(
                    text: $otpText,
                    placeholder: "Verification code",
                    textContentType: .oneTimeCode,
                    passwordRules: nil,
                    isSecure: false,
                    accessibilityId: "savePasswordForm.otpField",
                    onCreate: { otpField = $0 }
                )
                .frame(height: 36)
            } else {
                Text("Form removed from screen (formDidDisappear signal)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Text(statusText)
                .accessibilityIdentifier("savePasswordForm.status")
        }
        .padding()
        // Plan 44-04, Task 3 (`sc-save`'s own receiver-side byte-match proof): the ONLY way to
        // learn what password the SYSTEM actually filled into `passwordField` (via the "Strong
        // Password" QuickType affordance, configuration X) -- `secureTextFields.value` in
        // XCUITest never exposes real plaintext for a secure field, and this codebase's own
        // T-44-06 discipline forbids ever writing a real password to `os_log`, even `.private`,
        // even from a test-only harness. `password` (the `@State` bound to BOTH user typing AND
        // AutoFill's own `UIControl.Event.editingChanged` fill, `PVAutoFillTextField.Coordinator
        // .textChanged`) is instead persisted to THIS harness's own `UserDefaults.standard` --
        // never App Group (this app carries no App Group entitlement, by design,
        // `PasskeyVaultHarness.entitlements`'s own header), never a device-persistent log -- so
        // `scripts/ios-autofill-e44.sh sc-save` can read it back via a plain `simctl get_app_
        // container ... data` file read, entirely off-device from the harness process's own
        // memory. TEST-ONLY, same discipline as every other file in this directory (never
        // distributed, Debug-only).
        .onChange(of: password) { _, newValue in
            guard !newValue.isEmpty else { return }
            UserDefaults.standard.set(newValue, forKey: "pv-e44-04-sc-save-observed-password")
            UserDefaults.standard.synchronize()
        }
    }

    /// Unfocuses BOTH fields first (never merely disables the button), THEN removes them from the
    /// view hierarchy entirely on a short delay (letting the resignation settle before the
    /// `UITextField`s themselves deinit) -- gives the user (or the driving UI test) something real
    /// to trigger BOTH `.userInitiated` (resign) and `.formDidDisappear` (removal)-shaped system
    /// AutoFill save/generate heuristics against, per this task's own `<action>` text.
    private func submit() {
        saveFormLogger.log("PVHARNESS|stage=submit form=save-password")
        usernameField?.resignFirstResponder()
        passwordField?.resignFirstResponder()
        statusText = "Submitted"
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            saveFormLogger.log("PVHARNESS|stage=form-removed form=save-password")
            formDismissed = true
        }
    }
}
