//
//  ResealService.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-10, Task 1.
//  DR-40-B (`ios/IOS-SPIKE-LOG.md` §1): iOS becomes a FULL FSH-02
//  participant -- receiver AND resealer/propagator. `40-09` proved the
//  receiver half (`InviteRedemptionService`). This file is the propagator
//  half: the ONE-pair composition mirrored, step for step, from
//  `web/src/lib/families/reseal.ts::reshareCollectionToNewMember`
//  (`git show main:web/src/lib/families/reseal.ts`, read this session) --
//  unwrap a Collection Key this account ALREADY holds and reseal the SAME
//  key (never a freshly-generated one, unlike `RemoveMemberService`'s
//  rotation-on-removal job) to exactly one new recipient's published public
//  key, then grant it via the EXISTING `POST /api/vault/collections/{id}/
//  members` endpoint (`FamilyAPI.addCollectionMember`, plan 40-08) -- no new
//  server surface, no new wire shape.
//
//  Reference step order, NOT reordered for readability (reseal.ts's own doc
//  comment on why): (1) ensure this account's own published identity
//  keypair; (2) resolve the recipient's published public key from the
//  roster -- a missing key throws BEFORE `getCollection`/`addCollectionMember`
//  are ever called, T-25-16, so a doomed grant never reaches the network even
//  partially; (3) fetch the collection -- no OWN `sealed_key` means this
//  account is on the MISSING side, not the delivering side, and this throws
//  too; (4) unseal with this account's own identity key, then seal the SAME
//  recovered key to the recipient -- `FfiCollectionKey.generate()` is never
//  called anywhere in this file; (5) POST to the ordinary grant endpoint at
//  the COLLECTION's own `family_wide_access_level`, `"read"` as the ONLY
//  fallback when that column is `NULL` -- NEVER this account's own held
//  `access_level` (CR-01/`resealTrigger.ts`'s `FALLBACK_ACCESS_LEVEL`
//  rationale, ported verbatim: the creator's own row is hard-coded `'edit'`
//  by `collections::create` regardless of the level the share was actually
//  created at, so falling back to the propagator's own level would silently
//  upgrade a `read`-declared share for every newcomer resealed to).
//
//  A structural 409 from the grant endpoint resolves as SUCCESS, duck-typed
//  (`isConflictError`, mirroring `reseal.ts`'s own deliberate choice, ported
//  here rather than left to `ResealTrigger`'s caller) -- the grant is
//  idempotent server-side (`collection_keys`' composite PK, `INSERT ... ON
//  CONFLICT DO NOTHING`), so a conflict means the recipient already holds
//  the key, exactly the outcome this call wanted.
//

import Foundation

enum ResealServiceError: Error, CustomStringConvertible {
    case recipientMissingPublicKey(userId: String, collectionId: String)
    case malformedPublicKey(userId: String, collectionId: String)
    case collectionMissingOwnSealedKey(collectionId: String)

    var description: String {
        switch self {
        case let .recipientMissingPublicKey(userId, collectionId):
            return "cannot reseal collection \(collectionId) -- recipient \(userId) has no published public key"
        case let .malformedPublicKey(userId, collectionId):
            return "cannot reseal collection \(collectionId) -- recipient \(userId)'s public_key is not valid base64"
        case let .collectionMissingOwnSealedKey(collectionId):
            return "cannot reseal collection \(collectionId) -- caller has no sealed_key for it (missing side, not delivering side)"
        }
    }
}

/// Reseals ONE family-wide collection's EXISTING Collection Key to ONE new
/// recipient. Stateless, like every other Phase 40 service file -- owns no
/// per-session state (that is `ResealTrigger`'s job, Task 2).
struct ResealService {
    let baseURL: URL
    let tokenProvider: () -> String?
    var session: URLSession = .shared

    /// CR-01-equivalent fallback (`resealTrigger.ts`'s `FALLBACK_ACCESS_LEVEL`,
    /// this file's own header) -- used ONLY when the collection's OWN
    /// `family_wide_access_level` is `null` (a legacy family-wide collection
    /// created before that column existed). NEVER the propagator's own held
    /// `access_level` -- see this file's header for the exact over-grant bug
    /// that substitution used to cause.
    static let fallbackAccessLevel = "read"

