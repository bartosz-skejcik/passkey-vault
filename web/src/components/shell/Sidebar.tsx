"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  CreditCard,
  Folder,
  IdCard,
  KeyRound,
  LayoutGrid,
  Lock,
  LogOut,
  Languages,
  Moon,
  Plus,
  Settings,
  StickyNote,
  Sun,
  Tag,
  User,
  Vault,
  Wand2,
} from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { lockVault } from "@/lib/crypto";
import { logout } from "@/lib/auth/api";
import { clearSessionToken, clearStoredEmail } from "@/lib/auth/session";
import { createVaultFolder, useAllTags, useFolders } from "@/lib/vault/store";
import { AUTOLOCK_CHANGED_EVENT, AUTOLOCK_MINUTES_KEY, DEFAULT_AUTOLOCK_MINUTES } from "@/lib/idle/autolock";
import type { DICTIONARY } from "@/lib/i18n/dictionary";
import type { ItemType, VaultFilter } from "@/lib/vault/types";
import GeneratorDialog from "@/components/generator/GeneratorDialog";

// Category buttons mirror ItemRow.tsx's own TYPE_ICON map so a login's icon
// matches everywhere (sidebar category, list row, list badge).
const CATEGORY_ICON: Record<ItemType, typeof Vault> = {
  login: Vault,
  card: CreditCard,
  identity: IdCard,
  note: StickyNote,
};

const CATEGORY_LABEL_KEY: Record<ItemType, keyof typeof DICTIONARY> = {
  login: "sidebar.catLogins",
  card: "sidebar.catCards",
  identity: "sidebar.catIdentities",
  note: "sidebar.catNotes",
};

const ITEM_TYPES: ItemType[] = ["login", "card", "identity", "note"];

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
  onOpenSettings,
}: {
  activeFilter?: VaultFilter;
  onFilterChange?: (filter: VaultFilter) => void;
  // Opens the Settings drawer (UI-05) — called from the "Ustawienia" entry
  // in this footer's account dropdown, per binding resolution #1
  // (03-UI-SPEC.md's "Resolutions" section): the account row itself keeps
  // opening the Phase 2 dropdown, it does NOT open Settings directly.
  onOpenSettings?: () => void;
} = {}) {
  const { locale, setLocale, t } = useLocale();
  // Mirrors — does not duplicate — layout.tsx's inline pre-hydration
  // script, which only resolves the *initial* theme before first paint.
  // This component owns every subsequent user-driven theme change and
  // keeps its own render in sync with the DOM attribute it just set.
  const [theme, setTheme] = useState<"vault-dark" | "vault-light">("vault-dark");
  const [categoriesExpanded, setCategoriesExpanded] = useState(true);
  const [foldersExpanded, setFoldersExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);

  const folders = useFolders();
  const allTags = useAllTags();

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "vault-light" || current === "vault-dark") {
      setTheme(current);
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
      <nav className="flex flex-col gap-1 overflow-y-auto">
        <div>
          <button
            type="button"
            data-testid="sidebar-section-categories"
            className={navItemClass(false)}
            onClick={() => setCategoriesExpanded((v) => !v)}
          >
            <span className="flex-1">{t("sidebar.categories")}</span>
            <ChevronDown
              size={14}
              className={categoriesExpanded ? "rotate-180 transition-transform" : "transition-transform"}
              aria-hidden="true"
            />
          </button>
          {categoriesExpanded ? (
            <div className="ml-1 mt-1 flex flex-col gap-1">
              <button
                type="button"
                data-testid="sidebar-nav-all"
                className={navItemClass(activeFilter.kind === "all")}
                onClick={() => selectFilter({ kind: "all" })}
              >
                <LayoutGrid size={18} aria-hidden="true" />
                <span>{t("sidebar.all")}</span>
              </button>

              {ITEM_TYPES.map((type) => {
                const Icon = CATEGORY_ICON[type];
                return (
                  <button
                    key={type}
                    type="button"
                    data-testid={`sidebar-nav-type-${type}`}
                    className={navItemClass(
                      activeFilter.kind === "itemType" && activeFilter.itemType === type,
                    )}
                    onClick={() => selectFilter({ kind: "itemType", itemType: type })}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{t(CATEGORY_LABEL_KEY[type])}</span>
                  </button>
                );
              })}

              <button
                type="button"
                data-testid="sidebar-nav-passkeys"
                disabled
                className="flex w-full cursor-not-allowed items-center gap-2 rounded-field px-3 py-2 text-left text-sm text-base-content/40"
              >
                <KeyRound size={18} className="text-accent" aria-hidden="true" />
                <span className="flex-1">{t("sidebar.passkeys")}</span>
                <span className="badge badge-sm">{t("sidebar.passkeysSoon")}</span>
              </button>
            </div>
          ) : null}
        </div>

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

        <div>
          <button
            type="button"
            data-testid="sidebar-section-tools"
            className={navItemClass(false)}
            onClick={() => setToolsExpanded((v) => !v)}
          >
            <span className="flex-1">{t("sidebar.tools")}</span>
            <ChevronDown
              size={14}
              className={toolsExpanded ? "rotate-180 transition-transform" : "transition-transform"}
              aria-hidden="true"
            />
          </button>
          {toolsExpanded ? (
            <div className="ml-1 mt-1 flex flex-col gap-1">
              <button
                type="button"
                data-testid="sidebar-generator-trigger"
                className={navItemClass(false)}
                onClick={() => setShowGenerator(true)}
              >
                <Wand2 size={18} aria-hidden="true" />
                <span>{t("sidebar.generator")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </nav>

      {showGenerator ? <GeneratorDialog onClose={() => setShowGenerator(false)} /> : null}

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
            <div className="flex-1 text-sm text-base-content/70">{t("sidebar.account")}</div>
          </div>

          {/* Binding resolution #1 (03-UI-SPEC.md's "Resolutions" section):
              REVERT to the Phase 2 dropdown shape — a small quick-actions
              menu (Zablokuj teraz / Wyloguj / Ustawienia), not the account
              row opening Settings directly. Autolock/clipboard controls
              moved out to SecurityTab.tsx (CONTEXT.md decision, not
              relitigated by the resolution). */}
          <ul
            tabIndex={0}
            className="dropdown-content menu z-10 mb-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow"
          >
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
            <li>
              <button
                type="button"
                data-testid="sidebar-open-settings"
                aria-label={t("aria.openSettings")}
                onClick={() => onOpenSettings?.()}
              >
                <Settings size={16} aria-hidden="true" />
                {t("settings.title")}
              </button>
            </li>
          </ul>
        </div>

        <button
          type="button"
          aria-label={t("aria.toggleTheme")}
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
