// entrypoints/background/router.ts — the typed browser.runtime.onMessage
// dispatch table for the ext-protocol.ts message contract. This grows
// across Waves 3-5 (each adds its own `case` + import) -- 09-04 adds
// `unlock.*` kinds, 09-05 adds `vault.list`, 09-06 adds `config.get`/
// `config.set` -- by adding a case to the switch below, never by
// restructuring this shape. (09-08's extension-scoped-PRF message kinds
// and the popup-dispatched `auth.signIn.password` kind were hard-removed
// in AUTH-03/Plan 15-04, superseded by the server-origin ceremony window
// -- server-unlock.ts. Their exact former literal names are intentionally
// not repeated here -- see Plan 15-06's permanent
// no-ext-scoped-prf-strings.test.ts guard.)
// `vault.updated` (also added by 09-05) is deliberately NOT one of this
// router's recognized kinds -- it's a fire-and-forget broadcast FROM the
// background TO any open popup, not a request this router should dispatch
// or respond to; isProtocolMessage() below returning false for it lets
// this listener step aside so a future popup-side listener can react.
//
// WR-01 (code review, Phase 8): only this extension's own pages
// (popup/options -- whether action-hosted or opened in a tab) may trigger
// crypto/session work. The discriminator is the browser-constructed
// sender.url origin: our own chrome-extension://<id>/ pages pass; content
// scripts report the hostile page's http(s) URL and foreign extensions a
// different id, so both are rejected. This gate is replicated here
// (this router is now the ONLY onMessage listener — WR-08 removed the spike one)
// so this router independently enforces the same control regardless of
// what other listeners exist -- Phase 10 must widen this into an explicit
// allow-list when content scripts legitimately need the background, never
// by deleting the check.
//
// Phase 10 (Plan 10-01): `sender` is now threaded through to `handle()`
// (Phase 9 discarded it, unused, under a leading-underscore name), and
// `handle()` runs its own independent `assertPopupSender()`
// (entrypoints/background/frame-guard.ts)
// gate in front of every `session.*`/`vault.*` kind -- see that function's
// header for why this is deliberately a SECOND, independent check rather
// than a replacement for the WR-01 gate above. Plan 10-04 adds the
// `autofill.match`/`autofill.fill`/`autofill.totpCode` cases below,
// dispatching to entrypoints/background/autofill-match.ts -- these kinds
// are deliberately NOT subject to the `assertPopupSender()` tier guard
// above (it only gates `session.*`/`vault.*`): they legitimately
// originate from the popup like every other kind here, and
// autofill-match.ts's own handlers do their own origin/frame
// re-verification against the target PAGE, which is an orthogonal
// concern to this router's popup-vs-content-script sender gate.
//
// Phase 11 (Plan 11-01): `generate-request` (ext-protocol.ts) is a THIRD
// kind added to `registerAutofillFrameChannel()`'s content-frame dispatch
// below -- NOT to `isProtocolMessage()`/`handle()`'s popup-facing switch --
// dispatching to `handleGenerateRequest` (entrypoints/background/
// generate-handler.ts). It is content-script-only for the same reason
// `autofill.matchFrame`/`autofill.fillFrame` are: Plan 11-04's generate
// popover lives inside a content script, never the popup.
//
// Phase 11 (Plan 11-03): `capture.propose`/`capture.confirm` are a FOURTH
// and FIFTH kind added to the SAME content-frame dispatch below -- also
// NOT to `isProtocolMessage()`/`handle()`. `senderTopOrigin` for
// classifySubmit is derived EXCLUSIVELY from `sender.tab.url` (the
// browser-attached, tamper-proof sender metadata), never from
// `message.frameOrigin` or any other client-supplied field (D-06/T-11-07).
// Both handlers call `assertContentSender(sender)` first, exactly like
// `autofill.matchFrame`/`autofill.fillFrame`.
//
// Phase 12 (Plan 12-02): `credentials.create`/`credentials.get` are a
// SIXTH and SEVENTH kind added to the SAME content-frame dispatch below --
// also NOT to `isProtocolMessage()`/`handle()`, for the same WR-01 reason
// every other content-script-only kind here is excluded from that channel
// (its addListener-level sender.url gate rejects every content-script
// sender before `handle()` ever runs, so routing a passkey ceremony there
// would silently drop it). Provider messages come from
// `content-relay.content.ts` (Plan 12-03), a content script. Each handler
// calls `assertContentSender(sender)` first and passes `guard.origin` (the
// sender-verified origin) to `handleCredentialsCreate`/`handleCredentialsGet`
// (Plan 12-02's provider-ceremony.ts) -- neither message shape carries an
// origin field at all (ext-protocol.ts), so there is nothing on the payload
// for a caller to spoof even in principle, exactly like
// `autofill.matchFrame`'s own "no origin field" discipline. A rejected
// sender fails open to `{ fallthrough: true }` (D-11/PROV-03) rather than
// `{ ok: false }` -- there is no legitimate "error" response shape for the
// page's ceremony promise here, only "hand this back to the native
// authenticator".
import { browser } from "wxt/browser";
import type { Message, MessageOf, MessageResponseMap } from "../../lib/messaging/ext-protocol";
import { b64ToBytes } from "../../lib/messaging/bytes-b64";
import { assertPopupSender, type MessageSender } from "./frame-guard";
import { ensureHydrated, noteActivity, signOutVaultSession } from "./vault-session";
import { armAutoLock, AUTOLOCK_OPTIONS, DEFAULT_AUTOLOCK_MINUTES } from "./autolock";
import { readSessionMeta, writeSessionMeta } from "./session-storage";
import { handleUnlockPassword } from "./unlock";
import {
  getItems,
  getFolders,
  ensureItemsHydrated,
  getPendingSharedItems,
  RevisionConflictError,
  touchVaultItem,
} from "./vault-store";
import { getCollections } from "./collections-store";
import { handleAutofillFill, handleAutofillMatch, handleAutofillTotpCode } from "./autofill-match";
import { handleFillFrame, handleMatchFrame, assertContentSender } from "./autofill-frame";
import { handleGenerateRequest } from "./generate-handler";
import {
  handleCredentialsCreate,
  handleCredentialsGet,
  resolveProviderCredentialChoice,
} from "./provider-ceremony";
import {
  classifySubmit,
  confirmNewLogin,
  confirmUpdateLogin,
  LockedVaultError,
  OwnershipMismatchError,
} from "./capture-handler";
import {
  readServerConfig,
  configureServer,
  probeServerHealthDetailed,
  normalizeServerUrl,
  InvalidServerUrlError,
  ServerUnreachableError,
  ServerCorsBlockedError,
} from "./server-config";
import { startServerUnlock, completeServerUnlock } from "./server-unlock";

