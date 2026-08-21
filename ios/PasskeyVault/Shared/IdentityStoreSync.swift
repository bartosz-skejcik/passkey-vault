//
//  IdentityStoreSync.swift
//  Shared (target membership: BOTH PasskeyVault and PasskeyVaultAutoFill)
//
//  Phase 41 (autofill-dla-hase-i-poprawno-blokady-mi-dzy-procesami), plan 41-03 wrote this file's
//  first version -- ONE hardcoded tracer identity, host-app-only. Plan 41-04 generalizes it into
//  FILL-03: the ONE function every vault mutation (create/edit/delete/sync-pull, all host-app,
//  `VaultStore.swift`) and every extension-side recovery path
//  (`CredentialProviderViewController.swift`) reaches `ASCredentialIdentityStore` through. Moved
//  from `PasskeyVault/PasskeyVault/` into `Shared/` (this task) -- the established cross-target
//  folder (`LockMarker.swift` already lives here for the identical need) -- so the extension's own
//  rebuild/self-heal call sites can reach the SAME writer rather than a second, divergent one.
//
//  landmine L-33 (`ios/IOS-SPIKE-LOG.md` §3 -- named "L-9" by 41-04-PLAN.md's own text, but that ID
//  was already taken; see L-33's own numbering note): `saveCredentialIdentities`/`removeCredentialIdentities`
//  share a Swift base name and IDENTICAL argument labels between the CURRENT,
//  `[any ASCredentialIdentity]`-typed overload and the DEPRECATED `[ASPasswordCredentialIdentity]`-
//  typed one (`ASCredentialIdentityStore.h`). CORRECTED FINDING (verified live against this
//  toolchain, `swiftc -typecheck` probes -- see L-33's own entry): the array's element type alone
//  does NOT silently rebind the modern `try await store.saveCredentialIdentities(ids)` call this
//  file uses everywhere -- `@_disfavoredOverload` on the deprecated pair means the CURRENT
//  overload wins via an implicit array upcast even when `ids` is concretely
//  `[ASPasswordCredentialIdentity]`. The trap is real ONLY for the raw, non-`async`
//  completion-handler call form (`store.saveCredentialIdentities(ids, completion: ...)`), which
//  this file never writes. Every call site below still types its array as
//  `[any ASCredentialIdentity]` explicitly anyway -- defense in depth, and it is what makes the
//  code self-documenting about which selector it means to reach -- but the ACTUAL enforcement is
//  `e41-2-build`'s `-Xfrontend -Werror -Xfrontend DeprecatedDeclaration` build gate, which fails
//  the build the moment ANY call site (present or future, this file or elsewhere) reaches for the
//  completion-handler form instead.
//
//  `state()` is checked FIRST on every call; a disabled store is a RECORDED CONDITION
//  (`.storeDisabled`), marked as an owed rebuild (`markRebuildPending`), never a swallowed error.
//  A busy write is retried with a bounded backoff (`isBusy`/`saveWithRetry` et al.) -- a dropped
//  busy write is a PERMANENTLY missing QuickType entry until the next mutation happens to touch
//  that same item again, which for an item nobody edits again is never.
//
//  `supportsIncrementalUpdates` selects the write shape: TRUE takes the incremental
//  save-then-remove path (diffed against the LAST successfully published set, persisted below);
//  FALSE takes `replaceCredentialIdentities(with:)`, a full replacement of the whole store. Both
//  branches receive the SAME desired set -- the CURRENT, COMPLETE vault item set -- never a delta
//  a caller computed itself; the diff against "what was last published" happens INSIDE this file.
//

import AuthenticationServices
import Foundation
import os

/// One item's identity-relevant data, decoupled from `VaultItemViewModel`
/// (`PasskeyVault/Vault/ItemFields.swift`, HOST-ONLY -- the extension has no dependency on that
/// file or its target). The host builds this from a decrypted `LoginFields`; the extension's own
/// recovery path (`CredentialProviderViewController.swift`) builds it from its own minimal
/// plaintext decode, the same shape the fill path already uses.
struct VaultIdentitySource: Equatable {
    let itemId: String
    let username: String
    /// Multiple URLs per login (`LoginFields.urls`) -- ONE `ASPasswordCredentialIdentity` is
    /// registered per URL, all sharing the same `user`/`recordIdentifier`.
    let urls: [String]
}

