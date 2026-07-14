"use client";

// Onboarding Step 3 — calm confirmation screen, satisfies the
// onboarding/empty-state Fuzzy-Bubbles-and-emoji allowance one last time
// before the rest of the app returns to sober security-UI tone
// (06-CONTEXT.md Area 4).
import { CircleCheck } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function OnboardingStep3Finish({ onFinish }: { onFinish: () => void }) {
  const { t } = useLocale();

  return (
    <div className="flex flex-col items-center gap-4 py-4 text-center">
      <CircleCheck size={48} className="text-success" aria-hidden="true" />
      <h2 className="text-[20px] font-bold leading-[1.2]">{t("onboarding.step3Title")}</h2>
      <p className="font-[family-name:var(--font-hand)] text-base text-base-content/70">
        {t("onboarding.step3Body")}
      </p>
      <button
        type="button"
        data-testid="onboarding-step3-finish"
        className="btn btn-primary"
        onClick={onFinish}
      >
        {t("onboarding.finish")}
      </button>
    </div>
  );
}