export function registerMessageRouter(): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    const ownOrigin = browser.runtime.getURL("");
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(ownOrigin)) {
      return undefined;
    }

    if (!isProtocolMessage(message)) {
      return undefined; // not one of this router's kinds -- let other listeners handle it
    }

    // Re-arm auto-lock on any popup activity; no-op if locked. EXCEPT for
    // session.setAutoLockMinutes: that handler is itself authoritative for
    // the alarm, and noteActivity() reads the PRE-change interval from
    // session meta, so running both concurrently raced — whichever landed
    // last won, usually clobbering the user's new choice back to the old
    // one (real-browser UAT: picking 5 left the alarm at 15).
    //
    // Phase 10 (Plan 10-01): this now also re-arms on every `autofill.*`
    // message once Plan 10-04 adds those cases. That is a DELIBERATE
    // decision, not an unaddressed side effect: 10-RESEARCH.md's ASVS V3
    // note flags "autofill must not extend the session TTL as a side
    // effect", but every `autofill.*` message originates from an explicit
    // popup gesture (opening the popup, clicking "Wypełnij") -- the
    // extension IS the user acting here, exactly like every other kind
    // this router already re-arms on. Do not special-case autofill.* out
    // of this re-arm without re-reading that ASVS note first.
    if (message.kind !== "session.setAutoLockMinutes") {
      void noteActivity();
    }
    // WR-01 (09-REVIEW.md): several handlers CAN reject (e.g. a corrupt
    // envelope throwing out of ensureHydrated(), or a short/malformed PRF
    // buffer). Without a rejection path here, sendResponse() is never
    // called, the message channel opened by `return true` below just hangs
    // until it eventually closes with a lastError, and the rejection leaks
    // as an unhandled promise rejection in the service worker. Every
    // dispatched message now gets SOME typed response.
    void handle(message, sender).then(sendResponse, (e: unknown) => {
      console.error("[passkey-vault] handler failed", message.kind, e);
      sendResponse({ ok: false, error: "unknown" });
    });
    return true; // keep the message channel open for the async sendResponse
  });
}

