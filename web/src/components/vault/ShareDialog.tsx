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
 */
export async function shareItemWithRecipients(
  itemId: string,
  encKeyJson: string,
  recipients: { user_id: string; public_key: string | null }[],
  accessLevel: string,
  uk: WasmUserKey,
): Promise<void> {
  assertRecipientsHavePublicKeys(recipients);
  for (const recipient of recipients) {
    let recipientPk: WasmIdentityPublicKey | undefined;
    try {
      recipientPk = WasmIdentityPublicKey.fromBytes(base64Decode(recipient.public_key as string));
      const sealedKey = sealItemKeyForRecipient(uk, encKeyJson, itemId, recipientPk);
      await createItemShare(itemId, recipient.user_id, sealedKey, accessLevel);
    } finally {
      recipientPk?.free?.();
    }
  }
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
  const mountedRef = useRef(true);

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
    async function load() {
      setState("loading-recipients");
      try {
        const [account, members] = await Promise.all([me().catch(() => null), getFamilyMembers()]);
        if (!mountedRef.current) return;
        setAccountId(account?.user_id ?? null);
        const others = (members ?? []).filter((m) => m.user_id !== account?.user_id);
        setRecipients(others);
        setState("populated");
      } catch {
        if (!mountedRef.current) return;
        // Fail safe, never crash — nothing selectable, submit stays
        // disabled (never a lie about "no other members", just nothing to
        // act on).
        setRecipients([]);
        setState("populated");
      }
    }
    void load();
    return () => {
      mountedRef.current = false;
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

  /** Returns 0 always — the item variant has no seed-items sub-step, but a
   * uniform `Promise<number>` return contract lets `handleSubmit` decide
   * "clean success vs. partial-failure-but-still-a-success" identically for
   * both variants without relying on a `seedMoveFailureCount` state read
   * immediately after an `await` (React state updates are not visible in
   * the SAME closure that scheduled them — this return value is the actual
   * source of truth, the state variable is purely for rendering). */
  async function submitItemVariant(
    item: VaultItem,
    selected: FamilyMemberRecord[],
    level: AccessLevelValue,
  ): Promise<number> {
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
    await shareItemWithRecipients(item.id, row.enc_key, selected, level, uk);
    return 0;
  }

  /** Returns the number of seed items that failed to move (0 when the
   * variant is not seeded, or every seed item moved cleanly) — see
   * `submitItemVariant`'s doc comment for why this is a return value, not a
   * state read. */
  async function submitFolderVariant(
    name: string,
    selected: FamilyMemberRecord[],
    level: AccessLevelValue,
    seed: { id: string; itemCount: number } | null,
  ): Promise<number> {
    const uk = getUnlockedUserKey();
    if (uk === null) {
      throw new Error("cannot share while the vault is locked");
    }
    await initCrypto();
    // T-25-16, applied identically to the folder variant — before ANY
    // network call, including `createCollection`.
    assertRecipientsHavePublicKeys(selected);

    const identityKey = await ensureOwnIdentityKeypair(uk);
    let newCk: WasmCollectionKey | undefined;
    const recipientHandles: WasmIdentityPublicKey[] = [];
    try {
      const newCollectionId = crypto.randomUUID();
      newCk = WasmCollectionKey.generate();
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

      for (const recipient of selected) {
        const recipientPk = WasmIdentityPublicKey.fromBytes(base64Decode(recipient.public_key as string));
        recipientHandles.push(recipientPk);
        const sealedKey = sealCollectionKey(recipientPk, newCk);
        await addCollectionMember(newCollectionId, recipient.user_id, sealedKey, level);
      }

      let failures = 0;
      if (seed !== null) {
        const seedItems = getItems().filter((i) => i.fields.folderId === seed.id);
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
              newCollectionId,
              item.id,
              row.revision + 1,
            );
            const { encKey, encData } = splitCombinedEncryptedItem(reEncrypted);
            await moveItemToCollection(item.id, newCollectionId, encKey, encData, row.revision);
          } catch {
            // A single seed item's move failure must not roll back the
            // folder creation or the member grants already committed above
            // — the folder itself is the primary deliverable (T-26-17,
            // accepted risk).
            failures += 1;
          }
        }
      }
      return failures;
    } finally {
      recipientHandles.forEach((pk) => pk.free?.());
      newCk?.free?.();
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
    try {
      const seedFailures =
        scope.kind === "item"
          ? await submitItemVariant(scope.item, selected, accessLevel)
          : await submitFolderVariant(folderName.trim(), selected, accessLevel, seedFolder);
      if (!mountedRef.current) return;
      if (seedFailures > 0) {
        // The folder + member grants genuinely succeeded — T-26-17's
        // accepted risk is scoped to the seed-item bulk move only. Stay
        // open so the inline report is actually visible, rather than
        // calling `onShared()` and letting the dialog close/unmount before
        // the user ever sees which items didn't move.
        setSeedMoveFailureCount(seedFailures);
        setState("populated");
      } else {
        onShared();
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

  const ctaKey = isFolder ? "share.ctaFolder" : "share.ctaItem";
  const submitDisabled =
    sharing ||
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
                {recipients.length === 0 ? (
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
                      recipient: recipients
                        .filter((r) => selectedRecipientIds.has(r.user_id))
                        .map((r) => r.email)
                        .join(", "),
                    })}
                  </p>
                ) : null}

                {submitError !== null ? (
                  <p role="alert" data-testid="share-error" className="text-sm text-error">
                    {submitError}
                  </p>
                ) : null}
                {seedMoveFailureCount !== null ? (
                  <p data-testid="share-seed-move-failures" className="text-sm text-base-content/70">
                    {t("share.createFailed")}
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
