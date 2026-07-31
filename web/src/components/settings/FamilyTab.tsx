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
import { AlertTriangle, Copy, UserPlus } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { ApiClientError } from "@/lib/auth/api";
import { getUnlockedUserKey } from "@/lib/crypto";
import { useFolders } from "@/lib/vault/store";
import { copyWithAutoClear, readClipboardSeconds } from "@/lib/clipboard";
import { showCopyToast } from "@/lib/vault/copyToast";
import { createFamily, getFamilyMembers } from "@/lib/families/api";
import { generateInviteLink, type InviteExpiry, type InviteScope } from "@/lib/invite/crypto";
import { revokeInvite } from "@/lib/invite/api";

type Mode = "checking" | "bootstrap" | "normal";
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
 * library, per 24-UI-SPEC.md's Phase-Specific Notes §2. */
function formatExpiryDate(iso: string, locale: "pl" | "en"): string {
  return new Date(iso).toLocaleString(locale === "pl" ? "pl-PL" : "en-US");
}

export default function FamilyTab() {
  const { t, locale } = useLocale();
  const folders = useFolders();

  const [mode, setMode] = useState<Mode>("checking");

  // Bootstrap (E7) state.
  const [familyName, setFamilyName] = useState("");
  const [creatingFamily, setCreatingFamily] = useState(false);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);

  // Invite-creation (E5) state.
  const [scopeChoice, setScopeChoice] = useState<ScopeChoice>("family");
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [expiry, setExpiry] = useState<InviteExpiry>(DEFAULT_EXPIRY);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Generated-invite display (E6) state.
  const [invite, setInvite] = useState<{ id: string; url: string; expiresAt: string } | null>(null);
  const [showRevokeConfirm, setShowRevokeConfirm] = useState(false);
  const [revoking, setRevoking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFamilyMembers()
      .then((members) => {
        if (cancelled) return;
        setMode(members === null ? "bootstrap" : "normal");
      })
      .catch(() => {
        if (cancelled) return;
        // A transient fetch failure on mount must never leave the tab stuck
        // on an internal "checking" state with no way forward — falling
        // through to the bootstrap form (which itself surfaces a retry via
        // family.createFailed) is the honest, recoverable choice.
        setMode("bootstrap");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreateFamily(e: FormEvent) {
    e.preventDefault();
    setCreatingFamily(true);
    setBootstrapError(null);
    try {
      await createFamily(familyName.trim());
      setMode("normal");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        // Another tab already created the singleton family — recover by
        // re-fetching membership and advancing straight to the invite form,
        // never a dead end requiring a page reload (E7 backstop).
        const members = await getFamilyMembers().catch(() => null);
        if (members !== null) {
          setMode("normal");
          return;
        }
      }
      setBootstrapError(t("family.createFailed"));
    } finally {
      setCreatingFamily(false);
    }
  }

  function handleScopeChange(next: ScopeChoice) {
    setScopeChoice(next);
    if (next === "folder" && selectedFolderId === "" && folders.length > 0) {
      setSelectedFolderId(folders[0].id);
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
      const scope: InviteScope =
        scopeChoice === "folder"
          ? { kind: "collection", collectionId: selectedFolderId, accessLevel: "read" }
          : { kind: "family" };
      const result = await generateInviteLink(scope, expiry, uk);
      setInvite({ id: extractInviteId(result.url), url: result.url, expiresAt: result.expiresAt });
    } catch {
      // Never resets scope/expiry — the user's already-entered selections
      // stay exactly as they left them (E5 backstop).
      setGenerateError(t("invite.generateFailed"));
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
    setSelectedFolderId("");
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

  const foldersEmpty = folders.length === 0;

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
          <select
            id="invite-scope-select"
            data-testid="invite-scope-select"
            className="select select-bordered w-full"
            value={scopeChoice}
            onChange={(e) => handleScopeChange(e.target.value as ScopeChoice)}
          >
            <option value="family">{t("invite.scopeWholeFamily")}</option>
            <option value="folder" disabled={foldersEmpty}>
              {t("invite.scopeFolder")}
            </option>
          </select>
        </div>

        {foldersEmpty ? (
          <p data-testid="invite-folder-picker-empty" className="text-sm text-base-content/70">
            {t("invite.folderPickerEmpty")}
          </p>
        ) : scopeChoice === "folder" ? (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="invite-folder-select" className="text-sm">
                {t("invite.folderPickerLabel")}
              </label>
              <select
                id="invite-folder-select"
                data-testid="invite-folder-select"
                className="select select-bordered w-full truncate"
                value={selectedFolderId}
                onChange={(e) => setSelectedFolderId(e.target.value)}
              >
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id} className="truncate" title={folder.name}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>
            <p data-testid="invite-honest-visibility-note" className="text-sm text-base-content/70">
              {t("invite.honestVisibilityNote")}
            </p>
          </>
        ) : null}

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
          disabled={generating || (scopeChoice === "folder" && selectedFolderId === "")}
        >
          {generating ? <span className="loading loading-spinner loading-sm" aria-hidden="true" /> : null}
          {t("invite.generateCta")}
        </button>
      </form>
    </div>
  );
}
