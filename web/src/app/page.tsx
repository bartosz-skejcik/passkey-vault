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
import InviteLandingView from "@/components/invite/InviteLandingView";
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
  // Plan 24-06: the invitee's `/invite/{id}#<secret>` landing, resolved once
  // at mount from `location.pathname` + `location.hash` -- the SAME idiom as
  // `extUnlockNonce` immediately below, and checked BEFORE it (an invite
  // link must work regardless of any other deep-link/auth state). Unlike
  // `extUnlockNonce` (which never hands control back -- ExtUnlockBridge just
  // closes its own popup window), this DOES need a setter: `handleInviteDone`
  // clears it once redemption completes so the normal authed/vault branches
  // take over on the next render (24-UI-SPEC.md Phase-Specific Notes §0).
  const [invite, setInvite] = useState<{ inviteId: string; inviteSecret: string } | null>(() => {
    if (typeof window === "undefined") return null;
    const m = window.location.pathname.match(/^\/invite\/([^/]+)\/?$/);
    if (m === null) return null;
    // Plan 24-08 gap-fix: a `/invite/{id}` path with NO fragment at all (a
    // stripped/malformed link -- e.g. a URL shortener or a browser-history
    // entry that dropped the fragment) must still resolve to the invite
    // view, not silently fall through to the normal login/vault screen --
    // the ORIGINAL `m && secret` condition below treated a missing fragment
    // as "not an invite route at all", which contradicts Amendment 2's own
    // point that `invite_id` alone must never look any different from a
    // genuinely invalid link. `inviteSecret` may be `""` here;
    // InviteLandingView's own `fetchInviteMetadataFlow` throws cleanly on an
    // empty/invalid secret (`WasmInviteChannel::fromSecret` returns a
    // JS-catchable `Result<_, JsValue>`, never a raw panic), which its
    // existing catch block already routes to the SAME unified failure state
    // every other cause uses.
    const secret = window.location.hash.slice(1);
    return { inviteId: m[1], inviteSecret: secret };
  });
  const [extUnlockNonce] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("pv-ext-unlock");
  });
  // Plan 13-07 (Bartek mandate, full SIGN-IN): the extension's
  // startServerUnlock() (server-unlock.ts) appends `&pv-mode=<mode>` to the
  // ceremony URL as a HINT for which ExtUnlockBridge surface to render --
  // this is NOT the security-authoritative mode (that lives in the
  // background's own pending record, re-validated at completeServerUnlock
  // time, T-13-16); an unrecognized/missing value defaults to 'unlock'
  // (13-06's original, narrower surface), never 'signin'.
  const [extUnlockMode] = useState<"signin" | "unlock">(() => {
    if (typeof window === "undefined") return "unlock";
    return new URLSearchParams(window.location.search).get("pv-mode") === "signin" ? "signin" : "unlock";
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

  // Plan 24-06: InviteLandingView's own onDone -- called only after a
  // genuinely successful (new-or-already-member) redemption, so a session
  // necessarily exists by this point (either pre-existing, or created by the
  // invite view's own inline register/login sub-flow). `setAuthed(true)`
  // is required here because this component's `authed` state was resolved
  // ONCE at mount (before any inline registration could have happened) and
  // is never re-read from storage afterwards.
  //
  // Known gap (documented, not silently dropped): 24-UI-SPEC.md §3 asks for
  // the newly-shared collection to be pre-selected via `filter` when
  // `selectCollectionId` is non-null. `VaultFilter` (packages/pv-ui/vault/
  // types.ts) has no "collection" variant today -- it only ever offers
  // `all`/`folder`/`tag`/`itemType`, and no decrypted item field carries a
  // `collectionId` for such a filter to match against (only `folderId`,
  // pv-ui/vault/types.ts). Fabricating a `{kind:"collection"}` filter here
  // without wiring ItemList's/Sidebar's matching logic would render an
  // empty list for a real shared collection -- actively misleading, worse
  // than the honest no-op below. Wiring a real collection filter is a
  // cross-package UI feature (ItemList/Sidebar/pv-ui) outside this plan's
  // file scope; `selectCollectionId` is accepted (never re-fetched, per the
  // plan's own contract) and intentionally not acted upon until that
  // surface exists. The member still lands in their normal, already-synced
  // vault, where the shared items are present (just not pre-filtered).
  function handleInviteDone({
    selectCollectionId: _selectCollectionId,
  }: {
    selectCollectionId: string | null;
  }) {
    setAuthed(true);
    // Hash hygiene (24-UI-SPEC.md §0): only safe to strip the invite's own
    // path+fragment down to the bare origin AFTER a successful-or-already-
    // consumed redemption, never before -- the secret must survive the
    // inline-register round trip while InviteLandingView stays mounted.
    try {
      window.history.replaceState({}, "", window.location.origin + "/");
    } catch {
      // A test/runtime environment without full History support -- the
      // in-memory view already advances past the invite view below.
    }
    setInvite(null);
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

  if (invite !== null) {
    return (
      <InviteLandingView
        inviteId={invite.inviteId}
        inviteSecret={invite.inviteSecret}
        onDone={handleInviteDone}
      />
    );
  }

  if (extUnlockNonce !== null) {
    return <ExtUnlockBridge nonce={extUnlockNonce} mode={extUnlockMode} />;
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
