//
//  ItemFormView.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-09, Task 1. Create AND edit for
//  the five creatable item types -- ONE `Form`, rows switched by TYPE, per
//  design-conformance §"38-09 -- create, edit, folders": "Edit is one Form,
//  rows switched by type." `ItemCreationKind` (below) is reachable ONLY on
//  create, from the dock's "+" panel (`ItemListView.swift`'s
//  `VaultCreateAction.creationKind`) -- there is no affordance anywhere in
//  this file to change an existing item's type, because doing so would
//  orphan its fields (a login's `password` has nowhere to go in a note).
//
//  `ItemCreationKind` moved HERE, verbatim, in plan 38-11: the dedicated
//  `TypePicker` VIEW that used to own it was retired (deferred-items.md,
//  option 1 -- the dock's "+" panel replaced it as the ONLY create route
//  since commit `4cda61f`, and the picker sheet it used to hand off to had
//  no call site left anywhere in the app). The enum itself has real call
//  sites (`VaultCreateAction.creationKind`, `ItemFormMode.create`) and stays;
//  only the orphaned view is gone.
//
//  Presented as a SHEET, never pushed onto the navigation stack: 38-11 (lock
//  teardown) needs to tear the whole editing surface down in ONE state
//  assignment, and unwinding a navigation stack is not that.
//
//  IDENTITY ADDRESS ROUND TRIP (design-conformance's own named trap): the
//  structured address fields are what this form edits; the legacy flat
//  `address` string is never shown as an editable field. `IdentityAddress
//  .withLegacyAddressPrefill` seeds `addressLine1` from it on OPEN (edit
//  mode only -- a fresh create draft has no address to prefill from), and
//  `IdentityAddress.withComposedLegacyAddress` recomposes it on SAVE, in
//  BOTH create and edit. Reproducing only one half destroys the address the
//  browser extension's autofill reads. `Vault/IdentityAddress.swift` (38-03)
//  owns both halves; nothing here reimplements them.
//
//  TOTP validation runs BEFORE any save is attempted -- `TotpValidation
//  .swift` mirrors the exact limits `crates/pv-core/src/totp.rs` inherits
//  from `totp-rs`. A rejection here is what stands between a user and an
//  item that renders "Invalid code" forever.
//

import SwiftUI

/// FIVE creatable types. `scripts/check-item-type-parity.sh`'s own six-member
/// union (`ItemFields.swift`) is the render surface; this is the narrower
/// create surface and is intentionally NOT required to match it 1:1.
/// `passkey` is provider-created only (Phase 12, the extension/AutoFill
/// path); there is no "create a passkey" form on any client, matching
/// design-conformance §5.
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
    /// `""` except `totp.secret`.
    ///
    /// [Rule 1 - Bug, 38-09] `totp.secret`'s placeholder was 38-06's
    /// `"JBSWY3DPEHPK3PXP"` -- decodes to only **10 bytes** (80 bits),
    /// below `totp-rs`'s own 128-bit/16-byte minimum
    /// (`TotpValidation.minSecretBytes`). Opening a fresh Code draft would
    /// therefore have failed THIS PLAN'S OWN validator immediately, before
    /// the user typed anything. Replaced with the RFC 6238 Appendix B SHA1
    /// test-vector secret (`crates/pv-core/src/totp.rs`'s own
    /// `SHA1_SECRET`) -- 32 base32 characters, 20 decoded bytes, valid under
    /// every rule `TotpValidation` checks.
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
            return .totp(TotpFields(name: name, folderId: nil, tags: [], secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", issuer: "", algorithm: "SHA1", digits: 6, period: 30, notes: ""))
        }
    }
}

/// How this form was opened. Type is fixed for the form's whole lifetime --
/// `.create` fixes it from the "+" panel's choice, `.edit` fixes it from the
/// item's own existing type. Neither case can change it afterward.
enum ItemFormMode {
    case create(ItemCreationKind)
    case edit(VaultItemViewModel)
}

