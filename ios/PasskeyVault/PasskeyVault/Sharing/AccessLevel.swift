//
//  AccessLevel.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-08, Task 1.
//  Ported from `web/src/lib/families/accessLevel.ts` (`git show
//  main:web/src/lib/families/accessLevel.ts`) and `crates/pv-server/src/
//  routes/membership.rs`'s own `AccessLevel`/`combine_access` -- the closed,
//  three-value wire vocabulary, its fail-closed unknown case (WR-13/WR-10),
//  and the rank ordering used ONLY to combine two independent grants for the
//  same item, never to decide edit capability.
//
//  `40-UI-SPEC.md` §0.2 (binding, orchestrator resolution): this type is
//  net-new (no naming collision with the shipped `Vault/ItemCapabilities.swift`)
//  and stays here. `Vault/ItemCapabilities.swift` is EXTENDED, not
//  duplicated, to route its `canEditItem(_:)`/`isPasswordHidden(_:)`
//  predicates through this enum internally -- see that file's own header.
//
//  Deliberately does NOT derive `Comparable`/`Ord` -- exactly the same
//  discipline `membership.rs`'s own `AccessLevel` states for itself: a
//  derived ordering would make `.hiddenPassword` compare as "good enough,
//  it's more than read" for every purpose, which is precisely the
//  Vaultwarden #6269 bug class. `combine(_:_:)` below is the ONLY place a
//  rank is consulted, and it is a private, purpose-built comparison, never
//  an `Ord`/`<`/`>` operator a future refactor could accidentally reuse for
//  an edit decision.
//

import Foundation

/// The caller's own effective access level for an item, as a closed,
/// four-case Swift type over the server's three-value wire vocabulary
/// (`"read"` / `"edit"` / `"hidden_password"`) plus a fail-closed unknown
/// case carrying the unrecognised raw string.
///
/// This type is a RENDERING/DECISION aid over `VaultItemViewModel
/// .accessLevel: String?` -- it does not replace that field (server call
/// sites, sync ingestion and `ShareMarker.swift` all read the raw string
/// today, and `accessLevel == nil` carries its own separate "the caller owns
/// this item outright" meaning that `AccessLevel`'s parser is never asked to
/// resolve -- see `ItemCapabilities.swift`'s own header).
enum AccessLevel: Equatable, Hashable {
    case read
    case hiddenPassword
    case fullEdit
    /// WR-13/WR-10 (`accessLevel.ts`'s own header, ported verbatim in
    /// substance): an unrecognised wire value must NEVER be normalized into
    /// one of the three known cases, and -- the corrected half of WR-10 --
    /// must NEVER fall back to the LEAST-privileged label either. Telling a
    /// user an item is less exposed than it actually is is the exact wrong
    /// direction for a safe default; a neutral "unknown" label that grants
    /// nothing is the only fail-closed choice. The raw string is retained
    /// (never discarded) so a caller that wants to log/report the
    /// unexpected value still can.
    case unknown(String)

    /// Parses the server's own `access_level` wire vocabulary
    /// (`crates/pv-server/src/routes/membership.rs::parse_access_level`'s
    /// three literal arms). Every one of the three known strings yields its
    /// own case; every other string -- including a case/whitespace
    /// variation of a known value -- yields `.unknown`, unnormalized.
    init(wireValue: String) {
        switch wireValue {
        case "read": self = .read
        case "hidden_password": self = .hiddenPassword
        case "edit": self = .fullEdit
        default: self = .unknown(wireValue)
        }
    }

    /// `access.readOnly` / `access.fullEdit` / `access.hiddenPassword` /
    /// `access.unknown`, Polish -- `web/src/lib/i18n/dictionary.ts`,
    /// verbatim, matching this app's own shipped language for its Phase 40
    /// screens (`InviteCreateView.swift`'s own precedent). The unknown case
    /// renders `access.unknown`'s neutral label, NEVER `access.readOnly`'s
    /// reassuring one -- the specific mistake WR-10's corrected comment
    /// exists to prevent.
    var label: String {
        switch self {
        case .read: return "Tylko odczyt"
        case .fullEdit: return "Pełna edycja"
        case .hiddenPassword: return "Ukryte hasło"
        case .unknown: return "Nieznany poziom dostępu"
        }
    }

    /// The EXACT inverse of `init(wireValue:)` for the three known cases --
    /// `.unknown`'s own carried raw string for the fourth. Never used to
    /// decide capability; only to echo a level back onto the wire (mirrors
    /// `membership.rs`'s own `AccessLevel::as_str`).
    var wireValue: String {
        switch self {
        case .read: return "read"
        case .fullEdit: return "edit"
        case .hiddenPassword: return "hidden_password"
        case let .unknown(raw): return raw
        }
    }

    /// Edit capability: an EXACT match against `.fullEdit`, never a rank
    /// comparison. `.hiddenPassword` ranks strictly between `.read` and
    /// `.fullEdit` for `combine(_:_:)`'s own purpose below, and treating
    /// that rank as "good enough for edit" is the Vaultwarden #6269 bug
    /// class `membership.rs`'s `RequireEdit::satisfied_by` explicitly
    /// refuses to derive from an ordering. `.unknown` is never `.fullEdit`
    /// by construction, so it fails closed here for free -- no separate
    /// case is needed in this `switch`.
    var grantsEdit: Bool {
        self == .fullEdit
    }

    /// Fail-closed read grant: every KNOWN level implies "the caller may
    /// see this item at all" (the server would not have resolved an
    /// `AccessLevel` to hand back otherwise); `.unknown` grants nothing --
    /// "not read, not edit" (this plan's own `must_haves.truths`).
    var grantsRead: Bool {
        switch self {
        case .read, .hiddenPassword, .fullEdit: return true
        case .unknown: return false
        }
    }

    /// `membership.rs::combine_access`'s rank -- `read=0, hiddenPassword=1,
    /// fullEdit=2` -- ONLY for `combine(_:_:)`'s max-of-two-grants purpose.
    /// `.unknown` ranks BELOW every known level (never above): combining an
    /// unknown grant with a known one keeps the known one, the fail-closed
    /// choice for a value this client does not understand. Private and
    /// deliberately not exposed as `Comparable` conformance -- see this
    /// file's own header.
    private var combineRank: Int {
        switch self {
        case .unknown: return -1
        case .read: return 0
        case .hiddenPassword: return 1
        case .fullEdit: return 2
        }
    }

    /// Combines two independent grants for the SAME item (e.g. a caller
    /// reachable both via a shared folder's collection membership AND a
    /// direct item share) into the higher-ranked of the two -- mirrors
    /// `membership.rs::combine_access`'s two-`Option` shape collapsed to
    /// its two-value case, since both grants are already known to exist on
    /// the iOS side by the time this is called. Ties (`a == b`, or two
    /// distinct `.unknown` values) resolve to `a` -- `>=`, not `>`, exactly
    /// matching the server's own `if rank(x) >= rank(y) { x } else { y }`.
    static func combine(_ a: AccessLevel, _ b: AccessLevel) -> AccessLevel {
        a.combineRank >= b.combineRank ? a : b
    }
}
