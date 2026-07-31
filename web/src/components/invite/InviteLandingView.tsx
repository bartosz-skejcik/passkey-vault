"use client";

// The invitee-facing `/invite/{id}#<secret>` landing view (Plan 24-06). Not
// a Next route -- `web/src/app/page.tsx` resolves this at mount from
// `location.pathname`/`location.hash` and renders this component in place
// of the entire page (24-UI-SPEC.md §0). Task 1 scope: the loading/invalid/
// valid states and the persistent context header. Task 2 fills in the
// join-branch content below the header (currently a placeholder).
//
// Security-critical invariants this file must never violate (T-24-15/16):
//   - `inviteSecret` never crosses into localStorage/sessionStorage -- it
//     lives only in the `inviteSecret` prop / this component's own React
//     state for its mounted lifetime.
//   - The unified failure state (`viewState === "invalid"`) never renders a
//     family name, inviter, fingerprint, or any other interpolated value --
//     the whole point is that every failure cause (expired/consumed/
//     revoked/concurrent-loser/malformed/unknown) is indistinguishable.
//   - `invite.fingerprintHonesty` renders byte-for-byte from the
//     dictionary -- never paraphrased, never gates the Join button.
import { useEffect, useState } from "react";
import { Fingerprint, Loader2, Users } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { fetchInviteMetadataFlow } from "@/lib/invite/crypto";
import type { InvitePublicMetadata } from "@/lib/invite/api";

type ViewState = "loading" | "invalid" | "valid" | "joining" | "joinFailedRetryable";

/** Groups a 64-char hex digest into 4-character chunks
 * ("xxxx xxxx xxxx …", 16 groups) per 24-UI-SPEC.md §1 -- fixed-width by
 * construction, so this can never itself be an overflow source. */
function formatFingerprint(hex: string): string {
  const groups = hex.match(/.{1,4}/g);
  return groups === null ? hex : groups.join(" ");
}

export default function InviteLandingView({
  inviteId,
  inviteSecret,
  onDone: _onDone,
}: {
  inviteId: string;
  inviteSecret: string;
  onDone: (result: { selectCollectionId: string | null }) => void;
}) {
  const { t } = useLocale();

  const [viewState, setViewState] = useState<ViewState>("loading");
  const [metadata, setMetadata] = useState<InvitePublicMetadata | null>(null);

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
                <p className="mt-2 text-sm text-base-content/70" data-testid="invite-fingerprint-unavailable">
                  {interpolate(t("invite.fingerprintUnavailable"), {
                    inviter: metadata.inviter_email,
                  })}
                </p>
              )}
            </div>

            {/* Task 2 fills this mount point in with the register/login and
                already-logged-in join branches. */}
            <div data-testid="invite-branch-placeholder" />
          </div>
        ) : null}
      </div>
    </div>
  );
}
