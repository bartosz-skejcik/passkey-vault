"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MainColumn from "@/components/shell/MainColumn";
import AuthCard from "@/components/auth/AuthCard";
import RegisterForm from "@/components/auth/RegisterForm";
import LoginForm from "@/components/auth/LoginForm";
import UnlockOverlay from "@/components/auth/UnlockOverlay";
import ExtUnlockBridge from "@/components/auth/ExtUnlockBridge";
import ItemList from "@/components/vault/ItemList";
import DetailPanel from "@/components/vault/DetailPanel";
import TypePicker from "@/components/vault/TypePicker";
import ItemForm from "@/components/vault/ItemForm";
import CopyToast from "@/components/vault/CopyToast";
import ErrorToast from "@/components/vault/ErrorToast";
import SettingsPanel from "@/components/settings/SettingsPanel";
import OnboardingWizard from "@/components/onboarding/OnboardingWizard";
import { isOnboardingComplete } from "@/lib/onboarding/flag";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { getSessionToken } from "@/lib/auth/session";
import { initCrypto, lockVault, useIsUnlocked } from "@/lib/crypto";
import { useIdleTimer } from "@/lib/idle/useIdleTimer";
import {
  AUTOLOCK_CHANGED_EVENT,
  DEFAULT_AUTOLOCK_MINUTES,
  readAutolockMinutes,
} from "@/lib/idle/autolock";
import { useVaultItems } from "@/lib/vault/store";
import { wasRemotelyDeleted } from "@/lib/vault/remoteDelete";
import { showErrorToast } from "@/lib/vault/errorToast";
import { readSortPreference, writeSortPreference, type SortOption } from "@/lib/vault/sort";
import type { ItemType, VaultFilter, VaultItem } from "@/lib/vault/types";

// Post-UAT (Bartek 2026-07-15): the popup's in-popup type menu passes its
// chosen type via `?type=<id>` -- validated against this list before ever
// being trusted as a `creatingType` (an unrecognized/tampered value falls
// back to the normal TypePicker step rather than being passed through).
const VALID_ITEM_TYPES: ItemType[] = ["login", "card", "identity", "note", "totp"];

/** Popup deep-link intent, resolved once at mount from the URL's query
 * params (Plan 09-06's `panel=settings` / `action=new-item`, extended
 * post-UAT with `action=new-item`'s optional `type=<id>`). */
type PendingUrlAction = { kind: "settings" } | { kind: "new-item"; type: ItemType | null } | null;

