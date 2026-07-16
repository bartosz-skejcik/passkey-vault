// entrypoints/popup/autofill/AutofillItemRow.tsx — login/card/identity row
// inside OnThisPageSection (10-06). TOTP has its own variant,
// TotpFillRow.tsx (embeds a live countdown ring), so this component only
// ever renders `match.kind === "login" | "card" | "identity"`.
//
// Login fills on the FIRST click (D-03's single-click bar, already
// gesture-gated by popup-open + this click). Card/identity route through
// SensitiveFillConfirm's inline SECOND click before `onFill` is ever
// called (D-12) -- the first click only expands the confirm, it never
// fills.
import { useState } from "react";
import { CreditCard, Globe, IdCard } from "lucide-react";
import SensitiveFillConfirm from "./SensitiveFillConfirm";
import { t, type Locale } from "../../../lib/i18n/autofill-dictionary";
import type { AutofillMatch, FillKind } from "../../../lib/autofill/types";
import type { MessageResponseMap } from "../../../lib/messaging/ext-protocol";

// "totp" is intentionally absent -- TotpFillRow owns that icon/row shape.
const TYPE_ICON: Partial<Record<FillKind, typeof Globe>> = {
  login: Globe,
  card: CreditCard,
  identity: IdCard,
};

/** Extracts "1234" out of a maskedHint like "••••1234" -- the confirm
 * copy's `{last4}` token wants the bare digits, not the masked string. */
function last4FromMaskedHint(maskedHint: string): string {
  const match = maskedHint.match(/(\d{4})$/);
  return match ? match[1] : "";
}

export interface AutofillItemRowProps {
  locale: Locale;
  match: AutofillMatch;
  onFill: (itemId: string, kind: FillKind) => Promise<MessageResponseMap["autofill.fill"]>;
  onFillFailed: () => void;
}

export default function AutofillItemRow({ locale, match, onFill, onFillFailed }: AutofillItemRowProps) {
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const Icon = TYPE_ICON[match.kind] ?? Globe;
  const needsConfirm = match.kind === "card" || match.kind === "identity";

  async function doFill() {
    setPending(true);
    try {
      const result = await onFill(match.itemId, match.kind);
      if (!result.ok) {
        onFillFailed();
      } else {
        // BUG-2: close the popup after a CONFIRMED successful fill --
        // never on the copy path (see TotpFillRow.handleCopy, which
        // intentionally leaves the popup open so the user sees the toast).
        window.close();
      }
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  function handleFillClick() {
    if (needsConfirm) {
      setConfirming((prev) => !prev);
      return;
    }
    void doFill();
  }

  return (
    <div className="flex flex-col gap-1 py-1" data-testid={`autofill-row-${match.itemId}`}>
      <div className="flex min-h-[48px] items-center gap-2 px-1">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-base-200 text-base-content/70">
          <Icon size={18} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col items-start">
          <span className="truncate text-base">{match.label}</span>
          <span className="truncate text-sm text-base-content/60">{match.maskedHint}</span>
        </span>
        <button
          type="button"
          data-testid={`autofill-fill-${match.itemId}`}
          className="btn btn-primary btn-sm shrink-0"
          disabled={pending}
          onClick={handleFillClick}
        >
          {pending ? <span className="loading loading-spinner loading-xs" aria-hidden="true" /> : null}
          {t(locale, "autofill.fillCta")}
        </button>
      </div>

      {confirming && needsConfirm ? (
        <div className="px-1">
          <SensitiveFillConfirm
            locale={locale}
            kind={match.kind === "card" ? "card" : "identity"}
            detail={match.kind === "card" ? last4FromMaskedHint(match.maskedHint) : match.label}
            onConfirm={() => void doFill()}
            onCancel={() => setConfirming(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
