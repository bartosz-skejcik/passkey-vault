//
//  InviteService.swift
//  PasskeyVault
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-06, Task 2.
//  `generateInviteLink(userKey:expiresIn:)` -- mirrors
//  `web/src/lib/invite/crypto.ts`'s `generateInviteLink` step order exactly
//  (`git show main:web/src/lib/invite/crypto.ts`, read this session):
//  ensure the identity keypair FIRST (every family-wide entry needs an
//  unseal), generate the invite secret, capture its URL-safe base64 BEFORE
//  handing the bytes to `FfiInviteChannel.fromSecret` (the channel
//  zeroizes its own copy on construction and exposes no accessor to
//  recover them -- `crates/pv-ffi/src/sharing.rs`'s own module header),
//  derive the invite id, hash the creation-time proof, fold in every
//  family-wide collection the caller currently holds a key for, POST, and
//  assemble the final URL.
//
//  Path A fold-in (30-DECISION-FSH-02.md): for each of the caller's
//  collections carrying a non-nil `familyWideKind`, a non-nil `sealedKey`
//  and a non-nil `accessLevel` (the caller's OWN row -- structurally
//  always present for a row the caller can even see; kept as a defensive
//  filter mirroring `crypto.ts`'s identical `entry.access_level == null`
//  check), unseal the Collection Key with the caller's identity key, wrap
//  it through the invite channel, and emit an entry carrying the SHARE's
//  OWN `familyWideAccessLevel` -- DELIBERATELY `"read"` as the fallback
//  when THAT column (never the caller's own `accessLevel`) is null, per
//  this task's own acceptance criteria.
//
//  Why `"read"`, not the caller's own level (the web precedent's choice for
//  its identical legacy-null case): `collections::create`
//  (`crates/pv-server/src/routes/collections.rs`) hard-codes the creator's
//  own row to full `edit` regardless of the family-wide level the share
//  itself declares, so the creator is the single most likely propagator of
//  an accidental over-grant. Falling back to the caller's own level here
//  would silently upgrade a deliberate read-only family-wide share for a
//  brand-new invitee who never held any prior grant to reconcile against.
//  `"read"` is the strictly safer fallback, and this task's own
//  `<precondition>` guarantees `family_wide_access_level` is already
//  threaded through `collections.rs` on the server this plan targets, so
//  the legacy-null case this fallback exists for should not occur in
//  practice on a fresh deploy.
//
//  Two orderings are load-bearing (this task's own `<action>` text) and
//  must never be rearranged for tidiness: (1) the URL-safe base64 of the
//  secret is captured BEFORE `FfiInviteChannel.fromSecret` consumes the
//  bytes; (2) the identity keypair is ensured BEFORE the family-wide loop.
//
//  The creation-time proof travels as `proof_hash` -- STANDARD base64 of
//  `channel.proofHashForCreation()`'s digest bytes -- NEVER the raw proof
//  (`channel.proofForRedemption()`, presented only at redemption time, in
//  a POST body a downstream client issues, not this one).
//
//  The returned URL carries an iOS-side self-consistency assertion: a
//  FRESH `FfiInviteChannel` is rebuilt from the SAME `secretForUrl` string
//  (round-tripped through `UrlSafeNoPadBase64.decode`) and its own
//  `inviteId()` is required to equal the path `inviteId` already computed
//  above. This is a general property of the encode/decode/re-derive
//  mechanism this file uses -- `InviteTests.swift`'s
//  `tamperedFragmentFailsTheIOSSideSelfConsistencyCheck` proves the SAME
//  mechanism rejects a tampered fragment, directly, without a network
//  round trip.
//
//  `GET /api/vault/collections` (list): deliberately NOT added to
//  `Sharing/CollectionService.swift` (out of this plan's own
//  `files_modified` scope) -- a private helper here instead, decoding into
//  the SAME `CollectionRecord` type that file already defines (internal,
//  not `private`, so reusable from this file without duplicating the
//  struct). Recorded in 40-06-SUMMARY.md's Deviations so a future reader of
//  `CollectionService.swift` is not surprised this plan added a sibling
//  list call elsewhere instead of extending it in place.
//

import Foundation

enum InviteServiceError: Error, CustomStringConvertible {
    case selfConsistencyMismatch(pathId: String, fragmentId: String)

    var description: String {
        switch self {
        case let .selfConsistencyMismatch(pathId, fragmentId):
            return "invite URL's fragment (re-derived id \(fragmentId)) does not match its own path id \(pathId)"
        }
    }
}

struct InviteService {
    let baseURL: URL
    let tokenProvider: () -> String?
    var session: URLSession = .shared

    private static let userAgent = "PasskeyVault-iOS/1.0 (sharing, 40-06)"

    private var identityService: IdentityService {
        IdentityService(baseURL: baseURL, tokenProvider: tokenProvider, session: session)
    }

