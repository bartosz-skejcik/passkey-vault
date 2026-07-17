// entrypoints/background/server-unlock.ts — Plan 13-06's Firefox (or
// Chrome) passkey-unlock path: a server-origin PRF ceremony, run on the
// user's OWN configured pv-server web app (a plain https/localhost page,
// PRF supported since FF135 -- 13-FF-WEBAUTHN-RESEARCH.md option 1), and
// relayed back through content-relay.content.ts's phase-12-hardened
// channel (D-03/ASVS V5 origin+nonce+source validation precedent).
//
// THE PENDING-UNLOCK LIFECYCLE:
//   1. startServerUnlock() (popup-driven, unlock.serverCeremony.start):
//      mints a single-use nonce, opens a small popup window at
//      `<baseUrl>/?pv-ext-unlock=<nonce>`, and persists a pending record
//      -- chrome.storage.session ONLY (D-05's invariant: never
//      storage.local for anything session-scoped), never the User Key or
//      any secret. Bounded by a chrome.alarms timeout (T-09-08's own
//      "alarms survive an MV3 idle-kill" rationale applies here exactly
//      as it does to autolock.ts's alarm).
//   2. The opened window runs web/src/components/auth/ExtUnlockBridge.tsx,
//      which reuses the v0.1 passkeyUnlockCeremony() (server-rpId PRF
//      get()) and posts {nonce, prf, prfWrappedUk} to content-relay's
//      pv-ext-unlock listener -- NEVER the raw User Key (T-13-12).
//   3. completeServerUnlock() (content-script-driven via the SEPARATE
//      registerAutofillFrameChannel() listener, unlock.serverCeremony.relay):
//      validates the nonce against the pending record (single-use,
//      consumed immediately regardless of outcome -- T-13-11), unwraps the
//      User Key HERE (the sole unwrap anchor for this flow), and calls the
//      SAME setUnlockedUserKey() every other unlock path uses (alarms
//      re-armed there, WR-05's lesson already covers this call site).
// Every resolution path (success, failure, expiry) clears the pending
// record, closes the ceremony window, and broadcasts
// unlock.serverCeremony.state so an already-open popup updates without a
// poll (T-13-13: the pending state always resolves, never wedges).
import { browser } from "wxt/browser";
import { initCrypto, WasmWrappingKey, unwrapUserKey } from "../../lib/crypto/wasm-loader";
import { b64UrlToBytes } from "../../lib/messaging/bytes-b64";
import { isSessionUnlocked, setUnlockedUserKey } from "./vault-session";
import { readSessionMeta } from "./session-storage";
import { readServerConfig } from "./server-config";

const PENDING_STORAGE_KEY = "pv-server-unlock-pending";
const ALARM_NAME = "pv-server-unlock-timeout";
const CEREMONY_TIMEOUT_MS = 120_000;
const CEREMONY_WINDOW_WIDTH = 480;
const CEREMONY_WINDOW_HEIGHT = 640;

interface PendingServerUnlock {
  nonce: string;
  createdAt: number;
  windowId?: number;
}

function isPendingServerUnlock(value: unknown): value is PendingServerUnlock {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PendingServerUnlock).nonce === "string" &&
    typeof (value as PendingServerUnlock).createdAt === "number"
  );
}

async function readPending(): Promise<PendingServerUnlock | null> {
  const result = await browser.storage.session.get(PENDING_STORAGE_KEY);
  const value = result[PENDING_STORAGE_KEY];
  return isPendingServerUnlock(value) ? value : null;
}

async function writePending(pending: PendingServerUnlock): Promise<void> {
  await browser.storage.session.set({ [PENDING_STORAGE_KEY]: pending });
}

/** Single-use: called at the START of every resolution path (success,
 * failure, expiry) so a second delivery of the same nonce always finds no
 * pending record (T-13-11). Also clears the timeout alarm -- a resolved
 * ceremony must never fire a stale expiry broadcast afterwards. */
async function clearPending(): Promise<void> {
  await browser.storage.session.remove(PENDING_STORAGE_KEY);
  await browser.alarms.clear(ALARM_NAME);
}

/** crypto.getRandomValues-backed, base64url (no padding) -- matches the
 * project's other nonce/id encoding convention (content-relay.content.ts's
 * bufferSourceToB64Url). Not secret, only unguessable + single-use. */
function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function closeWindowIfAny(pending: PendingServerUnlock | null): Promise<void> {
  if (pending?.windowId === undefined) {
    return;
  }
  try {
    await browser.windows.remove(pending.windowId);
  } catch {
    // Already closed (by the user, or by ExtUnlockBridge's own
    // window.close() -- see that component's header comment) -- not an
    // error condition.
  }
}

/** Fire-and-forget broadcast, mirrors vault-session.ts's own
 * `session.locked` discipline exactly: "no receiver" (popup closed) is the
 * expected common case, not an error -- correctness never depends on this
 * being received (session.status is always authoritative on the next
 * popup open, see setUnlockedUserKey's own call below). */
async function broadcastCeremonyState(ok: boolean): Promise<void> {
  await browser.runtime
    .sendMessage({ kind: "unlock.serverCeremony.state", ok })
    .catch(() => {});
}

export type ServerUnlockStartResult =
  | { ok: true }
  | { ok: false; error: "no-server-configured" | "not-locked" | "unknown" };

