"use client";

// Quiet re-key notice (FSH-04/FAM-10 -- "the sharer is told, quietly"),
// 30-UI-SPEC.md's Re-Key Notice Contract. Reuses `CopyToast.tsx`'s exact
// visual shell (`toast toast-end toast-bottom`, 320px, `rounded-field
// border border-base-300 bg-base-100 p-3 text-sm`) -- deliberately NOT a
// DaisyUI `alert`, and NOT `warning`/`error`-colored: this is the literal
// meaning of "quiet", the same understated chrome the app already uses for
// a routine copy confirmation, not the heavier `alert-warning`/`alert-error`
// treatment reserved for things needing the user's active attention.
//
// Singleton, replace-not-stack (mirrors `copyToast.ts`'s own documented
// behavior): unlike CopyToast's per-event state object, this component holds
// a single `visible` boolean -- a second `onCollectionRekeyed` event arriving
// while the notice is already showing simply re-affirms the same boolean;
// there is only ever one notice instance, never a queue of collection ids.
// Content is deliberately generic (no item/collection name) -- a re-key
// batch may touch several items at once, and naming one would misrepresent
// the batch's scope (see `share.familyRekeyNotice`'s own copy note).
//
// No auto-hide timer -- unlike `CopyToast` (which tracks a real, time-bounded
// clipboard guarantee), a re-key event has no natural expiry: it persists
// until manually dismissed.
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { onCollectionRekeyed } from "@/lib/vault/collections";
import { useLocale } from "@/lib/i18n/LocaleContext";

export default function FamilyRekeyNotice() {
  const { t } = useLocale();
  const [visible, setVisible] = useState(false);

  useEffect(
    () =>
      onCollectionRekeyed(() => {
        setVisible(true);
      }),
    [],
  );

  if (!visible) {
    return null;
  }

  return (
    <div
      data-testid="family-rekey-notice"
      role="status"
      aria-live="polite"
      className="toast toast-end toast-bottom z-50"
    >
      <div className="flex w-[320px] items-center justify-between gap-3 rounded-field border border-base-300 bg-base-100 p-3 text-sm">
        <span>{t("share.familyRekeyNotice")}</span>
        <button
          type="button"
          data-testid="family-rekey-notice-dismiss"
          aria-label={t("aria.dismissToast")}
          className="btn btn-ghost btn-square btn-xs"
          onClick={() => setVisible(false)}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
