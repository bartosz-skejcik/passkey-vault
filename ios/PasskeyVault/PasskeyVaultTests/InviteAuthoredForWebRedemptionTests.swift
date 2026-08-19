//
//  InviteAuthoredForWebRedemptionTests.swift
//  PasskeyVaultTests
//
//  40-VERIFICATION.md gap 2 (SC2's web half, WR-08 discharged): the iOS-side
//  HALF of a genuine cross-client redemption -- registers account A, creates
//  the (singleton) family, and generates a REAL invite link through the
//  REAL production `InviteService` (the SAME call `InviteCreateView`'s own
//  "Generate" button makes). Deliberately does NOT redeem the invite
//  itself -- that is `scripts/invite-live-e2e.mjs`'s job, run HOST-side
//  against the REAL `pv-wasm` artifact `web/` imports (L-27: `Foundation
//  .Process` is unavailable INSIDE an iOS test process, which is why
//  `InviteTests.liveInviteRedeemedBySecondSwiftAccount` could not spawn it
//  -- irrelevant here, since the orchestrating script below runs entirely
//  host-side and merely invokes this test as one step).
//
//  Writes a small JSON handoff (`baseURL`, `inviteURL`, `emailA`, `tokenA`,
//  `familyName`) to `PV_GAP2_HANDOFF_FILE` (falls back to a fixed path
//  under the system temp directory so a bare `xcodebuild test` invocation
//  without that env var still produces a discoverable file) -- consumed by
//  `scripts/gap2-web-redemption-e2e.sh`, never committed to the repo
//  itself.
//

import Foundation
import Testing
@testable import PasskeyVault

@MainActor
struct InviteAuthoredForWebRedemptionTests {
    fileprivate static var liveServerBaseURL: URL {
        let raw = ProcessInfo.processInfo.environment["PV_TEST_SERVER"] ?? "http://127.0.0.1:8621"
        guard let url = URL(string: raw) else {
            fatalError("PV_TEST_SERVER is not a valid URL: \(raw)")
        }
        return url
    }

    /// `#filePath` resolves to THIS file's absolute path at compile time --
    /// same technique `InviteTests.repoRoot` already uses to read/write
    /// real repo-relative paths from inside a simulator test process (the
    /// simulator process is NOT sandboxed away from the host disk the way
    /// a real device is). Deliberately NOT `NSTemporaryDirectory()` --
    /// that resolves to the SIMULATOR's own sandboxed container temp
    /// directory, invisible to the host-side orchestrator script that
    /// needs to read this file back (discovered live: the first run of
    /// this test wrote successfully but the host-side script could not
    /// find the file at any host path).
    fileprivate static var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PasskeyVaultTests/
            .deletingLastPathComponent() // PasskeyVault/
            .deletingLastPathComponent() // ios/
            .deletingLastPathComponent() // repo root
    }

    fileprivate static var handoffFileURL: URL {
        if let raw = ProcessInfo.processInfo.environment["PV_GAP2_HANDOFF_FILE"] {
            return URL(fileURLWithPath: raw)
        }
        // Default: a dotfile at the repo root, never committed (the
        // orchestrator script deletes it in its own cleanup trap) --
        // guaranteed to be a real, host-visible path regardless of
        // whether the env var above made it through the test process's
        // environment.
        return Self.repoRoot.appendingPathComponent(".gap2-invite-handoff.json")
    }

    /// Authors ONE real invite through the production `InviteService`
    /// (real `pv-ffi`, real HTTP against a live `pv-server`) and hands it
    /// off to the host-side orchestrator via a JSON file. Mirrors
    /// `InviteTests.liveInviteRedeemedBySecondSwiftAccount`'s own setup
    /// half exactly (account A registration, `createFamily`,
    /// `generateInviteLink`) -- the only difference is that redemption
    /// happens OUTSIDE this process.
    @Test func authorInviteForHostSideWebRedemption() async throws {
        let baseURL = Self.liveServerBaseURL
        let runSuffix = "\(Int(Date().timeIntervalSince1970))-\(UUID().uuidString.prefix(8))".lowercased()
        let emailA = "pv-gap2-a-\(runSuffix)@example.invalid"
        let password = "PvGap2-40-EvidencePassword!"
        let familyName = "GAP2 family \(runSuffix)"

        let sessionA = try await AccountService(apiClient: PvApiClient(baseURL: baseURL))
            .register(email: emailA, password: password)

        let familyAPI = FamilyAPI(baseURL: baseURL, tokenProvider: { sessionA.token })
        _ = try await familyAPI.createFamily(name: familyName)

        let inviteService = InviteService(baseURL: baseURL, tokenProvider: { sessionA.token })
        let inviteURL = try await inviteService.generateInviteLink(userKey: sessionA.userKey, expiresIn: "1h")

        #expect(
            inviteURL.absoluteString.contains("/invite/") && inviteURL.fragment?.isEmpty == false,
            "generated invite link must look like {origin}/invite/{id}#{secret}"
        )

        let handoff: [String: String] = [
            "baseURL": baseURL.absoluteString,
            "inviteURL": inviteURL.absoluteString,
            "emailA": emailA,
            "tokenA": sessionA.token,
            "familyName": familyName,
        ]
        let data = try JSONSerialization.data(withJSONObject: handoff, options: [.sortedKeys])
        try data.write(to: Self.handoffFileURL, options: .atomic)
    }
}
