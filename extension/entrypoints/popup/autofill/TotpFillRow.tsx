// entrypoints/popup/autofill/TotpFillRow.tsx — the TOTP autofill row
// (10-06, 10-UI-SPEC.md).
//
// Deliberately does NOT literally import
// web/src/components/vault/TotpCountdownRing.tsx: that component calls the
// client-side crypto module's totpNow() directly on a raw TOTP secret it
// receives as props, which this popup NEVER receives at all (D-02's
// zero-knowledge boundary; this plan's own acceptance criteria forbid any
// WASM-crypto-module import anywhere under entrypoints/popup/autofill/).
// Instead this file polls the background's
// `autofill.totpCode` message (the ONE sanctioned path for a derived-
// from-secret value to reach the popup, per the threat model's T-10-22/
// T-10-23) via the `onPeekTotp` prop (useAutofillMatches.ts's peekTotp,
// which never writes the clipboard) and renders the SAME visual treatment
// TotpCountdownRing uses -- `radial-progress text-primary` ring +
// `font-mono` code, same 24px list-row sizing -- sourced from message
// responses instead of a local wasm call.
//
// The ring's percent is a self-correcting estimate of the item's true
// period: the first response after mount may reflect a partial period
// (whatever `secondsRemaining` the background returns for "right now"),
// but every refetch is scheduled to land exactly at THAT response's
// period boundary, so the running max of observed `secondsRemaining`
// converges to the true period within one full period of mounting.
import { useEffect, useState } from "react";
import { Clipboard, CornerDownLeft, Timer } from "lucide-react";
import SharedBadge from "../SharedBadge";
import { t, type Locale } from "../../../lib/i18n/autofill-dictionary";
import type { AutofillMatch, FillKind } from "../../../lib/autofill/types";
import type { MessageResponseMap } from "../../../lib/messaging/ext-protocol";

type TotpCodeResponse = MessageResponseMap["autofill.totpCode"];

function useTotpTicker(itemId: string, peek: (itemId: string) => Promise<TotpCodeResponse>) {
  const [code, setCode] = useState<string | null>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [periodEstimate, setPeriodEstimate] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    let tickTimer: ReturnType<typeof setInterval> | null = null;

    async function fetchCode() {
      const result = await peek(itemId);
      if (cancelled) return;
      if (!result.ok) {
        setError(true);
        return;
      }
      setError(false);
      setCode(result.code);
      setSecondsRemaining(result.secondsRemaining);
      setPeriodEstimate((prev) =>
        prev === null || result.secondsRemaining > prev ? result.secondsRemaining : prev,
      );
      refetchTimer = setTimeout(() => void fetchCode(), Math.max(1, result.secondsRemaining) * 1000);
    }

    tickTimer = setInterval(() => {
      setSecondsRemaining((prev) => (prev !== null && prev > 0 ? prev - 1 : prev));
    }, 1000);

    void fetchCode();

    return () => {
      cancelled = true;
      if (refetchTimer !== null) clearTimeout(refetchTimer);
      if (tickTimer !== null) clearInterval(tickTimer);
    };
    // itemId fully determines the ticking series; `peek` is stable
    // (useCallback([]) in useAutofillMatches.ts).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  return { code, secondsRemaining, periodEstimate, error };
}

export interface TotpFillRowProps {
  locale: Locale;
  match: AutofillMatch;
  hasOtpField: boolean;
  onFill: (itemId: string, kind: FillKind) => Promise<MessageResponseMap["autofill.fill"]>;
  onCopyTotp: (itemId: string) => Promise<TotpCodeResponse>;
  onPeekTotp: (itemId: string) => Promise<TotpCodeResponse>;
  onFillFailed: () => void;
}

export default function TotpFillRow({
  locale,
  match,
  hasOtpField,
  onFill,
  onCopyTotp,
  onPeekTotp,
  onFillFailed,
}: TotpFillRowProps) {
  const { code, secondsRemaining, periodEstimate, error } = useTotpTicker(match.itemId, onPeekTotp);
  const [fillPending, setFillPending] = useState(false);

  const percent =
    code !== null && secondsRemaining !== null && periodEstimate !== null && periodEstimate > 0
      ? Math.round((secondsRemaining / periodEstimate) * 100)
      : 0;

  async function handleCopy() {
    const result = await onCopyTotp(match.itemId);
    if (!result.ok) {
      onFillFailed();
    }
  }

  async function handleFill() {
    setFillPending(true);
    try {
      const result = await onFill(match.itemId, "totp");
      if (!result.ok) {
        onFillFailed();
      } else {
        // BUG-2: close the popup after a successful fill -- never on the
        // copy path (handleCopy above intentionally leaves the popup open
        // so the user sees the toast).
        window.close();
      }
    } finally {
      setFillPending(false);
    }
  }

  return (
    <div className="flex min-h-[48px] items-center gap-2 px-1 py-1" data-testid={`autofill-row-${match.itemId}`}>
      <span className="relative inline-flex shrink-0">
        <span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-base-200 text-base-content/70">
          <Timer size={18} aria-hidden="true" />
        </span>
        {/* 27-09: SAME SharedBadge (27-08) ItemListView.tsx's "Wszystkie"
            rows use -- reused, never re-derived. Personal rows
            (match.isShared !== true) render byte-identical to before this
            wrapper was added. */}
        {match.isShared === true ? <SharedBadge locale={locale} /> : null}
      </span>
      <span className="flex min-w-0 flex-1 flex-col items-start">
        <span className="truncate text-base">{match.label}</span>
        <span className="truncate text-sm text-base-content/60">{match.maskedHint}</span>
      </span>

      {error || code === null ? (
        <span data-testid="totp-ring-error" className="text-sm text-base-content/50">
          —
        </span>
      ) : (
        <div className="flex items-center gap-2">
          <div
            className="radial-progress text-primary shrink-0"
            style={{ "--value": percent, "--size": "1.5rem", "--thickness": "3px" } as React.CSSProperties}
            role="progressbar"
            aria-valuenow={percent}
          />
          <span className="font-mono text-base">{code}</span>
        </div>
      )}

      <button
        type="button"
        data-testid={`autofill-totp-copy-${match.itemId}`}
        aria-label={t(locale, "totp.copyCta")}
        className="btn btn-ghost btn-square btn-sm shrink-0"
        onClick={() => void handleCopy()}
      >
        <Clipboard size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        data-testid={`autofill-totp-fill-${match.itemId}`}
        aria-label={t(locale, "totp.fillCta")}
        title={hasOtpField ? undefined : t(locale, "totp.fillDisabledHint")}
        className="btn btn-ghost btn-square btn-sm shrink-0"
        disabled={!hasOtpField || fillPending}
        onClick={() => void handleFill()}
      >
        {fillPending ? (
          <span className="loading loading-spinner loading-xs" aria-hidden="true" />
        ) : (
          <CornerDownLeft size={16} aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