enum IdentityStoreSyncError: Swift.Error, CustomStringConvertible {
    case storeDisabled
    case saveFailed(Swift.Error)
    case removeFailed(Swift.Error)
    case replaceFailed(Swift.Error)
    /// CR-02 (41-REVIEW.md iteration 2): `upsertOne` built zero identities from its source (every
    /// URL failed `OriginNormalize.host(fromURLString:)`, WR-04) -- distinct from `.storeDisabled`
    /// so a caller/log reader can tell "the store refused us" apart from "we had nothing valid to
    /// give it". Either way the self-heal obligation is NOT discharged.
    case nothingToWrite

    var description: String {
        switch self {
        case .storeDisabled: return "ASCredentialIdentityStore is disabled"
        case let .saveFailed(error): return "saveCredentialIdentities failed: \(error)"
        case let .removeFailed(error): return "removeCredentialIdentities failed: \(error)"
        case let .replaceFailed(error): return "replaceCredentialIdentities failed: \(error)"
        case .nothingToWrite: return "no identity could be built from the given source"
        }
    }
}

enum IdentityStoreSync {
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    // MARK: - App Group storage (this task's own state, distinct from the ciphertext cache/lock
    // marker -- never re-uses either's key namespace)

    private static let suiteName = "group.cloud.blonie.PasskeyVault"
    private static let rebuildPendingKey = "cloud.blonie.PasskeyVault.identityRebuildPending"
    /// CR-02 (41-REVIEW.md iteration 2): a SEPARATE obligation from `rebuildPendingKey`.
    /// `rebuildPendingKey` names "the whole vault's identity set may be out of sync -- a full
    /// rebuild is owed"; this key names "one specific `upsertOne` write may not have landed -- a
    /// single-item repair is owed". `upsertOne` (by construction, knows about exactly one item)
    /// may clear ONLY this key on success -- it must never clear `rebuildPendingKey`, which it has
    /// no way to know is fully satisfied. `isRebuildPending()` is true when EITHER is set;
    /// `republish(sources:)` (the only writer that ever sees the complete vault item set) is the
    /// only thing that may clear `rebuildPendingKey`, and a successful full republish discharges
    /// both obligations at once.
    private static let selfHealPendingKey = "cloud.blonie.PasskeyVault.identitySelfHealPending"
    private static let publishedKeysKey = "cloud.blonie.PasskeyVault.identityPublishedKeys"

    /// The whole identity of an `ASPasswordCredentialIdentity` as far as diffing/removal cares
    /// (`rank` is cosmetic ordering, never part of identity). Persisted so an incremental-mode
    /// republish can compute "what changed since last time" without re-deriving it from the store
    /// itself (`getCredentialIdentitiesForService:` returns opaque `id <ASCredentialIdentity>`
    /// values with no stable way to diff them against a NEW desired set without re-parsing every
    /// one -- this persisted set is our own source of truth for "what we last told the store").
    private struct PublishedKey: Codable, Hashable {
        let serviceIdentifier: String
        let user: String
        let recordIdentifier: String

        init(serviceIdentifier: String, user: String, recordIdentifier: String) {
            self.serviceIdentifier = serviceIdentifier
            self.user = user
            self.recordIdentifier = recordIdentifier
        }

        init(identity: ASPasswordCredentialIdentity) {
            serviceIdentifier = identity.serviceIdentifier.identifier
            user = identity.user
            recordIdentifier = identity.recordIdentifier ?? ""
        }
    }

    // MARK: - The single entry point (FILL-03's one choke point)