export default function Home() {
  const { t } = useLocale();
  const unlocked = useIsUnlocked();
  // `null` = not yet resolved (avoids a flash of the wrong screen before
  // this mount effect runs); `true`/`false` after resolving the stored
  // session token.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  // UI-04: shown only immediately after a successful RegisterForm submit
  // (never after LoginForm's), gated by the per-browser
  // pv-onboarding-complete localStorage flag. See RegisterForm's onAuthed
  // wiring below — LoginForm's onAuthed is intentionally left untouched.
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [autolockMinutes, setAutolockMinutes] = useState(Number(DEFAULT_AUTOLOCK_MINUTES));
  const [searchQuery, setSearchQuery] = useState("");
  // Track only the id, not the full VaultItem object — deriving the live
  // item from useVaultItems() below means DetailPanel always sees fresh
  // post-edit/post-delete data instead of a stale snapshot captured at
  // selection time (a stale snapshot would silently hide a successful
  // edit's own effect, or keep a deleted item's panel open).
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  // Whether the currently-selected item's panel should open straight into
  // edit mode — set by ItemContextMenu's "Edit" action (via
  // handleEditRequest) and cleared by every plain row click (via
  // handleSelectItem), so re-selecting the same item afterwards falls back
  // to view mode (gap-review WR-01).
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creatingType, setCreatingType] = useState<ItemType | null>(null);
  const [filter, setFilter] = useState<VaultFilter>({ kind: "all" });
  // NordPass-style last-used sort control (quick-260717) — persisted in
  // localStorage (lib/vault/sort.ts), read once at mount; `readSortPreference`
  // itself tolerates a window-less environment and defaults to "lastUsed".
  const [sortBy, setSortBy] = useState<SortOption>(() => readSortPreference());
  function handleSortChange(next: SortOption) {
    setSortBy(next);
    writeSortPreference(next);
  }
  // Settings (UI-05) shares the same z-40 drawer + z-30 scrim slot as the
  // vault item panels below — they're mutually exclusive, not stacked.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Plan 09-06: receiving end of the popup's header-gear/"+" redirects
  // (`?panel=settings` / `?action=new-item`). Read ONCE at mount (a
  // second read would always see the already-stripped URL) — captured via
  // `window.location.search` directly rather than next/navigation's
  // `useSearchParams` (this app is `output: "export"`/client-rendered
  // throughout with no existing use of that hook, and a plain
  // `URLSearchParams` read avoids that hook's Suspense-boundary
  // requirement for no functional gain here).
  const [pendingUrlAction, setPendingUrlAction] = useState<PendingUrlAction>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    if (params.get("panel") === "settings") return { kind: "settings" };
    if (params.get("action") === "new-item") {
      const rawType = params.get("type");
      const type = VALID_ITEM_TYPES.includes(rawType as ItemType) ? (rawType as ItemType) : null;
      return { kind: "new-item", type };
    }
    return null;
  });
  // Plan 13-06: the extension opens a small popup window at
  // `?pv-ext-unlock=<nonce>` (a DIFFERENT flow from the popup's `?panel=`/
  // `?action=` deep links above -- read once at mount, same idiom). When
  // present, ExtUnlockBridge takes over the ENTIRE page below, bypassing the
  // normal authed/register/vault flow -- it does not require the web app's
  // own vault to be unlocked (or even the popup register/login flow to have
  // been reached yet beyond having a session token), and it must never
  // mount the vault-data component tree.
  const [extUnlockNonce] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("pv-ext-unlock");
  });
  const items = useVaultItems();
  const selectedItem = items.find((item) => item.id === selectedItemId) ?? null;
  // Any side panel being open means the overlay drawer + scrim render.
  const sidePanelOpen = selectedItem !== null || creating || settingsOpen;

  function handleNewItem(presetType: ItemType | null = null) {
    setSelectedItemId(null);
    setOpenInEditMode(false);
    setCreating(true);
    setCreatingType(presetType);
    setSettingsOpen(false);
  }

  function handleCreated() {
    setCreating(false);
    setCreatingType(null);
  }

  function closeSidePanel() {
    setSelectedItemId(null);
    setOpenInEditMode(false);
    setCreating(false);
    setCreatingType(null);
    setSettingsOpen(false);
  }

  function handleSelectItem(item: VaultItem) {
    setCreating(false);
    setCreatingType(null);
    setOpenInEditMode(false);
    setSelectedItemId(item.id);
    setSettingsOpen(false);
  }

  function handleEditRequest(item: VaultItem) {
    setCreating(false);
    setCreatingType(null);
    setOpenInEditMode(true);
    setSelectedItemId(item.id);
    setSettingsOpen(false);
  }

  function handleOpenSettings() {
    // Settings and the vault item drawer share the same z-40 slot — close
    // any open item panel first so they're never stacked.
    setSelectedItemId(null);
    setOpenInEditMode(false);
    setCreating(false);
    setCreatingType(null);
    setSettingsOpen(true);
  }

  useEffect(() => {
    // Rozgrzewka WASM przy starcie — fire-and-forget; każde faktyczne użycie
    // krypto i tak awaituje initCrypto() (memoizowany singleton), więc błąd
    // instancjacji ujawni się tam, nie tutaj.
    void initCrypto().catch(() => {});
    setAuthed(getSessionToken() !== null);
    setAutolockMinutes(readAutolockMinutes());

    function onAutolockChanged() {
      setAutolockMinutes(readAutolockMinutes());
    }
    window.addEventListener(AUTOLOCK_CHANGED_EVENT, onAutolockChanged);
    return () => window.removeEventListener(AUTOLOCK_CHANGED_EVENT, onAutolockChanged);
  }, []);

  // Plan 09-06: applies the popup's pending deep-link action once the
  // vault is unlocked (immediately, if already unlocked at mount; on the
  // render after unlock completes, otherwise), then strips the query
  // param via history.replaceState so a refresh doesn't re-trigger it.
  useEffect(() => {
    if (pendingUrlAction === null || !unlocked) {
      return;
    }
    if (pendingUrlAction.kind === "settings") {
      handleOpenSettings();
    } else {
      handleNewItem(pendingUrlAction.type);
    }
    setPendingUrlAction(null);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("panel");
      url.searchParams.delete("action");
      url.searchParams.delete("type");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    } catch {
      // A test/runtime environment without full URL/History support --
      // the in-memory view already applied; a stale query param surviving
      // a refresh is a cosmetic gap, not a functional one.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingUrlAction, unlocked]);

  // Remote-delete-while-viewing (SYNC-03): a background sync merge that
  // drops the currently-selected item's id from the live `items` array
  // closes the panel and shows a calm info toast — clearing selectedItemId
  // on the same tick removes the triggering condition, so this fires
  // exactly once per remote-delete event.
  useEffect(() => {
    if (wasRemotelyDeleted(selectedItemId, selectedItem)) {
      showErrorToast(t("sync.itemDeletedElsewhere"), { variant: "info" });
      setSelectedItemId(null);
      setOpenInEditMode(false);
    }
  }, [selectedItemId, selectedItem, t]);

  // lockVault() is idempotent when already locked (see crypto/index.ts),
  // so this is safe to keep running unconditionally rather than gating it
  // on `unlocked` — no extra branch, no risk of double-locking.
  useIdleTimer(autolockMinutes * 60_000, lockVault);

  if (extUnlockNonce !== null) {
    return <ExtUnlockBridge nonce={extUnlockNonce} />;
  }

  if (authed === null) {
    return null;
  }

  if (!authed) {
    return mode === "login" ? (
      <AuthCard heading={t("auth.loginSubmit")}>
        <LoginForm onToggle={() => setMode("register")} onAuthed={() => setAuthed(true)} />
      </AuthCard>
    ) : (
      <AuthCard heading={t("auth.registerSubmit")}>
        <RegisterForm
          onToggle={() => setMode("login")}
          onAuthed={() => {
            setAuthed(true);
            if (!isOnboardingComplete()) setShowOnboarding(true);
          }}
        />
      </AuthCard>
    );
  }

  return (
    <>
      {/* Hard requirement, not cosmetic-only (T-02-14): MainColumn's
          data-bearing children are only mounted while unlocked. blur-md
          is cosmetic reinforcement on top of that — the real protection
          is "no data in the render tree" below. */}
      <div className={!unlocked ? "blur-md" : undefined}>
        <div className="flex h-screen flex-col md:flex-row">
          <Sidebar activeFilter={filter} onFilterChange={setFilter} onOpenSettings={handleOpenSettings} />
          <div className="flex flex-1 flex-col">
            <TopBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onNewItem={() => handleNewItem()}
            />
            {/* The item list keeps its full width whether or not a side
                panel is open — DetailPanel/TypePicker/ItemForm float OVER
                it as a fixed-position overlay drawer (user-requested UAT
                fix) rather than rendering as a flex sibling that narrowed
                the list. */}
            <div className="relative flex flex-1 overflow-hidden">
              <MainColumn
                showEmptyState={items.length === 0 && !creating}
                filter={filter}
                sortBy={sortBy}
                onSortChange={handleSortChange}
              >
                <ItemList
                  searchQuery={searchQuery}
                  filter={filter}
                  sortBy={sortBy}
                  selectedItemId={selectedItem?.id ?? null}
                  onSelect={handleSelectItem}
                  onEditRequest={handleEditRequest}
                />
              </MainColumn>

              {/* Click-outside scrim — sits below the drawer's z-40 (and
                  well below UnlockOverlay's z-50), above the main column. */}
              {sidePanelOpen ? (
                <div
                  data-testid="side-panel-scrim"
                  className="fixed inset-0 z-30 bg-base-300/40"
                  onClick={closeSidePanel}
                  aria-hidden="true"
                />
              ) : null}

              {selectedItem ? (
                <DetailPanel
                  item={selectedItem}
                  initialMode={openInEditMode ? "edit" : "view"}
                  onClose={closeSidePanel}
                />
              ) : null}
              {creating && creatingType === null ? (
                <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col gap-4 overflow-y-auto border-l border-base-300 bg-base-100 p-6 shadow-xl md:w-[400px]">
                  <div className="flex items-start justify-end">
                    <button
                      type="button"
                      data-testid="type-picker-close"
                      aria-label={t("aria.closePanel")}
                      className="btn btn-ghost btn-square btn-sm"
                      onClick={closeSidePanel}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <TypePicker onSelect={setCreatingType} />
                </aside>
              ) : null}
              {creating && creatingType !== null ? (
                <aside className="fixed inset-y-0 right-0 z-40 flex w-full flex-col gap-4 overflow-y-auto border-l border-base-300 bg-base-100 p-6 shadow-xl md:w-[400px]">
                  <div className="flex items-start justify-end">
                    <button
                      type="button"
                      data-testid="item-form-panel-close"
                      aria-label={t("aria.closePanel")}
                      className="btn btn-ghost btn-square btn-sm"
                      onClick={closeSidePanel}
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  </div>
                  <ItemForm type={creatingType} onCreated={handleCreated} />
                </aside>
              ) : null}
              {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
            </div>
          </div>
        </div>
      </div>
      <CopyToast />
      <ErrorToast />
      <UnlockOverlay />
      {showOnboarding ? <OnboardingWizard onFinish={() => setShowOnboarding(false)} /> : null}
    </>
  );
}
