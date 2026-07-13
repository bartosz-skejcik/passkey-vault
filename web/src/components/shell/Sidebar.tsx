"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  Folder,
  Lock,
  LogOut,
  Languages,
  Moon,
  Plus,
  Sun,
  Tag,
  User,
  Vault,
} from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { lockVault } from "@/lib/crypto";
import { logout } from "@/lib/auth/api";
import { clearSessionToken, clearStoredEmail } from "@/lib/auth/session";
import { createVaultFolder, useAllTags, useFolders } from "@/lib/vault/store";
import { CLIPBOARD_SECONDS_KEY, DEFAULT_CLIPBOARD_SECONDS } from "@/lib/clipboard";
import {
  AUTOLOCK_CHANGED_EVENT,
  AUTOLOCK_MINUTES_KEY,
  AUTOLOCK_OPTIONS,
  DEFAULT_AUTOLOCK_MINUTES,
  readAutolockMinutes,
} from "@/lib/idle/autolock";
import type { VaultFilter } from "@/lib/vault/types";

const CLIPBOARD_SECONDS_OPTIONS = [30, 35, 40, 45, 50, 55, 60];

// Every clickable nav element gets a real button + these classes (not a
// plain inert <div>): cursor-pointer, a visible hover state, and a
// distinct active/selected state for the current filter (user-requested
// UAT fix — the "Wszystkie"/folder/tag rows previously had no pointer
// cursor, no hover feedback, and clicking them did nothing).
function navItemClass(active: boolean): string {
  return `flex w-full cursor-pointer items-center gap-2 rounded-field px-3 py-2 text-left text-sm transition-colors ${
    active
      ? "bg-primary/[0.08] text-primary"
      : "text-base-content/70 hover:bg-base-200"
  }`;
}

