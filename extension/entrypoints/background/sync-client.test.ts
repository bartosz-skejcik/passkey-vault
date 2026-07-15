import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock functions must be created via vi.hoisted() so they exist before the
// hoisted vi.mock() factories below run -- same pattern as
// ./unlock.test.ts/./vault-session.test.ts. sync-client.ts's two required
// changes from web/src/lib/vault/sync.ts (async token source, Plan
// 09-03's server-config.ts instead of a compiled-in env var) are why
// getSessionToken/readServerConfig are mocked as Promise-resolving
// (mockResolvedValue), unlike v0.1's synchronous localStorage read.
const {
  mockGetSessionToken,
  mockReadServerConfig,
  mockGetSyncSnapshot,
  mockAlarmsCreate,
  mockAlarmsClear,
  alarmListeners,
} = vi.hoisted(() => ({
  mockGetSessionToken: vi.fn(),
  mockReadServerConfig: vi.fn(),
  mockGetSyncSnapshot: vi.fn(),
  // WR-06: the poll fallback is chrome.alarms-backed, so the alarm surface
  // is mocked with a recorded listener array (a test can fire it directly,
  // simulating a real browser.alarms.onAlarm dispatch on a fresh SW wake)
  // -- same shape as vault-session.test.ts's own alarm fake.
  mockAlarmsCreate: vi.fn(),
  mockAlarmsClear: vi.fn(),
  alarmListeners: [] as Array<(alarm: { name: string }) => void>,
}));

vi.mock("wxt/browser", () => ({
  browser: {
    alarms: {
      create: mockAlarmsCreate,
      clear: mockAlarmsClear,
      onAlarm: {
        addListener(fn: (alarm: { name: string }) => void) {
          alarmListeners.push(fn);
        },
      },
    },
  },
}));

vi.mock("./session-storage", () => ({
  getSessionToken: mockGetSessionToken,
}));

// wsUrlFromBase is a pure, real (not mocked) function -- it has no I/O and
// matches server-config.ts's actual implementation exactly, so mocking it
// would only duplicate the real logic without adding test value.
vi.mock("./server-config", () => ({
  readServerConfig: mockReadServerConfig,
  wsUrlFromBase: (baseUrl: string) => baseUrl.replace(/^http/, "ws"),
}));

vi.mock("./vault-api", () => ({
  getSyncSnapshot: mockGetSyncSnapshot,
}));

/** Minimal mock WebSocket -- records every constructed instance so tests can
 * simulate onopen/onmessage/onclose events from the outside, mirroring the
 * shape sync-client.ts expects from the real browser WebSocket API.
 * Identical to web/src/lib/vault/sync.test.ts's own MockWebSocket. */
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.onclose?.();
  }
}

function lastSocket(): MockWebSocket {
  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  if (!socket) {
    throw new Error("no MockWebSocket instance was constructed");
  }
  return socket;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.clearAllMocks();
  MockWebSocket.instances = [];
  alarmListeners.length = 0;
  vi.stubGlobal("WebSocket", MockWebSocket);
  mockGetSessionToken.mockResolvedValue("session-token");
  mockReadServerConfig.mockResolvedValue({ baseUrl: "http://localhost:8620" });
  mockGetSyncSnapshot.mockResolvedValue({ revision: 0 });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startSync — WS open triggers catch-up pull", () => {
  it("opening a connection calls getSyncSnapshot once on open", async () => {
    const { startSync } = await import("./sync-client");
    startSync({ getSinceRevision: () => 5, onSnapshot: vi.fn() });
    // connectWs() is now async (awaits getSessionToken()/readServerConfig())
    // -- flush its microtask chain before the socket exists.
    await vi.advanceTimersByTimeAsync(0);

    lastSocket().onopen?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetSyncSnapshot).toHaveBeenCalledTimes(1);
    expect(mockGetSyncSnapshot).toHaveBeenCalledWith(5);
  });

  it("any onmessage event triggers exactly one pullOnce without reading the message body", async () => {
    const onSnapshot = vi.fn();
    const { startSync } = await import("./sync-client");
    startSync({ getSinceRevision: () => 0, onSnapshot });
    await vi.advanceTimersByTimeAsync(0);

    const socket = lastSocket();
    socket.onopen?.();
    await vi.advanceTimersByTimeAsync(0);
    mockGetSyncSnapshot.mockClear();

    socket.onmessage?.({ data: "some-opaque-frame-content" });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetSyncSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe("reconnect backoff", () => {
  it("schedules a reconnect after WS close with a strictly increasing, capped delay", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5); // neutralizes jitter: 0.75 + 0.5*0.5 = 1.0
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { startSync } = await import("./sync-client");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);

    // Drop three successive connections -- each close schedules a reconnect
    // at the current (jittered) backoff, then doubles; advancing the fake
    // clock past each delay lets the reconnect create the next socket.
    lastSocket().close(); // schedules reconnect at 1000ms
    await vi.advanceTimersByTimeAsync(1000); // fires it -> new socket
    lastSocket().close(); // schedules reconnect at 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    lastSocket().close(); // schedules reconnect at 4000ms
    await vi.advanceTimersByTimeAsync(4000);

    const reconnectDelays = setTimeoutSpy.mock.calls
      .map((call) => call[1])
      .filter((delay): delay is number => typeof delay === "number" && delay >= 1000);

    expect(reconnectDelays.length).toBeGreaterThanOrEqual(3);
    expect(reconnectDelays[0]).toBe(1000);
    expect(reconnectDelays[1]).toBe(2000);
    expect(reconnectDelays[2]).toBe(4000);
    // Delay is capped at 30000ms regardless of how many drops occur.
    for (const delay of reconnectDelays) {
      expect(delay).toBeLessThanOrEqual(30000);
    }
  });

  it("stopSync() called immediately after startSync() results in NO reconnect attempt", async () => {
    const { startSync, stopSync } = await import("./sync-client");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);

    const socket = lastSocket();
    stopSync();
    // Simulate the currently-closing socket's own trailing close event,
    // which fires asynchronously AFTER stopSync() already ran.
    socket.onclose?.();

    mockGetSyncSnapshot.mockClear();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mockGetSyncSnapshot).not.toHaveBeenCalled();
  });
});

