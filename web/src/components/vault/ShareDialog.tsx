"use client";

// ShareDialog — D-1's single dialog for both real Share entry points
// (26-UI-SPEC.md's E3/E4): a personal item's contextual Share action, and
// Sidebar's folder-level "+ Nowy udostępniony folder" / existing-folder
// "Udostępnij ten folder" actions. Two variants (`scope.kind`), ONE
// `DialogState` machine inside ONE 400px modal card — same shape as
// `RemoveMemberDialog.tsx`/`DeleteAccountDialog.tsx` (this codebase's ONE
// standing dialog shell), never a second stacked overlay for the
// hidden-password sub-step (D-2/E4: it gets its own `DialogState` value,
// `"hidden-password-ack"`, rendered inside the SAME card).
//
// D-2/UX-03 is this dialog's sharpest honesty requirement (SC 2): hidden-
// password is an INTERFACE protection only — a recipient with access still
// holds the key and can technically recover the password. The blocking
// modal (`share.hiddenPasswordDisclosureTitle/Body/Ack`) shows exactly ONCE
// per account (tracked via a non-sensitive, per-account `localStorage` flag
// — Phase-Specific Notes §3: "a UX memory, not an access control"), then
// every later selection shows only the quiet `share.hiddenPasswordInlineNote`.
//
// Item-variant crypto (SHARE-02): seals the item's OWN existing Cipher Key
// (never a freshly-generated one — this is the SAME `enc_key` the owner
// already decrypts under their own UserKey) to each selected recipient's
// published identity public key, via the new `sealItemKeyForRecipient`
// primitive this plan adds (see SUMMARY.md's Deviations — pv-wasm had no
// existing binding for "unwrap a personal item's key, then seal it to a
// SPECIFIC recipient", only the collection-key sealing/generation shapes).
// That crypto composition is extracted into the EXPORTED
// `shareItemWithRecipients` below specifically so
// `ShareDialog.real-wasm.test.ts` exercises the EXACT sequence this
// component runs, not a re-implementation of it (this codebase's own
// standing hazard: a test that re-derives the composition it's supposed to
// be proving keeps passing even after the real implementation drifts).
//
// Folder-variant crypto (SHARE-01): mirrors `families/rekey.ts`'s proven
// `WasmCollectionKey.generate()` + `sealCollectionKey` shape exactly —
// sealed once to the caller's own identity key (so the creator can read
// their own new folder back, matching `ensureOwnIdentityKeypair`'s existing
// discipline) and once per selected recipient. Optionally seeded from an
// existing personal folder (Sidebar's "Share this folder" action, E2): every
// item in that folder is decrypted under the caller's OWN UserKey (it is
// personal, `collection_id IS NULL`) and re-encrypted under the BRAND-NEW
// CollectionKey, then bulk-moved via `moveItemToCollection` — mirroring
// `store.ts::updateVaultItem`'s own encrypt-then-expected-revision pattern
// (AAD revision = the item's revision AFTER the move; `expected_revision`
// sent to the server = the CURRENT, pre-move revision).
//
// Family-wide crypto (FSH-01, 30-08 + 30-12): a family-wide share is always
// COLLECTION-scoped, never a per-recipient `item_shares` row — that is what
// lets a LATER joiner read it (a direct share can only name recipients who
// exist at share time). A family-wide FOLDER creates a fresh
// `family_wide_kind: 'folder'` collection; a family-wide BARE ITEM is moved
// into the ONE per-family `family_wide_kind: 'item_bucket'` collection,
// lazily auto-created on first use and kept singular by 30-01's
// `idx_one_item_bucket_per_family` partial unique index (a racing second
// create 409s server-side and the loser adopts the winner's bucket). Both
// paths then run the SAME `grantCollectionToRecipients` loop, and the item
// path reuses the folder variant's seed-move re-encryption sequence verbatim
// rather than carrying a second implementation of it.
import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { getFamilyMembers, type FamilyMemberRecord } from "@/lib/families/api";
import { getFamilyWidePendingSnapshot } from "@/lib/families/familyWidePending";
import { accessLevelKey } from "@/lib/families/accessLevel";
import {
  createCollection,
  moveItemToCollection,
  listItems,
  listCollections,
  createItemShare,
  addCollectionMember,
  getCollectionAccessList,
  type CollectionRow,
} from "@/lib/vault/api";
import { getItems, getFolders } from "@/lib/vault/store";
import { refreshCollectionsNow } from "@/lib/vault/collections";
import type { VaultItem } from "@/lib/vault/types";
import {
  getUnlockedUserKey,
  initCrypto,
  decryptItem,
  encryptItemForCollection,
  sealCollectionKey,
  unsealCollectionKey,
  sealItemKeyForRecipient,
  WasmCollectionKey,
  WasmIdentityPublicKey,
  type WasmUserKey,
} from "@/lib/crypto";
import { ensureOwnIdentityKeypair } from "@/lib/identity/ensure";
import { base64Decode, me } from "@/lib/auth/api";

export type ShareDialogScope =
  | { kind: "item"; item: VaultItem }
  | { kind: "folder"; existingFolderId: string | null };

/** CR-01: the honest outcome of ONE submit attempt. Both variants return
 * this same shape so `handleSubmit` can tell "nothing committed, safe to
 * report total failure" apart from "some grants landed, report exactly which
 * ones didn't" without inspecting variant-specific state. */
interface SubmitOutcome {
  /** Labels (email, or user id when unknown) of recipients that did NOT end
   * up holding a grant after this attempt. */
  failedRecipients: string[];
  /** Seed items that failed to move into the new shared folder (folder
   * variant only; always 0 for the item variant). */
  seedMoveFailures: number;
  /** `true` when at least one durable server-side mutation landed during
   * this attempt (any grant, or the collection itself). Drives the
   * total-failure-vs-partial-failure copy split. */
  committedAnything: boolean;
}

type DialogState = "loading-recipients" | "populated" | "hidden-password-ack" | "sharing";

const ACCESS_LEVEL_VALUES = ["read", "edit", "hidden_password"] as const;
type AccessLevelValue = (typeof ACCESS_LEVEL_VALUES)[number];

const HIDDEN_PASSWORD_ACK_KEY_PREFIX = "pv-hidden-password-ack:";

function hiddenPasswordAckStorageKey(accountId: string): string {
  return `${HIDDEN_PASSWORD_ACK_KEY_PREFIX}${accountId}`;
}

/** Phase-Specific Notes §3: this flag is a UX memory, not a security
 * control — losing it (private browsing, cleared profile, new device) only
 * means the one-time disclosure modal reappears once more, never a
 * regression. Guarded against `localStorage` being unavailable for the same
 * reason. */
function hasAcknowledgedHiddenPassword(accountId: string): boolean {
  try {
    return localStorage.getItem(hiddenPasswordAckStorageKey(accountId)) === "1";
  } catch {
    return false;
  }
}

function setAcknowledgedHiddenPassword(accountId: string): void {
  try {
    localStorage.setItem(hiddenPasswordAckStorageKey(accountId), "1");
  } catch {
    // localStorage unavailable — the modal simply reappears next time.
  }
}

