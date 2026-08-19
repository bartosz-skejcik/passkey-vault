//
//  ShareMarker.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-05, Task 1.
//  The THREE-WAY ORDERED discrimination `web/src/components/vault/
//  ItemRow.tsx` renders (`git show main:web/src/components/vault/
//  ItemRow.tsx`, the marker block, ~lines 268-288): received-from-other
//  FIRST, then family-wide, then outgoing, else nothing. Order is not
//  cosmetic -- an item that is BOTH received and sits in a family-wide
//  collection is the RECEIVER's own item as far as this caller is
//  concerned (they hold neither the family Collection Key's ownership nor
//  any outgoing grant on it), so `.receivedFromOther` must win.
//
//  CR-02 (code review, Phase 26, ported into this codebase's own history by
//  `packages/pv-ui/vault/types.ts:150-215`): an item shared TO this caller
//  (`sharedToMe`) is NOT an outgoing share. Before that field existed, a row
//  ingested from `pull_shared_direct` (`GET /api/sync/shared/direct`) was
//  byte-identical in shape (`isShared: true`, `collectionId: null`) to an
//  item this caller shares WITH others -- the Sharing overview counted
//  received items as outgoing and attributed their other recipients to the
//  caller. `sharedToMe` exists so this file never has to reconstruct that
//  distinction from `isShared`/`collectionId` -- see `ShareMarkerInput`'s
//  own doc comment for why the distinction is PROVENANCE, set exclusively
//  by `SharedItemsStore` at ingestion time, and never recomputed here.
//

import Foundation

/// The facts `ShareMarker.of(item:)` decides on -- every one of them
/// resolved by `SharedItemsStore` AT INGESTION TIME, from which endpoint
/// answered, never derived from the item's own ciphertext-adjacent
/// metadata by this file. `ShareMarker.of` is a PURE function over this
/// protocol precisely so a test can build a minimal literal fixture
/// (`struct Fixture: ShareMarkerInput { ... }`) without constructing a full
/// `VaultItemViewModel`/live decrypt.
///
/// `VaultItemViewModel` conforms via the extension at the bottom of this
/// file -- ONE conformance site, so the three facts below can never drift
/// from that type's own stored properties.
protocol ShareMarkerInput {
    /// PROVENANCE, not a field computation: `true` if and only if this row
    /// was ingested through `SharedItemsStore.ingestDirectShared` (`GET
    /// /api/sync/shared/direct`). MUST NEVER be computed from `isShared`/
    /// `collectionId` -- that combination is also exactly the shape of "an
    /// item this caller shares with others" (CR-02; this file's header).
    /// `Bool?`, matching `VaultItemViewModel.sharedToMe`'s own optional
    /// shape -- `nil` and `false` are equivalent to `ShareMarker.of`.
    var sharedToMe: Bool? { get }

    /// `true` if and only if this row's `collectionId` was resolved, at
    /// ingestion time, against a collection whose `family_wide_kind` is
    /// non-nil (mirrors `web/src/lib/vault/collections.ts`'s
    /// `isFamilyWideCollection`). Set by `SharedItemsStore`, never
    /// recomputed from `isShared` alone. Non-optional -- `SharedItemsStore`
    /// always resolves this explicitly, never leaves it ambiguous.
    var isFamilyWide: Bool { get }

    /// Server metadata mirroring `is_shared`: a collection-scoped item, or a
    /// personal item with at least one outgoing `item_shares` grant. `Bool?`,
    /// matching `VaultItemViewModel.isShared`'s own optional shape.
    var isShared: Bool? { get }
}

/// The three-way marker (plus "no marker at all"), decided by
/// `ShareMarker.of(item:)`'s ordered branch -- see this file's header for
/// why the order is load-bearing, not incidental.
enum ShareMarker: Equatable {
    /// This item was shared TO the caller by someone else. Placed FIRST in
    /// the branch order -- see this file's header.
    case receivedFromOther
    /// This item lives in a family-wide collection the caller did not
    /// receive directly (i.e. `sharedToMe == false`). A single badge, never
    /// a per-recipient stack -- 30-11/FSH-01's locked decision: "a
    /// five-person family rendered as five avatars is indistinguishable
    /// from five separate per-person shares."
    case familyWide
    /// The caller is the one sharing this item outward (`isShared == true`,
    /// not received, not family-wide).
    case sharedByMe
    /// A purely personal item -- no marker.
    case none

    /// THE ordered three-way discrimination. Mirrors `ItemRow.tsx`'s branch
    /// order exactly: `sharedToMe` first, `isFamilyWideCollection` second,
    /// `isShared` third, else nothing.
    ///
    /// Order matters, demonstrated by this file's own test suite
    /// (`ShareMarkerTests.receivedBranchWinsOverFamilyWideWhenBothAreTrue`):
    /// a row that is BOTH `sharedToMe` and `isFamilyWide` resolves to
    /// `.receivedFromOther`, because that branch is evaluated first.
    static func of(item: ShareMarkerInput) -> ShareMarker {
        if item.sharedToMe == true {
            return .receivedFromOther
        } else if item.isFamilyWide {
            return .familyWide
        } else if item.isShared == true {
            return .sharedByMe
        } else {
            return .none
        }
    }

    /// Verbatim, ported literals -- `40-UI-SPEC.md` §6's Copywriting
    /// Contract, itself ported from `web/src/lib/i18n/dictionary.ts`. NEVER
    /// paraphrased; a future reader changing display copy should change it
    /// here, not invent a second string at a call site.
    ///
    /// `.sharedByMe`'s count is injected by the caller (`sharing
    /// .sharedWithLabel`'s `{count}` interpolation) -- this property alone
    /// cannot know how many recipients a row has, so it returns the
    /// UNINTERPOLATED dictionary string; `accessibilityLabel(count:)` below
    /// is the interpolated form callers should actually render.
    var dictionaryLabel: String {
        switch self {
        case .receivedFromOther:
            // `sharing.sharedWithYouLabel`
            return "Shared with you"
        case .familyWide:
            // `vault.familyBadgeAria`
            return "Shared with the whole family"
        case .sharedByMe:
            // `sharing.sharedWithLabel`, uninterpolated
            return "Shared with {count}"
        case .none:
            return ""
        }
    }

    /// The interpolated accessibility label a list row actually renders.
    /// `count` is ignored for every case except `.sharedByMe` -- the other
    /// two markers carry no count in their own dictionary string.
    func accessibilityLabel(count: Int = 0) -> String {
        switch self {
        case .sharedByMe:
            return "Shared with \(count)"
        default:
            return dictionaryLabel
        }
    }

    /// The compact PILL text `40-UI-SPEC.md` §5.8 draws -- deliberately
    /// DIFFERENT from `accessibilityLabel`, matching the drawing's own
    /// pill/aria split (a short glanceable pill, a fuller announced
    /// label). `.receivedFromOther` and `.familyWide` render as a
    /// pill+glyph pair the caller composes from `dictionaryLabel`/a system
    /// image (`Share2`/`Users`-equivalent SF Symbol) -- this property is
    /// meaningful for `.sharedByMe` only, where the count IS the pill.
    func pillText(count: Int) -> String {
        "Shared · \(count)"
    }
}

/// ONE conformance site (this file's header). `VaultItemViewModel` already
/// carries `sharedToMe`/`isShared`/`isFamilyWide` as stored properties
/// (`ItemFields.swift`) -- no computed shim needed here.
extension VaultItemViewModel: ShareMarkerInput {}
