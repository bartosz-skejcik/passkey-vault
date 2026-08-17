//
//  ItemListView.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06 -- the list screen: search,
//  filter tokens, a type filter, swipe actions, a context menu, sort, and
//  honest empty states, replacing 38-02's bare tracer.
//
//  Navigation architecture follows `.planning/phases/38-pe-ny-interfejs-
//  vaulta/38-DESIGN-CONFORMANCE.md` §"38-06 -- the list surface", which
//  supersedes this plan's OWN original wording about a "scope bar" for item
//  type -- design-conformance is explicit that where the two disagree about
//  *what the UI is*, it wins, because it derives from a design Bartek
//  approved after this plan was written. The plan's own mechanics (search
//  predicate, sort, filter, pipeline order, swipe, context menu) are
//  unchanged and still governed by `VaultSearch`/`VaultFilter`/`VaultSort`.
//
//  KNOWN, DELIBERATE HIG DEPARTURE, recorded rather than silently "fixed":
//  iOS tab bars are conventionally for *sections* of an app, not a content
//  filter within one screen. This one filters by item type. Taken because,
//  once the account/family surface moves to the avatar menu, the vault
//  genuinely IS the whole app -- there is no second section for a tab bar
//  to legitimately separate.
//
//  ONE compatibility constraint shaped this file's layout: 38-05's
//  `SnapshotEvidenceUITests.testCreateMarkerItemOpenDetailAndBackground`
//  (already-passing E-S1 evidence, not owned by this plan) depends on
//  `vault.create.marker`/`vault.create.submit` being reachable on the list
//  screen WITHOUT any extra navigation. The tracer's marker-note create bar
//  is therefore KEPT, unchanged, on the All tab, rather than folded into the
//  "+" create menu below -- removing it would silently break that test.
//  38-09's real create/edit form is expected to retire both this bar and
//  that test's dependency on it together, not this plan's job to do alone.
//

import SwiftUI
import UIKit

// MARK: - Dock tab bar (item-type filter)

/// The five dock tabs (design-conformance: "All · Logins · Cards · Codes ·
/// Passkeys"). `identity` and `note` deliberately have NO tab -- design-
/// conformance's own reasoning: six types, five tab slots; the grouped All
/// screen's sections are their only route in, and the section index is what
/// makes them findable there.
enum VaultTypeTab: String, CaseIterable, Identifiable, Hashable {
    case all, login, card, totp, passkey

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .login: return "Logins"
        case .card: return "Cards"
        case .totp: return "Codes"
        case .passkey: return "Passkeys"
        }
    }

    var systemImage: String {
        switch self {
        case .all: return "square.grid.2x2"
        case .login: return "globe"
        case .card: return "creditcard"
        case .totp: return "timer"
        case .passkey: return "key.fill"
        }
    }

    /// The wire discriminant this tab narrows to, matching
    /// `ItemFields.typeName` -- `nil` for `.all`, which applies no type
    /// filter at all.
    var wireType: String? {
        switch self {
        case .all: return nil
        case .login: return "login"
        case .card: return "card"
        case .totp: return "totp"
        case .passkey: return "passkey"
        }
    }
}

// MARK: - Section grouping (All tab only)

/// The six type sections the All tab groups by, in design-conformance's own
/// order, each with its section-index label. `totp` indexes as **`2`**, not
/// `C` -- Cards and Codes collide on `C`, and design-conformance calls this
/// out explicitly as the one label that is NOT simply the section's first
/// letter.
enum VaultSectionKind: CaseIterable {
    case login, card, totp, passkey, identity, note

    var wireType: String {
        switch self {
        case .login: return "login"
        case .card: return "card"
        case .totp: return "totp"
        case .passkey: return "passkey"
        case .identity: return "identity"
        case .note: return "note"
        }
    }

    var title: String {
        switch self {
        case .login: return "Logins"
        case .card: return "Cards"
        case .totp: return "Codes"
        case .passkey: return "Passkeys"
        case .identity: return "Identities"
        case .note: return "Notes"
        }
    }

    var indexLabel: String {
        switch self {
        case .login: return "L"
        case .card: return "C"
        case .totp: return "2"
        case .passkey: return "P"
        case .identity: return "I"
        case .note: return "N"
        }
    }
}

// MARK: - Search tokens (tags only -- see file header)

