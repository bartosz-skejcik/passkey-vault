//
//  ItemDetailView.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-07, Task 1 -- rebuilt on
//  `DetailFieldTables.swift`, replacing 38-02's tracer (name + body only).
//
//  Ported from `web/src/components/vault/DetailPanel.tsx`: masked-by-default
//  secrets revealed per field (never wholesale), a fixed-length mask so the
//  placeholder never leaks a value's real length, and a reveal set that
//  clears whenever the displayed item changes (`DetailRevealState`, in
//  `DetailFieldTables.swift`).
//
//  `identity` and `passkey` get their own composed layouts, matching
//  `FIELD_ORDER`'s deliberately-empty entries for both -- see
//  `identitySection`/`passkeySection` below. Passkey detail has NO Edit
//  affordance (cryptographic material, not user content -- design-
//  conformance §5) and never displays `rawPasskeyJson` (no reader on a
//  phone).
//
//  TOUCH WIRING (T&C: single choke-point, "reveal and copy, nothing else"):
//  the two call sites below are `reveal(key:)` (fires ONLY when a field
//  transitions to revealed, never on re-hide) and `copySecret(key:value:)`
//  (fires on every copy). Neither `ItemListView.swift`'s row/context-menu
//  copy path touches this endpoint -- see that file's own header.
//

import SwiftUI
import UIKit

struct ItemDetailView: View {
    let item: VaultItemViewModel
    let store: VaultStore

    /// Plan 38-11: OWNED by `VaultRootController` (`VaultRootView.swift`),
    /// not this view's own local `@State` -- so the controller's single lock
    /// handler can clear it directly, and a unit test can assert the clear
    /// without instantiating this view at all. `.onAppear` scopes it to
    /// `item.id` the moment this view is first shown (CR-01 fix: SwiftUI's
    /// `.onChange(of:)` does NOT fire on first appearance, so relying on it
    /// alone left a freshly-pushed detail screen carrying the previous
    /// item's revealed set).
    @Binding var revealState: DetailRevealState
    @State private var confirmation: ClipboardConfirmation?

    /// Plan 38-11: the SAME "Lock now"/avatar-menu chrome `ItemListView`
    /// carries, threaded through here too -- see `vaultLockToolbarContent`'s
    /// own header for why a screen pushed onto the list's `NavigationStack`
    /// needs its own copy of this toolbar rather than inheriting the list's.
    var onLockRequested: (() -> Void)?
    var onSignOutRequested: (() -> Void)?
    var onSettingsRequested: (() -> Void)?
    /// CR-04 (40-REVIEW.md): same "supplied by the call site, never a
    /// `root` this view holds directly" discipline as `onSettingsRequested`
    /// above -- routes to `.family`.
    var onFamilyRequested: (() -> Void)?
    /// Quick fix 40-UX-03: routes to the SAME `.editing(item)` sheet the
    /// list's own context menu already presents (`ItemListView
    /// .contextMenuContent`'s "Edit" button, `root.activeSheet = .editing
    /// (item)`) -- `ItemDetailView` has no `root` of its own to write to
    /// (plan 38-11 deliberately keeps `VaultRootController` out of this
    /// view's parameter list), so the call site (`ItemListView.body`'s
    /// `.navigationDestination(item:)` for `$root.selection`) supplies this
    /// closure instead, exactly like `onSettingsRequested` already does for
    /// `root.activeSheet = .settings`. `nil` only in tests/previews that
    /// construct this view directly.
    var onEditRequested: (() -> Void)?
    /// CR-04 item 4 (40-REVIEW.md): same pattern as `onEditRequested` --
    /// routes to the SAME `.sharingItem(item)` sheet
    /// `ItemListView.contextMenuContent` presents, via the call site
    /// (`ItemListView.body`'s `.navigationDestination(item:)`) rather than
    /// this view reaching into a `root` it deliberately has no parameter
    /// for (plan 38-11's own discipline, unchanged by this fix).
    var onShareRequested: (() -> Void)?

    init(
        item: VaultItemViewModel, store: VaultStore, revealState: Binding<DetailRevealState>,
        onLockRequested: (() -> Void)? = nil, onSignOutRequested: (() -> Void)? = nil,
        onSettingsRequested: (() -> Void)? = nil, onEditRequested: (() -> Void)? = nil,
        onShareRequested: (() -> Void)? = nil, onFamilyRequested: (() -> Void)? = nil
    ) {
        self.item = item
        self.store = store
        self._revealState = revealState
        self.onLockRequested = onLockRequested
        self.onSignOutRequested = onSignOutRequested
        self.onSettingsRequested = onSettingsRequested
        self.onFamilyRequested = onFamilyRequested
        self.onEditRequested = onEditRequested
        self.onShareRequested = onShareRequested
    }