/** Recombines a server row's separate enc_key/enc_data strings into the
 * single combined JSON string `decryptItem` expects — this file's own copy
 * of the established per-file-owns-its-own-tiny-helper convention
 * (`RemoveMemberDialog.tsx`/`rekey.real-wasm.test.ts` both carry an
 * identical local copy rather than a shared export). */
function recombineEncryptedItem(encKey: string, encData: string): string {
  return JSON.stringify({
    enc_key: JSON.parse(encKey) as unknown,
    enc_data: JSON.parse(encData) as unknown,
  });
}

/** Inverse of `recombineEncryptedItem`: splits `encryptItemForCollection`'s
 * combined output back into the two enc_key/enc_data sub-fields the wire
 * (and `moveItemToCollection`'s own signature) expects. */
function splitCombinedEncryptedItem(combinedJson: string): { encKey: string; encData: string } {
  const combined = JSON.parse(combinedJson) as { enc_key: unknown; enc_data: unknown };
  return { encKey: JSON.stringify(combined.enc_key), encData: JSON.stringify(combined.enc_data) };
}

/** T-25-16 discipline (mirrors `families/rekey.ts::buildMemberRemovalBatch`
 * exactly): a selected recipient with no published public key throws —
 * never silently dropped from the share, which would be a partial, silently
 * incomplete grant the owner believes succeeded in full. Runs to completion
 * BEFORE any network call below, so a bad recipient never leaves a
 * partially-shared item/folder behind. */
function assertRecipientsHavePublicKeys(
  recipients: { user_id: string; public_key: string | null }[],
): void {
  for (const r of recipients) {
    if (r.public_key === null || r.public_key === undefined || r.public_key === "") {
      throw new Error(`cannot share — recipient ${r.user_id} has no published public key`);
    }
  }
}

/** Structural (duck-typed) 409 check — deliberately NOT an
 * `instanceof ApiClientError`, mirroring `store.ts`'s own `isConflictError`
 * and its module-identity rationale (this module is re-imported under a
 * fresh module instance by `vi.resetModules()`-style tests, which would make
 * a top-level class reference a different object than the one a mock
 * rejection was constructed with). */
function isConflictError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    (err as { status: unknown }).status === 409
  );
}

/** 30-08's family-wide recipient rule, extracted so 30-12's item-variant
 * branch applies the IDENTICAL rule rather than re-deriving it: a current
 * member with no published public key is OMITTED from a family-wide
 * creation-time grant (never thrown on — see `submitFolderVariant`'s
 * `isFamilyWide` doc comment for why this deliberately diverges from
 * T-25-16's throw for an explicitly-picked recipient) and is picked up later
 * by the same lazy-reseal trigger a gap-window invitee already uses. */
function withPublishedPublicKey<T extends { public_key: string | null }>(recipients: T[]): T[] {
  return recipients.filter(
    (r) => r.public_key !== null && r.public_key !== undefined && r.public_key !== "",
  );
}

/** LOCKED decision 3 (260812-01e Task 5, plan-check B-5): stop treating
 * EVERY 409 from `addCollectionMember` as success. Face 2's second half was
 * exactly this unconditional swallow -- a conflict against some OTHER
 * pre-existing grant (e.g. a stale row at a different level, from before
 * per-level buckets existed) silently reported success without checking
 * what the recipient ACTUALLY ended up holding. On a 409, fetches the
 * collection's real access list and checks whether the recipient's ACTUAL
 * persisted `access_level` equals `intendedLevel` OR `"edit"` (LOCKED
 * decision 1's contributor asymmetry is always sufficient as a ceiling —
 * `edit` never represents "less" than any declared level). A failure from
 * THIS check itself (network, parse) fails CLOSED — never silently trusts
 * the original 409 when this verification cannot complete. */
async function recipientAlreadyHoldsIntendedLevel(
  collectionId: string,
  recipientUserId: string,
  intendedLevel: string,
): Promise<boolean> {
  try {
    const accessList = await getCollectionAccessList(collectionId);
    const entry = accessList.find((a) => a.user_id === recipientUserId);
    return entry !== undefined && (entry.access_level === intendedLevel || entry.access_level === "edit");
  } catch (err) {
    console.error(
      `pv: failed to verify recipient ${recipientUserId}'s actual access on collection ${collectionId} after a 409`,
      err,
    );
    return false;
  }
}

/** The per-recipient collection-grant loop, shared by BOTH family-wide call
 * sites (`submitFolderVariant`'s new-folder branch and 30-12's item-bucket
 * branch) so the two can never drift — one 409 policy, one failure-label
 * rule, one WASM-handle-freeing discipline. A 409 no longer means
 * unconditional success (260812-01e Task 5, see
 * `recipientAlreadyHoldsIntendedLevel` above) — it means this recipient
 * MIGHT already hold this collection grant at the intended level (a
 * previous attempt's partial success, the case that makes a retry
 * idempotent), so the actual persisted level is verified before deciding.
 * Returns the label (email, falling back to user id) of every recipient
 * that did NOT end up holding a grant at (at least) the intended level. */
async function grantCollectionToRecipients(
  collectionId: string,
  ck: WasmCollectionKey,
  recipients: { user_id: string; email?: string; public_key: string | null }[],
  level: string,
): Promise<string[]> {
  const handles: WasmIdentityPublicKey[] = [];
  const failed: string[] = [];
  try {
    for (const recipient of recipients) {
      const recipientPk = WasmIdentityPublicKey.fromBytes(
        base64Decode(recipient.public_key as string),
      );
      handles.push(recipientPk);
      try {
        const sealedKey = sealCollectionKey(recipientPk, ck);
        await addCollectionMember(collectionId, recipient.user_id, sealedKey, level);
      } catch (err) {
        if (isConflictError(err)) {
          const holdsIntendedLevel = await recipientAlreadyHoldsIntendedLevel(
            collectionId,
            recipient.user_id,
            level,
          );
          if (!holdsIntendedLevel) {
            failed.push(recipient.email ?? recipient.user_id);
          }
        } else {
          console.error(`pv: failed to grant collection ${collectionId} to ${recipient.user_id}`, err);
          failed.push(recipient.email ?? recipient.user_id);
        }
      }
    }
  } finally {
    handles.forEach((pk) => pk.free?.());
  }
  return failed;
}

/** 30-12 (FSH-01's "or an item" clause): the fixed, non-sensitive
 * placeholder name of the ONE per-family auto-created `item_bucket`
 * collection. Any deterministic plaintext is acceptable here — 30-UI-SPEC.md
 * states this collection is never rendered as a folder row, and 30-10's
 * `SharingOverviewPanel` renders only the items INSIDE it, never its own
 * name. It is still encrypted like every other collection name (the server
 * must not learn even this), it simply carries no user-authored content. */
const FAMILY_ITEM_BUCKET_PLACEHOLDER_NAME = "family-wide-items";

/** 30-12, T-30-20 recovery bound. `collections::list` is KEY-GATED (it inner-
 * joins `collection_keys` on the caller), so a race loser holds no row for
 * the winner's bucket until the winner's own `addCollectionMember` fan-out
 * reaches them — a single immediate re-list after the 409 can legitimately
 * return nothing. These bound how long the loser waits for that grant to
 * become visible before reporting an honest, retryable failure. Deliberately
 * short: this is a same-second race between two live clients, not a
 * cross-device sync wait. */
