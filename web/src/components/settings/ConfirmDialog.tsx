"use client";

// Generic confirm modal shared by SessionsTab's per-session revoke and
// bulk "Wyloguj pozostałe" actions (binding resolution #6, 03-UI-SPEC.md
// "Resolutions" section — both destructive session actions get a confirm
// modal, fat-finger/fat-key prevention, mirroring PasskeyDeleteConfirmDialog's
// shape but without the recovery-warning copy or the 409 defense-in-depth
// branch that dialog needs). Same 400px centered-modal shell as
// DeleteConfirmDialog.tsx — plain DM Sans, no Fuzzy Bubbles, security-
// adjacent per this phase's sober-UI rule.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onConfirm,
  onClose,
  // Plan 25-08: `severity` swaps the AlertTriangle/confirm-button color from
  // error(red)/irreversible to warning(amber)/reversible -- Color's
  // warning-vs-error split (25-UI-SPEC.md). Default "error" preserves
  // SessionsTab.tsx's two existing callers' exact current rendering, zero
  // behavior change.
  //
  // `error` (Rule 2 auto-fix, not in the plan's literal action text): the
  // Suspend flow's must_have requires `member.suspendFailed` to render
  // INLINE in this dialog on failure, never silently close it -- there was
  // previously no mechanism for a caller to surface an error message inside
  // this component's own card at all (a caller-thrown `onConfirm` only kept
  // the dialog mounted, with no visible text). Optional + defaulting to
  // `null` -- SessionsTab.tsx's two existing callers never pass it, so their
  // rendering is unaffected.
  severity = "error",
  error = null,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
  severity?: "error" | "warning";
  error?: string | null;
}) {
  const { t } = useLocale();
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm() {
    setConfirming(true);
    try {
      await onConfirm();
    } finally {
      setConfirming(false);
    }
  }

  const iconColorClass = severity === "warning" ? "text-warning" : "text-error";
  const confirmButtonColorClass = severity === "warning" ? "btn-warning" : "btn-error";

  return (
    <div
      data-testid="confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className={`shrink-0 ${iconColorClass}`} aria-hidden="true" />
          <h2 className="text-[20px] font-bold leading-[1.2]">{title}</h2>
        </div>
        <p className="text-base">{body}</p>
        {error !== null ? (
          <p role="alert" data-testid="confirm-dialog-error" className="text-sm text-error">
            {error}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="confirm-dialog-cancel"
            className="btn btn-ghost"
            onClick={onClose}
          >
            {t("delete.cancel")}
          </button>
          <button
            type="button"
            data-testid="confirm-dialog-confirm"
            className={`btn ${confirmButtonColorClass}`}
            disabled={confirming}
            onClick={() => void handleConfirm()}
          >
            {confirming ? (
              <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            ) : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
