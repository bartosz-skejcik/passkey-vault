//
//  ShareItemView.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-08 --
//  `40-UI-SPEC.md` §0.3/§5.7 (BINDING SCOPE ADDITION, orchestrator
//  resolution 2026-08-19): "this plan's executor ALSO owns the Share-an-item
//  authoring sheet ... as an explicit scope addition -- the sheet is the
//  level-picker's only real surface; without it SC3's copy check has
//  nothing to screenshot."
//
//  Controls, per the drawing (`ios/brand/screens-vault.html`, "Share an
//  item" sheet) and §5.7's own table: a Person/Whole-family
//  `PVSegmentedControl`, a person picker (checkmark rows), a 3-way access
//  `PVSegmentedControl` (Read-only / Full edit / Hidden password), the
//  hidden-password disclosure (`StatusCallout(tone: .warning)`, ported
//  VERBATIM from `HiddenPasswordDisclosure.swift` -- SC3's copy check),
//  a muted revocation note, and a primary CTA.
//
//  §0.3's own resolution marked this screen SPECIFIED-BUT-NOT-SCHEDULED for
//  the 10 plans written before the drawing existed. CR-04 (40-REVIEW.md,
//  REVIEW-FIX) is what actually wired the navigation: `ItemDetailView`'s
//  toolbar and `ItemListView`'s context menu both present this view via
//  `Sharing/ShareItemPresenter.swift` (which resolves the two prerequisites
//  this view needs but cannot synchronously have -- the roster and the
//  item's raw `encKeyJson`), reached from a real `VaultActiveSheet
//  .sharingItem` case, gated by `ItemCapabilities.canShowShareAffordance(_:)`.
//  This view's own crypto and UI are unchanged by that fix -- production
//  wiring only.
//
//  WHOLE-FAMILY SCOPE, documented judgment call: this view shares to every
//  CURRENTLY active family member individually via the SAME
//  `POST /api/vault/items/{id}/shares` person-share endpoint
//  (`ShareItemComposer.recipients(for:.wholeFamily,...)`), rather than
//  moving the item into a family-wide `Collection` (`CollectionService
//  .createFamilyWideCollection`'s propagate-to-future-members semantics).
//  Building the latter would require re-encrypting the item under a fresh
//  Collection Key and wiring `PUT /api/vault/items/{id}/collection`
//  (`move_item`) -- real crypto work with no test coverage anywhere in this
//  plan's own `must_haves`/`threat_model`, and genuinely out of scope for
//  "make the three access levels real and prove the hidden-password
//  honesty claim". A future member added after this share will NOT
//  automatically gain access under this simplification -- recorded here,
//  not silently dropped, per this project's own "true in the artifact,
//  false in reality" discipline.
//

import SwiftUI

/// `.seg` scope toggle -- "Person" / "Whole family" (§5.7's own table).
enum ShareScope: String, CaseIterable, Identifiable {
    case person
    case wholeFamily

    var id: String { rawValue }

    /// Polish, matching this app's established Phase 40 screen language
    /// (`InviteCreateView.swift`'s own precedent) -- no exact
    /// `dictionary.ts` key exists for this iOS-native toggle (the web app's
    /// own share dialog does not draw this as a segmented control), so this
    /// is composed minimally rather than left silent.
    var label: String {
        switch self {
        case .person: return "Osoba"
        case .wholeFamily: return "Cała rodzina"
        }
    }
}

/// The 3-way access-level `.seg` -- `AccessLevel`'s three KNOWN cases only
/// (the sheet never offers ".unknown" as a selectable choice; that case
/// exists solely to render an already-unrecognised server value honestly).
enum ShareAccessLevelOption: String, CaseIterable, Identifiable {
    case read
    case fullEdit = "edit"
    case hiddenPassword = "hidden_password"

    var id: String { rawValue }

    /// `AccessLevel.label` -- the SAME Polish strings `access.readOnly`/
    /// `access.fullEdit`/`access.hiddenPassword` render everywhere else,
    /// never a second hand-typed copy of them.
    var label: String {
        AccessLevel(wireValue: rawValue).label
    }
}

/// The item this sheet shares -- the caller's OWN item, so `encKeyJson` is
/// the item's Cipher Key wrapped under the CALLER's own `FfiUserKey`
/// (`sealItemKeyForRecipient`'s own precondition). A minimal, literal
/// struct rather than `VaultItemViewModel` -- that view model deliberately
/// carries no raw `enc_key`/`enc_data` (`ItemFields.swift`'s own DR-38-C
/// discipline keeps those server-wire-only), and this sheet's caller is
/// expected to supply this straight from the same `VaultAPI`/`VaultStore`
/// layer that already holds it.
struct ShareableItem {
    let itemId: String
    let encKeyJson: String
    let displayName: String
}

enum ShareItemError: Error, CustomStringConvertible {
    case memberMissingIdentity(userId: String)
    case noRecipientsSelected

    var description: String {
        switch self {
        case let .memberMissingIdentity(userId):
            return "member \(userId) has no published identity keypair"
        case .noRecipientsSelected:
            return "no recipients selected"
        }
    }
}