// Phase 10 (Plan 10-09): the content-relay <-> background channel underlying
// the in-page overlay (Plan 10-10 is pure UI on top of this). This is a
// SECOND, INDEPENDENT `runtime.onMessage` listener -- deliberately NOT
// routed through `handle()` above, and deliberately NOT gated by the
// popup router's own addListener-level WR-01 sender check (which drops
// every content-script sender before `handle()` ever runs). Content
// scripts are exactly the senders this channel exists to serve, so
// admitting them here does not "loosen" WR-01 -- WR-01 keeps refusing
// every `session.*`/`vault.*` request from a content script, completely
// unchanged, in the OTHER listener. Each handler
// (entrypoints/background/autofill-frame.ts) independently re-verifies its
// own sender via `assertContentSender()` before touching anything, so this
// listener's addListener callback itself needs no sender check beyond the
// kind filter below -- defense-in-depth lives inside the handlers, exactly
// like `handle()`'s own `assertPopupSender()` re-check does for its tier.
export function registerAutofillFrameChannel(): void {
  browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isContentFrameMessage(message)) {
      return undefined; // not one of this channel's kinds -- let the popup router (or another listener) handle it
    }
    void handleContentFrameMessage(message, sender).then(sendResponse, (e: unknown) => {
      console.error("[passkey-vault] autofill-frame handler failed", message.kind, e);
      sendResponse({ ok: false, reason: "target-unreachable" });
    });
    return true; // keep the message channel open for the async sendResponse
  });
}

function isContentFrameMessage(
  message: unknown,
): message is
  | MessageOf<"autofill.matchFrame">
  | MessageOf<"autofill.fillFrame">
  | MessageOf<"generate-request">
  | MessageOf<"capture.propose">
  | MessageOf<"capture.confirm">
  | MessageOf<"credentials.create">
  | MessageOf<"credentials.get">
  | MessageOf<"unlock.serverCeremony.relay"> {
  if (
    typeof message !== "object" ||
    message === null ||
    typeof (message as { kind?: unknown }).kind !== "string"
  ) {
    return false;
  }
  const kind = (message as { kind: string }).kind;
  return (
    kind === "autofill.matchFrame" ||
    kind === "autofill.fillFrame" ||
    kind === "generate-request" ||
    kind === "capture.propose" ||
    kind === "capture.confirm" ||
    kind === "credentials.create" ||
    kind === "credentials.get" ||
    // Plan 13-06 (T-13-14): rides this content-frame guarded channel, NEVER
    // the popup-gated one -- see this file's own header comment on
    // credentials.create/credentials.get for the identical rationale.
    kind === "unlock.serverCeremony.relay"
  );
}

async function handleContentFrameMessage(
  message:
    | MessageOf<"autofill.matchFrame">
    | MessageOf<"autofill.fillFrame">
    | MessageOf<"generate-request">
    | MessageOf<"capture.propose">
    | MessageOf<"capture.confirm">
    | MessageOf<"credentials.create">
    | MessageOf<"credentials.get">
    | MessageOf<"unlock.serverCeremony.relay">,
  sender: MessageSender,
): Promise<unknown> {
  switch (message.kind) {
    case "autofill.matchFrame":
      return handleMatchFrame(message, sender);
    case "autofill.fillFrame":
      return handleFillFrame(message, sender);
    case "generate-request":
      // Phase 11 (Plan 11-01): handleGenerateRequest is a pure, synchronous
      // dispatcher (see its own header comment) -- returning its value
      // directly from this async function wraps it in a resolved Promise,
      // same as the two async cases above.
      return handleGenerateRequest(message, sender);
    case "capture.propose":
      return handleCaptureProposeMessage(message, sender);
    case "capture.confirm":
      return handleCaptureConfirmMessage(message, sender);
    case "credentials.create":
      return handleCredentialsCreateMessage(message, sender);
    case "credentials.get":
      return handleCredentialsGetMessage(message, sender);
    case "unlock.serverCeremony.relay":
      return handleServerUnlockRelayMessage(message, sender);
    default:
      throw new Error(`unhandled content-frame message kind: ${(message as { kind: string }).kind}`);
  }
}

