//
//  VaultSearchTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-06, Task 1.
//
//  Every assertion here is written against `packages/pv-ui/vault/search.ts`
//  and `packages/pv-ui/vault/sort.ts`'s ACTUAL behaviour, not against an
//  intuition about what "search" ought to cover. The narrowness is the
//  point (D5): a query matching a card's cardholder name or a TOTP's issuer
//  must return NOTHING, even though a reasonable person would expect
//  otherwise. Written FIRST, before `VaultSearch.swift`/`VaultSort.swift`/
//  `VaultFilter.swift` existed, per the plan's TDD instruction.
//

import Foundation
import Testing
@testable import PasskeyVault

struct VaultSearchTests {

    // MARK: - Fixtures

    private func login(
        id: String = "l-1", name: String, username: String = "", password: String = "p",
        urls: [String] = [], folderId: String? = nil, tags: [String] = [],
        lastUsedAt: String? = nil
    ) -> VaultItemViewModel {
        VaultItemViewModel(
            id: id, revision: 1,
            content: .fields(
                .login(
                    LoginFields(
                        name: name, folderId: folderId, tags: tags, username: username,
                        password: password, urls: urls, notes: ""
                    )
                )
            ),
            lastUsedAt: lastUsedAt
        )
    }

    private func card(
        id: String = "c-1", name: String, cardholderName: String, lastUsedAt: String? = nil
    ) -> VaultItemViewModel {
        VaultItemViewModel(
            id: id, revision: 1,
            content: .fields(
                .card(
                    CardFields(
                        name: name, folderId: nil, tags: [], cardholderName: cardholderName,
                        number: "4111111111111111", expiry: "01/30", cvv: "123", pin: nil,
                        zip: nil, notes: ""
                    )
                )
            ),
            lastUsedAt: lastUsedAt
        )
    }

    private func totp(id: String = "t-1", name: String, issuer: String) -> VaultItemViewModel {
        VaultItemViewModel(
            id: id, revision: 1,
            content: .fields(
                .totp(
                    TotpFields(
                        name: name, folderId: nil, tags: [], secret: "JBSWY3DPEHPK3PXP",
                        issuer: issuer, algorithm: "SHA1", digits: 6, period: 30, notes: ""
                    )
                )
            )
        )
    }

    private func note(
        id: String = "n-1", name: String, folderId: String? = nil, tags: [String] = []
    ) -> VaultItemViewModel {
        VaultItemViewModel(
            id: id, revision: 1,
            content: .fields(.note(NoteFields(name: name, folderId: folderId, tags: tags, body: "")))
        )
    }

    // MARK: - Narrowness (D5) -- the negative tests are the point

    @Test func aQueryMatchingACardholderNameReturnsNoResultsButTheCardsOwnNameMatches() {
        let items = [card(name: "Groceries card", cardholderName: "Bartłomiej Paczesny")]
        #expect(VaultSearch.searchItems(items, query: "paczesny").isEmpty)
        #expect(VaultSearch.searchItems(items, query: "groceries").map(\.id) == ["c-1"])
    }

    @Test func aQueryMatchingATotpIssuerReturnsNoResults() {
        let items = [totp(name: "Work MFA", issuer: "GitHub")]
        #expect(VaultSearch.searchItems(items, query: "github").isEmpty)
        #expect(VaultSearch.searchItems(items, query: "work mfa").map(\.id) == ["t-1"])
    }

    // MARK: - Login-only fields

    @Test func aQueryMatchingALoginsUsernameReturnsIt() {
        let items = [login(name: "GitHub", username: "bartek@paczesny.pl")]
        #expect(VaultSearch.searchItems(items, query: "bartek@paczesny").map(\.id) == ["l-1"])
    }

