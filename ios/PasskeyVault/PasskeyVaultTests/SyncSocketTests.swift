//
//  SyncSocketTests.swift
//  PasskeyVaultTests
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-04, Task 1.
//
//  IMPORTANT: a green run of THIS FILE is NOT evidence for SYNC-01. SYNC-01
//  is a LIVE claim -- a real push, from a real second client, over a real
//  socket, against a real `pv-server` -- and that proof belongs to
//  `scripts/ios-ws-push-proof.sh` / `ios/evidence/39/04-ws.md` (Task 2,
//  D-09). Everything below runs against `FakeSyncSocketTransport` and
//  `FakeSyncSocketScheduler` -- no networking, no simulator, no server.
//  These tests cover `SyncSocket`'s lifecycle and backoff ARITHMETIC only:
//  the re-arm guard, the intentional-stop latch, stale-close isolation, and
//  the doubling+jitter sequence. Nobody should cite a pass here as proof
//  the socket works end to end.
//
//  `FakeSyncSocketTask.cancel(with:reason:)` fires its stored `onClose`
//  closure SYNCHRONOUSLY -- deliberately, unlike a real
//  `URLSessionWebSocketTask` (which closes asynchronously). The property
//  under test in "stop() prevents reconnect" is the STATEMENT ORDER inside
//  `SyncSocket.stop()` (the intentional-stop latch set before the cancel
//  call, not after) -- not the real-world timing -- and a synchronous fake
//  is what makes that order observable and deterministic at all.
//

import Foundation
import Testing
@testable import PasskeyVault

// MARK: - Fakes

final class FakeSyncSocketTask: SyncSocketTask {
    let onOpen: () -> Void
    let onClose: (URLSessionWebSocketTask.CloseCode, Data?) -> Void
    private(set) var resumeCallCount = 0
    private(set) var receiveCallCount = 0
    private(set) var isCancelled = false
    private var pendingReceive: ((Result<URLSessionWebSocketTask.Message, Error>) -> Void)?

    init(onOpen: @escaping () -> Void, onClose: @escaping (URLSessionWebSocketTask.CloseCode, Data?) -> Void) {
        self.onOpen = onOpen
        self.onClose = onClose
    }

    func resume() {
        resumeCallCount += 1
    }

    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        isCancelled = true
        onClose(closeCode, reason) // synchronous by design -- see this file's header
    }

    func receive(completionHandler: @escaping (Result<URLSessionWebSocketTask.Message, Error>) -> Void) {
        receiveCallCount += 1
        pendingReceive = completionHandler
    }

    /// Simulates the delegate's open callback firing for this task.
    func simulateOpen() {
        onOpen()
    }

    /// Simulates one frame arriving. A no-op if nothing is currently
    /// waiting on `receive()` -- exactly the state a MISSING re-arm leaves
    /// this fake in, which is what makes the re-arm guard's RED
    /// demonstration possible.
    @discardableResult
    func simulateMessage() -> Bool {
        guard let handler = pendingReceive else { return false }
        pendingReceive = nil
        handler(.success(.string("")))
        return true
    }

    /// Simulates a network-triggered close (not initiated by `stop()`).
    func simulateNetworkClose(code: URLSessionWebSocketTask.CloseCode = .abnormalClosure) {
        onClose(code, nil)
    }
}

final class FakeSyncSocketTransport: SyncSocketTransport {
    private(set) var madeTasks: [FakeSyncSocketTask] = []

    func makeTask(
        url: URL,
        onOpen: @escaping () -> Void,
        onClose: @escaping (URLSessionWebSocketTask.CloseCode, Data?) -> Void
    ) -> SyncSocketTask {
        let task = FakeSyncSocketTask(onOpen: onOpen, onClose: onClose)
        madeTasks.append(task)
        return task
    }
}

private struct FakeCancellable: SyncSocketCancellable {
    let onCancel: () -> Void
    func cancel() { onCancel() }
}

final class FakeSyncSocketScheduler: SyncSocketScheduler {
    struct Scheduled {
        let delayMs: Double
        let work: () -> Void
        var cancelled = false
    }
    private(set) var scheduled: [Scheduled] = []

