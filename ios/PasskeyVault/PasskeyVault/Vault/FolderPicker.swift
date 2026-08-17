//
//  FolderPicker.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-09, Task 3. Assigns an item to
//  a folder -- from `ItemFormView` (the form's own Folder row) and from
//  `ItemListView`'s context menu ("Move to folder"). Offers create and
//  select-to-assign; NO rename or edit affordance anywhere in this file.
//
//  L-18 (`ios/IOS-SPIKE-LOG.md`): there is no PUT/PATCH/rename verb for
//  folders on `pv-server` -- see `FolderStore.swift`'s own header for the
//  full route-table citation. `grep -rn rename` over this file and
//  `FolderStore.swift` must return zero lines; this comment is the
//  explanation for that absence, not a gap.
//

import SwiftUI

/// A sheet: pick an existing folder, create a new one, or clear the
/// assignment ("No folder"). `selection` is the SAME `folderId: String?`
/// binding `ItemFormView` exposes -- this view mutates it directly and does
/// not itself talk to `VaultStore`; the caller's own save flow persists it.
struct FolderPicker: View {
    @Bindable var store: FolderStore
    @Binding var selection: String?

    @Environment(\.dismiss) private var dismiss
    @State private var newFolderName = ""
    @State private var isCreating = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        selection = nil
                        dismiss()
                    } label: {
                        HStack {
                            Text("No folder")
                            Spacer()
                            if selection == nil {
                                Image(systemName: "checkmark")
                            }
                        }
                    }
                    .accessibilityIdentifier("folderpicker.none")
                }

                if !store.folders.isEmpty {
                    Section("Folders") {
                        ForEach(store.folders) { folder in
                            Button {
                                selection = folder.id
                                dismiss()
                            } label: {
                                HStack {
                                    Text(verbatim: folder.name)
                                    Spacer()
                                    if selection == folder.id {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                            .accessibilityIdentifier("folderpicker.folder.\(folder.id)")
                        }
                    }
                }

                Section("New folder") {
                    HStack {
                        TextField("Folder name", text: $newFolderName)
                            .autocorrectionDisabled()
                            .accessibilityIdentifier("folderpicker.newName")
                        Button {
                            Task { await createFolder() }
                        } label: {
                            if isCreating {
                                ProgressView()
                            } else {
                                Text("Create")
                            }
                        }
                        .disabled(isCreating || newFolderName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .accessibilityIdentifier("folderpicker.create")
                    }
                    if let errorMessage {
                        Text(verbatim: errorMessage)
                            .font(.footnote)
                            .foregroundStyle(Color("PVError"))
                    }
                }
            }
            .navigationTitle("Folder")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task { await refresh() }
        }
        .presentationDetents([.medium, .large])
    }

    private func refresh() async {
        do {
            try await store.refresh()
        } catch {
            errorMessage = String(describing: error)
        }
    }

    private func createFolder() async {
        let name = newFolderName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        isCreating = true
        defer { isCreating = false }
        do {
            let created = try await store.create(name: name)
            selection = created.id
            newFolderName = ""
            dismiss()
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
