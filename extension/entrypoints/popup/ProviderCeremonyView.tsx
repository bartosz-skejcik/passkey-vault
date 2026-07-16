// ProviderCeremonyView.tsx — the popup-hosted passkey ceremony consent
// screen (12-UI-SPEC.md), the ONLY user-visible surface of the whole
// passkey-provider feature (12-CONTEXT.md's explicit non-goal: no in-page
// indicator this phase).
//
// Pure, fully-controlled by its caller (App.tsx): every piece of ceremony
// state (kind, site, matches, PRF signal, busy/failed status) arrives as
// props, and every user action (confirm/select/decline) is reported back
// via callback props -- this component never talks to
// chrome.storage.session or browser.runtime.sendMessage directly. That
// wiring lives in App.tsx, mirroring every other view in this popup
// (UnlockView, ItemListView, ...).
//
// D-16 (PRF capability-driven, never browser-sniff): the PRF-capable/
// PRF-unavailable note choice is driven EXCLUSIVELY by the `prfRequested`/
// `prfCapable` props (sourced, at the App.tsx call site, from
// provider-ceremony.ts's REAL passkey-rs capability signal) -- there is no
// navigator.userAgent/browser-sniffing code anywhere in this file, on any
// code path. This screen's PRF notes are scoped to the RP's OWN prf
// request, never Phase 3/4's vault-unlock PRF feature (12-UI-SPEC.md
// Phase-Specific Note) -- do not wire this component's props from
// anything related to the extension-scoped unlock PRF passkey.
//
// D-11 (dismissal = decline): if this view unmounts (popup/window closed)
// or the window fires `beforeunload` while the ceremony is still pending
// (no explicit confirm/decline/select-then-confirm action was taken),
// `onDecline` fires exactly once -- so the page's create()/get() promise
// this ceremony is servicing never hangs.
//
// Color/Copy discipline (12-UI-SPEC.md): single teal (`btn-accent`)
// confirm CTA, `btn-ghost` decline with NO icon and NO accent class --
// `btn-primary`/coral never appears anywhere in this view (this phase's
// ceremony has no password-equivalent second accent-weighted path, unlike
// Phase 4's unlock screen). No favicon fetch (neutral `Globe` icon +
// hostname text only). No empty/"no matches" state -- a zero-match get()
// never mounts this component at all (Plan 12-02's silent fallthrough).
import { useEffect, useRef } from "react";
import { Fingerprint, Globe, KeyRound, Loader2 } from "lucide-react";
import { interpolate, t, type Locale } from "../../lib/i18n/dictionary";

export interface ProviderCredentialCandidate {
  itemId: string;
  label: string;
}

export type ProviderCeremonyStatus = "idle" | "busy" | "failed";

export interface ProviderCeremonyViewProps {
  locale: Locale;
  kind: "create" | "get";
  /** RP hostname, shown next to the neutral Globe icon (no favicon fetch,
   * 12-UI-SPEC.md "Favicon strategy: none"). */
  site: string;
  /** create: the account being registered (provider.accountLabel). get,
   * single-match: the pre-selected credential's account label
   * (provider.signinBodySingle's `{account}` interpolation). Unused for a
   * multi-match get (the row list carries its own labels). */
  account?: string;
  /** get, multi-match only (more than one entry) -- omit/leave empty for
   * `create` and for a single-match get (12-UI-SPEC.md: "no list is
   * rendered at all for the single-match case"). */
  matches?: ProviderCredentialCandidate[];
  selectedItemId?: string | null;
  onSelect?: (itemId: string) => void;
  /** Whether the RP's OWN create()/get() request included the WebAuthn
   * `prf` extension. */
  prfRequested: boolean;
  /** The REAL capability signal from background's passkey-rs ceremony
   * (D-16) -- `undefined` until known, `true`/`false` once background
   * reports it. Never derived from browser/user-agent detection anywhere
   * in this file. */
  prfCapable?: boolean;
  status: ProviderCeremonyStatus;
  onConfirm: () => void;
  onDecline: () => void;
}

function isMultiMatch(kind: "create" | "get", matches?: ProviderCredentialCandidate[]): boolean {
  return kind === "get" && Array.isArray(matches) && matches.length > 1;
}

/** D-16: the ONLY inputs this function ever consults are the props passed
 * in by the caller (themselves sourced from background's REAL passkey-rs
 * ceremony signal) -- no `navigator.userAgent`, no browser/OS detection.
 * `provider.prfCapableNote` is `create`-only (12-UI-SPEC.md's Teal
 * section); `provider.prfUnavailableNote` applies to either ceremony kind. */
