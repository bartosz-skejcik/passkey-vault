//
//  ItemListView.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-02 -- the tracer's list.
//
//  Deliberately bare: a `NavigationStack`, rows, and one temporary create
//  control that Task 3's E-W1 run drives. **No search, no swipe actions, no
//  context menu, no folders, no tags** -- 38-06 and 38-09 own those, and
//  building them here would mean the decisive cross-client experiment runs
//  against unproven layers.
//

import SwiftUI

struct ItemListView: View {
    @Bindable var store: VaultStore

    @State private var selection: VaultItemViewModel?
    @State private var isCreating = false
    @State private var newItemMarker = ""
    @State private var statusMessage: String?

    var body: some View {
        NavigationStack {
            List {
                if store.items.isEmpty {
                    Text(verbatim: "No items yet")
                        .foregroundStyle(Color("PVTextSecondary"))
                }
                ForEach(store.items) { item in
                    Button {
                        selection = item
                    } label: {
                        row(item)
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle(Text(verbatim: "Vault"))
            .navigationDestination(item: $selection) { item in
                ItemDetailView(item: item)
            }
            .refreshable { await refresh() }
            .safeAreaInset(edge: .bottom) { createBar }
            .task { await refresh() }
        }
    }

    @ViewBuilder
    private func row(_ item: VaultItemViewModel) -> some View {
        HStack(spacing: 12) {
            Image(systemName: item.isUndecryptable ? "exclamationmark.triangle.fill" : "note.text")
                .foregroundStyle(
                    item.isUndecryptable ? Color.orange : Color("PVAccent")
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.displayName)
                    .foregroundStyle(Color("PVTextPrimary"))
                if item.isUndecryptable {
                    // The row is RETAINED and labelled, never dropped
                    // (T-38-02-02). Silence here would hide the exact defect
                    // E-W1 exists to catch.
                    Text(verbatim: "Could not be decrypted on this device")
                        .font(.caption)
                        .foregroundStyle(Color.orange)
                }
            }
            Spacer()
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("vault.row.\(item.id)")
    }

    /// TEMPORARY (38-02 only): the control Task 3's E-W1 run uses to create a
    /// uniquely-named note from the simulator. 38-09 replaces it with the
    /// real create/edit form.
    @ViewBuilder
    private var createBar: some View {
        VStack(spacing: 8) {
            if let statusMessage {
                Text(verbatim: statusMessage)
                    .font(.caption)
                    .foregroundStyle(Color("PVTextSecondary"))
            }
            HStack {
                TextField(text: $newItemMarker) {
                    Text(verbatim: "Run marker")
                }
                .textFieldStyle(.roundedBorder)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("vault.create.marker")

                Button {
                    Task { await createNote() }
                } label: {
                    Text(verbatim: "Create note")
                }
                .disabled(isCreating || newItemMarker.isEmpty)
                .accessibilityIdentifier("vault.create.submit")
            }
        }
        .padding()
        .background(.bar)
    }

    private func createNote() async {
        isCreating = true
        defer { isCreating = false }
        do {
            let created = try await store.create(
                noteNamed: newItemMarker,
                body: "created on iOS at \(Date().ISO8601Format())"
            )
            statusMessage = "created \(created.id)"
            newItemMarker = ""
        } catch {
            statusMessage = "create failed: \(error)"
        }
    }

    private func refresh() async {
        do {
            try await store.refresh()
        } catch {
            statusMessage = "refresh failed: \(error)"
        }
    }
}