/// A folder/tag filter rendered as a `.searchable` token. FOLDER tokens are
/// deliberately NOT offered yet: `VaultStore` does not decrypt folder NAMES
/// today (`VaultAPI.swift`'s `FolderRow`/`SyncResponse.snapshot` carries
/// them off the wire but nothing decrypts `enc_name` into a `Folder` array
/// -- that lands with 38-09's folder support). Offering a folder token
/// labelled by its raw id would be worse than not offering one; `VaultFilter
/// .folder(id:)` stays a faithfully ported case with no UI path to it yet,
/// which is an honest, bounded scope cut, not an oversight.
struct VaultFilterToken: Identifiable, Hashable {
    let tag: String

    var id: String { "tag:\(tag)" }
    var label: String { tag }
    var filter: VaultFilter { .tag(tag) }
}

// MARK: - "+" create menu destinations

/// FIVE creatable types, not six -- `passkey` is provider-created only
/// (Phase 12, the extension/AutoFill path); there is no "create a passkey"
/// form on any client, matching D1's reconciling reading in the research
/// doc (five is the create/edit surface, six is the render surface) and
/// design-conformance §5's "type picker is editable only on create".
enum ItemCreationKind: CaseIterable {
    case login, card, identity, note, totp

    var title: String {
        switch self {
        case .login: return "Login"
        case .card: return "Card"
        case .identity: return "Identity"
        case .note: return "Note"
        case .totp: return "Code"
        }
    }

    var systemImage: String {
        switch self {
        case .login: return "globe"
        case .card: return "creditcard"
        case .identity: return "person.text.rectangle"
        case .note: return "note.text"
        case .totp: return "timer"
        }
    }

    /// A minimal, honestly-empty draft -- every required `String` field is
    /// `""` except `totp.secret`, which carries a placeholder valid base32
    /// value (the RFC 6238 / `crates/pv-core/src/totp.rs` test-vector
    /// secret) rather than an empty string, so a row that reaches the TOTP
    /// arithmetic 38-10 wires later does not immediately fail to decode a
    /// zero-length secret.
    func emptyFields() -> ItemFields {
        let name = "New \(title)"
        switch self {
        case .login:
            return .login(LoginFields(name: name, folderId: nil, tags: [], username: "", password: "", urls: [], notes: ""))
        case .card:
            return .card(CardFields(name: name, folderId: nil, tags: [], cardholderName: "", number: "", expiry: "", cvv: "", pin: nil, zip: nil, notes: ""))
        case .identity:
            return .identity(IdentityFields(name: name, folderId: nil, tags: [], firstName: "", lastName: "", email: "", phone: "", address: "", addressLine1: nil, addressLine2: nil, city: nil, state: nil, zip: nil, country: nil, notes: ""))
        case .note:
            return .note(NoteFields(name: name, folderId: nil, tags: [], body: ""))
        case .totp:
            return .totp(TotpFields(name: name, folderId: nil, tags: [], secret: "JBSWY3DPEHPK3PXP", issuer: "", algorithm: "SHA1", digits: 6, period: 30, notes: ""))
        }
    }
}

// MARK: - Row pill

private struct RowPill: Identifiable {
    let id: String
    let label: String
    let colorName: String
}

// MARK: - ItemListView

struct ItemListView: View {
    @Bindable var store: VaultStore

    /// Both `nil` by default -- the nav bar's Lock now/Sign out affordances
    /// render but are DISABLED rather than silently pretending to work.
    /// Real session teardown (nav path truncation, dismissing every
    /// presented sheet, clearing the reveal set) is 38-11's job
    /// (design-conformance §"38-11"); wiring a half-built lock action here
    /// risks the exact "true in the artifact, false in reality" defect
    /// shape this project has repeatedly paid for.
    var onLockRequested: (() -> Void)?
    var onSignOutRequested: (() -> Void)?

    @State private var selectedTab: VaultTypeTab = .all
    @State private var searchText = ""
    @State private var searchTokens: [VaultFilterToken] = []
    @State private var sortOption: SortOption = SortPreference.read()
    @State private var selection: VaultItemViewModel?
    @State private var deleteCandidate: VaultItemViewModel?
    @State private var editPlaceholderItem: VaultItemViewModel?
    @State private var statusMessage: String?
    @State private var copyConfirmation: String?

    // MARK: TEMPORARY tracer create bar (see file header)

    @State private var isCreating = false
    @State private var newItemMarker = ""

