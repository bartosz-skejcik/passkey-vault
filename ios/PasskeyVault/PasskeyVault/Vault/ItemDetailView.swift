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

    init(
        item: VaultItemViewModel, store: VaultStore, revealState: Binding<DetailRevealState>,
        onLockRequested: (() -> Void)? = nil, onSignOutRequested: (() -> Void)? = nil,
        onSettingsRequested: (() -> Void)? = nil
    ) {
        self.item = item
        self.store = store
        self._revealState = revealState
        self.onLockRequested = onLockRequested
        self.onSignOutRequested = onSignOutRequested
        self.onSettingsRequested = onSettingsRequested
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch item.content {
                case let .fields(fields):
                    header(fields)
                    fieldsBody(fields)
                case let .undecryptable(reason):
                    undecryptablePanel(reason)
                case .pendingFamilyKey:
                    pendingFamilyKeyPanel()
                }
                if let confirmation {
                    copyConfirmationBanner(confirmation)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
        }
        .background(Color("PVBackground"))
        .navigationTitle(Text(verbatim: item.displayName))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            vaultLockToolbarContent(
                onLockRequested: onLockRequested, onSignOutRequested: onSignOutRequested,
                onSettingsRequested: onSettingsRequested
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

    // MARK: - Header

    @ViewBuilder
    private func header(_ fields: ItemFields) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if ["login", "passkey", "card"].contains(fields.typeName) {
                ItemIconTile(item: item, variant: .header)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: item.displayName)
                    .font(.title3.bold())
                    .foregroundStyle(Color("PVTextPrimary"))
                Text(verbatim: typeLabel(fields.typeName))
                    .font(.caption)
                    .foregroundStyle(Color("PVTextMuted"))
            }
        }
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

    // MARK: - Body dispatch

    @ViewBuilder
    private func fieldsBody(_ fields: ItemFields) -> some View {
        switch fields {
        case .identity:
            identitySection(fields)
        case .passkey:
            passkeySection(fields)
        case .totp:
            // The composed ring+code section sits ABOVE the generic
            // field-order loop, which still runs afterward -- it renders
            // the raw base32 secret as the usual masked/revealable field
            // (`DetailFieldTables.fieldOrder["totp"] == ["secret"]`,
            // unchanged). Matches `web/.../DetailPanel.tsx`'s own
            // structure: the `TotpCountdownRing` block, then the same
            // `FIELD_ORDER` loop every other type goes through.
            totpSection(fields)
            genericFields(fields)
        default:
            genericFields(fields)
        }
        if !item.tags.isEmpty {
            tagsRow
        }
        detailsFooter
    }

    // MARK: - TOTP (composed layout, plan 38-10 -- design-conformance §"38-10")

    @ViewBuilder
    private func totpSection(_ fields: ItemFields) -> some View {
        if case let .totp(f) = fields {
            TotpCountdownView(
                secretB32: f.secret,
                algorithm: f.algorithm,
                digits: f.digits,
                period: f.period,
                style: .detail,
                // Byte-identical to the old internal formatting, just moved
                // to the call site now that the view takes a pre-formatted
                // label (quick task 260818-irw, Task 1 -- a mechanical
                // signature update; Task 2 changes `.detail`'s rendered
                // numbers, not this).
                label: f.issuer.isEmpty ? "Authenticator" : f.issuer,
                onCopy: { code in copySecret(key: "totpCode", value: code) }
            )
            .padding(.vertical, 4)
        }
    }

    // MARK: - Generic field-table loop (login, card, note, totp)

    @ViewBuilder
    private func genericFields(_ fields: ItemFields) -> some View {
        let order = DetailFieldTables.fieldOrder[fields.typeName] ?? []
        ForEach(order, id: \.self) { key in
            let value = fieldValue(key, fields)
            if !(DetailFieldTables.optionalIfEmptyFields.contains(key) && value.isEmpty) {
                fieldRow(key: key, value: value, fields: fields)
                // The login->urls splice: `urls` is `[String]`, not a
                // scalar `FIELD_ORDER` entry can carry, so it is inserted
                // as a special case immediately after `password` -- matching
                // `DetailPanel.tsx`'s own `Fragment` shape.
                if fields.typeName == "login", key == "password" {
                    urlsRow(fields)
                }
            }
        }
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

    @ViewBuilder
    private func fieldRow(key: String, value: String, fields: ItemFields) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: fieldLabel(key))
                .font(.caption)
                .foregroundStyle(Color("PVTextMuted"))
            HStack(spacing: 8) {
                Text(verbatim: displayValue(for: key, value: value, fields: fields))
                    .font(DetailFieldTables.monoFields.contains(key) ? .body.monospaced() : .body)
                    .foregroundStyle(Color("PVTextPrimary"))
                    .textSelection(.enabled)
                    .accessibilityIdentifier("vault.detail.field.\(key)")
                Spacer(minLength: 0)
                // Reveal affordance SUPPRESSED (not merely defaulted to
                // hidden) for a password held at the hidden-password level
                // -- matches `DetailPanel.tsx`'s own suppression, not just a
                // default-hidden toggle a curious tap could still flip.
                if !value.isEmpty, DetailFieldTables.revealableFields.contains(key), !passwordFieldHidden(key: key) {
                    Button {
                        reveal(key)
                    } label: {
                        Image(systemName: revealState.isRevealed(key, forItem: item.id) ? "eye.slash" : "eye")
                            .foregroundStyle(Color("PVTextMuted"))
                    }
                    .accessibilityIdentifier("vault.detail.reveal.\(key)")
                    .accessibilityLabel(revealState.isRevealed(key, forItem: item.id) ? "Hide \(fieldLabel(key))" : "Show \(fieldLabel(key))")
                }
                if !value.isEmpty {
                    copyButton(key: key, value: value)
                }
            }
            if passwordFieldHidden(key: key) {
                Text(verbatim: "You can use this password, but it's masked on this account.")
                    .font(.caption2)
                    .foregroundStyle(Color("PVTextMuted"))
                    .accessibilityIdentifier("vault.detail.hiddenPasswordNote")
            }
        }
    }

    @ViewBuilder
    private func urlsRow(_ fields: ItemFields) -> some View {
        // `if case` (never `guard ... else { return }`) -- same
        // result-builder reason as `identitySection`/`passkeySection`
        // above: an early `return` from a `guard` disables the `@ViewBuilder`
        // transform for the whole function body.
        if case let .login(f) = fields {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: fieldLabel("url"))
                    .font(.caption)
                    .foregroundStyle(Color("PVTextMuted"))
                if f.urls.isEmpty {
                    Text(verbatim: "\u{2014}")
                        .foregroundStyle(Color("PVTextPrimary"))
                } else {
                    ForEach(Array(f.urls.enumerated()), id: \.offset) { _, url in
                        HStack(spacing: 8) {
                            Text(verbatim: url)
                                .foregroundStyle(Color("PVTextPrimary"))
                                .textSelection(.enabled)
                            Spacer(minLength: 0)
                            copyButton(key: "url", value: url)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Copy (Copy is the primary row action -- design-conformance §5)

    @ViewBuilder
    private func copyButton(key: String, value: String) -> some View {
        Button {
            copySecret(key: key, value: value)
        } label: {
            Image(systemName: "doc.on.doc")
                .foregroundStyle(Color("PVAccent"))
        }
        .accessibilityIdentifier("vault.detail.copy.\(key)")
        .accessibilityLabel("Copy \(fieldLabel(key))")
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

    /// A live countdown DERIVED FROM THE DEADLINE on every render tick --
    /// never decremented locally (Task 2's own behaviour requirement,
    /// Pitfall 5's sibling discipline for the TOTP ring).
    @ViewBuilder
    private func copyConfirmationBanner(_ confirmation: ClipboardConfirmation) -> some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let remaining = ClipboardService.remainingSeconds(deadline: confirmation.deadline, now: context.date)
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(Color("PVSuccess"))
                Text(verbatim: ClipboardWording.confirmation(
                    fieldLabel: confirmation.fieldLabel, remainingSeconds: remaining
                ))
                    .font(.caption)
                    .foregroundStyle(Color("PVTextMuted"))
                Spacer(minLength: 0)
                Button {
                    // Dismissing the confirmation is COSMETIC ONLY -- it
                    // must never cancel the real clear
                    // (`copyToast.ts`'s own header; `ClipboardService
                    // .dismissConfirmation()` is a deliberate no-op on the
                    // real timer, unit-tested directly).
                    ClipboardService.shared.dismissConfirmation()
                    self.confirmation = nil
                } label: {
                    Image(systemName: "xmark")
                        .foregroundStyle(Color("PVTextMuted"))
                }
                .accessibilityIdentifier("vault.detail.copyConfirmation.dismiss")
            }
            .padding(10)
            .background(Color("PVSurfaceAlt"), in: RoundedRectangle(cornerRadius: 10))
            .accessibilityIdentifier("vault.detail.copyConfirmation")
        }
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
            let fullName = [f.firstName, f.lastName]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")

            VStack(alignment: .leading, spacing: 16) {
                plainRow(label: "Full name", value: fullName)
                if !f.email.isEmpty {
                    plainRow(label: "Email", value: f.email, copyable: true, key: "email")
                }
                if !f.phone.isEmpty {
                    plainRow(label: "Phone", value: f.phone, copyable: true, key: "phone")
                }
                addressRow(f)
                if !f.notes.isEmpty {
                    plainRow(label: "Notes", value: f.notes, copyable: true, key: "notes")
                }
            }
        }
    }

    /// Structured lines when populated, else the legacy flat `address`
    /// split on newlines -- exactly `DetailPanel.tsx`'s own fallback
    /// (`IdentityAddress.swift`'s `addressLines` covers the structured
    /// half; the legacy split is inlined here since it is display-only and
    /// not part of the read/save round trip `IdentityAddress.swift` owns).
    @ViewBuilder
    private func addressRow(_ f: IdentityFields) -> some View {
        let structured = IdentityAddress.addressLines(f)
        let legacyLines = f.address
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let lines = structured.isEmpty ? legacyLines : structured
        let copyValue = structured.isEmpty ? f.address : structured.joined(separator: ", ")

        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: "Address")
                .font(.caption)
                .foregroundStyle(Color("PVTextMuted"))
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 1) {
                    if lines.isEmpty {
                        Text(verbatim: "\u{2014}")
                            .foregroundStyle(Color("PVTextPrimary"))
                    } else {
                        ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                            Text(verbatim: line)
                                .foregroundStyle(Color("PVTextPrimary"))
                        }
                    }
                }
                Spacer(minLength: 0)
                if !lines.isEmpty {
                    copyButton(key: "address", value: copyValue)
                }
            }
        }
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
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 8) {
                    Image(systemName: "key.fill")
                        .foregroundStyle(Color("PVPasskey"))
                    Text(verbatim: "Signs you in without a password. The private key never leaves your devices.")
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                }
                plainRow(label: "Website", value: f.rpId, copyable: true, key: "rpId")
                if let username = f.username, !username.isEmpty {
                    plainRow(label: "Account", value: username, copyable: true, key: "username")
                }
                if let displayName = f.userDisplayName, !displayName.isEmpty {
                    plainRow(label: "Display name", value: displayName, copyable: true, key: "userDisplayName")
                }
                if let updatedAt = item.updatedAt {
                    plainRow(label: "Last updated", value: updatedAt, copyable: false, key: "updatedAt")
                }
            }
        }
    }

    // MARK: - Shared row helpers

    @ViewBuilder
    private func plainRow(label: String, value: String, copyable: Bool = false, key: String = "") -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: label)
                .font(.caption)
                .foregroundStyle(Color("PVTextMuted"))
            HStack(spacing: 8) {
                Text(verbatim: value.isEmpty ? "\u{2014}" : value)
                    .foregroundStyle(Color("PVTextPrimary"))
                    .textSelection(.enabled)
                Spacer(minLength: 0)
                if copyable, !value.isEmpty {
                    copyButton(key: key, value: value)
                }
            }
        }
    }

    @ViewBuilder
    private var tagsRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(verbatim: "Tags")
                .font(.caption)
                .foregroundStyle(Color("PVTextMuted"))
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
            }
        }
    }

    @ViewBuilder
    private var detailsFooter: some View {
        if item.updatedAt != nil || item.lastUsedAt != nil {
            VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: "Details")
                    .font(.caption)
                    .foregroundStyle(Color("PVTextMuted"))
                if let updatedAt = item.updatedAt {
                    Text(verbatim: "Modified: \(updatedAt)")
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                }
                if let lastUsedAt = item.lastUsedAt {
                    Text(verbatim: "Last used: \(lastUsedAt)")
                        .font(.footnote)
                        .foregroundStyle(Color("PVTextMuted"))
                        .accessibilityIdentifier("vault.detail.lastUsedAt")
                }
            }
        }
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
