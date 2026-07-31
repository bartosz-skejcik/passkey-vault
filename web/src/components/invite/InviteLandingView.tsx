"use client";

// The invitee-facing `/invite/{id}#<secret>` landing view (Plan 24-06). Not
// a Next route -- `web/src/app/page.tsx` resolves this at mount from
// `location.pathname`/`location.hash` and renders this component in place
// of the entire page (24-UI-SPEC.md §0). Owns the four-state machine
// (loading/invalid/valid/joining, plus joinFailedRetryable) and both join
// branches (register-and-join, already-logged-in-join).
//
// Security-critical invariants this file must never violate (T-24-15/16/17):
//   - `inviteSecret` never crosses into localStorage/sessionStorage -- it
//     lives only in the `inviteSecret` prop / this component's own React
//     state for its mounted lifetime.
//   - The unified failure state (`viewState === "invalid"`) never renders a
//     family name, inviter, fingerprint, or any other interpolated value --
//     the whole point is that every failure cause (expired/consumed/
//     revoked/concurrent-loser/malformed/unknown) is indistinguishable.
//   - `invite.fingerprintHonesty` renders byte-for-byte from the
//     dictionary -- never paraphrased, never gates the Join button.
import { useEffect, useRef, useState } from "react";
import { Fingerprint, Loader2, Users } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { fetchInviteMetadataFlow, redeemInviteFlow } from "@/lib/invite/crypto";
import type { InvitePublicMetadata } from "@/lib/invite/api";
import { me } from "@/lib/auth/api";
import { getSessionToken, clearSessionToken, clearStoredEmail } from "@/lib/auth/session";
import { getUnlockedUserKey, lockVault, useIsUnlocked, type WasmUserKey } from "@/lib/crypto";
import RegisterForm from "@/components/auth/RegisterForm";
import LoginForm from "@/components/auth/LoginForm";
import UnlockOverlay from "@/components/auth/UnlockOverlay";

type ViewState = "loading" | "invalid" | "valid" | "joining" | "joinFailedRetryable";

/** Whether a session token resolves at mount decides which sub-branch this
 * view starts in; "resolving" additionally covers the me()-lookup window
 * (both at mount, when a token already exists, and right after an inline
 * login -- see `handleFormAuthed` below). A `me()` failure routes back to
 * "unauthenticated" (E3's "no readable account identity == no session"
 * rule) rather than ever rendering an unnamed account. */
type AccountBranch = "unauthenticated" | "resolving" | "authenticated";

/** Groups a 64-char hex digest into 4-character chunks
 * ("xxxx xxxx xxxx …", 16 groups) per 24-UI-SPEC.md §1 -- fixed-width by
 * construction, so this can never itself be an overflow source. */
function formatFingerprint(hex: string): string {
  const groups = hex.match(/.{1,4}/g);
  return groups === null ? hex : groups.join(" ");
}

const ALREADY_MEMBER_NOTICE_MS = 1200;

