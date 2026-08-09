"use client";

// Bezpieczeństwo group (Phase 29 tracer, 29-UI-SPEC.md's Migration Mapping)
// -- thin container wrap of SecurityTab (autolock + clipboard-clear
// controls only, once Task 2 extracts the delete-account block out of it),
// unmodified import.
import { useLocale } from "@/lib/i18n/LocaleContext";
import SecurityTab from "./SecurityTab";

export default function SettingsSectionSecurity() {
  const { t } = useLocale();

  return (
    <section
      id="bezpieczenstwo"
      aria-labelledby="bezpieczenstwo-heading"
      data-testid="settings-section-bezpieczenstwo"
      className="scroll-mt-24 flex flex-col gap-4 border-t border-base-300 pt-8 md:pt-16"
    >
      <h2
        id="bezpieczenstwo-heading"
        tabIndex={-1}
        className="text-[24px] font-bold leading-[1.2] outline-none"
      >
        {t("settings.groupSecurity")}
      </h2>
      <p className="text-sm text-base-content/70">{t("settings.groupSecurityDescription")}</p>
      <SecurityTab />
    </section>
  );
}
