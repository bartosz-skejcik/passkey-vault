//
//  CiphertextCacheStore.swift
//  PvShared
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-03, written to the
//  standard `crates/pv-wasm`'s and `crates/pv-ffi`'s own module headers set:
//  every claim here is either enforced by a gate elsewhere in this phase or
//  named as an honest, undemonstrated declaration.
//
//  SYNC-03's ciphertext-only constraint is what this file exists to hold:
//  this store holds EXACTLY what `pv-server` already holds for this
//  account -- ciphertext strings, ids, revisions, timestamps, folder ids,
//  `last_editor_email` -- and NOTHING ELSE. Adding a decrypted field here,
//  a plaintext derivative of one, or anything reachable from the User Key
//  is not a convenience shortcut; it is a design error this type's own
//  shape is meant to make impossible to reach by accident. The User Key
//  itself NEVER touches this file -- no `FfiUserKey`, no wrapping key, no
//  argument named anything that could hold one, anywhere in this type's
//  surface. 39-05's own gate enforces this with an allowlist over every
//  key this store ever writes, plus a live canary shown red (T-39-09).
//
//  AT-REST ATTRIBUTE: `.completeFileProtectionUntilFirstUserAuthentication`
//  ("after first unlock"), not `.completeFileProtection` ("complete"). The
//  reason is the AutoFill extension's own lifecycle, not a security
//  downgrade for its own sake: the extension can be the FIRST thing that
//  runs after a device restart -- before the user has ever entered their
//  passcode this boot -- and that is exactly the window in which the
//  stricter `.complete` class and the after-first-unlock class differ.
//  Data protected `.complete` is inaccessible until the device is unlocked
//  THIS boot; data protected after-first-unlock becomes accessible once,
//  after the first unlock post-boot, and stays reachable across subsequent
//  locks without a further prompt. Choosing `.complete` here would make
//  AutoFill silently fail to offer any credential on every cold-boot-then-
//  autofill-before-first-unlock sequence, for data that is ciphertext, not
//  the secret itself (the User Key, which never lives here, IS gated more
//  strictly, in Keychain, behind Phase 37's own unlock).
//
//  HONESTY NOTE (D-03, D-18, matching `ios/evidence/39/02-branch-gate.md`'s
//  own "Simulator-versus-hardware honesty note", quoted from
//  `39-RESEARCH.md`): the iOS Simulator enforces NO data protection at all.
//  The write-time flag this file specifies is, on this simulator, a
//  DECLARATION, never a demonstrated behaviour -- exactly the posture
//  DR-1's own residual-risk paragraph already disclosed for the App Group
//  capability generally. Nothing in this phase's evidence claims otherwise.
//

import Foundation

/// The store's whole read/write/purge surface -- deliberately three
/// operations, matching DR-39-A's "one blob, written whole and replaced
/// whole" contract: there is no partial-update method to accidentally call.
protocol CiphertextCacheStore {
    /// The current snapshot for `accountId`, or `nil` if none has ever been
    /// written, OR the persisted snapshot belongs to a DIFFERENT account
    /// (D-19), OR it was written against a DIFFERENT `serverBaseURL`
    /// (WR-09, 39-REVIEW.md), OR it carries a `schemaVersion` this build
    /// does not understand (WR-07, 39-REVIEW.md) -- all four report
    /// absence, deliberately indistinguishable to the caller: either way,
    /// there is nothing this account may read on this server, with this
    /// build. Absence is itself distinguishable from an empty-but-present
    /// snapshot: the former returns `nil`, the latter returns a
    /// `CachedSnapshot` whose `items`/`folders` arrays happen to be empty.
    ///
    /// WR-09: `serverBaseURL` exists on `CachedSnapshot` precisely so "a
    /// cache written against one server must never be silently served as
    /// though it came from another" (that field's own doc comment) is an
    /// enforced guard, not merely a recorded fact nothing ever compares.
    func readCurrentSnapshot(accountId: String, serverBaseURL: String) -> CachedSnapshot?

    /// CR-01 (41-REVIEW.md iteration 2): distinguishes a SCOPING rejection (wrong account, wrong
    /// server, or an unrecognized `schemaVersion`) from a genuinely unreadable/undecodable blob.
    /// `readCurrentSnapshot` deliberately folds five different `nil` causes into one signal for
    /// its own callers (see its doc comment); this method exists so a caller that is about to fall
    /// back to an UNSCOPED raw read (`CipherCacheReader.lookupRaw`) can first ask "did the blob
    /// decode fine but simply belong to someone/somewhere/some-schema else?" and refuse instead of
    /// widening. Returns `false` for every "cannot even parse a `CachedSnapshot`" cause (absent
    /// file, unreadable data, malformed JSON) -- ONLY a successfully-decoded-but-scoped-out blob
    /// returns `true`.
    func rawSnapshotIsScopedOut(accountId: String, serverBaseURL: String) -> Bool