const ITEM_BUCKET_GRANT_POLL_ATTEMPTS = 4;
const ITEM_BUCKET_GRANT_POLL_DELAY_MS = 200;

/** The item_bucket row from a `listCollections()` response DECLARED AT
 * `level`, or `undefined` (260812-01e Task 5: with per-level item_bucket
 * collections now possible, LOCKED decision 1, `kind` alone is no longer
 * sufficient to identify "the" bucket -- a family may hold up to three,
 * one per access level). Requires a usable `sealed_key`: a row the caller
 * cannot unseal is not a bucket they can encrypt INTO, so treating it as
 * "found" would produce exactly the undefined-shaped move this bound exists
 * to prevent. */
function familyItemBucketRow(rows: CollectionRow[], level: AccessLevelValue): CollectionRow | undefined {
  return rows.find(
    (c) =>
      c.family_wide_kind === "item_bucket" &&
      c.family_wide_access_level === level &&
      typeof c.sealed_key === "string" &&
      c.sealed_key !== "",
  );
}

/**
 * The item-variant's real crypto composition, EXPORTED so
 * `ShareDialog.real-wasm.test.ts` calls this exact sequence rather than
 * re-implementing it (this plan's own phase-context advisory). Seals the
 * item's OWN `enc_key` (already unwrapped internally by
 * `sealItemKeyForRecipient` under `uk`) to every selected recipient's real
 * published public key, POSTing one `createItemShare` per recipient.
 * `access_level` is a single value shared by every recipient in this
 * submission — 26-UI-SPEC.md's E3 gives each dialog session ONE access-level
 * radio group, not a per-recipient choice.
 *
 * CR-01 (code review, Phase 26) — this loop used to have NO per-recipient
 * outcome tracking: the first throw propagated out, `handleSubmit` rendered
 * `share.createFailed` ("Couldn't share. Try again.") over the N-1 grants
 * that had ALREADY committed server-side, and the retry that copy invited
 * was not idempotent — `vault.rs::create_share` 409s on a duplicate
 * `(item_id, recipient_user_id)`, so the retry aborted on the
 * already-granted recipient and the share could never be completed through
 * the UI at all (no revoke/delete client wrapper exists anywhere in
 * `web/src`, so there was no repair path either).
 *
 * Two changes make the state recoverable:
 *  1. A per-recipient `try/catch` collects failures instead of aborting, so
 *     the caller can report honestly WHICH recipients did not get access.
 *  2. A 409 is treated as success-FOR-THAT-RECIPIENT, not as a failure — the
 *     grant it reports genuinely exists, which is exactly the state the user
 *     is trying to reach. That is what makes the retry idempotent.
 *
 * Returns the label (email, falling back to user id) of every recipient that
 * did NOT end up with a grant. An empty array means every selected recipient
 * now holds one.
 */
export async function shareItemWithRecipients(
  itemId: string,
  encKeyJson: string,
  recipients: { user_id: string; email?: string; public_key: string | null }[],
  accessLevel: string,
  uk: WasmUserKey,
): Promise<string[]> {
  assertRecipientsHavePublicKeys(recipients);
  const failed: string[] = [];
  for (const recipient of recipients) {
    let recipientPk: WasmIdentityPublicKey | undefined;
    try {
      recipientPk = WasmIdentityPublicKey.fromBytes(base64Decode(recipient.public_key as string));
      const sealedKey = sealItemKeyForRecipient(uk, encKeyJson, itemId, recipientPk);
      await createItemShare(itemId, recipient.user_id, sealedKey, accessLevel);
    } catch (err) {
      if (!isConflictError(err)) {
        console.error(`pv: failed to share item ${itemId} with ${recipient.user_id}`, err);
        failed.push(recipient.email ?? recipient.user_id);
      }
    } finally {
      recipientPk?.free?.();
    }
  }
  return failed;
}

type OwnIdentityKeypair = Awaited<ReturnType<typeof ensureOwnIdentityKeypair>>;

/** CR-04 fix (30-REVIEW.md): thrown by `findOrCreateFamilyItemBucket` when
 * the caller is a gap-window newcomer KNOWN to be waiting on this exact
 * bucket's key (`getFamilyWidePendingSnapshot().missing`) rather than a
 * genuine same-second race loser. `handleSubmit` catches this specifically
 * and renders the honest, existing `share.pendingFamilyKeyNote`/
 * `share.pendingFamilyKeyNoteDetail` copy instead of `share.createFailed`'s
 * "…Spróbuj ponownie." — a retry here cannot possibly succeed until another
 * family member's session reseals this member's key, which is exactly the
 * state those two strings already describe correctly. */
class FamilyWideKeyPendingError extends Error {
  readonly collectionId: string;
  constructor(collectionId: string) {
    super(`family-wide item bucket ${collectionId} exists, but this member's key for it has not arrived yet`);
    this.name = "FamilyWideKeyPendingError";
    this.collectionId = collectionId;
  }
}

/** The race LOSER's recovery (T-30-20). `createCollection(..., "item_bucket")`
 * 409'd because another member's concurrent call won
 * `idx_one_item_bucket_per_family` — the bucket EXISTS, this caller simply
 * did not create it. It is not yet VISIBLE to them, though: `collections::
 * list` returns only rows the caller holds a `collection_keys` row for, and
 * the winner's `addCollectionMember` fan-out has not necessarily landed yet.
 * So this re-lists a BOUNDED number of times rather than once, and throws a
 * plain (caller-rendered as `share.createFailed`, "…Spróbuj ponownie.")
 * retryable failure if the grant never arrives — never returns an id-less
 * result that would move the item into `undefined`.
 *
 * CR-04 fix (30-REVIEW.md): `findOrCreateFamilyItemBucket` now checks the
 * discovery snapshot's `missing` list BEFORE ever attempting a create, and
 * throws `FamilyWideKeyPendingError` instead of reaching this path when the
 * caller is a KNOWN gap-window newcomer with no reseal in flight (the case
 * that used to poll here for ~600ms and fail with a retry that could never
 * succeed). This path is still reachable when that snapshot is momentarily
 * stale (the newcomer's own pull cycle hasn't caught up yet) — in that
 * narrower window this bounded poll is still the honest mechanism, since a
 * genuine same-second race is indistinguishable from a stale snapshot until
 * this poll resolves it either way. */
async function awaitFamilyItemBucketGrant(
  identityKey: OwnIdentityKeypair,
  level: AccessLevelValue,
): Promise<{ id: string; ck: WasmCollectionKey }> {
  for (let attempt = 0; attempt < ITEM_BUCKET_GRANT_POLL_ATTEMPTS; attempt += 1) {
    const winner = familyItemBucketRow(await listCollections(), level);
    if (winner !== undefined) {
      return { id: winner.id, ck: unsealCollectionKey(identityKey, winner.sealed_key as string) };
    }
    if (attempt < ITEM_BUCKET_GRANT_POLL_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, ITEM_BUCKET_GRANT_POLL_DELAY_MS));
    }
  }
  throw new Error(
    "family-wide item bucket exists, but this member's key for it has not arrived yet",
  );
}

