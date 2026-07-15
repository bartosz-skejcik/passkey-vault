// App.tsx — the popup's top-level view-state switch (09-UI-SPEC.md's
// Popup shell section): loading -> server-config (first-run gate,
// highest priority) -> unlock (Sign-in or Unlock-only, per
// session.status) -> item-list (+ the enrollment prompt, top slot) ->
// item-detail. Exactly one view renders at a time -- the popup is
// single-view, no tabs.
//
import { useEffect, useState } from "react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import type { SessionStatus } from "../../lib/messaging/ext-protocol";
import type { VaultItem } from "../../lib/vault/types";
import { resolveLocale, t } from "../../lib/i18n/dictionary";
import ServerConfigView from "./ServerConfigView";
import UnlockView from "./UnlockView";
import EnrollExtPasskeyPrompt from "./EnrollExtPasskeyPrompt";
import ItemListView from "./ItemListView";
import ItemDetailView from "./ItemDetailView";

type UnlockableStatus = Extract<SessionStatus, { kind: "no-session" } | { kind: "locked" }>;

type ViewState =
  | { kind: "loading" }
  | { kind: "server-config" }
  | { kind: "unlock"; status: UnlockableStatus }
  | { kind: "list" }
  | { kind: "detail"; item: VaultItem };

export default function App() {
  const locale = resolveLocale();
  const [view, setView] = useState<ViewState>({ kind: "loading" });
  const [showEnrollPrompt, setShowEnrollPrompt] = useState(false);

  async function refreshFromScratch() {
    const config = await sendMessage({ kind: "config.get" });
    if (config === null) {
      setView({ kind: "server-config" });
      return;
    }
    await refreshSessionStatus();
  }

  async function refreshSessionStatus() {
    const status = await sendMessage({ kind: "session.status" });
    if (status.kind === "unlocked") {
      setView({ kind: "list" });
    } else {
      setView({ kind: "unlock", status });
    }
  }

  useEffect(() => {
    void refreshFromScratch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUnlocked(viaPassword: boolean) {
    const status = await sendMessage({ kind: "session.status" });
    if (status.kind !== "unlocked") {
      // Defensive fallback -- shouldn't happen (we just unlocked), but
      // never trust a stale view over what the background actually says.
      if (status.kind === "no-session" || status.kind === "locked") {
        setView({ kind: "unlock", status });
      }
      return;
    }
    const showPrompt =
      viaPassword &&
      !status.extPasskeyEnrolled &&
      !status.extPasskeyPromptSuppressed &&
      typeof window !== "undefined" &&
      window.PublicKeyCredential !== undefined;
    setShowEnrollPrompt(showPrompt);
    setView({ kind: "list" });
  }

  if (view.kind === "loading") {
    return (
      <div className="flex min-h-[200px] w-[380px] flex-col items-center justify-center gap-2 p-4">
        <span className="loading loading-spinner" aria-hidden="true" />
        <p className="text-base text-base-content/70">{t(locale, "loading.vault")}</p>
      </div>
    );
  }

  if (view.kind === "server-config") {
    return <ServerConfigView locale={locale} onConfigured={() => void refreshSessionStatus()} />;
  }

  if (view.kind === "unlock") {
    return <UnlockView locale={locale} status={view.status} onUnlocked={(viaPassword) => void handleUnlocked(viaPassword)} />;
  }

  if (view.kind === "detail") {
    return (
      <ItemDetailView locale={locale} item={view.item} onBack={() => setView({ kind: "list" })} />
    );
  }

  return (
    <div className="flex w-[380px] flex-col gap-2">
      {showEnrollPrompt ? (
        <div className="p-2">
          <EnrollExtPasskeyPrompt locale={locale} onDone={() => setShowEnrollPrompt(false)} />
        </div>
      ) : null}
      <ItemListView locale={locale} onSelectItem={(item) => setView({ kind: "detail", item })} />
    </div>
  );
}
