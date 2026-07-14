"use client";

// First-run onboarding takeover (UI-04, Plan 06-04). Full-screen z-50
// takeover echoing UnlockOverlay's exact blur/scrim classes — NOT the z-40
// drawer+scrim pattern reserved for in-vault contexts (06-CONTEXT.md Area 4,
// 06-UI-SPEC.md). No dismiss-via-backdrop-click/Esc affordance at all —
// onboarding is only ever exited via its own step buttons (Skip/Done inside
// Step 1, or Finish on Step 3).
import { useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { markOnboardingComplete } from "@/lib/onboarding/flag";
import OnboardingStep1Import from "./OnboardingStep1Import";
import OnboardingStep2MeetVault from "./OnboardingStep2MeetVault";
import OnboardingStep3Finish from "./OnboardingStep3Finish";

export default function OnboardingWizard({ onFinish }: { onFinish: () => void }) {
  const { t } = useLocale();
  const [step, setStep] = useState<1 | 2 | 3>(1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-base-300/70">
      <div className="w-full max-w-[640px] rounded-box border border-base-300 bg-base-100 p-4 md:p-6">
        {/* Decorative step-dot row — the step number is announced via the
            visually-hidden live region below instead, not read from dot
            color/position. */}
        <div className="mb-4 flex justify-center gap-2" aria-hidden="true">
          {[1, 2, 3].map((dot) => (
            <span
              key={dot}
              className={`h-2 w-2 rounded-full ${dot <= step ? "bg-primary" : "bg-base-content/20"}`}
            />
          ))}
        </div>
        <p className="sr-only" role="status">
          {interpolate(t("onboarding.stepIndicator"), { n: String(step) })}
        </p>

        {step === 1 ? (
          <OnboardingStep1Import onSkip={() => setStep(3)} onDone={() => setStep(2)} />
        ) : null}
        {step === 2 ? (
          <OnboardingStep2MeetVault onNext={() => setStep(3)} onBack={() => setStep(1)} />
        ) : null}
        {step === 3 ? (
          <OnboardingStep3Finish
            onFinish={() => {
              markOnboardingComplete();
              onFinish();
            }}
          />
        ) : null}
      </div>
    </div>
  );
}
