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
// into the `family_wide_kind: 'item_bucket'` collection DECLARED AT THE
// SHARE'S OWN CHOSEN LEVEL (260812-01e: a family may hold up to THREE such
// buckets, one per access level — no longer a per-family singleton),
// lazily auto-created on first use per level and kept unique PER LEVEL by
// migration 0021's `idx_one_item_bucket_per_family` partial unique index,
// re-scoped to `(family_id, COALESCE(family_wide_access_level, ''))` (a
// racing second create AT THE SAME LEVEL 409s server-side and the loser
// adopts the winner's bucket). Both paths then run the SAME
// `grantCollectionToRecipients` loop, and the item path reuses the folder
// variant's seed-move re-encryption sequence verbatim rather than carrying
// a second implementation of it.
import { useEffect, useRef, useState } from "react";
import { Users, UserCheck, UserMinus, AlertTriangle } from "lucide-react";
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
  getCollection,
  getCollectionAccessList,
  listItemShares,
  updateCollectionAccess,
  updateItemShare,
  revokeCollectionAccess,
  revokeItemShare,
  type CollectionRow,
} from "@/lib/vault/api";
import { getItems, getFolders } from "@/lib/vault/store";
import { refreshCollectionsNow, useCollections } from "@/lib/vault/collections";
import { reshareCollectionToNewMember } from "@/lib/families/reseal";
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
  /** Labels (email, or user id when unknown) of recipients whose GRANT or
   * UPDATE did NOT land during this attempt. */
  failedRecipients: string[];
  /** HI-02 fix (31-REVIEW.md): revoke failures are reported SEPARATELY from
   * `failedRecipients` above — the two used to be folded into ONE flat
   * list, rendered through `share.partialShareFailed`'s grant-shaped copy
   * ("the other grants already went through") regardless of which action
   * actually failed. For a failed REVOKE that copy states the exact
   * opposite of the truth: the person was supposed to LOSE access and still
   * has it, not gain something that "already went through". Labels (email,
   * or user id when unknown) of recipients whose "brak dostępu" did NOT
   * take effect during this attempt. */
  failedRevocations: string[];
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

/** 31-UI-SPEC.md's Row Anatomy — one standing row per family member,
 * BOTH scopes (31-02-PLAN.md). `currentLevel` is the truth as last fetched
 * (always `null` for a mint-new folder this plan — no destination selector
 * yet, 31-03's job; seeded from `listItemShares` for the item scope).
 * `pendingLevel` initializes to `currentLevel ?? "none"` and is the ONLY
 * thing the row's own `<select>` ever writes to — never a neutral default,
 * per MOD-01's "shows their real current level, and it is editable in
 * place". */
export interface RecipientRow {
  userId: string;
  email: string;
  currentLevel: AccessLevelValue | null;
  pendingLevel: AccessLevelValue | "none";
  suspended: boolean;
  publicKey: string | null;
}

/** T-31-06's trust boundary: the ONLY source of truth for "what dispatch
 * does this row need" — no code path may compute a different answer than
 * this. Pure and exported so it is testable in isolation from any network
 * mock. `pendingLevel === "none"` while `currentLevel` already holds a
 * grant is a REVOKE (an explicit "brak dostępu" choice on an existing
 * recipient); `pendingLevel === "none"` with no prior grant is a genuine
 * no-op (nothing was ever asked for, nothing to reconcile). */
export type ReconcileRowAction =
  | { kind: "grant"; level: AccessLevelValue }
  | { kind: "update"; level: AccessLevelValue }
  | { kind: "revoke" }
  | { kind: "noop" };

export function reconcileRowAction(
  currentLevel: AccessLevelValue | null,
  pendingLevel: AccessLevelValue | "none",
): ReconcileRowAction {
  if (pendingLevel === "none") {
    return currentLevel !== null ? { kind: "revoke" } : { kind: "noop" };
  }
  if (currentLevel === null) {
    return { kind: "grant", level: pendingLevel };
  }
  if (currentLevel === pendingLevel) {
    return { kind: "noop" };
  }
  return { kind: "update", level: pendingLevel };
}

/** The dispatcher half — takes the SAME decision `reconcileRowAction`
 * computed and invokes exactly the one caller-supplied operation it names,
 * never more than one network call per row. Callers supply scope-specific
 * (collection vs. item) grant/update/revoke implementations; this function
 * owns none of the crypto or wire shape itself, only the routing. */
export async function reconcileRow(
  row: { currentLevel: AccessLevelValue | null; pendingLevel: AccessLevelValue | "none" },
  ops: {
    grant: (level: AccessLevelValue) => Promise<void>;
    update: (level: AccessLevelValue) => Promise<void>;
    revoke: () => Promise<void>;
  },
): Promise<void> {
  const action = reconcileRowAction(row.currentLevel, row.pendingLevel);
  if (action.kind === "grant") {
    await ops.grant(action.level);
  } else if (action.kind === "update") {
    await ops.update(action.level);
  } else if (action.kind === "revoke") {
    await ops.revoke();
  }
}

/** Row order per 31-UI-SPEC.md Row Anatomy — "readable at a glance": rows
 * already holding access are grouped first (so "who already has what" is
 * visible without scrolling past everyone else at family scale), each
 * group ordered alphabetically by email. */
function buildRows(
  members: FamilyMemberRecord[],
  currentLevels: Map<string, AccessLevelValue>,
): RecipientRow[] {
  const rows: RecipientRow[] = members.map((m) => {
    const currentLevel = currentLevels.get(m.user_id) ?? null;
    return {
      userId: m.user_id,
      email: m.email,
      currentLevel,
      pendingLevel: currentLevel ?? "none",
      suspended: m.status === "suspended",
      publicKey: m.public_key,
    };
  });
  return rows.sort((a, b) => {
    const aHas = a.currentLevel !== null;
    const bHas = b.currentLevel !== null;
    if (aHas !== bHas) return aHas ? -1 : 1;
    return a.email.localeCompare(b.email);
  });
}

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

/** ME-02 fix (31-REVIEW.md): true for an error that carries NO HTTP status
 * at all — a network-layer failure (dropped connection, timeout, offline)
 * as opposed to a genuine server response the caller can trust (a 403, a
 * 404, a 409 already handled by `isConflictError` above). The distinction
 * matters for `committedAnything`'s heuristic below: a network-layer
 * failure means the REQUEST'S OUTCOME IS UNKNOWN — the server may have
 * committed the mutation before the response was lost in transit — so it
 * must never be treated the same as a definite server-side rejection when
 * deciding whether to render `share.createFailed`'s total-failure claim
 * ("nothing committed") versus the partial-failure copy. Rendering
 * total-failure over a mutation that in fact landed is the exact defect
 * this fix closes: a single-row submit whose request timed out AFTER the
 * server committed used to report "Nie udało się udostępnić. Spróbuj
 * ponownie." over a grant/revocation that genuinely succeeded. */
function isNetworkLayerFailure(err: unknown): boolean {
  return !(
    typeof err === "object" &&
    err !== null &&
    "status" in err &&
    typeof (err as { status: unknown }).status === "number"
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
 * `edit` never represents "less" than any declared level) -- EXCEPT when
 * `intendedLevel` is `"hidden_password"` (260812-01e REVIEW.md ME-02):
 * `AccessLevel`'s own doc comment (`membership.rs`) and
 * `may_grant_access_level`'s nine explicit arms exist precisely because
 * `edit` is NOT "more than" `hidden_password` along the axis the user
 * actually cares about here -- `hidden_password` means "cannot reveal the
 * password", and `edit` can. A user who deliberately chose
 * `hidden_password`, hit a 409 for a recipient who already holds `edit`,
 * must NOT be told the share succeeded at their chosen level while that
 * recipient can in fact read the password. The `edit`-ceiling stays correct
 * (and load-bearing) for `read`: a past contributor legitimately holding
 * `edit` there is not a problem this check exists to catch. A failure from
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
    const contributorCeilingApplies = intendedLevel !== "hidden_password";
    return (
      entry !== undefined &&
      (entry.access_level === intendedLevel || (contributorCeilingApplies && entry.access_level === "edit"))
    );
  } catch (err) {
    console.error(
      `pv: failed to verify recipient ${recipientUserId}'s actual access on collection ${collectionId} after a 409`,
      err,
    );
    return false;
  }
}

/** CR-04 fix (31-REVIEW.md): the `item_shares` sibling of
 * `recipientAlreadyHoldsIntendedLevel` above — `shareItemWithRecipients`
 * used to treat EVERY 409 from `createItemShare` as success unconditionally,
 * with no check of what the recipient's `item_shares.access_level` actually
 * is. A direct item share has no family-wide/contributor-escalation concept
 * (`create_share` forbids a collection-scoped item outright), so there is no
 * "edit is always an acceptable ceiling" exception to carry over from the
 * collection-scoped check — an EXACT match against `intendedLevel` is the
 * whole rule. A failure from this check itself (network, parse) fails
 * CLOSED, same discipline as its collection-scoped sibling. */
