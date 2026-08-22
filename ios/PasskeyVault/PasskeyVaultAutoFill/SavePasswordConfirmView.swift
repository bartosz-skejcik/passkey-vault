//
//  SavePasswordConfirmView.swift
//  PasskeyVaultAutoFill
//
//  Plan 44-04 (SAVE-01), Task 2. The ONE UI screen shown for the `.userInitiated`/
//  `.formDidDisappear` save events -- `.generatedPasswordFilled` skips this entirely per the SDK
//  header's own explicit "Providers should not request any additional information" instruction
//  (`CredentialProviderViewController.prepareInterface(for: ASSavePasswordRequest)`'s own dispatch).
//
//  Mirrors `PasskeyRegistrationConfirmView.swift`'s own established shape EXACTLY (PV* tokens only,
//  plain -- never playful -- security copy, the same tinted-slot/button/geometry structure) rather
//  than inventing a new one: security UI stays visually consistent across every AutoFill
//  confirmation surface this extension presents. `PVSuccess` (not `PVPasskey`/`PVInfo`) is this
//  screen's own accent -- a NEW password being SAVED is this app's own "successful write" semantic,
//  the same token `PVColors.xcassets/PVSuccess.colorset` already carries elsewhere in this codebase
//  for a completed, positive vault mutation.
//

import SwiftUI

struct SavePasswordConfirmView: View {
    /// `request.serviceIdentifier.identifier`, shown verbatim -- what the user confirms is exactly
    /// what the item's own `urls` field will carry.
    let serviceIdentifier: String
    /// `request.credential.user`, shown verbatim. May be empty for a form with no username field --
    /// rendered as "this account" rather than an empty line, mirroring
    /// `PasskeyRegistrationConfirmView`'s own `displayAccountName` fallback.
    let username: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    private var displayUsername: String {
        username.isEmpty ? "this account" : username
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 12) {
                Circle()
                    .fill(Color("PVSuccess").opacity(0.14))
                    .frame(width: 64, height: 64)
                    .overlay(
                        Image(systemName: "key.fill")
                            .font(.system(size: 26, weight: .semibold))
                            .foregroundStyle(Color("PVSuccess"))
                    )
                    .accessibilityHidden(true)

                // `.title2`/`.subheadline`, not the host app's full-screen onboarding metrics --
                // this is a credential-provider extension sheet, the same small,
                // system-constrained surface `PasskeyRegistrationConfirmView` already targets.
                Text(verbatim: "Save password")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color("PVTextPrimary"))

                Text(verbatim: "Save the password for \(displayUsername) on \(serviceIdentifier) to Passkey Vault?")
                    .font(.subheadline)
                    .foregroundStyle(Color("PVTextMuted"))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 20)

            Spacer()

            // Mirrors `PasskeyRegistrationConfirmView`'s own tinted-slot shape (14% tone tint, 11pt
            // radius) for the plain, non-playful security statement every save confirmation
            // carries -- security UI is never playful, even here.
            HStack(alignment: .top, spacing: 9) {
                Circle()
                    .fill(Color("PVSuccess"))
                    .frame(width: 8, height: 8)
                    .padding(.top, 5)
                    .accessibilityHidden(true)
                Text(verbatim: "This password is stored in your vault, encrypted the same way as every other item.")
                    .font(.footnote)
                    .foregroundStyle(Color("PVSuccess"))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(Color("PVSuccess").opacity(0.14))
            )
            .padding(.horizontal, 20)
            .padding(.bottom, 16)

            VStack(spacing: 9) {
                Button(action: onConfirm) {
                    Text(verbatim: "Save password")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                }
                .background(Color("PVAccent"))
                .foregroundStyle(Color("PVOnAccent"))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityIdentifier("savePassword.confirm")

                Button(action: onCancel) {
                    Text(verbatim: "Cancel")
                        .font(.system(size: 17, weight: .medium))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                }
                .foregroundStyle(Color("PVTextMuted"))
                .accessibilityIdentifier("savePassword.cancel")
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("PVBackground"))
    }
}

#Preview {
    SavePasswordConfirmView(
        serviceIdentifier: "github.com", username: "bartek@paczesny.pl",
        onConfirm: {}, onCancel: {}
    )
}
