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
import type { DICTIONARY } from "@/lib/i18n/dictionary";
import type { VaultItem } from "@/lib/vault/types";
import { updateVaultItem, useFolders } from "@/lib/vault/store";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { copyWithAutoClear, readClipboardSeconds } from "@/lib/clipboard";
import { showCopyToast } from "@/lib/vault/copyToast";
import { showErrorToast } from "@/lib/vault/errorToast";

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
  const copyActions = copyActionsFor(item);

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

  return (
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
  );
}
