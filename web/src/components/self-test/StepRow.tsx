import { Check, X } from "lucide-react";
import type { StepResult } from "@/lib/crypto";

export default function StepRow({ step }: { step: StepResult }) {
  const detail = step.error ?? step.detail;

  return (
    <div className="flex items-center gap-3 py-2">
      <span
        aria-label={step.ok ? `${step.name}: sukces` : `${step.name}: błąd`}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          step.ok ? "bg-success text-success-content" : "bg-error text-error-content"
        }`}
      >
        {step.ok ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <X size={14} aria-hidden="true" />
        )}
      </span>

      <div className="flex flex-col">
        <span className="text-sm">{step.name}</span>
        {detail ? (
          <span className="font-mono text-[14px] text-base-content/50">{detail}</span>
        ) : null}
      </div>
    </div>
  );
}