    /// Replaces whatever was persisted, in full, in one atomic operation.
    /// Never a partial/merge write (D-15) -- the server sends no deletion
    /// markers, so a merge would keep offering a credential the user
    /// deleted.
    func write(_ snapshot: CachedSnapshot) throws

    /// Deletes the persisted snapshot entirely. Called from the sign-out
    /// path so the cache, the watermark (carried inside the same blob,
    /// D-11) and the session token die together (D-19).
    func purge()
}

enum CiphertextCacheStoreError: Error, CustomStringConvertible {
    case containerUnavailable
    case encodeFailed(Error)
    case writeFailed(Error)

    var description: String {
        switch self {
        case .containerUnavailable:
            return "the App Group container could not be resolved"
        case let .encodeFailed(error):
            return "failed to encode the cache snapshot: \(error)"
        case let .writeFailed(error):
            return "failed to write the cache snapshot: \(error)"
        }
    }
}

/// Branch H (DR-1, `ios/evidence/39/02-branch-gate.md`): the App Group
/// container (`group.cloud.blonie.PasskeyVault`), the SAME identifier
/// `AppGroupProbe.swift` (Phase 36) and both entitlements files already
/// declare -- never a second literal (D-14's discipline, extended to this
/// file).
final class AppGroupCiphertextCacheStore: CiphertextCacheStore {
    /// Mirrors `com.apple.security.application-groups` in
    /// `PasskeyVault.entitlements` and `PasskeyVaultAutoFill.entitlements`,
    /// and `AppGroupProbe.groupIdentifier` (Phase 36). App Group identifiers
    /// carry no team-prefix expansion (unlike the keychain access group,
    /// D-14/L-8), so the same literal is valid in source and in the
    /// entitlements plist.
    static let groupIdentifier = "group.cloud.blonie.PasskeyVault"

    /// Internal, not `private` (plan 39-03, Task 1's own live proof,
    /// `scripts/ios-sync-live-proof.sh` via `SyncTracerLiveProofTests.swift`):
    /// the D-14 discipline against a duplicated magic literal applies to
    /// TEST code too -- the live proof reads this exact file, on the exact
    /// path this constant names, rather than retyping the filename a second
    /// time.
    static let fileName = "vault-cache-v1.json"

    /// WR-05 (39-REVIEW.md): a SEPARATE, tiny, non-ciphertext file --
    /// `accountId`/`serverBaseURL` ONLY, never anything reachable from a
    /// User Key -- written alongside every successful `write(_:)`. The
    /// AutoFill extension carries no session/account context in this
    /// milestone (FILL-03 is still unimplemented), so its production
    /// freshness read (`CredentialProviderViewController
    /// .renderFreshnessSurface()`) has no `accountId` to pass to the
    /// account-scoped `readCurrentSnapshot(accountId:serverBaseURL:)` --
    /// this marker is what lets it discover one WITHOUT falling back to
    /// `CacheColdReadProbe`'s raw, unscoped read (that probe's own header:
    /// "exists precisely because it skips readCurrentSnapshot's
    /// cross-account rejection" -- correct for the evidence sequence,
    /// wrong for production). Deliberately outside `vault-cache-v1.json`'s
    /// own JSON shape, so `scripts/audit-ios-cache-ciphertext.sh`'s closed
    /// key allowlist (scoped to that one file) is untouched by this fix.
    static let currentAccountMarkerFileName = "vault-cache-v1-current-account.json"

    private struct CurrentAccountMarker: Codable {
        let accountId: String
        let serverBaseURL: String
    }

    private let fileManager: FileManager

    init(fileManager: FileManager = .default) {
        self.fileManager = fileManager
    }

    private func containerURL() -> URL? {
        fileManager.containerURL(forSecurityApplicationGroupIdentifier: Self.groupIdentifier)
    }

    private func fileURL() -> URL? {
        containerURL()?.appendingPathComponent(Self.fileName)
    }

    private func currentAccountMarkerURL() -> URL? {
        containerURL()?.appendingPathComponent(Self.currentAccountMarkerFileName)
    }

    /// WR-05 (39-REVIEW.md): the account-id/server pair the marker file
    /// above carries, or `nil` if it has never been written (a fresh
    /// container) or is unreadable/undecodable -- absence, not a crash or a
    /// fallback to an unscoped read.
    func currentAccountMarker() -> (accountId: String, serverBaseURL: String)? {
        guard
            let url = currentAccountMarkerURL(),
            let data = try? Data(contentsOf: url),
            let marker = try? JSONDecoder().decode(CurrentAccountMarker.self, from: data)
        else {
            return nil
        }
        return (marker.accountId, marker.serverBaseURL)
    }

