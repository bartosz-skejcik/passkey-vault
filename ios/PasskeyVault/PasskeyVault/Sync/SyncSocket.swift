//
//  SyncSocket.swift
//  PasskeyVault
//
//  Phase 39 (synchronizacja-i-cache-offline), plan 39-04. The WebSocket half
//  of the sync layer: one `URLSessionWebSocketTask`-backed transport, with
//  every guard `web/src/lib/vault/sync.ts` and
//  `extension/entrypoints/background/sync-client.ts` earned the hard way,
//  ported by name so a reader can map each one back to the TypeScript
//  original:
//
//    - handlers close over the LOCAL task, never a mutable shared reference,
//      so a superseded connection's late close can never clobber a newer
//      one (`handleClose`'s `currentTask === task` guard).
//    - the intentional-stop latch is set BEFORE the close call, not after
//      (`stop()`) -- a close that fires while `intentionalStop` is still
//      false would otherwise re-arm a reconnect after a deliberate stop.
//    - `start()` calls `stop()` first, so re-entry is idempotent: never two
//      live transports at once.
//    - a catch-up pull fires on open, because the socket is
//      notification-only and the pull is the only source of truth.
//    - jitter (+-25%) is applied to the SCHEDULED delay only, never to the
//      underlying doubling sequence itself.
//    - the error branch funnels into the SAME reconnect path as the close
//      branch (one backoff policy, not two).
//
//  One hazard is new to this platform, unique to
//  `receiveMessageWithCompletionHandler:` (`NSURLSession.h:658`): the call
//  delivers exactly ONE message, so a missing re-arm inside its own success
//  branch yields precisely one push per connection and then looks correct
//  forever -- and a working poll fallback hides it completely (Pitfall 5,
//  `39-RESEARCH.md`). `receiveLoop(task:)` below re-arms itself in its own
//  success branch for exactly this reason.
//
//  T-39-15/D-14: the receive completion's success branch is the NO-BINDING
//  form (`case .success:`) -- no local variable ever holds the frame's
//  payload, so there is no value a later edit could start reading. The
//  server's own module documentation (`sync.rs:506-518`) forbids the event
//  schema from ever carrying ciphertext, and both existing clients
//  deliberately never read `.data` either -- a stronger boundary than
//  schema hygiene. `self.pull()` below takes no argument derived from the
//  frame.
//
//  `shouldUseExtendedBackgroundIdleMode` (`NSURLSession.h:841`) is
//  `API_DEPRECATED("Not supported", ..., ios(9.0,18.4), ...)` -- unsupported
//  through iOS 18.4, a version above this project's floor
//  (`IPHONEOS_DEPLOYMENT_TARGET = 18.0`). It is never used here, and never
//  should be reached for later: keeping a WS socket alive in the background
//  is not a lever this SDK offers on this deployment floor.
//

import Foundation
import os

// MARK: - Task abstraction (the one-shot receive surface, testable)

/// Abstraction over `URLSessionWebSocketTask`'s minimal surface --
/// `SyncSocketTests` exercises the re-arm guard (Pitfall 5) against a fake,
/// deterministic task rather than a real network connection. D-09: a green
/// run of those tests is explicitly NOT evidence for SYNC-01, which is a
/// live claim (see `SyncSocketTests.swift`'s own header).
protocol SyncSocketTask: AnyObject {
    func resume()
    func cancel(with closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?)
    func receive(completionHandler: @escaping (Result<URLSessionWebSocketTask.Message, Error>) -> Void)
}

extension URLSessionWebSocketTask: SyncSocketTask {}

/// Constructs a `SyncSocketTask` for a URL and reports the delegate-level
/// open/close events that, for a real `URLSessionWebSocketTask`, only ever
/// arrive via `URLSessionWebSocketDelegate` -- never via the task itself.
/// `SyncSocketTests` supplies a fake conforming type that invokes these
/// closures directly and deterministically, with no real networking.
protocol SyncSocketTransport: AnyObject {
    func makeTask(
        url: URL,
        onOpen: @escaping () -> Void,
        onClose: @escaping (URLSessionWebSocketTask.CloseCode, Data?) -> Void
    ) -> SyncSocketTask
}