/// The five creatable field-model cases -- deliberately narrower than
/// `ItemFields`' six-member union (no `.passkey` case exists here at all,
/// matching design-conformance's "Passkey detail has no Edit").
private enum ItemFormKind: Equatable {
    case login, card, identity, note, totp
}

struct ItemFormView: View {
    let mode: ItemFormMode
    @Bindable var store: VaultStore
    var folderStore: FolderStore?
    var onSaved: ((VaultItemViewModel) -> Void)?

    @Environment(\.dismiss) private var dismiss

    private let kind: ItemFormKind

    // One stored property PER type -- only the one matching `kind` is ever
    // read or written, but keeping five concrete `@State` structs (rather
    // than re-switching on an `ItemFields` enum for every field access)
    // gives every row a native `$loginFields.username`-style binding
    // instead of a hand-rolled `Binding(get:set:)` per field.
    @State private var loginFields: LoginFields
    @State private var cardFields: CardFields
    @State private var identityFields: IdentityFields
    @State private var noteFields: NoteFields
    @State private var totpFields: TotpFields

    @State private var isSaving = false
    @State private var errorMessage: String?
    @State private var totpValidationError: TotpValidationError?
    @State private var showGenerator = false
    @State private var showFolderPicker = false
    @State private var tagsText: String
    /// See the `SecureField.id(_:)` comment at the login password row.
    @State private var passwordFieldGeneration = 0

    init(
        mode: ItemFormMode,
        store: VaultStore,
        folderStore: FolderStore? = nil,
        /// Quick task 260818-lsk: a scanned `otpauth://` URI's fields, used
        /// ONLY when `mode` is `.create(.totp)` -- ignored for every other
        /// creation kind and for `.edit`, both of which already have their
        /// own field source. `nil` (the default) is the ordinary "New code"
        /// path: `ItemCreationKind.emptyFields()`'s honest-empty draft,
        /// unchanged. This is additive, not a restructuring -- the two
        /// existing call sites (`ItemListView.sheetContent`'s `.creating`
        /// and `.editing` cases) compile unchanged with the default.
        prefillTotp: TotpFields? = nil,
        onSaved: ((VaultItemViewModel) -> Void)? = nil
    ) {
        self.mode = mode
        self.store = store
        self.folderStore = folderStore
        self.onSaved = onSaved

        // Defaults for the four structs `kind` will NOT select -- never
        // read, but every `@State` property needs an initial value.
        var login = LoginFields(name: "", folderId: nil, tags: [], username: "", password: "", urls: [], notes: "")
        var card = CardFields(name: "", folderId: nil, tags: [], cardholderName: "", number: "", expiry: "", cvv: "", pin: nil, zip: nil, notes: "")
        var identity = IdentityFields(name: "", folderId: nil, tags: [], firstName: "", lastName: "", email: "", phone: "", address: "", addressLine1: nil, addressLine2: nil, city: nil, state: nil, zip: nil, country: nil, notes: "")
        var note = NoteFields(name: "", folderId: nil, tags: [], body: "")
        var totp = TotpFields(name: "", folderId: nil, tags: [], secret: "", issuer: "", algorithm: "SHA1", digits: 6, period: 30, notes: "")

        let resolvedKind: ItemFormKind
        let resolvedTags: [String]

        switch mode {
        case let .create(creationKind):
            if creationKind == .totp, let prefillTotp {
                // The scan path: `TotpScanView` already validated the URI
                // via `OtpauthParser` before this form ever opened, so
                // nothing here re-derives or re-validates the fields --
                // this is a straight prefill, and `TotpValidation`'s own
                // check still runs on Save exactly as it does for a
                // hand-typed secret (Rule: the scan is a shortcut into the
                // SAME form, not a bypass of it).
                totp = prefillTotp
                resolvedKind = .totp
                resolvedTags = prefillTotp.tags
            } else {
                let fresh = creationKind.emptyFields()
                switch fresh {
                case let .login(f): login = f; resolvedKind = .login
                case let .card(f): card = f; resolvedKind = .card
                case let .identity(f): identity = f; resolvedKind = .identity
                case let .note(f): note = f; resolvedKind = .note
                case let .totp(f): totp = f; resolvedKind = .totp
                case .passkey: resolvedKind = .note // unreachable -- ItemCreationKind has no .passkey case
                }
                resolvedTags = fresh.tags
            }
        case let .edit(item):
            // Defensive fallback: unreachable via any real navigation path
            // today (`ItemListView` gates Edit behind `!isUndecryptable`,
            // `!isPendingFamilyKey` and `item.fields?.typeName != "passkey"`
            // BEFORE presenting this form) -- but a form that force-unwraps
            // is a worse failure than one that opens on an honest empty
            // note, so this stays a fallback rather than a crash.
            let existing = item.fields ?? .note(NoteFields(name: item.displayName, folderId: nil, tags: [], body: ""))
            switch existing {
            case let .login(f): login = f; resolvedKind = .login
            case let .card(f): card = f; resolvedKind = .card
            case let .identity(f):
                // READ half of the address round trip: seed addressLine1
                // from the legacy flat string ONLY when no structured field
                // is populated yet -- see IdentityAddress.swift's header.
                identity = IdentityAddress.withLegacyAddressPrefill(f)
                resolvedKind = .identity
            case let .note(f): note = f; resolvedKind = .note
            case let .totp(f): totp = f; resolvedKind = .totp
            case .passkey:
                // Unreachable (see above) -- Edit is never offered for a
                // passkey row. Falls back to the note default already set.
                resolvedKind = .note
            }
            resolvedTags = existing.tags
        }

        self.kind = resolvedKind
        _loginFields = State(initialValue: login)
        _cardFields = State(initialValue: card)
        _identityFields = State(initialValue: identity)
        _noteFields = State(initialValue: note)
        _totpFields = State(initialValue: totp)
        _tagsText = State(initialValue: resolvedTags.joined(separator: ", "))
    }

