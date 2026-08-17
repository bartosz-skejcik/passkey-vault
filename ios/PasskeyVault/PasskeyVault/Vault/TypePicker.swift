//
//  TypePicker.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-09, Task 1. The CREATE-only
//  type picker: `ItemCreationKind` (moved here verbatim from
//  `ItemListView.swift`'s 38-06 draft, same five cases, same reasoning) plus
//  the picker VIEW design-conformance's own §5 requires ("the type picker
//  is editable only on create"). `ItemFormView` never re-presents this
//  picker for an existing item -- changing an existing item's type would
//  orphan its fields (a login's `password` has nowhere to go in a note).
//
//  FIVE creatable types, not six -- `passkey` is provider-created only
//  (Phase 12, the extension/AutoFill path); there is no "create a passkey"
//  form on any client, matching the research doc's reconciling reading
//  (five is the create/edit surface, six is the render surface) and
//  design-conformance §5.
//

import SwiftUI

/// FIVE creatable types. `scripts/check-item-type-parity.sh`'s own six-member
/// union (`ItemFields.swift`) is the render surface; this is the narrower
/// create surface and is intentionally NOT required to match it 1:1.
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

/// The create-only picker, a grid of exactly five tiles. `onSelect` fires
/// once per tap; the caller (`ItemListView`'s "+" menu today) is responsible
/// for presenting `ItemFormView(mode: .create(kind))` next.
struct TypePicker: View {
    var onSelect: (ItemCreationKind) -> Void

    private let columns = [GridItem(.adaptive(minimum: 100), spacing: 12)]

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(ItemCreationKind.allCases, id: \.self) { kind in
                        Button {
                            onSelect(kind)
                        } label: {
                            VStack(spacing: 8) {
                                Image(systemName: kind.systemImage)
                                    .font(.title2)
                                    .foregroundStyle(Color("PVAccent"))
                                Text(verbatim: kind.title)
                                    .font(.footnote.weight(.medium))
                                    .foregroundStyle(Color("PVTextPrimary"))
                            }
                            .frame(maxWidth: .infinity, minHeight: 80)
                            .background(Color("PVSurfaceAlt"), in: RoundedRectangle(cornerRadius: 12))
                        }
                        .accessibilityIdentifier("typepicker.\(kind.title)")
                    }
                }
                .padding()
            }
            .navigationTitle("New item")
            .navigationBarTitleDisplayMode(.inline)
        }
        .presentationDetents([.medium])
        .accessibilityIdentifier("typepicker.grid")
    }
}
