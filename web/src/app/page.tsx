"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/shell/Sidebar";
import TopBar from "@/components/shell/TopBar";
import MainColumn from "@/components/shell/MainColumn";
import SelfTestCard from "@/components/self-test/SelfTestCard";
import AuthCard from "@/components/auth/AuthCard";
import RegisterForm from "@/components/auth/RegisterForm";
import LoginForm from "@/components/auth/LoginForm";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { getSessionToken } from "@/lib/auth/session";

export default function Home() {
  const { t } = useLocale();
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
    <div className="flex h-screen flex-col md:flex-row">
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <TopBar />
        <MainColumn>
          <SelfTestCard />
        </MainColumn>
      </div>
    </div>
  );
}