async function recipientAlreadyHoldsIntendedItemLevel(
  itemId: string,
  recipientUserId: string,
  intendedLevel: string,
): Promise<boolean> {
  try {
    const shares = await listItemShares(itemId);
    const entry = shares.find((s) => s.user_id === recipientUserId);
    return entry !== undefined && entry.access_level === intendedLevel;
  } catch (err) {
    console.error(
      `pv: failed to verify recipient ${recipientUserId}'s actual access on item ${itemId} after a 409`,
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

/** 31-02-PLAN.md's per-row grant loop (Blocker 1's fix) — the row-model
 * sibling of `grantCollectionToRecipients` above, deliberately NOT a widened
 * version of it (family-wide still needs its one-level-for-all shape,
 * called from its own unchanged branch). Grants each row's OWN
 * `pendingLevel`, never a shared one, one `addCollectionMember` call per
 * row. Shares the exact same 409 policy (`recipientAlreadyHoldsIntendedLevel`)
 * so a retry stays idempotent regardless of which loop it went through. */
async function grantCollectionToRows(
  collectionId: string,
  ck: WasmCollectionKey,
  rows: { userId: string; email: string; publicKey: string | null; pendingLevel: AccessLevelValue }[],
): Promise<string[]> {
  const handles: WasmIdentityPublicKey[] = [];
  const failed: string[] = [];
  try {
    for (const row of rows) {
      const recipientPk = WasmIdentityPublicKey.fromBytes(base64Decode(row.publicKey as string));
      handles.push(recipientPk);
      try {
        const sealedKey = sealCollectionKey(recipientPk, ck);
        await addCollectionMember(collectionId, row.userId, sealedKey, row.pendingLevel);
      } catch (err) {
        if (isConflictError(err)) {
          const holdsIntendedLevel = await recipientAlreadyHoldsIntendedLevel(
            collectionId,
            row.userId,
            row.pendingLevel,
          );
          if (!holdsIntendedLevel) {
            failed.push(row.email ?? row.userId);
          }
        } else {
          console.error(`pv: failed to grant collection ${collectionId} to ${row.userId}`, err);
          failed.push(row.email ?? row.userId);
        }
      }
    }
  } finally {
    handles.forEach((pk) => pk.free?.());
  }
  return failed;
}

/** 31-02-PLAN.md's item-scope `reconcileRow` dispatch, and the FOLDER-scope
 * update/revoke branches, mirrored for the MINT-NEW folder path. A mint-new
 * folder's rows always have `currentLevel === null` (there is no existing
 * destination to target -- that is `submitRowsForExistingDestination`
 * below's job, wired to `destinationId !== null` by 31-03-PLAN.md), so the
 * `update`/`revoke` branches stay structurally unreachable via THIS
 * function specifically -- not a stub, still generically correct, kept
 * symmetric with its existing-destination sibling below. */
async function submitRowsForCollection(
  collectionId: string,
  ck: WasmCollectionKey,
  rows: RecipientRow[],
): Promise<{ failedRecipients: string[]; failedRevocations: string[] }> {
  const grantRows = rows.filter((r) => reconcileRowAction(r.currentLevel, r.pendingLevel).kind === "grant");
  const otherRows = rows.filter((r) => {
    const kind = reconcileRowAction(r.currentLevel, r.pendingLevel).kind;
    return kind === "update" || kind === "revoke";
  });

  const failedRecipients = await grantCollectionToRows(
    collectionId,
    ck,
    grantRows.map((r) => ({
      userId: r.userId,
      email: r.email,
      publicKey: r.publicKey,
      pendingLevel: r.pendingLevel as AccessLevelValue,
    })),
  );

  // HI-02 fix (31-REVIEW.md): a revoke failure is bucketed SEPARATELY from a
  // grant/update failure — see `SubmitOutcome.failedRevocations`'s own doc
  // comment for why. Unreachable this plan (see this function's own doc
  // comment above), but kept symmetric with `submitRowsForExistingDestination`
  // below rather than silently dropping the distinction here.
  const failedRevocations: string[] = [];
  for (const row of otherRows) {
    const isRevoke = reconcileRowAction(row.currentLevel, row.pendingLevel).kind === "revoke";
    try {
      await reconcileRow(row, {
        // Unreachable this plan (see doc comment above) -- grants for the
        // folder scope always go through `grantRows`/`grantCollectionToRows`
        // above, batched for shared WASM-handle management.
        grant: async () => undefined,
        update: (level) => updateCollectionAccess(collectionId, row.userId, level),
        revoke: () => revokeCollectionAccess(collectionId, row.userId),
      });
    } catch (err) {
      console.error(`pv: failed to reconcile collection ${collectionId} row for ${row.userId}`, err);
      (isRevoke ? failedRevocations : failedRecipients).push(row.email ?? row.userId);
    }
  }
  return { failedRecipients, failedRevocations };
}

/** 31-06-PLAN.md (SC5, T-31-16): thrown by `submitRowsForExistingDestination`
 * when a FRESH `getCollection(destinationId)` re-fetch -- taken immediately
 * before dispatching the FIRST grant/update/revoke call, never a value
 * cached from dialog-open or destination-select time -- shows the caller's
 * own access to the destination is gone. Two shapes collapse to this SAME
 * error, per 31-RESEARCH.md's finding that this is reachable only through a
 * narrow TOCTOU window (the caller's own access revoked in a concurrent
 * session between the destination list loading and submit):
 *  - a successful response whose `sealed_key` is unexpectedly `null`
 *    (`Membership<Collection, RequireRead>` should make this unreachable in
 *    the ordinary case -- kept as a defensive check, not the expected path);
 *  - the `getCollection` call itself throwing (a 404 `ApiClientError`,
 *    since a `RequireRead`-gated handler 404s the instant the caller's own
 *    `collection_keys` row is gone -- the actually-reachable shape).
 * `handleSubmit` catches this specifically and renders
 * `share.destinationUnavailable` -- deliberately NOT `share.createFailed`'s
 * retry-inviting copy, mirroring `FamilyWideKeyPendingError`'s precedent for
 * a known, non-retryable cause. Thrown BEFORE the dispatch loop starts, so
 * "no partial membership" holds by construction: nothing was dispatched. */
class DestinationUnavailableError extends Error {
  readonly destinationId: string;
  constructor(destinationId: string) {
    super(`destination ${destinationId} is unavailable -- caller's own sealed_key is gone`);
    this.name = "DestinationUnavailableError";
    this.destinationId = destinationId;
  }
}

/** 31-03-PLAN.md's destination-selector counterpart to `submitRowsForCollection`
 * above -- dispatches against an EXISTING destination the caller already
 * holds edit access to (never a freshly minted collection, no
 * `createCollection` call, no `WasmCollectionKey` to manage), for the row
 * path only (family-wide keeps its own always-mint-new branch in
 * `submitFolderVariant`, untouched by this function).
 *
 * Reuses the SAME `reconcileRow` dispatcher the item scope already proved
 * out (T-31-06's trust boundary: one decision, one dispatch, never a second
 * divergent computation) -- grant/update/revoke are now ALL genuinely
 * reachable for the first time against a real existing destination:
 *  - grant -> `reshareCollectionToNewMember` (Phase 30, real-WASM-proven):
 *    unwraps the CALLER's own sealed Collection Key for `destinationId` and
 *    reseals the SAME key to the new recipient -- never
 *    `WasmCollectionKey.generate()`, which would produce a key that cannot
 *    decrypt anything already in the destination (ORG-03/SC3's whole point).
 *  - update -> `updateCollectionAccess` (31-01's PUT route).
 *  - revoke -> `revokeCollectionAccess` (existing, SHARE-06).
 *
 * T-25-16 discipline (mirrors `submitFolderVariant`'s mint-new branch):
 * callers must run `assertRecipientsHavePublicKeys` on the grant-actionable
 * rows BEFORE calling this -- this function itself does not re-check, since
 * `reconcileRow`'s grant op would otherwise reach `reshareCollectionToNewMember`
 * with a `null` public key and throw asynchronously, after any earlier rows
 * in the loop already dispatched (a partial, silently incomplete share the
 * upfront check exists to prevent).
 *
 * EXPORTED so `ShareDialog.real-wasm.test.ts` (Task 2) calls this EXACT
 * production dispatch rather than re-implementing the composition --
 * mirrors `shareItemWithRecipients`'s identical export rationale.
 *
 * 31-06-PLAN.md (SC5, T-31-16): before dispatching ANY of the three ops
 * above, re-fetches `getCollection(destinationId)` FRESH -- never a value
 * cached from dialog-open or destination-select time -- and throws
 * `DestinationUnavailableError` if that call fails OR resolves with a
 * `null` `sealed_key`. This runs ONCE, before the loop, not per-row: if the
 * caller's own access is gone, it is gone for every row in this submission,
 * and throwing here means nothing in the loop below ever dispatches --
 * "no partial membership behind" holds by construction, not by cleanup. */
export async function submitRowsForExistingDestination(
  destinationId: string,
  rows: RecipientRow[],
  uk: WasmUserKey,
): Promise<{ failedRecipients: string[]; failedRevocations: string[]; committedAnything: boolean }> {
  let freshDestination: CollectionRow;
  try {
    freshDestination = await getCollection(destinationId);
  } catch {
    throw new DestinationUnavailableError(destinationId);
  }
  if (freshDestination.sealed_key === null) {
    throw new DestinationUnavailableError(destinationId);
  }

  const actionable = rows.filter(
    (r) => reconcileRowAction(r.currentLevel, r.pendingLevel).kind !== "noop",
  );
  const failedRecipients: string[] = [];
  const failedRevocations: string[] = [];
  // ME-02 fix (31-REVIEW.md): see `isNetworkLayerFailure`'s own doc comment.
  let anyAmbiguousFailure = false;
  for (const row of actionable) {
    // HI-02 fix (31-REVIEW.md): captured BEFORE dispatch — reconcileRow's
    // own dispatch reads `row.currentLevel`/`row.pendingLevel` fresh, and
    // this is the SAME computation, so the action kind used to bucket a
    // failure below can never disagree with the one actually dispatched.
    const isRevoke = reconcileRowAction(row.currentLevel, row.pendingLevel).kind === "revoke";
    try {
      await reconcileRow(row, {
        // CR-03 fix (31-REVIEW.md): `reshareCollectionToNewMember` no
        // longer treats its own 409 as success (see its own doc comment) --
        // this is the ONE caller for which that unconditional swallow was
        // wrong: a 409 here means the recipient already holds SOME grant on
        // this destination, at a level this dialog never chose (a stale row
        // from before per-level buckets existed, or a second admin's grant
        // landing between destination-select and submit), not necessarily
        // the level the user just picked. Reuses the SAME
        // `recipientAlreadyHoldsIntendedLevel` verification
        // `grantCollectionToRecipients`/`grantCollectionToRows` already
        // apply, rather than writing a third variant of this check.
        grant: async (level) => {
          try {
            await reshareCollectionToNewMember(destinationId, row.userId, level, uk);
          } catch (err) {
            if (!isConflictError(err)) throw err;
            const holdsIntendedLevel = await recipientAlreadyHoldsIntendedLevel(
              destinationId,
              row.userId,
              level,
            );
            if (!holdsIntendedLevel) throw err;
          }
        },
        update: (level) => updateCollectionAccess(destinationId, row.userId, level),
        revoke: () => revokeCollectionAccess(destinationId, row.userId),
      });
    } catch (err) {
      console.error(`pv: failed to reconcile existing destination ${destinationId} row for ${row.userId}`, err);
      if (isNetworkLayerFailure(err)) {
        anyAmbiguousFailure = true;
      }
      (isRevoke ? failedRevocations : failedRecipients).push(row.email ?? row.userId);
    }
  }
  return {
    failedRecipients,
    failedRevocations,
    // ME-02 fix (31-REVIEW.md): an ambiguous (network-layer) failure means
    // the request MAY have committed before the response was lost — never
    // collapse that into "nothing committed" just because every actionable
    // row happened to fail.
    committedAnything: failedRecipients.length + failedRevocations.length < actionable.length || anyAmbiguousFailure,
  };
}

/** 30-12 (FSH-01's "or an item" clause): the non-sensitive placeholder name
 * for an auto-created `item_bucket` collection, SUFFIXED with its own
 * declared level (260812-01e REVIEW.md LO-03) -- a family may hold up to
 * three such collections (LOCKED decision 1), and every surface that reads
 * a collection's decrypted name generically (e.g. `DetailPanel.tsx`'s
 * `share.itemSharedOnCollectionNote`, whose `{folder}` is simply
 * `collections.find(...)?.name`) would otherwise render THREE buckets
 * under the exact same string, indistinguishable to the person reading it.
 * Any deterministic plaintext is acceptable here — 30-UI-SPEC.md states
 * this collection is never rendered as a FOLDER ROW (`CollectionPicker`/
 * `Sidebar`/`SharingOverviewPanel`'s folder tab all exclude it, HI-04), and
 * `SharingOverviewPanel`'s own pinned family-wide block renders only the
 * items INSIDE it, never its own name -- but a generic "this item lives in
 * a shared collection named X" surface has no such exclusion and is not
 * this task's to add. It is still encrypted like every other collection
 * name (the server must not learn even this, or the level it corresponds
 * to), it simply carries no user-authored content. */
function familyItemBucketPlaceholderName(level: AccessLevelValue): string {
  return `family-wide-items (${level})`;
}

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
      if (isConflictError(err)) {
        // CR-04 fix (31-REVIEW.md): a 409 here used to be treated as
        // success unconditionally — verify what the recipient ACTUALLY
        // holds before deciding, mirroring the collection-scoped grant
        // loops' identical discipline (`grantCollectionToRecipients`/
        // `grantCollectionToRows`).
        const holdsIntendedLevel = await recipientAlreadyHoldsIntendedItemLevel(
          itemId,
          recipient.user_id,
          accessLevel,
        );
        if (!holdsIntendedLevel) {
          failed.push(recipient.email ?? recipient.user_id);
        }
      } else {
        console.error(`pv: failed to share item ${itemId} with ${recipient.user_id}`, err);
        failed.push(recipient.email ?? recipient.user_id);
      }
    } finally {
      recipientPk?.free?.();
    }
  }
  return failed;
}

