import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetSessionToken, mockGetSyncSnapshot, mockGetSharedRevisions } = vi.hoisted(() => ({
  mockGetSessionToken: vi.fn(),
  mockGetSyncSnapshot: vi.fn(),
  mockGetSharedRevisions: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionToken: mockGetSessionToken,
}));

vi.mock("./api", () => ({
  getSyncSnapshot: mockGetSyncSnapshot,
  getSharedRevisions: mockGetSharedRevisions,
}));

/** Minimal mock WebSocket — records every constructed instance so tests can
 * simulate onopen/onmessage/onclose events from the outside, mirroring the
 * shape sync.ts expects from the real browser WebSocket API. */
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
  vi.stubGlobal("WebSocket", MockWebSocket);
  mockGetSessionToken.mockReturnValue("session-token");
  mockGetSyncSnapshot.mockResolvedValue({ revision: 0 });
  mockGetSharedRevisions.mockResolvedValue({ collections: [], direct: { revision: 0 } });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("startSync — WS open triggers catch-up pull", () => {
  it("opening a connection calls getSyncSnapshot once on open", async () => {
    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 5, onSnapshot: vi.fn() });

    lastSocket().onopen?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetSyncSnapshot).toHaveBeenCalledTimes(1);
    expect(mockGetSyncSnapshot).toHaveBeenCalledWith(5);
  });

  it("any onmessage event triggers exactly one pullOnce without reading the message body", async () => {
    const onSnapshot = vi.fn();
    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot });

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

    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });

    // Drop three successive connections — each close schedules a reconnect
    // at the current (jittered) backoff, then doubles; advancing the fake
    // clock past each delay lets the reconnect create the next socket.
    lastSocket().close(); // schedules reconnect at 1000ms
    await vi.advanceTimersByTimeAsync(1000); // fires it → new socket
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
    const { startSync, stopSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });

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

describe("poll timer fallback", () => {
  it("the poll timer independently triggers a pull at the 30s mark even with no WS activity", async () => {
    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });

    // Never trigger onopen — only the poll timer should fire a pull.
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockGetSyncSnapshot).toHaveBeenCalledTimes(1);
  });
});

// Plan 23-05: pullOnce also calls the new GET /api/sync/shared
// revisions-map endpoint on every WS-triggered or poll-triggered pull —
// same try/catch-and-ignore-transient-failure shape as the existing
// personal pull, never a separate differently-shaped error path.
describe("shared-revisions pull (Plan 23-05)", () => {
  it("calls getSharedRevisions on every WS-open-triggered pull cycle", async () => {
    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });

    lastSocket().onopen?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetSharedRevisions).toHaveBeenCalledTimes(1);
  });

  it("calls getSharedRevisions on every onmessage-triggered pull cycle", async () => {
    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });

    const socket = lastSocket();
    socket.onopen?.();
    await vi.advanceTimersByTimeAsync(0);
    mockGetSharedRevisions.mockClear();

    socket.onmessage?.({ data: "some-opaque-frame-content" });
    await vi.advanceTimersByTimeAsync(0);

    expect(mockGetSharedRevisions).toHaveBeenCalledTimes(1);
  });

  it("calls getSharedRevisions on every poll-timer-triggered pull cycle", async () => {
    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() });

    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockGetSharedRevisions).toHaveBeenCalledTimes(1);
  });

  it("a rejected getSharedRevisions call is silently ignored, same as a rejected getSyncSnapshot call — never throws, never a separate error path", async () => {
    mockGetSharedRevisions.mockRejectedValue(new Error("transient network failure"));
    const onSnapshot = vi.fn();
    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot });

    lastSocket().onopen?.();
    await vi.advanceTimersByTimeAsync(0);

    // The personal snapshot callback still fires — a shared-revisions
    // failure never blocks or breaks the existing personal pull path.
    expect(onSnapshot).toHaveBeenCalled();
  });

  it("resolves getSharedRevisions and hands the value to the optional onSharedRevisions callback", async () => {
    const revisions = { collections: [{ id: "col-1", revision: 3 }], direct: { revision: 1 } };
    mockGetSharedRevisions.mockResolvedValue(revisions);
    const onSharedRevisions = vi.fn();
    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn(), onSharedRevisions });

    lastSocket().onopen?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(onSharedRevisions).toHaveBeenCalledWith(revisions);
  });

  it("never throws when onSharedRevisions is left unimplemented (optional callback)", async () => {
    const { startSync } = await import("./sync");
    startSync({ getSinceRevision: () => 0, onSnapshot: vi.fn() }); // no onSharedRevisions

    lastSocket().onopen?.();
    await expect(vi.advanceTimersByTimeAsync(0)).resolves.not.toThrow();
  });
});
