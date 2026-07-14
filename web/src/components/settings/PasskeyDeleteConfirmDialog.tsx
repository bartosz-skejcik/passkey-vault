"use client";

// Passkey delete confirmation dialog (AUTH-05, AUTH-06 — destructive,
// security-critical, per 03-UI-SPEC.md's "Passkey delete confirmation
// dialog" section). Modeled directly on
// web/src/components/vault/DeleteConfirmDialog.tsx's structure (same
// 400px modal shell, AlertTriangle + Heading + Body + btn-ghost Cancel /
// btn-error Confirm) — plain DM Sans, no Fuzzy Bubbles, no emoji.
//
// The one structural difference from DeleteConfirmDialog: a 409 response
// (defense-in-depth "would strand the vault" guard, T-03-10) must NOT
// silently close the dialog — it replaces the Confirm/Cancel row with a
// distinct alert-error block instead of folding into the generic error
// path.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { deletePasskey, type PasskeyRow } from "@/lib/passkeys/api";
import { ApiClientError } from "@/lib/auth/api";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";

export default function PasskeyDeleteConfirmDialog({
  passkey,
  onClose,
  onDeleted,
}: {
  passkey: PasskeyRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useLocale();
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [genericError, setGenericError] = useState(false);

  async function handleConfirm() {
    setDeleting(true);
    setGenericError(false);
    try {
      await deletePasskey(passkey.id);
      onDeleted();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setBlocked(true);
      } else {
        setGenericError(true);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      data-testid="passkey-delete-confirm-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={blocked ? undefined : onClose}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
          <h2 className="text-[20px] font-bold leading-[1.2]">
            {interpolate(t("passkeys.deleteTitle"), { name: passkey.name })}
          </h2>
        </div>
        <p className="text-base">{t("passkeys.deleteBody")}</p>

        {genericError ? (
          <p data-testid="passkey-delete-generic-error" className="text-sm text-error">
            {t("passkeys.deleteFailed")}
          </p>
        ) : null}

        {blocked ? (
          <div data-testid="passkey-delete-blocked-alert" className="alert alert-error text-sm">
            {t("passkeys.deleteBlockedError")}
          </div>
        ) : null}

        {blocked ? (
          <div className="flex justify-end">
            <button
              type="button"
              data-testid="passkey-delete-blocked-dismiss"
              className="btn btn-ghost"
              onClick={onClose}
            >
              {t("delete.cancel")}
            </button>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              data-testid="passkey-delete-cancel"
              className="btn btn-ghost"
              onClick={onClose}
            >
              {t("delete.cancel")}
            </button>
            <button
              type="button"
              data-testid="passkey-delete-confirm"
              className="btn btn-error"
              disabled={deleting}
              onClick={() => void handleConfirm()}
            >
              {t("passkeys.deleteConfirm")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
