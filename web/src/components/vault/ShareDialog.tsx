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
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { getFamilyMembers, type FamilyMemberRecord } from "@/lib/families/api";
import { accessLevelKey } from "@/lib/families/accessLevel";
import {
  createCollection,
  moveItemToCollection,
  listItems,
  createItemShare,
  addCollectionMember,
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
  const [accessLevel, setAccessLevel] = useState<AccessLevelValue | null>(null);
  const [previousAccessLevel, setPreviousAccessLevel] = useState<AccessLevelValue | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [folderName, setFolderName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [seedMoveFailureCount, setSeedMoveFailureCount] = useState<number | null>(null);
  const [failedRecipientLabels, setFailedRecipientLabels] = useState<string[]>([]);
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
    const failedRecipients = await shareItemWithRecipients(item.id, row.enc_key, selected, level, uk);
    return {
      failedRecipients,
      seedMoveFailures: 0,
      // Nothing durable landed only when EVERY selected recipient failed —
      // in that case `handleSubmit` may honestly report total failure.
      committedAnything: failedRecipients.length < selected.length,
    };
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
   * so the retry is genuinely idempotent. */
  async function submitFolderVariant(
    name: string,
    selected: FamilyMemberRecord[],
    level: AccessLevelValue,
    seed: { id: string; itemCount: number } | null,
  ): Promise<SubmitOutcome> {
    const uk = getUnlockedUserKey();
    if (uk === null) {
      throw new Error("cannot share while the vault is locked");
    }
    await initCrypto();
    // T-25-16, applied identically to the folder variant — before ANY
    // network call, including `createCollection`.
    assertRecipientsHavePublicKeys(selected);

    const identityKey = await ensureOwnIdentityKeypair(uk);
    const recipientHandles: WasmIdentityPublicKey[] = [];
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
          await createCollection(newCollectionId, encName, sealedKeyForSelf);
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

      const failedRecipients: string[] = [];
      for (const recipient of selected) {
        const recipientPk = WasmIdentityPublicKey.fromBytes(base64Decode(recipient.public_key as string));
        recipientHandles.push(recipientPk);
        try {
          const sealedKey = sealCollectionKey(recipientPk, newCk);
          await addCollectionMember(collectionId, recipient.user_id, sealedKey, level);
        } catch (err) {
          // 409 == this recipient already holds this collection grant (a
          // previous attempt's partial success). Not a failure to report.
          if (!isConflictError(err)) {
            console.error(`pv: failed to grant collection ${collectionId} to ${recipient.user_id}`, err);
            failedRecipients.push(recipient.email);
          }
        }
      }

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
      recipientHandles.forEach((pk) => pk.free?.());
      identityKey.free?.();
    }
  }

  async function handleSubmit() {
    const selected = recipients.filter((r) => selectedRecipientIds.has(r.user_id));
    if (accessLevel === null || selected.length === 0) return;
    if (isFolder && folderName.trim() === "") return;

    setState("sharing");
    setSubmitError(null);
    setSeedMoveFailureCount(null);
    setFailedRecipientLabels([]);
    try {
      const outcome =
        scope.kind === "item"
          ? await submitItemVariant(scope.item, selected, accessLevel)
          : await submitFolderVariant(folderName.trim(), selected, accessLevel, seedFolder);
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
    } catch {
      if (!mountedRef.current) return;
      setSubmitError(t("share.createFailed"));
      setState("populated");
    }
  }

  const loading = state === "loading-recipients";
  const sharing = state === "sharing";
  const hiddenPasswordAck = state === "hidden-password-ack";

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
  const submitDisabled =
    sharing ||
    accountUnavailable ||
    accessLevel === null ||
    selectedRecipientIds.size === 0 ||
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
                          disabled={sharing}
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

                {submitError !== null ? (
                  <p role="alert" data-testid="share-error" className="text-sm text-error">
                    {submitError}
                  </p>
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
