"use client";

// Native <dialog>-backed DaisyUI `modal` treatment (per 02-UI-SPEC.md's
// Delete confirmation dialog section): 400px, centered, AlertTriangle icon
// in error color, plain DM Sans throughout — no Fuzzy Bubbles, same
// playfulness-free rule as the unlock overlay. No trash/soft-delete this
// phase — the copy says "na stałe"/"permanently" because it is (CONTEXT.md
// decision).
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { deleteVaultItem } from "@/lib/vault/store";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import type { VaultItem } from "@/lib/vault/types";

export default function DeleteConfirmDialog({
  item,
  onClose,
  onDeleted,
}: {
  item: VaultItem;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLocale();
  const [deleting, setDeleting] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    try {
      await deleteVaultItem(item.id);
      onDeleted();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      data-testid="delete-confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
          <h2 className="text-[20px] font-bold leading-[1.2]">
            {interpolate(t("delete.title"), { name: item.fields.name })}
          </h2>
        </div>
        <p className="text-base">{t("delete.body")}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="delete-confirm-cancel"
            className="btn btn-ghost"
            onClick={onClose}
          >
            {t("delete.cancel")}
          </button>
          <button
            type="button"
            data-testid="delete-confirm-confirm"
            className="btn btn-error"
            disabled={deleting}
            onClick={() => void handleConfirm()}
          >
            {t("delete.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
