//
//  MemberRosterTests.swift
//  PasskeyVaultTests
//
//  Phase 40 (rodzina-i-współdzielenie-na-telefonie), plan 40-07, Task 1.
//  THIS task's own suite -- holds the roster decode/render tests only.
//  `RemoveMemberTests` (Task 2) is a SEPARATE file: it is first authored by
//  Task 2, so a Task 1 gate pointing at it would either be unrunnable or
//  vacuous, and Task 1's own acceptance criteria would be verified by
//  nothing (this file's own plan text, verbatim).
//

import Foundation
@testable import PasskeyVault
import SwiftUI
import Testing
import UIKit

@Suite(.serialized)
struct MemberRosterTests {

    // MARK: - Captured real `GET /api/families/members` response body

    /// Captured LIVE from a real `pv-server` instance
    /// (`scripts/ios-live-server.sh`, throwaway DB), a genuine three-member
    /// family: a plain member the OWNER fingerprint-verified, a plain member
    /// who has never published an identity keypair, and the owner
    /// themselves (unverified from their own perspective -- nobody
    /// auto-verifies themselves). Recorded verbatim, byte-for-byte, from the
    /// server's own JSON response -- NOT a hand-typed fixture shape. See
    /// this plan's own SUMMARY for the full capture transcript (accounts,
    /// server origin, timestamp).
    private static let capturedRosterBody = """
    [{"user_id":"64ecbf96-871a-4bb4-a5d5-632fab9349a4","email":"pv-capture-verified-1bb93a60-e30f-469f-9757-310a8fcdae7e@example.invalid","role":"member","joined_at":"2026-08-19 11:15:34","public_key":"ZuHnQ/YVNb99N8G1K0CpRijy1shHpxMlwbSzJlXtfhk=","fingerprint":"ee87caf0853cfc5400b651ad61a51660b7f7a370299a4ffc502a561bb5022322","verified_at":"2026-08-19 11:15:34","status":"active"},{"user_id":"da9b9db3-473a-44bf-b489-2ad18012bbac","email":"pv-capture-nokey-1bb93a60-e30f-469f-9757-310a8fcdae7e@example.invalid","role":"member","joined_at":"2026-08-19 11:15:34","public_key":null,"fingerprint":null,"verified_at":null,"status":"active"},{"user_id":"f3991322-2a67-4baa-bac5-ac6827698e61","email":"pv-capture-owner-1bb93a60-e30f-469f-9757-310a8fcdae7e@example.invalid","role":"owner","joined_at":"2026-08-19 11:15:34","public_key":"1APzHqxg/uQW4sYzYdmtSliJgBGoZLzeY9izCov2WS4=","fingerprint":"f6cb5e2ae9973c95463469a33a57c2a99c3671e4a5fc7fcd2b784bd9726cc262","verified_at":null,"status":"active"}]
    """

    private static func decodedCapturedRoster() throws -> [FamilyAPI.FamilyMemberRecord] {
        try JSONDecoder().decode([FamilyAPI.FamilyMemberRecord].self, from: Data(capturedRosterBody.utf8))
    }

    /// Positive assertion on REAL server output (this task's own acceptance
    /// criteria, verbatim): every listed member's fingerprint and status
    /// reach the decoded record -- not a hand-written fixture shape.
    @Test func decodesEveryMemberOfARealCapturedRosterBody() throws {
        let members = try Self.decodedCapturedRoster()
        #expect(members.count == 3)

        let verified = try #require(members.first { $0.role == "member" && $0.publicKey != nil })
        #expect(verified.fingerprint == "ee87caf0853cfc5400b651ad61a51660b7f7a370299a4ffc502a561bb5022322")
        #expect(verified.verifiedAt != nil, "the owner fingerprint-verified this member -- verified_at must be non-nil")
        #expect(verified.status == "active")

        let noKey = try #require(members.first { $0.publicKey == nil })
        #expect(noKey.fingerprint == nil, "families.rs's own contract: fingerprint is Some(hex) ONLY when public_key is Some")
        #expect(noKey.verifiedAt == nil)
        #expect(noKey.status == "active")

        let owner = try #require(members.first { $0.role == "owner" })
        #expect(owner.fingerprint == "f6cb5e2ae9973c95463469a33a57c2a99c3671e4a5fc7fcd2b784bd9726cc262")
        #expect(owner.verifiedAt == nil, "the viewer (the owner, in this capture) never auto-verifies their own fingerprint")
    }