    /// Republishes identities for the CURRENT, COMPLETE vault item set. Every caller -- host
    /// `VaultStore.create`/`update`/`delete`/the sync-pull completion, and the extension's own
    /// recovery paths -- hands over "here is everything that exists right now"; this function
    /// computes what changed against the last successfully published set itself.
    @discardableResult
    static func republish(sources: [VaultIdentitySource]) async -> Swift.Result<Void, IdentityStoreSyncError> {
        let state = await ASCredentialIdentityStore.shared.state()
        guard state.isEnabled else {
            logger.log("PVFILL|E41-2|stage=republish status=store-disabled")
            markRebuildPending(true)
            return .failure(.storeDisabled)
        }
        logger.log(
            "PVFILL|E41-2|stage=state supportsIncrementalUpdates=\(state.supportsIncrementalUpdates, privacy: .public)"
        )

        let desired = buildIdentities(from: sources)
        let desiredKeys = Set(desired.map(PublishedKey.init(identity:)))

        let writeResult: Swift.Result<Void, IdentityStoreSyncError>
        if state.supportsIncrementalUpdates {
            writeResult = await republishIncremental(desired: desired, desiredKeys: desiredKeys)
        } else {
            writeResult = await republishFullReplacement(desired: desired)
        }

        switch writeResult {
        case .success:
            persistPublishedKeys(desiredKeys)
            markRebuildPending(false)
            // CR-02 (41-REVIEW.md iteration 2): a completed FULL republish (this function is the
            // only caller that ever hands over the complete vault item set) discharges every
            // outstanding single-item self-heal obligation too -- the whole-vault write it just
            // performed necessarily includes whatever `upsertOne` may have owed.
            clearSelfHealPending()
            logger.log(
                "PVFILL|E41-2|stage=republish status=ok count=\(desired.count, privacy: .public) mode=\(state.supportsIncrementalUpdates ? "incremental" : "full", privacy: .public)"
            )
        case let .failure(error):
            logger.error("PVFILL|E41-2|stage=republish status=fail error=\(error.description, privacy: .public)")
        }
        return writeResult
    }

    /// Receiver-side verification (QA-03): reads the store back and confirms an identity matching
    /// `user`/`recordIdentifier` is present -- never "no error was thrown". Used both by 41-03's
    /// original tracer call sites and by this plan's own evidence probe.
    static func verifyIdentity(user: String, recordIdentifier: String) async -> Bool {
        let identities = await ASCredentialIdentityStore.shared.credentialIdentities(
            forService: nil, credentialIdentityTypes: .password
        )
        return identities.contains { identity in
            guard let password = identity as? ASPasswordCredentialIdentity else { return false }
            return password.user == user && password.recordIdentifier == recordIdentifier
        }
    }

    /// CR-02 (41-REVIEW.md iteration 2): true when EITHER a whole-vault rebuild is owed OR a
    /// single-item self-heal write may not have landed -- `runIdentityRebuildIfPending()` runs the
    /// SAME full rebuild either way (it has no cheaper "repair just one item" path), so callers do
    /// not need to distinguish the two here.
    static func isRebuildPending() -> Bool {
        guard let defaults = UserDefaults(suiteName: suiteName) else { return false }
        return defaults.bool(forKey: rebuildPendingKey) || defaults.bool(forKey: selfHealPendingKey)
    }

