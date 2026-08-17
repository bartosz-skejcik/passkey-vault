//
//  FaviconLoader.swift
//  PasskeyVault
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06, Task 2. Added as a Rule 2
//  deviation (auto-add missing critical functionality) -- design-conformance
//  §3 treats the favicon path as a SECURITY SUBSYSTEM, not a nicety, and it
//  is not in this plan's original `files_modified` list because the plan
//  predates the approved design.
//
//  TWO constraints this file exists to hold, both security not style:
//
//  1. ZERO-KNOWLEDGE FAVICON RULE: every request goes DIRECT to the domain
//     an item already legitimately belongs to. Never a third-party favicon
//     proxy, never routed through `pv-server`. A proxy hands a third party
//     the list of every site in the vault; `pv-server` routing hands it to
//     the server this product promises never sees it.
//  2. iOS-ONLY HAZARD the web client does not have: the DEFAULT `URLSession`
//     writes a persistent ON-DISK `URLCache`. That would leave a favicon for
//     every site in the vault sitting in the app container -- READABLE
//     WHILE THE VAULT IS LOCKED. That is vault contents at rest, leaked
//     through the icon layer. This loader therefore uses an EPHEMERAL
//     `URLSession` (`.ephemeral` configuration, `urlCache = nil`) and a
//     MEMORY-ONLY cache that is never written to disk and vanishes on
//     process exit -- never `UserDefaults`, never a file, never the shared
//     `URLCache.shared`.
//
//  `ItemIconTileTests.swift`'s `FaviconLoaderPersistenceProofTests` (or the
//  UI evidence recorded in 38-06-SUMMARY.md, whichever this plan's Task 2
//  lands) is the falsifiable proof this rule is not merely asserted --  see
//  that test/evidence for the negative control run against a DEFAULT
//  `URLSession` demonstrating the assertion CAN fail.
//

import Foundation

@MainActor
final class FaviconLoader {
    static let shared = FaviconLoader()

    /// `URLSession` does not send a `Referer` header on its own -- there is
    /// no browser navigation context to leak from a raw socket request, so
    /// the web client's explicit `referrerPolicy="no-referrer"` on its
    /// `<img>` tag has no direct Foundation equivalent to set; the property
    /// this loader actually needs to hold is the ABSENCE of a persistent
    /// cache, enforced below.
    private let session: URLSession

    /// Memory-only. Never `UserDefaults`, never a file on disk, never
    /// `URLCache.shared`. Cleared automatically when the process exits --
    /// there is no explicit "clear on lock" call because there is nothing
    /// here that survives past the process anyway.
    private var imageCache: [String: Data] = [:]

    /// Hosts that have already failed to resolve a favicon -- never
    /// retried, matching `ItemIconTile.tsx`'s `FAILED_FAVICON_HOSTS`.
    private var failedHosts: Set<String> = []

    init() {
        let configuration = URLSessionConfiguration.ephemeral
        // Belt-and-braces: `.ephemeral` already implies no persistent
        // storage, but `urlCache = nil` makes the "never written to disk"
        // property hold even if a future edit swaps the configuration base
        // without noticing what `.ephemeral` was silently buying.
        configuration.urlCache = nil
        configuration.urlCredentialStorage = nil
        configuration.httpCookieStorage = nil
        self.session = URLSession(configuration: configuration)
    }

    /// Fetches (or returns the cached bytes for) a hostname's
    /// `/favicon.ico`. Returns `nil` on any failure -- a missing/broken
    /// favicon is an entirely expected, silent case that falls back to the
    /// neutral glyph tile, never surfaced as an error (matching the web
    /// component's own stated contract).
    func favicon(forHostname hostname: String) async -> Data? {
        if let cached = imageCache[hostname] {
            return cached
        }
        if failedHosts.contains(hostname) {
            return nil
        }
        guard let url = URL(string: "https://\(hostname)/favicon.ico") else {
            failedHosts.insert(hostname)
            return nil
        }
        do {
            let (data, response) = try await session.data(from: url)
            guard
                let http = response as? HTTPURLResponse,
                (200..<300).contains(http.statusCode),
                !data.isEmpty
            else {
                failedHosts.insert(hostname)
                return nil
            }
            imageCache[hostname] = data
            return data
        } catch {
            failedHosts.insert(hostname)
            return nil
        }
    }

    /// TEST-ONLY: exposes whether a hostname's bytes are currently held in
    /// the memory-only cache, and whether the underlying session's
    /// configuration actually carries no `URLCache` -- the two facts the
    /// persistence proof needs to assert on, without reaching into private
    /// state via mirrors.
    var isConfiguredWithNoDiskCache: Bool {
        session.configuration.urlCache == nil
    }
}