    /// The decode reaching `FamilyAPI.FamilyMemberRecord` is only half the
    /// claim -- this asserts the SAME captured rows reach the correct
    /// `MemberFingerprintDisplayState`, the pure function `MemberListView`'s
    /// own row actually switches on.
    @Test func everyDecodedMemberReachesTheCorrectFingerprintDisplayState() throws {
        let members = try Self.decodedCapturedRoster()
        let verified = try #require(members.first { $0.role == "member" && $0.publicKey != nil })
        let noKey = try #require(members.first { $0.publicKey == nil })
        let owner = try #require(members.first { $0.role == "owner" })

        #expect(MemberFingerprintDisplayState.resolve(verified) == .verified(fingerprint: verified.fingerprint!))
        #expect(MemberFingerprintDisplayState.resolve(noKey) == .noPublishedKey)
        #expect(MemberFingerprintDisplayState.resolve(owner) == .notYetVerified(fingerprint: owner.fingerprint!))
    }

    // MARK: - "No published key" is DISTINCT from "not yet verified"

    private static func fixtureMember(
        userId: String = "fixture-user", publicKey: String?, fingerprint: String?, verifiedAt: String?
    ) -> FamilyAPI.FamilyMemberRecord {
        FamilyAPI.FamilyMemberRecord(
            userId: userId, email: "\(userId)@example.invalid", role: "member", joinedAt: "2026-01-01",
            publicKey: publicKey, fingerprint: fingerprint, verifiedAt: verifiedAt, status: "active"
        )
    }

    /// This task's own acceptance criteria, verbatim: "A member with no
    /// published public key is rendered as such, distinctly from a member
    /// who simply has not been fingerprint-verified. Conflating the two
    /// hides the condition that makes a reseal impossible." Two fixtures,
    /// both otherwise identical (`verifiedAt: nil`), differing ONLY in
    /// whether `publicKey` is present.
    @Test func noPublishedKeyRendersDistinctlyFromNotYetVerified() {
        let noKeyMember = Self.fixtureMember(publicKey: nil, fingerprint: nil, verifiedAt: nil)
        let unverifiedMember = Self.fixtureMember(
            publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            fingerprint: "deadbeef00112233445566778899aabbccddeeff00112233445566778899aa",
            verifiedAt: nil
        )

        let noKeyState = MemberFingerprintDisplayState.resolve(noKeyMember)
        let unverifiedState = MemberFingerprintDisplayState.resolve(unverifiedMember)

        #expect(noKeyState == .noPublishedKey)
        #expect(unverifiedState == .notYetVerified(fingerprint: unverifiedMember.fingerprint!))
        #expect(noKeyState != unverifiedState, "the two states must never collapse into one")
    }

    @Test func verifiedIsDistinctFromNotYetVerifiedForTheSameFingerprint() {
        let fingerprint = "cafebabe00112233445566778899aabbccddeeff00112233445566778899aa"
        let publicKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        let unverified = Self.fixtureMember(publicKey: publicKey, fingerprint: fingerprint, verifiedAt: nil)
        let verified = Self.fixtureMember(publicKey: publicKey, fingerprint: fingerprint, verifiedAt: "2026-01-02")

        #expect(MemberFingerprintDisplayState.resolve(unverified) == .notYetVerified(fingerprint: fingerprint))
        #expect(MemberFingerprintDisplayState.resolve(verified) == .verified(fingerprint: fingerprint))
        #expect(MemberFingerprintDisplayState.resolve(unverified) != MemberFingerprintDisplayState.resolve(verified))
    }

    // MARK: - Fingerprint display shape (CR-01: full six-word form, not the
    // removed 8-hex-char truncation -- `packages/pv-ui/identity/fingerprint
    // .test.ts`'s own known-answer vector, ported.)

    @Test func displayFingerprintRendersTheSixWordFormNotATruncation() throws {
        let hex = "a3f5c91b7e2d40689fabc123456789deadbeef0011223344556677889900aabb"
        let expected = "physical · purity · egg · wisdom · staff · crowd"
        #expect(MemberListView.displayFingerprint(hex) == expected)
        #expect(try IdentityFingerprint.format(hex) == expected)
    }

    @Test func displayFingerprintFailsClosedOnMalformedInputRatherThanTruncating() {
        let malformed = "not-a-real-fingerprint"
        // Falls back to the raw (honestly wrong-looking) input rather than
        // silently truncating or padding into a plausible six-word output.
        #expect(MemberListView.displayFingerprint(malformed) == malformed)
        #expect(throws: IdentityFingerprintError.self) { try IdentityFingerprint.words(malformed) }
    }