/**
 * 30-12 (FSH-01): resolves the ONE per-family `item_bucket` collection —
 * RESEARCH.md's own recommendation for routing a bare item's family-wide
 * share through the same collection-scoped path a family-wide folder uses,
 * rather than inventing a second mechanism.
 *
 * Order-independent and self-healing: it lists first and only creates when
 * the family genuinely has no bucket, so two members independently sharing
 * their own first item family-wide converge on the SAME bucket. That
 * convergence is NOT merely list-then-create ordering, though — a genuine
 * client-level race is still possible, and 30-01's
 * `idx_one_item_bucket_per_family` partial unique index is what makes it
 * safe: the second concurrent insert fails server-side (a clean 409 from
 * `collections::create`'s bare `ON CONFLICT DO NOTHING` + `fetch_optional`
 * `None` branch — the bare form is what catches a partial-index conflict at
 * all), so exactly one bucket can ever exist per family, and the loser
 * recovers through `awaitFamilyItemBucketGrant` instead of surfacing an
 * error.
 *
 * Returns the unwrapped `WasmCollectionKey` alongside the id — the caller
 * must re-encrypt the item UNDER this key, and re-listing + re-unsealing at
 * the call site would duplicate exactly the work this function already did.
 * The caller owns the handle and must `free()` it.
 */
async function findOrCreateFamilyItemBucket(
  identityKey: OwnIdentityKeypair,
  level: AccessLevelValue,
): Promise<{ id: string; ck: WasmCollectionKey }> {
  const existing = familyItemBucketRow(await listCollections(), level);
  if (existing !== undefined) {
    return { id: existing.id, ck: unsealCollectionKey(identityKey, existing.sealed_key as string) };
  }

  // CR-04 fix (30-REVIEW.md): `collections::list` is KEY-GATED, so a
  // gap-window newcomer -- who has joined the family but not yet received
  // the bucket's key -- sees NO row here at all, would otherwise take the
  // create branch below, hit `idx_one_item_bucket_per_family`, 409, and fall
  // into `awaitFamilyItemBucketGrant`'s bounded poll -- which cannot
  // possibly succeed, since no reseal is in flight for THIS member. The
  // discovery snapshot already knows this is the pending state (the exact
  // same `missing` list 30-15's pending-row UI reads) -- consult it BEFORE
  // attempting a create this member cannot win.
  //
  // 260812-01e Task 5: also matched on `access_level` -- without it, a
  // caller waiting on ONE level's bucket key could misidentify a DIFFERENT
  // level's still-missing grant as theirs.
  const pendingBucket = getFamilyWidePendingSnapshot().missing.find(
    (g) => g.kind === "item_bucket" && g.access_level === level,
  );
  if (pendingBucket !== undefined) {
    throw new FamilyWideKeyPendingError(pendingBucket.collection_id);
  }

  const newBucketId = crypto.randomUUID();
  const newCk = WasmCollectionKey.generate();
  try {
    const encName = encryptItemForCollection(
      newCk,
      JSON.stringify({ name: FAMILY_ITEM_BUCKET_PLACEHOLDER_NAME }),
      newBucketId,
      newBucketId,
      1,
    );
    const ownPublicKey = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
    let sealedKeyForSelf: string;
    try {
      sealedKeyForSelf = sealCollectionKey(ownPublicKey, newCk);
    } finally {
      ownPublicKey.free?.();
    }
    // CR-01 fix (30-REVIEW.md): persists the level THIS share is being
    // created at, independent of the creator's own hard-coded 'edit' row --
    // see `createCollection`'s own doc comment.
    await createCollection(newBucketId, encName, sealedKeyForSelf, "item_bucket", level);
  } catch (err) {
    // Nothing landed under THIS key — free it rather than handing back a
    // handle no server-side collection corresponds to (mirrors
    // `submitFolderVariant`'s own create-failure discipline).
    newCk.free?.();
    if (!isConflictError(err)) throw err;
    return await awaitFamilyItemBucketGrant(identityKey, level);
  }
  return { id: newBucketId, ck: newCk };
}

