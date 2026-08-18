//
//  SettingsView.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), quick task 260818-fnt. The vault
//  avatar menu's "Settings" entry has sat permanently disabled since Phase
//  38 with the explicit comment "there is no generic Settings screen
//  planned for this milestone at all" -- this file is what makes it real.
//
//  Task 1's tracer proved the whole switchable-app-icon mechanism end-to-end
//  for ONE variant (orange). Task 3 (this rewrite) grows it into the real
//  4-option picker, same overall shape, mirroring `FolderPicker.swift`
//  structurally (`NavigationStack { List { ... } }`, a "Close" toolbar
//  button via `@Environment(\.dismiss)`, rows with a trailing checkmark on
//  selection).
//
//  The success path sets `selected` INSIDE the `setAlternateIconName`
//  completion handler, never optimistically before the call -- the
//  checkmark only ever reflects a confirmed OS-level success.
//

import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss

    @State private var selected: AppIconOption = .current(from: UIApplication.shared.alternateIconName)
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section("App icon") {
                    ForEach(AppIconOption.allCases) { option in
                        Button {
                            select(option)
                        } label: {
                            HStack {
                                Image(uiImage: UIImage(named: option.previewAssetName) ?? UIImage())
                                    .resizable()
                                    .frame(width: 44, height: 44)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                Text(verbatim: option.displayName)
                                    .foregroundStyle(Color("PVTextPrimary"))
                                Spacer()
                                if selected == option {
                                    Image(systemName: "checkmark")
                                        .foregroundStyle(Color("PVAccent"))
                                        .accessibilityIdentifier("settings.appIcon.\(option.rawValue).checkmark")
                                }
                            }
                        }
                        .accessibilityIdentifier("settings.appIcon.\(option.rawValue)")
                    }
                }

                if let errorMessage {
                    Section {
                        StatusCallout(text: errorMessage, tone: .error)
                    }
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    @MainActor
    private func select(_ option: AppIconOption) {
        guard option != selected else { return }
        errorMessage = nil
        let previous = selected
        UIApplication.shared.setAlternateIconName(option.alternateName) { error in
            Task { @MainActor in
                if let error {
                    self.errorMessage = error.localizedDescription
                    self.selected = previous
                } else {
                    self.selected = option
                }
            }
        }
    }
}