    private var familyAPI: FamilyAPI { FamilyAPI(baseURL: baseURL, tokenProvider: tokenProvider, session: session) }
    private var identityService: IdentityService {
        IdentityService(baseURL: baseURL, tokenProvider: tokenProvider, session: session)
    }
    private var collectionService: CollectionService {
        CollectionService(baseURL: baseURL, tokenProvider: tokenProvider, session: session)
    }

    /// Structural (duck-typed) 409 check -- mirrors `reseal.ts::isConflictError`
    /// exactly, and for the same reason that function's own doc comment
    /// gives: never `case PvApiError.httpError` matched against a specific
    /// enum IDENTITY assumption that could drift, just the literal `status
    /// == 409` fact this call site actually cares about. The grant is
    /// idempotent server-side (this file's header) -- a 409 here can only
    /// mean the recipient already holds a grant for this exact pair, which
    /// is the outcome THIS call wanted, never a stale/wrong-level ambiguity
    /// (unlike a user-chosen per-row level such as `ShareItemView`'s own
    /// share-authoring call, which does NOT get this treatment).
    static func isConflictError(_ error: Error) -> Bool {
        if case let PvApiError.httpError(status, _) = error {
            return status == 409
        }
        return false
    }

    /// The five-step composition, reference order preserved. Throws
    /// `ResealServiceError`, a `pv-ffi` crypto error, or `PvApiError` for any
    /// non-conflict HTTP failure.
    func reshareCollection(collectionId: String, recipientUserId: String, userKey: FfiUserKey) async throws {
        // Step 1: this account's own published identity keypair -- adopts an
        // existing one, never publishes a second (IdentityService's own
        // discipline, plan 40-02).
        let identityKey = try await identityService.ensureOwnIdentityKeypair(userKey: userKey)
        // WR-19 (40-REVIEW.md, iteration 2): a liveness re-check between
        // EVERY network step of this fan-out, mirroring `VaultStore
        // .mergeSharedAndFamilyWideItems`'s/`SyncCoordinator`'s own
        // post-await discipline for the identical shape -- a lock landing
        // mid-fan-out must stop this pair's OWN remaining network/crypto
        // work, not just the pairs after it in `ResealTrigger.run`'s loop.
        // `CancellationError` is caught by `ResealTrigger.run`'s own
        // `catch` like any other reseal failure -- opportunistic by
        // construction, retried on the next unlock's fresh
        // `resetAttempts()`, never surfaced to the user.
        try Task.checkCancellation()

        // Step 2: resolve the recipient's published public key from the
        // roster BEFORE any getCollection/addCollectionMember call for this
        // pair -- T-25-16, this file's header.
        let roster = try await familyAPI.fetchMembers()
        try Task.checkCancellation()
        guard
            let member = roster.first(where: { $0.userId == recipientUserId }),
            let publicKeyBase64 = member.publicKey
        else {
            throw ResealServiceError.recipientMissingPublicKey(userId: recipientUserId, collectionId: collectionId)
        }
        guard let publicKeyBytes = Data(base64Encoded: publicKeyBase64) else {
            throw ResealServiceError.malformedPublicKey(userId: recipientUserId, collectionId: collectionId)
        }
        let recipientPk = try FfiIdentityPublicKey.fromBytes(bytes: publicKeyBytes)

        // Step 3: fetch the collection -- no own sealed_key means this
        // account is on the MISSING side, not the delivering side.
        let record = try await collectionService.fetchCollection(id: collectionId)
        try Task.checkCancellation()
        guard let ownSealedKey = record.sealedKey else {
            throw ResealServiceError.collectionMissingOwnSealedKey(collectionId: collectionId)
        }

        // Step 4: unwrap-own-key, reseal-to-recipient -- the SAME key,
        // never `FfiCollectionKey.generate()`.
        let ck = try unsealCollectionKey(myIdentityKey: identityKey, sealedJson: ownSealedKey)
        let sealedKeyJson = try sealCollectionKey(recipientPk: recipientPk, ck: ck)
        try Task.checkCancellation()

        // Step 5: the collection's OWN family-wide level, "read" the ONLY
        // fallback -- never this account's own `record.accessLevel`.
        let level = record.familyWideAccessLevel ?? Self.fallbackAccessLevel

        do {
            try await familyAPI.addCollectionMember(
                collectionId: collectionId, recipientUserId: recipientUserId,
                sealedKeyJson: sealedKeyJson, accessLevel: level
            )
        } catch {
            if Self.isConflictError(error) {
                return
            }
            throw error
        }
    }
}
