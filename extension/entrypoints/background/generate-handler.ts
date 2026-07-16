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

// T-11-01: bounds matching v0.1's own generator UI
// (web/src/components/generator/GeneratorPopover.tsx's CHAR_MIN_LENGTH/
// CHAR_MAX_LENGTH/PASSPHRASE_MIN_WORDS/PASSPHRASE_MAX_WORDS) -- rejecting
// anything outside this range with a typed `{error}` BEFORE calling the
// generator is what prevents an absurd `length`/`wordCount` (e.g. a
// malformed or adversarial request) from driving `generateCharacterPassword`/
// `generatePassphrase`'s O(n) loop into a multi-second-or-worse hang on the
// service worker thread. Neither generator function bounds-checks its own
// input (a length of 0 just returns "" rather than throwing), so this is
// the ONLY place this invariant is enforced.
const CHAR_MIN_LENGTH = 8;
const CHAR_MAX_LENGTH = 64;
const PASSPHRASE_MIN_WORDS = 3;
const PASSPHRASE_MAX_WORDS = 10;

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
        if (
          !Number.isInteger(message.length) ||
          message.length < CHAR_MIN_LENGTH ||
          message.length > CHAR_MAX_LENGTH
        ) {
          return {
            error: `length must be an integer between ${CHAR_MIN_LENGTH} and ${CHAR_MAX_LENGTH}`,
          };
        }
        return { password: generateCharacterPassword(message.length, message.opts) };
      case "passphrase":
        if (
          !Number.isInteger(message.wordCount) ||
          message.wordCount < PASSPHRASE_MIN_WORDS ||
          message.wordCount > PASSPHRASE_MAX_WORDS
        ) {
          return {
            error: `wordCount must be an integer between ${PASSPHRASE_MIN_WORDS} and ${PASSPHRASE_MAX_WORDS}`,
          };
        }
        return { password: generatePassphrase(message.wordCount, message.separator) };
      default:
        return { error: `unrecognized generate-request mode: ${(message as { mode: string }).mode}` };
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "unknown generation error" };
  }
}