    /// Quick fix 40-UX-03: before this, `ItemDetailView` had NO Edit
    /// affordance at all -- the only route to `ItemFormView(mode: .edit)`
    /// (built in plan 38-09) was the LIST screen's long-press context menu,
    /// which is a real reachability gap, not a design choice this file's
    /// header ever recorded. Mirrors `ItemListView.contextMenuContent`'s own
    /// gate EXACTLY (passkey has no Edit -- this file's own header, "not
    /// user content"; `ItemCapabilities.canEditItem` -- shared/read-only
    /// access), plus one guard that gate does not need: `item.fields != nil`
    /// excludes BOTH `undecryptable` (known-stale revision, T-38-03-05) AND
    /// `pendingFamilyKey` (no decrypted fields to prefill a form with,
    /// `ItemFields.swift`'s own `Content.pendingFamilyKey` header) in one
    /// check -- a case the list's row-level gate does not structurally rule
    /// out today, but presenting an edit form with nothing to edit would be
    /// a broken screen, not merely an inconsistency.
    ///
    /// Routed through `ItemCapabilities.canShowEditAffordance(_:)` (not the
    /// three checks inlined here as of the original 40-UX-03 patch) so
    /// `PasskeyVaultTests` can assert the exact gate this button reads
    /// without hosting this view at all -- see that function's own doc
    /// comment for why (`ios/IOS-SPIKE-LOG.md` L-29).
    private var canShowEditButton: Bool {
        ItemCapabilities.canShowEditAffordance(item)
    }

    /// CR-04 item 4: mirrors `canShowEditButton`'s own discipline -- absent
    /// entirely (not merely disabled) when the caller does not own this
    /// item outright, rather than offering an operation known to fail.
    private var canShowShareButton: Bool {
        ItemCapabilities.canShowShareAffordance(item) && onShareRequested != nil
    }