    // MARK: - Evidence: three members, three distinct statuses (human-check)
    //
    // A deterministic, synchronous evidence view -- NOT the real `MemberListView`
    // itself (whose `.task`-driven async load has no reliable completion
    // signal under `ImageRenderer` alone, the same class of non-determinism
    // `AccessLevelTests.swift`'s own header records for `UIHostingController`
    // accessibility-tree introspection, L-29). Renders the SAME production
    // `MemberFingerprintDisplayState`/copy this file's own tests already
    // prove correct, laid out to mirror `MemberListView`'s real row shape.

    private struct RosterEvidenceRow: View {
        let member: FamilyAPI.FamilyMemberRecord

        var body: some View {
            HStack(spacing: 12) {
                Circle()
                    .fill(Color(white: 0.9))
                    .frame(width: 32, height: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(member.email)
                        .font(.system(size: 15))
                    fingerprintText
                    if member.status == "suspended" {
                        Text("Zawieszony/a")
                            .font(.caption)
                            .foregroundStyle(Color.orange)
                    }
                }
                Spacer()
                Text(member.role == "owner" ? "Właściciel/Właścicielka" : "Członek/Członkini")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color(white: 0.85))
                    .clipShape(Capsule())
            }
            .padding(.vertical, 6)
        }

        @ViewBuilder
        private var fingerprintText: some View {
            switch MemberFingerprintDisplayState.resolve(member) {
            case .noPublishedKey:
                Text("Odcisk pojawi się po pierwszym odblokowaniu vaulta przez tę osobę po aktualizacji.")
                    .font(.system(size: 11))
                    .foregroundStyle(Color(white: 0.4))
            case let .notYetVerified(fingerprint):
                Text("Odcisk tożsamości: \(MemberListView.displayFingerprint(fingerprint)) — Zweryfikuj")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color(white: 0.4))
            case let .verified(fingerprint):
                Text("Odcisk tożsamości: \(MemberListView.displayFingerprint(fingerprint)) — Zweryfikowano")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(Color(white: 0.4))
            }
        }
    }

    private struct RosterEvidenceView: View {
        let members: [FamilyAPI.FamilyMemberRecord]

        var body: some View {
            VStack(alignment: .leading, spacing: 4) {
                Text("Członkowie")
                    .font(.system(size: 20, weight: .bold))
                    .padding(.bottom, 8)
                ForEach(members, id: \.userId) { member in
                    RosterEvidenceRow(member: member)
                    Divider()
                }
            }
            .padding(20)
            .frame(width: 393, alignment: .leading)
            .background(Color.white)
        }
    }

    private static var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // PasskeyVaultTests/
            .deletingLastPathComponent() // PasskeyVault/
            .deletingLastPathComponent() // ios/
            .deletingLastPathComponent() // repo root
    }

    private static var planningEvidenceDirectory: URL {
        repoRoot
            .appendingPathComponent(".planning")
            .appendingPathComponent("phases")
            .appendingPathComponent("40-rodzina-i-wsp-dzielenie-na-telefonie")
            .appendingPathComponent("evidence")
    }

    private static var durableEvidenceDirectory: URL {
        repoRoot.appendingPathComponent("ios").appendingPathComponent("evidence").appendingPathComponent("40")
    }

    enum EvidenceError: Error, CustomStringConvertible {
        case renderFailed
        var description: String { "failed to render the 40-07 roster evidence screenshot" }
    }

    /// Renders the three captured members (three DISTINCT statuses: verified,
    /// no-key, owner-unverified) to a PNG -- the human-check half of Task 1's
    /// `<verify>`. A suspended-member row is ALSO included so all four status
    /// shapes this codebase's roster can show are visible in one screenshot.
    @MainActor
    @Test func rendersRosterEvidenceScreenshotWithDistinctStatuses() throws {
        let members = try Self.decodedCapturedRoster()
        let suspended = FamilyAPI.FamilyMemberRecord(
            userId: "suspended-fixture", email: "suspended@example.invalid", role: "member",
            joinedAt: "2026-01-01", publicKey: nil, fingerprint: nil, verifiedAt: nil, status: "suspended"
        )

        let evidenceView = RosterEvidenceView(members: members + [suspended])
        let renderer = ImageRenderer(content: evidenceView)
        renderer.scale = 3
        guard let uiImage = renderer.uiImage, let pngData = uiImage.pngData() else {
            throw EvidenceError.renderFailed
        }

        let planningDir = Self.planningEvidenceDirectory
        try FileManager.default.createDirectory(at: planningDir, withIntermediateDirectories: true)
        let durableDir = Self.durableEvidenceDirectory
        try FileManager.default.createDirectory(at: durableDir, withIntermediateDirectories: true)

        try pngData.write(to: planningDir.appendingPathComponent("40-07-t1-roster.png"))
        try pngData.write(to: durableDir.appendingPathComponent("40-07-t1-roster.png"))
    }
}
