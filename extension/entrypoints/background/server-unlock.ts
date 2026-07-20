// entrypoints/background/server-unlock.ts — Plan 13-06's Firefox (or
// Chrome) passkey-unlock path: a server-origin PRF ceremony, run on the
// user's OWN configured pv-server web app (a plain https/localhost page,
// PRF supported since FF135 -- 13-FF-WEBAUTHN-RESEARCH.md option 1), and
// relayed back through content-relay.content.ts's phase-12-hardened
// channel (D-03/ASVS V5 origin+nonce+source validation precedent).
//
// Plan 13-07 (Bartek mandate, 2026-07-18: "Zrób teraz") EXTENDS this from
// unlock-only to FULL SIGN-IN: the same ceremony window, gated by a
// `mode: 'signin' | 'unlock'` pinned in the background-minted pending
// record (NEVER trusted from a later payload -- T-13-16). `unlock` mode is
// 13-06's original behavior, byte-for-byte. `signin` mode reuses the v0.1
// web `passkeyLogin` ceremony (web/src/lib/passkeys/login.ts's
// `passkeyLoginCeremony`, a 13-07 extraction mirroring 13-06's own
// `passkeyUnlockCeremony` precedent) -- the ceremony additionally yields a
// fresh server session TOKEN (an opaque bearer string, not a binary/base64
// field -- no additional encode/decode boundary applies to it, unlike the
// PRF ArrayBuffer), which this module persists through the EXACT SAME
// `setUnlockedUserKey()` write path `unlock.ts`'s `handleUnlockPassword`
// sign-in branch uses (session-storage.ts's `writeSessionMeta`).
//
// THE PENDING-UNLOCK LIFECYCLE:
//   1. startServerUnlock(mode) (popup-driven, unlock.serverCeremony.start):
//      mints a single-use nonce, opens a small popup window at
//      `<baseUrl>/?pv-ext-unlock=<nonce>&pv-mode=<mode>` (the URL's own
//      `pv-mode` is only a HINT for the bridge to render the right ceremony
//      surface -- the pending record's `mode` field, set from THIS
//      function's own argument, is the sole authority server-unlock.ts
//      itself ever trusts), and persists a pending record --
//      chrome.storage.session ONLY (D-05's invariant: never storage.local
//      for anything session-scoped), never the User Key or any secret.
//      Bounded by a chrome.alarms timeout (T-09-08's own "alarms survive an
//      MV3 idle-kill" rationale applies here exactly as it does to
//      autolock.ts's alarm). The PRECONDITION differs per mode: `unlock`
//      requires an existing (locked) session, exactly like 13-06; `signin`
//      requires the OPPOSITE -- no session-meta record at all (mirrors
//      `auth.signIn.password`'s own no-existing-token precondition).
//   2. The opened window runs web/src/components/auth/ExtUnlockBridge.tsx,
//      which reuses the v0.1 `passkeyUnlockCeremony()`/`passkeyLoginCeremony()`
//      (server-rpId PRF get()) and posts {nonce, prf, prfWrappedUk,
//      token?, accountEmail?} to content-relay's pv-ext-unlock listener --
//      NEVER the raw User Key (T-13-12).
//   3. completeServerUnlock() (content-script-driven via the SEPARATE
//      registerAutofillFrameChannel() listener, unlock.serverCeremony.relay):
//      validates the nonce against the pending record (single-use,
//      consumed immediately regardless of outcome -- T-13-11), REJECTS a
//      payload/mode mismatch (T-13-16: an `unlock`-mode nonce carrying a
//      `token` field, or a `signin`-mode nonce missing one), unwraps the
//      User Key HERE (the sole unwrap anchor for this flow), and calls the
//      SAME setUnlockedUserKey() every other unlock/sign-in path uses --
//      `unlock` mode reads the EXISTING session-meta (token/email/idle-
//      minutes unchanged, exactly like 13-06); `signin` mode has no
//      existing meta by construction, so it uses the relayed `token` +
//      `accountEmail` and DEFAULT_AUTOLOCK_MINUTES, mirroring
//      `handleUnlockPassword`'s own sign-in branch byte-for-byte.
// Every resolution path (success, failure, expiry) clears the pending
// record, closes the ceremony window, and broadcasts
// unlock.serverCeremony.state so an already-open popup updates without a
// poll (T-13-13: the pending state always resolves, never wedges).
import { browser } from "wxt/browser";
import { initCrypto, WasmWrappingKey, unwrapUserKey } from "../../lib/crypto/wasm-loader";
import { b64UrlToBytes, b64ToBytes } from "../../lib/messaging/bytes-b64";
import { isSessionUnlocked, setUnlockedUserKey } from "./vault-session";
import { readSessionMeta } from "./session-storage";
import { readServerConfig } from "./server-config";
import { DEFAULT_AUTOLOCK_MINUTES } from "./autolock";
import { centeredWindowPosition, type WindowGeometry } from "../../lib/window-geometry";
// Plan 15-01: the password-relay branch delegates to unlock.ts's OWN
// battle-tested password ceremony rather than re-deriving Argon2id material
// here -- this file never touches initCrypto/WasmWrappingKey/unwrapUserKey
// for the password path, handleUnlockPassword owns that internally.
import { handleUnlockPassword } from "./unlock";

