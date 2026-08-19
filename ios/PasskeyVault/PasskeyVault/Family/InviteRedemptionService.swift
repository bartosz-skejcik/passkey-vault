//
//  InviteRedemptionService.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-09, Task 1.
//  The REDEMPTION half of `InviteService.swift` (plan 40-06) -- mirrors
//  `web/src/lib/invite/crypto.ts`'s `redeemInviteFlow` step order exactly
//  (`git show main:web/src/lib/invite/crypto.ts`, read this session): parse
//  the URL, decode the fragment with the URL-safe helper, build the channel,
//  assert the derived id equals the path id and abort LOCALLY on mismatch
//  (no network call), fetch metadata with the raw proof in the request BODY
//  (`crates/pv-server/src/routes/invitations.rs::fetch_metadata` -- a POST,
//  never a GET, per Amendment 2: a credential belongs in a body, never a
//  path/query string an access log could capture), ensure the identity
//  keypair through plan 40-02's `IdentityService` (adopting the server's
//  canonical blob if one exists -- never publishing a second one), unwrap
//  each family-wide entry, self-seal each to THIS account's own published
//  public key, and post the accept.
//
//  This is the production promotion of `InviteTests.redeemInviteSwiftSide`
//  (plan 40-06's test-only helper, written when this service did not yet
//  exist) -- same step order, same `pv-ffi` calls, now a real service other
//  code (`InviteRedeemView`, this plan's live E-F4a/E-F4b runs) can call.
//
//  Per-entry failure reporting (this plan's own `must_haves.truths`): an
//  entry that fails to `unwrapCollectionKey` is caught and reported in
//  `RedemptionResult.familyWideFailed`, NEVER silently dropped -- the caller
//  learns exactly which collection did not travel. This is a DIFFERENT
//  event from the server's own silent filter (below) and must not be
//  conflated with it.
//
//  Two constraints worth keeping visible (both from the reference
//  implementation, `invitations.rs::accept`'s own doc comments):
//
//  1. The server filters submitted `family_wide_sealed_keys` down to the
//     collections THIS invitation's own `invitation_family_wide_keys` rows
//     actually name, and silently drops any entry whose `collection_id`
//     does not match -- never an error. Every entry this service ever
//     builds is sourced from `metadata.family_wide_keys` (the SAME
//     invitation's own response), so this service can never produce a
//     mismatched entry itself -- but a caller must not mistake the SERVER's
//     silent drop (which cannot happen here) for THIS service's own
//     unwrap-failure report (which can, e.g. corrupted wire data) -- they
//     are different events with different causes.
//
//  2. The accept endpoint is single-use: `accept()`'s own `WHERE status =
//     'pending'` guard means a SECOND accept call against an
//     already-consumed invite legitimately 404s. That is not a crypto
//     failure and must never be surfaced through the same
//     `familyWideFailed`/unwrap-error path -- it propagates as a plain
//     `PvApiError.httpError(status: 404, ...)` from `acceptInvite` below,
//     distinguishable from every crypto-layer throw by its type alone.
//
//  Reuses an existing published identity keypair rather than publishing a
//  second one -- `IdentityService.ensureOwnIdentityKeypair`'s own
//  adopt-existing discipline (plan 40-02), called exactly once per
//  `redeem(url:userKey:)` call, same as every other Phase 40 caller.
//

import Foundation

enum InviteRedemptionError: Error, CustomStringConvertible {
    /// The invite URL carries no fragment at all -- caught before any
    /// network call, mirroring `selfConsistencyMismatch` below.
    case malformedURL(String)
    /// The fragment-derived invite id does not match the URL's own path id
    /// -- a tampered or malformed link, rejected LOCALLY, before any
    /// network call (this plan's own `must_haves.truths`).
    case selfConsistencyMismatch(pathId: String, fragmentId: String)

    var description: String {
        switch self {
        case let .malformedURL(url):
            return "invite URL carries no fragment: \(url)"
        case let .selfConsistencyMismatch(pathId, fragmentId):
            return "invite URL's fragment (re-derived id \(fragmentId)) does not match its own path id \(pathId)"
        }
    }
}

struct InviteRedemptionService {
    let baseURL: URL
    let tokenProvider: () -> String?
    var session: URLSession = .shared

    private static let userAgent = "PasskeyVault-iOS/1.0 (sharing, 40-09)"

    private var identityService: IdentityService {
        IdentityService(baseURL: baseURL, tokenProvider: tokenProvider, session: session)
    }

    /// One family-wide entry this invitation carried that failed to unwrap
    /// -- reported, never silently dropped. `reason` is the underlying
    /// error's own description, same discipline
    /// `PendingKeyState.decryptFailed`'s reason string already uses.
    struct FamilyWideRedemptionFailure: Equatable {
        let collectionId: String
        let reason: String
    }

