// entrypoints/popup/autofill/OnThisPageSection.tsx — the "Na tej stronie"
// popup section (10-06, 10-UI-SPEC.md; restructured 2026-07-16 per Bartek's
// NordPass two-section redesign, 10-POPUP-REDESIGN-SPEC.md).
//
// No longer owns useAutofillMatches() itself -- ItemListView.tsx (the new
// two-section container) owns the ONE hook instance and hands its raw
// `matches` straight down here as the `matches` prop, unmodified (no
// popup-side merging happens). This keeps the hook single-instance (one
// autofill.match dispatch per popup open) and makes this component purely
// presentational: header + row list + the two self-dismissing inline
// alerts (fill-failed, TOTP-copied).
//
// D-11 (11-CONTEXT.md ADDENDUM, Bartek 2026-07-16, delivered by 11-06): a
// LOGIN match can now appear here even when `detected` is all-false (the
// page has no login form) -- but that relaxation lives entirely in the
// BACKGROUND's handleAutofillMatch (autofill-match.ts), which skips its
// detected[kind] gate for kind === "login" only, origin-match still
// required. This component never re-derives or second-guesses that
// decision -- it renders whatever `matches` it is handed, exactly as
// before. Card/identity/totp gating is unchanged there too.
//
// No more collapsible dropdown (Bartek 2026-07-16): this section is now a
// PERMANENT, always-expanded sibling of the "Wszystkie" section below it in
// ItemListView -- the collapsed-state/chevron-toggle button that used to
// live here is gone entirely.
//
// This list IS still the D-07 multi-account picker when more than one item
// matches (10-UI-SPEC.md "Populated — multiple matches"): no separate
// dialog element exists anywhere in this file.
//
// A cross-origin subframe with no match looks IDENTICAL to any innocuous
// no-match (silent refusal, 10-UI-SPEC.md's Copywriting Contract) --
// `pageState === "ok"` with an empty `matches` prop always renders the same
// compact one-line hint, never a "blocked for security" banner.
//
// 11-09 addendum, ROUND 2 (Bartek 2026-07-16, live-review "nie powinno być
// 2 scrolli pod sekcjami"): the match-row list below NO LONGER owns its own
// bounded `max-h`/`overflow-y-auto` scroll box -- ItemListView.tsx now
// renders this component's normal (non-banner) output INSIDE its own ONE
// shared scroll container, alongside "Wszystkie", section under section.
// A second independent scroll region here would have reintroduced exactly
// the nested-scroll bug this whole addendum exists to fix. The
// `pageState === "restricted"/"unreachable"` banner branch is unaffected --
// ItemListView renders that one PINNED, outside the scroll container, since
// it's static content, never a scrollable list.
import { useEffect, useState } from "react";
import { AlertTriangle, Globe } from "lucide-react";
import AutofillItemRow from "./AutofillItemRow";
import TotpFillRow from "./TotpFillRow";
import { t, interpolate, type Locale } from "../../../lib/i18n/autofill-dictionary";
import type { AutofillMatch, DetectedFields, FillKind } from "../../../lib/autofill/types";
import type { MessageResponseMap } from "../../../lib/messaging/ext-protocol";
import type { AutofillPageState, CopyTotpResult } from "./useAutofillMatches";

const FILL_FAILED_DISPLAY_MS = 4000;