// Plan 13-06 (T-13-11/T-13-14): mirrors handleCredentialsCreateMessage/
// handleCredentialsGetMessage's own shape -- assertContentSender(sender)
// FIRST, and `guard.origin` (the platform-provided, tamper-proof sender
// origin) is the ONLY origin ever passed to completeServerUnlock(), which
// independently re-checks it against the configured server's origin
// (background-side half of the "both relay- and background-side" origin
// pin; content-relay.content.ts's listener registration gate is the other
// half). Unlike credentials.create/get's "fail open to fallthrough"
// discipline, there is no native-authenticator fallback for this flow -- a
// rejected sender fails to a typed error the ceremony window's ack listener
// can render. Plan 13-07: `token`/`accountEmail` pass straight through
// (both `undefined` for an `unlock`-mode ceremony, both present for
// `signin`) -- this handler never interprets or validates them itself,
// completeServerUnlock's own T-13-16 mode-pinning check is the sole
// authority on whether a given payload shape is legal for the pending
// ceremony's mode.
async function handleServerUnlockRelayMessage(
  message: MessageOf<"unlock.serverCeremony.relay">,
  sender: MessageSender,
): Promise<MessageResponseMap["unlock.serverCeremony.relay"]> {
  const guard = assertContentSender(sender);
  if (!guard.ok) {
    return { ok: false, error: "forbidden-sender" };
  }
  // Bartek live-UAT bug fix (.planning/debug/resolved/
  // signin-passkeyless-spin.md): `failed: true` is a SEPARATE union member
  // (ext-protocol.ts) carrying no prfB64/prfWrappedUk at all -- forward it
  // as-is; completeServerUnlock's own `failed` branch resolves the pending
  // record + broadcasts ok:false immediately (T-13-13) rather than only
  // ever being reached via the 120s CEREMONY_TIMEOUT_MS alarm.
  if (message.failed === true) {
    return completeServerUnlock({ nonce: message.nonce, failed: true }, guard.origin);
  }
  // Plan 15-01: the password-shaped variant is a THIRD, mutually-exclusive
  // union member (no prfB64/prfWrappedUk/token/accountEmail on it at all) --
  // forwarded verbatim, exactly as the PRF variant below.
  if ("passwordB64" in message) {
    return completeServerUnlock(
      { nonce: message.nonce, passwordB64: message.passwordB64, email: message.email },
      guard.origin,
    );
  }
  return completeServerUnlock(
    {
      nonce: message.nonce,
      prfB64: message.prfB64,
      prfWrappedUk: message.prfWrappedUk,
      token: message.token,
      accountEmail: message.accountEmail,
    },
    guard.origin,
  );
}

// Phase 12 (Plan 12-02): mirrors handleCaptureProposeMessage/
// handleCaptureConfirmMessage's own shape -- assertContentSender(sender)
// FIRST, and `guard.origin` (never a payload field, since neither
// `credentials.create` nor `credentials.get` carries one) is the ONLY
// origin ever passed to provider-ceremony.ts. A rejected sender fails OPEN
// to `{ fallthrough: true }` (D-11/PROV-03) -- unlike capture.propose's
// `{ action: 'no-op', mismatch: true }` shape, there is no legitimate
// "error" response for a page's WebAuthn ceremony promise, only "hand this
// back to the native authenticator".
async function handleCredentialsCreateMessage(
  message: MessageOf<"credentials.create">,
  sender: MessageSender,
): Promise<MessageResponseMap["credentials.create"]> {
  const guard = assertContentSender(sender);
  if (!guard.ok) {
    return { fallthrough: true };
  }
  return handleCredentialsCreate({ publicKey: message.publicKey }, guard.origin);
}

