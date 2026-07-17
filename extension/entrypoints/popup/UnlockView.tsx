// UnlockView.tsx — password form + PRF button, thin message-dispatch
// layer only (D-05): never imports the generated WASM bindings, their
// choke-point loader, or the web app's crypto module. Two variants
// distinguished by `session.status`:
//   - Sign-in (status.kind === "no-session"): email + password, dispatches
//     auth.signIn.password. Mints a fresh session token.
//   - Unlock-only (status.kind === "locked"): password only, dispatches
//     unlock.password against the EXISTING token.
//
// AMENDMENT 2026-07-15 (extension-scoped PRF passkey, superseding this
// plan's original PRF-CTA wiring): `navigator.credentials.get()` from a
// `chrome-extension://` popup rejects every web RP ID and accepts ONLY
// `rpId === browser.runtime.id` -- so the popup can never run 09-04's
// web-RP PRF sign-in/unlock ceremonies (those message kinds stay dead
// from this component). This component therefore:
//   - dispatches `unlock.extPrf.start`/`unlock.extPrf.finish` (09-08) for
//     the Unlock-only variant's PRF button, gated on
//     `session.status`'s `extPasskeyEnrolled` field -- NEVER the web-RP
//     message pair mentioned above.
//   - renders NO PRF button in the Sign-in variant this phase (the
//     extension passkey is UNLOCK-ONLY; `unlock.passkeyLoginCta` stays in
//     the dictionary, unused, reserved for the web app / a future
//     options page).
//
// The ONE crypto-adjacent thing this component does -- calling
// `navigator.credentials.get()` -- passes its result through
// `extension/lib/passkeys/prf.ts`'s pure `extractPrfBytes` before ever
// calling `sendMessage`; the wrapping-key derivation/unwrap only ever
// happens in the background (ext-passkey.ts).
import { useRef, useState, type FormEvent } from "react";
import { browser } from "wxt/browser";
import { Fingerprint, Loader2 } from "lucide-react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import type { SessionStatus } from "../../lib/messaging/ext-protocol";
import { bytesToB64 } from "../../lib/messaging/bytes-b64";
import { buildExtGetOptions } from "../../lib/passkeys/ext-prf";
import { extractPrfBytes } from "../../lib/passkeys/prf";
import { t, type Locale } from "../../lib/i18n/dictionary";

type UnlockStatus = Extract<SessionStatus, { kind: "no-session" } | { kind: "locked" }>;

type PrfNotice = { kind: "orphaned" } | { kind: "failed" } | null;

/**
 * WebAuthn's `get()` still requires a challenge field even though this
 * recipient's server never verifies the ceremony (09-CONTEXT AMENDMENT:
 * the PRF output IS the secret, T-09-24's locked disposition) -- generated
 * locally, never fetched from the server, since `unlock.extPrf.start`
 * deliberately makes no network call (offline-friendly, storage.local is
 * the source per ext-passkey.ts's handleExtPrfUnlockStart).
 */