function resolvePrfNoteKey(
  kind: "create" | "get",
  prfRequested: boolean,
  prfCapable: boolean | undefined,
): "provider.prfCapableNote" | "provider.prfUnavailableNote" | null {
  if (!prfRequested) {
    return null;
  }
  if (prfCapable === true) {
    return kind === "create" ? "provider.prfCapableNote" : null;
  }
  if (prfCapable === false) {
    return "provider.prfUnavailableNote";
  }
  return null;
}

export default function ProviderCeremonyView({
  locale,
  kind,
  site,
  account,
  matches,
  selectedItemId,
  onSelect,
  prfRequested,
  prfCapable,
  status,
  onConfirm,
  onDecline,
}: ProviderCeremonyViewProps) {
  const onDeclineRef = useRef(onDecline);
  onDeclineRef.current = onDecline;
  // Flipped by the confirm/decline click handlers below BEFORE calling the
  // corresponding prop, so this component's own unmount-triggered decline
  // (D-11) never double-fires after a normal, explicit resolution.
  const resolvedRef = useRef(false);

  useEffect(() => {
    function handleBeforeUnload() {
      if (!resolvedRef.current) {
        resolvedRef.current = true;
        onDeclineRef.current();
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Covers the popup-close-without-beforeunload path too (Chrome does
      // not always fire `beforeunload` for an extension popup losing
      // focus/closing) -- an unmount while still unresolved is itself a
      // dismissal.
      if (!resolvedRef.current) {
        resolvedRef.current = true;
        onDeclineRef.current();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const multiMatch = isMultiMatch(kind, matches);

  const title = t(locale, kind === "create" ? "provider.createTitle" : "provider.signinTitle");
  const body =
    kind === "create"
      ? interpolate(t(locale, "provider.createBody"), { site })
      : multiMatch
        ? interpolate(t(locale, "provider.signinBodyMultiple"), { site })
        : interpolate(t(locale, "provider.signinBodySingle"), { site, account: account ?? "" });

  const busy = status === "busy";
  const ctaLabel = t(
    locale,
    busy
      ? kind === "create"
        ? "provider.createBusy"
        : "provider.signinBusy"
      : kind === "create"
        ? "provider.createCta"
        : "provider.signinCta",
  );
  const ctaDisabled = busy || (multiMatch && !selectedItemId);

  const prfNoteKey = resolvePrfNoteKey(kind, prfRequested, prfCapable);

  function handleConfirmClick() {
    resolvedRef.current = true;
    onConfirm();
  }

  function handleDeclineClick() {
    resolvedRef.current = true;
    onDecline();
  }

  return (
    <div className="flex w-[380px] flex-col gap-4 p-6">
      <div className="flex items-center gap-1 text-sm text-base-content/70">
        <Globe size={16} aria-hidden="true" />
        <span>{site}</span>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-base text-base-content/70">{body}</p>
        {kind === "create" && account ? (
          <p className="text-sm text-base-content/70">
            {interpolate(t(locale, "provider.accountLabel"), { account })}
          </p>
        ) : null}
      </div>

      {multiMatch ? (
        <div className="flex flex-col gap-2" role="radiogroup">
          {(matches ?? []).map((candidate) => {
            const selected = candidate.itemId === selectedItemId;
            return (
              <button
                key={candidate.itemId}
                type="button"
                role="radio"
                aria-checked={selected}
                data-testid={`provider-credential-row-${candidate.itemId}`}
                onClick={() => onSelect?.(candidate.itemId)}
                className={`flex h-14 w-full items-center gap-2 rounded-box border px-3 text-left ${
                  selected ? "border-accent bg-base-100" : "border-base-300 bg-base-200"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                  <KeyRound size={20} className="text-accent" aria-hidden="true" />
                </span>
                <span className="flex-1 truncate text-sm">{candidate.label}</span>
                <span
                  className={`h-4 w-4 shrink-0 rounded-full border ${
                    selected ? "border-accent bg-accent" : "border-base-content/40"
                  }`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>
      ) : null}

      {prfNoteKey ? <p className="text-sm text-base-content/70">{t(locale, prfNoteKey)}</p> : null}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="btn btn-accent w-full"
          disabled={ctaDisabled}
          data-testid="provider-confirm"
          onClick={handleConfirmClick}
        >
          <span className="relative inline-flex">
            {busy ? (
              <>
                <Fingerprint size={18} aria-hidden="true" />
                <Loader2
                  size={16}
                  className="absolute -right-2 -top-2 animate-spin"
                  aria-hidden="true"
                />
              </>
            ) : (
              <KeyRound size={18} aria-hidden="true" />
            )}
          </span>
          {ctaLabel}
        </button>

        {status === "failed" ? (
          <p className="text-sm text-error">{t(locale, "provider.failed")}</p>
        ) : null}

        <button
          type="button"
          className="btn btn-ghost w-full"
          data-testid="provider-decline"
          onClick={handleDeclineClick}
        >
          {t(locale, "provider.useOther")}
        </button>
      </div>
    </div>
  );
}
