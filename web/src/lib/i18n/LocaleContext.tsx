"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { DICTIONARY, t as translate, type Locale } from "./dictionary";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: keyof typeof DICTIONARY) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Mirrors — does not duplicate — layout.tsx's inline pre-hydration
  // script (localeInitScript, added in Task 3), which has already set
  // <html lang> before first paint. This provider only needs to read that
  // already-correct value once, the same "read once in useEffect" shape
  // Sidebar.tsx uses for its own theme state.
  const [locale, setLocaleState] = useState<Locale>("pl");

  useEffect(() => {
    const current = document.documentElement.getAttribute("lang");
    if (current === "pl" || current === "en") {
      setLocaleState(current);
    }
  }, []);

  function setLocale(next: Locale) {
    setLocaleState(next);
    document.documentElement.setAttribute("lang", next);
    try {
      localStorage.setItem("pv-locale", next);
    } catch {
      // localStorage may be unavailable (private mode); locale still
      // applies for this session via the DOM attribute above.
    }
  }

  const value: LocaleContextValue = {
    locale,
    setLocale,
    t: (key) => translate(locale, key),
  };

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (ctx === null) {
    throw new Error("useLocale must be used within a LocaleProvider");
  }
  return ctx;
}
