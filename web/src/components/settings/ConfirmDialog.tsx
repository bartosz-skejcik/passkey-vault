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
}: {
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
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
          <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
          <h2 className="text-[20px] font-bold leading-[1.2]">{title}</h2>
        </div>
        <p className="text-base">{body}</p>
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
            className="btn btn-error"
            disabled={confirming}
            onClick={() => void handleConfirm()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
