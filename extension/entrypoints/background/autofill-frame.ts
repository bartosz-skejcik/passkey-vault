// entrypoints/background/autofill-frame.ts — plan 10-09's content-relay <->
// background channel: the security-critical half of the in-page overlay
// (plan 10-10 is pure UI on top of this). Dispatched by a SEPARATE
// `browser.runtime.onMessage` listener -- `registerAutofillFrameChannel()`
// in router.ts -- from the popup router's `handle()`. This is deliberate,
// not an oversight: `registerMessageRouter()`'s WR-01 addListener-level gate
// (`sender.url?.startsWith(ownOrigin)`) drops every content-script message
// before it ever reaches the popup-privilege tier (`session.*`/`vault.*`).
// Weakening that gate to admit content-script senders would open the
// popup's entire surface -- including session/vault operations -- to any
// page's content script. Instead, this file's two handlers are reached
// ONLY through the new, narrowly-scoped listener, and every entry point
// below re-derives its own trust decision from platform-provided data.
//
// Why this is safe (10-09-PLAN.md's architecture_note, restated here so a
// reviewer does not have to cross-reference the plan):
//  - `assertContentSender(sender)` passes only when `sender.id ===
//    browser.runtime.id` AND `sender.tab` is defined (a real tab/
//    content-script sender, never a popup/options document) AND
//    `originFromContentSender(sender)` parses to a non-null origin. A web
//    page cannot forge `sender.id`/`sender.tab`/`sender.origin` -- they are
//    platform-provided, exactly like `assertPopupSender`'s own inputs
//    (frame-guard.ts).
//  - `handleMatchFrame` runs the SAME `itemMatchesOrigin` gate
//    (frame-guard.ts, unmodified) against the SENDER'S OWN origin, so
//    evil.com's content script can only ever learn about items the user
//    saved FOR evil.com -- metadata only (label + masked hint), never a
//    secret. Standard password-manager model; no cross-origin data crosses.
//  - `handleFillFrame` addresses the fill to `{ tabId: sender.tab.id,
//    frameId: sender.frameId }` (both derived from the platform-provided
//    sender via `assertContentSender`, never from the request payload) and
//    re-verifies `itemMatchesOrigin(item, senderOrigin)` before dispatching
//    `content.fill`. A content script cannot name a different frame or a
//    different origin -- there is no field in either request shape
//    (ext-protocol.ts's `autofill.matchFrame`/`autofill.fillFrame`) for a
//    caller to smuggle one in through.
//  - The overlay showing available accounts on page load is NOT
//    gesture-gated (Bartek's approved relaxation, matching NordPass/
//    1Password/Chrome); the FILL still requires the user's click, which is
//    what drives `handleFillFrame`.
//
// Reuses autofill-match.ts's exported EMPTY_DETECTED/asFillKind/
// maskedHintFor/buildFillValues (the exact same decrypt/lookup/derive
// logic the popup-driven channel uses) rather than duplicating them, and
// frame-guard.ts's originFromContentSender/itemMatchesOrigin (the same
// pure origin/frame access-control gate both channels share).
import { browser } from "wxt/browser";
import { itemMatchesOrigin, originFromContentSender, type MessageSender } from "./frame-guard";
import { ensureHydrated } from "./vault-session";
import { getItems, touchVaultItem } from "./vault-store";
import { EMPTY_DETECTED, asFillKind, buildFillValues, maskedHintFor } from "./autofill-match";
import type { AutofillMatch, ContentFillRequest, ContentFillResponse } from "../../lib/autofill/types";
import type { MessageOf, MessageResponseMap } from "../../lib/messaging/ext-protocol";

/**
 * The single guard for this whole channel. Returns the resolved origin/
 * tabId/frameId so `handleMatchFrame`/`handleFillFrame` never re-derive
 * them or fall back to trusting anything on the message payload. Refuses:
 *  - a foreign extension id (`sender.id !== browser.runtime.id`)
 *  - a popup/options sender (`sender.tab === undefined` -- this channel is
 *    content-script-only; a popup-tier caller uses `autofill.match`/
 *    `autofill.fill` instead, dispatched by the OTHER listener)
 *  - a sender whose origin cannot be resolved at all (neither
 *    `sender.origin` nor a parseable `sender.url` -- `originFromContentSender`
 *    returns null rather than guessing; treated here as "no origin", never
 *    "same origin")
 * `sender.frameId` defaults to 0 (top-level frame) only when the platform
 * omits it entirely -- a real content-script sender always reports a
 * concrete numeric frameId in every browser this extension targets.
 */