async function handleCredentialsGetMessage(
  message: MessageOf<"credentials.get">,
  sender: MessageSender,
): Promise<MessageResponseMap["credentials.get"]> {
  const guard = assertContentSender(sender);
  if (!guard.ok) {
    return { fallthrough: true };
  }
  return handleCredentialsGet({ publicKey: message.publicKey }, guard.origin);
}

/** Derives the trusted top-level origin EXCLUSIVELY from the platform-
 * provided `sender.tab.url` -- never from `message.frameOrigin` or any
 * other client-supplied field (D-06/T-11-07). Fails CLOSED to `""` (never
 * equal to a real origin, so classifySubmit's mismatch check trips) on an
 * unparseable/missing tab URL, mirroring frame-guard.ts's originEquals'
 * own "never treat a parse failure as a match" discipline. */
function deriveSenderTopOrigin(sender: MessageSender): string {
  const tabUrl = sender.tab?.url;
  if (tabUrl === undefined) {
    return "";
  }
  try {
    return new URL(tabUrl).origin;
  } catch {
    return "";
  }
}

async function handleCaptureProposeMessage(
  message: MessageOf<"capture.propose">,
  sender: MessageSender,
): Promise<MessageResponseMap["capture.propose"]> {
  const guard = assertContentSender(sender);
  if (!guard.ok) {
    // No legitimate response shape for a rejected sender exists in
    // MessageResponseMap["capture.propose"] beyond a maximally-inert
    // no-op — mirrors handleMatchFrame's own "fail closed, empty result"
    // discipline for a non-content-script sender.
    return { action: "no-op", frameOrigin: "", topOrigin: "", mismatch: true };
  }
  // WR-03 (11-REVIEW.md, iteration 1) established the discipline; iteration
  // 2 found the fix cosmetic -- `ensureHydrated()` only re-derives the User
  // Key itself, it never touches vault-store's `items` array. The ACTUAL
  // hydration gate is `ensureItemsHydrated()` below, which awaits
  // vault-store's own tracked initial `getSyncSnapshot(0)` pull. Without
  // it, a freshly-woken/idle-killed service worker could classify against
  // an empty in-memory cache, misreport an existing credential as 'new',
  // and confirmNewLogin (which does not re-classify) would then create a
  // duplicate item -- the precise defect this gate exists to close.
  const uk = await ensureHydrated();
  if (uk === null) {
    // Locked: no legitimate classification is possible. There is no
    // dedicated "locked" action in MessageResponseMap["capture.propose"]
    // (frozen by Plan 11-01) -- 'no-op' with mismatch:true is the least-
    // surprising fail-closed choice, mirroring the rejected-sender branch
    // above.
    return { action: "no-op", frameOrigin: guard.origin, topOrigin: "", mismatch: true };
  }
  // WR-03 (11-REVIEW.md, iteration 2): actually wait for the item cache to
  // reflect the server before classifying -- see vault-store.ts's own
  // header comment on `ensureItemsHydrated()` for the single-flight/
  // typed-failure contract. A failed pull means the cache state is
  // UNKNOWN, not "confirmed empty" -- classifying anyway risks the exact
  // duplicate-item defect this gate exists to close, so this fails closed
  // with the same 'no-op'/mismatch:true shape used by the locked and
  // rejected-sender branches above rather than guessing.
  const hydration = await ensureItemsHydrated();
  if (!hydration.ok) {
    return { action: "no-op", frameOrigin: guard.origin, topOrigin: "", mismatch: true };
  }
  const senderTopOrigin = deriveSenderTopOrigin(sender);
  // CR-01 fix (11-REVIEW.md): the TRUSTED sender-derived origin
  // (`guard.origin`, from assertContentSender) is the frameOrigin fed into
  // classifySubmit -- never `message.frameOrigin`, the content script's
  // self-reported `location.origin`. The payload field is discarded here by
  // construction; it must never feed a security decision (it may still be
  // surfaced to the UI as a display candidate elsewhere, but not here).
  return classifySubmit(
    { frameOrigin: guard.origin, username: message.username, password: message.password },
    getItems(),
    senderTopOrigin,
  );
}

