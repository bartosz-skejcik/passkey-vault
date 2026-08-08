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
import { ensureHydrated } from "./vault-session";
import { encryptItem, encryptItemForCollection } from "../../lib/crypto/wasm-loader";
import { getCollectionKey } from "./collections-store";
import { createItem, updateItem } from "./vault-api";
import {
  RevisionConflictError,
  isConflictError,
  splitCombinedEncryptedItem,
  getItems,
} from "./vault-store";
import type { ItemFields, LoginFields, VaultItem } from "../../lib/vault/types";
import type { MessageResponseMap } from "../../lib/messaging/ext-protocol";

/** Thrown by confirmNewLogin/confirmUpdateLogin when ensureHydrated()
 * resolves null — an absent/idle-killed session (D-02, MV3 idle-kill) —
 * rather than proceeding with an invalid key handle or silently no-op'ing. */
export class LockedVaultError extends Error {
  constructor() {
    super("cannot persist a captured login while the vault is locked");
    this.name = "LockedVaultError";
  }
}

/** WR-04 (11-REVIEW.md): thrown by confirmUpdateLogin when the target
 * `itemId` does not re-verify as belonging to the caller's own
 * (sender-derived) frameOrigin + submitted username. The propose->confirm
 * round trip hands `itemId` back out through the untrusted content-script
 * closure -- this is only as trustworthy as that closure, so confirm must
 * re-derive ownership from scratch rather than trusting the earlier
 * propose's classification, mirroring handleAutofillFill's own
 * itemMatchesOrigin re-check (autofill-match.ts, T-10-14). */
export class OwnershipMismatchError extends Error {
  constructor() {
    super("target item does not belong to the requesting origin/account");
    this.name = "OwnershipMismatchError";
  }
}

/** T-27-18 (27-07-PLAN.md): thrown by confirmUpdateLogin when the target
 * item is collection-scoped and the caller's own `accessLevel` is `"read"`
 * (or an unrecognized/absent-while-scoped value -- fail closed, mirroring
 * `web/src/lib/families/accessLevel.ts`'s own `access.unknown` discipline).
 * Refuses the write BEFORE any encrypt call is made. This is client-side
 * defense-in-depth/UX only -- the server's `Membership<Item, RequireEdit>`
 * extractor (unchanged, SHARE-05) is and remains the real authorization
 * boundary. */
export class ReadOnlyAccessError extends Error {
  constructor() {
    super("cannot save -- you have read-only access to this shared item");
    this.name = "ReadOnlyAccessError";
  }
}

/** T-27-17 (27-07-PLAN.md): thrown by confirmUpdateLogin when the target
 * item is collection-scoped but its Collection Key is not yet cached in
 * collections-store.ts. Mirrors web/src/lib/vault/store.ts's own
 * CollectionKeyUnavailableError (this file's own local class, not imported
 * across the package boundary) -- NEVER fall back to encrypting under the
 * personal User Key in this case; a wrong-key encrypt succeeds silently and
 * corrupts the item for every other collection member on the very next
 * write. */
export class CollectionKeyUnavailableError extends Error {
  constructor(collectionId: string) {
    super(
      `cannot save -- the encryption key for collection ${collectionId} is not available yet; wait a moment and try again`,
    );
    this.name = "CollectionKeyUnavailableError";
  }
}

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

/** Builds the LoginFields object persisted for a captured/updated login —
 * the array form of `urls`, never the legacy singular `url`. `frameOrigin`
 * here must always be the TRUSTED value the caller derived from
 * assertContentSender, never the raw payload field (D-06). */
function buildLoginFields(fields: CaptureSubmitFields): ItemFields {
  let name = fields.frameOrigin;
  try {
    name = new URL(fields.frameOrigin).hostname;
  } catch {
    // frameOrigin didn't parse as a URL — fall back to the raw string.
  }
  return {
    type: "login",
    username: fields.username,
    password: fields.password,
    urls: [fields.frameOrigin],
    notes: "",
    name,
    folderId: null,
    tags: [],
  };
}

