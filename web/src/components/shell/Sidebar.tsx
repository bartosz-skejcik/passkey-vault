"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  CreditCard,
  Folder,
  Globe,
  IdCard,
  KeyRound,
  LayoutGrid,
  Lock,
  LogOut,
  Languages,
  Moon,
  MoreVertical,
  Plus,
  Settings,
  Share2,
  StickyNote,
  Sun,
  Tag,
  Timer,
  User,
  Users,
  Wand2,
} from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { lockVault } from "@/lib/crypto";
import { logout } from "@/lib/auth/api";
import { clearSessionToken, clearStoredEmail } from "@/lib/auth/session";
import { createVaultFolder, useAllTags, useFolders } from "@/lib/vault/store";
import { useSyncStatus } from "@/lib/vault/syncStatus";
import { useCollections } from "@/lib/vault/collections";
import { getCollectionAccessList } from "@/lib/vault/api";
import type { ShareRecipient } from "@/lib/vault/shareRecipients";
import { AUTOLOCK_CHANGED_EVENT, AUTOLOCK_MINUTES_KEY, DEFAULT_AUTOLOCK_MINUTES } from "@/lib/idle/autolock";
import type { ItemType, VaultFilter } from "@/lib/vault/types";
import { ITEM_TYPE_LABEL_KEY } from "@/lib/vault/itemTypeLabels";
import GeneratorDialog from "@/components/generator/GeneratorDialog";
import AvatarStack from "@/components/vault/AvatarStack";
import ShareDialog, { type ShareDialogScope } from "@/components/vault/ShareDialog";
import SharingOverviewPanel from "@/components/vault/SharingOverviewPanel";

// Category buttons mirror ItemRow.tsx's own TYPE_ICON map so a login's icon
// matches everywhere (sidebar category, list row, list badge). `passkey`
// uses the same KeyRound icon as the list row/detail panel — Phase 12
// shipped provider-created passkey vault items, so this category filter is
// a real one, mirroring the extension popup's own type coverage
// (extension/entrypoints/popup/ItemListView.tsx).
const CATEGORY_ICON: Record<ItemType, typeof Globe> = {
  login: Globe,
  card: CreditCard,
  identity: IdCard,
  note: StickyNote,
  totp: Timer,
  passkey: KeyRound,
};

