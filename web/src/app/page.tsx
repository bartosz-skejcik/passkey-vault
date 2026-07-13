"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MainColumn from "@/components/shell/MainColumn";
import SelfTestCard from "@/components/self-test/SelfTestCard";
import AuthCard from "@/components/auth/AuthCard";
import RegisterForm from "@/components/auth/RegisterForm";
import LoginForm from "@/components/auth/LoginForm";
import UnlockOverlay from "@/components/auth/UnlockOverlay";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { getSessionToken } from "@/lib/auth/session";
import { useIsUnlocked } from "@/lib/crypto";

export default function Home() {
  const { t } = useLocale();
  const unlocked = useIsUnlocked();
  // `null` = not yet resolved (avoids a flash of the wrong screen before
  // this mount effect runs); `true`/`false` after resolving the stored
  // session token.
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");

  useEffect(() => {
    setAuthed(getSessionToken() !== null);
  }, []);

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
            <MainColumn>{unlocked ? <SelfTestCard /> : null}</MainColumn>
          </div>
        </div>
      </div>
      <UnlockOverlay />
    </>
  );
}
