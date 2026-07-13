"use client";

import { useEffect, useState } from "react";
import Sidebar, {
  AUTOLOCK_CHANGED_EVENT,
  AUTOLOCK_MINUTES_KEY,
  DEFAULT_AUTOLOCK_MINUTES,
} from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MainColumn from "@/components/shell/MainColumn";
import AuthCard from "@/components/auth/AuthCard";
import RegisterForm from "@/components/auth/RegisterForm";
import LoginForm from "@/components/auth/LoginForm";
import UnlockOverlay from "@/components/auth/UnlockOverlay";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { getSessionToken } from "@/lib/auth/session";
import { lockVault, useIsUnlocked } from "@/lib/crypto";
import { useIdleTimer } from "@/lib/idle/useIdleTimer";

function readAutolockMinutes(): number {
  try {
    const stored = localStorage.getItem(AUTOLOCK_MINUTES_KEY);
    return stored !== null ? Number(stored) : Number(DEFAULT_AUTOLOCK_MINUTES);
  } catch {
    return Number(DEFAULT_AUTOLOCK_MINUTES);
  }
}

export default function Home() {
  const { t } = useLocale();
  const unlocked = useIsUnlocked();
  // `null` = not yet resolved (avoids a flash of the wrong screen before
  // this mount effect runs); `true`/`false` after resolving the stored
  // session token.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [autolockMinutes, setAutolockMinutes] = useState(Number(DEFAULT_AUTOLOCK_MINUTES));

  useEffect(() => {
    setAuthed(getSessionToken() !== null);
    setAutolockMinutes(readAutolockMinutes());

    function onAutolockChanged() {
      setAutolockMinutes(readAutolockMinutes());
    }
    window.addEventListener(AUTOLOCK_CHANGED_EVENT, onAutolockChanged);
    return () => window.removeEventListener(AUTOLOCK_CHANGED_EVENT, onAutolockChanged);
  }, []);

  // lockVault() is idempotent when already locked (see crypto/index.ts),
  // so this is safe to keep running unconditionally rather than gating it
  // on `unlocked` — no extra branch, no risk of double-locking.
  useIdleTimer(autolockMinutes * 60_000, lockVault);

  if (authed === null) {
    return null;
  }

  if (!authed) {
    return mode === "login" ? (
      <AuthCard heading={t("auth.loginSubmit")}>
        <LoginForm onToggle={() => setMode("register")} />
      </AuthCard>
    ) : (
      <AuthCard heading={t("auth.registerSubmit")}>
        <RegisterForm onToggle={() => setMode("login")} />
      </AuthCard>
    );
  }

  return (
    <>
      {/* Hard requirement, not cosmetic-only (T-02-14): MainColumn's
          data-bearing children are only mounted while unlocked. blur-md
          is cosmetic reinforcement on top of that — the real protection
          is "no data in the render tree" below. */}
      <div className={!unlocked ? "blur-md" : undefined}>
        <div className="flex h-screen flex-col md:flex-row">
          <Sidebar />
          <div className="flex flex-1 flex-col">
            <TopBar />
            <MainColumn>{null}</MainColumn>
          </div>
        </div>
      </div>
      <UnlockOverlay />
    </>
  );
}
