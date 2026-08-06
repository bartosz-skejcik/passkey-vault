"use client";

// Item row kebab/right-click action menu (GAP-02-04) — every action reuses
// the existing safe primitives established in Plan 02-06: copy actions go
// through lib/clipboard.ts's auto-clearing helper (never a raw/direct
// clipboard write, T-02-25), Move calls the same updateVaultItem(...)
// DetailPanel's edit flow already uses (inheriting its AD-binding
// re-encryption and 409-on-stale-revision handling, T-02-26), Delete only
// ever requests DeleteConfirmDialog's confirmation step (no new/parallel
// delete path). ItemRow.tsx owns the outer `.dropdown` wrapper — this
// component renders only the `.dropdown-content` menu itself.
import { useState } from "react";
import type { DICTIONARY } from "@/lib/i18n/dictionary";
import { interpolate } from "@/lib/i18n/dictionary";
import type { VaultItem } from "@/lib/vault/types";
import { updateVaultItem, useFolders } from "@/lib/vault/store";
import { useCollections } from "@/lib/vault/collections";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { copyWithAutoClear, readClipboardSeconds } from "@/lib/clipboard";
import { showCopyToast } from "@/lib/vault/copyToast";
import { showErrorToast } from "@/lib/vault/errorToast";
import ShareDialog from "./ShareDialog";

interface CopyAction {
  testId: string;
  labelKey: keyof typeof DICTIONARY;
  fieldLabelKey: keyof typeof DICTIONARY;
  value: string;
}

function copyActionsFor(item: VaultItem): CopyAction[] {
  const fields = item.fields;
  if (fields.type === "login") {
    const actions: CopyAction[] = [];
    if (fields.username) {
      actions.push({
        testId: "context-menu-copy-username",
        labelKey: "action.copyUsername",
        fieldLabelKey: "field.username",
        value: fields.username,
      });
    }
    if (fields.password) {
      actions.push({
        testId: "context-menu-copy-password",
        labelKey: "action.copyPassword",
        fieldLabelKey: "field.password",
        value: fields.password,
      });
    }
    return actions;
  }
  if (fields.type === "card") {
    return fields.number
      ? [
          {
            testId: "context-menu-copy-number",
            labelKey: "action.copyCardNumber",
            fieldLabelKey: "field.number",
            value: fields.number,
          },
        ]
      : [];
  }
  if (fields.type === "identity") {
    return fields.email
      ? [
          {
            testId: "context-menu-copy-email",
            labelKey: "action.copyEmail",
            fieldLabelKey: "field.email",
            value: fields.email,
          },
        ]
      : [];
  }
  return [];
}

