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
// (background.ts's existing spike.roundtrip listener keeps its own copy)
// so this router independently enforces the same control regardless of
// what other listeners exist -- Phase 10 must widen this into an explicit
// allow-list when content scripts legitimately need the background, never
// by deleting the check.
import { browser } from "wxt/browser";
import type { Message, MessageResponseMap } from "../../lib/messaging/ext-protocol";
import { ensureHydrated, noteActivity } from "./vault-session";
import { armAutoLock } from "./autolock";
import { readSessionMeta } from "./session-storage";
import {
  handleUnlockPassword,
  handleUnlockPrfStart,
  handleUnlockPrfFinish,
  handleSignInPrfStart,
  handleSignInPrfFinish,
} from "./unlock";
import { getItems, getFolders } from "./vault-store";
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

    void noteActivity(); // re-arm auto-lock on any popup activity; no-op if locked
    void handle(message).then(sendResponse);
    return true; // keep the message channel open for the async sendResponse
  });
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
    kind === "unlock.prf.start" ||
    kind === "unlock.prf.finish" ||
    kind === "auth.signIn.password" ||
    kind === "auth.signIn.prf.start" ||
    kind === "auth.signIn.prf.finish" ||
    kind === "vault.list" ||
    kind === "extPasskey.enroll.start" ||
    kind === "extPasskey.enroll.finish" ||
    kind === "extPasskey.suppressPrompt" ||
    kind === "unlock.extPrf.start" ||
    kind === "unlock.extPrf.finish" ||
    kind === "config.get" ||
    kind === "config.set"
  );
}

async function handle(message: Message): Promise<unknown> {
  switch (message.kind) {
    case "session.status":
      return getSessionStatus();
    case "session.setAutoLockMinutes":
      return setAutoLockMinutes(message.minutes);
    case "unlock.password":
      return handleUnlockPassword(message.passwordBytes);
    case "unlock.prf.start":
      return handleUnlockPrfStart();
    case "unlock.prf.finish":
      return handleUnlockPrfFinish({
        stateId: message.stateId,
        credentialJson: message.credentialJson,
        prfBytes: message.prfBytes,
      });
    case "auth.signIn.password":
      return handleUnlockPassword(message.passwordBytes, message.email);
    case "auth.signIn.prf.start":
      return handleSignInPrfStart(message.email);
    case "auth.signIn.prf.finish":
      return handleSignInPrfFinish({
        stateId: message.stateId,
        email: message.email,
        credentialJson: message.credentialJson,
        prfBytes: message.prfBytes,
      });
    case "vault.list":
      return { items: getItems(), folders: getFolders() };
    case "extPasskey.enroll.start":
      return handleExtEnrollStart();
    case "extPasskey.enroll.finish":
      return handleExtEnrollFinish({
        credentialIdB64url: message.credentialIdB64url,
        prfSaltB64: message.prfSaltB64,
        prfBytes: message.prfBytes,
      });
    case "extPasskey.suppressPrompt":
      return setExtPasskeyPromptSuppressed(message.suppress).then(() => ({ ok: true as const }));
    case "unlock.extPrf.start":
      return handleExtPrfUnlockStart();
    case "unlock.extPrf.finish":
      return handleExtPrfUnlockFinish({
        credentialIdB64url: message.credentialIdB64url,
        prfBytes: message.prfBytes,
      });
    case "config.get":
      return handleConfigGet();
    case "config.set":
      return handleConfigSet(message.rawUrl);
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
  // validated against AUTOLOCK_OPTIONS whitelist inside autolock.ts; re-arm immediately
  await armAutoLock(minutes);
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
