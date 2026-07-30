// Browser-side sync transport (SYNC-01/SYNC-02 client half): one WebSocket
// connection to GET /api/sync/ws for push notifications, plus a fixed
// 30s poll timer as the belt-and-suspenders fallback (05-CONTEXT.md's
// locked decision — sync must not go silently dead behind a reverse proxy
// that drops Upgrade headers). Both paths funnel into the same internal
// pullOnce(), which fetches GET /api/sync?since=N and hands the snapshot
// to the caller — WS frames are notification-only and are NEVER parsed:
// there is deliberately no code path where WS payload bytes can influence
// client state (a stronger form of SYNC-02's no-ciphertext-trust boundary
// than merely keeping ciphertext out of the schema; T-05-09).
//
// Module-singleton shape mirrors lib/crypto/index.ts's lock-state
// singleton; lifecycle (startSync on unlock, stopSync on lock) is wired by
// store.ts's existing subscribeLockState side effect.
import { getSessionToken } from "@/lib/auth/session";
import { getSharedRevisions, getSyncSnapshot, type SharedRevisions, type SyncSnapshot } from "./api";
import { setSyncStatus } from "./syncStatus";

const POLL_INTERVAL_MS = 30_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

export interface SyncCallbacks {
  getSinceRevision: () => number;
  onSnapshot: (snapshot: SyncSnapshot) => void;
  // Plan 23-05: resolved value of GET /api/sync/shared, handed off on every
  // pull cycle alongside the existing personal snapshot. Optional — no
  // consumer wires this up yet beyond what Plan 23-06's Playwright spec
  // observes over the network; store.ts may leave it unimplemented.
  onSharedRevisions?: (revisions: SharedRevisions) => void;
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
// WR-01 (code review iteration 1): once a `getSharedRevisions()` call comes
// back 404 (this account has no `family_members` row at all —
// `pull_shared_revisions`'s own `FamilyMembership<RequireRead>` gate), that
// is a PERMANENT condition for this session, not a transient failure —
// every single-user self-hosted vault (this project's headline persona)
// would otherwise 404 this endpoint silently on every WS-open, every WS
// message, and every 30s poll forever, doubling request volume for no
// client-visible effect. Reset on every startSync() (i.e. every unlock), so
// a user who is later added to a family picks the pull back up on their
// next unlock rather than staying disabled for the lifetime of the tab.
let sharedPullDisabled = false;

/** Duck-typed 404 check (mirrors `lib/vault/store.ts`'s own
 * `isConflictError` — see that function's comment for why this is NOT an
 * `instanceof ApiClientError` check: this module is re-imported per-test via
 * `vi.resetModules()`, which would make a statically-bound class reference
 * here a different object than the one a test's mock rejects with). */
function isNotFoundError(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && (err as { status: unknown }).status === 404;
}

async function pullOnce(): Promise<void> {
  const callbacks = activeCallbacks;
  if (callbacks === null) {
    return;
  }
  try {
    const snapshot = await getSyncSnapshot(callbacks.getSinceRevision());
    // Re-check: stopSync may have run while the fetch was in flight — a
    // snapshot must never be applied to a stopped (locked) session.
    if (activeCallbacks === callbacks) {
      callbacks.onSnapshot(snapshot);
    }
  } catch {
    // Transient network failure — the poll timer / next WS event retries;
    // sync is self-healing because the pull is the source of truth.
  }
  if (sharedPullDisabled) {
    return;
  }
  try {
    // Plan 23-05: the shared-revisions pull runs in the SAME pull cycle as
    // the personal snapshot above, in its OWN try/catch — a failure here is
    // equally silent/transient-retry, never a separate differently-shaped
    // error path, and never blocks/breaks the personal pull above (which
    // already ran, in its own try block).
    const revisions = await getSharedRevisions();
    if (activeCallbacks === callbacks) {
      callbacks.onSharedRevisions?.(revisions);
    }
  } catch (err) {
    if (isNotFoundError(err)) {
      sharedPullDisabled = true;
    }
    // Any other failure is transient — same self-healing rationale as above.
  }
}

/** Derives the WS URL from the SAME NEXT_PUBLIC_API_BASE_URL env var
 * lib/auth/api.ts reads — no second config surface. Empty base means
 * same-origin: ws(s)://<host>/api/sync/ws. */
function wsUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  // Session tokens are standard base64 — a raw `+` in a query string
  // decodes as a space and yields a spurious 401 (05-02's deviation flag),
  // so the token MUST be percent-encoded.
  const query = `?token=${encodeURIComponent(token)}`;
  if (base === "") {
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${wsProtocol}//${window.location.host}/api/sync/ws${query}`;
  }
  // http://… -> ws://…, https://… -> wss://… (single leading replace).
  return `${base.replace(/^http/, "ws")}/api/sync/ws${query}`;
}

function connectWs(): void {
  const token = getSessionToken();
  if (token === null) {
    return;
  }
  // Local binding: each socket's handlers reference THIS socket, not the
  // mutable module-level `ws`, so a superseded/stale socket's late-firing
  // events can never clobber a newer connection's state.
  const socket = new WebSocket(wsUrl(token));
  ws = socket;
  socket.onopen = () => {
    backoffMs = BACKOFF_START_MS; // reset on success
    setSyncStatus("connected");
    void pullOnce(); // catch-up pull — WS is notification-only, pull is truth
  };
  socket.onmessage = () => {
    // Deliberately unparsed: ANY frame means "go pull" and nothing more.
    void pullOnce();
  };
  socket.onclose = () => {
    if (ws === socket) {
      ws = null;
    } else {
      // Stale socket's late close — a newer connection already owns state.
      return;
    }
    if (intentionalStop) {
      return; // stopSync already ran and set the final "offline" status
    }
    setSyncStatus("reconnecting");
    // ±25% jitter on the ACTUAL scheduled delay, without perturbing the
    // underlying doubling sequence (05-RESEARCH.md Pitfall 4).
    const jittered = backoffMs * (0.75 + Math.random() * 0.5);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connectWs();
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
  sharedPullDisabled = false; // WR-01: re-arm on every unlock, see its own comment above
  connectWs();
  // Unconditional poll fallback, regardless of WS state (locked decision).
  pollTimer = setInterval(() => {
    void pullOnce();
  }, POLL_INTERVAL_MS);
}

export function stopSync(): void {
  intentionalStop = true; // set BEFORE closing — see onclose guard above
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
  setSyncStatus("offline");
}
