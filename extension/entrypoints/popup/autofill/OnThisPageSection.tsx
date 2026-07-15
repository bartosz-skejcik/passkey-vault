// entrypoints/popup/autofill/OnThisPageSection.tsx — the "Na tej stronie"
// popup section (10-06, 10-UI-SPEC.md). Owns `useAutofillMatches()`
// directly (not lifted to a parent) so ItemListView.tsx only needs to
// mount this ONE component above its existing list -- matching the
// UI-SPEC's Scope Note: "every surface below is a new section/state
// inside the existing extension popup shell ... not a new content-script
// UI".
//
// This list IS the D-07 multi-account picker when more than one item
// matches (10-UI-SPEC.md "Populated — multiple matches"): no separate
// dialog element exists anywhere in this file.
//
// A cross-origin subframe with no match looks IDENTICAL to any innocuous
// no-match (silent refusal, 10-UI-SPEC.md's Copywriting Contract) --
// `pageState === "ok"` with `matches: []` always renders the same
// AutofillEmptyState, never a "blocked for security" banner.
import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp, Globe } from "lucide-react";
import { useAutofillMatches } from "./useAutofillMatches";
import AutofillItemRow from "./AutofillItemRow";
import TotpFillRow from "./TotpFillRow";
import { t, type Locale } from "../../../lib/i18n/autofill-dictionary";
import type { AutofillMatch } from "../../../lib/autofill/types";

const FILL_FAILED_DISPLAY_MS = 4000;

function hostnameOf(origin: string | null): string {
  if (origin === null) return "";
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function AutofillEmptyState({ locale }: { locale: Locale }) {
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-6 text-center" data-testid="autofill-empty-state">
      <p className="font-hand text-base">{t(locale, "empty.heading")}</p>
      <p className="text-sm text-base-content/60">{t(locale, "empty.body")}</p>
    </div>
  );
}

function AutofillErrorBanner({ locale }: { locale: Locale }) {
  return (
    <div
      className="alert alert-error flex items-start gap-2 text-sm"
      data-testid="autofill-error-banner"
    >
      <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="flex flex-col gap-0.5">
        <span className="font-bold">{t(locale, "restricted.heading")}</span>
        <span>{t(locale, "restricted.body")}</span>
      </div>
    </div>
  );
}

export default function OnThisPageSection({ locale }: { locale: Locale }) {
  const { pageState, origin, detected, matches, fill, copyTotp, peekTotp } = useAutofillMatches();
  const [collapsed, setCollapsed] = useState(false);
  const [fillFailed, setFillFailed] = useState(false);

  useEffect(() => {
    if (!fillFailed) return;
    const timer = setTimeout(() => setFillFailed(false), FILL_FAILED_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [fillFailed]);

  // "restricted"/"unreachable" REPLACES the whole section with the plain
  // error banner (10-UI-SPEC.md's Component Inventory) -- no collapse
  // chrome, no header, never the empty-state emoji.
  if (pageState === "restricted" || pageState === "unreachable") {
    return <AutofillErrorBanner locale={locale} />;
  }

  const headingHost = hostnameOf(origin);
  const heading = headingHost !== "" ? `${t(locale, "onThisPage.heading")} · ${headingHost}` : t(locale, "onThisPage.heading");

  return (
    <div
      className="flex flex-col gap-1 rounded-box border border-base-300 bg-base-100 p-2"
      data-testid="on-this-page-section"
    >
      <button
        type="button"
        data-testid="on-this-page-toggle"
        className="flex items-center justify-between gap-2 px-1 py-1 text-left"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-base-content/80">
          <Globe size={16} className="shrink-0" aria-hidden="true" />
          <span className="truncate">{heading}</span>
        </span>
        {collapsed ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronUp size={16} aria-hidden="true" />}
      </button>

      {!collapsed ? (
        pageState === "loading" ? (
          <div className="skeleton h-12 w-full rounded-box" data-testid="autofill-skeleton" />
        ) : matches.length === 0 ? (
          <AutofillEmptyState locale={locale} />
        ) : (
          <div className="flex flex-col divide-y divide-base-300">
            {matches.map((match: AutofillMatch) =>
              match.kind === "totp" ? (
                <TotpFillRow
                  key={match.itemId}
                  locale={locale}
                  match={match}
                  hasOtpField={detected.totp}
                  onFill={fill}
                  onCopyTotp={copyTotp}
                  onPeekTotp={peekTotp}
                  onFillFailed={() => setFillFailed(true)}
                />
              ) : (
                <AutofillItemRow
                  key={match.itemId}
                  locale={locale}
                  match={match}
                  onFill={fill}
                  onFillFailed={() => setFillFailed(true)}
                />
              ),
            )}
          </div>
        )
      ) : null}

      {/* Phase 9's real popup has NO toast primitive yet (confirmed by grep
          at exec time -- see this plan's SUMMARY "Real Phase 9 shapes
          found"), so this is a minimal, self-contained, auto-dismissing
          inline alert rather than a second toast SYSTEM (10-UI-SPEC.md's
          "do not invent a second toast system" is about not building a
          competing global dispatcher -- this is scoped to this section
          alone and disappears on its own). */}
      {fillFailed ? (
        <div className="alert alert-error text-sm" data-testid="autofill-fill-failed-toast">
          <span>{t(locale, "fill.failed")}</span>
        </div>
      ) : null}
    </div>
  );
}
