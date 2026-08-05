"use client";

// Family tab (FAM-04, 24-UI-SPEC.md's Surface 4/E5/E6/E7) — the owner-side
// "Invite someone" affordance. Deliberately minimal per 24-CONTEXT.md's
// locked scope boundary: exactly one invite shown at a time (the one just
// created), no pending-invite list/history/audit view — Phase 26 owns the
// richer management view at full visual quality. Family bootstrap (no
// family yet) is detected from GET /api/families/members returning 404 —
// this component IS the empty state for that case (E7), not a separate
// loading screen ahead of it.
import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, Copy, PauseCircle, PlayCircle, UserMinus, UserPlus, Users } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { ApiClientError, me } from "@/lib/auth/api";
import { getUnlockedUserKey } from "@/lib/crypto";
import { copyWithAutoClear, readClipboardSeconds } from "@/lib/clipboard";
import { showCopyToast } from "@/lib/vault/copyToast";
import {
  createFamily,
  getFamilyMembers,
  reinstateMember,
  suspendMember,
  type FamilyMemberRecord,
} from "@/lib/families/api";
import { generateInviteLink, type InviteExpiry, type InviteScope } from "@/lib/invite/crypto";
import { revokeInvite } from "@/lib/invite/api";
import { toIsoUtc } from "@/lib/format/relativeTime";
import ConfirmDialog from "./ConfirmDialog";
import RemoveMemberDialog from "./RemoveMemberDialog";

type Mode = "checking" | "bootstrap" | "normal" | "error";
// CR-02 (24-REVIEW.md): "folder" is intentionally unreachable from the UI --
// personal folders (`vault_items.folder_id`) have no id overlap with the
// server's `collections` table, so a folder-scoped invite would 100%-fail
// `getCollection()` for every user, every time. The type stays a union (not
// narrowed to a literal `"family"`) only so Phase 26 can re-wire a real
// collections picker into the same `InviteScope` shape later.
type ScopeChoice = "family" | "folder";

const DEFAULT_EXPIRY: InviteExpiry = "7d";

/**
 * `generateInviteLink` deliberately returns only `{ url, expiresAt }` (see
 * lib/invite/crypto.ts) — the invite id is recoverable only by parsing it
 * back out of the URL's own path segment, which is what `revokeInvite(id)`
 * needs.
 */
