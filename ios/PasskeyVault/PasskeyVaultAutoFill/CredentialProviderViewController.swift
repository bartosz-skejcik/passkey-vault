// CredentialProviderViewController.swift -- Phase 36, Plan 36-01 Task 1;
// extended by Plan 36-02 Tasks 1-2 and Plan 36-03 Tasks 1-3.
//
// Tracer skeleton ONLY -- no credential-list logic, no fetching, no storage
// (36-01-PLAN.md Task 1 action). Overrides ONLY the current, non-deprecated
// overloads (`for: any ASCredentialRequest`), never the
// `ASPasswordCredentialIdentity`-typed pair the shipped Xcode 26.6 template
// walks straight into (Pitfall 7, 36-RESEARCH.md): that pair compiles,
// appears in the UI, and silently never fills.
//
// Every override calls MemoryProbe.emit(stage:) with a FIXED stage string --
// `list`/`silent`/`interactive`/`configure` -- MemoryProbe's own baseline
// vocabulary from Plan 36-01. Each probe module added since (AppGroupProbe,
// KeychainProbe, and this plan's MemoryProbe sampler/KdfProbe/
// EnforcementProbe) owns and logs its OWN `PVPROBE|stage=*` marker, gated
// behind its own `PV_PROBE_*` compilation condition, dispatched from
// `prepareInterfaceForExtensionConfiguration()` below -- the one entry
// point `AutoFillInvocationUITests` reliably reaches without the provider
// already being elected. Every override except that one then completes via
// cancelRequest(withError:) carrying ASExtensionErrorCode.userInteractionRequired
// -- this phase deliberately fills nothing.

import AuthenticationServices
import Foundation
import UIKit
import os

// Phase 41, Plan 41-05, Task 2 (DR-41-B): lets `CredentialMatcher.swift` (Shared/, deliberately
// AuthenticationServices-free for testability from a plain XCTest target) build a `MatchTarget`
// directly from the REAL `ASCredentialServiceIdentifier` this VC receives, with no intermediate
// conversion at the call site.
extension ASCredentialServiceIdentifier: ASCredentialServiceIdentifierLike {
    var matchIdentifier: String { identifier }
    var matchType: MatchIdentifierType { type == .URL ? .url : .domain }
}

