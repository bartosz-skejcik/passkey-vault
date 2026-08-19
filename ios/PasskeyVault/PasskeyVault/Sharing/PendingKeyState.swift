//
//  PendingKeyState.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-05, Task 2.
//  The not-yet-delivered state for a family-wide collection the caller is
//  entitled to but holds no key for yet -- and its structurally-impossible-
//  to-leave-behind pruning.
//
//  `crates/pv-server/src/routes/families.rs:355-438`'s `family_wide_pending`
//  answers two questions: `missing` (family-wide collections the CALLER
//  holds no `collection_keys` row for) and `resealable` (member-collection
//  pairs the caller COULD reseal a key for -- plan 40-09's job, not this
//  file's).
//
//  RECORDED PRECEDENT (`.planning/STATE.md` Blockers/Concerns; the
//  extension's own unpruned pending array): an entry marked broken and
//  never pruned when the row later disappears from a snapshot leaves a
//  PERMANENT failure row until the next lock. `applyFamilyWidePending`
//  below rebuilds the awaiting-key set BY REPLACEMENT on every call -- an
//  id absent from the new response is gone BY CONSTRUCTION, not by a
//  remembered `remove` call this file could forget to make. That is the
//  design choice that makes the phantom-row defect structurally
//  impossible, not merely tested-against.
//
//  Two DISTINCT terminal states, never conflated (this plan's own
//  must-have): `.awaitingKey` (the key has not arrived -- normal, calm,
//  invites waiting) and `.decryptFailed` (the key IS present but the
//  decrypt failed anyway -- a genuine integrity signal, terminal, must NOT
//  invite waiting for something that will never arrive). `decryptFailed`
//  entries are NEVER touched by `applyFamilyWidePending`'s replacement --
//  that call only rebuilds the awaiting-key axis; a collection can only
//  reach `.decryptFailed` via `markDecryptFailed`, called by whatever
//  later plan actually attempts the decrypt with a key this file confirms
//  is present (`awaitingKey.contains(collectionId) == false` at that
//  point).
//

import Foundation
import Observation

/// One row of `family_wide_pending`'s `missing` array
/// (`crates/pv-server/src/routes/families.rs`'s `PendingGrant`).
/// Deliberately ids/kind/access_level only -- no ciphertext field exists on
/// the server type to leak, and none is added here.
struct PendingGrantRow: Decodable, Equatable {
    let collection_id: String
    let kind: String
    let access_level: String?
}

/// One row of `family_wide_pending`'s `resealable` array
/// (`crates/pv-server/src/routes/families.rs`'s `ResealableGrant`). Not
/// consumed by this file -- plan 40-09's Path B proof asserts against
/// `PendingKeyState`'s `awaitingKey` axis, and reseal-side consumption of
/// `resealable` is that plan's own job. Decoded here anyway so
/// `FamilyWidePendingResponseBody` can decode the WHOLE response in one
/// shot, matching the server's actual wire shape.
struct ResealableGrantRow: Decodable, Equatable {
    let collection_id: String
    let recipient_user_id: String
}

/// `GET /api/families/family-wide-pending`'s full response body.
struct FamilyWidePendingResponseBody: Decodable {
    let missing: [PendingGrantRow]
    let resealable: [ResealableGrantRow]
}

/// The two distinct terminal states a family-wide collection can carry
/// (this file's header) -- never the same case, never folded together.
enum PendingKeyReason: Equatable {
    /// The key has not arrived yet. Normal, calm, invites waiting --
    /// "Nothing is wrong" (Phase 38's own placeholder wording, kept as the
    /// tone this state renders in even though its literal copy is
    /// replaced -- see `40-UI-SPEC.md` §5.9).
    case awaitingKey
    /// The key IS present, but the decrypt failed anyway -- a genuine
    /// integrity signal. `reason` carries the underlying error description,
    /// same discipline as `VaultItemViewModel.Content.undecryptable`.
    case decryptFailed(reason: String)
}

/// Copy for the two states -- see this file's header on porting discipline.
/// `40-UI-SPEC.md` §6: the list-row and detail-panel awaiting-key strings
/// are ported VERBATIM from `share.pendingFamilyKeyNote`/
/// `.pendingFamilyKeyNoteDetail` (list row: NEW, iOS-only, no dictionary
/// key exists for the compact pill -- `screens-vault.html`'s own caption
/// says so). `.decryptFailed`'s copy has NO existing dictionary
/// equivalent (checked: no `dictionary.ts` key describes "key present,
/// decrypt failed anyway" for a collection-scoped row) -- both strings
/// below are therefore NEW, added here rather than invented silently at a
/// call site, and named as such in this plan's own SUMMARY.
enum PendingKeyCopy {
    /// The compact list-row pill text. NEW, iOS-only (`40-UI-SPEC.md` §5.8's
    /// own note: "the web app has no row-level equivalent today").
    static let awaitingKeyListPill = "Key pending"

