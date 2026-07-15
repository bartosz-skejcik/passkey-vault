// entrypoints/popup/autofill/SensitiveFillConfirm.tsx — D-12's "stricter
// than login" inline confirm for card/identity fills (10-06,
// 10-UI-SPEC.md). An inline expand-in-place BELOW the row, not a modal --
// the popup is 360px wide, a stacked modal is cramped. Deliberately
// NEUTRAL base-content styling (optional small ShieldCheck icon at
// text-base-content/60) -- deliberately never the alarm-yellow tone this
// codebase reserves for actual security events: an extra consent click is
// not one of those, and over-styling it as one would cry wolf on every
// card fill (10-UI-SPEC.md Phase-Specific Notes #3). This file is grep-
// verified to never spell out that reserved tone's DaisyUI class name.
import { ShieldCheck } from "lucide-react";
import { t, interpolate, type Locale } from "../../../lib/i18n/autofill-dictionary";

export interface SensitiveFillConfirmProps {
  locale: Locale;
  kind: "card" | "identity";
  /** last4 digits for a card, the item's label for an identity. */
  detail: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SensitiveFillConfirm({
  locale,
  kind,
  detail,
  onConfirm,
  onCancel,
}: SensitiveFillConfirmProps) {
  const copy =
    kind === "card"
      ? interpolate(t(locale, "confirm.card"), { last4: detail })
      : interpolate(t(locale, "confirm.identity"), { label: detail });

  return (
    <div
      data-testid="sensitive-fill-confirm"
      className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-200 p-3 text-sm text-base-content"
    >
      <div className="flex items-start gap-2">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-base-content/60" aria-hidden="true" />
        <p>{copy}</p>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          {t(locale, "autofill.cancelCta")}
        </button>
        <button
          type="button"
          data-testid="sensitive-fill-confirm-submit"
          className="btn btn-primary btn-sm"
          onClick={onConfirm}
        >
          {t(locale, "autofill.fillCta")}
        </button>
      </div>
    </div>
  );
}
