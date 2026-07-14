"use client";

// Global error-toast renderer — mounted once in page.tsx, mirroring
// CopyToast.tsx's mount-once/subscribe-to-singleton shape. Positioned
// top-end (rather than CopyToast's bottom-end) so an error surfaced right
// after a menu action never visually collides with an in-flight copy
// countdown toast (gap-review WR-02).
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import {
  dismissErrorToast,
  getErrorToastState,
  subscribeErrorToast,
  type ErrorToastState,
} from "@/lib/vault/errorToast";
import { useLocale } from "@/lib/i18n/LocaleContext";

const AUTO_DISMISS_MS = 4000;

export default function ErrorToast() {
  const { t } = useLocale();
  const [state, setState] = useState<ErrorToastState | null>(getErrorToastState());

  useEffect(() => subscribeErrorToast(() => setState(getErrorToastState())), []);

  useEffect(() => {
    if (!state) return;
    const timer = setTimeout(() => dismissErrorToast(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [state]);

  if (!state) {
    return null;
  }

  return (
    <div data-testid="error-toast" className="toast toast-end toast-top z-50">
      <div
        className={`${
          state.variant === "info" ? "alert alert-info" : "alert alert-error"
        } flex w-[320px] items-center justify-between gap-3 text-sm`}
      >
        <span>{state.message}</span>
        <button
          type="button"
          data-testid="error-toast-dismiss"
          aria-label={t("aria.dismissToast")}
          className="btn btn-ghost btn-square btn-xs"
          onClick={() => dismissErrorToast()}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
