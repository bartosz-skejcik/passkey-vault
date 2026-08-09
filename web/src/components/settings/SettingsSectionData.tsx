"use client";

// Dane group (Phase 29 tracer, 29-UI-SPEC.md's Migration Mapping) -- the
// import/export JSX moved verbatim from SettingsPanel.tsx:109-136 (the
// `settings-import-cta`/`settings-export-cta` block, showImportWizard/
// showExportDialog local state, ImportWizard/ExportDialog conditional
// renders), unchanged testids/i18n keys.
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import ImportWizard from "../vault/ImportWizard";
import ExportDialog from "../vault/ExportDialog";

export default function SettingsSectionData() {
  const { t } = useLocale();
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);

  return (
    <section
      id="dane"
      aria-labelledby="dane-heading"
      data-testid="settings-section-dane"
      className="scroll-mt-24 flex flex-col gap-4 border-t border-base-300 pt-8 md:pt-16"
    >
      <h2 id="dane-heading" tabIndex={-1} className="text-[24px] font-bold leading-[1.2] outline-none">
        {t("settings.groupData")}
      </h2>
      <p className="text-sm text-base-content/70">{t("settings.groupDataDescription")}</p>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className="text-base text-base-content/70">{t("settings.importBody")}</p>
          <button
            type="button"
            data-testid="settings-import-cta"
            className="btn btn-primary self-start"
            onClick={() => setShowImportWizard(true)}
          >
            <Upload size={16} aria-hidden="true" />
            {t("settings.importCta")}
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <p className="text-base text-base-content/70">{t("settings.exportBody")}</p>
          <button
            type="button"
            data-testid="settings-export-cta"
            className="btn btn-primary self-start"
            onClick={() => setShowExportDialog(true)}
          >
            <Download size={16} aria-hidden="true" />
            {t("settings.exportCta")}
          </button>
        </div>
      </div>

      {showImportWizard ? <ImportWizard onDone={() => setShowImportWizard(false)} /> : null}
      {showExportDialog ? <ExportDialog onClose={() => setShowExportDialog(false)} /> : null}
    </section>
  );
}
