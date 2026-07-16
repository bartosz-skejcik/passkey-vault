// App.tsx — the popup's top-level view-state switch (09-UI-SPEC.md's
// Popup shell section): loading -> server-config (first-run gate,
// highest priority) -> unlock (Sign-in or Unlock-only, per
// session.status) -> item-list (+ the enrollment prompt, top slot) ->
// item-detail. Exactly one view renders at a time -- the popup is
// single-view, no tabs.
//
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
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
  // EXT-05 has two modes here, distinguished by `returnTo`: the FIRST-RUN
  // gate (`returnTo: null` -- no config exists, nowhere to back out to) and
  // RECONFIGURE (`returnTo` = the unlock status to restore on cancel),
  // reached from UnlockView's "Change server" link. `initialUrl` seeds the
  // field with the currently-persisted URL in the latter case.
  | { kind: "server-config"; initialUrl: string; returnTo: UnlockableStatus | null }
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
      // First-run gate: no config yet, so no seed and no way to cancel.
      setView({ kind: "server-config", initialUrl: "", returnTo: null });
      return;
    }
    await refreshSessionStatus();
  }

  /**
   * EXT-05's "editable later" re-entry (09-VERIFICATION.md gap 1). Seeds the
   * field with the CURRENTLY-persisted URL (read authoritatively from the
   * background, never from popup state) and remembers the unlock status to
   * restore if the user cancels.
   */
  async function handleChangeServer(status: UnlockableStatus) {
    const config = await sendMessage({ kind: "config.get" });
    setView({ kind: "server-config", initialUrl: config?.baseUrl ?? "", returnTo: status });
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

  // CR-01 fix (09-REVIEW.md): App.tsx is the ONE component mounted for
  // every view (unlike ItemListView's own `vault.updated` listener, which
  // is unmounted the instant the user is on ItemDetailView) -- so the
  // lock-state listener lives HERE, at the top level, not in any child
  // view. On a `session.locked` broadcast (fired by
  // vault-session.ts's lockVaultSession() -- auto-lock alarm or any other
  // caller), re-read the AUTHORITATIVE session.status and reset the view
  // accordingly, from ANY current view including `detail`. Resetting the
  // view unmounts ItemDetailView, which drops its decrypted (possibly
  // revealed) fields out of React state -- there is no other place that
  // plaintext is held once the view changes.
  useEffect(() => {
    function onLocked(message: unknown) {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { kind?: unknown }).kind === "session.locked"
      ) {
        setShowEnrollPrompt(false);
        void refreshSessionStatus();
      }
    }
    browser.runtime.onMessage.addListener(onLocked);
    return () => browser.runtime.onMessage.removeListener(onLocked);
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
    // 11-09 addendum, CORRECTED (regression report): back to its
    // pre-addendum natural height (min-h-[200px], not h-full) -- only the
    // item-LIST view needs a hard-pinned 600px shell; every other view,
    // including this one, keeps Chrome's own popup auto-sizing.
    return (
      <div className="flex min-h-[200px] w-[380px] flex-col items-center justify-center gap-2 p-4">
        <span className="loading loading-spinner" aria-hidden="true" />
        <p className="text-base text-base-content/70">{t(locale, "loading.vault")}</p>
      </div>
    );
  }

  if (view.kind === "server-config") {
    const returnTo = view.returnTo;
    return (
      <ServerConfigView
        locale={locale}
        initialUrl={view.initialUrl}
        onConfigured={() => void refreshSessionStatus()}
        // Undefined in first-run mode -- ServerConfigView renders no cancel
        // button at all without it, keeping that gate blocking.
        onCancel={returnTo === null ? undefined : () => setView({ kind: "unlock", status: returnTo })}
      />
    );
  }

  if (view.kind === "unlock") {
    const status = view.status;
    return (
      <UnlockView
        locale={locale}
        status={status}
        onUnlocked={(viaPassword) => void handleUnlocked(viaPassword)}
        onChangeServer={() => void handleChangeServer(status)}
      />
    );
  }

  if (view.kind === "detail") {
    return (
      <ItemDetailView locale={locale} item={view.item} onBack={() => setView({ kind: "list" })} />
    );
  }

  // 11-09 addendum (Bartek live-review, popup scroll-in-scroll), CORRECTED
  // after a regression report (the fixed height must NOT live on `body` --
  // that forced every other view to also render at 600px): `h-[600px]` is
  // now pinned LOCALLY, right here, only for the item-list state. This is
  // the ONE view that actually needs a hard-pinned shell (its internal
  // PINNED-header/ONE-scroll-region layout, see ItemListView.tsx); every
  // other view keeps Chrome's natural popup auto-sizing. The enroll-prompt
  // banner (when shown) is a normal, naturally-sized flex child above
  // ItemListView; ItemListView is handed whatever vertical space remains
  // within these fixed 600px (its own root is `flex-1 min-h-0`).
  return (
    <div className="flex h-[600px] w-[380px] flex-col gap-2 overflow-hidden">
      {showEnrollPrompt ? (
        <div className="p-2">
          <EnrollExtPasskeyPrompt locale={locale} onDone={() => setShowEnrollPrompt(false)} />
        </div>
      ) : null}
      <ItemListView locale={locale} onSelectItem={(item) => setView({ kind: "detail", item })} />
    </div>
  );
}
