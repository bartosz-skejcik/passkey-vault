//
//  LockTeardownTests.swift
//  PasskeyVaultTests
//
//  Phase 38 (pełny interfejs vaulta), plan 38-11, Task 1.
//
//  Three boundaries this file exercises, deliberately kept apart:
//
//  * `VaultStore`/`FolderStore` -- the store's OWN teardown (`lock()`):
//    arrays/maps emptied, hydration flag cleared, key handle released.
//    The key-handle release is proven with a WEAK reference, not merely by
//    reading a property back as `nil` -- the strongest available assertion
//    that the reference was genuinely dropped, not that a getter now
//    returns a different value while the object underneath is still alive
//    (this project's own recurring "true in the artifact, false in
//    reality" defect shape).
//  * `VaultRootController` -- the view-state half a store does not own:
//    the navigation path, the presented sheet, the detail screen's reveal
//    set, and search. `VaultRootController.lockTeardown()` is a plain
//    method on a plain `@Observable` class, callable here with NO view
//    hierarchy at all.
//  * `AutoLockPolicy` -- the whitelist validation on read (T-38-11-02),
//    ported from `web/src/lib/idle/autolock.ts`'s own three-shape failure
//    coverage: an out-of-list value, a negative value, a non-numeric value.
//
//  A fake `URLProtocol` transport (same shape as `VaultMutationTests
//  .VaultMutationStubURLProtocol`) answers `VaultStore.create`/`.refresh`
//  with canned, always-successful responses -- these tests are about STATE
//  TEARDOWN, not about the network or the crypto wire format (both already
//  covered elsewhere: `VaultStoreRoundTripTests.swift`,
//  `VaultMutationTests.swift`). The KEY is real (`FfiUserKey.generate()`),
//  because the weak-reference test needs a REAL class instance to observe
//  being released.
//

import Foundation
import Testing
@testable import PasskeyVault

// MARK: - Fake transport (state-teardown tests only; not a wire-format proof)

