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
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  PauseCircle,
  PlayCircle,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
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
import { accessLevelKey } from "@/lib/families/accessLevel";
import { formatFingerprintWords } from "pv-ui/identity/fingerprint";
import CollectionPicker from "@/components/vault/CollectionPicker";
import ShareDialog from "@/components/vault/ShareDialog";
import ConfirmDialog from "./ConfirmDialog";
import RemoveMemberDialog from "./RemoveMemberDialog";

type Mode = "checking" | "bootstrap" | "normal" | "error";
// Plan 26-12: "folder" is now genuinely reachable -- Phase 26 built the
// client-side collections capability (CollectionPicker, ensureOwnIdentityKeypair,
// sealCollectionKey/unsealCollectionKey) that CR-02 (24-REVIEW.md) was
// waiting on. See the invite-scope-select block below for the wiring.
type ScopeChoice = "family" | "folder";

// Mirrors ShareDialog.tsx's own (non-exported) ACCESS_LEVEL_VALUES -- the
// invite form's collection-scope branch needs the same three-value radio
// vocabulary since InviteScope's "collection" variant carries a real
// accessLevel field the server enforces (membership.rs::parse_access_level),
// never a silently-hardcoded default.
const ACCESS_LEVEL_VALUES = ["read", "edit", "hidden_password"] as const;
type AccessLevelValue = (typeof ACCESS_LEVEL_VALUES)[number];

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

  // Invite-creation (E5) state. Plan 26-12 re-enables "folder" -- a real
  // `CollectionPicker` now drives `selectedCollectionId`/`collectionAccessLevel`
  // instead of the CR-02-era permanently-disabled option.
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>("family");
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [collectionAccessLevel, setCollectionAccessLevel] = useState<AccessLevelValue>("read");
  const [showCreateCollectionDialog, setShowCreateCollectionDialog] = useState(false);
  const [expiry, setExpiry] = useState<InviteExpiry>(DEFAULT_EXPIRY);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Identity fingerprint card + per-member reveal (E7, D-4/SEC-05, Task 1).
  // `expandedFingerprintIds` tracks which OTHER members' rows currently show
  // their word-list panel (never shown expanded by default -- keeps the
  // roster's existing density from Phase 25); the caller's OWN fingerprint
  // is always shown via the pinned card above the list, so it never needs an
  // entry here. `copiedFingerprintId` mirrors DetailPanel.tsx's own
  // Check-icon-swap-on-copy micro-interaction, keyed by "self" or a member's
  // user_id so the self card and every member row's copy button animate
  // independently.
  const [expandedFingerprintIds, setExpandedFingerprintIds] = useState<Set<string>>(new Set());
  const [copiedFingerprintId, setCopiedFingerprintId] = useState<string | null>(null);

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

  // Identity fingerprint card + per-member reveal (E7, Task 1).
  function toggleFingerprint(userId: string) {
    setExpandedFingerprintIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  }

  /** UI-SPEC E7 / Phase-Specific Notes §2: a deliberate, documented deviation
   * from `copyWithAutoClear` -- a fingerprint is a non-reversible, public
   * derivation of an already-published public key, not a secret, and
   * auto-clearing it would work against its own out-of-band-comparison
   * purpose (the recipient needs it to still be on their clipboard when they
   * paste it into a text message or call transcript, possibly minutes
   * later). `id` is "self" for the caller's own card or a member's
   * `user_id`, matching `copiedFingerprintId`'s keying. */
  function handleCopyFingerprint(id: string, words: string) {
    void navigator.clipboard.writeText(words);
    setCopiedFingerprintId(id);
    setTimeout(
      () => setCopiedFingerprintId((current) => (current === id ? null : current)),
      1500,
    );
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
    // Defensive guard mirroring `submitDisabled` below -- a folder scope with
    // nothing picked yet must never reach `generateInviteLink` with a
    // `collectionId` of `null`.
    if (scopeChoice === "folder" && selectedCollectionId === null) {
      return;
    }
    setGenerating(true);
    try {
      // Plan 26-12: the collection-scoped branch is real now -- Phase 26
      // built the client-side collections capability (CollectionPicker,
      // ensureOwnIdentityKeypair, sealCollectionKey/unsealCollectionKey) that
      // CR-02 (24-REVIEW.md) was blocked on.
      const scope: InviteScope =
        scopeChoice === "folder" && selectedCollectionId !== null
          ? { kind: "collection", collectionId: selectedCollectionId, accessLevel: collectionAccessLevel }
          : { kind: "family" };
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
    setScopeChoice("family");
    setSelectedCollectionId(null);
    setCollectionAccessLevel("read");
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
          {/* Plan 26-12: CR-02 (24-REVIEW.md)'s block is lifted -- Phase 26
              built the real client-side collections capability (CollectionPicker,
              ensureOwnIdentityKeypair, sealCollectionKey/unsealCollectionKey)
              that "coming in a later version" was waiting on. Choosing
              "folder" mounts CollectionPicker in the exact visual position
              the old disabled-note paragraph occupied, so this fix
              introduces no layout shift. */}
          <select
            id="invite-scope-select"
            data-testid="invite-scope-select"
            className="select select-bordered w-full"
            value={scopeChoice}
            onChange={(e) => setScopeChoice(e.target.value as ScopeChoice)}
          >
            <option value="family">{t("invite.scopeWholeFamily")}</option>
            <option value="folder">{t("invite.scopeFolder")}</option>
          </select>
          {scopeChoice === "folder" ? (
            <div className="flex flex-col gap-3">
              <CollectionPicker
                value={selectedCollectionId}
                onSelect={setSelectedCollectionId}
                onCreateNew={() => setShowCreateCollectionDialog(true)}
              />
              <div className="flex flex-col gap-1">
                <label htmlFor="invite-folder-access-level-select" className="text-sm">
                  {t("share.accessLevelLabel")}
                </label>
                <select
                  id="invite-folder-access-level-select"
                  data-testid="invite-folder-access-level-select"
                  className="select select-bordered w-full"
                  value={collectionAccessLevel}
                  onChange={(e) => setCollectionAccessLevel(e.target.value as AccessLevelValue)}
                >
                  {ACCESS_LEVEL_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {t(accessLevelKey(value))}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
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
          disabled={generating || (scopeChoice === "folder" && selectedCollectionId === null)}
        >
          {generating ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : null}
          {t("invite.generateCta")}
        </button>
      </form>

      {showCreateCollectionDialog ? (
        <ShareDialog
          scope={{ kind: "folder", existingFolderId: null }}
          onClose={() => setShowCreateCollectionDialog(false)}
          onShared={() => setShowCreateCollectionDialog(false)}
        />
      ) : null}
    </div>
  );
  })();

  // Plan 25-08 (E5): the caller's own row, re-derived from the SAME
  // `members` fetch every render -- so a page reload re-evaluates it fresh,
  // and it disappears on the very next fetch after reinstatement (no
  // one-time toast, no client-side timer).
  const selfRow = members?.find((m) => m.user_id === selfUserId) ?? null;
  const isSelfSuspended = selfRow?.status === "suspended";

  // Identity fingerprint card + per-member reveal (E7, D-4/SEC-05, Task 1).
  // Shared by the self card and every expanded member row so the word-list +
  // copy-button + mismatch-warning treatment is byte-identical in both
  // places (honesty constraint 5: the mismatch warning renders beside EVERY
  // rendered word list, never only the self card). `copyKey` keys
  // `copiedFingerprintId` so the self card's and each row's copy-button
  // Check-icon animate independently; `testId` generates this call site's
  // own testid namespace.
  function renderFingerprintPanel(
    copyKey: string,
    testId: (field: "words" | "unavailable" | "copy" | "mismatch-warning" | "malformed") => string,
    fingerprint: string | null,
  ) {
    if (fingerprint === null) {
      // Honesty constraint 3: never styled or worded as an error -- this is
      // the honest, expected state before KEY-01's client trigger (E9) has
      // published this member's identity keypair.
      return (
        <p data-testid={testId("unavailable")} className="text-sm text-base-content/70">
          {t("identity.fingerprintUnavailable")}
        </p>
      );
    }
    // WR-09 (code review, Phase 26): `formatFingerprintWords` fails CLOSED
    // by throwing on anything that isn't exactly 64 hex characters --
    // correct for the primitive (Plan 26-03's contract is to fail loudly at
    // the DERIVATION layer, never to invent a plausible-but-wrong word
    // list). But calling it bare inside the render path meant a malicious or
    // buggy server returning "", "deadbeef", or a 63-char value for ANY
    // member's fingerprint threw during render and took down the whole
    // FamilyTab -- removal, suspension and invite UI included. In a
    // zero-knowledge product the server is explicitly untrusted, so that is
    // a reachable input, not a hypothetical. `""` in particular slips past
    // the `fingerprint === null` guard, since `?? null` does not normalize
    // an empty string.
    //
    // A presentation transform fails SOFT: degrade to a copy that names the
    // anomaly (never the benign not-yet-published copy -- a malformed value
    // is a signal, not an absence).
    let words: string | null = null;
    try {
      words = formatFingerprintWords(fingerprint);
    } catch {
      words = null;
    }
    if (words === null) {
      return (
        <p data-testid={testId("malformed")} className="text-sm text-error">
          {t("identity.fingerprintMalformed")}
        </p>
      );
    }
    return (
      <>
        <div className="flex items-center gap-2">
          <span
            data-testid={testId("words")}
            className="min-w-0 flex-1 break-all font-mono text-base font-bold"
          >
            {words}
          </span>
          <button
            type="button"
            data-testid={testId("copy")}
            aria-label={t("identity.fingerprintCopyAria")}
            className="btn btn-ghost btn-square btn-sm shrink-0"
            onClick={() => handleCopyFingerprint(copyKey, words)}
          >
            {copiedFingerprintId === copyKey ? (
              <Check size={16} className="text-success" aria-hidden="true" />
            ) : (
              <Copy size={16} aria-hidden="true" />
            )}
          </button>
        </div>
        <p data-testid={testId("mismatch-warning")} className="text-sm text-base-content/70">
          {t("identity.fingerprintMismatchWarning")}
        </p>
      </>
    );
  }

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

        {/* E7 (D-4/SEC-05): pinned above the Members list, inside this SAME
            family-members-section container -- not a separate settings
            section. "Show the user's own fingerprint alongside other
            members'" (26-CONTEXT.md D-4 detail) -- you cannot verify
            out-of-band without reading your own aloud. */}
        <div
          data-testid="identity-self-card"
          className="flex flex-col gap-2 rounded-box border border-base-300 bg-base-200/40 px-4 py-3"
        >
          <h4 className="text-sm font-bold">{t("identity.yourFingerprintHeading")}</h4>
          {renderFingerprintPanel(
            "self",
            (field) => `identity-self-fingerprint-${field}`,
            selfRow?.fingerprint ?? null,
          )}
        </div>

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
              // E7: any member (owner or not) can reveal any OTHER member's
              // fingerprint -- reading the roster is already RequireRead, no
              // extra permission is needed for this. The self row never gets
              // its own toggle -- it's always shown, unconditionally
              // expanded, via the identity-self-card above.
              const fingerprintExpanded = !isSelf && expandedFingerprintIds.has(m.user_id);
              return (
                <li
                  key={m.user_id}
                  data-testid={`member-row-${m.user_id}`}
                  className="flex flex-col gap-2 rounded-box border border-base-300 px-4 py-3"
                >
                  <div className="flex min-h-16 items-center gap-3">
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
                    {!isSelf || canAct ? (
                      <div className="flex shrink-0 items-center gap-2">
                        {!isSelf ? (
                          <button
                            type="button"
                            data-testid={`member-fingerprint-toggle-${m.user_id}`}
                            aria-label={interpolate(t("identity.fingerprintRevealAria"), {
                              email: m.email,
                            })}
                            className="btn btn-ghost btn-square btn-sm"
                            onClick={() => toggleFingerprint(m.user_id)}
                          >
                            {fingerprintExpanded ? (
                              <ChevronDown size={16} aria-hidden="true" />
                            ) : (
                              <ChevronRight size={16} aria-hidden="true" />
                            )}
                          </button>
                        ) : null}
                        {canAct ? (
                          <>
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
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {fingerprintExpanded ? (
                    <div
                      data-testid={`member-fingerprint-panel-${m.user_id}`}
                      className="flex flex-col gap-2"
                    >
                      {renderFingerprintPanel(
                        m.user_id,
                        (field) => `member-fingerprint-${field}-${m.user_id}`,
                        m.fingerprint,
                      )}
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
