"use client";

// Delete-account confirmation (FAM-10, Plan 25-09, E6). Same 400px modal
// shell, two-step, forward-only pattern as `RemoveMemberDialog.tsx`/
// `PasskeyDeleteConfirmDialog.tsx` — never a silent close on failure.
//
// Resolves the caller's own role (owner/plain member/no family) client-side
// on mount, purely to pick the right step-1 copy — the server independently
// re-derives the real branch via `membership::resolve_family_role` (Plan
// 25-06), so a client-side misclassification here can only change which
// COPY is shown, never which server-side branch actually executes (T-25-23).
//
// The owner branch's honesty warning (`account.deleteOwnerWarning`) is the
// phase's other hard, non-negotiable copy requirement (alongside Plan
// 25-08's `member.removeHonestyWarning`): it must name the real family and
// the real other-member count, and must never render for a non-owner.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { me } from "@/lib/auth/api";
import {
  deleteAccount,
  getFamily,
  getFamilyMembers,
  type CollectionRekeyBatch,
} from "@/lib/families/api";
import { buildMemberRemovalBatch } from "@/lib/families/rekey";
import { clearSessionToken, clearStoredEmail } from "@/lib/auth/session";
import { getUnlockedUserKey, lockVault } from "@/lib/crypto";

type Branch = "no-family" | "member" | "owner";
type DialogState = "loading" | Branch | "step2" | "deleting" | "error";

/**
 * Renders `account.deleteOwnerWarning` with the family name wrapped in its
 * own `truncate`+`title` span (25-UI-SPEC.md's E6 overflow/long-text
 * backstop, matching the `invite.joinHeading` precedent) — the whole
 * sentence must NOT be truncated (it carries the phase's other hard honesty
 * requirement), only the variable-length family-name substring. Falls back
 * to appending the family-name span at the end when the template contains
 * no `{family}` token at all (e.g. this codebase's identity-mocked `t()` in
 * component tests), mirroring `interpolate()`'s own append-fallback
 * philosophy rather than silently dropping the family name.
 */
function renderOwnerWarning(template: string, familyName: string, count: number): ReactNode {
  const familySpan = (
    <span className="truncate" title={familyName} data-testid="account-delete-owner-family-name">
      {familyName}
    </span>
  );

  if (!template.includes("{family}") && !template.includes("{count}")) {
    // Identity-mocked `t()` (component tests) has no tokens to replace at
    // all -- mirror `interpolate()`'s own append-fallback so both the real
    // family name AND the real count stay visible (never silently dropped),
    // not just the family name.
    return (
      <>
        {template} {familySpan} {count}
      </>
    );
  }

  const withCount = template.split("{count}").join(String(count));
  const [before, after] = withCount.includes("{family}")
    ? withCount.split("{family}")
    : [withCount, ""];
  return (
    <>
      {before}
      {familySpan}
      {after}
    </>
  );
}