    func schedule(afterMs delayMs: Double, _ work: @escaping () -> Void) -> SyncSocketCancellable {
        let index = scheduled.count
        scheduled.append(Scheduled(delayMs: delayMs, work: work))
        return FakeCancellable { [weak self] in
            self?.scheduled[index].cancelled = true
        }
    }

    /// Fires the LAST non-cancelled scheduled work item, mirroring "the
    /// most recently scheduled reconnect actually fires."
    func fireLast() {
        guard let last = scheduled.last, !last.cancelled else { return }
        last.work()
    }
}

// MARK: - Tests

@Suite("SyncSocket lifecycle and backoff (fake transport -- NOT SYNC-01 evidence, see header)")
struct SyncSocketTests {

    @MainActor
    private func makeSocket(
        transport: FakeSyncSocketTransport = FakeSyncSocketTransport(),
        scheduler: FakeSyncSocketScheduler = FakeSyncSocketScheduler(),
        url: URL = URL(string: "wss://example.invalid/api/sync/ws?token=t")!
    ) -> (socket: SyncSocket, transport: FakeSyncSocketTransport, scheduler: FakeSyncSocketScheduler, pullCount: () -> Int) {
        var pullCount = 0
        let socket = SyncSocket(
            urlProvider: { url },
            transport: transport,
            scheduler: scheduler,
            pull: { pullCount += 1 }
        )
        return (socket, transport, scheduler, { pullCount })
    }

    // Behaviour 3: opening triggers a catch-up pull before any frame arrives.
    @MainActor
    @Test func openingTheSocketTriggersACatchUpPullBeforeAnyFrameArrives() {
        let (socket, transport, _, pullCount) = makeSocket()
        socket.start()
        #expect(transport.madeTasks.count == 1)
        #expect(pullCount() == 0, "no pull before open fires")
        transport.madeTasks[0].simulateOpen()
        #expect(pullCount() == 1, "open must trigger exactly one catch-up pull")
    }

    // Behaviour 1: receiving a frame triggers exactly one pull and passes no
    // part of the frame onward (the fake's `.success(.string(""))` payload
    // is never read by SyncSocket at all -- enforced by source inspection in
    // this plan's acceptance criteria, not by this test, which can only
    // observe the pull COUNT).
    @MainActor
    @Test func receivingAFrameTriggersExactlyOnePull() {
        let (socket, transport, _, pullCount) = makeSocket()
        socket.start()
        let task = transport.madeTasks[0]
        task.simulateOpen()
        #expect(pullCount() == 1)
        task.simulateMessage()
        #expect(pullCount() == 2, "one frame must trigger exactly one additional pull")
    }

    // Behaviour 2: a second frame on the SAME connection triggers a second
    // pull -- the receive loop is re-armed. This is the load-bearing test
    // for Pitfall 5 (a missing re-arm yields one push per connection and
    // then looks correct forever) -- see this plan's SUMMARY for the
    // RED-before-green transcript with the re-arm line removed.
    @MainActor
    @Test func receivingASecondFrameOnTheSameConnectionTriggersASecondPull() {
        let (socket, transport, _, pullCount) = makeSocket()
        socket.start()
        let task = transport.madeTasks[0]
        task.simulateOpen()
        let firstDelivered = task.simulateMessage()
        #expect(firstDelivered, "the fake must have a pending receive after connect")
        let countAfterFirst = pullCount()
        let secondDelivered = task.simulateMessage()
        #expect(secondDelivered, "receive() must have been re-armed inside its own completion")
        #expect(pullCount() == countAfterFirst + 1, "a second frame must trigger a second pull")
    }

    // Behaviour 4: stopping the transport prevents the resulting close event
    // from scheduling a reconnect. See this file's header for why the fake
    // closes synchronously -- this is what makes the intentional-stop
    // latch's statement ORDER observable at all.
    @MainActor
    @Test func stoppingPreventsTheResultingCloseFromSchedulingAReconnect() {
        let (socket, transport, scheduler, _) = makeSocket()
        socket.start()
        let task = transport.madeTasks[0]
        task.simulateOpen()
        socket.stop() // synchronously triggers task.onClose via the fake's cancel()
        #expect(task.isCancelled)
        #expect(scheduler.scheduled.isEmpty, "an intentional stop must never schedule a reconnect")
        #expect(transport.madeTasks.count == 1, "no reconnect means no second task was ever created")
    }

