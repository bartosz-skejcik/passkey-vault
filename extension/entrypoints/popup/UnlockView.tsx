// UnlockView.tsx — the popup's locked-view unlock card (AUTH-02),
// password-first with the passkey button promoted to its final treatment.
// Thin message-dispatch layer only (D-05): never imports the generated WASM
// bindings, their choke-point loader, or the web app's crypto module.
//
// Phase 15 (Plan 15-03): this component is now UNLOCK-ONLY -- App.tsx routes
// a no-session status to SignInView.tsx instead (the popup's own sign-in
// form no longer exists, AUTH-01). The ext-scoped PRF surface
// (navigator.credentials.get() against rpId === browser.runtime.id) is
// removed outright per AUTH-03 -- it stops being CALLED here; the
// underlying files/message kinds are deleted by Plan 15-04. The single
// passkey-unlock path on both browsers is the server-origin ceremony window
// (unlock.serverCeremony.start, mode:"unlock").
import { useEffect, useRef, useState, type FormEvent } from "react";
import { browser } from "wxt/browser";
import { Fingerprint, Loader2, Server } from "lucide-react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import type { SessionStatus } from "../../lib/messaging/ext-protocol";
import { bytesToB64 } from "../../lib/messaging/bytes-b64";
import { t, type Locale } from "../../lib/i18n/dictionary";

type LockedStatus = Extract<SessionStatus, { kind: "locked" }>;

export default function UnlockView({
  locale,
  status,
  onUnlocked,
  onChangeServer,
}: {
  locale: Locale;
  status: LockedStatus;
  onUnlocked: () => void;
  /** EXT-05's "editable later" re-entry -- see the icon-button at the top
   * of this view. */
  onChangeServer: () => void;
}) {
  const wasAutoLocked = status.wasAutoLocked;

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Plan 13-06: the server-origin ceremony's own busy/notice state.
  const [serverCeremonyBusy, setServerCeremonyBusy] = useState(false);
  const [serverCeremonyFailed, setServerCeremonyFailed] = useState(false);

  // Resolves the in-flight server ceremony from EITHER outcome: the
  // background's own fire-and-forget broadcast (mirrors session.locked's
  // shape/discipline, entrypoints/background/server-unlock.ts). The popup
  // may have been closed mid-ceremony -- in that case this listener simply
  // never fires here, and the unlocked state is still correct on reopen via
  // the ordinary session.status read (T-13-13: correctness never depends on
  // this broadcast being received).
  useEffect(() => {
    function onServerCeremonyState(message: unknown) {
      if (
        typeof message === "object" &&
        message !== null &&
        (message as { kind?: unknown }).kind === "unlock.serverCeremony.state"
      ) {
        setServerCeremonyBusy(false);
        const ok = (message as { ok?: unknown }).ok === true;
        if (ok) {
          onUnlocked();
        } else {
          setServerCeremonyFailed(true);
        }
      }
    }
    browser.runtime.onMessage.addListener(onServerCeremonyState);
    return () => browser.runtime.onMessage.removeListener(onServerCeremonyState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const passwordInputRef = useRef<HTMLInputElement>(null);

  async function handleServerCeremonyUnlock() {
    setServerCeremonyBusy(true);
    setServerCeremonyFailed(false);
    try {
      const result = await sendMessage({ kind: "unlock.serverCeremony.start", mode: "unlock" });
      if (!result.ok) {
        setServerCeremonyBusy(false);
        setServerCeremonyFailed(true);
      }
      // On ok:true, stay busy ("in-flight") -- the onServerCeremonyState
      // listener above resolves it (unlocked, or a calm failure line),
      // never a wedge (T-13-13): the background's own bounded timeout alarm
      // eventually broadcasts ok:false even if the ceremony window is
      // simply abandoned.
    } catch {
      setServerCeremonyBusy(false);
      setServerCeremonyFailed(true);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    setSubmitting(true);
    const passwordBytes = new TextEncoder().encode(password);
    // Post-UAT protocol fix: Chrome's MV3 sendMessage JSON-serializes the
    // payload, mangling a raw Uint8Array field into `{"0":..,"1":..}` --
    // encode to base64 (already JSON-safe) here, then zeroize the transient
    // source array immediately. The b64 string is an unavoidable,
    // equal-to-today exposure (it's the exact same bytes JSON.stringify
    // would otherwise have already serialized wholesale).
    const passwordB64 = bytesToB64(passwordBytes);
    passwordBytes.fill(0);
    try {
      const result = await sendMessage({ kind: "unlock.password", passwordB64 });
      if (result.ok) {
        onUnlocked();
      } else {
        setPasswordError(t(locale, "auth.loginFailed"));
      }
    } catch {
      setPasswordError(t(locale, "auth.loginFailed"));
    } finally {
      setPassword("");
      setSubmitting(false);
    }
  }

  // 11-09 addendum, CORRECTED (regression report -- this exact view was
  // Bartek's screenshot: a huge empty gap below "Change server" once
  // `h-full` pinned it to 600px). See ServerConfigView's identical
  // comment: `max-h-[600px] overflow-y-auto` lets Chrome auto-size this
  // short form to its natural height, only becoming a scroll region in
  // the rare case content exceeds the popup's own height cap.
  return (
    <div className="relative flex w-[380px] max-h-[600px] flex-col gap-4 overflow-y-auto p-4">
      <button
        type="button"
        aria-label={t(locale, "config.changeServer")}
        onClick={onChangeServer}
        className="btn btn-ghost btn-square btn-sm absolute right-2 top-2"
      >
        <Server size={18} aria-hidden="true" />
      </button>

      {wasAutoLocked ? (
        <p className="text-sm text-base-content/70">{t(locale, "unlock.sessionLockedNotice")}</p>
      ) : null}

      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor="pv-unlock-password" className="text-sm">
            {t(locale, "auth.passwordLabel")}
          </label>
          <input
            id="pv-unlock-password"
            ref={passwordInputRef}
            type="password"
            required
            autoFocus
            className="input input-bordered w-full font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {passwordError !== null ? <p className="text-sm text-error">{passwordError}</p> : null}

        <button type="submit" className="btn btn-primary w-full" disabled={submitting}>
          {t(locale, "unlock.submit")}
        </button>
      </form>

      <div className="divider">{t(locale, "unlock.orDivider")}</div>

      <button
        type="button"
        data-testid="server-ceremony-unlock-button"
        className="btn btn-accent w-full"
        disabled={serverCeremonyBusy}
        onClick={() => void handleServerCeremonyUnlock()}
      >
        <Fingerprint size={18} aria-hidden="true" />
        {serverCeremonyBusy
          ? t(locale, "unlock.serverCeremonyInFlight")
          : t(locale, "unlock.passkeyCta")}
        {serverCeremonyBusy ? (
          <Loader2 size={16} className="animate-spin" aria-hidden="true" />
        ) : null}
      </button>
      {serverCeremonyFailed ? (
        <p className="text-sm text-base-content/70">{t(locale, "unlock.serverCeremonyFailed")}</p>
      ) : null}
    </div>
  );
}