function randomChallengeB64(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export default function UnlockView({
  locale,
  status,
  onUnlocked,
  onChangeServer,
}: {
  locale: Locale;
  status: UnlockStatus;
  onUnlocked: (viaPassword: boolean) => void;
  /** EXT-05's "editable later" re-entry -- see the link at the foot of this view. */
  onChangeServer: () => void;
}) {
  const isSignIn = status.kind === "no-session";
  const wasAutoLocked = status.kind === "locked" ? status.wasAutoLocked : false;
  const extPasskeyEnrolledFromStatus = status.kind === "locked" ? status.extPasskeyEnrolled : false;

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [prfBusy, setPrfBusy] = useState(false);
  const [prfNotice, setPrfNotice] = useState<PrfNotice>(null);
  // Once a PRF unlock attempt proves the local credential is orphaned
  // (dev-ID change / deleted server row), stop offering the button for
  // the rest of this popup session -- the background has already cleared
  // its own stale meta record, so the NEXT `session.status` fetch (a
  // fresh popup open) will reflect `extPasskeyEnrolled: false` on its own.
  const [prfOrphanedThisSession, setPrfOrphanedThisSession] = useState(false);
  // D-12 (Bartek override): once a genuine (non-cancel) PRF-ceremony
  // failure has been OBSERVED this popup session -- either the get()
  // ceremony itself throwing something other than a user-cancel, or the
  // authenticator reporting no PRF result at all -- the PRF button flips
  // to visible-but-disabled with the neutral D-13 explainer alongside it,
  // for the rest of this popup's lifetime. Before that first observed
  // failure (support unknown), the button stays fully clickable: a first
  // attempt must always be possible.
  const [prfUnusableThisSession, setPrfUnusableThisSession] = useState(false);

  const webauthnSupported = typeof window !== "undefined" && window.PublicKeyCredential !== undefined;
  // Sign-in variant: NO PRF button this phase (AMENDMENT) -- the extension
  // passkey is unlock-only.
  const extPasskeyEnrolled = !isSignIn && extPasskeyEnrolledFromStatus && !prfOrphanedThisSession;
  const showPrfButton = extPasskeyEnrolled && webauthnSupported;
  // Not-enrolled is a normal state (no explainer) -- only render the
  // Tier-1 line when a passkey IS enrolled but this browser can't run it.
  const showTier1Explainer = extPasskeyEnrolled && !webauthnSupported;

  const passwordInputRef = useRef<HTMLInputElement>(null);

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
      const result = isSignIn
        ? await sendMessage({ kind: "auth.signIn.password", email, passwordB64 })
        : await sendMessage({ kind: "unlock.password", passwordB64 });
      if (result.ok) {
        onUnlocked(true);
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

  async function handlePrfUnlock() {
    setPrfBusy(true);
    setPrfNotice(null);
    try {
      const start = await sendMessage({ kind: "unlock.extPrf.start" });
      if ("notEnrolled" in start) {
        setPrfOrphanedThisSession(true);
        setPrfNotice({ kind: "orphaned" });
        passwordInputRef.current?.focus();
        return;
      }

      const options = buildExtGetOptions({
        rpId: browser.runtime.id,
        credentialIdB64url: start.credentialIdB64url,
        prfSaltB64: start.prfSaltB64,
        challengeB64: randomChallengeB64(),
      });

      let assertion: PublicKeyCredential;
      try {
        assertion = (await navigator.credentials.get(options)) as PublicKeyCredential;
      } catch (err) {
        if (err instanceof DOMException && err.name === "NotAllowedError") {
          // User-cancelled -- silently reset to idle without an alarming
          // error, mirroring web/src/components/auth/UnlockOverlay.tsx's
          // precedent. Support is still unknown; the button stays enabled.
          return;
        }
        // A genuine ceremony failure (SecurityError, NotSupportedError, ...)
        // -- honest D-03/D-13 degradation instead of the old silent
        // dead-end (T-13-05): the passkey fast-path is proven unusable
        // this session, so surface the neutral banner and flip the button
        // to disabled (D-12), never hidden.
        setPrfUnusableThisSession(true);
        return;
      }

      const prfBytes = extractPrfBytes(assertion);
      if (prfBytes === undefined) {
        // The ceremony succeeded but this authenticator didn't report a
        // PRF result -- an honest capability gap (T-13-05), not a hardware
        // error, so it gets the same neutral D-03/D-13 banner as the
        // catch-path above, not the alarming text-error styling.
        setPrfUnusableThisSession(true);
        return;
      }

      // Same JSON-transport-safety encode/zeroize discipline as the
      // password path above.
      const prfArray = new Uint8Array(prfBytes);
      const prfB64 = bytesToB64(prfArray);
      prfArray.fill(0);

      const finish = await sendMessage({
        kind: "unlock.extPrf.finish",
        credentialIdB64url: start.credentialIdB64url,
        prfB64,
      });

      if (finish.ok) {
        onUnlocked(false);
        return;
      }
      if (finish.error === "not-enrolled") {
        setPrfOrphanedThisSession(true);
        setPrfNotice({ kind: "orphaned" });
        passwordInputRef.current?.focus();
      } else {
        setPrfNotice({ kind: "failed" });
      }
    } finally {
      setPrfBusy(false);
    }
  }

  // 11-09 addendum, CORRECTED (regression report -- this exact view was
  // Bartek's screenshot: a huge empty gap below "Change server" once
  // `h-full` pinned it to 600px). See ServerConfigView's identical
  // comment: `max-h-[600px] overflow-y-auto` lets Chrome auto-size this
  // short form to its natural height, only becoming a scroll region in
  // the rare case content exceeds the popup's own height cap.
  return (
    <div className="flex w-[380px] max-h-[600px] flex-col gap-4 overflow-y-auto p-4">
      {wasAutoLocked ? (
        <p className="text-sm text-base-content/70">{t(locale, "unlock.sessionLockedNotice")}</p>
      ) : null}

      {isSignIn ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="pv-unlock-email" className="text-sm">
            {t(locale, "auth.emailLabel")}
          </label>
          <input
            id="pv-unlock-email"
            type="email"
            required
            className="input input-bordered w-full"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
      ) : null}

      {showPrfButton ? (
        <>
          <button
            type="button"
            className="btn btn-accent w-full"
            disabled={prfBusy || prfUnusableThisSession}
            onClick={() => void handlePrfUnlock()}
          >
            <span className="relative inline-flex">
              <Fingerprint size={18} aria-hidden="true" />
              {prfBusy ? (
                <Loader2 size={16} className="absolute -right-2 -top-2 animate-spin" aria-hidden="true" />
              ) : null}
            </span>
            {prfBusy ? t(locale, "unlock.passkeyBusy") : t(locale, "unlock.passkeyCta")}
          </button>
          {prfUnusableThisSession ? (
            <p className="text-sm text-base-content/70">{t(locale, "unlock.passkeyUnsupported")}</p>
          ) : null}
        </>
      ) : showTier1Explainer ? (
        <p className="text-sm text-base-content/70">{t(locale, "unlock.passkeyUnsupported")}</p>
      ) : null}

      {prfNotice?.kind === "orphaned" ? (
        <p className="text-sm text-base-content/70">{t(locale, "extPasskey.unlockOrphaned")}</p>
      ) : null}
      {prfNotice?.kind === "failed" ? (
        <p className="text-sm text-error">{t(locale, "unlock.passkeyFailed")}</p>
      ) : null}

      {showPrfButton || showTier1Explainer ? (
        <div className="divider">{t(locale, "unlock.orDivider")}</div>
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
            className="input input-bordered w-full font-mono"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {passwordError !== null ? <p className="text-sm text-error">{passwordError}</p> : null}

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {t(locale, "unlock.submit")}
        </button>
      </form>

      {/* EXT-05's "editable later" clause (09-VERIFICATION.md gap 1). This
          view is where a user with a wrong/moved server is actually stuck
          -- unlock fails and there was NO path back to the server config
          once one had been persisted, so a typo meant wiping extension
          storage or reinstalling. Deliberately discreet (a muted text
          link, below the primary action): reconfiguring is a rare
          recovery, not a routine control, and must never compete with
          Unlock. */}
      <button
        type="button"
        className="btn btn-link btn-xs self-center text-base-content/60 no-underline hover:underline"
        onClick={onChangeServer}
      >
        {t(locale, "config.changeServer")}
      </button>
    </div>
  );
}