export default function Sidebar({
  activeFilter = { kind: "all" },
  onFilterChange,
}: {
  activeFilter?: VaultFilter;
  onFilterChange?: (filter: VaultFilter) => void;
} = {}) {
  const { locale, setLocale, t } = useLocale();
  // Mirrors — does not duplicate — layout.tsx's inline pre-hydration
  // script, which only resolves the *initial* theme before first paint.
  // This component owns every subsequent user-driven theme change and
  // keeps its own render in sync with the DOM attribute it just set.
  const [theme, setTheme] = useState<"vault-dark" | "vault-light">("vault-dark");
  const [autolockMinutes, setAutolockMinutes] = useState(DEFAULT_AUTOLOCK_MINUTES);
  const [clipboardSeconds, setClipboardSeconds] = useState(DEFAULT_CLIPBOARD_SECONDS);
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);

  const folders = useFolders();
  const allTags = useAllTags();

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "vault-light" || current === "vault-dark") {
      setTheme(current);
    }

    try {
      setAutolockMinutes(String(readAutolockMinutes()));
      const storedClipboard = localStorage.getItem(CLIPBOARD_SECONDS_KEY);
      if (storedClipboard !== null) {
        setClipboardSeconds(Number(storedClipboard));
      }
    } catch {
      // localStorage may be unavailable (private mode); defaults stand.
    }
  }, []);

  function toggleTheme() {
    const next = theme === "vault-light" ? "vault-dark" : "vault-light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("pv-theme", next);
    } catch {
      // localStorage may be unavailable (private mode); theme still
      // applies for this session via the DOM attribute above.
    }
    setTheme(next);
  }

  function changeLanguage() {
    setLocale(locale === "pl" ? "en" : "pl");
  }

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

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Best-effort — clear local state regardless of server-side outcome
      // (e.g. the session was already expired server-side).
    }
    clearSessionToken();
    clearStoredEmail();
    lockVault();
    try {
      window.location.reload();
    } catch {
      // jsdom (unit tests) doesn't implement real navigation.
    }
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (name === "") return;
    setFolderError(null);
    try {
      await createVaultFolder(name);
      setNewFolderName("");
      setAddingFolder(false);
    } catch {
      setFolderError(t("error.folderCreateFailed"));
    }
  }

  function selectFilter(filter: VaultFilter) {
    onFilterChange?.(filter);
  }

  return (
    <aside className="hidden md:flex md:w-64 md:shrink-0 flex-col bg-base-200 p-4">
      <nav className="flex flex-col gap-1">
        <button
          type="button"
          data-testid="sidebar-nav-all"
          className={navItemClass(activeFilter.kind === "all")}
          onClick={() => selectFilter({ kind: "all" })}
        >
          <Vault size={18} aria-hidden="true" />
          <span>{t("sidebar.all")}</span>
        </button>

        <div>
          <button
            type="button"
            data-testid="sidebar-nav-folders"
            className={navItemClass(false)}
            onClick={() => setFoldersExpanded((v) => !v)}
          >
            <Folder size={18} aria-hidden="true" />
            <span className="flex-1">{t("sidebar.folders")}</span>
            <ChevronDown
              size={14}
              className={foldersExpanded ? "rotate-180 transition-transform" : "transition-transform"}
              aria-hidden="true"
            />
          </button>
          {foldersExpanded ? (
            <div className="ml-6 mt-1 flex flex-col gap-1">
              {folders.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  data-testid={`sidebar-folder-${folder.id}`}
                  className={navItemClass(
                    activeFilter.kind === "folder" && activeFilter.id === folder.id,
                  )}
                  onClick={() => selectFilter({ kind: "folder", id: folder.id })}
                >
                  <span className="truncate">{folder.name}</span>
                </button>
              ))}
              {addingFolder ? (
                <div className="flex items-center gap-1 px-1">
                  <input
                    data-testid="sidebar-new-folder-name"
                    className="input input-bordered input-xs flex-1"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder={t("sidebar.newFolderPlaceholder")}
                  />
                  <button
                    type="button"
                    data-testid="sidebar-new-folder-confirm"
                    className="btn btn-primary btn-xs"
                    onClick={() => void handleCreateFolder()}
                  >
                    <Plus size={12} aria-hidden="true" />
                  </button>
                </div>
              ) : null}
              {addingFolder && folderError ? (
                <p data-testid="sidebar-folder-create-error" className="px-1 text-xs text-error">
                  {folderError}
                </p>
              ) : null}
              {!addingFolder ? (
                <button
                  type="button"
                  data-testid="sidebar-new-folder-button"
                  aria-label={t("aria.newFolder")}
                  className={navItemClass(false)}
                  onClick={() => setAddingFolder(true)}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>{t("aria.newFolder")}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div>
          <button
            type="button"
            data-testid="sidebar-nav-tags"
            className={navItemClass(false)}
            onClick={() => setTagsExpanded((v) => !v)}
          >
            <Tag size={18} aria-hidden="true" />
            <span className="flex-1">{t("sidebar.tags")}</span>
            <ChevronDown
              size={14}
              className={tagsExpanded ? "rotate-180 transition-transform" : "transition-transform"}
              aria-hidden="true"
            />
          </button>
          {tagsExpanded ? (
            <div className="ml-6 mt-1 flex flex-col gap-1">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  data-testid={`sidebar-tag-${tag}`}
                  className={navItemClass(activeFilter.kind === "tag" && activeFilter.tag === tag)}
                  onClick={() => selectFilter({ kind: "tag", tag })}
                >
                  <span className="truncate">{tag}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </nav>

      <div className="mt-auto flex items-center gap-3 border-t border-base-300 pt-4">
        <div className="dropdown dropdown-top flex-1">
          <div
            tabIndex={0}
            role="button"
            className="flex w-full items-center gap-3 rounded-field p-1 text-left"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-base-300 text-base-content/60">
              <User size={18} aria-hidden="true" />
            </div>
            <div className="flex-1 text-sm text-base-content/70">Konto</div>
          </div>

          <ul
            tabIndex={0}
            className="dropdown-content menu z-10 mb-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow"
          >
            <li className="menu-title">{t("autolock.label")}</li>
            <li>
              <select
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
            </li>
            <li className="menu-title">{t("clipboard.durationLabel")}</li>
            <li>
              <input
                data-testid="sidebar-clipboard-duration"
                aria-label={t("clipboard.durationLabel")}
                type="range"
                list="clipboard-seconds-options"
                min={30}
                max={60}
                step={5}
                className="range range-sm"
                value={clipboardSeconds}
                onChange={handleClipboardSecondsChange}
              />
              <datalist id="clipboard-seconds-options">
                {CLIPBOARD_SECONDS_OPTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <span className="text-xs text-base-content/60">{clipboardSeconds}s</span>
            </li>
            <li>
              <button
                type="button"
                data-testid="sidebar-language"
                aria-label={t("aria.changeLanguage")}
                onClick={changeLanguage}
              >
                <Languages size={16} aria-hidden="true" />
                {t("aria.changeLanguage")}
              </button>
            </li>
            <li>
              <button
                type="button"
                data-testid="sidebar-lock-now"
                aria-label={t("aria.lockNow")}
                onClick={() => lockVault()}
              >
                <Lock size={16} aria-hidden="true" />
                {t("aria.lockNow")}
              </button>
            </li>
            <li>
              <button
                type="button"
                data-testid="sidebar-logout"
                aria-label={t("aria.logout")}
                onClick={handleLogout}
              >
                <LogOut size={16} aria-hidden="true" />
                {t("auth.logout")}
              </button>
            </li>
          </ul>
        </div>

        <button
          type="button"
          aria-label="Przełącz motyw"
          className="btn btn-ghost btn-square btn-sm"
          onClick={toggleTheme}
        >
          {theme === "vault-light" ? (
            <Sun size={18} aria-hidden="true" />
          ) : (
            <Moon size={18} aria-hidden="true" />
          )}
        </button>
      </div>
    </aside>
  );
}

export { AUTOLOCK_MINUTES_KEY, AUTOLOCK_CHANGED_EVENT, DEFAULT_AUTOLOCK_MINUTES };
