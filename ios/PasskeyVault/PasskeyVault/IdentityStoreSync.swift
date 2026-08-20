//
//  IdentityStoreSync.swift
//  PasskeyVault
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-03. Host-app side of
//  the identity-store round trip (F2/Pitfall 2, `41-RESEARCH.md`): the CURRENT,
//  `[any ASCredentialIdentity]`-typed `saveCredentialIdentities` overload only. The array below is
//  typed as the protocol-existential element type, NEVER `[ASPasswordCredentialIdentity]` -- the
//  two overloads share a Swift base name and IDENTICAL argument labels, differing ONLY by that
//  element type, so a literal `[ASPasswordCredentialIdentity]` array silently binds the
//  DEPRECATED selector with no compiler warning strong enough to catch by inspection alone.
//
//  This task registers EXACTLY ONE identity, for the tracer item -- 41-04 turns this into the
//  complete, every-mutation choke point; this file's own entry point is written so that widening
//  is additive, not a rewrite.
//
//  `state()` is checked FIRST; a disabled store is a RECORDED CONDITION (`.storeDisabled`), never
//  a swallowed error.
//

import AuthenticationServices
import Foundation
import os

enum IdentityStoreSyncError: Swift.Error, CustomStringConvertible {
    case storeDisabled
    case saveFailed(Swift.Error)

    var description: String {
        switch self {
        case .storeDisabled: return "ASCredentialIdentityStore is disabled"
        case let .saveFailed(error): return "saveCredentialIdentities failed: \(error)"
        }
    }
}

enum IdentityStoreSync {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// Registers ONE `ASPasswordCredentialIdentity`, current overload only (F2). `recordIdentifier`
    /// MUST round-trip verbatim -- it is `CipherCacheReader`'s own cache lookup key
    /// (`request.credentialIdentity.recordIdentifier` on the fill path).
    @discardableResult
    static func registerTracerIdentity(
        serviceIdentifier: String,
        user: String,
        recordIdentifier: String
    ) async -> Swift.Result<Void, IdentityStoreSyncError> {
        let state = await ASCredentialIdentityStore.shared.state()
        guard state.isEnabled else {
            logger.log("PVFILL|stage=identity-register status=store-disabled")
            return .failure(.storeDisabled)
        }

        let identity = ASPasswordCredentialIdentity(
            serviceIdentifier: ASCredentialServiceIdentifier(identifier: serviceIdentifier, type: .domain),
            user: user,
            recordIdentifier: recordIdentifier
        )
        // The `[any ASCredentialIdentity]` overload -- see this file's header (F2). A literal
        // `[ASPasswordCredentialIdentity]` binds the DEPRECATED one with no label difference.
        let identities: [any ASCredentialIdentity] = [identity]

        do {
            try await ASCredentialIdentityStore.shared.saveCredentialIdentities(identities)
            logger.log(
                "PVFILL|stage=identity-register status=ok record=\(recordIdentifier, privacy: .public)"
            )
            return .success(())
        } catch {
            logger.error(
                "PVFILL|stage=identity-register status=fail error=\(String(describing: error), privacy: .public)"
            )
            return .failure(.saveFailed(error))
        }
    }

    /// Receiver-side verification (QA-03): reads the store back and confirms OUR identity is
    /// present with the EXACT `user`/`recordIdentifier` written -- never "no error was thrown".
    static func verifyTracerIdentity(user: String, recordIdentifier: String) async -> Bool {
        let identities = await ASCredentialIdentityStore.shared.credentialIdentities(
            forService: nil, credentialIdentityTypes: .password
        )
        return identities.contains { identity in
            guard let password = identity as? ASPasswordCredentialIdentity else { return false }
            return password.user == user && password.recordIdentifier == recordIdentifier
        }
    }
}
