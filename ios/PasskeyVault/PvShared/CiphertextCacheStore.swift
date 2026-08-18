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
    /// written OR the persisted snapshot belongs to a DIFFERENT account
    /// (D-19) -- both report absence, deliberately indistinguishable to the
    /// caller: either way, there is nothing this account may read. Absence
    /// is itself distinguishable from an empty-but-present snapshot: the
    /// former returns `nil`, the latter returns a `CachedSnapshot` whose
    /// `items`/`folders` arrays happen to be empty.
    func readCurrentSnapshot(accountId: String) -> CachedSnapshot?

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

    func readCurrentSnapshot(accountId: String) -> CachedSnapshot? {
        guard let url = fileURL(), fileManager.fileExists(atPath: url.path) else {
            return nil
        }
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard let snapshot = try? JSONDecoder().decode(CachedSnapshot.self, from: data) else {
            return nil
        }
        // D-19: a snapshot written for one account is REJECTED, not
        // returned, when read under a different account identifier.
        guard snapshot.accountId == accountId else { return nil }
        return snapshot
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
    }

    func purge() {
        guard let url = fileURL() else { return }
        try? fileManager.removeItem(at: url)
    }
}

/// Test/default-argument seam only: never wired into a real account flow.
/// Lets `VaultStore`'s existing unit-test call sites (`VaultStore(userKey:
/// api:)`, pre-39-03) keep compiling and behaving exactly as before --
/// "no cache configured" -- without every one of them needing to learn
/// about this phase's two new constructor parameters.
final class NullCiphertextCacheStore: CiphertextCacheStore {
    func readCurrentSnapshot(accountId: String) -> CachedSnapshot? { nil }
    func write(_ snapshot: CachedSnapshot) throws {}
    func purge() {}
}