const ITEM_TYPES: ItemType[] = ["login", "card", "identity", "note", "totp", "passkey"];

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
  const [sharedFoldersExpanded, setSharedFoldersExpanded] = useState(false);
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(true);
  const [addingFolder, setAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  // ShareDialog (Plan 26-08) — one dialog, two folder-variant entry points
  // from this file: the "+ Nowy udostępniony folder" create trigger (no
  // seed) and an existing personal folder's own "Udostępnij ten folder"
  // kebab action (seeded with that folder's id).
  const [shareDialogScope, setShareDialogScope] = useState<ShareDialogScope | null>(null);
  // SharingOverviewPanel (Plan 26-11) — opened from the account-area
  // dropdown cluster, same mount-on-flag pattern showGenerator/GeneratorDialog
  // already uses in this file.
  const [showSharingOverview, setShowSharingOverview] = useState(false);

  const folders = useFolders();
  const allTags = useAllTags();
  const syncStatus = useSyncStatus();
  const collections = useCollections();

  // Per-collection recipient cache for the icon-only AvatarStack variant
  // (UI-SPEC E5's narrow-column resolution) — a plain ref-backed cache
  // (never component state directly) so the fetch effect below only
  // depends on `collections`, not on its own previous result, avoiding an
  // effect-depends-on-itself loop. Each collection is fetched at most once
  // per Sidebar mount/collections-refresh, mirroring shareRecipients.ts's
  // own "never re-fetch a cached id" discipline.
  const sharedFolderRecipientsRef = useRef<Map<string, ShareRecipient[]>>(new Map());
  const [, forceSharedFolderRecipientsRerender] = useState(0);

  useEffect(() => {
    let cancelled = false;
    collections.forEach((collection) => {
      if (sharedFolderRecipientsRef.current.has(collection.id)) return;
      getCollectionAccessList(collection.id)
        .then((entries) => {
          if (cancelled) return;
          sharedFolderRecipientsRef.current.set(
            collection.id,
            entries.map((entry) => ({ email: entry.email, suspended: entry.suspended })),
          );
          forceSharedFolderRecipientsRerender((n) => n + 1);
        })
        .catch(() => {
          // Fail-safe, not fail-crash (mirrors shareRecipients.ts's own
          // posture) — an unresolved recipient list renders as "no visible
          // avatar", never a thrown error inside the nav.
          if (cancelled) return;
          sharedFolderRecipientsRef.current.set(collection.id, []);
          forceSharedFolderRecipientsRerender((n) => n + 1);
        });
    });
    return () => {
      cancelled = true;
    };
  }, [collections]);

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
                    <span>{t(ITEM_TYPE_LABEL_KEY[type])}</span>
                  </button>
                );
              })}
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
                <div key={folder.id} className="group flex items-center gap-1">
                  <button
                    type="button"
                    data-testid={`sidebar-folder-${folder.id}`}
                    className={`${navItemClass(
                      activeFilter.kind === "folder" && activeFilter.id === folder.id,
                    )} flex-1`}
                    onClick={() => selectFilter({ kind: "folder", id: folder.id })}
                  >
                    <span className="truncate">{folder.name}</span>
                  </button>
                  {/* First-ever context menu on a personal-folder row
                      (26-UI-SPEC.md E2) — exactly one action, "Share this
                      folder", opening ShareDialog's folder-create variant
                      SEEDED with this folder's id. CSS-only `.dropdown`
                      (no React open/close state), mirroring this same
                      file's own account-area cluster below — the
                      dropdown-content <ul> is unconditionally in the DOM,
                      only visually hidden until focus, matching every other
                      dropdown already in this file. */}
                  <div className="dropdown dropdown-end" onClick={(e) => e.stopPropagation()}>
                    <div
                      tabIndex={0}
                      role="button"
                      data-testid={`sidebar-folder-menu-trigger-${folder.id}`}
                      // 26-12a gap fix: a dedicated entry-point aria-label,
                      // distinct from ShareDialog's own `share.ctaFolder`
                      // submit CTA the seeded folder-create variant opens.
                      aria-label={t("share.shareThisFolder")}
                      className="btn btn-ghost btn-square btn-xs shrink-0 opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                    >
                      <MoreVertical size={14} aria-hidden="true" />
                    </div>
                    <ul
                      tabIndex={0}
                      data-testid={`sidebar-folder-menu-${folder.id}`}
                      className="dropdown-content menu z-10 mt-1 w-48 rounded-box border border-base-300 bg-base-100 p-2 shadow"
                    >
                      <li>
                        <button
                          type="button"
                          data-testid={`sidebar-folder-share-${folder.id}`}
                          onClick={() =>
                            setShareDialogScope({ kind: "folder", existingFolderId: folder.id })
                          }
                        >
                          {/* 26-12a gap fix: matches 26-UI-SPEC.md's own E2
                              literal for this exact action verbatim, distinct
                              from ShareDialog's `share.ctaFolder` submit CTA. */}
                          {t("share.shareThisFolder")}
                        </button>
                      </li>
                    </ul>
                  </div>
                </div>
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

        {/* "Shared folders" section (26-UI-SPEC.md E2) — sibling of
            "Foldery" above, same navItemClass/chevron/collapse idiom
            (default-collapsed, matching foldersExpanded's own default),
            sourced from useCollections() instead of useFolders(). Zero
            shared folders still renders the section shell with only the
            "+ Nowy udostępniony folder" create trigger inside — never
            hidden entirely, since hiding it would hide the only way to
            create the first one. */}
        <div>
          <button
            type="button"
            data-testid="sidebar-nav-shared-folders"
            className={navItemClass(false)}
            onClick={() => setSharedFoldersExpanded((v) => !v)}
          >
            <Users size={18} aria-hidden="true" />
            <span className="flex-1">{t("sharing.navLabel")}</span>
            <ChevronDown
              size={14}
              className={
                sharedFoldersExpanded ? "rotate-180 transition-transform" : "transition-transform"
              }
              aria-hidden="true"
            />
          </button>
          {sharedFoldersExpanded ? (
            <div className="ml-6 mt-1 flex flex-col gap-1">
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  data-testid={`sidebar-shared-folder-${collection.id}`}
                  className="flex items-center gap-2 rounded-field px-3 py-2 text-sm text-base-content/70"
                >
                  <span className="min-w-0 flex-1 truncate" title={collection.name}>
                    {collection.name}
                  </span>
                  <AvatarStack
                    variant="icon"
                    recipients={sharedFolderRecipientsRef.current.get(collection.id) ?? []}
                  />
                </div>
              ))}
              <button
                type="button"
                data-testid="sidebar-new-shared-folder-button"
                className={`${navItemClass(false)} text-primary`}
                onClick={() => setShareDialogScope({ kind: "folder", existingFolderId: null })}
              >
                <span>{t("folder.pickerCreateNew")}</span>
              </button>
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

      {shareDialogScope !== null ? (
        <ShareDialog
          scope={shareDialogScope}
          onClose={() => setShareDialogScope(null)}
          onShared={() => setShareDialogScope(null)}
        />
      ) : null}

      {showSharingOverview ? (
        <SharingOverviewPanel onClose={() => setShowSharingOverview(false)} />
      ) : null}

      <div className="mt-auto flex items-center gap-3 border-t border-base-300 pt-4">
        <div className="dropdown dropdown-top flex-1">
          <div
            tabIndex={0}
            role="button"
            className="flex w-full items-center gap-3 rounded-field p-1 text-left"
          >
            <div className="relative flex h-9 w-9 items-center justify-center rounded-full bg-base-300 text-base-content/60">
              <User size={18} aria-hidden="true" />
              {/* Two-visible-states-only rule (05-UI-SPEC.md): render
                  nothing at all for "connected"/"offline" — the dot only
                  ever appears while reconnecting. */}
              {syncStatus === "reconnecting" ? (
                <span role="status" aria-live="polite" aria-label={t("sync.reconnecting")}>
                  <span
                    data-testid="sync-status-dot"
                    className="absolute bottom-0 right-0 h-2 w-2 animate-pulse rounded-full bg-warning ring-2 ring-base-200"
                  />
                </span>
              ) : null}
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
            <li>
              <button
                type="button"
                data-testid="sidebar-sharing-overview"
                aria-label={t("sharing.navLabel")}
                onClick={() => setShowSharingOverview(true)}
              >
                <Share2 size={16} aria-hidden="true" />
                {t("sharing.navLabel")}
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
