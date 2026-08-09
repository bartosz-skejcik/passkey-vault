"use client";

// Konto group (Phase 29 tracer, 29-UI-SPEC.md's Migration Mapping) --
// container-only migration of PasskeysTab/SessionsTab, unmodified imports.
// The delete-account trigger (currently in SecurityTab.tsx) relocates here
// in Task 2, not this task, so this task's own verify does not depend on
// Task 2's edits.
import { useLocale } from "@/lib/i18n/LocaleContext";
import PasskeysTab from "./PasskeysTab";
import SessionsTab from "./SessionsTab";

export default function SettingsSectionAccount() {
  const { t } = useLocale();

  return (
    <section
      id="konto"
      aria-labelledby="konto-heading"
      data-testid="settings-section-konto"
      className="scroll-mt-24 flex flex-col gap-4"
    >
      <h2 id="konto-heading" tabIndex={-1} className="text-[24px] font-bold leading-[1.2] outline-none">
        {t("settings.groupAccount")}
      </h2>
      <p className="text-sm text-base-content/70">{t("settings.groupAccountDescription")}</p>
      <PasskeysTab />
      <SessionsTab />
    </section>
  );
}