/// Answers every request with a fixed 201/200 body regardless of path --
/// unlike `VaultMutationTests.VaultMutationStubURLProtocol`, these tests
/// never need to distinguish one endpoint from another, only to get PAST
/// the network call so `VaultStore.create`/`.refresh` can run their real
/// local bookkeeping.
final class LockTeardownStubURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let path = request.url?.path ?? ""
        let (status, body): (Int, Data)
        if path.hasSuffix("/items") {
            status = 201
            body = Data(
                #"{"id":"lock-teardown-fixture","revision":1,"updated_at":"2026-01-01T00:00:00Z"}"#
                    .utf8
            )
        } else {
            // `GET /api/sync?since=N` -- always reports "up to date", which
            // is enough to exercise `isHydrated` without needing a real
            // encrypted row.
            status = 200
            body = Data(#"{"revision":7}"#.utf8)
        }
        let response = HTTPURLResponse(
            url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

@MainActor
struct LockTeardownTests {
    private static let fakeBaseURL = URL(string: "https://lock-teardown-tests.invalid")!

    private static func stubSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [LockTeardownStubURLProtocol.self]
        return URLSession(configuration: config)
    }

    private static func makeApi() -> VaultAPI {
        VaultAPI(baseURL: fakeBaseURL, tokenProvider: { "fake-token" }, session: stubSession())
    }

    private static func noteFields(name: String = "n") -> ItemFields {
        .note(NoteFields(name: name, folderId: nil, tags: ["one"], body: "b"))
    }

    private static func makeItem() -> VaultItemViewModel {
        VaultItemViewModel(id: "fixture-item", revision: 1, content: .fields(noteFields()))
    }

    // MARK: - VaultStore.lock()

    /// Component 1/2 of the store's own teardown: arrays/maps and the
    /// hydration flag.
    @Test
    func lockEmptiesTheStoresArraysMapsAndHydrationFlag() async throws {
        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.makeApi())

        // Seed real state through the store's own real call paths -- not by
        // poking `items` directly (it is `private(set)` for exactly this
        // reason: nothing outside this file may set it any other way).
        _ = try await store.create(fields: Self.noteFields())
        try await store.refresh()

        #expect(!store.items.isEmpty)
        #expect(!store.allTags.isEmpty)
        #expect(store.isHydrated)

        store.lock()

        #expect(store.items.isEmpty)
        #expect(store.allTags.isEmpty)
        #expect(store.lastKnownRevision == 0)
        #expect(!store.isHydrated)
    }

    /// Component: the weak reference. The ONLY strong reference to `userKey`
    /// alive after this inner closure returns is the one `VaultStore.init`
    /// stored internally -- so `weakKey` becoming `nil` after `lock()` is
    /// direct evidence the store released ITS reference, not merely that a
    /// getter now reports something different.
    @Test
    func lockReleasesTheKeyHandleSoAWeakReferenceIsNilAfterward() throws {
        weak var weakKey: FfiUserKey?
        let store: VaultStore = try {
            let userKey = try FfiUserKey.generate()
            weakKey = userKey
            return VaultStore(userKey: userKey, api: Self.makeApi())
        }()

        // Sanity: the store is still holding it before the lock.
        #expect(weakKey != nil, "the store should still hold the key handle before lock()")

        store.lock()

        #expect(weakKey == nil, "a weak reference taken before the lock must be nil afterward")
    }

    /// Post-lock, every operation needing the key refuses outright rather
    /// than crashing or silently no-op'ing (T-38-11-05's "no field value
    /// leaks" companion: an operation that could not refuse would have to
    /// force-unwrap a nil key handle instead).
    @Test
    func operationsRefuseAfterLockRatherThanCrashing() async throws {
        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.makeApi())
        store.lock()

        await #expect(throws: VaultStoreError.locked) {
            try await store.create(fields: Self.noteFields())
        }
        await #expect(throws: VaultStoreError.locked) {
            try await store.refresh()
        }
    }

    // MARK: - CR-02 (38-REVIEW.md): a lock landing WHILE a mutation is
    // in-flight must not resurrect decrypted plaintext into the torn-down
    // store.

    /// A transport whose response is deliberately DELAYED, so `store.lock()`
    /// can be forced to land while `create`/`refresh` is suspended at its
    /// `await` -- reproducing CR-02's exact race without depending on real
    /// network timing. Same canned bodies as `LockTeardownStubURLProtocol`.
    final class DelayedLockRaceStubURLProtocol: URLProtocol, @unchecked Sendable {
        /// WR-06 (38-REVIEW.md, iteration 2): signaled the INSTANT
        /// `startLoading()` begins -- the moment the awaited network call is
        /// confirmed in flight, not merely scheduled. Reset by each test
        /// immediately before it kicks off the `Task` that will trigger a
        /// request, so a signal can never be consumed by the wrong test.
        /// `DispatchSemaphore` is thread-safe by design; `nonisolated(unsafe)`
        /// only acknowledges that this file, not the compiler, is
        /// responsible for that reset-before-use ordering.
        nonisolated(unsafe) static var requestStarted = DispatchSemaphore(value: 0)

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            Self.requestStarted.signal()
            let path = request.url?.path ?? ""
            let (status, body): (Int, Data)
            if path.hasSuffix("/items") {
                status = 201
                body = Data(
                    #"{"id":"cr02-race-fixture","revision":1,"updated_at":"2026-01-01T00:00:00Z"}"#
                        .utf8
                )
            } else {
                status = 200
                body = Data(#"{"revision":7}"#.utf8)
            }
            // Still deliberately slow -- long enough that `lock()` (which
            // the test now issues only AFTER the checkpoint above has
            // signaled) always lands well before this response arrives.
            // The signal, not this duration, is what makes the ordering
            // deterministic; the delay just gives the test loop room to
            // schedule `store.lock()` before this thread wakes up.
            Thread.sleep(forTimeInterval: 0.3)
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }

    private static func delayedRaceApi() -> VaultAPI {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [DelayedLockRaceStubURLProtocol.self]
        let session = URLSession(configuration: config)
        return VaultAPI(baseURL: fakeBaseURL, tokenProvider: { "fake-token" }, session: session)
    }

    /// WR-06 (38-REVIEW.md, iteration 2): suspends the CALLER off the
    /// MainActor while waiting for the stub's `startLoading()` to signal.
    /// Deliberately NOT a synchronous `DispatchSemaphore.wait()` on the
    /// test's own (MainActor-isolated) body -- that would freeze the
    /// MainActor's serial executor, and the `create`/`refresh` `Task` below
    /// needs MainActor time to even ENTER its awaited call in the first
    /// place, so a synchronous wait here would deadlock every time, not
    /// flake.
    private static func waitForRequestStarted() async {
        await withCheckedContinuation { continuation in
            DispatchQueue.global().async {
                DelayedLockRaceStubURLProtocol.requestStarted.wait()
                continuation.resume()
            }
        }
    }

    /// RED-before-green: before the CR-02 fix, `store.items` was NOT empty
    /// here -- `create`'s post-`await` bookkeeping ran unconditionally and
    /// re-inserted the decrypted plaintext item after `lock()` had already
    /// torn the store down.
    ///
    /// WR-06 (38-REVIEW.md, iteration 2): the two `#expect`s this test
    /// asserted before iteration 2 (`store.items.isEmpty`, `!store
    /// .isHydrated`) are satisfied whether the guard actually fired OR
    /// `lock()` merely ran after the response had already arrived -- an
    /// outcome-only assertion cannot tell the two apart, and a sleep-based
    /// race (50ms vs. the stub's 300ms) could lose under a loaded CI
    /// runner, a cold simulator, or an attached debugger and pass
    /// vacuously on unfixed code. Two independent changes close that:
    /// (1) `waitForRequestStarted()` replaces the sleep with a real
    /// synchronization point, so the lock deterministically lands mid-
    /// flight on every run, not just the lucky ones; (2) asserting
    /// `store.lockedMidFlightGuardHits == 1` and
    /// `#expect(throws: VaultStoreError.locked)` prove the GUARD ITSELF
    /// fired (WR-02 made the guard throw rather than quietly return),
    /// which a late `lock()` could never produce -- a late lock leaves
    /// `create` to return normally, not throw `.locked`.
    @Test
    func aLockDuringAnInFlightCreateLeavesTheStoreEmptyRatherThanResurrectingPlaintext() async throws {
        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.delayedRaceApi())

        DelayedLockRaceStubURLProtocol.requestStarted = DispatchSemaphore(value: 0)
        let createTask = Task { try await store.create(fields: Self.noteFields()) }

        await Self.waitForRequestStarted()
        store.lock()

        await #expect(throws: VaultStoreError.locked) {
            _ = try await createTask.value
        }

        #expect(
            store.lockedMidFlightGuardHits == 1,
            "the post-await lock guard must have fired exactly once -- distinguishes the guard catching the race from a lock that merely ran after the response arrived"
        )
        #expect(
            store.items.isEmpty,
            "a lock landing mid-create must not be undone by create's post-await bookkeeping"
        )
        #expect(!store.isHydrated)
    }

    /// Same race, for `refresh()`: before the CR-02 fix, `isHydrated` was
    /// resurrected to `true` (and, on a `.snapshot` response, `items`
    /// repopulated) even though `lock()` had already run. See the create
    /// test's own header for why the checkpoint + guard-hit-count pairing
    /// (WR-06) replaces the sleep-based race here too.
    @Test
    func aLockDuringAnInFlightRefreshDoesNotResurrectHydration() async throws {
        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.delayedRaceApi())

        DelayedLockRaceStubURLProtocol.requestStarted = DispatchSemaphore(value: 0)
        let refreshTask = Task { try await store.refresh() }

        await Self.waitForRequestStarted()
        store.lock()

        try await refreshTask.value

        #expect(
            store.lockedMidFlightGuardHits == 1,
            "the post-await lock guard must have fired exactly once -- distinguishes the guard catching the race from a lock that merely ran after the response arrived"
        )
        #expect(!store.isHydrated, "a lock landing mid-refresh must not be undone by refresh's post-await bookkeeping")
        #expect(store.items.isEmpty)
        #expect(store.lastKnownRevision == 0)
    }

    // MARK: - FolderStore.lock()

    @Test
    func folderStoreLockEmptiesFoldersAndReleasesTheKeyHandle() throws {
        weak var weakKey: FfiUserKey?
        let store: FolderStore = try {
            let userKey = try FfiUserKey.generate()
            weakKey = userKey
            return FolderStore(userKey: userKey, api: Self.makeApi())
        }()

        #expect(weakKey != nil)
        store.lock()
        #expect(store.folders.isEmpty)
        #expect(weakKey == nil, "FolderStore.lock() must release its key handle too")
    }

    // MARK: - VaultRootController.lockTeardown() -- the view-state half

    /// RED-before-green target 1/4: comment out `selection = nil` in
    /// `VaultRootController.lockTeardown()` and this fails.
    @Test
    func lockTeardownTruncatesTheNavigationPathBackToTheListRoot() throws {
        let controller = VaultRootController()
        controller.selection = Self.makeItem()

        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.makeApi())

        controller.lockTeardown(store: store, folderStore: nil)

        #expect(controller.selection == nil, "unlocking must return to the list root, not the previously viewed item")
    }

    /// RED-before-green target 2/4: comment out `activeSheet = nil` and
    /// this fails.
    @Test
    func lockTeardownDismissesAnyPresentedSheet() throws {
        let controller = VaultRootController()
        controller.activeSheet = .generator

        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.makeApi())

        controller.lockTeardown(store: store, folderStore: nil)

        #expect(controller.activeSheet == nil, "a presented sheet must be dismissed by the lock")
    }

    /// RED-before-green target 3/4: comment out the `revealState = ...`
    /// reset and this fails.
    @Test
    func lockTeardownClearsTheRevealSet() throws {
        let controller = VaultRootController()
        controller.revealState = DetailRevealState(itemId: "fixture-item")
        _ = controller.revealState.toggle("password")
        #expect(controller.revealState.isRevealed("password"))

        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.makeApi())

        controller.lockTeardown(store: store, folderStore: nil)

        #expect(!controller.revealState.isRevealed("password"), "the reveal set must be empty after a lock")
    }

    @Test
    func lockTeardownDismissesAndClearsSearch() throws {
        let controller = VaultRootController()
        controller.isSearchPresented = true
        controller.searchText = "hunter2"
        controller.searchTokens = [VaultFilterToken(tag: "work")]

        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.makeApi())

        controller.lockTeardown(store: store, folderStore: nil)

        #expect(!controller.isSearchPresented)
        #expect(controller.searchText.isEmpty)
        #expect(controller.searchTokens.isEmpty)
    }

    /// The full handler in one place: every field a lock must reach,
    /// including the store's own, asserted together -- this is the "one
    /// handler, not several observers" claim itself, not just its parts.
    @Test
    func lockTeardownReachesEveryPieceOfStateInOneCall() async throws {
        let controller = VaultRootController()
        controller.selection = Self.makeItem()
        controller.activeSheet = .editing(Self.makeItem())
        controller.revealState = DetailRevealState(itemId: "fixture-item")
        _ = controller.revealState.toggle("secret")
        controller.isSearchPresented = true
        controller.searchText = "x"

        weak var weakKey: FfiUserKey?
        let store: VaultStore = try {
            let userKey = try FfiUserKey.generate()
            weakKey = userKey
            return VaultStore(userKey: userKey, api: Self.makeApi())
        }()
        _ = try await store.create(fields: Self.noteFields())

        let folderUserKey = try FfiUserKey.generate()
        let folderStore = FolderStore(userKey: folderUserKey, api: Self.makeApi())

        controller.lockTeardown(store: store, folderStore: folderStore)

        #expect(controller.selection == nil)
        #expect(controller.activeSheet == nil)
        #expect(!controller.revealState.isRevealed("secret"))
        #expect(!controller.isSearchPresented)
        #expect(controller.searchText.isEmpty)
        #expect(store.items.isEmpty)
        #expect(!store.isHydrated)
        #expect(weakKey == nil)
    }

    // MARK: - WR-04 (38-REVIEW.md): lockTeardown clears the pasteboard

    /// Same seam `ClipboardServiceTests.swift`'s own `FakePasteboard` uses
    /// (that type is `private` to that file, so a small local twin lives
    /// here rather than widening its access).
    private final class FakeLockTeardownPasteboard: PasteboardWriting {
        private(set) var changeCount = 0
        private(set) var clearCallCount = 0
        func setValue(_ value: String, expirationDate: Date, localOnly: Bool) { changeCount += 1 }
        func clear() { clearCallCount += 1; changeCount += 1 }

        /// Simulates a DIFFERENT app (or a later, unrelated copy in THIS
        /// app outside `ClipboardService`) touching the pasteboard --
        /// mirrors `ClipboardServiceTests.swift`'s own `FakePasteboard
        /// .simulateExternalWrite()`.
        func simulateExternalWrite() { changeCount += 1 }
    }

    /// A scheduler that never actually fires -- these tests exercise the
    /// EARLY, explicit `clearIfStillOurs()` path, not the timer.
    private final class NoOpClipboardScheduler: ClipboardScheduling {
        private final class NoOpToken: ClipboardClearToken { func invalidate() {} }
        func scheduleClear(after seconds: TimeInterval, fire: @escaping () -> Void) -> ClipboardClearToken {
            NoOpToken()
        }
    }

    /// RED-before-green target 5/5: comment out `clipboard
    /// .clearIfStillOurs()` in `VaultRootController.lockTeardown()` and
    /// this fails.
    @Test
    func lockTeardownClearsThePasteboardWhenItStillHoldsThisAppsLastCopy() throws {
        let pasteboard = FakeLockTeardownPasteboard()
        let clipboard = ClipboardService(pasteboard: pasteboard, scheduler: NoOpClipboardScheduler())
        clipboard.copy("hunter2", fieldLabel: "Password", seconds: 40)
        #expect(pasteboard.clearCallCount == 0, "must not clear before the lock")

        let controller = VaultRootController()
        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.makeApi())

        controller.lockTeardown(store: store, folderStore: nil, clipboard: clipboard)

        #expect(
            pasteboard.clearCallCount == 1,
            "a lock must clear the pasteboard if it still holds this app's own last copy"
        )
    }

    /// The change-counter guard's own falsifiability: a later, unrelated
    /// copy must survive a lock untouched -- same discipline as
    /// `ClipboardServiceTests.theGuardSkipsTheClearWhenSomethingElseCopiedSinceThisWrite`,
    /// exercised here through `lockTeardown` itself.
    @Test
    func lockTeardownDoesNotClearAPasteboardSomethingElseHasWrittenToSince() throws {
        let pasteboard = FakeLockTeardownPasteboard()
        let clipboard = ClipboardService(pasteboard: pasteboard, scheduler: NoOpClipboardScheduler())
        clipboard.copy("hunter2", fieldLabel: "Password", seconds: 40)
        pasteboard.simulateExternalWrite() // a later, unrelated copy (another app, or a different field)

        let controller = VaultRootController()
        let userKey = try FfiUserKey.generate()
        let store = VaultStore(userKey: userKey, api: Self.makeApi())

        controller.lockTeardown(store: store, folderStore: nil, clipboard: clipboard)

        #expect(
            pasteboard.clearCallCount == 0,
            "the change-counter guard must refuse to destroy a copy unrelated to the vault"
        )
    }

    // MARK: - AutoLockPolicy whitelist (T-38-11-02)

    private static func freshDefaults() -> UserDefaults {
        UserDefaults(suiteName: "lock-teardown-tests-\(UUID().uuidString)")!
    }

    @Test
    func autoLockPolicyDefaultsWhenNothingIsStored() {
        let defaults = Self.freshDefaults()
        #expect(AutoLockPolicy.read(defaults: defaults) == AutoLockPolicy.defaultMinutes)
    }

    /// The three malformed-input shapes `readAutolockMinutes()` (`web/src/
    /// lib/idle/autolock.ts`) is validated against, ported verbatim.
    @Test
    func autoLockPolicyDefaultsOnAnOutOfWhitelistValue() {
        let defaults = Self.freshDefaults()
        defaults.set(999, forKey: AutoLockPolicy.key)
        #expect(AutoLockPolicy.read(defaults: defaults) == AutoLockPolicy.defaultMinutes)
    }

    @Test
    func autoLockPolicyDefaultsOnANegativeValue() {
        let defaults = Self.freshDefaults()
        defaults.set(-5, forKey: AutoLockPolicy.key)
        #expect(AutoLockPolicy.read(defaults: defaults) == AutoLockPolicy.defaultMinutes)
    }

    @Test
    func autoLockPolicyDefaultsOnANonNumericValue() {
        let defaults = Self.freshDefaults()
        defaults.set("tampered", forKey: AutoLockPolicy.key)
        #expect(AutoLockPolicy.read(defaults: defaults) == AutoLockPolicy.defaultMinutes)
    }

    @Test
    func autoLockPolicyRoundTripsEveryWhitelistedOption() {
        let defaults = Self.freshDefaults()
        for option in AutoLockPolicy.options {
            AutoLockPolicy.write(option, defaults: defaults)
            #expect(AutoLockPolicy.read(defaults: defaults) == option)
        }
    }

    /// `write` itself refuses to persist an out-of-whitelist value, so a
    /// programmer error at a future call site cannot even get one stored in
    /// the first place (defense-in-depth alongside `read`'s own
    /// validation).
    @Test
    func autoLockPolicyWriteRefusesAnOutOfWhitelistValue() {
        let defaults = Self.freshDefaults()
        AutoLockPolicy.write(30, defaults: defaults)
        AutoLockPolicy.write(999, defaults: defaults)
        #expect(AutoLockPolicy.read(defaults: defaults) == 30, "a rejected write must not clobber the last valid stored value")
    }
}