export default function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const { t } = useLocale();
  const [state, setState] = useState<DialogState>("loading");
  const [branch, setBranch] = useState<Branch | null>(null);
  const [selfUserId, setSelfUserId] = useState<string | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [otherMemberCount, setOtherMemberCount] = useState(0);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  async function resolveBranch() {
    setState("loading");
    try {
      const [members, account] = await Promise.all([getFamilyMembers(), me()]);
      if (!mountedRef.current) return;
      setSelfUserId(account.user_id);

      if (members === null) {
        setBranch("no-family");
        setState("no-family");
        return;
      }

      // Mirrors `FamilyTab.tsx`'s own `resolveOwnership` pattern exactly —
      // the same client-side ownership check this codebase already
      // established, not a new one.
      const isOwner = members.some(
        (m) => m.user_id === account.user_id && m.role === "owner",
      );
      if (!isOwner) {
        setBranch("member");
        setState("member");
        return;
      }

      const family = await getFamily();
      if (!mountedRef.current) return;
      setFamilyName(family.name);
      setOtherMemberCount(Math.max(0, members.length - 1));
      setBranch("owner");
      setState("owner");
    } catch {
      if (mountedRef.current) setState("error");
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    void resolveBranch();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFinalConfirm() {
    setState("deleting");
    setDeleteError(null);

    // WR-12 (code review, Phase 25): this `try` used to also wrap
    // `clearSessionToken`/`clearStoredEmail`/`lockVault`. If any of those
    // threw, the catch rendered `account.deleteFailed` ("Couldn't delete the
    // account. Try again.") even though the account was ALREADY permanently
    // gone server-side — inviting a retry that can only 401. The `try` now
    // covers exactly the operations that can still leave the account intact:
    // batch construction and the network call itself.
    try {
      const uk = getUnlockedUserKey();
      if (uk === null) {
        throw new Error("cannot delete account while the vault is locked");
      }
      // Only the plain-member branch re-keys owned collections before
      // deletion — the owner/no-family branches submit an empty batch, which
      // the server ignores for those two cases (Plan 25-06's
      // `DeleteAccountRequest`).
      //
      // `isSelf = true`: the bug fixed live in `1117919` (found during
      // 30-17-PLAN.md's own Task 2 case 1) -- this call targets the
      // CALLER's own id, so it must not route through `getMemberAccess`
      // (owner-only, would always 403 here). See
      // `rekey.ts::resolveTargetCollectionIds`'s own doc comment.
      let batch: CollectionRekeyBatch[] = [];
      if (branch === "member" && selfUserId !== null) {
        batch = await buildMemberRemovalBatch(selfUserId, uk, true);
      }
      await deleteAccount(batch);
    } catch {
      // Non-silent failure (matches `PasskeyDeleteConfirmDialog`'s
      // precedent): the dialog stays open at step 2, `account.deleteFailed`
      // renders inline. Reaching here PROVES the account still exists, so
      // "Try again" is honest advice.
      if (mountedRef.current) {
        setDeleteError(t("account.deleteFailed"));
        setState("step2");
      }
      return;
    }

    // Past this point the account is gone. Nothing below may resurrect the
    // failure surface — a local-cleanup throw must not be reported as
    // "couldn't delete the account".
    //
    // Same sign-out sequence `Sidebar.tsx`'s `handleLogout` uses after its
    // own clears — never a bespoke second logout path. `logout()` itself is
    // NOT called here: the account (and its session) no longer exists
    // server-side by the time this runs.
    try {
      clearSessionToken();
      clearStoredEmail();
      lockVault();
    } catch {
      // Best-effort local cleanup. The reload below returns the app to the
      // unauthenticated shell regardless.
    }
    try {
      window.location.reload();
    } catch {
      // jsdom (unit tests) doesn't implement real navigation.
    }
  }

  const isStep1 = state === "no-family" || state === "member" || state === "owner";
  const isStep2 = state === "step2" || state === "deleting";
  const deleting = state === "deleting";

  return (
    <div
      data-testid="delete-account-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
      onClick={deleting ? undefined : onClose}
    >
      <div
        className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {state === "loading" ? (
          <div
            className="flex flex-col items-center justify-center gap-3 py-8"
            data-testid="delete-account-loading"
          >
            <span className="loading loading-spinner loading-lg" aria-hidden="true" />
          </div>
        ) : null}

        {state === "error" ? (
          <>
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
              <h2 className="text-[20px] font-bold leading-[1.2]">
                {t("account.deleteStep1Title")}
              </h2>
            </div>
            {/* No dedicated dictionary key exists for this initial-role-fetch
                failure (25-UI-SPEC.md's E6 coverage table only names the
                deletion-submit error) — reusing `family.membersLoadFailed`,
                the closest existing key semantically (both describe a failed
                fetch of the caller's own family/membership data), rather
                than inventing a new one not present in the Copywriting
                Contract. Fail-closed, matching `RemoveMemberDialog`'s
                `blocked` precedent: never guesses which branch's copy to
                show when the underlying data couldn't be fetched. */}
            <p
              role="alert"
              data-testid="delete-account-blocked-error"
              className="text-sm text-error"
            >
              {t("family.membersLoadFailed")}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="delete-account-blocked-cancel"
                className="btn btn-ghost"
                onClick={onClose}
              >
                {t("delete.cancel")}
              </button>
              <button
                type="button"
                data-testid="delete-account-blocked-retry"
                className="btn btn-primary"
                onClick={() => void resolveBranch()}
              >
                {t("family.loadRetryCta")}
              </button>
            </div>
          </>
        ) : null}

        {isStep1 ? (
          <>
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
              <h2 className="text-[20px] font-bold leading-[1.2]">
                {t("account.deleteStep1Title")}
              </h2>
            </div>
            <p className="text-base" data-testid="account-delete-step1-body">
              {t("account.deleteStep1Body")}
            </p>
            {state === "owner" ? (
              <p className="text-base" data-testid="account-delete-owner-warning">
                {renderOwnerWarning(t("account.deleteOwnerWarning"), familyName, otherMemberCount)}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="account-delete-step1-cancel"
                className="btn btn-ghost"
                onClick={onClose}
              >
                {t("delete.cancel")}
              </button>
              {/* Step 1's own "continue" affordance deliberately reuses
                  `member.removeStep1Continue` ("Dalej"/"Continue") — the
                  already-established sibling key `RemoveMemberDialog.tsx`
                  pairs with `delete.cancel` for the identical step1->step2
                  shape, never a new key not present in the Copywriting
                  Contract (25-UI-SPEC.md's own instruction for this exact
                  button). `account.deleteConfirm` is reserved for step 2's
                  FINAL confirm only. */}
              <button
                type="button"
                data-testid="account-delete-step1-continue"
                className="btn btn-primary"
                onClick={() => setState("step2")}
              >
                {t("member.removeStep1Continue")}
              </button>
            </div>
          </>
        ) : null}

        {isStep2 ? (
          <>
            <div className="flex items-center gap-3">
              <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
              <h2 className="text-[20px] font-bold leading-[1.2]">
                {t("account.deleteStep2Title")}
              </h2>
            </div>
            <p className="text-base">{t("account.deleteStep2Body")}</p>
            {deleteError !== null ? (
              <p role="alert" data-testid="account-delete-error" className="text-sm text-error">
                {deleteError}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-testid="account-delete-step2-cancel"
                className="btn btn-ghost"
                disabled={deleting}
                onClick={() => {
                  if (branch !== null) setState(branch);
                }}
              >
                {t("delete.cancel")}
              </button>
              <button
                type="button"
                data-testid="account-delete-step2-confirm"
                className="btn btn-error"
                disabled={deleting}
                onClick={() => void handleFinalConfirm()}
              >
                {deleting ? (
                  <span className="loading loading-spinner loading-sm" aria-hidden="true" />
                ) : null}
                {deleting ? t("account.deleting") : t("account.deleteConfirm")}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
