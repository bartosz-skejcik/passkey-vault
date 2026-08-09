"use client";

// Plaintext-warning export dialog (IMPEX-04). Structurally a direct copy of
// DeleteConfirmDialog's 400px modal shape (scrim, panel, Cancel/Confirm
// row) -- only the icon/banner/confirm-button color differ: warning, not
// error, since nothing is destroyed by an export (06-UI-SPEC.md's Color
// section reasoning). No loading state -- in-memory serialization is
// effectively instant.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { getFolders, getItems, useItemsHydrated } from "@/lib/vault/store";
import { isPasswordHidden } from "@/lib/vault/itemCapabilities";
import { buildCsvExport } from "@/lib/vault/exporters/toCsv";
import { buildJsonExport } from "@/lib/vault/exporters/toJson";
import { downloadFile } from "@/lib/vault/exporters/download";

type ExportFormat = "json" | "csv";

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const [format, setFormat] = useState<ExportFormat>("json");
  // DEBT-02 (Plan 29-02): `hydrated` distinguishes "getItems() confirmed
  // post-unlock" from "don't know yet" -- computing this count against an
  // unhydrated store could silently understate real exposure (n=0 renders
  // as "nothing exposed" while the file about to be written contains
  // exactly those passwords). `hiddenPasswordCount` stays `null` (never 0)
  // until hydration is confirmed; export-confirm is disabled meanwhile so a
  // confirm can never fire against an unconfirmed count.
  const hydrated = useItemsHydrated();
  const hiddenPasswordCount = hydrated ? getItems().filter(isPasswordHidden).length : null;

  function handleConfirm() {
    const items = getItems();
    const folders = getFolders();
    const content = format === "json" ? buildJsonExport(items, folders) : buildCsvExport(items, folders);
    const mimeType = format === "json" ? "application/json" : "text/csv";
    const date = new Date().toISOString().slice(0, 10);
    downloadFile(content, `passkey-vault-export-${date}.${format}`, mimeType);
    onClose();
  }

  return (
    <div
      data-testid="export-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="shrink-0 text-warning" aria-hidden="true" />
          <h2 className="text-[20px] font-bold leading-[1.2]">{t("export.warningTitle")}</h2>
        </div>

        <div className="join">
          <button
            type="button"
            data-testid="export-format-json"
            className={`btn join-item btn-sm ${format === "json" ? "btn-active" : ""}`}
            onClick={() => setFormat("json")}
          >
            {t("export.formatJson")}
          </button>
          <button
            type="button"
            data-testid="export-format-csv"
            className={`btn join-item btn-sm ${format === "csv" ? "btn-active" : ""}`}
            onClick={() => setFormat("csv")}
          >
            {t("export.formatCsv")}
          </button>
        </div>

        <div className="alert alert-warning" data-testid="export-warning-banner">
          <div className="flex flex-col gap-1">
            <span>{t("export.warningBody")}</span>
            {hiddenPasswordCount !== null && hiddenPasswordCount > 0 ? (
              <p data-testid="export-hidden-password-disclosure">
                {interpolate(t("export.hiddenPasswordDisclosure"), {
                  n: String(hiddenPasswordCount),
                })}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="export-cancel"
            className="btn btn-ghost"
            onClick={onClose}
          >
            {t("export.cancel")}
          </button>
          <button
            type="button"
            data-testid="export-confirm"
            className="btn btn-warning"
            disabled={hiddenPasswordCount === null}
            onClick={handleConfirm}
          >
            {t("export.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