/// Real transport: one `URLSession` configured with itself as the
/// `URLSessionWebSocketDelegate`, so `didOpenWithProtocol`/`didCloseWith`
/// fire for the exact task this transport handed out. Session is
/// long-lived across reconnects (mirrors real-world practice); handlers are
/// keyed per-task and removed once that task's close fires, so a
/// superseded task's late delegate callback still resolves to the SAME
/// closures it was handed at creation -- never a second, mutable lookup
/// that could point somewhere else by the time it fires.
final class URLSessionSyncSocketTransport: NSObject, SyncSocketTransport, URLSessionWebSocketDelegate, @unchecked Sendable {
    private var session: URLSession!
    private let lock = NSLock()
    private var handlers: [ObjectIdentifier: (open: () -> Void, close: (URLSessionWebSocketTask.CloseCode, Data?) -> Void)] = [:]

    override init() {
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    func makeTask(
        url: URL,
        onOpen: @escaping () -> Void,
        onClose: @escaping (URLSessionWebSocketTask.CloseCode, Data?) -> Void
    ) -> SyncSocketTask {
        let task = session.webSocketTask(with: url)
        lock.lock()
        handlers[ObjectIdentifier(task)] = (onOpen, onClose)
        lock.unlock()
        return task
    }

    func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?
    ) {
        lock.lock()
        let entry = handlers[ObjectIdentifier(webSocketTask)]
        lock.unlock()
        entry?.open()
    }

    func urlSession(
        _ session: URLSession, webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?
    ) {
        lock.lock()
        let entry = handlers[ObjectIdentifier(webSocketTask)]
        handlers[ObjectIdentifier(webSocketTask)] = nil
        lock.unlock()
        entry?.close(closeCode, reason)
    }
}

// MARK: - Scheduler abstraction (backoff timing, testable without real waits)

protocol SyncSocketCancellable {
    func cancel()
}

protocol SyncSocketScheduler {
    func schedule(afterMs delayMs: Double, _ work: @escaping () -> Void) -> SyncSocketCancellable
}

private struct DispatchWorkItemCancellable: SyncSocketCancellable {
    let item: DispatchWorkItem
    func cancel() { item.cancel() }
}

final class RealSyncSocketScheduler: SyncSocketScheduler {
    func schedule(afterMs delayMs: Double, _ work: @escaping () -> Void) -> SyncSocketCancellable {
        let item = DispatchWorkItem(block: work)
        DispatchQueue.main.asyncAfter(deadline: .now() + delayMs / 1000, execute: item)
        return DispatchWorkItemCancellable(item: item)
    }
}

// MARK: - SyncSocket

/// The transport's lifecycle: connect, re-armed receive, doubling+jittered
/// backoff, idempotent start/stop. Carries NO knowledge of what a "pull" is
/// -- `pull` is an injected closure, exactly like `SyncClient`'s own
/// dependency-injection shape (this plan does not invent a second pattern).
@MainActor
final class SyncSocket {
    static let backoffStartMs: Double = 1_000
    static let backoffMaxMs: Double = 30_000

    /// `PVSYNC|` marker lines, matching this repo's established
    /// `PVPROBE|` convention (`ProbeSeeder.swift`) -- read live via
    /// `xcrun simctl spawn <udid> log stream --predicate 'subsystem ==
    /// "cloud.blonie.PasskeyVault" and category == "sync"'`. This is the
    /// device-log observation Task 2's `open`/`frame` assertions and Task
    /// 3's `didCloseWithCode:`/reason assertion (E-S4) both read from --
    /// never inferred from a successful pull.
    private static let logger = Logger(subsystem: "cloud.blonie.PasskeyVault", category: "sync")

    private let urlProvider: () -> URL?
    private let transport: SyncSocketTransport
    private let scheduler: SyncSocketScheduler
    private let pull: () -> Void

    private var currentTask: SyncSocketTask?
    private var backoffMs: Double = SyncSocket.backoffStartMs
    private var reconnectHandle: SyncSocketCancellable?
    /// Guards against the CURRENTLY-CLOSING task's own trailing close event
    /// (which may fire asynchronously, after stop() already ran) re-arming
    /// a reconnect timer. `stop()` sets this true BEFORE the cancel call.
    private var intentionalStop = true

    init(
        urlProvider: @escaping () -> URL?,
        transport: SyncSocketTransport = URLSessionSyncSocketTransport(),
        scheduler: SyncSocketScheduler = RealSyncSocketScheduler(),
        pull: @escaping () -> Void
    ) {
        self.urlProvider = urlProvider
        self.transport = transport
        self.scheduler = scheduler
        self.pull = pull
    }