export default function ItemContextMenu({
  item,
  onClose,
  onEdit,
  onDeleteRequest,
}: {
  item: VaultItem;
  onClose: () => void;
  onEdit: () => void;
  onDeleteRequest: () => void;
}) {
  const { t } = useLocale();
  const folders = useFolders();
  const collections = useCollections();
  const copyActions = copyActionsFor(item);
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  // E1 backstop (26-UI-SPEC.md): WR-10's server-side 400 on a direct
  // item_shares grant against a collection-scoped item makes a clickable
  // Share action here a UI lie — replaced entirely by
  // share.itemSharedOnCollectionNote, never merely disabled. Suppressed
  // ENTIRELY (no button, no note) for `item.undecryptable` — same rationale
  // as the Edit guard below: an item whose ciphertext failed integrity has
  // nothing safe to share, sharable folder note included.
  const sharedFolderName =
    item.collectionId != null
      ? (collections.find((c) => c.id === item.collectionId)?.name ?? "")
      : null;

  function handleCopy(action: CopyAction) {
    const seconds = readClipboardSeconds();
    copyWithAutoClear(action.value, seconds * 1000);
    showCopyToast(t(action.fieldLabelKey), seconds * 1000);
    onClose();
  }

  function handleMove(folderId: string | null) {
    // The menu closes immediately (matches every other action here), so
    // failure feedback can't be rendered inline once this component
    // unmounts — it goes through the same globally-mounted toast pattern
    // handleCopy already relies on for post-close feedback. A
    // RevisionConflictError still re-syncs the store on 409 (store.ts), but
    // the move itself did not apply, so this is surfaced too, not swallowed.
    updateVaultItem(item.id, { ...item.fields, folderId }, item.revision).catch(() => {
      showErrorToast(t("error.itemMoveFailed"));
    });
    onClose();
  }

  function handleEdit() {
    onEdit();
    onClose();
  }

  // Deliberately does NOT call onClose() when opening ShareDialog — this
  // component's own state owns the dialog, and onClose() unmounts this
  // component (ItemRow.tsx only renders ItemContextMenu while its own
  // menuOpen state is true), which would tear the dialog down before the
  // user ever sees it (the same hazard this file's handleMove comment
  // documents for post-close feedback). ShareDialog's own full-screen
  // overlay (z-50, above this menu's z-20) visually replaces the menu
  // regardless of whether the underlying dropdown DOM is still mounted.
  function handleShareClosed() {
    setShareDialogOpen(false);
    onClose();
  }

  return (
    <>
      <ul
        data-testid={`item-menu-${item.id}`}
        className="dropdown-content menu z-20 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow"
      >
      {copyActions.map((action) => (
        <li key={action.testId}>
          <button type="button" data-testid={action.testId} onClick={() => handleCopy(action)}>
            {t(action.labelKey)}
          </button>
        </li>
      ))}

      <li>
        <details>
          <summary data-testid="context-menu-move">{t("action.move")}</summary>
          <ul>
            <li>
              <button
                type="button"
                data-testid="context-menu-move-none"
                onClick={() => handleMove(null)}
              >
                {t("item.noFolder")}
              </button>
            </li>
            {folders.map((folder) => (
              <li key={folder.id}>
                <button
                  type="button"
                  data-testid={`context-menu-move-${folder.id}`}
                  onClick={() => handleMove(folder.id)}
                >
                  {folder.name}
                </button>
              </li>
            ))}
          </ul>
        </details>
      </li>

      {/* E1 (26-UI-SPEC.md): "Share…" mirrors Move's own list position/testid
          convention — a sibling `<li>` opening ShareDialog directly rather
          than a nested menu. Deliberately does NOT follow Edit's passkey
          suppression below (SHARE-02 covers passkey items exactly like any
          other item type) but DOES follow the same `item.undecryptable`
          suppression (nothing safe to share from a failed-integrity item).
          A collection-scoped item (`collectionId !== null`) gets the honest
          `share.itemSharedOnCollectionNote` INSTEAD of a button — WR-10's
          server-side 400 on a direct item_shares grant against a
          collection-scoped item would make a clickable action here a UI lie,
          so it is replaced entirely, never merely disabled. */}
      {item.undecryptable !== true ? (
        sharedFolderName !== null ? (
          <li>
            <span data-testid="context-menu-share-note" className="px-4 py-2 text-xs text-base-content/60">
              {interpolate(t("share.itemSharedOnCollectionNote"), { folder: sharedFolderName })}
            </span>
          </li>
        ) : item.sharedToMe === true ? (
          // CR-02 (code review, Phase 26): an item shared TO this caller.
          // The Share action here ran `submitItemVariant`, whose
          // `listItems()` lookup cannot find a row this caller does not own
          // — it threw into the generic share.createFailed every time.
          // Replaced by the honest note, never merely disabled, same
          // discipline as the collection-scoped branch above.
          <li>
            <span
              data-testid="context-menu-shared-with-you-note"
              className="px-4 py-2 text-xs text-base-content/60"
            >
              {t("share.sharedWithYouNote")}
            </span>
          </li>
        ) : (
          <li>
            <button
              type="button"
              data-testid="context-menu-share"
              onClick={() => setShareDialogOpen(true)}
            >
              {/* 26-12a gap fix: a dedicated entry-point label, distinct
                  from ShareDialog's own `share.ctaItem` submit CTA this
                  entry opens. */}
              {t("share.shareThisItem")}
            </button>
          </li>
        )
      ) : null}

      {/* Phase 12 cross-client fix: no Edit affordance for passkey items —
          mirrors DetailPanel.tsx's own hidden pencil button (ItemForm has no
          passkey branch; editing would risk corrupting rawPasskeyJson).
          WR-02 (code review iteration 2): same suppression for
          `item.undecryptable` — DetailPanel.tsx already hides its own Edit
          button for a flagged item (its revision is known-stale, and
          updateVaultItem itself refuses the save with
          UndecryptableItemError), but this menu had no matching guard.
          Reaching Edit via THIS menu still mounted ItemForm in edit mode,
          whose catch routes every edit-mode error to onError — and
          DetailPanel's onError only handled RevisionConflictError, so the
          UndecryptableItemError was silently swallowed: the spinner just
          stopped, nothing saved, nothing said. */}
      {item.fields.type !== "passkey" && item.undecryptable !== true ? (
        <li>
          <button type="button" data-testid="context-menu-edit" onClick={handleEdit}>
            {t("item.edit")}
          </button>
        </li>
      ) : null}
      <li>
        <button
          type="button"
          data-testid="context-menu-delete"
          className="text-error"
          onClick={onDeleteRequest}
        >
          {t("action.delete")}
        </button>
      </li>
    </ul>
    {shareDialogOpen ? (
      <ShareDialog
        scope={{ kind: "item", item }}
        onClose={handleShareClosed}
        onShared={handleShareClosed}
      />
    ) : null}
    </>
  );
}
