"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import {
  initCrypto,
  useIsUnlocked,
  setUnlockedUserKey,
  unwrapUserKey,
  deriveAuthMaterial,
  type WasmWrappingKey,
} from "@/lib/crypto";
import { prelogin, me, base64Decode, ApiClientError } from "@/lib/auth/api";
import {
  getSessionToken,
  clearSessionToken,
  clearStoredEmail,
  getStoredEmail,
} from "@/lib/auth/session";
import { takePendingUnlock } from "@/lib/auth/pendingUnlock";
import { takePrfUnavailableHint } from "@/lib/auth/prfUnavailable";
import { passkeyUnlock } from "@/lib/passkeys/login";
import PasskeyUnlockButton from "./PasskeyUnlockButton";

/**
 * Renders only when a session exists AND the vault is locked. The real
 * shell renders behind it (blurred, per UI-SPEC) — this component never
 * replaces the shell, it floats above it.
 *
 * Hard requirement (not cosmetic-only): the vault-data component tree must
 * only mount/receive data while unlocked. That gate lives at the page.tsx
 * level, not here — this component's own job is only the unlock affordance
 * and the blur/scrim visual signal.
 */
export default function UnlockOverlay() {
  const { t } = useLocale();
  const unlocked = useIsUnlocked();
  const sessionToken = getSessionToken();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Read once at mount — a second read would always return null (the
  // pending material is consumed on the first take), so this must not be
  // re-derived on every render.
  const [pending] = useState(() => takePendingUnlock());
  // Same take-once-at-mount idiom — a post-passkey-login "no PRF" landing
  // carries this flag from LoginForm's setPrfUnavailableHint().
  const [prfUnavailableAtMount] = useState(() => takePrfUnavailableHint());
  // Capability pre-check, once at mount.
  const [webauthnSupported] = useState(
    () => typeof window !== "undefined" && window.PublicKeyCredential !== undefined,
  );
  const [passkeyState, setPasskeyState] = useState<"idle" | "busy">("idle");
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  // A same-session passkeyUnlock() call resolving { prfUnavailable: true }
  // (404 pre-check OR post-ceremony null) must surface the SAME explainer
  // immediately, without requiring a page reload — this is distinct from
  // prfUnavailableAtMount, which only covers the LoginForm-then-reload
  // handoff case.
  const [unlockPrfUnavailable, setUnlockPrfUnavailable] = useState(false);
  const showPrfExplainer = prfUnavailableAtMount || unlockPrfUnavailable;

  if (sessionToken === null || unlocked) {
    return null;
  }

  async function handlePasskeyUnlock() {
    setPasskeyState("busy");
    setPasskeyError(null);
    try {
      // passkeyUnlock() itself silently no-ops on a NotAllowedError
      // (user-cancelled) ceremony — it never throws for that case, so this
      // catch block only ever sees a genuine failure.
      const result = await passkeyUnlock(() => {});
      if (result.prfUnavailable) {
        setUnlockPrfUnavailable(true);
      }
      // No onAuthed()-equivalent call here — useIsUnlocked()'s own
      // subscription (wired via setUnlockedUserKey inside passkeyUnlock
      // itself) is what re-renders the shell away from this overlay.
    } catch {
      setPasskeyError(t("unlock.passkeyFailed"));
    } finally {
      setPasskeyState("idle");
    }
  }

  async function unlockFromPending() {
    if (pending === null) return;
    setSubmitting(true);
    try {
      await initCrypto();
      const uk = unwrapUserKey(pending.wrappingKey, pending.pwWrappedUk);
      setUnlockedUserKey(uk);
    } catch {
      setError(t("auth.loginFailed"));
    } finally {
      pending.wrappingKey.free?.();
      setSubmitting(false);
    }
  }

  async function unlockFromPassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const passwordBytes = new TextEncoder().encode(password);
    let material: ReturnType<typeof deriveAuthMaterial> | undefined;
    let wrappingKey: WasmWrappingKey | undefined;

    try {
      // WASM musi być zainstancjonowane przed deriveAuthMaterial/unwrapUserKey.
      await initCrypto();
      const account = await me();
      const email = getStoredEmail() ?? account.email;
      const { kdf, salt } = await prelogin(email);
      const decodedSalt = base64Decode(salt);

      material = deriveAuthMaterial(passwordBytes, decodedSalt, JSON.stringify(kdf));
      wrappingKey = material.takeWrappingKey();

      const uk = unwrapUserKey(wrappingKey, account.pw_wrapped_uk);
      setUnlockedUserKey(uk);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        // Session actually expired — don't leave the user staring at a
        // dead unlock form for a session that no longer exists.
        clearSessionToken();
        clearStoredEmail();
        try {
          window.location.reload();
        } catch {
          // jsdom (unit tests) doesn't implement real navigation — a real
          // browser always supports reload().
        }
      } else {
        setError(t("auth.loginFailed"));
      }
    } finally {
      passwordBytes.fill(0);
      material?.free?.();
      wrappingKey?.free?.();
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-md bg-base-300/70">
      <div className="w-full max-w-[400px] rounded-box border border-base-300 bg-base-100 p-6">
        <h2 className="text-[20px] font-bold leading-[1.2]">{t("unlock.heading")}</h2>

        {pending !== null ? (
          <div className="mt-6 flex flex-col gap-4">
            <button
              type="button"
              data-testid="unlock-submit"
              className="btn btn-primary"
              disabled={submitting}
              onClick={unlockFromPending}
            >
              {t("unlock.submit")}
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            {webauthnSupported ? (
              <PasskeyUnlockButton
                label={passkeyState === "busy" ? t("unlock.passkeyBusy") : t("unlock.passkeyCta")}
                state={passkeyState}
                onClick={handlePasskeyUnlock}
                disabled={submitting}
              />
            ) : (
              <p className="text-sm text-base-content/70">{t("unlock.passkeyUnsupported")}</p>
            )}

            {passkeyError ? <p className="text-sm text-error">{passkeyError}</p> : null}

            {showPrfExplainer ? (
              <p className="text-sm text-base-content/70">
                {t("unlock.prfUnavailableExplainer")}
              </p>
            ) : null}

            <div className="divider">{t("unlock.orDivider")}</div>

            <form onSubmit={unlockFromPassword} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="unlock-password" className="text-sm">
                  {t("auth.passwordLabel")}
                </label>
                <input
                  id="unlock-password"
                  data-testid="unlock-password"
                  type="password"
                  required
                  autoFocus={showPrfExplainer}
                  className="input input-bordered w-full font-mono"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error ? <p className="text-sm text-error">{error}</p> : null}

              <button
                type="submit"
                data-testid="unlock-submit"
                className="btn btn-primary"
                disabled={submitting}
              >
                {t("unlock.submit")}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