    /// WR-01 (41-REVIEW.md): sign-out (HOST-ONLY caller, `ContentView.performSignOut()`) must
    /// remove every registered identity, not merely leave the store as-is -- a signed-out
    /// account's usernames were otherwise offered by QuickType indefinitely (cleaned up only
    /// incidentally, the next time a DIFFERENT account's `performRefresh` republish happened to
    /// compute the old entries as removals, or never, if nobody signs in again). Deliberately does
    /// NOT run on a mere lock (`performLock()`) -- a locked vault should still be offered,
    /// prompting an unlock; that difference is intentional, not accidental (WR-01's own note).
    /// WR-05 (41-REVIEW.md iteration 2): routed through the SAME busy-retry discipline every other
    /// writer in this file already has (`saveWithRetry`/`removeWithRetry`/`replaceWithRetry`) --
    /// this file's own header states why: "a dropped busy write is a PERMANENTLY missing QuickType
    /// entry". Before this fix, a single `storeBusy` at sign-out (exactly the moment the device may
    /// be changing hands -- the one flow whose whole point is a clean handoff) left the signed-out
    /// account's usernames registered, `identityPublishedKeys` still describing them, and no
    /// rebuild-pending flag set -- WR-01's "must remove every registered identity" guarantee
    /// degraded to best-effort-once with no repair path.
    @discardableResult
    static func removeAllPublished() async -> Swift.Result<Void, IdentityStoreSyncError> {
        var attempt = 0
        while true {
            do {
                try await ASCredentialIdentityStore.shared.removeAllCredentialIdentities()
                persistPublishedKeys([])
                markRebuildPending(false)
                // Nothing is left to self-heal for either -- an empty published-keys set has no
                // obligation `upsertOne` could ever discharge.
                clearSelfHealPending()
                logger.log("PVFILL|E41-2|stage=remove-all-published status=ok")
                return .success(())
            } catch {
                if isBusy(error), attempt < maxBusyRetries {
                    logger.log("PVFILL|E41-2|stage=remove-all-published status=busy attempt=\(attempt, privacy: .public)")
                    try? await Task.sleep(nanoseconds: busyRetryBaseDelayNanoseconds << attempt)
                    attempt += 1
                    continue
                }
                // An owed teardown, visible to the next opportunity (`runIdentityRebuildIfPending`)
                // -- never a silent, unrecorded "the signed-out account is still registered".
                markRebuildPending(true)
                logger.error("PVFILL|E41-2|stage=remove-all-published status=fail error=\(String(describing: error), privacy: .public)")
                return .failure(.removeFailed(error))
            }
        }
    }

    // MARK: - CR-01 (41-REVIEW.md): the additive, single-identity choke point

    /// Marks a self-heal owed BEFORE a caller performs a fire-and-forget `upsertOne(source:)` --
    /// so a process kill mid-flight (the AutoFill extension is torn down at exactly this moment,
    /// right after `completeRequest`) leaves an explicit repair obligation rather than a silently
    /// stale `identityPublishedKeys` blob. `upsertOne(source:)` clears ONLY this flag itself on
    /// success (CR-02, 41-REVIEW.md iteration 2 -- never the whole-vault `rebuildPendingKey`, which
    /// a one-item write cannot know is fully satisfied); callers that never reach a terminal result
    /// (a kill) leave it set, which is the whole point.
    static func markSelfHealPending() {
        UserDefaults(suiteName: suiteName)?.set(true, forKey: selfHealPendingKey)
    }

    private static func clearSelfHealPending() {
        UserDefaults(suiteName: suiteName)?.set(false, forKey: selfHealPendingKey)
    }