    // MARK: - Body

    var body: some View {
        NavigationStack {
            Form {
                Section("Name") {
                    TextField("Name", text: nameBinding)
                        .accessibilityIdentifier("itemform.name")
                }

                switch kind {
                case .login: loginRows
                case .card: cardRows
                case .identity: identityRows
                case .note: noteRows
                case .totp: totpRows
                }

                if let folderStore {
                    folderSection(folderStore)
                }

                Section("Tags") {
                    TextField("Comma-separated tags", text: $tagsText)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .accessibilityIdentifier("itemform.tags")
                }

                if kind != .note {
                    Section("Notes") {
                        TextField("Notes", text: notesBinding, axis: .vertical)
                            .lineLimit(3...6)
                    }
                }

                if let errorMessage {
                    Section {
                        Text(verbatim: errorMessage)
                            .foregroundStyle(Color("PVError"))
                            .accessibilityIdentifier("itemform.error")
                    }
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button {
                        Task { await save() }
                    } label: {
                        if isSaving {
                            ProgressView()
                        } else {
                            Text("Save")
                        }
                    }
                    .disabled(isSaving)
                    .accessibilityIdentifier("itemform.save")
                }
            }
            .sheet(isPresented: $showGenerator) {
                GeneratorSheet { generated in
                    loginFields.password = generated
                    passwordFieldGeneration += 1
                }
            }
            .sheet(isPresented: $showFolderPicker) {
                if let folderStore {
                    FolderPicker(store: folderStore, selection: folderIdBinding)
                }
            }
        }
        .interactiveDismissDisabled(isSaving)
    }

    private var navigationTitle: String {
        switch mode {
        case .create: return "New \(kindTitle)"
        case .edit: return "Edit \(kindTitle)"
        }
    }

