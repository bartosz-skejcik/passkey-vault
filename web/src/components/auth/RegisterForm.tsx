"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { scorePasswordMeter, type MeterColor } from "@/lib/generator/strength";
import {
  initCrypto,
  deriveAuthMaterial,
  generateUserKey,
  randomSalt,
  defaultKdfParamsJson,
  wrapUserKey,
  setUnlockedUserKey,
  type WasmWrappingKey,
  type WasmUserKey,
} from "@/lib/crypto";
import { register, login, base64Encode, ApiClientError } from "@/lib/auth/api";
import { setSessionToken, setStoredEmail } from "@/lib/auth/session";
import { publishOnUnlock } from "@/lib/identity/publishOnUnlock";

export default function RegisterForm({
  onToggle,
  onAuthed,
  submitLabel,
}: {
  onToggle: () => void;
  onAuthed?: () => void;
  // Plan 24-06: overrides the submit button's copy for the invite-landing
  // "register and join" flow (invite.registerAndJoinCta) without touching
  // this form's own internal logic. Absent -> zero behavior change for the
  // normal `/` auth screen (falls back to auth.registerSubmit, unchanged).
  submitLabel?: string;
}) {
  const { t } = useLocale();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mismatchError, setMismatchError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const meter = scorePasswordMeter(password);
  // Statyczna mapa zamiast `bg-${...}` — Tailwind generuje tylko klasy,
  // które widzi w źródle jako pełne stringi.
  const METER_BG: Record<MeterColor, string> = {
    error: "bg-error",
    warning: "bg-warning",
    success: "bg-success",
  };

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setMismatchError(null);
    setEmailError(null);

    if (password !== confirmPassword) {
      setMismatchError(t("validation.passwordMismatch"));
      return;
    }

    setSubmitting(true);

    const passwordBytes = new TextEncoder().encode(password);
    let material: ReturnType<typeof deriveAuthMaterial> | undefined;
    let wrappingKey: WasmWrappingKey | undefined;
    let uk: WasmUserKey | undefined;

    try {
      // WASM musi być zainstancjonowane przed pierwszym wywołaniem krypto —
      // memoizowany singleton, więc kolejne wywołania są darmowe.
      await initCrypto();
      const salt = randomSalt(16);
      material = deriveAuthMaterial(passwordBytes, salt, defaultKdfParamsJson());
      const authHash = material.takeAuthHash();
      wrappingKey = material.takeWrappingKey();
      uk = generateUserKey();
      const pwWrappedUk = wrapUserKey(wrappingKey, uk);
      const authHashB64 = base64Encode(authHash);

      await register({
        email,
        kdf: JSON.parse(defaultKdfParamsJson()),
        salt: base64Encode(salt),
        auth_hash: authHashB64,
        pw_wrapped_uk: pwWrappedUk,
      });

      // Same derived auth_hash, no second password prompt or Argon2id pass.
      const { session_token } = await login({ email, auth_hash: authHashB64 });

      setSessionToken(session_token);
      setStoredEmail(email);
      setUnlockedUserKey(uk);
      // KEY-01 (26-02-PLAN.md): fire-and-forget, issued while `uk` still
      // holds a valid, non-freed reference -- the async call captures its
      // own parameter binding, so nulling the local variable below does not
      // affect it. Never awaited, never wrapped in try/catch here (E9).
      publishOnUnlock(uk);
      uk = undefined; // ownership transferred to the lock-state singleton
      // Poinformuj rodzica (page.tsx), że sesja istnieje — bez tego jego
      // `authed` zostaje przy wartości z mounta i UI nigdzie nie przechodzi.
      onAuthed?.();
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setEmailError(t("auth.duplicateEmail"));
      } else {
        setEmailError(t("auth.registrationFailed"));
      }
    } finally {
      passwordBytes.fill(0);
      uk?.free?.();
      wrappingKey?.free?.();
      material?.free?.();
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <label htmlFor="register-email" className="text-sm">
          {t("auth.emailLabel")}
        </label>
        <input
          id="register-email"
          data-testid="register-email"
          type="email"
          autoComplete="username"
          required
          className="input input-bordered w-full"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {emailError ? <p className="text-sm text-error">{emailError}</p> : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="register-password" className="text-sm">
          {t("auth.passwordLabel")}
        </label>
        <input
          id="register-password"
          data-testid="register-password"
          type="password"
          autoComplete="new-password"
          required
          className="input input-bordered w-full font-mono"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-300" aria-hidden="true">
          <div
            data-testid="register-strength-meter"
            className={`h-full rounded-full transition-all duration-300 ${METER_BG[meter.color]}`}
            style={{ width: `${meter.percent}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="register-confirm-password" className="text-sm">
          {t("auth.confirmPasswordLabel")}
        </label>
        <input
          id="register-confirm-password"
          data-testid="register-confirm-password"
          type="password"
          autoComplete="new-password"
          required
          className="input input-bordered w-full font-mono"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {mismatchError ? <p className="text-sm text-error">{mismatchError}</p> : null}
      </div>

      {/* Quick task 260803-inv: solid alert-warning (#FFBE00 fill) outweighed
          the primary CTA directly below it -- worst on the invite-landing
          "register and join" screen, the one place the user most needs the
          button to read as primary. `alert-soft` is daisyUI 5's own softer
          alert treatment (8%-tint background, no drop shadow) -- same
          --color-warning role, same legibility, lower visual weight. No new
          colour introduced; still visible, still `role="alert"`. */}
      <div role="alert" className="alert alert-warning alert-soft text-sm">
        {t("auth.irrecoverableWarning")}
      </div>

      <button
        type="submit"
        data-testid="register-submit"
        className="btn btn-primary"
        disabled={submitting}
      >
        {submitLabel ?? t("auth.registerSubmit")}
      </button>

      <button type="button" className="link link-secondary text-sm" onClick={onToggle}>
        {t("auth.toggleToLogin")}
      </button>
    </form>
  );
}
