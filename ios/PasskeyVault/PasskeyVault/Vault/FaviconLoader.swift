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
import Network

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
        // 2026-08-21 privacy fix (real device log, Bartek's own vault): an imported entry whose
        // URL field held an Android app package name (`com.xiaomi.smarthome`,
        // `com.contextlogic.wish`) was being treated as a hostname and resolved on EVERY list
        // render that showed the row -- `-1003 could not be found` in the log is Foundation
        // failing the DNS lookup, not the app declining to attempt one. That lookup is ALL COST,
        // NO BENEFIT: it can never return a favicon (a package name is not a website), while it
        // DOES hand the presence of a vault entry to whatever resolver the device is using --
        // exactly the leak this file's own header says the zero-knowledge favicon rule accepts
        // only ONE deliberate instance of (a direct request to an item's OWN real domain). Reuse
        // the SAME failed-host cache as an ordinary favicon failure below -- this is a silent,
        // routine empty state (falls back to the monochrome glyph tile), never an error surface.
        guard Self.isPlausibleDNSHostname(hostname) else {
            failedHosts.insert(hostname)
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

    // MARK: - Hostname plausibility (the DNS-leak-that-can-never-return-a-favicon guard)

    /// True only for a value that could plausibly be a real, DNS-resolvable hostname -- the gate
    /// `favicon(forHostname:)` checks BEFORE issuing any network request. Rejects, at minimum:
    ///   - a non-http(s) scheme (`androidapp://`, `otpauth://`) -- never a web origin regardless
    ///     of what authority it carries;
    ///   - a single-label name (`localhost`, or a bare package name with no dot at all) -- no
    ///     `favicon.ico` request to it could ever be meaningful;
    ///   - the reverse-DNS app-package SHAPE (`com.xiaomi.smarthome`) via
    ///     `OriginNormalize.looksLikeAppPackageName` -- reused rather than duplicated, so the
    ///     favicon path and the identity-store registrar (`IdentityStoreSync.serviceHost`) can
    ///     never drift onto two different definitions of "not a domain".
    /// An IP literal (v4 or v6), with or without a port, is explicitly ALLOWED -- self-hosted/LAN
    /// entries are legitimate vault items; whether a LAN address is actually fetchable is a
    /// separate, already-filed limitation, not this predicate's concern.
    nonisolated static func isPlausibleDNSHostname(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }

        if trimmed.contains("://") {
            guard let scheme = URL(string: trimmed)?.scheme?.lowercased(), scheme == "http" || scheme == "https"
            else { return false }
        }

        let withoutPort = stripPort(trimmed)

        if IPv4Address(withoutPort) != nil || IPv6Address(withoutPort) != nil {
            return true
        }

        let labels = withoutPort.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.count >= 2, labels.allSatisfy({ !$0.isEmpty }) else { return false }

        return !OriginNormalize.looksLikeAppPackageName(withoutPort.lowercased())
    }

    /// Strips a trailing `:port` so the shape/IP checks above see just the host part. Bracketed
    /// IPv6-with-port (`[::1]:8080`) is unwrapped explicitly; a bare IPv6 literal is left alone --
    /// it is ALL colons, so the "exactly one colon, all-digit suffix" rule below never fires on it
    /// by construction.
    private nonisolated static func stripPort(_ value: String) -> String {
        if value.hasPrefix("["), let closeBracket = value.firstIndex(of: "]") {
            return String(value[value.index(after: value.startIndex)..<closeBracket])
        }
        guard value.filter({ $0 == ":" }).count == 1, let colonIndex = value.firstIndex(of: ":") else {
            return value
        }
        let portPart = value[value.index(after: colonIndex)...]
        guard !portPart.isEmpty, portPart.allSatisfy(\.isNumber) else { return value }
        return String(value[..<colonIndex])
    }
}