    private var familyAPI: FamilyAPI {
        FamilyAPI(baseURL: baseURL, tokenProvider: tokenProvider, session: session)
    }

    // MARK: - Public API

    /// Generates a fresh family-scope invite link. See this file's header
    /// for the full step order and the two load-bearing orderings.
    func generateInviteLink(userKey: FfiUserKey, expiresIn: String) async throws -> URL {
        // Ordering (1): identity keypair BEFORE the family-wide loop.
        let identityKey = try await identityService.ensureOwnIdentityKeypair(userKey: userKey)

        let secretBytes = generateInviteSecret()
        // Ordering (2): captured BEFORE fromSecret consumes the bytes.
        let secretForUrl = UrlSafeNoPadBase64.encode(secretBytes)

        let channel = try FfiInviteChannel.fromSecret(secret: secretBytes)
        let inviteId = channel.inviteId()
        let proofHashB64 = StandardBase64.encode(channel.proofHashForCreation())

        let familyWideKeys = try await buildFamilyWideKeyEntries(channel: channel, identityKey: identityKey)

        _ = try await familyAPI.createInvite(
            id: inviteId,
            collectionId: nil,
            accessLevel: nil,
            wrappedCollectionKey: nil,
            familyWideKeys: familyWideKeys,
            proofHash: proofHashB64,
            expiresIn: expiresIn
        )

        // iOS-side self-consistency assertion (this file's header) -- BEFORE
        // returning the URL, never after.
        let reDerivedSecret = try UrlSafeNoPadBase64.decode(secretForUrl)
        let reDerivedChannel = try FfiInviteChannel.fromSecret(secret: reDerivedSecret)
        guard reDerivedChannel.inviteId() == inviteId else {
            throw InviteServiceError.selfConsistencyMismatch(pathId: inviteId, fragmentId: reDerivedChannel.inviteId())
        }

        var origin = baseURL.absoluteString
        if origin.hasSuffix("/") { origin.removeLast() }
        guard let url = URL(string: "\(origin)/invite/\(inviteId)#\(secretForUrl)") else {
            throw PvApiError.unexpectedResponse("could not construct invite URL for id \(inviteId)")
        }
        return url
    }

    // MARK: - Path A fold-in

    private func buildFamilyWideKeyEntries(
        channel: FfiInviteChannel,
        identityKey: FfiIdentityKey
    ) async throws -> [FamilyAPI.FamilyWideKeyEntry] {
        let collections = try await fetchOwnCollections()
        var entries: [FamilyAPI.FamilyWideKeyEntry] = []
        for record in collections {
            guard record.familyWideKind != nil,
                  let sealedKey = record.sealedKey,
                  record.accessLevel != nil
            else { continue }

            let collectionKey = try unsealCollectionKey(myIdentityKey: identityKey, sealedJson: sealedKey)
            let wrappedJson = try channel.wrapCollectionKey(ck: collectionKey)
            // DELIBERATE fallback to "read", never `record.accessLevel`
            // (the caller's own held level) -- see this file's header.
            let level = record.familyWideAccessLevel ?? "read"
            entries.append(
                FamilyAPI.FamilyWideKeyEntry(
                    collectionId: record.id,
                    accessLevel: level,
                    wrappedCollectionKey: wrappedJson
                )
            )
        }
        return entries
    }

    // MARK: - `GET /api/vault/collections` (list)

    private struct CollectionListRowBody: Decodable {
        let id: String
        let enc_name: String
        let created_at: String
        let access_level: String?
        let sealed_key: String?
        let family_wide_kind: String?
        let family_wide_access_level: String?
    }

    private func fetchOwnCollections() async throws -> [CollectionRecord] {
        guard let token = tokenProvider() else {
            throw PvApiError.unexpectedResponse("no session token available for /api/vault/collections")
        }
        guard let url = URL(string: "/api/vault/collections", relativeTo: baseURL) else {
            throw PvApiError.unexpectedResponse("could not construct URL for /api/vault/collections against \(baseURL)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue(Self.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

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
        guard httpResponse.statusCode == 200 else {
            if httpResponse.statusCode == 401 { throw PvApiError.invalidCredentials }
            let message = String(data: data, encoding: .utf8)
                ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw PvApiError.httpError(status: httpResponse.statusCode, message: message)
        }
        let rows: [CollectionListRowBody]
        do {
            rows = try JSONDecoder().decode([CollectionListRowBody].self, from: data)
        } catch {
            throw PvApiError.unexpectedResponse("failed to decode /api/vault/collections response: \(error)")
        }
        return rows.map {
            CollectionRecord(
                id: $0.id, encName: $0.enc_name, createdAt: $0.created_at,
                accessLevel: $0.access_level, sealedKey: $0.sealed_key,
                familyWideKind: $0.family_wide_kind, familyWideAccessLevel: $0.family_wide_access_level
            )
        }
    }
}
