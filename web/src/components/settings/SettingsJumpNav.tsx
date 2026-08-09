"use client";

// `/settings` jump-nav (Phase 29 tracer, 29-UI-SPEC.md's Jump-nav section).
// A real `<nav>` landmark with exactly four static `<a href="#slug">`
// links — no data source, no empty/loading state (E2 empty/loading/
// populated/zero-one-many). IntersectionObserver scroll-spy is a
// progressive enhancement only: with it unavailable/stubbed out, every
// link still navigates via native anchor href behavior (E2 error/partial).
import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/LocaleContext";

const GROUPS: { slug: string; labelKey: "settings.groupAccount" | "settings.groupSecurity" | "settings.groupData" | "settings.groupFamily" }[] = [
  { slug: "konto", labelKey: "settings.groupAccount" },
  { slug: "bezpieczenstwo", labelKey: "settings.groupSecurity" },
  { slug: "dane", labelKey: "settings.groupData" },
  { slug: "rodzina", labelKey: "settings.groupFamily" },
];

// Mirrors Sidebar.tsx's own `navItemClass` helper (Sidebar.tsx:62-73) --
// this codebase's established per-file-tiny-helper convention (see
// web/e2e/sharing.spec.ts's own comment on `openFamilyTab`) -- the
// active/inactive class PAIR (bg-primary/[0.08] text-primary vs
// text-base-content/70 hover:bg-base-200) is reused verbatim, per
// 29-UI-SPEC.md's explicit instruction. Sidebar.tsx's own "w-full" is
// deliberately NOT copied here: that helper is only ever used inside a
// single vertical column there, but this nav is a horizontal pill row on
// mobile and a vertical rail on desktop -- an unconditional "w-full"
// measured live (Playwright, 375px viewport) stretched every pill to the
// full row width, defeating overflow-x-auto entirely. Width is composed
// responsively at the call site instead (no width class = content-sized
// pill on mobile, md:w-full = fills the 200px rail on desktop).
function navItemClass(active: boolean): string {
  return `flex cursor-pointer items-center justify-center gap-2 rounded-field px-3 py-2 text-left text-sm transition-colors min-h-11 md:justify-start ${
    active ? "bg-primary/[0.08] text-primary" : "text-base-content/70 hover:bg-base-200"
  }`;
}

export default function SettingsJumpNav() {
  const { t } = useLocale();
  const [activeSlug, setActiveSlug] = useState<string>("konto");

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      // No scroll-spy JS available -- the <a href> links below still work
      // via native anchor behavior; only the active-highlight is lost.
      return;
    }
    const sections = document.querySelectorAll("section[id]");
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((e) => e.isIntersecting);
        if (visible) setActiveSlug(visible.target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  function handleClick(slug: string) {
    // After the browser's native anchor scroll, move focus to the
    // destination heading (Accessibility Contract's focus-management
    // requirement) -- every `<h2 id="{slug}-heading">` carries
    // `tabIndex={-1}` for this to work.
    window.requestAnimationFrame(() => {
      document.getElementById(`${slug}-heading`)?.focus();
    });
  }

  return (
    <nav
      aria-label={t("settings.jumpNavLabel")}
      className="sticky top-24 flex w-full gap-1 overflow-x-auto md:w-[200px] md:flex-col md:overflow-visible"
    >
      {GROUPS.map(({ slug, labelKey }) => (
        <a
          key={slug}
          href={`#${slug}`}
          className={`${navItemClass(activeSlug === slug)} shrink-0 whitespace-nowrap rounded-selector md:w-full md:whitespace-normal md:rounded-field`}
          onClick={() => handleClick(slug)}
        >
          {t(labelKey)}
        </a>
      ))}
    </nav>
  );
}
