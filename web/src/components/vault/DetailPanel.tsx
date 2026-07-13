"use client";

import { Fragment, useState } from "react";
import { Check, Copy, Pencil, Trash2, X } from "lucide-react";
import type { ItemFields, VaultItem } from "@/lib/vault/types";
import { RevisionConflictError, useFolders } from "@/lib/vault/store";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate, type DICTIONARY } from "@/lib/i18n/dictionary";
import { copyWithAutoClear, readClipboardSeconds } from "@/lib/clipboard";
import { showCopyToast } from "@/lib/vault/copyToast";
import PasskeyPlaceholderSection from "./PasskeyPlaceholderSection";
import ItemForm from "./ItemForm";
import DeleteConfirmDialog from "./DeleteConfirmDialog";

// Fields shaped as generic string values, rendered through a Label+value
// loop — `folderId` and `tags` are special-cased below instead (they need
// a lookup/chip rendering, not a raw value dump); a login item's `urls`
// (string[], not a plain string) is also special-cased, rendered right
// after `password` to match 02-UI-SPEC.md's per-type field order
// (username, password, URL, notes).
const FIELD_ORDER: Record<ItemFields["type"], string[]> = {
  login: ["username", "password", "notes"],
  card: ["cardholderName", "number", "expiry", "cvv", "notes"],
  identity: ["firstName", "lastName", "email", "phone", "address", "notes"],
  note: ["body"],
};

const MONO_FIELDS = new Set(["password", "number", "cvv"]);

export default function DetailPanel({
  item,
  onClose,
}: {
  item: VaultItem;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const folders = useFolders();
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [conflict, setConflict] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  // Safe: every key in FIELD_ORDER[item.fields.type] is a string field of
  // that exact variant — this loop never reads folderId/tags/type/name/urls
  // (those are special-cased separately).
  const fieldValues = item.fields as unknown as Record<string, string>;
  const folder = folders.find((f) => f.id === item.fields.folderId);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function startEditing() {
    setConflict(false);
    setMode("edit");
  }

  function fieldLabelFor(fieldKey: string): string {
    return fieldKey === "url" ? t("field.url") : t(`field.${fieldKey}` as keyof typeof DICTIONARY);
  }

  function handleCopy(testidSuffix: string, fieldKey: string, value: string) {
    if (!value) return;
    const seconds = readClipboardSeconds();
    copyWithAutoClear(value, seconds * 1000);
    showCopyToast(fieldLabelFor(fieldKey), seconds * 1000);
    setCopiedKey(testidSuffix);
    setTimeout(
      () => setCopiedKey((current) => (current === testidSuffix ? null : current)),
      1500,
    );
  }

  // A render helper (not a nested component definition — defining a
  // component function inside another component's body would remount it,
  // and thus reset its would-be-internal state, on every parent render).
  function renderCopyButton(fieldKey: string, value: string, testidSuffix = fieldKey) {
    return (
      <button
        type="button"
        data-testid={`copy-${testidSuffix}`}
        aria-label={interpolate(t("aria.copyField"), { field: fieldLabelFor(fieldKey) })}
        className="btn btn-ghost btn-square btn-sm shrink-0"
        onClick={() => handleCopy(testidSuffix, fieldKey, value)}
      >
        {copiedKey === testidSuffix ? (
          <Check size={16} className="text-success" aria-hidden="true" />
        ) : (
          <Copy size={16} aria-hidden="true" />
        )}
      </button>
    );
  }

  return (
    <aside
      data-testid="detail-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col gap-4 overflow-y-auto border-l border-base-300 bg-base-100 p-6 shadow-xl md:w-[400px]"
    >
      <div className="flex items-start justify-between gap-2">
        {mode === "view" ? (
          <h2 className="text-[20px] font-bold leading-[1.2]">{item.fields.name}</h2>
        ) : (
          <h2 className="text-[20px] font-bold leading-[1.2]">{t("item.edit")}</h2>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {mode === "view" ? (
            <>
              <button
                type="button"
                data-testid="detail-panel-edit"
                aria-label={t("item.edit")}
                className="btn btn-ghost btn-square btn-sm"
                onClick={startEditing}
              >
                <Pencil size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                data-testid="detail-panel-delete"
                aria-label={interpolate(t("aria.deleteItem"), { name: item.fields.name })}
                className="btn btn-ghost btn-square btn-sm"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            data-testid="detail-panel-close"
            aria-label={t("aria.closePanel")}
            className="btn btn-ghost btn-square btn-sm"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <>
          {conflict ? (
            <div
              data-testid="revision-conflict-banner"
              className="alert alert-error text-sm"
            >
              {t("error.revisionConflict")}
            </div>
          ) : null}
          <ItemForm
            type={item.fields.type}
            mode="edit"
            itemId={item.id}
            currentRevision={item.revision}
            initialFields={item.fields}
            onCreated={() => {
              setConflict(false);
              setMode("view");
            }}
            onError={(err) => {
              if (err instanceof RevisionConflictError) {
                setConflict(true);
              }
            }}
          />
        </>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {FIELD_ORDER[item.fields.type].map((key) => (
              <Fragment key={key}>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-base-content/60">
                    {t(`field.${key}` as keyof typeof DICTIONARY)}
                  </span>
                  <div className="flex items-center gap-1">
                    <span className={`text-base ${MONO_FIELDS.has(key) ? "font-mono" : ""}`}>
                      {fieldValues[key] || "—"}
                    </span>
                    {fieldValues[key] ? renderCopyButton(key, fieldValues[key]) : null}
                  </div>
                </div>
                {item.fields.type === "login" && key === "password" ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-base-content/60">{t("field.url")}</span>
                    {item.fields.urls.length > 0 ? (
                      item.fields.urls.map((url, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <span className="text-base">{url}</span>
                          {renderCopyButton("url", url, `url-${i}`)}
                        </div>
                      ))
                    ) : (
                      <span className="text-base">—</span>
                    )}
                  </div>
                ) : null}
              </Fragment>
            ))}

            <div className="flex flex-col gap-1">
              <span className="text-sm text-base-content/60">{t("item.folderLabel")}</span>
              <span className="text-base">{folder ? folder.name : t("item.noFolder")}</span>
            </div>

            {item.fields.tags.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-base-content/60">{t("item.tagsLabel")}</span>
                <div className="flex flex-wrap gap-1">
                  {item.fields.tags.map((tag) => (
                    <span key={tag} className="badge badge-sm bg-base-200 text-base-content/70">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          {item.fields.type === "login" ? <PasskeyPlaceholderSection /> : null}
        </>
      )}

      {showDeleteDialog ? (
        <DeleteConfirmDialog
          item={item}
          onClose={() => setShowDeleteDialog(false)}
          onDeleted={() => {
            setShowDeleteDialog(false);
            onClose();
          }}
        />
      ) : null}
    </aside>
  );
}
