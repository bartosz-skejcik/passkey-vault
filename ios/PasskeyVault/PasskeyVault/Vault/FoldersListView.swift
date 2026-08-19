//
//  FoldersListView.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-05 (BINDING
//  SCOPE ADDITION -- the dock swap, `40-UI-SPEC.md` §5.2/§5.3). Folders'
//  own root, reached by the dock's `Folders` tab
//  (`ItemListView.tabContent(for:)`, `tab == .folder`) -- deliberately NOT
//  a `VaultTypeTab.wireType` filter over `store.items`; this is a distinct
//  screen with its own row shape (name + item count + chevron), matching
//  `ios/brand/screens-vault.html`'s "Folders" section.
//
//  `FolderStore` already exists (Phase 38, plan 38-09) and already owns
//  create/delete/refresh; this file is a NEW read surface over it, adding
//  no new mutation.
//

import SwiftUI

/// The Folders list root (`40-UI-SPEC.md` §5.2). `folderStore` is a
/// `@Bindable` reference (not owned here) -- the SAME instance
/// `ItemListView`/`FolderPicker`/`ItemFormView` already share, so a folder
/// created from the ＋ grid appears here without a second refresh call.
struct FoldersListView: View {
    @Bindable var folderStore: FolderStore
    /// The caller's decrypted items -- used ONLY to compute each folder's
    /// item count (`fields?.folderId == folder.id`), never to filter/render
    /// items directly (this screen renders FOLDERS, not items -- see this
    /// file's header).
    var items: [VaultItemViewModel]
    var onOpenFolder: (Folder) -> Void

    var body: some View {
        Group {
            if folderStore.folders.isEmpty {
                emptyState
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color("PVBackground"))
            } else {
                List {
                    ForEach(folderStore.folders) { folder in
                        Button {
                            onOpenFolder(folder)
                        } label: {
                            row(folder)
                        }
                        .accessibilityIdentifier("vault.folders.row.\(folder.id)")
                    }
                }
                .scrollContentBackground(.hidden)
                .background(Color("PVBackground"))
            }
        }
        .task {
            // Mirrors `FolderPicker.refresh()`'s own discipline: a thrown
            // refresh is surfaced via `folderStore.lastError`, which this
            // screen does not render a SEPARATE banner for (the vault's
            // existing `statusBanner`/`SyncStatusView` inset already covers
            // the tab content this view sits inside) -- swallowing here
            // just avoids a crash on a network hiccup, matching
            // `FolderPicker`'s own `try?`.
            try? await folderStore.refresh()
        }
    }

    // MARK: - Row

    @ViewBuilder
    private func row(_ folder: Folder) -> some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 8)
                .fill(Color("PVSurfaceAlt"))
                .frame(width: 32, height: 32)
                .overlay {
                    Image(systemName: "folder")
                        .font(.system(size: 16))
                        .foregroundStyle(Color("PVTextMuted"))
                }
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: folder.name)
                    .foregroundStyle(Color("PVTextPrimary"))
                // WR-15: "\(count) items" reads "1 items" -- ungrammatical
                // at one, the one place this count is user-facing. No
                // plural machinery (recorded project decision) means a
                // count-prefixed phrasing, not an interpolated English
                // plural -- grammatical at every count, same discipline
                // `ShareItemView`'s "Udostępnij \(count) os." already uses.
                Text(verbatim: "Items: \(itemCount(for: folder))")
                    .font(.caption)
                    .foregroundStyle(Color("PVTextMuted"))
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(Color("PVTextMuted"))
        }
        .frame(minHeight: PVMetrics.rowMinHeight)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }

    private func itemCount(for folder: Folder) -> Int {
        items.filter { $0.fields?.folderId == folder.id }.count
    }

    // MARK: - Empty state

    /// Copy verbatim from `40-UI-SPEC.md` §5.2/§6 -- one affordance (the ＋
    /// grid's "New folder" action), never a competing second button, the
    /// same house rule `emptyVaultState` already follows.
    private var emptyState: some View {
        ContentUnavailableView(
            "No folders yet",
            systemImage: "folder",
            description: Text(verbatim: "Tap ＋ and choose \"New folder\" from the add grid to create one.")
        )
        .accessibilityIdentifier("vault.folders.emptyState")
    }
}

/// One folder's own item list (`40-UI-SPEC.md` §5.3) -- title-only nav bar
/// (folder name, `‹ Folders` back), no trailing action, mirroring the
/// passkey detail screen's already-shipped title-only shape. Assignment
/// happens from an item's OWN edit screen (`FolderPicker`), never from
/// here.
///
/// Quick fix 40-UX-01: this surface used to render `folderItems` as one flat
/// `ForEach`, unlike the All tab's own type-grouped sections
/// (`ItemListView.allTabSections`) -- a real inconsistency Bartek flagged
/// live, not a deliberate simplification. It now groups by the SAME
/// mechanism the All tab uses, `vaultTypeSections(_:rowContent:)`
/// (`ItemListView.swift`) -- section headers with counts, `VaultSectionKind`'s
/// own order, and, on iOS 26+, the trailing section index
/// (`AvailableListSectionIndexVisibility`) -- rather than a second,
/// independently-written grouping loop. Both modifiers/the function are
/// declared `internal` (not `private`) in `ItemListView.swift` specifically
/// so this file can reuse them; see that file's own note at each
/// declaration.
struct FolderOpenView: View {
    let folder: Folder
    var items: [VaultItemViewModel]
    var rowContent: (VaultItemViewModel) -> AnyView

    private var folderItems: [VaultItemViewModel] {
        items.filter { $0.fields?.folderId == folder.id }
    }

    var body: some View {
        Group {
            if folderItems.isEmpty {
                ContentUnavailableView(
                    "No items in this folder",
                    systemImage: "folder"
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color("PVBackground"))
            } else {
                List {
                    vaultTypeSections(folderItems, rowContent: rowContent)
                }
                // The right-edge section index DOES compose cheaply here --
                // it is the same stock `listSectionIndexVisibility(.visible)`
                // call the All tab already makes on ITS `List`, gated
                // identically behind iOS 26 by the same shared modifier. No
                // folder-open-specific reason it would not apply (the index
                // reads off the `Section`s this screen now renders the same
                // way the All tab does), so it is kept ON rather than
                // dropped.
                .modifier(AvailableListSectionIndexVisibility())
                .scrollContentBackground(.hidden)
                .background(Color("PVBackground"))
            }
        }
        .navigationTitle(Text(verbatim: folder.name))
        .accessibilityIdentifier("vault.folders.open.\(folder.id)")
    }
}
