"use client";

// Onboarding Step 2 — static orientation content only, no new functionality
// (06-CONTEXT.md Area 4). Two highlight cards: PRF passkey unlock (teal
// KeyRound — the one place teal appears in onboarding, tying back to its
// established passkey/PRF meaning) and auto-lock/clipboard defaults
// (neutral Lock icon). One small hand-drawn annotation near the PRF card is
// this step's single flourish (06-UI-SPEC.md), rendered in the Fuzzy
// Bubbles hand font.
import { KeyRound, Lock } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function OnboardingStep2MeetVault({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const { t } = useLocale();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-[20px] font-bold leading-[1.2]">{t("onboarding.step2Title")}</h2>

      <div className="flex flex-col gap-4 md:flex-row">
        <div className="relative flex flex-1 flex-col gap-2 rounded-box border border-base-300 bg-base-200 p-4">
          <div className="flex items-center gap-2">
            <KeyRound size={20} className="text-secondary" aria-hidden="true" />
            <h3 className="font-bold">{t("onboarding.step2PrfHeading")}</h3>
          </div>
          <p className="text-sm text-base-content/70">{t("onboarding.step2PrfBody")}</p>
          {/* Single hand-drawn annotation — this step's one flourish, per
              06-UI-SPEC.md, not decorated on every element. */}
          <span
            aria-hidden="true"
            className="absolute -top-3 -right-2 rotate-[8deg] font-[family-name:var(--font-hand)] text-sm text-primary"
          >
            {t("onboarding.step2PrfAnnotation")}
          </span>
        </div>

        <div className="flex flex-1 flex-col gap-2 rounded-box border border-base-300 bg-base-200 p-4">
          <div className="flex items-center gap-2">
            <Lock size={20} className="text-base-content/70" aria-hidden="true" />
            <h3 className="font-bold">{t("onboarding.step2AutolockHeading")}</h3>
          </div>
          <p className="text-sm text-base-content/70">{t("onboarding.step2AutolockBody")}</p>
        </div>
      </div>

      <div className="flex justify-between gap-2">
        <button type="button" data-testid="onboarding-step2-back" className="btn btn-ghost" onClick={onBack}>
          {t("import.back")}
        </button>
        <button
          type="button"
          data-testid="onboarding-step2-next"
          className="btn btn-primary"
          onClick={onNext}
        >
          {t("onboarding.next")}
        </button>
      </div>
    </div>
  );
}