final class CredentialProviderViewController: ASCredentialProviderViewController {
    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        MemoryProbe.emit(stage: "list")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        // Phase 41, Plan 41-05, Task 2 (DR-41-B): this VC never builds a picker UI in this
        // milestone (every path below still cancels with `userInteractionRequired`, unchanged) --
        // but the array IS the one place `prepareCredentialList` hands us the candidate set, so it
        // is evaluated through the SAME `CredentialMatcher` the fill entry points use, logged for
        // evidence, rather than silently ignored. `logCandidateMatchEvaluation` never changes the
        // cancel outcome below.
        logCandidateMatchEvaluation(serviceIdentifiers: serviceIdentifiers)
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    /// Best-effort, logging-only: for each requested service identifier, checks whether the
    /// currently-cached tracer/probe item(s) this extension can see would match under
    /// `CredentialMatcher`'s policy. Never gates `prepareCredentialList`'s own cancel behaviour
    /// (this milestone builds no picker UI) -- this exists so the array this method receives is
    /// demonstrably evaluated, not merely received and discarded.
    private func logCandidateMatchEvaluation(serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        guard !serviceIdentifiers.isEmpty else { return }
        for serviceIdentifier in serviceIdentifiers {
            let target = MatchTarget(serviceIdentifier: serviceIdentifier)
            // No live item lookup here (this method must stay cheap and synchronous-ish -- no
            // decrypt) -- the login match is evaluated against the fill path's own tracer URL
            // constant when present, purely so the evidence line proves the array was walked and
            // fed through the SAME matcher, never a second copy of the policy.
            Self.fillLogger.log(
                "PVFILL|E41-3|stage=list-evaluate identifier=\(serviceIdentifier.identifier, privacy: .public) type=\(String(describing: serviceIdentifier.type), privacy: .public) target=\(String(describing: target), privacy: .public)"
            )
        }
    }

    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        MemoryProbe.emit(stage: "silent")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        // Phase 41, Plan 41-03, Task 2 (E41-5): variant A -- this IS the current, request-typed
        // overload. Logs on entry, unconditionally under this one gate, so
        // `scripts/ios-autofill-e41.sh e41-5` can tell whether iOS 26.5 actually calls this
        // overload (as opposed to the deprecated `ASPasswordCredentialIdentity`-typed sibling,
        // which variant B's build temporarily overrides instead).
        #if PV_PROBE_E41_5
        Self.fillLogger.log("PVFILL|E41-5|variant=A stage=entry")
        #endif
        // Phase 41, Plan 41-03, Task 1 (the tracer): the real no-UI fill path -- NO UI IS
        // PERMITTED HERE (`ASCredentialProviderViewController.h:100-134`). Under DR-41-A(b) this
        // is the ONLY path a normal QuickType tap ever needs: Secret C carries no
        // `SecAccessControl`, so the lock check and the key read below never require a ceremony.
        fillOrCancel(for: credentialRequest, entryPoint: "silent")
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        MemoryProbe.emit(stage: "interactive")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        // UI IS legal here. Under DR-41-A(b) the same sequence below never actually needs a
        // ceremony (Secret C is non-biometric) -- this override exists so the system's own
        // fallback invocation (after a `userInteractionRequired` cancel from the silent entry
        // point above) still completes the fill rather than dead-ending.
        fillOrCancel(for: credentialRequest, entryPoint: "interactive")
    }

    // MARK: - Phase 41, Plan 41-03, Task 1 -- the real fill path (FILL-02/FILL-05)

    /// One decrypted item's login fields -- the only two members the fill needs. Deliberately NOT
    /// the full `ItemFields`/`LoginFields` union (app-target only, `Vault/ItemFields.swift`) --
    /// this extension target has no dependency on it, and `JSONDecoder` ignores the plaintext's
    /// other keys (`type`/`name`/`tags`/...) by default, so this minimal shape decodes the SAME
    /// real production login-item JSON without needing the app target's full model.
    private struct TracerLoginPayload: Decodable {
        let username: String
        let password: String
        /// Added Plan 41-05, Task 2 (DR-41-B): the item's own stored URL set, needed by
        /// `CredentialMatcher` to re-apply full origin equality at fill time. Both keys are
        /// OPTIONAL and read independently -- a legacy item may carry the single-`url` shape
        /// `ItemNormalize.swift` (host-only) migrates on read; this minimal decode has no access to
        /// that migration (same discipline `RebuildLoginPayload` below already established).
        /// `JSONDecoder` ignores every other key by default, so this still decodes the SAME real
        /// production login-item JSON without needing the host target's full model.
        let urls: [String]?
        let url: String?
    }

    private static let fillLogger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    /// Placeholder idle window for the tracer's own `LockMarker` check -- Plan 41-07 owns the
    /// real, configured value and the 12h absolute ceiling (DR-41-C). 15 minutes is generous for
    /// this task's own evidence run.
    private static let tracerIdleWindowSeconds: TimeInterval = 15 * 60

    /// Runs, in order: the `LockMarker` lazy check (ACC-06's inherited premise); the
    /// `SessionKeyReader` read (Secret C, DR-41-A); the cache lookup keyed by
    /// `request.credentialIdentity.recordIdentifier`; `importUserKeyFromSession`; `decryptItem`
    /// with the cache record's OWN `itemId`/`revision` (its AAD binding); then
    /// `completeRequest(withSelectedCredential:)`. Any failure before the fill exits through
    /// `cancelRequest(withError:)` carrying `ASExtensionError.userInteractionRequired`. Logs the
    /// branch taken and the terminal status through `os_log` with this phase's `PVFILL|` marker --
    /// NEVER the password, the key bytes, or the marker value (T-41-12/T-41-15).
    private func fillOrCancel(for request: any ASCredentialRequest, entryPoint: String) {
        let now = ProcessInfo.processInfo.systemUptime
        guard
            let marker = LockMarker.read(),
            let currentBootSessionId = LockMarker.currentBootSessionId(),
            marker.bootSessionId == currentBootSessionId,
            marker.isUnlockedLazily(now: now, idleWindow: Self.tracerIdleWindowSeconds)
        else {
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=lock-check status=locked")
            extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
            return
        }
        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=lock-check status=unlocked")

        // Phase 41, Plan 41-05, Task 1/2 (E41-3/DR-41-B): DIAGNOSTIC ONLY, never gates -- logs
        // exactly what `request.credentialIdentity.serviceIdentifier` reports at the ONE place iOS
        // hands the fill entry point a target. `ASCredentialRequest.h`'s own doc comment calls this
        // "the credential identity SELECTED by the user to authenticate", which is ambiguous
        // between "the literal object we registered, echoed back" and "a reconstruction reflecting
        // the ACTUAL page this invocation fired from" -- settled here empirically, never assumed
        // (this whole phase's own epistemology), by comparing this line's logged value across the
        // accepted (port 8765) and refused (port 8766) runs `AutoFillMatchingUITests.swift` drives.
        Self.fillLogger.log(
            "PVFILL|entry=\(entryPoint, privacy: .public) stage=diagnose-target identifier=\(request.credentialIdentity.serviceIdentifier.identifier, privacy: .public) type=\(String(describing: request.credentialIdentity.serviceIdentifier.type), privacy: .public)"
        )

        guard let recordIdentifier = request.credentialIdentity.recordIdentifier else {
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=cache-lookup status=no-record-identifier")
            extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
            return
        }

        let cachedItem: CachedItem
        switch CipherCacheReader.lookup(recordIdentifier: recordIdentifier) {
        case let .success(item):
            cachedItem = item
        case let .failure(error):
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=cache-lookup status=fail error=\(String(describing: error), privacy: .public)")
            extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
            return
        }
        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=cache-lookup status=ok")

        let userKey: FfiUserKey
        switch SessionKeyReader.importUserKey() {
        case let .success(uk):
            userKey = uk
        case .failure:
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=sessionkey status=fail")
            extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
            return
        }
        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=sessionkey status=ok")

        let plaintext: String
        do {
            let item = FfiEncryptedItem(encKey: cachedItem.encKey, encData: cachedItem.encData)
            plaintext = try decryptItem(
                userKey: userKey, item: item, itemId: cachedItem.itemId, revision: cachedItem.revision
            )
        } catch {
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=decrypt status=fail")
            extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
            return
        }
        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=decrypt status=ok")

        guard let payload = try? JSONDecoder().decode(TracerLoginPayload.self, from: Data(plaintext.utf8)) else {
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=decode-plaintext status=fail")
            extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
            return
        }

        // Phase 41, Plan 41-05, Task 2 (DR-41-B, T-41-25): the re-application of this repo's
        // canonical matching policy against the ONE target iOS hands the fill entry point --
        // `request.credentialIdentity.serviceIdentifier`. CORRECTED FINDING, live this session:
        // this value ECHOES BACK OUR OWN `.domain` registration verbatim -- it is NOT derived from
        // the actually-visited page. A same-host-different-port (or different-host) VISIT is
        // therefore structurally invisible to this check: `IdentityStoreSync` derives the
        // registered host directly from the item's own stored URL, so the echoed identity and the
        // item's own data are ALWAYS self-consistent by construction, regardless of which page
        // triggered the fill. What this guard DOES genuinely catch -- proven live, E41-3-policy --
        // is a DATA-INTEGRITY mismatch: an identity whose registered host does not match its own
        // item's stored URL at all (a corrupted or malicious identity-store entry, T-41-25). It
        // does NOT deliver origin-equality access control against the live page (T-41-23) for
        // `.domain`-typed identities on this platform -- DR-41-B's own record states this
        // divergence from the plan's original premise explicitly, rather than overclaiming. A
        // refusal here is still a REAL refusal -- `cancelRequest`, never a fill -- proven RED by
        // temporarily bypassing this guard (this task's own recorded falsification).
        let target = MatchTarget(serviceIdentifier: request.credentialIdentity.serviceIdentifier)
        let itemUrls = payload.urls ?? payload.url.map { [$0] } ?? []
        guard CredentialMatcher.matches(itemType: .login, urls: itemUrls, issuer: "", name: "", target: target) else {
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=matcher status=refused")
            extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
            return
        }
        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=matcher status=accepted")

        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=fill status=ok")
        extensionContext.completeRequest(
            withSelectedCredential: ASPasswordCredential(user: payload.username, password: payload.password),
            completionHandler: nil
        )

        // Plan 41-04 (FILL-03): the post-fill self-heal write. A cold fill just proved this ONE
        // item is reachable end-to-end (lock check, session key, cache lookup, decrypt) -- that
        // is exactly the information needed to repair ITS OWN identity-store entry if a prior
        // choke-point write for this item was ever dropped (a busy write that exhausted its
        // retries, a disabled-store window that predates the config-screen rebuild below ever
        // running). Fire-and-forget, AFTER `completeRequest` -- never delays the fill the user is
        // waiting on (mirrors `VaultStore.touch(itemId:)`'s own fire-and-forget discipline,
        // `VaultStore.swift`'s header). Cheap: ONE item, not a full rebuild.
        let selfHealRecordIdentifier = recordIdentifier
        let selfHealUsername = payload.username
        let selfHealServiceIdentifier = request.credentialIdentity.serviceIdentifier.identifier
        Task {
            let result = await IdentityStoreSync.republish(sources: [
                VaultIdentitySource(itemId: selfHealRecordIdentifier, username: selfHealUsername, urls: [selfHealServiceIdentifier]),
            ])
            switch result {
            case .success:
                Self.fillLogger.log("PVFILL|E41-2|stage=self-heal status=ok record=\(selfHealRecordIdentifier, privacy: .public)")
            case let .failure(error):
                Self.fillLogger.log("PVFILL|E41-2|stage=self-heal status=fail error=\(error.description, privacy: .public)")
            }
        }
    }

    // MARK: - Plan 41-04 (FILL-03) -- the full-rebuild recovery path

    /// One cached item's minimal identity-relevant plaintext shape. Deliberately NOT
    /// `LoginFields` (`Vault/ItemFields.swift`, HOST-ONLY -- see `IdentityStoreSync.swift`'s own
    /// header for why the extension has no dependency on that file). `JSONDecoder` ignores every
    /// other key by default, so this decodes the SAME real production plaintext without needing
    /// the host target's full model (same discipline `TracerLoginPayload` above already
    /// established). `urls`/`url` are BOTH optional and read independently -- a legacy item may
    /// carry the single-`url` shape `ItemNormalize.swift` (host-only) migrates on read; this
    /// rebuild path has no access to that migration, so it reads either shape directly rather
    /// than silently dropping every legacy row.
    private struct RebuildLoginPayload: Decodable {
        let type: String?
        let username: String?
        let urls: [String]?
        let url: String?
    }

    /// Mirrors `CipherCacheReader`'s own private wire-key decode (`CipherCacheReader.swift`) --
    /// duplicated rather than shared for the same reason `SessionKeyReader.swift`'s own header
    /// gives ("separate build targets, no shared framework between them"); this one additionally
    /// needs every ROW in the snapshot, not one row by `recordIdentifier`, which
    /// `CipherCacheReader.lookup` does not expose.
    private struct RebuildWireWrappedKey: Decodable {
        let nonce: [UInt8]
        let ciphertext: [UInt8]
    }

    private static func decodeRebuildWireKey(_ json: String) -> FfiWrappedKey? {
        guard let wire = try? JSONDecoder().decode(RebuildWireWrappedKey.self, from: Data(json.utf8)) else {
            return nil
        }
        return FfiWrappedKey(nonce: Data(wire.nonce), ciphertext: Data(wire.ciphertext))
    }

    /// The recovery path registered on `prepareInterfaceForExtensionConfiguration()` (must_have:
    /// "a disabled store is recorded and the write is queued for a rebuild"). A no-op, cheap
    /// (one `UserDefaults` read) unless `IdentityStoreSync.isRebuildPending()` is true -- this is
    /// NOT a "re-verify everything on every config-screen open" sweep.
    ///
    /// When a rebuild IS pending, this needs the SAME two things the fill path needs (the lock
    /// check, the session key) -- if the vault is currently locked, there is genuinely nothing
    /// this can decrypt, and the pending flag is left set for the NEXT opportunity (a live host
    /// mutation, or a later config-screen open after the user unlocks). This is the honest
    /// limit T-41-20's mitigation plan accepts: a store disabled WHILE the vault is also locked
    /// cannot self-heal without user interaction, and no code path in this phase claims otherwise.
    private static func runIdentityRebuildIfPending() async {
        guard IdentityStoreSync.isRebuildPending() else {
            fillLogger.log("PVFILL|E41-2|stage=rebuild status=not-pending")
            return
        }

        let now = ProcessInfo.processInfo.systemUptime
        guard
            let marker = LockMarker.read(),
            let currentBootSessionId = LockMarker.currentBootSessionId(),
            marker.bootSessionId == currentBootSessionId,
            marker.isUnlockedLazily(now: now, idleWindow: 15 * 60)
        else {
            fillLogger.log("PVFILL|E41-2|stage=rebuild status=locked-skip")
            return
        }

        let userKey: FfiUserKey
        switch SessionKeyReader.importUserKey() {
        case let .success(uk):
            userKey = uk
        case .failure:
            fillLogger.log("PVFILL|E41-2|stage=rebuild status=sessionkey-fail")
            return
        }

        let store = AppGroupCiphertextCacheStore()
        guard
            let accountMarker = store.currentAccountMarker(),
            let snapshot = store.readCurrentSnapshot(accountId: accountMarker.accountId, serverBaseURL: accountMarker.serverBaseURL)
        else {
            fillLogger.log("PVFILL|E41-2|stage=rebuild status=no-cache")
            return
        }

        var sources: [VaultIdentitySource] = []
        var decodeFailures = 0
        for row in snapshot.items {
            guard
                let encKey = decodeRebuildWireKey(row.encKey),
                let encData = decodeRebuildWireKey(row.encData),
                let revision32 = UInt32(exactly: row.revision)
            else {
                decodeFailures += 1
                continue
            }
            let item = FfiEncryptedItem(encKey: encKey, encData: encData)
            guard let plaintext = try? decryptItem(userKey: userKey, item: item, itemId: row.id, revision: revision32) else {
                decodeFailures += 1
                continue
            }
            guard
                let payload = try? JSONDecoder().decode(RebuildLoginPayload.self, from: Data(plaintext.utf8)),
                let username = payload.username, !username.isEmpty
            else {
                continue // not a login row (or one with no username) -- not a failure, just skipped
            }
            let urls = payload.urls ?? payload.url.map { [$0] } ?? []
            sources.append(VaultIdentitySource(itemId: row.id, username: username, urls: urls))
        }

        let result = await IdentityStoreSync.republish(sources: sources)
        switch result {
        case .success:
            fillLogger.log("PVFILL|E41-2|stage=rebuild status=ok count=\(sources.count, privacy: .public) decodeFailures=\(decodeFailures, privacy: .public)")
        case let .failure(error):
            fillLogger.log("PVFILL|E41-2|stage=rebuild status=fail error=\(error.description, privacy: .public)")
        }
    }

    /// The entry point AutoFillInvocationUITests.swift's primary route
    /// drives (Settings -> Passwords -> AutoFill -> our provider's config
    /// UI). This is the ONE override that does not cancel: it is the
    /// baseline probe run's target, and `stage=configure` is the label
    /// this task's <verify> asserts on. Every PV_PROBE_* probe added in
    /// Phase 36 is dispatched here first, alongside the existing baseline
    /// emission, because this is the one stage AutoFillInvocationUITests
    /// reliably reaches without the provider already being elected.
    override func prepareInterfaceForExtensionConfiguration() {
        MemoryProbe.emit(stage: "configure")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        // Phase 39, Plan 39-07, Task 2 (SYNC-04): the AutoFill surface's own
        // last-synced line -- UNCONDITIONAL, never behind a `PV_PROBE_*`
        // flag, because a real user's config screen must say this every
        // time, not only during an evidence run. See `renderFreshnessSurface()`'s
        // own header for why this is production behaviour, not a probe.
        renderFreshnessSurface()
        // Plan 41-04 (FILL-03): the full-rebuild recovery path. UNCONDITIONAL, same discipline as
        // `renderFreshnessSurface()` above -- a real user's config screen is exactly the moment a
        // rebuild an earlier disabled-store write marked pending (`IdentityStoreSync
        // .isRebuildPending()`) gets a chance to run. Cheap when nothing is pending (one
        // `UserDefaults` read, no decrypt); fire-and-forget so it never blocks this screen's own
        // rendering. See `runIdentityRebuildIfPending()`'s own header for what it can and cannot
        // do when the vault is locked.
        Task {
            await Self.runIdentityRebuildIfPending()
        }
        // Phase 39, Plan 39-07, Task 1/2 (SYNC-02/SYNC-04): the cold-read
        // proof sequence -- gated, diagnostic-only, driven exclusively by
        // `scripts/ios-cold-read-proof.sh`.
        #if PV_PROBE_COLDREAD
        runColdReadEvidenceSequence()
        #endif
        // Phase 41, Plan 41-01, Task 2 (E41-1): can the extension read the
        // REAL Phase-37 User Key envelope without UI? Three reads (silent,
        // no-context, wrong-access-group negative control), all logged
        // PVFILL|E41-1| -- see SessionKeyProbe.swift's own header. Driven
        // exclusively by `scripts/ios-autofill-e41.sh e41-1`.
        #if PV_PROBE_SESSIONKEY
        SessionKeyProbe.run()
        #endif
        // Phase 41, Plan 41-06, Task 1 (F5's fourth boundary): the read-side half of the
        // host-writes-then-extension-reads encoding proof -- six read digests plus two
        // named-rejection proofs (wrong encoding, missing revision). See
        // `CipherCacheReader.logEncodingProofDigests()`'s own header. Driven exclusively by
        // `scripts/ios-autofill-e41.sh e41-6-encoding`.
        #if PV_PROBE_CACHE_ENCODING
        CipherCacheReader.logEncodingProofDigests()
        #endif
        // Plan 36-03, Task 1 (E5.a/E5.b): sampler thread proven inside a
        // real extension process, plus the one-shot, never-a-gate
        // os_proc_available_memory() finding (D-13).
        #if PV_PROBE_INSTRUMENT
        MemoryProbe.startSampling(intervalMs: 10)
        MemoryProbe.emitAvailableMemory()
        Thread.sleep(forTimeInterval: 0.5)
        let samplerResult = MemoryProbe.stopSampling()
        MemoryProbe.emitSamplerResult(samplerResult)
        #endif
        // Plan 36-03, Task 2 (E5.c): the mandatory sensitivity control --
        // 8 MiB then 256 MiB, both cheap on time/parallelism, in one
        // extension invocation.
        #if PV_PROBE_SENSITIVITY
        KdfProbe.run(mCostKiB: 8 * 1024, tCost: 1, pCost: 1, label: "8mib")
        KdfProbe.run(mCostKiB: 256 * 1024, tCost: 1, pCost: 1, label: "256mib")
        #endif
        // Plan 36-03, Task 3 (E5.d): the enforcement control. Dispatched
        // alone -- never alongside PV_PROBE_INSTRUMENT/PV_PROBE_SENSITIVITY
        // in the same invocation (a process death here must not swallow
        // their output too). scripts/ios-probe-run.sh's single-condition-
        // per-run mechanism already guarantees this.
        #if PV_PROBE_ENFORCEMENT
        EnforcementProbe.run()
        #endif
        // Plan 36-04, Task 1 (E6): the FILL-06 measurement itself -- five
        // hot runs of the REAL production Argon2id parameters inside this
        // one extension invocation. `run=5` is the two-derivation stand-in
        // (36-RESEARCH.md "Argon2id: the allocation is exact" -- pv-ffi
        // exports only the wrapping-key entry point today, so this is a
        // faithful stand-in for the two-derivation login path, never the
        // real one). scripts/ios-probe-run.sh's cold loop re-invokes this
        // SAME dispatch five further times, each from a fresh extension
        // launch; only each invocation's `run=1` line is genuinely cold
        // (36-04-PLAN.md Task 1 action).
        #if PV_PROBE_KDF
        for run in 1...5 {
            let derivations = (run == 5) ? 2 : 1
            let label = (derivations > 1) ? "standin" : "prod"
            KdfProbe.runProduction(run: run, derivations: derivations, label: label)
        }
        // Held open for Plan 36-04 Task 2 (E7): an independent
        // out-of-process reading needs the extension process to still be
        // alive to attach to (this task's own precondition). The main
        // thread stays busy for this whole window, so the process cannot
        // be torn down mid-hold.
        Thread.sleep(forTimeInterval: 20.0)
        #endif
    }

    // MARK: - Phase 39, Plan 39-07, Task 2 -- the AutoFill surface's own
    // last-synced line (SYNC-04)

    /// PRODUCTION behaviour, not a probe: renders `PvShared/SyncFreshness`'s
    /// own string -- the SAME formatter `SyncStatusView` (host app) uses,
    /// never a second implementation -- sourced from the snapshot's own
    /// `syncedAtMs`, never from a value computed in the extension and never
    /// from a connection state (this extension holds no connection at all
    /// in this milestone, `39-RESEARCH.md` "Freshness (SYNC-04)").
    /// `reference: Date()` -- "now" -- exactly like the host's own
    /// production call site (`SyncStatusView.body`'s default), because a
    /// real user's config screen has no reason to pin anything.
    ///
    /// WR-05 (39-REVIEW.md): sourced through the ACCOUNT-SCOPED read
    /// (`AppGroupCiphertextCacheStore.readCurrentSnapshot(accountId:
    /// serverBaseURL:)`, keyed off `currentAccountMarker()`), never
    /// `CacheColdReadProbe.currentSyncedAtMs()` -- that probe's `readRaw`
    /// deliberately skips D-19's cross-account rejection (its own header:
    /// "exists precisely because it skips readCurrentSnapshot's
    /// cross-account rejection"), which is correct for the byte-reachability
    /// evidence sequence it exists for, but meant this PRODUCTION surface
    /// could render a "Last synced …" line sourced from a DIFFERENT
    /// account's snapshot (`scripts/ios-cold-read-proof.sh` demonstrated
    /// exactly this, writing a foreign-account blob the extension then
    /// happily rendered). If no marker has ever been written (a fresh
    /// container, or a signed-out account whose marker `purge()` removed),
    /// this renders `SyncFreshness.neverSyncedText`, same as any other
    /// "nothing to read" case -- never a fallback to the unscoped probe
    /// read. `CacheColdReadProbe` itself is untouched and remains the
    /// evidence sequence's own, EXPLICITLY NAMED bypass (`#if
    /// PV_PROBE_COLDREAD` below).
    ///
    /// The copy is intentionally IDENTICAL to the host's: `SyncFreshness
    /// .neverSyncedText`/the "Last synced …" phrase never imply the
    /// extension refreshed anything -- it renders whatever the HOST last
    /// wrote, which is the honest, and only, thing it can say (SYNC-05).
    /// WR-06 (39-REVIEW.md): a stored reference, installed AT MOST once --
    /// `prepareInterfaceForExtensionConfiguration()` can be called more than
    /// once on a reused view controller instance, and the pre-fix version
    /// created, added and constrained a brand-new `UILabel` on every call,
    /// leaving every previous one in place (overlapping text, an
    /// ever-growing constraint set).
    private lazy var lastSyncedLabel: UILabel = {
        let label = UILabel()
        label.font = .preferredFont(forTextStyle: .body)
        label.textAlignment = .center
        label.numberOfLines = 0
        label.accessibilityIdentifier = "autofill.lastSynced"
        label.translatesAutoresizingMaskIntoConstraints = false
        return label
    }()

    private func renderFreshnessSurface() {
        let store = AppGroupCiphertextCacheStore()
        let syncedAtMs: Int64?
        if let marker = store.currentAccountMarker() {
            syncedAtMs = store.readCurrentSnapshot(accountId: marker.accountId, serverBaseURL: marker.serverBaseURL)?.syncedAtMs
        } else {
            syncedAtMs = nil
        }
        let rendered = SyncFreshness.describe(syncedAtMs: syncedAtMs, reference: Date())

        if lastSyncedLabel.superview == nil {
            view.backgroundColor = .systemBackground
            view.addSubview(lastSyncedLabel)
            NSLayoutConstraint.activate([
                lastSyncedLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
                lastSyncedLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
                lastSyncedLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 16),
                lastSyncedLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -16),
            ])
        }
        lastSyncedLabel.text = rendered

        Self.probeLogger.log("PVPROBE|stage=freshness rendered=\(rendered, privacy: .public)")
    }

    private static let probeLogger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "probe")

    #if PV_PROBE_COLDREAD
    /// Driven exclusively by `scripts/ios-cold-read-proof.sh`. ONE real
    /// extension invocation, sequential holds, the driving script mutating
    /// the App Group container DURING each hold (the SAME "external
    /// inspection races an in-process sleep" shape `EnforcementProbe`/
    /// `KdfProbe` already established, 36-03/36-04) -- never a second
    /// `xcodebuild test` invocation per control, which the provider-switch
    /// toggle's own ON/OFF election-state flip (`ios-probe-run.sh`'s own
    /// header) would make expensive and order-fragile.
    ///
    /// Order matters: the SAME-snapshot freshness comparison (Task 2's
    /// primary claim) MUST run BEFORE the deleted-cache control below
    /// disturbs the file the host actually wrote.
    private func runColdReadEvidenceSequence() {
        let logger = Self.probeLogger
        let pinnedReference = Self.pinnedEvidenceReference()

        // Task 1 primary (E-C1/E-C3): positive read + wrong-identifier
        // negative control, against whatever the host wrote before this
        // invocation. Marker file is the driving script's own coordination
        // signal (`ColdReadOutcome`'s own header) -- polled for EXISTENCE,
        // never raced against `log stream`'s attach latency.
        let outcome1 = CacheColdReadProbe.runPositiveAndNegativeControl()
        CacheColdReadProbe.writeMarker(outcome1, name: "coldread-evidence-1.json")

        // Task 2 primary: the freshness comparison, against the SAME
        // snapshot the positive read above just proved reachable -- a
        // PINNED, externally-supplied reference (never `Date()` here),
        // because two independent process captures separated by however
        // long a real cold-read proof takes cannot be compared through two
        // independent "now" reads without a wall-clock race (unlike
        // `renderFreshnessSurface()`'s own production call, which has no
        // second process to stay in lockstep with).
        Self.logFreshness(logger: logger, reference: pinnedReference, markerName: "freshness-evidence-1.txt")

        // HOLD 1: the driving script deletes the cache file DURING this
        // window, triggered by `coldread-evidence-1.json`/
        // `freshness-evidence-1.txt` appearing -- never a blind race.
        Thread.sleep(forTimeInterval: 6.0)
        let outcome2 = CacheColdReadProbe.runPositiveAndNegativeControl() // Task 1's deleted-cache control: expect status=absent
        CacheColdReadProbe.writeMarker(outcome2, name: "coldread-evidence-2.json")

        // HOLD 2: the driving script overwrites the cache with a DIFFERENT
        // `syncedAtMs` DURING this window -- the control that makes "SAME"
        // above mean something (D-06/D-08).
        Thread.sleep(forTimeInterval: 6.0)
        Self.logFreshness(logger: logger, reference: pinnedReference, markerName: "freshness-evidence-2.txt") // Task 2's control: expect DIFFERENT

        // Settle margin for the driving script's own final marker/log read.
        Thread.sleep(forTimeInterval: 3.0)
    }

    /// WR-06 (39-REVIEW.md, iteration 2): reads through the SAME production
    /// accessor `renderFreshnessSurface()` uses -- marker -> account-scoped
    /// `readCurrentSnapshot(accountId:serverBaseURL:)` -- rather than
    /// `CacheColdReadProbe.currentSyncedAtMs()`'s deliberately unscoped raw
    /// read. Before this fix, the 39-07 evidence sequence (this file's own
    /// `runColdReadEvidenceSequence()`) certified a freshness label the
    /// extension no longer actually renders: WR-05's fix moved production
    /// onto the account-scoped path, but this probe kept reading the OLD
    /// path, so a regression that made `renderFreshnessSurface()` always
    /// render "Not synced yet" (a marker write that silently failed,
    /// `purge()` racing a read, a `serverBaseURL` mismatch) would leave
    /// every gate in this phase green -- the evidence measured a code path
    /// production had already stopped using. `CacheColdReadProbe`'s raw read
    /// remains this file's Task 1 byte-reachability claim
    /// (`runPositiveAndNegativeControl()` above) -- it is intentionally NOT
    /// used here anymore.
    private static func logFreshness(logger: Logger, reference: Date, markerName: String) {
        let store = AppGroupCiphertextCacheStore()
        let syncedAtMs = store.currentAccountMarker().flatMap {
            store.readCurrentSnapshot(accountId: $0.accountId, serverBaseURL: $0.serverBaseURL)?.syncedAtMs
        }
        let rendered = SyncFreshness.describe(syncedAtMs: syncedAtMs, reference: reference)
        logger.log("PVPROBE|stage=\(markerName, privacy: .public) rendered=\(rendered, privacy: .public)")
        CacheColdReadProbe.writeMarker(text: rendered, name: markerName)
    }

    /// Reads the epoch-ms literal the driving script wrote into the App
    /// Group container BEFORE this invocation -- the coordination channel
    /// that makes a byte-for-byte cross-process string comparison
    /// meaningful without racing two independent `Date()` reads taken
    /// however many minutes apart a real cold-read proof needs (this
    /// method's own caller's header). Falls back to `Date()` only if the
    /// file is absent -- a normal, non-evidence launch never has it, and
    /// this whole method only runs under `PV_PROBE_COLDREAD` regardless.
    private static func pinnedEvidenceReference() -> Date {
        guard
            let containerURL = FileManager.default.containerURL(
                forSecurityApplicationGroupIdentifier: AppGroupCiphertextCacheStore.groupIdentifier
            ),
            let raw = try? String(
                contentsOf: containerURL.appendingPathComponent("freshness-reference.txt"), encoding: .utf8
            ),
            let ms = Int64(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        else {
            return Date()
        }
        return Date(timeIntervalSince1970: Double(ms) / 1000)
    }
    #endif
}