    // MARK: "+" create affordance

    @State private var isCreatingDraft = false

    /// E-U2/E-U3 FINDING (38-06, Task 3, recorded in
    /// `ios/IOS-SPIKE-LOG.md`): a SINGLE `NavigationStack` wrapping the whole
    /// `TabView`, with `.searchable` attached either to the `TabView` itself
    /// or to each `Tab`'s bare content, produced NO search chrome
    /// whatsoever on any tab -- confirmed twice, by live screenshots with
    /// zero search affordance anywhere on screen. Each `Tab` owning its OWN
    /// `NavigationStack` (this structure) is what actually renders the
    /// search field, matching Apple's own sample structure for
    /// `Tab(value:)`-based `TabView`s more literally than the research
    /// doc's "root content, not the container" guidance was originally
    /// read: the navigation bar `.searchable` docks into has to belong to
    /// the SAME `NavigationStack` instance the search modifier is attached
    /// within, not a stack living one level further out.
    var body: some View {
        TabView(selection: $selectedTab) {
            ForEach(VaultTypeTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: tab) {
                    NavigationStack {
                        tabContent(for: tab)
                            // BUG FOUND LIVE (plan 38-06, Task 2): the
                            // create bar was originally a row INSIDE the
                            // `List` below, which meant it was reachable
                            // ONLY when the vault already had at least one
                            // item -- on a genuinely empty vault, `List`
                            // never renders at all (the empty-state branch
                            // takes over), so the bar vanished entirely.
                            // That silently broke 38-05's already-passing
                            // `SnapshotEvidenceUITests`, which depends on
                            // this exact field being reachable on a FRESH
                            // account with zero items. A `safeAreaInset`
                            // at THIS level renders regardless of which
                            // branch `tabContent` takes.
                            .safeAreaInset(edge: .bottom) {
                                if tab == .all { createBar }
                            }
                            .searchable(
                                text: $searchText,
                                tokens: $searchTokens,
                                placement: .automatic,
                                prompt: Text(verbatim: "Search")
                            ) { token in
                                Label(token.label, systemImage: "tag")
                            }
                            .searchSuggestions { tokenSuggestions }
                            .navigationTitle(Text(verbatim: tab.title))
                            .toolbar { toolbarContent }
                            .overlay(alignment: .bottomTrailing) { createMenuCapsule }
                            .navigationDestination(item: $selection) { item in
                                ItemDetailView(item: item)
                            }
                            .sheet(item: $editPlaceholderItem) { item in
                                EditPlaceholderSheet(item: item)
                            }
                            .confirmationDialog(
                                "Delete this item?",
                                isPresented: Binding(
                                    get: { deleteCandidate != nil },
                                    set: { if !$0 { deleteCandidate = nil } }
                                ),
                                titleVisibility: .visible
                            ) {
                                Button("Delete", role: .destructive) {
                                    if let deleteCandidate {
                                        Task { await performDelete(deleteCandidate) }
                                    }
                                }
                                Button("Cancel", role: .cancel) { deleteCandidate = nil }
                            }
                            // Every tab shares the SAME `store.items` array,
                            // so only one tab needs to trigger the refresh --
                            // otherwise all five `Tab`s' `NavigationStack`s
                            // would each fire their own `GET /api/sync` on
                            // first appearance.
                            .task {
                                if tab == .all { await refresh() }
                            }
                    }
                }
            }
        }
        .modifier(AvailableTabBarMinimizeBehavior())
    }

    // MARK: - Tab content

    @ViewBuilder
    private func tabContent(for tab: VaultTypeTab) -> some View {
        let rows = filteredSortedItems(from: store.items, tab: tab)
        let searchOrFilterActive = !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !searchTokens.isEmpty

        if store.items.isEmpty {
            emptyVaultState
        } else if rows.isEmpty && searchOrFilterActive {
            ContentUnavailableView.search(text: searchText)
        } else if rows.isEmpty {
            ContentUnavailableView(
                "No \(tab.title.lowercased()) yet",
                systemImage: tab.systemImage
            )
        } else {
            List {
                if tab == .all {
                    allTabSections(rows)
                } else {
                    ForEach(rows) { item in rowButton(item) }
                }
            }
            .modifier(AvailableListSectionIndexVisibility())
            .refreshable { await refresh() }
        }
    }

    @ViewBuilder
    private func allTabSections(_ rows: [VaultItemViewModel]) -> some View {
        ForEach(VaultSectionKind.allCases, id: \.self) { section in
            let sectionRows = rows.filter { $0.fields?.typeName == section.wireType }
            if !sectionRows.isEmpty {
                Section {
                    ForEach(sectionRows) { item in rowButton(item) }
                } header: {
                    Text(verbatim: "\(section.title) (\(sectionRows.count))")
                }
                .modifier(AvailableSectionIndexLabel(label: section.indexLabel))
            }
        }
        // `undecryptable` rows are shown, NEVER filtered (design-
        // conformance's "One more" rule) -- they get their own section, not
        // folded into one of the six type sections above (an undecryptable
        // row has no readable `type` to group by), and not hidden behind
        // any of the six index letters either.
        let undecryptableRows = rows.filter(\.isUndecryptable)
        if !undecryptableRows.isEmpty {
            Section {
                ForEach(undecryptableRows) { item in rowButton(item) }
            } header: {
                Text(verbatim: "Needs attention (\(undecryptableRows.count))")
            }
        }
        let pendingRows = rows.filter(\.isPendingFamilyKey)
        if !pendingRows.isEmpty {
            Section {
                ForEach(pendingRows) { item in rowButton(item) }
            } header: {
                Text(verbatim: "Waiting for family key (\(pendingRows.count))")
            }
        }
    }

    @ViewBuilder
    private var emptyVaultState: some View {
        ContentUnavailableView(
            "No items yet",
            systemImage: "tray",
            description: Text(verbatim: "Items you create appear here.")
        )
    }

    // MARK: - Row

    /// A live-observed SwiftUI interaction shapes this row's modifier set,
    /// recorded here because a reader diffing against the research doc
    /// would otherwise see an UNEXPLAINED narrowing of the plan's own
    /// action list:
    ///
    /// 1. A `Button` wrapping the row (the tracer's original shape)
    ///    swallowed the long-press gesture `.contextMenu` needs entirely --
    ///    an XCUITest coordinate-based long press on the Button-wrapped row
    ///    produced no menu at all, screenshot after screenshot. Replaced
    ///    with plain row content plus `.onTapGesture` for navigation,
    ///    which is a strict behavioural improvement (no `Button` to
    ///    conflict with anything), not merely a workaround.
    /// 2. A LEADING `.swipeActions` specifically -- not swipe actions in
    ///    general, and not modifier ORDER -- conflicts with `.contextMenu`
    ///    on the same row: with a leading swipe present, the identical long
    ///    press that opens the menu cleanly without it produced nothing,
    ///    confirmed by removing first both edges (menu worked), then only
    ///    the leading edge (menu worked, trailing delete still present),
    ///    isolating the leading edge as the specific cause. The leading
    ///    "copy the primary secret" swipe action the research doc's own
    ///    action list names is therefore NOT implemented as a swipe -- it
    ///    remains reachable through the context menu's copy actions
    ///    (`contextMenuContent`, which already covers login/card/identity),
    ///    which is a real, working, merely less-immediate affordance, not
    ///    a removed one. The TRAILING destructive-delete swipe (the
    ///    security-relevant one T-38-06-03 actually gates, and the one the
    ///    plan's own grep tests) is unaffected and stays exactly as
    ///    specified.
    @ViewBuilder
    private func rowButton(_ item: VaultItemViewModel) -> some View {
        row(item)
            .contentShape(Rectangle())
            .onTapGesture {
                selection = item
            }
            .contextMenu {
                contextMenuContent(item)
            }
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                // A vault item must NEVER be deletable by one uninterrupted
                // swipe (T-38-06-03) -- `allowsFullSwipe: false` is the
                // whole of that guarantee, and this line is what the
                // plan's own grep checks for zero permitted `true` hits.
                Button(role: .destructive) {
                    deleteCandidate = item
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            }
    }

    @ViewBuilder
    private func row(_ item: VaultItemViewModel) -> some View {
        HStack(spacing: 12) {
            ItemIconTile(item: item)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.displayName)
                    .foregroundStyle(Color("PVTextPrimary"))
                if let subtitle = subtitle(for: item) {
                    Text(verbatim: subtitle)
                        .font(.caption)
                        .foregroundStyle(Color("PVTextMuted"))
                }
            }
            Spacer()
            ForEach(pills(for: item)) { pill in
                Text(verbatim: pill.label)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color(pill.colorName).opacity(0.15))
                    .foregroundStyle(Color(pill.colorName))
                    .clipShape(Capsule())
            }
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(Color("PVTextMuted"))
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("vault.row.\(item.id)")
        // The row is no longer a `Button` (see `rowButton`'s own note on
        // why), but every existing accessibility-driven query in this
        // plan's UI tests -- and 38-05's already-passing
        // `SnapshotEvidenceUITests` -- looks it up via `app.buttons`. This
        // keeps that surface unchanged.
        .accessibilityAddTraits(.isButton)
    }

    private func subtitle(for item: VaultItemViewModel) -> String? {
        guard let fields = item.fields else { return nil }
        switch fields {
        case let .login(f):
            return f.username.isEmpty ? nil : f.username
        case let .card(f):
            let digits = f.number.filter(\.isNumber)
            guard digits.count >= 4 else { return nil }
            return "•••• \(digits.suffix(4))"
        case let .totp(f):
            return f.issuer.isEmpty ? nil : f.issuer
        case let .passkey(f):
            return f.rpId.isEmpty ? nil : f.rpId
        case let .identity(f):
            return f.email.isEmpty ? nil : f.email
        case let .note(f):
            return f.body.split(separator: "\n", maxSplits: 1).first.map(String.init)
        }
    }

    /// Pills: `Passkey` (`PVPasskey`), `Shared` (neutral `PVTextMuted` --
    /// shared is a FACT, not a warning), `Damaged` (`PVError`).
    /// `Not synced` is intentionally never produced here -- there is no
    /// offline cache yet to be stale against (that concept arrives with
    /// Phase 39's sync/offline cache); a pill this build could never
    /// legitimately show would be a lie by construction.
    private func pills(for item: VaultItemViewModel) -> [RowPill] {
        var result: [RowPill] = []
        if case .passkey = item.fields {
            result.append(RowPill(id: "passkey", label: "Passkey", colorName: "PVPasskey"))
        }
        if item.isShared == true {
            result.append(RowPill(id: "shared", label: "Shared", colorName: "PVTextMuted"))
        }
        if item.isUndecryptable {
            result.append(RowPill(id: "damaged", label: "Damaged", colorName: "PVError"))
        }
        return result
    }

    // MARK: - Context menu actions

    @ViewBuilder
    private func contextMenuContent(_ item: VaultItemViewModel) -> some View {
        ForEach(copyActions(for: item), id: \.label) { action in
            Button(action.label) {
                copySecret(action.value, fieldLabel: action.label)
            }
        }
        // Passkey detail has no Edit (cryptographic material, not user
        // content -- design-conformance §5) and an `undecryptable` row's
        // revision is known stale, so no save path may target it
        // (T-38-03-05). `canEditItem` covers the sharing-derived gate; the
        // two checks alongside it cover what `canEditItem` structurally
        // cannot see.
        if item.fields?.typeName != "passkey",
            !item.isUndecryptable,
            ItemCapabilities.canEditItem(item)
        {
            Button("Edit") {
                editPlaceholderItem = item
            }
        }
        Button("Delete", role: .destructive) {
            deleteCandidate = item
        }
    }

    /// Mirrors `ItemContextMenu.tsx`'s `copyActionsFor` (login: username +
    /// password; card: number; identity: email). `Move to folder` and
    /// `Share` are deliberately NOT offered -- see this file's header and
    /// `VaultFilterToken`'s own note: there is no working move/share
    /// mutation path yet (`VaultStore` has no update-item call at all, and
    /// `ShareDialog` does not exist on iOS), so omitting them is the same
    /// "do not offer an operation known to fail" discipline
    /// `ItemCapabilities.swift` names, not an oversight.
    private func copyActions(for item: VaultItemViewModel) -> [(label: String, value: String)] {
        guard let fields = item.fields else { return [] }
        switch fields {
        case let .login(f):
            var actions: [(label: String, value: String)] = []
            if !f.username.isEmpty { actions.append(("Copy username", f.username)) }
            if !f.password.isEmpty { actions.append(("Copy password", f.password)) }
            return actions
        case let .card(f):
            return f.number.isEmpty ? [] : [("Copy card number", f.number)]
        case let .identity(f):
            return f.email.isEmpty ? [] : [("Copy email", f.email)]
        default:
            return []
        }
    }

    /// A conservative, auto-expiring pasteboard write -- the sanctioned
    /// mechanism the research doc names (`UIPasteboard.setObjects(_:
    /// localOnly:expirationDate:)`, `UIKit.swiftinterface:5632`, iOS 11,
    /// "equivalent for a plain string"), used directly rather than waiting
    /// on 38-07's dedicated `ClipboardService` (UI-07's auto-clear timer,
    /// reveal-state wiring, `ClipboardServiceTests.swift`). 40 seconds
    /// matches this codebase's own established default clipboard timeout
    /// (`web/src/lib/idle/autolock.ts`'s sibling constant, "clamped 30-60,
    /// default 40" per the research doc). `localOnly: true` -- a copied
    /// secret must never propagate to a paired Mac/other device via
    /// Universal Clipboard.
    private func copySecret(_ value: String, fieldLabel: String) {
        UIPasteboard.general.setObjects(
            [value], localOnly: true, expirationDate: Date().addingTimeInterval(40)
        )
        copyConfirmation = "Copied \(fieldLabel)"
    }

    // MARK: - Search suggestions (tags)

    @ViewBuilder
    private var tokenSuggestions: some View {
        let selected = Set(searchTokens.map(\.tag))
        let needle = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let candidates = store.allTags.filter { tag in
            !selected.contains(tag) && (needle.isEmpty || tag.lowercased().contains(needle))
        }
        ForEach(candidates, id: \.self) { tag in
            Label(tag, systemImage: "tag")
                .searchCompletion(VaultFilterToken(tag: tag))
        }
    }

    // MARK: - Toolbar (nav bar avatar menu)

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Button {
                onLockRequested?()
            } label: {
                Label("Lock now", systemImage: "lock.fill")
            }
            .disabled(onLockRequested == nil)
            .accessibilityIdentifier("vault.lockNow")
        }
        ToolbarItem(placement: .topBarTrailing) {
            // Family and Settings have no screen to open yet (Family is
            // Phase 40's job; there is no generic Settings screen planned
            // for this milestone at all) -- both entries render, disabled,
            // rather than either vanishing (which would misrepresent the
            // approved navigation architecture as simpler than it is) or
            // silently doing nothing when tapped (a fake affordance).
            Menu {
                Button("Family") {}
                    .disabled(true)
                Button("Settings") {}
                    .disabled(true)
                Divider()
                Button("Lock now") { onLockRequested?() }
                    .disabled(onLockRequested == nil)
                Button("Sign out", role: .destructive) { onSignOutRequested?() }
                    .disabled(onSignOutRequested == nil)
            } label: {
                Image(systemName: "person.crop.circle")
            }
            .accessibilityIdentifier("vault.avatarMenu")
        }
    }

    // MARK: - TEMPORARY tracer create bar (kept for 38-05 test compatibility)

    /// UNCHANGED from 38-02's tracer, verbatim -- see this file's header.
    /// 38-09 replaces this with the real create/edit form.
    @ViewBuilder
    private var createBar: some View {
        VStack(spacing: 8) {
            if let statusMessage {
                Text(verbatim: statusMessage)
                    .font(.caption)
                    .foregroundStyle(Color("PVTextMuted"))
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

    // MARK: - "+" create menu (design-conformance §1's detached capsule)

    /// A STOCK `Menu`, not a hand-built morphing capsule-to-grid animation --
    /// "do not hand-roll the glass" applies as much to a custom expand/
    /// collapse transition as it does to `glassEffect` itself. This is a
    /// recorded, deliberate simplification of the visual spec (a genuine 3×3
    /// grid that morphs from a detached circular capsule), not a silent
    /// substitution: the six destinations and the "create, then open it"
    /// behaviour are real and functionally equivalent, and 38-09's real
    /// create/edit form is the natural place to revisit the exact visual
    /// treatment once there is a form worth animating open.
    @ViewBuilder
    private var createMenuCapsule: some View {
        Menu {
            ForEach(ItemCreationKind.allCases, id: \.self) { kind in
                Button {
                    Task { await createDraft(kind) }
                } label: {
                    Label(kind.title, systemImage: kind.systemImage)
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.title2.weight(.semibold))
                .foregroundStyle(Color("PVOnAccent"))
                .frame(width: 56, height: 56)
                .background(Color("PVAccent"), in: Circle())
                .shadow(radius: 4, y: 2)
        }
        .disabled(isCreatingDraft)
        .padding()
        .accessibilityIdentifier("vault.create.plusMenu")
    }

    /// Creates a minimal, honestly-empty draft of the chosen type and opens
    /// it immediately -- real `VaultStore.create(fields:)` calls, not a
    /// placeholder. Field completion (a real create/edit FORM) is 38-09's
    /// job; this exists so the ＋ affordance the design mandates does
    /// something genuine today rather than nothing.
    private func createDraft(_ kind: ItemCreationKind) async {
        isCreatingDraft = true
        defer { isCreatingDraft = false }
        do {
            let created = try await store.create(fields: kind.emptyFields())
            selection = created
        } catch {
            statusMessage = "create failed: \(error)"
        }
    }

    // MARK: - Data pipeline (filter, then search, then sort)

    /// Composes `VaultFilterFunctions.filterItems` -> `VaultSearch
    /// .searchItems` -> `VaultSort.sortItems`, in that order, matching
    /// `ItemList.tsx:32`'s documented composition exactly. The tab's item
    /// type and every active tag token are additional `VaultFilter`
    /// applications, ANDed together left-to-right before the query narrows
    /// the set further and the sort runs last, over the fully-narrowed
    /// result.
    private func filteredSortedItems(
        from items: [VaultItemViewModel], tab: VaultTypeTab
    ) -> [VaultItemViewModel] {
        var working = items
        if let wireType = tab.wireType {
            working = VaultFilterFunctions.filterItems(working, filter: .itemType(wireType))
        }
        for token in searchTokens {
            working = VaultFilterFunctions.filterItems(working, filter: token.filter)
        }
        working = VaultSearch.searchItems(working, query: searchText)
        working = VaultSort.sortItems(working, by: sortOption)
        return working
    }

    // MARK: - Network

    private func refresh() async {
        do {
            try await store.refresh()
        } catch {
            statusMessage = "refresh failed: \(error)"
        }
    }

    private func performDelete(_ item: VaultItemViewModel) async {
        deleteCandidate = nil
        do {
            try await store.delete(item)
            if selection?.id == item.id {
                selection = nil
            }
        } catch {
            statusMessage = "delete failed: \(error)"
        }
    }
}

// MARK: - iOS 26-only modifiers, guarded on the modifier (never the view body)

/// `sectionIndexLabel(_:)` is iOS 26.0+ (`SwiftUI.swiftinterface`). Guarding
/// on the MODIFIER rather than wrapping the whole `Section` in an
/// `if #available` at the call site keeps every call site identical
/// regardless of SDK/floor, per design-conformance's standing obligation 5.
private struct AvailableSectionIndexLabel: ViewModifier {
    let label: String
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.sectionIndexLabel(label)
        } else {
            // Below iOS 26 there is no native section index -- omitted
            // entirely rather than bridged via `UIViewRepresentable` to
            // `UITableView.sectionIndexTitles`, which would stop this being
            // a stock `List` (design-conformance §2's explicit instruction).
            content
        }
    }
}

/// `listSectionIndexVisibility(_:)` is iOS 26.0+.
private struct AvailableListSectionIndexVisibility: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.listSectionIndexVisibility(.visible)
        } else {
            content
        }
    }
}

/// `tabBarMinimizeBehavior(_:)` is iOS 26.0+.
private struct AvailableTabBarMinimizeBehavior: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            content
        }
    }
}

// MARK: - Edit placeholder (38-09 owns the real form)

/// Presence/absence of the Edit context-menu entry is the acceptance
/// criterion this plan's own gating tests screenshot -- NOT the completeness
/// of an edit form, which 38-09 owns. This sheet exists so tapping a
/// gated-visible Edit entry does something honest rather than nothing.
private struct EditPlaceholderSheet: View {
    let item: VaultItemViewModel
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            VStack(spacing: 12) {
                Image(systemName: "pencil.circle")
                    .font(.largeTitle)
                    .foregroundStyle(Color("PVTextMuted"))
                Text(verbatim: "Editing \(item.displayName)")
                    .font(.headline)
                Text(verbatim: "The edit form arrives in a later phase (38-09). This entry is gated correctly today; it does not yet save changes.")
                    .font(.footnote)
                    .foregroundStyle(Color("PVTextMuted"))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal)
            }
            .padding()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium])
    }
}
