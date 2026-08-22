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
import SwiftUI
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
    // MARK: - `.planning/debug/passkey-reg-blank-sheet-discord.md` -- DEBUG-only diagnostic,
    // 2026-08-22. Bartek's real device (iPhone 16, iOS 27.0) hit a blank white sheet registering a
    // passkey from the Discord native app; the host-app-process log capture showed ZERO
    // `PVFILL|passkey-reg|` lines. That capture is the HOST app's own console, a SEPARATE process
    // from this extension, so absence there is suggestive, never proof this override never ran --
    // this block converts "we saw nothing" into "the system called X", by logging from EVERY
    // lifecycle/override point this class can reach, including ones with no production
    // implementation. `PVDIAG|` (never `PVFILL|`) so a grep against this run can never be confused
    // with a production log line. Gated `#if DEBUG` -- never ships in Release.
    #if DEBUG
    private static let diagLogger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "fill")

    override func viewDidLoad() {
        Self.diagLogger.log("PVDIAG|method=viewDidLoad")
        super.viewDidLoad()
    }

    override func viewWillAppear(_ animated: Bool) {
        Self.diagLogger.log("PVDIAG|method=viewWillAppear")
        super.viewWillAppear(animated)
    }

    override func viewDidAppear(_ animated: Bool) {
        Self.diagLogger.log("PVDIAG|method=viewDidAppear")
        super.viewDidAppear(animated)
    }

    /// The CONDITIONAL passkey-registration entry point (iOS 18+) -- a DIFFERENT request shape
    /// from the explicit "Add a Passkey" ceremony `prepareInterface(forPasskeyRegistration:)`
    /// handles below (opportunistic, background-only, silent). This extension declares no
    /// `SupportsConditionalPasskeyRegistration` capability in `Info.plist`, so the system should
    /// never route here -- logged anyway to settle that empirically rather than assume it from the
    /// header's own prose (L-1's own discipline).
    override func performWithoutUserInteractionIfPossible(passkeyRegistration registrationRequest: ASPasskeyCredentialRequest) {
        Self.diagLogger.log("PVDIAG|method=performWithoutUserInteractionIfPossible(passkeyRegistration:)")
        extensionContext.cancelRequest(withError: ASExtensionError(.failed))
    }

    // The two DEPRECATED `ASPasswordCredentialIdentity`-typed overloads
    // (`provideCredentialWithoutUserInteraction(for:)` / `prepareInterfaceToProvideCredential(for:)`)
    // were overridden here temporarily as pure diagnostics, to settle whether iOS 27 -- newer than
    // this toolchain's 26.5 SDK -- reintroduces or prefers the legacy shape for any request,
    // passkey included. MEASURED AND ANSWERED (2026-08-22, spike log section 19a): across every
    // real-device capture Bartek took on iOS 27.0 -- password fills, passkey assertion in Safari,
    // passkey registration in Discord and on X -- neither `PVDIAG` line EVER appeared, while
    // `viewDidLoad`/`viewWillAppear`/`viewDidAppear` and the request-typed overloads did. The
    // legacy overloads are dead on 27 exactly as they are on 26.5, so the overrides are removed:
    // they existed to answer a question, the question is answered, and keeping them would ship a
    // deprecated spelling that `scripts/audit-ios-autofill-deprecated-apis.sh` correctly refuses.

    /// Never implemented in production (no OTP capability declared) -- logged purely for
    /// completeness; NOT expected on a passkey registration request, but ruling it out costs one
    /// override.
    override func prepareOneTimeCodeCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        Self.diagLogger.log("PVDIAG|method=prepareOneTimeCodeCredentialList(for:)")
        extensionContext.cancelRequest(withError: ASExtensionError(.failed))
    }
    #endif

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        MemoryProbe.emit(stage: "list")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        // Phase 41, Plan 41-07, Task 1: the THIRD of the three entry points ACC-06's lazy check
        // must run before -- this method reads no key material today (no picker UI this
        // milestone, every path below still cancels), but the truth this task must prove is
        // "runs before any key read at EVERY entry point," not "only where a read currently
        // happens" -- a future picker UI must inherit this call already in place, and the count
        // this task's own acceptance criterion demands (one line per entry point, in a live run)
        // requires it be observably present now. Never gates this method's own cancel behaviour.
        // REQUIRED FIX #1 (`.planning/debug/faceid-unlock-loop.md`): `checkAndExpireIfNeeded` now
        // returns the full `LockState` tri-state -- this call site never branched on the result
        // (this method reads no key material yet), so it stays a bare, discarded call, unchanged.
        SessionLifecycle.checkAndExpireIfNeeded(entryPoint: "list", deleteKeyArtifact: SessionKeyReader.delete)

        // Phase 41, Plan 41-05, Task 2 (DR-41-B): this VC never builds a picker UI in this
        // milestone (every path below still cancels with `userInteractionRequired`, unchanged) --
        // but the array IS the one place `prepareCredentialList` hands us the candidate set, so it
        // is evaluated through the SAME `CredentialMatcher` the fill entry points use, logged for
        // evidence, rather than silently ignored. `logCandidateMatchEvaluation` never changes the
        // cancel outcome below.
        logCandidateMatchEvaluation(serviceIdentifiers: serviceIdentifiers)
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    /// Phase 43, Plan 43-03 (OPT-03) -- a LIVE-RUN FINDING, not in the original plan text: with no
    /// `ASPasskeyCredentialIdentity` registered for a credential, Safari's own system "Sign In"
    /// sheet is what actually invokes our provider (via its "Other accounts" row), and doing so
    /// calls THIS overload -- `prepareCredentialListForServiceIdentifiers:requestParameters:`
    /// (`ASCredentialProviderViewController.h:54`) -- never `provideCredentialWithoutUserInteraction`/
    /// `prepareInterfaceToProvideCredential`. See `performPasskeyAssertion`'s own header for the
    /// full account (including the live evidence that pinned this down: the extension process
    /// launched and materialized this view controller, but with neither override implemented,
    /// NEITHER path ever ran -- a permanently blank system sheet). `serviceIdentifiers` is unused
    /// here (this overload's own passkey-specific counterpart to the plain `serviceIdentifiers`
    /// array above) -- `requestParameters` carries everything a passkey ceremony needs.
    override func prepareCredentialList(
        for serviceIdentifiers: [ASCredentialServiceIdentifier],
        requestParameters: ASPasskeyCredentialRequestParameters
    ) {
        Self.fillLogger.log("PVFILL|passkey|entry=list-passkey stage=entry")
        performPasskeyAssertion(
            rpId: requestParameters.relyingPartyIdentifier,
            clientDataHash: requestParameters.clientDataHash,
            allowedCredentialIds: requestParameters.allowedCredentials,
            entryPoint: "list-passkey"
        )
    }

    /// Best-effort, logging-only: for each requested service identifier, checks whether the
    /// currently-cached tracer/probe item(s) this extension can see would match under
    /// `CredentialMatcher`'s policy. Never gates `prepareCredentialList`'s own cancel behaviour
    /// (this milestone builds no picker UI) -- this exists so the array this method receives is
    /// demonstrably evaluated, not merely received and discarded.
    private func logCandidateMatchEvaluation(serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        guard !serviceIdentifiers.isEmpty else { return }
        for serviceIdentifier in serviceIdentifiers {
            // No live item lookup here (this method must stay cheap and synchronous-ish -- no
            // decrypt) -- the login match is evaluated against the fill path's own tracer URL
            // constant when present, purely so the evidence line proves the array was walked and
            // fed through the SAME matcher, never a second copy of the policy.
            //
            // WR-02 (41-REVIEW.md): this line carries the live page's real service identifier
            // (DR-41-B's own note: `prepareCredentialList`'s array DOES carry the actually-visited
            // page) -- browsing history plus a vault-item UUID. Gated behind the SAME evidence
            // flag this line exists for (`PV_PROBE_E41_3`), and the identifier/target themselves
            // are `.private` even when the flag is on -- only `stage=`/`type=` (no user data) stay
            // `.public` for `assert_*` greps.
            #if PV_PROBE_E41_3
            let target = MatchTarget(serviceIdentifier: serviceIdentifier)
            Self.fillLogger.log(
                "PVFILL|E41-3|stage=list-evaluate identifier=\(serviceIdentifier.identifier, privacy: .private) type=\(String(describing: serviceIdentifier.type), privacy: .public) target=\(String(describing: target), privacy: .private)"
            )
            #endif
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
        // Phase 43 (43-03-PLAN.md), OPT-03: `.passkeyAssertion` is NEW this phase -- routes to
        // `fillPasskeyOrCancel`, which reuses `fillOrCancel`'s own unlock-gating sequence but
        // diverges at credential lookup/completion (a passkey assertion, not a password fill).
        // `default` preserves Phase 41's own UNCHANGED behaviour for `.password` (and any other
        // request type this extension does not yet handle) -- this switch is additive, never a
        // rewrite of the existing password path.
        switch credentialRequest.type {
        case .passkeyAssertion:
            guard let passkeyRequest = credentialRequest as? ASPasskeyCredentialRequest else {
                extensionContext.cancelRequest(withError: ASExtensionError(.failed))
                return
            }
            fillPasskeyOrCancel(for: passkeyRequest, entryPoint: "silent")
        default:
            // Phase 41, Plan 41-03, Task 1 (the tracer): the real no-UI fill path -- NO UI IS
            // PERMITTED HERE (`ASCredentialProviderViewController.h:100-134`). Under DR-41-A(b) this
            // is the ONLY path a normal QuickType tap ever needs: Secret C carries no
            // `SecAccessControl`, so the lock check and the key read below never require a ceremony.
            fillOrCancel(for: credentialRequest, entryPoint: "silent")
        }
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        MemoryProbe.emit(stage: "interactive")
        #if PV_PROBE_APPGROUP
        AppGroupProbe.emit()
        #endif
        #if PV_PROBE_KEYCHAIN
        KeychainProbe.emit()
        #endif
        // Phase 43 (43-03-PLAN.md), OPT-03: same `.passkeyAssertion` branch as the silent entry
        // point above -- the system may invoke THIS override directly for a passkey request (UI is
        // legal here), or as its own fallback after a `.failed`/`.userInteractionRequired` cancel
        // from the silent entry point.
        switch credentialRequest.type {
        case .passkeyAssertion:
            guard let passkeyRequest = credentialRequest as? ASPasskeyCredentialRequest else {
                extensionContext.cancelRequest(withError: ASExtensionError(.failed))
                return
            }
            fillPasskeyOrCancel(for: passkeyRequest, entryPoint: "interactive")
        default:
            // UI IS legal here. Under DR-41-A(b) the same sequence below never actually needs a
            // ceremony (Secret C is non-biometric) -- this override exists so the system's own
            // fallback invocation (after a `userInteractionRequired` cancel from the silent entry
            // point above) still completes the fill rather than dead-ending.
            fillOrCancel(for: credentialRequest, entryPoint: "interactive")
        }
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

    /// Runs, in order: `SessionLifecycle`'s lazy check (ACC-06's inherited premise, Plan 41-07 --
    /// the REAL configured idle window from `AutoLockPolicy` plus DR-41-C's 12h absolute
    /// ceiling, superseding this task's own former hardcoded 15-minute placeholder); the
    /// `SessionKeyReader` read (Secret C, DR-41-A); the cache lookup keyed by
    /// `request.credentialIdentity.recordIdentifier`; `importUserKeyFromSession`; `decryptItem`
    /// with the cache record's OWN `itemId`/`revision` (its AAD binding); then
    /// `completeRequest(withSelectedCredential:)`, followed by ACC-07's activity refresh. Any
    /// failure before the fill exits through `cancelRequest(withError:)` carrying
    /// `ASExtensionError.userInteractionRequired`. Logs the branch taken and the terminal status
    /// through `os_log` with this phase's `PVFILL|` marker -- NEVER the password, the key bytes,
    /// or the marker value (T-41-12/T-41-15).
    private func fillOrCancel(for request: any ASCredentialRequest, entryPoint: String) {
        // REQUIRED FIX #1 (`.planning/debug/faceid-unlock-loop.md`): `checkAndExpireIfNeeded` now
        // returns `LockState` rather than `Bool` -- this read-gating call site still wants a
        // simple "may I read the key right now" answer, so it compares against `.unlocked`
        // explicitly. Behaviour is UNCHANGED: `.expired` and `.indeterminate` both refused a read
        // before this fix and both still do -- the unreadable-vs-expired distinction only matters
        // for `ContentView`'s own, SEPARATE question ("should I destroy the visible session"),
        // never for this extension's "is there a key to read".
        guard SessionLifecycle.checkAndExpireIfNeeded(entryPoint: entryPoint, deleteKeyArtifact: SessionKeyReader.delete) == .unlocked else {
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
        //
        // WR-02 (41-REVIEW.md): this line runs on EVERY fill and was previously unconditional,
        // `.public`, in Release -- the visited site's own identifier, unredacted, into a
        // device-persistent, sysdiagnose-exportable log. Gated behind the SAME `PV_PROBE_E41_3`
        // evidence flag `logCandidateMatchEvaluation` above now uses (this line exists for the
        // same DR-41-B empirical settling), and the identifier is `.private` even when the flag
        // is on.
        #if PV_PROBE_E41_3
        Self.fillLogger.log(
            "PVFILL|entry=\(entryPoint, privacy: .public) stage=diagnose-target identifier=\(request.credentialIdentity.serviceIdentifier.identifier, privacy: .private) type=\(String(describing: request.credentialIdentity.serviceIdentifier.type), privacy: .public)"
        )
        #endif

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
            // WR-03 (41-REVIEW.md iteration 2): this line is UNCONDITIONAL, on the real fill path,
            // in Release -- before this fix, `String(describing: error)` (which prefers
            // `CustomStringConvertible.description`) wrote `.itemNotFound(id)`'s own raw vault-item
            // UUID `.public` into the device-persistent, sysdiagnose-exportable unified log. The
            // `assert_*` greps this line's callers need only the closed-vocabulary `kindToken`;
            // the full description (embeds the identifier) is `.private`.
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=cache-lookup status=fail kind=\(error.kindToken, privacy: .public) detail=\(String(describing: error), privacy: .private)")
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

        // Plan 41-07, Task 1 (ACC-07): the activity refresh, AFTER a successful fill -- DR-41-C
        // grants the extension write permission specifically so AutoFill-only usage does not log
        // the user out mid-use. Extends the idle window only; `hostUnlockUptime` (the absolute
        // ceiling) is carried forward unchanged by `SessionLifecycle.refreshActivity` itself.
        SessionLifecycle.refreshActivity(writer: "extension")

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
        // CR-01 (41-REVIEW.md): this MUST be `upsertOne`, never `republish` -- `republish` treats
        // its argument as the CURRENT, COMPLETE vault item set and computes removals against
        // everything previously published; handing it this ONE item deleted every other QuickType
        // entry on the very next successful fill. `upsertOne` only saves, never diffs/removes.
        // `markSelfHealPending()` runs BEFORE the detached `Task`, synchronously, so a process kill
        // landing anywhere inside the `Task` below (the extension is free to be torn down right
        // after `completeRequest`, immediately above) still leaves a rebuild owed; `upsertOne`
        // clears it itself on success.
        IdentityStoreSync.markSelfHealPending()
        Task {
            let result = await IdentityStoreSync.upsertOne(source:
                VaultIdentitySource(itemId: selfHealRecordIdentifier, username: selfHealUsername, urls: [selfHealServiceIdentifier])
            )
            switch result {
            case .success:
                Self.fillLogger.log("PVFILL|E41-2|stage=self-heal status=ok record=\(selfHealRecordIdentifier, privacy: .private)")
            case let .failure(error):
                Self.fillLogger.log("PVFILL|E41-2|stage=self-heal status=fail error=\(error.description, privacy: .public)")
            }
        }
    }

    // MARK: - Phase 43, Plan 43-03 -- the passkey assertion fill path (OPT-03)

    /// The passkey-assertion counterpart to `fillOrCancel` above (43-03-PLAN.md). Reuses the SAME
    /// unlock-gating sequence (`SessionLifecycle.checkAndExpireIfNeeded`, `SessionKeyReader` read,
    /// `importUserKeyFromSession`) up through obtaining an unlocked User Key -- then diverges: no
    /// identity-store `ASPasskeyCredentialIdentity` registration exists yet for passkeys (43-05
    /// onward, this plan's own `<success_criteria>`), so there is no `recordIdentifier` to look up
    /// by. Instead this scans every row in the current account's cached snapshot, decrypting each
    /// and checking its OWN `credential_id` (the raw `SerializablePasskey` wire shape,
    /// `packages/pv-ui/vault/types.ts`'s `RawPasskeyWireFields` -- no `type` key, `credential_id` +
    /// `rp_id` present, `ios/PasskeyVault/PasskeyVault/Vault/ItemNormalize.swift`'s own
    /// `isRawPasskeyWireFields` precedent, duplicated here because the extension target has no
    /// dependency on that host-only file) against the requested `rpId`/`allowedCredentialIds`. The
    /// SAME decrypt-every-row pattern `runIdentityRebuildIfPending()` below already established for
    /// the identity-store rebuild path -- this is not a second scanning mechanism.
    ///
    /// CALLED FROM TWO ENTRY POINTS (a live-run finding, not the original plan text): with no
    /// `ASPasskeyCredentialIdentity` registered, Safari's own "Sign In" system sheet (no matching
    /// saved credential) is what the user actually sees, and selecting our provider from its "Other
    /// accounts" row invokes `prepareCredentialList(for:requestParameters:)` (`ASCredentialProviderViewController.h:54`)
    /// -- NOT `provideCredentialWithoutUserInteraction`/`prepareInterfaceToProvideCredential`, which
    /// `43-RESEARCH.md`'s own diagram assumed were the only entry points needed, matching Phase 41's
    /// PASSWORD precedent. Live evidence (`ios/evidence/43/`): the extension process launched and
    /// materialized `CredentialProviderViewController` (confirmed via `log show`), but with NEITHER
    /// override implemented, NEITHER ever ran -- a persistent blank system sheet, no
    /// `PVFILL|passkey|` line anywhere, the fixture's own `/assert/finish` never called. This
    /// override is a Rule 2 deviation (missing critical functionality) discovered by the tracer
    /// doing exactly its job: catching an architectural gap before every later plan builds on top
    /// of it. `allowedCredentialIds` unifies both call shapes: `.passkeyAssertion`'s own
    /// `ASPasskeyCredentialIdentity.credentialID` (always exactly one) vs.
    /// `ASPasskeyCredentialRequestParameters.allowedCredentials` (a list, EMPTY meaning "any
    /// credential for this rp_id is allowed").
    ///
    /// `<behavior>` (43-03-PLAN.md): never draws a picker of its own -- completes silently or via
    /// the system's own confirmation surface (OPT-01's UI scope fence). If MORE than one cached
    /// item matches, this refuses rather than guessing (a picker is explicitly out of scope, so
    /// there is no way to let the user disambiguate). ANY ceremony failure (no matching item,
    /// decrypt failure, `providerGetAssertion` error) cancels via `ASExtensionError(.failed)`,
    /// never `.userInteractionRequired` -- a genuine ceremony failure is not "needs user
    /// interaction to proceed", unlike the password path's locked-vault case above, which
    /// legitimately can be retried once the vault is unlocked.
    private func performPasskeyAssertion(rpId: String, clientDataHash: Data, allowedCredentialIds: [Data], entryPoint: String) {
        guard SessionLifecycle.checkAndExpireIfNeeded(entryPoint: entryPoint, deleteKeyArtifact: SessionKeyReader.delete) == .unlocked else {
            Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=lock-check status=locked")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }
        Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=lock-check status=unlocked")

        let userKey: FfiUserKey
        switch SessionKeyReader.importUserKey() {
        case let .success(uk):
            userKey = uk
        case .failure:
            Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=sessionkey status=fail")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }
        Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=sessionkey status=ok")

        let store = AppGroupCiphertextCacheStore()
        guard
            let accountMarker = store.currentAccountMarker(),
            let snapshot = store.readCurrentSnapshot(accountId: accountMarker.accountId, serverBaseURL: accountMarker.serverBaseURL)
        else {
            Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=cache-lookup status=no-cache")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }

        var matches: [String] = []
        for row in snapshot.items {
            guard
                let encKey = Self.decodeRebuildWireKey(row.encKey),
                let encData = Self.decodeRebuildWireKey(row.encData),
                let revision32 = UInt32(exactly: row.revision)
            else {
                continue
            }
            let item = FfiEncryptedItem(encKey: encKey, encData: encData)
            guard let plaintext = try? decryptItem(userKey: userKey, item: item, itemId: row.id, revision: revision32) else {
                continue
            }
            guard
                let raw = (try? JSONSerialization.jsonObject(with: Data(plaintext.utf8))) as? [String: Any],
                // Raw passkey wire shape: no `type` key, `credential_id`/`rp_id` present (mirrors
                // ItemNormalize.swift's own isRawPasskeyWireFields -- a login/other item's
                // plaintext simply lacks these keys and is skipped here).
                raw["type"] == nil,
                let itemRpId = raw["rp_id"] as? String,
                let credentialIdInts = raw["credential_id"] as? [Int]
            else {
                continue
            }
            guard itemRpId == rpId else {
                continue
            }
            let credentialIdBytes = Data(credentialIdInts.map { UInt8(truncatingIfNeeded: $0) })
            // Empty `allowedCredentialIds` means "any credential for this rp_id is allowed"
            // (`ASPasskeyCredentialRequestParameters.allowedCredentials`'s own documented shape);
            // otherwise the item's credential_id must be one of the named allowed ids.
            if allowedCredentialIds.isEmpty || allowedCredentialIds.contains(credentialIdBytes) {
                matches.append(plaintext)
            }
        }

        guard matches.count == 1, let existingPasskeyJson = matches.first else {
            Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=match status=fail count=\(matches.count, privacy: .public)")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }
        Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=match status=ok")

        // The ONE Rust/FFI entry point this branch may call (43-03-PLAN.md prohibitions) --
        // `providerGetAssertion` (43-02), thin delegation to `pv_provider::get_assertion_ctap2`.
        // `existingCredentialsJson` is a one-element JSON array wrapping the SAME decrypted
        // `SerializablePasskey` plaintext this loop just matched -- `pv_provider`'s own expected
        // shape (`PvCredentialStore::from_passkeys_json`).
        var result: FfiProviderAssertionResult
        do {
            result = try providerGetAssertion(
                rpId: rpId,
                clientDataHash: clientDataHash,
                allowCredentialId: allowedCredentialIds.first,
                existingCredentialsJson: "[\(existingPasskeyJson)]"
            )
        } catch {
            Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=ceremony status=fail")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }

        #if DEBUG
        // 43-03-PLAN.md Task 2's own falsification leg (`ios-autofill-e43.sh tracer
        // --corrupt-signature`): a harness-side interception, gated behind a marker file in the
        // App Group container (the SAME `TracerFillSeeder.shouldMutateRevision()` marker-file
        // convention, `ios-autofill-e41.sh`'s own header note on why a file, not an env var, is
        // the reliable cross-process signal). Flips one byte of the REAL signature this ceremony
        // just produced -- proves the fixture's own independent `webauthn-rs` verifier genuinely
        // fails closed on a corrupted signature, never a shape/`.ok`-only check (L-3/L-9).
        if Self.shouldCorruptSignatureForFalsification(), !result.signature.isEmpty {
            let idx = result.signature.startIndex
            result.signature[idx] ^= 0xFF
            Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=falsify status=signature-corrupted")
        }
        #endif

        let credential = ASPasskeyAssertionCredential(
            userHandle: result.userHandle ?? Data(),
            relyingParty: rpId,
            signature: result.signature,
            clientDataHash: clientDataHash,
            authenticatorData: result.authenticatorData,
            credentialID: result.credentialId
        )
        Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=fill status=ok")
        extensionContext.completeAssertionRequest(using: credential, completionHandler: nil)

        // Plan 41-07, Task 1 (ACC-07): the SAME post-fill activity refresh `fillOrCancel` performs
        // -- AutoFill-only usage (a passkey assertion is exactly that) must not log the user out
        // mid-use.
        SessionLifecycle.refreshActivity(writer: "extension")
    }

    /// Thin adapter for the `.passkeyAssertion`-typed request shape (`ASPasskeyCredentialRequest`)
    /// -- see `performPasskeyAssertion`'s own header for the full rationale and the SECOND entry
    /// point (`prepareCredentialList(for:requestParameters:)` below) this same function serves.
    private func fillPasskeyOrCancel(for request: ASPasskeyCredentialRequest, entryPoint: String) {
        // `ASCredentialRequest.credentialIdentity` is declared `id<ASCredentialIdentity>` on the
        // base protocol (`ASCredentialRequest.h:39`) -- Swift sees `any ASCredentialIdentity`
        // here even though `request` is already narrowed to `ASPasskeyCredentialRequest`, so the
        // passkey-specific fields (`credentialID`/`relyingPartyIdentifier`) need this ONE explicit
        // downcast. Header ground truth confirmed this is genuinely `ASPasskeyCredentialIdentity`
        // for a `.passkeyAssertion` request (`ASPasskeyCredentialRequest.h`'s own doc comment); an
        // unexpected shape here is treated as a real ceremony failure, never force-unwrapped.
        guard let passkeyIdentity = request.credentialIdentity as? ASPasskeyCredentialIdentity else {
            Self.fillLogger.log("PVFILL|passkey|entry=\(entryPoint, privacy: .public) stage=identity-cast status=fail")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }
        performPasskeyAssertion(
            rpId: passkeyIdentity.relyingPartyIdentifier,
            clientDataHash: request.clientDataHash,
            allowedCredentialIds: [passkeyIdentity.credentialID],
            entryPoint: entryPoint
        )
    }

    #if DEBUG
    /// 43-03-PLAN.md Task 2's own falsification marker -- see this function's own call site
    /// above for the full rationale. Checked at ceremony-completion time, not compile time, so
    /// the driving script can toggle it per-run without a second build (mirrors
    /// `TracerFillSeeder.shouldMutateRevision()`'s own precedent, `ios-autofill-e41.sh`'s header).
    private static func shouldCorruptSignatureForFalsification() -> Bool {
        guard let containerURL = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.cloud.blonie.PasskeyVault"
        ) else {
            return false
        }
        return FileManager.default.fileExists(
            atPath: containerURL.appendingPathComponent("pv-43-corrupt-signature.marker").path
        )
    }
    #endif

    // MARK: - Phase 43, Plan 43-07 -- the passkey REGISTRATION path (OPT-03)

    /// Scans the current account's cached snapshot for existing passkeys matching `rpId`,
    /// JSON-array-wrapped -- the SAME shape `PvCredentialStore::from_passkeys_json`
    /// (`crates/pv-provider/src/credential_store.rs`) expects, and the SAME single-element-array
    /// form `performPasskeyAssertion` above already builds for the assertion path. Needed so
    /// `make_credential_ctap2`'s own exclude-list enforcement (`crates/pv-provider/src/ceremony.rs`)
    /// has real data to check `excludedCredentialIds` against -- a vacuous `"[]"` would make an RP's
    /// `excludeCredentials` list silently unenforceable. Returns `"[]"` on no cache/no match --
    /// never surfaces a cache-read problem as a registration failure (an unrelated cache miss must
    /// not block creating a new credential; the RP's own exclude list is then vacuously satisfied).
    private static func existingPasskeysJson(rpId: String, userKey: FfiUserKey) -> String {
        let store = AppGroupCiphertextCacheStore()
        guard
            let accountMarker = store.currentAccountMarker(),
            let snapshot = store.readCurrentSnapshot(accountId: accountMarker.accountId, serverBaseURL: accountMarker.serverBaseURL)
        else {
            return "[]"
        }
        var matches: [String] = []
        for row in snapshot.items {
            guard
                let encKey = Self.decodeRebuildWireKey(row.encKey),
                let encData = Self.decodeRebuildWireKey(row.encData),
                let revision32 = UInt32(exactly: row.revision)
            else { continue }
            let item = FfiEncryptedItem(encKey: encKey, encData: encData)
            guard let plaintext = try? decryptItem(userKey: userKey, item: item, itemId: row.id, revision: revision32) else { continue }
            guard
                let raw = (try? JSONSerialization.jsonObject(with: Data(plaintext.utf8))) as? [String: Any],
                raw["type"] == nil,
                let itemRpId = raw["rp_id"] as? String,
                itemRpId == rpId
            else { continue }
            matches.append(plaintext)
        }
        return "[" + matches.joined(separator: ",") + "]"
    }

    /// Presents `PasskeyRegistrationConfirmView` (the ONE UI screen OPT-01's scope fence permits)
    /// embedded as a child view controller -- this extension has no storyboard and has never hosted
    /// a SwiftUI view before this plan; standard `UIHostingController` embedding, pinned to `view`'s
    /// edges.
    private func presentRegistrationConfirm(
        rpId: String, accountName: String, onConfirm: @escaping () -> Void, onCancel: @escaping () -> Void
    ) {
        let hosting = UIHostingController(
            rootView: PasskeyRegistrationConfirmView(rpId: rpId, accountName: accountName, onConfirm: onConfirm, onCancel: onCancel)
        )
        addChild(hosting)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        hosting.didMove(toParent: self)
    }

    /// Plan 43-07 (OPT-03): the registration counterpart to `fillPasskeyOrCancel`/
    /// `performPasskeyAssertion` above. Runs the SAME unlock-gating sequence BEFORE presenting ANY
    /// UI (this task's own `<read_first>`: an unauthenticated attacker with physical access to a
    /// locked device must never see a registration confirmation screen for an unlocked vault's
    /// contents) -- the algorithm/lock DECISION itself is factored into `PasskeyRegistrationPreflight
    /// .decide(...)` (`Shared/PasskeyRegistrationPreflight.swift`), a PURE function
    /// `PasskeyRegistrationOverrideTests` exercises directly: this file compiles only into the
    /// `PasskeyVaultAutoFill` extension target, which `PasskeyVaultTests`' `@testable import
    /// PasskeyVault` (the HOST app module) cannot see, so the decision logic itself cannot live only
    /// here and still be actually run by this plan's own test gate (43-PLAN-CHECK.md C5).
    ///
    /// Placement (43-PLAN-CHECK.md C1): this override's own declaration is ABOVE
    /// `runIdentityRebuildIfPending()` below -- a real, later declaration follows it in the file, so
    /// `scripts/audit-ios-identity-store-chokepoint.sh`'s assertion (B) measures this override's
    /// REAL extent (up to its own next `func` declaration) rather than falling back to a generous,
    /// unmeasured numeric window. Every step from the ceremony onward runs inside ONE `Task { }`
    /// closure (never a further `private func`), specifically so the required
    /// `IdentityStoreSync.upsertOnePasskey(` call stays inside THIS declaration's own measured
    /// extent.
    override func prepareInterface(forPasskeyRegistration registrationRequest: any ASCredentialRequest) {
        guard let request = registrationRequest as? ASPasskeyCredentialRequest else {
            Self.fillLogger.log("PVFILL|passkey-reg|stage=cast status=fail")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }
        // `ASCredentialRequest.credentialIdentity` is declared `id<ASCredentialIdentity>` on the
        // base protocol (`ASCredentialRequest.h`) -- Swift sees `any ASCredentialIdentity` here even
        // though `request` is already narrowed to `ASPasskeyCredentialRequest`, so the
        // passkey-specific fields (`relyingPartyIdentifier`/`userName`/`userHandle`/`credentialID`)
        // need this ONE explicit downcast, the SAME pattern `fillPasskeyOrCancel` above already
        // established for the assertion path.
        guard let passkeyIdentity = request.credentialIdentity as? ASPasskeyCredentialIdentity else {
            Self.fillLogger.log("PVFILL|passkey-reg|stage=identity-cast status=fail")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }

        let lockState = SessionLifecycle.checkAndExpireIfNeeded(entryPoint: "register", deleteKeyArtifact: SessionKeyReader.delete)
        let preflight = PasskeyRegistrationPreflight.decide(
            supportedAlgorithms: request.supportedAlgorithms, isUnlocked: lockState == .unlocked
        )
        switch preflight {
        case .refuseUnsupportedAlgorithm:
            // <behavior>: refused BEFORE the confirmation screen -- mirrors make_credential_ctap2's
            // own Rust-side check (crates/pv-provider/src/ceremony.rs), never a UI the user confirms
            // into a guaranteed failure.
            Self.fillLogger.log("PVFILL|passkey-reg|stage=preflight status=refused-algorithm")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        case .refuseLocked:
            // T-43-12: no confirmation screen for an unlocked vault's contents is ever presented to
            // a locked-device attacker -- this override draws no THIRD unlock surface, unchanged.
            //
            // FIX (`.planning/debug/passkey-reg-blank-sheet-discord.md`, 2026-08-22): cancels with
            // `.failed`, NOT `.userInteractionRequired` -- LIVE FINDING this session:
            // `prepareInterface(forPasskeyRegistration:)` is the ONLY entry point a standard
            // (non-conditional) passkey registration request ever reaches (confirmed against the
            // real iPhoneOS26.5.sdk headers -- no sibling `provideCredentialWithoutUserInteraction`-
            // shaped "silent" registration entry point exists to retry into, unlike the assertion
            // family's silent -> interactive two-step this comment previously, incorrectly,
            // compared this to). Cancelling with `.userInteractionRequired` FROM INSIDE the already-
            // interactive entry point is a dead end: there is no further UI the system can offer in
            // response, and a live simulator reproduction (native-app-register locked, this session)
            // proved the requesting app's own `ASAuthorizationController` delegate never received
            // ANY callback -- neither success nor error -- for the full 50s test window; the
            // ceremony hung silently and permanently, exactly matching the reported symptom (a
            // native app's own passkey-creation sheet going inert after the user taps "Save"/"Add
            // Passkey", with no visible error). `.failed` is the code this SAME switch's sibling
            // refusal above (`.refuseUnsupportedAlgorithm`) already uses for an equivalent
            // no-further-recourse refusal, and matches `ASCredentialProviderViewController.h`'s own
            // documented convention for the interactive `prepareInterface*` family (pass "an
            // appropriate error code" for a genuine failure -- its own `.userInteractionRequired`
            // doc comment is scoped to the NON-interactive `provideCredentialWithoutUserInteraction`
            // family, which this override is not).
            Self.fillLogger.log("PVFILL|passkey-reg|stage=preflight status=refused-locked")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        case .proceed:
            break
        }
        Self.fillLogger.log("PVFILL|passkey-reg|stage=preflight status=ok")

        let userKey: FfiUserKey
        switch SessionKeyReader.importUserKey() {
        case let .success(uk):
            userKey = uk
        case .failure:
            Self.fillLogger.log("PVFILL|passkey-reg|stage=sessionkey status=fail")
            extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
            return
        }

        // Open Question 1 (43-RESEARCH.md): logged BEFORE any transformation, from a REAL
        // registration request -- settles empirically whether iOS forwards the RP's real
        // user.name/userHandle for a fresh registration, or synthesizes a placeholder. A permanent
        // diagnostic, not a temporary probe removed after this task. Lengths are `.public` (safe, no
        // account data); the values themselves are `.private` (T-41-12/T-41-15's inherited
        // discipline -- never a real account identifier `.public` in a device-persistent log).
        Self.fillLogger.log(
            "PVFILL|passkey-reg|stage=opt-01-oq1 userHandleLen=\(passkeyIdentity.userHandle.count, privacy: .public) userNameLen=\(passkeyIdentity.userName.count, privacy: .public)"
        )
        Self.fillLogger.log(
            "PVFILL|passkey-reg|stage=opt-01-oq1 userHandle=\(passkeyIdentity.userHandle as NSData, privacy: .private) userName=\(passkeyIdentity.userName, privacy: .private)"
        )

        let rpId = passkeyIdentity.relyingPartyIdentifier
        let accountName = passkeyIdentity.userName
        let clientDataHash = request.clientDataHash
        let supportedAlgorithms = request.supportedAlgorithms
        let excludedCredentialIds = request.excludedCredentials?.map { $0.credentialID } ?? []
        let userHandle = passkeyIdentity.userHandle

        presentRegistrationConfirm(
            rpId: rpId,
            accountName: accountName,
            onConfirm: { [weak self] in
                guard let self else { return }
                Task {
                    let itemId = UUID().uuidString.lowercased()
                    let algorithms = supportedAlgorithms.map { Int64($0.rawValue) }
                    let existingCredentialsJson = Self.existingPasskeysJson(rpId: rpId, userKey: userKey)

                    let result: FfiProviderRegistrationResult
                    do {
                        result = try providerMakeCredential(
                            rpId: rpId,
                            rpName: nil,
                            userId: userHandle,
                            userName: accountName,
                            userDisplayName: nil,
                            clientDataHash: clientDataHash,
                            supportedAlgorithms: algorithms,
                            excludedCredentialIds: excludedCredentialIds,
                            existingCredentialsJson: existingCredentialsJson
                        )
                    } catch {
                        Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=ceremony status=fail")
                        self.extensionContext.cancelRequest(withError: ASExtensionError(.failed))
                        return
                    }
                    Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=ceremony status=ok")

                    let wire: FfiEncryptedItemWire
                    do {
                        wire = try encryptItemWire(userKey: userKey, plaintext: result.newPasskeyJson, itemId: itemId, revision: 1)
                    } catch {
                        Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=encrypt status=fail")
                        self.extensionContext.cancelRequest(withError: ASExtensionError(.failed))
                        return
                    }
                    Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=encrypt status=ok")

                    // <behavior>: marked BEFORE the network attempt -- a process kill mid-POST
                    // leaves an explicit repair obligation (43-06's `PendingProviderItemStore`),
                    // mirroring `IdentityStoreSync.markSelfHealPending`'s own mark-before-risk
                    // discipline.
                    PendingProviderItemStore.markPending(itemId: itemId, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson)

                    if let baseURL = VaultAPI.extensionBaseURL() {
                        let api = VaultAPI(baseURL: baseURL, tokenProvider: { SessionTokenStore.load() })
                        do {
                            _ = try await api.createItem(id: itemId, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson)
                            PendingProviderItemStore.clearPending(itemId: itemId)
                            Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=network status=ok")
                        } catch {
                            // <behavior>: left pending on failure, never cleared here -- self-heal
                            // (43-06, `ContentView.retryPendingProviderItemsInBackground()`) covers
                            // eventual server visibility. The ceremony still completes locally below
                            // -- the RP-facing ceremony must not fail merely because the server POST
                            // is momentarily unreachable.
                            Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=network status=fail")
                        }
                    } else {
                        Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=network status=no-server-configured")
                    }

                    let identitySource = PasskeyIdentitySource(
                        itemId: itemId, rpId: rpId, credentialId: result.credentialId,
                        userHandle: userHandle, username: accountName
                    )
                    // The NEW required call site this task adds (43-PLAN-CHECK.md B6's assertion
                    // (B) extension) -- a single-item write, `upsertOnePasskey`, never `republish`/
                    // `republishPasskeys` (CR-01's invariant, extended identically to the passkey
                    // side, T-43-07's mitigation).
                    let identityResult = await IdentityStoreSync.upsertOnePasskey(source: identitySource)
                    switch identityResult {
                    case .success:
                        Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=identity-store status=ok")
                    case let .failure(error):
                        Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=identity-store status=fail error=\(error.description, privacy: .public)")
                    }

                    let credential = ASPasskeyRegistrationCredential(
                        relyingParty: rpId, clientDataHash: clientDataHash,
                        credentialID: result.credentialId, attestationObject: result.attestationObject
                    )
                    Self.fillLogger.log("PVFILL|passkey-reg|kind=passkey-registration stage=complete status=ok")
                    self.extensionContext.completeRegistrationRequest(using: credential, completionHandler: nil)

                    // Plan 41-07, Task 1 (ACC-07): the SAME post-fill activity refresh `fillOrCancel`/
                    // `performPasskeyAssertion` perform -- AutoFill-only usage must not log the user
                    // out mid-use.
                    SessionLifecycle.refreshActivity(writer: "extension")
                }
            },
            onCancel: { [weak self] in
                Self.fillLogger.log("PVFILL|passkey-reg|stage=confirm status=user-cancelled")
                self?.extensionContext.cancelRequest(withError: ASExtensionError(.userCanceled))
            }
        )
    }

    // MARK: - Plan 44-04 (SAVE-01) -- save password, silent + interactive entry points

    /// T-44-08 (DoS, mitigate): a sane upper bound on `request.credential.user`/`.password`
    /// (attacker-influenced, per this plan's own `<threat_model>`) BEFORE either string is ever
    /// handed to `encryptItemWire` -- refused via `cancelRequest(withError:)`, never truncated or
    /// silently accepted.
    private static let saveFieldMaxBytes = 4096

    /// Phase 44 (44-04-PLAN.md, SAVE-01), real implementation. The SYSTEM'S ACTUAL first entry
    /// point for a save (Landmine L-44, `ios/IOS-SPIKE-LOG.md`) -- per the SDK header
    /// (`ASCredentialProviderViewController.h`, "Attempt to save a password credential" doc
    /// block), this extension's view controller is NOT present on the screen when this method is
    /// called, so it can only complete silently or escalate -- it NEVER presents
    /// `SavePasswordConfirmView` itself. Escalates via `.userInteractionRequired`
    /// UNCONDITIONALLY, for every event: `prepareInterface(for: ASSavePasswordRequest)` below (VC
    /// now on screen) owns EVERY event branch, including `.generatedPasswordFilled`'s own
    /// no-UI-shown case, so this silent entry point never needs to special-case any event itself.
    override func performWithoutUserInteractionIfPossible(savePasswordRequest request: ASSavePasswordRequest) {
        Self.fillLogger.log(
            "PVFILL|entry=save-silent stage=entry event=\(String(describing: request.event), privacy: .public)"
        )
        extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
    }

    /// Presents `SavePasswordConfirmView` embedded as a child view controller -- same
    /// `UIHostingController` embedding `presentRegistrationConfirm`/`presentGeneratePasswordOffer`
    /// above already establish.
    private func presentSavePasswordConfirm(
        serviceIdentifier: String, username: String, onConfirm: @escaping () -> Void, onCancel: @escaping () -> Void
    ) {
        let hosting = UIHostingController(
            rootView: SavePasswordConfirmView(
                serviceIdentifier: serviceIdentifier, username: username, onConfirm: onConfirm, onCancel: onCancel
            )
        )
        addChild(hosting)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        hosting.didMove(toParent: self)
    }

    /// Phase 44 (44-04-PLAN.md, SAVE-01), real implementation, replacing Plan 44-03's
    /// diagnostic-only stub. The INTERACTIVE save entry point -- reached ONLY after the silent
    /// override above escalates via `.userInteractionRequired` (per the header, this method is
    /// never called directly by the system for a standard save request). Runs the SAME
    /// unlock-gating sequence `prepareInterface(forPasskeyRegistration:)` already established
    /// BEFORE presenting any UI (T-43-12's rule, applied identically here). Then branches on
    /// `request.event`: `.generatedPasswordFilled` runs the save pipeline directly, no
    /// confirmation UI (the header's own explicit "Providers should not request any additional
    /// information" instruction); `.userInitiated`/`.formDidDisappear` present
    /// `SavePasswordConfirmView` first.
    ///
    /// Placement (mirrors 43-PLAN-CHECK.md C1's own precedent): the required
    /// `IdentityStoreSync.upsertOne(` call lives inside `runSavePipeline`, a LOCAL CLOSURE
    /// VARIABLE (never a separate `private func`) declared directly inside this override's own
    /// body -- `scripts/audit-ios-identity-store-chokepoint.sh`'s assertion (B) measures this
    /// override's own extent by scanning forward to the NEXT `func` declaration at ANY
    /// indentation, so a nested `func` (unlike a nested closure) would prematurely truncate that
    /// gate's own bounded-forward window before ever reaching this call.
    override func prepareInterface(for request: ASSavePasswordRequest) {
        let entryPoint = "save"
        let lockState = SessionLifecycle.checkAndExpireIfNeeded(entryPoint: entryPoint, deleteKeyArtifact: SessionKeyReader.delete)
        let preflight = SavePasswordPreflight.decide(isUnlocked: lockState == .unlocked)
        switch preflight {
        case .refuseLocked:
            // T-43-12, applied identically here: no confirmation screen for an unlocked vault's
            // contents is ever shown to a locked-device attacker. `.failed`, not
            // `.userInteractionRequired` -- this is ALREADY the interactive entry point, with no
            // further-recourse UI the system can offer in response (the same reasoning
            // `.refuseLocked`'s own fix for the passkey-registration path already established).
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=preflight status=refused-locked")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        case .proceed:
            break
        }
        Self.fillLogger.log(
            "PVFILL|entry=\(entryPoint, privacy: .public) stage=preflight status=ok event=\(String(describing: request.event), privacy: .public)"
        )

        let serviceIdentifier = request.serviceIdentifier.identifier
        let username = request.credential.user
        let password = request.credential.password

        // T-44-08 (DoS, mitigate): refuse BEFORE any UI/encryption work, never truncate.
        guard username.utf8.count <= Self.saveFieldMaxBytes, password.utf8.count <= Self.saveFieldMaxBytes else {
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=length-check status=refused")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }

        let runSavePipeline: () -> Void = { [weak self] in
            guard let self else { return }
            // WR-01 (44-REVIEW.md): expiry in this codebase is LAZY -- it only happens when
            // `checkAndExpireIfNeeded` is called, which is what deletes the key artifact. The
            // preflight check above ran once, at the TOP of `prepareInterface`, BEFORE the
            // confirmation sheet was ever shown; this closure runs later, after an
            // unbounded user-visible delay (the user reading/confirming the sheet). A session
            // that crosses its ceiling while the sheet is on screen would otherwise never be
            // expired, `SessionKeyReader.importUserKey()` would still succeed, and the write
            // would proceed against a session that should be locked. Re-run the SAME gate here,
            // before the key read, never merely trusting the earlier result.
            guard
                SessionLifecycle.checkAndExpireIfNeeded(
                    entryPoint: entryPoint, deleteKeyArtifact: SessionKeyReader.delete
                ) == .unlocked
            else {
                Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=confirm status=expired-before-write")
                self.extensionContext.cancelRequest(withError: ASExtensionError(.failed))
                return
            }
            Task {
                let itemId = UUID().uuidString.lowercased()
                // `<action>` (44-04-PLAN.md): `name` derived from `request.title` when present and
                // non-empty, else the service identifier -- `request.title`'s own doc comment:
                // "A user-displayable name ... independent of the service identifier".
                let rawTitle = request.title ?? ""
                let name = rawTitle.isEmpty ? serviceIdentifier : rawTitle

                // Build the `LoginFields`-shaped JSON plaintext (`packages/pv-ui/vault/types.ts`'s
                // own shape, L-15) -- `44-RESEARCH.md`'s own worked example, verbatim field set.
                let plaintext: String
                do {
                    let payload: [String: Any] = [
                        "type": "login",
                        "name": name,
                        "folderId": NSNull(),
                        "tags": [String](),
                        "username": username,
                        "password": password,
                        "urls": [serviceIdentifier],
                        "notes": "",
                    ]
                    let data = try JSONSerialization.data(withJSONObject: payload)
                    plaintext = String(decoding: data, as: UTF8.self)
                } catch {
                    Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=encode-plaintext status=fail")
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.failed))
                    return
                }

                let userKey: FfiUserKey
                switch SessionKeyReader.importUserKey() {
                case let .success(uk):
                    userKey = uk
                case .failure:
                    Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=sessionkey status=fail")
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.failed))
                    return
                }

                let wire: FfiEncryptedItemWire
                do {
                    wire = try encryptItemWire(userKey: userKey, plaintext: plaintext, itemId: itemId, revision: 1)
                } catch {
                    Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=encrypt status=fail")
                    self.extensionContext.cancelRequest(withError: ASExtensionError(.failed))
                    return
                }
                Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=encrypt status=ok")

                // <behavior>: marked BEFORE the network attempt -- mirrors
                // `PendingProviderItemStore`'s own mark-before-risk discipline (43-06), identical
                // to the passkey-registration path.
                PendingProviderItemStore.markPending(itemId: itemId, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson)

                if let baseURL = VaultAPI.extensionBaseURL() {
                    let api = VaultAPI(baseURL: baseURL, tokenProvider: { SessionTokenStore.load() })
                    do {
                        _ = try await api.createItem(id: itemId, encKeyJson: wire.encKeyJson, encDataJson: wire.encDataJson)
                        PendingProviderItemStore.clearPending(itemId: itemId)
                        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=network status=ok")
                    } catch {
                        // Left pending on failure, never cleared here -- self-heal (43-06,
                        // `ContentView.retryPendingProviderItemsInBackground()`) covers eventual
                        // server visibility; the save still completes locally below.
                        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=network status=fail")
                    }
                } else {
                    Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=network status=no-server-configured")
                }

                // The header's own explicit, non-optional instruction ("You are responsible for
                // updating the ASCredentialIdentityStore") -- UNCONDITIONAL after a successful
                // save, never inferred (unlike the passkey path, where this is inferred
                // convention -- here it is a documented API contract, 44-04-PLAN.md's own
                // `key_links`). `scripts/audit-ios-identity-store-chokepoint.sh`'s assertion (B)
                // eighth entry measures THIS call, anchored on this override's own declaration.
                let identityResult = await IdentityStoreSync.upsertOne(
                    source: VaultIdentitySource(itemId: itemId, username: username, urls: [serviceIdentifier])
                )
                switch identityResult {
                case .success:
                    Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=identity-store status=ok")
                case let .failure(error):
                    Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=identity-store status=fail error=\(error.description, privacy: .public)")
                }

                Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=complete status=ok")
                self.extensionContext.completeSavePasswordRequest(completionHandler: nil)

                // ACC-07: the SAME post-fill activity refresh every other write path performs --
                // AutoFill-only usage must not log the user out mid-use.
                SessionLifecycle.refreshActivity(writer: "extension")
            }
        }

        if request.event == .generatedPasswordFilled {
            // Header, verbatim: "Providers should not request any additional information from the
            // user as that will not be transmitted back to the form." -- the pipeline runs
            // directly, no confirmation UI is ever presented for this event.
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=confirm status=skipped-generated-password-filled")
            runSavePipeline()
            return
        }

        presentSavePasswordConfirm(
            serviceIdentifier: serviceIdentifier,
            username: username,
            onConfirm: {
                Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=confirm status=confirmed")
                runSavePipeline()
            },
            onCancel: { [weak self] in
                Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=confirm status=user-cancelled")
                self?.extensionContext.cancelRequest(withError: ASExtensionError(.userCanceled))
            }
        )
    }

    // MARK: - Plan 44-05 (SAVE-02) -- password generation, silent + interactive entry points

    // The dispatch policy itself (`GeneratePasswordOutcome`/`GeneratePasswordDispatch.resolve`)
    // lives in `Shared/GeneratePasswordDispatch.swift`, NOT here -- `PasskeyVaultTests` has no
    // access to a type declared only in this extension-only file (same reasoning
    // `PasskeyRegistrationPreflight.swift`'s own header documents), and this plan's own Task 1
    // acceptance criteria require a genuinely live-run proof of the rules-honouring/fallback/
    // refusal three-way split -- `GeneratePasswordDispatchTests` (PasskeyVaultTests) exercises it
    // directly against real `pv-ffi`, no live extension context required.

    private static func makeGeneratedPassword(_ value: String) -> ASGeneratedPassword {
        ASGeneratedPassword(kind: .strong, value: value)
    }

    /// Phase 44 (44-03-PLAN.md Task 1b), real implementation (Plan 44-05). The SILENT entry point
    /// the system calls FIRST for password generation (44-03-SUMMARY.md, configuration X: tap the
    /// new-password field with no typing, then tap the system's own "Strong Password" QuickType
    /// affordance) -- header doc, verbatim: "When this method is called, your extension's view
    /// controller is not present on the screen. `ASExtensionError.userInteractionRequired` will
    /// not be honored and treated as a failure." So, unlike the save path above, this method never
    /// escalates via `userInteractionRequired`; every refusal (locked vault, or pv-core's own
    /// refusal) completes via `.failed`. This surface still needs an unlocked vault to reach
    /// `pv-ffi`, even though it writes nothing (mirrors every other entry point's own
    /// unconditional lock-gating discipline). A generate-only interaction does not extend the
    /// session -- `SessionLifecycle.refreshActivity` is deliberately NOT called here (Claude's
    /// discretion, recorded in 44-05-SUMMARY.md: no fill/write occurred, so nothing justifies
    /// extending the unlock window).
    override func performWithoutUserInteraction(generatePasswordsRequest request: ASGeneratePasswordsRequest) {
        let entryPoint = "generate-silent"
        guard SessionLifecycle.checkAndExpireIfNeeded(entryPoint: entryPoint, deleteKeyArtifact: SessionKeyReader.delete) == .unlocked else {
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=lock-check status=locked")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }
        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=lock-check status=unlocked")

        switch GeneratePasswordDispatch.resolve(rulesText: request.passwordFieldPasswordRules) {
        case let .candidate(value):
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=generate status=ok")
            extensionContext.completeGeneratePasswordRequest(
                results: [Self.makeGeneratedPassword(value)], completionHandler: nil
            )
        case .refuse:
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=generate status=refused")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
        }
    }

    /// Phase 44 (44-03-PLAN.md), real implementation (Plan 44-05), SAVE-02/SAVE-04. The
    /// INTERACTIVE generate entry point -- per the SDK header, reachable only via the system's own
    /// user-initiated affordance, never as an escalation from the silent override above (the
    /// header explicitly rules that escalation out: "It will not be triggered from
    /// `-performGeneratePasswordsRequestWithoutUserInteraction:`"). Whether this override is
    /// actually reached on this toolchain, now that the silent override above answers with a real
    /// candidate instead of `.userCanceled`, is the live question 44-03-SUMMARY.md left for THIS
    /// plan to settle (see 44-05-SUMMARY.md for the recorded verdict). Presents
    /// `GeneratePasswordOfferView` (PV* tokens, SAVE-04) on a genuine candidate; confirming it
    /// NEVER touches `VaultAPI`/`PendingProviderItemStore`/`IdentityStoreSync` (T-44-11) --
    /// generating a password writes nothing to the vault.
    override func prepareInterface(for request: ASGeneratePasswordsRequest) {
        let entryPoint = "generate-ui"
        guard SessionLifecycle.checkAndExpireIfNeeded(entryPoint: entryPoint, deleteKeyArtifact: SessionKeyReader.delete) == .unlocked else {
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=lock-check status=locked")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
            return
        }
        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=lock-check status=unlocked")

        switch GeneratePasswordDispatch.resolve(rulesText: request.passwordFieldPasswordRules) {
        case let .candidate(value):
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=generate status=ok")
            presentGeneratePasswordOffer(
                candidate: value,
                onUse: { [weak self] in
                    guard let self else { return }
                    Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=offer status=used")
                    self.extensionContext.completeGeneratePasswordRequest(
                        results: [Self.makeGeneratedPassword(value)], completionHandler: nil
                    )
                },
                onCancel: { [weak self] in
                    Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=offer status=user-cancelled")
                    self?.extensionContext.cancelRequest(withError: ASExtensionError(.userCanceled))
                }
            )
        case .refuse:
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=generate status=refused")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
        }
    }

    /// Presents `GeneratePasswordOfferView` (SAVE-04) embedded as a child view controller -- same
    /// `UIHostingController` embedding `presentRegistrationConfirm` above already established.
    private func presentGeneratePasswordOffer(
        candidate: String, onUse: @escaping () -> Void, onCancel: @escaping () -> Void
    ) {
        let hosting = UIHostingController(
            rootView: GeneratePasswordOfferView(candidate: candidate, onUse: onUse, onCancel: onCancel)
        )
        addChild(hosting)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        hosting.didMove(toParent: self)
    }

    // MARK: - Plan 44-06 (SAVE-03) -- text-to-insert (cached TOTP codes)

    /// Real, unconditional implementation (Plan 44-06), replacing Plan 44-03's `#if DEBUG`
    /// cancel-only stub. No per-invocation context is available (44-03-SUMMARY.md: confirmed
    /// directly from the SDK header -- this method takes no parameters, and
    /// `ASCredentialProviderExtensionContext`'s own public surface carries no property describing
    /// "what triggered this call"), so this offers every cached TOTP-typed item, bounded and
    /// sorted for a stable presentation order (T-44-13, `<threat_model>`'s own named, accepted
    /// scope limitation -- this is the only implementable behaviour without inventing an
    /// unsupported API contract).
    ///
    /// Runs the SAME unlock-gating sequence every other entry point in this file runs
    /// (`SessionLifecycle.checkAndExpireIfNeeded` -> `SessionKeyReader.importUserKey`) before
    /// touching the cold cache -- a locked vault cancels via `.userInteractionRequired`
    /// (retriable, matching the save path's own convention for "the vault needs to be unlocked
    /// first", never `.failed`).
    override func prepareInterfaceForUserChoosingTextToInsert() {
        let entryPoint = "text-insert"
        let lockState = SessionLifecycle.checkAndExpireIfNeeded(entryPoint: entryPoint, deleteKeyArtifact: SessionKeyReader.delete)
        guard lockState == .unlocked else {
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=lock-check status=locked")
            extensionContext.cancelRequest(withError: ASExtensionError(.userInteractionRequired))
            return
        }
        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=lock-check status=unlocked")

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

        // The extension's own cold cache -- `AppGroupCiphertextCacheStore`, the SAME store
        // `performPasskeyAssertion`/`runIdentityRebuildIfPending` already read -- is the ONLY data
        // source (FILL-05's offline discipline, `<key_links>`): no network call. Absent/unreadable
        // cache is not a failure here -- an empty candidate list is a legitimate, valid answer.
        var candidates: [TextToInsertDispatch.Candidate] = []
        let store = AppGroupCiphertextCacheStore()
        if
            let accountMarker = store.currentAccountMarker(),
            let snapshot = store.readCurrentSnapshot(accountId: accountMarker.accountId, serverBaseURL: accountMarker.serverBaseURL)
        {
            candidates = TextToInsertDispatch.buildCandidates(snapshot: snapshot, userKey: userKey)
        }
        Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=list status=ok count=\(candidates.count, privacy: .public)")

        presentTextToInsertList(candidates: candidates, entryPoint: entryPoint)
    }

    /// Presents `TextToInsertListView` (SAVE-04) embedded as a child view controller -- same
    /// `UIHostingController` embedding `presentGeneratePasswordOffer`/`presentRegistrationConfirm`
    /// above already establish.
    private func presentTextToInsertList(candidates: [TextToInsertDispatch.Candidate], entryPoint: String) {
        let hosting = UIHostingController(
            rootView: TextToInsertListView(
                items: candidates,
                onSelect: { [weak self] candidate in
                    self?.completeTextToInsert(candidate: candidate, entryPoint: entryPoint)
                }
            )
        )
        addChild(hosting)
        hosting.view.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(hosting.view)
        NSLayoutConstraint.activate([
            hosting.view.topAnchor.constraint(equalTo: view.topAnchor),
            hosting.view.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hosting.view.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            hosting.view.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        hosting.didMove(toParent: self)
    }

    /// `<behavior>` (44-06-PLAN.md): re-computes `candidate`'s code FRESH at the instant of
    /// selection -- never the value the row last rendered, which could already have rolled over
    /// given TOTP's 30s-default window. `SessionLifecycle.refreshActivity` runs on success, mirroring
    /// `performPasskeyAssertion`'s own discipline (a real value was delivered to the requesting
    /// app, unlike the generate-only path above which never calls it).
    private func completeTextToInsert(candidate: TextToInsertDispatch.Candidate, entryPoint: String) {
        let now = UInt64(max(0, Date().timeIntervalSince1970))
        switch TextToInsertDispatch.freshCode(for: candidate, at: now) {
        case let .success(result):
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=select status=ok itemId=\(candidate.itemId, privacy: .public)")
            extensionContext.completeRequest(withTextToInsert: result.code, completionHandler: nil)
            SessionLifecycle.refreshActivity(writer: "extension")
        case .failure:
            Self.fillLogger.log("PVFILL|entry=\(entryPoint, privacy: .public) stage=select status=fail itemId=\(candidate.itemId, privacy: .public)")
            extensionContext.cancelRequest(withError: ASExtensionError(.failed))
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

        // REQUIRED FIX #1 (`.planning/debug/faceid-unlock-loop.md`): `checkAndExpireIfNeeded` now
        // returns `LockState`, not `Bool` -- same read-gating "may I read the key right now"
        // question as `fillOrCancel`'s own updated call site above; compared against `.unlocked`
        // explicitly, behaviour unchanged.
        guard SessionLifecycle.checkAndExpireIfNeeded(entryPoint: "rebuild", deleteKeyArtifact: SessionKeyReader.delete) == .unlocked else {
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
        // Plan 43-07: passkey items scanned in the SAME pass, closing the deferred limitation
        // 43-05-SUMMARY.md recorded -- a full rebuild handed ONLY password sources would, on a
        // device where `state.supportsIncrementalUpdates` is FALSE, wipe every registered passkey
        // identity (`IdentityStoreSync.republishRebuild`'s own header explains the fix). Detection
        // mirrors `performPasskeyAssertion`'s own raw-wire-shape check above (no `type` key,
        // `credential_id`/`rp_id` present) -- not a second scanning mechanism, the SAME loop.
        var passkeySources: [PasskeyIdentitySource] = []
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
            if
                let raw = (try? JSONSerialization.jsonObject(with: Data(plaintext.utf8))) as? [String: Any],
                raw["type"] == nil,
                let rpId = raw["rp_id"] as? String,
                let credentialIdInts = raw["credential_id"] as? [Int]
            {
                let credentialId = Data(credentialIdInts.map { UInt8(truncatingIfNeeded: $0) })
                let userHandle = (raw["user_handle"] as? [Int]).map { Data($0.map { UInt8(truncatingIfNeeded: $0) }) } ?? Data()
                let username = raw["username"] as? String
                passkeySources.append(PasskeyIdentitySource(
                    itemId: row.id, rpId: rpId, credentialId: credentialId, userHandle: userHandle, username: username
                ))
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

        // Plan 43-07: `republishRebuild`, not `republish` -- the combined entry point that closes
        // the deferred cross-type full-replacement collision (`IdentityStoreSync.swift`'s own
        // "Combined full-vault rebuild" section header).
        let result = await IdentityStoreSync.republishRebuild(passwordSources: sources, passkeySources: passkeySources)
        switch result {
        case .success:
            fillLogger.log("PVFILL|E41-2|stage=rebuild status=ok count=\(sources.count, privacy: .public) passkeyCount=\(passkeySources.count, privacy: .public) decodeFailures=\(decodeFailures, privacy: .public)")
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
