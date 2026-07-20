// SignInView.tsx — the popup's signed-out (no-session) hero, AUTH-01.
//
// Bartek's decision (15-CONTEXT.md, verbatim): "Rób wszystko przez okno,
// jedyne co w popup to odblokowanie jeśli chodzi o auth i url servera." This
// view is deliberately minimal: a wordmark, one "Zaloguj się" button that
// opens the server-origin ceremony window (proven to carry full sign-in via
// EITHER password or passkey by Plan 15-01), and the same Server icon-button
// UnlockView.tsx's locked variant uses for reconfiguration. No email field,
// no password field, ever, in this view -- that is the literal AUTH-01
// success criterion.
//
// Thin message-dispatch layer only (D-05): never imports WASM bindings, the
// choke-point loader, or the web app's crypto module -- this component's
// only job is to open the ceremony window and react to its outcome.
import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { Server } from "lucide-react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import { t, type Locale } from "../../lib/i18n/dictionary";

export default function SignInView({
  locale,
  onSignedIn,
  onChangeServer,
}: {
  locale: Locale;
  onSignedIn: () => void;
  /** Same reconfigure entry point as UnlockView.tsx's locked variant --
   * one consistent server-config affordance across both auth surfaces. */
  onChangeServer: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  // Resolves the in-flight server ceremony from the background's
  // fire-and-forget broadcast -- mirrors UnlockView.tsx's own
  // onServerCeremonyState listener shape verbatim (same add/removeListener
  // cleanup). The popup may have been closed mid-ceremony -- in that case
  // this listener simply never fires here, and a fresh popup open re-derives
  // the correct state via the ordinary session.status read.
  useEffect(() => {
    function onServerCeremonyState(message: unknown) {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { kind?: unknown }).kind === "unlock.serverCeremony.state"
      ) {
        setBusy(false);
        const ok = (message as { ok?: unknown }).ok === true;
        if (ok) {
          onSignedIn();
        } else {
          setFailed(true);
        }
      }
    }
    browser.runtime.onMessage.addListener(onServerCeremonyState);
    return () => browser.runtime.onMessage.removeListener(onServerCeremonyState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSignIn() {
    setBusy(true);
    setFailed(false);
    try {
      const result = await sendMessage({ kind: "unlock.serverCeremony.start", mode: "signin" });
      if (!result.ok) {
        setBusy(false);
        setFailed(true);
      }
      // On ok:true, stay busy ("in-flight") -- the listener above resolves
      // it (signed in, or a calm failure line), never a wedge: the
      // background's own bounded timeout alarm eventually broadcasts
      // ok:false even if the ceremony window is simply abandoned.
    } catch {
      setBusy(false);
      setFailed(true);
    }
  }

  return (
    <div className="relative flex w-[380px] max-h-[600px] flex-col items-center justify-center gap-8 overflow-y-auto p-4">
      <button
        type="button"
        aria-label={t(locale, "config.changeServer")}
        onClick={onChangeServer}
        className="btn btn-ghost btn-square btn-sm absolute right-2 top-2"
      >
        <Server size={18} aria-hidden="true" />
      </button>

      <p className="text-center text-[20px] font-bold leading-[1.2]">{t(locale, "app.title")}</p>

      <button
        type="button"
        data-testid="server-ceremony-signin-button"
        className="btn btn-primary"
        disabled={busy}
        onClick={() => void handleSignIn()}
      >
        {busy ? t(locale, "unlock.serverCeremonyInFlight") : t(locale, "auth.loginSubmit")}
      </button>

      {failed ? (
        <p className="text-sm text-base-content/70">{t(locale, "unlock.serverCeremonySigninFailed")}</p>
      ) : null}
    </div>
  );
}
