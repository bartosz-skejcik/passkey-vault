"use client";

// SHARE-06's revoke confirmation (Phase 28, Plan 02 -- closes v0.4 audit
// Blocker 1). Reuses `DeleteConfirmDialog.tsx`'s exact shell verbatim
// (28-UI-SPEC.md's Design System table): same `fixed inset-0 z-50 ...`
// wrapper / `w-full max-w-[400px] ... p-6` card, `AlertTriangle` at
// `text-error`, one Cancel/Confirm pair, `btn-error` confirm -- the
// "single-step" destructive-confirmation tier the UI-SPEC's own
// "Destructive-confirmation reasoning" section justifies (revoke has zero
// re-key cost and a one-click undo path, unlike `RemoveMemberDialog`'s
// heavier two-step tier).
//
// The one addition `DeleteConfirmDialog` does not need: an inline error
// slot. A revoke can legitimately fail two DISTINCT, expected ways -- a
// `409` last-key-holder guard (collection-only) vs. any other failure --
// and both must render honest, specific copy WITHOUT closing the dialog
// (28-UI-SPEC.md E1 error-409/error-generic). The dialog only closes on a
// genuine 204 (T-28-11: never optimistically ahead of the server response).
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ApiClientError } from "@/lib/auth/api";
import { revokeCollectionAccess, revokeItemShare } from "@/lib/vault/api";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";

export type RevokeShareKind = "folder" | "item";

export default function RevokeShareDialog({
  kind,
  targetId,
  recipientUserId,
  recipientEmail,
  targetName,
  onClose,
  onRevoked,
}: {
  /** "folder" -> `revokeCollectionAccess` (collections.rs::revoke_access,
   * can 409 on the last key-holder); "item" -> `revokeItemShare`
   * (vault.rs::revoke_share, never 409s -- 28-RESEARCH.md §A). */
  kind: RevokeShareKind;
  /** The collection id (kind="folder") or item id (kind="item") the grant
   * lives on. */
  targetId: string;
  /** The recipient whose grant is being revoked -- the DELETE path's own
   * `{user_id}` segment. */
  recipientUserId: string;
  recipientEmail: string;
  /** The folder or item's own display name, for the title/aria-label. */
  targetName: string;
  onClose: () => void;
  /** Fired ONLY after the DELETE genuinely resolves (204) -- never
   * optimistically. The caller (SharingOverviewPanel) splices its own local
   * state from here, never a forced re-fetch. */
  onRevoked: () => void;
}) {
  const { t } = useLocale();
  const [revoking, setRevoking] = useState(false);
  const [errorKey, setErrorKey] = useState<"revokeLastKeyHolder" | "revokeFailed" | null>(null);

  async function handleConfirm() {
    setRevoking(true);
    setErrorKey(null);
    try {
      if (kind === "folder") {
        await revokeCollectionAccess(targetId, recipientUserId);
      } else {
        await revokeItemShare(targetId, recipientUserId);
      }
      onRevoked();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setErrorKey("revokeLastKeyHolder");
      } else {
        setErrorKey("revokeFailed");
      }
      setRevoking(false);
    }
  }

  const titleKey = kind === "folder" ? "share.revokeFolderTitle" : "share.revokeItemTitle";
  const titleVars: Record<string, string> =
    kind === "folder"
      ? { email: recipientEmail, folder: targetName }
      : { email: recipientEmail, item: targetName };
  const titleText = interpolate(t(titleKey), titleVars);

  return (
    <div
      data-testid="revoke-share-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
          {/* Backstop (28-UI-SPEC.md E1): a >=40-char folder/item name or a
              long email must not overflow the 400px card -- same
              truncate+title treatment as every other dialog title in this
              codebase that interpolates a user-controlled name. */}
          <h2
            className="min-w-0 flex-1 truncate text-[20px] font-bold leading-[1.2]"
            title={titleText}
          >
            {titleText}
          </h2>
        </div>
        {/* Honesty constraint (28-UI-SPEC.md §A, hard requirement): this
            string must render VERBATIM, never shortened or reworded -- a
            revoked recipient who already saw the secret still knows it. */}
        <p className="text-base">{interpolate(t("share.revokeBody"), { email: recipientEmail })}</p>
        {errorKey !== null ? (
          <p role="alert" data-testid="revoke-share-error" className="text-sm text-error">
            {t(`share.${errorKey}`)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-testid="revoke-share-cancel"
            className="btn btn-ghost"
            onClick={onClose}
          >
            {t("delete.cancel")}
          </button>
          <button
            type="button"
            data-testid="revoke-share-confirm"
            className="btn btn-error"
            disabled={revoking}
            onClick={() => void handleConfirm()}
          >
            {revoking ? t("share.revoking") : t("share.revokeConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