export function assertContentSender(
  sender: MessageSender,
): { ok: true; origin: string; tabId: number; frameId: number } | { ok: false } {
  if (sender.id !== browser.runtime.id) {
    return { ok: false };
  }
  if (sender.tab === undefined || sender.tab.id === undefined) {
    return { ok: false };
  }
  const origin = originFromContentSender(sender);
  if (origin === null) {
    return { ok: false };
  }
  return {
    ok: true,
    origin,
    tabId: sender.tab.id,
    frameId: sender.frameId ?? 0,
  };
}

/**
 * Content-relay -> background. Metadata-only, exactly like
 * `handleAutofillMatch` (autofill-match.ts) -- never a field value, never a
 * derived secret. The `detected` map comes from the REQUEST (the caller's
 * own frame already computed it locally via `detectAll`, no
 * `content.detect` round-trip back into the same frame needed), but the
 * origin ALWAYS comes from `assertContentSender(sender)` -- the request
 * shape (`autofill.matchFrame`, ext-protocol.ts) carries no origin field at
 * all, so there is nothing on the payload for a caller to spoof even in
 * principle; this is enforced by construction, not by an extra check.
 */
export async function handleMatchFrame(
  message: MessageOf<"autofill.matchFrame">,
  sender: MessageSender,
): Promise<MessageResponseMap["autofill.matchFrame"]> {
  const guard = assertContentSender(sender);
  if (!guard.ok) {
    return { pageState: "restricted", origin: null, detected: EMPTY_DETECTED, matches: [] };
  }

  const uk = await ensureHydrated();
  if (uk === null) {
    // Locked: fail closed with an empty result, mirroring
    // handleAutofillMatch's own locked branch (autofill-match.ts).
    return { pageState: "ok", origin: guard.origin, detected: EMPTY_DETECTED, matches: [] };
  }

  const matches: AutofillMatch[] = [];
  for (const item of getItems()) {
    const kind = asFillKind(item.fields.type);
    if (kind === null) {
      continue; // "note" -- no fill target
    }
    if (!message.detected[kind]) {
      continue; // the caller's own frame didn't detect a matching field family
    }
    if (!itemMatchesOrigin(item, guard.origin)) {
      continue; // T-10-03/T-10-05: exact-origin gate, no cross-origin leakage
    }
    matches.push({ itemId: item.id, kind, label: item.fields.name, maskedHint: maskedHintFor(item) });
  }

  return { pageState: "ok", origin: guard.origin, detected: message.detected, matches };
}

/**
 * Content-relay -> background. Re-derives the sender's origin/tabId/frameId
 * from scratch via `assertContentSender` -- never trusts an earlier
 * `autofill.matchFrame` call's decision (TOCTOU defense, same pattern as
 * `handleAutofillFill`'s fresh-resolve-per-call). An `itemId` is never
 * trusted in isolation: it must belong to an item that (a) is the requested
 * `kind_` and (b) matches the freshly-resolved sender origin. The response
 * is value-free by shape (`MessageResponseMap`) -- plaintext crosses to the
 * content-relay only, addressed to the exact `{ tabId, frameId }` the
 * platform reported for THIS sender, never broadcast to the tab and never
 * a frame the caller named itself.
 */
export async function handleFillFrame(
  message: MessageOf<"autofill.fillFrame">,
  sender: MessageSender,
): Promise<MessageResponseMap["autofill.fillFrame"]> {
  const guard = assertContentSender(sender);
  if (!guard.ok) {
    return { ok: false, reason: "target-unreachable" };
  }

  const uk = await ensureHydrated();
  if (uk === null) {
    return { ok: false, reason: "locked" };
  }

  const item = getItems().find((candidate) => candidate.id === message.itemId);
  if (item === undefined || item.fields.type !== message.kind_) {
    return { ok: false, reason: "no-match" };
  }
  if (!itemMatchesOrigin(item, guard.origin)) {
    return { ok: false, reason: "origin-mismatch" };
  }

  const values = buildFillValues(item);
  if (values === null) {
    return { ok: false, reason: "no-match" };
  }

  try {
    const ack = (await browser.tabs.sendMessage(
      guard.tabId,
      { kind: "content.fill", values } satisfies ContentFillRequest,
      { frameId: guard.frameId },
    )) as ContentFillResponse | undefined;
    if (ack?.ok !== true) {
      return { ok: false, reason: "target-unreachable" };
    }
    // NordPass-style last-used tracking (quick-260717): a successful
    // in-page overlay fill is a "use" of the item's secret, same as
    // handleAutofillFill's popup-driven counterpart.
    touchVaultItem(item.id);
    return { ok: true };
  } catch {
    return { ok: false, reason: "target-unreachable" };
  }
}