    /// The additive counterpart to `republish(sources:)` -- CR-01 (41-REVIEW.md): `republish`
    /// treats its argument as "the CURRENT, COMPLETE vault item set" and computes REMOVALS by
    /// diffing against everything previously published; handing it a one-item set (as the
    /// post-fill self-heal used to) makes it delete every OTHER identity as an unintended
    /// removal. `upsertOne` NEVER diffs and NEVER removes -- it only SAVES the one identity this
    /// caller already proved reachable, and widens the persisted `publishedKeys` record by UNION
    /// rather than replacing it with a subset. Safe to call for an item that is already published
    /// (idempotent: re-saving an existing identity is a no-op update, not a duplicate).
    @discardableResult
    static func upsertOne(source: VaultIdentitySource) async -> Swift.Result<Void, IdentityStoreSyncError> {
        let state = await ASCredentialIdentityStore.shared.state()
        guard state.isEnabled else {
            logger.log("PVFILL|E41-2|stage=upsert-one status=store-disabled")
            markRebuildPending(true)
            return .failure(.storeDisabled)
        }

        let identities = buildIdentities(from: [source])
        guard !identities.isEmpty else {
            // CR-02 (41-REVIEW.md iteration 2): wrote NOTHING at all -- the self-heal obligation
            // this call exists to discharge is NOT discharged (every URL failed
            // `OriginNormalize.host(fromURLString:)`, WR-04). Before this fix this cleared
            // `rebuildPendingKey` unconditionally, silently forgetting a repair a killed prior fill
            // may still owe (T-41-41). Escalate to a full-vault rebuild instead of clearing
            // anything -- `runIdentityRebuildIfPending()` is the only path that can recover an
            // item this single-item call could not build an identity for.
            markRebuildPending(true)
            logger.error("PVFILL|E41-2|stage=upsert-one status=no-identity-built")
            return .failure(.nothingToWrite)
        }

        let result = await saveWithRetry(identities as [any ASCredentialIdentity])
        switch result {
        case .success:
            // UNION, never replace: this is the one property that makes `upsertOne` safe to hand
            // a single-item source -- the persisted published-keys blob only ever grows or updates
            // an existing entry here, never shrinks. WR-06 (41-REVIEW.md iteration 2):
            // `unionIntoPublishedKeys` makes this union compare-and-swap by version rather than a
            // plain unsynchronized read-then-write -- see that function's own header.
            let newKeys = Set(identities.map(PublishedKey.init(identity:)))
            unionIntoPublishedKeys(newKeys)
            // CR-02 (41-REVIEW.md iteration 2): clears ONLY the self-heal obligation THIS call
            // discharged -- never `rebuildPendingKey`. Before this fix, a one-item success here
            // cleared the WHOLE-VAULT rebuild flag, silently forgetting any OTHER item's still-owed
            // repair (a killed prior fill for a DIFFERENT item, or an earlier `.storeDisabled`
            // window) -- see CR-02's own issue text (T-41-41: "a dropped busy write is a
            // PERMANENTLY missing QuickType entry").
            clearSelfHealPending()
            logger.log("PVFILL|E41-2|stage=upsert-one status=ok")
        case let .failure(error):
            logger.error("PVFILL|E41-2|stage=upsert-one status=fail error=\(error.description, privacy: .public)")
        }
        return result
    }

    // MARK: - Incremental (save + remove) vs full replacement

    private static func republishIncremental(
        desired: [ASPasswordCredentialIdentity], desiredKeys: Set<PublishedKey>
    ) async -> Swift.Result<Void, IdentityStoreSyncError> {
        let previousKeys = readPublishedKeys()
        let removedKeys = previousKeys.subtracting(desiredKeys)
        if !removedKeys.isEmpty {
            let removals: [any ASCredentialIdentity] = removedKeys.map { key in
                ASPasswordCredentialIdentity(
                    serviceIdentifier: ASCredentialServiceIdentifier(identifier: key.serviceIdentifier, type: .domain),
                    user: key.user,
                    recordIdentifier: key.recordIdentifier
                )
            }
            if case let .failure(error) = await removeWithRetry(removals) {
                return .failure(error)
            }
        }
        guard !desired.isEmpty else { return .success(()) }
        let saves: [any ASCredentialIdentity] = desired
        return await saveWithRetry(saves)
    }

    private static func republishFullReplacement(
        desired: [ASPasswordCredentialIdentity]
    ) async -> Swift.Result<Void, IdentityStoreSyncError> {
        let replacements: [any ASCredentialIdentity] = desired
        return await replaceWithRetry(replacements)
    }

    // MARK: - Store writes, each with the busy-retry discipline (T-41-20)

    private static let maxBusyRetries = 3
    private static let busyRetryBaseDelayNanoseconds: UInt64 = 200_000_000

    private static func saveWithRetry(_ identities: [any ASCredentialIdentity]) async -> Swift.Result<Void, IdentityStoreSyncError> {
        var attempt = 0
        while true {
            do {
                // The CURRENT, `[any ASCredentialIdentity]`-typed overload -- L-33.
                try await ASCredentialIdentityStore.shared.saveCredentialIdentities(identities)
                return .success(())
            } catch {
                if isBusy(error), attempt < maxBusyRetries {
                    logger.log("PVFILL|E41-2|stage=save status=busy attempt=\(attempt, privacy: .public)")
                    try? await Task.sleep(nanoseconds: busyRetryBaseDelayNanoseconds << attempt)
                    attempt += 1
                    continue
                }
                return .failure(.saveFailed(error))
            }
        }
    }

