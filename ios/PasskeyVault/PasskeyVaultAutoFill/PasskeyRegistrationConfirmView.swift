//
//  PasskeyRegistrationConfirmView.swift
//  PasskeyVaultAutoFill
//
//  Plan 43-07 (OPT-03), Task 1. The ONE UI screen this phase's scope fence permits (OPT-01's
//  decision record: "provider: yes; PRF/OPT-02: no", ROADMAP UI hint "ekran potwierdzenia
//  rejestracji") -- shown after the unlock-gating sequence has already confirmed the vault is
//  unlocked (`CredentialProviderViewController.prepareInterfaceForPasskeyRegistration(for:)`),
//  immediately before the CTAP2 registration ceremony runs. Draws no picker of its own (OPT-03's
//  own prohibition: "the assertion path draws no PV-owned UI at all" -- this is REGISTRATION, the
//  one path that DOES draw a screen, and only this one).
//
//  Mirrors `Core/StatusCallout.swift`'s established SHAPE for a security-relevant surface (tinted
//  slot, PV* tokens only, plain -- never playful -- security copy) rather than importing that type
//  directly: `StatusCallout` lives in `PasskeyVault/PasskeyVault/Core/`, a HOST-APP-ONLY folder not
//  in this extension target's `fileSystemSynchronizedGroups` (`Shared/`/`PvShared/` only) -- the
//  same cross-target boundary `IdentityStoreSync.swift`'s own header already documents for
//  `VaultItemViewModel`/`ItemFields.swift`. Geometry constants below are transcribed from
//  `PVMetrics` (`PasskeyVault/Core/PVDesign.swift`, also host-only) rather than imported, for the
//  identical reason.
//

import SwiftUI

struct PasskeyRegistrationConfirmView: View {
    /// The relying party this passkey will be created for (`request.credentialIdentity
    /// .relyingPartyIdentifier`) -- shown verbatim, never re-derived, so what the user confirms is
    /// exactly what the ceremony signs over.
    let rpId: String
    /// The account name the passkey will be created for (`request.credentialIdentity.userName`).
    /// May be empty for an RP that supplies no display name -- rendered as "this account" rather
    /// than an empty line.
    let accountName: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    private var displayAccountName: String {
        accountName.isEmpty ? "this account" : accountName
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()

            VStack(spacing: 12) {
                Circle()
                    .fill(Color("PVPasskey").opacity(0.14))
                    .frame(width: 64, height: 64)
                    .overlay(
                        Image(systemName: "key.fill")
                            .font(.system(size: 26, weight: .semibold))
                            .foregroundStyle(Color("PVPasskey"))
                    )
                    .accessibilityHidden(true)

                // `.title2`/`.subheadline`, not `PVMetrics.titleSize` (34pt) -- this is a
                // credential-provider extension sheet (a small, system-constrained surface), never
                // the host app's full-screen onboarding flow those metrics were measured against.
                Text(verbatim: "Create a passkey")
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(Color("PVTextPrimary"))

                Text(verbatim: "Passkey Vault will create a passkey for \(displayAccountName) on \(rpId).")
                    .font(.subheadline)
                    .foregroundStyle(Color("PVTextMuted"))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 20)

            Spacer()

            // Mirrors `StatusCallout`'s own tinted-slot shape (14% tone tint, 11pt radius) for the
            // plain, non-playful security statement every registration confirmation carries --
            // security UI is never playful, even here (OPT-01's UI scope fence).
            HStack(alignment: .top, spacing: 9) {
                Circle()
                    .fill(Color("PVPasskey"))
                    .frame(width: 8, height: 8)
                    .padding(.top, 5)
                    .accessibilityHidden(true)
                Text(verbatim: "This passkey is stored in your vault, encrypted the same way as every other item.")
                    .font(.footnote)
                    .foregroundStyle(Color("PVPasskey"))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 13)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .fill(Color("PVPasskey").opacity(0.14))
            )
            .padding(.horizontal, 20)
            .padding(.bottom, 16)

            VStack(spacing: 9) {
                Button(action: onConfirm) {
                    Text(verbatim: "Create passkey")
                        .font(.system(size: 17, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 50)
                }
                .background(Color("PVAccent"))
                .foregroundStyle(Color("PVOnAccent"))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityIdentifier("passkeyRegistration.confirm")

                Button(action: onCancel) {
                    Text(verbatim: "Cancel")
                        .font(.system(size: 17, weight: .medium))
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                }
                .foregroundStyle(Color("PVTextMuted"))
                .accessibilityIdentifier("passkeyRegistration.cancel")
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 10)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color("PVBackground"))
    }
}

#Preview {
    PasskeyRegistrationConfirmView(
        rpId: "github.com", accountName: "bartek@paczesny.pl",
        onConfirm: {}, onCancel: {}
    )
}