/** ME-02 fix (31-REVIEW.md): a marker class thrown ONLY by `submitItemRows`'s
 * own grant closure, to signal "the underlying per-recipient grant already
 * ran its own conflict verification and definitely failed" without losing
 * that definiteness the way a bare `new Error(...)` would (status-less,
 * indistinguishable from a genuine network-layer failure to
 * `isNetworkLayerFailure`). */
class ItemGrantFailedSignal extends Error {
  constructor(itemId: string, recipientUserId: string) {
    super(`pv: failed to grant item ${itemId} to ${recipientUserId}`);
    this.name = "ItemGrantFailedSignal";
  }
}

/** 31-02-PLAN.md's item-scope `reconcileRow` dispatch — full grant/update/
 * revoke reachability, since `listItemShares` can return pre-existing
 * shares today (unlike the folder scope this plan, a bare item's rows are
 * never all-null). Grant reuses `shareItemWithRecipients`'s exact crypto
 * composition (Blocker-1-adjacent discipline: `ShareDialog.real-wasm.test.ts`
 * exercises that composition directly, so grants dispatched THROUGH here
 * still run through the SAME code that test proves), called once per
 * grant-action row at that row's OWN `pendingLevel` rather than one shared
 * level for the whole set. */
async function submitItemRows(
  itemId: string,
  encKeyJson: string,
  rows: RecipientRow[],
  uk: WasmUserKey,
): Promise<SubmitOutcome> {
  const actionable = rows.filter(
    (r) => reconcileRowAction(r.currentLevel, r.pendingLevel).kind !== "noop",
  );
  const failedRecipients: string[] = [];
  const failedRevocations: string[] = [];
  // ME-02 fix (31-REVIEW.md): see `isNetworkLayerFailure`'s own doc comment.
  let anyAmbiguousFailure = false;
  for (const row of actionable) {
    // HI-02 fix (31-REVIEW.md): see `submitRowsForExistingDestination`'s
    // identical comment — captured before dispatch, same computation
    // `reconcileRow` itself dispatches from.
    const isRevoke = reconcileRowAction(row.currentLevel, row.pendingLevel).kind === "revoke";
    try {
      await reconcileRow(row, {
        grant: async (level) => {
          const rowFailed = await shareItemWithRecipients(
            itemId,
            encKeyJson,
            [{ user_id: row.userId, email: row.email, public_key: row.publicKey }],
            level,
            uk,
          );
          if (rowFailed.length > 0) {
            // `shareItemWithRecipients` already ran its own per-recipient
            // conflict verification (CR-04 fix) before adding this label to
            // `rowFailed` — by the time we see it here, that check is
            // already resolved either way, so this signal is a DEFINITE
            // failure, never itself a network-layer ambiguity. Marked with
            // `ItemGrantFailedSignal` so the ME-02 check below does not
            // misclassify this synthetic, status-less `Error` as an
            // ambiguous (network-layer) failure — it would otherwise look
            // identical to a genuine dropped connection.
            throw new ItemGrantFailedSignal(itemId, row.userId);
          }
        },
        update: (level) => updateItemShare(itemId, row.userId, level),
        revoke: () => revokeItemShare(itemId, row.userId),
      });
    } catch (err) {
      console.error(`pv: failed to reconcile item ${itemId} row for ${row.userId}`, err);
      if (!(err instanceof ItemGrantFailedSignal) && isNetworkLayerFailure(err)) {
        anyAmbiguousFailure = true;
      }
      (isRevoke ? failedRevocations : failedRecipients).push(row.email ?? row.userId);
    }
  }
  return {
    failedRecipients,
    failedRevocations,
    seedMoveFailures: 0,
    committedAnything:
      failedRecipients.length + failedRevocations.length < actionable.length || anyAmbiguousFailure,
  };
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
 * 30-12 (FSH-01): resolves the `item_bucket` collection declared at
 * `level` — RESEARCH.md's own recommendation for routing a bare item's
 * family-wide share through the same collection-scoped path a family-wide
 * folder uses, rather than inventing a second mechanism. 260812-01e: a
 * family may hold up to THREE such buckets (one per access level, LOCKED
 * decision 1), so `level` is what disambiguates which one this call
 * resolves or creates — `familyItemBucketRow` matches on BOTH
 * `family_wide_kind` and `family_wide_access_level`, never kind alone.
 *
 * Order-independent and self-healing: it lists first and only creates when
 * the family genuinely has no bucket AT THIS LEVEL, so two members
 * independently sharing their own first item family-wide AT THE SAME LEVEL
 * converge on the SAME bucket. That convergence is NOT merely
 * list-then-create ordering, though — a genuine client-level race is still
 * possible, and migration 0021's `idx_one_item_bucket_per_family` partial
 * unique index (re-scoped to `(family_id, COALESCE(family_wide_access_level,
 * ''))`) is what makes it safe: the second concurrent insert AT THE SAME
 * LEVEL fails server-side (a clean 409 from `collections::create`'s bare
 * `ON CONFLICT DO NOTHING` + `fetch_optional` `None` branch — the bare form
 * is what catches a partial-index conflict at all), so exactly one bucket
 * can ever exist per family PER LEVEL, and the loser recovers through
 * `awaitFamilyItemBucketGrant` instead of surfacing an error.
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
  //
  // 260812-01e REVIEW.md LO-02: `g.access_level === level` alone has no
  // tolerance for a legacy (pre-migration-0020) pending row, whose
  // `access_level` the server sends as `null` (`PendingGrant`'s own doc
  // comment) -- against such a row, or against an older server binary that
  // omits the field entirely, this match silently fails, the CR-04 fast
  // path above is skipped, and the caller falls into create -> 409 ->
  // `awaitFamilyItemBucketGrant`'s bounded poll -> a retry-worded failure
  // that cannot succeed -- the EXACT failure CR-04 exists to prevent. A
  // `null` entry cannot be more specifically level-matched (the server
  // itself does not know its level), so it is treated as a match for
  // WHATEVER level the caller is waiting on -- a legacy row is rare enough,
  // and this fast-path is itself only a UX improvement over the (still
  // correct, still eventually-consistent) create/409/poll path, that a
  // coarser match here is strictly better than none.
  const pendingBucket = getFamilyWidePendingSnapshot().missing.find(
    (g) => g.kind === "item_bucket" && (g.access_level === level || g.access_level === null),
  );
  if (pendingBucket !== undefined) {
    throw new FamilyWideKeyPendingError(pendingBucket.collection_id);
  }

  const newBucketId = crypto.randomUUID();
  const newCk = WasmCollectionKey.generate();
  try {
    const encName = encryptItemForCollection(
      newCk,
      JSON.stringify({ name: familyItemBucketPlaceholderName(level) }),
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
  // 31-03-PLAN.md Destination Selector Contract: called unconditionally
  // (hooks rule), filtered below to what the folder-scope selector actually
  // offers -- never `CollectionPicker`'s unfiltered list (see that
  // component's own header comment for why it has no access-level filter).
  const allCollections = useCollections();
  const [state, setState] = useState<DialogState>("loading-recipients");
  const [recipients, setRecipients] = useState<FamilyMemberRecord[]>([]);
  // 31-02-PLAN.md: the per-row model replaces the old shared checkbox list
  // for BOTH scopes. `rows` is the sole source of truth for "what level is
  // this recipient getting" in the non-family-wide branch — never a second,
  // divergent computation of it (T-31-06).
  const [rows, setRows] = useState<RecipientRow[]>([]);
  // FSH-01 -- "Cała rodzina" mode. Mutually exclusive with the row model:
  // checking it resets every row's pending edits back to its own true
  // current state (see `toggleFamilyWide` below), and every row's own
  // `<select>` is disabled while family-wide is active (see Row Anatomy
  // markup) -- there is never a UI state where both simultaneously drive a
  // submission.
  const [isFamilyWideSelected, setIsFamilyWideSelected] = useState(false);
  const [accessLevel, setAccessLevel] = useState<AccessLevelValue | null>(null);
  const [previousAccessLevel, setPreviousAccessLevel] = useState<AccessLevelValue | null>(null);
  // 31-02-PLAN.md (Blocker 3's fix): which row (if any) triggered the
  // shared "hidden-password-ack" DialogState -- `null` means the
  // FAMILY-WIDE radio triggered it (byte-for-byte unchanged
  // `handleSelectAccessLevel`/`handleHiddenPasswordAck`/
  // `handleHiddenPasswordCancel` own that case), a userId means a ROW's
  // own `<select>` did (the new `handleRowHiddenPasswordAck`/
  // `handleRowHiddenPasswordCancel` below own that case). The blocking
  // modal itself is the SAME shared markup/copy/per-account ack mechanism
  // either way -- only which completion handler the Ack/Cancel buttons
  // invoke depends on this.
  const [hiddenPasswordRowTarget, setHiddenPasswordRowTarget] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  // 31-03-PLAN.md's Destination Selector Contract (MOD-02/ORG-03), folder
  // scope only. `null` means "mint a new folder" (this dialog's ONLY
  // behavior before this plan, and still the default) -- a non-null value
  // is an EXISTING collection id the caller holds edit access to. Switching
  // this is what re-seeds every row's `currentLevel` from that destination's
  // real access list (T-31-10) and is what makes the folder-scope
  // update/revoke branches genuinely reachable for the first time.
  const [destinationId, setDestinationId] = useState<string | null>(null);
  // The row region's OWN loading sub-state while a destination switch's
  // `getCollectionAccessList` fetch resolves -- deliberately distinct from
  // `loading` (the dialog's initial recipient fetch): the destination
  // `<select>` itself stays interactive throughout (31-UI-SPEC.md), only the
  // row list below it shows a spinner in place of stale-destination rows.
  const [rowsLoading, setRowsLoading] = useState(false);
  // HI-03 fix (31-REVIEW.md): a destination access-list fetch failure used
  // to fail OPEN — `buildRows(recipients, new Map())` presented every
  // member as "Brak dostępu" on a destination where they might genuinely
  // hold access, a fabricated picture with no visible indication anything
  // had failed. `31-CONTEXT.md`'s locked decision is that this dialog IS
  // the access picture for the chosen destination — showing a wrong one is
  // a security-relevant lie, and it fed CR-03/CR-04's silent false
  // successes downstream (every row reconciling to `grant` instead of
  // `update`). This flag drives an explicit error state instead, with
  // `rows` left empty and submit disabled — see `handleDestinationChange`.
  const [destinationAccessUnavailable, setDestinationAccessUnavailable] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [seedMoveFailureCount, setSeedMoveFailureCount] = useState<number | null>(null);
  const [failedRecipientLabels, setFailedRecipientLabels] = useState<string[]>([]);
  // HI-02 fix (31-REVIEW.md): tracked separately from `failedRecipientLabels`
  // -- see `SubmitOutcome.failedRevocations`'s own doc comment for why a
  // failed revocation must never render `share.partialShareFailed`'s
  // grant-shaped copy.
  const [failedRevocationLabels, setFailedRevocationLabels] = useState<string[]>([]);
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
  // 31-03-PLAN.md: monotonically-increasing token guarding
  // `handleDestinationChange`'s async fetch -- a rapid second switch must
  // never let the FIRST (now-stale) `getCollectionAccessList` response
  // overwrite the rows the user's LATEST selection already requested.
  const destinationRequestRef = useRef(0);
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
    /** 31-02-PLAN.md: item-scope rows seed `currentLevel` from
     * `listItemShares` -- a genuinely new display, since the old dialog
     * never showed an item's pre-existing direct shares at all. The folder
     * scope stays `null` for every row THIS plan (mint-new only -- a
     * destination selector is 31-03's job, so there is no existing
     * destination's access list to seed from yet).
     *
     * CR-04 fix (31-REVIEW.md): used to fail OPEN (an empty map on any
     * fetch error), which made every row's `currentLevel` look like `null`
     * -- an item that in fact already has recipients rendered as shared
     * with nobody, `reconcileRowAction` classified every subsequent
     * selection as `grant` instead of `update`, and a 409 from the ensuing
     * `createItemShare` call (CR-04's own feeder) reported success while
     * the recipient's REAL level never changed. Now propagates the error
     * instead of swallowing it, so `load()`'s own surrounding try/catch
     * (below) takes the SAME fail-closed path it already uses for a
     * `me()`/`getFamilyMembers` failure -- `accountUnavailable`, empty
     * rows, submit disabled, an honest error -- rather than a second,
     * divergent "fail open" policy for this one fetch alone. */
    async function loadCurrentItemLevels(): Promise<Map<string, AccessLevelValue>> {
      if (scope.kind !== "item") return new Map();
      const shares = await listItemShares(scope.item.id);
      const map = new Map<string, AccessLevelValue>();
      for (const share of shares) {
        if (share.access_level === "read" || share.access_level === "edit" || share.access_level === "hidden_password") {
          map.set(share.user_id, share.access_level);
        }
      }
      return map;
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
          setRows([]);
          setAccountUnavailable(true);
          setSubmitError(t("share.createFailed"));
          setState("populated");
          return;
        }
        setAccountId(account.user_id);
        const others = (members ?? []).filter((m) => m.user_id !== account.user_id);
        setRecipients(others);
        const currentLevels = await loadCurrentItemLevels();
        if (!mountedRef.current) return;
        setRows(buildRows(others, currentLevels));
        setState("populated");
      } catch {
        if (!mountedRef.current) return;
        // Fail safe, never crash — nothing selectable, submit stays
        // disabled (never a lie about "no other members", just nothing to
        // act on).
        setRecipients([]);
        setRows([]);
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

  function toggleFamilyWide() {
    setIsFamilyWideSelected((prev) => {
      const next = !prev;
      if (next) {
        // Mutual exclusivity (CONTEXT.md Area 1): switching TO family-wide
        // discards any queued row edits, resetting every row back to its
        // own true current state -- a pending "brak dostępu" (or any other
        // edit) queued against the per-person model carries no meaning
        // once the submission is about to go through the family-wide path
        // instead, and leaving it queued would silently misrepresent what
        // a later switch BACK to per-person mode would show.
        setRows((prevRows) => prevRows.map((r) => ({ ...r, pendingLevel: r.currentLevel ?? "none" })));
        // 31-03-PLAN.md: family-wide keeps its own always-mint-new path
        // (`submitFolderVariant`'s `isFamilyWide` branch never reads
        // `destinationId`) -- if a per-person destination had been chosen
        // BEFORE switching to family-wide, the folder-name input would stay
        // hidden (per the Destination Selector Contract's `destinationId
        // === null` render condition) while family-wide's own submit still
        // requires a non-empty `name`, an unreachable-submit dead end.
        // Resetting back to "mint new" here keeps the two modes as
        // genuinely independent as the row-reset above already makes them.
        setDestinationId(null);
      }
      return next;
    });
  }

  /** 31-03-PLAN.md Destination Selector Contract's onChange -- `"new"` mints
   * a folder (this dialog's pre-31-03 default, restored by re-seeding every
   * row's `currentLevel` back to `null`, exactly `load()`'s own initial
   * folder-scope seed); any other value is an EXISTING collection id, whose
   * REAL current access list is fetched and used to re-seed every row's
   * `currentLevel` (Pitfall 3, T-31-10: never carries a `pendingLevel` from
   * the PREVIOUS destination forward -- `buildRows` always re-derives
   * `pendingLevel` from the freshly-fetched `currentLevel`). Fails open
   * (empty map, matching `loadCurrentItemLevels`'s own established
   * discipline) on a transient fetch error, rather than blocking the whole
   * dialog. */
  async function handleDestinationChange(value: string) {
    const requestId = ++destinationRequestRef.current;
    if (value === "new") {
      setDestinationId(null);
      setRowsLoading(false);
      setDestinationAccessUnavailable(false);
      setRows(buildRows(recipients, new Map()));
      return;
    }
    setDestinationId(value);
    setRowsLoading(true);
    setDestinationAccessUnavailable(false);
    try {
      const accessList = await getCollectionAccessList(value);
      if (!mountedRef.current || destinationRequestRef.current !== requestId) return;
      const currentLevels = new Map<string, AccessLevelValue>();
      for (const entry of accessList) {
        if (entry.access_level === "read" || entry.access_level === "edit" || entry.access_level === "hidden_password") {
          currentLevels.set(entry.user_id, entry.access_level);
        }
      }
      setRows(buildRows(recipients, currentLevels));
    } catch (err) {
      console.error(`pv: failed to fetch access list for destination ${value}`, err);
      if (!mountedRef.current || destinationRequestRef.current !== requestId) return;
      // HI-03 fix (31-REVIEW.md): fail CLOSED — never present a fabricated
      // "everyone at Brak dostępu" picture (`buildRows(recipients, new
      // Map())`'s old behavior here). Empty the rows and render an explicit
      // error instead; `submitDisabled` below is gated on this flag too.
      setRows([]);
      setDestinationAccessUnavailable(true);
    } finally {
      if (mountedRef.current && destinationRequestRef.current === requestId) {
        setRowsLoading(false);
      }
    }
  }

  /** 31-02-PLAN.md Row Anatomy: a row's own `<select>` onChange. Mirrors
   * `handleSelectAccessLevel`'s shape for the hidden-password gate (byte-
   * for-byte unchanged sibling below), generalized to a specific row's
   * OWN pendingLevel rather than the single shared `accessLevel`. */
  function handleRowLevelChange(userId: string, value: AccessLevelValue | "none") {
    if (value === "hidden_password" && (accountId === null || !hasAcknowledgedHiddenPassword(accountId))) {
      setHiddenPasswordRowTarget(userId);
      setState("hidden-password-ack");
      return;
    }
    setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, pendingLevel: value } : r)));
    // Mutual exclusivity (30-UI-SPEC.md's "Cała rodzina" Row Contract):
    // a row's own select is already disabled whenever family-wide is
    // active (it isn't even rendered -- see the Row Anatomy render
    // condition below), so this is a defensive no-op most of the time --
    // but it keeps the two modes provably exclusive at the state layer
    // too, matching this file's own established discipline.
    setIsFamilyWideSelected(false);
  }

  /** The row-triggered sibling of `handleHiddenPasswordAck` below (Blocker
   * 3's re-anchoring) -- same per-account ack persistence, but completes
   * the ROW's own pendingLevel change rather than the family-wide
   * `accessLevel` one. */
  function handleRowHiddenPasswordAck() {
    if (accountId !== null) {
      setAcknowledgedHiddenPassword(accountId);
    }
    const userId = hiddenPasswordRowTarget;
    if (userId !== null) {
      setRows((prev) => prev.map((r) => (r.userId === userId ? { ...r, pendingLevel: "hidden_password" } : r)));
    }
    setHiddenPasswordRowTarget(null);
    setState("populated");
  }

  /** The row-triggered sibling of `handleHiddenPasswordCancel` below.
   * Nothing to revert -- the row's `pendingLevel` was never written until
   * Ack (mirrors `handleSelectAccessLevel`'s own "don't commit until
   * acknowledged" shape), so cancelling is simply closing the modal. */
  function handleRowHiddenPasswordCancel() {
    setHiddenPasswordRowTarget(null);
    setState("populated");
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
    grant:
      | { isFamilyWide: true; recipients: FamilyMemberRecord[]; level: AccessLevelValue }
      | { isFamilyWide: false; rows: RecipientRow[] },
  ): Promise<SubmitOutcome> {
    const uk = getUnlockedUserKey();
    if (uk === null) {
      throw new Error("cannot share while the vault is locked");
    }
    await initCrypto();
    const itemRows = await listItems();
    const row = itemRows.find((r) => r.id === item.id);
    if (row === undefined) {
      throw new Error(`cannot share item ${item.id} — item not found in the caller's own vault listing`);
    }
    if (grant.isFamilyWide) {
      return await submitItemFamilyWide(item, row, grant.recipients, grant.level, uk);
    }
    // HI-06 fix (31-REVIEW.md): mirrors `submitFolderVariant`'s identical
    // upfront `assertRecipientsHavePublicKeys` guard (see that call site's
    // own doc comment for the T-25-16 rationale) -- this check used to run
    // only INSIDE `shareItemWithRecipients`'s per-recipient loop, so a
    // keyless row at position N left rows 1..N-1 already dispatched by the
    // time it threw. Runs to completion BEFORE any network call, for every
    // grant-actionable row, so a bad recipient never leaves a partially
    // shared item behind — same discipline, same place in the call graph as
    // the folder scope already has.
    const grantRows = grant.rows.filter(
      (r) => reconcileRowAction(r.currentLevel, r.pendingLevel).kind === "grant",
    );
    assertRecipientsHavePublicKeys(
      grantRows.map((r) => ({ user_id: r.userId, public_key: r.publicKey })),
    );
    return await submitItemRows(item.id, row.enc_key, grant.rows, uk);
  }

  /** 30-12 (FSH-01's "or an item" clause): a family-wide share of a BARE item
   * is collection-scoped, never a direct `item_shares` row — the item is
   * moved into the `item_bucket` collection declared at this share's OWN
   * chosen level (260812-01e: up to three per family, one per level) and
   * the bucket's key is granted to every current active member, so a LATER
   * joiner reads it through the exact same invite-wrap / lazy-reseal path a
   * family-wide folder already uses (a per-recipient `item_shares` row
   * could never do that: it names recipients who exist today).
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
      // Family-wide is always a GRANT-only path (30-08/30-12's own doc
      // comments) -- never revoke/update, so `failedRevocations` is always
      // empty here.
      return { failedRecipients, failedRevocations: [], seedMoveFailures: 0, committedAnything: true };
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
   * `isFamilyWide` (30-08, FSH-01): when `true`, `grant.recipients` is the
   * FULL current active family roster (minus the caller) — the checkbox
   * selects a MODE, not a recipient list. T-25-16's throw-before-network
   * discipline stays UNCHANGED for the row path (`isFamilyWide === false`)
   * — it exists because each row's level was explicitly chosen, and a
   * silent drop would defeat an explicit user choice. A family-wide set is
   * never explicitly picked per-person, so a keyless member here is
   * structurally the same shape as a not-yet-joined member: OMITTED from
   * this creation-time grant rather than aborting the whole share, and
   * picked up later by the SAME lazy-reseal trigger (30-13) a gap-window
   * invitee already uses once they publish a key.
   *
   * 31-02-PLAN.md: the row path's grant/update/revoke dispatch lives in
   * `submitRowsForCollection` — for a mint-new folder every row's
   * `currentLevel` is always `null`, so only the grant branch is reachable
   * there.
   *
   * 31-03-PLAN.md: `destinationId !== null` (the row path targeting an
   * EXISTING destination) short-circuits entirely into
   * `submitRowsForExistingDestination` below, BEFORE any of this function's
   * mint-new machinery (`createdCollectionRef`, `ensureOwnIdentityKeypair`,
   * `createCollection`, the seed-move sub-step) runs — there is no
   * collection to create, no `WasmCollectionKey` this function itself needs
   * to manage (each row's grant unwraps/reseals its own via
   * `reshareCollectionToNewMember`), and 31-UI-SPEC.md's Destination
   * Selector Contract never renders the folder-name/seed-summary inputs
   * `seed`/`name` describe once an existing destination is chosen — so
   * neither parameter is meaningful on this branch. `isFamilyWide` NEVER
   * takes this branch (see its own doc comment above: family-wide keeps its
   * pre-existing always-mint-new path, untouched by this plan). */
  async function submitFolderVariant(
    name: string,
    seed: { id: string; itemCount: number } | null,
    destinationId: string | null,
    grant:
      | { isFamilyWide: true; recipients: FamilyMemberRecord[]; level: AccessLevelValue }
      | { isFamilyWide: false; rows: RecipientRow[] },
  ): Promise<SubmitOutcome> {
    const uk = getUnlockedUserKey();
    if (uk === null) {
      throw new Error("cannot share while the vault is locked");
    }
    await initCrypto();
    // T-25-16 applies to the row path only — see the `isFamilyWide` doc
    // comment above for why the family-wide path deliberately diverges
    // (omits rather than throws). Applies identically whether the row path
    // targets a mint-new or an EXISTING destination — an explicitly chosen
    // recipient with no published key must never be silently dropped
    // either way.
    if (!grant.isFamilyWide) {
      const grantRows = grant.rows.filter(
        (r) => reconcileRowAction(r.currentLevel, r.pendingLevel).kind === "grant",
      );
      assertRecipientsHavePublicKeys(
        grantRows.map((r) => ({ user_id: r.userId, public_key: r.publicKey })),
      );
    }

    // 31-03-PLAN.md: the existing-destination row path short-circuits here,
    // before any mint-new machinery below runs.
    if (!grant.isFamilyWide && destinationId !== null) {
      const { failedRecipients, failedRevocations, committedAnything } = await submitRowsForExistingDestination(
        destinationId,
        grant.rows,
        uk,
      );
      return { failedRecipients, failedRevocations, seedMoveFailures: 0, committedAnything };
    }

    const grantRecipients = grant.isFamilyWide ? withPublishedPublicKey(grant.recipients) : [];

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
          // the level here is the SAME level `grantCollectionToRecipients`
          // below hands every other member — this is what makes it survive
          // past creation time for later propagation paths to read, instead
          // of only ever being visible via the creator's own hard-coded
          // `'edit'` `collection_keys` row.
          await createCollection(
            newCollectionId,
            encName,
            sealedKeyForSelf,
            grant.isFamilyWide ? "folder" : undefined,
            grant.isFamilyWide ? grant.level : undefined,
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

      // 30-12: the family-wide loop (and its 409-is-success-for-that-
      // recipient rule) lives in the shared `grantCollectionToRecipients`
      // helper; the row path's grant/update/revoke dispatch lives in
      // `submitRowsForCollection` (31-02-PLAN.md) — the two can never grant
      // at a different level than what their own model shows, since each
      // reads its OWN state.
      // Family-wide is grant-only (see `submitItemFamilyWide`'s identical
      // note) -- `failedRevocations` is always empty on that branch.
      const { failedRecipients, failedRevocations } = grant.isFamilyWide
        ? { failedRecipients: await grantCollectionToRecipients(collectionId, newCk, grantRecipients, grant.level), failedRevocations: [] as string[] }
        : await submitRowsForCollection(collectionId, newCk, grant.rows);

      let failures = 0;
      if (seed !== null) {
        const seedItems = getItems().filter(
          (i) => i.fields.folderId === seed.id && !movedItemIds.has(i.id),
        );
        const itemRows = await listItems();
        for (const item of seedItems) {
          try {
            const row = itemRows.find((r) => r.id === item.id);
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
      return { failedRecipients, failedRevocations, seedMoveFailures: failures, committedAnything: true };
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

  /** ME-01 fix (31-REVIEW.md): re-fetches the CURRENT access picture and
   * rebuilds `rows` after a PARTIAL submit outcome, before the user is
   * invited to retry. `handleSubmit` used to leave `rows` exactly as they
   * were at submit time — so a retry (which `share.partialShareFailed`'s own
   * copy explicitly invites: "ponowna próba ich nie zduplikuje") re-dispatched
   * an action for every row that ALREADY succeeded too: a revocation that
   * genuinely landed (204, `currentLevel` now stale-null) got re-sent,
   * 404'd (`revoke_access`'s own not-found-on-retry semantics), and was
   * reported as a NEW failure on the very submit meant to be an honest
   * retry — noise that could bury the row that is genuinely still failing.
   * Best-effort: a failure to refresh here leaves `rows` as-is rather than
   * blocking the retry the user is being invited to make. */
  async function refreshRowsAfterPartialSubmit(): Promise<void> {
    try {
      let freshLevels: Map<string, AccessLevelValue>;
      if (scope.kind === "item") {
        const shares = await listItemShares(scope.item.id);
        freshLevels = new Map();
        for (const share of shares) {
          if (share.access_level === "read" || share.access_level === "edit" || share.access_level === "hidden_password") {
            freshLevels.set(share.user_id, share.access_level);
          }
        }
      } else {
        // Folder scope: the collection whose access list is now
        // authoritative is either the chosen EXISTING destination, or
        // (mint-new path) the collection this dialog session already
        // created.
        const targetCollectionId = destinationId ?? createdCollectionRef.current?.id ?? null;
        if (targetCollectionId === null) {
          // Family-wide has no rows to refresh (no per-person model there).
          return;
        }
        const accessList = await getCollectionAccessList(targetCollectionId);
        freshLevels = new Map();
        for (const entry of accessList) {
          if (entry.access_level === "read" || entry.access_level === "edit" || entry.access_level === "hidden_password") {
            freshLevels.set(entry.user_id, entry.access_level);
          }
        }
      }
      if (!mountedRef.current) return;
      // Refreshes ONLY `currentLevel` from the server's real state — NEVER
      // re-seeds `pendingLevel` via `buildRows` (which would reset it to
      // match the fresh `currentLevel` for EVERY row, silently discarding
      // the user's still-pending selection for whichever row genuinely
      // still needs a retry). A row whose action already landed converges
      // on its own: `currentLevel` now equals `pendingLevel`, so
      // `reconcileRowAction` correctly re-classifies it as a no-op on the
      // next submit; a row that is still failing keeps the exact
      // `pendingLevel` the user chose, so the retry re-attempts the SAME
      // action rather than silently reverting to "Brak dostępu".
      setRows((prev) => prev.map((r) => ({ ...r, currentLevel: freshLevels.get(r.userId) ?? null })));
    } catch (err) {
      console.error("pv: failed to refresh the access picture after a partial submit", err);
    }
  }

  async function handleSubmit() {
    // 30-12: family-wide is now a submit path for BOTH variants — the folder
    // one creates a `family_wide_kind: 'folder'` collection (30-08), the item
    // one moves the item into the single per-family `item_bucket` collection.
    const familyWideSubmit = isFamilyWideSelected;
    // 31-02-PLAN.md: `accessLevel` gates ONLY the family-wide branch now —
    // the row path's own readiness is `hasActionableRow` below, since each
    // row carries its own level rather than one shared one.
    if (familyWideSubmit && accessLevel === null) return;
    if (!familyWideSubmit && !hasActionableRow) return;
    // 31-03-PLAN.md: the folder-name field is never rendered once an
    // EXISTING destination is chosen (31-UI-SPEC.md's Destination Selector
    // Contract) -- requiring it in that state would block a submit the UI
    // never asked for. `toggleFamilyWide` resets `destinationId` back to
    // `null` the moment family-wide is switched on, so `destinationId ===
    // null` alone is sufficient here -- family-wide always mints, and by
    // that reset it always does so with `destinationId === null` too.
    if (isFolder && destinationId === null && folderName.trim() === "") return;

    setState("sharing");
    setSubmitError(null);
    setSeedMoveFailureCount(null);
    setFailedRecipientLabels([]);
    setFailedRevocationLabels([]);
    setFamilyKeyPending(false);
    try {
      let outcome: SubmitOutcome;
      if (scope.kind === "item" && familyWideSubmit) {
        outcome = await submitItemVariant(scope.item, {
          isFamilyWide: true,
          recipients: await resolveCurrentFamilyRecipients(),
          level: accessLevel as AccessLevelValue,
        });
      } else if (scope.kind === "item") {
        outcome = await submitItemVariant(scope.item, { isFamilyWide: false, rows });
      } else if (familyWideSubmit) {
        const familyRecipients = await resolveCurrentFamilyRecipients();
        outcome = await submitFolderVariant(folderName.trim(), seedFolder, destinationId, {
          isFamilyWide: true,
          recipients: familyRecipients,
          level: accessLevel as AccessLevelValue,
        });
      } else {
        outcome = await submitFolderVariant(folderName.trim(), seedFolder, destinationId, {
          isFamilyWide: false,
          rows,
        });
      }
      if (!mountedRef.current) return;
      if (
        outcome.failedRecipients.length === 0 &&
        outcome.failedRevocations.length === 0 &&
        outcome.seedMoveFailures === 0
      ) {
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
      if (outcome.failedRecipients.length > 0 || outcome.failedRevocations.length > 0) {
        if (outcome.committedAnything) {
          // Partial: name exactly who missed out, and say plainly that the
          // successful grants already exist so the retry is honest.
          //
          // HI-02 fix (31-REVIEW.md): the two lists render through
          // DIFFERENT, action-appropriate copy -- both can be non-empty in
          // the SAME submit (some rows granted/updated, others revoked, a
          // mix of each landed and failed), so both are set independently
          // rather than one overwriting the other.
          if (outcome.failedRecipients.length > 0) {
            setFailedRecipientLabels(outcome.failedRecipients);
          }
          if (outcome.failedRevocations.length > 0) {
            setFailedRevocationLabels(outcome.failedRevocations);
          }
          // ME-01 fix (31-REVIEW.md): re-seed `rows` from the server's real
          // current state before the user retries -- best-effort,
          // fire-and-forget (never blocks the error message from
          // rendering); see this function's own doc comment above.
          void refreshRowsAfterPartialSubmit();
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
      } else if (err instanceof DestinationUnavailableError) {
        // 31-06-PLAN.md (SC5): the caller's own access to the chosen
        // existing destination is gone (a concurrent revoke mid-session).
        // Deliberately NOT `share.createFailed` -- retrying cannot succeed
        // until access is restored. Renders in the same `share-error` slot,
        // inside the STILL-MOUNTED dialog (setState below keeps it open).
        setSubmitError(t("share.destinationUnavailable"));
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
  // fallback, kept for the FAMILY-WIDE branch's own inline note (still
  // driven by the single shared `accessLevel`, isolated per Blocker 1's
  // fix below). Family-wide is a MODE, never a per-person selection, so
  // this always resolves to the generic fallback subject -- exactly what
  // the old shared computation ALSO always produced in family-wide mode
  // (`selectedRecipientIds` stayed empty there by construction).
  const hiddenPasswordNoteSubject = t("share.hiddenPasswordRecipientFallback");

  // 31-02-PLAN.md (Blocker 3's fix): the ROW model's own inline-note
  // subject, re-scoped from `selectedRecipientIds` to "rows currently at
  // hidden_password" -- the note's trigger/subject now derives from the
  // SAME state the actual dispatch reads (T-31-08), never a second,
  // divergent computation of "who is this about".
  const rowsAtHiddenPassword = rows.filter((r) => r.pendingLevel === "hidden_password");
  const rowHiddenPasswordNoteSubject =
    rowsAtHiddenPassword.length === 1
      ? rowsAtHiddenPassword[0].email
      : t("share.hiddenPasswordRecipientFallback");

  // 31-04-PLAN.md (MOD-01's sixth proof obligation, T-31-13): the
  // pending-revocations honesty summary's {count}/{names} derive from the
  // EXACT same `rows` state `reconcileRow` dispatches from -- never a
  // second, independently-computed list. A "real queued revocation" is a
  // row whose pendingLevel is "none" while its currentLevel already holds a
  // grant (mirrors `reconcileRowAction`'s own revoke branch, line ~166);
  // this is deliberately NOT `reconcileRowAction(...).kind === "revoke"`
  // itself to avoid importing a second meaning for "revoke" into render
  // logic, but the predicate is identical by construction.
  const pendingRevocationRows = rows.filter(
    (r) => r.pendingLevel === "none" && r.currentLevel !== null,
  );

  // 31-02-PLAN.md: the row path's own readiness -- at least one row's
  // reconciled action is not a no-op (a fresh grant, an in-place level
  // edit, or a revocation of an existing grant).
  const hasActionableRow = rows.some(
    (r) => reconcileRowAction(r.currentLevel, r.pendingLevel).kind !== "noop",
  );
  // Mutual exclusivity, the row-model direction: once any row carries a
  // QUEUED edit, "Cała rodzina" is unavailable -- exactly the reverse of the
  // row `<select>`s being disabled while family-wide is active below.
  //
  // HI-05 fix (31-REVIEW.md): used to be `r.pendingLevel !== "none"`, which
  // `buildRows` initializes to `currentLevel ?? "none"` -- true from the
  // moment the dialog paints for ANY row that already has a grant (any
  // already-shared item, or any existing destination with >=1 member), so
  // "Cała rodzina" rendered permanently disabled before the user touched
  // anything. 31-CONTEXT.md's mutual-exclusivity rule is about PENDING
  // edits, not pre-existing server state — gates on the SAME `hasActionableRow`
  // predicate two lines above (a queued change, i.e. `reconcileRowAction`'s
  // kind is not `noop`), never a second, divergent computation of "is
  // anything happening here".
  const anyRowActive = hasActionableRow;

  // 31-UI-SPEC.md's Destination Selector Contract: the SAME predicate
  // `SharingOverviewPanel.tsx:315`'s own "By folder" tab already uses for
  // "collections I manage" -- narrower than `CollectionPicker`'s unfiltered
  // list on purpose, since selecting a read-only or `item_bucket` folder
  // here would produce a call that cannot succeed (`RequireEdit`/
  // `may_grant_access_level` server-side, and `collections::revoke_access`
  // refuses `item_bucket` outright per the constraint 260812-01e
  // introduced).
  //
  // CR-02 fix (31-REVIEW.md): excludes EVERY family-wide collection, not
  // only `item_bucket` -- a family-wide FOLDER's own creator row is
  // hardcoded `edit` (`collections::create`), so it used to slip through
  // this filter indistinguishable from an ordinary shared folder. Its
  // membership is governed by family membership + the lazy-reseal
  // machinery (`family_wide_pending`), never by this per-person model:
  // setting a member's row to "Brak dostępu" against a family-wide folder
  // 204'd, then silently self-reverted on the very next keyholder unlock
  // (that member matches `family_wide_pending`'s `resealable` set again the
  // instant their `collection_keys` row is gone) -- exactly the dishonesty
  // the sixth proof obligation ("brak dostępu really revokes") exists to
  // prevent. A family-wide collection is reachable through this dialog only
  // via the "Cała rodzina" mode, never as a per-person destination.
  const editableExistingFolders = allCollections.filter(
    (c) => c.accessLevel === "edit" && c.familyWideKind === null,
  );

  // 31-05-PLAN.md (MOD-01): "editing an existing access picture" vs. a
  // genuinely fresh share. Folder scope: an EXISTING destination is
  // selected (`destinationId !== null`, per 31-03's selector) -- that
  // folder is already shared with someone by construction, regardless of
  // this dialog session's own pending edits. Item scope: at least one
  // row's CURRENT (not pending) level is non-null, i.e. `listItemShares`
  // (31-02) already found a standing recipient for this item. Either
  // condition means the action is reconciling WHO can see it, never
  // "sharing" it for the first time.
  const hasExistingItemRecipient = !isFolder && rows.some((r) => r.currentLevel !== null);
  const ctaKey =
    (isFolder && destinationId !== null) || hasExistingItemRecipient
      ? "share.ctaSaveAccess"
      : isFolder
        ? "share.ctaFolder"
        : "share.ctaItem";
  // 30-12: BOTH variants now have a real family-wide submit path (the item
  // one routes through the per-family `item_bucket` collection), so this is
  // no longer gated on `isFolder` — 30-08's temporary "rendered but not yet
  // wired, so keep submit disabled" guard has been discharged by its
  // implementation rather than merely relaxed.
  const familyWideSubmittable = isFamilyWideSelected;
  const submitDisabled =
    sharing ||
    // 31-03-PLAN.md: a destination-switch fetch is in flight -- the rows on
    // screen are not yet this destination's real current state, so nothing
    // reconciled from them right now would be trustworthy.
    rowsLoading ||
    accountUnavailable ||
    // HI-03 fix (31-REVIEW.md): the destination's real access picture could
    // not be loaded — never let a submit reconcile against `rows` this
    // dialog knows is empty/wrong.
    destinationAccessUnavailable ||
    (familyWideSubmittable ? accessLevel === null : !hasActionableRow) ||
    (isFolder && destinationId === null && folderName.trim() === "");

  return (
    <div
      data-testid="share-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={sharing ? undefined : onClose}
    >
      {/* 31-UI-SPEC.md's Scale & Scroll Contract: the card itself is the
          single scroll container (`max-h-[85vh] flex-col`); the footer is
          pinned OUTSIDE the scrolling body via `shrink-0`. No nested
          scroll regions -- the row list does NOT get its own separate
          `max-h`/`overflow-y-auto` (the old checkbox list did), so the
          SAME gesture that reveals the last row also reveals the
          hidden-password note and pending-revocations summary beneath it. */}
      <div
        className="flex max-h-[85vh] w-full max-w-[400px] flex-col rounded-box border border-base-300 bg-base-100"
        onClick={(e) => e.stopPropagation()}
      >
        {hiddenPasswordAck ? (
          <div className="flex flex-col gap-4 p-6">
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
                onClick={hiddenPasswordRowTarget !== null ? handleRowHiddenPasswordCancel : handleHiddenPasswordCancel}
              >
                {t("delete.cancel")}
              </button>
              <button
                type="button"
                data-testid="share-hidden-password-ack-confirm"
                className="btn btn-primary"
                onClick={hiddenPasswordRowTarget !== null ? handleRowHiddenPasswordAck : handleHiddenPasswordAck}
              >
                {t("share.hiddenPasswordDisclosureAck")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-4 overflow-y-auto p-6">
              <h2 className="truncate text-[20px] font-bold leading-[1.2]" title={dialogTitle}>
                {dialogTitle}
              </h2>

              {loading ? (
                <div className="flex flex-col items-center justify-center gap-3 py-8" data-testid="share-loading">
                  <span className="loading loading-spinner loading-lg" aria-hidden="true" />
                </div>
              ) : (
                <>
                {/* 31-UI-SPEC.md's Destination Selector Contract (MOD-02/
                    ORG-03): folder scope only, rendered ABOVE the row list
                    (and above the folder-name input, which only makes sense
                    once "mint new" is the chosen destination) -- it must
                    come first because it determines what the rows below
                    show.

                    HI-04 fix (31-REVIEW.md): hidden entirely when
                    `seedFolder !== null` -- opened from Sidebar's
                    "Udostępnij ten folder" on an EXISTING personal folder,
                    the dialog title (`share.folderDialogTitleExisting`)
                    names THAT folder, and `submitFolderVariant`'s seed-move
                    sub-step only ever moves ITS items into a MINT-NEW
                    collection. Picking an existing destination here used to
                    short-circuit straight into `submitRowsForExistingDestination`,
                    silently skipping the seed-move entirely -- the personal
                    folder stayed untouched and personal while the dialog's
                    own title kept claiming it was the thing being shared.
                    The seeded flow is inherently mint-new; this is the
                    honest minimum (31-REVIEW.md's own recommended option
                    (a)), not a narrower title/copy patch. */}
                {isFolder && seedFolder === null ? (
                  <div className="flex flex-col gap-1">
                    <label htmlFor="share-destination-select" className="text-sm font-bold">
                      {t("share.destinationLabel")}
                    </label>
                    <select
                      id="share-destination-select"
                      data-testid="share-destination-select"
                      className="select select-bordered w-full"
                      value={destinationId ?? "new"}
                      disabled={sharing}
                      onChange={(e) => void handleDestinationChange(e.target.value)}
                    >
                      <optgroup label={t("share.destinationNewGroupLabel")}>
                        <option value="new">{t("share.destinationNewFolderOption")}</option>
                      </optgroup>
                      {editableExistingFolders.length > 0 ? (
                        <optgroup label={t("share.destinationExistingGroupLabel")}>
                          {editableExistingFolders.map((c) => (
                            <option key={c.id} value={c.id} title={c.name}>
                              {c.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                  </div>
                ) : null}

                {isFolder && destinationId === null ? (
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
                    disabled={sharing || anyRowActive}
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
                ) : isFamilyWideSelected ? null : rowsLoading ? (
                  // 31-03-PLAN.md: the row region's OWN loading sub-state
                  // while a destination switch's access-list fetch resolves
                  // -- the destination `<select>` above stays interactive
                  // throughout (its own `disabled={sharing}` is unaffected).
                  <div
                    className="flex items-center justify-center py-6"
                    data-testid="share-rows-loading"
                  >
                    <span className="loading loading-spinner loading-md" aria-hidden="true" />
                  </div>
                ) : destinationAccessUnavailable ? (
                  // HI-03 fix (31-REVIEW.md): an honest error in place of
                  // the row list -- never the old fabricated "everyone at
                  // Brak dostępu" picture. Submit stays disabled while this
                  // is shown (see `submitDisabled` above).
                  <p
                    role="alert"
                    data-testid="share-destination-access-unavailable"
                    className="text-sm text-error"
                  >
                    {t("share.destinationAccessUnavailable")}
                  </p>
                ) : (
                  /* 31-UI-SPEC.md Row Anatomy (MOD-01) -- one standing row
                     per family member, BOTH scopes, replacing the old
                     shared checkbox list ENTIRELY. No nested scroller (see
                     the Scale & Scroll Contract comment above the outer
                     card) -- this list is part of the single scrolling
                     body. */
                  <ul className="flex flex-col divide-y divide-base-300" data-testid="share-recipient-list">
                    {rows.map((row) => (
                      <li
                        key={row.userId}
                        data-testid={`share-recipient-row-${row.userId}`}
                        className="flex items-center gap-2 py-2"
                      >
                        {row.currentLevel !== null ? (
                          <UserCheck size={14} className="shrink-0 text-secondary" aria-hidden="true" />
                        ) : (
                          <span className="w-[14px] shrink-0" aria-hidden="true" />
                        )}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm" title={row.email}>
                            {row.email}
                          </span>
                          {row.currentLevel !== null ? (
                            <span
                              data-testid={`share-recipient-row-currently-${row.userId}`}
                              className="text-sm text-base-content/60"
                            >
                              {interpolate(t("share.rowCurrentlyLabel"), {
                                level: t(accessLevelKey(row.currentLevel)),
                              })}
                            </span>
                          ) : null}
                          {row.suspended ? (
                            <span className="badge badge-warning badge-outline w-fit">
                              {t("family.statusSuspended")}
                            </span>
                          ) : null}
                          {row.publicKey === null ? (
                            <span
                              data-testid={`share-recipient-row-nokey-${row.userId}`}
                              className="text-sm text-base-content/60"
                            >
                              {t("share.rowNoPublishedKey")}
                            </span>
                          ) : null}
                        </span>
                        {row.pendingLevel === "none" && row.currentLevel !== null ? (
                          <UserMinus size={14} className="shrink-0 text-error" aria-hidden="true" />
                        ) : null}
                        <select
                          data-testid={`share-recipient-row-select-${row.userId}`}
                          className="select select-bordered select-sm w-40 shrink-0"
                          value={row.pendingLevel}
                          // ME-03 fix (31-REVIEW.md): used to disable
                          // whenever `publicKey === null`, regardless of
                          // `currentLevel` -- a member who HOLDS a grant but
                          // has since lost their published keypair rendered
                          // "Currently: Pełna edycja" behind a frozen
                          // control, with no way to revoke them from the
                          // one surface that is supposed to be the
                          // authoritative access picture. A fresh GRANT
                          // genuinely needs the recipient's public key (to
                          // seal key material to them) -- an UPDATE or
                          // REVOKE of an EXISTING grant does not (neither
                          // `update_access`/`update_share` nor
                          // `revoke_access`/`revoke_share` touch
                          // `sealed_key` at all). Only disable when there is
                          // both no key AND no existing grant to act on.
                          disabled={sharing || (row.publicKey === null && row.currentLevel === null)}
                          onChange={(e) =>
                            handleRowLevelChange(row.userId, e.target.value as AccessLevelValue | "none")
                          }
                        >
                          <option value="none">{t("access.none")}</option>
                          <option value="read">{t("access.readOnly")}</option>
                          <option value="edit">{t("access.fullEdit")}</option>
                          <option value="hidden_password">{t("access.hiddenPassword")}</option>
                        </select>
                      </li>
                    ))}
                  </ul>
                )}
                {!isFamilyWideSelected && rowsAtHiddenPassword.length > 0 ? (
                  <p data-testid="share-hidden-password-inline-note" className="text-sm text-base-content/70">
                    {interpolate(t("share.hiddenPasswordInlineNote"), {
                      recipient: rowHiddenPasswordNoteSubject,
                    })}
                  </p>
                ) : null}

                {/* Blocker 1's fix: this control (state, handlers, submit
                    logic) is family-wide's OWN, isolated from the row model
                    above -- rendered and read ONLY when `isFamilyWideSelected`.
                    `accessLevel`/`setAccessLevel`/`previousAccessLevel`/
                    `handleSelectAccessLevel`/`handleHiddenPasswordAck`/
                    `handleHiddenPasswordCancel` stay byte-for-byte the same
                    functions this dialog has always had; only THIS render
                    condition is new. */}
                {isFamilyWideSelected ? (
                  <>
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
                  </>
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
                {/* HI-02 fix (31-REVIEW.md): a DISTINCT testid/message from
                    `share-partial-error` above -- a failed revocation must
                    never render the grant-shaped "the other grants already
                    went through" copy, which states the opposite of the
                    truth for a revocation. Renders ALONGSIDE
                    `share-partial-error` when a single submit produced
                    both kinds of failure. */}
                {failedRevocationLabels.length > 0 ? (
                  <p role="alert" data-testid="share-partial-revoke-error" className="text-sm text-error">
                    {interpolate(t("share.partialRevokeFailed"), {
                      recipients: failedRevocationLabels.join(", "),
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
                {/* 31-UI-SPEC.md Copywriting Contract + Focal Point: the
                    LAST thing seen before the footer, deliberately -- its
                    position (immediately preceding Save) is part of its
                    function, the final honest statement read before
                    committing. Gated on `!isFamilyWideSelected` since rows
                    (and therefore a "real queued revocation") only exist in
                    that mode -- "Cała rodzina" has no rows. Icon+color
                    mirrors `RevokeShareDialog.tsx`'s own AlertTriangle/
                    text-error pairing; the paragraph reuses
                    `RevokeShareDialog.tsx:132`'s `text-base` class verbatim
                    -- the SAME weight-class as that dialog's own single most
                    load-bearing honesty sentence. No second confirm dialog
                    opens (Copywriting Contract's "Revocation confirmation"
                    row) -- this summary plus each row's own UserMinus icon
                    carry the honesty weight together. */}
                {!isFamilyWideSelected && pendingRevocationRows.length > 0 ? (
                  <div
                    role="status"
                    aria-live="polite"
                    data-testid="share-pending-revocations-summary"
                    className="flex items-center gap-3"
                  >
                    <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
                    <p className="text-base">
                      {interpolate(t("share.pendingRevocationsSummary"), {
                        count: String(pendingRevocationRows.length),
                        names: pendingRevocationRows.map((r) => r.email).join(", "),
                      })}
                    </p>
                  </div>
                ) : null}
                </>
              )}
            </div>
            {/* Scale & Scroll Contract: Cancel/Save are OUTSIDE the
                scrolling body (`shrink-0`) -- reachable without scrolling
                at any row count or viewport size. Absent entirely while
                `loading` (matches this dialog's own pre-existing
                behavior: only the spinner shows until the recipient/row
                data resolves). */}
            {loading ? null : (
              <div className="flex shrink-0 justify-end gap-2 border-t border-base-300 p-4">
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
            )}
          </>
        )}
      </div>
    </div>
  );
}