    var body: some View {
        ScrollView {
            // `.body{padding:0 16px}` -- the design's own screens carry NO
            // vertical page padding (the `.hdr`/`.grp` elements supply
            // their own top/bottom rhythm); design-conformance fix, Phase
            // 40 (was a uniform `.padding()`, which doubled the `.hdr`'s
            // own `padding-top:10` into an extra ~16pt gap under the nav
            // bar that is not in the drawing).
            // `spacing: 0` deliberately -- `.hdr`'s own `padding-bottom:16`
            // and `PVDetailSectionLabel`'s own `padding-top:14` (`.glab`)
            // already supply the vertical rhythm between the header, the
            // first unlabelled `.grp`, and every labelled group after it;
            // a uniform `VStack` spacing on top of those would double it.
            VStack(alignment: .leading, spacing: 0) {
                // `PVMetrics.detailToolbarClearance`'s own header: a
                // platform workaround, not a design value -- every branch
                // below needs it, not just `.fields`, so it sits once here
                // rather than duplicated into each panel.
                Color.clear.frame(height: PVMetrics.detailToolbarClearance)
                switch item.content {
                case let .fields(fields):
                    header(fields)
                    fieldsBody(fields)
                case let .undecryptable(reason):
                    undecryptablePanel(reason)
                case .pendingFamilyKey:
                    pendingFamilyKeyPanel()
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, PVMetrics.screenHPadding)
            .padding(.bottom, 16)
        }
        .background(Color("PVBackground"))
        // `CopyHUD.swift`'s own header: a shared, compact, auto-dismissing
        // capsule -- design-conformance fix, Phase 40, replacing the old
        // full-width `copyConfirmationBanner`. An `.overlay` on the SCREEN,
        // not inside the `ScrollView`'s content, so it floats centered near
        // the bottom safe area regardless of scroll position, matching
        // `ItemListView`'s twin placement.
        .overlay(alignment: .bottom) {
            if let confirmation {
                CopyHUD(confirmation: confirmation, accessibilityId: "vault.detail.copyConfirmation")
                    .padding(.bottom, 12)
                    .task(id: confirmation.deadline) {
                        await CopyHUD.autoDismiss { self.confirmation = nil }
                    }
                    .transition(.opacity.combined(with: .move(edge: .bottom)))
                    .animation(.default, value: confirmation.deadline)
            }
        }
        .sensoryFeedback(.success, trigger: confirmation?.deadline)
        .navigationTitle(Text(verbatim: item.displayName))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            // Standard iOS placement (`.navigationBarTrailing`), ahead of
            // the lock/avatar chrome below so it sits closest to the screen
            // edge -- the primary per-item action, not a secondary one.
            // Absent entirely (not merely disabled) when the caller cannot
            // save an edit, matching `ItemCapabilities.swift`'s own
            // discipline: "do not offer an operation known to fail" rather
            // than offer it disabled.
            if canShowEditButton {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Edit") {
                        onEditRequested?()
                    }
                    .accessibilityIdentifier("vault.detail.edit")
                }
            }
            // CR-04 item 4: the item detail/context menu -> ShareItemView
            // entry point named in the review's own fix list.
            if canShowShareButton {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button {
                        onShareRequested?()
                    } label: {
                        Label("Share", systemImage: "person.crop.circle.badge.plus")
                    }
                    .accessibilityIdentifier("vault.detail.share")
                }
            }
            vaultLockToolbarContent(
                onLockRequested: onLockRequested, onSignOutRequested: onSignOutRequested,
                onSettingsRequested: onSettingsRequested, onFamilyRequested: onFamilyRequested
            )
        }
        // CR-01: `.onAppear` scopes the reveal set to THIS item the moment
        // the view is first shown -- `.onChange(of:)` alone never fires on
        // first appearance (no `initial: true`), so a freshly-pushed detail
        // screen inherited whatever was revealed on the previously-viewed
        // item. `setItem` is idempotent (a no-op if `id == itemId`), so
        // calling it from both `.onAppear` and `.onChange` is safe.
        .onAppear {
            revealState.setItem(item.id)
        }
        // Defense-in-depth alongside `.onAppear` above: if a future
        // navigation path ever reuses the SAME `ItemDetailView` instance
        // across a change of `item` (rather than pushing a new one), the
        // reveal set still clears -- "cleared whenever the displayed item
        // changes, not on disappear" (Pitfall 6's sibling discipline,
        // Pitfall 7).
        .onChange(of: item.id) { _, newId in
            revealState.setItem(newId)
        }
    }

    // MARK: - Header (`.hdr`, screens-vault.html:118-124)
    //
    // Design-conformance fix, Phase 40: was a LEFT-aligned `HStack` with a
    // 24pt icon shown for only 3 of 6 types and `.title3.bold()`/`.caption`
    // sizes that match neither `.hdr b{21px;640}` nor `.hdr span{13.5px}`.
    // The approved screens draw a CENTERED column for every type, always
    // with the 58pt icon tile -- `ItemIconTile(variant: .header)`'s own fix
    // (Phase 40, `ItemIconTile.swift`) is what makes it always the plain
    // type glyph rather than a favicon/card-brand substitute.

    @ViewBuilder
    private func header(_ fields: ItemFields) -> some View {
        VStack(spacing: PVMetrics.detailHeaderGap) {
            ItemIconTile(item: item, variant: .header)
            // `.hdr b{font-weight:640}` -- SwiftUI's `Font.Weight` is a
            // fixed enum (no arbitrary numeric weight without shipping a
            // variable-font file), so 640 is approximated with the closest
            // standard trait, `.semibold` (600), matching this file's own
            // prior handling of the title's 700 (`.bold`) elsewhere in the
            // approved screens.
            Text(verbatim: item.displayName)
                .font(.system(size: PVMetrics.detailTitleSize, weight: .semibold))
                .foregroundStyle(Color("PVTextPrimary"))
                .multilineTextAlignment(.center)
            Text(verbatim: typeLabel(fields.typeName))
                .font(.system(size: PVMetrics.detailSubtitleSize))
                .foregroundStyle(Color("PVTextMuted"))
        }
        .frame(maxWidth: .infinity)
        .padding(.top, PVMetrics.detailHeaderTopSpace)
        .padding(.bottom, PVMetrics.detailHeaderBottomSpace)
    }

    private func typeLabel(_ typeName: String) -> String {
        switch typeName {
        case "login": return "Login"
        case "card": return "Card"
        case "identity": return "Identity"
        case "note": return "Secure note"
        case "totp": return "Authenticator"
        case "passkey": return "Passkey"
        default: return typeName
        }
    }

    // MARK: - Body dispatch (`.grp`/`.glab`, screens-vault.html:77-80,111-117)
    //
    // Design-conformance fix, Phase 40: every screen in the approved
    // artifact groups its rows into one or more rounded `.grp` cards, the
    // second and later ones each preceded by an uppercase `.glab` label
    // ("Notes", "Details", "Secret", "Tags") -- this file previously
    // rendered one flat, uncarded `VStack` of loose rows with no grouping
    // at all. `notes` is spliced OUT of the generic field-order loop into
    // its own labelled group (login/card's own mockups, screens-vault.html
    // :649-652) rather than sitting inside the main card with everything
    // else.

    @ViewBuilder
    private func fieldsBody(_ fields: ItemFields) -> some View {
        switch fields {
        case .identity:
            identitySection(fields)
        case .passkey:
            passkeySection(fields)
        case .totp:
            totpSection(fields)
        default:
            PVDetailGroup(rows: genericFieldRows(fields, excluding: ["notes"]))
        }
        if let notes = notesGroupRow(fields) {
            PVDetailSectionLabel(title: "Notes")
            PVDetailGroup(rows: [notes])
        }
        if !item.tags.isEmpty {
            PVDetailSectionLabel(title: "Tags")
            PVDetailGroup(rows: [AnyView(tagsRow)])
        }
        if let footer = detailsFooterRows() {
            PVDetailSectionLabel(title: "Details")
            PVDetailGroup(rows: footer)
        }
    }

    // MARK: - TOTP (composed layout, plan 38-10 -- design-conformance §"38-10")
    //
    // `.grp{padding-top:6px}` wraps the ring+code+Issuer+Algorithm block
    // (screens-vault.html:718-725); `secret` -- the ONLY entry in
    // `DetailFieldTables.fieldOrder["totp"]` -- gets its OWN "Secret"
    // labelled group below (line 727), not a third row inside this one.

    @ViewBuilder
    private func totpSection(_ fields: ItemFields) -> some View {
        if case let .totp(f) = fields {
            PVDetailGroup(rows: [
                AnyView(
                    TotpCountdownView(
                        secretB32: f.secret,
                        algorithm: f.algorithm,
                        digits: f.digits,
                        period: f.period,
                        style: .detail,
                        label: f.issuer.isEmpty ? "Authenticator" : f.issuer,
                        onCopy: { code in copySecret(key: "totpCode", value: code) }
                    )
                    .padding(.top, 6)
                    .padding(.bottom, PVMetrics.detailRowVPadding)
                ),
                // `.d act`"Issuer"/"Copy code" in the drawing duplicates
                // the SAME copy affordance `TotpCountdownView`'s own code
                // button already offers just above -- that view computes
                // the live code internally (FFI + a running timer) and
                // ItemDetailView has no independent access to it, so this
                // row stays a PLAIN `.d` rather than growing a second,
                // desynchronized "current code" of its own. No capability
                // is lost: copying the code is still one tap away, on the
                // code itself.
                AnyView(
                    PVDetailRow(label: "Issuer", value: f.issuer.isEmpty ? "\u{2014}" : f.issuer)
                ),
                AnyView(
                    PVDetailRow(
                        label: "Algorithm",
                        value: "\(f.algorithm) · \(f.digits) digits · \(f.period)s", isMono: true
                    )
                ),
            ])
            if !f.secret.isEmpty {
                PVDetailSectionLabel(title: "Secret")
                PVDetailGroup(rows: genericFieldRows(fields, excluding: []))
            }
        }
    }

    // MARK: - Generic field-table rows (login, card, note, totp's own secret)

    /// Builds the ROW VIEWS for every key in `DetailFieldTables
    /// .fieldOrder[fields.typeName]`, minus `excluding` -- an array, not a
    /// `@ViewBuilder`, because `PVDetailGroup`'s inset hairline needs to
    /// know exactly which rows rendered AFTER emptiness filtering.
    private func genericFieldRows(_ fields: ItemFields, excluding: Set<String>) -> [AnyView] {
        let order = DetailFieldTables.fieldOrder[fields.typeName] ?? []
        var rows: [AnyView] = []
        for key in order where !excluding.contains(key) {
            let value = fieldValue(key, fields)
            guard !(DetailFieldTables.optionalIfEmptyFields.contains(key) && value.isEmpty) else { continue }
            rows.append(fieldRow(key: key, value: value, fields: fields))
            // The login->urls splice: `urls` is `[String]`, not a scalar
            // `FIELD_ORDER` entry can carry, so it is inserted as a
            // special case immediately after `password` -- matching
            // `DetailPanel.tsx`'s own `Fragment` shape.
            if fields.typeName == "login", key == "password" {
                rows.append(contentsOf: urlRows(fields))
            }
        }
        return rows
    }

    /// login/card's `notes` field, spliced OUT of the main card into its
    /// own "Notes"-labelled group (`fieldsBody`'s own call site) -- `nil`
    /// for a type with no `notes` entry in `FIELD_ORDER` at all (identity/
    /// passkey/note/totp). `label: nil`: the `.glab` above this row
    /// already says "Notes" (screens-vault.html:648-649 draws no `.k`
    /// inside the row itself).
    private func notesGroupRow(_ fields: ItemFields) -> AnyView? {
        let order = DetailFieldTables.fieldOrder[fields.typeName] ?? []
        guard order.contains("notes") else { return nil }
        let value = fieldValue("notes", fields)
        let trailingView: AnyView = value.isEmpty ? AnyView(EmptyView()) : AnyView(copyAction(key: "notes", value: value, title: "Copy"))
        return AnyView(
            PVDetailRow(value: value.isEmpty ? "\u{2014}" : value, accessibilityId: "vault.detail.field.notes") {
                trailingView
            }
        )
    }

    /// The generic loop's value accessor -- mirrors the TypeScript source's
    /// `item.fields as unknown as Record<string, string>` cast, made
    /// explicit and exhaustive rather than reflected. `identity`/`passkey`
    /// return `""` for every key: neither is ever routed through this
    /// function (both have empty `FIELD_ORDER` entries and their own
    /// composed sections above).
    private func fieldValue(_ key: String, _ fields: ItemFields) -> String {
        switch fields {
        case let .login(f):
            switch key {
            case "username": return f.username
            case "password": return f.password
            case "notes": return f.notes
            default: return ""
            }
        case let .card(f):
            switch key {
            case "number": return f.number
            case "expiry": return f.expiry
            case "cvv": return f.cvv
            case "pin": return f.pin ?? ""
            case "zip": return f.zip ?? ""
            case "cardholderName": return f.cardholderName
            case "notes": return f.notes
            default: return ""
            }
        case let .note(f):
            switch key {
            case "body": return f.body
            default: return ""
            }
        case let .totp(f):
            switch key {
            case "secret": return f.secret
            default: return ""
            }
        case .identity, .passkey:
            return ""
        }
    }

    private func fieldLabel(_ key: String) -> String {
        switch key {
        case "username": return "Username"
        case "password": return "Password"
        case "notes": return "Notes"
        case "number": return "Card number"
        case "expiry": return "Expires"
        case "cvv": return "CVV"
        case "pin": return "PIN"
        case "zip": return "Postal code"
        case "cardholderName": return "Cardholder"
        case "body": return "Note"
        case "secret": return "Secret"
        case "totpCode": return "Code"
        case "url": return "Website"
        default: return key.prefix(1).uppercased() + key.dropFirst()
        }
    }

    /// Delegates the mask/reveal/hide DECISION AND the masked output itself
    /// entirely to `DetailFieldTables.displayValue` (unit-tested in
    /// `DetailFieldTablesTests.swift`) -- this function only supplies the
    /// per-render inputs (the current reveal state and the narrowly-scoped
    /// password-hidden gate).
    private func displayValue(for key: String, value: String, fields: ItemFields) -> String {
        DetailFieldTables.displayValue(
            key: key, value: value, revealed: revealState.isRevealed(key, forItem: item.id),
            passwordHidden: passwordFieldHidden(key: key)
        )
    }

    /// Scope locked to a login's `password` field ONLY (Pitfall 6,
    /// `ItemCapabilities.isPasswordHidden`'s own header) -- a card's
    /// number/cvv/pin and a TOTP's secret stay revealable at the SAME
    /// access level. The narrowing itself is
    /// `DetailFieldTables.passwordFieldIsHidden`, unit-tested directly.
    private func passwordFieldHidden(key: String) -> Bool {
        DetailFieldTables.passwordFieldIsHidden(
            accountHoldsHiddenPassword: ItemCapabilities.isPasswordHidden(item), key: key
        )
    }

    /// `.d`/`.d.act` -- design-conformance fix, Phase 40: was a bare
    /// `VStack` with icon-button trailing actions (`eye`/`doc.on.doc`); the
    /// approved screens draw the trailing action as TEXT in `PVAccent`
    /// ("Copy", "Reveal") at the same size as the row's own value
    /// (`.d.act .v`). Returns `AnyView`, not `some View`, because
    /// `genericFieldRows` assembles a PLAIN ARRAY for `PVDetailGroup`'s
    /// hairline placement -- see that function's own header.
    private func fieldRow(key: String, value: String, fields: ItemFields) -> AnyView {
        let isRevealable = !value.isEmpty && DetailFieldTables.revealableFields.contains(key)
            && !passwordFieldHidden(key: key)
        let isCopyable = !value.isEmpty
        let revealed = revealState.isRevealed(key, forItem: item.id)

        return AnyView(
            PVDetailRow(
                // A secure note's `body` is the only key on its OWN
                // screen; the drawing shows no `.k` caption above it
                // (screens-vault.html:745), unlike every other field.
                label: key == "body" ? nil : fieldLabel(key),
                value: displayValue(for: key, value: value, fields: fields),
                isMono: DetailFieldTables.monoFields.contains(key),
                accessibilityId: "vault.detail.field.\(key)",
                // `share.hiddenPasswordRecipientNote`, byte-identical
                // (Phase 40, plan 40-08, Task 2, `40-UI-SPEC.md` §5.10).
                footnote: passwordFieldHidden(key: key) ? HiddenPasswordDisclosure.recipientNoteEn : nil,
                footnoteAccessibilityId: passwordFieldHidden(key: key) ? "vault.detail.hiddenPasswordNote" : nil
            ) {
                AnyView(
                    HStack(spacing: 14) {
                        // Reveal affordance SUPPRESSED (not merely
                        // defaulted to hidden) for a password held at the
                        // hidden-password level -- matches
                        // `DetailPanel.tsx`'s own suppression, not just a
                        // default-hidden toggle a curious tap could still
                        // flip.
                        if isRevealable {
                            PVDetailAction(
                                title: revealed ? "Hide" : "Reveal",
                                action: { self.reveal(key) },
                                accessibilityId: "vault.detail.reveal.\(key)",
                                accessibilityLabel: revealed ? "Hide \(fieldLabel(key))" : "Show \(fieldLabel(key))"
                            )
                        }
                        if isCopyable {
                            copyAction(key: key, value: value, title: "Copy")
                        }
                    }
                )
            }
        )
    }

    /// The `urls[]` splice, restyled the same way (`.d.act` "Website" ->
    /// "Open") -- see `fieldRow`'s own header for why this returns
    /// `[AnyView]` rather than a `@ViewBuilder` loop.
    private func urlRows(_ fields: ItemFields) -> [AnyView] {
        guard case let .login(f) = fields else { return [] }
        guard !f.urls.isEmpty else {
            return [AnyView(PVDetailRow(label: fieldLabel("url"), value: "\u{2014}"))]
        }
        return f.urls.map { url in
            AnyView(
                PVDetailRow(
                    label: fieldLabel("url"), value: url, accessibilityId: "vault.detail.field.url"
                ) {
                    AnyView(
                        PVDetailAction(
                            title: "Open", action: { openURL(url) },
                            accessibilityId: "vault.detail.copy.url", accessibilityLabel: "Open \(url)"
                        )
                    )
                }
            )
        }
    }

    /// Opens a login's website in the system browser -- the design's own
    /// "Open" action (`.d act`"Website"/"Open"`, screens-vault.html:646),
    /// which the icon-button era never had (the old trailing control was
    /// ALWAYS a copy button, even on the URL row). Best-effort: an
    /// unparsable/schemeless string just does nothing rather than crash or
    /// alert, matching this screen's existing "never offer an operation
    /// known to fail louder than it has to" discipline.
    private func openURL(_ raw: String) {
        let candidate = raw.contains("://") ? raw : "https://\(raw)"
        guard let url = URL(string: candidate) else { return }
        UIApplication.shared.open(url)
    }

    // MARK: - Copy (Copy is the primary row action -- design-conformance §5)

    /// `.d.act .v` styled trailing text, routed through the SAME
    /// `copySecret` choke point every copy affordance on this screen uses
    /// -- replaces the old icon-only `copyButton`.
    private func copyAction(key: String, value: String, title: String) -> PVDetailAction {
        PVDetailAction(
            title: title,
            action: { copySecret(key: key, value: value) },
            accessibilityId: "vault.detail.copy.\(key)",
            accessibilityLabel: "Copy \(fieldLabel(key))"
        )
    }

    /// TOUCH call site #2 of 2: fires on EVERY copy, unconditionally --
    /// mirrors `DetailPanel.tsx`'s `handleCopy`, the single choke-point for
    /// every copy affordance in this screen.
    private func copySecret(key: String, value: String) {
        guard !value.isEmpty else { return }
        let deadline = ClipboardService.shared.copy(value, fieldLabel: fieldLabel(key))
        store.touch(itemId: item.id)
        confirmation = ClipboardConfirmation(fieldLabel: fieldLabel(key), deadline: deadline)
    }

    // MARK: - Reveal

    /// TOUCH call site #1 of 2: fires ONLY when the field transitions from
    /// hidden to revealed, never on re-hide -- `DetailRevealState.toggle`'s
    /// own return value is exactly that distinction.
    private func reveal(_ key: String) {
        let nowRevealed = revealState.toggle(key)
        if nowRevealed {
            store.touch(itemId: item.id)
        }
    }

    // MARK: - Identity (composed layout -- FIELD_ORDER.identity is empty)

    @ViewBuilder
    private func identitySection(_ fields: ItemFields) -> some View {
        // An `if case` inside a `@ViewBuilder` body (never an explicit
        // `return` from a `guard`) -- explicit returns of two DIFFERENT
        // concrete view types (`EmptyView` vs. this `VStack`) do not
        // type-check under the result-builder transform; `if case` without
        // `else` does, producing nothing at all for the non-identity case.
        if case let .identity(f) = fields {
            PVDetailGroup(rows: identityMainRows(f))
            if let address = addressRow(f) {
                PVDetailSectionLabel(title: "Address")
                PVDetailGroup(rows: [address])
            }
            if !f.notes.isEmpty {
                PVDetailSectionLabel(title: "Notes")
                PVDetailGroup(rows: [AnyView(plainRow(label: nil, value: f.notes, copyable: true, key: "notes"))])
            }
        }
    }

    /// Plain array (not `@ViewBuilder`) for the same reason `fieldRow`'s
    /// own header names: `PVDetailGroup`'s hairline placement needs the
    /// EXACT rendered-row count, computed once here rather than re-derived
    /// from conditional view content.
    private func identityMainRows(_ f: IdentityFields) -> [AnyView] {
        let fullName = [f.firstName, f.lastName]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        var rows: [AnyView] = [AnyView(plainRow(label: "Full name", value: fullName))]
        if !f.email.isEmpty {
            rows.append(AnyView(plainRow(label: "Email", value: f.email, copyable: true, key: "email")))
        }
        if !f.phone.isEmpty {
            rows.append(AnyView(plainRow(label: "Phone", value: f.phone, copyable: true, key: "phone")))
        }
        return rows
    }

    /// Structured lines when populated, else the legacy flat `address`
    /// split on newlines -- exactly `DetailPanel.tsx`'s own fallback
    /// (`IdentityAddress.swift`'s `addressLines` covers the structured
    /// half; the legacy split is inlined here since it is display-only and
    /// not part of the read/save round trip `IdentityAddress.swift` owns).
    /// `nil` when there is nothing to show at all -- the design's own
    /// "Address" group is absent entirely rather than an empty card
    /// (screens-vault.html:697-700 always has content; there is no drawn
    /// empty state to match).
    private func addressRow(_ f: IdentityFields) -> AnyView? {
        let structured = IdentityAddress.addressLines(f)
        let legacyLines = f.address
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let lines = structured.isEmpty ? legacyLines : structured
        guard !lines.isEmpty else { return nil }
        let copyValue = structured.isEmpty ? f.address : structured.joined(separator: ", ")

        // `.d .v` in the drawing carries no `.k` label at all
        // (screens-vault.html:699) -- the `.glab`"Address" above already
        // says what this is.
        return AnyView(
            PVDetailRow(value: lines.joined(separator: "\n"), accessibilityId: "vault.detail.field.address") {
                AnyView(copyAction(key: "address", value: copyValue, title: "Copy"))
            }
        )
    }

    // MARK: - Passkey (composed layout -- FIELD_ORDER.passkey is empty)

    /// Cryptographic material, not user content: NO Edit anywhere on this
    /// screen (`ItemListView.swift`'s context menu already gates it the
    /// same way), and `rawPasskeyJson` is NEVER read here -- it has no
    /// reader on a phone (design-conformance §5).
    @ViewBuilder
    private func passkeySection(_ fields: ItemFields) -> some View {
        // Same `if case` (never `guard ... else { return EmptyView() }`)
        // discipline as `identitySection` above, for the same reason.
        if case let .passkey(f) = fields {
            // `.slot key` (screens-vault.html:763) -- `StatusCallout`'s
            // `.passkey` tone is the SAME chrome (11pt radius, 14%-tint
            // background, leading dot) this row was hand-rolling as a bare
            // `HStack`; design-conformance fix, Phase 40.
            StatusCallout(
                text: "Signs you in without a password. The private key never leaves your devices.",
                tone: .passkey
            )
            .padding(.bottom, PVMetrics.detailGroupSpacing)
            PVDetailGroup(rows: passkeyMainRows(f))
        }
    }

    private func passkeyMainRows(_ f: PasskeyFields) -> [AnyView] {
        var rows: [AnyView] = [AnyView(plainRow(label: "Website", value: f.rpId, copyable: true, key: "rpId"))]
        if let username = f.username, !username.isEmpty {
            rows.append(AnyView(plainRow(label: "Account", value: username, copyable: true, key: "username")))
        }
        if let displayName = f.userDisplayName, !displayName.isEmpty {
            rows.append(AnyView(
                plainRow(label: "Display name", value: displayName, copyable: true, key: "userDisplayName")
            ))
        }
        if let updatedAt = item.updatedAt {
            rows.append(AnyView(plainRow(label: "Last updated", value: updatedAt, key: "updatedAt")))
        }
        return rows
    }

    // MARK: - Shared row helpers

    /// The plain (non-`FIELD_ORDER`) row shape identity/passkey compose by
    /// hand -- same `.d`/`.d.act` visual treatment as `fieldRow` above,
    /// just addressed by an explicit label/value pair instead of a
    /// `DetailFieldTables` key. `label: nil` skips the `.k` line entirely
    /// (the identity notes row inside its own "Notes" `.glab` group).
    /// Not `@ViewBuilder` -- the body is a single unconditional `return`,
    /// which disables the result-builder transform anyway (and warns);
    /// a plain function returning `some View` is the same thing without
    /// the warning.
    private func plainRow(label: String?, value: String, copyable: Bool = false, key: String = "") -> some View {
        // Resolved to a single `AnyView` value BEFORE the trailing closure
        // literal -- `PVDetailRow.trailing`'s own header explains why an
        // `if`/`else` INSIDE that closure would not typecheck.
        let trailingView: AnyView = (copyable && !value.isEmpty)
            ? AnyView(copyAction(key: key, value: value, title: "Copy"))
            : AnyView(EmptyView())
        return PVDetailRow(
            label: label, value: value.isEmpty ? "\u{2014}" : value,
            accessibilityId: key.isEmpty ? nil : "vault.detail.field.\(key)"
        ) {
            trailingView
        }
    }

    /// The tag capsules as ONE `.d` row -- the "Tags" `.glab` label already
    /// sits above this group (`fieldsBody`'s own call site), so this view
    /// carries no caption of its own, matching every other labelled
    /// group's single-row body (Notes, Secret).
    @ViewBuilder
    private var tagsRow: some View {
        HStack {
            ForEach(item.tags, id: \.self) { tag in
                Text(verbatim: tag)
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color("PVSurfaceAlt"))
                    .foregroundStyle(Color("PVTextMuted"))
                    .clipShape(Capsule())
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, PVMetrics.detailRowHPadding)
        .padding(.vertical, PVMetrics.detailRowVPadding)
    }

    /// `.d`/`.grp`"Details" (screens-vault.html:650-652) -- "Last used"
    /// then "Modified", each its OWN plain row (was one `VStack` of
    /// inline "Modified: <date>" text). `nil` when neither exists, so
    /// `fieldsBody` can skip the whole labelled group rather than draw an
    /// empty card.
    private func detailsFooterRows() -> [AnyView]? {
        var rows: [AnyView] = []
        if let lastUsedAt = item.lastUsedAt {
            // The RAW `"vault.detail.lastUsedAt"` id (no `field.` prefix)
            // is the SAME identifier this row carried before the Phase 40
            // restyle -- built directly rather than through `plainRow`,
            // whose `key:` always composes `"vault.detail.field.\(key)"`.
            rows.append(AnyView(
                PVDetailRow(label: "Last used", value: lastUsedAt, accessibilityId: "vault.detail.lastUsedAt")
            ))
        }
        if let updatedAt = item.updatedAt {
            rows.append(AnyView(plainRow(label: "Modified", value: updatedAt)))
        }
        return rows.isEmpty ? nil : rows
    }

    // MARK: - Non-decryptable / pending states (unchanged from 38-02)

    /// The row exists on the server and is retained locally; only its
    /// plaintext is unavailable. Saying that plainly is the point -- a blank
    /// screen or a dropped row would hide exactly the failure E-W1 hunts.
    /// `undecryptable` rows stay visible and tappable per design-conformance
    /// -- this codebase reads `undecryptable` as a TAMPERING signal, not a
    /// decode nicety.
    @ViewBuilder
    private func undecryptablePanel(_ reason: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(verbatim: "This item could not be decrypted")
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill")
            }
            .foregroundStyle(Color("PVError"))
            Text(verbatim: "The row is still on the server and has not been altered or removed. It was retained here rather than hidden.")
                .font(.footnote)
                .foregroundStyle(Color("PVTextMuted"))
            Text(verbatim: reason)
                .font(.caption.monospaced())
                .foregroundStyle(Color("PVTextMuted"))
                .accessibilityIdentifier("vault.detail.undecryptable.reason")
        }
    }

    /// A DIFFERENT presentation from `undecryptablePanel`, deliberately.
    /// "Never decrypted at all, and correctly so -- the key has not been
    /// delivered yet" is a perfectly normal wait; dressing it in the
    /// integrity-warning treatment would alarm a newcomer about nothing, and
    /// folding a real integrity failure into this calm one would hide it.
    @ViewBuilder
    private func pendingFamilyKeyPanel() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label {
                Text(verbatim: "Waiting for the family key")
            } icon: {
                Image(systemName: "hourglass")
            }
            .foregroundStyle(Color("PVTextMuted"))
            Text(verbatim: "You have access to this shared folder, but its key has not reached this device yet. Nothing is wrong.")
                .font(.footnote)
                .foregroundStyle(Color("PVTextMuted"))
                .accessibilityIdentifier("vault.detail.pendingFamilyKey")
        }
    }
}
