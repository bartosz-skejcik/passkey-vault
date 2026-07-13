"use client";

// DaisyUI toast toast-end toast-bottom, 320px (02-UI-SPEC.md's Copy toast
// section). Persists for the entire clipboard-clear duration with a live
// per-second countdown — NOT a typical 3-second toast. This countdown is
// display-only, decremented via its own local setInterval, independent of
// clipboard.ts's actual clearing timer: dismissing the toast early never
// cancels the real clipboard-clear guarantee (the timer lives in
// lib/vault/copyToast.ts's singleton, which is untouched by this
// component unmounting).
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  dismissCopyToast,
  getCopyToastState,
  subscribeCopyToast,
  type CopyToastState,
} from "@/lib/vault/copyToast";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";

const CLEARED_DISPLAY_MS = 1500;

export default function CopyToast() {
  const { t } = useLocale();
  const [state, setState] = useState<CopyToastState | null>(getCopyToastState());
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [cleared, setCleared] = useState(false);

  useEffect(() => subscribeCopyToast(() => setState(getCopyToastState())), []);

  useEffect(() => {
    if (!state) {
      setCleared(false);
      return;
    }
    setCleared(false);
    setRemainingSeconds(Math.ceil(state.durationMs / 1000));

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => Math.max(0, prev - 1));
    }, 1000);

    const clearedTimer = setTimeout(() => {
      setCleared(true);
      clearInterval(interval);
    }, state.durationMs);

    return () => {
      clearInterval(interval);
      clearTimeout(clearedTimer);
    };
  }, [state]);

  useEffect(() => {
    if (!cleared) return;
    const hideTimer = setTimeout(() => dismissCopyToast(), CLEARED_DISPLAY_MS);
    return () => clearTimeout(hideTimer);
  }, [cleared]);

  if (!state) {
    return null;
  }

  return (
    <div data-testid="copy-toast" className="toast toast-end toast-bottom z-50">
      <div className="flex w-[320px] items-center justify-between gap-3 rounded-field border border-base-300 bg-base-100 p-3 text-sm">
        <span>
          {cleared
            ? t("toast.cleared")
            : interpolate(t("toast.copied"), {
                field: state.fieldLabel,
                n: String(remainingSeconds),
              })}
        </span>
        <button
          type="button"
          data-testid="copy-toast-dismiss"
          aria-label={t("aria.dismissToast")}
          className="btn btn-ghost btn-square btn-xs"
          onClick={() => dismissCopyToast()}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