function extractInviteId(url: string): string {
  const match = url.match(/\/invite\/([^/#]+)/);
  return match ? match[1] : "";
}

/** Browser-native formatting only (Intl via toLocaleString) — no new date
 * library, per 24-UI-SPEC.md's Phase-Specific Notes §2. WR-01 (24-REVIEW.md):
 * `expires_at` comes back from SQLite's `datetime('now', ?)` as a
 * space-separated "YYYY-MM-DD HH:MM:SS" string with NO timezone designator
 * (always UTC) — `new Date(...)` on that raw shape is parsed as LOCAL time
 * by some engines (or rejected outright by others), silently showing an
 * expiry time hours off from reality. `toIsoUtc` (the same normalization
 * `relativeTime.ts` already carries for the identical hazard) must run
 * first. Renamed the parameter from `iso` (IN-02) -- it never received
 * actual ISO-8601 input, which is what made this easy to miss on review. */
export function formatExpiryDate(serverTimestamp: string, locale: "pl" | "en"): string {
  const parsed = new Date(toIsoUtc(serverTimestamp));
  if (Number.isNaN(parsed.getTime())) {
    return serverTimestamp;
  }
  return parsed.toLocaleString(locale === "pl" ? "pl-PL" : "en-US");
}

export default function FamilyTab() {
  const { t, locale } = useLocale();

  const [mode, setMode] = useState<Mode>("checking");
  // WR-02 (24-REVIEW.md): GET /api/families/members is RequireRead, so every
  // family member -- owner or not -- reaches "normal" mode. Only the owner
  // can actually create an invite (POST /api/invitations is RequireEdit),
  // so a plain member must never see the form that always 404s for them.
  const [isOwner, setIsOwner] = useState(false);

  // Plan 25-08 (E1/E5): `resolveOwnership` already fetches BOTH `members`
  // and the caller's own `account` -- previously both were discarded after
  // deriving `isOwner`. Retained here so the Members section (E1) and the
  // suspended-member banner (E5) can render from the SAME fetch
  // `loadFamilyState` already performs, no new network call.
  const [members, setMembers] = useState<FamilyMemberRecord[] | null>(null);
  const [selfUserId, setSelfUserId] = useState<string | null>(null);

  // Suspend (E2) dialog state.
  const [suspendTarget, setSuspendTarget] = useState<FamilyMemberRecord | null>(null);
  const [suspendError, setSuspendError] = useState<string | null>(null);

  // Reinstate (E3) per-row state -- no confirmation dialog, per 25-CONTEXT.md.
  const [reinstatingUserId, setReinstatingUserId] = useState<string | null>(null);
  const [reinstateErrorUserId, setReinstateErrorUserId] = useState<string | null>(null);

  // Remove (E4) two-step dialog state -- RemoveMemberDialog owns its own
  // internal state machine; FamilyTab only tracks WHICH member is targeted.
  const [removeTarget, setRemoveTarget] = useState<FamilyMemberRecord | null>(null);

  // Bootstrap (E7) state.
  const [familyName, setFamilyName] = useState("");
  const [creatingFamily, setCreatingFamily] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  // Invite-creation (E5) state. `scopeChoice` can never leave "family" today
  // -- the "folder" `<option>` is unconditionally `disabled` (CR-02) -- so
  // there is deliberately no `selectedFolderId` state; re-adding one without
  // also building a real collections picker would silently resurrect the
  // 100%-failure path this fix closes.
  const [scopeChoice] = useState<ScopeChoice>("family");
  const [expiry, setExpiry] = useState<InviteExpiry>(DEFAULT_EXPIRY);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Generated-invite display (E6) state.
  const [invite, setInvite] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [revoking, setRevoking] = useState(false);

  // WR-02: resolves membership AND the caller's own identity together, so
  // "normal" mode never renders before we know whether this member is the
  // owner. `me()` failing independently of `getFamilyMembers()` must not
  // block the mode transition -- it just leaves `isOwner` at its safe
  // default (false), which shows the read-only member view rather than a
  // form that might 404. Shared by mount AND the 409-recovery path below --
  // a re-fetch after "family already exists" needs the SAME ownership
  // check, since the winning creator of the race is not necessarily this
  // caller.
  async function resolveOwnership(members: Awaited<ReturnType<typeof getFamilyMembers>>) {
    const account = await me().catch(() => null);
    setMembers(members);
    setSelfUserId(account?.user_id ?? null);
    setIsOwner(
      members !== null &&
        account !== null &&
        members.some((m) => m.user_id === account.user_id && m.role === "owner"),
    );
  }

  // WR-11 (24-REVIEW.md): shared by mount AND the manual retry button below.
  // `getFamilyMembers()` ALREADY converts a genuine 404 ("no family yet")
  // into a resolved `null` (see families/api.ts) -- so reaching THIS
  // function's `catch` means something else entirely: a transient 500, a
  // network drop, or an expired session. Collapsing that into "bootstrap"
  // told a real, existing family's member "Set up your family" -- a heading
  // asserting a state that is false -- and their eventual submit then 409'd
  // into a recovery branch that only rescues them if the SECOND
  // getFamilyMembers() call happens to succeed. `error` mode renders a
  // truthful, recoverable retry affordance instead.
  async function loadFamilyState(isCancelled: () => boolean) {
    try {
      const members = await getFamilyMembers();
      if (isCancelled()) return;
      await resolveOwnership(members);
      if (isCancelled()) return;
      setMode(members === null ? "bootstrap" : "normal");
    } catch {
      if (isCancelled()) return;
      setMode("error");
    }
  }

  useEffect(() => {
    let cancelled = false;
    void loadFamilyState(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleRetryLoad() {
    setMode("checking");
    void loadFamilyState(() => false);
  }

  // Plan 25-08 (E2): opens the warning-severity ConfirmDialog for the given
  // row -- the confirm/failure handling itself lives in
  // `handleSuspendConfirm` below, called as ConfirmDialog's `onConfirm`.
  async function handleSuspendConfirm() {
    if (suspendTarget === null) return;
    const targetUserId = suspendTarget.user_id;
    try {
      await suspendMember(targetUserId);
      setMembers((prev) =>
        prev?.map((m) => (m.user_id === targetUserId ? { ...m, status: "suspended" } : m)) ?? prev,
      );
      setSuspendError(null);
      setSuspendTarget(null);
    } catch {
      // Non-silent failure (E2 error, mirrors PasskeyDeleteConfirmDialog's
      // precedent): `suspendTarget` stays non-null, so the dialog stays
      // mounted -- `suspendError` renders inline via ConfirmDialog's `error`
      // prop instead of unmounting.
      setSuspendError(t("member.suspendFailed"));
    }
  }

  function closeSuspendDialog() {
    setSuspendTarget(null);
    setSuspendError(null);
  }

  // Plan 25-08 (E3): no confirmation dialog, per 25-CONTEXT.md's
  // "reversible, low-friction" framing for this specific action.
  async function handleReinstate(member: FamilyMemberRecord) {
    setReinstatingUserId(member.user_id);
    setReinstateErrorUserId(null);
    try {
      await reinstateMember(member.user_id);
      setMembers((prev) =>
        prev?.map((m) => (m.user_id === member.user_id ? { ...m, status: "active" } : m)) ?? prev,
      );
    } catch {
      setReinstateErrorUserId(member.user_id);
    } finally {
      setReinstatingUserId(null);
    }
  }

  async function handleCreateFamily(e: FormEvent) {
    e.preventDefault();
    setCreatingFamily(true);
    setBootstrapError(null);
    try {
      await createFamily(familyName.trim());
      // The caller just created the (singleton) family, so `createFamily`
      // itself is proof of ownership (families.rs makes the creator the
      // owner) -- no need to round-trip through getFamilyMembers()/me().
      setIsOwner(true);
      setMode("normal");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        // Another tab already created the singleton family — recover by
        // re-fetching membership and advancing straight to the invite form,
        // never a dead end requiring a page reload (E7 backstop). The
        // WINNER of that race is not necessarily this caller, so ownership
        // must be re-resolved here too (WR-02), not assumed true.
        const members = await getFamilyMembers().catch(() => null);
        if (members !== null) {
          await resolveOwnership(members);
          setMode("normal");
          return;
        }
      }
      setBootstrapError(t("family.createFailed"));
    } finally {
      setCreatingFamily(false);
    }
  }

  async function handleGenerate(e: FormEvent) {
    e.preventDefault();
    setGenerateError(null);
    const uk = getUnlockedUserKey();
    if (uk === null) {
      setGenerateError(t("invite.generateFailed"));
      return;
    }
    setGenerating(true);
    try {
      // CR-02: the only reachable scope is "family" today -- the
      // collection-scoped branch is disabled at the UI layer (the "folder"
      // `<option>` is unconditionally `disabled`), so there is nothing left
      // here to branch on. Reintroducing a `scope.kind === "collection"` path
      // requires a real client-side collections-authoring surface (Phase 26),
      // not just re-wiring `selectedFolderId` back in.
      const scope: InviteScope = { kind: "family" };
      const result = await generateInviteLink(scope, expiry, uk);
      setInvite({ id: extractInviteId(result.url), url: result.url, expiresAt: result.expiresAt });
    } catch (err) {
      // WR-09 (24-REVIEW.md): a bare `catch {}` here previously destroyed
      // every diagnostic -- a 404 from a since-revoked owner, a WASM init
      // failure, and a network drop were all indistinguishable to the user
      // AND to anyone triaging a bug report. Log for triage (dev-only, never
      // production console noise), and distinguish the one case with a
      // truthful, actionable message: POST /api/invitations is owner-only
      // (WR-02), so a 404 here means the caller's ownership changed between
      // mount and submit (WR-02 already hides this form from non-owners on
      // mount, so this is a defensive backstop, not the common case).
      if (process.env.NODE_ENV !== "production") {
        console.error("invite generation failed", err);
      }
      if (err instanceof ApiClientError && err.status === 404) {
        setGenerateError(t("invite.generateNotOwner"));
      } else {
        // Never resets scope/expiry — the user's already-entered selections
        // stay exactly as they left them (E5 backstop).
        setGenerateError(t("invite.generateFailed"));
      }
    } finally {
      setGenerating(false);
    }
  }

  function handleCopy() {
    if (invite === null) return;
    const seconds = readClipboardSeconds();
    // The invite link's fragment is a decryption-capable secret — same
    // clipboard-clear discipline as every other copyable secret in this app
    // (T-24-18), never a plain non-clearing copy. Field label is a plain
    // string literal at the call site, matching GeneratorDialog.tsx's exact
    // pairing — there is deliberately no toast.copied.field.invite key.
    copyWithAutoClear(invite.url, seconds * 1000);
    showCopyToast(locale === "pl" ? "Link zaproszenia" : "Invite link", seconds * 1000);
  }

  function resetInviteForm() {
    // scopeChoice has no setter (CR-02: always "family") -- nothing to reset.
    setExpiry(DEFAULT_EXPIRY);
    setGenerateError(null);
  }

  async function handleRevokeConfirm() {
    if (invite === null) return;
    setRevoking(true);
    try {
      await revokeInvite(invite.id);
      setInvite(null);
      setShowRevokeConfirm(false);
      resetInviteForm();
    } catch (err) {
      // Plan 24-08 gap-fix: `invitations.rs::revoke` only affects a row that
      // is STILL `status='pending'` (`WHERE ... AND status = 'pending'`), so
      // it 404s once the invite has already been accepted or has expired.
      // Before this fix, that 404 fell into the generic failure branch below
      // and left `invite` non-null — since Revoke was the ONLY way back to
      // the create form, an owner who successfully invited someone had no
      // way to ever invite a SECOND person: every subsequent revoke attempt
      // on the (now non-pending) link 404'd forever. A 404 here means the
      // owner's actual goal ("this link should stop working") is already
      // true, so it is treated as success, not failure.
      if (err instanceof ApiClientError && err.status === 404) {
        setInvite(null);
        setShowRevokeConfirm(false);
        resetInviteForm();
        return;
      }
      setShowRevokeConfirm(false);
      setGenerateError(t("invite.revokeFailed"));
    } finally {
      setRevoking(false);
    }
  }

  if (mode === "checking") {
    return null;
  }

  if (mode === "error") {
    // WR-11 (24-REVIEW.md): a truthful, recoverable state -- never the false
    // "Set up your family" claim a transient failure previously collapsed
    // into.
    return (
      <div className="flex flex-col gap-3 py-4" data-testid="family-load-error">
        <p role="alert" className="text-sm text-error">
          {t("family.loadError")}
        </p>
        <button
          type="button"
          data-testid="family-load-retry-cta"
          className="btn btn-ghost self-start"
          onClick={handleRetryLoad}
        >
          {t("family.loadRetryCta")}
        </button>
      </div>
    );
  }

  if (mode === "bootstrap") {
    return (
      <div className="flex flex-col gap-4 py-4" data-testid="family-bootstrap">
        <div className="flex flex-col gap-1">
          <h3 className="text-[20px] font-bold leading-[1.2]">{t("family.bootstrapHeading")}</h3>
          <p className="text-base text-base-content/70">{t("family.bootstrapBody")}</p>
        </div>
        <form className="flex flex-col gap-3" onSubmit={(e) => void handleCreateFamily(e)}>
          <div className="flex flex-col gap-1">
            <label htmlFor="family-name-input" className="text-sm">
              {t("family.nameLabel")}
            </label>
            <input
              id="family-name-input"
              data-testid="family-name-input"
              type="text"
              required
              className="input input-bordered w-full"
              value={familyName}
              onChange={(e) => setFamilyName(e.target.value)}
            />
          </div>
          {bootstrapError !== null ? (
            <p role="alert" data-testid="family-create-error" className="text-sm text-error">
              {bootstrapError}
            </p>
          ) : null}
          <button
            type="submit"
            data-testid="family-create-cta"
            className="btn btn-primary self-start"
            disabled={creatingFamily}
          >
            {creatingFamily ? (
              <span className="loading loading-spinner loading-sm" aria-hidden="true" />
            ) : null}
            {t("family.createCta")}
          </button>
        </form>
      </div>
    );
  }

  // mode === "normal"

  // Plan 25-08: the pre-existing three-way branch below (generated-invite
  // display / non-owner read-only notice / owner's invite form) is now
  // wrapped as an IIFE rather than three top-level early returns, so the
  // suspended-member banner (E5) and Members section (E1) below can render
  // ABOVE it in every one of the three sub-states, per 25-UI-SPEC.md's
  // Phase-Specific Notes -- each sub-case's own JSX is otherwise byte-
  // identical to before this plan.
  const invitePanel = (() => {
  if (invite !== null) {
    return (
      <div className="flex flex-col gap-4 py-4" data-testid="invite-generated-display">
        <h3 className="flex items-center gap-2 text-[20px] font-bold leading-[1.2]">
          <UserPlus size={20} aria-hidden="true" />
          {t("invite.sectionHeading")}
        </h3>
        <input
          data-testid="invite-link-display"
          readOnly
          className="input input-bordered w-full font-mono"
          value={invite.url}
        />
        <p className="text-sm">
          {interpolate(t("invite.expiresAt"), { date: formatExpiryDate(invite.expiresAt, locale) })}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="invite-copy-cta"
            aria-label={t("invite.copyLinkAria")}
            className="btn btn-ghost btn-square"
            onClick={handleCopy}
          >
            <Copy size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="invite-revoke-cta"
            className="btn btn-ghost btn-error"
            onClick={() => setShowRevokeConfirm(true)}
          >
            {t("invite.revokeConfirmConfirm")}
          </button>
        </div>
        {generateError !== null ? (
          <p role="alert" data-testid="invite-revoke-error" className="text-sm text-error">
            {generateError}
          </p>
        ) : null}

        {showRevokeConfirm ? (
          <div
            data-testid="invite-revoke-confirm-dialog"
            className="fixed inset-0 z-50 flex items-center justify-center bg-base-300/70 p-4"
            onClick={() => setShowRevokeConfirm(false)}
          >
            <div
              className="flex w-full max-w-[400px] flex-col gap-4 rounded-box border border-base-300 bg-base-100 p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3">
                <AlertTriangle size={20} className="shrink-0 text-error" aria-hidden="true" />
                <h2 className="text-[20px] font-bold leading-[1.2]">
                  {t("invite.revokeConfirmTitle")}
                </h2>
              </div>
              <p className="text-base">{t("invite.revokeConfirmBody")}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  data-testid="invite-revoke-confirm-cancel"
                  className="btn btn-ghost"
                  onClick={() => setShowRevokeConfirm(false)}
                >
                  {t("delete.cancel")}
                </button>
                <button
                  type="button"
                  data-testid="invite-revoke-confirm-confirm"
                  className="btn btn-error"
                  disabled={revoking}
                  onClick={() => void handleRevokeConfirm()}
                >
                  {t("invite.revokeConfirmConfirm")}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  if (!isOwner) {
    // WR-02 (24-REVIEW.md): GET /api/families/members is readable by every
    // member, but POST /api/invitations is owner-only (RequireEdit) -- a
    // non-owner who reached this "normal" mode must see a truthful
    // read-only notice, never the invite form that would always 404 for
    // them on submit.
    return (
      <div className="flex flex-col gap-2 py-4" data-testid="family-member-view">
        <h3 className="flex items-center gap-2 text-[20px] font-bold leading-[1.2]">
          <UserPlus size={20} aria-hidden="true" />
          {t("invite.sectionHeading")}
        </h3>
        <p className="text-sm text-base-content/70" data-testid="family-member-view-notice">
          {t("family.memberViewNotice")}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-4">
      <h3 className="flex items-center gap-2 text-[20px] font-bold leading-[1.2]">
        <UserPlus size={20} aria-hidden="true" />
        {t("invite.sectionHeading")}
      </h3>
      <form className="flex flex-col gap-4" onSubmit={(e) => void handleGenerate(e)}>
        <div className="flex flex-col gap-1">
          <label htmlFor="invite-scope-select" className="text-sm">
            {t("invite.scopeLabel")}
          </label>
          {/* CR-02 (24-REVIEW.md): unconditionally disabled -- not gated on
              `foldersEmpty`. The folder picker sourced from `useFolders()`
              (personal folders) has no id overlap with the server's
              `collections` table, so this option 100%-fails for EVERY user,
              not just one with zero folders. Framed as "coming soon"
              (Phase 26 ships the real collections-authoring surface), never
              silently re-enabled by populating folders. */}
          <select
            id="invite-scope-select"
            data-testid="invite-scope-select"
            className="select select-bordered w-full"
            defaultValue={scopeChoice}
          >
            <option value="family">{t("invite.scopeWholeFamily")}</option>
            <option value="folder" disabled>
              {t("invite.scopeFolderComingSoon")}
            </option>
          </select>
          <p data-testid="invite-scope-folder-unavailable-note" className="text-sm text-base-content/70">
            {t("invite.scopeFolderUnavailableNote")}
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="invite-expiry-select" className="text-sm">
            {t("invite.expiryLabel")}
          </label>
          <select
            id="invite-expiry-select"
            data-testid="invite-expiry-select"
            className="select select-bordered w-full"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value as InviteExpiry)}
          >
            <option value="1h">{t("invite.expiry1h")}</option>
            <option value="24h">{t("invite.expiry24h")}</option>
            <option value="7d">{t("invite.expiry7d")}</option>
          </select>
        </div>

        {generateError !== null ? (
          <p role="alert" data-testid="invite-generate-error" className="text-sm text-error">
            {generateError}
          </p>
        ) : null}

        <button
          type="submit"
          data-testid="invite-generate-cta"
          className="btn btn-primary self-start"
          disabled={generating}
        >
          {generating ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : null}
          {t("invite.generateCta")}
        </button>
      </form>
    </div>
  );
  })();

  // Plan 25-08 (E5): the caller's own row, re-derived from the SAME
  // `members` fetch every render -- so a page reload re-evaluates it fresh,
  // and it disappears on the very next fetch after reinstatement (no
  // one-time toast, no client-side timer).
  const selfRow = members?.find((m) => m.user_id === selfUserId) ?? null;
  const isSelfSuspended = selfRow?.status === "suspended";

  return (
    <div className="flex flex-col gap-8 py-4">
      {isSelfSuspended ? (
        <div
          role="alert"
          data-testid="family-suspended-banner"
          className="alert alert-warning alert-soft flex-col items-start gap-1 text-sm"
        >
          <span className="font-bold">{t("family.suspendedBannerTitle")}</span>
          <span>{t("family.suspendedBannerBody")}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-3" data-testid="family-members-section">
        <h3 className="flex items-center gap-2 text-[20px] font-bold leading-[1.2]">
          <Users size={20} aria-hidden="true" />
          {t("family.membersHeading")}
        </h3>
        {members === null ? (
          // Defensive-only branch (E1 error backstop): under the current
          // wiring `members` is always populated by the time `mode ===
          // "normal"` is reached (it comes from the SAME successful fetch
          // that transitioned mode here) -- this guards against a future
          // refactor decoupling the two, rather than a state this UI can
          // currently reach in practice.
          <div className="flex flex-col gap-3" data-testid="family-members-load-error">
            <p role="alert" className="text-sm text-error">
              {t("family.membersLoadFailed")}
            </p>
            <button
              type="button"
              data-testid="family-members-load-retry-cta"
              className="btn btn-ghost self-start"
              onClick={handleRetryLoad}
            >
              {t("family.loadRetryCta")}
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((m) => {
              const isSuspended = m.status === "suspended";
              const isSelf = m.user_id === selfUserId;
              // E1 action-visibility: a plain member sees a read-only
              // roster with no action icons on any row, including their
              // own; the owner sees action icons on every row except their
              // own and (there being only one) the owner's own.
              const canAct = isOwner && !isSelf && m.role !== "owner";
              return (
                <li
                  key={m.user_id}
                  data-testid={`member-row-${m.user_id}`}
                  className="flex min-h-16 items-center gap-3 rounded-box border border-base-300 px-4 py-3"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm" title={m.email}>
                        {m.email}
                      </span>
                      <span className="badge badge-ghost shrink-0">
                        {t(m.role === "owner" ? "family.roleOwner" : "family.roleMember")}
                      </span>
                      {isSuspended ? (
                        <span
                          data-testid={`member-status-badge-${m.user_id}`}
                          className="badge badge-warning badge-outline shrink-0"
                        >
                          {t("family.statusSuspended")}
                        </span>
                      ) : null}
                      {isSelf ? (
                        <span className="badge badge-ghost shrink-0">{t("family.youBadge")}</span>
                      ) : null}
                    </div>
                    <span className="text-sm text-base-content/60">
                      {interpolate(t("family.joinedLabel"), {
                        date: m.joined_at ? formatExpiryDate(m.joined_at, locale) : "",
                      })}
                    </span>
                  </div>
                  {canAct ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        data-testid={`member-toggle-suspend-${m.user_id}`}
                        aria-label={interpolate(
                          t(isSuspended ? "member.reinstateAria" : "member.suspendAria"),
                          { email: m.email },
                        )}
                        className="btn btn-ghost btn-square btn-sm"
                        disabled={reinstatingUserId === m.user_id}
                        onClick={() => (isSuspended ? void handleReinstate(m) : setSuspendTarget(m))}
                      >
                        {isSuspended ? (
                          <PlayCircle size={16} aria-hidden="true" />
                        ) : (
                          <PauseCircle size={16} aria-hidden="true" />
                        )}
                      </button>
                      <button
                        type="button"
                        data-testid={`member-remove-trigger-${m.user_id}`}
                        aria-label={interpolate(t("member.removeAria"), { email: m.email })}
                        className="btn btn-ghost btn-square btn-sm"
                        onClick={() => setRemoveTarget(m)}
                      >
                        <UserMinus size={16} aria-hidden="true" />
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {reinstateErrorUserId !== null ? (
          <p role="alert" data-testid="member-reinstate-error" className="text-sm text-error">
            {t("member.reinstateFailed")}
          </p>
        ) : null}
      </div>

      {invitePanel}

      {suspendTarget !== null ? (
        <ConfirmDialog
          title={interpolate(t("member.suspendConfirmTitle"), { email: suspendTarget.email })}
          body={interpolate(t("member.suspendConfirmBody"), { email: suspendTarget.email })}
          confirmLabel={t("member.suspendConfirmConfirm")}
          severity="warning"
          error={suspendError}
          onConfirm={handleSuspendConfirm}
          onClose={closeSuspendDialog}
        />
      ) : null}

      {removeTarget !== null ? (
        <RemoveMemberDialog
          member={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onRemoved={() => {
            const removedUserId = removeTarget.user_id;
            setMembers((prev) => prev?.filter((m) => m.user_id !== removedUserId) ?? prev);
            setRemoveTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}
