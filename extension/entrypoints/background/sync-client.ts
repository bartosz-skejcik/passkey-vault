// entrypoints/background/sync-client.ts — WS+poll sync transport, ported
// from web/src/lib/vault/sync.ts: one WebSocket connection to
// GET /api/sync/ws for push notifications, plus a fixed 30s poll timer as
// the belt-and-suspenders fallback (05-CONTEXT.md's locked v0.1 decision,
// carried over unchanged -- sync must not go silently dead behind a
// reverse proxy that drops Upgrade headers). Both paths funnel into the
// same internal pullOnce(), which fetches GET /api/sync?since=N (via
// vault-api.ts's getSyncSnapshot) and hands the snapshot to the caller.
//
// D-07/SYNC-02 (carried over unchanged from v0.1): WS frames are
// notification-only and are NEVER parsed -- socket.onmessage never reads
// `.data`, ANY frame regardless of content only triggers pullOnce()'s
// authenticated REST fetch. There is deliberately no code path where WS
// payload bytes can influence client state.
//
// Two required changes from the web version (the transport's structure --
// constants, local-socket-binding discipline, jitter/backoff, the
// intentionalStop stale-close guard, idempotent startSync/stopSync
// re-entry -- is otherwise byte-identical):
//   1. wsUrl() is async, reading readServerConfig()/wsUrlFromBase() (Plan
//      09-03) instead of a compiled-in NEXT_PUBLIC_API_BASE_URL env var --
//      connectWs() returns early (no socket, no throw) when no server is
//      configured yet, since sync must never crash the background before
//      first-run setup completes.
//   2. getSessionToken() (Plan 09-02's session-storage.ts) is Promise-
//      based, not a synchronous localStorage read -- connectWs() is
//      therefore async as a consequence (09-RESEARCH.md Code Example 5).
//      A stopSync() that races connectWs()'s in-flight awaits is guarded
//      by re-checking `intentionalStop` once those awaits settle, before
//      ever constructing a socket -- v0.1's synchronous connectWs() had no
//      equivalent race window.
import { readServerConfig, wsUrlFromBase } from "./server-config";
import { getSessionToken } from "./session-storage";
import { getSyncSnapshot, type SyncSnapshot } from "./vault-api";

const POLL_INTERVAL_MS = 30_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export interface SyncCallbacks {
  getSinceRevision: () => number;
  onSnapshot: (snapshot: SyncSnapshot) => void;
}

let ws: WebSocket | null = null;
let backoffMs = BACKOFF_START_MS;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let activeCallbacks: SyncCallbacks | null = null;
// Guards against the CURRENTLY-CLOSING socket's own trailing onclose event
// (which fires asynchronously, after stopSync already ran) re-arming a
// reconnect timer. stopSync sets this true BEFORE closing the socket.
let intentionalStop = true;

async function pullOnce(): Promise<void> {
  const callbacks = activeCallbacks;
  if (callbacks === null) {
    return;
  }
  try {
    const snapshot = await getSyncSnapshot(callbacks.getSinceRevision());
    // Re-check: stopSync may have run while the fetch was in flight -- a
    // snapshot must never be applied to a stopped (locked) session.
    if (activeCallbacks === callbacks) {
      callbacks.onSnapshot(snapshot);
    }
  } catch {
    // Transient network failure -- the poll timer / next WS event retries;
    // sync is self-healing because the pull is the source of truth.
  }
}

/** Derives the WS URL from Plan 09-03's server-config.ts -- no second
 * config surface. Resolves `null` when no server has been configured yet,
 * so connectWs() can no-op instead of constructing a URL against
 * `undefined`. */
async function wsUrl(token: string): Promise<string | null> {
  const config = await readServerConfig();
  if (config === null) {
    return null;
  }
  // Session tokens are standard base64 -- a raw `+` in a query string
  // decodes as a space and yields a spurious 401 (05-02's deviation flag,
  // carried over), so the token MUST be percent-encoded.
  const query = `?token=${encodeURIComponent(token)}`;
  return `${wsUrlFromBase(config.baseUrl)}/api/sync/ws${query}`;
}

async function connectWs(): Promise<void> {
  const token = await getSessionToken();
  if (token === null) {
    return;
  }
  const url = await wsUrl(token);
  if (url === null) {
    return; // no server configured yet -- documented no-op, not a crash
  }
  // stopSync() may have run while the awaits above were in flight -- never
  // construct a socket after an intentional stop already requested one.
  if (intentionalStop) {
    return;
  }

  // Local binding: each socket's handlers reference THIS socket, not the
  // mutable module-level `ws`, so a superseded/stale socket's late-firing
  // events can never clobber a newer connection's state.
  const socket = new WebSocket(url);
  ws = socket;
  socket.onopen = () => {
    backoffMs = BACKOFF_START_MS; // reset on success
    void pullOnce(); // catch-up pull -- WS is notification-only, pull is truth
  };
  socket.onmessage = () => {
    // Deliberately unparsed: ANY frame means "go pull" and nothing more.
    void pullOnce();
  };
  socket.onclose = () => {
    if (ws === socket) {
      ws = null;
    } else {
      // Stale socket's late close -- a newer connection already owns state.
      return;
    }
    if (intentionalStop) {
      return; // stopSync already ran
    }
    // +-25% jitter on the ACTUAL scheduled delay, without perturbing the
    // underlying doubling sequence (05-RESEARCH.md Pitfall 4).
    const jittered = backoffMs * (0.75 + Math.random() * 0.5);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectWs();
    }, jittered);
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  };
  socket.onerror = () => {
    socket.close(); // funnels into onclose's backoff path
  };
}

export function startSync(callbacks: SyncCallbacks): void {
  stopSync(); // idempotent re-entry: never two live transports at once
  activeCallbacks = callbacks;
  intentionalStop = false;
  backoffMs = BACKOFF_START_MS;
  void connectWs();
  // Unconditional poll fallback, regardless of WS state (locked v0.1
  // decision, carried over unchanged).
  pollTimer = setInterval(() => {
    void pullOnce();
  }, POLL_INTERVAL_MS);
}

export function stopSync(): void {
  intentionalStop = true; // set BEFORE closing -- see onclose guard above
  activeCallbacks = null;
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws !== null) {
    const socket = ws;
    ws = null;
    socket.close();
  }
}
