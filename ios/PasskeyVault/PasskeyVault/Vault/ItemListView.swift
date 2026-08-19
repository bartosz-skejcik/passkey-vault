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
import os

// MARK: - Dock tab bar (item-type filter)

/// The FOUR dock tabs, in the order `40-UI-SPEC.md`'s ORCHESTRATOR
/// RESOLUTION (§0.1) fixed: **All · Logins · Folders · Codes**, plus the
/// detached ＋.
///
/// Phase 40, plan 40-05 (BINDING SCOPE ADDITION -- the dock swap): `Cards`
/// is REPLACED by `Folders`, 1:1, per Bartek's literal instruction ("w
/// pasku zamiast cards daj folders"). This is the same four-tab-plus-＋
/// silhouette Phase 38 shipped -- `40-UI-SPEC.md`'s own §0.1 five-filter
/// drawing (All/Logins/Folders/Codes/Passkeys) was explicitly overruled by
/// the orchestrator resolution BEFORE this plan started, precisely to avoid
/// re-measuring the six-item `Tab(role: .search)` overflow
/// (`ios/evidence/38/38-06-dock-role-search-overflows-to-more.png`) this
/// file's Phase 38 header already photographed once. `Cards` therefore
/// drops out of the tab bar the same way `passkey`/`identity`/`note`
/// already had -- reachable exclusively through the All tab's own type
/// sections (`VaultSectionKind`, unaffected, still all six types) and its
/// section index.
///
/// **Folders is NOT a `wireType` filter** -- selecting it routes to a
/// DIFFERENT root (`FoldersListView`, this file's `tabContent(for:)`),
/// never a type-filtered item list. See that function's own note on why
/// `wireType: nil` for `.folder` is deliberately never treated the way
/// `.all`'s `nil` is.
enum VaultTypeTab: String, CaseIterable, Identifiable, Hashable {
    case all, login, folder, totp

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all: return "All"
        case .login: return "Logins"
        case .folder: return "Folders"
        case .totp: return "Codes"
        }
    }

    var systemImage: String {
        switch self {
        case .all: return "square.grid.2x2"
        case .login: return "globe"
        case .folder: return "folder"
        case .totp: return "timer"
        }
    }

    /// The wire discriminant this tab narrows to, matching
    /// `ItemFields.typeName` -- `nil` for `.all` (no type filter at all) AND
    /// for `.folder` (not a type filter in the first place -- `tabContent
    /// (for:)` branches on `tab == .folder` BEFORE this property is ever
    /// consulted for filtering, so `.folder`'s `nil` here is never
    /// mistaken for "no filter" the way `.all`'s is).
    var wireType: String? {
        switch self {
        case .all: return nil
        case .login: return "login"
        case .folder: return nil
        case .totp: return "totp"
        }
    }
}

/// The `TabView`'s selection value. `.plus` exists so the detached ＋ can be a
/// real `Tab` (the only way to get that slot) without becoming a fifth *filter*
/// -- selecting it toggles the panel and the binding's getter immediately
/// bounces selection back to the current type tab, so no content view is ever
/// shown for it.
private enum DockSlot: Hashable {
    case type(VaultTypeTab)
    case plus
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

/// The ONE type-section grouping mechanism -- section headers with counts,
/// `VaultSectionKind`'s own declaration order, and (iOS 26+) the trailing
/// section index. Shared by the All tab's own list (`ItemListView
/// .allTabSections`) and, quick fix 40-UX-01, the Folders tab's folder-open
/// screen (`FoldersListView.swift`'s `FolderOpenView`) -- a free, file-scope
/// function (not a private instance method) precisely so a DIFFERENT file's
/// view can call it too, rather than re-implementing the same `ForEach
/// (VaultSectionKind.allCases...)` loop a second time. `rowContent` stays a
/// caller-supplied closure so this function knows nothing about `rowButton`'s
/// tap/context-menu/swipe wiring -- that stays wherever the caller already
/// owns it (`ItemListView`'s own `rowButton`, or the closure `ItemListView`
/// already hands `FolderOpenView` for the exact same purpose).
///
/// Deliberately narrower than `ItemListView.allTabSections`: the
/// `undecryptable`/`isPendingFamilyKey` catch-all sections stay OUT of this
/// shared function and are appended by `allTabSections` itself, not
/// duplicated here for `FolderOpenView` to also render -- an item with
/// `fields == nil` (both of those states) has no `folderId` to match
/// against, so `FolderOpenView`'s own `folderItems` filter already excludes
/// them structurally; a folder-open list can never need those two sections.
@ViewBuilder
func vaultTypeSections<RowContent: View>(
    _ rows: [VaultItemViewModel],
    @ViewBuilder rowContent: @escaping (VaultItemViewModel) -> RowContent
) -> some View {
    ForEach(VaultSectionKind.allCases, id: \.self) { section in
        let sectionRows = rows.filter { $0.fields?.typeName == section.wireType }
        if !sectionRows.isEmpty {
            Section {
                ForEach(sectionRows) { item in rowContent(item) }
            } header: {
                Text(verbatim: "\(section.title) (\(sectionRows.count))")
            }
            .modifier(AvailableSectionIndexLabel(label: section.indexLabel))
        }
    }
}

// MARK: - Search tokens (tags only -- see file header)

/// A folder/tag filter rendered as a `.searchable` token. FOLDER tokens are
/// deliberately NOT offered yet: `VaultStore` does not decrypt folder NAMES
/// today (`Sync/SyncModels.swift`'s `FolderRow`/`SyncPullResult.snapshot`
/// carries them off the wire but nothing here decrypts `enc_name` into a
/// `Folder` array -- `FolderStore`, 38-09's folder support, owns that).
/// Offering a folder token
/// labelled by its raw id would be worse than not offering one; `VaultFilter
/// .folder(id:)` stays a faithfully ported case with no UI path to it yet,
/// which is an honest, bounded scope cut, not an oversight.
struct VaultFilterToken: Identifiable, Hashable {
    let tag: String

    var id: String { "tag:\(tag)" }
    var label: String { tag }
    var filter: VaultFilter { .tag(tag) }
}

// MARK: - The dock's ＋ action grid
//
// `ItemCreationKind` lives in `ItemFormView.swift` (moved there in plan
// 38-11, addendum A2, when the dedicated `TypePicker` view was retired) --
// the five-case enum and its `emptyFields()` factory are unchanged.

/// The EIGHT slots of the ＋ panel, quick task 260818-lsk. Three columns, so
/// three rows (two full, the last holding two).
///
/// This supersedes the SIX-slot set plans 38-06/38-09 shipped -- that
/// narrowing is not reversed here, it is EXTENDED by two slots that were
/// always the plan for a later pass: Scan QR code (a real TOTP entry path,
/// not a placeholder) and New folder (a direct route to the folder-creation
/// surface that already existed, buried inside "Move to folder"/the form's
/// Folder row, with no way to reach it from the panel itself).
///
/// - **Scan QR code** -- now the PRIMARY way to add a TOTP code. Most
///   platforms hand out an `otpauth://` QR code carrying issuer/account/
///   secret directly; scanning it is faster and less error-prone than
///   transcribing a base32 secret by hand. `New code` (below) is not
///   retired by this -- not every platform offers a QR code, some only show
///   the raw secret -- so it stays as the manual fallback, and the scanner
///   itself falls back to the same manual form when the camera is
///   unavailable or permission is refused (`TotpScanView.swift`).
/// - **New folder** -- reuses `FolderPicker` (`FolderPicker.swift`) exactly
///   as it already existed for "Move to folder"; this slot is a second
///   entry point into the SAME view, not a new form. See
///   `VaultActiveSheet.creatingFolder`.
///
/// The three slots still absent are still absent for the reasons already
/// recorded, and nothing above changes them:
///
/// - **New passkey** -- not a scope gap and never will be. A passkey is
///   cryptographic material minted during a real WebAuthn ceremony by the
///   AutoFill credential provider; there is no meaningful "type one in" form
///   for it, here or ever. A permanently-disabled slot for a permanently
///   impossible action is not honesty, it is furniture.
/// - **Scan card** -- real, wanted, unbuilt: it needs bespoke Vision OCR
///   this pass does not build. The camera permission this pass DOES add
///   (`NSCameraUsageDescription`, for QR) makes that a cheap follow-up
///   rather than a second permission gate to design later.
/// - **Import** -- moves to Settings, not to this panel; recorded as
///   backlog, not built now. A bulk import is a different interaction shape
///   (pick a file, review a batch) than every other tile here (open a form
///   for one item), and Settings is where the rest of the app's
///   account-level actions already live.
///
/// Every one of the eight below has a working path. There is no
/// `isAvailable` flag any more, because nothing is unavailable --
/// reintroducing one is the signal that this decision is being reversed.
enum VaultCreateAction: String, CaseIterable, Identifiable {
    // Declaration order IS render order (`CaseIterable`'s synthesized
    // `allCases` follows source order for a plain enum) -- this is the
    // literal 1-8 sequence the panel renders, not merely a convenient list.
    case login, card, identity, note, code, scanQr, generatePassword, newFolder

    var id: String { rawValue }

    var title: String {
        switch self {
        case .login: return "New login"
        case .card: return "New card"
        case .identity: return "New identity"
        case .note: return "New note"
        case .code: return "New code"
        case .scanQr: return "Scan QR code"
        case .generatePassword: return "Generate password"
        case .newFolder: return "New folder"
        }
    }

    var systemImage: String {
        switch self {
        case .login: return "globe"
        case .card: return "creditcard"
        case .identity: return "person.text.rectangle"
        case .note: return "note.text"
        case .code: return "timer"
        case .scanQr: return "qrcode.viewfinder"
        case .generatePassword: return "dice"
        case .newFolder: return "folder.badge.plus"
        }
    }

