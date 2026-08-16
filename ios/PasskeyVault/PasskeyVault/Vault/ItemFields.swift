//
//  ItemFields.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-03 -- the FULL item model.
//  (38-02 seeded this file with the note type alone, for the tracer.)
//
//  DR-38-B (`ios/IOS-SPIKE-LOG.md` §1a): a HAND-WRITTEN MIRROR of
//  `packages/pv-ui/vault/types.ts`, which is the single source of truth for
//  the field model across every client. Not generated from `pv-ffi`, because
//  `crates/pv-core/src/items.rs` has no field model at all -- the payload
//  there is opaque `&[u8]`. The residual DR-38-B accepts is permanent drift;
//  `scripts/check-item-type-parity.sh` is its named guard and it fails when a
//  member is added on either side.
//
//  SIX types, not five (landmine L-15, `packages/pv-ui/vault/types.ts:4`).
//  The ROADMAP's SC2 and REQUIREMENTS' UI-03 both say five. Five is plausibly
//  the create/edit surface; six is the render surface -- and a user who
//  created a passkey in the browser extension has a sixth-type row in their
//  vault TODAY. A five-case decoder throws on it, and a decoder that silently
//  drops it is its own failure mode.
//
//  ASYMMETRY THAT IS DELIBERATE, transcribed rather than tidied:
//    * `note` carries `body` and NO `notes`. Every other type carries
//      `notes`. Confusing the two produces an item that round-trips on iOS
//      and renders blank everywhere else.
//    * `tags` is decoded as an OPTIONAL and coalesced to `[]`;
//      `name`/`folderId` are NOT defaulted. That is the TypeScript source's
//      own reasoning, quoted at `ItemNormalize.swift`: `tags` is the one
//      member the rest of the client DEREFERENCES, so its absence throws
//      where the others merely render oddly. Defaulting the others would be
//      speculative rather than corrective.
//    * `passkey`'s on-disk plaintext has no `type`, `name`, `folderId` or
//      `tags` at all -- it is `pv-provider`'s `SerializablePasskey` mirror,
//      snake_case, with byte fields as JSON number arrays.
//      `ItemNormalize.swift` is the one place that shape is recognized.
//

import Foundation

// MARK: - Common fields
//
// `CommonFields` in the TypeScript is an `interface` the per-type interfaces
// EXTEND, which Swift structs cannot do. Each per-type struct therefore
// declares the three members itself. That is the mirror being faithful, not
// duplication by accident: an inherited-property mechanism (a protocol with
// a default implementation, a shared base class) would put the three members
// somewhere the parity script and the notes/body greps could not see them.

// MARK: - Per-type field structs

struct LoginFields: Codable, Equatable, Hashable {
    var name: String
    var folderId: String?
    var tags: [String]
    var username: String
    var password: String
    /// Multiple URLs per login. A legacy single `url: String` shape still
    /// exists in previously-encrypted items; `ItemNormalize` is the sole
    /// place that shape is ever read again.
    var urls: [String]
    var notes: String
}

struct CardFields: Codable, Equatable, Hashable {
    var name: String
    var folderId: String?
    var tags: [String]
    var cardholderName: String
    var number: String
    var expiry: String
    var cvv: String
    /// Additive-only optionals -- items written before they existed decode
    /// and re-encode fine.
    var pin: String?
    var zip: String?
    var notes: String
}

struct IdentityFields: Codable, Equatable, Hashable {
    var name: String
    var folderId: String?
    var tags: [String]
    var firstName: String
    var lastName: String
    var email: String
    var phone: String
    /// The LEGACY FLAT address string, and it is the source of truth the
    /// extension's autofill reads and writes (it fills one
    /// `street-address`-style input). The structured fields below are
    /// additive; `IdentityAddress.swift` owns the round trip that keeps the
    /// two in sync. Reproducing only half of that round trip destroys
    /// addresses for extension users.
    var address: String
    var addressLine1: String?
    var addressLine2: String?
    var city: String?
    var state: String?
    var zip: String?
    var country: String?
    var notes: String
}

struct NoteFields: Codable, Equatable, Hashable {
    var name: String
    var folderId: String?
    var tags: [String]
    /// `body`, and there is deliberately NO `notes` on this type.
    var body: String
}

/// RFC 6238 defaults (SHA1 / 6 digits / 30s) are applied by whichever source
/// format produced the item, not here -- these arrive already resolved.
struct TotpFields: Codable, Equatable, Hashable {
    var name: String
    var folderId: String?
    var tags: [String]
    /// base32, required.
    var secret: String
    /// `""` when absent.
    var issuer: String
    var algorithm: String
    var digits: Int
    var period: Int
    var notes: String
}

/// Provider-created passkey credential (Phase 12, the extension).
///
/// This is the NORMALIZED, camelCased view. The on-disk plaintext is
/// `pv-provider`'s `SerializablePasskey` (`crates/pv-provider/src/
/// credential_store.rs`) with no discriminant and no common fields at all;
/// `ItemNormalize.swift` recognizes it by shape. `rawPasskeyJson` retains the
/// FULL original wire JSON, including `key_cbor`, `counter` and
/// `extensions.hmac_secret`, which this view intentionally does not surface.
struct PasskeyFields: Codable, Equatable, Hashable {
    var name: String
    var folderId: String?
    var tags: [String]
    var rpId: String
    /// base64url, no padding -- byte-matches a WebAuthn response's `id`/
    /// `rawId`, so it can be string-compared with what the extension shows.
    var credentialId: String
    var username: String?
    var userDisplayName: String?
    var rawPasskeyJson: String
}