    func readCurrentSnapshot(accountId: String, serverBaseURL: String) -> CachedSnapshot? {
        guard let url = fileURL(), fileManager.fileExists(atPath: url.path) else {
            return nil
        }
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard let snapshot = try? JSONDecoder().decode(CachedSnapshot.self, from: data) else {
            return nil
        }
        // WR-07 (39-REVIEW.md): D-21's stated purpose ("Phase 40 can extend
        // this shape ... without forcing a cache wipe on every device that
        // has already synced once") requires this field to actually be
        // CHECKED, not merely written -- a future v2 blob whose keys are a
        // superset of v1's would otherwise decode as v1 and be served as
        // current, and a v1 blob read by a v2 build would be served as v2.
        guard snapshot.schemaVersion == CachedSnapshot.currentSchemaVersion else { return nil }
        // D-19: a snapshot written for one account is REJECTED, not
        // returned, when read under a different account identifier.
        guard snapshot.accountId == accountId else { return nil }
        // WR-09 (39-REVIEW.md): same discipline, for the server it was
        // pulled from -- `serverBaseURL`'s own doc comment states the
        // reason this field exists; before this fix, nothing compared it.
        guard snapshot.serverBaseURL == serverBaseURL else { return nil }
        return snapshot
    }

    /// CR-01 (41-REVIEW.md iteration 2): re-decodes the same on-disk blob `readCurrentSnapshot`
    /// just rejected, WITHOUT re-applying the scoping checks, so a caller can tell a scoping
    /// rejection apart from a decode failure. Deliberately re-reads rather than caching the
    /// intermediate `CachedSnapshot?` from `readCurrentSnapshot` -- this store has no per-call
    /// state, and the two reads are cheap (a small on-disk JSON blob), so correctness (never
    /// stale) wins over the marginal cost of a second parse.
    func rawSnapshotIsScopedOut(accountId: String, serverBaseURL: String) -> Bool {
        guard let url = fileURL(), fileManager.fileExists(atPath: url.path) else { return false }
        guard let data = try? Data(contentsOf: url) else { return false }
        guard let snapshot = try? JSONDecoder().decode(CachedSnapshot.self, from: data) else {
            return false
        }
        // The blob decoded as SOME valid `CachedSnapshot` -- if it fails any of the three scoping
        // checks `readCurrentSnapshot` itself applies, this is a scoping rejection, not a decode
        // failure, and the caller must refuse the read rather than widen it.
        if snapshot.schemaVersion != CachedSnapshot.currentSchemaVersion { return true }
        if snapshot.accountId != accountId { return true }
        if snapshot.serverBaseURL != serverBaseURL { return true }
        return false
    }

    /// One atomic write with the file-protection attribute set in the SAME
    /// call (`Data.WritingOptions.completeFileProtectionUntilFirstUserAuthentication`
    /// combined with `.atomic`) -- not a write followed by a separate
    /// `setAttributes` call, which would leave a window where the freshly
    /// written file carries no explicit protection class at all.
    func write(_ snapshot: CachedSnapshot) throws {
        guard let url = fileURL() else {
            throw CiphertextCacheStoreError.containerUnavailable
        }
        let data: Data
        do {
            data = try JSONEncoder().encode(snapshot)
        } catch {
            throw CiphertextCacheStoreError.encodeFailed(error)
        }
        do {
            try data.write(
                to: url,
                options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication]
            )
        } catch {
            throw CiphertextCacheStoreError.writeFailed(error)
        }
        // WR-05: best-effort -- a failure here must never fail the write
        // above (the real cache write already succeeded and is the thing
        // that matters); it only means the extension's freshness surface
        // falls back to "Not synced yet" until the next successful pull
        // updates the marker too.
        if let markerURL = currentAccountMarkerURL(),
           let markerData = try? JSONEncoder().encode(
               CurrentAccountMarker(accountId: snapshot.accountId, serverBaseURL: snapshot.serverBaseURL)
           ) {
            try? markerData.write(to: markerURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    func purge() {
        if let url = fileURL() {
            try? fileManager.removeItem(at: url)
        }
        // WR-05/D-19: the marker dies with the cache and the session token
        // on sign-out too -- a stale marker surviving a purge would point
        // the extension's freshness read at an account whose cache no
        // longer exists.
        if let markerURL = currentAccountMarkerURL() {
            try? fileManager.removeItem(at: markerURL)
        }
    }
}

/// Test/default-argument seam only: never wired into a real account flow.
/// Lets `VaultStore`'s existing unit-test call sites (`VaultStore(userKey:
/// api:)`, pre-39-03) keep compiling and behaving exactly as before --
/// "no cache configured" -- without every one of them needing to learn
/// about this phase's two new constructor parameters.
final class NullCiphertextCacheStore: CiphertextCacheStore {
    func readCurrentSnapshot(accountId: String, serverBaseURL: String) -> CachedSnapshot? { nil }
    func rawSnapshotIsScopedOut(accountId: String, serverBaseURL: String) -> Bool { false }
    func write(_ snapshot: CachedSnapshot) throws {}
    func purge() {}
}
