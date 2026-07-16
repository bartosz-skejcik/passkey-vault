// entrypoints/background/capture-handler.ts — plan 11-03's background-side
// brain of Generate & Capture: classify a proposed submit against the
// already-decrypted vault (new / update / no-op), independently verify the
// frame-vs-top origin relationship, and (Task 2) encrypt-then-persist the
// resulting login item using the exact pattern web/src/lib/vault/store.ts
// already proved correct (D-01/D-09 — no second, parallel crypto or
// persistence path).
//
// classifySubmit is a PURE function — no `await`, no chrome.storage read.
// senderTopOrigin is passed in as a plain string parameter; the actual
// extraction of the trusted top origin from runtime.onMessage's sender
// argument happens in registerAutofillFrameChannel()'s router.ts
// registration, keeping this function framework-free and directly
// unit-testable (Task 1's own <action> instruction). mismatch is computed
// by DIRECT string comparison inside classifySubmit on every action branch
// — never passed through from an upstream flag a caller could have gotten
// wrong (D-06).
//
// Origin-matching reuses itemMatchesOrigin() (frame-guard.ts) — the exact
// scheme+host+port origin-equality gate T-10-05 already established — never
// a second, re-derived `new URL(...).origin` comparison. Only the
// ADDITIONAL username-equality check is layered on top here (this plan's
// resolved answer to CONTEXT.md's fuzzy-vs-exact discretion call: exact
// origin + exact username is the safer default for a security-sensitive
// match).
import { itemMatchesOrigin } from "./frame-guard";
import type { LoginFields, VaultItem } from "../../lib/vault/types";
import type { MessageResponseMap } from "../../lib/messaging/ext-protocol";

export interface CaptureSubmitFields {
  frameOrigin: string;
  username: string;
  password: string;
}

/**
 * Classifies a proposed submit against the already-decrypted vault:
 *  - 'new' when no login-type item both origin-matches `frameOrigin` (via
 *    itemMatchesOrigin()) AND has a username equal to the submitted one.
 *  - 'update' when a match exists and its stored password differs from the
 *    submitted password.
 *  - 'no-op' when a match exists and the stored password is IDENTICAL to
 *    the submitted password (Pitfall B — an unchanged resubmit is never
 *    offered as an update).
 *
 * `mismatch` is true whenever `frameOrigin !== senderTopOrigin`, computed
 * here by direct string comparison on every action branch — never trusted
 * from an upstream flag (D-06).
 */
export function classifySubmit(
  fields: CaptureSubmitFields,
  decryptedItems: VaultItem[],
  senderTopOrigin: string,
): MessageResponseMap["capture.propose"] {
  const { frameOrigin, username, password } = fields;
  const mismatch = frameOrigin !== senderTopOrigin;

  const match = decryptedItems.find(
    (item): item is VaultItem & { fields: LoginFields } =>
      item.fields.type === "login" &&
      itemMatchesOrigin(item, frameOrigin) &&
      item.fields.username === username,
  );

  if (match === undefined) {
    return { action: "new", frameOrigin, topOrigin: senderTopOrigin, mismatch };
  }

  if (match.fields.password === password) {
    return { action: "no-op", frameOrigin, topOrigin: senderTopOrigin, mismatch };
  }

  return {
    action: "update",
    itemId: match.id,
    currentRevision: match.revision,
    frameOrigin,
    topOrigin: senderTopOrigin,
    mismatch,
  };
}
