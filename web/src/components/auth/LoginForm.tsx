"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { initCrypto, deriveAuthMaterial } from "@/lib/crypto";
import { prelogin, login, base64Encode, base64Decode, ApiClientError } from "@/lib/auth/api";
import { setSessionToken, setStoredEmail } from "@/lib/auth/session";
import { setPendingUnlock } from "@/lib/auth/pendingUnlock";

export default function LoginForm({ onToggle }: { onToggle: () => void }) {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const passwordBytes = new TextEncoder().encode(password);
    let material: ReturnType<typeof deriveAuthMaterial> | undefined;

    try {
      // WASM musi być zainstancjonowane przed pierwszym wywołaniem krypto.
      await initCrypto();
      const { kdf, salt } = await prelogin(email);
      const decodedSalt = base64Decode(salt);

      material = deriveAuthMaterial(passwordBytes, decodedSalt, JSON.stringify(kdf));
      const authHash = material.takeAuthHash();
      const wrappingKey = material.takeWrappingKey();

      const { session_token, pw_wrapped_uk } = await login({
        email,
        auth_hash: base64Encode(authHash),
      });

      setSessionToken(session_token);
      setStoredEmail(email);
      // Never unwraps directly here — that stays UnlockOverlay's job, so
      // the visibly-distinct unlock step is preserved.
      setPendingUnlock(wrappingKey, pw_wrapped_uk);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 401) {
        setError(t("auth.wrongCredentials"));
      } else {
        setError(t("auth.loginFailed"));
      }
    } finally {
      passwordBytes.fill(0);
      material?.free?.();
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