    @Test func aQueryMatchingAUrlsHostnameReturnsItButItsPathDoesNot() {
        let items = [login(name: "GitHub", urls: ["https://github.com/settings/security"])]
        #expect(VaultSearch.searchItems(items, query: "github.com").map(\.id) == ["l-1"])
        #expect(VaultSearch.searchItems(items, query: "settings").isEmpty)
        #expect(VaultSearch.searchItems(items, query: "security").isEmpty)
    }

    @Test func aNonUsernameFieldOfANonLoginTypeIsNeverSearched() {
        // The identity/notes/pin/cvv/email-shaped surfaces this predicate
        // deliberately never reaches -- a login's own username IS searched
        // (previous test); an identity's email must NOT be.
        let identity = VaultItemViewModel(
            id: "i-1", revision: 1,
            content: .fields(
                .identity(
                    IdentityFields(
                        name: "Passport", folderId: nil, tags: [], firstName: "Bartek",
                        lastName: "P", email: "bartek@paczesny.pl", phone: "", address: "",
                        addressLine1: nil, addressLine2: nil, city: nil, state: nil, zip: nil,
                        country: nil, notes: ""
                    )
                )
            )
        )
        #expect(VaultSearch.searchItems([identity], query: "bartek@paczesny").isEmpty)
    }

    // MARK: - domainFromUrl fallback

    @Test func aUrlThatDoesNotParseFallsBackToTheRawStringSoABareDomainStillMatches() {
        #expect(VaultSearch.domainFromUrl("example.com") == "example.com")
        let items = [login(name: "Bare domain login", urls: ["example.com"])]
        #expect(VaultSearch.searchItems(items, query: "example.com").map(\.id) == ["l-1"])
    }

    // MARK: - Diacritics (D5's second half)

    /// "Café Résumé", not a Polish word with `ł` -- `ł` (U+0142) has no
    /// Unicode canonical decomposition to plain `l`, so a diacritic-folding
    /// comparison would NOT actually fold it, which would make a query like
    /// "hasło" -> "haslo" a false negative for BOTH the correct predicate
    /// and a folding one and prove nothing about the divergence under test.
    /// `é` DOES decompose (`e` + combining acute), so it is the fixture that
    /// actually distinguishes the two behaviours, confirmed against a
    /// standalone Foundation check before being relied on here.
    @Test func aQueryWithoutDiacriticsDoesNotMatchANameContainingThem() {
        let items = [note(name: "Café Résumé")]
        #expect(VaultSearch.searchItems(items, query: "cafe resume").isEmpty)
        // The exact accented substring still matches, proving this is a
        // narrowness assertion and not a broken predicate.
        #expect(VaultSearch.searchItems(items, query: "café résumé").map(\.id) == ["n-1"])
    }

    // MARK: - Pipeline order: filter, then search, then sort

    @Test func filteringByFolderThenSearchingReturnsTheSameConjunctionEitherOrder() {
        let items = [
            note(id: "n-1", name: "Alpha", folderId: "f-1"),
            note(id: "n-2", name: "Alphabet", folderId: "f-2"),
            note(id: "n-3", name: "Beta", folderId: "f-1"),
        ]
        let filterThenSearch = VaultSearch.searchItems(
            VaultFilterFunctions.filterItems(items, filter: .folder(id: "f-1")), query: "alpha"
        )
        let searchThenFilter = VaultFilterFunctions.filterItems(
            VaultSearch.searchItems(items, query: "alpha"), filter: .folder(id: "f-1")
        )
        #expect(Set(filterThenSearch.map(\.id)) == Set(searchThenFilter.map(\.id)))
        #expect(filterThenSearch.map(\.id) == ["n-1"])
    }

