"use client";

// Onboarding Step 1 — mounts the real, full `ImportWizard` from Plan 06-03
// inline within the takeover card (06-CONTEXT.md's explicit "no
// stripped-down subset" instruction). Only the outer title/body copy below
// is Fuzzy-Bubbles-eligible onboarding chrome; the embedded ImportWizard
// itself stays sober DM Sans regardless of this embedding context
// (06-UI-SPEC.md's sober/playful boundary).
//
// No `onCancel` is passed to ImportWizard — an aborted-mid-mapping exit
// falls back to ImportWizard's own `onDone` default, which behaves like
// Skip's sibling here (advance to Step 2), not a third distinct path.
import { useLocale } from "@/lib/i18n/LocaleContext";
import ImportWizard from "@/components/vault/ImportWizard";

export default function OnboardingStep1Import({
  onSkip,
  onDone,
}: {
  onSkip: () => void;
  onDone: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[20px] font-bold leading-[1.2]">{t("onboarding.step1Title")}</h2>
        <p className="mt-1 font-[family-name:var(--font-hand)] text-base text-base-content/70">
          {t("onboarding.step1Body")}
        </p>
      </div>
      <ImportWizard onSkip={onSkip} onDone={onDone} variant="inline" />
    </div>
  );
}