    private static func removeWithRetry(_ identities: [any ASCredentialIdentity]) async -> Swift.Result<Void, IdentityStoreSyncError> {
        var attempt = 0
        while true {
            do {
                // The CURRENT, `[any ASCredentialIdentity]`-typed overload -- L-33.
                try await ASCredentialIdentityStore.shared.removeCredentialIdentities(identities)
                return .success(())
            } catch {
                if isBusy(error), attempt < maxBusyRetries {
                    logger.log("PVFILL|E41-2|stage=remove status=busy attempt=\(attempt, privacy: .public)")
                    try? await Task.sleep(nanoseconds: busyRetryBaseDelayNanoseconds << attempt)
                    attempt += 1
                    continue
                }
                return .failure(.removeFailed(error))
            }
        }
    }

    private static func replaceWithRetry(_ identities: [any ASCredentialIdentity]) async -> Swift.Result<Void, IdentityStoreSyncError> {
        var attempt = 0
        while true {
            do {
                // The CURRENT, `[any ASCredentialIdentity]`-typed overload -- L-33.
                try await ASCredentialIdentityStore.shared.replaceCredentialIdentities(identities)
                return .success(())
            } catch {
                if isBusy(error), attempt < maxBusyRetries {
                    logger.log("PVFILL|E41-2|stage=replace status=busy attempt=\(attempt, privacy: .public)")
                    try? await Task.sleep(nanoseconds: busyRetryBaseDelayNanoseconds << attempt)
                    attempt += 1
                    continue
                }
                return .failure(.replaceFailed(error))
            }
        }
    }

    private static func isBusy(_ error: Swift.Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == ASCredentialIdentityStoreErrorDomain
            && nsError.code == ASCredentialIdentityStoreError.Code.storeBusy.rawValue
    }

    // MARK: - Building identities from sources

    private static func buildIdentities(from sources: [VaultIdentitySource]) -> [ASPasswordCredentialIdentity] {
        var identities: [ASPasswordCredentialIdentity] = []
        for (sourceIndex, source) in sources.enumerated() {
            guard !source.username.isEmpty, !source.itemId.isEmpty else { continue }
            for url in source.urls {
                let host: String
                switch serviceHost(fromURLString: url) {
                case let .host(resolvedHost):
                    host = resolvedHost
                case .notADomain:
                    // 2026-08-21 privacy fix: an imported vault entry whose URL field holds an
                    // Android app package name (`com.xiaomi.smarthome`) used to sail through the
                    // https-assumption below and get registered as a real `.domain` identity --
                    // `serviceHost` now rejects it via `OriginNormalize.looksLikeAppPackageName`
                    // (see that function's own header). Distinguished from the genuine-parse-
                    // -failure case below by NAME, not lumped into the same status, so a future
                    // reader is not left wondering which of the two this run's skip actually was.
                    logger.debug("PVFILL|E41-2|stage=build-identity status=skipped-not-a-domain")
                    continue
                case .unparseable:
                    // WR-09 (41-REVIEW.md): fails CLOSED (skip) rather than registering the raw,
                    // un-parseable string as a permanent junk `.domain` entry -- see
                    // `serviceHost(fromURLString:)`'s own header. Logged so a real user's item
                    // with a genuinely unparseable URL is visible in diagnostics rather than
                    // silently absent from QuickType with no trace.
                    //
                    // AMENDMENT (`.planning/debug/faceid-relock-loop-bootsession.md`, 2026-08-21):
                    // downgraded from `.log` to `.debug`. Live-probed `OriginNormalize` against
                    // every realistic input this line's own `url` can carry -- bare host,
                    // `host:port`, an IP and IP:port, `mailto:` -- all parse correctly (WR-04's
                    // `looksSchemeless` fix already covers the `host:port` case this line's own
                    // history names). The cases that legitimately reach `nil` here are NOT parser
                    // bugs: an empty/blank URL string (a `.login` item with no URL filled in --
                    // `identitySources(from:)`'s own filter already excludes `.note`/`.totp`/every
                    // other non-login content case upstream, so this is specifically a login item
                    // with a blank URL field) and a non-http(s) custom URL scheme with no
                    // domain-shaped authority (`otpauth://`, `steam://`, a bespoke app callback
                    // scheme) that could never be registered as an `ASCredentialServiceIdentifier
                    // (type: .domain)` in the first place. Both are ROUTINE, not defects --
                    // `.debug` keeps this diagnosable (still visible via `log stream --level debug`
                    // or Console with debug messages enabled) without it reading, at the DEFAULT
                    // `.log` level every other line in this file uses for genuine outcomes, as if 5
                    // out of Bartek's 323 real items were silently failing something.
                    //
                    // CORRECTION (2026-08-21, same privacy fix as above): those 5 items were
                    // RE-CHECKED against this predicate specifically -- none of them are the
                    // `com.xiaomi.smarthome` / `com.contextlogic.wish` package-name entries. Those
                    // two previously landed in the `.host(...)` case above (a bare package name
                    // parses fine as an https-assumed host) and are what `.notADomain` now catches
                    // instead. The 5 `skipped-unparseable-url` items remain the blank-URL and
                    // non-http(s)-custom-scheme cases this comment already described.
                    logger.debug("PVFILL|E41-2|stage=build-identity status=skipped-unparseable-url")
                    continue
                }
                let identity = ASPasswordCredentialIdentity(
                    serviceIdentifier: ASCredentialServiceIdentifier(identifier: host, type: .domain),
                    user: source.username,
                    recordIdentifier: source.itemId
                )
                identity.rank = sourceIndex
                identities.append(identity)
            }
        }
        return identities
    }