    private var kindTitle: String {
        switch kind {
        case .login: return "Login"
        case .card: return "Card"
        case .identity: return "Identity"
        case .note: return "Note"
        case .totp: return "Code"
        }
    }

    // MARK: - Per-type rows

    @ViewBuilder
    private var loginRows: some View {
        Section("Login") {
            TextField("Username", text: $loginFields.username)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("itemform.login.username")

            HStack {
                // [Rule 1 - Bug, 38-09] `.id(passwordFieldGeneration)` --
                // observed live: `SecureField`'s underlying `UITextField`
                // does not always redraw its masked dots when its bound
                // value changes PROGRAMMATICALLY (as opposed to by user
                // keystroke) -- `passwordField.value` (the accessibility
                // layer) reflected the generator's inserted value
                // correctly, but the on-screen glyph row stayed visually
                // blank in a UI-test screenshot until this fix. Forcing a
                // new view identity on every programmatic insertion makes
                // SwiftUI recreate the field, which reliably redraws.
                SecureField("Password", text: $loginFields.password)
                    .id(passwordFieldGeneration)
                    .accessibilityIdentifier("itemform.login.password")
                Button {
                    showGenerator = true
                } label: {
                    Image(systemName: "die.face.5")
                }
                .accessibilityIdentifier("itemform.login.generate")
            }

            TextField(
                "URLs (one per line)",
                text: Binding(
                    get: { loginFields.urls.joined(separator: "\n") },
                    set: { loginFields.urls = $0.split(separator: "\n", omittingEmptySubsequences: true).map(String.init) }
                ),
                axis: .vertical
            )
            .autocorrectionDisabled()
            .textInputAutocapitalization(.never)
            .lineLimit(1...4)
        }
    }

    @ViewBuilder
    private var cardRows: some View {
        Section("Card") {
            TextField("Cardholder name", text: $cardFields.cardholderName)
            TextField("Card number", text: $cardFields.number)
                .keyboardType(.numberPad)
                .accessibilityIdentifier("itemform.card.number")
            TextField("Expiry (MM/YY)", text: $cardFields.expiry)
            SecureField("CVV", text: $cardFields.cvv)
                .keyboardType(.numberPad)
            TextField(
                "PIN (optional)",
                text: Binding(get: { cardFields.pin ?? "" }, set: { cardFields.pin = $0.isEmpty ? nil : $0 })
            )
            .keyboardType(.numberPad)
            TextField(
                "ZIP / Postal code (optional)",
                text: Binding(get: { cardFields.zip ?? "" }, set: { cardFields.zip = $0.isEmpty ? nil : $0 })
            )
        }
    }

    @ViewBuilder
    private var identityRows: some View {
        Section("Name") {
            TextField("First name", text: $identityFields.firstName)
            TextField("Last name", text: $identityFields.lastName)
        }
        Section("Contact") {
            TextField("Email", text: $identityFields.email)
                .keyboardType(.emailAddress)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
            TextField("Phone", text: $identityFields.phone)
                .keyboardType(.phonePad)
        }
        Section("Address") {
            TextField(
                "Address line 1",
                text: Binding(get: { identityFields.addressLine1 ?? "" }, set: { identityFields.addressLine1 = $0.isEmpty ? nil : $0 })
            )
            .accessibilityIdentifier("itemform.identity.addressLine1")
            TextField(
                "Address line 2 (optional)",
                text: Binding(get: { identityFields.addressLine2 ?? "" }, set: { identityFields.addressLine2 = $0.isEmpty ? nil : $0 })
            )
            TextField(
                "City",
                text: Binding(get: { identityFields.city ?? "" }, set: { identityFields.city = $0.isEmpty ? nil : $0 })
            )
            TextField(
                "State / Province",
                text: Binding(get: { identityFields.state ?? "" }, set: { identityFields.state = $0.isEmpty ? nil : $0 })
            )
            TextField(
                "ZIP / Postal code",
                text: Binding(get: { identityFields.zip ?? "" }, set: { identityFields.zip = $0.isEmpty ? nil : $0 })
            )
            TextField(
                "Country",
                text: Binding(get: { identityFields.country ?? "" }, set: { identityFields.country = $0.isEmpty ? nil : $0 })
            )
        }
    }

