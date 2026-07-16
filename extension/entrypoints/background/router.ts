// entrypoints/background/router.ts — the typed browser.runtime.onMessage
// dispatch table for the ext-protocol.ts message contract. This grows
// across Waves 3-5 (each adds its own `case` + import) -- 09-04 adds
// `unlock.*` AND `auth.signIn.*` kinds, 09-05 adds `vault.list`, 09-08 adds
// `extPasskey.*`/`unlock.extPrf.*` kinds (09-CONTEXT AMENDMENT 2026-07-15),
// 09-06 adds `config.get`/`config.set` -- by adding a case to the switch
// below, never by restructuring this shape.
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
import { browser } from "wxt/browser";
import type { Message, MessageOf, MessageResponseMap } from "../../lib/messaging/ext-protocol";
import { b64ToBytes } from "../../lib/messaging/bytes-b64";
import { assertPopupSender, type MessageSender } from "./frame-guard";
import { ensureHydrated, noteActivity } from "./vault-session";
import { armAutoLock, AUTOLOCK_OPTIONS, DEFAULT_AUTOLOCK_MINUTES } from "./autolock";
import { readSessionMeta, writeSessionMeta } from "./session-storage";
import { handleUnlockPassword } from "./unlock";
import { getItems, getFolders, RevisionConflictError } from "./vault-store";
import { handleAutofillFill, handleAutofillMatch, handleAutofillTotpCode } from "./autofill-match";
import { handleFillFrame, handleMatchFrame, assertContentSender } from "./autofill-frame";
import { handleGenerateRequest } from "./generate-handler";
import {
  classifySubmit,
  confirmNewLogin,
  confirmUpdateLogin,
  LockedVaultError,
  OwnershipMismatchError,
} from "./capture-handler";
import {
  handleExtEnrollStart,
  handleExtEnrollFinish,
  handleExtPrfUnlockStart,
  handleExtPrfUnlockFinish,
  hasEnrolledExtPasskey,
  readExtPasskeyPromptSuppressed,
  setExtPasskeyPromptSuppressed,
} from "./ext-passkey";
import {
  readServerConfig,
  configureServer,
  InvalidServerUrlError,
  ServerUnreachableError,
} from "./server-config";

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
  | MessageOf<"capture.confirm"> {
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
    kind === "capture.confirm"
  );
}

async function handleContentFrameMessage(
  message:
    | MessageOf<"autofill.matchFrame">
    | MessageOf<"autofill.fillFrame">
    | MessageOf<"generate-request">
    | MessageOf<"capture.propose">
    | MessageOf<"capture.confirm">,
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
    default:
      throw new Error(`unhandled content-frame message kind: ${(message as { kind: string }).kind}`);
  }
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
  // WR-03 (11-REVIEW.md): ensure the decrypted item cache is hydrated
  // BEFORE classifying -- a freshly-woken/idle-killed service worker starts
  // with an empty in-memory vault-store cache (ensureHydrated() only
  // re-derives the User Key itself; it does not by itself repopulate
  // vault-store's items array). Classifying against an empty cache would
  // misreport an existing credential as 'new', and confirmNewLogin (which
  // DOES gate on ensureHydrated()) would then create a duplicate item.
  // Mirrors handleMatchFrame's/handleFillFrame's own ensureHydrated()-
  // before-getItems() discipline (autofill-frame.ts).
  const uk = await ensureHydrated();
  if (uk === null) {
    // Locked: no legitimate classification is possible. There is no
    // dedicated "locked" action in MessageResponseMap["capture.propose"]
    // (frozen by Plan 11-01) -- 'no-op' with mismatch:true is the least-
    // surprising fail-closed choice, mirroring the rejected-sender branch
    // above.
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
    kind === "auth.signIn.password" ||
    kind === "vault.list" ||
    kind === "extPasskey.enroll.start" ||
    kind === "extPasskey.enroll.finish" ||
    kind === "extPasskey.suppressPrompt" ||
    kind === "unlock.extPrf.start" ||
    kind === "unlock.extPrf.finish" ||
    kind === "config.get" ||
    kind === "config.set" ||
    kind === "autofill.match" ||
    kind === "autofill.fill" ||
    kind === "autofill.totpCode"
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
    case "auth.signIn.password":
      return handleUnlockPassword(b64ToBytes(message.passwordB64), message.email);
    case "vault.list":
      return { items: getItems(), folders: getFolders() };
    case "extPasskey.enroll.start":
      return handleExtEnrollStart();
    case "extPasskey.enroll.finish":
      return handleExtEnrollFinish({
        credentialIdB64url: message.credentialIdB64url,
        prfSaltB64: message.prfSaltB64,
        prfBytes: b64ToBytes(message.prfB64).buffer as ArrayBuffer,
      });
    case "extPasskey.suppressPrompt":
      return setExtPasskeyPromptSuppressed(message.suppress).then(() => ({ ok: true as const }));
    case "unlock.extPrf.start":
      return handleExtPrfUnlockStart();
    case "unlock.extPrf.finish":
      return handleExtPrfUnlockFinish({
        credentialIdB64url: message.credentialIdB64url,
        prfBytes: b64ToBytes(message.prfB64).buffer as ArrayBuffer,
      });
    case "config.get":
      return handleConfigGet();
    case "config.set":
      return handleConfigSet(message.rawUrl);
    case "autofill.match":
      return handleAutofillMatch(sender);
    case "autofill.fill":
      return handleAutofillFill(message, sender);
    case "autofill.totpCode":
      return handleAutofillTotpCode(message, sender);
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
// 09-08: enriched with extPasskeyEnrolled/extPasskeyPromptSuppressed so
// 09-06's popup can gate the PRF button + enrollment prompt purely off this
// ONE status call, no parallel status kind (09-CONTEXT AMENDMENT 2026-07-15).
async function getSessionStatus(): Promise<MessageResponseMap["session.status"]> {
  const meta = await readSessionMeta();
  if (meta === null) {
    return { kind: "no-session" };
  }
  const [uk, extPasskeyEnrolled, extPasskeyPromptSuppressed] = await Promise.all([
    ensureHydrated(),
    hasEnrolledExtPasskey(),
    readExtPasskeyPromptSuppressed(),
  ]);
  if (uk === null) {
    return {
      kind: "locked",
      wasAutoLocked: meta.wasAutoLocked,
      autoLockMinutes: meta.idleTimeoutMinutes,
      extPasskeyEnrolled,
      extPasskeyPromptSuppressed,
    };
  }
  return {
    kind: "unlocked",
    autoLockMinutes: meta.idleTimeoutMinutes,
    accountEmail: meta.accountEmail,
    extPasskeyEnrolled,
    extPasskeyPromptSuppressed,
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
