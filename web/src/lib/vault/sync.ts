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
import { refreshFamilyWidePending } from "@/lib/families/familyWidePending";
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
  // 28-03 (Task 4, mirrors extension/entrypoints/background/sync-client.ts's
  // Task 1 fix byte-for-byte): invoked when a 404 arrives AFTER this session
  // has ever confirmed family membership (via EITHER this module's own
  // pullOnce() success OR store.ts's earlier, independent
  // refreshSharedItemsNow() call, through the exported
  // markFamilyMembershipConfirmed() setter below) -- the genuine "you were
  // removed mid-session" case, as opposed to "this account never had a
  // family." Always invoked BEFORE sharedPullDisabled latches, so the purge
  // it triggers can still see the (about-to-be-cleared) in-flight chain.
  onRemovedFromFamily?: () => void | Promise<void>;
  // 30-06-PLAN.md Task 2 (FSH-02/FSH-05): fires with no payload -- consumers
  // (30-12's reseal-trigger, 30-13's pending-row UI) read the fresh
  // {missing, resealable} state via familyWidePending.ts's own synchronous
  // getFamilyWidePendingSnapshot(), never a value handed off directly here,
  // since two independent consumers each read their own slice. Optional and
  // gated by the SAME sharedPullDisabled no-family latch onSharedRevisions
  // already uses -- a no-family account structurally has nothing family-wide
  // pending either.
  onFamilyWidePending?: () => void;
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
// 28-03 (Task 4, mirrors sync-client.ts's Task 1 fix byte-for-byte): "has
// ANY getSharedRevisions() call succeeded this unlock session" -- set by
// BOTH this module's own pullOnce() success path AND store.ts's
// independent, EARLIER refreshSharedItemsNow() call (via the exported
// markFamilyMembershipConfirmed() setter below), never only the former.
// Reset alongside sharedPullDisabled in startSync(). This is the
// discriminant that turns a bare 404 into "you were removed" (flag was
// true) vs. "this account never had a family" (flag was false) -- see
// onRemovedFromFamily's own doc comment above.
let hasEverConfirmedFamilyMembership = false;

/** Exported so store.ts's refreshSharedItemsNow() -- a SECOND, EARLIER
 * caller of getSharedRevisions() that runs on every unlock, before
 * pullOnce()'s own call ever fires -- can arm the SAME discriminant
 * pullOnce() itself arms on success below. Without this hoist, a member
 * removed after the eager refresh already cached shared plaintext, but
 * before pullOnce()'s own first shared round trip, would be misread as
 * "never had a family" and skip the purge entirely -- the exact
 * two-call-site race the plan-review blocker identified. */
export function markFamilyMembershipConfirmed(): void {
  hasEverConfirmedFamilyMembership = true;
}

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
  // WR-07 (code review iteration 2): iteration 1's fix stopped the 404 storm
  // for a single-user vault (`sharedPullDisabled`, above), but left the
  // round trip itself unconditional for every user who IS in a family — the
  // result was handed to `callbacks.onSharedRevisions?.()`, which no caller
  // wires up yet (Collection Key unwrap/decrypt is Phase 26/27 work), so the
  // response was fetched and immediately discarded on every WS open, every
  // WS message, and every 30s poll. Skipping the call entirely when nobody
  // will consume its result costs nothing and shrinks request volume back
  // down for the (today, only) real caller shape.
  // WR-07's early return became an `if` guard (30-06-PLAN.md Task 2): the
  // family-wide-pending block below must still run when onSharedRevisions is
  // undefined but onFamilyWidePending IS wired -- an independent opt-in, not
  // nested inside this one's own early exit.
  if (!(sharedPullDisabled || callbacks.onSharedRevisions === undefined)) {
    try {
      // Plan 23-05: the shared-revisions pull runs in the SAME pull cycle as
      // the personal snapshot above, in its OWN try/catch — a failure here is
      // equally silent/transient-retry, never a separate differently-shaped
      // error path, and never blocks/breaks the personal pull above (which
      // already ran, in its own try block).
      const revisions = await getSharedRevisions();
      // 28-03 (Task 4): arm the discriminant on THIS call site's own success
      // too -- reads as "call the same setter refreshSharedItemsNow() calls,"
      // not a private in-module assignment, so both call sites stay in sync
      // by construction.
      markFamilyMembershipConfirmed();
      if (activeCallbacks === callbacks) {
        callbacks.onSharedRevisions?.(revisions);
      }
    } catch (err) {
      if (isNotFoundError(err)) {
        // 28-03 (Task 4): a genuine removal-mid-session is only distinguishable
        // from "never had a family" by hasEverConfirmedFamilyMembership. A
        // user removed before EITHER call site's first success has, by
        // construction, cached nothing this session either -- the `false`
        // branch below correctly stays silent, byte-identical to today. A
        // user removed AFTER either succeeded is correctly caught here,
        // regardless of which call site armed the flag (Pitfall 4: the purge
        // callback always runs BEFORE the unconditional latch below, never
        // instead of it).
        if (hasEverConfirmedFamilyMembership) {
          await callbacks.onRemovedFromFamily?.();
        }
        sharedPullDisabled = true;
      }
      // Any other failure is transient — same self-healing rationale as above.
    }
  }

  // 30-06-PLAN.md Task 2 (FSH-02/FSH-05): the discovery endpoint's pull,
  // gated by the SAME sharedPullDisabled latch above (T-30-13: a no-family
  // account structurally has nothing family-wide pending either, so this
  // reuses that latch rather than inventing a second independent one) plus
  // its own callbacks.onFamilyWidePending === undefined guard -- zero added
  // network calls for any caller that doesn't opt in, and independent of
  // whether onSharedRevisions is also wired.
  if (!sharedPullDisabled && callbacks.onFamilyWidePending !== undefined) {
    try {
      // In its own try/catch (mirrors the shared-revisions block above): a
      // failure here never blocks or breaks the personal/shared-revisions
      // pulls that already ran earlier in this same cycle. In practice
      // refreshFamilyWidePending() never rejects (getFamilyWidePending() is
      // fail-safe by construction, families/api.ts) -- this catch is
      // defense-in-depth, not a load-bearing path.
      await refreshFamilyWidePending();
      if (activeCallbacks === callbacks) {
        callbacks.onFamilyWidePending?.();
      }
    } catch {
      // Transient failure — self-healing, same rationale as above.
    }
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
  hasEverConfirmedFamilyMembership = false; // 28-03: re-arm alongside sharedPullDisabled, see its own comment above
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
