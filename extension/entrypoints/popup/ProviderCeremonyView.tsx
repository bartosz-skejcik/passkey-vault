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
import SharedBadge from "./SharedBadge";

export interface ProviderCredentialCandidate {
  itemId: string;
  label: string;
  /** 27-06 (UI-SPEC data-contract prerequisite): set only for a genuinely
   * shared candidate (mirrors `VaultItem.isShared`/`AutofillMatch.isShared`,
   * 27-05's identical precedent) -- never explicit `false` for a personal
   * one. Wiring this into the multi-match row UI (badge/folder label) is
   * 27-10's job, not this plan's -- this type extension is the prerequisite
   * only. */
  isShared?: boolean;
  /** The owning collection's decrypted name, when already resolvable
   * (`collections-store.ts`'s synchronous `getCollections()` cache) --
   * `undefined`, never fabricated, when unresolved or the item is personal/
   * direct-shared. Same never-fabricating discipline as
   * `autofill-match.ts`'s own `folderNameFor()` (27-05). */
  folderName?: string;
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
  /** Whether the RP's OWN create()/get() request included the WebAuthn
   * `prf` extension. */
  prfRequested: boolean;
  /** The REAL capability signal from background's passkey-rs ceremony
   * (D-16) -- `undefined` until known, `true`/`false` once background
   * reports it. Never derived from browser/user-agent detection anywhere
   * in this file. */
  prfCapable?: boolean;
  status: ProviderCeremonyStatus;
  /** Quick task 260717-lnx: a multi-match row click now confirms the
   * ceremony directly, passing its own itemId -- no separate
   * select-then-confirm step. `create`/single-match still call this with
   * no argument via the explicit CTA button. */
  onConfirm: (itemId?: string) => void;
  onDecline: () => void;
}

function isMultiMatch(kind: "create" | "get", matches?: ProviderCredentialCandidate[]): boolean {
  return kind === "get" && Array.isArray(matches) && matches.length > 1;
}

/** 27-UI-SPEC.md E4 "Ordering caveat": personal candidates sort before
 * shared ones in the multi-match list, each group keeping its own existing
 * relative order -- a stable partition (never a resort of the whole array),
 * mirroring `autofill-match.ts`'s identical UX-3 precedent (27-05). Built
 * locally rather than imported: this is a background-message-response
 * array already resolved by the time this component renders, not a live
 * `getItems()` consumer autofill-match.ts's helper is shaped for. */
function orderCandidatesPersonalFirst(
  matches: ProviderCredentialCandidate[],
): ProviderCredentialCandidate[] {
  const personal: ProviderCredentialCandidate[] = [];
  const shared: ProviderCredentialCandidate[] = [];
  for (const candidate of matches) {
    if (candidate.isShared === true) {
      shared.push(candidate);
    } else {
      personal.push(candidate);
    }
  }
  return [...personal, ...shared];
}

/** E4 populated/partial: the folder-name note when resolvable, the
 * folder-free note otherwise -- `null` for a personal candidate (no note at
 * all). Never a raw collection id, never fabricated. Shared by both the
 * multi-match subtitle line and the single-match note beneath
 * `provider.accountLabel`. */
function sharedNoteKeyFor(
  candidate: ProviderCredentialCandidate,
): "provider.sharedPasskeyFolderNote" | "provider.sharedPasskeyNote" | null {
  if (candidate.isShared !== true) {
    return null;
  }
  return candidate.folderName !== undefined
    ? "provider.sharedPasskeyFolderNote"
    : "provider.sharedPasskeyNote";
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
  const orderedMatches = multiMatch ? orderCandidatesPersonalFirst(matches ?? []) : (matches ?? []);
  // E4 single-match: `matches` carries exactly the ONE candidate this
  // ceremony pre-selected (App.tsx passes the same `candidates` array
  // regardless of length -- `isMultiMatch` above is what actually gates the
  // picker list). `create` never has a `matches` array at all, so this is
  // `undefined` there (no shared note on a create ceremony -- there is no
  // existing credential to be shared).
  const singleCandidate =
    !multiMatch && matches !== undefined && matches.length === 1 ? matches[0] : undefined;
  const singleShareNoteKey = singleCandidate !== undefined ? sharedNoteKeyFor(singleCandidate) : null;

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
  const ctaDisabled = busy;

  const prfNoteKey = resolvePrfNoteKey(kind, prfRequested, prfCapable);

  function handleConfirmClick() {
    resolvedRef.current = true;
    onConfirm();
  }

  function handleRowClick(itemId: string) {
    resolvedRef.current = true;
    onConfirm(itemId);
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
        {/* E4 single-match populated/partial: the ceremony's sole candidate
            is shared -- no candidate row exists in this layout at all (see
            below), so this note alone carries the "shared" signal, in the
            SAME text-sm text-base-content/70 treatment provider.accountLabel
            already uses directly above. */}
        {singleShareNoteKey !== null && singleCandidate !== undefined ? (
          <p className="text-sm text-base-content/70" data-testid="provider-shared-passkey-note">
            {singleShareNoteKey === "provider.sharedPasskeyFolderNote"
              ? interpolate(t(locale, singleShareNoteKey), {
                  folder: singleCandidate.folderName ?? "",
                })
              : t(locale, singleShareNoteKey)}
          </p>
        ) : null}
      </div>

      {multiMatch ? (
        <div
          className="flex max-h-52 flex-col gap-2 overflow-y-auto"
          data-testid="provider-candidate-list"
        >
          {orderedMatches.map((candidate) => {
            const shareNoteKey = sharedNoteKeyFor(candidate);
            const shared = candidate.isShared === true;
            return (
              <button
                key={candidate.itemId}
                type="button"
                data-testid={`provider-credential-row-${candidate.itemId}`}
                onClick={() => handleRowClick(candidate.itemId)}
                disabled={busy}
                className={`flex h-14 w-full items-center gap-2 rounded-field px-3 text-left pv-row-hover${
                  busy ? " cursor-not-allowed opacity-50" : ""
                }`}
              >
                {shared ? (
                  <span className="relative flex h-8 w-8 shrink-0 items-center justify-center">
                    <KeyRound size={20} className="text-accent" aria-hidden="true" />
                    <SharedBadge locale={locale} />
                  </span>
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                    <KeyRound size={20} className="text-accent" aria-hidden="true" />
                  </span>
                )}
                {shared && shareNoteKey !== null ? (
                  <span className="flex min-w-0 flex-1 flex-col items-start">
                    <span className="w-full truncate text-sm">{candidate.label}</span>
                    <span
                      className="w-full truncate text-sm text-base-content/70"
                      data-testid={`provider-credential-shared-note-${candidate.itemId}`}
                    >
                      {shareNoteKey === "provider.sharedPasskeyFolderNote"
                        ? interpolate(t(locale, shareNoteKey), {
                            folder: candidate.folderName ?? "",
                          })
                        : t(locale, shareNoteKey)}
                    </span>
                  </span>
                ) : (
                  <span className="flex-1 truncate text-sm">{candidate.label}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {prfNoteKey ? <p className="text-sm text-base-content/70">{t(locale, prfNoteKey)}</p> : null}

      <div className="flex flex-col gap-2">
        {!multiMatch ? (
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
        ) : null}

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