    // Behaviour 5: a close on a superseded connection does not alter the
    // state of a newer connection.
    @MainActor
    @Test func aCloseOnASupersededConnectionDoesNotAlterANewerConnection() {
        let (socket, transport, scheduler, pullCount) = makeSocket()
        socket.start()
        let task1 = transport.madeTasks[0]
        task1.simulateOpen()
        socket.stop()
        socket.start() // fresh connection while task1's close event is, hypothetically, still in flight
        #expect(transport.madeTasks.count == 2)
        let task2 = transport.madeTasks[1]
        task2.simulateOpen()
        let pullsBeforeStaleClose = pullCount()
        // task1's own trailing close fires AFTER the newer connection is
        // already live -- must not schedule a reconnect or touch task2.
        task1.simulateNetworkClose()
        #expect(scheduler.scheduled.isEmpty, "a stale task's close must never schedule a reconnect for a newer connection")
        #expect(pullCount() == pullsBeforeStaleClose, "a stale close must trigger no pull")
        task2.simulateMessage()
        #expect(pullCount() == pullsBeforeStaleClose + 1, "the NEWER connection's frame must still work")
    }

    // Behaviour 7: starting while already started leaves exactly one live
    // transport -- the OLD task stops mattering (its frames no longer
    // trigger a pull) while the NEW task's frames do.
    @MainActor
    @Test func startingWhileAlreadyStartedLeavesExactlyOneLiveTransport() {
        let (socket, transport, _, pullCount) = makeSocket()
        socket.start()
        let task1 = transport.madeTasks[0]
        task1.simulateOpen()
        socket.start() // re-entry while already started
        #expect(transport.madeTasks.count == 2)
        #expect(task1.isCancelled, "the previous task must have been stopped")
        let task2 = transport.madeTasks[1]
        task2.simulateOpen()
        let pullsAfterBothOpen = pullCount()
        task1.simulateMessage() // stale -- must have no effect
        #expect(pullCount() == pullsAfterBothOpen, "a stale task's frame must never trigger a pull")
        task2.simulateMessage()
        #expect(pullCount() == pullsAfterBothOpen + 1, "the live task's frame must trigger a pull")
    }

    // Behaviour 6: successive reconnect delays double up to a ceiling, and
    // each SCHEDULED delay is perturbed within a bounded fraction of itself
    // while the underlying sequence keeps doubling cleanly. Expected bases
    // mirror BACKOFF_START_MS=1000 / BACKOFF_MAX_MS=30000 (SyncSocket's own
    // constants, ported from sync.ts/sync-client.ts unchanged).
    @MainActor
    @Test func successiveReconnectDelaysDoubleUpToACeilingWithBoundedJitter() {
        let (socket, transport, scheduler, _) = makeSocket()
        socket.start()

        // Deliberately never opens: `SyncSocket` resets `backoffMs` to the
        // start value on a successful open (correctly -- ported from
        // sync.ts's own `onopen` handler), so a doubling backoff is only
        // observable across a run of REPEATED CONNECTION FAILURES, exactly
        // the scenario this arithmetic exists for (a server that stays
        // down). Opening between failures would defeat this test, not
        // exercise it.
        let expectedBases: [Double] = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]
        for (index, base) in expectedBases.enumerated() {
            let task = transport.madeTasks[index]
            task.simulateNetworkClose() // schedules the next reconnect, without ever opening
            #expect(scheduler.scheduled.count == index + 1)
            let jittered = scheduler.scheduled[index].delayMs
            #expect(jittered >= base * 0.75 && jittered <= base * 1.25,
                    "delay \(jittered) must be within +-25% of the expected doubling-sequence base \(base)")
            scheduler.fireLast() // fires the reconnect -> creates the next task
        }
        #expect(transport.madeTasks.count == expectedBases.count + 1)
    }
}