// MARK: - The discriminated union

/// The six-member union. Deliberately ONE enum carrying associated values
/// rather than a separate `ItemType` enum plus a payload — a second enum
/// would be a second place the six names are written, i.e. a second place
/// they can drift, and `scripts/check-item-type-parity.sh` reads this
/// declaration.
enum ItemFields: Equatable, Hashable {
    case login(LoginFields)
    case card(CardFields)
    case identity(IdentityFields)
    case note(NoteFields)
    case totp(TotpFields)
    case passkey(PasskeyFields)

    /// The wire discriminant, spelled exactly as the TypeScript union spells
    /// it. Used for the `type` key when re-encoding.
    var typeName: String {
        switch self {
        case .login: return "login"
        case .card: return "card"
        case .identity: return "identity"
        case .note: return "note"
        case .totp: return "totp"
        case .passkey: return "passkey"
        }
    }

    var name: String {
        switch self {
        case let .login(f): return f.name
        case let .card(f): return f.name
        case let .identity(f): return f.name
        case let .note(f): return f.name
        case let .totp(f): return f.name
        case let .passkey(f): return f.name
        }
    }

    var tags: [String] {
        switch self {
        case let .login(f): return f.tags
        case let .card(f): return f.tags
        case let .identity(f): return f.tags
        case let .note(f): return f.tags
        case let .totp(f): return f.tags
        case let .passkey(f): return f.tags
        }
    }

    var folderId: String? {
        switch self {
        case let .login(f): return f.folderId
        case let .card(f): return f.folderId
        case let .identity(f): return f.folderId
        case let .note(f): return f.folderId
        case let .totp(f): return f.folderId
        case let .passkey(f): return f.folderId
        }
    }
}

// MARK: - The item envelope

/// One item as the UI consumes it. The optional members are metadata the
/// server supplies or the store synthesizes; each carries load-bearing
/// semantics transcribed from `packages/pv-ui/vault/types.ts`'s `VaultItem`.
struct VaultItemViewModel: Identifiable, Equatable, Hashable {
    let id: String
    let revision: Int
    let content: Content

    /// Server-truthful last-update timestamp.
    var updatedAt: String?

    /// Set only by a successful `POST .../touch`, never by create/update/
    /// list. `nil` means "never used" and SINKS the row to the bottom of a
    /// last-used-descending sort -- it does not mean "used long ago".
    var lastUsedAt: String?

    /// Server metadata: collection-scoped, or a personal item with at least
    /// one direct-share grant.
    var isShared: Bool?
    var lastEditorEmail: String?
    var collectionId: String?

    /// `true` ONLY for a personal item owned by SOMEONE ELSE and shared
    /// directly to this caller. Not inferable from `isShared` +
    /// `collectionId`: that combination is also exactly the shape of "an item
    /// I share with others".
    var sharedToMe: Bool?

    /// The caller's own effective access level, as a RAW UNNORMALIZED
    /// STRING. `nil` means "the caller owns this item outright", NOT
    /// "unknown, assume the worst". See `ItemCapabilities.swift` for why this
    /// is not an enum and never an ordering.
    var accessLevel: String?

    enum Content: Equatable, Hashable {
        case fields(ItemFields)

        /// A retained LAST-KNOWN-GOOD copy whose latest server row failed to
        /// decrypt. Its `revision` is known STALE, so no save path may use it
        /// as the expected revision (T-38-03-05; enforced in 38-09, where
        /// saving exists). Distinct from `pendingFamilyKey` on purpose:
        /// this one is a genuine integrity signal and keeps its alarming
        /// treatment.
        case undecryptable(reason: String)

        /// A SYNTHETIC placeholder for a family-wide collection the caller is
        /// entitled to but holds no key for yet. Never derived from a caught
        /// decrypt exception, and never folded into `undecryptable` --
        /// folding either way would dress a real failure up as a calm wait,
        /// or alarm a newcomer about a perfectly normal one.
        ///
        /// **A row in this state has NO fields by construction.** Nothing may
        /// force-unwrap or subscript its field set.
        case pendingFamilyKey
    }

    var fields: ItemFields? {
        if case let .fields(f) = content { return f }
        return nil
    }

    /// Safe on every case, including the two that have no fields at all.
    var displayName: String {
        switch content {
        case let .fields(f): return f.name
        case .undecryptable: return "Unreadable item"
        case .pendingFamilyKey: return "Waiting for the family key"
        }
    }

    /// Safe on every case. `pendingFamilyKey` and `undecryptable` rows
    /// contribute nothing to the tag union rather than trapping.
    var tags: [String] {
        fields?.tags ?? []
    }

    var isUndecryptable: Bool {
        if case .undecryptable = content { return true }
        return false
    }

    var isPendingFamilyKey: Bool {
        if case .pendingFamilyKey = content { return true }
        return false
    }

    init(
        id: String,
        revision: Int,
        content: Content,
        updatedAt: String? = nil,
        lastUsedAt: String? = nil,
        isShared: Bool? = nil,
        lastEditorEmail: String? = nil,
        collectionId: String? = nil,
        sharedToMe: Bool? = nil,
        accessLevel: String? = nil
    ) {
        self.id = id
        self.revision = revision
        self.content = content
        self.updatedAt = updatedAt
        self.lastUsedAt = lastUsedAt
        self.isShared = isShared
        self.lastEditorEmail = lastEditorEmail
        self.collectionId = collectionId
        self.sharedToMe = sharedToMe
        self.accessLevel = accessLevel
    }
}
