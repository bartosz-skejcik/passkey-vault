// entrypoints/background/router.ts — the typed browser.runtime.onMessage
// dispatch table for the ext-protocol.ts message contract. This grows
// across Waves 3-5 (each adds its own `case` + import) -- 09-04 adds
// `unlock.*` AND `auth.signIn.*` kinds, 09-05 adds `vault.list` -- by
// adding a case to the switch below, never by restructuring this shape.
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
    kind === "auth.signIn.prf.finish"
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
    default:
      throw new Error(`unhandled message kind: ${(message as { kind: string }).kind}`);
    // 09-05-PLAN.md adds: case "vault.list":
  }
}

// REVISED for the Blocker-2 fix: session.status is keyed off
// session-storage.ts's lock-surviving session-meta record, NOT the key
// envelope -- a present meta record with no key material is exactly what
// "locked" (as opposed to "no-session") means now that lockVaultSession()
// no longer deletes the meta record.
async function getSessionStatus(): Promise<MessageResponseMap["session.status"]> {
  const meta = await readSessionMeta();
  if (meta === null) {
    return { kind: "no-session" };
  }
  const uk = await ensureHydrated();
  if (uk === null) {
    return { kind: "locked", wasAutoLocked: meta.wasAutoLocked, autoLockMinutes: meta.idleTimeoutMinutes };
  }
  return {
    kind: "unlocked",
    autoLockMinutes: meta.idleTimeoutMinutes,
    accountEmail: meta.accountEmail,
  };
}

async function setAutoLockMinutes(minutes: number): Promise<{ ok: true }> {
  // validated against AUTOLOCK_OPTIONS whitelist inside autolock.ts; re-arm immediately
  await armAutoLock(minutes);
  return { ok: true };
}
