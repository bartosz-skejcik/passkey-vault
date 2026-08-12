//
//  ContentView.swift
//  PasskeyVault
//
//  Phase 37 (konto-unlock-hasłem-i-biometria), plan 37-02. Replaces Xcode's
//  template with the minimal real screen this plan's tracer needs: a
//  server-URL field, email/password, "Create account"/"Sign in" buttons
//  calling `AccountService`, and a status line. On success, encrypts a
//  fixture note through `encryptItem` and immediately `decryptItem`s it,
//  showing the decrypted string -- so the screen visibly demonstrates that
//  the key it holds actually works. No vault list, no styling work, no
//  navigation -- Phase 38 owns the real UI.
//

import SwiftUI

struct ContentView: View {
    @State private var serverURLString = "http://127.0.0.1:8621"
    @State private var email = ""
    @State private var password = ""
    @State private var statusMessage = ""
    @State private var decryptedFixtureNote: String?
    @State private var isBusy = false

    /// Fixture plaintext encrypted/decrypted on success -- proves the
    /// `FfiUserKey` this screen holds actually works, never just that a
    /// network call succeeded.
    private static let fixtureItemId = "tracer-fixture-item"
    private static let fixtureNote = "{\"type\":\"note\",\"body\":\"Phase 37 tracer fixture\"}"

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Passkey Vault -- Phase 37 tracer").font(.headline)

            TextField("Server URL", text: $serverURLString)
                .textContentType(.URL)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                #endif

            TextField("Email", text: $email)
                .textContentType(.emailAddress)
                .autocorrectionDisabled()
                #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(.emailAddress)
                #endif

            SecureField("Password", text: $password)

            HStack {
                Button("Create account") {
                    Task { await handle { try await accountService().register(email: email, password: password) } }
                }
                .disabled(isBusy || email.isEmpty || password.isEmpty)

                Button("Sign in") {
                    Task { await handle { try await accountService().signIn(email: email, password: password) } }
                }
                .disabled(isBusy || email.isEmpty || password.isEmpty)
            }

            if isBusy {
                ProgressView()
            }

            Text(statusMessage)
                .foregroundStyle(statusMessage.hasPrefix("Error") ? .red : .primary)

            if let decryptedFixtureNote {
                Text("Decrypted fixture note:")
                    .font(.caption)
                Text(decryptedFixtureNote)
                    .font(.system(.body, design: .monospaced))
                    .padding(8)
                    .background(.quaternary)
            }
        }
        .padding()
    }

    private func accountService() throws -> AccountService {
        guard let url = URL(string: serverURLString) else {
            throw PvApiError.unexpectedResponse("invalid server URL: \(serverURLString)")
        }
        return AccountService(apiClient: PvApiClient(baseURL: url))
    }

    private func handle(_ action: @escaping () async throws -> UnlockedSession) async {
        isBusy = true
        statusMessage = ""
        decryptedFixtureNote = nil
        defer { isBusy = false }

        do {
            let session = try await action()
            statusMessage = "Unlocked. Session token: \(session.token.prefix(8))..."

            let item = try encryptItem(
                userKey: session.userKey,
                plaintext: Self.fixtureNote,
                itemId: Self.fixtureItemId,
                revision: 1
            )
            let decrypted = try decryptItem(
                userKey: session.userKey,
                item: item,
                itemId: Self.fixtureItemId,
                revision: 1
            )
            decryptedFixtureNote = decrypted
        } catch let error as PvApiError {
            // A 401 renders the SAME message regardless of whether the
            // email or the password was wrong (T-37-08).
            statusMessage = "Error: \(error.description)"
        } catch let error as FfiError {
            statusMessage = "Error: \(error)"
        } catch {
            statusMessage = "Error: \(error.localizedDescription)"
        }
    }
}

#Preview {
    ContentView()
}
