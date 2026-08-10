"use client";

// The authenticated `/settings` tree -- header, jump-nav, all four
// migrated sections, and UnlockOverlay. Split out of page.tsx (which stays
// a plain, non-"use client" route file per self-test/page.tsx's precedent)
// because this component needs useIsUnlocked() -- the SAME blur-md pattern
// page.tsx itself uses today (T-02-14: MainColumn's data-bearing children
// only ever mount while unlocked; blur-md is cosmetic reinforcement on top
// of that, not the real protection).
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useLocale } from "@/lib/i18n/LocaleContext";
import { useIsUnlocked } from "@/lib/crypto";
import UnlockOverlay from "@/components/auth/UnlockOverlay";
import SettingsJumpNav from "@/components/settings/SettingsJumpNav";
import SettingsSectionAccount from "@/components/settings/SettingsSectionAccount";
import SettingsSectionSecurity from "@/components/settings/SettingsSectionSecurity";
import SettingsSectionData from "@/components/settings/SettingsSectionData";
import SettingsSectionFamily from "@/components/settings/SettingsSectionFamily";

export default function SettingsShell() {
  const { t } = useLocale();
  const unlocked = useIsUnlocked();

  return (
    <>
      <div className={!unlocked ? "blur-md" : undefined}>
        <header className="sticky top-0 z-10 flex flex-col gap-1 border-b border-base-300 bg-base-100 px-4 py-4 md:px-6">
          {/* next/link, not a bare <a> (29-PATTERNS.md's navigation-primitive
              note): renders an identical <a href="/"> in the DOM (every
              literal UI-SPEC assertion -- real anchor, getAttribute("href"),
              getByRole("link") -- holds unchanged) but performs a client-side
              SPA transition on a plain click instead of a full reload, which
              would otherwise drop the in-memory unlock singleton
              (currentUserKey in lib/crypto/index.ts) exactly like
              web/e2e/fixtures.ts's documented SESSION_PASSWORD/
              reloadAndUnlock precedent describes for other full navigations.
              Middle-click/ctrl-click/open-in-new-tab still fall back to a
              real native navigation. */}
          <Link
            href="/"
            data-testid="settings-back-to-vault"
            className="inline-flex w-fit items-center gap-1 text-sm text-base-content/70 hover:text-base-content"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            {t("settings.backToVault")}
          </Link>
          <h1 className="text-[28px] font-bold leading-[1.2]">{t("settings.title")}</h1>
        </header>

        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 px-4 py-8 md:grid-cols-[200px_1fr] md:px-6">
          <SettingsJumpNav />
          {/* Content column capped at max-w-2xl regardless of the page's
              own width (deliberate reflow-prevention, not cosmetic) --
              FamilyTab/SessionsTab/PasskeysTab markup was built and
              visually tuned for a 400px drawer; letting it stretch wider
              before Phase 33's redesign would make it look sparse/broken. */}
          <main className="flex max-w-2xl flex-col">
            <SettingsSectionAccount />
            <SettingsSectionSecurity />
            <SettingsSectionData />
            <SettingsSectionFamily />
          </main>
        </div>
      </div>
      <UnlockOverlay />
    </>
  );
}