/// Pure recipient-selection logic, split out of the view body so it is
/// independently testable without constructing a `ShareItemView` at all
/// (mirrors `ShareMarker.of`'s own "pure function, tested directly"
/// discipline).
enum ShareItemComposer {
    /// Person scope: exactly the checked rows. Whole-family scope: every
    /// CURRENTLY active member except the caller -- see this file's own
    /// header for why this is a documented simplification, not a true
    /// family-wide collection propagation.
    static func recipients(
        for scope: ShareScope,
        selectedIds: Set<String>,
        members: [FamilyAPI.FamilyMemberRecord],
        excluding selfUserId: String
    ) -> [FamilyAPI.FamilyMemberRecord] {
        switch scope {
        case .person:
            return members.filter { selectedIds.contains($0.userId) }
        case .wholeFamily:
            return members.filter { $0.userId != selfUserId && $0.status == "active" }
        }
    }
}

struct ShareItemView: View {
    let item: ShareableItem
    let ownerUserKey: FfiUserKey
    let ownUserId: String
    let members: [FamilyAPI.FamilyMemberRecord]
    let familyAPI: FamilyAPI

    @Environment(\.dismiss) private var dismiss

    @State private var scope: ShareScope = .person
    @State private var accessLevel: ShareAccessLevelOption = .read
    @State private var selectedMemberIds: Set<String> = []
    @State private var isSharing = false
    @State private var errorMessage: String?
    /// CR-05: read on full success to dismiss the sheet -- previously
    /// assigned and never read, so there was no success state at all.
    @State private var didShare = false

    /// WR-06: the ONE filtered set both the person picker AND
    /// `ShareItemComposer.recipients` read, so a share can never target the
    /// caller's own row or a suspended member -- either of which the
    /// whole-family branch already excludes, but the person picker
    /// previously iterated the raw `members` array unfiltered.
    private var shareableMembers: [FamilyAPI.FamilyMemberRecord] {
        members.filter { $0.userId != ownUserId && $0.status == "active" }
    }