    /// Idempotent re-entry: calls `stop()` first, so starting an
    /// already-started socket never leaves two live transports.
    func start() {
        stop()
        intentionalStop = false
        backoffMs = Self.backoffStartMs
        connect()
    }

    func stop() {
        intentionalStop = true // set BEFORE the cancel call below -- see this type's header
        reconnectHandle?.cancel()
        reconnectHandle = nil
        guard let task = currentTask else { return }
        task.cancel(with: .goingAway, reason: nil)
        // `handleClose(task:)` (fired by the transport's close callback --
        // synchronously for a fake in tests, asynchronously for a real
        // URLSessionWebSocketTask) is the ONLY place `currentTask` is ever
        // nilled -- not this function -- so a superseded task's own close
        // path stays the single owner of that transition.
    }

    private func connect() {
        guard let url = urlProvider() else { return }
        var task: SyncSocketTask!
        task = transport.makeTask(
            url: url,
            onOpen: { [weak self] in
                guard let self, self.currentTask === task else { return }
                Self.logger.log("PVSYNC|event=open") // Task 2/3's device-log signal -- see this type's header
                self.backoffMs = Self.backoffStartMs // reset on success
                self.pull() // catch-up pull -- WS is notification-only, pull is truth
            },
            onClose: { [weak self] code, _ in
                self?.handleClose(task: task, code: code)
            }
        )
        currentTask = task
        task.resume()
        receiveLoop(task: task)
    }

    private func receiveLoop(task: SyncSocketTask) {
        task.receive { [weak self] result in
            guard let self, self.currentTask === task else { return }
            switch result {
            case .success:
                // DELIBERATELY UNPARSED (D-14/T-39-15): any frame means "go
                // pull" and nothing more -- see this file's header.
                Self.logger.log("PVSYNC|event=frame")
                self.pull()
                self.receiveLoop(task: task) // re-arm: receive() delivers ONE message (Pitfall 5)
            case .failure:
                // Funnel into the SAME reconnect path the close callback
                // uses -- one backoff policy, not two.
                task.cancel(with: .abnormalClosure, reason: nil)
                self.handleClose(task: task, code: .abnormalClosure) // idempotent if cancel() above already triggered it
            }
        }
    }

    private func handleClose(task: SyncSocketTask, code: URLSessionWebSocketTask.CloseCode) {
        guard currentTask === task else { return } // stale close -- a newer connection already owns state
        currentTask = nil
        Self.logger.log("PVSYNC|event=close code=\(code.rawValue, privacy: .public)")
        if intentionalStop { return } // stop() already ran
        scheduleReconnect()
    }

    private func scheduleReconnect() {
        // +-25% jitter on the ACTUAL scheduled delay, without perturbing the
        // underlying doubling sequence (05-RESEARCH.md Pitfall 4, ported).
        let jittered = backoffMs * (0.75 + Double.random(in: 0...0.5))
        reconnectHandle = scheduler.schedule(afterMs: jittered) { [weak self] in
            self?.reconnectHandle = nil
            self?.connect()
        }
        backoffMs = min(backoffMs * 2, Self.backoffMaxMs)
    }
}

// MARK: - WS URL construction (token in the query, percent-encoded via URLComponents)

extension SyncSocket {
    /// `pv-server` does not read headers for this endpoint even though
    /// `URLSessionWebSocketTask` CAN set them (`sync.rs:587-604` reads
    /// `?token=`) -- the query is not a choice. Session tokens are
    /// standard-alphabet encoded; a raw `+` in a query string decodes as a
    /// space and yields a spurious 401 (05-02's own deviation flag, carried
    /// over unchanged) -- `URLComponents`' query-item machinery does the
    /// percent-encoding, never string concatenation.
    static func wsURL(base: URL, token: String?) -> URL? {
        guard let token, !token.isEmpty else { return nil }
        guard
            var components = URLComponents(
                url: base.appendingPathComponent("api/sync/ws"), resolvingAgainstBaseURL: false
            )
        else {
            return nil
        }
        // http(s) -> ws(s), mirroring both existing clients' own replace
        // (web `sync.ts:208-209`, extension `sync-client.ts`'s `wsUrlFromBase`).
        switch components.scheme {
        case "https": components.scheme = "wss"
        case "http": components.scheme = "ws"
        default: break
        }
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        return components.url
    }
}