/**
 * Guards BOTH preconditions before doing any I/O: a configured server base
 * URL (nowhere to open the ceremony window otherwise) and an actually-locked
 * session with an EXISTING token (this is an unlock-only recipient, exactly
 * like ext-passkey.ts's handleExtPrfUnlockFinish -- there is no sign-in
 * variant of this flow). Multiple concurrent starts: the newest call wins,
 * closing any prior ceremony window and overwriting its (now orphaned, no
 * longer matchable) nonce.
 */
export async function startServerUnlock(): Promise<ServerUnlockStartResult> {
  const config = await readServerConfig();
  if (config === null) {
    return { ok: false, error: "no-server-configured" };
  }
  if (isSessionUnlocked()) {
    return { ok: false, error: "not-locked" };
  }
  const meta = await readSessionMeta();
  if (meta === null) {
    return { ok: false, error: "not-locked" };
  }

  await closeWindowIfAny(await readPending());

  const nonce = randomNonce();
  let windowId: number | undefined;
  try {
    const created = await browser.windows.create({
      url: `${config.baseUrl}/?pv-ext-unlock=${encodeURIComponent(nonce)}`,
      type: "popup",
      width: CEREMONY_WINDOW_WIDTH,
      height: CEREMONY_WINDOW_HEIGHT,
    });
    windowId = created?.id;
  } catch {
    return { ok: false, error: "unknown" };
  }

  await writePending({ nonce, createdAt: Date.now(), windowId });
  await browser.alarms.create(ALARM_NAME, { delayInMinutes: CEREMONY_TIMEOUT_MS / 60_000 });
  return { ok: true };
}

/** T-09-08's "alarms survive an MV3 idle-kill" rationale applies here
 * exactly as it does to autolock.ts's own alarm -- a setTimeout handle
 * would simply be gone if the service worker is killed mid-ceremony.
 * Registered synchronously at startup, mirroring registerAutoLockAlarmListener. */
export function registerServerUnlockAlarmListener(): void {
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) {
      return;
    }
    void (async () => {
      const pending = await readPending();
      await clearPending();
      await closeWindowIfAny(pending);
      // T-13-13: the pending state always resolves -- an expired ceremony
      // the user left open must not leave the popup (if still open) stuck
      // showing an in-flight state forever.
      await broadcastCeremonyState(false);
    })();
  });
}

export type ServerUnlockCompleteResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden-origin" | "invalid-nonce" | "expired" | "unwrap-failed" | "unknown";
    };

/**
 * Called from router.ts's content-frame channel (unlock.serverCeremony.relay)
 * -- `callerOrigin` is the PLATFORM-provided, tamper-proof sender origin
 * (assertContentSender's own guard.origin), never a payload field; this is
 * the background-side half of T-13-11's "both relay- and background-side"
 * origin pin (content-relay.content.ts's listener registration is the
 * other half). The nonce is consumed FIRST, unconditionally, before any
 * other check -- a second delivery (replay, or a race between two relayed
 * messages) always finds no pending record, regardless of which check would
 * otherwise have failed it.
 */
export async function completeServerUnlock(
  args: { nonce: string; prfB64: string; prfWrappedUk: string },
  callerOrigin: string,
): Promise<ServerUnlockCompleteResult> {
  const config = await readServerConfig();
  if (config === null || new URL(config.baseUrl).origin !== callerOrigin) {
    // Deliberately does NOT consume the pending record here -- an
    // origin-mismatched sender was never a legitimate ceremony window to
    // begin with, so a later legitimate delivery of the SAME nonce must
    // still be able to succeed.
    return { ok: false, error: "forbidden-origin" };
  }

  const pending = await readPending();
  await clearPending(); // single-use: consumed now, regardless of outcome below

  if (pending === null || pending.nonce !== args.nonce) {
    return { ok: false, error: "invalid-nonce" };
  }
  if (Date.now() - pending.createdAt > CEREMONY_TIMEOUT_MS) {
    await closeWindowIfAny(pending);
    await broadcastCeremonyState(false);
    return { ok: false, error: "expired" };
  }

  // CR-01 (phase-13 review): args.prfB64 was encoded by content-relay's
  // bufferSourceToB64Url (base64url, no padding -- the '-'/'_' D-21
  // convention), NOT standard base64 -- b64UrlToBytes is the matching
  // decoder (see bytes-b64.ts's own header comment on that function; a
  // plain b64ToBytes/atob here threw on ~74% of real 32-byte PRF payloads).
  const prfArray = b64UrlToBytes(args.prfB64);
  let wrappingKey: WasmWrappingKey | undefined;
  try {
    await initCrypto(); // fresh SW has no WASM yet (see unlock.ts, UAT find #5)
    wrappingKey = WasmWrappingKey.fromPrf(prfArray); // zeroizes prfArray as a side effect

    const uk = unwrapUserKey(wrappingKey, args.prfWrappedUk);

    // Existing token/email/idle-minutes are unchanged by this unlock --
    // read them rather than re-deriving, mirrors ext-passkey.ts's
    // handleExtPrfUnlockFinish exactly.
    const meta = await readSessionMeta();
    if (meta === null) {
      await closeWindowIfAny(pending);
      await broadcastCeremonyState(false);
      return { ok: false, error: "unknown" };
    }
    await setUnlockedUserKey(uk, meta.accountEmail, meta.sessionToken, meta.idleTimeoutMinutes);

    await closeWindowIfAny(pending);
    await broadcastCeremonyState(true);
    return { ok: true };
  } catch {
    await closeWindowIfAny(pending);
    await broadcastCeremonyState(false);
    return { ok: false, error: "unwrap-failed" };
  } finally {
    wrappingKey?.free?.();
  }
}