    var body: some View {
        PVScreenScaffold(
            content: {
                // No exact existing dictionary key for this sheet's own
                // title (same "compose minimally" note as `InviteCreateView
                // .swift`'s sheet title).
                PVScreenTitle(title: "Udostępnij \(item.displayName)")

                VStack(alignment: .leading, spacing: PVMetrics.fieldStackGap) {
                    Text("Komu")
                        .font(.system(size: PVMetrics.footnoteSize))
                        .foregroundStyle(Color("PVTextMuted"))
                    PVSegmentedControl(
                        options: ShareScope.allCases.map { ($0, $0.label) },
                        selection: $scope
                    )
                    .accessibilityIdentifier("vault.share.scopeSegment")
                }
                .padding(.top, PVMetrics.fieldStackGap)

                if scope == .person {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(shareableMembers, id: \.userId) { member in
                            personRow(member)
                            if member.userId != shareableMembers.last?.userId {
                                Divider()
                            }
                        }
                    }
                    .padding(.top, PVMetrics.fieldStackGap)
                    .accessibilityIdentifier("vault.share.personPicker")
                }

                VStack(alignment: .leading, spacing: PVMetrics.fieldStackGap) {
                    Text("Poziom dostępu")
                        .font(.system(size: PVMetrics.footnoteSize))
                        .foregroundStyle(Color("PVTextMuted"))
                    PVSegmentedControl(
                        options: ShareAccessLevelOption.allCases.map { ($0, $0.label) },
                        selection: $accessLevel
                    )
                    .accessibilityIdentifier("vault.share.accessLevelSegment")
                }
                .padding(.top, PVMetrics.fieldStackGap)

                if accessLevel == .hiddenPassword {
                    // `share.hiddenPasswordDisclosureBody` -- SC3's own
                    // checked string, VERBATIM, never paraphrased.
                    StatusCallout(text: HiddenPasswordDisclosure.disclosureBodyPl, tone: .warning)
                        .accessibilityIdentifier("vault.share.hiddenPasswordDisclosure")
                        .padding(.top, PVMetrics.fieldStackGap)
                }

                // CR-02: this sheet's only write path is a DIRECT item
                // share (`familyAPI.createItemShare`, this file's own
                // header records it does not move the item into a
                // family-wide Collection). Member removal severs the
                // share ROW for that mechanism but does not rotate the
                // item's Cipher Key -- only collection-scoped items get a
                // fresh key. The copy must say that, not promise a
                // re-wrap this path never performs.
                StatusCallout(
                    text: "Udostępnienie zawija klucz tego itemu dla każdej wybranej osoby. Cofnięcie dostępu "
                        + "usuwa jej wpis, ale NIE zmienia klucza — osoba, która już go odebrała, technicznie "
                        + "zachowuje kopię. Jeśli hasło ma przestać być dla niej ważne, zmień je.",
                    tone: .muted
                )
                .accessibilityIdentifier("vault.share.revocationNote")
                .padding(.top, PVMetrics.fieldStackGap)

                if let errorMessage {
                    StatusCallout(text: errorMessage, tone: .error)
                        .accessibilityIdentifier("vault.share.errorText")
                        .padding(.top, PVMetrics.fieldStackGap)
                }
            },
            actions: {
                Button {
                    Task { await share() }
                } label: {
                    if isSharing {
                        ProgressView().tint(Color("PVOnAccent"))
                    } else {
                        Text(ctaLabel)
                    }
                }
                .buttonStyle(PVPrimaryButtonStyle(isEnabled: !isSharing))
                .disabled(isSharing)
                .accessibilityIdentifier("vault.share.cta")
            }
        )
    }

    private var ctaLabel: String {
        switch scope {
        case .person:
            return "Udostępnij \(selectedMemberIds.count) os."
        case .wholeFamily:
            return "Udostępnij całej rodzinie"
        }
    }

    @ViewBuilder
    private func personRow(_ member: FamilyAPI.FamilyMemberRecord) -> some View {
        let isSelected = selectedMemberIds.contains(member.userId)
        Button {
            if isSelected {
                selectedMemberIds.remove(member.userId)
            } else {
                selectedMemberIds.insert(member.userId)
            }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: member.email)
                        .font(.system(size: PVMetrics.subtitleSize))
                        .foregroundStyle(Color("PVTextPrimary"))
                }
                Spacer()
                if isSelected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color("PVAccent"))
                }
            }
            .frame(minHeight: PVMetrics.rowMinHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("vault.share.person.\(member.userId)")
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }

    /// Real composition, no mock: unwraps `item`'s Cipher Key with
    /// `ownerUserKey` and re-seals it to each recipient's own published
    /// `IdentityPublicKey` via `sealItemKeyForRecipient`
    /// (`crates/pv-ffi/src/sharing.rs`), then `POST`s the resulting sealed
    /// blob through `familyAPI.createItemShare` -- SHARE-02's own write-side
    /// primitive, unchanged.
    ///
    /// CR-05: settles EACH recipient independently rather than throwing on
    /// the first failure. A partial failure is reported honestly (who DID
    /// get access, who did not) instead of a blanket "nothing was shared"
    /// that hides that some recipients already hold the key. A 409 for a
    /// recipient who already has this exact grant is treated as success
    /// (mirrors `ResealService.isConflictError`'s duck-typed check) so a
    /// retry after a partial failure can make forward progress instead of
    /// throwing again on the first (already-succeeded) recipient.
    private func share() async {
        errorMessage = nil
        let recipients = ShareItemComposer.recipients(
            for: scope, selectedIds: selectedMemberIds, members: shareableMembers, excluding: ownUserId
        )
        guard !recipients.isEmpty else {
            errorMessage = "Wybierz co najmniej jedną osobę."
            return
        }

        isSharing = true
        defer { isSharing = false }

        var succeeded: [String] = []
        var failed: [String] = []
        for member in recipients {
            do {
                guard
                    let publicKeyB64 = member.publicKey,
                    let publicKeyData = Data(base64Encoded: publicKeyB64)
                else {
                    throw ShareItemError.memberMissingIdentity(userId: member.userId)
                }
                let recipientPk = try FfiIdentityPublicKey.fromBytes(bytes: publicKeyData)
                let sealedJson = try sealItemKeyForRecipient(
                    uk: ownerUserKey, encKeyJson: item.encKeyJson, itemId: item.itemId, recipientPk: recipientPk
                )
                try await familyAPI.createItemShare(
                    itemId: item.itemId, recipientUserId: member.userId,
                    sealedKeyJson: sealedJson, accessLevel: accessLevel.rawValue
                )
                succeeded.append(member.email)
            } catch where ResealService.isConflictError(error) {
                // CR-08 (40-REVIEW.md, iteration 2): a 409 here means the
                // recipient already holds SOME grant for this item -- but,
                // unlike `ResealService`'s own re-share-onward call (that
                // type's own doc comment names this exact exclusion), the
                // level offered here is a USER CHOICE on THIS sheet, made
                // fresh every time it opens. Treating the 409 as success
                // outright silently discarded a re-share at a DIFFERENT
                // level -- `create_share`'s `ON CONFLICT DO NOTHING` leaves
                // the pre-existing row's old `access_level` untouched, so a
                // downgrade from `edit` to `hidden_password` reported
                // success while the recipient kept `edit`. Discriminate:
                // attempt the level EDIT via `PUT .../shares/{user_id}`
                // (`update_share`) before counting this recipient as
                // succeeded.
                do {
                    try await familyAPI.updateItemShare(
                        itemId: item.itemId, recipientUserId: member.userId,
                        accessLevel: accessLevel.rawValue
                    )
                    succeeded.append(member.email)
                } catch {
                    failed.append(member.email)
                }
            } catch {
                failed.append(member.email)
            }
        }

        if failed.isEmpty {
            didShare = true
            dismiss()
        } else {
            // Name who DID get access -- never a bare "it failed", which
            // would misreport a partial success as total failure.
            let succeededNote = succeeded.isEmpty ? "" : "Udostępniono: \(succeeded.joined(separator: ", ")). "
            errorMessage = succeededNote + "Nie udało się dla: \(failed.joined(separator: ", "))."
        }
    }
}