    @ViewBuilder
    private var noteRows: some View {
        Section("Note") {
            TextField("Body", text: $noteFields.body, axis: .vertical)
                .lineLimit(5...12)
                .accessibilityIdentifier("itemform.note.body")
        }
    }

    @ViewBuilder
    private var totpRows: some View {
        Section("Code") {
            TextField("Secret (base32)", text: $totpFields.secret)
                .font(.system(.body, design: .monospaced))
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .accessibilityIdentifier("itemform.totp.secret")
            TextField("Issuer (optional)", text: $totpFields.issuer)
            Picker("Algorithm", selection: $totpFields.algorithm) {
                Text("SHA1").tag("SHA1")
                Text("SHA256").tag("SHA256")
                Text("SHA512").tag("SHA512")
            }
            Picker("Digits", selection: $totpFields.digits) {
                Text("6").tag(6)
                Text("7").tag(7)
                Text("8").tag(8)
            }
            .accessibilityIdentifier("itemform.totp.digits")
            Stepper("Period: \(totpFields.period)s", value: $totpFields.period, in: 15...120, step: 5)

            if let totpValidationError {
                Text(verbatim: totpValidationError.description)
                    .font(.footnote)
                    .foregroundStyle(Color("PVError"))
                    .accessibilityIdentifier("itemform.totp.error")
            }
        }
    }

    // MARK: - Folder

    @ViewBuilder
    private func folderSection(_ folderStore: FolderStore) -> some View {
        Section("Folder") {
            Button {
                showFolderPicker = true
            } label: {
                HStack {
                    Text("Folder")
                        .foregroundStyle(Color("PVTextPrimary"))
                    Spacer()
                    Text(verbatim: folderName(for: folderIdBinding.wrappedValue, in: folderStore))
                        .foregroundStyle(Color("PVTextMuted"))
                }
            }
            .accessibilityIdentifier("itemform.folder.picker")
        }
    }

    private func folderName(for id: String?, in folderStore: FolderStore) -> String {
        guard let id, let folder = folderStore.folders.first(where: { $0.id == id }) else {
            return "None"
        }
        return folder.name
    }

    // MARK: - Cross-type bindings (every *Fields struct carries these three)

    private var nameBinding: Binding<String> {
        switch kind {
        case .login: return $loginFields.name
        case .card: return $cardFields.name
        case .identity: return $identityFields.name
        case .note: return $noteFields.name
        case .totp: return $totpFields.name
        }
    }

    private var notesBinding: Binding<String> {
        switch kind {
        case .login: return $loginFields.notes
        case .card: return $cardFields.notes
        case .identity: return $identityFields.notes
        case .note: return .constant("") // NoteFields carries `body`, not `notes` -- deliberate asymmetry (ItemFields.swift header).
        case .totp: return $totpFields.notes
        }
    }

    private var folderIdBinding: Binding<String?> {
        switch kind {
        case .login: return $loginFields.folderId
        case .card: return $cardFields.folderId
        case .identity: return $identityFields.folderId
        case .note: return $noteFields.folderId
        case .totp: return $totpFields.folderId
        }
    }

