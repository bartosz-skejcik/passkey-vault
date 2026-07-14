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
import { getFolders, getItems } from "@/lib/vault/store";
import { buildCsvExport } from "@/lib/vault/exporters/toCsv";
import { buildJsonExport } from "@/lib/vault/exporters/toJson";
import { downloadFile } from "@/lib/vault/exporters/download";

type ExportFormat = "json" | "csv";

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const [format, setFormat] = useState<ExportFormat>("json");

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
          <span>{t("export.warningBody")}</span>
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
            onClick={handleConfirm}
          >
            {t("export.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