    /// The item type this slot creates, or `nil` for a slot that is not a
    /// create-an-item action at all (Generate password, Scan QR code, New
    /// folder -- none of these open `ItemFormView` directly for a fresh
    /// draft the way the five item types do; Scan QR code opens it only
    /// AFTER a successful scan, with parsed fields, which `perform(_:)`
    /// handles separately from this property).
    var creationKind: ItemCreationKind? {
        switch self {
        case .login: return .login
        case .card: return .card
        case .identity: return .identity
        case .note: return .note
        case .code: return .totp
        case .scanQr: return nil
        case .generatePassword: return nil
        case .newFolder: return nil
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

    /// `nil` in any context that has no folder support wired (existing
    /// tests/previews predating 38-09) -- every folder-dependent affordance
    /// (the form's Folder row, "Move to folder") is itself conditional on
    /// this being non-nil, never a force-unwrap.
    var folderStore: FolderStore?

    /// Plan 38-11: the navigation path (`selection`), the presented-sheet
    /// router (`activeSheet`) and the search state all moved OUT of this
    /// view's own `@State` and into `VaultRootView`'s `VaultRootController`
    /// -- so that controller's single `lockTeardown()` handler can reach
    /// every one of them without poking into this view's private state.
    /// `@Bindable` (not a plain `let`) so `$root.selection`/`$root.activeSheet`
    /// keep working as real `Binding`s at every call site below.
    @Bindable var root: VaultRootController

    /// Real session teardown (store wipe, nav path truncation, dismissing
    /// every presented sheet, clearing the reveal set) is wired through
    /// `VaultRootView.performLock()`, which this closure always is in
    /// production -- `nil` only in tests/previews that construct
    /// `ItemListView` directly without a `VaultRootView` wrapper.
    var onLockRequested: (() -> Void)?
    var onSignOutRequested: (() -> Void)?

    /// CR-04 (40-REVIEW.md): `nil` only in tests/previews that construct
    /// `ItemListView` directly, matching `onLockRequested`'s own
    /// established discipline above. Non-nil in every production
    /// construction (`VaultRootView`) -- gates the avatar-menu "Family"
    /// entry and the item detail "Share" entry point.
    var familySharingContext: FamilySharingContext?

    @State private var selectedTab: VaultTypeTab = .all
    /// Folders tab navigation (BINDING SCOPE ADDITION, `40-UI-SPEC.md`
    /// §5.3) -- set by `FoldersListView`'s `onOpenFolder`, consumed by the
    /// `.navigationDestination(item:)` in `body` below. Deliberately a
    /// SEPARATE optional from `root.selection` (items) -- a folder is not a
    /// `VaultItemViewModel`.
    @State private var selectedFolder: Folder?
    @State private var sortOption: SortOption = SortPreference.read()
    @State private var deleteCandidate: VaultItemViewModel?
    /// DEBUG-only, and off unless a UI test asks for it. See the
    /// `safeAreaInset` call site for the full reasoning; in a Release build the
    /// tracer bar cannot be rendered at all.
    private static var showsTracerCreateBar: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.environment["PV_UITEST_TRACER_CREATE_BAR"] != nil
        #else
        return false
        #endif
    }

    /// WR-05 (38-REVIEW.md, iteration 2): a typed, dismissable, tone-correct
    /// replacement for the old bare `String?` -- that variable was written
    /// for a DEBUG tracer bar (never cleared, no dismiss, rendered in
    /// `.error` tone unconditionally) and the WR-01 fix made it visible on
    /// every build without giving it any of the properties a Release-visible
    /// error channel needs. `id` makes it `Identifiable` for `.sheet(item:)`-
    /// style call sites and gives `SwiftUI` a stable identity across
    /// consecutive DIFFERENT failures with the same text.
    private struct StatusBanner: Identifiable {
        let id = UUID()
        let text: String
        let tone: StatusCallout.Tone
    }

    /// Production error channel: refresh/move/delete failures ONLY. Cleared
    /// on the next successful operation and on the banner's own dismiss
    /// button -- never left pinned across a successful retry the way the old
    /// `statusMessage` was.
    @State private var statusBanner: StatusBanner?
    /// The tracer create bar's OWN message, deliberately separate from
    /// `statusBanner` -- `createBar` is opt-in behind
    /// `PV_UITEST_TRACER_CREATE_BAR` (a DEBUG-only env var; the view itself,
    /// like `isCreating`/`newItemMarker` above, stays unconditionally
    /// compiled) and its "created <id>" success text has no business
    /// rendering in `StatusCallout(tone: .error)` (WR-05 point 4: before
    /// this split, a DEBUG success message rendered twice, once here and
    /// once in the general inset, both in the error tone).
    @State private var tracerStatusMessage: String?
    /// CR-03 fix: was `String?`, written once at :1274 and never rendered
    /// anywhere -- the list/context-menu copy path now routes through
    /// `ClipboardService` (same choke point `ItemDetailView` uses), so this
    /// carries the same `ClipboardConfirmation` type and is actually shown
    /// (see `copyConfirmationBanner` below).
    @State private var copyConfirmation: ClipboardConfirmation?

    // MARK: TEMPORARY tracer create bar (see file header)

    @State private var isCreating = false
    @State private var newItemMarker = ""

    // MARK: "+" create / edit / move-to-folder sheet router
    //
    // ONE `.sheet(item:)` binding for all four surfaces (plan 38-09), rather
    // than four independent `.sheet` modifiers each with its own `Bool`/
    // optional-item trigger: the "+" grid handing off directly to
    // `ItemFormView` means the SAME state transition (one sheet's content
    // changing to another) has to be expressed as ONE identity change, not
    // a dismiss-then-present race between two separately-driven modifiers.
    //
    // Plan 38-11: the router type moved to file scope as `VaultActiveSheet`
    // and the LIVE VALUE moved to `VaultRootController.activeSheet`, so the
    // controller's single lock handler can dismiss whatever is presented
    // without reaching into this view's private state. See that type's own
    // header in `VaultRootView.swift`.

    // MARK: The dock
    //
    // `isCreateExpanded` drives BOTH halves of the ＋ affordance at once --
    // the detached capsule's glyph (＋ / ✕) and whether the panel is on
    // screen -- so the two can never disagree about whether it is open.
    @State private var isCreateExpanded = false

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
        TabView(selection: dockSelection) {
            ForEach(VaultTypeTab.allCases) { tab in
                Tab(tab.title, systemImage: tab.systemImage, value: DockSlot.type(tab)) {
                    NavigationStack {
                        dimmable(tabContent(for: tab))
                            // Plan 39-06 (SYNC-04): the last-synced surface,
                            // visible on EVERY tab without interaction and
                            // without scrolling -- a `.top` safe-area inset
                            // sits right under the navigation bar, on every
                            // pass through this closure. This view is handed
                            // the WHOLE snapshot object; THIS file reads no
                            // field out of it at all -- see this plan's own
                            // single-source gate, which enumerates this
                            // file's deliberate absence from its allowlist.
                            .safeAreaInset(edge: .top) {
                                SyncStatusView(snapshot: store.currentSnapshot, lastError: store.lastError)
                                    .padding(.horizontal)
                                    .padding(.top, 4)
                            }
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
                            // The tracer's marker-note create bar is TEST-ONLY
                            // from 2026-08-17 on.
                            //
                            // It was left visible in the product because
                            // 38-05's `SnapshotEvidenceUITests` depends on
                            // `vault.create.marker`/`vault.create.submit` being
                            // reachable on the list screen, and 38-06's SUMMARY
                            // expected 38-09 to retire the bar and that
                            // dependency together. 38-09 retired neither, so a
                            // debug text field labelled "Run marker" and a raw
                            // item UUID were sitting on the real vault screen,
                            // overlapping the create button
                            // (`ios/evidence/38/38-06-list-at-rest.png`).
                            //
                            // Gating it on the env var the snapshot test
                            // already sets keeps that evidence working without
                            // shipping the scaffolding. Deleting it outright
                            // would break a passing E-S1 proof; hiding it
                            // behind a flag the test controls does not.
                            .safeAreaInset(edge: .bottom) {
                                if tab == .all, Self.showsTracerCreateBar { createBar }
                            }
                            // CR-03 fix, restyled by the Phase 40 design-
                            // conformance fix: the list/context-menu copy
                            // confirmation renders via the SAME shared
                            // `CopyHUD` (`Core/CopyHUD.swift`) the detail
                            // screen uses -- `.overlay`, not
                            // `.safeAreaInset`: a HUD floats over content,
                            // it does not reserve layout space that shifts
                            // the dock/list underneath it, which the old
                            // full-width banner's `safeAreaInset` did.
                            .overlay(alignment: .bottom) {
                                if let copyConfirmation {
                                    CopyHUD(confirmation: copyConfirmation, accessibilityId: "vault.list.copyConfirmation")
                                        .padding(.bottom, 12)
                                        .task(id: copyConfirmation.deadline) {
                                            await CopyHUD.autoDismiss { self.copyConfirmation = nil }
                                        }
                                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                                        .animation(.default, value: copyConfirmation.deadline)
                                }
                            }
                            .sensoryFeedback(.success, trigger: copyConfirmation?.deadline)
                            // WR-01 fix: `statusMessage` was previously
                            // rendered ONLY inside `createBar`, which is
                            // DEBUG-gated and opt-in behind
                            // `PV_UITEST_TRACER_CREATE_BAR` -- every
                            // Release-reachable writer (refresh/delete/move
                            // failures) wrote to a variable nothing could
                            // ever display. This inset is unconditional, on
                            // every build, every tab.
                            //
                            // WR-05 (iteration 2): `statusBanner` replaces
                            // the old bare `String?` -- typed tone, a
                            // dismiss button (`statusBannerView` below),
                            // and cleared on the next successful operation
                            // rather than pinned for the life of the view.
                            .safeAreaInset(edge: .bottom) {
                                if let statusBanner {
                                    statusBannerView(statusBanner)
                                        .padding(.horizontal)
                                        .padding(.bottom, 4)
                                }
                            }
                            .modifier(AvailableVaultSearchable(
                                text: $root.searchText,
                                tokens: $root.searchTokens,
                                isPresented: $root.isSearchPresented
                            ))
                            .searchSuggestions { tokenSuggestions }
                            .modifier(AvailableMinimizedSearchToolbar(isSearchPresented: root.isSearchPresented))
                            .navigationTitle(Text(verbatim: tab.title))
                            .toolbar { toolbarContent }
                            .navigationDestination(item: $root.selection) { item in
                                // 38-07: the detail screen owns its own
                                // last-used-recording wiring on reveal and
                                // copy -- this row/context-menu copy path
                                // deliberately stays out of that (see this
                                // file's own header on why 38-06's inline
                                // `copySecret` stays as it is).
                                //
                                // Plan 38-11: the reveal set (`DetailRevealState`)
                                // moved from this screen's own local `@State`
                                // to `root.revealState`, a `Binding` passed
                                // down here -- so `VaultRootController
                                // .lockTeardown()` can clear it directly,
                                // independent of whether SwiftUI has yet torn
                                // down the pushed `ItemDetailView` instance
                                // itself.
                                ItemDetailView(
                                    item: item, store: store, revealState: $root.revealState,
                                    onLockRequested: onLockRequested, onSignOutRequested: onSignOutRequested,
                                    onSettingsRequested: { root.activeSheet = .settings },
                                    // Quick fix 40-UX-03: the SAME
                                    // `.editing(item)` route the context
                                    // menu's own "Edit" button already uses
                                    // two screens over (`contextMenuContent`
                                    // below) -- one sheet case, two entry
                                    // points, never a second edit path.
                                    onEditRequested: { root.activeSheet = .editing(item) },
                                    // CR-04 item 4: the SAME `.sharingItem`
                                    // route the list's own context menu
                                    // uses (`contextMenuContent` below) --
                                    // one sheet case, two entry points.
                                    onShareRequested: { root.activeSheet = .sharingItem(item) },
                                    onFamilyRequested: familySharingContext != nil ? { root.activeSheet = .family } : nil
                                )
                            }
                            // BINDING SCOPE ADDITION (`40-UI-SPEC.md` §5.3):
                            // the Folders tab's own push destination -- a
                            // SEPARATE `.navigationDestination(item:)` from
                            // the item one above (SwiftUI supports multiple,
                            // keyed by the bound type). Attached uniformly to
                            // every tab's own `NavigationStack`, same as
                            // `$root.selection` above -- only the `.folder`
                            // tab ever sets `selectedFolder`, so this is a
                            // no-op push target on the other three.
                            .navigationDestination(item: $selectedFolder) { folder in
                                FolderOpenView(folder: folder, items: store.items) { item in
                                    AnyView(rowButton(item))
                                }
                            }
                            .sheet(item: $root.activeSheet) { sheet in
                                sheetContent(sheet)
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

            // The detached trailing ＋.
            //
            // `role: .search` is the ONLY stock API that produces a detached
            // circular slot beside the tab bar (DOCK-RESEARCH.md §5, and it
            // grepped every `tab*` modifier in both interface files to
            // establish the absence of any other). It survives minimization as
            // the right-hand circle of `circle · pill · circle`.
            //
            // NO `.searchable` is attached to this `TabView`, so selecting it
            // does NOT summon a search field -- we own the interaction. (Each
            // Tab's own content has its own `.searchable`; that is a different
            // modifier on a different view and does not activate this role.
            // Verified by the shelf pill still being the only way in.)
            //
            // GUARDED ON 26 AS A DESIGN CHOICE, NOT AN AVAILABILITY ONE.
            // `TabRole.search` is iOS 18.0, so this compiles on the floor --
            // but on 18 it renders as an ordinary fifth tab item labelled
            // "Add item", which is a worse affordance than a plain floating
            // button. Below 26 the Tab is therefore omitted and
            // `AvailableFallbackCreateButton` supplies the button instead.
            // `TabContentBuilder.buildLimitedAvailability` (SwiftUI
            // .swiftinterface:9729) is what makes an `if #available` legal
            // inside this builder at all.
            if #available(iOS 26.0, *) {
                Tab(value: DockSlot.plus, role: .search) {
                    // Never shown: `dockSelection`'s getter can never return
                    // `.plus`, so this content view has no reachable state.
                    Color.clear
                } label: {
                    // ONE `Image` whose `systemName` CHANGES -- not two images
                    // in an if/else. `.symbolEffect(.replace)` is a *content*
                    // transition, so it needs the same view identity across
                    // the change or it degrades to an instant swap. And the
                    // `Label { } icon: { }` form, so the modifier lands on the
                    // `Image` rather than on the whole `Label`
                    // (DOCK-PANEL-RESEARCH.md §3, proven on video because
                    // every still showed the glyph already swapped).
                    Label {
                        // The title carries the STATE, and it is deliberately
                        // the same string as the `accessibilityLabel` below --
                        // see the note after this closure on why belt and braces
                        // is warranted here. A constant "Add item" would keep
                        // announcing "add" while the glyph shows ✕.
                        //
                        // The detached slot draws no text (measured: a 62×62
                        // circle holding only the glyph when the bar is
                        // expanded, 48×48 when minimised), so this is announced
                        // and not drawn.
                        Text(verbatim: isCreateExpanded ? "Close create menu" : "Create item")
                    } icon: {
                        Image(systemName: isCreateExpanded ? "xmark" : "plus")
                            .contentTransition(.symbolEffect(.replace))
                    }
                    .accessibilityLabel(
                        Text(verbatim: isCreateExpanded ? "Close create menu" : "Create item")
                    )
                    .accessibilityIdentifier("vault.create.plusMenu")
                }
                // ACCESSIBILITY, and the second point is a MEASURED CORRECTION
                // of a conclusion this file briefly carried in the wrong form.
                //
                // 1. The caveat, flagged rather than absorbed: this control
                //    occupies the semantic SEARCH slot, because
                //    `Tab(role: .search)` is the only stock API that produces a
                //    detached circle and there is no `TabRole.add`. With the
                //    explicit label above, VoiceOver announces an add/create
                //    action rather than "Search" -- but the ROLE underneath is
                //    still search, and any future system affordance keyed to it
                //    (a search shortcut, Spotlight hand-off, `.searchable`
                //    activation) will still treat it as search. **Bartek's call
                //    on whether that is acceptable is still pending.**
                //
                // 2. **The accessibility identifier survives onto the tab item
                //    only while the bar is EXPANDED.** Measured, both states, in
                //    the tree dump `VaultDockEvidenceUITests.dumpDockButtons`
                //    prints:
                //
                //      expanded : label=Create item id=vault.create.plusMenu
                //                 frame=(310.0, 769.0, 62.0, 62.0)
                //      minimised: label=Create item id=<empty>
                //                 frame=(317.0, 776.0, 48.0, 48.0)
                //
                //    While minimised the whole bar collapses to one circle plus
                //    the detached ＋, and those collapsed items carry EMPTY
                //    identifiers -- so does the type-tab circle, which reports
                //    only the selected tab's label. An intermediate run of this
                //    work concluded from the minimised state alone that
                //    identifiers "do not propagate to a Tab at all", and wrote
                //    that into three files. It is wrong: the real rule is that a
                //    UI test must expand the bar before matching on identifiers,
                //    and both earlier failures traced back to a restore-scroll
                //    that had silently not worked.
                //
                //    (Which of the title text or the `accessibilityLabel`
                //    actually supplies the announced string is NOT established
                //    -- they are set to the same value, so the tree cannot
                //    distinguish them. Both are kept rather than guessing.)
            }
        }
        .modifier(AvailableTabBarMinimizeBehavior())
        .modifier(AvailableDockShelf { searchShelf })
        // THE SEARCH -> PANEL HALF of the mutual exclusion. The panel -> search half
        // lives in `setCreateExpanded`; this is the other direction.
        //
        // An `onChange` rather than a second statement inside the shelf's action so
        // that it covers EVERY route into search, not just the shelf -- the
        // navigation bar's magnifier presents the same field and must also close the
        // panel.
        //
        // KNOWN LIMITATION, recorded rather than worked around. With the panel
        // already open, one tap on the shelf closes the panel but does NOT present
        // the field; a second tap does. The invariant is intact either way -- the
        // panel and the keyboard never coexist -- but the shelf needs two taps from
        // that one state. Three shapes were tried and all behave identically:
        // closing the panel before setting `isSearchPresented`; deferring the
        // presentation with `DispatchQueue.main.async`; and deferring the panel's
        // close instead so the presentation sits alone in its update. In every case
        // the panel closes, `isSearchPresented` is observably set (this `onChange`
        // fires), and no field appears -- so it is not transaction ordering, and the
        // mechanism inside `.searchable` is unidentified. Asserted as-is in
        // `VaultDockEvidenceUITests.testPanelAndKeyboardAreMutuallyExclusive`, so a
        // future SDK that fixes it shows up as a failing test rather than as
        // nothing.
        .onChange(of: root.isSearchPresented) { _, presented in
            if presented { isCreateExpanded = false }
        }
        .animation(.snappy(duration: 0.25), value: isCreateExpanded)
    }

    // MARK: - The dock

    /// A computed binding, not `@State`: it exists so that changing the type
    /// filter also closes the ＋ panel. Leaving the panel open over a list the
    /// user just re-filtered hides the result of the action they took.
    ///
    /// The getter ALWAYS reports a type tab, never `.plus` -- that is what
    /// makes the detached ＋ a button rather than a sixth filter: selecting it
    /// toggles the grid, and selection snaps straight back to the tab the user
    /// was already on.
    private var dockSelection: Binding<DockSlot> {
        Binding(
            get: { .type(selectedTab) },
            set: { slot in
                switch slot {
                case let .type(tab):
                    selectedTab = tab
                    isCreateExpanded = false
                case .plus:
                    setCreateExpanded(!isCreateExpanded)
                }
            }
        )
    }

    /// The ONE place `isCreateExpanded` is written, so the panel/keyboard
    /// mutual exclusion cannot be forgotten at a second call site.
    ///
    /// THE PANEL AND THE KEYBOARD ARE MUTUALLY EXCLUSIVE BY STATE, NOT BY
    /// LAYOUT -- and that is a workaround for a problem the research could NOT
    /// solve, stated plainly rather than presented as a design.
    /// `DOCK-PANEL-RESEARCH.md` §5 has a measurement fix and a FAILED
    /// positioning fix: SwiftUI folds the keyboard into the same safe-area
    /// region, so a focused `TextField` inflated the derived inset from 139 to
    /// 335 pt and shoved the panel most of the way off the top of the screen.
    /// A nested reader wrapped in `.ignoresSafeArea(.keyboard)` DOES report a
    /// keyboard-immune 139 (that half works), but feeding that number back as the
    /// padding still left the panel displaced, because keyboard avoidance shrinks
    /// the container the panel is aligned WITHIN -- correcting the padding cannot
    /// compensate for a shorter box (`08-keyboard-fixed.png`).
    ///
    /// Moving the panel inside the tab content (see `dimmable`) does not rescue
    /// this: the keyboard is folded into the SAME safe-area region the panel is
    /// now aligned against, so `.bottom` would mean "above the keyboard". It
    /// removes the need for the keyboard-immune measurement, not the underlying
    /// conflict.
    ///
    /// So the panel simply never coexists with a keyboard. Opening it dismisses
    /// search. This is also the right product behaviour -- the panel is a
    /// launcher for creating items and has no business overlapping a keyboard
    /// -- but it is chosen because the layout fix is unsolved, and if anyone
    /// later needs the two on screen together, that is an open problem and not
    /// a small one.
    private func setCreateExpanded(_ open: Bool) {
        if open { root.isSearchPresented = false }
        isCreateExpanded = open
    }

    /// `.acc{height:46; gap:9; padding:0 17; font-size:15.5}` -- the shelf's
    /// search pill. A button, not a live `TextField`: tapping it presents the
    /// real `.searchable` field, which is what owns the tag tokens, the
    /// suggestion list and the cancel affordance. Duplicating any of that
    /// into a bespoke field would be two search implementations that can
    /// disagree.
    @ViewBuilder
    private var searchShelf: some View {
        Button {
            // CLOSE THE PANEL UNANIMATED, THEN ASK FOR SEARCH A TURN LATER. Both
            // halves are load-bearing and both were arrived at by elimination.
            //
            // `.searchable(isPresented:)` refuses to present while the ＋ panel is on
            // screen, and the refusal is SILENT AND STICKY: the binding stays `true`
            // (SwiftUI never writes it back), so every later tap is a no-op change
            // and search becomes permanently unreachable from the shelf. That is why
            // a plain `isSearchPresented = true` here left the shelf dead after one
            // use, not merely needing a second tap.
            //
            // The panel therefore has to be GONE, not merely closing, before the
            // request. `.animation(.snappy(duration: 0.25), value: isCreateExpanded)`
            // on the `TabView` means an ordinary write keeps it on screen for another
            // quarter second, so the write is made inside a transaction with
            // animations disabled; the deferral then puts the request in a later
            // update, once that removal has actually been applied.
            var immediate = Transaction()
            immediate.disablesAnimations = true
            withTransaction(immediate) { isCreateExpanded = false }
            DispatchQueue.main.async { root.isSearchPresented = true }
        } label: {
            HStack(spacing: PVMetrics.dockShelfGap) {
                Image(systemName: "magnifyingglass")
                Text(verbatim: root.searchText.isEmpty ? "Search your vault" : root.searchText)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            .font(.system(size: PVMetrics.dockShelfFontSize))
            .foregroundStyle(Color("PVTextMuted"))
            .padding(.horizontal, PVMetrics.dockShelfHPadding)
            .frame(height: PVMetrics.dockShelfHeight)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("vault.search.shelf")
    }

    /// `.grid{...}` + `.ga{...}` -- the action panel, on the artifact's own
    /// geometry. Three columns; six actions, so two rows.
    ///
    /// EXACTLY ONE GLASS LAYER, AND IT IS THE CARD. This is Rule B from
    /// `DOCK-PANEL-RESEARCH.md` §4 and it is photographed twice, both failures:
    ///
    /// 1. `ios/evidence/38/38-06-dock-glass-on-glass.png` -- custom glass on a
    ///    surface the SYSTEM already draws glass for (the accessory shelf). Two
    ///    glass layers on one control; you can see the button's separate
    ///    lighter capsule cutting across the pill's rounded edge.
    /// 2. the research probe's `03-glass2.png` -- a `glassEffect` card wrapped
    ///    AROUND a `GlassEffectContainer` of `.buttonStyle(.glass)` circles.
    ///    Nesting does not stack, it COLLAPSES: the inner circles lose their
    ///    glass entirely and read as flat ghost discs.
    ///
    /// So the card is glass (`pvDockGlass`) and the bubbles inside it are plain
    /// `PVSurface` fills. Apple's own instruction, verbatim from WWDC25 219:
    /// "always avoid glass on glass."
    ///
    /// NO `GlassEffectContainer` HERE, deliberately. A container exists to give
    /// SIBLING glass elements one shared sampling region, because glass cannot
    /// sample other glass. There is exactly one glass element in this panel, so
    /// a container would unify nothing -- and `glassEffectID` inside it would be
    /// morphing plain circles, which is not a thing. The research sketch keeps
    /// one out of caution; dropping it removes an iOS 26-only symbol and an
    /// availability guard for no visual difference. If the design ever moves to
    /// nine glass circles with no card, the container comes back and is
    /// required.
    @ViewBuilder
    private var createActionGrid: some View {
        let columns = Array(
            repeating: GridItem(.flexible(), spacing: PVMetrics.dockGridColumnGap),
            count: 3
        )
        LazyVGrid(columns: columns, spacing: PVMetrics.dockGridRowGap) {
            ForEach(VaultCreateAction.allCases) { action in
                Button {
                    perform(action)
                } label: {
                    VStack(spacing: PVMetrics.dockGridActionGap) {
                        Image(systemName: action.systemImage)
                            .font(.system(size: PVMetrics.dockGridGlyphSize * 0.7))
                            .foregroundStyle(Color("PVTextPrimary"))
                            .frame(
                                width: PVMetrics.dockGridBubbleSize,
                                height: PVMetrics.dockGridBubbleSize
                            )
                            // PLAIN, not `.buttonStyle(.glass)` -- see the note
                            // above on why the second glass layer collapses the
                            // first.
                            .background(Color("PVSurface"), in: Circle())
                        Text(verbatim: action.title)
                            .font(.system(size: PVMetrics.dockGridActionFontSize))
                            .foregroundStyle(Color("PVTextPrimary"))
                            .multilineTextAlignment(.center)
                            .lineSpacing(PVMetrics.dockGridActionFontSize * 0.25)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("vault.create.action.\(action.rawValue)")
            }
        }
        .padding(.vertical, PVMetrics.dockGridVPadding)
        .padding(.horizontal, PVMetrics.dockGridHPadding)
        // `interactive: false`: the card is a SURFACE, not a control. Interactive
        // glass reacts to touch by scaling and brightening, which on a container
        // holding six real buttons reads as the whole panel being pressable.
        .pvDockGlass(
            in: RoundedRectangle(cornerRadius: PVMetrics.dockGridRadius, style: .continuous),
            interactive: false
        )
        // The diagnostic that used to hang here -- an accessibility VALUE
        // carrying the app's own `dockInset` -- is gone with the variable it
        // reported. It did its job: printed beside the rendered frame it showed
        // `dockInset=139.0` against a panel whose bottom sat 51 pt above where
        // 139 implied, which is what localised the double-count to the overlay's
        // own alignment box rather than to the measurement.
        .accessibilityIdentifier("vault.create.grid")
    }

    private func perform(_ action: VaultCreateAction) {
        isCreateExpanded = false
        if let kind = action.creationKind {
            root.activeSheet = .creating(kind)
        } else if action == .generatePassword {
            root.activeSheet = .generator
        } else if action == .scanQr {
            root.activeSheet = .scanningQr
        } else if action == .newFolder {
            root.activeSheet = .creatingFolder
        }
    }

    // MARK: - The scrim and the panel, and why both live inside the tab content

    /// Wraps a tab's content with the ＋ panel and its scrim. Both belong HERE,
    /// inside the tab content, and neither works correctly anywhere else.
    ///
    /// ## Why the panel is not an `.overlay` on the `TabView`
    ///
    /// It was, following `DOCK-PANEL-RESEARCH.md` §1, whose argument is that an
    /// overlay on the `TabView` renders AFTER the tab bar and is therefore above
    /// it in z-order. That is true, and it is also **not a property this panel
    /// needs** -- the panel must not overlap the dock at all, so which of the two
    /// would win if they overlapped is moot.
    ///
    /// What that placement cost was the geometry, and it shipped a visible bug
    /// that Bartek caught by eye. An overlay on the `TabView` sits OUTSIDE the
    /// tab content, so it does not inherit the dock's bottom inset -- the
    /// research's own answer was to measure the inset inside the content and
    /// republish it up through a `PreferenceKey`. **That double-counts**, because
    /// the overlay's own alignment box is ALREADY inset from the screen's bottom
    /// edge, measured at 50.33 pt. Adding the full 139 pt dock height on top of
    /// that put the panel ~51 pt too high with the bar expanded and ~58 pt too
    /// high with it minimised. Numbers, all measured on iPhone 16 (393 × 852):
    ///
    /// | state | dock top | panel bottom, was | wanted | gap, was |
    /// |---|---|---|---|---|
    /// | expanded  | 714 | 654.7 | 706 | **59.3** |
    /// | minimised | 777 | 710.7 | 769 | **66.3** |
    ///
    /// ## What replaces it, and why it is simpler rather than cleverer
    ///
    /// The tab content's bottom safe-area inset IS the dock. That is the one
    /// measured fact the whole design rests on, and the research established it
    /// for the scrim. It works just as well for the panel: a `.bottom`-aligned
    /// layer inside the tab content ends exactly at the dock's top edge, so the
    /// only number left is the gap.
    ///
    /// This deletes the `PreferenceKey`, the `@State` inset, the
    /// `onPreferenceChange` and the hoisting -- and it fixes the two problems the
    /// hoisting was introduced to solve:
    ///
    /// - **It tracks the minimize animation.** `DOCK-RESEARCH.md` §6 warns that
    ///   the overlay "will not track the minimize animation", and a hoisted
    ///   inset arrives one layout pass late by construction. A safe-area inset is
    ///   read at layout time, every pass, by whoever is being laid out.
    /// - **It cannot be inflated by the keyboard.** The reason the research needed
    ///   `.ignoresSafeArea(.keyboard)` on its measuring reader is that a hoisted
    ///   number is a snapshot that outlives its context. Here the keyboard case
    ///   is handled where it belongs -- `setCreateExpanded` makes the panel and
    ///   the keyboard mutually exclusive, so there is no state in which a
    ///   keyboard-inflated inset can be applied to a visible panel.
    ///
    /// The cost, stated: the panel now draws BELOW the dock in z-order, so if a
    /// future change makes them overlap, the dock wins and the panel is clipped
    /// by it rather than drawing over it. That is the better failure of the two
    /// -- the dock is the thing Bartek requires never to disappear.
    ///
    /// ## What the fix measures, and the 7 pt it does not fix
    ///
    /// Measured from PIXELS by `scripts/measure-ios-dock-panel.py`, not from
    /// accessibility frames (which stop 16 pt short of the card's real edge) and
    /// not by eye:
    ///
    /// | state | gap before | gap now | intended |
    /// |---|---|---|---|
    /// | expanded  | 59.3 | **8.0**  | 8 |
    /// | minimised | 66.3 | **15.0** | 8 |
    ///
    /// Expanded is exact. Minimised keeps 7 pt more, and it is not something this
    /// code can remove: with the bar collapsed the tab content's bottom safe-area
    /// inset is 83 pt while the dock's topmost pixel is 76 pt from the bottom
    /// edge, so **iOS reserves 7 pt more inset than the collapsed dock visually
    /// occupies**. The panel is placed against the inset because that is the only
    /// number the app has; the dock's visual bounds are not exposed. Subtracting a
    /// hardcoded 7 in the inline state would be a magic number keyed to an OS
    /// internal -- the exact defect `PVDesign.swift`'s own header exists to
    /// prevent -- so the residual is recorded and asserted (see
    /// `VaultDockEvidenceUITests`) rather than papered over.
    ///
    /// `TabViewBottomAccessoryPlacement` would tell us WHICH state we are in, and
    /// is the semantically right signal for it, but knowing the state does not
    /// supply the missing 7 pt -- so it is not used here, and whether it even
    /// reaches this far down the tree is UNTESTED.
    ///
    /// ## Why the scrim is not on the `TabView` either
    ///
    /// It would draw above the tab bar and dim the dock outright. Rejected.
    ///
    /// WHY IT MUST NOT IGNORE THE BOTTOM SAFE AREA, which is the whole subtlety
    /// and is photographed: **glass is not opaque.** Liquid Glass samples what
    /// is behind it, so a full-bleed scrim underneath the dock makes the dock's
    /// own glass darken WITH the content -- in the research probe's
    /// `02-full.png` the accessory pill and the tab capsule are visibly grey
    /// where in `01-abovedock.png` they are white. The dock is not immune to a
    /// scrim drawn under it.
    ///
    /// The mechanism that fixes it is one measured fact: the tab content's
    /// bottom safe-area inset IS the dock (139.0 pt on iPhone 16, expanded). So
    /// a scrim that ignores only the TOP edge ends exactly at the dock's top
    /// edge, with no magic number anywhere. A single stray `.ignoresSafeArea()`
    /// reintroduces `02-full.png`.
    ///
    /// There is no stock scrim API to reach for instead: `grep -in
    /// "scrim\|dimming\|dimmed"` over the whole of `SwiftUI.swiftinterface` and
    /// `SwiftUICore.swiftinterface` returns ZERO hits, and a sheet's dimming is
    /// internal. Hand-rolling it is not a shortcut, it is the only option.
    @ViewBuilder
    private func dimmable(_ content: some View) -> some View {
        ZStack(alignment: .bottom) {
            content
            if isCreateExpanded {
                scrim
            }
            if isCreateExpanded {
                // NO bottom padding beyond the gap, and that is the whole fix:
                // this layer is laid out inside the tab content's safe area, so
                // `.bottom` alignment already means "the dock's top edge".
                //
                // `.sheet` remains REFUTED for this panel, empirically: the scrim
                // can be removed and background interaction restored, but a
                // detent is a height from the screen's bottom EDGE, so at any
                // detent tall enough to hold the grid the sheet covers the dock
                // completely and there is no "inset upward by the dock height"
                // knob (`DOCK-PANEL-RESEARCH.md` §1, `04-sheet.png`). The
                // accessory shelf is refuted too -- its content box is a fixed
                // 48 pt and hard-clips (`DOCK-RESEARCH.md` §1).
                createActionGrid
                    .padding(.horizontal, PVMetrics.dockPanelHInset)
                    // Rule C from the research: keep GEOMETRIC distance between
                    // our glass and the dock's glass. Overlapping them makes our
                    // card sample the dock and both turn to mush.
                    .padding(.bottom, PVMetrics.dockPanelGap)
                    .transition(
                        .scale(scale: 0.9, anchor: .bottomTrailing).combined(with: .opacity)
                    )
            }
        }
        // Below iOS 26 only: the ＋ as a plain floating button, since there is no
        // detached tab slot to put it in. A no-op on 26+. Attached HERE rather
        // than to the `TabView` for exactly the same reason as the panel -- inside
        // the tab content, `.bottomTrailing` is already relative to the dock.
        .modifier(AvailableFallbackCreateButton(isExpanded: $isCreateExpanded))
    }

    /// A GRADIENT, not a flat fill, and the reason is the edge. Stopping a flat
    /// scrim at the dock's top leaves a hard horizontal line across the screen
    /// where the dimming ends. Fading the last ~20% to zero removes it.
    ///
    /// 0.35 is the HIG's own number for a dark dimming layer over bright content
    /// behind Clear glass (developer.apple.com/design/human-interface-guidelines
    /// /materials). `PVScrim` and not `.black`: literal colours are barred by
    /// `scripts/audit-ios-colour-tokens.sh` check 1, and the token flips warm
    /// near-black in light mode / true black in dark, because a warm-black
    /// scrim over the cream `PVBackground` keeps the product's temperature
    /// while dimming.
    @ViewBuilder
    private var scrim: some View {
        LinearGradient(
            stops: [
                .init(color: Color("PVScrim").opacity(PVMetrics.dockScrimOpacity), location: 0.0),
                .init(color: Color("PVScrim").opacity(PVMetrics.dockScrimOpacity), location: 0.8),
                .init(color: Color("PVScrim").opacity(0.0), location: 1.0),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        // TOP ONLY. The bottom edge stays inside the safe area, i.e. it stops
        // exactly at the dock. Do NOT add `.bottom` here.
        .ignoresSafeArea(edges: .top)
        .contentShape(Rectangle())
        .onTapGesture { isCreateExpanded = false }
        .transition(.opacity)
        .accessibilityIdentifier("vault.create.scrim")
        // "Dismiss create menu" and NOT "Close create menu": the ＋ itself
        // announces the latter while open, and two buttons with one label made
        // `app.buttons["Close create menu"]` ambiguous -- XCUITest failed with
        // "Multiple matching elements found", not with a wrong answer. Distinct
        // labels are also better for a VoiceOver user, who otherwise hears the
        // same phrase from two different places on screen.
        .accessibilityLabel(Text(verbatim: "Dismiss create menu"))
        .accessibilityAddTraits(.isButton)
    }

    // MARK: - Tab content

    @ViewBuilder
    private func tabContent(for tab: VaultTypeTab) -> some View {
        // Folders is NOT a `VaultTypeTab.wireType` item-type filter -- it
        // routes to a DISTINCT root (`FoldersListView`, `40-UI-SPEC.md`
        // §5.2), before `itemListTabContent(for:)` (the ITEM list) is ever
        // consulted. See `VaultTypeTab.wireType`'s own doc comment for why
        // this branch must come first, and be a genuine `if`/`else` (not an
        // early `return`) -- `@ViewBuilder` requires every path through this
        // function's body to be a builder-composed expression.
        if tab == .folder {
            if let folderStore {
                FoldersListView(folderStore: folderStore, items: store.items) { folder in
                    selectedFolder = folder
                }
            } else {
                // Defensive fallback for a caller that constructs
                // `ItemListView` without a `FolderStore` (tests/previews) --
                // never a crash, matching `ItemFormView`'s own
                // `if let folderStore` guard elsewhere in this file.
                ContentUnavailableView("Folders unavailable", systemImage: "folder")
                    .background(Color("PVBackground"))
            }
        } else {
            itemListTabContent(for: tab)
        }
    }

    @ViewBuilder
    private func itemListTabContent(for tab: VaultTypeTab) -> some View {
        let rows = filteredSortedItems(from: store.items, tab: tab)
        let searchOrFilterActive = !root.searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !root.searchTokens.isEmpty

        // Every branch below gets the brand ground, not just the List one:
        // an empty vault and a no-matches state were rendering on iOS grey
        // while a populated one rendered on cream.
        if store.items.isEmpty {
            emptyVaultState
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color("PVBackground"))
        } else if rows.isEmpty && searchOrFilterActive {
            ContentUnavailableView.search(text: root.searchText)
                .background(Color("PVBackground"))
        } else if rows.isEmpty {
            ContentUnavailableView(
                "No \(tab.title.lowercased()) yet",
                systemImage: tab.systemImage
            )
            .background(Color("PVBackground"))
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
            // The brand ground. Without these two lines a `List` paints iOS's
            // own grouped-list grey and the entire vault surface loses the warm
            // cream this product's identity is built on -- observed in
            // `ios/evidence/38/38-06-list-at-rest.png`, where auth and
            // onboarding were on `PVBackground` and the vault was not.
            //
            // `scrollContentBackground(.hidden)` is the load-bearing half: a
            // `.background` alone sits BEHIND the List's own opaque system
            // fill and is never seen.
            .scrollContentBackground(.hidden)
            .background(Color("PVBackground"))
        }
    }

    @ViewBuilder
    private func allTabSections(_ rows: [VaultItemViewModel]) -> some View {
        vaultTypeSections(rows) { item in rowButton(item) }
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

    // MARK: - Sheet content (router for `root.activeSheet`)

    @ViewBuilder
    private func sheetContent(_ sheet: VaultActiveSheet) -> some View {
        switch sheet {
        case .generator:
            // The dock grid's "Generate password" slot. Standalone (no
            // `onInsert`) -- the same presentation `LockView` already uses.
            GeneratorSheet()
        case .settings:
            SettingsView()
        case let .creating(kind):
            ItemFormView(mode: .create(kind), store: store, folderStore: folderStore) { created in
                root.selection = created
            }
        case let .editing(item):
            ItemFormView(mode: .edit(item), store: store, folderStore: folderStore) { _ in
                root.activeSheet = nil
            }
        case let .movingToFolder(item):
            if let folderStore {
                FolderPicker(
                    store: folderStore,
                    selection: Binding(
                        get: { item.fields?.folderId },
                        set: { newFolderId in
                            Task { await applyFolderMove(item, folderId: newFolderId) }
                        }
                    )
                )
            }
        case .scanningQr:
            // `TotpScanView` owns the whole scan flow, including its own
            // no-camera/permission-denied fallback -- this call site only
            // has to hand it a way to route onward, exactly like every
            // other sheet here routes onward through `root.activeSheet`.
            TotpScanView(
                onScanned: { parsed in root.activeSheet = .creatingFromScan(parsed) },
                onManualEntry: { root.activeSheet = .creating(.totp) }
            )
        case let .creatingFromScan(parsed):
            ItemFormView(
                mode: .create(.totp), store: store, folderStore: folderStore,
                prefillTotp: totpFields(from: parsed)
            ) { created in
                root.selection = created
            }
        case .creatingFolder:
            // The EXACT same view "Move to folder" presents above, reused
            // rather than duplicated -- see `VaultActiveSheet.creatingFolder`.
            // The discarded binding means tapping an existing folder or "No
            // folder" just dismisses harmlessly; only "Create" has a real
            // effect (`FolderStore.create`), which is exactly what this
            // slot is for.
            if let folderStore {
                FolderPicker(store: folderStore, selection: Binding(get: { nil }, set: { _ in }))
            }
        // CR-04: the avatar-menu "Family" entry's real destination.
        case .family:
            if let ctx = familySharingContext {
                NavigationStack {
                    FamilyRootView(
                        baseURL: ctx.baseURL, tokenProvider: ctx.tokenProvider,
                        userKey: ctx.userKey, ownUserId: ctx.ownUserId
                    )
                }
            }
        // CR-04 item 4: the item detail/context-menu "Share" entry point.
        case let .sharingItem(item):
            if let ctx = familySharingContext {
                NavigationStack {
                    ShareItemPresenter(
                        itemId: item.id, displayName: item.displayName, store: store,
                        baseURL: ctx.baseURL, tokenProvider: ctx.tokenProvider,
                        userKey: ctx.userKey, ownUserId: ctx.ownUserId
                    )
                }
            }
        }
    }

    /// Maps a scanned `otpauth://` URI onto the same `TotpFields` the manual
    /// "New code" form already edits. `OtpauthParser.swift` deliberately
    /// knows nothing about `TotpFields` (it stays Foundation-only, testable
    /// with zero app-model dependency) -- this is where the two meet.
    ///
    /// `name` strips a leading `"<issuer>: "` off `parsed.label` when the
    /// label carries one, rather than passing the raw label straight
    /// through: `totpRow` already renders `"\(issuer): \(name)"`, so a
    /// pass-through would double the issuer in the row ("Issuer: Issuer:
    /// alice@example.com"). Falls back to the raw label when there is no
    /// such prefix to strip (e.g. no `issuer` param was present at all).
    private func totpFields(from parsed: ParsedOtpauth) -> TotpFields {
        var name = parsed.label
        let prefix = "\(parsed.issuer):"
        if !parsed.issuer.isEmpty, name.hasPrefix(prefix) {
            name = String(name.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
        }
        return TotpFields(
            name: name.isEmpty ? parsed.label : name,
            folderId: nil,
            tags: [],
            secret: parsed.secret,
            issuer: parsed.issuer,
            algorithm: parsed.algorithm.rawValue,
            digits: parsed.digits,
            period: parsed.period,
            notes: ""
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
                root.selection = item
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
        // Quick task 260818-irw: "the code is the row" -- a `.totp` item
        // with DECRYPTED fields gets the trow layout (live code + ring,
        // matching `ios/brand/screens-vault.html`'s `.trow`/`.pie`)
        // instead of the generic icon+title+chevron body every other type
        // uses. An undecryptable/pending-family-key totp item has
        // `item.fields == nil`, so it falls through this `if case let`
        // unchanged and still renders via the generic branch below -- no
        // special-casing needed, that fallthrough is the existing
        // optional's own behavior.
        if case let .totp(f) = item.fields {
            totpRow(item, f)
        } else {
            genericRow(item)
        }
    }

    @ViewBuilder
    private func totpRow(_ item: VaultItemViewModel, _ fields: TotpFields) -> some View {
        HStack(spacing: PVMetrics.totpRowGap) {
            TotpCountdownView(
                secretB32: fields.secret,
                algorithm: fields.algorithm,
                digits: fields.digits,
                period: fields.period,
                style: .listRow,
                // `"{issuer}: {name}"`, or just `{name}` when issuer is
                // empty -- transcribes the artifact's own rendered text
                // (e.g. "GitHub: bartek@paczesny.pl").
                label: fields.issuer.isEmpty ? fields.name : "\(fields.issuer): \(fields.name)",
                // Quick fix 40-UX-02: was `nil` (list rows showed no copy
                // affordance at all). Routes through the SAME `copySecret`
                // choke point the context menu's "Copy password"/etc. already
                // use just below in this file -- one `ClipboardService`
                // writer, never a second direct-pasteboard write (kept green
                // by `scripts/audit-clipboard-single-writer.sh`). `"Code"`
                // matches `ItemDetailView.fieldLabel("totpCode")`'s own noun,
                // so the two screens' "Copied Code …" banners agree.
                onCopy: { code in copySecret(code, fieldLabel: "Code") },
                codeAccessibilityId: "vault.row.\(item.id).totp.code",
                ringAccessibilityId: "vault.row.\(item.id).totp.remainingSeconds"
            )
            let rowPills = pills(for: item)
            if !rowPills.isEmpty {
                ForEach(rowPills) { pill in
                    Text(verbatim: pill.label)
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Color(pill.colorName).opacity(0.15))
                        .foregroundStyle(Color(pill.colorName))
                        .clipShape(Capsule())
                }
            }
        }
        // The correct per-row List inset API -- `.padding()` would STACK
        // on top of List's own default insets rather than replacing them.
        .listRowInsets(EdgeInsets(
            top: PVMetrics.totpRowVPadding, leading: PVMetrics.totpRowHPadding,
            bottom: PVMetrics.totpRowVPadding, trailing: PVMetrics.totpRowHPadding
        ))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("vault.row.\(item.id)")
        .accessibilityAddTraits(.isButton)
    }

    @ViewBuilder
    private func genericRow(_ item: VaultItemViewModel) -> some View {
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
        // CR-04 item 3 (40-REVIEW.md): the three-way `ShareMarker`
        // discrimination, not the raw `isShared` flag alone --
        // `ShareMarker.of` had no production call site before this, so a
        // received-from-other item and a family-wide item were both
        // indistinguishable from "shared by me" (or, once the merge this
        // fix adds ships, simply never appeared in the list at all).
        switch ShareMarker.of(item: item) {
        case .receivedFromOther:
            result.append(RowPill(id: "shared", label: "Shared with you", colorName: "PVTextMuted"))
        case .familyWide:
            result.append(RowPill(id: "shared", label: "Family", colorName: "PVTextMuted"))
        case .sharedByMe:
            result.append(RowPill(id: "shared", label: "Shared", colorName: "PVTextMuted"))
        case .none:
            break
        }
        if item.isUndecryptable {
            result.append(RowPill(id: "damaged", label: "Damaged", colorName: "PVError"))
        }
        return result
    }

    // MARK: - Context menu actions

    @ViewBuilder
    private func contextMenuContent(_ item: VaultItemViewModel) -> some View {
        ForEach(copyActions(for: item), id: \.command) { action in
            Button(action.command) {
                copySecret(action.value, fieldLabel: action.field)
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
                root.activeSheet = .editing(item)
            }
            // "Move to folder" -- Task 3, real now that `VaultStore.update`
            // exists (38-06 explicitly omitted this because no update-item
            // call existed yet). Gated identically to Edit: a row this
            // caller cannot save an edit to must not offer to move it
            // either -- same "never offer an operation known to fail"
            // discipline `ItemCapabilities.swift` names.
            if folderStore != nil {
                Button("Move to folder") {
                    root.activeSheet = .movingToFolder(item)
                }
            }
        }
        // CR-04 item 4 (40-REVIEW.md): "Share" is real now --
        // `ShareItemView` exists and is wired (`.sharingItem`, above).
        // Gated identically to `ItemDetailView.canShowShareButton`
        // (`ItemCapabilities.canShowShareAffordance`) -- absent entirely
        // for an item the caller does not own outright, never offered
        // disabled.
        if ItemCapabilities.canShowShareAffordance(item), familySharingContext != nil {
            Button("Share") {
                root.activeSheet = .sharingItem(item)
            }
        }
        Button("Delete", role: .destructive) {
            deleteCandidate = item
        }
    }

    /// Mirrors `ItemContextMenu.tsx`'s `copyActionsFor` (login: username +
    /// password; card: number; identity: email). `Move to folder` and
    /// `Share` are now both offered above (`contextMenuContent`) -- this
    /// comment previously said neither existed yet; CR-04 (40-REVIEW.md)
    /// wired `Share` in, `Move to folder` shipped earlier (see the
    /// surrounding code, not this stale note).
    /// WR-03 (38-REVIEW.md, iteration 2): returns the menu command AND the
    /// bare field noun separately -- `command` ("Copy password") is the
    /// `Button` label; `field` ("Password") is what
    /// `ClipboardWording.confirmation` composes into "Copied Password …".
    /// Before this fix both were the same string, so CR-03's now-visible
    /// banner rendered "Copied Copy password". `field` uses the SAME nouns
    /// as `ItemDetailView.fieldLabel(_:)` for the identical field, so the
    /// two screens' banners agree.
    private func copyActions(for item: VaultItemViewModel) -> [(command: String, field: String, value: String)] {
        guard let fields = item.fields else { return [] }
        switch fields {
        case let .login(f):
            var actions: [(command: String, field: String, value: String)] = []
            if !f.username.isEmpty { actions.append(("Copy username", "Username", f.username)) }
            if !f.password.isEmpty { actions.append(("Copy password", "Password", f.password)) }
            return actions
        case let .card(f):
            return f.number.isEmpty ? [] : [("Copy card number", "Card number", f.number)]
        case let .identity(f):
            return f.email.isEmpty ? [] : [("Copy email", "Email", f.email)]
        default:
            return []
        }
    }

    /// CR-03 fix: routes through the SAME choke point `ItemDetailView
    /// .copySecret` uses -- `ClipboardService` sets BOTH clearing
    /// mechanisms (the pasteboard's own `expirationDate` AND the in-app,
    /// change-counter-guarded timer; `ClipboardService`'s own header:
    /// "Neither alone is sufficient", T-38-07-01) and reads the user's
    /// configured interval from `ClipboardSettings` instead of a hardcoded
    /// 40s. Previously wrote the system pasteboard directly with only its
    /// own expiry set, and wrote `copyConfirmation` to a `String` nothing
    /// ever rendered.
    private func copySecret(_ value: String, fieldLabel: String) {
        guard !value.isEmpty else { return }
        let deadline = ClipboardService.shared.copy(value, fieldLabel: fieldLabel)
        copyConfirmation = ClipboardConfirmation(fieldLabel: fieldLabel, deadline: deadline)
    }

    /// WR-05 (38-REVIEW.md, iteration 2): the dismiss affordance
    /// `statusBanner`'s sibling `copyConfirmationBanner` already has and
    /// this channel previously lacked entirely.
    @ViewBuilder
    private func statusBannerView(_ banner: StatusBanner) -> some View {
        HStack(alignment: .top, spacing: 4) {
            StatusCallout(text: banner.text, tone: banner.tone)
            Button {
                statusBanner = nil
            } label: {
                Image(systemName: "xmark")
                    .font(.footnote)
                    .foregroundStyle(Color(banner.tone.token))
            }
            .padding(.top, 11)
            .padding(.trailing, 4)
            .accessibilityIdentifier("vault.list.statusBanner.dismiss")
        }
        .accessibilityIdentifier("vault.list.statusBanner")
    }

    private static let log = Logger(
        subsystem: "cloud.blonie.PasskeyVault", category: "vault-list"
    )

    /// WR-05 (38-REVIEW.md, iteration 2), corrected by WR-13 (iteration 4):
    /// maps a thrown error to copy safe to put in front of a user -- never
    /// the raw text a throw carries. This is an ALLOW-list, not a deny-list:
    /// only error types known to carry hand-written, user-safe copy
    /// (`VaultStoreError`, `VaultAPIError`, `PvApiError.invalidCredentials`,
    /// `PvApiError.network`) are shown verbatim. Everything else --
    /// including `PvApiError.httpError`'s VERBATIM server response body and
    /// `PvApiError.unexpectedResponse`'s raw `DecodingError` dump built
    /// partly from server-controlled JSON (`VaultAPI.swift`'s own header on
    /// that type) -- is logged for diagnosis and never rendered. The
    /// iteration-2 version denied only `.httpError`, leaving
    /// `.unexpectedResponse` (thrown from four sites in `VaultAPI.swift`)
    /// and any bridged `NSError` to fall through the trailing
    /// `CustomStringConvertible` branch unchanged.
    private func userFacing(_ error: Error) -> String {
        switch error {
        case let storeError as VaultStoreError:
            return storeError.description
        case let apiError as VaultAPIError:
            return apiError.description
        case PvApiError.invalidCredentials:
            return PvApiError.invalidCredentials.description
        case let PvApiError.network(underlying):
            return "Couldn't reach the server. \(underlying.localizedDescription)"
        default:
            // httpError / unexpectedResponse / anything unknown: log the
            // detail, show the user nothing that came off the wire.
            Self.log.error("vault operation failed: \(String(describing: error), privacy: .public)")
            return "Something went wrong. Please try again."
        }
    }

    // MARK: - Search suggestions (tags)

    @ViewBuilder
    private var tokenSuggestions: some View {
        let selected = Set(root.searchTokens.map(\.tag))
        let needle = root.searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
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
        vaultLockToolbarContent(
            onLockRequested: onLockRequested, onSignOutRequested: onSignOutRequested,
            onSettingsRequested: { root.activeSheet = .settings },
            onFamilyRequested: familySharingContext != nil ? { root.activeSheet = .family } : nil
        )
    }

    // MARK: - TEMPORARY tracer create bar (kept for 38-05 test compatibility)

    /// UNCHANGED from 38-02's tracer, verbatim -- see this file's header.
    /// 38-09 replaces this with the real create/edit form.
    @ViewBuilder
    private var createBar: some View {
        VStack(spacing: 8) {
            if let tracerStatusMessage {
                Text(verbatim: tracerStatusMessage)
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
            tracerStatusMessage = "created \(created.id)"
            newItemMarker = ""
        } catch {
            tracerStatusMessage = "create failed: \(error)"
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
        for token in root.searchTokens {
            working = VaultFilterFunctions.filterItems(working, filter: token.filter)
        }
        working = VaultSearch.searchItems(working, query: root.searchText)
        working = VaultSort.sortItems(working, by: sortOption)
        return working
    }

    // MARK: - Network

    private func refresh() async {
        do {
            try await store.refresh()
            statusBanner = nil
        } catch {
            statusBanner = StatusBanner(text: "Couldn't refresh the vault. \(userFacing(error))", tone: .error)
        }
    }

    /// The context menu's "Move to folder" action and `ItemFormView`'s own
    /// Folder row both end here: a real `VaultStore.update` call, gated the
    /// same way Edit is (see `contextMenuContent`) so this can never be
    /// reached for an item this caller cannot edit.
    private func applyFolderMove(_ item: VaultItemViewModel, folderId: String?) async {
        guard let fields = item.fields, fields.folderId != folderId else { return }
        var updated = fields
        switch updated {
        case var .login(f): f.folderId = folderId; updated = .login(f)
        case var .card(f): f.folderId = folderId; updated = .card(f)
        case var .identity(f): f.folderId = folderId; updated = .identity(f)
        case var .note(f): f.folderId = folderId; updated = .note(f)
        case var .totp(f): f.folderId = folderId; updated = .totp(f)
        case .passkey: return // no edit path for passkeys (design-conformance §5)
        }
        do {
            try await store.update(item, fields: updated)
            statusBanner = nil
        } catch VaultStoreError.lockedAfterServerWrite {
            // WR-14 (38-REVIEW.md, iteration 4): the server accepted this
            // move -- only the local mirror was refused because a lock
            // landed mid-flight. Showing "Couldn't move this item" here
            // would be a false claim about the user's data; there is
            // nothing to retry and nothing to undo.
            statusBanner = nil
        } catch {
            statusBanner = StatusBanner(text: "Couldn't move this item. \(userFacing(error))", tone: .error)
        }
    }

    private func performDelete(_ item: VaultItemViewModel) async {
        deleteCandidate = nil
        do {
            try await store.delete(item)
            if root.selection?.id == item.id {
                root.selection = nil
            }
            statusBanner = nil
        } catch {
            statusBanner = StatusBanner(text: "Couldn't delete this item. \(userFacing(error))", tone: .error)
        }
    }
}

// MARK: - iOS 26-only modifiers, guarded on the modifier (never the view body)

/// `sectionIndexLabel(_:)` is iOS 26.0+ (`SwiftUI.swiftinterface`). Guarding
/// on the MODIFIER rather than wrapping the whole `Section` in an
/// `if #available` at the call site keeps every call site identical
/// regardless of SDK/floor, per design-conformance's standing obligation 5.
///
/// NOT `private` (file-scope `private` == `fileprivate` in Swift): quick fix
/// 40-UX-01 has `vaultTypeSections(_:rowContent:)` above apply this from
/// `FoldersListView.swift` too, a different file in the same target.
struct AvailableSectionIndexLabel: ViewModifier {
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
///
/// NOT `private`, for the same reason as `AvailableSectionIndexLabel` just
/// above -- `FoldersListView.swift`'s `FolderOpenView` applies this to its
/// own `List` too, quick fix 40-UX-01.
struct AvailableListSectionIndexVisibility: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.listSectionIndexVisibility(.visible)
        } else {
            content
        }
    }
}

/// `tabBarMinimizeBehavior(_:)` is iOS 26.0+ (`SwiftUI.swiftinterface`, whose
/// `TabBarMinimizeBehavior` offers exactly four values: `.automatic`,
/// `.onScrollDown`, `.onScrollUp`, `.never`).
///
/// **`.onScrollDown` is the one that keeps the bar on screen**, and the name
/// is the trap: it does not mean "hide it when the user scrolls down", it
/// means "MINIMISE it when content scrolls down" -- the bar collapses to a
/// small pill beside the detached ＋ capsule (the artifact's
/// "circle · pill · circle") and stays there, pressable, for the whole scroll.
/// `.never` would also keep it, but at full size forever, which throws away
/// the collapse the approved design explicitly asks for; `.onScrollUp` is the
/// same mechanic keyed to the opposite direction, which minimises the bar when
/// returning to the top -- backwards for a list. Proven, not reasoned: see
/// `PasskeyVaultUITests/VaultDockUITests
/// .testTabBarStaysOnScreenWhileScrollingAPopulatedList`, which scrolls a
/// 21-item live list and asserts the bar's frame still intersects the screen
/// and is still hittable afterwards, with a negative control proving that
/// assertion can fail.
private struct AvailableTabBarMinimizeBehavior: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.tabBarMinimizeBehavior(.onScrollDown)
        } else {
            content
        }
    }
}

/// `tabViewBottomAccessory(content:)` is iOS 26.0+ and lives on `View` in
/// SwiftUI (the two-argument `isEnabled:` overload is 26.1+ and deliberately
/// not used -- 26.1 is a higher floor than this needs).
///
/// Below iOS 26 there is no accessory shelf at all. That is a graceful
/// degradation, not a fork: the tab bar still renders (as a standard,
/// non-floating bar), and search still renders, because
/// `AvailableVaultSearchable` puts the field inline in the navigation bar on
/// that floor instead of behind the shelf's pill. The ＋ slot degrades to an
/// ordinary sixth tab, which is still a working create affordance.
private struct AvailableDockShelf<Shelf: View>: ViewModifier {
    @ViewBuilder var shelf: Shelf

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.tabViewBottomAccessory { shelf }
        } else {
            content
        }
    }
}

/// The iOS 18 substitute for the detached ＋. **A no-op on iOS 26+**, where the
/// `Tab(role: .search)` in the body owns that slot.
///
/// Below 26 there is no detached slot at all, so the ＋ becomes an ordinary
/// floating circular button in `.overlay(alignment: .bottomTrailing)`. It is
/// attached INSIDE the tab content (see `dimmable`), so `.bottomTrailing` is
/// already relative to the dock's top edge and the only number needed is the same
/// gap the panel uses -- below 26 the inset it rides on measures the classic
/// opaque tab bar plus the home-indicator gap rather than the glass dock, which
/// is the right number for the same reason.
///
/// Filled `PVAccent` with a `PVOnAccent` glyph rather than any glass: there is
/// no `glassEffect` on this floor, and `.regularMaterial` on a 54 pt circle
/// floating over a list reads as a smudge, not a primary action. `PVOnAccent`
/// and never `.white` -- white measures 3.34:1 on the dark-mode accent, which
/// is what that token exists to fix.
///
/// **UNRENDERED. This has never been on a screen.** `xcrun simctl list
/// runtimes` on this machine prints exactly one line, `iOS 26.5 (26.5 -
/// 23F77)`, so there is no iOS 18 runtime to install the app onto. The
/// availability floors are read out of the SDK interface files and the code
/// compiles against them; that is a signature argument, not a picture. Install
/// an iOS 18 runtime and shoot it before claiming this branch works.
private struct AvailableFallbackCreateButton: ViewModifier {
    @Binding var isExpanded: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
        } else {
            content.overlay(alignment: .bottomTrailing) {
                Button {
                    isExpanded.toggle()
                } label: {
                    // Same one-Image-changing-systemName shape as the 26 branch,
                    // so the replace transition works identically. `.symbolEffect
                    // (.replace)` is iOS 17.0, comfortably under this floor.
                    Image(systemName: isExpanded ? "xmark" : "plus")
                        .font(.system(size: PVMetrics.dockPlusGlyphSize, weight: .light))
                        .contentTransition(.symbolEffect(.replace))
                        .foregroundStyle(Color("PVOnAccent"))
                        .frame(width: PVMetrics.dockCapsuleSize, height: PVMetrics.dockCapsuleSize)
                        .background(Color("PVAccent"), in: Circle())
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .padding(.trailing, PVMetrics.dockPanelHInset)
                .padding(.bottom, PVMetrics.dockPanelGap)
                .accessibilityLabel(
                    Text(verbatim: isExpanded ? "Close create menu" : "Create item")
                )
                .accessibilityIdentifier("vault.create.plusMenu")
            }
        }
    }
}

/// `searchToolbarBehavior(_:)` is iOS 26.0+, and the value here is
/// **STATE-DEPENDENT** rather than a constant `.minimize`. That is not a
/// refinement; without it the dock's search pill does nothing when tapped.
///
/// ## Why `.minimize` is wanted at rest
///
/// Found live in plan 38-06: `.searchable(text:tokens:isPresented:)` on iOS 26
/// renders a full-width search field in the list at rest, so the shelf's own
/// search pill and that field are BOTH on screen at once. `.minimize` collapses
/// the toolbar's copy to a magnifier button, leaving the shelf as the single
/// visible search affordance without giving up the `.searchable` field itself --
/// which is what owns the tag tokens, the suggestion list and the cancel
/// affordance. Two doors onto ONE search, not two search implementations.
///
/// ## Why it cannot be `.minimize` while search is being presented
///
/// **`.searchToolbarBehavior(.minimize)` blocks `.searchable(isPresented:)` from
/// presenting anything.** Tapping the shelf set `isSearchPresented = true` and no
/// field appeared -- the dock's primary search affordance was inert. Attributed by
/// experiment, in this order, because the first two hypotheses were wrong:
///
/// 1. Suspected the `Tab(role: .search)` claiming search for the tab view (Apple:
///    "Searchable tab views will prefer to have the first tab with this role
///    implement search", and `TabSearchActivation` offers only `.automatic` and
///    `.searchTabSelection`, i.e. the API assumes search lives in that tab).
///    **Wrong.**
/// 2. Suspected a same-tick conflict; deferring with `DispatchQueue.main.async`
///    changed nothing. **Wrong.**
/// 3. Removed `.minimize` alone, changing nothing else: the shelf tap presented
///    the field immediately. **That is the cause.**
///
/// The diagnostic that made this findable is in
/// `VaultDockUITests.testSearchShelfNarrowsTheListWithoutTheTabBarLeaving`: on
/// failure it dumps the tree and then taps the navigation bar's magnifier. The
/// field appeared via the magnifier while `isPresented` did nothing, which is what
/// separated "search is broken" from "programmatic activation is broken".
///
/// ## The fix, and why it is not a hack
///
/// `.minimize` at rest, `.automatic` while presenting. The two states want
/// different behaviour for a real reason: minimizing exists to keep a collapsed
/// search out of the way, and there is nothing to keep out of the way once the
/// user has asked for search. Verified both halves live -- the shelf tap presents
/// the field, and at rest there is still exactly one search affordance in the
/// content area (`ios/evidence/38/38-06b-dock-at-rest-light.png`, nav bar
/// collapsed to a magnifier).
///
/// Note the middle state this leaves alone: the navigation bar's magnifier still
/// works and is a second, smaller door onto the same field. That is deliberate --
/// it is the door that kept working throughout, and it is what a user who has
/// scrolled the dock into its minimised row will reach for.
private struct AvailableMinimizedSearchToolbar: ViewModifier {
    /// Read, not written. The behaviour has to change WITH the presentation; see
    /// the header for why.
    let isSearchPresented: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            // STATE-DEPENDENT, and this is the whole fix. See the header above.
            content.searchToolbarBehavior(isSearchPresented ? .automatic : .minimize)
        } else {
            content
        }
    }
}

/// Search, with the SAME text/token bindings on both floors -- only how the
/// field is summoned differs.
///
/// On iOS 26 the field is `isPresented`-driven, because the shelf's pill is
/// the entry point and a second always-visible field inside the list would be
/// the "FAB and list-header search field both disappear" the approved design
/// explicitly removes. Below 26 there is no shelf to summon it from, so the
/// field renders at rest exactly as it did before this change.
///
/// Guarded on the MODIFIER, never on the view body: every call site is
/// identical regardless of floor.
private struct AvailableVaultSearchable: ViewModifier {
    @Binding var text: String
    @Binding var tokens: [VaultFilterToken]
    @Binding var isPresented: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.searchable(
                text: $text,
                tokens: $tokens,
                isPresented: $isPresented,
                placement: .automatic,
                prompt: Text(verbatim: "Search")
            ) { token in
                Label(token.label, systemImage: "tag")
            }
        } else {
            content.searchable(
                text: $text,
                tokens: $tokens,
                placement: .automatic,
                prompt: Text(verbatim: "Search")
            ) { token in
                Label(token.label, systemImage: "tag")
            }
        }
    }
}

// EditPlaceholderSheet retired (plan 38-09): `ItemFormView(mode: .edit(item))`
// is the real form now, routed through `sheetContent(_:)`'s `.editing` case.