export default function InviteLandingView({
  inviteId,
  inviteSecret,
  onDone,
}: {
  inviteId: string;
  inviteSecret: string;
  onDone: (result: { selectCollectionId: string | null }) => void;
}) {
  const { t } = useLocale();
  const unlocked = useIsUnlocked();

  const [viewState, setViewState] = useState<ViewState>("loading");
  const [metadata, setMetadata] = useState<InvitePublicMetadata | null>(null);

  const [accountBranch, setAccountBranch] = useState<AccountBranch>(() =>
    getSessionToken() !== null ? "resolving" : "unauthenticated",
  );
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [mode, setMode] = useState<"register" | "login">("register");
  const [alreadyMemberNotice, setAlreadyMemberNotice] = useState(false);

  const alreadyMemberTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mount-time (and inviteId-change) metadata fetch. MUST go through
  // fetchInviteMetadataFlow (Amendment 2's invite_proof orchestration) --
  // never the raw fetchInvitePublicMetadata alone, which cannot derive the
  // proof this call now requires.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const result = await fetchInviteMetadataFlow(inviteId, inviteSecret);
        if (cancelled) return;
        // Data-validation-layer backstop (E1 "empty state"): a
        // technically-successful response missing either required field
        // never reaches the "valid" render -- routes to the SAME unified
        // failure state as every other cause, closing the "Join ?" /
        // bare-verb heading risk before it can ever render.
        if (result.family_name.trim() === "" || result.inviter_email.trim() === "") {
          setViewState("invalid");
          return;
        }
        setMetadata(result);
        setViewState("valid");
      } catch {
        // Self-consistency failure, network error, or a non-2xx/proof-
        // mismatch response -- all indistinguishable, per CONTEXT.md.
        if (!cancelled) setViewState("invalid");
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [inviteId, inviteSecret]);

  // Account-identity resolution -- re-entered after an inline login (see
  // handleFormAuthed) as well as at mount, so both paths share one
  // implementation rather than duplicating the me()-then-branch logic.
  useEffect(() => {
    if (accountBranch !== "resolving") return;
    let cancelled = false;
    async function run() {
      try {
        const account = await me();
        if (cancelled) return;
        setAccountEmail(account.email);
        setAccountBranch("authenticated");
      } catch {
        // E3: a session that resolves to no readable account identity is
        // treated as "no session" -- never render an unnamed account.
        if (!cancelled) {
          setAccountEmail(null);
          setAccountBranch("unauthenticated");
        }
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [accountBranch]);

  useEffect(() => {
    return () => {
      if (alreadyMemberTimer.current !== null) {
        clearTimeout(alreadyMemberTimer.current);
      }
    };
  }, []);

  async function handleAuthedThenRedeem(uk: WasmUserKey) {
    setViewState("joining");
    try {
      const result = await redeemInviteFlow(inviteId, inviteSecret, uk);
      if (result.alreadyMember) {
        setAlreadyMemberNotice(true);
        alreadyMemberTimer.current = setTimeout(() => {
          onDone({ selectCollectionId: result.collectionId });
        }, ALREADY_MEMBER_NOTICE_MS);
      } else {
        onDone({ selectCollectionId: result.collectionId });
      }
    } catch {
      // The account/session is genuinely real at this point (register/login
      // already succeeded, or the session already existed) -- this must
      // NEVER fall through to the unified "invalid" state.
      setViewState("joinFailedRetryable");
    }
  }

  // Shared onAuthed for both RegisterForm and LoginForm in the
  // "unauthenticated" branch. RegisterForm's own onAuthed fires AFTER it has
  // already called setUnlockedUserKey (RegisterForm.tsx) -- so
  // getUnlockedUserKey() is populated here for the register path, and the
  // join proceeds immediately with no second screen. LoginForm's onAuthed
  // fires with only a *pending* unlock (its own deliberate visibly-distinct
  // unlock step, LoginForm.tsx) -- getUnlockedUserKey() is still null there,
  // so this re-enters the SAME account-resolution/UnlockOverlay machinery
  // the "session already exists" branch uses, rather than a second bespoke
  // path.
  function handleFormAuthed() {
    const uk = getUnlockedUserKey();
    if (uk !== null) {
      void handleAuthedThenRedeem(uk);
    } else {
      setAccountBranch("resolving");
    }
  }

  function handleJoinClick() {
    const uk = getUnlockedUserKey();
    if (uk === null) return; // button is disabled until unlocked
    void handleAuthedThenRedeem(uk);
  }

  function handleRetryRedeem() {
    const uk = getUnlockedUserKey();
    if (uk === null) return;
    void handleAuthedThenRedeem(uk);
  }

  function handleJoinAsDifferentAccount() {
    // Verbatim three-call logout sequence (Sidebar.tsx), deliberately
    // WITHOUT window.location.reload() -- this view must stay mounted with
    // its own `inviteSecret` (React-state-only, never persisted) intact.
    clearSessionToken();
    clearStoredEmail();
    lockVault();
    setAccountEmail(null);
    setMode("register");
    setAccountBranch("unauthenticated");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-base-300 p-4">
      <div className="w-full max-w-[400px] rounded-box border border-base-300 bg-base-100 p-6">
        {viewState === "loading" ? (
          <div className="flex flex-col items-center gap-3 py-8" data-testid="invite-loading">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            <p className="text-sm text-base-content/70">{t("invite.loadingLabel")}</p>
          </div>
        ) : null}

        {viewState === "invalid" ? (
          <div className="flex flex-col gap-4" data-testid="invite-invalid">
            <h1 className="text-[20px] font-bold leading-[1.2]">{t("invite.failureMessage")}</h1>
            <p className="text-base">{t("invite.failureHint")}</p>
            <a href="/" className="btn btn-primary" data-testid="invite-failure-cta">
              {t("invite.failureCta")}
            </a>
          </div>
        ) : null}

        {metadata !== null && viewState !== "loading" && viewState !== "invalid" ? (
          <div className="flex flex-col gap-8" data-testid="invite-valid">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 shrink-0" aria-hidden="true" />
                <h1
                  className="truncate text-[20px] font-bold leading-[1.2]"
                  title={metadata.family_name}
                >
                  {interpolate(t("invite.joinHeading"), { family: metadata.family_name })}
                </h1>
              </div>
              <p
                className="truncate text-sm"
                title={metadata.inviter_email}
                data-testid="invite-invited-by"
              >
                {interpolate(t("invite.invitedBy"), { inviter: metadata.inviter_email })}
              </p>

              {metadata.inviter_fingerprint !== null ? (
                <div className="mt-2 flex flex-col gap-1">
                  <div className="flex items-center gap-1">
                    <Fingerprint className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                    <span className="truncate text-sm" title={metadata.inviter_email}>
                      {interpolate(t("invite.fingerprintLabel"), {
                        inviter: metadata.inviter_email,
                      })}
                    </span>
                  </div>
                  <p
                    className="break-all font-mono text-sm"
                    data-testid="invite-fingerprint-value"
                  >
                    {formatFingerprint(metadata.inviter_fingerprint)}
                  </p>
                  {/* Hard requirement (T-24-16): rendered byte-for-byte from
                      the dictionary -- never paraphrased, never gates Join. */}
                  <p className="text-sm text-base-content/70">
                    {interpolate(t("invite.fingerprintHonesty"), {
                      inviter: metadata.inviter_email,
                    })}
                  </p>
                </div>
              ) : (
                <p
                  className="mt-2 text-sm text-base-content/70"
                  data-testid="invite-fingerprint-unavailable"
                >
                  {interpolate(t("invite.fingerprintUnavailable"), {
                    inviter: metadata.inviter_email,
                  })}
                </p>
              )}
            </div>

            {viewState === "joinFailedRetryable" ? (
              <div className="flex flex-col gap-4" data-testid="invite-join-failed-retryable">
                <p className="text-sm text-base-content/70">{t("invite.joinFailedRetryable")}</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={handleRetryRedeem}
                  data-testid="invite-retry-cta"
                >
                  {t("invite.joinRetryCta")}
                </button>
                <button
                  type="button"
                  className="link link-secondary text-sm"
                  onClick={() => onDone({ selectCollectionId: null })}
                  data-testid="invite-continue-to-vault-cta"
                >
                  {t("invite.continueToVaultCta")}
                </button>
              </div>
            ) : alreadyMemberNotice ? (
              <div
                role="alert"
                className="alert alert-info text-sm"
                data-testid="invite-already-member-notice"
              >
                {interpolate(t("invite.alreadyMemberNotice"), { family: metadata.family_name })}
              </div>
            ) : accountBranch === "unauthenticated" ? (
              viewState === "joining" ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled
                  data-testid="invite-joining-busy"
                >
                  {t("invite.joining")}
                </button>
              ) : (
                <div className="flex flex-col gap-4">
                  {mode === "register" ? (
                    <RegisterForm
                      onToggle={() => setMode("login")}
                      onAuthed={handleFormAuthed}
                      submitLabel={t("invite.registerAndJoinCta")}
                    />
                  ) : (
                    <LoginForm onToggle={() => setMode("register")} onAuthed={handleFormAuthed} />
                  )}
                </div>
              )
            ) : accountBranch === "resolving" ? (
              <div className="flex justify-center py-4" data-testid="invite-account-resolving">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <UnlockOverlay />
                <p
                  className="truncate text-sm"
                  title={accountEmail ?? ""}
                  data-testid="invite-current-account"
                >
                  {interpolate(t("invite.currentAccountNotice"), { email: accountEmail ?? "" })}
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!unlocked || viewState === "joining"}
                  onClick={handleJoinClick}
                  data-testid="invite-join-cta"
                >
                  {viewState === "joining"
                    ? t("invite.joining")
                    : interpolate(t("invite.joinCta"), { family: metadata.family_name })}
                </button>
                {/* Plan 24-08 gap-fix (found via a real browser run, never
                    caught by any unit test -- JSDOM has no real hit-testing,
                    so a fixed-position overlay sitting on top of this button
                    never actually blocked a `fireEvent.click` there):
                    `UnlockOverlay` above renders a `fixed inset-0 z-50`
                    modal whenever the visiting session is LOCKED -- which,
                    with no z-index of its own, this escape button sat
                    directly UNDERNEATH, completely unclickable. That
                    defeated the entire point of this button: a visitor who
                    wants to "join as a different account" precisely because
                    the CURRENT (wrong) account is signed in should never be
                    forced to unlock that wrong account's vault first just to
                    reach the escape hatch. `relative z-[60]` keeps this ONE
                    button paintable (and clickable) above UnlockOverlay's
                    z-50, with zero effect on any other UnlockOverlay call
                    site in the app (no other one has an escape affordance
                    rendered alongside it). */}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm relative z-[60]"
                  disabled={viewState === "joining"}
                  onClick={handleJoinAsDifferentAccount}
                  data-testid="invite-join-as-different-account"
                >
                  {t("invite.joinAsDifferentAccount")}
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
