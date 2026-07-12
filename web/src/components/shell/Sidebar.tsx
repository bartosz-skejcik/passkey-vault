"use client";

import { useEffect, useState } from "react";
import { Folder, Moon, Sun, Tag, User, Vault } from "lucide-react";

const NAV_ITEMS = [
  { label: "Vault", icon: Vault },
  { label: "Foldery", icon: Folder },
  { label: "Tagi", icon: Tag },
];

export default function Sidebar() {
  // Mirrors — does not duplicate — layout.tsx's inline pre-hydration
  // script, which only resolves the *initial* theme before first paint.
  // This component owns every subsequent user-driven theme change and
  // keeps its own render in sync with the DOM attribute it just set.
  const [theme, setTheme] = useState<"vault-dark" | "vault-light">("vault-dark");

  useEffect(() => {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "vault-light" || current === "vault-dark") {
      setTheme(current);
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
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-base-300 text-base-content/60">
          <User size={18} aria-hidden="true" />
        </div>
        <div className="flex-1 text-sm text-base-content/70">Konto</div>
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