    /// The outcome of one `redeem(url:userKey:)` call. `inviterEmail`/
    /// `familyName`/`inviterFingerprint` are carried through from the
    /// metadata fetch (never re-fetched) so a caller (`InviteRedeemView`)
    /// can render the SAME dictionary-key copy the web redemption screen
    /// uses, with real interpolated values, rather than a generic
    /// placeholder.
    struct RedemptionResult: Equatable {
        let alreadyMember: Bool
        let collectionId: String?
        let inviterEmail: String
        let familyName: String
        let inviterFingerprint: String?
        /// Collection ids whose family-wide entry unwrapped and self-sealed
        /// successfully (i.e. were included in the accept body).
        let familyWideSucceeded: [String]
        /// Collection ids whose family-wide entry failed to unwrap --
        /// reported, never silently dropped.
        let familyWideFailed: [FamilyWideRedemptionFailure]
    }

    // MARK: - Public API

    /// Redeems an invite URL. Throws `InviteRedemptionError` for a
    /// malformed/tampered URL (no network call made), `PvApiError` for any
    /// HTTP-layer failure (metadata fetch or accept), or a `pv-ffi` crypto
    /// error if `FfiInviteChannel.fromSecret` itself rejects the decoded
    /// secret bytes.
    func redeem(url: URL, userKey: FfiUserKey) async throws -> RedemptionResult {
        guard let fragment = url.fragment, !fragment.isEmpty else {
            throw InviteRedemptionError.malformedURL(url.absoluteString)
        }
        let pathId = url.pathComponents.last ?? ""

        let secretBytes = try UrlSafeNoPadBase64.decode(fragment)
        let channel = try FfiInviteChannel.fromSecret(secret: secretBytes)

        // Self-consistency check BEFORE any network call -- a
        // tampered/malformed link is caught here, never surfaced as a
        // confusing server error (this plan's own `must_haves.truths`).
        guard channel.inviteId() == pathId else {
            throw InviteRedemptionError.selfConsistencyMismatch(pathId: pathId, fragmentId: channel.inviteId())
        }

        // STANDARD encoding -- this is a JSON body field, not a URL
        // segment (Base64Alphabets.swift's own discipline).
        let inviteProofB64 = StandardBase64.encode(channel.proofForRedemption())

        let metadata = try await fetchMetadata(inviteId: pathId, inviteProofB64: inviteProofB64)

        // Reuses an existing published identity keypair rather than
        // publishing a second one -- see this file's own header.
        let identityKey = try await identityService.ensureOwnIdentityKeypair(userKey: userKey)
        let ownPublicKey = try FfiIdentityPublicKey.fromBytes(bytes: identityKey.publicKeyBytes())

        // The single explicit collection-scope branch, if this invite
        // carries one (iOS's own `InviteService.generateInviteLink` never
        // produces this -- it is family-scope only -- but a real
        // `pv-server` invite may still carry it, e.g. one created by the
        // web app, so this service handles it too rather than silently
        // dropping a real grant).
        var sealedForSelf: String?
        if let wrappedCollectionKey = metadata.wrappedCollectionKey {
            let collectionKey = try channel.unwrapCollectionKey(wrappedJson: wrappedCollectionKey)
            sealedForSelf = try sealCollectionKey(recipientPk: ownPublicKey, ck: collectionKey)
        }

        // Self-seal every family-wide key this invite's metadata carried,
        // to THIS account's own freshly-published identity key. An entry
        // that fails to unwrap is reported, never silently dropped -- see
        // this file's own header.
        var familyWideSealedKeys: [AcceptRequestFamilyWideEntry] = []
        var succeeded: [String] = []
        var failed: [FamilyWideRedemptionFailure] = []
        for entry in metadata.familyWideKeys {
            do {
                let collectionKey = try channel.unwrapCollectionKey(wrappedJson: entry.wrappedCollectionKey)
                let sealed = try sealCollectionKey(recipientPk: ownPublicKey, ck: collectionKey)
                familyWideSealedKeys.append(
                    AcceptRequestFamilyWideEntry(collectionId: entry.collectionId, sealedForSelf: sealed)
                )
                succeeded.append(entry.collectionId)
            } catch {
                failed.append(FamilyWideRedemptionFailure(collectionId: entry.collectionId, reason: "\(error)"))
            }
        }

        // The SAME `inviteProofB64` derived above, reused, never
        // re-derived.
        let alreadyMember = try await acceptInvite(
            inviteId: pathId, inviteProofB64: inviteProofB64,
            sealedForSelf: sealedForSelf, familyWideSealedKeys: familyWideSealedKeys
        )

        return RedemptionResult(
            alreadyMember: alreadyMember,
            collectionId: metadata.collectionId,
            inviterEmail: metadata.inviterEmail,
            familyName: metadata.familyName,
            inviterFingerprint: metadata.inviterFingerprint,
            familyWideSucceeded: succeeded,
            familyWideFailed: failed
        )
    }

    // MARK: - `POST /api/invitations/{id}` -- metadata fetch, proof in the body

