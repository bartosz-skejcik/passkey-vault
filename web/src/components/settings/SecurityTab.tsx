"use client";

// Security tab content — the auto-lock and clipboard-clear controls,
// migrated verbatim (same DaisyUI classes, same localStorage/
// AUTOLOCK_CHANGED_EVENT dispatch logic, same test ids) out of
// Sidebar.tsx's former settings dropdown, per 03-CONTEXT.md's "auto-lock
// minutes + clipboard clear — migrated from their current sidebar
// location" decision. Only the container changed (dropdown-content menu ->
// plain Settings-tab section) — behavior and storage contract are
// unchanged, proven by SettingsPanel.test.tsx's autolock-still-persists
// regression case.
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import {
  CLIPBOARD_SECONDS_KEY,
  DEFAULT_CLIPBOARD_SECONDS,
  clampClipboardSeconds,
} from "@/lib/clipboard";
import {
  AUTOLOCK_CHANGED_EVENT,
  AUTOLOCK_MINUTES_KEY,
  AUTOLOCK_OPTIONS,
  DEFAULT_AUTOLOCK_MINUTES,
  readAutolockMinutes,
} from "@/lib/idle/autolock";
import DeleteAccountDialog from "./DeleteAccountDialog";

const CLIPBOARD_SECONDS_OPTIONS = [30, 35, 40, 45, 50, 55, 60];

export default function SecurityTab() {
  const { t } = useLocale();
  const [autolockMinutes, setAutolockMinutes] = useState(DEFAULT_AUTOLOCK_MINUTES);
  const [clipboardSeconds, setClipboardSeconds] = useState(DEFAULT_CLIPBOARD_SECONDS);
  // Plan 25-09 (E6): the "Delete account" section's trigger renders for
  // EVERY account -- owner, plain member, or an account with no family at
  // all. Only the dialog's own body branches on role; the trigger itself
  // never branches (25-UI-SPEC.md's "trigger visibility" row).
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  useEffect(() => {
    try {
      setAutolockMinutes(String(readAutolockMinutes()));
      const storedClipboard = localStorage.getItem(CLIPBOARD_SECONDS_KEY);
      if (storedClipboard !== null) {
        setClipboardSeconds(clampClipboardSeconds(Number(storedClipboard)));
      }
    } catch {
      // localStorage may be unavailable (private mode); defaults stand.
    }
  }, []);

  function handleAutolockChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setAutolockMinutes(next);
    try {
      localStorage.setItem(AUTOLOCK_MINUTES_KEY, next);
    } catch {
      // localStorage may be unavailable (private mode) — the timer still
      // applies for this in-memory session.
    }
    // localStorage's own "storage" event only fires in *other* tabs — the
    // page.tsx idle-timer call site (same tab) needs its own notification
    // to pick up the new duration immediately.
    window.dispatchEvent(new Event(AUTOLOCK_CHANGED_EVENT));
  }

  function handleClipboardSecondsChange(e: React.ChangeEvent<HTMLInputElement>) {
    const next = Number(e.target.value);
    setClipboardSeconds(next);
    try {
      localStorage.setItem(CLIPBOARD_SECONDS_KEY, String(next));
    } catch {
      // localStorage may be unavailable (private mode) — the duration
      // still applies for this in-memory session (read at copy time).
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label className="text-sm text-base-content/70" htmlFor="settings-autolock-select">
          {t("autolock.label")}
        </label>
        <select
          id="settings-autolock-select"
          data-testid="sidebar-autolock-select"
          aria-label={t("autolock.label")}
          className="select select-sm select-bordered w-full"
          value={autolockMinutes}
          onChange={handleAutolockChange}
        >
          {AUTOLOCK_OPTIONS.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} min
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-sm text-base-content/70" htmlFor="settings-clipboard-duration">
          {t("clipboard.durationLabel")}
        </label>
        <input
          id="settings-clipboard-duration"
          data-testid="sidebar-clipboard-duration"
          aria-label={t("clipboard.durationLabel")}
          type="range"
          list="settings-clipboard-seconds-options"
          min={30}
          max={60}
          step={5}
          className="range range-sm"
          value={clipboardSeconds}
          onChange={handleClipboardSecondsChange}
        />
        <datalist id="settings-clipboard-seconds-options">
          {CLIPBOARD_SECONDS_OPTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <span className="text-xs text-base-content/60">{clipboardSeconds}s</span>
      </div>

      {/* Plan 25-09 (E6): row-neutral trigger -- `btn btn-ghost` with no
          error styling at the row level, matching every other row-action
          trigger in this codebase (25-UI-SPEC.md's Color section's
          "communicate security through calm and clarity" precedent).
          Severity lives only inside the dialog, on its step-2 confirm. */}
      <div className="flex flex-col gap-2">
        <h3 className="text-[20px] font-bold leading-[1.2]">{t("account.deleteSectionHeading")}</h3>
        <p className="text-sm text-base-content/70">{t("account.deleteSectionBody")}</p>
        <button
          type="button"
          data-testid="account-delete-trigger"
          className="btn btn-ghost self-start"
          onClick={() => setDeleteDialogOpen(true)}
        >
          {t("account.deleteTriggerCta")}
        </button>
      </div>

      {deleteDialogOpen ? (
        <DeleteAccountDialog onClose={() => setDeleteDialogOpen(false)} />
      ) : null}
    </div>
  );
}