/**
 * Encrypts+persists a brand-new login item via the exact
 * encryptItem -> splitCombinedEncryptedItem -> createItem shape
 * web/src/lib/vault/store.ts's createVaultItem already proved correct.
 * Re-reads the unlocked User Key via ensureHydrated() (NEVER
 * getUnlockedUserKey(), which only checks the in-memory cache and returns
 * null on a fresh/idle-killed service worker) — throws LockedVaultError on
 * an absent key rather than proceeding with an invalid handle.
 */
export async function confirmNewLogin(
  fields: CaptureSubmitFields,
): Promise<{ id: string; revision: number }> {
  const uk = await ensureHydrated();
  if (uk === null) {
    throw new LockedVaultError();
  }
  const id = crypto.randomUUID();
  const plaintext = JSON.stringify(buildLoginFields(fields));
  const combined = encryptItem(uk, plaintext, id, 1);
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  const created = await createItem(id, encKey, encData);
  return { id: created.id, revision: created.revision };
}

/**
 * Encrypts+persists an update to an existing login item at
 * currentRevision + 1 — the value the server independently increments to
 * on a successful PUT. A 409 from updateItem throws RevisionConflictError
 * (via the ported isConflictError/RevisionConflictError pattern) instead of
 * silently overwriting (T-11-08). Re-reads the unlocked User Key via
 * ensureHydrated(), same LockedVaultError discipline as confirmNewLogin.
 */
export async function confirmUpdateLogin(
  itemId: string,
  fields: CaptureSubmitFields,
  currentRevision: number,
): Promise<{ id: string; revision: number }> {
  const uk = await ensureHydrated();
  if (uk === null) {
    throw new LockedVaultError();
  }
  // WR-04 (11-REVIEW.md): re-verify ownership from scratch against the
  // CURRENT decrypted cache before writing -- `fields.frameOrigin` here is
  // the TRUSTED sender-derived origin the caller (router.ts) resolved via
  // assertContentSender, never the content script's self-reported payload
  // field (D-06). Refuses an itemId that isn't a login item, doesn't
  // origin-match, or doesn't username-match, exactly like
  // handleAutofillFill's own defense-in-depth re-check.
  const target = getItems().find((item) => item.id === itemId);
  if (target === undefined || target.fields.type !== "login") {
    throw new OwnershipMismatchError();
  }
  if (!itemMatchesOrigin(target, fields.frameOrigin) || target.fields.username !== fields.username) {
    throw new OwnershipMismatchError();
  }
  // T-27-18: the read-only refusal gate -- must run BEFORE plaintext is
  // built or any encrypt call is made. `target.collectionId` is the only
  // source of truth for scope (mirrors web's updateVaultItem, 27-07-PLAN.md
  // `key_links`); a personal item (`collectionId` absent/null) skips this
  // gate entirely and keeps today's unconditional-write behavior. Fails
  // closed on any accessLevel other than "edit"/"hidden_password" -- an
  // unrecognized value is never treated as an implicit grant, mirroring
  // accessLevel.ts's own access.unknown discipline.
  if (
    target.collectionId != null &&
    target.accessLevel !== "edit" &&
    target.accessLevel !== "hidden_password"
  ) {
    throw new ReadOnlyAccessError();
  }
  const newRevision = currentRevision + 1;
  const plaintext = JSON.stringify(buildLoginFields(fields));
  // T-27-17: collection-aware encrypt dispatch, ported from
  // web/src/lib/vault/store.ts's updateVaultItem -- a personal item
  // (`collectionId === null`) uses the existing personal-key encrypt
  // unchanged; a collection-scoped item MUST use its own cached Collection
  // Key, and NEVER falls back to the personal User Key when that key is not
  // yet cached (CollectionKeyUnavailableError, fail loud).
  let combined: string;
  if (target.collectionId == null) {
    combined = encryptItem(uk, plaintext, itemId, newRevision);
  } else {
    const ck = getCollectionKey(target.collectionId);
    if (ck === undefined) {
      throw new CollectionKeyUnavailableError(target.collectionId);
    }
    combined = encryptItemForCollection(ck, plaintext, target.collectionId, itemId, newRevision);
  }
  const { encKey, encData } = splitCombinedEncryptedItem(combined);
  try {
    await updateItem(itemId, encKey, encData, currentRevision);
  } catch (err) {
    if (isConflictError(err)) {
      throw new RevisionConflictError();
    }
    throw err;
  }
  return { id: itemId, revision: newRevision };
}
