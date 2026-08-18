//
//  VaultRootView.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-11. Owns the navigation path
//  (`selection`), the presented-sheet router (`activeSheet`), the detail
//  screen's reveal set (`revealState`) and the search state -- everything a
//  lock must tear down that `VaultStore`/`FolderStore` do not themselves
//  hold -- so ONE handler (`VaultRootController.lockTeardown`) can reach all
//  of it in one call, mirroring `web/src/lib/vault/store.ts`'s own single
//  lock subscription (`ios/IOS-SPIKE-LOG.md`'s own note on why "one
//  handler, not several observers" is the whole point).
//
//  T-38-11-01: covering the vault with the app-switcher snapshot cover
//  (38-05) or merely switching `ContentView`'s route away from `.unlocked`
//  is NOT this control. `ContentView`'s own `@State private var
//  vaultStore`/`folderStore` persist across a route change (that is
//  deliberate -- it is what lets a live, in-progress `refresh()` survive a
//  transient route flicker), so the store instances themselves stay alive
//  and, before this plan, so did every array and key handle inside them.
//  Locking must reach INTO the store, not just stop rendering it.
//

import SwiftUI

/// The "Lock now"/avatar-menu nav-bar chrome, shared by `ItemListView` (its
/// original home) and `ItemDetailView` (plan 38-11, addendum: found live --
/// SwiftUI's `.toolbar` scopes to the screen it is attached to, NOT to every
/// screen pushed after it on the same `NavigationStack`, so a lock/sign-out
/// affordance declared only on the list was UNREACHABLE the moment a user
/// pushed into an item's detail screen. Locking IS reachable from detail --
/// `LockTeardownUITests.swift`'s own must-have proves it -- so this control
/// has to live on both screens, not just the one it was first built for.
/// Extracted to a free `@ToolbarContentBuilder` function rather than
/// duplicated so the two screens cannot drift.
@ToolbarContentBuilder
func vaultLockToolbarContent(
    onLockRequested: (() -> Void)?, onSignOutRequested: (() -> Void)?,
    onSettingsRequested: (() -> Void)? = nil
) -> some ToolbarContent {
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
        // Family has no screen to open yet (Phase 40's job) -- it renders,
        // disabled, rather than either vanishing (which would misrepresent
        // the approved navigation architecture as simpler than it is) or
        // silently doing nothing when tapped (a fake affordance). Settings
        // (quick task 260818-fnt) now follows the SAME disabled-until-wired
        // pattern Lock/Sign-out already use below, rather than being a
        // permanent special case.
        Menu {
            Button("Family") {}
                .disabled(true)
            Button("Settings") { onSettingsRequested?() }
                .disabled(onSettingsRequested == nil)
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

/// The "+" create / edit / move-to-folder / generator sheet router. Moved to
/// file scope (out of `ItemListView`'s own private nesting) in this plan so
/// `VaultRootController` can hold the live value and dismiss it from one
/// place.
enum VaultActiveSheet: Identifiable {
    case creating(ItemCreationKind)
    case editing(VaultItemViewModel)
    case movingToFolder(VaultItemViewModel)
    case generator
    case settings
    /// Quick task 260818-lsk: the ＋ panel's "Scan QR code" slot. Presents
    /// `TotpScanView`, which owns camera capture and the no-camera/
    /// permission-denied fallback itself.
    case scanningQr
    /// Quick task 260818-lsk: what `TotpScanView` hands off to on a
    /// successful scan. NOT `.creating(.totp)` -- that case carries no
    /// field data, and adding an associated value to it would touch its
    /// other (unrelated) call site for no reason. A dedicated case keeps
    /// the prefill data scoped to exactly the one path that produces it.
    /// The user still explicitly reviews and saves in `ItemFormView`; this
    /// only prefills the fields, it never creates the item itself.
    case creatingFromScan(ParsedOtpauth)
    /// Quick task 260818-lsk: the ＋ panel's "New folder" slot. Presents the
    /// SAME `FolderPicker` "Move to folder" already uses (see
    /// `ItemListView.sheetContent`), with a discarded `selection` binding --
    /// there is no item to assign here, only a folder to create, and
    /// `FolderPicker` already offers create-inline with no separate form to
    /// duplicate.
    case creatingFolder

    var id: String {
        switch self {
        case let .creating(kind): return "creating-\(kind.title)"
        case let .editing(item): return "editing-\(item.id)"
        case let .movingToFolder(item): return "movingToFolder-\(item.id)"
        case .generator: return "generator"
        case .settings: return "settings"
        case .scanningQr: return "scanningQr"
        case let .creatingFromScan(parsed): return "creatingFromScan-\(parsed.label)"
        case .creatingFolder: return "creatingFolder"
        }
    }
}

/// The view state a lock must reach that no store owns: the pushed detail
/// item (the navigation path's only variable element -- `ItemListView`'s
/// `NavigationStack`s are otherwise always rooted at the list), the
/// presented sheet, the detail screen's per-field reveal set, and search.
///
/// A plain `@Observable` class, deliberately NOT a `View` or anything
/// SwiftUI-specific -- `lockTeardown(store:folderStore:)` is unit-testable
/// directly, with no view hierarchy needed at all, which is what makes the
/// four RED-before-green demonstrations in `LockTeardownTests.swift`
/// possible without driving the simulator.
@MainActor
@Observable
final class VaultRootController {
    /// The navigation path's only variable element. `nil` is the list root;
    /// non-nil is exactly one level deep (the pushed `ItemDetailView`).
    var selection: VaultItemViewModel?
    var activeSheet: VaultActiveSheet?
    /// Owned here (not `ItemDetailView`'s own local `@State`, pre-38-11) so
    /// this controller's single handler can clear it directly, independent
    /// of whether SwiftUI has yet torn down the pushed detail view itself.
    var revealState = DetailRevealState(itemId: "")
    var isSearchPresented = false
    var searchText = ""
    var searchTokens: [VaultFilterToken] = []

    /// THE single lock handler (plan 38-11, T-38-11-01). Reaches every piece
    /// of state a lock must tear down:
    ///
    /// 1. `store.lock()` / `folderStore?.lock()` -- empties the decrypted
    ///    arrays/maps, clears each store's hydration flag, releases the key
    ///    handle.
    /// 2. `selection = nil` -- truncates the navigation path back to the
    ///    list root.
    /// 3. `activeSheet = nil` -- dismisses any presented create/edit/
    ///    move-to-folder/generator sheet.
    /// 4. `revealState = DetailRevealState(itemId: "")` -- clears the
    ///    detail screen's reveal set.
    /// 5. Search dismissed and cleared.
    /// 6. WR-04 (38-REVIEW.md): the pasteboard, if it still holds THIS
    ///    app's own most recent copy -- `ClipboardService.shared
    ///    .clearIfStillOurs()`'s change-counter guard is what makes an
    ///    early clear safe (it refuses to fire if anything has copied
    ///    since), so this can never destroy a copy unrelated to the vault.
    ///
    /// Each of these six is independently falsifiable: comment out any one
    /// line and the matching assertion in `LockTeardownTests.swift` fails,
    /// which is exactly what this plan's four (now five) RED-before-green
    /// demonstrations exercise (nav truncation, sheet dismissal, reveal-set
    /// clear, key-handle release via the weak-reference test, pasteboard
    /// clear via the injectable `PasteboardWriting` seam).
    ///
    /// `clipboard` defaults to the real singleton in production;
    /// `LockTeardownTests.swift` injects a `ClipboardService` backed by a
    /// fake `PasteboardWriting` so the pasteboard clear is asserted without
    /// touching the real device pasteboard.
    func lockTeardown(store: VaultStore, folderStore: FolderStore?, clipboard: ClipboardService = .shared) {
        store.lock()
        folderStore?.lock()
        selection = nil
        activeSheet = nil
        revealState = DetailRevealState(itemId: "")
        isSearchPresented = false
        searchText = ""
        searchTokens = []
        clipboard.clearIfStillOurs()
    }
}

/// Wraps `ItemListView`, supplying the `VaultRootController` it renders
/// through and wiring the real "Lock now"/"Sign out" affordances -- the
/// half `ItemListView`'s own header used to say was deliberately left
/// disabled, "wiring a half-built lock action here risks the exact 'true in
/// the artifact, false in reality' defect shape this project has repeatedly
/// paid for." This plan is what makes it whole.
struct VaultRootView: View {
    @Bindable var store: VaultStore
    var folderStore: FolderStore?

    /// Called AFTER `root.lockTeardown()` has already run -- the caller
    /// (`ContentView`) is responsible for what happens to the app's ROUTE
    /// (switching away from `.unlocked`, releasing its own `@State`
    /// references to `store`/`folderStore` so the next unlock builds fresh
    /// instances bound to a fresh key handle). This view only owns tearing
    /// down what IT and its children hold.
    var onLockRequested: () -> Void
    var onSignOutRequested: () -> Void

    @State private var root = VaultRootController()

    var body: some View {
        ItemListView(
            store: store,
            folderStore: folderStore,
            root: root,
            onLockRequested: performLock,
            onSignOutRequested: performSignOut
        )
    }

    private func performLock() {
        root.lockTeardown(store: store, folderStore: folderStore)
        onLockRequested()
    }

    /// Sign-out tears down the SAME way a lock does -- there is no vault
    /// content a sign-out may leave behind that a lock does not already have
    /// to clear -- and additionally asks the caller to forget the local
    /// session token (`ContentView`'s own job, via `AccountService.logout()`,
    /// since that call needs the `PvApiClient` this view does not hold).
    private func performSignOut() {
        root.lockTeardown(store: store, folderStore: folderStore)
        onSignOutRequested()
    }
}
