"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { initCrypto, deriveAuthMaterial, type WasmWrappingKey } from "@/lib/crypto";
import { prelogin, login, base64Encode, base64Decode, ApiClientError } from "@/lib/auth/api";
import { setSessionToken, setStoredEmail, getStoredEmail } from "@/lib/auth/session";
import { setPendingUnlock } from "@/lib/auth/pendingUnlock";
import { passkeyLogin } from "@/lib/passkeys/login";
import PasskeyUnlockButton from "./PasskeyUnlockButton";

export default function LoginForm({
  onToggle,
  onAuthed,
}: {
  onToggle: () => void;
  onAuthed?: () => void;
}) {
  const { t } = useLocale();
  const [email, setEmail] = useState(() => getStoredEmail() ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Capability pre-check, once at mount — the caller (this component), not
  // PasskeyUnlockButton, decides whether to mount the button at all.
  const [webauthnSupported] = useState(
    () => typeof window !== "undefined" && window.PublicKeyCredential !== undefined,
  );
  const [passkeyState, setPasskeyState] = useState<"idle" | "busy">("idle");
  const [passkeyError, setPasskeyError] = useState<string | null>(null);

  async function handlePasskeyLogin() {
    if (email.trim() === "") return;
    setPasskeyState("busy");
    setPasskeyError(null);
    try {
      // passkeyLogin() nie rzuca przy NotAllowedError (anulowanie) — wraca
      // z cancelled: true i ŻADNA sesja wtedy nie istnieje. onAuthed tylko
      // przy prawdziwym sukcesie, inaczej page.tsx renderuje vault bez
      // sesji (bug z UAT 04-03 krok 8).
      const { cancelled } = await passkeyLogin(email, () => {});
      if (!cancelled) onAuthed?.();
    } catch {
      setPasskeyError(t("unlock.passkeyFailed"));
    } finally {
      setPasskeyState("idle");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const passwordBytes = new TextEncoder().encode(password);
    let material: ReturnType<typeof deriveAuthMaterial> | undefined;
    let wrappingKey: WasmWrappingKey | undefined;

    try {
      // WASM musi być zainstancjonowane przed pierwszym wywołaniem krypto.
      await initCrypto();
      const { kdf, salt } = await prelogin(email);
      const decodedSalt = base64Decode(salt);

      material = deriveAuthMaterial(passwordBytes, decodedSalt, JSON.stringify(kdf));
      const authHash = material.takeAuthHash();
      wrappingKey = material.takeWrappingKey();

      const { session_token, pw_wrapped_uk } = await login({
        email,
        auth_hash: base64Encode(authHash),
      });

      setSessionToken(session_token);
      setStoredEmail(email);
      // Never unwraps directly here — that stays UnlockOverlay's job, so
      // the visibly-distinct unlock step is preserved.
      setPendingUnlock(wrappingKey, pw_wrapped_uk);
      wrappingKey = undefined; // ownership transferred to pendingUnlock
      // Poinformuj rodzica (page.tsx), że sesja istnieje — bez tego jego
      // `authed` zostaje przy wartości z mounta i UI nigdzie nie przechodzi.
      onAuthed?.();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setError(t("auth.wrongCredentials"));
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="login-email" className="text-sm">
          {t("auth.emailLabel")}
        </label>
        <input
          id="login-email"
          data-testid="login-email"
          type="email"
          required
          className="input input-bordered w-full"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {webauthnSupported ? (
        <PasskeyUnlockButton
          label={passkeyState === "busy" ? t("unlock.passkeyBusy") : t("unlock.passkeyLoginCta")}
          state={passkeyState}
          onClick={handlePasskeyLogin}
          disabled={submitting}
        />
      ) : (
        <p className="text-sm text-base-content/70">{t("unlock.passkeyUnsupported")}</p>
      )}

      {passkeyError ? <p className="text-sm text-error">{passkeyError}</p> : null}

      <div className="divider">{t("unlock.orDivider")}</div>

      <div className="flex flex-col gap-1">
        <label htmlFor="login-password" className="text-sm">
          {t("auth.passwordLabel")}
        </label>
        <input
          id="login-password"
          data-testid="login-password"
          type="password"
          required
          className="input input-bordered w-full font-mono"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-error">{error}</p> : null}

      <button
        type="submit"
        data-testid="login-submit"
        className="btn btn-primary"
        disabled={submitting}
      >
        {t("auth.loginSubmit")}
      </button>

      <button type="button" className="link link-secondary text-sm" onClick={onToggle}>
        {t("auth.toggleToRegister")}
      </button>
    </form>
  );
}