    /// Ported verbatim: `share.pendingFamilyKeyNote`.
    static let awaitingKeyDetailTitle =
        "This is shared with the whole family, but your key hasn't arrived yet."
    /// Ported verbatim: `share.pendingFamilyKeyNoteDetail`.
    static let awaitingKeyDetailBody =
        "It will appear automatically once another family member opens the app -- there's nothing you need to do."

    /// NEW -- no dictionary equivalent (this file's header). Terminal,
    /// deliberately does NOT say "wait" or "arrive" anywhere in it.
    static let decryptFailedListPill = "Can't be read"
    /// NEW -- no dictionary equivalent. Distinguishes this from the
    /// awaiting-key state explicitly, so a reader who saw both cannot
    /// mistake one for the other.
    static let decryptFailedDetailTitle = "This item can't be read."
    /// NEW -- no dictionary equivalent. Deliberately avoids "arrive"/"wait"
    /// -- this state is the opposite of awaiting-key and must not read like
    /// a variant of it.
    static let decryptFailedDetailBody =
        "Your key for this collection is present, but this item's data did not decrypt with it. " +
        "This is different from a missing key -- leaving the app open will not resolve it."
}

/// The not-yet-delivered state store (this file's header). `@Observable`,
/// matching `VaultStore`/`FolderStore`'s own discipline -- a SwiftUI list
/// reads `awaitingKey`/`decryptFailed` directly.
@MainActor
@Observable
final class PendingKeyState {
    /// The awaiting-key axis, rebuilt BY REPLACEMENT on every
    /// `applyFamilyWidePending` call -- see this file's header for why
    /// replacement, not a remembered removal, is the load-bearing choice.
    private(set) var awaitingKey: Set<String> = []

    /// The decrypt-failed axis. NEVER touched by `applyFamilyWidePending`'s
    /// replacement -- a collection reaches this dictionary only via
    /// `markDecryptFailed`, called by whatever later plan attempts the
    /// decrypt.
    private(set) var decryptFailed: [String: String] = [:]

    /// Rebuilds `awaitingKey` from a `family_wide_pending` response's
    /// `missing` array, by REPLACEMENT: `awaitingKey` becomes EXACTLY the
    /// set of `collection_id`s in `missing` -- an id absent from `missing`
    /// this round is gone from `awaitingKey` after this call returns,
    /// structurally, not because anything remembered to remove it.
    func applyFamilyWidePending(missing: [PendingGrantRow]) {
        awaitingKey = Set(missing.map(\.collection_id))
    }

    /// Marks `collectionId` decrypt-failed -- a DISTINCT, terminal state
    /// from awaiting-key (this file's header). Also clears any stale
    /// awaiting-key membership for the same id: a decrypt attempt only
    /// happens once the key IS present, so by the time this is called the
    /// collection can no longer be "waiting for a key that hasn't arrived".
    func markDecryptFailed(collectionId: String, reason: String) {
        decryptFailed[collectionId] = reason
        awaitingKey.remove(collectionId)
    }

    /// CR-04/WR-10 (40-REVIEW.md): clears BOTH axes -- called on lock
    /// (`VaultStore.lock()`), mirroring that type's own "empties EVERY
    /// array/map" discipline (WR-08, 39-REVIEW.md). A stale `.decryptFailed`
    /// or `.awaitingKey` entry surviving a lock would otherwise describe a
    /// collection this store no longer holds any row for at all.
    func reset() {
        awaitingKey = []
        decryptFailed = [:]
    }

    /// The resolved state for one collection id, or `nil` when neither axis
    /// carries it (a normal, readable row). `.decryptFailed` takes priority
    /// over `.awaitingKey` if a caller somehow queries during the single
    /// update where both could theoretically be true -- in practice
    /// `markDecryptFailed` already clears `awaitingKey` for the same id, so
    /// this ordering is defense-in-depth, not a load-bearing branch.
    func state(for collectionId: String) -> PendingKeyReason? {
        if let reason = decryptFailed[collectionId] {
            return .decryptFailed(reason: reason)
        }
        if awaitingKey.contains(collectionId) {
            return .awaitingKey
        }
        return nil
    }
}
