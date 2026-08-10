"use client";

// Shared auth gate (Phase 29 tracer, 29-PATTERNS.md) — extracted verbatim
// from page.tsx's inline `authed === null / false / true` branch
// (page.tsx:332-360). This exact 3-state contract (`null` = not yet
// resolved/render nothing, `false` = AuthCard, `true` = render children)
// is what makes SC1's "cold browser" claim correct for `/settings`
// (29-RESEARCH.md's Pitfall 1) — a zero-session mount must never flash
// authenticated content before this effect resolves.
//
// `page.tsx` keeps its own inline branch working UNMODIFIED until Plan
// 29-03 wires it to use this component instead — this file only creates
// the standalone, independently-usable component.
import { useEffect, useState, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { getSessionToken } from "@/lib/auth/session";
import AuthCard from "@/components/auth/AuthCard";
import LoginForm from "@/components/auth/LoginForm";
import RegisterForm from "@/components/auth/RegisterForm";

export default function AuthGate({
  children,
  onRegistered,
}: {
  children: ReactNode;
  // Called after a fresh registration completes (RegisterForm's onAuthed),
  // in addition to this component's own setAuthed(true) — the onboarding-
  // wizard trigger stays each caller's own concern. `/settings/page.tsx`
  // passes none, so a cold unauthenticated visit that registers a fresh
  // account there never shows the onboarding wizard on `/settings`.
  onRegistered?: () => void;
}) {
  const { t } = useLocale();
  // `null` = not yet resolved (avoids a flash of the wrong screen before
  // the mount effect below runs); `true`/`false` after resolving the
  // stored session token.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");

  useEffect(() => {
    // IN-02 (code review, Phase 29): `localStorage.getItem` returns `""`
    // (NOT `null`) for an explicitly-stored empty-string value, so
    // `getSessionToken() !== null` alone resolves `authed = true` for that
    // case -- a fail-open branch in a component whose whole job is to fail
    // closed. The server remains the real authority regardless (a stale/
    // empty token still 401s on the first real request), so the impact was
    // limited to a UI that briefly renders then errors -- still worth
    // closing explicitly rather than relying on that downstream backstop.
    const token = getSessionToken();
    setAuthed(token !== null && token !== "");
  }, []);

  if (authed === null) {
    return null;
  }

  if (!authed) {
    return mode === "login" ? (
      <AuthCard heading={t("auth.loginSubmit")}>
        <LoginForm onToggle={() => setMode("register")} onAuthed={() => setAuthed(true)} />
      </AuthCard>
    ) : (
      <AuthCard heading={t("auth.registerSubmit")}>
        <RegisterForm
          onToggle={() => setMode("login")}
          onAuthed={() => {
            setAuthed(true);
            onRegistered?.();
          }}
        />
      </AuthCard>
    );
  }

  return <>{children}</>;
}