const PENDING_STORAGE_KEY = "pv-server-unlock-pending";
const ALARM_NAME = "pv-server-unlock-timeout";
const CEREMONY_TIMEOUT_MS = 120_000;
const CEREMONY_WINDOW_WIDTH = 480;
const CEREMONY_WINDOW_HEIGHT = 640;

export type ServerCeremonyMode = "signin" | "unlock";

interface PendingServerUnlock {
  nonce: string;
  createdAt: number;
  mode: ServerCeremonyMode;
  windowId?: number;
}

/** quick-260720-16k: mirrors provider-ceremony.ts's own per-file
 * getCurrentWindowGeometry() helper (own copy in this file, not a shared
 * cross-background-module import, matching this file's existing per-file
 * helper convention e.g. closeWindowIfAny/broadcastCeremonyState) -- never
 * throws, `null` on any rejection. */
async function getCurrentWindowGeometry(): Promise<WindowGeometry | null> {
  try {
    return await browser.windows.getLastFocused();
  } catch {
    return null;
  }
}

function isServerCeremonyMode(value: unknown): value is ServerCeremonyMode {
  return value === "signin" || value === "unlock";
}

function isPendingServerUnlock(value: unknown): value is PendingServerUnlock {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as PendingServerUnlock).nonce === "string" &&
    typeof (value as PendingServerUnlock).createdAt === "number" &&
    isServerCeremonyMode((value as PendingServerUnlock).mode)
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
  | { ok: false; error: "no-server-configured" | "not-locked" | "already-signed-in" | "unknown" };

/**
 * Guards BOTH preconditions before doing any I/O: a configured server base
 * URL (nowhere to open the ceremony window otherwise) and a mode-dependent
 * session precondition. `unlock` mode is 13-06's original guard, unchanged:
 * an actually-locked session with an EXISTING token, unlock-only.
 * `signin` mode (13-07) is the OPPOSITE precondition -- NO existing
 * session-meta record at all, mirroring `auth.signIn.password`'s own
 * fresh-install/no-session-only contract (unlock.ts's `handleUnlockPassword`,
 * `email !== undefined` branch): a signed-in-but-locked session must use
 * the `unlock`-mode ceremony instead, exactly like UnlockView's own
 * `isSignIn`-gated button split (Task 3). Multiple concurrent starts: the
 * newest call wins, closing any prior ceremony window and overwriting its
 * (now orphaned, no longer matchable) nonce -- regardless of whether the
 * two calls share the same mode.
 */
export async function startServerUnlock(mode: ServerCeremonyMode): Promise<ServerUnlockStartResult> {
  const config = await readServerConfig();
  if (config === null) {
    return { ok: false, error: "no-server-configured" };
  }

  if (mode === "unlock") {
    if (isSessionUnlocked()) {
      return { ok: false, error: "not-locked" };
    }
    const meta = await readSessionMeta();
    if (meta === null) {
      return { ok: false, error: "not-locked" };
    }
  } else {
    const meta = await readSessionMeta();
    if (meta !== null) {
      return { ok: false, error: "already-signed-in" };
    }
  }

  await closeWindowIfAny(await readPending());

  const nonce = randomNonce();
  let windowId: number | undefined;
  try {
    const current = await getCurrentWindowGeometry();
    const position = centeredWindowPosition(current, CEREMONY_WINDOW_WIDTH, CEREMONY_WINDOW_HEIGHT);
    const created = await browser.windows.create({
      url: `${config.baseUrl}/?pv-ext-unlock=${encodeURIComponent(nonce)}&pv-mode=${mode}`,
      type: "popup",
      width: CEREMONY_WINDOW_WIDTH,
      height: CEREMONY_WINDOW_HEIGHT,
      focused: true,
      ...position,
    });
    windowId = created?.id;
  } catch {
    return { ok: false, error: "unknown" };
  }

  await writePending({ nonce, createdAt: Date.now(), mode, windowId });
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
      error:
        | "forbidden-origin"
        | "invalid-nonce"
        | "expired"
        | "invalid-mode-payload"
        | "already-signed-in"
        | "ceremony-failed"
        | "unwrap-failed"
        // Plan 15-01: the password branch's own wrong-password outcome.
        | "invalid-credentials"
        | "unknown";
    };

