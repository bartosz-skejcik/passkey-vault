"use client";

// Settings drawer shell (UI-05) — structurally identical to page.tsx's
// existing DetailPanel overlay (fixed inset-y-0 right-0 z-40 ...
// md:w-[400px]), reusing the exact same drawer vocabulary, not a new
// interaction pattern. Opens to the Passkeys tab by default (this phase's
// headline new capability).
//
// Per binding resolution #1 (03-UI-SPEC.md's "Resolutions" section):
// Logout does NOT live here — it stays in Sidebar.tsx's account dropdown,
// alongside "Zablokuj teraz". This panel only hosts the 4 settings tabs.
import { useState } from "react";
import { KeyRound, Monitor, ShieldCheck, X } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import PasskeysTab from "./PasskeysTab";
import SessionsTab from "./SessionsTab";
import SecurityTab from "./SecurityTab";

type SettingsTab = "passkeys" | "sessions" | "security" | "importExport";

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const [tab, setTab] = useState<SettingsTab>("passkeys");

  function tabClass(active: boolean): string {
    return `tab gap-2 ${active ? "tab-active" : ""}`;
  }

  return (
    <aside
      data-testid="settings-panel"
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col gap-4 overflow-y-auto border-l border-base-300 bg-base-100 p-6 shadow-xl md:w-[400px]"
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[20px] font-bold leading-[1.2]">{t("settings.title")}</h2>
        <button
          type="button"
          data-testid="settings-close"
          aria-label={t("aria.closePanel")}
          className="btn btn-ghost btn-square btn-sm"
          onClick={onClose}
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="tabs tabs-bordered" role="tablist">
        <button
          type="button"
          role="tab"
          data-testid="settings-tab-passkeys"
          className={tabClass(tab === "passkeys")}
          onClick={() => setTab("passkeys")}
        >
          <KeyRound size={16} aria-hidden="true" />
          {t("settings.tabPasskeys")}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="settings-tab-sessions"
          className={tabClass(tab === "sessions")}
          onClick={() => setTab("sessions")}
        >
          <Monitor size={16} aria-hidden="true" />
          {t("settings.tabSessions")}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="settings-tab-security"
          className={tabClass(tab === "security")}
          onClick={() => setTab("security")}
        >
          <ShieldCheck size={16} aria-hidden="true" />
          {t("settings.tabSecurity")}
        </button>
        <button
          type="button"
          role="tab"
          data-testid="settings-tab-importexport"
          className={tabClass(tab === "importExport")}
          onClick={() => setTab("importExport")}
        >
          {t("settings.tabImportExport")}
        </button>
      </div>

      <div className="flex-1">
        {tab === "passkeys" ? <PasskeysTab /> : null}
        {tab === "sessions" ? <SessionsTab /> : null}
        {tab === "security" ? <SecurityTab /> : null}
        {tab === "importExport" ? (
          <p className="py-8 text-center text-base text-base-content/70">
            {t("settings.importExportPlaceholder")}
          </p>
        ) : null}
      </div>
    </aside>
  );
}