    private struct FetchMetadataRequestBody: Encodable {
        let invite_proof: String
    }

    private struct FamilyWideKeyEntryBody: Decodable {
        let collection_id: String
        let wrapped_collection_key: String
    }

    private struct InvitationMetadataResponseBody: Decodable {
        let inviter_email: String
        let family_name: String
        let inviter_fingerprint: String?
        let collection_id: String?
        let wrapped_collection_key: String?
        let family_wide_keys: [FamilyWideKeyEntryBody]
    }

    private struct InvitationMetadata {
        let inviterEmail: String
        let familyName: String
        let inviterFingerprint: String?
        let collectionId: String?
        let wrappedCollectionKey: String?
        let familyWideKeys: [(collectionId: String, wrappedCollectionKey: String)]
    }

    /// `POST /api/invitations/{id}` -- no session required (this route
    /// works with NO auth at all, per `invitations.rs`'s own doc comment);
    /// `tokenProvider` is deliberately not consulted here.
    private func fetchMetadata(inviteId: String, inviteProofB64: String) async throws -> InvitationMetadata {
        let requestBody = FetchMetadataRequestBody(invite_proof: inviteProofB64)
        let body = try JSONEncoder().encode(requestBody)
        let (data, response) = try await send(
            path: "/api/invitations/\(inviteId)", method: "POST", body: body, token: nil
        )
        try Self.requireStatus(200, response: response, data: data)
        let decoded = try Self.decode(InvitationMetadataResponseBody.self, from: data)
        return InvitationMetadata(
            inviterEmail: decoded.inviter_email,
            familyName: decoded.family_name,
            inviterFingerprint: decoded.inviter_fingerprint,
            collectionId: decoded.collection_id,
            wrappedCollectionKey: decoded.wrapped_collection_key,
            familyWideKeys: decoded.family_wide_keys.map { ($0.collection_id, $0.wrapped_collection_key) }
        )
    }

    // MARK: - `POST /api/invitations/{id}/accept`

    private struct AcceptRequestFamilyWideEntry: Encodable {
        let collectionId: String
        let sealedForSelf: String

        enum CodingKeys: String, CodingKey {
            case collectionId = "collection_id"
            case sealedForSelf = "sealed_for_self"
        }
    }

    private struct AcceptInvitationRequestBody: Encodable {
        let invite_proof: String
        let sealed_for_self: String?
        let family_wide_sealed_keys: [AcceptRequestFamilyWideEntry]
    }

    private struct AcceptInvitationResponseBody: Decodable {
        let already_member: Bool
    }

    /// `POST /api/invitations/{id}/accept` -- requires the CALLER's own
    /// session token (the invitee must already be registered/logged in on
    /// this device; this service never registers an account itself, unlike
    /// the web landing page's guest flow -- iOS redemption happens inside
    /// the already-authenticated app).
    private func acceptInvite(
        inviteId: String, inviteProofB64: String,
        sealedForSelf: String?, familyWideSealedKeys: [AcceptRequestFamilyWideEntry]
    ) async throws -> Bool {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/invitations/\(inviteId)/accept")
        }
        let requestBody = AcceptInvitationRequestBody(
            invite_proof: inviteProofB64, sealed_for_self: sealedForSelf,
            family_wide_sealed_keys: familyWideSealedKeys
        )
        let body = try JSONEncoder().encode(requestBody)
        // A retry against an already-consumed invite legitimately 404s
        // here (this file's own header, constraint 2) -- propagated as a
        // plain PvApiError.httpError, never conflated with a crypto error.
        let (data, response) = try await send(
            path: "/api/invitations/\(inviteId)/accept", method: "POST", body: body, token: token
        )
        try Self.requireStatus(200, response: response, data: data)
        let decoded = try Self.decode(AcceptInvitationResponseBody.self, from: data)
        return decoded.already_member
    }

    // MARK: - Transport (mirrors InviteService.swift/FamilyAPI.swift)

    private func send(
        path: String,
        method: String,
        body: Data?,
        token: String?
    ) async throws -> (Data, HTTPURLResponse) {
        guard let url = URL(string: path, relativeTo: baseURL) else {
            throw PvApiError.unexpectedResponse("could not construct URL for \(path) against \(baseURL)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if let token {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw PvApiError.network(error)
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PvApiError.unexpectedResponse("response was not an HTTP response")
        }
        return (data, httpResponse)
    }

    private static func requireStatus(_ expected: Int, response: HTTPURLResponse, data: Data) throws {
        if response.statusCode == expected {
            return
        }
        if response.statusCode == 401 {
            throw PvApiError.invalidCredentials
        }
        let message = String(data: data, encoding: .utf8)
            ?? HTTPURLResponse.localizedString(forStatusCode: response.statusCode)
        throw PvApiError.httpError(status: response.statusCode, message: message)
    }

    private static func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw PvApiError.unexpectedResponse("failed to decode \(type): \(error)")
        }
    }
}
