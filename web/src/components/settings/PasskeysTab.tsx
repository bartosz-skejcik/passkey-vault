"use client";

// Passkeys tab content (AUTH-06, 03-UI-SPEC.md "Passkey row" section) —
// list/rename/delete for already-enrolled passkeys, plus the "+ Dodaj
// passkey" CTA wired to Plan 03-03's EnrollPasskeyDialog. Security-adjacent
// list per 03-UI-SPEC.md: plain DM Sans, no Fuzzy Bubbles/emoji.
import { useEffect, useRef, useState } from "react";
import { Check, KeyRound, Pencil, Trash2, X } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { interpolate } from "@/lib/i18n/dictionary";
import { formatRelativeTime } from "@/lib/format/relativeTime";
import { listPasskeys, renamePasskey, type PasskeyRow } from "@/lib/passkeys/api";
import EnrollPasskeyDialog from "./EnrollPasskeyDialog";
import PasskeyDeleteConfirmDialog from "./PasskeyDeleteConfirmDialog";

export default function PasskeysTab() {
  const { t, locale } = useLocale();
  const [rows, setRows] = useState<PasskeyRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PasskeyRow | null>(null);
  // Set synchronously by cancelRename() *before* the input unmounts, so a
  // blur event fired during/after that unmount (browser behavior varies)
  // never re-triggers a save for the row the user just explicitly cancelled.
  const cancelledRowId = useRef<string | null>(null);

  async function refetch() {
    try {
      const data = await listPasskeys();
      setRows(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }

  useEffect(() => {
    void refetch();
  }, []);

  function startRename(row: PasskeyRow) {
    setRenamingId(row.id);
    setRenameValue(row.name);
    setRenameError(null);
  }

  function cancelRename(rowId: string) {
    cancelledRowId.current = rowId;
    setRenamingId(null);
    setRenameError(null);
  }

  async function commitRename(row: PasskeyRow) {
    if (cancelledRowId.current === row.id) {
      cancelledRowId.current = null;
      return;
    }
    const nextName = renameValue.trim();
    if (nextName === "" || nextName === row.name) {
      setRenamingId(null);
      return;
    }
    try {
      await renamePasskey(row.id, nextName);
      setRows((prev) => prev?.map((r) => (r.id === row.id ? { ...r, name: nextName } : r)) ?? prev);
      setRenamingId(null);
      setRenameError(null);
    } catch {
      setRenameValue(row.name);
      setRenameError(t("passkeys.renameFailed"));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        data-testid="passkeys-add-cta"
        className="btn btn-primary btn-sm self-start"
        onClick={() => setShowEnroll(true)}
      >
        {t("passkeys.addCta")}
      </button>

      {loadError ? (
        <p data-testid="passkeys-load-error" className="text-sm text-error">
          {t("passkeys.loadFailed")}
        </p>
      ) : null}

      {rows !== null && rows.length === 0 && !loadError ? (
        <p data-testid="passkeys-empty-state" className="text-base text-base-content/70">
          {t("passkeys.emptyState")}
        </p>
      ) : null}

      {rows !== null && rows.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const created = formatRelativeTime(row.created_at, t, locale);
            const lastUsed = formatRelativeTime(row.last_used_at ?? undefined, t, locale);
            const isRenaming = renamingId === row.id;
            return (
              <li
                key={row.id}
                data-testid={`passkey-row-${row.id}`}
                className="flex min-h-16 items-center gap-3 rounded-box border border-base-300 bg-base-100 px-4 py-3"
              >
                <KeyRound
                  size={20}
                  className={row.prf_capable ? "shrink-0 text-accent" : "shrink-0 text-base-content/40"}
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  {isRenaming ? (
                    <div className="flex items-center gap-1">
                      <input
                        data-testid={`passkey-rename-input-${row.id}`}
                        aria-label={interpolate(t("aria.renamePasskeyLabel"), { name: row.name })}
                        className="input input-bordered input-xs flex-1"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitRename(row);
                          if (e.key === "Escape") cancelRename(row.id);
                        }}
                        onBlur={() => void commitRename(row)}
                        autoFocus
                      />
                      <button
                        type="button"
                        data-testid={`passkey-rename-save-${row.id}`}
                        aria-label={t("aria.renameSaveLabel")}
                        className="btn btn-ghost btn-square btn-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void commitRename(row)}
                      >
                        <Check size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        data-testid={`passkey-rename-cancel-${row.id}`}
                        aria-label={t("aria.renameCancelLabel")}
                        className="btn btn-ghost btn-square btn-xs"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => cancelRename(row.id)}
                      >
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                  ) : (
                    <span className="truncate text-base">{row.name}</span>
                  )}
                  <span className="text-sm text-base-content/60">
                    {interpolate(t("passkeys.createdLabel"), { date: created ?? "—" })}
                    {" · "}
                    {lastUsed
                      ? interpolate(t("passkeys.lastUsedLabel"), { time: lastUsed })
                      : t("passkeys.neverUsed")}
                  </span>
                  {renameError && isRenaming ? (
                    <span data-testid={`passkey-rename-error-${row.id}`} className="text-xs text-error">
                      {renameError}
                    </span>
                  ) : null}
                  {!row.prf_capable ? (
                    <span className="text-sm text-base-content/60">{t("passkeys.noPrfExplainer")}</span>
                  ) : null}
                </div>
                <span
                  className={
                    row.prf_capable
                      ? "badge badge-accent shrink-0"
                      : "badge badge-ghost shrink-0 text-base-content/50"
                  }
                >
                  {row.prf_capable ? t("passkeys.prfBadge") : t("passkeys.noPrfBadge")}
                </span>
                {!isRenaming ? (
                  <button
                    type="button"
                    data-testid={`passkey-rename-trigger-${row.id}`}
                    aria-label={interpolate(t("aria.renamePasskeyLabel"), { name: row.name })}
                    className="btn btn-ghost btn-square btn-sm shrink-0"
                    onClick={() => startRename(row)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                ) : null}
                <button
                  type="button"
                  data-testid={`passkey-delete-trigger-${row.id}`}
                  aria-label={interpolate(t("aria.deletePasskeyLabel"), { name: row.name })}
                  className="btn btn-ghost btn-square btn-sm shrink-0"
                  onClick={() => setDeleteTarget(row)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {showEnroll ? (
        <EnrollPasskeyDialog onClose={() => setShowEnroll(false)} onEnrolled={() => void refetch()} />
      ) : null}

      {deleteTarget ? (
        <PasskeyDeleteConfirmDialog
          passkey={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            void refetch();
          }}
        />
      ) : null}
    </div>
  );
}