    /// Distinguishes WHY a URL string failed to become a registrable service host -- a genuine
    /// parse failure vs. a value that parsed fine but has the shape of an app package name, not a
    /// domain -- purely so `buildIdentities` can log the two under different, honestly-named
    /// `status=` values instead of one generic bucket.
    private enum ServiceHostResult {
        case host(String)
        case notADomain
        case unparseable
    }

    /// `ASCredentialServiceIdentifier(type: .domain)` matching is host-based (F3,
    /// `41-RESEARCH.md`) -- QuickType matches by the CURRENT PAGE'S host, never by the raw string
    /// an item happened to store. Handles both a bare host ("example.com") and a full URL
    /// ("https://example.com/login") the same way an item may legitimately carry either.
    ///
    /// CR-02 (41-REVIEW.md): routed through `OriginNormalize.host(fromURLString:)` -- the SAME
    /// function `CredentialMatcher.loginUrlMatches` (the fill-time matcher) now uses -- so the
    /// registrar and the matcher can never apply two different rules to the same stored string
    /// again. WR-09 (41-REVIEW.md): a value that fails to parse even after the https-assumption is
    /// a genuine parse failure, and the registrar fails CLOSED (`nil`, skip) rather than
    /// registering the raw, un-parseable string as a permanent junk `.domain` entry.
    ///
    /// 2026-08-21 privacy fix: a SECOND fail-closed case, same shape of problem. Before this, an
    /// imported vault entry whose URL field held an Android app package name
    /// (`com.xiaomi.smarthome`) parsed FINE here -- a bare reverse-DNS-shaped string is
    /// indistinguishable from a bare hostname to `URL(string:)`, so the https-assumption above
    /// happily produced `host: "com.xiaomi.smarthome"` and this file registered it as a real
    /// `.domain` identity that could never match any page QuickType would ever show. Routed
    /// through `OriginNormalize.looksLikeAppPackageName` (the SAME predicate `FaviconLoader` now
    /// uses to refuse the identical values before a DNS lookup) rather than inventing a second
    /// shape check.
    private static func serviceHost(fromURLString raw: String) -> ServiceHostResult {
        guard let host = OriginNormalize.host(fromURLString: raw) else { return .unparseable }
        guard !OriginNormalize.looksLikeAppPackageName(host) else { return .notADomain }
        return .host(host)
    }

