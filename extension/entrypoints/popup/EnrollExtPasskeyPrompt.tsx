// EnrollExtPasskeyPrompt.tsx — discreet post-password-unlock enrollment
// offer for the extension-scoped PRF passkey (AMENDMENT 2026-07-15,
// 09-08). Rendered by App.tsx at the top of the Item List view, at most
// once per unlock, ONLY after a password unlock (never after a PRF
// unlock), only when not enrolled, not suppressed, and
// `window.PublicKeyCredential` is defined.
//
// Two-ceremony shape (mirrors web/src/lib/passkeys/enroll.ts): a
// `create()` call first checks PRF *capability*
// (`getClientExtensionResults().prf?.enabled`) -- it does NOT yield usable
// PRF bytes itself. If the authenticator is PRF-capable, a SECOND `get()`
// ceremony (same credential, same salt) actually evaluates the PRF
// function and returns usable bytes. A PRF-incapable authenticator gets
// the honest-degradation message and `extPasskey.enroll.finish` is NEVER
// called for it (there is nothing to wrap).
import { useState } from "react";
import { browser } from "wxt/browser";
import { Fingerprint, Loader2 } from "lucide-react";
import { sendMessage } from "../../lib/messaging/ext-protocol";
import { bytesToB64 } from "../../lib/messaging/bytes-b64";
import { buildExtCreateOptions, buildExtGetOptions } from "../../lib/passkeys/ext-prf";
import { extractPrfBytes } from "../../lib/passkeys/prf";
import { t, type Locale } from "../../lib/i18n/dictionary";

function randomChallengeB64(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

type Phase = "idle" | "busy" | "no-prf" | "failed";

export default function EnrollExtPasskeyPrompt({
  locale,
  onDone,
}: {
  locale: Locale;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [dontAskAgain, setDontAskAgain] = useState(false);

  async function handleCreate() {
    setPhase("busy");
    try {
      const start = await sendMessage({ kind: "extPasskey.enroll.start" });
      if (!start.ok) {
        setPhase("failed");
        return;
      }

      const createOptions = buildExtCreateOptions({
        rpId: browser.runtime.id,
        accountEmail: start.accountEmail,
        userHandleB64: start.userHandleB64,
        challengeB64: start.challengeB64,
      });

      let created: PublicKeyCredential;
      try {
        created = (await navigator.credentials.create(createOptions)) as PublicKeyCredential;
      } catch {
        // User-cancelled or a genuine ceremony failure -- reset quietly,
        // same NotAllowedError precedent as UnlockView/web's enroll flow.
        setPhase("idle");
        return;
      }

      const capability = created.getClientExtensionResults() as { prf?: { enabled?: boolean } };
      if (!capability.prf?.enabled) {
        // Honest degradation (T-09-... class): create() succeeded but this
        // authenticator can't do PRF -- NEVER call enroll.finish, there is
        // nothing to wrap.
        setPhase("no-prf");
        return;
      }

      const getOptions = buildExtGetOptions({
        rpId: browser.runtime.id,
        credentialIdB64url: created.id,
        prfSaltB64: start.prfSaltB64,
        challengeB64: randomChallengeB64(),
      });

      let assertion: PublicKeyCredential;
      try {
        assertion = (await navigator.credentials.get(getOptions)) as PublicKeyCredential;
      } catch {
        setPhase("idle");
        return;
      }

      const prfBytes = extractPrfBytes(assertion);
      if (prfBytes === undefined) {
        setPhase("failed");
        return;
      }

      // Post-UAT protocol fix: encode to base64 (JSON-transport-safe over
      // Chrome's MV3 sendMessage), then zeroize the transient source array
      // immediately -- same discipline as UnlockView.tsx's PRF-finish path.
      const prfArray = new Uint8Array(prfBytes);
      const prfB64 = bytesToB64(prfArray);
      prfArray.fill(0);

      const finish = await sendMessage({
        kind: "extPasskey.enroll.finish",
        credentialIdB64url: created.id,
        prfSaltB64: start.prfSaltB64,
        prfB64,
      });

      if (finish.ok) {
        onDone();
      } else {
        setPhase("failed");
      }
    } catch {
      setPhase("failed");
    }
  }

  function handleSkip() {
    onDone();
  }

  // Ticking the box records the PREFERENCE only — it must never dismiss the
  // card (Bartek, live test): a checkbox that also closes the surface it
  // lives on is a trap, and it stole the chance to tick-then-still-enrol.
  // Dismissal stays an explicit act: "Not now" (handleSkip) or a completed
  // enrollment. The suppression is already persisted here, so whichever way
  // the card is dismissed afterwards, the prompt stays gone.
  function handleDontAskAgainChange(checked: boolean) {
    setDontAskAgain(checked);
    void sendMessage({ kind: "extPasskey.suppressPrompt", suppress: checked });
  }

  return (
    <div className="flex w-[380px] flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4">
      <h3 className="text-base font-bold">{t(locale, "extPasskey.promptTitle")}</h3>
      <p className="text-sm text-base-content/70">{t(locale, "extPasskey.promptBody")}</p>

      {phase === "no-prf" ? (
        <p className="text-sm text-base-content/70">{t(locale, "extPasskey.enrollNoPrf")}</p>
      ) : null}
      {phase === "failed" ? (
        <p className="text-sm text-error">{t(locale, "extPasskey.enrollFailed")}</p>
      ) : null}

      <button
        type="button"
        className="btn btn-accent"
        disabled={phase === "busy"}
        onClick={() => void handleCreate()}
      >
        <span className="relative inline-flex">
          <Fingerprint size={18} aria-hidden="true" />
          {phase === "busy" ? (
            <Loader2 size={16} className="absolute -right-2 -top-2 animate-spin" aria-hidden="true" />
          ) : null}
        </span>
        {phase === "busy" ? t(locale, "unlock.passkeyBusy") : t(locale, "extPasskey.promptCta")}
      </button>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-base-content/70">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={dontAskAgain}
            onChange={(e) => handleDontAskAgainChange(e.target.checked)}
          />
          {t(locale, "extPasskey.promptDontAskAgain")}
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={handleSkip}>
          {t(locale, "extPasskey.promptSkip")}
        </button>
      </div>
    </div>
  );
}
