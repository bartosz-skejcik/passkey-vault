//
//  FaviconLoaderPersistenceProofTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06, Task 2. The falsifiable
//  proof design-conformance §3's iOS-only hazard demands: after fetching a
//  favicon for a real vault domain, the app's shared on-disk `URLCache`
//  must hold NOTHING naming that domain -- because a persistent cache
//  entry there would be a favicon for every site in the vault sitting in
//  the app container, READABLE WHILE THE VAULT IS LOCKED.
//
//  A positive assertion here is worthless without a demonstrated negative
//  control (this project's own repeated lesson: "an assertion never seen
//  failing is not evidence"). The negative-control arm below runs the
//  IDENTICAL fetch through a DEFAULT `URLSession` (the mistake this file
//  exists to catch) and shows the exact same assertion FAIL for it.
//

import Foundation
import Testing
@testable import PasskeyVault

// Swift Testing runs test functions within a suite CONCURRENTLY by
// default. Both tests here mutate the SAME process-wide `URLCache.shared`
// singleton -- run in parallel, the negative control's own fetch can land
// in the shared cache while the positive test is mid-assertion, producing
// exactly the false failure a genuine FaviconLoader bug would also
// produce. `.serialized` is not a style preference here; without it this
// suite cannot tell a real regression from its own test-isolation race.
@Suite(.serialized)
@MainActor
struct FaviconLoaderPersistenceProofTests {
    /// A real, live-reachable domain, not a stub -- the whole point is
    /// observing what `URLCache.shared` actually receives from a real
    /// HTTP response with real `Cache-Control` headers.
    private static let realDomain = "github.com"

    /// Positive arm: `FaviconLoader`'s ephemeral session must leave
    /// NOTHING in the shared on-disk cache.
    @Test func faviconLoaderLeavesNoDiskCacheEntryForTheFetchedDomain() async throws {
        URLCache.shared.removeAllCachedResponses()

        let loader = FaviconLoader()
        #expect(loader.isConfiguredWithNoDiskCache, "FaviconLoader's session must carry no URLCache at all")

        let data = await loader.favicon(forHostname: Self.realDomain)
        #expect(data != nil, "the live fetch itself must succeed, or this proof asserts nothing")

        let faviconURL = try #require(URL(string: "https://\(Self.realDomain)/favicon.ico"))
        let cached = URLCache.shared.cachedResponse(for: URLRequest(url: faviconURL))
        #expect(
            cached == nil,
            "URLCache.shared unexpectedly holds a cached response for \(Self.realDomain) after an ephemeral-session fetch"
        )
    }

    /// FALSIFICATION (negative control): the SAME fetch, through a DEFAULT
    /// `URLSession` -- the exact mistake this loader exists to avoid.
    /// Demonstrates the assertion above is capable of failing: if this arm
    /// passed too, the positive arm above would be proving nothing.
    @Test func aDefaultURLSessionDemonstrablyLeavesADiskCacheEntryTheEphemeralLoaderDoesNot() async throws {
        URLCache.shared.removeAllCachedResponses()

        let faviconURL = try #require(URL(string: "https://\(Self.realDomain)/favicon.ico"))
        // Deliberately the DEFAULT session -- no `.ephemeral`, no
        // `urlCache = nil` override -- reproducing exactly the hazard
        // design-conformance §3 names.
        let (data, response) = try await URLSession.shared.data(from: faviconURL)
        #expect(!data.isEmpty, "the live fetch itself must succeed, or this negative control proves nothing")
        _ = response

        let cached = URLCache.shared.cachedResponse(for: URLRequest(url: faviconURL))
        #expect(
            cached != nil,
            """
            FALSIFICATION FAILED: a default URLSession fetch left no disk \
            cache entry either, which means the positive test above is not \
            actually distinguishing ephemeral from default sessions -- it \
            would pass unconditionally and prove nothing.
            """
        )
    }
}