    /// Demonstrates the pipeline composes filter -> search -> sort and that
    /// narrowing happens BEFORE sorting, not the reverse: an item excluded
    /// by the folder filter must never reach the final sorted output even
    /// though it would otherwise match the query.
    @Test func thePipelineNarrowsBeforeItSorts() {
        let items = [
            note(id: "keep-1", name: "Alpha keep", folderId: "f-1"),
            note(id: "drop-1", name: "Alpha drop", folderId: "f-2"),
            note(id: "keep-2", name: "Alpha also keep", folderId: "f-1"),
        ]
        let filtered = VaultFilterFunctions.filterItems(items, filter: .folder(id: "f-1"))
        let searched = VaultSearch.searchItems(filtered, query: "alpha")
        let result = VaultSort.sortItems(searched, by: .name)
        #expect(result.map(\.id) == ["keep-2", "keep-1"])
        #expect(!result.map(\.id).contains("drop-1"))
    }

    // MARK: - Sort

    @Test func sortingByLastUsedPlacesANeverUsedItemAfterEveryUsedItem() {
        let recentUsed = VaultItemViewModel(
            id: "recent", revision: 1,
            content: .fields(.note(NoteFields(name: "Alpha", folderId: nil, tags: [], body: ""))),
            lastUsedAt: "2026-08-01T00:00:00Z"
        )
        let neverUsed = VaultItemViewModel(
            id: "never", revision: 1,
            content: .fields(.note(NoteFields(name: "Zulu", folderId: nil, tags: [], body: "")))
        )
        let sorted = VaultSort.sortItems([neverUsed, recentUsed], by: .lastUsed)
        #expect(sorted.map(\.id) == ["recent", "never"])
    }

    @Test func sortingByLastUsedOrdersUsedItemsMostRecentFirst() {
        let older = note(id: "older", name: "Older")
        let newer = note(id: "newer", name: "Newer")
        let olderUsed = VaultItemViewModel(
            id: older.id, revision: 1, content: older.content, lastUsedAt: "2026-01-01T00:00:00Z"
        )
        let newerUsed = VaultItemViewModel(
            id: newer.id, revision: 1, content: newer.content, lastUsedAt: "2026-08-01T00:00:00Z"
        )
        let sorted = VaultSort.sortItems([olderUsed, newerUsed], by: .lastUsed)
        #expect(sorted.map(\.id) == ["newer", "older"])
    }

    @Test func sortingByNameIsPlainLexicalOrderIgnoringLastUsedEntirely() {
        let zulu = VaultItemViewModel(
            id: "z", revision: 1,
            content: .fields(.note(NoteFields(name: "Zulu", folderId: nil, tags: [], body: ""))),
            lastUsedAt: "2026-08-01T00:00:00Z"
        )
        let alpha = VaultItemViewModel(
            id: "a", revision: 1,
            content: .fields(.note(NoteFields(name: "Alpha", folderId: nil, tags: [], body: ""))),
            lastUsedAt: nil
        )
        let sorted = VaultSort.sortItems([zulu, alpha], by: .name)
        #expect(sorted.map(\.id) == ["a", "z"])
    }

    // MARK: - undecryptable is never filtered (extends the ported behaviour)

    @Test func anUndecryptableRowSurvivesAnActiveSearchQueryAndEveryFilter() {
        let broken = VaultItemViewModel(
            id: "broken", revision: 1, content: .undecryptable(reason: "AEAD tag mismatch")
        )
        let alpha = note(id: "alpha", name: "Alpha", folderId: "f-1")
        let items = [broken, alpha]
        #expect(VaultSearch.searchItems(items, query: "nothing matches this").map(\.id).contains("broken"))
        #expect(
            VaultFilterFunctions.filterItems(items, filter: .folder(id: "f-1")).map(\.id)
                .contains("broken")
        )
        #expect(
            VaultFilterFunctions.filterItems(items, filter: .itemType("login")).map(\.id)
                .contains("broken")
        )
    }

    @Test func aPendingFamilyKeyRowIsExcludedByAnActiveSearchQueryButNotByAllFilter() {
        let pending = VaultItemViewModel(id: "pending", revision: 0, content: .pendingFamilyKey)
        #expect(VaultSearch.searchItems([pending], query: "family").isEmpty)
        #expect(VaultFilterFunctions.filterItems([pending], filter: .all).map(\.id) == ["pending"])
    }
}
