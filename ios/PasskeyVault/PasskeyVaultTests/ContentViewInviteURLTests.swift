//
//  ContentViewInviteURLTests.swift
//  PasskeyVaultTests
//
//  40-REVIEW.md (iteration 2), WR-21: `ContentView.onOpenURL` previously
//  captured ANY URL the OS handed the app unconditionally, and the sheet
//  it feeds presented `InviteRedeemView` pre-filled with it regardless of
//  scheme/host/path. `isValidInviteURL` is the extracted, `static`, pure
//  predicate the fixed handler now gates on.
//

import Foundation
import Testing
@testable import PasskeyVault

struct ContentViewInviteURLTests {

    private static let serverHost = "vault.example.invalid"

    @Test func acceptsAWellFormedInviteLinkFromTheConfiguredServer() throws {
        let url = try #require(URL(string: "https://vault.example.invalid/invite/abc123#sealed-secret"))
        #expect(ContentView.isValidInviteURL(url, serverHost: Self.serverHost))
    }

    /// THE decisive test (WR-21's own fix note): a URL from an unrelated
    /// host must be rejected outright -- the pre-fix handler captured
    /// this unconditionally.
    @Test func rejectsAUrlFromAnUnrelatedHost() throws {
        let url = try #require(URL(string: "https://evil.example.invalid/invite/abc123#sealed-secret"))
        #expect(!ContentView.isValidInviteURL(url, serverHost: Self.serverHost))
    }

    @Test func rejectsAUrlOnTheConfiguredHostWithoutAnInvitePathSegment() throws {
        let url = try #require(URL(string: "https://vault.example.invalid/not-an-invite/abc123#sealed-secret"))
        #expect(!ContentView.isValidInviteURL(url, serverHost: Self.serverHost))
    }

    @Test func rejectsAUrlWithNoFragment() throws {
        let url = try #require(URL(string: "https://vault.example.invalid/invite/abc123"))
        #expect(!ContentView.isValidInviteURL(url, serverHost: Self.serverHost))
    }

    @Test func rejectsAUrlWithAnEmptyFragment() throws {
        let url = try #require(URL(string: "https://vault.example.invalid/invite/abc123#"))
        #expect(!ContentView.isValidInviteURL(url, serverHost: Self.serverHost))
    }
}
