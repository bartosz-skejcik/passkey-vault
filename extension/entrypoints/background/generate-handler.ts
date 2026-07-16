// entrypoints/background/generate-handler.ts — plan 11-01's Task 3: the
// content-frame handler for `generate-request` (ext-protocol.ts, Task 1).
// Dispatched by the SAME SEPARATE `registerAutofillFrameChannel()`
// listener in router.ts that already carries `autofill.matchFrame`/
// `autofill.fillFrame` (Phase 10) -- never the popup router's `handle()`/
// `isProtocolMessage()` switch, since a content script's own generate
// popover (Plan 11-04) is this kind's only legitimate caller.
//
// This is a PURE, SYNCHRONOUS dispatcher -- no `await`, no
// `chrome.storage.session` read, no vault/key material of any kind. That
// is a deliberate invariant, not an oversight: RESEARCH.md's explicit
// finding is that password/passphrase generation needs no unlocked User
// Key, so this handler must never gain one. Reviewers: if a future change
// adds an `await` here, re-read that finding first.
import { assertContentSender } from "./autofill-frame";
import type { MessageSender } from "./frame-guard";
import { generateCharacterPassword, generatePassphrase } from "../../lib/generator/password";
import type { MessageOf, MessageResponseMap } from "../../lib/messaging/ext-protocol";

/**
 * T-11-01/T-11-02 (this plan's threat_model): a malformed `mode`, an
 * out-of-range `length`/`wordCount`, or an unselected character-class
 * combination must never crash the router or leak the generated password
 * anywhere but the typed `{password}` response -- every failure path below
 * returns a typed `{error}` instead of throwing or logging the result.
 */
export function handleGenerateRequest(
  message: MessageOf<"generate-request">,
  sender: MessageSender,
): MessageResponseMap["generate-request"] {
  const guard = assertContentSender(sender);
  if (!guard.ok) {
    return { error: "forbidden-sender" };
  }

  try {
    switch (message.mode) {
      case "character":
        return { password: generateCharacterPassword(message.length, message.opts) };
      case "passphrase":
        return { password: generatePassphrase(message.wordCount, message.separator) };
      default:
        return { error: `unrecognized generate-request mode: ${(message as { mode: string }).mode}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "unknown generation error" };
  }
}