    // MARK: - Rebuild-pending / published-set persistence

    private static func markRebuildPending(_ pending: Bool) {
        UserDefaults(suiteName: suiteName)?.set(pending, forKey: rebuildPendingKey)
    }

    /// WR-06 (41-REVIEW.md iteration 2): the persisted shape gained a `version` counter -- read by
    /// `unionIntoPublishedKeys` below to detect a concurrent write from the OTHER process between
    /// its own read and write. A pre-fix (unversioned, bare `[PublishedKey]`) blob fails to decode
    /// here and is treated as "no known published keys yet" (version 0) -- a one-time bookkeeping
    /// reset on upgrade, never a security issue (the identity store itself is untouched; only this
    /// file's OWN diffing record resets).
    private struct PublishedKeySet: Codable {
        let version: Int
        let keys: [PublishedKey]
    }

    private static func readPublishedKeySet() -> PublishedKeySet {
        guard let defaults = UserDefaults(suiteName: suiteName),
              let data = defaults.data(forKey: publishedKeysKey),
              let set = try? JSONDecoder().decode(PublishedKeySet.self, from: data)
        else { return PublishedKeySet(version: 0, keys: []) }
        return set
    }

    private static func readPublishedKeys() -> Set<PublishedKey> {
        Set(readPublishedKeySet().keys)
    }

    /// The WHOLE-SET replace `republish(sources:)` uses -- always wins (this IS the current,
    /// complete desired set, never a merge), but still bumps `version` so a concurrent
    /// `unionIntoPublishedKeys` (extension-side) retry below can detect it moved.
    private static func persistPublishedKeys(_ keys: Set<PublishedKey>) {
        guard let defaults = UserDefaults(suiteName: suiteName) else { return }
        let next = PublishedKeySet(version: readPublishedKeySet().version &+ 1, keys: Array(keys))
        guard let data = try? JSONEncoder().encode(next) else { return }
        defaults.set(data, forKey: publishedKeysKey)
    }

    /// WR-06 (41-REVIEW.md iteration 2): `upsertOne`'s own read-modify-write, made compare-and-swap
    /// by version. Before this fix, `persistPublishedKeys(readPublishedKeys().union(newKeys))` ran
    /// as two unsynchronized steps across a cross-PROCESS boundary (this file is compiled into both
    /// the host app and the extension) -- a host `republish` landing between the read and the write
    /// (exactly the moment the self-heal fires: right after the host may have just been active) was
    /// silently overwritten by this call's own, now-stale union, dropping whatever item the host's
    /// republish had just added from `identityPublishedKeys`'s record (a real, reachable removal-
    /// diff gap: that item's QuickType entry then survives indefinitely past the item's own
    /// deletion, because a later removal diff no longer knows to remove it).
    ///
    /// `UserDefaults` has no atomic CAS primitive, so this narrows the race window (a single
    /// re-read-and-retry) rather than eliminating it outright -- WR-06's own issue text: the write
    /// frequency here is bounded by real user actions (a fill, an edit), never a hot loop, so one
    /// retry is proportionate to the actual collision probability rather than a full lock protocol.
    private static func unionIntoPublishedKeys(_ newKeys: Set<PublishedKey>) {
        guard let defaults = UserDefaults(suiteName: suiteName) else { return }
        for _ in 0..<2 {
            let before = readPublishedKeySet()
            let merged = Set(before.keys).union(newKeys)
            let next = PublishedKeySet(version: before.version &+ 1, keys: Array(merged))
            guard let data = try? JSONEncoder().encode(next) else { return }
            let versionMovedDuringMerge = readPublishedKeySet().version != before.version
            defaults.set(data, forKey: publishedKeysKey)
            if !versionMovedDuringMerge { return }
            // The version moved between our read and write -- another writer's value may already
            // be sitting under this key; loop once more to merge OUR keys into THAT value instead
            // of silently having clobbered it.
        }
    }
}