export default function ShareDialog({
  scope,
  onClose,
  onShared,
}: {
  scope: ShareDialogScope;
  onClose: () => void;
  onShared: () => void;
}) {
  const { t } = useLocale();
  const [state, setState] = useState<DialogState>("loading-recipients");
  const [recipients, setRecipients] = useState<FamilyMemberRecord[]>([]);
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
  // FSH-01 -- "Cała rodzina" mode. Mutually exclusive with
  // `selectedRecipientIds`: selecting one always clears the other (see
  // `toggleFamilyWide`/`toggleRecipient` below), so there is never a UI
  // state where both are simultaneously populated.
  const [isFamilyWideSelected, setIsFamilyWideSelected] = useState(false);
  const [accessLevel, setAccessLevel] = useState<AccessLevelValue | null>(null);
  const [previousAccessLevel, setPreviousAccessLevel] = useState<AccessLevelValue | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [seedMoveFailureCount, setSeedMoveFailureCount] = useState<number | null>(null);
  const [failedRecipientLabels, setFailedRecipientLabels] = useState<string[]>([]);
  // CR-04 fix (30-REVIEW.md): distinct from `submitError` -- a KNOWN pending
  // family key is not an error state (nothing failed; nothing is retryable),
  // so it renders the same honest, non-alarmed
  // `share.pendingFamilyKeyNote`/`share.pendingFamilyKeyNoteDetail` copy
  // `DetailPanel.tsx`'s pending-row already uses, never `share.createFailed`.
  const [familyKeyPending, setFamilyKeyPending] = useState(false);
  // WR-14: `me()` could not be resolved -- the dialog cannot function (the
  // caller cannot be filtered out of their own recipient list, and the
  // hidden-password ack cannot be persisted per-account). Rendered as an
  // error rather than the misleading `share.noOtherMembers` empty state.
  const [accountUnavailable, setAccountUnavailable] = useState(false);
  const mountedRef = useRef(true);
  // CR-01: the collection this dialog session created, minted ONCE and
  // reused by every later submit attempt. `crypto.randomUUID()` used to be
  // called inside `submitFolderVariant` on every submit, so each retry after
  // a partial failure orphaned ANOTHER collection server-side (and there is
  // no collection-delete client wrapper anywhere in `web/src` to clean them
  // up). The unwrapped `WasmCollectionKey` is held alongside the id because a
  // retry MUST seal the SAME key to the remaining recipients — a freshly
  // generated one would not decrypt the collection's already-stored
  // `enc_name` or any item already moved into it. `movedItemIds` keeps a
  // retry from re-moving (and re-bumping the revision of) seed items that
  // already landed. Freed on unmount, mirroring this file's existing
  // free-every-WASM-handle discipline.
  const createdCollectionRef = useRef<{
    id: string;
    ck: WasmCollectionKey;
    movedItemIds: Set<string>;
  } | null>(null);

  const isFolder = scope.kind === "folder";
  const seedFolder =
    scope.kind === "folder" && scope.existingFolderId !== null
      ? (() => {
          const folder = getFolders().find((f) => f.id === scope.existingFolderId) ?? null;
          if (folder === null) return null;
          const itemCount = getItems().filter((i) => i.fields.folderId === folder.id).length;
          return { id: folder.id, name: folder.name, itemCount };
        })()
      : null;

  useEffect(() => {
    mountedRef.current = true;
    /** WR-14 (code review, Phase 26): `me()` used to be soft-failed with a
     * bare `.catch(() => null)`, and the recipient list was then filtered
     * with `m.user_id !== account?.user_id` -- comparing against `undefined`,
     * so NOTHING was filtered out and the caller appeared in their own
     * recipient list. The same `account === null` state also made the
     * one-time hidden-password acknowledgment un-persistable, so the
     * blocking modal reappeared on every selection, forever.
     *
     * The caller's own id is a PREREQUISITE for this dialog, not optional
     * enrichment. Retried once, then treated as a hard failure for the
     * dialog. */
    async function resolveAccount(): Promise<{ user_id: string } | null> {
      try {
        return await me();
      } catch {
        try {
          return await me();
        } catch {
          return null;
        }
      }
    }
    async function load() {
      setState("loading-recipients");
      try {
        const [account, members] = await Promise.all([resolveAccount(), getFamilyMembers()]);
        if (!mountedRef.current) return;
        if (account === null) {
          // Nothing selectable and an honest error, rather than a recipient
          // list containing the caller themselves plus a
          // never-acknowledgeable disclosure modal.
          setAccountId(null);
          setRecipients([]);
          setAccountUnavailable(true);
          setSubmitError(t("share.createFailed"));
          setState("populated");
          return;
        }
        setAccountId(account.user_id);
        const others = (members ?? []).filter((m) => m.user_id !== account.user_id);
        setRecipients(others);
        setState("populated");
      } catch {
        if (!mountedRef.current) return;
        // Fail safe, never crash — nothing selectable, submit stays
        // disabled (never a lie about "no other members", just nothing to
        // act on).
        setRecipients([]);
        setAccountUnavailable(true);
        setSubmitError(t("share.createFailed"));
        setState("populated");
      }
    }
    void load();
    return () => {
      mountedRef.current = false;
      // CR-01: the session-scoped CollectionKey handle outlives individual
      // submit attempts by design — this unmount is the ONE place it is
      // freed (T-26-10's never-leave-WASM-key-material-to-the-GC rule).
      createdCollectionRef.current?.ck.free?.();
      createdCollectionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleRecipient(userId: string) {
    setSelectedRecipientIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
    // Mutual exclusivity (30-UI-SPEC.md's "Cała rodzina" Row Contract):
    // picking any individual recipient clears the family-wide mode. In
    // practice the family-wide checkbox is already `disabled` whenever an
    // individual is selected, so this is a defensive no-op most of the
    // time -- but it keeps the two modes provably exclusive at the state
    // layer too, not only via the disabled attribute.
    setIsFamilyWideSelected(false);
  }

  function toggleFamilyWide() {
    setIsFamilyWideSelected((prev) => {
      const next = !prev;
      if (next) {
        setSelectedRecipientIds(new Set());
      }
      return next;
    });
  }

  function handleSelectAccessLevel(value: AccessLevelValue) {
    if (value === "hidden_password" && (accountId === null || !hasAcknowledgedHiddenPassword(accountId))) {
      setPreviousAccessLevel(accessLevel);
      setState("hidden-password-ack");
      return;
    }
    setAccessLevel(value);
  }

  function handleHiddenPasswordAck() {
    if (accountId !== null) {
      setAcknowledgedHiddenPassword(accountId);
    }
    setAccessLevel("hidden_password");
    setState("populated");
  }

  function handleHiddenPasswordCancel() {
    setAccessLevel(previousAccessLevel);
    setState("populated");
  }

  /** `seedMoveFailures` is always 0 — the item variant has no seed-items
   * sub-step, but a uniform `SubmitOutcome` return contract lets
   * `handleSubmit` decide "clean success vs. partial-failure-but-still-a-
   * success" identically for both variants without relying on a state read
   * immediately after an `await` (React state updates are not visible in
   * the SAME closure that scheduled them — this return value is the actual
   * source of truth, the state variables are purely for rendering). */
  async function submitItemVariant(
    item: VaultItem,
    selected: FamilyMemberRecord[],
    level: AccessLevelValue,
    isFamilyWide: boolean = false,
  ): Promise<SubmitOutcome> {
    const uk = getUnlockedUserKey();
    if (uk === null) {
      throw new Error("cannot share while the vault is locked");
    }
    await initCrypto();
    const rows = await listItems();
    const row = rows.find((r) => r.id === item.id);
    if (row === undefined) {
      throw new Error(`cannot share item ${item.id} — item not found in the caller's own vault listing`);
    }
    if (isFamilyWide) {
      return await submitItemFamilyWide(item, row, selected, level, uk);
    }
    const failedRecipients = await shareItemWithRecipients(item.id, row.enc_key, selected, level, uk);
    return {
      failedRecipients,
      seedMoveFailures: 0,
      // Nothing durable landed only when EVERY selected recipient failed —
      // in that case `handleSubmit` may honestly report total failure.
      committedAnything: failedRecipients.length < selected.length,
    };
  }

  /** 30-12 (FSH-01's "or an item" clause): a family-wide share of a BARE item
   * is collection-scoped, never a direct `item_shares` row — the item is
   * moved into the ONE per-family `item_bucket` collection and the bucket's
   * key is granted to every current active member, so a LATER joiner reads it
   * through the exact same invite-wrap / lazy-reseal path a family-wide
   * folder already uses (a per-recipient `item_shares` row could never do
   * that: it names recipients who exist today).
   *
   * The decrypt / re-encrypt-under-destination / `moveItemToCollection`
   * sequence is `submitFolderVariant`'s seed-move sub-step verbatim,
   * including its AAD discipline: the payload is encrypted under the revision
   * the item will carry AFTER the move (`move_item` bumps unconditionally),
   * while `expected_revision` on the wire is the CURRENT, pre-move one. */
  async function submitItemFamilyWide(
    item: VaultItem,
    row: { enc_key: string; enc_data: string; revision: number },
    familyRecipients: FamilyMemberRecord[],
    level: AccessLevelValue,
    uk: WasmUserKey,
  ): Promise<SubmitOutcome> {
    const identityKey = await ensureOwnIdentityKeypair(uk);
    let bucket: { id: string; ck: WasmCollectionKey } | null = null;
    try {
      bucket = await findOrCreateFamilyItemBucket(identityKey, level);
      const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
      const plaintext = decryptItem(uk, combined, item.id, row.revision);
      const reEncrypted = encryptItemForCollection(
        bucket.ck,
        plaintext,
        bucket.id,
        item.id,
        row.revision + 1,
      );
      const { encKey, encData } = splitCombinedEncryptedItem(reEncrypted);
      await moveItemToCollection(item.id, bucket.id, encKey, encData, row.revision);
      // The item is in the bucket by this point, so SOMETHING durable has
      // committed regardless of how the individual grants below go.
      const failedRecipients = await grantCollectionToRecipients(
        bucket.id,
        bucket.ck,
        withPublishedPublicKey(familyRecipients),
        level,
      );
      return { failedRecipients, seedMoveFailures: 0, committedAnything: true };
    } finally {
      bucket?.ck.free?.();
      identityKey.free?.();
    }
  }

  /** Creates (once per dialog session) the shared folder, grants every
   * selected recipient access, and — when seeded from an existing personal
   * folder — bulk-moves that folder's items into it.
   *
   * CR-01 (code review, Phase 26): `newCollectionId`/`WasmCollectionKey.generate()`
   * used to run on EVERY submit, so each retry after a partial failure
   * created an ADDITIONAL orphaned collection (unremovable — no
   * collection-delete client wrapper exists anywhere in `web/src`). They now
   * live in `createdCollectionRef` for the dialog session's lifetime, so a
   * retry adds the missing grants to the collection that already exists. The
   * per-recipient loop tracks failures instead of aborting, and treats
   * `collections::add_member`'s duplicate-409 as success-for-that-recipient
   * so the retry is genuinely idempotent.
   *
   * `isFamilyWide` (30-08, FSH-01): when `true`, `selected` is the FULL
   * current active family roster (minus the caller), not whatever happens
   * to be in `selectedRecipientIds` (which is always empty in this mode —
   * the checkbox selects a MODE, not a recipient list). T-25-16's
   * throw-before-network discipline stays UNCHANGED for the individual-
   * recipient path (`isFamilyWide === false`) — it exists because that
   * recipient set was explicitly picked, and a silent drop would defeat an
   * explicit user choice. A family-wide set is never explicitly picked
   * per-person, so a keyless member here is structurally the same shape as
   * a not-yet-joined member: OMITTED from this creation-time grant rather
   * than aborting the whole share, and picked up later by the SAME
   * lazy-reseal trigger (30-13) a gap-window invitee already uses once they
   * publish a key. */
  async function submitFolderVariant(
    name: string,
    selected: FamilyMemberRecord[],
    level: AccessLevelValue,
    seed: { id: string; itemCount: number } | null,
    isFamilyWide: boolean = false,
  ): Promise<SubmitOutcome> {
    const uk = getUnlockedUserKey();
    if (uk === null) {
      throw new Error("cannot share while the vault is locked");
    }
    await initCrypto();
    // T-25-16 applies to the individual-recipient path only — see the
    // `isFamilyWide` doc comment above for why the family-wide path
    // deliberately diverges (omits rather than throws).
    if (!isFamilyWide) {
      assertRecipientsHavePublicKeys(selected);
    }
    const grantRecipients = isFamilyWide ? withPublishedPublicKey(selected) : selected;

    const identityKey = await ensureOwnIdentityKeypair(uk);
    try {
      let created = createdCollectionRef.current;
      if (created === null) {
        const newCollectionId = crypto.randomUUID();
        const newCk = WasmCollectionKey.generate();
        try {
          const encName = encryptItemForCollection(
            newCk,
            JSON.stringify({ name }),
            newCollectionId,
            newCollectionId,
            1,
          );
          const ownPublicKey = WasmIdentityPublicKey.fromBytes(identityKey.publicKeyBytes());
          let sealedKeyForSelf: string;
          try {
            sealedKeyForSelf = sealCollectionKey(ownPublicKey, newCk);
          } finally {
            ownPublicKey.free?.();
          }
          // `family_wide_kind`/`family_wide_access_level` threaded in ONLY
          // on this branch — an ordinary (non-family-wide) creation keeps
          // omitting both fields entirely, per 30-02's additive contract
          // (`createCollection` leaves each key OUT of the POSTed body
          // whenever its argument is `undefined`). CR-01 fix (30-REVIEW.md):
          // `level` here is the SAME level `grantCollectionToRecipients`
          // below hands every other member — this is what makes it survive
          // past creation time for later propagation paths to read, instead
          // of only ever being visible via the creator's own hard-coded
          // `'edit'` `collection_keys` row.
          await createCollection(
            newCollectionId,
            encName,
            sealedKeyForSelf,
            isFamilyWide ? "folder" : undefined,
            isFamilyWide ? level : undefined,
          );
        } catch (err) {
          // The collection never landed — free the key rather than parking a
          // handle in the ref that no server-side collection corresponds to.
          newCk.free?.();
          throw err;
        }
        created = { id: newCollectionId, ck: newCk, movedItemIds: new Set<string>() };
        createdCollectionRef.current = created;
        // 26-12a gap fix: collections.ts's own store otherwise only refreshes
        // on the NEXT unlock or onSharedRevisions tick — without this, the
        // caller's own CollectionPicker doesn't show the folder they just
        // created (26-12-SUMMARY.md's declared eventual-consistency-gap).
        // Best-effort: placed right after the collection genuinely exists
        // server-side (the caller already holds `sealedKeyForSelf`), so a
        // refresh failure here never turns the folder's own successful
        // creation into a visible error — the member grants and any seed
        // moves below proceed regardless, and the next unlock/sync tick
        // still catches up if this one transient call fails.
        try {
          await refreshCollectionsNow();
        } catch {
          // ignored — see comment above.
        }
      }
      const { id: collectionId, ck: newCk, movedItemIds } = created;

      // 30-12: the per-recipient loop (and its 409-is-success-for-that-
      // recipient rule) now lives in the shared `grantCollectionToRecipients`
      // helper, so the item-bucket branch grants IDENTICALLY rather than
      // carrying a second copy of this policy.
      const failedRecipients = await grantCollectionToRecipients(
        collectionId,
        newCk,
        grantRecipients,
        level,
      );

      let failures = 0;
      if (seed !== null) {
        const seedItems = getItems().filter(
          (i) => i.fields.folderId === seed.id && !movedItemIds.has(i.id),
        );
        const rows = await listItems();
        for (const item of seedItems) {
          try {
            const row = rows.find((r) => r.id === item.id);
            if (row === undefined) throw new Error(`row not found for item ${item.id}`);
            const combined = recombineEncryptedItem(row.enc_key, row.enc_data);
            const plaintext = decryptItem(uk, combined, item.id, row.revision);
            // AAD revision matches the revision the item will carry AFTER
            // the move (mirrors store.ts::updateVaultItem's own
            // encrypt-under-new-revision / expected-revision-is-the-old-one
            // split) — `moveItemToCollection`'s server route bumps
            // `revision = revision + 1` unconditionally, so encrypting under
            // the OLD revision would make the item permanently
            // undecryptable the moment this move lands.
            const reEncrypted = encryptItemForCollection(
              newCk,
              plaintext,
              collectionId,
              item.id,
              row.revision + 1,
            );
            const { encKey, encData } = splitCombinedEncryptedItem(reEncrypted);
            await moveItemToCollection(item.id, collectionId, encKey, encData, row.revision);
            // CR-01: a retry must not re-move (and re-bump the revision of)
            // an item that already landed in this collection.
            movedItemIds.add(item.id);
          } catch {
            // A single seed item's move failure must not roll back the
            // folder creation or the member grants already committed above
            // — the folder itself is the primary deliverable (T-26-17,
            // accepted risk).
            failures += 1;
          }
        }
      }
      // The collection itself always exists by this point, so SOMETHING
      // durable has committed regardless of how the grants/moves went.
      return { failedRecipients, seedMoveFailures: failures, committedAnything: true };
    } finally {
      identityKey.free?.();
    }
  }

  /** The live CURRENT active family roster, minus the caller — resolved
   * fresh at SUBMIT time rather than read from the dialog's mount-time
   * `recipients` snapshot, because the family-wide checkbox selects a MODE,
   * not a recipient list. Shared by both variants' family-wide branches
   * (30-08's folder, 30-12's item) so they can never resolve a different
   * recipient set from one another. */
  async function resolveCurrentFamilyRecipients(): Promise<FamilyMemberRecord[]> {
    const allMembers = (await getFamilyMembers()) ?? [];
    return accountId === null ? [] : allMembers.filter((m) => m.user_id !== accountId);
  }

  async function handleSubmit() {
    const selected = recipients.filter((r) => selectedRecipientIds.has(r.user_id));
    // 30-12: family-wide is now a submit path for BOTH variants — the folder
    // one creates a `family_wide_kind: 'folder'` collection (30-08), the item
    // one moves the item into the single per-family `item_bucket` collection.
    const familyWideSubmit = isFamilyWideSelected;
    if (accessLevel === null) return;
    if (!familyWideSubmit && selected.length === 0) return;
    if (isFolder && folderName.trim() === "") return;

    setState("sharing");
    setSubmitError(null);
    setSeedMoveFailureCount(null);
    setFailedRecipientLabels([]);
    setFamilyKeyPending(false);
    try {
      let outcome: SubmitOutcome;
      if (scope.kind === "item" && familyWideSubmit) {
        outcome = await submitItemVariant(
          scope.item,
          await resolveCurrentFamilyRecipients(),
          accessLevel,
          true,
        );
      } else if (scope.kind === "item") {
        outcome = await submitItemVariant(scope.item, selected, accessLevel);
      } else if (familyWideSubmit) {
        const familyRecipients = await resolveCurrentFamilyRecipients();
        outcome = await submitFolderVariant(
          folderName.trim(),
          familyRecipients,
          accessLevel,
          seedFolder,
          true,
        );
      } else {
        outcome = await submitFolderVariant(folderName.trim(), selected, accessLevel, seedFolder, false);
      }
      if (!mountedRef.current) return;
      if (outcome.failedRecipients.length === 0 && outcome.seedMoveFailures === 0) {
        onShared();
        return;
      }
      // CR-01: something did not land. Stay open so the inline report is
      // actually visible, rather than calling `onShared()` and letting the
      // dialog close/unmount before the user ever sees it.
      setState("populated");
      if (outcome.seedMoveFailures > 0) {
        // The folder + member grants genuinely succeeded — T-26-17's
        // accepted risk is scoped to the seed-item bulk move only.
        setSeedMoveFailureCount(outcome.seedMoveFailures);
      }
      if (outcome.failedRecipients.length > 0) {
        if (outcome.committedAnything) {
          // Partial: name exactly who missed out, and say plainly that the
          // successful grants already exist so the retry is honest.
          setFailedRecipientLabels(outcome.failedRecipients);
        } else {
          // Nothing committed at all — total failure is the honest report.
          setSubmitError(t("share.createFailed"));
        }
      }
    } catch (err) {
      if (!mountedRef.current) return;
      // CR-04 fix (30-REVIEW.md): a KNOWN pending family key is not the
      // generic "couldn't share, try again" failure -- rendering
      // `share.createFailed` here told a gap-window newcomer to retry into a
      // bound that can never succeed. Render the same honest pending-row
      // copy `DetailPanel.tsx` already uses for this exact state instead.
      if (err instanceof FamilyWideKeyPendingError) {
        setFamilyKeyPending(true);
      } else {
        setSubmitError(t("share.createFailed"));
      }
      setState("populated");
    }
  }

  const loading = state === "loading-recipients";
  const sharing = state === "sharing";
  const hiddenPasswordAck = state === "hidden-password-ack";

  // FSH-01/FSH-05 -- the family-wide row's member-count text, one of exactly
  // four states. Derived (never a separate `useState`) directly from state
  // this component already tracks (`load()`'s own `recipients`/
  // `accountUnavailable`) -- purely computed each render, so it can never
  // flash a stale value across a state transition the way a second `useState`
  // fed by its own effect could. `recipients` already excludes the caller
  // (WR-14's own filter), so `recipients.length + 1` is every family member
  // INCLUDING the sharer -- 30-UI-SPEC.md's explicit "count shown includes
  // the sharer" rule, deliberately not `recipients.length` alone.
  const familyMemberCountState: "loading" | { count: number } | "error" = loading
    ? "loading"
    : accountUnavailable
      ? "error"
      : { count: recipients.length + 1 };
  const familyWideMemberCountText =
    familyMemberCountState === "loading"
      ? t("share.familyWideMemberCountLoading")
      : familyMemberCountState === "error"
        ? t("share.familyWideMemberCountError")
        : familyMemberCountState.count === 1
          ? t("share.familyWideMemberCountSoloOwner")
          : interpolate(t("share.familyWideMemberCount"), {
              count: String(familyMemberCountState.count),
            });

  const dialogTitle = (() => {
    if (scope.kind === "item") {
      return interpolate(t("share.itemDialogTitle"), { name: scope.item.fields.name });
    }
    if (seedFolder !== null) {
      return interpolate(t("share.folderDialogTitleExisting"), { name: seedFolder.name });
    }
    return t("share.folderDialogTitleNew");
  })();

  // WR-04 (code review, Phase 26): 26-UI-SPEC.md:169's required generic
  // fallback. The note renders as soon as hidden-password is the selected
  // access level (honesty constraint 2: on EVERY occasion, not only after a
  // recipient is picked), so with zero selections the previous
  // `.map(email).join(", ")` interpolated an empty string and the phase's
  // most load-bearing honesty string rendered subject-less. A multi-select
  // is given the same generic subject rather than an email list, which read
  // as "a@x, b@y still has key access" (one subject, plural referents).
  const hiddenPasswordNoteSubject = (() => {
    const selected = recipients.filter((r) => selectedRecipientIds.has(r.user_id));
    return selected.length === 1
      ? selected[0].email
      : t("share.hiddenPasswordRecipientFallback");
  })();

  const ctaKey = isFolder ? "share.ctaFolder" : "share.ctaItem";
  // 30-12: BOTH variants now have a real family-wide submit path (the item
  // one routes through the per-family `item_bucket` collection), so this is
  // no longer gated on `isFolder` — 30-08's temporary "rendered but not yet
  // wired, so keep submit disabled" guard has been discharged by its
  // implementation rather than merely relaxed.
  const familyWideSubmittable = isFamilyWideSelected;
  const submitDisabled =
    sharing ||
    accountUnavailable ||
    accessLevel === null ||
    (!familyWideSubmittable && selectedRecipientIds.size === 0) ||
    (isFolder && folderName.trim() === "");

  return (
    <div
      data-testid="share-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={sharing ? undefined : onClose}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {hiddenPasswordAck ? (
          <>
            <h2
              data-testid="share-hidden-password-ack-title"
              className="truncate text-[20px] font-bold leading-[1.2]"
            >
              {t("share.hiddenPasswordDisclosureTitle")}
            </h2>
            <p data-testid="share-hidden-password-ack-body" className="text-sm">
              {t("share.hiddenPasswordDisclosureBody")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="share-hidden-password-ack-cancel"
                className="btn btn-ghost"
                onClick={handleHiddenPasswordCancel}
              >
                {t("delete.cancel")}
              </button>
              <button
                type="button"
                data-testid="share-hidden-password-ack-confirm"
                className="btn btn-primary"
                onClick={handleHiddenPasswordAck}
              >
                {t("share.hiddenPasswordDisclosureAck")}
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="truncate text-[20px] font-bold leading-[1.2]" title={dialogTitle}>
              {dialogTitle}
            </h2>

            {loading ? (
              <div className="flex flex-col items-center justify-center gap-3 py-8" data-testid="share-loading">
                <span className="loading loading-spinner loading-lg" aria-hidden="true" />
              </div>
            ) : (
              <>
                {isFolder ? (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="share-folder-name-input" className="text-sm font-bold">
                      {t("share.newFolderNameLabel")}
                    </label>
                    <input
                      id="share-folder-name-input"
                      data-testid="share-folder-name-input"
                      type="text"
                      className="input input-bordered"
                      value={folderName}
                      disabled={sharing}
                      onChange={(e) => setFolderName(e.target.value)}
                    />
                    {seedFolder !== null ? (
                      <p data-testid="share-seed-summary" className="text-sm text-base-content/70">
                        {interpolate(t("share.seedFolderSummary"), {
                          folder: seedFolder.name,
                          count: String(seedFolder.itemCount),
                        })}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* FSH-01 (30-08) -- "Cała rodzina" row, pinned above the
                    individual recipient list in BOTH the item and folder
                    variants (this section is shared by both -- `scope.kind`
                    is irrelevant to this row). Boxed treatment
                    (`rounded-field border border-base-300`) is this row's
                    primary visual distinction from a plain person row. The
                    timing caveat renders UNCONDITIONALLY whenever this row
                    is visible, never gated on `isFamilyWideSelected` --
                    30-UI-SPEC.md's "Share Dialog -- 'Cała rodzina' Row
                    Contract". */}
                <label
                  data-testid="share-recipient-family-wide"
                  className="flex items-center gap-2 rounded-field border border-base-300 px-2 py-2"
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm"
                    checked={isFamilyWideSelected}
                    disabled={sharing || selectedRecipientIds.size > 0}
                    aria-describedby="share-family-wide-caveat"
                    onChange={toggleFamilyWide}
                  />
                  <Users size={14} className="shrink-0 text-secondary" aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-bold">{t("share.familyWideOptionLabel")}</span>
                    <span
                      data-testid="share-family-wide-member-count"
                      className="text-sm text-base-content/60"
                    >
                      {familyWideMemberCountText}
                    </span>
                  </span>
                </label>
                <p
                  id="share-family-wide-caveat"
                  data-testid="share-family-wide-timing-caveat"
                  className="text-sm text-base-content/60"
                >
                  {t("share.familyWideTimingCaveat")}
                </p>
                <div className="border-t border-base-300" />

                <p className="text-sm font-bold">{t("share.recipientsLabel")}</p>
                {accountUnavailable ? null : recipients.length === 0 ? (
                  <p data-testid="share-no-other-members" className="text-sm text-base-content/70">
                    {t("share.noOtherMembers")}
                  </p>
                ) : (
                  <div className="flex max-h-48 flex-col gap-2 overflow-y-auto" data-testid="share-recipient-list">
                    {recipients.map((r) => (
                      <label
                        key={r.user_id}
                        data-testid={`share-recipient-${r.user_id}`}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm"
                          checked={selectedRecipientIds.has(r.user_id)}
                          disabled={sharing || isFamilyWideSelected}
                          onChange={() => toggleRecipient(r.user_id)}
                        />
                        <span className="truncate text-sm" title={r.email}>
                          {r.email}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                <p className="text-sm font-bold">{t("share.accessLevelLabel")}</p>
                <div className="flex flex-col gap-1">
                  {ACCESS_LEVEL_VALUES.map((value) => (
                    <label key={value} data-testid={`share-access-level-${value}`} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="share-access-level"
                        className="radio radio-sm"
                        checked={accessLevel === value}
                        disabled={sharing}
                        onChange={() => handleSelectAccessLevel(value)}
                      />
                      <span className="text-sm">{t(accessLevelKey(value))}</span>
                    </label>
                  ))}
                </div>
                {accessLevel === "hidden_password" ? (
                  <p data-testid="share-hidden-password-inline-note" className="text-sm text-base-content/70">
                    {interpolate(t("share.hiddenPasswordInlineNote"), {
                      recipient: hiddenPasswordNoteSubject,
                    })}
                  </p>
                ) : null}
                {/* 260812-01e Task 7 (LOCKED decision 1's copy-honesty
                    requirement): a family-wide ITEM share at a non-edit
                    level is exactly the case where "read"/"hidden_password"
                    next to the radio above is no longer the whole truth --
                    Task 1's contributor-escalation mechanism means read-only
                    here does not prevent a family member from editing this
                    item. Scoped precisely: item scope, family-wide checked,
                    accessLevel chosen and not already "edit" (there is
                    nothing to disclose at "edit" -- it already says what it
                    means). See `share.familyWideItemContributorEditNote`'s
                    own doc comment for the three facts this string must
                    carry. */}
                {scope.kind === "item" && isFamilyWideSelected && accessLevel !== null && accessLevel !== "edit" ? (
                  <p
                    data-testid="share-family-wide-item-contributor-note"
                    className="text-sm text-base-content/70"
                  >
                    {t("share.familyWideItemContributorEditNote")}
                  </p>
                ) : null}

                {submitError !== null ? (
                  <p role="alert" data-testid="share-error" className="text-sm text-error">
                    {submitError}
                  </p>
                ) : null}
                {familyKeyPending ? (
                  // CR-04 fix (30-REVIEW.md): mirrors `DetailPanel.tsx`'s
                  // pending-family-key styling exactly (aria-live polite,
                  // non-error `text-base-content/70`) -- this is a true,
                  // non-alarming statement of the current state, never a
                  // failure to apologize for.
                  <div
                    role="status"
                    aria-live="polite"
                    data-testid="share-family-key-pending"
                    className="flex flex-col gap-1 text-sm text-base-content/70"
                  >
                    <span>{t("share.pendingFamilyKeyNote")}</span>
                    <span>{t("share.pendingFamilyKeyNoteDetail")}</span>
                  </div>
                ) : null}
                {failedRecipientLabels.length > 0 ? (
                  <p role="alert" data-testid="share-partial-error" className="text-sm text-error">
                    {interpolate(t("share.partialShareFailed"), {
                      recipients: failedRecipientLabels.join(", "),
                    })}
                  </p>
                ) : null}
                {seedMoveFailureCount !== null ? (
                  // WR-05: names what actually happened (the folder WAS
                  // shared) and how many items did not move, instead of the
                  // "Couldn't share. Try again." copy this used to render
                  // over a share that genuinely succeeded.
                  <p data-testid="share-seed-move-failures" className="text-sm text-base-content/70">
                    {interpolate(t("share.seedMoveFailed"), {
                      count: String(seedMoveFailureCount),
                    })}
                  </p>
                ) : null}

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    data-testid="share-cancel"
                    className="btn btn-ghost"
                    disabled={sharing}
                    onClick={onClose}
                  >
                    {t("delete.cancel")}
                  </button>
                  <button
                    type="button"
                    data-testid="share-submit"
                    className="btn btn-primary"
                    disabled={submitDisabled}
                    onClick={() => void handleSubmit()}
                  >
                    {sharing ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : null}
                    {sharing ? t("share.sharing") : t(ctaKey)}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