/**
 * Called from router.ts's content-frame channel (unlock.serverCeremony.relay)
 * -- `callerOrigin` is the PLATFORM-provided, tamper-proof sender origin
 * (assertContentSender's own guard.origin), never a payload field; this is
 * the background-side half of T-13-11's "both relay- and background-side"
 * origin pin (content-relay.content.ts's listener registration is the
 * other half). The nonce is consumed only once it MATCHES the current
 * pending record (WR-01 fix, phase-13 review) -- a second delivery of that
 * SAME nonce (replay) always finds no pending record afterwards, but a
 * delivery carrying a DIFFERENT (stale/mismatched) nonce deliberately does
 * NOT touch whatever ceremony is currently pending, so it can never destroy
 * a separate, still-legitimate, in-flight ceremony (T-13-13).
 *
 * Plan 13-07 (T-13-16): once the nonce is validated, the PENDING RECORD'S
 * OWN `mode` (never `args`, which the page/relay could in principle shape
 * however it likes) decides which fields are required/forbidden and which
 * `setUnlockedUserKey` call is made -- a page cannot escalate an
 * `unlock`-mode nonce into a sign-in by simply adding a `token` field to
 * its postMessage payload, nor complete a `signin`-mode nonce without one.
 */
export async function completeServerUnlock(
  args:
    | { nonce: string; failed: true }
    | { nonce: string; failed?: false; prfB64: string; prfWrappedUk: string; token?: string; accountEmail?: string }
    // Plan 15-01: the master-password sign-in path through the SAME
    // ceremony window (AMENDMENT, 15-CONTEXT.md) -- mutually exclusive with
    // the PRF variant above, detected via `"passwordB64" in args`.
    | { nonce: string; failed?: false; passwordB64: string; email: string },
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

  if (pending === null) {
    // WR-01 fix (phase-13 review, T-13-13): no ceremony is pending at all --
    // either a replay of an already-resolved nonce (that earlier delivery
    // already broadcast) or a bogus/forged nonce that never matched a real
    // ceremony. Broadcasting here is a harmless no-op in the replay case,
    // and is the safety net against a popup ever left wedged with nothing
    // else to resolve it (T-13-13: "every pending path ... must resolve
    // UnlockView's in-flight UI").
    await broadcastCeremonyState(false);
    return { ok: false, error: "invalid-nonce" };
  }

  if (pending.nonce !== args.nonce) {
    // WR-01 fix: a DIFFERENT ceremony is currently pending -- e.g. a rapid
    // re-trigger race where a stale/abandoned window's ExtUnlockBridge
    // posts an earlier nonce after startServerUnlock already rotated to a
    // new one (see that function's own "latest wins" comment). Deliberately
    // does NOT consume, close, or broadcast anything for the CURRENT
    // pending record here -- it belongs to a separate, still-legitimate,
    // in-flight ceremony that must be left alone to resolve on its own path
    // (success/expiry/its own nonce match); broadcasting false here would
    // falsely report failure for a ceremony that has not actually failed.
    return { ok: false, error: "invalid-nonce" };
  }

  await clearPending(); // single-use: consumed now, regardless of outcome below

  if (args.failed === true) {
    // Bartek live-UAT bug fix (.planning/debug/resolved/
    // signin-passkeyless-spin.md): ExtUnlockBridge itself already reached a
    // terminal, calmly-explained failure state (no-passkeys/not-signed-in/
    // genuine ceremony failure, e.g. web/src/lib/passkeys/login.ts's own
    // bounded gesture timeout on a hung native picker) -- resolve the
    // pending record + the popup's in-flight state IMMEDIATELY (T-13-13)
    // rather than waiting for CEREMONY_TIMEOUT_MS's 120s alarm. Deliberately
    // does NOT close the window here -- unlike every other failure branch
    // below (which fire for outcomes the ceremony window's own UI never got
    // a chance to render, e.g. an origin/mode mismatch), the bridge is
    // ACTIVELY showing the user an explicit message right now; a window
    // that just said something explicit is not a "ghost window" to be
    // yanked shut out from under the person reading it.
    await broadcastCeremonyState(false);
    return { ok: false, error: "ceremony-failed" };
  }

  if (Date.now() - pending.createdAt > CEREMONY_TIMEOUT_MS) {
    await closeWindowIfAny(pending);
    await broadcastCeremonyState(false);
    return { ok: false, error: "expired" };
  }

  // Plan 15-01 (AMENDMENT, 15-CONTEXT.md): the password-shaped payload is
  // detected FIRST, before any of the PRF-shape mode-pinning checks below
  // (those checks only ever apply to the PRF variant -- this branch handles
  // its own mode-pinning and returns/never falls through to them).
  if ("passwordB64" in args) {
    if (pending.mode === "unlock") {
      // The unlock-mode ceremony stays PRF-only (UI-SPEC: "no password form
      // needed here -- popup already offers password") -- a page cannot
      // escalate an unlock-mode nonce into a password sign-in.
      await closeWindowIfAny(pending);
      await broadcastCeremonyState(false);
      return { ok: false, error: "invalid-mode-payload" };
    }

    // pending.mode === "signin" -- WR-01(rev2)-symmetric re-guard against a
    // concurrent sign-in racing this one (mirrors the existing PRF signin
    // branch's own readSessionMeta() re-check below).
    const existing = await readSessionMeta();
    if (existing !== null) {
      await closeWindowIfAny(pending);
      await broadcastCeremonyState(false); // T-13-13: never wedge
      return { ok: false, error: "already-signed-in" };
    }

    const passwordBytes = b64ToBytes(args.passwordB64);
    const result = await handleUnlockPassword(passwordBytes, args.email);

    if (result.ok === true) {
      await closeWindowIfAny(pending);
      await broadcastCeremonyState(true);
      return { ok: true };
    }

    await closeWindowIfAny(pending);
    await broadcastCeremonyState(false);
    return {
      ok: false,
      error: result.error === "invalid-credentials" ? "invalid-credentials" : "unwrap-failed",
    };
  }

  // T-13-16 (Plan 13-07): the PENDING RECORD's mode is authoritative --
  // never `args`. `unlock` mode must NEVER carry a token (that would be an
  // attempted escalation to sign-in); `signin` mode REQUIRES both a token
  // and the account email the bridge's prelogin used (passkeyLogin
  // identifies the user by email, not a discoverable credential).
  if (pending.mode === "unlock" && args.token !== undefined) {
    await closeWindowIfAny(pending);
    await broadcastCeremonyState(false);
    return { ok: false, error: "invalid-mode-payload" };
  }
  if (pending.mode === "signin" && (args.token === undefined || args.accountEmail === undefined)) {
    await closeWindowIfAny(pending);
    await broadcastCeremonyState(false);
    return { ok: false, error: "invalid-mode-payload" };
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

    if (pending.mode === "signin") {
      // WR-01(rev2) fix (13-REVIEW-2.md): startServerUnlock's own
      // "no existing session-meta" guard only holds AT START time -- a
      // session can be established in the interim (e.g. a concurrent
      // password sign-in, or a second ceremony resolving first) while this
      // ceremony window is still open. Re-assert the precondition HERE,
      // symmetric with the unlock branch's own readSessionMeta() read
      // below, so completion never clobbers a live session's token/email
      // and silently resets its autolock to DEFAULT_AUTOLOCK_MINUTES.
      const existing = await readSessionMeta();
      if (existing !== null) {
        await closeWindowIfAny(pending);
        await broadcastCeremonyState(false); // T-13-13: never wedge
        return { ok: false, error: "already-signed-in" };
      }
      // No existing session-meta record -- persists the RELAYED
      // token/email through the EXACT SAME setUnlockedUserKey() write path
      // handleUnlockPassword's own sign-in branch uses (unlock.ts),
      // including DEFAULT_AUTOLOCK_MINUTES for a fresh session.
      await setUnlockedUserKey(uk, args.accountEmail as string, args.token as string, DEFAULT_AUTOLOCK_MINUTES);
    } else {
      // Existing token/email/idle-minutes are unchanged by this unlock --
      // read them rather than re-deriving.
      const meta = await readSessionMeta();
      if (meta === null) {
        await closeWindowIfAny(pending);
        await broadcastCeremonyState(false);
        return { ok: false, error: "unknown" };
      }
      await setUnlockedUserKey(uk, meta.accountEmail, meta.sessionToken, meta.idleTimeoutMinutes);
    }

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
