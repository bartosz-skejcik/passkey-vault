//
//  ItemDetailView.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-02 -- the tracer's detail
//  screen. One note, its name and its body, and an honest panel for a row
//  that could not be decrypted.
//
//  No reveal/copy affordances here: UI-02's reveal-and-copy is 38-07's
//  (clipboard auto-clear must land in the same change as the copy control, or
//  the phase ships a copy button with no expiry).
//

import SwiftUI

struct ItemDetailView: View {
    let item: VaultItemViewModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch item.content {
                case let .note(fields):
                    field(label: "Name", value: fields.name)
                    field(label: "Note", value: fields.body)
                case let .undecryptable(reason):
                    undecryptablePanel(reason)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .background(Color("PVBackground"))
        .navigationTitle(Text(verbatim: item.displayName))
        .navigationBarTitleDisplayMode(.inline)
    }

    @ViewBuilder
    private func field(label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: label)
                .font(.caption)
                .foregroundStyle(Color("PVTextSecondary"))
            Text(verbatim: value)
                .foregroundStyle(Color("PVTextPrimary"))
                .textSelection(.enabled)
                .accessibilityIdentifier("vault.detail.\(label.lowercased())")
        }
    }

    /// The row exists on the server and is retained locally; only its
    /// plaintext is unavailable. Saying that plainly is the point -- a blank
    /// screen or a dropped row would hide exactly the failure E-W1 hunts.
    @ViewBuilder
    private func undecryptablePanel(_ reason: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(verbatim: "This item could not be decrypted")
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
            }
            .foregroundStyle(Color.orange)
            Text(verbatim: "The row is still on the server and has not been altered or removed. It was retained here rather than hidden.")
                .font(.footnote)
                .foregroundStyle(Color("PVTextSecondary"))
            Text(verbatim: reason)
                .font(.caption.monospaced())
                .foregroundStyle(Color("PVTextSecondary"))
                .accessibilityIdentifier("vault.detail.undecryptable.reason")
        }
    }
}