async function handleCaptureConfirmMessage(
  message: MessageOf<"capture.confirm">,
  sender: MessageSender,
): Promise<MessageResponseMap["capture.confirm"]> {
  const guard = assertContentSender(sender);
  if (!guard.ok) {
    return { status: "error", message: "forbidden-sender" };
  }
  // CR-01/WR-01 fix (11-REVIEW.md): the TRUSTED sender-derived origin is
  // used for both the persisted `urls` (via capture-handler.ts's
  // buildLoginFields) and the WR-04 ownership re-check inside
  // confirmUpdateLogin -- never `message.frameOrigin`, which round-trips
  // through the untrusted content-script closure between propose and
  // confirm.
  const fields = {
    frameOrigin: guard.origin,
    username: message.username,
    password: message.password,
  };
  try {
    if (message.action === "new") {
      const item = await confirmNewLogin(fields);
      return { status: "ok", item };
    }
    if (message.itemId === undefined || message.currentRevision === undefined) {
      return { status: "error", message: "missing itemId/currentRevision for an update confirm" };
    }
    const item = await confirmUpdateLogin(message.itemId, fields, message.currentRevision);
    return { status: "ok", item };
  } catch (e) {
    if (e instanceof RevisionConflictError) {
      return { status: "conflict", message: e.message };
    }
    if (e instanceof LockedVaultError) {
      return { status: "error", message: e.message };
    }
    if (e instanceof OwnershipMismatchError) {
      return { status: "error", message: e.message };
    }
    throw e;
  }
}

function isProtocolMessage(message: unknown): message is Message {
  if (
    typeof message !== "object" ||
    message === null ||
    typeof (message as { kind?: unknown }).kind !== "string"
  ) {
    return false;
  }
  const kind = (message as { kind: string }).kind;
  return (
    kind === "session.status" ||
    kind === "session.setAutoLockMinutes" ||
    kind === "unlock.password" ||
    kind === "vault.list" ||
    kind === "config.get" ||
    kind === "config.set" ||
    // Plan 15-05 (AUTH-04): config.probe is popup-driven, mirrors
    // config.get/config.set's own shape. session.signOut is popup-driven
    // and matches "session." startsWith gate below (assertPopupSender)
    // exactly like session.status already does.
    kind === "config.probe" ||
    kind === "session.signOut" ||
    kind === "autofill.match" ||
    kind === "autofill.fill" ||
    kind === "autofill.totpCode" ||
    // Phase 12 (Plan 12-04, deviation -- see SUMMARY): popup-driven, unlike
    // credentials.create/credentials.get (content-frame-only, above this
    // list is irrelevant to those). This IS one of this router's own kinds.
    kind === "provider.resolveChoice" ||
    // quick-260717: popup-driven, matches "vault." startsWith gate below
    // (assertPopupSender) exactly like vault.list already does.
    kind === "vault.touch" ||
    // Plan 13-06: popup-driven -- unlike unlock.serverCeremony.relay (content-frame-only, above this
    // list is irrelevant to it) and unlock.serverCeremony.state (a
    // fire-and-forget broadcast FROM the background, never dispatched TO
    // this router at all -- see ext-protocol.ts's own header comment).
    kind === "unlock.serverCeremony.start"
  );
}