    /// CR-02 (41-REVIEW.md): a URL typed with no scheme ("example.com") is a completely normal
    /// thing to type into this field -- prefix it with `https://` on save so the stored string
    /// carries an explicit scheme going forward, matching the same https-assumption
    /// `OriginNormalize` (Shared/) applies at BOTH the registrar and the fill-time matcher. This is
    /// belt-and-suspenders on top of that shared normalization (which already makes a scheme-less
    /// stored value fillable) -- storing a scheme explicitly means a future reader never has to
    /// re-derive the assumption at all. A value that already carries a scheme is left untouched.
    private static func normalizedLoginURL(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return trimmed }
        // WR-04 (41-REVIEW.md iteration 2): matches `OriginNormalize.components(fromURLString:)`'s
        // own corrected heuristic (Shared/OriginNormalize.swift -- see that file's own comment for
        // the full RFC-3986 rationale) -- `URL(string:).scheme == nil` alone is not evidence of "no
        // scheme": `example.com:8443`/`localhost:8765` parse a syntactically valid dotted-label
        // scheme with no authority, and this function's OWN duplicate of the old heuristic left
        // those exact strings untouched (never prefixed), so they were stored exactly as typed and
        // never became fillable even after OriginNormalize's own fix.
        let looksSchemeless = (URL(string: trimmed)?.scheme == nil)
            || (URL(string: trimmed)?.host == nil && !trimmed.contains("//"))
        guard looksSchemeless else { return trimmed }
        return "https://\(trimmed)"
    }

    /// The `ItemFields` this form currently represents, tags parsed from the
    /// comma-separated editor, folder id untouched (edited via the picker's
    /// own binding above).
    private var currentFields: ItemFields {
        let parsedTags = tagsText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        switch kind {
        case .login:
            var f = loginFields; f.tags = parsedTags
            f.urls = f.urls.map(Self.normalizedLoginURL)
            return .login(f)
        case .card:
            var f = cardFields; f.tags = parsedTags; return .card(f)
        case .identity:
            var f = identityFields; f.tags = parsedTags; return .identity(f)
        case .note:
            var f = noteFields; f.tags = parsedTags; return .note(f)
        case .totp:
            var f = totpFields; f.tags = parsedTags; return .totp(f)
        }
    }

    // MARK: - Save

    private func save() async {
        errorMessage = nil
        totpValidationError = nil

        if kind == .totp {
            if let validation = TotpValidation.validate(secretB32: totpFields.secret, digits: totpFields.digits) {
                totpValidationError = validation
                return
            }
        }

        var toSave = currentFields
        if case let .identity(f) = toSave {
            // SAVE half of the address round trip -- recompose the flat
            // `address` string from the structured fields. Skipping this
            // is the exact defect design-conformance names: an iOS save
            // that writes only the structured fields silently breaks
            // filling on desktop.
            toSave = .identity(IdentityAddress.withComposedLegacyAddress(f))
        }

        isSaving = true
        defer { isSaving = false }
        do {
            switch mode {
            case .create:
                let created = try await store.create(fields: toSave)
                onSaved?(created)
                dismiss()
            case let .edit(item):
                let updated = try await store.update(item, fields: toSave)
                onSaved?(updated)
                dismiss()
            }
        } catch VaultStoreError.lockedAfterServerWrite {
            // WR-02, split by WR-14 (38-REVIEW.md, iteration 4): the server
            // write already stands (nothing to undo, nothing to retry), but
            // the vault locked mid-flight -- do NOT call `onSaved`, which
            // would hand decrypted plaintext to a controller
            // (`root.selection`/`root.activeSheet`) that `lockTeardown` has
            // already reset, and do NOT surface an error banner for a save
            // that in fact succeeded. The screen is already being torn down
            // by `ContentView.performLock()`.
            dismiss()
        } catch VaultStoreError.locked {
            // WR-14 (38-REVIEW.md, iteration 4): the OPPOSITE case -- the
            // pre-flight guard means NOTHING was written, locally or on the
            // server. Before this split, both cases fell into the branch
            // above and this one silently discarded the user's typed item
            // with a plain `dismiss()` -- no error, no banner, no retry, in
            // a handler that read as "saved successfully". Keep the form up
            // and say so.
            errorMessage = VaultStoreError.locked.description
        } catch {
            errorMessage = String(describing: error)
        }
    }
}