describe("WR-06: poll fallback is chrome.alarms-backed, not setInterval", () => {
  it("startSync creates the poll alarm under its own DISTINCT name -- never colliding with autolock's pv-auto-lock", async () => {
    const { startSync } = await import("./sync-client");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockAlarmsCreate).toHaveBeenCalledWith("pv-sync-poll", { periodInMinutes: 1 });
    // A name collision would silently replace the auto-lock alarm and
    // disable EXT-03 -- assert the two namespaces stay separate.
    expect(mockAlarmsCreate).not.toHaveBeenCalledWith("pv-auto-lock", expect.anything());
  });

  it("the registered alarm handler triggers a pull with no WS activity -- the fallback survives an idle-kill", async () => {
    const { startSync, registerSyncPollAlarmListener } = await import("./sync-client");
    registerSyncPollAlarmListener();
    startSync({ getSinceRevision: () => 7, onSnapshot: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    mockGetSyncSnapshot.mockClear();

    // Never trigger onopen -- this is the WS-stripped-proxy scenario the
    // fallback exists for. A setInterval would simply be gone by now.
    expect(alarmListeners).toHaveLength(1);
    alarmListeners[0]?.({ name: "pv-sync-poll" });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetSyncSnapshot).toHaveBeenCalledTimes(1);
    expect(mockGetSyncSnapshot).toHaveBeenCalledWith(7);
  });

  it("an unrelated alarm (pv-auto-lock) never triggers a sync pull", async () => {
    const { startSync, registerSyncPollAlarmListener } = await import("./sync-client");
    registerSyncPollAlarmListener();
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);
    mockGetSyncSnapshot.mockClear();

    alarmListeners[0]?.({ name: "pv-auto-lock" });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetSyncSnapshot).not.toHaveBeenCalled();
  });

  it("stopSync clears the poll alarm, and a late alarm firing after it never pulls (locked vault stays empty)", async () => {
    const { startSync, stopSync, registerSyncPollAlarmListener } = await import("./sync-client");
    registerSyncPollAlarmListener();
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });
    await vi.advanceTimersByTimeAsync(0);

    stopSync();
    expect(mockAlarmsClear).toHaveBeenCalledWith("pv-sync-poll");

    // Belt-and-braces: even if a late alarm fires anyway (a real race on a
    // fresh wake), pullOnce is a no-op with activeCallbacks null -- so a
    // locked vault can never be repopulated through this path (T-09-18/19).
    mockGetSyncSnapshot.mockClear();
    alarmListeners[0]?.({ name: "pv-sync-poll" });
    await vi.advanceTimersByTimeAsync(0);
    expect(mockGetSyncSnapshot).not.toHaveBeenCalled();
  });
});

describe("no server configured yet (NEW behavior beyond the ported set)", () => {
  it("connectWs() resolves with readServerConfig() returning null -- no throw, no socket constructed", async () => {
    mockReadServerConfig.mockResolvedValue(null);
    const { startSync } = await import("./sync-client");

    expect(() =>
      startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() }),
    ).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);

    expect(MockWebSocket.instances.length).toBe(0);
  });
});