// Phase 10 (Plan 10-01): `sender` is now threaded all the way through --
// Phase 9's addListener callback took it as a parameter but discarded it
// unused, under a leading-underscore name, all the way down to this
// function's now-removed single-argument signature.
// Phase 10's content-relay (Plan 10-05) is the first non-popup caller ever
// on this channel; the guard below is what lets router.ts keep enforcing
// the popup-only tier for session/vault operations regardless of who else
// gains access to runtime.onMessage in a later phase.
async function handle(message: Message, sender: MessageSender): Promise<unknown> {
  // T-10-01: a content script running adjacent to a hostile page must
  // never be able to drive session or vault-listing operations by reaching
  // this switch. This is a DELIBERATE, independent check -- do not remove
  // it even if the addListener-level WR-01 origin gate above is ever
  // loosened to admit non-extension-page senders for autofill.* traffic in
  // a later plan (defense in depth: this router enforces its own control
  // regardless of what else changes upstream, per WR-01's own precedent).
  if (
    (message.kind.startsWith("session.") || message.kind.startsWith("vault.")) &&
    !assertPopupSender(sender)
  ) {
    return { ok: false, error: "forbidden-sender" };
  }
  switch (message.kind) {
    case "session.status":
      return getSessionStatus();
    case "session.setAutoLockMinutes":
      return setAutoLockMinutes(message.minutes);
    case "unlock.password":
      // b64ToBytes()'s output is a freshly-allocated Uint8Array -- handed
      // straight to handleUnlockPassword(), which already zeroizes it (its
      // own `finally { passwordBytes.fill(0) }`, unl.ts) regardless of
      // outcome. No separate fill(0) needed here.
      return handleUnlockPassword(b64ToBytes(message.passwordB64));
    case "vault.list":
      // 27-04 (Task 1): `pending`/`collections` are this plan's own new
      // wire-shape additions -- 27-08 (popup) consumes them for the
      // pending-decrypt stub row and folder-name lookups; this task is the
      // sole owner of the vault.list response shape this phase adds.
      return {
        items: getItems(),
        folders: getFolders(),
        pending: getPendingSharedItems(),
        collections: getCollections(),
      };
    case "config.get":
      return handleConfigGet();
    case "config.set":
      return handleConfigSet(message.rawUrl);
    case "config.probe":
      return handleConfigProbe(message.rawUrl);
    case "session.signOut":
      // Plan 15-05: signOutVaultSession() never throws by design (Plan
      // 15-02) -- always ok:true, mirroring provider.resolveChoice's
      // always-ack shape.
      await signOutVaultSession();
      return { ok: true as const };
    case "autofill.match":
      return handleAutofillMatch(sender);
    case "autofill.fill":
      return handleAutofillFill(message, sender);
    case "autofill.totpCode":
      return handleAutofillTotpCode(message, sender);
    case "provider.resolveChoice":
      // Plan 12-04 (deviation): resolveProviderCredentialChoice() itself
      // is synchronous/void (provider-ceremony.ts) -- it just unblocks
      // resolvePasskeyChoice()'s awaited Promise; there is nothing to
      // await or fail here beyond an unknown/already-resolved requestId,
      // which resolveProviderCredentialChoice already no-ops on.
      resolveProviderCredentialChoice(message.requestId, message.itemId);
      return { ok: true as const };
    case "vault.touch":
      // quick-260717: touchVaultItem() itself is fire-and-forget and never
      // throws (catches + debug-logs internally) -- this handler never
      // awaits it, so a slow/offline touch can never delay the popup's
      // response beyond this synchronous dispatch.
      touchVaultItem(message.itemId);
      return { ok: true as const };
    case "unlock.serverCeremony.start":
      return startServerUnlock(message.mode);
    default:
      throw new Error(`unhandled message kind: ${(message as { kind: string }).kind}`);
  }
}

// REVISED for the Blocker-2 fix: session.status is keyed off
// session-storage.ts's lock-surviving session-meta record, NOT the key
// envelope -- a present meta record with no key material is exactly what
// "locked" (as opposed to "no-session") means now that lockVaultSession()
// no longer deletes the meta record.
//
// AUTH-03 (Plan 15-04): the 09-08 extPasskeyEnrolled/extPasskeyPromptSuppressed
// enrichment is removed -- the extension-scoped PRF surface it gated no
// longer exists, so this call goes back to reporting only lock state.
async function getSessionStatus(): Promise<MessageResponseMap["session.status"]> {
  const meta = await readSessionMeta();
  if (meta === null) {
    return { kind: "no-session" };
  }
  const uk = await ensureHydrated();
  if (uk === null) {
    return {
      kind: "locked",
      wasAutoLocked: meta.wasAutoLocked,
      autoLockMinutes: meta.idleTimeoutMinutes,
    };
  }
  return {
    kind: "unlocked",
    autoLockMinutes: meta.idleTimeoutMinutes,
    accountEmail: meta.accountEmail,
  };
}