function hostnameOf(origin: string | null): string {
  if (origin === null) return "";
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
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

export interface OnThisPageSectionProps {
  locale: Locale;
  pageState: AutofillPageState;
  origin: string | null;
  detected: DetectedFields;
  /** useAutofillMatches()'s raw `matches`, passed straight through by
   * ItemListView.tsx with no popup-side merging or re-gating. As of 11-06
   * (D-11) this can include a LOGIN item even when `detected` is all-false
   * -- the background (handleAutofillMatch, autofill-match.ts) relaxes its
   * detection gate for logins only, origin-match still required.
   * Card/identity/totp remain gated there unchanged. */
  matches: AutofillMatch[];
  fill: (itemId: string, kind: FillKind) => Promise<MessageResponseMap["autofill.fill"]>;
  copyTotp: (itemId: string) => Promise<CopyTotpResult>;
  peekTotp: (itemId: string) => Promise<MessageResponseMap["autofill.totpCode"]>;
}

export default function OnThisPageSection({
  locale,
  pageState,
  origin,
  detected,
  matches,
  fill,
  copyTotp,
  peekTotp,
}: OnThisPageSectionProps) {
  const [fillFailed, setFillFailed] = useState(false);
  // BUG: TotpFillRow's "Kopiuj kod" wrote the clipboard but rendered no
  // confirmation at all -- toast.copied/totp.copiedField (autofill-
  // dictionary.ts) were dead keys. Auto-dismisses after the SAME
  // clipboard auto-clear window the toast text itself names, mirroring
  // fillFailed's own self-contained inline-alert pattern above.
  const [copiedSeconds, setCopiedSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!fillFailed) return;
    const timer = setTimeout(() => setFillFailed(false), FILL_FAILED_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [fillFailed]);

  useEffect(() => {
    if (copiedSeconds === null) return;
    const timer = setTimeout(() => setCopiedSeconds(null), copiedSeconds * 1000);
    return () => clearTimeout(timer);
  }, [copiedSeconds]);

  async function handleCopyTotp(itemId: string) {
    const result = await copyTotp(itemId);
    if (result.ok) {
      setCopiedSeconds(result.clearSeconds);
    }
    return result;
  }

  // "restricted"/"unreachable" REPLACES this section's own content with the
  // plain error banner (10-UI-SPEC.md's Component Inventory) -- no header,
  // never the compact-hint copy. ItemListView's "Wszystkie" section renders
  // independently of this branch, so the rest of the vault stays reachable.
  if (pageState === "restricted" || pageState === "unreachable") {
    return <AutofillErrorBanner locale={locale} />;
  }

  const headingHost = hostnameOf(origin);
  const heading =
    headingHost !== "" ? `${t(locale, "onThisPage.heading")} · ${headingHost}` : t(locale, "onThisPage.heading");

  return (
    <div className="flex flex-col gap-1" data-testid="on-this-page-section">
      {/* Section-label typography (popup UI round, Bartek-decided, decision
          2: 12px/weight 500) -- matches ItemListView.tsx's own "Wszystkie"
          heading exactly, so the two permanent section labels read as one
          consistent typographic family. No horizontal padding of its own
          (relies on ItemListView.tsx's content-card ancestor's own 16px
          `px-4`) -- previously carried its own `px-1` on top of that
          ancestor's padding, which this round's "16px horizontal padding"
          spec calls out as the section label's own, exact inset. */}
      <h2 className="flex min-w-0 items-center gap-2 text-xs font-medium text-base-content/60">
        <Globe size={16} className="shrink-0" aria-hidden="true" />
        <span className="truncate">{heading}</span>
      </h2>

      {pageState === "loading" ? (
        <div className="skeleton h-12 w-full rounded-box" data-testid="autofill-skeleton" />
      ) : matches.length === 0 ? (
        // Compact, single-line hint (Bartek: "one calm line") -- replaces
        // the old two-paragraph emoji empty state; the full vault is always
        // right below in ItemListView's "Wszystkie" section.
        <p className="px-1 py-2 text-sm text-base-content/50" data-testid="autofill-empty-state">
          {t(locale, "onThisPage.noMatch")}
        </p>
      ) : (
        // 11-09 addendum, ROUND 2: no `max-h`/`overflow-y-auto` here
        // anymore -- this list is now a plain, unbounded flex column.
        // ItemListView.tsx's own shared scroll container is what scrolls
        // it (together with "Wszystkie" below), never this element itself.
        <div
          className="flex min-h-[52px] flex-col divide-y divide-base-300"
          data-testid="on-this-page-list"
        >
          {matches.map((match: AutofillMatch) =>
            match.kind === "totp" ? (
              <TotpFillRow
                key={match.itemId}
                locale={locale}
                match={match}
                hasOtpField={detected.totp}
                onFill={fill}
                onCopyTotp={handleCopyTotp}
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
      )}

      {/* Phase 9's real popup has NO toast primitive (see original grep
          note preserved in git history) -- this stays a minimal,
          self-contained, auto-dismissing inline alert rather than a second
          toast SYSTEM. */}
      {fillFailed ? (
        <div className="alert alert-error text-sm" data-testid="autofill-fill-failed-toast">
          <span>{t(locale, "fill.failed")}</span>
        </div>
      ) : null}

      {/* Calm, non-alarming confirmation -- deliberately NOT alert-error/
          alert-warning styling; a successful copy is not a problem. */}
      {copiedSeconds !== null ? (
        <div className="alert text-sm" data-testid="autofill-totp-copied-toast">
          <span>
            {interpolate(t(locale, "toast.copied"), {
              field: t(locale, "totp.copiedField"),
              n: String(copiedSeconds),
            })}
          </span>
        </div>
      ) : null}
    </div>
  );
}
