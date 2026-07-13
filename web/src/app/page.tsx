"use client";

import { useEffect, useState } from "react";
import Sidebar, {
  AUTOLOCK_CHANGED_EVENT,
  AUTOLOCK_MINUTES_KEY,
  DEFAULT_AUTOLOCK_MINUTES,
} from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MainColumn from "@/components/shell/MainColumn";
import AuthCard from "@/components/auth/AuthCard";
import RegisterForm from "@/components/auth/RegisterForm";
import LoginForm from "@/components/auth/LoginForm";
import UnlockOverlay from "@/components/auth/UnlockOverlay";
import ItemList from "@/components/vault/ItemList";
import DetailPanel from "@/components/vault/DetailPanel";
import TypePicker from "@/components/vault/TypePicker";
import ItemForm from "@/components/vault/ItemForm";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { getSessionToken } from "@/lib/auth/session";
import { initCrypto, lockVault, useIsUnlocked } from "@/lib/crypto";
import { useIdleTimer } from "@/lib/idle/useIdleTimer";
import { useVaultItems } from "@/lib/vault/store";
import type { ItemType, VaultItem } from "@/lib/vault/types";

function readAutolockMinutes(): number {
  try {
    const stored = localStorage.getItem(AUTOLOCK_MINUTES_KEY);
    return stored !== null ? Number(stored) : Number(DEFAULT_AUTOLOCK_MINUTES);
  } catch {
    return Number(DEFAULT_AUTOLOCK_MINUTES);
  }
}

export default function Home() {
  const { t } = useLocale();
  const unlocked = useIsUnlocked();
  // `null` = not yet resolved (avoids a flash of the wrong screen before
  // this mount effect runs); `true`/`false` after resolving the stored
  // session token.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [autolockMinutes, setAutolockMinutes] = useState(Number(DEFAULT_AUTOLOCK_MINUTES));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingType, setCreatingType] = useState<ItemType | null>(null);
  const items = useVaultItems();

  function handleNewItem() {
    setSelectedItem(null);
    setCreating(true);
    setCreatingType(null);
  }

  function handleCreated() {
    setCreating(false);
    setCreatingType(null);
  }

  function closeSidePanel() {
    setSelectedItem(null);
    setCreating(false);
    setCreatingType(null);
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

  // lockVault() is idempotent when already locked (see crypto/index.ts),
  // so this is safe to keep running unconditionally rather than gating it
  // on `unlocked` — no extra branch, no risk of double-locking.
  useIdleTimer(autolockMinutes * 60_000, lockVault);

  if (authed === null) {
    return null;
  }

  if (!authed) {
    return mode === "login" ? (
      <AuthCard heading={t("auth.loginSubmit")}>
        <LoginForm onToggle={() => setMode("register")} />
      </AuthCard>
    ) : (
      <AuthCard heading={t("auth.registerSubmit")}>
        <RegisterForm onToggle={() => setMode("login")} />
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
          <Sidebar />
          <div className="flex flex-1 flex-col">
            <TopBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onNewItem={handleNewItem}
            />
            <div className="flex flex-1 overflow-hidden">
              <MainColumn showEmptyState={items.length === 0 && !creating}>
                <ItemList
                  searchQuery={searchQuery}
                  selectedItemId={selectedItem?.id ?? null}
                  onSelect={(item) => {
                    setCreating(false);
                    setCreatingType(null);
                    setSelectedItem(item);
                  }}
                />
              </MainColumn>
              {selectedItem ? (
                <DetailPanel item={selectedItem} onClose={closeSidePanel} />
              ) : null}
              {creating && creatingType === null ? (
                <aside className="flex w-full flex-col border-l border-base-300 bg-base-100 p-6 md:w-[400px] md:shrink-0">
                  <TypePicker onSelect={setCreatingType} />
                </aside>
              ) : null}
              {creating && creatingType !== null ? (
                <aside className="flex w-full flex-col overflow-y-auto border-l border-base-300 bg-base-100 p-6 md:w-[400px] md:shrink-0">
                  <ItemForm type={creatingType} onCreated={handleCreated} />
                </aside>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      <UnlockOverlay />
    </>
  );
}