async function setAutoLockMinutes(minutes: number): Promise<{ ok: true }> {
  // EXT-03's "configurable" hinges on this PERSISTING, not just arming:
  // noteActivity() re-arms from session-meta's idleTimeoutMinutes on every
  // subsequent message, and session.status seeds the popup's select from
  // the same field. Arming alone (the original bug) meant the very next
  // message clobbered the new interval back to the stored one, and
  // reopening the popup showed the stale value — the control was inert.
  // Found by real-browser UAT; unit tests mock sendMessage and never
  // observed the alarm. Whitelist-validate HERE too so a rejected value is
  // never written to storage (armAutoLock validates independently for its
  // own callers).
  const validated = (AUTOLOCK_OPTIONS as readonly number[]).includes(minutes)
    ? minutes
    : DEFAULT_AUTOLOCK_MINUTES;

  const meta = await readSessionMeta();
  if (meta !== null) {
    await writeSessionMeta({ ...meta, idleTimeoutMinutes: validated });
  }
  await armAutoLock(validated);
  return { ok: true };
}

// 09-06: delegates directly to server-config.ts (Plan 09-03) -- this
// router never re-derives, caches, or hard-codes the pv-server base URL
// itself, per that module's own standing invariant.
async function handleConfigGet(): Promise<MessageResponseMap["config.get"]> {
  const config = await readServerConfig();
  return config === null ? null : { baseUrl: config.baseUrl };
}

async function handleConfigSet(rawUrl: string): Promise<MessageResponseMap["config.set"]> {
  try {
    await configureServer(rawUrl);
    return { ok: true };
  } catch (e) {
    if (e instanceof InvalidServerUrlError) {
      return { ok: false, error: "invalid-url" };
    }
    // D-11: checked BEFORE the generic ServerUnreachableError arm below --
    // ServerCorsBlockedError is a MORE SPECIFIC subtype of failure (server
    // is up, origin just isn't allowlisted yet), not an alternative to it.
    if (e instanceof ServerCorsBlockedError) {
      return { ok: false, error: "cors-blocked" };
    }
    if (e instanceof ServerUnreachableError) {
      return { ok: false, error: "unreachable" };
    }
    // Neither typed error -- a genuine unexpected failure (e.g. the
    // permissions.request() prompt was dismissed). Surface it as
    // "unreachable" rather than letting the message channel reject, since
    // the popup only has these two typed slots to render (Task 1's
    // response-map contract).
    return { ok: false, error: "unreachable" };
  }
}

// Plan 15-05 (AUTH-04): a PERSIST-FREE sibling of handleConfigSet, mirroring
// its exact error-mapping shape but calling probeServerHealthDetailed()
// directly instead of configureServer() -- no browser.storage.local.set()
// call anywhere in this function or its callees. Exists so
// ServerConfigView's confirm-flow sequencing can validate the NEW server
// BEFORE persisting it, keeping the OLD config live for the sign-out-old-
// session step that must run first (Pitfall 1, 15-RESEARCH.md).
async function handleConfigProbe(rawUrl: string): Promise<MessageResponseMap["config.probe"]> {
  try {
    const normalized = normalizeServerUrl(rawUrl);
    const probeResult = await probeServerHealthDetailed(normalized);
    if (probeResult === "ok") {
      return { ok: true };
    }
    // D-11 (mirrors handleConfigSet): cors-blocked is a MORE SPECIFIC
    // subtype of failure than the generic "unreachable" bucket below.
    if (probeResult === "cors-blocked") {
      return { ok: false, error: "cors-blocked" };
    }
    return { ok: false, error: "unreachable" };
  } catch (e) {
    if (e instanceof InvalidServerUrlError) {
      return { ok: false, error: "invalid-url" };
    }
    return { ok: false, error: "unreachable" };
  }
}
