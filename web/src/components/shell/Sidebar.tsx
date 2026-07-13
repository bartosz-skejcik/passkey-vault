"use client";

import { useEffect, useState } from "react";
import { Folder, Lock, LogOut, Languages, Moon, Sun, Tag, User, Vault } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { lockVault } from "@/lib/crypto";
import { logout } from "@/lib/auth/api";
import { clearSessionToken, clearStoredEmail } from "@/lib/auth/session";

const NAV_ITEMS = [
  { label: "Vault", icon: Vault },
  { label: "Foldery", icon: Folder },
  { label: "Tagi", icon: Tag },
];

const AUTOLOCK_MINUTES_KEY = "pv-autolock-minutes";
const AUTOLOCK_CHANGED_EVENT = "pv-autolock-changed";
const AUTOLOCK_OPTIONS = [1, 5, 15, 30, 60];
const DEFAULT_AUTOLOCK_MINUTES = "15";

export default function Sidebar() {
  const { locale, setLocale, t } = useLocale();
  // Mirrors — does not duplicate — layout.tsx's inline pre-hydration
  // script, which only resolves the *initial* theme before first paint.
  // This component owns every subsequent user-driven theme change and
  // keeps its own render in sync with the DOM attribute it just set.
  const [theme, setTheme] = useState<"vault-dark" | "vault-light">("vault-dark");
  const [autolockMinutes, setAutolockMinutes] = useState(DEFAULT_AUTOLOCK_MINUTES);

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "vault-light" || current === "vault-dark") {
      setTheme(current);
    }

    try {
      const stored = localStorage.getItem(AUTOLOCK_MINUTES_KEY);
      if (stored !== null && AUTOLOCK_OPTIONS.includes(Number(stored))) {
        setAutolockMinutes(stored);
      }
    } catch {
      // localStorage may be unavailable (private mode); default stands.
    }
  }, []);

  function toggleTheme() {
    const next = theme === "vault-light" ? "vault-dark" : "vault-light";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("pv-theme", next);
    } catch {
      // localStorage may be unavailable (private mode); theme still
      // applies for this session via the DOM attribute above.
    }
    setTheme(next);
  }

  function changeLanguage() {
    setLocale(locale === "pl" ? "en" : "pl");
  }

  function handleAutolockChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value;
    setAutolockMinutes(next);
    try {
      localStorage.setItem(AUTOLOCK_MINUTES_KEY, next);
    } catch {
      // localStorage may be unavailable (private mode) — the timer still
      // applies for this in-memory session.
    }
    // localStorage's own "storage" event only fires in *other* tabs — the
    // page.tsx idle-timer call site (same tab) needs its own notification
    // to pick up the new duration immediately.
    window.dispatchEvent(new Event(AUTOLOCK_CHANGED_EVENT));
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Best-effort — clear local state regardless of server-side outcome
      // (e.g. the session was already expired server-side).
    }
    clearSessionToken();
    clearStoredEmail();
    lockVault();
    try {
      window.location.reload();
    } catch {
      // jsdom (unit tests) doesn't implement real navigation.
    }
  }

  return (
    <aside className="hidden md:flex md:w-64 md:shrink-0 flex-col bg-base-200 p-4">
      <nav className="flex flex-col gap-2">
        {NAV_ITEMS.map(({ label, icon: Icon }) => (
          <div
            key={label}
            aria-disabled="true"
            className="flex items-center gap-2 rounded-field px-3 py-2 text-sm text-base-content/70"
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </div>
        ))}
      </nav>

      <div className="mt-auto flex items-center gap-3 border-t border-base-300 pt-4">
        <div className="dropdown dropdown-top flex-1">
          <div
            tabIndex={0}
            role="button"
            className="flex w-full items-center gap-3 rounded-field p-1 text-left"
          >
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-base-300 text-base-content/60">
              <User size={18} aria-hidden="true" />
            </div>
            <div className="flex-1 text-sm text-base-content/70">Konto</div>
          </div>

          <ul
            tabIndex={0}
            className="dropdown-content menu z-10 mb-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow"
          >
            <li className="menu-title">{t("autolock.label")}</li>
            <li>
              <select
                data-testid="sidebar-autolock-select"
                aria-label={t("autolock.label")}
                className="select select-sm select-bordered w-full"
                value={autolockMinutes}
                onChange={handleAutolockChange}
              >
                {AUTOLOCK_OPTIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} min
                  </option>
                ))}
              </select>
            </li>
            <li>
              <button
                type="button"
                data-testid="sidebar-language"
                aria-label={t("aria.changeLanguage")}
                onClick={changeLanguage}
              >
                <Languages size={16} aria-hidden="true" />
                {t("aria.changeLanguage")}
              </button>
            </li>
            <li>
              <button
                type="button"
                data-testid="sidebar-lock-now"
                aria-label={t("aria.lockNow")}
                onClick={() => lockVault()}
              >
                <Lock size={16} aria-hidden="true" />
                {t("aria.lockNow")}
              </button>
            </li>
            <li>
              <button
                type="button"
                data-testid="sidebar-logout"
                aria-label={t("aria.logout")}
                onClick={handleLogout}
              >
                <LogOut size={16} aria-hidden="true" />
                {t("auth.logout")}
              </button>
            </li>
          </ul>
        </div>

        <button
          type="button"
          aria-label="Przełącz motyw"
          className="btn btn-ghost btn-square btn-sm"
          onClick={toggleTheme}
        >
          {theme === "vault-light" ? (
            <Sun size={18} aria-hidden="true" />
          ) : (
            <Moon size={18} aria-hidden="true" />
          )}
        </button>
      </div>
    </aside>
  );
}

export { AUTOLOCK_MINUTES_KEY, AUTOLOCK_CHANGED_EVENT, DEFAULT_AUTOLOCK_MINUTES };
