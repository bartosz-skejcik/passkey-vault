"use client";

// Carried across verbatim from SettingsPanel's Family tab (SET-01/SET-02,
// Phase 29). This surface is explicitly NOT redesigned here -- SET-03's
// redesign is Phase 33's job. Do not add visual/structural changes to this
// wrapper or to FamilyTab.tsx itself until then.
import { useLocale } from "@/lib/i18n/LocaleContext";
import FamilyTab from "./FamilyTab";

export default function SettingsSectionFamily() {
  const { t } = useLocale();

  return (
    <section
      id="rodzina"
      aria-labelledby="rodzina-heading"
      data-testid="settings-section-rodzina"
      className="scroll-mt-24 flex flex-col gap-4 border-t border-base-300 pt-8 md:pt-16"
    >
      <h2 id="rodzina-heading" tabIndex={-1} className="text-[24px] font-bold leading-[1.2] outline-none">
        {t("settings.groupFamily")}
      </h2>
      <p className="text-sm text-base-content/70">{t("settings.groupFamilyDescription")}</p>
      <FamilyTab />
    </section>
  );
}
